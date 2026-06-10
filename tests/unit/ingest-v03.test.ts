// Ingestion v0.3 (chantier B1) : mapping timezone -> pays (geo RGPD-friendly),
// geo_country dans flattenOtlp, payload webhook du dispatcher (pendant pg_net).
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM hors rootDir ts
import { buildPayload } from "../../apps/ingest/dispatch-alerts.mjs";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";
import { tzToCountry } from "../../apps/ingest/supabase/functions/_shared/tz-country.mjs";

describe("tzToCountry — mapping IANA timezone -> code ISO pays", () => {
  it("zones majeures Europe/Amériques/Asie/Afrique", () => {
    expect(tzToCountry("Europe/Paris")).toBe("FR");
    expect(tzToCountry("Europe/London")).toBe("GB");
    expect(tzToCountry("Europe/Kyiv")).toBe("UA");
    expect(tzToCountry("America/New_York")).toBe("US");
    expect(tzToCountry("America/Sao_Paulo")).toBe("BR");
    expect(tzToCountry("Asia/Tokyo")).toBe("JP");
    expect(tzToCountry("Asia/Kolkata")).toBe("IN");
    expect(tzToCountry("Africa/Abidjan")).toBe("CI");
    expect(tzToCountry("Africa/Dakar")).toBe("SN");
    expect(tzToCountry("Indian/Reunion")).toBe("RE");
  });

  it("fallback par préfixe (zones rangées par pays + alias legacy)", () => {
    expect(tzToCountry("America/Argentina/Ushuaia")).toBe("AR");
    expect(tzToCountry("America/Indiana/Indianapolis")).toBe("US");
    expect(tzToCountry("Australia/Eucla")).toBe("AU");
    expect(tzToCountry("US/Pacific")).toBe("US");
    expect(tzToCountry("Canada/Eastern")).toBe("CA");
  });

  it("inconnues -> null (pas de pays inventé)", () => {
    expect(tzToCountry("Mars/Olympus_Mons")).toBeNull();
    expect(tzToCountry("Etc/UTC")).toBeNull(); // pas de pays déductible
    expect(tzToCountry("UTC")).toBeNull();
    expect(tzToCountry("")).toBeNull();
    expect(tzToCountry(null)).toBeNull();
    expect(tzToCountry(undefined)).toBeNull();
    expect(tzToCountry(42)).toBeNull();
  });
});

// Payload OTLP minimal : 1 pageview avec attrs communs (dont mip.tz optionnel)
function otlpWithTz(tz: string | null) {
  const attributes = [
    { key: "mip.session_id", value: { stringValue: "v03-geo-session" } },
    { key: "mip.route", value: { stringValue: "/login" } },
  ];
  if (tz != null) attributes.push({ key: "mip.tz", value: { stringValue: tz } });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "mip.app_id", value: { stringValue: "demo-app" } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: "pageview",
                spanId: "span-geo-1",
                startTimeUnixNano: "1760000000000000000",
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("flattenOtlp v0.3 — geo_country depuis mip.tz", () => {
  it("mip.tz='Europe/Paris' -> sessions[].geo_country='FR'", () => {
    const rows = flattenOtlp(otlpWithTz("Europe/Paris"));
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0].geo_country).toBe("FR");
  });

  it("timezone inconnue -> geo_country=null", () => {
    expect(flattenOtlp(otlpWithTz("Mars/Olympus_Mons")).sessions[0].geo_country).toBeNull();
  });

  it("sans mip.tz -> geo_country=null (pas de régression payloads v0.2)", () => {
    expect(flattenOtlp(otlpWithTz(null)).sessions[0].geo_country).toBeNull();
  });
});

describe("buildPayload — webhook identique à check_alerts v2 (pg_net)", () => {
  const delivery = {
    app_id: "gip-plateforme",
    metric: "LCP",
    route: "/login",
    value: 3204.94,
    threshold: 2500,
    window_minutes: 15,
    comparator: ">",
  };

  it("structure exacte du jsonb_build_object de migration-v03.sql", () => {
    expect(Object.keys(buildPayload(delivery))).toEqual([
      "source",
      "app_id",
      "metric",
      "route",
      "value",
      "threshold",
      "window_minutes",
      "text",
    ]);
  });

  it("valeurs : source mip-rum, value arrondie à 1 décimale, seuil intact", () => {
    const p = buildPayload(delivery);
    expect(p.source).toBe("mip-rum");
    expect(p.app_id).toBe("gip-plateforme");
    expect(p.metric).toBe("LCP");
    expect(p.value).toBe(3204.9);
    expect(p.threshold).toBe(2500);
    expect(p.window_minutes).toBe(15);
  });

  it("text compatible Slack : format [MIP RUM] avec seuil, app et route", () => {
    expect(buildPayload(delivery).text).toBe(
      "[MIP RUM] LCP > 3204.9 (seuil 2500) — app gip-plateforme, route /login",
    );
  });

  it("route null -> champ null et texte sans mention de route (coalesce SQL)", () => {
    const p = buildPayload({ ...delivery, route: null });
    expect(p.route).toBeNull();
    expect(p.text).toBe("[MIP RUM] LCP > 3204.9 (seuil 2500) — app gip-plateforme");
  });
});
