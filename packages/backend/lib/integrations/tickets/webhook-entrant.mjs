// LA LIVRAISON ENTRANTE D'UN FOURNISSEUR DE TICKETS (P8.6, C11) — ce que fait
// `POST /webhooks/tickets/{integrationId}`, partagé par ses deux ports : le
// notifier (`/v1/webhooks/tickets/{id}`, sur son domaine) et la console
// (`/api/webhooks/tickets/{id}`), qui la relaie OCTET POUR OCTET au notifier
// quand `CONSOLE_TICKET_HOOK_URL` est posée, et la traite elle-même sinon.
//
// CE QUE CE POINT D'ENTRÉE N'EST PAS. Il n'authentifie PERSONNE par cookie, et
// refuse une requête qui porte celui de la console : un navigateur piégé ne doit
// pas pouvoir la déclencher avec les droits de celui qui est connecté. L'autorité
// est la SIGNATURE du fournisseur, rien d'autre.
//
// CE QU'IL NE DIT JAMAIS. Sa réponse ne contient aucun détail RUM : ni issue, ni
// application, ni message, ni existence d'un ticket. `{ ok: true }` ou une erreur
// nue — un webhook public qui dirait « cette issue existe » serait un oracle.
//
// ORDRE DES CONTRÔLES, et il compte : cookie → taille → intégration → signature →
// unicité de livraison → application. Les deux premiers sont ceux du transport
// (`refusAvantLecture`), avant de lire un octet ; la suite, `recevoirLivraison`,
// sur les octets BRUTS — la signature porte sur eux, réencoder le JSON la casserait.
//
// REJEU. GitHub ne signe ni horodatage ni nonce. La protection vient de l'unicité
// de `(integration_id, delivery_id)` en base : une livraison rejouée — par le
// fournisseur, ou par le repli de la console après un relais incertain — est
// reconnue, journalisée `duplicate`, et n'applique rien.
import { adaptateurDe, appliquerEvenement } from "./dispatcher.mjs";
import { WEBHOOK_MAX_OCTETS } from "./github.mjs";
import { ErreurSecret, resoudre } from "./secrets.mjs";

/** Le cookie de session de la console (`apps/console/lib/auth.ts`, SESSION_COOKIE ; un test tient l'égalité). */
export const COOKIE_SESSION_CONSOLE = "mip_session";

/** Bien au-delà d'une charge GitHub d'issue ; au-delà, refus sans lire. */
export const CORPS_LIVRAISON_MAX = WEBHOOK_MAX_OCTETS;

/** Signature des réponses du notifier, que le relais de la console lit (même rôle que `x-mip-collector`). */
export const ENTETE_NOTIFIER = "x-mip-notifier";

/** L'identifiant d'une intégration, tel qu'un chemin le porte. */
export const MOTIF_INTEGRATION = /^[1-9]\d{0,17}$/;

/**
 * Les refus du transport, AVANT toute lecture du corps.
 * @param {{ get(nom: string): string | null }} entetes
 * @returns {{ statut: number, corps: object } | null}
 */
export function refusAvantLecture(entetes) {
  // Une livraison de fournisseur n'a pas de cookie ; une requête qui porte celui
  // de la console vient d'un navigateur, donc pas du fournisseur.
  const cookie = entetes.get("cookie") ?? "";
  if (cookie.split(";").some((m) => m.trim().startsWith(`${COOKIE_SESSION_CONSOLE}=`))) {
    return { statut: 400, corps: { error: "cookie refusé sur ce point d'entrée" } };
  }
  const annonce = entetes.get("content-length");
  if (annonce !== null && Number(annonce) > CORPS_LIVRAISON_MAX) return { statut: 413, corps: { error: "corps trop volumineux" } };
  return null;
}

/**
 * Traite une livraison dont le corps BRUT est lu (borné). Rend la réponse à
 * faire : `{ statut, corps }`, sans aucun détail RUM.
 *
 * @param {{
 *   pool: import("pg").Pool,
 *   integrationId: string,
 *   entetes: { get(nom: string): string | null },
 *   brut: Uint8Array,
 *   env?: Record<string, string | undefined>,
 *   log?: { error: Function },
 * }} p
 * @returns {Promise<{ statut: number, corps: object }>}
 */
export async function recevoirLivraison({ pool, integrationId, entetes, brut, env = process.env, log = console }) {
  if (!MOTIF_INTEGRATION.test(integrationId)) return { statut: 404, corps: { error: "introuvable" } };

  // Schéma et intégration. Un identifiant inconnu et un identifiant hors service
  // rendent le MÊME 404 : la réponse ne renseigne pas sur l'existence.
  const { rows: [schema] } = await pool.query("select to_regclass('public.ticket_integration') is not null as v84");
  if (!schema?.v84) return { statut: 503, corps: { error: "indisponible" } };
  const { rows: [integration] } = await pool.query(
    `select id::text as id, app_id, provider, target, config, webhook_secret_ref, enabled, state
       from ticket_integration where id = $1`,
    [integrationId],
  );
  if (!integration || !integration.enabled) return { statut: 404, corps: { error: "introuvable" } };
  const adaptateur = adaptateurDe(integration.provider);
  if (!adaptateur || !integration.webhook_secret_ref) return { statut: 404, corps: { error: "introuvable" } };
  if (!brut.length) return { statut: 400, corps: { error: "corps requis" } };

  let secret;
  try {
    secret = resoudre(integration.webhook_secret_ref, env);
  } catch (err) {
    // Secret de webhook injoignable : on ne peut RIEN vérifier, donc on ne traite
    // rien. 503 et non 401 : le refus vient de nous, pas de l'émetteur.
    log.error("[webhooks/tickets]", err instanceof ErreurSecret ? err.code : "secret_indisponible");
    return { statut: 503, corps: { error: "indisponible" } };
  }

  // Signature, en temps constant, par le mécanisme officiel du fournisseur
  // (HMAC-SHA256 sur `X-Hub-Signature-256` pour GitHub).
  const verdict = adaptateur.validateWebhook({ secret, entetes, corps: new Uint8Array(brut) });
  if (!verdict.ok) return { statut: 401, corps: { error: "signature refusée" } };

  let corps;
  try {
    corps = JSON.parse(Buffer.from(brut).toString("utf8"));
  } catch {
    return { statut: 400, corps: { error: "corps illisible" } };
  }
  const evenement = adaptateur.normalizeWebhook({ entetes, corps });

  // La charge annonce un dépôt : il doit être CELUI qu'on a configuré. Une
  // signature valide prouve l'émetteur, pas la cible — un même secret réutilisé
  // sur deux dépôts ferait sinon entrer les tickets de l'un chez l'autre.
  if (evenement.cible && evenement.cible !== integration.target) {
    await pool
      .query(
        `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, external_id, status)
         values ($1, $2, $3, $4, $5, 'rejected')
         on conflict (integration_id, delivery_id) do nothing`,
        [integration.app_id, integration.id, verdict.deliveryId, verdict.type, evenement.externalId],
      )
      .catch(() => {
        /* le journal ne doit pas faire échouer une réponse déjà décidée */
      });
    return { statut: 200, corps: { ok: true } };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Unicité de livraison AVANT tout effet : la ligne de journal est la réservation.
    const { rowCount } = await client.query(
      `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, external_id, status)
       values ($1, $2, $3, $4, $5, 'ignored')
       on conflict (integration_id, delivery_id) do nothing`,
      [integration.app_id, integration.id, verdict.deliveryId, verdict.type, evenement.externalId],
    );
    let statut = "ignored";
    if (!rowCount) statut = "duplicate";
    else if (verdict.type === "issues" && evenement.externalId) {
      const applique = await appliquerEvenement(client, { integration, evenement, deliveryId: verdict.deliveryId });
      await client.query("update ticket_webhook_event set status = $3 where integration_id = $1 and delivery_id = $2", [
        integration.id,
        verdict.deliveryId,
        applique.status,
      ]);
      statut = applique.status;
    }
    await client.query("commit");
    // La réponse ne dit RIEN de plus que « reçu ».
    return { statut: 200, corps: { ok: true, received: statut === "duplicate" ? "duplicate" : "accepted" } };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    log.error("[webhooks/tickets]", err);
    // 5xx : le fournisseur rejouera, et l'unicité de livraison rendra ce rejeu
    // inoffensif si l'effet avait déjà été appliqué.
    return { statut: 500, corps: { error: "erreur interne" } };
  } finally {
    client.release();
  }
}

const CHEMIN_HOOK = /^\/(?:v1|api)\/webhooks\/tickets\/([^/]+)$/;

/**
 * Le gestionnaire Web (Request → Response) du NOTIFIER : `POST
 * /v1/webhooks/tickets/{id}` (et l'alias de la console, `/api/webhooks/…`), rien
 * d'autre. Le kit borne le corps (`maxBodyBytes`) et signe chaque réponse
 * (`x-mip-notifier: 1`) ; les sondes passent avant lui.
 *
 * @param {{ pool: import("pg").Pool, env?: Record<string, string|undefined>, log?: { error: Function } }} deps
 * @returns {(req: Request) => Promise<Response>}
 */
export function creerGestionnaireHook({ pool, env = process.env, log = console }) {
  const repondre = (statut, corps) => Response.json(corps, { status: statut });
  return async (req) => {
    const m = CHEMIN_HOOK.exec(new URL(req.url).pathname);
    if (!m) return repondre(404, { error: "introuvable" });
    if (req.method !== "POST") return repondre(405, { error: "méthode non permise" });
    const refus = refusAvantLecture(req.headers);
    if (refus) return repondre(refus.statut, refus.corps);
    const integrationId = decodeURIComponent(m[1]);
    if (!MOTIF_INTEGRATION.test(integrationId)) return repondre(404, { error: "introuvable" });
    const brut = new Uint8Array(await req.arrayBuffer());
    if (brut.length > CORPS_LIVRAISON_MAX) return repondre(413, { error: "corps trop volumineux" });
    const r = await recevoirLivraison({ pool, integrationId, entetes: req.headers, brut, env, log });
    return repondre(r.statut, r.corps);
  };
}
