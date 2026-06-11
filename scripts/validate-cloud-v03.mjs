// Recette cloud v0.3 : login RBAC sur la console déployée + pages clés.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = "https://mip-rum-console.vercel.app";
const secrets = readFileSync(new URL("../.secrets-v02.local.md", import.meta.url), "utf8");
const pwd = secrets.match(/Console CLOUD admin: julian@mip-rum\.local \/ (\S+)/)?.[1];
if (!pwd) throw new Error("mdp admin cloud introuvable dans .secrets-v02.local.md");

const browser = await chromium.launch();
const page = await browser.newPage();
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(`${cond ? "✅" : "❌"} ${name}`); };

await page.goto(`${BASE}/`);
ok("/ redirige vers /login", page.url().includes("/login"));

await page.fill('input[name="email"]', "julian@mip-rum.local");
await page.fill('input[name="password"]', pwd);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20_000 });
ok("login admin cloud OK", true);

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok("Overview + health score", (await page.getByTestId("health-score").count()) === 1);
await page.goto(`${BASE}/alerts`, { waitUntil: "networkidle" });
ok("/alerts rend", (await page.content()).includes("règle"));
await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
ok("/admin/users (admin)", (await page.content()).includes("julian@mip-rum.local"));
await page.goto(`${BASE}/correlation`, { waitUntil: "networkidle" });
ok("/correlation rend", (await page.content()).includes("Robot"));

// dogfooding : la console s'auto-instrumente (session mip-rum-console attendue en base ensuite)
await page.waitForTimeout(2500);
await browser.close();

const failed = checks.filter(([, c]) => !c);
if (failed.length) { console.error(`\n❌ ${failed.length} échec(s)`); process.exit(1); }
console.log(`\n✅ CLOUD v0.3 : ${checks.length}/${checks.length}`);
