// Contrôles de provenance de la vitrine contre le document de couverture — PURS.
//
// La partie « Ce qu'il sait faire » de la vitrine (lib/presentation-sait-faire.ts)
// et la partie « Ce qui reste » (lib/presentation-reste.ts) n'ont le droit de
// dire que ce que le document dit. Ces fonctions rendent la LISTE des écarts
// (vide = conforme), chaque message nommant la carte et l'identifiant fautifs :
// un test qui échoue doit dire quoi corriger, pas seulement qu'il y a un problème.
//
// Elles ne lisent aucun fichier : le nombre de lignes d'un fichier du dépôt est
// fourni par l'appelant (`lignesDe`), ce qui les rend testables sur des fixtures
// avant même que les cartes existent.
import type { Capacite } from "./couverture";

/** D'où vient le texte d'une carte. */
export type Source =
  /** Une ligne de capacité du document, par identifiant. */
  | { ligne: string }
  /** Une ligne du document qui n'est PAS une ligne de capacité (§ 6.3, § 6.4…). */
  | { passage: number }
  /** Un fichier du dépôt, « chemin:ligne » ou « chemin:début-fin ». */
  | { fichier: string };

export interface CarteCapacite {
  id: string;
  titre: string;
  faitQuoi: string;
  /** Une puce par identifiant ; les identifiants de la carte en sont DÉRIVÉS. */
  limites: { id: string; texte: string }[];
  sources: Source[];
}

export interface PointReste {
  id: string;
  titre: string;
  manque: string;
  debloque: string;
  decide: string;
  /** Identifiants de capacité ou « chemin:ligne ». */
  sources: string[];
}

export interface ContexteControle {
  capacites: readonly Capacite[];
  /** Nombre de lignes du document de couverture. */
  lignesDocument: number;
  /** Nombre de lignes d'un fichier du dépôt, ou null s'il n'existe pas. */
  lignesDe: (chemin: string) => number | null;
}

/** Le seul verdict que la partie 2 peut montrer. */
export const VERDICT_MONTRABLE = "deploye_non_eprouve";

/**
 * Déployées mais inertes sur le trafic réel : elles vont en « Ce qui reste »,
 * pas en « Ce qu'il sait faire » — déployé ne veut pas dire actif.
 */
export const DEPLOYEES_INERTES: readonly string[] = ["D12", "D14"];

const ID_CAPACITE = /^[A-Z]\d+$/;

/** « chemin:12 » ou « chemin:12-18 » → chemin et dernière ligne citée. */
export function lireFichierCite(cite: string): { chemin: string; derniere: number | null } {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(cite);
  if (!m) return { chemin: cite, derniere: null };
  return { chemin: m[1], derniere: Number(m[3] ?? m[2]) };
}

function verifierFichier(cite: string, ctx: ContexteControle): string | null {
  const { chemin, derniere } = lireFichierCite(cite);
  const n = ctx.lignesDe(chemin);
  if (n == null) return `fichier introuvable : ${chemin}`;
  if (derniere != null && derniere > n) return `${cite} : le fichier n'a que ${n} lignes`;
  return null;
}

/** Contrôles 3a, 3b et 3c du § 8.4 (P**.0) sur les cartes de la partie 2. */
export function verifierCartes(
  cartes: readonly CarteCapacite[],
  reste: readonly PointReste[],
  ctx: ContexteControle,
): string[] {
  const erreurs: string[] = [];
  const parId = new Map(ctx.capacites.map((c) => [c.id, c]));
  const parLigne = new Map(ctx.capacites.map((c) => [c.ligne, c]));

  // 3a — identifiants
  const vuDans = new Map<string, string>();
  for (const carte of cartes) {
    for (const { id } of carte.limites) {
      const cap = parId.get(id);
      if (!cap) erreurs.push(`${carte.id} : ${id} n'est pas une ligne du document`);
      else if (cap.verdict !== VERDICT_MONTRABLE) {
        erreurs.push(`${carte.id} : ${id} est « ${cap.verdict} », pas « ${VERDICT_MONTRABLE} »`);
      }
      const autre = vuDans.get(id);
      if (autre && autre !== carte.id) erreurs.push(`${id} figure dans deux cartes : ${autre} et ${carte.id}`);
      vuDans.set(id, carte.id);
    }
  }
  const attendus = new Set(ctx.capacites.filter((c) => c.verdict === VERDICT_MONTRABLE).map((c) => c.id));
  const couverts = new Set([...vuDans.keys(), ...DEPLOYEES_INERTES]);
  const manquants = [...attendus].filter((id) => !couverts.has(id));
  const surnumeraires = [...couverts].filter((id) => !attendus.has(id));
  if (manquants.length) erreurs.push(`identifiants « ${VERDICT_MONTRABLE} » absents des cartes : ${manquants.join(", ")}`);
  if (surnumeraires.length) erreurs.push(`identifiants surnuméraires : ${surnumeraires.join(", ")}`);
  const citesDansReste = new Set(reste.flatMap((p) => p.sources));
  for (const id of DEPLOYEES_INERTES) {
    if (!citesDansReste.has(id)) erreurs.push(`${id} (déployée, inerte) doit figurer dans « Ce qui reste »`);
  }

  for (const carte of cartes) {
    // 3b — provenance du texte
    for (const source of carte.sources) {
      if ("ligne" in source) {
        const cap = parId.get(source.ligne);
        if (!cap) erreurs.push(`${carte.id} : source ${source.ligne} inconnue du document`);
        else if (cap.verdict !== VERDICT_MONTRABLE) {
          erreurs.push(`${carte.id} : source ${cap.id} (« ${cap.verdict} ») — une réserve d'un autre verdict va en « Ce qui reste »`);
        }
      } else if ("passage" in source) {
        const cap = parLigne.get(source.passage);
        if (cap) {
          // Un « passage » qui tombe sur une ligne de capacité EST cette ligne.
          if (cap.verdict !== VERDICT_MONTRABLE) {
            erreurs.push(`${carte.id} : passage :${source.passage} est la ligne ${cap.id} (« ${cap.verdict} »)`);
          }
        } else if (source.passage < 1 || source.passage > ctx.lignesDocument) {
          erreurs.push(`${carte.id} : passage :${source.passage} hors du document (${ctx.lignesDocument} lignes)`);
        }
      } else {
        const faute = verifierFichier(source.fichier, ctx);
        if (faute) erreurs.push(`${carte.id} : ${faute}`);
      }
    }

    // 3c — une puce par identifiant
    const puces = new Set(carte.limites.map((l) => l.id));
    const cites = new Set(carte.sources.flatMap((s) => ("ligne" in s ? [s.ligne] : [])));
    const sansSource = [...puces].filter((id) => !cites.has(id));
    const sansPuce = [...cites].filter((id) => !puces.has(id));
    if (sansSource.length) erreurs.push(`${carte.id} : puce sans source { ligne } : ${sansSource.join(", ")}`);
    if (sansPuce.length) erreurs.push(`${carte.id} : source sans puce de limite : ${sansPuce.join(", ")}`);
    for (const l of carte.limites) {
      if (!l.texte.trim()) erreurs.push(`${carte.id} : la puce ${l.id} n'a pas de texte`);
    }
  }
  return erreurs;
}

/** Contrôle 4 du § 8.4 (P**.0) : chaque point de « Ce qui reste » cite une source qui existe. */
export function verifierReste(points: readonly PointReste[], ctx: ContexteControle): string[] {
  const erreurs: string[] = [];
  const ids = new Set(ctx.capacites.map((c) => c.id));
  for (const p of points) {
    if (!p.sources.length) {
      erreurs.push(`${p.id} : aucune source`);
      continue;
    }
    for (const s of p.sources) {
      if (ID_CAPACITE.test(s)) {
        if (!ids.has(s)) erreurs.push(`${p.id} : ${s} n'est pas une ligne du document`);
      } else {
        const faute = verifierFichier(s, ctx);
        if (faute) erreurs.push(`${p.id} : ${faute}`);
      }
    }
  }
  return erreurs;
}
