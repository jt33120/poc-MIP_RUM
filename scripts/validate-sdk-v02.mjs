// Validation A1 (ROADMAP_V02) : démo headless → spans resource / longtask /
// breadcrumb / track.* visibles dans le payload OTLP reçu (/__recent du
// dev-server), consent mode = 0 requête réseau sans consent(true),
// bundle ≤ 35 KB gzip. Modèle : validate-s1.mjs (serveurs + chromium + /__recent).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INGEST = "http://localhost:4318";
const DEMO = "http://localhost:8080";

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

// ---- helpers OTLP JSON ----
const attrVal = (a) =>
  a?.stringValue ??
  (a?.intValue != null ? Number(a.intValue) : undefined) ??
  a?.doubleValue ??
  a?.boolValue;
const attrsOf = (list = []) => Object.fromEntries(list.map((kv) => [kv.key, attrVal(kv.value)]));

async function recentSpans() {
  const recent = await fetch(`${INGEST}/__recent`).then((r) => r.json());
  const spans = [];
  for (const payload of recent)
    for (const rs of payload.resourceSpans ?? []) {
      const resource = attrsOf(rs.resource?.attributes);
      for (const ss of rs.scopeSpans ?? [])
        for (const span of ss.spans ?? [])
          spans.push({ name: span.name, attrs: attrsOf(span.attributes), resource });
    }
  return spans;
}

// ---- 0. bundle size ----
console.log("— Bundle —");
const bundle = readFileSync(join(ROOT, "packages/rum-sdk/dist/mip-rum.js"));
const gzKb = gzipSync(bundle).length / 1024;
if (gzKb <= 35) ok("bundle ≤ 35 KB gzip", `${gzKb.toFixed(1)} KB`);
else ko("bundle ≤ 35 KB gzip", `${gzKb.toFixed(1)} KB`);

await ensureServer(`${INGEST}/__recent`, "node", ["apps/ingest/dev-server.mjs"]);
await ensureServer(DEMO, "node", ["demo/serve.mjs"]);

const browser = await chromium.launch();

// ---- 1. collecte v0.2 : resource / longtask / breadcrumb / track.* ----
console.log("— Collecte v0.2 (démo headless) —");
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(DEMO, { waitUntil: "load" });
  await page.waitForTimeout(800);

  await page.click("#btn-slow-res"); // fetch /slow (sleep 800 ms) -> span resource
  await page.waitForTimeout(1200);
  await page.click("#btn-longtask"); // boucle bloquante ~300 ms -> span longtask
  await page.click("#btn-track"); // track('partner_search', {results: 12})
  await page.click("#btn-nav-list"); // navigation SPA -> breadcrumb nav
  await page.click("#btn-error"); // erreur JS -> breadcrumb error
  await page.waitForTimeout(400);
  await page.evaluate(() => window.MIPRum.flush());

  // session de CE contexte (le ring /__recent peut contenir d'autres runs)
  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")).sid,
  );

  let mine = [];
  const wanted = (spans) => ({
    resource: spans.find((s) => s.name === "resource" && String(s.attrs["resource.url"]).includes("/slow")),
    longtask: spans.find((s) => s.name === "longtask"),
    breadcrumbs: spans.filter((s) => s.name === "breadcrumb"),
    track: spans.find((s) => s.name === "track.partner_search"),
  });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    mine = (await recentSpans()).filter((s) => s.attrs["mip.session_id"] === sid);
    const w = wanted(mine);
    if (w.resource && w.longtask && w.track && w.breadcrumbs.length >= 3) break;
    if (i % 6 === 5) await page.evaluate(() => window.MIPRum.flush());
  }
  const w = wanted(mine);

  if (w.resource) {
    const a = w.resource.attrs;
    const shape =
      typeof a["resource.type"] === "string" &&
      typeof a["resource.duration_ms"] === "number" &&
      a["resource.duration_ms"] >= 300 &&
      typeof a["resource.transfer_size"] === "number" &&
      typeof a["resource.render_blocking"] === "boolean";
    if (shape) ok("span resource (/slow)", `type=${a["resource.type"]} duration=${a["resource.duration_ms"]}ms transfer=${a["resource.transfer_size"]} blocking=${a["resource.render_blocking"]}`);
    else ko("span resource : attributs incomplets", JSON.stringify(a));
  } else ko("span resource (/slow) absent");

  if (w.longtask && w.longtask.attrs["longtask.duration_ms"] >= 250)
    ok("span longtask", `${w.longtask.attrs["longtask.duration_ms"]} ms`);
  else ko("span longtask absent ou < 250 ms", JSON.stringify(w.longtask?.attrs));

  const types = new Set(w.breadcrumbs.map((s) => s.attrs["breadcrumb.type"]));
  const seqs = w.breadcrumbs.map((s) => s.attrs["breadcrumb.seq"]).sort((x, y) => x - y);
  const seqIncreasing = seqs.every((v, i) => i === 0 || v > seqs[i - 1]);
  if (["click", "nav", "error", "custom"].every((t) => types.has(t)) && seqIncreasing)
    ok("spans breadcrumb (click+nav+error+custom)", `${w.breadcrumbs.length} crumbs, seq strictement croissants`);
  else ko("breadcrumbs incomplets", `types=${[...types]} seqOk=${seqIncreasing} n=${w.breadcrumbs.length}`);

  if (w.track && JSON.parse(String(w.track.attrs["mip.props"] ?? "{}")).results === 12)
    ok("span track.partner_search", `mip.props=${w.track.attrs["mip.props"]}`);
  else ko("span track.partner_search absent ou mip.props invalide", JSON.stringify(w.track?.attrs));

  const anyMine = mine[0];
  if (anyMine?.resource["mip.api_key"] === "demo-key-local")
    ok("attribut resource mip.api_key", "demo-key-local");
  else ko("attribut resource mip.api_key absent", JSON.stringify(anyMine?.resource));

  await ctx.close();
}

// ---- 2. consent mode : requireConsent=1 sans consent() => 0 requête ----
console.log("— Consent mode —");
{
  const ctx = await browser.newContext(); // storage vierge
  const page = await ctx.newPage();
  let exports = 0;
  page.on("request", (r) => {
    if (r.url().includes("/v1/traces")) exports++;
  });
  await page.goto(`${DEMO}/?requireConsent=1`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.click("#btn-slow-res");
  await page.waitForTimeout(1000);
  await page.click("#btn-longtask");
  await page.click("#btn-track");
  await page.click("#btn-error");
  await page.waitForTimeout(3000); // > flushIntervalMs (2000)
  await page.evaluate(() => window.MIPRum.flush());
  await page.waitForTimeout(800);
  if (exports === 0) ok("0 requête /v1/traces sans consent()");
  else ko("requêtes émises sans consentement", `${exports} POST /v1/traces`);

  // contre-épreuve : consent(true) rejoue le buffer mémoire
  await page.evaluate(() => window.MIPRum.consent(true));
  await page.evaluate(() => window.MIPRum.flush());
  for (let i = 0; i < 10 && exports === 0; i++) await page.waitForTimeout(500);
  if (exports > 0) ok("consent(true) débloque l'export", `${exports} POST après consentement`);
  else ko("consent(true) n'a rien émis");

  await ctx.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n❌ A1 ROUGE : ${failures.length} échec(s) — ${failures.join(" | ")}`);
  process.exit(1);
}
console.log(`\n✅ A1 VERT : resource + longtask + breadcrumb + track.* dans le payload OTLP, consent=0 requête, bundle ${gzKb.toFixed(1)} KB gzip`);
process.exit(0);
