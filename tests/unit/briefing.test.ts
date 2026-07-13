import { describe, expect, it } from "vitest";
import {
  briefingUserPrompt,
  deriveStatus,
  deterministicBriefing,
  parseBriefing,
  type BriefingSignals,
} from "../../apps/console/lib/briefing";

const base: BriefingSignals = {
  app: "gip-plateforme",
  windowLabel: "depuis votre dernière connexion",
  sessions: 120,
  pageviews: 900,
  errors: 0,
  newErrorGroups: 0,
  topErrors: [],
  alerts: 0,
  criticalAlerts: 0,
  sloBreached: 0,
  healthScore: 95,
  worstVital: null,
};

describe("deriveStatus", () => {
  it("ok quand tout est calme", () => {
    expect(deriveStatus(base)).toBe("ok");
  });
  it("critical sur alerte critique / SLO / santé très basse", () => {
    expect(deriveStatus({ ...base, criticalAlerts: 1 })).toBe("critical");
    expect(deriveStatus({ ...base, sloBreached: 1 })).toBe("critical");
    expect(deriveStatus({ ...base, healthScore: 40 })).toBe("critical");
  });
  it("watch sur alerte, nouvelle erreur ou santé moyenne", () => {
    expect(deriveStatus({ ...base, alerts: 2 })).toBe("watch");
    expect(deriveStatus({ ...base, newErrorGroups: 1 })).toBe("watch");
    expect(deriveStatus({ ...base, healthScore: 70 })).toBe("watch");
  });
});

describe("deterministicBriefing", () => {
  it("ok : headline vert + une phrase rassurante", () => {
    const b = deterministicBriefing(base);
    expect(b.status).toBe("ok");
    expect(b.source).toBe("deterministic");
    expect(b.bullets.length).toBeGreaterThan(0);
    expect(b.focus).toBeNull();
  });
  it("critical : bullets alertes + SLO, focus Alertes", () => {
    const b = deterministicBriefing({
      ...base,
      criticalAlerts: 2,
      sloBreached: 1,
      newErrorGroups: 3,
      topErrors: [{ type: "TypeError", message: "x", count: 12 }],
      healthScore: 45,
    });
    expect(b.status).toBe("critical");
    expect(b.focus).toBe("Alertes");
    expect(b.bullets.join(" ")).toContain("critique");
    expect(b.bullets.join(" ")).toContain("SLO");
  });
  it("watch : nouvelles erreurs -> focus Erreurs JS", () => {
    const b = deterministicBriefing({ ...base, newErrorGroups: 2, topErrors: [{ type: "Error", message: "y", count: 4 }] });
    expect(b.focus).toBe("Erreurs JS");
  });
});

describe("briefingUserPrompt", () => {
  it("inclut les signaux clés, jamais de PII", () => {
    const p = briefingUserPrompt({ ...base, alerts: 1 });
    expect(p).toContain("gip-plateforme");
    expect(p).toContain("Alertes déclenchées : 1");
    expect(p).toContain("Score de santé : 95");
  });
});

describe("parseBriefing", () => {
  it("parse un JSON strict valide", () => {
    const r = parseBriefing('{"status":"watch","headline":"À surveiller","bullets":["2 alertes","1 SLO"],"focus":"Alertes"}');
    expect(r).not.toBeNull();
    expect(r!.status).toBe("watch");
    expect(r!.source).toBe("ai");
    expect(r!.bullets).toHaveLength(2);
    expect(r!.focus).toBe("Alertes");
  });
  it("tolère du texte autour du bloc JSON", () => {
    const r = parseBriefing('Voici le briefing :\n{"status":"ok","headline":"RAS","bullets":["Tout va bien"]}\nMerci.');
    expect(r?.status).toBe("ok");
    expect(r?.focus).toBeNull();
  });
  it("null si pas de bullets exploitables ou JSON cassé", () => {
    expect(parseBriefing('{"status":"ok","bullets":[]}')).toBeNull();
    expect(parseBriefing("pas de json ici")).toBeNull();
  });
  it("borne un status inconnu sur watch", () => {
    const r = parseBriefing('{"status":"weird","bullets":["x"]}');
    expect(r?.status).toBe("watch");
  });
});
