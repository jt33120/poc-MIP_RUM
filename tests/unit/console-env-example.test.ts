// `apps/console/.env.example` est le modèle d'environnement de la console. Un
// nouvel arrivant, humain ou agent, doit partir de lui plutôt que du `.env` d'un
// poste, qui peut viser la production. Un modèle incomplet renvoie à ce `.env` :
// ce test lit le code de la console et refuse qu'une variable lue manque au modèle.
//
// Il ne vérifie PAS l'inverse. Une variable du modèle que le code ne lit plus ne
// casse rien, et deux PR qui ajoutent chacune leur variable (au code et au modèle)
// restent vertes quel que soit l'ordre de fusion.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const CONSOLE = "apps/console";
const EXEMPLE = `${CONSOLE}/.env.example`;

// `public/` sert des bundles tiers (le rejeu embarque un `process.env.LANG` qui
// tourne dans le navigateur) : ce n'est pas du code de la console.
const IGNORES = new Set(["node_modules", ".next", "public", "test-results", "playwright-report"]);
const CODE = /\.(ts|tsx|mjs|js|cjs)$/;

/** `process.env.X`, et `env.X` / `env().X` quand l'environnement est injecté pour les tests ; formes `["X"]` comprises. */
const LECTURE = /\benv(?:\(\))?(?:\.([A-Z][A-Z0-9_]*)\b|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g;
/** Un nom calculé (`process.env[nom]`) : le motif ci-dessus ne le voit pas. */
const LECTURE_CALCULEE = /\benv(?:\(\))?\[\s*(?!["'`])/;

/**
 * Les fichiers qui lisent l'environnement par un nom calculé, et les variables
 * qu'ils atteignent, relevées à la main. Un fichier de plus fait échouer le test :
 * il faut alors relire ce qu'il lit et le déclarer ici.
 */
const LECTURES_CALCULEES: Record<string, readonly string[]> = {
  // La table famille → variable des pourcentages par défaut de la bascule vers console-api.
  "lib/platform-flag.ts": ["CONSOLE_API_ECRANS_PCT", "CONSOLE_API_COMMANDES_PCT"],
  // La garde « console sans base » parcourt l'environnement pour REFUSER des noms : elle n'en attend aucun.
  "next.config.mjs": [],
};

function sources(dir: string = CONSOLE, acc: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) sources(chemin, acc);
    else if (CODE.test(nom)) acc.push(chemin);
  }
  return acc;
}

const fichiers = sources().map((f) => ({
  chemin: relative(CONSOLE, f).split(sep).join("/"),
  texte: readFileSync(f, "utf8"),
}));

function variablesLues(): Set<string> {
  const lues = new Set<string>();
  for (const { texte } of fichiers) {
    for (const m of texte.matchAll(LECTURE)) lues.add(m[1] ?? m[2]);
  }
  for (const noms of Object.values(LECTURES_CALCULEES)) for (const nom of noms) lues.add(nom);
  return lues;
}

/** Les déclarations du modèle, commentées (`# X=`) ou non (`X=`), avec leur valeur. */
function declarations(): Map<string, string> {
  const vues = new Map<string, string>();
  for (const ligne of readFileSync(EXEMPLE, "utf8").split("\n")) {
    const m = /^(?:#\s?)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(ligne.trim());
    if (m) vues.set(m[1], m[2]);
  }
  return vues;
}

describe("apps/console/.env.example", () => {
  it("le relevé voit les lectures directes et les lectures injectées", () => {
    const lues = variablesLues();
    expect(lues.size).toBeGreaterThan(40);
    // `DATABASE_URL` est lu par `process.env.X`, `AUTH_SECRET` par un `env` injecté (lib/auth.ts).
    expect(lues).toContain("DATABASE_URL");
    expect(lues).toContain("AUTH_SECRET");
  });

  it("chaque variable lue par la console y figure", () => {
    const declarees = declarations();
    const manquantes = [...variablesLues()].filter((v) => !declarees.has(v)).sort();
    expect(manquantes).toEqual([]);
  });

  it("les lectures par nom calculé sont toutes relevées", () => {
    const calculees = fichiers.filter((f) => LECTURE_CALCULEE.test(f.texte)).map((f) => f.chemin);
    expect(calculees.filter((c) => !(c in LECTURES_CALCULEES))).toEqual([]);
    for (const [chemin, noms] of Object.entries(LECTURES_CALCULEES)) {
      const texte = fichiers.find((f) => f.chemin === chemin)?.texte ?? "";
      for (const nom of noms) expect(texte, `${chemin} ne nomme plus ${nom}`).toContain(`"${nom}"`);
    }
  });

  it("ne porte aucune valeur", () => {
    const remplies = [...declarations()].filter(([, valeur]) => valeur.trim() !== "").map(([nom]) => nom);
    expect(remplies).toEqual([]);
  });

  it("n'est pas ignoré par git", () => {
    // `git check-ignore` rend 1 quand le chemin n'est PAS ignoré, 0 quand il l'est.
    const { status } = spawnSync("git", ["check-ignore", "--no-index", "-q", EXEMPLE]);
    expect(status).toBe(1);
  });
});
