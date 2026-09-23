// Enregistre la visite de la console qui illustre la vitrine publique
// (apps/console/public/portail/console-tour.mp4). Playwright filme un vrai
// parcours sur une vraie base — il n'y a pas de montage, et refaire la vidéo
// après une refonte d'écran se résume à relancer ce script.
//
// Prérequis (cf. docs/DEMO_SCRIPT.md — document commercial hors dépôt, voir
// docs/DOCUMENTS-HORS-DEPOT.md —, « Plan B hors-ligne ») : Postgres migré,
// l'ingestion sur :4318, le mini-site de démo sur :8080, du trafic généré avec
// scripts/gen-traffic.mjs, et la console servie en build de PRODUCTION sur
// :3000 — pas `next dev`, dont les compilations à la demande se voient à
// l'écran. Un compte console valide est nécessaire (scripts/seed-admin.mjs).
//
//   MIP_EMAIL=... MIP_PASSWORD=... node scripts/record-console-tour.mjs
//
// Puis encoder (H.264 pour un support universel, pas de piste audio) :
//   ffmpeg -i <sortie>/*.webm -an -c:v libx264 -profile:v high -pix_fmt yuv420p \
//          -crf 31 -preset slow -movflags +faststart \
//          apps/console/public/portail/console-tour.mp4
//   ffmpeg -ss 4 -i <sortie>/*.webm -frames:v 1 -q:v 4 \
//          apps/console/public/portail/console-tour-poster.jpg
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.MIP_BASE ?? "http://localhost:3000";
const APP = process.env.MIP_APP ?? "demo-app";
const EMAIL = process.env.MIP_EMAIL ?? "julian@mip-rum.local";
const PASSWORD = process.env.MIP_PASSWORD;
const OUT = process.env.MIP_OUT ?? "docs/captures/tour";
const W = 1280;
const H = 800;

if (!PASSWORD) {
  console.error("MIP_PASSWORD requis (mot de passe du compte console à filmer).");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// Playwright télécharge son propre Chromium ; PLAYWRIGHT_CHROMIUM_PATH permet de
// pointer un binaire déjà installé (conteneurs CI où le download est coupé).
const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launch);

// 1) La connexion se fait HORS caméra : la vidéo doit s'ouvrir sur la console,
//    pas sur un formulaire de login.
const setup = await browser.newContext({ viewport: { width: W, height: H } });
const sp = await setup.newPage();
await sp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await sp.fill('input[type="email"]', EMAIL);
await sp.fill('input[type="password"]', PASSWORD);
await Promise.all([
  sp.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {}),
  sp.click('button[type="submit"]'),
]);
if (sp.url().includes("/login")) {
  console.error("connexion refusée — vérifier MIP_EMAIL / MIP_PASSWORD.");
  process.exit(1);
}
const state = await setup.storageState();
await setup.close();

// 2) La visite, filmée.
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  storageState: state,
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
// Le widget d'avis (la console s'auto-instrumente) n'a rien à faire dans une
// vidéo produit : il flotte en bas à droite de chaque écran.
await ctx.route("**/mip-rum-feedback.js", (r) => r.abort());
// Le tutoriel d'accueil s'ouvre au premier passage et masque la moitié gauche.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("mip-tour-seen-v3", "1");
  } catch {
    /* navigation privée stricte : pas de localStorage, le tour s'ouvrira */
  }
});

const page = await ctx.newPage();
const defiler = async (y) => {
  await page.evaluate((t) => window.scrollTo({ top: t, behavior: "smooth" }), y);
  await page.waitForTimeout(1500);
};
const visiter = async (path, arrets = []) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1700);
  for (const y of arrets) await defiler(y);
};

await visiter(`/?app=${APP}`, [430, 950, 1550]); // vue d'ensemble
await visiter(`/pages?app=${APP}`, [360]); // pages lentes
await visiter(`/errors?app=${APP}`, [330]); // erreurs JS
await visiter(`/sessions?app=${APP}`, [300]); // sessions
const session = page.locator('a[href*="/sessions/"]').first();
if (await session.count()) {
  await session.click({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  await defiler(520); // timeline du parcours
}
await visiter(`/tracing?app=${APP}`, [300]); // tracing front → back
await visiter(`/alerts?app=${APP}`, [300]); // alertes
await visiter(`/?app=${APP}`, [320]); // retour à la vue d'ensemble

await page.waitForTimeout(1000);
await ctx.close(); // c'est la fermeture du contexte qui écrit le .webm
await browser.close();
console.log(`🎬 vidéo écrite dans ${OUT}/`);
