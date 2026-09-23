// E2E — Cascade et Web Vitals situés du détail de session (F46, domaine Usages, règle S8).
//
// CE QUE CE SPEC EXISTE POUR PROUVER :
//   - preuve de fin du lot : une session commencée il y a DIX jours est située dans
//     une population ancrée sur ELLE — la méta dit « du JJ/MM au JJ/MM » (début − 7 j,
//     début + 1 j), jamais « 7 derniers jours » ; et les mesures récentes de la même
//     route, hors de cette fenêtre, ne sont PAS comptées ;
//   - le lien de la tuile porte `from` / `to` : la même population sur `/pages`,
//     reproductible ;
//   - une session récente : la fenêtre s'arrête à maintenant (jamais dans le futur) ;
//   - l'onglet Cascade place la chronologie sur un axe : une vue va « jusqu'à la vue
//     suivante », la dernière « jusqu'à la dernière observation » ; l'appel en 500 est
//     une erreur ; la collecte partielle des ressources est dite en tête ;
//   - aucun débordement à 390, 768 et 1440 px sur les deux onglets.
//
// Fichier à part, app, compte et pool dédiés (helpers/compte-dedie.ts) : un `afterAll`
// ferme SON pool, jamais celui d'un autre bloc.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const poolF46 = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrlF46 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F46 — Détail de session : cascade et Web Vitals situés", () => {
  const APP_F46 = "f46-e2e-vitaux";
  const EMAIL_F46 = "e2e-f46-vitaux@mip-rum.local";
  const ANCIENNE = "f46e2e-ancienne";
  const RECENTE = "f46e2e-recente";
  const POPULATION = "f46e2e-population";
  const RECENTS = "f46e2e-recents";
  /** `rum_action.action_id` : 32 hexadécimaux (contrainte v67). */
  const ACTION = "f46e2e".padEnd(31, "0") + "b";
  const JOUR = 86_400_000;
  let motDePasse = "";
  let debutAncienne = 0;

  /** « 03/09 » : jour et mois UTC, comme la page. */
  const jj = (ms: number) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(ms));
  /** ISO UTC à la seconde, comme `fenetreDeSession`. */
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

  async function menage() {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_event", "rum_span", "rum_action", "rum_resource", "rum_longtask"])
      await poolF46.query(`delete from ${t} where app_id = $1`, [APP_F46]).catch(() => {});
    await poolF46.query("delete from rum_session where app_id = $1", [APP_F46]);
  }

  async function semer() {
    await poolF46.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Vitaux F46 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F46],
    );
    await menage();
    const t0 = "now() - interval '10 days'";
    const a = (s: number) => `${t0} + interval '${s} seconds'`;

    // La session ANCIENNE : commencée il y a dix jours, deux vues, un LCP et un FCP
    // sur « / », un INP sur « /panier », puis une action et ses effets.
    const { rows } = await poolF46.query<{ debut: Date }>(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', ${t0}, ${a(300)}, 2)
       returning started_at as debut`,
      [ANCIENNE, APP_F46],
    );
    debutAncienne = rows[0].debut.getTime();
    await poolF46.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, nav_type)
       values ('f46e2epv0', $1, $2, '/', ${t0}, 'navigate'),
              ('f46e2epv1', $1, $2, '/panier', ${a(60)}, 'spa')`,
      [ANCIENNE, APP_F46],
    );
    await poolF46.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ('f46e2elcp', $1, $2, '/', 'LCP', 2100, 'good', ${a(1)}),
              ('f46e2efcp', $1, $2, '/', 'FCP', 900, 'good', ${a(1)}),
              ('f46e2einp', $1, $2, '/panier', 'INP', 350, 'needs-improvement', ${a(70)})`,
      [ANCIENNE, APP_F46],
    );
    await poolF46.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
       values ($1, 'f46e2eac000000bb', $2, $3, 'click', 'Payer', '/panier', ${a(90)})`,
      [ACTION, ANCIENNE, APP_F46],
    );
    await poolF46.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, ts, action_id)
       values ('f46e2eapi', 'f46e2etrace', 'front', $1, $2, '/panier', 'https://site.example/api/paiement', 'POST', 500, 180, ${a(91)}, $3)`,
      [ANCIENNE, APP_F46, ACTION],
    );
    await poolF46.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, route, ts, action_id)
       values ('f46e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'f46-e2e-fp', 1, '/panier', ${a(92)}, $3)`,
      [ANCIENNE, APP_F46, ACTION],
    );
    await poolF46.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, ts, action_id)
       values ('f46e2eres', $1, $2, '/panier', 'https://cdn.example/paiement.js', 'script', 450, ${a(91)}, $3)`,
      [ANCIENNE, APP_F46, ACTION],
    );
    await poolF46.query(
      `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, ts)
       values ('f46e2elt', $1, $2, '/panier', 220, ${a(95)})`,
      [ANCIENNE, APP_F46],
    );

    // La POPULATION de « / » : 20 LCP dans la fenêtre de la session ancienne (trois
    // jours avant son début), et 7 LCP RÉCENTS (il y a une heure), hors de cette
    // fenêtre — ceux qu'une fenêtre « 7 derniers jours » aurait comptés à sa place.
    await poolF46.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $3, 'desktop', ${t0} - interval '3 days', ${t0} - interval '3 days' + interval '1 hour', 1),
              ($2, $3, 'desktop', now() - interval '2 hours', now() - interval '1 hour', 1)`,
      [POPULATION, RECENTS, APP_F46],
    );
    await poolF46.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select 'f46e2epop' || g, $1, $2, '/', 'LCP', 1000 + g * 150, null, ${t0} - interval '3 days' + g * interval '1 minute'
         from generate_series(1, 20) g`,
      [POPULATION, APP_F46],
    );
    await poolF46.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select 'f46e2erec' || g, $1, $2, '/', 'LCP', 5000, 'poor', now() - interval '1 hour' - g * interval '1 minute'
         from generate_series(1, 7) g`,
      [RECENTS, APP_F46],
    );

    // Une session RÉCENTE (il y a deux heures) : sa fenêtre s'arrête à maintenant.
    await poolF46.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', now() - interval '2 hours', now() - interval '2 hours' + interval '1 minute', 1)`,
      [RECENTE, APP_F46],
    );
    await poolF46.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, nav_type)
       values ('f46e2epvr', $1, $2, '/', now() - interval '2 hours', 'navigate')`,
      [RECENTE, APP_F46],
    );
    await poolF46.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ('f46e2elcpr', $1, $2, '/', 'LCP', 1800, 'good', now() - interval '2 hours' + interval '2 seconds')`,
      [RECENTE, APP_F46],
    );
  }

  async function connexion(page: Page) {
    await page.goto(`${consoleUrlF46}/login`);
    await page.fill('input[name="email"]', EMAIL_F46);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (sid: string, extra = "") => `${consoleUrlF46}/sessions/${sid}?app=${APP_F46}${extra}`;
  const tuileLcp = (page: Page) =>
    page.getByTestId("vitaux-tuiles").locator('[data-testid="kpi-tile"][aria-label^="LCP · pire vue"]');

  test.beforeAll(async () => {
    motDePasse = await compteDedie(poolF46, EMAIL_F46);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await poolF46.end();
  });

  test("session de dix jours : la population est ancrée sur elle, jamais sur « 7 derniers jours »", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(ANCIENNE, "&tab=vitals"), { waitUntil: "domcontentloaded" });
    const figure = page.locator("#vitaux-lcp");
    const population = figure.getByTestId("vitaux-population");
    await expect(population).toContainText(`du ${jj(debutAncienne - 7 * JOUR)} au ${jj(debutAncienne + JOUR)} (UTC)`);
    await expect(population).toContainText("mesures LCP de /");
    await expect(population).toContainText("cette mesure comprise");
    // Preuve de fin : aucune fenêtre relative à aujourd'hui.
    await expect(figure).not.toContainText("7 derniers jours");
    await expect(page.locator("main")).not.toContainText("7 derniers jours");
    // 20 mesures de la fenêtre + celle de la session ; les 7 récentes n'y sont pas.
    await expect(figure.getByTestId("figure-meta")).toContainText(/21\smesures/);
    await expect(figure.getByTestId("distribution-seuils")).toBeVisible();
    await expect(figure).toContainText("cette vue");
  });

  test("le lien de la tuile porte la même fenêtre : app, route, vital, from, to", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(ANCIENNE, "&tab=vitals"), { waitUntil: "domcontentloaded" });
    const href = await tuileLcp(page).getAttribute("href");
    expect(href).not.toBeNull();
    const lien = new URL(href!, consoleUrlF46);
    expect(lien.pathname).toBe("/pages");
    expect(lien.searchParams.get("app")).toBe(APP_F46);
    expect(lien.searchParams.get("route")).toBe("/");
    expect(lien.searchParams.get("vital")).toBe("LCP");
    expect(lien.searchParams.get("from")).toBe(iso(debutAncienne - 7 * JOUR));
    expect(lien.searchParams.get("to")).toBe(iso(debutAncienne + JOUR));
    // La tuile dit la zone de CETTE mesure, pas le verdict d'une page.
    await expect(tuileLcp(page)).toContainText("pas un p75");
  });

  test("session récente : la fenêtre s'arrête à maintenant, jamais dans le futur", async ({ page }) => {
    await connexion(page);
    const avant = Date.now();
    await page.goto(adresse(RECENTE, "&tab=vitals"), { waitUntil: "domcontentloaded" });
    const href = await tuileLcp(page).getAttribute("href");
    const to = Date.parse(new URL(href!, consoleUrlF46).searchParams.get("to")!);
    expect(to).toBeGreaterThanOrEqual(avant - 60_000);
    expect(to).toBeLessThanOrEqual(Date.now());
  });

  test("une ligne par vue ; une vue sans mesure le montre", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(ANCIENNE, "&tab=vitals"), { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("table-vitals");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(table.locator("thead")).toContainText("LCP");
    await expect(table.locator("thead")).toContainText("INP");
    await expect(table.locator("tbody tr").first()).toContainText("/");
    await expect(table.locator("tbody tr").nth(1)).toContainText("/panier");
  });

  test("onglet Cascade : vues jusqu'à la suivante, appel en 500 en erreur, collecte partielle dite", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(ANCIENNE, "&tab=cascade"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("session-tabs").getByRole("link", { name: /^Cascade/ })).toHaveAttribute("aria-current", "page");
    const cascade = page.locator("#cascade-session");
    await expect(cascade.getByTestId("etat-partiel").first()).toContainText("rattachées à une action seulement");
    // Deux vues, une action, un appel, une erreur, une ressource, une tâche longue.
    await expect(cascade.getByTestId("cascade-element")).toHaveCount(7);
    const vues = cascade.getByTestId("cascade-element").filter({ hasText: "Pages vues" });
    await expect(vues.filter({ hasText: "jusqu'à la vue suivante" })).toHaveCount(1);
    await expect(vues.filter({ hasText: "jusqu'à la dernière observation" })).toHaveCount(1);
    await expect(cascade.locator('[data-testid="cascade-element"][data-ton="erreur"]')).toHaveCount(2);
    await expect(cascade.getByTestId("cascade-element").filter({ hasText: "POST /api/paiement" })).toHaveAttribute("data-ton", "erreur");
    // La vue « / » mène à la même page pour tous les visiteurs, app liée.
    await expect(cascade.getByTestId("cascade-element").first().getByRole("link")).toHaveAttribute(
      "href",
      `/pages?app=${APP_F46}&route=%2F`,
    );
    // Jamais une « durée de vue ».
    await expect(cascade).not.toContainText(/durée de (la )?vue/i);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await connexion(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["&tab=vitals", "&tab=cascade"]) {
        await page.goto(adresse(ANCIENNE, extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("session-tabs")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`${extra} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
