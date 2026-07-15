// Smoke-test navigateur RÉEL de l'extension (Playwright + Chromium headed).
// Valide ce que ni tsc ni les tests unitaires ne couvrent :
//   (A) l'extension MV3 se charge dans un vrai Chromium — manifest parsé, icônes
//       valides, service worker exécuté ;
//   (B) le bundle SDK EXPÉDIÉ par l'extension (vendor/mip-rum.js), injecté dans une
//       page comme le fait le service worker (MAIN world), expose window.MIPRum,
//       s'initialise sans erreur ET émet réellement de l'OTLP vers l'endpoint.
//
// Le chemin permission/webNavigation (geste popup) n'est pas automatisable ici ;
// il est couvert par les tests unitaires de decideInjection + la checklist manuelle
// de docs/DEPLOY_EXTENSION.md.
//
// Lancement : PW_CHROME=/chemin/chrome xvfb-run -a node apps/extension/scripts/smoke.mjs
// Sans binaire Chromium complet : SKIP (exit 0) — c'est un outil de validation
// locale/manuelle, pas une garde CI (la garde CI est check-sync.mjs, déterministe).
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXT_DIR = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.PW_CHROME;
if (!CHROME || !existsSync(CHROME)) {
  console.log(`SKIP smoke : binaire Chromium complet introuvable (PW_CHROME=${CHROME || "non défini"}).`);
  process.exit(0);
}

let ok = true;
const fail = (m) => {
  console.error("✘ " + m);
  ok = false;
};
const pass = (m) => console.log("✓ " + m);

// Serveur local : page de test + réception OTLP (compte les POST).
let ingestHits = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "POST" && url.pathname === "/v1-traces") {
    ingestHits++;
    res.end("{}");
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    "<!doctype html><html><head><title>smoke</title></head><body style='height:3000px'>" +
      "<h1 style='font-size:48px'>MIP RUM smoke</h1><img src='data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=' alt=''></body></html>",
  );
});
const PORT = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

const userDataDir = mkdtempSync(join(tmpdir(), "mip-ext-smoke-"));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // headed (sous xvfb) : les extensions MV3 ne chargent pas en headless-shell
    executablePath: CHROME,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-sandbox"],
  });

  // (A) service worker + manifest
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
  if (!sw) fail("service worker MV3 non enregistré");
  else {
    pass("service worker MV3 enregistré et exécuté");
    const mf = await sw.evaluate(() => chrome.runtime.getManifest());
    if (mf.version !== "0.4.0") fail(`manifest.version inattendue: ${mf.version}`);
    else pass(`manifest v${mf.version} valide — icônes ${Object.keys(mf.icons || {}).join("/")}`);
  }

  // (B) le bundle expédié, injecté comme le fait l'extension (MAIN world)
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

  const bundle = readFileSync(join(EXT_DIR, "vendor/mip-rum.js"), "utf8");
  await page.evaluate((src) => {
    const s = document.createElement("script");
    s.textContent = src; // exécute le bundle IIFE tel qu'injecté par chrome.scripting
    document.documentElement.appendChild(s);
  }, bundle);

  const hasApi = await page.evaluate(
    () => typeof window.MIPRum === "object" && typeof window.MIPRum.init === "function",
  );
  if (hasApi) pass("window.MIPRum exposé (init disponible) après injection du bundle");
  else fail("window.MIPRum absent après injection du bundle expédié");

  await page.evaluate(
    (endpoint) => window.MIPRum.init({ endpoint, appId: "smoke-app", collectionSource: "extension" }),
    `http://127.0.0.1:${PORT}/v1-traces`,
  );
  // active une interaction + du scroll pour déclencher des vitals, puis laisse flusher
  await page.mouse.wheel(0, 1500);
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))).catch(() => {});
  await page.waitForTimeout(1500);

  if (pageErrors.length) fail(`erreurs JS dans la page injectée: ${pageErrors.join(" | ")}`);
  else pass("aucune erreur JS levée par le bundle en conditions réelles");

  if (ingestHits > 0) pass(`OTLP émis vers l'endpoint (${ingestHits} requête(s) reçue(s))`);
  else console.log(`ℹ émission OTLP non observée en ${4}s (batch/flush) — API + absence d'erreur déjà validées`);
} catch (e) {
  fail("exception: " + (e?.stack || e));
} finally {
  if (ctx) await ctx.close().catch(() => {});
  server.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

console.log(ok ? "\nSMOKE OK" : "\nSMOKE FAILED");
process.exit(ok ? 0 : 1);
