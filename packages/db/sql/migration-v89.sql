-- migration-v89 — P4 : le rôle `mip_api`, en LECTURE SEULE, pour le service `api`.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v88 (livraison P5) est le fichier
-- précédent. AUCUNE DONNÉE TOUCHÉE : un rôle, des droits, des policies de
-- lecture, et quatre fonctions retirées à PUBLIC.
--
-- ═══════════════════════════ 1. POURQUOI UN RÔLE ═════════════════════════════
--
-- Le service `api` sert l'API de lecture v1 aux machines — partenaires, front
-- tiers, et le serveur MCP qu'un modèle de langage pilote. C'est la surface la
-- plus exposée du backend. Il se connecte aujourd'hui en PROPRIÉTAIRE : une
-- injection SQL, ou une route d'écriture montée par erreur, écrirait partout.
-- Sous `mip_api`, elle ne peut plus RIEN modifier, ni lire un secret :
--
--   · SELECT sur une liste blanche de 28 tables et vues, et sur des COLONNES
--     choisies de trois autres (§ 3) — aucun INSERT, UPDATE, DELETE, TRUNCATE ;
--   · aucun privilège par défaut : une table créée demain lui est fermée ;
--   · EXECUTE sur la seule fonction à droits de propriétaire qu'il lit
--     (`event_metric_baseline`) ; les quatre qui écrivent et que PUBLIC
--     exécutait lui sont retirées (§ 4) ;
--   · transaction en lecture seule par défaut, requête bornée à 15 s,
--     transaction inactive coupée à 30 s, 20 connexions au plus.
--
-- La liste blanche vit dans `packages/db/roles/mip-api.mjs` ; la vérification,
-- dans les deux sens, dans `scripts/ci/verify-db-roles.mjs` (CI, et en lecture
-- contre la production). ADR : docs/architecture/adr/0003-roles-et-tenancy.md.
--
-- ═══════════════════ 2. LE RÔLE, CRÉÉ EN SQL, SANS MOT DE PASSE ══════════════
--
-- NOLOGIN : la migration ne connaît aucun secret. Un opérateur pose le mot de
-- passe UNE fois, depuis psql connecté en propriétaire :
--
--   \password mip_api                     -- psql hache côté client (SCRAM) :
--   alter role mip_api login;             --   le mot de passe ne transite pas
--
-- puis range la chaîne `postgresql://mip_api:…@<hôte pooler>/neondb?sslmode=require`
-- dans la variable partagée Railway `API_DATABASE_URL`. Procédure complète :
-- docs/operations/runbook.md, « Le rôle de l'API ».
--
-- SURTOUT PAS PAR L'API OU LA CONSOLE NEON : un rôle créé ainsi est membre de
-- `neon_superuser` (BYPASSRLS, lecture et écriture de toutes les tables) —
-- l'inverse de ce fichier. Relevé le 23/09 sur la branche `repetition-p0`. Créé
-- en SQL par `neondb_owner` (CREATEROLE), le rôle ne reçoit rien de plus que
-- ce qui suit, et son créateur en garde l'administration (PostgreSQL 16+).
--
-- Un `mip_api` DÉJÀ PRÉSENT avec des droits plus larges fait ÉCHOUER la
-- migration : la réutiliser en silence donnerait au service ce que ce fichier
-- lui refuse. Le supprimer (`drop role mip_api`), puis relancer.
--
-- ══════════════════════ 3. LA LISTE BLANCHE, ET SES COLONNES ═════════════════
--
-- Tirée des relations que nomme le bundle du service (les routes v1 de la
-- console, compilées). Trois tables sont lues PAR COLONNES :
--   · console_user ........ id seulement : la jointure d'une activité d'issue
--                            à son acteur. L'e-mail n'est servi qu'à une session
--                            administrateur, que le service n'a jamais ; ni
--                            `email`, ni `password_hash` ;
--   · replay_chunk ........ app_id, session_id — l'existence d'un rejeu, jamais
--                            son contenu : l'API v1 ne sert pas les rejeux ;
--   · ticket_integration .. où part un ticket — jamais `credential_ref`,
--                            `webhook_secret_ref`, `config`.
-- Quatre relations sont NOMMÉES par le bundle sans être lues, et ne sont pas
-- accordées : `audit_log` et `deploy_marker` (écrites par des routes que le
-- service refuse en 405), `analytics_saved_view` (vues personnelles, refusées à
-- tout jeton avant lecture), `slo` (un chemin d'écran, pas une requête).
--
-- ═════════════════════════ 4. LES FONCTIONS QUI ÉCRIVENT ═════════════════════
--
-- Une fonction SECURITY DEFINER s'exécute avec les droits de son propriétaire.
-- Quatre d'entre elles ÉCRIVENT et restaient exécutables par PUBLIC — donc par
-- tout rôle, `mip_api` compris, sans aucun droit sur les tables :
--   check_ai_op_anomalies(), check_new_errors(), reconcile_alert_deliveries(),
--   upsert_svi_call(jsonb).
-- La lecture seule par défaut de la transaction ne suffit pas : une session la
-- lève par `set transaction read write`. Elles sont donc retirées à PUBLIC,
-- comme les 21 que les migrations précédentes avaient déjà fermées. Leurs
-- appelants — collector, scheduler, notifier, console — se connectent en
-- propriétaire et gardent le droit.
--
-- ══════════════════════════ 5. LES POLICIES DE LECTURE ═══════════════════════
--
-- Les tables sous RLS ne montrent RIEN à un rôle sans policy. Chaque table de
-- la liste blanche sous RLS reçoit `mip_api_lecture` : SELECT seulement, pour
-- `mip_api` seulement, `using (true)`.
--
-- CE QUE ÇA VEUT DIRE, sans l'enjoliver : pour `mip_api`, la policy n'est PAS
-- la frontière entre clients. Les lectures v1 filtrent par `app_id = any($1)`
-- selon le périmètre du jeton, comme la console aujourd'hui ; elles ne posent
-- pas `app.current_app_id`, que lisent les policies `tenant_scope` de
-- `console_ro`. Rendre la base juge du périmètre demande que chaque lecture le
-- pose dans sa transaction : c'est le travail des loaders de la piste C. Ce que
-- ce fichier garantit dès aujourd'hui : lecture seule, et aucun secret lisible.
--
-- Ces policies ne concernent AUCUN autre rôle : les policies permissives se
-- combinent en OU, mais seulement entre celles qui s'appliquent au même rôle.
-- Les gardes « aucune policy `using (true)` sur une table scopée » visent donc
-- les policies de `console_ro` et de PUBLIC.

-- 2. Le rôle.
do $$
declare
  r pg_roles%rowtype;
begin
  select * into r from pg_roles where rolname = 'mip_api';
  if not found then
    create role mip_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  elsif r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication
     or exists (select 1 from pg_auth_members m where m.member = r.oid) then
    raise exception using
      message = 'migration-v89 : le rôle mip_api existe déjà avec des droits plus larges que la lecture',
      detail  = format('superuser=%s bypassrls=%s createrole=%s createdb=%s replication=%s, membre de : %s',
                       r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
                       coalesce((select string_agg(g.rolname, ', ') from pg_auth_members m
                                   join pg_roles g on g.oid = m.roleid where m.member = r.oid), 'aucun')),
      hint    = 'Créé par l''API ou la console Neon ? Le supprimer (drop role mip_api) et relancer la migration.';
  end if;
end $$;

alter role mip_api connection limit 20;
alter role mip_api set default_transaction_read_only = on;
alter role mip_api set statement_timeout = '15s';
alter role mip_api set idle_in_transaction_session_timeout = '30s';

grant usage on schema public to mip_api;

-- 3. La liste blanche.
grant select on table
  analytics_rollup_invalidation, app_registry, error_grouping_config, error_issue,
  error_issue_activity, error_issue_alias, error_issue_ticket, error_status,
  metric_histogram_hourly, metric_histogram_state, mobile_capabilities, read_tokens,
  rum_action, rum_breadcrumb, rum_error, rum_event, rum_event_index, rum_longtask,
  rum_metric, rum_pageview, rum_resource, rum_rollup_hourly, rum_session, rum_span,
  sourcemap, syn_snapshot, ticket_outbox, v_anomaly
to mip_api;

grant select (id) on console_user to mip_api;
grant select (app_id, session_id) on replay_chunk to mip_api;
grant select (id, app_id, provider, target, state, enabled, verified_at) on ticket_integration to mip_api;

-- 4. Les fonctions : la lecture accordée, les écritures retirées à PUBLIC.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'event_metric_baseline' loop
    execute format('grant execute on function %s to mip_api', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('check_ai_op_anomalies', 'check_new_errors',
                                'reconcile_alert_deliveries', 'upsert_svi_call') loop
    execute format('revoke execute on function %s from public', f);
  end loop;
end $$;

-- 5. Les policies de lecture, sur les tables de la liste sous RLS.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
              and c.relname in (
                'analytics_rollup_invalidation', 'app_registry', 'error_grouping_config', 'error_issue',
                'error_issue_activity', 'error_issue_alias', 'error_issue_ticket', 'error_status',
                'metric_histogram_hourly', 'metric_histogram_state', 'mobile_capabilities', 'read_tokens',
                'rum_action', 'rum_breadcrumb', 'rum_error', 'rum_event', 'rum_event_index', 'rum_longtask',
                'rum_metric', 'rum_pageview', 'rum_resource', 'rum_rollup_hourly', 'rum_session', 'rum_span',
                'sourcemap', 'syn_snapshot', 'ticket_outbox', 'console_user', 'replay_chunk', 'ticket_integration')
  loop
    if not exists (select 1 from pg_policy p where p.polrelid = format('public.%I', t)::regclass
                      and p.polname = 'mip_api_lecture') then
      execute format('create policy mip_api_lecture on public.%I as permissive for select to mip_api using (true)', t);
    end if;
  end loop;
end $$;
