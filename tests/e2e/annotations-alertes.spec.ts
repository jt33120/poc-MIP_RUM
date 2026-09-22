// E2E — F67 : annotations d'alerte et liens croisés (plan § 3.7, § 3.1, § 3.3).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un déclenchement d'alerte reste invisible sur la série où il s'est
//     produit : le temps porte ses événements (P9), pas seulement les
//     déploiements.
//   - Qu'un lien vers un déclenchement PRÉCIS passe par `fired=`, qui est le
//     NOMBRE d'alertes émises par « Évaluer maintenant » et non un identifiant
//     (§ 3.1). Le paramètre est `evt`.
//   - Qu'un lien `evt=` mène à une liste où RIEN ne désigne l'événement : ici, il
//     est mis en évidence (`aria-current="true"`) et amené à l'écran par son ancre.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, sur les heures passées.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const APP_F67 = "f67-e2e-annotations";
const EMAIL_F67 = "e2e-annotations-alertes@mip-rum.local";
const consoleF67 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

let motDePasseF67 = "";
/** `alert_event.id` du déclenchement semé : c'est lui que le lien doit désigner. */
let evenementF67 = 0;

/**
 * Sème une app dont la série T7 a des points (des spans `front` sur les heures
 * passées) et UNE alerte déclenchée il y a deux heures, non acquittée. L'heure
 * choisie tombe dans la plage par défaut (24 h) quelle que soit l'heure du run.
 */
async function semerF67(): Promise<void> {
  await pool.query(
    `delete from alert_event where rule_id in (select id from alert_rule where app_id = $1)`,
    [APP_F67],
  );
  await pool.query(`delete from alert_rule where app_id = $1`, [APP_F67]);
  for (const t of ["rum_span", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = $1`, [APP_F67]);
  }
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Annotations E2E') on conflict (app_id) do nothing`,
    [APP_F67],
  );
  const session = `${APP_F67}-s1`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $1, 'desktop', false, now() - interval '6 hours', now() - interval '5 minutes', 6)
     on conflict (session_id) do nothing`,
    [session, APP_F67],
  );
  // Un appel par heure sur six heures : la série a de quoi être tracée.
  await pool.query(
    `insert into rum_span (span_id, trace_id, tier, app_id, session_id, method, url, status_code, duration_ms, route, name, ts)
     select 'f67a' || lpad(to_hex(h), 12, '0'), 'f67a' || lpad(to_hex(h), 28, '0'), 'front', $1, $2,
            'GET', '/api/f67/liste', 200, 400 + h * 20, '/f67', 'GET /api/f67/liste',
            now() - make_interval(hours => h)
       from generate_series(1, 6) as h`,
    [APP_F67, session],
  );
  const { rows: regles } = await pool.query<{ id: string }>(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, active)
     values ($1, 'LCP', null, '>', 2500, 15, true)
     returning id`,
    [APP_F67],
  );
  const { rows: evenements } = await pool.query<{ id: string }>(
    `insert into alert_event (rule_id, fired_at, value, message, acknowledged, severity)
     values ($1, now() - interval '2 hours', 3200, 'LCP p75 au-dessus du seuil (e2e F67)', false, 'critical')
     returning id`,
    [regles[0].id],
  );
  evenementF67 = Number(evenements[0].id);
}

test.beforeAll(async () => {
  motDePasseF67 = await compteDedie(pool, EMAIL_F67);
  await semerF67();
});

test.afterAll(async () => {
  await pool.end();
});

async function connexionF67(page: Page): Promise<void> {
  await page.goto(`${consoleF67}/login`);
  await page.fill('input[name="email"]', EMAIL_F67);
  await page.fill('input[name="password"]', motDePasseF67);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

test.describe("F67 — annotations d'alerte et liens croisés", () => {
  test("un clic sur une annotation d'alerte mène à /alerts?evt=<id>, événement mis en évidence", async ({ page }) => {
    await connexionF67(page);
    await page.goto(`${consoleF67}/tracing?app=${APP_F67}`, { waitUntil: "domcontentloaded" });

    // L'annotation est aussi un lien de la légende (P9 : une annotation cliquable
    // au clavier, pas seulement un triangle dans le SVG).
    const legende = page.getByTestId("legende-annotations").filter({ hasText: "Alerte LCP" }).first();
    await expect(legende).toBeVisible();
    const lien = legende.getByRole("link", { name: /^Alerte LCP/ }).first();
    const href = await lien.getAttribute("href");
    expect(href).toContain(`evt=${evenementF67}`);
    // `fired` est un NOMBRE d'alertes, jamais un identifiant (§ 3.1).
    expect(href).not.toContain("fired=");

    await lien.click();
    await page.waitForURL(
      (u) => u.pathname === "/alerts" && u.searchParams.get("evt") === String(evenementF67),
      { timeout: 15_000 },
    );
    const evenement = page.locator(`#evt-${evenementF67}`);
    await expect(evenement).toHaveAttribute("aria-current", "true");
    await expect(evenement).toBeVisible();
    await expect(evenement).toContainText("LCP p75 au-dessus du seuil (e2e F67)");
  });

  test("evt inconnu ou illisible : dit, jamais un refus ni un écran vide", async ({ page }) => {
    await connexionF67(page);

    // Hors des 100 plus récents : l'ancre n'a pas de cible, la page le dit.
    await page.goto(`${consoleF67}/alerts?app=${APP_F67}&evt=999999999`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("evt-hors-liste")).toContainText("hors des 100 plus récents");
    await expect(page.locator("body")).not.toContainText("Application error");

    // Valeur illisible : « Réglage d'affichage ignoré », et les chiffres restent.
    await page.goto(`${consoleF67}/alerts?app=${APP_F67}&evt=pas-un-entier`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("evt-ignore")).toContainText("Réglage d'affichage ignoré : evt=");
    await expect(page.locator(`#evt-${evenementF67}`)).toBeVisible();
  });

  test("aucun débordement à 390, 768 et 1440 px sur la série annotée et sur /alerts", async ({ page }) => {
    await connexionF67(page);
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const url of [
        `${consoleF67}/tracing?app=${APP_F67}`,
        `${consoleF67}/alerts?app=${APP_F67}&evt=${evenementF67}`,
      ]) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        expect(await debordements(page), `${url} à ${largeur} px`).toEqual([]);
      }
    }
  });
});
