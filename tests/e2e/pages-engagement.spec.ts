// E2E — /pages, les signaux de vue du SDK web ≥ 0.6 (04/10/2026) : engagement,
// changements d'écran, poids des vues, repères du développeur.
//
// Deux apps à elles : l'une porte les mesures (semées en SQL, une ligne par vue et
// par nom comme l'écrit l'ingestion), l'autre seulement des pages vues — chaque
// section y dit qu'elle est vide, et pourquoi. Un compte admin DÉDIÉ au fichier.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const ADMIN_EMAIL = "e2e-pages-engagement-admin@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const APP = "e2e-pages-engagement";
const APP_VIDE = "e2e-pages-engagement-vide";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

async function semer() {
  for (const app of [APP, APP_VIDE]) {
    for (const t of ["rum_event", "rum_metric", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${t} where app_id = $1`, [app]);
    }
    await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
  }
  const quand = "now() - interval '2 hours'";
  // 15 vues sur /accueil : temps passé 1 … 15 s, défilement 80 % (10 vues) ou 40 %,
  // 10 … 24 ressources, 10 … 150 Ko ; 13 changements d'écran SPA de 10 … 130 ms.
  for (let i = 0; i < 15; i++) {
    const sid = `${APP}-s${i}`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)`,
      [sid, APP],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
       values ($1, $2, $3, '/accueil', 'spa', ${quand})`,
      [`${sid}-pv`, sid, APP],
    );
    const mesures: [string, number][] = [
      ["TIME_SPENT", (i + 1) * 1000],
      ["SCROLL_DEPTH", i < 10 ? 80 : 40],
      ["RESOURCE_COUNT", 10 + i],
      ["RESOURCE_BYTES", (i + 1) * 10_000],
      ...(i < 13 ? ([["SPA_LOAD", (i + 1) * 10]] as [string, number][]) : []),
    ];
    for (const [nom, valeur] of mesures) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts, metric_uid)
         values ($1, $2, $3, '/accueil', $4, $5, ${quand}, $6)`,
        [`${sid}-${nom}`, sid, APP, nom, valeur, `${sid}-vue`],
      );
    }
    // Repères : un mark sur chaque vue (13 premières), un measure sur deux d'entre elles.
    if (i < 13) {
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, event_type, timing_ms, ts)
         values ($1, $2, $3, '/accueil', 'mark:hero-visible', 'timing', $4, ${quand})`,
        [`${sid}-mark`, sid, APP, (i + 1) * 10],
      );
    }
    if (i < 2) {
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, event_type, timing_ms, ts)
         values ($1, $2, $3, '/accueil', 'measure:api-produits', 'timing', 300, ${quand})`,
        [`${sid}-measure`, sid, APP],
      );
    }
  }
  // L'app vide : une session et une vue, aucun signal de vue.
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)`,
    [`${APP_VIDE}-s0`, APP_VIDE],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
     values ($1, $2, $3, '/accueil', 'navigate', ${quand})`,
    [`${APP_VIDE}-s0-pv`, `${APP_VIDE}-s0`, APP_VIDE],
  );
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, ADMIN_EMAIL);
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

test.describe("/pages — signaux de vue du SDK web ≥ 0.6", () => {
  test("chaque section affiche les valeurs semées", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/pages?app=${APP}&period=24h`, { waitUntil: "domcontentloaded" });

    // Le sommaire mène aux quatre sections.
    const sommaire = page.getByTestId("sommaire-pages");
    for (const ancre of ["engagement", "changements-ecran", "poids-vues", "reperes"]) {
      await expect(sommaire.locator(`a[href="#${ancre}"]`)).toHaveCount(1);
    }

    // Engagement : temps passé p50 8 s, défilement p50 80 %, 10 vues sur 15 à 75 % ou plus.
    const engagement = page.getByTestId("engagement");
    await expect(engagement.getByTestId("engagement-temps").getByTestId("kpi-valeur")).toHaveText(/^8\s/, { timeout: 15_000 });
    await expect(engagement.getByTestId("engagement-defilement").getByTestId("kpi-valeur")).toContainText("80,0");
    await expect(engagement.getByTestId("engagement-profond").getByTestId("kpi-valeur")).toContainText("66,7");
    await expect(engagement.locator("#engagement-routes")).toContainText("/accueil");

    // Changements d'écran : p75 de 10 … 130 ms = 100 ms, 13 mesurés.
    const spa = page.getByTestId("changements-ecran");
    await expect(spa.getByTestId("spa-p75").getByTestId("kpi-valeur")).toHaveText(/^100\s*ms$/);
    await expect(spa.getByTestId("spa-nombre").getByTestId("kpi-valeur")).toHaveText("13");
    await expect(spa.locator("#changements-ecran-routes")).toContainText("/accueil");

    // Poids des vues : 17 ressources par vue au p50.
    const poids = page.getByTestId("poids-vues");
    await expect(poids.getByTestId("poids-ressources").getByTestId("kpi-valeur")).toHaveText("17");
    await expect(poids.getByTestId("poids-octets").getByTestId("kpi-valeur")).not.toHaveText("—");
    await expect(poids.locator("#poids-vues-routes")).toContainText("/accueil");

    // Repères : le mark avec sa source et son nombre ; le measure, trop rare, sans percentile.
    const reperes = page.getByTestId("reperes");
    const mark = reperes.locator('[data-testid="repere-ligne"][data-nom="mark:hero-visible"]');
    await expect(mark).toContainText("performance.mark");
    await expect(mark).toContainText("13");
    await expect(mark).toContainText(/70\s*ms/);
    const measure = reperes.locator('[data-testid="repere-ligne"][data-nom="measure:api-produits"]');
    await expect(measure).toHaveAttribute("data-source", "measure");
    await expect(measure.locator("td").nth(2)).toHaveText("—");
  });

  test("sans signal de vue, chaque section le dit, avec la version du SDK", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/pages?app=${APP_VIDE}&period=24h`, { waitUntil: "domcontentloaded" });
    for (const id of ["engagement", "changements-ecran", "poids-vues", "reperes"]) {
      const vide = page.getByTestId(`${id}-vide`);
      await expect(vide, id).toBeVisible({ timeout: 15_000 });
      await expect(vide, id).toContainText("SDK web ≥ 0.6");
    }
  });
});
