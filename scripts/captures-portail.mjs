// Captures de la console pour la vitrine publique /presentation (plan § 8.3, lot P**.7).
//
//   overview-light.png, overview-dark.png   /                          V-A, en-tête de la vitrine (PS0)
//   issue-light.png,    issue-dark.png      /errors/issues/<issue>     V-B, illustre K1
//   mobile-light.png                        /mobile                    V-C, « Non collecté » (K10, PS8)
//
// Toutes en 1440 × 900 (le cadre de la vitrine est au ratio 8/5), écrites dans
// apps/console/public/portail/ avec manifest.json : route, thème, dimensions, jour de
// la prise, commit et jeu de données de chaque image. La légende de la vitrine lit sa
// date dans ce manifeste (lib/portail-manifeste.ts) ; sans lui, elle n'en porte aucune.
//
// ── Ce qui doit tourner AVANT (prérequis de scripts/record-console-tour.mjs:6-12) ──
//
//   1. Postgres local migré (postgres://postgres:postgres@localhost:5433/mip_rum),
//      l'ingestion sur :4318 et le mini-site de démo sur :8080 — la pile que
//      playwright.config.ts démarre (`node services/collector/dev-server.mjs`,
//      `node demo/serve.mjs`).
//   2. Du trafic de démonstration RÉCENT (fenêtre par défaut des écrans : 24 h) :
//        node scripts/gen-traffic.mjs 12        # une session sur deux lève une erreur
//   3. La console en build de PRODUCTION sur :3000, construite depuis le commit à
//      capturer — pas `next dev`, dont les compilations à la demande se voient :
//        pnpm --filter console build
//        AUTH_SECRET=e2e-secret-local-jetable-non-production pnpm --filter console start
//   4. Pour V-B, au moins une issue listée sur /errors pour MIP_APP. La liste ne passe
//      aux issues que si le regroupement v2 est actif pour l'app, et seules les
//      occurrences reçues APRÈS l'activation sont rattachées à une issue. Sur la base
//      LOCALE seulement, si ce n'est pas le cas :
//        insert into error_grouping_config (app_id, active_version, activated_at, activated_by)
//        values ('demo-app', 2, now(), 'captures-portail')
//        on conflict (app_id) do update set active_version = 2, activated_at = now(),
//          activated_by = 'captures-portail', deactivated_at = null, deactivated_by = null;
//      puis relancer l'étape 2. (Ou désigner l'issue : MIP_ISSUE=<uuid>.)
//
// ── La commande, depuis la racine du dépôt ──
//
//   node scripts/captures-portail.mjs
//
// Sans MIP_EMAIL ni MIP_PASSWORD, le script crée (ou réactive) dans la base LOCALE un
// compte DÉDIÉ, captures-portail@mip-rum.local, lecteur (viewer) limité à MIP_APP, au
// mot de passe fixe et local — la méthode de tests/e2e/helpers/compte-dedie.ts. Il ne
// touche jamais au compte d'un humain et ne lance pas scripts/seed-admin.mjs, qui en
// réécrit le mot de passe. LECTEUR, pas admin : une image publique montre la console
// en lecture seule, comme la démo ; un admin verrait sur l'issue le formulaire de
// triage et la liste des comptes assignables, adresses comprises (le garde-fou
// arrêterait alors la capture).
// Avec MIP_EMAIL et MIP_PASSWORD (un compte créé par scripts/seed-admin.mjs, comme le
// dit le plan), il se connecte avec eux et ne touche à aucune base.
//
// Variables : MIP_BASE (défaut http://localhost:3000), MIP_APP (défaut demo-app),
// MIP_EMAIL + MIP_PASSWORD (facultatifs, ensemble), MIP_ISSUE (facultatif : l'issue
// de V-B, sinon la première de la liste), MIP_CAPTURES_DB (base du compte dédié,
// défaut postgres://postgres:postgres@localhost:5433/mip_rum ; toute base non locale
// est refusée), PLAYWRIGHT_CHROMIUM_PATH. DATABASE_URL n'est JAMAIS lu : celui du
// .env de la racine désigne la production.
//
// ── Garde-fous : si l'un échoue, le script s'arrête en erreur et N'ÉCRIT RIEN ──
//
// Les cinq images sont prises en mémoire ; les fichiers ne sont écrits qu'une fois
// toutes vérifiées, le manifeste en dernier.
//   - Aucune adresse IPv4 ni électronique dans le texte affiché (document.body.innerText)
//     — invariant « ni identité brute ni IP à l'écran » (plan § 1.3, V9). L'adresse
//     du compte connecté, dans la barre latérale, est masquée avant la vérification :
//     elle n'a rien à faire sur une image publique. Un faux positif (numéro de version
//     à quatre segments) arrête aussi : à regarder, pas à contourner.
//   - Chaque écran est le bon : réponse < 400, pas de redirection, thème appliqué
//     (classe `dark` sur <html> exactement pour les captures sombres), et son témoin
//     visible (V-C doit afficher « Non collecté », sinon elle n'illustre rien).
//   - Chaque image pèse au plus 250 Ko (250 000 octets ; celles d'avant P**.7 : 120-122 Ko).
// Le widget « Votre avis ? » est masqué par une feuille de style injectée : ses deux
// éléments portent data-mip-rum-ui="feedback-button" / "feedback-panel"
// (apps/console/public/mip-rum-feedback.js:79, :226, :249).
//
// ── Après ──
//
//   - Reconstruire la console : `next start` ne sert que les fichiers de public/
//     présents au build (les images d'issue et du mobile sont nouvelles).
//   - `pnpm test:unit` (tests/unit/portail-visuels.test.ts : chaque fichier cité et
//     ≤ 250 Ko) et la recette TP8 : la légende porte désormais une date.
//   - Regarder les cinq images, relire l'alt de la vue d'ensemble
//     (components/presentation/Landing.tsx) contre la nouvelle capture, versionner
//     images ET manifeste dans le même commit.
//   - Si le regroupement v2 a été activé pour l'étape 4, le désactiver (base locale) :
//       update error_grouping_config set active_version = null, deactivated_at = now(),
//         deactivated_by = 'captures-portail' where app_id = 'demo-app';
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Où la vitrine lit ses images. */
export const DOSSIER_PORTAIL = join(RACINE, "apps/console/public/portail");
export const LARGEUR = 1440;
export const HAUTEUR = 900;
/** 250 Ko, en octets : le seuil du plan (§ 8.3, point 6), tenu aussi par tests/unit/portail-visuels.test.ts. */
export const POIDS_MAX = 250_000;
/** Le script qui produit le trafic capturé (champ `jeu` du manifeste). */
export const JEU = "scripts/gen-traffic.mjs";
export const COMPTE_DEDIE = "captures-portail@mip-rum.local";

/**
 * Les cinq images : une vue, ses thèmes, et le témoin qui prouve que l'écran capturé
 * est le bon. `issue` est l'identifiant choisi pour V-B.
 */
export const VUES = [
  { nom: "overview", chemin: () => "/", themes: ["light", "dark"], temoin: { selecteur: "h1" } },
  {
    nom: "issue",
    chemin: (issue) => `/errors/issues/${issue}`,
    themes: ["light", "dark"],
    temoin: { selecteur: '[data-testid="issue-status"]' },
  },
  { nom: "mobile", chemin: () => "/mobile", themes: ["light"], temoin: { texte: "Non collecté" } },
];

const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
const COURRIEL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

/**
 * Ce qu'un texte affiché ne doit pas contenir (plan § 8.3, point 4) : une adresse IPv4
 * ou électronique. Rend la liste des fautes, vide si rien. D'une adresse électronique,
 * seul le domaine est recopié dans le message.
 */
export function fautesAffichage(texte) {
  const fautes = [];
  const ip = IPV4.exec(texte);
  if (ip) fautes.push(`adresse IPv4 affichée (« ${ip[0]} »)`);
  const courriel = COURRIEL.exec(texte);
  if (courriel) fautes.push(`adresse électronique affichée (« …@${courriel[0].split("@")[1]} »)`);
  return fautes;
}

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Largeur et hauteur d'un PNG, lues dans son bloc IHDR (juste après la signature). */
export function dimensionsPng(png) {
  if (png.length < 24 || SIGNATURE_PNG.some((o, i) => png[i] !== o) || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("ce n'est pas une image PNG");
  }
  return { largeur: png.readUInt32BE(16), hauteur: png.readUInt32BE(20) };
}

/** Jour AAAA-MM-JJ de `instant` à Paris : la vitrine est lue en France. */
export function jourDeParis(instant) {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parties.year}-${parties.month}-${parties.day}`;
}

/** Une entrée du manifeste, au format que lit lib/portail-manifeste.ts. */
export function entreeManifeste({ fichier, route, theme, png, date, sha }) {
  const { largeur, hauteur } = dimensionsPng(png);
  return { fichier, route, theme, largeur, hauteur, date, sha, jeu: JEU };
}

/**
 * Les fautes d'un lot d'images avant écriture : dimensions attendues, poids ≤ POIDS_MAX.
 * `captures` : `{ fichier, png }[]`.
 */
export function fautesImages(captures) {
  const fautes = [];
  for (const { fichier, png } of captures) {
    const { largeur, hauteur } = dimensionsPng(png);
    if (largeur !== LARGEUR || hauteur !== HAUTEUR) {
      fautes.push(`${fichier} : ${largeur} × ${hauteur}, attendu ${LARGEUR} × ${HAUTEUR}`);
    }
    if (png.length > POIDS_MAX) fautes.push(`${fichier} : ${png.length} octets, au-delà de ${POIDS_MAX}`);
  }
  return fautes;
}

/** Premier identifiant d'issue parmi des `href` de la liste /errors, ou `null`. */
export function premiereIssue(hrefs) {
  for (const h of hrefs) {
    const m = /^\/errors\/issues\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/.exec(h);
    if (m) return m[1];
  }
  return null;
}

/**
 * Feuille injectée avant la vérification et la capture : le widget d'avis, et la
 * carte du compte connecté (son adresse électronique) dans la barre latérale.
 */
export function feuilleMasquage(email) {
  const titre = email.replace(/["\\]/g, "\\$&");
  return [
    '[data-mip-rum-ui^="feedback-"] { display: none !important; }',
    `div:has(> span > [title="${titre}"]) { display: none !important; }`,
  ].join("\n");
}

/** Commit du dépôt, suffixé `-dirty` si un fichier suivi est modifié hors public/portail/. */
function commitCourant() {
  const git = (...args) => execFileSync("git", args, { cwd: RACINE, encoding: "utf8" }).trim();
  const sha = git("rev-parse", "--short=7", "HEAD");
  const modifie = git("status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)apps/console/public/portail");
  return modifie ? `${sha}-dirty` : sha;
}

/** Le compte dédié, dans la base locale : lecteur de `app`, créé ou réactivé, mot de passe fixe et local. */
async function compteDedie(app) {
  const url = process.env.MIP_CAPTURES_DB ?? "postgres://postgres:postgres@localhost:5433/mip_rum";
  const hote = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hote)) {
    throw new Error(`MIP_CAPTURES_DB désigne une base non locale (${hote}) : refus. Le compte dédié ne se crée qu'en local.`);
  }
  const requireConsole = createRequire(join(RACINE, "apps/console/package.json"));
  const bcryptMod = requireConsole("bcryptjs");
  const bcrypt = bcryptMod.hashSync ? bcryptMod : bcryptMod.default;
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url });
  const motDePasse = `mdp-local-${COMPTE_DEDIE.split("@")[0]}`;
  try {
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array[$3], true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
      [COMPTE_DEDIE, bcrypt.hashSync(motDePasse, 10), app],
    );
  } finally {
    await pool.end();
  }
  return { email: COMPTE_DEDIE, motDePasse };
}

async function identifiants(app) {
  const { MIP_EMAIL: email, MIP_PASSWORD: motDePasse } = process.env;
  if (email && motDePasse) return { email, motDePasse };
  if (email || motDePasse) throw new Error("MIP_EMAIL et MIP_PASSWORD vont ensemble (ou aucun des deux : compte dédié local).");
  return compteDedie(app);
}

async function principal() {
  const BASE = process.env.MIP_BASE ?? "http://localhost:3000";
  const APP = process.env.MIP_APP ?? "demo-app";
  const { email, motDePasse } = await identifiants(APP);
  const feuille = feuilleMasquage(email);

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  );
  try {
    // 1) Connexion HORS capture (record-console-tour.mjs:44-50), projet posé par cookie.
    const reglage = await browser.newContext({ viewport: { width: LARGEUR, height: HAUTEUR } });
    const accueil = await reglage.newPage();
    await accueil.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await accueil.fill('input[type="email"]', email);
    await accueil.fill('input[type="password"]', motDePasse);
    await Promise.all([
      accueil.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }).catch(() => {}),
      accueil.click('button[type="submit"]'),
    ]);
    if (new URL(accueil.url()).pathname === "/login") {
      throw new Error("connexion refusée : vérifier MIP_EMAIL / MIP_PASSWORD, ou la base du compte dédié.");
    }
    await reglage.addCookies([{ name: "mip-project", value: APP, url: BASE }]);
    const session = await reglage.storageState();

    // 2) L'issue de V-B : désignée, ou la première que liste /errors pour l'app.
    let issue = process.env.MIP_ISSUE ?? null;
    if (issue && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(issue)) {
      throw new Error(`MIP_ISSUE n'est pas un identifiant d'issue : « ${issue} ».`);
    }
    if (!issue) {
      await accueil.goto(`${BASE}/errors?app=${encodeURIComponent(APP)}`, { waitUntil: "networkidle", timeout: 60_000 });
      issue = premiereIssue(await accueil.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? "")));
      if (!issue) {
        throw new Error(
          `aucune issue listée sur /errors pour « ${APP} » : le regroupement v2 n'y est pas actif, ou aucune erreur ` +
            "n'est arrivée depuis son activation. Voir l'étape 4 des prérequis, en tête de ce script.",
        );
      }
    }
    await reglage.close();

    // 3) Les captures, en mémoire. Un contexte par thème : le choix est posé dans
    //    localStorage avant tout script de la page (celui du layout le lit au premier
    //    rendu), et prefers-color-scheme suit, pour qu'aucun des deux ne contredise l'autre.
    const date = jourDeParis(new Date());
    const sha = commitCourant();
    const captures = [];
    for (const theme of ["light", "dark"]) {
      const vues = VUES.filter((v) => v.themes.includes(theme));
      if (vues.length === 0) continue;
      const ctx = await browser.newContext({
        viewport: { width: LARGEUR, height: HAUTEUR },
        deviceScaleFactor: 1,
        storageState: session,
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("mip-theme", t);
        } catch {
          /* sans localStorage, prefers-color-scheme (émulé ci-dessus) décide */
        }
      }, theme);
      const page = await ctx.newPage();
      for (const vue of vues) {
        const fichier = `${vue.nom}-${theme}.png`;
        const route = `${vue.chemin(issue)}?app=${encodeURIComponent(APP)}`;
        const reponse = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
        const statut = reponse?.status() ?? 0;
        if (statut === 0 || statut >= 400) throw new Error(`${fichier} : ${route} a répondu ${statut || "sans réponse"}.`);
        const arrivee = new URL(page.url());
        if (arrivee.pathname !== vue.chemin(issue)) throw new Error(`${fichier} : ${route} a redirigé vers ${arrivee.pathname}.`);
        await page.addStyleTag({ content: feuille });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.waitForTimeout(600);

        const sombre = await page.evaluate(() => document.documentElement.classList.contains("dark"));
        if (sombre !== (theme === "dark")) throw new Error(`${fichier} : le thème ${theme} n'est pas appliqué.`);
        const texte = await page.evaluate(() => document.body.innerText);
        const fautes = fautesAffichage(texte);
        if (fautes.length) throw new Error(`${fichier} : ${fautes.join(" ; ")}. Rien n'a été écrit.`);
        if (vue.temoin.selecteur && !(await page.locator(vue.temoin.selecteur).first().isVisible())) {
          throw new Error(`${fichier} : témoin absent (${vue.temoin.selecteur}) — ce n'est pas l'écran attendu.`);
        }
        if (vue.temoin.texte && !texte.includes(vue.temoin.texte)) {
          throw new Error(`${fichier} : l'écran n'affiche pas « ${vue.temoin.texte} », qu'il doit illustrer.`);
        }

        const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
        captures.push({ fichier, png, entree: entreeManifeste({ fichier, route, theme, png, date, sha }) });
        console.log(`pris : ${fichier} (${route}, ${png.length} octets)`);
      }
      await ctx.close();
    }

    // 4) Tout ou rien : poids et dimensions vérifiés sur le lot entier, puis écriture.
    const fautes = fautesImages(captures);
    if (fautes.length) throw new Error(`${fautes.join(" ; ")}. Rien n'a été écrit.`);
    mkdirSync(DOSSIER_PORTAIL, { recursive: true });
    for (const { fichier, png } of captures) writeFileSync(join(DOSSIER_PORTAIL, fichier), png);
    writeFileSync(join(DOSSIER_PORTAIL, "manifest.json"), `${JSON.stringify(captures.map((c) => c.entree), null, 2)}\n`);
    console.log(`${captures.length} captures et manifest.json écrits dans ${DOSSIER_PORTAIL} (${date}, ${sha}).`);
  } finally {
    await browser.close();
  }
}

// Exécuté seulement en commande : tests/unit/captures-portail.test.ts importe les
// fonctions pures ci-dessus sans lancer de navigateur.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await principal();
  } catch (e) {
    console.error(`captures-portail : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
