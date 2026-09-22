// E2E — F01 : le contraste du texte est MESURÉ, en clair et en sombre.
//
// La règle `color-contrast` d'axe-core calcule, pour chaque texte visible, le
// rapport avec son fond réel (couleurs calculées, transparences composées) et
// exige 4,5:1 (3:1 au-delà de 18 px). Le test échoue en nommant chaque élément
// fautif et son rapport : un texte gris clair sur fond blanc ne se voit pas à
// l'œil d'un développeur sur un bon écran — il se voit ici.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée : des pages vues, des
// Web Vitals et des erreurs, pour que badges, jauges et tableaux soient rendus.
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f01-e2e-app";
const E2E_EMAIL = "e2e-contraste@mip-rum.local";
const E2E_PASSWORD = "e2e-contraste-mdp-local";
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
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Contraste E2E') on conflict (app_id) do nothing`, [APP_ID]);
  // Des valeurs dans les trois zones, pour que les trois badges existent.
  const lcp = [1800, 2100, 3200, 3600, 4800, 5200];
  for (const [i, v] of lcp.entries()) {
    const sid = `${APP_ID}-s${i}`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '30 minutes', now() - interval '20 minutes', 1)
       on conflict (session_id) do nothing`,
      [sid, APP_ID],
    );
    const route = i % 2 ? "/panier" : "/";
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, now() - interval '25 minutes')
       on conflict (span_id) do nothing`,
      [`${sid}-pv`, sid, APP_ID, route],
    );
    for (const [nom, valeur] of [["LCP", v], ["INP", 120 + i * 90], ["CLS", 0.05 + i * 0.05]] as const) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, $4, $5, $6, 'good', now() - interval '25 minutes') on conflict (span_id) do nothing`,
        [`${sid}-${nom}`, sid, APP_ID, route, nom, valeur],
      );
    }
    if (i % 2) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, ts)
         values ($1, $2, $3, $4, 'error', 'TypeError: e2e contraste', now() - interval '22 minutes') on conflict (span_id) do nothing`,
        [`${sid}-err`, sid, APP_ID, route],
      );
    }
  }
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

for (const schema of ["light", "dark"] as const) {
  for (const chemin of ["/", "/pages", "/errors"]) {
    test(`contraste ≥ 4,5:1 — ${chemin} en ${schema === "light" ? "clair" : "sombre"}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema });
      await login(page);
      await page.goto(`${consoleUrl}${chemin}?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(schema === "dark");
      const resultat = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      const fautes = resultat.violations.flatMap((v) =>
        v.nodes.map((n) => `${n.target.join(" ")} — ${n.any[0]?.message ?? v.help}`),
      );
      expect(fautes).toEqual([]);
    });
  }
}
