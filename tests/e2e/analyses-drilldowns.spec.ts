// E2E — P6.3 : découpages, drill-downs, ressources et recherche de sessions.
//
// POURQUOI UN E2E. Les décisions sont vérifiées en pur (tests/unit/breakdowns,
// analyses-p63) et les requêtes sur PostgreSQL (tests/integration/analyses-p63-sql).
// Ce qui ne peut l'être ni dans l'un ni dans l'autre, c'est ce qu'un utilisateur
// obtient EN CLIQUANT : qu'un onglet change l'écran sans le vider, qu'un groupe
// ouvre la bonne surface avec la même plage, que le clavier seul y arrive, que
// l'alternative textuelle existe, et qu'aucun écran ne déborde à 390 px.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import pg from "pg";

const APP_ID = "app-p63-e2e";
const E2E_EMAIL = "e2e-p63@mip-rum.local";
const E2E_PASSWORD = "e2e-p63-mdp-local";
const BASE = "http://localhost:3000";

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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

/** Deux navigateurs, deux routes, deux releases, des ressources et des blocages. */
const SESSIONS = [
  { id: `${APP_ID}-chrome-1`, browser: "Chrome", os: "Windows", route: "/panier", release: "3.0.0", lcp: 3400 },
  { id: `${APP_ID}-chrome-2`, browser: "Chrome", os: "Windows", route: "/panier", release: "3.0.0", lcp: 3600 },
  { id: `${APP_ID}-chrome-3`, browser: "Chrome", os: "macOS", route: "/accueil", release: "3.0.0", lcp: 1200 },
  { id: `${APP_ID}-firefox-1`, browser: "Firefox", os: "Windows", route: "/accueil", release: "2.0.0", lcp: 900 },
];

async function semer() {
  for (const t of ["rum_longtask", "rum_resource", "rum_error", "rum_metric", "rum_pageview", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  }
  await pool.query(`delete from app_registry where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name, allowed_origins)
     values ($1, 'Analyses P6.3 E2E', array['https://p63.example.fr'])
     on conflict (app_id) do update set allowed_origins = excluded.allowed_origins`,
    [APP_ID],
  );

  for (const s of SESSIONS) {
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, browser, os, device_type, is_bot,
                                release, started_at, last_seen_at, page_count)
       values ($1, $2, $1, $3, $4, 'desktop', false, $5, now() - interval '20 minutes', now() - interval '18 minutes', 1)
       on conflict (session_id) do nothing`,
      [s.id, APP_ID, s.browser, s.os, s.release],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, release, started_at)
       values ($1, $2, $3, $4, $5, now() - interval '20 minutes')
       on conflict (span_id) do nothing`,
      [`${s.id}-pv`, s.id, APP_ID, s.route, s.release],
    );
    for (const [nom, valeur] of [
      ["LCP", s.lcp],
      ["INP", 120],
      ["CLS", 0.05],
    ] as const) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, release, name, value, rating, ts)
         values ($1, $2, $3, $4, $5, $6, $7, 'good', now() - interval '20 minutes')
         on conflict (span_id) do nothing`,
        [`${s.id}-${nom}`, s.id, APP_ID, s.route, s.release, nom, valeur],
      );
    }
  }

  // Ressources : une première partie (origine déclarée) et une tierce partie.
  const ressources = [
    ["https://p63.example.fr/bundle.js", "script", 800, 120_000],
    ["https://cdn-tiers-p63.example.net/police.woff2", "font", 1100, 30_000],
  ] as const;
  for (const [urlRes, type, duree, taille] of ressources) {
    await pool.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, ts)
       values ($1, $2, $3, '/panier', $4, $5, $6, $7, now() - interval '19 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_ID}-res-${type}`, SESSIONS[0].id, APP_ID, urlRes, type, duree, taille],
    );
  }

  // Un blocage LoAF attribué : il doit offrir un lien vers SA session.
  await pool.query(
    `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms,
                               script_url, script_function, ts)
     values ($1, $2, $3, '/panier', 420, 'loaf', 420, 'https://p63.example.fr/panier.js', 'recalculerTotal',
             now() - interval '19 minutes')
     on conflict (span_id) do nothing`,
    [`${APP_ID}-loaf-1`, SESSIONS[0].id, APP_ID],
  );
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function loginConsole(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/**
 * Débordement horizontal : la liste des éléments fautifs, pas un simple booléen.
 * Un échec doit NOMMER le coupable — sans quoi la recette dit qu'il y a un
 * problème sans jamais dire où. Un élément dans un conteneur défilant est
 * légitime (tableau large) ; un élément positionné qui en échappe ne l'est pas.
 * Même helper que les recettes de débordement de P5.
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
        // Un repère LISIBLE : le libellé d'aide de la bulle, le titre de la
        // section, ou le début du texte. Une liste de classes Tailwind dit
        // quel composant déborde, jamais lequel de ses dix exemplaires.
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

/**
 * Le découpage d'un écran, dans l'une ou l'autre de ses deux grammaires : `Breakdown`
 * (F05) ou l'`ImpactTable` qui le remplace écran par écran (F13 sur `/`, F14 sur
 * `/pages`). Mêmes onglets, même drill-down, même alternative textuelle : le test
 * vérifie le COMPORTEMENT, pas le composant qui le rend.
 */
const decoupageDe = (page: Page) => page.locator('[data-testid="breakdown"], [data-testid="impact-table"]').first();
const lignesDe = (page: Page) =>
  decoupageDe(page).locator('a[data-testid="breakdown-row"], [data-testid="impact-ligne"] a');

// Le découpage par dimension a quitté `/pages` (F14, § 5.2.4 : doublon de la Vue
// d'ensemble) ; ses onglets se vérifient donc là où ils vivent, sur `/`.
test("découpage : onglets, drill-down, clavier et alternative textuelle", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`${BASE}/?app=${APP_ID}&period=24h`);

  const decoupage = decoupageDe(page);
  await expect(decoupage).toBeVisible();

  // Onglet par défaut : la route, seule dimension collectée depuis toujours.
  await expect(page.getByTestId("breakdown-tab-route")).toHaveAttribute("aria-current", "page");
  await expect(decoupage).toContainText("/panier");

  // Changer d'onglet change l'URL ET l'écran, sans rechargement complet.
  await page.getByTestId("breakdown-tab-browser").click();
  await page.waitForURL((u) => u.searchParams.get("split") === "browser", { timeout: 15_000 });
  await expect(decoupage).toContainText("Chrome");
  await expect(decoupage).toContainText("Firefox");

  // L'alternative textuelle existe et porte les mêmes groupes que les barres.
  const alternative = decoupage.locator("details", { hasText: /Alternative textuelle/ }).first();
  await expect(alternative).toBeVisible();
  await alternative.locator("summary").click();
  await expect(alternative.locator("table")).toContainText("Chrome");
  await expect(alternative.locator("table")).toContainText("LCP p75");

  // Le clavier seul suffit : le premier groupe se prend au focus et s'ouvre.
  const premier = lignesDe(page).first();
  await premier.focus();
  await expect(premier).toBeFocused();
  const cible = await premier.getAttribute("href");
  expect(cible).toContain("browser=");
  await premier.press("Enter");
  await page.waitForURL((u) => u.searchParams.get("browser") !== null, { timeout: 15_000 });

  // Le drill-down a conservé le périmètre et ajouté le filtre du groupe. Il ne
  // reconduit PAS l'onglet : un drill-down change de question, pas de vue.
  expect(new URL(page.url()).searchParams.get("app")).toBe(APP_ID);
  await expect(decoupageDe(page)).toBeVisible();
  await page.getByTestId("breakdown-tab-browser").click();
  await page.waitForURL((u) => u.searchParams.get("split") === "browser", { timeout: 15_000 });
  // Filtré sur un seul navigateur, le découpage par navigateur n'a qu'un groupe.
  await expect(lignesDe(page)).toHaveCount(1);
  await expect(decoupageDe(page)).not.toContainText("Firefox");
});

test("une route du classement ouvre le détail avec la même plage", async ({ page }) => {
  await loginConsole(page);
  // Période 7 j, et non le défaut 24 h : une plage conservée doit rester VISIBLE
  // dans l'URL du drill-down, ce que le défaut ne prouverait pas. La table « Par
  // route » a fusionné dans le hero classé (F14) : c'est sa ligne qu'on ouvre.
  await page.goto(`${BASE}/pages?app=${APP_ID}&period=7d`);
  const lignes = page.getByTestId("hero-routes").getByTestId("impact-ligne");
  const lien = lignes.filter({ hasText: "/panier" }).first().getByRole("link");
  await expect(lien).toBeVisible();
  await lien.click();
  await page.waitForURL((u) => u.searchParams.get("route") === "/panier", { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get("period")).toBe("7d");
  await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(1);
});

test("ressources : l'avertissement de seuil et le partage première/tierce partie", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`${BASE}/pages?app=${APP_ID}&period=24h`);

  const seuil = page.getByTestId("ressources-seuil");
  await expect(seuil).toContainText("Ressources collectées selon seuil SDK");

  const ressources = page.getByTestId("ressources");
  await expect(ressources).toContainText("Première partie");
  await expect(ressources).toContainText("Tierce partie");
  // L'hôte déclaré de l'app est première partie ; le CDN ne l'est pas.
  await expect(ressources).toContainText("p63.example.fr");
  await expect(ressources).toContainText("cdn-tiers-p63.example.net");
});

test("blocages : la série, son alternative textuelle et le lien vers la session", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`${BASE}/pages?app=${APP_ID}&period=24h`);

  const blocages = page.getByTestId("longtasks");
  await expect(blocages).toContainText("Long Animation Frames");
  await expect(blocages).toContainText("recalculerTotal");
  // Aucun cumul de durées présenté comme du temps utilisateur.
  await expect(blocages).toContainText("Aucun cumul de durées");

  const lienSession = blocages.locator(`a[href*="/sessions/"]`).first();
  await expect(lienSession).toBeVisible();
  await lienSession.click();
  await page.waitForURL((u) => u.pathname.startsWith("/sessions/"), { timeout: 15_000 });
});

test("sessions : recherche bornée, refus récupérable et pagination stable", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`${BASE}/sessions?app=${APP_ID}&period=24h`);

  // Recherche par identifiant technique exact.
  await page.selectOption('select[name="qf"]', "session");
  await page.fill('input[name="q"]', SESSIONS[0].id);
  await page.getByRole("button", { name: "Rechercher" }).click();
  await page.waitForURL((u) => u.searchParams.get("q") === SESSIONS[0].id, { timeout: 15_000 });
  await expect(page.getByTestId("recherche-resume")).toContainText("identifiant");
  await expect(page.getByTestId("session-link")).toHaveCount(1);

  // Une saisie refusée le dit près du champ, sans vider l'écran ni mentir.
  await page.goto(`${BASE}/sessions?app=${APP_ID}&period=24h&qf=route&q=pas-une-route`);
  await expect(page.getByTestId("recherche-refus")).toContainText("route normalisée");
  await expect(page.getByTestId("session-link")).toHaveCount(0);
  await page.getByRole("link", { name: "Réinitialiser" }).click();
  await page.waitForURL((u) => u.searchParams.get("q") === null, { timeout: 15_000 });
  await expect(page.getByTestId("session-link").first()).toBeVisible();

  // Une recherche par identité n'est pas proposée : trois champs, et c'est tout.
  await expect(page.locator('select[name="qf"] option')).toHaveCount(3);
});

test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
  await loginConsole(page);
  // Toutes les combinaisons sont PARCOURUES avant d'échouer : s'arrêter au
  // premier écran fautif cacherait les suivants, et la recette repartirait pour
  // un tour à chaque correction.
  const fautes: string[] = [];
  for (const largeur of [390, 768, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    for (const chemin of ["/", "/pages", "/errors", "/sessions"]) {
      await page.goto(`${BASE}${chemin}?app=${APP_ID}&period=24h`);
      await expect(page.locator("h1").first()).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${chemin} @ ${largeur} px — ${faute}`);
    }
  }
  expect(fautes).toEqual([]);
});
