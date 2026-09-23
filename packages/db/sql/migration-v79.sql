-- migration-v79 — P6.5 : propriétaire de tableau de bord et vues enregistrées.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucun backfill de données RUM, aucune
-- réécriture de layout : les tableaux de bord existants gardent leur `layout` jsonb
-- tel quel, et les widgets v1 restent lisibles par leur adaptateur.
--
--   1. analytics_saved_view : analyses enregistrées de l'Explorer. Un AST versionné,
--      un propriétaire (compte interne) et une app. Aucune donnée de résultat, aucune
--      identité RUM : un effacement DSAR n'y laisse rien en cache.
--   2. dashboard : propriétaire par clé étrangère vers console_user, résolu depuis
--      le `created_by` existant quand le compte est connu — sinon NULL, propriétaire
--      hérité (« legacy »), que seul un admin de l'app peut reprendre. `revision`
--      porte la concurrence optimiste des écritures (409 côté console).
--   3. RLS, droits console_ro et effacement d'app pour la table neuve.
--
-- CE QUI N'EST PAS FAIT ICI, ET POURQUOI.
--   · `purge_rum_app` n'est PAS redéfinie. Elle applique une rétention à des
--     OBSERVATIONS datées ; une analyse enregistrée et un tableau de bord sont de la
--     CONFIGURATION. Les effacer au bout de trente jours supprimerait le travail d'un
--     utilisateur au motif qu'il n'a rien mesuré récemment. L'effacement d'app, lui,
--     les emporte (point 3) : c'est le geste qui supprime réellement un périmètre.
--   · AUCUN index n'est créé sur une table de signaux RUM. Les index de lecture
--     analytique relèvent de P6.6, qui les mesure avec EXPLAIN et les pré-déploie
--     CONCURRENTLY. Les deux index ci-dessous portent sur des tables de
--     configuration (quelques milliers de lignes au plus) : l'un sert le plafond de
--     50 vues par utilisateur et par app, l'autre la clé étrangère de propriétaire.
--
-- FENÊTRE DE DÉPLOIEMENT. Le code P6.5 publié AVANT ce fichier sonde l'absence de la
-- table et des colonnes (`lib/queries-saved-views.ts`, `lib/queries-dashboards.ts`) :
-- les vues enregistrées s'annoncent indisponibles, le propriétaire reste l'email
-- `created_by` et la révision vaut 1. Le code antérieur encore en service APRÈS ce
-- fichier n'écrit ni `owner_id` ni `revision` : la valeur par défaut s'applique, et
-- aucune contrainte ne porte sur une colonne existante — un tableau de bord écrit par
-- l'ancien code ne peut pas échouer.
--
-- VERROUS. `alter table dashboard` prend un ACCESS EXCLUSIVE jusqu'au commit : il
-- vient après la table neuve, et `lock_timeout` borne l'attente. S'il expire, le
-- fichier entier est annulé et le déploiement rejoué.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.dashboard') is null then
    raise exception 'v79 : migration-v18 (dashboard) doit être appliquée avant ce fichier';
  end if;
  if to_regclass('public.error_issue') is null then
    raise exception 'v79 : migration-v72 (error_issue) doit être appliquée avant ce fichier';
  end if;
end $$;

-- ── 1. Vues enregistrées de l'Explorer ──────────────────────────────────────
-- `query_json` porte l'AST CANONIQUE, versionné : ce que l'Explorer a exécuté, sans
-- aucune ligne de résultat. Il se rejoue avec les droits de son lecteur — une vue
-- n'est donc jamais une porte dérobée vers une app qu'on ne pourrait pas lire.
create table if not exists analytics_saved_view (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references app_registry (app_id) on delete cascade,
  owner_id    bigint references console_user (id) on delete set null,
  name        text not null,
  query_json  jsonb not null,
  revision    bigint not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint analytics_saved_view_v79 check (
    char_length(name) between 1 and 100 and name !~ '[[:cntrl:]]' and
    jsonb_typeof(query_json) = 'object' and
    -- `coalesce` et non `query_json -> 'version'` seul : une clé ABSENTE donne NULL,
    -- et une comparaison NULL satisfait une contrainte CHECK. Sans ce repli, un AST
    -- sans numéro de version entrerait — et plus rien ne saurait le relire.
    jsonb_typeof(coalesce(query_json -> 'version', 'null'::jsonb)) = 'number' and
    octet_length(query_json::text) <= 32768 and
    revision >= 1 and created_at <= updated_at
  )
);

comment on table analytics_saved_view is
  'Analyses enregistrées de l''Explorer : un AST versionné, son propriétaire et son app. '
  'Aucune donnée de résultat, aucune identité RUM ; la mesure se recalcule à chaque ouverture';
comment on column analytics_saved_view.owner_id is
  'Compte interne propriétaire ; NULL après suppression du compte — la vue devient lisible des seuls admins de l''app, jamais publique';
comment on column analytics_saved_view.query_json is
  'AST canonique versionné (clé « version ») ; il ne vaut aucune autorisation : le périmètre est réintersecté à chaque lecture';
comment on column analytics_saved_view.revision is
  'Concurrence optimiste : une écriture qui ne cite pas la révision lue est refusée (409), jamais appliquée par-dessus';

-- Sert la liste (propriétaire, app, plus récentes d'abord) ET le plafond de
-- 50 vues par utilisateur et par app, compté dans la transaction d'écriture.
create index if not exists idx_analytics_saved_view_owner_v79
  on analytics_saved_view (app_id, owner_id, updated_at desc);

-- ── 2. Propriétaire et révision d'un tableau de bord ────────────────────────
-- `created_by` reste en place : c'est la trace d'audit v18, et le seul lien dont
-- dispose un tableau créé par un compte disparu. `owner_id` la DOUBLE d'une clé
-- réelle quand le compte existe — sans elle, renommer un compte réattribuerait
-- silencieusement ses tableaux à quelqu'un d'autre.
alter table dashboard
  add column if not exists owner_id bigint,
  add column if not exists revision bigint not null default 1;

alter table dashboard
  drop constraint if exists dashboard_owner_v79,
  add constraint dashboard_owner_v79 foreign key (owner_id)
    references console_user (id) on delete set null not valid,
  drop constraint if exists dashboard_revision_v79,
  add constraint dashboard_revision_v79 check (revision >= 1) not valid;

comment on column dashboard.owner_id is
  'Compte interne propriétaire, résolu depuis created_by ; NULL = propriétaire hérité, repris par un admin de l''app';
comment on column dashboard.revision is
  'Concurrence optimiste des écritures de configuration : une réécriture fondée sur une lecture périmée est refusée (409)';

create index if not exists idx_dashboard_owner_v79 on dashboard (owner_id);

-- Résolution unique et rejouable : seuls les tableaux sans propriétaire sont
-- touchés, et seulement quand l'email correspond EXACTEMENT à un compte. Un
-- created_by inconnu (compte supprimé, import) reste un propriétaire hérité.
update dashboard d
   set owner_id = u.id
  from console_user u
 where u.email = d.created_by and d.owner_id is null;

-- ── 3. RLS, droits et effacement ────────────────────────────────────────────
-- Table créée après v47 : elle pose sa propre policy, la boucle de découverte de
-- v47 ayant déjà tourné. Lecture ET écriture dans la portée tenant : la console
-- crée, renomme et supprime les vues de son périmètre.
alter table analytics_saved_view enable row level security;
drop policy if exists tenant_scope on analytics_saved_view;
create policy tenant_scope on analytics_saved_view
  for all to console_ro
  using (app_id = any (current_app_ids()))
  with check (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on analytics_saved_view from console_ro;
    grant select, insert, delete on analytics_saved_view to console_ro;
    -- Ni app_id ni owner_id ne s'écrivent après coup : déplacer une vue vers une
    -- autre app, ou vers un autre propriétaire, serait un partage déguisé.
    grant update (name, query_json, revision, updated_at) on analytics_saved_view to console_ro;
    -- dashboard : v48 a déjà accordé insert/update/delete au niveau table.
  end if;
  -- Rôles de l'ancienne API publique : aucun droit, même par défaut.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on analytics_saved_view from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on analytics_saved_view from authenticated;
  end if;
end $$;

-- Reprise INTÉGRALE de la définition de migration-v72 (issues, configuration de
-- regroupement et jetons de source maps compris), plus deux lignes :
--   · analytics_saved_view : les analyses enregistrées d'une app effacée ;
--   · dashboard : la ligne de migration-v18, PERDUE lors de la reprise de v61.
--     Un effacement d'app laissait donc derrière lui les tableaux scopés sur elle,
--     avec leurs titres et leurs filtres. Les tableaux transverses (app_id null)
--     restent préservés, comme v18 le prévoyait.
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
  delete from analytics_saved_view where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_saved_view', n);
  delete from dashboard where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('dashboard', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;
