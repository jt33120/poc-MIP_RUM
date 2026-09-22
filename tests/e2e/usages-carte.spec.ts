// E2E — F52 (plan § 5.10) : la Carte d'expérience.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Le retour de la page qui disparaît : avant F52, une carte vide masquait TOUT
//     l'écran, y compris « Pages les plus visitées », qui ne dépend pas du tracing.
//   - Un lien jeté en silence : au-delà de dix routes par colonne, les arêtes vers
//     les routes masquées étaient supprimées. Elles arrivent sur « Autres routes (N) ».
//   - Un graphe illisible à 390 px : la table des liens le REMPLACE à cette largeur.
//   - Une pastille verte sans mesure : une route sans LCP n'affiche aucun verdict.
//   - Une santé portée par la seule couleur : elle est ÉCRITE dans le nœud.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées, et un compte admin
// dédié à ce fichier (jamais le compte de seed-admin).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_F52 = "f52-carte-e2e";
const APP_F52_VIDE = "f52-carte-vide-e2e";
const APPS_F52 = [APP_F52, APP_F52_VIDE];
const E2E_EMAIL = "e2e-f52-carte@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

/** Routes serveur semées : 12 > 10, le plafond d'une colonne — « Autres routes (2) ». */
const ROUTES_BACK = 12;

async function nettoyerF52() {
  for (const t of ["rum_metric", "rum_span", "rum_session"])
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS_F52]);
}

async function semerF52() {
  await nettoyerF52();
  for (const app of APPS_F52) {
    await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, sample_rate, error_sample_rate, started_at, last_seen_at, page_count)
       values ($1 || '-s', $1, $1 || '-v', 'desktop', false, 1, 1, now() - interval '2 hours', now() - interval '5 minutes', 3)`,
      [app],
    );
  }
  // Une instruction par table (generate_series) : la route `/api/rNN` reçoit NN
  // appels, ce qui rend l'ordre du classement DÉTERMINISTE (r12 en tête, r02 et r01
  // au-delà du plafond de dix). Chaque appel navigateur a SA réponse serveur, dont
  // il est le parent : c'est ce lien-là, et pas le `trace_id`, qui fait l'arête.
  await pool.query(
    `insert into rum_span (span_id, trace_id, parent_span_id, tier, app_id, session_id, route, method, status_code, duration_ms, ts)
     select 'f52e-f' || i || '-' || j, 'f52e-t' || i || '-' || j, null, 'front', $1, $1 || '-s', '/panier', 'GET', 200, 100 + i * 10,
            now() - interval '20 minutes' + ((i * 20 + j) || ' seconds')::interval
     from generate_series(1, $2::int) i, generate_series(1, i) j`,
    [APP_F52, ROUTES_BACK],
  );
  await pool.query(
    `insert into rum_span (span_id, trace_id, parent_span_id, tier, app_id, session_id, route, method, status_code, duration_ms, ts)
     select 'f52e-b' || i || '-' || j, 'f52e-t' || i || '-' || j, 'f52e-f' || i || '-' || j, 'back', $1, null,
            '/api/r' || lpad(i::text, 2, '0'), 'GET', 200, 40 + i * 20,
            now() - interval '20 minutes' + ((i * 20 + j) || ' seconds')::interval
     from generate_series(1, $2::int) i, generate_series(1, i) j`,
    [APP_F52, ROUTES_BACK],
  );
  // Deux routes mesurées dans CHAQUE app : /panier a un LCP, /compte n'en a pas.
  await pool.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
     select app || '-m1', app || '-s', app, '/panier', 'LCP', 1500, now() - interval '10 minutes'
     from unnest($1::text[]) as app`,
    [APPS_F52],
  );
  await pool.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
     select app || '-m2', app || '-s', app, '/compte', 'INP', 120, now() - interval '10 minutes'
     from unnest($1::text[]) as app`,
    [APPS_F52],
  );
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  await semerF52();
});

test.afterAll(async () => {
  await nettoyerF52();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

const urlCarte = (app: string, extra = "") => `${consoleUrl}/map?app=${app}&period=24h${extra}`;

test.describe("F52 — Carte d'expérience", () => {
  test("carte vide : le graphe dit le vide, « Pages les plus visitées » reste affichée", async ({ page }) => {
    await login(page);
    await page.goto(urlCarte(APP_F52_VIDE), { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    // Le hero est en état « vide » motivé, sans figure dessinée.
    const graphe = page.locator("#carte-graphe");
    await expect(graphe).toHaveAttribute("data-etat", "vide");
    await expect(graphe).toContainText("Aucune paire page → service corrélée");
    await expect(graphe.getByTestId("carte-svg")).toHaveCount(0);
    // … et la section qui ne dépend PAS du tracing est toujours là, avec ses routes.
    const pages = page.locator("#pages-visitees");
    await expect(pages).toBeVisible();
    await expect(pages).toContainText("/panier");
    await expect(pages).toContainText("/compte");
  });

  test("le nœud « Autres routes (2) » reçoit les liens des routes masquées", async ({ page }) => {
    await login(page);
    await page.goto(urlCarte(APP_F52), { waitUntil: "domcontentloaded" });
    const graphe = page.locator("#carte-graphe");
    await expect(graphe).toContainText("Autres routes (2)");
    await expect(page.getByTestId("carte-autres")).toContainText("2 route(s) moins actives regroupées");
    // 12 routes back → 10 détaillées + l'agrégat ; 1 route front. Le graphe des
    // largeurs ≥ sm est le seul compté (le repli à 390 px porte le sien).
    const svg = page.getByTestId("carte-graphe-svg");
    await expect(svg.getByTestId("carte-noeud")).toHaveCount(12);
    await expect(svg.locator('[data-agrege="1"]')).toHaveCount(1);
  });

  test("la santé est ÉCRITE dans le nœud, pas seulement teintée", async ({ page }) => {
    await login(page);
    await page.goto(urlCarte(APP_F52), { waitUntil: "domcontentloaded" });
    // « 0,0 % err · p75 260 ms » : le texte porte l'information, la couleur la double.
    await expect(page.locator("#carte-graphe")).toContainText(/err · p75/);
    await expect(page.getByTestId("regle-sante")).toContainText("inconnu sans latence mesurée");
  });

  test("un nœud ouvre son panneau, avec ses chiffres et sa série (B37)", async ({ page }) => {
    await login(page);
    await page.goto(urlCarte(APP_F52, "&panel=noeud%3Aback%3A%2Fapi%2Fr12"), { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toBeVisible();
    await expect(panneau).toHaveAttribute("data-type", "noeud");
    await expect(panneau).toContainText("/api/r12");
    await expect(panneau.getByTestId("detail-panel-puces")).toContainText("Appels");
    // La série existe (B37 livré) : un graphique recharts, pas un « à créer ».
    await expect(panneau.locator(".recharts-wrapper")).toHaveCount(1);
    await expect(panneau).not.toContainText("série à créer");
    await expect(panneau.getByRole("link", { name: "Traces lentes de ce service" })).toBeVisible();
    // Fermer retire le paramètre, sans quitter l'écran.
    await panneau.getByTestId("detail-panel-fermer").click();
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("panel")).toBeNull();
  });

  test("une route sans LCP n'affiche aucun verdict, jamais une pastille « Bon »", async ({ page }) => {
    await login(page);
    await page.goto(urlCarte(APP_F52), { waitUntil: "domcontentloaded" });
    const ligne = page.locator("#pages-visitees tbody tr", { hasText: "/compte" });
    await expect(ligne).toContainText("—");
    for (const verdict of ["Bon", "À améliorer", "Mauvais"]) {
      await expect(ligne, verdict).not.toContainText(verdict);
    }
    await expect(page.locator("#pages-visitees tbody tr", { hasText: "/panier" })).toContainText("Bon");
  });

  test("390 px : la table des liens remplace le graphe", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(urlCarte(APP_F52), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("carte-liens")).toBeVisible();
    await expect(page.getByTestId("carte-graphe-svg")).not.toBeVisible();
    // La table dit la même chose que le graphe : origine, destination, appels.
    await expect(page.getByTestId("carte-liens")).toContainText("/api/r12");
    await expect(page.getByTestId("carte-liens")).toContainText("/panier");
    // Le graphe reste atteignable, replié : le dépliant le montre, et lui seul.
    const voir = page.getByTestId("carte-liens").getByText("Voir le graphe");
    await expect(voir).toBeVisible();
    await expect(page.getByTestId("carte-liens").getByTestId("carte-svg")).not.toBeVisible();
    await voir.click();
    await expect(page.getByTestId("carte-liens").getByTestId("carte-svg")).toBeVisible();
    expect(await debordements(page), "390 px, graphe déplié").toEqual([]);
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(urlCarte(APP_F52), { waitUntil: "domcontentloaded" });
      await expect(page.locator("#pages-visitees")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
      // Le panneau ouvert est plein écran sous 1280 px : il ne doit pas élargir la page.
      await page.goto(urlCarte(APP_F52, "&panel=noeud%3Aback%3A%2Fapi%2Fr12"), { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("detail-panel")).toBeVisible();
      expect(await debordements(page), `${largeur} px, panneau ouvert`).toEqual([]);
    }
  });
});
