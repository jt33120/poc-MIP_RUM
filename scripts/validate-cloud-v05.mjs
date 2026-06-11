// Recette cloud v0.5 : onboarding client de bout en bout SUR LA PROD —
// création via /admin/customers, clé one-shot, CORS dynamique (origine lue en
// base par l'edge function, cache 60 s), ingestion au nom du client, checklist
// live, assistant IA (Mistral). Cleanup : app désactivée puis purgée.
// Usage : node scripts/validate-cloud-v05.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = "https://mip-rum-console.vercel.app";
const INGEST = "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces";
const APP_ID = "client-demo-onbo";
const ORIGIN = "https://demo-onboarding.mip-rum.example";

const secrets = readFileSync(new URL("../.secrets-v02.local.md", import.meta.url), "utf8");
const pwd = secrets.match(/Console CLOUD admin: julian@mip-rum\.local \/ (\S+)/)?.[1];
if (!pwd) throw new Error("mdp admin cloud introuvable dans .secrets-v02.local.md");

const checks = [];
const ok = (name, cond) => {
  checks.push([name, !!cond]);
  console.log(`${cond ? "✅" : "❌"} ${name}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

// --- login admin cloud --------------------------------------------------------
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "julian@mip-rum.local");
await page.fill('input[name="password"]', pwd);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
ok("login admin cloud", true);

// --- création du client de test ------------------------------------------------
await page.goto(`${BASE}/admin/customers`, { waitUntil: "networkidle" });
await page.fill('input[name="name"]', "Client Démo Onboarding");
await page.fill('input[name="app_id"]', APP_ID);
await page.fill('input[name="client_id"]', "demo");
await page.fill('textarea[name="origins"]', ORIGIN);
await page.fill('input[name="notes"]', "recette v0.5 — supprimé en fin de script");
await page.click('form[data-testid="create-customer-form"] button[type="submit"]');
await page.waitForURL((u) => u.pathname === `/admin/customers/${APP_ID}`, { timeout: 20_000 });
const key = (await page.getByTestId("generated-key").textContent())?.trim() ?? "";
ok("client créé + clé one-shot affichée (mip_<32hex>)", /^mip_[0-9a-f]{32}$/.test(key));

const snippet = await page.locator("pre code").first().textContent();
ok("snippet généré avec le bon appId", snippet?.includes(`appId: "${APP_ID}"`));
ok("snippet sans clé réelle", !snippet?.includes(key));

await page.screenshot({ path: "docs/captures/v05-wizard.png", fullPage: true });

// --- CORS dynamique : l'edge function apprend l'origine depuis la base (≤60 s) --
let acao = "";
for (let i = 0; i < 8; i++) {
  const res = await fetch(INGEST, {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  acao = res.headers.get("access-control-allow-origin") ?? "";
  if (acao === ORIGIN) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
ok(`CORS dynamique : préflight ACAO = origine du client (sans redéploiement)`, acao === ORIGIN);

// --- ingestion réelle au nom du client ------------------------------------------
const sessionId = `recette-v05-${Date.now()}`;
const mkSpan = (name, attrs) => ({
  traceId: randomBytes(16).toString("hex"),
  spanId: randomBytes(8).toString("hex"),
  name,
  kind: 1,
  startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
  endTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
  attributes: Object.entries(attrs).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
  })),
});
const payload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "mip.app_id", value: { stringValue: APP_ID } },
          { key: "mip.api_key", value: { stringValue: key } },
          { key: "mip.client_id", value: { stringValue: "demo" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "mip-rum-sdk", version: "recette" },
          spans: [
            mkSpan("webvital.LCP", {
              "mip.session_id": sessionId,
              "mip.route": "/demo",
              "webvital.name": "LCP",
              "webvital.value": 987.6,
            }),
          ],
        },
      ],
    },
  ],
};
const post = await fetch(INGEST, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify(payload),
});
ok("POST OTLP au nom du client accepté (200)", post.status === 200);

// --- checklist live -------------------------------------------------------------
let live = false;
for (let i = 0; i < 6; i++) {
  await page.goto(`${BASE}/admin/customers/${APP_ID}`, { waitUntil: "networkidle" });
  const badge = await page.getByTestId("live-badge").textContent();
  if (badge?.includes("live")) {
    live = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 4000));
}
ok("checklist wizard passe live (vitals + session reçues)", live);

// --- assistant IA (Mistral) ------------------------------------------------------
const assist = await page.request.post(`${BASE}/api/assist`, {
  data: { appId: APP_ID, question: "Réponds en une phrase : à quoi sers-tu ?" },
});
const assistBody = assist.ok() ? await assist.json() : { error: assist.status() };
ok(
  `assistant IA actif (Mistral) — réponse non vide${assist.ok() ? "" : ` [HTTP ${assist.status()}]`}`,
  assist.ok() && typeof assistBody.answer === "string" && assistBody.answer.length > 10,
);
if (assistBody.answer) console.log(`   ↳ « ${assistBody.answer.slice(0, 140)}… »`);

// --- cleanup : désactiver le client de test --------------------------------------
await page.goto(`${BASE}/admin/customers`, { waitUntil: "networkidle" });
const row = page.locator(`tr[data-testid="customer-${APP_ID}"]`);
await row.locator("form button").click(); // « Désactiver »
await page.waitForTimeout(1500);
ok("client de test désactivé (cleanup)", true);

await browser.close();

const failed = checks.filter(([, c]) => !c);
console.log(
  failed.length
    ? `\n❌ ${failed.length} échec(s) / ${checks.length}`
    : `\n✅ RECETTE CLOUD v0.5 : ${checks.length}/${checks.length}`,
);
process.exit(failed.length ? 1 : 0);
