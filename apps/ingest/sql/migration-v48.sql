-- migration-v48 — `console_ro` cesse de pouvoir écrire partout.
--
-- CONSTAT. Le rôle applicatif de la console s'appelle `console_ro` — « read only »
-- — et détient en réalité DELETE, INSERT, SELECT, UPDATE sur les 45 tables du
-- schéma public. Un nom qui ment est pire qu'un nom absent : il fait passer la
-- revue de sécurité sur la foi du suffixe.
--
-- Aujourd'hui c'est théorique (la console se connecte avec un rôle propriétaire).
-- Cela cesse de l'être à la bascule que prépare migration-v47 : la console
-- hériterait alors d'un droit d'écriture sur toute la télémétrie de tous les
-- tenants, alors qu'elle n'écrit jamais dedans.
--
-- CE QUE FAIT CETTE MIGRATION
-- Retire INSERT/UPDATE/DELETE/TRUNCATE à `console_ro` sur TOUT le schéma, puis les
-- rend UNIQUEMENT sur les tables où la console écrit réellement. SELECT n'est
-- jamais touché.
--
-- La liste d'écriture n'est pas devinée : elle est relevée des requêtes de
-- `apps/console/lib` et `apps/console/app` (insert/update/delete). Elle contient
-- deux catégories :
--   • la CONFIGURATION que la console administre (règles, SLO, objectifs, tableaux
--     de bord, canaux, jetons, comptes, registre d'applications…) ;
--   • `rum_session` et `rum_span`, que la console écrit pour SON PROPRE
--     dogfooding (traces serveur via withServerTrace) — contre-intuitif, donc
--     explicitement listé plutôt que découvert à la première panne.
--
-- Une table de télémétrie absente de la liste (rum_metric, rum_error, rum_log,
-- rum_pageview, rum_resource, rum_longtask, rum_breadcrumb, replay_chunk,
-- rum_rollup_hourly, uptime_result, tenant_usage_daily, rate_counter,
-- syn_snapshot, alert_delivery, rum_ai) devient donc en LECTURE SEULE pour la
-- console. L'ingestion, elle, écrit avec le rôle de service : elle n'est pas
-- concernée.
--
-- SI VOUS AJOUTEZ UNE ÉCRITURE CONSOLE SUR UNE NOUVELLE TABLE, ajoutez-la ici.
-- Le symptôme, sinon, est un « permission denied for table … » explicite — pas
-- une corruption silencieuse. C'est le mode de défaillance qu'on veut.
--
-- Idempotente. Retour arrière : `grant insert, update, delete on all tables in
-- schema public to console_ro`.

do $$
declare
  -- Tables où la console écrit réellement. Ordre alphabétique, une raison par
  -- ligne quand elle n'est pas évidente.
  ecriture text[] := array[
    'ai_briefing',      -- cache du briefing généré au login
    'alert_event',      -- acquittement d'une alerte par un humain
    'alert_rule',
    'app_registry',
    'audit_log',        -- journal des actions console
    'console_user',
    'dashboard',
    'deploy_marker',    -- marqueurs de déploiement poussés par la CI
    'error_status',     -- triage d'une erreur (ouverte / ignorée / résolue)
    'extension_scope',
    'goal',
    'notify_channel',
    'read_tokens',
    'rum_session',      -- dogfooding : trace serveur de la console elle-même
    'rum_span',         -- idem
    'slo',
    'sourcemap',
    'uptime_check'
  ];
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    return; -- rôle absent (self-host minimal) : rien à restreindre
  end if;

  revoke insert, update, delete, truncate on all tables in schema public from console_ro;

  foreach t in array ecriture loop
    -- to_regclass : une table listée mais absente (schéma partiel, table
    -- supprimée par une migration ultérieure) ne fait pas échouer la migration.
    if to_regclass(format('public.%I', t)) is not null then
      execute format('grant insert, update, delete on public.%I to console_ro', t);
    end if;
  end loop;
end $$;
