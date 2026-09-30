// E2E — L'INSCRIPTION EN LIBRE-SERVICE (30/09/2026), de bout en bout, console
// BRANCHÉE sur console-api (`INSCRIPTIONS_PAR_JOUR` posé dans playwright.config.ts) :
//
//   · le parcours : /inscription → le formulaire → la page d'installation du site
//     créé, sa clé d'ingestion affichée UNE fois (remise par le formulaire, jamais
//     par l'URL), sans lien d'administration ; en base, un compte LECTEUR de ce
//     seul site et un site au débit plafonné ; connecté, /inscription renvoie à la
//     console ;
//   · une session de DÉMO peut s'inscrire : sa borne « lecture seule » excepte
//     /inscription, et le cookie du compte créé remplace le sien ;
//   · un refus : le mot de passe trop court, refusé côté SERVEUR (l'action de la
//     console, avec les règles que console-api applique aussi) même quand le
//     navigateur ne l'arrête pas, et dit sans qu'aucune saisie passe dans l'URL.
//
// Chaque test se présente sous sa propre adresse IP (`x-forwarded-for`, que la
// console transmet comme Vercel le poserait), dans son propre /64 — le service
// compte une IPv6 par son /64 : le plafond de 3 tentatives par heure ne bloque pas
// un second passage. Les comptes créés sont effacés.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { sessionConsoleApi } from "./helpers/session-console-api";

const CONSOLE = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum" });
const hex = (n: number) => randomBytes(n).toString("hex");
/** Une adresse de test unique par exécution, dans un domaine qui n'existe pas. */
const adresse = () => `e2e-inscription-${hex(4)}@mip-rum.local`;
const crees: string[] = [];
const DEMO = `e2e-inscription-demo-${hex(3)}@mip-rum.local`;

/** Une IPv6 de documentation (2001:db8::/32), dans un /64 neuf à chaque test. */
async function sousUneIpNeuve(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `2001:db8:${hex(2)}:${hex(2)}::1` });
}

async function remplir(page: Page, champs: { email: string; mot_de_passe: string }) {
  await page.goto(`${CONSOLE}/inscription`);
  await expect(page.getByTestId("inscription-form")).toBeVisible();
  await page.fill('input[name="email"]', champs.email);
  await page.fill('input[name="mot_de_passe"]', champs.mot_de_passe);
  await page.fill('input[name="nom_site"]', "Boutique E2E");
  await page.fill('input[name="url_site"]', "https://boutique-e2e.exemple.fr/accueil");
  await page.check('input[name="conditions"]');
}

test.afterAll(async () => {
  await pool.query("delete from console_session where demo_email = $1", [DEMO]);
  if (crees.length) {
    await pool.query("delete from console_session where user_id in (select id from console_user where email = any($1))", [crees]);
    await pool.query("delete from console_user where email = any($1)", [crees]);
    await pool.query("delete from app_registry where created_by = any($1)", [crees]);
  }
  await pool.end();
});

test("inscription : compte et site en une fois, la clé affichée une fois sur la page d'installation", async ({ page }) => {
  await sousUneIpNeuve(page);
  const email = adresse();
  crees.push(email);
  await remplir(page, { email, mot_de_passe: `e2e-${hex(8)}` });
  await page.getByTestId("inscription-envoyer").click();

  await page.waitForURL((u) => u.pathname === "/select/new" && u.searchParams.get("cree") === "1", { timeout: 30_000 });
  const app = new URL(page.url()).searchParams.get("app")!;
  expect(app).toMatch(/^boutique-e2e-[0-9a-f]{4}$/);
  await expect(page.getByTestId("one-time-key")).toBeVisible();
  await expect(page.getByTestId("generated-key")).toHaveText(/^mip_[0-9a-f]{32}$/);
  const cle = (await page.getByTestId("generated-key").textContent())!;
  // La clé ne passe jamais par l'URL.
  expect(page.url()).not.toContain(cle);
  // Un lecteur : aucun lien vers l'administration (fiche du projet, domaines).
  await expect(page.locator('a[href^="/admin/"]')).toHaveCount(0);

  // En base : LECTEUR de CE site seul, et un site au débit plafonné.
  const compte = (await pool.query("select role, apps, inscrit_le from console_user where email = $1", [email])).rows[0];
  expect(compte).toMatchObject({ role: "viewer", apps: [app] });
  expect(compte.inscrit_le).not.toBeNull();
  const site = (await pool.query("select allowed_origins, debit_max_min, created_by from app_registry where app_id = $1", [app])).rows[0];
  expect(site).toEqual({ allowed_origins: ["https://boutique-e2e.exemple.fr"], debit_max_min: 120, created_by: email });

  // Affichée UNE fois : rechargée, la page ne la montre plus.
  await page.reload();
  await expect(page.getByTestId("one-time-key")).toHaveCount(0);

  // Connecté, l'inscription renvoie à la console.
  await page.goto(`${CONSOLE}/inscription`);
  await expect(page).not.toHaveURL(/\/inscription/);
});

test("inscription : un mot de passe trop court est refusé côté serveur, sans rien créer ni rien mettre dans l'URL", async ({ page }) => {
  await sousUneIpNeuve(page);
  const email = adresse();
  crees.push(email);
  await remplir(page, { email, mot_de_passe: "court" });
  // Le navigateur l'arrêterait (`minlength`) : on le retire, c'est le serveur qu'on éprouve.
  await page.locator('input[name="mot_de_passe"]').evaluate((el) => el.removeAttribute("minlength"));
  await page.getByTestId("inscription-envoyer").click();

  await page.waitForURL((u) => u.pathname === "/inscription" && u.searchParams.get("erreur") === "mot_de_passe");
  await expect(page.getByTestId("inscription-erreur")).toContainText("12 caractères au moins");
  expect(page.url()).not.toContain(encodeURIComponent(email));
  expect(page.url()).not.toContain("court");
  expect((await pool.query("select count(*)::int as n from console_user where email = $1", [email])).rows[0].n).toBe(0);
});

test("inscription depuis une session de démo : permise, et le compte créé remplace la démo", async ({ page, context }) => {
  await sousUneIpNeuve(page);
  const jeton = await sessionConsoleApi(pool, { email: DEMO, role: "viewer", apps: ["demo-app"], demo: true });
  await context.addCookies([{ name: "mip_session", value: jeton, url: CONSOLE }]);
  const email = adresse();
  crees.push(email);
  // La démo n'est pas renvoyée à la console : elle voit le formulaire.
  await remplir(page, { email, mot_de_passe: `e2e-${hex(8)}` });
  await page.getByTestId("inscription-envoyer").click();
  // /select/new est fermé à une démo : y arriver, clé affichée, prouve que la session a changé.
  await page.waitForURL((u) => u.pathname === "/select/new" && u.searchParams.get("cree") === "1", { timeout: 30_000 });
  await expect(page.getByTestId("generated-key")).toHaveText(/^mip_[0-9a-f]{32}$/);
});
