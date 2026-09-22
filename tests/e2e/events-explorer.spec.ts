import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
// Compte dédié à ce fichier (helpers/compte-dedie.ts), jamais le compte admin local.
const ADMIN_EMAIL = "e2e-events-explorer@mip-rum.local";
let adminPassword = "";

test.beforeAll(async () => {
  adminPassword = await compteDedie(pool, ADMIN_EMAIL);
  await pool.query(`insert into app_registry (app_id,name,active) values ('demo-app','Demo',true) on conflict do nothing`);
  await pool.query(`insert into rum_session (session_id,app_id,device_type,sample_rate,error_sample_rate)
                    values ('p4-e2e-session','demo-app','mobile',0.5,1)
                    on conflict (session_id) do update set last_seen_at=now(),device_type='mobile',sample_rate=0.5`);
  await pool.query(`insert into rum_session (session_id,app_id,device_type,sample_rate,error_sample_rate)
                    values ('p4-e2e-desktop','demo-app','desktop',1,1)
                    on conflict (session_id) do update set last_seen_at=now(),device_type='desktop',sample_rate=1`);
  await pool.query(`insert into rum_event (span_id,session_id,app_id,route,name,props,context,ts)
                    values ('000000000000e401','p4-e2e-session','demo-app','/checkout-a','checkout',
                            '{"plan":"pro","amount":42}', '{"campaign":"fall"}', now()),
                           ('000000000000e402','p4-e2e-session','demo-app','/checkout-b','checkout',
                            '{"plan":"pro","amount":12}', '{"campaign":"fall"}', now()),
                           ('000000000000e403','p4-e2e-desktop','demo-app','/desktop-excluded','checkout',
                            '{"plan":"pro"}', '{"campaign":"fall"}', now()),
                           ('000000000000e404','p4-e2e-session','demo-app','/old-excluded','checkout',
                            '{"plan":"pro"}', '{"campaign":"fall"}', now()-interval '2 hours')
                    on conflict (span_id) do nothing`);
  await pool.query(`insert into rum_event_index (app_id,session_id,ts,route,kind,source_name,source_span_id)
                    values ('demo-app','p4-e2e-session',now(),'/checkout-a','event','track','000000000000e401'),
                           ('demo-app','p4-e2e-session',now(),'/checkout-b','event','track','000000000000e402'),
                           ('demo-app','p4-e2e-desktop',now(),'/desktop-excluded','event','track','000000000000e403'),
                           ('demo-app','p4-e2e-session',now()-interval '2 hours','/old-excluded','event','track','000000000000e404')
                    on conflict (app_id,kind,source_span_id) do nothing`);
});

test.afterAll(async () => {
  await pool.query("delete from rum_event_index where source_span_id in ('000000000000e401','000000000000e402','000000000000e403','000000000000e404')");
  await pool.query("delete from rum_event where span_id in ('000000000000e401','000000000000e402','000000000000e403','000000000000e404')");
  await pool.query("delete from rum_session where session_id in ('p4-e2e-session','p4-e2e-desktop')");
  await pool.end();
});

async function login(page: Page) {
  await page.goto(`${consoleUrl}/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
  await page.context().addCookies([{ name: "mip-project", value: "demo-app", url: consoleUrl }]);
}

test("Explorer : filtre typé, sampling, drill-down clavier et mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`${consoleUrl}/events?app=demo-app&period=1h&device=mobile&name=checkout&attr_source=props&attr_key=plan&attr_type=string&attr_value=pro&limit=1`);
  await expect(page.getByRole("heading", { name: "Événements" })).toBeVisible();
  await expect(page.getByText(/Aucune extrapolation/)).toBeVisible();
  await expect(page.getByText("checkout", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("events-total")).toHaveText("2");
  await expect(page.getByText("props.plan", { exact: true })).toBeVisible();
  await expect(page.getByText("/checkout-b", { exact: true })).toBeVisible();
  await expect(page.getByText("/desktop-excluded", { exact: true })).toHaveCount(0);
  await expect(page.getByText("/old-excluded", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /p4-e2e/ })).toBeVisible();

  const name = page.getByLabel("Nom d’événement");
  await name.focus();
  await expect(name).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Source attribut")).toBeFocused();
  await expect(page.getByText("Alternative textuelle de la série")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const next = await page.getByRole("link", { name: "Événements suivants" }).getAttribute("href");
  expect(next).toMatch(/cursor=/);
  await page.goto(new URL(next!, consoleUrl).toString());
  await expect(page).toHaveURL(/cursor=/, { timeout: 15_000 });
  await expect(page.getByText("/checkout-a", { exact: true })).toBeVisible();
  await expect(page.getByText("/checkout-b", { exact: true })).toHaveCount(0);
});
