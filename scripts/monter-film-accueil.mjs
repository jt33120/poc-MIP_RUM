// Monte le film d'accueil de la vitrine (/presentation) : un clip vidéo fourni (généré
// hors du dépôt), sur lequel s'incrustent des titres animés, un temps par acte du clip.
//
//   node scripts/monter-film-accueil.mjs /chemin/vers/clip.mp4 [/chemin/vers/clip2.mp4 …]
//
// Plusieurs clips s'enchaînent dans l'ordre, en fondu (FONDU secondes). Sortie :
// apps/console/public/vitrine/film-accueil.mp4 et son affiche film-accueil.jpg ; puis
// renseigner FILM_ACCUEIL dans apps/console/lib/vitrine.ts. Les sources ne sont pas
// versionnées.
//
// Même méthode que le film d'accueil de xsom.fr (poc-AI_guard, scripts/render-home-film.mjs) :
// Chromium dessine la couche de titres image par image sur une page transparente (les
// révélations ligne par ligne demandent une vraie mise en page, que drawtext ne sait
// pas faire), FFmpeg étalonne le clip, pose la couche et encode. Chaque temps (TEMPS)
// suit un acte du clip : l'écran du visiteur, les mesures qui s'en échappent, le tableau
// de bord qui se construit, le tableau entier.
//
// Requiert ffmpeg et le Chromium de Playwright (celui des tests E2E). Les titres sont
// en police système (SF Pro sur macOS) : aucune police de plus dans le dépôt.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = join(RACINE, "apps/console/public/vitrine/film-accueil.mp4");
const IPS = 24;
const DUREE = 15;
const FONDU = 0.6;
/** L'affiche : la carte finale, lisible avant toute lecture. */
const AFFICHE_A = 13.4;
// L'en-tête de la vitrine recouvre le haut du film, et l'invitation « Entrer » le bas.
const MARGE_HAUT = 240;
const MARGE_BAS = 230;

/**
 * Les temps du film (secondes) et leurs mots. Chaque affirmation se vérifie dans la
 * console : les mesures (Web Vitals, erreurs, parcours), le lien erreur → session, le
 * rejeu de session, la collecte OpenTelemetry.
 */
const TEMPS = {
  un: { entree: 0.3, sortie: 3.4, accroche: "Sur chaque écran,", titre: ["une vraie visite."] },
  deux: { entree: 3.8, sortie: 7.2, accroche: "Vitesse, erreurs, parcours :", mot: "MESURÉS." },
  trois: {
    entree: 7.6,
    sortie: 10.9,
    lignes: [
      ["MESURER", "chaque page"],
      ["RELIER", "chaque erreur"],
      ["REVOIR", "chaque session"],
    ],
  },
  quatre: { entree: 11.4, titre: ["Le monitoring", "de vos vrais visiteurs."], sous: "Real User Monitoring · natif OpenTelemetry" },
};

function ffmpeg(args) {
  return new Promise((ok, ko) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-y", ...args], { stdio: "inherit" });
    p.on("error", ko);
    p.on("exit", (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg a rendu ${code}`))));
  });
}

const echapper = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  body { font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; color: #fff; }
  .voile, .eclair, .temps { position: absolute; inset: 0; }
  .voile { opacity: 0; }
  .voile--gauche { background: linear-gradient(90deg, rgba(4,10,28,.88), rgba(4,10,28,.5) 45%, transparent 78%); }
  .voile--bas { background: linear-gradient(0deg, rgba(4,10,28,.86), rgba(4,10,28,.5) 45%, transparent 70%); }
  .voile--final { background: radial-gradient(ellipse 72% 62% at 50% 50%, rgba(4,10,28,.72), rgba(4,10,28,.35) 70%, rgba(4,10,28,.2)); }
  .eclair { opacity: 0; background: radial-gradient(ellipse at 50% 50%, rgba(248,145,1,.5), rgba(248,145,1,.1) 70%); }
  .ligne { overflow: hidden; padding: .14em .06em .08em; margin: 0 -.06em -.22em; }
  .ligne > span { display: inline-block; white-space: nowrap; will-change: transform; }
  .accroche { font-weight: 400; font-style: italic; font-size: 70px; color: #ffe2b8; text-shadow: 0 3px 24px rgba(2,8,24,.8); }
  .titre { font-weight: 900; line-height: 1; letter-spacing: -.035em; text-shadow: 0 6px 40px rgba(2,8,24,.55); }
  .orange { color: #f89101; text-shadow: 0 0 60px rgba(248,145,1,.4), 0 6px 40px rgba(2,8,24,.6); }
  .temps--un .pile { position: absolute; left: 120px; top: ${MARGE_HAUT}px; }
  .temps--un .titre { font-size: 150px; }
  .temps--deux .pile { position: absolute; left: 0; right: 0; bottom: ${MARGE_BAS}px; text-align: center; }
  .temps--deux .mot { font-size: 220px; }
  .temps--deux .mot > span > span { display: inline-block; }
  .temps--trois .pile { position: absolute; left: 120px; top: 50%; transform: translateY(-50%); display: grid; gap: 30px; }
  .frappe { display: flex; align-items: baseline; gap: 30px; transform-origin: 0 60%; }
  .frappe b { font-weight: 900; font-size: 150px; line-height: .9; letter-spacing: -.035em; color: color-mix(in srgb, #fff calc(100% - var(--terni, 0) * 100%), #f89101); text-shadow: 0 6px 40px rgba(2,8,24,.55); }
  .frappe i { font-weight: 400; font-size: 64px; color: #ffe2b8; }
  .temps--quatre .pile { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-46%); text-align: center; }
  .temps--quatre .titre { font-size: 128px; }
  .regle { width: 120px; height: 6px; margin: 0 auto 36px; background: #f89101; transform-origin: 50% 50%; border-radius: 3px; }
  .sous { margin-top: 30px; font-size: 40px; letter-spacing: .08em; color: rgba(255,255,255,.8); text-transform: uppercase; }
`;

function titres() {
  const { un, deux, trois, quatre } = TEMPS;
  const lettres = [...deux.mot].map((c) => `<span>${echapper(c)}</span>`).join("");
  return `
  <div class="voile voile--gauche" data-entree="${un.entree - 0.2}" data-sortie="${un.sortie}"></div>
  <section class="temps temps--un"><div class="pile">
    <div class="ligne accroche" data-entree="${un.entree}" data-sortie="${un.sortie}"><span>${echapper(un.accroche)}</span></div>
    ${un.titre.map((t, i) => `<div class="ligne titre" data-entree="${un.entree + 0.2 + i * 0.15}" data-sortie="${un.sortie}"><span>${echapper(t)}</span></div>`).join("")}
  </div></section>

  <div class="voile voile--bas" data-entree="${deux.entree - 0.2}" data-sortie="${deux.sortie}"></div>
  <section class="temps temps--deux"><div class="pile">
    <div class="ligne accroche" data-entree="${deux.entree}" data-sortie="${deux.sortie}"><span>${echapper(deux.accroche)}</span></div>
    <div class="ligne titre mot orange" data-lettres data-entree="${deux.entree + 0.35}" data-sortie="${deux.sortie}"><span>${lettres}</span></div>
  </div></section>

  <div class="voile voile--gauche" data-entree="${trois.entree - 0.2}" data-sortie="${trois.sortie}"></div>
  <section class="temps temps--trois"><div class="pile">
    ${trois.lignes
      .map(([verbe, objet], i) => {
        const entree = trois.entree + i * 0.85;
        const terni = i < trois.lignes.length - 1 ? ` data-terni="${entree + 0.85}"` : "";
        return `<div class="frappe" data-entree="${entree}"${terni} data-sortie="${trois.sortie - 0.1 + i * 0.06}"><b>${echapper(verbe)}</b><i>${echapper(objet)}</i></div>`;
      })
      .join("")}
  </div></section>

  <div class="voile voile--final" data-entree="${quatre.entree - 0.3}"></div>
  <section class="temps temps--quatre"><div class="pile">
    <div class="regle" data-entree="${quatre.entree - 0.1}"></div>
    ${quatre.titre.map((t, i) => `<div class="ligne titre${i === 1 ? " orange" : ""}" data-entree="${quatre.entree + i * 0.15}"><span>${echapper(t)}</span></div>`).join("")}
    <div class="ligne sous" data-entree="${quatre.entree + 0.7}"><span>${echapper(quatre.sous)}</span></div>
  </div></section>

  <div class="eclair" data-a="${deux.entree + 0.3}"></div>
  <div class="eclair" data-a="${quatre.entree - 0.25}"></div>`;
}

/** L'état de chaque élément est une fonction pure du temps : n'importe quelle image se dessine seule. */
function installerChronologie() {
  const borne = (x) => Math.min(1, Math.max(0, x));
  const sortieExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
  const cube = (x) => x ** 3;
  const entrer = (el, t, duree, delai = 0) => sortieExpo(borne((t - Number(el.dataset.entree) - delai) / duree));
  const quitter = (el, t, duree) => (el.dataset.sortie ? cube(borne((t - Number(el.dataset.sortie)) / duree)) : 0);
  window.dessinerA = (t) => {
    for (const el of document.querySelectorAll(".ligne")) {
      const sortie = quitter(el, t, 0.38);
      const dedans = el.firstElementChild;
      if (el.hasAttribute("data-lettres")) {
        [...dedans.children].forEach((l, i) => {
          l.style.transform = `translateY(${(1 - entrer(el, t, 0.5, i * 0.05)) * 125}%)`;
        });
        dedans.style.transform = `translateY(${-sortie * 125}%)`;
      } else {
        dedans.style.transform = `translateY(${(1 - entrer(el, t, 0.62)) * 125 - sortie * 125}%)`;
      }
    }
    for (const el of document.querySelectorAll(".frappe")) {
      const vu = entrer(el, t, 0.42);
      const sortie = quitter(el, t, 0.34);
      el.style.opacity = String(vu * (1 - sortie));
      el.style.transform = `translateX(${-sortie * 90}px) scale(${1.14 - 0.14 * vu})`;
      el.style.filter = `blur(${(1 - vu) * 16}px)`;
      el.style.setProperty("--terni", el.dataset.terni ? String(borne((t - Number(el.dataset.terni)) / 0.3)) : "0");
    }
    for (const el of document.querySelectorAll(".voile")) {
      el.style.opacity = String(borne((t - Number(el.dataset.entree)) / 0.4) * (1 - quitter(el, t, 0.4)));
    }
    for (const el of document.querySelectorAll(".regle")) el.style.transform = `scaleX(${entrer(el, t, 0.55)})`;
    for (const el of document.querySelectorAll(".eclair")) {
      const d = t - Number(el.dataset.a);
      el.style.opacity = String(d < 0 ? borne(1 + d / 0.08) : borne(1 - d / 0.35) ** 2);
    }
  };
}

/** Le clip de base : un seul, ou plusieurs enchaînés en fondu, ramenés à DUREE secondes. */
async function clipDeBase(sources, dossier) {
  const base = join(dossier, "base.mp4");
  const norme = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=${IPS},format=yuv420p`;
  if (sources.length === 1) {
    await ffmpeg(["-i", sources[0], "-vf", norme, "-an", "-t", String(DUREE), "-c:v", "libx264", "-crf", "16", base]);
    return base;
  }
  const durees = await Promise.all(sources.map(dureeDe));
  const filtres = sources.map((_, i) => `[${i}:v:0]${norme},setpts=PTS-STARTPTS[v${i}]`);
  let courant = "v0";
  let cumul = durees[0];
  for (let i = 1; i < sources.length; i++) {
    const suivant = `x${i}`;
    filtres.push(`[${courant}][v${i}]xfade=transition=fade:duration=${FONDU}:offset=${(cumul - FONDU).toFixed(3)}[${suivant}]`);
    cumul += durees[i] - FONDU;
    courant = suivant;
  }
  await ffmpeg([
    ...sources.flatMap((s) => ["-i", s]),
    "-filter_complex", filtres.join(";"), "-map", `[${courant}]`, "-an", "-t", String(DUREE),
    "-c:v", "libx264", "-crf", "16", base,
  ]);
  return base;
}

function dureeDe(fichier) {
  return new Promise((ok, ko) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fichier]);
    let sortie = "";
    p.stdout.on("data", (d) => (sortie += d));
    p.on("error", ko);
    p.on("exit", (code) => (code === 0 ? ok(Number(sortie.trim())) : ko(new Error(`ffprobe a rendu ${code} sur ${fichier}`))));
  });
}

async function principal() {
  const sources = process.argv.slice(2).map((s) => resolve(s));
  if (sources.length === 0) throw new Error("donner le ou les clips source : node scripts/monter-film-accueil.mjs clip.mp4 [clip2.mp4 …]");
  const total = (await Promise.all(sources.map(dureeDe))).reduce((a, d) => a + d, 0) - FONDU * (sources.length - 1);
  if (total < DUREE) console.warn(`attention : ${total.toFixed(1)} s de clip pour un film de ${DUREE} s — la fin sera noire.`);

  const travail = await mkdtemp(join(tmpdir(), "mip-film-accueil-"));
  const { chromium } = await import("@playwright/test");
  let navigateur;
  try {
    const base = await clipDeBase(sources, travail);
    navigateur = await chromium.launch({ headless: true });
    const page = await navigateur.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.setContent(`<style>${CSS}</style>${titres()}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(installerChronologie);
    const images = join(travail, "titres");
    await mkdir(images, { recursive: true });
    for (let i = 0; i < IPS * DUREE; i++) {
      await page.evaluate((t) => window.dessinerA(t), i / IPS);
      await page.screenshot({ path: join(images, `${String(i).padStart(4, "0")}.png`), omitBackground: true });
    }
    await navigateur.close();
    navigateur = undefined;

    await mkdir(dirname(SORTIE), { recursive: true });
    const filtre = [
      `[0:v:0]setpts=PTS-STARTPTS,eq=contrast=1.06:saturation=1.1,vignette=angle=PI/5[fond]`,
      `[fond][1:v]overlay=0:0:shortest=1,fade=t=out:st=${DUREE - 0.45}:d=0.45,format=yuv420p[film]`,
    ].join(";");
    await ffmpeg([
      "-i", base, "-framerate", String(IPS), "-i", join(images, "%04d.png"),
      "-filter_complex", filtre, "-map", "[film]", "-t", String(DUREE),
      "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-movflags", "+faststart", "-map_metadata", "-1", SORTIE,
    ]);
    const affiche = SORTIE.replace(/\.mp4$/, ".jpg");
    await ffmpeg(["-ss", String(AFFICHE_A), "-i", SORTIE, "-frames:v", "1", "-q:v", "3", "-update", "1", affiche]);
    console.log(`film : ${SORTIE}\naffiche : ${affiche}`);
  } finally {
    if (navigateur) await navigateur.close();
    await rm(travail, { recursive: true, force: true });
  }
}

try {
  await principal();
} catch (e) {
  console.error(`monter-film-accueil : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
