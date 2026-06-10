// Validation S5 : pour ≥1 route, la page /correlation montre robot vs réel
// côte à côte avec l'écart surligné ; la vue SQL v_correlation corrèle.
import { chromium } from "@playwright/test";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const { rows: corr } = await pool.query(
  `select route from v_correlation
   where rum_lcp_p75 is not null and syn_latency_avg is not null
   group by route`,
);
await pool.end();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:3000/correlation", { waitUntil: "networkidle" });
const body = await page.textContent("body");
const gaps = await page.getByTestId("gap").count();
const cards = await page.locator("[data-testid^='corr-']").count();
await browser.close();

const checks = [
  ["vue SQL v_correlation corrèle ≥1 route", corr.length >= 1, `routes corrélées: ${corr.map((r) => r.route).join(", ")}`],
  ["page /correlation : panneaux robot ET réel", body.includes("Robot — synthétique DEM") && body.includes("Réel — utilisateurs (RUM)"), ""],
  ["écart surligné sur ≥1 route", gaps >= 1, `badges écart: ${gaps}`],
  ["cartes par route affichées", cards >= 2, `cartes: ${cards}`],
  ["données mippoc réelles visibles (tvmonaco)", body.includes("tvmonaco"), ""],
];

let ok = true;
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? "  | " + detail : ""}`);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
