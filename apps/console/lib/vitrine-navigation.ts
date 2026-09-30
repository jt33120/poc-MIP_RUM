// Le menu des pages publiques (30/09/2026) : trois entrées, une seule liste pour la
// barre de navigation, les routes et les chemins publics (lib/chemins-publics.ts).
//
//   Installation      les trois parcours de /installer, en documentation lisible sans
//                     compte (une page par parcours, valeurs d'exemple) ;
//   À faire           les hypothèses réductrices du POC, puis les chantiers qui restent ;
//   Graphe technique  le texte d'explication des anciennes pages (vitrine d'avant la
//                     refonte, dossier technique), rassemblé en attendant sa place.
//
// Fonction PURE, sans import de composant : le middleware (runtime edge) la lit.
import type { Parcours } from "@/lib/installer";

export const CHEMIN_INSTALLATION = "/presentation/installation";
export const CHEMIN_A_FAIRE = "/presentation/a-faire";
export const CHEMIN_GRAPHE = "/presentation/graphe-technique";

/** Le dépôt, public par choix : la barre y mène (bouton GitHub). */
export const DEPOT_GITHUB = "https://github.com/jt33120/poc-MIP_RUM";

/** Le segment d'URL d'un parcours : des mots lisibles, pas l'identifiant interne. */
export const SEGMENT_PARCOURS: Record<Parcours, string> = {
  snippet: "sdk-javascript",
  extension: "extension",
  serveur: "serveur",
};

export const cheminParcours = (p: Parcours) => `${CHEMIN_INSTALLATION}/${SEGMENT_PARCOURS[p]}`;

/** Le parcours d'un segment d'URL, ou `null` s'il n'en nomme aucun. */
export function parcoursDuSegment(segment: string): Parcours | null {
  const trouve = (Object.entries(SEGMENT_PARCOURS) as [Parcours, string][]).find(([, s]) => s === segment);
  return trouve ? trouve[0] : null;
}

/** Tous les chemins du menu, sous-pages comprises : chacun est public, et exact. */
export const CHEMINS_MENU: readonly string[] = [
  CHEMIN_INSTALLATION,
  ...Object.values(SEGMENT_PARCOURS).map((s) => `${CHEMIN_INSTALLATION}/${s}`),
  CHEMIN_A_FAIRE,
  CHEMIN_GRAPHE,
];
