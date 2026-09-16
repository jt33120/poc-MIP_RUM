import { beforeEach, describe, expect, it, vi } from "vitest";

const { spans, errorOrigins, apiHook, drainErrors, resetErrors, purgeRetryQueue, discardPendingSpans, hookState } = vi.hoisted(() => ({
  spans: [] as Array<{ name: string; attributes: Record<string, unknown> }>,
  errorOrigins: [] as Array<(at: number) => Record<string, unknown>>,
  apiHook: {
    emit: null as null | ((name: string, attrs: Record<string, unknown>, ts?: number) => boolean),
    action: null as null | (() => Record<string, unknown>),
  },
  drainErrors: vi.fn(),
  resetErrors: vi.fn(),
  purgeRetryQueue: vi.fn(),
  discardPendingSpans: vi.fn(),
  hookState: { rejectError: true },
}));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans,
  newPageTrace: () => "a".repeat(32),
  initOtel: () => ({
    startSpan(name: string) {
      const row = { name, attributes: {} as Record<string, unknown> };
      return {
        setAttributes(attributes: Record<string, unknown>) { row.attributes = { ...attributes }; },
        end() { spans.push(row); },
      };
    },
  }),
}));
vi.mock("../../packages/rum-sdk/src/context", () => ({
  currentRoute: () => "/checkout",
  scrubUrl: (value: string) => value,
  initNavigation: () => {},
}));
vi.mock("../../packages/rum-sdk/src/session", () => ({
  getOrCreateSession: () => ({ sessionId: "biased-session", visitorId: "biased-visitor" }),
  rotateSession: () => ({ sessionId: "rotated", visitorId: "biased-visitor" }),
  touchSession: () => {},
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", () => ({
  loadMode: () => null,
  decideMode: () => "error-biased",
  storeMode: () => {},
  createSampler: () => {
    let mode = "error-biased";
    return {
      passes: (name: string) => mode === "full" || name === "exception",
      notifyError: () => { mode = "full"; },
    };
  },
}));
vi.mock("../../packages/rum-sdk/src/breadcrumbs", () => ({
  initClickBreadcrumbs: () => {},
  createBreadcrumbTrail: () => ({ add: () => {}, cap: { reset: () => {} } }),
}));
vi.mock("../../packages/rum-sdk/src/errors", () => ({
  initErrors: (
    _emit: unknown,
    _clock: unknown,
    origin: (at: number) => Record<string, unknown>,
  ) => {
    errorOrigins.push(origin);
    return { drainer: drainErrors, reset: resetErrors };
  },
}));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/frustration", () => ({
  initFrustration: (emit: (name: string, attrs: Record<string, unknown>, ts?: number) => void) => ({
    reset: () => {},
    error: (attrs: Record<string, unknown>, target: string, ts?: number) => emit("frustration", {
      ...attrs,
      "frustration.kind": "error",
      "frustration.target": target,
      "frustration.count": 1,
    }, ts),
  }),
}));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/resources", () => ({ DEFAULT_SLOW_RESOURCE_MS: 1000, initResources: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/apispans", () => ({
  initApiSpans: (
    emit: (name: string, attrs: Record<string, unknown>, ts?: number) => boolean,
    options: { action: () => Record<string, unknown> },
  ) => {
    apiHook.emit = emit;
    apiHook.action = options.action;
    return { reset: () => {} };
  },
}));
vi.mock("../../packages/rum-sdk/src/replay", () => ({ flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {} }));
vi.mock("../../packages/rum-sdk/src/retry", () => ({ replayRetryQueue: () => 0, purgeRetryQueue }));

import { addAction, addError, consent, init, setUser } from "../../packages/rum-sdk/src/index";

beforeEach(() => {
  spans.length = 0;
  errorOrigins.length = 0;
  apiHook.emit = null;
  apiHook.action = null;
  drainErrors.mockClear();
  resetErrors.mockClear();
  purgeRetryQueue.mockClear();
  discardPendingSpans.mockClear();
  hookState.rejectError = true;
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  vi.stubGlobal("document", {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: () => {}, removeEventListener: () => {},
  });
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { href: "https://app.test/checkout", pathname: "/checkout" });
  vi.stubGlobal("addEventListener", () => {});
});

describe("câblage error-biased des actions", () => {
  it("rejoue la racine avant l'unique error click puis l'exception", () => {
    setUser("origin-user");
    init({
      endpoint: "https://ingest.test/v1/traces",
      appId: "biased-app",
      trace: true,
      beforeSend: (attributes, meta) => meta?.type === "error" && hookState.rejectError ? null : attributes,
    });
    expect(addAction("Payer", { step: "confirm" })).toBe(false);
    const errorOrigin = errorOrigins[0](Date.now());
    expect(errorOrigin).toMatchObject({
      "mip.session_id": "biased-session",
      "mip.identity.user_id": "origin-user",
    });
    expect(spans).toEqual([]);
    expect(addError(new Error("ignored"))).toBe(false);
    expect(spans).toEqual([]);
    hookState.rejectError = false;
    expect(addError(new Error("boom"), { step: "error", local: true })).toBe(true);
    expect(spans.map((span) => span.name)).toEqual(["rum.action", "frustration", "exception"]);
    const ids = spans.map((span) => span.attributes["mip.action_id"]);
    expect(ids[0]).toMatch(/^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/);
    expect(ids).toEqual([ids[0], ids[0], ids[0]]);
    expect(spans[1].attributes).not.toHaveProperty("exception.message");
    expect(spans[1].attributes["frustration.target"]).toBe("action");
    expect(spans[0].attributes).toMatchObject({
      "mip.event_type": "action",
      "mip.event_name": "Payer",
      "mip.context": JSON.stringify({ step: "confirm" }),
      "mip.identity.user_id": "origin-user",
    });
    expect(JSON.parse(String(spans[2].attributes["mip.context"]))).toEqual({
      step: "error",
      local: true,
    });

    setUser("next-user");
    expect(errorOrigin["mip.identity.user_id"]).toBe("origin-user");
    expect(drainErrors).toHaveBeenCalledTimes(1);
    expect(resetErrors).toHaveBeenCalledTimes(1);

    const beforeRefusal = apiHook.action!();
    consent(false);
    const duringRefusal = apiHook.action!();
    expect(resetErrors).toHaveBeenCalledTimes(2);
    expect(purgeRetryQueue).toHaveBeenCalledTimes(1);
    expect(discardPendingSpans).toHaveBeenCalledTimes(1);

    consent(true);
    expect(resetErrors).toHaveBeenCalledTimes(3);
    const countAfterReconsent = spans.length;
    expect(apiHook.emit!("http.client", beforeRefusal, Date.now())).toBe(false);
    expect(apiHook.emit!("http.client", duringRefusal, Date.now())).toBe(false);
    expect(spans).toHaveLength(countAfterReconsent);
  });
});
