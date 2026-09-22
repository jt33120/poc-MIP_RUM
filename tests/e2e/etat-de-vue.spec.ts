// E2E — F06 : l'état de vue porté par l'URL, et la comparaison qui ne ment pas.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'une comparaison choisie se perde au premier changement d'onglet. `cmp`,
//     `rel_a` et `rel_b` suivent la navigation (sidebar ET sous-onglets) comme la
//     population et la plage ; un tri ou un panneau, propres à l'écran, restent derrière.
//   - Qu'une plage personnalisée de 30 jours affiche un delta. Sa période précédente
//     déborde la rétention : purgée, elle ferait lire une chute d'audience là où il
//     n'y a qu'une donnée effacée. L'écran dit pourquoi il n'y a pas d'écart.
//   - Qu'un réglage d'affichage illisible soit ignoré en silence.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans des apps dédiées. Utilisateur dédié : ce
// spec ne touche pas au mot de passe de l'administrateur local.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP = "f06-e2e-app"; // deux releases, trois jours d'historique
const APP_MONO = "f06-e2e-mono"; // une seule release
const E2E_EMAIL = "e2e-etat-de-vue@mip-rum.local";
const E2E_PASSWORD = "e2e-etat-de-vue-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

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

async function nettoyer() {
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [[APP, APP_MONO]]);
  }
}

/**
 * Une VAGUE de sessions mesurées : une session toutes les cinq minutes à partir de
 * `depuis`, chacune avec sa page vue et sa mesure LCP, et une erreur navigateur
 * toutes les vingt sessions. Tout est inséré en une instruction par table
 * (`generate_series`) : semer 260 sessions ligne à ligne coûtait quatre minutes.
 */
async function semerVague(prefixe: string, depuis: string, n: number, lcp: number) {
  const quand = `now() - $2::interval - (i * interval '5 minutes')`;
  const serie = `from generate_series(1, $4::int) as i`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, release)
     select $3 || i, $1, $3 || i, 'desktop', false, ${quand}, ${quand}, 1, '1.0.0'
     ${serie} on conflict (session_id) do nothing`,
    [APP, depuis, prefixe, n],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release)
     select $3 || i || '-pv', $3 || i, $1, '/', ${quand}, '1.0.0'
     ${serie} on conflict (span_id) do nothing`,
    [APP, depuis, prefixe, n],
  );
  await pool.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts, release)
     select $3 || i || '-lcp', $3 || i, $1, '/', 'LCP', $5::float8, 'good', ${quand}, '1.0.0'
     ${serie} on conflict (span_id) do nothing`,
    [APP, depuis, prefixe, n, lcp],
  );
  // `error_source` en « browser_% » : c'est ce que compte la tuile « Occurrences
  // d'erreurs pour 100 pages vues » (taxonomie fermée de v69).
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, route, kind, error_type, message, error_source, occurrences, ts)
     select $3 || i || '-err', $3 || i, $1, '/', 'error', 'TypeError', 'erreur synthétique état de vue',
            'browser_js', 1, ${quand}
     ${serie} where i % 20 = 0 on conflict (span_id) do nothing`,
    [APP, depuis, prefixe, n],
  );
}

/**
 * Le TÉMOIN du spec (« sous 24 h, un écart s'affiche ») exige que l'écran ait le
 * droit de comparer, et de quoi comparer. Sur `/`, deux gardes s'y opposent tant que
 * le semis est symbolique, et les deux se lisent dans le code :
 *
 *   1. COUVERTURE DE LA RANGÉE (`deltasDeLaRangee`, lib/comparaison.ts). Une rangée
 *      n'a d'écart que si TOUTES ses sources ont commencé à collecter avant la
 *      période précédente. La rangée trafic en compte trois — `rum_session`,
 *      `rum_pageview` et `rum_error` — et `debutCollecte` lit `min(ts)` de la table
 *      SUR LE PÉRIMÈTRE : une table vide y rend `null`, soit « aucune donnée
 *      collectée sur le périmètre ». Sans une seule erreur, la rangée trafic entière
 *      perdait donc ses écarts, sans que rien ne soit mal lié. D'où le jalon
 *      d'erreur à 3 jours, avec les jalons de session, de vue et de mesure.
 *   2. EFFECTIF DE LA TUILE (`comparaisonDeTuile`, KpiTile). Sous 100 mesures d'un
 *      côté ou de l'autre, une tuile Web Vital écrit « delta non affiché :
 *      échantillon faible sur l'une des deux périodes ». D'où les deux vagues, 140
 *      mesures dans les 24 h et 120 dans les 24 h précédentes.
 *
 * Restent les jalons nommés : trois jours, 30 heures et la dernière heure, et les
 * deux releases de `APP` (une seule pour `APP_MONO`) que lisent les autres tests.
 */
async function semer() {
  await nettoyer();
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'État de vue E2E'), ($2, 'État de vue E2E mono')
     on conflict (app_id) do nothing`,
    [APP, APP_MONO],
  );
  const lignes: [string, string, string, string][] = [
    [APP, "il-y-a-3j", "3 days", "1.0.0"],
    [APP, "il-y-a-30h", "30 hours", "1.0.0"],
    [APP, "recente-a", "1 hour", "1.0.0"],
    [APP, "recente-b", "50 minutes", "1.1.0"],
    [APP_MONO, "mono", "1 hour", "2.0.0"],
  ];
  for (const [app, nom, age, release] of lignes) {
    const sid = `${app}-${nom}`;
    const quand = `now() - interval '${age}'`;
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, release)
       values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 1, $3) on conflict (session_id) do nothing`,
      [sid, app, release],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, release)
       values ($1, $2, $3, '/', ${quand}, $4) on conflict (span_id) do nothing`,
      [`${sid}-pv`, sid, app, release],
    );
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts, release)
       values ($1, $2, $3, '/', 'LCP', 1900, 'good', ${quand}, $4) on conflict (span_id) do nothing`,
      [`${sid}-lcp`, sid, app, release],
    );
  }
  // Jalon d'erreur à 3 jours : il fait commencer la collecte de `rum_error` AVANT la
  // période précédente, comme les trois autres tables (règle 2 du § 3.2).
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, route, kind, error_type, message, error_source, occurrences, ts)
     values ($1, $2, $3, '/', 'error', 'TypeError', 'erreur synthétique état de vue', 'browser_js', 1,
             now() - interval '3 days')
     on conflict (span_id) do nothing`,
    [`${APP}-il-y-a-3j-err`, `${APP}-il-y-a-3j`, APP],
  );
  // Les deux vagues comparées. 140 mesures sur [now-12 h 40, now-1 h 05] et 120 sur
  // [now-35 h, now-25 h 05] : chaque vague tient entièrement dans SA fenêtre de 24 h,
  // avec plus d'une heure de marge de part et d'autre de la frontière.
  await semerVague(`${APP}-v24-`, "1 hour", 140, 1900);
  await semerVague(`${APP}-vprec-`, "25 hours", 120, 2400);
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
  await nettoyer();
  await pool.end();
});

async function login(page: Page, app = APP) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: app, url: consoleUrl }]);
}

const parametres = (page: Page) => new URL(page.url()).searchParams;

/**
 * Débordement horizontal, éléments fautifs nommés. COPIE du helper de
 * tests/e2e/analyses-drilldowns.spec.ts : F09 l'extrait vers
 * tests/e2e/helpers/debordements.ts ; remplacer cette copie par l'import à ce moment-là.
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
      .map((el) => `${el.tagName.toLowerCase()} « ${el.textContent?.trim().slice(0, 60) ?? ""} » → ${Math.round(el.getBoundingClientRect().right)} px`);
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("cmp=release survit à un changement d'onglet et de catégorie ; le tri reste derrière", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP}&period=24h&tri=volume`, { waitUntil: "domcontentloaded" });
  const comparaison = page.getByTestId("filter-compare");

  // Deux releases sur la fenêtre : le mode est proposé, puis les deux releases choisies.
  await expect(comparaison.getByRole("button", { name: "Releases" })).toBeEnabled({ timeout: 15_000 });
  await comparaison.getByRole("button", { name: "Releases" }).click();
  await expect.poll(() => parametres(page).get("cmp")).toBe("release");
  await page.getByTestId("compare-rel-b").selectOption("1.1.0");
  await expect.poll(() => parametres(page).get("rel_b")).toBe("1.1.0");
  await page.getByTestId("compare-rel-a").selectOption("1.0.0");
  await expect.poll(() => parametres(page).get("rel_a")).toBe("1.0.0");

  // Sous-onglet de la même catégorie.
  await page.locator('a[href^="/pages?"]').first().click();
  await page.waitForURL((u) => u.pathname === "/pages", { timeout: 15_000 });
  let sp = parametres(page);
  expect([sp.get("app"), sp.get("cmp"), sp.get("rel_a"), sp.get("rel_b")]).toEqual([APP, "release", "1.0.0", "1.1.0"]);
  expect(sp.get("tri")).toBeNull();
  await expect(page.getByTestId("filter-compare").getByRole("button", { name: "Releases" })).toHaveAttribute("aria-pressed", "true");

  // Autre catégorie, par la barre latérale.
  await page.locator('aside a[href^="/sessions?"]').first().click();
  await page.waitForURL((u) => u.pathname === "/sessions", { timeout: 15_000 });
  sp = parametres(page);
  expect([sp.get("cmp"), sp.get("rel_a"), sp.get("rel_b")]).toEqual(["release", "1.0.0", "1.1.0"]);

  // Revenir à « Aucune » retire les releases de l'URL.
  await page.getByTestId("filter-compare").getByRole("button", { name: "Aucune" }).click();
  await expect.poll(() => parametres(page).get("rel_a")).toBeNull();
  expect(parametres(page).get("rel_b")).toBeNull();
});

/**
 * Un écart vs la période précédente, sous TOUTES ses formes :
 *   - badge établi : `trend` (`VitalCard`), `delta` (`KpiTile`, F11) ;
 *   - écart NON ÉTABLI (P*.1, intervalles qui se chevauchent) : écrit sans flèche,
 *     `kpi-comparaison[data-ecart="non-etabli"]`.
 * Le TEXTE DE SILENCE d'une tuile (« période précédente incomplète », « pas de mesure
 * sur … », « échantillon faible ») n'est PAS un écart : il porte `data-ecart="silence"`
 * et reste hors de ce sélecteur — sinon « aucun écart » serait faux dès qu'on dit
 * pourquoi il n'y en a pas.
 */
const ECART =
  '[title="vs période précédente"], [data-testid="trend"], [data-testid="delta"], [data-testid="kpi-comparaison"][data-ecart="non-etabli"]';

test("une plage personnalisée de 30 jours n'affiche aucun delta sur /, et dit pourquoi", async ({ page }) => {
  await login(page);

  // Témoin : sous 24 h, la période précédente est complète ET assez mesurée des deux
  // côtés (cf. `semer` : jalons à 3 jours pour les quatre sources, 140 mesures dans la
  // fenêtre et 120 dans la précédente) — un écart s'affiche. Établi ou non (P*.1 : deux
  // intervalles qui se chevauchent donnent un écart écrit sans flèche ni `title`), c'est
  // toujours un écart. F11 : sur `/`, les tuiles sont des `KpiTile`, et leur référence
  // est DATÉE (« vs 24 h précédentes (… UTC) »).
  await page.goto(`${consoleUrl}/?app=${APP}&period=24h`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(ECART).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(ECART).first()).toContainText("vs 24 h précédentes");

  const to = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000);
  const from = new Date(to.getTime() - 30 * 86_400_000);
  await page.goto(`${consoleUrl}/?app=${APP}&from=${from.toISOString()}&to=${to.toISOString()}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("tuile-LCP")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("note-comparaison")).toContainText("hors rétention (30 jours)");
  await expect(page.locator(ECART)).toHaveCount(0);
});

test("cmp=none : aucun delta, et un réglage illisible est signalé", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/?app=${APP}&period=24h&cmp=none`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tuile-LCP")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(ECART)).toHaveCount(0);

  await page.goto(`${consoleUrl}/?app=${APP}&period=24h&cmp=hier`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("reglage-ignore")).toContainText("Réglage d'affichage ignoré : cmp=hier");
  // Ignoré, donc le défaut de l'écran (période précédente) s'applique.
  await expect(page.getByTestId("filter-compare").getByRole("button", { name: "Période précédente" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("barre de filtres avec les deux sélecteurs de release : aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
  await login(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${consoleUrl}/?app=${APP}&period=24h&cmp=release&rel_a=1.0.0&rel_b=1.1.0`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("compare-rel-b")).toBeVisible({ timeout: 15_000 });
    expect(await debordements(page), `${width} px`).toEqual([]);
  }
});

test("une seule release sur la fenêtre : le mode release est désactivé avec sa raison", async ({ page }) => {
  await login(page, APP_MONO);
  await page.goto(`${consoleUrl}/?app=${APP_MONO}&period=24h&cmp=release`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("compare-indisponible")).toContainText("moins de deux releases", { timeout: 15_000 });
  await expect(page.getByTestId("filter-compare").getByRole("button", { name: "Releases" })).toBeDisabled();
});
