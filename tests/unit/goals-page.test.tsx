// Écran /goals — Conversions (F66, § 5.14), rendu côté serveur avec des lectures
// simulées. L'e2e (`usages-perimetre.spec.ts`, bloc F66) n'est pas joué partout :
// ce rendu verrouille ce que l'écran écrit.
//   · chaque taux porte « ± demi-largeur » (G3) et son intervalle en mots (P*.1) ;
//   · classement : taux décroissant, échantillons faibles puis taux inconnus en fin ;
//   · sous « toutes les apps », l'app préfixe la condition et la table a sa colonne ;
//   · vide motivé (aucune session, aucun objectif), geste réservé à l'admin (V9) ;
//   · petits multiples par appareil, « Inconnu » à part, appareil sans session « — » ;
//   · une lecture en échec n'efface pas l'en-tête.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { goalConversions, goalConversionsByDevice, listGoals, simul } = vi.hoisted(() => ({
  goalConversions: vi.fn(),
  goalConversionsByDevice: vi.fn(),
  listGoals: vi.fn(),
  simul: { user: { email: "admin@mip", role: "admin" as string, apps: null as string[] | null } },
}));
vi.mock("@/lib/queries-goals", () => ({ goalConversions, goalConversionsByDevice, listGoals }));
vi.mock("@/lib/queries", () => ({ listApps: async () => [{ app_id: "a", name: "App A" }] }));
vi.mock("@/lib/auth", () => ({ getUser: async () => simul.user }));
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});
vi.mock("@/lib/comparaison", () => ({
  couverturePrecedente: async () => ({ etat: "complete", raison: null }),
  sourcesSousFiltres: (_q: unknown, s: unknown) => [s],
}));
// Le chargeur de l'écran lit ses filtres par `analyserFiltres` (C5, `lib/filtres-ecran.ts`).
vi.mock("@/lib/filtres-ecran", () => ({
  analyserFiltres: async (_principal: unknown, sp: Record<string, string>) => {
    const parsed = parseAnalyticsQuery(new URLSearchParams(sp), { principal: { role: "admin", apps: null }, nowMs: Date.now() });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const query = parsed.value;
    const filters = { app: query.scope.requestedApp, period: "24h", device: null, segment: [], includeBots: false, query };
    return { ok: true, filters, deviceFilters: filters, query, label: "24 h", bucketLabel: "1 h", notApplied: null };
  },
}));
vi.mock("@/app/goals/actions", () => ({ createGoalAction: vi.fn(), deleteGoalAction: vi.fn(), toggleGoalAction: vi.fn() }));
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));

const { default: Goals } = await import("@/app/goals/page");

const objectif = (
  id: number,
  name: string,
  conversions: number,
  sessions: number,
  extra: Partial<{ app_id: string; kind: "pageview" | "event"; pattern: string; match_type: "exact" | "contains" }> = {},
) => ({
  id,
  app_id: "a",
  name,
  kind: "pageview" as const,
  pattern: `/${name.toLowerCase()}`,
  match_type: "exact" as const,
  active: true,
  conversions,
  sessions,
  rate: sessions > 0 ? conversions / sessions : null,
  derniere: conversions > 0 ? new Date("2026-09-22T12:34:00Z") : null,
  ...extra,
});

async function rendre(sp: Record<string, string> = { app: "a" }): Promise<string> {
  return renderToStaticMarkup(await Goals({ searchParams: Promise.resolve(sp) }));
}

/** La table des objectifs (G5) seule : entre son ancre et la gestion. */
const tableObjectifs = (html: string) => html.slice(html.indexOf('id="objectifs"'), html.indexOf('id="gerer-objectifs"'));

/** Le texte visible, sans balises ; les entités d'apostrophe rendues. */
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  simul.user = { email: "admin@mip", role: "admin", apps: null };
  goalConversions.mockReset();
  goalConversionsByDevice.mockReset();
  listGoals.mockReset();
  listGoals.mockResolvedValue([]);
  goalConversionsByDevice.mockResolvedValue([]);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/goals — hero et table", () => {
  it("taux ± demi-largeur, intervalle en mots (P*.1), classement : faibles puis inconnus en fin", async () => {
    goalConversions.mockResolvedValue({
      total: 400,
      rows: [objectif(1, "Faible", 9, 10), objectif(2, "Moyen", 100, 400), objectif(3, "Fort", 200, 400), objectif(4, "Vide", 0, 0)],
    });
    const html = await rendre();
    const t = texte(html);
    expect(t).toContain("Conversions");
    expect(t).toMatch(/50,0\s% ± 4,9 pt/); // Wilson(200, 400)
    // Ordre des barres du hero (liens vers la ligne de la table) : Fort, Moyen, Faible, Vide.
    const ordre = [...html.matchAll(/href="#objectif-(\d)"/g)].map((m) => m[1]);
    expect(ordre).toEqual(["3", "2", "1", "4"]);
    expect(t).toMatch(/Faible page vue = \/faible · échantillon faible/);
    // P*.1 conservé : l'intervalle en mots, par ligne de la table.
    expect(html).toContain('data-testid="goal-intervalle"');
    expect(t).toMatch(/entre 45,1\s% et 54,9\s% \(95 %\)/);
    // La colonne dit « sessions », la dernière conversion est datée en UTC.
    expect(t).toContain("Conversions (sessions)");
    expect(t).toContain("200 sur 400");
    expect(t).toMatch(/22\/09,? 12:34 UTC/);
    // Une seule app lue : pas de colonne App dans la table des objectifs.
    expect(texte(tableObjectifs(html))).toMatch(/Objectif Condition Conversions \(sessions\)/);
  });

  it("toutes les apps : l'app préfixe la condition, la table a sa colonne App", async () => {
    goalConversions.mockResolvedValue({
      total: 12,
      rows: [objectif(1, "Merci", 3, 5, { app_id: "a" }), objectif(2, "Merci B", 1, 7, { app_id: "b" })],
    });
    const html = await rendre({ app: "all" });
    const t = texte(html);
    expect(t).toContain("Merci a · page vue = /merci");
    expect(t).toContain("Merci B b · page vue = /merci b");
    expect(texte(tableObjectifs(html))).toMatch(/Objectif App Condition Conversions \(sessions\)/);
  });

  it("aucune session : vide motivé, taux non calculables, aucune barre", async () => {
    goalConversions.mockResolvedValue({ total: 0, rows: [objectif(1, "Merci", 0, 0)] });
    const html = await rendre();
    expect(texte(html)).toContain("Aucune session sur 24 h : taux non calculables.");
    expect(html).not.toContain('href="#objectif-1"');
  });

  it("aucun objectif : geste « Créer un objectif » pour l'admin seulement (V9)", async () => {
    goalConversions.mockResolvedValue({ total: 10, rows: [] });
    const admin = await rendre();
    expect(texte(admin)).toContain("Aucun objectif actif sur ce périmètre.");
    expect(admin).toContain('href="#gerer-objectifs"');
    expect(admin).toContain('data-testid="create-goal"');
    expect(listGoals).toHaveBeenCalledWith(["a"]); // gestion : les apps effectives, jamais `app` seule
    listGoals.mockClear();
    simul.user = { email: "v@mip", role: "viewer", apps: ["a"] };
    const viewer = await rendre();
    expect(viewer).not.toContain('href="#gerer-objectifs"');
    expect(viewer).not.toContain('data-testid="create-goal"');
    expect(listGoals).not.toHaveBeenCalled(); // la gestion n'est pas lue pour un viewer
  });
});

describe("/goals — par appareil (G4)", () => {
  it("quatre appareils par objectif, écart en points ; « Inconnu » filtrable ; sans session « — » et sans lien", async () => {
    goalConversions.mockResolvedValue({ total: 20, rows: [objectif(1, "Merci", 5, 20)] });
    goalConversionsByDevice.mockResolvedValue([
      { goal_id: 1, device: "desktop", conversions: 4, sessions: 10 },
      { goal_id: 1, device: "mobile", conversions: 1, sessions: 6 },
      { goal_id: 1, device: null, conversions: 0, sessions: 4 },
    ]);
    const html = await rendre();
    const bloc = html.slice(html.indexOf('data-testid="conversion-appareils"'));
    const t = texte(bloc);
    expect(t).toMatch(/Desktop 10 sessions 40,0\s% \(\+15,0 pt\)/);
    expect(t).toMatch(/Mobile 6 sessions 16,7\s% \(−8,3 pt\)/);
    expect(t).toMatch(/Tablette 0 session —/);
    expect(t).toMatch(/Inconnu 4 sessions 0,0\s% \(−25,0 pt\)/);
    expect(bloc).toContain("device=desktop");
    // « Inconnu » : le contrat accepte `device:is_null` sur /goals depuis F66 (surface hors `legacy`).
    expect(bloc).toContain("seg=v2%3Adevice%3Ais_null");
    expect(bloc).not.toContain("device=tablet");
  });
});

describe("/goals — tuile « Meilleur taux » (revue F66)", () => {
  /** Le libellé complet que la tuile annonce (valeur, intervalle, effectif, échantillon faible). */
  const tuile = (html: string) => html.match(/aria-label="(Meilleur taux[^"]*)"/)?.[1] ?? "";

  it("5 conversions sur 400 sessions : « échantillon faible », comme dans le hero et la table", async () => {
    goalConversions.mockResolvedValue({ total: 400, rows: [objectif(1, "Rare", 5, 400)] });
    const html = await rendre();
    expect(tuile(html)).toContain("400 sessions");
    expect(tuile(html)).toContain("échantillon faible");
    expect(texte(html)).toMatch(/Rare page vue = \/rare · échantillon faible/);
  });

  it("200 conversions sur 400 sessions : pas d'« échantillon faible »", async () => {
    goalConversions.mockResolvedValue({ total: 400, rows: [objectif(1, "Solide", 200, 400)] });
    expect(tuile(await rendre())).not.toContain("échantillon faible");
  });
});

describe("/goals — lectures", () => {
  it("cmp=prev : le dénominateur se compare à la période précédente nommée", async () => {
    goalConversions.mockImplementation(async (_f: unknown, shift?: boolean) => ({ total: shift ? 100 : 150, rows: [] }));
    const t = texte(await rendre({ app: "a", cmp: "prev" }));
    expect(t).toMatch(/\+50 % vs période précédente \(du /);
  });

  it("lecture des conversions en échec : l'en-tête reste, chaque bloc qui en dépend le dit", async () => {
    goalConversions.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const html = await rendre();
    expect(texte(html)).toContain("Quelle part des sessions atteint chaque objectif");
    expect(html).toContain('data-echec="Chiffres clés"');
    expect(html).toContain('data-echec="Objectifs"');
    expect(html).not.toContain('data-testid="kpi-tile"');
  });
});
