-- migration-v80 — P6.6 : agrégats et performance de l'Explorer.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucun recalcul historique : les
-- lignes d'agrégat déjà écrites gardent `observed_count = 0` et sont, pour cette
-- raison précise, IGNORÉES par la lecture hybride jusqu'à ce qu'un
-- rafraîchissement ordinaire les recalcule. La reprise historique reste P8.
-- v79 appartient à P6.5 (tableaux de bord et vues enregistrées) ; ce fichier ne
-- touche ni `dashboard`, ni `analytics_saved_view`.
--
-- ═════════════════════ 1. LES INDEX, ET LEUR MESURE ═════════════════════════
--
-- Base jetable PostgreSQL 15.18 (conteneur aarch64, 738 Mio), 7 jours glissants :
--   rum_event    1 200 000 lignes (app A 1 000 000, B 150 000, C 50 000)   409 Mio
--   rum_metric     600 000 lignes (5 Core Web Vitals)                      125 Mio
--   rum_pageview   400 000 lignes                                          69 Mio
--   rum_error      250 000 lignes, occurrences 1 à 4                        86 Mio
--   rum_session    120 000 lignes, 6 % de robots, 4 appareils, 12 releases   38 Mio
-- Semis par `generate_series` seul — aucune donnée client n'entre dans un banc.
-- Protocole : `tests/integration/explorer-bench-p66.test.ts`, qui compile le SQL
-- RÉELLEMENT exécuté, en imprime le plan `EXPLAIN (ANALYZE, BUFFERS)`, puis
-- chronomètre 20 lectures de bout en bout après chauffe.
--
-- Mesures (p50 / p95 de bout en bout sur 20 tirages à chaud ; avant = sans index
-- et sans la réduction de projection, après = état livré) :
--
--   Lecture                                              avant         après      index choisi
--   ──────────────────────────────────────────────────── ───────────── ────────── ─────────────────────────
--   événements, total 24 h                                93 / 139 ms   41 /  45  (app_id, ts)
--   événements, filtre release 24 h                       86 / 103 ms   35 /  41  (app_id, release, ts)
--   événements, filtre env sélectif 24 h                  84 /  86 ms   29 /  48  (app_id, env, ts)
--   événements, série 24 h groupée par release           315 / 362 ms  232 / 251  (app_id, ts)
--   événements, filtre release 7 j                        97 / 104 ms   82 /  91  (app_id, release, ts)
--   événements, série 7 j filtrée env, groupe release   1099 / 1532 ms  947 / 987  aucun
--   événements, total 7 j                                154 / 171 ms  152 / 230  aucun (parcours parallèle)
--   événements, classement par release 7 j               343 / 381 ms  356 / 512  aucun
--   erreurs, somme occurrences + filtre env + release      98 / 118 ms   96 / 108  aucun
--   Web Vitals, p75 LCP par appareil                     239 / 265 ms  172 / 182  agrégat (§ 2 et 4)
--   sessions, visiteurs distincts 7 j                    250 / 265 ms  247 / 256  aucun
--
-- Les lectures qui ne changent PAS de plan (parcours parallèle sur 7 jours)
-- varient d'environ ±30 % au p95 d'une exécution à l'autre : cache partagé et
-- ordonnancement des workers. Seules celles qui changent de plan se comparent.
--
-- CE QUE LA MESURE A TRANCHÉ :
--   • Les trois index sur rum_event sont créés : ils divisent par deux à trois
--     les fenêtres de 24 h, qui sont l'usage courant. rum_event n'avait AUCUN
--     index sur (app_id, ts) : toute lecture de l'Explorer parcourait la table
--     entière, quelle que soit la fenêtre demandée.
--   • L'index (app_id, env, ts) est conservé bien qu'il ne serve pas sur une
--     valeur majoritaire (`env = prod`, 60 % des lignes : le planificateur
--     préfère à juste titre le parcours). Il paie sur une valeur sélective,
--     mesurée à 26 ms contre 84.
--   • AUCUN index n'est créé sur rum_error ni rum_metric. Construits et mesurés,
--     ils n'ont JAMAIS été choisis : 250 k lignes se parcourent en 60 ms, et les
--     Web Vitals passent déjà par idx_metric_name_ts. Coût sans contrepartie.
--   • Sur 7 jours, aucun index ne remplace un parcours : c'est la matérialisation
--     du CTE `population` qui domine, et elle a été réduite côté SQL. Les
--     colonnes du journal — et la clé de curseur — ne sont plus projetées pour un
--     graphe qui n'en lit aucune : la ligne matérialisée passe de 61 à 33 octets,
--     les fichiers temporaires de 45 Mio à 13, et le p95 de 1 532 à 987 ms.
--   • Le p75 des Web Vitals par appareil passe par l'agrégat (§ 2 et 4) :
--     239 → 172 ms au p50, en lisant 16 739 cellules au lieu de 120 000 lignes.
--   • Objectif de test tenu : ≤ 2 s au p95 à chaud pour 1 M d'événements sur
--     7 jours et par app. La lecture la plus lourde tient à 987 ms, sous un
--     budget SQL de 5 s inchangé — un facteur cinq de marge, délibéré. Ce n'est
--     pas un SLA de production : la mesure vaut pour ce matériel et ce jeu.
--   • Coût du rafraîchissement horaire après ces changements : 590 ms pour
--     600 000 mesures, 27 062 cellules écrites, 4,7 Mio de table. Rejoué, il rend
--     le même nombre — la fenêtre est vidée puis réécrite (§ 4).
--
-- GARDE DE DÉPLOIEMENT (motif v68). Le runner applique chaque migration dans une
-- transaction, donc ne peut pas employer CONCURRENTLY. Au-delà de 32 Mio, on
-- refuse ici un build bloquant plutôt que de figer l'ingestion : précréer les
-- index avec `predeploy-v80-indexes.sql`.
--
-- ═══════════ 2. CE QUI MANQUAIT À L'HISTOGRAMME POUR SERVIR L'EXPLORER ═══════
--
-- `metric_histogram_hourly` (v61) stocke `weighted_count` : une somme de POIDS
-- d'échantillonnage, qui fait de son percentile celui de la POPULATION estimée.
-- L'Explorer, lui, compte `observed` — ce qui a été reçu, sans extrapolation.
-- Les deux dénominateurs répondent à deux questions, et confondre l'un avec
-- l'autre changerait la mesure sans le dire. D'où `observed_count`, écrit par le
-- même rafraîchissement, à côté et non à la place.
--
-- ══════════════ 3. L'INVALIDATION, ET POURQUOI UNE TABLE ════════════════════
--
-- Un effacement DSAR retire des lignes de `rum_metric` mais laissait la cellule
-- d'agrégat intacte : le percentile continuait de compter les mesures d'une
-- personne effacée. SUPPRIMER la cellule ne corrigerait rien — une cellule
-- absente est indiscernable d'une heure sans trafic, et la lecture rendrait zéro
-- au lieu de recompter. Une heure marquée, elle, sort de l'agrégat ET rentre
-- dans la lecture brute : le compte reste juste, seul le coût change, jusqu'à ce
-- qu'un rafraîchissement ordinaire la recalcule et retire la marque.
--
-- L'arrivée TARDIVE, elle, n'a pas besoin de marque : `metric_histogram_state`
-- porte déjà un filigrane d'identifiant, et toute ligne au-dessus est relue
-- brute (v61). La purge et l'effacement d'app suppriment les cellules ET les
-- marques devenues sans objet.
--
-- VERROUS. `alter table` prend un ACCESS EXCLUSIVE tenu jusqu'au commit ; les
-- objets sont pris dans l'ordre où l'ingestion les écrit. `lock_timeout` borne
-- chaque attente ; s'il expire, le fichier entier est annulé et rejoué.
set local lock_timeout = '5s';

-- ── 1. Index mesurés de l'Explorer sur rum_event ────────────────────────────
do $$
begin
  if pg_total_relation_size('public.rum_event') > 33554432 then
    if to_regclass('public.idx_rum_event_app_ts_v80') is null then
      raise exception 'v80: précréer idx_rum_event_app_ts_v80 avec predeploy-v80-indexes.sql';
    end if;
    if to_regclass('public.idx_rum_event_app_release_ts_v80') is null then
      raise exception 'v80: précréer idx_rum_event_app_release_ts_v80 avec predeploy-v80-indexes.sql';
    end if;
    if to_regclass('public.idx_rum_event_app_env_ts_v80') is null then
      raise exception 'v80: précréer idx_rum_event_app_env_ts_v80 avec predeploy-v80-indexes.sql';
    end if;
  end if;
end $$;

create index if not exists idx_rum_event_app_ts_v80         on rum_event (app_id, ts);
create index if not exists idx_rum_event_app_release_ts_v80 on rum_event (app_id, release, ts);
create index if not exists idx_rum_event_app_env_ts_v80     on rum_event (app_id, env, ts);

comment on index idx_rum_event_app_ts_v80 is
  'Fenêtre de l''Explorer sur les événements custom. Mesuré : 24 h passe de 93 à 40 ms (p50). '
  'rum_event n''avait aucun index sur (app_id, ts) — toute lecture parcourait la table entière.';
comment on index idx_rum_event_app_release_ts_v80 is
  'Filtre release borné à une fenêtre (comparaison de versions). Mesuré : 86 → 38 ms sur 24 h.';
comment on index idx_rum_event_app_env_ts_v80 is
  'Filtre environnement borné à une fenêtre. Mesuré : 84 → 26 ms sur une valeur sélective ; '
  'non choisi sur une valeur majoritaire, où le parcours parallèle est meilleur.';

-- ── 2. Dénominateur OBSERVÉ de l'histogramme ────────────────────────────────
-- `default 0` : PostgreSQL 11+ l'écrit dans le catalogue, sans réécrire la table.
-- La valeur 0 est un MARQUEUR : une cellule antérieure à ce fichier, jamais
-- rafraîchie depuis, ne peut pas être lue comme un compte observé nul — une
-- cellule n'existe que si au moins une mesure l'a créée.
alter table metric_histogram_hourly
  add column if not exists observed_count bigint not null default 0;

comment on column metric_histogram_hourly.observed_count is
  'Nombre de mesures REÇUES dans le seau, sans pondération — le dénominateur « observed » de '
  'l''Explorer, à côté de weighted_count qui, lui, estime la population. 0 signale une cellule '
  'écrite avant v80 et jamais rafraîchie depuis : la lecture hybride l''ignore et relit le brut.';

-- ── 3. Registre des heures d'agrégat à ne pas croire ────────────────────────
create table if not exists analytics_rollup_invalidation (
  source   text        not null,
  app_id   text        not null,
  hour     timestamptz not null,
  reason   text        not null,
  noted_at timestamptz not null default now(),
  primary key (source, app_id, hour)
);

comment on table analytics_rollup_invalidation is
  'Heures d''agrégat devenues fausses (effacement DSAR d''une session). La lecture hybride les '
  'exclut de l''agrégat ET les relit sur les lignes brutes : le compte reste juste, seul le coût '
  'change. Un rafraîchissement ordinaire recalcule l''heure et retire la marque. Ne contient ni '
  'identité, ni mesure — seulement une app et une heure.';
comment on column analytics_rollup_invalidation.reason is
  'dsar : une session effacée portait des mesures de cette heure.';

-- Aucun index supplémentaire : la clé primaire (source, app_id, hour) est
-- exactement l'accès de la lecture hybride et du nettoyage.

-- Accès console : motif des tables créées après v47 — portée tenant explicite,
-- jamais `using (true)`. Les policies permissives se combinent en OU, donc une
-- seule ouverte annulerait le filtrage des autres sans que rien ne le dise
-- (`scripts/verify-tenant-isolation.mjs` refuse la table sinon).
alter table analytics_rollup_invalidation enable row level security;
drop policy if exists tenant_scope on analytics_rollup_invalidation;
create policy tenant_scope on analytics_rollup_invalidation
  for select to console_ro using (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on analytics_rollup_invalidation from console_ro;
    grant select on analytics_rollup_invalidation to console_ro;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on analytics_rollup_invalidation from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on analytics_rollup_invalidation from authenticated;
  end if;
end $$;

-- ── 4. Rafraîchissement : compte observé, app scopée, heure REMPLACÉE ───────
-- Reprise de la définition de v61, avec QUATRE changements :
--   a. `observed_count` écrit à côté de `weighted_count` ;
--   b. la jointure de session est bornée par l'APP. `using (session_id)` joignait
--      un identifiant émis par le client : deux apps qui émettent le même
--      session_id échangeaient leur appareil et leur poids. La lecture brute de
--      l'Explorer, elle, joint déjà app + session — sans cette correction, les
--      deux chemins n'auraient pas groupé les mêmes lignes par appareil ;
--   c. l'heure est REMPLACÉE, pas fusionnée. `on conflict do update` seul ne
--      touche que les cellules que la nouvelle agrégation produit : une cellule
--      dont plus aucune ligne ne relève — après un effacement DSAR, ou une purge
--      — survivait avec son ancien effectif et continuait d'être comptée. Les
--      cellules de la fenêtre sont donc supprimées avant d'être réécrites ;
--   d. seules des heures ENTIÈRES sont écrites. `now() - 26 heures` tombe au
--      milieu d'une heure : agréger cette heure-là y écrirait un effectif partiel
--      par-dessus un effectif complet. La borne basse est remontée à l'heure
--      pleine suivante. L'heure EN COURS reste partielle, mais la lecture ne la
--      croit jamais, et la passe suivante la recalcule entière ;
--   e. les marques d'invalidation des heures recalculées sont levées, dans la
--      MÊME transaction que l'écriture qui les rend caduques.
create or replace function refresh_metric_histogram(p_hours int default 26)
returns int language plpgsql as $function$
declare n int; v_now timestamptz := now(); v_max bigint; v_debut timestamptz; v_plein timestamptz;
begin
  -- AVANT l'agrégation : une ligne insérée pendant le calcul doit se retrouver
  -- au-dessus de la borne, jamais en dessous.
  select coalesce(max(id), 0) into v_max from rum_metric;
  v_debut := v_now - make_interval(hours => greatest(p_hours, 1));
  v_plein := date_trunc('hour', v_debut)
             + case when date_trunc('hour', v_debut) = v_debut then interval '0' else interval '1 hour' end;

  -- La fenêtre recalculée est d'abord vidée : ce qui n'a plus de ligne derrière
  -- lui ne doit pas survivre à sa réécriture.
  delete from metric_histogram_hourly where hour >= v_plein and hour < v_now;

  with agg as (
    select m.app_id,
           coalesce(s.device_type, '') as device_type,
           m.name,
           date_trunc('hour', m.ts) as hour,
           mip_seau(m.value) as bucket,
           -- Le POIDS, pas le compte. `coalesce` à 1 pour les lignes dont la
           -- session a disparu (purge de rétention) : les compter pour 1 vaut
           -- mieux que les perdre, et sans échantillonnage c'est exact.
           sum(coalesce(s.weight, 1))::double precision as weighted_count,
           -- Le COMPTE, sans pondération : ce que l'Explorer additionne.
           count(*)::bigint as observed_count
      from rum_metric m
      left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
     where m.id <= v_max
       and m.ts >= v_plein
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
    insert into metric_histogram_hourly (app_id, device_type, name, hour, bucket, weighted_count, observed_count)
    select app_id, device_type, name, hour, bucket, weighted_count, observed_count from agg
    -- Le conflit reste possible : deux passes concurrentes se recouvriraient.
    on conflict (app_id, device_type, name, hour, bucket)
      do update set weighted_count = excluded.weighted_count, observed_count = excluded.observed_count
    returning 1
  )
  select count(*) into n from up;

  -- Les heures recalculées redeviennent dignes de foi. Bornée à la fenêtre
  -- réécrite : une marque plus ancienne survit, et son heure reste lue brute
  -- jusqu'à une reprise historique (P8) — lent, jamais faux.
  delete from analytics_rollup_invalidation
   where source = 'metric_histogram_hourly' and hour >= v_plein and hour < v_now;

  -- APRÈS l'insertion, dans la même transaction : si le rafraîchissement échoue,
  -- la borne ne bouge pas et la lecture recalcule simplement une fenêtre plus
  -- large. Un échec coûte du temps de calcul, jamais une valeur fausse.
  insert into metric_histogram_state (seul, refreshed_at, max_metric_id) values (true, v_now, v_max)
    on conflict (seul) do update set refreshed_at = excluded.refreshed_at,
                                     max_metric_id = excluded.max_metric_id;
  return n;
end $function$;

comment on function refresh_metric_histogram(int) is
  'Rafraîchit la distribution horaire des Core Web Vitals (poids ET compte observé), lève les '
  'marques d''invalidation des heures recalculées et avance le filigrane. Rejouable sans '
  'double-compter : la fenêtre est vidée puis réécrite, donc une cellule dont les lignes ont '
  'disparu ne survit pas. Seules des heures entières sont écrites, l''heure en cours exceptée, '
  'que la lecture ne croit jamais.';

-- ── 5. Effacement DSAR : marquer les heures que l'on vient de fausser ───────
-- Reprise de la définition de v67, avec la seule addition des marques. Les
-- heures sont relevées AVANT que les lignes ne disparaissent — après, plus rien
-- ne dirait lesquelles recompter.
create or replace function erase_session(p_session_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('session_id', p_session_id); n bigint;
begin
  delete from ingest_raw
   where lot @> jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('session_id', p_session_id)));
  get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);

  -- `rum_metric` alimente `metric_histogram_hourly` : les heures touchées sont
  -- marquées dans la même instruction que la suppression. Une CTE de
  -- modification s'exécute toujours, qu'on lise sa sortie ou non.
  with supprimees as (
    delete from rum_metric where session_id = p_session_id returning app_id, ts
  ), marquees as (
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select distinct 'metric_histogram_hourly', app_id, date_trunc('hour', ts), 'dsar' from supprimees
    on conflict (source, app_id, hour) do update set reason = excluded.reason, noted_at = now()
    returning 1
  )
  select count(*) into n from supprimees;
  result := result || jsonb_build_object('rum_metric', n);

  delete from rum_error       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- ── 6. Rétention et effacement d'app : emporter les marques ─────────────────
-- Reprise intégrale des définitions de v72, avec la seule addition du nettoyage
-- de `analytics_rollup_invalidation` : une marque dont l'heure d'agrégat vient
-- d'être purgée n'a plus d'objet, et une app effacée ne doit rien laisser.
create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_event_index where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action a
   where a.app_id = p_app_id and a.ts < p_cutoff
     and not exists (select 1 from rum_error x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_resource x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_breadcrumb x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_span x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_event x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id and last_seen < p_cutoff;   get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from rum_resource    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event x where x.session_id = s.session_id)
     and not exists (select 1 from rum_span x where x.session_id = s.session_id)
     and not exists (select 1 from rum_action x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event_index x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from sourcemap_upload_token
   where app_id = p_app_id and least(expires_at, coalesce(revoked_at, expires_at)) < p_cutoff;
  get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  return result;
end $$;

create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from ingest_raw      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from error_grouping_config where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_grouping_config', n);
  delete from rum_resource    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);
  delete from route_pattern where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from sourcemap_upload_token where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  delete from syn_snapshot where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;
