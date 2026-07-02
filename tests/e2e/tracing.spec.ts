// E2E v0.4 — tracing distribué bout-en-bout :
// démo (:8080) -> fetch + XHR instrumentés (traceparent) -> backend FastAPI (:8001)
// avec mip_rum_middleware -> spans front/back en base, corrélés par trace_id ->
// console /tracing + timeline session.
// Le backend de démo est spawné ici (demo/.venv ou python3 avec fastapi) ;
// sans FastAPI disponible, la suite est skippée proprement.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

// utilisateur DÉDIÉ à ce spec : seed-admin régénère le mdp de julian@ à chaque
// run, et les spec files tournent en parallèle (course constatée sur rum-flow)
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

function pythonBin(): string | null {
  for (const bin of ["demo/.venv/bin/python", "python3"]) {
    try {
      execFileSync(bin, ["-c", "import fastapi, uvicorn"], { stdio: "ignore" });
      return bin;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}
const PY = pythonBin();

let backend: ChildProcess | null = null;

test.beforeAll(async () => {
  test.skip(!PY, "fastapi/uvicorn indisponibles (demo/.venv absent et python3 nu)");
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin', apps = null, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );

  backend = spawn(PY!, ["demo/backend.py"], {
    env: {
      ...process.env,
      MIP_RUM_ENDPOINT: "http://localhost:4318/v1/traces",
      MIP_RUM_APP_ID: "demo-app",
      MIP_RUM_API_KEY: "demo-key-local",
      MIP_RUM_FLUSH_S: "1",
      MIP_RUM_BATCH: "1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://localhost:8001/health")).ok) return;
    } catch {
      /* pas encore debout */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("backend démo :8001 indisponible après 10 s");
});

test.afterAll(async () => {
  backend?.kill();
  await pool.end();
});

async function loginConsole(page: Page) {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  // porte « projet courant » : choisir le premier projet si le picker s'affiche
  if (new URL(page.url()).pathname === "/select") {
    await page.getByTestId("project-card").first().click();
    await page.waitForURL((u) => u.pathname !== "/select", { timeout: 15_000 });
  }
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
  await page.goto("http://localhost:8080/", { waitUntil: "load" });
  await page.click("#btn-api-fetch");
  await page.click("#btn-api-xhr");
  await page.waitForTimeout(400);
  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")!).sid,
  );
  await page.waitForTimeout(2500); // flush SDK (2 s) — le middleware flushe en 1 s

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

  // chaque appel front a son jumeau backend (même trace_id), route template FastAPI
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
    expect(b.route).toBe("/api/demo/items/{item_id}");
    expect(b.session_id).toBe(sid); // tracestate mip=s:<sid> lu par le middleware
    expect(b.parent_span_id).not.toBeNull();
    expect(Number(b.duration_ms)).toBeGreaterThanOrEqual(140); // sleep 150 ms simulé
  }
});

test("console : /tracing affiche la corrélation et la timeline montre l'appel API", async ({
  page,
}) => {
  await loginConsole(page);

  await page.goto("http://localhost:3000/tracing", { waitUntil: "networkidle" });
  await expect(page.getByTestId("back-routes")).toContainText("/api/demo/items/{item_id}");
  await expect(page.getByTestId("api-calls")).toContainText("/api/demo/items/");
  await expect(page.getByTestId("trace-coverage")).not.toContainText("— %");

  // dernière session de demo-app avec un appel API -> timeline
  const [row] = await pool.query(
    `select session_id from rum_span where tier = 'front' and app_id = 'demo-app'
     order by ts desc limit 1`,
  ).then((r) => r.rows);
  await page.goto(`http://localhost:3000/sessions/${row.session_id}`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator("body")).toContainText("Appel API");
  await expect(page.locator("body")).toContainText("serveur");
});
