// GET /api/v1/mobile/summary — résumé d'un périmètre React Native (P7.5).
//
// Reprend le filtre et la plage de P6 tels quels, plus `platform`, qui n'est pas
// une dimension nouvelle mais le système d'exploitation du contrat restreint aux
// deux valeurs qu'un runtime React Native peut rendre.
//
// TOUTE MÉTRIQUE NON DISPONIBLE VAUT `null`, jamais 0. Crashes natifs, ANR et
// démarrage natif ne sont pas seulement absents de cette réponse : ils n'y ont
// aucun champ. Les annoncer à 0 laisserait croire qu'ils ont été mesurés.
// `data.capabilities` dit, capacité par capacité, ce qui est collecté, ce qui ne
// l'est pas, et ce dont personne n'a rien dit.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { parsePlatform, PLATFORM_OS } from "@/lib/mobile-capabilities";
import { mobileSummary } from "@/lib/queries-mobile";
import { filtersOfQuery } from "@/lib/filters";
import { intersectQuery } from "@/lib/query-contract";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { dimensionSchema } from "@/lib/query-schema";
import { checkSurface, surfaceFor } from "@/lib/surfaces";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const platform = parsePlatform(searchParams.get("platform"));
  // INTERSECTION, jamais remplacement : `?os=iOS&platform=android` rend zéro
  // ligne, ce qui est la réponse exacte, et non « android » par écrasement.
  const query = platform
    ? intersectQuery(filters.query, {
        conditions: [{ dimension: "os", operator: "eq", value: PLATFORM_OS[platform] }],
      })
    : filters.query;

  // L'API applique la MÊME liste de dimensions que l'écran. Sans ce contrôle,
  // `?route=/panier` serait accepté et ignoré : le taux renvoyé décrirait alors
  // une population que l'appelant ne croit pas avoir demandée.
  const surface = surfaceFor("/mobile");
  if (surface) {
    const verdict = checkSurface(query, surface, await dimensionSchema());
    if (!verdict.ok) throw new UnsupportedFilterError(verdict.error);
  }

  return mobileSummary(filtersOfQuery(query));
});
