// E2E — F03 : la vitrine des composants (/admin/composants).
//
// Preuve de fin du lot (plan § 6.1) : la page tient à 390 et à 1440 px sans
// débordement horizontal, et la tuile dont la référence vaut 0 écrit le texte exact
// « pas de mesure de référence non nulle » (jamais « +∞ % »). Réservée aux
// administrateurs, comme les autres pages d'administration : un viewer n'y entre pas.
//
// Aucune donnée à semer : la vitrine rend des données FIXES écrites dans la page.
// Deux comptes dédiés (admin, viewer), jamais le compte admin local de seed-admin.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const ADMIN = { email: "e2e-composants-admin@mip-rum.local", motDePasse: "e2e-composants-admin-mdp", role: "admin" };
const VIEWER = { email: "e2e-composants-viewer@mip-rum.local", motDePasse: "e2e-composants-viewer-mdp", role: "viewer" };
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const TEXTE_REFERENCE_NULLE = "pas de mesure de référence non nulle";

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

test.beforeAll(async () => {
  for (const compte of [ADMIN, VIEWER]) {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, $3, null, true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = excluded.role, apps = null, active = true`,
      [compte.email, bcryptHash(compte.motDePasse), compte.role],
    );
  }
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page, compte: { email: string; motDePasse: string }) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', compte.email);
  await page.fill('input[name="password"]', compte.motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/**
 * Éléments qui dépassent la fenêtre à droite, hors conteneur défilant — même
 * helper que tests/e2e/analyses-drilldowns.spec.ts (extrait vers helpers/ par F09).
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
      .map((el) => {
        const parent = el.parentElement;
        const repere =
          parent?.querySelector("[aria-label]")?.getAttribute("aria-label") ??
          el.closest("section, h1, h2, h3")?.textContent?.trim().slice(0, 60) ??
          el.textContent?.trim().slice(0, 60) ??
          "";
        return `${el.tagName.toLowerCase()} « ${repere} » → ${Math.round(el.getBoundingClientRect().right)} px`;
      });
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test("vitrine : aucun débordement à 390 et 1440 px, texte exact de la référence nulle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, ADMIN);
  // Toutes les largeurs sont PARCOURUES avant d'échouer : s'arrêter à la première
  // cacherait la seconde.
  const fautes: string[] = [];
  for (const largeur of [390, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(`${consoleUrl}/admin/composants`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toHaveText(/Vitrine des composants/);
    // Les graphiques recharts se dessinent après hydratation : on les attend, sinon
    // la mesure porterait sur une page sans eux.
    await expect(page.locator('[data-testid="scatter-plot"] .recharts-surface').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="line-trend"] .recharts-surface').first()).toBeVisible({ timeout: 15_000 });

    const comparaison = page.getByTestId("kpi-comparaison").filter({ hasText: TEXTE_REFERENCE_NULLE });
    await expect(comparaison).toHaveCount(1);
    await expect(comparaison).toHaveText(TEXTE_REFERENCE_NULLE);
    await expect(page.getByText(/∞|Infinity|NaN/)).toHaveCount(0);

    for (const faute of await debordements(page)) fautes.push(`/admin/composants @ ${largeur} px — ${faute}`);
  }
  expect(fautes).toEqual([]);
});

test("vitrine : chaque composant F03 est rendu, avec ses états", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto(`${consoleUrl}/admin/composants`, { waitUntil: "domcontentloaded" });
  for (const id of ["formats", "kpi-tile", "kpi-libelle", "sparkline", "figure", "scatter", "line-trend", "rank-bar", "donut", "vital-card", "delta"]) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }
  // Les états de Figure, un par un (§ 3.8).
  for (const etat of ["vide", "partiel", "erreur", "non_collecte", "echantillonne", "chargement"]) {
    await expect(page.locator(`[data-testid="figure"][data-etat="${etat}"]`)).toHaveCount(1);
  }
  await expect(page.getByTestId("kpi-tile").filter({ hasText: "personne n'est prévenu" })).toHaveAttribute("data-ton", "bad");
  await expect(page.getByTestId("series-ecartees")).toContainText("1 série non tracée");
});

test("vitrine : réservée aux administrateurs", async ({ page }) => {
  await login(page, VIEWER);
  await page.goto(`${consoleUrl}/admin/composants`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname !== "/admin/composants", { timeout: 15_000 });
  await expect(page.getByText("Vitrine des composants")).toHaveCount(0);
});
