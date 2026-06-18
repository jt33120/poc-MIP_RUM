-- migration-v14 : conformité (P0 #4) — rétention PAR TENANT + droit à l'effacement.
-- Exigences récurrentes des grilles d'AO grand compte / RGPD :
--   1. rétention configurable PAR CLIENT (app) — pas une valeur globale unique ;
--   2. droit à l'effacement (RGPD art. 17) : purger toutes les données d'un client
--      (offboarding) ou d'une session (personne concernée), à la demande.
-- N'efface jamais audit_log / console_user (traçabilité/comptes). Idempotente.

-- Rétention par app (null = défaut global) ------------------------------------
alter table app_registry add column if not exists retention_days int;
comment on column app_registry.retention_days is
  'Rétention de la télémétrie pour ce client (jours). NULL = défaut global de purge_rum_tenants.';

-- Purge scopée à une app, antérieure à un cutoff (FK-safe : enfants, puis
-- pageviews/sessions sans enfant restant). Réutilisée par purge_rum_tenants.
create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_metric     where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from replay_chunk   where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error  e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric     x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error      x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event      x where x.session_id = s.session_id)
     and not exists (select 1 from rum_span       x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk   x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- Purge multi-tenant : chaque app purgée selon SA rétention (registre, sinon
-- défaut). Couvre aussi les apps vues en données mais absentes du registre.
create or replace function purge_rum_tenants(default_days int default 30)
returns jsonb language plpgsql as $$
declare r record; result jsonb := jsonb_build_object('default_days', default_days); cutoff timestamptz;
begin
  for r in
    select app_id, coalesce(max(retention_days), default_days) as days
    from (
      select app_id, retention_days from app_registry
      union all
      select app_id, null from rum_session
    ) u group by app_id
  loop
    cutoff := now() - make_interval(days => greatest(r.days, 1));
    result := result || jsonb_build_object(
      r.app_id, jsonb_build_object('days', r.days) || purge_rum_app(r.app_id, cutoff));
  end loop;
  -- annexes non rattachées à une app (opérationnel) au défaut global
  delete from rate_counter where minute   < now() - make_interval(days => greatest(default_days, 1));
  delete from alert_event  where fired_at < now() - make_interval(days => greatest(default_days, 1));
  return result;
end $$;

-- Effacement RGPD : toutes les données d'un client (offboarding / art. 17). Garde
-- app_registry (offboarding du compte = geste séparé), audit_log, console_user.
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
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

-- Effacement d'une personne concernée : toutes les données d'UNE session.
create or replace function erase_session(p_session_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('session_id', p_session_id); n bigint;
begin
  delete from rum_metric     where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from replay_chunk   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- Planification cloud : remplace la purge globale par la purge multi-tenant.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mip-purge-daily') then
      perform cron.unschedule('mip-purge-daily');
    end if;
    perform cron.schedule('mip-purge-daily', '17 3 * * *', 'select purge_rum_tenants(30)');
  end if;
end $$;
