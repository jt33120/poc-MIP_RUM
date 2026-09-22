// E2E — F40 (règle S7, lecture B38) : chaque écran d'agrégat du domaine Usages dit
// s'il lit un échantillon.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un écran d'usage affiche des comptes d'ÉCHANTILLON comme des totaux :
//     une session tirée à 50 % doit faire apparaître « au moins 50 % » et « comptes
//     observés, non extrapolés » sur /sessions, /acquisition, /retention, /paths,
//     /forms et /map.
//   - Qu'un bandeau s'affiche pour rien : une population postérieure au 09/09/2026
//     entièrement collectée (sample_rate = 1) n'en porte aucun.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées, de forme identique :
// l'une échantillonnée à 50 %, l'autre complète. Chaque session a de quoi entrer
// dans la population de chacun des six écrans : pages vues (acquisition, parcours),
// visiteur identifié (rétention), `form.submit` (formulaires), span front (carte).
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const ECHANTILLONNEE = "f40-e2e-ech";
const COMPLETE = "f40-e2e-plein";
const APPS = [ECHANTILLONNEE, COMPLETE];
const E2E_EMAIL = "e2e-f40-echantillonnage@mip-rum.local";
const E2E_PASSWORD = "e2e-f40-echantillonnage-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

/** Les six écrans d'agrégat du domaine (zones Z2b, A2b, R2b, P2b, Fm2b, M2b). */
const ECRANS = ["/sessions", "/acquisition", "/retention", "/paths", "/forms", "/map"];

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
  for (const t of ["rum_span", "rum_event", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS]);
}

async function semer() {
  await nettoyer();
  for (const app of APPS) {
    await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
    // Taux d'échantillonnage enregistré (postérieur à v58) ; `error_sample_rate` garde
    // son défaut (1) : la session échantillonnée est donc aussi « biaisée-erreurs ».
    const sampleRate = app === ECHANTILLONNEE ? 0.5 : 1;
    const sid = `${app}-s1`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, sample_rate)
       values ($1, $2, $3, 'desktop', false, now() - interval '1 hour', now() - interval '30 minutes', 2, $4)`,
      [sid, app, `${app}-v1`, sampleRate],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
       values ($1, $2, $3, '/f40-entree', 'https://site-f40.example/entree', 'https://www.google.com/', now() - interval '1 hour'),
              ($4, $2, $3, '/f40-suite', 'https://site-f40.example/suite', 'https://site-f40.example/entree', now() - interval '50 minutes')`,
      [`${sid}-pv1`, sid, app, `${sid}-pv2`],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ($1, $2, $3, '/f40-suite', 'form.submit', $4::jsonb, now() - interval '45 minutes')`,
      [
        `${sid}-form`,
        sid,
        app,
        JSON.stringify({ form: "f40-contact", submitted: true, total_time_ms: 3000, fields: [{ name: "email", order: 1 }] }),
      ],
    );
    // Un appel front et son exécution serveur (même trace) : la carte a un graphe.
    await pool.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, method, status_code, duration_ms, ts)
       values ($1, $2, 'front', $3, $4, '/api/f40', 'GET', 200, 180, now() - interval '40 minutes'),
              ($5, $2, 'back', null, $4, '/api/f40', 'GET', 200, 90, now() - interval '40 minutes')`,
      [`${sid}-sp-front`, `${sid}-trace`, sid, app, `${sid}-sp-back`],
    );
  }
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await nettoyer();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** La rétention lit ses propres semaines : la période du haut n'y a pas cours (F40). */
const adresse = (ecran: string, app: string) =>
  `${consoleUrl}${ecran}?app=${app}${ecran === "/retention" ? "" : "&period=24h"}`;

test("population échantillonnée à 50 % : le bandeau S7 est sur les six écrans", async ({ page }) => {
  await login(page);
  for (const ecran of ECRANS) {
    await page.goto(adresse(ecran, ECHANTILLONNEE), { waitUntil: "domcontentloaded" });
    await expect(page.locator("body"), ecran).not.toContainText("Application error");
    const bandeau = page.getByTestId("bandeau-echantillonnage");
    await expect(bandeau, ecran).toHaveCount(1);
    await expect(bandeau.getByRole("note"), ecran).toBeVisible();
    await expect(bandeau, ecran).toContainText(/au moins 50\s%/);
    await expect(bandeau, ecran).toContainText("comptes observés, non extrapolés");
    // `error_sample_rate` = 1 et `sample_rate` < 1 : l'échantillon est biaisé vers les erreurs.
    await expect(bandeau, ecran).toContainText("Les sessions avec erreur sont sur-représentées");
    // Jamais « 100 % » pour une probabilité d'inclusion.
    await expect(bandeau, ecran).not.toContainText(/100\s%/);
  }
});

test("population postérieure au 09/09/2026 entièrement collectée : aucun bandeau", async ({ page }) => {
  await login(page);
  for (const ecran of ECRANS) {
    await page.goto(adresse(ecran, COMPLETE), { waitUntil: "domcontentloaded" });
    await expect(page.locator("body"), ecran).not.toContainText("Application error");
    await expect(page.locator("h1"), ecran).toBeVisible();
    await expect(page.getByTestId("bandeau-echantillonnage"), ecran).toHaveCount(0);
  }
});
