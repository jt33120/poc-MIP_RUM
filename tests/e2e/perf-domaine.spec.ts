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
