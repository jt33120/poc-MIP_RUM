// Parser OTLP partagé (ingestion) : mapping des types KeyValue, aplatissement,
// rejets, scrub PII, rating seuils 2026.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anyValue,
  flattenOtlp,
  rating2026,
} from "../../packages/backend/shared/otlp.mjs";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/otlp-sample.json"), "utf8"),
);

describe("anyValue — déstructuration des types OTLP", () => {
  it("stringValue", () => expect(anyValue({ stringValue: "x" })).toBe("x"));
  it("doubleValue", () => expect(anyValue({ doubleValue: 1.5 })).toBe(1.5));
  it("intValue numérique", () => expect(anyValue({ intValue: 250 })).toBe(250));
  it("intValue string (piège constaté en S1)", () =>
    expect(anyValue({ intValue: "250" })).toBe(250));
  it("boolValue", () => expect(anyValue({ boolValue: true })).toBe(true));
  it("null/undefined", () => expect(anyValue(undefined)).toBeNull());
});

describe("rating2026 — seuils mars 2026", () => {
  it.each([
    // LCP : bornes web.dev — 2500 « bon », 4000 « à améliorer » (E0)
    ["LCP", 2499, "good"],
    ["LCP", 2500, "good"],
    ["LCP", 2600, "needs-improvement"],
    ["LCP", 4001, "poor"],
    ["INP", 200, "good"],
    ["INP", 350, "needs-improvement"],
    ["INP", 501, "poor"],
    ["CLS", 0.09, "good"],
    ["CLS", 0.2, "needs-improvement"],
    ["CLS", 0.3, "poor"],
  ])("%s %d -> %s", (name, value, expected) => {
    expect(rating2026(name, value)).toBe(expected);
  });
  it("métrique inconnue -> null", () => expect(rating2026("FID", 50)).toBeNull());
});

// Le corpus complet du parseur vit dans dimensions.test.ts ; ici, le chemin de
// l'attribut jusqu'à la ligne de session.
describe("flattenOtlp — device_type déduit de l'user-agent (v33, P6.1)", () => {
  const sv = (s) => ({ stringValue: s });
  const payload = (resAttrs, spanAttrs) => ({
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }, ...resAttrs] },
        scopeSpans: [
          {
            spans: [
              {
                spanId: "s1",
                name: "webvital.LCP",
                startTimeUnixNano: "1760000000000000000",
                attributes: [
                  { key: "mip.session_id", value: sv("sess-x") },
                  { key: "webvital.name", value: sv("LCP") },
                  { key: "webvital.value", value: { doubleValue: 2100 } },
                  ...spanAttrs,
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  it("span sans mip.device_type + UA mobile -> session.device_type = mobile", () => {
    const rows = flattenOtlp(
      payload([{ key: "mip.user_agent", value: sv("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") }], []),
    );
    expect(rows.sessions[0].device_type).toBe("mobile");
  });

  // P6.1 : l'user-agent prime. Le SDK web déduit son indice du même user-agent,
  // avec une règle qui range les tablettes Android en « desktop ».
  it("un user-agent reconnu prime sur mip.device_type du SDK", () => {
    const rows = flattenOtlp(
      payload(
        [{ key: "mip.user_agent", value: sv("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36") }],
        [{ key: "mip.device_type", value: sv("desktop") }],
      ),
    );
    expect(rows.sessions[0].device_type).toBe("tablet");
  });

  it("un user-agent muet laisse l'indice du SDK décider", () => {
    const rows = flattenOtlp(
      payload([{ key: "mip.user_agent", value: sv("Mozilla/5.0 Test") }], [{ key: "mip.device_type", value: sv("desktop") }]),
    );
    expect(rows.sessions[0].device_type).toBe("desktop");
  });

  it("ni device_type ni UA -> null (pas d'invention)", () => {
    const rows = flattenOtlp(payload([], []));
    expect(rows.sessions[0].device_type).toBeNull();
  });
});

describe("flattenOtlp — aplatissement du payload fixture", () => {
  // `now` figé à l'ère de la fixture (juin 2026) : la garde anti-dérive ne doit
  // pas clamper ses timestamps (testée séparément dans otlp-clock-skew.test.ts).
  const rows = flattenOtlp(fixture, { now: Date.parse("2026-06-10T15:00:00Z") });

  it("extrait 2 métriques, 1 erreur, 1 pageview, 1 session", () => {
    expect(rows.metrics).toHaveLength(2);
    expect(rows.errors).toHaveLength(1);
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.sessions).toHaveLength(1);
  });

  it("rejette le resourceSpan sans mip.app_id", () => {
    expect(rows.rejected).toBe(1);
  });

  it("recalcule le rating à l'ingestion (source de vérité)", () => {
    const lcp = rows.metrics.find((m) => m.name === "LCP");
    expect(lcp.value).toBe(2340.5);
    expect(lcp.rating).toBe("good"); // 2340,5 ms < 2500 -> « bon » (bornes web.dev)
    const inp = rows.metrics.find((m) => m.name === "INP");
    expect(inp.value).toBe(250); // intValue parsé
    expect(inp.rating).toBe("needs-improvement");
  });

  it("parse l'attribution (string JSON -> objet pour le jsonb)", () => {
    const lcp = rows.metrics.find((m) => m.name === "LCP");
    expect(lcp.attribution).toEqual({ element: "#hero", timeToFirstByte: 120 });
  });

  it("scrub PII : query string retirée de la source d'erreur", () => {
    expect(rows.errors[0].source).toBe("https://plateforme.groupement-it.com/app.js");
  });

  it("session : app_id/client_id depuis la resource, page_count incrémenté", () => {
    const s = rows.sessions[0];
    expect(s.app_id).toBe("gip-plateforme");
    expect(s.client_id).toBe("groupement-it");
    expect(s.page_count_inc).toBe(1);
  });

  it("timestamps nanos -> Date", () => {
    expect(rows.metrics[0].ts.toISOString()).toBe("2026-06-10T14:00:01.000Z");
  });
});

describe("flattenOtlp — signaux de frustration (P1)", () => {
  const sv = (s) => ({ stringValue: s });
  const frustrationPayload = (attrs) => ({
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }] },
        scopeSpans: [
          {
            spans: [
              {
                spanId: "fr",
                name: "frustration",
                startTimeUnixNano: "1760000000000000000",
                attributes: [
                  { key: "mip.session_id", value: sv("sess-1") },
                  { key: "mip.route", value: sv("/checkout") },
                  ...attrs,
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  it("rage -> rum_event 'frustration.rage' avec target/count", () => {
    const rows = flattenOtlp(
      frustrationPayload([
        { key: "frustration.kind", value: sv("rage") },
        { key: "frustration.target", value: sv('button "Payer"') },
        { key: "frustration.count", value: { intValue: "4" } },
      ]),
    );
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({
      name: "frustration.rage",
      route: "/checkout",
      session_id: "sess-1",
      app_id: "demo",
      props: { target: 'button "Payer"', count: 4 },
    });
  });

  it("dead -> count par défaut 1 si absent", () => {
    const rows = flattenOtlp(
      frustrationPayload([
        { key: "frustration.kind", value: sv("dead") },
        { key: "frustration.target", value: sv("a \"Aide\"") },
      ]),
    );
    expect(rows.events[0].name).toBe("frustration.dead");
    expect(rows.events[0].props).toEqual({ target: 'a "Aide"', count: 1 });
  });

  it("kind invalide -> rejeté (jamais inséré)", () => {
    const rows = flattenOtlp(
      frustrationPayload([{ key: "frustration.kind", value: sv("meh") }]),
    );
    expect(rows.events).toHaveLength(0);
    expect(rows.rejected).toBe(1);
  });

  it("scrub PII : un email dans la cible est masqué", () => {
    const rows = flattenOtlp(
      frustrationPayload([
        { key: "frustration.kind", value: sv("rage") },
        { key: "frustration.target", value: sv("lien jean@client.fr") },
      ]),
    );
    expect(rows.events[0].props.target).toBe("lien [email]");
  });
});
