// P6.4 — l'Explorer générique, dans un vrai navigateur.
//
// Ce qui ne se prouve qu'ici : le fait que RIEN ne parte avant « Exécuter ». Le
// builder est un formulaire ; aucune requête n'est lancée à la frappe, et l'URL
// obtenue rejoue la même analyse. S'y ajoutent le résumé de ce qui est
// RÉELLEMENT appliqué, l'accès clavier, et l'absence de débordement horizontal
// aux trois largeurs de référence.
//
// La population est resserrée sur une release propre à ce test : les autres
// suites écrivent dans la même app, et un total global serait un total partagé.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const SESSION = "p64-explorer-session";
const RELEASE = "p64-e2e-rel";
const FINGERPRINT = "p64-e2e-fp";
let adminPassword = "";

/** Trois lignes, deux routes, six occurrences : la somme ≠ le nombre de lignes. */
const LIGNES: [string, number][] = [
  ["/p64-explorer-a", 2],
  ["/p64-explorer-a", 2],
  ["/p64-explorer-b", 2],
];

test.beforeAll(async () => {
  const out = execFileSync("node", ["scripts/seed-admin.mjs"], { encoding: "utf8" });
  adminPassword = out.match(/julian@mip-rum\.local.*?:\s*(\S+)/s)?.[1] ?? "";
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(
    `insert into rum_session (session_id,app_id,device_type,geo_country,sample_rate,error_sample_rate,last_seen_at)
     values ($1,'demo-app','desktop','FR',1,1,now())
     on conflict (session_id) do update set last_seen_at = now(), device_type = 'desktop'`,
    [SESSION],
  );
  await pool.query(`delete from rum_error where fingerprint = $1`, [FINGERPRINT]);
  for (const [route, occurrences] of LIGNES) {
    await pool.query(
      `insert into rum_error (app_id,session_id,fingerprint,error_type,message,kind,route,release,occurrences,ts)
       values ('demo-app',$1,$2,'TypeError','boom','error',$3,$4,$5, now())`,
      [SESSION, FINGERPRINT, route, RELEASE, occurrences],
    );
  }
});

test.afterAll(async () => {
  await pool.query(`delete from rum_error where fingerprint = $1`, [FINGERPRINT]);
  await pool.query(`delete from rum_session where session_id = $1`, [SESSION]);
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', "julian@mip-rum.local");
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: "demo-app", url: consoleUrl }]);
}

/** URL de l'Explorer restreinte à la population de ce test. */
const base = `${consoleUrl}/explorer?app=demo-app&period=1h&release=${RELEASE}&dataset=errors`;

/**
 * L'Explorer déborde-t-il de la largeur qui lui est donnée ? La mesure porte sur
 * SON conteneur, pas sur le document : ce test répond de cet écran, et un défaut
 * de la coquille commune doit se voir là où il est, pas ici. Une tolérance d'un
 * pixel absorbe les arrondis de rendu.
 */
const deborde = (page: Page) =>
  page.evaluate(() => {
    const racine = document.querySelector('[data-testid="explorer-racine"]');
    if (!racine) return true;
    return racine.scrollWidth > racine.clientWidth + 1;
  });

test("rien ne part avant « Exécuter », puis la mesure composée est exacte", async ({ page }) => {
  await login(page);
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();

  // 1. Premier affichage : une invitation, pas un chiffre. Aucune requête n'a
  // été lancée, donc aucun total ne peut être affiché.
  await expect(page.getByTestId("explorer-invite")).toBeVisible();
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);

  // 2. Chaque contrôle porte un libellé — c'est ce dont dépendent le clavier et
  // les lecteurs d'écran. Les interactions passent ensuite par le nom du champ,
  // qui est aussi ce que l'URL transportera.
  for (const libelle of ["Mesure", "Représentation", "Grouper par"]) {
    await expect(page.getByLabel(libelle).first()).toBeVisible();
  }
  const champ = (nom: string) => page.locator(`select[name="${nom}"]`);
  await champ("measure").selectOption("occurrences:sum");
  await champ("viz").selectOption("toplist");
  await champ("g0").selectOption("route");
  await page.getByRole("button", { name: "Exécuter" }).click();

  // 3. Le total est la SOMME des occurrences (6), pas le nombre de lignes (3).
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });
  // Le libellé d'une barre apparaît dans un span titré : le titre le désigne
  // sans ambiguïté, là où une recherche par texte en trouverait deux imbriqués.
  await expect(page.getByTitle("/p64-explorer-a")).toBeVisible();
  await expect(page.getByTitle("/p64-explorer-b")).toBeVisible();

  // 4. Le résumé énonce ce qui est RÉELLEMENT appliqué, release comprise.
  const resume = page.getByTestId("explorer-resume");
  await expect(resume).toContainText("Somme — occurrences");
  await expect(resume).toContainText(`Release = ${RELEASE}`);
  await expect(resume).toContainText("robots exclus");
  await expect(resume).toContainText("groupé par route");

  // 5. L'URL rejoue l'analyse, et ne transporte aucun curseur.
  const url = new URL(page.url());
  expect(url.searchParams.get("run")).toBe("1");
  expect(url.searchParams.get("measure")).toBe("occurrences:sum");
  expect(url.searchParams.get("release")).toBe(RELEASE);
  expect(url.searchParams.has("cursor")).toBe(false);
  await page.goto(page.url());
  await expect(page.getByTestId("explorer-total")).toHaveText("6");
});

test("zéro réel, refus explicite et retour à l'invitation après changement de jeu", async ({ page }) => {
  await login(page);

  // Un zéro RÉEL : la population est vide, et l'écran le dit sans faire d'erreur.
  await page.goto(`${base}&measure=occurrences:sum&viz=value&route=/aucune-route-p64&run=1`);
  await expect(page.getByTestId("explorer-total")).toHaveText("0", { timeout: 15_000 });
  await expect(page.getByTestId("explorer-vide")).toBeVisible();

  // Une requête refusée dit POURQUOI et avec quel code, sans chiffre inventé.
  await page.goto(`${base}&measure=message:count&viz=value&run=1`);
  const refus = page.getByTestId("explorer-invalide");
  await expect(refus).toBeVisible();
  await expect(refus).toContainText("unsupported_measure");
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);

  // Changer de jeu de données redémarre le builder : les mesures d'un jeu
  // n'existent pas dans un autre, donc l'écran redemande « Exécuter ».
  await page.goto(`${base}&measure=occurrences:sum&viz=value&run=1`);
  await expect(page.getByTestId("explorer-total")).toBeVisible();
  await page.getByRole("link", { name: "Pages vues" }).click();
  await expect(page.getByTestId("explorer-invite")).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("run")).toBe(false);
  // Le contexte global, lui, a suivi.
  expect(new URL(page.url()).searchParams.get("release")).toBe(RELEASE);
});

test("accès clavier et aucune largeur qui déborde (390 / 768 / 1440 px)", async ({ page }) => {
  await login(page);
  await page.goto(base);

  // Le bouton s'active au clavier seul, sans souris.
  const executer = page.getByRole("button", { name: "Exécuter" });
  await executer.focus();
  await expect(executer).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("explorer-total")).toBeVisible({ timeout: 15_000 });

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}&measure=occurrences:sum&viz=table&limit=25&run=1`);
    await expect(page.getByTestId("explorer-resume")).toBeVisible({ timeout: 15_000 });
    expect(await deborde(page), `débordement horizontal à ${width} px`).toBe(false);
  }
});
