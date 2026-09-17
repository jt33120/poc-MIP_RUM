// POST /api/v1/explorer/query — requête analytique générique (P6.4).
//
// Une LECTURE en POST : l'AST ne tient pas dans une query string. Même auth que les
// GET (jeton lecture seule ou session), corps ≤ 32 Kio, résultat borné. Un budget
// de lecture dépassé rend 503 `query_budget_exceeded` — jamais une série de zéros.
import { handleQuery } from "@/lib/api/handle";
import { preflight, ApiHttpError } from "@/lib/api/respond";
import { MAX_BODY_BYTES, explorerErrorStatus, parseExplorerQuery } from "@/lib/analytics-schema";
import { exploreAnalytics } from "@/lib/queries-explorer";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const POST = handleQuery(
  async ({ principal, body }) => {
    // Le périmètre est résolu ICI contre le principal SIGNÉ : le champ `app` du
    // corps est une DEMANDE, jamais une autorisation.
    const parsed = parseExplorerQuery(body, { principal, nowMs: Date.now() });
    if (!parsed.ok) {
      const { code, message, parameter, dimension } = parsed.error;
      throw new ApiHttpError(explorerErrorStatus(parsed.error), message, {
        code,
        ...(parameter ? { parameter } : {}),
        ...(dimension ? { dimension } : {}),
      });
    }
    const { meta, data } = await exploreAnalytics(parsed.value);
    return { meta: meta as unknown as Record<string, unknown>, data };
  },
  { maxBytes: MAX_BODY_BYTES },
);
