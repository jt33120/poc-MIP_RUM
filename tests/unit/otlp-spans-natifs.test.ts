// Les champs OTLP NATIFS du SDK navigateur : parentSpanId, kind, status.
//
// CE QUI ÉTAIT FAUX. L'émetteur ne sérialisait que traceId / spanId / name /
// horodatage / attributs. La parenté, la nature et l'issue d'un span voyageaient
// dans des attributs `mip.*` que seul notre backend savait relire. Un collecteur
// OpenTelemetry tiers acceptait le flux et reconstruisait une trace SANS RACINE :
// autant de branches détachées que de mesures. La vitrine le disait — « backend
// remplaçable n'est vrai qu'à moitié » — ce fichier est ce qui rend la seconde
// moitié vraie, et ce qui l'empêche de redevenir fausse.
//
// Deux garanties sont tenues ici, et elles tirent en sens opposé :
//   1. la trace est un ARBRE : le pageview en est la racine, tout le reste en
//      descend ;
//   2. on n'invente JAMAIS un parent : un span émis avant la racine, ou dont la
//      racine n'est jamais partie (consentement refusé, session error-biased),
//      reste racine lui-même plutôt que de désigner un span qui n'arrivera pas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPAN_KIND,
  STATUS_CODE,
  buildResourceSpans,
  kindPour,
  statutPour,
  msToHr,
  type EmitSpan,
} from "../../packages/rum-sdk/src/otlp-encode";
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

// ─────────────────────────── la table de correspondance ───────────────────────

describe("kindPour — la nature d'un span", () => {
  it("un appel réseau sortant est CLIENT : c'est ce qui l'apparie au span serveur", () => {
    expect(kindPour("http.client")).toBe(SPAN_KIND.CLIENT);
  });

  it("une requête entrante est SERVER", () => {
    expect(kindPour("http.server")).toBe(SPAN_KIND.SERVER);
  });

  it("tout le reste de ce que produit un navigateur est INTERNAL", () => {
    for (const n of ["pageview", "webvital.LCP", "exception", "longtask", "breadcrumb", "track.x"])
      expect(kindPour(n), n).toBe(SPAN_KIND.INTERNAL);
  });

  it("ne rend jamais UNSPECIFIED (0) — ce serait une abstention déguisée", () => {
    for (const n of ["pageview", "http.client", "n'importe quoi"]) expect(kindPour(n)).toBeGreaterThan(0);
  });
});

describe("statutPour — l'issue d'un span", () => {
  it("une exception est une ERREUR", () => {
    expect(statutPour("exception", {})).toEqual({ code: STATUS_CODE.ERROR });
  });

  it("un appel HTTP en 2xx/3xx est OK", () => {
    expect(statutPour("http.client", { "http.status_code": 200 })).toEqual({ code: STATUS_CODE.OK });
    expect(statutPour("http.client", { "http.status_code": 302 })).toEqual({ code: STATUS_CODE.OK });
  });

  it("un appel HTTP en 4xx/5xx est une ERREUR", () => {
    expect(statutPour("http.client", { "http.status_code": 404 })).toEqual({ code: STATUS_CODE.ERROR });
    expect(statutPour("http.client", { "http.status_code": 500 })).toEqual({ code: STATUS_CODE.ERROR });
  });

  // Le point qui distingue « je ne sais pas » de « tout va bien ». Une requête
  // coupée avant sa réponse n'a pas de code HTTP ; la dire OK serait faux.
  it("un appel sans code HTTP ne dit RIEN plutôt que de dire OK", () => {
    expect(statutPour("http.client", {})).toBeUndefined();
    expect(statutPour("http.client", { "http.status_code": null })).toBeUndefined();
  });

  it("une mesure ou une page vue ne portent pas d'issue", () => {
    expect(statutPour("pageview", {})).toBeUndefined();
    expect(statutPour("webvital.LCP", { "webvital.value": 2300 })).toBeUndefined();
  });

  // La PII ne doit pas trouver un second chemin. `exception.message` est nettoyé
  // à l'émission ET à l'ingestion ; `status.message` ne le serait ni l'un ni
  // l'autre, donc il n'existe pas.
  it("ne joint jamais de message, même sur une erreur", () => {
    const s = statutPour("exception", { "exception.message": "jean@client.fr password=hunter2" });
    expect(Object.keys(s!)).toEqual(["code"]);
  });
});

// ──────────────────────────────── la sérialisation ────────────────────────────

const spanNu = (over: Partial<EmitSpan> = {}): EmitSpan => ({
  name: "pageview",
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  startTime: msToHr(1_760_000_000_000),
  endTime: msToHr(1_760_000_000_100),
  attributes: {},
  ...over,
});

/** Le premier span de l'enveloppe produite. */
function serialise(s: EmitSpan): Record<string, unknown> {
  const enveloppe = buildResourceSpans({ "mip.app_id": "demo" }, [s]) as {
    resourceSpans: { scopeSpans: { spans: Record<string, unknown>[] }[] }[];
  };
  return enveloppe.resourceSpans[0].scopeSpans[0].spans[0];
}

describe("buildResourceSpans — les champs natifs sur le fil", () => {
  it("porte parentSpanId, kind et status quand ils sont connus", () => {
    const s = serialise(
      spanNu({
        name: "http.client",
        parentSpanId: "c".repeat(16),
        kind: SPAN_KIND.CLIENT,
        status: { code: STATUS_CODE.ERROR },
      }),
    );
    expect(s.parentSpanId).toBe("c".repeat(16));
    expect(s.kind).toBe(SPAN_KIND.CLIENT);
    expect(s.status).toEqual({ code: STATUS_CODE.ERROR });
  });

  // OMETTRE et METTRE À ZÉRO ne veulent pas dire la même chose : `parentSpanId:
  // ""` désigne explicitement un span racine, `status: {code: 0}` affirme « rien
  // à signaler ». Sur un span dont on ne sait rien, les deux seraient des
  // affirmations là où l'absence est une abstention.
  it("omet les champs inconnus au lieu de les mettre à zéro", () => {
    const s = serialise(spanNu({ kind: undefined }));
    expect("parentSpanId" in s).toBe(false);
    expect("status" in s).toBe(false);
    expect("kind" in s).toBe(false);
  });

  it("laisse intacts les champs qui existaient déjà", () => {
    const s = serialise(spanNu({ kind: SPAN_KIND.INTERNAL }));
    expect(s.traceId).toBe("a".repeat(32));
    expect(s.spanId).toBe("b".repeat(16));
    expect(s.name).toBe("pageview");
    expect(s.startTimeUnixNano).toBe("1760000000000000000");
  });
});

// ───────────────────────── l'émetteur, avec un faux DOM ───────────────────────
// `initOtel` touche navigator / document / addEventListener / fetch. On les
// remplace plutôt que de réécrire la logique : ce qu'on veut vérifier, c'est la
// forme RÉELLEMENT postée, pas une reconstitution.

describe("l'émetteur produit un ARBRE, pas une poignée d'orphelins", () => {
  let poste: EmitSpan[] = [];
  let otel: typeof import("../../packages/rum-sdk/src/otel");

  beforeEach(async () => {
    poste = [];
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Test", sendBeacon: undefined });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: () => {},
    });
    vi.stubGlobal("addEventListener", () => {});
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const env = JSON.parse(init.body);
      for (const rs of env.resourceSpans)
        for (const ss of rs.scopeSpans) poste.push(...ss.spans);
      return { ok: true };
    });
    // Import FRAIS à chaque cas : le module porte l'état de la trace courante.
    vi.resetModules();
    otel = await import("../../packages/rum-sdk/src/otel");
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Ouvre une page vue et émet les spans demandés, puis rend ce qui est parti. */
  async function emettre(
    tracer: ReturnType<typeof otel.initOtel>,
    spans: { name: string; attrs?: Record<string, unknown> }[],
  ) {
    for (const s of spans) {
      const span = tracer.startSpan(s.name);
      span.setAttributes({ "mip.session_id": "sess-1", ...(s.attrs ?? {}) });
      span.end();
    }
    await otel.forceFlush();
    return poste as unknown as Record<string, unknown>[];
  }

  it("le pageview est la RACINE : il n'a pas de parent", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const [pv] = await emettre(tracer, [{ name: "pageview" }]);
    expect(pv.parentSpanId).toBeUndefined();
    expect(pv.spanId).toBe(otel.currentPageSpanId());
    expect(pv.kind).toBe(SPAN_KIND.INTERNAL);
  });

  it("tout ce qui suit descend du pageview, dans la MÊME trace", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const spans = await emettre(tracer, [
      { name: "pageview" },
      { name: "webvital.LCP", attrs: { "webvital.name": "LCP", "webvital.value": 2300 } },
      { name: "exception", attrs: { "exception.message": "boom" } },
      { name: "longtask", attrs: { "longtask.duration_ms": 120 } },
    ]);
    const racine = spans[0];
    expect(spans).toHaveLength(4);
    for (const s of spans.slice(1)) {
      expect(s.parentSpanId, String(s.name)).toBe(racine.spanId);
      expect(s.traceId, String(s.name)).toBe(racine.traceId);
    }
  });

  it("l'appel API garde SON identifiant — celui qui part dans traceparent", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const tid = otel.currentTraceId();
    const spans = await emettre(tracer, [
      { name: "pageview" },
      {
        name: "http.client",
        attrs: {
          "mip.trace_id": tid,
          "mip.span_id": "0011223344556677",
          "http.status_code": 503,
          "http.duration_ms": 42,
        },
      },
    ]);
    const appel = spans[1];
    // son propre spanId = celui propagé au serveur, qui devient son enfant…
    expect(appel.spanId).toBe("0011223344556677");
    // …et son parent reste la page vue : le serveur est petit-enfant du pageview
    expect(appel.parentSpanId).toBe(spans[0].spanId);
    expect(appel.kind).toBe(SPAN_KIND.CLIENT);
    expect(appel.status).toEqual({ code: STATUS_CODE.ERROR }); // 503
  });

  // Le cas que le drapeau `racineCreee` existe pour couvrir. Sans lui, une
  // erreur au tout début du chargement désignerait un parent qui n'arrivera
  // jamais, et un backend afficherait une trace perpétuellement incomplète.
  it("un span émis AVANT la racine ne désigne pas de parent fantôme", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const spans = await emettre(tracer, [
      { name: "exception", attrs: { "exception.message": "avant tout" } },
      { name: "pageview" },
    ]);
    expect(spans[0].parentSpanId).toBeUndefined();
    expect(spans[1].parentSpanId).toBeUndefined(); // la racine, arrivée après
  });

  it("une nouvelle page vue ouvre une nouvelle racine", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    await emettre(tracer, [{ name: "pageview" }, { name: "longtask", attrs: { "longtask.duration_ms": 60 } }]);
    otel.newPageTrace();
    await emettre(tracer, [{ name: "pageview" }, { name: "longtask", attrs: { "longtask.duration_ms": 60 } }]);
    const [pv1, lt1, pv2, lt2] = poste as unknown as Record<string, unknown>[];
    expect(pv2.spanId).not.toBe(pv1.spanId);
    expect(lt1.parentSpanId).toBe(pv1.spanId);
    expect(lt2.parentSpanId).toBe(pv2.spanId);
    expect(pv2.traceId).not.toBe(pv1.traceId);
  });

  // Le rejeu de la file de retry peut produire un SECOND pageview dans la trace
  // courante. S'il reprenait l'identifiant de la racine, deux spans porteraient
  // la même clé et l'ingestion en jetterait un (`on conflict do nothing`).
  it("un second pageview dans la même trace ne vole pas la clé de la racine", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const spans = await emettre(tracer, [{ name: "pageview" }, { name: "pageview" }]);
    expect(spans[1].spanId).not.toBe(spans[0].spanId);
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
  });

  it("discardPendingSpans détruit un lot matérialisé avant son export", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    const span = tracer.startSpan("rum.action");
    span.setAttributes({
      "mip.session_id": "sess-1",
      "mip.event_type": "action",
      "mip.action_id": "11111111-2222-4333-8444-555555555555",
    });
    span.end();
    otel.discardPendingSpans();
    await otel.forceFlush();
    expect(poste).toEqual([]);
  });

  it("annule aussi l'export HTTP déjà parti lors d'un refus", async () => {
    let aborted = false;
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    }));
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    const span = tracer.startSpan("rum.action");
    span.setAttributes({
      "mip.session_id": "sess-1",
      "mip.event_type": "action",
      "mip.action_id": "11111111-2222-4333-8444-555555555555",
    });
    span.end();
    const flushing = otel.forceFlush();
    await Promise.resolve();
    const retry = await import("../../packages/rum-sdk/src/retry");
    retry.purgeRetryQueue();
    otel.discardPendingSpans();
    await flushing;
    expect(aborted).toBe(true);
    expect(store.has(retry.RETRY_KEY)).toBe(false);
    expect(store.has(retry.RETRY_REVOKED_ACTIONS_KEY)).toBe(false);
  });

  it("sérialise réellement deux lots pour qu'un enfant ne dépasse pas sa racine", async () => {
    const releases: Array<(response: { ok: boolean }) => void> = [];
    let requests = 0;
    vi.stubGlobal("fetch", () => {
      requests++;
      return new Promise<{ ok: boolean }>((resolve) => releases.push(resolve));
    });
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    const root = tracer.startSpan("rum.action");
    root.setAttributes({ "mip.session_id": "sess-1", "mip.event_type": "action" });
    root.end();
    const first = otel.forceFlush();
    await Promise.resolve();
    expect(requests).toBe(1);

    const child = tracer.startSpan("exception");
    child.setAttributes({ "mip.session_id": "sess-1" });
    child.end();
    const second = otel.forceFlush();
    await Promise.resolve();
    expect(requests).toBe(1);

    releases[0]({ ok: true });
    await first;
    await Promise.resolve();
    expect(requests).toBe(2);
    releases[1]({ ok: true });
    await second;
  });

  it("un rejeu restaure traceId, spanId et parentSpanId natifs", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    const replay = tracer.startSpan("http.client");
    replay.setAttributes({
      "mip.session_id": "sess-1",
      "mip.trace_id": "d".repeat(32),
      "mip.span_id": "e".repeat(16),
      "mip.parent_span_id": "f".repeat(16),
    });
    replay.end();
    await otel.forceFlush();
    expect(poste[0]).toMatchObject({
      traceId: "d".repeat(32),
      spanId: "e".repeat(16),
      parentSpanId: "f".repeat(16),
    });
  });
});

// ───────────────────── l'ingestion lit le champ natif en premier ──────────────

describe("flattenOtlp — le parent natif prime, l'attribut reste en repli", () => {
  const RESOURCE = { attributes: [{ key: "mip.app_id", value: { stringValue: "demo" } }] };
  const attrs = (o: Record<string, unknown>) =>
    Object.entries(o).map(([key, v]) => ({
      key,
      value: typeof v === "number" ? { doubleValue: v } : { stringValue: String(v) },
    }));

  /** Un span http.client, avec ou sans parent natif / attribut propriétaire. */
  function payload(over: Record<string, unknown>, a: Record<string, unknown> = {}) {
    return {
      resourceSpans: [
        {
          resource: RESOURCE,
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "a".repeat(32),
                  spanId: "0011223344556677",
                  name: "http.client",
                  startTimeUnixNano: "1760000000000000000",
                  endTimeUnixNano: "1760000000100000000",
                  attributes: attrs({
                    "mip.session_id": "sess-1",
                    "mip.trace_id": "a".repeat(32),
                    "mip.span_id": "0011223344556677",
                    "http.url": "https://api.demo.fr/x",
                    "http.method": "GET",
                    "http.status_code": 200,
                    "http.duration_ms": 42,
                    ...a,
                  }),
                  ...over,
                },
              ],
            },
          ],
        },
      ],
    };
  }
  const now = Date.parse("2025-10-09T09:00:00Z");
  const parent = (p: ReturnType<typeof payload>) => flattenOtlp(p, { now }).spans[0].parent_span_id;

  it("lit le champ OTLP natif", () => {
    expect(parent(payload({ parentSpanId: "aaaabbbbccccdddd" }))).toBe("aaaabbbbccccdddd");
  });

  // Un SDK déjà posé chez un client n'émet pas encore le champ natif. Cesser de
  // lire l'attribut casserait son waterfall à la seconde où l'ingestion serait
  // déployée — sans qu'aucun test ne le dise.
  it("retombe sur mip.parent_span_id quand le natif est absent", () => {
    expect(parent(payload({}, { "mip.parent_span_id": "1111222233334444" }))).toBe("1111222233334444");
  });

  it("le natif l'emporte sur l'attribut quand les deux sont là", () => {
    const p = payload({ parentSpanId: "aaaabbbbccccdddd" }, { "mip.parent_span_id": "1111222233334444" });
    expect(parent(p)).toBe("aaaabbbbccccdddd");
  });

  it("sans parent d'aucune sorte, la colonne reste nulle", () => {
    expect(parent(payload({}))).toBeNull();
  });

  // Un parentSpanId vide n'est pas un parent : `""` est ce que sérialisent
  // certains collecteurs pour « racine ». Le prendre au mot ferait une chaîne
  // vide en base, distincte de NULL, et le waterfall chercherait un span nommé
  // « » toute la journée.
  it("une chaîne vide n'est pas un parent", () => {
    expect(parent(payload({ parentSpanId: "" }))).toBeNull();
  });
});

// ─────────────── round-trip complet : ce que le SDK poste est relu ────────────

describe("round-trip — l'arbre du SDK survit à l'ingestion", () => {
  it("le span d'appel API arrive en base rattaché à la page vue", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Test" });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {} });
    vi.stubGlobal("addEventListener", () => {});
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    let enveloppe: unknown = null;
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      enveloppe = JSON.parse(init.body);
      return { ok: true };
    });
    vi.resetModules();
    const otel = await import("../../packages/rum-sdk/src/otel");

    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    otel.newPageTrace();
    const tid = otel.currentTraceId();
    const pv = tracer.startSpan("pageview");
    pv.setAttributes({ "mip.session_id": "sess-1", "mip.route": "/home", "mip.url": "https://a/b" });
    pv.end();
    const racine = otel.currentPageSpanId();
    const api = tracer.startSpan("http.client");
    api.setAttributes({
      "mip.session_id": "sess-1",
      "mip.trace_id": tid,
      "mip.span_id": "0011223344556677",
      "http.url": "https://api.demo.fr/x",
      "http.method": "GET",
      "http.status_code": 200,
      "http.duration_ms": 42,
    });
    api.end();
    await otel.forceFlush();

    const rows = flattenOtlp(enveloppe, { now: Date.parse("2025-10-09T09:00:00Z") });
    expect(rows.pageviews[0].span_id).toBe(racine);
    expect(rows.spans[0].parent_span_id).toBe(racine);
    expect(rows.spans[0].trace_id).toBe(tid);
    expect(rows.rejected).toBe(0);
    vi.unstubAllGlobals();
  });
});
