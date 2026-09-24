-- migration-v09.sql — rétention / TTL des données de télémétrie (revue R8). v0.7.
--
-- Problème : aucune purge -> la base croît indéfiniment (le free tier Supabase
-- a un plafond). On fournit une fonction de purge unique, ordonnée (enfants
-- avant parents pour respecter les FK), qui renvoie le détail des suppressions
-- (observabilité). Planification : pg_cron en cloud si disponible, sinon le CLI
-- Node apps/ingest/purge.mjs (même patron que dispatch-alerts.mjs).
--
-- N'EFFACE PAS audit_log ni console_user (données de conformité/comptes) : la
-- rétention ne vise que la télémétrie volumineuse.

create or replace function purge_rum(retention_days int default 30)
returns jsonb language plpgsql as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(retention_days, 1));
  result jsonb := jsonb_build_object('retention_days', retention_days, 'cutoff', cutoff);
  n bigint;
begin
  -- 1) tables d'événements (clé temporelle propre), enfants des sessions/pageviews
  delete from rum_metric    where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error     where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource  where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask  where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event     where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span      where ts < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from replay_chunk  where created_at < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);

  -- 2) pageviews anciennes SANS enfant restant (une métrique récente peut encore
  --    référencer une vieille pageview -> on ne la supprime pas, FK protégée)
  delete from rum_pageview p
   where p.started_at < cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error  e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  -- 3) sessions anciennes SANS aucun enfant restant (idem, FK protégée)
  delete from rum_session s
   where s.last_seen_at < cutoff
     and not exists (select 1 from rum_pageview   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric     x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error      x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event      x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk   x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);

  -- 4) tables annexes indépendantes
  delete from syn_snapshot where captured_at < cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from rate_counter where minute < cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rate_counter', n);
  delete from alert_event where fired_at < cutoff;     get diagnostics n = row_count; result := result || jsonb_build_object('alert_event', n); -- alert_delivery suit (on delete cascade)

  return result;
end $$;

-- Planification cloud : pg_cron si l'extension est présente (sautée en CI/local
-- sans l'extension, comme les blocs pg_net/RLS de migration-v03/v05).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mip-purge-daily') then
      perform cron.unschedule('mip-purge-daily');
    end if;
    perform cron.schedule('mip-purge-daily', '17 3 * * *', 'select purge_rum(30)');
  end if;
end $$;
