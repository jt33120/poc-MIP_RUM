// E2E P5.4 — source maps automatisables, de la console à la stack source.
//
// Parcours admin : créer un jeton de CI (secret affiché une seule fois), envoyer
// une map au backend direct avec ce jeton, lire le manifeste, ingérer une erreur
// de la même release et voir sa stack en positions source avec le contexte de
// code, puis révoquer le jeton — qui cesse aussitôt d'ouvrir l'upload.
// Parcours viewer : ni page d'administration, ni écriture, ni code source ; la
// stack d'une erreur dont la map est arrivée après coup est symbolisée à l'affichage.
//
// Utilisateurs DÉDIÉS (les specs tournent en parallèle) ; app explicite dans chaque URL.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import pg from "pg";

const CONSOLE = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const INGEST = process.env.PLAYWRIGHT_INGEST_URL ?? "http://localhost:4318";
const ADMIN = { email: "e2e-sourcemaps-admin@mip-rum.local", password: "e2e-sourcemaps-admin-mdp-local" };
const VIEWER = { email: "e2e-sourcemaps-viewer@mip-rum.local", password: "e2e-sourcemaps-viewer-mdp-local" };
const APP = "p54-e2e-app";
const RELEASE = "5.4.0";
const RELEASE_TARDIVE = "5.4.1";
const BUNDLE = "main-p54e2e.js";
const STACK = `TypeError: panier sans lignes\n    at e (https://app.exemple.fr/assets/${BUNDLE}:1:1)`;
// Colonne 0 de la ligne 1 → src/panier.ts:1:1, nom « validerPanier ».
const MAP = JSON.stringify({
  version: 3,
  sources: ["webpack:///./src/panier.ts"],
  names: ["validerPanier"],
  mappings: "AAAAA",
  sourcesContent: ['export function validerPanier() {\n  throw new TypeError("panier sans lignes");\n}'],
});

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
  await pool.query("delete from audit_log where detail like $1", [`%${APP}%`]);
  for (const table of ["sourcemap_upload_token", "sourcemap", "rum_error", "rum_session"]) {
    await pool.query(`delete from ${table} where app_id = $1`, [APP]);
  }
  await pool.query("delete from app_registry where app_id = $1", [APP]);
}

test.beforeAll(async () => {
  const { rows: [{ v71 }] } = await pool.query<{ v71: boolean }>(
    "select to_regclass('public.sourcemap_upload_token') is not null as v71",
  );
  expect(v71, "la base E2E doit porter migration-v71 (schéma + toutes les migrations)").toBe(true);
  for (const [compte, role, apps] of [[ADMIN, "admin", null], [VIEWER, "viewer", [APP]]] as const) {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, $3, $4, true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = excluded.role, apps = excluded.apps, active = true`,
      [compte.email, bcryptHash(compte.password), role, apps],
    );
  }
  await nettoyer();
  await pool.query("insert into app_registry (app_id, name, active) values ($1, 'Recette P5.4', true)", [APP]);
  // Erreur écrite AVANT sa map (release tardive) : seule la lecture peut la symboliser.
  await pool.query("insert into rum_session (session_id, app_id, device_type) values ('p54-e2e-tardive', $1, 'desktop')", [APP]);
  await pool.query(
    `insert into rum_error (app_id, span_id, session_id, fingerprint, error_type, message, kind, release, stack, ts)
     values ($1, '54e2e00000000001', 'p54-e2e-tardive', 'p54e2efp01', 'TypeError', 'panier sans lignes', 'error', $2, $3,
             now() - interval '2 minutes')`,
    [APP, RELEASE_TARDIVE, STACK],
  );
  await pool.query("insert into sourcemap (app_id, release, filename, content, uploaded_by) values ($1, $2, $3, $4, 'e2e')", [
    APP, RELEASE_TARDIVE, BUNDLE, MAP,
  ]);
});

test.afterAll(async () => {
  await nettoyer();
  await pool.end();
});

async function login(page: Page, compte: { email: string; password: string }) {
  await page.goto(`${CONSOLE}/login`);
  await page.fill('input[name="email"]', compte.email);
  await page.fill('input[name="password"]', compte.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** Lot OTLP/HTTP JSON du SDK web : une exception de la release, sur une session. */
function lotErreur() {
  const nano = String(BigInt(Date.now() - 1_000) * 1_000_000n);
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return {
    resourceSpans: [{
      resource: { attributes: [attr("service.name", "mip-rum-web"), attr("mip.app_id", APP), attr("mip.release", RELEASE)] },
      scopeSpans: [{
        scope: { name: "@mip/rum-sdk", version: "0.4.0" },
        spans: [{
          name: "exception",
          traceId: "54e2e54e2e54e2e54e2e54e2e54e2e01",
          spanId: "54e2e00000000002",
          startTimeUnixNano: nano,
          endTimeUnixNano: nano,
          attributes: [
            attr("mip.session_id", "p54-e2e-ingeree"),
            attr("mip.error_kind", "error"),
            attr("exception.type", "TypeError"),
            attr("exception.message", "panier sans lignes"),
            attr("exception.stacktrace", STACK),
          ],
        }],
      }],
    }],
  };
}

test("admin : jeton de CI, upload direct, manifeste, stack source et révocation", async ({ page, request }) => {
  await login(page, ADMIN);
  await page.goto(`${CONSOLE}/admin/sourcemaps?app=${APP}`);
  await expect(page.getByRole("heading", { name: "Source maps", level: 1 })).toBeVisible();

  await page.getByLabel("Nom du jeton").fill("CI E2E");
  await page.getByRole("button", { name: "Créer le jeton" }).click();
  const encart = page.getByTestId("sourcemap-token-secret");
  await expect(encart).toBeVisible();
  const secret = (await encart.locator("pre code").innerText()).trim();
  expect(secret).toMatch(/^msu_[0-9a-f]{32}_[0-9a-f]{64}$/);

  // Affiché une fois : après rechargement, plus de secret, le jeton est listé actif.
  await page.reload();
  await expect(page.getByTestId("sourcemap-token-secret")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /CI E2E/ })).toContainText("actif");
  await expect(page.locator("body")).not.toContainText(secret);

  const corps = { appId: APP, release: RELEASE, maps: [{ filename: BUNDLE, content: MAP }] };
  const sansJeton = await request.post(`${INGEST}/v1/sourcemaps`, { data: corps });
  expect(sansJeton.status()).toBe(401);
  const upload = await request.post(`${INGEST}/v1/sourcemaps`, { data: corps, headers: { authorization: `Bearer ${secret}` } });
  expect(upload.status()).toBe(200);
  expect(await upload.json()).toMatchObject({ created: 1, maps: [{ filename: BUNDLE, status: "created" }] });

  await page.goto(`${CONSOLE}/admin/sourcemaps?app=${APP}&release=${RELEASE}`);
  const manifeste = page.getByTestId("sourcemap-manifest");
  await expect(manifeste).toContainText(BUNDLE);
  await expect(manifeste).toContainText("validée");
  await expect(page.getByRole("row", { name: /CI E2E/ })).not.toContainText("jamais");

  const ingestion = await request.post(`${INGEST}/v1/traces`, { data: lotErreur() });
  expect(ingestion.status()).toBe(200);
  const { rows: [erreur] } = await pool.query<{ fingerprint: string; symbolication_status: string }>(
    "select fingerprint, symbolication_status from rum_error where span_id = '54e2e00000000002'",
  );
  expect(erreur.symbolication_status).toBe("resolved");

  await page.goto(`${CONSOLE}/errors/${encodeURIComponent(erreur.fingerprint)}?app=${APP}&period=24h`);
  await expect(page.getByTestId("stack-deminified")).toBeVisible();
  await expect(page.locator("pre", { hasText: "at validerPanier (src/panier.ts:1:1)" })).toBeVisible();
  await expect(page.getByTestId("code-context")).toContainText('throw new TypeError("panier sans lignes");');

  await page.goto(`${CONSOLE}/admin/sourcemaps?app=${APP}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Révoquer le jeton CI E2E" }).click();
  await expect(page.getByRole("row", { name: /CI E2E/ })).toContainText("révoqué");
  const apresRevocation = await request.post(`${INGEST}/v1/sourcemaps`, { data: corps, headers: { authorization: `Bearer ${secret}` } });
  expect(apresRevocation.status()).toBe(401);

  // 390 px : la page d'administration ne déborde pas horizontalement.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${CONSOLE}/admin/sourcemaps?app=${APP}&release=${RELEASE}`);
  await expect(page.getByTestId("sourcemap-manifest")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("viewer : ni administration ni écriture, stack symbolisée à l'affichage sans code source", async ({ page }) => {
  await login(page, VIEWER);
  await page.goto(`${CONSOLE}/admin/sourcemaps?app=${APP}`);
  await expect(page).not.toHaveURL(/\/admin\/sourcemaps/);

  const entetes = { origin: CONSOLE };
  const jeton = await page.request.post(`${CONSOLE}/api/admin/sourcemap-tokens`, { data: { appId: APP, name: "pirate" }, headers: entetes });
  expect(jeton.status()).toBe(403);
  const upload = await page.request.post(`${CONSOLE}/api/sourcemaps`, {
    data: { appId: APP, release: "9.9.9", maps: [{ filename: BUNDLE, content: MAP }] },
    headers: entetes,
  });
  expect(upload.status()).toBe(403);
  expect((await page.request.get(`${CONSOLE}/api/sourcemaps?appId=${APP}`)).status()).toBe(403);

  await page.goto(`${CONSOLE}/errors/p54e2efp01?app=${APP}&period=24h`);
  await expect(page.getByTestId("stack-deminified")).toBeVisible();
  await expect(page.getByText("Symbolisée à l'affichage")).toBeVisible();
  await expect(page.locator("pre", { hasText: "at validerPanier (src/panier.ts:1:1)" })).toBeVisible();
  await expect(page.getByTestId("code-context")).toHaveCount(0);
});
