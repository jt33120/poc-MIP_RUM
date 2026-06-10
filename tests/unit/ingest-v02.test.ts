// Ingestion v0.2 : fingerprint d'erreur, nouveaux spans (resource/longtask/
// breadcrumb/track.*), extraction de la clé d'API (attribut resource mip.api_key).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  errorFingerprint,
  flattenOtlp,
  fnv1a,
} from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/otlp-sample-v2.json"), "utf8"),
);

describe("fnv1a — hash de regroupement", () => {
  it("hex 8 caractères, déterministe", () => {
    expect(fnv1a("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });
});

describe("errorFingerprint — famille d'erreurs", () => {
  const stackA =
    "TypeError: Partner 12345 introuvable\n    at renderPartner (https://demo.mip.local/assets/app.js:120:17)";
  const stackB =
    "TypeError: Partner 98765 introuvable\n    at renderPartner (https://demo.mip.local/assets/app.js:121:9)";

  it("stable : ids numériques et line:col différents -> même fingerprint", () => {
    expect(errorFingerprint("TypeError", "Partner 12345 introuvable", stackA)).toBe(
      errorFingerprint("TypeError", "Partner 98765 introuvable", stackB),
    );
  });

  it("normalise uuids et urls dans le message", () => {
    expect(
      errorFingerprint(
        "Error",
        "fetch failed for https://api.x.io/v1/items/0d1f3c44-9c1a-4b8e-9f00-aabbccddeeff",
        "",
      ),
    ).toBe(errorFingerprint("Error", "fetch failed for https://api.x.io/other/123", ""));
  });

  it("différent pour une autre famille (type ou message)", () => {
    const base = errorFingerprint("TypeError", "Partner 12345 introuvable", stackA);
    expect(errorFingerprint("RangeError", "Partner 12345 introuvable", stackA)).not.toBe(base);
    expect(errorFingerprint("TypeError", "Quota dépassé", stackA)).not.toBe(base);
  });

  it("différent si le premier frame change (autre fichier)", () => {
    const otherFrame =
      "TypeError: Partner 12345 introuvable\n    at renderWidget (https://demo.mip.local/assets/widget.js:3:1)";
    expect(errorFingerprint("TypeError", "Partner 12345 introuvable", otherFrame)).not.toBe(
      errorFingerprint("TypeError", "Partner 12345 introuvable", stackA),
    );
  });
});

describe("flattenOtlp v0.2 — fixture otlp-sample-v2", () => {
  const rows = flattenOtlp(fixture);

  it("comptes : 5 vitals, 2 erreurs, 1 resource, 1 longtask, 2 breadcrumbs, 1 event", () => {
    expect(rows.metrics).toHaveLength(5);
    expect(rows.errors).toHaveLength(2);
    expect(rows.resources).toHaveLength(1);
    expect(rows.longtasks).toHaveLength(1);
    expect(rows.breadcrumbs).toHaveLength(2);
    expect(rows.events).toHaveLength(1);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.rejected).toBe(0);
  });

  it("les 5 vitals sont présents et notés", () => {
    expect(rows.metrics.map((m) => m.name).sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
    expect(rows.metrics.find((m) => m.name === "LCP").rating).toBe("poor");
    expect(rows.metrics.find((m) => m.name === "INP").rating).toBe("good");
  });

  it("2 erreurs de la même famille -> 1 seul fingerprint, renseigné", () => {
    const [e1, e2] = rows.errors;
    expect(e1.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(e1.fingerprint).toBe(e2.fingerprint);
    expect(e1.message).not.toBe(e2.message); // ids numériques différents
  });

  it("resource : champs du contrat, url scrubbée (query string retirée)", () => {
    const r = rows.resources[0];
    expect(r.url).toBe("https://cdn.demo.mip.local/vendor/chart.umd.js");
    expect(r.type).toBe("script");
    expect(r.duration_ms).toBe(412.7);
    expect(r.transfer_size).toBe(184320);
    expect(r.render_blocking).toBe(true);
    expect(r.route).toBe("/partners/search");
  });

  it("longtask : duration_ms", () => {
    const lt = rows.longtasks[0];
    expect(lt.duration_ms).toBe(87.3);
    expect(lt.session_id).toBe("fixture-v2-session-1");
  });

  it("breadcrumbs : type/label/seq", () => {
    expect(rows.breadcrumbs.map((b) => [b.type, b.label, b.seq])).toEqual([
      ["click", "button#search-partners", 1],
      ["nav", "/partners/search", 2],
    ]);
  });

  it("track.partner_search -> rum_event avec props parsées (jsonb)", () => {
    const ev = rows.events[0];
    expect(ev.name).toBe("partner_search");
    expect(ev.props).toEqual({ query: "assurance habitation", results: 12 });
  });

  it("api key extraite par resourceSpan (attribut resource mip.api_key)", () => {
    expect(rows.apiKeys).toEqual([{ app_id: "demo-app", api_key: "mip_demo_key_2026" }]);
  });

  it("payload sans mip.api_key -> api_key null (legacy)", () => {
    const legacy = JSON.parse(JSON.stringify(fixture));
    legacy.resourceSpans[0].resource.attributes = legacy.resourceSpans[0].resource.attributes.filter(
      (kv) => kv.key !== "mip.api_key",
    );
    expect(flattenOtlp(legacy).apiKeys).toEqual([{ app_id: "demo-app", api_key: null }]);
  });
});
