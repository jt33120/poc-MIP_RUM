// P6.4 — l'Explorer générique, dans un vrai navigateur.
//
// Ce qui ne se prouve qu'ici : le fait que RIEN ne parte avant « Exécuter ». Le
// builder est un formulaire ; aucune requête n'est lancée à la frappe, et l'URL
// obtenue rejoue la même analyse. S'y ajoutent le résumé de ce qui est
// RÉELLEMENT appliqué, l'accès clavier, et l'absence de débordement horizontal
// aux trois largeurs de référence.
//
// La population est resserrée sur une release propre à ce test : les autres
// suites écrivent dans la même app, et un total global serait un total partagé.
//
// F31 : connexion par un utilisateur DÉDIÉ (comme `theme-contraste.spec.ts`) —
// rejouer ce spec ne réinitialise plus le mot de passe de l'administrateur local.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { createHmac as f34Hmac } from "node:crypto";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const SESSION = "p64-explorer-session";
const RELEASE = "p64-e2e-rel";
const FINGERPRINT = "p64-e2e-fp";
const E2E_EMAIL = "e2e-explorer@mip-rum.local";
const E2E_PASSWORD = "e2e-explorer-mdp-local";

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

/** Trois lignes, deux routes, six occurrences : la somme ≠ le nombre de lignes. */
const LIGNES: [string, number][] = [
  ["/p64-explorer-a", 2],
  ["/p64-explorer-a", 2],
  ["/p64-explorer-b", 2],
];

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(
    `insert into rum_session (session_id,app_id,device_type,geo_country,sample_rate,error_sample_rate,last_seen_at)
     values ($1,'demo-app','desktop','FR',1,1,now())
     on conflict (session_id) do update set last_seen_at = now(), device_type = 'desktop'`,
    [SESSION],
  );
  await pool.query(`delete from rum_error where fingerprint = $1`, [FINGERPRINT]);
  for (const [route, occurrences] of LIGNES) {
    await pool.query(
      `insert into rum_error (app_id,session_id,fingerprint,error_type,message,kind,route,release,occurrences,ts)
       values ('demo-app',$1,$2,'TypeError','boom','error',$3,$4,$5, now())`,
      [SESSION, FINGERPRINT, route, RELEASE, occurrences],
    );
  }
});

test.afterAll(async () => {
  await pool.query(`delete from rum_error where fingerprint = $1`, [FINGERPRINT]);
  await pool.query(`delete from rum_session where session_id = $1`, [SESSION]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: "demo-app", url: consoleUrl }]);
}

/** URL de l'Explorer restreinte à la population de ce test. */
const base = `${consoleUrl}/explorer?app=demo-app&period=1h&release=${RELEASE}&dataset=errors`;

/**
 * L'Explorer déborde-t-il de la largeur qui lui est donnée ? La mesure porte sur
 * SON conteneur, pas sur le document : ce test répond de cet écran, et un défaut
 * de la coquille commune doit se voir là où il est, pas ici. Une tolérance d'un
 * pixel absorbe les arrondis de rendu.
 */
const deborde = (page: Page) =>
  page.evaluate(() => {
    const racine = document.querySelector('[data-testid="explorer-racine"]');
    if (!racine) return true;
    return racine.scrollWidth > racine.clientWidth + 1;
  });

test("rien ne part avant « Exécuter », puis la mesure composée est exacte", async ({ page }) => {
  await login(page);
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();

  // 1. Premier affichage : une invitation, pas un chiffre. Aucune requête n'a
  // été lancée, donc aucun total ne peut être affiché.
  await expect(page.getByTestId("explorer-invite")).toBeVisible();
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);

  // 2. Chaque contrôle porte un libellé — c'est ce dont dépendent le clavier et
  // les lecteurs d'écran. Les interactions passent ensuite par le nom du champ,
  // qui est aussi ce que l'URL transportera. F31 : la représentation n'est plus un
  // champ du formulaire mais une rangée d'onglets-liens ; sans exécution, en
  // changer n'exécute rien.
  for (const libelle of ["Mesure", "Grouper par"]) {
    await expect(page.getByLabel(libelle).first()).toBeVisible();
  }
  const representation = page.getByRole("navigation", { name: "Représentation" });
  await representation.getByRole("link", { name: "Classement" }).click();
  await page.waitForURL((u) => u.searchParams.get("viz") === "toplist", { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("run")).toBe(false);
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);
  const champ = (nom: string) => page.locator(`select[name="${nom}"]`);
  await champ("measure").selectOption("occurrences:sum");
  await champ("g0").selectOption("route");
  await page.getByRole("button", { name: "Exécuter" }).click();

  // 3. Le total est la SOMME des occurrences (6), pas le nombre de lignes (3).
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });
  // Le libellé d'une barre apparaît dans un span titré : le titre le désigne
  // sans ambiguïté, là où une recherche par texte en trouverait deux imbriqués.
  await expect(page.getByTitle("/p64-explorer-a")).toBeVisible();
  await expect(page.getByTitle("/p64-explorer-b")).toBeVisible();

  // 4. Le résumé énonce ce qui est RÉELLEMENT appliqué, release comprise. F31 : il
  // nomme le groupe de pastilles (`aria-label`), et chaque élément a sa pastille.
  const resume = page.getByTestId("requete-pastilles");
  await expect(resume).toHaveAttribute("aria-label", /Somme — occurrences/);
  await expect(resume).toHaveAttribute("aria-label", new RegExp(`Release = ${RELEASE}`));
  await expect(resume).toHaveAttribute("aria-label", /robots exclus/);
  await expect(resume).toHaveAttribute("aria-label", /groupé par route/);
  await expect(resume).toContainText(`Release = ${RELEASE}`);
  await expect(resume).toContainText("Groupé par route");

  // L'origine du chiffre est à l'écran (P6.6) : aucun agrégat ne porte les
  // occurrences d'erreurs, la somme vient donc des lignes, et l'écran le dit.
  await expect(page.getByTestId("explorer-source")).toHaveText("lignes brutes");

  // 5. L'URL rejoue l'analyse, et ne transporte aucun curseur.
  const url = new URL(page.url());
  expect(url.searchParams.get("run")).toBe("1");
  expect(url.searchParams.get("measure")).toBe("occurrences:sum");
  expect(url.searchParams.get("release")).toBe(RELEASE);
  expect(url.searchParams.has("cursor")).toBe(false);
  await page.goto(page.url());
  await expect(page.getByTestId("explorer-total")).toHaveText("6");
});

test("zéro réel, refus explicite et retour à l'invitation après changement de jeu", async ({ page }) => {
  await login(page);

  // Un zéro RÉEL : la population est vide, et l'écran le dit sans faire d'erreur.
  // F32 : en représentation « Valeur », le total EST la tuile (l'encadré « Total
  // observé » qui le répétait a disparu).
  await page.goto(`${base}&measure=occurrences:sum&viz=value&route=/aucune-route-p64&run=1`);
  await expect(page.getByTestId("kpi-valeur")).toHaveText("0", { timeout: 15_000 });
  await expect(page.getByTestId("explorer-vide")).toBeVisible();

  // Une requête refusée dit POURQUOI et avec quel code, sans chiffre inventé.
  await page.goto(`${base}&measure=message:count&viz=value&run=1`);
  const refus = page.getByTestId("explorer-invalide");
  await expect(refus).toBeVisible();
  await expect(refus).toContainText("unsupported_measure");
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);
  await expect(page.getByTestId("kpi-valeur")).toHaveCount(0);

  // Changer de jeu de données redémarre le builder : les mesures d'un jeu
  // n'existent pas dans un autre, donc l'écran redemande « Exécuter ».
  await page.goto(`${base}&measure=occurrences:sum&viz=value&run=1`);
  await expect(page.getByTestId("kpi-valeur")).toBeVisible();
  await page.getByRole("link", { name: "Pages vues" }).click();
  await expect(page.getByTestId("explorer-invite")).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("run")).toBe(false);
  // Le contexte global, lui, a suivi.
  expect(new URL(page.url()).searchParams.get("release")).toBe(RELEASE);
});

// F30 (CE6, P14) : une série temporelle superpose au plus cinq groupes. Le contrôle
// ne propose plus « 10 », et une URL qui l'impose est refusée avant toute lecture.
test("série temporelle : au plus 5 groupes, proposés comme exigés", async ({ page }) => {
  await login(page);
  await page.goto(`${base}&measure=occurrences:sum&viz=timeseries&g0=route&limit=3`);
  const options = await page.locator('select[name="limit"] option').allTextContents();
  expect(options.map((o) => o.trim())).toEqual(["1", "3", "5"]);

  await page.goto(`${base}&measure=occurrences:sum&viz=timeseries&g0=route&limit=10&run=1`);
  const echec = page.getByTestId("explorer-echec");
  await expect(echec).toBeVisible({ timeout: 15_000 });
  await expect(echec).toContainText("au plus 5 groupes");
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);
});

test("accès clavier et aucune largeur qui déborde (390 / 768 / 1440 px)", async ({ page }) => {
  await login(page);
  await page.goto(base);

  // Le bouton s'active au clavier seul, sans souris.
  const executer = page.getByRole("button", { name: "Exécuter" });
  await executer.focus();
  await expect(executer).toBeFocused();
  await page.keyboard.press("Enter");
  // Sans représentation choisie : « Valeur », dont la tuile porte le total (F32).
  await expect(page.getByTestId("kpi-valeur")).toBeVisible({ timeout: 15_000 });

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}&measure=occurrences:sum&viz=table&limit=25&run=1`);
    await expect(page.getByTestId("requete-pastilles")).toBeVisible({ timeout: 15_000 });
    expect(await deborde(page), `débordement horizontal à ${width} px`).toBe(false);
  }
});

// F32 — le résultat dans sa figure (plan § 5.21.4, W-E3 à W-E6, W-E8, W-E9, règle R-V).
// Données SYNTHÉTIQUES dans une app propre à ce bloc : des LCP sur deux routes dans
// l'heure (« lente » à 4,2 s, « rapide » à 1,5 s), d'autres il y a 30 h (la période
// précédente d'une plage de 24 h) et il y a 50 h (le début de collecte précède cette
// période : la comparaison est complète).
test.describe("F32 — représentations du résultat", () => {
  const APP_F32 = "f32-explorer-e2e";
  const baseF32 = `${consoleUrl}/explorer?app=${APP_F32}&dataset=vitals&variant=LCP`;

  test.beforeAll(async () => {
    for (const table of ["rum_metric", "rum_session"]) await pool.query(`delete from ${table} where app_id = $1`, [APP_F32]);
    await pool.query(`insert into app_registry (app_id, name, active) values ($1, 'Explorer F32 E2E', true) on conflict do nothing`, [
      APP_F32,
    ]);
    const lots: { session: string; il_y_a: string; route: string; valeurs: number[] }[] = [
      { session: `${APP_F32}-lente`, il_y_a: "20 minutes", route: "/f32-lente", valeurs: [4200, 4210, 4220, 4230, 4240, 4250] },
      { session: `${APP_F32}-rapide`, il_y_a: "20 minutes", route: "/f32-rapide", valeurs: [1500, 1510, 1520, 1530, 1540, 1550] },
      { session: `${APP_F32}-hier`, il_y_a: "30 hours", route: "/f32-rapide", valeurs: [1600, 1610, 1620, 1630, 1640, 1650, 1660, 1670] },
      { session: `${APP_F32}-avant`, il_y_a: "50 hours", route: "/f32-rapide", valeurs: [1700, 1710] },
    ];
    for (const lot of lots) {
      const quand = `now() - interval '${lot.il_y_a}'`;
      await pool.query(
        `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, 'desktop', false, ${quand}, ${quand} + interval '2 minutes', 1)
         on conflict (session_id) do nothing`,
        [lot.session, APP_F32],
      );
      for (const [k, valeur] of lot.valeurs.entries()) {
        await pool.query(
          `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
           values ($1, $2, $3, $4, 'LCP', $5, 'good', ${quand} + interval '${k} seconds') on conflict (span_id) do nothing`,
          [`${lot.session}-lcp-${k}`, lot.session, APP_F32, lot.route, valeur],
        );
      }
    }
  });

  test.afterAll(async () => {
    for (const table of ["rum_metric", "rum_session"]) await pool.query(`delete from ${table} where app_id = $1`, [APP_F32]);
  });

  test("chaque représentation porte une alternative textuelle", async ({ page }) => {
    await login(page);
    for (const suite of [
      "measure=value:p75&viz=value",
      "measure=value:p75&viz=toplist&g0=route&limit=10",
      "measure=rows:count&viz=toplist&g0=route&limit=10",
      "measure=value:p75&viz=timeseries&limit=1",
    ]) {
      await page.goto(`${baseF32}&period=1h&${suite}&run=1`);
      await expect(page.locator('#explorer-resultat [data-testid="alternative"]').first(), suite).toBeAttached({ timeout: 15_000 });
    }
    // Le journal EST un tableau : sa légende le décrit, et il se lit sans dessin.
    await page.goto(`${baseF32}&period=1h&measure=value:p75&viz=table&limit=25&run=1`);
    await expect(page.locator("#explorer-resultat table caption")).toBeAttached({ timeout: 15_000 });
    await expect(page.locator("#explorer-resultat")).toContainText("le journal est ordonné par date");
  });

  test("R-V : bande « Bon » et badge au p75 ; ni badge ni bande pour la moyenne ou le p95", async ({ page }) => {
    await login(page);
    await page.goto(`${baseF32}&period=1h&measure=value:p75&viz=value&run=1`);
    await expect(page.getByTestId("kpi-verdict")).toBeVisible({ timeout: 15_000 });

    await page.goto(`${baseF32}&period=1h&measure=value:avg&viz=value&run=1`);
    await expect(page.getByTestId("kpi-valeur")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kpi-verdict")).toHaveCount(0);
    await expect(page.locator("#explorer-resultat")).toContainText("aucun verdict n'est donné pour la moyenne");

    await page.goto(`${baseF32}&period=1h&measure=value:p75&viz=timeseries&limit=1&run=1`);
    const serie = page.locator('[data-testid="threshold-series"][data-vital="LCP"]');
    await serie.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await expect(serie.locator(".recharts-reference-area.bande-bon").first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`${baseF32}&period=1h&measure=value:p95&viz=timeseries&limit=1&run=1`);
    await expect(page.getByTestId("threshold-series")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="threshold-series"][data-vital]')).toHaveCount(0);
    await expect(page.locator(".recharts-reference-area.bande-bon")).toHaveCount(0);
  });

  test("cmp=prev : la valeur dit « vs » et la plage précédente en clair", async ({ page }) => {
    await login(page);
    await page.goto(`${baseF32}&period=24h&measure=rows:count&viz=value&cmp=prev&run=1`);
    const delta = page.locator("#explorer-resultat").getByTestId("delta");
    await expect(delta).toBeVisible({ timeout: 15_000 });
    await expect(delta).toContainText(/vs 24 h précédentes \(\d\d\/\d\d \d\d:\d\d → \d\d\/\d\d \d\d:\d\d UTC\)/);
    // 12 mesures contre 8 la veille : +50 %.
    await expect(delta).toContainText("+50 %");
  });

  test("onglet « Distribution » : visible, désactivé, avec sa raison", async ({ page }) => {
    await login(page);
    await page.goto(`${baseF32}&period=1h&measure=value:p75&viz=value&run=1`);
    const onglet = page.getByTestId("onglet-distribution");
    await expect(onglet).toBeVisible({ timeout: 15_000 });
    await expect(onglet).toHaveAttribute("aria-disabled", "true");
    await expect(onglet).toContainText("B5");
    const raison = page.getByTestId("distribution-indisponible");
    await expect(raison).toContainText("pas encore exposée par l'Explorer");
    await expect(raison.getByRole("link", { name: /Voir la distribution de LCP sur Pages/ })).toHaveAttribute("href", /vital=LCP/);
  });

  test("P8 : la 1re barre d'un classement ajoute sa condition et garde la période", async ({ page }) => {
    await login(page);
    // Mesure non additive (p75) : ImpactTable, classée par gravité ; mesure additive : barres.
    for (const [suite, premiere] of [
      ["measure=value:p75&viz=toplist&g0=route&limit=10", '#explorer-resultat [data-testid="impact-ligne"] a'],
      ["measure=rows:count&viz=toplist&g0=route&limit=10", '#explorer-resultat [role="listitem"] a'],
    ] as const) {
      await page.goto(`${baseF32}&period=1h&${suite}&run=1`);
      const lien = page.locator(premiere).first();
      await expect(lien).toBeVisible({ timeout: 15_000 });
      await lien.click();
      await page.waitForURL((u) => u.searchParams.get("route") === "/f32-lente", { timeout: 15_000 });
      const sp = new URL(page.url()).searchParams;
      expect(sp.get("period"), suite).toBe("1h");
      expect(sp.get("run"), suite).toBe("1");
      expect(sp.get("app"), suite).toBe(APP_F32);
      expect(sp.has("cursor"), suite).toBe(false);
    }
  });

  test("aucune largeur qui déborde : classement, série et valeur (390 / 768 / 1440 px)", async ({ page }) => {
    await login(page);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const suite of [
        "measure=value:p75&viz=toplist&g0=route&limit=10",
        "measure=value:p75&viz=timeseries&limit=1",
        "measure=value:avg&viz=value",
      ]) {
        await page.goto(`${baseF32}&period=1h&${suite}&run=1`);
        await expect(page.locator("#explorer-resultat")).toBeVisible({ timeout: 15_000 });
        expect(await deborde(page), `débordement horizontal à ${width} px (${suite})`).toBe(false);
      }
    }
  });
});

// F34 — vues enregistrées (plan § 5.22, W-V1 à W-V3). Les vues sont écrites en base
// (le chemin Explorer → « Enregistrer la vue » est couvert par dashboards-analytics) :
// ce bloc éprouve la LISTE — ce qu'elle dit de chaque vue, ce qu'elle laisse faire.
test.describe("F34 — vues enregistrées", () => {
  const VUE_F34 = "F34 vue recette";
  const VUE_ILLISIBLE = "F34 vue illisible";
  const VUE_DEMO = "F34 vue démo";
  const DEMO_EMAIL = "e2e-vues-demo@mip-rum.local";
  const AST_F34 = {
    version: 1,
    app: "demo-app",
    range: { preset: "24h" },
    dataset: "vitals",
    measure: { aggregation: "p75", field: "value" },
    variant: "LCP",
    filters: [],
    groupBy: ["route"],
    visualization: "toplist",
    limit: 10,
  };

  async function menageF34() {
    await pool.query(`delete from analytics_saved_view where name like 'F34 %'`);
  }

  async function vueDe(email: string, nom: string, ast: object) {
    await pool.query(
      `insert into analytics_saved_view (app_id, owner_id, name, query_json)
       select 'demo-app', id, $2, $3::jsonb from console_user where email = $1`,
      [email, nom, JSON.stringify(ast)],
    );
  }

  test.beforeAll(async () => {
    await menageF34();
    // Le compte démo est un VIEWER de demo-app qui possède une vue : sans la garde
    // V9, ses boutons « Renommer » et « Supprimer… » seraient rendus.
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array['demo-app'], true)
       on conflict (email) do update set role = 'viewer', apps = array['demo-app'], active = true`,
      [DEMO_EMAIL, bcryptHash(`mdp-local-${DEMO_EMAIL}`)],
    );
    await vueDe(E2E_EMAIL, VUE_F34, AST_F34);
    await vueDe(E2E_EMAIL, VUE_ILLISIBLE, { version: 1, app: "demo-app", dataset: "inexistant" });
    await vueDe(DEMO_EMAIL, VUE_DEMO, AST_F34);
  });

  test.afterAll(async () => {
    await menageF34();
    await pool.query(`delete from console_user where email = $1`, [DEMO_EMAIL]);
  });

  test("la liste dit ce que mesure chaque vue, et les modèles fournis sont en lecture seule", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/explorer/views?app=demo-app`);
    await expect(page.getByRole("columnheader", { name: "Ce qu’elle mesure" })).toBeVisible({ timeout: 15_000 });

    const ligne = page.getByRole("row", { name: new RegExp(VUE_F34) });
    await expect(ligne.getByTestId("vue-mesure")).toHaveText("Web Vitals · Valeur p75 (LCP) · Classement · par Route");
    // Une vue illisible reste listée, avec sa raison, sans lien d'ouverture.
    const illisible = page.getByRole("row", { name: new RegExp(VUE_ILLISIBLE) });
    await expect(illisible.getByTestId("vue-mesure")).toContainText("Requête illisible");
    await expect(illisible.getByRole("link", { name: VUE_ILLISIBLE })).toHaveCount(0);

    // W-V1 : six analyses fournies, des liens vers l'Explorer exécuté, aucune suppression.
    const modeles = page.getByTestId("vues-modeles");
    await expect(modeles).toContainText("fourni");
    await expect(modeles.getByRole("link")).toHaveCount(6);
    await expect(modeles.getByText(/Supprimer/)).toHaveCount(0);
    for (const href of await modeles.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
      expect(new URL(href, consoleUrl).searchParams.get("run"), href).toBe("1");
    }

    // W-V3 : supprimer passe par une confirmation.
    await ligne.getByTestId("vue-supprimer").locator("summary").click();
    await expect(page.getByRole("button", { name: `Confirmer la suppression de ${VUE_F34}` })).toBeVisible();
  });

  test("session de démonstration : aucun bouton d'écriture (V9)", async ({ page }) => {
    // Jeton de session au format de `signJwt` (lib/auth.ts), `demo: true`. Le secret
    // est celui de la console de test (playwright.config.ts), à défaut celui de dev.
    const jeton = (secret: string) => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const maintenant = Math.floor(Date.now() / 1000);
      const corps = `${b64({ alg: "HS256" })}.${b64({
        email: DEMO_EMAIL,
        role: "viewer",
        apps: ["demo-app"],
        demo: true,
        iat: maintenant,
        exp: maintenant + 3600,
      })}`;
      return `${corps}.${f34Hmac("sha256", secret).update(corps).digest("base64url")}`;
    };
    const secrets = [process.env.E2E_AUTH_SECRET, "e2e-secret-local-jetable-non-production", "dev-secret-mip-rum"].filter(
      (s): s is string => !!s,
    );
    let connecte = false;
    for (const secret of secrets) {
      await page.context().clearCookies();
      await page.context().addCookies([
        { name: "mip_session", value: jeton(secret), url: consoleUrl },
        { name: "mip-project", value: "demo-app", url: consoleUrl },
      ]);
      await page.goto(`${consoleUrl}/explorer/views?app=demo-app`);
      if (new URL(page.url()).pathname !== "/login") {
        connecte = true;
        break;
      }
    }
    expect(connecte, "aucun secret de session connu n'est accepté par la console (AUTH_SECRET)").toBe(true);

    const ligne = page.getByRole("row", { name: new RegExp(VUE_DEMO) });
    await expect(ligne).toBeVisible({ timeout: 15_000 });
    await expect(ligne.getByTestId("vue-lecture-seule")).toHaveText("Session de démonstration : lecture seule.");
    await expect(page.getByRole("button", { name: "Renommer" })).toHaveCount(0);
    await expect(page.getByText("Supprimer…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Confirmer la suppression/ })).toHaveCount(0);
  });
});
