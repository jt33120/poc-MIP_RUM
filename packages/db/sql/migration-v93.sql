-- migration-v93 — C13 : les rôles de `console-api`, `mip_console` et `mip_identity`.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v92 (privilège des jetons de CI) est
-- le fichier précédent. AUCUNE DONNÉE TOUCHÉE : deux rôles, leurs droits, leurs
-- policies. Le service continue de se connecter en PROPRIÉTAIRE tant que ses
-- variables `CONSOLE_DATABASE_URL` et `IDENTITY_DATABASE_URL` ne sont pas posées
-- (après la mise en service, runbook « Les rôles de console-api ») : ce fichier
-- ne change rien à ce qui tourne.
--
-- ════════════════════════════ 1. POURQUOI DEUX RÔLES ═════════════════════════
--
-- console-api est le backend de la console : les écrans, les écritures, le RGPD,
-- et l'identité (connexion, sessions). En propriétaire, une injection SQL dans un
-- chargeur lirait les hachés de mots de passe ; une commande détournée
-- supprimerait la télémétrie. Deux rôles séparent ce qui ne doit pas se mêler :
--
--   · `mip_identity` — la connexion (le haché du mot de passe), les sessions, les
--     compteurs de débit d'authentification, et leur ligne d'audit. Rien d'autre ;
--   · `mip_console` — les écrans (lecture de la télémétrie), le plan de contrôle
--     (tableaux de bord, alertes, jetons, connecteurs…), le RGPD. Il ne lit ni un
--     haché de mot de passe, ni une session, ni un compteur de débit ; il ne
--     supprime dans la télémétrie que ce que l'effacement RGPD exige (§ 3).
--
-- Les listes vivent dans `packages/db/roles/console-api.mjs` ; la vérification,
-- dans les deux sens et contre le bundle du service, dans
-- `scripts/ci/verify-db-roles-console.mjs`. La matrice d'autorisations fait
-- tourner le service sous ces rôles en CI (`CONSOLE_API_AUTHZ_ROLES=1`).
--
-- ═══════════════════ 2. CRÉÉS EN SQL, SANS MOT DE PASSE ═════════════════════
--
-- NOLOGIN, comme `mip_api` (v89) : un opérateur pose chaque mot de passe UNE fois
-- depuis psql connecté en propriétaire (`\password mip_console`, puis `alter role
-- mip_console login`), et range la chaîne du pooler dans la variable partagée
-- Railway. SURTOUT PAS par l'API ou la console Neon : un rôle créé ainsi est membre
-- de `neon_superuser` (BYPASSRLS, tout lire, tout écrire) — l'inverse de ce
-- fichier (relevé le 23/09 sur `repetition-p0`). Un rôle DÉJÀ PRÉSENT avec des
-- droits plus larges fait échouer la migration : le supprimer, puis relancer.
--
-- ═══════════════ 3. UN ÉCART AU PLAN : L'EFFACEMENT RGPD ═════════════════════
--
-- Le plan refusait à `mip_console` toute suppression dans la télémétrie. Mais
-- l'effacement RGPD (C10) est exécuté par console-api : il SUPPRIME les lignes
-- d'une personne dans les tables de `DSAR_CHILD_TABLES` et l'ancre `rum_session`,
-- nettoie les lots en file (`ingest_raw`), pose ses barrières, et VERROUILLE les
-- sessions qu'il efface (`select … for update`, qui exige un droit UPDATE : il est
-- accordé sur la seule colonne `last_seen_at`, que rien n'écrit). Les fonctions
-- `privacy_*` s'exécutent avec les droits de l'APPELANT : ces droits sont les
-- siens. Aucun UPDATE ni INSERT sur la télémétrie. Porter l'effacement par une
-- fonction à droits de propriétaire retirerait ces DELETE — noté pour plus tard.
--
-- ═══════════════════════ 4. LES POLICIES, SANS ENJOLIVER ═════════════════════
--
-- Les tables sous RLS ne montrent RIEN à un rôle sans policy. Chaque table
-- accordée reçoit `<rôle>_acces` : pour ce rôle seulement, `using (true) with
-- check (true)`. Les DROITS de table décident de ce qu'il peut faire ; la policy
-- n'ouvre que les lignes. Ce n'est PAS la frontière entre clients : le périmètre
-- est appliqué par le pipeline et par chaque requête (`app_id = any($1)`, lint des
-- écritures), comme pour `mip_api` (v89 § 5). Ces policies ne concernent aucun
-- autre rôle : les policies permissives se combinent en OU entre celles d'un même
-- rôle seulement.

-- 1. Les rôles.
do $$
declare
  nom text;
  r pg_roles%rowtype;
begin
  foreach nom in array array['mip_console', 'mip_identity'] loop
    select * into r from pg_roles where rolname = nom;
    if not found then
      execute format('create role %I nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls', nom);
    elsif r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication
       or exists (select 1 from pg_auth_members m where m.member = r.oid) then
      raise exception using
        message = format('migration-v93 : le rôle %s existe déjà avec des droits plus larges que les siens', nom),
        hint    = format('Créé par l''API ou la console Neon ? Le supprimer (drop role %s) et relancer la migration.', nom);
    end if;
  end loop;
end $$;

alter role mip_console connection limit 40;
alter role mip_console set idle_in_transaction_session_timeout = '60s';
alter role mip_identity connection limit 20;
alter role mip_identity set statement_timeout = '10s';
alter role mip_identity set idle_in_transaction_session_timeout = '30s';

grant usage on schema public to mip_console, mip_identity;

-- 2. mip_console : les écrans, le plan de contrôle, le RGPD.
grant select, delete on table
  extension_install, replay_chunk, rum_action, rum_ai, rum_breadcrumb, rum_error, rum_event, rum_event_index, rum_log, rum_longtask, rum_metric, rum_pageview, rum_resource, rum_session, rum_span
to mip_console;
grant select, insert, update, delete on table
  analytics_saved_view, dashboard, goal, notify_channel, slo, uptime_check
to mip_console;
grant select, insert, update on table
  alert_rule, analytics_rollup_invalidation, app_registry, error_status, extension_scope, privacy_erasure_request, read_tokens, sourcemap_upload_token, ticket_integration
to mip_console;
grant select, insert on table
  audit_log, error_issue_activity, error_issue_ticket, privacy_erasure_barrier, ticket_outbox
to mip_console;
grant select, update, delete on table
  error_issue, ingest_raw
to mip_console;
grant select, update on table
  alert_event, mobile_capabilities
to mip_console;
grant select on table
  alert_delivery, deploy_marker, error_grouping_config, error_issue_alias, error_issue_notification, extension_install_app, metric_histogram_hourly, metric_histogram_state, platform_flag, route_cardinality, rum_rollup_hourly, scheduler_lease, sourcemap, svi_call, svi_step, syn_snapshot, tenant_usage_daily, v_anomaly, v_log_anomaly, v_uptime_status
to mip_console;
grant select (active, apps, created_at, email, id, last_login_at, role) on console_user to mip_console;
grant insert (apps, email, password_hash, role) on console_user to mip_console;
grant update (active, apps, password_hash, role) on console_user to mip_console;
grant select (id, revoked_at, user_id) on console_session to mip_console;
grant update (revoked_at, revoked_reason) on console_session to mip_console;
grant update (last_seen_at) on rum_session to mip_console;

-- 3. mip_identity : la connexion, les sessions, le débit d'authentification.
grant insert on table
  audit_log
to mip_identity;
grant select, insert, update, delete on table
  auth_throttle
to mip_identity;
grant select, insert, update on table
  console_session, console_user
to mip_identity;

-- 4. Les séquences des tables où chaque rôle insère (colonnes `serial`) : USAGE,
--    sans quoi l'identifiant par défaut ne se tire pas.
do $$
declare
  s record;
begin
  for s in
    select distinct g.rolname, d.objid::regclass as seq
      from pg_roles g
      join pg_class c on c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      join pg_depend d on d.refobjid = c.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      join pg_class q on q.oid = d.objid and q.relkind = 'S'
     where g.rolname in ('mip_console', 'mip_identity')
       and has_any_column_privilege(g.rolname, c.oid, 'INSERT')
  loop
    execute format('grant usage on sequence %s to %I', s.seq, s.rolname);
  end loop;
end $$;

-- 5. Les fonctions à droits de propriétaire que les écrans et les commandes
--    appellent, et que les migrations précédentes avaient retirées à PUBLIC.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('alert_release_p75', 'check_alerts', 'check_slo_burn', 'event_metric_baseline',
                                'route_error_issue_notifications', 'slo_status') loop
    execute format('grant execute on function %s to mip_console', f);
  end loop;
end $$;

-- 6. Les policies, sur les tables accordées sous RLS.
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
              and c.relname in (
                'alert_delivery', 'alert_event', 'alert_rule', 'analytics_rollup_invalidation', 'analytics_saved_view',
                'app_registry', 'audit_log', 'console_session', 'console_user', 'dashboard', 'deploy_marker',
                'error_grouping_config', 'error_issue', 'error_issue_activity', 'error_issue_alias',
                'error_issue_notification', 'error_issue_ticket', 'error_status', 'extension_install',
                'extension_install_app', 'extension_scope', 'goal', 'ingest_raw', 'metric_histogram_hourly',
                'metric_histogram_state', 'mobile_capabilities', 'notify_channel', 'platform_flag',
                'privacy_erasure_barrier', 'privacy_erasure_request', 'read_tokens', 'replay_chunk',
                'route_cardinality', 'rum_action', 'rum_ai', 'rum_breadcrumb', 'rum_error', 'rum_event',
                'rum_event_index', 'rum_log', 'rum_longtask', 'rum_metric', 'rum_pageview', 'rum_resource',
                'rum_rollup_hourly', 'rum_session', 'rum_span', 'scheduler_lease', 'slo', 'sourcemap',
                'sourcemap_upload_token', 'svi_call', 'svi_step', 'syn_snapshot', 'tenant_usage_daily',
                'ticket_integration', 'ticket_outbox', 'uptime_check')
  loop
    if not exists (select 1 from pg_policy p where p.polrelid = format('public.%I', t)::regclass
                      and p.polname = 'mip_console_acces') then
      execute format('create policy mip_console_acces on public.%I as permissive for all to mip_console using (true) with check (true)', t);
    end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
              and c.relname in ('audit_log', 'auth_throttle', 'console_session', 'console_user')
  loop
    if not exists (select 1 from pg_policy p where p.polrelid = format('public.%I', t)::regclass
                      and p.polname = 'mip_identity_acces') then
      execute format('create policy mip_identity_acces on public.%I as permissive for all to mip_identity using (true) with check (true)', t);
    end if;
  end loop;
end $$;
