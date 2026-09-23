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
    await page.goto("/presentation");
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
    await page.goto("/presentation");
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
    await page.goto("/presentation");
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
