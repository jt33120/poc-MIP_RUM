// Tableaux de bord configurables (P1) — CRUD. Le layout (liste de widgets) est
// stocké en jsonb ; on le NORMALISE en lecture/écriture (helpers purs ./dashboards).
import { normalizeLayout, type Widget } from "./dashboards";
import { q } from "./db";

export interface DashboardRow {
  id: number;
  name: string;
  app_id: string | null;
  layout: Widget[];
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RawRow extends Omit<DashboardRow, "layout"> {
  layout: unknown;
}
const hydrate = (r: RawRow): DashboardRow => ({ ...r, layout: normalizeLayout(r.layout) });

/** Liste (métadonnées) — scopée à l'app filtrée + dashboards non scopés (app_id null). */
export async function listDashboards(app: string | null): Promise<DashboardRow[]> {
  const rows = await q<RawRow>(
    `select id::int as id, name, app_id, layout, created_by, created_at, updated_at
     from dashboard
     where $1::text is null or app_id is null or app_id = $1
     order by updated_at desc`,
    [app && app !== "all" ? app : null],
  );
  return rows.map(hydrate);
}

export async function getDashboard(id: number): Promise<DashboardRow | null> {
  const [r] = await q<RawRow>(
    `select id::int as id, name, app_id, layout, created_by, created_at, updated_at
     from dashboard where id = $1`,
    [id],
  );
  return r ? hydrate(r) : null;
}

export async function insertDashboard(d: {
  name: string;
  app_id: string | null;
  created_by: string | null;
}): Promise<number> {
  const [r] = await q<{ id: number }>(
    `insert into dashboard (name, app_id, created_by) values ($1, $2, $3) returning id::int as id`,
    [d.name, d.app_id, d.created_by],
  );
  return r.id;
}

/** Renomme / re-scope un dashboard (les widgets sont gérés via updateLayout). */
export async function updateDashboardMeta(id: number, name: string, app_id: string | null): Promise<void> {
  await q(`update dashboard set name = $2, app_id = $3, updated_at = now() where id = $1`, [id, name, app_id]);
}

/** Remplace la liste de widgets (normalisée avant écriture). */
export async function updateLayout(id: number, layout: Widget[]): Promise<void> {
  await q(`update dashboard set layout = $2::jsonb, updated_at = now() where id = $1`, [
    id,
    JSON.stringify(normalizeLayout(layout)),
  ]);
}

export async function deleteDashboard(id: number): Promise<void> {
  await q(`delete from dashboard where id = $1`, [id]);
}
