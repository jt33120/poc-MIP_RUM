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
import { indexSemaine, lundiDeSemaine, type CohortRow } from "@/lib/cohorts";
import { fmtJour } from "@/lib/format";
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
  // Un historique de 200 jours : les quatre fenêtres (jusqu'à 26 semaines) sont
  // couvertes. Le cas d'un historique de 30 jours a son propre test, plus bas.
  process.env.RETENTION_DAYS = "200";
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
      'role="img" aria-label="Rétention pondérée par semaine depuis l&#x27;arrivée, de S+0 à S+2, fenêtre de 8 semaines ; un point sans cohorte complète est un trou"',
    );
    expect(courbe).toContain('data-testid="alternative"');
  });

  it("« Par appareil » : role=img nommé par ses trois séries et la fenêtre choisie", async () => {
    const appareils = bloc(await rendre({ weeks: "12" }), "retention-appareils");
    expect(appareils).toContain(
      'role="img" aria-label="Rétention pondérée par appareil (ordinateurs, mobiles, tablettes) et par semaine depuis l&#x27;arrivée, fenêtre de 12 semaines"',
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

// Recette du 26/09/2026 : le sélecteur proposait 12 et 26 semaines alors que 30 jours
// seulement sont conservés — des fenêtres qui ne pouvaient rien montrer de plus que 4.
describe("/retention — les fenêtres proposées suivent l'historique conservé", () => {
  const fenetres = (html: string) =>
    [...html.matchAll(/data-testid="retention-fenetre"[^>]*>([^<]+)</g)].map((m) => m[1].trim());

  it("30 jours conservés : seule la fenêtre de 4 semaines est proposée, et elle est la fenêtre par défaut", async () => {
    process.env.RETENTION_DAYS = "30";
    const html = await rendre();
    expect(fenetres(html)).toEqual(["4 sem."]);
    expect(html).toContain("historique conservé\u00a0: 30 jours");
    expect(bloc(html, "retention-courbe")).toContain("fenêtre de 4 semaines");
  });

  it("une fenêtre au-delà de l'historique est ignorée ET dite, avec les fenêtres réellement proposées", async () => {
    process.env.RETENTION_DAYS = "30";
    const html = await rendre({ weeks: "26" });
    expect(html).toContain("weeks=26 (fenêtres proposées : 4 semaines, 30 jours d&#x27;historique conservés)");
  });

  it("200 jours conservés : les quatre fenêtres, 8 semaines par défaut", async () => {
    const { fenetresDisponibles, fenetreParDefaut } = await import("@/lib/chargeurs/retention");
    expect(fenetresDisponibles(200)).toEqual([4, 8, 12, 26]);
    expect(fenetreParDefaut(fenetresDisponibles(200))).toBe(8);
    expect(fenetresDisponibles(60)).toEqual([4, 8]);
    expect(fenetresDisponibles(10)).toEqual([4]);
  });
});

// Recette du 26/09/2026 : une tuile qui n'affichait qu'un code de lot (« B35 »), un
// code interne dans une note (« parité C3 »), et deux bandeaux orange « Partiel »
// pour un historique encore court — normal, et pas une panne.
describe("/retention — ni fonction non livrée, ni code interne, ni « Partiel » pour un historique court", () => {
  /** Le texte visible, sans balises ni entités, espaces insécables compris. */
  const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

  it("trois tuiles : « Sessions sans identifiant, hors matrice » n'est pas rendue ; aucun code de lot à l'écran", async () => {
    const html = await rendre();
    const tuiles = html.slice(html.indexOf('data-testid="retention-kpi"'), html.indexOf('data-testid="retention-courbe"'));
    expect(tuiles.match(/data-testid="kpi-tile"/g)).toHaveLength(3);
    expect(html).not.toContain("Sessions sans identifiant");
    expect(texte(html)).not.toMatch(/\bB35\b|parité C3/);
  });

  it("une seule cohorte, cette semaine : cadre neutre daté, sans bandeau « Partiel » ni courbe dessinée", async () => {
    retentionCohorts.mockResolvedValue([cohorte(0, 146, [146])]);
    const html = await rendre();
    // S+1 de la cohorte se termine le lundi qui suit la semaine prochaine.
    const date = fmtJour(lundiDeSemaine(indexSemaine(Date.now()) + 2));
    for (const id of ["retention-courbe", "retention-appareils"]) {
      const figure = bloc(html, id);
      expect(figure).toContain('data-testid="retention-recul"');
      expect(texte(figure)).toContain(`Historique encore court : S+1 lisible à partir du ${date}.`);
      expect(figure).not.toContain('data-etat="partiel"');
      expect(figure).not.toContain('role="img"');
    }
    expect(texte(html)).not.toContain("Partiel");
    // La tuile S+1 dit la même date.
    expect(texte(html)).toContain(`lisible à partir du ${date}`);
  });

  it("S+4 : une date quand la fenêtre le couvre ; sinon la dernière semaine lisible, dite", async () => {
    // 200 jours conservés, 8 semaines : la plus ancienne cohorte (il y a 2 semaines)
    // aura sa semaine S+4 terminée le lundi de la semaine courante + 3.
    const date = fmtJour(lundiDeSemaine(indexSemaine(Date.now()) + 3));
    const long = texte(await rendre());
    expect(long).toContain("Retour en S+4");
    expect(long).toContain(`lisible à partir du ${date}`);
    // 30 jours conservés : 4 semaines lues, S+0 à S+3 ; S+4 n'y serait jamais lisible
    // (contre-recette du 26/09/2026) : la tuile lit S+3 et le dit.
    process.env.RETENTION_DAYS = "30";
    const court = texte(await rendre());
    expect(court).not.toContain("Retour en S+4");
    expect(court).toContain("Retour en S+3");
    expect(court).toContain("S+4 dépasse la fenêtre de 4 semaines : dernière semaine lisible");
    expect(court).toContain(`lisible à partir du ${fmtJour(lundiDeSemaine(indexSemaine(Date.now()) + 2))}`);
  });

  it("la méthode passe derrière une aide repliable, après le chiffre", async () => {
    const courbe = bloc(await rendre(), "retention-courbe");
    const meta = courbe.slice(courbe.indexOf('data-testid="figure-meta"'), courbe.indexOf('role="figure"'));
    expect(meta).not.toContain("moyenne pondérée");
    expect(courbe).toContain('data-testid="figure-methode"');
    expect(texte(courbe)).toContain("Moyenne pondérée par la taille des cohortes");
  });
});
