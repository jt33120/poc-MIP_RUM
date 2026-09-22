// E2E — F04 : les séries temporelles (ThresholdSeries, StackedBars) sur la Vue d'ensemble
// et dans la vitrine des composants.
//
// Preuve de fin du lot (plan § 6.4) : la bande « Bon » est visible derrière le LCP p75
// de `/` avec les données de démonstration, et plus aucun graphique n'a deux axes y.
// En plus : un seau sans mesure est un TROU (la courbe se coupe), le clic sur un seau
// zoome (`from`/`to`, plus de `period`), et la vitrine montre chaque état.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée : des mesures LCP sur des
// heures choisies, séparées par des heures sans mesure. Un compte admin dédié, jamais
// le compte admin local de seed-admin.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f04-series-e2e";
const E2E_EMAIL = "e2e-series@mip-rum.local";
const E2E_PASSWORD = "e2e-series-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

function bcryptHash(password: string): string {
  return execFileSync(
    "node",
    [
      "-e",
      `const { createRequire } = require("node:module");
       const req = createRequire(process.cwd() + "/apps/console/package.json");
       const m = req("bcryptjs");
       const bcrypt = m.hashSync ? m : m.default;
       process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
      password,
    ],
    { encoding: "utf8" },
  );
}

/**
 * Heures (avant maintenant) qui portent des mesures : 20 h et 19 h, 5 h et 4 h, 1 h.
 * Entre elles, des heures SANS mesure : la courbe doit s'y couper, en trois morceaux.
 */
const HEURES_MESUREES = [20, 19, 5, 4, 1];

async function semer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Séries E2E') on conflict (app_id) do nothing`, [APP_ID]);
  for (const heure of HEURES_MESUREES) {
    for (let k = 0; k < 3; k++) {
      const sid = `${APP_ID}-h${heure}-s${k}`;
      // Au milieu de l'heure : jamais à cheval sur deux seaux.
      const quand = `now() - interval '${heure} hours' + interval '${k * 3} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)
         on conflict (session_id) do nothing`,
        [sid, APP_ID],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/', ${quand})
         on conflict (span_id) do nothing`,
        [`${sid}-pv`, sid, APP_ID],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, '/', 'LCP', $4, 'good', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-lcp`, sid, APP_ID, 1800 + heure * 20 + k * 150],
      );
      if (k === 0) {
        await pool.query(
          `insert into rum_error (span_id, session_id, app_id, route, kind, message, ts)
           values ($1, $2, $3, '/', 'error', 'TypeError: e2e séries', ${quand}) on conflict (span_id) do nothing`,
          [`${sid}-err`, sid, APP_ID],
        );
      }
    }
  }
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** La série LCP du hero : la première ThresholdSeries à bandes LCP de la page. */
const heroLcp = (page: Page) => page.locator('[data-testid="threshold-series"][data-vital="LCP"]').first();

/** Même helper que tests/e2e/composants.spec.ts (extrait vers helpers/ par F09). */
async function debordements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const totale = document.documentElement.scrollWidth;
    if (totale <= largeur) return [];
    const dansDefilant = (el: Element) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX)) return true;
      }
      return false;
    };
    const fautifs = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= largeur + 1) return false;
        return ["absolute", "fixed"].includes(getComputedStyle(el).position) || !dansDefilant(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} « ${el.textContent?.trim().slice(0, 60) ?? ""} » → ${Math.round(el.getBoundingClientRect().right)} px`);
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test("/ : bande « Bon » visible derrière le LCP p75, avec les données de démo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  // L'app de ce test (qui garantit des mesures sur 24 h) : sans `app`, `/` est le
  // sélecteur de projet, pas la vue d'ensemble.
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  const serie = heroLcp(page);
  // recharts dessine après hydratation.
  await expect(serie.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
  await expect(serie.locator(".recharts-reference-area.bande-bon")).toBeVisible();
  await expect(serie.locator('[data-bande-legende="bon"]')).toHaveText(/Bon\s≤\s2,5\ss/);
  await expect(serie.locator('[data-bande-legende="mauvais"]')).toHaveText(/Mauvais\s>\s4,0\ss/);
  // Plus les deux pointillés d'avant : des bandes pleines, et le texte le dit.
  await expect(page.getByText("pointillé vert")).toHaveCount(0);
});

test("/ : un seau sans mesure est un trou, la courbe se coupe", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  const serie = heroLcp(page);
  await expect(serie.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
  // 24 seaux d'une heure attendus (25 quand la fenêtre commence au milieu d'une heure).
  expect(Number(await serie.getAttribute("data-seaux"))).toBeGreaterThanOrEqual(24);
  // Une seule courbe, trois morceaux : autant de « M » (déplacement sans trait) dans son tracé.
  const d = (await serie.locator("path.recharts-line-curve").first().getAttribute("d")) ?? "";
  expect(d.match(/M/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
});

test("/ : aucun graphique à deux axes y ; le trafic quotidien en deux panneaux sur la même grille", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  const trafic = page.getByTestId("traffic-timeseries");
  await expect(trafic.locator(".recharts-surface")).toHaveCount(2, { timeout: 15_000 });
  const panneaux = trafic.locator('[data-testid="stacked-bars"], [data-testid="threshold-series"]');
  await expect(panneaux).toHaveCount(2);
  const seaux = await panneaux.evaluateAll((els) => els.map((el) => el.getAttribute("data-seaux")));
  expect(seaux).toEqual(["14", "14"]);

  const axesParGraphique = await page
    .locator(".recharts-wrapper")
    .evaluateAll((els) => els.map((el) => el.querySelectorAll(".recharts-yAxis").length));
  expect(axesParGraphique.length).toBeGreaterThan(0);
  expect(axesParGraphique.filter((n) => n > 1)).toEqual([]);
});

test("/ : un clic sur un seau zoome sur sa plage (from/to, plus de period)", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  const surface = heroLcp(page).locator(".recharts-surface").first();
  await expect(surface).toBeVisible({ timeout: 15_000 });
  // Le hero est sous le pli à 1280 × 720 : un clic à des coordonnées hors de la
  // fenêtre ne touche rien.
  await surface.scrollIntoViewIfNeeded();
  const boite = await surface.boundingBox();
  if (!boite) throw new Error("graphique sans boîte");
  await page.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
  await page.mouse.click(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
  await page.waitForURL((u) => u.searchParams.has("from") && u.searchParams.has("to"), { timeout: 15_000 });
  const u = new URL(page.url());
  expect(u.searchParams.get("app")).toBe(APP_ID);
  expect(u.searchParams.has("period")).toBe(false);
  expect(u.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  // L'écran d'arrivée accepte la plage : pas de refus du contrat.
  await expect(page.locator("h1").first()).toHaveText(/Vue d'ensemble/);
});

test("/ : aucun débordement à 390 et 1440 px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const fautes: string[] = [];
  for (const largeur of [390, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(heroLcp(page).locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
    for (const faute of await debordements(page)) fautes.push(`/ @ ${largeur} px — ${faute}`);
  }
  expect(fautes).toEqual([]);
});

test("vitrine : chaque composant de séries et ses états", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/admin/composants`, { waitUntil: "domcontentloaded" });
  for (const id of ["threshold-series", "stacked-bars", "vitals-timeseries"]) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }
  const series = page.locator("section#threshold-series");
  await expect(series.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
  await expect(series.locator(".recharts-reference-area.bande-bon").first()).toBeVisible();
  await expect(series.getByTestId("seuil-hors-echelle").filter({ hasText: "4,0" })).toHaveText(/seuil Mauvais à 4,0\ss, hors échelle/);
  await expect(series.getByTestId("series-non-tracees")).toContainText("1 série non tracée");
  await expect(series.getByTestId("points-hors-grille")).toContainText("1 point hors de la grille");
  await expect(series.getByText(/Annotations non affichées : déploiements non affichés/)).toBeVisible();
  await expect(series.getByTestId("legende-faible-effectif").first()).toContainText("moins de 30 mesures");
  // La grille horaire de la vitrine finit à l'heure en cours : son dernier seau est « en cours ».
  await expect(series.getByTestId("legende-seau-en-cours").first()).toBeVisible();
  // Annotations : trois dans la fenêtre, la quatrième (hors fenêtre) écartée ; liens accessibles.
  const annotations = series.getByTestId("legende-annotations").first();
  await expect(annotations.getByRole("link")).toHaveCount(2);
  await expect(annotations).not.toContainText("v1.4.1");

  const barres = page.locator("section#stacked-bars");
  // `.recharts-wrapper` : une par graphique ; `.recharts-surface` compte aussi les icônes de légende.
  await expect(barres.locator(".recharts-wrapper")).toHaveCount(3, { timeout: 15_000 });
  await expect(barres.getByRole("link", { name: "Critique" })).toHaveAttribute("href", "/alerts");

  await expect(page.getByTestId("line-trend-volume")).toBeVisible();
});
