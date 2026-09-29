// Garde-fou contre les scripts lancés sur la production (`scripts/lib/cible-locale.mjs`).
//
// POURQUOI. Le 16/09/2026, `scripts/verify-tenant-isolation.mjs` a tourné avec
// `DATABASE_URL` pointée sur la production — le `.env` du poste la désigne — et y
// a créé ses applications de test `app-a` et `app-b`. Ce fichier vérifie, sans
// rien connecter :
//   1. la règle elle-même (hôte local, ou distant NOMMÉ par la dérogation) ;
//   2. que chaque script écrivant l'appelle, AVANT toute connexion ;
//   3. qu'aucun script écrivant ne s'ajoute sans elle (cliquet sur `scripts/`) ;
//   4. qu'en vrai, lancé sur une base distante, un script refuse et sort en 2.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { DEROGATION, hoteLocal, verifierCibleLocale } from "../../scripts/lib/cible-locale.mjs";

const RACINE = join(__dirname, "..", "..");
const PROD = "postgres://neondb_owner:secret@ep-quelque-chose-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const HOTE_PROD = "ep-quelque-chose-pooler.eu-central-1.aws.neon.tech";

describe("la règle : une cible locale, ou distante et nommée", () => {
  it("accepte les bases locales de la CI, du poste et de l'E2E", () => {
    for (const url of [
      "postgres://postgres:postgres@localhost:5433/mip_rum",
      "postgres://postgres@127.0.0.1:5433/bench",
      "postgresql://postgres@[::1]:5432/x",
      "postgres://postgres@host.docker.internal:5433/x",
      "postgres:///mip_rum?host=/var/run/postgresql",
      "http://localhost:4318/v1/traces",
      "http://127.0.0.1:8123",
    ]) {
      expect(verifierCibleLocale(url, { env: {} }).ok, url).toBe(true);
    }
  });

  it("sans URL, suit libpq : PGHOST décide, sinon la connexion est locale", () => {
    expect(verifierCibleLocale(undefined, { env: {} }).ok).toBe(true);
    expect(verifierCibleLocale(undefined, { env: { PGHOST: "localhost" } }).ok).toBe(true);
    expect(verifierCibleLocale(undefined, { env: { PGHOST: HOTE_PROD } }).ok).toBe(false);
  });

  it("refuse la production et toute autre cible distante, base ou endpoint", () => {
    for (const url of [PROD, "https://mip-rum-console.vercel.app/api/ingest/v1/traces", "postgres://u@10.0.0.4/db"]) {
      const r = verifierCibleLocale(url, { env: {} });
      expect(r.ok, url).toBe(false);
      expect(r.ok ? "" : r.raison).toContain(DEROGATION);
    }
  });

  it("la dérogation NOMME l'hôte : ni « oui », ni un autre hôte ne suffisent", () => {
    expect(verifierCibleLocale(PROD, { env: { [DEROGATION]: "oui" } }).ok).toBe(false);
    expect(verifierCibleLocale(PROD, { env: { [DEROGATION]: "1" } }).ok).toBe(false);
    expect(verifierCibleLocale(PROD, { env: { [DEROGATION]: "ep-autre.neon.tech" } }).ok).toBe(false);
    expect(verifierCibleLocale(PROD, { env: { [DEROGATION]: HOTE_PROD } }).ok).toBe(true);
    expect(verifierCibleLocale(PROD, { env: { [DEROGATION]: `staging.exemple.fr, ${HOTE_PROD.toUpperCase()}` } }).ok).toBe(true);
  });

  it("refuse une cible illisible plutôt que de la deviner", () => {
    expect(verifierCibleLocale("host=ep-x.neon.tech dbname=neondb", { env: {} }).ok).toBe(false);
  });

  it("ne prend pas pour locaux des hôtes qui lui ressemblent", () => {
    for (const hote of ["localhost.evil.test", "127.0.0.1.nip.io", "mip-localhost", "128.0.0.1"]) {
      expect(hoteLocal(hote), hote).toBe(false);
    }
  });
});

/** Scripts qui écrivent hors du chemin d'exploitation prévu : tous gardés. */
const ECRIVAINS = [
  "scripts/verify-alerting.mjs",
  "scripts/verify-conformite.mjs",
  "scripts/verify-console-ro.mjs",
  "scripts/verify-dashboards.mjs",
  "scripts/verify-frustration.mjs",
  "scripts/verify-health.mjs",
  "scripts/verify-oidc-jit.mjs",
  "scripts/verify-rollups.mjs",
  "scripts/verify-tenant-isolation.mjs",
  "scripts/verify-tenant.mjs",
  "scripts/seed-admin.mjs",
  "scripts/gen-traffic.mjs",
  "scripts/bench-ingest.mjs",
  "scripts/bench-route-trigger.mjs",
  "scripts/bench-verrou-p81.mjs",
  "scripts/load-bench.mjs",
  "scripts/load-light.mjs",
  "playwright.config.ts",
];

/**
 * Scripts dont les fonctions d'envoi sont DÉFINIES avant `main()` : l'ordre du
 * texte n'y dit rien de l'ordre d'exécution. Le refus avant tout envoi y est
 * prouvé en lançant le script (dernier bloc de ce fichier).
 */
const ORDRE_PROUVE_A_L_EXECUTION = new Set(["scripts/load-bench.mjs"]);

/** Scripts de `scripts/` qui touchent une base sans ce garde-fou, et pourquoi. */
const EXEMPTS: Record<string, string> = {
  "scripts/backfill-rum.mjs": "outil d'exploitation voulu, avec sa propre variable d'acquiescement",
  "scripts/bench/semer-bancs.mjs": "garde propre, plus stricte (BENCH_DATABASE_URL seule, nom « bench »)",
  "scripts/captures-portail.mjs": "garde propre, sans dérogation possible (MIP_CAPTURES_DB locale seulement)",
  "scripts/bench/banc-collecteur-local.mjs": "base construite par le script lui-même, sur 127.0.0.1",
  "scripts/bench/preuve-echeance-collecteur.mjs": "base construite par le script lui-même, sur 127.0.0.1",
  "scripts/bench/echantillonner-verrou.mjs": "lecture seule (pg_locks)",
  "scripts/bench/sonde-pg.mjs": "sonde installée par un banc, n'ouvre aucune connexion",
  "scripts/bench/sonde-pg-preload.mjs": "sonde installée par un banc, n'ouvre aucune connexion",
  "scripts/verify-sdk-packaging.mjs": "n'ouvre aucune base",
};

/** Répertoires de `scripts/` hors du cliquet : l'exploitation voulue, et la CI (lecture des droits). */
const HORS_CLIQUET = ["scripts/ops/", "scripts/ci/", "scripts/lib/"];

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin];
  });
}

const lire = (fichier: string) => readFileSync(join(RACINE, fichier), "utf8");
const ECRIT_EN_BASE = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate\s|create\s+(table|role|database))\b/i;
const OUVRE_UNE_BASE = /from\s+["']pg["']|new\s+pg\.(Pool|Client)/;

describe("chaque script écrivant appelle le garde-fou, avant de se connecter", () => {
  for (const fichier of ECRIVAINS) {
    it(fichier, () => {
      const source = lire(fichier);
      expect(source).toMatch(/from\s+["'](\.\/|\.\.\/)*(scripts\/)?lib\/cible-locale\.mjs["']/);
      const garde = source.search(/exigerCibleLocale\(/);
      expect(garde, "appel de exigerCibleLocale").toBeGreaterThan(-1);
      // Le premier appel précède toute connexion, tout envoi, tout navigateur.
      if (ORDRE_PROUVE_A_L_EXECUTION.has(fichier)) return;
      for (const connexion of [/new\s+pg\.(Pool|Client)\(/, /\bfetch\(/, /chromium\.launch\(/, /webServer\s*:/]) {
        const position = source.search(connexion);
        if (position > -1) expect(garde, `${connexion} avant le garde-fou`).toBeLessThan(position);
      }
    });
  }
});

describe("cliquet : aucun script qui écrit en base ne s'ajoute sans garde-fou", () => {
  it("tout script de scripts/ qui ouvre une base et y écrit est gardé ou exempté, avec sa raison", () => {
    const nonGardes = fichiers(join(RACINE, "scripts"))
      .map((f) => relative(RACINE, f).split("\\").join("/"))
      .filter((f) => /\.(mjs|js|cjs|ts)$/.test(f) && !HORS_CLIQUET.some((d) => f.startsWith(d)))
      .filter((f) => {
        const source = lire(f);
        return OUVRE_UNE_BASE.test(source) && ECRIT_EN_BASE.test(source);
      })
      .filter((f) => !ECRIVAINS.includes(f) && !(f in EXEMPTS));
    expect(nonGardes).toEqual([]);
  });

  it("les exemptions existent encore (une exemption orpheline cacherait un renommage)", () => {
    for (const fichier of Object.keys(EXEMPTS)) {
      expect(() => statSync(join(RACINE, fichier)), fichier).not.toThrow();
    }
  });
});

describe("en vrai : lancé sur une base distante, un script refuse sans se connecter", () => {
  const lancer = (script: string, env: Record<string, string>) => spawnSync(process.execPath, [script], {
    cwd: RACINE,
    // Environnement minimal : aucune variable PG* ni DATABASE_URL du poste.
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 20_000,
  });

  const cas: Array<[string, Record<string, string>]> = [
    ["scripts/verify-tenant-isolation.mjs", { DATABASE_URL: PROD }],
    ["scripts/verify-alerting.mjs", { DATABASE_URL: PROD }],
    ["scripts/seed-admin.mjs", { DATABASE_URL: PROD }],
    ["scripts/bench-ingest.mjs", { DATABASE_URL: PROD }],
    ["scripts/bench-route-trigger.mjs", { DATABASE_URL: PROD }],
    ["scripts/bench-verrou-p81.mjs", { BENCH_DATABASE_URL: PROD }],
    ["scripts/verify-tenant.mjs", { PGHOST: HOTE_PROD }],
    ["scripts/load-bench.mjs", { ENDPOINT: "https://mip-rum-console.vercel.app/api/ingest/v1/traces", DB_PHASE: "0" }],
  ];
  for (const [script, env] of cas) {
    it(`${script} (${Object.keys(env).join(", ")})`, () => {
      const r = lancer(script, env);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toContain("REFUS");
      expect(r.stderr).toContain(DEROGATION);
    }, 30_000);
  }
});
