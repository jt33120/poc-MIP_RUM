-- v0.8 — durcissement sécurité : RLS sur toutes les tables publiques + fermeture
-- des vues à l'API anonyme. Répond à l'alerte Supabase (12/06/2026) :
--   - rls_disabled_in_public      : tables lisibles/modifiables via l'API publique
--   - sensitive_columns_exposed   : console_user (password_hash) exposé via l'API
--
-- Modèle d'accès du POC (rappel) :
--   - Ingestion : edge functions Deno via la clé SERVICE_ROLE -> BYPASSRLS.
--   - Console    : connexion Postgres DIRECTE (lib/db.ts, driver pg) sous le rôle
--                  propriétaire `postgres` -> les propriétaires de table
--                  contournent RLS (pas de FORCE).
--   - PERSONNE ne passe par l'API PostgREST (rôles anon / authenticated).
-- Conséquence : activer RLS SANS policy ferme entièrement l'API publique tout en
-- laissant ingestion et console fonctionner. Idempotent (re-jouable).

-- 1) RLS sur toutes les tables de base du schéma public qui ne l'ont pas encore.
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

-- 2) Les vues ne portent pas de RLS : on retire tout accès des rôles d'API
--    (anon, authenticated). La console les lit via le rôle propriétaire -> OK.
do $$
declare r record;
begin
  for r in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('revoke all on public.%I from anon, authenticated;', r.table_name);
  end loop;
end $$;

-- 3) Filet de sécurité : aucune nouvelle table/vue créée plus tard dans public ne
--    sera ouverte par défaut aux rôles d'API (au cas où une migration future
--    oublie le RLS). N'affecte pas service_role ni le propriétaire.
alter default privileges in schema public revoke all on tables from anon, authenticated;
