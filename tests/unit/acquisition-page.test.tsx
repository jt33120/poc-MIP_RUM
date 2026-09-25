// Écran /acquisition (F48, § 5.16 ; sur le contrat depuis F53), rendu côté serveur
// avec des lectures simulées.
//
// Ce que ces tests verrouillent (en plus de l'e2e `usages-acquisition.spec.ts`) :
//   · les cinq canaux sont rendus, zéros compris, sans anneau ;
//   · le bandeau de plafond s'affiche SI ET SEULEMENT SI total === 20 000 (S4) ;
//   · 20 référents renvoyés s'écrivent « ≥ 20 » ;
//   · F53 : plus de « lecture non migrée » ; la méta écrit la plage du contrat ; la
//     table croisée et la série sont dessinées (B31), et une panne des canaux
//     n'efface pas la série ;
//   · `cmp=prev` : les tuiles portent la référence, et un plafond atteint tait l'écart.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcquisitionReport, PointCanaux } from "@/lib/acquisition";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { acquisition, acquisitionSerie, samplingSessions, couverturePrecedente } = vi.hoisted(() => ({
  acquisition: vi.fn(),
  acquisitionSerie: vi.fn(),
  samplingSessions: vi.fn(),
  couverturePrecedente: vi.fn(),
}));
vi.mock("@/lib/queries-acquisition", () => ({ acquisition, acquisitionSerie }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessions }));
vi.mock("@/lib/comparaison", () => ({ couverturePrecedente, sourcesSousFiltres: (_q: unknown, s: unknown) => [s] }));

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const QUERY = (() => {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=demo&period=7d"), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
})();
// Le chargeur de l'écran lit ses filtres par `analyserFiltres` (C5, `lib/filtres-ecran.ts`).
// `chargerEcran` lit la session (`lib/ecran-local.ts`).
vi.mock("@/lib/auth", () => ({ getUser: async () => ({ email: "a@b", role: "admin", apps: null }) }));
vi.mock("@/lib/filtres-ecran", () => ({
  analyserFiltres: async () => ({
    ok: true,
    filters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    deviceFilters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false, query: QUERY },
    query: QUERY,
    label: "7 j",
    bucketLabel: "6 h",
    notApplied: null,
  }),
}));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé : l'état « erreur »
// est remplacé par une trace de son titre. `lire()` journalise : canal simulé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// La série (client, recharts) est remplacée par une trace de ses props.
vi.mock("@/components/charts/StackedBars", () => ({
  StackedBars: (p: { series: unknown; points: unknown; zoomHref?: string }) => (
    <div data-testid="temoin-stacked" data-series={JSON.stringify(p.series)} data-points={JSON.stringify(p.points)} data-zoom={p.zoomHref} />
  ),
}));

const { default: Acquisition } = await import("@/app/acquisition/page");

const CANAUX = ["direct", "search", "social", "referral", "internal"] as const;

function report(canaux: Partial<Record<string, number>>, referents = 0, entrees: AcquisitionReport["entrees"] = []): AcquisitionReport {
  const channels = CANAUX.map((channel) => ({ channel, sessions: canaux[channel] ?? 0 }));
  return {
    channels,
    referrers: Array.from({ length: referents }, (_, i) => ({ host: `ref${i}.example`, channel: "referral" as const, sessions: 1 })),
    total: channels.reduce((s, c) => s + c.sessions, 0),
    entrees,
    routesEntree: entrees.length,
  };
}

const zero = () => ({ direct: 0, search: 0, social: 0, referral: 0, internal: 0 });
const serie = (n: number): PointCanaux[] =>
  Array.from({ length: 3 }, (_, i) => ({ t: new Date(NOW - (3 - i) * 21_600_000).toISOString(), canaux: { ...zero(), direct: i === 0 ? n : 0 } }));

async function rendre(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Acquisition({ searchParams: Promise.resolve(sp) }));
}

/** Le texte visible, sans balises ni entités d'espace. */
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  acquisition.mockReset();
  acquisitionSerie.mockReset();
  acquisitionSerie.mockResolvedValue(serie(1));
  samplingSessions.mockReset();
  samplingSessions.mockResolvedValue({ probaMin: 1, sessions: 10, sansTaux: 0, biaiseErreurs: false });
  couverturePrecedente.mockReset();
  couverturePrecedente.mockResolvedValue({ etat: "complete", raison: null });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/acquisition — canaux", () => {
  it("cinq canaux, zéros compris, parts sur le total ; aucun anneau", async () => {
    acquisition.mockResolvedValue(report({ direct: 6, search: 2, referral: 1, internal: 1 }, 1));
    const html = await rendre();
    const t = texte(html);
    for (const canal of ["Direct ou référent masqué", "Recherche", "Réseaux sociaux", "Site référent", "Interne"]) {
      expect(t, canal).toContain(canal);
    }
    expect(t).toMatch(/0 · 0,0\s%/); // le zéro des réseaux sociaux, affiché
    expect(t).toMatch(/6 · 60,0\s%/);
    // Part hors direct : (10 − 6 − 1) / 10.
    expect(t).toMatch(/Part hors direct\s+30,0\s%/);
    // L'anneau (`Donut`) dessinait un SVG dans le hero : plus aucun SVG dans la figure.
    const hero = html.slice(html.indexOf('id="acquisition-canaux"'), html.indexOf('data-testid="acquisition-direct"'));
    expect(hero).not.toContain("<svg");
    expect(html).not.toContain('data-testid="acquisition-plafond"');
  });

  it("F53 : plus de « lecture non migrée » ; la méta des quatre figures écrit la plage du contrat", async () => {
    acquisition.mockResolvedValue(report({ direct: 1 }, 0, [{ route: "/", parCanal: { ...zero(), direct: 1 }, total: 1 }]));
    const html = await rendre();
    expect(html).not.toContain("lecture non migrée");
    expect(html).not.toContain('data-testid="lecture-non-migree"');
    expect(texte(html)).not.toContain("glissant");
    const metas = html.match(/data-testid="figure-meta"[^]*?<\/div>/g) ?? [];
    expect(metas).toHaveLength(4);
    for (const m of metas) expect(m).toContain("7 j");
    // Le sondage d'échantillonnage lit la population de l'écran, sur le contrat.
    expect(samplingSessions).toHaveBeenCalledWith(expect.anything(), { population: { lecture: "vues" } });
  });

  it("aucune session : hero vide motivé, part hors direct inconnue (jamais « 0 % »)", async () => {
    acquisition.mockResolvedValue(report({}));
    acquisitionSerie.mockResolvedValue(serie(0));
    const t = texte(await rendre());
    expect(t).toContain("Aucune session sur les 7 derniers jours.");
    expect(t).toMatch(/Part hors direct\s+—\s+aucune session lue sur la fenêtre/);
    expect(t).toContain("Aucun site référent externe sur les 7 derniers jours");
  });
});

describe("/acquisition — plafonds (S4)", () => {
  it("bandeau de plafond si et seulement si total === 20 000", async () => {
    acquisition.mockResolvedValue(report({ direct: 19_999 }));
    expect(await rendre()).not.toContain('data-testid="acquisition-plafond"');
    acquisition.mockResolvedValue(report({ direct: 20_000 }));
    const t = texte(await rendre());
    expect(t).toContain(
      "plafond de 20 000 sessions atteint : canaux, pages d'entrée et référents portent sur les 20 000 premières sessions, prises d'abord par application puis par identifiant de session, pas les plus récentes ; sur plusieurs applications, elles peuvent toutes venir d'une seule",
    );
  });

  it("revue vague 8 : au plafond, CHAQUE figure qui compte ces sessions le dit dans sa méta — pages d'entrée et référents compris", async () => {
    const entree = { route: "/", parCanal: { ...zero(), direct: 20_000 }, total: 20_000 };
    acquisition.mockResolvedValue(report({ direct: 20_000 }, 1, [entree]));
    const html = await rendre();
    const metaDe = (id: string) => {
      const debut = html.indexOf(`id="${id}"`);
      expect(debut, `#${id} rendue`).toBeGreaterThan(-1);
      return html.slice(debut).match(/data-testid="figure-meta"[^]*?<\/div>/)?.[0] ?? "";
    };
    for (const id of ["acquisition-canaux", "acquisition-entrees", "acquisition-referents", "acquisition-serie"]) {
      const meta = texte(metaDe(id));
      expect(meta, id).toContain("plafond atteint : 20 000 premières sessions seulement, par application puis par identifiant");
    }
    // Sous le plafond : aucune méta ne le dit.
    acquisition.mockResolvedValue(report({ direct: 19_999 }, 1, [{ ...entree, parCanal: { ...zero(), direct: 19_999 }, total: 19_999 }]));
    expect(await rendre()).not.toContain('data-testid="acquisition-plafond-meta"');
  });

  it("20 référents renvoyés : « ≥ 20 », jamais « 20 » ; 19 : le compte exact", async () => {
    acquisition.mockResolvedValue(report({ referral: 20 }, 20));
    expect(texte(await rendre())).toMatch(/Référents externes distincts\s+≥ 20/);
    acquisition.mockResolvedValue(report({ referral: 19 }, 19));
    const t = texte(await rendre());
    expect(t).toMatch(/Référents externes distincts\s+19/);
    expect(t).not.toContain("≥ 20");
  });
});

describe("/acquisition — B31 : table croisée et série", () => {
  it("table route × canal : cinq canaux, total de ligne, lien « sessions passées par cette route »", async () => {
    acquisition.mockResolvedValue(
      report({ direct: 2, search: 1 }, 0, [
        { route: "/accueil", parCanal: { ...zero(), direct: 2, search: 1 }, total: 3 },
      ]),
    );
    const html = await rendre();
    const table = html.slice(html.indexOf('data-testid="acquisition-entrees-table"'), html.indexOf('data-testid="acquisition-entrees-liste"'));
    expect(texte(table)).toMatch(/\/accueil Sessions passées par cette route 2 1 0 0 0 3/);
    expect(table).toContain("/sessions?app=demo&amp;period=7d&amp;qf=route&amp;q=%2Faccueil");
    // Plus d'état « à créer » : la route est lue.
    expect(texte(html)).not.toContain("route d'entrée non lue par cette lecture (à créer)");
    expect(texte(html)).not.toContain("série à créer");
  });

  it("revue vague 8 — sous 640 px, le résumé d'un canal porte le total du CANAL (celui du hero), et la part des routes affichées est dite", async () => {
    // Avant : « 540 sessions » (la somme des seules routes affichées) contre 900 sur la barre du hero.
    acquisition.mockResolvedValue(
      report({ direct: 900, search: 100 }, 0, [{ route: "/a", parCanal: { ...zero(), direct: 540, search: 100 }, total: 640 }]),
    );
    const html = await rendre();
    const liste = html.slice(html.indexOf('data-testid="acquisition-entrees-liste"'));
    // Un <details> par canal, dans l'ordre fixe : direct, recherche, réseaux sociaux…
    const [direct, recherche, social] = liste.split("<details").slice(1).map(texte);
    expect(direct).toContain("Direct ou référent masqué 900 sessions ");
    expect(direct).toContain("Routes affichées : 540 de ces 900 sessions (60,0 %) ; les autres sont entrées par une route non affichée ou inconnue.");
    expect(direct).not.toContain("540 sessions");
    // Canal entièrement couvert par les routes affichées : rien à dire de plus.
    expect(recherche).toContain("Recherche 100 sessions");
    expect(recherche).not.toContain("Routes affichées :");
    // Canal vide : 0, et la phrase d'absence.
    expect(social).toContain("Réseaux sociaux 0 session");
    expect(social).toContain("Aucune des routes affichées n'a reçu d'entrée par ce canal.");
  });

  it("série : cinq canaux empilés, zoom sur un seau ; somme nulle → vide motivé, jamais un axe vide", async () => {
    acquisition.mockResolvedValue(report({ direct: 1 }));
    const html = await rendre();
    const temoin = html.match(/data-testid="temoin-stacked"[^>]*/)?.[0] ?? "";
    expect(temoin).toContain("&quot;cle&quot;:&quot;search&quot;");
    expect(temoin).toContain("from=%7Bfrom%7D&amp;to=%7Bto%7D");
    acquisitionSerie.mockResolvedValue(serie(0));
    const vide = await rendre();
    expect(vide).not.toContain('data-testid="temoin-stacked"');
  });

  it("lecture des canaux en échec : chaque bloc qui en dépend le dit ; la série, lue à part, reste", async () => {
    acquisition.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const html = await rendre();
    expect(html).toContain('data-echec="Chiffres clés"');
    expect(html).toContain("Sessions par canal d&#x27;entrée");
    expect(texte(html)).toContain("Ce que « direct » recouvre");
    expect(html).toContain('data-testid="temoin-stacked"');
    // Rien n'est chiffré sur une lecture qu'on n'a pas faite.
    expect(html).not.toContain('data-testid="kpi-tile"');
  });
});

describe("/acquisition — cmp=prev (F53)", () => {
  it("les tuiles se comparent à la période précédente, référence écrite", async () => {
    acquisition.mockImplementation(async (_f: unknown, _cap: unknown, shift?: boolean) =>
      shift ? report({ direct: 100, search: 100 }) : report({ direct: 150, search: 150 }),
    );
    const t = texte(await rendre({ cmp: "prev" }));
    expect(acquisition).toHaveBeenCalledWith(expect.anything(), 20_000, true);
    expect(t).toMatch(/\+50 % vs 7 jours précédents \(/);
  });

  it("un plafond atteint d'un côté tait l'écart, avec sa raison", async () => {
    acquisition.mockImplementation(async (_f: unknown, _cap: unknown, shift?: boolean) =>
      shift ? report({ direct: 20_000 }) : report({ direct: 150 }),
    );
    const t = texte(await rendre({ cmp: "prev" }));
    expect(t).toContain("période précédente incomplète : plafond de 20 000 sessions atteint sur la période précédente");
    expect(t).not.toMatch(/% vs 7 jours précédents/);
  });

  it("sans cmp : aucune lecture de la période précédente", async () => {
    acquisition.mockResolvedValue(report({ direct: 1 }));
    await rendre();
    expect(acquisition).toHaveBeenCalledTimes(1);
    expect(couverturePrecedente).not.toHaveBeenCalled();
  });
});
