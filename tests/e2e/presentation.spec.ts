// E2E — la vitrine publique /presentation (plan § 8.5, recette TP1 à TP12).
//
// Une page pour tous, en trois parties (« Ce qu'il contient », « Ce qu'il sait
// faire », « Ce qui reste pour un vrai outil de RUM ») puis le détail. Visiteur non
// connecté sauf TP10 ; 1440 × 900 sauf mention (TP5 : 390, 768, 1440).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER. Que la vitrine dise plus que le document de
// couverture (docs/RUM_PARITY_STATUS.md) : ses chiffres sont lus dans
// apps/console/lib/couverture.generated.json, l'extraction que lit
// lib/couverture.ts — jamais recopiés ici.
//
// UN BLOC PAR LOT. P**.2 pose l'ossature et ses tests ; chaque lot suivant ajoute
// SON `test.describe` sous SON repère, plus bas. Les lots de la partie 2 à 6
// partent de la même base et avancent en parallèle : écrire chacun à un endroit
// distinct évite que leurs fusions se marchent dessus.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/** Ce que la page doit afficher, relu dans l'extraction du document de couverture. */
function couverture() {
  const brut = JSON.parse(
    readFileSync(join(process.cwd(), "apps/console/lib/couverture.generated.json"), "utf8"),
  ) as { releve: string; sha: string; capacites: { id: string; verdict: string }[] };
  return {
    releve: brut.releve,
    sha: brut.sha,
    total: brut.capacites.length,
    deployees: brut.capacites.filter((c) => c.verdict === "deploye_non_eprouve").length,
  };
}

/** Minuit UTC d'une date « JJ/MM/AAAA ». */
function minuitUtc(date: string): number {
  const [j, m, a] = date.split("/").map(Number);
  return Date.UTC(a, m - 1, j);
}

/** Seuil au-delà duquel la ligne de relevé prévient (Releve.tsx, RELEVE_PERIME_JOURS). */
const PERIME_JOURS = 30;

const PARTIES = [
  { id: "contient", titre: "Ce qu'il contient" },
  { id: "sait-faire", titre: "Ce qu'il sait faire" },
  { id: "reste", titre: "Ce qui reste pour un vrai outil de RUM" },
] as const;

test.describe("P**.2 — ossature : une page, trois parties", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("TP1 — trois titres h2, dans l'ordre, chacun en tête de sa partie", async ({ page }) => {
    await page.goto("/presentation");
    const titres = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
    const attendus: string[] = PARTIES.map((p) => p.titre);
    expect(titres.filter((t) => attendus.includes(t))).toEqual(attendus);
    for (const p of PARTIES) {
      const section = page.locator(`section#${p.id}`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole("heading", { level: 2, name: p.titre, exact: true })).toBeVisible();
    }
  });

  test("TP2 — la ligne de relevé ne dit que ce que calcule le document de couverture", async ({ page }) => {
    const c = couverture();
    await page.goto("/presentation");
    const releve = page.getByTestId("presentation-releve");
    await expect(releve).toContainText(`État relevé le ${c.releve} sur ${c.sha}`);
    await expect(releve).toContainText(
      `${c.total} capacités recensées, ${c.deployees} déployées, aucune éprouvée sur des données réellement ingérées.`,
    );
    // Au-delà de 30 jours, et seulement alors, la ligne prévient que l'état a pu changer.
    const perime = Date.now() - minuitUtc(c.releve) > PERIME_JOURS * 86_400_000;
    await expect(page.getByTestId("presentation-releve-perime")).toHaveCount(perime ? 1 : 0);
  });

  test("TP9 — sans DEMO_USER_APPS, « Voir la démo » est verrouillé, pas un lien mort", async ({ page }) => {
    test.skip(
      Boolean(process.env.DEMO_USER_APPS?.trim()),
      "TP9 suppose une console lancée sans DEMO_USER_APPS, comme en CI",
    );
    await page.goto("/presentation");
    for (const id of ["presentation-demo", "presentation-demo-top"]) {
      await expect(page.getByTestId(id)).toHaveAttribute("aria-disabled", "true");
    }
    await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    await expect(page.getByTestId("presentation-login")).toHaveAttribute("href", "/login");
    // « Ouvrir la console » est l'action du connecté, pas celle du visiteur.
    await expect(page.getByTestId("presentation-console")).toHaveCount(0);
  });

  test("PS1 — chaque lien du sommaire mène au titre d'une partie", async ({ page }) => {
    await page.goto("/presentation");
    const sommaire = page.getByRole("navigation", { name: "Sommaire de la présentation" });
    const liens = sommaire.getByRole("link");
    await expect(liens).toHaveText(["Ce qu'il contient", "Ce qu'il sait faire", "Ce qui reste", "Le détail"]);
    for (const href of await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      const cible = page.locator(href);
      await expect(cible, href).toHaveCount(1);
      await expect(cible, href).toHaveAttribute("tabindex", "-1");
      expect(await cible.evaluate((el) => el.tagName), href).toBe("H2");
    }
  });
});

// ─── P**.3 — Partie 1 : TP7 (topologie accessible), TP10 (connecté) ─────────────

// Imports DE CE BLOC, ici plutôt qu'en tête : chaque lot n'écrit que sous son
// repère (une déclaration `import` vaut au niveau du module, où qu'elle soit). Noms
// suffixés : deux lots qui importeraient `pg` sous le même nom ne compileraient plus.
import pgPss3 from "pg";
import { compteDedie as compteDediePss3 } from "./helpers/compte-dedie";

test.describe("P**.3 — Partie 1 : ce qu'il contient", () => {
  const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
  test.use({ viewport: { width: 1440, height: 900 } });

  test("TP7 — la topologie est une image nommée, doublée d'une alternative textuelle", async ({ page }) => {
    await page.goto(`${consoleUrl}/presentation`);
    const partie = page.locator("section#contient");
    const dessin = partie.getByRole("img", { name: /^Chemin de la mesure :/ });
    await expect(dessin).toBeVisible();
    await expect(dessin).toHaveAttribute("aria-label", /\S/);
    const alternative = partie.getByTestId("topologie").locator("details");
    await alternative.locator("summary").click();
    const table = alternative.locator("table");
    await expect(table).toBeVisible();
    for (const mot of ["Vercel", "fra1", "Neon", "Railway"]) await expect(table).toContainText(mot);
    // Visiteur : les écrans sont du texte (ils demandent une session), pas de carrousel.
    await expect(partie.getByTestId("ecrans-console").locator("a")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Tutoriel : ajouter un client" })).toHaveCount(0);
  });

  test.describe("TP10 — connecté", () => {
    // Compte DÉDIÉ à ce bloc (jamais scripts/seed-admin.mjs) ; la base est celle de la
    // console locale ou de la CI, comme dans les autres specs à compte dédié.
    const email = "e2e-presentation-pss3@mip-rum.local";
    let pool: pgPss3.Pool | null = null;
    let motDePasse = "";

    test.beforeAll(async () => {
      pool = new pgPss3.Pool({
        connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
      });
      motDePasse = await compteDediePss3(pool, email);
    });

    test.afterAll(async () => {
      await pool?.end();
    });

    test("TP10 — « Ouvrir la console », écrans cliquables, carrousel et snippet d'ingestion", async ({ page }) => {
      await page.goto(`${consoleUrl}/login`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', motDePasse);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });

      await page.goto(`${consoleUrl}/presentation`);
      await expect(page.getByTestId("presentation-console")).toBeVisible();
      await expect(page.getByTestId("presentation-demo")).toHaveCount(0);

      // Chaque écran listé est un lien vers sa route.
      const ecrans = page.getByTestId("ecrans-console");
      const nbEcrans = await ecrans.locator("li li").count();
      expect(nbEcrans).toBeGreaterThan(0);
      const liens = ecrans.locator("li li a");
      await expect(liens).toHaveCount(nbEcrans);
      for (const href of await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
        expect(href).toMatch(/^\//);
      }

      // Le carrousel « Brancher une application », et son snippet vers la route de la console.
      // Composant client : un clic parti avant l'hydratation serait perdu, on le rejoue.
      const carrousel = page.getByRole("region", { name: "Tutoriel : ajouter un client" });
      await expect(carrousel).toBeVisible();
      const etape2 = carrousel.getByRole("button", { name: "Aller à l'étape 2" });
      await expect(async () => {
        await etape2.click();
        await expect(carrousel.locator("pre code")).toContainText("/api/ingest/v1/traces", { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });

      // Un écran s'ouvre vraiment : navigation document, sans retour à la connexion.
      await liens.first().click();
      await page.waitForURL((u) => u.pathname !== "/presentation", { timeout: 15_000 });
      expect(new URL(page.url()).pathname).not.toBe("/login");
    });
  });
});

// ─── P**.4 — Partie 2 : TP3 (cartes et puces de limite), TP4 côté « Ce qu'il sait faire »

// ─── P**.5 — Partie 3 : TP4 côté « Ce qui reste » ───────────────────────────────

// ─── P**.6 — Annexe et Specs : TP11 (six <details>, toutes les lignes), TP6 (clavier)

// ─── P**.8 — Recette : TP5 (débordements), TP12 (mouvement réduit), TP8 avec P**.7
