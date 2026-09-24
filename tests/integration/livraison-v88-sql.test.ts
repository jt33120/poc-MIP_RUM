// P5 — migration-v88 et le livreur, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans le code :
//
//   · que `route_alert` met en file une livraison par canal éligible, e-mail
//     compris, SANS la solder : c'était le défaut relevé en production — aucune
//     livraison e-mail n'arrivait jusqu'à un livreur ;
//   · que le dispatcher, sur la vraie table, solde un e-mail `skipped` avec sa
//     raison quand il n'a pas la clé (le scheduler), et `delivered` avec
//     l'identifiant Resend quand il l'a (le notifier) ; qu'un échec rejoué garde
//     la MÊME clé d'idempotence, donc aucun second envoi chez Resend ;
//   · que les webhooks partent signés, corps et signature concordants ;
//   · que la contrainte v88 refuse une référence de ticket hors `env:TICKET_…`,
//     et qu'une ligne de l'ancienne forme est neutralisée par la migration
//     (désactivée, `degraded`) au lieu de rester active et refusée en silence ;
//   · que l'URL du relais e-mail (un secret en clair) est effacée.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce } from "../../packages/backend/lib/dispatch-alerts.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { configEmail } from "../../packages/backend/lib/net/resend.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { verifierSignature } from "../../packages/backend/lib/net/signature-webhook.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V88 = readFileSync(join(SQL_DIR, "migration-v88.sql"), "utf8");
/** Préfixe des apps de ce fichier : le nettoyage ne touche rien d'autre. */
const APP = "p5-livraison";
const MAIL = "ops-p5@example.com";
const HOOK = "https://hooks.p5.example.test/alerte";
const SECRET = "p5-signature-".padEnd(40, "x");
const EMAIL = configEmail({ RESEND_API_KEY: "re_test", ALERT_EMAIL_FROM: "onboarding@resend.dev", ALERT_EMAIL_TEST_RECIPIENTS: MAIL });

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("P5 — route_alert v88 et le livreur sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});

  async function nettoyer() {
    await pool.query("delete from alert_event where message like 'p5-%'");
    await pool.query("delete from notify_channel where app_id = $1", [APP]);
    await pool.query("delete from ticket_integration where app_id = $1", [APP]);
  }

  /** Un événement et son routage ; rend l'identifiant de l'événement. */
  async function router(severity: string): Promise<number> {
    const { rows: [{ id }] } = await pool.query<{ id: string }>(
      "insert into alert_event (rule_id, value, message, severity) values (null, 1, 'p5-evenement', $1) returning id",
      [severity],
    );
    await pool.query("select route_alert($1, $2, $3, '[MIP RUM] p5 : alerte de test', '{}'::jsonb)", [id, APP, severity]);
    return Number(id);
  }

  /**
   * Le dispatcher ne voit QUE les livraisons de ce fichier. Il prend la première
   * ligne éligible de toute la base : les restes d'autres fichiers sont tenus
   * verrouillés par un gardien le temps de la passe — `skip locked` les saute,
   * sans que ce fichier écrive dans des lignes qui ne sont pas les siennes.
   */
  async function passe(options: Record<string, unknown>) {
    const gardien = await pool.connect();
    try {
      await gardien.query("begin");
      await gardien.query(
        `select d.id from alert_delivery d join alert_event e on e.id = d.alert_event_id
          where d.status in ('queued', 'failed') and e.message not like 'p5-%' for update of d`,
      );
      return await dispatchOnce(pool, options);
    } finally {
      await gardien.query("rollback").catch(() => {});
      gardien.release();
    }
  }

  const livraison = async (evenement: number, cible: string) =>
    (await pool.query("select id, status, response, attempts from alert_delivery where alert_event_id = $1 and target = $2", [evenement, cible])).rows[0];

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
    await pool.query(
      `insert into notify_channel (app_id, kind, target, severity_min) values
         ($1, 'email', $2, 'warning'), ($1, 'webhook', $3, 'warning'), ($1, 'slack', 'https://hooks.p5.example.test/critique', 'critical')`,
      [APP, MAIL, HOOK],
    );
  }, 300_000);

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("route_alert met en file l'e-mail ET le webhook, sans rien solder ; la sévérité filtre", async () => {
    const ev = await router("warning");
    const { rows } = await pool.query("select target, status, response from alert_delivery where alert_event_id = $1 order by target", [ev]);
    expect(rows).toEqual([
      { target: HOOK, status: "queued", response: null },
      { target: MAIL, status: "queued", response: null },
    ]);
  });

  it("sans clé (le scheduler) : l'e-mail est soldé skipped avec la raison, le webhook part", async () => {
    const ev = await router("warning");
    const recus: string[] = [];
    const fetchImpl = async (cible: string) => {
      recus.push(cible);
      return { status: 200, ok: true, body: null } as unknown as Response;
    };
    await passe({ fetchImpl });
    expect(await livraison(ev, MAIL)).toMatchObject({ status: "skipped", attempts: 0, response: expect.stringMatching(/RESEND_API_KEY.*notifier/) });
    expect(await livraison(ev, HOOK)).toMatchObject({ status: "delivered", response: "http 200" });
    expect(recus.every((c) => c === HOOK)).toBe(true);
  });

  it("avec la clé (le notifier) : delivered avec l'id Resend ; un échec rejoué garde la même clé d'idempotence", async () => {
    const ev = await router("warning");
    const cles: string[] = [];
    let reponse = 503;
    const fetchMail = async (_u: string, init: RequestInit) => {
      cles.push((init.headers as Record<string, string>)["idempotency-key"]);
      return { status: reponse, ok: reponse < 300, text: async () => JSON.stringify(reponse < 300 ? { id: "re-p5" } : { name: "internal_server_error" }) } as unknown as Response;
    };
    const fetchImpl = async () => ({ status: 200, ok: true, body: null }) as unknown as Response;
    await passe({ email: EMAIL, fetchMail, fetchImpl });
    const echec = await livraison(ev, MAIL);
    expect(echec).toMatchObject({ status: "failed", attempts: 1 });
    // Le recul de 30 s est écoulé : la passe suivante la reprend.
    await pool.query("update alert_delivery set attempted_at = now() - interval '5 minutes' where id = $1", [echec.id]);
    reponse = 200;
    await passe({ email: EMAIL, fetchMail, fetchImpl });
    expect(await livraison(ev, MAIL)).toMatchObject({ status: "delivered", attempts: 2, response: "resend re-p5" });
    expect(cles).toEqual([`mip-delivery-${echec.id}`, `mip-delivery-${echec.id}`]);
  });

  it("les webhooks partent signés : le destinataire vérifie le corps reçu", async () => {
    const ev = await router("warning");
    let recu: { headers: Record<string, string>; body: string } | null = null;
    const fetchImpl = async (_u: string, init: RequestInit) => {
      recu = { headers: init.headers as Record<string, string>, body: String(init.body) };
      return { status: 204, ok: true, body: null } as unknown as Response;
    };
    await passe({ fetchImpl, secretSignature: SECRET, email: EMAIL, fetchMail: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
    const d = await livraison(ev, HOOK);
    expect(d.status).toBe("delivered");
    expect(recu!.headers["x-mip-delivery-id"]).toBe(String(d.id));
    expect(verifierSignature({ secrets: [SECRET], entetes: recu!.headers, corps: recu!.body })).toEqual({ ok: true });
  });

  it("références de tickets : hors env:TICKET_… refusé à l'écriture ; une ligne héritée est NEUTRALISÉE, jamais laissée active", async () => {
    const inserer = (cible: string, ref: string, webhook: string | null = null) =>
      pool.query(
        "insert into ticket_integration (app_id, provider, target, credential_ref, webhook_secret_ref, enabled) values ($1, 'github', $2, $3, $4, true)",
        [APP, cible, ref, webhook],
      );
    await expect(inserer("p5/a", "env:DATABASE_URL")).rejects.toThrow(/ticket_integration_credential_v88/);
    await expect(inserer("p5/b", "env:TICKET_SECRET_KEY")).rejects.toThrow(/ticket_integration_credential_v88/);
    await expect(inserer("p5/c", "env:TICKET_INTEGRATIONS")).rejects.toThrow(/ticket_integration_credential_v88/);
    await expect(inserer("p5/d", "env:TICKET_GITHUB_TOKEN", "env:AUTH_SECRET")).rejects.toThrow(/ticket_integration_webhook_v88/);
    await expect(inserer("p5/e", "env:TICKET_GITHUB_TOKEN", "env:TICKET_GITHUB_WEBHOOK")).resolves.toBeTruthy();

    // Des lignes de l'ancienne forme, écrites avant v88 : les contraintes ôtées le
    // temps de les écrire, puis la migration rejouée.
    await pool.query("alter table ticket_integration drop constraint ticket_integration_credential_v88");
    await pool.query("alter table ticket_integration drop constraint ticket_integration_webhook_v88");
    await inserer("p5/ancienne", "env:DATABASE_URL");
    await inserer("p5/webhook-ancien", "env:TICKET_GITHUB_TOKEN", "env:AUTH_SECRET");
    await pool.query(V88);
    const { rows } = await pool.query(
      `select target, credential_ref, webhook_secret_ref, enabled, state, last_error, config_version
         from ticket_integration where app_id = $1 and target in ('p5/ancienne', 'p5/webhook-ancien', 'p5/e') order by target`,
      [APP],
    );
    expect(rows).toEqual([
      { target: "p5/ancienne", credential_ref: "env:TICKET_REFERENCE_REFUSEE_V88", webhook_secret_ref: null, enabled: false, state: "degraded", last_error: "variable_hors_perimetre", config_version: 2 },
      // Une ligne conforme n'est pas touchée.
      { target: "p5/e", credential_ref: "env:TICKET_GITHUB_TOKEN", webhook_secret_ref: "env:TICKET_GITHUB_WEBHOOK", enabled: true, state: "active", last_error: null, config_version: 1 },
      { target: "p5/webhook-ancien", credential_ref: "env:TICKET_GITHUB_TOKEN", webhook_secret_ref: null, enabled: true, state: "degraded", last_error: "variable_hors_perimetre", config_version: 2 },
    ]);
    // Contraintes VALIDÉES : plus aucune ligne hors périmètre dans la table.
    const contraintes = await pool.query(
      "select conname, convalidated from pg_constraint where conname like 'ticket_integration_%_v88' order by conname",
    );
    expect(contraintes.rows).toEqual([
      { conname: "ticket_integration_credential_v88", convalidated: true },
      { conname: "ticket_integration_webhook_v88", convalidated: true },
    ]);
  });

  it("l'URL du relais e-mail de la console (jeton compris) est effacée", async () => {
    await pool.query("update alert_config set email_relay_url = 'https://console.test/api/alerts/email?token=secret'");
    await pool.query(V88);
    const { rows } = await pool.query("select email_relay_url from alert_config");
    expect(rows.every((r) => r.email_relay_url === null)).toBe(true);
  });
});
