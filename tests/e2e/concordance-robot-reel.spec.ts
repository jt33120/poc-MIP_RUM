// E2E — P*.8 : la concordance robot ↔ réel de /correlation, mesurée et refusée.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un coefficient s'affiche sans son intervalle, ou qu'une route sans assez
//     de jours reste une case vide (qui se lirait « aucun lien »).
//   - Que la mention « ρ mesure si les deux montent et descendent ensemble, pas si
//     leurs valeurs sont égales » disparaisse : sans elle, un ρ de 0,95 se lit
//     « le robot et le réel mesurent la même chose », ce qui est faux.
//   - Qu'une colonne de plus fasse déborder la table à 390 px.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, sur douze jours passés,
// avec un compte DÉDIÉ à ce fichier (jamais scripts/seed-admin.mjs).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_P8 = "pstar8-e2e-app";
const EMAIL_P8 = "e2e-concordance@mip-rum.local";
const ROUTE_LONGUE = "/panier";
const ROUTE_COURTE = "/court";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

const JOUR_MS = 86_400_000;
/** Minuit UTC d'aujourd'hui : le seau du grain « jour » est aligné là. */
const FIN_P8 = new Date(Math.floor(Date.now() / JOUR_MS) * JOUR_MS);
const DEBUT_P8 = new Date(FIN_P8.getTime() - 14 * JOUR_MS);
const jourP8 = (i: number) => new Date(DEBUT_P8.getTime() + i * JOUR_MS);

// Douze jours qui montent presque ensemble : ρ ≈ 0,95, borne basse ≈ 0,82 > 0,30.
const ROBOT_P8 = [800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350];
const REEL_P8 = [2000, 2100, 1900, 2300, 2200, 2500, 2400, 2700, 2600, 3000, 2900, 3100];

let motDePasseP8 = "";

async function semerP8() {
  for (const t of ["rum_metric", "syn_snapshot", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = $1`, [APP_P8]);
  }
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Concordance E2E') on conflict (app_id) do nothing`,
    [APP_P8],
  );
  const sid = `${APP_P8}-s`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $1, 'desktop', false, $3, $4, 12)
     on conflict (session_id) do nothing`,
    [sid, APP_P8, DEBUT_P8, FIN_P8],
  );

  const semerJour = async (route: string, i: number, latence: number, lcp: number) => {
    await pool.query(
      `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
       values ($1, 'recette P*.8', 'Parcours', 'Parcours', $2, 90, 'ok', $3, $4)`,
      [APP_P8, route, latence, new Date(jourP8(i).getTime() + 10 * 3_600_000)],
    );
    // 20 mesures LCP identiques : la p75 du jour vaut `lcp`, au-dessus des 13
    // mesures qu'un jour commun demande.
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
       select $1 || '-' || g, $2, $3, $4, 'LCP', $5, $6::timestamptz + make_interval(secs => g)
         from generate_series(1, 20) g`,
      [`${APP_P8}-${route}-${i}`.replace(/\//g, "_"), sid, APP_P8, route, lcp, new Date(jourP8(i).getTime() + 12 * 3_600_000)],
    );
  };

  for (let i = 0; i < 12; i++) await semerJour(ROUTE_LONGUE, i, ROBOT_P8[i], REEL_P8[i]);
  // Trois jours seulement : sous les dix jours communs, la concordance refuse.
  for (let i = 0; i < 3; i++) await semerJour(ROUTE_COURTE, i, ROBOT_P8[i], REEL_P8[i]);
}

test.beforeAll(async () => {
  motDePasseP8 = await compteDedie(pool, EMAIL_P8);
  await semerP8();
});

test.afterAll(async () => {
  await pool.end();
});

async function loginP8(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', EMAIL_P8);
  await page.fill('input[name="password"]', motDePasseP8);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** L'écran, sur la plage semée, hero ouvert sur la route aux douze jours. */
function ecranP8(extra = ""): string {
  const serie = encodeURIComponent(`${encodeURIComponent(APP_P8)}:${encodeURIComponent(ROUTE_LONGUE)}`);
  return (
    `${consoleUrl}/correlation?app=${APP_P8}` +
    `&from=${encodeURIComponent(DEBUT_P8.toISOString())}&to=${encodeURIComponent(FIN_P8.toISOString())}` +
    `&serie=${serie}${extra}`
  );
}

const ligneRoute = (page: Page, route: string) =>
  page.getByTestId("table-routes").locator('tr[data-testid="ligne-route"]', { hasText: route });

test("le hero dit la concordance en toutes lettres, avec ρ, son intervalle et la mention", async ({ page }) => {
  await loginP8(page);
  await page.goto(ecranP8(), { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).not.toContainText("Application error");
  const phrase = page.getByTestId("concordance-hero");
  await expect(phrase).toContainText("Sur 12 jours communs");
  await expect(phrase).toContainText("le robot et le réel évoluent ensemble");
  await expect(phrase).toContainText("ρ de Spearman = 0,95");
  await expect(phrase).toContainText("entre 0,82 et 0,99");
  // La phrase qui empêche de lire ρ comme un écart de valeurs (critère de recette).
  await expect(phrase).toContainText("pas si leurs valeurs sont égales");
  // Le seuil est un CHOIX, dit comme tel.
  await expect(phrase).toContainText("0,30 est un choix de produit");
});

test("la table des routes porte un ρ par route, ou un refus chiffré", async ({ page }) => {
  await loginP8(page);
  await page.goto(ecranP8(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("table-routes")).toContainText("Concordance robot ↔ réel");

  const longue = ligneRoute(page, ROUTE_LONGUE).getByTestId("concordance-route");
  await expect(longue).toHaveAttribute("data-issue", "suit");
  await expect(longue).toContainText("ρ 0,95 (0,82 à 0,99)");
  await expect(longue).toContainText("12 jours communs");

  const courte = ligneRoute(page, ROUTE_COURTE).getByTestId("concordance-route");
  await expect(courte).toHaveAttribute("data-issue", "non-calculee");
  await expect(courte).toContainText("Concordance non calculée : 3 jours communs, 10 requis");

  // Aucune cellule vide : chaque route dit son ρ ou ce qui lui manque.
  const cellules = page.getByTestId("table-routes").getByTestId("concordance-route");
  const nombre = await cellules.count();
  expect(nombre).toBeGreaterThan(0);
  for (let i = 0; i < nombre; i++) {
    await expect(cellules.nth(i)).not.toHaveText(/^\s*$/);
  }
});

test("aucun écart entre robot et réel n'est affiché, nulle part", async ({ page }) => {
  await loginP8(page);
  await page.goto(ecranP8(), { waitUntil: "domcontentloaded" });
  // P*.8 ajoute un coefficient de RANG, pas une soustraction : la table des routes
  // reste sans colonne d'écart (décision de F58, § 5.7.5).
  await expect(page.getByTestId("table-routes")).not.toContainText("écart");
});

test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
  await loginP8(page);
  const fautes: string[] = [];
  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(ecranP8(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("table-routes")).toBeVisible();
    for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
  }
  expect(fautes).toEqual([]);
});
