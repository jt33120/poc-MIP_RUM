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
// Le chargeur de l'écran lit ses filtres par `analyserFiltres` (C5, `lib/filtres-ecran.ts`).
// `chargerEcran` lit la session (`lib/ecran.ts`) ; console-api n'est pas branché : la console sert.
vi.mock("@/lib/auth", () => ({ getUser: async () => ({ email: "a@b", role: "admin", apps: null }) }));
vi.mock("@/lib/filtres-ecran", () => ({ analyserFiltres: pageFilters }));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const requete = (qs: string) => {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
};

/**
 * L'écran tel que `pageFilters` le rend, pour la query string `qs` : `device=` (la
 * barre de filtres) ou `seg=` (le segment) arrivent dans la requête résolue.
 */
const ecranDe = (qs: string) => {
  const query = requete(`app=demo&${qs}`);
  const device = query.filters.device ?? null;
  return {
    ok: true,
    filters: { app: "demo", period: "24h", device, segment: [], includeBots: false, query },
    deviceFilters: { app: "demo", period: "24h", device, segment: [], includeBots: false, query },
    query,
    label: "24 h",
    bucketLabel: "1 h",
    notApplied: null,
  };
};
/** `device` : l'appareil posé par la barre de filtres. */
const ecran = (device: string | null = null) => ecranDe(device ? `device=${device}` : "");

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
    expect(appareils).toContain("Déjà filtré sur mobiles");
    expect(appareils).not.toContain('role="img"');
  });
});

describe("/retention — « Par appareil » sous une condition d'appareil portée par le SEGMENT (revue vague 8)", () => {
  /** Le texte visible, sans balises ni entités. */
  const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  /** Le href du lien « Retirer le filtre ». */
  const retirer = (html: string) => (html.match(/href="([^"]*)"[^>]*>Retirer le filtre/)?.[1] ?? "").replace(/&amp;/g, "&");

  it("seg=v2:device:is_null : « Déjà filtré », aucune série relue, aucun lien vers un écran vide", async () => {
    // Avant : trois séries vides (ET avec device IS NULL) et « Rétention des ordinateurs (0 visiteurs) ».
    pageFilters.mockResolvedValue(ecranDe("seg=v2%3Adevice%3Ais_null"));
    const appareils = bloc(await rendre(), "retention-appareils");
    expect(texte(appareils)).toContain("Déjà filtré sur appareil inconnu : la comparaison par appareil ne s'applique pas.");
    expect(appareils).not.toContain('data-testid="retention-appareil-lien"');
    expect(appareils).not.toContain('role="img"');
    // Une seule lecture de cohortes : celle de la courbe, pas une par appareil.
    expect(retentionCohorts).toHaveBeenCalledTimes(1);
    // « Retirer le filtre » retire la condition du segment.
    const href = new URL(retirer(appareils), "http://x");
    expect(href.pathname).toBe("/retention");
    expect(href.searchParams.get("app")).toBe("demo");
    expect(href.searchParams.has("seg")).toBe(false);
  });

  it("seg=v2:device:eq:tablet;browser:eq:Firefox : « Déjà filtré sur tablettes » ; retirer ne touche que l'appareil", async () => {
    pageFilters.mockResolvedValue(ecranDe("seg=v2%3Adevice%3Aeq%3Atablet%3Bbrowser%3Aeq%3AFirefox"));
    const appareils = bloc(await rendre({ weeks: "12" }), "retention-appareils");
    expect(texte(appareils)).toContain("Déjà filtré sur tablettes");
    const href = new URL(retirer(appareils), "http://x");
    expect(href.searchParams.get("seg")).toBe("v2:browser:eq:Firefox");
    expect(href.searchParams.has("device")).toBe(false);
    expect(href.searchParams.get("weeks")).toBe("12");
  });

  it("sans condition d'appareil (segment sur une autre dimension) : la comparaison s'applique, une lecture par appareil", async () => {
    pageFilters.mockResolvedValue(ecranDe("seg=v2%3Abrowser%3Ais_null"));
    const appareils = bloc(await rendre(), "retention-appareils");
    expect(appareils).not.toContain('data-testid="retention-deja-filtre"');
    expect(appareils).toContain('data-testid="retention-appareil-lien"');
    expect(retentionCohorts).toHaveBeenCalledTimes(4);
  });
});
