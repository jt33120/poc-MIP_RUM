// Règles de valeur du domaine performance (F10, plan § 4.4) — logique PURE, testée
// (tests/unit/perf-domain.test.ts). Les lectures sont dans lib/queries.ts et
// lib/queries-errors.ts ; ici, ce que l'écran a le droit d'en tirer.
//
// Un chiffre sans dénominateur est `null` avec sa raison (V3), jamais 0 : « 0 pour
// 100 vues » sur une période sans vue, ou « 0 % de sessions touchées » sur une base
// vide, se liraient comme une bonne nouvelle.
import { queryOf, type FiltersLike } from "./filters";
import { intersectQuery, type Dimension } from "./query-contract";

/** Une valeur, ou `null` avec la phrase qui le dit (la `raisonNull` d'une tuile). */
export type ValeurOuRaison = { valeur: number; raison: null } | { valeur: null; raison: string };

export const RAISON_BASE_VIDE = "aucune session avec vue";
export const RAISON_ECHANTILLONNAGE =
  "erreurs et vues échantillonnées différemment : part non calculable";
export const RAISON_AUCUNE_VUE = "aucune page vue : ratio non calculable";

/**
 * « Part des sessions touchées » (§ 5.3.2) à partir de `partSessionsTouchees`.
 *
 *   - base vide → `null` « aucune session avec vue sur <plage> » ;
 *   - `tauxMin < 1` (ou inconnu sur une base non vide) → `null` : CP15, une session
 *     tirée hors `sampleRate` n'entre dans la base QUE si elle porte une erreur (le
 *     SDK la promeut alors), et le rapport observé surestime la part réelle ;
 *   - sinon `touchees / base`, borné à [0, 1] : la lecture garantit déjà
 *     `touchees ≤ base` (jointure sur la base), la borne rend l'invariant visible.
 */
export function partTouchees(
  lu: { base: number; touchees: number; tauxMin: number | null },
  plage?: string,
): ValeurOuRaison {
  if (!(lu.base > 0)) {
    return { valeur: null, raison: plage ? `${RAISON_BASE_VIDE} sur ${plage}` : RAISON_BASE_VIDE };
  }
  if (lu.tauxMin === null || !Number.isFinite(lu.tauxMin) || lu.tauxMin < 1) {
    return { valeur: null, raison: RAISON_ECHANTILLONNAGE };
  }
  const part = lu.touchees / lu.base;
  return { valeur: Math.min(1, Math.max(0, Number.isFinite(part) ? part : 0)), raison: null };
}

/**
 * « Occurrences d'erreurs pour 100 pages vues » : `100 × occurrences / vues`. C'est
 * un RATIO de deux comptes, pas une part : il peut dépasser 100 (30 occurrences
 * pour 20 vues → 150) et s'affiche au format `pour100`, jamais en « % ». Sans vue,
 * aucun dénominateur : `null`.
 */
export function ratioPour100(occurrences: number | null, vues: number | null): number | null {
  if (occurrences == null || vues == null || !Number.isFinite(occurrences) || !(vues > 0)) return null;
  return (100 * occurrences) / vues;
}

/**
 * Le même ratio seau par seau, pour la sparkline de la tuile (§ 5.1.2) : deux
 * séries posées sur la MÊME grille (`errorSeries(f).points`, `pageviewSeries(f)`),
 * rapprochées par début de seau. Un seau sans vue est un trou (`null`), pas un 0 ;
 * un seau absent de l'une des deux séries aussi.
 */
export function serieRatioPour100(
  erreurs: { bucket: string; navigateur: number }[],
  vues: { bucket: string; chargements: number; spa: number; inconnu: number }[],
): { bucket: string; ratio: number | null }[] {
  const parSeau = new Map(erreurs.map((e) => [Date.parse(e.bucket), e.navigateur]));
  return vues.map((v) => {
    const total = v.chargements + v.spa + v.inconnu;
    const n = parSeau.get(Date.parse(v.bucket));
    return { bucket: v.bucket, ratio: n === undefined ? null : ratioPour100(n, total) };
  });
}

/**
 * Intersecte les filtres d'un écran avec une condition locale (`route=/checkout`,
 * `release=1.4.2`) : une série « sur cette route » (§ 5.2.3) ou « sur la release
 * B » (§ 3.2, `cmp=release`) lit la MÊME fenêtre et le MÊME périmètre, resserrés.
 * Même dimension = ET (`intersectQuery`), jamais un remplacement : un filtre global
 * `route=/a` intersecté avec `/b` donne une population vide, pas `/b`.
 */
export function avecCondition<F extends FiltersLike>(f: F, dimension: Dimension, valeur: string): F {
  return {
    ...f,
    query: intersectQuery(queryOf(f), { conditions: [{ dimension, operator: "eq", value: valeur }] }),
  };
}

// ─────────────────────── F25 — Journal : colonnes promues ───────────────────────
//
// « Clés communes promues en colonnes » (§ 5.23.2) : une clé d'attribut présente
// sur au moins 80 % des lignes de la PAGE affichée devient une colonne du journal,
// pour qu'on lise `props.plan` sur chaque ligne sans ouvrir chaque contexte. Calcul
// PUR sur les lignes déjà lues : les valeurs affichées sont celles que la vue
// rendait déjà (props / context nettoyés à l'ingestion) — aucune lecture
// d'attribut brut de plus.

/** Part des lignes de la page qui doivent porter la clé pour qu'elle soit promue. */
export const SEUIL_COLONNE_PROMUE = 0.8;
/**
 * Au plus quatre colonnes promues : au-delà, la table ne se lit plus à 1 440 px, et
 * chaque attribut reste lisible dans le panneau de l'événement (P14).
 */
export const MAX_COLONNES_PROMUES = 4;

/** Même forme de clé que les facettes d'attributs (`lib/queries-events.ts`). */
const CLE_ATTRIBUT_PROMUE = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

export interface LigneAttributs {
  props?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
}

export interface ColonnePromue {
  source: "props" | "context";
  cle: string;
  /** Lignes de la page qui portent la clé. */
  presence: number;
}

function objetAttributs(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Clés portées par au moins `SEUIL_COLONNE_PROMUE` des lignes (arrondi au-dessus :
 * 4 lignes sur 5 passent, 3 sur 5 non), triées par présence décroissante, `props`
 * avant `context`, puis par nom ; au plus `MAX_COLONNES_PROMUES`. Page vide → aucune.
 */
export function colonnesPromues(
  lignes: readonly LigneAttributs[],
  options: { seuil?: number; max?: number } = {},
): ColonnePromue[] {
  if (lignes.length === 0) return [];
  const seuil = options.seuil ?? SEUIL_COLONNE_PROMUE;
  const max = options.max ?? MAX_COLONNES_PROMUES;
  const requis = Math.ceil(seuil * lignes.length);
  const comptes = new Map<string, ColonnePromue>();
  for (const ligne of lignes) {
    for (const source of ["props", "context"] as const) {
      const objet = objetAttributs(ligne[source]);
      if (!objet) continue;
      for (const cle of Object.keys(objet)) {
        if (!CLE_ATTRIBUT_PROMUE.test(cle)) continue;
        const id = `${source}.${cle}`;
        const c = comptes.get(id) ?? { source, cle, presence: 0 };
        c.presence++;
        comptes.set(id, c);
      }
    }
  }
  return [...comptes.values()]
    .filter((c) => c.presence >= requis)
    .sort(
      (a, b) =>
        b.presence - a.presence ||
        (a.source === b.source ? 0 : a.source === "props" ? -1 : 1) ||
        a.cle.localeCompare(b.cle),
    )
    .slice(0, max);
}

/**
 * Texte d'une cellule promue. Clé absente → `null` (« — ») ; valeur JSON `null` →
 * « null » (une valeur déclarée, pas une absence) ; objet ou tableau → JSON compact.
 */
export function valeurColonnePromue(ligne: LigneAttributs, colonne: Pick<ColonnePromue, "source" | "cle">): string | null {
  const objet = objetAttributs(ligne[colonne.source]);
  if (!objet || !Object.prototype.hasOwnProperty.call(objet, colonne.cle)) return null;
  const v = objet[colonne.cle];
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? null;
}
