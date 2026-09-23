// Écran /retention (F49, § 5.17), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent (revue F54, § 3.9) : les deux courbes de l'écran —
// « Courbe de rétention » et « Par appareil » — sont des images NOMMÉES
// (`role="img"` + `aria-label` paramétré par la fenêtre), et chacune garde son
// alternative textuelle. Avant F54, `LineTrend` n'avait ni rôle ni nom : un lecteur
// d'écran n'y trouvait que des graduations.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexSemaine, type CohortRow } from "@/lib/cohorts";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { retentionCohorts, samplingSessions, pageFilters } = vi.hoisted(() => ({
  retentionCohorts: vi.fn(),
  samplingSessions: vi.fn(),
  pageFilters: vi.fn(),
}));
vi.mock("@/lib/queries-cohorts", () => ({ retentionCohorts }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessions }));
vi.mock("@/lib/page-filters", () => ({ pageFilters }));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const QUERY = (() => {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=demo"), { principal: { role: "admin", apps: null }, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
})();

/** L'écran tel que `pageFilters` le rend ; `device` : l'appareil posé par la barre de filtres. */
const ecran = (device: string | null = null) => ({
  ok: true,
  filters: { app: "demo", period: "24h", device, segment: [], includeBots: false, query: QUERY },
  deviceFilters: { app: "demo", period: "24h", device, segment: [], includeBots: false, query: QUERY },
  query: QUERY,
  label: "24 h",
  bucketLabel: "1 h",
  notApplied: null,
});

const { default: Retention } = await import("@/app/retention/page");

async function rendre(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Retention({ searchParams: Promise.resolve(sp) }));
}

/** Une cohorte arrivée `age` semaines avant la semaine en cours, `retenus[k]` visiteurs revenus à S+k. */
function cohorte(age: number, taille: number, retenus: number[]): CohortRow {
  return {
    cohort: indexSemaine(Date.now()) - age,
    size: taille,
    cells: retenus.map((n, offset) => ({ offset, retained: n, rate: n / taille })),
  };
}

/** Le bloc d'une figure, de son ancre à la figure suivante (dont la balise ouvrante porte `data-testid="figure"`). */
const bloc = (html: string, id: string) => {
  const debut = html.indexOf(`id="${id}"`);
  expect(debut, `#${id} rendue`).toBeGreaterThan(-1);
  const finBalise = html.indexOf(">", debut);
  const fin = html.indexOf('data-testid="figure"', finBalise);
  return html.slice(debut, fin === -1 ? undefined : fin);
};

beforeEach(() => {
  for (const m of [retentionCohorts, samplingSessions, pageFilters]) m.mockReset();
  pageFilters.mockResolvedValue(ecran());
  // Trois cohortes : il y a deux semaines, la semaine dernière, cette semaine.
  retentionCohorts.mockResolvedValue([cohorte(2, 12, [12, 6, 3]), cohorte(1, 4, [4, 2]), cohorte(0, 2, [2])]);
  samplingSessions.mockResolvedValue({ probaMin: 1, sessions: 18, sansTaux: 0, biaiseErreurs: false });
});

describe("/retention — les courbes sont des images nommées (F54, § 3.9)", () => {
  it("« Courbe de rétention » : role=img, nom paramétré par la fenêtre et les semaines observées, alternative gardée", async () => {
    const courbe = bloc(await rendre(), "retention-courbe");
    expect(courbe).toContain(
      'role="img" aria-label="Rétention pondérée par semaine depuis l&#x27;arrivée, de S+0 à S+2, fenêtre de 8 semaines UTC ; un point sans cohorte complète est un trou"',
    );
    expect(courbe).toContain('data-testid="alternative"');
  });

  it("« Par appareil » : role=img nommé par ses trois séries et la fenêtre choisie", async () => {
    const appareils = bloc(await rendre({ weeks: "12" }), "retention-appareils");
    expect(appareils).toContain(
      'role="img" aria-label="Rétention pondérée par appareil (ordinateurs, mobiles, tablettes) et par semaine depuis l&#x27;arrivée, fenêtre de 12 semaines UTC"',
    );
    expect(appareils).toContain('data-testid="alternative"');
  });

  it("sous `device=`, « Par appareil » ne dessine rien : aucune image nommée sans données", async () => {
    pageFilters.mockResolvedValue(ecran("mobile"));
    const appareils = bloc(await rendre(), "retention-appareils");
    expect(appareils).toContain('data-testid="retention-deja-filtre"');
    expect(appareils).not.toContain('role="img"');
  });
});
