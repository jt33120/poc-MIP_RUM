-- v0.8 — durcissement sécurité : RLS sur toutes les tables publiques + fermeture
-- des vues à l'API anonyme. Répond à l'alerte Supabase (12/06/2026) :
--   - rls_disabled_in_public      : tables lisibles/modifiables via l'API publique
--   - sensitive_columns_exposed   : console_user (password_hash) exposé via l'API
--
-- Modèle d'accès (rappel) :
--   - Ingestion : edge functions Deno via la clé SERVICE_ROLE -> BYPASSRLS.
--   - Console    : connexion Postgres DIRECTE (lib/db.ts, driver pg) sous le rôle
--                  RESTREINT `console_ro` (cf. DEPLOY.md). Ce rôle n'a PAS BYPASSRLS :
--                  son accès passe par des policies permissives dédiées (cro_* /
--                  console_read_*, posées par chaque migration qui crée une table lue
--                  par la console — v0.3, v05, v12, v13, v15). En local/CI (rôle absent),
--                  la console se connecte en propriétaire et contourne RLS.
--   - pg_cron (purge/métering/refresh) : rôle propriétaire `postgres` (BYPASSRLS).
--   - PERSONNE ne passe par l'API PostgREST (rôles anon / authenticated).
-- Conséquence : activer RLS ferme l'API publique ; les policies console_ro laissent
-- la console fonctionner. Idempotent (re-jouable).
--
-- Gardes de rôles : sur un Postgres local/CI (docker), les rôles d'API Supabase
-- (anon/authenticated) n'existent pas -> les blocs qui les visent sont sautés
-- (même motif que les blocs `console_ro` des migrations précédentes).

-- 1) RLS sur toutes les tables de base du schéma public (aucun rôle requis).
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- 2) Fermeture de l'accès API (anon/authenticated) — uniquement si ces rôles
--    existent (cloud Supabase). Les vues ne portent pas de RLS : on retire leur
--    accès API. La console les lit via le rôle propriétaire -> OK. On verrouille
--    aussi les privilèges par défaut des futures tables de `public`.
do $$
declare r record; api_roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into api_roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if api_roles is null then return; end if;

  for r in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('revoke all on public.%I from %s;', r.table_name, api_roles);
  end loop;

  execute format(
    'alter default privileges in schema public revoke all on tables from %s;', api_roles);
end $$;
