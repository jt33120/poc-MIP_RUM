// Validation S4 : la console affiche les vraies données, p75 et ratings corrects.
// Le p75 est recalculé indépendamment en JS (interpolation linéaire, comme
// percentile_cont) depuis les valeurs brutes, puis comparé à l'affichage.
import { chromium } from "@playwright/test";
import pg from "pg";
// Les seuils CWV ne sont PAS recopiés ici : otlp.mjs se désigne source de vérité du
// rating, et ce script en dérive. Il en portait sa propre copie, restée à l'ancienne
// borne LCP [2000, 2500] après la correction E0 — donc il validait la console contre
// un barème que le produit n'utilisait plus (cf. invariant AD-12 du spine).
import { rating2026 } from "../packages/backend/shared/otlp.mjs";

const CONSOLE = "http://localhost:3000";
const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5433/mip_rum",
});

function p75(values) {
  const v = [...values].sort((a, b) => a - b);
  const idx = 0.75 * (v.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}
function fmtVital(name, value) {
  if (value == null) return "—";
  if (name === "CLS") return value.toFixed(3);
  if (value >= 1000) return (value / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(value) + " ms";
}
// Libellés tels que la console les affiche ; le verdict lui-même vient de rating2026.
const RATING_LABEL = { good: "Bon", "needs-improvement": "À améliorer", poor: "Mauvais" };
const rate = (name, v) => RATING_LABEL[rating2026(name, v)];

const { rows: raw } = await pool.query(
  "select name, value from rum_metric where ts > now() - interval '24 hours'",
);
const { rows: [{ sessions }] } = await pool.query(
  "select count(*)::int as sessions from rum_session where last_seen_at > now() - interval '24 hours'",
);
await pool.end();

const byName = {};
for (const r of raw) (byName[r.name] ??= []).push(Number(r.value));

const browser = await chromium.launch();
const page = await browser.newPage();
const checks = [];

await page.goto(CONSOLE, { waitUntil: "networkidle" });
for (const name of ["LCP", "INP", "CLS", "FCP", "TTFB"]) {
  const expected = fmtVital(name, p75(byName[name]));
  const shown = (await page.getByTestId(`p75-${name}`).textContent())?.trim();
  checks.push([`Overview ${name} p75 = ${expected}`, shown === expected, `affiché: ${shown}`]);
}
const shownSessions = (await page.getByTestId("stat-sessions").textContent())?.trim();
checks.push([`Overview sessions = ${sessions}`, shownSessions === String(sessions), `affiché: ${shownSessions}`]);
const lcpCard = await page.locator("div", { has: page.getByTestId("p75-LCP") }).last().textContent();
checks.push([`Rating LCP affiché = ${rate("LCP", p75(byName.LCP))}`, lcpCard.includes(rate("LCP", p75(byName.LCP))), ""]);

await page.goto(`${CONSOLE}/pages`, { waitUntil: "networkidle" });
const pagesBody = await page.textContent("body");
checks.push(["Pages lentes liste /partners/:id", pagesBody.includes("/partners/:id"), ""]);

await page.goto(`${CONSOLE}/errors`, { waitUntil: "networkidle" });
const errBody = await page.textContent("body");
checks.push(["Erreurs JS liste l'erreur de démo", errBody.includes("Erreur de démo MIP RUM"), ""]);
checks.push(["Erreurs JS liste le rejet de promesse", errBody.includes("Rejet de promesse de démo"), ""]);

await page.goto(`${CONSOLE}/sessions`, { waitUntil: "networkidle" });
const sessBody = await page.textContent("body");
checks.push(["Sessions affiche des parcours (breadcrumbs)", sessBody.includes("/partners"), ""]);

await browser.close();

let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? "  | " + detail : ""}`);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
