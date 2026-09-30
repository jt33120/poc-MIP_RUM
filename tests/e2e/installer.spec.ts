// E2E — la page « Installer » (`/installer`).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Une page réservée aux administrateurs : le lecteur visé est le CLIENT. Un
//     compte en lecture seule, limité à son application, doit la lire (et n'y voir
//     aucun lien vers la fiche d'administration).
//   - Un test « ça arrive » qui ne passe pas au vert quand les données sont là, ou
//     qui continue d'interroger la base une fois tout vert.
//   - Une check-list qui ne se coche pas au clic, ou dont le compteur ment.
//   - Un avertissement de l'extension (clé exigée, extension sans clé) qui ne
//     s'affiche pas en tête de son parcours.
//   - Un débordement horizontal à 390 px (codes et adresses longues).
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une application dédiée, avec un compte
// dédié (helpers/compte-dedie.ts), passé en lecture seule sur cette application.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const APP = "installer-e2e";
const EMAIL = "e2e-installer@mip-rum.local";
const DOMAINE = "installer-e2e.exemple";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasse = "";

async function nettoyer() {
  await pool.query("delete from rum_metric where app_id = $1", [APP]);
  await pool.query("delete from rum_session where app_id = $1", [APP]);
  await pool.query("delete from extension_scope where app_id = $1", [APP]);
}

test.beforeAll(async () => {
  motDePasse = await compteDedie(pool, EMAIL);
  // Le client : lecture seule, sur SON application seulement.
  await pool.query("update console_user set role = 'viewer', apps = array[$2]::text[] where email = $1", [EMAIL, APP]);
  await pool.query(
    `insert into app_registry (app_id, name, allowed_origins, api_key_hash)
     values ($1, 'Application e2e', array[$2]::text[], repeat('0', 64))
     on conflict (app_id) do update set allowed_origins = excluded.allowed_origins, api_key_hash = excluded.api_key_hash, active = true`,
    [APP, `https://${DOMAINE}`],
  );
  await nettoyer();
  await pool.query("insert into extension_scope (domain, app_id) values ($1, $2)", [DOMAINE, APP]);
  // Une session du code de suivi et sa première Web Vital : le test « ça arrive » du
  // parcours « Code de suivi » est donc tout vert dès le premier rendu.
  await pool.query(
    `insert into rum_session (session_id, app_id, collection_source, started_at, last_seen_at, page_count)
     values ('installer-e2e-s1', $1, 'sdk', now() - interval '2 minutes', now() - interval '1 minute', 1)`,
    [APP],
  );
  await pool.query(
    `insert into rum_metric (session_id, app_id, route, name, value, rating, ts)
     values ('installer-e2e-s1', $1, '/', 'LCP', 1800, 'good', now() - interval '1 minute')`,
    [APP],
  );
});

test.afterAll(async () => {
  await nettoyer();
  await pool.query("delete from app_registry where app_id = $1", [APP]);
  // Le compte reste (comme ceux des autres specs) : ses sessions le référencent.
  await pool.end();
});

async function ouvrir(page: Page, largeur: number, suffixe = "") {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  await page.goto(`${consoleUrl}/installer?app=${APP}${suffixe}`);
  await expect(page.getByTestId("installer")).toBeVisible();
}

test("le client lit la page : trois cartes, ses valeurs, et le test du code de suivi au vert", async ({ page }) => {
  await ouvrir(page, 390);
  await expect(page.getByRole("heading", { name: "Installer", level: 1 })).toBeVisible();
  await expect(page.getByTestId("choix-parcours").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("personnalisation-snippet")).toContainText(APP);
  await expect(page.getByTestId("personnalisation-snippet")).toContainText(`https://${DOMAINE}`);
  // Lecture seule : aucun lien vers la fiche d'administration.
  await expect(page.getByTestId("lien-fiche")).toHaveCount(0);

  // Le parcours affiché par défaut, et son test « ça arrive » : les deux cases de
  // la sonde sont vertes, et le sondage s'est arrêté.
  await expect(page.getByTestId("onglet-snippet")).toHaveAttribute("aria-selected", "true");
  const liste = page.getByTestId("checklist-snippet");
  await expect(liste.getByTestId("etape-snippet-sdk-mesures")).toHaveAttribute("data-etat", "fait");
  await expect(liste.getByTestId("etape-snippet-sdk-sessions")).toHaveAttribute("data-etat", "fait");
  await expect(page.getByTestId("parcours-snippet").getByTestId("etat-sondage")).toHaveAttribute("data-etat", "vert");
  await expect(page.getByTestId("compteur-snippet")).toContainText("2 / 10");

  // Une case se coche au clic — trouvée par son libellé, comme au clavier —, et le compteur suit.
  await liste.getByLabel(/Copier le code de suivi/).check();
  await expect(liste.getByTestId("etape-snippet-copier")).toHaveAttribute("data-etat", "fait");
  await expect(page.getByTestId("compteur-snippet")).toContainText("3 / 10");

  expect(await debordements(page)).toEqual([]);
});

test("extension et serveur : l'onglet suit l'ancre, l'avertissement de la clé est en tête", async ({ page }) => {
  await ouvrir(page, 1440);
  await page.getByTestId("onglet-extension").click();
  await expect(page).toHaveURL(/#extension$/);
  const extension = page.getByTestId("parcours-extension");
  await expect(extension).toBeVisible();
  await expect(extension.getByTestId("avertissement-extension")).toContainText("clé d'API");
  await expect(extension.getByTestId("domaines-extension")).toContainText(DOMAINE);
  await expect(extension.getByTestId("domaines-extension").locator('[data-etat="actif"]')).toHaveCount(1);
  // Aucun battement, aucune mesure : le sondage tourne (onglet visible).
  await expect(extension.getByTestId("etat-sondage")).toHaveAttribute("data-etat", /en_cours|en_pause/);

  // Un lien partagé vers un parcours l'ouvre directement.
  await page.goto(`${consoleUrl}/installer?app=${APP}#serveur`);
  await expect(page.getByTestId("onglet-serveur")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("parcours-serveur").getByTestId("recettes-agents")).toBeVisible();
});
