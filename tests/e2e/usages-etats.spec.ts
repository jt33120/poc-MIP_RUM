// E2E — F54 (plan § 6.5, § 3.8, § 3.9) : états et largeurs du domaine usages, sur
// ses sept écrans : /sessions, /sessions/[id], /acquisition, /retention, /paths,
// /forms, /map.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'une base coupée se lise, sur un écran d'usage, comme une période calme
//     (« Aucune session », une tuile à 0, un « 0 % ») ou tombe sur le message
//     anglais de Next. Attendu : « Lecture en échec », « Réessayer », et c'est la
//     frontière DE L'ÉCRAN (`app/<route>/error.tsx`) qui répond — son titre est
//     celui de l'écran, pas le filet racine « Console MIP RUM ». Avec la base
//     coupée, la vérification des filtres (`pageFilters` → sonde du schéma) ou la
//     lecture de la session échoue AVANT toute section : c'est donc l'`error.tsx`
//     de la route qui est exercé ici ; les frontières de section (`SectionErreur`,
//     `EchecLecture`) le sont par les tests unitaires des écrans.
//   - Qu'un état élargisse la page : ni l'écran en échec, ni l'écran vide ne
//     débordent à 390, 768 et 1440 px. Les largeurs AVEC données sont déjà tenues
//     écran par écran (usages-sessions, usages-sessions-panneau,
//     usages-detail-session, usages-deroule-session, usages-rejeu-session,
//     usages-acquisition, usages-parcours, usages-formulaires, usages-carte,
//     retention.spec.ts) : ce fichier ne les rejoue pas.
//   - Qu'une application sans donnée passe pour une panne, ou affiche « 0 % » :
//     lecture réussie, un état « vide » motivé, aucune « Lecture en échec », aucun
//     « Réessayer », et aucune tuile en pourcentage à 0 (sans dénominateur, V3).
//
// COMMENT LA PANNE EST SIMULÉE : le mécanisme de `etats.spec.ts` (F02), extrait dans
// `helpers/console-en-panne.ts` — la console de production déjà construite, lancée
// sur SON port (3108 par défaut, `USAGES_ETATS_E2E_PORT`) avec une base injoignable.
// Aucun interrupteur dans le code de production ; la console partagée n'est pas touchée.
//
// PRÉREQUIS : un build de la console de CETTE branche (`pnpm --filter console build`),
// que le `webServer` de playwright.config.ts produit.
//
// Données : AUCUNE. L'application de l'écran vide est dédiée à ce fichier et reste
// vide ; le compte admin est dédié (helpers/compte-dedie.ts), jamais celui de seed-admin.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { demarrerConsoleEnPanne, type ConsoleEnPanne } from "./helpers/console-en-panne";
import { debordements, LARGEURS } from "./helpers/debordements";

const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

/** Une application sans aucune donnée : la même pour les deux consoles. */
const APP_F54 = "f54-e2e-usages-etats";

/**
 * Les sept écrans. `titreEchec` : le titre que porte l'`error.tsx` de la route (le nom
 * de la navigation) ; `titreVide` : le titre de l'écran rendu ; `temoinVide` : ce qui
 * prouve que l'écran a LU un vide (et non rien lu du tout).
 */
const ECRANS_F54 = [
  { nom: "/sessions", chemin: "/sessions", titreEchec: "Sessions", titreVide: "Sessions", temoinVide: '[data-etat="vide"]' },
  {
    // Aucune session de ce nom : avec la base coupée, sa lecture échoue ; avec la
    // base, elle est introuvable (not-found français, F44).
    nom: "/sessions/[id]",
    chemin: "/sessions/f54-session-inconnue",
    titreEchec: "Détail de session",
    titreVide: "Session introuvable",
    temoinVide: '[data-testid="introuvable"]',
  },
  { nom: "/acquisition", chemin: "/acquisition", titreEchec: "Acquisition", titreVide: "Acquisition", temoinVide: '[data-etat="vide"]' },
  // La rétention garde sa carte vide motivée (coupure du 09/09/2026, § 5.17.4).
  { nom: "/retention", chemin: "/retention", titreEchec: "Rétention", titreVide: "Rétention", temoinVide: '[data-testid="retention-vide"]' },
  { nom: "/paths", chemin: "/paths", titreEchec: "Parcours", titreVide: "Parcours", temoinVide: '[data-etat="vide"]' },
  { nom: "/forms", chemin: "/forms", titreEchec: "Formulaires", titreVide: "Formulaires", temoinVide: '[data-etat="vide"]' },
  { nom: "/map", chemin: "/map", titreEchec: "Carte", titreVide: "Carte d'expérience", temoinVide: '[data-etat="vide"]' },
] as const;

/** « 0 % », « 0,0 % » — mais pas « 10 % » ni « 100 % » : un pourcentage nul. */
const POURCENT_NUL = /(^|[^\d,])0(,0+)?\s?%/;

test.describe("F54 — base coupée : chaque écran d'usage dit « Lecture en échec » et propose « Réessayer »", () => {
  const PORT_F54 = Number(process.env.USAGES_ETATS_E2E_PORT ?? 3108);
  /** Secret local et jetable de la console de panne — jamais un secret réel. */
  const SECRET_F54 = "usages-etats-e2e-secret-local-jetable-non-production";
  let enPanne: ConsoleEnPanne | null = null;

  test.beforeAll(async ({}, info) => {
    info.setTimeout(120_000);
    enPanne = await demarrerConsoleEnPanne({ port: PORT_F54, secret: SECRET_F54, email: "e2e-f54-panne@mip-rum.local" });
  });

  test.afterAll(async () => {
    await enPanne?.arreter();
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([enPanne!.cookie]);
  });

  for (const ecran of ECRANS_F54) {
    test(`${ecran.nom} : « Lecture en échec » de l'écran, « Réessayer », sans débordement à 390, 768 et 1440 px`, async ({ page }) => {
      const url = `${enPanne!.base}${ecran.chemin}?app=${APP_F54}`;
      const echec = page.getByTestId("erreur-ecran");
      const corps = page.locator("body");
      // Toutes les largeurs sont PARCOURUES avant d'échouer : s'arrêter à la première cacherait les autres.
      const fautes: string[] = [];
      for (const largeur of LARGEURS) {
        await page.setViewportSize({ width: largeur, height: 900 });
        await page.goto(url, { waitUntil: "domcontentloaded" });

        await expect(echec, `${largeur} px`).toBeVisible({ timeout: 20_000 });
        // La frontière de l'ÉCRAN, pas le filet racine (« Console MIP RUM »).
        await expect(echec.getByRole("heading", { level: 1 }), `${largeur} px`).toHaveText(ecran.titreEchec);
        await expect(echec, `${largeur} px`).toContainText("Lecture en échec");
        await expect(echec.getByRole("button", { name: "Réessayer" }), `${largeur} px`).toBeVisible();

        await expect(corps).not.toContainText("Application error");
        await expect(corps).not.toContainText("This page could not be found");
        // Aucun vide inventé, aucun chiffre partiel : ni état « vide », ni tuile.
        await expect(page.locator('[data-etat="vide"]'), `${largeur} px`).toHaveCount(0);
        await expect(page.getByTestId("kpi-tile"), `${largeur} px`).toHaveCount(0);
        // La coquille (navigation) tient debout, et dit qu'elle est partielle.
        await expect(page.getByTestId("coquille-degradee"), `${largeur} px`).toBeVisible();

        for (const faute of await debordements(page)) fautes.push(`${ecran.nom} (base coupée) @ ${largeur} px — ${faute}`);
      }
      expect(fautes).toEqual([]);

      // « Réessayer » relance les lectures ; la base est toujours coupée, et l'écran
      // le redit au lieu de basculer sur un vide.
      await echec.getByRole("button", { name: "Réessayer" }).click();
      await expect(echec).toContainText("Lecture en échec", { timeout: 20_000 });
      await expect(corps).not.toContainText("Application error");
      await expect(page.locator('[data-etat="vide"]')).toHaveCount(0);
    });
  }
});

test.describe("F54 — application sans donnée : un vide lu, jamais une panne ni un « 0 % »", () => {
  const EMAIL_F54 = "e2e-f54-usages-etats@mip-rum.local";
  let pool: pg.Pool;
  let motDePasseF54 = "";

  test.beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
    });
    motDePasseF54 = await compteDedie(pool, EMAIL_F54);
    await pool.query("insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing", [APP_F54]);
  });

  test.afterAll(async () => {
    await pool.query("delete from app_registry where app_id = $1", [APP_F54]);
    await pool.end();
  });

  /** Connexion UNE fois par test : `/login` d'une session ouverte redirige, le champ e-mail n'apparaît plus. */
  async function connecterF54(page: Page) {
    await page.goto(`${consoleUrl}/login`);
    await page.fill('input[name="email"]', EMAIL_F54);
    await page.fill('input[name="password"]', motDePasseF54);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  for (const ecran of ECRANS_F54) {
    test(`${ecran.nom} : vide lu, ni « Lecture en échec » ni « 0 % », sans débordement à 390, 768 et 1440 px`, async ({ page }) => {
      await connecterF54(page);
      const corps = page.locator("body");
      const fautes: string[] = [];
      for (const largeur of LARGEURS) {
        await page.setViewportSize({ width: largeur, height: 900 });
        await page.goto(`${consoleUrl}${ecran.chemin}?app=${APP_F54}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("main h1").first(), `${largeur} px`).toContainText(ecran.titreVide);
        // L'écran a LU un vide : son état est là, motivé.
        await expect(page.locator(ecran.temoinVide).first(), `${largeur} px`).toBeVisible();
        // … et rien n'a échoué.
        await expect(corps).not.toContainText("Application error");
        await expect(page.getByText(/lecture en échec/i), `${largeur} px`).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Réessayer" }), `${largeur} px`).toHaveCount(0);
        // Sans dénominateur, une part vaut « — » et sa raison, jamais « 0 % » (V3).
        for (const tuile of await page.getByTestId("kpi-tile").all()) {
          await expect(tuile, `${largeur} px`).not.toContainText(POURCENT_NUL);
        }

        for (const faute of await debordements(page)) fautes.push(`${ecran.nom} (vide) @ ${largeur} px — ${faute}`);
      }
      expect(fautes).toEqual([]);
    });
  }
});
