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

// ─────────────────────── F11 — sparkline d'une tuile de compte ───────────────────────
import { alignerSeaux as alignerSeauxF11 } from "./series";

/**
 * Sparkline d'une tuile de COMPTE (« Sessions commencées », « Pages vues », § 5.1.2),
 * posée sur la grille du contrat : un seau sans ligne vaut 0 (un compte additif).
 *
 * Valeur et sparkline d'une même tuile comptent la MÊME population (R-P) : la somme
 * des seaux doit égaler la valeur. Si elle ne l'égale pas (une ligne hors grille, une
 * lecture qui ne compte pas la même chose), la sparkline est RETIRÉE (`null`) : une
 * courbe qui contredit le chiffre qu'elle illustre ferait lire deux populations.
 */
export function sparklineDeCompte(
  lignes: readonly { bucket: string | Date; n: number }[],
  debuts: readonly number[],
  valeur: number,
): number[] | null {
  const seaux = alignerSeauxF11([...lignes], [...debuts], false).map((l) => (l ? Number(l.n) : 0));
  const somme = seaux.reduce((total, n) => total + n, 0);
  return somme === valeur ? seaux : null;
}

// ─────────────── F13 — `choisirRelB` : le nom du plan (§ 4.4), la règle de F08 ───────────────
// Reliquat de l'écart 8 de F10 : `lib/presets.ts` (F08) porte la règle du § 3.2 (CP3) sous
// le nom `choisirReleases`. Réexportée ici sous le nom du registre du plan. Elle rend la
// PAIRE (B, A) et la règle appliquée, pas `rel_b` seul : une règle écrite sous le titre
// d'une comparaison nomme les deux releases (« 1.4.2 : dernier déploiement déclaré ;
// 1.4.1 : déploiement précédent »).
export { choisirReleases as choisirRelB } from "./presets";
