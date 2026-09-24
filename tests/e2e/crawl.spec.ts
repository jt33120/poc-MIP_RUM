// C0 — LE CRAWL : chaque écran de la console × administrateur, viewer, démo.
//
// POURQUOI. La piste C déplace les lectures de la console vers console-api,
// écran par écran (C3 → C5). Avant d'en déplacer un seul, il faut une ligne de
// base : ce que chaque écran rend AUJOURD'HUI, pour chaque profil, sur la base
// de l'E2E. Le crawl la relève et la dépose en artefact (`test-results/crawl/`) :
// statut HTTP, adresse finale (une redirection est un résultat), sections en
// échec de lecture, titre. Une PR de C3–C5 compare son relevé à celui-ci.
//
// CE QUI FAIT ÉCHOUER. Un écran qui plante : statut 5xx, frontière d'erreur
// (`erreur-ecran`), ou exception non rattrapée dans la page. Pas une section en
// échec de lecture (elle est relevée, pas jugée : la base de l'E2E n'a pas toutes
// les données), ni un refus (un viewer renvoyé hors de l'administration, c'est
// le comportement attendu).
//
// LA LISTE DES ÉCRANS N'EST PAS RECOPIÉE : elle est lue dans `apps/console/app`
// (chaque `page.tsx`), comme l'inventaire de la piste C. Un écran ajouté est
// crawlé sans toucher à ce fichier ; un segment dynamique sans exemple ici fait
// échouer le test qui le liste — la couverture ne peut pas se perdre en silence.
//
// LES SESSIONS sont signées comme la console les signe (HS256, secret de la
// console de test, `playwright.config.ts`) : ni /login ni /demo, qui écrivent en
// base et n'ouvrent pas de démo sans `DEMO_USER_APPS`.
import { createHmac } from "node:crypto";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import pg from "pg";

const consoleUrl = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";
const APP = "demo-app";
const RACINE_APP = path.join(process.cwd(), "apps", "console", "app");
const SORTIE = path.join(process.cwd(), "test-results", "crawl");

type Profil = "admin" | "viewer" | "demo";
const SESSIONS: Record<Profil, { email: string; role: "admin" | "viewer"; apps: string[] | null; demo?: true }> = {
  admin: { email: "e2e-crawl-admin@mip-rum.local", role: "admin", apps: null },
  viewer: { email: "e2e-crawl-viewer@mip-rum.local", role: "viewer", apps: [APP] },
  demo: { email: "demo@mip-rum.local", role: "viewer", apps: [APP], demo: true },
};

function jeton(p: Profil): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const maintenant = Math.floor(Date.now() / 1000);
  const corps = `${b64({ alg: "HS256" })}.${b64({ ...SESSIONS[p], iat: maintenant, exp: maintenant + 3600 })}`;
  return `${corps}.${createHmac("sha256", process.env.E2E_AUTH_SECRET ?? "").update(corps).digest("base64url")}`;
}

/** Les écrans : chaque `page.tsx` sous `apps/console/app`, en chemin d'URL. */
function ecrans(): string[] {
  const trouves: string[] = [];
  (function parcourir(dossier: string) {
    for (const nom of readdirSync(dossier)) {
      const p = path.join(dossier, nom);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (nom === "page.tsx") trouves.push("/" + path.relative(RACINE_APP, dossier).split(path.sep).join("/"));
    }
  })(RACINE_APP);
  return trouves.map((e) => (e === "/" ? "/" : e.replace(/\/$/, ""))).sort();
}

/**
 * Un exemple par segment dynamique, lu dans la base de l'E2E. Absent de la base :
 * un identifiant qui n'existe pas — l'écran doit alors dire « introuvable », pas
 * planter. C'est un cas légitime du relevé.
 */
const EXEMPLES: Record<string, string> = {
  "[appId]": `select app_id as v from app_registry where app_id = '${APP}' limit 1`,
  "[id]@dashboards": "select id::text as v from dashboard order by id limit 1",
  "[fingerprint]": "select fingerprint as v from rum_error where fingerprint is not null order by ts desc limit 1",
  "[id]@issues": "select id::text as v from error_issue order by last_seen desc limit 1",
  "[id]@sessions": "select session_id as v from rum_session order by started_at desc nulls last limit 1",
  "[callId]": "select call_id as v from svi_call order by id desc limit 1",
  "[traceId]": "select trace_id as v from rum_span where trace_id is not null limit 1",
};

function cleExemple(ecran: string, segment: string): string {
  if (segment === "[id]") return `[id]@${ecran.includes("/issues/") ? "issues" : ecran.split("/")[1]}`;
  return segment;
}

const valeurs = new Map<string, string>();
const ECRANS = ecrans();

test.describe.configure({ mode: "parallel" });

test.beforeAll(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum", max: 2 });
  try {
    for (const [cle, sql] of Object.entries(EXEMPLES)) {
      const v = await pool.query<{ v: string }>(sql).then((r) => r.rows[0]?.v, () => undefined);
      valeurs.set(cle, v ?? "e2e-absent");
    }
  } finally {
    await pool.end();
  }
});

test("chaque segment dynamique a son exemple", () => {
  const sansExemple = ECRANS.flatMap((e) =>
    e.split("/").filter((s) => s.startsWith("[")).map((s) => cleExemple(e, s)).filter((k) => !(k in EXEMPLES)).map((k) => `${e} (${k})`),
  );
  expect(sansExemple).toEqual([]);
  // Garde contre une liste vide (arborescence déplacée) : la console en a 57.
  expect(ECRANS.length).toBeGreaterThanOrEqual(50);
});

async function visiter(browser: Browser, profil: Profil, ecran: string) {
  const url = ecran
    .split("/")
    .map((s) => (s.startsWith("[") ? encodeURIComponent(valeurs.get(cleExemple(ecran, s)) ?? "e2e-absent") : s))
    .join("/");
  const contexte = await browser.newContext();
  await contexte.addCookies([{ name: "mip_session", value: jeton(profil), url: consoleUrl }]);
  const page = await contexte.newPage();
  const exceptions: string[] = [];
  page.on("pageerror", (e) => exceptions.push(e.message.slice(0, 300)));
  try {
    const res = await page.goto(`${consoleUrl}${url}?app=${APP}`, { waitUntil: "load", timeout: 60_000 });
    const releve = {
      ecran,
      profil,
      url,
      statut: res?.status() ?? 0,
      finale: new URL(page.url()).pathname,
      titre: ((await page.locator("h1").first().textContent({ timeout: 2_000 }).catch(() => null)) ?? "").trim().slice(0, 120),
      erreurEcran: await page.getByTestId("erreur-ecran").count(),
      sectionsEnEchec: await page.getByTestId("echec-lecture").count(),
      exceptions,
    };
    mkdirSync(SORTIE, { recursive: true });
    writeFileSync(path.join(SORTIE, `${profil}--${ecran.replace(/[^a-z0-9]+/gi, "_") || "racine"}.json`), `${JSON.stringify(releve, null, 2)}\n`);
    return releve;
  } finally {
    await contexte.close();
  }
}

for (const profil of Object.keys(SESSIONS) as Profil[]) {
  for (const ecran of ECRANS) {
    test(`${profil} · ${ecran}`, async ({ browser }) => {
      const r = await visiter(browser, profil, ecran);
      expect(r.statut, `${ecran} (${profil}) : statut`).toBeLessThan(500);
      expect(r.erreurEcran, `${ecran} (${profil}) : frontière d'erreur`).toBe(0);
      expect(r.exceptions, `${ecran} (${profil}) : exception non rattrapée`).toEqual([]);
    });
  }
}
