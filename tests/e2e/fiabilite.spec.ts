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
