// LE CHARGEUR DES RELEASES COMPARABLES (C11) — `app/api/releases/route.ts`.
//
// La barre de filtres est un composant CLIENT monté par le layout : un layout Next
// ne reçoit pas les paramètres d'URL, elle lit donc sa liste par une route
// (`GET /api/releases`). Cette route reste sur Vercel — le navigateur l'appelle,
// et console-api n'accepte aucune origine de navigateur — mais ce qu'elle lit
// passe par ce chargeur, comme un écran : à la bascule, `chargerEcran` l'envoie à
// console-api (`screens.releases`) et la route devient un relais serveur.
//
// Même contrat que les écrans : périmètre du principal, plage et filtres validés,
// releases DE L'OCCURRENCE (`comparaisonVersions`), triées par sessions. Un filtre
// que ces mesures ne portent pas n'est pas une panne : la liste est indisponible,
// et le dit.
import { releasesComparables } from "../comparaison";
import { filtersOfQuery } from "../filters";
import { comparaisonVersions } from "../queries-deploys";
import { UnsupportedFilterError } from "../query-compiler";
import { contractErrorStatus, parseAnalyticsQuery } from "../query-contract";
import { urlDeLaPage, type Chargeur } from "./commun";

export const chargerReleases = (async (principal, sp) => {
  if (!principal) return { etat: "sans_session" } as const;
  const parsed = parseAnalyticsQuery(urlDeLaPage(sp), { principal, nowMs: Date.now() });
  if (!parsed.ok) return { etat: "refus", statut: contractErrorStatus(parsed.error), raison: parsed.error.message } as const;
  try {
    const { rows } = await comparaisonVersions(filtersOfQuery(parsed.value), 12);
    return { etat: "ok", releases: releasesComparables(rows), raison: null } as const;
  } catch (e) {
    if (e instanceof UnsupportedFilterError) return { etat: "ok", releases: null, raison: e.message } as const;
    throw e;
  }
}) satisfies Chargeur<unknown>;
