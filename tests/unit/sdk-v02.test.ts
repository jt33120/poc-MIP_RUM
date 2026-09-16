// SDK v0.2 — logique pure (caps, retry, breadcrumbs, consent), sans DOM réel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeq, formatClickLabel } from "../../packages/rum-sdk/src/breadcrumbs";
import { makeCap } from "../../packages/rum-sdk/src/caps";
import { CONSENT_BUFFER_CAP, ConsentGate } from "../../packages/rum-sdk/src/consent";
import {
  appendRetry,
  ExportResultCode,
  loadRetryQueue,
  purgeRetryQueue,
  replayRetryQueue,
  RETRY_KEY,
  RETRY_REVOKED_ACTIONS_KEY,
  RetryExporter,
  serializeSpan,
  type RetrySpan,
} from "../../packages/rum-sdk/src/retry";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe("caps par page", () => {
  it("accepte jusqu'au plafond puis refuse, reset rouvre", () => {
    const cap = makeCap(2);
    expect(cap.take()).toBe(true);
    expect(cap.take()).toBe(true);
    expect(cap.take()).toBe(false);
    expect(cap.count()).toBe(2);
    cap.reset();
    expect(cap.take()).toBe(true);
  });
});

describe("breadcrumb labels", () => {
  it("tag + texte tronqué à 40 caractères", () => {
    const long = "x".repeat(60);
    expect(formatClickLabel("BUTTON", long, null)).toBe(`button "${"x".repeat(40)}"`);
  });
  it("espaces normalisés", () => {
    expect(formatClickLabel("A", "  Voir \n  le détail ", null)).toBe('a "Voir le détail"');
  });
  it("aria-label en secours quand pas de texte (bouton-icône)", () => {
    expect(formatClickLabel("BUTTON", "  ", "Fermer la modale")).toBe('button "Fermer la modale"');
  });
  it("tag seul si ni texte ni aria-label", () => {
    expect(formatClickLabel("DIV", null, null)).toBe("div");
  });
});

describe("breadcrumb seq (compteur session)", () => {
  beforeEach(() => stubLocalStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("incrémental et persisté entre deux loads", () => {
    const next = createSeq();
    expect(next()).toBe(1);
    expect(next()).toBe(2);
    const nextAfterReload = createSeq(); // nouveau load : repart du stockage
    expect(nextAfterReload()).toBe(3);
  });
});

describe("retry — sérialisation", () => {
  it("garde les identifiants natifs, les attributs primitifs et les timestamps en ms", () => {
    const s = serializeSpan({
      name: "webvital.LCP",
      attributes: { "webvital.value": 1234.5, "mip.route": "/login", ok: true, nested: { a: 1 } },
      startTime: [1_700_000_000, 500_000_000],
      endTime: [1_700_000_001, 0],
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      parentSpanId: "c".repeat(16),
    });
    expect(s.n).toBe("webvital.LCP");
    expect(s.a).toEqual({
      "webvital.value": 1234.5,
      "mip.route": "/login",
      ok: true,
      "mip.trace_id": "a".repeat(32),
      "mip.span_id": "b".repeat(16),
      "mip.parent_span_id": "c".repeat(16),
    });
    expect(s.s).toBe(1_700_000_000_500);
    expect(s.e).toBe(1_700_000_001_000);
  });

  it("sérialise explicitement l'absence de parent pour préserver une racine au rejeu", () => {
    const s = serializeSpan({
      name: "rum.action",
      attributes: { "mip.action_id": "11111111-2222-4333-8444-555555555555" },
      startTime: [1, 0],
      endTime: [2, 0],
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
    });
    expect(s.a["mip.parent_span_id"]).toBe("");
  });
});

describe("retry — caps de la file", () => {
  const mk = (i: number): RetrySpan => ({ n: `span-${i}`, a: {}, s: i, e: i });

  it("cap en nombre : garde les 100 plus récents", () => {
    const queue = appendRetry([], Array.from({ length: 150 }, (_, i) => mk(i)));
    expect(queue.length).toBe(100);
    expect(queue[0].n).toBe("span-50");
    expect(queue[99].n).toBe("span-149");
  });

  it("cap en octets : purge les plus anciens jusqu'à passer sous ~50 Ko", () => {
    const fat = (i: number): RetrySpan => ({ n: `fat-${i}`, a: { pad: "y".repeat(1000) }, s: i, e: i });
    const queue = appendRetry([], Array.from({ length: 80 }, (_, i) => fat(i)));
    expect(JSON.stringify(queue).length).toBeLessThanOrEqual(50_000);
    expect(queue[queue.length - 1].n).toBe("fat-79"); // les récents survivent
    expect(queue.length).toBeLessThan(80);
  });
});

describe("retry — décorateur d'exporter + rejeu", () => {
  beforeEach(() => {
    stubLocalStorage();
    purgeRetryQueue();
  });
  afterEach(() => vi.unstubAllGlobals());

  const fakeSpan = (name: string) =>
    ({
      name,
      attributes: { "mip.route": "/" },
      startTime: [1, 0],
      endTime: [2, 0],
    }) as never;

  it("export FAILED -> spans persistés dans localStorage", () => {
    const inner = {
      export: (_spans: never[], cb: (r: { code: ExportResultCode }) => void) =>
        cb({ code: ExportResultCode.FAILED }),
      shutdown: () => Promise.resolve(),
    };
    const exporter = new RetryExporter(inner as never);
    const results: number[] = [];
    exporter.export([fakeSpan("pageview")] as never, (r) => results.push(r.code));
    expect(results).toEqual([ExportResultCode.FAILED]); // le résultat inner est propagé
    const file = loadRetryQueue();
    expect(file.spans.length).toBe(1);
    expect(file.spans[0].n).toBe("pageview");
    // v59 : la file porte son échéance. Un échec sans `retryable` explicite est
    // traité comme rejouable — le comportement d'avant, pour tout exporteur
    // tiers qui ne connaîtrait pas le champ.
    expect(file.tentatives).toBe(1);
    expect(file.notBefore).toBeGreaterThan(Date.now());
  });

  it("un enfant envoyé après une racine en retry est délié, jamais orphelin", () => {
    const sent: Array<Array<{ name: string; attributes: Record<string, unknown> }>> = [];
    const inner = {
      export: (spans: Array<{ name: string; attributes: Record<string, unknown> }>, cb: (r: { code: ExportResultCode }) => void) => {
        sent.push(spans);
        cb({ code: sent.length === 1 ? ExportResultCode.FAILED : ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    const exporter = new RetryExporter(inner as never);
    const actionId = "11111111-2222-4333-8444-555555555555";
    exporter.export([{
      name: "rum.action",
      attributes: { "mip.event_type": "action", "mip.action_id": actionId },
      startTime: [1, 0], endTime: [2, 0],
    }] as never, () => {});
    exporter.export([{
      name: "exception",
      attributes: { "mip.action_id": actionId },
      startTime: [3, 0], endTime: [4, 0],
    }] as never, () => {});

    expect(sent.map((batch) => batch.map((span) => span.name))).toEqual([["rum.action"], ["exception"]]);
    expect(sent[1][0].attributes).not.toHaveProperty("mip.action_id");
    expect(loadRetryQueue().spans.map((span) => span.n)).toEqual(["rum.action"]);
  });

  it("délie l'enfant si le stockage de sa racine échoue sur quota", () => {
    const store = new Map<string, string>();
    let rejectRootFile = true;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === RETRY_KEY && rejectRootFile) {
          rejectRootFile = false;
          throw new DOMException("quota", "QuotaExceededError");
        }
        store.set(key, value);
      },
      removeItem: (key: string) => void store.delete(key),
    });
    purgeRetryQueue();
    const inner = {
      export: (_spans: never[], cb: (r: { code: ExportResultCode }) => void) =>
        cb({ code: ExportResultCode.FAILED }),
      shutdown: () => Promise.resolve(),
    };
    const exporter = new RetryExporter(inner as never);
    const actionId = "11111111-2222-4333-8444-555555555555";
    exporter.export([{
      name: "rum.action",
      attributes: { "mip.event_type": "action", "mip.action_id": actionId },
      startTime: [1, 0], endTime: [2, 0],
    }] as never, () => {});
    exporter.export([{
      name: "exception",
      attributes: { "mip.action_id": actionId },
      startTime: [3, 0], endTime: [4, 0],
    }] as never, () => {});

    expect(loadRetryQueue().spans).toHaveLength(1);
    expect(loadRetryQueue().spans[0].a).not.toHaveProperty("mip.action_id");
  });

  it("export SUCCESS -> rien n'est persisté", () => {
    const inner = {
      export: (_spans: never[], cb: (r: { code: ExportResultCode }) => void) =>
        cb({ code: ExportResultCode.SUCCESS }),
      shutdown: () => Promise.resolve(),
    };
    new RetryExporter(inner as never).export([fakeSpan("pageview")] as never, () => {});
    expect(loadRetryQueue().spans).toEqual([]);
  });

  it("retire avant un export réussi le lien vers une racine retry déjà évincée", () => {
    const actionId = "11111111-2222-4333-8444-555555555555";
    localStorage.setItem(RETRY_REVOKED_ACTIONS_KEY, JSON.stringify([actionId]));
    let outbound: Array<{ attributes: Record<string, unknown> }> = [];
    const inner = {
      export: (spans: typeof outbound, cb: (r: { code: ExportResultCode }) => void) => {
        outbound = spans;
        cb({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    const child = {
      name: "http.client",
      attributes: { "mip.action_id": actionId },
      startTime: [1, 0],
      endTime: [2, 0],
    };
    new RetryExporter(inner as never).export([child] as never, () => {});
    expect(outbound[0].attributes).not.toHaveProperty("mip.action_id");
  });

  it("garde en mémoire plus de 200 racines évincées tant que leurs effets peuvent finir", () => {
    const failed = {
      export: (_spans: never[], cb: (r: { code: ExportResultCode }) => void) =>
        cb({ code: ExportResultCode.FAILED }),
      shutdown: () => Promise.resolve(),
    };
    const exporter = new RetryExporter(failed as never);
    const ids = Array.from({ length: 201 }, (_, i) =>
      `${i.toString(16).padStart(8, "0")}-2222-4333-8444-555555555555`);
    for (const [i, actionId] of ids.entries()) {
      const root = {
        name: "rum.action",
        attributes: { "mip.event_type": "action", "mip.action_id": actionId },
        startTime: [1, i], endTime: [2, i],
      };
      const fillers = Array.from({ length: 100 }, (_, j) => ({
        name: `span-${i}-${j}`, attributes: {}, startTime: [1, j], endTime: [2, j],
      }));
      exporter.export([root, ...fillers] as never, () => {});
    }
    const persisted = JSON.parse(localStorage.getItem(RETRY_REVOKED_ACTIONS_KEY) ?? "[]") as string[];
    expect(persisted).toHaveLength(200);
    expect(persisted).not.toContain(ids[0]);

    let outbound: Array<{ attributes: Record<string, unknown> }> = [];
    const succeeds = {
      export: (spans: typeof outbound, cb: (r: { code: ExportResultCode }) => void) => {
        outbound = spans;
        cb({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    new RetryExporter(succeeds as never).export([{
      name: "http.client",
      attributes: { "mip.action_id": ids[0] },
      startTime: [1, 0], endTime: [2, 0],
    }] as never, () => {});
    expect(outbound[0].attributes).not.toHaveProperty("mip.action_id");
  });

  it("replayRetryQueue ré-émet avec timestamps d'origine puis purge", () => {
    localStorage.setItem(
      RETRY_KEY,
      JSON.stringify([{ n: "longtask", a: { "longtask.duration_ms": 320 }, s: 1000, e: 1320 }]),
    );
    const replayed: Array<[string, number, number]> = [];
    const n = replayRetryQueue((name, _attrs, s, e) => replayed.push([name, s, e]));
    expect(n).toBe(1);
    expect(replayed).toEqual([["longtask", 1000, 1320]]);
    expect(loadRetryQueue().spans).toEqual([]); // purgée
  });
});

describe("consent gate", () => {
  it("défaut (pas de consent requis) : passe directement", () => {
    const gate = new ConsentGate(false);
    const out: string[] = [];
    gate.submit("pageview", {}, (n) => out.push(n));
    expect(out).toEqual(["pageview"]);
    expect(gate.bufferSize()).toBe(0);
  });

  it("requireConsent : bufferise sans livrer, consent(true) rejoue dans l'ordre avec ts d'origine", () => {
    const gate = new ConsentGate(true);
    const out: Array<[string, number | undefined]> = [];
    const deliver = (n: string, _a: Record<string, never>, ts?: number) => out.push([n, ts]);
    gate.submit("pageview", {}, deliver as never, 111);
    gate.submit("webvital.LCP", {}, deliver as never, 222);
    expect(out).toEqual([]); // rien ne part avant le consentement
    expect(gate.bufferSize()).toBe(2);
    gate.set(true, deliver as never);
    expect(out).toEqual([["pageview", 111], ["webvital.LCP", 222]]);
    gate.submit("breadcrumb", {}, deliver as never, 333); // post-consent : direct
    expect(out.length).toBe(3);
  });

  it("consent(false) : purge le buffer et désactive définitivement", () => {
    const gate = new ConsentGate(true);
    const out: string[] = [];
    const deliver = (n: string) => out.push(n);
    gate.submit("pageview", {}, deliver as never);
    gate.set(false, deliver as never);
    expect(gate.bufferSize()).toBe(0);
    gate.submit("exception", {}, deliver as never);
    expect(out).toEqual([]);
  });

  // Le retour de submit() est le seul moyen pour un appelant de savoir si son
  // événement est parti. Le widget d'avis s'en sert pour deux décisions
  // visibles par l'utilisateur : afficher « envoyé », et armer sa période de
  // silence. Se tromper ici, c'est faire taire le widget sur un avis perdu.
  it("submit() dit si l'événement est pris en charge (livré, bufferisé) ou jeté", () => {
    const granted = new ConsentGate(false);
    expect(granted.submit("feedback", {}, () => {})).toBe(true);

    const pending = new ConsentGate(true);
    expect(pending.submit("feedback", {}, () => {})).toBe(true); // bufferisé = partira

    const denied = new ConsentGate(true);
    denied.set(false, () => {});
    expect(denied.submit("feedback", {}, () => {})).toBe(false); // jeté
  });

  it("buffer cap 200 : FIFO, les plus récents sont conservés", () => {
    const gate = new ConsentGate(true);
    for (let i = 0; i < CONSENT_BUFFER_CAP + 50; i++) gate.submit(`e-${i}`, {}, () => {});
    expect(gate.bufferSize()).toBe(CONSENT_BUFFER_CAP);
    const out: string[] = [];
    gate.set(true, ((n: string) => out.push(n)) as never);
    expect(out[0]).toBe("e-50");
    expect(out[out.length - 1]).toBe(`e-${CONSENT_BUFFER_CAP + 49}`);
  });
});
