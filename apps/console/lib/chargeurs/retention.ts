// LE CHARGEUR DE L'ÉCRAN « Rétention » (C5) — `app/retention/page.tsx`.
//
// Les cohortes de visiteurs identifiés sur la fenêtre choisie (`weeks`), leur
// échantillonnage (S7), et — sans condition d'appareil — une série par appareil
// (B31 : la tablette est lue). Chaque lecture est indépendante (F02).
import { filtreAppareil } from "../cohorts";
import { analyserFiltres } from "../filtres-ecran";
import { retentionCohorts } from "../queries-cohorts";
import { retentionDays } from "../queries-explorer";
import { samplingSessions } from "../queries-sessions";
import { section, type Chargeur, type ParametresEcran } from "./commun";

/** Fenêtres prévues, en semaines (§ 5.17.3, R1) ; seules celles que l'historique couvre sont proposées. */
export const FENETRES = [4, 8, 12, 26] as const;
export const FENETRE_DEFAUT = 8;

/**
 * Les fenêtres que l'HISTORIQUE CONSERVÉ peut remplir. La purge garde
 * `retentionDays()` jours (30 par défaut) : sur 30 jours, « 12 semaines » et
 * « 26 semaines » ne montraient rien de plus que « 4 » (recette du 26/09/2026) —
 * un choix qui promet un recul que la base n'a pas. Une fenêtre passe si elle ne
 * dépasse l'historique que d'une semaine entamée au plus ; la plus courte reste
 * toujours proposée.
 */
export function fenetresDisponibles(jours: number = retentionDays()): number[] {
  const couvertes = FENETRES.filter((w) => w * 7 <= jours + 6);
  return couvertes.length > 0 ? couvertes : [FENETRES[0]];
}

/** La fenêtre par défaut : 8 semaines si l'historique la couvre, sinon la plus longue couverte. */
export function fenetreParDefaut(disponibles: readonly number[] = fenetresDisponibles()): number {
  return disponibles.includes(FENETRE_DEFAUT) ? FENETRE_DEFAUT : Math.max(...disponibles);
}

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
export function fenetreDeRetention(sp: ParametresEcran, jours: number = retentionDays()) {
  const disponibles = fenetresDisponibles(jours);
  const defaut = fenetreParDefaut(disponibles);
  const brut = typeof sp.weeks === "string" ? sp.weeks : null;
  const lu = brut === null ? null : Number(brut);
  const weeks = lu !== null && disponibles.includes(lu) ? lu : defaut;
  const ignore =
    brut !== null && weeks !== lu
      ? `Réglage d'affichage ignoré : weeks=${brut.slice(0, 40)} (fenêtres proposées : ${disponibles.join(", ")} semaines, ${jours} jours d'historique conservés).`
      : null;
  return { weeks, ignore, disponibles, defaut, jours };
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
