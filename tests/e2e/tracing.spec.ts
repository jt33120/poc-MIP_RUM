// E2E v0.4 — tracing distribué bout-en-bout :
// démo (:8080) -> fetch + XHR instrumentés (traceparent) -> backend FastAPI (:8001)
// sous l'agent OpenTelemetry OFFICIEL (`opentelemetry-instrument`, aucun capteur
// MIP) -> spans front/back en base, corrélés par trace_id -> console /tracing +
// timeline session.
// Le backend de démo est spawné ici (tests/e2e/site-cobaye/.venv, sinon le PATH) ;
// s'il manque l'agent ou FastAPI, les deux tests bout en bout sont sautés.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { debordements, LARGEURS } from "./helpers/debordements";

// utilisateur DÉDIÉ à ce spec : seed-admin régénère le mdp de julian@ à chaque
// run, et les spec files tournent en parallèle (course constatée sur rum-flow)
// Comme les autres specs : la console visée se règle par PLAYWRIGHT_CONSOLE_URL.
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const E2E_EMAIL = "e2e-tracing@mip-rum.local";
const E2E_PASSWORD = "e2e-tracing-mdp-local";

// bcryptjs vit dans le workspace console ; hash généré en sous-processus CJS
// (createRequire + import.meta sont piégeux sous le transpileur Playwright)
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
      E2E_PASSWORD,
    ],
    { encoding: "utf8" },
  );
}

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

/**
 * Les trois exécutables du backend de démo : le Python qui porte FastAPI et
 * l'agent, `opentelemetry-instrument` et `uvicorn`. Le venv d'abord (celui que la
 * CI remplit depuis requirements.txt), puis le PATH. Un candidat n'est retenu que
 * si son Python importe à la fois l'application et l'agent : sans l'agent, le
 * backend répondrait sans rien envoyer, et le test échouerait loin de sa cause.
 */
function lanceurOtel(): { python: string; instrument: string; uvicorn: string } | null {
  const VENV = "tests/e2e/site-cobaye/.venv/bin";
  const candidats = [
    { python: `${VENV}/python`, instrument: `${VENV}/opentelemetry-instrument`, uvicorn: `${VENV}/uvicorn` },
    { python: "python3", instrument: "opentelemetry-instrument", uvicorn: "uvicorn" },
  ];
  for (const c of candidats) {
    if (c.python.includes("/") && !existsSync(c.python)) continue;
    try {
      execFileSync(
        c.python,
        ["-c", "import fastapi, uvicorn, opentelemetry.instrumentation.fastapi, opentelemetry.exporter.otlp.proto.http"],
        { stdio: "ignore" },
      );
      return c;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}
const LANCEUR = lanceurOtel();

let backend: ChildProcess | null = null;

// Sans FastAPI, seuls les deux tests bout en bout sont sautés (chacun le dit) : un
// `test.skip` dans ce crochet de fichier sauterait aussi les blocs d'écran (F60),
// qui sèment leurs spans en base et n'ont pas besoin du backend de démo.
const SANS_FASTAPI =
  "fastapi/uvicorn ou l'agent OpenTelemetry indisponibles (tests/e2e/site-cobaye/.venv absent, et rien sur le PATH : pip install -r tests/e2e/site-cobaye/requirements.txt)";

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );

  if (!LANCEUR) return;
  // Le socle commun `OTEL_*` de docs/capteurs-serveur.md § 1, et RIEN d'autre : c'est
  // la configuration d'un client. Seul écart, le délai d'export (5 s par défaut)
  // ramené à 200 ms, pour que les spans arrivent pendant le test.
  backend = spawn(
    LANCEUR.instrument,
    [LANCEUR.uvicorn, "--app-dir", "tests/e2e/site-cobaye", "backend:app", "--host", "127.0.0.1", "--port", "8001", "--log-level", "warning"],
    {
      env: {
        ...process.env,
        OTEL_SERVICE_NAME: "site-cobaye-backend",
        OTEL_RESOURCE_ATTRIBUTES: "mip.app_id=demo-app,mip.api_key=demo-key-local,deployment.environment.name=e2e",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://localhost:4318/v1/logs",
        OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_BSP_SCHEDULE_DELAY: "200",
        OTEL_BLRP_SCHEDULE_DELAY: "200",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  // Le journal d'erreur de l'agent, gardé pour le message d'échec (lu en continu :
  // un tube plein bloquerait le serveur).
  let journal = "";
  backend.stderr?.on("data", (d: Buffer) => {
    journal = (journal + d.toString()).slice(-4000);
  });
  // L'agent charge ses instrumentations avant qu'uvicorn n'écoute : 20 s.
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://localhost:8001/health")).ok) return;
    } catch {
      /* pas encore debout */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`backend démo :8001 indisponible après 20 s\n${journal}`);
});

test.afterAll(async () => {
  backend?.kill();
  await pool.end();
});

async function loginConsole(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  // Porte « projet courant » (/select) : projet fixé de façon déterministe sur
  // l'app de la démo e2e (demo-app) pour scoper les vues console à ses données.
  await page.context().addCookies([
    { name: "mip-project", value: "demo-app", url: consoleUrl },
  ]);
}

async function pollRows(sql: string, params: unknown[], minCount: number, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(sql, params);
    if (rows.length >= minCount) return rows;
    await new Promise((r) => setTimeout(r, 500));
  }
  return (await pool.query(sql, params)).rows;
}

test("fetch + XHR -> spans front ET back corrélés par trace_id en base", async ({ page }) => {
  test.skip(!LANCEUR, SANS_FASTAPI);
  await page.goto("http://localhost:8080/", { waitUntil: "load" });
  await page.click("#btn-api-fetch");
  await page.click("#btn-api-xhr");
  await page.waitForTimeout(400);
  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")!).sid,
  );
  await page.waitForTimeout(2500); // flush SDK (2 s) — l'agent exporte toutes les 200 ms

  const fronts = await pollRows(
    "select trace_id, url, method, status_code, duration_ms from rum_span where session_id = $1 and tier = 'front'",
    [sid],
    2,
  );
  expect(fronts.length).toBeGreaterThanOrEqual(2);
  for (const f of fronts) {
    expect(f.url).toContain("/api/demo/items/");
    expect(Number(f.status_code)).toBe(200);
  }

  // chaque appel front a son jumeau backend (même trace_id). La route est le
  // template FastAPI (`http.route` = /api/demo/items/{item_id}) sous sa forme
  // canonique `:nom`, que l'ingestion donne à tout `http.route` (normalizeRouteTemplate).
  // Les spans internes ASGI (« … http send ») ne sont pas des spans serveur : tier
  // `detail`, hors de cette requête.
  const backs = await pollRows(
    `select b.route, b.session_id, b.parent_span_id, b.duration_ms
     from rum_span b
     join rum_span f on f.trace_id = b.trace_id and f.tier = 'front'
     where b.tier = 'back' and f.session_id = $1`,
    [sid],
    2,
  );
  expect(backs.length).toBeGreaterThanOrEqual(2);
  for (const b of backs) {
    expect(b.route).toBe("/api/demo/items/:item_id");
    // tracestate mip=s:<sid> : propagé par l'agent dans le traceState du span serveur, lu par l'ingestion
    expect(b.session_id).toBe(sid);
    expect(b.parent_span_id).not.toBeNull();
    expect(Number(b.duration_ms)).toBeGreaterThanOrEqual(140); // sleep 150 ms simulé
  }
});

test("console : /tracing affiche la corrélation et la timeline montre l'appel API", async ({
  page,
}) => {
  test.skip(!LANCEUR, SANS_FASTAPI);
  await loginConsole(page);

  await page.goto(`${consoleUrl}/tracing`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("back-routes")).toContainText("/api/demo/items/:item_id");
  await expect(page.getByTestId("api-calls")).toContainText("/api/demo/items/");
  // F60 : la couverture est la tuile « Appels suivis jusqu'au serveur » ; mesurée, jamais « — ».
  // Par son libellé complet, qui ouvre son nom accessible : depuis le 30/09/2026 la case
  // n'affiche qu'un libellé court, et la tuile « Durée p75 côté serveur » en parle aussi.
  const couverture = page.locator(`[data-testid="kpi-tile"][aria-label^="Appels suivis jusqu'au serveur "]`);
  await expect(couverture.getByTestId("kpi-valeur")).not.toHaveText("—");

  // dernière session de demo-app avec un appel API -> timeline
  const [row] = await pool.query(
    `select session_id from rum_span where tier = 'front' and app_id = 'demo-app'
     order by ts desc limit 1`,
  ).then((r) => r.rows);
  await page.goto(`${consoleUrl}/sessions/${row.session_id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toContainText("Appel API");
  await expect(page.locator("body")).toContainText("serveur");
});

// ─────────────────────────────────────────────────────────────────────────────
// Écran Tracing refait (§ 5.8, F60) : spans SYNTHÉTIQUES semés dans une app dédiée,
// sans backend de démo. Ce bloc prouve ce que l'écran promet :
//   - une barre = le p75 vu du navigateur, et la légende l'écrit (DF2 : plus aucune
//     barre coupée en « serveur » + « réseau = front_p75 − back_p75 ») ;
//   - un clic sur une barre du classement mène à SA ligne de « Tous les appels API »,
//     hors du <details> ; chaque ligne porte `id="appel-<hash>"` ;
//   - « Traces de cet appel » filtre les traces lentes (`appel=`, `#traces`) ;
//   - le rejeu s'ouvre à l'instant de l'appel (`at` en ms epoch) ;
//   - sans déploiement, le panneau dit comment en déclarer un ;
//   - rien ne déborde à 390, 768 et 1440 px.
// ─────────────────────────────────────────────────────────────────────────────

const CONSOLE_F60 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

/** Appels semés : méthode, chemin, puis un triplet (ms navigateur, ms serveur | null, statut) par trace. */
const APPELS_F60: [string, string, [number, number | null, number][]][] = [
  ["GET", "/api/f60/lent", [[1200, 300, 200], [1100, 250, 200], [900, 200, 200]]],
  // Un échec serveur (503) : sa trace sert aussi le détail de trace.
  ["POST", "/api/f60/panier", [[800, 780, 503], [600, 100, 200]]],
  // Dix appels rapides, non suivis : douze appels distincts, donc deux dans le <details>.
  ...Array.from({ length: 10 }, (_v, i): [string, string, [number, number | null, number][]] => [
    "GET",
    `/api/f60/c${String(i).padStart(2, "0")}`,
    [[100 + i * 10, null, 200]],
  ]),
];

/**
 * Sème les spans d'une app dédiée : identifiants HEXADÉCIMAUX (le détail de trace
 * n'accepte `?span=` que sur 16 caractères hexadécimaux), préfixés par app pour
 * rester uniques dans `rum_span`. Aucun marqueur de déploiement : le panneau T11
 * doit dire « Non collecté ».
 */
async function semerTracesF60(app: string, prefixe: string): Promise<void> {
  for (const t of ["rum_span", "rum_error", "rum_session", "deploy_marker"]) {
    await pool.query(`delete from ${t} where app_id = $1`, [app]);
  }
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, $2) on conflict (app_id) do nothing`,
    [app, `Tracing E2E ${app}`],
  );
  const session = `${app}-s1`;
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
     values ($1, $2, $1, 'desktop', false, now() - interval '3 hours', now() - interval '5 minutes', 4)
     on conflict (session_id) do nothing`,
    [session, app],
  );
  let k = 0;
  for (const [methode, chemin, traces] of APPELS_F60) {
    for (const [front, back, statut] of traces) {
      k++;
      const trace = `${prefixe}${k.toString(16).padStart(28, "0")}`;
      const spanFront = `${prefixe}${(k * 2).toString(16).padStart(12, "0")}`;
      const spanBack = `${prefixe}${(k * 2 + 1).toString(16).padStart(12, "0")}`;
      const minutes = 10 + k * 7;
      await pool.query(
        `insert into rum_span (span_id, trace_id, tier, app_id, session_id, method, url, status_code, duration_ms, route, name, ts)
         values ($1, $2, 'front', $3, $4, $5, $6, $7, $8, '/f60', $9, now() - $10::int * interval '1 minute')`,
        [spanFront, trace, app, session, methode, chemin, statut, front, `${methode} ${chemin}`, minutes],
      );
      if (back === null) continue;
      await pool.query(
        `insert into rum_span (span_id, trace_id, parent_span_id, tier, app_id, session_id, method, url, status_code, duration_ms, route, name, ts)
         values ($1, $2, $3, 'back', $4, $5, $6, null, $7, $8, $9, $10,
                 now() - $11::int * interval '1 minute' + interval '5 milliseconds')`,
        [spanBack, trace, spanFront, app, session, methode, statut, back, chemin, `${methode} ${chemin}`, minutes],
      );
    }
  }
}

test.describe("F60 — écran Tracing (§ 5.8)", () => {
  const APP_F60 = "f60-e2e-tracing";
  const LENT = "GET /api/f60/lent";

  test.beforeAll(async () => {
    await semerTracesF60(APP_F60, "f60a");
  });

  const ouvrir = async (page: Page, extra = "") => {
    await loginConsole(page);
    await page.goto(`${CONSOLE_F60}/tracing?app=${APP_F60}${extra}`, { waitUntil: "domcontentloaded" });
  };

  test("hero : une barre = le p75 navigateur, légende écrite ; un clic mène à la ligne de la table", async ({ page }) => {
    await ouvrir(page);
    const hero = page.locator("#hero-traces");
    await expect(hero).toContainText("Barre = durée p75 vue du navigateur");
    await expect(hero).toContainText("Part serveur = médiane, appel par appel");

    await hero.getByRole("link", { name: LENT, exact: true }).click();
    const id = `appel-${encodeURIComponent(LENT)}`;
    // Retrouvée par getElementById (l'identifiant porte des « % ») : présente, visible, hors du <details>.
    await expect
      .poll(() =>
        page.evaluate((i) => {
          const el = document.getElementById(i);
          return !!el && !el.closest("details") && el.getClientRects().length > 0;
        }, id),
      )
      .toBe(true);
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();

    // T8 : chaque ligne porte son ancre ; douze appels, dont deux repliés.
    const ids = await page.locator('[data-testid="ligne-appel"]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toHaveLength(12);
    expect(ids.every((i) => i.startsWith("appel-"))).toBe(true);
    await expect(page.getByTestId("appels-suivants")).toContainText("Voir les 12 appels");
  });

  test("« Traces de cet appel » : appel= et #traces ; seules ses traces ; rejeu à l'instant de l'appel", async ({ page }) => {
    await ouvrir(page);
    await page.locator("#hero-traces").getByTestId("traces-appel").first().click();
    await page.waitForURL((u) => u.searchParams.get("appel") === LENT && u.hash === "#traces", { timeout: 15_000 });

    const lignes = page.locator('#traces [data-testid="trace-lente"]');
    await expect(lignes).toHaveCount(3);
    expect(await lignes.evaluateAll((els) => els.map((e) => e.getAttribute("data-appel")))).toEqual([LENT, LENT, LENT]);
    await expect(page.locator("#traces")).toContainText(`Traces les plus lentes — ${LENT}`);

    // La plus lente d'abord ; son rejeu s'ouvre à l'instant de l'appel, en ms epoch.
    const { rows } = await pool.query(
      `select ts, span_id from rum_span where app_id = $1 and tier = 'front' and url = '/api/f60/lent' order by duration_ms desc limit 1`,
      [APP_F60],
    );
    const href = await lignes.first().getByTestId("rejeu-instant").getAttribute("href");
    const cible = new URL(href!, CONSOLE_F60);
    expect(cible.searchParams.get("tab")).toBe("replay");
    expect(cible.searchParams.get("at")).toBe(String(new Date(rows[0].ts).getTime()));
    // Le détail s'ouvre sur CET appel (`span=`) : une trace de page vue en porte plusieurs (E0).
    const detail = await lignes.first().locator('a[href^="/tracing/"]').getAttribute("href");
    expect(new URL(detail!, CONSOLE_F60).searchParams.get("span")).toBe(rows[0].span_id);
  });

  test("?appel= posé : la table des traces ne liste que cet appel, et le filtre se retire", async ({ page }) => {
    await ouvrir(page, `&appel=${encodeURIComponent("POST /api/f60/panier")}`);
    const lignes = page.locator('#traces [data-testid="trace-lente"]');
    await expect(lignes).toHaveCount(2);
    expect(new Set(await lignes.evaluateAll((els) => els.map((e) => e.getAttribute("data-appel"))))).toEqual(
      new Set(["POST /api/f60/panier"]),
    );
    await expect(page.getByTestId("retirer-appel")).toBeVisible();
  });

  test("sans déploiement : le panneau reste et nomme POST /api/v1/deploys", async ({ page }) => {
    await ouvrir(page);
    await expect(page.locator("#deploiements")).toContainText("Non collecté");
    await expect(page.locator("#deploiements")).toContainText("POST /api/v1/deploys");
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await loginConsole(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${CONSOLE_F60}/tracing?app=${APP_F60}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#hero-traces")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
    }
    expect(fautes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Détail de trace (§ 5.9, F61) : même semis que F60, dans SA propre app. La trace
// n° 4 (« POST /api/f60/panier », 503 côté navigateur et côté serveur) sert de cas :
//   - le segment 503 porte le ton `erreur` (la couleur dit la sévérité) ;
//   - l'identifiant COMPLET (32 caractères) se copie ;
//   - `?span=` inconnu → état `missing`, jamais une mise en évidence silencieuse ;
//   - « Erreurs liées » somme les occurrences (V1) ; rejeu à l'instant de l'appel.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("F61 — détail de trace (§ 5.9)", () => {
  const APP_F61 = "f61-e2e-trace";
  const PREFIXE = "f61b";
  // Quatrième trace semée (trois « GET /api/f60/lent », puis le 503).
  const TRACE_503 = `${PREFIXE}${(4).toString(16).padStart(28, "0")}`;
  const FRONT_503 = `${PREFIXE}${(8).toString(16).padStart(12, "0")}`;
  // Trace E0 à deux appels : identifiants hexadécimaux hors de la plage du semis F60.
  const TRACE_E0 = `${PREFIXE}${"e0".padStart(28, "0")}`;
  const CONFIG_E0 = `${PREFIXE}${"e1".padStart(12, "0")}`;
  const SEARCH_E0 = `${PREFIXE}${"e3".padStart(12, "0")}`;

  test.beforeAll(async () => {
    await semerTracesF60(APP_F61, PREFIXE);
    // Deux lignes du même groupe sur la trace 503 : l'écran doit dire 5 occurrences, pas 2 lignes.
    for (const [i, occurrences] of [2, 3].entries()) {
      await pool.query(
        `insert into rum_error (span_id, session_id, app_id, route, kind, error_type, message, fingerprint,
                                trace_id, source_parent_span_id, occurrences, ts)
         values ($1, $2, $3, '/f60', 'error', 'TypeError', 'panier indisponible (e2e)', 'f61-e2e-fp',
                 $4, $5, $6, now() - interval '30 minutes')`,
        [`${APP_F61}-err-${i}`, `${APP_F61}-s1`, APP_F61, TRACE_503, FRONT_503, occurrences],
      );
    }
    // Une page vue, deux appels, UNE trace (E0) : /api/f61/config puis /api/f61/search,
    // chacun avec sa réponse serveur (parent = son span navigateur).
    const appels: [string, string, number, string, number, number][] = [
      [CONFIG_E0, "/api/f61/config", 100, `${PREFIXE}${"e2".padStart(12, "0")}`, 90, 0],
      [SEARCH_E0, "/api/f61/search", 1000, `${PREFIXE}${"e4".padStart(12, "0")}`, 900, 200],
    ];
    for (const [front, url, frontMs, back, backMs, decalageMs] of appels) {
      await pool.query(
        `insert into rum_span (span_id, trace_id, tier, app_id, session_id, method, url, status_code, duration_ms, route, name, ts)
         values ($1, $2, 'front', $3, $4, 'GET', $5, 200, $6, '/f61', $7,
                 now() - interval '20 minutes' + $8::int * interval '1 millisecond')`,
        [front, TRACE_E0, APP_F61, `${APP_F61}-s1`, url, frontMs, `GET ${url}`, decalageMs],
      );
      await pool.query(
        `insert into rum_span (span_id, trace_id, parent_span_id, tier, app_id, session_id, method, status_code, duration_ms, route, name, ts)
         values ($1, $2, $3, 'back', $4, $5, 'GET', 200, $6, $7, $8,
                 now() - interval '20 minutes' + ($9::int + 5) * interval '1 millisecond')`,
        [back, TRACE_E0, front, APP_F61, `${APP_F61}-s1`, backMs, url, `GET ${url}`, decalageMs],
      );
    }
  });

  test("une trace à deux appels : `?span=` résume CET appel, pas le premier", async ({ page }) => {
    await loginConsole(page);
    await page.goto(`${CONSOLE_F60}/tracing/${TRACE_E0}?app=${APP_F61}&span=${SEARCH_E0}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trace-appel")).toContainText("GET /api/f61/search");
    await expect(page.getByTestId("trace-latence")).toContainText("1,0");
    await expect(page.getByTestId("trace-plusieurs-appels")).toHaveCount(0);
    const { rows } = await pool.query(`select ts from rum_span where span_id = $1`, [SEARCH_E0]);
    const rejeu = new URL((await page.getByTestId("rejeu-appel").getAttribute("href"))!, CONSOLE_F60);
    expect(rejeu.searchParams.get("at")).toBe(String(new Date(rows[0].ts).getTime()));

    // Sans `span=` : le premier appel, et la page le DIT.
    await page.goto(`${CONSOLE_F60}/tracing/${TRACE_E0}?app=${APP_F61}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trace-appel")).toContainText("GET /api/f61/config");
    await expect(page.getByTestId("trace-plusieurs-appels")).toContainText("2 appels navigateur");
  });

  const ouvrir = async (page: Page, extra = "") => {
    await loginConsole(page);
    await page.goto(`${CONSOLE_F60}/tracing/${TRACE_503}?app=${APP_F61}${extra}`, { waitUntil: "domcontentloaded" });
  };

  test("un segment 503 est en ton « erreur » ; la sévérité est aussi écrite", async ({ page }) => {
    await ouvrir(page);
    const erreurs = page.locator('#chronologie [data-testid="cascade-element"][data-ton="erreur"]');
    await expect(erreurs).toHaveCount(2); // navigateur et serveur
    await expect(erreurs.first()).toContainText("HTTP 503");
    await expect(erreurs.first()).toContainText("erreur");
  });

  test("l'identifiant complet (32 caractères) se copie", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: CONSOLE_F60 });
    await ouvrir(page);
    await expect(page.getByTestId("trace-id")).toHaveValue(TRACE_503);
    expect(TRACE_503).toHaveLength(32);
    await page.getByTestId("copier-trace").click();
    await expect(page.getByTestId("copier-trace")).toHaveText("Copié");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TRACE_503);
  });

  test("?span= inconnu → état « missing » ; connu → mis en évidence", async ({ page }) => {
    await ouvrir(page, "&span=ffffffffffffffff");
    await expect(page.getByTestId("trace-span-state")).toHaveAttribute("data-span-state", "missing");
    await page.goto(`${CONSOLE_F60}/tracing/${TRACE_503}?app=${APP_F61}&span=${FRONT_503}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trace-span-state")).toHaveAttribute("data-span-state", "found");
    await expect(page.locator('#chronologie [aria-current="true"]')).toHaveCount(1);
  });

  test("erreurs liées : sum(occurrences) et lien vers le segment parent ; rejeu à l'instant de l'appel", async ({ page }) => {
    await ouvrir(page);
    const liees = page.getByTestId("erreurs-liees");
    await expect(liees).toContainText("panier indisponible (e2e)");
    await expect(liees).toContainText("5 occurrences");
    await expect(liees.getByRole("link", { name: "Segment parent" })).toHaveAttribute("href", new RegExp(`span=${FRONT_503}`));

    const { rows } = await pool.query(`select ts from rum_span where span_id = $1`, [FRONT_503]);
    const href = await page.getByTestId("rejeu-appel").getAttribute("href");
    const cible = new URL(href!, CONSOLE_F60);
    expect(cible.pathname).toBe(`/sessions/${APP_F61}-s1`);
    expect(cible.searchParams.get("tab")).toBe("replay");
    expect(cible.searchParams.get("at")).toBe(String(new Date(rows[0].ts).getTime()));
  });

  test("aucun débordement à 390, 768 et 1440 px", async ({ page }) => {
    await loginConsole(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${CONSOLE_F60}/tracing/${TRACE_503}?app=${APP_F61}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#chronologie")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px — ${faute}`);
    }
    expect(fautes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recette UTI du 28/09/2026 : une app dont le SERVEUR envoie (un scanner de
// vulnérabilités, 59 800 requêtes en une nuit) mais qu'aucun visiteur n'a ouverte
// depuis cinq jours. Tracing disait « 0 appel API », la Vue d'ensemble « cette
// application n'a pas encore reçu de données ». Ce bloc prouve que les deux écrans
// disent la vérité : rien de NAVIGATEUR sur la plage, la dernière visite datée, et
// les requêtes serveur nommées, avec le chemin vers « Routes serveur ».
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Recette UTI — requêtes serveur sans visite", () => {
  const APP_UTI = "uti-e2e-serveur";
  // Des requêtes de scanner, sans session : deux routes, cinq requêtes.
  const REQUETES: [string, number][] = [
    ["/wp-login.php", 404],
    ["/wp-login.php", 404],
    ["/wp-login.php", 404],
    ["/", 200],
    ["/", 200],
  ];

  test.beforeAll(async () => {
    for (const t of ["rum_span", "rum_pageview", "rum_session"]) {
      await pool.query(`delete from ${t} where app_id = $1`, [APP_UTI]);
    }
    await pool.query(
      `insert into app_registry (app_id, name) values ($1, 'Recette UTI E2E') on conflict (app_id) do nothing`,
      [APP_UTI],
    );
    // La dernière visite date de trois jours : hors de la plage de 24 h.
    await pool.query(
      `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count)
       values ($1, $2, $1, 'desktop', false, now() - interval '3 days', now() - interval '3 days', 1)
       on conflict (session_id) do nothing`,
      [`${APP_UTI}-s1`, APP_UTI],
    );
    for (const [i, [route, statut]] of REQUETES.entries()) {
      // Hexadécimal, préfixé par ce bloc : unique dans `rum_span`, lisible par le détail de trace.
      const id = `0e7e${(i + 1).toString(16).padStart(12, "0")}`;
      await pool.query(
        `insert into rum_span (span_id, trace_id, tier, kind, service, app_id, method, status_code, duration_ms, route, name, ts)
         values ($1, $2, 'back', 'server', 'fastapi', $3, 'GET', $4, 3, $5, $6, now() - $7::int * interval '1 minute')`,
        [id, id.padEnd(32, "0"), APP_UTI, statut, route, `GET ${route}`, 20 + i],
      );
    }
  });

  test("Tracing : aucun appel navigateur, mais les requêtes serveur sont comptées et listées", async ({ page }) => {
    await loginConsole(page);
    await page.goto(`${CONSOLE_F60}/tracing?app=${APP_UTI}&period=24h`, { waitUntil: "domcontentloaded" });
    const note = page.getByTestId("serveur-sans-navigateur");
    await expect(note).toContainText("5 requêtes serveur tracées");
    await expect(note.getByRole("link", { name: "Routes serveur" })).toHaveAttribute("href", "#routes-serveur");
    await expect(page.getByTestId("back-routes")).toContainText("/wp-login.php");
  });

  test("Vue d'ensemble : rien sur 24 h n'est pas « jamais rien reçu »", async ({ page }) => {
    await loginConsole(page);
    await page.goto(`${CONSOLE_F60}/?app=${APP_UTI}&period=24h`, { waitUntil: "domcontentloaded" });
    const bandeau = page.getByTestId("onboarding-nudge");
    await expect(bandeau).toContainText("Aucune visite mesurée sur les dernières 24 h.");
    await expect(bandeau).toContainText("Dernière visite reçue le");
    await expect(bandeau).not.toContainText("pas encore reçu");
    // Le capteur a fonctionné : pas de guide d'installation.
    await expect(bandeau.getByRole("link", { name: /Guide d.intégration/ })).toHaveCount(0);
    const serveur = page.getByTestId("activite-serveur");
    await expect(serveur).toContainText("requêtes tracées sans visite");
    const lien = new URL((await serveur.getByRole("link", { name: "Voir les routes serveur" }).getAttribute("href"))!, CONSOLE_F60);
    expect(lien.pathname).toBe("/tracing");
    expect(lien.hash).toBe("#routes-serveur");
    expect(lien.searchParams.get("app")).toBe(APP_UTI);
  });

  test("aucun débordement à 390, 768 et 1440 px (Tracing et Vue d'ensemble)", async ({ page }) => {
    await loginConsole(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.goto(`${CONSOLE_F60}/tracing?app=${APP_UTI}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("serveur-sans-navigateur")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px, /tracing — ${faute}`);
      await page.goto(`${CONSOLE_F60}/?app=${APP_UTI}&period=24h`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("onboarding-nudge")).toBeVisible();
      for (const faute of await debordements(page)) fautes.push(`${largeur} px, / — ${faute}`);
    }
    expect(fautes).toEqual([]);
  });
});
