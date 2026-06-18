// Consommation par client (métering, migration-v15). Mois courant, joint au registre
// + quota. Fail-soft (vide si la base est indisponible).
import { q } from "./db";

export interface TenantUsageRow {
  app_id: string;
  name: string;
  events: number;
  sessions: number;
  errors: number;
  quota: number | null; // monthly_quota ; null = illimité
}

/** Usage du mois courant par app (events/sessions/erreurs) + quota, trié par volume. */
export async function monthlyUsage(): Promise<TenantUsageRow[]> {
  try {
    return await q<TenantUsageRow>(
      `select a.app_id,
              coalesce(a.name, a.app_id) as name,
              coalesce(u.events, 0)::int   as events,
              coalesce(u.sessions, 0)::int as sessions,
              coalesce(u.errors, 0)::int   as errors,
              a.monthly_quota::int         as quota
       from app_registry a
       left join (
         select app_id, sum(events) as events, sum(sessions) as sessions, sum(errors) as errors
         from tenant_usage_daily
         where day >= date_trunc('month', current_date)
         group by app_id
       ) u using (app_id)
       order by coalesce(u.events, 0) desc, name`,
    );
  } catch {
    return [];
  }
}
