// LE CHARGEUR DE L'ÉCRAN « Rétention » (C5) — `app/retention/page.tsx`.
//
// Les cohortes de visiteurs identifiés sur la fenêtre choisie (`weeks`), leur
// échantillonnage (S7), et — sans condition d'appareil — une série par appareil
// (B31 : la tablette est lue). Chaque lecture est indépendante (F02).
import { filtreAppareil } from "../cohorts";
import { analyserFiltres } from "../filtres-ecran";
import { retentionCohorts } from "../queries-cohorts";
import { samplingSessions } from "../queries-sessions";
import { section, type Chargeur, type ParametresEcran } from "./commun";

/** Fenêtres proposées, en semaines (§ 5.17.3, R1). */
export const FENETRES = [4, 8, 12, 26] as const;
export const FENETRE_DEFAUT = 8;

// B31 : la tablette est lue (lecture sur le contrat) ; trois séries, sous le plafond de cinq.
export const APPAREILS = [
  { cle: "desktop", libelle: "Ordinateurs" },
  { cle: "mobile", libelle: "Mobiles" },
  { cle: "tablet", libelle: "Tablettes" },
] as const;

/**
 * `weeks` est un réglage de l'écran (§ 3.1) : une valeur hors des fenêtres
 * proposées est ignorée ET signalée, jamais appliquée à moitié. La MÊME fonction
 * pour le chargeur (quoi lire) et la page (quoi afficher).
 */
export function fenetreDeRetention(sp: ParametresEcran) {
  const brut = typeof sp.weeks === "string" ? sp.weeks : null;
  const lu = brut === null ? null : Number(brut);
  const weeks = lu !== null && (FENETRES as readonly number[]).includes(lu) ? lu : FENETRE_DEFAUT;
  const ignore =
    brut !== null && weeks !== lu
      ? `Réglage d'affichage ignoré : weeks=${brut.slice(0, 40)} (fenêtres proposées : ${FENETRES.join(", ")} semaines).`
      : null;
  return { weeks, ignore };
}

export const chargerRetention = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/retention");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  // Façade P4/P5 : la tablette y figure (l'appareil filtré se lit dans `device`).
  const f = ecran.deviceFilters;
  const { weeks } = fenetreDeRetention(sp);
  // Toute condition d'appareil, `device=` OU segment : une condition de segment se
  // cumulerait avec chaque série et la viderait.
  const appareilFiltre = filtreAppareil(ecran.query.filters);
  const [cohortes, echantillonnage, parAppareil] = await Promise.all([
    section(() => retentionCohorts(f, weeks)),
    // S7 : sessions identifiées lues par les cohortes sur les N semaines choisies.
    section(() => samplingSessions(f, { population: { lecture: "cohortes", semaines: weeks } })),
    appareilFiltre
      ? Promise.resolve(null)
      : section(() => Promise.all(APPAREILS.map((a) => retentionCohorts(f, weeks, { appareil: a.cle })))),
  ]);
  return { etat: "ok", query: ecran.query, label: ecran.label, cohortes, echantillonnage, parAppareil } as const;
}) satisfies Chargeur<unknown>;
