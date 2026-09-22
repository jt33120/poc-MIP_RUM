// E2E — F05 : classements par gravité et heatmap en fuseau de l'app, sur `/`.
//
// Preuve de fin du lot (plan § 6.1) : sans `tri`, le découpage des Web Vitals est
// classé par GRAVITÉ (LCP p75, échantillon faible en fin) ; `tri=volume` rend
// l'ordre du volume ; `tri=impact` (backend B2 absent) est ignoré ET signalé. La
// heatmap ne porte ni vert, ni ambre, ni rouge, et chaque case mesurée ouvre son
// heure en instants UTC.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, avec des ordres de
// gravité et de volume OPPOSÉS — sinon le test passerait avec n'importe quel tri :
//   /lente-frequente  40 mesures LCP à 4,5 s  → 1re en gravité, 2e en volume
//   /rapide-massive  100 mesures LCP à 1,5 s  → 1re en volume, 2e en gravité
//   /lente-rare       12 mesures LCP à 7,0 s  → la plus lente, mais échantillon faible : dernière
// Mesures posées il y a deux heures : une heure CLOSE de la heatmap (l'heure en cours
// n'ouvre rien sous 5 minutes), et dans la fenêtre de 24 h du découpage.
// Compte dédié, jamais le compte admin local de seed-admin.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f05-e2e-app";
const E2E_EMAIL = "e2e-distributions@mip-rum.local";
const E2E_PASSWORD = "e2e-distributions-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const ACCUEIL = `${consoleUrl}/?app=${APP_ID}&period=24h`;

const ROUTES = [
  { route: "/lente-frequente", n: 40, lcp: 4500, rating: "poor" },
  { route: "/rapide-massive", n: 100, lcp: 1500, rating: "good" },
  { route: "/lente-rare", n: 12, lcp: 7000, rating: "poor" },
] as const;

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

async function semer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Distributions E2E') on conflict (app_id) do nothing`,
    [APP_ID],
  );
  const sessions = Math.max(...ROUTES.map((r) => r.n));
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     select $1 || '-s' || g, $1, $1 || '-v' || g, 'desktop', false,
            date_trunc('hour', now()) - interval '2 hours',
            date_trunc('hour', now()) - interval '2 hours' + interval '20 minutes', 1
       from generate_series(1, $2::int) g
     on conflict (session_id) do nothing`,
    [APP_ID, sessions],
  );
  for (const r of ROUTES) {
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select $1 || '-' || $2 || '-' || g, $1 || '-s' || g, $1, $2, 'LCP', $3, $4,
              date_trunc('hour', now()) - interval '2 hours' + interval '10 minutes'
         from generate_series(1, $5::int) g
       on conflict (span_id) do nothing`,
      [APP_ID, r.route, r.lcp, r.rating, r.n],
    );
  }
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** Les routes du découpage, dans l'ordre affiché. */
async function ordre(page: Page): Promise<string[]> {
  const lignes = page.getByTestId("breakdown").getByTestId("breakdown-row");
  await expect(lignes).toHaveCount(ROUTES.length);
  // Le premier <span> d'une ligne est son libellé (grammaire de Breakdown).
  return lignes.evaluateAll((els) => els.map((el) => el.querySelector("span")?.textContent?.trim() ?? ""));
}

/** Éléments qui dépassent la fenêtre à droite, hors conteneur défilant (helper de composants.spec.ts). */
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
        const repere = el.closest("section, h1, h2, h3")?.textContent?.trim().slice(0, 60) ?? el.textContent?.trim().slice(0, 60) ?? "";
        return `${el.tagName.toLowerCase()} « ${repere} » → ${Math.round(el.getBoundingClientRect().right)} px`;
      });
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test("découpage de `/` : gravité par défaut, échantillon faible en fin", async ({ page }) => {
  await login(page);
  await page.goto(ACCUEIL, { waitUntil: "domcontentloaded" });
  const decoupage = page.getByTestId("breakdown");
  await expect(decoupage).toHaveAttribute("data-tri", "gravite");
  await expect(page.getByTestId("tri-gravite")).toHaveAttribute("aria-current", "true");
  expect(await ordre(page)).toEqual(["/lente-frequente", "/rapide-massive", "/lente-rare"]);
  // La plus lente est rangée en DERNIER, et le dit : 12 mesures ne classent pas.
  await expect(decoupage.getByTestId("breakdown-row").last()).toHaveAttribute("data-faible", "1");
  await expect(decoupage.getByTestId("breakdown-row").last()).toContainText("échantillon faible");
  // L'écart est lu contre l'ensemble, nommé.
  await expect(page.getByTestId("breakdown-reference")).toContainText("LCP p75 de l'ensemble");
});

test("découpage de `/` : tri=volume rend l'ordre du volume, la bascule garde les filtres", async ({ page }) => {
  await login(page);
  await page.goto(ACCUEIL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tri-volume").click();
  await page.waitForURL((u) => u.searchParams.get("tri") === "volume", { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get("app")).toBe(APP_ID);
  expect(new URL(page.url()).searchParams.get("period")).toBe("24h");
  await expect(page.getByTestId("breakdown")).toHaveAttribute("data-tri", "volume");
  expect(await ordre(page)).toEqual(["/rapide-massive", "/lente-frequente", "/lente-rare"]);

  // Un changement d'onglet garde l'ordre choisi.
  const onglet = page.getByTestId("breakdown-tab-device");
  if (await onglet.evaluate((el) => el.tagName === "A")) {
    expect(await onglet.getAttribute("href")).toContain("tri=volume");
  }
});

test("découpage de `/` : tri=impact (B2 absent) est ignoré et signalé, l'ordre reste la gravité", async ({ page }) => {
  await login(page);
  await page.goto(`${ACCUEIL}&tri=impact`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("breakdown-avertissement")).toContainText("Réglage d'affichage ignoré : tri=impact");
  await expect(page.getByTestId("breakdown")).toHaveAttribute("data-tri", "gravite");
  expect(await ordre(page)).toEqual(["/lente-frequente", "/rapide-massive", "/lente-rare"]);
});

test("heatmap : aucune couleur de verdict ; une case ouvre son heure en instants UTC", async ({ page }) => {
  await login(page);
  await page.goto(ACCUEIL, { waitUntil: "domcontentloaded" });
  const heatmap = page.getByTestId("heatmap");
  await expect(heatmap).toBeVisible();
  const html = await heatmap.innerHTML();
  expect(html).not.toMatch(/\b(?:bg|text|border|ring)-(?:good|warn|bad)\b/);
  // RATING_HEX (vert, ambre, rouge des verdicts), écrits ou sérialisés par le navigateur.
  expect(html.toLowerCase()).not.toMatch(/#059669|#d97706|#dc2626|rgb\(5, 150, 105\)|rgb\(217, 119, 6\)|rgb\(220, 38, 38\)/);

  const cases = heatmap.locator('a[data-testid="heatmap-case"]');
  await expect(cases.first()).toBeVisible();
  const href = (await cases.first().getAttribute("href")) ?? "";
  const cible = new URL(href, consoleUrl);
  const from = cible.searchParams.get("from") ?? "";
  const to = cible.searchParams.get("to") ?? "";
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
  expect(Date.parse(to) - Date.parse(from)).toBeGreaterThan(0);
  expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(2 * 3_600_000); // 2 h : recul d'heure
  expect(cible.searchParams.get("period")).toBeNull();
  expect(cible.searchParams.get("app")).toBe(APP_ID);
  // L'annonce de la case dit les deux fuseaux.
  expect(await cases.first().getAttribute("title")).toMatch(/\(.+ UTC\) : /);

  // Le clavier suffit, et l'écran d'arrivée accepte la plage (pas de refus de filtre).
  await cases.first().focus();
  await cases.first().press("Enter");
  await page.waitForURL((u) => u.searchParams.get("from") === from, { timeout: 15_000 });
  await expect(page.locator("h1").first()).toHaveText(/Vue d'ensemble/);
  await expect(page.getByTestId("breakdown")).toBeVisible();
  // L'écran d'arrivée dit la plage dans les deux fuseaux (R-T).
  await expect(page.getByTestId("plage-deux-fuseaux")).toContainText(/\d{2}:\d{2}-\d{2}:\d{2} .+ \(.+ UTC\)/);
});

test("`/` : aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const fautes: string[] = [];
  for (const largeur of [390, 768, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(ACCUEIL, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("breakdown")).toBeVisible();
    for (const faute of await debordements(page)) fautes.push(`/ @ ${largeur} px — ${faute}`);
  }
  expect(fautes).toEqual([]);
});

test("vitrine : les composants de F05 sont rendus", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/admin/composants`, { waitUntil: "domcontentloaded" });
  for (const id of ["distribution-seuils", "impact-table", "contrast-bars", "breakdown", "health-heatmap", "percentile-table"]) {
    await expect(page.locator(`section#${id}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid="contrast-bars"][data-etat="indisponible"]')).toContainText("Non disponible, raison :");
  await expect(page.locator('[data-testid="impact-table"][data-tri="fourni"]')).toContainText("ordre chronologique");
});
