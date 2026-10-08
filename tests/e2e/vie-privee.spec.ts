// E2E — LES DEMANDES RGPD SANS IDENTIFIANT DANS UNE URL (audit du 07/10/2026).
//
// Parcours d'un administrateur de la plateforme sur `/admin/privacy`, servi par
// console-api (mode strict de l'E2E : l'écran part en POST, ses paramètres dans le
// corps) : rechercher un visiteur, exporter ses données, les effacer. À chaque pas,
// aucune URL demandée par le navigateur ne porte l'identifiant du visiteur, et le
// journal d'audit n'en garde que l'empreinte tronquée.
//
// Utilisateur et application DÉDIÉS (les specs tournent en parallèle).
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { effacerAudit } from "../fixtures/effacer-audit";

const CONSOLE = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const ADMIN = { email: "e2e-vie-privee-admin@mip-rum.local", password: "e2e-vie-privee-admin-mdp-local" };
const APP = "vie-privee-e2e-app";
const VISITEUR = "visiteur-e2e-4b7c19d2";
const REF = createHash("sha256").update(VISITEUR).digest("hex").slice(0, 12);

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
  await effacerAudit(pool, "detail like $1", [`%${APP}%`]);
  await pool.query("delete from rum_session where app_id = $1", [APP]);
  await pool.query("delete from privacy_erasure_request where app_id = $1", [APP]).catch(() => {});
  await pool.query("delete from app_registry where app_id = $1", [APP]);
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [ADMIN.email, bcryptHash(ADMIN.password)],
  );
  await nettoyer();
  await pool.query("insert into app_registry (app_id, name, active) values ($1, 'Recette vie privée', true)", [APP]);
  for (const s of ["vp-e2e-s1", "vp-e2e-s2"]) {
    await pool.query("insert into rum_session (session_id, app_id, device_type, visitor_id) values ($1, $2, 'desktop', $3)", [s, APP, VISITEUR]);
  }
});

test.afterAll(async () => {
  await nettoyer();
  await pool.query("delete from console_user where email = $1", [ADMIN.email]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${CONSOLE}/login`);
  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test("rechercher, exporter, effacer un visiteur : aucune URL ne porte son identifiant, l'audit n'en garde que l'empreinte", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await login(page);

  await page.goto(`${CONSOLE}/admin/privacy`);
  const recherche = page.getByTestId("dsar-visitor-search-form");
  await recherche.locator('select[name="visitor_app"]').selectOption(APP);
  await recherche.locator('input[name="user"]').fill(VISITEUR);
  await recherche.getByRole("button", { name: "Chercher" }).click();

  // Le résultat s'affiche (servi par console-api, la personne dans le CORPS), l'URL reste nue.
  const exporter = page.getByTestId("dsar-visitor-export");
  await expect(exporter).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(VISITEUR).first()).toBeVisible();
  expect(new URL(page.url()).search).not.toContain(VISITEUR);
  expect(await exporter.getAttribute("href")).toBe("/admin/privacy/export");

  // L'export relit la demande scellée : le document de CE visiteur, sans identifiant dans le lien.
  const [telechargement] = await Promise.all([page.waitForEvent("download"), exporter.click()]);
  const document = JSON.parse(readFileSync((await telechargement.path())!, "utf8")) as Record<string, unknown>;
  expect(JSON.stringify(document)).toContain("vp-e2e-s1");

  // L'effacement : la ressaisie exacte, puis l'issue — toujours sans identifiant dans l'URL.
  const effacer = page.getByTestId("dsar-visitor-erase-form");
  await effacer.locator('input[name="confirm"]').fill(VISITEUR);
  await effacer.getByRole("button", { name: "Effacer définitivement" }).click();
  await expect(page.getByRole("status")).toContainText("Effacement effectué", { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("erased")).toBe("2");

  const { rows: restantes } = await pool.query("select count(*)::int as n from rum_session where app_id = $1", [APP]);
  expect(restantes[0].n).toBe(0);

  // Aucune URL demandée par le navigateur, de tout le parcours, ne porte le visiteur.
  expect(urls.length).toBeGreaterThan(3);
  expect(urls.filter((u) => u.includes(VISITEUR) || u.includes(encodeURIComponent(VISITEUR)))).toEqual([]);

  // Le journal : l'export et l'effacement, chacun avec l'empreinte tronquée, jamais l'identifiant.
  const { rows: audit } = await pool.query<{ action: string; detail: string }>(
    "select action, detail from audit_log where action like 'privacy.visitor_%' and detail like $1 order by id",
    [`%app=${APP} %`],
  );
  expect(audit.map((l) => l.action)).toEqual(["privacy.visitor_export", "privacy.visitor_erase"]);
  for (const ligne of audit) {
    expect(ligne.detail).toContain(`visitor_ref=${REF}`);
    expect(ligne.detail).not.toContain(VISITEUR);
  }
});
