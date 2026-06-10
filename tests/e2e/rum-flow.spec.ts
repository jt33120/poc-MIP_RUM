// E2E : démo → erreur → flush → base → console (PLAN §12).
// Le test suit SA session (pas de purge de la base) : assertions par session_id.
import { expect, test } from "@playwright/test";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

test.afterAll(() => pool.end());

async function pollRows(sql: string, params: unknown[], minCount: number, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(sql, params);
    if (rows.length >= minCount) return rows;
    await new Promise((r) => setTimeout(r, 500));
  }
  return (await pool.query(sql, params)).rows;
}

test("flux RUM bout-en-bout : vitals + erreur arrivent en base puis en console", async ({ page }) => {
  await page.goto("http://localhost:8080/", { waitUntil: "load" });
  await page.waitForTimeout(1200); // layout shift CLS
  await page.click("#btn-error");
  await page.click("#btn-nav-list");
  await page.waitForTimeout(300);

  const sid = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mip_rum_session")!).sid,
  );

  // vraie navigation -> pagehide -> reports finals + beacon
  await page.goto("about:blank");
  await page.waitForTimeout(800);

  const metrics = await pollRows(
    "select distinct name from rum_metric where session_id = $1",
    [sid],
    3,
  );
  const names = metrics.map((m) => m.name);
  expect(names).toContain("LCP");
  expect(names).toContain("TTFB");

  const errors = await pollRows(
    "select kind, message from rum_error where session_id = $1",
    [sid],
    1,
  );
  expect(errors[0].kind).toBe("error");
  expect(errors[0].message).toContain("Erreur de démo MIP RUM");

  const sessions = await pollRows(
    "select session_id, page_count from rum_session where session_id = $1",
    [sid],
    1,
  );
  expect(sessions).toHaveLength(1);
  expect(Number(sessions[0].page_count)).toBeGreaterThanOrEqual(2);

  // la console restitue ces données réelles
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("p75-LCP")).not.toHaveText("—");
  await page.goto("http://localhost:3000/errors", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText("Erreur de démo MIP RUM");
});

test("corrélation : robot vs réel côte à côte avec écart", async ({ page }) => {
  await page.goto("http://localhost:3000/correlation", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText("Robot — synthétique DEM");
  await expect(page.locator("body")).toContainText("Réel — utilisateurs (RUM)");
  expect(await page.getByTestId("gap").count()).toBeGreaterThanOrEqual(1);
});
