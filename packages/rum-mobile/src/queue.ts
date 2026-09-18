// File d'événements mobile — bornée, datée, et acquittée avant retrait.
//
// TROIS PROPRIÉTÉS, ET LEUR RAISON.
//
// 1. BORNÉE EN NOMBRE ET EN OCTETS. Un téléphone hors ligne pendant un vol
//    long-courrier produit des dizaines de milliers d'événements. Borner
//    seulement le nombre laisse passer une file d'une centaine de méga-octets ;
//    borner seulement les octets laisse une file de millions d'entrées coûteuse
//    à parcourir. On borne les deux, et on jette les PLUS ANCIENS : un
//    événement de la semaine dernière vaut moins qu'un de maintenant.
//
// 2. UN SEUL ÉVÉNEMENT ÉNORME NE FAIT PAS DÉPASSER LE PLAFOND. Sans cette
//    règle, un `track()` avec 3 Mio de props viderait la file entière pour ne
//    jamais tenir lui-même. Il est refusé à l'entrée et compté comme perte ;
//    la file en place survit.
//
// 3. ACQUITTEMENT AVANT RETRAIT. `lease()` ne retire rien : il marque. Seul
//    `ack()` retire. Un lot parti et jamais acquitté revient donc dans la file
//    au `nack()`, avec les MÊMES identifiants de span — l'ingestion le
//    dédoublonne sur `span_id` plutôt que de compter deux occurrences.
import type { EmitSpan } from "@mip/rum-core";

/** Défauts mémoire. Dépassables par `offline`, dans la limite de `LIMITES_MAX`. */
export const LIMITES_DEFAUT = {
  maxEvents: 500,
  maxBytes: 1024 * 1024, // 1 Mio
  ttlMs: 24 * 60 * 60 * 1000, // 24 h
} as const;

/** Plafonds durs. Une configuration applicative ne peut pas les franchir. */
export const LIMITES_MAX = {
  maxEvents: 1000,
  maxBytes: 2 * 1024 * 1024, // 2 Mio
  ttlMs: 24 * 60 * 60 * 1000,
} as const;

/** Un lot ne dépasse jamais ce nombre d'événements. */
export const BATCH_MAX_EVENTS = 64;

export interface LimitesFile {
  maxEvents: number;
  maxBytes: number;
  ttlMs: number;
}

/** Motif d'une perte. Sert au diagnostic, jamais à l'application. */
export type MotifPerte = "capacite" | "ttl" | "trop_gros" | "revocation" | "definitif";

export interface EntreeFile {
  /** Identifiant technique du span. STABLE au rejeu : c'est la clef d'idempotence. */
  id: string;
  span: EmitSpan;
  /** Octets de la forme aplatie, mesurés une fois à l'entrée. */
  bytes: number;
  /** Horodatage UTC d'entrée en file — c'est lui que le TTL compare. */
  at: number;
  /** Lot en cours d'envoi : présent dans la file, mais déjà pris en charge. */
  leased?: boolean;
}

// L'ÉPOQUE N'EST PAS PORTÉE PAR L'ENTRÉE. Une révocation vide la file entière ;
// tout ce qui s'y trouve appartient donc, par construction, à l'époque courante.
// L'époque est écrite sur l'ENREGISTREMENT persisté, où elle sert réellement :
// reconnaître au démarrage une file laissée avant une révocation.

/** Taille en octets d'une chaîne UTF-8, sans dépendre d'une API DOM. */
export function octets(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  // Repli : chaque point de code hors ASCII compte pour ses octets UTF-8.
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Applique les défauts puis les plafonds durs à une configuration `offline`. */
export function resoudreLimites(offline?: {
  maxEvents?: number;
  maxBytes?: number;
  ttlMs?: number;
}): LimitesFile {
  const borne = (valeur: unknown, defaut: number, max: number): number => {
    const n = typeof valeur === "number" && Number.isFinite(valeur) ? Math.floor(valeur) : defaut;
    return Math.min(Math.max(n, 1), max);
  };
  return {
    maxEvents: borne(offline?.maxEvents, LIMITES_DEFAUT.maxEvents, LIMITES_MAX.maxEvents),
    maxBytes: borne(offline?.maxBytes, LIMITES_DEFAUT.maxBytes, LIMITES_MAX.maxBytes),
    ttlMs: borne(offline?.ttlMs, LIMITES_DEFAUT.ttlMs, LIMITES_MAX.ttlMs),
  };
}

export class EventQueue {
  private entrees: EntreeFile[] = [];
  private taille = 0;

  constructor(
    private limites: LimitesFile,
    private onPerte: (motif: MotifPerte, nombre: number) => void,
    /**
     * Entrées retirées CONTRE LEUR GRÉ — capacité, TTL, refus définitif du
     * serveur. P7.3 s'en sert pour une seule chose : si une action RACINE
     * disparaît ainsi, les signaux qu'elle a causés sont encore en file et
     * portent son identifiant. Les laisser partir désignerait une action que
     * l'ingestion n'a jamais reçue. C'est le pendant mobile de `revokedRoots`
     * côté web (`packages/rum-sdk/src/consent.ts`).
     */
    private onRetrait?: (entrees: readonly EntreeFile[], motif: MotifPerte) => void,
  ) {}

  get length(): number {
    return this.entrees.length;
  }

  get bytes(): number {
    return this.taille;
  }

  /**
   * Met en file. `capEvents` permet d'imposer un plafond plus BAS que la
   * configuration — c'est ce dont se sert l'attente de consentement, où le
   * tampon mémoire doit rester modeste.
   */
  push(entree: EntreeFile, maintenant: number, capEvents = this.limites.maxEvents): boolean {
    this.expire(maintenant);
    if (entree.bytes > this.limites.maxBytes) {
      // Cet événement ne tiendra jamais, quel que soit l'état de la file. Le
      // garder en évinçant tout le reste échangerait N événements utiles contre
      // un seul qui ne partira pas davantage.
      this.onPerte("trop_gros", 1);
      return false;
    }
    this.entrees.push(entree);
    this.taille += entree.bytes;
    this.evince(Math.min(capEvents, this.limites.maxEvents));
    return true;
  }

  /** Retire les entrées échues. Le TTL se compte en temps UTC, pas monotone. */
  expire(maintenant: number): number {
    if (!this.entrees.length) return 0;
    const limite = maintenant - this.limites.ttlMs;
    const perdues: EntreeFile[] = [];
    const restantes: EntreeFile[] = [];
    for (const e of this.entrees) {
      if (e.at <= limite) {
        this.taille -= e.bytes;
        perdues.push(e);
      } else restantes.push(e);
    }
    if (perdues.length) {
      this.entrees = restantes;
      this.onPerte("ttl", perdues.length);
      this.onRetrait?.(perdues, "ttl");
    }
    return perdues.length;
  }

  /**
   * Le plus ancien part en premier. On ne jamais évince un lot EN VOL : il est
   * déjà chez le serveur, et le retirer ici perdrait l'information sans
   * empêcher son écriture.
   */
  private evince(capEvents: number): void {
    const perdues: EntreeFile[] = [];
    while (this.entrees.length > capEvents || this.taille > this.limites.maxBytes) {
      const index = this.entrees.findIndex((e) => !e.leased);
      if (index < 0) break; // tout est en vol : rien à évincer sans mentir
      this.taille -= this.entrees[index].bytes;
      perdues.push(this.entrees[index]);
      this.entrees.splice(index, 1);
    }
    if (perdues.length) {
      this.onPerte("capacite", perdues.length);
      this.onRetrait?.(perdues, "capacite");
    }
  }

  /**
   * Réserve le prochain lot SANS le retirer. `maxBytes` est le plafond de
   * transport : il borne la taille aplatie, que l'encodage OTLP multipliera
   * ensuite — le transport revérifie la taille réelle du corps.
   */
  lease(maintenant: number, maxEvents = BATCH_MAX_EVENTS, maxBytes = Number.POSITIVE_INFINITY): EntreeFile[] {
    this.expire(maintenant);
    const lot: EntreeFile[] = [];
    let total = 0;
    for (const e of this.entrees) {
      if (e.leased) continue;
      if (lot.length >= maxEvents) break;
      if (lot.length && total + e.bytes > maxBytes) break;
      e.leased = true;
      total += e.bytes;
      lot.push(e);
    }
    return lot;
  }

  /** Acquitté : retrait définitif. C'est le SEUL chemin de retrait par succès. */
  ack(lot: EntreeFile[]): void {
    if (!lot.length) return;
    const ids = new Set(lot.map((e) => e.id));
    this.entrees = this.entrees.filter((e) => {
      if (!ids.has(e.id)) return true;
      this.taille -= e.bytes;
      return false;
    });
  }

  /** Non acquitté : le lot redevient candidat, avec ses identifiants d'origine. */
  nack(lot: EntreeFile[]): void {
    for (const e of lot) e.leased = false;
  }

  /** Abandon définitif (réponse serveur sans appel) : retrait + compte de perte. */
  abandonne(lot: EntreeFile[], motif: MotifPerte): void {
    if (!lot.length) return;
    this.ack(lot);
    this.onPerte(motif, lot.length);
    this.onRetrait?.(lot, motif);
  }

  /** Vide tout. Utilisé par la révocation de consentement. */
  purge(motif: MotifPerte = "revocation"): number {
    const n = this.entrees.length;
    this.entrees = [];
    this.taille = 0;
    if (n) this.onPerte(motif, n);
    return n;
  }

  /** Contenu brut — pour la persistance et les tests. Jamais muté par l'appelant. */
  entries(): readonly EntreeFile[] {
    return this.entrees;
  }

  /**
   * Restaure des entrées lues sur le disque. Elles reprennent leur horodatage
   * d'origine : un événement restauré n'a pas rajeuni, et le TTL doit continuer
   * de courir depuis sa vraie date.
   */
  restore(entrees: EntreeFile[], maintenant: number): number {
    let reprises = 0;
    for (const e of entrees) {
      if (this.push({ ...e, leased: false }, maintenant)) reprises++;
    }
    return reprises;
  }

  /**
   * Retire un attribut des entrées dont la valeur figure dans `valeurs`.
   *
   * Symétrique d'`estampille`, et posé pour un seul usage : effacer le lien vers
   * une action racine qui a quitté la file sans être livrée. Un `action_id` qui
   * survit à sa racine désigne une action que l'ingestion n'a jamais reçue —
   * c'est un lien cassé, pas une information partielle.
   */
  retireAttribut(cle: string, valeurs: ReadonlySet<string>): number {
    if (!valeurs.size) return 0;
    let touchees = 0;
    for (const e of this.entrees) {
      const valeur = e.span.attributes[cle];
      if (typeof valeur !== "string" || !valeurs.has(valeur)) continue;
      const attributs = { ...e.span.attributes };
      // `null` et non `delete` : `commonAttrs()` pose toujours la clef, et
      // l'encodeur OTLP sait ne pas émettre une valeur nulle. Supprimer la clef
      // produirait deux formes d'enveloppe pour un même signal.
      attributs[cle] = null;
      this.taille -= e.bytes;
      e.span = { ...e.span, attributes: attributs };
      e.bytes = octets(JSON.stringify(e.span));
      this.taille += e.bytes;
      touchees++;
    }
    return touchees;
  }

  /** Réécrit un attribut sur toutes les entrées — le visiteur résolu tardivement. */
  estampille(cle: string, valeur: string): void {
    for (const e of this.entrees) {
      if (e.span.attributes[cle] != null) continue;
      this.taille -= e.bytes;
      e.span = { ...e.span, attributes: { ...e.span.attributes, [cle]: valeur } };
      e.bytes = octets(JSON.stringify(e.span));
      this.taille += e.bytes;
    }
  }
}
