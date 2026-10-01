// La veille de l'ordonnanceur sur un vrai PostgreSQL : le notifier alerte quand les
// travaux planifiés se taisent (`packages/backend/jobs/veille-ordonnanceur.mjs`).
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · le bail du tick (`scheduler_lease`), la cadence publiée (`platform_flag`) et la
//     fenêtre ouverte se lisent en UNE requête, à l'heure de la base ;
//   · un silence au-delà de `2 × cadence + 5 min` ouvre UNE fenêtre du registre
//     (portée `'*'`, étage `ordonnanceur`, `interrompue`, source `sonde`) datée du
//     dernier tick abouti, et lève UNE alerte critique (`sonde_alerter`, v103) —
//     jamais deux, quel que soit le nombre de passes pendant l'épisode ;
//   · l'alerte n'est routée que vers les canaux GLOBAUX : un canal propre à une
//     application ne la reçoit pas ;
//   · le tick revenu ferme la fenêtre, datée de lui ; un nouvel épisode a sa propre
//     fenêtre et sa propre alerte ;
//   · dans la passe du notifier, l'alerte est livrée PAR CETTE PASSE ;
//   · l'étage `ordonnanceur` reste hors de la collecte : `check_alerts` ne passe
//     pas les règles « hors collecte » pour lui.
//
// Chaque cas tourne dans une transaction ANNULÉE : rien ne reste dans la base
// partagée par les autres fichiers (bail, drapeau, alertes et livraisons compris).
// `now()` y est figé au début de la transaction : les âges se posent relativement à lui.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { creerVeilleOrdonnanceur, ETAGE_VEILLE } from "../../packages/backend/jobs/veille-ordonnanceur.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { creerLivreur } from "../../packages/backend/jobs/livreur.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce } from "../../packages/backend/lib/dispatch-alerts.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const GLOBAL = "https://hooks.veille.example.test/global";
const PROPRE = "https://hooks.veille.example.test/application";
const APP = "veille-ordo-app";
const muet = { debug() {}, info() {}, warn() {}, error() {} };

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("veille de l'ordonnanceur sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});

  /**
   * Exécute `corps` dans une transaction toujours annulée. Le client tient lieu de
   * pool ; ce que le dispatcher croit être ses transactions devient des points de
   * sauvegarde de celle-ci.
   */
  async function annulee<T>(corps: (c: pg.PoolClient, poolTx: object) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    const poolTx = {
      query: (q: string | object, p?: unknown[]) => c.query(q as string, p),
      connect: async () => ({
        query: (q: string | object, p?: unknown[]) =>
          q === "begin"
            ? c.query("savepoint livraison")
            : q === "commit"
              ? c.query("release savepoint livraison")
              : q === "rollback"
                ? c.query("rollback to savepoint livraison")
                : c.query(q as string, p),
        release() {},
      }),
    };
    try {
      await c.query("begin");
      return await corps(c, poolTx);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  /** Le bail du tick : son échéance passée EST le dernier tick abouti (`bail.mjs`). */
  const tick = (c: pg.PoolClient, ilYaS: number) =>
    c.query(
      `insert into scheduler_lease (job, holder, expires_at) values ('tick', 'veille-test', now() - make_interval(secs => $1))
       on conflict (job) do update set holder = excluded.holder, expires_at = excluded.expires_at`,
      [ilYaS],
    );

  /** Le décor : cadence publiée, un canal global, un canal propre à une application. */
  async function decor(c: pg.PoolClient) {
    await c.query(
      `insert into platform_flag (key, value, updated_by) values ('scheduler_tick_min', '15', 'veille-test')
       on conflict (key) do update set value = excluded.value`,
    );
    await c.query("insert into app_registry (app_id, name, active) values ($1, $1, true) on conflict (app_id) do nothing", [APP]);
    await c.query(
      `insert into notify_channel (app_id, kind, target, severity_min) values (null, 'webhook', $1, 'critical'), ($2, 'webhook', $3, 'warning')`,
      [GLOBAL, APP, PROPRE],
    );
  }

  /** Une veille dont chaque appel passe (pas d'écart minimal entre deux). */
  const veille = (poolTx: object) => creerVeilleOrdonnanceur({ pool: poolTx, log: muet, veilleMinMs: 0 });

  const fenetres = async (c: pg.PoolClient) =>
    (await c.query(
      `select id, etat, source, fin is null as ouverte, alerte_event_id,
              debut = (select expires_at from scheduler_lease where job = 'tick') as debut_au_tick, cause, preuve
         from collecte_fenetre where portee = '*' and etage = $1 order by id`,
      [ETAGE_VEILLE],
    )).rows;

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it("un tick manqué ne suffit pas ; au-delà de 2 × 15 + 5 min, UNE fenêtre et UNE alerte, routée vers les seuls canaux globaux", async () => {
    await annulee(async (c, poolTx) => {
      await decor(c);
      const v = veille(poolTx);

      // 31 min : un tick manqué (un redéploiement). Rien.
      await tick(c, 31 * 60);
      expect(await v.veiller()).toMatchObject({ action: "rien", seuil_min: 35, cadence_publiee: true });
      expect(await fenetres(c)).toEqual([]);

      // 45 min : sur la grille du quart d'heure, la passe qui suit le troisième tick
      // manqué (la deuxième n'en voit que 30). La fenêtre s'ouvre, datée du dernier tick abouti.
      await tick(c, 45 * 60);
      const ouverture = await v.veiller();
      expect(ouverture).toMatchObject({ action: "ouvrir", silence_min: 45 });
      const [f] = await fenetres(c);
      expect(f).toMatchObject({ etat: "interrompue", source: "sonde", ouverte: true, debut_au_tick: true });
      expect(Number(f.alerte_event_id)).toBe(ouverture.alerte_id);
      expect(f.cause).toMatch(/^travaux planifiés muets/);
      expect(f.preuve).toContain("constaté par le notifier");

      const { rows: [ev] } = await c.query("select rule_id, slo_id, severity, message from alert_event where id = $1", [ouverture.alerte_id]);
      expect(ev).toMatchObject({ rule_id: null, slo_id: null, severity: "critical" });
      expect(ev.message).toMatch(/^Travaux planifiés muets : aucun tick abouti depuis 45 min/);
      const { rows: livraisons } = await c.query(
        "select target, status from alert_delivery where alert_event_id = $1 and target in ($2, $3)",
        [ouverture.alerte_id, GLOBAL, PROPRE],
      );
      expect(livraisons).toEqual([{ target: GLOBAL, status: "queued" }]);
    });
  });

  it("une alerte par épisode, jamais deux : les passes suivantes ne lèvent rien, une fenêtre sans alerte en reçoit une seule", async () => {
    await annulee(async (c, poolTx) => {
      await decor(c);
      await tick(c, 50 * 60);
      const v = veille(poolTx);
      const premiere = await v.veiller();
      expect(premiere.action).toBe("ouvrir");
      for (let k = 0; k < 3; k++) expect(await v.veiller()).toMatchObject({ action: "rien", raison: "épisode en cours" });
      // Un second notifier (une autre réplique) : la même fenêtre, aucune alerte de plus.
      expect(await veille(poolTx).veiller()).toMatchObject({ action: "rien", raison: "épisode en cours" });
      // `fired_at` vaut `now()`, figé au début de la transaction : les alertes de CE cas.
      const alertes = async () =>
        (await c.query("select count(*)::int as n from alert_event where message like 'Travaux planifiés muets%' and fired_at = now()")).rows[0].n;
      expect(await alertes()).toBe(1);
      expect(await fenetres(c)).toHaveLength(1);

      // Une passe interrompue entre l'ouverture et l'alerte : la suivante alerte, une fois.
      await c.query("update collecte_fenetre set alerte_event_id = null where portee = '*' and etage = $1", [ETAGE_VEILLE]);
      expect(await v.veiller()).toMatchObject({ action: "alerter" });
      expect(await v.veiller()).toMatchObject({ action: "rien" });
      expect(await alertes()).toBe(2); // la première, détachée à la main, et celle-ci : jamais une troisième
    });
  });

  it("le tick revenu ferme la fenêtre, datée de lui ; un nouvel épisode a sa fenêtre et son alerte", async () => {
    await annulee(async (c, poolTx) => {
      await decor(c);
      const v = veille(poolTx);
      await tick(c, 60 * 60);
      const ouverture = await v.veiller();
      expect(ouverture.action).toBe("ouvrir");

      // Un tick en cours (échéance future) ne prouve encore rien : la fenêtre reste ouverte.
      await c.query("update scheduler_lease set expires_at = now() + interval '9 minutes' where job = 'tick'");
      expect(await v.veiller()).toMatchObject({ action: "rien", raison: "tick en cours" });
      expect((await fenetres(c))[0].ouverte).toBe(true);

      // Le tick abouti : la ligne expire à sa fin, 20 s avant maintenant.
      await tick(c, 20);
      expect(await v.veiller()).toMatchObject({ action: "fermer" });
      const { rows: [close] } = await c.query(
        `select fin = now() - interval '20 seconds' as fin_au_tick, alerte_event_id from collecte_fenetre
          where portee = '*' and etage = $1`,
        [ETAGE_VEILLE],
      );
      expect(close).toMatchObject({ fin_au_tick: true });
      expect(Number(close.alerte_event_id)).toBe(ouverture.alerte_id);
      expect(await v.veiller()).toMatchObject({ action: "rien" });
    });

    // Un épisode d'avant, clos ; le tick se tait de nouveau.
    await annulee(async (c, poolTx) => {
      await decor(c);
      await c.query(
        `insert into collecte_fenetre (portee, etage, etat, debut, fin, source, alerte_event_id)
         values ('*', $1, 'interrompue', now() - interval '3 hours', now() - interval '2 hours', 'sonde', -1)`,
        [ETAGE_VEILLE],
      );
      await tick(c, 40 * 60);
      const nouveau = await veille(poolTx).veiller();
      expect(nouveau).toMatchObject({ action: "ouvrir" });
      const lignes = await fenetres(c);
      expect(lignes.map((f) => f.ouverte)).toEqual([false, true]);
      expect(Number(lignes[1].alerte_event_id)).toBe(nouveau.alerte_id);
    });
  });

  it("dans la passe du notifier : l'alerte du tick muet est LIVRÉE par cette passe", async () => {
    await annulee(async (c, poolTx) => {
      // Ce qui attendait dans la base partagée ne part pas : seule l'alerte de ce cas est en file.
      await c.query("update alert_delivery set status = 'skipped' where status in ('queued', 'failed')");
      await decor(c);
      await tick(c, 45 * 60);
      const recus: { cible: string; corps: string }[] = [];
      const fetchImpl = async (cible: string, init: { body: string }) => {
        recus.push({ cible, corps: String(init.body) });
        return { status: 200, ok: true, body: null } as unknown as Response;
      };
      const livreur = creerLivreur({
        pool: poolTx,
        log: muet,
        dispatch: (p: unknown, o: object) => dispatchOnce(p, { ...o, fetchImpl }),
      });
      const bilan = await livreur.passe();
      expect(bilan.ok).toBe(true);
      const { veille_ordonnanceur: v } = await livreur.etat();
      expect(v).toMatchObject({ action: "ouvrir" });
      const { rows } = await c.query("select target, status, response from alert_delivery where alert_event_id = $1 and target in ($2, $3)", [
        v.alerte_id,
        GLOBAL,
        PROPRE,
      ]);
      expect(rows).toEqual([{ target: GLOBAL, status: "delivered", response: "http 200" }]);
      const recu = recus.find((r) => r.cible === GLOBAL);
      expect(JSON.parse(recu!.corps)).toMatchObject({ severity: "critical", text: expect.stringMatching(/^\[MIP RUM\] Travaux planifiés muets/) });
      expect(recus.some((r) => r.cible === PROPRE)).toBe(false);
    });
  });

  it("hors de la collecte : la fenêtre `ordonnanceur` ouverte, une règle franchie déclenche comme avant", async () => {
    await annulee(async (c, poolTx) => {
      await decor(c);
      await tick(c, 45 * 60);
      expect((await veille(poolTx).veiller()).action).toBe("ouvrir");
      // La fenêtre de la veille ne retire aucune mesure : le collector l'a écrite
      // lui-même. (Au premier tick revenu, `planReconstitution` posera, elle, une
      // fenêtre de la chaîne sur le silence : ce n'est pas l'objet de ce cas.)
      // LCP de 5 000 ms, seuil de 2 500.
      await c.query("insert into rum_session (session_id, app_id) values ($1, $2)", [`${APP}-s0`, APP]);
      await c.query(
        "insert into rum_metric (span_id, session_id, app_id, route, name, value, ts) values ('veille-m-1', $1, $2, '/', 'LCP', 5000, now() - interval '5 minutes')",
        [`${APP}-s0`, APP],
      );
      const { rows: [r] } = await c.query(
        `insert into alert_rule (app_id, metric, comparator, threshold, window_minutes, mode, severity)
         values ($1, 'LCP', '>', 2500, 60, 'threshold', 'warning') returning id`,
        [APP],
      );
      await c.query("select check_alerts()");
      const { rows: [etat] } = await c.query("select last_state, last_value from alert_rule where id = $1", [r.id]);
      expect(etat).toMatchObject({ last_state: "breached", last_value: 5000 });
    });
  });
});
