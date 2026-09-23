// P1 — le migrateur durci, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · qu'une base NEUVE se construit entière par le migrateur seul — schéma,
//     81 fichiers, et les cinq scripts de pré-déploiement passés AVANT leur
//     migration, index valides ;
//   · qu'une relance ne fait RIEN : ni fichier appliqué, ni connexion directe ;
//   · que l'ordre est numérique : v1000 dépend d'une table créée par v900, et
//     ne passerait pas sous le tri lexical (qui range v1000 avant v900) ;
//   · qu'un index INVALIDE laissé par un CREATE INDEX CONCURRENTLY interrompu
//     est supprimé puis reconstruit, au lieu d'être pris pour fait ;
//   · qu'un échec définitif du pré-déploiement ne laisse ni index invalide ni
//     migration appliquée ;
//   · qu'une attente de verrou expirée est reprise, et qu'un verrou des
//     migrations tenu ailleurs arrête le pré-déploiement au bout des essais ;
//   · qu'une MIGRATION_DATABASE_URL qui désigne une autre base est refusée.
//
// Le test crée ses PROPRES bases jetables à côté de SQL_TEST_DATABASE_URL
// (l'utilisateur doit pouvoir `create database`, c'est le cas en CI) : un
// migrateur se prouve sur une base vierge, pas sur celle que les autres suites
// ont déjà migrée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { DOSSIER_SQL, fichiersMigration, main, migrer } from "../../packages/db/migrate.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const suffixe = `${process.pid}_${Date.now().toString(36)}`;
const BASE = `mip_migrateur_${suffixe}`;
const AUTRE = `mip_migrateur_autre_${suffixe}`;
const versBase = (nom: string) => {
  const u = new URL(url ?? "postgres://localhost/x");
  u.pathname = `/${nom}`;
  return u.toString();
};
const URL_BASE = versBase(BASE);
const URL_AUTRE = versBase(AUTRE);

let admin: pg.Client;
let pool: pg.Pool;
let tmp: string;
const VERROU_MIGRATION = 811_100;

type Ligne = { niveau: string; msg: string; champs?: Record<string, unknown> };
function journalEspion() {
  const lignes: Ligne[] = [];
  const at = (niveau: string) => (msg: string, champs?: Record<string, unknown>) => lignes.push({ niveau, msg, champs });
  return { journal: { info: at("info"), warn: at("warn"), error: at("error") }, lignes };
}

/** Une connexion DÉDIÉE, comme celle que `main()` ouvre sur MIGRATION_DATABASE_URL. */
const directeVers = (u: string) => async () => {
  const c = new pg.Client({ connectionString: u });
  await c.connect();
  return c;
};

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as T[];
const etatIndex = (nom: string) =>
  q<{ valide: boolean; pret: boolean }>(
    "select indisvalid as valide, indisready as pret from pg_index where indexrelid = to_regclass($1)",
    [nom],
  );
const appliquee = async (nom: string) =>
  (await q("select 1 from schema_migration where filename = $1", [nom])).length === 1;

beforeAll(async () => {
  if (!url) return;
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${BASE}`);
  await admin.query(`create database ${AUTRE}`);
  pool = new pg.Pool({ connectionString: URL_BASE, max: 4 });
  tmp = mkdtempSync(join(tmpdir(), "migrateur-durci-sql-"));
  cpSync(DOSSIER_SQL, tmp, { recursive: true });
});

afterAll(async () => {
  if (!url) return;
  await pool?.end().catch(() => {});
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  await admin.query(`drop database if exists ${BASE} with (force)`).catch(() => {});
  await admin.query(`drop database if exists ${AUTRE} with (force)`).catch(() => {});
  await admin.end().catch(() => {});
});

suite("P1 — migrateur : base neuve, relance, ordre numérique", () => {
  it("construit une base neuve entière, pré-déploiements compris, index valides", async () => {
    // `main()` : le vrai programme, avec la connexion directe qu'il ouvre lui-même.
    expect(await main({ argv: [], env: { DATABASE_URL: URL_BASE, MIGRATION_DATABASE_URL: URL_BASE } })).toBe(0);
    const fichiers = await fichiersMigration();
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from schema_migration");
    expect(n).toBe(fichiers.length);
    const index = await q<{ nom: string; valide: boolean; pret: boolean }>(
      `select c.relname as nom, i.indisvalid as valide, i.indisready as pret
         from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname in ('idx_rum_event_explorer_v68', 'idx_rum_event_props_v68',
          'idx_rum_event_index_app_session_v68', 'idx_rum_error_fingerprint_ts_v72', 'idx_rum_event_app_ts_v80',
          'idx_rum_event_app_release_ts_v80', 'idx_rum_event_app_env_ts_v80', 'idx_ingest_raw_app_a_faire_v81',
          'idx_session_app_runtime_v82')`,
    );
    expect(index).toHaveLength(9);
    expect(index.every((i) => i.valide && i.pret)).toBe(true);
  });

  it("une relance n'applique rien et n'ouvre aucune connexion directe", async () => {
    const { journal, lignes } = journalEspion();
    let ouvertures = 0;
    const r = await migrer(pool, {
      journal,
      ouvrirDirecte: async () => {
        ouvertures++;
        return directeVers(URL_BASE)();
      },
    });
    expect(r.appliquees).toEqual([]);
    expect(r.predeployes).toEqual([]);
    expect(ouvertures).toBe(0);
    expect(lignes.map((l) => l.msg)).toEqual(["migrations à jour"]);
  });

  it("applique v900 puis v1000 dans l'ordre NUMÉRIQUE", async () => {
    writeFileSync(
      join(tmp, "migration-v900.sql"),
      `create table migrateur_t (id bigserial primary key, v int not null);
       insert into migrateur_t (v) select g % 10 from generate_series(1, 2000) g;`,
    );
    // Sous le tri lexical, v1000 passerait AVANT v900 et échouerait : la table n'existerait pas.
    writeFileSync(join(tmp, "migration-v1000.sql"), "alter table migrateur_t add column if not exists w int;");
    expect((await fichiersMigration(tmp)).slice(-2)).toEqual(["migration-v900.sql", "migration-v1000.sql"]);
    const { journal } = journalEspion();
    const r = await migrer(pool, { dossier: tmp, journal });
    expect(r.appliquees).toEqual(["migration-v900.sql", "migration-v1000.sql"]);
  });
});

suite("P1 — migrateur : pré-déploiement", () => {
  it("supprime puis reconstruit un index INVALIDE, puis applique la migration", async () => {
    // Un CREATE UNIQUE INDEX CONCURRENTLY sur des doublons échoue et laisse
    // l'index au catalogue, invalide : exactement ce qu'un pré-déploiement
    // interrompu laisse derrière lui.
    await expect(q("create unique index concurrently idx_migrateur_v1001 on migrateur_t (v)")).rejects.toThrow();
    expect(await etatIndex("idx_migrateur_v1001")).toEqual([{ valide: false, pret: false }]);

    writeFileSync(
      join(tmp, "predeploy-v1001-indexes.sql"),
      `-- un « ; » dans un commentaire ne coupe rien ;
       alter table migrateur_t add column if not exists x text default 'a;b';
       create index concurrently if not exists idx_migrateur_v1001 on migrateur_t (v);`,
    );
    writeFileSync(
      join(tmp, "migration-v1001.sql"),
      `do $$ begin
         if to_regclass('public.idx_migrateur_v1001') is null then raise exception 'v1001: précréer l''index'; end if;
       end $$;
       create index if not exists idx_migrateur_v1001 on migrateur_t (v);`,
    );
    const { journal, lignes } = journalEspion();
    const r = await migrer(pool, { dossier: tmp, journal, ouvrirDirecte: directeVers(URL_BASE) });
    expect(r.predeployes).toEqual(["predeploy-v1001-indexes.sql"]);
    expect(r.appliquees).toEqual(["migration-v1001.sql"]);
    expect(await etatIndex("idx_migrateur_v1001")).toEqual([{ valide: true, pret: true }]);
    expect(lignes.some((l) => l.msg.includes("index INVALIDE — suppression puis reconstruction"))).toBe(true);
    // Le pré-déploiement passe AVANT la migration, jamais après.
    const iPre = lignes.findIndex((l) => l.msg === "pré-déploiement : index construit");
    const iMig = lignes.findIndex((l) => l.msg === "migration appliquée");
    expect(iPre).toBeGreaterThanOrEqual(0);
    expect(iPre).toBeLessThan(iMig);
    // Le verrou de session est rendu : personne ne le tient plus.
    const [{ tenu }] = await q<{ tenu: boolean }>(
      "select exists (select 1 from pg_locks where locktype = 'advisory' and objid = $1) as tenu",
      [VERROU_MIGRATION],
    );
    expect(tenu).toBe(false);
  });

  it("un échec définitif ne laisse ni index invalide, ni migration appliquée", async () => {
    writeFileSync(
      join(tmp, "predeploy-v1002-indexes.sql"),
      "create unique index concurrently if not exists idx_migrateur_v1002 on migrateur_t (v);",
    );
    writeFileSync(join(tmp, "migration-v1002.sql"), "select 1002;");
    const { journal } = journalEspion();
    await expect(migrer(pool, { dossier: tmp, journal, ouvrirDirecte: directeVers(URL_BASE) })).rejects.toMatchObject({
      code: "23505",
    });
    expect(await etatIndex("idx_migrateur_v1002")).toEqual([]);
    expect(await appliquee("migration-v1002.sql")).toBe(false);
    rmSync(join(tmp, "predeploy-v1002-indexes.sql"));
    rmSync(join(tmp, "migration-v1002.sql"));
  });

  it("un verrou des migrations tenu ailleurs arrête le pré-déploiement au bout des essais", async () => {
    writeFileSync(
      join(tmp, "predeploy-v1003-indexes.sql"),
      "create index concurrently if not exists idx_migrateur_v1003 on migrateur_t (id, v);",
    );
    writeFileSync(join(tmp, "migration-v1003.sql"), "select 1003;");
    const autre = await pool.connect();
    await autre.query("select pg_advisory_lock($1)", [VERROU_MIGRATION]);
    try {
      const { journal, lignes } = journalEspion();
      await expect(
        migrer(pool, {
          dossier: tmp,
          journal,
          ouvrirDirecte: directeVers(URL_BASE),
          delais: { verrouEssais: 3, verrouPauseMs: 20 },
        }),
      ).rejects.toThrow(/toujours tenu après 3 essais/);
      expect(lignes.filter((l) => l.msg.includes("verrou des migrations tenu ailleurs"))).toHaveLength(3);
      expect(await appliquee("migration-v1003.sql")).toBe(false);
    } finally {
      await autre.query("select pg_advisory_unlock($1)", [VERROU_MIGRATION]);
      autre.release();
    }
    // Verrou rendu : la même course passe.
    const { journal } = journalEspion();
    const r = await migrer(pool, { dossier: tmp, journal, ouvrirDirecte: directeVers(URL_BASE) });
    expect(r.appliquees).toEqual(["migration-v1003.sql"]);
  });

  it("refuse une connexion directe qui désigne une AUTRE base", async () => {
    writeFileSync(
      join(tmp, "predeploy-v1004-indexes.sql"),
      "create index concurrently if not exists idx_migrateur_v1004 on migrateur_t (v, id);",
    );
    writeFileSync(join(tmp, "migration-v1004.sql"), "select 1004;");
    const { journal } = journalEspion();
    await expect(migrer(pool, { dossier: tmp, journal, ouvrirDirecte: directeVers(URL_AUTRE) })).rejects.toThrow(
      /ne désigne pas la même base/,
    );
    expect(await appliquee("migration-v1004.sql")).toBe(false);
    expect(await etatIndex("idx_migrateur_v1004")).toEqual([]);
    rmSync(join(tmp, "predeploy-v1004-indexes.sql"));
    rmSync(join(tmp, "migration-v1004.sql"));
  });
});

suite("P1 — migrateur : lock_timeout et reprises", () => {
  it("reprend un fichier dont l'attente de verrou a expiré, puis l'applique", async () => {
    writeFileSync(join(tmp, "migration-v1005.sql"), "alter table migrateur_t add column if not exists y int;");
    const bloqueur = await pool.connect();
    await bloqueur.query("begin");
    await bloqueur.query("lock table migrateur_t in access exclusive mode");
    const liberation = new Promise<void>((resolve) =>
      setTimeout(() => {
        bloqueur
          .query("commit")
          .then(() => bloqueur.release())
          .then(resolve, resolve);
      }, 700),
    );
    try {
      const { journal, lignes } = journalEspion();
      const r = await migrer(pool, {
        dossier: tmp,
        journal,
        delais: { lockTimeoutMs: 200, attenteMs: 50 },
      });
      expect(r.appliquees).toEqual(["migration-v1005.sql"]);
      const reprises = lignes.filter((l) => l.msg === "verrou non obtenu à temps — nouvel essai");
      expect(reprises.length).toBeGreaterThanOrEqual(1);
      expect(reprises[0].champs).toMatchObject({ nom: "migration-v1005.sql", essai: 1, code: "55P03" });
    } finally {
      await liberation;
    }
  });
});
