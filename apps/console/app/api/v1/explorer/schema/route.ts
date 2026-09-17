// GET /api/v1/explorer/schema — registre public des capacités de l'Explorer (P6.4).
//
// Ce qu'il publie : jeux de données, mesures, unités, dimensions RÉELLEMENT
// disponibles et limites du contrat. Ce qu'il ne publie pas : aucune table, aucune
// colonne, aucun secret, et AUCUNE valeur client — un inventaire de releases ou
// d'environnements ferait fuir un tenant vers un autre. Les valeurs se demandent
// app par app et fenêtre par fenêtre, par les sélecteurs de dimension (P6.1).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { explorerSchema } from "@/lib/queries-explorer";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ principal }) =>
  explorerSchema({
    // Un jeton d'API est en lecture seule et un viewer n'écrit pas de tableau de
    // bord transverse : le registre annonce le droit tel qu'il est, pour que le
    // builder n'offre pas un bouton qui échouera.
    saveToDashboard: principal.kind === "session" && principal.role === "admin",
  }),
);
