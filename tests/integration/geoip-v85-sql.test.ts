// P8.7 — migration-v85 et provenance du pays, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · que v85 se rejoue sans effet, et que sa contrainte accepte exactement les
//     trois provenances de l'ingestion, refuse une version de base sans GeoIP,
//     et refuse une provenance sans pays ;
//   · qu'un lot réel écrit le pays ET sa provenance dans le même geste, pour les
//     trois origines (base locale, fuseau, en-tête CDN) ;
//   · QU'UNE SESSION DÉJÀ ENREGISTRÉE N'EST JAMAIS RÉÉCRITE par une adresse
//     d'aujourd'hui — ni son pays, ni sa provenance, ni la version de base ;
//   · qu'un lot différé (table de débarquement) porte les mêmes colonnes ;
//   · que purge, effacements et export DSAR les emportent, SANS qu'aucune table
//     n'ait été ajoutée : `DSAR_CHILD_TABLES` est inchangée, et c'est vérifié ;
//   · qu'AUCUNE colonne de ce schéma ne stocke une adresse IP ;
//   · enfin, sur une seconde base restée en v83, que le même code écrit pendant
//     la fenêtre de déploiement, puis écrit la provenance dès v85 appliquée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_PRE_V85_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
import { DSAR_ANCHOR, DSAR_CHILD_TABLES } from "../../apps/console/lib/dsar";
import type { IdentityDsarIo } from "../../apps/console/lib/queries-dsar";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { appliquerGeo } from "../../apps/ingest/supabase/functions/_shared/geoip.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlFenetre = process.env.SQL_TEST_PRE_V85_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const poolFenetre = new pg.Pool(urlFenetre ? { connectionString: urlFenetre, max: 4 } : { max: 4 });

const A = "p87-a";
const DIFFERE = "p87-differe";
const EFFACEMENT = "p87-effacement";
const BORNES = "p87-bornes";
const FENETRE = "p87-fenetre";
const APPS = [A, DIFFERE, EFFACEMENT, BORNES];
const SECRET = "test-only-identity-secret";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const VERSION_BASE = "dbip-country-lite-2026-09";
const muet = { info() {}, warn() {}, error() {} };

/** Tables écrites par ces lots, enfants avant parents. */
const TABLES_APP = [
  "ingest_raw", "rum_event_index", "rum_metric", "rum_error", "rum_pageview", "rum_session",
];

type Attrs = Record<string, unknown>;
type Signal = Omit<EmitSpan, "startTime" | "endTime">;

let compteur = 0;
const nouveauSpan = () => (0x8700000000000000n + BigInt(++compteur)).toString(16);

function migrations(maxVersion = Number.POSITIVE_INFINITY): string[] {
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f) && Number(f.match(/\d+/)![0]) <= maxVersion)
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))]
    .map((f) => join(SQL_DIR, f));
}

async function nettoyer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    for (const table of TABLES_APP) await db.query(`delete from ${table} where app_id = $1`, [app]);
  }
}

async function enregistrer(db: pg.Pool, apps: string[]) {
  for (const app of apps) {
    await db.query(
      "insert into app_registry (app_id,name,active) values ($1,$1,true) on conflict (app_id) do update set active=true",
      [app],
    );
  }
}

const web = (app: string, over: Attrs = {}): Attrs => ({
  "service.name": "mip-rum-web",
  "mip.app_id": app,
  "mip.user_agent": CHROME,
  "deployment.environment.name": "production",
  ...over,
});

function pageview(session: string, attributes: Attrs = {}): Signal {
  return {
    name: "pageview",
    traceId: TRACE,
    spanId: nouveauSpan(),
    attributes: {
      "mip.session_id": session,
      "mip.route": "/panier",
      "mip.device_type": "desktop",
      "mip.visitor_id": `visiteur-${session}`,
      "mip.url": "https://app.exemple.fr/panier",
      "mip.nav_type": "navigate",
      ...attributes,
    },
  };
}

function ressource(attrs: Attrs, spans: Signal[], ms = Date.now() - 1_000) {
  const t = msToHr(ms);
  return (buildResourceSpans(attrs, spans.map((s) => ({ ...s, startTime: t, endTime: t }))) as { resourceSpans: unknown[] })
    .resourceSpans[0];
}

function aplatir(...resourceSpans: unknown[]) {
  return flattenOtlp(secureOtlpIdentities({ resourceSpans }, SECRET).payload);
}

/** Un lot, avec la géo appliquée comme le receveur le fait avant d'écrire. */
function lot(app: string, session: string, attrs: Attrs, geo: { geoip?: unknown; cdn?: string | null } = {}) {
  const rows = aplatir(ressource(web(app), [pageview(session, attrs)]));
  appliquerGeo(rows.sessions, geo);
  return rows;
}

const geoOf = async (db: pg.Pool, session: string) => (await db.query(
  "select geo_country, geo_source, geo_db_version from rum_session where session_id = $1",
  [session],
)).rows[0];

const suite = url ? describe : describe.skip;
const suiteFenetre = urlFenetre ? describe : describe.skip;

suite("migration-v85 et provenance du pays — PostgreSQL", () => {
  let dsarIdentityExport: typeof import("../../apps/console/lib/queries-dsar").dsarIdentityExport;

  const lire = async <T,>(text: string, params: unknown[]) => (await pool.query(text, params)).rows as T[];
  const io: IdentityDsarIo = {
    query: lire as IdentityDsarIo["query"],
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const resultat = await fn(client);
        await client.query("commit");
        return resultat;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };

  beforeAll(async () => {
    for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    await enregistrer(pool, APPS);
    await nettoyer(pool, APPS);
    _resetColonnesCache();
    ({ dsarIdentityExport } = await import("../../apps/console/lib/queries-dsar"));
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool, APPS);
    for (const app of APPS) await pool.query("delete from app_registry where app_id = $1", [app]);
    await pool.end();
  });

  describe("la migration elle-même", () => {
    it("se rejoue sans effet : deux colonnes, une contrainte, aucun index", async () => {
      const sql = readFileSync(join(SQL_DIR, "migration-v85.sql"), "utf8");
      await pool.query(sql);
      await pool.query(sql);
      const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'rum_session' and column_name in ('geo_source','geo_db_version') order by 1`,
      );
      expect(rows).toEqual([
        { column_name: "geo_db_version", data_type: "text", is_nullable: "YES" },
        { column_name: "geo_source", data_type: "text", is_nullable: "YES" },
      ]);
      const contraintes = await pool.query(
        "select conname, convalidated from pg_constraint where conname = 'rum_session_geo_v85'",
      );
      expect(contraintes.rows).toEqual([{ conname: "rum_session_geo_v85", convalidated: false }]);
      // Aucun index n'est créé par ce lot : trois valeurs et NULL n'en méritent pas.
      const index = await pool.query("select indexname from pg_indexes where indexname like '%v85%'");
      expect(index.rows).toEqual([]);
    }, 120_000);

    it("la contrainte accepte les trois provenances et refuse tout le reste", async () => {
      const inserer = (over: Record<string, unknown>) => pool.query(
        `insert into rum_session (session_id, app_id, geo_country, geo_source, geo_db_version, last_seen_at)
         values ($1,$2,$3,$4,$5, now())`,
        [over.id, BORNES, over.pays ?? null, over.source ?? null, over.version ?? null],
      );
      await expect(inserer({ id: "b-geoip", pays: "FR", source: "geoip", version: VERSION_BASE })).resolves.toBeTruthy();
      await expect(inserer({ id: "b-tz", pays: "FR", source: "timezone" })).resolves.toBeTruthy();
      await expect(inserer({ id: "b-cdn", pays: "FR", source: "cdn" })).resolves.toBeTruthy();
      await expect(inserer({ id: "b-rien" })).resolves.toBeTruthy();

      // Une provenance inconnue de l'ingestion.
      await expect(inserer({ id: "b-x", pays: "FR", source: "satellite" })).rejects.toThrow(/rum_session_geo_v85/);
      // Une version de base sans résolution locale : elle laisserait croire qu'une base a répondu.
      await expect(inserer({ id: "b-vtz", pays: "FR", source: "timezone", version: VERSION_BASE }))
        .rejects.toThrow(/rum_session_geo_v85/);
      // Une version qui n'est pas une livraison DB-IP nommée.
      await expect(inserer({ id: "b-vx", pays: "FR", source: "geoip", version: "maxmind-2026" }))
        .rejects.toThrow(/rum_session_geo_v85/);
      // Une provenance sans pays ne veut rien dire.
      await expect(inserer({ id: "b-sanspays", source: "geoip" })).rejects.toThrow(/rum_session_geo_v85/);
      await nettoyer(pool, [BORNES]);
    });

    it("AUCUNE colonne du schéma ne stocke une adresse IP", async () => {
      const { rows } = await pool.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'
            and (column_name ~ '(^|_)ip($|_)' or column_name like '%ip_address%'
                 or column_name like '%latitude%' or column_name like '%longitude%')
          order by 1, 2`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe("un lot réel écrit le pays ET sa provenance", () => {
    it("GeoIP : pays, provenance et livraison de base", async () => {
      const session = "p87-geoip";
      await writeRows(pool, lot(A, session, { "mip.tz": "Europe/Paris" }, {
        geoip: { country: "BE", version: VERSION_BASE },
      }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "BE", geo_source: "geoip", geo_db_version: VERSION_BASE });
    });

    it("fuseau : provenance `timezone`, aucune version de base", async () => {
      const session = "p87-tz";
      await writeRows(pool, lot(A, session, { "mip.tz": "Europe/Paris" }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "FR", geo_source: "timezone", geo_db_version: null });
    });

    it("en-tête CDN : retenu seulement faute de mieux, et étiqueté `cdn`", async () => {
      const session = "p87-cdn";
      await writeRows(pool, lot(A, session, {}, { cdn: "DE" }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "DE", geo_source: "cdn", geo_db_version: null });
    });

    it("rien du tout : pays inconnu, provenance inconnue — jamais un pays par défaut", async () => {
      const session = "p87-rien";
      await writeRows(pool, lot(A, session, {}));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: null, geo_source: null, geo_db_version: null });
    });

    it("un lot DIFFÉRÉ porte les mêmes colonnes après drain", async () => {
      const session = "p87-differe-1";
      await deposerLot(pool, DIFFERE, lot(DIFFERE, session, { "mip.tz": "Europe/Madrid" }, {
        geoip: { country: "PT", version: VERSION_BASE },
      }));
      await drainerIngestRaw(pool, { max: 50, log: muet });
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "PT", geo_source: "geoip", geo_db_version: VERSION_BASE });
    });
  });

  describe("on ne réécrit JAMAIS une ancienne session avec une adresse d'aujourd'hui", () => {
    it("le pays, la provenance et la version restent ceux du premier lot connu", async () => {
      const session = "p87-fige";
      // Premier lot : pays du fuseau, aucune base consultée.
      await writeRows(pool, lot(A, session, { "mip.tz": "Europe/Paris" }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "FR", geo_source: "timezone", geo_db_version: null });

      // Lot suivant de la MÊME session, reçu depuis une autre adresse — un
      // téléphone qui bascule sur le réseau mobile, un VPN qui s'active, une file
      // de retry qui repart d'ailleurs. Rien ne doit bouger : la session a déjà
      // son pays, et l'adresse d'aujourd'hui ne décrit pas la visite d'hier.
      await writeRows(pool, lot(A, session, { "mip.tz": "Europe/Paris" }, {
        geoip: { country: "US", version: VERSION_BASE },
      }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "FR", geo_source: "timezone", geo_db_version: null });
    });

    it("une session sans pays en reçoit un au lot suivant, provenance comprise", async () => {
      const session = "p87-tardif";
      await writeRows(pool, lot(A, session, {}));
      expect(await geoOf(pool, session)).toEqual({ geo_country: null, geo_source: null, geo_db_version: null });
      await writeRows(pool, lot(A, session, {}, { geoip: { country: "IT", version: VERSION_BASE } }));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "IT", geo_source: "geoip", geo_db_version: VERSION_BASE });
    });

    it("un lot d'un émetteur SANS géo n'efface pas la provenance déjà posée", async () => {
      const session = "p87-sansgeo";
      await writeRows(pool, lot(A, session, {}, { geoip: { country: "ES", version: VERSION_BASE } }));
      await writeRows(pool, lot(A, session, {}));
      expect(await geoOf(pool, session))
        .toEqual({ geo_country: "ES", geo_source: "geoip", geo_db_version: VERSION_BASE });
    });
  });

  describe("effacement, purge et DSAR — sans aucune table nouvelle", () => {
    it("DSAR_CHILD_TABLES est INCHANGÉE : v85 n'ajoute aucune table portant session_id", async () => {
      // La preuve demandée par P7.5 : `DSAR_CHILD_TABLES` n'est le bon endroit
      // que pour une table portant un `session_id`. v85 n'ajoute que deux
      // colonnes sur l'ANCRE — il n'y a donc rien à y inscrire, et ce test le
      // montre plutôt que de le supposer.
      const { rows } = await pool.query<{ table_name: string }>(
        `select c.table_name from information_schema.columns c
          join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
         where c.table_schema = 'public' and c.column_name = 'session_id'
         order by 1`,
      );
      const attendues = rows.map((r) => r.table_name).filter((t) => t !== DSAR_ANCHOR);
      expect([...DSAR_CHILD_TABLES].sort()).toEqual(attendues.sort());
      expect([...DSAR_CHILD_TABLES]).not.toContain("rum_session_geo");
    });

    it("purge, effacement de session, effacement d'app et export emportent les colonnes", async () => {
      const session = "p87-efface";
      const hash = hashIdentity(SECRET, EFFACEMENT, "user", "alice@example.test") as string;
      const ecrire = async () => {
        await nettoyer(pool, [EFFACEMENT]);
        await writeRows(pool, lot(EFFACEMENT, session, { "mip.identity.user_id": "alice@example.test" }, {
          geoip: { country: "FR", version: VERSION_BASE },
        }));
      };
      const lignes = async () => Number((await pool.query(
        `select (select count(*) from rum_session where app_id = $1)
              + (select count(*) from rum_pageview where app_id = $1) as n`,
        [EFFACEMENT],
      )).rows[0].n);

      await ecrire();
      const exporte = await dsarIdentityExport(EFFACEMENT, "user", hash, new Date().toISOString(), io);
      // L'export rend la provenance ET la version : une personne qui demande ses
      // données doit voir d'où vient le pays qu'on lui attribue.
      expect(exporte.tables.rum_session).toEqual([
        expect.objectContaining({ geo_country: "FR", geo_source: "geoip", geo_db_version: VERSION_BASE }),
      ]);
      // …et AUCUNE adresse : il n'y en a jamais eu.
      const cles = Object.keys(exporte.tables.rum_session[0] as Record<string, unknown>);
      expect(cles.filter((k) => /(^|_)ip($|_)/.test(k))).toEqual([]);

      await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [EFFACEMENT]);
      expect(await lignes()).toBe(0);
      await ecrire();
      await pool.query("select erase_session($1)", [session]);
      expect(await lignes()).toBe(0);
      await ecrire();
      await pool.query("select erase_app_data($1)", [EFFACEMENT]);
      expect(await lignes()).toBe(0);
    });
  });
});

suiteFenetre("fenêtre de déploiement : code P8.7 sur une base restée en v83", () => {
  beforeAll(async () => {
    await poolFenetre.query("drop schema public cascade; create schema public;");
    for (const file of migrations(83)) await poolFenetre.query(readFileSync(file, "utf8"));
    await enregistrer(poolFenetre, [FENETRE]);
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    await nettoyer(poolFenetre, [FENETRE]);
    await poolFenetre.query("delete from app_registry where app_id = $1", [FENETRE]);
    await poolFenetre.end();
  });

  it("sans les colonnes, le lot passe quand même — GeoIP ne peut pas bloquer l'ingestion", async () => {
    const session = "p87-fenetre-1";
    await writeRows(poolFenetre, lot(FENETRE, session, { "mip.tz": "Europe/Paris" }, {
      geoip: { country: "BE", version: VERSION_BASE },
    }));
    const { rows } = await poolFenetre.query("select geo_country from rum_session where session_id = $1", [session]);
    expect(rows[0]).toEqual({ geo_country: "BE" });
  });

  it("v85 appliquée, le MÊME code écrit la provenance", async () => {
    await poolFenetre.query(readFileSync(join(SQL_DIR, "migration-v85.sql"), "utf8"));
    _resetColonnesCache();
    const session = "p87-fenetre-2";
    await writeRows(poolFenetre, lot(FENETRE, session, {}, { geoip: { country: "BE", version: VERSION_BASE } }));
    const { rows } = await poolFenetre.query(
      "select geo_country, geo_source, geo_db_version from rum_session where session_id = $1",
      [session],
    );
    expect(rows[0]).toEqual({ geo_country: "BE", geo_source: "geoip", geo_db_version: VERSION_BASE });

    // La session écrite AVANT la migration garde un pays sans provenance : c'est
    // exact, on ne sait pas d'où il vient. On ne l'invente pas après coup.
    const avant = await poolFenetre.query(
      "select geo_source from rum_session where session_id = $1", ["p87-fenetre-1"],
    );
    expect(avant.rows[0]).toEqual({ geo_source: null });
  }, 120_000);
});
