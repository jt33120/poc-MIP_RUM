// Validation chaîne CLOUD : page locale (origine whitelistée) → SDK → CORS réel
// → edge function Supabase → Postgres cloud. Équivalent du test "vrai site",
// au domaine près (DoD 1 & 4, PLAN §2.2).
import { chromium } from "@playwright/test";
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";

const ENDPOINT = "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces";
const SDK = readFileSync(new URL("../packages/rum-sdk/dist/mip-rum.js", import.meta.url));
const CA = readFileSync(new URL("../apps/console/certs/supabase-ca.crt", import.meta.url), "utf8");
const env = readFileSync(new URL("../apps/console/.env.production", import.meta.url), "utf8");
const dbUrl = new URL(env.match(/^DATABASE_URL=(.+)$/m)[1]);

const PAGE = `<!doctype html><html><head><script src="/mip-rum.js"></script>
<script>MIPRum.init({endpoint:"${ENDPOINT}",appId:"gip-plateforme",clientId:"groupement-it",env:"prod",flushIntervalMs:2000});</script>
</head><body><h1>Validation cloud MIP RUM — page de test locale</h1></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/mip-rum.js") {
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end(SDK);
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((ok) => server.listen(8090, ok));

// 8090 n'est pas dans la whitelist CORS de l'edge function -> on doit utiliser 8080
// (si occupé par l'ancien serveur démo, on le réutilise pas : erreur explicite)
server.close();
await new Promise((ok, ko) => {
  server.listen(8080).once("listening", ok).once("error", ko);
}).catch(() => {
  console.error("Port 8080 occupé — stopper l'ancien serveur démo d'abord");
  process.exit(2);
});

const browser = await chromium.launch();
const page = await browser.newPage();
let beaconSeen = null;
page.on("request", (r) => {
  if (r.url() === ENDPOINT && r.method() === "POST") beaconSeen = r.url();
});
let corsError = null;
page.on("console", (m) => {
  if (m.type() === "error" && /CORS|blocked/i.test(m.text())) corsError = m.text();
});

await page.goto("http://localhost:8080/", { waitUntil: "load" });
const sid = await page.evaluate(() => JSON.parse(localStorage.mip_rum_session).sid);
await page.waitForTimeout(600);
await page.mouse.click(100, 100); // finalise le LCP
await page.waitForTimeout(2600); // flush batch (2 s)
await page.goto("about:blank"); // pagehide -> INP/CLS finals + beacon
await page.waitForTimeout(2500);
await browser.close();
server.close();

const db = new pg.Client({
  host: dbUrl.hostname,
  port: Number(dbUrl.port),
  database: dbUrl.pathname.slice(1),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  ssl: { ca: CA },
});
await db.connect();
const { rows } = await db.query(
  `select name, value, rating from rum_metric where session_id = $1 order by name`,
  [sid],
);
const sess = await db.query(
  `select app_id, device_type, geo_country from rum_session where session_id = $1`,
  [sid],
);
await db.end();

console.log(`Session test : ${sid}`);
console.log(`POST cloud vu côté navigateur : ${beaconSeen ? "oui" : "NON"}`);
if (corsError) console.log(`Erreur CORS : ${corsError}`);
console.log(`rum_session :`, sess.rows[0] ?? "(absente)");
console.log(`rum_metric  :`, rows);
if (beaconSeen && !corsError && rows.length >= 1 && sess.rows.length === 1) {
  console.log("✅ CLOUD VERT : navigateur réel → CORS → edge function → Postgres cloud");
} else {
  console.error("❌ CLOUD ROUGE");
  process.exit(1);
}
