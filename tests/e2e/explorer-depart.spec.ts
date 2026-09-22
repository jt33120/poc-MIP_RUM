// E2E — F31 : l'Explorer se lit avant d'exécuter, et ne lit rien sans qu'on le demande.
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un Explorer ouvert sans `run` LISE quand même : les analyses de départ
//     sont des liens, et l'exécution reste explicite. Le piège est réel : pendant
//     l'affichage, la table des tâches longues est verrouillée en accès exclusif.
//     Une lecture de l'Explorer sur ce jeu attendrait le verrou jusqu'à son budget
//     (5 s) et l'écran afficherait « Budget de lecture dépassé » : son absence
//     prouve qu'aucune lecture n'est partie.
//   - Qu'une pastille « retirée » laisse sa condition, ou emporte un curseur
//     prélevé dans l'ancienne population.
//   - Qu'un onglet de représentation recompose la requête au lieu de la relire.
//   - Qu'une requête longue fasse déborder l'écran à 390 px.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, avec un utilisateur
// dédié (jamais le compte administrateur local, dont on ne touche pas le mot de passe).
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f31-e2e-app";
const RELEASE = "f31-e2e-rel";
const E2E_EMAIL = "e2e-explorer-depart@mip-rum.local";
const E2E_PASSWORD = "e2e-explorer-depart-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
/** Une route longue : la pastille qui la porte doit se tronquer, pas pousser la page. */
const ROUTE_LONGUE = "/f31-une-route-volontairement-tres-longue-pour-eprouver-la-pastille-a-trois-cent-quatre-vingt-dix-pixels";

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

/** Deux routes, six occurrences sur trois lignes : de quoi classer et tracer. */
async function semer() {
  for (const t of ["rum_error", "rum_session"]) await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Explorer F31 E2E') on conflict (app_id) do nothing`, [APP_ID]);
  const sid = `${APP_ID}-s1`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $1, 'desktop', false, now() - interval '30 minutes', now() - interval '20 minutes', 2)
     on conflict (session_id) do nothing`,
    [sid, APP_ID],
  );
  for (const [i, route] of ["/f31-a", "/f31-a", ROUTE_LONGUE].entries()) {
    await pool.query(
      `insert into rum_error (span_id, app_id, session_id, fingerprint, error_type, message, kind, route, release, occurrences, ts)
       values ($1, $2, $3, 'f31-e2e-fp', 'TypeError', 'boom', 'error', $4, $5, 2, now() - interval '25 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_ID}-err-${i}`, APP_ID, sid, route, RELEASE],
    );
  }
}

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await semer();
});

test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/**
 * Débordement horizontal : la liste des éléments fautifs, pas un simple booléen
 * (même helper que `analyses-drilldowns.spec.ts`, en attendant son extraction
 * vers `tests/e2e/helpers/debordements.ts` par F09). Un élément dans un
 * conteneur défilant est légitime ; un élément qui pousse la page ne l'est pas.
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
      .map((el) => {
        const parent = el.parentElement;
        const repere =
          parent?.querySelector("[aria-label]")?.getAttribute("aria-label") ??
          el.closest("section, h1, h2, h3")?.textContent?.trim().slice(0, 60) ??
          el.textContent?.trim().slice(0, 60) ??
          "";
        return `${el.tagName.toLowerCase()} « ${repere} » → ${Math.round(el.getBoundingClientRect().right)} px`;
      });
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

const liensModeles = (page: Page) => page.getByTestId("modeles-depart").getByRole("link");

test("sans `run` : six analyses de départ, formulaire ouvert, et AUCUNE lecture", async ({ page }) => {
  await login(page);

  // Le piège : la table du jeu affiché est verrouillée pendant tout l'affichage.
  const verrou = await pool.connect();
  try {
    await verrou.query("begin");
    await verrou.query("set local lock_timeout = '5s'");
    await verrou.query("lock table rum_longtask in access exclusive mode");
    // Un plan COMPLET et valide sur ce jeu, sans `run` : tout est prêt, rien ne part.
    await page.goto(
      `${consoleUrl}/explorer?app=${APP_ID}&dataset=longtasks&variant=loaf&measure=blocking_ms:p95&viz=toplist&g0=route&limit=10`,
      { timeout: 15_000 },
    );
    await expect(page.getByRole("heading", { name: "Analyses de départ" })).toBeVisible();
    await expect(liensModeles(page)).toHaveCount(6);
    await expect(page.getByTestId("explorer-echec")).toHaveCount(0);
    await expect(page.getByTestId("explorer-total")).toHaveCount(0);
    // Rien d'appliqué, donc aucune pastille.
    await expect(page.getByTestId("requete-pastilles")).toHaveCount(0);
  } finally {
    await verrou.query("rollback");
    verrou.release();
  }

  // Le formulaire est ouvert : c'est le geste attendu avant toute exécution.
  await expect(page.getByTestId("explorer-composer")).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Exécuter" })).toBeVisible();

  // Chaque analyse de départ est un lien EXÉCUTÉ qui garde l'app de l'écran.
  for (const href of await liensModeles(page).evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
    const sp = new URL(href, consoleUrl).searchParams;
    expect(sp.get("run"), href).toBe("1");
    expect(sp.get("app"), href).toBe(APP_ID);
    expect(sp.has("cursor"), href).toBe(false);
  }
});

test("une analyse de départ s'exécute, la requête se lit en pastilles, le formulaire se replie", async ({ page }) => {
  await login(page);
  await page.goto(`${consoleUrl}/explorer?app=${APP_ID}&period=1h&release=${RELEASE}`);
  await page.getByRole("link", { name: /Occurrences d.erreurs dans le temps/ }).click();
  await page.waitForURL((u) => u.searchParams.get("run") === "1", { timeout: 15_000 });

  const sp = new URL(page.url()).searchParams;
  expect(sp.get("dataset")).toBe("errors");
  expect(sp.get("measure")).toBe("occurrences:sum");
  expect(sp.get("viz")).toBe("timeseries");
  // Population et plage de l'écran conservées.
  expect(sp.get("release")).toBe(RELEASE);
  expect(sp.get("period")).toBe("1h");

  // V1 : la somme des occurrences (3 lignes × 2), pas le nombre de lignes.
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });

  // La requête appliquée : le groupe porte la phrase entière, chaque élément sa pastille.
  const pastilles = page.getByTestId("requete-pastilles");
  await expect(pastilles).toHaveAttribute("aria-label", /Somme — occurrences sur erreurs/);
  await expect(pastilles).toHaveAttribute("aria-label", new RegExp(`Release = ${RELEASE}`));
  await expect(pastilles).toContainText(`Release = ${RELEASE}`);
  // Le jeu et la mesure ne se retirent pas : aucun lien ne le propose.
  await expect(pastilles.getByRole("link", { name: /Retirer « Jeu/ })).toHaveCount(0);
  await expect(pastilles.getByRole("link", { name: /Retirer « Somme/ })).toHaveCount(0);

  // Un résultat occupe l'écran : le formulaire est replié sous « Modifier la requête ».
  const composer = page.getByTestId("explorer-composer");
  await expect(composer).not.toHaveAttribute("open", "");
  await composer.locator("summary").click();
  await expect(page.getByRole("button", { name: "Exécuter" })).toBeVisible();
});

test("retirer une pastille : la condition part, l'analyse reste exécutée, sans curseur", async ({ page }) => {
  await login(page);
  await page.goto(
    `${consoleUrl}/explorer?app=${APP_ID}&period=1h&release=${RELEASE}&device=desktop&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&limit=10&run=1`,
  );
  const pastilles = page.getByTestId("requete-pastilles");
  await expect(pastilles).toBeVisible({ timeout: 15_000 });

  await pastilles.getByRole("link", { name: "Retirer « Appareil = desktop »" }).click();
  await page.waitForURL((u) => !u.searchParams.has("device"), { timeout: 15_000 });
  const sp = new URL(page.url()).searchParams;
  expect(sp.get("release")).toBe(RELEASE);
  expect(sp.get("run")).toBe("1");
  expect(sp.get("g0")).toBe("route");
  expect(sp.has("cursor")).toBe(false);
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });
  await expect(page.getByTestId("requete-pastilles")).not.toContainText("Appareil = desktop");

  // Retirer le regroupement : même analyse, sans groupe.
  await page.getByTestId("requete-pastilles").getByRole("link", { name: "Retirer « Groupé par route »" }).click();
  await page.waitForURL((u) => !u.searchParams.has("g0"), { timeout: 15_000 });
  expect(new URL(page.url()).searchParams.get("release")).toBe(RELEASE);
  // Le formulaire montre la requête de l'ADRESSE, pas celle d'avant la navigation
  // client : sinon « Exécuter » remettrait le regroupement qu'on vient de retirer.
  await expect(page.locator('select[name="g0"]')).toHaveValue("");
});

test("un onglet de représentation relit la même requête sous une autre forme", async ({ page }) => {
  await login(page);
  await page.goto(
    `${consoleUrl}/explorer?app=${APP_ID}&period=1h&release=${RELEASE}&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&limit=20&run=1`,
  );
  const onglets = page.getByRole("navigation", { name: "Représentation" });
  await expect(onglets.getByRole("link", { name: "Classement" })).toHaveAttribute("aria-current", "page");

  await onglets.getByRole("link", { name: "Série" }).click();
  await page.waitForURL((u) => u.searchParams.get("viz") === "timeseries", { timeout: 15_000 });
  const sp = new URL(page.url()).searchParams;
  // Même requête, relancée ; la limite suit la représentation (5 séries au plus, P14).
  expect(sp.get("run")).toBe("1");
  expect(sp.get("measure")).toBe("occurrences:sum");
  expect(sp.get("g0")).toBe("route");
  expect(sp.get("release")).toBe(RELEASE);
  expect(Number(sp.get("limit"))).toBeLessThanOrEqual(5);
  await expect(page.getByTestId("explorer-echec")).toHaveCount(0);
  await expect(page.getByTestId("explorer-total")).toHaveText("6", { timeout: 15_000 });
  await expect(page.getByRole("navigation", { name: "Représentation" }).getByRole("link", { name: "Série" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // La représentation n'est plus un champ du formulaire : elle voyage cachée, telle quelle.
  await expect(page.locator('select[name="viz"]')).toHaveCount(0);
  await expect(page.locator('input[type="hidden"][name="viz"]')).toHaveValue("timeseries");
  // Et le formulaire suit l'adresse après la navigation client : la limite affichée
  // est celle de l'URL, pas un reste du classement.
  await expect(page.locator('select[name="limit"]')).toHaveValue(sp.get("limit")!);
});

test("aucun débordement à 390, 768 et 1440 px, avant et après exécution", async ({ page }) => {
  await login(page);
  const avant = `${consoleUrl}/explorer?app=${APP_ID}&period=1h`;
  const apres =
    `${consoleUrl}/explorer?app=${APP_ID}&period=1h&release=${RELEASE}&route=${encodeURIComponent(ROUTE_LONGUE)}` +
    `&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&g1=release&limit=10&run=1`;
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(avant);
    await expect(liensModeles(page)).toHaveCount(6);
    expect(await debordements(page), `sans exécution, ${width} px`).toEqual([]);

    await page.goto(apres);
    await expect(page.getByTestId("requete-pastilles")).toBeVisible({ timeout: 15_000 });
    expect(await debordements(page), `exécutée, ${width} px`).toEqual([]);
  }
});
