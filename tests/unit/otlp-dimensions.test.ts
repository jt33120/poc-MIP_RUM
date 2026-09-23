// P6.1 — dimensions aux bonnes frontières, côté parseur OTLP.
//
// Ce qui est verrouillé ici se décide AVANT la base : navigateur, système et
// appareil décrivent la SESSION ; env, release et service sont recopiés sur CHAQUE
// signal, projection comprise, pour qu'un regroupement passé ne dépende jamais
// d'une session modifiée ensuite. La preuve PostgreSQL (colonnes, fenêtre de
// déploiement, sélecteurs, historique) est dans
// tests/integration/dimensions-v75-sql.test.ts.
import { describe, expect, it } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import {
  flattenOtlp,
  flattenOtlpLogs,
  // @ts-expect-error module JS partagé sans déclarations
} from "../../packages/backend/shared/otlp.mjs";

type Attrs = Record<string, unknown>;
type Row = Record<string, unknown>;

const APP = "p61-dimensions";
const NOW = Date.now();
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const TABLETTE_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36";

/** Resource du SDK web (otel.ts). */
const web = (over: Attrs = {}): Attrs => ({
  "service.name": "mip-rum-web",
  "service.version": "0.4.0",
  "mip.app_id": APP,
  "mip.user_agent": CHROME_WINDOWS,
  "deployment.environment.name": "production",
  "mip.release": "2.3.1",
  ...over,
});

const hex = (n: number, taille = 16) => n.toString(16).padStart(taille, "0");

/** Un span de chaque famille de session, avec les attributs que le SDK web y pose. */
function signauxWeb(session: string, base = 1): Array<Omit<EmitSpan, "startTime" | "endTime">> {
  const commun = { "mip.session_id": session, "mip.route": "/panier", "mip.device_type": "desktop" };
  const span = (n: number, name: string, attributes: Attrs): Omit<EmitSpan, "startTime" | "endTime"> =>
    ({ name, traceId: TRACE, spanId: hex(base * 100 + n), attributes: { ...commun, ...attributes } });
  return [
    span(1, "pageview", { "mip.url": "https://app.exemple.fr/panier", "mip.nav_type": "navigate" }),
    span(2, "webvital.LCP", { "webvital.name": "LCP", "webvital.value": 1800, "webvital.id": `v5-${base}` }),
    span(3, "exception", { "exception.type": "TypeError", "exception.message": "boom", "mip.error_kind": "error" }),
    span(4, "resource", { "resource.url": "https://cdn.exemple.fr/app.js", "resource.type": "script", "resource.duration_ms": 420 }),
    span(5, "longtask", { "longtask.duration_ms": 90 }),
    span(6, "breadcrumb", { "breadcrumb.type": "click", "breadcrumb.label": "#payer" }),
    span(7, "track.paiement", { "mip.props": JSON.stringify({ montant: 42 }) }),
    span(8, "rum.action", {
      "mip.event_type": "action", "mip.event_name": "Payer", "mip.action_type": "click",
      "mip.action_id": hex(base * 100 + 8, 32),
    }),
    span(9, "http.client", {
      "mip.trace_id": TRACE, "mip.span_id": hex(base * 100 + 9), "http.url": "https://api.exemple.fr/paiements",
      "http.method": "POST", "http.status_code": 201, "http.duration_ms": 120,
    }),
  ];
}

function lot(resource: Attrs, spans: Array<Omit<EmitSpan, "startTime" | "endTime">>) {
  const t = msToHr(NOW - 1_000);
  return buildResourceSpans(resource, spans.map((span) => ({ ...span, startTime: t, endTime: t })));
}

/** Toutes les lignes de signal d'un lot aplati, projection exclue. */
const signaux = (rows: Record<string, Row[]>) => [
  ...rows.pageviews, ...rows.metrics, ...rows.errors, ...rows.resources, ...rows.longtasks,
  ...rows.breadcrumbs, ...rows.events, ...rows.actions, ...rows.spans,
];

const kv = (key: string, value: unknown) => ({
  key,
  value: typeof value === "number" ? { intValue: String(value) } : { stringValue: String(value) },
});
const attributs = (attrs: Attrs) => Object.entries(attrs).map(([key, value]) => kv(key, value));

/** Émetteur OpenTelemetry backend : ni user-agent, ni session. */
const BACKEND: Attrs = {
  "mip.app_id": APP, "service.name": "checkout-api", "service.version": "7.1.0", "deployment.environment": "staging",
};

describe("flattenOtlp — dimensions client de la session", () => {
  it("navigateur, système et classe d'appareil viennent de l'user-agent", () => {
    const rows = flattenOtlp(lot(web(), signauxWeb("p61-web")));
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]).toMatchObject({
      browser: "Chrome", browser_version: "139", os: "Windows", os_version: null, device_type: "desktop", is_bot: false,
    });
  });

  it("une tablette reste une tablette même quand le SDK web annonce desktop", () => {
    const rows = flattenOtlp(lot(web({ "mip.user_agent": TABLETTE_ANDROID }), signauxWeb("p61-tablette")));
    expect(rows.sessions[0]).toMatchObject({ browser: "Samsung Internet", os: "Android", os_version: "14", device_type: "tablet" });
  });

  it("un robot garde son drapeau et la classe du SDK, sans navigateur ni système", () => {
    const rows = flattenOtlp(lot(
      web({ "mip.user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36" }),
      signauxWeb("p61-robot"),
    ));
    expect(rows.sessions[0]).toMatchObject({ is_bot: true, browser: null, browser_version: null, os: null, device_type: "desktop" });
  });

  it("vieux SDK : ni user-agent, ni env, ni release, ni indice — tout reste inconnu", () => {
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: attributs({ "mip.app_id": APP }) },
        scopeSpans: [{ spans: [{
          name: "pageview", spanId: "00000000000000a1", startTimeUnixNano: `${NOW - 1_000}000000`,
          attributes: attributs({ "mip.session_id": "p61-ancien", "mip.route": "/" }),
        }] }],
      }],
    });
    expect(rows.sessions[0]).toMatchObject({ browser: null, os: null, device_type: null, release: null });
    expect(rows.pageviews[0]).toMatchObject({ env: null, release: null });
    expect(rows.eventIndex[0]).not.toHaveProperty("release");
    expect(rows.eventIndex[0]).not.toHaveProperty("env");
  });

  it("la session se complète d'une resource suivante, famille et version d'un bloc", () => {
    const sansUa = lot(web({ "mip.user_agent": undefined }), [{
      name: "pageview", traceId: TRACE, spanId: hex(901), attributes: { "mip.session_id": "p61-completee", "mip.route": "/" },
    }]) as { resourceSpans: unknown[] };
    const avecUa = lot(web(), [{
      name: "pageview", traceId: TRACE, spanId: hex(902), attributes: { "mip.session_id": "p61-completee", "mip.route": "/b" },
    }]) as { resourceSpans: unknown[] };
    const rows = flattenOtlp({ resourceSpans: [...sansUa.resourceSpans, ...avecUa.resourceSpans] });
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]).toMatchObject({
      browser: "Chrome", browser_version: "139", os: "Windows", os_version: null, device_type: "desktop",
    });
  });
});

describe("flattenOtlp — env et release de CHAQUE signal", () => {
  it("chaque famille de signal et sa projection portent env et release ; le SDK MIP n'est pas un service", () => {
    const rows = flattenOtlp(lot(web(), signauxWeb("p61-signaux")));
    const lignes = signaux(rows);
    // Neuf spans, dix lignes : une action est aussi un événement rum_event.
    expect(lignes).toHaveLength(10);
    for (const ligne of lignes) expect(ligne).toMatchObject({ env: "production", release: "2.3.1" });
    expect(rows.spans[0].service).toBeNull();
    expect(rows.errors[0].service).toBeNull();
    // La projection suit ses sources, service absent compris.
    expect(rows.eventIndex).toHaveLength(9);
    for (const ligne of rows.eventIndex) {
      expect(ligne).toMatchObject({ env: "production", release: "2.3.1" });
      expect(ligne).not.toHaveProperty("service");
    }
  });

  it("une release qui change pendant la session reste attachée à chaque événement", () => {
    const avant = lot(web({ "mip.release": "2.3.1" }), signauxWeb("p61-deploiement", 1)) as { resourceSpans: unknown[] };
    const apres = lot(web({ "mip.release": "2.4.0" }), signauxWeb("p61-deploiement", 2)) as { resourceSpans: unknown[] };
    const rows = flattenOtlp({ resourceSpans: [...avant.resourceSpans, ...apres.resourceSpans] });
    expect(rows.pageviews.map((p: Row) => p.release)).toEqual(["2.3.1", "2.4.0"]);
    expect(rows.eventIndex.filter((i: Row) => i.kind === "pageview").map((i: Row) => i.release)).toEqual(["2.3.1", "2.4.0"]);
    // La session garde la première release vue ; rien ne la recopie sur les signaux.
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0].release).toBe("2.3.1");
  });

  it("release bornée à l'ingestion (suivi P5) : hors bornes, inconnue partout ; jamais scrubbée", () => {
    const longue = flattenOtlp(lot(web({ "mip.release": "r".repeat(2000) }), signauxWeb("p61-longue")));
    expect(longue.sessions[0].release).toBeNull();
    for (const ligne of signaux(longue)) expect(ligne.release).toBeNull();
    for (const ligne of longue.eventIndex) expect(ligne).not.toHaveProperty("release");

    const quatreNombres = flattenOtlp(lot(web({ "mip.release": " 4.8.0.1 " }), signauxWeb("p61-quatre")));
    expect(quatreNombres.sessions[0].release).toBe("4.8.0.1");
    expect(quatreNombres.errors[0].release).toBe("4.8.0.1");
  });
});

describe("flattenOtlp — signaux backend sans user-agent ni session", () => {
  const serveur = {
    traceId: TRACE, spanId: "00f067aa0ba902b7", kind: 2, name: "POST /paiements/{id}",
    startTimeUnixNano: `${NOW - 2_000}000000`, endTimeUnixNano: `${NOW - 1_990}000000`,
    attributes: attributs({ "http.request.method": "POST", "http.route": "/paiements/{id}" }),
    events: [{
      name: "exception", timeUnixNano: `${NOW - 1_995}000000`,
      attributes: attributs({ "exception.type": "ValueError", "exception.message": "montant négatif" }),
    }],
  };
  const detail = {
    traceId: TRACE, spanId: "00f067aa0ba902b8", parentSpanId: "00f067aa0ba902b7", kind: 3, name: "SELECT paiements",
    startTimeUnixNano: `${NOW - 1_998}000000`, endTimeUnixNano: `${NOW - 1_996}000000`,
    attributes: attributs({ "db.system": "postgresql" }),
  };

  it("spans serveur et détail, et l'exception qu'ils portent : service, env et release du backend", () => {
    const rows = flattenOtlp({
      resourceSpans: [{ resource: { attributes: attributs(BACKEND) }, scopeSpans: [{ scope: { name: "opentelemetry.sdk" }, spans: [serveur, detail] }] }],
    });
    expect(rows.sessions).toEqual([]);
    expect(rows.spans.map((s: Row) => [s.tier, s.service, s.env, s.release])).toEqual([
      ["back", "checkout-api", "staging", "7.1.0"],
      ["detail", "checkout-api", "staging", "7.1.0"],
    ]);
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toMatchObject({ session_id: null, service: "checkout-api", env: "staging", release: "7.1.0" });
    for (const ligne of rows.eventIndex) {
      expect(ligne).toMatchObject({ kind: "span", service: "checkout-api", env: "staging", release: "7.1.0" });
    }
  });

  it("http.server du middleware : mip.release prime sur service.version", () => {
    const rows = flattenOtlp({
      resourceSpans: [{
        resource: { attributes: attributs({ ...BACKEND, "mip.release": "2026.09.17" }) },
        scopeSpans: [{ spans: [{
          name: "http.server", traceId: TRACE, spanId: "00f067aa0ba902b9", startTimeUnixNano: `${NOW - 1_000}000000`,
          attributes: [...attributs({ "mip.trace_id": TRACE, "mip.span_id": "00f067aa0ba902b9", "http.method": "GET" }),
            { key: "http.duration_ms", value: { doubleValue: 12.5 } }],
        }] }],
      }],
    });
    expect(rows.spans[0]).toMatchObject({ tier: "back", service: "checkout-api", env: "staging", release: "2026.09.17" });
  });

  it("exception structurée d'un log : mêmes dimensions déclarées", () => {
    const { errors } = flattenOtlpLogs({
      resourceLogs: [{
        resource: { attributes: attributs(BACKEND) },
        scopeLogs: [{ logRecords: [{
          timeUnixNano: `${NOW - 1_000}000000`, severityNumber: 17, severityText: "ERROR",
          body: { stringValue: "échec" },
          attributes: attributs({ "exception.type": "ValueError", "exception.message": "montant négatif" }),
        }] }],
      }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ session_id: null, service: "checkout-api", env: "staging", release: "7.1.0" });
  });
});
