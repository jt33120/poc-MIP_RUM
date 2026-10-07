// E2E — l'escalade des alertes sur /alerts (migration-v108).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un déclenchement acquitté reste « acquittée », sans heure ni délai, alors
//     que la base les garde ; et qu'un déclenchement en cours d'escalade ne dise pas
//     le niveau qu'il a atteint ;
//   - que la tuile du délai médian d'acquittement mente (un 0, ou une valeur sans
//     acquittement horodaté) ;
//   - que la section « Escalade » ne crée ni ne supprime rien de bout en bout — le
//     formulaire, la commande, la ligne dense, son détail au clic, la suppression
//     confirmée ;
//   - qu'elle déborde à 390 px.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const APP = "e2e-escalade";
const EMAIL = "e2e-escalade@mip-rum.local";
const CIBLE = "https://hooks.exemple.fr/e2e-escalade";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

let motDePasse = "";
const ids = { ouvert: 0, acquitte: 0, canal: 0 };

/**
 * Une règle, un canal, une étape de niveau 1 à 5 min créée il y a trois heures, et
 * deux déclenchements : l'un acquitté 12 min après son déclenchement, l'autre
 * ouvert depuis 40 min — que `escalate_alerts()` porte au niveau 1.
 */
async function semer(): Promise<void> {
  // Déclenchements et livraisons partent en cascade avec leur règle ; les étapes, avec leur canal.
  await pool.query("delete from alert_rule where app_id = $1", [APP]);
  await pool.query("delete from notify_channel where app_id = $1", [APP]);
  await pool.query("insert into app_registry (app_id, name) values ($1, 'Escalade E2E') on conflict (app_id) do nothing", [APP]);
  const { rows: [regle] } = await pool.query<{ id: string }>(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, active, severity)
     values ($1, 'LCP', '/paiement', '>', 2500, 15, true, 'critical') returning id`,
    [APP],
  );
  const { rows: [canal] } = await pool.query<{ id: string }>(
    "insert into notify_channel (app_id, kind, target, severity_min) values ($1, 'webhook', $2, 'critical') returning id",
    [APP, CIBLE],
  );
  await pool.query(
    `insert into alert_escalation_step (app_id, severity_min, level, delay_minutes, channel_id, created_at, created_by)
     values ($1, 'warning', 1, 5, $2, now() - interval '3 hours', $3)`,
    [APP, canal.id, EMAIL],
  );
  const { rows: [acquitte] } = await pool.query<{ id: string }>(
    `insert into alert_event (rule_id, fired_at, value, message, severity, acknowledged, acknowledged_at, acknowledged_by)
     values ($1, now() - interval '2 hours', 3400, 'e2e escalade acquittée', 'critical', true,
             now() - interval '2 hours' + interval '12 minutes', $2)
     returning id`,
    [regle.id, EMAIL],
  );
  const { rows: [ouvert] } = await pool.query<{ id: string }>(
    `insert into alert_event (rule_id, fired_at, value, message, severity)
     values ($1, now() - interval '40 minutes', 3800, 'e2e escalade ouverte', 'critical') returning id`,
    [regle.id],
  );
  ids.acquitte = Number(acquitte.id);
  ids.canal = Number(canal.id);
  ids.ouvert = Number(ouvert.id);
  await pool.query("select escalate_alerts()");
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, EMAIL);
  await semer();
});

test.afterAll(async () => {
  await pool.query("delete from alert_rule where app_id = $1", [APP]);
  await pool.query("delete from notify_channel where app_id = $1", [APP]);
  await pool.end();
});

async function connexion(page: Page): Promise<void> {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  // La redirection d'après connexion doit être finie : un `goto` lancé pendant
  // qu'elle court est annulé (ERR_ABORTED). Un admin sans projet choisi (contexte
  // neuf, aucun cookie `mip-project`) atterrit sur `/` puis, par la porte projet
  // du middleware, sur `/select` : c'est la fin de la redirection, on l'attend.
  // Surtout pas `networkidle` : la console s'auto-instrumente, et un morceau de
  // rejeu part en `fetch` keepalive au moment où l'on quitte /login (pour survivre
  // à la page) ; Playwright le compte en vol sans jamais en voir la fin, et
  // l'attente expirait à 90 s (CI du 07/10/2026 : seule requête en vol après la
  // connexion, `POST /api/ingest/v1/replay` lancé 0,4 s après le clic, 15 s plus tard).
  await page.waitForURL((u) => u.pathname === "/select", { timeout: 15_000 });
}

const tuile = (page: Page, libelle: string) =>
  page.getByTestId("kpi-tile").filter({ hasText: libelle }).getByTestId("kpi-valeur");

test.describe("Escalade des alertes (v108)", () => {
  test("acquittée à HH:MM après 12 min ; l'ouverte au niveau 1 ; la tuile du délai médian", async ({ page }) => {
    await connexion(page);
    await page.goto(`${consoleUrl}/alerts?app=${APP}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(`acquittement-${ids.acquitte}`)).toHaveText(/^acquittée à \d\d:\d\d, après 12\s+min$/);
    await expect(page.getByTestId(`niveau-${ids.ouvert}`)).toHaveText("niveau 1");
    await expect(tuile(page, "Délai d'acquittement")).toHaveText(/^12\s+min$/);
    await expect(page.getByTestId("kpi-alertes")).toContainText("médiane de 1 acquittement sur 2 déclenchements");
  });

  test("créer une étape par le formulaire, l'ouvrir, la supprimer", async ({ page }) => {
    await connexion(page);
    await page.goto(`${consoleUrl}/alerts?app=${APP}#escalade`, { waitUntil: "domcontentloaded" });
    const section = page.getByTestId("escalade");
    await expect(section.getByTestId("escalade-grain")).toContainText("vérifiée à chaque passage du planificateur");
    await section.locator("#nouvelle-etape > summary").click();
    const form = section.getByTestId("form-etape");
    await form.locator('select[name="app_id"]').selectOption(APP);
    await form.locator('input[name="level"]').fill("2");
    await form.locator('input[name="delay_minutes"]').fill("30");
    await form.locator('select[name="channel_id"]').selectOption(String(ids.canal));
    await form.locator('input[name="repeat_minutes"]').fill("60");
    await form.locator('input[name="repeat_max"]').fill("3");
    await form.getByTestId("create-etape").click();

    const ligne = section.locator('[data-testid^="etape-"]').filter({ hasText: "N2" });
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText("après 30 min");
    // Le détail au clic : la phrase entière, la relance du dernier niveau.
    await ligne.locator("summary").click();
    await expect(ligne).toContainText("relance à 1 h d'intervalle, 3 fois au plus");
    const id = (await ligne.getAttribute("data-testid"))!.replace("etape-", "");
    // Le déclencheur est un composant client : tant qu'il n'est pas hydraté, un clic
    // n'ouvre rien. On réessaie jusqu'à voir la confirmation.
    await expect(async () => {
      await ligne.getByTestId(`delete-etape-${id}`).click();
      await expect(page.getByTestId(`delete-etape-${id}-confirmer`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByTestId(`delete-etape-${id}-confirmer`).click();
    await expect(section.locator(`[data-testid="etape-${id}"]`)).toHaveCount(0);
    // L'étape semée (niveau 1) reste ; une étape GLOBALE d'une autre recette pourrait s'y ajouter.
    await expect(section.locator('[data-testid^="etape-"]').filter({ hasText: "N2" })).toHaveCount(0);
    await expect(section.locator('[data-testid^="etape-"]').filter({ hasText: "après 5 min" })).toHaveCount(1);
  });

  test("aucun débordement à 390 et 1440 px, détail ouvert", async ({ page }) => {
    await connexion(page);
    for (const largeur of [390, 1440]) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/alerts?app=${APP}#escalade`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("escalade").locator('[data-testid^="etape-"] summary').first().click();
      expect(await debordements(page), `/alerts à ${largeur} px`).toEqual([]);
    }
  });
});
