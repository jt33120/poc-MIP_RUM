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
//
// F31 : connexion par un utilisateur DÉDIÉ (comme `theme-contraste.spec.ts`) —
// rejouer ce spec ne réinitialise plus le mot de passe de l'administrateur local.
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
const E2E_EMAIL = "e2e-explorer@mip-rum.local";
const E2E_PASSWORD = "e2e-explorer-mdp-local";

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

/** Trois lignes, deux routes, six occurrences : la somme ≠ le nombre de lignes. */
const LIGNES: [string, number][] = [
  ["/p64-explorer-a", 2],
  ["/p64-explorer-a", 2],
  ["/p64-explorer-b", 2],
];

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
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
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
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
  // qui est aussi ce que l'URL transportera. F31 : la représentation n'est plus un
  // champ du formulaire mais une rangée d'onglets-liens ; sans exécution, en
  // changer n'exécute rien.
  for (const libelle of ["Mesure", "Grouper par"]) {
    await expect(page.getByLabel(libelle).first()).toBeVisible();
  }
  const representation = page.getByRole("navigation", { name: "Représentation" });
  await representation.getByRole("link", { name: "Classement" }).click();
  await page.waitForURL((u) => u.searchParams.get("viz") === "toplist", { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.has("run")).toBe(false);
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);
  const champ = (nom: string) => page.locator(`select[name="${nom}"]`);
  await champ("measure").selectOption("occurrences:sum");
  await champ("g0").selectOption("route");
  await page.getByRole("button", { name: "Exécuter" }).click();

  // 3. Le total est la SOMME des occurrences (6), pas le nombre de lignes (3).
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });
  // Le libellé d'une barre apparaît dans un span titré : le titre le désigne
  // sans ambiguïté, là où une recherche par texte en trouverait deux imbriqués.
  await expect(page.getByTitle("/p64-explorer-a")).toBeVisible();
  await expect(page.getByTitle("/p64-explorer-b")).toBeVisible();

  // 4. Le résumé énonce ce qui est RÉELLEMENT appliqué, release comprise. F31 : il
  // nomme le groupe de pastilles (`aria-label`), et chaque élément a sa pastille.
  const resume = page.getByTestId("requete-pastilles");
  await expect(resume).toHaveAttribute("aria-label", /Somme — occurrences/);
  await expect(resume).toHaveAttribute("aria-label", new RegExp(`Release = ${RELEASE}`));
  await expect(resume).toHaveAttribute("aria-label", /robots exclus/);
  await expect(resume).toHaveAttribute("aria-label", /groupé par route/);
  await expect(resume).toContainText(`Release = ${RELEASE}`);
  await expect(resume).toContainText("Groupé par route");

  // L'origine du chiffre est à l'écran (P6.6) : aucun agrégat ne porte les
  // occurrences d'erreurs, la somme vient donc des lignes, et l'écran le dit.
  await expect(page.getByTestId("explorer-source")).toHaveText("lignes brutes");

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

// F30 (CE6, P14) : une série temporelle superpose au plus cinq groupes. Le contrôle
// ne propose plus « 10 », et une URL qui l'impose est refusée avant toute lecture.
test("série temporelle : au plus 5 groupes, proposés comme exigés", async ({ page }) => {
  await login(page);
  await page.goto(`${base}&measure=occurrences:sum&viz=timeseries&g0=route&limit=3`);
  const options = await page.locator('select[name="limit"] option').allTextContents();
  expect(options.map((o) => o.trim())).toEqual(["1", "3", "5"]);

  await page.goto(`${base}&measure=occurrences:sum&viz=timeseries&g0=route&limit=10&run=1`);
  const echec = page.getByTestId("explorer-echec");
  await expect(echec).toBeVisible({ timeout: 15_000 });
  await expect(echec).toContainText("au plus 5 groupes");
  await expect(page.getByTestId("explorer-total")).toHaveCount(0);
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
    await expect(page.getByTestId("requete-pastilles")).toBeVisible({ timeout: 15_000 });
    expect(await deborde(page), `débordement horizontal à ${width} px`).toBe(false);
  }
});
