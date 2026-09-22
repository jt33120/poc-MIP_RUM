// E2E — F08 : vues préréglées (`PresetBar`, plan § 3.6, P13).
//
// Joué sur la vitrine /admin/composants (section « PresetBar ») : F08 ne branche la
// barre sur aucun écran (F11, F17, F20, F38, F41, F44 le feront), la vitrine en rend
// une sur des vues calculées à partir de données FIXES.
//
// Ce que le lot promet :
//   - appliquer « Mobile » ne modifie QUE `device` : plage, segment, comparaison et
//     réglages d'affichage restent tels quels, et aucun paramètre `vue` n'est ajouté ;
//   - la vue appliquée est marquée active (`aria-current`) ;
//   - une vue incalculable est rendue désactivée, avec sa raison, et n'est pas un lien.
//
// Un compte admin DÉDIÉ, jamais le compte admin local de seed-admin.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const ADMIN_EMAIL = "e2e-presets-admin@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const VITRINE = `${consoleUrl}/admin/composants`;

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

/** Paramètres de l'URL courante, dans un objet (un paramètre répété serait une faute). */
function parametres(page: Page): Record<string, string> {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

test("appliquer « Mobile » ne modifie que device", async ({ page }) => {
  await login(page);
  const depart = {
    period: "7d",
    device: "desktop",
    browser: "Chrome",
    seg: "v2:country:eq:FR",
    cmp: "release",
    tri: "volume",
  };
  await page.goto(`${VITRINE}?${new URLSearchParams(depart)}`);

  const barre = page.locator("#vitrine-presets [data-testid=preset-bar]");
  const mobile = barre.locator('[data-vue="p:mobile"]');
  await mobile.scrollIntoViewIfNeeded();
  await expect(mobile).not.toHaveAttribute("aria-current", "true");
  // Desktop est la vue de l'URL de départ : elle est active.
  await expect(barre.locator('[data-vue="p:desktop"]')).toHaveAttribute("aria-current", "true");

  await mobile.click();
  await page.waitForURL((u) => u.searchParams.get("device") === "mobile", { timeout: 15_000 });

  expect(new URL(page.url()).pathname).toBe("/admin/composants");
  expect(parametres(page)).toEqual({ ...depart, device: "mobile" });
  await expect(barre.locator('[data-vue="p:mobile"]')).toHaveAttribute("aria-current", "true");
  await expect(barre.locator('[data-vue="p:desktop"]')).not.toHaveAttribute("aria-current", "true");
});

test("une vue incalculable est désactivée, avec sa raison, et n'est pas un lien", async ({ page }) => {
  await login(page);
  await page.goto(VITRINE);
  const vue = page.locator('#vitrine-presets-indisponibles [data-vue="p:release-vs-precedente"]');
  await vue.scrollIntoViewIfNeeded();
  await expect(vue).toHaveAttribute("aria-disabled", "true");
  await expect(vue).toHaveAttribute("title", "moins de deux releases sur la fenêtre");
  expect(await vue.evaluate((el) => el.tagName)).not.toBe("A");
  await expect(vue).toContainText("indisponible : moins de deux releases sur la fenêtre");
});
