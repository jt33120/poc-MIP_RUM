// E2E — écran /sessions (domaine Usages, règle S8).
//
// F41 — KPI, volume, répartition. CE QUE CE SPEC EXISTE POUR PROUVER :
//   - la rangée de cinq tuiles, une population chacune : « Sessions commencées » au
//     nombre semé, visiteurs « identifiant aléatoire », et « Sessions avec
//     frustration » SANS nombre tant que sa lecture (B30) manque ;
//   - un clic sur un seau du volume resserre l'écran sur sa plage (`from`/`to`,
//     plus de `period`) ;
//   - le groupe « Inconnu » de « Qui sont ces sessions » filtre par `is_null` ;
//   - `cmp=prev` sur une app sans historique : la tuile se tait et dit pourquoi ;
//   - plus d'`ObservedTrend` : le volume est deux graphiques sur grille ;
//   - aucun débordement à 390, 768 et 1440 px, et KPI + hero au-dessus du pli.
//
// Données SYNTHÉTIQUES dans une app dédiée ; compte dédié (helpers/compte-dedie.ts).
// F42 et F43 ajouteront leurs blocs `test.describe` à ce fichier.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F41 — Sessions : KPI, volume, répartition", () => {
  const APP_F41 = "f41-e2e-sessions";
  const EMAIL_F41 = "e2e-f41-sessions@mip-rum.local";
  let motDePasse = "";

  /** Six sessions sur les dernières heures : navigateurs connus et inconnus, un capteur extension, deux sans identifiant. */
  const SESSIONS = [
    { id: "f41e2e-s0", heures: 1, navigateur: "Firefox", visiteur: "f41e2e-v0", capteur: "sdk" },
    { id: "f41e2e-s1", heures: 3, navigateur: "Firefox", visiteur: "f41e2e-v1", capteur: "sdk" },
    { id: "f41e2e-s2", heures: 5, navigateur: "Chrome", visiteur: "f41e2e-v1", capteur: "extension" },
    { id: "f41e2e-s3", heures: 7, navigateur: null, visiteur: null, capteur: "sdk" },
    { id: "f41e2e-s4", heures: 9, navigateur: null, visiteur: "f41e2e-v4", capteur: "sdk" },
    { id: "f41e2e-s5", heures: 11, navigateur: "Chrome", visiteur: null, capteur: "sdk" },
  ];

  async function menage() {
    for (const t of ["rum_error", "rum_pageview", "rum_event"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F41]).catch(() => {});
    await pool.query("delete from rum_session where app_id = $1", [APP_F41]);
  }

  async function semer() {
    await pool.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Sessions F41 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F41],
    );
    await menage();
    for (const s of SESSIONS) {
      await pool.query(
        `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count,
                                  visitor_id, browser, collection_source)
         values ($1, $2, 'desktop', now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '4 minutes',
                 1, $4, $5, $6)`,
        [s.id, APP_F41, s.heures, s.visiteur, s.navigateur, s.capteur],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/', now() - make_interval(hours => $4))`,
        [`${s.id}-pv`, s.id, APP_F41, s.heures],
      );
    }
    // Trois occurrences sur une ligne (V1 : sommées), une erreur sans session (exclue, dite).
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
       values ('f41e2e-err0', 'f41e2e-s0', $1, 'error', 'boom', 'TypeError', 'f41e2e-fp', 3, now() - interval '50 minutes'),
              ('f41e2e-err1', null, $1, 'error', 'serveur', 'Error', 'f41e2e-fp2', 2, now() - interval '40 minutes')`,
      [APP_F41],
    );
  }

  async function login(page: Page) {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', EMAIL_F41);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (extra = "") => `${consoleUrl}/sessions?app=${APP_F41}&period=24h${extra}`;
  /**
   * Une tuile par le DÉBUT de son libellé annoncé (`aria-label` = « <libellé> <valeur>, … ») :
   * « sessions commencées » figure aussi dans l'effectif d'une autre tuile.
   */
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-sessions").locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);

  test.beforeAll(async () => {
    motDePasse = await compteDedie(pool, EMAIL_F41);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await pool.end();
  });

  test("rangée de KPI : cinq tuiles, une population chacune, B30 sans nombre", async ({ page }) => {
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toHaveText(/Sessions/);
    await expect(page.getByTestId("kpi-sessions").getByTestId("kpi-tile")).toHaveCount(5);

    await expect(tuile(page, "Sessions commencées").getByTestId("kpi-valeur")).toHaveText("6");
    await expect(tuile(page, "Visiteurs distincts (identifiant aléatoire)")).toBeVisible();
    // s1 et s2 partagent un visiteur ; s3 et s5 n'en ont pas : 3 visiteurs distincts.
    await expect(tuile(page, "Visiteurs distincts (identifiant aléatoire)").getByTestId("kpi-valeur")).toHaveText("3");
    await expect(tuile(page, "Sessions sans identifiant").getByTestId("kpi-valeur")).toHaveText("2");
    // 3 occurrences sur 6 sessions commencées ; l'erreur sans session est exclue, et dite.
    const taux = tuile(page, "Occurrences d'erreur par session commencée");
    await expect(taux.getByTestId("kpi-valeur")).toHaveText("0,50");
    await expect(taux).toContainText("2 occurrences sans session rattachée, exclues");
    // Sans lecture (B30), aucun nombre : ni « 0 % », ni « Non collecté ».
    const frustration = tuile(page, "Sessions avec frustration");
    await expect(frustration.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(frustration).toContainText("lecture à créer (B30)");
    await expect(frustration).not.toContainText("%");

    // Le hero dit ce qui lui manque, et rien d'autre.
    await expect(page.locator("#a-regarder-d-abord")).toContainText("classement indisponible : lecture à créer (B30)");
  });

  test("volume : deux graphiques sur grille, plus d'ObservedTrend ; un clic sur un seau zoome", async ({ page }) => {
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("visiteurs-observes")).toHaveCount(0);
    const volume = page.getByTestId("volume-panneaux");
    // `.recharts-wrapper` : une par graphique (`.recharts-surface` compte aussi les icônes de légende).
    await expect(volume.locator(".recharts-wrapper")).toHaveCount(2, { timeout: 15_000 });

    const surface = volume.locator(".recharts-wrapper .recharts-surface").first();
    await surface.scrollIntoViewIfNeeded();
    const boite = await surface.boundingBox();
    if (!boite) throw new Error("graphique sans boîte");
    await page.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.mouse.click(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.waitForURL((u) => u.searchParams.has("from") && u.searchParams.has("to"), { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.pathname).toBe("/sessions");
    expect(u.searchParams.get("app")).toBe(APP_F41);
    expect(u.searchParams.has("period")).toBe(false);
    // L'écran d'arrivée accepte la plage : pas de refus du contrat.
    await expect(page.getByTestId("kpi-sessions")).toBeVisible();
  });

  test("« Qui sont ces sessions » : le groupe « Inconnu » filtre par is_null", async ({ page }) => {
    await login(page);
    await page.goto(adresse("&split=browser"), { waitUntil: "domcontentloaded" });
    const repartition = page.getByTestId("repartition");
    await expect(repartition.getByTestId("breakdown-tab-browser")).toHaveAttribute("aria-current", "page");
    const inconnu = repartition.getByTestId("breakdown-row").filter({ hasText: "Inconnu" });
    await expect(inconnu).toHaveCount(1);
    await expect(inconnu).toContainText("33,3");
    await inconnu.click();
    await page.waitForURL((v) => v.searchParams.get("seg") === "v2:browser:is_null", { timeout: 15_000 });
    // La population filtrée : les deux sessions sans navigateur.
    await expect(tuile(page, "Sessions commencées").getByTestId("kpi-valeur")).toHaveText("2");
  });

  test("cmp=prev sans historique : aucun écart, la raison est écrite", async ({ page }) => {
    await login(page);
    await page.goto(adresse("&cmp=prev"), { waitUntil: "domcontentloaded" });
    await expect(tuile(page, "Sessions commencées")).toContainText("période précédente incomplète");
    await expect(page.getByTestId("volume-reference-absente")).toContainText("période précédente non tracée");
  });

  test("KPI et hero au-dessus du pli à 1440 × 900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    const hero = page.locator("#a-regarder-d-abord");
    await expect(hero).toBeVisible();
    const boite = await hero.boundingBox();
    if (!boite) throw new Error("hero sans boîte");
    expect(boite.y).toBeLessThan(900);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["", "&split=source", "&cmp=prev"]) {
        await page.goto(adresse(extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kpi-sessions")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`/sessions${extra} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
