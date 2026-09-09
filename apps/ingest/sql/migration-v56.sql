-- migration-v56 — deux agrégats qui mentaient, et le mensonge était structurel.
--
-- Les deux défauts corrigés ici viennent de l'audit externe
-- (docs/AUDIT_RUM_EXTERNE.md, findings 1.2 et 1.9). Ils partagent une forme :
-- une requête qui, faute de savoir dire « je ne sais pas », a répondu un nombre.
--
-- POURQUOI UNE MIGRATION ALORS QUE LE PLAN DISAIT « SANS MIGRATION ». Parce que
-- les deux fonctions concernées vivent dans migration-v12 et migration-v17,
-- déjà APPLIQUÉES. Le registre `schema_migration` tient une empreinte de chaque
-- fichier : rééditer un fichier appliqué le ferait diverger de son empreinte, et
-- une base déjà migrée ne rejouerait jamais la correction. On redéfinit donc les
-- fonctions ici, avec `create or replace` — ce qui est aussi la seule façon
-- qu'une base de production les reçoive.

-- ═════════════ 1.2 — le score de santé était plafonné par construction ═════════
--
-- `rum_metric` ne porte pas que des Core Web Vitals. Les phases réseau d'une
-- navigation — REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE — voyagent sur le MÊME
-- canal, parce que `rum_metric.name` est du texte libre et que ça évitait une
-- table. Elles n'ont pas de seuil Google, donc `rating2026` leur rend NULL, ce
-- qui est correct : il n'existe pas de « bonne » durée de résolution DNS.
--
-- Mais les trois agrégations qui calculent « part des mesures notées good » ne
-- filtraient pas sur le nom. Ces lignes entraient donc AU DÉNOMINATEUR sans
-- pouvoir jamais atteindre le numérateur :
--
--     good_w / total_w  avec 5 vitals notables et 6 phases jamais notables
--
-- Conséquence mesurable : le seuil « Excellent ≥ 90 » était inatteignable, et le
-- score suivait le nombre de phases que le navigateur du visiteur sait remonter
-- plutôt que la performance du site. Un parc Chromium — qui expose toutes les
-- phases — obtenait un score plus bas qu'un parc Safari à performance égale.
--
-- Les deux autres agrégations (score de santé, heatmap) sont côté console et
-- corrigées dans le même commit (lib/health.ts, lib/queries-grid.ts), avec la
-- liste tirée de `CORE_VITALS` dans lib/rating.ts. Ici on donne au SQL la même
-- liste, et un test compare les deux.

create or replace function mip_core_vitals() returns text[]
language sql immutable parallel safe as $$
  select array['LCP', 'INP', 'CLS', 'FCP', 'TTFB']::text[];
$$;

comment on function mip_core_vitals() is
  'Les cinq Core Web Vitals notables. Miroir SQL de CORE_VITALS (apps/console/lib/rating.ts), '
  'comparé par tests/unit/health-vitals.test.ts. Sert à exclure des agrégats de qualité les '
  'mesures qui partagent le canal rum_metric sans avoir de seuil — les phases réseau.';

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
    -- LA CORRECTION : seules les mesures NOTABLES entrent dans un ratio de qualité.
    where m.ts >= lo.t and m.name = any(mip_core_vitals()) group by 1, 2, 3
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

-- L'HISTORIQUE AUSSI ÉTAIT FAUX. Les créneaux déjà agrégés portent l'ancien
-- dénominateur ; sans recalcul, la heatmap resterait plafonnée sur tout le passé
-- et la correction ne se verrait que sur les heures à venir. 30 jours = la
-- rétention par défaut, donc tout ce qui existe encore.
select refresh_rum_rollups(24 * 30);

-- ═════════ 1.9 — un SLO sans trafic s'alarmait de sa propre absence ═══════════
--
-- `greatest(count(*), 1)` protège d'une division par zéro. Mais sur zéro mesure
-- il ne rend pas « inconnu » : il rend 0 / 1 = 0, c'est-à-dire une atteinte de
-- 0 %. Le budget est alors consommé à 100 %, `fast_burn` devient vrai, et
-- `check_slo_burn()` lève une alerte CRITIQUE — toutes les heures, sur toute
-- application qui n'a pas de trafic la nuit.
--
-- Le diagnostic est en plus INVERSÉ : une panne d'ingestion, qui fait disparaître
-- les mesures, est annoncée comme une dégradation de performance. L'astreinte
-- cherche une régression applicative pendant que le collecteur est à terre.
--
-- `nullif(count(*), 0)` rend NULL sur zéro mesure. NULL se propage à
-- `attainment`, donc à `burned_pct` et `fast_burn`. Et `check_slo_burn()` boucle
-- sur `slo_status() where fast_burn` : en SQL, `where NULL` n'est pas vrai, donc
-- ces SLO sortent de la boucle sans qu'on touche à cette fonction. « Je ne sais
-- pas » cesse d'être confondu avec « c'est mauvais ».
--
-- Le cas `error_rate` avait le défaut SYMÉTRIQUE, moins bruyant et tout aussi
-- faux : zéro page vue donnait `1 - 0/1 = 1`, soit une atteinte parfaite. Une
-- application éteinte affichait un SLO au vert. Corrigé de la même façon.

create or replace function slo_status(p_app_id text default null)
returns table(slo_id bigint, app_id text, name text, metric text, route text,
              objective double precision, window_days int,
              attainment double precision, budget double precision,
              burned_pct double precision, fast_burn boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.id, s.app_id, s.name, s.metric, s.route, s.objective, s.window_days,
         att.attainment,
         (1 - s.objective) as budget,
         -- `att.attainment is not null` n'est pas redondant : `greatest(NULL, 0)`
         -- rend 0 en PostgreSQL — la fonction IGNORE les NULL au lieu de les
         -- propager. Sans ce garde, un SLO sans données afficherait « budget
         -- consommé 0 % », soit exactement l'inverse de « je ne sais pas ».
         -- Constaté en vérifiant ce correctif sur une base réelle.
         case when (1 - s.objective) > 0 and att.attainment is not null
              then least(greatest((1 - att.attainment) / (1 - s.objective), 0) * 100, 999) end as burned_pct,
         (1 - att1h.attainment) >= 14.4 * (1 - s.objective) as fast_burn
  from slo s
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - make_interval(days => s.window_days))
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - make_interval(days => s.window_days)), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - make_interval(days => s.window_days))
    end as attainment
  ) att
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - interval '1 hour')
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - interval '1 hour'), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - interval '1 hour')
    end as attainment
  ) att1h
  where s.active and (p_app_id is null or s.app_id = p_app_id)
  order by burned_pct desc nulls last;
$$;

-- Parité d'accès : `mip_core_vitals()` est lue par les agrégats que la console
-- déclenche. Sans ce grant, un rôle restreint verrait la fonction échouer — et,
-- l'ingestion étant fail-soft, un écran vide plutôt qu'une erreur.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant execute on function mip_core_vitals() to console_ro;
  end if;
end $$;
