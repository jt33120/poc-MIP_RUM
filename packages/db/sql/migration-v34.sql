-- migration-v34 — Remédiation sécurité (audit) : RLS + verrouillage des fonctions
-- SECURITY DEFINER exposées en anonyme.
--
-- Contexte : l'advisor sécurité Supabase signalait (1) `rls_disabled` sur 7 tables
-- applicatives, et (2) 4 fonctions SECURITY DEFINER exécutables par anon/authenticated
-- via l'API REST. Cette migration corrige les deux, de façon IDEMPOTENTE et gardée
-- (console_ro / pg_cron absents en CI/local → blocs sautés), pour que la base
-- reconstruite (on-premise) soit identique à la prod.
--
-- Modèle d'accès (rappel) :
--   • service_role  : bypassrls=true  → edge functions non affectées par la RLS.
--   • postgres      : bypassrls (owner) → pg_cron (job mip-slo-burn) non affecté.
--   • console_ro    : rôle de la console (pool PG direct) → policies permissives
--                     `using(true)` calquées sur ses grants ; garde son accès.
--   • anon/authenticated (API REST PostgREST) : aucun grant sur ces tables, et
--                     n'appellent aucune de ces 4 fonctions → révocation sans casse.

-- ─────────────────── 1) RLS sur les 7 tables applicatives ───────────────────
-- Enable RLS est idempotent (ré-activer = no-op). Les policies sont gardées
-- `if not exists` avec les NOMS EXACTS déjà en prod → réapplication = no-op.
-- slo / notify_channel : policies déjà créées en v17 ; ici on garantit surtout
-- que la RLS est ACTIVÉE (v17 créait la policy sans activer la RLS → inerte).

alter table if exists slo                enable row level security;
alter table if exists notify_channel     enable row level security;
alter table if exists openrouter_balance enable row level security;
alter table if exists goal               enable row level security;
alter table if exists read_tokens        enable row level security;
alter table if exists extension_scope    enable row level security;
alter table if exists ai_briefing        enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    -- slo (grants + policy déjà en v17, re-garantis ici pour l'auto-suffisance)
    grant select, insert, update, delete on slo to console_ro;
    if not exists (select 1 from pg_policies where tablename='slo' and policyname='cro_all_slo') then
      create policy cro_all_slo on slo for all to console_ro using (true) with check (true);
    end if;

    -- notify_channel (idem v17)
    grant select, insert, update, delete on notify_channel to console_ro;
    if not exists (select 1 from pg_policies where tablename='notify_channel' and policyname='cro_all_channel') then
      create policy cro_all_channel on notify_channel for all to console_ro using (true) with check (true);
    end if;

    -- openrouter_balance (lecture + écriture solde)
    grant select, insert on openrouter_balance to console_ro;
    if not exists (select 1 from pg_policies where tablename='openrouter_balance' and policyname='cro_all_openrouter_balance') then
      create policy cro_all_openrouter_balance on openrouter_balance for all to console_ro using (true) with check (true);
    end if;

    -- goal (objectifs)
    grant select, insert, update, delete on goal to console_ro;
    if not exists (select 1 from pg_policies where tablename='goal' and policyname='cro_all_goal') then
      create policy cro_all_goal on goal for all to console_ro using (true) with check (true);
    end if;

    -- read_tokens (jetons d'API de lecture)
    grant select, insert, update on read_tokens to console_ro;
    if not exists (select 1 from pg_policies where tablename='read_tokens' and policyname='cro_all_read_tokens') then
      create policy cro_all_read_tokens on read_tokens for all to console_ro using (true) with check (true);
    end if;

    -- extension_scope (mapping domaine → app_id observé par l'extension)
    grant select, insert, update on extension_scope to console_ro;
    if not exists (select 1 from pg_policies where tablename='extension_scope' and policyname='cro_all_extension_scope') then
      create policy cro_all_extension_scope on extension_scope for all to console_ro using (true) with check (true);
    end if;

    -- ai_briefing (cache des synthèses IA) : la console LIT, l'écriture passe par
    -- service_role (edge/route API) → policy SELECT seulement.
    grant select on ai_briefing to console_ro;
    if not exists (select 1 from pg_policies where tablename='ai_briefing' and policyname='cro_sel_ai_briefing') then
      create policy cro_sel_ai_briefing on ai_briefing for select to console_ro using (true);
    end if;
  end if;
end $$;

-- ───────── 2) Verrouillage des fonctions SECURITY DEFINER (retrait anon/authenticated) ─────────
-- Supabase accorde par DÉFAUT l'exécution de toute fonction du schéma public aux
-- rôles anon/authenticated/service_role (grants EXPLICITES dans la proacl, pas via
-- PUBLIC). Ces 4 fonctions ne doivent PAS être appelables via l'API REST : route_alert
-- (POST webhook/Slack) et check_slo_burn (déclenche l'alerting) sont les plus sensibles ;
-- slo_status / metric_baseline fuitent des données métier. On révoque anon+authenticated
-- (et PUBLIC par sûreté) ; service_role, console_ro et postgres (owner, pg_cron) conservent.

do $$
declare
  fn text;
  fns text[] := array[
    'slo_status(text)',
    'metric_baseline(text,text,text,integer)',
    'route_alert(bigint,text,text,text,jsonb)',
    'check_slo_burn()'
  ];
begin
  foreach fn in array fns loop
    -- garde : la fonction existe-t-elle (signature exacte) ?
    if to_regprocedure('public.' || fn) is null then continue; end if;
    execute format('revoke execute on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function public.%s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function public.%s from authenticated', fn);
    end if;
    -- rôles légitimes : ré-accord explicite (idempotent)
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'console_ro') then
      execute format('grant execute on function public.%s to console_ro', fn);
    end if;
  end loop;
end $$;
