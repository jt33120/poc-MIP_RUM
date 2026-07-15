import { describe, expect, it } from "vitest";
import {
  assessReliability,
  briefingUserPrompt,
  deriveStatus,
  deterministicBriefing,
  parseBriefing,
  RELIABILITY_MIN_MEASURES,
  RELIABILITY_MIN_SESSIONS,
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

describe("fiabilité (échantillon faible)", () => {
  it("assessReliability : seuils sessions ET mesures", () => {
    expect(assessReliability(RELIABILITY_MIN_SESSIONS, RELIABILITY_MIN_MEASURES)).toBe(true);
    expect(assessReliability(RELIABILITY_MIN_SESSIONS - 1, RELIABILITY_MIN_MEASURES)).toBe(false);
    expect(assessReliability(RELIABILITY_MIN_SESSIONS, RELIABILITY_MIN_MEASURES - 1)).toBe(false);
    expect(assessReliability(2, 9)).toBe(false);
  });

  it("deriveStatus : un p75 dégradé sur échantillon faible ne déclenche PAS d'alarme", () => {
    // santé basse mais peu de trafic -> pas de conclusion perf -> ok
    expect(deriveStatus({ ...base, reliable: false, healthScore: 40, sessions: 3, measures: 8 })).toBe("ok");
    // mais une alerte critique reste un fait dur, quel que soit le volume
    expect(deriveStatus({ ...base, reliable: false, criticalAlerts: 1, measures: 8 })).toBe("critical");
    // une nouvelle erreur aussi
    expect(deriveStatus({ ...base, reliable: false, newErrorGroups: 1, measures: 8 })).toBe("watch");
  });

  it("deterministicBriefing : annonce le trafic insuffisant et ne clame pas 'tout est au vert'", () => {
    const b = deterministicBriefing({ ...base, reliable: false, sessions: 4, measures: 9, healthScore: 45 });
    expect(b.status).toBe("ok");
    expect(b.headline).toContain("Trop peu de trafic");
    expect(b.bullets.join(" ")).toContain("Trafic insuffisant");
    // ne cite pas le score de santé (non fiable)
    expect(b.bullets.join(" ")).not.toContain("Score de santé");
  });

  it("briefingUserPrompt : signale explicitement l'échantillon FAIBLE au LLM", () => {
    const p = briefingUserPrompt({ ...base, reliable: false, measures: 12 });
    expect(p).toContain("FAIBLE");
    expect(p).toContain("12 mesure");
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
