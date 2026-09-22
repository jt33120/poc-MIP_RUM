// E2E — Journal `/events` (F25, plan § 5.23), étendu depuis la recette P4.
//
// Ce que ce spec garantit : un filtre typé ne laisse passer que sa population
// (appareil, plage, attribut exact) ; l'échantillonnage est dit ; les facettes
// POSENT les champs du formulaire (nom → `name`, attribut → `attr_source` +
// `attr_key`, valeur → `attr_type` + `attr_value`) sans ressaisie ; une ligne ouvre
// son panneau ; à 390 px la table devient des cartes où la date et le nom restent
// visibles ; aucun débordement à 390, 768 et 1440 px.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements, LARGEURS } from "./helpers/debordements";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-events-explorer@mip-rum.local";
let adminPassword = "";

test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(`insert into rum_session (session_id,app_id,device_type,sample_rate,error_sample_rate)
                    values ('p4-e2e-session','demo-app','mobile',0.5,1)
                    on conflict (session_id) do update set last_seen_at=now(),device_type='mobile',sample_rate=0.5`);
  await pool.query(`insert into rum_session (session_id,app_id,device_type,sample_rate,error_sample_rate)
                    values ('p4-e2e-desktop','demo-app','desktop',1,1)
                    on conflict (session_id) do update set last_seen_at=now(),device_type='desktop',sample_rate=1`);
  await pool.query(`insert into rum_event (span_id,session_id,app_id,route,name,props,context,ts)
                    values ('000000000000e401','p4-e2e-session','demo-app','/checkout-a','checkout',
                            '{"plan":"pro","amount":42}', '{"campaign":"fall"}', now()),
                           ('000000000000e402','p4-e2e-session','demo-app','/checkout-b','checkout',
                            '{"plan":"pro","amount":12}', '{"campaign":"fall"}', now()),
                           ('000000000000e403','p4-e2e-desktop','demo-app','/desktop-excluded','checkout',
                            '{"plan":"pro"}', '{"campaign":"fall"}', now()),
                           ('000000000000e404','p4-e2e-session','demo-app','/old-excluded','checkout',
                            '{"plan":"pro"}', '{"campaign":"fall"}', now()-interval '2 hours')
                    on conflict (span_id) do nothing`);
  await pool.query(`insert into rum_event_index (app_id,session_id,ts,route,kind,source_name,source_span_id)
                    values ('demo-app','p4-e2e-session',now(),'/checkout-a','event','track','000000000000e401'),
                           ('demo-app','p4-e2e-session',now(),'/checkout-b','event','track','000000000000e402'),
                           ('demo-app','p4-e2e-desktop',now(),'/desktop-excluded','event','track','000000000000e403'),
                           ('demo-app','p4-e2e-session',now()-interval '2 hours','/old-excluded','event','track','000000000000e404')
                    on conflict (app_id,kind,source_span_id) do nothing`);
});

test.afterAll(async () => {
  await pool.query("delete from rum_event_index where source_span_id in ('000000000000e401','000000000000e402','000000000000e403','000000000000e404')");
  await pool.query("delete from rum_event where span_id in ('000000000000e401','000000000000e402','000000000000e403','000000000000e404')");
  await pool.query("delete from rum_session where session_id in ('p4-e2e-session','p4-e2e-desktop')");
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: "demo-app", url: consoleUrl }]);
}

/** Le chiffre de la tuile « Total observé ». */
const total = (page: Page) => page.getByTestId("events-total").getByTestId("kpi-valeur");
const FILTRE_COMPLET =
  "app=demo-app&period=1h&device=mobile&name=checkout&attr_source=props&attr_key=plan&attr_type=string&attr_value=pro";

test("Journal : filtre typé, échantillonnage, clavier, cartes à 390 px et page suivante", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`${consoleUrl}/events?${FILTRE_COMPLET}&limit=1`);
  await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();
  // Échantillonnage dit, jamais corrigé (R-E) : la session mobile est tirée à 50 %.
  const bandeau = page.getByTestId("bandeau-echantillonnage");
  await expect(bandeau).toContainText(/au moins 50/);
  await expect(bandeau).toContainText("comptes observés, non extrapolés");
  await expect(total(page)).toHaveText("2");

  // À 390 px, chaque ligne est une CARTE : nom, date et route lisibles sans défiler.
  const table = page.getByTestId("journal-table");
  const carte = table.getByTestId("journal-ligne").first();
  await expect(carte.getByRole("link", { name: "checkout", exact: true })).toBeVisible();
  await expect(carte.getByText(/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} UTC/)).toBeVisible();
  await expect(carte.getByText("/checkout-b", { exact: true })).toBeVisible();
  await expect(carte.getByRole("link", { name: /p4-e2e/ })).toBeVisible();
  // Colonne promue (clé sur 100 % des lignes de la page), libellée dans la carte.
  await expect(carte.getByText("props.plan", { exact: true })).toBeVisible();
  await expect(page.getByText("/desktop-excluded", { exact: true })).toHaveCount(0);
  await expect(page.getByText("/old-excluded", { exact: true })).toHaveCount(0);

  const name = page.getByLabel("Nom d’événement");
  await name.focus();
  await expect(name).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Source attribut")).toBeFocused();
  // Le volume a son alternative textuelle (une ligne par seau).
  await expect(page.locator("#volume-du-resultat").getByText("Alternative textuelle")).toBeVisible();
  expect(await debordements(page)).toEqual([]);

  const next = await page.getByRole("link", { name: "Événements suivants" }).getAttribute("href");
  expect(next).toMatch(/cursor=/);
  await page.goto(new URL(next!, consoleUrl).toString());
  await expect(page).toHaveURL(/cursor=/, { timeout: 15_000 });
  await expect(table.getByText("/checkout-a", { exact: true })).toBeVisible();
  await expect(table.getByText("/checkout-b", { exact: true })).toHaveCount(0);
});

test("facettes cliquables : un nom pose `name`, un attribut pose `attr_source` + `attr_key`, une valeur complète le filtre", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile`);
  const facettes = page.getByTestId("facettes");

  // Nom : la barre EST le lien ; le filtre se pose sans ressaisie.
  await facettes.getByRole("link", { name: "checkout", exact: true }).click();
  await expect(page).toHaveURL(/[?&]name=checkout(&|$)/, { timeout: 15_000 });
  await expect(page.getByLabel("Nom d’événement")).toHaveValue("checkout");

  // Attribut : source et clé posées (noms des champs du formulaire, CP18), sans valeur.
  await page.getByTestId("facette-attributs").getByRole("link", { name: /props\.plan/ }).click();
  await expect(page).toHaveURL(/attr_source=props/, { timeout: 15_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("attr_key")).toBe("plan");
  expect(url.searchParams.get("name")).toBe("checkout");
  expect(url.searchParams.has("attr_value")).toBe(false);
  await expect(page.getByLabel("Source attribut")).toHaveValue("props");
  await expect(page.getByLabel("Clé", { exact: true })).toHaveValue("plan");
  // Une clé sans valeur ne filtre rien : même total que le nom seul.
  await expect(total(page)).toHaveText(/^\d/);

  // Valeur : la puce sous « Valeur exacte » pose type et valeur.
  await page.getByTestId("puces-valeurs").getByRole("link", { name: /^pro/ }).click();
  await expect(page).toHaveURL(/attr_value=pro/, { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get("attr_type")).toBe("string");
  await expect(page.getByLabel("Valeur exacte")).toHaveValue("pro");
  await expect(total(page)).toHaveText("2");

  // Colonnes promues : les clés portées par toute la page deviennent des colonnes.
  await expect(page.getByTestId("journal-table").locator("thead").getByText("props.plan", { exact: true })).toBeVisible();

  // Ligne → panneau d'événement ; « Voir le contexte » y vit désormais ; Échap ferme.
  await page.getByTestId("journal-table").getByRole("link", { name: "checkout", exact: true }).first().click();
  await expect(page).toHaveURL(/panel=event%3A\d+/, { timeout: 15_000 });
  const panneau = page.getByTestId("detail-panel");
  await expect(panneau).toBeVisible();
  await expect(panneau).toHaveAttribute("data-type", "event");
  await expect(panneau.getByText("Voir le contexte")).toBeVisible();
  await expect(panneau.getByText(/"plan": "pro"/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/panel=/, { timeout: 15_000 });
  await expect(page.getByTestId("detail-panel")).toHaveCount(0);
});

test("aucun débordement à 390, 768 et 1440 px, facettes dépliées comprises", async ({ page }) => {
  await login(page);
  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.goto(`${consoleUrl}/events?${FILTRE_COMPLET}`);
    await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();
    if (largeur < 1280) {
      // Sous 1 280 px, les facettes passent sous le volume, repliées.
      await expect(page.getByTestId("facette-attributs")).toBeHidden();
      await page.getByTestId("facettes-deplier").click();
      await expect(page.getByTestId("facette-attributs")).toBeVisible();
    }
    expect(await debordements(page), `${largeur} px`).toEqual([]);
  }
});
