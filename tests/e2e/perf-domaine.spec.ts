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

test.describe("F11 — Vue d'ensemble : santé, KPI, constats", () => {
  // Une app à elle : 32 sessions commencées sur les 20 dernières heures (assez pour
  // que `/sessions` écrive sa population), une vue et un LCP chacune, une erreur
  // navigateur, une erreur backend sans session, et un déploiement qui dégrade le
  // LCP (+20 % ou plus sur ±2 h) : de quoi produire un constat et son lien.
  const APP_F11 = "e2e-f11-vue-ensemble";
  const ACCUEIL_F11 = `${consoleUrl}/?app=${APP_F11}&period=24h`;

  test.beforeAll(async () => {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "deploy_marker"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F11]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Vue d''ensemble F11 (e2e)') on conflict (app_id) do nothing`,
      [APP_F11],
    );
    for (let i = 0; i < 32; i++) {
      const sid = `${APP_F11}-s${i}`;
      // Sessions 0-7 : [now-5h, now-3h) (avant le déploiement) ; 8-15 : [now-3h, now-1h) (après).
      const minutes = i < 8 ? 290 - i * 10 : i < 16 ? 170 - (i - 8) * 10 : 1200 - (i - 16) * 50;
      const quand = `now() - interval '${minutes} minutes'`;
      const lcp = i < 8 ? 1100 + i * 10 : i < 16 ? 3000 + i * 10 : 1800 + i * 5;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)
         on conflict (session_id) do nothing`,
        [sid, APP_F11],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
         values ($1, $2, $3, '/panier', 'navigate', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-pv`, sid, APP_F11],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
         values ($1, $2, $3, '/panier', 'LCP', $4, ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-lcp`, sid, APP_F11, lcp],
      );
    }
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, error_source, ts)
       values ($1, $2, $3, '/panier', 'error', 'boom F11', 'TypeError', 'f11-fp-nav', 3, 'browser_js', now() - interval '100 minutes'),
              ($4, null, $3, null, 'error', 'backend F11', 'Error', 'f11-fp-node', 5, 'node', now() - interval '100 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_F11}-e-nav`, `${APP_F11}-s9`, APP_F11, `${APP_F11}-e-node`],
    );
    await pool.query(
      `insert into deploy_marker (app_id, version, env, ts)
       values ($1, 'f11-2.0.0', 'prod', now() - interval '3 hours'), ($1, 'f11-1.9.0', 'prod', now() - interval '30 hours')`,
      [APP_F11],
    );
  });

  test("la tuile LCP ouvre /pages?vital=LCP en gardant l'app et la plage", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/?app=${APP_F11}&period=7d`, { waitUntil: "domcontentloaded" });
    const lienLcp = page.getByTestId("tuile-LCP").locator("a").first();
    await expect(lienLcp).toBeVisible({ timeout: 15_000 });
    const href = new URL((await lienLcp.getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("vital")).toBe("LCP");
    expect(href.searchParams.get("app")).toBe(APP_F11);
    expect(href.searchParams.get("period")).toBe("7d");
  });

  test("« Sessions commencées » : le même nombre sur / et sur /sessions", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const valeur = (await page.getByTestId("tuile-sessions").getByTestId("kpi-valeur").innerText()).replace(/\s/g, "");
    expect(valeur).toMatch(/^\d+$/);

    await page.goto(`${consoleUrl}/sessions?app=${APP_F11}&period=24h`, { waitUntil: "domcontentloaded" });
    // Tuile de tête de /sessions (F41), ou, avant elle, la population du bloc d'engagement.
    const tuile = page.getByTestId("kpi-tile").filter({ hasText: "Sessions commencées" });
    const surSessions =
      (await tuile.count()) > 0
        ? await tuile.first().getByTestId("kpi-valeur").innerText()
        : ((await page.getByTestId("engagement").innerText()).match(/Population : les ([\d\s\u00a0\u202f]+) session/)?.[1] ?? "");
    expect(surSessions.replace(/\s/g, "")).toBe(valeur);
  });

  test("la tuile d'erreurs est un ratio « pour 100 », jamais un pourcentage", async ({ page }) => {
    await login(page);
    // `cmp=none` : pas d'écart relatif, dont le « % » est une variation, pas la valeur.
    await page.goto(`${ACCUEIL_F11}&cmp=none`, { waitUntil: "domcontentloaded" });
    const tuile = page.getByTestId("tuile-erreurs");
    await expect(tuile).toContainText("Occurrences d'erreurs pour 100 pages vues", { timeout: 15_000 });
    await expect(tuile.getByTestId("kpi-valeur")).toContainText("pour");
    await expect(tuile).not.toContainText("%");
    // L'erreur backend (sans page vue) est écartée du numérateur, et comptée à part.
    await expect(tuile).toContainText("hors navigateur");
  });

  test("à 390 px, aucun libellé de facteur de santé n'est tronqué, et rien ne déborde", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const libelles = page.getByTestId("facteur-libelle");
    await expect(libelles).toHaveCount(4, { timeout: 15_000 });
    for (const texte of ["Web Vitals", "Erreurs navigateur", "Stabilité des sessions", "Anomalies LCP (24 h)"]) {
      const l = libelles.filter({ hasText: texte });
      await expect(l).toHaveText(texte);
      // Tronqué = le texte est plus large que sa boîte (ellipse ou coupure).
      expect(await l.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), texte).toBe(true);
    }
    expect(await debordements(page)).toEqual([]);
  });

  test("les constats se lisent repliés, avec leur règle ; aucun lien ne porte fired=", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const constats = page.getByTestId("constats");
    await expect(constats).toBeVisible({ timeout: 15_000 });
    // Le déploiement semé dégrade le LCP : un constat de régression, lien cmp=release.
    await expect(constats).toContainText(/Constats \(\d+\)/);
    await constats.locator("summary").click();
    const regression = constats.getByTestId("constat").filter({ hasText: "Déploiement f11-2.0.0" });
    await expect(regression).toContainText("pages vues avant");
    await expect(regression).toContainText("Règle :");
    const href = new URL((await regression.locator("a").getAttribute("href"))!, consoleUrl);
    expect([href.searchParams.get("cmp"), href.searchParams.get("rel_b"), href.searchParams.get("rel_a")]).toEqual([
      "release",
      "f11-2.0.0",
      "f11-1.9.0",
    ]);
    for (const a of await constats.locator("a").all()) expect(await a.getAttribute("href")).not.toContain("fired=");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement sur / à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tuile-LCP")).toBeVisible({ timeout: 15_000 });
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    });
  }
});
