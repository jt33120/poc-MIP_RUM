-- migration-v18 : tableaux de bord configurables (P1). Un dashboard = un nom, une
-- app (optionnelle) et une LISTE DE WIDGETS sérialisée en jsonb (layout). Les widgets
-- réutilisent les requêtes existantes (vitals p75, trafic, routes lentes, erreurs,
-- frustration, SLO) — aucune nouvelle table de données. Export CSV / impression PDF
-- côté console. Idempotente, accès console_ro gardé (motif finding #1).

create table if not exists dashboard (
  id         bigserial primary key,
  name       text not null,
  app_id     text,                         -- null = non scopé (toutes apps)
  layout     jsonb not null default '[]'::jsonb,  -- [{type,title,metric?,route?}, …]
  created_by text,                          -- email du créateur (audit léger)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dashboard_app on dashboard (app_id);

-- RLS + accès console_ro (CRUD). Local/CI (rôle absent) : sauté (connexion propriétaire).
alter table dashboard enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update, delete on dashboard to console_ro;
    grant usage, select on sequence dashboard_id_seq to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'dashboard' and policyname = 'cro_all_dashboard') then
      create policy cro_all_dashboard on dashboard for all to console_ro using (true) with check (true);
    end if;
  end if;
end $$;

-- Effacement RGPD : un dashboard scopé à une app est supprimé avec le tenant.
-- (Redéfinit erase_app_data de migration-v14 en ajoutant la ligne dashboard ;
--  CREATE OR REPLACE → la dernière définition gagne. dashboard sans app_id préservé.)
create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from rum_metric     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from replay_chunk   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from dashboard      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('dashboard', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;
