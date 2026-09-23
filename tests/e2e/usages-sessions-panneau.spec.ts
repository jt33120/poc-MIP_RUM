// E2E — panneau de session de l'écran /sessions (F43, domaine Usages, règle S8).
//
// CE QUE CE SPEC EXISTE POUR PROUVER (plan § 5.11.4, § 3.5, ligne F43 du § 6.4) :
//   - clavier : une ligne de la liste ouvre `panel=session:<id>`, le focus va au
//     titre ; ↓ / ↑ parcourent la PAGE DE LISTE affichée (bouts éteints) ; Échap
//     ferme et rend l'URL sans `panel`, plage gardée ;
//   - contenu : puces avec la provenance du pays, quatre tuiles, mini-cascade en
//     hauteur réduite, premiers événements groupés par vue ;
//   - garde capteur R-F : une session React Native dit « Non collecté », jamais
//     « 0 » ; une session navigateur sans signal montre son vrai zéro ;
//   - périmètre : la session d'une app que l'écran ne lit pas n'ouvre AUCUN panneau
//     — une ligne le dit, rien de la session n'est rendu (témoin : lue à bon droit,
//     elle s'ouvre) ; un viewer restreint ne l'ouvre jamais, même en `app=all` ;
//   - largeurs : plein écran à 390 px (« Fermer » en tête), moitié de la zone de
//     contenu à 1440 px avec la liste lisible à gauche ; aucun débordement à 390,
//     768 et 1440 px panneau ouvert ;
//   - sans JavaScript : le panneau est dans le HTML, ses liens suffisent.
//
// Fichier À PART de `usages-sessions.spec.ts` (F41, F42) : le `afterAll` du bloc F41
// y ferme le pool partagé du fichier — même raison que F45. Ce bloc a ses apps, ses
// comptes (un admin DÉDIÉ, un viewer restreint) et son pool. Données SYNTHÉTIQUES.
import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const poolF43 = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrlF43 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F43 — Sessions : panneau", () => {
  const APP_F43 = "f43-e2e-panneau";
  const APP_F43_AUTRE = "f43-e2e-autre";
  const APPS_F43 = [APP_F43, APP_F43_AUTRE];
  const EMAIL_F43 = "e2e-f43-panneau@mip-rum.local";
  const VIEWER_F43 = "e2e-f43-viewer@mip-rum.local";
  const MDP_VIEWER_F43 = "e2e-f43-viewer-mdp-local";
  // Huit premiers caractères DISTINCTS : c'est ce que le titre et la liste affichent.
  const PREMIERE = "f43e2e00-premiere"; // navigateur : erreur, appel en échec, signal de rage
  const SECONDE = "f43e2e01-seconde"; // navigateur, aucun signal
  const MOBILE = "f43e2e02-mobile"; // React Native
  const AUTRE = "f43e2e99-autre"; // autre app
  const MARQUEUR_AUTRE = "/f43-autre-marqueur";
  /** `rum_action.action_id` : 32 hexadécimaux (contrainte v67). */
  const ACTION_F43 = "f43e2e".padEnd(31, "0") + "a";
  let motDePasseF43 = "";

  function bcryptF43(motDePasse: string): string {
    return execFileSync(
      "node",
      [
        "-e",
        `const { createRequire } = require("node:module");
         const req = createRequire(process.cwd() + "/apps/console/package.json");
         const m = req("bcryptjs");
         const bcrypt = m.hashSync ? m : m.default;
         process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
        motDePasse,
      ],
      { encoding: "utf8" },
    );
  }

  async function menageF43() {
    for (const t of ["rum_error", "rum_event", "rum_span", "rum_action", "rum_metric", "rum_pageview"])
      await poolF43.query(`delete from ${t} where app_id = any($1::text[])`, [APPS_F43]).catch(() => {});
    await poolF43.query("delete from rum_session where app_id = any($1::text[])", [APPS_F43]);
  }

  async function semerF43() {
    for (const app of APPS_F43) {
      await poolF43.query(
        "insert into app_registry (app_id, name, active) values ($1, $1, true) on conflict (app_id) do update set active = true",
        [app],
      );
    }
    await menageF43();
    // Ordre de la liste : dernière activité décroissante — PREMIERE, SECONDE, MOBILE.
    await poolF43.query(
      `insert into rum_session (session_id, app_id, device_type, geo_country, geo_source, browser, os, release,
                                started_at, last_seen_at, page_count, collection_source, runtime)
       values ($1, $5, 'desktop', 'FR', 'timezone', 'Chrome', 'Windows', '2.0.0',
               now() - interval '12 minutes', now() - interval '1 minute', 2, 'sdk', 'browser'),
              ($2, $5, 'desktop', 'FR', 'timezone', 'Firefox', 'Linux', '2.0.0',
               now() - interval '20 minutes', now() - interval '2 minutes', 1, 'sdk', 'browser'),
              ($3, $5, 'mobile', null, null, null, 'iOS', '2.0.0',
               now() - interval '30 minutes', now() - interval '3 minutes', 1, 'sdk', 'react_native'),
              ($4, $6, 'desktop', 'FR', 'timezone', 'Chrome', 'Windows', '9.9.9',
               now() - interval '10 minutes', now() - interval '5 minutes', 1, 'sdk', 'browser')`,
      [PREMIERE, SECONDE, MOBILE, AUTRE, APP_F43, APP_F43_AUTRE],
    );
    await poolF43.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, nav_type)
       values ('f43e2epv0', $1, $5, '/', now() - interval '12 minutes', 'navigate'),
              ('f43e2epv1', $1, $5, '/panier', now() - interval '6 minutes', 'route-change'),
              ('f43e2epv2', $2, $5, '/', now() - interval '20 minutes', 'navigate'),
              ('f43e2epv3', $3, $5, '/accueil', now() - interval '30 minutes', 'navigate'),
              ('f43e2epv9', $4, $6, $7, now() - interval '10 minutes', 'navigate')`,
      [PREMIERE, SECONDE, MOBILE, AUTRE, APP_F43, APP_F43_AUTRE, MARQUEUR_AUTRE],
    );
    // PREMIERE : une action « Payer » et ses effets — un appel en 500, une erreur à
    // trois occurrences —, puis un clic de rage. De quoi peupler quatre pistes.
    const t = "now() - interval '5 minutes'";
    await poolF43.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
       values ($1, 'f43e2eac000000aa', $2, $3, 'click', 'Payer', '/panier', ${t})`,
      [ACTION_F43, PREMIERE, APP_F43],
    );
    await poolF43.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, ts, action_id)
       values ('f43e2eapi', 'f43e2etrace', 'front', $1, $2, '/panier', 'https://site.example/api/paiement', 'POST', 500, 180,
               ${t} + interval '1 second', $3)`,
      [PREMIERE, APP_F43, ACTION_F43],
    );
    await poolF43.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, route, ts, action_id)
       values ('f43e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'f43-e2e-fp', 3, '/panier',
               ${t} + interval '2 seconds', $3)`,
      [PREMIERE, APP_F43, ACTION_F43],
    );
    await poolF43.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('f43e2efr', $1, $2, '/panier', 'frustration.rage', '{}'::jsonb, ${t} + interval '3 seconds')`,
      [PREMIERE, APP_F43],
    );
  }

  async function connexionF43(page: Page, email: string, motDePasse: string) {
    await page.goto(`${consoleUrlF43}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  /** `/sessions` d'une app, sur 24 h ; `panel=session:<id encodé>` (lib/view-state.ts, `ecrirePanel`). */
  const adresseF43 = (app: string, session?: string) => {
    const p = new URLSearchParams({ app, period: "24h" });
    if (session) p.set("panel", `session:${encodeURIComponent(session)}`);
    return `${consoleUrlF43}/sessions?${p.toString()}`;
  };
  const panneauDeLUrl = (page: Page) => new URL(page.url()).searchParams.get("panel");
  /** Une tuile du panneau par le DÉBUT de son libellé annoncé (`aria-label` = « <libellé> <valeur>, … »). */
  const tuileF43 = (panneau: Locator, libelle: string) =>
    panneau.locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);

  test.beforeAll(async () => {
    motDePasseF43 = await compteDedie(poolF43, EMAIL_F43);
    await poolF43.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array[$3]::text[], true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
      [VIEWER_F43, bcryptF43(MDP_VIEWER_F43), APP_F43],
    );
    await semerF43();
  });

  test.afterAll(async () => {
    await menageF43();
    await poolF43.end();
  });

  test("clavier : une ligne ouvre le panneau, focus au titre, ↓ / ↑ parcourent la page de liste, Échap ferme", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await connexionF43(page, EMAIL_F43, motDePasseF43);
    await page.goto(adresseF43(APP_F43), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
    const lignes = page.getByTestId("ligne-session");
    await expect(lignes).toHaveCount(3);

    // Ouverture depuis la liste, sur la ligne du milieu.
    await lignes.nth(1).getByTestId("session-link").click();
    await expect.poll(() => panneauDeLUrl(page)).toBe(`session:${SECONDE}`);
    const panneau = page.getByTestId("detail-panel");
    const titre = page.locator("#panneau-detail-titre");
    await expect(panneau).toHaveAttribute("data-type", "session");
    await expect(titre).toContainText(SECONDE.slice(0, 8));
    await expect(titre).toBeFocused();
    // La ligne ouverte est marquée dans la liste, lisible à gauche du panneau.
    await expect(lignes.nth(1)).toHaveAttribute("data-ouvert", "1");

    // ↓ : la ligne suivante de la page. Entre deux flèches, on attend le RENDU de la
    // nouvelle place (l'îlot clavier lit les liens du rendu courant, cf. panneau.spec).
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => panneauDeLUrl(page)).toBe(`session:${MOBILE}`);
    await expect(titre).toContainText(MOBILE.slice(0, 8));
    await expect(titre).toBeFocused();
    // Bout de page : « Suivant » éteint, ↓ ne mène nulle part.
    await expect(panneau.locator('[aria-disabled="true"]', { hasText: "Suivant" })).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    // Attente bornée : on vérifie qu'il ne se passe RIEN, ce qui n'a pas d'événement à attendre.
    await page.waitForTimeout(500);
    expect(panneauDeLUrl(page)).toBe(`session:${MOBILE}`);

    // ↑ ↑ : retour à la première ligne, « Précédent » éteint.
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => panneauDeLUrl(page)).toBe(`session:${SECONDE}`);
    await expect(titre).toContainText(SECONDE.slice(0, 8));
    await expect(titre).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => panneauDeLUrl(page)).toBe(`session:${PREMIERE}`);
    await expect(titre).toContainText(PREMIERE.slice(0, 8));
    await expect(titre).toBeFocused();
    await expect(panneau.locator('[aria-disabled="true"]', { hasText: "Précédent" })).toHaveCount(1);

    // Échap : `panel` part de l'URL, le panneau aussi ; la plage et l'app restent.
    await page.keyboard.press("Escape");
    await expect.poll(() => panneauDeLUrl(page)).toBeNull();
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
    const u = new URL(page.url());
    expect(u.searchParams.get("app")).toBe(APP_F43);
    expect(u.searchParams.get("period")).toBe("24h");
  });

  test("contenu : puces, quatre tuiles, mini-cascade réduite, premiers événements — la session entière", async ({ page }) => {
    await connexionF43(page, EMAIL_F43, motDePasseF43);
    await page.goto(adresseF43(APP_F43, PREMIERE), { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toBeVisible();

    const puces = panneau.getByTestId("detail-panel-puces");
    for (const attendu of ["Chrome", "Windows", "SDK", "2.0.0", "provenance : Fuseau horaire du terminal"]) {
      await expect(puces).toContainText(attendu);
    }

    await expect(panneau.getByTestId("kpi-tile")).toHaveCount(4);
    await expect(tuileF43(panneau, "Pages vues").getByTestId("kpi-valeur")).toHaveText("2");
    // Occurrences SOMMÉES (V1) : une ligne d'erreur, trois occurrences.
    await expect(tuileF43(panneau, "Occurrences d'erreur").getByTestId("kpi-valeur")).toHaveText("3");
    await expect(tuileF43(panneau, "Signaux de frustration").getByTestId("kpi-valeur")).toHaveText("1");

    const cascade = panneau.getByTestId("panneau-session-cascade").getByTestId("cascade");
    await expect(cascade).toHaveAttribute("data-hauteur", "reduite");
    await expect(cascade.getByTestId("cascade-apercu")).toBeVisible();
    await expect(cascade.getByTestId("cascade-elements")).toHaveCount(0);
    await expect(cascade.getByTestId("etat-partiel")).toContainText("ressources rattachées à une action seulement");

    await expect(panneau.getByTestId("panneau-session-evenements").getByTestId("entete-vue")).toHaveCount(2);
    await expect(panneau.getByTestId("panneau-session-portee")).toContainText("ne dépendent pas de la plage de l'écran");
    // Aucun segment de rejeu semé : l'absence est dite, sans bouton mort.
    await expect(panneau.getByTestId("panneau-session-sans-rejeu")).toBeVisible();
    await expect(panneau.getByTestId("panneau-session-rejeu")).toHaveCount(0);
    await expect(panneau.getByTestId("detail-panel-page")).toHaveAttribute("href", new RegExp(`^/sessions/${PREMIERE}\\?`));
  });

  test("session React Native : frustration « Non collecté », jamais 0 ; une session navigateur montre son zéro", async ({ page }) => {
    await connexionF43(page, EMAIL_F43, motDePasseF43);
    await page.goto(adresseF43(APP_F43, MOBILE), { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    const frustration = tuileF43(panneau, "Signaux de frustration");
    await expect(frustration.getByTestId("kpi-valeur")).toHaveText("—");
    await expect(frustration).toContainText("Non collecté : le SDK mobile n'émet pas de signaux de frustration");

    await page.goto(adresseF43(APP_F43, SECONDE), { waitUntil: "domcontentloaded" });
    await expect(tuileF43(panneau, "Signaux de frustration").getByTestId("kpi-valeur")).toHaveText("0");
  });

  test("hors périmètre : aucun panneau, une ligne le dit, rien de la session n'est rendu", async ({ page }) => {
    await connexionF43(page, EMAIL_F43, motDePasseF43);
    // Témoin : lue à bon droit, la session de l'autre app s'ouvre et montre son marqueur —
    // sans lui, « marqueur absent » plus bas ne prouverait rien.
    await page.goto(adresseF43(APP_F43_AUTRE, AUTRE), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("detail-panel")).toContainText(MARQUEUR_AUTRE);

    // Écran lu sur APP_F43 : la session n'est pas dans ce qu'il lit.
    await page.goto(adresseF43(APP_F43, AUTRE), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("panneau-session-absent")).toContainText("introuvable ou hors périmètre");
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(MARQUEUR_AUTRE);
    // Un identifiant inconnu dit la même chose : l'écran ne révèle pas lequel des deux.
    await page.goto(adresseF43(APP_F43, "f43e2e-inexistante"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("panneau-session-absent")).toContainText("introuvable ou hors périmètre");
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
  });

  test("viewer restreint à son app : la session d'une autre app ne s'ouvre jamais, même en app=all", async ({ page }) => {
    await connexionF43(page, VIEWER_F43, MDP_VIEWER_F43);
    for (const app of ["all", APP_F43]) {
      await page.goto(adresseF43(app, AUTRE), { waitUntil: "domcontentloaded" });
      // `all` : la porte « projet courant » réécrit l'app en celle du viewer.
      await expect.poll(() => new URL(page.url()).searchParams.get("app")).toBe(APP_F43);
      await expect(page.getByTestId("panneau-session-absent")).toContainText("introuvable ou hors périmètre");
      await expect(page.getByTestId("detail-panel")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(MARQUEUR_AUTRE);
    }
    // Sa propre session, elle, s'ouvre.
    await page.goto(adresseF43(APP_F43, PREMIERE), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("detail-panel")).toBeVisible();
  });

  test("largeurs : plein écran à 390 px, moitié de la zone de contenu à 1440 px ; aucun débordement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await connexionF43(page, EMAIL_F43, motDePasseF43);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(adresseF43(APP_F43, PREMIERE), { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toBeVisible();
    const plein = (await panneau.boundingBox())!;
    expect(plein.x).toBe(0);
    expect(plein.y).toBe(0);
    expect(plein.width).toBeGreaterThanOrEqual(390 - 20);
    expect(plein.height).toBeGreaterThanOrEqual(844 - 1);
    const fermer = (await page.getByTestId("detail-panel-fermer").boundingBox())!;
    expect(fermer.y, "« Fermer » en tête").toBeLessThan(80);
    expect(fermer.x + fermer.width).toBeLessThanOrEqual(390);
    // À 390 px, la liste est en cartes : une carte ouvre aussi le panneau.
    await page.getByTestId("detail-panel-fermer").click();
    await expect(page.getByTestId("detail-panel")).toHaveCount(0);
    await page.getByTestId("carte-session").nth(1).getByTestId("session-link").click();
    await expect.poll(() => panneauDeLUrl(page)).toBe(`session:${SECONDE}`);
    await expect(page.getByTestId("detail-panel")).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(adresseF43(APP_F43, PREMIERE), { waitUntil: "domcontentloaded" });
    const moitie = (await panneau.boundingBox())!;
    const attendu = (1440 - 256) / 2; // barre latérale de 16 rem
    expect(Math.abs(moitie.width - attendu), `largeur ${moitie.width} px, attendu ≈ ${attendu} px`).toBeLessThan(12);
    expect(Math.abs(moitie.x + moitie.width - 1440)).toBeLessThan(2);

    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const session of [PREMIERE, MOBILE]) {
        await page.goto(adresseF43(APP_F43, session), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("detail-panel")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`panel=session:${session} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  test("sans JavaScript : le panneau est dans le HTML, « Suivant » et « Fermer » suffisent", async ({ browser, page }) => {
    await connexionF43(page, EMAIL_F43, motDePasseF43);
    const contexte = await browser.newContext({
      javaScriptEnabled: false,
      reducedMotion: "reduce",
      storageState: await page.context().storageState(),
    });
    const sansJs = await contexte.newPage();
    try {
      await sansJs.goto(adresseF43(APP_F43, PREMIERE), { waitUntil: "domcontentloaded" });
      await expect(sansJs.locator("#panneau-detail-titre")).toContainText(PREMIERE.slice(0, 8));
      await sansJs.getByTestId("detail-panel").getByRole("link", { name: /Suivant/ }).click();
      await expect(sansJs.locator("#panneau-detail-titre")).toContainText(SECONDE.slice(0, 8));
      await sansJs.getByTestId("detail-panel-fermer").click();
      await expect(sansJs.getByTestId("detail-panel")).toHaveCount(0);
      expect(panneauDeLUrl(sansJs)).toBeNull();
    } finally {
      await contexte.close();
    }
  });
});
