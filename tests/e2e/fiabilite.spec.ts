// E2E — domaine Fiabilité (F55) : les écrans s'affichent, et disent vrai.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Que /forecast plante au rendu. Il passait une FONCTION de formatage à un
//     composant client : Next.js refuse de la sérialiser, et l'écran rendait
//     « Application error » dès qu'il y avait des données — donc justement quand
//     on voulait le montrer.
//   - Qu'un SLO sans aucune mesure s'affiche « objectif manqué ». slo_status()
//     rend `attainment = null` dans ce cas ; lu comme 0 %, il devenait un échec.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, sur six jours passés.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f55-e2e-app";
const E2E_EMAIL = "e2e-fiabilite@mip-rum.local";
const E2E_PASSWORD = "e2e-fiabilite-mdp-local";
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
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "slo"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Fiabilité E2E') on conflict (app_id) do nothing`,
    [APP_ID],
  );
  // Six jours passés, un LCP qui monte doucement : de quoi tracer une droite.
  for (let jour = 1; jour <= 6; jour++) {
    const sid = `${APP_ID}-s${jour}`;
    const quand = `now() - interval '${jour} days'`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 3)
       on conflict (session_id) do nothing`,
      [sid, APP_ID],
    );
    for (let p = 0; p < 3; p++) {
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-pv${p}`, sid, APP_ID],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, '/', 'LCP', $4, 'good', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-lcp${p}`, sid, APP_ID, 1800 + (6 - jour) * 60 + p * 10],
      );
    }
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, ts)
       values ($1, $2, $3, '/', 'error', 'boom', ${quand}) on conflict (span_id) do nothing`,
      [`${sid}-err`, sid, APP_ID],
    );
  }
  // Un SLO sur l'INP, que rien ne mesure dans cette app.
  await pool.query(
    `insert into slo (app_id, name, metric, objective, window_days) values ($1, 'INP sans mesure (e2e)', 'INP', 0.9, 7)`,
    [APP_ID],
  );
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

test("/forecast s'affiche avec des données, sur un seul horizon de 7 jours", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/forecast?app=${APP_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).not.toContainText("Application error");
  // F65 : le hero s'appelle « LCP p75 quotidien et sa tendance » (§ 5.20.3, TE5).
  await expect(page.locator("body")).toContainText("LCP p75 quotidien et sa tendance");
  // Le ratio d'erreurs n'est pas une part : jamais « % », et plus de seuil « 2 % » inventé.
  await expect(page.locator("body")).toContainText("Occurrences d'erreurs pour 100 pages vues");
  await expect(page.locator("body")).not.toContainText("Seuil d'alerte : 2 %");
});

test("/slo : un SLO sans mesure est « non mesurable », pas « objectif manqué »", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/slo?app=${APP_ID}`, { waitUntil: "domcontentloaded" });
  const ligne = page.locator("tr", { hasText: "INP sans mesure (e2e)" });
  await expect(ligne).toContainText("non mesurable");
  await expect(ligne).not.toContainText("objectif manqué");
});

// ─────────────────────────────────────────────────────────────────────────────
// F65 — Tendances (§ 5.20) : une app dédiée, 14 jours complets semés (40 mesures
// LCP par jour, une dérive lente), plus une journée en cours qui ne doit JAMAIS
// entrer dans les chiffres. Ce bloc prouve :
//   - que la fenêtre fixe est dite, dates et fuseau compris ;
//   - que la période choisie en haut ne change aucun chiffre (1 h, 24 h, 7 j) ;
//   - que l'écran rend sans erreur serveur, avec sa méthode (« ce n'est pas une
//     prévision ») ;
//   - qu'il ne déborde pas à 390, 768 et 1440 px.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("F65 — Tendances (§ 5.20)", () => {
  const APP_F65 = "f65-e2e-tendances";
  const TZ_F65 = "Europe/Paris";
  /** Instant « jour local J−k à midi », calculé par PostgreSQL. */
  const midiLocal = (k: string) =>
    `((date_trunc('day', now() at time zone '${TZ_F65}') - ${k} * interval '1 day' + interval '12 hours') at time zone '${TZ_F65}')`;

  test.beforeAll(async () => {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F65]);
    await pool.query(
      `insert into app_registry (app_id, name, timezone) values ($1, 'Tendances E2E', $2)
       on conflict (app_id) do update set timezone = excluded.timezone`,
      [APP_F65, TZ_F65],
    );
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       select $1 || '-s' || k, $1, $1 || '-s' || k, 'desktop', false, ${midiLocal("k")}, ${midiLocal("k")}, 50
         from generate_series(1, 14) as k
       on conflict (session_id) do nothing`,
      [APP_F65],
    );
    // 40 mesures LCP par jour, p75 qui monte de ~60 ms par jour : une tendance établie.
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select $1 || '-lcp-' || k || '-' || j, $1 || '-s' || k, $1, '/', 'LCP',
              1600 + 60 * (14 - k) + (j % 5) * 20, 'good', ${midiLocal("k")}
         from generate_series(1, 14) as k, generate_series(1, 40) as j
       on conflict (span_id) do nothing`,
      [APP_F65],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
       select $1 || '-pv-' || k || '-' || j, $1 || '-s' || k, $1, '/', ${midiLocal("k")}
         from generate_series(1, 14) as k, generate_series(1, 50) as j
       on conflict (span_id) do nothing`,
      [APP_F65],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, occurrences, ts)
       select $1 || '-err-' || k, $1 || '-s' || k, $1, '/', 'error', 'f65', 2, ${midiLocal("k")}
         from generate_series(1, 14) as k
       on conflict (span_id) do nothing`,
      [APP_F65],
    );
    // Journée en cours : une mesure énorme et des pages vues. Elles ne doivent apparaître nulle part.
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ($1 || '-lcp-aujourdhui', $1 || '-s1', $1, '/', 'LCP', 60000, 'poor', now() - interval '1 minute')
       on conflict (span_id) do nothing`,
      [APP_F65],
    );
  });

  const valeursKpi = async (page: Page, extra: string) => {
    await page.goto(`${consoleUrl}/forecast?app=${APP_F65}${extra}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fenetre-fixe")).toBeVisible();
    return page.getByTestId("kpi-valeur").allInnerTexts();
  };

  test("bandeau de fenêtre fixe visible ; changer de période ne change aucun chiffre", async ({ page }) => {
    await login(page);
    const reference = await valeursKpi(page, "");
    expect(reference).toHaveLength(3);
    expect(reference[0]).not.toBe("—");
    const bandeau = page.getByTestId("fenetre-fixe");
    await expect(bandeau).toContainText("14 jours complets, du ");
    await expect(bandeau).toContainText(TZ_F65);
    await expect(bandeau).toContainText("la journée en cours est exclue");
    for (const periode of ["&period=1h", "&period=7d"]) {
      expect(await valeursKpi(page, periode), periode).toEqual(reference);
    }
    // La mesure de 60 s d'aujourd'hui n'entre pas dans le LCP du dernier jour complet.
    expect(reference[0]).not.toContain("60,0");
  });

  test("aucune erreur serveur ; hero, petits multiples et méthode", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forecast?app=${APP_F65}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("#tendance-lcp")).toContainText("LCP p75 quotidien et sa tendance");
    await expect(page.locator("#tendance-erreurs")).toContainText("Occurrences d'erreurs pour 100 pages vues");
    await expect(page.locator("#pages-vues-jour")).toBeVisible();
    await expect(page.locator("#tendance-lcp .recharts-wrapper")).toHaveCount(1);
    await page.getByTestId("methode").locator("summary").click();
    await expect(page.getByTestId("methode")).toContainText("ce n'est pas une prévision");
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    // Import local : le helper n'entre pas dans l'en-tête du fichier, que d'autres lots modifient.
    const { debordements, LARGEURS } = await import("./helpers/debordements");
    await login(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/forecast?app=${APP_F65}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#tendance-lcp")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
    }
    expect(fautes).toEqual([]);
  });
});
