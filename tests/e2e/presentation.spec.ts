// E2E — la vitrine publique (plan § 8.5, recette TP1 à TP12).
//
// Depuis le 30/09/2026, les pages publiques partagent une barre de navigation
// (`nav-vitrine`) : la VITRINE (/presentation : film, entrées, aperçu), puis trois
// entrées de menu. INSTALLATION (/presentation/installation et une page par
// parcours) ; À FAIRE (/presentation/a-faire : les hypothèses réductrices, « Ce qui
// reste pour un vrai outil de RUM », les chantiers) ; GRAPHE TECHNIQUE
// (/presentation/graphe-technique : le récit de l'ancienne vitrine — promesse,
// statut, preuves, hébergement —, puis « Ce qu'il contient », « Ce qu'il sait
// faire » et le détail). L'ancien dossier technique et l'archive de la vitrine sont
// supprimés : leurs adresses redirigent vers le graphe, et leurs garanties ont suivi
// leur contenu. Visiteur non connecté sauf TP10 ; 1440 × 900 sauf mention (TP5 :
// 390, 768, 1440).
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
/** Le graphe technique : le récit de l'ancienne vitrine, deux parties et le détail. */
const grapheUrl = `${consoleUrl}/presentation/graphe-technique`;
/** La page À faire, où vit « Ce qui reste » depuis le 30/09/2026. */
const aFaireUrl = `${consoleUrl}/presentation/a-faire`;
/** Début des renvois vers un point de « Ce qui reste » (SaitFaire.tsx, lienDuPoint). */
const RENVOI_RESTE = "/presentation/a-faire#reste-";

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

/** Les parties du graphe technique, dans l'ordre ; « Ce qui reste » est passé à la page À faire. */
const PARTIES_GRAPHE = [
  { id: "contient", titre: "Ce qu'il contient" },
  { id: "sait-faire", titre: "Ce qu'il sait faire" },
] as const;

/** Les titres h2 de la page À faire, dans l'ordre (AFaire.tsx). */
const TITRES_A_FAIRE = ["Hypothèses réductrices", "Ce qui reste pour un vrai outil de RUM", "Chantiers d'exploitation"];

test.describe("P**.2 — ossature : le graphe technique et la page À faire", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("TP1 — le graphe : ses parties en h2, dans l'ordre, chacune en tête de sa section ; plus de « Ce qui reste »", async ({
    page,
  }) => {
    await page.goto(grapheUrl);
    const titres = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
    const attendus: string[] = PARTIES_GRAPHE.map((p) => p.titre);
    expect(titres.filter((t) => attendus.includes(t))).toEqual(attendus);
    for (const p of PARTIES_GRAPHE) {
      const section = page.locator(`section#${p.id}`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole("heading", { level: 2, name: p.titre, exact: true })).toBeVisible();
    }
    await expect(page.locator("section#reste")).toHaveCount(0);
  });

  test("TP1 — la page À faire : les hypothèses, « Ce qui reste », puis les chantiers", async ({ page }) => {
    await page.goto(aFaireUrl);
    const titres = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
    expect(titres.filter((t) => TITRES_A_FAIRE.includes(t))).toEqual(TITRES_A_FAIRE);
    const reste = page.locator("section#reste");
    await expect(reste).toHaveCount(1);
    await expect(reste.getByRole("heading", { level: 2, name: TITRES_A_FAIRE[1], exact: true })).toBeVisible();
    expect(await page.getByTestId("hypothese").count(), "au moins une hypothèse réductrice").toBeGreaterThan(0);
  });

  test("TP2 — la ligne de relevé ne dit que ce que calcule le document de couverture", async ({ page }) => {
    const c = couverture();
    await page.goto(grapheUrl);
    const releve = page.getByTestId("presentation-releve");
    await expect(releve).toContainText(`État relevé le ${c.releve} :`);
    await expect(releve).toContainText(
      `${c.total} capacités recensées, ${c.deployees} déployées, aucune encore éprouvée sur des données réellement ingérées.`,
    );
    // Recette du 26/09/2026 : plus d'empreinte de commit à l'écran.
    await expect(releve).not.toContainText(c.sha);
    // Au-delà de 30 jours, et seulement alors, la ligne prévient que l'état a pu changer.
    const perime = Date.now() - minuitUtc(c.releve) > PERIME_JOURS * 86_400_000;
    await expect(page.getByTestId("presentation-releve-perime")).toHaveCount(perime ? 1 : 0);
  });

  test("TP9 — sans DEMO_USER_APPS, « Voir la démo » est verrouillé, pas un lien mort", async ({ page }) => {
    test.skip(
      Boolean(process.env.DEMO_USER_APPS?.trim()),
      "TP9 suppose une console lancée sans DEMO_USER_APPS, comme en CI",
    );
    // La vitrine : l'entrée « compte démo » verrouillée, la connexion et l'inscription ouvertes.
    await page.goto(`${consoleUrl}/presentation`);
    await expect(page.getByTestId("vitrine-demo")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('a[href="/login?demo=1"]')).toHaveCount(0);
    await expect(page.getByTestId("vitrine-connexion")).toHaveAttribute("href", "/login");
    await expect(page.getByTestId("vitrine-inscription")).toHaveAttribute("href", "/inscription");
    await expect(page.getByTestId("vitrine-console")).toHaveCount(0);
    // La barre de navigation propose la connexion, pas la console ; démo fermée, pas de
    // bouton « Démo » non plus.
    await expect(page.getByTestId("nav-connexion")).toHaveAttribute("href", "/login");
    await expect(page.getByTestId("nav-demo")).toHaveCount(0);
    await expect(page.getByTestId("nav-console")).toHaveCount(0);
    // Démo fermée, la connexion pré-remplie redevient la connexion ordinaire, et le dit.
    await page.goto(`${consoleUrl}/login?demo=1`);
    await expect(page.getByTestId("login-demo-fermee")).toBeVisible();
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByTestId("login-demo-form")).toHaveCount(0);

    // Les pages du menu n'ont plus de rangées d'actions : la barre de navigation seule,
    // et aucun lien mort vers la démo.
    await page.goto(grapheUrl);
    await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    await expect(page.locator('a[href="/login?demo=1"]')).toHaveCount(0);
    await expect(page.getByTestId("nav-connexion")).toHaveAttribute("href", "/login");
    // « Ouvrir la console » est l'action du connecté, pas celle du visiteur.
    await expect(page.getByTestId("nav-console")).toHaveCount(0);
  });

  test("PS1 — chaque lien du sommaire du graphe mène au titre d'une partie, sans « Ce qui reste »", async ({ page }) => {
    await page.goto(grapheUrl);
    const sommaire = page.getByRole("navigation", { name: "Sommaire de la présentation" });
    const liens = sommaire.getByRole("link");
    await expect(liens).toHaveText(["Ce qu'il contient", "Ce qu'il sait faire", "Le détail"]);
    for (const href of await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      const cible = page.locator(href);
      await expect(cible, href).toHaveCount(1);
      await expect(cible, href).toHaveAttribute("tabindex", "-1");
      expect(await cible.evaluate((el) => el.tagName), href).toBe("H2");
    }
  });

  test("PS1 — le sommaire de la page À faire : chaque lien a sa cible", async ({ page }) => {
    await page.goto(aFaireUrl);
    const liens = page.getByRole("navigation", { name: "Sommaire de la page" }).getByRole("link");
    await expect(liens).toHaveCount(3);
    for (const href of await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      await expect(page.locator(href), href).toHaveCount(1);
    }
  });
});

// ─── Menu des pages publiques (30/09/2026) : anciennes adresses, barre de navigation

test.describe("menu des pages publiques", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("l'ancien dossier technique et l'archive redirigent (308) vers le graphe technique", async ({ page }) => {
    for (const ancien of ["/presentation/dossier", "/presentation/archive"]) {
      const res = await page.request.get(`${consoleUrl}${ancien}`, { maxRedirects: 0 });
      expect(res.status(), ancien).toBe(308);
      expect(res.headers()["location"], ancien).toMatch(/\/presentation\/graphe-technique$/);
      await page.goto(`${consoleUrl}${ancien}`);
      await expect(page).toHaveURL(grapheUrl);
      await expect(page.getByTestId("page-graphe")).toBeVisible();
    }
  });

  test("la barre de navigation : le sous-menu mène aux trois parcours d'installation, puis À faire et le graphe", async ({
    page,
  }) => {
    const parcours = [
      ["snippet", "sdk-javascript"],
      ["extension", "extension"],
      ["serveur", "serveur"],
    ] as const;
    for (const [id, segment] of parcours) {
      await page.goto(`${consoleUrl}/presentation`);
      const nav = page.getByTestId("nav-vitrine");
      // Au clavier : le bouton ouvre le sous-menu. Composant client : une touche
      // partie avant l'hydratation serait perdue, on la rejoue.
      const bouton = nav.getByRole("button", { name: "Les trois parcours d'installation" });
      await expect(async () => {
        await bouton.focus();
        await page.keyboard.press("Enter");
        await expect(nav.getByTestId(`nav-parcours-${id}`)).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await nav.getByTestId(`nav-parcours-${id}`).click();
      await page.waitForURL(`**/presentation/installation/${segment}`, { timeout: 15_000 });
      await expect(page.getByTestId(`page-parcours-${id}`)).toBeVisible();
      await expect(page.getByTestId("nav-vitrine")).toBeVisible();
    }

    // Les sous-onglets d'Installation : la vue d'ensemble, puis chacun des trois parcours.
    await page.goto(`${consoleUrl}/presentation/installation`);
    const onglets = page.getByTestId("onglets-installation").getByRole("link");
    expect(await onglets.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual([
      "/presentation/installation",
      ...parcours.map(([, segment]) => `/presentation/installation/${segment}`),
    ]);
    await expect(page.getByTestId("onglet-apercu")).toHaveAttribute("aria-current", "page");

    // Les deux autres entrées du menu, et le dépôt public, dans un nouvel onglet.
    const nav = page.getByTestId("nav-vitrine");
    await expect(nav.getByTestId("nav-github")).toHaveAttribute("href", "https://github.com/jt33120/poc-MIP_RUM");
    await expect(nav.getByTestId("nav-github")).toHaveAttribute("target", "_blank");
    await expect(nav.getByRole("link", { name: "À faire", exact: true })).toHaveAttribute("href", "/presentation/a-faire");
    await expect(nav.getByRole("link", { name: "Graphe technique", exact: true })).toHaveAttribute(
      "href",
      "/presentation/graphe-technique",
    );
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
    await page.goto(grapheUrl);
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

      // Connecté : la vitrine et sa barre proposent la console, plus la démo ni la connexion.
      await page.goto(`${consoleUrl}/presentation`);
      await expect(page.getByTestId("vitrine-console")).toBeVisible();
      await expect(page.getByTestId("vitrine-demo")).toHaveCount(0);
      await expect(page.getByTestId("nav-console")).toBeVisible();
      await expect(page.getByTestId("nav-console")).toHaveAttribute("href", "/");
      await expect(page.getByTestId("nav-github")).toBeVisible();
      await expect(page.getByTestId("nav-connexion")).toHaveCount(0);
      await expect(page.getByTestId("nav-demo")).toHaveCount(0);

      // Le détail est au graphe technique : chaque écran listé y est un lien vers sa route.
      await page.goto(grapheUrl);
      await expect(page.getByTestId("nav-console")).toBeVisible();
      await expect(page.getByTestId("nav-connexion")).toHaveCount(0);
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
      await page.waitForURL((u) => u.pathname !== "/presentation/graphe-technique", { timeout: 15_000 });
      expect(new URL(page.url()).pathname).not.toBe("/login");
    });
  });
});

// ─── P**.4 — Partie 2 : TP3 (cartes et puces de limite), TP4 côté « Ce qu'il sait faire »

test.describe("P**.4 — Partie 2 : ce qu'il sait faire", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * Déployées mais inertes : elles vont dans « Ce qui reste », jamais dans une carte (§ 8.0,
   * règle 3). D14 en est sortie le 28/09/2026 : elle résout le pays de la collecte directe
   * de la console, et a sa carte (lib/couverture-controle.ts, DEPLOYEES_INERTES). D12 en est
   * sortie le 29/09/2026 : les tickets sont retirés, la ligne est « non retenu ».
   */
  const INERTES: string[] = [];

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

    await page.goto(grapheUrl);
    const partie = page.locator("section#sait-faire");
    const cartes = partie.getByTestId("capacite");
    await expect(cartes).toHaveCount(ids.length);
    expect(await cartes.evaluateAll((els) => els.map((e) => e.getAttribute("data-carte")))).toEqual(ids);
    // Recette du 26/09/2026 : le verdict commun est dit une fois, dans le chapeau, et
    // plus sur chaque carte ; une carte déclassée le redirait (capacite-verdict).
    await expect(partie.locator("header")).toContainText("« déployé, non éprouvé »");
    await expect(partie.getByTestId("capacite-verdict")).toHaveCount(0);

    const vus: string[] = [];
    for (const carte of await cartes.all()) {
      const nom = (await carte.getAttribute("data-carte")) ?? "?";
      await expect(carte, nom).toHaveAttribute("data-verdict", "deploye_non_eprouve");
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

  test("renvoi — « (voir R3) » dans une limite mène au point de « Ce qui reste », sur la page À faire", async ({ page }) => {
    await page.goto(grapheUrl);
    const liens = page.locator(`section#sait-faire [data-testid="capacite-limite"] a[href^="${RENVOI_RESTE}"]`);
    await expect(liens.first(), "la limite A6 renvoie à R3").toBeAttached();
    // Plus aucun renvoi dans la page : « Ce qui reste » n'y est plus.
    await expect(page.locator('section#sait-faire a[href^="#reste-"]')).toHaveCount(0);
    const hrefs = await liens.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));

    // Suivi pour de bon, le premier renvoi ouvre la page À faire sur son ancre…
    await liens.first().click();
    await page.waitForURL((u) => u.pathname === "/presentation/a-faire", { timeout: 15_000 });
    expect(new URL(page.url()).hash).toBe(hrefs[0].slice(hrefs[0].indexOf("#")));

    // … et chaque ancre visée y est un point de « Ce qui reste ».
    for (const href of new Set(hrefs)) {
      await expect(page.locator(`section#reste ${href.slice(href.indexOf("#"))}`), href).toHaveCount(1);
    }
  });

  test("TP4 — D12, retirée le 29/09/2026, n'apparaît pas dans « Ce qu'il sait faire » ; D14 y a sa carte", async ({ page }) => {
    await page.goto(grapheUrl);
    const partie = page.locator("section#sait-faire");
    await expect(partie).toHaveCount(1);
    for (const id of ["D12", ...INERTES]) await expect(partie.locator(`[data-id="${id}"]`)).toHaveCount(0);
    expect(await partie.innerText()).not.toMatch(/\bD12\b/);
    await expect(partie.locator('[data-testid="capacite-limite"][data-id="D14"]')).toHaveCount(1);
  });

  test("V-E — la barre de couverture : une case par capacité, des décomptes écrits", async ({ page }) => {
    const capacites = capacitesDuDocument();
    const deployees = capacites.filter((c) => c.verdict === "deploye_non_eprouve").length;
    await page.goto(grapheUrl);
    const barre = page.locator("section#sait-faire").getByTestId("couverture-barre");
    const dessin = barre.locator('svg[role="img"]');
    await expect(dessin).toHaveAttribute("aria-label", new RegExp(` ${capacites.length} capacités, `));
    await expect(dessin.locator("rect")).toHaveCount(capacites.length);
    await expect(barre.getByTestId("couverture-legende").locator("li").first()).toHaveText(
      `${deployees} déployées, non éprouvées`,
    );
  });
});

// ─── P**.5 — Partie 3 : TP4 côté « Ce qui reste », sur la page À faire depuis le 30/09/2026

test.describe("P**.5 — Partie 3 : ce qui reste pour un vrai outil de RUM (page À faire)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Verdict de chaque ligne de capacité, relu dans l'extraction du document de couverture. */
  const verdictsDuDocument = (): Map<string, string> => {
    const brut = JSON.parse(
      readFileSync(join(process.cwd(), "apps/console/lib/couverture.generated.json"), "utf8"),
    ) as { capacites: { id: string; verdict: string }[] };
    return new Map(brut.capacites.map((c) => [c.id, c.verdict]));
  };

  test("TP4 — D14 (pour les sites des clients) a sa pastille dans « Ce qui reste » ; D12, retirée, n'en a plus", async ({ page }) => {
    const verdicts = verdictsDuDocument();
    await page.goto(aFaireUrl);
    const reste = page.locator("section#reste");
    const pastille = reste.locator('[data-testid="reste-pastille"][data-id="D14"]');
    await expect(pastille).toHaveCount(1);
    await expect(pastille).toBeVisible();
    await expect(pastille).toHaveText("D14");
    await expect(pastille).toHaveAttribute("data-verdict", verdicts.get("D14") ?? "absente du document");
    // Les tickets sont retirés le 29/09/2026 : R7 est sorti de la liste, sans pastille.
    await expect(reste.locator('[data-testid="reste-pastille"][data-id="D12"]')).toHaveCount(0);
  });

  test("neuf points dans l'ordre du plan, chacun avec ce qui manque, ce qui le débloque et qui décide", async ({ page }) => {
    await page.goto(aFaireUrl);
    const points = page.locator('section#reste [data-testid="reste-point"]');
    await expect(points).toHaveCount(9);
    // R2 (la reprise de l'historique) est sorti le 28/09/2026 : fait ; R7 (les tickets)
    // le 29/09/2026 : retirés. Les identifiants ne sont pas renumérotés, la page affiche le rang.
    expect(await points.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")))).toEqual([
      "R1", "R3", "R4", "R5", "R6", "R8", "R9", "R10", "R11",
    ]);
    for (const point of await points.all()) {
      await expect(point.getByRole("heading", { level: 3 })).toHaveCount(1);
      await expect(point.locator("dt")).toHaveText(["Ce qui manque", "Ce qui le débloque", "Qui décide"]);
      for (const valeur of await point.locator("dd").all()) await expect(valeur).not.toBeEmpty();
    }
    // R2 et R7 sont dits sous la liste, avec l'ancre que vise l'annexe (D8, D9 ; D12, D13).
    const faits = page.locator('section#reste [data-testid="reste-fait"]');
    await expect(faits).toHaveCount(2);
    expect(await faits.evaluateAll((els) => els.map((e) => e.getAttribute("data-id")))).toEqual(["R2", "R7"]);
    await expect(faits.locator("#reste-R2-titre")).toHaveText("Reprise de l'historique des erreurs");
    await expect(faits.locator("#reste-R7-titre")).toHaveText("Tickets depuis une issue");
    // R1 (28/09/2026) : la recette est datée, et il ne reste que l'écran mobile.
    await expect(points.nth(0)).toContainText("Le 28/09/2026, des écrans ont été relus");
    await expect(points.nth(0)).toContainText("L'écran mobile, lui, n'a encore reçu aucune donnée réelle");
  });

  test("chaque pastille est une ligne du document de couverture, avec son verdict", async ({ page }) => {
    const verdicts = verdictsDuDocument();
    await page.goto(aFaireUrl);
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
    await page.goto(grapheUrl);
    const annexe = page.locator("section#detail");
    await expect(annexe).toContainText(`Le registre des capacités au ${doc.releve}`);

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
    for (const nom of ["Identifiant", "Capacité", "Verdict", "Sa limite"]) {
      await expect(premiere.getByRole("columnheader", { name: nom, exact: true })).toBeVisible();
    }
    const ligne = premiere.getByTestId("annexe-capacite").first();
    const c0 = doc.capacites.filter((c) => c.famille === doc.familles[0])[0];
    await expect(ligne.getByRole("rowheader")).toHaveText(c0.id);
    // Trois cellules non vides : capacité, verdict ÉCRIT (pas seulement une teinte), et
    // le renvoi vers la carte ou le point qui dit sa limite, dont la cible existe.
    for (const cellule of await ligne.getByRole("cell").all()) await expect(cellule).not.toBeEmpty();
    const renvois = await annexe.getByTestId("annexe-capacite").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    expect(renvois.length).toBe(doc.capacites.length);
    // Une carte est dans la page (#…) ; un point de « Ce qui reste » est sur la page À faire.
    const distincts = [...new Set(renvois)];
    const versAFaire = distincts.filter((h) => !h.startsWith("#"));
    for (const href of versAFaire) expect(href, "renvoi hors de la page").toMatch(/^\/presentation\/a-faire#reste-/);
    for (const href of distincts.filter((h) => h.startsWith("#"))) await expect(page.locator(href), href).toHaveCount(1);

    // Le Markdown du document est rendu : ni astérisques ni accents graves à l'écran.
    const brut = await annexe.getByTestId("annexe-couverture").evaluate((el) => el.textContent ?? "");
    expect(brut).not.toMatch(/\*\*|`/);

    // Les renvois vers la page À faire y trouvent leur point.
    await page.goto(aFaireUrl);
    for (const href of versAFaire) {
      await expect(page.locator(`section#reste ${href.slice(href.indexOf("#"))}`), href).toHaveCount(1);
    }
  });

  test("PS11 — familles ouvertes : rien ne dépasse à 390, 768, 1440 px ; sous 1024 px, une ligne s'empile", async ({
    page,
  }) => {
    await page.goto(grapheUrl);
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
    await page.goto(grapheUrl);
    const sommaire = page.getByRole("navigation", { name: "Sommaire de la présentation" });

    // 1. Tab depuis le haut de la page atteint le sommaire, par son premier lien. Avant
    //    lui : la barre de navigation et le récit de l'ancienne vitrine (liens, preuves).
    const dansSommaire = () => sommaire.evaluate((nav) => nav.contains(document.activeElement));
    for (let i = 0; i < 60 && !(await dansSommaire()); i++) await page.keyboard.press("Tab");
    await expect(sommaire.getByRole("link").first()).toBeFocused();

    // 2. Tab jusqu'à « Le détail », Entrée : le focus passe sur le titre de la partie.
    //    « Ce qui reste » n'est plus au sommaire : il vit dans la page À faire.
    const detail = sommaire.getByRole("link", { name: "Le détail", exact: true });
    for (let i = 0; i < 5 && !(await detail.evaluate((a) => a === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(detail).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detail-titre")).toBeFocused();

    // 3. De son titre, Tab parcourt les familles une à une, et Entrée ouvre puis
    //    referme une famille.
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
    await expect(page).toHaveURL(/\/presentation\/graphe-technique#detail-titre$/);
  });
});

// ─── P**.8 — Recette : TP5 (débordements), TP8 (images et légende), TP12 (mouvement réduit)
//
// Les trois tests du § 8.5 qu'aucun lot n'avait écrits ; les neuf autres sont dans
// les blocs ci-dessus (TP1, TP2, TP9 : P**.2 ; TP7, TP10 : P**.3 ; TP3 et TP4 :
// P**.4 ; TP4 : P**.5 ; TP6, TP11 : P**.6). La bascule vers master attend les douze.
//
// TP8 est ici, pas avec P**.7 : sa règle de date (« une date si et seulement si
// public/portail/manifest.json existe ») le rend vrai avant les nouvelles captures
// comme après. P**.7 le rejoue ; il n'a pas à l'écrire.

// Imports DE CE BLOC, même convention que P**.3 : sous le repère, noms suffixés.
import { existsSync as existsSyncPss8 } from "node:fs";
import type { Locator as LocatorPss8 } from "@playwright/test";
import { LARGEURS as LARGEURS_PSS8, debordements as debordementsPss8 } from "./helpers/debordements";

test.describe("P**.8 — recette de la page : largeurs, images, mouvement réduit", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Colonnes d'une grille de cartes : le nombre de bords gauches distincts, au pixel près. */
  const colonnes = (cartes: LocatorPss8) =>
    cartes.evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().left))).size);

  /**
   * Cartes de capacité par rangée (PS7) : une à 390 px, deux à partir de 768 — en
   * colonnes de texte depuis la recette du 26/09/2026 (trois colonnes de grille
   * laissaient jusqu'à 450 px de blanc sous les cartes courtes).
   */
  const COLONNES_CAPACITES: Record<(typeof LARGEURS_PSS8)[number], number> = { 390: 1, 768: 2, 1440: 2 };

  test("TP-V1 — la vitrine : rien ne dépasse à 390, 768 et 1440 px, du film à la dernière étape de l'aperçu", async ({
    page,
  }) => {
    const fautes: string[] = [];
    for (const largeur of LARGEURS_PSS8) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${consoleUrl}/presentation`);
      await expect(page.getByTestId("vitrine-film")).toBeVisible();
      for (const f of await debordementsPss8(page)) fautes.push(`${largeur} px, film — ${f}`);
      // Chaque étape de l'aperçu : la section épinglée ne doit rien pousser hors de l'écran.
      const etapes = await page.getByTestId("apercu-legende").count();
      for (let k = 0; k < etapes; k++) {
        await page.getByRole("button", { name: new RegExp(`^${["Santé", "Pages", "Erreurs", "Session", "Tracing", "Assistant"][k]}$`) }).click();
        await expect(page.getByTestId("apercu-legende").nth(k)).toHaveAttribute("data-actif", "true");
        for (const f of await debordementsPss8(page)) fautes.push(`${largeur} px, étape ${k + 1} — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });

  test("TP5 — le graphe technique : la barre de navigation et les preuves suivent la largeur", async ({ page }) => {
    for (const largeur of LARGEURS_PSS8) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(grapheUrl);
      const nav = page.getByTestId("nav-vitrine");
      const menu = nav.getByRole("button", { name: "Ouvrir le menu" });
      // Le menu s'affiche à partir de 1024 px ; en dessous, il est derrière le bouton.
      if (largeur < 1024) {
        await expect(menu).toBeVisible();
        await expect(nav.getByRole("link", { name: "Graphe technique", exact: true })).toHaveCount(0);
      } else {
        await expect(menu).toBeHidden();
        await expect(nav.getByRole("link", { name: "Graphe technique", exact: true })).toBeVisible();
      }
      // Sous 640 px, les boutons de droite passent dans le panneau du menu : le premier
      // écran d'un téléphone n'a qu'une rangée d'actions.
      const connexion = page.getByTestId("nav-connexion");
      if (largeur === 390) {
        await expect(connexion).toBeHidden();
        // Composant client : un clic parti avant l'hydratation serait perdu, on le rejoue.
        const panneau = page.locator("#nav-panneau");
        await expect(async () => {
          if (!(await panneau.isVisible())) await nav.getByRole("button", { name: "Ouvrir le menu" }).click();
          await expect(panneau).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 15_000 });
        await expect(panneau.getByRole("link", { name: "Se connecter", exact: true })).toHaveAttribute("href", "/login");
        await expect(panneau.getByRole("link", { name: "À faire", exact: true })).toHaveAttribute("href", "/presentation/a-faire");
      } else {
        await expect(connexion).toBeVisible();
      }
      // Contre-recette du 26/09/2026 : à 390 px, les preuves réduisaient une zone de
      // 700 à 1 140 px de capture à l'échelle 0,4 (texte de 5 px). Sous 640 px, des
      // cadres étroits, jamais réduits ni agrandis ; au-delà, la zone large.
      const etroites = page.getByTestId("preuve-etroite");
      const larges = page.getByTestId("preuve-large");
      await expect(etroites.filter({ visible: true })).toHaveCount(largeur === 390 ? 3 : 0);
      await expect(larges.filter({ visible: true })).toHaveCount(largeur === 390 ? 0 : 3);
      if (largeur === 390) {
        const echelles = await etroites.locator("img:visible").evaluateAll((imgs) =>
          imgs.map((img) => (img as HTMLImageElement).getBoundingClientRect().width / 1440),
        );
        for (const e of echelles) expect(e, "échelle d'une capture à 390 px").toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  test("TP5 — le graphe technique : rien ne dépasse à 390, 768 et 1440 px, même tout déplié ; à 390 px, les cartes sur une colonne", async ({
    page,
  }) => {
    const fautes: string[] = [];
    for (const largeur of LARGEURS_PSS8) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(grapheUrl);
      // Les Specs arrivent sous <Suspense> : on mesure la page finie, pas son squelette.
      await expect(page.locator("#specs-infra")).toBeAttached();
      await expect(page.getByTestId("specs-chargement")).toHaveCount(0);
      for (const f of await debordementsPss8(page)) fautes.push(`${largeur} px, au chargement — ${f}`);

      // Puis tout ce qu'un visiteur peut déplier : chaque <details> (alternatives
      // textuelles, familles de l'annexe), et chacun des trois onglets des Specs — un
      // panneau caché n'a pas de largeur, il ne déborde qu'une fois ouvert.
      await page.evaluate(() =>
        document.querySelectorAll("details").forEach((d) => {
          d.open = true;
        }),
      );
      for (const onglet of ["infra", "mesures", "ecart"]) {
        await page.locator(`label[for="specs-${onglet}"]`).click();
        await expect(page.locator(`[data-testid="specs-panneau"][data-onglet="${onglet}"]`)).toBeVisible();
        for (const f of await debordementsPss8(page)) fautes.push(`${largeur} px, tout déplié, onglet ${onglet} — ${f}`);
      }

      const capacites = page.locator("section#sait-faire").getByTestId("capacite");
      expect(await colonnes(capacites), `${largeur} px : cartes de capacité par rangée`).toBe(COLONNES_CAPACITES[largeur]);
      if (largeur === 390) {
        const ecrans = page.getByTestId("ecrans-categorie");
        expect(await ecrans.count(), "écrans de la console").toBeGreaterThan(0);
        expect(await colonnes(ecrans), "390 px : écrans de la console sur une colonne").toBe(1);
      }
    }
    expect(fautes).toEqual([]);
  });

  test("TP5 — la page À faire : rien ne dépasse à 390, 768 et 1440 px ; à 390 px, les cartes sur une colonne", async ({
    page,
  }) => {
    const fautes: string[] = [];
    for (const largeur of LARGEURS_PSS8) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(aFaireUrl);
      await expect(page.locator("section#reste")).toBeVisible();
      for (const f of await debordementsPss8(page)) fautes.push(`${largeur} px — ${f}`);
      if (largeur === 390) {
        const cartes = [
          ["hypothèses réductrices", page.getByTestId("hypothese")],
          ["points de « Ce qui reste »", page.locator("section#reste").getByTestId("reste-point")],
        ] as const;
        for (const [nom, lot] of cartes) {
          expect(await lot.count(), nom).toBeGreaterThan(0);
          expect(await colonnes(lot), `390 px : ${nom} sur une colonne`).toBe(1);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  test("TP5 — les pages des parcours : l'essentiel et le tutoriel, rien ne dépasse à 390, 768 et 1440 px, à chaque étape", async ({
    page,
  }) => {
    const fautes: string[] = [];
    for (const [id, segment] of [
      ["snippet", "sdk-javascript"],
      ["extension", "extension"],
      ["serveur", "serveur"],
    ] as const) {
      for (const largeur of LARGEURS_PSS8) {
        await page.setViewportSize({ width: largeur, height: 900 });
        await page.goto(`${consoleUrl}/presentation/installation/${segment}`);
        await expect(page.getByTestId(`page-parcours-${id}`)).toBeVisible();
        await expect(page.getByTestId("faits-parcours").getByRole("listitem")).toHaveCount(4);
        // La check-list détaillée vit dans la console : la page publique n'en a plus.
        await expect(page.getByTestId("bandeau-ia")).toHaveCount(0);
        for (const f of await debordementsPss8(page)) fautes.push(`${segment}, ${largeur} px, au chargement — ${f}`);
        // Le tutoriel : chaque bouton d'étape y mène, et la scène suit.
        const etapes = page.getByRole("navigation", { name: /^Étapes : / }).getByRole("button");
        await expect(etapes).toHaveCount(5);
        for (let k = 0; k < 5; k++) {
          await etapes.nth(k).click();
          await expect(etapes.nth(k)).toHaveAttribute("aria-current", "step");
          for (const f of await debordementsPss8(page)) fautes.push(`${segment}, ${largeur} px, étape ${k + 1} — ${f}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  test("TP8 — une image dit ce qu'elle montre ou se tait ; la légende dit « jeu de démonstration », datée par le seul manifeste", async ({
    page,
  }) => {
    await page.goto(grapheUrl);
    const images = await page.locator("img").evaluateAll((imgs) =>
      imgs.map((img) => ({
        src: img.getAttribute("src") ?? "",
        alt: (img.getAttribute("alt") ?? "").trim(),
        masquee: img.getAttribute("aria-hidden") === "true",
      })),
    );
    expect(images.length, "la capture de la console").toBeGreaterThan(0);
    for (const i of images) expect(i.alt !== "" || i.masquee, `${i.src} : ni alt ni aria-hidden`).toBe(true);

    // Trois preuves, une légende (au pluriel depuis la recette du 26/09/2026).
    await expect(page.getByTestId("preuve")).toHaveCount(3);
    const legende = page.locator("main p", { hasText: "Captures réelles de la console" });
    await expect(legende).toHaveCount(1);
    await expect(legende).toContainText("jeu de démonstration");
    // La date d'une capture vient du manifeste des captures (P**.7) ; sans lui, elle
    // n'est pas établie, et la légende n'en invente pas.
    const manifeste = existsSyncPss8(join(process.cwd(), "apps/console/public/portail/manifest.json"));
    const datee = /\b\d{2}\/\d{2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(await legende.innerText());
    expect(datee, manifeste ? "manifeste présent : la légende porte une date" : "sans manifeste : aucune date").toBe(
      manifeste,
    );
  });

  test("TP8 — thème clair ou sombre demandé, les pages du menu restent sombres : captures sombres visibles, claires masquées", async ({
    page,
  }) => {
    // Depuis le 30/09/2026, le gabarit des pages du menu (PageVitrine.tsx) pose la classe
    // `dark` lui-même, comme la vitrine : la préférence du système ne change plus rien.
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(grapheUrl);
      // Le conteneur du gabarit, pas <html> : le script anti-flash n'y met `dark` qu'en thème sombre.
      await expect(page.locator("div.dark").filter({ has: page.getByTestId("page-graphe") }), colorScheme).toHaveCount(1);
      // Chaque capture a deux cadres (étroit sous 640 px, large au-delà) : un seul se voit.
      await expect(page.locator('img[src*="overview-dark"]').filter({ visible: true }), colorScheme).toHaveCount(1);
      await expect(page.locator('img[src*="overview-light"]').filter({ visible: true }), colorScheme).toHaveCount(0);
      // Le mobile a sa capture sombre (contre-recette du 26/09/2026) : plus d'image claire.
      await expect(page.locator('img[src*="mobile-dark"]').filter({ visible: true }), colorScheme).toHaveCount(1);
      await expect(page.locator('img[src*="mobile-light"]').filter({ visible: true }), colorScheme).toHaveCount(0);
    }
  });

  test("TP12 — mouvement réduit : les flèches du chemin de la mesure s'arrêtent, et rien d'autre ne bouge", async ({
    page,
  }) => {
    const fleches = page.locator(".mip-fleche");
    const etat = () =>
      fleches.evaluateAll((els) =>
        els.map((el) => ({ nom: getComputedStyle(el).animationName, animations: el.getAnimations().length })),
      );

    // Témoin : sans préférence, les flèches dérivent (Capteurs.tsx, globals.css). Sans
    // lui, une classe renommée ferait passer le test à vide.
    // Les flèches sont au graphe technique (Capteurs.tsx).
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(grapheUrl);
    const libres = await etat();
    expect(libres.length, "des flèches dans le chemin de la mesure").toBeGreaterThan(0);
    for (const f of libres) {
      expect(f.nom).toBe("mip-derive");
      expect(f.animations).toBeGreaterThan(0);
    }

    // Mouvement réduit demandé : aucune animation sur les flèches…
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(grapheUrl);
    const reduites = await etat();
    expect(reduites.length).toBe(libres.length);
    for (const f of reduites) {
      expect(f.nom).toBe("none");
      expect(f.animations).toBe(0);
    }
    // … ni ailleurs dans la page (§ 3.9) : les entrées en fondu y durent 0,01 ms.
    await expect
      .poll(() =>
        page
          .locator("main")
          .evaluate((m) => m.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length),
      )
      .toBe(0);
  });
});

// ─── Cartographie du graphe technique (30/09/2026) ─────────────────────────────
//
// Tout MIP RUM sur une carte qu'on explore (components/presentation/cartographie).
// Ce que la carte DIT est confronté au dépôt par tests/unit/cartographie.test.ts ;
// ici, qu'on puisse s'en servir : une fiche au clic, la recherche, un parcours, les
// familles, le plein écran, et une version texte qui compte les mêmes éléments.

test.describe("cartographie du graphe technique", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("la carte s'explore : fiche, voisins, recherche, parcours, familles, plein écran", async ({ page }) => {
    await page.goto(grapheUrl);
    const carte = page.getByTestId("cartographie");
    const noeuds = carte.locator(".react-flow__node-element");
    await expect(noeuds.first()).toBeVisible({ timeout: 60_000 });
    const total = await noeuds.count();
    expect(total, "des éléments sur la carte").toBeGreaterThan(60);
    // La version texte, rendue côté serveur, compte les mêmes éléments.
    await expect(page.getByTestId("carte-texte")).toContainText(`${total} éléments`);

    // Un clic : la fiche, ses sources sur le dépôt public, et le reste estompé.
    await carte.getByTestId("carte-element-collector").click();
    const fiche = page.getByTestId("carte-panneau");
    await expect(fiche.getByRole("heading", { name: "collector", exact: true })).toBeVisible();
    await expect(fiche.locator('a[href^="https://github.com/jt33120/poc-MIP_RUM/blob/master/"]').first()).toBeVisible();
    await expect(carte.locator('[data-eclairage="estompe"]').first()).toBeAttached();
    // Un voisin de la fiche y mène.
    await fiche.getByRole("button", { name: /Mesures brutes/ }).click();
    await expect(fiche.getByRole("heading", { name: "Mesures brutes", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fiche).toHaveCount(0);

    // La recherche trouve une table dans son domaine.
    await page.getByTestId("carte-recherche").fill("replay_chunk");
    await expect(page.getByTestId("carte-resultats")).toContainText("Rejeu");
    await page.keyboard.press("Enter");
    await expect(fiche.getByRole("heading", { name: "Rejeu", exact: true })).toBeVisible();
    await expect(fiche).toContainText("replay_chunk");
    await page.keyboard.press("Escape");

    // Un parcours guidé, étape par étape ; Échap le quitte.
    await page.getByTestId("carte-parcours-mesure").click();
    const etape = page.getByTestId("carte-etape");
    await expect(etape).toContainText("étape 1 sur");
    await page.getByTestId("carte-etape-suivante").click();
    await expect(etape).toContainText("étape 2 sur");
    await expect(carte.locator('[data-eclairage="avant"]').first()).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(etape).toHaveCount(0);

    // Masquer une famille retire ses éléments ; la remontrer les rend.
    await page.getByTestId("carte-famille-securite").click();
    await expect(page.getByTestId("carte-famille-securite")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => noeuds.count()).toBeLessThan(total);
    await page.getByTestId("carte-famille-securite").click();
    await expect.poll(() => noeuds.count()).toBe(total);

    // Le plein écran couvre la fenêtre ; Échap en sort.
    await page.getByTestId("carte-plein-ecran").click();
    await expect(carte).toHaveAttribute("data-plein-ecran", "true");
    const boite = await carte.boundingBox();
    expect(boite?.width).toBe(1440);
    expect(boite?.height).toBe(900);
    await page.keyboard.press("Escape");
    await expect(carte).not.toHaveAttribute("data-plein-ecran", "true");
  });
});
