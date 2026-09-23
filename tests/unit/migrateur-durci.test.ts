// P1 — le migrateur durci (`@mip/db/migrate.mjs`), sans base de données.
//
// Ce que ces tests tiennent, et qui ne se verrait sinon qu'en production :
//
//   · l'ORDRE : numérique, v100 après v99. Le tri lexical rangeait v100 entre
//     v10 et v11 ; il n'aurait cassé que sur une base vierge, le jour du
//     centième fichier ;
//   · le PÉRIMÈTRE : `fichiersMigration()` ne rend que `schema.sql` et les
//     `migration-vNN.sql` — ni `pending/` (une migration qui SUPPRIME des
//     tables y attend), ni les `predeploy-*`, qui passent hors transaction ;
//   · les REPRISES : une attente de verrou expirée rejoue le fichier, un nombre
//     borné de fois, chaque reprise journalisée ; toute autre erreur arrête ;
//   · la BASE À JOUR : aucune connexion directe ouverte, aucun script lu.
//
// La preuve sur un vrai PostgreSQL (base neuve, relance, index invalide
// reconstruit, lock_timeout) est dans tests/integration/migrateur-durci-sql.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  DELAIS,
  DOSSIER_SQL,
  decouperSql,
  empreinte,
  estAttenteDeVerrou,
  estPooler,
  fichiersMigration,
  fichiersPredeploiement,
  indexConcurrent,
  migrer,
  numeroMigration,
  trierMigrations,
} from "../../packages/db/migrate.mjs";

const temporaires: string[] = [];
afterAll(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});

/** Un dossier `sql/` factice : `{ nom: contenu }`, un nom avec « / » crée le sous-dossier. */
function dossier(fichiers: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "migrateur-durci-"));
  temporaires.push(d);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    if (nom.includes("/")) mkdirSync(join(d, nom.split("/")[0]), { recursive: true });
    writeFileSync(join(d, nom), contenu);
  }
  return d;
}

describe("migrate — ordre et périmètre des fichiers", () => {
  it("trie par numéro : v100 passe après v99, et v9 avant v10", () => {
    expect(
      trierMigrations(["migration-v100.sql", "migration-v10.sql", "migration-v99.sql", "migration-v9.sql", "migration-v02.sql"]),
    ).toEqual(["migration-v02.sql", "migration-v9.sql", "migration-v10.sql", "migration-v99.sql", "migration-v100.sql"]);
  });

  // Deux fichiers au même numéro : lequel passerait en premier serait un
  // accident de nommage, et les deux seraient appliqués.
  it("refuse deux migrations au même numéro", () => {
    expect(() => trierMigrations(["migration-v7.sql", "migration-v07.sql"])).toThrow(/numéro 7/);
  });

  it("lit le numéro d'une migration comme d'un script de pré-déploiement", () => {
    expect(numeroMigration("migration-v100.sql")).toBe(100);
    expect(numeroMigration("predeploy-v68-indexes.sql")).toBe(68);
    expect(numeroMigration("predeploy-v82.sql")).toBe(82);
    expect(numeroMigration("schema.sql")).toBeNull();
    expect(numeroMigration("migration-v44-drop-deprecated-ai.sql")).toBeNull();
  });

  it("ne liste que schema.sql puis les migration-vNN.sql, dans l'ordre numérique", async () => {
    const d = dossier({
      "schema.sql": "",
      "migration-v100.sql": "",
      "migration-v99.sql": "",
      "migration-v10.sql": "",
      "migration-v02.sql": "",
      "predeploy-v100-indexes.sql": "",
      "pending/migration-v101.sql": "",
      "migration-v44-drop-deprecated-ai.sql": "",
      "migration-v05.sql.bak": "",
      "README.md": "",
    });
    expect(await fichiersMigration(d)).toEqual([
      "schema.sql",
      "migration-v02.sql",
      "migration-v10.sql",
      "migration-v99.sql",
      "migration-v100.sql",
    ]);
  });

  it("le dossier réel : schema.sql d'abord, puis des numéros strictement croissants, rien d'autre", async () => {
    const fichiers = await fichiersMigration();
    expect(fichiers[0]).toBe("schema.sql");
    const reste = fichiers.slice(1);
    for (const nom of reste) expect(nom).toMatch(/^migration-v\d+\.sql$/);
    const numeros = reste.map((n) => numeroMigration(n) as number);
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    expect(new Set(numeros).size).toBe(numeros.length);
    // Tout migration-vNN.sql du dossier est retenu ; ni pending/ ni predeploy-*.
    const attendus = readdirSync(DOSSIER_SQL).filter((n) => /^migration-v\d+\.sql$/.test(n));
    expect(reste).toHaveLength(attendus.length);
    expect(fichiers.some((n) => n.startsWith("predeploy-") || n.includes("pending"))).toBe(false);
  });

  it("range les scripts de pré-déploiement par numéro, dans l'ordre de leur nom", async () => {
    const d = dossier({
      "predeploy-v100-b.sql": "",
      "predeploy-v100-a.sql": "",
      "predeploy-v68-indexes.sql": "",
      "migration-v68.sql": "",
      "pending/predeploy-v101-x.sql": "",
    });
    const parNumero = await fichiersPredeploiement(d);
    expect([...parNumero.entries()].sort(([a], [b]) => a - b)).toEqual([
      [68, ["predeploy-v68-indexes.sql"]],
      [100, ["predeploy-v100-a.sql", "predeploy-v100-b.sql"]],
    ]);
  });

  // Un script orphelin ne serait jamais passé : le migrateur ne lit les
  // pré-déploiements que pour une migration EN ATTENTE de même numéro.
  it("le dossier réel : chaque predeploy-vNN a sa migration-vNN, et nomme ses index", async () => {
    const migrations = new Set((await fichiersMigration()).map(numeroMigration));
    const parNumero = await fichiersPredeploiement();
    expect(parNumero.size).toBeGreaterThan(0);
    for (const [numero, scripts] of parNumero) {
      expect(migrations.has(numero)).toBe(true);
      for (const nom of scripts) {
        const instructions = decouperSql(readFileSync(join(DOSSIER_SQL, nom), "utf8"));
        const index = instructions.map(indexConcurrent).filter(Boolean);
        expect(index.length, nom).toBeGreaterThan(0);
      }
    }
  });

  // L'en-tête du migrateur l'affirme : chaque fichier passe dans UNE
  // transaction, ce que CONCURRENTLY interdit. La phrase est désormais tenue.
  it("aucune migration-vNN.sql ne construit d'index CONCURRENTLY", async () => {
    for (const nom of await fichiersMigration()) {
      const instructions = decouperSql(readFileSync(join(DOSSIER_SQL, nom), "utf8"));
      for (const instruction of instructions) {
        expect(/\bconcurrently\b/i.test(instruction), `${nom} : ${instruction.slice(0, 80)}`).toBe(false);
      }
    }
  });
});

describe("migrate — découpage d'un script de pré-déploiement", () => {
  it("coupe sur « ; » et retire les commentaires", () => {
    expect(
      decouperSql(`-- en-tête ; avec un point-virgule
        create index concurrently if not exists a on t (x);
        /* bloc ; /* imbriqué ; */ toujours commentaire ; */
        alter table t add column if not exists y text;`),
    ).toEqual(["create index concurrently if not exists a on t (x)", "alter table t add column if not exists y text"]);
  });

  it("ne coupe ni dans une chaîne, ni dans un identifiant cité, ni dans un corps $$", () => {
    const sql = `insert into t values ('a;b', 'l''apostrophe;');
      select E'échappée \\'; encore', "col;onne" from t;
      do $corps$ begin perform 1; end $corps$;
      do $$ begin perform ';'; end $$`;
    const r = decouperSql(sql);
    expect(r).toHaveLength(4);
    expect(r[0]).toBe("insert into t values ('a;b', 'l''apostrophe;')");
    expect(r[1]).toContain(`E'échappée \\'; encore'`);
    expect(r[1]).toContain(`"col;onne"`);
    expect(r[2]).toBe("do $corps$ begin perform 1; end $corps$");
    expect(r[3]).toBe("do $$ begin perform ';'; end $$");
  });

  it("un script vide ou fait de commentaires ne rend rien", () => {
    expect(decouperSql("-- rien\n/* rien */\n;;")).toEqual([]);
  });

  it("reconnaît un CREATE INDEX CONCURRENTLY et rend son nom tel que le catalogue le range", () => {
    expect(indexConcurrent("create index concurrently if not exists Idx_A on t (x)")).toEqual({
      nom: "idx_a",
      cite: '"idx_a"',
    });
    expect(indexConcurrent('CREATE UNIQUE INDEX CONCURRENTLY "Idx""B" ON t (x)')).toEqual({
      nom: 'Idx"B',
      cite: '"Idx""B"',
    });
    expect(indexConcurrent("create index idx_c on t (x)")).toBeNull();
    expect(indexConcurrent("alter table t add column y int")).toBeNull();
  });

  // Sans nom, ni vérification de validité ni reconstruction ne sont possibles,
  // et chaque reprise créerait un index de plus.
  it("refuse un index CONCURRENTLY sans nom", () => {
    expect(() => indexConcurrent("create index concurrently on t (x)")).toThrow(/doit être nommé/);
  });
});

describe("migrate — connexion directe et verrous", () => {
  it("reconnaît un pooler Neon ou un drapeau pgbouncer, pas une connexion directe", () => {
    expect(estPooler("postgres://u:p@ep-royal-bread-b2l7ri61-pooler.eu-central-1.aws.neon.tech/neondb")).toBe(true);
    expect(estPooler("postgres://u:p@db.local:6432/mip?pgbouncer=true")).toBe(true);
    expect(estPooler("postgres://u:p@ep-royal-bread-b2l7ri61.eu-central-1.aws.neon.tech/neondb")).toBe(false);
    expect(estPooler("postgres://postgres:postgres@localhost:55434/mip")).toBe(false);
    expect(estPooler("pas une url")).toBe(false);
  });

  it("ne reprend que sur une attente de verrou expirée ou un interblocage", () => {
    expect(estAttenteDeVerrou({ code: "55P03" })).toBe(true);
    expect(estAttenteDeVerrou({ code: "40P01" })).toBe(true);
    expect(estAttenteDeVerrou({ code: "42P01" })).toBe(false);
    expect(estAttenteDeVerrou(new Error("x"))).toBe(false);
    expect(estAttenteDeVerrou(null)).toBe(false);
  });

  it("lock_timeout de 2 à 3 s, reprises bornées", () => {
    expect(DELAIS.lockTimeoutMs).toBeGreaterThanOrEqual(2_000);
    expect(DELAIS.lockTimeoutMs).toBeLessThanOrEqual(3_000);
    expect(DELAIS.tentatives).toBeGreaterThan(1);
    expect(DELAIS.tentatives).toBeLessThanOrEqual(10);
  });
});

// Un faux PostgreSQL : juste assez pour suivre le chemin de `migrer()`. Chaque
// requête est journalisée ; `echecs` fait échouer les N premières exécutions
// d'un SQL donné avec le code voulu.
function fauxPool({
  registre = [] as Array<{ filename: string; checksum: string }>,
  echecs = new Map<string, { code: string; fois: number }>(),
} = {}) {
  const requetes: string[] = [];
  const client = {
    on: vi.fn(),
    off: vi.fn(),
    release: vi.fn(),
    async query(sql: string) {
      requetes.push(sql);
      const echec = echecs.get(sql);
      if (echec && echec.fois > 0) {
        echec.fois--;
        throw Object.assign(new Error(`échec simulé ${echec.code}`), { code: echec.code });
      }
      if (/select filename, checksum from schema_migration/.test(sql)) return { rows: registre, rowCount: registre.length };
      if (/select 1 from schema_migration where filename/.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into schema_migration/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool: { connect: async () => client }, client, requetes };
}

function journalEspion() {
  const lignes: Array<{ niveau: string; msg: string; champs?: Record<string, unknown> }> = [];
  const at = (niveau: string) => (msg: string, champs?: Record<string, unknown>) => lignes.push({ niveau, msg, champs });
  return { journal: { info: at("info"), warn: at("warn"), error: at("error") }, lignes };
}

describe("migrate — reprises sur attente de verrou (faux PostgreSQL)", () => {
  const d = dossier({
    "migration-v01.sql": "alter table t add column a int;",
    "migration-v02.sql": "alter table t add column b int;",
  });

  it("rejoue un fichier dont l'attente de verrou a expiré, et le journalise", async () => {
    const { pool, requetes } = fauxPool({
      echecs: new Map([["alter table t add column b int;", { code: "55P03", fois: 2 }]]),
    });
    const { journal, lignes } = journalEspion();
    const attendre = vi.fn(async () => {});
    const r = await migrer(pool as never, { dossier: d, journal, attendre });
    expect(r.appliquees).toEqual(["migration-v01.sql", "migration-v02.sql"]);
    // 1 s puis 2 s : la pause double à chaque reprise.
    expect(attendre.mock.calls).toEqual([[1000], [2000]]);
    const reprises = lignes.filter((l) => l.msg.startsWith("verrou non obtenu"));
    expect(reprises.map((l) => l.champs)).toEqual([
      { nom: "migration-v02.sql", essai: 1, tentatives: 5, attente_ms: 1000, code: "55P03" },
      { nom: "migration-v02.sql", essai: 2, tentatives: 5, attente_ms: 2000, code: "55P03" },
    ]);
    // Chaque tentative pose son lock_timeout DANS sa transaction, après le
    // verrou des migrations, et chaque échec est annulé.
    expect(requetes.filter((q) => q === "rollback")).toHaveLength(2);
    const i = requetes.indexOf("select pg_advisory_xact_lock($1)");
    expect(requetes[i + 1]).toMatch(/set_config\('lock_timeout', \$1, true\)/);
  });

  it("abandonne après le nombre de tentatives, et le dit", async () => {
    const { pool } = fauxPool({
      echecs: new Map([["alter table t add column a int;", { code: "55P03", fois: 99 }]]),
    });
    const { journal, lignes } = journalEspion();
    const attendre = vi.fn(async () => {});
    await expect(migrer(pool as never, { dossier: d, journal, attendre, delais: { tentatives: 3 } })).rejects.toMatchObject({
      code: "55P03",
    });
    expect(attendre).toHaveBeenCalledTimes(2);
    expect(lignes.at(-1)).toMatchObject({ niveau: "error", msg: expect.stringContaining("migration échouée") });
  });

  it("n'insiste pas sur une erreur qui n'est pas une attente de verrou", async () => {
    const { pool } = fauxPool({
      echecs: new Map([["alter table t add column a int;", { code: "42P01", fois: 1 }]]),
    });
    const { journal } = journalEspion();
    const attendre = vi.fn(async () => {});
    await expect(migrer(pool as never, { dossier: d, journal, attendre })).rejects.toMatchObject({ code: "42P01" });
    expect(attendre).not.toHaveBeenCalled();
  });
});

describe("migrate — pré-déploiement (faux PostgreSQL)", () => {
  const d = dossier({
    "migration-v68.sql": "select 68;",
    "predeploy-v68-indexes.sql": "create index concurrently if not exists idx_a_v68 on t (x);",
  });

  // Le cas de la production aujourd'hui : tout est appliqué.
  it("une base à jour n'ouvre aucune connexion directe et ne touche à rien", async () => {
    const { pool, requetes } = fauxPool({
      registre: [{ filename: "migration-v68.sql", checksum: empreinte("select 68;") }],
    });
    const ouvrirDirecte = vi.fn();
    const { journal, lignes } = journalEspion();
    const r = await migrer(pool as never, { dossier: d, journal, ouvrirDirecte });
    expect(ouvrirDirecte).not.toHaveBeenCalled();
    expect(r).toEqual({ appliquees: [], modifies: [], total: 1, predeployes: [] });
    expect(requetes.some((q) => /advisory|concurrently|begin/.test(q))).toBe(false);
    expect(lignes).toEqual([
      { niveau: "info", msg: "migrations à jour", champs: { total: 1, appliquees: 0, modifiees: 0 } },
    ]);
  });

  it("sans connexion directe fiable, saute le script en le disant, et migre quand même", async () => {
    const { pool, requetes } = fauxPool();
    const { journal, lignes } = journalEspion();
    const r = await migrer(pool as never, { dossier: d, journal, ouvrirDirecte: null });
    expect(r.appliquees).toEqual(["migration-v68.sql"]);
    expect(r.predeployes).toEqual([]);
    expect(lignes.some((l) => l.niveau === "warn" && l.msg.startsWith("pré-déploiement sauté"))).toBe(true);
    expect(requetes.some((q) => /concurrently/.test(q))).toBe(false);
    // La garde des index invalides passe quand même, sur la connexion du migrateur.
    expect(requetes.some((q) => /unnest\(\$1::text\[\]\)/.test(q))).toBe(true);
  });
});
