// E2E — P*.9 : récit de session composé de faits, bloc « En bref ».
//
// CE QUE CE SPEC EXISTE POUR PROUVER (critère de recette du plan, § 7.2 P*.9).
//   - Chaque phrase du récit a un lien, et ce lien MÈNE à une ligne qui existe
//     dans la chronologie (pas une ancre morte) : clic → la ligne est la cible.
//   - Depuis un onglet sans chronologie (Erreurs, F44), les liens ramènent au Déroulé.
//   - Les occurrences sont sommées (« 3 occurrences », pas « 1 erreur »).
//   - Une session sans rejeu le dit ; une session sans événement n'a pas de récit.
//   - Aucun mot qui prête une intention ou une cause.
//   - Aucun débordement horizontal à 390, 768 et 1440 px.
//
// Données SYNTHÉTIQUES dans une app dédiée ; compte dédié (helpers/compte-dedie.ts).
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const APP = "ps9-e2e-app";
const EMAIL = "e2e-recit-session@mip-rum.local";
const RICHE = "ps9-e2e-riche";
const REJEU = "ps9-e2e-rejeu";
const VIDE = "ps9-e2e-vide";
const ACTION = "99999999-4444-4555-8666-777777777777";
let motDePasse = "";

async function menage() {
  await pool.query("delete from replay_chunk where app_id = $1", [APP]);
  for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_event", "rum_span", "rum_action"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP]).catch(() => {});
  await pool.query("delete from rum_session where app_id = $1", [APP]);
}

async function semer() {
  await pool.query(
    "insert into app_registry (app_id, name, active) values ($1, 'Récit E2E', true) on conflict (app_id) do update set active = true",
    [APP],
  );
  await menage();
  const t0 = "now() - interval '3 hours'";
  const a = (s: number) => `${t0} + interval '${s} seconds'`;
  for (const sid of [RICHE, REJEU, VIDE]) {
    await pool.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', ${t0}, ${a(372)}, 4)`,
      [sid, APP],
    );
  }
  const vues: [string, number][] = [["/", 0], ["/catalogue", 60], ["/panier", 180], ["/paiement", 300]];
  for (const [i, [route, s]] of vues.entries()) {
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, ${a(s)})`,
      [`ps9e2epv${i}`, RICHE, APP, route],
    );
  }
  await pool.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
     values ('ps9e2elcp', $1, $2, '/panier', 'LCP', 4800, 'poor', ${a(182)})`,
    [RICHE, APP],
  );
  await pool.query(
    `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
     values ($1, 'a9e2e00000000001', $2, $3, 'click', 'Payer', '/paiement', ${a(330)})`,
    [ACTION, RICHE, APP],
  );
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, action_id, route, ts)
     values ('ps9e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'ps9-e2e-fp', 3, $3, '/paiement', ${a(333)})`,
    [RICHE, APP, ACTION],
  );
  for (const [i, nom] of ["frustration.rage", "frustration.dead"].entries()) {
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ($1, $2, $3, '/paiement', $4, '{}'::jsonb, ${a(334 + i)})`,
      [`ps9e2efr${i}`, RICHE, APP, nom],
    );
  }
  // Session avec rejeu : une vue et un segment rrweb (vide mais lisible).
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ('ps9e2erj0', $1, $2, '/', ${t0})`,
    [REJEU, APP],
  );
  await pool.query("insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 0, 0, $3)", [
    REJEU,
    APP,
    gzipSync(Buffer.from("[]")),
  ]);
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, EMAIL);
  await semer();
});

test.afterAll(async () => {
  await menage();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

const url = (sid: string, extra = "") => `${consoleUrl}/sessions/${sid}?app=${APP}${extra}`;

test("chaque phrase mène à la ligne qui la fonde ; occurrences sommées ; rejeu absent dit", async ({ page }) => {
  await login(page);
  await page.goto(url(RICHE), { waitUntil: "domcontentloaded" });
  const recit = page.getByTestId("recit-session");
  await expect(recit).toContainText("En bref");
  await expect(recit).toContainText("4 vues : / → /catalogue → /panier → /paiement.");
  await expect(recit).toContainText("3 occurrences de TypeError sur /paiement, 3 s après le clic “Payer”.");
  await expect(recit).toContainText("Signaux de frustration reçus : 1 salve de clics, 1 clic sans réaction.");
  await expect(recit).toContainText("Aucun rejeu enregistré pour cette session");
  await expect(recit).toContainText("Récit composé à partir des événements reçus, sans interprétation.");
  await expect(recit).not.toContainText(/énerv|abandonn|cause|responsable/i);

  // Chaque lien du récit désigne une ligne de chronologie qui existe.
  const ancres = await recit.locator("a[data-ancre]").evaluateAll((els) => els.map((e) => e.getAttribute("data-ancre")));
  expect(ancres.length).toBeGreaterThanOrEqual(6);
  for (const ancre of ancres) await expect(page.locator(`[data-testid="timeline"] li#${ancre}`)).toHaveCount(1);

  // Clic sur la phrase d'erreur : la ligne d'erreur devient la cible.
  await recit.getByRole("link", { name: /3 occurrences de TypeError/ }).click();
  const cible = page.locator("li:target");
  await expect(cible).toContainText("TypeError");
});

// F44 : `tab=replay` (ancien lien) ouvre le Déroulé, qui porte le rejeu ET la
// chronologie — les liens du récit y sont des ancres de la page elle-même. Depuis un
// onglet sans chronologie (Erreurs), ils ramènent au Déroulé.
test("ancien lien tab=replay : le Déroulé porte la chronologie, les liens du récit y mènent", async ({ page }) => {
  await login(page);
  await page.goto(url(RICHE, "&tab=replay"), { waitUntil: "domcontentloaded" });
  const lien = page.getByTestId("recit-session").getByRole("link", { name: /3 occurrences de TypeError/ });
  await expect(lien).toHaveAttribute("href", /^#evt-\d+$/);
  await lien.click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.locator("li:target")).toContainText("TypeError");
});

test("onglet Erreurs : les liens du récit ramènent à la chronologie", async ({ page }) => {
  await login(page);
  await page.goto(url(RICHE, "&tab=erreurs"), { waitUntil: "domcontentloaded" });
  const lien = page.getByTestId("recit-session").getByRole("link", { name: /3 occurrences de TypeError/ });
  await expect(lien).toHaveAttribute("href", new RegExp(`^/sessions/${RICHE}\\?app=${APP}#evt-\\d+$`));
  await lien.click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.locator("li:target")).toContainText("TypeError");
});

test("session avec rejeu : aucune mention d'absence ; session sans événement : pas de récit", async ({ page }) => {
  await login(page);
  await page.goto(url(REJEU), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("recit-session")).toContainText("1 vue : /.");
  await expect(page.getByTestId("recit-rejeu")).toHaveCount(0);

  await page.goto(url(VIDE), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("recit-vide")).toContainText("Aucun événement pour cette session");
  await expect(page.getByTestId("recit-phrases")).toHaveCount(0);
});

async function debordements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= largeur) return [];
    const dansDefilant = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > largeur + 1)
      .filter((el) => ["absolute", "fixed"].includes(getComputedStyle(el).position) || !dansDefilant(el))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} « ${(el.textContent ?? "").trim().slice(0, 60)} »`);
  });
}

test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
  await login(page);
  const fautes: string[] = [];
  for (const largeur of [390, 768, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(url(RICHE), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("recit-session")).toBeVisible();
    for (const f of await debordements(page)) fautes.push(`/sessions/${RICHE} @ ${largeur} px — ${f}`);
  }
  expect(fautes).toEqual([]);
});
