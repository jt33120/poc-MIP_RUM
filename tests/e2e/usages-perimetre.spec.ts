// E2E — F40 (R-A, CS1, § 5.14.0) : un viewer restreint à l'app A ne lit JAMAIS l'app B
// sur les écrans d'usage à lecture historique, même en demandant « toutes les apps ».
//
// CE QUE CE SPEC EXISTE POUR PROUVER (ou infirmer).
//   Les lectures de /acquisition, /paths, /forms, /retention et /goals filtrent l'app
//   par `($1::text is null or app_id = $1)`. Sous `app=all`, `$1` vaut null : la clause
//   laisse passer TOUTES les apps de la base, et la console se connecte en BYPASSRLS.
//   D'après le code, deux barrières se tiennent devant :
//     1. la porte « projet courant » du middleware réécrit `app=all` en l'app du
//        projet pour un principal restreint (redirection vers `?app=<A>`) ;
//     2. à défaut, `pageFilters` refuse l'écran (« Cet écran lit une application à la
//        fois »), refus typé posé par F40 jusqu'à la migration des lectures (F53, F66).
//   Ce spec ne présume pas laquelle agit : il exige que l'une des deux ait agi, et
//   que rien de B ne soit rendu.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées ; chaque app porte des
// MARQUEURS (hôte référent, route, formulaire, objectif) qui n'existent nulle part
// ailleurs. Un témoin admin vérifie d'abord que les marqueurs de B s'affichent
// quand B est lue à bon droit : sans lui, « B absent » ne prouverait rien.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

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

test("viewer restreint à A + app=all : l'app est réécrite en A, ou l'écran est refusé — jamais une donnée de B", async ({ page }) => {
  await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  for (const ecran of ECRANS) {
    const periode = ecran === "/retention" ? "" : "&period=24h";
    await page.goto(`${consoleUrl}${ecran}?app=all${periode}`, { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    await expect(corps(page), ecran).not.toContainText("Application error");
    if (url.searchParams.get("app") === A) {
      // Barrière 1 : la porte « projet courant » a réécrit « toutes » en A. L'écran lit A.
      expect(url.pathname, ecran).toBe(ecran);
      if (ecran === "/retention") await expect(corps(page)).toContainText(`${VISITEURS[A]} visiteurs identifiés`);
      else await expect(corps(page), ecran).toContainText(MARQUEURS[A][ecran]);
    } else {
      // Barrière 2 : l'URL garde « toutes » → refus typé de F40, reprise vers /select.
      await expect(page.getByTestId("filter-problem"), ecran).toContainText(REFUS);
      await expect(page.getByTestId("filter-problem-reset"), ecran).toHaveAttribute("href", "/select");
    }
    // Dans les deux cas : aucune donnée de B.
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
    const app = new URL(page.url()).searchParams.get("app");
    if (app !== A) await expect(page.getByTestId("filter-problem"), ecran).toContainText(REFUS);
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
