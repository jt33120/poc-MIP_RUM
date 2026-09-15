// Requêtes /admin/customers (v0.5) — liste des apps clientes + sonde
// d'onboarding (la checklist live du wizard s'appuie dessus).
import { q } from "./db";
import type { OnboardingProbe } from "./onboarding";

export interface CustomerRow {
  app_id: string;
  name: string;
  client_id: string | null;
  active: boolean;
  has_key: boolean;
  allowed_origins: string[];
  created_by: string | null;
  notes: string | null;
  created_at: Date;
  sessions_7d: number;
  last_event_at: Date | null;
}

export async function listCustomers(): Promise<CustomerRow[]> {
  return q<CustomerRow>(`
    select a.app_id, a.name, a.client_id, a.active,
           (a.api_key_hash is not null) as has_key,
           coalesce(a.allowed_origins, '{}') as allowed_origins,
           a.created_by, a.notes, a.created_at,
           coalesce(s.sessions_7d, 0)::int as sessions_7d,
           m.last_event_at
    from app_registry a
    left join lateral (
      select count(distinct session_id) as sessions_7d
      from rum_session where app_id = a.app_id and started_at > now() - interval '7 days'
    ) s on true
    left join lateral (
      select max(ts) as last_event_at from rum_metric where app_id = a.app_id
    ) m on true
    order by a.created_at desc
  `);
}

export async function getCustomer(appId: string): Promise<CustomerRow | null> {
  const rows = await q<CustomerRow>(
    `select app_id, name, client_id, active,
            (api_key_hash is not null) as has_key,
            coalesce(allowed_origins, '{}') as allowed_origins,
            created_by, notes, created_at,
            0::int as sessions_7d, null::timestamptz as last_event_at
     from app_registry where app_id = $1`,
    [appId],
  );
  return rows[0] ?? null;
}

/** Sonde unique pour la checklist : 4 marqueurs + compteurs 24 h. */
export async function probeOnboarding(appId: string): Promise<OnboardingProbe> {
  const [row] = await q<OnboardingProbe>(
    `select
       (select min(ts) from rum_metric where app_id = $1)                       as first_metric_at,
       (select max(ts) from rum_metric where app_id = $1)                       as last_metric_at,
       (select count(distinct session_id) from rum_session
         where app_id = $1 and started_at > now() - interval '24 hours')::int   as sessions_24h,
       (select min(ts) from rum_span where app_id = $1 and tier = 'front')      as first_front_span_at,
       (select min(ts) from rum_span where app_id = $1 and tier = 'back')       as first_back_span_at,
       (select coalesce(sum(occurrences), 0) from rum_error
         where app_id = $1 and ts > now() - interval '24 hours')::int           as errors_24h
    `,
    [appId],
  );
  return row;
}
