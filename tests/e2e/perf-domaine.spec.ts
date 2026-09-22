// E2E — domaine performance (plan § 6.5) : parcours et débordements des écrans Vue
// d'ensemble, Pages, Erreurs, Interactions et Satisfaction. Créé par le premier lot
// d'écran fusionné, étendu par chaque lot (un `test.describe` par lot, ajouté EN FIN
// de fichier), clos par F27.
//
// Chaque lot sème ses données dans SA propre app, dans le `beforeAll` de son bloc :
// aucun bloc ne dépend des données d'un autre. Un seul compte admin DÉDIÉ au fichier,
// jamais le compte admin local de seed-admin.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const ADMIN_EMAIL = "e2e-perf-domaine-admin@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, ADMIN_EMAIL);
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

// ——— Blocs des lots, dans l'ordre d'arrivée ———

// F14 — Pages : KPI, sélecteur de vital, hero classé (plan § 5.2.1-5.2.2, zones 1-4).
// Données SYNTHÉTIQUES, ordres LCP et INP OPPOSÉS — sinon « vital=INP re-trie »
// passerait avec n'importe quel tri :
//   /f14-lcp-lente  40 mesures, LCP 4,5 s, INP  80 ms → 1re en LCP, 2e en INP
//   /f14-inp-lente  40 mesures, LCP 1,5 s, INP 450 ms → 2e en LCP, 1re en INP
//   /f14-rapide     60 mesures, LCP 0,9 s, INP  50 ms → 3e partout
test.describe("F14 — Pages : KPI, sélecteur de vital, hero classé", () => {
  const APP_F14 = "f14-e2e-pages";
  const PAGES_F14 = `${consoleUrl}/pages?app=${APP_F14}&period=24h`;
  const ROUTES_F14 = [
    { route: "/f14-lcp-lente", n: 40, lcp: 4500, inp: 80 },
    { route: "/f14-inp-lente", n: 40, lcp: 1500, inp: 450 },
    { route: "/f14-rapide", n: 60, lcp: 900, inp: 50 },
  ] as const;

  async function semerF14() {
    for (const t of ["rum_metric", "rum_pageview", "rum_longtask", "rum_resource", "rum_error", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F14]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Pages F14 E2E') on conflict (app_id) do nothing`,
      [APP_F14],
    );
    for (const r of ROUTES_F14) {
      const prefixe = `${APP_F14}${r.route.replace(/\//g, "-")}`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         select $1 || '-s' || g, $2, $1 || '-v' || g, 'desktop', false,
                now() - interval '2 hours', now() - interval '110 minutes', 1
           from generate_series(1, $3::int) g
         on conflict (session_id) do nothing`,
        [prefixe, APP_F14, r.n],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
         select $1 || '-pv' || g, $1 || '-s' || g, $2, $3, 'navigate', now() - interval '2 hours'
           from generate_series(1, $4::int) g
         on conflict (span_id) do nothing`,
        [prefixe, APP_F14, r.route, r.n],
      );
      for (const [nom, valeur, rating] of [
        ["LCP", r.lcp, r.lcp > 4000 ? "poor" : r.lcp > 2500 ? "needs-improvement" : "good"],
        ["INP", r.inp, r.inp > 500 ? "poor" : r.inp > 200 ? "needs-improvement" : "good"],
      ] as const) {
        await pool.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
           select $1 || '-' || $4 || g, $1 || '-s' || g, $2, $3, $4, $5, $6, now() - interval '2 hours' + interval '1 minute'
             from generate_series(1, $7::int) g
           on conflict (span_id) do nothing`,
          [prefixe, APP_F14, r.route, nom, valeur, rating, r.n],
        );
      }
    }
  }

  /** Routes du hero, dans l'ordre affiché (le premier <span> d'une ligne est son libellé). */
  async function ordreF14(page: Page): Promise<string[]> {
    const lignes = page.getByTestId("hero-routes").getByTestId("impact-ligne");
    await expect(lignes).toHaveCount(ROUTES_F14.length);
    return lignes.evaluateAll((els) => els.map((el) => el.querySelector("span")?.textContent?.trim() ?? ""));
  }

  test.beforeAll(async () => {
    await semerF14();
  });

  test("vital=LCP par défaut : une seule liste de routes, classée par gravité", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F14, { waitUntil: "domcontentloaded" });
    const hero = page.getByTestId("hero-routes");
    await expect(hero).toHaveAttribute("data-vital", "LCP");
    expect(await ordreF14(page)).toEqual(["/f14-lcp-lente", "/f14-inp-lente", "/f14-rapide"]);
    // Les trois listes d'avant ont fusionné : ni découpage, ni table « Par route ».
    await expect(page.getByTestId("impact-table")).toHaveCount(1);
    await expect(page.getByTestId("breakdown")).toHaveCount(0);
    await expect(page.getByTestId("route-drill")).toHaveCount(0);
    // La ligne « Ensemble » est lue à part, non classée.
    await expect(hero.getByTestId("impact-reference")).toContainText("Ensemble");

    const tuiles = page.getByTestId("kpi-pages");
    await expect(tuiles).toContainText("LCP p75 (ensemble)");
    await expect(tuiles).toContainText("Pages vues");
    // Le dénominateur est écrit dans la tuile ; une seule route au-delà de 2,5 s.
    const auDela = tuiles.getByTestId("kpi-tile").filter({ hasText: "Routes au-delà de « Bon »" });
    await expect(auDela.getByTestId("kpi-valeur")).toHaveText("1");
    await expect(auDela).toContainText("sur 3 routes classées, 0 à faible effectif");
  });

  test("vital=INP re-trie le classement, et la tuile suit le vital", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F14, { waitUntil: "domcontentloaded" });
    await page.getByTestId("selecteur-vital").getByRole("button", { name: "INP", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("vital") === "INP", { timeout: 15_000 });
    await expect(page.getByTestId("hero-routes")).toHaveAttribute("data-vital", "INP");
    expect(await ordreF14(page)).toEqual(["/f14-inp-lente", "/f14-lcp-lente", "/f14-rapide"]);
    await expect(page.getByTestId("kpi-pages")).toContainText("INP p75 (ensemble)");
    // La plage et l'app sont restées.
    const sp = new URL(page.url()).searchParams;
    expect([sp.get("app"), sp.get("period")]).toEqual([APP_F14, "24h"]);
  });

  test("vital=FCP : classement désactivé avec sa raison, tuile des routes sans chiffre", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F14}&vital=FCP`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("classement-indisponible")).toContainText(
      "classement FCP non disponible : le découpage ne lit que LCP, INP, CLS",
    );
    await expect(page.getByTestId("impact-table")).toHaveCount(0);
    const auDela = page.getByTestId("kpi-tile").filter({ hasText: "Routes au-delà de « Bon »" });
    await expect(auDela.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(auDela.getByTestId("kpi-raison")).toContainText("classement FCP non disponible");
    await expect(page.getByTestId("selecteur-vital").getByRole("button", { name: "FCP", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("une ligne ouvre la route avec la même plage et le même vital", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/pages?app=${APP_F14}&period=7d&vital=INP`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("hero-routes").getByTestId("impact-ligne").first().getByRole("link").click();
    await page.waitForURL((u) => u.searchParams.get("route") === "/f14-inp-lente", { timeout: 15_000 });
    const sp = new URL(page.url()).searchParams;
    expect([sp.get("app"), sp.get("period"), sp.get("vital")]).toEqual([APP_F14, "7d", "INP"]);
    await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(1);
  });

  test("tri=volume : ordre du nombre de mesures, bascule marquée", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F14}&tri=volume`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tri-volume")).toHaveAttribute("aria-current", "true");
    expect((await ordreF14(page))[0]).toBe("/f14-rapide");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px (LCP et FCP)`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      const fautes: string[] = [];
      for (const suffixe of ["", "&vital=FCP"]) {
        await page.goto(`${PAGES_F14}${suffixe}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kpi-pages")).toBeVisible();
        for (const faute of await debordements(page)) fautes.push(`/pages${suffixe} @ ${largeur} px — ${faute}`);
      }
      expect(fautes).toEqual([]);
    });
  }
});
