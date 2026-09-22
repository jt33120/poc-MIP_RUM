// E2E — les compteurs de l'écran Erreurs suivent la fenêtre annoncée.
// Finding 1.1 de docs/AUDIT_RUM_EXTERNE.md.
//
// POURQUOI UN E2E. Le défaut n'était PAS une erreur de calcul : chaque requête
// rendait un nombre exact. Il était dans l'écart entre le NOMBRE et son
// LIBELLÉ — la tuile disait « Occurrences · 1 h » et affichait le cumul depuis
// la première ingestion. Un test unitaire ne peut pas voir ça : il faudrait
// qu'il connaisse déjà la bonne réponse. Ici on fait ce que fait l'exploitant,
// on bascule la période, et on regarde si le nombre bouge.
//
// LE JEU DE DONNÉES est construit pour que les trois défauts se voient d'un
// coup :
//
//   fp-vieux   400 occurrences il y a 5 jours, UNE personne  → volume, zéro impact
//   fp-jour     10 occurrences il y a 20 min, DIX personnes  → impact réel
//
// Sur 24 h, l'ancien écran affichait 410 occurrences et classait `fp-vieux` en
// tête. La vérité sur 24 h est 10 occurrences, et `fp-jour` seul.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import pg from "pg";

const APP_ID = "app-erreurs-fenetre-e2e";
const E2E_EMAIL = "e2e-erreurs@mip-rum.local";
const E2E_PASSWORD = "e2e-erreurs-mdp-local";
const FP_VIEUX = "fpvieux1";
const FP_JOUR = "fpjour01";

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

async function semer() {
  for (const t of ["rum_error", "rum_session"])
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`delete from app_registry where app_id = $1`, [APP_ID]);
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Erreurs fenêtre E2E')
     on conflict (app_id) do nothing`,
    [APP_ID],
  );

  // Le bruit : beaucoup d'occurrences, une seule personne, hors des 24 h.
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, started_at, last_seen_at, page_count)
     values ($1, $2, 'vis-bruit', 'desktop', now() - interval '5 days', now() - interval '5 days', 1)
     on conflict (session_id) do nothing`,
    [`${APP_ID}-vieux`, APP_ID],
  );
  for (let i = 0; i < 400; i++) {
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, error_type, message, fingerprint, ts)
       values ($1, $2, $3, '/', 'error', 'RangeError', 'bug de la semaine derniere', $4, now() - interval '5 days')
       on conflict (span_id) do nothing`,
      [`${APP_ID}-v-${i}`, `${APP_ID}-vieux`, APP_ID, FP_VIEUX],
    );
  }

  // Le signal : peu d'occurrences, dix personnes, dans les 24 h ET dans l'heure.
  for (let i = 0; i < 10; i++) {
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, $3, 'desktop', now() - interval '20 minutes', now() - interval '20 minutes', 1)
       on conflict (session_id) do nothing`,
      [`${APP_ID}-j-${i}`, APP_ID, `vis-jour-${i}`],
    );
    await pool.query(
      `insert into rum_error (span_id, session_id, app_id, route, kind, error_type, message, fingerprint, ts)
       values ($1, $2, $3, '/checkout', 'error', 'TypeError', 'regression du jour', $4, now() - interval '20 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_ID}-j-${i}`, `${APP_ID}-j-${i}`, APP_ID, FP_JOUR],
    );
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

const occurrencesDe = (page: Page, fp: string) =>
  page.locator(`[data-testid="error-group-${fp}"] [data-testid="group-occurrences"]`);

test("les compteurs suivent la fenêtre — et le vieux bug sort de l'écran", async ({ page }) => {
  await loginConsole(page);

  // ── 7 jours : tout est là ────────────────────────────────────────────────
  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=7d`);
  await expect(page.locator(`[data-testid="error-group-${FP_VIEUX}"]`)).toBeVisible();
  await expect(occurrencesDe(page, FP_VIEUX)).toHaveText("400");
  await expect(occurrencesDe(page, FP_JOUR)).toHaveText("10");

  // ── 24 heures : le bug d'il y a 5 jours DISPARAÎT ────────────────────────
  // C'est le cœur du finding. Avant, il restait là avec ses 400 occurrences,
  // sous une tuile qui annonçait « 24 h ».
  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=24h`);
  await expect(page.locator(`[data-testid="error-group-${FP_JOUR}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="error-group-${FP_VIEUX}"]`)).toHaveCount(0);
  await expect(occurrencesDe(page, FP_JOUR)).toHaveText("10");
});

test("la tuile d'occurrences dit la vérité sur sa propre fenêtre", async ({ page }) => {
  await loginConsole(page);

  // Depuis F18, la tuile s'appelle « Occurrences » et la fenêtre est écrite en tête
  // de la rangée (« Occurrences d'erreurs sur 7 j »). On lit LA VALEUR de la tuile
  // et la fenêtre annoncée : c'est justement l'écart entre les deux qui était le défaut.
  const valeur = (p: Page) =>
    p.getByTestId("kpi-tile").filter({ has: p.getByText("Occurrences", { exact: true }) }).getByTestId("kpi-valeur");

  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=7d`);
  await expect(page.getByTestId("kpi-erreurs-plage")).toContainText("7 j");
  await expect(valeur(page)).toHaveText("410");

  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=24h`);
  await expect(page.getByTestId("kpi-erreurs-plage")).toContainText("24 h");
  // 10, et surtout PAS 410 : le nombre a suivi la fenêtre annoncée.
  await expect(valeur(page)).toHaveText("10");
});

test("le classement suit l'impact, pas le volume cumulé", async ({ page }) => {
  await loginConsole(page);
  // Sur 7 jours les deux groupes coexistent : c'est là que le critère de tri se
  // voit. `fp-vieux` a 40× plus d'occurrences, `fp-jour` touche 10× plus de
  // personnes. L'ancien tri (occurrences desc) mettait le bruit en tête.
  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=7d`);
  const lignes = page.locator('[data-testid^="error-group-"]');
  await expect(lignes.first()).toHaveAttribute("data-testid", `error-group-${FP_JOUR}`);
});

test("« Première vue » reste la vraie première apparition, hors fenêtre", async ({ page }) => {
  await loginConsole(page);
  // Sur une fenêtre d'1 h, le groupe du jour est visible et sa première
  // apparition (il y a 20 min) est ANTÉRIEURE au bord de la fenêtre pour le
  // groupe ancien — qui, lui, n'est plus là. Ce qu'on vérifie ici, c'est que
  // la colonne annonce sa portée au lieu de laisser croire qu'elle est bornée.
  await page.goto(`http://localhost:3000/errors?app=${APP_ID}&period=1h`);
  await expect(page.getByRole("columnheader", { name: /Première vue/ })).toContainText(
    "depuis toujours",
  );
});
