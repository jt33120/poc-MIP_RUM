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
    // Le zoom lit `activeLabel` : recharts ne le renseigne qu'une fois le survol
    // enregistré. Cliquer dans la foulée du `move` partait donc parfois sans seau
    // actif (vert en local, rouge en CI, plus lente). L'infobulle est le témoin de
    // cet état : elle n'existe dans le DOM que quand un seau est actif.
    const x = boite.x + boite.width * 0.6;
    const y = boite.y + boite.height * 0.5;
    await page.mouse.move(x, y);
    await expect(page.locator("#hero-LCP .recharts-tooltip-wrapper > *").first()).toBeVisible({ timeout: 15_000 });
    await page.mouse.click(x, y);
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

  test("segments : gravité par défaut, tri=volume sur demande ; une route ouvre son panneau sur /pages", async ({ page }) => {
    await login(page);
    await page.goto(`${ACCUEIL_F13}&split=route`, { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("impact-table");
    await expect(table).toHaveAttribute("data-tri", "gravite", { timeout: 15_000 });
    const libelles = () =>
      table.getByTestId("impact-ligne").evaluateAll((els) => els.map((el) => el.querySelector("span")?.textContent?.trim() ?? ""));
    expect(await libelles()).toEqual(["/lent", "/rapide"]);
    // Une route ouvre son PANNEAU sur /pages (`panel=route:<r>`, § 3.3, F17),
    // population et plage gardées ; l'écran n'est PAS filtré sur elle.
    const href = new URL((await table.getByTestId("impact-ligne").first().locator("a").getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/pages");
    expect(href.searchParams.get("panel")).toBe("route:%2Flent");
    expect(href.searchParams.get("route")).toBeNull();
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

test.describe("F18 — Erreurs : KPI, hero, répartition", () => {
  // Deux apps à ce bloc : six groupes du MÊME type « Error » (la légende doit les
  // distinguer par leur message), et une app aux seules erreurs backend, sans
  // session (sessions touchées INCONNUES, jamais 0).
  const APP = "f18-e2e-erreurs";
  const APP_BACKEND = "f18-e2e-backend";
  const OCCURRENCES = [30, 20, 12, 8, 5, 2];

  test.beforeAll(async () => {
    for (const app of [APP, APP_BACKEND]) {
      for (const t of ["rum_error", "rum_pageview", "rum_session", "error_status"]) {
        await pool.query(`delete from ${t} where app_id = $1`, [app]);
      }
      await pool.query(`insert into app_registry (app_id, name) values ($1, $2) on conflict (app_id) do nothing`, [
        app,
        `F18 ${app}`,
      ]);
    }
    for (const [i, occ] of OCCURRENCES.entries()) {
      const sid = `${APP}-s${i}`;
      const quand = `now() - interval '${30 + i * 20} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 1)`,
        [sid, APP],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, '/panier', ${quand})`,
        [`${sid}-pv`, sid, APP],
      );
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, ts)
         values ($1, $2, $3, '/panier', 'error', $4, 'Error', $5, $6, ${quand})`,
        [`${sid}-err`, sid, APP, `Échec du paiement, étape ${i + 1}`, `f18fp${i}aaaaaaaa`, occ],
      );
    }
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, ts)
         values ($1, null, $2, '/api/commande', 'error', 'timeout base', 'Error', 'f18backend', 1, now() - interval '${40 + i} minutes')`,
        [`${APP_BACKEND}-err${i}`, APP_BACKEND],
      );
    }
  });

  /** La tuile dont le libellé est exactement `libelle`. */
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ has: page.getByText(libelle, { exact: true }) });

  test("quatre tuiles : les occurrences sont une somme, sans « % » ni couleur de verdict", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await expect(page.getByTestId("kpi-erreurs").getByTestId("kpi-tile")).toHaveCount(4);
    const occurrences = tuile(page, "Occurrences");
    await expect(occurrences.getByTestId("kpi-valeur")).toHaveText("77");
    await expect(occurrences.getByTestId("kpi-valeur")).not.toContainText("%");
    await expect(page.getByTestId("kpi-erreurs").locator('[data-ton="bad"]')).toHaveCount(0);
    await expect(page.getByTestId("kpi-erreurs-plage")).toContainText("24 h");
    // La part nomme son dénominateur.
    await expect(tuile(page, "Part des sessions touchées")).toContainText("sur 6 sessions avec au moins une vue");
  });

  test("hero : ≤ 5 séries, légende par message — plus jamais « Error » en double", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    const hero = page.locator("#hero-erreurs");
    await hero.scrollIntoViewIfNeeded();
    // Les entrées de SÉRIES : la légende ajoute « seau en cours (barre pâle) » quand
    // le dernier seau de la fenêtre glissante n'est pas fini (le cas sous `period=24h`).
    // Ce n'est pas une série : elle n'entre pas dans le compte des ≤ 5.
    const legende = hero.getByTestId("legende-serie").locator("li:not([data-testid=legende-seau-en-cours])");
    await expect(legende).toHaveCount(5); // 4 groupes + « Autres groupes (somme) »
    const textes = (await legende.allInnerTexts()).map((t) => t.trim());
    expect(new Set(textes).size).toBe(textes.length);
    expect(textes).not.toContain("Error");
    expect(textes[0]).toContain("Échec du paiement, étape 1");
    expect(textes.at(-1)).toBe("Autres groupes (somme)");
    // Un groupe mène à son groupe ; « Autres » n'est pas un groupe, pas un lien.
    await expect(hero.getByTestId("legende-serie").getByRole("link")).toHaveCount(4);
    await expect(hero.getByTestId("legende-serie").getByRole("link").first()).toHaveAttribute("href", /^\/errors\/f18fp0/);
    await expect(hero).toContainText("4 groupes les plus fréquents sur 24 h");
  });

  test("sessions_affected null → « Inconnu », jamais 0 ; part sans vue → raison, jamais 0 %", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP_BACKEND}`);
    const sessions = tuile(page, "Sessions touchées");
    await expect(sessions).toContainText("Inconnu");
    await expect(sessions.getByTestId("kpi-valeur")).toHaveText("—");
    const part = tuile(page, "Part des sessions touchées");
    await expect(part).toContainText("aucune session avec vue");
    await expect(part.getByTestId("kpi-valeur")).toHaveText("—");
  });

  test("tuiles → liste : « Groupes apparus » restreint la liste, « Sessions touchées » la trie", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await tuile(page, "Groupes apparus sur la période").click();
    await expect(page).toHaveURL(/nouveaux=1/);
    await expect(page.locator('[data-testid^="error-group-"]')).toHaveCount(6);
    await expect(page.locator("#groupes-erreurs")).toContainText("apparus sur la période");

    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await tuile(page, "Sessions touchées").click();
    await expect(page).toHaveURL(/tri=sessions/);
    await expect(page.getByTestId("tri-sessions")).toHaveAttribute("aria-current", "true");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(`${consoleUrl}/errors?app=${APP}`);
      await expect(page.getByTestId("kpi-erreurs")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

test.describe("F22 — Interactions : onglets, Frustration KPI, règles, hero", () => {
  // Deux apps à ce bloc : une app navigateur (signaux sur deux routes) et une app
  // aux seules sessions React Native, dont le capteur n'émet aucun signal.
  const APP = "f22-e2e-web";
  const APP_MOBILE = "f22-e2e-mobile";

  test.beforeAll(async () => {
    for (const app of [APP, APP_MOBILE]) {
      for (const t of ["rum_event", "rum_pageview", "rum_session"]) {
        await pool.query(`delete from ${t} where app_id = $1`, [app]);
      }
      await pool.query(`insert into app_registry (app_id, name) values ($1, $2) on conflict (app_id) do nothing`, [
        app,
        `F22 ${app}`,
      ]);
    }
    // [session, app, runtime, routes vues, signaux [route, type, cible]]
    const sessions: [string, string, string, string[], [string, string, string][]][] = [
      ["w1", APP, "browser", ["/panier"], [["/panier", "rage", "Payer"], ["/panier", "rage", "Payer"]]],
      ["w2", APP, "browser", ["/panier", "/"], [["/", "dead", "Logo"]]],
      ["w3", APP, "browser", ["/"], [["/", "error", "Valider"]]],
      ["w4", APP, "browser", ["/"], []],
      ["m1", APP_MOBILE, "react_native", ["Accueil"], []],
      ["m2", APP_MOBILE, "react_native", ["Panier"], []],
    ];
    for (const [i, [nom, app, runtime, routes, signaux]] of sessions.entries()) {
      const sid = `${app}-${nom}`;
      const quand = `now() - interval '${30 + i * 10} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, runtime)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, $3, $4)`,
        [sid, app, routes.length, runtime],
      );
      for (const [k, route] of routes.entries()) {
        await pool.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, ${quand})`,
          [`${sid}-pv${k}`, sid, app, route],
        );
      }
      for (const [k, [route, type, cible]] of signaux.entries()) {
        await pool.query(
          `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
           values ($1, $2, $3, $4, $5, $6, ${quand})`,
          [`${sid}-sig${k}`, sid, app, route, `frustration.${type}`, { target: cible, count: 1 }],
        );
      }
    }
  });

  /** La tuile dont le libellé est exactement `libelle`. */
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ has: page.getByText(libelle, { exact: true }) });

  test("onglets Frustration / Actions : les filtres suivent, dans les deux sens", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/ux?app=${APP}&period=7d&device=desktop`);
    const onglets = page.getByTestId("onglets-interactions");
    await expect(onglets.getByRole("link", { name: "Frustration" })).toHaveAttribute("aria-current", "page");
    await onglets.getByRole("link", { name: "Actions" }).click();
    await expect(page).toHaveURL(/\/actions\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("app")).toBe(APP);
    expect(url.searchParams.get("period")).toBe("7d");
    expect(url.searchParams.get("device")).toBe("desktop");
    const retour = page.getByTestId("onglets-interactions").getByRole("link", { name: "Frustration" });
    await expect(retour).toHaveAttribute("href", /period=7d/);
    await expect(retour).toHaveAttribute("href", /device=desktop/);
  });

  test("tuiles : comptes entiers, sessions en sous-texte, lien vers le hero filtré par type", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/ux?app=${APP}`);
    await expect(tuile(page, "Rage clicks").getByTestId("kpi-valeur")).toHaveText("2");
    await expect(tuile(page, "Rage clicks")).toContainText("2 signaux, 1 session");
    await expect(page.getByTestId("ligne-sdk-desactive")).toContainText("frustration: false");
    await tuile(page, "Rage clicks").click();
    await expect(page).toHaveURL(/type=rage/);
    await expect(page.getByTestId("filtre-type").locator('[aria-current="true"]')).toHaveText("Rage clicks");
  });

  test("règles de détection écrites depuis les constantes du SDK", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/ux?app=${APP}`);
    const regles = page.getByTestId("regles-detection");
    await regles.locator("summary").click();
    await expect(regles).toContainText(/3 clics sur la même cible en 1\s*s/);
    await expect(regles).toContainText(/1,5\s*s/);
  });

  test("hero : routes classées par part de sessions touchées", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/ux?app=${APP}`);
    const hero = page.locator("#routes-frustrantes");
    await hero.scrollIntoViewIfNeeded();
    await expect(hero).toContainText("/panier");
    await expect(hero).toContainText("Ensemble");
  });

  test("sessions React Native seules : « Non collecté », et aucun « 0 » de signal", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/ux?app=${APP_MOBILE}`);
    const rangee = page.getByTestId("kpi-interactions");
    await expect(rangee.getByTestId("signaux-non-collectes")).toContainText("Non collecté");
    await expect(tuile(page, "Rage clicks")).toHaveCount(0);
    await expect(tuile(page, "Dead clicks")).toHaveCount(0);
    await expect(tuile(page, "Error clicks")).toHaveCount(0);
    for (const valeur of await rangee.getByTestId("kpi-valeur").allInnerTexts()) expect(valeur.trim()).not.toBe("0");
    await expect(page.locator("#routes-frustrantes")).toContainText("Non collecté");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(`${consoleUrl}/ux?app=${APP}`);
      await expect(page.getByTestId("kpi-interactions")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

test.describe("F26 — Satisfaction", () => {
  // Deux apps À CE BLOC : l'une a des avis sur quatre pages, dont DEUX seulement ont
  // au moins 10 avis et un LCP mesuré (le nuage doit alors se taire, « partiel ») et
  // une qui n'a reçu qu'un commentaire sans note ; l'autre n'a aucun avis (CSAT « — »).
  const APP_F26 = "f26-e2e-satisfaction";
  const APP_F26_VIDE = "f26-e2e-sans-avis";
  const SESSION_F26 = "f26-e2e-session";

  async function nettoyerF26() {
    for (const table of ["rum_event", "rum_metric", "rum_session"]) {
      await pool.query(`delete from ${table} where app_id = any($1::text[])`, [[APP_F26, APP_F26_VIDE]]);
    }
  }

  test.beforeAll(async () => {
    await nettoyerF26();
    await pool.query(
      `insert into app_registry (app_id, name, active)
       values ($1, 'Satisfaction E2E', true), ($2, 'Satisfaction E2E (sans avis)', true)
       on conflict (app_id) do nothing`,
      [APP_F26, APP_F26_VIDE],
    );
    await pool.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at)
       values ($1, $2, 'desktop', false, now() - interval '40 minutes', now() - interval '5 minutes')`,
      [SESSION_F26, APP_F26],
    );
    // Un LCP mesuré sur trois pages : la jointure LCP × CSAT a de quoi se faire.
    for (const [route, lcp] of [["/f26-a", 1800], ["/f26-b", 3200], ["/f26-c", 5000]] as const) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         values ($1, $2, $3, $4, 'LCP', $5, 'good', now() - interval '20 minutes')`,
        [`f26-e2e-lcp${route.replace("/", "-")}`, SESSION_F26, APP_F26, route, lcp],
      );
    }
    // 12 avis sur /f26-a, 10 sur /f26-b (éligibles), 4 sur /f26-c (non), un commentaire seul.
    const avis: [string, number | null][] = [
      ...Array.from({ length: 12 }, (_v, i): [string, number | null] => ["/f26-a", [5, 4, 2, 5][i % 4]]),
      ...Array.from({ length: 10 }, (_v, i): [string, number | null] => ["/f26-b", [1, 3, 4, 5, 2][i % 5]]),
      ...Array.from({ length: 4 }, (_v, i): [string, number | null] => ["/f26-c", [4, 5][i % 2]]),
      ["/f26-commentaire", null],
    ];
    for (const [i, [route, score]] of avis.entries()) {
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
         values ($1, $2, $3, $4, 'feedback', $5::jsonb, now() - make_interval(mins => $6::int))`,
        [
          `f26-e2e-fb-${i}`,
          SESSION_F26,
          APP_F26,
          route,
          JSON.stringify({ score, comment: score === null ? "Commentaire sans note (e2e)" : `Avis ${score}/5 (e2e)` }),
          10 + (i % 30),
        ],
      );
    }
  });

  test.afterAll(async () => {
    await nettoyerF26();
  });

  test("KPI, hero à deux panneaux, nuage partiel sous trois pages éligibles, table sans « 0 % »", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`${consoleUrl}/experience?app=${APP_F26}&period=24h`);
    await expect(page.getByRole("heading", { name: "Satisfaction", level: 1 })).toBeVisible();

    const tuiles = page.getByTestId("satisfaction-kpi").getByTestId("kpi-tile");
    await expect(tuiles).toHaveCount(4);
    await expect(tuiles.first()).toContainText("Satisfaction (CSAT)");
    await expect(tuiles.first().getByTestId("kpi-valeur")).toContainText("%");

    // Hero : deux panneaux sur la MÊME grille (P5 : pas de double axe).
    const hero = page.locator("#satisfaction-dans-le-temps");
    await expect(hero.getByTestId("threshold-series")).toHaveCount(2);
    const seaux = await hero.getByTestId("threshold-series").evaluateAll((els) => els.map((e) => e.getAttribute("data-seaux")));
    expect(new Set(seaux).size).toBe(1);

    // Moins de trois pages avec au moins 10 avis : pas de nuage, et on le dit.
    const nuage = page.locator("#ressenti-face-au-lcp");
    await expect(nuage).toHaveAttribute("data-etat", "partiel");
    await expect(nuage).toContainText("moins de trois pages avec au moins 10 avis : pas de nuage");
    await expect(nuage).toContainText("2 page(s) éligible(s)");

    // Page à commentaire seul : pas de CSAT — « — », jamais « 0 % ».
    const commentaire = page.getByTestId("impact-ligne").filter({ hasText: "/f26-commentaire" });
    await expect(commentaire).toContainText("commentaires sans note");
    await expect(commentaire).not.toContainText("%");

    // Chaque verbatim porte sa date ; aucun score composite.
    await expect(page.locator("#verbatims")).toContainText(/\d{2}\/\d{2} \d{2}:\d{2} UTC/);
    await expect(page.getByText("/100")).toHaveCount(0);
  });

  test("sans avis : CSAT « — » et sa raison, carte d'installation, courbe non tracée", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/experience?app=${APP_F26_VIDE}&period=24h`);
    const csat = page.getByTestId("satisfaction-kpi").getByTestId("kpi-tile").first();
    await expect(csat.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(csat).toContainText("aucun avis noté");
    await expect(page.getByTestId("carte-installation")).toBeVisible();
    await expect(page.getByTestId("xp-unavailable")).toBeVisible();
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/experience?app=${APP_F26}&period=24h`);
      await expect(page.getByRole("heading", { name: "Satisfaction", level: 1 })).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});

// F14 — Pages : KPI, sélecteur de vital, hero classé (plan § 5.2.1-5.2.2, zones 1-4).
// Données SYNTHÉTIQUES, ordres LCP et INP OPPOSÉS — sinon « vital=INP re-trie »
// passerait avec n'importe quel tri :
//   /f14-lcp-lente  40 mesures, LCP 4,5 s, INP  80 ms → 1re en LCP, 2e en INP
//   /f14-inp-lente  40 mesures, LCP 1,5 s, INP 450 ms → 2e en LCP, 1re en INP
//   /f14-rapide     60 mesures, LCP 0,9 s, INP  50 ms → 3e partout
test.describe("F14 — Pages : KPI, sélecteur de vital, hero classé", () => {
  const APP_F14 = "f14-e2e-pages";
  const PAGES_F14 = `${consoleUrl}/pages?app=${APP_F14}&period=24h`;
  const ROUTES_F14 = [
    { route: "/f14-lcp-lente", n: 40, lcp: 4500, inp: 80 },
    { route: "/f14-inp-lente", n: 40, lcp: 1500, inp: 450 },
    { route: "/f14-rapide", n: 60, lcp: 900, inp: 50 },
  ] as const;

  async function semerF14() {
    for (const t of ["rum_metric", "rum_pageview", "rum_longtask", "rum_resource", "rum_error", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F14]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Pages F14 E2E') on conflict (app_id) do nothing`,
      [APP_F14],
    );
    for (const r of ROUTES_F14) {
      const prefixe = `${APP_F14}${r.route.replace(/\//g, "-")}`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         select $1 || '-s' || g, $2, $1 || '-v' || g, 'desktop', false,
                now() - interval '2 hours', now() - interval '110 minutes', 1
           from generate_series(1, $3::int) g
         on conflict (session_id) do nothing`,
        [prefixe, APP_F14, r.n],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
         select $1 || '-pv' || g, $1 || '-s' || g, $2, $3, 'navigate', now() - interval '2 hours'
           from generate_series(1, $4::int) g
         on conflict (span_id) do nothing`,
        [prefixe, APP_F14, r.route, r.n],
      );
      for (const [nom, valeur, rating] of [
        ["LCP", r.lcp, r.lcp > 4000 ? "poor" : r.lcp > 2500 ? "needs-improvement" : "good"],
        ["INP", r.inp, r.inp > 500 ? "poor" : r.inp > 200 ? "needs-improvement" : "good"],
      ] as const) {
        await pool.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
           select $1 || '-' || $4 || g, $1 || '-s' || g, $2, $3, $4, $5, $6, now() - interval '2 hours' + interval '1 minute'
             from generate_series(1, $7::int) g
           on conflict (span_id) do nothing`,
          [prefixe, APP_F14, r.route, nom, valeur, rating, r.n],
        );
      }
    }
  }

  /** Routes du hero, dans l'ordre affiché (le premier <span> d'une ligne est son libellé). */
  async function ordreF14(page: Page): Promise<string[]> {
    const lignes = page.getByTestId("hero-routes").getByTestId("impact-ligne");
    await expect(lignes).toHaveCount(ROUTES_F14.length);
    return lignes.evaluateAll((els) => els.map((el) => el.querySelector("span")?.textContent?.trim() ?? ""));
  }

  test.beforeAll(async () => {
    await semerF14();
  });

  test("vital=LCP par défaut : une seule liste de routes, classée par gravité", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F14, { waitUntil: "domcontentloaded" });
    const hero = page.getByTestId("hero-routes");
    await expect(hero).toHaveAttribute("data-vital", "LCP");
    expect(await ordreF14(page)).toEqual(["/f14-lcp-lente", "/f14-inp-lente", "/f14-rapide"]);
    // Les trois listes d'avant ont fusionné : ni découpage, ni table « Par route ».
    await expect(page.getByTestId("impact-table")).toHaveCount(1);
    await expect(page.getByTestId("breakdown")).toHaveCount(0);
    await expect(page.getByTestId("route-drill")).toHaveCount(0);
    // La ligne « Ensemble » est lue à part, non classée.
    await expect(hero.getByTestId("impact-reference")).toContainText("Ensemble");

    const tuiles = page.getByTestId("kpi-pages");
    await expect(tuiles).toContainText("LCP p75 (ensemble)");
    await expect(tuiles).toContainText("Pages vues");
    // Le dénominateur est écrit dans la tuile ; une seule route au-delà de 2,5 s.
    const auDela = tuiles.getByTestId("kpi-tile").filter({ hasText: "Routes au-delà de « Bon »" });
    await expect(auDela.getByTestId("kpi-valeur")).toHaveText("1");
    await expect(auDela).toContainText("sur 3 routes classées, 0 à faible effectif");
  });

  test("vital=INP re-trie le classement, et la tuile suit le vital", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F14, { waitUntil: "domcontentloaded" });
    await page.getByTestId("selecteur-vital").getByRole("button", { name: "INP", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("vital") === "INP", { timeout: 15_000 });
    await expect(page.getByTestId("hero-routes")).toHaveAttribute("data-vital", "INP");
    expect(await ordreF14(page)).toEqual(["/f14-inp-lente", "/f14-lcp-lente", "/f14-rapide"]);
    await expect(page.getByTestId("kpi-pages")).toContainText("INP p75 (ensemble)");
    // La plage et l'app sont restées.
    const sp = new URL(page.url()).searchParams;
    expect([sp.get("app"), sp.get("period")]).toEqual([APP_F14, "24h"]);
  });

  test("vital=FCP : classement désactivé avec sa raison, tuile des routes sans chiffre", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F14}&vital=FCP`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("classement-indisponible")).toContainText(
      "classement FCP non disponible : le découpage ne lit que LCP, INP, CLS",
    );
    await expect(page.getByTestId("impact-table")).toHaveCount(0);
    const auDela = page.getByTestId("kpi-tile").filter({ hasText: "Routes au-delà de « Bon »" });
    await expect(auDela.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(auDela.getByTestId("kpi-raison")).toContainText("classement FCP non disponible");
    await expect(page.getByTestId("selecteur-vital").getByRole("button", { name: "FCP", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("une ligne ouvre le panneau de la route avec la même plage et le même vital", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/pages?app=${APP_F14}&period=7d&vital=INP`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("hero-routes").getByTestId("impact-ligne").first().getByRole("link").click();
    // F17 : la ligne OUVRE la route à côté du classement (§ 5.2.3) ; elle ne filtre
    // plus l'écran — c'est « Ouvrir en page », dans le panneau, qui pose `route=`.
    await page.waitForURL((u) => u.searchParams.get("panel") === "route:%2Ff14-inp-lente", { timeout: 15_000 });
    const sp = new URL(page.url()).searchParams;
    expect([sp.get("app"), sp.get("period"), sp.get("vital")]).toEqual([APP_F14, "7d", "INP"]);
    await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(ROUTES_F14.length);
    await page.getByTestId("detail-panel").getByTestId("detail-panel-page").click();
    await page.waitForURL((u) => u.searchParams.get("route") === "/f14-inp-lente", { timeout: 15_000 });
    await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(1);
  });

  test("tri=volume : ordre du nombre de mesures, bascule marquée", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F14}&tri=volume`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tri-volume")).toHaveAttribute("aria-current", "true");
    expect((await ordreF14(page))[0]).toBe("/f14-rapide");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px (LCP et FCP)`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      const fautes: string[] = [];
      for (const suffixe of ["", "&vital=FCP"]) {
        await page.goto(`${PAGES_F14}${suffixe}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kpi-pages")).toBeVisible();
        for (const faute of await debordements(page)) fautes.push(`/pages${suffixe} @ ${largeur} px — ${faute}`);
      }
      expect(fautes).toEqual([]);
    });
  }
});

// F15 — Pages : distributions, percentiles, TTFB, type de navigation (§ 5.2.2, zones 5-7).
// Données SYNTHÉTIQUES : un LCP très court (30 à 69 ms, comme la démo) — le plafond
// d'affichage doit alors passer au p99 arrondi, sans quoi tout tomberait dans le premier
// bac ; cinq phases réseau (pas de redirection : sa ligne reste « — ») ; sur
// /f15-produit, une vue de chargement ET un changement de route SPA par session, soit
// N_F15 (40) chargements, 40 SPA, 0 type inconnu, 80 vues.
test.describe("F15 — Pages : distributions, percentiles, TTFB, type de navigation", () => {
  const APP_F15 = "f15-e2e-pages";
  const PAGES_F15 = `${consoleUrl}/pages?app=${APP_F15}&period=24h`;
  const N_F15 = 40;

  async function semerF15() {
    for (const t of ["rum_metric", "rum_pageview", "rum_longtask", "rum_resource", "rum_error", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F15]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Pages F15 E2E') on conflict (app_id) do nothing`,
      [APP_F15],
    );
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       select $1 || '-s' || g, $1, $1 || '-v' || g, 'desktop', false,
              now() - interval '2 hours', now() - interval '110 minutes', 2
         from generate_series(1, $2::int) g
       on conflict (session_id) do nothing`,
      [APP_F15, N_F15],
    );
    // Une vue de chargement et un changement de route SPA par session.
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
       select $1 || '-pv' || g || '-' || t, $1 || '-s' || g, $1, '/f15-produit', t, now() - interval '2 hours'
         from generate_series(1, $2::int) g, unnest(array['navigate', 'spa']) t
       on conflict (span_id) do nothing`,
      [APP_F15, N_F15],
    );
    // Valeur de la mesure g : LCP 30 + g ms ; phases constantes ; FCP 500 ms.
    for (const [nom, expr] of [
      ["LCP", "29 + g"],
      ["INP", "40"],
      ["CLS", "0.01"],
      ["FCP", "500"],
      ["DNS", "10"],
      ["TCP", "20"],
      ["TLS", "30"],
      ["REQUEST", "50"],
      ["RESPONSE", "60"],
    ] as const) {
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
         select $1 || '-' || $2 || g, $1 || '-s' || g, $1, '/f15-produit', $2, ${expr}, 'good',
                now() - interval '2 hours' + interval '1 minute'
           from generate_series(1, $3::int) g
         on conflict (span_id) do nothing`,
        [APP_F15, nom, N_F15],
      );
    }
  }

  test.beforeAll(async () => {
    await semerF15();
  });

  test("distributions : repères p50 / p75 / p95 étiquetés, plafond adaptatif dit, bacs non cliquables", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F15, { waitUntil: "domcontentloaded" });
    const lcp = page.locator("#distribution-lcp");
    for (const repere of ["p50", "p75", "p95"]) {
      await expect(lcp.locator(`[data-repere="${repere}"]`)).toHaveCount(1);
      await expect(lcp.locator(`[data-repere="${repere}"] text`)).toContainText(repere);
    }
    // LCP p95 ≈ 67 ms < 6 000 / 10 : le plafond passe au p99 arrondi (100 ms), et le dit.
    await expect(lcp.getByTestId("distribution-plafond")).toContainText("p99 arrondi");
    await expect(lcp.locator("svg a, svg [role='link']")).toHaveCount(0);
    await expect(lcp.getByTestId("distribution-explorer")).toHaveAttribute("href", /\/explorer\?.*viz=table/);
    await expect(page.locator("#distribution-inp")).toBeVisible();
    await expect(page.locator("#distribution-cls")).toBeVisible();
  });

  test("vital=FCP : la troisième distribution est celle du FCP", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F15}&vital=FCP`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#distribution-fcp")).toBeVisible();
    await expect(page.locator("#distribution-cls")).toHaveCount(0);
  });

  test("TTFB : une barre par phase, non empilées, et la phrase qui interdit la somme", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F15, { waitUntil: "domcontentloaded" });
    const ttfb = page.locator("#figure-ttfb");
    await expect(ttfb.getByTestId("ttfb-phrase")).toContainText("leur somme n'est pas le TTFB");
    const phases = ttfb.getByTestId("ttfb-phases");
    for (const libelle of ["Redirection", "DNS", "Connexion TCP", "TLS", "Requête", "Réponse"]) await expect(phases).toContainText(libelle);
    // La redirection n'est pas mesurée : « — », jamais 0 ms.
    await ttfb.getByText("Alternative textuelle").click();
    await expect(ttfb.locator("table tr", { hasText: "Redirection" })).toContainText("—");
  });

  test("vues par type de navigation : « Ensemble » en tête, chargements et SPA séparés", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F15, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#figure-navigation");
    await expect(figure).toContainText("Le LCP n'est mesuré qu'au chargement");
    await figure.getByText("Alternative textuelle").click();
    const lignes = figure.locator("table tbody tr");
    await expect(lignes.first()).toContainText("Ensemble");
    // Cellule par cellule (Chargements, SPA, Inconnu, Total) : un `toContainText` sur la
    // ligne entière accepterait n'importe quel chiffre qui en contient un autre.
    const n = String(N_F15);
    await expect(figure.locator("table tbody tr", { hasText: "/f15-produit" }).locator("td")).toHaveText([
      n,
      n,
      "0",
      String(2 * N_F15),
    ]);
  });

  test("sommaire d'ancres : chaque lien mène à une section de la page", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F15, { waitUntil: "domcontentloaded" });
    const liens = page.getByTestId("sommaire-pages").getByRole("link");
    await expect(liens).toHaveCount(6);
    for (const href of await liens.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""))) {
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(PAGES_F15, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#figure-ttfb")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

// F16 — Pages : tâches longues et ressources (§ 5.2.2, zones 7 droite et 8).
// Données SYNTHÉTIQUES : des blocages LoAF et Long Tasks il y a 2 h (une API chacun,
// jamais additionnées en durée), un marqueur de déploiement il y a 3 h (annotation
// attendue sur les DEUX panneaux), une ressource lente. La coupure de base (« lecture
// en échec ») se vérifie écran par écran dans tests/e2e/etats.spec.ts (/pages), et
// section par section dans tests/unit/LongtasksView.test.tsx.
test.describe("F16 — Pages : tâches longues et ressources", () => {
  const APP_F16 = "f16-e2e-pages";
  const PAGES_F16 = `${consoleUrl}/pages?app=${APP_F16}&period=24h`;

  async function semerF16() {
    for (const t of ["rum_metric", "rum_pageview", "rum_longtask", "rum_resource", "rum_error", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F16]);
    await pool.query(`delete from deploy_marker where app_id = $1`, [APP_F16]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Pages F16 E2E') on conflict (app_id) do nothing`,
      [APP_F16],
    );
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       select $1 || '-s' || g, $1, $1 || '-v' || g, 'desktop', false,
              now() - interval '2 hours', now() - interval '110 minutes', 1
         from generate_series(1, 6) g
       on conflict (session_id) do nothing`,
      [APP_F16],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
       select $1 || '-pv' || g, $1 || '-s' || g, $1, '/f16-panier', 'navigate', now() - interval '2 hours'
         from generate_series(1, 6) g
       on conflict (span_id) do nothing`,
      [APP_F16],
    );
    await pool.query(
      `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms,
                                 script_url, script_function, ts)
       select $1 || '-lt' || g, $1 || '-s' || g, $1, '/f16-panier', 100 + 40 * g,
              case when g <= 4 then 'loaf' else 'longtask' end, 50 + 40 * g,
              'https://f16.example.fr/panier.js', 'f16Recalcul', now() - interval '2 hours' + interval '5 minutes'
         from generate_series(1, 6) g
       on conflict (span_id) do nothing`,
      [APP_F16],
    );
    await pool.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, ts)
       values ($1 || '-res', $1 || '-s1', $1, '/f16-panier', 'https://cdn-f16.example.net/lib.js', 'script', 900, 48000,
               now() - interval '2 hours' + interval '6 minutes')
       on conflict (span_id) do nothing`,
      [APP_F16],
    );
    await pool.query(
      `insert into deploy_marker (app_id, version, env, source, ts) values ($1, 'f16-2.0.0', 'prod', 'ci', now() - interval '3 hours')`,
      [APP_F16],
    );
  }

  test.beforeAll(async () => {
    await semerF16();
  });

  test("tâches longues : deux panneaux sur le même axe x, annotations sur les deux", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F16, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#figure-taches-longues");
    await figure.scrollIntoViewIfNeeded();
    // Deux graphiques (comptés par `.recharts-wrapper`, pas par `.recharts-surface`).
    await expect(figure.locator(".recharts-wrapper")).toHaveCount(2);
    const seauxComptes = await figure.getByTestId("stacked-bars").getAttribute("data-seaux");
    const seauxP75 = await figure.getByTestId("threshold-series").getAttribute("data-seaux");
    expect(Number(seauxComptes)).toBeGreaterThan(0);
    expect(seauxP75).toBe(seauxComptes);
    // Le marqueur de déploiement est posé sur les DEUX panneaux (P9).
    await expect(figure.getByTestId("annotations")).toHaveCount(2);
    // Le p75 par seau n'est plus seulement dans la table repliée : il a son panneau.
    await expect(figure).toContainText("Blocage p75 par seau");
    await expect(figure).toContainText("Aucun cumul de durées");
  });

  test("pires blocages : la fonction et le lien vers la session", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F16, { waitUntil: "domcontentloaded" });
    const blocages = page.getByTestId("longtasks");
    await expect(blocages).toContainText("f16Recalcul");
    await expect(blocages.locator('a[href*="/sessions/"]').first()).toBeVisible();
  });

  test("ressources : l'avertissement de seuil avant les chiffres", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F16, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#ressources").getByTestId("ressources-seuil")).toBeVisible();
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(PAGES_F16, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#figure-taches-longues")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

test.describe("F23 — Interactions : INP et scripts", () => {
  // Une app à ce bloc. Elle porte ce que les zones 5 et 6 de `/ux` demandent :
  // des mesures INP étalées sur plusieurs seaux (la série), SEPT sélecteurs
  // d'attribution de latences différentes (le nuage n'en étiquette que cinq), et
  // trois couples script × fonction dont le classement par CUMUL diffère du
  // classement par pire cas — c'est toute la démonstration de la zone 6.
  const APP_F23 = "f23-e2e-inp";
  const UX_F23 = `${consoleUrl}/ux?app=${APP_F23}&period=24h`;

  test.beforeAll(async () => {
    for (const t of ["rum_longtask", "rum_metric", "rum_pageview", "rum_event", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F23]);
    await pool.query(`delete from deploy_marker where app_id = $1`, [APP_F23]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Interactions F23 (e2e)') on conflict (app_id) do nothing`,
      [APP_F23],
    );
    // Une instruction par table (`generate_series`), jamais ligne à ligne.
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, runtime)
       select $1 || '-s' || g, $1, $1 || '-v' || g, 'desktop', false,
              now() - interval '6 hours' + g * interval '20 minutes',
              now() - interval '6 hours' + g * interval '20 minutes' + interval '3 minutes', 1, 'browser'
         from generate_series(1, 12) g
       on conflict (session_id) do nothing`,
      [APP_F23],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
       select $1 || '-pv' || g, $1 || '-s' || g, $1, '/f23-panier', 'navigate',
              now() - interval '6 hours' + g * interval '20 minutes'
         from generate_series(1, 12) g
       on conflict (span_id) do nothing`,
      [APP_F23],
    );
    // Sept cibles d'attribution, latences franchement séparées : le nuage étiquette
    // les CINQ plus hautes, les deux dernières restent des points nus.
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, attribution, ts)
       select $1 || '-inp-' || c.cle || '-' || g, $1 || '-s' || g, $1, '/f23-panier', 'INP', c.base + g,
              jsonb_build_object('interactionTarget', c.cible),
              now() - interval '6 hours' + g * interval '20 minutes'
         from generate_series(1, 12) g,
              (values ('payer', 'button#f23-payer', 900, 12),
                      ('menu', 'a#f23-menu', 420, 9),
                      ('recherche', 'input#f23-recherche', 180, 7),
                      ('carte', 'div#f23-carte', 90, 5),
                      ('onglet', 'li#f23-onglet', 60, 4),
                      ('lien', 'a#f23-lien', 35, 3),
                      ('bandeau', 'span#f23-bandeau', 15, 2)) as c(cle, cible, base, sessions)
        where g <= c.sessions
       on conflict (span_id) do nothing`,
      [APP_F23],
    );
    // checkout.js : 6 frames à 100 ms → 600 ms cumulés, pire 100. analytics.js :
    // une frame à 400 → 400 cumulés, pire 400. Classé par CUMUL, checkout passe devant.
    await pool.query(
      `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms,
                                 script_url, script_function, ts)
       select $1 || '-lt-' || s.cle || '-' || g, $1 || '-s' || g, $1, '/f23-panier', s.bloc + 20, 'loaf', s.bloc,
              s.url, s.fonction, now() - interval '5 hours' + g * interval '10 minutes'
         from generate_series(1, 6) g,
              (values ('recalcul', 'https://f23.example.fr/checkout.js', 'f23Recalcul', 100, 6),
                      ('trace', 'https://f23.example.fr/analytics.js', 'f23Trace', 400, 1),
                      ('boucle', 'https://cdn-f23.example.net/widget.js', 'f23Boucle', 50, 3)) as s(cle, url, fonction, bloc, frames)
        where g <= s.frames
       on conflict (span_id) do nothing`,
      [APP_F23],
    );
    await pool.query(
      `insert into deploy_marker (app_id, version, env, source, ts)
       values ($1, 'f23-3.1.0', 'prod', 'ci', now() - interval '3 hours')`,
      [APP_F23],
    );
  });

  test("« INP p75 dans le temps » : bandes du vital, seaux, déploiement annoté, alternative", async ({ page }) => {
    await login(page);
    await page.goto(UX_F23, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#figure-inp-dans-le-temps");
    await figure.scrollIntoViewIfNeeded();
    const serie = figure.getByTestId("threshold-series");
    // Les bandes Bon / À améliorer / Mauvais sont celles de `lib/rating.ts` pour l'INP.
    await expect(serie).toHaveAttribute("data-vital", "INP");
    expect(Number(await serie.getAttribute("data-seaux"))).toBeGreaterThan(1);
    // Le marqueur de déploiement est posé sur la série (P9).
    await expect(figure.getByTestId("annotations")).toHaveCount(1);
    await figure.getByTestId("alternative").locator("summary").click();
    await expect(figure.getByTestId("alternative")).toContainText("Seau (UTC)");
    await expect(figure).toContainText("mesures INP");
  });

  test("nuage : les cinq plus lents étiquetés, les autres non", async ({ page }) => {
    await login(page);
    await page.goto(UX_F23, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#figure-elements-inp");
    await figure.scrollIntoViewIfNeeded();
    const nuage = figure.getByTestId("scatter-plot");
    // L'axe X porte son unité, et le nom des deux dimensions est dans l'alternative.
    await expect(nuage).toHaveAttribute("aria-label", /interactions × INP p75/);
    await expect(nuage).toContainText("button#f23-payer");
    await expect(nuage).toContainText("li#f23-onglet");
    // 6ᵉ et 7ᵉ par latence : des points, pas des étiquettes.
    await expect(nuage).not.toContainText("a#f23-lien");
    await expect(nuage).not.toContainText("span#f23-bandeau");
  });

  test("alternative du nuage = la table jumelle, mêmes lignes chiffrées", async ({ page }) => {
    await login(page);
    await page.goto(UX_F23, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#figure-elements-inp");
    await figure.scrollIntoViewIfNeeded();
    const table = figure.getByTestId("table-elements-inp");
    await expect(table.locator("tbody tr")).toHaveCount(7);
    // Les deux cibles absentes du nuage étiqueté sont bien dans la table.
    await expect(table).toContainText("a#f23-lien");
    await expect(table).toContainText("span#f23-bandeau");
    // Les points ne sont pas cliquables : la figure le dit, et renvoie à la table.
    await expect(figure).toContainText("ne sont pas cliquables");
  });

  test("scripts : classés par blocage cumulé, pas par pire cas", async ({ page }) => {
    await login(page);
    await page.goto(UX_F23, { waitUntil: "domcontentloaded" });
    const figure = page.locator("#scripts-bloquants");
    await figure.scrollIntoViewIfNeeded();
    const barres = figure.getByRole("img", { name: /Blocage cumulé/ });
    const texte = await barres.innerText();
    // checkout.js : 600 ms cumulés mais 100 ms au pire ; analytics.js : 400 cumulés,
    // 400 au pire. Un classement par pire cas les intervertirait.
    expect(texte.indexOf("checkout.js")).toBeGreaterThanOrEqual(0);
    expect(texte.indexOf("checkout.js")).toBeLessThan(texte.indexOf("analytics.js"));
    await expect(figure).toContainText("f23Recalcul");
    await expect(figure).toContainText("6 frames");
    await expect(figure).toContainText(/pire/);
    // Ce que le cumul n'est pas, et pourquoi une absence de ligne ne prouve rien.
    await expect(figure).toContainText("n'est le temps vécu de personne");
    await expect(figure).toContainText("Chromium");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(UX_F23, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#figure-inp-dans-le-temps")).toBeVisible();
      await page.locator("#scripts-bloquants").scrollIntoViewIfNeeded();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

test.describe("F24 — Onglet Actions", () => {
  // Une app à ce bloc : trois sessions, quatre actions causales, et de quoi
  // distinguer les trois populations que l'écran nomme — des ACTIONS, des SESSIONS
  // avec action, et des actions SUIVIES d'une erreur (distinctes des occurrences).
  const APP_F24 = "f24-e2e-actions";
  const ACTIONS_F24 = `${consoleUrl}/actions?app=${APP_F24}&period=24h`;

  /** `rum_action` impose 32 caractères hexadécimaux ; 16 pour son `span_id`. */
  const actionIdF24 = (i: number) => `f24ac${i}`.padEnd(32, "0");
  const spanIdF24 = (i: number) => `f24${i}`.padEnd(16, "0");

  // [i, session, nom, type, route]
  const ACTIONS: [number, string, string, "click" | "manual", string][] = [
    [0, "s0", "Payer", "click", "/panier"],
    [1, "s1", "Payer", "click", "/panier"],
    [2, "s0", "Ouvrir le menu", "click", "/"],
    [3, "s2", "Valider", "manual", "/compte"],
  ];

  test.beforeAll(async () => {
    // Enfants d'abord : `rum_resource.session_id` référence `rum_session`.
    for (const t of ["rum_event", "rum_span", "rum_resource", "rum_error", "rum_action", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F24]);
    }
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Actions F24 (e2e)') on conflict (app_id) do nothing`,
      [APP_F24],
    );
    for (const nom of ["s0", "s1", "s2"]) {
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, sample_rate)
         values ($1, $2, $1, 'desktop', false, now() - interval '3 hours', now() - interval '2 hours', 1, 1)`,
        [`${APP_F24}-${nom}`, APP_F24],
      );
    }
    for (const [i, session, nom, type, route] of ACTIONS) {
      await pool.query(
        `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
         values ($1, $2, $3, $4, $5, $6, $7, now() - interval '150 minutes')`,
        [actionIdF24(i), spanIdF24(i), `${APP_F24}-${session}`, APP_F24, type, nom, route],
      );
    }
    // Occurrences d'erreurs liées : 3 + 2 sur « Payer », 1 sur « Valider » — six en tout,
    // pour DEUX actions suivies d'une erreur. Les deux libellés ne comptent pas la même chose.
    for (const [i, action, occurrences] of [[0, 0, 3], [1, 1, 2], [2, 3, 1]] as const) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, error_source, action_id, ts)
         values ($1, $2, $3, $4, 'error', 'boom F24', 'TypeError', $5, $6, 'browser_js', $7, now() - interval '149 minutes')`,
        [
          `${APP_F24}-err${i}`,
          `${APP_F24}-${ACTIONS[action][1]}`,
          APP_F24,
          ACTIONS[action][4],
          `f24-fp-${i}`,
          occurrences,
          actionIdF24(action),
        ],
      );
    }
    for (const action of [0, 1]) {
      await pool.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, action_id, ts)
         values ($1, $2, $3, $4, 'frustration.error', $5, $6, now() - interval '149 minutes')`,
        [
          `${APP_F24}-ec${action}`,
          `${APP_F24}-${ACTIONS[action][1]}`,
          APP_F24,
          ACTIONS[action][4],
          { target: "Payer", count: 1 },
          actionIdF24(action),
        ],
      );
    }
    // Un script (jamais dédoublonné avec un appel API) et un appel API front : la p75
    // du temps lié d'UNE action (420 ms sur a0, 0 sur a1) n'est pas leur cumul.
    await pool.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, action_id, ts)
       values ($1, $2, $3, '/panier', 'https://cdn-f24.example.net/pay.js', 'script', 120, 4096, $4,
               now() - interval '149 minutes'),
              ($5, $6, $3, '/', 'https://cdn-f24.example.net/menu.js', 'script', 80, 2048, $7,
               now() - interval '149 minutes')`,
      [
        `${APP_F24}-res0`,
        `${APP_F24}-s0`,
        APP_F24,
        actionIdF24(0),
        `${APP_F24}-res2`,
        `${APP_F24}-s0`,
        actionIdF24(2),
      ],
    );
    await pool.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, action_id, ts)
       values ($1, $2, 'front', $3, $4, '/panier', 'https://api-f24.example.net/pay', 'POST', 500, 300, $5,
               now() - interval '149 minutes')`,
      [`${APP_F24}-api0`, `${APP_F24}-trace0`, `${APP_F24}-s0`, APP_F24, actionIdF24(0)],
    );
  });

  /** La tuile dont le libellé commence par `libelle` (le libellé « Actions » porte la plage). */
  const tuileF24 = (page: Page, libelle: string) =>
    page.getByTestId("kpi-tile").filter({ hasText: libelle }).first();

  test("KPI : actions, sessions avec action, actions suivies d'une erreur", async ({ page }) => {
    await login(page);
    await page.goto(ACTIONS_F24, { waitUntil: "domcontentloaded" });
    const rangee = page.getByTestId("kpi-actions");
    await expect(rangee).toBeVisible();
    await expect(tuileF24(page, "Sessions avec action").getByTestId("kpi-valeur")).toHaveText("3");
    const erreurs = tuileF24(page, "Actions suivies d’une erreur");
    await expect(erreurs.getByTestId("kpi-valeur")).toHaveText("2");
    // Les deux libellés sont écrits : 2 ACTIONS suivies d'une erreur, 6 OCCURRENCES.
    await expect(erreurs).toContainText("6");
    await expect(erreurs).toContainText("occurrences d’erreurs liées");
    // La tuile locale `Stat` et son ton rouge « dès une occurrence » ont disparu (R-S).
    await expect(rangee.locator(".text-bad-ink")).toHaveCount(0);
  });

  test("hero : barres NON empilées, libellé vers les erreurs de la route", async ({ page }) => {
    await login(page);
    await page.goto(ACTIONS_F24, { waitUntil: "domcontentloaded" });
    const hero = page.locator("#figure-actions-erreurs");
    await hero.scrollIntoViewIfNeeded();
    await expect(hero).toContainText("Payer");
    // Aucune portion empilée : une barre par ligne, et rien d'autre dedans.
    expect(await hero.locator("[style*='background-color']").count()).toBe(3);
    const libelle = hero.getByRole("link", { name: "Payer" }).first();
    await expect(libelle).toHaveAttribute("href", /\/errors\?/);
    await expect(libelle).toHaveAttribute("href", /route=/);
    // « Sessions » du sous-texte ouvre les sessions de la même route.
    await expect(hero.getByRole("link", { name: /sessions/ }).first()).toHaveAttribute("href", /\/sessions\?/);
  });

  test("table : le cumul nommé comme tel, ressources et API scindées, p75 par action", async ({ page }) => {
    await login(page);
    await page.goto(ACTIONS_F24, { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("table-actions");
    await table.scrollIntoViewIfNeeded();
    await expect(table).toContainText("Temps réseau lié, cumulé (toutes actions)");
    await expect(table).toContainText("Temps réseau lié (p75 par action)");
    await expect(table).toContainText("n’est le temps d’attente de personne");
    // L'ancien titre, qui laissait croire à une attente vécue, n'existe plus.
    await expect(table.locator("th", { hasText: /^Temps lié$/ })).toHaveCount(0);
    await expect(table).toContainText("Payer");
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(ACTIONS_F24, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("kpi-actions")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});

// F17 — Panneau route (§ 5.2.3). Données SYNTHÉTIQUES, dans une app à ce bloc :
// trois heures CLOSES, deux routes de gravités opposées — `/f17-panier` (30 mesures
// LCP à 3 200 ms par heure : « Mauvais », et assez d'effectif pour qu'une heure
// compte dans la concordance) et `/f17-accueil` (120 mesures à 900 ms par heure) —
// si bien que le p75 de l'ENSEMBLE (≈ 900 ms) diffère de celui de la route : le
// repère « p75 toutes routes » de la distribution est alors visible et distinct.
// Le robot passe sur `/f17-panier` à chacune des trois heures et dit « ok » : trois
// heures en angle mort. Plus trois ressources (une bloquante) et deux groupes
// d'erreurs sur la route.
test.describe("F17 — Panneau route", () => {
  const APP_F17 = "f17-e2e-panneau";
  const ROUTE_F17 = "/f17-panier";
  /** `ecrirePanel({ type: "route", id: ROUTE_F17 })` (lib/view-state.ts). */
  const PANEL_F17 = "route:%2Ff17-panier";
  const PAGES_F17 = `${consoleUrl}/pages?app=${APP_F17}&period=24h`;
  const PANNEAU_F17 = `${PAGES_F17}&panel=${encodeURIComponent(PANEL_F17)}`;
  const HEURES_F17 = [2, 3, 4];

  async function semerF17() {
    for (const t of ["rum_metric", "rum_pageview", "rum_resource", "rum_error", "syn_snapshot", "rum_session"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F17]);
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Panneau route F17 (e2e)') on conflict (app_id) do nothing`,
      [APP_F17],
    );
    for (const heure of HEURES_F17) {
      // Heure close, en son milieu : jamais à cheval sur deux seaux horaires.
      const quand = `date_trunc('hour', now()) - interval '${heure} hours' + interval '20 minutes'`;
      for (const r of [
        { route: ROUTE_F17, parHeure: 30, lcp: 3200 },
        { route: "/f17-accueil", parHeure: 120, lcp: 900 },
      ]) {
        const sid = `${APP_F17}-h${heure}${r.route.replace(/\//g, "-")}`;
        await pool.query(
          `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
           values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '5 minutes', 1)
           on conflict (session_id) do nothing`,
          [sid, APP_F17],
        );
        // Une instruction par table (`generate_series`), jamais ligne à ligne.
        await pool.query(
          `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at)
           select $1 || '-pv' || g, $1, $2, $3, 'navigate', ${quand}
             from generate_series(1, $4::int) g
           on conflict (span_id) do nothing`,
          [sid, APP_F17, r.route, r.parHeure],
        );
        await pool.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
           select $1 || '-lcp' || g, $1, $2, $3, 'LCP', $4, ${quand} + make_interval(secs => g)
             from generate_series(1, $5::int) g
           on conflict (span_id) do nothing`,
          [sid, APP_F17, r.route, r.lcp, r.parHeure],
        );
      }
      await pool.query(
        `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
         values ($1, 'recette F17', 'Parcours panier', 'Parcours panier', $2, 96, 'ok', 640, ${quand})`,
        [APP_F17, ROUTE_F17],
      );
    }
    const s0 = `${APP_F17}-h2-f17-panier`;
    await pool.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, render_blocking, ts)
       values ($1 || '-r1', $1, $2, $3, 'https://cdn-f17.example.net/bundle.js', 'script', 1400, 320000, true,
               now() - interval '2 hours'),
              ($1 || '-r2', $1, $2, $3, 'https://cdn-f17.example.net/police.woff2', 'font', 900, 90000, false,
               now() - interval '2 hours'),
              ($1 || '-r3', $1, $2, $3, 'https://cdn-f17.example.net/photo.jpg', 'img', 500, 210000, false,
               now() - interval '2 hours')
       on conflict (span_id) do nothing`,
      [s0, APP_F17, ROUTE_F17],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences, error_source, ts)
       values ($1 || '-e1', $1, $2, $3, 'error', 'panier introuvable', 'TypeError', 'f17-fp-panier', 7, 'browser_js',
               now() - interval '2 hours'),
              ($1 || '-e2', $1, $2, $3, 'error', 'paiement refuse', 'RangeError', 'f17-fp-paiement', 3, 'browser_js',
               now() - interval '2 hours')
       on conflict (span_id) do nothing`,
      [s0, APP_F17, ROUTE_F17],
    );
  }

  test.beforeAll(async () => {
    await semerF17();
  });

  test("une ligne du classement ouvre le panneau : titre, puces et cinq blocs", async ({ page }) => {
    await login(page);
    await page.goto(PAGES_F17, { waitUntil: "domcontentloaded" });
    const ligne = page.getByTestId("hero-routes").getByTestId("impact-ligne").filter({ hasText: ROUTE_F17 }).first();
    await ligne.getByRole("link").click();
    await page.waitForURL((u) => u.searchParams.get("panel") === PANEL_F17, { timeout: 15_000 });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toHaveAttribute("data-type", "route");
    await expect(panneau.locator("h2")).toContainText(ROUTE_F17);
    // Puces SOURCÉES seulement (la « release dominante » du brouillon est retirée).
    const puces = panneau.getByTestId("detail-panel-puces");
    await expect(puces).toContainText("Vues");
    await expect(puces).toContainText("Mesures LCP");
    for (const bloc of [
      "panneau-route-serie",
      "panneau-route-distribution",
      "panneau-route-robot",
      "panneau-route-ressources",
      "panneau-route-erreurs",
    ]) {
      await expect(panneau.getByTestId(bloc)).toBeVisible();
    }
    // Le panneau qualifie la route : il ne filtre pas l'écran (les deux routes restent).
    await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(2);
  });

  test("clavier : le focus va au titre, Échap ferme sans perdre les réglages", async ({ page }) => {
    await login(page);
    await page.goto(`${PANNEAU_F17}&vital=LCP&tri=volume`, { waitUntil: "domcontentloaded" });
    const titre = page.locator("#panneau-detail-titre");
    await expect(titre).toBeFocused({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await page.waitForURL((u) => u.searchParams.get("panel") === null, { timeout: 15_000 });
    const sp = new URL(page.url()).searchParams;
    // La plage, la population ET les réglages de vue survivent à la fermeture.
    expect([sp.get("app"), sp.get("period"), sp.get("vital"), sp.get("tri")]).toEqual([APP_F17, "24h", "LCP", "volume"]);
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
  });

  test("« Vu par le robot » : des états, aucune valeur robot en millisecondes", async ({ page }) => {
    await login(page);
    await page.goto(PANNEAU_F17, { waitUntil: "domcontentloaded" });
    const robot = page.getByTestId("panneau-route-robot");
    await expect(robot).toBeVisible({ timeout: 15_000 });
    const etat = robot.getByTestId("panneau-route-robot-etat");
    await expect(etat).toContainText("ok (pire état sur la plage)");
    await expect(etat).toContainText("Heures en angle mort : 3");
    // DF1 : le robot ne rend que des ÉTATS — aucune latence de sonde à côté d'un LCP.
    const texteRobot = (await etat.innerText()).replace(/\s+/g, " ");
    expect(texteRobot).not.toMatch(/\d\s?(ms|s)\b/);
    // Le « réel », lui, porte bien un LCP p75 et son verdict.
    await expect(robot.getByTestId("panneau-route-reel")).toContainText("LCP p75");
    await expect(robot.getByTestId("panneau-route-reel")).toContainText("Mauvais");
    // « Voir robot et réel » → /correlation?serie=<app>:<route> (clé `ecrireSerie`).
    const href = new URL((await robot.getByTestId("panneau-route-correlation").getAttribute("href"))!, consoleUrl);
    expect(href.pathname).toBe("/correlation");
    expect(href.searchParams.get("serie")).toBe(`${APP_F17}:%2Ff17-panier`);
  });

  test("la distribution de la route est marquée du p75 de TOUTES les routes", async ({ page }) => {
    await login(page);
    await page.goto(PANNEAU_F17, { waitUntil: "domcontentloaded" });
    const distribution = page.getByTestId("panneau-route-distribution");
    await expect(distribution).toBeVisible({ timeout: 15_000 });
    await expect(distribution.getByTestId("panneau-route-population")).toContainText("p75 de TOUTES les routes");
    // La population de référence est NOMMÉE sur la figure elle-même (§ 3.5).
    await expect(distribution.getByTestId("distribution-seuils")).toContainText("p75 toutes routes");
    // La série de la route a sa référence pointillée : deux séries au plus.
    const serie = page.getByTestId("panneau-route-serie");
    await expect(serie).toContainText(ROUTE_F17);
    await expect(serie).toContainText("Ensemble des routes");
  });

  test("ressources, erreurs, et « Ouvrir en page » qui filtre l'écran", async ({ page }) => {
    await login(page);
    await page.goto(PANNEAU_F17, { waitUntil: "domcontentloaded" });
    const ressources = page.getByTestId("panneau-route-ressources-liste");
    await expect(ressources.locator("li")).toHaveCount(3, { timeout: 15_000 });
    // C'est une MOYENNE, et c'est écrit (jamais lue comme un p75).
    await expect(ressources).toContainText("durée moyenne");
    await expect(ressources).toContainText("bloque le rendu");

    const erreurs = page.getByTestId("panneau-route-erreurs-liste");
    await expect(erreurs).toContainText("panier introuvable");
    // V1 : « Occurrences » ne s'écrit que sur une somme d'occurrences.
    await expect(erreurs).toContainText("7 occurrences");
    const versErreurs = new URL((await page.getByTestId("panneau-route-erreurs-lien").getAttribute("href"))!, consoleUrl);
    expect(versErreurs.pathname).toBe("/errors");
    expect(versErreurs.searchParams.get("route")).toBe(ROUTE_F17);

    const versSessions = new URL((await page.getByTestId("panneau-route-sessions").getAttribute("href"))!, consoleUrl);
    expect(versSessions.pathname).toBe("/sessions");
    expect(versSessions.searchParams.get("route")).toBe(ROUTE_F17);

    await page.getByTestId("detail-panel").getByTestId("detail-panel-page").click();
    await page.waitForURL((u) => u.searchParams.get("route") === ROUTE_F17, { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get("panel")).toBeNull();
    await expect(page.getByTestId("hero-routes").getByTestId("impact-ligne")).toHaveCount(1);
  });

  test("une route sans sonde synthétique le dit, sans jamais un « 0 »", async ({ page }) => {
    await login(page);
    await page.goto(`${PAGES_F17}&panel=${encodeURIComponent("route:%2Ff17-accueil")}`, { waitUntil: "domcontentloaded" });
    const robot = page.getByTestId("panneau-route-robot");
    await expect(robot.getByTestId("panneau-route-robot-etat")).toContainText("Aucune sonde synthétique sur cette route", {
      timeout: 15_000,
    });
    await expect(robot).not.toContainText("Heures en angle mort");
  });

  test("390 px : le panneau occupe tout l'écran", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(PANNEAU_F17, { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toBeVisible({ timeout: 15_000 });
    const boite = (await panneau.boundingBox())!;
    expect(Math.round(boite.x)).toBe(0);
    expect(Math.round(boite.width)).toBe(390);
  });

  for (const largeur of LARGEURS) {
    test(`panneau ouvert : aucun débordement à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(PANNEAU_F17, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("detail-panel")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("panneau-route-robot")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    });
  }
});

test.describe("F20 — Détail d'erreur (panneau et page)", () => {
  // Une app à ce bloc : trois sessions avec vue (la base de la part), un groupe
  // « paiement » porté par deux d'entre elles sur deux releases, dont une session
  // avec un rejeu enregistré, et un groupe backend sans session (sessions touchées
  // INCONNUES, jamais 0).
  const APP = "f20-e2e-detail";
  const FP = "f20fp-paiement";
  const FP_BACKEND = "f20fp-backend";
  const SESSION_REJEU = "f20-s1";

  test.beforeAll(async () => {
    for (const t of ["rum_error", "replay_chunk", "rum_pageview", "rum_session", "error_status"]) {
      await pool.query(`delete from ${t} where app_id = $1`, [APP]);
    }
    await pool.query(`insert into app_registry (app_id, name) values ($1, $2) on conflict (app_id) do nothing`, [
      APP,
      "F20 détail d'erreur",
    ]);
    for (const [i, sid] of [SESSION_REJEU, "f20-s2", "f20-s3"].entries()) {
      const quand = `now() - interval '${30 + i * 10} minutes'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at,
                                  page_count, sample_rate, error_sample_rate)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand}, 1, 1, 1)`,
        [sid, APP],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, nav_type, started_at)
         values ($1, $2, $3, '/panier', 'https://site.example/panier', 'navigate', ${quand})`,
        [`${sid}-pv`, sid, APP],
      );
    }
    // Le rejeu est un CHUNK, pas un drapeau : le lien n'existe que s'il y a de quoi rejouer.
    await pool.query(
      `insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 0, 1, $3)`,
      [SESSION_REJEU, APP, Buffer.from("{}")],
    );
    // Le groupe « paiement » : deux sessions sur trois, deux releases, une route.
    const erreurs: [string, string | null, string | null, number, number][] = [
      [FP, SESSION_REJEU, "1.4.2", 12, 30],
      [FP, "f20-s2", "1.5.0", 5, 20],
      [FP_BACKEND, null, null, 3, 25],
    ];
    let n = 0;
    for (const [fp, sid, release, occ, ilYA] of erreurs) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type,
                                fingerprint, occurrences, release, error_source, ts)
         values ($1, $2, $3, '/panier', 'error', $4, 'Error', $5, $6, $7, 'browser_js',
                 now() - interval '${ilYA} minutes')`,
        [`f20-e-${n++}`, sid, APP, `Échec du paiement (${fp})`, fp, occ, release],
      );
    }
  });

  const panneau = (page: Page) => page.getByTestId("detail-panel");

  test("la ligne de liste ouvre le PANNEAU : phrase d'impact avec son dénominateur, sans quitter la liste", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}`);
    await page.locator(`[data-testid="error-group-${FP}"] a`).first().click();
    await expect(page).toHaveURL(new RegExp(`panel=error%3A${FP}`));
    // La liste reste affichée derrière : on qualifie sans la quitter.
    await expect(page.locator("#groupes-erreurs")).toHaveCount(1);
    const p = panneau(page);
    await expect(p).toHaveAttribute("data-type", "error");
    // « N occurrences … touchant S sessions et V visiteurs ; x % des T sessions avec au moins une vue »
    const impact = p.getByTestId("phrase-impact");
    await expect(impact).toContainText("17 occurrences");
    await expect(impact).toContainText("2 sessions");
    await expect(impact).toContainText("sessions avec au moins une vue");
    // Le dénominateur est NOMMÉ et écrit : 2 sessions touchées sur 3 avec vue.
    await expect(impact).toContainText("3 sessions avec au moins une vue");
    await expect(p.getByTestId("detail-occurrences")).toHaveText("17");
    await expect(p.getByTestId("detail-sessions")).toHaveText("2");
  });

  test("panneau : versions touchées, et « Ouvrir en page » mène au détail complet", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors?app=${APP}&panel=error%3A${FP}`);
    const p = panneau(page);
    await expect(p.getByTestId("premiere-release")).toContainText("1.4.2");
    await expect(p.getByTestId("derniere-release")).toContainText("1.5.0");
    await p.getByTestId("detail-panel-page").click();
    await expect(page).toHaveURL(new RegExp(`/errors/${FP}\\?app=${APP}`));
    await expect(page.getByTestId("phrase-impact")).toContainText("17 occurrences");
    // Les blocs 6 à 8 ne sont QUE sur la page.
    await expect(page.getByTestId("error-triage")).toHaveCount(1);
  });

  test("« Voir le rejeu » mène à la session, positionnée à l'instant de l'erreur", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors/${FP}?app=${APP}`);
    const rejeu = page.getByTestId("voir-le-rejeu");
    await expect(rejeu).toHaveAttribute("href", new RegExp(`/sessions/${SESSION_REJEU}\\?app=${APP}&tab=replay&at=\\d+`));
  });

  test("aucun rejeu : pas de bouton mort, une phrase qui le dit", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors/${FP_BACKEND}?app=${APP}`);
    await expect(page.getByTestId("voir-le-rejeu")).toHaveCount(0);
    await expect(page.getByTestId("rejeu-absent")).toContainText("Aucune occurrence de la fenêtre n'a de rejeu");
    // Erreur backend : sessions touchées INCONNUES, jamais 0 (V3).
    await expect(page.getByTestId("detail-sessions")).toHaveText("—");
    await expect(page.getByTestId("phrase-impact")).toContainText("Inconnu");
    // Aucune release déclarée : dit, jamais une version devinée.
    await expect(page.getByTestId("versions-touchees")).toContainText("Release non déclarée");
  });

  test("bloc 5 avant B3 : aucune barre de base, la raison et le « pas de test » chiffré", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors/${FP}?app=${APP}`);
    const commun = page.locator("#detail-erreur-commun");
    await commun.scrollIntoViewIfNeeded();
    await expect(commun.getByTestId("contrast-bars")).toHaveAttribute("data-etat", "indisponible");
    await expect(commun).toContainText("base de comparaison non lue (B3)");
    // P*.6 : le test est PUBLIÉ à l'état « pas de test », avec ses volumes minimaux.
    await expect(commun.getByTestId("commun-pas-de-test")).toContainText("pas de test : 2 sessions touchées, 10 requises");
    await expect(commun.getByTestId("commun-pas-de-test")).toContainText("Fisher");
    await expect(commun.getByTestId("commun-pas-de-test")).toContainText("Benjamini-Hochberg");
    // Le repli dit ce qu'il compte vraiment : les occurrences AFFICHÉES.
    await expect(commun.getByTestId("commun-titre-repli")).toContainText("pas de la population");
    await expect(commun.getByTestId("repli-release")).toContainText("1.4.2");
  });

  test("empreinte inconnue : page « introuvable » en français, avec le retour à la liste", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/errors/f20fp-inexistante?app=${APP}`);
    await expect(page.getByText("Groupe introuvable", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("purgé par la rétention", { exact: false })).toBeVisible();
    // Plus de 404 anglais : aucune trace de « This page could not be found ».
    await expect(page.locator("body")).not.toContainText("could not be found");
    await expect(page.getByRole("link", { name: "← Tous les groupes" })).toBeVisible();
  });

  for (const largeur of LARGEURS) {
    test(`aucun débordement du détail et du panneau à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await login(page);
      await page.goto(`${consoleUrl}/errors/${FP}?app=${APP}`);
      await expect(page.getByTestId("phrase-impact")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
      await page.goto(`${consoleUrl}/errors?app=${APP}&panel=error%3A${FP}`);
      await expect(page.getByTestId("detail-panel")).toBeVisible();
      expect(await debordements(page)).toEqual([]);
    });
  }
});
