-- migration-v109 — Collecte : l'écriture d'un lot en UN aller-retour SQL (06/10/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. v108 (escalade des alertes) est le
-- fichier précédent. Aucune table existante n'est modifiée, aucune donnée ne bouge.
--
-- POURQUOI. Le banc du 24/09/2026 (`docs/operations/banc-collecteur-2026-09-24.md`)
-- a montré que l'écriture d'un lot de traces coûte 18 allers-retours SQL dans la
-- transaction, dont 15 SOUS le verrou consultatif de l'application (v81). À ~10 ms
-- par aller-retour (Railway Amsterdam ↔ Neon Francfort), le verrou est tenu
-- ≈ 150-170 ms par lot : le plafond d'une application tombe à ≈ 0,58 lot/s pour
-- tenir le critère de P2 (30 % d'utilisation à 3 fois le pic). Plus de 90 % de
-- cette tenue est de l'attente réseau.
--
-- CE QUI CHANGE. Trois choses, toutes nouvelles :
--   1. `mip_ingerer_lot_v1(apps, lot, options)` : prend le verrou des
--      applications du lot, lit les barrières d'effacement, filtre le lot (les deux
--      passes de `filtrerLot`), contrôle la portée des sessions, puis écrit TOUTES
--      les tables du lot (sessions, pages vues, vitals consolidés, actions,
--      erreurs, ressources, tâches longues, fils d'Ariane, événements, spans,
--      projection `rum_event_index`, capacités mobiles, logs) et recompte
--      `page_count`. Appelée SEULE, hors transaction explicite, elle forme à elle
--      seule la transaction : un aller-retour, et le verrou est pris et rendu sans
--      qu'aucune attente réseau ne s'intercale.
--   2. `mip_ecrire_rejeu_v1(...)` : le chunk de rejeu, même règle (barrière de
--      session, ancre manquante sous `enforce`, portée), en un aller-retour.
--   3. Le drapeau `platform_flag.ingest_un_aller_retour_pct` (0 à 100), qui naît à
--      '0' : appliquer ce fichier ne change RIEN au comportement du collector.
--
-- LA SÉMANTIQUE EST CELLE DU CHEMIN HISTORIQUE, À LA LIGNE PRÈS. Le JavaScript
-- (`packages/backend/lib/ingest-un-ar.mjs`) prépare chaque ligne EXACTEMENT comme
-- l'ancien chemin la passait en paramètre : mêmes transformations (`context`
-- sérialisé, `started_at`, `page_count`…), puis `prepareValue` du pilote `pg` —
-- la fonction qui convertit un paramètre JavaScript en texte. Chaque colonne
-- est donc relue ici par `->>` puis convertie par la fonction d'entrée de son
-- type, exactement ce que faisait le paramètre lié. Ce qui demande le TYPE
-- JavaScript (une chaîne non vide pour les barrières, la clé de consolidation
-- d'un vital, sa valeur numérique) voyage à côté, dans des champs `__x` calculés
-- par le JavaScript : ils ne correspondent à aucune colonne.
--
-- CE QUI RESTE EN JAVASCRIPT, HORS VERROU, comme avant : la symbolication des
-- erreurs, la clé de regroupement v2 en ombre (`errorGrouping`), le hachage
-- d'identité, le compteur de débit `rate_check`.
--
-- CE QUE LA FONCTION NE FAIT PAS : le regroupement v2 ACTIF (issues, alias,
-- régression). Une application dont `error_grouping_config.active_version = 2`
-- fait lever `MIP02` à la fonction, qui n'a encore rien écrit ; le JavaScript
-- rejoue alors le lot par le chemin historique. Même chose si la configuration
-- de regroupement a changé depuis sa lecture (la clé en ombre serait périmée).
--
-- LES DEUX ERREURS PROPRES :
--   · `MIP01` — portée d'application (une session déjà enregistrée sous une autre
--     application, ou une session de rejeu dans ce cas) : `ErreurPorteeApp`, 409 ;
--   · `MIP02` — regroupement v2 actif ou configuration changée : repli historique.
-- Le verrou indisponible reste `55P03` (lock_timeout), l'échéance `57014`.
--
-- L'ÉCHÉANCE (P2). L'ancien chemin posait `statement_timeout` et
-- `transaction_timeout` au budget restant. Une instruction unique ne peut pas
-- borner sa propre durée par ces réglages : `options.restant_ms` fixe donc une
-- échéance SERVEUR, vérifiée après le verrou et juste avant de rendre la main —
-- donc juste avant le COMMIT implicite. Une écriture qui finit après l'échéance
-- lève `57014` et n'est jamais validée. `lock_timeout` reste posé (set_config
-- local) avant la prise du verrou, comme avant.
--
-- RETOUR ARRIÈRE : `update platform_flag set value = '0' where key =
-- 'ingest_un_aller_retour_pct'` (effet < 30 s, sans redéploiement). Les deux
-- fonctions peuvent rester en base : rien ne les appelle à 0 %.
--
-- DROITS. SECURITY INVOKER : la fonction écrit avec les droits de l'appelant,
-- comme les requêtes qu'elle remplace. EXECUTE retiré à PUBLIC, `anon`,
-- `authenticated` et `console_ro` : seul le propriétaire (le collector) l'appelle.
--
-- VERROUS. Création de fonctions et d'une ligne de drapeau : aucune table chaude
-- n'est verrouillée. Au rejeu, `drop/add constraint` prend un ACCESS EXCLUSIVE
-- bref sur `platform_flag`.
set local lock_timeout = '3s';

-- ── 1. Le drapeau ─────────────────────────────────────────────────────────────
-- Même contrainte que `ingest_relay_pct` (v87) : un entier de 0 à 100, sans signe
-- ni « % ». Une valeur que le code refuserait le ferait retomber sur 0 en
-- silence ; le refus de l'`update` se voit sur le moment.
alter table platform_flag
  drop constraint if exists platform_flag_ingest_un_ar_pct_v109,
  add constraint platform_flag_ingest_un_ar_pct_v109 check (
    key <> 'ingest_un_aller_retour_pct' or value ~ '^(100|[1-9]?[0-9])$'
  );

-- Naît à '0' et n'est JAMAIS réécrite par un rejeu : rejouer la migration ne doit
-- ni relancer une montée coupée, ni couper une montée en cours.
insert into platform_flag (key, value, updated_by)
values ('ingest_un_aller_retour_pct', '0', 'migration-v109')
on conflict (key) do nothing;

-- ── 2. L'écriture d'un lot de traces ou de logs ──────────────────────────────
create or replace function mip_ingerer_lot_v1(p_apps text[], p_lot jsonb, p_options jsonb default '{}'::jsonb)
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

  -- 5. Logs (`writeLogsWithClient`) : avant les erreurs qu'ils portent.
  insert into rum_log (app_id, ts, severity_num, severity_text, body, source, trace_id, span_id, session_id, route, attributes)
  select r->>'app_id', (r->>'ts')::timestamptz, (r->>'severity_num')::smallint, r->>'severity_text', r->>'body',
         r->>'source', r->>'trace_id', r->>'span_id', r->>'session_id', r->>'route', (r->>'attributes')::jsonb
    from jsonb_array_elements(coalesce(v_lot->'logs', '[]'::jsonb)) with ordinality l(r, ord)
   order by ord;

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

comment on function mip_ingerer_lot_v1(text[], jsonb, jsonb) is
  'Collecte en un aller-retour (v109) : verrou des applications, barrières d''effacement, portée, '
  'écriture de toutes les tables d''un lot de traces ou de logs. Même sémantique que writeRows / '
  'writeLogs (packages/backend/lib/pg-ingest.mjs). MIP01 : portée ; MIP02 : repli historique.';

-- La passe 2 de `filtrerLot`, pour UNE ligne : refusée si son application a une
-- barrière qui vise son identité, son compte ou son visiteur, ou si sa session est
-- au nombre des sessions refusées. Chaque comparaison porte sur une chaîne non
-- vide (`__x`) : un `Set.has` de JavaScript ne reconnaît qu'une chaîne.
create or replace function mip_ingest_refuse_v1(p_r jsonb, p_b_app text[], p_b_kind text[], p_b_key text[],
                                                p_s_app text[], p_s_ses text[])
  returns boolean
  language sql immutable parallel safe
  set search_path = public, pg_temp
as $fn$
  select exists (select 1 from unnest(p_b_app, p_b_kind, p_b_key) as b(app, kind, cle)
                  where b.app = p_r->>'__app'
                    and ((b.kind = 'user' and b.cle = p_r->>'__u')
                      or (b.kind = 'account' and b.cle = p_r->>'__a')
                      or (b.kind = 'visitor' and b.cle = p_r->>'__v')))
      or (p_r->>'__s' is not null
          and exists (select 1 from unnest(p_s_app, p_s_ses) as s(app, ses)
                       where s.app = p_r->>'__app' and s.ses = p_r->>'__s'))
$fn$;

-- ── 3. Le chunk de rejeu ──────────────────────────────────────────────────────
create or replace function mip_ecrire_rejeu_v1(p_app text, p_session text, p_seq integer, p_events integer,
                                               p_body bytea, p_options jsonb default '{}'::jsonb)
  returns jsonb
  language plpgsql
  set search_path = public, pg_temp
as $fn$
declare
  v_lock_ms    integer := (p_options->>'lock_timeout_ms')::integer;
  v_restant_ms integer := (p_options->>'restant_ms')::integer;
  v_fin        timestamptz;
  v_proprio    text;
  v_connue     boolean;
  v_sortie     jsonb;
begin
  if v_restant_ms is not null then
    v_fin := statement_timestamp() + v_restant_ms * interval '1 millisecond';
  end if;
  if v_lock_ms is not null then
    perform set_config('lock_timeout', v_lock_ms::text || 'ms', true);
  end if;
  if p_app is not null and p_app <> '' then
    perform mip_verrouiller_apps(array[p_app]);
  end if;
  if v_fin is not null and clock_timestamp() > v_fin then
    raise exception 'échéance de la requête atteinte (verrou)' using errcode = '57014';
  end if;

  if exists (select 1 from privacy_erasure_barrier
              where app_id = p_app and subject_kind = 'session' and subject_key = p_session
                and (expires_at is null or expires_at > now())) then
    v_sortie := jsonb_build_object('etat', 'refus_barriere');
  else
    select app_id into v_proprio from rum_session where session_id = p_session;
    v_connue := found;
    if v_connue and v_proprio is distinct from p_app then
      raise exception using errcode = 'MIP01',
        message = format('session de rejeu déjà enregistrée pour « %s », revendiquée par « %s »',
                         coalesce(v_proprio, 'null'), p_app);
    end if;
    if not v_connue and (select privacy_barrier_mode from app_registry where app_id = p_app) = 'enforce' then
      v_sortie := jsonb_build_object('etat', 'attente_session', 'retryAfterS', 5);
    else
      if not v_connue then
        insert into rum_session (session_id, app_id) values (p_session, p_app)
          on conflict (session_id) do nothing;
      end if;
      insert into replay_chunk (session_id, app_id, seq, events_count, body)
        values (p_session, p_app, p_seq, p_events, p_body)
        on conflict (session_id, seq) do nothing;
      v_sortie := jsonb_build_object('etat', 'ecrit');
    end if;
  end if;

  if v_fin is not null and clock_timestamp() > v_fin then
    raise exception 'échéance de la requête atteinte (écriture)' using errcode = '57014';
  end if;
  return v_sortie;
end
$fn$;

comment on function mip_ecrire_rejeu_v1(text, text, integer, integer, bytea, jsonb) is
  'Chunk de rejeu en un aller-retour (v109) : même règle que writeReplayChunk (barrière de session, '
  'ancre manquante sous enforce, portée MIP01).';

do $$
declare f text;
begin
  foreach f in array array[
    'public.mip_ingerer_lot_v1(text[], jsonb, jsonb)',
    'public.mip_ingest_refuse_v1(jsonb, text[], text[], text[], text[], text[])',
    'public.mip_ecrire_rejeu_v1(text, text, integer, integer, bytea, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'console_ro') then
      execute format('revoke execute on function %s from console_ro', f);
    end if;
  end loop;
end $$;
