// E2E — F49 : l'écran `/retention` (plan § 5.17).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'une période globale active laisse croire qu'elle filtre : la rétention lit
//     N semaines choisies dans l'en-tête ; la période du haut est affichée
//     DÉSACTIVÉE, avec sa raison.
//   - Qu'une semaine inachevée tire la courbe vers le bas : « Retour en S+1 » ne
//     compte que les cohortes dont la semaine S+1 est finie, et le dit.
//   - Qu'une case de la matrice montre un taux sans son effectif : chaque case écrit
//     « n / taille ».
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, avec un compte dédié
// (helpers/compte-dedie.ts). Trois cohortes :
//   A — 12 visiteurs arrivés il y a deux semaines ; 6 reviennent la semaine
//       dernière, 3 cette semaine ;
//   B — 4 visiteurs arrivés la semaine dernière (effectif faible) ; 2 reviennent
//       cette semaine (S+1 INCOMPLÈTE) ;
//   C — 2 visiteurs arrivés cette semaine.
// Les sessions passées sont posées un mercredi midi : à l'abri d'un décalage de
// fuseau de la session PostgreSQL autour du lundi 00:00.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { debordements } from "./helpers/debordements";

const APP_F49 = "f49-e2e-retention";
const EMAIL_F49 = "e2e-f49-retention@mip-rum.local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
let motDePasseF49 = "";

async function nettoyerF49() {
  await pool.query("delete from rum_session where app_id = $1", [APP_F49]);
}

/** Session identifiée ; `semaines` = semaines avant la semaine en cours (0 = maintenant). */
async function sessionF49(id: string, visiteur: string, semaines: number, device: "desktop" | "mobile") {
  const debut =
    semaines === 0
      ? "now() - interval '1 minute'"
      : `date_trunc('week', now()) - interval '${semaines} weeks' + interval '2 days 12 hours'`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $3, $4, false, ${debut}, ${debut} + interval '1 minute', 1)`,
    [id, APP_F49, visiteur, device],
  );
}

test.beforeAll(async () => {
  motDePasseF49 = await compteDedie(pool, EMAIL_F49);
  await pool.query("insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing", [APP_F49]);
  await nettoyerF49();
  for (let i = 0; i < 12; i++) {
    const device = i < 8 ? "desktop" : "mobile";
    await sessionF49(`f49-a${i}-s0`, `f49-a${i}`, 2, device);
    if (i < 6) await sessionF49(`f49-a${i}-s1`, `f49-a${i}`, 1, device);
    if (i < 3) await sessionF49(`f49-a${i}-s2`, `f49-a${i}`, 0, device);
  }
  for (let i = 0; i < 4; i++) {
    await sessionF49(`f49-b${i}-s0`, `f49-b${i}`, 1, "desktop");
    if (i < 2) await sessionF49(`f49-b${i}-s1`, `f49-b${i}`, 0, "desktop");
  }
  for (let i = 0; i < 2; i++) await sessionF49(`f49-c${i}-s0`, `f49-c${i}`, 0, "mobile");
});

test.afterAll(async () => {
  await nettoyerF49();
  await pool.query("delete from app_registry where app_id = $1", [APP_F49]);
  await pool.end();
});

/** Connexion UNE fois par test : `/login` d'une session ouverte redirige, le champ e-mail n'apparaît plus. */
async function connecter(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', EMAIL_F49);
  await page.fill('input[name="password"]', motDePasseF49);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: APP_F49, url: consoleUrl }]);
}

async function aller(page: Page, largeur: number, hauteur: number) {
  await page.setViewportSize({ width: largeur, height: hauteur });
  await page.goto(`${consoleUrl}/retention?app=${APP_F49}`);
  await expect(page.getByRole("heading", { name: "Rétention", level: 1 })).toBeVisible();
}

async function ouvrir(page: Page, largeur: number, hauteur: number) {
  await connecter(page);
  await aller(page, largeur, hauteur);
}

const tuile = (page: Page, libelle: string) => page.getByTestId("kpi-tile").filter({ hasText: libelle });

test("la période globale est affichée désactivée avec sa raison ; la fenêtre se choisit en semaines", async ({ page }) => {
  await ouvrir(page, 1440, 900);
  const periode = page.getByTestId("filter-period");
  await expect(periode).toHaveAttribute("title", /La rétention se lit sur un nombre de semaines/);
  await expect(periode.getByRole("button", { name: "24 h" })).toBeDisabled();

  const fenetres = page.getByTestId("retention-fenetre");
  await expect(fenetres).toHaveText(["4 sem.", "8 sem.", "12 sem.", "26 sem."]);
  await expect(fenetres.filter({ hasText: "8 sem." })).toHaveAttribute("aria-current", "true");
  await fenetres.filter({ hasText: "4 sem." }).click();
  await page.waitForURL((u) => u.searchParams.get("weeks") === "4", { timeout: 15_000 });
  await expect(page.getByTestId("retention-fenetre").filter({ hasText: "4 sem." })).toHaveAttribute("aria-current", "true");

  // Une fenêtre hors des quatre proposées est ignorée ET dite.
  await page.goto(`${consoleUrl}/retention?app=${APP_F49}&weeks=5`);
  await expect(page.getByTestId("reglage-ignore")).toContainText("weeks=5");
});

test("tuiles : S+1 sur les seules cohortes complètes, S+4 sans recul → « — », jamais 0", async ({ page }) => {
  await ouvrir(page, 1440, 900);
  await expect(tuile(page, "Visiteurs identifiés suivis").getByTestId("kpi-valeur")).toHaveText("18");
  // Cohorte A seule complète à S+1 : 6 / 12. La cohorte B (S+1 = cette semaine) est exclue.
  const s1 = tuile(page, "Retour en S+1");
  await expect(s1.getByTestId("kpi-valeur")).toHaveText("50,0 %");
  await expect(s1).toContainText("1 cohorte complète (2 exclues : semaine incomplète)");
  // Aucun verdict coloré : aucun seuil de rétention n'est publié.
  await expect(s1).toHaveAttribute("data-ton", "neutre");
  await expect(s1.getByTestId("kpi-verdict")).toHaveCount(0);
  const s4 = tuile(page, "Retour en S+4");
  await expect(s4.getByTestId("kpi-valeur")).toHaveText("—");
  await expect(s4).toContainText("pas encore 4 semaines complètes de recul");
  await expect(tuile(page, "Sessions sans identifiant").getByTestId("kpi-raison")).toContainText("B35");
});

test("matrice : chaque case écrit « n / taille », la semaine en cours est hachurée", async ({ page }) => {
  await ouvrir(page, 1440, 900);
  const cellules = page.getByTestId("cohorte-cellule");
  await expect(cellules).toHaveCount(6);
  for (const cellule of await cellules.all()) await expect(cellule).toContainText(/\d+ \/ \d+/);
  await expect(page.locator('[data-testid="cohorte-cellule"][data-incomplete="1"]')).toHaveCount(3);
  await expect(page.getByTestId("matrice-cohortes")).toContainText("6 / 12");
  // B (4 visiteurs) et C (2) : effectif faible ; A (12) ne l'est pas.
  await expect(page.getByTestId("matrice-cohortes").getByText("effectif faible")).toHaveCount(2);
  // L'ancienne lecture interprétative a disparu.
  await expect(page.locator("body")).not.toContainText("problème d'activation");
  // Courbe et comparaison par appareil : deux graphiques recharts.
  await page.locator("#retention-appareils").scrollIntoViewIfNeeded();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
});

test("par appareil : un lien par série ; sous device= la figure le dit au lieu de comparer", async ({ page }) => {
  await ouvrir(page, 1440, 900);
  const liens = page.getByTestId("retention-appareil-lien");
  // F53 (B31) : la lecture est sur le contrat, la tablette est lue — trois séries.
  await expect(liens).toHaveCount(3);
  await expect(liens.nth(2)).toContainText("Rétention des tablettes");
  await expect(liens.nth(2)).toHaveAttribute("href", /device=tablet/);
  await liens.first().click();
  await page.waitForURL((u) => u.searchParams.get("device") === "desktop", { timeout: 15_000 });
  await expect(page.getByTestId("retention-deja-filtre")).toContainText("Déjà filtré sur ordinateurs");
  await expect(tuile(page, "Visiteurs identifiés suivis").getByTestId("kpi-valeur")).toHaveText("12");
});

test("390, 768 et 1440 px : aucun débordement", async ({ page }) => {
  await connecter(page);
  // Toutes les largeurs sont PARCOURUES avant d'échouer : s'arrêter à la première cacherait les autres.
  const fautes: string[] = [];
  for (const [largeur, hauteur] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ] as const) {
    await aller(page, largeur, hauteur);
    await expect(page.getByTestId("matrice-cohortes")).toBeVisible();
    for (const faute of await debordements(page)) fautes.push(`/retention @ ${largeur} px — ${faute}`);
  }
  expect(fautes).toEqual([]);
});
