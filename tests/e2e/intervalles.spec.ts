// E2E — P*.1 : l'intervalle sur chaque chiffre clé (plan § 7.2, critère de recette).
//
// Sur `/` : chaque tuile Web Vital affiche soit un intervalle à 95 %, soit
// « intervalle non calculable : n mesures, 13 requises » ; aucune tuile n'a de
// couleur de verdict sous 13 mesures ; la moustache est sur la jauge de chaque
// tuile qui a un intervalle, et absente des autres ; le lecteur d'écran annonce
// l'intervalle ; aucun débordement à 390, 768 et 1440 px. Sur `/pages` : la table
// des percentiles porte la colonne « Intervalle p75 (95 %) ».
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, et un compte admin
// dédié à ce fichier (jamais le compte de seed-admin).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const APP_ID = "ps1-intervalles-e2e";
const E2E_EMAIL = "e2e-intervalles@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

/** Nombre de mesures par vital : trois régimes (normal ≥ 30, exact 13-29, refus < 13). */
const EFFECTIFS: Record<string, { n: number; base: number; pas: number }> = {
  LCP: { n: 40, base: 1600, pas: 40 }, // rangs normaux
  INP: { n: 7, base: 120, pas: 10 }, // refus : 7 mesures, 13 requises
  CLS: { n: 20, base: 0.02, pas: 0.004 }, // rangs exacts
  FCP: { n: 13, base: 1200, pas: 30 }, // le minimum exact
  TTFB: { n: 5, base: 300, pas: 20 }, // refus
};
const AVEC_INTERVALLE = ["LCP", "CLS", "FCP"];
const SANS_INTERVALLE = ["INP", "TTFB"];

async function semer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Intervalles E2E') on conflict (app_id) do nothing`, [APP_ID]);
  for (const [nom, { n, base, pas }] of Object.entries(EFFECTIFS)) {
    for (let i = 0; i < n; i++) {
      const sid = `${APP_ID}-${nom}-${i}`;
      const quand = `now() - interval '${30 + i} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '1 minute', 1)
         on conflict (session_id) do nothing`,
        [sid, APP_ID],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/', ${quand})
         on conflict (span_id) do nothing`,
        [`${sid}-pv`, sid, APP_ID],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
         values ($1, $2, $3, '/', $4, $5, ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-m`, sid, APP_ID, nom, base + i * pas],
      );
    }
  }
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** La carte d'un vital : la `.card` qui porte sa valeur p75. */
const carte = (page: Page, nom: string) => page.locator(".card", { has: page.getByTestId(`p75-${nom}`) }).first();

async function largeurDebordante(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("/ : chaque tuile Web Vital dit son intervalle, ou pourquoi il manque", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });

  for (const nom of AVEC_INTERVALLE) {
    const c = carte(page, nom);
    await expect(c.getByTestId(`intervalle-${nom}`), nom).toContainText(/entre .+ et .+ \(95 %\)/);
    await expect(c.getByTestId(`moustache-${nom}`), nom).toHaveCount(1);
    // Le lecteur d'écran annonce l'intervalle : il est dans l'alternative de la jauge.
    await expect(c.getByTestId(`meter-${nom}`), nom).toHaveAttribute("aria-label", /intervalle entre/);
  }

  for (const nom of SANS_INTERVALLE) {
    const c = carte(page, nom);
    await expect(c.getByTestId(`intervalle-${nom}`), nom).toContainText(
      `intervalle non calculable : ${EFFECTIFS[nom].n} mesures, 13 requises`,
    );
    await expect(c.getByTestId(`moustache-${nom}`), nom).toHaveCount(0);
    await expect(c.getByTestId(`verdict-${nom}`), nom).toHaveText("Non établi");
    // Aucune couleur de verdict sous 13 mesures : ni badge teinté, ni curseur coloré.
    // (Badge : classes de RATING_CLASS ; curseur : jeton exact de RATING_BAR, les zones
    // de la jauge portant `bg-good/25`, un autre jeton.)
    expect(await c.locator('[class*="border-good/30"], [class*="border-warn/30"], [class*="border-bad/30"]').count(), nom).toBe(0);
    expect(await c.locator(".bg-good, .bg-warn, .bg-bad").count(), nom).toBe(0);
  }
});

test("/pages : la table des percentiles porte l'intervalle du p75", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/pages?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  const table = page.getByTestId("percentile-table");
  await expect(table).toContainText("Intervalle p75 (95 %)");
  await expect(table.getByTestId("intervalle-p75-LCP")).toContainText(/entre .+ et .+ \(95 %\)/);
  await expect(table.getByTestId("intervalle-p75-INP")).toContainText("intervalle non calculable : 7 mesures, 13 requises");
  await expect(table.getByTestId("p75-incertain-INP")).toContainText("verdict non établi");
});

for (const largeur of [390, 768, 1440]) {
  test(`aucun débordement à ${largeur} px sur / et /pages`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await login(page);
    for (const chemin of ["/", "/pages"]) {
      await page.goto(`${consoleUrl}${chemin}?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(chemin === "/" ? "p75-LCP" : "percentile-table")).toBeVisible();
      expect(await largeurDebordante(page), `${chemin} à ${largeur} px`).toBeLessThanOrEqual(0);
    }
  });
}
