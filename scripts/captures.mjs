// Captures des vues console pour le rapport client (PLAN §15, annexes).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

mkdirSync("docs/captures", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const views = [
  ["http://localhost:3000/", "01-overview"],
  ["http://localhost:3000/pages", "02-pages-lentes"],
  ["http://localhost:3000/errors", "03-erreurs-js"],
  ["http://localhost:3000/sessions", "04-sessions"],
  ["http://localhost:3000/correlation", "05-correlation"],
  ["http://localhost:8080/", "06-demo"],
];
for (const [url, name] of views) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `docs/captures/${name}.png`, fullPage: true });
  console.log(`📸 ${name}.png`);
}
await browser.close();
