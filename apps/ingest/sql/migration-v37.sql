-- migration-v37 — Anomalies de VOLUME DE LOGS (z-score), calquée sur v_anomaly
-- (migration-v03) mais appliquée au nombre de logs ERROR par heure plutôt qu'au
-- p75 LCP. Objectif : détecter automatiquement un pic anormal d'erreurs
-- applicatives (« 5× plus de logs ERROR que d'habitude à cette heure-ci »),
-- sans que l'utilisateur ait à fixer un seuil — réutilise exactement la même
-- mécanique statistique éprouvée que les anomalies de performance.
--
-- Différences volontaires avec v_anomaly :
--   • agrégat = count(*) des logs ERROR (severity_num >= 17), pas un p75.
--   • granularité app (pas app+route) : le volume de logs par route est souvent
--     trop épars pour un z-score stable ; l'app est la bonne maille pour « ça
--     part en vrille ».
--   • filtre z > 3 (POSITIF uniquement) : une baisse du volume d'erreurs est une
--     bonne nouvelle, pas une anomalie à remonter (contrairement au LCP où les
--     deux sens comptent, d'où abs() dans v_anomaly).
--
-- Vue simple (create or replace) : rejouable, aucune donnée déplacée. La console
-- lit via console_ro (grant ci-dessous, gardé).

create or replace view v_log_anomaly as
with hourly as (
  select app_id, date_trunc('hour', ts) as bucket, count(*) as n
  from rum_log
  where severity_num >= 17 and ts > now() - interval '8 days'
  group by 1, 2
),
stats as (
  select app_id, avg(n) as mean, stddev_samp(n) as sd
  from hourly
  where bucket < date_trunc('hour', now())   -- exclut l'heure courante (incomplète)
  group by 1
  having count(*) >= 5 and stddev_samp(n) > 0 -- assez d'historique + dispersion non nulle
)
select h.app_id,
       h.bucket,
       h.n::int                                as errors,
       round(s.mean::numeric, 1)               as mean_7d,
       round(((h.n - s.mean) / s.sd)::numeric, 1) as z_score
from hourly h
join stats s using (app_id)
where (h.n - s.mean) / s.sd > 3;              -- pic seulement (z positif)

-- Lecture console (rôle restreint du pool PG direct). Gardé : en CI/local le
-- rôle peut être absent -> bloc sauté (parité avec migration-v16/v34).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on v_log_anomaly to console_ro;
  end if;
end $$;
