// Écran /acquisition (F48, § 5.16), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent (en plus de l'e2e `usages-acquisition.spec.ts`) :
//   · les cinq canaux sont rendus, zéros compris, sans anneau ;
//   · le bandeau de plafond s'affiche SI ET SEULEMENT SI total === 20 000 (S4) ;
//   · 20 référents renvoyés s'écrivent « ≥ 20 » ;
//   · la table croisée et la série attendent B31 en état partiel motivé, même
//     quand la lecture des canaux échoue (une panne n'efface pas les autres blocs).
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcquisitionReport } from "@/lib/acquisition";

const { acquisition, samplingSessionsHistorique } = vi.hoisted(() => ({
  acquisition: vi.fn(),
  samplingSessionsHistorique: vi.fn(),
}));
vi.mock("@/lib/queries-acquisition", () => ({ acquisition }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessionsHistorique }));
vi.mock("@/lib/page-filters", () => ({
  pageFilters: async () => ({
    ok: true,
    filters: { app: "demo", period: "7d", device: null, segment: [], includeBots: false },
    query: {},
  }),
}));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé : l'état « erreur »
// est remplacé par une trace de son titre. `lire()` journalise : canal simulé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));

const { default: Acquisition } = await import("@/app/acquisition/page");

function report(canaux: Partial<Record<string, number>>, referents = 0): AcquisitionReport {
  const channels = (["direct", "search", "social", "referral", "internal"] as const).map((channel) => ({
    channel,
    sessions: canaux[channel] ?? 0,
  }));
  return {
    channels,
    referrers: Array.from({ length: referents }, (_, i) => ({ host: `ref${i}.example`, channel: "referral" as const, sessions: 1 })),
    total: channels.reduce((s, c) => s + c.sessions, 0),
  };
}

async function rendre(): Promise<string> {
  return renderToStaticMarkup(await Acquisition({ searchParams: Promise.resolve({}) }));
}

/** Le texte visible, sans balises ni entités d'espace. */
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  acquisition.mockReset();
  samplingSessionsHistorique.mockReset();
  samplingSessionsHistorique.mockResolvedValue({ probaMin: 1, sessions: 10, sansTaux: 0, biaiseErreurs: false });
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

  it("lecture non migrée : sous l'en-tête et dans la méta des quatre figures (S3)", async () => {
    acquisition.mockResolvedValue(report({ direct: 1 }));
    const html = await rendre();
    expect(texte(html)).toMatch(/7 derniers jours glissants, lus à \d\d:\d\d UTC \(lecture non migrée : ni plage personnalisée, ni tablette, ni « Inconnu »\)/);
    const metas = html.match(/data-testid="figure-meta"[^]*?<\/div>/g) ?? [];
    expect(metas).toHaveLength(4);
    for (const m of metas) expect(m).toContain("lecture non migrée");
  });

  it("aucune session : hero vide motivé, part hors direct inconnue (jamais « 0 % »)", async () => {
    acquisition.mockResolvedValue(report({}));
    const t = texte(await rendre());
    expect(t).toContain("Aucune session sur les 7 derniers jours glissants.");
    expect(t).toMatch(/Part hors direct\s+—\s+aucune session lue sur la fenêtre/);
    expect(t).toContain("Aucun site référent externe sur les 7 derniers jours glissants");
  });
});

describe("/acquisition — plafonds (S4)", () => {
  it("bandeau de plafond si et seulement si total === 20 000", async () => {
    acquisition.mockResolvedValue(report({ direct: 19_999 }));
    expect(await rendre()).not.toContain('data-testid="acquisition-plafond"');
    acquisition.mockResolvedValue(report({ direct: 20_000 }));
    const t = texte(await rendre());
    expect(t).toContain(
      "plafond de 20 000 sessions atteint : les canaux portent sur les 20 000 premières sessions par identifiant, pas les plus récentes",
    );
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

describe("/acquisition — B31 absent et lecture en échec", () => {
  it("table croisée et série : état partiel motivé, aucune figure dessinée", async () => {
    acquisition.mockResolvedValue(report({ direct: 3 }));
    const t = texte(await rendre());
    expect(t).toContain("route d'entrée non lue par cette lecture (à créer)");
    expect(t).toContain("série à créer : la lecture actuelle n'a pas d'horodatage (B31)");
  });

  it("lecture des canaux en échec : chaque bloc qui en dépend le dit, les autres restent", async () => {
    acquisition.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    const html = await rendre();
    expect(html).toContain('data-echec="Chiffres clés"');
    expect(html).toContain("Sessions par canal d&#x27;entrée");
    expect(texte(html)).toContain("route d'entrée non lue par cette lecture (à créer)");
    expect(texte(html)).toContain("Ce que « direct » recouvre");
    // Rien n'est chiffré sur une lecture qu'on n'a pas faite.
    expect(html).not.toContain('data-testid="kpi-tile"');
  });
});
