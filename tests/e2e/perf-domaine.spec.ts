// E2E — domaine performance (plan § 6.5) : parcours et débordements des écrans Vue
// d'ensemble, Pages, Erreurs, Interactions et Satisfaction. Créé par le premier lot
// d'écran fusionné, étendu par chaque lot (un `test.describe` par lot, ajouté EN FIN
// de fichier), clos par F27.
//
// Chaque lot sème ses données dans SA propre app, dans le `beforeAll` de son bloc :
// aucun bloc ne dépend des données d'un autre. Un seul compte admin DÉDIÉ au fichier,
// jamais le compte admin local de seed-admin.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const ADMIN_EMAIL = "e2e-perf-domaine-admin@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, ADMIN_EMAIL);
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

// ——— Blocs des lots, dans l'ordre d'arrivée ———

test.describe("F11 — Vue d'ensemble : santé, KPI, constats", () => {
  // Une app à elle : 32 sessions commencées sur les 20 dernières heures (assez pour
  // que `/sessions` écrive sa population), une vue et un LCP chacune, une erreur
  // navigateur, une erreur backend sans session, et un déploiement qui dégrade le
  // LCP (+20 % ou plus sur ±2 h) : de quoi produire un constat et son lien.
  const APP_F11 = "e2e-f11-vue-ensemble";
  const ACCUEIL_F11 = `${consoleUrl}/?app=${APP_F11}&period=24h`;

  test.beforeAll(async () => {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "deploy_marker"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F11]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Vue d''ensemble F11 (e2e)') on conflict (app_id) do nothing`,
      [APP_F11],
    );
    for (let i = 0; i < 32; i++) {
      const sid = `${APP_F11}-s${i}`;
      // Sessions 0-7 : [now-5h, now-3h) (avant le déploiement) ; 8-15 : [now-3h, now-1h) (après).
      const minutes = i < 8 ? 290 - i * 10 : i < 16 ? 170 - (i - 8) * 10 : 1200 - (i - 16) * 50;
      const quand = `now() - interval '${minutes} minutes'`;
      const lcp = i < 8 ? 1100 + i * 10 : i < 16 ? 3000 + i * 10 : 1800 + i * 5;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)
         on conflict (session_id) do nothing`,
        [sid, APP_F11],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
         values ($1, $2, $3, '/panier', 'navigate', ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-pv`, sid, APP_F11],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
         values ($1, $2, $3, '/panier', 'LCP', $4, ${quand}) on conflict (span_id) do nothing`,
        [`${sid}-lcp`, sid, APP_F11, lcp],
      );
    }
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, error_source, ts)
       values ($1, $2, $3, '/panier', 'error', 'boom F11', 'TypeError', 'f11-fp-nav', 3, 'browser_js', now() - interval '100 minutes'),
              ($4, null, $3, null, 'error', 'backend F11', 'Error', 'f11-fp-node', 5, 'node', now() - interval '100 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_F11}-e-nav`, `${APP_F11}-s9`, APP_F11, `${APP_F11}-e-node`],
    );
    await pool.query(
      `insert into deploy_marker (app_id, version, env, ts)
       values ($1, 'f11-2.0.0', 'prod', now() - interval '3 hours'), ($1, 'f11-1.9.0', 'prod', now() - interval '30 hours')`,
      [APP_F11],
    );
  });

  test("la tuile LCP ouvre /pages?vital=LCP en gardant l'app et la plage", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/?app=${APP_F11}&period=7d`, { waitUntil: "domcontentloaded" });
    const lienLcp = page.getByTestId("tuile-LCP").locator("a").first();
    await expect(lienLcp).toBeVisible({ timeout: 15_000 });
    const href = new URL((await lienLcp.getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("vital")).toBe("LCP");
    expect(href.searchParams.get("app")).toBe(APP_F11);
    expect(href.searchParams.get("period")).toBe("7d");
  });

  test("« Sessions commencées » : le même nombre sur / et sur /sessions", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const valeur = (await page.getByTestId("tuile-sessions").getByTestId("kpi-valeur").innerText()).replace(/\s/g, "");
    expect(valeur).toMatch(/^\d+$/);

    await page.goto(`${consoleUrl}/sessions?app=${APP_F11}&period=24h`, { waitUntil: "domcontentloaded" });
    // Tuile de tête de /sessions (F41), ou, avant elle, la population du bloc d'engagement.
    const tuile = page.getByTestId("kpi-tile").filter({ hasText: "Sessions commencées" });
    const surSessions =
      (await tuile.count()) > 0
        ? await tuile.first().getByTestId("kpi-valeur").innerText()
        : ((await page.getByTestId("engagement").innerText()).match(/Population : les ([\d\s\u00a0\u202f]+) session/)?.[1] ?? "");
    expect(surSessions.replace(/\s/g, "")).toBe(valeur);
  });

  test("la tuile d'erreurs est un ratio « pour 100 », jamais un pourcentage", async ({ page }) => {
    await login(page);
    // `cmp=none` : pas d'écart relatif, dont le « % » est une variation, pas la valeur.
    await page.goto(`${ACCUEIL_F11}&cmp=none`, { waitUntil: "domcontentloaded" });
    const tuile = page.getByTestId("tuile-erreurs");
    await expect(tuile).toContainText("Occurrences d'erreurs pour 100 pages vues", { timeout: 15_000 });
    await expect(tuile.getByTestId("kpi-valeur")).toContainText("pour");
    await expect(tuile).not.toContainText("%");
    // L'erreur backend (sans page vue) est écartée du numérateur, et comptée à part.
    await expect(tuile).toContainText("hors navigateur");
  });

  test("à 390 px, aucun libellé de facteur de santé n'est tronqué, et rien ne déborde", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const libelles = page.getByTestId("facteur-libelle");
    await expect(libelles).toHaveCount(4, { timeout: 15_000 });
    for (const texte of ["Web Vitals", "Erreurs navigateur", "Stabilité des sessions", "Anomalies LCP (24 h)"]) {
      const l = libelles.filter({ hasText: texte });
      await expect(l).toHaveText(texte);
      // Tronqué = le texte est plus large que sa boîte (ellipse ou coupure).
      expect(await l.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), texte).toBe(true);
    }
    expect(await debordements(page)).toEqual([]);
  });

  test("les constats se lisent repliés, avec leur règle ; aucun lien ne porte fired=", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
    const constats = page.getByTestId("constats");
    await expect(constats).toBeVisible({ timeout: 15_000 });
    // Le déploiement semé dégrade le LCP : un constat de régression, lien cmp=release.
    await expect(constats).toContainText(/Constats \(\d+\)/);
    await constats.locator("summary").click();
    const regression = constats.getByTestId("constat").filter({ hasText: "Déploiement f11-2.0.0" });
    await expect(regression).toContainText("pages vues avant");
    await expect(regression).toContainText("Règle :");
    const href = new URL((await regression.locator("a").getAttribute("href"))!, consoleUrl);
    expect([href.searchParams.get("cmp"), href.searchParams.get("rel_b"), href.searchParams.get("rel_a")]).toEqual([
      "release",
      "f11-2.0.0",
      "f11-1.9.0",
    ]);
    for (const a of await constats.locator("a").all()) expect(await a.getAttribute("href")).not.toContain("fired=");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement sur / à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(ACCUEIL_F11, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tuile-LCP")).toBeVisible({ timeout: 15_000 });
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    });
  }
});

test.describe("F12 — Vue d'ensemble : hero CWV et « Charge, erreurs et LCP »", () => {
  // Une app à elle : sur les 20 dernières heures, trois sessions par heure paire,
  // chacune avec un chargement ET un changement de route SPA, un LCP, un INP et un
  // CLS, sous deux releases ; des erreurs navigateur ; un déploiement dans la fenêtre.
  const APP_F12 = "e2e-f12-vue-ensemble";
  const ACCUEIL_F12 = `${consoleUrl}/?app=${APP_F12}&period=24h`;

  test.beforeAll(async () => {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "deploy_marker"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F12]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Vue d''ensemble F12 (e2e)') on conflict (app_id) do nothing`,
      [APP_F12],
    );
    for (let heure = 2; heure <= 20; heure += 2) {
      for (let k = 0; k < 3; k++) {
        const sid = `${APP_F12}-h${heure}-s${k}`;
        const release = heure <= 10 ? "f12-1.1" : "f12-1.0";
        // Au milieu de l'heure : jamais à cheval sur deux seaux.
        const quand = `now() - interval '${heure} hours' + interval '${10 + k * 5} minutes'`;
        await pool.query(
          `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, release)
           values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '3 minutes', 2, $3)
           on conflict (session_id) do nothing`,
          [sid, APP_F12, release],
        );
        await pool.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at, release)
           values ($1, $2, $3, '/catalogue', 'navigate', ${quand}, $4), ($5, $2, $3, '/produit', 'spa', ${quand} + interval '1 minute', $4)
           on conflict (span_id) do nothing`,
          [`${sid}-pv0`, sid, APP_F12, release, `${sid}-pv1`],
        );
        const mesures: [string, number][] = [
          ["LCP", (release === "f12-1.1" ? 2900 : 2000) + k * 50],
          ["INP", 180 + k * 20],
          ["CLS", 0.05 + k * 0.02],
        ];
        for (const [nom, valeur] of mesures) {
          await pool.query(
            `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts, release)
             values ($1, $2, $3, '/catalogue', $4, $5, ${quand}, $6) on conflict (span_id) do nothing`,
            [`${sid}-${nom}`, sid, APP_F12, nom, valeur, release],
          );
        }
        if (k === 0) {
          await pool.query(
            `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, error_source, ts, release)
             values ($1, $2, $3, '/produit', 'error', 'boom F12', 'TypeError', 'f12-fp', 2, 'browser_js', ${quand}, $4)
             on conflict (span_id) do nothing`,
            [`${sid}-err`, sid, APP_F12, release],
          );
        }
      }
    }
    await pool.query(
      `insert into deploy_marker (app_id, version, env, ts)
       values ($1, 'f12-1.1', 'prod', now() - interval '11 hours'), ($1, 'f12-1.0', 'prod', now() - interval '40 hours')`,
      [APP_F12],
    );
  });

  test("hero : trois petits multiples LCP / INP / CLS, chacun sur ses bandes de seuils", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto(ACCUEIL_F12, { waitUntil: "domcontentloaded" });
    const hero = page.getByTestId("hero-cwv");
    await expect(hero).toContainText("Core Web Vitals dans le temps");
    await expect(hero.locator('[role="img"]')).toHaveCount(3, { timeout: 15_000 });
    for (const nom of ["LCP", "INP", "CLS"]) {
      const serie = page.locator(`#hero-${nom} [data-testid="threshold-series"]`);
      await expect(serie).toHaveAttribute("data-vital", nom);
      await expect(serie.locator(".recharts-reference-area.bande-bon")).toBeVisible({ timeout: 15_000 });
    }
    // Le déploiement de la fenêtre est un repère cliquable : il compare sa release à la précédente.
    const annotation = page.locator("#hero-LCP").getByTestId("legende-annotations").getByRole("link", { name: /f12-1\.1/ });
    const href = new URL((await annotation.getAttribute("href"))!, consoleUrl);
    expect([href.searchParams.get("cmp"), href.searchParams.get("rel_b"), href.searchParams.get("rel_a")]).toEqual([
      "release",
      "f12-1.1",
      "f12-1.0",
    ]);
  });

  test("« Charge, erreurs et LCP » : trois panneaux, un axe chacun, le même nombre de seaux que le hero", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F12, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#charge-erreurs-lcp");
    await expect(figure.locator('[role="img"]')).toHaveCount(3, { timeout: 15_000 });
    const panneaux = figure.locator('[data-testid="stacked-bars"], [data-testid="threshold-series"]');
    await expect(panneaux).toHaveCount(3);
    const seaux = await panneaux.evaluateAll((els) => els.map((el) => el.getAttribute("data-seaux")));
    const seauxHero = await page.locator('#hero-LCP [data-testid="threshold-series"]').getAttribute("data-seaux");
    expect(new Set([...seaux, seauxHero]).size).toBe(1);
    // P5 : aucun graphique n'a deux axes y.
    await expect(figure.locator(".recharts-wrapper")).toHaveCount(3, { timeout: 15_000 });
    const axes = await figure.locator(".recharts-wrapper").evaluateAll((els) => els.map((el) => el.querySelectorAll(".recharts-yAxis").length));
    expect(axes.filter((n) => n > 1)).toEqual([]);
    await expect(figure).toContainText("Le LCP n'est mesuré qu'au chargement");
    await expect(figure.getByTestId("panneau-vues")).toContainText("Changements de route SPA");
  });

  test("cmp=release : le hero trace deux séries, la release B et la référence A", async ({ page }) => {
    await login(page);
    await page.goto(`${ACCUEIL_F12}&cmp=release&rel_a=f12-1.0&rel_b=f12-1.1`, { waitUntil: "domcontentloaded" });
    const lcp = page.locator("#hero-LCP");
    await expect(lcp.locator("path.recharts-line-curve")).toHaveCount(2, { timeout: 15_000 });
    await expect(lcp.getByTestId("legende-serie")).toContainText("Release f12-1.1");
    await expect(lcp.getByTestId("legende-serie")).toContainText("Release f12-1.0");
  });

  test("un clic sur un seau du hero zoome sur sa plage (from/to, plus de period)", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F12, { waitUntil: "domcontentloaded" });
    const surface = page.locator("#hero-LCP .recharts-surface").first();
    await expect(surface).toBeVisible({ timeout: 15_000 });
    await surface.scrollIntoViewIfNeeded();
    const boite = await surface.boundingBox();
    if (!boite) throw new Error("graphique sans boîte");
    await page.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.mouse.click(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.waitForURL((u) => u.searchParams.has("from") && u.searchParams.has("to"), { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.searchParams.get("app")).toBe(APP_F12);
    expect(u.searchParams.has("period")).toBe(false);
    await expect(page.locator("h1").first()).toHaveText(/Vue d'ensemble/);
  });

  for (const largeur of LARGEURS) {
    test(`hero et panneaux : aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(ACCUEIL_F12, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#charge-erreurs-lcp .recharts-surface").first()).toBeVisible({ timeout: 15_000 });
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    });
  }
});

test.describe("F13 — Vue d'ensemble : segments, release, angle mort, historique", () => {
  // Une app à elle, sous UNE seule release (la comparaison doit se taire), sur trois
  // heures closes : `/lent` (90 mesures LCP à 3 s, le robot dit « ok » chaque heure :
  // trois heures en angle mort) et `/rapide` (120 mesures à 1,2 s) — gravité et volume
  // en ordres OPPOSÉS. Sessions françaises : l'onglet « Pays estimé » a un groupe FR.
  const APP_F13 = "e2e-f13-vue-ensemble";
  const ACCUEIL_F13 = `${consoleUrl}/?app=${APP_F13}&period=24h`;

  test.beforeAll(async () => {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_session", "syn_snapshot", "deploy_marker"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F13]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Vue d''ensemble F13 (e2e)') on conflict (app_id) do nothing`,
      [APP_F13],
    );
    const routes = [
      { route: "/lent", parHeure: 30, lcp: 3000 },
      { route: "/rapide", parHeure: 40, lcp: 1200 },
    ];
    for (const heure of [2, 3, 4]) {
      // Heure close, en son milieu : jamais à cheval sur deux seaux.
      const quand = `date_trunc('hour', now()) - interval '${heure} hours' + interval '20 minutes'`;
      for (const r of routes) {
        const sid = `${APP_F13}-h${heure}${r.route.replace("/", "-")}`;
        await pool.query(
          `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, release, geo_country)
           values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '5 minutes', 1, 'f13-1.0', 'FR')
           on conflict (session_id) do nothing`,
          [sid, APP_F13],
        );
        await pool.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at, release)
           values ($1, $2, $3, $4, 'navigate', ${quand}, 'f13-1.0') on conflict (span_id) do nothing`,
          [`${sid}-pv`, sid, APP_F13, r.route],
        );
        await pool.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts, release)
           select $1 || '-' || g, $2, $3, $4, 'LCP', $5, ${quand} + make_interval(secs => g), 'f13-1.0'
             from generate_series(1, $6::int) g
           on conflict (span_id) do nothing`,
          [`${sid}-lcp`, sid, APP_F13, r.route, r.lcp, r.parHeure],
        );
      }
      // Le robot passe sur `/lent` à la même heure, et le dit « ok ».
      await pool.query(
        `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
         values ($1, 'recette F13', 'Parcours lent', 'Parcours lent', '/lent', 95, 'ok', 700, ${quand})`,
        [APP_F13],
      );
    }
  });

  test("segments : gravité par défaut, tri=volume sur demande ; une route ouvre /pages filtré sur elle", async ({ page }) => {
    await login(page);
    await page.goto(`${ACCUEIL_F13}&split=route`, { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("impact-table");
    await expect(table).toHaveAttribute("data-tri", "gravite", { timeout: 15_000 });
    const libelles = () =>
      table.getByTestId("impact-ligne").evaluateAll((els) => els.map((el) => el.querySelector("span")?.textContent?.trim() ?? ""));
    expect(await libelles()).toEqual(["/lent", "/rapide"]);
    // Une route ouvre /pages filtré sur elle, population et plage gardées. Le panneau
    // route (`panel=route:<r>`, § 3.3) attend F17 : `/pages` ne le lit pas encore.
    const href = new URL((await table.getByTestId("impact-ligne").first().locator("a").getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("route")).toBe("/lent");
    expect(href.searchParams.get("panel")).toBeNull();
    expect(href.searchParams.get("app")).toBe(APP_F13);

    await table.getByTestId("tri-volume").click();
    await page.waitForURL((u) => u.searchParams.get("tri") === "volume", { timeout: 15_000 });
    await expect(page.getByTestId("impact-table")).toHaveAttribute("data-tri", "volume");
    expect(await libelles()).toEqual(["/rapide", "/lent"]);
  });

  test("onglet « Pays estimé » : une ligne ouvre /pages filtré par country=", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F13, { waitUntil: "domcontentloaded" });
    await page.getByTestId("breakdown-tab-country").click();
    await page.waitForURL((u) => u.searchParams.get("split") === "country", { timeout: 15_000 });
    const ligne = page.getByTestId("impact-table").getByTestId("impact-ligne").filter({ hasText: "FR" });
    const href = new URL((await ligne.locator("a").getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("country")).toBe("FR");
    expect(href.searchParams.get("app")).toBe(APP_F13);
  });

  test("une seule release sur la fenêtre : la comparaison est désactivée, avec sa raison", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F13, { waitUntil: "domcontentloaded" });
    const zone = page.getByTestId("zone-release");
    await expect(zone).toContainText("Nouvelle release face à la précédente", { timeout: 15_000 });
    await expect(zone.getByTestId("release-indisponible")).toContainText("moins de deux releases");
  });

  test("angle mort : un compte exact, la règle écrite, la tuile ouvre /correlation#angles-morts", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F13, { waitUntil: "domcontentloaded" });
    const angle = page.getByTestId("angle-mort");
    await expect(angle.getByTestId("kpi-valeur")).toHaveText("3", { timeout: 15_000 });
    await expect(angle).toContainText("borne Bon de lib/rating.ts");
    const tuile = new URL((await angle.getByTestId("kpi-tile").getAttribute("href"))!, consoleUrl);
    expect(tuile.pathname).toBe("/correlation");
    expect(tuile.hash).toBe("#angles-morts");
    expect(tuile.searchParams.get("app")).toBe(APP_F13);
    const pire = new URL((await angle.getByTestId("angle-mort-pire").locator("a").getAttribute("href"))!, consoleUrl);
    // `serie` = `<app>:<route>` encodés un à un (CR7-a, `ecrireSerie`).
    expect(pire.searchParams.get("serie")).toBe(`${APP_F13}:%2Flent`);
  });

  test("historique 14 jours fixes dit sans survol ; anomalies : la section existe toujours", async ({ page }) => {
    await login(page);
    await page.goto(ACCUEIL_F13, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("historique-fenetre")).toContainText("14 jours fixes, indépendants de la période", {
      timeout: 15_000,
    });
    await expect(page.locator("details#anomalies")).toHaveCount(1);
    // Ni « Volume & fiabilité par jour », ni « p75 LCP par jour » : le quotidien vit sur Tendances.
    await expect(page.getByTestId("traffic-timeseries")).toHaveCount(0);
  });

  for (const largeur of LARGEURS) {
    test(`segments, release et angle mort : aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(ACCUEIL_F13, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("impact-table")).toBeVisible({ timeout: 15_000 });
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    });
  }
});
