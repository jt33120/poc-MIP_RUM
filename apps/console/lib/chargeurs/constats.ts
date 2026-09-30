// LE CHARGEUR DES CONSTATS (refonte du monitoring, vague 3a) — sans écran encore.
//
// Les constats détectés par calcul (`signal_detecte`, migration-v101) qui
// recoupent la période de la page, triés par priorité décroissante. L'écran qui
// les montrera (vague 3b) reçoit ce que rend ce chargeur, tel quel ; il ne lit
// jamais la base (cliquet « console sans base »).
//
// Trois issues, toutes affichables : `absent` (v101 pas encore appliquée — un
// état vide propre, pas une erreur), la section en échec (lecture ratée, jamais
// « aucun constat »), ou la liste. Une liste VIDE ne veut pas dire « tout va
// bien » (A2 § 8.14) : l'écran écrit « Aucun constat sur la période ».
import { analyserFiltres } from "../filtres-ecran";
import { constatsDeLaPeriode } from "../queries-detections";
import { section, type Chargeur } from "./commun";

/** Le nombre de constats rendus au plus (la page en montre 5, A2 § 7.6). */
export const CONSTATS_MAX = 20;

export const chargerConstats = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const constats = await section(() => constatsDeLaPeriode(ecran.query, CONSTATS_MAX));
  return { etat: "ok", label: ecran.label, periode: { de: ecran.query.range.from, a: ecran.query.range.to }, constats } as const;
}) satisfies Chargeur<unknown>;
