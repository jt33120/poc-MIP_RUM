// Ingestion v0.3 (chantier B1) : mapping timezone -> pays (geo RGPD-friendly),
// geo_country dans flattenOtlp, payload webhook du dispatcher (pendant pg_net).
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM hors rootDir ts
import { buildPayload, cibleHttp, decideStatus, payloadOf, selectionSql } from "../../packages/backend/lib/dispatch-alerts.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import { tzToCountry } from "../../packages/backend/shared/tz-country.mjs";

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

  // B52 (migration-v86) : le seuil d'une règle de release est une hausse EN POUR
  // CENT ; « LCP > 2600.0 (seuil 20) » se lirait « au-dessus de 20 ms ».
  it("règle de release : le texte est le message de check_alerts, phrase du plan comprise ; structure inchangée", () => {
    const message =
      "LCP p75 en hausse de 30 % d'une release à l'autre : 1.1.0 = 2600 contre 1.0.0 = 2000 (seuil +20 %, 120 et 120 mesures, fenêtre 120 min, app a) — même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte";
    const p = buildPayload({ ...delivery, value: 2600, threshold: 20, mode: "release", message });
    expect(p.text).toBe(`[MIP RUM] ${message}`);
    expect(Object.keys(p)).toEqual(["source", "app_id", "metric", "route", "value", "threshold", "window_minutes", "text"]);
    // Sans message (ligne incomplète), le gabarit historique plutôt qu'un texte vide.
    expect(buildPayload({ ...delivery, mode: "release", message: null }).text).toContain("(seuil 2500)");
    // Les autres modes ne changent pas, même avec un message.
    expect(buildPayload({ ...delivery, mode: "baseline", message: "m" }).text).toBe(
      "[MIP RUM] LCP > 3204.9 (seuil 2500) — app gip-plateforme, route /login",
    );
  });

  it("la sélection du dispatcher lit le mode de la règle (colonne de v17, présente avant et après v73)", () => {
    for (const sql of [selectionSql(false), selectionSql(true)]) expect(sql).toContain("r.comparator, r.mode,");
  });
});

describe("decideStatus — rejeu borné des livraisons (R5)", () => {
  it("succès -> 'sent' quel que soit le nombre de tentatives", () => {
    expect(decideStatus(true, 0, 5)).toBe("delivered");
    expect(decideStatus(true, 4, 5)).toBe("delivered");
  });
  it("échec sous le plafond -> 'failed' (sera rejoué)", () => {
    expect(decideStatus(false, 0, 5)).toBe("failed");
    expect(decideStatus(false, 3, 5)).toBe("failed");
  });
  it("échec à la dernière tentative -> 'dead' (état terminal)", () => {
    expect(decideStatus(false, 4, 5)).toBe("dead"); // 4+1 = 5 = plafond
    expect(decideStatus(false, 9, 5)).toBe("dead");
  });
});

describe("dispatcher — événements sans règle et notifications d'issue (migration-v73)", () => {
  it("corps : notification d'issue figée par l'outbox, sinon règle, sinon message de l'événement", () => {
    const notification = { source: "mip-rum", kind: "regression", app_id: "a", issue_id: "i", text: "[MIP RUM] Régression" };
    expect(payloadOf({ notification, metric: "issue:x", severity: "warning", message: "m" })).toBe(notification);
    expect(payloadOf({
      notification: null, metric: "LCP", app_id: "a", route: null, value: 3000, threshold: 2500, window_minutes: 15,
      comparator: ">", severity: "warning", message: "m",
    })).toMatchObject({ metric: "LCP", text: "[MIP RUM] LCP > 3000.0 (seuil 2500) — app a" });
    expect(payloadOf({ notification: null, metric: null, severity: "critical", message: "SLO LCP en burn rapide" })).toEqual({
      source: "mip-rum",
      severity: "critical",
      text: "[MIP RUM] SLO LCP en burn rapide",
    });
  });

  it("n'essaie de poster qu'en HTTP(S) : une adresse e-mail est soldée, pas retentée cinq fois", () => {
    expect(cibleHttp("https://hooks.slack.com/services/x")).toBe(true);
    expect(cibleHttp("http://127.0.0.1:9999/hook")).toBe(true);
    expect(cibleHttp("ops@example.com")).toBe(false);
    expect(cibleHttp("mailto:ops@example.com")).toBe(false);
    expect(cibleHttp("")).toBe(false);
  });

  it("avant v73 la sélection garde la jointure interne ; dès v73 l'arriéré sans règle reste exclu", () => {
    const avant = selectionSql(false);
    expect(avant).toContain("join alert_rule r on r.id = e.rule_id");
    expect(avant).not.toMatch(/left join alert_rule|error_issue_notification|rule_less_dispatch_since/);
    const apres = selectionSql(true);
    expect(apres).toContain("left join alert_rule r on r.id = e.rule_id");
    expect(apres).toContain("left join error_issue_notification n on n.alert_event_id = e.id");
    expect(apres).toContain("e.rule_id is not null or e.fired_at >= c.rule_less_dispatch_since");
    // Deux déclencheurs simultanés ne réservent jamais la même livraison.
    for (const sql of [avant, apres]) expect(sql).toContain("for update of d skip locked");
  });
});
