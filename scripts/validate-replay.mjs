// Validation B2 (ROADMAP_V03) : bundles mesurés (cœur ≤ 35 KB gzip, replay
// séparé), démo headless replay:true -> interactions -> flush (timer 10 s) ->
// chunks en base (n>0, events_count>0), puis reconstruction (gunzip+concat)
// = JSON rrweb valide (events[0].type présent, full snapshot inclus).
// Modèle : validate-sdk-v02.mjs (serveurs réutilisés ou lancés + chromium).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = "http://localhost:4318";
const REPLAY = "http://localhost:4319";
const DEMO = "http://localhost:8080";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/mip_rum";

const failures = [];
const ok = (label, extra = "") => console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`);
const ko = (label, extra = "") => {
  failures.push(label);
  console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
};

// ---- serveurs : réutilise ceux qui tournent, sinon les lance ----
const children = [];
async function isUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
async function ensureServer(url, cmd, args) {
  if (await isUp(url)) return;
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 20; i++) {
    if (await isUp(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`serveur injoignable: ${url}`);
}
process.on("exit", () => children.forEach((c) => c.kill()));

// ---- 0. bundles : cœur ≤ 35 KB gzip (inchangé), replay séparé mesuré ----
console.log("— Bundles —");
const gzKb = (file) => gzipSync(readFileSync(join(ROOT, file))).length / 1024;
const coreKb = gzKb("packages/rum-sdk/dist/mip-rum.js");
if (coreKb <= 35) ok("bundle CŒUR ≤ 35 KB gzip (rrweb exclu)", `${coreKb.toFixed(1)} KB`);
else ko("bundle CŒUR ≤ 35 KB gzip", `${coreKb.toFixed(1)} KB`);
let replayKb = 0;
try {
  replayKb = gzKb("packages/rum-sdk/dist/mip-rum-replay.js");
  ok("bundle replay séparé présent", `${replayKb.toFixed(1)} KB gzip`);
} catch {
  ko("bundle replay séparé absent (pnpm --filter @mip/rum-sdk build)");
}

await ensureServer(`${INGEST}/__recent`, "node", ["services/collector/dev-server.mjs"]);
await ensureServer(`${REPLAY}/__health`, "node", ["services/collector/replay-dev-server.mjs"]);
await ensureServer(DEMO, "node", ["demo/serve.mjs"]);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const browser = await chromium.launch();

// ---- 1. démo headless : replay:true -> interactions -> flush (timer 10 s) ----
console.log("— Enregistrement (démo headless) —");
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(DEMO, { waitUntil: "load" });
await page.waitForTimeout(600);

// interactions : saisie masquée, navigation SPA, clics (DOM muté -> events rrweb)
await page.fill("#input-masked", "secret-ne-doit-pas-fuiter");
await page.click("#btn-nav-list");
await page.waitForTimeout(300);
await page.click("#btn-nav-detail");
await page.click("#btn-track");
await page.waitForTimeout(300);

const sid = await page.evaluate(() => JSON.parse(localStorage.getItem("mip_rum_session")).sid);
const replayLoaded = await page.evaluate(() => typeof window.MIPRumReplay?.record === "function");
if (replayLoaded) ok("bundle replay lazy-loadé (global MIPRumReplay.record)");
else ko("bundle replay non chargé par le cœur");

// flush : timer 10 s du SDK -> on attend, puis on poll la base (max ~25 s)
let chunkRows = [];
for (let i = 0; i < 25 && !chunkRows.length; i++) {
  await page.waitForTimeout(1000);
  const { rows } = await pool.query(
    "select seq, events_count, body from replay_chunk where session_id = $1 order by seq",
    [sid],
  );
  chunkRows = rows;
}

// ---- 2. chunks en base : n > 0, events_count > 0, body gzip ----
console.log("— Chunks en base —");
if (chunkRows.length > 0) ok("replay_chunk n > 0", `${chunkRows.length} chunk(s), session ${sid.slice(0, 8)}…`);
else ko("aucun chunk replay_chunk pour la session", sid);

const totalEvents = chunkRows.reduce((n, r) => n + (r.events_count ?? 0), 0);
if (totalEvents > 0) ok("events_count > 0", `${totalEvents} events au total`);
else ko("events_count nul");

const allGzip = chunkRows.every((r) => r.body[0] === 0x1f && r.body[1] === 0x8b);
if (chunkRows.length && allGzip) {
  const bytes = chunkRows.reduce((n, r) => n + r.body.length, 0);
  ok("body stocké COMPRESSÉ (magic gzip 1f 8b)", `${(bytes / 1024).toFixed(1)} KB gzip cumulés`);
} else if (chunkRows.length) ko("body non gzip en base");

// ---- 3. reconstruction (logique de la route console) : gunzip + concat ----
console.log("— Reconstruction (gunzip + concat) —");
let events = [];
try {
  for (const r of chunkRows) {
    const parsed = JSON.parse(gunzipSync(r.body).toString("utf8"));
    if (Array.isArray(parsed)) events.push(...parsed);
  }
  if (events.length > 0 && typeof events[0].type === "number")
    ok("JSON rrweb valide, events[0].type présent", `type=${events[0].type}, ${events.length} events`);
  else ko("events[0].type absent du JSON reconstruit");
  // type 2 = FullSnapshot, type 3 = IncrementalSnapshot (interactions)
  if (events.some((e) => e.type === 2)) ok("full snapshot présent (type 2)");
  else ko("pas de full snapshot dans le replay");
  if (events.some((e) => e.type === 3)) ok("événements incrémentaux présents (type 3)", "interactions capturées");
  else ko("aucun événement incrémental (type 3)");
  // masquage : la saisie en clair ne doit jamais apparaître dans le flux
  if (!JSON.stringify(events).includes("secret-ne-doit-pas-fuiter"))
    ok("maskAllInputs : la saisie n'apparaît pas en clair");
  else ko("FUITE : saisie input visible dans le replay");
} catch (err) {
  ko("reconstruction gunzip+concat échouée", err.message);
}

await browser.close();
await pool.end();

console.log(
  failures.length
    ? `\n❌ B2 replay : ${failures.length} échec(s) — ${failures.join(" | ")}`
    : `\n✅ B2 replay : recette verte (cœur ${coreKb.toFixed(1)} KB gzip, replay ${replayKb.toFixed(1)} KB gzip, ${chunkRows.length} chunk(s), ${totalEvents} events)`,
);
process.exit(failures.length ? 1 : 0);
