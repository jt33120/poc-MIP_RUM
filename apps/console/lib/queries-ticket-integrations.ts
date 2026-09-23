// Connecteur de tickets, côté console (P8.6) : configuration app-scopée,
// demande de création, lecture de l'état de livraison.
//
// CE QUE CE FICHIER NE REND JAMAIS. `credential_ref` et `webhook_secret_ref` ne
// sortent d'aucune fonction : les lectures rendent la FORME du secret (une
// variable d'environnement, ou un chiffré) et, pour une variable, son NOM. Un
// nom de variable n'est pas un secret ; sa valeur ne quitte jamais le runtime.
//
// LE LIEN MANUEL DE P5.6 CONTINUE DE VIVRE SANS CONNECTEUR. Rien ici n'est un
// prérequis de `linkIssue` : une console sans intégration configurée garde son
// formulaire « Lier un ticket », et un lien collé à la main reste un lien
// `origin = 'manual'`, sans fournisseur ni identifiant distant.
//
// GITHUB AUJOURD'HUI, ITSM MIP DEMAIN. La mention affichée à l'écran vient de
// `MENTION_ETAPE` (ingest/lib/integrations/tickets/adapter.mjs) : une seule
// définition pour l'écran d'administration, l'écran d'issue et le corps du
// ticket distant.
import {
  MENTION_ETAPE,
  PROVIDERS,
  construireCharge,
  referenceMip,
} from "@mip/backend/lib/integrations/tickets/adapter.mjs";
import { decrire, referenceValide } from "@mip/backend/lib/integrations/tickets/secrets.mjs";
import { q, tx } from "./db";
import { isIssueId } from "./error-issues";
import { hasSqlControlCharacters, type WorkflowResult } from "./error-issue-workflow";

export { MENTION_ETAPE, PROVIDERS };

/** Cible d'un fournisseur : `owner/repo` pour GitHub. Contrainte miroir de v84. */
const RE_CIBLE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STATUTS_MAPPABLES = ["open", "for_review", "resolved"] as const;

export interface TicketIntegration {
  id: string;
  app_id: string;
  provider: string;
  target: string;
  enabled: boolean;
  config_version: number;
  config: Record<string, unknown>;
  state: "active" | "degraded";
  last_error: string | null;
  verified_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  /** Forme du secret, jamais sa valeur. */
  credential: { kind: "env"; name: string } | { kind: "encrypted" } | { kind: "invalid" };
  webhook: { kind: "env"; name: string } | { kind: "encrypted" } | { kind: "invalid" } | null;
}

/**
 * Colonnes rendues. `credential_ref` et `webhook_secret_ref` sont lues ici pour
 * en déduire la FORME — `decrire()` ne rend jamais la valeur — et ne sont
 * recopiées dans aucun objet de sortie.
 */
const COLONNES = `id::text as id, app_id, provider, target, enabled, config_version, config,
  state, last_error, verified_at, created_by, created_at, updated_at,
  credential_ref, webhook_secret_ref`;

type Ligne = Omit<TicketIntegration, "credential" | "webhook"> & {
  credential_ref: string;
  webhook_secret_ref: string | null;
};

function versIntegration({ credential_ref, webhook_secret_ref, ...reste }: Ligne): TicketIntegration {
  return {
    ...reste,
    credential: decrire(credential_ref),
    webhook: webhook_secret_ref ? decrire(webhook_secret_ref) : null,
  };
}

/** migration-v84 appliquée ? Sondé à chaque appel, comme les autres surfaces. */
export async function ticketSchemaDisponible(): Promise<boolean> {
  const [row] = await q<{ v84: boolean }>("select to_regclass('public.ticket_integration') is not null as v84");
  return row?.v84 === true;
}

/**
 * La surface de configuration est-elle ouverte ?
 *
 * Elle reste CACHÉE tant qu'aucun fournisseur n'est branché et testé : le
 * produit n'affiche pas un écran d'intégrations à un client qui n'en a aucune,
 * et surtout pas une promesse qu'on n'a pas encore tenue. `TICKET_INTEGRATIONS`
 * est posé par l'exploitant au moment où le premier connecteur est câblé ; une
 * intégration déjà VÉRIFIÉE en base rouvre la porte d'elle-même, pour qu'une
 * variable perdue ne rende pas une configuration existante inadministrable.
 */
export async function surfaceTicketsOuverte(): Promise<boolean> {
  if (process.env.TICKET_INTEGRATIONS === "1") return true;
  if (!(await ticketSchemaDisponible())) return false;
  const [row] = await q<{ n: number }>(
    "select count(*)::int as n from ticket_integration where verified_at is not null",
  );
  return (row?.n ?? 0) > 0;
}

/** Intégrations d'une app (ou de toutes), actives d'abord. Jamais de secret. */
export async function listTicketIntegrations(appId: string | null): Promise<TicketIntegration[]> {
  const rows = await q<Ligne>(
    `select ${COLONNES} from ticket_integration
      where ($1::text is null or app_id = $1)
      order by (enabled and state = 'active') desc, app_id, provider, target
      limit 200`,
    [appId],
  );
  return rows.map(versIntegration);
}

/**
 * Intégrations utilisables pour créer un ticket sur cette app : activées, non
 * dégradées, ET vérifiées. `verified_at` est la recette réelle — tant qu'aucun
 * ticket n'a été créé et relu avec cette configuration, la console ne la propose
 * pas : offrir un bouton qui ne marche pas est pire que ne rien offrir.
 */
export async function integrationsUtilisables(appId: string): Promise<TicketIntegration[]> {
  if (!(await ticketSchemaDisponible())) return [];
  const rows = await q<Ligne>(
    `select ${COLONNES} from ticket_integration
      where app_id = $1 and enabled and state = 'active' and verified_at is not null
      order by provider, target
      limit 20`,
    [appId],
  );
  return rows.map(versIntegration);
}

// ────────────────────────────── Validation ───────────────────────────────────

export interface IntegrationRequest {
  app: string;
  provider: string;
  target: string;
  credentialRef: string;
  webhookSecretRef: string | null;
  config: Record<string, unknown>;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * `{app, provider, target, credentialRef, webhookSecretRef?, statusMapping?}`.
 *
 * `credentialRef` est une RÉFÉRENCE, pas un secret : `env:TICKET_NOM` ou
 * `enc:v1:…`. Un jeton collé ici est refusé en 400, et la contrainte de base le
 * refuserait de toute façon — deux barrières, parce que celle-ci donne un
 * message utile. Le préfixe `TICKET_` empêche de désigner une variable de la
 * plateforme (`env:DATABASE_URL`…), dont la valeur partirait chez le
 * fournisseur en jeton porteur (cf. `secrets.mjs`).
 *
 * `target` est obligatoire et confirmé par l'opérateur. RIEN n'est déduit du
 * remote git de MIP : ouvrir les tickets d'un client dans le dépôt du produit
 * serait une fuite, et un défaut « pratique » est exactement ainsi qu'elle
 * arriverait.
 */
export function parseIntegrationRequest(body: unknown): Parsed<IntegrationRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "objet JSON attendu" };
  }
  const champs = body as Record<string, unknown>;
  const app = typeof champs.app === "string" ? champs.app.trim() : "";
  if (!app || app.length > 200 || hasSqlControlCharacters(app)) return { ok: false, error: "app requise" };
  const provider = typeof champs.provider === "string" ? champs.provider.trim() : "";
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, error: `provider invalide (implémenté : ${PROVIDERS.join(", ")})` };
  }
  const target = typeof champs.target === "string" ? champs.target.trim() : "";
  if (!RE_CIBLE.test(target) || target.length > 200) {
    return { ok: false, error: "target requis et explicite (forme « owner/repo » pour GitHub) ; rien n'est déduit" };
  }
  const credentialRef = typeof champs.credentialRef === "string" ? champs.credentialRef.trim() : "";
  if (!referenceValide(credentialRef)) {
    return {
      ok: false,
      error:
        "credentialRef doit être une RÉFÉRENCE au secret (« env:TICKET_NOM », une variable dédiée au " +
        "connecteur, ou « enc:v1:… »), jamais le jeton lui-même",
    };
  }
  const webhookBrut = champs.webhookSecretRef;
  let webhookSecretRef: string | null = null;
  if (webhookBrut !== undefined && webhookBrut !== null && webhookBrut !== "") {
    const ref = typeof webhookBrut === "string" ? webhookBrut.trim() : "";
    if (!referenceValide(ref)) {
      return { ok: false, error: "webhookSecretRef doit être une référence au secret (« env:TICKET_NOM » ou « enc:v1:… »)" };
    }
    webhookSecretRef = ref;
  }
  const mapping = parseMapping(champs.statusMapping);
  if (!mapping.ok) return mapping;
  const champsObligatoires = champs.requiredFields;
  if (champsObligatoires !== undefined && !estObjetPlat(champsObligatoires)) {
    return { ok: false, error: "requiredFields : objet plat de valeurs texte" };
  }
  const config: Record<string, unknown> = { statusMapping: mapping.value };
  if (champsObligatoires !== undefined) config.requiredFields = champsObligatoires;
  if (JSON.stringify(config).length > 4096) return { ok: false, error: "config : 4 096 octets au plus" };
  return { ok: true, value: { app, provider, target, credentialRef, webhookSecretRef, config } };
}

function estObjetPlat(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => typeof x === "string" && x.length <= 200 && !hasSqlControlCharacters(x),
  );
}

/**
 * Le mapping de statut est EXPLICITE ou absent. Aucun défaut : décider qu'un
 * ticket fermé résout une issue est une politique, et personne ne l'a choisie.
 */
function parseMapping(v: unknown): Parsed<{ closed: string | null; reopened: string | null }> {
  if (v === undefined || v === null) return { ok: true, value: { closed: null, reopened: null } };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "statusMapping : objet attendu" };
  const brut = v as Record<string, unknown>;
  const lire = (cle: "closed" | "reopened"): Parsed<string | null> => {
    const x = brut[cle];
    if (x === undefined || x === null) return { ok: true, value: null };
    if (typeof x !== "string" || !STATUTS_MAPPABLES.includes(x as (typeof STATUTS_MAPPABLES)[number])) {
      return { ok: false, error: `statusMapping.${cle} : ${STATUTS_MAPPABLES.join(", ")} ou null` };
    }
    return { ok: true, value: x };
  };
  const closed = lire("closed");
  if (!closed.ok) return closed;
  const reopened = lire("reopened");
  if (!reopened.ok) return reopened;
  return { ok: true, value: { closed: closed.value, reopened: reopened.value } };
}

export interface IntegrationPatch {
  enabled?: boolean;
  configVersion?: number;
  /** Sortie de `degraded` après correction du jeton ; jamais l'inverse depuis l'API. */
  state?: "active";
  /** Marque la recette réelle jouée (ou la retire). */
  verified?: boolean;
}

export function parseIntegrationPatch(body: unknown): Parsed<IntegrationPatch> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "objet JSON attendu" };
  }
  const champs = body as Record<string, unknown>;
  const patch: IntegrationPatch = {};
  if (champs.enabled !== undefined) {
    if (typeof champs.enabled !== "boolean") return { ok: false, error: "enabled : booléen" };
    patch.enabled = champs.enabled;
  }
  if (champs.configVersion !== undefined) {
    const n = champs.configVersion;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 1_000_000) {
      return { ok: false, error: "configVersion : entier ≥ 1" };
    }
    patch.configVersion = n;
  }
  if (champs.state !== undefined) {
    if (champs.state !== "active") return { ok: false, error: "state : seul « active » est posable depuis l'API" };
    patch.state = "active";
  }
  if (champs.verified !== undefined) {
    if (typeof champs.verified !== "boolean") return { ok: false, error: "verified : booléen" };
    patch.verified = champs.verified;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "au moins une mutation requise : enabled, configVersion, state ou verified" };
  }
  return { ok: true, value: patch };
}

// ────────────────────────────── Mutations ────────────────────────────────────

/**
 * Crée une intégration et trace la création. `null` si l'app est inconnue du
 * registre : une configuration sur une app qui n'existe pas serait une ligne
 * orpheline que personne ne verrait jamais.
 */
export async function createTicketIntegration(
  request: IntegrationRequest,
  adminEmail: string,
): Promise<TicketIntegration | null> {
  return tx(async (client) => {
    const { rowCount } = await client.query("select 1 from app_registry where app_id = $1", [request.app]);
    if (!rowCount) return null;
    const { rows: [cree] } = await client.query<Ligne>(
      `insert into ticket_integration (app_id, provider, target, credential_ref, webhook_secret_ref, config, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       returning ${COLONNES}`,
      [
        request.app, request.provider, request.target, request.credentialRef,
        request.webhookSecretRef, JSON.stringify(request.config), adminEmail,
      ],
    );
    // L'audit porte la FORME du secret, jamais sa référence : un journal d'audit
    // se relit, s'exporte et s'archive — c'est exactement l'endroit où un nom de
    // variable finirait par voyager avec le reste.
    await client.query("insert into audit_log (user_email, action, detail) values ($1, 'ticket_integration_create', $2)", [
      adminEmail,
      JSON.stringify({
        id: cree.id, app_id: request.app, provider: request.provider, target: request.target,
        credential: decrire(request.credentialRef).kind,
      }),
    ]);
    return versIntegration(cree);
  });
}

/** Modifie enabled / configVersion / state / verified. `null` si introuvable. */
export async function patchTicketIntegration(
  id: string,
  patch: IntegrationPatch,
  adminEmail: string,
  apps: string[] | null,
): Promise<TicketIntegration | null> {
  if (!/^[1-9]\d{0,17}$/.test(id)) return null;
  return tx(async (client) => {
    // Le périmètre est REVÉRIFIÉ après résolution de la ressource : l'identifiant
    // seul ne dit pas à quelle app il appartient, et un admin scopé ne doit pas
    // pouvoir activer le connecteur d'un autre client en devinant un entier.
    const { rows: [avant] } = await client.query<{ app_id: string }>(
      "select app_id from ticket_integration where id = $1 for update",
      [id],
    );
    if (!avant) return null;
    if (apps && !apps.includes(avant.app_id)) return null;
    const { rows: [apres] } = await client.query<Ligne>(
      `update ticket_integration
          set enabled        = coalesce($2, enabled),
              config_version = coalesce($3, config_version),
              state          = coalesce($4, state),
              last_error     = case when $4 = 'active' then null else last_error end,
              verified_at    = case when $5::boolean is null then verified_at
                                    when $5 then coalesce(verified_at, now()) end,
              updated_at     = now()
        where id = $1
        returning ${COLONNES}`,
      [id, patch.enabled ?? null, patch.configVersion ?? null, patch.state ?? null, patch.verified ?? null],
    );
    await client.query("insert into audit_log (user_email, action, detail) values ($1, 'ticket_integration_patch', $2)", [
      adminEmail,
      JSON.stringify({ id, app_id: apres.app_id, ...patch }),
    ]);
    return versIntegration(apres);
  });
}

// ─────────────────── Demande de ticket et état de livraison ──────────────────

export interface TicketApercu {
  titre: string;
  description: string;
  url: string;
  reference: string;
}

export interface TicketLivraison {
  id: string;
  integration_id: string;
  provider: string;
  target: string;
  state: "pending" | "sent" | "failed" | "delivery_uncertain" | "cancelled";
  attempts: number;
  external_id: string | null;
  external_url: string | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

/** Origine de la console, pour le lien inscrit dans le ticket. */
export function origineConsole(entetes: Headers): string {
  const configuree = process.env.MIP_CONSOLE_URL?.trim();
  if (configuree) return configuree.replace(/\/+$/, "");
  const hote = (entetes.get("x-forwarded-host") ?? entetes.get("host"))?.split(",")[0].trim();
  const protocole = entetes.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return hote ? `${protocole}://${hote}` : "";
}

interface EtatIssue {
  id: string;
  app_id: string;
  status: string;
  revision: string;
  error_type: string | null;
  message: string | null;
  first_release: string | null;
  last_release: string | null;
  occurrences: string | null;
  first_seen: Date;
  last_seen: Date;
}

const ISSUE_SQL = `
  select i.id::text as id, i.app_id, i.status, i.revision::text as revision,
         i.first_release, i.last_release, i.first_seen, i.last_seen,
         e.error_type, e.message,
         (select sum(x.occurrences)::text from rum_error x
           where x.app_id = i.app_id and x.issue_id = i.id) as occurrences
    from error_issue i
    left join lateral (
      select error_type, message from rum_error
       where app_id = i.app_id and issue_id = i.id
       order by ts desc, id desc limit 1
    ) e on true
   where i.id = $1 and ($2::text[] is null or i.app_id = any($2::text[]))`;

/**
 * L'aperçu EXACT de ce qui partira. Ce n'est pas une approximation : c'est le
 * même appel à `construireCharge` que celui qui fige la charge dans la file de
 * sortie, sur la même lecture de l'issue. Ce que l'écran montre et ce que le
 * fournisseur reçoit ne peuvent donc pas diverger — et si l'issue change entre
 * l'aperçu et la demande, `expectedRevision` rend un 409 plutôt qu'un envoi
 * différent de ce qui a été montré.
 */
export async function apercuTicket(
  issueId: string,
  apps: string[] | null,
  consoleBase: string,
): Promise<{ apercu: TicketApercu; revision: string; app_id: string } | null> {
  if (!isIssueId(issueId) || apps?.length === 0) return null;
  const [issue] = await q<EtatIssue>(ISSUE_SQL, [issueId, apps]);
  if (!issue) return null;
  return {
    apercu: chargeDe(issue, consoleBase),
    revision: issue.revision,
    app_id: issue.app_id,
  };
}

function chargeDe(issue: EtatIssue, consoleBase: string): TicketApercu {
  return construireCharge(
    {
      issueId: issue.id,
      appId: issue.app_id,
      errorType: issue.error_type,
      message: issue.message,
      firstRelease: issue.first_release,
      lastRelease: issue.last_release,
      // Aucune occurrence relevée = inconnue, pas zéro : la purge de rétention a
      // pu emporter les lignes d'une issue qui, elle, existe toujours.
      occurrences: issue.occurrences === null ? null : Number(issue.occurrences),
      firstSeen: issue.first_seen,
      lastSeen: issue.last_seen,
    },
    { consoleBase },
  ) as TicketApercu;
}

export interface DemandeTicket {
  app: string;
  integrationId: string;
  expectedRevision: string;
}

export function parseDemandeTicket(body: unknown): Parsed<DemandeTicket> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "objet JSON attendu" };
  }
  const champs = body as Record<string, unknown>;
  const app = typeof champs.app === "string" ? champs.app.trim() : "";
  if (!app || app.length > 200 || hasSqlControlCharacters(app)) return { ok: false, error: "app requise" };
  const brut = champs.integrationId;
  const integrationId =
    typeof brut === "number" && Number.isSafeInteger(brut) && brut >= 1
      ? String(brut)
      : typeof brut === "string" && /^[1-9]\d{0,17}$/.test(brut)
        ? brut
        : null;
  if (!integrationId) return { ok: false, error: "integrationId requis" };
  const revision = champs.expectedRevision;
  const expectedRevision =
    typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 1
      ? String(revision)
      : typeof revision === "string" && /^[1-9]\d{0,17}$/.test(revision)
        ? revision
        : null;
  if (!expectedRevision) return { ok: false, error: "expectedRevision requis (révision lue)" };
  return { ok: true, value: { app, integrationId, expectedRevision } };
}

/**
 * Inscrit la demande dans la file de sortie. Rend 202 côté route : le ticket
 * n'existe pas encore, et prétendre le contraire serait faux.
 *
 * LA CLÉ D'IDEMPOTENCE EST DÉTERMINISTE — `ticket:<intégration>:<issue>`. Deux
 * clics, deux onglets, un rejeu du 202 : une seule ligne, donc un seul ticket.
 * Une demande déjà en file ou déjà livrée rend cette ligne telle quelle plutôt
 * qu'une seconde création ; c'est la seule réponse qui ne crée pas de doublon
 * chez le client.
 */
export async function demanderTicket(
  ctx: { issueId: string; apps: string[] | null; actorEmail: string },
  request: DemandeTicket,
  consoleBase: string,
): Promise<WorkflowResult<{ jobId: string; state: string; payload: TicketApercu; revision: string }>> {
  if (!isIssueId(ctx.issueId) || ctx.apps?.length === 0) return { kind: "not_found" };
  if (ctx.apps && !ctx.apps.includes(request.app)) return { kind: "not_found" };
  if (!(await ticketSchemaDisponible())) return { kind: "unavailable" };
  return tx(async (client) => {
    const { rows: [acteur] } = await client.query<{ id: string }>(
      "select id::text as id from console_user where email = $1 and active",
      [ctx.actorEmail],
    );
    if (!acteur) return { kind: "forbidden", error: "aucun compte console actif pour cette session" };

    // L'issue est verrouillée AVANT la lecture de l'intégration : la charge figée
    // doit correspondre à l'état sur lequel l'opérateur a vu l'aperçu.
    const { rows: [issue] } = await client.query<EtatIssue>(`${ISSUE_SQL} for no key update of i`, [
      ctx.issueId,
      ctx.apps,
    ]);
    if (!issue || issue.app_id !== request.app) return { kind: "not_found" };
    if (issue.revision !== request.expectedRevision) {
      return {
        kind: "conflict",
        error: "l'issue a été modifiée depuis sa lecture : recharger pour revoir le ticket qui sera envoyé",
        revision: issue.revision,
      };
    }

    const { rows: [integration] } = await client.query<{ id: string; app_id: string; state: string; enabled: boolean; verified_at: Date | null }>(
      "select id::text as id, app_id, state, enabled, verified_at from ticket_integration where id = $1",
      [request.integrationId],
    );
    // Périmètre REVÉRIFIÉ après résolution : l'intégration doit appartenir à
    // l'app de l'issue, pas seulement au périmètre du principal.
    if (!integration || integration.app_id !== issue.app_id) return { kind: "not_found" };
    if (!integration.enabled || integration.state !== "active") {
      return { kind: "invalid", error: "intégration désactivée ou dégradée : rien n'a été envoyé" };
    }
    if (!integration.verified_at) {
      return { kind: "invalid", error: "intégration jamais éprouvée : jouer la recette avant de créer des tickets" };
    }

    const charge = chargeDe(issue, consoleBase);
    const cle = `ticket:${integration.id}:${issue.id}`;
    const { rows: [inscrite] } = await client.query<{ id: string; state: string }>(
      `insert into ticket_outbox (app_id, integration_id, issue_id, idempotency_key, payload, requested_by_user_id)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (idempotency_key) do nothing
       returning id::text as id, state`,
      [issue.app_id, integration.id, issue.id, cle, JSON.stringify(charge), acteur.id],
    );
    if (!inscrite) {
      const { rows: [existante] } = await client.query<{ id: string; state: string }>(
        "select id::text as id, state from ticket_outbox where idempotency_key = $1",
        [cle],
      );
      return {
        kind: "ok",
        value: { jobId: existante.id, state: existante.state, payload: charge, revision: issue.revision },
      };
    }
    await client.query("insert into audit_log (user_email, action, detail) values ($1, 'ticket_request', $2)", [
      ctx.actorEmail,
      JSON.stringify({ app_id: issue.app_id, issue_id: issue.id, integration_id: integration.id, job_id: inscrite.id }),
    ]);
    return {
      kind: "ok",
      value: { jobId: inscrite.id, state: inscrite.state, payload: charge, revision: issue.revision },
    };
  });
}

/** Demandes de tickets d'une issue, la plus récente d'abord. Jamais de secret. */
export async function livraisonsTicket(
  issueId: string,
  apps: string[] | null,
): Promise<WorkflowResult<{ app_id: string; deliveries: TicketLivraison[] }>> {
  if (!isIssueId(issueId) || apps?.length === 0) return { kind: "not_found" };
  if (!(await ticketSchemaDisponible())) return { kind: "unavailable" };
  const [issue] = await q<{ app_id: string }>(
    "select app_id from error_issue where id = $1 and ($2::text[] is null or app_id = any($2::text[]))",
    [issueId, apps],
  );
  if (!issue) return { kind: "not_found" };
  const deliveries = await q<TicketLivraison>(
    `select o.id::text as id, o.integration_id::text as integration_id, i.provider, i.target,
            o.state, o.attempts, o.external_id, o.external_url, o.last_error, o.created_at, o.sent_at
       from ticket_outbox o
       join ticket_integration i on i.id = o.integration_id
      where o.app_id = $1 and o.issue_id = $2
      order by o.created_at desc, o.id desc
      limit 50`,
    [issue.app_id, issueId],
  );
  return { kind: "ok", value: { app_id: issue.app_id, deliveries } };
}

export { referenceMip };
