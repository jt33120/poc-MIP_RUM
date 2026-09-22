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
import { debordements, LARGEURS } from "./helpers/debordements";

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
  // Deux éléments portent l'état de ce SLO depuis F63 : sa ligne de la table
  // « Définitions et état » et sa barre du hero (dont l'alternative textuelle a aussi
  // un <tr>). Chacun est visé par son identifiant, et chacun est vérifié.
  const ligne = page.getByTestId("table-slo").locator("tbody tr", { hasText: "INP sans mesure (e2e)" });
  await expect(ligne).toHaveAttribute("data-statut", "non_mesurable");
  await expect(ligne).toContainText("non mesurable");
  await expect(ligne).not.toContainText("objectif manqué");
  const barre = page.locator("#budget").getByTestId("budget-ligne").filter({ hasText: "INP sans mesure (e2e)" });
  await expect(barre).toHaveAttribute("data-statut", "non_mesurable");
  await expect(barre).toContainText("Non mesurable");
  await expect(barre).not.toContainText("objectif manqué");
});

// ---------------------------------------------------------------------------
// F63 — écran SLO (/slo, plan § 5.18) : des barres de budget, l'absence dite,
// aucune écriture pour un viewer.
//
// Données EXPLICITEMENT SYNTHÉTIQUES dans une app à part, mesurées il y a deux
// heures (dans la fenêtre de 7 jours de chaque SLO) :
//   - « LCP tenu (e2e) » : 100 mesures LCP notées Bon, objectif 90 % → 0 % consommé ;
//   - « INP dépassé (e2e) » : 60 Bon + 40 Mauvais, objectif 95 % → 800 % consommé ;
//   - « CLS sans mesure (e2e) » : aucune mesure → non mesurable.
// Un compte VIEWER dédié à ce fichier vérifie qu'aucun bouton d'écriture n'est rendu.
// ---------------------------------------------------------------------------
test.describe("F63 — Écran SLO", () => {
  const APP_F63 = "f63-e2e-app";
  const VIEWER_F63 = { email: "e2e-fiabilite-viewer@mip-rum.local", motDePasse: "e2e-fiabilite-viewer-mdp-local" };

  test.beforeAll(async () => {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', null, true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = null, active = true`,
      [VIEWER_F63.email, bcryptHash(VIEWER_F63.motDePasse)],
    );
    for (const t of ["rum_metric", "rum_session", "slo"]) await pool.query(`delete from ${t} where app_id = $1`, [APP_F63]);
    await pool.query(`insert into app_registry (app_id, name) values ($1, 'SLO E2E') on conflict (app_id) do nothing`, [APP_F63]);
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '3 hours', now() - interval '2 hours', 1)
       on conflict (session_id) do nothing`,
      [`${APP_F63}-s`, APP_F63],
    );
    let lot = 0;
    const mesures = async (nom: string, rating: "good" | "poor", valeur: number, n: number) => {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         select $1 || '-' || g, $2, $3, '/', $4, $5, $6, now() - interval '2 hours' + make_interval(secs => g)
           from generate_series(1, $7) g`,
        [`${APP_F63}-m${(lot += 1)}`, `${APP_F63}-s`, APP_F63, nom, valeur, rating, n],
      );
    };
    await mesures("LCP", "good", 1200, 100);
    await mesures("INP", "good", 120, 60);
    await mesures("INP", "poor", 900, 40);
    for (const [nom, metrique, objectif] of [
      ["LCP tenu (e2e)", "LCP", 0.9],
      ["INP dépassé (e2e)", "INP", 0.95],
      ["CLS sans mesure (e2e)", "CLS", 0.9],
    ] as const) {
      await pool.query(`insert into slo (app_id, name, metric, objective, window_days) values ($1, $2, $3, $4, 7)`, [
        APP_F63,
        nom,
        metrique,
        objectif,
      ]);
    }
  });

  const ecran = `${consoleUrl}/slo?app=${APP_F63}`;
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ hasText: libelle }).getByTestId("kpi-valeur");

  test("SLO sans mesure → « Non mesurable », jamais « 0 % » ; dépassé écrit et « épuisé »", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    await expect(tuile(page, "SLO actifs")).toHaveText("3");
    await expect(tuile(page, "Budget épuisé")).toHaveText("1");
    await expect(tuile(page, "Non mesurables")).toHaveText("1");

    const budget = page.locator("#budget");
    const sans = budget.getByTestId("budget-ligne").filter({ hasText: "CLS sans mesure (e2e)" });
    await expect(sans).toHaveAttribute("data-statut", "non_mesurable");
    await expect(sans).toContainText("Non mesurable");
    await expect(sans.locator("[data-barre]")).toHaveCount(0);
    expect(await sans.innerText()).not.toMatch(/(^|\s)0\s?%/);
    const depasse = budget.getByTestId("budget-ligne").filter({ hasText: "INP dépassé (e2e)" });
    await expect(depasse).toHaveAttribute("data-statut", "epuise");
    await expect(depasse.getByTestId("budget-valeur")).toContainText("800");
    // Tri : consommé décroissant, non mesurable en dernier.
    await expect(budget.getByTestId("budget-ligne").last()).toContainText("CLS sans mesure (e2e)");

    const ligne = page.getByTestId("table-slo").locator("tbody tr", { hasText: "CLS sans mesure (e2e)" });
    await expect(ligne).toContainText("non mesurable");
    await expect(ligne).toContainText("Part des mesures CLS notées Bon");
    await expect(ligne).not.toContainText("objectif manqué");
  });

  test("SL4 « Consommation du budget dans le temps » : Non collecté, aucune série", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#consommation-temps");
    await expect(figure).toContainText("Non collecté");
    await expect(figure).toContainText("historique de consommation non conservé");
    await expect(figure.locator(".recharts-wrapper, svg")).toHaveCount(0);
  });

  test("viewer : aucun bouton d'écriture dans le DOM", async ({ page }) => {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', VIEWER_F63.email);
    await page.fill('input[name="password"]', VIEWER_F63.motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("table-slo").locator("tbody tr", { hasText: "INP dépassé (e2e)" })).toBeVisible();
    await expect(page.locator('[data-testid^="toggle-slo-"], [data-testid^="delete-slo-"], [data-testid="create-slo"]')).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main").getByText("Créer une alerte")).toHaveCount(0);
    await expect(page.locator("#nouveau-slo")).toHaveCount(0);
  });

  test("admin : les actions sont là (même écran)", async ({ page }) => {
    await login(page);
    await page.goto(ecran, { waitUntil: "domcontentloaded" });
    const ligne = page.getByTestId("table-slo").locator("tbody tr", { hasText: "INP dépassé (e2e)" });
    await expect(ligne.getByRole("button", { name: "Désactiver" })).toBeVisible();
    await expect(ligne.getByRole("link", { name: "Créer une alerte" })).toHaveAttribute("href", /regle_metrique=INP/);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(ecran, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#budget")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// F58 — écran Corrélation (/correlation, plan § 5.7) : des états, pas des écarts.
//
// Données EXPLICITEMENT SYNTHÉTIQUES dans une app à part, sur les 20 dernières
// heures pleines :
//   - /checkout : robot ok chaque heure ; réel à 3 000 ms (À améliorer) sur 6
//     heures, 1 200 ms ailleurs, 30 mesures par heure → 6 heures en angle mort ;
//     une heure (k = 10) sans AUCUNE mesure, ni robot ni réel → un trou ;
//   - /partners : robot ok (incident à k = 5), réel Bon ;
//   - /sans-robot : du trafic réel, aucun scénario.
// ---------------------------------------------------------------------------
test.describe("F58 — Écran Corrélation", () => {
  const APP_F58 = "f58-e2e-app";
  const H = 3_600_000;
  const ANGLES_MORTS_F58 = 6;

  test.beforeAll(async () => {
    for (const t of ["rum_metric", "syn_snapshot", "rum_session"]) await pool.query(`delete from ${t} where app_id = $1`, [APP_F58]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Corrélation E2E') on conflict (app_id) do nothing`,
      [APP_F58],
    );
    const heureCourante = Math.floor(Date.now() / H) * H;
    const debutHeure = (k: number) => new Date(heureCourante - k * H);
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, $3, $4, 1) on conflict (session_id) do nothing`,
      [`${APP_F58}-s`, APP_F58, debutHeure(21), new Date(heureCourante)],
    );
    let lot = 0;
    const reel = async (route: string, k: number, valeur: number, n = 30) => {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         select $1 || '-' || g, $2, $3, $4, 'LCP', $5, 'good', $6::timestamptz + make_interval(secs => g)
           from generate_series(1, $7) g`,
        [`${APP_F58}-m${(lot += 1)}`, `${APP_F58}-s`, APP_F58, route, valeur, new Date(debutHeure(k).getTime() + 10 * 60_000), n],
      );
    };
    const robot = async (route: string, k: number, etat: string, scenario: string) => {
      await pool.query(
        `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
         values ($1, 'recette F58', $2, $2, $3, 90, $4, 800, $5)`,
        [APP_F58, scenario, route, etat, new Date(debutHeure(k).getTime() + 20 * 60_000)],
      );
    };
    for (let k = 2; k <= 19; k++) {
      if (k === 10) continue; // l'heure sans aucune mesure
      await robot("/checkout", k, "ok", "Parcours paiement");
      await reel("/checkout", k, k >= 3 && k <= 8 ? 3000 : 1200);
    }
    for (let k = 2; k <= 12; k++) {
      await robot("/partners", k, k === 5 ? "incident" : "ok", "Parcours partenaires");
      await reel("/partners", k, 1500);
    }
    for (let k = 2; k <= 4; k++) await reel("/sans-robot", k, 4500, 40);
  });

  const ecran = (qs = "") => `${consoleUrl}/correlation?app=${APP_F58}${qs}`;
  const nombre = (texte: string | null) => Number((texte ?? "").replace(/[^\d]/g, ""));

  test("KPI « Heures en angle mort » = cases angle mort de la matrice ; table = min(50, KPI), scénarios renseignés", async ({ page }) => {
    await login(page);
    await page.goto(ecran(), { waitUntil: "domcontentloaded" });
    const tuile = page.getByTestId("kpi-tile").filter({ hasText: "Heures en angle mort" });
    const kpi = nombre(await tuile.getByTestId("kpi-valeur").textContent());
    expect(kpi).toBe(ANGLES_MORTS_F58);

    const cases = page.locator('#concordance td[data-nommee="bad"] [data-testid="concordance-compte"]');
    await expect(cases).toHaveCount(2);
    const sommeCases = (await cases.allTextContents()).map(nombre).reduce((a, b) => a + b, 0);
    expect(sommeCases).toBe(kpi);

    const table = page.locator("#angles-morts");
    await expect(table.getByRole("columnheader", { name: "Scénarios robot" })).toBeVisible();
    await expect(table.getByTestId("angle-mort")).toHaveCount(Math.min(50, kpi));
    await expect(table.getByTestId("scenarios-robot").first()).toHaveText("Parcours paiement");
    await expect(table.getByTestId("regle-angle-mort")).toContainText("au-dessus de 2,5 s");
    // Plus d'écart en % entre deux mesures différentes, plus de « poor », plus d'émoji.
    await expect(page.getByTestId("gap")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(/écart\s*[−+-]?\d+\s*%|👍|\bpoor\b/);
  });

  test("?route=/partners sans serie ouvre le hero sur /partners", async ({ page }) => {
    await login(page);
    await page.goto(ecran("&route=%2Fpartners"), { waitUntil: "domcontentloaded" });
    await expect(page.locator("#hero h2")).toContainText("Robot face au réel — /partners");
    // Sans filtre de route : le couple aux angles morts les plus nombreux.
    await page.goto(ecran(), { waitUntil: "domcontentloaded" });
    await expect(page.locator("#hero h2")).toContainText("Robot face au réel — /checkout");
  });

  test("clic sur un seau de la frise → from/to du seau et serie=<app>:<route>, sans period", async ({ page }) => {
    await login(page);
    await page.goto(ecran("&period=24h"), { waitUntil: "domcontentloaded" });
    const seau = page.locator('#hero [data-couche="detail"] a[data-case]:has([data-etat="ok"])').first();
    await seau.scrollIntoViewIfNeeded();
    // Une case « ok » est BASSE : on clique dans son pavé, au pied de la case (le
    // centre de la boîte tombe au-dessus du dessin).
    const boite = await seau.boundingBox();
    await seau.click({ position: { x: boite!.width / 2, y: boite!.height - 3 } });
    await expect(page).toHaveURL((u) => u.searchParams.has("from") && u.searchParams.has("to"), { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.searchParams.get("serie")).toBe(`${APP_F58}:%2Fcheckout`);
    expect(u.searchParams.get("period")).toBeNull();
    expect(Date.parse(u.searchParams.get("to")!) - Date.parse(u.searchParams.get("from")!)).toBe(H);
    await expect(page.locator("#hero h2")).toContainText("/checkout");
  });

  test("aucune série robot dans le panneau réel ; alternative : une ligne par heure, « — » où le réel manque", async ({ page }) => {
    await login(page);
    await page.goto(ecran(), { waitUntil: "domcontentloaded" });
    const hero = page.locator("#hero");
    await expect(hero.getByTestId("threshold-series")).toHaveCount(1);
    await expect(hero.getByTestId("legende-serie")).not.toContainText("Robot");
    await expect(hero.getByTestId("legende-serie")).toContainText("Réel · LCP p75");
    const seaux = Number(await hero.getByTestId("threshold-series").getAttribute("data-seaux"));
    const alternative = hero.locator("table", { has: page.locator("caption", { hasText: "Réel · LCP p75 par heure" }) });
    await expect(alternative.locator("tbody tr")).toHaveCount(seaux);
    const cellules = await alternative.locator("tbody tr td:nth-of-type(1)").allTextContents();
    expect(cellules).toContain("—");
  });

  test("frise robot alignée à ≤ 2 px sur les seaux de la série, à 1440 et à 390 px", async ({ page }) => {
    await login(page);
    for (const largeur of [1440, 390]) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(ecran(), { waitUntil: "domcontentloaded" });
      const hero = page.locator("#hero");
      const grille = hero.locator(".recharts-cartesian-grid-horizontal line").first();
      await expect(grille).toBeAttached({ timeout: 15_000 });
      await grille.scrollIntoViewIfNeeded();
      const zone = await grille.boundingBox();
      const n = Number(await hero.getByTestId("threshold-series").getAttribute("data-seaux"));
      const cases = hero.locator('[data-couche="detail"] [data-case]');
      await expect(cases).toHaveCount(n);
      const premiere = await cases.first().boundingBox();
      const derniere = await cases.last().boundingBox();
      expect(zone && premiere && derniere).toBeTruthy();
      const centre = (b: { x: number; width: number }) => b.x + b.width / 2;
      expect(Math.abs(centre(premiere!) - (zone!.x + zone!.width / (2 * n))), `${largeur} px, première case`).toBeLessThanOrEqual(2);
      expect(Math.abs(centre(derniere!) - (zone!.x + (zone!.width * (n - 0.5)) / n)), `${largeur} px, dernière case`).toBeLessThanOrEqual(2);
    }
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(ecran(), { waitUntil: "domcontentloaded" });
      await expect(page.locator("#hero")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
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

// ---------------------------------------------------------------------------
// F64 — écran Alertes (/alerts, plan § 5.19) : ce qui s'est déclenché, qui en a
// été averti, et ce qui reste à traiter.
//
// Données EXPLICITEMENT SYNTHÉTIQUES dans une app à part, sur 30 jours :
//   - une règle LCP > 2 500 sur /checkout, FRANCHIE, qui a déclenché il y a 2 h
//     SANS aucune livraison (personne n'a été averti) ;
//   - une règle error_rate sur /panier en « données insuffisantes », déclenchée
//     il y a un jour et LIVRÉE, acquittée ;
//   - une règle sur une issue, jamais évaluée, déclenchée il y a trois jours avec
//     une livraison TRANSMISE mais non confirmée (« en attente », v49).
// Aucun canal de notification actif sur le périmètre : le bandeau doit le dire
// AVANT les chiffres. Les canaux globaux actifs de la base sont éteints le temps
// du fichier, puis rallumés — la console ne distingue pas un canal global d'un
// canal d'app, et un canal étranger rendrait le cas sans objet.
// ---------------------------------------------------------------------------
test.describe("F64 — Écran Alertes", () => {
  const APP_F64 = "f64-e2e-app";
  const ISSUE_F64 = "f6400000-0000-4000-8000-000000000064";
  const identifiants = { lcp: 0, erreurs: 0, issue: 0, evtLcp: 0, evtErreurs: 0, evtIssue: 0 };
  let canauxGlobauxEteints: number[] = [];

  const regleF64 = async (
    metric: string,
    route: string | null,
    seuil: number,
    fenetre: number,
    severite: string,
    etat: string | null,
    valeur: number | null,
    raison: string | null,
  ): Promise<number> => {
    const { rows } = await pool.query(
      `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, active,
                               mode, severity, sensitivity, baseline_weeks,
                               last_evaluated_at, last_state, last_value, last_reason)
       values ($1, $2, $3, '>', $4, $5, true, 'threshold', $6, 3, 4,
               case when $7::text is null then null else now() - interval '10 minutes' end, $7, $8, $9)
       returning id`,
      [APP_F64, metric, route, seuil, fenetre, severite, etat, valeur, raison],
    );
    return Number(rows[0].id);
  };

  const evenementF64 = async (
    ruleId: number,
    ilYA: string,
    severite: string,
    message: string,
    acquitte: boolean,
    livraison: "delivered" | "sent" | null,
  ): Promise<number> => {
    const { rows } = await pool.query(
      `insert into alert_event (rule_id, fired_at, value, message, acknowledged, severity)
       values ($1, now() - $2::interval, 1, $3, $4, $5) returning id`,
      [ruleId, ilYA, message, acquitte, severite],
    );
    const id = Number(rows[0].id);
    if (livraison) {
      await pool.query(
        `insert into alert_delivery (alert_event_id, target, status) values ($1, 'http://hook.local/f64', $2)`,
        [id, livraison],
      );
    }
    return id;
  };

  test.beforeAll(async () => {
    // `alert_event` et `alert_delivery` partent en cascade avec leur règle.
    await pool.query("delete from alert_rule where app_id = $1", [APP_F64]);
    await pool.query("delete from notify_channel where app_id = $1", [APP_F64]);
    await pool.query(`insert into app_registry (app_id, name) values ($1, 'Alertes E2E') on conflict (app_id) do nothing`, [
      APP_F64,
    ]);
    const globaux = await pool.query("update notify_channel set active = false where app_id is null and active returning id");
    canauxGlobauxEteints = globaux.rows.map((r) => Number(r.id));

    identifiants.lcp = await regleF64("LCP", "/checkout", 2500, 15, "critical", "breached", 3200, null);
    identifiants.erreurs = await regleF64(
      "error_rate",
      "/panier",
      0.05,
      30,
      "warning",
      "no_data",
      null,
      "moins de 4 fenetres comparables",
    );
    identifiants.issue = await regleF64(`issue:${ISSUE_F64}`, null, 10, 60, "info", null, null, null);

    identifiants.evtLcp = await evenementF64(identifiants.lcp, "2 hours", "critical", "LCP p75 3 200 ms au-dessus du seuil", false, null);
    identifiants.evtErreurs = await evenementF64(
      identifiants.erreurs,
      "1 day",
      "warning",
      "Taux d'erreur au-dessus du seuil",
      true,
      "delivered",
    );
    identifiants.evtIssue = await evenementF64(identifiants.issue, "3 days", "info", "Pic d'occurrences sur une issue", false, "sent");
  });

  test.afterAll(async () => {
    if (canauxGlobauxEteints.length > 0) {
      await pool.query("update notify_channel set active = true where id = any($1::bigint[])", [canauxGlobauxEteints]);
    }
  });

  const ecranF64 = (qs = "") => `${consoleUrl}/alerts?app=${APP_F64}${qs}`;
  const tuileF64 = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ hasText: libelle }).getByTestId("kpi-valeur");

  test("« Aucun canal actif » est AU-DESSUS des KPI, et la tuile Canaux actifs vaut 0", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
    const bandeau = page.getByTestId("no-channel-warning");
    await expect(bandeau).toBeVisible();
    await expect(bandeau).toContainText("la supervision voit, elle ne prévient pas");
    const kpi = page.getByTestId("kpi-alertes");
    await expect(kpi).toBeVisible();
    const hautBandeau = (await bandeau.boundingBox())!.y;
    const hautKpi = (await kpi.boundingBox())!.y;
    expect(hautBandeau, "le bandeau se lit avant les chiffres").toBeLessThan(hautKpi);
    await expect(tuileF64(page, "Canaux actifs")).toHaveText("0");
    // A1, A3, A4 : les comptes de la seed, jamais un « 0 » de repli.
    await expect(tuileF64(page, "Non acquittées")).toHaveText("2");
    await expect(tuileF64(page, "Règles franchies")).toHaveText("1");
    await expect(tuileF64(page, "Règles sans données")).toHaveText("2");
    await expect(kpi).toContainText("1 jamais évaluée(s)");
  });

  test("le hero lit 30 jours FIXES et le dit ; une piste par source, l'état de chaque règle", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
    const figure = page.locator("#declenchements");
    await expect(figure).toContainText("30 jours fixes");
    await expect(figure).toContainText("la plage de l'écran ne s'applique pas");
    await expect(figure.getByTestId("piste-declenchements")).toHaveCount(3);
    await expect(figure.getByTestId("etat-actuel").filter({ hasText: "Franchie" })).toHaveCount(1);
    await expect(figure).toContainText("Données insuffisantes");
    // Un marqueur mène à SON déclenchement par `evt` — jamais par `fired`.
    await expect(
      figure.locator(`a[href="/alerts?evt=${identifiants.evtLcp}#evt-${identifiants.evtLcp}"]`).first(),
    ).toBeAttached();
    expect(await figure.innerHTML()).not.toContain("fired=");
  });

  test("le flux dit la route, les trois états de livraison, et le motif du MTTA absent", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
    const lcp = page.getByTestId(`alert-event-${identifiants.evtLcp}`);
    // La route était lue sans jamais être affichée : « LCP franchi » sans savoir où.
    await expect(lcp).toContainText("/checkout");
    await expect(page.getByTestId(`livraison-${identifiants.evtLcp}`)).toHaveText("non livrée");
    await expect(page.getByTestId(`livraison-${identifiants.evtErreurs}`)).toContainText("livrée");
    // Transmis n'est pas livré (v49) : le troisième état existe et se lit.
    await expect(page.getByTestId(`livraison-${identifiants.evtIssue}`)).toContainText("en attente");
    // Non acquittés d'abord : le plus ancien non acquitté précède le plus récent acquitté.
    const ordre = await page
      .locator('[data-testid^="alert-event-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(ordre.indexOf(`alert-event-${identifiants.evtIssue}`)).toBeLessThan(
      ordre.indexOf(`alert-event-${identifiants.evtErreurs}`),
    );
    await expect(page.getByTestId("motif-mtta")).toContainText("acknowledged_at");
  });

  test("« Voir la mesure » porte from/to = la fenêtre ÉVALUÉE, pas la plage de l'écran", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
    const lien = page.getByTestId(`mesure-${identifiants.evtLcp}`);
    const href = new URL((await lien.getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("vital")).toBe("LCP");
    expect(href.searchParams.get("route")).toBe("/checkout");
    expect(href.searchParams.get("period")).toBeNull();
    const debut = Date.parse(href.searchParams.get("from")!);
    const fin = Date.parse(href.searchParams.get("to")!);
    expect(fin - debut).toBe(15 * 60_000);
    // Une règle d'issue mène à SA page d'issue.
    const issue = page.getByTestId(`mesure-${identifiants.evtIssue}`);
    expect(new URL((await issue.getAttribute("href"))!, consoleUrl).pathname).toBe(`/errors/issues/${ISSUE_F64}`);
  });

  test("?evt=<id> met le déclenchement en évidence ; un evt hors des 100 plus récents le dit", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(`&evt=${identifiants.evtIssue}`), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(`alert-event-${identifiants.evtIssue}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId(`alert-event-${identifiants.evtLcp}`)).not.toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("evt-hors-flux")).toHaveCount(0);

    await page.goto(ecranF64("&evt=999999999"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("evt-hors-flux")).toContainText("hors des 100 plus récents");
    // Illisible : ignoré et SIGNALÉ, jamais un refus 400 (§ 3.1 règle 3).
    await page.goto(ecranF64("&evt=abc"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reglage-ignore")).toContainText("evt=abc");
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
  });

  test("?regle_route=/checkout pré-remplit le formulaire, sans note de filtre ni propagation", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64("&regle_metrique=INP&regle_route=%2Fcheckout&regle_seuil=300"), {
      waitUntil: "domcontentloaded",
    });
    const formulaire = page.locator("#nouvelle-regle");
    await expect(formulaire).toHaveAttribute("open", "");
    await expect(formulaire.getByTestId("champ-route")).toHaveValue("/checkout");
    await expect(formulaire.getByTestId("champ-seuil")).toHaveValue("300");
    await expect(formulaire.getByTestId("champ-metrique")).toHaveValue("INP");
    // `regle_route` n'est PAS `route` : aucun filtre de population n'est annoncé
    // non appliqué à cause de lui, et la navigation ne le reporte pas.
    await expect(page.getByTestId("filters-not-applied")).toHaveCount(0);
    const versSlo = await page.locator('a[href*="/slo"]').first().getAttribute("href");
    expect(versSlo ?? "").not.toContain("regle_route");
  });

  test("formulaire par mode : en seuil, aucun champ baseline ; en baseline, aucun champ de seuil", async ({ page }) => {
    await login(page);
    await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
    const formulaire = page.locator("#nouvelle-regle");
    await formulaire.locator("summary").click();
    const seuil = formulaire.getByTestId("champs-seuil");
    const baseline = formulaire.getByTestId("champs-baseline");
    await expect(seuil).toBeVisible();
    await expect(baseline).toBeHidden();
    await formulaire.getByTestId("mode-baseline").check();
    await expect(baseline).toBeVisible();
    await expect(seuil).toBeHidden();
    // « Régression de release » est présentée, désactivée, avec sa raison (B52).
    await expect(formulaire.getByTestId("mode-release")).toBeDisabled();
    await expect(formulaire.getByTestId("raison-release")).toContainText("check_alerts");
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(ecranF64(), { waitUntil: "domcontentloaded" });
      await expect(page.locator("#declenchements")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
    }
    expect(fautes).toEqual([]);
  });
});
