// @mip/service-kit — config.mjs : un service refuse de démarrer en listant
// TOUTES ses erreurs d'un coup, et aucune valeur secrète ne sort — ni dans le
// journal de démarrage, ni dans un message d'erreur.
import { describe, expect, it, vi } from "vitest";
import { COMMON_ENV, defineConfig, envExample, parseConfig, redactConfig } from "../../packages/service-kit/config.mjs";

const SCHEMA = {
  DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"], description: "Postgres" },
  PORT: { type: "port", default: 8080, description: "Port d'écoute" },
  PGPOOL_MAX: { type: "int", default: 4, min: 1, max: 50 },
  REQUIRE_API_KEY: { type: "bool", default: false },
  LOG_LEVEL: { type: "enum", values: ["debug", "info", "warn", "error"], default: "info" },
  METRICS_TOKEN: { type: "string", secret: true, minLength: 32 },
  MIP_CONSOLE_URL: { type: "url", description: "Origine de la console" },
  SIGNAUX: { type: "list", values: ["traces", "logs", "replay"], default: ["traces"] },
} as const;

const DB = "postgres://neondb_owner:MotDePasseTresSecret@ep-x.eu-central-1.aws.neon.example/neondb?sslmode=require";

/** defineConfig avec tout injecté : journal capturé, sortie simulée. */
function lancer(env: Record<string, string>, argv: string[] = []) {
  const lignes: { level: string; msg: string; champs: any }[] = [];
  const log = {
    info: (msg: string, champs: any) => lignes.push({ level: "info", msg, champs }),
    error: (msg: string, champs: any) => lignes.push({ level: "error", msg, champs }),
    warn: () => {},
    debug: () => {},
  };
  const exit = vi.fn();
  const imprime: string[] = [];
  const config = defineConfig(SCHEMA, { env, argv, log: log as any, exit, print: (t: string) => imprime.push(t) });
  return { config, lignes, exit, imprime, texte: JSON.stringify(lignes) };
}

describe("service-kit/config — échec immédiat", () => {
  it("liste TOUTES les erreurs en une seule ligne, puis sort en 2", () => {
    const { config, lignes, exit } = lancer({
      PORT: "quatre-vingts",
      PGPOOL_MAX: "500",
      REQUIRE_API_KEY: "ture",
      LOG_LEVEL: "verbeux",
      SIGNAUX: "traces,metriques",
    });
    expect(exit).toHaveBeenCalledWith(2);
    expect(config).toBeNull();
    const erreurs = lignes.filter((l) => l.level === "error");
    expect(erreurs).toHaveLength(1); // UNE ligne, pas une par variable
    const liste: string[] = erreurs[0].champs.erreurs;
    expect(erreurs[0].champs.nombre).toBe(6);
    expect(liste.join("\n")).toMatch(/DATABASE_URL : obligatoire/);
    expect(liste.join("\n")).toMatch(/PORT : entier attendu/);
    expect(liste.join("\n")).toMatch(/PGPOOL_MAX : doit valoir au plus 50/);
    expect(liste.join("\n")).toMatch(/REQUIRE_API_KEY : booléen attendu/);
    expect(liste.join("\n")).toMatch(/LOG_LEVEL : valeur hors liste/);
    expect(liste.join("\n")).toMatch(/SIGNAUX : éléments hors liste \(« metriques »\)/);
  });

  it("une variable VIDE compte comme absente (le cas IDENTITY_HASH_SECRET du 23/09)", () => {
    const { valeurs, erreurs } = parseConfig(SCHEMA, { DATABASE_URL: "   ", PORT: "" });
    expect(erreurs.map((e) => e.variable)).toEqual(["DATABASE_URL"]);
    expect(valeurs.PORT).toBe(8080);
  });

  it("n'écrit jamais la valeur d'un secret dans une erreur, ni une URL même non secrète", () => {
    const { texte } = lancer({
      DATABASE_URL: "mysql://root:SecretMysql@h/db",
      METRICS_TOKEN: "court-mais-secret",
      MIP_CONSOLE_URL: "pas une url avec motdepasse",
    });
    expect(texte).toContain("DATABASE_URL : protocole « mysql: » refusé");
    expect(texte).toContain("METRICS_TOKEN : trop courte");
    expect(texte).toContain("MIP_CONSOLE_URL : URL invalide");
    expect(texte).not.toContain("SecretMysql");
    expect(texte).not.toContain("court-mais-secret");
    expect(texte).not.toContain("motdepasse");
  });

  it("une faute de schéma lève au chargement : secret avec défaut, type inconnu, enum sans valeurs", () => {
    expect(() => parseConfig({ X: { type: "string", secret: true, default: "commité" } }, {})).toThrow(/secret/);
    expect(() => parseConfig({ X: { type: "date" } } as any, {})).toThrow(/type inconnu/);
    expect(() => parseConfig({ X: { type: "enum" } } as any, {})).toThrow(/values/);
    expect(() => parseConfig({ X: { type: "int", required: true, default: 1 } }, {})).toThrow(/s'excluent/);
  });

  it("validate() ajoute sa propre erreur à la liste", () => {
    const { erreurs } = parseConfig(
      { A: { type: "int", validate: (v: number) => (v % 2 ? "doit être pair" : undefined) }, B: { type: "int", required: true } },
      { A: "3" },
    );
    expect(erreurs).toEqual([
      { variable: "A", erreur: "doit être pair" },
      { variable: "B", erreur: "obligatoire, absente ou vide" },
    ]);
  });
});

describe("service-kit/config — succès et journal expurgé", () => {
  const ENV = {
    DATABASE_URL: DB,
    PORT: "4318",
    REQUIRE_API_KEY: "true",
    METRICS_TOKEN: "x".repeat(40),
    MIP_CONSOLE_URL: "https://admin:pw@console.example/chemin?jeton=abc",
    SIGNAUX: " traces , logs ,, ",
  };

  it("convertit les types et fige l'objet", () => {
    const { config, exit } = lancer(ENV);
    expect(exit).not.toHaveBeenCalled();
    expect(config).toMatchObject({ PORT: 4318, PGPOOL_MAX: 4, REQUIRE_API_KEY: true, LOG_LEVEL: "info", SIGNAUX: ["traces", "logs"] });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.DATABASE_URL).toBe(DB); // le service, lui, reçoit la vraie valeur
  });

  it("le journal de démarrage ne contient AUCUNE valeur secrète", () => {
    const { lignes, texte } = lancer(ENV);
    const charge = lignes.find((l) => l.msg === "configuration chargée")!;
    expect(charge.champs.config.DATABASE_URL).toBe("[secret]");
    expect(charge.champs.config.METRICS_TOKEN).toBe("[secret]");
    expect(texte).not.toContain("MotDePasseTresSecret");
    expect(texte).not.toContain("x".repeat(40));
    // une URL non secrète perd ses identifiants et ses paramètres
    expect(charge.champs.config.MIP_CONSOLE_URL).toBe("https://console.example/chemin?…");
    expect(texte).not.toContain("pw@");
    expect(texte).not.toContain("jeton=abc");
    // et on voit ce qui tourne sur un défaut du code
    expect(charge.champs.defauts).toEqual(expect.arrayContaining(["PGPOOL_MAX", "LOG_LEVEL"]));
  });

  it("redactConfig signale un secret absent sans l'inventer", () => {
    expect(redactConfig(SCHEMA, { DATABASE_URL: undefined }).DATABASE_URL).toBe("(absente)");
  });
});

describe("service-kit/config — --print-env-example", () => {
  it("écrit le gabarit tiré du schéma et sort en 0, sans rien valider", () => {
    const { imprime, exit, lignes } = lancer({}, ["node", "server.mjs", "--print-env-example"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(lignes).toHaveLength(0);
    const t = imprime.join("");
    expect(t).toMatch(/# Postgres \(obligatoire ; secret\)\nDATABASE_URL=\n/);
    expect(t).toMatch(/# Port d'écoute \(défaut : 8080\)\n# PORT=8080\n/);
    expect(t).toMatch(/valeurs : debug, info, warn, error/);
    expect(t).toMatch(/# METRICS_TOKEN=\n/); // facultatif, commenté, et sans valeur d'exemple
  });

  it("COMMON_ENV se valide seul et se documente", () => {
    expect(parseConfig(COMMON_ENV, {}).erreurs).toEqual([]);
    expect(envExample(COMMON_ENV, { service: "collector" })).toContain("RAILWAY_DEPLOYMENT_DRAINING_SECONDS");
  });
});
