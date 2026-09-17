-- migration-v72 — P5.5 : regroupement d'erreurs versionné et identité d'issue.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucun backfill, aucune réécriture
-- de l'historique : `fingerprint` et `error_status` restent intacts et continuent
-- d'alimenter la liste historique, le watermark de check_new_errors (v64) et le
-- triage existant.
--
--   1. error_grouping_config : activation du regroupement v2 PAR APP et chemins
--      tiers propres à l'app (chaînes littérales bornées, jamais une regex).
--   2. error_issue : identité durable (app, version, clé) d'un problème, avec son
--      cycle de vie. Aucun message, aucune stack, aucune identité RUM : un effacement
--      DSAR n'y laisse rien en cache.
--   3. error_issue_alias : correspondance ancien groupe → issue(s). Un groupe
--      historique peut se répartir sur plusieurs issues ; aucune bijection supposée.
--   4. RLS et droits de lecture des trois tables.
--   5. rum_error : clé v2 calculée EN OMBRE sur toute nouvelle occurrence, issue
--      attribuée seulement dans une app activée.
--   6. Fonctions d'exploitation : activation, retour arrière, statistiques de
--      scissions et de fusions.
--   7. Rétention et effacement des nouvelles tables.
--
-- FENÊTRE DE DÉPLOIEMENT. Le code P5.5 publié avant ce fichier détecte l'absence
-- des colonnes : il écrit et lit comme P5.3. Le code antérieur encore en service
-- après ce fichier écrit des lignes sans clé v2 : elles restent lisibles comme
-- groupes historiques, sans issue.
--
-- INDEX. L'initialisation d'une issue depuis ses groupes historiques lit la
-- première et la dernière occurrence de chaque empreinte touchée : deux lectures
-- bornées sur (app_id, fingerprint, ts), au lieu d'un parcours de tout le groupe
-- dans une transaction d'ingestion. Sur une base volumineuse, précréer l'index
-- avec `predeploy-v72-indexes.sql` (CONCURRENTLY, hors transaction) : ce fichier
-- refuse un build bloquant au-delà de 32 Mio, comme v68.
--
-- VERROUS. `alter table rum_error` prend un ACCESS EXCLUSIVE jusqu'au commit : il
-- vient après les tables neuves, suivi seulement de créations de fonctions, et
-- `lock_timeout` borne chaque attente. S'il expire, le fichier entier est annulé
-- et le déploiement rejoué.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.idx_rum_error_fingerprint_ts_v72') is null
     and pg_total_relation_size('public.rum_error') > 33554432 then
    raise exception 'v72: précréer idx_rum_error_fingerprint_ts_v72 avec predeploy-v72-indexes.sql';
  end if;
end $$;

-- ── 1. Configuration par app ────────────────────────────────────────────────
-- Fonction immuable : une contrainte CHECK ne peut pas contenir de sous-requête.
create or replace function mip_error_vendor_paths_valides(p_paths text[]) returns boolean
language sql immutable as $$
  select cardinality(p_paths) <= 32 and not exists (
    select 1 from unnest(p_paths) as chemin
     where chemin is null or char_length(chemin) not between 1 and 200 or chemin ~ '[[:cntrl:]]'
  )
$$;

create table if not exists error_grouping_config (
  app_id          text primary key references app_registry (app_id) on delete cascade,
  active_version  smallint,
  vendor_paths    text[] not null default '{}',
  activated_at    timestamptz,
  activated_by    text,
  deactivated_at  timestamptz,
  deactivated_by  text,
  updated_at      timestamptz not null default now(),
  constraint error_grouping_config_v72 check (
    (active_version is null or active_version = 2) and
    mip_error_vendor_paths_valides(vendor_paths) and
    (activated_by is null or char_length(activated_by) between 1 and 320) and
    (deactivated_by is null or char_length(deactivated_by) between 1 and 320)
  )
);

comment on table error_grouping_config is
  'Regroupement d''erreurs par app : version active (NULL = liste historique) et chemins de frames tierces';
comment on column error_grouping_config.active_version is
  'NULL : issues non attribuées (clé v2 calculée en ombre seulement) ; 2 : nouvelles occurrences rattachées à une issue';
comment on column error_grouping_config.vendor_paths is
  'Marqueurs de chemin tiers propres à l''app, cherchés tels quels (32 au plus, 200 caractères), jamais une expression régulière';

-- ── 2. Issues ───────────────────────────────────────────────────────────────
create table if not exists error_issue (
  id                   uuid primary key default gen_random_uuid(),
  app_id               text not null,
  grouping_version     smallint not null,
  grouping_key         text not null,
  grouping_basis       text not null,
  origin               text not null,
  status               text not null default 'open',
  status_source        text not null default 'system',
  first_seen           timestamptz not null,
  last_seen            timestamptz not null,
  first_release        text,
  last_release         text,
  resolved_at          timestamptz,
  resolved_by_user_id  bigint references console_user (id) on delete set null,
  resolved_release     text,
  resolved_env         text,
  assignee_user_id     bigint references console_user (id) on delete set null,
  revision             bigint not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint error_issue_identite_v72 unique (app_id, grouping_version, grouping_key),
  constraint error_issue_app_id_v72 unique (app_id, id),
  constraint error_issue_v72 check (
    grouping_version = 2 and grouping_key ~ '^[0-9a-f]{32}$' and
    grouping_basis in ('override', 'symbolicated_frame', 'normalized_frame', 'low_confidence') and
    origin in ('new', 'migration') and
    status in ('open', 'for_review', 'resolved', 'ignored') and
    status_source in ('system', 'migration', 'user') and
    first_seen <= last_seen and revision >= 1 and
    (resolved_env is null or char_length(resolved_env) <= 120)
  )
);

comment on table error_issue is
  'Identité durable d''un problème (app, version, clé de regroupement) et son cycle de vie ; '
  'les statistiques d''une fenêtre se recalculent sur rum_error, jamais ici';
comment on column error_issue.origin is
  'new : aucune empreinte historique antérieure ; migration : clé v2 recouvrant un groupe historique déjà vu (jamais « nouveau bug »)';
comment on column error_issue.status_source is
  'system : statut initial ; migration : dérivé des groupes historiques (divergence = for_review) ; user : décision humaine, jamais redérivée';
comment on column error_issue.revision is
  'Concurrence optimiste des décisions humaines ; les mises à jour de première et dernière vue ne l''incrémentent pas';

-- ── 3. Alias des groupes historiques ────────────────────────────────────────
create table if not exists error_issue_alias (
  app_id              text not null,
  legacy_fingerprint  text not null,
  issue_id            uuid not null,
  legacy_status       text,
  legacy_resolved_at  timestamptz,
  created_at          timestamptz not null default now(),
  primary key (app_id, legacy_fingerprint, issue_id),
  constraint error_issue_alias_issue_v72 foreign key (app_id, issue_id)
    references error_issue (app_id, id) on delete cascade,
  constraint error_issue_alias_v72 check (
    char_length(legacy_fingerprint) between 1 and 64 and
    (legacy_status is null or legacy_status in ('open', 'resolved', 'ignored'))
  )
);

create index if not exists idx_error_issue_alias_issue_v72 on error_issue_alias (app_id, issue_id);

comment on column error_issue_alias.legacy_status is
  'Statut du groupe historique au rattachement (trace d''une divergence) ; NULL si l''empreinte n''avait aucune occurrence antérieure';

-- ── 4. RLS et droits ────────────────────────────────────────────────────────
-- Tables créées après v47 : policy explicite, fermée sans portée tenant. La console
-- ne fait que lire en P5.5 ; les mutations de triage arriveront avec leurs droits.
alter table error_grouping_config enable row level security;
drop policy if exists tenant_scope on error_grouping_config;
create policy tenant_scope on error_grouping_config
  for select to console_ro using (app_id = any (current_app_ids()));

alter table error_issue enable row level security;
drop policy if exists tenant_scope on error_issue;
create policy tenant_scope on error_issue
  for select to console_ro using (app_id = any (current_app_ids()));

alter table error_issue_alias enable row level security;
drop policy if exists tenant_scope on error_issue_alias;
create policy tenant_scope on error_issue_alias
  for select to console_ro using (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on error_grouping_config, error_issue, error_issue_alias from console_ro;
    grant select on error_grouping_config, error_issue, error_issue_alias to console_ro;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on error_grouping_config, error_issue, error_issue_alias from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on error_grouping_config, error_issue, error_issue_alias from authenticated;
  end if;
end $$;

-- ── 5. rum_error : clé v2 et issue ──────────────────────────────────────────
-- Avant les fonctions d'exploitation, qui lisent ces colonnes : une fonction SQL
-- est validée à sa création. Ce qui suit ne fait qu'enregistrer des fonctions et
-- ne prolonge pas le verrou exclusif de façon mesurable.
create index if not exists idx_rum_error_fingerprint_ts_v72 on rum_error (app_id, fingerprint, ts);

alter table rum_error
  add column if not exists grouping_version smallint,
  add column if not exists grouping_key text,
  add column if not exists grouping_basis text,
  add column if not exists fingerprint_override_hash text,
  add column if not exists grouping_diagnostic text,
  add column if not exists issue_id uuid;

-- NOT VALID : les lignes antérieures portent NULL et satisfont la règle ; la
-- valider parcourrait la table la plus chaude sous verrou pour ne rien prouver.
-- Pas de clé étrangère vers error_issue : elle imposerait un index sur issue_id
-- à chaque suppression d'issue. L'invariant tient autrement : une issue n'est
-- purgée qu'après toutes ses occurrences (dernière vue < date de coupure).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rum_error'::regclass
       and conname = 'rum_error_grouping_v72'
  ) then
    alter table rum_error add constraint rum_error_grouping_v72 check (
      ((grouping_version is null and grouping_key is null and grouping_basis is null) or
       (grouping_version = 2 and grouping_key ~ '^[0-9a-f]{32}$' and
        grouping_basis in ('override', 'symbolicated_frame', 'normalized_frame', 'low_confidence'))) and
      (fingerprint_override_hash is null or fingerprint_override_hash ~ '^[0-9a-f]{64}$') and
      (grouping_diagnostic is null or grouping_diagnostic in ('override_invalide', 'override_vide_apres_scrub')) and
      (issue_id is null or grouping_key is not null)
    ) not valid;
  end if;
end $$;

comment on column rum_error.grouping_key is
  'Clé de regroupement v2 (32 hex d''un SHA-256 app-scopé), calculée à l''ingestion même sans activation';
comment on column rum_error.grouping_basis is
  'override, symbolicated_frame, normalized_frame ou low_confidence (repli peu discriminant)';
comment on column rum_error.fingerprint_override_hash is
  'SHA-256 app-scopé de la clé déclarée rescrubbée ; la clé elle-même n''est jamais stockée';
comment on column rum_error.grouping_diagnostic is
  'Clé déclarée ignorée : override_invalide ou override_vide_apres_scrub';
comment on column rum_error.issue_id is
  'Issue de l''occurrence quand le regroupement v2 était actif pour l''app à l''ingestion ; NULL sinon';

-- ── 6. Exploitation : activation, retour arrière, statistiques ──────────────
-- Activer n'écrit rien dans l'historique : les occurrences suivantes sont
-- rattachées à une issue, celles d'avant restent des groupes historiques lisibles.
-- Rejouable : une app déjà active garde sa date d'activation.
create or replace function error_grouping_activate(p_app_id text, p_actor text, p_vendor_paths text[] default null)
returns jsonb language plpgsql as $$
declare cfg error_grouping_config;
begin
  if p_actor is null or char_length(p_actor) not between 1 and 320 then
    raise exception 'error_grouping_activate : acteur requis (1 à 320 caractères)';
  end if;
  insert into error_grouping_config as c (app_id, active_version, vendor_paths, activated_at, activated_by, updated_at)
  values (p_app_id, 2, coalesce(p_vendor_paths, '{}'), now(), p_actor, now())
  on conflict (app_id) do update
    set active_version = 2,
        vendor_paths = coalesce(p_vendor_paths, c.vendor_paths),
        activated_at = case when c.active_version = 2 then c.activated_at else now() end,
        activated_by = case when c.active_version = 2 then c.activated_by else p_actor end,
        updated_at = now()
  returning * into cfg;
  return jsonb_build_object('app_id', cfg.app_id, 'active_version', cfg.active_version,
    'activated_at', cfg.activated_at, 'vendor_paths', to_jsonb(cfg.vendor_paths));
end $$;

-- Retour arrière : la liste repasse aux groupes historiques. Issues, alias,
-- statuts et rattachements sont CONSERVÉS : une réactivation reprend les mêmes
-- issues, et leurs URL restent lisibles entre-temps.
create or replace function error_grouping_deactivate(p_app_id text, p_actor text)
returns jsonb language plpgsql as $$
declare cfg error_grouping_config;
begin
  if p_actor is null or char_length(p_actor) not between 1 and 320 then
    raise exception 'error_grouping_deactivate : acteur requis (1 à 320 caractères)';
  end if;
  update error_grouping_config
     set active_version = null, deactivated_at = now(), deactivated_by = p_actor, updated_at = now()
   where app_id = p_app_id and active_version is not null
  returning * into cfg;
  return jsonb_build_object('app_id', p_app_id, 'active_version', null, 'deactivated_at', cfg.deactivated_at);
end $$;

-- Mesure anonyme de l'écart entre regroupements, avant d'activer : combien de
-- groupes historiques la v2 scinde, combien de clés v2 fusionnent plusieurs
-- groupes, et quelle part des occurrences n'a qu'un repli peu discriminant. Des
-- comptes seulement : aucun message, aucune empreinte, aucune clé. Fenêtre bornée
-- à 30 jours.
create or replace function error_grouping_shadow_stats(p_app_id text, p_since timestamptz)
returns jsonb language sql stable as $$
  with lignes as (
    select fingerprint, grouping_key, grouping_basis, occurrences
      from rum_error
     where app_id = p_app_id and grouping_key is not null and fingerprint is not null
       and ts >= greatest(p_since, now() - interval '30 days')
  ), historiques as (
    select fingerprint, count(distinct grouping_key) as cles from lignes group by fingerprint
  ), v2 as (
    select grouping_key, count(distinct fingerprint) as groupes from lignes group by grouping_key
  ), bases as (
    select grouping_basis, coalesce(sum(occurrences), 0)::bigint as occurrences from lignes group by grouping_basis
  )
  select jsonb_build_object(
    'app_id', p_app_id,
    'since', greatest(p_since, now() - interval '30 days'),
    'rows', (select count(*) from lignes),
    'legacy_groups', (select count(*) from historiques),
    'v2_keys', (select count(*) from v2),
    'legacy_groups_split', (select count(*) from historiques where cles > 1),
    'v2_keys_merging', (select count(*) from v2 where groupes > 1),
    'occurrences_by_basis', coalesce((select jsonb_object_agg(grouping_basis, occurrences) from bases), '{}'::jsonb)
  )
$$;

do $$
begin
  revoke all on function error_grouping_activate(text, text, text[]) from public;
  revoke all on function error_grouping_deactivate(text, text) from public;
  revoke all on function error_grouping_shadow_stats(text, timestamptz) from public;
end $$;

-- ── 7. Rétention et effacement ──────────────────────────────────────────────
-- Reprise intégrale des définitions de migration-v71 (celles de v67 et les jetons
-- de source maps), plus les issues. Rétention :
-- une issue sans occurrence depuis la date de coupure est purgée avec ses alias ;
-- ses occurrences, plus anciennes que sa dernière vue, l'ont été juste avant.
-- Effacement d'une app : issues, alias et configuration.
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
