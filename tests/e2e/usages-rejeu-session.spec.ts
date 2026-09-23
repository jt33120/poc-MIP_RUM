// E2E — rejeu synchronisé du détail de session (F47, domaine Usages, règle S8).
//
// CE QUE CE SPEC EXISTE POUR PROUVER :
//   - le FOCUS d'une ligne de la chronologie déplace la tête du lecteur (état
//     `positioned`, source `ligne`) et la ligne devient `aria-current="time"` ;
//   - un clic sur un repère de la barre place la tête ; le lien d'instant d'une ligne
//     place la tête SANS recharger et garde `?at=` dans l'adresse ;
//   - `?tab=replay&at=<erreur>` : « Replay positionné à l'instant de l'erreur » ;
//   - l'en-tête de couverture est écrit (2 minutes, 1 Mo, masquage par défaut) ; un
//     segment illisible est DIT (B36) ; vitesses 1× / 2× / 4× et saut d'inactivité ;
//   - une lecture en échec propose « Réessayer », qui relit ;
//   - 390 px : le rejeu ne se charge pas sans geste (aucune requête /api/replay) ;
//     « Lancer le rejeu » le charge ;
//   - aucun débordement à 390, 768 et 1440 px.
//
// Fichier à part, app, compte et pool dédiés (helpers/compte-dedie.ts).
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const poolF47 = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrlF47 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F47 — Détail de session : rejeu synchronisé", () => {
  const APP_F47 = "f47-e2e-rejeu";
  const EMAIL_F47 = "e2e-f47-rejeu@mip-rum.local";
  const SESSION = "f47e2e-rejeu";
  /** `rum_action.action_id` : 32 hexadécimaux (contrainte v67). */
  const ACTION = "f47e2e".padEnd(31, "0") + "c";
  /** Début de la session et de l'enregistrement, à la seconde (epoch ms). */
  const T = Math.floor((Date.now() - 3_600_000) / 1000) * 1000;
  const ERREUR = T + 42_000;
  let motDePasse = "";

  async function menage() {
    await poolF47.query("delete from replay_chunk where app_id = $1", [APP_F47]).catch(() => {});
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_event", "rum_span", "rum_action"])
      await poolF47.query(`delete from ${t} where app_id = $1`, [APP_F47]).catch(() => {});
    await poolF47.query("delete from rum_session where app_id = $1", [APP_F47]);
  }

  async function semer() {
    await poolF47.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Rejeu F47 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F47],
    );
    await menage();
    const a = (ms: number) => `to_timestamp(${ms}::double precision / 1000)`;
    await poolF47.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', ${a(T)}, ${a(T + 90_000)}, 2)`,
      [SESSION, APP_F47],
    );
    await poolF47.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, nav_type)
       values ('f47e2epv0', $1, $2, '/', ${a(T)}, 'navigate'),
              ('f47e2epv1', $1, $2, '/panier', ${a(T + 30_000)}, 'spa')`,
      [SESSION, APP_F47],
    );
    await poolF47.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
       values ($1, 'f47e2eac000000cc', $2, $3, 'click', 'Payer', '/panier', ${a(T + 40_000)})`,
      [ACTION, SESSION, APP_F47],
    );
    await poolF47.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, ts, action_id)
       values ('f47e2eapi', 'f47e2etrace', 'front', $1, $2, '/panier', 'https://site.example/api/paiement', 'POST', 500, 180, ${a(T + 41_000)}, $3)`,
      [SESSION, APP_F47, ACTION],
    );
    await poolF47.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, route, ts, action_id)
       values ('f47e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'f47-e2e-fp', 1, '/panier', ${a(ERREUR)}, $3)`,
      [SESSION, APP_F47, ACTION],
    );
    await poolF47.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('f47e2efr', $1, $2, '/panier', 'frustration.rage', '{}'::jsonb, ${a(T + 43_000)})`,
      [SESSION, APP_F47],
    );

    // Enregistrement rrweb de T à T + 90 s : un vrai document (le Replayer le
    // reconstruit), puis des mouvements de souris qui étendent la durée.
    const evenements = [
      { type: 4, data: { href: "https://f47.example/", width: 1024, height: 640 }, timestamp: T },
      {
        type: 2,
        data: {
          node: {
            type: 0, id: 1, childNodes: [
              { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
              {
                type: 2, id: 3, tagName: "html", attributes: {}, childNodes: [
                  { type: 2, id: 4, tagName: "head", attributes: {}, childNodes: [] },
                  {
                    type: 2, id: 5, tagName: "body", attributes: {}, childNodes: [
                      { type: 2, id: 6, tagName: "h1", attributes: {}, childNodes: [{ type: 3, id: 7, textContent: "Panier" }] },
                    ],
                  },
                ],
              },
            ],
          },
          initialOffset: { left: 0, top: 0 },
        },
        timestamp: T,
      },
      { type: 3, data: { source: 1, positions: [{ x: 40, y: 60, id: 5, timeOffset: 0 }] }, timestamp: T + 10_000 },
      { type: 3, data: { source: 1, positions: [{ x: 80, y: 90, id: 5, timeOffset: 0 }] }, timestamp: T + 45_000 },
      { type: 3, data: { source: 1, positions: [{ x: 90, y: 95, id: 5, timeOffset: 0 }] }, timestamp: T + 90_000 },
    ];
    await poolF47.query(
      "insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 0, $3, $4)",
      [SESSION, APP_F47, evenements.length, gzipSync(JSON.stringify(evenements))],
    );
    // Un segment ILLISIBLE (B36) : ignoré, et dit.
    await poolF47.query("insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 1, 0, $3)", [
      SESSION,
      APP_F47,
      Buffer.from("pas du gzip"),
    ]);
  }

  async function connexion(page: Page) {
    await page.goto(`${consoleUrlF47}/login`);
    await page.fill('input[name="email"]', EMAIL_F47);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (extra = "") => `${consoleUrlF47}/sessions/${SESSION}?app=${APP_F47}${extra}`;
  const lecteurPret = (page: Page) =>
    expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const ligneErreur = (page: Page) => page.locator("#chronologie li[data-ligne]").filter({ hasText: "TypeError" });

  test.beforeAll(async () => {
    motDePasse = await compteDedie(poolF47, EMAIL_F47);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await poolF47.end();
  });

  test("lecteur : couverture écrite, segment illisible dit, repères, vitesses, saut d'inactivité", async ({ page }) => {
    await connexion(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await lecteurPret(page);
    const lecteur = page.getByTestId("replay-player");
    const couverture = lecteur.getByTestId("replay-couverture");
    await expect(couverture).toContainText("2 premières minutes");
    await expect(couverture).toContainText("1 Mo compressé");
    await expect(couverture).toContainText("une application peut les démasquer");
    await expect(lecteur.getByTestId("etat-partiel")).toContainText("1 segment illisible ignoré");
    await expect(lecteur).toHaveAttribute("data-ignores", "1");
    // Deux vues, une action, une erreur, un signal de frustration : tous dans l'enregistrement.
    await expect(lecteur.getByTestId("replay-repere")).toHaveCount(5);
    await expect(lecteur.locator('[data-testid="replay-repere"][data-ton="erreur"]')).toHaveCount(1);

    const vitesses = lecteur.getByTestId("replay-vitesses");
    await expect(vitesses.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
    await vitesses.getByRole("button", { name: "2×" }).click();
    await expect(vitesses.getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "true");
    await expect(vitesses.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "false");
    await lecteur.getByTestId("replay-saut").click();
    await expect(lecteur.getByTestId("replay-saut")).toHaveAttribute("aria-pressed", "true");
    await expect(lecteur.getByRole("button", { name: "Lecture" })).toBeVisible();
    await expect(lecteur.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("le focus d'une ligne déplace la tête ; la ligne devient la ligne courante", async ({ page }) => {
    await connexion(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await lecteurPret(page);
    await ligneErreur(page).locator("a[data-instant]").focus();
    const position = page.getByTestId("replay-offset");
    await expect(position).toHaveAttribute("data-offset-state", "positioned");
    await expect(position).toHaveAttribute("data-offset-source", "ligne");
    await expect(position).toContainText("Replay positionné sur la ligne choisie");
    await expect(ligneErreur(page)).toHaveAttribute("aria-current", "time");
  });

  test("un repère place la tête ; le lien d'instant la place sans recharger et garde `?at=`", async ({ page }) => {
    await connexion(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await lecteurPret(page);
    await page.locator('[data-testid="replay-repere"][data-ton="erreur"]').click();
    await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-source", "marqueur");

    // Le lien d'instant : la tête bouge, l'adresse garde `?at=`, et AUCUNE navigation
    // n'est demandée au serveur (une navigation Next enverrait une requête `RSC: 1`).
    const navigations: string[] = [];
    page.on("request", (r) => {
      const entetes = r.headers();
      if (entetes["rsc"] === "1" && !entetes["next-router-prefetch"]) navigations.push(r.url());
    });
    await ligneErreur(page).locator("a[data-instant]").click();
    await expect(page).toHaveURL(new RegExp(`at=${ERREUR}`));
    await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-source", "ligne");
    await page.waitForTimeout(500);
    expect(navigations).toEqual([]);
    await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-source", "ligne");
    await expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "ready");
  });

  test("?tab=replay&at=<erreur> : « Replay positionné à l'instant de l'erreur »", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(`&tab=replay&at=${ERREUR}`), { waitUntil: "domcontentloaded" });
    await lecteurPret(page);
    await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-state", "positioned");
    await expect(page.getByText("Replay positionné à l'instant de l'erreur")).toBeVisible();
  });

  test("lecture en échec : « Réessayer » relit les segments", async ({ page }) => {
    await connexion(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/replay/**", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    await page.unroute("**/api/replay/**");
    await page.getByTestId("replay-erreur").getByRole("button", { name: "Réessayer" }).click();
    await lecteurPret(page);
  });

  test("390 px : rejeu non chargé sans geste ; « Lancer le rejeu » le charge", async ({ page }) => {
    await connexion(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const demandes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/replay/")) demandes.push(r.url());
    });
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    // L'îlot a décidé (hydratation faite) : attendre un geste, sans rien charger.
    const attente = page.getByTestId("replay-attente");
    await expect(attente).toHaveAttribute("data-attente", "geste");
    const lancer = attente.getByRole("button", { name: "Lancer le rejeu" });
    await expect(lancer).toBeVisible();
    await expect(page.getByTestId("replay-player")).toHaveCount(0);
    expect(demandes).toEqual([]);
    await lancer.click();
    await lecteurPret(page);
    expect(demandes).toHaveLength(1);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await connexion(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      // `tab=replay` : le lecteur est chargé à toutes les largeurs (lien suivi = geste).
      await page.goto(adresse("&tab=replay"), { waitUntil: "domcontentloaded" });
      await lecteurPret(page);
      for (const f of await debordements(page)) fautes.push(`rejeu @ ${largeur} px — ${f}`);
    }
    expect(fautes).toEqual([]);
  });
});
