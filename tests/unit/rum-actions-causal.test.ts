import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_WINDOW_MS,
  ActionTracker,
  automaticActionName,
  initAutomaticActions,
} from "../../packages/rum-sdk/src/actions";
import { ConsentGate } from "../../packages/rum-sdk/src/consent";
import { appendRetry, type RetrySpan } from "../../packages/rum-sdk/src/retry";
import { initResources } from "../../packages/rum-sdk/src/resources";
import { initClickBreadcrumbs, type BreadcrumbTrail } from "../../packages/rum-sdk/src/breadcrumbs";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

afterEach(() => vi.unstubAllGlobals());

type RootDecision = boolean | "accepted" | "sampled_out" | "rejected";
function trackerFixture(accept: RootDecision | (() => RootDecision) = true) {
  let now = 1_000;
  let sessionId = "session-a";
  const emitted: Array<{ attrs: Record<string, string | number | boolean>; ts: number }> = [];
  const ids = [A, B];
  const tracker = new ActionTracker({
    now: () => now,
    sessionId: () => sessionId,
    newId: () => ids.shift()!,
    rootSnapshot: (context) => ({
      "mip.route": "/checkout",
      "mip.context": JSON.stringify(context),
    }),
    emitRoot(attrs, ts) {
      emitted.push({ attrs: { ...attrs }, ts });
      return typeof accept === "function" ? accept() : accept;
    },
  });
  return {
    tracker,
    emitted,
    tick: (ms: number) => { now += ms; },
    rotate: () => { sessionId = "session-b"; },
  };
}

describe("tracker d'actions causales", () => {
  it("applique 5 s, dernier clic pour les nouveaux effets et conserve le snapshot A après B", () => {
    const f = trackerFixture();
    expect(f.tracker.open("Payer", "click", { step: "confirm" })).toBe(true);
    const requestA = f.tracker.current()!.attrs;
    f.tick(100);
    expect(f.tracker.open("Annuler", "click")).toBe(true);
    expect(f.tracker.current()?.id).toBe(B);
    expect(f.tracker.validate(requestA)["mip.action_id"]).toBe(A);
    f.tick(ACTION_WINDOW_MS + 1);
    expect(f.tracker.current()).toBeNull();
  });

  it("ne lie aucun enfant à une racine refusée", () => {
    const f = trackerFixture(false);
    expect(f.tracker.open("Rejetée", "click")).toBe(false);
    expect(f.tracker.current()).toBeNull();
    expect(f.tracker.validate({ "mip.action_id": A, "mip.action_epoch": 0 })).not.toHaveProperty("mip.action_id");
  });

  it("rejoue une racine error-biased avant les signaux et n'émet qu'un error click", () => {
    let attempt = 0;
    const f = trackerFixture(() => ++attempt > 1 ? "accepted" : "sampled_out");
    expect(f.tracker.open("Payer", "click")).toBe(false);
    const order: string[] = [];
    const link = f.tracker.forError();
    if (link) order.push("rum.action");
    if (link && f.tracker.markError(link.id)) order.push("frustration.error");
    if (link) order.push("exception");
    if (link && f.tracker.markError(link.id)) order.push("frustration.error");
    expect(f.emitted.map((event) => event.attrs["mip.action_id"])).toEqual([A, A]);
    expect(order).toEqual(["rum.action", "frustration.error", "exception"]);
  });

  it("ne ressuscite jamais une racine explicitement rejetée par beforeSend", () => {
    let calls = 0;
    const f = trackerFixture(() => ++calls === 1 ? "rejected" : "accepted");
    expect(f.tracker.open("Privée", "click")).toBe(false);
    expect(f.tracker.errorCandidate()).toBeNull();
    expect(f.tracker.forError()).toBeNull();
    expect(calls).toBe(1);
  });

  it("ne réattribue pas une ressource postérieure à un clic rejeté vers l'action précédente", () => {
    let calls = 0;
    const f = trackerFixture(() => ++calls === 1 ? "accepted" : "rejected");
    expect(f.tracker.open("A", "click")).toBe(true);
    f.tick(50);
    expect(f.tracker.atTimestamp(1_025)?.id).toBe(A);
    f.tick(50);
    expect(f.tracker.open("B privée", "click")).toBe(false);
    expect(f.tracker.atTimestamp(1_110)).toBeNull();
    f.tick(5_901);
    expect(f.tracker.atTimestamp(7_001)).toBeNull();
    // Même après le nettoyage déclenché bien plus tard, B reste la barrière
    // chronologique pour cette ressource lente partie juste après son clic.
    expect(f.tracker.atTimestamp(1_110)).toBeNull();
  });

  it("conserve le candidat async error-biased jusqu'à sa promotion", () => {
    let promoted = false;
    const f = trackerFixture(() => promoted ? "accepted" : "sampled_out");
    expect(f.tracker.open("Payer", "click")).toBe(false);
    const pendingFetch = f.tracker.origin()!.attrs;
    expect(f.tracker.validate(pendingFetch)).not.toHaveProperty("mip.action_id");
    promoted = true;
    expect(f.tracker.forError()?.id).toBe(A);
    expect(f.tracker.validate(pendingFetch)["mip.action_id"]).toBe(A);
  });

  it("purge au refus de consentement et révoque les callbacks après rotation", () => {
    const f = trackerFixture();
    f.tracker.open("Payer", "click");
    const original = f.tracker.current()!.attrs;
    f.rotate();
    expect(f.tracker.validate(original)).not.toHaveProperty("mip.action_id");
    f.tracker.consent(false);
    expect(f.tracker.open("Interdite", "click")).toBe(false);
    f.tracker.consent(true);
    expect(f.tracker.open("Nouvelle", "click")).toBe(true);
  });

  it("valide un snapshot asynchrone même après plus de 200 actions acceptées", () => {
    let id = 0;
    const tracker = new ActionTracker({
      sessionId: () => "long-session",
      newId: () => `action-${++id}`,
      rootSnapshot: () => ({ "mip.session_id": "long-session", "mip.route": "/spa" }),
      emitRoot: () => true,
    });
    tracker.open("Action 1", "click");
    const first = tracker.current()!.attrs;
    for (let i = 2; i <= 250; i++) tracker.open(`Action ${i}`, "click");
    expect(tracker.validate(first)["mip.action_id"]).toBe("action-1");
  });
});

describe("nom automatique sans contenu de formulaire", () => {
  function element(tag: string, attrs: Record<string, string> = {}, text = "") {
    const fake = {
      tagName: tag.toUpperCase(),
      textContent: text,
      labels: null,
      getAttribute(name: string) { return attrs[name] ?? null; },
    };
    Object.defineProperty(fake, "value", { get: () => { throw new Error("value ne doit pas être lue"); } });
    return fake as unknown as Element;
  }

  it("préfère l'override, revient au libellé et ne lit jamais value", () => {
    expect(automaticActionName(element("button", { "data-mip-action-name": "checkout.submit" }, "Payer")))
      .toBe("checkout.submit");
    expect(automaticActionName(element("button", { "data-mip-action-name": "   " }, "Payer maintenant")))
      .toBe('button "Payer maintenant"');
    expect(automaticActionName(element("input", { type: "password", "aria-label": "Mot de passe" })))
      .toBe('input:password "Mot de passe"');
  });

  it("ignore l'UI MIP et déduplique le clic synthétique label → contrôle", () => {
    let listener: ((event: MouseEvent) => void) | null = null;
    let removed: EventListener | null = null;

    class FakeElement {
      tagName: string;
      textContent: string;
      labels = null;
      control: FakeElement | null = null;

      constructor(
        tag: string,
        text = "",
        private readonly attrs: Record<string, string> = {},
        private readonly internal = false,
      ) {
        this.tagName = tag.toUpperCase();
        this.textContent = text;
      }

      getAttribute(name: string) { return this.attrs[name] ?? null; }
      closest(selector: string) {
        if (selector === "[data-mip-rum-ui]") return this.internal ? this : null;
        return this;
      }
    }

    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", {
      addEventListener(_type: string, callback: EventListener) {
        listener = callback as (event: MouseEvent) => void;
      },
      removeEventListener(_type: string, callback: EventListener) { removed = callback; },
      getElementById() { return null; },
    });

    const open = vi.fn(() => true);
    const watch = initAutomaticActions({ open } as unknown as ActionTracker);
    const click = (target: FakeElement, detail = 1) => listener!({ button: 0, detail, target } as unknown as MouseEvent);

    click(new FakeElement("button", "Interne", {}, true));
    expect(open).not.toHaveBeenCalled();

    const control = new FakeElement("input", "", { type: "checkbox" });
    const label = new FakeElement("label", "Notifications");
    label.control = control;
    click(label);
    click(control, 0);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith('label "Notifications"', "click");

    click(new FakeElement("button", "Payer"));
    expect(open).toHaveBeenCalledTimes(2);
    watch.stop();
    expect(removed).toBe(listener);
  });
});

describe("collecteurs causaux navigateur", () => {
  it("attribue une ressource selon son timestamp de départ, pas l'action courante à l'observation", () => {
    let callback: ((list: { getEntries(): unknown[] }) => void) | null = null;
    class FakeObserver {
      constructor(cb: typeof callback) { callback = cb; }
      observe() {}
    }
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    vi.stubGlobal("performance", { timeOrigin: 1_000, now: () => 500 });
    const emitted: Array<{ attrs: Record<string, unknown>; ts?: number }> = [];
    initResources((_name, attrs, ts) => { emitted.push({ attrs, ts }); }, {
      slowResourceMs: 10,
      endpoint: "https://ingest.test/v1/traces",
      actionAt(at) {
        expect(at).toBe(1_050);
        return { "mip.action_id": A };
      },
    });
    callback!({ getEntries: () => [{
      name: "https://app.test/chunk.js", initiatorType: "script", startTime: 50,
      duration: 1_300, transferSize: 12,
    }] });
    expect(emitted[0].attrs["mip.action_id"]).toBe(A);
    expect(emitted[0].ts).toBe(1_050);
  });

  it("propage au breadcrumb le snapshot du clic correspondant", () => {
    let listener: ((event: MouseEvent) => void) | null = null;
    class FakeElement {
      tagName = "BUTTON";
      textContent = "Payer";
      getAttribute() { return null; }
      closest(selector: string) { return selector === "[data-mip-rum-ui]" ? null : this; }
    }
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { addEventListener: (_type: string, cb: (event: MouseEvent) => void) => { listener = cb; } });
    const add = vi.fn();
    const trail = { add, cap: { take: () => true, reset() {}, count: () => 0 } } as unknown as BreadcrumbTrail;
    let actionId = A;
    initClickBreadcrumbs(trail, () => ({ "mip.action_id": actionId }));
    listener!({ button: 0, detail: 1, target: new FakeElement() } as unknown as MouseEvent);
    actionId = B;
    listener!({ button: 0, detail: 1, target: new FakeElement() } as unknown as MouseEvent);
    expect(add.mock.calls.map((call) => call[2]["mip.action_id"])).toEqual([A, B]);
  });
});

describe("intégrité racine/enfants dans les buffers", () => {
  it("retire les enfants quand la racine sort du buffer de consentement", () => {
    const gate = new ConsentGate(true, 2);
    const root = { "mip.event_type": "action", "mip.action_id": A };
    gate.submit("rum.action", root, () => {});
    gate.submit("http.client", { "mip.action_id": A }, () => {});
    gate.submit("pageview", {}, () => {}); // évince la racine et purge son enfant
    const delivered: Array<Record<string, unknown>> = [];
    gate.set(true, ((_name: string, attrs: Record<string, unknown>) => delivered.push(attrs)) as never);
    expect(delivered).toEqual([{}]);
    gate.submit("http.client", { "mip.action_id": A }, ((_name: string, attrs: Record<string, unknown>) => delivered.push(attrs)) as never);
    expect(delivered[1]).not.toHaveProperty("mip.action_id");
  });

  it("retire le lien des enfants survivants si la racine sort de la file retry", () => {
    const span = (n: string, attrs: Record<string, string>, i: number): RetrySpan => ({ n, a: attrs, s: i, e: i });
    const queue = appendRetry([], [
      span("rum.action", { "mip.event_type": "action", "mip.action_id": A }, 1),
      span("http.client", { "mip.action_id": A }, 2),
      span("pageview", {}, 3),
    ], 2, 50_000);
    expect(queue).toHaveLength(2);
    expect(queue[0].a).not.toHaveProperty("mip.action_id");
  });

  it("mémorise une racine retry évincée pour les callbacks arrivant dans un lot ultérieur", () => {
    const span = (n: string, attrs: Record<string, string>, i: number): RetrySpan => ({ n, a: attrs, s: i, e: i });
    const revoked = new Set<string>();
    const first = appendRetry([], [
      span("rum.action", { "mip.event_type": "action", "mip.action_id": A }, 1),
      span("pageview", {}, 2),
    ], 1, 50_000, revoked);
    expect(revoked.has(A)).toBe(true);
    const later = appendRetry(first, [span("http.client", { "mip.action_id": A }, 3)], 2, 50_000, revoked);
    expect(later.at(-1)?.a).not.toHaveProperty("mip.action_id");
  });
});
