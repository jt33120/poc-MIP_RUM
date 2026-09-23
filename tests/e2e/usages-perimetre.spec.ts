// E2E — F40 (R-A, CS1, § 5.14.0), puis F53 : un viewer restreint à l'app A ne lit
// JAMAIS l'app B sur les écrans d'usage, même en demandant « toutes les apps ».
//
// CE QUE CE SPEC EXISTE POUR PROUVER.
//   Avant B31, les lectures de /acquisition, /paths, /forms et /retention (et /goals
//   avant F66) filtraient l'app par « app demandée, ou toutes si elle est nulle » :
//   sous `app=all`, elles laissaient passer TOUTES les apps de la base (la console se
//   connecte en BYPASSRLS). F40 avait posé deux barrières :
//     1. la porte « projet courant » du middleware réécrit `app=all` en l'app du
//        projet pour un principal restreint (redirection vers `?app=<A>`) ;
//     2. à défaut, `pageFilters` refusait l'écran (« Cet écran lit une application à
//        la fois »).
//   Depuis F53, ces lectures passent par `sqlContext` (apps EFFECTIVES du principal) :
//   le refus 2 est levé. Ce spec exige qu'aucun refus ne s'affiche plus, que l'écran
//   lise A, et que rien de B ne soit rendu.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées ; chaque app porte des
// MARQUEURS (hôte référent, route, formulaire, objectif) qui n'existent nulle part
// ailleurs. Un témoin admin vérifie d'abord que les marqueurs de B s'affichent
// quand B est lue à bon droit : sans lui, « B absent » ne prouverait rien.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const A = "f40-e2e-a";
const B = "f40-e2e-b";
const APPS = [A, B];
const VIEWER_EMAIL = "e2e-f40-viewer@mip-rum.local";
const VIEWER_PASSWORD = "e2e-f40-viewer-mdp-local";
const ADMIN_EMAIL = "e2e-f40-admin@mip-rum.local";
const ADMIN_PASSWORD = "e2e-f40-admin-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const REFUS = "Cet écran lit une application à la fois";

/** Marqueurs visibles de chaque app, par écran (la rétention n'a pas de texte propre : voir plus bas). */
const MARQUEURS: Record<string, Record<string, string>> = {
  [A]: {
    "/acquisition": "ref-f40-a.example",
    "/paths": "/f40-a-entree",
    "/forms": "f40-form-a",
    "/goals": "Objectif F40 A",
  },
  [B]: {
    "/acquisition": "ref-f40-b.example",
    "/paths": "/f40-b-entree",
    "/forms": "f40-form-b",
    "/goals": "Objectif F40 B",
  },
};
// Visiteurs identifiés : 2 dans A, 5 dans B. Une rétention qui lirait B compterait 7.
const VISITEURS: Record<string, number> = { [A]: 2, [B]: 5 };
const ECRANS = ["/acquisition", "/paths", "/forms", "/retention", "/goals"];

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

async function nettoyer() {
  for (const t of ["goal", "rum_event", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
}

async function semer() {
  await nettoyer();
  for (const app of APPS) {
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`,
      [app],
    );
    const lettre = app === A ? "a" : "b";
    for (let i = 0; i < VISITEURS[app]; i++) {
      const sid = `${app}-s${i}`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $3, 'desktop', false, now() - interval '2 hours', now() - interval '90 minutes', 2)`,
        [sid, app, `${app}-v${i}`],
      );
      // Entrée depuis un référent externe propre à l'app, puis une seconde page : une transition.
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
         values ($1, $2, $3, $4, 'https://site-f40.example/entree', $5, now() - interval '2 hours'),
                ($6, $2, $3, $7, 'https://site-f40.example/suite', 'https://site-f40.example/entree', now() - interval '110 minutes')`,
        [
          `${sid}-pv1`,
          sid,
          app,
          `/f40-${lettre}-entree`,
          `https://ref-f40-${lettre}.example/lien`,
          `${sid}-pv2`,
          `/f40-${lettre}-suite`,
        ],
      );
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
         values ($1, $2, $3, $4, 'form.submit', $5::jsonb, now() - interval '100 minutes')`,
        [
          `${sid}-form`,
          sid,
          app,
          `/f40-${lettre}-suite`,
          JSON.stringify({
            form: `f40-form-${lettre}`,
            submitted: true,
            total_time_ms: 4200,
            fields: [{ name: "email", order: 1, timeMs: 1800, changed: true }],
          }),
        ],
      );
    }
    await pool.query(
      `insert into goal (app_id, name, kind, pattern, match_type, active) values ($1, $2, 'pageview', $3, 'exact', true)`,
      [app, `Objectif F40 ${lettre.toUpperCase()}`, `/f40-${lettre}-suite`],
    );
  }
}

test.beforeAll(async () => {
  const hashViewer = bcryptHash(VIEWER_PASSWORD);
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'viewer', array[$3]::text[], true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
    [VIEWER_EMAIL, hashViewer, A],
  );
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [ADMIN_EMAIL, bcryptHash(ADMIN_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await nettoyer();
  await pool.end();
});

async function login(page: Page, email: string, password: string) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

const corps = (page: Page) => page.locator("body");

test("témoin : un admin qui demande B voit les marqueurs de B (sinon « B absent » ne prouverait rien)", async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  for (const [ecran, marqueur] of Object.entries(MARQUEURS[B])) {
    await page.goto(`${consoleUrl}${ecran}?app=${B}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(corps(page), ecran).toContainText(marqueur);
  }
  await page.goto(`${consoleUrl}/retention?app=${B}`, { waitUntil: "domcontentloaded" });
  // F49 : le compte est la tuile « Visiteurs identifiés suivis » (« N visiteurs identifiés, … »).
  await expect(corps(page)).toContainText(`${VISITEURS[B]} visiteurs identifiés`);
});

test("viewer restreint à A + app=all : aucun refus (F53), l'écran lit A — jamais une donnée de B", async ({ page }) => {
  await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  for (const ecran of ECRANS) {
    const periode = ecran === "/retention" ? "" : "&period=24h";
    await page.goto(`${consoleUrl}${ecran}?app=all${periode}`, { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    await expect(corps(page), ecran).not.toContainText("Application error");
    expect(url.pathname, ecran).toBe(ecran);
    // Plus de refus « une application à la fois » : les lectures lient les apps
    // effectives (la porte du middleware peut en plus avoir réécrit « toutes » en A).
    await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
    await expect(corps(page), ecran).not.toContainText(REFUS);
    if (ecran === "/retention") await expect(corps(page)).toContainText(`${VISITEURS[A]} visiteurs identifiés`);
    else await expect(corps(page), ecran).toContainText(MARQUEURS[A][ecran]);
    // Aucune donnée de B.
    for (const marqueur of Object.values(MARQUEURS[B])) await expect(corps(page), `${ecran} → ${marqueur}`).not.toContainText(marqueur);
    if (ecran === "/retention") {
      await expect(corps(page)).not.toContainText(`${VISITEURS[A] + VISITEURS[B]} visiteurs identifiés`);
    }
  }
});

test("viewer restreint à A + app absente : même garantie", async ({ page }) => {
  await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  for (const ecran of ECRANS) {
    await page.goto(`${consoleUrl}${ecran}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
    for (const marqueur of Object.values(MARQUEURS[B])) await expect(corps(page), `${ecran} → ${marqueur}`).not.toContainText(marqueur);
  }
});

test("viewer restreint à A + app=B nommée : hors périmètre, jamais rendue", async ({ page }) => {
  await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  for (const ecran of ECRANS) {
    await page.goto(`${consoleUrl}${ecran}?app=${B}&period=24h`, { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    // Le middleware renvoie vers le sélecteur (refus annoncé), sinon le contrat refuse (`forbidden_app`).
    if (url.pathname === "/select") expect(url.searchParams.get("hors_perimetre"), ecran).toBe(B);
    else await expect(page.getByTestId("filter-problem"), ecran).toContainText("Accès refusé");
    for (const marqueur of Object.values(MARQUEURS[B])) await expect(corps(page), `${ecran} → ${marqueur}`).not.toContainText(marqueur);
  }
});

// ═══════════════════════ F66 — /goals sur le contrat (§ 5.14.0) ═══════════════════════
//
// F66 lève, pour /goals, le refus provisoire de F40 : les lectures passent par
// `sqlContext`, qui lie les apps EFFECTIVES du principal. Un viewer restreint à A qui
// demande « toutes les apps » voit donc l'écran (réécrit en A par la porte du
// middleware, ou lu sur ses seules apps) — jamais le refus, jamais un objectif, une
// conversion ou une session de B. Apps, objectifs et comptes DÉDIÉS à ce bloc.
test.describe("F66 — /goals : viewer restreint à A + app=all, aucune donnée de B", () => {
  const APP_A_F66 = "f66-e2e-a";
  const APP_B_F66 = "f66-e2e-b";
  const VIEWER_F66 = "e2e-f66-viewer@mip-rum.local";
  const MDP_VIEWER_F66 = "e2e-f66-viewer-mdp-local";
  const ADMIN_F66 = "e2e-f66-admin@mip-rum.local";
  // A : 2 sessions dont 1 convertie ; B : 5 sessions toutes converties. Lue avec B, la
  // population de A compterait 7 sessions et « 1 sur 7 ».
  const SESSIONS_F66: Record<string, { n: number; converties: number }> = {
    [APP_A_F66]: { n: 2, converties: 1 },
    [APP_B_F66]: { n: 5, converties: 5 },
  };
  const OBJECTIF_F66: Record<string, string> = { [APP_A_F66]: "Objectif F66 A", [APP_B_F66]: "Objectif F66 B" };
  let mdpAdminF66 = "";

  async function nettoyerF66() {
    for (const t of ["goal", "rum_pageview", "rum_session"])
      await pool.query(`delete from ${t} where app_id = any($1::text[])`, [[APP_A_F66, APP_B_F66]]);
  }

  test.beforeAll(async () => {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array[$3]::text[], true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
      [VIEWER_F66, bcryptHash(MDP_VIEWER_F66), APP_A_F66],
    );
    mdpAdminF66 = await compteDedie(pool, ADMIN_F66);
    await nettoyerF66();
    for (const [app, { n, converties }] of Object.entries(SESSIONS_F66)) {
      await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
      for (let i = 0; i < n; i++) {
        const sid = `${app}-s${i}`;
        await pool.query(
          `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
           values ($1, $2, $1, 'desktop', false, now() - interval '2 hours', now() - interval '90 minutes', 2)`,
          [sid, app],
        );
        await pool.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
           values ($1, $2, $3, '/f66-accueil', 'https://site-f66.example/', now() - interval '2 hours')`,
          [`${sid}-pv1`, sid, app],
        );
        if (i < converties) {
          await pool.query(
            `insert into rum_pageview (span_id, session_id, app_id, route, url, started_at)
             values ($1, $2, $3, '/f66-merci', 'https://site-f66.example/merci', now() - interval '110 minutes')`,
            [`${sid}-pv2`, sid, app],
          );
        }
      }
      await pool.query(
        `insert into goal (app_id, name, kind, pattern, match_type, active) values ($1, $2, 'pageview', '/f66-merci', 'exact', true)`,
        [app, OBJECTIF_F66[app]],
      );
    }
  });

  test.afterAll(async () => {
    await nettoyerF66();
  });

  test("témoin admin : B se lit à bon droit ; sous « toutes », chaque objectif sur les sessions de SON app", async ({ page }) => {
    await login(page, ADMIN_F66, mdpAdminF66);
    await page.goto(`${consoleUrl}/goals?app=${APP_B_F66}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(corps(page)).toContainText(OBJECTIF_F66[APP_B_F66]);
    await page.goto(`${consoleUrl}/goals?app=all&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
    const table = page.locator("#objectifs");
    await expect(table.locator("tr", { hasText: OBJECTIF_F66[APP_A_F66] })).toContainText("1 sur 2");
    await expect(table.locator("tr", { hasText: OBJECTIF_F66[APP_B_F66] })).toContainText("5 sur 5");
    // Plusieurs apps : l'app préfixe la condition dans le hero.
    await expect(page.locator("#conversions-taux")).toContainText(`${APP_B_F66} · page vue = /f66-merci`);
  });

  test("viewer restreint à A + app=all : l'écran s'affiche (refus F40 levé), A seule", async ({ page }) => {
    await login(page, VIEWER_F66, MDP_VIEWER_F66);
    for (const qs of ["app=all&period=24h", "period=24h"]) {
      await page.goto(`${consoleUrl}/goals?${qs}`, { waitUntil: "domcontentloaded" });
      await expect(corps(page), qs).not.toContainText("Application error");
      // Ni refus « une application à la fois » : les lectures lient les apps effectives.
      await expect(corps(page), qs).not.toContainText(REFUS);
      await expect(corps(page), qs).toContainText(OBJECTIF_F66[APP_A_F66]);
      await expect(corps(page), qs).not.toContainText(OBJECTIF_F66[APP_B_F66]);
      // Dénominateur : les 2 sessions de A, jamais les 7 de A + B.
      const denominateur = page.getByTestId("kpi-tile").filter({ hasText: "Sessions de la fenêtre" });
      await expect(denominateur.getByTestId("kpi-valeur"), qs).toHaveText("2");
      await expect(page.locator("#objectifs tr", { hasText: OBJECTIF_F66[APP_A_F66] }), qs).toContainText("1 sur 2");
      // Aucune gestion (écriture) rendue pour un viewer (V9).
      await expect(page.getByTestId("create-goal"), qs).toHaveCount(0);
    }
  });

  test("plage personnalisée, tablette et appareil inconnu acceptés (plus de lecture historique)", async ({ page }) => {
    await login(page, VIEWER_F66, MDP_VIEWER_F66);
    const to = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 6 * 3_600_000).toISOString();
    for (const qs of [`from=${from}&to=${to}`, "period=24h&device=tablet", "period=24h&seg=v2%3Adevice%3Ais_null"]) {
      await page.goto(`${consoleUrl}/goals?app=${APP_A_F66}&${qs}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("filter-problem"), qs).toHaveCount(0);
      await expect(page.locator("#conversions-taux"), qs).toBeVisible();
    }
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page, ADMIN_F66, mdpAdminF66);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/goals?app=all&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#conversions-taux")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});

// ═══════════════════════ F53 — écrans d'usage sur le contrat (B31) ═══════════════════════
//
// B31 passe les lectures de /acquisition, /paths, /forms et /retention sur
// `sqlContext` ; F53 retire leur `legacy` : plage personnalisée, tablette et
// « Inconnu » ne sont plus refusés — et ils s'APPLIQUENT (un filtre accepté puis
// ignoré serait pire qu'un refus, V10). Chaque session de A porte des marqueurs
// propres à son appareil ; la session tablette n'a pas de navigateur déclaré.
// Apps, comptes et marqueurs DÉDIÉS à ce bloc.
test.describe("F53 — écrans d'usage sur le contrat : plage personnalisée, tablette, « Inconnu », périmètre", () => {
  const APP_A_F53 = "f53-e2e-a";
  const APP_B_F53 = "f53-e2e-b";
  const VIEWER_F53 = "e2e-f53-viewer@mip-rum.local";
  const MDP_VIEWER_F53 = "e2e-f53-viewer-mdp-local";
  const ADMIN_F53 = "e2e-f53-admin@mip-rum.local";
  let mdpAdminF53 = "";

  // Une session par ligne : app, suffixe, appareil et navigateur ; le suffixe fait
  // les marqueurs qu'elle affiche sur chaque écran (référent, route d'entrée,
  // formulaire). Aucun suffixe n'est le début d'un autre (« f53-form-b » serait
  // contenu dans « f53-form-bureau » : un « absent » ne prouverait plus rien).
  const SESSIONS_F53: { app: string; cle: string; device: string; browser: string | null }[] = [
    { app: APP_A_F53, cle: "bureau", device: "desktop", browser: "Firefox" },
    { app: APP_A_F53, cle: "tablette", device: "tablet", browser: null },
    { app: APP_B_F53, cle: "autre", device: "desktop", browser: "Firefox" },
  ];
  const ECRANS_F53 = ["/acquisition", "/paths", "/forms"] as const;
  type EcranF53 = (typeof ECRANS_F53)[number];
  const marqueurF53 = (cle: string, ecran: EcranF53): string =>
    ({ "/acquisition": `ref-f53-${cle}.example`, "/paths": `/f53-${cle}-entree`, "/forms": `f53-form-${cle}` })[ecran];

  async function nettoyerF53() {
    for (const t of ["rum_event", "rum_pageview", "rum_session"])
      await pool.query(`delete from ${t} where app_id = any($1::text[])`, [[APP_A_F53, APP_B_F53]]);
  }

  test.beforeAll(async () => {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array[$3]::text[], true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
      [VIEWER_F53, bcryptHash(MDP_VIEWER_F53), APP_A_F53],
    );
    mdpAdminF53 = await compteDedie(pool, ADMIN_F53);
    await nettoyerF53();
    for (const app of [APP_A_F53, APP_B_F53]) {
      await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
    }
    for (const s of SESSIONS_F53) {
      const sid = `${s.app}-${s.cle}`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, browser, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, $3, $4, false, now() - interval '2 hours', now() - interval '90 minutes', 2)`,
        [sid, s.app, s.device, s.browser],
      );
      // Entrée depuis un référent propre à la session, puis une seconde page : une transition.
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
         values ($1, $2, $3, $4, 'https://site-f53.example/entree', $5, now() - interval '2 hours'),
                ($6, $2, $3, '/f53-suite', 'https://site-f53.example/suite', 'https://site-f53.example/entree', now() - interval '110 minutes')`,
        [`${sid}-pv1`, sid, s.app, marqueurF53(s.cle, "/paths"), `https://${marqueurF53(s.cle, "/acquisition")}/lien`, `${sid}-pv2`],
      );
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
         values ($1, $2, $3, '/f53-suite', 'form.submit', $4::jsonb, now() - interval '100 minutes')`,
        [
          `${sid}-form`,
          sid,
          s.app,
          JSON.stringify({
            form: marqueurF53(s.cle, "/forms"),
            submitted: true,
            total_time_ms: 4200,
            fields: [{ name: "email", order: 1, timeMs: 1800, changed: true }],
          }),
        ],
      );
    }
  });

  test.afterAll(async () => {
    await nettoyerF53();
  });

  test("viewer restreint à A + app=all : aucun refus, ses seules apps sont lues", async ({ page }) => {
    await login(page, VIEWER_F53, MDP_VIEWER_F53);
    for (const ecran of [...ECRANS_F53, "/retention" as const]) {
      const periode = ecran === "/retention" ? "" : "&period=24h";
      await page.goto(`${consoleUrl}${ecran}?app=all${periode}`, { waitUntil: "domcontentloaded" });
      await expect(corps(page), ecran).not.toContainText("Application error");
      await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
      await expect(corps(page), ecran).not.toContainText(REFUS);
      if (ecran === "/retention") {
        // Deux visiteurs identifiés dans A ; trois si B était lue.
        await expect(corps(page)).toContainText("2 visiteurs identifiés");
        continue;
      }
      await expect(corps(page), ecran).toContainText(marqueurF53("bureau", ecran));
      await expect(corps(page), ecran).not.toContainText(marqueurF53("autre", ecran));
    }
  });

  test("plage personnalisée acceptée : la méta écrit la plage lue, plus de refus « périodes 1 h, 24 h et 7 j »", async ({ page }) => {
    await login(page, ADMIN_F53, mdpAdminF53);
    const to = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 6 * 3_600_000).toISOString();
    for (const ecran of ECRANS_F53) {
      await page.goto(`${consoleUrl}${ecran}?app=${APP_A_F53}&from=${from}&to=${to}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
      await expect(corps(page), ecran).not.toContainText("n'accepte encore que les périodes");
      await expect(page.getByTestId("figure-meta").first(), ecran).toContainText(/du \d\d\/\d\d/);
      // Les deux sessions de A sont dans la plage.
      await expect(corps(page), ecran).toContainText(marqueurF53("bureau", ecran));
      await expect(corps(page), ecran).toContainText(marqueurF53("tablette", ecran));
    }
  });

  test("tablette acceptée ET appliquée : seule la session tablette est lue", async ({ page }) => {
    await login(page, ADMIN_F53, mdpAdminF53);
    for (const ecran of ECRANS_F53) {
      await page.goto(`${consoleUrl}${ecran}?app=${APP_A_F53}&period=24h&device=tablet`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
      await expect(corps(page), ecran).toContainText(marqueurF53("tablette", ecran));
      await expect(corps(page), ecran).not.toContainText(marqueurF53("bureau", ecran));
    }
    await page.goto(`${consoleUrl}/retention?app=${APP_A_F53}&device=tablet`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
    await expect(corps(page)).toContainText("1 visiteurs identifiés");
    await expect(page.getByTestId("retention-deja-filtre")).toContainText("Déjà filtré sur tablettes");
  });

  test("seg=v2:browser:is_null accepté ET appliqué : seule la session sans navigateur est lue", async ({ page }) => {
    await login(page, ADMIN_F53, mdpAdminF53);
    for (const ecran of ECRANS_F53) {
      await page.goto(`${consoleUrl}${ecran}?app=${APP_A_F53}&period=24h&seg=v2%3Abrowser%3Ais_null`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("filter-problem"), ecran).toHaveCount(0);
      await expect(corps(page), ecran).toContainText(marqueurF53("tablette", ecran));
      await expect(corps(page), ecran).not.toContainText(marqueurF53("bureau", ecran));
    }
    await page.goto(`${consoleUrl}/retention?app=${APP_A_F53}&seg=v2%3Abrowser%3Ais_null`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
    await expect(corps(page)).toContainText("1 visiteurs identifiés");
  });

  test("aucun débordement à 390, 768 et 1440 px sur une plage personnalisée", async ({ page }) => {
    await login(page, ADMIN_F53, mdpAdminF53);
    const to = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 6 * 3_600_000).toISOString();
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const ecran of ECRANS_F53) {
        await page.goto(`${consoleUrl}${ecran}?app=${APP_A_F53}&from=${from}&to=${to}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("figure-meta").first()).toBeVisible();
        expect(await debordements(page), `${ecran} à ${largeur} px`).toEqual([]);
      }
    }
  });
});
