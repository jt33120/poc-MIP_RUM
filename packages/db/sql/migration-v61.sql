-- migration-v61 — des percentiles pré-agrégés, sommables et PONDÉRÉS.
--
-- Finding 2.10 de docs/AUDIT_RUM_EXTERNE.md, seconde moitié — et la moitié que le
-- lot 3 avait dû laisser DÉCLARÉE plutôt que corrigée.
--
-- CE QUE ÇA RÉSOUT VRAIMENT. Le pré-agrégat existant (`rum_rollup_hourly`) ne
-- porte que des COMPTAGES : chaque affichage relançait des `percentile_cont` sur
-- les lignes brutes. Mais le vrai gain n'est pas la vitesse — un p75 coûte 8 ms
-- sur 500 000 lignes, ce n'était pas un problème. C'est la PONDÉRATION.
-- PostgreSQL n'a pas de `percentile_cont` pondéré, donc sous échantillonnage les
-- percentiles portaient sur l'échantillon et non sur la population, et l'API
-- devait le déclarer (`sampling_notice`). Une somme cumulée sur des seaux, elle,
-- n'a pas besoin d'un percentile pondéré : les poids sont DANS les seaux.
--
-- ═══════════════ CE QUE CETTE TABLE FIGE, ET CE QUE ÇA IMPLIQUE ═══════════════
--
-- L'index de seau vient de `apps/console/lib/histogramme.ts` (GAMMA = 1,02,
-- plancher 0,001). Une ligne écrite ici porte cet index et RIEN d'autre : la
-- valeur d'origine n'est plus là. Changer les constantes ne recalculerait pas
-- l'historique — il le rendrait ININTERPRÉTABLE, en mélangeant deux échelles
-- dans la même colonne, sans que rien ne le signale.
--
-- C'est pour cela que ce chantier avait été différé : on ne fige pas un format
-- définitif sans avoir mesuré ce qu'il coûte. C'est mesuré. Sur cinq
-- distributions réalistes — log-normale, bimodale cache/hors-cache, queue lourde,
-- petites valeurs de CLS — et quatre percentiles, l'écart au percentile EXACT
-- vaut au pire 0,96 %, sous la borne théorique de 1 %. Sur un LCP de 2 500 ms
-- cela fait ±25 ms, très en dessous de ce qu'un seuil Core Web Vitals distingue.
-- tests/unit/histogramme.test.ts refait cette mesure à chaque exécution.
--
-- ═════════════════ POURQUOI PAS DE COLONNE `route` ════════════════════════════
--
-- L'audit propose `(app_id, device_type, route, name, hour, bucket)`. On retire
-- `route`, délibérément. C'est la dimension dont le lot 6 vient d'établir qu'elle
-- n'est bornée par rien : sur un catalogue à 6 000 routes, la table ferait
-- 6 000 × 5 × 24 × ~100 = 72 millions de lignes PAR JOUR. On créerait, pour
-- accélérer des percentiles, une table plus lourde que les données qu'elle
-- résume — et on rendrait la cardinalité de route plus coûteuse au moment même
-- où on cherche à la contenir.
--
-- Les percentiles PAR ROUTE restent donc sur les lignes brutes, où `slowRoutes`
-- les borne déjà à 200 routes. Ce sont les percentiles GLOBAUX — ceux des tuiles,
-- des séries et des SLO, c'est-à-dire ceux qu'on regarde tout le temps — qui
-- passent par les seaux.

create table if not exists metric_histogram_hourly (
  app_id         text not null,
  device_type    text not null default '',
  name           text not null,
  hour           timestamptz not null,
  bucket         int not null,
  weighted_count double precision not null default 0,
  primary key (app_id, device_type, name, hour, bucket)
);

comment on table metric_histogram_hourly is
  'Distribution horaire des Core Web Vitals en seaux log-linéaires (GAMMA=1,02, plancher 0,001 — '
  'apps/console/lib/histogramme.ts). Un percentile s''y lit par somme cumulée, donc SOMMABLE sur '
  'n''importe quelle fenêtre et PONDÉRÉ par construction. Les index de seaux sont FIGÉS : les '
  'changer rendrait l''historique ininterprétable au lieu de le recalculer.';
comment on column metric_histogram_hourly.weighted_count is
  'Somme des poids d''échantillonnage (rum_session.weight), pas un comptage de lignes. C''est ce '
  'qui rend le percentile représentatif de la POPULATION et non de l''échantillon.';

create index if not exists idx_histo_app_hour
  on metric_histogram_hourly (app_id, hour desc);

-- ─────────────────────────── Le rafraîchissement ─────────────────────────────
--
-- Calqué sur `refresh_rum_rollups` : mêmes bornes, même idempotence par
-- `on conflict`, même retour du nombre de lignes. Rejouable sans double-compter,
-- ce qui est la condition pour qu'un rattrapage après panne soit sûr.
--
-- `mip_seau()` est le MIROIR SQL de `seau()` en TypeScript. Deux implémentations
-- d'une même formule finissent par diverger : un test compare les deux sur un
-- échantillon de valeurs, plutôt que d'espérer.
create or replace function mip_seau(v double precision) returns int
language sql immutable parallel safe as $$
  select case
    when v is null or v <= 0.001 or not (v = v) then 0
    else 1 + floor(ln(v / 0.001) / ln(1.02))::int
  end;
$$;

comment on function mip_seau(double precision) is
  'Index de seau d''une valeur. Miroir SQL de seau() dans apps/console/lib/histogramme.ts, '
  'comparé par tests/unit/histogramme.test.ts. GAMMA et le plancher sont écrits en dur ici : '
  'une fonction immutable ne peut pas lire une table de paramètres, et c''est aussi bien — '
  'ces constantes ne doivent pas pouvoir changer par configuration.';

-- ─────────── LA FRONTIÈRE : ce qui est agrégé, et ce qui ne l'est pas encore ──
--
-- Un pré-agrégat horaire rafraîchi toutes les heures est en retard d'au plus une
-- heure. Le lire seul afficherait un p75 qui ignore le trafic le plus récent —
-- exactement celui qu'on regarde quand quelque chose vient de casser.
--
-- On enregistre donc la BORNE HAUTE de chaque rafraîchissement. La console lit
-- les seaux pré-agrégés en dessous de cette borne et recalcule à la volée ce qui
-- est au-dessus.
--
-- DEUX BORNES, ET NON UNE — c'est un test qui l'a imposé. Une borne de TEMPS
-- seule ne suffit pas : une mesure peut arriver longtemps après l'instant
-- qu'elle décrit. La file de rejeu du SDK réessaie jusqu'à six fois avec un
-- recul qui va jusqu'à trente minutes ; après une coupure, des mesures entrent
-- dans une heure DÉJÀ agrégée. Elles ne seraient alors ni dans les seaux (le
-- rafraîchissement était passé) ni dans le calcul vif (leur `ts` est sous la
-- borne) : purement invisibles, précisément après l'incident qu'on cherche à
-- lire. La première version de ce fichier avait ce trou ; le test d'intégration
-- l'a trouvé en semant douze mesures après le rafraîchissement.
--
-- On enregistre donc AUSSI le plus grand `rum_metric.id` vu. Toute ligne arrivée
-- après porte un id plus grand, quel que soit son `ts`, et repart dans le calcul
-- vif. La clé primaire sert d'index : aucun index supplémentaire sur la table la
-- plus écrite du schéma.
--
-- CE QUI RESTE, ET QU'ON DIT PLUTÔT QUE DE LE TAIRE. Une transaction encore en vol au
-- moment où le rafraîchissement lit `max(id)` a déjà son id, mais pas encore sa
-- ligne visible : elle porte un id INFÉRIEUR à la borne sans avoir été agrégée.
-- Elle est donc absente jusqu'au rafraîchissement suivant, qui réécrit les 26
-- dernières heures et la reprend. Fenêtre d'exposition : la durée d'une
-- transaction d'ingestion (quelques millisecondes), et un retard borné à une
-- heure — contre des heures entières pour le cas du rejeu ci-dessus.
create table if not exists metric_histogram_state (
  seul            boolean primary key default true check (seul),
  refreshed_at    timestamptz not null,
  max_metric_id   bigint not null default 0
);

comment on table metric_histogram_state is
  'Bornes du dernier refresh_metric_histogram(). Une seule ligne (contrainte par le CHECK). '
  'DEUX bornes : le temps (refreshed_at) pour les heures entières déjà agrégées, et l''identifiant '
  '(max_metric_id) pour les mesures ARRIVÉES EN RETARD dans une heure déjà agrégée — un rejeu du '
  'SDK peut porter un ts vieux de plusieurs heures. Sans la seconde, ces mesures seraient dans '
  'aucune des deux sources.';

create or replace function refresh_metric_histogram(p_hours int default 26)
returns int language plpgsql as $$
declare n int; v_now timestamptz := now(); v_max bigint;
begin
  -- AVANT l'agrégation : une ligne insérée pendant le calcul doit se retrouver
  -- au-dessus de la borne, jamais en dessous.
  select coalesce(max(id), 0) into v_max from rum_metric;

  with agg as (
    select m.app_id,
           coalesce(s.device_type, '') as device_type,
           m.name,
           date_trunc('hour', m.ts) as hour,
           mip_seau(m.value) as bucket,
           -- Le POIDS, pas le compte. `coalesce` à 1 pour les lignes dont la
           -- session a disparu (purge de rétention) : les compter pour 1 vaut
           -- mieux que les perdre, et sans échantillonnage c'est exact.
           sum(coalesce(s.weight, 1))::double precision as weighted_count
      from rum_metric m
      left join rum_session s using (session_id)
     where m.id <= v_max
       and m.ts >= v_now - make_interval(hours => greatest(p_hours, 1))
       -- Borne HAUTE explicite, et non `now()` implicite : c'est elle qu'on
       -- enregistre ci-dessous, et la lecture s'y raccorde exactement.
       and m.ts < v_now
       and m.name = any(mip_core_vitals())
       -- Les robots sont exclus de tous les agrégats de qualité de la console.
       -- Sans ce filtre, les seaux et le calcul sur lignes brutes porteraient sur
       -- deux populations différentes, et le p75 changerait selon la fraîcheur.
       and not coalesce(s.is_bot, false)
     group by 1, 2, 3, 4, 5
  ),
  up as (
    insert into metric_histogram_hourly (app_id, device_type, name, hour, bucket, weighted_count)
    select app_id, device_type, name, hour, bucket, weighted_count from agg
    on conflict (app_id, device_type, name, hour, bucket)
      do update set weighted_count = excluded.weighted_count
    returning 1
  )
  select count(*) into n from up;

  -- APRÈS l'insertion, dans la même transaction : si le rafraîchissement échoue,
  -- la borne ne bouge pas et la lecture recalcule simplement une fenêtre plus
  -- large. Un échec coûte du temps de calcul, jamais une valeur fausse.
  insert into metric_histogram_state (seul, refreshed_at, max_metric_id) values (true, v_now, v_max)
    on conflict (seul) do update set refreshed_at = excluded.refreshed_at,
                                     max_metric_id = excluded.max_metric_id;
  return n;
end $$;

-- Historique : 30 jours, soit la rétention par défaut, donc tout ce qui existe.
select refresh_metric_histogram(24 * 30);

-- ──────────── La table entre dans TOUTES les énumérations, pas certaines ──────
--
-- Une table applicative oubliée dans l'une d'elles produit soit des données qui
-- ne purgent jamais, soit des données qui survivent à un effacement. On la pose
-- donc partout où `rum_rollup_hourly` figure déjà, dans le même mouvement.

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
  delete from rum_log        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;     get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);

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
  delete from rum_log        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

-- Isolation multi-locataire, comme toute table portant un app_id.
alter table metric_histogram_hourly enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    drop policy if exists tenant_scope on metric_histogram_hourly;
    create policy tenant_scope on metric_histogram_hourly
      for select to console_ro using (app_id = any (current_app_ids()));
    grant select on metric_histogram_hourly to console_ro;
    grant execute on function mip_seau(double precision) to console_ro;
    -- Pas de RLS sur metric_histogram_state : elle ne porte AUCUN app_id, juste
    -- une date. La lire ne révèle rien d'un autre locataire ; ne pas la lire
    -- ferait recalculer la console sur 30 jours de lignes brutes.
    grant select on metric_histogram_state to console_ro;
  end if;
end $$;
