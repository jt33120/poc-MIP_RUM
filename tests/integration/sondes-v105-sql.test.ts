// Suite des sondes — migration-v105, sur un vrai PostgreSQL : l'état « hors
// collecte » des règles d'alerte et le battement attendu par application.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · v105 se rejoue sans effet ; la contrainte de `last_state` admet
//     `hors_collecte` et refuse toujours un état inconnu ;
//   · une règle dont la fenêtre recoupe une fenêtre `interrompue` du registre
//     (plateforme, ou SON application ; étage `chaine`) rend `hors_collecte`, dit
//     pourquoi, et ne lève AUCUNE alerte — même franchie sur les données reçues ;
//     une fenêtre close avant sa fenêtre, `degradee`, d'une autre application ou
//     d'un autre étage ne change rien ;
//   · le battement attendu : lu par la base (dernier, compte récent), jugé par le
//     scheduler, UNE fenêtre et UNE alerte par épisode, rien quand la chaîne n'est
//     pas `ok` ni pour un battement jamais reçu, fermeture au battement revenu —
//     et, pendant l'épisode, les règles de l'application passent hors collecte.
//
// Chaque cas tourne dans une transaction ANNULÉE : rien ne reste dans la base
// partagée par les autres fichiers.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { creerSondes } from "../../packages/backend/jobs/sondes.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

const muet = { info() {}, warn() {}, error() {} };

(url ? describe : describe.skip)("v105 — hors collecte et battement attendu, sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});

  /** Exécute `corps` dans une transaction toujours annulée. */
  async function annulee<T>(corps: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      // La base est partagée : les règles et fenêtres des autres fichiers ne
      // doivent pas peser ici (tout est annulé à la fin).
      await c.query("update alert_rule set active = false");
      await c.query("delete from collecte_fenetre");
      return await corps(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  const app = async (c: pg.PoolClient, id: string, { active = true } = {}) => {
    await c.query("insert into app_registry (app_id, name, active) values ($1, $1, $2) on conflict (app_id) do update set active = $2", [id, active]);
    await c.query("insert into rum_session (session_id, app_id) values ($1, $2) on conflict do nothing", [`${id}-s0`, id]);
  };

  let n = 0;
  /** Une mesure LCP de 5 000 ms il y a 5 minutes : franchit un seuil de 2 500. */
  const mesure = (c: pg.PoolClient, a: string) =>
    c.query(
      "insert into rum_metric (span_id, session_id, app_id, route, name, value, ts) values ($1, $2, $3, '/', 'LCP', 5000, now() - interval '5 minutes')",
      [`v105-m-${(n += 1)}`, `${a}-s0`, a],
    );

  const regle = async (c: pg.PoolClient, a: string, fenetre = 60): Promise<number> => {
    const { rows } = await c.query<{ id: string }>(
      `insert into alert_rule (app_id, metric, comparator, threshold, window_minutes, mode, severity)
       values ($1, 'LCP', '>', 2500, $2, 'threshold', 'warning') returning id`,
      [a, fenetre],
    );
    return Number(rows[0].id);
  };

  const fenetre = (c: pg.PoolClient, portee: string, debut: string, fin: string | null, { etat = "interrompue", etage = "chaine", cause = "v105 : coupure de test" } = {}) =>
    c.query(
      `insert into collecte_fenetre (portee, etage, etat, debut, fin, cause, source)
       values ($1, $2, $3, now() - $4::interval, case when $5::text is null then null else now() - $5::interval end, $6, 'operateur')`,
      [portee, etage, etat, debut, fin, cause],
    );

  const etat = async (c: pg.PoolClient, r: number) =>
    (await c.query<{ last_state: string; last_value: number | null; last_reason: string | null }>(
      "select last_state, last_value, last_reason from alert_rule where id = $1",
      [r],
    )).rows[0];
  const alertes = async (c: pg.PoolClient, r: number) =>
    Number((await c.query("select count(*)::int as n from alert_event where rule_id = $1", [r])).rows[0].n);

  /** Un span serveur de `route` il y a `ilYa` minutes. */
  const battre = (c: pg.PoolClient, a: string, route: string, ilYa: number) =>
    c.query(
      "insert into rum_span (span_id, trace_id, tier, app_id, route, duration_ms, ts) values ($1, $1, 'back', $2, $3, 3, now() - make_interval(mins => $4))",
      [`v105-s-${(n += 1)}`, a, route, ilYa],
    );
  const declarer = (c: pg.PoolClient, a: string, route = "/health/db", { active = true } = {}) =>
    c.query(
      "insert into sonde_attendue (app_id, signal, route, cadence_min, tolerance_min, active) values ($1, 'span_route', $2, 15, 20, $3)",
      [a, route, active],
    );

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    // Rejouable : le fichier passe une seconde fois sans rien changer.
    await pool.query(readFileSync(join(SQL_DIR, "migration-v105.sql"), "utf8"));
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it("la contrainte admet `hors_collecte`, refuse toujours un état inconnu", async () => {
    await annulee(async (c) => {
      await app(c, "v105-contrainte");
      const r = await regle(c, "v105-contrainte");
      await c.query("update alert_rule set last_state = 'hors_collecte' where id = $1", [r]);
      await expect(c.query("update alert_rule set last_state = 'bidon' where id = $1", [r])).rejects.toThrow(/alert_rule_issue_metric_v73/);
    });
  });

  it("sans fenêtre de collecte, la règle franchie déclenche comme avant", async () => {
    await annulee(async (c) => {
      await app(c, "v105-temoin");
      await mesure(c, "v105-temoin");
      const r = await regle(c, "v105-temoin");
      await c.query("select check_alerts()");
      expect(await etat(c, r)).toMatchObject({ last_state: "breached", last_value: 5000 });
      expect(await alertes(c, r)).toBe(1);
    });
  });

  it("une coupure de SON application qui recoupe la fenêtre : hors collecte, raison datée, aucune alerte", async () => {
    await annulee(async (c) => {
      await app(c, "v105-app");
      await mesure(c, "v105-app");
      const r = await regle(c, "v105-app", 60);
      // Close il y a 30 min : elle recoupe les 60 dernières minutes.
      await fenetre(c, "v105-app", "3 hours", "30 minutes");
      await c.query("select check_alerts()");
      const e = await etat(c, r);
      expect(e.last_state).toBe("hors_collecte");
      expect(e.last_value).toBeNull();
      expect(e.last_reason).toMatch(/^collecte interrompue pour cette application du \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} au \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} UTC : v105 : coupure de test$/);
      expect(await alertes(c, r)).toBe(0);
    });
  });

  it("une coupure de la plateforme, en cours : hors collecte pour toutes les applications", async () => {
    await annulee(async (c) => {
      await app(c, "v105-plateforme");
      await mesure(c, "v105-plateforme");
      const r = await regle(c, "v105-plateforme");
      await fenetre(c, "*", "10 minutes", null, { cause: "le canari n'a pas été écrit" });
      await c.query("select check_alerts()");
      const e = await etat(c, r);
      expect(e.last_state).toBe("hors_collecte");
      expect(e.last_reason).toMatch(/^collecte interrompue sur la plateforme depuis le .* UTC \(en cours\) : le canari n'a pas été écrit$/);
      expect(await alertes(c, r)).toBe(0);
    });
  });

  it("ni retour à la normale : une règle franchie passe hors collecte, pas « normale », et rien ne part", async () => {
    await annulee(async (c) => {
      await app(c, "v105-retour");
      const r = await regle(c, "v105-retour");
      await c.query("update alert_rule set last_state = 'breached' where id = $1", [r]);
      await fenetre(c, "v105-retour", "20 minutes", null);
      await c.query("select check_alerts()");
      expect((await etat(c, r)).last_state).toBe("hors_collecte");
      expect(await alertes(c, r)).toBe(0);
    });
  });

  it("n'y touchent pas : une fenêtre close avant la fenêtre de la règle, dégradée, d'une autre app, d'un autre étage", async () => {
    await annulee(async (c) => {
      await app(c, "v105-hors");
      await app(c, "v105-voisine");
      await mesure(c, "v105-hors");
      const r = await regle(c, "v105-hors", 60);
      await fenetre(c, "v105-hors", "5 hours", "2 hours");
      await fenetre(c, "*", "30 minutes", null, { etat: "degradee" });
      await fenetre(c, "v105-voisine", "30 minutes", null);
      await fenetre(c, "v105-hors", "30 minutes", null, { etage: "silence" });
      await c.query("select check_alerts()");
      expect(await etat(c, r)).toMatchObject({ last_state: "breached", last_value: 5000 });
      expect(await alertes(c, r)).toBe(1);
    });
  });

  it("l'index du battement est celui des spans serveur par route", async () => {
    const { rows } = await pool.query("select indexdef from pg_indexes where indexname = 'rum_span_back_route_idx'");
    expect(rows[0]?.indexdef).toMatch(/\(app_id, route, ts DESC\) WHERE \(tier = 'back'::text\)/);
  });

  it("sonde_etat_battements : dernier et compte récent par route ; ni app inactive, ni sonde, ni déclaration inactive", async () => {
    await annulee(async (c) => {
      await app(c, "v105-bat");
      await app(c, "v105-inactive", { active: false });
      await declarer(c, "v105-bat");
      await declarer(c, "v105-bat", "/eteinte", { active: false });
      await declarer(c, "v105-inactive");
      await declarer(c, "mip-canari");
      await battre(c, "v105-bat", "/health/db", 35);
      await battre(c, "v105-bat", "/health/db", 5);
      await battre(c, "v105-bat", "/autre", 1);
      await battre(c, "v105-inactive", "/health/db", 1);
      const { rows } = await c.query("select app_id, route, cadence_min, tolerance_min, recents, fenetre_id from sonde_etat_battements()");
      expect(rows).toEqual([{ app_id: "v105-bat", route: "/health/db", cadence_min: 15, tolerance_min: 20, recents: 1, fenetre_id: null }]);
    });
  });

  it("le battement manque, chaîne ok : UNE fenêtre, UNE alerte, les règles de l'app hors collecte ; fermée au retour", async () => {
    await annulee(async (c) => {
      const poolTx = { query: (q: string, p?: unknown[]) => c.query(q, p) };
      const sondes = creerSondes({ pool: poolTx, log: muet });
      await app(c, "v105-muette");
      await app(c, "v105-vivante");
      await app(c, "v105-jamais");
      await declarer(c, "v105-muette");
      await declarer(c, "v105-vivante");
      await declarer(c, "v105-jamais");
      await battre(c, "v105-muette", "/health/db", 40);
      await battre(c, "v105-vivante", "/health/db", 3);

      // Chaîne non nominale : la panne peut être celle de la plateforme, rien.
      expect(await sondes.traiterBattements(false)).toEqual({ apps: 3, ouvertes: 0, fermees: 0, alertes: 0, jamais_recus: 1 });

      expect(await sondes.traiterBattements(true)).toEqual({ apps: 3, ouvertes: 1, fermees: 0, alertes: 1, jamais_recus: 1 });
      const { rows: fenetres } = await c.query(
        "select portee, etage, etat, cause, source, fin, alerte_event_id, abs(extract(epoch from debut - (select max(ts) from rum_span where app_id = 'v105-muette'))) < 0.001 as debut_au_dernier from collecte_fenetre",
      );
      expect(fenetres).toEqual([
        {
          portee: "v105-muette",
          etage: "chaine",
          etat: "interrompue",
          cause: "l'application n'émet plus son battement",
          source: "sonde",
          fin: null,
          alerte_event_id: expect.anything(),
          debut_au_dernier: true,
        },
      ]);
      const { rows: [ev] } = await c.query("select rule_id, severity, message from alert_event where id = $1", [fenetres[0].alerte_event_id]);
      expect(ev).toMatchObject({ rule_id: null, severity: "warning" });
      expect(ev.message).toMatch(/^Collecte interrompue — app v105-muette : l'application n'émet plus son battement.*dernier \/health\/db le .* UTC, attendu toutes les 15 min, tolérance 20 min/);

      // Une alerte par épisode : le passage suivant ne lève rien.
      expect(await sondes.traiterBattements(true)).toMatchObject({ ouvertes: 0, alertes: 0 });

      // Pendant l'épisode, les règles de l'application ne concluent rien.
      await mesure(c, "v105-muette");
      const r = await regle(c, "v105-muette");
      await c.query("select check_alerts()");
      expect(await etat(c, r)).toMatchObject({
        last_state: "hors_collecte",
        last_reason: expect.stringMatching(/pour cette application depuis le .* \(en cours\) : l'application n'émet plus son battement$/),
      });
      expect(await alertes(c, r)).toBe(0);

      // Le battement revient : la fenêtre se ferme à son heure.
      await battre(c, "v105-muette", "/health/db", 1);
      expect(await sondes.traiterBattements(true)).toMatchObject({ fermees: 1 });
      const { rows: [close] } = await c.query(
        "select fin = (select max(ts) from rum_span where app_id = 'v105-muette') as fin_au_retour from collecte_fenetre where portee = 'v105-muette'",
      );
      expect(close.fin_au_retour).toBe(true);
    });
  });

  it("une fenêtre posée à la main n'est ni doublée ni fermée par la sonde ; les écritures restent au propriétaire", async () => {
    await annulee(async (c) => {
      await app(c, "v105-main");
      await declarer(c, "v105-main");
      await battre(c, "v105-main", "/health/db", 3);
      await fenetre(c, "v105-main", "1 hour", null);
      const poolTx = { query: (q: string, p?: unknown[]) => c.query(q, p) };
      const sondes = creerSondes({ pool: poolTx, log: muet });
      // La fenêtre de l'opérateur n'est pas « de sonde » : un battement présent ne la ferme pas.
      expect(await sondes.traiterBattements(true)).toMatchObject({ fermees: 0, ouvertes: 0 });
      const { rows: [{ ouverte }] } = await c.query("select count(*)::int as ouverte from collecte_fenetre where portee = 'v105-main' and fin is null");
      expect(ouverte).toBe(1);
      const { rows: droits } = await c.query(
        `select p.proname, has_function_privilege('public', p.oid, 'execute') as public
           from pg_proc p where p.proname in ('sonde_ouvrir_battement', 'sonde_fermer_battement') order by 1`,
      );
      expect(droits).toEqual([
        { proname: "sonde_fermer_battement", public: false },
        { proname: "sonde_ouvrir_battement", public: false },
      ]);
    });
  });
});
