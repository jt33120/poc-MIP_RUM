// E2E — domaine Fiabilité (F55) : les écrans s'affichent, et disent vrai.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Que /forecast plante au rendu. Il passait une FONCTION de formatage à un
//     composant client : Next.js refuse de la sérialiser, et l'écran rendait
//     « Application error » dès qu'il y avait des données — donc justement quand
//     on voulait le montrer.
//   - Qu'un SLO sans aucune mesure s'affiche « objectif manqué ». slo_status()
//     rend `attainment = null` dans ce cas ; lu comme 0 %, il devenait un échec.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, sur six jours passés.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f55-e2e-app";
const E2E_EMAIL = "e2e-fiabilite@mip-rum.local";
const E2E_PASSWORD = "e2e-fiabilite-mdp-local";
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

async function semer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "slo"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Fiabilité E2E') on conflict (app_id) do nothing`,
    [APP_ID],
  );
  // Six jours passés, un LCP qui monte doucement : de quoi tracer une droite.
  for (let jour = 1; jour <= 6; jour++) {
    const sid = `${APP_ID}-s${jour}`;
    const quand = `now() - interval '${jour} days'`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 3)
       on conflict (session_id) do nothing`,
      [sid, APP_ID],
    );
    for (let p = 0; p < 3; p++) {
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-pv${p}`, sid, APP_ID],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, '/', 'LCP', $4, 'good', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-lcp${p}`, sid, APP_ID, 1800 + (6 - jour) * 60 + p * 10],
      );
    }
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, ts)
       values ($1, $2, $3, '/', 'error', 'boom', ${quand}) on conflict (span_id) do nothing`,
      [`${sid}-err`, sid, APP_ID],
    );
  }
  // Un SLO sur l'INP, que rien ne mesure dans cette app.
  await pool.query(
    `insert into slo (app_id, name, metric, objective, window_days) values ($1, 'INP sans mesure (e2e)', 'INP', 0.9, 7)`,
    [APP_ID],
  );
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
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

test("/forecast s'affiche avec des données, sur un seul horizon de 7 jours", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/forecast?app=${APP_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText("LCP p75 — réel + projection à J+7");
  // Le ratio d'erreurs n'est pas une part : jamais « % », et plus de seuil « 2 % » inventé.
  await expect(page.locator("body")).toContainText("Occurrences d'erreurs pour 100 pages vues");
  await expect(page.locator("body")).not.toContainText("Seuil d'alerte : 2 %");
});

test("/slo : un SLO sans mesure est « non mesurable », pas « objectif manqué »", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/slo?app=${APP_ID}`, { waitUntil: "domcontentloaded" });
  const ligne = page.locator("tr", { hasText: "INP sans mesure (e2e)" });
  await expect(ligne).toContainText("non mesurable");
  await expect(ligne).not.toContainText("objectif manqué");
});

// ---------------------------------------------------------------------------
// F63 — écran SLO (/slo, plan § 5.18) : des barres de budget, l'absence dite,
// aucune écriture pour un viewer.
//
// Données EXPLICITEMENT SYNTHÉTIQUES dans une app à part, mesurées il y a deux
// heures (dans la fenêtre de 7 jours de chaque SLO) :
//   - « LCP tenu (e2e) » : 100 mesures LCP notées Bon, objectif 90 % → 0 % consommé ;
//   - « INP dépassé (e2e) » : 60 Bon + 40 Mauvais, objectif 95 % → 800 % consommé ;
//   - « CLS sans mesure (e2e) » : aucune mesure → non mesurable.
// Un compte VIEWER dédié à ce fichier vérifie qu'aucun bouton d'écriture n'est rendu.
// ---------------------------------------------------------------------------
test.describe("F63 — Écran SLO", () => {
  const APP_F63 = "f63-e2e-app";
  const VIEWER_F63 = { email: "e2e-fiabilite-viewer@mip-rum.local", motDePasse: "e2e-fiabilite-viewer-mdp-local" };

  test.beforeAll(async () => {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', null, true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = null, active = true`,
      [VIEWER_F63.email, bcryptHash(VIEWER_F63.motDePasse)],
    );
    for (const t of ["rum_metric", "rum_session", "slo"]) await pool.query(`delete from ${t} where app_id = $1`, [APP_F63]);
    await pool.query(`insert into app_registry (app_id, name) values ($1, 'SLO E2E') on conflict (app_id) do nothing`, [APP_F63]);
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '3 hours', now() - interval '2 hours', 1)
       on conflict (session_id) do nothing`,
      [`${APP_F63}-s`, APP_F63],
    );
    let lot = 0;
    const mesures = async (nom: string, rating: "good" | "poor", valeur: number, n: number) => {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         select $1 || '-' || g, $2, $3, '/', $4, $5, $6, now() - interval '2 hours' + make_interval(secs => g)
           from generate_series(1, $7) g`,
        [`${APP_F63}-m${(lot += 1)}`, `${APP_F63}-s`, APP_F63, nom, valeur, rating, n],
      );
    };
    await mesures("LCP", "good", 1200, 100);
    await mesures("INP", "good", 120, 60);
    await mesures("INP", "poor", 900, 40);
    for (const [nom, metrique, objectif] of [
      ["LCP tenu (e2e)", "LCP", 0.9],
      ["INP dépassé (e2e)", "INP", 0.95],
      ["CLS sans mesure (e2e)", "CLS", 0.9],
    ] as const) {
      await pool.query(`insert into slo (app_id, name, metric, objective, window_days) values ($1, $2, $3, $4, 7)`, [
        APP_F63,
        nom,
        metrique,
        objectif,
      ]);
    }
  });

  const ecran = `${consoleUrl}/slo?app=${APP_F63}`;
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ hasText: libelle }).getByTestId("kpi-valeur");

  test("SLO sans mesure → « Non mesurable », jamais « 0 % » ; dépassé écrit et « épuisé »", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    await expect(tuile(page, "SLO actifs")).toHaveText("3");
    await expect(tuile(page, "Budget épuisé")).toHaveText("1");
    await expect(tuile(page, "Non mesurables")).toHaveText("1");

    const budget = page.locator("#budget");
    const sans = budget.getByTestId("budget-ligne").filter({ hasText: "CLS sans mesure (e2e)" });
    await expect(sans).toHaveAttribute("data-statut", "non_mesurable");
    await expect(sans).toContainText("Non mesurable");
    await expect(sans.locator("[data-barre]")).toHaveCount(0);
    expect(await sans.innerText()).not.toMatch(/(^|\s)0\s?%/);
    const depasse = budget.getByTestId("budget-ligne").filter({ hasText: "INP dépassé (e2e)" });
    await expect(depasse).toHaveAttribute("data-statut", "epuise");
    await expect(depasse.getByTestId("budget-valeur")).toContainText("800");
    // Tri : consommé décroissant, non mesurable en dernier.
    await expect(budget.getByTestId("budget-ligne").last()).toContainText("CLS sans mesure (e2e)");

    const ligne = page.locator("#definitions tr", { hasText: "CLS sans mesure (e2e)" });
    await expect(ligne).toContainText("non mesurable");
    await expect(ligne).toContainText("Part des mesures CLS notées Bon");
    await expect(ligne).not.toContainText("objectif manqué");
  });

  test("SL4 « Consommation du budget dans le temps » : Non collecté, aucune série", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#consommation-temps");
    await expect(figure).toContainText("Non collecté");
    await expect(figure).toContainText("historique de consommation non conservé");
    await expect(figure.locator(".recharts-wrapper, svg")).toHaveCount(0);
  });

  test("viewer : aucun bouton d'écriture dans le DOM", async ({ page }) => {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', VIEWER_F63.email);
    await page.fill('input[name="password"]', VIEWER_F63.motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#definitions tr", { hasText: "INP dépassé (e2e)" })).toBeVisible();
    await expect(page.locator('[data-testid^="toggle-slo-"], [data-testid^="delete-slo-"], [data-testid="create-slo"]')).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main").getByText("Créer une alerte")).toHaveCount(0);
    await expect(page.locator("#nouveau-slo")).toHaveCount(0);
  });

  test("admin : les actions sont là (même écran)", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    const ligne = page.locator("#definitions tr", { hasText: "INP dépassé (e2e)" });
    await expect(ligne.getByRole("button", { name: "Désactiver" })).toBeVisible();
    await expect(ligne.getByRole("link", { name: "Créer une alerte" })).toHaveAttribute("href", /regle_metrique=INP/);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    const { debordements, LARGEURS } = await import("./helpers/debordements");
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(ecran, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#budget")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});
