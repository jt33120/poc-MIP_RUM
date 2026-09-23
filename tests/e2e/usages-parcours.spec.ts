// E2E — F50 (plan § 5.13) : l'écran Parcours.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Le retour d'une part calculée sur un top N : les deux cartes de bords
//     divisaient chaque route par la somme des 15 routes AFFICHÉES. La colonne
//     « Part de toutes les sessions » reste vide et motivée tant que B31 n'a pas
//     livré le dénominateur ; aucun pourcentage n'apparaît dans les deux tables.
//   - Un ruban qui ne mène nulle part : cliquer un ruban ouvre les sessions
//     passées par la route d'arrivée (`/sessions?qf=route&q=…`).
//   - Une épaisseur sans nombre : chaque nœud porte son total.
//   - Deux conventions de pourcentage anonymes dans l'entonnoir : les deux taux
//     sont nommés, et la marche la plus perdante est désignée.
//   - Un geste inerte : l'ancrage (B31) et les étapes typées (B33) sont annoncés
//     absents.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, et un compte admin
// dédié à ce fichier (jamais le compte de seed-admin).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_F50 = "f50-parcours-e2e";
const E2E_EMAIL = "e2e-f50-parcours@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const BASE = `${consoleUrl}/paths?app=${APP_F50}&period=24h`;
const ETAPES = "s1=f50_vue&s2=f50_panier&s3=f50_achat";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

// Dix sessions : toutes « / » → « /f50-panier » ; quatre poussent jusqu'à
// « /f50-paiement ». Transitions : 10 et 4. Entrées : « / » ×10. Sorties :
// « /f50-panier » ×6, « /f50-paiement » ×4.
// Entonnoir : f50_vue ×10, f50_panier ×4, f50_achat ×1 — la plus forte perte est
// la marche 2 (−6), pas la marche 3 (−3).
async function nettoyerF50() {
  for (const t of ["rum_event", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_F50]);
}

async function semerF50() {
  await nettoyerF50();
  await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [APP_F50]);
  // Une instruction par table (generate_series), jamais ligne à ligne.
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     select $1 || '-s' || i, $1, $1 || '-v' || i, 'desktop', false,
            now() - interval '2 hours', now() - interval '110 minutes', 2
     from generate_series(0, 9) i`,
    [APP_F50],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
     select $1 || '-s' || i || '-pv' || v.n, $1 || '-s' || i, $1, v.route,
            'https://site-f50.example' || v.route,
            now() - interval '2 hours' + (v.n * interval '1 minute')
     from generate_series(0, 9) i
     cross join (values (0, '/'), (1, '/f50-panier')) as v(n, route)`,
    [APP_F50],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
     select $1 || '-s' || i || '-pv2', $1 || '-s' || i, $1, '/f50-paiement',
            'https://site-f50.example/f50-paiement', now() - interval '2 hours' + interval '2 minutes'
     from generate_series(0, 3) i`,
    [APP_F50],
  );
  for (const [nom, jusqua, minutes] of [
    ["f50_vue", 9, 0],
    ["f50_panier", 3, 1],
    ["f50_achat", 0, 2],
  ] as const) {
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, context, ts)
       select $1 || '-s' || i || '-' || $2, $1 || '-s' || i, $1, '/f50-panier', $2, '{}'::jsonb, '{}'::jsonb,
              now() - interval '2 hours' + ($4::int * interval '1 minute')
       from generate_series(0, $3::int) i`,
      [APP_F50, nom, jusqua, minutes],
    );
  }
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  await semerF50();
});

test.afterAll(async () => {
  await nettoyerF50();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test.describe("F50 — Parcours", () => {
  test("un ruban ouvre les sessions passées par la route d'arrivée", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    const ruban = page.locator('[data-testid="sankey-ruban"][data-vers="/f50-paiement"]');
    await expect(ruban).toHaveCount(1);
    await ruban.scrollIntoViewIfNeeded();
    await ruban.click();
    await page.waitForURL(/\/sessions\?/, { timeout: 15_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe("/sessions");
    expect(url.searchParams.get("qf")).toBe("route");
    expect(url.searchParams.get("q")).toBe("/f50-paiement");
    expect(url.searchParams.get("app")).toBe(APP_F50);
  });

  test("chaque nœud porte son total ; l'ancrage (B31) est annoncé absent", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    const flux = page.locator("#paths-flux");
    // Le nœud cible « /f50-panier » reçoit les 10 passages ; le nœud source en émet 4.
    await expect(flux).toContainText("/f50-panier · 10");
    await expect(flux).toContainText("/f50-panier · 4");
    await expect(flux).toContainText("/f50-paiement · 4");
    await expect(flux.getByTestId("figure-meta")).toContainText("14 / 14 passages représentés");
    await expect(page.getByTestId("paths-ancrage")).toContainText(
      "ancrage « à partir de » à créer : la lecture des transitions ne filtre pas sur une route de départ (B31)",
    );
    // L'alternative textuelle porte les mêmes lignes que les rubans.
    await expect(flux.getByTestId("alternative")).toContainText("De");
  });

  test("aucune part calculée sur un top N : colonne vide et motivée dans les deux tables", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    for (const id of ["#paths-entrees", "#paths-sorties"]) {
      const table = page.locator(id);
      await expect(table.locator('th[scope="col"]')).toHaveText(["Route", "Sessions", "Part de toutes les sessions"]);
      await expect(table).toContainText(
        "Part de toutes les sessions : non calculée tant que le dénominateur (les sessions avec vue, sur la même fenêtre) n'est pas lu sur le contrat (B31).",
      );
      // Aucun pourcentage nulle part dans la table.
      expect(await table.innerText(), id).not.toMatch(/\d+(,\d+)?\s?%/);
    }
    // Le semis (en tête du fichier) : les dix sessions COMMENCENT par « / » — c'est
    // l'unique page d'entrée ; « /f50-panier » n'est la première route d'aucune. Elles
    // finissent sur « /f50-panier » (6) ou « /f50-paiement » (4).
    const entrees = page.locator("#paths-entrees tbody tr");
    await expect(entrees).toHaveCount(1);
    await expect(entrees.getByRole("link", { name: "/", exact: true })).toBeVisible();
    await expect(entrees.getByRole("cell").first()).toHaveText("10");
    await expect(page.locator("#paths-sorties tbody tr")).toHaveCount(2);
    await expect(page.locator("#paths-sorties")).toContainText("/f50-paiement");
    // Les tuiles disent la route et son compte, sans part.
    const tuiles = page.getByTestId("kpi-libelle");
    await expect(tuiles.filter({ hasText: "Page d'entrée n°1" })).toContainText("/ · 10 sessions y démarrent");
    await expect(tuiles.filter({ hasText: "Page de sortie n°1" })).toContainText(
      "part de l'ensemble non calculée (dénominateur à créer)",
    );
    // La carte « Transitions les plus fréquentes » a disparu (doublon du flux).
    await expect(page.locator("body")).not.toContainText("Transitions les plus fréquentes");
  });

  test("entonnoir : deux taux nommés, plus forte perte encadrée, options annotées", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}&${ETAPES}`, { waitUntil: "domcontentloaded" });
    const entonnoir = page.locator("#paths-entonnoir");
    await expect(entonnoir).toContainText("f50_vue (10 sessions)");
    await expect(entonnoir).toContainText(
      "étapes de type vue ou action à créer : seuls les événements custom sont proposés comme étapes (B33)",
    );
    const etapes = entonnoir.getByTestId("funnel-etape");
    await expect(etapes).toHaveCount(3);
    // Marche 2 : 4 sessions sur 10, −6 — la plus forte perte.
    await expect(etapes.nth(1)).toContainText(/40,0\s%\s*de l'étape précédente/);
    await expect(etapes.nth(1)).toContainText(/40,0\s%\s*du départ/);
    await expect(etapes.nth(1)).toContainText("−6 sessions");
    await expect(etapes.nth(1)).toHaveAttribute("data-pire", "1");
    // Marche 3 : 1 sur 4 depuis la précédente, 1 sur 10 depuis le départ.
    await expect(etapes.nth(2)).toContainText(/25,0\s%\s*de l'étape précédente/);
    await expect(etapes.nth(2)).toContainText(/10,0\s%\s*du départ/);
    await expect(etapes.nth(2)).not.toHaveAttribute("data-pire", "1");
    await expect(etapes.nth(0)).not.toContainText("de l'étape précédente");
    // « Voir au Journal » porte le nom de l'étape.
    await expect(etapes.nth(2).getByRole("link", { name: "Voir au Journal" })).toHaveAttribute(
      "href",
      /\/events\?.*name=f50_achat/,
    );
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${BASE}&${ETAPES}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#paths-flux")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});
