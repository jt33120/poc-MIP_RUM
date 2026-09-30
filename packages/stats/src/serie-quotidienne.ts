// UNE SÉRIE QUOTIDIENNE ANALYSÉE D'UN BLOC — tendance, échéance, rupture datée.
//
// POURQUOI UN MODULE DE PLUS. Trois lecteurs posent la même question à la même
// série de quatorze jours : l'écran « Tendances » (`/forecast`), la Vue d'ensemble
// (« et depuis quand ? ») et `GET /api/v1/trends` (et donc le serveur MCP). Chacun
// enchaînait à la main `tendance` → échéance → `daterRupture` →
// `deploiementCoincident` ; une étape oubliée ou un seuil recopié d'un côté, et
// l'écran et l'API diraient deux choses de la même série. L'enchaînement est
// écrit ici, une fois.
//
// DEUX SEUILS D'EFFECTIF, ÉCRITS TOUS LES DEUX. La droite ne retient que les jours
// d'au moins 30 mesures (`MESURES_MIN_JOUR`) ; Pettitt, les jours d'au moins 13
// (`MESURES_MIN_JOUR_RUPTURE`, le minimum d'une p75). Ce ne sont pas les mêmes
// questions : une pente se lit sur des points stables, une marche se date dès
// qu'une p75 a un sens.
import { daterRupture, deploiementCoincident, type Datation, type DeploiementJour, type JourMesure } from "./rupture";
import { echeanceEcrite, echeanceSeuil, tendance, type Echeance, type Tendance } from "./tendance";
import type { Resultat } from "./types";

export interface AnalyseQuotidienne {
  tendance: Tendance;
  /** Dernière valeur RETENUE par la tendance : celle contre laquelle l'échéance se calcule. */
  courant: number | null;
  /** Sortie brute d'`echeanceSeuil` (pas avant franchissement) ; `null` sans borne. */
  eta: number | null;
  /** L'échéance qu'on a le droit d'écrire ; `null` pour une mesure sans seuil publié. */
  echeance: Echeance | null;
  /** La rupture datée, l'absence de rupture (un constat), ou le refus chiffré. */
  datation: Resultat<Datation>;
  /** Le déploiement à ± 1 jour de la rupture datée : une coïncidence de date, rien de plus. */
  deploiement: DeploiementJour | null;
}

/**
 * Analyse une série quotidienne ORDONNÉE, journée en cours exclue par l'appelant.
 *
 * @param serie un point par jour de la fenêtre, jours vides compris (`valeur: null`) :
 *   la droite se cale sur les RANGS de jour, un trou retiré décalerait les suivants
 * @param borne borne « Bon » incluse d'une mesure dont une valeur plus haute est
 *   pire ; absente (`null`) : ni échéance, ni verdict — le ratio d'erreurs n'a pas
 *   de seuil publié
 * @param deploiements marqueurs ramenés au jour de l'app, pour la coïncidence de date
 */
export function analyserSerieQuotidienne(
  serie: readonly JourMesure[],
  { borne = null, deploiements = [] }: { borne?: number | null; deploiements?: readonly DeploiementJour[] } = {},
): AnalyseQuotidienne {
  // Sans aucun effectif, toute valeur mesurée compte (comme `tendance(ys, null)`) ;
  // un effectif absent au milieu d'autres vaut, lui, un jour creux.
  const effectifs = serie.every((j) => j.effectif === undefined) ? null : serie.map((j) => j.effectif ?? null);
  const t = tendance(
    serie.map((j) => j.valeur),
    effectifs,
  );
  const courant = [...t.retenues].reverse().find((v) => v !== null) ?? null;
  const eta = borne === null ? null : echeanceSeuil(t.fit, courant, borne);
  const echeance = borne === null ? null : echeanceEcrite(eta, t, borne, serie.at(-1)?.jour);
  const datation = daterRupture(serie);
  const deploiement = datation.ok && datation.rupture ? deploiementCoincident(datation.rupture.jour, deploiements) : null;
  return { tendance: t, courant, eta, echeance, datation, deploiement };
}
