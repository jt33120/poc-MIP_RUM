// E2E — détail de session /sessions/[id] (domaine Usages, règle S8).
//
// F44 — en-tête, résumé, onglets. CE QUE CE SPEC EXISTE POUR PROUVER :
//   - les anciens liens `?tab=replay&at=` et `?tab=timeline` ouvrent le Déroulé,
//     qui porte le rejeu ET la chronologie (liens émis par l'écran Erreurs) ;
//   - aucune identité dans le HTML : ni `user_id_hash`, ni `account_id_hash`, ni
//     l'identifiant de visiteur complet (8 caractères + « … » au plus) ;
//   - la puce Pays porte sa provenance ; l'échantillonnage est dit ;
//   - un onglet dont le compte est inconnu (chronologie tronquée à 500) s'écrit
//     « (—) », jamais « (0) » ; les tuiles disent pourquoi elles se taisent ;
//   - une session React Native : frustration « Non collecté », jamais « 0 » ;
//   - aucun débordement à 390, 768 et 1440 px ; puces repliées « Contexte (9) » à 390.
//
// Données SYNTHÉTIQUES dans une app dédiée ; compte dédié (helpers/compte-dedie.ts).
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F44 — Détail de session : en-tête, résumé, onglets", () => {
  const APP_F44 = "f44-e2e-detail";
  const EMAIL_F44 = "e2e-f44-detail-session@mip-rum.local";
  const RICHE = "f44e2e-riche";
  const LONGUE = "f44e2e-longue";
  const MOBILE = "f44e2e-mobile";
  const VISITEUR_COMPLET = "f44e2e-visiteur-complet-0001";
  /** Empreintes d'identité (64 hexadécimaux, contrainte v66) : ne doivent JAMAIS sortir. */
  const HASH_UTILISATEUR = "f44e".repeat(16);
  const HASH_COMPTE = "acc0".repeat(16);
  let motDePasse = "";
  let debutRiche = 0;

  async function menage() {
    await pool.query("delete from replay_chunk where app_id = $1", [APP_F44]).catch(() => {});
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_event", "rum_span"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F44]).catch(() => {});
    await pool.query("delete from rum_session where app_id = $1", [APP_F44]);
  }

  async function semer() {
    await pool.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Détail F44 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F44],
    );
    await menage();
    const t0 = "now() - interval '2 hours'";
    const a = (s: number) => `${t0} + interval '${s} seconds'`;
    // Session riche : identité aléatoire complète en base (jamais à l'écran en entier),
    // empreintes d'identité, navigateur et système, release, échantillonnée
    // (p = 0,5 + 0,5 × 0,2 = 0,6 car elle porte une erreur).
    const { rows } = await pool.query<{ debut: Date }>(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count, visitor_id,
                                user_id_hash, account_id_hash, browser, browser_version, os, release,
                                geo_country, sample_rate, error_sample_rate, has_error)
       values ($1, $2, 'desktop', ${t0}, ${a(372)}, 2, $3, $4, $5, 'Firefox', '131.0', 'Linux', '1.4.2',
               'FR', 0.5, 0.2, true)
       returning started_at as debut`,
      [RICHE, APP_F44, VISITEUR_COMPLET, HASH_UTILISATEUR, HASH_COMPTE],
    );
    debutRiche = rows[0].debut.getTime();
    for (const [i, [route, s]] of ([["/", 0], ["/paiement", 60]] as [string, number][]).entries()) {
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ($1, $2, $3, $4, ${a(s)})`,
        [`f44e2epv${i}`, RICHE, APP_F44, route],
      );
    }
    await pool.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       values ('f44e2elcp', $1, $2, '/', 'LCP', 2100, 'good', ${a(1)}),
              ('f44e2edns', $1, $2, '/', 'DNS', 12, null, ${a(1)})`,
      [RICHE, APP_F44],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, route, ts)
       values ('f44e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'f44-e2e-fp', 3, '/paiement', ${a(90)})`,
      [RICHE, APP_F44],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('f44e2efr', $1, $2, '/paiement', 'frustration.rage', '{}'::jsonb, ${a(91)})`,
      [RICHE, APP_F44],
    );
    await pool.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, ts)
       values ('f44e2eapi', 'f44e2etrace', 'front', $1, $2, '/paiement', 'https://site.example/api/panier', 'POST', 500, 180, ${a(92)})`,
      [RICHE, APP_F44],
    );
    await pool.query("insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 0, 0, $3)", [
      RICHE,
      APP_F44,
      gzipSync(Buffer.from("[]")),
    ]);

    // Session longue : 510 événements, au-delà de la limite de 500 lignes de la chronologie.
    await pool.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', ${t0}, ${a(600)}, 1)`,
      [LONGUE, APP_F44],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       select 'f44e2elg' || g, $1, $2, '/', 'panier.vu', '{}'::jsonb, ${t0} + g * interval '1 second'
         from generate_series(1, 510) g`,
      [LONGUE, APP_F44],
    );

    // Session React Native : le SDK mobile n'émet pas de signaux de frustration.
    await pool.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count, runtime)
       values ($1, $2, 'mobile', ${t0}, ${a(30)}, 1, 'react_native')`,
      [MOBILE, APP_F44],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values ('f44e2emob', $1, $2, '/accueil', ${t0})`,
      [MOBILE, APP_F44],
    );
  }

  async function login(page: Page) {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', EMAIL_F44);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (sid: string, extra = "") => `${consoleUrl}/sessions/${sid}?app=${APP_F44}${extra}`;
  const onglet = (page: Page, nom: RegExp) => page.getByTestId("session-tabs").getByRole("link", { name: nom });
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("resume-session").locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);

  test.beforeAll(async () => {
    motDePasse = await compteDedie(pool, EMAIL_F44);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await pool.end();
  });

  test("puces de contexte : pays avec provenance, échantillonnage dit, aucune identité dans le HTML", async ({ page }) => {
    await login(page);
    await page.goto(adresse(RICHE), { waitUntil: "domcontentloaded" });
    const puces = page.getByTestId("puces-session");
    await expect(puces.locator('[data-puce="Pays estimé"]')).toContainText("FR");
    await expect(puces.locator('[data-puce="Pays estimé"]')).toContainText("provenance");
    await expect(puces.locator('[data-puce="Navigateur"]')).toContainText("Firefox 131.0");
    await expect(puces.locator('[data-puce="Release à l\'ouverture"]').getByRole("link")).toHaveAttribute(
      "href",
      `/errors?app=${APP_F44}&release=1.4.2`,
    );
    await expect(puces.locator('[data-puce="Visiteur (aléatoire)"]')).toContainText("f44e2e-v…");
    await expect(puces.locator('[data-puce="Échantillonnage"]')).toContainText(/retenue avec probabilité 60,0\s%/);

    const html = await page.content();
    expect(html).not.toContain(HASH_UTILISATEUR);
    expect(html).not.toContain(HASH_COMPTE);
    expect(html).not.toContain("user_id_hash");
    expect(html).not.toContain(VISITEUR_COMPLET);
  });

  test("résumé : cinq tuiles, occurrences sommées, durée observée jamais « temps passé »", async ({ page }) => {
    await login(page);
    await page.goto(adresse(RICHE), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("resume-session").getByTestId("kpi-tile")).toHaveCount(5);
    await expect(tuile(page, "Pages vues").getByTestId("kpi-valeur")).toHaveText("2");
    await expect(tuile(page, "Occurrences d'erreur").getByTestId("kpi-valeur")).toHaveText("3");
    await expect(tuile(page, "Signaux de frustration").getByTestId("kpi-valeur")).toHaveText("1");
    await expect(tuile(page, "Appels API en échec").getByTestId("kpi-valeur")).toHaveText("1");
    const duree = tuile(page, "Durée observée");
    await expect(duree).toContainText("pas du temps actif");
    await expect(duree).not.toContainText("temps passé");
  });

  test("ancien lien ?tab=replay&at= : le Déroulé, rejeu et chronologie ; tab=timeline aussi", async ({ page }) => {
    await login(page);
    const at = debutRiche + 90_000;
    await page.goto(adresse(RICHE, `&tab=replay&at=${at}`), { waitUntil: "domcontentloaded" });
    await expect(onglet(page, /^Déroulé/)).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("replay-player")).toBeAttached();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("reglage-ignore")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("at")).toBe(String(at));

    await page.goto(adresse(RICHE, "&tab=timeline"), { waitUntil: "domcontentloaded" });
    await expect(onglet(page, /^Déroulé/)).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("timeline")).toBeVisible();
  });

  test("onglets comptés ; chronologie tronquée : « (—) », jamais « (0) »", async ({ page }) => {
    await login(page);
    await page.goto(adresse(RICHE), { waitUntil: "domcontentloaded" });
    await expect(onglet(page, /^Erreurs/)).toHaveText(/Erreurs\s\(1\)/);
    await expect(onglet(page, /^Appels API/)).toHaveText(/Appels API\s\(1\)/);
    await expect(onglet(page, /^Web Vitals/)).toHaveText(/Web Vitals\s\(1\)/);

    await page.goto(adresse(LONGUE), { waitUntil: "domcontentloaded" });
    await expect(onglet(page, /^Erreurs/)).toHaveText(/Erreurs\s\(—\)/);
    await expect(onglet(page, /^Erreurs/)).not.toHaveText(/\(0\)/);
    const occurrences = tuile(page, "Occurrences d'erreur");
    await expect(occurrences.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(occurrences).toContainText("chronologie tronquée à 500 événements");
  });

  test("onglets Erreurs, Appels API, Web Vitals, Attributs", async ({ page }) => {
    await login(page);
    await page.goto(adresse(RICHE, "&tab=erreurs"), { waitUntil: "domcontentloaded" });
    const erreurs = page.getByTestId("table-erreurs");
    await expect(erreurs).toContainText("TypeError");
    await expect(erreurs).toContainText("/paiement");
    await expect(erreurs.getByRole("link", { name: "Voir au rejeu" })).toHaveAttribute("href", /at=\d+#evt-\d+$/);

    await page.goto(adresse(RICHE, "&tab=api"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("table-api")).toContainText("POST /api/panier");
    await expect(page.getByTestId("table-api")).toContainText("500");

    await page.goto(adresse(RICHE, "&tab=vitals"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("table-vitals")).toContainText("LCP");
    await expect(page.getByTestId("table-vitals")).not.toContainText("DNS");

    await page.goto(adresse(RICHE, "&tab=attributs"), { waitUntil: "domcontentloaded" });
    const attributs = page.getByTestId("attributs");
    await attributs.locator("summary").click();
    await expect(attributs).toContainText("session_id");
    await expect(attributs).toContainText("sample_rate");
    expect(await page.content()).not.toContain(HASH_UTILISATEUR);
  });

  test("session React Native : frustration « Non collecté », jamais 0", async ({ page }) => {
    await login(page);
    await page.goto(adresse(MOBILE), { waitUntil: "domcontentloaded" });
    const frustration = tuile(page, "Signaux de frustration");
    await expect(frustration.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(frustration).toContainText("Non collecté : le SDK mobile n'émet pas de signaux de frustration");
  });

  test("session inconnue : « Session introuvable »", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/sessions/f44e2e-inexistante?app=${APP_F44}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText("Session introuvable");
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px ; puces repliées à 390", async ({ page }) => {
    await login(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["", "&tab=erreurs", "&tab=api", "&tab=vitals"]) {
        await page.goto(adresse(RICHE, extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("resume-session")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`/sessions/${RICHE}${extra} @ ${largeur} px — ${f}`);
      }
      if (largeur === 390) await expect(page.getByTestId("puces-session-mobile")).toContainText("Contexte (9)");
    }
    expect(fautes).toEqual([]);
  });
});
