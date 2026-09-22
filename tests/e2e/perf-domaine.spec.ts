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

  test("une ligne ouvre la route avec la même plage et le même vital", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/pages?app=${APP_F14}&period=7d&vital=INP`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("hero-routes").getByTestId("impact-ligne").first().getByRole("link").click();
    await page.waitForURL((u) => u.searchParams.get("route") === "/f14-inp-lente", { timeout: 15_000 });
    const sp = new URL(page.url()).searchParams;
    expect([sp.get("app"), sp.get("period"), sp.get("vital")]).toEqual([APP_F14, "7d", "INP"]);
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
