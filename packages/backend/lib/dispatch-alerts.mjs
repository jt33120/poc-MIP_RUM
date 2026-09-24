// Livraison des alertes — pendant LOCAL de pg_net (ROADMAP v0.3 B1).
// check_alerts() et route_alert() insèrent une ligne alert_delivery 'queued' par
// cible ; `dispatchOnce` prend le relais : POST du payload JSON (champ `text`
// compatible Slack) vers un webhook, ou e-mail par Resend vers une adresse, puis
// statut delivered/failed/dead/skipped et trace dans `response`.
//
// UNE FONCTION, PAS UN PROGRAMME. Ce fichier avait un mode CLI (`--once`,
// `--loop`), hérité du temps où rien ne planifiait la livraison. Deux services
// l'appellent : le notifier, toutes les 15 s (P5), et le scheduler à chaque tick
// tant que `SCHEDULER_DELIVERY` n'est pas `off`. Une seconde boucle lancée à la
// main livrerait en concurrence d'eux ; pour une passe ponctuelle :
// `node services/scheduler/run-once.mjs tick`.
//
// ÉVÉNEMENTS SANS RÈGLE (migration-v73). La sélection joignait `alert_rule` en
// jointure interne : nouvelles erreurs, SLO, uptime et notifications d'issue
// restaient `queued` pour toujours. Dès v73, ils partent aussi — seulement ceux
// déclenchés depuis `alert_config.rule_less_dispatch_since`, l'arriéré ayant été
// soldé par la migration. Avant v73, la sélection historique est conservée.
//
// PLUSIEURS LIVREURS À LA FOIS. Pendant la bascule vers le notifier, le scheduler
// et le notifier livrent ensemble ; deux répliques du notifier aussi. Chaque
// livraison est réservée par `for update skip locked`, postée et marquée dans SA
// transaction : la passe concurrente prend les suivantes. Une passe interrompue
// ne rejoue donc que la livraison en cours, jamais celles déjà marquées. Une
// passe est bornée en nombre et par une échéance ; ce qui reste part au passage
// suivant.
//
// SORTIE PAR `safeFetch` (P1). La cible d'une livraison est une URL saisie dans
// la console — le webhook d'une règle ou un canal. La poster avec un `fetch` nu
// faisait du dispatcher un relais vers le réseau privé du livreur
// (`*.railway.internal`, métadonnées cloud, boucle locale). Une cible refusée par
// la politique est soldée `skipped`, comme une cible ni HTTP ni e-mail : la
// rejouer cinq fois avec backoff donnerait cinq fois le même refus.
//
// E-MAIL (P5, migration-v88). Une cible qui est une adresse part chez Resend
// (`net/resend.mjs`) si le livreur en a la configuration — le notifier, seul
// détenteur de la clé. Sans elle, la ligne est soldée `skipped` avec la raison :
// c'est ce que fait le scheduler s'il en rencontre une, d'où la bascule qui coupe
// sa livraison (`SCHEDULER_DELIVERY=off`) AVANT que le notifier ne démarre.
//
// SIGNATURE (P5). Chaque webhook porte `x-mip-delivery-id` ; avec un secret de
// signature, `x-mip-timestamp` et `x-mip-signature` en plus (`net/signature-webhook.mjs`).
import { ErreurCibleRefusee, safeFetch } from "./net/safe-fetch.mjs";
import { construireMail, envoyerMail, estAdresseMail, refusDestinataire } from "./net/resend.mjs";
import { entetesDeLivraison } from "./net/signature-webhook.mjs";
import { createLogger } from "../shared/log.mjs";

const log = createLogger("dispatch-alerts");

const TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS || 10_000);
/** Livraisons réservées par passe. */
const LOT = Number(process.env.DISPATCH_BATCH || 50);
/** Au-delà, aucune nouvelle livraison n'est entamée dans la passe (échéance par défaut). */
const BUDGET_MS = Number(process.env.DISPATCH_BUDGET_MS || 40_000);

/** Rendu numérique aligné sur round(v::numeric, 1) de check_alerts (ex: '3200.0'). */
function round1(v) {
  return Number(v ?? 0).toFixed(1);
}

/**
 * Payload JSON identique à celui posté par check_alerts v2 via pg_net
 * (migration-v03.sql) — `text` lisible tel quel par un webhook Slack.
 * @param {{app_id: string, metric: string, route: string|null, value: number,
 *          threshold: number, window_minutes: number, comparator: string,
 *          mode?: string, message?: string|null}} d
 */
export function buildPayload(d) {
  return {
    source: "mip-rum",
    app_id: d.app_id,
    metric: d.metric,
    route: d.route ?? null,
    value: Number(round1(d.value)),
    threshold: d.threshold,
    window_minutes: d.window_minutes,
    text: texteDeRegle(d),
  };
}

/**
 * Texte d'une alerte de règle. B52 (migration-v86) : une règle de RELEASE n'a pas
 * de seuil au sens de ce gabarit — `threshold` y est une hausse tolérée EN POUR
 * CENT —, et « LCP > 2600.0 (seuil 20) » se lirait « LCP au-dessus de 20 ms ». Son
 * texte est donc le message écrit par check_alerts, qui dit les deux releases
 * comparées et porte la phrase du plan (« même fenêtre, sans normalisation de
 * trafic : l'écart mêle le code et le contexte »). Les autres modes sont inchangés.
 */
function texteDeRegle(d) {
  if (d.mode === "release" && d.message) return `[MIP RUM] ${d.message}`;
  return `[MIP RUM] ${d.metric} ${d.comparator} ${round1(d.value)} (seuil ${d.threshold}) — app ${d.app_id}${d.route ? `, route ${d.route}` : ""}`;
}

/**
 * Corps d'une livraison, selon ce qui l'a déclenchée : la charge minimale d'une
 * notification d'issue telle que l'outbox l'a figée, le payload d'une règle, ou,
 * pour un événement sans règle (nouvelle erreur, SLO, uptime), son message.
 * @param {{notification?: object|null, metric?: string|null, severity?: string, message?: string|null}} d
 */
export function payloadOf(d) {
  if (d.notification) return d.notification;
  if (d.metric) return buildPayload(d);
  return { source: "mip-rum", severity: d.severity, text: `[MIP RUM] ${d.message ?? ""}` };
}

/** Le dispatcher ne sait poster qu'en HTTP(S) : une adresse e-mail n'est pas une URL. */
export function cibleHttp(target) {
  try {
    const url = new URL(target);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Rejeu borné (R5) : une livraison 'failed' est retentée jusqu'à MAX_ATTEMPTS,
// avec backoff exponentiel ; au-delà elle bascule en 'dead' (état terminal).
const MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 5);

/**
 * Statut résultant d'une tentative (logique pure, testable sans DB).
 * @param {boolean} ok      le POST a réussi (2xx)
 * @param {number} attemptsBefore  tentatives déjà effectuées avant celle-ci
 * @param {number} maxAttempts
 * @returns {"sent"|"failed"|"dead"} 'dead' = plafond atteint, on abandonne
 */
export function decideStatus(ok, attemptsBefore, maxAttempts = MAX_ATTEMPTS) {
  // 'delivered' et non 'sent' : ici l'appel est SYNCHRONE, `ok` est un vrai 2xx.
  // Depuis migration-v49, 'sent' est réservé au cas pg_net (asynchrone), où le
  // résultat n'est pas encore connu. Confondre les deux redonnerait à la console
  // un compteur « livrées » qui ne prouve rien.
  if (ok) return "delivered";
  return attemptsBefore + 1 >= maxAttempts ? "dead" : "failed";
}

/**
 * Réservation de la prochaine livraison à tenter : 'queued' + 'failed' éligibles au
 * rejeu (sous le plafond ET passé le backoff de 30 s × 2^attempts). Une ligne à la
 * fois : elle reste verrouillée le temps de son POST, puis sa transaction valide.
 * @param {boolean} v73  migration-v73 appliquée (événements sans règle livrables)
 */
export function selectionSql(v73) {
  const sources = v73
    ? `left join alert_rule r on r.id = e.rule_id
       left join error_issue_notification n on n.alert_event_id = e.id
       left join alert_config c on c.singleton`
    : "join alert_rule r on r.id = e.rule_id";
  return `select d.id, d.target, d.attempts, e.value, e.message, e.severity,
                 r.app_id, r.metric, r.route, r.threshold, r.window_minutes, r.comparator, r.mode,
                 ${v73 ? "n.payload" : "null::jsonb"} as notification
            from alert_delivery d
            join alert_event e on e.id = d.alert_event_id
            ${sources}
           where (d.status = 'queued'
                  or (d.status = 'failed'
                      and d.attempts < $1
                      and d.attempted_at < now() - (interval '30 seconds' * power(2, d.attempts))))
             ${v73 ? "and (e.rule_id is not null or e.fired_at >= c.rule_less_dispatch_since)" : ""}
           order by d.id
           limit 1
           for update of d skip locked`;
}

/** Solde une livraison qui ne partira jamais : état terminal, sans tentative comptée. */
async function solderSkipped(client, d, motif, bilan) {
  await client.query(
    "update alert_delivery set status = 'skipped', response = $1, attempted_at = now() where id = $2",
    [motif.slice(0, 200), d.id],
  );
  bilan.skipped++;
  log.warn("delivery", { id: d.id, status: "skipped", response: motif });
}

/** Écrit l'issue d'une tentative réelle (tentative comptée). */
async function marquer(client, d, status, response, bilan) {
  await client.query(
    "update alert_delivery set status = $1, response = $2, attempts = attempts + 1, attempted_at = now() where id = $3",
    [status, response, d.id],
  );
  if (status === "delivered") bilan.sent++;
  else if (status === "dead") bilan.dead++;
  else bilan.failed++;
}

/**
 * E-mail : adresse admise et configuration présente, sinon `skipped` avec la
 * raison ; puis envoi idempotent. Un refus 4xx de Resend est terminal (`dead`),
 * une panne est rejouable comme un webhook.
 */
async function livrerMail(client, d, resteMs, bilan, { email, fetchMail }) {
  if (!email) {
    await solderSkipped(
      client,
      d,
      "e-mail non configuré : RESEND_API_KEY et ALERT_EMAIL_FROM absents de ce livreur (ils se posent sur le service notifier)",
      bilan,
    );
    return "skipped";
  }
  const refus = refusDestinataire(d.target, email);
  if (refus) {
    await solderSkipped(client, d, refus, bilan);
    return "skipped";
  }
  const charge = payloadOf(d);
  const mail = construireMail({ to: d.target, severity: d.severity, text: charge.text, payload: charge });
  if (!mail) {
    await solderSkipped(client, d, "alerte sans texte : aucun e-mail à envoyer", bilan);
    return "skipped";
  }
  const { issue, reponse } = await envoyerMail(mail, email, {
    cleIdempotence: `mip-delivery-${d.id}`,
    delaiMs: Math.min(TIMEOUT_MS, resteMs),
    ...(fetchMail ? { fetchImpl: fetchMail } : {}),
  });
  const status = issue === "livre" ? "delivered" : issue === "terminal" ? "dead" : decideStatus(false, d.attempts ?? 0);
  await marquer(client, d, status, reponse, bilan);
  // Jamais le destinataire au journal : une adresse e-mail est une donnée personnelle.
  log[status === "delivered" ? "info" : "warn"]("delivery", {
    id: d.id,
    canal: "email",
    status,
    attempt: (d.attempts ?? 0) + 1,
    response: reponse,
  });
  return status;
}

/**
 * Livre une livraison réservée : e-mail pour une adresse, webhook pour une URL
 * HTTP(S), `skipped` pour tout le reste ou une cible refusée par la politique de
 * sortie ; POST borné par le temps restant, puis statut. Le client est celui de
 * la transaction qui tient la réservation.
 * @returns {Promise<{ canal: "email"|"webhook"|"autre", status: string }>}
 */
async function livrer(client, d, resteMs, bilan, { fetchImpl, email, fetchMail, secretSignature }) {
  if (estAdresseMail(d.target)) {
    return { canal: "email", status: await livrerMail(client, d, resteMs, bilan, { email, fetchMail }) };
  }
  if (!cibleHttp(d.target)) {
    await solderSkipped(client, d, "cible ni HTTP(S) ni adresse e-mail : rien ne sait la livrer", bilan);
    return { canal: "autre", status: "skipped" };
  }
  let ok = false;
  let response;
  const delai = Math.min(TIMEOUT_MS, resteMs);
  // Le corps est sérialisé UNE fois : c'est lui que la signature couvre, octet pour octet.
  const corps = JSON.stringify(payloadOf(d));
  try {
    const res = await fetchImpl(d.target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...entetesDeLivraison({ id: d.id, corps, secret: secretSignature }),
      },
      body: corps,
      // Les deux : `signal` pour un `fetch` injecté, `timeoutMs` pour `safeFetch`,
      // dont le délai propre (10 s) couperait sinon un DISPATCH_TIMEOUT_MS plus long.
      signal: AbortSignal.timeout(delai),
      timeoutMs: delai,
    });
    response = `http ${res.status}`;
    ok = res.ok;
    // Seul le statut compte : le corps est annulé, ce qui ferme la connexion.
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    if (err instanceof ErreurCibleRefusee) {
      await solderSkipped(client, d, err.message, bilan);
      return { canal: "webhook", status: "skipped" };
    }
    // `fetch` range le code système dans `cause`, `node:http` sur l'erreur même.
    response = String(err.cause?.code ?? err.code ?? err.message).slice(0, 200);
  }
  const status = decideStatus(ok, d.attempts ?? 0);
  await marquer(client, d, status, response, bilan);
  log[ok ? "info" : "warn"]("delivery", {
    id: d.id,
    target: d.target,
    status,
    attempt: (d.attempts ?? 0) + 1,
    response,
  });
  return { canal: "webhook", status };
}

/**
 * Traite une passe de livraisons en attente, une transaction par livraison.
 * `echeance` (ms epoch) : aucune livraison n'est entamée au-delà ; par défaut
 * `budgetMs` après l'appel. Le tick passe la sienne, mesurée depuis son début.
 * `fetchImpl` : `safeFetch` en production. Un test qui livre à un récepteur sur
 * 127.0.0.1 — que la politique refuse, à dessein — passe le `fetch` de la
 * plateforme ; la politique elle-même est testée à part (safe-fetch.test.ts).
 * `email` : la configuration Resend du livreur (`configEmail()`), `null` sans elle ;
 * `fetchMail` la remplace par un faux dans les tests (Resend est public, la
 * politique de sortie ne le refuse pas). `secretSignature` : la valeur qui signe
 * les webhooks, `null` pour n'envoyer que l'identifiant. `onLivraison` reçoit
 * `{ canal, status }` après chaque livraison soldée : de quoi compter par canal.
 * @returns {Promise<{sent:number, failed:number, dead:number, skipped:number}>}
 */
export async function dispatchOnce(
  pool,
  {
    lot = LOT,
    budgetMs = BUDGET_MS,
    echeance = Date.now() + budgetMs,
    fetchImpl = safeFetch,
    email = null,
    fetchMail = null,
    secretSignature = null,
    onLivraison = null,
  } = {},
) {
  const bilan = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  const { rows: [schema] } = await pool.query(
    "select to_regclass('public.error_issue_notification') is not null as v73",
  );
  const selection = selectionSql(schema.v73);
  for (let n = 0; n < lot; n++) {
    const reste = echeance - Date.now();
    if (reste <= 0) break;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: [d] } = await client.query(selection, [MAX_ATTEMPTS]);
      if (!d) {
        await client.query("commit");
        break;
      }
      const issue = await livrer(client, d, reste, bilan, { fetchImpl, email, fetchMail, secretSignature });
      await client.query("commit");
      onLivraison?.(issue);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return bilan;
}
