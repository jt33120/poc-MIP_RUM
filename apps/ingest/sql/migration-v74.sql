-- migration-v74 — P5.6, suivi de revue : notifications et régressions robustes aux
-- releases longues, verrou d'issue compatible avec les clés étrangères, lignes
-- d'issue sans notification rendues au watermark, baseline d'une issue non suivie.
--
-- Additive et rejouable, PostgreSQL 15 à 17. S'applique APRÈS migration-v73 et
-- refuse de s'appliquer sans elle. Aucune table ni donnée modifiée : quatre
-- fonctions redéfinies (`create or replace`, droits et déclencheurs conservés).
-- migration-v73 reste telle que publiée : le migrateur ne rejoue pas un fichier
-- déjà appliqué, une correction ne peut donc vivre que dans un fichier suivant.
--
--   1. error_issue_notify_new_v73() — `mip.release` arrive brut de l'émetteur,
--      sans borne. Recopiée deux fois dans la charge (4 096 octets au plus), une
--      release de quelque 2 000 caractères faisait échouer l'insertion de l'issue,
--      donc tout le lot OTLP qui la créait, à chaque rejeu. Une release qui n'est
--      pas un nom court (1 à 200 octets, sans caractère de contrôle) n'est plus
--      recopiée : la notification part sans elle.
--   2. error_issue_record_occurrences() —
--      • `for no key update` au lieu de `for update`. Les insertions d'alias, de
--        notes reprises et de pics posent un verrou KEY SHARE sur l'issue (clé
--        étrangère) ; `for update` l'attendait. Deux lots dont l'un ajoute un alias
--        à X puis met à jour W, l'autre met à jour W puis verrouille X,
--        s'interbloquaient (40P01). `for no key update` n'attend plus ces verrous
--        et sérialise toujours deux écrivains de la même issue entre eux.
--      • Une régression n'est confirmée qu'avec des releases de 1 à 200 octets et
--        un env de 1 à 120, sans caractère de contrôle : l'activité refuserait
--        les autres et annulerait le lot de l'écrivain. Sinon, réapparition à
--        vérifier, comme pour une release sans marqueur.
--   3. check_new_errors() — v73 écartait toute ligne rattachée à une issue. Une
--      issue née avant v73 n'a pas de notification `new` : ses lignes ingérées
--      entre le dernier passage horaire et la migration n'étaient notifiées par
--      personne. N'est plus écartée que la ligne d'une issue qui A sa notification
--      `new` ; les autres suivent le watermark historique, exactement comme en v64.
--   4. issue_metric_baseline() — `greatest` ignore NULL : pour une issue non
--      observable, la seule borne de rétention ouvrait des fenêtres dites
--      comparables, remplies de zéros qu'aucune observation ne prouvait.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.error_issue_notification') is null then
    raise exception 'v74 : migration-v73 (error_issue_notification) doit être appliquée avant ce fichier';
  end if;
end $$;

-- ── 1. Notification d'une nouvelle issue ────────────────────────────────────
create or replace function error_issue_notify_new_v73() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version_courte text := case
    when octet_length(new.first_release) between 1 and 200 and new.first_release !~ '[[:cntrl:]]'
      then new.first_release
  end;
begin
  insert into error_issue_notification (app_id, issue_id, kind, event_key, payload)
  values (
    new.app_id, new.id, 'new', 'new:' || new.id,
    jsonb_build_object(
      'source', 'mip-rum', 'kind', 'new', 'app_id', new.app_id, 'issue_id', new.id,
      'first_release', version_courte, 'severity', 'warning',
      'text', format('[MIP RUM] Nouvelle issue dans %s%s — /errors/issues/%s?app=%s',
                     new.app_id, coalesce(', release ' || version_courte, ''), new.id, new.app_id))
  )
  on conflict (event_key) do nothing;
  return null;
end $$;

-- ── 2. Régression, dans la transaction de l'écrivain ────────────────────────
create or replace function error_issue_record_occurrences(
  p_app_id text, p_issue_id uuid, p_ts timestamptz[], p_releases text[], p_envs text[]
) returns text
language plpgsql as $$
declare
  i record;
  confirmee record;
  cle text;
begin
  select id, resolved_at, resolved_release, resolved_env
    into i
    from error_issue
   where app_id = p_app_id and id = p_issue_id and status = 'resolved'
   for no key update;
  if not found or i.resolved_at is null then
    return null;
  end if;
  if not exists (select 1 from unnest(p_ts) as t (ts) where t.ts > i.resolved_at) then
    return null;
  end if;
  -- Une référence qui ne tiendrait pas dans l'activité ne confirme rien.
  if not (octet_length(i.resolved_release) between 1 and 200 and i.resolved_release !~ '[[:cntrl:]]'
          and octet_length(i.resolved_env) between 1 and 120 and i.resolved_env !~ '[[:cntrl:]]') then
    return 'reappearance';
  end if;

  select o.release, o.ts
    into confirmee
    from unnest(p_ts, p_releases, p_envs) as o (ts, release, env)
    cross join lateral (
      select min(m.ts) as deployed_at
        from deploy_marker m
       where m.app_id = p_app_id and m.env = i.resolved_env and m.version = o.release
    ) occ
   where o.ts > i.resolved_at
     and o.env = i.resolved_env
     and octet_length(o.release) between 1 and 200 and o.release !~ '[[:cntrl:]]'
     and occ.deployed_at > (
       select min(m.ts) from deploy_marker m
        where m.app_id = p_app_id and m.env = i.resolved_env and m.version = i.resolved_release
     )
   order by occ.deployed_at desc, o.ts
   limit 1;
  if not found then
    return 'reappearance';
  end if;

  cle := 'regression:' || (extract(epoch from i.resolved_at) * 1000000)::bigint;
  update error_issue
     set status = 'open', status_source = 'system',
         resolved_at = null, resolved_by_user_id = null, resolved_release = null, resolved_env = null,
         revision = revision + 1, updated_at = now()
   where app_id = p_app_id and id = p_issue_id;
  insert into error_issue_activity
    (app_id, issue_id, kind, actor_kind, old_status, new_status, release, reference_release, env, event_key)
  values
    (p_app_id, p_issue_id, 'regression', 'system', 'resolved', 'open',
     confirmee.release, i.resolved_release, i.resolved_env, cle)
  on conflict (app_id, issue_id, event_key) where event_key is not null do nothing;
  insert into error_issue_notification (app_id, issue_id, kind, event_key, payload)
  values (
    p_app_id, p_issue_id, 'regression', cle || ':' || p_issue_id,
    jsonb_build_object(
      'source', 'mip-rum', 'kind', 'regression', 'app_id', p_app_id, 'issue_id', p_issue_id,
      'release', confirmee.release, 'reference_release', i.resolved_release, 'env', i.resolved_env,
      'severity', 'warning',
      'text', format('[MIP RUM] Régression confirmée dans %s : release %s déployée après %s (env %s) — /errors/issues/%s?app=%s',
                     p_app_id, confirmee.release, i.resolved_release, i.resolved_env, p_issue_id, p_app_id))
  )
  on conflict (event_key) do nothing;
  return 'regression';
end $$;

-- ── 3. Nouvelles erreurs historiques ────────────────────────────────────────
-- Reprise intégrale de migration-v73 ; seule différence : la ligne d'une issue
-- n'est écartée que si l'outbox porte la notification `new` de cette issue.
create or replace function check_new_errors() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  cursor_row record;
  upper_bound record;
  a record;
  fired int := 0;
  ev_id bigint;
  msg text;
  stable text;
begin
  select last_ingested_at, last_error_id
    into cursor_row
    from rum_new_error_watermark
   where singleton = true
   for update;

  select e.ingested_at, e.id into upper_bound
    from rum_error e
   where (e.ingested_at, e.id) > (cursor_row.last_ingested_at, cursor_row.last_error_id)
   order by e.ingested_at desc, e.id desc
   limit 1;

  if not found then
    return 0;
  end if;

  for a in
    select e.app_id, e.fingerprint,
           max(e.error_type) as error_type,
           max(e.message) as sample,
           min(e.ts) as first_seen,
           coalesce(sum(e.occurrences), 0)::bigint as occurrences
      from rum_error e
     where e.fingerprint is not null
       and not exists (
         select 1 from error_issue_notification n
          where n.event_key = 'new:' || e.issue_id
       )
       and (e.ingested_at, e.id) > (cursor_row.last_ingested_at, cursor_row.last_error_id)
       and (e.ingested_at, e.id) <= (upper_bound.ingested_at, upper_bound.id)
       and not exists (
         select 1
           from rum_error seen
          where seen.app_id = e.app_id
            and seen.fingerprint = e.fingerprint
            and (seen.ingested_at, seen.id) <= (cursor_row.last_ingested_at, cursor_row.last_error_id)
       )
     group by e.app_id, e.fingerprint
  loop
    stable := format('nouvelle erreur %s / app %s', a.fingerprint, a.app_id);
    msg := format('%s — %s « %s » (%s occurrence(s) depuis %s)',
      stable, coalesce(a.error_type, 'Error'), left(coalesce(a.sample, ''), 120), a.occurrences,
      to_char(a.first_seen, 'HH24:MI'));

    if not exists (
      select 1 from alert_event ae
       where ae.rule_id is null and ae.slo_id is null
         and ae.message like '%' || stable || '%'
         and ae.fired_at > now() - interval '24 hours'
    ) then
      insert into alert_event (rule_id, slo_id, value, message, severity)
      values (null, null, a.occurrences, msg, 'warning')
      returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, a.app_id, 'warning', '[MIP RUM] ' || msg,
        jsonb_build_object('source', 'mip-rum', 'kind', 'new_error', 'app_id', a.app_id,
          'fingerprint', a.fingerprint, 'error_type', a.error_type,
          'occurrences', a.occurrences, 'text', msg));
    end if;
  end loop;

  update rum_new_error_watermark
     set last_ingested_at = upper_bound.ingested_at,
         last_error_id = upper_bound.id
   where singleton = true;
  return fired;
end $function$;

-- ── 4. Baseline d'une issue ─────────────────────────────────────────────────
create or replace function issue_metric_baseline(
  p_app_id text, p_issue_id uuid, p_route text, p_env text, p_weeks integer, p_window_minutes integer
) returns table (med double precision, mad double precision, n integer)
language sql stable set search_path = public, pg_temp as $$
  with suivi as (
    select issue_metric_observable_since(p_app_id, p_issue_id) as depuis
  ), bornes as (
    -- Non suivie : aucune borne, donc aucune fenêtre comparable.
    select case when suivi.depuis is not null then greatest(
             suivi.depuis,
             now() - make_interval(days => greatest(coalesce(
               (select retention_days from app_registry where app_id = p_app_id), 30), 1))
           ) end as depuis
      from suivi
  ), anchors as (
    select now() - make_interval(weeks => g) as hi
      from generate_series(1, greatest(p_weeks, 1)) g, bornes
     where now() - make_interval(weeks => g) - make_interval(mins => greatest(p_window_minutes, 1)) >= bornes.depuis
  ), samples as (
    select w.occurrences as val
      from anchors a
     cross join lateral issue_metric_window(
       p_app_id, p_issue_id, p_route, p_env, a.hi - make_interval(mins => greatest(p_window_minutes, 1)), a.hi) w
  ), m as (
    select percentile_cont(0.5) within group (order by val) v from samples
  )
  select (select v from m),
         percentile_cont(0.5) within group (order by abs(val - (select v from m))),
         count(*)::int
    from samples
$$;
