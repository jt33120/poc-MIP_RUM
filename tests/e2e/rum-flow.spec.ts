// E2E : démo → erreur → flush → base → console (PLAN §12).
// Le test suit SA session (pas de purge de la base) : assertions par session_id.
// v0.3 : la console exige un login (RBAC B3) — admin de test seedé par le spec.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

test.afterAll(() => pool.end());

// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-rum-flow@mip-rum.local";
let adminPassword = "";
test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  expect(adminPassword).not.toBe("");
});

async function loginConsole(page: Page) {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  // attendre la SORTIE de /login (la Server Action pose le cookie puis redirige)
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  // Porte « projet courant » (/select) : on fixe le projet de façon DÉTERMINISTE
  // sur l'app de la démo e2e (demo-app), pour scoper les vues console à SES données
  // — sinon toute navigation sans ?app est redirigée vers le picker /select.
  await page.context().addCookies([
    { name: "mip-project", value: "demo-app", url: "http://localhost:3000" },
  ]);
}

async function pollRows(sql: string, params: unknown[], minCount: number, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(sql, params);
    if (rows.length >= minCount) return rows;
    await new Promise((r) => setTimeout(r, 500));
  }
  return (await pool.query(sql, params)).rows;
}

test("flux RUM bout-en-bout : vitals + erreur arrivent en base puis en console", async ({ page }) => {
  await page.goto("http://localhost:8080/", { waitUntil: "load" });
  await page.waitForTimeout(1200); // layout shift CLS
  await page.click("#btn-error");
  await page.click("#btn-nav-list");
  await page.waitForTimeout(300);

  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")!).sid,
  );

  // vraie navigation -> pagehide -> reports finals + beacon
  await page.goto("about:blank");
  await page.waitForTimeout(800);

  const metrics = await pollRows(
    "select distinct name from rum_metric where session_id = $1",
    [sid],
    3,
  );
  const names = metrics.map((m) => m.name);
  expect(names).toContain("LCP");
  expect(names).toContain("TTFB");

  const errors = await pollRows(
    "select kind, message from rum_error where session_id = $1",
    [sid],
    1,
  );
  expect(errors[0].kind).toBe("error");
  expect(errors[0].message).toContain("Erreur de démo MIP RUM");

  const sessions = await pollRows(
    "select session_id, page_count from rum_session where session_id = $1",
    [sid],
    1,
  );
  expect(sessions).toHaveLength(1);
  expect(Number(sessions[0].page_count)).toBeGreaterThanOrEqual(2);

  // la console restitue ces données réelles (login RBAC d'abord).
  //
  // NB : surtout pas `waitUntil: "networkidle"` sur les pages de la console —
  // elle s'auto-instrumente avec le SDK RUM, qui envoie un lot de télémétrie
  // toutes les 3 s. Le réseau n'est donc JAMAIS au repos et l'attente expire.
  // Les `expect` ci-dessous réessaient d'eux-mêmes : c'est eux, la vraie
  // synchronisation.
  await loginConsole(page);
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  // F11 : la tuile LCP de `/` est une `KpiTile` (enveloppe `tuile-LCP`).
  await expect(page.getByTestId("tuile-LCP").getByTestId("kpi-valeur")).not.toHaveText("—");
  await page.goto("http://localhost:3000/errors", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText("Erreur de démo MIP RUM");
});

// F58 (plan § 5.7) : l'écran compare des ÉTATS (robot) à des verdicts (LCP réel),
// jamais un écart en % entre deux mesures qui ne mesurent pas la même chose. Le
// badge « écart » des anciennes cartes a disparu ; le détail est dans
// tests/e2e/fiabilite.spec.ts (bloc F58).
test("corrélation : robot face au réel, sans écart chiffré", async ({ page }) => {
  await loginConsole(page);
  await page.goto("http://localhost:3000/correlation", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#hero")).toContainText("Robot face au réel");
  await expect(page.locator("body")).toContainText("Routes à trafic réel sans scénario robot");
  await expect(page.getByTestId("gap")).toHaveCount(0);
});

test("replay : session enregistrée sur la démo puis rejouée dans la console", async ({ page }) => {
  test.skip(!process.env.REPLAY_SERVER_UP && false, "replay server requis");
  // 1. générer un replay (la démo init replay:true -> chunks sur :4319)
  await page.goto("http://localhost:8080/", { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.click("#btn-nav-list");
  await page.mouse.click(300, 200);
  await page.waitForTimeout(400);
  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")!).sid,
  );
  // flush périodique (10 s) : le flush pagehide dépend d'un gzip async que
  // l'unload peut interrompre — on attend le chemin fiable
  await page.waitForTimeout(11_000);
  const chunkRows = await pollRows(
    "select id from replay_chunk where session_id = $1",
    [sid],
    1,
  );
  expect(chunkRows.length).toBeGreaterThanOrEqual(1);
  await page.goto("about:blank");

  // 2. le player monte et lit > 0 events dans la console authentifiée
  await loginConsole(page);
  const res = await page.request.get(`http://localhost:3000/api/replay/${sid}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.events.length).toBeGreaterThan(0);
  await page.goto(`http://localhost:3000/sessions/${sid}?tab=replay`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("replay-player")).toBeVisible();
  // Le lecteur monte le Replayer de @rrweb/replay : la page rejouée vit dans une
  // iframe. `.rr-player` (rrweb-player) s'affichait sans jamais rien rejouer.
  await expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(page.getByTestId("replay-player").locator("iframe")).toBeAttached();
});
