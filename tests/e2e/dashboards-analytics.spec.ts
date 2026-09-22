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
  await deplier(page, "+ Nouveau dashboard");
  await page.fill('input[name="name"]', TABLEAU);
  await page.locator('select[name="app_id"]').selectOption("demo-app");
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
  await expect(carte).toContainText("6 occurrences");
  await expect(carte.getByTitle("/p65-a")).toBeVisible();
  await expect(carte.getByTitle("/p65-b")).toBeVisible();
  // Les filtres portés par la carte sont écrits SUR la carte.
  await expect(page.getByTestId("widget-0-portee")).toContainText(`Release = ${RELEASE}`);

  // 4. Rechargement : la carte survit, elle n'était pas un état de page.
  await page.reload();
  await expect(page.getByTestId("widget-0")).toContainText("6 occurrences", { timeout: 20_000 });

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
