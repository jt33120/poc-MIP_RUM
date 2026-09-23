// E2E — F33 : le contexte du résultat de l'Explorer (W-E2 « Volume du résultat »,
// W-E7 « Répartition par … », plan § 5.21.3 zone 8).
//
// CE QUE CE SPEC EXISTE POUR EMPÊCHER.
//   - Qu'un contexte non lu se dessine quand même : le budget des deux lectures de
//     contexte est court, et l'écran le DIT (« Partiel ») au lieu de montrer des
//     barres à zéro. Le piège est simulé pour de vrai : la table du jeu est
//     verrouillée en accès exclusif pendant l'affichage, plus longtemps que le
//     budget du contexte et moins longtemps que celui du résultat — le résultat
//     doit rester affiché.
//   - Que le volume double la série du résultat (sous `viz=timeseries`, il n'existe
//     pas) ou qu'il perde des seaux dans son alternative textuelle.
//   - Qu'une barre de la répartition n'ajoute pas sa condition à la requête.
//   - Qu'une dimension que le jeu ne porte pas disparaisse, ou que sa raison ne
//     vive que dans un `title` que personne n'entend.
//
// Données EXPLICITEMENT SYNTHÉTIQUES, dans une app dédiée, avec un utilisateur
// dédié (jamais le compte administrateur local, dont on ne touche pas le mot de
// passe). La base est la base LOCALE, écrite en clair : ce spec n'emprunte aucune
// variable d'environnement qui pourrait désigner autre chose.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const APP_ID = "f33-e2e-app";
const E2E_EMAIL = "e2e-explorer-contexte@mip-rum.local";
const E2E_PASSWORD = "e2e-explorer-contexte-mdp-local";
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

/** Base locale de développement ; jamais `DATABASE_URL`, qui peut désigner autre chose. */
const pool = new pg.Pool({ connectionString: "postgres://postgres:postgres@localhost:5433/mip_rum" });

/** Le contexte renonce à 1,5 s, le résultat à 5 s : le verrou tient entre les deux. */
const VERROU_MS = 3_000;

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

/**
 * Deux navigateurs, deux routes, huit occurrences sur quatre lignes : de quoi
 * classer, répartir, et vérifier qu'une somme d'occurrences n'est pas un nombre de
 * lignes (V1). Une session par navigateur : la dimension vient de la session.
 */
const SESSIONS: [string, string][] = [
  ["chrome", "Chrome"],
  ["firefox", "Firefox"],
];
const ERREURS: [string, string, number][] = [
  ["chrome", "/f33-a", 2],
  ["chrome", "/f33-a", 2],
  ["chrome", "/f33-b", 2],
  ["firefox", "/f33-b", 2],
];

async function semer() {
  for (const t of ["rum_error", "rum_pageview", "rum_session"]) {
    await pool.query(`delete from ${t} where app_id = $1`, [APP_ID]);
  }
  await pool.query(`insert into app_registry (app_id, name) values ($1, 'Explorer F33 E2E') on conflict (app_id) do nothing`, [
    APP_ID,
  ]);
  for (const [suffixe, navigateur] of SESSIONS) {
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, browser, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', $3, false, now() - interval '30 minutes', now() - interval '20 minutes', 2)
       on conflict (session_id) do update set browser = excluded.browser`,
      [`${APP_ID}-${suffixe}`, APP_ID, navigateur],
    );
  }
  for (const [i, [suffixe, route, occurrences]] of ERREURS.entries()) {
    await pool.query(
      `insert into rum_error (span_id, app_id, session_id, fingerprint, error_type, message, kind, route, occurrences, ts)
       values ($1, $2, $3, 'f33-e2e-fp', 'TypeError', 'boom', 'error', $4, $5, now() - interval '25 minutes')
       on conflict (span_id) do nothing`,
      [`${APP_ID}-err-${i}`, APP_ID, `${APP_ID}-${suffixe}`, route, occurrences],
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

/** Une analyse exécutée sur les erreurs de l'app de test. */
function url(extra: string): string {
  return `${consoleUrl}/explorer?app=${APP_ID}&period=1h&dataset=errors&measure=occurrences:sum&run=1&${extra}`;
}

/**
 * Débordement horizontal : la liste des éléments fautifs (même helper que
 * `explorer-depart.spec.ts`). Un élément dans un conteneur défilant est légitime ;
 * un élément qui pousse la page ne l'est pas.
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
        const repere =
          el.closest("section, h1, h2, h3")?.textContent?.trim().slice(0, 60) ?? el.textContent?.trim().slice(0, 60) ?? "";
        return `${el.tagName.toLowerCase()} « ${repere} » → ${Math.round(el.getBoundingClientRect().right)} px`;
      });
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}

test("W-E2 : le volume accompagne un classement, avec une ligne d'alternative par seau", async ({ page }) => {
  await login(page);
  await page.goto(url("viz=toplist&g0=route&limit=10&split=browser"));
  const volume = page.locator("#volume-resultat");
  await expect(volume).toBeVisible({ timeout: 15_000 });

  // L'alternative textuelle dit exactement ce que les barres dessinent : un seau
  // par ligne, la légende annonçant leur nombre.
  const legende = (await volume.locator("caption").innerText()).trim();
  const annonces = Number(legende.match(/—\s*(\d+)\s*seaux/)![1]);
  expect(annonces).toBeGreaterThan(0);
  await expect(volume.locator("tbody tr")).toHaveCount(annonces);
  // Un volume ne se juge pas : aucun verdict de seuil sur cette figure.
  await expect(volume.getByText(/\b(Bon|À améliorer|Mauvais)\b/)).toHaveCount(0);
});

test("W-E2 : sous une série, le volume n'existe pas — le résultat dit déjà le temps", async ({ page }) => {
  await login(page);
  await page.goto(url("viz=timeseries&limit=1&split=browser"));
  await expect(page.getByTestId("resultat-analyse")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#volume-resultat")).toHaveCount(0);
  // La répartition, elle, reste : elle ne double rien.
  await expect(page.locator("#repartition-resultat")).toBeVisible();
});

test("W-E7 : `split=browser` — la 1re barre ajoute sa condition à la requête", async ({ page }) => {
  await login(page);
  await page.goto(url("viz=value&split=browser"));
  const repartition = page.getByTestId("repartition-resultat");
  await expect(repartition).toBeVisible({ timeout: 15_000 });
  await expect(repartition).toHaveAttribute("data-dimension", "browser");
  // Chrome porte 6 occurrences sur 8 : la part est écrite, et c'est une somme.
  await expect(repartition).toContainText("Chrome");
  await expect(repartition).toContainText("% du total");

  const premiere = repartition.getByRole("link").first();
  const href = (await premiere.getAttribute("href")) ?? "";
  expect(new URL(href, consoleUrl).searchParams.get("browser")).toBe("Chrome");

  await premiere.click();
  await page.waitForURL((u) => u.searchParams.get("browser") === "Chrome", { timeout: 15_000 });
  const sp = new URL(page.url()).searchParams;
  // La requête et la dimension de répartition suivent le clic ; la page reste exécutée.
  expect(sp.get("run")).toBe("1");
  expect(sp.get("measure")).toBe("occurrences:sum");
  expect(sp.get("split")).toBe("browser");
  expect(sp.has("cursor")).toBe(false);
  await expect(page.getByTestId("resultat-analyse")).toBeVisible({ timeout: 15_000 });
});

test("W-E7 : une dimension sans objet reste visible, désactivée, avec sa raison EN TEXTE", async ({ page }) => {
  await login(page);
  // Les sessions ne portent pas de route : l'onglet le dit au lieu de disparaître.
  await page.goto(`${consoleUrl}/explorer?app=${APP_ID}&period=1h&dataset=sessions&measure=started:count&viz=value&run=1`);
  const onglet = page.getByTestId("repartition-tab-route");
  await expect(onglet).toBeVisible({ timeout: 15_000 });
  await expect(onglet).toHaveAttribute("aria-disabled", "true");
  const raisons = page.getByTestId("repartition-indisponibles");
  await expect(raisons).toContainText("Route :");
  await expect(raisons).toContainText("sans objet");
  // La raison est ATTEIGNABLE au clavier et rattachée à l'onglet.
  const decrit = await onglet.getAttribute("aria-describedby");
  expect(decrit).toBe("repartition-raison-route");
  await expect(page.locator(`#${decrit}`)).toBeVisible();
  await onglet.focus();
  await expect(onglet).toBeFocused();
});

test("budget dépassé sur le contexte : le message, et le résultat reste affiché", async ({ page }) => {
  await login(page);
  // La table des erreurs est verrouillée en accès exclusif pendant l'affichage :
  // les lectures de contexte (budget 1,5 s) renoncent, celle du résultat (5 s)
  // attend le verrou puis répond.
  const verrou = await pool.connect();
  await verrou.query("begin");
  await verrou.query("set local lock_timeout = '10s'");
  await verrou.query("lock table rum_error in access exclusive mode");
  const relache = new Promise((resolve) => setTimeout(resolve, VERROU_MS)).then(async () => {
    await verrou.query("rollback");
    verrou.release();
  });
  try {
    await page.goto(url("viz=value&split=browser"), { timeout: 30_000 });
  } finally {
    await relache;
  }

  // Le résultat, lui, a été lu : il reste affiché, sans échec d'écran.
  await expect(page.getByTestId("resultat-analyse")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("explorer-echec")).toHaveCount(0);

  // Le contexte dit qu'il n'a pas pu lire — jamais des barres à zéro.
  const contexte = page.getByTestId("explorer-contexte");
  await expect(contexte.getByTestId("etat-partiel").first()).toContainText("budget de lecture dépassé");
  await expect(contexte).toContainText("Volume non lu");
  await expect(contexte).toContainText("Répartition non lue");
  await expect(contexte.locator(".recharts-wrapper")).toHaveCount(0);
});

test("aucun débordement à 390, 768 et 1440 px avec le contexte affiché", async ({ page }) => {
  await login(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url("viz=toplist&g0=route&limit=10&split=browser"));
    await expect(page.locator("#repartition-resultat")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#volume-resultat")).toBeVisible();
    expect(await debordements(page), `contexte affiché, ${width} px`).toEqual([]);
  }
});
