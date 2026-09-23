// P8.6 — le connecteur de tickets sur un VRAI PostgreSQL.
//
// CE QUE CES TESTS CHERCHENT À METTRE EN DÉFAUT, et que relire le code ne
// démontrerait pas :
//
//   · un secret qui finirait en clair dans une colonne de configuration ;
//   · un DOUBLON de ticket chez le client — par double clic, par rejeu du 202,
//     ou par une relance après un délai dépassé qui avait quand même créé ;
//   · un jeton révoqué qui bloquerait la collecte RUM ;
//   · un webhook rejoué qui empilerait des changements de statut ;
//   · un fournisseur qui défairait une décision humaine `ignored` ;
//   · une table de ce lot qu'un effacement client laisserait derrière lui ;
//   · le lien de ticket MANUEL de P5.6 cassé par l'arrivée du connecteur.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { livrerTickets } from "../../packages/backend/lib/integrations/tickets/dispatcher.mjs";
// @ts-expect-error module JS sans déclarations
import { construireCharge, referenceMip } from "../../packages/backend/lib/integrations/tickets/adapter.mjs";
// @ts-expect-error module JS sans déclarations
import { chiffrer } from "../../packages/backend/lib/integrations/tickets/secrets.mjs";
// @ts-expect-error module JS sans déclarations
import { writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { secureOtlpIdentities } from "../../packages/backend/lib/identity-hash.mjs";
// @ts-expect-error module JS sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
import { DSAR_CHILD_TABLES } from "../../apps/console/lib/dsar";

const url = process.env.SQL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const pool = new pg.Pool(url ? { connectionString: url, max: 8 } : { max: 8 });
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const APP = "p86-tickets";
const AUTRE = "p86-tickets-autre";
const ADMIN = "p86-admin@test.local";
const CIBLE = "moi/bac-a-sable";
const CONSOLE = "https://console.test.local";
const CLE_SERVEUR = randomBytes(32).toString("base64");
const ENV = { TICKET_SECRET_KEY: CLE_SERVEUR, GITHUB_TICKETS_TOKEN: "jeton-de-test" };

let compteurSpan = 0;
const spanId = () => (0x8600_0000_0000_0000n + BigInt(++compteurSpan)).toString(16);

/** Une réponse `fetch` toute faite. */
const reponse = (statut: number, corps: unknown, entetes: Record<string, string> = {}) =>
  new Response(typeof corps === "string" ? corps : JSON.stringify(corps), { status: statut, headers: entetes });

/**
 * Un faux `fetch` qui enregistre ses appels : c'est lui qui prouve « une seule
 * création ». Il HONORE le signal d'annulation, comme le vrai : sans cela, un
 * test de délai dépassé ne prouverait que la patience de vitest.
 */
function espion(reponses: ((url: string, init: RequestInit) => Promise<Response> | Response)[]) {
  const appels: { url: string; methode: string; corps: unknown }[] = [];
  let i = 0;
  const impl = (async (u: string, init: RequestInit = {}) => {
    appels.push({
      url: u,
      methode: String(init.method ?? "GET"),
      corps: init.body ? JSON.parse(String(init.body)) : null,
    });
    const faire = reponses[Math.min(i, reponses.length - 1)];
    i++;
    const signal = init.signal as AbortSignal | undefined;
    if (!signal) return faire(u, init);
    return Promise.race([
      Promise.resolve(faire(u, init)),
      new Promise<never>((_, rejeter) => {
        if (signal.aborted) rejeter(new DOMException("aborted", "AbortError"));
        signal.addEventListener("abort", () => rejeter(new DOMException("aborted", "AbortError")), { once: true });
      }),
    ]);
  }) as unknown as typeof fetch;
  return { impl, appels, creations: () => appels.filter((a) => a.methode === "POST") };
}

/** Un lot OTLP aplati par le VRAI parser, comme le port d'ingestion le reçoit. */
function lotReel(app: string, session: string) {
  const ns = (BigInt(Date.now()) - 60_000n) * 1_000_000n;
  const attributs = (v: Record<string, string | number>) =>
    Object.entries(v).map(([key, value]) => ({
      key,
      value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
    }));
  return flattenOtlp(
    secureOtlpIdentities(
      {
        resourceSpans: [
          {
            resource: {
              attributes: attributs({ "mip.app_id": app, "mip.client_id": "p86", "mip.env": "prod" }),
            },
            scopeSpans: [
              {
                spans: [
                  {
                    name: "pageview",
                    traceId: "e".repeat(32),
                    spanId: spanId(),
                    startTimeUnixNano: ns.toString(),
                    endTimeUnixNano: (ns + 1_000_000n).toString(),
                    attributes: attributs({
                      "mip.session_id": session,
                      "mip.route": "/panier",
                      "mip.url": "https://p86.test/panier",
                      "mip.nav_type": "navigate",
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
      "test-only-identity-secret",
    ).payload,
  );
}

async function nettoyer() {
  await pool.query("delete from ticket_integration where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.query("delete from error_issue where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.query("delete from rum_error where app_id = any($1::text[])", [[APP, AUTRE]]);
  // Les tables filles d'une session partent d'abord : c'est `erase_session` qui
  // connaît leur liste, et l'appeler évite d'en tenir une seconde ici.
  const { rows: sessions } = await pool.query<{ session_id: string }>(
    "select session_id from rum_session where app_id = any($1::text[])",
    [[APP, AUTRE]],
  );
  for (const s of sessions) await pool.query("select erase_session($1)", [s.session_id]);
  await pool.query("delete from audit_log where user_email = $1", [ADMIN]);
}

beforeAll(async () => {
  if (!url) return;
  const fichiers = readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  await pool.query(readFileSync(join(SQL_DIR, "schema.sql"), "utf8"));
  for (const f of fichiers) await pool.query(readFileSync(join(SQL_DIR, f), "utf8"));
  for (const app of [APP, AUTRE]) {
    await pool.query(
      `insert into app_registry (app_id, name, active, retention_days) values ($1, $1, true, 30)
       on conflict (app_id) do update set active = true, retention_days = 30, ingestion_suspended_at = null`,
      [app],
    );
  }
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active) values ($1, 'x', 'admin', null, true)
     on conflict (email) do update set active = true`,
    [ADMIN],
  );
  await nettoyer();
}, 300_000);

afterAll(async () => {
  if (!url) return;
  await nettoyer();
  await pool.query("delete from console_user where email = $1", [ADMIN]);
  await pool.query("delete from app_registry where app_id = any($1::text[])", [[APP, AUTRE]]);
  await pool.end();
}, 60_000);

beforeEach(async () => {
  if (!url) return;
  await nettoyer();
});

/** Une intégration prête à livrer. `credential` par défaut : une variable d'environnement. */
async function integration(
  app = APP,
  {
    credential = "env:GITHUB_TICKETS_TOKEN",
    webhook = null as string | null,
    mapping = null as Record<string, string | null> | null,
    enabled = true,
    verifiee = true,
  } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into ticket_integration
       (app_id, provider, target, credential_ref, webhook_secret_ref, enabled, config, verified_at, created_by)
     values ($1, 'github', $2, $3, $4, $5, $6::jsonb, case when $7 then now() end, $8)
     returning id::text as id`,
    [
      app, CIBLE, credential, webhook, enabled,
      JSON.stringify(mapping ? { statusMapping: mapping } : {}), verifiee, ADMIN,
    ],
  );
  return rows[0].id;
}

/** Une issue avec une occurrence réelle, comme l'ingestion l'écrirait. */
async function issue(app = APP, { statut = "open", message = "boom", release = "2026.09.1" } = {}) {
  const cle = randomBytes(16).toString("hex");
  const { rows } = await pool.query<{ id: string; revision: string }>(
    `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, status,
                              first_seen, last_seen, first_release, last_release)
     values ($1, 2, $2, 'normalized_frame', 'new', $3, now() - interval '2 days', now() - interval '1 hour', $4, $4)
     returning id::text as id, revision::text as revision`,
    [app, cle, statut, release],
  );
  await pool.query(
    `insert into rum_session (session_id, app_id) values ($1, $2) on conflict do nothing`,
    [`s-${rows[0].id}`, app],
  );
  // `rum_error_grouping_v72` : une ligne rattachée à une issue porte SA clé de
  // regroupement v2. On l'écrit comme l'ingestion le ferait, pas au plus court.
  const { rows: [erreur] } = await pool.query<{ ts: string }>(
    `insert into rum_error (session_id, app_id, route, message, error_type, ts, occurrences, issue_id,
                            grouping_version, grouping_key, grouping_basis, release, env, span_id)
     values ($1, $2, '/panier', $3, 'TypeError', now() - interval '1 hour', 12, $4, 2, $5, 'normalized_frame', $6, 'prod', $7)
     returning ts`,
    [`s-${rows[0].id}`, app, message, rows[0].id, cle, release, spanId()],
  );
  // `last_seen` de l'issue EST l'horodatage de sa dernière occurrence : c'est
  // ainsi que l'ingestion l'écrit (même transaction), et c'est ce qui permet à la
  // référence de résolution de retrouver la release et l'env de cette occurrence.
  await pool.query("update error_issue set last_seen = $2 where id = $1", [rows[0].id, erreur.ts]);
  return rows[0];
}

/** Inscrit une demande, comme la console le fait, avec la charge figée. */
async function demander(integrationId: string, issueId: string, app = APP) {
  const { rows: [etat] } = await pool.query(
    `select i.id::text as id, i.app_id, i.first_release, i.last_release, i.first_seen, i.last_seen,
            e.error_type, e.message,
            (select sum(x.occurrences)::text from rum_error x where x.app_id = i.app_id and x.issue_id = i.id) as occurrences
       from error_issue i
       left join lateral (select error_type, message from rum_error
                           where app_id = i.app_id and issue_id = i.id order by ts desc, id desc limit 1) e on true
      where i.id = $1`,
    [issueId],
  );
  const charge = construireCharge(
    {
      issueId: etat.id, appId: etat.app_id, errorType: etat.error_type, message: etat.message,
      firstRelease: etat.first_release, lastRelease: etat.last_release,
      occurrences: etat.occurrences === null ? null : Number(etat.occurrences),
      firstSeen: etat.first_seen, lastSeen: etat.last_seen,
    },
    { consoleBase: CONSOLE },
  );
  const { rows: [acteur] } = await pool.query("select id from console_user where email = $1", [ADMIN]);
  const { rows } = await pool.query<{ id: string }>(
    `insert into ticket_outbox (app_id, integration_id, issue_id, idempotency_key, payload, requested_by_user_id)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     on conflict (idempotency_key) do nothing
     returning id::text as id`,
    [app, integrationId, issueId, `ticket:${integrationId}:${issueId}`, JSON.stringify(charge), acteur.id],
  );
  return { jobId: rows[0]?.id ?? null, charge };
}

const ligne = async (id: string) =>
  (
    await pool.query(
      `select state, attempts, external_id, external_url, last_error, uncertain, sent_at
         from ticket_outbox where id = $1`,
      [id],
    )
  ).rows[0];

const CREE_OK = (n = 42) =>
  reponse(201, { number: n, html_url: `https://github.com/${CIBLE}/issues/${n}`, state: "open" });

suite("P8.6 — le schéma refuse ce qui ne doit pas exister", () => {
  it("un secret en clair ne PEUT PAS être écrit dans une configuration", async () => {
    for (const valeur of [
      "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
      "github_pat_11A53H4FI0GD77rUBL7Rx",
      "Bearer abc",
      "",
      "env:minuscules",
    ]) {
      await expect(
        pool.query(
          `insert into ticket_integration (app_id, provider, target, credential_ref) values ($1, 'github', $2, $3)`,
          [APP, CIBLE, valeur],
        ),
      ).rejects.toThrow(/ticket_integration_credential_v84/);
    }
    // Les deux formes acceptées, elles, passent.
    await expect(integration(APP, { credential: "env:GITHUB_TICKETS_TOKEN" })).resolves.toBeTruthy();
    await pool.query("delete from ticket_integration where app_id = $1", [APP]);
    await expect(integration(APP, { credential: chiffrer("jeton", ENV) })).resolves.toBeTruthy();
  });

  it("refuse un fournisseur non implémenté et une cible qui n'est pas « owner/repo »", async () => {
    await expect(
      pool.query(
        `insert into ticket_integration (app_id, provider, target, credential_ref) values ($1, 'jira', $2, 'env:X')`,
        [APP, CIBLE],
      ),
    ).rejects.toThrow(/ticket_integration_v84/);
    await expect(
      pool.query(
        `insert into ticket_integration (app_id, provider, target, credential_ref)
         values ($1, 'github', 'https://github.com/moi/bac', 'env:X')`,
        [APP],
      ),
    ).rejects.toThrow(/ticket_integration_v84/);
  });

  it("la clé d'idempotence est unique : deux demandes identiques ne font qu'une ligne", async () => {
    const integ = await integration();
    const iss = await issue();
    const a = await demander(integ, iss.id);
    const b = await demander(integ, iss.id);
    expect(a.jobId).not.toBeNull();
    expect(b.jobId).toBeNull();
    const { rows } = await pool.query("select count(*)::int as n from ticket_outbox where issue_id = $1", [iss.id]);
    expect(rows[0].n).toBe(1);
  });

  it("une livraison entrante ne peut être enregistrée deux fois", async () => {
    const integ = await integration();
    const insere = () =>
      pool.query(
        `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, status)
         values ($1, $2, 'livraison-1', 'issues', 'applied')`,
        [APP, integ],
      );
    await insere();
    await expect(insere()).rejects.toThrow(/ticket_webhook_event_livraison_v84/);
  });

  it("un `sent` sans identifiant distant est structurellement impossible", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    await expect(
      pool.query("update ticket_outbox set state = 'sent', sent_at = now() where id = $1", [jobId]),
    ).rejects.toThrow(/ticket_outbox_v84/);
  });

  it("un code d'échec ne peut pas être un message : il citerait la donnée", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    await expect(
      pool.query("update ticket_outbox set last_error = $2 where id = $1", [
        jobId,
        'ERROR:  duplicate key value « alice@client.fr »',
      ]),
    ).rejects.toThrow(/ticket_outbox_v84/);
    await expect(
      pool.query("update ticket_outbox set last_error = 'debit_depasse' where id = $1", [jobId]),
    ).resolves.toBeTruthy();
  });
});

suite("P8.6 — le lien de ticket MANUEL de P5.6 survit au connecteur", () => {
  it("un lien collé à la main reste valide, sans fournisseur ni intégration", async () => {
    const iss = await issue();
    await pool.query(
      `insert into error_issue_ticket (app_id, issue_id, url, label)
       values ($1, $2, 'https://tickets.exemple.fr/PROJ-12', 'PROJ-12')`,
      [APP, iss.id],
    );
    const { rows } = await pool.query(
      "select origin, provider, external_id, integration_id from error_issue_ticket where issue_id = $1",
      [iss.id],
    );
    expect(rows[0]).toEqual({ origin: "manual", provider: null, external_id: null, integration_id: null });
    // Aucune intégration n'existe pour cette app : le lien manuel n'en a pas besoin.
    const { rows: n } = await pool.query("select count(*)::int as n from ticket_integration where app_id = $1", [APP]);
    expect(n[0].n).toBe(0);
  });

  it("un lien `connector` SANS fournisseur ni identifiant est refusé", async () => {
    const iss = await issue();
    await expect(
      pool.query(
        `insert into error_issue_ticket (app_id, issue_id, url, label, origin)
         values ($1, $2, 'https://x.test/1', 'X-1', 'connector')`,
        [APP, iss.id],
      ),
    ).rejects.toThrow(/error_issue_ticket_provider_v84/);
  });
});

suite("P8.6 — la livraison, et le doublon qu'elle refuse de créer", () => {
  it("crée le ticket, l'attache à l'issue, l'inscrit au journal et incrémente la révision", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId, charge } = await demander(integ, iss.id);
    const f = espion([() => CREE_OK(101)]);

    const bilan = await livrerTickets(pool, { fetchImpl: f.impl, env: ENV });
    expect(bilan).toMatchObject({ reservees: 1, envoyes: 1, echecs: 0, incertaines: 0 });

    const l = await ligne(jobId!);
    expect(l.state).toBe("sent");
    expect(l.external_id).toBe("101");
    expect(l.external_url).toBe(`https://github.com/${CIBLE}/issues/101`);
    expect(l.uncertain).toBe(false);
    expect(l.sent_at).not.toBeNull();

    // Ce qui est PARTI est exactement ce que l'aperçu avait figé.
    expect(f.creations()[0].corps).toEqual({ title: charge.titre, body: charge.description });

    const { rows: liens } = await pool.query(
      `select url, label, origin, provider, external_id, integration_id::text as integration_id, provider_state
         from error_issue_ticket where issue_id = $1`,
      [iss.id],
    );
    expect(liens).toEqual([
      {
        url: `https://github.com/${CIBLE}/issues/101`,
        label: "GitHub #101",
        origin: "connector",
        provider: "github",
        external_id: "101",
        integration_id: integ,
        provider_state: "open",
      },
    ]);

    const { rows: act } = await pool.query(
      "select kind, actor_kind, event_key from error_issue_activity where issue_id = $1",
      [iss.id],
    );
    expect(act).toEqual([{ kind: "link", actor_kind: "user", event_key: `ticket_cree:${integ}:101` }]);

    const { rows: apres } = await pool.query("select revision::text as revision from error_issue where id = $1", [iss.id]);
    expect(Number(apres[0].revision)).toBe(Number(iss.revision) + 1);
  });

  it("une intégration désactivée, dégradée, ou d'une AUTRE app n'est jamais livrée", async () => {
    const eteinte = await integration(APP, { enabled: false });
    const issA = await issue();
    await demander(eteinte, issA.id);
    const f = espion([() => CREE_OK()]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ reservees: 0 });
    expect(f.creations()).toHaveLength(0);

    await pool.query("update ticket_integration set enabled = true, state = 'degraded' where id = $1", [eteinte]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ reservees: 0 });
    expect(f.creations()).toHaveLength(0);
  });

  it("429 : rejouable, et l'attente demandée par le fournisseur est respectée", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([() => reponse(429, { message: "slow down" }, { "retry-after": "600" })]);
    const t0 = Date.now();
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ rejouables: 1 });
    const { rows } = await pool.query<{ dans: string }>(
      "select extract(epoch from (next_attempt_at - now()))::int::text as dans from ticket_outbox where id = $1",
      [jobId],
    );
    expect(Number(rows[0].dans)).toBeGreaterThan(500);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect((await ligne(jobId!)).last_error).toBe("debit_depasse");
  });

  it("422 : refus définitif, pas de martèlement", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([() => reponse(422, { message: "Validation Failed" })]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ echecs: 1 });
    expect((await ligne(jobId!)).state).toBe("failed");
  });

  it("TIMEOUT APRÈS CRÉATION : le ticket est ADOPTÉ, pas recréé", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const reference = referenceMip(iss.id);
    const f = espion([
      // 1. la création part, la réponse se perd
      () => {
        throw new Error("socket hang up");
      },
      // 2. la recherche par référence trouve le ticket réellement créé
      () =>
        reponse(200, [
          {
            number: 77,
            html_url: `https://github.com/${CIBLE}/issues/77`,
            state: "open",
            body: `blabla\nRéférence MIP : \`${reference}\`\n`,
            created_at: new Date().toISOString(),
          },
        ]),
    ]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ envoyes: 1, incertaines: 0 });
    const l = await ligne(jobId!);
    expect(l.state).toBe("sent");
    expect(l.external_id).toBe("77");
    // UNE seule création tentée, jamais deux.
    expect(f.creations()).toHaveLength(1);
  });

  it("TIMEOUT et recherche NON concluante : `delivery_uncertain`, jamais une seconde création", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([
      () => {
        throw new Error("socket hang up");
      },
      () => reponse(500, { message: "recherche indisponible" }),
    ]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ incertaines: 1 });
    const l = await ligne(jobId!);
    expect(l.state).toBe("delivery_uncertain");
    expect(l.uncertain).toBe(true);
    expect(l.last_error).toBe("livraison_incertaine");
    expect(f.creations()).toHaveLength(1);

    // Et la passe suivante ne la reprend PAS : l'état n'est plus `pending`.
    const g = espion([() => CREE_OK()]);
    expect(await livrerTickets(pool, { fetchImpl: g.impl, env: ENV })).toMatchObject({ reservees: 0 });
    expect(g.creations()).toHaveLength(0);
  });

  it("TIMEOUT et absence PROUVÉE : la demande repart, et ne crée qu'un ticket", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([
      () => {
        throw new Error("socket hang up");
      },
      // Page NON pleine : l'absence est prouvée.
      () => reponse(200, []),
    ]);
    expect(await livrerTickets(pool, { fetchImpl: f.impl, env: ENV })).toMatchObject({ rejouables: 1 });
    expect((await ligne(jobId!)).state).toBe("pending");

    // L'incertitude a été LEVÉE par la recherche : la passe suivante crée
    // directement, sans relire — et une seule fois.
    expect((await ligne(jobId!)).uncertain).toBe(false);
    await pool.query("update ticket_outbox set next_attempt_at = now() where id = $1", [jobId]);
    const g = espion([() => CREE_OK(88)]);
    expect(await livrerTickets(pool, { fetchImpl: g.impl, env: ENV })).toMatchObject({ envoyes: 1 });
    expect(g.creations()).toHaveLength(1);
    expect((await ligne(jobId!)).external_id).toBe("88");
  });

  it("un appel qui ne répond JAMAIS finit sur le délai d'attente, incertain et jamais perdu", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    // Le fournisseur ne répond pas : c'est le signal d'annulation du dispatcher
    // qui tranche, pas une course de promesses qui laisserait la requête vivre.
    const f = espion([
      () =>
        new Promise<Response>(() => {
          /* jamais résolue */
        }),
    ]);
    await livrerTickets(pool, { fetchImpl: f.impl, env: ENV, limite: 1, timeoutMs: 1000 });
    const l = await ligne(jobId!);
    // La tentative est comptée AVANT l'appel : même tuée, la ligne revient armée.
    expect(l.attempts).toBe(1);
    expect(l.uncertain).toBe(true);
    expect(l.state).toBe("delivery_uncertain");
  }, 60_000);
});

suite("P8.6 — révocation de jeton : dégradation, jamais un blocage de la collecte", () => {
  it("401 du fournisseur → intégration `degraded`, et l'ingestion RUM continue", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([() => reponse(401, { message: "Bad credentials" })]);
    await livrerTickets(pool, { fetchImpl: f.impl, env: ENV });

    const { rows } = await pool.query("select state, last_error from ticket_integration where id = $1", [integ]);
    expect(rows[0]).toEqual({ state: "degraded", last_error: "auth_refusee" });
    expect((await ligne(jobId!)).state).toBe("failed");

    // La collecte, elle, n'a rien vu passer : on écrit un lot aplati par le VRAI
    // parser et écrit par le VRAI `writeRows` — celui que P8.1 sérialise avec
    // l'effacement. Un lot fabriqué à la main ne prouverait rien du produit.
    await writeRows(pool, lotReel(APP, "p86-apres-revoc"));
    const { rows: s } = await pool.query("select count(*)::int as n from rum_session where session_id = $1", [
      "p86-apres-revoc",
    ]);
    expect(s[0].n).toBe(1);
    await pool.query("select erase_session($1)", ["p86-apres-revoc"]);
  });

  it("un secret référencé mais absent du runtime dégrade SANS perdre la demande", async () => {
    const integ = await integration(APP, { credential: "env:JETON_JAMAIS_FOURNI" });
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const f = espion([() => CREE_OK()]);
    await livrerTickets(pool, { fetchImpl: f.impl, env: ENV });
    expect(f.creations()).toHaveLength(0);
    const { rows } = await pool.query("select state, last_error from ticket_integration where id = $1", [integ]);
    expect(rows[0]).toEqual({ state: "degraded", last_error: "variable_absente" });
    // La demande reste rejouable après correction : elle n'est pas en échec.
    expect((await ligne(jobId!)).state).toBe("pending");
  });

  it("un secret CHIFFRÉ par la clé serveur est résolu au moment de l'appel", async () => {
    const integ = await integration(APP, { credential: chiffrer("jeton-chiffre", ENV) });
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    const entetes: string[] = [];
    const impl = (async (_u: string, init: RequestInit) => {
      entetes.push(String((init.headers as Record<string, string>).authorization));
      return CREE_OK(5);
    }) as unknown as typeof fetch;
    await livrerTickets(pool, { fetchImpl: impl, env: ENV });
    expect(entetes[0]).toBe("Bearer jeton-chiffre");
    expect((await ligne(jobId!)).state).toBe("sent");
  });
});

suite("P8.6 — webhooks : rejeu, mapping explicite et autorité de MIP", () => {
  const SECRET = "secret-webhook-p86";
  const signer = (corps: string) => `sha256=${createHmac("sha256", SECRET).update(corps).digest("hex")}`;

  /** Rejoue ce que fait la route : signature vérifiée, journal, application. */
  async function livraison(
    integ: string,
    corps: Record<string, unknown>,
    deliveryId: string,
    { type = "issues" } = {},
  ) {
    const { validateWebhook, normalizeWebhook } = await import(
      // @ts-expect-error module JS sans déclarations
      "../../packages/backend/lib/integrations/tickets/github.mjs"
    );
    const { appliquerEvenement } = await import(
      // @ts-expect-error module JS sans déclarations
      "../../packages/backend/lib/integrations/tickets/dispatcher.mjs"
    );
    const brut = Buffer.from(JSON.stringify(corps), "utf8");
    const entetes = new Headers({
      "x-github-event": type,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signer(brut.toString("utf8")),
    });
    const verdict = validateWebhook({ secret: SECRET, entetes, corps: new Uint8Array(brut) });
    if (!verdict.ok) return { refus: verdict.raison };
    const evenement = normalizeWebhook({ entetes, corps });
    const { rows: [integration] } = await pool.query(
      "select id::text as id, app_id, provider, target, config from ticket_integration where id = $1",
      [integ],
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rowCount } = await client.query(
        `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, external_id, status)
         values ($1, $2, $3, $4, $5, 'ignored')
         on conflict (integration_id, delivery_id) do nothing`,
        [integration.app_id, integ, deliveryId, type, evenement.externalId],
      );
      if (!rowCount) {
        await client.query("commit");
        return { status: "duplicate" };
      }
      const r = await appliquerEvenement(client, { integration, evenement, deliveryId });
      await client.query("update ticket_webhook_event set status = $3 where integration_id = $1 and delivery_id = $2", [
        integ, deliveryId, r.status,
      ]);
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Une issue avec son ticket déjà créé par le connecteur. */
  async function issueAvecTicket(mapping: Record<string, string | null> | null, statut = "open") {
    const integ = await integration(APP, { webhook: "env:WH", mapping: mapping ?? undefined });
    const iss = await issue(APP, { statut });
    await pool.query(
      `insert into error_issue_ticket (app_id, issue_id, url, label, provider, external_id, integration_id, origin, provider_state)
       values ($1, $2, $3, 'GitHub #9', 'github', '9', $4, 'connector', 'open')`,
      [APP, iss.id, `https://github.com/${CIBLE}/issues/9`, integ],
    );
    return { integ, iss };
  }

  const FERMETURE = {
    action: "closed",
    issue: { number: 9, state: "closed" },
    repository: { full_name: CIBLE },
  };

  it("un ticket fermé résout l'issue QUAND le mapping est configuré, et le journal le dit", async () => {
    const { integ, iss } = await issueAvecTicket({ closed: "resolved", reopened: "open" });
    const r = await livraison(integ, FERMETURE, "d-1");
    expect(r).toMatchObject({ status: "applied", statut: "resolved" });

    const { rows } = await pool.query(
      "select status, status_source, resolved_release, resolved_env, revision::text as revision from error_issue where id = $1",
      [iss.id],
    );
    expect(rows[0]).toMatchObject({ status: "resolved", status_source: "system" });
    // La référence de résolution est celle qu'une résolution HUMAINE aurait posée.
    expect(rows[0].resolved_release).toBe("2026.09.1");
    expect(rows[0].resolved_env).toBe("prod");

    const { rows: act } = await pool.query(
      "select kind, actor_kind, old_status, new_status, event_key from error_issue_activity where issue_id = $1",
      [iss.id],
    );
    expect(act).toEqual([
      { kind: "status", actor_kind: "system", old_status: "open", new_status: "resolved", event_key: "ticket_webhook:d-1" },
    ]);
    const { rows: ticket } = await pool.query("select provider_state from error_issue_ticket where issue_id = $1", [iss.id]);
    expect(ticket[0].provider_state).toBe("closed");
  });

  it("SANS mapping, un ticket fermé ne change RIEN — seul l'état distant est noté", async () => {
    const { integ, iss } = await issueAvecTicket(null);
    expect(await livraison(integ, FERMETURE, "d-2")).toMatchObject({ status: "unmapped" });
    const { rows } = await pool.query("select status from error_issue where id = $1", [iss.id]);
    expect(rows[0].status).toBe("open");
    const { rows: ticket } = await pool.query("select provider_state from error_issue_ticket where issue_id = $1", [iss.id]);
    expect(ticket[0].provider_state).toBe("closed");
  });

  it("une issue IGNORÉE n'est jamais défaite par le fournisseur : MIP fait foi", async () => {
    const { integ, iss } = await issueAvecTicket({ closed: "resolved" }, "ignored");
    expect(await livraison(integ, FERMETURE, "d-3")).toMatchObject({ status: "ignored" });
    const { rows } = await pool.query("select status, revision::text as revision from error_issue where id = $1", [iss.id]);
    expect(rows[0].status).toBe("ignored");
    expect(rows[0].revision).toBe("1");
  });

  it("une livraison REJOUÉE n'applique rien une seconde fois", async () => {
    const { integ, iss } = await issueAvecTicket({ closed: "resolved", reopened: "open" });
    await livraison(integ, FERMETURE, "d-4");
    const { rows: avant } = await pool.query("select revision::text as revision from error_issue where id = $1", [iss.id]);
    expect(await livraison(integ, FERMETURE, "d-4")).toMatchObject({ status: "duplicate" });
    const { rows: apres } = await pool.query("select revision::text as revision from error_issue where id = $1", [iss.id]);
    expect(apres[0].revision).toBe(avant[0].revision);
    const { rows: act } = await pool.query(
      "select count(*)::int as n from error_issue_activity where issue_id = $1 and kind = 'status'",
      [iss.id],
    );
    expect(act[0].n).toBe(1);
  });

  it("l'aller-retour ne peut pas osciller : un événement qui propose l'état COURANT ne fait rien", async () => {
    const { integ, iss } = await issueAvecTicket({ closed: "resolved", reopened: "open" });
    await livraison(integ, FERMETURE, "d-5");
    // Une SECONDE fermeture, avec une autre livraison : l'issue est déjà résolue.
    expect(await livraison(integ, FERMETURE, "d-6")).toMatchObject({ status: "ignored" });
    const { rows: act } = await pool.query(
      "select count(*)::int as n from error_issue_activity where issue_id = $1 and kind = 'status'",
      [iss.id],
    );
    expect(act[0].n).toBe(1);
    const { rows } = await pool.query("select status from error_issue where id = $1", [iss.id]);
    expect(rows[0].status).toBe("resolved");
  });

  it("un ticket inconnu de MIP n'ouvre aucun oracle : rien n'est écrit", async () => {
    const integ = await integration(APP, { webhook: "env:WH", mapping: { closed: "resolved" } });
    const r = await livraison(integ, { ...FERMETURE, issue: { number: 999, state: "closed" } }, "d-7");
    expect(r).toMatchObject({ status: "unknown_ticket" });
    const { rows } = await pool.query(
      "select status from ticket_webhook_event where integration_id = $1 and delivery_id = 'd-7'",
      [integ],
    );
    expect(rows[0].status).toBe("unknown_ticket");
  });

  it("une signature invalide n'écrit rien du tout, pas même au journal", async () => {
    const { integ } = await issueAvecTicket({ closed: "resolved" });
    // @ts-expect-error module JS sans déclarations
    const { validateWebhook } = await import("../../packages/backend/lib/integrations/tickets/github.mjs");
    const brut = Buffer.from(JSON.stringify(FERMETURE), "utf8");
    const verdict = validateWebhook({
      secret: SECRET,
      entetes: new Headers({
        "x-github-event": "issues",
        "x-github-delivery": "d-8",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      }),
      corps: new Uint8Array(brut),
    });
    expect(verdict).toEqual({ ok: false, raison: "signature_invalide" });
    const { rows } = await pool.query(
      "select count(*)::int as n from ticket_webhook_event where integration_id = $1", [integ],
    );
    expect(rows[0].n).toBe(0);
  });
});

suite("P8.6 — effacement, rétention et périmètre", () => {
  it("`erase_app_data` emporte la configuration, sa file et son journal", async () => {
    const integ = await integration();
    const iss = await issue();
    const { jobId } = await demander(integ, iss.id);
    await pool.query(
      `insert into ticket_webhook_event (app_id, integration_id, delivery_id, status)
       values ($1, $2, 'd-efface', 'ignored')`,
      [APP, integ],
    );
    // Un voisin, pour prouver que l'effacement ne déborde pas.
    const integAutre = await integration(AUTRE);
    const issAutre = await issue(AUTRE);
    await demander(integAutre, issAutre.id, AUTRE);
    await pool.query(
      `insert into ticket_webhook_event (app_id, integration_id, delivery_id, status)
       values ($1, $2, 'd-voisin', 'ignored')`,
      [AUTRE, integAutre],
    );

    const { rows } = await pool.query<{ rapport: Record<string, number> }>(
      "select erase_app_data($1) as rapport", [APP],
    );
    expect(rows[0].rapport.ticket_integration).toBe(1);

    for (const [table, colonne] of [
      ["ticket_integration", "app_id"],
      ["ticket_outbox", "app_id"],
      ["ticket_webhook_event", "app_id"],
    ] as const) {
      const ici = await pool.query(`select count(*)::int as n from ${table} where ${colonne} = $1`, [APP]);
      expect(ici.rows[0].n, table).toBe(0);
      const voisin = await pool.query(`select count(*)::int as n from ${table} where ${colonne} = $1`, [AUTRE]);
      expect(voisin.rows[0].n, table).toBeGreaterThan(0);
    }
    expect(jobId).not.toBeNull();
  });

  it("supprimer une intégration emporte sa file et son journal, jamais l'issue", async () => {
    const integ = await integration();
    const iss = await issue();
    await demander(integ, iss.id);
    await pool.query(
      `insert into ticket_webhook_event (app_id, integration_id, delivery_id, status) values ($1, $2, 'd-x', 'ignored')`,
      [APP, integ],
    );
    await pool.query("delete from ticket_integration where id = $1", [integ]);
    for (const table of ["ticket_outbox", "ticket_webhook_event"]) {
      const { rows } = await pool.query(`select count(*)::int as n from ${table} where app_id = $1`, [APP]);
      expect(rows[0].n, table).toBe(0);
    }
    const { rows } = await pool.query("select count(*)::int as n from error_issue where id = $1", [iss.id]);
    expect(rows[0].n).toBe(1);
  });

  it("supprimer l'issue emporte sa demande de ticket", async () => {
    const integ = await integration();
    const iss = await issue();
    await demander(integ, iss.id);
    await pool.query("delete from error_issue where id = $1", [iss.id]);
    const { rows } = await pool.query("select count(*)::int as n from ticket_outbox where issue_id = $1", [iss.id]);
    expect(rows[0].n).toBe(0);
  });

  it("aucune table de ce lot ne porte `session_id` : leur place n'est PAS dans DSAR_CHILD_TABLES", async () => {
    // P7.5 l'a posé comme règle : `DSAR_CHILD_TABLES` est le bon endroit pour une
    // table portant un `session_id`, et pour elle seule — l'y mettre sans cette
    // colonne ferait échouer l'effacement d'une personne. On le PROUVE par le
    // catalogue plutôt que de l'affirmer.
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'session_id'
          and c.table_name in ('ticket_integration', 'ticket_outbox', 'ticket_webhook_event')`,
    );
    expect(rows).toEqual([]);
    for (const t of ["ticket_integration", "ticket_outbox", "ticket_webhook_event"]) {
      expect(DSAR_CHILD_TABLES as readonly string[]).not.toContain(t);
    }
  });

  it("le garde-fou catalogue de P8.1 passe : chaque table app-scopée est vidée ou justifiée", async () => {
    const CONSERVEES = [
      "privacy_erasure_barrier", "privacy_erasure_request",
      "app_registry", "tenant_usage_daily", "rate_counter",
      "error_issue_activity", "error_issue_alias", "error_issue_ticket", "error_issue_notification",
      // P8.6 : emportées en cascade avec `ticket_integration`.
      "ticket_outbox", "ticket_webhook_event",
      "slo", "goal", "notify_channel", "uptime_check", "read_tokens", "deploy_marker",
      "ai_briefing", "extension_scope", "extension_install_app",
    ];
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
        join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
       where c.table_schema = 'public' and c.column_name = 'app_id'
         and not exists (select 1 from pg_proc p
                          where p.proname = 'erase_app_data'
                            and p.prosrc like '%from ' || c.table_name || ' %')
       order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...CONSERVEES].sort());
  });

  it("`console_ro` ne peut PAS lire une référence de secret", async () => {
    await pool.query(
      "do $$ begin if not exists (select 1 from pg_roles where rolname='console_ro') then create role console_ro nologin; end if; end $$;",
    );
    // Les droits sont ceux que la migration pose : on les rejoue pour que le test
    // ne dépende pas d'un `grant` large posé par une autre suite sur la même base.
    await pool.query(readFileSync(join(SQL_DIR, "migration-v84.sql"), "utf8"));
    const { rows } = await pool.query<{ colonne: string; secret: boolean; webhook: boolean; cible: boolean }>(
      `select has_column_privilege('console_ro','ticket_integration','credential_ref','select') as secret,
              has_column_privilege('console_ro','ticket_integration','webhook_secret_ref','select') as webhook,
              has_column_privilege('console_ro','ticket_integration','target','select') as cible`,
    );
    expect(rows[0].secret).toBe(false);
    expect(rows[0].webhook).toBe(false);
    expect(rows[0].cible).toBe(true);
  });

  it("aucune policy `using (true)` sur les tables de ce lot", async () => {
    const { rows } = await pool.query<{ pol: string }>(
      `select c.relname || '.' || p.polname as pol
         from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname in ('ticket_integration','ticket_outbox','ticket_webhook_event')
          and pg_get_expr(p.polqual, p.polrelid) = 'true'`,
    );
    expect(rows).toEqual([]);
  });
});
