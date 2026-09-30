// Les hachures « non mesuré » sur les écrans de la suite (après /pages, /errors,
// /sessions, /tracing et /events, `fenetres-collecte-ecrans.test.tsx`) : un test
// paramétré, un cas par chargeur branché.
//
// Ce que ces tests verrouillent, pour chaque écran :
//   · son CHARGEUR lit les fenêtres hors collecte UNE fois, pour le périmètre de
//     l'écran, sur la bonne plage — la période affichée ET la précédente, ou, pour
//     un axe qui ne suit pas le filtre (quatorze jours de /forecast, trente de
//     /alerts, vingt-quatre heures de /logs, trafic des tableaux), toute sa plage ;
//   · sa sortie porte ces fenêtres en SECTION (`fenetresCollecte`) ;
//   · un registre illisible ne fait pas tomber l'écran : sa section est en échec,
//     l'écran rend `ok` quand même.
//
// La base est remplacée par une base VIDE (toute requête rend zéro ligne) : ce qui
// est jugé ici est le branchement, pas les lectures des séries.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previousRange } from "@/lib/query-contract";
import type { FenetreCollecte } from "@/lib/series";

const m = vi.hoisted(() => ({ lireFenetresCollecte: vi.fn() }));

vi.mock("@/lib/queries-collecte", () => ({ lireFenetresCollecte: m.lireFenetresCollecte }));
vi.mock("@/lib/db", () => {
  const vide = async () => ({ rows: [], rowCount: 0 });
  const client = { query: vide, release: () => {} };
  return {
    q: async () => [],
    pool: { query: vide, connect: async () => client },
    tx: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    withTenant: async (_apps: unknown, fn: (c: typeof client) => Promise<unknown>) => fn(client),
  };
});
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// Toutes les dimensions présentes : aucun filtre de l'écran n'est refusé faute de colonne.
vi.mock("@/lib/query-schema", async () => {
  const { schemaComplet } = await import("../fixtures/dimension-schema");
  return { dimensionSchema: async () => schemaComplet() };
});
// /logs est une capacité FERMÉE (rien n'est lu) : ici, rouverte, pour juger son branchement.
vi.mock("@/lib/capacites", () => ({ CAPACITES_FERMEES: [], estFermee: () => false }));
// /correlation ne lit sa série (et ses fenêtres) qu'avec un couple et un robot passé.
vi.mock("@/lib/queries-v2", async (original) => ({
  ...(await original<typeof import("@/lib/queries-v2")>()),
  correlationRoutes: async () => [{ app_id: "demo-app", route: "/" }],
  syntheticFreshness: async () => [{ app_id: "demo-app", dernier: new Date(), intervalle_median_s: null, passages: 1 }],
  correlationSeries: async () => [],
}));
// Un tableau de bord sans carte, accessible : le branchement ne dépend pas des cartes.
vi.mock("@/lib/dashboard-access", async (original) => ({
  ...(await original<typeof import("@/lib/dashboard-access")>()),
  getAccessibleDashboard: async () => ({
    id: 7,
    name: "Tableau",
    app_id: null,
    layout: [],
    revision: "r1",
    owner_email: "a@b",
    visibility: "private",
  }),
}));

const FENETRE: FenetreCollecte = {
  debut: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  fin: new Date(Date.now() - 3_600_000).toISOString(),
  etat: "interrompue",
  portee: "*",
};
const ADMIN = { email: "a@b", role: "admin", apps: null } as const;
const JOUR = 86_400_000;

interface Cas {
  ecran: string;
  charger: () => Promise<{ etat: string; fenetresCollecte?: unknown }>;
  /** Plage attendue ; `null` : la période affichée et la précédente (`plageDesFenetres`). */
  axe: number | null;
}

async function cas(): Promise<Cas[]> {
  // Sans comparaison : sous `cmp=prev` (défaut des écrans Performance), la couverture
  // de la période précédente lit aussi le registre, pour sa propre règle.
  const sp = { app: "demo-app", period: "24h", cmp: "none" };
  const [
    { chargerExperience },
    { chargerMap },
    { chargerUx },
    { chargerForecast },
    { chargerAcquisition },
    { chargerAlertes },
    { chargerLogs },
    { chargerMobile },
    { chargerCorrelation },
    { chargerTableau },
  ] = await Promise.all([
    import("@/lib/chargeurs/experience"),
    import("@/lib/chargeurs/map"),
    import("@/lib/chargeurs/ux"),
    import("@/lib/chargeurs/forecast"),
    import("@/lib/chargeurs/acquisition"),
    import("@/lib/chargeurs/alertes"),
    import("@/lib/chargeurs/logs"),
    import("@/lib/chargeurs/mobile"),
    import("@/lib/chargeurs/correlation"),
    import("@/lib/chargeurs/tableau"),
  ]);
  return [
    { ecran: "/experience", charger: () => chargerExperience(ADMIN, sp, {}), axe: null },
    // La série n'existe que panneau ouvert : les fenêtres se lisent avec elle.
    { ecran: "/map (panneau de nœud)", charger: () => chargerMap(ADMIN, { ...sp, panel: "noeud:front:/" }, {}), axe: null },
    { ecran: "/ux", charger: () => chargerUx(ADMIN, sp, {}), axe: null },
    { ecran: "/forecast", charger: () => chargerForecast(ADMIN, sp, {}), axe: 14 * JOUR },
    { ecran: "/acquisition", charger: () => chargerAcquisition(ADMIN, sp, {}), axe: null },
    { ecran: "/alerts", charger: () => chargerAlertes(ADMIN, sp, {}), axe: 30 * JOUR },
    { ecran: "/logs", charger: () => chargerLogs(ADMIN, sp, {}), axe: JOUR },
    { ecran: "/mobile", charger: () => chargerMobile(ADMIN, sp, {}), axe: null },
    { ecran: "/correlation", charger: () => chargerCorrelation(ADMIN, sp, {}), axe: null },
    // Les cartes d'analyse suivent la plage (48 h ici) ; le trafic, 14 jours fixes : la plus longue l'emporte.
    { ecran: "/dashboards/[id]", charger: () => chargerTableau(ADMIN, sp, { id: "7" }), axe: 14 * JOUR },
  ];
}

const tous = await cas();

beforeEach(() => {
  m.lireFenetresCollecte.mockReset();
  m.lireFenetresCollecte.mockResolvedValue([FENETRE]);
});

describe.each(tous)("chargeur $ecran — les fenêtres hors collecte", (c) => {
  it("lues une fois, pour le périmètre de l'écran, sur toute la plage de l'axe", async () => {
    const avant = Date.now();
    const sortie = await c.charger();
    const apres = Date.now();
    expect(sortie.etat).toBe("ok");
    const appels = m.lireFenetresCollecte.mock.calls as [{ from: string; to: string }, string[] | null][];
    const hachures = appels.filter(([plage]) => {
      const from = Date.parse(plage.from);
      const to = Date.parse(plage.to);
      return c.axe === null
        ? // La période affichée (24 h) et la précédente, bout à bout.
          to - from === 2 * JOUR &&
            plage.from === previousRange({ from: new Date(to - JOUR).toISOString(), to: plage.to, preset: null, bucketSeconds: 3600 }).from
        : // Toute la plage de l'axe, plus un jour de marge (fuseau), jusqu'à maintenant.
          to >= avant && to <= apres && to - from === c.axe + JOUR;
    });
    expect(appels).toHaveLength(1);
    expect(hachures).toHaveLength(1);
    expect(hachures[0][1]).toEqual(["demo-app"]);
    expect(sortie.fenetresCollecte).toEqual({ ok: true, data: [FENETRE] });
  });

  it("registre illisible : sa section est en échec, l'écran reste rendu", async () => {
    m.lireFenetresCollecte.mockRejectedValue(new Error("statement timeout"));
    const sortie = await c.charger();
    expect(sortie.etat).toBe("ok");
    expect(sortie.fenetresCollecte).toEqual({ ok: false, code: "lecture_en_echec" });
  });
});

describe("chargeur /map — sans panneau ouvert, aucune série, aucune lecture du registre", () => {
  it("les fenêtres ne sont pas lues", async () => {
    const { chargerMap } = await import("@/lib/chargeurs/map");
    const sortie = await chargerMap(ADMIN, { app: "demo-app", period: "24h" }, {});
    expect(sortie.etat).toBe("ok");
    expect(m.lireFenetresCollecte).not.toHaveBeenCalled();
    if (sortie.etat === "ok") expect(sortie.fenetresCollecte).toBeNull();
  });
});
