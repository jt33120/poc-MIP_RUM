// Validation S3 : 5 vitals + erreurs provoquées + session stable en base.
// Scénario : load -> CLS auto -> clics (erreur, rejet, nav SPA) -> reload (même session)
// -> onglet caché (finalise INP/CLS, flush beacon) -> assertions SQL.
import { chromium } from "@playwright/test";
import pg from "pg";

const DEMO = "http://localhost:8080";
const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5433/mip_rum",
});

await pool.query("delete from rum_metric; delete from rum_error; delete from rum_pageview; delete from rum_session;");

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(DEMO, { waitUntil: "load" });
await page.waitForTimeout(1200); // laisse passer le layout shift (CLS)
await page.click("#btn-error");
await page.click("#btn-rejection");
await page.click("#btn-nav-list");
await page.waitForTimeout(200);
await page.click("#btn-nav-detail");
await page.waitForTimeout(400);

const sid1 = await page.evaluate(() => JSON.parse(localStorage.getItem("mip_rum_session")).sid);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(800);
const sid2 = await page.evaluate(() => JSON.parse(localStorage.getItem("mip_rum_session")).sid);

// onglet masqué -> web-vitals émet INP/CLS finals, le SDK flush en beacon
const page2 = await context.newPage();
await page2.goto("about:blank");
await page2.bringToFront();
await page.waitForTimeout(2500);

await browser.close();

const { rows: metrics } = await pool.query(
  "select name, count(*)::int as n, min(rating) as rating from rum_metric group by name order by name",
);
const { rows: errors } = await pool.query(
  "select kind, error_type, message from rum_error order by id",
);
const { rows: sessions } = await pool.query(
  "select session_id, page_count from rum_session",
);
const { rows: pageviews } = await pool.query(
  "select route, nav_type from rum_pageview order by id",
);
await pool.end();

const names = new Set(metrics.map((m) => m.name));
const checks = [
  ["5 vitals captés (LCP/INP/CLS/FCP/TTFB)", ["LCP", "INP", "CLS", "FCP", "TTFB"].every((n) => names.has(n)), [...names].join(",")],
  ["erreur JS 'error' en base", errors.some((e) => e.kind === "error"), JSON.stringify(errors[0] ?? null)],
  ["erreur 'unhandledrejection' en base", errors.some((e) => e.kind === "unhandledrejection"), ""],
  ["session stable après reload", sid1 === sid2, `${sid1} vs ${sid2}`],
  ["1 seule session en base", sessions.length === 1, `count=${sessions.length}`],
  ["routes normalisées (/partners/:id)", pageviews.some((p) => p.route === "/partners/:id"), JSON.stringify(pageviews)],
  ["pageviews SPA captées", pageviews.some((p) => p.nav_type === "spa"), ""],
];

let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? "  | " + detail : ""}`);
  if (!pass) ok = false;
}
console.log("\nMétriques en base:", JSON.stringify(metrics));
console.log("Pageviews:", JSON.stringify(pageviews));
console.log("Sessions:", JSON.stringify(sessions));
process.exit(ok ? 0 : 1);
