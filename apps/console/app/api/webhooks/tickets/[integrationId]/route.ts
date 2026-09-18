// POST /api/webhooks/tickets/{integrationId} — livraison entrante d'un
// fournisseur de tickets (P8.6).
//
// CE QUE CETTE ROUTE N'EST PAS. Ce n'est pas une route de console : elle
// n'authentifie PERSONNE par cookie, et elle refuse explicitement une requête
// qui porte le cookie de session — un navigateur piégé ne doit pas pouvoir la
// déclencher avec les droits de celui qui est connecté. L'autorité est la
// SIGNATURE du fournisseur, rien d'autre.
//
// CE QU'ELLE NE DIT JAMAIS. Sa réponse ne contient aucun détail RUM : ni issue,
// ni application, ni message, ni existence d'un ticket. `{ ok: true }` ou un code
// d'erreur nu. Un webhook est un point d'entrée public : lui faire dire « cette
// issue existe » en ferait un oracle.
//
// ORDRE DES CONTRÔLES, et il compte : taille → intégration → signature →
// unicité de livraison → application. On ne lit jamais un corps non borné, et on
// ne consulte jamais la base avant d'avoir de quoi désigner une intégration.
//
// REJEU. GitHub ne signe ni horodatage ni nonce : le protocole n'en fournit pas,
// et on n'en invente pas. La protection vient de l'unicité de
// `(integration_id, delivery_id)` en base — une livraison rejouée est reconnue,
// journalisée `duplicate`, et n'applique rien.
import { type NextRequest, NextResponse } from "next/server";
import { ErreurUpload, lireCorpsLimite } from "ingest/lib/sourcemap-upload.mjs";
import { bodyTooLarge } from "ingest/shared/limits.mjs";
import { WEBHOOK_MAX_OCTETS } from "ingest/lib/integrations/tickets/github.mjs";
import { adaptateurDe, appliquerEvenement } from "ingest/lib/integrations/tickets/dispatcher.mjs";
import { ErreurSecret, resoudre } from "ingest/lib/integrations/tickets/secrets.mjs";
import { SESSION_COOKIE } from "@/lib/auth";
import { pool, tx } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bien au-delà d'une charge GitHub d'issue ; au-delà, on refuse sans lire. */
const MAX_CORPS = WEBHOOK_MAX_OCTETS;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

interface Integration {
  id: string;
  app_id: string;
  provider: string;
  target: string;
  config: Record<string, unknown>;
  webhook_secret_ref: string | null;
  enabled: boolean;
  state: string;
}

export async function POST(req: NextRequest, route: { params: Promise<{ integrationId: string }> }) {
  // 1. Aucun cookie utilisateur. Une livraison de fournisseur n'en a pas ; une
  //    requête qui en porte vient d'un navigateur, donc pas du fournisseur.
  if (req.cookies.get(SESSION_COOKIE)) return json({ error: "cookie refusé sur ce point d'entrée" }, 400);

  // 2. Taille annoncée, avant toute lecture.
  if (bodyTooLarge(req.headers.get("content-length"), MAX_CORPS)) return json({ error: "corps trop volumineux" }, 413);

  const { integrationId } = await route.params;
  if (!/^[1-9]\d{0,17}$/.test(integrationId)) return json({ error: "introuvable" }, 404);

  // 3. Schéma et intégration. Un identifiant inconnu et un identifiant hors
  //    service rendent le MÊME 404 : la réponse ne renseigne pas sur l'existence.
  const [schema] = await pool
    .query("select to_regclass('public.ticket_integration') is not null as v84")
    .then((r) => r.rows as { v84: boolean }[]);
  if (!schema?.v84) return json({ error: "indisponible" }, 503);

  const { rows: [integration] } = await pool.query<Integration>(
    `select id::text as id, app_id, provider, target, config, webhook_secret_ref, enabled, state
       from ticket_integration where id = $1`,
    [integrationId],
  );
  if (!integration || !integration.enabled) return json({ error: "introuvable" }, 404);

  const adaptateur = adaptateurDe(integration.provider);
  if (!adaptateur || !integration.webhook_secret_ref) return json({ error: "introuvable" }, 404);

  // 4. Corps BRUT : la signature porte sur les octets reçus. Réencoder le JSON
  //    avant de vérifier casserait la signature au premier espace différent.
  if (!req.body) return json({ error: "corps requis" }, 400);
  let brut: Buffer;
  try {
    const flux = req.body as unknown as AsyncIterable<Uint8Array>;
    brut = await lireCorpsLimite(flux, { max: MAX_CORPS });
  } catch (err) {
    if (err instanceof ErreurUpload && err.statut === 413) return json({ error: "corps trop volumineux" }, 413);
    return json({ error: "corps illisible" }, 400);
  }

  let secret: string;
  try {
    secret = resoudre(integration.webhook_secret_ref, process.env);
  } catch (err) {
    // Secret de webhook injoignable : on ne peut RIEN vérifier, donc on ne
    // traite rien. 503 et non 401 : le refus vient de nous, pas de l'émetteur.
    console.error("[webhooks/tickets]", err instanceof ErreurSecret ? err.code : "secret_indisponible");
    return json({ error: "indisponible" }, 503);
  }

  // 5. Signature, en comparaison à temps constant, par le mécanisme officiel du
  //    fournisseur (HMAC-SHA256 sur `X-Hub-Signature-256` pour GitHub).
  const verdict = adaptateur.validateWebhook({
    secret,
    entetes: req.headers,
    corps: new Uint8Array(brut),
  });
  if (!verdict.ok) return json({ error: "signature refusée" }, 401);

  let corps: Record<string, unknown>;
  try {
    corps = JSON.parse(brut.toString("utf8")) as Record<string, unknown>;
  } catch {
    return json({ error: "corps illisible" }, 400);
  }
  const evenement = adaptateur.normalizeWebhook({ entetes: req.headers, corps });

  // 6. La charge annonce un dépôt : il doit être CELUI qu'on a configuré. Une
  //    signature valide prouve l'émetteur, pas la cible — un même secret réutilisé
  //    sur deux dépôts ferait sinon entrer les tickets de l'un chez l'autre.
  if (evenement.cible && evenement.cible !== integration.target) {
    await journaliser(integration, verdict.deliveryId, verdict.type, evenement.externalId, "rejected");
    return json({ ok: true });
  }

  try {
    const statut = await tx(async (client) => {
      // 7. Unicité de livraison AVANT tout effet : la ligne de journal est la
      //    réservation. Si elle existe déjà, la livraison a déjà été traitée.
      const { rowCount } = await client.query(
        `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, external_id, status)
         values ($1, $2, $3, $4, $5, 'ignored')
         on conflict (integration_id, delivery_id) do nothing`,
        [integration.app_id, integration.id, verdict.deliveryId, verdict.type, evenement.externalId],
      );
      if (!rowCount) return "duplicate";

      if (verdict.type !== "issues" || !evenement.externalId) return "ignored";
      const applique = await appliquerEvenement(client, {
        integration,
        evenement,
        deliveryId: verdict.deliveryId,
      });
      await client.query(
        "update ticket_webhook_event set status = $3 where integration_id = $1 and delivery_id = $2",
        [integration.id, verdict.deliveryId, applique.status],
      );
      return applique.status;
    });
    // La réponse ne dit RIEN de plus que « reçu » : ni le statut appliqué, ni
    // l'issue concernée, ni même si un ticket correspondait.
    return json({ ok: true, received: statut === "duplicate" ? "duplicate" : "accepted" });
  } catch (err) {
    console.error("[webhooks/tickets]", err);
    // 5xx : le fournisseur rejouera, et l'unicité de livraison rendra ce rejeu
    // inoffensif si l'effet avait déjà été appliqué.
    return json({ error: "erreur interne" }, 500);
  }
}

/** Journalise une livraison refusée sans effet de bord sur l'issue. */
async function journaliser(
  integration: Integration,
  deliveryId: string,
  type: string,
  externalId: string | null,
  status: string,
) {
  await pool
    .query(
      `insert into ticket_webhook_event (app_id, integration_id, delivery_id, event_type, external_id, status)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (integration_id, delivery_id) do nothing`,
      [integration.app_id, integration.id, deliveryId, type, externalId, status],
    )
    .catch(() => {
      /* le journal ne doit pas faire échouer une réponse déjà décidée */
    });
}
