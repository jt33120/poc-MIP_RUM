// Écran /map (F52, § 5.10), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent (revue F54, § 3.9) : la série d'un nœud, dans son
// panneau, est une image NOMMÉE et porte son ALTERNATIVE textuelle — une ligne par
// seau lu, « — » pour la latence d'un seau sans appel (jamais 0 ms), 0 pour ses
// appels. Hors d'une `Figure`, rien ne portait cette alternative avant F54. Et une
// série en échec dit « Lecture en échec » sans alternative de données.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { mapNodes, mapEdges, mapPages, mapNodeSerie, traceCoverage, samplingSessions } = vi.hoisted(() => ({
  mapNodes: vi.fn(),
  mapEdges: vi.fn(),
  mapPages: vi.fn(),
  mapNodeSerie: vi.fn(),
  traceCoverage: vi.fn(),
  samplingSessions: vi.fn(),
}));
vi.mock("@/lib/queries-map", () => ({ mapNodes, mapEdges, mapPages, mapNodeSerie }));
vi.mock("@/lib/queries-tracing", () => ({ traceCoverage }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessions }));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));

// Le panneau (clavier), la série (zoom) et « Réessayer » lisent le routeur de Next :
// hors application, on leur en donne un inerte. `next` est une dépendance de la
// CONSOLE : le module simulé est désigné par son chemin résolu depuis apps/console.
// Le reste du module (`unstable_rethrow`, lu par `lire`) est le vrai.
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
  usePathname: () => "/map",
}));

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const QUERY = (() => {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=demo&period=7d"), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
})();
vi.mock("@/lib/page-filters", () => ({
  pageFilters: async () => ({
    ok: true,
    filters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    deviceFilters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    query: QUERY,
    label: "7 j",
    bucketLabel: "6 h",
    notApplied: null,
  }),
}));

const { default: Carte } = await import("@/app/map/page");

const PANNEAU = "noeud:back:/api/r12";

async function rendre(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Carte({ searchParams: Promise.resolve(sp) }));
}

/** Le texte visible, sans balises ni entités d'espace. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

/** Le panneau de détail, de sa balise ouvrante à la fin du document. */
const panneau = (html: string) => {
  const debut = html.indexOf('data-testid="detail-panel"');
  expect(debut, "panneau rendu").toBeGreaterThan(-1);
  return html.slice(debut);
};

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const m of [mapNodes, mapEdges, mapPages, mapNodeSerie, traceCoverage, samplingSessions]) m.mockReset();
  mapNodes.mockResolvedValue([
    { tier: "front", route: "/panier", calls: 12, latency_p75: 180, error_rate: 0, recent: 6, older: 6 },
    { tier: "back", route: "/api/r12", calls: 12, latency_p75: 240, error_rate: 0, recent: 6, older: 6 },
  ]);
  mapEdges.mockResolvedValue([{ front_route: "/panier", back_route: "/api/r12", calls: 12 }]);
  mapPages.mockResolvedValue([]);
  traceCoverage.mockResolvedValue({ total: 12, correlated: 12, back_total: 12, front_p75: 180, back_p75: 240, err: 0 });
  samplingSessions.mockResolvedValue({ probaMin: 1, sessions: 1, sansTaux: 0, biaiseErreurs: false });
  // Deux seaux de 6 h : le premier a 12 appels, le second aucun (latence inconnue).
  mapNodeSerie.mockResolvedValue([
    { t: "2026-09-22T00:00:00.000Z", p75: 240, appels: 12 },
    { t: "2026-09-22T06:00:00.000Z", p75: null, appels: 0 },
  ]);
  // `lire` et la frontière de section journalisent un échec : silence pendant les tests.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/map — la série du panneau porte son alternative (F54, § 3.9)", () => {
  it("image nommée, puis une ligne d'alternative par seau lu ; un seau sans appel : « — » et 0", async () => {
    const html = panneau(await rendre({ panel: PANNEAU }));
    expect(html).toContain('role="img" aria-label="Latence p75 et volume d&#x27;appels de /api/r12 par seau de 6 h, 7 j"');

    const alternative = html.slice(html.indexOf('data-testid="alternative"'));
    expect(html).toContain('data-testid="alternative"');
    expect(texte(alternative)).toContain("Latence p75 et appels de /api/r12 par seau de 6 h (UTC), 7 j");
    const entetes = [...alternative.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(entetes).toEqual(["Seau (UTC)", "Latence p75", "Appels"]);
    const lignes = alternative.slice(0, alternative.indexOf("</tbody>")).split("<tr").slice(2);
    expect(lignes).toHaveLength(2);
    expect(texte(lignes[0])).toMatch(/240\s?ms/);
    expect(texte(lignes[0])).toContain("12");
    // Un seau sans appel : la latence est inconnue, jamais « 0 ms » ; ses appels, eux, valent 0.
    expect(texte(lignes[1])).toContain("—");
    expect(texte(lignes[1])).not.toMatch(/\b0\s?ms/);
    expect(texte(lignes[1])).toMatch(/\b0\b/);
  });

  it("série en échec : « Lecture en échec » et « Réessayer », aucune alternative de données", async () => {
    mapNodeSerie.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const html = panneau(await rendre({ panel: PANNEAU }));
    const t = texte(html);
    expect(t).toContain("Lecture en échec.");
    expect(t).toContain("« Série du nœud » a échoué");
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
    expect(html).not.toContain('data-testid="alternative"');
    expect(t).not.toContain("ECONNREFUSED");
  });

  it("sans panneau, aucune série de nœud n'est lue", async () => {
    await rendre();
    expect(mapNodeSerie).not.toHaveBeenCalled();
  });
});
