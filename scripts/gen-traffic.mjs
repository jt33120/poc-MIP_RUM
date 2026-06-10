// Génère du trafic réel sur la démo : N sessions headless (contexts isolés),
// parcours variés, quelques erreurs. Sert à peupler la console (S4/S5).
import { chromium } from "@playwright/test";

const DEMO = "http://localhost:8080";
const N = Number(process.argv[2] ?? 3);

const browser = await chromium.launch();
for (let i = 0; i < N; i++) {
  const context = await browser.newContext(); // localStorage isolé -> nouvelle session
  const page = await context.newPage();
  await page.goto(DEMO, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.click("#btn-nav-list");
  await page.waitForTimeout(200);
  if (i % 2 === 0) await page.click("#btn-error");
  await page.click("#btn-nav-detail");
  await page.waitForTimeout(300);
  // vraie navigation -> pagehide -> web-vitals émet LCP/INP/CLS finals + flush beacon
  // (bringToFront ne masque PAS l'onglet en headless, constaté au build)
  await page.goto("about:blank");
  await page.waitForTimeout(1200);
  await context.close();
  console.log(`session ${i + 1}/${N} ok`);
}
await browser.close();
