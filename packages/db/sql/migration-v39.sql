-- migration-v39 — Anomalie de COÛT IA par FONCTION (operation × route), z-score.
-- Version « non-doublon » du budget : UTI a déjà des seuils absolus hebdo/mensuel
-- sur la facturation OpenRouter. Ce que ça n'a PAS : la détection AUTOMATIQUE
-- qu'une fonction dévie fortement de SA propre baseline (« extraction coûte 5×
-- plus que d'habitude ce matin »), sans seuil à fixer. Même mécanique z-score que
-- v_anomaly (perf) / v_log_anomaly.
--
-- 1) Vue v_ai_op_anomaly : par (app, operation, route), z-score du coût des
--    dernières 24 h vs la moyenne journalière des 8 jours précédents (jours
--    COMPLETS). Remonte les PICS (z > 3). operation/route NULL gérés (coalesce
--    pour le regroupement/jointure, re-null en sortie).
-- 2) Fonction check_ai_op_anomalies() : insère un alert_event 'warning' par
--    fonction en anomalie (dédup 6 h par identifiant stable de fonction) et
--    route via route_alert (livré si un canal existe). Câblée en cron.

create or replace view v_ai_op_anomaly as
with daily as (
  -- coût journalier par fonction sur 8 j, JOURS COMPLETS (exclut aujourd'hui partiel)
  select app_id, coalesce(operation,'') as operation, coalesce(route,'') as route,
         date_trunc('day', ts)::date as d, sum(cost_usd) as cost
  from rum_ai
  where ts >= current_date - interval '8 days' and ts < current_date
  group by 1, 2, 3, 4
),
stats as (
  select app_id, operation, route, avg(cost) as mean, stddev_samp(cost) as sd
  from daily
  group by 1, 2, 3
  having count(*) >= 3 and stddev_samp(cost) > 0   -- assez d'historique + dispersion
),
recent as (
  -- fenêtre glissante 24 h (≈ un jour), comparable aux moyennes journalières
  select app_id, coalesce(operation,'') as operation, coalesce(route,'') as route,
         coalesce(sum(cost_usd), 0) as cost
  from rum_ai
  where ts >= now() - interval '24 hours'
  group by 1, 2, 3
)
select r.app_id,
       nullif(r.operation, '') as operation,
       nullif(r.route, '')     as route,
       round(r.cost::numeric, 4)                    as cost_24h,
       round(s.mean::numeric, 4)                    as mean_daily,
       round(((r.cost - s.mean) / s.sd)::numeric, 1) as z_score
from recent r
join stats s using (app_id, operation, route)
where (r.cost - s.mean) / s.sd > 3;   -- pic de coût (z positif ; une baisse n'est pas une alerte)

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on v_ai_op_anomaly to console_ro;
  end if;
end $$;

-- Alerte automatique : un événement 'warning' par fonction en anomalie.
create or replace function check_ai_op_anomalies() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare a record; fired int := 0; ev_id bigint; msg text; stable text;
begin
  for a in select * from v_ai_op_anomaly loop
    -- identifiant STABLE de la fonction (indépendant des chiffres) -> dédup fiable
    stable := format('fonction %s / route %s / app %s',
      coalesce(a.operation, '(n/a)'), coalesce(a.route, '(n/a)'), a.app_id);
    msg := format('Coût IA anormal — %s : %s $ sur 24 h (normal ≈ %s $/j, z %s)',
      stable, a.cost_24h, a.mean_daily, a.z_score);
    -- dédup 6 h : même fonction pas déjà remontée récemment
    if not exists (
      select 1 from alert_event ae
      where ae.rule_id is null and ae.slo_id is null
        and ae.message like '%' || stable || '%'
        and ae.fired_at > now() - interval '6 hours'
    ) then
      insert into alert_event (rule_id, slo_id, value, message, severity)
      values (null, null, a.z_score, msg, 'warning') returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, a.app_id, 'warning', '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','kind','ai_op_anomaly','app_id',a.app_id,
          'operation',a.operation,'route',a.route,'cost_24h',a.cost_24h,
          'mean_daily',a.mean_daily,'z_score',a.z_score,'text',msg));
    end if;
  end loop;
  return fired;
end $function$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke execute on function check_ai_op_anomalies() from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke execute on function check_ai_op_anomalies() from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke execute on function check_ai_op_anomalies() from authenticated;
    end if;
    grant execute on function check_ai_op_anomalies() to console_ro;
  end if;
end $$;

-- Cron (cloud uniquement) : toutes les 30 min. Gardé si pg_cron absent (CI/local).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mip-ai-op-anomaly', '*/30 * * * *', 'select check_ai_op_anomalies()');
  end if;
end $$;
