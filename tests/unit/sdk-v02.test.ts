// SDK v0.2 — logique pure (caps, retry, breadcrumbs, consent), sans DOM réel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeq, formatClickLabel } from "../../packages/rum-sdk/src/breadcrumbs";
import { makeCap } from "../../packages/rum-sdk/src/caps";
import { CONSENT_BUFFER_CAP, ConsentGate } from "../../packages/rum-sdk/src/consent";
import {
  appendRetry,
  ExportResultCode,
  loadRetryQueue,
  replayRetryQueue,
  RETRY_KEY,
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
  it("ne garde que name + attributs primitifs + timestamps en ms", () => {
    const s = serializeSpan({
      name: "webvital.LCP",
      attributes: { "webvital.value": 1234.5, "mip.route": "/login", ok: true, nested: { a: 1 } },
      startTime: [1_700_000_000, 500_000_000],
      endTime: [1_700_000_001, 0],
    });
    expect(s.n).toBe("webvital.LCP");
    expect(s.a).toEqual({ "webvital.value": 1234.5, "mip.route": "/login", ok: true });
    expect(s.s).toBe(1_700_000_000_500);
    expect(s.e).toBe(1_700_000_001_000);
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
  beforeEach(() => stubLocalStorage());
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
    const queue = loadRetryQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].n).toBe("pageview");
  });

  it("export SUCCESS -> rien n'est persisté", () => {
    const inner = {
      export: (_spans: never[], cb: (r: { code: ExportResultCode }) => void) =>
        cb({ code: ExportResultCode.SUCCESS }),
      shutdown: () => Promise.resolve(),
    };
    new RetryExporter(inner as never).export([fakeSpan("pageview")] as never, () => {});
    expect(loadRetryQueue()).toEqual([]);
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
    expect(loadRetryQueue()).toEqual([]); // purgée
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
