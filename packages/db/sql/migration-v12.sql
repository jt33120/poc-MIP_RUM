-- migration-v12 : runway Postgres/Supabase (P0 « scale », plan full-Supabase).
-- Objectif : repousser le mur de Postgres SANS ClickHouse — pour qu'un grand
-- compte tienne sur Supabase tant que MIP n'a pas financé d'infra dédiée.
--   1. BRIN sur les colonnes temporelles (append-only) : index minuscule, scans
--      de plage 7 j/14 j bornés.
--   2. Rollup horaire pré-agrégé (sommes EXACTEMENT mergeables) : la heatmap et le
--      trafic 14 j lisent ~1 ligne/heure au lieu de scanner des millions de lignes.
-- Idempotente et gardée (pg_cron sauté si l'extension est absente : CI/local).
-- ⚠️ Les p75 (non mergeables) restent sur les lignes brutes + BRIN ; une pré-agrégation
--    p75 exacte demanderait l'extension tdigest (suivi séparé).

-- 1) BRIN sur le temps -------------------------------------------------------
create index if not exists brin_metric_ts        on rum_metric   using brin (ts)         with (pages_per_range = 32);
create index if not exists brin_pageview_started on rum_pageview using brin (started_at) with (pages_per_range = 32);
create index if not exists brin_error_ts         on rum_error    using brin (ts)         with (pages_per_range = 32);

-- 2) Rollup horaire ----------------------------------------------------------
-- device_type DÉNORMALISÉ (jointure faite au refresh) → lecture sans JOIN.
-- '' = device inconnu (session absente/NULL) ; permet la clé unique (pas de NULL).
create table if not exists rum_rollup_hourly (
  app_id      text not null,
  device_type text not null default '',
  hour        timestamptz not null,
  good_w      double precision not null default 0,   -- mesures 'good' pondérées (LCP ×2)
  total_w     double precision not null default 0,   -- total pondéré (idem health score)
  pageviews   bigint not null default 0,
  errors      bigint not null default 0,
  primary key (app_id, device_type, hour)
);
create index if not exists idx_rollup_hour on rum_rollup_hourly (hour);

-- Accès console : RLS + lecture pour le rôle console_ro (motif v0.3/v05). Sans ce
-- bloc, la console (qui se connecte en console_ro, cf. DEPLOY.md) lirait 0 ligne
-- une fois RUM_USE_ROLLUPS activé (RLS active, aucune policy). Le refresh tourne en
-- pg_cron (propriétaire) → pas de grant d'écriture pour console_ro. Local/CI : rôle
-- absent ⇒ grant/policy sautés (connexion propriétaire, bypass RLS).
alter table rum_rollup_hourly enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on rum_rollup_hourly to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'rum_rollup_hourly' and policyname = 'cro_sel_rollup') then
      create policy cro_sel_rollup on rum_rollup_hourly for select to console_ro using (true);
    end if;
  end if;
end $$;

-- 3) Refresh idempotent : recalcule EXACTEMENT les p_hours dernières heures depuis
--    les lignes brutes (upsert). Rejouable sans effet de bord. Retourne le nb de
--    cellules écrites.
create or replace function refresh_rum_rollups(p_hours int default 26)
returns int language plpgsql as $$
declare n int;
begin
  with lo as (
    select date_trunc('hour', now()) - make_interval(hours => greatest(p_hours, 1)) as t
  ),
  agg as (
    select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
           sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
           sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
           0::bigint as pageviews, 0::bigint as errors
    from rum_metric m left join rum_session s using (session_id), lo
    where m.ts >= lo.t group by 1, 2, 3
    union all
    select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
           0::float, 0::float, count(*)::bigint, 0::bigint
    from rum_pageview p left join rum_session s using (session_id), lo
    where p.started_at >= lo.t group by 1, 2, 3
    union all
    select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
           0::float, 0::float, 0::bigint, count(*)::bigint
    from rum_error e left join rum_session s using (session_id), lo
    where e.ts >= lo.t group by 1, 2, 3
  ),
  merged as (
    select app_id, device_type, hour,
           sum(good_w) as good_w, sum(total_w) as total_w,
           sum(pageviews) as pageviews, sum(errors) as errors
    from agg group by 1, 2, 3
  ),
  up as (
    insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
    select app_id, device_type, hour, good_w, total_w, pageviews, errors from merged
    on conflict (app_id, device_type, hour) do update
      set good_w = excluded.good_w, total_w = excluded.total_w,
          pageviews = excluded.pageviews, errors = excluded.errors
    returning 1
  )
  select count(*) into n from up;
  return n;
end $$;

-- Backfill initial (30 j de rétention) — recalcule tout l'historique présent.
select refresh_rum_rollups(24 * 30);

-- 4) Planification horaire via pg_cron si présent (cloud) ; sinon refresh à la
--    demande (CI/local sans l'extension : bloc sauté, comme v09/v10).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('refresh_rum_rollups', '5 * * * *', $cron$ select refresh_rum_rollups(26); $cron$);
  end if;
end $$;
