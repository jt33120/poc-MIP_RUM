-- migration-v35 — Sécurité (audit, suite de v34) : épinglage du search_path des
-- fonctions restantes signalées `function_search_path_mutable` par l'advisor.
--
-- Contexte : une fonction sans `search_path` fixe résout ses identifiants non
-- qualifiés selon le search_path de l'appelant — surface d'attaque (une fonction
-- homonyme injectée dans un schéma prioritaire peut être appelée à la place de
-- celle attendue). Aucune de ces 10 fonctions n'est SECURITY DEFINER (elles
-- tournent avec les droits de l'appelant, donc le risque réel est faible), mais
-- épingler `public, pg_temp` est la bonne pratique et aligne ces fonctions sur
-- les autres du schéma (slo_status, check_slo_burn… déjà épinglées).
--
-- Vérifié au préalable : aucune de ces fonctions ne référence de schéma externe
-- (net/cron/vault/auth/extensions) → `public, pg_temp` ne casse aucune résolution.
-- Idempotent (ré-appliquer un ALTER SET est un no-op) et gardé (fonction absente
-- en CI/local → sautée).

do $$
declare
  fn text;
  fns text[] := array[
    'set_session_page_count(text)',
    'purge_rum(integer)',
    'refresh_rum_rollups(integer)',
    'purge_rum_tenants(integer)',
    'purge_rum_app(text, timestamp with time zone)',
    'meter_tenant_usage(date)',
    'tenant_quota_status(text)',
    'severity_rank(text)',
    'erase_app_data(text)',
    'erase_session(text)'
  ];
begin
  foreach fn in array fns loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('alter function public.%s set search_path = public, pg_temp', fn);
    end if;
  end loop;
end $$;
