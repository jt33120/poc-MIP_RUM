-- migration-v102 — Des agrégats justes (29/09/2026) : une erreur arrivée tard ne
-- remet plus une heure à zéro, et les reprises partent d'un filigrane.
--
-- Rejouable, PostgreSQL 15 à 17. Numérotée v98 à l'écriture, renumérotée v102 le
-- 30/09/2026 : v100 et v101 ont été fusionnées avant elle (garde des migrations figées).
-- Elle ne redéfinit aucune fonction de v100 ni de v101.
-- Lot L0 de la refonte du monitoring (relevé des trous du 28/09/2026, T4 et T6) :
--
--   1. `agregat_filigrane` : pour chaque agrégat repris par le scheduler, l'instant
--      avant lequel tout est agrégé (§ 1) ;
--   2. `refresh_rum_rollups` recalcule EN ENTIER une heure ancienne touchée par
--      une erreur arrivée tard, au lieu d'écraser ses vues et ses vitals à 0, et
--      élargit sa fenêtre jusqu'au filigrane, bornée à 35 jours (§ 2) ;
--   3. `meter_tenant_usage()` sans argument rattrape les jours jamais comptés
--      depuis le filigrane, bornés à 14 jours ; avec un jour, rien ne change (§ 3).
--
-- AUCUN RECALCUL DE DONNÉES ICI. Les deux heures fausses de T4 (08/09 15:00 et
-- 09/09 08:00 UTC, `mip-rum-console`) se recalculent en appelant la fonction
-- corrigée, hors migration (commande dans la PR) ; le jour manquant de T6 (24/09,
-- `gip-plateforme`) est compté au premier passage quotidien qui suit.
--
-- FENÊTRE DE DÉPLOIEMENT. Signatures et types de retour inchangés : l'ancien code
-- du scheduler appelle `refresh_rum_rollups(26)` et `meter_tenant_usage()`, et
-- reçoit ce qu'il recevait. Le seul changement visible est le DÉFAUT de
-- `meter_tenant_usage` : `null` (rattrapage) au lieu de `current_date - 1`, qui
-- en reste le dernier jour.

set local lock_timeout = '3s';

-- ── 1. Le filigrane des agrégats repris ─────────────────────────────────────
--
-- `rum_rollup_hourly` se reprenait sur 26 h fixes : un scheduler arrêté plus
-- longtemps pendant que le collector écrit (il en est indépendant depuis le
-- 27/09) laissait des heures jamais agrégées. `tenant_usage_daily` ne comptait
-- que la veille : trois passages manqués du 25 au 27/09, et le 24/09 n'a jamais
-- été compté. Il faut donc savoir jusqu'où le dernier passage abouti est allé.
--
-- Une ligne par agrégat. `complet_avant` : tout ce qui précède cet instant a été
-- agrégé par un passage abouti (l'heure, ou le jour, en cours ne l'est pas). Pas
-- d'`app_id` : un passage agrège toutes les applications à la fois.
create table if not exists agregat_filigrane (
  source        text primary key check (source in ('rum_rollup_hourly', 'tenant_usage_daily')),
  complet_avant timestamptz not null,
  refreshed_at  timestamptz not null
);

comment on table agregat_filigrane is
  'Filigrane des agrégats repris par le scheduler (v102) : tout ce qui précède `complet_avant` a été '
  'agrégé par un passage abouti. Une ligne par agrégat, écrite dans la transaction du passage.';

-- Aucun rôle applicatif n'y a droit : seul le scheduler, propriétaire, l'écrit
-- et le lit, depuis les deux fonctions ci-dessous.
alter table agregat_filigrane enable row level security;

-- ── 2. `refresh_rum_rollups` : l'heure entière, et la reprise au filigrane ──
--
-- LE DÉFAUT (T4). v64 a ajouté une branche pour les erreurs arrivées tard : une
-- erreur dont le `ts` est ancien mais l'`ingested_at` récent (rejeu hors ligne)
-- faisait reconstruire son heure. Mais cette branche ne relisait QUE les erreurs
-- de l'heure : l'agrégat produisait `(pageviews 0, total_w 0, errors n)`, et
-- `on conflict do update` écrasait les vues et les vitals déjà agrégés. Le
-- 15/09, v64 a posé `ingested_at` sur les erreurs existantes : les heures du
-- 08/09 15:00 et du 09/09 08:00 de la console sont passées de 7 et 13 vues à 0.
--
-- LA CORRECTION. Une heure antérieure à la fenêtre et touchée par une erreur
-- arrivée tard est recalculée comme une heure de la fenêtre : vidée, puis
-- réagrégée depuis TOUTES ses sources (vitals, vues, erreurs). Les intervalles
-- recalculés (`cibles`) sont disjoints : la fenêtre commence à `v_lo`, les heures
-- tardives finissent avant. Rien n'est compté deux fois.
--
-- LE FILIGRANE. La fenêtre part au plus tard du filigrane (moins une heure de
-- marge), borné à 35 jours : au-delà de la rétention ordinaire (30 jours), la
-- purge a déjà effacé les sources. Sans filigrane — premier passage après cette
-- migration — la fenêtre reste celle demandée (26 h pour le scheduler).
--
-- Tout le reste reprend la définition de v81 : le verrou d'ingestion avant toute
-- lecture, la fenêtre élargie aux marques d'invalidation, la levée des marques.
create or replace function refresh_rum_rollups(p_hours int default 26)
returns int language plpgsql as $$
declare
  n           int;
  v_now       timestamptz := now();
  v_heure     timestamptz := date_trunc('hour', now());
  v_hours     int;
  v_lo        timestamptz;
  v_filigrane timestamptz;
  v_tardives  timestamptz[];
begin
  perform mip_verrouiller_apps(mip_apps_a_verrouiller());
  v_hours := mip_fenetre_reprise('rum_rollup_hourly', p_hours);

  select complet_avant into v_filigrane from agregat_filigrane where source = 'rum_rollup_hourly';
  if v_filigrane is not null then
    v_hours := greatest(
      v_hours,
      least(24 * 35, ceil(extract(epoch from (v_heure - v_filigrane)) / 3600)::int + 1)
    );
  end if;
  v_lo := v_heure - make_interval(hours => v_hours);

  -- Les heures ANTÉRIEURES à la fenêtre qui ont reçu une erreur depuis son début.
  select coalesce(array_agg(distinct date_trunc('hour', e.ts)), '{}')
    into v_tardives
    from rum_error e
   where e.ingested_at >= v_lo and e.ts < v_lo;

  -- Vidées avant d'être réécrites (v81) : une cellule dont plus aucune ligne ne
  -- relève ne doit pas survivre avec son ancien effectif.
  delete from rum_rollup_hourly where hour >= v_lo or hour = any(v_tardives);

  with cibles(debut, fin) as (
    select v_lo, 'infinity'::timestamptz
    union all
    select h, h + interval '1 hour' from unnest(v_tardives) as h
  ),
  agg as (
    select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
           sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
           sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
           0::bigint as pageviews, 0::bigint as errors
    from cibles c
    join rum_metric m on m.ts >= c.debut and m.ts < c.fin
    left join rum_session s using (session_id)
    where m.name = any(mip_core_vitals()) group by 1, 2, 3
    union all
    select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
           0::float, 0::float, count(*)::bigint, 0::bigint
    from cibles c
    join rum_pageview p on p.started_at >= c.debut and p.started_at < c.fin
    left join rum_session s using (session_id)
    group by 1, 2, 3
    union all
    -- Les occurrences, pas les lignes (v64) : le SDK compacte les répétitions.
    select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
           0::float, 0::float, 0::bigint, coalesce(sum(e.occurrences), 0)::bigint
    from cibles c
    join rum_error e on e.ts >= c.debut and e.ts < c.fin
    left join rum_session s using (session_id)
    group by 1, 2, 3
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

  -- Les heures recalculées redeviennent dignes de foi. Sous le verrou : aucune
  -- marque ne peut être posée entre l'agrégation ci-dessus et cette levée.
  delete from analytics_rollup_invalidation
   where source = 'rum_rollup_hourly'
     and (hour >= v_lo or hour = any(v_tardives));

  -- Dans la même transaction : un passage qui échoue ne fait pas avancer le
  -- filigrane, et le suivant reprend de plus loin.
  insert into agregat_filigrane (source, complet_avant, refreshed_at)
  values ('rum_rollup_hourly', v_heure, v_now)
  on conflict (source) do update
    set complet_avant = excluded.complet_avant, refreshed_at = excluded.refreshed_at;
  return n;
end $$;

comment on function refresh_rum_rollups(int) is
  'Rafraîchit la heatmap horaire sous le verrou d''ingestion des applications concernées. Fenêtre : '
  'celle demandée, élargie à la plus vieille marque d''invalidation (90 jours au plus) et au filigrane '
  '(35 jours au plus). Une heure plus ancienne touchée par une erreur arrivée tard est recalculée en '
  'entier, jamais écrasée avec ses seules erreurs (v102). Avance le filigrane.';

-- ── 3. `meter_tenant_usage` : rattraper les jours jamais comptés ────────────
--
-- LE DÉFAUT (T6). Le passage quotidien comptait la veille, et seulement elle. Un
-- passage manqué — scheduler arrêté, base suspendue du 24 au 27/09 — laissait
-- son jour sans ligne, pour toujours : `/admin/usage` montre le 23/09 et le
-- 27/09, pas le 24/09 (418 événements non comptés).
--
-- LA CORRECTION. `meter_tenant_usage()` SANS jour rattrape : il compte chaque
-- jour depuis le filigrane jusqu'à la veille, bornés aux 14 derniers jours.
-- AVEC un jour, il compte ce jour-là, exactement comme en v70 — les appels
-- explicites (tests, scripts, recomptage à la main) ne changent pas.
--
-- PREMIER PASSAGE, SANS FILIGRANE. La veille est comptée (comme avant), et les
-- jours de la borne qui n'ont AUCUNE ligne aussi. Un jour déjà compté n'est pas
-- recompté : recompter un jour que la purge a entamé ferait baisser une ligne
-- juste. Un jour sans trafic n'a pas de ligne : il est recompté une fois, sans
-- rien écrire.
create or replace function mip_rattraper_usage(p_jours_max int default 14)
returns jsonb language plpgsql as $$
declare
  v_hier      date := current_date - 1;
  v_borne     date := current_date - least(greatest(coalesce(p_jours_max, 14), 1), 60);
  v_filigrane date;
  v_jour      date;
  v_jours     date[] := '{}';
  v_apps      int := 0;
begin
  -- `for update` : deux passages simultanés ne rattrapent pas deux fois.
  select complet_avant::date into v_filigrane
    from agregat_filigrane where source = 'tenant_usage_daily' for update;

  for v_jour in select d::date from generate_series(v_borne, v_hier, interval '1 day') as d loop
    if (v_filigrane is not null and v_jour >= v_filigrane)
       or (v_filigrane is null
           and (v_jour = v_hier or not exists (select 1 from tenant_usage_daily t where t.day = v_jour))) then
      v_apps := v_apps + coalesce((meter_tenant_usage(v_jour) ->> 'apps_metered')::int, 0);
      v_jours := v_jours || v_jour;
    end if;
  end loop;

  insert into agregat_filigrane (source, complet_avant, refreshed_at)
  values ('tenant_usage_daily', (v_hier + 1)::timestamptz, now())
  on conflict (source) do update
    set complet_avant = greatest(agregat_filigrane.complet_avant, excluded.complet_avant),
        refreshed_at  = excluded.refreshed_at;

  -- `day` et `apps_metered` : la forme que rendait le comptage de la veille.
  return jsonb_build_object('day', v_hier, 'apps_metered', v_apps, 'days', to_jsonb(v_jours));
end $$;

comment on function mip_rattraper_usage(int) is
  'Compte chaque jour depuis le filigrane de tenant_usage_daily jusqu''à la veille, bornés à '
  'p_jours_max jours (14 par défaut, 60 au plus), puis avance le filigrane (v102). Sans filigrane : '
  'la veille, et les jours de la borne qui n''ont aucune ligne.';

-- Reprise du corps de v70 (unité facturée : signaux sources, exceptions dérivées
-- exclues des événements) ; seul le défaut change, et la branche sans jour.
create or replace function meter_tenant_usage(p_day date default null)
returns jsonb language plpgsql as $$
declare lo timestamptz; hi timestamptz; n int;
begin
  if p_day is null then
    return mip_rattraper_usage();
  end if;
  lo := p_day::timestamptz;
  hi := (p_day + 1)::timestamptz;
  with ev as (
    select app_id, count(*) as c from (
      select app_id from rum_metric     where ts >= lo and ts < hi
      union all select app_id from rum_error      where ts >= lo and ts < hi and origin_signal is null
      union all select app_id from rum_resource   where ts >= lo and ts < hi
      union all select app_id from rum_longtask   where ts >= lo and ts < hi
      union all select app_id from rum_breadcrumb where ts >= lo and ts < hi
      union all select app_id from rum_event      where ts >= lo and ts < hi
      union all select app_id from rum_span       where ts >= lo and ts < hi
      union all select app_id from rum_pageview   where started_at >= lo and started_at < hi
    ) x group by app_id
  ),
  se as (select app_id, count(distinct session_id) as c from rum_pageview where started_at >= lo and started_at < hi group by app_id),
  er as (select app_id, coalesce(sum(occurrences), 0)::bigint as c from rum_error where ts >= lo and ts < hi group by app_id),
  up as (
    insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at)
    select app_id, p_day, coalesce(ev.c, 0), coalesce(se.c, 0), coalesce(er.c, 0), clock_timestamp()
    from ev full join er using (app_id) left join se using (app_id)
    on conflict (app_id, day) do update
      set events = excluded.events, sessions = excluded.sessions,
          errors = excluded.errors, metered_at = clock_timestamp()
    returning 1
  )
  select count(*) into n from up;
  return jsonb_build_object('day', p_day, 'apps_metered', n);
end $$;

comment on function meter_tenant_usage(date) is
  'Compte l''usage facturé d''un jour (v70). Sans jour : rattrape depuis le filigrane jusqu''à la '
  'veille (mip_rattraper_usage, v102).';
