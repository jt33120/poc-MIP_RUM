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
