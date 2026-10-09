-- migration-v111 — Sécurité et hygiène des données, côté base et collecte (08/10/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. v110 (contexte des exceptions de
-- journal) est le fichier précédent. AUCUNE LIGNE N'EST SUPPRIMÉE : une colonne
-- nullable, un index partiel, des fonctions, une policy, et des marques
-- d'invalidation d'agrégat (qui font recalculer, jamais effacer, ce qui reste
-- sourcé). Lot A de la vague 2, après l'audit du 07/10/2026.
--
-- 1. LES LOGS DEVIENNENT IDEMPOTENTS (constat 2.11 de l'audit externe).
--    `insert into rum_log` n'avait pas de `on conflict` : un lot rejoué (reprise
--    du SDK, drain de la file différée) dupliquait ses logs, sur les deux chemins
--    d'écriture. Un log OTLP n'a pas d'identifiant : sa CLÉ NATURELLE est calculée
--    par le parser (`flattenOtlpLogs`, `log_uid`) — empreinte de l'application,
--    des horodatages BRUTS du record, de sa sévérité, de son corps, de sa
--    corrélation et de sa POSITION dans la charge (stable au rejeu de la même
--    charge ; deux logs identiques émis dans la même milliseconde restent deux).
--    `(app_id, log_uid)` est unique là où `log_uid` est renseigné : les lignes
--    ANTÉRIEURES n'en ont pas (NULL), l'index partiel les ignore. Les doublons déjà
--    en base ne sont donc ni supprimés ni bloquants ; leur déduplication éventuelle
--    est une décision séparée (voir la description de la PR).
--    Le chemin en un aller-retour passe par `mip_ingerer_lot_v2` : la fonction de
--    v109, À L'IDENTIQUE, sauf l'écriture des logs (`log_uid`, `on conflict`). v1
--    reste en base : le collector y retombe tant que v2 manque (fenêtre de
--    déploiement), et `ingest_un_aller_retour_pct = 0` reste le retour arrière.
--
-- 2. LES AGRÉGATS HORAIRES SANS ROBOTS, JOINTS DANS LEUR APPLICATION.
--    `refresh_rum_rollups` (v102) joignait la session par `using (session_id)` —
--    deux applications qui émettent le même identifiant échangeaient leur classe
--    d'appareil — et ne filtrait pas `is_bot`. `metric_histogram_hourly` (v61/v80)
--    et le recalcul P8.2 (`backfills/rollups.mjs`) joignent déjà sur
--    `(app_id, session_id)` et excluent les robots : `rum_rollup_hourly` prend la
--    même population. Les heures déjà agrégées (35 jours au plus, la borne du
--    filigrane de v102) sont MARQUÉES invalides, une seule fois : le passage
--    suivant du scheduler les recalcule, et la lecture hybride les relit sur le
--    brut d'ici là.
--
-- 3. LA GARDE MORTE DE LA PURGE (piste 1 de l'audit externe). `purge_rum_app`
--    gardait une page vue tant qu'un vital ou une erreur la référençait par
--    `pageview_id`. Aucun chemin d'écriture ne renseigne cette colonne (ni
--    `colonnesMetrique` / `colonnesErreur` de pg-ingest.mjs, ni la fonction v109) :
--    les deux `not exists` ne gardaient rien et coûtaient deux parcours complets de
--    `rum_metric` et `rum_error` (colonne non indexée) à chaque purge d'application.
--    Ils sont retirés. La renseigner aurait demandé de rattacher chaque vital et
--    chaque erreur à SA page vue, ce que rien ne fait aujourd'hui (v94 le dit pour
--    le SLO) : c'est une fonctionnalité, pas une correction. Garde-fou : si UNE
--    ligne porte encore un `pageview_id`, la purge n'est PAS modifiée (la clé
--    étrangère ferait sinon échouer la suppression) et le fichier le signale.
--
-- 4. RLS SUR `alert_config` (v49). La table était la seule configuration sans RLS.
--    Elle est globale (singleton, sans `app_id`) comme `platform_flag` : même
--    schéma que v97 — RLS activée, lecture ouverte à `console_ro` (qui en a le
--    droit depuis v49) par une policy `using (true)`. QUI LIT, relevé dans le
--    code le 08/10 : le scheduler et le notifier (`dispatch-alerts.mjs`) et
--    `route_alert` (SECURITY DEFINER), tous sous le PROPRIÉTAIRE, que la RLS ne
--    vise pas (pas de FORCE) ; `mip_console` et `mip_api` n'y ont aucun droit, et
--    aucun écran ne la lit. Les écritures restent au propriétaire.
--
-- RETOUR ARRIÈRE. Logs : `update platform_flag set value = '0' where key =
-- 'ingest_un_aller_retour_pct'` ramène le chemin historique ; l'index partiel et la
-- colonne peuvent rester (le code les détecte). Agrégats : réappliquer la
-- définition de v102 (`refresh_rum_rollups`) ; la console qui lit l'agrégat le
-- déclare désormais « sans robots ». Purge : réappliquer la définition de v82 puis
-- v97. RLS : `alter table alert_config disable row level security`.
--
-- VERROUS. `add column` nullable sans défaut : verrou bref sur `rum_log`. L'index
-- partiel est construit EN LIGNE par `predeploy-v111-indexes.sql`, que le
-- migrateur passe juste avant ce fichier (connexion directe) ; ici, `if not
-- exists` le reconnaît. Sans connexion directe, il se construit dans la
-- transaction : un parcours de `rum_log`, pendant lequel l'écriture des logs attend.
set local lock_timeout = '3s';

-- ── 1. La clé naturelle des logs ────────────────────────────────────────────
alter table rum_log add column if not exists log_uid text;

comment on column rum_log.log_uid is
  'Clé naturelle d''un log OTLP (v111), calculée par flattenOtlpLogs : rend l''écriture idempotente au '
  'rejeu d''un lot. NULL pour les lignes antérieures à v111.';

create unique index if not exists rum_log_app_uid_v111 on rum_log (app_id, log_uid) where log_uid is not null;

-- ── 1 bis. L'écriture d'un lot en un aller-retour, logs idempotents ─────────
--
-- Copie de `mip_ingerer_lot_v1` (migration-v109), dont seule l'étape 5 (les logs)
-- change. v109 ne se modifie pas : une seconde version, et le collector choisit
-- v2, puis v1 si v2 manque (`ingest-un-ar.mjs`). `mip_ingest_refuse_v1` (v109)
-- reste la passe de barrière des deux versions.
create or replace function mip_ingerer_lot_v2(p_apps text[], p_lot jsonb, p_options jsonb default '{}'::jsonb)
  returns jsonb
  language plpgsql
  set search_path = public, pg_temp
as $fn$
declare
  v_verrouiller boolean := coalesce((p_options->>'verrouiller')::boolean, true);
  v_lock_ms     integer := (p_options->>'lock_timeout_ms')::integer;
  v_restant_ms  integer := (p_options->>'restant_ms')::integer;
  v_regroup     jsonb   := coalesce(p_options->'regroupement', '{}'::jsonb);
  v_fin         timestamptz;
  v_t0          timestamptz := clock_timestamp();
  v_t1          timestamptz;
  v_lot         jsonb := coalesce(p_lot, '{}'::jsonb);
  v_b_app       text[];
  v_b_kind      text[];
  v_b_key       text[];
  v_s_app       text[];
  v_s_ses       text[];
  v_refuses     jsonb := '{}'::jsonb;
  v_total       integer := 0;
  v_conflit     record;
  v_metriques   jsonb[] := '{}';
  v_positions   jsonb := '{}'::jsonb;
  v_m           jsonb;
  v_p           integer;
  v_prec        jsonb;
  v_a           double precision;
  v_b           double precision;
  v_index       jsonb[] := '{}';
  v_e           jsonb;
  v_canon       record;
  v_c_app       text[];
  v_c_ses       text[];
  v_err_recues  integer := 0;
  v_err_inserees integer := 0;
  v_sortie      jsonb;
begin
  if v_restant_ms is not null then
    v_fin := statement_timestamp() + v_restant_ms * interval '1 millisecond';
  end if;

  -- 1. Le verrou des applications du lot, AVANT toute lecture de barrière : c'est
  --    lui qui ordonne cette écriture et un effacement (v81). `mip_verrouiller_apps`
  --    prend les clés dans l'ordre croissant, comme `verrouillerApps` côté client.
  if v_verrouiller then
    if v_lock_ms is not null then
      perform set_config('lock_timeout', v_lock_ms::text || 'ms', true);
    end if;
    perform mip_verrouiller_apps(p_apps);
  end if;
  v_t1 := clock_timestamp();
  if v_fin is not null and v_t1 > v_fin then
    raise exception 'échéance de la requête atteinte (verrou)' using errcode = '57014';
  end if;

  -- 2. Les barrières (`filtrerParBarrieres`) : sujets candidats du lot — chaînes
  --    non vides, calculées par le client (`__app`, `__s`, `__v`, `__u`, `__a`) —,
  --    puis ceux qu'une barrière non expirée vise.
  select array_agg(b.app_id), array_agg(b.subject_kind), array_agg(b.subject_key)
    into v_b_app, v_b_kind, v_b_key
    from (
      select distinct l.r->>'__app' as app, k.kind, k.cle
        from jsonb_each(v_lot) c
        cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) l(r)
        cross join lateral (values ('session', l.r->>'__s'), ('visitor', l.r->>'__v'),
                                   ('user', l.r->>'__u'), ('account', l.r->>'__a')) k(kind, cle)
       where l.r->>'__app' is not null and k.cle is not null
    ) cand
    join privacy_erasure_barrier b
      on b.app_id = cand.app and b.subject_kind = cand.kind and b.subject_key = cand.cle
     and (b.expires_at is null or b.expires_at > now());

  if v_b_app is not null then
    -- Passe 1 : les sessions de CE lot qui appartiennent à un sujet effacé — celles
    -- que la barrière nomme, plus celles des lignes qui portent un visiteur ou une
    -- identité effacés.
    select array_agg(s.app), array_agg(s.ses) into v_s_app, v_s_ses
      from (
        select x.app, x.ses from unnest(v_b_app, v_b_kind, v_b_key) as x(app, kind, ses) where x.kind = 'session'
        union
        select l.r->>'__app', l.r->>'__s'
          from jsonb_each(v_lot) c
          cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value) = 'array' then c.value else '[]'::jsonb end) l(r)
         where l.r->>'__s' is not null
           and exists (select 1 from unnest(v_b_app, v_b_kind, v_b_key) as b(app, kind, cle)
                        where b.app = l.r->>'__app'
                          and ((b.kind = 'visitor' and b.cle = l.r->>'__v')
                            or (b.kind = 'user' and b.cle = l.r->>'__u')
                            or (b.kind = 'account' and b.cle = l.r->>'__a')))
      ) s;

    -- Passe 2 : on retire, collection par collection, en gardant l'ordre.
    select jsonb_object_agg(f.cle, f.gardees), coalesce(jsonb_object_agg(f.cle, f.perdues) filter (where f.perdues > 0), '{}'::jsonb),
           coalesce(sum(f.perdues), 0)
      into v_lot, v_refuses, v_total
      from (
        select c.key as cle,
               case when jsonb_typeof(c.value) <> 'array' then c.value
                    else coalesce((select jsonb_agg(l.r order by l.ord)
                                     from jsonb_array_elements(c.value) with ordinality l(r, ord)
                                    where not mip_ingest_refuse_v1(l.r, v_b_app, v_b_kind, v_b_key, v_s_app, v_s_ses)), '[]'::jsonb)
               end as gardees,
               case when jsonb_typeof(c.value) <> 'array' then 0
                    else (select count(*) from jsonb_array_elements(c.value) l(r)
                           where mip_ingest_refuse_v1(l.r, v_b_app, v_b_kind, v_b_key, v_s_app, v_s_ses))::integer
               end as perdues
          from jsonb_each(v_lot) c
      ) f;
    v_lot := coalesce(v_lot, '{}'::jsonb);
  end if;

  -- 3. Le regroupement v2 ACTIF n'est pas porté ici : `MIP02`, rien n'est écrit, le
  --    client rejoue par le chemin historique. Idem si `vendor_paths` a changé
  --    depuis la lecture du client : la clé en ombre qu'il a calculée serait fausse.
  if jsonb_array_length(coalesce(v_lot->'errors', '[]'::jsonb)) > 0 then
    if exists (
      select 1
        from (select distinct e.r->>'app_id' as app
                from jsonb_array_elements(v_lot->'errors') e(r)) a
        left join error_grouping_config g on g.app_id = a.app
       where g.active_version = 2
          or coalesce(g.vendor_paths, '{}'::text[]) is distinct from
             array(select jsonb_array_elements_text(coalesce(v_regroup->a.app, '[]'::jsonb)))
    ) then
      raise exception 'regroupement v2 actif ou configuration changée : chemin historique' using errcode = 'MIP02';
    end if;
  end if;

  -- 4. Portée des sessions (`verifierPorteeSessions`) : une session déjà enregistrée
  --    sous une autre application ne peut pas être écrite par celle-ci.
  select s.session_id, coalesce(s.app_id, 'null') as proprietaire,
         (select string_agg(x.app, ', ' order by x.premier)
            from (select l.r->>'__app' as app, min(l.ord) as premier
                    from jsonb_array_elements(coalesce(v_lot->'sessions', '[]'::jsonb)) with ordinality l(r, ord)
                   where l.r->>'__s' = s.session_id and l.r->>'__app' is not null
                   group by 1) x) as apps
    into v_conflit
    from rum_session s
   where s.session_id in (select l.r->>'__s' from jsonb_array_elements(coalesce(v_lot->'sessions', '[]'::jsonb)) l(r)
                           where l.r->>'__s' is not null and l.r->>'__app' is not null)
     and not exists (select 1 from jsonb_array_elements(coalesce(v_lot->'sessions', '[]'::jsonb)) l(r)
                      where l.r->>'__s' = s.session_id and l.r->>'__app' = s.app_id)
   limit 1;
  if found then
    raise exception using errcode = 'MIP01',
      message = format('session déjà enregistrée pour « %s », revendiquée par « %s »', v_conflit.proprietaire, v_conflit.apps);
  end if;

  -- 5. Logs (`writeLogsWithClient`) : avant les erreurs qu'ils portent. v111 : la
  --    clé naturelle `log_uid` rend l'écriture idempotente au rejeu ; un log sans
  --    clé (lot d'un parser antérieur, déposé dans la file) s'écrit comme avant.
  --    `on conflict` sans cible, comme `CONFLIT_LOG` (pg-ingest.mjs) : la seule
  --    autre unicité de la table est son identifiant séquentiel.
  insert into rum_log (app_id, ts, severity_num, severity_text, body, source, trace_id, span_id, session_id, route, attributes,
                       log_uid)
  select r->>'app_id', (r->>'ts')::timestamptz, (r->>'severity_num')::smallint, r->>'severity_text', r->>'body',
         r->>'source', r->>'trace_id', r->>'span_id', r->>'session_id', r->>'route', (r->>'attributes')::jsonb,
         r->>'log_uid'
    from jsonb_array_elements(coalesce(v_lot->'logs', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict do nothing;

  -- 6. Sessions : l'upsert de `clauseConflitSession`, borné à l'application.
  insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, geo_country, is_bot,
                           collection_source, release, net_type, visitor_id, sample_rate, error_sample_rate, has_error,
                           user_id_hash, account_id_hash, context, browser, browser_version, os, os_version, runtime,
                           geo_source, geo_db_version, started_at, last_seen_at, page_count)
  select r->>'session_id', r->>'app_id', r->>'client_id', r->>'user_hash', r->>'user_agent', r->>'device_type',
         r->>'geo_country', (r->>'is_bot')::boolean, r->>'collection_source', r->>'release', r->>'net_type',
         r->>'visitor_id', (r->>'sample_rate')::double precision, (r->>'error_sample_rate')::double precision,
         (r->>'has_error')::boolean, r->>'user_id_hash', r->>'account_id_hash', (r->>'context')::jsonb, r->>'browser',
         r->>'browser_version', r->>'os', r->>'os_version', r->>'runtime', r->>'geo_source', r->>'geo_db_version',
         (r->>'started_at')::timestamptz, (r->>'last_seen_at')::timestamptz, (r->>'page_count')::integer
    from jsonb_array_elements(coalesce(v_lot->'sessions', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (session_id) do update set
    last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
    user_agent  = coalesce(rum_session.user_agent, excluded.user_agent),
    geo_country = coalesce(rum_session.geo_country, excluded.geo_country),
    device_type = coalesce(rum_session.device_type, excluded.device_type),
    release = coalesce(rum_session.release, excluded.release),
    net_type = coalesce(rum_session.net_type, excluded.net_type),
    visitor_id = coalesce(rum_session.visitor_id, excluded.visitor_id),
    user_id_hash = coalesce(rum_session.user_id_hash, excluded.user_id_hash),
    account_id_hash = coalesce(rum_session.account_id_hash, excluded.account_id_hash),
    browser = coalesce(rum_session.browser, excluded.browser),
    browser_version = coalesce(rum_session.browser_version, excluded.browser_version),
    os = coalesce(rum_session.os, excluded.os),
    os_version = coalesce(rum_session.os_version, excluded.os_version),
    runtime = coalesce(rum_session.runtime, excluded.runtime),
    geo_source = case when rum_session.geo_country is null and excluded.geo_country is not null
                      then excluded.geo_source else rum_session.geo_source end,
    geo_db_version = case when rum_session.geo_country is null and excluded.geo_country is not null
                          then excluded.geo_db_version else rum_session.geo_db_version end,
    context = case when excluded.context <> '{}'::jsonb then excluded.context else rum_session.context end,
    has_error = rum_session.has_error or excluded.has_error
  where rum_session.app_id = excluded.app_id;

  -- 7. Pages vues.
  insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, nav_type, env, release, started_at)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'url', r->>'referrer', r->>'nav_type',
         r->>'env', r->>'release', (r->>'started_at')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'pageviews', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  -- 8. Vitals (`consoliderMetriques` puis `ecrireMetriques`) : une ligne par
  --    (app, session, nom, webvital.id), la plus grande valeur, l'identité
  --    `span_id` du PREMIER rapport ; la position est celle du premier rapport.
  for v_m in select l.r from jsonb_array_elements(coalesce(v_lot->'metrics', '[]'::jsonb)) with ordinality l(r, ord) order by ord
  loop
    if v_m->>'__mk' is null then
      v_metriques := v_metriques || v_m;
      continue;
    end if;
    v_p := (v_positions->>(v_m->>'__mk'))::integer;
    if v_p is null then
      v_metriques := v_metriques || v_m;
      v_positions := v_positions || jsonb_build_object(v_m->>'__mk', cardinality(v_metriques));
      continue;
    end if;
    v_prec := v_metriques[v_p];
    -- `>` de JavaScript : faux dès qu'un côté n'est pas un nombre (NaN).
    v_a := case when jsonb_typeof(v_m->'__mv') in ('number', 'string') then (v_m->>'__mv')::double precision end;
    v_b := case when jsonb_typeof(v_prec->'__mv') in ('number', 'string') then (v_prec->>'__mv')::double precision end;
    if v_a is not null and v_b is not null and v_a > v_b then
      v_metriques[v_p] := v_m || jsonb_build_object('span_id', v_prec->'span_id');
    end if;
  end loop;

  insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, attribution, ts, metric_uid, env, release)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'name', (r->>'value')::double precision,
         r->>'rating', (r->>'attribution')::jsonb, (r->>'ts')::timestamptz, r->>'metric_uid', r->>'env', r->>'release'
    from unnest(v_metriques) with ordinality l(r, ord)
   where r->>'__mk' is not null
   order by ord
  on conflict (session_id, name, metric_uid) where metric_uid is not null do update set
    value  = greatest(rum_metric.value, excluded.value),
    rating = case when excluded.value > rum_metric.value then excluded.rating else rum_metric.rating end,
    ts     = case when excluded.value > rum_metric.value then excluded.ts     else rum_metric.ts     end;

  insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, attribution, ts, metric_uid, env, release)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'name', (r->>'value')::double precision,
         r->>'rating', (r->>'attribution')::jsonb, (r->>'ts')::timestamptz, r->>'metric_uid', r->>'env', r->>'release'
    from unnest(v_metriques) with ordinality l(r, ord)
   where r->>'__mk' is null
   order by ord
  on conflict (span_id) do nothing;

  -- 9. Actions : la racine avant ses enfants.
  insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, context, env, release, ts)
  select r->>'action_id', r->>'span_id', r->>'session_id', r->>'app_id', r->>'type', r->>'name', r->>'route',
         (r->>'context')::jsonb, r->>'env', r->>'release', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'actions', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (action_id) do nothing;

  -- 10. Erreurs (`ecrireErreurs`) : rattachement aux sessions revendiquées qui
  --     existent dans la MÊME application (verrouillées `for key share` jusqu'au
  --     commit), puis l'INSERT ; seules les lignes RÉELLEMENT insérées comptent.
  v_err_recues := jsonb_array_length(coalesce(v_lot->'errors', '[]'::jsonb));
  if v_err_recues > 0 then
    select array_agg(k.app_id), array_agg(k.session_id) into v_c_app, v_c_ses
      from (select s.app_id, s.session_id from rum_session s
             where (s.app_id, s.session_id) in (
                     select l.r->>'__app', l.r->>'__claim'
                       from jsonb_array_elements(v_lot->'errors') l(r)
                      where l.r->>'__claim' is not null and l.r->>'__app' is not null)
            for key share) k;

    with ins as (
      insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, stack, source, lineno, colno,
                             release, fingerprint, occurrences, action_id, trace_id, source_parent_span_id, error_source,
                             handled, is_fatal, context, view_id, view_name, user_id_hash, account_id_hash, env, service,
                             origin_signal, exception_id, symbolication_status, stack_symbolicated, grouping_version,
                             grouping_key, grouping_basis, fingerprint_override_hash, grouping_diagnostic, issue_id, ts)
      select r->>'span_id',
             case when r->>'__claim' is not null then
                    case when exists (select 1 from unnest(v_c_app, v_c_ses) as c(app, ses)
                                       where c.app = r->>'__app' and c.ses = r->>'__claim')
                         then r->>'__claim' end
                  when coalesce((r->>'__claim_nul')::boolean, false) then null
                  else r->>'session_id' end,
             r->>'app_id', r->>'route', r->>'kind', r->>'message', r->>'error_type', r->>'stack', r->>'source',
             (r->>'lineno')::integer, (r->>'colno')::integer, r->>'release', r->>'fingerprint',
             (r->>'occurrences')::integer, r->>'action_id', r->>'trace_id', r->>'source_parent_span_id',
             r->>'error_source', (r->>'handled')::boolean, (r->>'is_fatal')::boolean, (r->>'context')::jsonb,
             r->>'view_id', r->>'view_name', r->>'user_id_hash', r->>'account_id_hash', r->>'env', r->>'service',
             r->>'origin_signal', r->>'exception_id', r->>'symbolication_status', r->>'stack_symbolicated',
             (r->>'grouping_version')::smallint, r->>'grouping_key', r->>'grouping_basis',
             r->>'fingerprint_override_hash', r->>'grouping_diagnostic', (r->>'issue_id')::uuid,
             (r->>'ts')::timestamptz
        from jsonb_array_elements(v_lot->'errors') with ordinality l(r, ord)
       order by ord
      on conflict (span_id) do nothing
      returning 1
    )
    select count(*)::integer into v_err_inserees from ins;
  end if;

  -- 11. Ressources, tâches longues, fils d'Ariane, événements, spans.
  insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, render_blocking,
                            action_id, env, release, ts)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'url', r->>'type',
         (r->>'duration_ms')::double precision, (r->>'transfer_size')::bigint, (r->>'render_blocking')::boolean,
         r->>'action_id', r->>'env', r->>'release', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'resources', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms, render_ms, script_url,
                            script_function, script_ms, invoker, env, release, ts)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', (r->>'duration_ms')::double precision,
         r->>'source', (r->>'blocking_ms')::real, (r->>'render_ms')::real, r->>'script_url', r->>'script_function',
         (r->>'script_ms')::real, r->>'invoker', r->>'env', r->>'release', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'longtasks', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  insert into rum_breadcrumb (span_id, session_id, app_id, route, type, label, seq, action_id, ts)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'type', r->>'label', (r->>'seq')::integer,
         r->>'action_id', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'breadcrumbs', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  insert into rum_event (span_id, session_id, app_id, route, name, props, event_type, context, user_id_hash,
                         account_id_hash, view_id, view_name, action_id, timing_ms, feature_flag_value, env, release, ts)
  select r->>'span_id', r->>'session_id', r->>'app_id', r->>'route', r->>'name', (r->>'props')::jsonb,
         r->>'event_type', (r->>'context')::jsonb, r->>'user_id_hash', r->>'account_id_hash', r->>'view_id',
         r->>'view_name', r->>'action_id', (r->>'timing_ms')::double precision, r->>'feature_flag_value', r->>'env',
         r->>'release', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'events', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  insert into rum_span (span_id, trace_id, parent_span_id, tier, session_id, app_id, route, url, method, status_code,
                        duration_ms, name, kind, action_id, env, release, service, ts)
  select r->>'span_id', r->>'trace_id', r->>'parent_span_id', r->>'tier', r->>'session_id', r->>'app_id', r->>'route',
         r->>'url', r->>'method', (r->>'status_code')::integer, (r->>'duration_ms')::double precision, r->>'name',
         r->>'kind', r->>'action_id', r->>'env', r->>'release', r->>'service', (r->>'ts')::timestamptz
    from jsonb_array_elements(coalesce(v_lot->'spans', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (span_id) do nothing;

  -- 12. Projection `rum_event_index` (`indexAvecVitalsConsolides`) : un vital
  --     reprend l'identité de la ligne canonique qui a survécu au conflit
  --     `metric_uid` ; sans ligne canonique native, il n'est pas projeté.
  for v_e in select l.r from jsonb_array_elements(coalesce(v_lot->'eventIndex', '[]'::jsonb)) with ordinality l(r, ord) order by ord
  loop
    if v_e->>'kind' = 'vital' and v_e->>'source_span_id' is not null then
      select l.r into v_m
        from jsonb_array_elements(coalesce(v_lot->'metrics', '[]'::jsonb)) with ordinality l(r, ord)
       where l.r->>'__ns' = v_e->>'source_span_id'
       order by l.ord desc
       limit 1;
      if found then
        select m.app_id, m.session_id, m.ts, m.route, m.span_id into v_canon
          from rum_metric m
         where m.app_id = v_m->>'app_id' and m.session_id = v_m->>'session_id'
           and m.name = v_m->>'name' and m.metric_uid = v_m->>'metric_uid'
         limit 1;
        if not found or v_canon.span_id is null or v_canon.span_id !~ '^[0-9a-fA-F]{16}$' then
          continue;
        end if;
        -- L'horodatage passait par une `Date` JavaScript : milliseconde tronquée.
        v_e := v_e || jsonb_build_object(
          'app_id', v_canon.app_id,
          'session_id', v_canon.session_id,
          'ts', to_char(date_trunc('milliseconds', v_canon.ts) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'route', v_canon.route,
          'source_span_id', lower(v_canon.span_id));
      end if;
    end if;
    v_index := v_index || v_e;
  end loop;

  insert into rum_event_index (app_id, session_id, ts, route, kind, source_name, source_span_id, event_type, context,
                               user_id_hash, account_id_hash, view_id, view_name, action_id, timing_ms,
                               feature_flag_value, env, release, service)
  select r->>'app_id', r->>'session_id', (r->>'ts')::timestamptz, r->>'route', r->>'kind', r->>'source_name',
         r->>'source_span_id', r->>'event_type', (r->>'context')::jsonb, r->>'user_id_hash', r->>'account_id_hash',
         r->>'view_id', r->>'view_name', r->>'action_id', (r->>'timing_ms')::double precision,
         r->>'feature_flag_value', r->>'env', r->>'release', r->>'service'
    from unnest(v_index) with ordinality l(r, ord)
   order by ord
  on conflict (app_id, kind, source_span_id) do nothing;

  -- 13. Capacités déclarées d'un runtime mobile (P7.5) : jamais `verified_*`.
  insert into mobile_capabilities (app_id, runtime, release, capability, declared)
  select r->>'app_id', r->>'runtime', r->>'release', r->>'capability', (r->>'declared')::boolean
    from jsonb_array_elements(coalesce(v_lot->'capabilities', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord
  on conflict (app_id, runtime, release, capability) do update
     set declared = excluded.declared, last_declared_at = now();

  -- 14. `page_count` DÉRIVÉ du compte réel de pages vues, par application.
  if jsonb_array_length(coalesce(v_lot->'sessions', '[]'::jsonb)) > 0 then
    update rum_session s
       set page_count = sub.c
      from (select app_id, session_id, count(*) c from rum_pageview
             where (app_id, session_id) in (select l.r->>'app_id', l.r->>'session_id'
                                              from jsonb_array_elements(v_lot->'sessions') l(r))
             group by app_id, session_id) sub
     where s.app_id = sub.app_id and s.session_id = sub.session_id;
  end if;

  -- 15. L'échéance, juste avant le COMMIT implicite : une écriture qui la dépasse
  --     n'est jamais validée.
  if v_fin is not null and clock_timestamp() > v_fin then
    raise exception 'échéance de la requête atteinte (écriture)' using errcode = '57014';
  end if;

  v_sortie := jsonb_build_object(
    'erreurs', jsonb_build_object('recues', v_err_recues, 'inserees', v_err_inserees, 'ignorees', 0),
    'mesure', jsonb_build_object(
      'attente_ms', round((extract(epoch from (v_t1 - v_t0)) * 1000)::numeric, 3),
      'travail_ms', round((extract(epoch from (clock_timestamp() - v_t1)) * 1000)::numeric, 3)));
  if v_lot ? 'logs' then
    v_sortie := v_sortie || jsonb_build_object('logs', jsonb_array_length(coalesce(v_lot->'logs', '[]'::jsonb)));
  end if;
  if v_total > 0 then
    v_sortie := v_sortie || jsonb_build_object('refuses', v_refuses);
  end if;
  return v_sortie;
end
$fn$;

comment on function mip_ingerer_lot_v2(text[], jsonb, jsonb) is
  'Collecte en un aller-retour (v111) : mip_ingerer_lot_v1 (v109) à l''identique, sauf les logs, écrits '
  'avec leur clé naturelle log_uid et `on conflict do nothing` (idempotents au rejeu). Même sémantique '
  'que writeRows / writeLogs (packages/backend/lib/pg-ingest.mjs). MIP01 : portée ; MIP02 : repli historique.';

do $$
begin
  execute 'revoke execute on function public.mip_ingerer_lot_v2(text[], jsonb, jsonb) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.mip_ingerer_lot_v2(text[], jsonb, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.mip_ingerer_lot_v2(text[], jsonb, jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    execute 'revoke execute on function public.mip_ingerer_lot_v2(text[], jsonb, jsonb) from console_ro';
  end if;
end $$;

-- ── 2. `refresh_rum_rollups` : sans robots, joint dans l'application ────────
--
-- Les heures que l'ancienne définition a agrégées sont marquées UNE FOIS, avant
-- de la remplacer : tant que la fonction en service n'est pas celle de v111.
-- Rejouer le fichier ne remarque donc rien (les tests rejouent toute la chaîne).
-- 35 jours : la borne du filigrane de v102, au-delà de la rétention ordinaire.
do $$
declare
  src text;
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'refresh_rum_rollups' and p.pronargs = 1;
  if src is not null and position('v111' in src) = 0 then
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select distinct 'rum_rollup_hourly', r.app_id, r.hour, 'v111_population'
      from rum_rollup_hourly r
     where r.hour >= date_trunc('hour', now()) - interval '35 days'
    on conflict (source, app_id, hour) do nothing;
  end if;
end $$;

-- La définition de v102, à trois prédicats près : la session est jointe sur
-- `(app_id, session_id)` et une ligne de robot n'entre dans aucune somme. Une
-- ligne sans session connue reste comptée (classe d'appareil inconnue), comme
-- dans `metric_histogram_hourly`.
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
  -- v111 : population sans robots, sessions jointes dans leur application.
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

  select coalesce(array_agg(distinct date_trunc('hour', e.ts)), '{}')
    into v_tardives
    from rum_error e
   where e.ingested_at >= v_lo and e.ts < v_lo;

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
    left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
    where m.name = any(mip_core_vitals()) and not coalesce(s.is_bot, false)
    group by 1, 2, 3
    union all
    select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
           0::float, 0::float, count(*)::bigint, 0::bigint
    from cibles c
    join rum_pageview p on p.started_at >= c.debut and p.started_at < c.fin
    left join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
    where not coalesce(s.is_bot, false)
    group by 1, 2, 3
    union all
    select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
           0::float, 0::float, 0::bigint, coalesce(sum(e.occurrences), 0)::bigint
    from cibles c
    join rum_error e on e.ts >= c.debut and e.ts < c.fin
    left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id
    where not coalesce(s.is_bot, false)
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

  delete from analytics_rollup_invalidation
   where source = 'rum_rollup_hourly'
     and (hour >= v_lo or hour = any(v_tardives));

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
  'entier (v102). Population (v111) : sans robots, sessions jointes sur (app_id, session_id). '
  'Avance le filigrane.';

-- ── 3. `purge_rum_app` : la garde morte sur `pageview_id` ───────────────────
--
-- Même geste que v97 : la définition courante est relue et seule la garde est
-- retirée. Rejouer le fichier ne fait rien (garde déjà absente).
do $$
declare
  src     text;
  garde   constant text :=
    E'\n     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)'
    || E'\n     and not exists (select 1 from rum_error e where e.pageview_id = p.id);';
  sans    constant text := ';';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'purge_rum_app'
     and p.pronargs = 2 and p.proargtypes[0] = 'text'::regtype and p.proargtypes[1] = 'timestamptz'::regtype;
  if src is null then
    raise exception 'v111: purge_rum_app(text, timestamptz) introuvable — appliquer v82 d''abord';
  end if;
  if position(garde in src) = 0 then
    return;
  end if;
  if (length(src) - length(replace(src, garde, ''))) / length(garde) <> 1 then
    raise exception 'v111: garde pageview_id ambiguë dans purge_rum_app';
  end if;
  -- Une référence encore posée ferait échouer la suppression sur la clé
  -- étrangère : la garde reste alors, et on le dit.
  if exists (select 1 from rum_metric where pageview_id is not null)
     or exists (select 1 from rum_error where pageview_id is not null) then
    raise notice 'v111: des lignes portent encore pageview_id — garde de purge CONSERVÉE';
    return;
  end if;
  execute 'create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz) returns jsonb language plpgsql as '
       || quote_literal(replace(src, garde, sans));
  -- Dans le bloc : si la garde est conservée, rien de ceci ne doit être affirmé.
  comment on function purge_rum_app(text, timestamptz) is
    'Rétention par application. Ne touche NI privacy_erasure_barrier NI privacy_erasure_request : '
    'une barrière n''est pas une observation datée. Ne prend pas le verrou d''ingestion : elle ne '
    'supprime que des lignes antérieures à sa coupure. Depuis v97, purge aussi uptime_result '
    '(historique des sondes des checks de l''application). Depuis v111, une page vue n''est plus gardée '
    'par pageview_id, qu''aucune écriture ne renseigne.';
  comment on column rum_metric.pageview_id is
    'Jamais renseignée par l''ingestion (v111) : un vital ne se rattache pas à SA page vue. Conservée pour '
    'ne pas modifier la table ; la purge ne la lit plus.';
  comment on column rum_error.pageview_id is
    'Jamais renseignée par l''ingestion (v111) : une erreur ne se rattache pas à SA page vue (v94). '
    'Conservée pour ne pas modifier la table ; la purge ne la lit plus.';
end $$;

-- ── 4. RLS sur `alert_config` ───────────────────────────────────────────────
alter table alert_config enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro')
     and not exists (select 1 from pg_policy where polrelid = 'public.alert_config'::regclass
                                                and polname = 'console_ro_lecture') then
    create policy console_ro_lecture on alert_config as permissive for select to console_ro using (true);
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on alert_config from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on alert_config from authenticated;
  end if;
end $$;
