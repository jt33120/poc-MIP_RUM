// E2E — les deux écrans ajoutés le 09/09/2026 : « Comparaison par version »
// (Vue d'ensemble) et « Scripts qui bloquent le fil principal » (/ux).
//
// POURQUOI UN E2E ET PAS UN TEST UNITAIRE. Les décisions de lecture sont
// vérifiées ailleurs, en pur (tests/unit/versions.test.ts). Ce qui ne peut pas
// l'être, c'est le SQL : les deux requêtes sont en `try/catch` qui rend un
// tableau vide — c'est le motif du dépôt, et il a une contrepartie. Une faute de
// frappe, une colonne renommée, une migration oubliée, et l'écran n'affiche
// RIEN, sans erreur, sans journal. Un bloc vide se lit comme « pas de données ».
//
// Ce spec écrit des lignes réelles dans un vrai PostgreSQL, ouvre la console et
// lit ce que l'utilisateur lit. C'est le seul niveau où la question « la requête
// s'exécute-t-elle ? » a une réponse.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import pg from "pg";

const APP_ID = "app-versions-e2e";
const E2E_EMAIL = "e2e-versions@mip-rum.local";
const E2E_PASSWORD = "e2e-versions-mdp-local";

function bcryptHash(password: string): string {
  return execFileSync(
    "node",
    [
      "-e",
      `const { createRequire } = require("node:module");
       const req = createRequire(process.cwd() + "/apps/console/package.json");
       const m = req("bcryptjs");
       const bcrypt = m.hashSync ? m : m.default;
       process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
      password,
    ],
    { encoding: "utf8" },
  );
}

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

/** Deux versions au volume et au taux d'erreur DIFFÉRENTS, et des frames LoAF. */
async function semer() {
  // Re-runnable : on repart d'une app propre.
  for (const t of ["rum_longtask", "rum_error", "rum_metric", "rum_pageview", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`delete from app_registry where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Versions E2E')
     on conflict (app_id) do nothing`,
    [APP_ID],
  );

  // 1.4.2 : 10 sessions, 1 en erreur (10 %). 1.5.0 : 6 sessions, 3 en erreur (50 %).
  const plan = [
    { release: "1.4.2", n: 10, enErreur: 1, lcp: 1800 },
    { release: "1.5.0", n: 6, enErreur: 3, lcp: 3400 },
  ];
  for (const p of plan) {
    for (let i = 0; i < p.n; i++) {
      const sid = `${APP_ID}-${p.release}-${i}`;
      await pool.query(
        // Un visiteur distinct par session : ce que le SDK émet depuis
        // migration-v57. `user_hash` n'est plus produit, donc plus semé ici.
        `insert into rum_session (session_id, app_id, visitor_id, release, device_type, is_bot, started_at, last_seen_at, page_count)
         values ($1, $2, $1, $3, 'desktop', false, now() - interval '10 minutes', now() - interval '10 minutes', 1)
         on conflict (session_id) do nothing`,
        [sid, APP_ID, p.release],
      );
      // La release est portée par CHAQUE signal (migration-v75) : c'est elle que
      // lit la comparaison par version, et non plus celle de la session.
      await pool.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, release, started_at)
         values ($1, $2, $3, '/', $4, now() - interval '10 minutes')
         on conflict (span_id) do nothing`,
        [`${sid}-pv`, sid, APP_ID, p.release],
      );
      await pool.query(
        `insert into rum_metric (span_id, session_id, app_id, route, release, name, value, rating, ts)
         values ($1, $2, $3, '/', $4, 'LCP', $5, 'good', now() - interval '10 minutes')
         on conflict (span_id) do nothing`,
        [`${sid}-lcp`, sid, APP_ID, p.release, p.lcp],
      );
      if (i < p.enErreur) {
        await pool.query(
          `insert into rum_error (span_id, session_id, app_id, route, release, kind, message, ts)
           values ($1, $2, $3, '/', $4, 'error', 'boom', now() - interval '10 minutes')
           on conflict (span_id) do nothing`,
          [`${sid}-err`, sid, APP_ID, p.release],
        );
      }
    }
  }

  // Frames LoAF : deux scripts, dont un qui bloque plus SOUVENT mais moins fort.
  // C'est le cas qui distingue un classement par cumul d'un classement par pire
  // cas — et le tableau annonce le cumul.
  const frames = [
    { url: "https://app.e2e.fr/widget-tiers.js", fn: "", invoker: "Window.setTimeout", n: 8, ms: 60 },
    { url: "https://app.e2e.fr/panier.js", fn: "recalculerTotal", invoker: "BUTTON#payer.onclick", n: 1, ms: 300 },
  ];
  for (const fr of frames) {
    for (let i = 0; i < fr.n; i++) {
      await pool.query(
        `insert into rum_longtask
           (span_id, session_id, app_id, route, duration_ms, source, blocking_ms, script_url, script_function, script_ms, invoker, ts)
         values ($1, $2, $3, '/panier', $4::float8, 'loaf', $4::real, $5, $6, $4::real, $7, now() - interval '5 minutes')
         on conflict (span_id) do nothing`,
        [
          `${APP_ID}-loaf-${fr.fn || "anon"}-${i}`,
          `${APP_ID}-1.4.2-0`,
          APP_ID,
          fr.ms,
          fr.url,
          fr.fn,
          fr.invoker,
        ],
      );
    }
  }
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function loginConsole(page: Page) {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test("comparaison par version : les deux releases, leur LCP et leur taux d'erreur", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`http://localhost:3000/?app=${APP_ID}&period=24h`);

  // F13 : la table des versions vit dans « Toutes les versions » de `ReleaseCompare`,
  // qui nomme LUI AUSSI les releases comparées — un `section` repéré par son texte, ou
  // un `tr` cherché dans toute la zone, en trouverait deux. On ouvre le repli, et on
  // vise la table elle-même.
  const repli = page.getByText("Toutes les versions", { exact: true });
  if (await repli.count()) await repli.first().click();
  const section = page.getByTestId("versions-table");
  await expect(section).toBeVisible({ timeout: 15_000 });

  // La version la plus VUE porte le repère « référence » — pas la plus récente :
  // 1.10 viendrait après 1.9 pour un humain, l'ordre alphabétique dit l'inverse.
  const ligneRef = section.locator("tr", { hasText: "1.4.2" });
  await expect(ligneRef).toContainText("référence");
  await expect(ligneRef).toContainText("10"); // 10 sessions
  await expect(ligneRef).toContainText("10.0 %"); // 1 session en erreur sur 10

  // 1.5.0 : 3 sur 6 = 50 %, soit +40 points face à la référence. C'est CE nombre
  // qui prouve que la requête a bien joint les erreurs aux bonnes sessions.
  const ligne150 = section.locator("tr", { hasText: "1.5.0" });
  await expect(ligne150).toContainText("50.0 %");
  await expect(ligne150).toContainText("+40.0 pt");
  await expect(ligne150).not.toContainText("référence");

  // Le LCP vient de rum_metric joint par session : 3,40 s pour 1.5.0 (formaté à
  // la française par fmtVital). Et l'INP affiche « — » : aucune mesure INP n'a
  // été semée, et une absence ne doit pas se rendre en « 0 ».
  await expect(ligne150).toContainText("3,40 s");
  await expect(ligne150).toContainText("—");
});

test("le bloc disparaît quand il n'y a qu'une version à montrer", async ({ page }) => {
  // Une « comparaison » d'une seule ligne n'apprend rien ; sur une app sans
  // `release`, elle afficherait « (non renseignée) » comme un résultat.
  //
  // La release est ramenée à une seule valeur SUR LES SIGNAUX, pas sur la session :
  // depuis P6.3 la comparaison lit la release de chaque vue, mesure et erreur.
  for (const table of ["rum_pageview", "rum_metric", "rum_error"]) {
    await pool.query(`update ${table} set release = '1.4.2' where app_id = $1`, [APP_ID]);
  }
  await loginConsole(page);
  await page.goto(`http://localhost:3000/?app=${APP_ID}&period=24h`);
  await expect(page.locator("h2", { hasText: "Comparaison par version" })).toHaveCount(0);
  // On remet le jeu de données en état pour les autres cas.
  await semer();
});

test("scripts bloquants : classés par blocage CUMULÉ, pas par pire cas", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`http://localhost:3000/ux?app=${APP_ID}&period=24h`);

  const table = page.locator("table", { hasText: "Fonction / invocation" });
  await expect(table).toBeVisible();

  // widget-tiers : 8 × 60 = 480 ms cumulés, pire cas 60.
  // panier      : 1 × 300 = 300 ms cumulés, pire cas 300.
  // Un classement par PIRE CAS mettrait panier.js en tête ; le tableau annonce
  // le cumul, donc widget-tiers doit passer devant. C'est tout l'objet du choix.
  const lignes = table.locator("tbody tr");
  await expect(lignes.first()).toContainText("widget-tiers.js");
  await expect(lignes.first()).toContainText("app.e2e.fr"); // l'hôte, sous le fichier
  await expect(lignes.first()).toContainText("480 ms");
  await expect(lignes.nth(1)).toContainText("panier.js");
  await expect(lignes.nth(1)).toContainText("300 ms");

  // L'attribution : le nom de fonction quand il existe, sinon l'invocateur.
  await expect(lignes.first()).toContainText("Window.setTimeout");
  await expect(lignes.nth(1)).toContainText("recalculerTotal");
});
