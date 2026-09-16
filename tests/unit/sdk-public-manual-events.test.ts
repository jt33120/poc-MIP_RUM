import { beforeEach, describe, expect, it, vi } from "vitest";

const { spans } = vi.hoisted(() => ({ spans: [] as Array<Record<string, unknown>> }));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans: () => {},
  newPageTrace: () => "a".repeat(32),
  initOtel: () => ({
    startSpan(name: string, opts?: { startTime?: number }) {
      const start = opts?.startTime ?? Date.now();
      const span: Record<string, unknown> = {
        name,
        traceId: "a".repeat(32),
        spanId: (spans.length + 1).toString(16).padStart(16, "0"),
        startTime: [Math.floor(start / 1000), (start % 1000) * 1_000_000],
        endTime: [Math.floor(start / 1000), (start % 1000) * 1_000_000],
        attributes: {},
      };
      return {
        setAttributes(attributes: Record<string, unknown>) { span.attributes = { ...attributes }; },
        end(end = Date.now()) {
          span.endTime = [Math.floor(end / 1000), (end % 1000) * 1_000_000];
          spans.push(span);
        },
      };
    },
  }),
}));
vi.mock("../../packages/rum-sdk/src/context", () => ({
  currentRoute: () => "/orders/:id",
  scrubUrl: (value: string) => value.split("?")[0],
  initNavigation: (callback: (kind: string) => void) => callback("navigate"),
}));
vi.mock("../../packages/rum-sdk/src/session", () => ({
  getOrCreateSession: () => ({ sessionId: "sdk-public-session", visitorId: "visitor-public" }),
  rotateSession: () => ({ sessionId: "sdk-rotated-session", visitorId: "visitor-public" }),
  touchSession: () => {},
}));
vi.mock("../../packages/rum-sdk/src/privacy", () => ({ readPrivacySignals: () => ({}), signalsOptOut: () => false }));
vi.mock("../../packages/rum-sdk/src/sampling", () => ({
  loadMode: () => null, decideMode: () => "full", storeMode: () => {},
  createSampler: () => ({ notifyError: () => {}, passes: () => true }),
}));
vi.mock("../../packages/rum-sdk/src/breadcrumbs", () => ({
  initClickBreadcrumbs: () => {},
  createBreadcrumbTrail: () => ({ add: () => {}, cap: { reset: () => {} } }),
}));
vi.mock("../../packages/rum-sdk/src/errors", () => ({ initErrors: () => ({ drainer: () => {}, reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/frustration", () => ({ initFrustration: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/resources", () => ({
  DEFAULT_SLOW_RESOURCE_MS: 1000,
  initResources: () => ({ reset: () => {} }),
}));
vi.mock("../../packages/rum-sdk/src/apispans", () => ({ initApiSpans: () => null }));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));
vi.mock("../../packages/rum-sdk/src/retry", () => ({ replayRetryQueue: () => 0 }));

import {
  addAction, addError, addFeatureFlagEvaluation, addTiming, consent, init,
  setGlobalContext, setUser, startView, track,
} from "../../packages/rum-sdk/src/index";
import { buildResourceSpans } from "../../packages/rum-sdk/src/otlp-encode";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

beforeEach(() => {
  spans.length = 0;
  vi.stubGlobal("document", {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: () => {}, head: { appendChild: () => {} }, createElement: () => ({}),
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("location", { href: "https://app.test/orders/42", pathname: "/orders/42" });
  vi.stubGlobal("addEventListener", () => {});
});

describe("API publique SDK → OTLP", () => {
  it("conserve la vue et la route, calcule le timing et propage le flag aux événements futurs", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    setGlobalContext({ phase: "A" });
    setUser("user-A");
    init({
      endpoint: "https://ingest.test/v1/traces", appId: "sdk-public-app", trace: false,
      requireConsent: true,
      beforeSend(attributes, meta) {
        if (meta?.type === "action" && meta.name === "Private action") {
          const next = { ...attributes };
          delete next["mip.event_name"];
          return next;
        }
        if (meta?.name !== "SensitiveError") return attributes;
        const next = { ...attributes, "mip.session_id": "forged" };
        for (const key of ["mip.context", "mip.props", "mip.identity.user_id", "mip.url", "exception.message", "exception.stacktrace"])
          delete next[key];
        return next;
      },
    });
    expect(startView("Checkout", { funnel: "payment" })).toBe(true);
    clock.mockReturnValue(1_800_000_000_125);
    expect(addTiming("ready")).toBe(true);
    expect(addFeatureFlagEvaluation("new_checkout", "A")).toBe(true);
    expect(addAction("pay", { step: 2 })).toBe(true);
    expect(spans).toHaveLength(0);
    setGlobalContext({ phase: "B" });
    setUser("user-B");
    expect(startView("Account B")).toBe(true);
    consent(true);
    expect(addAction("after_identity_change")).toBe(true);
    const manualError = new Error("private@example.test");
    manualError.name = "SensitiveError";
    manualError.stack = "secret stack";
    expect(addError(manualError, { secret: "context" })).toBe(true);
    expect(addAction("Private action")).toBe(false);
    expect(track("after_private_action")).toBe(true);

    const payload = buildResourceSpans(
      { "mip.app_id": "sdk-public-app" },
      spans as never,
    );
    const rows = flattenOtlp(payload, { now: 1_800_000_000_125 });
    const byType = Object.fromEntries(rows.events.map((event: Record<string, unknown>) => [event.event_type, event]));
    const checkoutView = rows.events.find((event: Record<string, unknown>) => event.event_type === "view" && event.name === "Checkout");
    expect(checkoutView).toMatchObject({ name: "Checkout", route: "/orders/:id", context: { funnel: "payment" } });
    expect(byType.timing).toMatchObject({ name: "ready", route: "/orders/:id", timing_ms: 125 });
    expect(byType.feature_flag).toMatchObject({ name: "new_checkout", feature_flag_value: "A" });
    const actions = rows.events.filter((event: Record<string, unknown>) => event.event_type === "action");
    const pay = actions.find((event: Record<string, unknown>) => event.name === "pay");
    expect(pay).toMatchObject({ name: "pay", route: "/orders/:id", context: {
      funnel: "payment", phase: "A", step: 2, feature_flags: { new_checkout: "A" },
    } });
    expect(byType.timing.view_id).toBe(checkoutView.view_id);
    expect(pay.view_id).toBe(checkoutView.view_id);
    expect(actions[0]).toMatchObject({ context: { phase: "A" } });
    expect(actions[0].session_id).toBe("sdk-public-session");
    expect(actions[1]).toMatchObject({ name: "after_identity_change", session_id: "sdk-rotated-session", context: { phase: "B" } });
    const rawSpans = spans.map((span) => span.attributes as Record<string, unknown>);
    expect(rawSpans.find((attrs) => attrs["mip.event_name"] === "pay")?.["mip.identity.user_id"]).toBe("user-A");
    expect(rawSpans.find((attrs) => attrs["mip.event_name"] === "after_identity_change")?.["mip.identity.user_id"]).toBe("user-B");
    const redacted = rawSpans.find((attrs) => attrs["mip.event_name"] === "SensitiveError")!;
    expect(redacted["mip.session_id"]).toBe("sdk-rotated-session");
    for (const key of ["mip.context", "mip.identity.user_id", "exception.message", "exception.stacktrace"])
      expect(redacted).not.toHaveProperty(key);
    const afterRejectedAction = rawSpans.find((attrs) => attrs["mip.event_name"] === "after_private_action")!;
    expect(afterRejectedAction).not.toHaveProperty("mip.action_id");
    clock.mockRestore();
  });
});
