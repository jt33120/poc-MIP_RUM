// migration-v108 — l'escalade des alertes, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · qu'un déclenchement NON ACQUITTÉ reçoit une livraison de niveau 1 à son
//     délai, puis de niveau 2 au sien, jamais avant, jamais deux fois ; que le
//     dernier niveau relance à sa cadence jusqu'au plafond ; et que l'acquittement
//     arrête TOUT — y compris l'envoi déjà en file, que le livreur solde ;
//   · que l'escalade ne déborde pas : ni sur un déclenchement antérieur à l'étape,
//     ni sous la sévérité de l'étape, ni vers un canal éteint ou d'une autre
//     application, ni sur une alerte sans application (qu'on ne peut pas acquitter) ;
//   · que deux passes concurrentes n'envoient pas deux fois le même niveau ;
//   · que le livreur marque le texte (« Niveau 1 », « Relance 1 / niveau 2 ») ;
//   · que l'heure d'acquittement ne vaut que pour les déclenchements nés après v108.
//
// Le temps est celui qu'on passe à `escalate_alerts(p_maintenant)` : les échéances
// se rejouent à la minute près, sans attendre.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce } from "../../packages/backend/lib/dispatch-alerts.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
/** Préfixe de ce fichier : le nettoyage ne touche rien d'autre. */
const APP = "v108-escalade";
const AUTRE = "v108-escalade-autre";
const HOOK_N1 = "https://hooks.v108.example.test/niveau-1";
const HOOK_N2 = "https://hooks.v108.example.test/niveau-2";
const HOOK_AUTRE = "https://hooks.v108.example.test/autre-app";
const HOOK_ETEINT = "https://hooks.v108.example.test/eteint";
/** L'instant de référence des déclenchements : les échéances se comptent depuis lui. */
const T0 = new Date("2026-09-30T08:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000).toISOString();

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("v108 — escalate_alerts et le livreur sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});
  const ids: { regle: number; canalN1: number; canalN2: number; canalAutre: number; canalEteint: number } = {
    regle: 0,
    canalN1: 0,
    canalN2: 0,
    canalAutre: 0,
    canalEteint: 0,
  };

  async function nettoyer() {
    await pool.query("delete from alert_event where message like 'v108-%'");
    await pool.query("delete from alert_rule where app_id in ($1, $2)", [APP, AUTRE]);
    await pool.query("delete from notify_channel where target like 'https://hooks.v108.example.test/%'");
  }

  /** Un déclenchement de la règle de l'app, à T0 + `aMin` minutes. */
  async function declencher(message: string, { aMin = 0, severity = "warning", regle = ids.regle as number | null } = {}) {
    const { rows: [{ id }] } = await pool.query<{ id: string }>(
      "insert into alert_event (rule_id, fired_at, value, message, severity) values ($1, $2, 1, $3, $4) returning id",
      [regle, min(aMin), message, severity],
    );
    return Number(id);
  }

  /** Une étape créée une heure avant T0 : elle vaut pour les déclenchements de T0. */
  async function etape(o: { app: string | null; niveau: number; delai: number; canal: number; severite?: string; relance?: [number, number] }) {
    const { rows: [{ id }] } = await pool.query<{ id: string }>(
      `insert into alert_escalation_step (app_id, severity_min, level, delay_minutes, channel_id, repeat_minutes, repeat_max, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [o.app, o.severite ?? "warning", o.niveau, o.delai, o.canal, o.relance?.[0] ?? null, o.relance?.[1] ?? null, min(-60)],
    );
    return Number(id);
  }

  const escalader = async (aMin: number) =>
    Number((await pool.query<{ n: number }>("select escalate_alerts($1) as n", [min(aMin)])).rows[0].n);

  const envois = async (evenement: number) =>
    (
      await pool.query<{ target: string; niveau: number; relance: number; status: string }>(
        `select target, escalation_level as niveau, escalation_relance as relance, status
           from alert_delivery where alert_event_id = $1 and escalation_level is not null
          order by id`,
        [evenement],
      )
    ).rows;

  const canal = async (app: string | null, target: string, active = true) =>
    Number(
      (
        await pool.query<{ id: string }>(
          "insert into notify_channel (app_id, kind, target, severity_min, active) values ($1, 'webhook', $2, 'critical', $3) returning id",
          [app, target, active],
        )
      ).rows[0].id,
    );

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
    for (const app of [APP, AUTRE]) {
      await pool.query("insert into app_registry (app_id, name) values ($1, $1) on conflict (app_id) do nothing", [app]);
    }
    ids.regle = Number(
      (
        await pool.query<{ id: string }>(
          "insert into alert_rule (app_id, metric, comparator, threshold, window_minutes, active) values ($1, 'LCP', '>', 2500, 15, false) returning id",
          [APP],
        )
      ).rows[0].id,
    );
    // Les canaux d'escalade sont réglés à `critical` : le routage NOMINAL d'une alerte
    // `warning` ne les sert pas, seule l'étape le fait — ce qui est compté ici.
    ids.canalN1 = await canal(APP, HOOK_N1);
    ids.canalN2 = await canal(null, HOOK_N2);
    ids.canalAutre = await canal(AUTRE, HOOK_AUTRE);
    ids.canalEteint = await canal(APP, HOOK_ETEINT, false);
    await etape({ app: APP, niveau: 1, delai: 5, canal: ids.canalN1 });
    await etape({ app: APP, niveau: 2, delai: 30, canal: ids.canalN2, relance: [20, 2] });
    // Un canal éteint ne reçoit rien ; une étape globale n'envoie jamais vers le canal
    // d'une autre application.
    await etape({ app: APP, niveau: 1, delai: 5, canal: ids.canalEteint });
    await etape({ app: null, niveau: 1, delai: 0, canal: ids.canalAutre });
  }, 300_000);

  afterAll(async () => {
    await nettoyer();
    await pool.query("delete from app_registry where app_id in ($1, $2)", [APP, AUTRE]);
    await pool.end();
  });

  it("critère 1 : niveau 1 à 5 min, niveau 2 à 30 min, relances à 20 min jusqu'au plafond — puis plus rien après l'acquittement", async () => {
    const ev = await declencher("v108-escalade-nominale");
    expect(await escalader(4)).toBe(0);
    expect(await envois(ev)).toEqual([]);

    // 5 min : le niveau 1, vers son seul canal actif de l'app.
    expect(await escalader(5)).toBe(1);
    expect(await envois(ev)).toEqual([{ target: HOOK_N1, niveau: 1, relance: 0, status: "queued" }]);
    // Repasser ne renvoie rien : un envoi par niveau.
    expect(await escalader(12)).toBe(0);
    expect(await escalader(29)).toBe(0);

    // 30 min : le niveau 2.
    expect(await escalader(30)).toBe(1);
    expect((await envois(ev)).map((e) => [e.niveau, e.relance, e.target])).toEqual([
      [1, 0, HOOK_N1],
      [2, 0, HOOK_N2],
    ]);
    // Le niveau 2 est le dernier : il relance toutes les 20 min, deux fois au plus.
    expect(await escalader(49)).toBe(0);
    expect(await escalader(50)).toBe(1);
    expect(await escalader(55)).toBe(0);
    expect(await escalader(70)).toBe(1);
    expect(await escalader(200)).toBe(0);
    expect((await envois(ev)).map((e) => [e.niveau, e.relance])).toEqual([
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  it("critère 1 (suite) : l'acquittement arrête l'escalade, même au milieu", async () => {
    const ev = await declencher("v108-escalade-acquittee");
    expect(await escalader(6)).toBe(1);
    await pool.query("update alert_event set acknowledged = true, acknowledged_at = $2 where id = $1", [ev, min(10)]);
    expect(await escalader(31)).toBe(0);
    expect(await escalader(90)).toBe(0);
    expect((await envois(ev)).map((e) => e.niveau)).toEqual([1]);
  });

  it("un tick manqué ne rattrape pas les relances sautées, et le premier envoi d'un niveau précède ses relances", async () => {
    const ev = await declencher("v108-escalade-rattrapage");
    // Le scheduler revient 2 h après : niveau 1 et niveau 2 partent, rang 0 chacun.
    expect(await escalader(120)).toBe(2);
    expect((await envois(ev)).map((e) => [e.niveau, e.relance])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    // Au passage suivant, la relance due la plus récente (plafonnée à 2), une seule.
    expect(await escalader(135)).toBe(1);
    expect((await envois(ev)).map((e) => [e.niveau, e.relance])).toEqual([
      [1, 0],
      [2, 0],
      [2, 2],
    ]);
    expect(await escalader(300)).toBe(0);
  });

  it("aucune escalade hors de son périmètre : sévérité, antériorité, alerte sans application, 7 jours", async () => {
    // Sous la sévérité des étapes.
    const info = await declencher("v108-escalade-info", { severity: "info" });
    // Né AVANT la création des étapes (T0 − 60 min) : l'arriéré ne s'escalade pas.
    const ancien = await declencher("v108-escalade-anterieur", { aMin: -90 });
    // Sans règle, ni SLO, ni issue : aucune application, aucun acquittement possible.
    const sansApp = await declencher("v108-escalade-sans-app", { regle: null });
    expect(await escalader(60)).toBeGreaterThanOrEqual(0);
    for (const ev of [info, ancien, sansApp]) expect(await envois(ev), String(ev)).toEqual([]);

    // Plus de 7 jours après son déclenchement, un déclenchement ouvert n'escalade plus.
    const vieux = await declencher("v108-escalade-vieux");
    expect(await escalader(8 * 24 * 60)).toBe(0);
    expect(await envois(vieux)).toEqual([]);
  });

  it("deux passes concurrentes n'envoient le même niveau qu'une fois", async () => {
    const ev = await declencher("v108-escalade-concurrente");
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const premiere = await a.query<{ n: number }>("select escalate_alerts($1) as n", [min(6)]);
      // La seconde passe bute sur l'index unique tenu par la première, puis cède.
      const seconde = b.query<{ n: number }>("select escalate_alerts($1) as n", [min(6)]);
      await a.query("commit");
      const n2 = (await seconde).rows[0].n;
      await b.query("commit");
      expect(Number(premiere.rows[0].n)).toBeGreaterThanOrEqual(1);
      expect(Number(n2)).toBe(0);
    } finally {
      a.release();
      b.release();
    }
    expect((await envois(ev)).map((e) => e.niveau)).toEqual([1]);
  });

  it("le livreur marque le niveau et la relance, et solde l'envoi d'un déclenchement acquitté entre-temps", async () => {
    const ev = await declencher("v108-escalade-livree");
    await escalader(31);
    const acquitte = await declencher("v108-escalade-solde");
    await escalader(6);
    await pool.query("update alert_event set acknowledged = true, acknowledged_at = now() where id = $1", [acquitte]);

    const recus: { cible: string; corps: { text: string; escalation?: { level: number; relance: number } } }[] = [];
    const fetchImpl = async (cible: string, init: { body: string }) => {
      recus.push({ cible, corps: JSON.parse(init.body) });
      return { status: 200, ok: true, body: null } as unknown as Response;
    };
    // Le livreur prend la première ligne éligible de TOUTE la base : celles qui ne sont
    // pas de ce test sont tenues verrouillées le temps de la passe (`skip locked`).
    const gardien = await pool.connect();
    try {
      await gardien.query("begin");
      await gardien.query(
        `select d.id from alert_delivery d where d.status in ('queued', 'failed')
            and d.alert_event_id not in ($1, $2) for update of d`,
        [ev, acquitte],
      );
      await dispatchOnce(pool, { fetchImpl });
    } finally {
      await gardien.query("rollback").catch(() => {});
      gardien.release();
    }
    const textes = recus.map((r) => r.corps.text);
    expect(textes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\[MIP RUM\] Niveau 1, non acquittée — LCP > /),
        expect.stringMatching(/^\[MIP RUM\] Niveau 2, non acquittée — LCP > /),
      ]),
    );
    expect(recus.find((r) => r.cible === HOOK_N2)?.corps.escalation).toEqual({ level: 2, relance: 0 });
    // L'envoi du déclenchement acquitté n'est pas parti : soldé, avec la raison.
    const { rows: [solde] } = await pool.query("select status, response, attempts from alert_delivery where alert_event_id = $1", [acquitte]);
    expect(solde).toMatchObject({ status: "skipped", attempts: 0, response: expect.stringMatching(/acquitté avant l'envoi/) });
    expect(recus.some((r) => r.corps.text.includes("v108-escalade-solde"))).toBe(false);

    // Une relance porte son rang.
    await escalader(55);
    const relance = (await envois(ev)).find((e) => e.relance === 1);
    expect(relance).toMatchObject({ niveau: 2, status: "queued" });
  });

  it("un déclenchement né après v108 est dans le périmètre du MTTA ; l'acquittement garde son heure et son auteur", async () => {
    const ev = await declencher("v108-escalade-mtta");
    await pool.query("update alert_event set acknowledged = true, acknowledged_at = $2, acknowledged_by = 'ops@example.test' where id = $1", [ev, min(12)]);
    const { rows: [r] } = await pool.query(
      "select acquittement_horodate, extract(epoch from acknowledged_at - fired_at)::int as delai_s, acknowledged_by from alert_event where id = $1",
      [ev],
    );
    expect(r).toEqual({ acquittement_horodate: true, delai_s: 720, acknowledged_by: "ops@example.test" });
  });

  it("rejouer v108 ne change rien : ni colonne, ni étape, ni défaut", async () => {
    const avant = await pool.query("select count(*)::int as n from alert_escalation_step");
    await pool.query(readFileSync(join(SQL_DIR, "migration-v108.sql"), "utf8"));
    expect((await pool.query("select count(*)::int as n from alert_escalation_step")).rows[0].n).toBe(avant.rows[0].n);
    const { rows: [d] } = await pool.query(
      `select column_default from information_schema.columns where table_name = 'alert_event' and column_name = 'acquittement_horodate'`,
    );
    expect(d.column_default).toBe("true");
  });
});
