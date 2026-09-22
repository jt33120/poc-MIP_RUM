// E2E — domaine performance (plan § 6.5) : parcours et débordements des écrans Vue
// d'ensemble, Pages, Erreurs, Interactions et Satisfaction. Créé par le premier lot
// d'écran fusionné, étendu par chaque lot (un `test.describe` par lot, ajouté EN FIN
// de fichier), clos par F27.
//
// Chaque lot sème ses données dans SA propre app, dans le `beforeAll` de son bloc :
// aucun bloc ne dépend des données d'un autre. Un seul compte admin DÉDIÉ au fichier,
// jamais le compte admin local de seed-admin.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const ADMIN_EMAIL = "e2e-perf-domaine-admin@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, ADMIN_EMAIL);
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

// ——— Blocs des lots, dans l'ordre d'arrivée ———

test.describe("F18 — Erreurs : KPI, hero, répartition", () => {
  // Deux apps à ce bloc : six groupes du MÊME type « Error » (la légende doit les
  // distinguer par leur message), et une app aux seules erreurs backend, sans
  // session (sessions touchées INCONNUES, jamais 0).
  const APP = "f18-e2e-erreurs";
  const APP_BACKEND = "f18-e2e-backend";
  const OCCURRENCES = [30, 20, 12, 8, 5, 2];

  test.beforeAll(async () => {
    for (const app of [APP, APP_BACKEND]) {
      for (const t of ["rum_error", "rum_pageview", "rum_session", "error_status"]) {
        await pool.query(`delete from ${t} where app_id = $1`, [app]);
      }
      await pool.query(`insert into app_registry (app_id, name) values ($1, $2) on conflict (app_id) do nothing`, [
        app,
        `F18 ${app}`,
      ]);
    }
    for (const [i, occ] of OCCURRENCES.entries()) {
      const sid = `${APP}-s${i}`;
      const quand = `now() - interval '${30 + i * 20} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 1)`,
        [sid, APP],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/panier', ${quand})`,
        [`${sid}-pv`, sid, APP],
      );
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, ts)
         values ($1, $2, $3, '/panier', 'error', $4, 'Error', $5, $6, ${quand})`,
        [`${sid}-err`, sid, APP, `Échec du paiement, étape ${i + 1}`, `f18fp${i}aaaaaaaa`, occ],
      );
    }
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, ts)
         values ($1, null, $2, '/api/commande', 'error', 'timeout base', 'Error', 'f18backend', 1, now() - interval '${40 + i} minutes')`,
        [`${APP_BACKEND}-err${i}`, APP_BACKEND],
      );
    }
  });

  /** La tuile dont le libellé est exactement `libelle`. */
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ has: page.getByText(libelle, { exact: true }) });

  test("quatre tuiles : les occurrences sont une somme, sans « % » ni couleur de verdict", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await expect(page.getByTestId("kpi-erreurs").getByTestId("kpi-tile")).toHaveCount(4);
    const occurrences = tuile(page, "Occurrences");
    await expect(occurrences.getByTestId("kpi-valeur")).toHaveText("77");
    await expect(occurrences.getByTestId("kpi-valeur")).not.toContainText("%");
    await expect(page.getByTestId("kpi-erreurs").locator('[data-ton="bad"]')).toHaveCount(0);
    await expect(page.getByTestId("kpi-erreurs-plage")).toContainText("24 h");
    // La part nomme son dénominateur.
    await expect(tuile(page, "Part des sessions touchées")).toContainText("sur 6 sessions avec au moins une vue");
  });

  test("hero : ≤ 5 séries, légende par message — plus jamais « Error » en double", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    const hero = page.locator("#hero-erreurs");
    await hero.scrollIntoViewIfNeeded();
    // Les entrées de SÉRIES : la légende ajoute « seau en cours (barre pâle) » quand
    // le dernier seau de la fenêtre glissante n'est pas fini (le cas sous `period=24h`).
    // Ce n'est pas une série : elle n'entre pas dans le compte des ≤ 5.
    const legende = hero.getByTestId("legende-serie").locator("li:not([data-testid=legende-seau-en-cours])");
    await expect(legende).toHaveCount(5); // 4 groupes + « Autres groupes (somme) »
    const textes = (await legende.allInnerTexts()).map((t) => t.trim());
    expect(new Set(textes).size).toBe(textes.length);
    expect(textes).not.toContain("Error");
    expect(textes[0]).toContain("Échec du paiement, étape 1");
    expect(textes.at(-1)).toBe("Autres groupes (somme)");
    // Un groupe mène à son groupe ; « Autres » n'est pas un groupe, pas un lien.
    await expect(hero.getByTestId("legende-serie").getByRole("link")).toHaveCount(4);
    await expect(hero.getByTestId("legende-serie").getByRole("link").first()).toHaveAttribute("href", /^\/errors\/f18fp0/);
    await expect(hero).toContainText("4 groupes les plus fréquents sur 24 h");
  });

  test("sessions_affected null → « Inconnu », jamais 0 ; part sans vue → raison, jamais 0 %", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP_BACKEND}`);
    const sessions = tuile(page, "Sessions touchées");
    await expect(sessions).toContainText("Inconnu");
    await expect(sessions.getByTestId("kpi-valeur")).toHaveText("—");
    const part = tuile(page, "Part des sessions touchées");
    await expect(part).toContainText("aucune session avec vue");
    await expect(part.getByTestId("kpi-valeur")).toHaveText("—");
  });

  test("tuiles → liste : « Groupes apparus » restreint la liste, « Sessions touchées » la trie", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await tuile(page, "Groupes apparus sur la période").click();
    await expect(page).toHaveURL(/nouveaux=1/);
    await expect(page.locator('[data-testid^="error-group-"]')).toHaveCount(6);
    await expect(page.locator("#groupes-erreurs")).toContainText("apparus sur la période");

    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await tuile(page, "Sessions touchées").click();
    await expect(page).toHaveURL(/tri=sessions/);
    await expect(page.getByTestId("tri-sessions")).toHaveAttribute("aria-current", "true");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(`${consoleUrl}/errors?app=${APP}`);
      await expect(page.getByTestId("kpi-erreurs")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});
