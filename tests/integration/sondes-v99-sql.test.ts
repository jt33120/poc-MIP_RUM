// Vague 1 — migration-v99 (sondes de la chaîne de mesure), sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · l'application canari naît interne, SONDE et SANS clé ; les quatre tables
//     sont sous RLS, lisibles par `console_ro` seul ;
//   · le comptage d'usage n'admet jamais une application sonde, quel que soit
//     l'écrivain (déclencheur, `on conflict` compris) ;
//   · la purge quotidienne borne le journal (90 j) et le registre (400 j), sans
//     jamais toucher une fenêtre en cours ;
//   · l'alerte d'absence ouvre UNE fenêtre et lève UNE alerte par épisode, se
//     ferme au retour de la donnée, se tait quand la chaîne est coupée, ignore
//     les applications sonde et celles qui n'ont jamais rien reçu ;
//   · le travail du tick écrit son journal et son registre sur la vraie table.
//
// Chaque cas tourne dans une transaction ANNULÉE : rien ne reste dans la base
// partagée par les autres fichiers (alertes et livraisons comprises).
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { APP_CANARI, construireLotCanari, creerSondes } from "../../packages/backend/jobs/sondes.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const TABLES = ["sonde_passage", "collecte_fenetre", "sonde_attendue", "sonde_battement"];

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("v99 — sondes de la chaîne de mesure sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});

  /** Exécute `corps` dans une transaction toujours annulée. */
  async function annulee<T>(corps: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      return await corps(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  const app = (c: pg.PoolClient, id: string) =>
    c.query("insert into app_registry (app_id, name, active) values ($1, $1, true)", [id]);

  /** Une ligne d'index (span serveur) datée de `ilYa` minutes. */
  let compteur = 0;
  const signal = async (c: pg.PoolClient, id: string, ilYa: number) =>
    c.query(
      `insert into rum_event_index (app_id, session_id, ts, route, kind, source_name, source_span_id)
       values ($1, null, now() - make_interval(mins => $2), null, 'span', 'server', $3)`,
      [id, ilYa, (++compteur).toString(16).padStart(16, "0")],
    );

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    // Rejouable : le fichier passe une seconde fois sans rien changer.
    await pool.query(readFileSync(join(SQL_DIR, "migration-v99.sql"), "utf8"));
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it("l'application canari : interne, sonde, sans clé, 7 jours de rétention", async () => {
    const { rows } = await pool.query(
      "select internal, sonde, active, api_key_hash, retention_days from app_registry where app_id = $1",
      [APP_CANARI],
    );
    expect(rows).toEqual([{ internal: true, sonde: true, active: true, api_key_hash: null, retention_days: 7 }]);
  });

  it("les quatre tables sont sous RLS ; console_ro lit, anon et authenticated rien", async () => {
    const { rows } = await pool.query(
      "select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace order by relname",
      [TABLES],
    );
    expect(rows.map((r) => r.relrowsecurity)).toEqual([true, true, true, true]);
    const { rows: roles } = await pool.query("select rolname from pg_roles where rolname in ('console_ro', 'anon', 'authenticated')");
    for (const { rolname } of roles) {
      for (const t of TABLES) {
        const { rows: [d] } = await pool.query("select has_table_privilege($1, $2, 'SELECT') as lit, has_table_privilege($1, $2, 'INSERT') as ecrit", [rolname, t]);
        expect({ role: rolname, table: t, ...d }).toEqual({ role: rolname, table: t, lit: rolname === "console_ro", ecrit: false });
      }
    }
  });

  it("le comptage d'usage n'admet jamais une application sonde", async () => {
    await annulee(async (c) => {
      await app(c, "v99-cliente");
      await c.query(
        `insert into tenant_usage_daily (app_id, day, events) values ($1, current_date - 1, 5), ($2, current_date - 1, 5)
         on conflict (app_id, day) do update set events = excluded.events`,
        [APP_CANARI, "v99-cliente"],
      );
      const { rows } = await c.query("select app_id from tenant_usage_daily where app_id = any($1) order by app_id", [[APP_CANARI, "v99-cliente"]]);
      expect(rows.map((r) => r.app_id)).toEqual(["v99-cliente"]);
    });
  });

  it("la purge : journal à 90 jours, registre clos à 400 jours, fenêtre en cours jamais", async () => {
    await annulee(async (c) => {
      const p = "00000000-0000-4000-8000-0000000000";
      await c.query(
        `insert into sonde_passage (passage_id, etage, emis_at, resultat) values
           ($1::uuid, 'ingest_console', now() - interval '91 days', 'ok'),
           ($2::uuid, 'ingest_console', now() - interval '89 days', 'ok')`,
        [`${p}01`, `${p}02`],
      );
      await c.query(
        `insert into collecte_fenetre (portee, etage, etat, debut, fin, cause) values
           ('v99-purge', 'chaine', 'interrompue', now() - interval '500 days', now() - interval '401 days', 'v99-vieille'),
           ('v99-purge', 'chaine', 'interrompue', now() - interval '399 days', now() - interval '398 days', 'v99-recente'),
           ('v99-purge', 'chaine', 'degradee',   now() - interval '600 days', null, 'v99-en-cours')`,
      );
      const { rows: [{ r }] } = await c.query("select purge_rum_tenants(30) as r");
      expect(r.sondes.sonde_passage).toBeGreaterThanOrEqual(1);
      const { rows: journal } = await c.query("select passage_id::text from sonde_passage where passage_id = any($1::uuid[])", [[`${p}01`, `${p}02`]]);
      expect(journal.map((l) => l.passage_id)).toEqual([`${p}02`]);
      const { rows: registre } = await c.query("select cause from collecte_fenetre where portee = 'v99-purge' order by cause");
      expect(registre.map((l) => l.cause)).toEqual(["v99-en-cours", "v99-recente"]);
    });
  });

  it("alerte d'absence : une fenêtre et UNE alerte par épisode, fermée au retour de la donnée", async () => {
    await annulee(async (c) => {
      await app(c, "v99-muette");
      await app(c, "v99-vivante");
      await app(c, "v99-jamais");
      await signal(c, "v99-muette", 120);
      await signal(c, "v99-vivante", 3);
      const perimetre = ["v99-muette", "v99-vivante", "v99-jamais", APP_CANARI];
      await signal(c, APP_CANARI, 300);

      const { rows: [{ r: premier }] } = await c.query("select check_collecte_silence(60, true, 7, $1) as r", [perimetre]);
      expect(premier).toEqual({ ouvertes: 1, fermees: 0, alertes: 1 });
      const { rows: fenetres } = await c.query(
        "select portee, etage, etat, fin, alerte_event_id from collecte_fenetre where portee = any($1)",
        [perimetre],
      );
      expect(fenetres).toEqual([
        expect.objectContaining({ portee: "v99-muette", etage: "silence", etat: "interrompue", fin: null, alerte_event_id: expect.anything() }),
      ]);
      const { rows: [ev] } = await c.query("select rule_id, severity, message from alert_event where id = $1", [fenetres[0].alerte_event_id]);
      expect(ev).toMatchObject({ rule_id: null, severity: "warning", message: expect.stringMatching(/v99-muette.*60 min/) });

      // Tick suivant, toujours muette : pas de seconde alerte.
      const { rows: [{ r: second }] } = await c.query("select check_collecte_silence(60, true, 7, $1) as r", [perimetre]);
      expect(second).toEqual({ ouvertes: 0, fermees: 0, alertes: 0 });

      // La donnée revient : la fenêtre se ferme à la première donnée revenue.
      await signal(c, "v99-muette", 1);
      const { rows: [{ r: retour }] } = await c.query("select check_collecte_silence(60, true, 7, $1) as r", [perimetre]);
      expect(retour).toEqual({ ouvertes: 0, fermees: 1, alertes: 0 });
      const { rows: [close] } = await c.query(
        "select fin > debut as borne, fin <= now() as passee from collecte_fenetre where portee = 'v99-muette' and etage = 'silence'",
      );
      expect(close).toEqual({ borne: true, passee: true });
    });
  });

  it("alerte d'absence : muette quand la chaîne est coupée ; une app suspendue ou inactive est ignorée", async () => {
    await annulee(async (c) => {
      await app(c, "v99-coupee");
      await app(c, "v99-inactive");
      await c.query("update app_registry set active = false where app_id = 'v99-inactive'");
      await signal(c, "v99-coupee", 120);
      await signal(c, "v99-inactive", 120);
      const { rows: [{ r }] } = await c.query("select check_collecte_silence(60, false, 7, $1) as r", [["v99-coupee", "v99-inactive"]]);
      expect(r).toEqual({ ouvertes: 0, fermees: 0, alertes: 0 });
      const { rows: [{ r: ok }] } = await c.query("select check_collecte_silence(60, true, 7, $1) as r", [["v99-coupee", "v99-inactive"]]);
      expect(ok).toEqual({ ouvertes: 1, fermees: 0, alertes: 1 });
      await expect(c.query("select check_collecte_silence(1, true)")).rejects.toThrow(/seuil de silence invalide/);
    });
  });

  it("sonde_alerter : une seule alerte par fenêtre, rien pour une fenêtre inconnue", async () => {
    await annulee(async (c) => {
      const { rows: [{ id }] } = await c.query(
        "insert into collecte_fenetre (portee, etage, etat, debut) values ('v99-alerte', 'chaine', 'interrompue', now()) returning id",
      );
      const appel = () => c.query("select sonde_alerter($1, 'v99-alerte', 'critical', 'v99 : canari en échec', '{}'::jsonb) as ev", [id]);
      const { rows: [{ ev: premier }] } = await appel();
      const { rows: [{ ev: second }] } = await appel();
      expect(premier).not.toBeNull();
      expect(second).toBeNull();
      const { rows: [{ ev: inconnue }] } = await c.query("select sonde_alerter(-1, 'x', 'warning', 'x', null) as ev");
      expect(inconnue).toBeNull();
    });
  });

  it("le travail du tick, sur la vraie table : un 503 ouvre une fenêtre, le passage suivant réussi la ferme", async () => {
    await annulee(async (c) => {
      // Le client de la transaction tient lieu de pool : tout est annulé à la fin.
      const poolTx = { query: (q: string, p?: unknown[]) => c.query(q, p) };
      let t = Date.now();
      let statut = 503;
      const sondes = creerSondes({
        pool: poolTx,
        url: "https://ingest.example.test/api/ingest/v1/traces",
        log: { info() {}, warn() {}, error() {} },
        maintenant: () => t,
        fetchImpl: async (_u: string, init: { body: string }) => {
          t += 120;
          // Le « serveur » écrit ce que le lot décrit quand il répond 200.
          if (statut === 200) {
            const lot = JSON.parse(init.body);
            const spans = lot.resourceSpans[0].scopeSpans[0].spans;
            const session = spans[0].attributes.find((a: { key: string }) => a.key === "mip.session_id").value.stringValue;
            await c.query("insert into rum_session (session_id, app_id) values ($1, $2)", [session, APP_CANARI]);
            await c.query("insert into rum_pageview (span_id, session_id, app_id, route) values ($1, $2, $3, '/canari')", [spans[0].spanId, session, APP_CANARI]);
            await c.query("insert into rum_metric (span_id, session_id, app_id, name, value) values ($1, $2, $3, 'LCP', 1000)", [spans[1].spanId, session, APP_CANARI]);
            await c.query(
              "insert into rum_span (span_id, trace_id, tier, app_id, duration_ms) values ($1, $2, 'back', $3, 1)",
              [spans[2].spanId, spans[2].traceId, APP_CANARI],
            );
            await c.query(
              "insert into rum_event_index (app_id, session_id, ts, kind, source_span_id) values ($1, $2, now(), 'pageview', $3)",
              [APP_CANARI, session, spans[0].spanId],
            );
          }
          return new Response(null, { status: statut });
        },
      });
      await sondes.emettre.run();
      const echec = await sondes.verifier.run();
      expect(echec).toMatchObject({ etat: "interrompue", emission: "echec", ecriture: "absent" });
      const { rows: [hash] } = await c.query("select api_key_hash from app_registry where app_id = $1", [APP_CANARI]);
      expect(hash.api_key_hash).toBe(sondes.empreinte);

      t += 15 * 60_000;
      statut = 200;
      await sondes.emettre.run();
      const ok = await sondes.verifier.run();
      expect(ok).toMatchObject({ etat: "ok", emission: "ok", ecriture: "ok" });
      const { rows: journal } = await c.query(
        "select etage, resultat from sonde_passage where portee = '*' order by emis_at, etage",
      );
      expect(journal.slice(-4)).toEqual([
        { etage: "ecriture", resultat: "absent" },
        { etage: "ingest_console", resultat: "echec" },
        { etage: "ecriture", resultat: "ok" },
        { etage: "ingest_console", resultat: "ok" },
      ]);
      const { rows: fenetres } = await c.query(
        "select etat, fin is not null as close, source from collecte_fenetre where portee = '*' and etage = 'chaine' order by debut desc limit 1",
      );
      expect(fenetres).toEqual([{ etat: "interrompue", close: true, source: "sonde" }]);
      // Le lot lui-même ne porte que la clé, jamais écrite en clair en base.
      const { payload } = construireLotCanari({ passageId: "00000000-0000-4000-8000-000000000000", emisA: new Date(), cle: "x" });
      expect(JSON.stringify(payload)).toContain("mip.api_key");
    });
  });
});
