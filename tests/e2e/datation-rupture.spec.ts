// E2E — P*.7 : « depuis quand ? », datation d'une rupture (plan § 7.2, critère de recette).
//
// Deux applications dédiées, deux réponses opposées, toutes deux écrites :
//   · `ps7-rupture-e2e` : une MARCHE injectée (sept jours à 1,8 s, sept à 2,9 s) —
//     l'annotation « Rupture » tombe sur le bon jour, la phrase cite le test, le p
//     et le nombre de jours valides, et le déploiement du même jour est cité comme
//     une coïncidence de date, jamais comme une explication (RM5) ;
//   · `ps7-plate-e2e` : six jours mesurés seulement — le refus est CHIFFRÉ
//     (« datation non tentée : 6 jours valides, 10 requis »), pas une absence muette.
//
// La fenêtre de la datation est FIXE (14 jours complets, fuseau de l'app, journée en
// cours exclue) : les deux apps portent explicitement `Europe/Paris` et sèment à midi
// local, pour que le découpage des journées ne dépende pas de l'heure du test.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, et un compte admin dédié à ce fichier
// (jamais `scripts/seed-admin.mjs`).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const APP_RUPTURE = "ps7-rupture-e2e";
const APP_PLATE = "ps7-plate-e2e";
const E2E_EMAIL = "e2e-datation-rupture@mip-rum.local";
const TZ = "Europe/Paris";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

/** Midi LOCAL du jour J−`i` : un instant toujours au milieu de sa journée, sans bord. */
const midiLocal = (i: number) =>
  `((date_trunc('day', now() at time zone '${TZ}') - interval '${i} days' + interval '12 hours') at time zone '${TZ}')`;

/**
 * Sème `mesures` mesures LCP par jour sur les jours J−14 à J−1, en UNE instruction
 * par jour (`generate_series`) : `valeur(i)` donne la valeur du jour J−i.
 */
async function semerJours(app: string, jours: readonly number[], mesures: number, valeur: (i: number) => number) {
  for (const t of ["rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [app]);
  await pool.query(`delete from deploy_marker where app_id = $1`, [app]);
  await pool.query(
    `insert into app_registry (app_id, name, timezone) values ($1, $2, $3)
     on conflict (app_id) do update set timezone = excluded.timezone`,
    [app, `P*.7 ${app}`, TZ],
  );
  for (const i of jours) {
    const quand = midiLocal(i);
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       select $1 || '-' || g, $2, $1 || '-' || g, 'desktop', false, ${quand}, ${quand} + interval '1 minute', 1
       from generate_series(1, $3) g
       on conflict (session_id) do nothing`,
      [`${app}-j${i}`, app, mesures],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
       select $1 || '-' || g || '-pv', $1 || '-' || g, $2, '/', ${quand}
       from generate_series(1, $3) g
       on conflict (span_id) do nothing`,
      [`${app}-j${i}`, app, mesures],
    );
    // Une valeur constante par jour : la p75 du jour vaut exactement cette valeur.
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
       select $1 || '-' || g || '-m', $1 || '-' || g, $2, '/', 'LCP', $4, ${quand}
       from generate_series(1, $3) g
       on conflict (span_id) do nothing`,
      [`${app}-j${i}`, app, mesures, valeur(i)],
    );
  }
}

/** Les 14 jours complets de la fenêtre : J−14 (le plus ancien) à J−1. */
const FENETRE = Array.from({ length: 14 }, (_v, k) => 14 - k);

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  // Marche : J−14..J−8 à 1 800 ms, J−7..J−1 à 2 900 ms. La rupture est donc J−7,
  // premier jour du nouveau niveau ; 40 mesures par jour (au-dessus des 13 requis).
  await semerJours(APP_RUPTURE, FENETRE, 40, (i) => (i >= 8 ? 1800 : 2900));
  // Un déploiement le jour de la rupture, à midi local : la coïncidence de date.
  await pool.query(
    `insert into deploy_marker (app_id, version, env, source, ts) values ($1, '1.4.2', 'prod', 'e2e', ${midiLocal(7)})`,
    [APP_RUPTURE],
  );
  // Six jours mesurés seulement : sous les dix jours valides requis.
  await semerJours(APP_PLATE, [6, 5, 4, 3, 2, 1], 40, () => 2000);
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

test("/forecast : la marche est datée au bon jour, avec son test, son p et ses jours valides", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/forecast?app=${APP_RUPTURE}`, { waitUntil: "domcontentloaded" });

  const datation = page.getByTestId("datation-rupture");
  await expect(datation).toContainText("a changé de niveau autour du");
  // L'invariant : ce sont des médianes de p75 QUOTIDIENNES, jamais une p75 de période.
  await expect(datation).toContainText("médiane des p75 quotidiennes");
  await expect(datation).toContainText(/test de Pettitt, p = 0,0\d+, 14 jours valides/);
  // La règle est écrite à côté du résultat (RM4).
  await expect(datation).toContainText("test de Pettitt");
  await expect(datation).toContainText("13 mesures");

  // Le jour daté est J−7, premier jour du nouveau niveau : la date affichée par la
  // phrase est celle-là, calculée ici dans le fuseau de l'app.
  const jour = await page.evaluate(
    (tz) => {
      const d = new Date(Date.now() - 7 * 86_400_000);
      return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(d);
    },
    TZ,
  );
  await expect(datation).toContainText(`autour du ${jour}`);

  // L'annotation verticale : un lien accessible sous la figure, et le clic ouvre ce jour.
  const legende = page.locator("#tendance-lcp").getByTestId("legende-annotations");
  await expect(legende).toContainText("Rupture à la hausse");
  const lien = legende.getByRole("link", { name: /Rupture à la hausse/ });
  await expect(lien).toHaveAttribute("href", /from=.*&.*to=/);
});

test("/forecast : un déploiement le même jour est une coïncidence de date, jamais une explication", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/forecast?app=${APP_RUPTURE}`, { waitUntil: "domcontentloaded" });

  const datation = page.getByTestId("datation-rupture");
  await expect(datation).toContainText("Un déploiement (1.4.2) a eu lieu le");
  await expect(datation).toContainText("coïncidence de date");
  await expect(datation).toContainText("pas une cause établie");
  // RM5 : aucune formulation qui attribue la rupture au déploiement.
  await expect(datation).not.toContainText(/à cause|responsable|a causé/i);
});

test("/forecast : six jours mesurés, le refus est chiffré et aucune date n'est inventée", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/forecast?app=${APP_PLATE}`, { waitUntil: "domcontentloaded" });

  const datation = page.getByTestId("datation-rupture");
  await expect(datation).toContainText("datation non tentée : 6 jours valides, 10 requis");
  await expect(datation).not.toContainText("a changé de niveau");
  // Aucune annotation posée : la légende n'existe même pas (elle ne s'affiche que
  // s'il y a une annotation ou une raison d'absence).
  await expect(page.locator("#tendance-lcp").getByTestId("legende-annotations")).toHaveCount(0);
});

test("/ : le hero répond à « depuis quand ? » et dit SA fenêtre, qui n'est pas la plage choisie", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP_RUPTURE}&period=24h`, { waitUntil: "domcontentloaded" });

  const datation = page.getByTestId("hero-cwv").getByTestId("datation-rupture");
  await expect(datation).toContainText("a changé de niveau autour du");
  await expect(datation).toContainText("Fenêtre de cette datation : 14 jours complets");
  await expect(datation).toContainText("la plage choisie en haut ne s'y applique pas");
  await expect(datation).toContainText("test de Pettitt");
});

test("aucun débordement à 390, 768 et 1440 px sur les deux écrans", async ({ page }) => {
  await login(page);
  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 900 });
    for (const url of [`/?app=${APP_RUPTURE}&period=24h`, `/forecast?app=${APP_RUPTURE}`]) {
      await page.goto(`${consoleUrl}${url}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("datation-rupture").first()).toBeVisible();
      expect(await debordements(page), `${url} à ${largeur} px`).toEqual([]);
    }
  }
});
