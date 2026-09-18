// E2E P5.5 — issues d'erreurs : liste, détail et anciennes URL.
//
// Jeu semé en SQL (les clés de regroupement sont prouvées ailleurs, par
// tests/unit/error-grouping-v2.test.ts et tests/integration/error-issues-sql.test.ts).
// Ce spec prouve ce que l'ÉCRAN en fait :
//   • la liste /errors d'une app activée montre ses issues et le groupe historique
//     qu'aucune issue ne reprend, chaque occurrence comptée une fois ;
//   • une ancienne URL à alias unique mène à l'issue, une empreinte répartie fait
//     choisir, et le détail historique reste à un lien ;
//   • une app non activée garde sa liste et ses URL historiques ;
//   • un retour arrière rend la liste historique sans casser l'URL d'une issue ;
//   • clavier et absence de débordement à 390/768/1440 px.
//
// Utilisateur admin DÉDIÉ, app explicite dans chaque URL (jamais le cookie projet).
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import pg from "pg";

const CONSOLE = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const E2E_EMAIL = "e2e-error-issues@mip-rum.local";
const E2E_PASSWORD = "e2e-error-issues-mdp-local";

const A = "p55-e2e-a";
const OFF = "p55-e2e-off";
const APPS = [A, OFF];
const I1 = "55e2e000-0000-4000-8000-000000000001";
const I2 = "55e2e000-0000-4000-8000-000000000002";

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
  for (const table of ["error_issue", "error_grouping_config", "error_status", "rum_error", "rum_session", "app_registry"])
    await pool.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

async function semer() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into app_registry (app_id, name, active, internal)
       select app, app, true, false from unnest($1::text[]) as app
       on conflict (app_id) do update set active = true, internal = false`,
      [APPS],
    );
    await client.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, visitor_id, sample_rate, error_sample_rate)
       values ('p55-e2e-s1', $1, 'desktop', false, 'p55-vis-1', 1, 1),
              ('p55-e2e-off-s1', $2, 'desktop', false, 'p55-vis-2', 1, 1)`,
      [A, OFF],
    );
    await client.query(
      `insert into error_issue (id, app_id, grouping_version, grouping_key, grouping_basis, origin, status, status_source,
                                first_seen, last_seen, first_release, last_release)
       values ($1, $3, 2, '55e2e0000000000000000000000000a1', 'symbolicated_frame', 'migration', 'for_review', 'migration',
               now() - interval '3 days', now() - interval '5 minutes', '1.0.0', '1.1.0'),
              ($2, $3, 2, '55e2e0000000000000000000000000a2', 'normalized_frame', 'new', 'open', 'system',
               now() - interval '10 minutes', now() - interval '10 minutes', '1.1.0', '1.1.0')`,
      [I1, I2, A],
    );
    await client.query(
      `insert into error_issue_alias (app_id, legacy_fingerprint, issue_id, legacy_status)
       values ($1, 'p55fp001', $2, 'resolved'), ($1, 'p55fp003', $2, 'ignored'),
              ($1, 'p55fp002', $2, null), ($1, 'p55fp002', $3, null)`,
      [A, I1, I2],
    );
    await client.query(
      `insert into error_status (app_id, fingerprint, status, resolved_at, note)
       values ($1, 'p55fp001', 'resolved', now() - interval '2 days', 'corrigé en 1.0.1'),
              ($1, 'p55fp003', 'ignored', null, 'bruit connu')`,
      [A],
    );
    // [nom, app, empreinte, issue, occurrences, âge]
    const lignes: [string, string, string, string | null, number, string][] = [
      ["r1", A, "p55fp001", I1, 3, "5 minutes"],
      ["r2", A, "p55fp003", I1, 2, "6 minutes"],
      // Antérieure à l'activation, reprise par l'alias UNIQUE de p55fp001.
      ["r3", A, "p55fp001", null, 2, "20 hours"],
      ["r4", A, "p55fp002", I2, 2, "10 minutes"],
      ["r5", A, "p55fp009", null, 1, "30 minutes"],
      ["r6", A, "p55fp002", I1, 1, "7 minutes"],
      ["r7", OFF, "p55fp101", null, 4, "15 minutes"],
    ];
    for (const [nom, app, fp, issue, occ, age] of lignes) {
      await client.query(
        `insert into rum_error (app_id, fingerprint, session_id, occurrences, error_type, message, kind, release,
                                grouping_version, grouping_key, grouping_basis, issue_id, ts)
         values ($1, $2, $3, $4, 'TypeError', $5, 'error', '1.1.0', $6, $7, $8, $9, now() - $10::interval)`,
        [
          app, fp, app === A ? "p55-e2e-s1" : "p55-e2e-off-s1", occ, `boom e2e ${nom}`,
          issue ? 2 : null, issue === I1 ? "55e2e0000000000000000000000000a1" : issue === I2 ? "55e2e0000000000000000000000000a2" : null,
          issue === I1 ? "symbolicated_frame" : issue === I2 ? "normalized_frame" : null, issue, age,
        ],
      );
    }
    await client.query("select error_grouping_activate($1, 'e2e@p55.test')", [A]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

test.beforeAll(async () => {
  const { rows: [{ v72 }] } = await pool.query<{ v72: boolean }>(
    `select exists(select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rum_error' and column_name = 'issue_id') as v72`,
  );
  expect(v72, "la base E2E doit porter migration-v72 (schéma + toutes les migrations)").toBe(true);
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await nettoyer();
  await semer();
});

test.afterAll(async () => {
  await nettoyer();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${CONSOLE}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

const entree = (page: Page, testid: string) => page.locator(`[data-testid="${testid}"]`);
const introuvable = (page: Page) => expect(page.getByText("This page could not be found")).toBeVisible();

test("liste d'une app activée : issues et groupe historique, chaque occurrence comptée une fois", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h`);

  const i1 = entree(page, `issue-entry-${I1}`);
  await expect(i1.getByTestId("entry-occurrences")).toHaveText("8");
  await expect(i1).toContainText("À revoir");
  await expect(i1).toContainText("reprise de l'historique");
  await expect(entree(page, `issue-entry-${I2}`).getByTestId("entry-occurrences")).toHaveText("2");
  const historique = entree(page, "legacy-entry-p55fp009");
  await expect(historique.getByTestId("entry-occurrences")).toHaveText("1");
  await expect(historique).toContainText("groupe historique");
  await expect(page.getByText("Occurrences · 24 h", { exact: true }).locator("..")).toContainText("11");
  // À revoir d'abord (la table repliée de la tendance a aussi des lignes : on vise les entrées).
  await expect(page.locator('tr[data-testid^="issue-entry-"], tr[data-testid^="legacy-entry-"]').first())
    .toHaveAttribute("data-testid", `issue-entry-${I1}`);
  await expect(i1.getByRole("link")).toHaveAttribute("href", `/errors/issues/${I1}?app=${A}`);
  await expect(historique.getByRole("link")).toHaveAttribute("href", `/errors/p55fp009?app=${A}`);

  // Filtre de statut : l'entrée, pas ses nombres.
  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h&status=open`);
  await expect(entree(page, `issue-entry-${I2}`).getByTestId("entry-occurrences")).toHaveText("2");
  await expect(entree(page, `issue-entry-${I1}`)).toHaveCount(0);
});

test("ancienne URL à alias unique : redirection vers l'issue, groupes historiques et notes relus", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/p55fp001?app=${A}&period=24h`);
  await expect(page).toHaveURL(new RegExp(`/errors/issues/${I1}\\?app=${A}$`));

  await expect(page.getByTestId("issue-status")).toHaveText("À revoir");
  await expect(page.getByTestId("issue-origin")).toBeVisible();
  await expect(page.getByTestId("issue-occurrences")).toHaveText("8");
  const groupes = page.getByTestId("issue-legacy-groups");
  await expect(groupes).toContainText("corrigé en 1.0.1");
  await expect(groupes).toContainText("bruit connu");
  await expect(groupes.getByRole("row").filter({ hasText: "p55fp002" })).toContainText("répartie sur 2 issues");
  await expect(groupes.getByRole("link", { name: "p55fp001" })).toHaveAttribute("href", `/errors/p55fp001?app=${A}&legacy=1`);
});

test("empreinte répartie : choix explicite entre les issues, détail historique à un lien", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/p55fp002?app=${A}&period=24h`);
  const choix = page.getByTestId("error-issue-chooser");
  await expect(choix.getByRole("heading")).toHaveText("Ce groupe est réparti sur plusieurs issues");
  await expect(choix.getByRole("link", { name: `issue ${I1}` })).toHaveAttribute("href", `/errors/issues/${I1}?app=${A}`);
  await expect(choix.getByRole("link", { name: `issue ${I2}` })).toHaveAttribute("href", `/errors/issues/${I2}?app=${A}`);

  await choix.getByRole("link", { name: "Voir le détail historique de la signature" }).click();
  await expect(page).toHaveURL(new RegExp(`/errors/p55fp002\\?app=${A}&legacy=1$`));
  // La vue historique compte toutes les lignes de la signature, quelle que soit leur issue.
  await expect(page.getByTestId("detail-occurrences")).toHaveText("3");
});

test("app non activée : liste et URL historiques inchangées", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors?app=${OFF}&period=24h`);
  await expect(page.locator(`[data-testid="error-group-p55fp101"][data-app-id="${OFF}"]`).getByTestId("group-occurrences")).toHaveText("4");
  await page.goto(`${CONSOLE}/errors/p55fp101?app=${OFF}&period=24h`);
  await expect(page.getByTestId("detail-occurrences")).toHaveText("4");
});

test("détail d'issue : l'app de l'URL est ramenée à celle de l'issue ; inconnue, elle n'existe pas", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/issues/${I2}?app=${OFF}&period=7d`);
  await expect(page).toHaveURL(new RegExp(`/errors/issues/${I2}\\?app=${A}&period=7d$`));
  await expect(page.getByTestId("issue-status")).toHaveText("Ouverte");

  await page.goto(`${CONSOLE}/errors/issues/55e2e000-0000-4000-8000-00000000dead?app=${A}&period=24h`);
  await introuvable(page);
});

test("clavier : une entrée de liste s'ouvre au clavier", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h`);
  const lien = entree(page, `issue-entry-${I2}`).getByRole("link");
  await lien.focus();
  await expect(lien).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/errors/issues/${I2}\\?app=${A}$`));
  await expect(page.getByTestId("issue-occurrences")).toHaveText("2");
});

/**
 * Débordement horizontal de la page : vide s'il n'y en a pas, sinon la mesure et
 * les éléments qui dépassent, boîtes absolues comprises (un `.sr-only` sans
 * ancêtre positionné échappe à son conteneur défilant).
 */
async function debordements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const totale = document.documentElement.scrollWidth;
    if (totale <= largeur) return [];
    const dansDefilant = (el: Element) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX)) return true;
      }
      return false;
    };
    const fautifs = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= largeur + 1) return false;
        return ["absolute", "fixed"].includes(getComputedStyle(el).position) || !dansDefilant(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("class") ?? ""}] → ${Math.round(el.getBoundingClientRect().right)} px`);
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

for (const width of [390, 768, 1440]) {
  test(`issues : aucun débordement horizontal de la page à ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    for (const path of [
      `/errors?app=${A}&period=24h`,
      `/errors/issues/${I1}?app=${A}&period=24h`,
      `/errors/p55fp002?app=${A}&period=24h`,
    ]) {
      await page.goto(`${CONSOLE}${path}`);
      await expect(page.locator("main")).toBeVisible();
      expect(await debordements(page), path).toEqual([]);
    }
  });
}

test("retour arrière : liste et anciennes URL historiques, l'issue reste lisible", async ({ page }) => {
  await pool.query("select error_grouping_deactivate($1, 'e2e@p55.test')", [A]);
  try {
    await login(page);
    await page.goto(`${CONSOLE}/errors?app=${A}&period=24h`);
    await expect(page.locator(`[data-testid="error-group-p55fp001"][data-app-id="${A}"]`).getByTestId("group-occurrences")).toHaveText("5");
    await expect(entree(page, `issue-entry-${I1}`)).toHaveCount(0);

    await page.goto(`${CONSOLE}/errors/p55fp001?app=${A}&period=24h`);
    await expect(page).toHaveURL(new RegExp(`/errors/p55fp001\\?app=${A}&period=24h$`));
    await expect(page.getByTestId("detail-occurrences")).toHaveText("5");

    await page.goto(`${CONSOLE}/errors/issues/${I1}?app=${A}&period=24h`);
    await expect(page.getByTestId("issue-status")).toHaveText("À revoir");
    await expect(page.getByText("Regroupement v2 désactivé pour cette application")).toBeVisible();
  } finally {
    await pool.query("select error_grouping_activate($1, 'e2e@p55.test')", [A]);
  }
});
