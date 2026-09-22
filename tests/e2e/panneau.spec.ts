// E2E — F07 : le panneau latéral de détail (`DetailPanel`) et la cascade (`Cascade`).
//
// Joué sur la vitrine /admin/composants (section « DetailPanel ») : F07 ne branche le
// panneau sur aucun écran (F17, F20, F43 le feront), la vitrine en porte une liste
// de trois routes qui l'ouvrent par l'URL (`?panel=route:<route>`).
//
// Ce que le lot promet (plan § 3.5, § 4.2, § 6.4) :
//   - clavier : le focus va au titre à l'ouverture ; ↓ / ↑ parcourent la liste ;
//     Échap ferme (le paramètre `panel` part de l'URL) ;
//   - largeur : plein écran de 390 à 1279 px, la moitié de la zone de contenu au-delà ;
//   - sans JavaScript : le panneau est dans le HTML, ses liens suffisent.
//
// Aucune donnée à semer : la vitrine rend des données FIXES. Un compte admin DÉDIÉ,
// jamais le compte admin local de seed-admin.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const ADMIN = { email: "e2e-panneau-admin@mip-rum.local", motDePasse: "e2e-panneau-admin-mdp" };
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const VITRINE = `${consoleUrl}/admin/composants`;
const SIDEBAR_PX = 256;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

function bcryptHash(password: string): string {
  return execFileSync(
    "node",
    [
      "-e",
      `const { createRequire } = require("node:module");
       const req = createRequire(process.cwd() + "/apps/console/package.json");
       const m = req("bcryptjs");
       const bcrypt = m.hashSync ? m : m.default;
       process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
      password,
    ],
    { encoding: "utf8" },
  );
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [ADMIN.email, bcryptHash(ADMIN.motDePasse)],
  );
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[name="password"]', ADMIN.motDePasse);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** `panel=route:<route encodée>` (lib/view-state.ts, `ecrirePanel`), encodé à son tour dans l'URL. */
function avecPanneau(route: string): string {
  return `${VITRINE}?${new URLSearchParams({ panel: `route:${encodeURIComponent(route)}` })}`;
}

/** Valeur du paramètre `panel` de l'URL courante, décodée une fois (comme `searchParams.get`). */
function panneauOuvert(page: Page): string | null {
  return new URL(page.url()).searchParams.get("panel");
}

/**
 * Éléments qui dépassent la fenêtre à droite, hors conteneur défilant — même
 * helper que tests/e2e/composants.spec.ts (extrait vers helpers/ par F09).
 */
async function debordements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const totale = document.documentElement.scrollWidth;
    if (totale <= largeur) return [];
    const dansDefilant = (el: Element) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX)) return true;
      }
      return false;
    };
    const fautifs = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= largeur + 1) return false;
        return ["absolute", "fixed"].includes(getComputedStyle(el).position) || !dansDefilant(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} « ${el.textContent?.trim().slice(0, 60) ?? ""} » → ${Math.round(el.getBoundingClientRect().right)} px`);
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test("clavier : focus sur le titre à l'ouverture, ↓ / ↑ parcourent la liste, Échap ferme", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto(VITRINE, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("detail-panel")).toHaveCount(0);

  // Ouverture depuis la liste : l'URL porte le panneau, le focus va au titre.
  await page.getByTestId("panneau-liste").getByRole("link", { name: /^\/panier/ }).click();
  await expect.poll(() => panneauOuvert(page)).toBe("route:%2Fpanier");
  const panneau = page.getByTestId("detail-panel");
  const titre = page.locator("#panneau-detail-titre");
  await expect(panneau).toBeVisible();
  await expect(panneau).toHaveAttribute("aria-labelledby", "panneau-detail-titre");
  await expect(titre).toHaveText("/panier");
  await expect(titre).toBeFocused();
  // Onglets comptés : l'inconnu s'écrit « (—) », jamais « (0) ».
  await expect(panneau.getByRole("link", { name: /^Erreurs \(—\)/ })).toBeVisible();

  // ↓ : élément suivant, focus de nouveau sur le titre.
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => panneauOuvert(page)).toBe("route:%2Fproduit%2F%5Bid%5D");
  await expect(titre).toHaveText("/produit/[id]");
  await expect(titre).toBeFocused();

  // Bout de liste : « Suivant » est éteint, ↓ ne mène nulle part.
  await expect(panneau.locator('[aria-disabled="true"]', { hasText: "Suivant" })).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  // Attente bornée : on vérifie qu'il ne se passe RIEN, ce qui n'a pas d'événement à attendre.
  await page.waitForTimeout(500);
  expect(panneauOuvert(page)).toBe("route:%2Fproduit%2F%5Bid%5D");

  // ↑ ↑ : retour au premier.
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => panneauOuvert(page)).toBe("route:%2Fpanier");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => panneauOuvert(page)).toBe("route:%2Fcheckout");
  await expect(titre).toHaveText("/checkout");
  await expect(titre).toBeFocused();
  await expect(panneau.locator('[aria-disabled="true"]', { hasText: "Précédent" })).toHaveCount(1);

  // Échap : le paramètre part de l'URL, le panneau aussi.
  await page.keyboard.press("Escape");
  await expect.poll(() => panneauOuvert(page)).toBeNull();
  await expect(page.getByTestId("detail-panel")).toHaveCount(0);
});

test("largeur : plein écran à 390 et 1024 px (bouton « Fermer » en tête), moitié de la zone de contenu à 1440 px", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  const fautes: string[] = [];

  for (const [largeur, hauteur] of [
    [390, 844],
    [1024, 768],
  ] as const) {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await page.goto(avecPanneau("/checkout"), { waitUntil: "domcontentloaded" });
    const panneau = page.getByTestId("detail-panel");
    await expect(panneau).toBeVisible();
    const boite = (await panneau.boundingBox())!;
    expect(boite.x, `${largeur} px : bord gauche`).toBe(0);
    expect(boite.y, `${largeur} px : bord haut`).toBe(0);
    expect(boite.width, `${largeur} px : plein écran`).toBeGreaterThanOrEqual(largeur - 20);
    expect(boite.height, `${largeur} px : pleine hauteur`).toBeGreaterThanOrEqual(hauteur - 1);
    const fermer = (await page.getByTestId("detail-panel-fermer").boundingBox())!;
    expect(fermer.y, "« Fermer » en tête").toBeLessThan(80);
    expect(fermer.x + fermer.width).toBeLessThanOrEqual(largeur);
    for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(avecPanneau("/checkout"), { waitUntil: "domcontentloaded" });
  const boite = (await page.getByTestId("detail-panel").boundingBox())!;
  const moitie = (1440 - SIDEBAR_PX) / 2;
  expect(Math.abs(boite.width - moitie), `largeur ${boite.width} px, attendu ≈ ${moitie} px`).toBeLessThan(12);
  expect(Math.abs(boite.x + boite.width - 1440)).toBeLessThan(2);
  // La liste reste lisible à gauche du panneau.
  const liste = (await page.getByTestId("panneau-liste").boundingBox())!;
  expect(liste.x).toBeLessThan(boite.x);
  for (const faute of await debordements(page)) fautes.push(`1440 px — ${faute}`);

  expect(fautes).toEqual([]);
});

test("sans JavaScript : le panneau est dans le HTML, ses liens suffisent", async ({ browser, page }) => {
  await login(page);
  const contexte = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: "reduce",
    storageState: await page.context().storageState(),
  });
  const sansJs = await contexte.newPage();
  try {
    await sansJs.goto(avecPanneau("/panier"), { waitUntil: "domcontentloaded" });
    await expect(sansJs.getByTestId("detail-panel")).toBeVisible();
    await expect(sansJs.locator("#panneau-detail-titre")).toHaveText("/panier");
    await sansJs.getByTestId("detail-panel").getByRole("link", { name: /Suivant/ }).click();
    await expect(sansJs.locator("#panneau-detail-titre")).toHaveText("/produit/[id]");
    await sansJs.getByTestId("detail-panel-fermer").click();
    await expect(sansJs.getByTestId("detail-panel")).toHaveCount(0);
    expect(panneauOuvert(sansJs)).toBeNull();
  } finally {
    await contexte.close();
  }
});

test("cascade : la couleur dit la sévérité (doublée d'un texte), « partiel » est écrit en tête", async ({ page }) => {
  await login(page);
  await page.goto(VITRINE, { waitUntil: "domcontentloaded" });

  const trace = page.locator("#cascade-trace");
  await expect(trace.locator('[data-testid="cascade-element"][data-ton="erreur"]')).toHaveCount(2);
  await expect(trace.locator('[data-testid="cascade-element"][data-ton="warn"]')).toContainText("à surveiller");
  await expect(trace.locator('[data-testid="cascade-element"][aria-current="true"]')).toContainText("UPDATE stock");

  const vue = page.locator("#cascade-vue");
  const bandeau = (await vue.getByTestId("etat-partiel").boundingBox())!;
  const dessin = (await vue.getByTestId("cascade-apercu").boundingBox())!;
  expect(bandeau.y).toBeLessThan(dessin.y);
  await expect(vue.getByTestId("etat-partiel")).toContainText("ressources de plus de 300 ms seulement");
  await expect(vue.getByText("LCP 2,7 s · À améliorer")).toBeVisible();

  // Hauteur réduite : l'aperçu seul.
  await expect(page.locator("#cascade-reduite").getByTestId("cascade-apercu")).toBeVisible();
  await expect(page.locator("#cascade-reduite").getByTestId("cascade-elements")).toHaveCount(0);
});
