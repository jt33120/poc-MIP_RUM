// E2E P5.1 — Error Tracking : détails fiables et corrélation.
//
// Jeu de recette partagé avec tests/integration/error-queries-p51-sql.test.ts
// (§6 du contrat P5.1) : erreurs A/B de même empreinte, hors fenêtre, tablette,
// bot, répétitions 37 + 1, backend sans session, trace étrangère, référence à la
// session d'un autre tenant. Le SQL prouve les nombres ; ce spec prouve que
// l'ÉCRAN dit les mêmes — 38 dans la liste et dans le détail —, que chaque lien
// mène à la bonne relation dans la bonne app et à elle seule, et que tout cela
// reste utilisable au clavier et sans débordement à 390/768/1440 px.
//
// Utilisateur admin DÉDIÉ (seed-admin régénère le mot de passe de julian@ à
// chaque run et les specs tournent en parallèle) ; app explicite dans chaque URL,
// jamais le cookie projet.
//
// P5.6 (bloc final) : workflow d'une issue — résolution et régression, commentaire,
// lien de ticket, 409, viewer en lecture seule, clavier et 390/768/1440 px.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import pg from "pg";

const CONSOLE = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const E2E_EMAIL = "e2e-error-tracking@mip-rum.local";
const E2E_PASSWORD = "e2e-error-tracking-mdp-local";

const A = "p51-app-a";
const B = "p51-app-b";
const C = "p51-app-c";
const APPS = [A, B, C];
const H1 = "a".repeat(64);
const T1 = "1".repeat(32);
const T2 = "2".repeat(32);
const P1 = "aaaaaaaaaaaaaaa1";
const ACT1 = "0123456789abcdef0123456789abcdef";
const MINUTE_MS = 60_000;

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

async function nettoyer() {
  // Les erreurs et les chunks d'abord : ils référencent les sessions (clé étrangère),
  // et r10 cite depuis A la session de B.
  for (const table of ["error_status", "rum_error", "replay_chunk", "rum_span", "rum_action", "rum_session", "app_registry"])
    await pool.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

/** Instant de référence du jeu, lu sur l'horloge de la base (epoch ms). */
let refMs = 0;

async function semer() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    ({ rows: [{ ref_ms: refMs }] } = await client.query<{ ref_ms: number }>(
      "select (extract(epoch from date_trunc('milliseconds', now())) * 1000)::float8 as ref_ms",
    ));
    await client.query(
      `insert into app_registry (app_id, name, active, internal)
       select app, app, true, false from unnest($1::text[]) as app
       on conflict (app_id) do update set active = true, internal = false`,
      [APPS],
    );
    await client.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, visitor_id, user_id_hash, sample_rate, error_sample_rate)
       values ('p51-a-desktop', $1, 'desktop', false, 'vis-a1', $4, 1, 1),
              ('p51-a-tablet',  $1, 'tablet',  false, null,     null, 1, 1),
              ('p51-a-bot',     $1, 'desktop', true,  'vis-bot', null, 1, 1),
              ('p51-b-desktop', $2, 'desktop', false, 'vis-b1', null, 1, 1),
              ('p51-c-desktop', $3, 'desktop', false, 'vis-c1', null, 1, 1)`,
      [A, B, C, H1],
    );
    await client.query(
      `insert into rum_span (span_id, trace_id, parent_span_id, tier, session_id, app_id, duration_ms, name, kind, ts)
       values ($1, $2, null, 'front', 'p51-a-desktop', $3, 120, 'POST /api/pay', 'client', now() - interval '10 minutes'),
              ('aaaaaaaaaaaaaaa2', $2, $1, 'back', null, $3, 80, 'POST /api/pay', 'server', now() - interval '10 minutes'),
              ('bbbbbbbbbbbbbbb1', $4, null, 'front', 'p51-b-desktop', $5, 50, 'GET /api/cart-b', 'client', now() - interval '5 minutes')`,
      [P1, T1, A, T2, B],
    );
    await client.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, ts)
       values ($1, 'ccccccccccccccc1', 'p51-a-desktop', $2, 'click', 'Payer', now() - interval '10 minutes 1 second')`,
      [ACT1, A],
    );
    // Enregistrement rrweb de now-11 min à now-8 min : couvre r1 (now-10 min) et
    // r2 (now-9 min). Un vrai document (html/head/body) : le Replayer le reconstruit.
    const evenements = [
      { type: 4, data: { href: "https://recette.example/checkout", width: 1280, height: 720 }, timestamp: refMs - 11 * MINUTE_MS },
      {
        type: 2,
        data: {
          node: {
            type: 0, id: 1, childNodes: [
              { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
              {
                type: 2, id: 3, tagName: "html", attributes: {}, childNodes: [
                  { type: 2, id: 4, tagName: "head", attributes: {}, childNodes: [] },
                  {
                    type: 2, id: 5, tagName: "body", attributes: {}, childNodes: [
                      { type: 2, id: 6, tagName: "h1", attributes: {}, childNodes: [{ type: 3, id: 7, textContent: "Paiement" }] },
                    ],
                  },
                ],
              },
            ],
          },
          initialOffset: { left: 0, top: 0 },
        },
        timestamp: refMs - 11 * MINUTE_MS,
      },
      { type: 3, data: { source: 1, positions: [{ x: 40, y: 60, id: 5, timeOffset: 0 }] }, timestamp: refMs - 10 * MINUTE_MS },
      { type: 3, data: { source: 1, positions: [{ x: 80, y: 90, id: 5, timeOffset: 0 }] }, timestamp: refMs - 8 * MINUTE_MS },
    ];
    await client.query(
      "insert into replay_chunk (session_id, app_id, seq, events_count, body) values ('p51-a-desktop', $1, 0, $2, $3)",
      [A, evenements.length, gzipSync(JSON.stringify(evenements))],
    );
    // [nom, app, empreinte, session, décalage en µs avant la référence, occurrences, trace, parent, action, identité, source, gérée]
    const minuteUs = 60_000_000;
    const lignes: [string, string, string, string | null, number, number, string | null, string | null, string | null, string | null, string | null, boolean | null][] = [
      ["r1", A, "p51fp001", "p51-a-desktop", 10 * minuteUs, 37, T1, P1, ACT1, H1, "browser_js", false],
      ["r2", A, "p51fp001", "p51-a-desktop", 9 * minuteUs, 1, T2, "bbbbbbbbbbbbbbb1", null, null, null, null],
      ["r3", A, "p51fp001", "p51-a-desktop", 3 * 1_440 * minuteUs, 5, null, null, null, null, null, null],
      ["r4", A, "p51fp001", "p51-a-tablet", 8 * minuteUs, 7, null, null, null, null, null, null],
      ["r5", A, "p51fp001", "p51-a-bot", 7 * minuteUs, 11, null, null, null, null, null, null],
      ["r6", A, "p51fp001", null, 6 * minuteUs, 2, null, null, null, null, null, null],
      ["r7", B, "p51fp001", "p51-b-desktop", 5 * minuteUs, 13, T2, null, null, null, null, null],
      ["r9", C, "p51fp002", "p51-c-desktop", 4 * minuteUs - 1, 1, null, null, null, null, null, null],
      ["r8", C, "p51fp002", "p51-c-desktop", 4 * minuteUs, 1, null, null, null, null, null, null],
      ["r10", A, "p51fp004", "p51-b-desktop", 3 * minuteUs, 3, null, null, null, null, null, null],
    ];
    for (const [nom, app, fp, session, avantUs, occ, trace, parent, action, user, source, handled] of lignes) {
      await client.query(
        `insert into rum_error (app_id, fingerprint, session_id, occurrences, action_id, error_type, message, kind, release,
                                trace_id, source_parent_span_id, user_id_hash, error_source, handled, ts)
         values ($1, $2, $3, $4, $5, 'TypeError', $6, 'error', '1.4.2', $7, $8, $9, $10, $11,
                 date_trunc('milliseconds', now()) - $12::bigint * interval '1 microsecond')`,
        [app, fp, session, occ, action, `boom ${nom}`, trace, parent, user, source, handled, avantUs],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

test.beforeAll(async () => {
  const { rows: [{ v69 }] } = await pool.query<{ v69: boolean }>(
    `select exists(select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rum_error' and column_name = 'error_source') as v69`,
  );
  expect(v69, "la base E2E doit porter migration-v69 (schéma + toutes les migrations)").toBe(true);
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  await nettoyer();
  await semer();
});

test.afterAll(async () => {
  await nettoyer();
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${CONSOLE}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

const groupe = (page: Page, fp: string, app: string) =>
  page.locator(`[data-testid="error-group-${fp}"][data-app-id="${app}"]`);
/** Les lignes du tableau des occurrences (la tendance a aussi sa table, repliée). */
const occurrences = (page: Page) => page.getByRole("region", { name: /^Occurrences \(/ }).locator("tbody tr");
/** La ligne d'occurrence dont le message est `boom <nom>`. */
const occurrence = (page: Page, nom: string) =>
  occurrences(page).filter({ has: page.getByTitle(`boom ${nom}`, { exact: true }) });
const introuvable = (page: Page) => expect(page.getByText("This page could not be found")).toBeVisible();

test("liste puis détail : 38 sur le même périmètre, inconnu jamais affiché comme zéro", async ({ page }) => {
  await login(page);

  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h&device=desktop`);
  const ligne = groupe(page, "p51fp001", A);
  await expect(ligne.getByTestId("group-occurrences")).toHaveText("38");
  // p51fp004 n'a aucune session de son app : le filtre d'appareil l'exclut.
  await expect(page.locator('[data-testid="error-group-p51fp004"]')).toHaveCount(0);
  await expect(page.getByText("Occurrences · 24 h", { exact: true }).locator("..")).toContainText("38");
  // Un seul lien par ligne, qui garde l'app et les filtres.
  await expect(ligne.getByRole("link")).toHaveCount(1);
  const href = await ligne.getByRole("link").getAttribute("href");
  expect(href).toMatch(new RegExp(`^/errors/p51fp001\\?app=${A}&period=24h&device=desktop$`));

  // Tous appareils : l'erreur backend sans session garde des personnes INCONNUES.
  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h`);
  await expect(groupe(page, "p51fp001", A).getByTestId("group-occurrences")).toHaveText("47");
  const croisee = groupe(page, "p51fp004", A);
  await expect(croisee.getByTestId("group-occurrences")).toHaveText("3");
  await expect(croisee.getByRole("cell", { name: "Inconnu", exact: true })).toHaveCount(2);

  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h&device=desktop`);
  await groupe(page, "p51fp001", A).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/errors/p51fp001\\?app=${A}&period=24h&device=desktop`));
  await expect(page.getByTestId("detail-occurrences")).toHaveText("38");
  await expect(page.getByTestId("detail-sessions")).toHaveText("1");
  await expect(page.getByTestId("detail-users")).toHaveText("1");
  await expect(page.getByText("Alternative textuelle de la série")).toBeVisible();
  // L'exemplaire est r2, émis sans source : rien n'est deviné.
  await expect(page.getByText("Source inconnue", { exact: true })).toBeVisible();

  // Plus récente d'abord : r2 puis r1 ; le bot, la tablette et l'erreur hors fenêtre sont absents.
  const lignes = occurrences(page);
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText("boom r2");
  await expect(lignes.nth(1)).toContainText("boom r1");
});

test("liens d'occurrence : session, replay, trace avec span parent et action, dans la même app", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/p51fp001?app=${A}&period=24h&device=desktop`);

  const r1 = occurrence(page, "r1");
  await expect(r1.getByRole("link", { name: /^Session/ })).toHaveAttribute("href", `/sessions/p51-a-desktop?app=${A}`);
  await expect(r1.getByRole("link", { name: /^Replay/ })).toHaveAttribute(
    "href",
    new RegExp(`^/sessions/p51-a-desktop\\?app=${A}&tab=replay&at=\\d+$`),
  );
  await expect(r1.getByRole("link", { name: /^Trace/ })).toHaveAttribute("href", `/tracing/${T1}?app=${A}&span=${P1}`);
  await expect(r1.getByText("Action « Payer »")).toBeVisible();
  await expect(r1).toContainText("JavaScript navigateur");
  await expect(r1).toContainText("non gérée");

  // r2 cite T2, dont les spans n'existent que dans B : aucun lien de trace depuis A.
  const r2 = occurrence(page, "r2");
  await expect(r2.getByRole("link", { name: /^Session/ })).toHaveCount(1);
  await expect(r2.getByRole("link", { name: /^Replay/ })).toHaveCount(1);
  await expect(r2.getByRole("link", { name: /^Trace/ })).toHaveCount(0);
  await expect(r2.getByText(/Action «/)).toHaveCount(0);

  await r1.getByRole("link", { name: /^Trace/ }).click();
  await expect(page.getByTestId("trace-span-state")).toHaveAttribute("data-span-state", "found");
  await expect(page.locator('li[aria-current="true"]')).toContainText("POST /api/pay");

  // La session citée par r10 appartient à B : aucun lien, même sans filtre d'appareil.
  await page.goto(`${CONSOLE}/errors/p51fp004?app=${A}&period=24h`);
  await expect(occurrence(page, "r10").getByRole("link")).toHaveCount(0);
  await expect(occurrence(page, "r10")).toContainText("Inconnu");
});

test("trace et session étrangères : invisibles depuis l'app A", async ({ page }) => {
  await login(page);

  await page.goto(`${CONSOLE}/tracing/${T2}?app=${A}`);
  await introuvable(page);
  await expect(page.getByText("GET /api/cart-b")).toHaveCount(0);

  // La même trace, demandée dans son app, existe bien : le 404 vient du périmètre.
  await page.goto(`${CONSOLE}/tracing/${T2}?app=${B}`);
  await expect(page.getByText("GET /api/cart-b")).toBeVisible();

  await page.goto(`${CONSOLE}/tracing/${T1}?app=${A}&span=bbbbbbbbbbbbbbb1`);
  await expect(page.getByTestId("trace-span-state")).toHaveAttribute("data-span-state", "missing");
  await expect(page.getByText("Span parent introuvable dans cette trace")).toBeVisible();

  await page.goto(`${CONSOLE}/sessions/p51-b-desktop?app=${A}`);
  await introuvable(page);
});

test("empreinte partagée : choix explicite de l'app, jamais un tirage", async ({ page }) => {
  await login(page);

  await page.goto(`${CONSOLE}/errors/p51fp001?app=all&period=24h&device=desktop`);
  const choix = page.getByTestId("error-group-chooser");
  await expect(choix.getByRole("heading")).toHaveText("Cette signature existe dans plusieurs applications");
  const liens = choix.getByRole("link");
  await expect(liens).toHaveCount(2);
  await expect(choix.getByRole("link", { name: A })).toHaveAttribute("href", `/errors/p51fp001?app=${A}&period=24h&device=desktop`);
  await expect(choix.getByRole("link", { name: B })).toHaveAttribute("href", `/errors/p51fp001?app=${B}&period=24h&device=desktop`);
  await expect(choix).toContainText("13 occurrence(s)");

  // Absente de l'app demandée, présente dans une seule autre : un lien, et on le dit.
  await page.goto(`${CONSOLE}/errors/p51fp002?app=${A}&period=24h`);
  await expect(page.getByText(`Absente de ${A} sur cette période.`)).toBeVisible();
  await expect(page.getByTestId("error-group-chooser").getByRole("link")).toHaveCount(1);
  await page.getByTestId("error-group-chooser").getByRole("link", { name: C }).click();
  await expect(page.getByTestId("detail-occurrences")).toHaveText("2");
});

test("replay : positionné à l'instant de l'erreur, sinon indisponible", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/p51fp001?app=${A}&period=24h&device=desktop`);
  await occurrence(page, "r1").getByRole("link", { name: /^Replay/ }).click();

  const lecteur = page.getByTestId("replay-player");
  await expect(lecteur).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(lecteur.locator("iframe")).toBeAttached();
  await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-state", "positioned");
  await expect(page.getByText("Replay positionné à l'instant de l'erreur")).toBeVisible();
  await expect(lecteur.getByRole("button", { name: "Lecture" })).toBeVisible();
  await expect(lecteur.getByRole("button", { name: "Pause" })).toBeVisible();

  // Une heure avant l'enregistrement : rien à montrer à cet instant.
  await page.goto(`${CONSOLE}/sessions/p51-a-desktop?app=${A}&tab=replay&at=${refMs - 60 * MINUTE_MS}`);
  await expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(page.getByTestId("replay-offset")).toHaveAttribute("data-offset-state", "unavailable");
  await expect(page.getByText("Replay indisponible à cet instant")).toBeVisible();
});

test("clavier : chaque lien d'occurrence est atteignable et activable", async ({ page }) => {
  await login(page);
  await page.goto(`${CONSOLE}/errors/p51fp001?app=${A}&period=24h&device=desktop`);

  const r1 = occurrence(page, "r1");
  const session = r1.getByRole("link", { name: /^Session/ });
  await session.focus();
  await expect(session).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(r1.getByRole("link", { name: /^Replay/ })).toBeFocused();
  await page.keyboard.press("Tab");
  const trace = r1.getByRole("link", { name: /^Trace/ });
  await expect(trace).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/tracing/${T1}\\?app=${A}&span=${P1}`));

  await page.goto(`${CONSOLE}/errors?app=${A}&period=24h&device=desktop`);
  const groupeLien = groupe(page, "p51fp001", A).getByRole("link");
  await groupeLien.focus();
  await expect(groupeLien).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("detail-occurrences")).toHaveText("38");
});

for (const width of [390, 768, 1440]) {
  test(`aucun débordement horizontal de la page à ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    for (const path of [
      `/errors?app=${A}&period=24h`,
      `/errors/p51fp001?app=${A}&period=24h&device=desktop`,
      `/errors/p51fp001?app=all&period=24h&device=desktop`,
      `/sessions/p51-a-desktop?app=${A}&tab=replay`,
    ]) {
      await page.goto(`${CONSOLE}${path}`);
      await expect(page.locator("main")).toBeVisible();
      if (path.includes("tab=replay")) {
        await expect(page.getByTestId("replay-player")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      }
      const deborde = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(deborde, path).toBe(false);
    }
  });
}

// ═══════════════ P5.6 — workflow, régression et alerte par issue ═══════════════
//
// Une issue d'une app activée, semée en SQL avant chaque test. L'occurrence qui
// arrive après une résolution passe par la primitive que l'écrivain d'ingestion
// appelle dans sa transaction (error_issue_record_occurrences) ; le chemin complet
// de l'écrivain est prouvé par tests/integration/error-issues-sql.test.ts. Ce bloc
// prouve ce que l'ÉCRAN en fait : résolution avec sa référence, régression
// confirmée, réapparition à vérifier, commentaire masqué, lien de ticket, 409 avec
// rechargement, viewer en lecture seule refusé par l'API, clavier, 390/768/1440 px.
test.describe("P5.6 — workflow d'une issue", () => {
  const APP_W = "p56-e2e-a";
  const ISSUE_W = "56e2e000-0000-4000-8000-000000000001";
  const CLE_W = "56e2e0000000000000000000000000a1";
  const VIEWER_EMAIL = "e2e-issue-viewer@mip-rum.local";
  const VIEWER_PASSWORD = "e2e-issue-viewer-mdp-local";
  const PAGE_ISSUE = `/errors/issues/${ISSUE_W}?app=${APP_W}&period=24h`;

  async function nettoyerW() {
    for (const table of ["error_issue", "error_grouping_config", "deploy_marker", "rum_error", "rum_session", "app_registry"])
      await pool.query(`delete from ${table} where app_id = $1`, [APP_W]);
  }

  test.beforeAll(async () => {
    const { rows: [{ v73 }] } = await pool.query<{ v73: boolean }>(
      "select to_regclass('public.error_issue_activity') is not null as v73",
    );
    expect(v73, "la base E2E doit porter migration-v73 (schéma + toutes les migrations)").toBe(true);
    await pool.query(
      `insert into console_user (email, password_hash, role, apps, active)
       values ($1, $2, 'viewer', array[$3], true)
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'viewer', apps = excluded.apps, active = true`,
      [VIEWER_EMAIL, bcryptHash(VIEWER_PASSWORD), APP_W],
    );
  });

  test.beforeEach(async () => {
    await nettoyerW();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("insert into app_registry (app_id, name, active, internal) values ($1, $1, true, false)", [APP_W]);
      await client.query(
        "insert into rum_session (session_id, app_id, device_type, is_bot, sample_rate, error_sample_rate) values ('p56-e2e-s1', $1, 'desktop', false, 1, 1)",
        [APP_W],
      );
      await client.query(
        `insert into error_issue (id, app_id, grouping_version, grouping_key, grouping_basis, origin, status, status_source,
                                  first_seen, last_seen, first_release, last_release)
         values ($1, $2, 2, $3, 'normalized_frame', 'new', 'open', 'system',
                 now() - interval '2 hours', now() - interval '30 minutes', '2.0.0', '2.0.0')`,
        [ISSUE_W, APP_W, CLE_W],
      );
      await client.query(
        `insert into rum_error (app_id, fingerprint, session_id, occurrences, error_type, message, kind, release, env,
                                grouping_version, grouping_key, grouping_basis, issue_id, ts)
         select $1, 'p56e2efp', 'p56-e2e-s1', 2, 'TypeError', 'panier vide p56', 'error', '2.0.0', 'prod',
                2, $2, 'normalized_frame', $3, i.last_seen
           from error_issue i where i.id = $3`,
        [APP_W, CLE_W, ISSUE_W],
      );
      await client.query(
        `insert into deploy_marker (app_id, version, env, ts) values
           ($1, '2.0.0', 'prod', now() - interval '3 days'), ($1, '2.1.0', 'prod', now() - interval '1 hour')`,
        [APP_W],
      );
      await client.query("select error_grouping_activate($1, 'e2e@p56.test')", [APP_W]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  });

  test.afterAll(async () => {
    await nettoyerW();
    await pool.query("delete from console_user where email = $1", [VIEWER_EMAIL]);
  });

  /** Ce que fait l'écrivain d'ingestion pour une occurrence nouvelle : ligne, dernière vue, décision, un seul commit. */
  async function occurrenceEcrite(release: string) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `insert into rum_error (app_id, fingerprint, session_id, occurrences, error_type, message, kind, release, env,
                                grouping_version, grouping_key, grouping_basis, issue_id, ts)
         values ($1, 'p56e2efp', 'p56-e2e-s1', 1, 'TypeError', 'panier vide p56', 'error', $2, 'prod', 2, $3, 'normalized_frame', $4, clock_timestamp())
         returning ts, release, env`,
        [APP_W, release, CLE_W, ISSUE_W],
      );
      await client.query("update error_issue set last_seen = $2, last_release = $3 where id = $1", [ISSUE_W, rows[0].ts, release]);
      await client.query(
        "select error_issue_record_occurrences($1, $2, $3::timestamptz[], $4::text[], $5::text[])",
        [APP_W, ISSUE_W, [rows[0].ts], [release], ["prod"]],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  async function loginAs(page: Page, email: string, password: string) {
    await page.goto(`${CONSOLE}/login`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  async function resoudre(page: Page) {
    const triage = page.getByTestId("issue-triage-form");
    await triage.getByTestId("issue-triage-status").selectOption("resolved");
    await triage.getByTestId("issue-triage-submit").click();
    await expect(page.getByTestId("issue-status")).toHaveText("Résolue");
  }

  test("résolution avec sa référence, régression confirmée sur release postérieure, puis réapparition à vérifier", async ({ page }) => {
    await login(page);
    await page.goto(`${CONSOLE}${PAGE_ISSUE}`);
    await expect(page.getByTestId("issue-assignee")).toHaveText("personne");
    await resoudre(page);
    await expect(page.getByTestId("issue-resolution")).toContainText("release 2.0.0 (env prod)");
    await expect(page.getByTestId("issue-activity-status")).toContainText("« Ouverte » à « Résolue »");

    // Release 2.1.0, déployée après la référence : l'issue est rouverte.
    await occurrenceEcrite("2.1.0");
    await page.reload();
    await expect(page.getByTestId("issue-status")).toHaveText("Ouverte");
    await expect(page.getByTestId("issue-regression")).toContainText("release 2.1.0 (env prod)");
    await expect(page.getByTestId("issue-activity-regression")).toContainText("Régression confirmée");

    // Résolue en 2.1.0, puis un ancien client en 2.0.0 : réapparition à vérifier, l'issue reste résolue.
    await resoudre(page);
    await expect(page.getByTestId("issue-resolution")).toContainText("release 2.1.0 (env prod)");
    await occurrenceEcrite("2.0.0");
    await page.reload();
    await expect(page.getByTestId("issue-status")).toHaveText("Résolue");
    await expect(page.getByTestId("issue-reappeared")).toContainText("Réapparition à vérifier");
    await expect(page.getByTestId("issue-regression")).toHaveCount(0);
  });

  test("commentaire masqué, lien de ticket et triage au clavier", async ({ page }) => {
    await login(page);
    await page.goto(`${CONSOLE}${PAGE_ISSUE}`);

    const commentaire = page.getByTestId("issue-comment-body");
    await commentaire.fill("Voir avec marie@exemple.fr avant la release");
    // Le focus n'attend pas l'hydratation : on attend que le bouton soit actif.
    await expect(page.getByTestId("issue-comment-submit")).toBeEnabled();
    await page.getByTestId("issue-comment-submit").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-activity-comment")).toContainText("Voir avec [email] avant la release");
    await expect(commentaire).toHaveValue("");

    const lien = page.getByTestId("issue-link-form");
    await lien.getByTestId("issue-link-url").fill("https://tickets.exemple.fr/browse/MIP-56");
    await lien.getByTestId("issue-link-label").fill("MIP-56");
    await lien.getByRole("button", { name: "Lier" }).click();
    await expect(page.getByTestId("issue-links").getByRole("link", { name: "MIP-56" }))
      .toHaveAttribute("href", "https://tickets.exemple.fr/browse/MIP-56");
    await expect(page.getByTestId("issue-activity-link")).toContainText("a lié le ticket MIP-56");

    // Clavier seul : statut suivant (« À revoir »), puis Tab jusqu'au bouton et Entrée.
    const statut = page.getByTestId("issue-triage-status");
    await expect(statut).toBeEnabled();
    await statut.focus();
    await page.keyboard.press("ArrowDown");
    await expect(statut).toHaveValue("for_review");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("issue-triage-assignee")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("issue-triage-submit")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-status")).toHaveText("À revoir");
  });

  test("édition concurrente : 409, rechargement proposé, seule la saisie de l'utilisateur se rejoue sur la révision relue", async ({ page }) => {
    await login(page);
    await page.goto(`${CONSOLE}${PAGE_ISSUE}`);
    // Quelqu'un d'autre assigne l'issue entre la lecture et l'enregistrement.
    const { rows: [{ id: viewerId }] } = await pool.query("select id::text as id from console_user where email = $1", [VIEWER_EMAIL]);
    await pool.query("update error_issue set assignee_user_id = $2, revision = revision + 1, updated_at = now() where id = $1", [ISSUE_W, viewerId]);

    const triage = page.getByTestId("issue-triage-form");
    await triage.getByTestId("issue-triage-status").selectOption("ignored");
    await triage.getByTestId("issue-triage-submit").click();
    const conflit = page.getByTestId("issue-triage-conflict");
    await expect(conflit).toContainText("modifiée depuis sa lecture");
    await expect(page.getByTestId("issue-status")).toHaveText("Ouverte");

    const { rows: [{ revision }] } = await pool.query("select revision::text as revision from error_issue where id = $1", [ISSUE_W]);
    await conflit.getByRole("button", { name: "Recharger l'issue" }).click();
    await expect(conflit).toHaveCount(0);
    // La page relue porte la nouvelle révision et l'assignation de l'autre ; le statut choisi, lui, est repris.
    await expect(triage).toHaveAttribute("data-revision", revision);
    await expect(page.getByTestId("issue-assignee")).toHaveText(VIEWER_EMAIL);
    await expect(triage.getByTestId("issue-triage-status")).toHaveValue("ignored");
    await expect(triage.getByTestId("issue-triage-assignee")).toHaveValue(viewerId);
    await triage.getByTestId("issue-triage-submit").click();
    await expect(page.getByTestId("issue-status")).toHaveText("Ignorée");
    // Le champ non touché n'a pas été renvoyé : l'assignation de l'autre tient.
    await expect(page.getByTestId("issue-assignee")).toHaveText(VIEWER_EMAIL);
  });

  test("viewer : état lisible sans adresse de compte, aucun formulaire, et l'API refuse l'écriture", async ({ page }) => {
    const { rows: [{ id: adminId }] } = await pool.query("select id from console_user where email = $1", [E2E_EMAIL]);
    await pool.query(
      "insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, body) values ($1, $2, 'comment', 'user', $3, 'vu en prod')",
      [APP_W, ISSUE_W, adminId],
    );
    await loginAs(page, VIEWER_EMAIL, VIEWER_PASSWORD);
    await page.goto(`${CONSOLE}${PAGE_ISSUE}`);
    await expect(page.getByTestId("issue-triage")).toContainText("Lecture seule");
    await expect(page.getByTestId("issue-assignee")).toHaveText("personne");
    // L'auteur d'un commentaire est un compte de la console, jamais son adresse.
    await expect(page.getByTestId("issue-activity-comment")).toContainText("Un compte de la console a commenté");
    await expect(page.getByTestId("issue-activity")).not.toContainText(E2E_EMAIL);
    for (const formulaire of ["issue-triage-form", "issue-comment-form", "issue-link-form", "issue-alert-link"]) {
      await expect(page.getByTestId(formulaire), formulaire).toHaveCount(0);
    }

    const { rows: [{ revision }] } = await pool.query("select revision::text as revision from error_issue where id = $1", [ISSUE_W]);
    const refus = await page.request.post(`${CONSOLE}/api/v1/issues/${ISSUE_W}/triage`, {
      headers: { origin: CONSOLE },
      data: { app: APP_W, status: "resolved", expectedRevision: revision },
    });
    expect(refus.status()).toBe(403);
    expect((await pool.query("select status from error_issue where id = $1", [ISSUE_W])).rows[0].status).toBe("open");
  });

  for (const width of [390, 768, 1440]) {
    test(`issue avec son workflow : aucun débordement horizontal de la page à ${width} px`, async ({ page }) => {
      const url = "https://tickets.exemple.fr/browse/MIP-56-un-identifiant-de-ticket-particulierement-long-pour-le-mobile";
      await pool.query(
        `with t as (insert into error_issue_ticket (app_id, issue_id, url, label) values ($1, $2, $3, 'MIP-56') returning id)
         insert into error_issue_activity (app_id, issue_id, kind, actor_kind, ticket_id) select $1, $2, 'link', 'user', id from t`,
        [APP_W, ISSUE_W, url],
      );
      await pool.query(
        "insert into error_issue_activity (app_id, issue_id, kind, actor_kind, body) values ($1, $2, 'comment', 'user', $3)",
        [APP_W, ISSUE_W, `Analyse ${"sans-espace-".repeat(20)}`],
      );
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.goto(`${CONSOLE}${PAGE_ISSUE}`);
      await expect(page.getByTestId("issue-triage-form")).toBeVisible();
      await expect(page.getByTestId("issue-activity-comment")).toBeVisible();
      const deborde = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(deborde).toBe(false);
    });
  }
});
