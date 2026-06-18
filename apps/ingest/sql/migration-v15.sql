-- migration-v15 : isolation multi-tenant — métering d'usage + quotas (P0 #5).
-- Manque identifié : mesurer la CONSOMMATION par client (base de facturation) et
-- poser des QUOTAS. On agrège l'usage quotidien dans une table DURABLE (survit à
-- la purge de télémétrie -> on garde l'historique de facturation même après 30 j).
-- Idempotente.

alter table app_registry add column if not exists monthly_quota bigint;  -- events/mois ; NULL = illimité
comment on column app_registry.monthly_quota is
  'Quota mensuel d''events ingérés (facturation/plan). NULL = illimité. Cf. tenant_quota_status().';

-- Consommation quotidienne par client (agrégat durable, sans FK -> non purgé).
create table if not exists tenant_usage_daily (
  app_id     text not null,
  day        date not null,
  events     bigint not null default 0,  -- total de lignes de télémétrie ingérées ce jour
  sessions   bigint not null default 0,
  errors     bigint not null default 0,
  metered_at timestamptz not null default now(),
  primary key (app_id, day)
);

-- Calcule la consommation d'un jour (par défaut hier = jour clos) et l'upserte.
-- Idempotent (recalcul possible). À planifier AVANT la purge (sinon sous-compte).
create or replace function meter_tenant_usage(p_day date default (current_date - 1))
returns jsonb language plpgsql as $$
declare lo timestamptz := p_day::timestamptz; hi timestamptz := (p_day + 1)::timestamptz; n int;
begin
  with ev as (
    select app_id, count(*) as c from (
      select app_id from rum_metric     where ts >= lo and ts < hi
      union all select app_id from rum_error      where ts >= lo and ts < hi
      union all select app_id from rum_resource   where ts >= lo and ts < hi
      union all select app_id from rum_longtask   where ts >= lo and ts < hi
      union all select app_id from rum_breadcrumb where ts >= lo and ts < hi
      union all select app_id from rum_event      where ts >= lo and ts < hi
      union all select app_id from rum_span       where ts >= lo and ts < hi
      union all select app_id from rum_pageview   where started_at >= lo and started_at < hi
    ) x group by app_id
  ),
  se as (select app_id, count(distinct session_id) as c from rum_pageview where started_at >= lo and started_at < hi group by app_id),
  er as (select app_id, count(*) as c from rum_error where ts >= lo and ts < hi group by app_id),
  up as (
    insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at)
    select ev.app_id, p_day, ev.c, coalesce(se.c, 0), coalesce(er.c, 0), now()
    from ev left join se using (app_id) left join er using (app_id)
    on conflict (app_id, day) do update
      set events = excluded.events, sessions = excluded.sessions,
          errors = excluded.errors, metered_at = now()
    returning 1
  )
  select count(*) into n from up;
  return jsonb_build_object('day', p_day, 'apps_metered', n);
end $$;

-- Usage mensuel agrégé (facturation / dashboards).
create or replace view v_tenant_usage_month as
select app_id, date_trunc('month', day)::date as month,
       sum(events) as events, sum(sessions) as sessions, sum(errors) as errors
from tenant_usage_daily group by 1, 2;

-- Statut quota d'un client (mois courant) — consultable par l'ingestion (shed
-- opt-in) et la console. Fail-open : pas de quota => jamais 'over'.
create or replace function tenant_quota_status(p_app_id text)
returns jsonb language sql stable as $$
  with u as (
    select coalesce(sum(events), 0) as used
    from tenant_usage_daily
    where app_id = p_app_id and day >= date_trunc('month', current_date)
  ),
  q as (select monthly_quota as quota from app_registry where app_id = p_app_id)
  select jsonb_build_object(
    'app_id', p_app_id,
    'month', to_char(date_trunc('month', current_date), 'YYYY-MM'),
    'used', (select used from u),
    'quota', (select quota from q),
    'over', (select used from u) > coalesce((select quota from q), 9223372036854775807)
  );
$$;

-- Planification : métering quotidien à 3 h 05 (AVANT la purge de 3 h 17).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mip-meter-daily') then
      perform cron.unschedule('mip-meter-daily');
    end if;
    perform cron.schedule('mip-meter-daily', '5 3 * * *', 'select meter_tenant_usage()');
  end if;
end $$;
