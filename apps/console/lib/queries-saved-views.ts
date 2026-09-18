// Vues enregistrées de l'Explorer (P6.5) — couche I/O. Les règles sont dans
// `saved-views.ts` (pur) ; ce module les applique contre PostgreSQL.
//
// FENÊTRE DE DÉPLOIEMENT. La console est publiée avant migration-v79 : `available`
// sonde la table et l'écran annonce la fonctionnalité indisponible, au lieu de
// faire échouer l'Explorer entier.
//
// LE PÉRIMÈTRE EST REVÉRIFIÉ APRÈS RÉSOLUTION. Un identifiant de vue est une
// DEMANDE : la ligne est lue, puis son app et son propriétaire sont confrontés au
// principal signé. Un identifiant deviné hors périmètre rend « introuvable », et
// ne révèle donc pas qu'il existe ailleurs.
import { q, tx } from "./db";
import { accountIdOf } from "./queries-accounts";
import {
  SAVED_VIEW_MAX_PER_APP,
  canCreateSavedView,
  canReadSavedView,
  canWriteSavedView,
  type SavedViewReader,
} from "./saved-views";

export interface SavedViewRow {
  id: string;
  app_id: string;
  name: string;
  query: Record<string, unknown>;
  revision: string;
  created_at: Date;
  updated_at: Date;
  /** `true` pour le lecteur qui en est propriétaire. */
  mine: boolean;
  /**
   * Adresse du compte propriétaire — seulement pour une session ADMIN, et null
   * pour une vue orpheline. Un viewer ne lit que ses propres vues : lui rendre
   * une adresse n'aurait aucun sens, et en rendre une autre serait une fuite.
   */
  owner_email: string | null;
}

export type SavedViewResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "unavailable" }
  | { kind: "forbidden"; error: string }
  | { kind: "not_found" }
  | { kind: "conflict"; error: string; revision: string }
  | { kind: "limit"; error: string };

export const VUE_INTROUVABLE = "vue enregistrée introuvable";

/** migration-v79 est-elle appliquée ? Sondé à chaque appel : la requête est triviale. */
export async function savedViewsAvailable(): Promise<boolean> {
  const [row] = await q<{ v79: boolean }>("select to_regclass('public.analytics_saved_view') is not null as v79");
  return row?.v79 === true;
}

/** Lecteur complet : la session, plus son compte interne résolu. */
export async function savedViewReader(user: {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null;
  demo?: boolean;
}): Promise<SavedViewReader> {
  return {
    role: user.role,
    apps: user.apps,
    accountId: await accountIdOf(user.email),
    demo: user.demo === true,
  };
}

interface RawRow {
  id: string;
  app_id: string;
  owner_id: string | null;
  owner_email: string | null;
  name: string;
  query_json: unknown;
  revision: string;
  created_at: Date;
  updated_at: Date;
}

function hydrate(row: RawRow, reader: SavedViewReader): SavedViewRow {
  const mine = reader.accountId !== null && row.owner_id === reader.accountId;
  return {
    id: row.id,
    app_id: row.app_id,
    name: row.name,
    query: (row.query_json ?? {}) as Record<string, unknown>,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mine,
    owner_email: reader.role === "admin" ? row.owner_email : null,
  };
}

const COLONNES = `v.id::text as id, v.app_id, v.owner_id::text as owner_id, u.email as owner_email,
                  v.name, v.query_json, v.revision::text as revision, v.created_at, v.updated_at`;

/** UUID canonique : un identifiant mal formé est « introuvable », jamais une erreur SQL. */
export function isSavedViewId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Vues lisibles par le lecteur, plus récentes d'abord. Un viewer ne voit que les
 * siennes ; un admin voit aussi celles des autres comptes DE SES APPS — jamais
 * celles d'une app hors de son périmètre.
 */
export async function listSavedViews(
  reader: SavedViewReader,
  filtre: { app?: string | null } = {},
): Promise<SavedViewResult<SavedViewRow[]>> {
  if (!(await savedViewsAvailable())) return { kind: "unavailable" };
  if (reader.apps?.length === 0) return { kind: "forbidden", error: "aucune application autorisée" };
  if (filtre.app && !(reader.apps === null || reader.apps.includes(filtre.app))) {
    return { kind: "forbidden", error: "application hors du périmètre autorisé" };
  }
  // Un viewer sans compte interne n'est propriétaire de rien : la clause de
  // propriété ne peut pas être « owner_id is null », qui rendrait les orphelines.
  const rows = await q<RawRow>(
    `select ${COLONNES}
       from analytics_saved_view v
       left join console_user u on u.id = v.owner_id
      where ($1::text[] is null or v.app_id = any($1::text[]))
        and ($2::text is null or v.app_id = $2::text)
        and ($3::boolean or v.owner_id::text = $4::text)
      order by v.updated_at desc, v.id
      limit $5`,
    [
      reader.apps,
      filtre.app ?? null,
      reader.role === "admin",
      reader.accountId,
      // Un admin transverse pourrait en lister beaucoup : la page reste bornée.
      SAVED_VIEW_MAX_PER_APP * 4,
    ],
  );
  return { kind: "ok", value: rows.map((row) => hydrate(row, reader)) };
}

/** Une vue, si le lecteur a le droit de la lire. */
export async function getSavedView(reader: SavedViewReader, id: string): Promise<SavedViewResult<SavedViewRow>> {
  if (!(await savedViewsAvailable())) return { kind: "unavailable" };
  if (!isSavedViewId(id)) return { kind: "not_found" };
  const [row] = await q<RawRow>(
    `select ${COLONNES} from analytics_saved_view v
       left join console_user u on u.id = v.owner_id
      where v.id = $1::uuid`,
    [id],
  );
  if (!row || !canReadSavedView(reader, row)) return { kind: "not_found" };
  return { kind: "ok", value: hydrate(row, reader) };
}

/**
 * Crée une vue. Le plafond de 50 par utilisateur et par app est vérifié DANS la
 * transaction, derrière un verrou consultatif : deux onglets qui enregistrent en
 * même temps ne peuvent pas passer à 51 chacun en ne voyant que 49.
 */
export async function createSavedView(
  reader: SavedViewReader,
  input: { app: string; name: string; query: Record<string, unknown> },
): Promise<SavedViewResult<SavedViewRow>> {
  if (!(await savedViewsAvailable())) return { kind: "unavailable" };
  if (!canCreateSavedView(reader, input.app)) {
    return {
      kind: "forbidden",
      error: reader.accountId === null
        ? "aucun compte console actif pour cette session"
        : "application hors du périmètre autorisé",
    };
  }
  return tx(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [input.app, reader.accountId]);
    const { rows: [compte] } = await client.query<{ n: string }>(
      "select count(*)::text as n from analytics_saved_view where app_id = $1 and owner_id = $2::bigint",
      [input.app, reader.accountId],
    );
    if (Number(compte.n) >= SAVED_VIEW_MAX_PER_APP) {
      return {
        kind: "limit",
        error: `plafond atteint : ${SAVED_VIEW_MAX_PER_APP} vues enregistrées par application ; en supprimer avant d’en ajouter`,
      };
    }
    const { rows: [row] } = await client.query<RawRow>(
      `insert into analytics_saved_view (app_id, owner_id, name, query_json)
       values ($1, $2::bigint, $3, $4::jsonb)
       returning id::text as id, app_id, owner_id::text as owner_id, null::text as owner_email,
                 name, query_json, revision::text as revision, created_at, updated_at`,
      [input.app, reader.accountId, input.name, JSON.stringify(input.query)],
    );
    return { kind: "ok", value: hydrate(row, reader) };
  });
}

/**
 * Renomme et/ou remplace l'AST d'une vue. La révision lue est citée : si la vue a
 * changé depuis, l'écriture est refusée avec la révision courante — elle n'écrase
 * jamais le travail d'un autre onglet.
 */
export async function updateSavedView(
  reader: SavedViewReader,
  id: string,
  patch: { name: string | null; query: Record<string, unknown> | null; app: string | null; expectedRevision: string },
): Promise<SavedViewResult<SavedViewRow>> {
  if (!(await savedViewsAvailable())) return { kind: "unavailable" };
  if (!isSavedViewId(id)) return { kind: "not_found" };
  return tx(async (client) => {
    const { rows: [verrouillee] } = await client.query<{
      app_id: string;
      owner_id: string | null;
      revision: string;
    }>(
      `select app_id, owner_id::text as owner_id, revision::text as revision
         from analytics_saved_view where id = $1::uuid for no key update`,
      [id],
    );
    if (!verrouillee || !canReadSavedView(reader, verrouillee)) return { kind: "not_found" };
    if (!canWriteSavedView(reader, verrouillee)) {
      return { kind: "forbidden", error: "une vue enregistrée n’est modifiable que par son propriétaire" };
    }
    if (verrouillee.revision !== patch.expectedRevision) {
      return {
        kind: "conflict",
        error: "la vue a été modifiée depuis sa lecture : recharger",
        revision: verrouillee.revision,
      };
    }
    // L'AST soumis ne peut pas déplacer la vue vers une autre app : ce serait un
    // partage déguisé, et le droit de l'app cible n'a pas été vérifié ici.
    if (patch.app !== null && patch.app !== verrouillee.app_id) {
      return { kind: "forbidden", error: "une vue enregistrée ne change pas d’application" };
    }
    const { rows: [row] } = await client.query<RawRow>(
      `update analytics_saved_view
          set name = coalesce($2, name),
              query_json = coalesce($3::jsonb, query_json),
              revision = revision + 1,
              updated_at = now()
        where id = $1::uuid
      returning id::text as id, app_id, owner_id::text as owner_id, null::text as owner_email,
                name, query_json, revision::text as revision, created_at, updated_at`,
      [id, patch.name, patch.query ? JSON.stringify(patch.query) : null],
    );
    return { kind: "ok", value: hydrate(row, reader) };
  });
}

/** Supprime une vue : son propriétaire seul, dans une app de son périmètre. */
export async function deleteSavedView(reader: SavedViewReader, id: string): Promise<SavedViewResult<{ app: string }>> {
  if (!(await savedViewsAvailable())) return { kind: "unavailable" };
  if (!isSavedViewId(id)) return { kind: "not_found" };
  return tx(async (client) => {
    const { rows: [verrouillee] } = await client.query<{ app_id: string; owner_id: string | null }>(
      `select app_id, owner_id::text as owner_id from analytics_saved_view where id = $1::uuid for no key update`,
      [id],
    );
    if (!verrouillee || !canReadSavedView(reader, verrouillee)) return { kind: "not_found" };
    if (!canWriteSavedView(reader, verrouillee)) {
      return { kind: "forbidden", error: "une vue enregistrée n’est supprimable que par son propriétaire" };
    }
    await client.query("delete from analytics_saved_view where id = $1::uuid", [id]);
    return { kind: "ok", value: { app: verrouillee.app_id } };
  });
}
