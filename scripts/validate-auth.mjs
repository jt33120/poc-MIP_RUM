// Validation B3 — RBAC/auth console (fetch + cookies sur :3000, DB :5433).
// Preuves ROADMAP : redirect sans cookie, login admin seedé, viewer scopé
// (sélecteur filtré + fallback d'app), user désactivé refusé, audit_log rempli,
// /mip-rum.js public. Les formulaires server-action sont postés via le fallback
// no-JS de Next (input caché $ACTION_ID_xxx parsé dans le HTML).
import { execFileSync } from "node:child_process";
import pg from "pg";

const CONSOLE = process.env.CONSOLE_URL ?? "http://localhost:3000";
const VIEWER_EMAIL = "viewer-b3@mip-rum.local";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

const checks = [];
function check(name, ok, detail = "") {
  checks.push(ok);
  console.log(`${ok ? "OK" : "KO"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- mini cookie jar -------------------------------------------------------
function absorb(res, jar) {
  for (const c of res.headers.getSetCookie()) {
    const [kv, ...attrs] = c.split(";");
    const i = kv.indexOf("=");
    const name = kv.slice(0, i).trim();
    const value = kv.slice(i + 1);
    const gone = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
    if (gone) jar.delete(name);
    else jar.set(name, value);
  }
}
const header = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function get(path, jar, follow = false) {
  let url = CONSOLE + path;
  for (let hops = 0; hops < 5; hops++) {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: header(jar) } });
    absorb(res, jar);
    const loc = res.headers.get("location");
    if (!follow || !loc || res.status < 300 || res.status >= 400) return res;
    url = new URL(loc, CONSOLE).href;
  }
  throw new Error("trop de redirections");
}

/** Poste un formulaire server-action (fallback no-JS, multipart) : fields + $ACTION_ID="". */
async function postForm(path, jar, actionId, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  body.append(actionId, "");
  const res = await fetch(CONSOLE + path, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: header(jar) },
    body,
  });
  absorb(res, jar);
  return res;
}

/** $ACTION_ID du <form> contenant le marqueur (testid/champ) donné. */
function actionIdFor(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`marqueur introuvable : ${marker}`);
  const start = html.lastIndexOf("<form", at);
  const end = html.indexOf("</form>", at);
  const m = html.slice(start, end).match(/\$ACTION_ID_[0-9a-f]+/);
  if (!m) throw new Error(`$ACTION_ID introuvable pour : ${marker}`);
  return m[0];
}

async function login(email, password) {
  const jar = new Map();
  const page = await get("/login", jar);
  const html = await page.text();
  const res = await postForm("/login", jar, actionIdFor(html, 'data-testid="login-form"'), {
    email,
    password,
  });
  return { jar, res };
}

// --- 0. seed admin (idempotent) + nettoyage du viewer de test ---------------
const seedOut = execFileSync("node", [new URL("./seed-admin.mjs", import.meta.url).pathname], {
  encoding: "utf8",
});
const adminPassword = seedOut.match(/mot de passe \(affiché une seule fois\) : (\S+)/)?.[1];
if (!adminPassword) throw new Error("mot de passe admin non trouvé dans la sortie du seed");
console.log("seed admin ok (mot de passe capturé)");
await pool.query(`delete from console_user where email = $1`, [VIEWER_EMAIL]);
const auditBefore = Number(
  (await pool.query(`select count(*)::int as n from audit_log`)).rows[0].n,
);

// --- 1. sans cookie -> 302 /login ; SDK public ------------------------------
{
  const res = await get("/", new Map());
  const loc = res.headers.get("location") ?? "";
  check("sans cookie : / -> 302 /login", res.status === 302 && loc.includes("/login"), `status=${res.status} loc=${loc}`);
  const sdk = await get("/mip-rum.js", new Map());
  check("/mip-rum.js public sans cookie -> 200", sdk.status === 200, `status=${sdk.status}`);
  const replay = await get("/mip-rum-replay.js", new Map());
  check("/mip-rum-replay.js non protégé (pas de redirect login)", replay.status !== 302, `status=${replay.status} (404 toléré tant que B2 n'a pas posé le bundle)`);
}

// --- 2. login admin seedé -> 200 --------------------------------------------
const { jar: adminJar, res: adminLogin } = await login("julian@mip-rum.local", adminPassword);
{
  const loc = adminLogin.headers.get("location") ?? "";
  const home = await get("/", adminJar, true);
  check(
    "login admin seedé -> redirect / puis 200",
    adminLogin.status === 303 && new URL(loc, CONSOLE).pathname === "/" && home.status === 200 && adminJar.has("mip_session"),
    `post=${adminLogin.status} loc=${loc} home=${home.status}`,
  );
}

// --- 3. l'admin crée un viewer scopé 'demo-app' ------------------------------
let viewerPassword = null;
{
  const page = await get("/admin/users", adminJar);
  const html = await page.text();
  const res = await postForm("/admin/users", adminJar, actionIdFor(html, 'data-testid="create-user-form"'), {
    email: VIEWER_EMAIL,
    role: "viewer",
    apps: "demo-app",
  });
  const loc = res.headers.get("location") ?? "";
  const shown = await get(new URL(loc, CONSOLE).pathname + new URL(loc, CONSOLE).search, adminJar);
  const shownHtml = await shown.text();
  viewerPassword = shownHtml.match(/data-testid="generated-password"[^>]*>([^<]+)</)?.[1] ?? null;
  check(
    "création viewer scopé demo-app + mot de passe affiché une fois",
    res.status === 303 && loc.includes("pwt=") && !!viewerPassword,
    `post=${res.status} pw=${viewerPassword ? "capturé" : "ABSENT"}`,
  );
}

// --- 4. login viewer : sélecteur filtré + fallback d'app ---------------------
const { jar: viewerJar } = await login(VIEWER_EMAIL, viewerPassword ?? "x");
{
  const home = await get("/", viewerJar, true); // middleware force ?app=demo-app
  const html = await home.text();
  const select = html.match(/data-testid="filter-app"[\s\S]*?<\/select>/)?.[0] ?? "";
  check(
    "viewer : sélecteur d'app sans 'gip-plateforme'",
    home.status === 200 && select.length > 0 && !select.includes("gip-plateforme") && select.includes("demo-app"),
    `status=${home.status} selectLen=${select.length}`,
  );
  const cross = await get("/?app=gip-plateforme", viewerJar);
  const loc = cross.headers.get("location") ?? "";
  check(
    "viewer : ?app=gip-plateforme -> 302 retombe sur demo-app",
    cross.status === 302 && loc.includes("app=demo-app"),
    `status=${cross.status} loc=${loc}`,
  );
  const admin = await get("/admin/users?app=demo-app", viewerJar, true);
  const adminHtml = await admin.text();
  check(
    "viewer : /admin/users inaccessible (renvoyé vers la console)",
    !adminHtml.includes('data-testid="create-user-form"'),
    `status=${admin.status}`,
  );
}

// --- 5. désactivation par l'admin -> login refusé ----------------------------
{
  const page = await get("/admin/users", adminJar);
  const html = await page.text();
  const res = await postForm("/admin/users", adminJar, actionIdFor(html, `data-testid="toggle-${VIEWER_EMAIL}"`), {
    email: VIEWER_EMAIL,
  });
  const { rows } = await pool.query(`select active from console_user where email = $1`, [VIEWER_EMAIL]);
  check("admin désactive le viewer", res.status === 303 && rows[0]?.active === false, `post=${res.status} active=${rows[0]?.active}`);

  const { jar, res: retry } = await login(VIEWER_EMAIL, viewerPassword ?? "x");
  const loc = retry.headers.get("location") ?? "";
  check(
    "viewer désactivé : login refusé (erreur générique, pas de cookie)",
    loc.includes("/login?error=1") && !jar.has("mip_session"),
    `loc=${loc}`,
  );
}

// --- 6. audit_log rempli ------------------------------------------------------
{
  const { rows } = await pool.query(
    `select action, count(*)::int as n from audit_log
     where id > (select coalesce(max(id), 0) - 200 from audit_log)
     group by action`,
  );
  const seen = Object.fromEntries(rows.map((r) => [r.action, r.n]));
  const expected = ["seed_admin", "login", "user_create", "user_update"];
  const missing = expected.filter((a) => !seen[a]);
  const auditAfter = Number((await pool.query(`select count(*)::int as n from audit_log`)).rows[0].n);
  check(
    "audit_log : seed_admin + login + user_create + user_update tracés",
    missing.length === 0 && auditAfter > auditBefore,
    missing.length ? `manquants : ${missing.join(", ")}` : `+${auditAfter - auditBefore} lignes`,
  );
}

await pool.end();
const ko = checks.filter((c) => !c).length;
console.log(`\n${checks.length - ko}/${checks.length} preuves vertes`);
process.exit(ko ? 1 : 0);
