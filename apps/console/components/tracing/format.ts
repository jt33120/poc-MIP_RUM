// Helpers de formatage partagés par la page Tracing et ses sous-composants.
// Rendu 100 % serveur, aucune dépendance. Extrait de app/tracing/page.tsx.

/** Formate une durée en millisecondes ("— " si valeur absente). */
export const fmtMs = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(Number(v))} ms`;
