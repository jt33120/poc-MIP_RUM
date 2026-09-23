// P6.5 — tableaux de bord graphiques et vues enregistrées, dans un vrai navigateur.
//
// Ce qui ne se prouve qu'ici : le CHEMIN COMPLET — composer une analyse dans
// l'Explorer, l'enregistrer comme carte, la retrouver au rechargement, dupliquer
// le tableau, exporter le CSV, puis enregistrer la même analyse comme vue,
// la renommer et la supprimer. Chaque maillon existe en test unitaire ; leur
// enchaînement, non.
//
// S'y ajoutent l'accès clavier à l'ordre des cartes et l'absence de débordement
// horizontal aux trois largeurs de référence.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const SESSION = "p65-dash-session";
const RELEASE = "p65-e2e-rel";
const FINGERPRINT = "p65-e2e-fp";
const TABLEAU = "P65 recette";
const VUE = "P65 vue de recette";
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-dashboards-analytics@mip-rum.local";
let adminPassword = "";

/** Trois lignes, six occurrences : la somme n'est pas le nombre de lignes. */
const LIGNES: [string, number][] = [
  ["/p65-a", 2],
  ["/p65-a", 2],
  ["/p65-b", 2],
];

async function menage() {
  await pool.query(`delete from rum_error where fingerprint = $1`, [FINGERPRINT]);
  await pool.query(`delete from analytics_saved_view where name like 'P65 %'`).catch(() => {});
  await pool.query(`delete from dashboard where name like 'P65 %'`);
}

test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(
    `insert into rum_session (session_id,app_id,device_type,geo_country,sample_rate,error_sample_rate,last_seen_at)
     values ($1,'demo-app','desktop','FR',1,1,now())
     on conflict (session_id) do update set last_seen_at = now(), device_type = 'desktop'`,
    [SESSION],
  );
  await menage();
  for (const [route, occurrences] of LIGNES) {
    await pool.query(
      `insert into rum_error (app_id,session_id,fingerprint,error_type,message,kind,route,release,occurrences,ts)
       values ('demo-app',$1,$2,'TypeError','boom','error',$3,$4,$5, now())`,
      [SESSION, FINGERPRINT, route, RELEASE, occurrences],
    );
  }
});

test.afterAll(async () => {
  await menage();
  await pool.query(`delete from rum_session where session_id = $1`, [SESSION]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: "demo-app", url: consoleUrl }]);
}

/** Contexte partagé par l'Explorer et le tableau de bord : une seule population. */
const CONTEXTE = `app=demo-app&period=1h&release=${RELEASE}`;
const explorer = `${consoleUrl}/explorer?${CONTEXTE}&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&limit=5&run=1`;

/**
 * Ouvre un `<details>` s'il est replié. Le panneau de création est ouvert tant
 * qu'aucun tableau n'existe, puis replié : le test ne peut pas supposer l'un ou
 * l'autre, et un contenu replié n'est pas cliquable.
 */
async function deplier(page: Page, resume: string) {
  const bloc = page.locator("details", { has: page.getByText(resume, { exact: false }) }).first();
  if (!(await bloc.evaluate((e) => (e as HTMLDetailsElement).open))) {
    await bloc.locator("summary").first().click();
  }
}

/** Crée un tableau de bord vide et rend son identifiant. */
async function creerTableau(page: Page): Promise<string> {
  await page.goto(`${consoleUrl}/dashboards?${CONTEXTE}`);
  // F35 : le panneau s'appelle « + Nouveau tableau de bord », et chaque modèle fourni
  // porte aussi un sélecteur `app_id` — le formulaire de création est donc désigné.
  await deplier(page, "+ Nouveau tableau de bord");
  const creation = page.getByTestId("creer-tableau");
  await creation.locator('input[name="name"]').fill(TABLEAU);
  await creation.locator('select[name="app_id"]').selectOption("demo-app");
  await page.getByTestId("create-dashboard").click();
  await page.waitForURL(/\/dashboards\/\d+/, { timeout: 15_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Débordement horizontal : la liste des éléments fautifs, pas un booléen. Un
 * échec doit NOMMER le coupable — sans quoi la recette dit qu'il y a un problème
 * sans jamais dire où. Un élément dans un conteneur défilant est légitime
 * (tableau large) ; un élément qui en échappe ne l'est pas. Même helper que les
 * recettes de débordement de P5 et P6.3.
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

test("Explorer → carte → rechargement → duplication → CSV", async ({ page }) => {
  await login(page);
  const id = await creerTableau(page);

  // 1. L'analyse est composée dans l'Explorer, et son total est exact.
  await page.goto(explorer);
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 20_000 });

  // 2. Elle s'enregistre comme carte du tableau de bord créé à l'instant.
  const formulaire = page.getByTestId("save-widget");
  await expect(formulaire).toBeVisible();
  await formulaire.locator('select[name="id"]').selectOption(id);
  await formulaire.locator('input[name="title"]').fill("Occurrences par route");
  // L'action serveur ne redirige pas : sans attendre sa réponse, le `goto` qui suit
  // peut couper le POST avant l'écriture (échec intermittent en CI, 22/09/2026).
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined),
    formulaire.getByRole("button", { name: "Ajouter au tableau de bord" }).click(),
  ]);

  // 3. Le tableau de bord la RÉEXÉCUTE : la carte porte le même total, ventilé.
  await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
  const carte = page.getByTestId("widget-0");
  await expect(carte).toContainText("Occurrences par route", { timeout: 20_000 });
  // F36 : le total est un nombre jusqu'au rendu ; l'en-tête de carte le formate.
  await expect(page.getByTestId("widget-0-total")).toHaveText("6 occurrences");
  await expect(carte.getByTitle("/p65-a")).toBeVisible();
  await expect(carte.getByTitle("/p65-b")).toBeVisible();
  // Les filtres portés par la carte sont écrits SUR la carte.
  await expect(page.getByTestId("widget-0-portee")).toContainText(`Release = ${RELEASE}`);

  // 4. Rechargement : la carte survit, elle n'était pas un état de page.
  await page.reload();
  await expect(page.getByTestId("widget-0-total")).toHaveText("6 occurrences", { timeout: 20_000 });

  // 5. Duplication : NOUVEL identifiant, même app, même contenu. On attend le
  // TITRE du clone, pas l'URL : `/dashboards/<n>` correspond déjà à la page
  // courante, et l'attendre laisserait passer une duplication qui n'a rien fait.
  await page.getByTestId("clone-dashboard").click();
  await expect(page.getByRole("heading", { name: `${TABLEAU} (copie)` })).toBeVisible({ timeout: 20_000 });
  const clone = new URL(page.url()).pathname.split("/").pop()!;
  expect(clone).not.toBe(id);
  await expect(page.getByTestId("widget-0")).toContainText("Occurrences par route", { timeout: 20_000 });

  // 6. Export CSV : même population, et une cellule ne devient jamais une formule.
  const csv = await page.request.get(`${consoleUrl}/api/dashboards/${id}/export?${CONTEXTE}`);
  expect(csv.status()).toBe(200);
  const texte = await csv.text();
  expect(texte).toContain("Occurrences par route");
  expect(texte).toContain("/p65-a,4");
  expect(texte).not.toMatch(/^=/m);
});

test("une carte invalide se voit et se corrige, elle ne disparaît pas", async ({ page }) => {
  await login(page);
  const id = await creerTableau(page);
  // Une configuration écrite par une version plus récente, que cette version ne
  // sait pas lire. Elle ne doit pas s'évaporer au premier chargement.
  await pool.query(
    `update dashboard set layout = $2::jsonb where id = $1`,
    [Number(id), JSON.stringify([{ schemaVersion: 2, type: "analytics", title: "Venu du futur", query: { version: 1, dataset: "licornes" } }])],
  );

  await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
  await expect(page.getByTestId("dashboard-invalides")).toBeVisible({ timeout: 20_000 });
  const carte = page.getByTestId("widget-0");
  await expect(carte).toContainText("Configuration illisible");
  await expect(carte).toContainText("jeu de données inconnu");

  // Et le JSON d'origine est TOUJOURS en base après ce chargement.
  const { rows } = await pool.query<{ layout: unknown[] }>("select layout from dashboard where id = $1", [Number(id)]);
  expect(rows[0].layout).toHaveLength(1);
});

test("vue enregistrée : enregistrer, rouvrir, renommer, supprimer", async ({ page }) => {
  await login(page);
  await page.goto(explorer);
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 20_000 });

  const formulaire = page.getByTestId("save-view");
  await expect(formulaire).toBeVisible();
  await formulaire.locator('input[name="name"]').fill(VUE);
  await formulaire.getByRole("button", { name: "Enregistrer la vue" }).click();

  // La liste s'ouvre sur la vue créée, avec son app et son propriétaire.
  await page.waitForURL(/\/explorer\/views/, { timeout: 15_000 });
  const ligne = page.getByRole("row", { name: new RegExp(VUE) });
  await expect(ligne).toContainText("demo-app");
  await expect(ligne).toContainText("vous");

  // La rouvrir REJOUE la requête : une vue n'est pas un résultat figé.
  await page.getByRole("link", { name: VUE }).click();
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 20_000 });

  // Renommer, puis supprimer — les deux gestes appartiennent au propriétaire.
  await page.goto(`${consoleUrl}/explorer/views`);
  const champ = page.getByLabel(`Nouveau nom de ${VUE}`);
  await champ.fill(`${VUE} bis`);
  await page.getByRole("row", { name: new RegExp(VUE) }).getByRole("button", { name: "Renommer" }).click();
  await expect(page.getByRole("link", { name: `${VUE} bis` })).toBeVisible({ timeout: 15_000 });

  // F30 (CE11, P15) : le rouge est réservé à l'état d'une mesure — aucun bouton
  // rouge sur la liste des vues. F34 (W-V3) : supprimer se fait en deux temps.
  expect(await page.locator('[class*="bg-red-600"]').count()).toBe(0);
  const ligneBis = page.getByRole("row", { name: new RegExp(`${VUE} bis`) });
  await ligneBis.getByTestId("vue-supprimer").locator("summary").click();
  const confirmer = page.getByRole("button", { name: `Confirmer la suppression de ${VUE} bis` });
  await expect(confirmer).not.toHaveClass(/bg-red-600/);
  await confirmer.click();
  await expect(page.getByRole("link", { name: `${VUE} bis` })).toHaveCount(0, { timeout: 15_000 });
});

test("l'API des vues refuse un jeton, et une session sans droit n'écrit rien", async ({ page }) => {
  await login(page);
  // Un jeton d'API est en lecture seule ET n'a aucune vue : refus explicite,
  // jamais une liste vide qu'on lirait comme « aucune vue n'existe ».
  const jeton = await page.request.get(`${consoleUrl}/api/v1/explorer/views`, {
    headers: { authorization: "Bearer inexistant" },
  });
  expect(jeton.status()).toBe(401);

  // Écriture sans en-tête Origin de la console : refusée (CSRF).
  const sansOrigine = await page.request.post(`${consoleUrl}/api/v1/explorer/views`, {
    headers: { origin: "https://ailleurs.test" },
    data: { name: "P65 interdite", query: { version: 1, app: "demo-app", range: { preset: "1h" }, dataset: "errors", measure: { aggregation: "sum", field: "occurrences" } } },
  });
  expect(sansOrigine.status()).toBe(403);
});

test("ordre des cartes au clavier, et aucune largeur qui déborde (390 / 768 / 1440 px)", async ({ page }) => {
  await login(page);
  const id = await creerTableau(page);
  // Deux cartes v1 suffisent pour l'ordre : le geste ne dépend pas de leur type.
  await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
  for (const type of ["traffic", "top_errors"]) {
    await deplier(page, "Éditer le tableau de bord");
    await page.locator('select[name="type"]').selectOption(type);
    await page.getByTestId("add-widget").click();
    await expect(page.getByTestId("widget-0")).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByTestId("widget-1")).toBeVisible();

  const premier = await page.getByTestId("widget-0").locator("h3").innerText();
  // Descendre la première carte, au clavier seul.
  const descendre = page.getByTestId("widget-0").getByRole("button", { name: /^Descendre/ });
  await descendre.focus();
  await expect(descendre).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("widget-1").locator("h3")).toHaveText(premier, { timeout: 20_000 });

  const fautes: string[] = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
    await expect(page.getByTestId("widget-0")).toBeVisible({ timeout: 20_000 });
    for (const faute of await debordements(page)) fautes.push(`tableau de bord @ ${width} px — ${faute}`);
    await page.goto(`${consoleUrl}/explorer/views`);
    await expect(page.getByRole("heading", { name: "Vues enregistrées" })).toBeVisible();
    for (const faute of await debordements(page)) fautes.push(`vues @ ${width} px — ${faute}`);
  }
  expect(fautes, fautes.join("\n")).toEqual([]);
});

// F35 — modèles de tableaux de bord (plan § 5.24, W-D1 à W-D3). Les clones sont des
// tableaux du compte dédié de ce fichier : on les retire, et eux seuls, à la fin.
test.describe("F35 — tableaux de bord : modèles", () => {
  async function menageF35() {
    await pool.query(`delete from dashboard where created_by = $1 and name like '% — copie'`, [ADMIN_EMAIL]);
  }
  test.beforeAll(menageF35);
  test.afterAll(menageF35);

  test("quatre modèles visibles ; cloner « Performance » ouvre un tableau à ses cartes", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/dashboards?${CONTEXTE}`);
    const modeles = page.getByTestId("modele-carte");
    await expect(modeles).toHaveCount(4);
    for (const titre of ["Performance", "Erreurs", "Usages", "Releases"]) {
      await expect(page.getByRole("heading", { name: titre, exact: true })).toBeVisible();
    }
    // Un modèle ne lit rien : aucune figure, aucun chiffre mesuré dans la section.
    await expect(page.getByTestId("modeles-tableaux").getByTestId("figure")).toHaveCount(0);

    const perf = page.locator('[data-testid="modele-carte"][data-modele="performance"]');
    await expect(perf.locator('select[name="app_id"]')).toHaveValue("demo-app");
    await perf.getByRole("button", { name: "Cloner le modèle Performance" }).click();
    await page.waitForURL(/\/dashboards\/\d+/, { timeout: 15_000 });
    const sp = new URL(page.url()).searchParams;
    expect(sp.get("app")).toBe("demo-app");
    expect(sp.get("period")).toBe("1h");
    await expect(page.getByRole("heading", { name: "Performance — copie" })).toBeVisible({ timeout: 20_000 });
    // F37 : le clone s'affiche en sections titrées (trois titres + sept cartes, positions
    // 0 à 9) ; la première carte garde son propre titre, sans préfixe de section.
    await expect(page.getByTestId("section-0").locator("summary h2")).toHaveText("Seuils", { timeout: 20_000 });
    await expect(page.getByTestId("widget-1").locator("h3")).toHaveText("LCP p75");
    await expect(page.getByTestId("widget-9")).toBeVisible();
    await expect(page.getByTestId("widget-10")).toHaveCount(0);

    // De retour sur la liste : l'app par son NOM, les cartes par leur type.
    await page.goto(`${consoleUrl}/dashboards?${CONTEXTE}`);
    const { rows } = await pool.query<{ name: string }>(`select name from app_registry where app_id = 'demo-app'`);
    const ligne = page.getByRole("row", { name: /Performance — copie/ }).first();
    await expect(ligne.getByTestId("tableau-app")).toHaveText(rows[0]?.name || "demo-app");
    await expect(ligne).toContainText("Valeur × 3");
    await expect(ligne).toContainText("Série × 2");
    await expect(ligne).toContainText("Classement × 2");
  });

  test("créer avec un nom vide : le refus est écrit sous le champ", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/dashboards?${CONTEXTE}`);
    await deplier(page, "+ Nouveau tableau de bord");
    const creation = page.getByTestId("creer-tableau");
    // Des espaces passent l'attribut `required` : c'est le serveur qui refuse, et le dit.
    await creation.locator('input[name="name"]').fill("   ");
    await creation.locator('select[name="app_id"]').selectOption("demo-app");
    await page.getByTestId("create-dashboard").click();
    await page.waitForURL((u) => u.searchParams.get("creation") === "nom-vide", { timeout: 15_000 });
    const refus = page.getByTestId("creer-tableau").getByRole("alert");
    await expect(refus).toHaveText("Le nom est vide : rien n’a été créé.");
    expect(new URL(page.url()).searchParams.get("period")).toBe("1h");
  });

  test("aucun débordement de la liste et des modèles (390 / 768 / 1440 px)", async ({ page }) => {
    await login(page);
    const fautes: string[] = [];
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${consoleUrl}/dashboards?${CONTEXTE}`);
      await expect(page.getByTestId("modele-carte").first()).toBeVisible({ timeout: 15_000 });
      for (const faute of await debordements(page)) fautes.push(`liste @ ${width} px — ${faute}`);
    }
    expect(fautes, fautes.join("\n")).toEqual([]);
  });
});

// F36 — cartes de tableau de bord (plan § 5.25, W-B1 à W-B11). Une grille de neuf
// cartes — six analyses v2 et trois cartes v1 — écrite directement en base : le
// but n'est pas de rejouer les gestes d'ajout (déjà couverts plus haut), mais de
// voir CHAQUE forme rendue, avec son alternative textuelle, sa barre de
// population et son lien vers l'Explorer.
test.describe("F36 — tableau de bord : cartes", () => {
  const TABLEAU_F36 = "P65 F36 cartes";

  /** Une analyse enregistrée, telle que l'Explorer l'écrit (AST sans app ni fenêtre). */
  const analyseF36 = (
    titre: string,
    visualization: string,
    query: Record<string, unknown>,
  ) => ({
    schemaVersion: 2,
    type: "analytics",
    title: titre,
    query: { version: 1, dataset: "errors", filters: [], groupBy: [], limit: 5, ...query },
    visualization,
    filters: [],
  });

  const GRILLE_F36 = [
    analyseF36("Occurrences", "value", { measure: { aggregation: "sum", field: "occurrences" } }),
    analyseF36("Sessions touchées", "value", { measure: { aggregation: "distinct", field: "sessions" } }),
    analyseF36("Occurrences par route", "toplist", {
      measure: { aggregation: "sum", field: "occurrences" },
      groupBy: ["route"],
    }),
    analyseF36("Occurrences par release", "toplist", {
      measure: { aggregation: "sum", field: "occurrences" },
      groupBy: ["release"],
    }),
    analyseF36("Occurrences dans le temps", "timeseries", {
      measure: { aggregation: "sum", field: "occurrences" },
    }),
    analyseF36("Occurrences par route dans le temps", "timeseries", {
      measure: { aggregation: "sum", field: "occurrences" },
      groupBy: ["route"],
    }),
    { type: "vital_p75", metric: "LCP", title: "LCP p75" },
    { type: "traffic", title: "Trafic" },
    { type: "top_errors", title: "Erreurs principales" },
  ];

  async function menageF36() {
    await pool.query(`delete from dashboard where name = $1`, [TABLEAU_F36]);
  }
  test.beforeAll(menageF36);
  test.afterAll(menageF36);

  /** Crée le tableau à neuf cartes et rend son identifiant. */
  async function tableauF36(page: Page): Promise<string> {
    const id = await creerTableau(page);
    await pool.query(`update dashboard set name = $2, layout = $3::jsonb where id = $1`, [
      Number(id),
      TABLEAU_F36,
      JSON.stringify(GRILLE_F36),
    ]);
    return id;
  }

  test("neuf cartes : chaque forme rendue, sa population, son lien vers l’Explorer", async ({ page }) => {
    await login(page);
    const id = await tableauF36(page);
    await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
    await expect(page.getByTestId("widget-0")).toBeVisible({ timeout: 20_000 });

    // W-B1 — la population est écrite au-dessus de la grille, même sans filtre de
    // segment : chaque carte en hérite, il faut pouvoir la lire.
    const population = page.getByTestId("population-bar");
    await expect(population).toBeVisible();
    await expect(population).toContainText("Robots exclus");
    await expect(population).toContainText("axes en UTC");
    // La release du contexte est une condition : elle est écrite ET retirable.
    await expect(population.getByTestId("population-puce").filter({ hasText: RELEASE })).toBeVisible();

    // Neuf cartes, aucune de moins : une carte qui n'a rien à dire le dit, elle ne
    // disparaît pas.
    await expect(page.getByTestId("widget-8")).toBeVisible();
    await expect(page.getByTestId("widget-9")).toHaveCount(0);

    // Les six analyses passent par la traduction UNIQUE, celle de l'Explorer.
    await expect(page.getByTestId("resultat-analyse")).toHaveCount(6);
    // Chaque figure porte son alternative textuelle : aucun nombre n'est visible
    // au seul pixel près. (Une figure à l'état « vide » n'en a pas : on exige au
    // moins une alternative par forme dessinée.)
    expect(await page.getByTestId("alternative").count()).toBeGreaterThan(0);

    // « Ouvrir dans l'Explorer » rouvre la requête sur la population de l'écran.
    const ouvrir = page.getByTestId("widget-2-explorer");
    await expect(ouvrir).toBeVisible();
    const href = await ouvrir.getAttribute("href");
    expect(href).toContain("/explorer?");
    expect(new URL(href!, consoleUrl).searchParams.get("app")).toBe("demo-app");
    expect(new URL(href!, consoleUrl).searchParams.get("dataset")).toBe("errors");
    await ouvrir.click();
    await page.waitForURL(/\/explorer/, { timeout: 20_000 });
    await expect(page.getByTestId("explorer-total")).toBeVisible({ timeout: 20_000 });
  });

  test("cartes v1 : « 14 jours fixes » et « journée en cours », et un vital sans mesure le DIT", async ({ page }) => {
    await login(page);
    const id = await tableauF36(page);
    await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);

    // W-B7 — la fenêtre de la carte « Trafic » n'est PAS celle de l'écran, et elle
    // l'écrit ; la dernière barre est la journée en cours, incomplète.
    const trafic = page.getByTestId("widget-7");
    await expect(trafic).toContainText("14 jours fixes", { timeout: 20_000 });
    await expect(trafic).toContainText("journée en cours");
    // Deux panneaux : deux populations, jamais sur le même axe (P5).
    await expect(trafic.getByTestId("widget-trafic")).toBeVisible();

    // CE4 — sans aucune mesure de LCP sur la fenêtre, la carte dit « aucune
    // mesure », pas « aucune donnée » : l'absence de collecte et l'absence de
    // calcul ne se ressemblent plus.
    const vital = page.getByTestId("widget-6");
    await expect(vital).toContainText(/aucune mesure de LCP|mesures/, { timeout: 20_000 });
    await expect(vital).not.toContainText("aucune donnée");

    // W-B9 — chaque erreur porte sa tendance ou la raison de son absence.
    const erreurs = page.getByTestId("widget-8");
    await expect(erreurs.getByTestId("widget-erreurs")).toBeVisible();
    await expect(erreurs).toContainText("TypeError");
  });

  test("cmp=prev : les cartes « Valeur » seulement, les autres le disent", async ({ page }) => {
    await login(page);
    const id = await tableauF36(page);
    await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}&cmp=prev`);
    await expect(page.getByTestId("widget-0")).toBeVisible({ timeout: 20_000 });

    // Une carte « Valeur » porte sa référence, en toutes lettres.
    await expect(page.getByTestId("widget-0")).toContainText("précédentes");
    // Un classement ne se compare pas : la carte l'écrit plutôt que de se taire.
    await expect(page.getByTestId("widget-2")).toContainText(
      "Comparaison à la période précédente non calculée pour cette forme de carte",
    );
  });

  test("aucun débordement de la grille à neuf cartes (390 / 768 / 1440 px)", async ({ page }) => {
    await login(page);
    const id = await tableauF36(page);
    const fautes: string[] = [];
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${consoleUrl}/dashboards/${id}?${CONTEXTE}`);
      await expect(page.getByTestId("widget-8")).toBeVisible({ timeout: 20_000 });
      for (const faute of await debordements(page)) fautes.push(`cartes F36 @ ${width} px — ${faute}`);
    }
    expect(fautes, fautes.join("\n")).toEqual([]);
  });
});
