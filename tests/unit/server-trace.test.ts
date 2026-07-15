// Voie A inc.2 — instrumentation backend de la console. Parties pures : parsing
// du traceparent/tracestate W3C et construction des lignes rum_span (serveur +
// DB enfants) corrélées au trace_id du navigateur.
import { describe, expect, it } from "vitest";
import {
  buildServerSpanRows,
  parseTraceparent,
  sessionFromTracestate,
  sqlLabel,
  type TraceCtx,
} from "../../apps/console/lib/server-trace-core";

describe("parseTraceparent", () => {
  it("accepte un en-tête W3C valide", () => {
    const r = parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    expect(r).toEqual({ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" });
  });
  it("rejette null, format court, hex invalide et tout-zéro", () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent("00-abc-def")).toBeNull();
    expect(parseTraceparent("00-XYZ-b7ad6b7169203331-01")).toBeNull();
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeNull();
  });
});

describe("sessionFromTracestate", () => {
  it("extrait la session de mip=s:<id>", () => {
    expect(sessionFromTracestate("mip=s:sess-123")).toBe("sess-123");
    expect(sessionFromTracestate("other=1,mip=s:abc")).toBe("abc");
  });
  it("null si absent", () => {
    expect(sessionFromTracestate("other=1")).toBeNull();
    expect(sessionFromTracestate(null)).toBeNull();
  });
});

describe("sqlLabel", () => {
  it("normalise les blancs et tronque", () => {
    expect(sqlLabel("select   *\n  from users")).toBe("select * from users");
    expect(sqlLabel("x".repeat(120)).length).toBe(80);
  });
});

describe("buildServerSpanRows", () => {
  const ctx: TraceCtx = {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    parentSpanId: "b7ad6b7169203331",
    sessionId: "sess-1",
    startMs: 1_760_000_000_000,
    db: [
      { name: "select app_id from rum_session where session_id = $1", startMs: 1_760_000_000_005, durationMs: 8 },
      { name: "select seq, body from replay_chunk where session_id = $1", startMs: 1_760_000_000_015, durationMs: 22 },
    ],
  };
  let n = 0;
  const rows = buildServerSpanRows(ctx, { route: "/api/replay/:sessionId", method: "GET", status: 200, durationMs: 45 }, () => `id-${n++}`);

  it("émet 1 span serveur (back) + 1 span par requête DB (detail)", () => {
    expect(rows).toHaveLength(3);
    expect(rows[0].tier).toBe("back");
    expect(rows.filter((r) => r.tier === "detail")).toHaveLength(2);
  });

  it("corrèle tous les spans au trace_id du navigateur", () => {
    expect(new Set(rows.map((r) => r.trace_id))).toEqual(new Set([ctx.traceId]));
  });

  it("chaîne serveur -> navigateur, DB -> serveur", () => {
    const back = rows[0];
    expect(back.parent_span_id).toBe(ctx.parentSpanId); // serveur enfant du span client (navigateur)
    for (const d of rows.filter((r) => r.tier === "detail")) {
      expect(d.parent_span_id).toBe(back.span_id); // DB enfant du span serveur
      expect(d.kind).toBe("db");
    }
  });

  it("porte app_id dogfood, session et libellés", () => {
    expect(rows[0].app_id).toBe("mip-rum-console");
    expect(rows[0].name).toBe("GET /api/replay/:sessionId");
    expect(rows[0].status_code).toBe(200);
    expect(rows[0].session_id).toBe("sess-1");
    expect(rows[1].name).toContain("rum_session");
  });
});
