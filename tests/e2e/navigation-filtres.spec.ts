// P6.2 — la navigation client de la console aboutit, et les filtres la suivent.
//
// CE QUI ÉTAIT CASSÉ. Un `<Link>` vers la MÊME route avec une autre query, et
// `router.refresh()` (le « LIVE · 5 s »), pouvaient rester en suspens pour toujours :
// l'URL changeait, l'écran non. La cause était les frontières `loading.tsx` de
// /events, /errors et /actions — la transition racine restait suspendue, sans ping,
// et seule une reprise ultérieure la débloquait. P5 contournait par des ancres
// natives (rechargement complet) ; P6.2 retire les frontières et rend les liens.
//
// Ce test échoue si la régression revient : il vérifie que l'URL ET le contenu
// changent, et que le document n'a PAS été rechargé (un marqueur posé dans la page
// survit à toute navigation client, jamais à un rechargement).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const SESSION = "p62-nav-session";
const SPANS = ["62ba000000000001", "62ba000000000002"];
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-navigation-filtres@mip-rum.local";
let adminPassword = "";

test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(
    `insert into rum_session (session_id,app_id,device_type,geo_country,sample_rate,error_sample_rate,last_seen_at)
     values ($1,'demo-app','mobile','FR',1,1,now())
     on conflict (session_id) do update set last_seen_at = now(), device_type = 'mobile', geo_country = 'FR'`,
    [SESSION],
  );
  await pool.query(`delete from rum_event_index where source_span_id = any($1::text[])`, [SPANS]);
  await pool.query(`delete from rum_event where span_id = any($1::text[])`, [SPANS]);
  await pool.query(
    `insert into rum_event (span_id,session_id,app_id,route,name,props,context,ts)
     values ($1,$2,'demo-app','/p62-nav','p62-navigation','{}'::jsonb,'{}'::jsonb, now())`,
    [SPANS[0], SESSION],
  );
  await pool.query(
    `insert into rum_event_index (app_id,session_id,ts,route,kind,source_name,source_span_id)
     values ('demo-app',$1, now(), '/p62-nav','event','track',$2)`,
    [SESSION, SPANS[0]],
  );
});

test.afterAll(async () => {
  await pool.query(`delete from rum_event_index where source_span_id = any($1::text[])`, [SPANS]);
  await pool.query(`delete from rum_event where span_id = any($1::text[])`, [SPANS]);
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

/** Marque le document courant : le marqueur ne survit pas à un rechargement complet. */
const marquer = (page: Page) => page.evaluate(() => ((window as unknown as { __p62?: number }).__p62 = Date.now()));
const memeDocument = (page: Page) => page.evaluate(() => (window as unknown as { __p62?: number }).__p62 !== undefined);

test("mêmes route et query : le lien, le filtre et le rafraîchissement aboutissent sans rechargement", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile&name=p62-navigation`);
  // F25 : l'écran s'appelle « Journal » ; le total est une tuile (`kpi-valeur`).
  await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();
  await expect(page.getByTestId("events-total").getByTestId("kpi-valeur")).toHaveText("1");
  await marquer(page);

  // 1. « Réinitialiser » : même route, autre query — le cas qui restait en suspens.
  await page.getByRole("link", { name: "Réinitialiser" }).click();
  await expect(page).toHaveURL(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile`, { timeout: 10_000 });
  await expect(page.getByLabel("Nom d’événement")).toHaveValue("", { timeout: 10_000 });
  expect(await memeDocument(page)).toBe(true);

  // 2. Filtre global : la période change l'URL et l'écran, toujours sans rechargement.
  await page.getByTestId("filter-period").getByRole("button", { name: "24 h" }).click();
  await expect(page).toHaveURL(`${consoleUrl}/events?app=demo-app&device=mobile`, { timeout: 10_000 });
  await expect(page.getByText(/signaux émis par le SDK, observés sur 24 h/)).toBeVisible({ timeout: 10_000 });
  expect(await memeDocument(page)).toBe(true);

  // 3. « LIVE · 5 s » : une ligne ingérée apparaît sans que personne ne recharge.
  // La population est resserrée sur l'événement de ce test : les autres suites E2E
  // écrivent dans la même app, et un compteur global serait un compteur partagé.
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile&name=p62-navigation`);
  await expect(page.getByTestId("events-total").getByTestId("kpi-valeur")).toHaveText("1");
  await marquer(page);
  await pool.query(
    `insert into rum_event (span_id,session_id,app_id,route,name,props,context,ts)
     values ($1,$2,'demo-app','/p62-nav','p62-navigation','{}'::jsonb,'{}'::jsonb, now())`,
    [SPANS[1], SESSION],
  );
  await pool.query(
    `insert into rum_event_index (app_id,session_id,ts,route,kind,source_name,source_span_id)
     values ('demo-app',$1, now(), '/p62-nav','event','track',$2)`,
    [SESSION, SPANS[1]],
  );
  await expect(page.getByTestId("events-total").getByTestId("kpi-valeur")).toHaveText("2", { timeout: 30_000 });
  expect(await memeDocument(page)).toBe(true);
});

test("drill-down et segments : les filtres suivent, et un filtre inapplicable se dit", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile`);
  await expect(page.getByTestId("events-total")).toHaveText(/\d/);
  await marquer(page);

  // Segment v2 depuis la barre : l'URL le porte, l'écran l'applique.
  await page.getByTestId("segment-add").click();
  await page.getByTestId("segment-dimension").selectOption("country");
  await page.getByTestId("segment-value").fill("FR");
  await page.getByTestId("segment-confirm").click();
  await expect(page).toHaveURL(/seg=v2%3Acountry%3Aeq%3AFR/, { timeout: 10_000 });
  await expect(page.getByTestId("segment-chip").first()).toContainText("FR");
  expect(await memeDocument(page)).toBe(true);
  await expect(page.getByTestId("events-total")).toHaveText(/\d/);

  // Drill-down vers la session : app, plage, appareil et segment restent dans l'URL.
  const lien = page.getByRole("link", { name: new RegExp(SESSION.slice(0, 8)) }).first();
  await expect(lien).toBeVisible();
  const href = await lien.getAttribute("href");
  expect(href).toContain("app=demo-app");
  expect(href).toContain("period=1h");
  expect(href).toContain("device=mobile");
  expect(href).toContain("seg=v2%3Acountry%3Aeq%3AFR");

  // Un filtre que l'écran ne sait pas appliquer : refus récupérable, jamais un chiffre faux.
  await page.goto(`${consoleUrl}/pages?app=demo-app&service=api`);
  const refus = page.getByTestId("filter-problem");
  await expect(refus).toBeVisible();
  await expect(refus).toContainText("Service");
  await page.getByTestId("filter-problem-reset").click();
  await expect(page).toHaveURL(`${consoleUrl}/pages?app=demo-app`, { timeout: 10_000 });
  await expect(page.getByTestId("filter-problem")).toHaveCount(0);
});

// ─── F09 : navigation en cinq catégories et coquille ─────────────────────────
//
// Plan § 2.2 / § 2.3 : chaque écran du périmètre est atteignable depuis la
// nouvelle navigation, AUCUNE route ne change d'adresse, et aucun écran ne
// déborde à 390, 768 ou 1440 px (définition de « fait », § 0.4).

/** Les cinq catégories, leurs onglets RENDUS dans l'ordre, et leur landing. */
const NAVIGATION = [
  {
    categorie: "Performance",
    landing: "/",
    onglets: [
      ["/", "Vue d'ensemble"],
      ["/pages", "Pages"],
      ["/errors", "Erreurs et issues"],
      ["/ux", "Interactions"],
      ["/experience", "Satisfaction"],
      ["/mobile", "Mobile"],
    ],
  },
  {
    categorie: "Robot et réel",
    landing: "/correlation",
    onglets: [
      ["/correlation", "Corrélation synthétique ↔ RUM"],
      ["/tracing", "Tracing"],
      ["/map", "Carte"],
    ],
  },
  {
    categorie: "Usages",
    landing: "/sessions",
    onglets: [
      ["/sessions", "Sessions"],
      ["/paths", "Parcours"],
      ["/goals", "Conversions"],
      ["/forms", "Formulaires"],
      ["/acquisition", "Acquisition"],
      ["/retention", "Rétention"],
    ],
  },
  {
    categorie: "Fiabilité",
    landing: "/slo",
    onglets: [
      ["/slo", "SLO"],
      ["/alerts", "Alertes"],
      ["/forecast", "Tendances"],
    ],
  },
  {
    categorie: "Explorer",
    landing: "/explorer",
    onglets: [
      ["/explorer", "Explorer"],
      ["/events", "Journal"],
      ["/dashboards", "Tableaux de bord"],
    ],
  },
] as const;

/** Routes du périmètre (§ 2.3), /actions comprise : gardée, sans onglet propre. */
const ROUTES: string[] = [...NAVIGATION.flatMap((c) => c.onglets.map(([href]) => href)), "/actions", "/explorer/views"];

/** Un écran rendu : un titre, et pas la page d'erreur de Next. */
async function ecranRendu(page: Page, chemin: string) {
  await expect(page.locator("main h1").first(), `${chemin} : aucun titre`).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Application error"), `${chemin} : écran en erreur`).toHaveCount(0);
}

test("chaque écran du périmètre est atteignable par la sidebar et les sous-onglets, filtres compris", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${consoleUrl}/?app=demo-app&period=1h`);
  await ecranRendu(page, "/");
  const sidebar = page.locator("aside nav").first();

  for (const { categorie, landing, onglets } of NAVIGATION) {
    // La catégorie mène à sa landing en gardant la population (contextHref).
    await sidebar.getByRole("link", { name: categorie, exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === landing && u.searchParams.get("period") === "1h", { timeout: 30_000 });
    await ecranRendu(page, landing);

    // La barre ne rend QUE les onglets déclarés visibles, dans l'ordre du plan.
    const barre = page.getByTestId("subnav");
    await expect(barre.getByRole("link")).toHaveText(onglets.map(([, label]) => label));
    for (const [href, label] of onglets) {
      await barre.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL((u) => u.pathname === href && u.searchParams.get("period") === "1h", { timeout: 30_000 });
      await ecranRendu(page, href);
      await expect(page.getByTestId("subnav").getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
  }

  // /actions : route gardée, sans onglet ; « Interactions » reste allumé.
  await page.goto(`${consoleUrl}/actions?app=demo-app&period=1h`);
  await ecranRendu(page, "/actions");
  await expect(page.getByTestId("subnav").getByRole("link", { name: "Interactions", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("subnav").getByRole("link", { name: "Actions", exact: true })).toHaveCount(0);
});

test("rafraîchissement : LIVE partout, lecture à la demande sur l'Explorer et les tableaux de bord", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/errors?app=demo-app&period=1h`);
  await expect(page.getByTestId("rafraichissement")).toHaveAttribute("data-mode", "live");
  for (const chemin of ["/explorer", "/dashboards"]) {
    await page.goto(`${consoleUrl}${chemin}?app=demo-app&period=1h`);
    const pastille = page.getByTestId("rafraichissement");
    await expect(pastille).toHaveAttribute("data-mode", "demande");
    await expect(pastille).toContainText("Lecture à la demande");
    await expect(pastille.getByRole("button", { name: "Relire" })).toBeVisible();
  }
});

test("aucun débordement horizontal à 390, 768 et 1440 px sur chaque route du périmètre", async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  // Toutes les combinaisons sont PARCOURUES avant d'échouer : s'arrêter au premier
  // écran fautif cacherait les suivants.
  const fautes: string[] = [];
  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 900 });
    for (const chemin of ROUTES) {
      await page.goto(`${consoleUrl}${chemin}?app=demo-app&period=24h`);
      await ecranRendu(page, chemin);
      for (const faute of await debordements(page)) fautes.push(`${chemin} @ ${largeur} px — ${faute}`);
    }
  }
  expect(fautes).toEqual([]);
});

test("à 390 px : menu de navigation contextuel et widget d'avis replié", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${consoleUrl}/errors?app=demo-app&period=1h`);
  await ecranRendu(page, "/errors");
  // Le libellé est en sr-only sous l'icône : on clique le bouton lui-même (le <summary>).
  await page.locator("summary").filter({ hasText: "Ouvrir la navigation" }).click();
  const usages = page.locator("details nav").getByRole("link", { name: "Usages", exact: true });
  await expect(usages).toBeVisible();
  expect(await usages.getAttribute("href")).toContain("period=1h");
  // Le lanceur garde son nom accessible, mais pas son libellé visible.
  const avis = page.locator('button[aria-label="Votre avis ?"]');
  if (await avis.count()) await expect(avis).toHaveText("💬");
});
