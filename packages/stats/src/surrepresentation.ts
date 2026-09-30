// Valeurs sur-représentées, test PUBLIÉ (P*.6, plan § 7.2) — logique PURE, sans
// accès base (RM1), testée par tests/unit/surrepresentation.test.ts.
//
// CE QUE LES AUTRES NE PUBLIENT PAS. Datadog Watchdog Insights signale des paires
// `clé:valeur` « statistically overrepresented » parmi les erreurs, et l'onglet
// « Outliers » d'une issue fait de même, sans jamais publier le test ni le seuil.
// Ici : test exact de Fisher UNILATÉRAL (sur-représentation seulement), correction
// de Benjamini-Hochberg à 5 % sur TOUTES les valeurs testées de l'écran, effectifs
// écrits, nombre de valeurs testées écrit.
//
// POURQUOI FISHER ET PAS UN χ². Les tables sont petites (12 sessions touchées sur
// 210) : l'approximation du χ² y est fausse, l'hypergéométrique est exacte et tient
// dans `lois.ts` (`hypergeomQueue`, déjà testée contre des valeurs tabulées).
//
// POURQUOI BENJAMINI-HOCHBERG. Six dimensions × douze valeurs = 72 tests par écran :
// à 5 % par test, quatre « découvertes » seraient du hasard. BH borne le taux de
// FAUSSES découvertes à 5 % de celles qu'on retient, et non le risque par test.
//
// RM5 — AUCUN TEXTE DE CE MODULE NE PARLE DE CAUSE. La phrase « Association
// observée, pas une … » est écrite par le composant qui l'affiche, pas ici : un
// test de gabarit interdit le mot dans tout ce que ce module produit.
//
// RM6 — UNE SEULE POPULATION. Les unités comptées sont des sessions, OU des
// mesures, OU des occurrences ; l'appelant le dit par `unites`, et une session à
// 50 occurrences compte une fois.
import { hypergeomQueue } from "./lois";
import { refus, type Resultat } from "./types";

/** Valeur « Inconnu » : affichée, JAMAIS testée (elle agrège des manques différents). */
export const VALEUR_INCONNUE = "Inconnu";

/** Volume minimal d'unités touchées sur l'écran, sans quoi aucun test n'est tenté. */
export const TOUCHES_MIN_TEST = 10;
/** Volume minimal d'unités touchées portant la valeur, sans quoi ELLE n'est pas testée. */
export const TOUCHES_VALEUR_MIN = 3;
/** Volume minimal d'unités de base sur l'écran. */
export const BASE_MIN_TEST = 30;
/** Taux de fausses découvertes de la correction de Benjamini-Hochberg. */
export const FDR = 0.05;

/** La règle, écrite à côté du résultat (RM4). */
export const REGLE_SURREPRESENTATION =
  "test exact de Fisher unilatéral, correction de Benjamini-Hochberg (fausses découvertes 5 %)";

/** Nom des deux populations comptées, au pluriel (RM6). */
export interface Unites {
  /** « sessions touchées », « mesures LCP Mauvais ». */
  touchees: string;
  /** « sessions », « mesures ». */
  base: string;
}

export const UNITES_SESSIONS: Unites = { touchees: "sessions touchées", base: "sessions" };

/** Une valeur d'une dimension : ses touchés et sa base (B3). */
export interface ValeurObservee {
  valeur: string;
  nTouches: number;
  nBase: number;
}

/** Une dimension de l'écran et ses valeurs (`browser`, `release`, `route`…). */
export interface DimensionObservee {
  cle: string;
  valeurs: ValeurObservee[];
}

/** Ce qu'une valeur retenue vaut, pour `ContrastBars.test` et `InsightStrip`. */
export interface TestValeur {
  pBrut: number;
  pAjuste: number;
  retenu: boolean;
}

export interface DimensionTestee {
  cle: string;
  /** Par valeur : son test. Une valeur absente n'a pas été testée (volume, « Inconnu »). */
  tests: Record<string, TestValeur>;
}

export interface AnalyseRetenue {
  cle: string;
  valeur: string;
  nTouches: number;
  nBase: number;
  test: TestValeur;
}

export interface Analyse {
  /** Nombre de valeurs effectivement testées, toutes dimensions confondues (RM4). */
  testees: number;
  regle: string;
  dimensions: DimensionTestee[];
  /** Valeurs retenues, de la plus significative à la moins. */
  retenues: AnalyseRetenue[];
}

/**
 * p unilatéral du test exact de Fisher pour la sur-représentation d'une valeur.
 *
 * Table 2 × 2 : (touchée / non touchée) × (valeur v / autre valeur). Sous
 * l'hypothèse nulle, les `touches` unités touchées sont un tirage SANS REMISE dans
 * les `base` unités de la fenêtre, dont `baseV` portent v : le nombre de touchées
 * portant v suit une hypergéométrique, et p = P(X ≥ touchesV) est exactement le
 * Fisher unilatéral. `null` quand la table est incohérente (touchés hors de la
 * base : la base n'a pas été lue sur la même population).
 */
export function fisherUnilateral(touchesV: number, touches: number, baseV: number, base: number): number | null {
  const entiers = [touchesV, touches, baseV, base].every((v) => Number.isInteger(v) && v >= 0);
  if (!entiers || base === 0) return null;
  if (touches > base || baseV > base || touchesV > touches || touchesV > baseV) return null;
  return hypergeomQueue(touchesV, base, baseV, touches);
}

/**
 * Correction de Benjamini-Hochberg : p ajustés dans l'ORDRE REÇU.
 *
 * p ajusté du rang i (p triés croissants, m tests) = min sur j ≥ i de `p_j × m / j`,
 * borné à 1 : la forme monotone, celle que publient les tables. Une valeur est
 * retenue quand son p ajusté ne dépasse pas `fdr`.
 */
export function benjaminiHochberg(ps: readonly number[], fdr = FDR): { pAjuste: number[]; retenu: boolean[] } {
  const m = ps.length;
  if (m === 0) return { pAjuste: [], retenu: [] };
  const rangs = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const ajustes = new Array<number>(m);
  let courant = 1;
  for (let rang = m; rang >= 1; rang--) {
    const { p, i } = rangs[rang - 1];
    courant = Math.min(courant, (p * m) / rang);
    ajustes[i] = Math.min(1, courant);
  }
  return { pAjuste: ajustes, retenu: ajustes.map((p) => p <= fdr) };
}

/** Raison d'un refus de test, écrite avec ses effectifs (RM2). */
function raisonVolume(observe: number, requis: number, unite: string): string {
  return `pas de test : ${observe} ${unite}, ${requis} requises`;
}

/**
 * Teste toutes les valeurs de toutes les dimensions de l'écran, EN UNE FOIS : la
 * correction porte sur la famille entière (P*.6), pas dimension par dimension.
 *
 * Trois volumes minimaux, dans cet ordre (RM2 : un refus dit ce qui manque) :
 *   - moins de `TOUCHES_MIN_TEST` unités touchées sur l'écran → refus chiffré ;
 *   - moins de `BASE_MIN_TEST` unités de base → refus chiffré ;
 *   - moins de `TOUCHES_VALEUR_MIN` touchées portant la valeur → la valeur n'entre
 *     pas dans la famille testée (elle reste affichée, sans étiquette).
 *
 * « Inconnu » n'est jamais testé : il agrège des causes de manque différentes (un
 * champ absent avant v75 et un champ vide y tombent ensemble), et un test sur ce
 * mélange ne dirait rien.
 */
export function analyserSurrepresentation(
  dimensions: readonly DimensionObservee[],
  totaux: { touches: number; base: number },
  unites: Unites = UNITES_SESSIONS,
  fdr = FDR,
): Resultat<Analyse> {
  const { touches, base } = totaux;
  if (!(touches >= TOUCHES_MIN_TEST)) {
    return refus(raisonVolume(touches, TOUCHES_MIN_TEST, unites.touchees), {
      requis: TOUCHES_MIN_TEST,
      observe: touches,
      unite: unites.touchees,
    });
  }
  if (!(base >= BASE_MIN_TEST)) {
    return refus(raisonVolume(base, BASE_MIN_TEST, unites.base), {
      requis: BASE_MIN_TEST,
      observe: base,
      unite: unites.base,
    });
  }

  // Famille de tests de l'écran : une entrée par valeur candidate, dimensions mêlées.
  const candidates: { cle: string; valeur: ValeurObservee; p: number }[] = [];
  for (const dim of dimensions) {
    for (const valeur of dim.valeurs) {
      if (valeur.valeur === VALEUR_INCONNUE) continue;
      if (!(valeur.nTouches >= TOUCHES_VALEUR_MIN)) continue;
      const p = fisherUnilateral(valeur.nTouches, touches, valeur.nBase, base);
      if (p === null) continue;
      candidates.push({ cle: dim.cle, valeur, p });
    }
  }
  const { pAjuste, retenu } = benjaminiHochberg(
    candidates.map((c) => c.p),
    fdr,
  );

  const parDimension = new Map<string, DimensionTestee>(dimensions.map((d) => [d.cle, { cle: d.cle, tests: {} }]));
  const retenues: AnalyseRetenue[] = [];
  candidates.forEach((c, i) => {
    const test: TestValeur = { pBrut: c.p, pAjuste: pAjuste[i], retenu: retenu[i] };
    parDimension.get(c.cle)!.tests[c.valeur.valeur] = test;
    if (test.retenu) {
      retenues.push({ cle: c.cle, valeur: c.valeur.valeur, nTouches: c.valeur.nTouches, nBase: c.valeur.nBase, test });
    }
  });
  retenues.sort((a, b) => a.test.pAjuste - b.test.pAjuste);

  return {
    ok: true,
    testees: candidates.length,
    regle: `${REGLE_SURREPRESENTATION} ; ${TOUCHES_MIN_TEST} ${unites.touchees} au moins, ${TOUCHES_VALEUR_MIN} par valeur, ${BASE_MIN_TEST} ${unites.base} de base`,
    dimensions: [...parDimension.values()],
    retenues,
  };
}

/** « 0,02 » — deux chiffres significatifs suffisent à lire un p ajusté. */
export function formaterP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p > 0 && p < 0.0001) return "< 0,0001";
  return p.toLocaleString("fr-FR", { maximumSignificantDigits: 2 });
}

/**
 * La phrase publiée à côté d'une valeur retenue (RM3, RM4) : les deux effectifs,
 * les deux parts, le test, le p ajusté et le nombre de valeurs testées.
 *
 * « Safari : 9 des 12 sessions touchées (75 %) contre 63 des 210 sessions (30 %).
 *   Test exact de Fisher, p ajusté = 0,02 sur 14 valeurs testées. »
 *
 * Le composant qui l'affiche ajoute, lui, la réserve d'interprétation (RM5).
 */
export function phraseSurrepresentation(
  ligne: { valeur: string; nTouches: number; nBase: number; test: Pick<TestValeur, "pAjuste"> },
  totaux: { touches: number; base: number },
  testees: number,
  pct: (v: number) => string,
  unites: Unites = UNITES_SESSIONS,
): string {
  const partTouches = totaux.touches > 0 ? pct(ligne.nTouches / totaux.touches) : "—";
  const partBase = totaux.base > 0 ? pct(ligne.nBase / totaux.base) : "—";
  return (
    `${ligne.valeur} : ${ligne.nTouches} des ${totaux.touches} ${unites.touchees} (${partTouches}) ` +
    `contre ${ligne.nBase} des ${totaux.base} ${unites.base} (${partBase}). ` +
    `Test exact de Fisher, p ajusté = ${formaterP(ligne.test.pAjuste)} sur ${testees} valeur${testees > 1 ? "s" : ""} testée${testees > 1 ? "s" : ""}.`
  );
}
