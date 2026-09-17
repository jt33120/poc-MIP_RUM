// P5.1 — migration-v69 et enveloppe d'erreur, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code. Que la migration se rejoue
// sans effet. Que sa contrainte refuse les valeurs hors contrat et accepte les
// bornes exactes de l'ingestion : une borne JS plus lâche que la base ferait
// perdre des lots entiers, en silence.
// Qu'un lot réel, immédiat ou différé, écrit chaque colonne, et qu'un NUL de V8
// ou un contexte de 120 × 1e308 n'en fait plus perdre aucun. Que la rétention,
// les effacements, les exports DSAR et le métering traitent ces lignes comme les
// autres. Enfin, sur une seconde base restée en v68, que le même code écrit
// pendant la fenêtre de déploiement, puis écrit l'enveloppe dès v69 appliquée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildResourceSpans, msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity, secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { deposerLot, drainerIngestRaw } from "../../apps/ingest/lib/ingest-differe.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlV68 = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "apps", "ingest", "sql");
const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : { max: 4 });
const poolV68 = new pg.Pool(urlV68 ? { connectionString: urlV68, max: 4 } : { max: 4 });

const APP = "p51-w1-enveloppe";
const APP_EFFACEMENT = "p51-w1-effacement";
const APP_V68 = "p51-w1-fenetre-v68";
const SECRET = "test-only-identity-secret";
const UTILISATEUR = "alice@example.test";
const COMPTE = "acme";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const TRACE_BACKEND = "0af7651916cd43dd8448eb211c80319c";
const PARENT = "53995c3f42cd8ad8";
const ACTION = "0123456789abcdef0123456789abcdef";
const NUL = String.fromCharCode(0);
const REMPLACEMENT = String.fromCharCode(0xfffd);
const muet = { error() {} };

/** Colonnes de migration-v69. */
const ENVELOPPE = [
  "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal", "context",
  "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
];
/** Tables écrites par ces lots, enfants avant parents (clés étrangères). */
const TABLES_APP = [
  "ingest_raw", "rum_event_index", "rum_action", "rum_metric", "rum_error", "rum_resource", "rum_longtask",
  "rum_breadcrumb", "rum_event", "rum_span", "rum_pageview", "rum_session", "tenant_usage_daily",
];

type Attrs = Record<string, unknown>;

/** Identifiant de span natif, propre à ce fichier (span_id est unique sur toute la table). */
const spanId = (n: number) => (0x5f1e000000000000n + BigInt(n)).toString(16);

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

/** Resource du SDK web (otel.ts), avec son app. */
const ressourceWeb = (app: string) => ({
  "service.name": "mip-rum-web",
  "service.version": "0.4.0",
  "mip.app_id": app,
  "mip.release": "2.3.1",
  "deployment.environment.name": "production",
});

/** Encodage réel du SDK web ; `scope` remplace le sien pour simuler un émetteur tiers. */
function ressource(attrs: Attrs, spans: Array<Omit<EmitSpan, "startTime" | "endTime">>, scope?: { name: string }) {
  const maintenant = msToHr(Date.now() - 1_000);
  const payload = buildResourceSpans(attrs, spans.map((span) => ({ ...span, startTime: maintenant, endTime: maintenant }))) as {
    resourceSpans: Array<{ scopeSpans: Array<{ scope: unknown }> }>;
  };
  if (scope) payload.resourceSpans[0].scopeSpans[0].scope = scope;
  return payload.resourceSpans[0];
}

/** Identités brutes remplacées par leur HMAC avant le parseur, comme aux deux ports. */
function aplatir(...resourceSpans: unknown[]): { errors: Attrs[] } {
  return flattenOtlp(secureOtlpIdentities({ resourceSpans }, SECRET).payload);
}

function pageview(session: string, n: number): Omit<EmitSpan, "startTime" | "endTime"> {
  return {
    name: "pageview",
    traceId: TRACE,
    spanId: spanId(n),
    attributes: {
      "mip.session_id": session, "mip.route": "/panier", "mip.visitor_id": `visiteur-${session}`,
      "mip.url": "https://app.exemple.fr/panier", "mip.nav_type": "navigate", "mip.device_type": "desktop",
    },
  };
}

/** Erreur navigateur non interceptée, avec tout le snapshot P2 qu'une ligne peut porter. */
function exception(session: string, n: number, extra: Attrs = {}): Omit<EmitSpan, "startTime" | "endTime"> {
  return {
    name: "exception",
    traceId: TRACE,
    spanId: spanId(n),
    parentSpanId: PARENT,
    attributes: {
      "mip.session_id": session,
      "mip.route": "/panier",
      "mip.visitor_id": `visiteur-${session}`,
      "mip.error_kind": "error",
      "mip.error_count": 3,
      "mip.error_fatal": false,
      "exception.type": "TypeError",
      "exception.message": "Cannot read properties of undefined (reading 'total')",
      "exception.stacktrace":
        "TypeError: Cannot read properties of undefined (reading 'total')\n    at validerPanier (https://app.exemple.fr/assets/panier-4f2a9c1d.js:1:2345)",
      "mip.identity.user_id": UTILISATEUR,
      "mip.identity.account_id": COMPTE,
      "mip.view_id": "view-panier",
      "mip.view_name": "Panier",
      "mip.action_id": ACTION,
      "mip.context": JSON.stringify({ panier: "p-42" }),
      ...extra,
    },
  };
}

async function compter(db: pg.Pool, table: string, app: string): Promise<number> {
  return Number((await db.query(`select count(*)::int as n from ${table} where app_id = $1`, [app])).rows[0].n);
}

const suite = url ? describe : describe.skip;
const suiteV68 = urlV68 ? describe : describe.skip;

suite("migration-v69 et enveloppe d'erreur — PostgreSQL", () => {
  beforeAll(async () => {
    // Rejouée DEUX FOIS avant toute écriture : c'est ce que fait un pre-deploy
    // relancé après un échec partiel, et `add column if not exists` ne suffit pas
    // à le garantir pour une contrainte.
    for (let passe = 0; passe < 2; passe++) {
      for (const file of migrations()) await pool.query(readFileSync(file, "utf8"));
    }
    await enregistrer(pool, [APP, APP_EFFACEMENT]);
    await nettoyer(pool, [APP, APP_EFFACEMENT]);
    // Le cache de colonnes est par TABLE, pas par base : il ne doit pas survivre
    // d'une base à l'autre dans ce fichier.
    _resetColonnesCache();
    // Le module console lit DATABASE_URL à son import : il est posé ici, sur la
    // base jetable, avant tout import dynamique.
    process.env.DATABASE_URL = url;
  }, 300_000);

  afterAll(async () => {
    await nettoyer(pool, [APP, APP_EFFACEMENT]);
    await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, APP_EFFACEMENT]]);
    await pool.end();
    const { pool: consolePool } = await import("../../apps/console/lib/db");
    await consolePool.end();
  });

  it("pose douze colonnes et une contrainte NOT VALID, une seule fois malgré le rejeu", async () => {
    const colonnes = (await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'rum_error' and column_name = any($1::text[])`,
      [ENVELOPPE],
    )).rows;
    expect(colonnes.map((c) => c.column_name).sort()).toEqual([...ENVELOPPE].sort());
    for (const colonne of colonnes) {
      const attendu = colonne.column_name === "context" ? { data_type: "jsonb", is_nullable: "NO" }
        : ["handled", "is_fatal"].includes(colonne.column_name) ? { data_type: "boolean", is_nullable: "YES" }
          : { data_type: "text", is_nullable: "YES" };
      expect(colonne).toMatchObject(attendu);
    }
    expect((await pool.query(
      `select convalidated from pg_constraint
        where conrelid = 'public.rum_error'::regclass and conname = 'rum_error_envelope_v69'`,
    )).rows).toEqual([{ convalidated: false }]);
  });

  it("la contrainte refuse chaque valeur que l'ingestion écarte, et accepte ses bornes exactes", async () => {
    await nettoyer(pool, [APP]);
    let n = 0;
    const inserer = (valeurs: Attrs) => {
      const colonnes = Object.keys(valeurs);
      return pool.query(
        `insert into rum_error (app_id, span_id, ${colonnes.join(", ")})
         values ($1, $2, ${colonnes.map((_, i) => `$${i + 3}`).join(", ")})`,
        [APP, spanId(100 + n++), ...Object.values(valeurs)],
      );
    };
    const refus: Attrs[] = [
      { trace_id: TRACE.toUpperCase() },
      { trace_id: "0".repeat(32) },
      { trace_id: TRACE.slice(1) },
      { source_parent_span_id: "0".repeat(16) },
      { source_parent_span_id: `${PARENT}0` },
      { error_source: "browser" },
      { user_id_hash: "AB".repeat(32) },
      { account_id_hash: "ab".repeat(31) },
      { env: "e".repeat(121) },
      { service: "s".repeat(121) },
      { view_id: "v".repeat(101) },
      { view_name: "n".repeat(101) },
      { context: "[]" },
      // Le cas réel : 1,3 Kio en JSON compact, plus de 32 Kio en `jsonb::text`.
      { context: JSON.stringify({ valeurs: Array(120).fill(1e308) }) },
    ];
    for (const valeurs of refus) {
      await expect(inserer(valeurs), JSON.stringify(valeurs).slice(0, 80))
        .rejects.toMatchObject({ code: "23514", constraint: "rum_error_envelope_v69" });
    }
    await inserer({
      trace_id: TRACE, source_parent_span_id: PARENT, error_source: "otel", handled: false, is_fatal: true,
      user_id_hash: "ab".repeat(32), account_id_hash: "cd".repeat(32), env: "e".repeat(120),
      service: "s".repeat(120), view_id: "v".repeat(100), view_name: "n".repeat(100),
      context: JSON.stringify({ plan: "pro" }),
    });
    expect(await compter(pool, "rum_error", APP)).toBe(1);
  });

  it("un lot réel écrit chaque colonne, pour le SDK web comme pour un émetteur inconnu, et se rejoue", async () => {
    await nettoyer(pool, [APP]);
    const session = "p51-w1-aller-retour";
    const lot = aplatir(
      ressource(ressourceWeb(APP), [pageview(session, 1), exception(session, 2)]),
      // Émetteur OTel tiers : ni service.name MIP ni scope du SDK, donc source et
      // caractère géré inconnus ; son service et son env déclarés sont gardés.
      ressource(
        { "mip.app_id": APP, "service.name": "checkout-api", "deployment.environment": "staging" },
        [{
          name: "exception", traceId: TRACE_BACKEND, spanId: spanId(3),
          attributes: {
            "mip.session_id": session, "mip.error_kind": "error",
            "exception.type": "ValueError", "exception.message": "montant invalide",
          },
        }],
        { name: "opentelemetry.instrumentation.fastapi" },
      ),
    );
    await writeRows(pool, lot);
    await writeRows(pool, lot);

    const { rows } = await pool.query(
      `select span_id, trace_id, source_parent_span_id, error_source, handled, is_fatal, context, view_id,
              view_name, user_id_hash, account_id_hash, env, service, action_id, occurrences, kind, lineno
         from rum_error where app_id = $1 order by span_id`,
      [APP],
    );
    expect(rows).toEqual([
      {
        span_id: spanId(2), trace_id: TRACE, source_parent_span_id: PARENT, error_source: "browser_js",
        handled: false, is_fatal: false, context: { panier: "p-42" }, view_id: "view-panier", view_name: "Panier",
        user_id_hash: hashIdentity(SECRET, APP, "user", UTILISATEUR),
        account_id_hash: hashIdentity(SECRET, APP, "account", COMPTE),
        env: "production", service: null, action_id: ACTION, occurrences: 3, kind: "error", lineno: null,
      },
      {
        span_id: spanId(3), trace_id: TRACE_BACKEND, source_parent_span_id: null, error_source: null,
        handled: null, is_fatal: null, context: {}, view_id: null, view_name: null, user_id_hash: null,
        account_id_hash: null, env: "staging", service: "checkout-api", action_id: null, occurrences: 1,
        kind: "error", lineno: null,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(UTILISATEUR);
  });

  it("un message NUL de V8 et un contexte de 120 × 1e308 ne font plus perdre le lot", async () => {
    await nettoyer(pool, [APP]);
    // Précondition : bruts, ces deux valeurs font bien refuser l'écriture.
    await expect(pool.query("select $1::text", [`a${NUL}b`])).rejects.toMatchObject({ code: "22021" });
    const exposants = JSON.stringify({ valeurs: Array(120).fill(1e308) });
    expect((await pool.query("select octet_length($1::jsonb::text) > 32768 as trop", [exposants])).rows[0].trop)
      .toBe(true);
    let messageV8 = "";
    try {
      JSON.parse(`${NUL}{}`);
    } catch (error) {
      messageV8 = (error as Error).message;
    }
    expect(messageV8).toContain(NUL);

    const session = "p51-w1-nul";
    await writeRows(pool, aplatir(ressource(ressourceWeb(APP), [
      pageview(session, 11),
      exception(session, 12, {
        "exception.message": messageV8,
        "mip.context": JSON.stringify({ valeurs: Array(120).fill(1e308), note: `a${NUL}b` }),
      }),
    ])));

    expect(await compter(pool, "rum_session", APP)).toBe(1);
    expect(await compter(pool, "rum_pageview", APP)).toBe(1);
    const [erreur] = (await pool.query("select message, context from rum_error where app_id = $1", [APP])).rows;
    expect(erreur.message).toContain(REMPLACEMENT);
    expect(erreur.message).not.toContain(NUL);
    expect(erreur.context).toEqual({ valeurs: [], note: `a${REMPLACEMENT}b` });
  });

  it("le chemin différé écrit l'enveloppe ; un lot déposé avant P5.1 écrit NULL et '{}'", async () => {
    await nettoyer(pool, [APP]);
    await deposerLot(pool, APP, aplatir(ressource(ressourceWeb(APP), [exception("p51-w1-differe", 21)])));
    // Lot déposé par le code d'avant P5.1 : mêmes lignes, moins les sept champs que
    // flattenOtlp ne produisait pas encore, et sans snapshot ni identité.
    const ancien = aplatir(ressource(ressourceWeb(APP), [exception("p51-w1-ancien", 22, {
      "mip.context": "", "mip.identity.user_id": "", "mip.identity.account_id": "",
    })]));
    for (const erreur of ancien.errors) {
      for (const champ of ["trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal", "env", "service"]) {
        delete erreur[champ];
      }
    }
    await deposerLot(pool, APP, ancien);

    expect(await drainerIngestRaw(pool, { log: muet })).toEqual({ drains: 2, echecs: 0 });
    const { rows } = await pool.query(
      `select span_id, trace_id, source_parent_span_id, error_source, handled, is_fatal, context,
              user_id_hash, env, service
         from rum_error where app_id = $1 order by span_id`,
      [APP],
    );
    expect(rows).toEqual([
      {
        span_id: spanId(21), trace_id: TRACE, source_parent_span_id: PARENT, error_source: "browser_js",
        handled: false, is_fatal: false, context: { panier: "p-42" },
        user_id_hash: hashIdentity(SECRET, APP, "user", UTILISATEUR), env: "production", service: null,
      },
      {
        span_id: spanId(22), trace_id: null, source_parent_span_id: null, error_source: null, handled: null,
        is_fatal: null, context: {}, user_id_hash: null, env: null, service: null,
      },
    ]);
  });

  it("le métering compte les mêmes événements et occurrences, sans double compte au rejeu", async () => {
    await nettoyer(pool, [APP]);
    const session = "p51-w1-metering";
    const lot = aplatir(ressource(ressourceWeb(APP), [pageview(session, 31), exception(session, 32)]));
    await writeRows(pool, lot);
    await writeRows(pool, lot);
    // Le jour du lot, pris dans le fuseau de la session SQL comme le fait la
    // fonction : un test lancé à minuit ne mesure pas la veille.
    const { rows: [{ jour }] } = await pool.query(
      "select ts::date::text as jour from rum_error where app_id = $1", [APP],
    );
    await pool.query("select meter_tenant_usage($1::date)", [jour]);
    const usage = (await pool.query(
      "select events::int as events, errors::int as errors from tenant_usage_daily where app_id = $1 and day = $2::date",
      [APP, jour],
    )).rows;
    // Une pageview et une ligne d'erreur ; l'erreur représente 3 occurrences.
    expect(usage).toEqual([{ events: 2, errors: 3 }]);
  });

  describe("rétention, effacements et DSAR", () => {
    const session = "p51-w1-effacement";
    const visiteur = `visiteur-${session}`;
    const hash = () => hashIdentity(SECRET, APP_EFFACEMENT, "user", UTILISATEUR) as string;
    const erreurs = () => compter(pool, "rum_error", APP_EFFACEMENT);

    /** Réécrit la session et vérifie qu'elle porte bien des valeurs v69 avant d'effacer. */
    async function ecrire() {
      await nettoyer(pool, [APP_EFFACEMENT]);
      await writeRows(pool, aplatir(ressource(ressourceWeb(APP_EFFACEMENT), [pageview(session, 41), exception(session, 42)])));
      const porteuses = (await pool.query(
        `select count(*)::int as n from rum_error
          where app_id = $1 and trace_id is not null and error_source is not null
            and user_id_hash is not null and context <> '{}'::jsonb`,
        [APP_EFFACEMENT],
      )).rows[0].n;
      expect(Number(porteuses)).toBe(1);
    }

    it("purge_rum_app, erase_session et erase_app_data les emportent", async () => {
      await ecrire();
      await pool.query("select purge_rum_app($1, now() + interval '1 minute')", [APP_EFFACEMENT]);
      expect(await erreurs()).toBe(0);

      await ecrire();
      await pool.query("select erase_session($1)", [session]);
      expect(await erreurs()).toBe(0);

      await ecrire();
      await pool.query("select erase_app_data($1)", [APP_EFFACEMENT]);
      expect(await erreurs()).toBe(0);
    });

    it("les exports par visiteur et par identité les contiennent, l'effacement associé les retire", async () => {
      const { dsarErase, dsarExport, dsarIdentityErase, dsarIdentityExport } =
        await import("../../apps/console/lib/queries-dsar");
      const attendue = expect.objectContaining({
        trace_id: TRACE, source_parent_span_id: PARENT, error_source: "browser_js", handled: false,
        context: { panier: "p-42" }, user_id_hash: hash(), view_name: "Panier", env: "production",
      });

      await ecrire();
      const parVisiteur = await dsarExport(APP_EFFACEMENT, visiteur, new Date().toISOString());
      expect(parVisiteur.tables.rum_error).toEqual([attendue]);
      expect(await dsarErase(APP_EFFACEMENT, visiteur)).toContainEqual({ table: "rum_error", deleted: 1 });
      expect(await erreurs()).toBe(0);

      await ecrire();
      const parIdentite = await dsarIdentityExport(APP_EFFACEMENT, "user", hash(), new Date().toISOString());
      expect(parIdentite.tables.rum_error).toEqual([attendue]);
      expect(await dsarIdentityErase(APP_EFFACEMENT, "user", hash())).toContainEqual({ table: "rum_error", deleted: 1 });
      expect(await erreurs()).toBe(0);
    });
  });
});

suiteV68("fenêtre de déploiement : code P5.1 sur une base restée en v68", () => {
  beforeAll(async () => {
    // Repartir d'un schéma vide : un passage précédent a pu y appliquer v69, et
    // `add column if not exists` ne s'annule pas.
    await poolV68.query("drop schema public cascade; create schema public;");
    for (const file of migrations(68)) await poolV68.query(readFileSync(file, "utf8"));
    await enregistrer(poolV68, [APP_V68]);
    await nettoyer(poolV68, [APP_V68]);
    _resetColonnesCache();
  }, 300_000);

  afterAll(async () => {
    await nettoyer(poolV68, [APP_V68]);
    await poolV68.query("delete from app_registry where app_id = $1", [APP_V68]);
    await poolV68.end();
  });

  it("le lot commit sans les colonnes v69, puis les écrit dès la migration appliquée", async () => {
    const colonnesV69 = async () => (await poolV68.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'rum_error' and column_name = any($1::text[])`,
      [ENVELOPPE],
    )).rows;
    expect(await colonnesV69()).toEqual([]);

    const session = "p51-w1-fenetre";
    await writeRows(poolV68, aplatir(ressource(ressourceWeb(APP_V68), [pageview(session, 51), exception(session, 52)])));
    // Déposé pendant la fenêtre, drainé après la migration : le lot aplati porte
    // déjà l'enveloppe, qui doit alors être écrite.
    await deposerLot(poolV68, APP_V68, aplatir(ressource(ressourceWeb(APP_V68), [exception(session, 53)])));
    expect(await compter(poolV68, "rum_session", APP_V68)).toBe(1);
    expect(await compter(poolV68, "rum_pageview", APP_V68)).toBe(1);
    // Les colonnes v59/v67 que la base porte déjà ne sont pas sacrifiées.
    expect((await poolV68.query("select occurrences, action_id from rum_error where app_id = $1", [APP_V68])).rows)
      .toEqual([{ occurrences: 3, action_id: ACTION }]);

    await poolV68.query(readFileSync(join(SQL_DIR, "migration-v69.sql"), "utf8"));
    _resetColonnesCache();
    expect(await colonnesV69()).toHaveLength(ENVELOPPE.length);
    await writeRows(poolV68, aplatir(ressource(ressourceWeb(APP_V68), [exception(session, 54)])));
    expect(await drainerIngestRaw(poolV68, { log: muet })).toEqual({ drains: 1, echecs: 0 });

    const { rows } = await poolV68.query(
      "select span_id, trace_id, error_source, handled, context, env from rum_error where app_id = $1 order by span_id",
      [APP_V68],
    );
    const ecrite = { trace_id: TRACE, error_source: "browser_js", handled: false, context: { panier: "p-42" }, env: "production" };
    expect(rows).toEqual([
      // Écrite en v68 : l'ajout de colonne lui donne NULL et le défaut '{}'.
      { span_id: spanId(52), trace_id: null, error_source: null, handled: null, context: {}, env: null },
      { span_id: spanId(53), ...ecrite },
      { span_id: spanId(54), ...ecrite },
    ]);
  });
});
