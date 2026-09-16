// P1 — détecteurs de frustration (logique pure, sans DOM) : rage clicks & dead clicks.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEAD_CLICK_WINDOW_MS,
  initFrustration,
  isActionable,
  isDeadClick,
  isOwnUi,
  MIP_UI_ATTR,
  RageDetector,
} from "../../packages/rum-sdk/src/frustration";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RageDetector", () => {
  it("émet au 3e clic dans la fenêtre (rafale), une seule fois", () => {
    const d = new RageDetector(3, 1000);
    expect(d.click("btn", 0)).toBeNull();
    expect(d.click("btn", 200)).toBeNull();
    expect(d.click("btn", 400)).toBe(3); // seuil franchi
    expect(d.click("btn", 600)).toBeNull(); // déjà émis pour cette rafale
  });

  it("ne compte pas les clics hors fenêtre", () => {
    const d = new RageDetector(3, 1000);
    expect(d.click("btn", 0)).toBeNull();
    expect(d.click("btn", 1200)).toBeNull(); // > fenêtre depuis le 1er : réarme
    expect(d.click("btn", 1300)).toBeNull(); // 2 dans la fenêtre courante
    expect(d.click("btn", 1400)).toBe(3);
  });

  it("réarme sur changement de cible", () => {
    const d = new RageDetector(3, 1000);
    d.click("a", 0);
    d.click("a", 100);
    expect(d.click("b", 200)).toBeNull(); // cible différente -> repart de 1
    expect(d.click("b", 300)).toBeNull();
    expect(d.click("b", 400)).toBe(3);
  });

  it("une nouvelle rafale après coupure ré-émet", () => {
    const d = new RageDetector(3, 1000);
    d.click("btn", 0);
    d.click("btn", 100);
    expect(d.click("btn", 200)).toBe(3);
    // coupure > fenêtre puis nouvelle rafale
    expect(d.click("btn", 2000)).toBeNull();
    expect(d.click("btn", 2100)).toBeNull();
    expect(d.click("btn", 2200)).toBe(3);
  });
});

describe("isDeadClick", () => {
  it("mort si aucune réaction après le clic", () => {
    expect(isDeadClick(1000, { mutation: 500, nav: 0, scroll: 200 })).toBe(true);
  });
  it("vivant si une mutation DOM suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 1200, nav: 0, scroll: 0 })).toBe(false);
  });
  it("vivant si une navigation suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 0, nav: 1100, scroll: 0 })).toBe(false);
  });
  it("vivant si un scroll suit le clic", () => {
    expect(isDeadClick(1000, { mutation: 0, nav: 0, scroll: 1050 })).toBe(false);
  });
  // Régression du 11/08/2026. Ce test affirmait l'inverse (« une réaction
  // exactement au temps du clic ne compte pas »), et c'était le défaut : l'écouteur
  // horodate le clic en phase de CAPTURE, donc AVANT le gestionnaire de l'élément.
  // Une interface qui répond en moins d'une milliseconde produit `mutation === t`
  // — le cas le plus favorable était classé « clic mort ».
  it("une réaction dans la MÊME milliseconde que le clic est une réaction", () => {
    expect(isDeadClick(1000, { mutation: 1000, nav: 0, scroll: 0 })).toBe(false);
    expect(isDeadClick(1000, { mutation: 0, nav: 1000, scroll: 0 })).toBe(false);
    expect(isDeadClick(1000, { mutation: 0, nav: 0, scroll: 1000 })).toBe(false);
  });

  it("mort si la dernière réaction précède strictement le clic", () => {
    expect(isDeadClick(1000, { mutation: 999, nav: 999, scroll: 999 })).toBe(true);
  });
});

describe("isOwnUi — l'instrument ne se mesure pas lui-même", () => {
  /** Faux Element : `closest` remonte une chaîne de parents en mémoire. */
  const node = (attrs: Record<string, string>, parent?: Element): Element =>
    ({
      closest(sel: string) {
        const want = sel.replace(/^\[|\]$/g, "");
        if (want in attrs) return this as unknown as Element;
        return parent?.closest(sel) ?? null;
      },
    }) as unknown as Element;

  it("ignore un clic sur un élément marqué", () => {
    expect(isOwnUi(node({ [MIP_UI_ATTR]: "feedback-button" }))).toBe(true);
  });

  it("ignore un clic sur un DESCENDANT d'un élément marqué (étoile, textarea…)", () => {
    const panel = node({ [MIP_UI_ATTR]: "feedback-panel" });
    expect(isOwnUi(node({}, panel))).toBe(true);
  });

  it("laisse passer un clic sur l'application hôte", () => {
    expect(isOwnUi(node({ class: "btn-primary" }))).toBe(false);
  });

  it("ne filtre rien si closest lève (très vieux navigateur)", () => {
    const hostile = {
      closest() {
        throw new Error("closest indisponible");
      },
    } as unknown as Element;
    expect(isOwnUi(hostile)).toBe(false);
  });
});

describe("contrat widget ↔ SDK", () => {
  it("le widget marque ses racines avec exactement MIP_UI_ATTR", () => {
    // Les deux fichiers ne partagent pas de module (le widget est un IIFE servi
    // en statique) : si l'un des deux renomme l'attribut, l'exclusion redevient
    // silencieusement inopérante. Ce test est le seul lien entre eux.
    const widget = readFileSync(
      new URL("../../apps/console/public/mip-rum-feedback.js", import.meta.url),
      "utf8",
    );
    expect(widget).toContain(`var UI_ATTR = "${MIP_UI_ATTR}"`);
    expect(widget).toContain("btn.setAttribute(UI_ATTR");
    expect(widget).toContain("panel.setAttribute(UI_ATTR");
  });
});

describe("isActionable", () => {
  it("vrai sans inspection si l'élément est interactif", () => {
    expect(isActionable({} as Element, true)).toBe(true);
  });
});

describe("collecteur de frustration causal", () => {
  class FakeElement {
    tagName: string;
    textContent: string;
    control: FakeElement | null = null;

    constructor(tag = "button", text = "Payer") {
      this.tagName = tag.toUpperCase();
      this.textContent = text;
    }

    getAttribute() { return null; }
    closest(selector: string) {
      if (selector === `[${MIP_UI_ATTR}]`) return null;
      return this;
    }
  }

  function fixture() {
    let click: ((event: MouseEvent) => void) | null = null;
    const emitted: Array<Record<string, string | number | boolean>> = [];
    let actionId = "11111111-2222-4333-8444-555555555555";
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("MutationObserver", class { observe() {} });
    vi.stubGlobal("addEventListener", () => {});
    vi.stubGlobal("document", {
      documentElement: {},
      addEventListener(type: string, listener: (event: MouseEvent) => void) {
        if (type === "click") click = listener;
      },
    });
    initFrustration((_name, attrs) => { emitted.push(attrs); }, {
      action: () => ({ "mip.action_id": actionId }),
    });
    return {
      emitted,
      dispatch(target: FakeElement, detail = 1) {
        click!({ target, detail, button: 0 } as unknown as MouseEvent);
      },
      setAction(value: string) { actionId = value; },
    };
  }

  it("conserve le snapshot de l'action du clic jusqu'à la décision différée", () => {
    const f = fixture();
    f.dispatch(new FakeElement());
    f.setAction("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS);
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]).toMatchObject({
      "frustration.kind": "dead",
      "mip.action_id": "11111111-2222-4333-8444-555555555555",
    });
  });

  it("déduplique le clic synthétique label vers contrôle", () => {
    const f = fixture();
    const control = new FakeElement("input", "");
    const label = new FakeElement("label", "Notifications");
    label.control = control;
    f.dispatch(label);
    f.dispatch(control, 0);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS);
    expect(f.emitted).toHaveLength(1);
    expect(f.emitted[0]["frustration.target"]).toBe('label "Notifications"');
  });
});
