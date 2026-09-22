// Robot et réel (§ 5.7) : règles pures qui interprètent les lectures de
// lib/queries-v2.ts (fraîcheur du robot, cartes par couple). Sans accès base.
import { rating2026, type Rating } from "./rating";
import type { CorrCardRow, SyntheticFreshnessRow } from "./queries-v2";

export type RetardRobot =
  /** Aucun passage sur la plage : l'écran dit « Non collecté », pas « robot ok ». */
  | { etat: "aucun_passage" }
  /** Moins de deux passages d'un même scénario : rythme inconnu, bandeau quand même. */
  | { etat: "intervalle_inconnu"; retardMs: number }
  /** Dernier passage plus vieux que deux intervalles médians : bandeau. */
  | { etat: "en_retard"; retardMs: number; intervalleMs: number }
  /** Passage récent : aucun bandeau. */
  | { etat: "a_jour"; retardMs: number; intervalleMs: number };

/**
 * Retard du robot à la fin de la plage (CR1) : `to − dernier`, comparé à DEUX fois
 * l'intervalle médian entre passages. Un seul intervalle manqué peut être une
 * exécution lente ; deux disent que le robot ne tourne plus au rythme attendu.
 */
export function retardRobot(
  fraicheur: Pick<SyntheticFreshnessRow, "dernier" | "intervalle_median_s" | "passages">,
  toMs: number,
): RetardRobot {
  if (fraicheur.dernier === null) return { etat: "aucun_passage" };
  const retardMs = Math.max(0, toMs - fraicheur.dernier.getTime());
  if (fraicheur.passages < 2 || fraicheur.intervalle_median_s === null || fraicheur.intervalle_median_s <= 0) {
    return { etat: "intervalle_inconnu", retardMs };
  }
  const intervalleMs = fraicheur.intervalle_median_s * 1000;
  return retardMs >= 2 * intervalleMs
    ? { etat: "en_retard", retardMs, intervalleMs }
    : { etat: "a_jour", retardMs, intervalleMs };
}

/** Le bandeau de fraîcheur s'affiche-t-il ? (`aucun_passage` a son propre état.) */
export function bandeauRetard(r: RetardRobot): boolean {
  return r.etat === "en_retard" || r.etat === "intervalle_inconnu";
}

/**
 * Part du LCP réel mesurée sur des couples suivis par le robot (CR5) :
 * Σ `rum_lcp_n` des couples avec robot / Σ `rum_lcp_n` de tous les couples, entre
 * 0 et 1. Les MESURES s'additionnent entre routes ; les sessions, non (une session
 * visite plusieurs routes). `null` sans aucune mesure LCP : pas de dénominateur.
 */
export function partCouverte(cartes: readonly Pick<CorrCardRow, "rum_lcp_n" | "syn_latency_avg">[]): number | null {
  let couvertes = 0;
  let total = 0;
  for (const c of cartes) {
    const n = c.rum_lcp_n ?? 0;
    total += n;
    if (c.syn_latency_avg != null) couvertes += n;
  }
  return total === 0 ? null : couvertes / total;
}

const GRAVITE: Record<Rating, number> = { poor: 0, "needs-improvement": 1, good: 2 };

export type SansRobot<T> = T & { verdict: Rating | null; faible: boolean };

/**
 * Couples à trafic réel sans scénario robot (CR11), classés par GRAVITÉ : verdict
 * du LCP p75 (Mauvais d'abord), puis volume de mesures ; un couple sous l'effectif
 * minimal passe en fin, « échantillon faible », quel que soit son verdict.
 */
export function trierSansRobot<T extends Pick<CorrCardRow, "rum_lcp_n" | "rum_lcp_p75" | "syn_latency_avg">>(
  cartes: readonly T[],
  effectifMin = 30,
): SansRobot<T>[] {
  return cartes
    .filter((c) => c.syn_latency_avg == null && (c.rum_lcp_n ?? 0) > 0)
    .map((c) => ({
      ...c,
      verdict: c.rum_lcp_p75 == null ? null : rating2026("LCP", Number(c.rum_lcp_p75)),
      faible: (c.rum_lcp_n ?? 0) < effectifMin,
    }))
    .sort((a, b) => {
      if (a.faible !== b.faible) return a.faible ? 1 : -1;
      const ga = a.verdict ? GRAVITE[a.verdict] : 3;
      const gb = b.verdict ? GRAVITE[b.verdict] : 3;
      return ga - gb || (b.rum_lcp_n ?? 0) - (a.rum_lcp_n ?? 0);
    });
}
