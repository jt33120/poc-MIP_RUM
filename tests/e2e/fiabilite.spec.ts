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
  await expect(page.locator("body")).toContainText("LCP p75 — réel + projection à J+7");
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
