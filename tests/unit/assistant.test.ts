// Assistant IA — logique pure : construction des sources et surtout SANITISATION
// des citations (un marqueur [n] n'est gardé que s'il pointe vers une source
// réellement fournie). C'est la garantie anti-hallucination : tout lien cliquable
// vient de nous, jamais du modèle.
import { describe, expect, it } from "vitest";
import type { BriefingSignals } from "../../apps/console/lib/briefing";
import {
  buildSources,
  buildUserPrompt,
  dataFactsFromSignals,
  sanitizeCitations,
  type Source,
} from "../../apps/console/lib/assistant";

function signals(over: Partial<BriefingSignals> = {}): BriefingSignals {
  return {
    app: "acme",
    windowLabel: "les 7 derniers jours",
    sessions: 247,
    pageviews: 1200,
    errors: 12,
    newErrorGroups: 2,
    topErrors: [{ type: "TypeError", message: "", count: 8 }],
    alerts: 1,
    criticalAlerts: 0,
    sloBreached: 0,
    healthScore: 82,
    worstVital: { name: "LCP", p75: 2600 },
    measures: 500,
    reliable: true,
    ...over,
  };
}

describe("dataFactsFromSignals", () => {
  it("rattache chaque fait à la page console qui l'affiche", () => {
    const facts = dataFactsFromSignals(signals());
    const byTitle = Object.fromEntries(facts.map((f) => [f.title, f.url]));
    expect(byTitle["Sessions"]).toBe("/sessions");
    expect(byTitle["Pages vues"]).toBe("/pages");
    expect(byTitle["Erreurs"]).toBe("/errors");
    expect(byTitle["Alertes"]).toBe("/alerts");
    expect(byTitle["Score de santé"]).toBe("/");
  });

  it("n'ajoute le fait SLO que s'il y a un dépassement", () => {
    expect(dataFactsFromSignals(signals({ sloBreached: 0 })).some((f) => f.title === "SLO")).toBe(false);
    expect(dataFactsFromSignals(signals({ sloBreached: 2 })).some((f) => f.title === "SLO")).toBe(true);
  });

  it("signale explicitement un échantillon non fiable", () => {
    const facts = dataFactsFromSignals(signals({ reliable: false, sessions: 3, measures: 10 }));
    expect(facts.some((f) => f.title === "Fiabilité de l'échantillon")).toBe(true);
  });

  it("omet le score de santé si non mesuré (null)", () => {
    expect(dataFactsFromSignals(signals({ healthScore: null })).some((f) => f.title === "Score de santé")).toBe(false);
  });
});

describe("buildSources", () => {
  it("numérote les données d'abord, puis l'architecture", () => {
    const src = buildSources(signals());
    expect(src[0].n).toBe(1);
    expect(src[0].kind).toBe("data");
    // numérotation contiguë 1..N
    src.forEach((s, i) => expect(s.n).toBe(i + 1));
    // le corpus d'architecture suit les données
    const firstArchi = src.find((s) => s.kind === "archi")!;
    const lastData = [...src].reverse().find((s) => s.kind === "data")!;
    expect(firstArchi.n).toBeGreaterThan(lastData.n);
  });

  it("sans app (signals null) : architecture seule, toujours numérotée depuis 1", () => {
    const src = buildSources(null);
    expect(src.length).toBeGreaterThan(0);
    expect(src.every((s) => s.kind === "archi")).toBe(true);
    expect(src[0].n).toBe(1);
  });

  it("expose la lib Python (fait citable) dans le corpus", () => {
    const src = buildSources(null);
    const py = src.find((s) => /Python/i.test(s.title));
    expect(py).toBeTruthy();
    expect(py!.body).toMatch(/stdlib|standard|urllib/i);
    expect(py!.url).toContain("/help/architecture#");
  });
});

describe("buildUserPrompt", () => {
  it("inclut la question et les sources numérotées", () => {
    const src = buildSources(signals());
    const prompt = buildUserPrompt("Combien de sessions ?", src);
    expect(prompt).toContain("Combien de sessions ?");
    expect(prompt).toContain("[1]");
    expect(prompt).toMatch(/SOURCES/);
  });
});

describe("sanitizeCitations", () => {
  const sources: Source[] = [
    { n: 1, title: "Sessions", url: "/sessions", kind: "data", body: "247 sessions" },
    { n: 2, title: "Base de données", url: "/help/architecture#database", kind: "archi", body: "Postgres Paris" },
  ];

  it("conserve les marqueurs valides et renvoie les sources citées, dans l'ordre", () => {
    const { answer, used } = sanitizeCitations("Il y a 247 sessions [1]. Données en UE [2].", sources);
    expect(answer).toContain("[1]");
    expect(answer).toContain("[2]");
    expect(used.map((u) => u.n)).toEqual([1, 2]);
    expect(used[0]).not.toHaveProperty("body"); // le corps n'est pas exposé au client
  });

  it("retire tout marqueur pointant vers une source inexistante (anti-hallucination)", () => {
    const { answer, used } = sanitizeCitations("Fait inventé [9]. Vrai fait [2].", sources);
    expect(answer).not.toContain("[9]");
    expect(answer).toContain("[2]");
    expect(used.map((u) => u.n)).toEqual([2]);
  });

  it("dédoublonne une source citée plusieurs fois", () => {
    const { used } = sanitizeCitations("A [1]. B [1]. C [2].", sources);
    expect(used.map((u) => u.n)).toEqual([1, 2]);
  });

  it("nettoie l'espace laissé par un marqueur effacé", () => {
    const { answer } = sanitizeCitations("Phrase inventée [42] .", sources);
    expect(answer).not.toContain("  ");
    expect(answer).not.toContain(" .");
  });
});
