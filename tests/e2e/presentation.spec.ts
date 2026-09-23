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

// Pas de `baseURL` dans `playwright.config.ts` : comme tous les specs du dépôt, on écrit
// l'URL complète. Un `goto("/presentation")` relatif est refusé par le navigateur
// (« Cannot navigate to invalid URL ») — c'est ce qui faisait échouer tout ce fichier.
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

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
    await page.goto(`${consoleUrl}/presentation`);
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
    await page.goto(`${consoleUrl}/presentation`);
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
    await page.goto(`${consoleUrl}/presentation`);
    for (const id of ["presentation-demo", "presentation-demo-top"]) {
      await expect(page.getByTestId(id)).toHaveAttribute("aria-disabled", "true");
    }
    await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    await expect(page.getByTestId("presentation-login")).toHaveAttribute("href", "/login");
    // « Ouvrir la console » est l'action du connecté, pas celle du visiteur.
    await expect(page.getByTestId("presentation-console")).toHaveCount(0);
  });

  test("PS1 — chaque lien du sommaire mène au titre d'une partie", async ({ page }) => {
    await page.goto(`${consoleUrl}/presentation`);
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
  // Toute navigation passe par `consoleUrl`, la constante de tête du fichier : pas de
  // `baseURL` dans playwright.config.ts, un chemin relatif serait refusé.
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

test.describe("P**.4 — Partie 2 : ce qu'il sait faire", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Déployées mais inertes : elles vont dans « Ce qui reste », jamais dans une carte (§ 8.0, règle 3). */
  const INERTES = ["D12", "D14"];

  /** Les capacités du document, relues dans son extraction versionnée. */
  function capacitesDuDocument(): { id: string; verdict: string }[] {
    const brut = JSON.parse(
      readFileSync(join(process.cwd(), "apps/console/lib/couverture.generated.json"), "utf8"),
    ) as { capacites: { id: string; verdict: string }[] };
    return brut.capacites;
  }

  /**
   * Les cartes de lib/presentation-sait-faire.ts, dans l'ordre, lues dans le source :
   * l'e2e n'importe pas le code de l'application. Une ligne `id: "K…",` par carte —
   * tests/unit/presentation-sait-faire.test.ts vérifie que cette lecture est juste.
   */
  function cartesDuFichier(): string[] {
    const source = readFileSync(join(process.cwd(), "apps/console/lib/presentation-sait-faire.ts"), "utf8");
    return [...source.matchAll(/^\s+id: "(K\d+)",$/gm)].map((m) => m[1]);
  }

  test("TP3 — une carte par entrée, au verdict du document, une puce de limite par identifiant", async ({ page }) => {
    const attendus = capacitesDuDocument()
      .filter((c) => c.verdict === "deploye_non_eprouve" && !INERTES.includes(c.id))
      .map((c) => c.id);
    const ids = cartesDuFichier();

    await page.goto(`${consoleUrl}/presentation`);
    const cartes = page.locator("section#sait-faire").getByTestId("capacite");
    await expect(cartes).toHaveCount(ids.length);
    expect(await cartes.evaluateAll((els) => els.map((e) => e.getAttribute("data-carte")))).toEqual(ids);

    const vus: string[] = [];
    for (const carte of await cartes.all()) {
      const nom = (await carte.getAttribute("data-carte")) ?? "?";
      await expect(carte, nom).toHaveAttribute("data-verdict", "deploye_non_eprouve");
      await expect(carte.getByTestId("capacite-verdict"), nom).toHaveText("Déployé, non éprouvé");
      const puces = carte.getByTestId("capacite-limite");
      expect(await puces.count(), `${nom} : au moins une puce`).toBeGreaterThan(0);
      for (const puce of await puces.all()) {
        const id = (await puce.getAttribute("data-id")) ?? "";
        // La puce COMMENCE par sa pastille, et une phrase la suit.
        const pastille = (await puce.locator(":scope > :first-child").innerText()).trim();
        expect(pastille, `${nom} : pastille de ${id}`).toBe(id);
        const lu = (await puce.innerText()).trim();
        expect(lu.startsWith(id), `${nom} : ${id} en tête`).toBe(true);
        expect(lu.slice(id.length).trim().length, `${nom} : une phrase suit ${id}`).toBeGreaterThan(0);
        vus.push(id);
      }
    }
    // Chaque ligne « déployé, non éprouvé » hors inertes, une fois et une seule.
    expect(new Set(vus).size, "un identifiant n'a qu'une puce").toBe(vus.length);
    expect([...vus].sort()).toEqual([...attendus].sort());
    expect(vus).toContain("A4");
  });

  test("renvoi — « (voir R3) » dans une limite mène au point de « Ce qui reste »", async ({ page }) => {
    await page.goto(`${consoleUrl}/presentation`);
    const liens = page.locator('section#sait-faire [data-testid="capacite-limite"] a[href^="#reste-"]');
    expect(await liens.count(), "la limite A6 renvoie à R3").toBeGreaterThan(0);
    for (const href of await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      await expect(page.locator(`section#reste ${href}`), href).toHaveCount(1);
    }
  });

  test("TP4 — D12 et D14, déployées mais inertes, n'apparaissent pas dans « Ce qu'il sait faire »", async ({ page }) => {
    await page.goto(`${consoleUrl}/presentation`);
    const partie = page.locator("section#sait-faire");
    await expect(partie).toHaveCount(1);
    for (const id of INERTES) await expect(partie.locator(`[data-id="${id}"]`)).toHaveCount(0);
    expect(await partie.innerText()).not.toMatch(/\bD1[24]\b/);
  });

  test("V-E — la barre de couverture : une case par capacité, des décomptes écrits", async ({ page }) => {
    const capacites = capacitesDuDocument();
    const deployees = capacites.filter((c) => c.verdict === "deploye_non_eprouve").length;
    await page.goto(`${consoleUrl}/presentation`);
    const barre = page.locator("section#sait-faire").getByTestId("couverture-barre");
    const dessin = barre.locator('svg[role="img"]');
    await expect(dessin).toHaveAttribute("aria-label", new RegExp(` ${capacites.length} capacités, `));
    await expect(dessin.locator("rect")).toHaveCount(capacites.length);
    await expect(barre.getByTestId("couverture-legende").locator("li").first()).toHaveText(
      `${deployees} déployées, non éprouvées`,
    );
  });
});

// ─── P**.5 — Partie 3 : TP4 côté « Ce qui reste » ───────────────────────────────

test.describe("P**.5 — Partie 3 : ce qui reste pour un vrai outil de RUM", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Verdict de chaque ligne de capacité, relu dans l'extraction du document de couverture. */
  const verdictsDuDocument = (): Map<string, string> => {
    const brut = JSON.parse(
      readFileSync(join(process.cwd(), "apps/console/lib/couverture.generated.json"), "utf8"),
    ) as { capacites: { id: string; verdict: string }[] };
    return new Map(brut.capacites.map((c) => [c.id, c.verdict]));
  };

  test("TP4 — D12 et D14, déployées mais inertes, ont leur pastille dans « Ce qui reste »", async ({ page }) => {
    const verdicts = verdictsDuDocument();
    await page.goto(`${consoleUrl}/presentation`);
    const reste = page.locator("section#reste");
    for (const id of ["D12", "D14"]) {
      const pastille = reste.locator(`[data-testid="reste-pastille"][data-id="${id}"]`);
      await expect(pastille, id).toHaveCount(1);
      await expect(pastille, id).toBeVisible();
      await expect(pastille, id).toHaveText(id);
      await expect(pastille, id).toHaveAttribute("data-verdict", verdicts.get(id) ?? "absente du document");
    }
  });

  test("neuf points dans l'ordre du plan, chacun avec ce qui manque, ce qui le débloque et qui décide", async ({ page }) => {
    await page.goto(`${consoleUrl}/presentation`);
    const points = page.locator('section#reste [data-testid="reste-point"]');
    await expect(points).toHaveCount(9);
    expect(await points.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")))).toEqual([
      "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9",
    ]);
    for (const point of await points.all()) {
      await expect(point.getByRole("heading", { level: 3 })).toHaveCount(1);
      await expect(point.locator("dt")).toHaveText(["Ce qui manque", "Ce qui le débloque", "Qui décide"]);
      for (const valeur of await point.locator("dd").all()) await expect(valeur).not.toBeEmpty();
    }
    // Chiffres repris du document, qui dit ne pas les avoir recontrôlés : la mention est obligatoire.
    await expect(points.nth(0)).toContainText("non recontrôlé");
    await expect(points.nth(1)).toContainText("non recontrôlé");
  });

  test("chaque pastille est une ligne du document de couverture, avec son verdict", async ({ page }) => {
    const verdicts = verdictsDuDocument();
    await page.goto(`${consoleUrl}/presentation`);
    const lues = await page
      .locator('section#reste [data-testid="reste-pastille"]')
      .evaluateAll((els) => els.map((e) => [e.getAttribute("data-id") ?? "", e.getAttribute("data-verdict") ?? ""]));
    expect(lues.length).toBeGreaterThan(0);
    for (const [id, verdict] of lues) expect(verdict, id).toBe(verdicts.get(id));
  });
});

// ─── P**.6 — Annexe et Specs : TP11 (six <details>, toutes les lignes), TP6 (clavier)

test.describe("P**.6 — annexe et Specs", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * L'extraction du document de couverture, que l'annexe reprend ligne pour ligne.
   * Le nombre de familles et de lignes y est LU, jamais recopié : un nouveau relevé
   * les change sans toucher à ce test.
   */
  const extraction = () =>
    JSON.parse(readFileSync(join(process.cwd(), "apps/console/lib/couverture.generated.json"), "utf8")) as {
      releve: string;
      familles: string[];
      capacites: { id: string; famille: string; verdict: string }[];
    };

  test("TP11 — une famille par <details>, et toutes les capacités du document, dans son ordre", async ({ page }) => {
    const doc = extraction();
    await page.goto(`${consoleUrl}/presentation`);
    const annexe = page.locator("section#detail");
    await expect(annexe).toContainText(`Le document de couverture du ${doc.releve}, tel quel`);

    const familles = annexe.getByTestId("annexe-famille");
    await expect(familles).toHaveCount(doc.familles.length);
    await expect(annexe.locator("details")).toHaveCount(doc.familles.length);
    await expect(annexe.getByTestId("annexe-capacite")).toHaveCount(doc.capacites.length);

    for (const [i, famille] of doc.familles.entries()) {
      const bloc = familles.nth(i);
      const attendues = doc.capacites.filter((c) => c.famille === famille);
      await expect(bloc.locator("summary")).toContainText(famille);
      await expect(bloc.locator("summary")).toContainText(`${attendues.length} capacité`);
      expect(await bloc.evaluate((d) => (d as HTMLDetailsElement).open), `${famille} : fermée au chargement`).toBe(false);
      const lignes = await bloc
        .getByTestId("annexe-capacite")
        .evaluateAll((trs) => trs.map((tr) => [tr.getAttribute("data-id"), tr.getAttribute("data-verdict")]));
      expect(lignes, famille).toEqual(attendues.map((c) => [c.id, c.verdict]));
    }

    // Ouverte, une famille montre ses quatre colonnes nommées et ses lignes.
    const premiere = familles.first();
    await premiere.locator("summary").click();
    expect(await premiere.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
    for (const nom of ["Identifiant", "Capacité", "Verdict", "Limite"]) {
      await expect(premiere.getByRole("columnheader", { name: nom, exact: true })).toBeVisible();
    }
    const ligne = premiere.getByTestId("annexe-capacite").first();
    const c0 = doc.capacites.filter((c) => c.famille === doc.familles[0])[0];
    await expect(ligne.getByRole("rowheader")).toHaveText(c0.id);
    // Trois cellules non vides : capacité, verdict ÉCRIT (pas seulement une teinte), limite.
    for (const cellule of await ligne.getByRole("cell").all()) await expect(cellule).not.toBeEmpty();

    // Le Markdown du document est rendu : ni astérisques ni accents graves à l'écran.
    const brut = await annexe.getByTestId("annexe-couverture").evaluate((el) => el.textContent ?? "");
    expect(brut).not.toMatch(/\*\*|`/);
  });

  test("PS11 — familles ouvertes : rien ne dépasse à 390, 768, 1440 px ; sous 1024 px, une ligne s'empile", async ({
    page,
  }) => {
    await page.goto(`${consoleUrl}/presentation`);
    const annexe = page.locator("section#detail");
    const familles = annexe.getByTestId("annexe-famille");
    for (const bloc of await familles.all()) await bloc.locator("summary").click();
    const ligne = familles.first().getByTestId("annexe-capacite").first();
    const capacite = ligne.getByRole("cell").first();
    const limite = ligne.getByRole("cell").last();

    for (const largeur of [390, 768, 1440]) {
      await page.setViewportSize({ width: largeur, height: 900 });
      // Les éléments de l'annexe qui dépassent la fenêtre, NOMMÉS (liste vide : rien ne dépasse).
      const fautifs = await annexe.evaluate((section) => {
        const fenetre = document.documentElement.clientWidth;
        return [...section.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > fenetre + 1)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()} « ${(el.textContent ?? "").trim().slice(0, 50)} » → ${Math.round(el.getBoundingClientRect().right)} px`);
      });
      expect(fautifs, `${largeur} px`).toEqual([]);

      const c = (await capacite.boundingBox())!;
      const l = (await limite.boundingBox())!;
      if (largeur < 1024) {
        expect(l.y, `${largeur} px : la limite passe sous la capacité`).toBeGreaterThanOrEqual(c.y + c.height - 1);
      } else {
        expect(l.x, `${largeur} px : la limite est une colonne, à droite de la capacité`).toBeGreaterThanOrEqual(c.x + c.width - 1);
      }
    }
  });

  test("TP6 — au clavier : le sommaire, le focus sur le titre visé, puis les onglets de Specs aux flèches", async ({
    page,
  }) => {
    const doc = extraction();
    await page.goto(`${consoleUrl}/presentation`);
    const sommaire = page.getByRole("navigation", { name: "Sommaire de la présentation" });

    // 1. Tab depuis le haut de la page atteint le sommaire, par son premier lien.
    const dansSommaire = () => sommaire.evaluate((nav) => nav.contains(document.activeElement));
    for (let i = 0; i < 30 && !(await dansSommaire()); i++) await page.keyboard.press("Tab");
    await expect(sommaire.getByRole("link").first()).toBeFocused();

    // 2. Tab jusqu'à « Ce qui reste », Entrée : le focus passe sur le titre de la partie.
    const reste = sommaire.getByRole("link", { name: "Ce qui reste", exact: true });
    for (let i = 0; i < 5 && !(await reste.evaluate((a) => a === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(reste).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#reste-titre")).toBeFocused();

    // 3. Même geste vers « Le détail » ; de son titre, Tab parcourt les familles une à
    //    une, et Entrée ouvre puis referme une famille.
    await sommaire.getByRole("link", { name: "Le détail", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detail-titre")).toBeFocused();
    const familles = page.locator("section#detail").getByTestId("annexe-famille");
    for (let i = 0; i < doc.familles.length; i++) {
      await page.keyboard.press("Tab");
      await expect(familles.nth(i).locator("summary")).toBeFocused();
    }
    const derniere = familles.last();
    await page.keyboard.press("Enter");
    await expect.poll(() => derniere.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => derniere.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);

    // 4. Les Specs sont arrivées (plus de squelette) ; un seul arrêt de tabulation pour
    //    leurs onglets : celui qui est choisi.
    await expect(page.getByTestId("specs-chargement")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.locator("#specs-infra")).toBeFocused();
    await expect(page.locator("#specs-infra")).toBeChecked();

    // 5. Les flèches passent d'un onglet à l'autre, en boucle, et le panneau suit.
    const panneau = (onglet: string) => page.locator(`[data-testid="specs-panneau"][data-onglet="${onglet}"]`);
    await expect(panneau("infra")).toBeVisible();
    const parcours = [
      ["ArrowRight", "mesures"],
      ["ArrowRight", "ecart"],
      ["ArrowRight", "infra"],
      ["ArrowLeft", "ecart"],
    ] as const;
    for (const [touche, onglet] of parcours) {
      await page.keyboard.press(touche);
      await expect(page.locator(`#specs-${onglet}`), `${touche} → ${onglet}`).toBeFocused();
      await expect(page.locator(`#specs-${onglet}`)).toBeChecked();
      for (const o of ["infra", "mesures", "ecart"]) {
        if (o === onglet) await expect(panneau(o)).toBeVisible();
        else await expect(panneau(o)).toBeHidden();
      }
    }
    // L'onglet choisi ne passe pas par l'URL : l'adresse est restée celle de l'ancre.
    await expect(page).toHaveURL(/\/presentation#detail-titre$/);
  });
});

// ─── P**.8 — Recette : TP5 (débordements), TP12 (mouvement réduit), TP8 avec P**.7
