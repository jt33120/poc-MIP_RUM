// Voie A inc.1 — capture des spans intra-trace (profondeur « cause backend »).
// L'ingestion doit router les spans internes d'une trace (requête DB, sous-appel)
// vers rum_span tier='detail', SANS confondre avec les spans navigateur (qui
// portent toujours mip.session_id) ni avec les spans SERVER (déjà routés 'back').
import { describe, expect, it } from "vitest";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const sv = (s: string) => ({ stringValue: s });
const iv = (n: number) => ({ intValue: String(n) });

// une trace backend : http.server (SERVER) + une requête DB (CLIENT) enfant.
const payload = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }] },
      scopeSpans: [
        {
          spans: [
            {
              name: "GET /api/search",
              kind: 2, // SERVER
              traceId: "trace-1",
              spanId: "server-1",
              startTimeUnixNano: "1760000000000000000",
              endTimeUnixNano: "1760000000120000000",
              attributes: [
                { key: "http.request.method", value: sv("GET") },
                { key: "http.route", value: sv("/api/search") },
                { key: "http.response.status_code", value: iv(200) },
              ],
            },
            {
              name: "pg.query",
              kind: 3, // CLIENT (requête DB)
              traceId: "trace-1",
              parentSpanId: "server-1",
              spanId: "db-1",
              startTimeUnixNano: "1760000000030000000",
              endTimeUnixNano: "1760000000090000000",
              attributes: [
                { key: "db.system", value: sv("postgresql") },
                { key: "db.operation", value: sv("SELECT") },
                {
                  key: "db.statement",
                  value: sv("select * from users where email = 'jean@x.fr'"),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("flattenOtlp — spans intra-trace (detail)", () => {
  const rows = flattenOtlp(payload as never);

  it("route le SERVER en 'back' et la requête DB en 'detail'", () => {
    expect(rows.spans).toHaveLength(2);
    const back = rows.spans.find((s) => s.tier === "back");
    const detail = rows.spans.find((s) => s.tier === "detail");
    expect(back?.route).toBe("/api/search");
    expect(back?.kind).toBe("server");
    expect(detail).toBeTruthy();
    expect(detail?.kind).toBe("db");
    expect(detail?.parent_span_id).toBe("server-1");
    expect(detail?.duration_ms).toBe(60);
    expect(rows.rejected).toBe(0);
  });

  it("scrub PII dans le libellé du span DB (db.statement)", () => {
    const detail = rows.spans.find((s) => s.tier === "detail");
    expect(detail?.name).toContain("[email]");
    expect(detail?.name).not.toContain("jean@x.fr");
  });

  it("n'aspire jamais un span navigateur (mip.session_id présent) en detail", () => {
    const browser = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }] },
          scopeSpans: [
            {
              spans: [
                {
                  name: "pageview",
                  traceId: "t2",
                  spanId: "b2",
                  startTimeUnixNano: "1760000000000000000",
                  attributes: [{ key: "mip.session_id", value: sv("s2") }],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = flattenOtlp(browser as never);
    expect(r.spans).toHaveLength(0); // pas de detail parasite
    expect(r.pageviews).toHaveLength(1); // routé normalement
  });
});
