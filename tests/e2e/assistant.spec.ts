// E2E — l'assistant de la Vue d'ensemble (30/09/2026) : un volet à droite qui répond
// à partir des chiffres du tableau de bord, et dont chaque source, cliquée, surligne
// le bon endroit de la page.
//
// En CI, aucune clé de modèle n'est posée : l'assistant répond PAR RÈGLES, et c'est
// ce chemin que ce fichier vérifie de bout en bout — bouton, volet, question
// suggérée, route `/api/assistant`, réponse citée, sources, surlignage.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, et un compte admin dédié à
// ce fichier (jamais `scripts/seed-admin.mjs`).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const APP_ID = "assistant-e2e";
const E2E_EMAIL = "e2e-assistant@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

/** Six sessions sur deux routes, des Web Vitals dans les trois zones, deux erreurs. */
async function semer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"]) await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Assistant E2E') on conflict (app_id) do nothing`, [APP_ID]);
  const lcp = [1800, 2100, 3200, 3600, 4800, 5200];
  for (const [i, v] of lcp.entries()) {
    const sid = `${APP_ID}-s${i}`;
    const route = i % 2 ? "/panier" : "/";
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '40 minutes', now() - interval '30 minutes', 1)
       on conflict (session_id) do nothing`,
      [sid, APP_ID],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, now() - interval '35 minutes')
       on conflict (span_id) do nothing`,
      [`${sid}-pv`, sid, APP_ID, route],
    );
    for (const [nom, valeur] of [["LCP", v], ["INP", 120 + i * 90], ["CLS", 0.05 + i * 0.05]] as const) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, $4, $5, $6, 'good', now() - interval '35 minutes') on conflict (span_id) do nothing`,
        [`${sid}-${nom}`, sid, APP_ID, route, nom, valeur],
      );
    }
    if (i % 3 === 0) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, ts)
         values ($1, $2, $3, $4, 'error', 'TypeError: e2e assistant', now() - interval '32 minutes') on conflict (span_id) do nothing`,
        [`${sid}-err`, sid, APP_ID, route],
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

/** La Vue d'ensemble de l'app dédiée, hydratée : le volet (fermé) est monté dans <body>. */
async function ouvrirVueEnsemble(page: Page) {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_ID}&period=24h`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("assistant-volet")).toBeAttached({ timeout: 20_000 });
}

test("le résumé suggéré répond par règles, avec ses sources ; une source cliquée surligne son chiffre", async ({ page }) => {
  await ouvrirVueEnsemble(page);

  const bouton = page.getByTestId("assistant-ouvrir");
  await expect(bouton).toHaveAttribute("aria-expanded", "false");
  await bouton.click();
  const volet = page.getByTestId("assistant-volet");
  await expect(volet).toBeVisible();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  // La portée : cet écran, cette application, cette période.
  await expect(page.getByTestId("assistant-portee")).toContainText("Vue d'ensemble");
  await expect(page.getByTestId("assistant-portee")).toContainText(APP_ID);
  await expect(page.getByTestId("assistant-suggestion")).toHaveCount(4);

  await page.getByTestId("assistant-suggestion").filter({ hasText: "Résume l'état de mon application aujourd'hui" }).click();
  const reponse = page.getByTestId("assistant-reponse").last();
  await expect(reponse).toBeVisible({ timeout: 20_000 });
  // Sans clé de modèle (la CI) : la réponse par règles, qui le dit.
  await expect(reponse).toHaveAttribute("data-mode", "regles");
  await expect(page.getByTestId("assistant-question")).toHaveText("Résume l'état de mon application aujourd'hui");

  const sources = reponse.getByTestId("assistant-source");
  expect(await sources.count()).toBeGreaterThan(0);
  expect(await reponse.getByTestId("assistant-pastille").count()).toBeGreaterThan(0);

  // Cliquer une source : la page défile jusqu'au chiffre, qui porte le surlignage.
  const premiere = sources.first();
  const cible = await premiere.getAttribute("data-cible");
  expect(cible).toBeTruthy();
  await premiere.click();
  await expect(page.locator(cible!).first()).toHaveClass(/assistant-surlignage/);
  // Le surlignage s'en va de lui-même (2,5 s).
  await expect(page.locator(cible!).first()).not.toHaveClass(/assistant-surlignage/, { timeout: 6_000 });
});

test("Échap ferme le volet et rend le focus au bouton ; la conversation reste", async ({ page }) => {
  await ouvrirVueEnsemble(page);
  await page.getByTestId("assistant-ouvrir").click();
  await page.getByTestId("assistant-suggestion").filter({ hasText: "Y a-t-il des erreurs ou des alertes en cours ?" }).click();
  await expect(page.getByTestId("assistant-reponse")).toHaveCount(1, { timeout: 20_000 });

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("assistant-volet")).toBeHidden();
  await expect(page.getByTestId("assistant-ouvrir")).toBeFocused();

  await page.getByTestId("assistant-ouvrir").click();
  await expect(page.getByTestId("assistant-reponse")).toHaveCount(1);
});

test("une question libre, tapée : une réponse sourcée, jamais une page d'erreur", async ({ page }) => {
  await ouvrirVueEnsemble(page);
  await page.getByTestId("assistant-ouvrir").click();
  await page.getByTestId("assistant-saisie").fill("Quelles pages sont les plus lentes ?");
  await page.getByTestId("assistant-saisie").press("Enter");
  const reponse = page.getByTestId("assistant-reponse").last();
  await expect(reponse).toBeVisible({ timeout: 20_000 });
  await expect(reponse.getByTestId("assistant-source").first()).toBeVisible();
});

test("à 390 px, le volet occupe l'écran sans débordement ; une source le referme et montre le chiffre", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrirVueEnsemble(page);
  await page.getByTestId("assistant-ouvrir").click();
  const volet = page.getByTestId("assistant-volet");
  const boite = await volet.boundingBox();
  expect(boite?.width).toBe(390);
  expect(await debordements(page)).toEqual([]);

  await page.getByTestId("assistant-suggestion").first().click();
  const source = page.getByTestId("assistant-source").first();
  await expect(source).toBeVisible({ timeout: 20_000 });
  const cible = await source.getAttribute("data-cible");
  await source.click();
  await expect(volet).toBeHidden();
  await expect(page.locator(cible!).first()).toHaveClass(/assistant-surlignage/);
  await expect(page.locator(cible!).first()).toBeInViewport();
});

for (const schema of ["light", "dark"] as const) {
  test(`contraste du volet ouvert, réponse comprise — ${schema === "light" ? "clair" : "sombre"}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema, reducedMotion: "reduce" });
    await ouvrirVueEnsemble(page);
    await page.getByTestId("assistant-ouvrir").click();
    await page.getByTestId("assistant-suggestion").first().click();
    await expect(page.getByTestId("assistant-source").first()).toBeVisible({ timeout: 20_000 });
    const resultat = await new AxeBuilder({ page }).withRules(["color-contrast"]).include('[data-testid="assistant-volet"]').analyze();
    const fautes = resultat.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")} — ${n.any[0]?.message ?? v.help}`));
    expect(fautes).toEqual([]);
  });
}
