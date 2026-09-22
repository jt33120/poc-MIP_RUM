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
  await expect(page.getByTestId("mobile-sessions")).toHaveText("3");
  await expect(page.getByTestId("mobile-visiteurs")).toHaveText("3");
  // 2 occurrences JS ; les 99 de la session web ne comptent pas.
  await expect(page.getByTestId("mobile-erreurs")).toHaveText("2");
  // 1 session touchée sur 3 → 66,7 %. Le libellé porte bien « erreur JS ».
  await expect(page.getByTestId("mobile-taux-sans-erreur")).toHaveText("66,7 %");
  await expect(page.getByTestId("mobile-demarrage-froid")).toContainText("ms");
  // Aucun démarrage à chaud semé : « Non mesuré », pas « 0 ms ».
  await expect(page.getByTestId("mobile-demarrage-chaud")).toHaveText("Non mesuré");
  await expect(page.getByText("/accueil-synthetique").first()).toBeVisible();
  await expect(page.getByText("/paiement", { exact: false }).first()).toBeVisible();

  // ── 3. Pas de débordement horizontal à 390 px ──────────────────────────────
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // ── 4. Clavier : le contrôle est labellisé et atteignable ──────────────────
  const plateforme = page.getByLabel("Plateforme");
  await plateforme.focus();
  await expect(plateforme).toBeFocused();
  await expect(page.getByText("Alternative textuelle de la série")).toBeVisible();

  // ── 5. Le filtre de plateforme porte sur la COHORTE ────────────────────────
  await plateforme.selectOption("android");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page).toHaveURL(/platform=android/, { timeout: 15_000 });
  await expect(page.getByTestId("mobile-sessions")).toHaveText("1");
  // Aucune erreur JS sur Android : le taux vaut 100 %, et c'est un VRAI 100 %,
  // puisque la capacité est déclarée active sur ce périmètre.
  await expect(page.getByTestId("mobile-erreurs")).toHaveText("0");
  await expect(page.getByTestId("mobile-taux-sans-erreur")).toHaveText("100,0 %");
  await expect(page.getByText("/panier-synthetique").first()).toBeVisible();
  await expect(page.getByText("/accueil-synthetique")).toHaveCount(0);

  // ── 6. Données manquantes : une release sans aucun signal ──────────────────
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h&release=0.0.0-inexistante`);
  await expect(page.getByTestId("mobile-sessions")).toHaveText("0");
  // Aucune session : le taux n'a pas de dénominateur, et l'écran le DIT — plutôt
  // que d'afficher « 100 % », qui se lirait comme une bonne nouvelle.
  await expect(page.getByTestId("mobile-taux-sans-erreur")).toHaveText("Non calculable");
  await expect(page.getByText(/pas de d[ée]nominateur/)).toBeVisible();
  // Et les six capacités redeviennent « Inconnu » : aucune release de ce
  // périmètre n'a rien déclaré.
  await expect(page.getByTestId("capacite-js_errors")).toContainText("Inconnu");

  // ── 7. Drill-down vers les erreurs React Native, filtres conservés (F30) ───
  // CE7 : `/errors/issues` n'a pas de page (seul `/errors/issues/<id>` existe) ;
  // le lien vise la liste des erreurs, qui lit `source`. CE8 : `device=mobile`
  // ouvrait les navigateurs mobiles, pas la cohorte React Native — le lien vers
  // les sessions est désactivé avec sa raison tant que la liste ne filtre pas le
  // runtime (B8).
  await page.goto(`${consoleUrl}/mobile?app=${APP}&period=24h`);
  const lien = page.getByTestId("mobile-lien-erreurs");
  await expect(lien).toHaveAttribute("href", /^\/errors\?/);
  await expect(lien).toHaveAttribute("href", /source=react_native_js/);
  await expect(lien).toHaveAttribute("href", new RegExp(`app=${APP}`));
  await expect(page.locator('a[href="/errors/issues"], a[href^="/errors/issues?"]')).toHaveCount(0);
  const plusLoin = page.getByRole("navigation", { name: "Aller plus loin" });
  await expect(plusLoin.locator('a[href*="device=mobile"]')).toHaveCount(0);
  await expect(plusLoin.locator('a[href^="/sessions"]')).toHaveCount(0);
  await expect(page.getByTestId("mobile-lien-sessions")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("la liste des sessions ne filtre pas encore le runtime (B8)").first()).toBeVisible();
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
