// Workflow d'une issue d'erreurs (P5.6, migration-v73) : triage, assignation,
// commentaires, liens de ticket et historique.
//
// CONCURRENCE OPTIMISTE. Chaque mutation porte la révision lue par l'écran ;
// l'issue est verrouillée, la révision comparée, puis la mutation, son activité
// et la nouvelle révision sont écrites dans UNE transaction. Deux éditions
// concurrentes : la seconde reçoit `conflict` (409), jamais un écrasement. Une
// régression confirmée à l'ingestion incrémente aussi la révision.
//
// PÉRIMÈTRE. L'issue est cherchée dans les apps du principal ET dans l'app
// annoncée par la requête : un identifiant d'une autre app, ou hors périmètre,
// n'existe pas (404). Un assigné doit être un compte actif ayant accès à l'app
// de l'issue selon `console_user.apps` (NULL = toutes, liste vide = aucune).
//
// Aucune donnée ne part vers un fournisseur de tickets (P8.6), et l'activité ne
// recopie ni stack, ni message d'erreur, ni identité RUM.
import type { PoolClient } from "pg";
import { COMMENTAIRE_MAX, texteActivite } from "ingest/lib/error-issue-workflow.mjs";
import { hasControlCharacters } from "ingest/shared/sourcemap.mjs";
import { q, tx } from "./db";
import { ISSUE_STATUSES, isIssueId, type IssueStatus } from "./error-issues";
import { encodeErrorCursor } from "./queries-errors";

export const ACTIVITY_KINDS = ["status", "assignee", "comment", "link", "regression"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const COMMENT_MAX_CHARS = COMMENTAIRE_MAX;
export const LINK_URL_MAX_CHARS = 2048;
export const LINK_LABEL_MAX_CHARS = 120;
export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 100;

const BIGINT_ID = /^[1-9]\d{0,17}$/;

// ─────────────────────────────── Contrats ────────────────────────────────────

export interface IssueUserRef {
  /** bigint PostgreSQL sérialisé en chaîne. */
  user_id: string;
  /** null : compte supprimé depuis. */
  email: string | null;
}

export interface IssueLink {
  id: string;
  url: string;
  label: string;
  created_by: IssueUserRef | null;
  created_at: Date;
}

export interface IssueActivity {
  id: string;
  kind: ActivityKind;
  actor: { kind: "user" | "system"; user: IssueUserRef | null };
  old_status: IssueStatus | null;
  new_status: IssueStatus | null;
  old_assignee: IssueUserRef | null;
  new_assignee: IssueUserRef | null;
  body: string | null;
  /** Commentaire système : note du groupe historique importée. */
  legacy_fingerprint: string | null;
  link: IssueLink | null;
  /** Résolution : release de référence ; régression : release qui rouvre. */
  release: string | null;
  /** Régression : release de référence dépassée. */
  reference_release: string | null;
  env: string | null;
  created_at: Date;
}

/** État de workflow d'une issue après une mutation. */
export interface IssueWorkflowState {
  id: string;
  app_id: string;
  status: IssueStatus;
  status_source: "system" | "migration" | "user";
  assignee: IssueUserRef | null;
  resolved_at: Date | null;
  resolved_by: IssueUserRef | null;
  resolved_release: string | null;
  resolved_env: string | null;
  revision: string;
  updated_at: Date;
}

export type WorkflowResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "unavailable" }
  | { kind: "forbidden"; error: string }
  | { kind: "not_found" }
  | { kind: "conflict"; error: string; revision: string }
  | { kind: "invalid"; error: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TriageRequest {
  app: string;
  status?: IssueStatus;
  /** undefined : inchangé ; null : désassigner. */
  assigneeUserId?: string | null;
  expectedRevision: string;
}

export interface CommentRequest {
  app: string;
  body: string;
  expectedRevision: string;
}

export interface LinkRequest {
  app: string;
  url: string;
  label: string;
  expectedRevision: string;
}

// ────────────────────────────── Validation ───────────────────────────────────

function objet(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function appDe(v: unknown): string | null {
  const app = typeof v === "string" ? v.trim() : "";
  return app && app.length <= 200 && !hasControlCharacters(app) ? app : null;
}

/** Identifiant bigint positif, en nombre sûr ou en chaîne décimale ; null sinon. */
export function parseBigintId(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 1 ? String(v) : null;
  return typeof v === "string" && BIGINT_ID.test(v) ? v : null;
}

function socle(body: unknown): Parsed<{ champs: Record<string, unknown>; app: string; expectedRevision: string }> {
  const champs = objet(body);
  if (!champs) return { ok: false, error: "objet JSON attendu" };
  const app = appDe(champs.app);
  if (!app) return { ok: false, error: "app requise" };
  const expectedRevision = parseBigintId(champs.expectedRevision);
  if (!expectedRevision) return { ok: false, error: "expectedRevision requis (révision lue, entier positif)" };
  return { ok: true, value: { champs, app, expectedRevision } };
}

/** `{app, status?, assigneeUserId?, expectedRevision}` avec au moins une mutation. Pure. */
export function parseTriageRequest(body: unknown): Parsed<TriageRequest> {
  const base = socle(body);
  if (!base.ok) return base;
  const { champs, app, expectedRevision } = base.value;
  const request: TriageRequest = { app, expectedRevision };
  if (champs.status !== undefined) {
    const status = ISSUE_STATUSES.find((s) => s === champs.status);
    if (!status) return { ok: false, error: "status invalide (open, for_review, resolved ou ignored)" };
    request.status = status;
  }
  if (champs.assigneeUserId !== undefined) {
    if (champs.assigneeUserId === null) request.assigneeUserId = null;
    else {
      const id = parseBigintId(champs.assigneeUserId);
      if (!id) return { ok: false, error: "assigneeUserId invalide (identifiant de compte ou null)" };
      request.assigneeUserId = id;
    }
  }
  if (request.status === undefined && request.assigneeUserId === undefined) {
    return { ok: false, error: "au moins une mutation requise : status ou assigneeUserId" };
  }
  return { ok: true, value: request };
}

/** `{app, body, expectedRevision}` : scrubbé, 1 à 2 000 caractères APRÈS masquage. Pure. */
export function parseCommentRequest(body: unknown): Parsed<CommentRequest> {
  const base = socle(body);
  if (!base.ok) return base;
  const { champs, app, expectedRevision } = base.value;
  const texte = texteActivite(champs.body);
  if (texte === null) return { ok: false, error: "body requis (commentaire non vide)" };
  if ([...texte].length > COMMENT_MAX_CHARS) {
    return { ok: false, error: `body : ${COMMENT_MAX_CHARS} caractères au plus` };
  }
  return { ok: true, value: { app, body: texte, expectedRevision } };
}

/**
 * URL de ticket telle qu'elle est stockée : HTTPS, hôte présent, sans identifiants,
 * normalisée par WHATWG URL (hôte en punycode, points de code encodés), donc en
 * ASCII imprimable ; 2 048 caractères au plus. null si refusée. Pure.
 */
export function normalizeTicketUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > LINK_URL_MAX_CHARS) return null;
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  const href = url.href;
  return href.length <= LINK_URL_MAX_CHARS && /^[!-~]+$/.test(href) ? href : null;
}

/** `{app, url, label, expectedRevision}` : URL HTTPS validée, libellé scrubbé ≤ 120. Pure. */
export function parseLinkRequest(body: unknown): Parsed<LinkRequest> {
  const base = socle(body);
  if (!base.ok) return base;
  const { champs, app, expectedRevision } = base.value;
  const url = normalizeTicketUrl(champs.url);
  if (!url) {
    return { ok: false, error: `url invalide (https, sans identifiants, ${LINK_URL_MAX_CHARS} caractères au plus)` };
  }
  const label = texteActivite(champs.label);
  if (label === null || hasControlCharacters(label) || [...label].length > LINK_LABEL_MAX_CHARS) {
    return { ok: false, error: `label requis (${LINK_LABEL_MAX_CHARS} caractères au plus, sans retour à la ligne)` };
  }
  return { ok: true, value: { app, url, label, expectedRevision } };
}

// ─────────────────────────────── Lectures ────────────────────────────────────

/** migration-v73 appliquée ? Sonde rejouée à chaque appel, comme celles de P5.1/P5.5. */
export async function issueWorkflowAvailable(): Promise<boolean> {
  const [row] = await q<{ v73: boolean }>("select to_regclass('public.error_issue_activity') is not null as v73");
  return row?.v73 === true;
}

const USER_REF = (colonne: string, alias: string) =>
  `case when ${colonne} is null then null else jsonb_build_object('user_id', ${colonne}::text, 'email', ${alias}.email) end`;

interface ActivitySqlRow extends Omit<IssueActivity, "link"> {
  link_id: string | null;
  link_url: string | null;
  link_label: string | null;
  link_created_by: IssueUserRef | null;
  link_created_at: Date | null;
  cursor_id: string;
  cursor_ts: string;
}

const ACTIVITY_SQL = `
  select a.id::text as id, a.kind,
         jsonb_build_object('kind', a.actor_kind, 'user', ${USER_REF("a.actor_user_id", "acteur")}) as actor,
         a.old_status, a.new_status,
         ${USER_REF("a.old_assignee_user_id", "ancien")} as old_assignee,
         ${USER_REF("a.new_assignee_user_id", "nouveau")} as new_assignee,
         a.body, a.legacy_fingerprint, a.release, a.reference_release, a.env, a.created_at,
         t.id::text as link_id, t.url as link_url, t.label as link_label,
         ${USER_REF("t.created_by_user_id", "createur")} as link_created_by, t.created_at as link_created_at,
         a.id::text as cursor_id,
         to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
    from error_issue_activity a
    left join console_user acteur on acteur.id = a.actor_user_id
    left join console_user ancien on ancien.id = a.old_assignee_user_id
    left join console_user nouveau on nouveau.id = a.new_assignee_user_id
    left join error_issue_ticket t on t.app_id = a.app_id and t.issue_id = a.issue_id and t.id = a.ticket_id
    left join console_user createur on createur.id = t.created_by_user_id`;

function toActivity({ link_id, link_url, link_label, link_created_by, link_created_at, cursor_id: _id, cursor_ts: _ts, ...row }: ActivitySqlRow): IssueActivity {
  return {
    ...row,
    link: link_id && link_url && link_label && link_created_at
      ? { id: link_id, url: link_url, label: link_label, created_by: link_created_by, created_at: link_created_at }
      : null,
  };
}

/**
 * Historique d'une issue, le plus récent d'abord, paginé par curseur `(created_at, id)`
 * à la microseconde. `apps` : périmètre du principal (null = tous, [] = aucun).
 */
export async function listIssueActivity(
  issueId: string,
  apps: string[] | null,
  page: { limit: number; cursor: { ts: string; id: string } | null },
): Promise<WorkflowResult<{ app_id: string; activities: IssueActivity[]; next_cursor: string | null }>> {
  if (apps?.length === 0 || !isIssueId(issueId)) return { kind: "not_found" };
  if (!(await issueWorkflowAvailable())) return { kind: "unavailable" };
  const [issue] = await q<{ app_id: string }>(
    "select app_id from error_issue where id = $1 and ($2::text[] is null or app_id = any($2::text[]))",
    [issueId, apps],
  );
  if (!issue) return { kind: "not_found" };
  const rows = await q<ActivitySqlRow>(
    `${ACTIVITY_SQL}
      where a.app_id = $1 and a.issue_id = $2
        and ($3::timestamptz is null or (a.created_at, a.id) < ($3::timestamptz, $4::bigint))
      order by a.created_at desc, a.id desc
      limit $5`,
    [issue.app_id, issueId, page.cursor?.ts ?? null, page.cursor?.id ?? null, page.limit],
  );
  const derniere = rows.length === page.limit ? rows.at(-1) : undefined;
  return {
    kind: "ok",
    value: {
      app_id: issue.app_id,
      activities: rows.map(toActivity),
      next_cursor: derniere ? encodeErrorCursor(derniere) : null,
    },
  };
}

export interface IssueWorkflowView {
  assignee: IssueUserRef | null;
  resolved_by: IssueUserRef | null;
  /** La dernière décision de statut est une régression confirmée : ce qui a rouvert l'issue. */
  regression: IssueActivity | null;
  links: IssueLink[];
  /** Comptes assignables : actifs et autorisés sur l'app de l'issue. */
  assignable_users: IssueUserRef[];
}

/** Ce que l'écran d'une issue ajoute à sa lecture P5.5 ; null sans migration-v73. */
export async function issueWorkflowView(issueId: string, appId: string): Promise<IssueWorkflowView | null> {
  if (!(await issueWorkflowAvailable())) return null;
  const [etat] = await q<{ assignee: IssueUserRef | null; resolved_by: IssueUserRef | null }>(
    `select ${USER_REF("i.assignee_user_id", "assigne")} as assignee,
            ${USER_REF("i.resolved_by_user_id", "resolveur")} as resolved_by
       from error_issue i
       left join console_user assigne on assigne.id = i.assignee_user_id
       left join console_user resolveur on resolveur.id = i.resolved_by_user_id
      where i.app_id = $1 and i.id = $2`,
    [appId, issueId],
  );
  if (!etat) return null;
  const [decision] = await q<ActivitySqlRow>(
    `${ACTIVITY_SQL}
      where a.app_id = $1 and a.issue_id = $2 and a.kind in ('status', 'regression')
      order by a.created_at desc, a.id desc
      limit 1`,
    [appId, issueId],
  );
  const links = await q<IssueLink>(
    `select t.id::text as id, t.url, t.label, ${USER_REF("t.created_by_user_id", "createur")} as created_by, t.created_at
       from error_issue_ticket t
       left join console_user createur on createur.id = t.created_by_user_id
      where t.app_id = $1 and t.issue_id = $2
      order by t.created_at, t.id
      limit 100`,
    [appId, issueId],
  );
  const assignable_users = await q<IssueUserRef>(
    `select id::text as user_id, email from console_user
      where active and (apps is null or $1 = any(apps))
      order by email
      limit 500`,
    [appId],
  );
  return {
    ...etat,
    regression: decision?.kind === "regression" ? toActivity(decision) : null,
    links,
    assignable_users,
  };
}

// ─────────────────────────────── Mutations ───────────────────────────────────

interface LockedIssue {
  id: string;
  app_id: string;
  status: IssueStatus;
  assignee_user_id: string | null;
  revision: string;
  last_release: string | null;
}

interface MutationContext {
  issueId: string;
  /** Périmètre du principal : null = toutes les apps. */
  apps: string[] | null;
  actorEmail: string;
}

type Mutation<T> = (client: PoolClient, issue: LockedIssue, actorId: string) => Promise<WorkflowResult<T>>;

const STATE_SQL = `
  select i.id::text as id, i.app_id, i.status, i.status_source,
         ${USER_REF("i.assignee_user_id", "assigne")} as assignee,
         i.resolved_at, ${USER_REF("i.resolved_by_user_id", "resolveur")} as resolved_by,
         i.resolved_release, i.resolved_env, i.revision::text as revision, i.updated_at
    from error_issue i
    left join console_user assigne on assigne.id = i.assignee_user_id
    left join console_user resolveur on resolveur.id = i.resolved_by_user_id
   where i.app_id = $1 and i.id = $2`;

/**
 * Socle commun : schéma, acteur, issue verrouillée dans le périmètre et l'app
 * annoncée, révision attendue — puis la mutation, dans la même transaction.
 */
async function muter<T>(ctx: MutationContext, app: string, expectedRevision: string, mutation: Mutation<T>): Promise<WorkflowResult<T>> {
  if (ctx.apps?.length === 0 || !isIssueId(ctx.issueId)) return { kind: "not_found" };
  if (ctx.apps && !ctx.apps.includes(app)) return { kind: "not_found" };
  if (!(await issueWorkflowAvailable())) return { kind: "unavailable" };
  return tx(async (client) => {
    const { rows: [acteur] } = await client.query<{ id: string }>(
      "select id::text as id from console_user where email = $1 and active",
      [ctx.actorEmail],
    );
    if (!acteur) return { kind: "forbidden", error: "aucun compte console actif pour cette session" };
    const { rows: [issue] } = await client.query<LockedIssue>(
      `select id::text as id, app_id, status, assignee_user_id::text as assignee_user_id,
              revision::text as revision, last_release
         from error_issue
        where app_id = $1 and id = $2
        for update`,
      [app, ctx.issueId],
    );
    if (!issue) return { kind: "not_found" };
    if (issue.revision !== expectedRevision) {
      return { kind: "conflict", error: "l'issue a été modifiée depuis sa lecture : recharger", revision: issue.revision };
    }
    return mutation(client, issue, acteur.id);
  });
}

async function audit(client: PoolClient, email: string, action: string, detail: Record<string, unknown>) {
  await client.query("insert into audit_log (user_email, action, detail) values ($1, $2, $3)", [
    email,
    action,
    JSON.stringify(detail),
  ]);
}

async function nouvelleRevision(client: PoolClient, issue: LockedIssue): Promise<string> {
  const { rows: [row] } = await client.query<{ revision: string }>(
    `update error_issue set revision = revision + 1, updated_at = now()
      where app_id = $1 and id = $2 returning revision::text as revision`,
    [issue.app_id, issue.id],
  );
  return row.revision;
}

/**
 * Référence d'une résolution : la release et l'env de la dernière occurrence
 * rattachée (celle de `last_seen`). La régression se jugera contre elles, dans cet
 * env, par l'ordre des marqueurs de déploiement. Une issue dont la dernière vue
 * vient d'un groupe historique garde la dernière release connue et un env inconnu :
 * toute réapparition restera alors « à vérifier ».
 */
async function referenceResolution(client: PoolClient, issue: LockedIssue): Promise<{ release: string | null; env: string | null }> {
  // `last_seen` reste en base : relu en JavaScript, il perdrait ses microsecondes.
  // La fenêtre d'une milliseconde couvre la dernière vue écrite par l'ingestion,
  // elle-même tronquée à la milliseconde, sans parcourir l'historique de l'issue.
  const { rows: [derniere] } = await client.query<{ release: string | null; env: string | null }>(
    `select e.release, e.env
       from error_issue i
       join lateral (
         select release, env from rum_error
          where ts between i.last_seen - interval '1 millisecond' and i.last_seen + interval '1 millisecond'
            and app_id = i.app_id and issue_id = i.id
          order by ts desc, id desc
          limit 1
       ) e on true
      where i.app_id = $1 and i.id = $2`,
    [issue.app_id, issue.id],
  );
  return derniere ? { release: derniere.release ?? issue.last_release, env: derniere.env } : { release: issue.last_release, env: null };
}

/** Statut et/ou assigné. L'assignation ne change jamais le statut. */
export async function triageIssue(ctx: MutationContext, request: TriageRequest): Promise<WorkflowResult<IssueWorkflowState>> {
  return muter(ctx, request.app, request.expectedRevision, async (client, issue, actorId) => {
    const statut = request.status ?? issue.status;
    const assigne = request.assigneeUserId === undefined ? issue.assignee_user_id : request.assigneeUserId;
    const statutChange = statut !== issue.status;
    const assigneChange = assigne !== issue.assignee_user_id;
    if (assigneChange && assigne !== null) {
      const { rowCount } = await client.query(
        "select 1 from console_user where id = $1 and active and (apps is null or $2 = any(apps))",
        [assigne, issue.app_id],
      );
      if (!rowCount) return { kind: "invalid", error: "assigneeUserId : aucun compte actif autorisé sur cette app" };
    }
    if (statutChange || assigneChange) {
      const reference = statutChange && statut === "resolved" ? await referenceResolution(client, issue) : null;
      if (statutChange) {
        await client.query(
          `update error_issue
              set status = $3, status_source = 'user',
                  resolved_at = case when $3 = 'resolved' then clock_timestamp() end,
                  resolved_by_user_id = case when $3 = 'resolved' then $4::bigint end,
                  resolved_release = $5, resolved_env = $6
            where app_id = $1 and id = $2`,
          [issue.app_id, issue.id, statut, actorId, reference?.release ?? null, reference?.env ?? null],
        );
        await client.query(
          `insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, old_status, new_status, release, env)
           values ($1, $2, 'status', 'user', $3, $4, $5, $6, $7)`,
          [issue.app_id, issue.id, actorId, issue.status, statut, reference?.release ?? null, reference?.env ?? null],
        );
      }
      if (assigneChange) {
        await client.query("update error_issue set assignee_user_id = $3 where app_id = $1 and id = $2", [
          issue.app_id,
          issue.id,
          assigne,
        ]);
        await client.query(
          `insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, old_assignee_user_id, new_assignee_user_id)
           values ($1, $2, 'assignee', 'user', $3, $4, $5)`,
          [issue.app_id, issue.id, actorId, issue.assignee_user_id, assigne],
        );
      }
      await nouvelleRevision(client, issue);
      await audit(client, ctx.actorEmail, "error_issue_triage", {
        app_id: issue.app_id,
        issue_id: issue.id,
        ...(statutChange ? { status: { from: issue.status, to: statut } } : {}),
        ...(assigneChange ? { assignee_user_id: { from: issue.assignee_user_id, to: assigne } } : {}),
      });
    }
    const { rows: [etat] } = await client.query<IssueWorkflowState>(STATE_SQL, [issue.app_id, issue.id]);
    return { kind: "ok", value: etat };
  });
}

/** Commentaire scrubbé, en activité ; incrémente la révision. */
export async function commentIssue(
  ctx: MutationContext,
  request: CommentRequest,
): Promise<WorkflowResult<{ activity: IssueActivity; revision: string }>> {
  return muter(ctx, request.app, request.expectedRevision, async (client, issue, actorId) => {
    const { rows: [cree] } = await client.query<{ id: string }>(
      `insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, body)
       values ($1, $2, 'comment', 'user', $3, $4) returning id::text as id`,
      [issue.app_id, issue.id, actorId, request.body],
    );
    const revision = await nouvelleRevision(client, issue);
    await audit(client, ctx.actorEmail, "error_issue_comment", { app_id: issue.app_id, issue_id: issue.id, activity_id: cree.id });
    const { rows: [activite] } = await client.query<ActivitySqlRow>(`${ACTIVITY_SQL} where a.id = $1`, [cree.id]);
    return { kind: "ok", value: { activity: toActivity(activite), revision } };
  });
}

/** Lien de ticket manuel ; une même URL deux fois sur l'issue est un conflit. */
export async function linkIssue(
  ctx: MutationContext,
  request: LinkRequest,
): Promise<WorkflowResult<{ link: IssueLink; activity: IssueActivity; revision: string }>> {
  return muter(ctx, request.app, request.expectedRevision, async (client, issue, actorId) => {
    const { rows: [ticket] } = await client.query<{ id: string }>(
      `insert into error_issue_ticket (app_id, issue_id, url, label, created_by_user_id)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id, issue_id, url) do nothing
       returning id::text as id`,
      [issue.app_id, issue.id, request.url, request.label, actorId],
    );
    if (!ticket) return { kind: "conflict", error: "ce lien est déjà attaché à l'issue", revision: issue.revision };
    const { rows: [cree] } = await client.query<{ id: string }>(
      `insert into error_issue_activity (app_id, issue_id, kind, actor_kind, actor_user_id, ticket_id)
       values ($1, $2, 'link', 'user', $3, $4) returning id::text as id`,
      [issue.app_id, issue.id, actorId, ticket.id],
    );
    const revision = await nouvelleRevision(client, issue);
    await audit(client, ctx.actorEmail, "error_issue_link", { app_id: issue.app_id, issue_id: issue.id, ticket_id: ticket.id });
    const { rows: [activite] } = await client.query<ActivitySqlRow>(`${ACTIVITY_SQL} where a.id = $1`, [cree.id]);
    const value = toActivity(activite);
    return { kind: "ok", value: { link: value.link as IssueLink, activity: value, revision } };
  });
}
