// GET /api/v1/trends — SERVIE PAR LE SERVICE `api` SEUL (`ROUTES_SERVICE_SEUL` de
// `services/api/routeur.mjs`) ; la route de la console la transmet
// (`app/api/v1/trends/route.ts`, `lib/api/service-seul.ts`) et n'exécute jamais ce
// module : la console n'y gagne aucune lecture de base.
//
// Tendances des cinq Core Web Vitals sur les 14 jours COMPLETS (fuseau de l'app,
// journée en cours exclue) : pente et bruit, échéance contre la borne « Bon »,
// rupture datée (test de Pettitt) ou refus chiffré, déploiement coïncident. Le
// calcul est celui de l'écran « Tendances » (`@mip/stats`) ; la réponse est
// assemblée par `lib/api/tendances.ts`.
//
// FENÊTRE FIXE. `period`, `from` et `to` ne s'appliquent pas : l'écran le dit dans
// un bandeau, l'API le refuse (400) plutôt que de rendre une réponse qui ignore un
// paramètre qu'on lui a passé. Les autres filtres du contrat (app, appareil,
// dimensions, bots, apps internes) s'appliquent à la série, comme sur l'écran.
import { VITAUX } from "../../fmt-ids";
import { fuseauDe } from "../../fuseau";
import { listDeploys } from "../../queries-deploys";
import { dailyVitalsSeries } from "../../queries-grid";
import { instantDe, jourDans } from "../../series";
import { handle } from "../handle";
import { ApiHttpError, preflight } from "../respond";
import { tendancesDesVitals } from "../tendances";

export const OPTIONS = preflight;

/** Les paramètres de plage que cette route refuse : sa fenêtre est fixe. */
const PLAGE_REFUSEE = ["period", "from", "to"] as const;

export const GET = handle(async ({ filters, searchParams }) => {
  const passe = PLAGE_REFUSEE.find((p) => searchParams.has(p));
  if (passe) {
    throw new ApiHttpError(
      400,
      `la fenêtre des tendances est fixe (14 jours complets, journée en cours exclue) : « ${passe} » ne s'applique pas`,
      { code: "range_not_applicable", parameter: passe },
    );
  }
  const f = filters.legacy;
  const [fuseau, series, deploys] = await Promise.all([
    fuseauDe(filters.query.scope.requestedApp),
    dailyVitalsSeries(f, VITAUX, { exclureAujourdhui: true }),
    // Les marqueurs ne servent qu'à dire qu'un déploiement tombe à ± 1 jour d'une
    // rupture : les 20 derniers du périmètre, comme l'écran.
    listDeploys(f, 20),
  ]);
  const deploiements = deploys.map((d) => ({ jour: jourDans(instantDe(d.ts), fuseau), version: d.version }));
  return tendancesDesVitals(series, deploiements, fuseau);
});
