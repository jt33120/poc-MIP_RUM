// E2E — F48 (plan § 5.16) : l'écran Acquisition.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Le retour de l'anneau, qui cachait les canaux à 0 : les CINQ canaux sont
//     rendus en barres, zéros compris, chacun avec sa part de toutes les sessions.
//   - Une fenêtre tue : depuis F53 (B31), la lecture est celle du contrat et la
//     méta de chaque figure écrit la plage lue ; la note « lecture non migrée » a
//     disparu.
//   - Un plafond muet : 20 001 sessions lues → bandeau « plafond de 20 000 sessions
//     atteint » (S4) ; aucune trace de ce bandeau sous le plafond.
//   - Une table croisée qui compterait autre chose que les canaux : la route
//     d'entrée se croise avec les MÊMES sessions que le hero (B31).
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées, et un compte admin
// dédié à ce fichier (jamais le compte de seed-admin).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_F48 = "f48-acquisition-e2e";
const APP_F48_PLAFOND = "f48-acquisition-plafond-e2e";
const APPS_F48 = [APP_F48, APP_F48_PLAFOND];
const E2E_EMAIL = "e2e-f48-acquisition@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

// Sept sessions : 3 directes, 2 depuis un moteur, 1 depuis un site référent, 1 interne,
// AUCUNE depuis un réseau social (le zéro que l'anneau cachait).
const ENTREES: (string | null)[] = [
  null,
  null,
  null,
  "https://www.google.com/search",
  "https://www.google.com/search",
  "https://ref-f48.example/lien",
  "https://site-f48.example/autre",
];

async function nettoyerF48() {
  for (const t of ["rum_pageview", "rum_session"]) await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS_F48]);
}

async function semerF48() {
  await nettoyerF48();
  for (const app of APPS_F48) {
    await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
  }
  for (const [i, referrer] of ENTREES.entries()) {
    const sid = `${APP_F48}-s${i}`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '2 hours', now() - interval '90 minutes', 1)`,
      [sid, APP_F48],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
       values ($1, $2, $3, '/f48-entree', 'https://site-f48.example/entree', $4, now() - interval '2 hours')`,
      [`${sid}-pv`, sid, APP_F48, referrer],
    );
  }
  // Plafond : 20 001 sessions, dont les 25 PREMIÈRES par identifiant arrivent de 25
  // hôtes distincts (elles sont donc toutes lues) ; les autres sont directes.
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     select $1 || '-s' || lpad(i::text, 5, '0'), $1, $1 || '-v' || i, 'desktop', false,
            now() - interval '2 hours', now() - interval '90 minutes', 1
     from generate_series(0, 20000) i`,
    [APP_F48_PLAFOND],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
     select $1 || '-s' || lpad(i::text, 5, '0') || '-pv', $1 || '-s' || lpad(i::text, 5, '0'), $1, '/f48-entree',
            'https://site-f48.example/entree',
            case when i < 25 then 'https://ref' || i || '-f48.example/lien' end,
            now() - interval '2 hours'
     from generate_series(0, 20000) i`,
    [APP_F48_PLAFOND],
  );
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  await semerF48();
});

test.afterAll(async () => {
  await nettoyerF48();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test.describe("F48 — Acquisition", () => {
  test("cinq canaux en barres, zéros compris, parts sur toutes les sessions ; aucun anneau", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/acquisition?app=${APP_F48}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    const hero = page.locator("#acquisition-canaux");
    for (const canal of ["Direct ou référent masqué", "Recherche", "Réseaux sociaux", "Site référent", "Interne"]) {
      await expect(hero, canal).toContainText(canal);
    }
    // Le zéro est rendu, avec une part de 0 % calculée sur 7 sessions (pas masqué).
    // Le `title` de la LIGNE commence par « <canal> : » (celui du segment coloré n'a pas de « : »).
    await expect(hero.locator('[title^="Réseaux sociaux :"]')).toContainText(/0 · 0,0\s%/);
    await expect(hero.locator('[title^="Recherche :"]')).toContainText(/2 · 28,6\s%/);
    // Aucun anneau : les barres sont des blocs, la figure ne contient aucun SVG.
    await expect(hero.locator("svg")).toHaveCount(0);
    // Tuiles : sessions lues, part hors direct (3 / 7), référents distincts.
    const tuiles = page.getByTestId("kpi-tile");
    await expect(tuiles.filter({ hasText: "Sessions lues" }).getByTestId("kpi-valeur")).toHaveText("7");
    await expect(tuiles.filter({ hasText: "Part hors direct" })).toContainText(/42,9\s%/);
    await expect(tuiles.filter({ hasText: "Référents externes distincts" }).getByTestId("kpi-valeur")).toHaveText("2");
    // Sous le plafond : aucun bandeau de plafond.
    await expect(page.getByTestId("acquisition-plafond")).toHaveCount(0);
    // Référents : l'hôte est là, avec son canal.
    await expect(page.locator("#acquisition-referents")).toContainText("ref-f48.example");
  });

  test("sur le contrat (F53) : la méta écrit la plage lue ; table croisée et série dessinées (B31)", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/acquisition?app=${APP_F48}&period=7d`, { waitUntil: "domcontentloaded" });
    // Plus de note « lecture non migrée » : la lecture est celle du contrat.
    await expect(page.getByTestId("lecture-non-migree")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("lecture non migrée");
    const metas = page.getByTestId("figure-meta");
    await expect(metas).toHaveCount(4);
    for (const meta of await metas.all()) await expect(meta).toContainText("7 j");
    // A4 : la route d'entrée, croisée par canal (au-delà de 640 px, la table) —
    // 3 directes, 2 recherche, 0 réseau social, 1 site référent, 1 interne ; total 7.
    const ligne = page.getByTestId("acquisition-entrees-table").getByTestId("acquisition-entree").filter({ hasText: "/f48-entree" });
    await expect(ligne).toHaveCount(1);
    await expect(ligne.getByRole("cell")).toHaveText(["3", "2", "0", "1", "1", "7"]);
    await expect(ligne.getByRole("link", { name: "Sessions passées par cette route" })).toHaveAttribute(
      "href",
      /\/sessions\?.*qf=route&q=%2Ff48-entree/,
    );
    await expect(page.locator("#acquisition-entrees")).not.toContainText("à créer");
    // A6 : la série, sur la grille du contrat (un graphique recharts).
    const serie = page.locator("#acquisition-serie");
    await serie.scrollIntoViewIfNeeded();
    await expect(serie).not.toContainText("série à créer");
    await expect(serie.locator(".recharts-wrapper")).toHaveCount(1);
    const direct = page.getByTestId("acquisition-direct");
    await expect(direct).toContainText(
      "pas de référent reçu : saisie de l'adresse, favori, application, ou site d'origine qui retire son adresse (politique Referrer-Policy)",
    );
    await expect(direct).toContainText("paramètres de campagne (UTM) non captés : l'URL est nettoyée par le SDK");
  });

  test("plafond de 20 000 sessions atteint : bandeau partiel, référents « ≥ 20 »", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/acquisition?app=${APP_F48_PLAFOND}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("acquisition-plafond")).toContainText(
      "plafond de 20 000 sessions atteint : les canaux portent sur les 20 000 premières sessions par identifiant, pas les plus récentes",
    );
    await expect(page.getByTestId("kpi-libelle").filter({ hasText: "Référents externes distincts" })).toContainText("≥ 20");
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/acquisition?app=${APP_F48}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#acquisition-canaux")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});
