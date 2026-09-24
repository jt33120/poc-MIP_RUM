// Validation S1 : ouvre la démo en headless, finalise le LCP (clic), flush,
// puis vérifie qu'un payload OTLP JSON contenant un span webvital.LCP est arrivé.
// Prérequis : `MIP_E2E_TAMPON=1 node services/collector/dev-server.mjs` (le
// tampon /__recent lu plus bas est éteint sans cet opt-in).
import { chromium } from "@playwright/test";

const INGEST = "http://localhost:4318";
const DEMO = "http://localhost:8080";

const browser = await chromium.launch();
const page = await browser.newPage();
const posted = [];
page.on("request", (r) => {
  if (r.url().includes("/v1/traces") && r.method() === "POST")
    posted.push(r.url());
});

await page.goto(DEMO, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(200, 400); // user interaction -> web-vitals finalizes LCP
await page.waitForTimeout(300);
await page.evaluate(() => window.MIPRum.flush());

let lcpSpan = null;
for (let i = 0; i < 30 && !lcpSpan; i++) {
  await page.waitForTimeout(500);
  const recent = await fetch(`${INGEST}/__recent`).then((r) => r.json());
  for (const payload of recent)
    for (const rs of payload.resourceSpans ?? [])
      for (const ss of rs.scopeSpans ?? [])
        for (const span of ss.spans ?? [])
          if (span.name === "webvital.LCP") lcpSpan = { span, resource: rs.resource };
}
await browser.close();

if (!lcpSpan) {
  console.error("❌ S1 ROUGE : aucun span webvital.LCP reçu par l'endpoint local");
  console.error("   POST observés côté navigateur:", posted);
  process.exit(1);
}
console.log("✅ S1 VERT : payload OTLP/HTTP JSON contenant un LCP reçu");
console.log("   POST /v1/traces émis par le navigateur:", posted.length);
console.log("   resource:", JSON.stringify(lcpSpan.resource.attributes));
console.log("   span:", JSON.stringify(lcpSpan.span, null, 2));
