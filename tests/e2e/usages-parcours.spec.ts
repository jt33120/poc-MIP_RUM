// E2E — F50 (plan § 5.13) : l'écran Parcours.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Le retour d'une part calculée sur un top N : les deux cartes de bords
//     divisaient chaque route par la somme des 15 routes AFFICHÉES. Depuis F53
//     (B31), la part se lit sur les sessions avec vue de la même plage
//     (`sessionsAvecVue`) — 10 ici, quel que soit le nombre de routes affichées.
//   - Un ruban qui ne mène nulle part : cliquer un ruban ouvre les sessions
//     passées par la route d'arrivée (`/sessions?qf=route&q=…`).
//   - Une épaisseur sans nombre : chaque nœud porte son total.
//   - Deux conventions de pourcentage anonymes dans l'entonnoir : les deux taux
//     sont nommés, et la marche la plus perdante est désignée.
//   - Un ancrage qui changerait les chiffres : `depuis` ne restreint que le dessin
//     du flux ; les étapes typées (B33) restent annoncées absentes.
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

  test("chaque nœud porte son total ; un nœud de gauche propose l'ancrage (B31)", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    const flux = page.locator("#paths-flux");
    // Le nœud cible « /f50-panier » reçoit les 10 passages ; le nœud source en émet 4.
    await expect(flux).toContainText("/f50-panier · 10");
    await expect(flux).toContainText("/f50-panier · 4");
    await expect(flux).toContainText("/f50-paiement · 4");
    await expect(flux.getByTestId("figure-meta")).toContainText("14 / 14 passages représentés");
    // Le nœud SOURCE « /f50-panier » (4 passages sortants) ancre le flux à partir de lui.
    await expect(flux.locator('[data-testid="sankey-noeud"]').filter({ hasText: "/f50-panier · 4" })).toHaveAttribute(
      "href",
      /depuis=%2Ff50-panier/,
    );
    await expect(page.locator("body")).not.toContainText("ancrage « à partir de » à créer");
    // L'alternative textuelle porte les mêmes lignes que les rubans.
    await expect(flux.getByTestId("alternative")).toContainText("De");
  });

  test("ancrage « à partir de » : le flux ne dessine que les départs de la route, les tuiles ne changent pas", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    const ancrage = page.getByTestId("paths-ancrage");
    await expect(ancrage).toContainText("À partir de :");
    await ancrage.getByRole("link", { name: "/f50-panier", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("depuis") === "/f50-panier", { timeout: 15_000 });
    await expect(page.getByTestId("sankey-ancre")).toContainText("Flux à partir de /f50-panier");
    const rubans = page.locator('#paths-flux [data-testid="sankey-ruban"]');
    await expect(rubans).toHaveCount(1);
    await expect(rubans.first()).toHaveAttribute("data-vers", "/f50-paiement");
    // Réglage d'écran : les tuiles et les tables portent toujours sur toutes les routes.
    await expect(page.getByTestId("kpi-tile").filter({ hasText: "Transitions distinctes" }).getByTestId("kpi-valeur")).toHaveText("2");
    await expect(page.locator("#paths-sorties tbody tr")).toHaveCount(2);
    // « Toutes les routes » retire l'ancrage.
    await page.getByTestId("paths-ancrage-toutes").click();
    await page.waitForURL((u) => !u.searchParams.has("depuis"), { timeout: 15_000 });
    await expect(page.locator('#paths-flux [data-testid="sankey-ruban"]')).toHaveCount(2);
  });

  test("parts sur les sessions avec vue (B31) : jamais sur la somme des routes affichées", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}`, { waitUntil: "domcontentloaded" });
    for (const id of ["#paths-entrees", "#paths-sorties"]) {
      await expect(page.locator(id).locator('th[scope="col"]')).toHaveText([
        "Route",
        "Sessions",
        "Part de toutes les sessions",
        "Sessions à une vue",
        "LCP p75 de la route",
      ]);
    }
    // Le semis (en tête du fichier) : les dix sessions COMMENCENT par « / » — c'est
    // l'unique page d'entrée ; « /f50-panier » n'est la première route d'aucune. Elles
    // finissent sur « /f50-panier » (6) ou « /f50-paiement » (4). Chacune a au moins
    // deux vues (aucune « à une vue »), et aucune mesure LCP n'est semée (« — »).
    const entrees = page.locator("#paths-entrees tbody tr");
    await expect(entrees).toHaveCount(1);
    await expect(entrees.getByRole("link", { name: "/", exact: true })).toBeVisible();
    await expect(entrees.first().getByRole("cell")).toHaveText(["10", /100,0\s%/, "0", "—"]);
    const sorties = page.locator("#paths-sorties tbody tr");
    await expect(sorties).toHaveCount(2);
    await expect(sorties.filter({ hasText: "/f50-panier" }).getByRole("cell")).toHaveText(["6", /60,0\s%/, "0", "—"]);
    await expect(sorties.filter({ hasText: "/f50-paiement" }).getByRole("cell")).toHaveText(["4", /40,0\s%/, "0", "—"]);
    // Les tuiles disent la route, son compte et sa part de TOUTES les sessions avec vue.
    const tuiles = page.getByTestId("kpi-libelle");
    await expect(tuiles.filter({ hasText: "Page d'entrée n°1" })).toContainText("/ · 10 sessions sur 10");
    await expect(tuiles.filter({ hasText: "Page d'entrée n°1" })).toContainText(/100,0\s% des sessions avec vue y démarrent/);
    await expect(tuiles.filter({ hasText: "Page de sortie n°1" })).toContainText("/f50-panier · 6 sessions sur 10");
    await expect(page.locator("body")).not.toContainText("dénominateur à créer");
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
