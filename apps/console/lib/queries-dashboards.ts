// Tableaux de bord configurables — CRUD. Le layout (liste de widgets) est stocké
// en jsonb ; il est NORMALISÉ en lecture (adaptateur v1/v2) et SÉRIALISÉ en
// écriture, chaque widget dans sa version d'origine (./dashboards).
//
// CONCURRENCE OPTIMISTE (P6.5). Deux onglets ouverts sur le même tableau
// écrasaient silencieusement le travail l'un de l'autre : la dernière écriture
// gagnait, et la carte ajoutée entre-temps disparaissait. Chaque écriture cite
// désormais la révision qu'elle a lue ; si la ligne a bougé, elle est refusée
// (409) avec la révision courante, et l'écran propose de recharger.
//
// FENÊTRE DE DÉPLOIEMENT. `owner_id` et `revision` n'existent qu'après
// migration-v79 : leur présence est SONDÉE, et le code publié avant la migration
// lit un propriétaire hérité (`created_by`) et une révision figée à 1. Aucune
// écriture n'échoue pour une colonne absente.
import { normalizeLayout, serializeLayout, type Widget } from "./dashboards";
import { q, tx } from "./db";
import { queryOf, type FiltersLike } from "./filters";
import { binder, compileScope } from "./query-compiler";

export interface DashboardRow {
  id: number;
  name: string;
  app_id: string | null;
  layout: Widget[];
  created_by: string | null;
  /** Compte interne propriétaire ; null = propriétaire hérité (v18, ou compte supprimé). */
  owner_id: string | null;
  owner_email: string | null;
  /** Révision de configuration, citée par chaque écriture. Vaut « 1 » avant v79. */
  revision: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export type DashboardWrite =
  | { kind: "ok"; revision: string }
  | { kind: "not_found" }
  | { kind: "conflict"; error: string; revision: string };

interface RawRow extends Omit<DashboardRow, "layout" | "owner_id" | "owner_email" | "revision"> {
  layout: unknown;
  owner_id: string | null;
  owner_email: string | null;
  revision: string | null;
}

const hydrate = (r: RawRow): DashboardRow => ({
  ...r,
  layout: normalizeLayout(r.layout),
  owner_id: r.owner_id ?? null,
  owner_email: r.owner_email ?? null,
  revision: r.revision ?? "1",
});

// ────────────────────── Sonde de schéma (fenêtre v79) ────────────────────────

const SONDE_TTL_MS = 5_000;
let sonde: { at: number; value: Promise<boolean> } | null = null;

/** migration-v79 est-elle appliquée ? Mémoire courte : une migration se voit sans redémarrage. */
export function dashboardOwnershipAvailable(): Promise<boolean> {
  const now = Date.now();
  if (sonde && now - sonde.at < SONDE_TTL_MS) return sonde.value;
  const value = q<{ ok: boolean }>(
    `select count(*) = 2 as ok from information_schema.columns
      where table_schema = 'public' and table_name = 'dashboard' and column_name in ('owner_id', 'revision')`,
  ).then((rows) => rows[0]?.ok === true);
  sonde = { at: now, value };
  value.catch(() => {
    if (sonde?.value === value) sonde = null;
  });
  return value;
}

/** Oublie la sonde — pour les tests SQL qui migrent une base en cours de suite. */
export function forgetDashboardSchema(): void {
  sonde = null;
}

/** Colonnes de propriété, ou leurs valeurs héritées quand la migration n'est pas passée. */
async function colonnes(): Promise<string> {
  return (await dashboardOwnershipAvailable())
    ? `d.owner_id::text as owner_id, u.email as owner_email, d.revision::text as revision`
    : `null::text as owner_id, null::text as owner_email, '1'::text as revision`;
}

async function jointure(): Promise<string> {
  return (await dashboardOwnershipAvailable()) ? "left join console_user u on u.id = d.owner_id" : "";
}

// ──────────────────────────────── Lectures ───────────────────────────────────

/** Liste (métadonnées) — dashboards des apps du périmètre + dashboards non scopés (app_id null). */
export async function listDashboards(f: FiltersLike): Promise<DashboardRow[]> {
  const { params, bind } = binder();
  const rows = await q<RawRow>(
    `select d.id::int as id, d.name, d.app_id, d.layout, d.created_by, ${await colonnes()},
            d.created_at, d.updated_at
     from dashboard d ${await jointure()}
     where d.app_id is null or (true${compileScope(queryOf(f), "d.app_id", bind)})
     order by d.updated_at desc`,
    params,
  );
  return rows.map(hydrate);
}

export async function getDashboard(id: number): Promise<DashboardRow | null> {
  const [r] = await q<RawRow>(
    `select d.id::int as id, d.name, d.app_id, d.layout, d.created_by, ${await colonnes()},
            d.created_at, d.updated_at
     from dashboard d ${await jointure()} where d.id = $1`,
    [id],
  );
  return r ? hydrate(r) : null;
}

// ──────────────────────────────── Écritures ──────────────────────────────────

export async function insertDashboard(d: {
  name: string;
  app_id: string | null;
  created_by: string | null;
  owner_id: string | null;
  layout?: Widget[];
}): Promise<number> {
  const layout = JSON.stringify(serializeLayout(d.layout ?? []));
  if (await dashboardOwnershipAvailable()) {
    const [r] = await q<{ id: number }>(
      `insert into dashboard (name, app_id, created_by, owner_id, layout)
       values ($1, $2, $3, $4::bigint, $5::jsonb) returning id::int as id`,
      [d.name, d.app_id, d.created_by, d.owner_id, layout],
    );
    return r.id;
  }
  const [r] = await q<{ id: number }>(
    `insert into dashboard (name, app_id, created_by, layout)
     values ($1, $2, $3, $4::jsonb) returning id::int as id`,
    [d.name, d.app_id, d.created_by, layout],
  );
  return r.id;
}

/**
 * Écriture citant la révision lue. Sans les colonnes de v79, la révision n'existe
 * pas encore : l'écriture passe comme avant, et le conflit reste invisible — c'est
 * le comportement d'avant P6.5, pas une régression introduite par la sonde.
 */
async function ecrire(
  id: number,
  expectedRevision: string,
  mutation: (client: import("pg").PoolClient) => Promise<void>,
): Promise<DashboardWrite> {
  if (!(await dashboardOwnershipAvailable())) {
    return tx(async (client) => {
      const { rowCount } = await client.query("select 1 from dashboard where id = $1 for no key update", [id]);
      if (!rowCount) return { kind: "not_found" };
      await mutation(client);
      return { kind: "ok", revision: "1" };
    });
  }
  return tx(async (client) => {
    const { rows: [ligne] } = await client.query<{ revision: string }>(
      "select revision::text as revision from dashboard where id = $1 for no key update",
      [id],
    );
    if (!ligne) return { kind: "not_found" };
    if (ligne.revision !== expectedRevision) {
      return {
        kind: "conflict",
        error: "ce tableau de bord a été modifié depuis son affichage : recharger avant d’écrire",
        revision: ligne.revision,
      };
    }
    await mutation(client);
    const { rows: [apres] } = await client.query<{ revision: string }>(
      "update dashboard set revision = revision + 1, updated_at = now() where id = $1 returning revision::text as revision",
      [id],
    );
    return { kind: "ok", revision: apres.revision };
  });
}

/** Renomme / re-scope un dashboard (les widgets sont gérés via updateLayout). */
export async function updateDashboardMeta(
  id: number,
  name: string,
  app_id: string | null,
  expectedRevision: string,
): Promise<DashboardWrite> {
  return ecrire(id, expectedRevision, async (client) => {
    await client.query("update dashboard set name = $2, app_id = $3, updated_at = now() where id = $1", [
      id,
      name,
      app_id,
    ]);
  });
}

/** Remplace la liste de widgets (sérialisée avant écriture, chaque widget dans sa version). */
export async function updateLayout(id: number, layout: Widget[], expectedRevision: string): Promise<DashboardWrite> {
  const json = JSON.stringify(serializeLayout(layout));
  return ecrire(id, expectedRevision, async (client) => {
    await client.query("update dashboard set layout = $2::jsonb, updated_at = now() where id = $1", [id, json]);
  });
}

export async function deleteDashboard(id: number): Promise<void> {
  await q("delete from dashboard where id = $1", [id]);
}
