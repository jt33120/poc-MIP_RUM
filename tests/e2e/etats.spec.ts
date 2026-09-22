// E2E — états standard (F02, § 3.8 du plan) : base de données INDISPONIBLE.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'une base injoignable se lise comme une période calme : des lectures
//     « fail-soft » rendaient `[]` ou des zéros (« Aucune session », « 0 rage
//     click » en vert, un instantané de santé à zéro).
//   - Qu'elle fasse tomber toute la console sur le message anglais de Next
//     (« Application error: a server-side exception has occurred ») : le layout
//     racine lisait la base sans aucune frontière au-dessus de lui.
// Attendu : chaque écran dit « Lecture en échec » et propose « Réessayer ».
//
// COMMENT LA PANNE EST SIMULÉE — SANS AUCUN INTERRUPTEUR DANS LE CODE DE PRODUCTION.
// Le spec lance SA PROPRE console (le build de production déjà présent dans
// `apps/console/.next`), sur un port à part, avec une `DATABASE_URL` qui vise un
// port fermé : c'est une vraie base injoignable (ECONNREFUSED), pas une imitation.
// La console partagée (port 3000) et sa base ne sont pas touchées.
//
// L'authentification ne passe pas par /login, qui lit la base : le spec signe un
// jeton de session HS256 avec le secret de SA console — ce que fait `signJwt`
// (apps/console/lib/auth.ts), sans rien contourner côté serveur.
//
// PRÉREQUIS : un build de la console de CETTE branche (`pnpm --filter console
// build`). Le `webServer` de playwright.config.ts le produit quand il démarre la
// console de test ; s'il réutilise une console déjà lancée, construire avant. Port
// de la console de panne : 3107 par défaut (`ETATS_E2E_PORT`).
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const PORT = Number(process.env.ETATS_E2E_PORT ?? 3107);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "etats-e2e-secret-local-jetable-non-production";
const METRICS_TOKEN = "etats-e2e-metrics-jetable";
const APP_ID = "etats-e2e-app";
const CONSOLE_DIR = join(process.cwd(), "apps/console");
/** Port 1 : rien n'y écoute, la connexion est refusée immédiatement. */
const BASE_INDISPONIBLE = "postgres://postgres:postgres@127.0.0.1:1/base_indisponible";

let serveur: ChildProcess | null = null;
let journal = "";

/** Jeton de session au format de `signJwt` (lib/auth.ts) : HS256, admin, toutes les apps. */
function jetonSession(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const maintenant = Math.floor(Date.now() / 1000);
  const corps = `${b64({ alg: "HS256" })}.${b64({
    email: "e2e-etats@mip-rum.local",
    role: "admin",
    apps: null,
    iat: maintenant,
    exp: maintenant + 3600,
  })}`;
  return `${corps}.${createHmac("sha256", SECRET).update(corps).digest("base64url")}`;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info) => {
  info.setTimeout(120_000);
  if (!existsSync(join(CONSOLE_DIR, ".next", "BUILD_ID"))) {
    throw new Error("etats.spec.ts exige un build de la console : lancer `pnpm --filter console build` d'abord.");
  }
  serveur = spawn(
    process.execPath,
    [join(CONSOLE_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      cwd: CONSOLE_DIR,
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_SECRET: SECRET,
        DATABASE_URL: BASE_INDISPONIBLE,
        METRICS_TOKEN,
        // Les journaux de la console de panne ne partent nulle part : ils ne
        // doivent pas polluer la page /logs de la console partagée.
        CONSOLE_LOGS_ENDPOINT: "http://127.0.0.1:1/journaux-indisponibles",
        PGPOOL_MAX: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serveur.stdout?.on("data", (d) => (journal += String(d)));
  serveur.stderr?.on("data", (d) => (journal += String(d)));

  // Prêt dès qu'il répond, quel que soit le statut : un fichier public, hors porte
  // d'authentification, qui ne lit pas la base.
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (serveur.exitCode !== null) break;
    try {
      await fetch(`${BASE}/mip-rum.js`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`console de panne injoignable sur ${BASE}\n${journal.slice(-3000)}`);
});

test.afterAll(async () => {
  serveur?.kill("SIGTERM");
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "mip_session", value: jetonSession(), url: BASE }]);
});

for (const chemin of ["/", "/pages", "/sessions"]) {
  test(`${chemin} : base indisponible → « Lecture en échec » et « Réessayer », jamais un vide`, async ({ page }) => {
    await page.goto(`${BASE}${chemin}?app=${APP_ID}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/lecture en échec/i).first()).toBeVisible({ timeout: 20_000 });
    const reessayer = page.getByRole("button", { name: "Réessayer" }).first();
    await expect(reessayer).toBeVisible();

    const corps = page.locator("body");
    await expect(corps).not.toContainText("Application error");
    await expect(corps).not.toContainText("This page could not be found");
    // Aucun vide inventé : ni « Aucune session », ni « Pas assez de données ».
    await expect(corps).not.toContainText("Aucune session sur");
    await expect(corps).not.toContainText("Pas assez de données");

    // La coquille (navigation) tient debout, et dit qu'elle est partielle.
    await expect(page.getByTestId("coquille-degradee")).toBeVisible();

    // « Réessayer » relance les lectures ; la base est toujours coupée, et l'écran
    // le redit au lieu de basculer sur un vide.
    await reessayer.click();
    await expect(page.getByText(/lecture en échec/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(corps).not.toContainText("Application error");
  });
}

test("/api/metrics : base indisponible → 503, jamais un instantané de zéros", async ({ request }) => {
  const reponse = await request.get(`${BASE}/api/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
  expect(reponse.status()).toBe(503);
  expect(await reponse.text()).not.toContain("miprum_alerts_unacked 0");
});
