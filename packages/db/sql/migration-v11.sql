-- v0.8 (suite) — durcissement des fonctions SQL. Répond aux alertes Supabase :
--   - function_search_path_mutable : search_path non figé sur les fonctions
--     (une fonction SECURITY DEFINER avec search_path mutable est injectable).
--   - anon/authenticated_security_definer_function_executable : des RPC
--     SECURITY DEFINER étaient appelables SANS authentification via
--     /rest/v1/rpc — dont une fonction de purge destructrice.
--
-- Appelants légitimes (vérifiés dans le code) :
--   - rate_check / upsert_rum_session / set_session_page_count : edge function
--     v1-traces via la clé service_role (et dev-server via le rôle propriétaire).
--   - check_alerts / purge_*                                   : pg_cron (rôle
--     postgres, propriétaire) — jamais via l'API.
-- => On retire EXECUTE à public/anon/authenticated sur les SECURITY DEFINER, et
--    on (re)donne EXECUTE à service_role. Idempotent (re-jouable).
--
-- Gardes de rôles : sur un Postgres local/CI, anon/authenticated/service_role
-- n'existent pas -> ces grants/revokes sont sautés. Le rôle propriétaire
-- (postgres) garde EXECUTE dans tous les cas, donc dev-server et console
-- fonctionnent même sans les rôles Supabase.

-- 1) Figer le search_path de toutes les fonctions du schéma public (pg_temp en
--    dernier pour éviter le détournement par objets temporaires ; pg_catalog
--    reste implicitement prioritaire pour les fonctions natives).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('alter function %s set search_path = public, pg_temp;', r.sig);
  end loop;
end $$;

-- 2) Fermer l'exposition API des fonctions SECURITY DEFINER. PUBLIC existe
--    toujours ; anon/authenticated/service_role uniquement sur le cloud.
do $$
declare r record; api_roles text; has_service boolean;
begin
  select string_agg(quote_ident(rolname), ', ') into api_roles
  from pg_roles where rolname in ('anon', 'authenticated');
  select exists (select 1 from pg_roles where rolname = 'service_role') into has_service;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public;', r.sig);
    if api_roles is not null then
      execute format('revoke all on function %s from %s;', r.sig, api_roles);
    end if;
    if has_service then
      execute format('grant execute on function %s to service_role;', r.sig);
    end if;
  end loop;
end $$;
