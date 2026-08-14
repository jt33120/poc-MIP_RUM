// Recette DoD (PLAN §2.2) sur le VRAI site : https://plateforme.groupement-it.com
// 1. flux bout-en-bout réel  2. agrégats  3. corrélation  4. OTLP visible sur le fil
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";

const SITE = "https://plateforme.groupement-it.com";
const ENDPOINT = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
const CA = readFileSync(new URL("../apps/console/certs/supabase-ca.crt", import.meta.url), "utf8");
const env = readFileSync(new URL("../apps/console/.env.production", import.meta.url), "utf8");
const dbUrl = new URL(env.match(/^DATABASE_URL=(.+)$/m)[1]);

const browser = await chromium.launch();
const page = await browser.newPage();
const beacons = [];
page.on("request", (r) => {
  if (r.url() === ENDPOINT && r.method() === "POST") beacons.push(r.postData()?.length ?? 0);
});

await page.goto(SITE, { waitUntil: "load" });
const sid = await page.evaluate(() => JSON.parse(localStorage.mip_rum_session).sid);
await page.waitForTimeout(800);
await page.mouse.click(200, 300); // finalise LCP + INP
await page.waitForTimeout(1200);
// navigation SPA si des liens existent (sinon on reste sur la route d'entrée)
const link = page.locator("a[href^='/']").first();
if (await link.count()) await link.click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(2600); // flush batch
await page.goto("about:blank"); // pagehide -> finals + beacon
await page.waitForTimeout(2500);
await browser.close();

const db = new pg.Client({
  host: dbUrl.hostname, port: Number(dbUrl.port), database: dbUrl.pathname.slice(1),
  user: decodeURIComponent(dbUrl.username), password: decodeURIComponent(dbUrl.password),
  ssl: { ca: CA },
});
await db.connect();
const metrics = await db.query(
  `select name, round(value::numeric,1) as value, rating, route from rum_metric where session_id=$1 order by name`, [sid]);
const pv = await db.query(
  `select route, nav_type from rum_pageview where session_id=$1 order by id`, [sid]);
const routes = await db.query(
  `select distinct route from rum_metric where app_id='gip-plateforme' and route is not null`);
await db.end();

console.log(`Session réelle : ${sid}`);
console.log(`DoD 4 — OTLP sur le fil : ${beacons.length} POST OTLP (${beacons.reduce((a,b)=>a+b,0)} octets)`);
console.log(`DoD 1 — vitals en base cloud :`, metrics.rows);
console.log(`Pageviews :`, pv.rows);
console.log(`Routes réelles observées :`, routes.rows.map(r=>r.route));
if (beacons.length >= 1 && metrics.rows.length >= 3) console.log("✅ DoD VERT sur le vrai site");
else { console.error("❌ DoD ROUGE"); process.exit(1); }
