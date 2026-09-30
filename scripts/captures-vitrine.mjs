// Captures du compte démo pour l'aperçu défilant de la vitrine (/presentation, refonte
// du 30/09/2026) : cinq écrans, pris tels que les voit un visiteur de la démo.
//
//   sante     /                 la note de santé et ses tuiles
//   pages     /pages            la vitesse par route
//   erreurs   /errors           les erreurs et les sessions touchées
//   session   /sessions/<id>    le récit d'une visite (la première de la liste)
//   tracing   /tracing          du navigateur au serveur
//
// Les étapes affichées (titres, textes, ordre) sont dans apps/console/lib/vitrine.ts ;
// ce script n'écrit que les images, sous apps/console/public/vitrine/<nom>.webp, en
// 1440 × 900 à densité 2 (2880 × 1800) : le cadre de la vitrine est au ratio 16/10.
//
// ── La commande, depuis la racine du dépôt ──
//
//   MIP_BASE=https://mip-rum-console.vercel.app node scripts/captures-vitrine.mjs
//
// Le script ouvre une session par /demo, comme un visiteur : lecture seule, sur le
// périmètre que la démo publie déjà. Il ne lit aucune base, aucune variable secrète,
// et n'écrit rien ailleurs que dans public/vitrine/. MIP_BASE vaut par défaut
// http://localhost:3000 (la démo locale demande DEMO_USER_APPS). MIP_APP (défaut
// mip-rum-console) choisit le projet ; MIP_DEMO_EMAIL (défaut demo@mip-rum.local)
// désigne la carte du compte à masquer ; PLAYWRIGHT_CHROMIUM_PATH, un Chromium.
//
// ── Garde-fous (ceux de scripts/captures-portail.mjs) : tout ou rien ──
//
//   - aucune adresse IPv4 ni électronique dans le texte affiché ;
//   - chaque écran est le bon : réponse < 400, pas de redirection, témoin visible ;
//   - chaque image pèse au plus POIDS_MAX.
// Le bandeau de la démo et le widget d'avis sont masqués : ils n'ont rien à faire
// dans un aperçu, et la vitrine dit elle-même qu'il s'agit de la démo.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fautesAffichage, feuilleMasquage } from "./captures-portail.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DOSSIER_VITRINE = join(RACINE, "apps/console/public/vitrine");
export const LARGEUR = 1440;
export const HAUTEUR = 900;
export const DENSITE = 2;
/** 400 Ko : une capture en densité 2 reste nette dans un cadre de 1 080 px, sans alourdir la page. */
export const POIDS_MAX = 400_000;

/**
 * Les cinq écrans, dans l'ordre de l'aperçu. `chemin` reçoit l'identifiant de session
 * trouvé sur /sessions ; `temoin`, un sélecteur qui prouve que c'est le bon écran.
 */
export const CAPTURES = [
  { nom: "sante", chemin: () => "/", periode: null, temoin: '[data-testid="tuile-LCP"]' },
  { nom: "pages", chemin: () => "/pages", periode: "7d", temoin: "h1" },
  { nom: "erreurs", chemin: () => "/errors", periode: "7d", temoin: "h1" },
  { nom: "session", chemin: (session) => `/sessions/${session}`, periode: "7d", temoin: "h1" },
  { nom: "tracing", chemin: () => "/tracing", periode: "7d", temoin: "h1" },
];

/** Premier identifiant de session parmi des `href` de la liste /sessions, ou `null`. */
export function premiereSession(hrefs) {
  for (const h of hrefs) {
    const m = /^\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/.exec(h);
    if (m) return m[1];
  }
  return null;
}

/** L'adresse d'un écran : son chemin, le projet, et la période s'il en a une. */
export function adresse(capture, app, session) {
  const p = new URLSearchParams({ app });
  if (capture.periode) p.set("period", capture.periode);
  return `${capture.chemin(session)}?${p}`;
}

async function principal() {
  const BASE = (process.env.MIP_BASE ?? "http://localhost:3000").replace(/\/$/, "");
  const APP = process.env.MIP_APP ?? "mip-rum-console";
  const EMAIL = process.env.MIP_DEMO_EMAIL ?? "demo@mip-rum.local";
  const feuille = `${feuilleMasquage(EMAIL)}\n[data-testid="bandeau-demo"] { display: none !important; }`;

  // sharp arrive avec Next (dépendance facultative de son optimisation d'images) : le
  // prendre là évite une dépendance de plus, et un inventaire open source à refaire.
  const requireConsole = createRequire(join(RACINE, "apps/console/package.json"));
  const sharp = createRequire(requireConsole.resolve("next/package.json"))("sharp");
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  );
  try {
    const ctx = await browser.newContext({
      viewport: { width: LARGEUR, height: HAUTEUR },
      deviceScaleFactor: DENSITE,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("mip-theme", "light");
      } catch {
        /* sans localStorage, prefers-color-scheme (émulé ci-dessus) décide */
      }
    });
    const page = await ctx.newPage();

    // 1) La session démo, comme un visiteur ; puis le projet.
    await page.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 60_000 });
    if (new URL(page.url()).pathname === "/login") throw new Error(`la démo est fermée sur ${BASE} (/demo renvoie vers /login).`);

    // 2) La session du récit : la première de la liste.
    await page.goto(`${BASE}/sessions?app=${encodeURIComponent(APP)}&period=7d`, { waitUntil: "networkidle", timeout: 60_000 });
    const session = premiereSession(await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? "")));
    if (!session) throw new Error(`aucune session listée sur /sessions pour « ${APP} » sur 7 jours.`);

    // 3) Les captures, en mémoire.
    const images = [];
    for (const capture of CAPTURES) {
      const route = adresse(capture, APP, session);
      const reponse = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
      const statut = reponse?.status() ?? 0;
      if (statut === 0 || statut >= 400) throw new Error(`${capture.nom} : ${route} a répondu ${statut || "sans réponse"}.`);
      const arrivee = new URL(page.url());
      if (arrivee.pathname !== capture.chemin(session)) throw new Error(`${capture.nom} : ${route} a redirigé vers ${arrivee.pathname}.`);
      await page.addStyleTag({ content: feuille });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(800);

      const texte = await page.evaluate(() => document.body.innerText);
      const fautes = fautesAffichage(texte);
      if (fautes.length) throw new Error(`${capture.nom} : ${fautes.join(" ; ")}. Rien n'a été écrit.`);
      if (!(await page.locator(capture.temoin).first().isVisible())) {
        throw new Error(`${capture.nom} : témoin absent (${capture.temoin}) — ce n'est pas l'écran attendu.`);
      }

      const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      const webp = await sharp(png).webp({ quality: 80, effort: 6 }).toBuffer();
      if (webp.length > POIDS_MAX) throw new Error(`${capture.nom} : ${webp.length} octets, au-delà de ${POIDS_MAX}. Rien n'a été écrit.`);
      images.push({ fichier: `${capture.nom}.webp`, webp });
      console.log(`pris : ${capture.nom} (${route}, ${webp.length} octets)`);
    }

    // 4) Tout ou rien.
    mkdirSync(DOSSIER_VITRINE, { recursive: true });
    for (const { fichier, webp } of images) writeFileSync(join(DOSSIER_VITRINE, fichier), webp);
    console.log(`${images.length} captures écrites dans ${DOSSIER_VITRINE}.`);
  } finally {
    await browser.close();
  }
}

// Exécuté seulement en commande : les tests importent les fonctions pures sans navigateur.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await principal();
  } catch (e) {
    console.error(`captures-vitrine : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
