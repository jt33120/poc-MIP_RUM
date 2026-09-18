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
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const SESSION = "p62-nav-session";
const SPANS = ["62ba000000000001", "62ba000000000002"];
let adminPassword = "";

test.beforeAll(async () => {
  const out = execFileSync("node", ["scripts/seed-admin.mjs"], { encoding: "utf8" });
  adminPassword = out.match(/julian@mip-rum\.local.*?:\s*(\S+)/s)?.[1] ?? "";
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
  await page.fill('input[name="email"]', "julian@mip-rum.local");
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
  await expect(page.getByRole("heading", { name: "Événements" })).toBeVisible();
  await expect(page.getByTestId("events-total")).toHaveText("1");
  await marquer(page);

  // 1. « Réinitialiser » : même route, autre query — le cas qui restait en suspens.
  await page.getByRole("link", { name: "Réinitialiser" }).click();
  await expect(page).toHaveURL(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile`, { timeout: 10_000 });
  await expect(page.getByLabel("Nom d’événement")).toHaveValue("", { timeout: 10_000 });
  expect(await memeDocument(page)).toBe(true);

  // 2. Filtre global : la période change l'URL et l'écran, toujours sans rechargement.
  await page.getByTestId("filter-period").getByRole("button", { name: "24 h" }).click();
  await expect(page).toHaveURL(`${consoleUrl}/events?app=demo-app&device=mobile`, { timeout: 10_000 });
  await expect(page.getByText(/Explorer les événements custom observés sur 24 h/)).toBeVisible({ timeout: 10_000 });
  expect(await memeDocument(page)).toBe(true);

  // 3. « LIVE · 5 s » : une ligne ingérée apparaît sans que personne ne recharge.
  // La population est resserrée sur l'événement de ce test : les autres suites E2E
  // écrivent dans la même app, et un compteur global serait un compteur partagé.
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile&name=p62-navigation`);
  await expect(page.getByTestId("events-total")).toHaveText("1");
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
  await expect(page.getByTestId("events-total")).toHaveText("2", { timeout: 30_000 });
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
