// P7.5 — l'écran `/mobile` dans un navigateur réel, sur des fixtures
// EXPLICITEMENT SYNTHÉTIQUES (app dédiée `p75-e2e-app`, identifiants préfixés,
// aucune donnée de production).
//
// CE QUE CE TEST EXISTE POUR EMPÊCHER. Que l'écran affiche « 0 crash » là où
// rien ne mesure les crashes. C'est le seul défaut qui compte vraiment ici :
// un zéro se lit comme une bonne nouvelle, et il serait faux pour TOUTES les
// applications tant que P8.5 n'a pas livré de module natif. Le test vérifie donc
// d'abord les badges, puis les chiffres.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const APP = "p75-e2e-app";
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-mobile-console@mip-rum.local";
let adminPassword = "";

/** La migration v82 est-elle appliquée ? Sans elle, l'écran est partiel par construction. */
let v82 = false;

test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(
    "insert into app_registry (app_id,name,active) values ($1,'P75 e2e',true) on conflict (app_id) do update set active=true",
    [APP],
  );
  const { rows } = await pool.query(
    `select exists(select 1 from information_schema.columns
       where table_schema='public' and table_name='rum_session' and column_name='runtime') as v82`,
  );
  v82 = rows[0].v82 === true;
  if (!v82) return;

  await nettoyer();

  // Trois sessions React Native iOS, une Android, une web (à exclure).
  const session = (id: string, runtime: string, os: string, release: string, visiteur: string | null) =>
    pool.query(
      `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id,
                                started_at, last_seen_at)
       values ($1,$2,'mobile',$3,$4,$5,$6, now() - interval '10 minutes', now() - interval '8 minutes')
       on conflict (session_id) do update set runtime=excluded.runtime, os=excluded.os,
                                              started_at=excluded.started_at, last_seen_at=excluded.last_seen_at`,
      [id, APP, os, runtime, release, visiteur],
    );
  await session("p75-e2e-ios-1", "react_native", "iOS", "4.2.0", "p75-v1");
  await session("p75-e2e-ios-2", "react_native", "iOS", "4.2.0", "p75-v2");
  await session("p75-e2e-android-1", "react_native", "Android", "4.2.0", "p75-v3");
  await session("p75-e2e-web-1", "browser", "Windows", "4.2.0", "p75-v4");

  // Une erreur JS sur une seule session iOS : 2 sessions sans erreur sur 3.
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, is_fatal, fingerprint, ts)
     values ('p75-e2e-err-1','p75-e2e-ios-1',$1,'Échec de paiement synthétique','crash',2,'react_native_js',true,'p75e2efp',
             now() - interval '9 minutes')
     on conflict (span_id) do nothing`,
    [APP],
  );
  // Bruit à ne PAS compter : une erreur navigateur sur la session web.
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, ts)
     values ('p75-e2e-err-2','p75-e2e-web-1',$1,'erreur web synthétique','crash',99,'browser_js', now() - interval '9 minutes')
     on conflict (span_id) do nothing`,
    [APP],
  );
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, name, event_type, timing_ms, ts) values
       ('p75-e2e-t1','p75-e2e-ios-1',$1,'js_start_to_first_screen_ms','timing',740, now() - interval '10 minutes'),
       ('p75-e2e-t2','p75-e2e-ios-2',$1,'js_start_to_first_screen_ms','timing',860, now() - interval '10 minutes')
     on conflict (span_id) do nothing`,
    [APP],
  );
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values
       ('p75-e2e-p1','p75-e2e-ios-1',$1,'/accueil-synthetique', now() - interval '10 minutes'),
       ('p75-e2e-p2','p75-e2e-ios-2',$1,'/accueil-synthetique', now() - interval '10 minutes'),
       ('p75-e2e-p3','p75-e2e-android-1',$1,'/panier-synthetique', now() - interval '10 minutes')
     on conflict (span_id) do nothing`,
    [APP],
  );
  await pool.query(
    `insert into rum_span (span_id, trace_id, tier, session_id, app_id, url, method, status_code, duration_ms, ts)
     values ('p75-e2e-s1', repeat('7',32), 'front','p75-e2e-ios-1',$1,'https://api.synthetique.test/paiement','POST',500,1450,
             now() - interval '9 minutes')
     on conflict (span_id) do nothing`,
    [APP],
  );

  // Déclarations du SDK : erreurs JS et écrans COLLECTÉS, natif NON COLLECTÉ.
  // `native_start` reste sans aucune déclaration : « Inconnu », pas « Non collecté ».
  for (const [capacite, declare] of [
    ["js_errors", true],
    ["screen_tracking", true],
    ["offline_persistence", false],
    ["native_crashes", false],
    ["anr", false],
  ] as const) {
    await pool.query(
      `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
       values ($1,'react_native','4.2.0',$2,$3)
       on conflict (app_id, runtime, release, capability)
       do update set declared = excluded.declared, last_declared_at = now()`,
      [APP, capacite, declare],
    );
  }
});

async function nettoyer() {
  for (const table of ["mobile_capabilities", "rum_event", "rum_error", "rum_span", "rum_pageview", "rum_session"]) {
    await pool.query(`delete from ${table} where app_id = $1`, [APP]);
  }
}

test.afterAll(async () => {
  if (v82) await nettoyer();
  await pool.query("delete from app_registry where app_id = $1", [APP]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: APP, url: consoleUrl }]);
}

test("mobile : « Non collecté » au lieu de zéro, filtres, drill-down, clavier et 390 px", async ({ page }) => {
  test.skip(!v82, "migration v82 absente de la base e2e");
  // Largeur téléphone d'abord : c'est la contrainte la plus dure, et la plus
  // souvent cassée par une carte ajoutée après coup.
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h`);
  await expect(page.getByRole("heading", { name: "Mobile", level: 1 })).toBeVisible();

  // ── 1. Les badges, AVANT les chiffres ──────────────────────────────────────
  // Crashes natifs et ANR : déclarés indisponibles → « Non collecté », jamais 0.
  await expect(page.getByTestId("capacite-native_crashes")).toContainText("Non collecté");
  await expect(page.getByTestId("capacite-anr")).toContainText("Non collecté");
  // Démarrage natif : AUCUNE déclaration → « Inconnu », ce qui n'est pas la même chose.
  await expect(page.getByTestId("capacite-native_start")).toContainText("Inconnu");
  await expect(page.getByTestId("capacite-js_errors")).toContainText("Collecté");
  // Jamais vérifié : une déclaration n'est pas une recette.
  await expect(page.getByTestId("capacite-js_errors")).toContainText("Jamais");
  // Le libellé de la carte ne dit PAS « crash-free » : il nomme les erreurs JS.
  await expect(page.getByText("Sessions sans erreur JS")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("crash-free");
  await expect(page.locator("body")).not.toContainText("100 % sans crash");
  // Et l'écran démonte explicitement la confusion, au lieu de l'ignorer.
  await expect(page.getByText(/les crashes natifs ne sont pas collect/)).toBeVisible();

  // ── 2. Les chiffres, sur la cohorte React Native seule ─────────────────────
  // F38 : les tuiles sont des `KpiTile` ; la valeur est `kpi-valeur`.
  const valeur = (id: string) => page.getByTestId(id).getByTestId("kpi-valeur");
  await expect(valeur("mobile-sessions")).toHaveText("3");
  await expect(valeur("mobile-visiteurs")).toHaveText("3");
  // 2 occurrences JS ; les 99 de la session web ne comptent pas.
  await expect(valeur("mobile-erreurs")).toHaveText("2");
  // 1 session touchée sur 3 → 66,7 %. Le libellé porte bien « erreur JS ».
  await expect(valeur("mobile-taux-sans-erreur")).toHaveText("66,7 %");
  // Démarrage : une étendue p50 → p95 ; aucun démarrage à chaud semé : « Non mesuré », pas « 0 ms ».
  await expect(page.locator("#mobile-demarrage")).toContainText("ms");
  await expect(page.locator("#mobile-demarrage").getByTestId("etendue-non-mesure")).toHaveText("Non mesuré");
  await expect(page.getByText("/accueil-synthetique").first()).toBeVisible();
  await expect(page.getByText("/paiement", { exact: false }).first()).toBeVisible();

  // ── 3. Pas de débordement horizontal à 390 px ──────────────────────────────
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // ── 4. Clavier : la vue préréglée est un lien atteignable (F38 : le formulaire
  //       « Plateforme » a disparu au profit de `PresetBar`) ─────────────────
  const android = page.locator('[data-testid="preset-vue"][data-vue="p:android"]');
  await android.focus();
  await expect(android).toBeFocused();
  await expect(page.locator("#mobile-ecrans").getByText("Alternative textuelle")).toBeVisible();

  // ── 5. La vue « Android » porte sur la COHORTE (os=Android) ────────────────
  await android.click();
  await expect(page).toHaveURL(/os=Android/, { timeout: 15_000 });
  await expect(valeur("mobile-sessions")).toHaveText("1");
  // Aucune erreur JS sur Android : le taux vaut 100 %, et c'est un VRAI 100 %,
  // puisque la release 4.2.0 déclare collecter les erreurs JS.
  await expect(valeur("mobile-erreurs")).toHaveText("0");
  await expect(valeur("mobile-taux-sans-erreur")).toHaveText("100,0 %");
  await expect(page.getByText("/panier-synthetique").first()).toBeVisible();
  await expect(page.getByText("/accueil-synthetique")).toHaveCount(0);

  // ── 6. Données manquantes : une release sans aucun signal ──────────────────
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h&release=0.0.0-inexistante`);
  await expect(valeur("mobile-sessions")).toHaveText("0");
  // Aucune session : le taux n'a pas de dénominateur, et l'écran le DIT — plutôt
  // que d'afficher « 100 % », qui se lirait comme une bonne nouvelle.
  await expect(valeur("mobile-taux-sans-erreur")).toHaveText("—");
  await expect(page.getByTestId("mobile-taux-sans-erreur").getByText(/pas de d[ée]nominateur/)).toBeVisible();
  // Et les six capacités redeviennent « Inconnu » : aucune release de ce
  // périmètre n'a rien déclaré.
  await expect(page.getByTestId("capacite-js_errors")).toContainText("Inconnu");
  // F39 : sous un filtre de release (lu ici sur la SESSION), la cohorte ne s'ouvre pas
  // sur /sessions — qui ne filtre pas la release d'une session : lien désactivé, raison écrite.
  await expect(page.getByTestId("mobile-lien-sessions")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("mobile-lien-sessions-raison")).toContainText("filtre de release");

  // ── 7. Drill-down vers les erreurs React Native, filtres conservés (F30) ───
  // CE7 : `/errors/issues` n'a pas de page (seul `/errors/issues/<id>` existe) ;
  // le lien vise la liste des erreurs, qui lit `source`. CE8 : `device=mobile`
  // ouvrait les navigateurs mobiles, pas la cohorte React Native. Depuis B8, la
  // liste des sessions lit `seg=v2:runtime:eq:react_native` : le lien existe, et
  // il porte la cohorte, pas l'appareil.
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h`);
  const lien = page.getByTestId("mobile-lien-erreurs");
  await expect(lien).toHaveAttribute("href", /^\/errors\?/);
  await expect(lien).toHaveAttribute("href", /source=react_native_js/);
  await expect(lien).toHaveAttribute("href", new RegExp(`app=${APP}`));
  await expect(page.locator('a[href="/errors/issues"], a[href^="/errors/issues?"]')).toHaveCount(0);
  const plusLoin = page.getByRole("navigation", { name: "Aller plus loin" });
  await expect(plusLoin.locator('a[href*="device=mobile"]')).toHaveCount(0);
  const sessionsRn = page.getByTestId("mobile-lien-sessions");
  await expect(sessionsRn).toHaveAttribute("href", /^\/sessions\?/);
  await expect(sessionsRn).toHaveAttribute("href", /seg=v2%3Aruntime%3Aeq%3Areact_native/);
  await expect(sessionsRn).toHaveAttribute("href", new RegExp(`app=${APP}`));
  await expect(page.locator("body")).not.toContainText("(B8)");
  await lien.click();
  await page.waitForURL((u) => u.pathname === "/errors" && u.searchParams.get("source") === "react_native_js", {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("could not be found");

  // ── 8. Un filtre que l'écran n'applique PAS est refusé, jamais ignoré ──────
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h&route=%2Fpanier-synthetique`);
  await expect(page.getByTestId("filter-problem")).toBeVisible();
  await expect(page.getByTestId("filter-problem-reset")).toBeVisible();
});

test("API mobile/summary : périmètre signé, null plutôt que zéro, et pas de champ natif", async ({ page }) => {
  test.skip(!v82, "migration v82 absente de la base e2e");
  // Sans authentification : 401, jamais une réponse partielle. Le contexte de
  // requête de la PAGE n'a pas encore de cookie de session à ce stade.
  const anonyme = await page.request.get(`${consoleUrl}/api/v1/mobile/summary?app=${APP}`);
  expect(anonyme.status()).toBe(401);

  // Session de console : le même principal signé que l'écran, et le même
  // périmètre. On n'invente pas de jeton pour le test.
  await login(page);
  const reponse = await page.request.get(`${consoleUrl}/api/v1/mobile/summary?app=${APP}&period=24h`);
  expect(reponse.status()).toBe(200);
  const corps = await reponse.json();
  expect(corps.data.sessions.sessions).toBe(3);
  expect(corps.data.capabilities.find((c: { capability: string }) => c.capability === "native_crashes").state).toBe(
    "unavailable",
  );
  // AUCUN champ de crash natif au premier niveau : pas même un zéro, pas même un
  // null — un champ laisserait croire que la mesure existe.
  expect(Object.keys(corps.data)).not.toContain("native_crashes");
  expect(Object.keys(corps.data)).not.toContain("anr");
  // Aucun démarrage à chaud semé : `null`, et non 0.
  expect(corps.data.startup.warm).toBeNull();
  expect(corps.data.startup.cold.samples).toBe(2);
  expect(corps.data.js_error_free_session_rate).toBeCloseTo(2 / 3, 5);

  // Une dimension que l'écran n'applique pas est refusée, avec son code typé.
  const refus = await page.request.get(`${consoleUrl}/api/v1/mobile/summary?app=${APP}&route=%2Fx`);
  expect(refus.status()).toBe(400);
  const corpsRefus = await refus.json();
  // Corps typé : `code` au premier niveau, `error` porte le message lisible.
  expect(corpsRefus.code).toBe("unsupported_dimension");
  expect(corpsRefus.dimension).toBe("route");

  // Et `platform` s'INTERSECTE avec `os` au lieu de le remplacer : la
  // combinaison contradictoire rend zéro, jamais l'un des deux.
  const contradictoire = await page.request.get(
    `${consoleUrl}/api/v1/mobile/summary?app=${APP}&period=24h&os=iOS&platform=android`,
  );
  expect(contradictoire.status()).toBe(200);
  expect((await contradictoire.json()).data.sessions.sessions).toBe(0);
});

// ═══════════════ F38 — réagencement et stabilité par release ═══════════════════
//
// App PROPRE au bloc (`f38-e2e-app`) : 2.1.0 déclare collecter les erreurs JS (3
// sessions, 1 touchée), 2.0.0 ne déclare rien (2 sessions sans erreur), une session
// sans release. Même compte dédié que le reste du fichier.
test.describe("F38 — réagencement et stabilité par release", () => {
  const APP_F38 = "f38-e2e-app";

  async function nettoyerF38() {
    for (const table of ["mobile_capabilities", "rum_event", "rum_error", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${table} where app_id = $1`, [APP_F38]);
    }
  }

  test.beforeAll(async () => {
    if (!v82) return;
    await pool.query(
      "insert into app_registry (app_id,name,active) values ($1,'F38 e2e',true) on conflict (app_id) do update set active=true",
      [APP_F38],
    );
    await nettoyerF38();
    const session = (id: string, release: string | null, ageMin: number) =>
      pool.query(
        `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, started_at, last_seen_at)
         values ($1,$2,'mobile','iOS','react_native',$3,$1, now() - ($4::int * interval '1 minute'),
                 now() - ($4::int * interval '1 minute') + interval '2 minutes')
         on conflict (session_id) do update set release=excluded.release, started_at=excluded.started_at,
                                                last_seen_at=excluded.last_seen_at`,
        [id, APP_F38, release, ageMin],
      );
    await session("f38-e2e-21a", "2.1.0", 12);
    await session("f38-e2e-21b", "2.1.0", 11);
    await session("f38-e2e-21c", "2.1.0", 10);
    await session("f38-e2e-20a", "2.0.0", 40);
    await session("f38-e2e-20b", "2.0.0", 35);
    await session("f38-e2e-sans", null, 20);
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, fingerprint, ts)
       values ('f38-e2e-err','f38-e2e-21a',$1,'Erreur synthétique F38','crash',3,'react_native_js','f38e2efp',
               now() - interval '11 minutes')
       on conflict (span_id) do nothing`,
      [APP_F38],
    );
    await pool.query(
      `insert into rum_event (span_id, session_id, app_id, name, event_type, timing_ms, ts)
       values ('f38-e2e-t1','f38-e2e-21a',$1,'js_start_to_first_screen_ms','timing',820, now() - interval '12 minutes')
       on conflict (span_id) do nothing`,
      [APP_F38],
    );
    for (const [capacite, declare] of [
      ["js_errors", true],
      ["native_crashes", false],
      ["anr", false],
    ] as const) {
      await pool.query(
        `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
         values ($1,'react_native','2.1.0',$2,$3)
         on conflict (app_id, runtime, release, capability)
         do update set declared = excluded.declared, last_declared_at = now()`,
        [APP_F38, capacite, declare],
      );
    }
  });

  test.afterAll(async () => {
    if (v82) await nettoyerF38();
    await pool.query("delete from app_registry where app_id = $1", [APP_F38]);
  });

  /** Connexion UNE fois par test : `/login` d'une session ouverte redirige, le champ e-mail n'apparaît plus. */
  async function connecter(page: Page) {
    await login(page);
    await page.context().addCookies([{ name: "mip-project", value: APP_F38, url: consoleUrl }]);
  }

  async function aller(page: Page, largeur: number, hauteur: number) {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await page.goto(`${consoleUrl}/mobile?app=${APP_F38}&period=24h`);
    await expect(page.getByRole("heading", { name: "Mobile", level: 1 })).toBeVisible();
  }

  async function ouvrir(page: Page, largeur: number, hauteur: number) {
    await connecter(page);
    await aller(page, largeur, hauteur);
  }

  test("ordre des zones : angles morts, tuiles, puis le hero « Stabilité par release » au-dessus du pli à 1440", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrir(page, 1440, 900);
    const zones = await page.locator("[data-zone]").evaluateAll((els) => els.map((e) => e.getAttribute("data-zone")));
    expect(zones.slice(0, 5)).toEqual(["angles-morts", "bandeaux", "kpi", "stabilite", "demarrage-ecrans"]);
    expect(zones.at(-2)).toBe("capacites");

    // W-M1 : l'angle mort est lu AVANT le premier chiffre.
    const angle = await page.getByTestId("mobile-angles-morts").boundingBox();
    const kpi = await page.getByTestId("mobile-kpi").boundingBox();
    expect(angle!.y).toBeLessThan(kpi!.y);
    await expect(page.getByTestId("mobile-angles-morts")).toContainText("Crashes natifs");
    // Le hero est au-dessus du pli (1440 × 900), sans défilement.
    const hero = await page.getByRole("heading", { name: "Stabilité par release" }).boundingBox();
    expect(hero!.y + hero!.height).toBeLessThan(900);

    // Jamais « crash-free », jamais « sans crash » — sur toute la page.
    await expect(page.locator("body")).not.toContainText(/crash-free/i);
    await expect(page.locator("body")).not.toContainText(/sans crash/i);
    // W-M11 : la dernière déclaration est une colonne, en fin d'écran.
    await expect(page.getByRole("columnheader", { name: "Dernière déclaration" })).toBeVisible();
    // W-M10 (F39, après B8) : la série est rendue — deux panneaux —, plus aucune raison « B8 ».
    await expect(page.locator("#mobile-temps")).not.toContainText("dimension de lecture (B8)");
    await expect(page.locator("#mobile-temps").getByTestId("mobile-temps-panneaux")).toBeVisible();
  });

  test("hero : la release non déclarante n'a pas de pourcentage ; une ligne pose release=", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrir(page, 1440, 900);
    const hero = page.getByTestId("mobile-stabilite");
    const ligne = (texte: string) => hero.getByTestId("impact-ligne").filter({ hasText: texte });
    await expect(ligne("2.1.0")).toContainText("33,3 %");
    await expect(ligne("2.0.0")).not.toContainText("%");
    await expect(hero.getByTestId("mobile-stabilite-raison")).toContainText("2.0.0");
    // Sessions sans release : « Inconnue », et son lien ne pose pas `release=` vide.
    await expect(ligne("Inconnue").locator("a")).toHaveAttribute("href", /seg=v2%3Arelease%3Ais_null/);
    // Référence : Σ touchées / Σ sessions des releases déclarantes.
    await expect(hero.getByTestId("impact-reference")).toContainText("Releases déclarantes");
    // Tuile « Sessions sans erreur JS » : calculée sur les déclarantes seules (2 sur 3),
    // les 3 sessions de 2.0.0 et sans release exclues — et elle le dit.
    await expect(page.getByTestId("mobile-taux-sans-erreur").getByTestId("kpi-valeur")).toHaveText("66,7 %");
    await expect(page.getByTestId("mobile-taux-sans-erreur")).toContainText("3 sessions de releases non déclarantes exclues");

    await ligne("2.1.0").locator("a").click();
    await page.waitForURL((u) => u.searchParams.get("release") === "2.1.0", { timeout: 15_000 });
    await expect(page.getByTestId("mobile-stabilite").getByTestId("impact-ligne")).toHaveCount(1);
  });

  test("vues préréglées et ordre du hero : ne changent que os / release / tri", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrir(page, 1440, 900);
    await expect(page.getByRole("button", { name: "Appliquer" })).toHaveCount(0);
    const derniere = page.locator('[data-testid="preset-vue"][data-vue="p:mobile-derniere-release"]');
    await expect(derniere).toContainText("2.1.0");
    const avant = new URL(page.url());
    await page.locator('[data-testid="preset-vue"][data-vue="p:ios"]').click();
    await page.waitForURL((u) => u.searchParams.get("os") === "iOS", { timeout: 15_000 });
    const apres = new URL(page.url());
    for (const [cle, valeur] of avant.searchParams) expect(apres.searchParams.get(cle)).toBe(valeur);
    expect([...apres.searchParams.keys()].sort()).toEqual([...avant.searchParams.keys(), "os"].sort());

    // Ordre par défaut : la chronologie ; « Gravité » pose tri=gravite, sans toucher la population.
    await expect(page.getByTestId("mobile-stabilite").getByTestId("impact-ordre")).toContainText("première session vue");
    await page.getByTestId("mobile-stabilite").getByTestId("tri-gravite").click();
    await page.waitForURL((u) => u.searchParams.get("tri") === "gravite", { timeout: 15_000 });
    await expect(page.getByTestId("mobile-stabilite").getByTestId("impact-ordre")).toContainText("part de sessions touchées");
    expect(new URL(page.url()).searchParams.get("os")).toBe("iOS");
  });

  test("390, 768 et 1440 px : aucun débordement ; la matrice devient une liste à 390", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await connecter(page);
    // Toutes les largeurs sont PARCOURUES avant d'échouer : s'arrêter à la première cacherait les autres.
    const fautes: string[] = [];
    for (const [largeur, hauteur] of [
      [390, 844],
      [768, 1024],
      [1440, 900],
    ] as const) {
      await aller(page, largeur, hauteur);
      await expect(page.getByTestId("mobile-stabilite")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`/mobile @ ${largeur} px — ${faute}`);
    }
    expect(fautes).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("columnheader", { name: "Dernière déclaration" })).toBeHidden();
    await expect(page.getByTestId("capacite-js_errors")).toContainText("Dernière déclaration");
  });
});

// ═══════════════ F39 — dans le temps, et la cohorte ouverte ailleurs (B8) ═══════════════
//
// Deux apps PROPRES au bloc. `f39-e2e-app` : trois sessions React Native (5.0.0,
// déclarante), une erreur JS de 2 occurrences, une session web sur la MÊME route
// (elle ne doit entrer ni dans la série, ni dans /sessions, ni dans /pages une fois la
// cohorte ouverte). `f39-e2e-web` : une session web seulement — aucune donnée React
// Native. Même compte dédié que le reste du fichier.
test.describe("F39 — dans le temps, et la cohorte ouverte ailleurs (B8)", () => {
  const APP_F39 = "f39-e2e-app";
  const APP_F39_WEB = "f39-e2e-web";
  const APPS_F39 = [APP_F39, APP_F39_WEB];
  const ROUTE_F39 = "/accueil-f39";

  async function nettoyerF39() {
    for (const table of ["mobile_capabilities", "rum_error", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_F39]);
    }
  }

  test.beforeAll(async () => {
    if (!v82) return;
    for (const app of APPS_F39) {
      await pool.query(
        "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
        [app],
      );
    }
    await nettoyerF39();
    const session = (id: string, app: string, runtime: string, os: string, ageMin: number) =>
      pool.query(
        `insert into rum_session (session_id, app_id, device_type, os, runtime, release, visitor_id, started_at, last_seen_at)
         values ($1,$2,'mobile',$3,$4,'5.0.0',$1, now() - ($5::int * interval '1 minute'),
                 now() - ($5::int * interval '1 minute') + interval '2 minutes')`,
        [id, app, os, runtime, ageMin],
      );
    await session("f39-e2e-rn-a", APP_F39, "react_native", "iOS", 50);
    await session("f39-e2e-rn-b", APP_F39, "react_native", "iOS", 30);
    await session("f39-e2e-rn-c", APP_F39, "react_native", "Android", 10);
    await session("f39-e2e-web-a", APP_F39, "browser", "Windows", 20);
    await session("f39-e2e-web-seule", APP_F39_WEB, "browser", "Windows", 20);
    // Une page vue par session, TOUTES sur la même route : web compris.
    await pool.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at) values
         ('f39-e2e-p1','f39-e2e-rn-a',$1,$3, now() - interval '50 minutes'),
         ('f39-e2e-p2','f39-e2e-rn-b',$1,$3, now() - interval '30 minutes'),
         ('f39-e2e-p3','f39-e2e-rn-c',$1,$3, now() - interval '10 minutes'),
         ('f39-e2e-p4','f39-e2e-web-a',$1,$3, now() - interval '20 minutes'),
         ('f39-e2e-p5','f39-e2e-web-seule',$2,$3, now() - interval '20 minutes')`,
      [APP_F39, APP_F39_WEB, ROUTE_F39],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, message, kind, occurrences, error_source, fingerprint, ts) values
         ('f39-e2e-err-rn','f39-e2e-rn-a',$1,'Erreur synthétique F39','crash',2,'react_native_js','f39e2efp', now() - interval '49 minutes'),
         ('f39-e2e-err-web','f39-e2e-web-a',$1,'Erreur web synthétique F39','crash',9,'browser_js','f39e2efpw', now() - interval '19 minutes')`,
      [APP_F39],
    );
    await pool.query(
      `insert into mobile_capabilities (app_id, runtime, release, capability, declared)
       values ($1,'react_native','5.0.0','js_errors',true)
       on conflict (app_id, runtime, release, capability) do update set declared = excluded.declared, last_declared_at = now()`,
      [APP_F39],
    );
  });

  test.afterAll(async () => {
    if (v82) await nettoyerF39();
    await pool.query("delete from app_registry where app_id = any($1::text[])", [APPS_F39]);
  });

  /** Connexion UNE fois par test : `/login` d'une session ouverte redirige, le champ e-mail n'apparaît plus. */
  async function ouvrirF39(page: Page, app: string) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.context().addCookies([{ name: "mip-project", value: app, url: consoleUrl }]);
    await page.goto(`${consoleUrl}/mobile?app=${app}&period=24h`);
    await expect(page.getByRole("heading", { name: "Mobile", level: 1 })).toBeVisible();
  }

  test("W-M10 : deux panneaux empilés, avec alternative ; la somme des seaux est la tuile", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrirF39(page, APP_F39);
    const temps = page.locator("#mobile-temps");
    await temps.scrollIntoViewIfNeeded();
    // Deux graphiques recharts (`.recharts-wrapper` : `.recharts-surface` compterait aussi les icônes de légende).
    await expect(temps.locator(".recharts-wrapper")).toHaveCount(2);
    await expect(temps.getByTestId("panneau-sessions")).toContainText("Sessions React Native commencées");
    await expect(temps.getByTestId("panneau-erreurs")).toContainText("Occurrences d'erreurs JS");
    // La cohorte seule : la session web et ses 9 occurrences n'entrent pas ; la somme des seaux est la tuile.
    await expect(temps.getByTestId("figure-meta")).toContainText("3 sessions commencées");
    await expect(temps.getByTestId("figure-meta")).toContainText("2 occurrences d'erreurs JS");
    await expect(page.getByTestId("mobile-sessions").getByTestId("kpi-valeur")).toHaveText("3");
    await expect(page.getByTestId("mobile-erreurs").getByTestId("kpi-valeur")).toHaveText("2");
    // L'alternative textuelle : une ligne par seau, la même grille que le dessin.
    const alternative = temps.getByTestId("alternative");
    await alternative.locator("summary").click();
    expect(await alternative.locator("tbody tr").count()).toBeGreaterThanOrEqual(24);
    // L'Explorer rejoue le panneau des sessions sur `seg=v2:runtime:eq:react_native` (B8).
    const explorer = temps.getByRole("link", { name: "Ouvrir dans l'Explorer" });
    await expect(explorer).toHaveAttribute("href", /dataset=sessions/);
    await expect(explorer).toHaveAttribute("href", /seg=v2%3Aruntime%3Aeq%3Areact_native/);
    await expect(page.locator("body")).not.toContainText("(B8)");
  });

  test("sans donnée React Native : l'état vide motivé, aucun axe dessiné", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrirF39(page, APP_F39_WEB);
    const temps = page.locator("#mobile-temps");
    await temps.scrollIntoViewIfNeeded();
    await expect(temps).toHaveAttribute("data-etat", "vide");
    await expect(temps).toContainText("Aucune session React Native commencée");
    await expect(temps).toContainText("un axe plat se lirait comme une période calme");
    await expect(temps.locator(".recharts-wrapper")).toHaveCount(0);
    await expect(temps.locator("svg")).toHaveCount(0);
  });

  test("la cohorte s'ouvre sur /sessions et sur /pages, filtre appliqué de bout en bout", async ({ page }) => {
    test.skip(!v82, "migration v82 absente de la base e2e");
    await ouvrirF39(page, APP_F39);

    // /sessions : la liste et ses tuiles lisent `seg=v2:runtime:eq:react_native` — 3 sessions, pas 4.
    await page.getByTestId("mobile-lien-sessions").click();
    await page.waitForURL(
      (u) => u.pathname === "/sessions" && u.searchParams.get("seg") === "v2:runtime:eq:react_native" && u.searchParams.get("app") === APP_F39,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
    await expect(page.getByTestId("segment-chip").filter({ hasText: "Runtime = react_native" })).toBeVisible();
    await expect(
      page.getByTestId("kpi-sessions").locator('[data-testid="kpi-tile"][aria-label^="Sessions commencées"]').getByTestId("kpi-valeur"),
    ).toHaveText("3");

    // /pages : un écran consulté ouvre sa route ET la cohorte — la page vue web de même route n'y entre pas.
    await page.goto(`${consoleUrl}/mobile?app=${APP_F39}&period=24h`);
    const ecran = page.locator('#mobile-ecrans a[href^="/pages?"]').first();
    await expect(ecran).toHaveAttribute("href", /seg=v2%3Aruntime%3Aeq%3Areact_native/);
    await ecran.click();
    await page.waitForURL(
      (u) => u.pathname === "/pages" && u.searchParams.get("route") === ROUTE_F39 && u.searchParams.get("seg") === "v2:runtime:eq:react_native",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("filter-problem")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("segment-chip").filter({ hasText: "Runtime = react_native" })).toBeVisible();
  });
});
