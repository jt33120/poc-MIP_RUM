// E2E — écran /sessions (domaine Usages, règle S8).
//
// F41 — KPI, volume, répartition. CE QUE CE SPEC EXISTE POUR PROUVER :
//   - la rangée de cinq tuiles, une population chacune : « Sessions commencées » au
//     nombre semé, visiteurs « identifiant aléatoire », et « Sessions avec
//     frustration » SANS nombre tant que sa lecture (B30) manque ;
//   - un clic sur un seau du volume resserre l'écran sur sa plage (`from`/`to`,
//     plus de `period`) ;
//   - le groupe « Inconnu » de « Qui sont ces sessions » filtre par `is_null` ;
//   - `cmp=prev` sur une app sans historique : la tuile se tait et dit pourquoi ;
//   - plus d'`ObservedTrend` : le volume est deux graphiques sur grille ;
//   - aucun débordement à 390, 768 et 1440 px, et KPI + hero au-dessus du pli.
//
// Données SYNTHÉTIQUES dans une app dédiée ; compte dédié (helpers/compte-dedie.ts).
// F42 et F43 ajouteront leurs blocs `test.describe` à ce fichier.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";
// F42 : un segment de rejeu semé est gzippé, comme ceux que l'ingestion écrit.
import { gzipSync } from "node:zlib";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F41 — Sessions : KPI, volume, répartition", () => {
  const APP_F41 = "f41-e2e-sessions";
  const EMAIL_F41 = "e2e-f41-sessions@mip-rum.local";
  let motDePasse = "";

  /** Six sessions sur les dernières heures : navigateurs connus et inconnus, un capteur extension, deux sans identifiant. */
  const SESSIONS = [
    { id: "f41e2e-s0", heures: 1, navigateur: "Firefox", visiteur: "f41e2e-v0", capteur: "sdk" },
    { id: "f41e2e-s1", heures: 3, navigateur: "Firefox", visiteur: "f41e2e-v1", capteur: "sdk" },
    { id: "f41e2e-s2", heures: 5, navigateur: "Chrome", visiteur: "f41e2e-v1", capteur: "extension" },
    { id: "f41e2e-s3", heures: 7, navigateur: null, visiteur: null, capteur: "sdk" },
    { id: "f41e2e-s4", heures: 9, navigateur: null, visiteur: "f41e2e-v4", capteur: "sdk" },
    { id: "f41e2e-s5", heures: 11, navigateur: "Chrome", visiteur: null, capteur: "sdk" },
  ];

  async function menage() {
    for (const t of ["rum_error", "rum_pageview", "rum_event"])
      await pool.query(`delete from ${t} where app_id = $1`, [APP_F41]).catch(() => {});
    await pool.query("delete from rum_session where app_id = $1", [APP_F41]);
  }

  async function semer() {
    await pool.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Sessions F41 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F41],
    );
    await menage();
    for (const s of SESSIONS) {
      await pool.query(
        `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count,
                                  visitor_id, browser, collection_source)
         values ($1, $2, 'desktop', now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '4 minutes',
                 1, $4, $5, $6)`,
        [s.id, APP_F41, s.heures, s.visiteur, s.navigateur, s.capteur],
      );
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
         values ($1, $2, $3, '/', now() - make_interval(hours => $4))`,
        [`${s.id}-pv`, s.id, APP_F41, s.heures],
      );
    }
    // Trois occurrences sur une ligne (V1 : sommées), une erreur sans session (exclue, dite).
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
       values ('f41e2e-err0', 'f41e2e-s0', $1, 'error', 'boom', 'TypeError', 'f41e2e-fp', 3, now() - interval '50 minutes'),
              ('f41e2e-err1', null, $1, 'error', 'serveur', 'Error', 'f41e2e-fp2', 2, now() - interval '40 minutes')`,
      [APP_F41],
    );
  }

  async function login(page: Page) {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', EMAIL_F41);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (extra = "") => `${consoleUrl}/sessions?app=${APP_F41}&period=24h${extra}`;
  /**
   * Une tuile par le DÉBUT de son libellé annoncé (`aria-label` = « <libellé> <valeur>, … ») :
   * « sessions commencées » figure aussi dans l'effectif d'une autre tuile.
   */
  const tuile = (page: Page, libelle: string) =>
    page.getByTestId("kpi-sessions").locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);

  test.beforeAll(async () => {
    motDePasse = await compteDedie(pool, EMAIL_F41);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await pool.end();
  });

  test("rangée de KPI : cinq tuiles, une population chacune, B30 sans nombre", async ({ page }) => {
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toHaveText(/Sessions/);
    await expect(page.getByTestId("kpi-sessions").getByTestId("kpi-tile")).toHaveCount(5);

    await expect(tuile(page, "Sessions commencées").getByTestId("kpi-valeur")).toHaveText("6");
    await expect(tuile(page, "Visiteurs distincts (identifiant aléatoire)")).toBeVisible();
    // s1 et s2 partagent un visiteur ; s3 et s5 n'en ont pas : 3 visiteurs distincts.
    await expect(tuile(page, "Visiteurs distincts (identifiant aléatoire)").getByTestId("kpi-valeur")).toHaveText("3");
    await expect(tuile(page, "Sessions sans identifiant").getByTestId("kpi-valeur")).toHaveText("2");
    // 3 occurrences sur 6 sessions commencées ; l'erreur sans session est exclue, et dite.
    const taux = tuile(page, "Occurrences d'erreur par session commencée");
    await expect(taux.getByTestId("kpi-valeur")).toHaveText("0,50");
    await expect(taux).toContainText("2 occurrences sans session rattachée, exclues");
    // Sans lecture (B30), aucun nombre : ni « 0 % », ni « Non collecté ».
    const frustration = tuile(page, "Sessions avec frustration");
    await expect(frustration.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(frustration).toContainText("lecture à créer (B30)");
    await expect(frustration).not.toContainText("%");

    // Le hero dit ce qui lui manque, et rien d'autre.
    await expect(page.locator("#a-regarder-d-abord")).toContainText("classement indisponible : lecture à créer (B30)");
  });

  test("volume : deux graphiques sur grille, plus d'ObservedTrend ; un clic sur un seau zoome", async ({ page }) => {
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("visiteurs-observes")).toHaveCount(0);
    const volume = page.getByTestId("volume-panneaux");
    // `.recharts-wrapper` : une par graphique (`.recharts-surface` compte aussi les icônes de légende).
    await expect(volume.locator(".recharts-wrapper")).toHaveCount(2, { timeout: 15_000 });

    const surface = volume.locator(".recharts-wrapper .recharts-surface").first();
    await surface.scrollIntoViewIfNeeded();
    const boite = await surface.boundingBox();
    if (!boite) throw new Error("graphique sans boîte");
    await page.mouse.move(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.mouse.click(boite.x + boite.width * 0.6, boite.y + boite.height * 0.5);
    await page.waitForURL((u) => u.searchParams.has("from") && u.searchParams.has("to"), { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.pathname).toBe("/sessions");
    expect(u.searchParams.get("app")).toBe(APP_F41);
    expect(u.searchParams.has("period")).toBe(false);
    // L'écran d'arrivée accepte la plage : pas de refus du contrat.
    await expect(page.getByTestId("kpi-sessions")).toBeVisible();
  });

  test("« Qui sont ces sessions » : le groupe « Inconnu » filtre par is_null", async ({ page }) => {
    await login(page);
    await page.goto(adresse("&split=browser"), { waitUntil: "domcontentloaded" });
    const repartition = page.getByTestId("repartition");
    await expect(repartition.getByTestId("breakdown-tab-browser")).toHaveAttribute("aria-current", "page");
    const inconnu = repartition.getByTestId("breakdown-row").filter({ hasText: "Inconnu" });
    await expect(inconnu).toHaveCount(1);
    await expect(inconnu).toContainText("33,3");
    await inconnu.click();
    await page.waitForURL((v) => v.searchParams.get("seg") === "v2:browser:is_null", { timeout: 15_000 });
    // La population filtrée : les deux sessions sans navigateur.
    await expect(tuile(page, "Sessions commencées").getByTestId("kpi-valeur")).toHaveText("2");
  });

  test("cmp=prev sans historique : aucun écart, la raison est écrite", async ({ page }) => {
    await login(page);
    await page.goto(adresse("&cmp=prev"), { waitUntil: "domcontentloaded" });
    await expect(tuile(page, "Sessions commencées")).toContainText("période précédente incomplète");
    await expect(page.getByTestId("volume-reference-absente")).toContainText("période précédente non tracée");
  });

  test("KPI et hero au-dessus du pli à 1440 × 900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    const hero = page.locator("#a-regarder-d-abord");
    await expect(hero).toBeVisible();
    const boite = await hero.boundingBox();
    if (!boite) throw new Error("hero sans boîte");
    expect(boite.y).toBeLessThan(900);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["", "&split=source", "&cmp=prev"]) {
        await page.goto(adresse(extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kpi-sessions")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`/sessions${extra} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F42 — priorité et table. CE QUE CE BLOC EXISTE POUR PROUVER :
//   - la table dense « Toutes les sessions » : 50 lignes au plus, « Sessions
//     suivantes » quand il en reste, AUCUN identifiant de visiteur dans le HTML ;
//   - à 390 px, des cartes de trois lignes et PAS de table ;
//   - les filtres rapides : `avec=erreurs` ne change pas la tuile « Sessions
//     commencées », et l'URL qui le porte est déclarée NON APPLIQUÉE (V10) ;
//   - le hero, AVEC ET SANS B30 : sans lecture, l'état `partiel` et sa raison, et
//     aucune ligne dessinée ; avec, la session à erreurs en tête, sa raison écrite
//     et ▶ vers `?tab=replay&at=`. Le test lit l'état rendu et vérifie le monde qui
//     va avec : il reste vert le jour où B30 est livré, sans être réécrit.
//
// Pool PROPRE au bloc : `pool.end()` de F41 ferme le sien à la fin de ses tests.
test.describe("F42 — Sessions : priorité et table", () => {
  const APP_F42 = "f42-e2e-sessions";
  const EMAIL_F42 = "e2e-f42-sessions@mip-rum.local";
  /** Identifiant de visiteur : il ne doit apparaître NULLE PART dans la page. */
  const VISITEUR_F42 = "f42e2evisiteursecret";
  const SESSION_ERREUR = "f42e2e-s000";
  /** 52 sessions : une page pleine (50), sa suivante, et la preuve que la 51e ne s'affiche pas. */
  const SEMEES = 52;

  const poolF42 = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
  });
  let motDePasseF42 = "";

  async function menageF42() {
    for (const t of ["replay_chunk", "rum_error", "rum_event", "rum_pageview"])
      await poolF42.query(`delete from ${t} where app_id = $1`, [APP_F42]).catch(() => {});
    await poolF42.query("delete from rum_session where app_id = $1", [APP_F42]);
  }

  async function semerF42() {
    await poolF42.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Sessions F42 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F42],
    );
    await menageF42();
    // Une instruction par table (`generate_series`), jamais ligne à ligne.
    await poolF42.query(
      `insert into rum_session (session_id, app_id, device_type, geo_country, geo_source, browser, os,
                                visitor_id, started_at, last_seen_at, page_count, collection_source)
       select 'f42e2e-s' || lpad(i::text, 3, '0'), $1, 'desktop', 'FR', 'ip', 'Chrome', 'Windows',
              $2, now() - make_interval(mins => i + 1), now() - make_interval(mins => i),
              2, case when i = 1 then 'extension' else 'sdk' end
         from generate_series(0, $3::int - 1) as i`,
      [APP_F42, VISITEUR_F42, SEMEES],
    );
    await poolF42.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at)
       select 'f42e2e-pv' || lpad(i::text, 3, '0') || '-' || k, 'f42e2e-s' || lpad(i::text, 3, '0'), $1,
              case k when 0 then '/' else '/panier' end, now() - make_interval(mins => i + 1)
         from generate_series(0, $2::int - 1) as i, generate_series(0, 1) as k`,
      [APP_F42, SEMEES],
    );
    // La session la plus récente porte 3 occurrences de TypeError, un signal de
    // frustration et un segment de rejeu : de quoi être première au classement.
    await poolF42.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, ts)
       values ('f42e2e-err0', $2, $1, 'error', 'boom', 'TypeError', 'f42e2e-fp', 3, now() - interval '30 seconds')`,
      [APP_F42, SESSION_ERREUR],
    );
    await poolF42.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('f42e2e-ev0', $2, $1, '/panier', 'frustration.rage', '{"target":"Payer"}'::jsonb, now() - interval '25 seconds')`,
      [APP_F42, SESSION_ERREUR],
    );
    await poolF42.query(
      "insert into replay_chunk (session_id, app_id, seq, events_count, body) values ($1, $2, 0, 0, $3)",
      [SESSION_ERREUR, APP_F42, gzipSync(Buffer.from("[]"))],
    );
  }

  async function loginF42(page: Page) {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', EMAIL_F42);
    await page.fill('input[name="password"]', motDePasseF42);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresseF42 = (extra = "") => `${consoleUrl}/sessions?app=${APP_F42}&period=24h${extra}`;
  const tuileF42 = (page: Page, libelle: string) =>
    page.getByTestId("kpi-sessions").locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);

  test.beforeAll(async () => {
    motDePasseF42 = await compteDedie(poolF42, EMAIL_F42);
    await semerF42();
  });

  test.afterAll(async () => {
    await menageF42();
    await poolF42.end();
  });

  test("table dense : 50 lignes au plus, « Sessions suivantes », aucun identifiant de visiteur", async ({ page }) => {
    await loginF42(page);
    await page.goto(adresseF42(), { waitUntil: "domcontentloaded" });
    const table = page.getByTestId("sessions-table");
    await expect(table).toBeVisible();
    // 52 sessions semées : la page en montre 50, jamais la 51e.
    await expect(page.getByTestId("ligne-session")).toHaveCount(50);
    await expect(page.getByTestId("sessions-suivantes")).toBeVisible();
    // Aucune colonne ne montre un `visitor_id` (V9) — ni ailleurs dans la page.
    expect(await page.content()).not.toContain(VISITEUR_F42);
    for (const c of ["Dernière activité (UTC)", "Durée observée", "Pays estimé", "Capteur", "Occurrences d'erreur", "Frustration", "Rejeu"]) {
      await expect(table.locator("thead")).toContainText(c);
    }
    // La page suivante reprend après le curseur : d'autres sessions, pas les mêmes.
    const premier = await page.getByTestId("ligne-session").first().textContent();
    await page.getByTestId("sessions-suivantes").click();
    await page.waitForURL((u) => u.searchParams.has("cursor"), { timeout: 15_000 });
    await expect(page.getByTestId("ligne-session").first()).not.toHaveText(premier ?? "");
  });

  test("390 px : des cartes de trois lignes, pas de table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginF42(page);
    await page.goto(adresseF42(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sessions-cartes")).toBeVisible();
    await expect(page.getByTestId("sessions-table")).toBeHidden();
    await expect(page.getByTestId("carte-session").first()).toBeVisible();
  });

  test("filtres rapides : `avec=erreurs` ne change pas les KPI et se déclare non appliqué", async ({ page }) => {
    await loginF42(page);
    await page.goto(adresseF42(), { waitUntil: "domcontentloaded" });
    const sansFiltre = await tuileF42(page, "Sessions commencées").getByTestId("kpi-valeur").textContent();
    expect(sansFiltre).toBe(String(SEMEES));
    const chips = page.getByTestId("filtres-rapides");
    for (const cle of ["erreurs", "frustration", "rejeu"]) {
      await expect(chips.getByTestId(`filtre-${cle}`)).toBeVisible();
    }

    await page.goto(adresseF42("&avec=erreurs"), { waitUntil: "domcontentloaded" });
    // La règle du plan : ce filtre ne touche QUE la liste, jamais les tuiles.
    await expect(tuileF42(page, "Sessions commencées").getByTestId("kpi-valeur")).toHaveText(sansFiltre ?? "");
    const applique = await chips.getByTestId("filtre-erreurs").getAttribute("data-applied");
    if (applique === "true") {
      // B30 livré : la liste se restreint à la seule session à erreurs, les tuiles non.
      await expect(page.getByTestId("ligne-session")).toHaveCount(1);
    } else {
      // B30 absent : la bascule dit pourquoi, et l'URL est déclarée non appliquée.
      await expect(page.getByTestId("avec-non-applique")).toContainText("NON APPLIQUÉ");
      await expect(page.getByTestId("ligne-session")).toHaveCount(50);
    }
  });

  test("hero « À regarder d'abord » : classé avec B30, motivé sans lui", async ({ page }) => {
    await loginF42(page);
    await page.goto(adresseF42(), { waitUntil: "domcontentloaded" });
    const hero = page.locator("#a-regarder-d-abord");
    await expect(hero).toBeVisible();
    if ((await hero.getAttribute("data-etat")) === "partiel") {
      // Sans lecture : la raison, et AUCUNE ligne — pas de faux classement.
      await expect(hero).toContainText("classement indisponible : lecture à créer (B30)");
      await expect(hero.getByTestId("priorite-ligne")).toHaveCount(0);
      await expect(hero.getByTestId("rejeu-lien")).toHaveCount(0);
    } else {
      // Avec lecture : la session à erreurs est première, sa raison est écrite,
      // et ▶ ouvre le rejeu calé sur la première erreur.
      const premiere = hero.getByTestId("priorite-ligne").first();
      await expect(premiere.getByTestId("priorite-session")).toContainText(SESSION_ERREUR.slice(0, 8));
      await expect(premiere.getByTestId("priorite-raison")).toContainText("TypeError");
      const rejeu = premiere.getByTestId("rejeu-lien");
      await expect(rejeu).toBeVisible();
      await rejeu.click();
      await page.waitForURL((u) => u.pathname.startsWith("/sessions/") && u.searchParams.get("tab") === "replay", {
        timeout: 15_000,
      });
      expect(new URL(page.url()).searchParams.has("at")).toBe(true);
    }
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await loginF42(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["", "&avec=erreurs"]) {
        await page.goto(adresseF42(extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("kpi-sessions")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`/sessions${extra} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
