// Les décisions PURES sur un déploiement et une comparaison de versions — verdict
// de régression, référence, taux et écarts —, SANS la base.
//
// Séparé de `queries-deploys.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : le panneau de déploiement et la table
// des versions jugent des chiffres déjà lus. Tant qu'ils importaient ces fonctions
// depuis `queries-deploys.ts`, leur graphe d'import atteignait `lib/db.ts`.

export interface DeployImpact {
  deploy_ts: Date | null;
  version: string | null;
  env: string | null;
  lcp_before: number | null;
  lcp_after: number | null;
  /** Pages vues de l'app du marqueur, `started_at ∈ [d.ts − 2 h, d.ts)`. */
  pageviews_before: number;
  /** Pages vues, `started_at ∈ [d.ts, d.ts + 2 h)`. */
  pageviews_after: number;
  /** Sessions distinctes de ces mêmes pages vues (sessions, pas visiteurs). */
  sessions_before: number;
  sessions_after: number;
  /** `sum(occurrences)` ; `null` sans page vue sur la fenêtre : sans dénominateur, « 0 » se lirait « aucune erreur ». */
  errors_before: number | null;
  errors_after: number | null;
}

export interface RegressionVerdict {
  regressed: boolean;
  deltaPct: number | null;
}

/**
 * Verdict de régression pour une mesure « plus haut = pire » (LCP, taux d'erreur).
 * Régression si l'après dépasse l'avant d'au moins `ratio` (défaut +20 %). Pur.
 */
export function assessRegression(
  before: number | null,
  after: number | null,
  ratio = 1.2,
): RegressionVerdict {
  if (before == null || after == null || before <= 0) return { regressed: false, deltaPct: null };
  const deltaPct = Math.round(((after - before) / before) * 100);
  return { regressed: after >= before * ratio, deltaPct };
}

export interface VerdictDeploiement {
  /**
   * `regression` : un signal a franchi son seuil ; `incomplet` : une des deux
   * fenêtres ne permet pas de juger (aucune page vue, aucune mesure LCP) ;
   * `stable` : les deux côtés sont mesurés et rien n'a franchi le seuil.
   */
  etat: "regression" | "incomplet" | "stable";
  lcp: RegressionVerdict;
  erreurs: RegressionVerdict;
  /** Aucune erreur avant, au moins une après : une régression, même sans pourcentage. */
  erreursApparues: boolean;
  /** Ce qui manque pour juger, en clair ; vide sauf en `incomplet`. */
  manques: string[];
}

/**
 * Verdict du panneau « Déploiements & régression ». PUR.
 *
 * « Aucune régression » ne s'écrit que si les deux fenêtres ont été mesurées :
 * sans page vue avant le déploiement, ou sans mesure LCP d'un côté, on ne sait
 * pas — et le dire en vert, c'était présenter une inconnue comme un fait.
 */
export function verdictDeploiement(impact: DeployImpact): VerdictDeploiement {
  const lcp = assessRegression(impact.lcp_before, impact.lcp_after);
  const erreurs = assessRegression(impact.errors_before, impact.errors_after);
  const erreursApparues = impact.errors_before === 0 && (impact.errors_after ?? 0) > 0;
  const manques: string[] = [];
  if (impact.pageviews_before === 0) manques.push("aucune page vue dans les 2 h avant");
  if (impact.pageviews_after === 0) manques.push("aucune page vue dans les 2 h après");
  if (impact.pageviews_before > 0 && impact.lcp_before == null) manques.push("aucune mesure LCP avant");
  if (impact.pageviews_after > 0 && impact.lcp_after == null) manques.push("aucune mesure LCP après");
  const regression = lcp.regressed || erreurs.regressed || erreursApparues;
  return {
    etat: regression ? "regression" : manques.length ? "incomplet" : "stable",
    lcp,
    erreurs,
    erreursApparues,
    manques: regression ? [] : manques,
  };
}

export interface VersionRow {
  version: string;
  sessions: number;
  lcp: number | null;
  inp: number | null;
  erreurs: number;
  /** Sessions ayant produit au moins une erreur — la base du taux affiché. */
  sessionsEnErreur: number;
}

// ─────────── Lecture d'une comparaison de versions : décisions PURES ───────────
// Extraites du composant pour être vérifiables. Chacune répond à une question où
// l'erreur ne lève rien et se lit comme un résultat : afficher un tableau d'une
// ligne, désigner la mauvaise référence, ou montrer un écart de « +0 % » sur la
// ligne de référence elle-même.

/**
 * Y a-t-il quelque chose à COMPARER ?
 *
 * Sous deux versions, non : une « comparaison » d'une seule ligne n'apprend
 * rien, et sur une app qui ne renseigne pas `release` elle afficherait
 * éternellement « (non renseignée) » comme s'il s'agissait d'un résultat.
 */
export function comparable(rows: VersionRow[]): boolean {
  return rows.length >= 2;
}

/**
 * La version de RÉFÉRENCE : la plus vue, pas la plus récente.
 *
 * C'est celle dont les chiffres sont les plus solides. Et « la plus récente »
 * n'est pas calculable de façon fiable : « 1.10 » vient après « 1.9 » alors que
 * l'ordre alphabétique dit l'inverse, et un SHA git n'a aucun ordre. La requête
 * classe déjà par volume décroissant ; on ne re-trie pas, on prend la première.
 */
export function versionReference(rows: VersionRow[]): VersionRow | null {
  return rows.length ? rows[0] : null;
}

/**
 * Part des sessions ayant rencontré au moins une erreur — pas le nombre
 * d'erreurs. Entre deux versions, ce qui se compare est la probabilité qu'un
 * visiteur tombe sur un bug, pas le nombre de fois où la même exception se
 * répète dans une boucle. `null` si la version n'a aucune session : une
 * division par zéro afficherait « 0 % », c'est-à-dire « aucune erreur ».
 */
export function tauxErreur(r: VersionRow): number | null {
  return r.sessions > 0 ? r.sessionsEnErreur / r.sessions : null;
}

/**
 * Écart de taux d'erreur face à la référence, EN POINTS de pourcentage.
 *
 * `null` sur la ligne de référence elle-même : « +0,0 pt » face à soi-même se
 * lit comme une mesure, alors que c'est une tautologie. `null` aussi dès qu'un
 * des deux taux manque — comparer à rien donnerait l'autre taux tel quel,
 * présenté comme un écart.
 */
export function ecartPoints(r: VersionRow, ref: VersionRow): number | null {
  if (r.version === ref.version) return null;
  const a = tauxErreur(r);
  const b = tauxErreur(ref);
  return a == null || b == null ? null : (a - b) * 100;
}
