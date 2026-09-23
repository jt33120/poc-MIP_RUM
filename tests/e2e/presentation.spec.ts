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

// ─── P**.4 — Partie 2 : TP3 (cartes et puces de limite), TP4 côté « Ce qu'il sait faire »

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
    await page.goto("/presentation");
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
    await page.goto("/presentation");
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
    await page.goto("/presentation");
    const lues = await page
      .locator('section#reste [data-testid="reste-pastille"]')
      .evaluateAll((els) => els.map((e) => [e.getAttribute("data-id") ?? "", e.getAttribute("data-verdict") ?? ""]));
    expect(lues.length).toBeGreaterThan(0);
    for (const [id, verdict] of lues) expect(verdict, id).toBe(verdicts.get(id));
  });
});

// ─── P**.6 — Annexe et Specs : TP11 (six <details>, toutes les lignes), TP6 (clavier)

// ─── P**.8 — Recette : TP5 (débordements), TP12 (mouvement réduit), TP8 avec P**.7
