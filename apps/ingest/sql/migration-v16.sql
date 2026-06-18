-- migration-v16 : PARITÉ repo↔live du rôle de connexion console (console_ro).
--
-- Contexte : RLS a été activé sur tout le schéma public (v10), et la console se
-- connecte sous le rôle RESTREINT `console_ro` (cf. DEPLOY.md), donc son accès
-- DOIT passer par des policies dédiées. Or les policies/grants console_ro des
-- tables de BASE (rum_metric, rum_event, rum_span, …) avaient été posés À LA MAIN
-- en v0.3 et n'ont JAMAIS été versionnés : un déploiement propre / une reprise
-- (DR) depuis le repo donnerait une console AVEUGLE (RLS active, aucune policy →
-- 0 ligne), alors que CI/local (connexion propriétaire, bypass RLS) restent verts.
-- On codifie ici le modèle COMPLET.
--
-- Corrige aussi un GAP LATENT EN PROD : `rum_span` (lu en direct par /tracing,
-- queries-customers, queries.ts) et `rate_counter` avaient un GRANT SELECT mais
-- AUCUNE policy console_ro → 0 ligne. La page Tracing était donc vide sous
-- console_ro. La policy manquante est ajoutée ici.
--
-- Idempotente et GARDÉE : si le rôle console_ro n'existe pas (CI/local Docker),
-- tout le bloc est sauté. Les NOMS de policies sont IDENTIQUES au live (préfixes
-- historiques `console_read_*` conservés) → réexécution sur la prod = no-op exact
-- (les `if not exists` reconnaissent les policies déjà présentes).

do $$
declare
  spec text;
  tbl  text;
  pol  text;
begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    raise notice 'console_ro absent (CI/local) — bloc parité console_ro sauté';
    return;
  end if;

  -- 1) Tables en LECTURE SEULE : grant select + policy SELECT (using true).
  --    Format 'table:nom_de_policy' (noms historiques conservés pour le no-op live).
  foreach spec in array array[
    'rum_metric:console_read_metric',
    'rum_error:console_read_error',
    'rum_pageview:console_read_pageview',
    'rum_session:console_read_session',
    'syn_snapshot:console_read_syn',
    'rum_event:cro_sel_event',
    'rum_longtask:cro_sel_longtask',
    'rum_breadcrumb:cro_sel_breadcrumb',
    'rum_resource:cro_sel_resource',
    'replay_chunk:cro_sel_replay',
    'rum_span:cro_sel_span',         -- gap live corrigé (Tracing était aveugle)
    'rate_counter:cro_sel_rate',     -- gap live corrigé
    'alert_delivery:cro_sel_delivery'
  ]
  loop
    tbl := split_part(spec, ':', 1);
    pol := split_part(spec, ':', 2);
    if to_regclass('public.' || tbl) is null then continue; end if;
    execute format('grant select on public.%I to console_ro', tbl);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = tbl and policyname = pol
    ) then
      execute format('create policy %I on public.%I for select to console_ro using (true)', pol, tbl);
    end if;
  end loop;

  -- 2) Tables en ÉCRITURE (CRUD console).
  -- console_user : gestion des comptes (création/reset, provisioning SSO JIT).
  grant select, insert, update, delete on console_user to console_ro;
  if not exists (select 1 from pg_policies where tablename = 'console_user' and policyname = 'cro_all_user') then
    create policy cro_all_user on console_user for all to console_ro using (true) with check (true);
  end if;

  -- audit_log : lecture + insertion (login, actions admin). Jamais d'update/delete.
  grant select, insert on audit_log to console_ro;
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'cro_sel_audit') then
    create policy cro_sel_audit on audit_log for select to console_ro using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'cro_ins_audit') then
    create policy cro_ins_audit on audit_log for insert to console_ro with check (true);
  end if;

  -- alert_rule / alert_event : CRUD (configuration des alertes + accusés d'envoi).
  if to_regclass('public.alert_rule') is not null then
    grant select, insert, update, delete on alert_rule to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'alert_rule' and policyname = 'cro_all_alert_rule') then
      create policy cro_all_alert_rule on alert_rule for all to console_ro using (true) with check (true);
    end if;
  end if;
  if to_regclass('public.alert_event') is not null then
    grant select, insert, update, delete on alert_event to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'alert_event' and policyname = 'cro_all_alert_event') then
      create policy cro_all_alert_event on alert_event for all to console_ro using (true) with check (true);
    end if;
  end if;

  -- 3) Vues (pas de RLS — la console les lit via le rôle propriétaire de la vue ;
  --    on accorde tout de même le SELECT pour la connexion console_ro).
  foreach tbl in array array['v_correlation', 'v_anomaly', 'v_blind_spot', 'v_error_group', 'v_trace']
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('grant select on public.%I to console_ro', tbl);
    end if;
  end loop;
end $$;
