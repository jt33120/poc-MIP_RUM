// A1 — échantillonnage intelligent biaisé-erreurs (SDK). Logique pure : décision
// de mode et contrôleur d'émission, testés sans navigateur.
import { describe, expect, it, vi } from "vitest";
import {
  createSampler,
  decideMode,
} from "../../packages/rum-sdk/src/sampling";

describe("decideMode — choix du mode par session", () => {
  it("dans la fraction sampleRate -> full", () => {
    expect(decideMode({ sampleRate: 0.1 }, 0.05)).toBe("full");
    expect(decideMode({ sampleRate: 1 }, 0.99)).toBe("full");
  });

  it("hors fraction, keepOnError par défaut -> error-biased (selon errorSampleRate)", () => {
    expect(decideMode({ sampleRate: 0.1 }, 0.5, 0.0)).toBe("error-biased");
    expect(decideMode({ sampleRate: 0 }, 0.9, 0.99)).toBe("error-biased");
  });

  it("hors fraction, keepOnError:false -> off (ancien comportement)", () => {
    expect(decideMode({ sampleRate: 0.1, keepOnError: false }, 0.5)).toBe("off");
  });

  it("errorSampleRate borne la fraction gardée sur erreur", () => {
    // rand2 au-dessus du taux -> off ; en-dessous -> error-biased
    expect(decideMode({ sampleRate: 0, errorSampleRate: 0.2 }, 0.9, 0.5)).toBe("off");
    expect(decideMode({ sampleRate: 0, errorSampleRate: 0.2 }, 0.9, 0.1)).toBe("error-biased");
    expect(decideMode({ sampleRate: 0, errorSampleRate: 0 }, 0.9, 0.0)).toBe("off");
  });

  it("clamp des taux hors bornes", () => {
    expect(decideMode({ sampleRate: 2 }, 0.99)).toBe("full"); // 2 -> 1
    expect(decideMode({ sampleRate: -1, keepOnError: false }, 0.0)).toBe("off"); // -1 -> 0
  });
});

describe("createSampler — passerelle d'émission", () => {
  it("full : tout passe, notifyError sans effet", () => {
    const onPromote = vi.fn();
    const s = createSampler("full", onPromote);
    expect(s.passes("pageview")).toBe(true);
    expect(s.passes("exception")).toBe(true);
    s.notifyError();
    expect(s.mode).toBe("full");
    expect(onPromote).not.toHaveBeenCalled();
  });

  it("error-biased : seules les erreurs passent, puis promotion en full", () => {
    const onPromote = vi.fn();
    const s = createSampler("error-biased", onPromote);
    expect(s.passes("pageview")).toBe(false);
    expect(s.passes("webvital.LCP")).toBe(false);
    expect(s.passes("exception")).toBe(true);

    s.notifyError();
    expect(s.mode).toBe("full");
    expect(onPromote).toHaveBeenCalledTimes(1);
    // une fois promue, toute la télémétrie passe
    expect(s.passes("pageview")).toBe(true);
    // promotion idempotente : onPromote n'est pas rappelé
    s.notifyError();
    expect(onPromote).toHaveBeenCalledTimes(1);
  });

  it("off : rien ne passe", () => {
    const s = createSampler("off");
    expect(s.passes("exception")).toBe(false);
    expect(s.passes("pageview")).toBe(false);
    s.notifyError();
    expect(s.mode).toBe("off");
  });
});
