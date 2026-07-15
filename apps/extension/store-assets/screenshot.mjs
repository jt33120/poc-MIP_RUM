// Génère les visuels du listing Chrome Web Store à partir d'un rendu Chromium.
// - screenshot-1280x800.png : capture principale (obligatoire, ≥1).
// - promo-440x280.png       : petite tuile promotionnelle (recommandée).
// Rendu d'un HTML autoportant (aucune dépendance chrome/extension) : reproduit
// fidèlement l'allure du popup + un message produit. Déterministe.
//
// Lancement : PW_CHROME=/chemin/chrome xvfb-run -a node store-assets/screenshot.mjs
import { chromium } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHROME = process.env.PW_CHROME;
if (!CHROME || !existsSync(CHROME)) {
  console.log(`SKIP screenshots : Chromium complet introuvable (PW_CHROME=${CHROME || "non défini"}).`);
  process.exit(0);
}
const icon = readFileSync(fileURLToPath(new URL("../icons/icon-128.png", import.meta.url))).toString("base64");
const ICON = `data:image/png;base64,${icon}`;

const page = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  .wrap{width:${w}px;height:${h}px;display:flex;align-items:center;gap:56px;
    padding:0 72px;background:linear-gradient(135deg,#fff 0%,#fff6ea 100%)}
  .left{flex:1}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:26px}
  .brand img{width:52px;height:52px;border-radius:12px}
  .brand b{font-size:26px;letter-spacing:.3px}
  h1{font-size:38px;line-height:1.15;font-weight:800;color:#1a1a1a;margin-bottom:18px}
  h1 span{color:#f89101}
  ul{list-style:none;font-size:17px;color:#444;line-height:2}
  li::before{content:"✓";color:#f89101;font-weight:800;margin-right:10px}
  .sov{margin-top:26px;display:inline-block;font-size:13px;font-weight:700;letter-spacing:.4px;
    text-transform:uppercase;color:#f89101;border:1px solid #f8910155;border-radius:999px;padding:6px 14px}
  /* mock popup */
  .pop{width:300px;background:#fff;border:1px solid #e6e6e6;border-radius:14px;
    box-shadow:0 24px 60px -20px rgba(0,0,0,.25);overflow:hidden}
  .ph{display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid #eee}
  .ph img{width:26px;height:26px;border-radius:7px}
  .ph b{font-weight:800}
  .ph .tag{margin-left:auto;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#999}
  .pm{padding:14px 15px}
  .dom{font-weight:700;margin-bottom:4px}
  .ok{color:#0a7a3d;font-size:13px;margin-bottom:12px}
  .disc{margin:0 15px 14px;padding:11px;border:1px solid #eee;border-radius:9px;background:#fafafa;
    font-size:11.5px;color:#555;line-height:1.5}
  .disc b{color:#1a1a1a}
</style></head><body><div class="wrap">
  <div class="left">
    <div class="brand"><img src="${ICON}"><b>MIP RUM</b></div>
    <h1>La performance <span>vécue par vos vrais utilisateurs</span></h1>
    <ul>
      <li>Core Web Vitals & erreurs, en conditions réelles</li>
      <li>Aucune donnée personnelle — anonyme, hébergé en UE</li>
      <li>Actif uniquement sur les domaines que vous autorisez</li>
    </ul>
    <span class="sov">Souverain · OpenTelemetry</span>
  </div>
  <div class="pop">
    <div class="ph"><img src="${ICON}"><b>MIP RUM</b><span class="tag">capteur navigateur</span></div>
    <div class="pm"><div class="dom">insight-performance.com</div><div class="ok">● MIP RUM observe ce domaine.</div></div>
    <div class="disc">Mesure la <b>performance perçue</b> et les <b>erreurs techniques</b>, de façon
      <b>anonyme</b> — aucune donnée personnelle, aucune frappe clavier, aucun formulaire.</div>
  </div>
</div></body></html>`;

const ctx = await chromium.launch({ headless: false, executablePath: CHROME, args: ["--no-sandbox"] });
for (const [w, h, name] of [
  [1280, 800, "screenshot-1280x800.png"],
  [440, 280, "promo-440x280.png"],
]) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(page(w, h), { waitUntil: "load" });
  await p.screenshot({ path: fileURLToPath(new URL(`./${name}`, import.meta.url)), clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`✓ ${name} (${w}×${h})`);
  await p.close();
}
await ctx.close();
