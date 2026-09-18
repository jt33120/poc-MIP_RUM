// PR2 — SDK mobile React Native. Round-trip : les spans mobiles (crash, écran,
// réseau, événement) produits par le cœur sont ingérés par flattenOtlp dans les
// MÊMES tables que le web, avec device_type = mobile. Preuve que le mobile
// réutilise toute la pipeline sans changement serveur.
//
// P6.1 : env et release du SDK voyagent sur chaque signal, et la plateforme
// déclarée (« ios ») devient le système de la session, jamais sa classe.
import { describe, expect, it } from "vitest";
import {
  buildExceptionSpan,
  buildHttpSpan,
  buildPayload,
  buildScreenSpan,
  buildTrackSpan,
  type Ctx,
  type MobileConfig,
} from "../../packages/rum-mobile/src/core";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const cfg: MobileConfig = {
  endpoint: "https://i/v1/traces",
  appId: "mon-app",
  apiKey: "mip_mob_123",
  env: "prod",
  clientId: "acme",
  appVersion: "1.2.3",
  userAgent: "MIP-RN/0.1 (ios 17)",
};
const ctx: Ctx = { sessionId: "sess-m", route: "Accueil", userHash: "uh", tz: "Europe/Paris", deviceType: "ios" };
const T = 1_760_000_000_000;

describe("rum-mobile — round-trip OTLP -> flattenOtlp", () => {
  const spans = [
    buildScreenSpan(ctx, T, "aa11bb22cc33dd44"),
    buildExceptionSpan(ctx, { message: "boom for jean@x.fr", type: "TypeError", stack: "at App" }, T + 10, "bb22cc33dd44ee55"),
    buildHttpSpan(ctx, { traceId: "0af7651916cd43dd8448eb211c80319c", url: "https://api.exemple.fr/cart", method: "POST", status: 200, durationMs: 88 }, T + 20, "cc33dd44ee55ff66"),
    buildTrackSpan(ctx, "checkout", { amount: 42, email: "a@b.fr" }, T + 30, "dd44ee55ff667788"),
  ];
  const rows = flattenOtlp(buildPayload(cfg, spans));

  it("crée la session mobile : classe mobile, plateforme portée par le système (P6.1)", () => {
    expect(rows.sessions).toHaveLength(1);
    // « ios » n'est pas une classe d'appareil : le user-agent synthétique du SDK
    // donne mobile, iOS 17, et aucun navigateur.
    expect(rows.sessions[0]).toMatchObject({
      device_type: "mobile", os: "iOS", os_version: "17", browser: null, browser_version: null,
    });
    expect(rows.sessions[0].geo_country).toBe("FR"); // depuis mip.tz
    expect(rows.apiKeys[0]).toEqual({ app_id: "mon-app", api_key: "mip_mob_123" });
  });

  it("route chaque signal dans la bonne table", () => {
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.pageviews[0].route).toBe("Accueil");
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0].kind).toBe("crash");
    expect(rows.errors[0].message).toContain("[email]"); // scrub PII à l'ingestion
    expect(rows.errors[0].release).toBe("1.2.3");
    expect(rows.spans).toHaveLength(1);
    expect(rows.spans[0].tier).toBe("front");
    expect(rows.spans[0].duration_ms).toBe(88);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0].name).toBe("checkout");
    expect(rows.events[0].props).toEqual({ amount: 42, email: "[redacted]" });
    expect(rows.rejected).toBe(0);
  });

  it("recopie env et release sur chaque signal ; le nom constant du SDK n'est pas un service", () => {
    for (const ligne of [...rows.pageviews, ...rows.errors, ...rows.spans, ...rows.events]) {
      expect(ligne).toMatchObject({ env: "prod", release: "1.2.3" });
    }
    expect(rows.errors[0].service).toBeNull();
    expect(rows.spans[0].service).toBeNull();
  });
});
