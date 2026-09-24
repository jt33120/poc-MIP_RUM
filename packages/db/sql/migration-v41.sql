-- migration-v41 — Alerting sur NOUVEAUTÉ : nouvelle signature d'erreur jamais vue.
--
-- Le moteur d'alerte existant réagit sur des seuils/anomalies NUMÉRIQUES (perf,
-- coût IA, volume de logs). Il ne dit rien quand une erreur JS INÉDITE apparaît —
-- typiquement juste après un déploiement. C'est pourtant le signal le plus
-- actionnable : « une régression vient d'introduire une erreur nouvelle ».
--
-- check_new_errors() : repère les fingerprints dont la TOUTE PREMIÈRE occurrence
-- (min(ts) global) tombe dans la dernière heure — donc jamais observés avant —
-- et émet un alert_event 'warning' par nouveauté, routé via route_alert. Dédup
-- 24 h par identifiant stable (fingerprint + app). Même mécanique que
-- check_ai_op_anomalies (migration-v39). Aucune table, aucun changement console
-- (le feed d'alertes affiche déjà les events sans règle).

create or replace function check_new_errors() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare a record; fired int := 0; ev_id bigint; msg text; stable text;
begin
  for a in
    -- fingerprints dont la 1re occurrence GLOBALE est récente = signatures inédites
    select app_id, fingerprint,
           max(error_type) as error_type,
           max(message)    as sample,
           min(ts)         as first_seen,
           count(*)        as occurrences
    from rum_error
    where fingerprint is not null
    group by app_id, fingerprint
    having min(ts) > now() - interval '60 minutes'
  loop
    -- identifiant STABLE (indépendant des chiffres) -> dédup fiable ; embarqué
    -- dans le message pour que le like de dédup matche.
    stable := format('nouvelle erreur %s / app %s', a.fingerprint, a.app_id);
    msg := format('%s — %s « %s » (%s occurrence(s) depuis %s)',
      stable, coalesce(a.error_type, 'Error'),
      left(coalesce(a.sample, ''), 120), a.occurrences,
      to_char(a.first_seen, 'HH24:MI'));
    if not exists (
      select 1 from alert_event ae
      where ae.rule_id is null and ae.slo_id is null
        and ae.message like '%' || stable || '%'
        and ae.fired_at > now() - interval '24 hours'
    ) then
      insert into alert_event (rule_id, slo_id, value, message, severity)
      values (null, null, a.occurrences, msg, 'warning') returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, a.app_id, 'warning', '[MIP RUM] ' || msg,
        jsonb_build_object('source', 'mip-rum', 'kind', 'new_error', 'app_id', a.app_id,
          'fingerprint', a.fingerprint, 'error_type', a.error_type,
          'occurrences', a.occurrences, 'text', msg));
    end if;
  end loop;
  return fired;
end $function$;

-- SECURITY DEFINER : jamais exécutable par anon/authenticated (cron/console only).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke execute on function check_new_errors() from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke execute on function check_new_errors() from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke execute on function check_new_errors() from authenticated;
    end if;
    grant execute on function check_new_errors() to console_ro;
  end if;
end $$;

-- Cron (cloud uniquement) : toutes les 15 min. Gardé si pg_cron absent (CI/local).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mip-new-errors', '*/15 * * * *', 'select check_new_errors()');
  end if;
end $$;
