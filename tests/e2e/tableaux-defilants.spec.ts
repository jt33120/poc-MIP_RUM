// Tableaux larges et débordements à 390 px (recette du 26/09/2026).
//
// Ce que la recette a relevé : des tableaux rangés dans une carte `overflow-hidden`
// perdaient leurs colonnes de droite — souvent les ACTIONS — sans moyen de les
// atteindre (Utilisateurs, Consommation, Uptime, Audit…), d'autres défilaient sans
// que rien ne le signale, et des blocs de code portaient la fiche client à 719 px.
// Ces recettes tiennent le correctif : la page ne s'élargit pas, le tableau défile
// dans SA zone (nommée, focalisable), le défilement est annoncé tant qu'il reste
// des colonnes, et la dernière colonne s'atteint.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
// Une adresse longue, exprès : c'est elle qui élargit la colonne « Email ».
const ADMIN_EMAIL = "e2e-tableaux-defilants@mip-rum.local";
const APP = "e2e-tableaux-defilants";
let motDePasse = "";

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(
    `insert into app_registry (app_id, name, allowed_origins)
     values ($1, 'Tableaux défilants E2E', array['https://tableaux-defilants.example.fr'])
     on conflict (app_id) do update set allowed_origins = excluded.allowed_origins`,
    [APP],
  );
});

test.afterAll(async () => {
  await pool.query("delete from app_registry where app_id = $1", [APP]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
}

test.describe("à 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("utilisateurs : le tableau défile dans sa zone, le dit, et les actions s'atteignent", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/admin/users`);
    const zone = page.getByRole("region", { name: "Utilisateurs", exact: true });
    await expect(zone).toBeVisible();
    await expect(zone).toHaveAttribute("tabindex", "0");
    expect(await debordements(page)).toEqual([]);

    // Le défilement est annoncé (mesuré après hydratation) tant qu'il reste des colonnes.
    const indice = page.getByTestId("table-defilante-indice");
    await expect(indice).toHaveText("Faites défiler pour voir toutes les colonnes →", { timeout: 15_000 });
    await expect(page.getByTestId("table-defilante-ombre-droite")).toHaveCount(1);

    // Au bout de la zone : la colonne des actions est à l'écran, l'indice change de sens.
    // La zone d'abord amenée en haut de la fenêtre : depuis la recette du 26/09/2026, le
    // formulaire de création (choix des applications) la repousse sous la ligne de flottaison.
    await zone.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      el.scrollLeft = el.scrollWidth;
    });
    await expect(page.getByRole("columnheader", { name: "Actions", exact: true })).toBeInViewport();
    await expect(indice).toHaveText("← Faites défiler pour revenir aux premières colonnes");
    await expect(page.getByTestId("table-defilante-ombre-droite")).toHaveCount(0);
    await expect(page.getByTestId("table-defilante-ombre-gauche")).toHaveCount(1);
  });

  for (const [chemin, nom] of [
    ["/admin/audit", "Journal d'audit"],
    ["/admin/usage", "Consommation par application"],
    ["/admin/uptime", "Sondes"],
    ["/admin/read-tokens", "Jetons de lecture"],
    ["/admin/extension-scope", "Domaines enregistrés"],
    ["/admin/customers", "Applications"],
  ] as const) {
    test(`${chemin} : tableau dans une zone défilante nommée, page à la largeur de l'écran`, async ({ page }) => {
      await login(page);
      await page.goto(`${consoleUrl}${chemin}`);
      // Sans aucune sonde, /admin/uptime montre son état vide en carte, HORS du tableau
      // (contre-recette du 26/09/2026 : dans la cellule, il était coupé à 390 px).
      const zone = page.getByRole("region", { name: nom, exact: true });
      await expect(chemin === "/admin/uptime" ? zone.or(page.getByTestId("uptime-vide")) : zone).toBeVisible();
      // Les listes d'applications à long libellé ne poussent plus la page (417 px avant).
      expect(await debordements(page), chemin).toEqual([]);
    });
  }

  test("fiche client : les blocs de code défilent au lieu d'élargir la page (719 px avant)", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/admin/customers/${APP}`);
    const bloc = page.locator("pre").first();
    await expect(bloc).toBeVisible();
    expect(await debordements(page)).toEqual([]);
    // Le snippet est plus large que l'écran : c'est le bloc qui défile, pas la page.
    expect(await bloc.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

test("l'annonce suit la largeur : présente à 390 px, retirée à 1 440 px où le tableau tient", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`${consoleUrl}/admin/users`);
  // À 390 px, l'annonce prouve que la mesure a eu lieu (après hydratation).
  const indice = page.getByTestId("table-defilante-indice");
  await expect(indice).toBeVisible({ timeout: 15_000 });
  // Élargie, la fenêtre redimensionne la zone : l'observateur retire l'annonce et l'ombre.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(indice).toHaveCount(0);
  await expect(page.locator('[data-testid^="table-defilante-ombre"]')).toHaveCount(0);
});
