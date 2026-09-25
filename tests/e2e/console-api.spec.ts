// C0 — la console de test est BRANCHÉE sur console-api (5ᵉ serveur de
// playwright.config.ts), comme la production le sera une fois ses trois
// variables Vercel posées.
//
// Ce que ce fichier prouve, et qu'aucun test unitaire ne peut prouver :
//   · le vrai bundle du service, sur la vraie base de l'E2E, répond derrière sa
//     garde (404 nu sans secret client, 403 à un navigateur) ;
//   · la vitrine (`/presentation`) lit l'état de la plateforme PAR console-api,
//     après une poignée de main signée — le compteur du service le dit. Sans ce
//     compteur, un repli local silencieux (C0b retombe sur la base au moindre
//     échec) ferait passer le test pour de mauvaises raisons.
import { expect, test } from "@playwright/test";
import pg from "pg";
import { sessionConsoleApi } from "./helpers/session-console-api";

const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const consoleApi = "http://localhost:4324";
const secret = process.env.E2E_CONSOLE_API_SECRET ?? "";
const jetonMetriques = process.env.E2E_CONSOLE_API_METRICS_TOKEN ?? "";

/** Le compteur d'appels du service pour une opération et un statut. */
async function compteur(operation: string, statut: string): Promise<number> {
  const res = await fetch(`${consoleApi}/metrics`, { headers: { authorization: `Bearer ${jetonMetriques}` } });
  expect(res.status, "/metrics de console-api (jeton de l'E2E)").toBe(200);
  const texte = await res.text();
  let total = 0;
  for (const ligne of texte.split("\n")) {
    if (!ligne.startsWith("console_api_requests_total{")) continue;
    if (!ligne.includes(`operation="${operation}"`) || !ligne.includes(`status="${statut}"`)) continue;
    total += Number(ligne.trim().split(/\s+/).pop());
  }
  return total;
}

test.describe("C0 — console-api dans l'E2E", () => {
  test("sans secret client : 404 nu ; avec, mais depuis un navigateur : 403", async () => {
    const sans = await fetch(`${consoleApi}/v1/public/platform-status`);
    expect(sans.status).toBe(404);
    expect(await sans.text()).toBe("");
    expect(sans.headers.get("x-mip-console-api")).toBeNull();

    const navigateur = await fetch(`${consoleApi}/v1/public/platform-status`, {
      headers: { "x-mip-client": secret, origin: "https://attaquant.test" },
    });
    expect(navigateur.status).toBe(403);
    expect(navigateur.headers.get("x-mip-console-api")).toBe("1");
    expect(navigateur.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("la vitrine lit l'état de la plateforme PAR console-api, après la poignée de main", async ({ page }) => {
    const res = await page.goto(`${consoleUrl}/presentation`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("erreur-ecran")).toHaveCount(0);
    // La réponse de console-api est gardée une minute par le cache de Next : un
    // appel au moins depuis le démarrage — la console est son SEUL client —, et
    // la poignée de main qui l'a précédé.
    await expect.poll(() => compteur("public.platformStatus", "200"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    expect(await compteur("ops.version", "200")).toBeGreaterThanOrEqual(1);
  });
});

// LA BASCULE, en mode strict (playwright.config.ts) : une session de console-api lit
// ses écrans et sa coquille, et exécute ses écritures, PAR le service. Les compteurs
// du service le prouvent — sans eux, un repli local silencieux ferait passer le test.
test.describe("la bascule — écrans, coquille et écritures par console-api", () => {
  const BASE = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum";
  const EMAIL = "e2e-bascule@mip-rum.local";
  const MOTIF = `/e2e-bascule-${Date.now()}`;

  test("la vue d'ensemble et la coquille sont lues par le service ; un objectif créé passe par sa commande", async ({ browser }) => {
    const pool = new pg.Pool({ connectionString: BASE, max: 1 });
    try {
      const jeton = await sessionConsoleApi(pool, { email: EMAIL, role: "admin", apps: null });
      const contexte = await browser.newContext();
      await contexte.addCookies([{ name: "mip_session", value: jeton, url: consoleUrl }]);
      const page = await contexte.newPage();

      const ecranAvant = await compteur("screens.overview", "200");
      const coquilleAvant = await compteur("console.shell", "200");
      const res = await page.goto(`${consoleUrl}/?app=demo-app&period=24h`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("erreur-ecran")).toHaveCount(0);
      expect(await compteur("screens.overview", "200")).toBeGreaterThan(ecranAvant);
      expect(await compteur("console.shell", "200")).toBeGreaterThan(coquilleAvant);

      const ecritureAvant = await compteur("goals.create", "200");
      await page.goto(`${consoleUrl}/goals?app=demo-app`);
      const formulaire = page.getByTestId("create-goal");
      await formulaire.locator('select[name="app"]').selectOption("demo-app");
      await formulaire.locator('input[name="name"]').fill("E2E bascule");
      await formulaire.locator('input[name="pattern"]').fill(MOTIF);
      await formulaire.getByRole("button", { name: "Créer" }).click();
      await expect(page.getByText(MOTIF).first()).toBeVisible({ timeout: 15_000 });
      expect(await compteur("goals.create", "200")).toBe(ecritureAvant + 1);
      await contexte.close();
    } finally {
      await pool.query("delete from goal where pattern = $1", [MOTIF]).catch(() => {});
      await pool.end();
    }
  });
});
