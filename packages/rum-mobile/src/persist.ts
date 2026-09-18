// Persistance VERSIONNÉE de l'identité et de la file, sur l'adaptateur de
// stockage fourni par l'application.
//
// CE QU'ELLE GARANTIT, ET CE QU'ELLE NE GARANTIT PAS.
//
// Une écriture interrompue — l'OS tue l'application pendant un `setItem` — ne
// doit pas remplacer une file valide par un JSON tronqué. Quand l'adaptateur
// déclare `capabilities.atomicWrite`, on lui fait confiance et on écrit une
// clef. Sinon, on sérialise nous-mêmes : DEUX emplacements alternés et un
// manifeste écrit en dernier. Le manifeste ne devient valide qu'une fois
// l'emplacement complet ; une interruption laisse donc le manifeste précédent,
// qui désigne l'emplacement précédent, qui est intact.
//
// Une somme de contrôle accompagne chaque écriture. Un disque plein, un
// secteur abîmé, un adaptateur qui tronque : la lecture le voit, retombe sur
// l'autre emplacement, et si les deux sont perdus, abandonne la file. Une file
// illisible est une file perdue — jamais une exception dans l'application hôte.
//
// CE QUI N'EST PAS ÉCRIT : aucune clef d'API, aucun identifiant métier brut.
// Le scrub portable passe avant, et l'enveloppe de resource (qui porte la clef)
// est reconstruite à l'envoi, jamais persistée.
import type { EmitSpan } from "@mip/rum-core";
import type { StorageAdapter } from "./adapters";
import { scrubAttributesPourDisque } from "./scrub";
import { octets, type EntreeFile } from "./queue";

/**
 * Version du FORMAT persisté. Un enregistrement d'une autre version est ignoré
 * et effacé : migrer une file de télémétrie vieille d'une version de SDK coûte
 * plus cher que la perdre, et la perdre est sans conséquence produit.
 */
export const FORMAT_VERSION = 1;

const PREFIXE = "mip.rum.v1";

export function cleIdentite(appId: string): string {
  return `${PREFIXE}.identity.${encodeURIComponent(appId)}`;
}
export function cleFile(appId: string): string {
  return `${PREFIXE}.queue.${encodeURIComponent(appId)}`;
}

/**
 * Identité d'installation. L'`appId` y est RECOPIÉ : la clef est déjà
 * app-scopée, mais un adaptateur de stockage partagé entre deux applications
 * (même conteneur, même groupe d'app iOS) pourrait rendre le contenu d'une
 * autre. On vérifie le contenu, pas seulement le chemin.
 */
export interface EnregistrementIdentite {
  v: number;
  appId: string;
  epoch: number;
  visitorId: string | null;
  createdAt: number;
}

export interface EnregistrementFile {
  v: number;
  appId: string;
  epoch: number;
  events: Array<{ id: string; span: EmitSpan; at: number }>;
}

interface Empreinte {
  len: number;
  sum: string;
}

interface Manifeste {
  v: number;
  actif: 0 | 1;
  empreintes: [Empreinte | null, Empreinte | null];
}

/**
 * FNV-1a 32 bits. Ce n'est pas une signature — un attaquant qui contrôle le
 * disque contrôle aussi la somme. C'est un détecteur de TRONCATURE et de
 * corruption, et c'est exactement le risque auquel une file locale est exposée.
 */
export function empreinte(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= value.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export type MotifEchec = "indisponible" | "corrompu";

export class PersistentStore {
  /** `null` tant qu'aucune opération n'a été tentée : inconnu n'est pas faux. */
  private disponible: boolean | null = null;
  private corruptions = 0;

  constructor(
    private storage: StorageAdapter | undefined,
    private onEchec: (motif: MotifEchec) => void,
  ) {}

  get storageAvailable(): boolean | null {
    if (!this.storage) return false; // absence d'adaptateur : on SAIT qu'il n'y a rien
    return this.disponible;
  }

  get corruptionsDetectees(): number {
    return this.corruptions;
  }

  private get atomique(): boolean {
    return this.storage?.capabilities?.atomicWrite === true;
  }

  private async lire(cle: string): Promise<string | null> {
    if (!this.storage) return null;
    try {
      const valeur = await Promise.resolve(this.storage.getItem(cle));
      this.disponible = true;
      return typeof valeur === "string" ? valeur : null;
    } catch {
      this.disponible = false;
      this.onEchec("indisponible");
      return null;
    }
  }

  private async ecrire(cle: string, valeur: string): Promise<boolean> {
    if (!this.storage) return false;
    try {
      await Promise.resolve(this.storage.setItem(cle, valeur));
      this.disponible = true;
      return true;
    } catch {
      // Disque plein, quota, chiffrement indisponible avant déverrouillage :
      // le SDK continue en mémoire, et le diagnostic le dit.
      this.disponible = false;
      this.onEchec("indisponible");
      return false;
    }
  }

  private async effacer(cle: string): Promise<void> {
    if (!this.storage) return;
    try {
      await Promise.resolve(this.storage.removeItem(cle));
    } catch {
      /* best-effort : une clef qu'on n'arrive pas à effacer expirera par TTL */
    }
  }

  /** Écriture durable d'un objet, atomique ou par manifeste selon la capacité. */
  private async ecrireEnregistrement(cle: string, objet: unknown): Promise<boolean> {
    let data: string;
    try {
      data = JSON.stringify(objet);
    } catch {
      return false; // objet non sérialisable : ne jamais lever dans l'app hôte
    }
    const enveloppe = JSON.stringify({ v: FORMAT_VERSION, len: data.length, sum: empreinte(data), data });
    if (this.atomique) return this.ecrire(cle, enveloppe);

    const manifeste = await this.lireManifeste(cle);
    const cible: 0 | 1 = manifeste && manifeste.actif === 0 ? 1 : 0;
    if (!(await this.ecrire(`${cle}.${cible}`, enveloppe))) return false;
    const empreintes: [Empreinte | null, Empreinte | null] = manifeste
      ? [...manifeste.empreintes]
      : [null, null];
    empreintes[cible] = { len: enveloppe.length, sum: empreinte(enveloppe) };
    // Le manifeste EN DERNIER : tant qu'il n'est pas écrit, la lecture continue
    // de désigner l'emplacement précédent, qui est complet.
    return this.ecrire(cle, JSON.stringify({ v: FORMAT_VERSION, actif: cible, empreintes }));
  }

  private async lireManifeste(cle: string): Promise<Manifeste | null> {
    const brut = await this.lire(cle);
    if (!brut) return null;
    try {
      const objet = JSON.parse(brut) as Manifeste;
      if (objet?.v !== FORMAT_VERSION || (objet.actif !== 0 && objet.actif !== 1)) return null;
      if (!Array.isArray(objet.empreintes) || objet.empreintes.length !== 2) return null;
      return objet;
    } catch {
      return null;
    }
  }

  /** Lecture durable. Rend `null` sur absence, version étrangère ou corruption. */
  private async lireEnregistrement(cle: string): Promise<unknown | null> {
    if (this.atomique) return this.ouvrirEnveloppe(await this.lire(cle));

    const manifeste = await this.lireManifeste(cle);
    if (!manifeste) {
      // Pas de manifeste lisible : soit rien n'a jamais été écrit, soit le
      // manifeste est perdu. On ne devine pas un emplacement au hasard.
      return null;
    }
    const ordre: Array<0 | 1> = manifeste.actif === 0 ? [0, 1] : [1, 0];
    for (const slot of ordre) {
      const attendu = manifeste.empreintes[slot];
      if (!attendu) continue;
      const brut = await this.lire(`${cle}.${slot}`);
      if (brut == null) continue;
      if (brut.length !== attendu.len || empreinte(brut) !== attendu.sum) {
        this.corruptions++;
        this.onEchec("corrompu");
        continue; // l'emplacement précédent est peut-être intact
      }
      const objet = this.ouvrirEnveloppe(brut);
      if (objet !== null) return objet;
    }
    return null;
  }

  private ouvrirEnveloppe(brut: string | null): unknown | null {
    if (!brut) return null;
    try {
      const enveloppe = JSON.parse(brut) as { v?: number; len?: number; sum?: string; data?: string };
      if (enveloppe?.v !== FORMAT_VERSION || typeof enveloppe.data !== "string") return null;
      if (enveloppe.data.length !== enveloppe.len || empreinte(enveloppe.data) !== enveloppe.sum) {
        this.corruptions++;
        this.onEchec("corrompu");
        return null;
      }
      return JSON.parse(enveloppe.data);
    } catch {
      this.corruptions++;
      this.onEchec("corrompu");
      return null;
    }
  }

  private async effacerEnregistrement(cle: string): Promise<void> {
    await this.effacer(cle);
    if (!this.atomique) {
      await this.effacer(`${cle}.0`);
      await this.effacer(`${cle}.1`);
    }
  }

  // ───────────────────────────── identité ──────────────────────────────────

  async chargerIdentite(appId: string): Promise<EnregistrementIdentite | null> {
    const objet = (await this.lireEnregistrement(cleIdentite(appId))) as EnregistrementIdentite | null;
    if (!objet || objet.v !== FORMAT_VERSION || objet.appId !== appId) return null;
    if (typeof objet.epoch !== "number" || !Number.isFinite(objet.epoch)) return null;
    return {
      v: FORMAT_VERSION,
      appId,
      epoch: Math.max(1, Math.floor(objet.epoch)),
      visitorId: typeof objet.visitorId === "string" ? objet.visitorId : null,
      createdAt: typeof objet.createdAt === "number" ? objet.createdAt : 0,
    };
  }

  async enregistrerIdentite(record: EnregistrementIdentite): Promise<boolean> {
    return this.ecrireEnregistrement(cleIdentite(record.appId), record);
  }

  // ─────────────────────────────── file ────────────────────────────────────

  /**
   * Écrit la file, SCRUBBÉE. Les identités brutes et la clef d'API ne franchissent
   * jamais cette frontière ; le scrub serveur reste ensuite autoritaire à
   * réception, parce qu'un filtre client n'est jamais une garantie.
   */
  async enregistrerFile(appId: string, epoch: number, entrees: readonly EntreeFile[]): Promise<boolean> {
    if (!entrees.length) {
      await this.effacerEnregistrement(cleFile(appId));
      return true;
    }
    const record: EnregistrementFile = {
      v: FORMAT_VERSION,
      appId,
      epoch,
      events: entrees.map((e) => ({
        id: e.id,
        at: e.at,
        span: { ...e.span, attributes: scrubAttributesPourDisque(e.span.attributes) },
      })),
    };
    return this.ecrireEnregistrement(cleFile(appId), record);
  }

  /**
   * Relit la file. Trois refus, chacun pour une raison propre :
   *  - `appId` différent : la file de l'application A ne part JAMAIS dans B ;
   *  - `epoch` différent : consentement révoqué depuis, aucun rejeu ;
   *  - entrée hors TTL : elle aurait dû expirer, on ne la ressuscite pas.
   */
  async chargerFile(
    appId: string,
    epoch: number,
    maintenant: number,
    ttlMs: number,
  ): Promise<EntreeFile[]> {
    const objet = (await this.lireEnregistrement(cleFile(appId))) as EnregistrementFile | null;
    if (!objet || objet.v !== FORMAT_VERSION) return [];
    if (objet.appId !== appId || objet.epoch !== epoch) {
      await this.effacerEnregistrement(cleFile(appId));
      return [];
    }
    if (!Array.isArray(objet.events)) return [];
    const limite = maintenant - ttlMs;
    const out: EntreeFile[] = [];
    for (const e of objet.events) {
      if (!e || typeof e.id !== "string" || typeof e.at !== "number" || !e.span) continue;
      if (e.at <= limite) continue;
      let bytes: number;
      try {
        bytes = octets(JSON.stringify(e.span));
      } catch {
        continue;
      }
      out.push({ id: e.id, span: e.span, at: e.at, bytes });
    }
    return out;
  }

  async effacerFile(appId: string): Promise<void> {
    await this.effacerEnregistrement(cleFile(appId));
  }

  /** Révocation : identité ET file quittent le disque. */
  async effacerTout(appId: string): Promise<void> {
    await this.effacerEnregistrement(cleFile(appId));
    await this.effacerEnregistrement(cleIdentite(appId));
  }
}
