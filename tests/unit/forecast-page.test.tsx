// Écran /forecast « Tendances » (F55 puis F65), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent :
//   · une lecture en échec (F02, `lire()`) ne remplace pas tout l'écran par
//     `error.tsx` : la partie qui en dépend dit « lecture en échec », le reste s'affiche ;
//   · une pente dans le bruit n'annonce AUCUNE échéance et n'est pas projetée (TE1, TE5) ;
//   · une dérive établie est projetée, dans sa bande, et l'échéance est écrite ;
//   · sous 7 jours d'au moins 30 mesures, aucune droite, et la raison chiffrée ;
//   · le ratio d'erreurs n'est jamais un « % » ni un « taux d'erreur JS » ;
//   · les points ouvrent les bornes UTC du jour LOCAL (R-T) ;
//   · « Créer une alerte » n'est pas rendu pour un compte en lecture seule (V9).
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dailyTraffic, dailyLcpSeries, getUser, listDeploys } = vi.hoisted(() => ({
  dailyTraffic: vi.fn(),
  dailyLcpSeries: vi.fn(),
  getUser: vi.fn(),
  listDeploys: vi.fn(),
}));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic, dailyLcpSeries, GRID_DAYS: 14 }));
// P*.7 : les marqueurs de déploiement, lus seulement pour la coïncidence de date.
vi.mock("@/lib/queries-deploys", () => ({ listDeploys }));
vi.mock("@/lib/auth", () => ({ getUser }));
vi.mock("@/lib/fuseau", async (original) => ({
  ...(await original<typeof import("@/lib/fuseau")>()),
  fuseauDe: async () => "Europe/Paris",
}));
// Le chargeur de l'écran lit ses filtres par `analyserFiltres` (C4, `lib/filtres-ecran.ts`).
vi.mock("@/lib/filtres-ecran", async () => {
  const { queryOf: q } = await import("@/lib/filters");
  const filters = { app: "demo", period: "24h" as const, device: null, segment: [], includeBots: false, includeInternal: false };
  return { analyserFiltres: async () => ({ ok: true, filters: { ...filters, query: q(filters) }, query: q(filters) }) };
});
// La série (client, recharts) est remplacée par une trace de ses props.
vi.mock("@/components/charts/ThresholdSeries", () => ({
  ThresholdSeries: (p: {
    series: { cle: string }[];
    bande?: unknown;
    ariaLabel: string;
    grille: string[];
    liensSeaux?: Record<string, { href: string; libelle: string }>;
    annotations?: { t: string; type: string; libelle: string; href?: string }[];
  }) => (
    <div
      data-graphe={p.ariaLabel}
      data-series={p.series.map((s) => s.cle).join(",")}
      data-bande={p.bande ? "1" : "0"}
      data-seaux={p.grille.length}
      data-lien-10={p.liensSeaux?.["2026-09-10"]?.href ?? ""}
      data-libelle-10={p.liensSeaux?.["2026-09-10"]?.libelle ?? ""}
      // P*.7 : « type|instant|libellé|lien », pour vérifier le jour où tombe la rupture.
      data-annotations={(p.annotations ?? []).map((a) => `${a.type}|${a.t}|${a.libelle}|${a.href ?? ""}`).join(" ")}
    />
  ),
}));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// Couverture du jour de référence (J−7) : lue en base par l'écran, simulée ici.
const { couvertureJour } = vi.hoisted(() => ({ couvertureJour: vi.fn() }));
vi.mock("@/lib/forecast-comparaison", async (original) => ({
  ...(await original<typeof import("@/lib/forecast-comparaison")>()),
  couvertureJour,
}));

const { default: Tendances } = await import("@/app/forecast/page");

const JOURS = Array.from({ length: 14 }, (_v, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const trafic = (vues = 100) => JOURS.map((day) => ({ day, pageviews: vues, errors: 2 }));
const lcpDe = (valeurs: (number | null)[], n = 200) => JOURS.map((jour, i) => ({ jour, p75: valeurs[i], n: valeurs[i] === null ? 0 : n }));
const PLATE_BRUITEE = [2000, 2150, 1850, 2100, 1900, 2140, 1860, 2000, 2150, 1850, 2100, 1900, 2140, 1860];
const DERIVE = Array.from({ length: 14 }, (_v, i) => 1000 + (1400 * i) / 13);

async function rendre(): Promise<string> {
  return renderToStaticMarkup(await Tendances({ searchParams: Promise.resolve({}) }));
}

function attribut(html: string, graphe: string, nom: string): string | null {
  const bloc = html.match(new RegExp(`<div data-graphe="${graphe}[^"]*"([^>]*)>`));
  const m = bloc?.[1].match(new RegExp(`${nom}="([^"]*)"`));
  return m ? m[1] : null;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  dailyTraffic.mockReset();
  dailyLcpSeries.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ email: "a@b", role: "admin", apps: null });
  listDeploys.mockReset();
  listDeploys.mockResolvedValue([]);
  couvertureJour.mockReset();
  couvertureJour.mockImplementation(async (_q: unknown, _s: unknown, _j: string, _tz: string, n: number | null) => ({
    etat: "complete",
    raison: null,
    n,
  }));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("/forecast — lecture en échec (F02)", () => {
  it("trafic illisible : ses tuiles et ses petits multiples le disent, le hero LCP reste", async () => {
    dailyTraffic.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    const html = await rendre();
    expect(html).toContain("Tendances");
    expect(html).toContain('data-echec="Pages vues, dernier jour complet"');
    expect(html).toContain('data-echec="Pages vues par jour"');
    expect(html).toContain('data-graphe="LCP p75 quotidien');
    expect(html).not.toContain('data-graphe="Pages vues par jour');
  });

  it("LCP illisible : hero et synthèse le disent, erreurs et trafic restent affichés", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockRejectedValue(new Error("statement timeout"));
    const html = await rendre();
    expect(html).toContain('data-echec="LCP p75, dernier jour complet"');
    expect(html).not.toContain('data-graphe="LCP p75 quotidien');
    expect(html).toContain("aucune synthèse n&#x27;est calculée");
    expect(html).toContain('data-graphe="Occurrences d&#x27;erreurs pour 100 pages vues');
    expect(html).toContain('data-graphe="Pages vues par jour');
  });
});

describe("/forecast — tendance et bruit (TE1, TE5)", () => {
  it("pente dans le bruit : droite sans projection ni bande, aucune ligne « devrait franchir »", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(PLATE_BRUITEE.map((v) => v + 400)));
    const html = await rendre();
    expect(attribut(html, "LCP p75 quotidien", "data-series")).toBe("observe,ajuste");
    expect(attribut(html, "LCP p75 quotidien", "data-bande")).toBe("0");
    expect(attribut(html, "LCP p75 quotidien", "data-seaux")).toBe("14");
    expect(html).not.toContain("devrait franchir");
    expect(html).toContain("tendance non distinguable du bruit");
  });

  it("dérive établie : projection sur 7 jours dans sa bande, échéance écrite", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    const html = await rendre();
    expect(attribut(html, "LCP p75 quotidien", "data-series")).toBe("observe,ajuste,projection");
    expect(attribut(html, "LCP p75 quotidien", "data-bande")).toBe("1");
    expect(attribut(html, "LCP p75 quotidien", "data-seaux")).toBe("21");
    expect(html).toMatch(/LCP p75 devrait franchir 2,5.s vers J\+\d/);
  });

  it("moins de 7 jours d'au moins 30 mesures : aucune droite, raison chiffrée", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(JOURS.map((jour, i) => ({ jour, p75: DERIVE[i], n: i < 5 ? 40 : 10 })));
    const html = await rendre();
    expect(attribut(html, "LCP p75 quotidien", "data-series")).toBe("observe");
    expect(html).toContain("tendance non calculée : 7 jours mesurés requis, 5 disponibles");
    expect(html).toContain("pas assez de jours mesurés (5 sur 14, 7 requis)");
  });
});

describe("/forecast — tuiles contre le même jour J−7 (revue de F65)", () => {
  // Trafic ×20 d'une semaine à l'autre : l'écart serait « +1 900 % » si le jour de référence comptait.
  const traficCroissant = () => JOURS.map((day, i) => ({ day, pageviews: i === 6 ? 50 : 1000, errors: 2 }));

  it("jour de référence complet : l'écart s'affiche, référence écrite", async () => {
    dailyTraffic.mockResolvedValue(traficCroissant());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    const html = await rendre();
    expect(html).toContain("vs même jour, semaine précédente (07/09)");
    expect(html).toMatch(/\+1.?900.?%/);
    // Chaque tuile a lu SA couverture, sur le jour J−7 et dans le fuseau de l'app.
    expect(couvertureJour).toHaveBeenCalledTimes(3);
    for (const appel of couvertureJour.mock.calls) expect(appel.slice(2, 4)).toEqual(["2026-09-07", "Europe/Paris"]);
  });

  it("collecte commencée pendant le jour de référence : aucune tuile n'affiche d'écart, la raison est écrite", async () => {
    dailyTraffic.mockResolvedValue(traficCroissant());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    couvertureJour.mockImplementation(async (_q: unknown, _s: unknown, _j: string, _tz: string, n: number | null) => ({
      etat: "partielle",
      raison: "pages vues collectées depuis le 07/09 16:00 UTC seulement",
      n,
    }));
    const html = await rendre();
    expect(html).not.toMatch(/1.?900.?%/);
    // Une ligne visible par tuile (le libellé annoncé de la tuile la répète).
    expect(
      // F11 ajoute `data-ecart` sur cette ligne : on repère le testid, puis le texte,
      // sans supposer l'ordre ni le nombre des attributs entre les deux.
      html.match(/data-testid="kpi-comparaison"[^>]*>période précédente incomplète : pages vues collectées depuis le 07\/09 16:00 UTC seulement/g),
    ).toHaveLength(3);
  });
});

describe("/forecast — vérité des libellés et des liens", () => {
  it("fenêtre fixe dite avec ses dates ; ratio sans « % » ni « taux d'erreur » ; « ce n'est pas une prévision »", async () => {
    dailyTraffic.mockResolvedValue(JOURS.map((day) => ({ day, pageviews: 20, errors: 30 })));
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    const html = await rendre();
    expect(html).toContain("14 jours complets, du 01/09 au 14/09, fuseau de l&#x27;app (Europe/Paris)");
    expect(html).toContain("la journée en cours est exclue");
    expect(html).toContain("150\u00a0pour\u00a0100");
    expect(html).not.toMatch(/150\s?%/);
    expect(html.toLowerCase()).not.toContain("taux d&#x27;erreur");
    expect(html).toContain("ce n&#x27;est pas une prévision");
    expect(html).not.toContain("Prévisions");
  });

  it("un point ouvre les bornes UTC du jour local, et l'infobulle dit les deux fuseaux", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    const html = await rendre();
    const lien = attribut(html, "LCP p75 quotidien", "data-lien-10")!.replace(/&amp;/g, "&");
    const url = new URL(lien, "http://console.local");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("from")).toBe("2026-09-09T22:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-09-10T22:00:00Z");
    expect(attribut(html, "LCP p75 quotidien", "data-libelle-10")).toBe(
      "10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC)",
    );
    const erreurs = new URL(attribut(html, "Occurrences", "data-lien-10")!.replace(/&amp;/g, "&"), "http://console.local");
    expect(erreurs.pathname).toBe("/errors");
  });

  it("« Créer une alerte » : rendu pour un administrateur, jamais pour un lecteur", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    expect(await rendre()).toContain("Créer une alerte sur ce seuil");
    getUser.mockResolvedValue({ email: "v@b", role: "viewer", apps: ["demo"] });
    expect(await rendre()).not.toContain("Créer une alerte");
    getUser.mockResolvedValue({ email: "d@b", role: "admin", apps: null, demo: true });
    expect(await rendre()).not.toContain("Créer une alerte");
  });

  it("changer de période ne change aucun chiffre : les lectures ne reçoivent pas la plage", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(DERIVE));
    await rendre();
    expect(dailyTraffic).toHaveBeenCalledWith(expect.anything(), { exclureAujourdhui: true });
    expect(dailyLcpSeries).toHaveBeenCalledWith(expect.anything(), { exclureAujourdhui: true });
  });
});

describe("/forecast — datation d'une rupture (P*.7)", () => {
  // Marche d'escalier : six jours à 1,9 s, huit à 2,7 s. La rupture est le 07/09,
  // PREMIER jour du nouveau niveau (elle s'est produite entre le 06 et le 07).
  const MARCHE = [...Array(6).fill(1900), ...Array(8).fill(2700)];

  it("marche nette : annotation « rupture » au bon jour, phrase avec p et jours valides", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(MARCHE));
    const html = await rendre();
    const annotations = attribut(html, "LCP p75 quotidien", "data-annotations")!.replace(/&amp;/g, "&");
    // L'instant est le PREMIER du jour local (Europe/Paris, été) : 06/09 22:00 UTC.
    expect(annotations).toContain("rupture|2026-09-06T22:00:00Z|Rupture à la hausse|");
    const lien = new URL(annotations.split("|")[3], "http://console.local");
    expect(lien.pathname).toBe("/");
    expect(lien.searchParams.get("from")).toBe("2026-09-06T22:00:00Z");
    expect(html).toContain("a changé de niveau autour du 07/09");
    expect(html).toContain("médiane des p75 quotidiennes");
    expect(html).toMatch(/test de Pettitt, p = 0,0\d+, 14 jours valides/);
  });

  it("série sans marche : aucune annotation, et le p est écrit quand même", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(PLATE_BRUITEE));
    const html = await rendre();
    expect(attribut(html, "LCP p75 quotidien", "data-annotations")).toBe("");
    // Série périodique sans niveau : la séparation n'est jamais meilleure que le hasard, p est borné à 1.
    expect(html).toContain("Aucune rupture datée (test de Pettitt, p = 1, 14 jours valides)");
    expect(html).toContain("aucune rupture datée (Pettitt)");
  });

  it("neuf jours au-dessus de 13 mesures : refus chiffré, aucune datation inventée", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    // Cinq jours sous le minimum d'une p75 : ils restent dessinés, ils ne sont pas testés.
    dailyLcpSeries.mockResolvedValue(JOURS.map((jour, i) => ({ jour, p75: MARCHE[i], n: i < 5 ? 8 : 200 })));
    const html = await rendre();
    expect(html).toContain("datation non tentée : 9 jours valides, 10 requis");
    expect(attribut(html, "LCP p75 quotidien", "data-annotations")).toBe("");
    expect(html).not.toContain("a changé de niveau");
  });

  it("déploiement le jour de la rupture : cité, avec la réserve d'interprétation", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(MARCHE));
    listDeploys.mockResolvedValue([
      { id: 1, ts: new Date("2026-09-07T09:00:00Z"), version: "1.4.2", env: "prod", source: "ci" },
    ]);
    const html = await rendre();
    expect(html).toContain("Un déploiement (1.4.2) a eu lieu le 07/09 : coïncidence de date.");
    expect(html).toContain("Coïncidence de date, pas une cause établie.");
  });

  it("déploiement à deux jours de la rupture : pas cité, et aucune réserve à porter", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(MARCHE));
    listDeploys.mockResolvedValue([
      { id: 1, ts: new Date("2026-09-09T09:00:00Z"), version: "1.4.2", env: "prod", source: "ci" },
    ]);
    const html = await rendre();
    expect(html).toContain("a changé de niveau autour du 07/09");
    expect(html).not.toContain("1.4.2");
    expect(html).not.toContain("pas une cause établie");
  });

  it("marqueurs illisibles : la datation tient, seule la coïncidence de date manque", async () => {
    dailyTraffic.mockResolvedValue(trafic());
    dailyLcpSeries.mockResolvedValue(lcpDe(MARCHE));
    listDeploys.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const html = await rendre();
    expect(html).toContain("a changé de niveau autour du 07/09");
    expect(html).not.toContain("déploiement (");
  });
});
