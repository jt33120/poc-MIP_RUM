// LE CHARGEUR DE LA SÉRIE « observé / attendu » (refonte du monitoring, vague 3a)
// — sans écran encore.
//
// La p75 horaire d'un vital (`vital_horaire`, migration-v101) sur la période, pour
// UNE app et une route ('' = toutes), avec la bande attendue de chaque heure (la
// plage habituelle, A2 § 7.1). Paramètres d'URL : `vital` (LCP par défaut, l'un
// des cinq Core Web Vitals) et `route`.
//
// Une p75 ne se moyenne pas entre apps (A2 § 8.2) : sans app demandée et avec
// plusieurs apps au périmètre, le chargeur rend `une_app_requise`. Sans v101 :
// `absent`. Une heure sans mesure rend `p75: null`, jamais 0 ; une heure sans
// historique suffisant rend `attendu: null`, jamais une bande « en attendant ».
import { analyserFiltres } from "../filtres-ecran";
import { serieVitalHoraire } from "../queries-detections";
import { CORE_VITALS } from "../rating";
import { section, type Chargeur } from "./commun";

/** Le vital demandé, s'il est l'un des cinq ; LCP sinon. */
export function vitalDemande(valeur: unknown): string {
  return typeof valeur === "string" && CORE_VITALS.includes(valeur) ? valeur : "LCP";
}

/** La route demandée ('' = toutes routes), bornée comme une route en base. */
export function routeDemandee(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.slice(0, 512) : "";
}

export const chargerVitalHoraire = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const vital = vitalDemande(sp.vital);
  const route = routeDemandee(sp.route);
  const serie = await section(() => serieVitalHoraire(ecran.query, vital, route));
  return { etat: "ok", label: ecran.label, vital, route, serie } as const;
}) satisfies Chargeur<unknown>;
