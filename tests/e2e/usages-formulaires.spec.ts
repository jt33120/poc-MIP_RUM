// E2E — F51 (plan § 5.15) : l'écran Formulaires.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Le retour du classement par volume : les formulaires sont classés par
//     ABANDONS, et un formulaire entamé 12 fois ne passe pas devant un formulaire
//     entamé 402 fois, même avec plus d'abandons (P3, « échantillon faible »).
//   - Un tri des champs par abandons : ils sont rendus dans l'ORDRE MÉDIAN de
//     première interaction — le champ qui fait fuir n'est pas remonté en tête, sa
//     place dans le formulaire EST l'information.
//   - Une barre plus courte que le segment posé dessus : chaque champ vaut ses
//     tentatives, et l'alternative textuelle porte les trois colonnes.
//   - Un abandon inventé : un abandon dont le dernier champ n'a pas été touché est
//     exclu des barres et compté dans un bandeau « Partiel ».
//   - Un zéro pour une absence : une app sans aucun événement `form.*` affiche
//     « — » et la raison sur chaque tuile, pas des zéros (V3).
//   - Une figure dessinée pour un patch absent : « Abandons dans le temps » attend
//     B34 et le dit, sans axe.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans deux apps dédiées, et un compte admin
// dédié à ce fichier (jamais `scripts/seed-admin.mjs`).
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_F51 = "f51-formulaires-e2e";
const APP_F51_VIDE = "f51-formulaires-vide-e2e";
const APPS_F51 = [APP_F51, APP_F51_VIDE];
const E2E_EMAIL = "e2e-f51-formulaires@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

// Deux formulaires, choisis pour que le classement soit DÉCIDÉ par la garde :
//   « inscription » : 402 tentatives, 8 abandons  → effectif solide ;
//   « contact »     :  12 tentatives, 12 abandons → PLUS d'abandons, mais faible.
// Sans la garde n < 30, « contact » passerait en tête.
const SUBMITS = 394;
const ABANDONS_EMAIL = 6;
const ABANDONS_INCOHERENTS = 2;
const CONTACT_ABANDONS = 12;

const CHAMPS_COMPLETS = `jsonb_build_array(
  jsonb_build_object('name','nom','order',1,'timeMs',1000,'changed',true,'refocus',0),
  jsonb_build_object('name','email','order',2,'timeMs',2000,'changed',true,'refocus',0),
  jsonb_build_object('name','carte','order',3,'timeMs',3000,'changed',true,'refocus',0))`;
const CHAMPS_PARTIELS = `jsonb_build_array(
  jsonb_build_object('name','nom','order',1,'timeMs',500,'changed',true,'refocus',0),
  jsonb_build_object('name','email','order',2,'timeMs',4000,'changed',false,'refocus',1))`;

async function nettoyerF51() {
  for (const t of ["rum_event", "rum_pageview", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = any($1::text[])`, [APPS_F51]);
  }
}

async function semerF51() {
  await nettoyerF51();
  for (const app of APPS_F51) {
    await pool.query(`insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing`, [app]);
    // `sample_rate = 1` explicite : aucun bandeau d'échantillonnage ne vient
    // brouiller les assertions de cet écran (il a le sien, testé par F40).
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count, sample_rate)
       values ($1, $2, $1, 'desktop', false, now() - interval '3 hours', now() - interval '1 hour', 1, 1)`,
      [`${app}-s1`, app],
    );
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
       values ($1, $2, $3, '/f51', 'https://site-f51.example/f51', null, now() - interval '3 hours')`,
      [`${app}-s1-pv`, `${app}-s1`, app],
    );
  }
  const sid = `${APP_F51}-s1`;
  // Une instruction par groupe d'événements (generate_series), jamais ligne à ligne.
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
     select $1 || '-sub-' || i, $1, $2, '/f51', 'form.submit',
            jsonb_build_object('form','f51-inscription','submitted',true,'total_time_ms',12000,
                               'fields', ${CHAMPS_COMPLETS}, 'last_field','carte'),
            now() - interval '2 hours'
     from generate_series(1, $3::int) i`,
    [sid, APP_F51, SUBMITS],
  );
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
     select $1 || '-ab-' || i, $1, $2, '/f51', 'form.abandon',
            jsonb_build_object('form','f51-inscription','submitted',false,'total_time_ms',1000,
                               'fields', ${CHAMPS_PARTIELS}, 'last_field','email'),
            now() - interval '2 hours'
     from generate_series(1, $3::int) i`,
    [sid, APP_F51, ABANDONS_EMAIL],
  );
  // Abandons d'un autre émetteur : le dernier champ déclaré n'est pas dans la
  // liste des champs touchés → exclus des barres, comptés et dits.
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
     select $1 || '-inc-' || i, $1, $2, '/f51', 'form.abandon',
            jsonb_build_object('form','f51-inscription','submitted',false,'total_time_ms',1000,
                               'fields', ${CHAMPS_PARTIELS}, 'last_field','captcha'),
            now() - interval '2 hours'
     from generate_series(1, $3::int) i`,
    [sid, APP_F51, ABANDONS_INCOHERENTS],
  );
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
     select $1 || '-ct-' || i, $1, $2, '/f51', 'form.abandon',
            jsonb_build_object('form','f51-contact','submitted',false,'total_time_ms',2000,
                               'fields', jsonb_build_array(
                                 jsonb_build_object('name','message','order',1,'timeMs',900,'changed',true,'refocus',0)),
                               'last_field','message'),
            now() - interval '2 hours'
     from generate_series(1, $3::int) i`,
    [sid, APP_F51, CONTACT_ABANDONS],
  );
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, E2E_EMAIL);
  await semerF51();
});

test.afterAll(async () => {
  await nettoyerF51();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test.describe("F51 — Formulaires", () => {
  test("classement par abandons : l'échantillon faible ferme la liste malgré plus d'abandons", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forms?app=${APP_F51}&period=24h`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).not.toContainText("Application error");
    const hero = page.locator("#forms-classement");
    // L'alternative textuelle porte les mêmes lignes, dans le même ordre.
    const lignes = hero.getByTestId("alternative").locator("tbody tr");
    await expect(lignes.nth(0)).toContainText("f51-inscription");
    await expect(lignes.nth(1)).toContainText("f51-contact");
    await expect(hero).toContainText("échantillon faible");
    // 402 entamés, 8 abandons pour « inscription » ; 12 / 12 pour « contact ».
    await expect(hero.locator('[title^="f51-inscription :"]')).toContainText("402 entamés");
    await expect(hero.locator('[title^="f51-contact :"]')).toContainText("12 entamés");
  });

  test("quatre tuiles : médiane des soumissions, conversion sans verdict coloré", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forms?app=${APP_F51}&period=24h`, { waitUntil: "domcontentloaded" });
    // Filtrage par le LIBELLÉ exact : « Soumissions » apparaît aussi dans la phrase
    // de lecture d'une autre tuile, et `hasText` cherche une sous-chaîne.
    const tuile = (label: string) =>
      page.getByTestId("kpi-tile").filter({ has: page.getByText(label, { exact: true }) });
    await expect(page.getByTestId("kpi-tile")).toHaveCount(4);
    await expect(tuile("Formulaires entamés").getByTestId("kpi-valeur")).toHaveText("414");
    await expect(tuile("Soumissions").getByTestId("kpi-valeur")).toHaveText("394");
    // 394 / 414 = 95,2 % ; aucun verdict coloré (aucun seuil publié, S6).
    await expect(tuile("Conversion")).toContainText(/95,2\s%/);
    await expect(tuile("Conversion").getByTestId("kpi-verdict")).toHaveCount(0);
    // Médiane des SOUMISSIONS (12 s), pas la moyenne de tout (11,8 s).
    await expect(tuile("Temps médian jusqu'à la soumission").getByTestId("kpi-valeur")).toHaveText(/^12\s?s$/);
    // La moyenne a disparu de l'écran.
    await expect(page.locator("body")).not.toContainText("Temps moyen");
  });

  test("champs dans l'ordre de remplissage, segments qui somment aux tentatives, abandons incohérents dits", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forms?app=${APP_F51}&period=24h&form=f51-inscription`, {
      waitUntil: "domcontentloaded",
    });
    const champs = page.locator("#forms-champs");
    await expect(champs).toContainText("Champs de f51-inscription dans l'ordre de remplissage");
    // Ordre médian : nom, email, carte — et surtout PAS « email » en tête, alors
    // que c'est le champ qui porte tous les abandons localisés.
    const lignes = champs.getByTestId("alternative").locator("tbody tr");
    await expect(lignes).toHaveCount(3);
    await expect(lignes.nth(0)).toContainText("nom");
    await expect(lignes.nth(1)).toContainText("email");
    await expect(lignes.nth(2)).toContainText("carte");
    // Trois colonnes de données : Tentatives · Abandons ici · Part des tentatives.
    const entetes = champs.getByTestId("alternative").locator("thead th");
    await expect(entetes).toHaveCount(4);
    await expect(entetes.nth(1)).toHaveText("Tentatives");
    await expect(entetes.nth(2)).toHaveText("Abandons ici");
    await expect(entetes.nth(3)).toHaveText("Part des tentatives");
    // « email » : 402 tentatives, dont 6 abandons dont c'est le dernier champ.
    await expect(lignes.nth(1)).toContainText("402");
    await expect(lignes.nth(1)).toContainText("6");
    await expect(champs.locator('[title^="email —"]')).toContainText("402");
    // Les 2 abandons dont le dernier champ n'a pas été touché sont exclus et dits.
    await expect(page.getByTestId("forms-champs-note")).toContainText(
      "2 abandons dont le dernier champ n'est pas dans la liste des champs touchés : exclus des barres",
    );
  });

  test("définition de l'abandon, garde du SDK mobile, série B34 dite et non dessinée", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forms?app=${APP_F51}&period=7d`, { waitUntil: "domcontentloaded" });
    const definition = page.getByTestId("forms-definition");
    await expect(definition).toContainText(
      "un abandon est émis quand la page passe en arrière-plan avec un formulaire entamé et non soumis",
    );
    await expect(definition).toContainText(
      "changer d'onglet puis revenir soumettre compte un abandon et pas la soumission",
    );
    await expect(definition).toContainText(
      "un envoi sans événement submit (bouton géré en JavaScript) compte comme un abandon",
    );
    // R-F : le SDK React Native n'émet aucun `form.*` (vérifié en F51).
    await expect(page.getByTestId("forms-garde-mobile")).toContainText(
      "Le SDK React Native n'émet aucun événement de formulaire",
    );
    // F53 (B31) : la lecture est celle du contrat ; la méta écrit la plage lue, la
    // note « lecture non migrée » a disparu.
    await expect(page.getByTestId("lecture-non-migree")).toHaveCount(0);
    await expect(page.locator("#forms-classement").getByTestId("figure-meta")).toContainText("7 j");
    // B34 : dit, jamais dessiné.
    await expect(page.locator("#forms-serie")).toContainText("série à créer (B34)");
    await expect(page.locator("#forms-serie .recharts-wrapper")).toHaveCount(0);
    // Sous le plafond de 5 000 événements : aucun bandeau.
    await expect(page.getByTestId("forms-plafond")).toHaveCount(0);
  });

  test("aucun événement de formulaire : « — » motivé sur chaque tuile, jamais un zéro", async ({ page }) => {
    await login(page);
    await page.goto(`${consoleUrl}/forms?app=${APP_F51_VIDE}&period=24h`, { waitUntil: "domcontentloaded" });
    const tuiles = page.getByTestId("kpi-tile");
    await expect(tuiles).toHaveCount(4);
    for (const tuile of await tuiles.all()) {
      await expect(tuile.getByTestId("kpi-valeur")).toHaveText("—");
      await expect(tuile.getByTestId("kpi-raison")).toContainText("aucun");
    }
    await expect(page.locator("#forms-classement")).toContainText("Aucune tentative de formulaire sur");
    await expect(page.locator("#forms-classement")).toContainText("option « forms » active");
    await expect(page.locator("#forms-champs")).toContainText("Aucune tentative n'a touché de champ suivi sur");
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await login(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/forms?app=${APP_F51}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#forms-classement")).toBeVisible();
      expect(await debordements(page), `${largeur} px`).toEqual([]);
    }
  });
});
