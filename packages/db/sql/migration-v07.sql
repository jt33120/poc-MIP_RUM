-- migration-v07.sql — idempotence de page_count (revue R1) + convergence des
-- écritures sous rejeu (R2). MIP RUM v0.7.
--
-- Problème corrigé : upsert_rum_session INCRÉMENTAIT page_count. L'ingestion
-- étant at-least-once (un beacon/middleware peut rejouer un lot après un 500),
-- un rejeu double-comptait les pages vues d'une session.
--
-- Correctif : page_count est désormais DÉRIVÉ du nombre de lignes rum_pageview
-- de la session — or rum_pageview est déjà dédupliqué par span_id
-- (on conflict do nothing). Résultat : le compte est exact quel que soit le
-- nombre de rejeux, et chaque étape d'écriture devient idempotente.

-- 1) upsert_rum_session ne modifie plus page_count (métadonnées seulement).
--    Signature INCHANGÉE -> appelants (edge function, dev-server) compatibles ;
--    p_page_count_inc est conservé pour compat mais ignoré.
create or replace function upsert_rum_session(
  p_session_id text, p_app_id text, p_client_id text, p_user_hash text,
  p_user_agent text, p_device_type text, p_geo_country text,
  p_last_seen_at timestamptz, p_page_count_inc int
) returns void language sql as $$
  insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, geo_country, started_at, last_seen_at, page_count)
  values (p_session_id, p_app_id, p_client_id, p_user_hash, p_user_agent, p_device_type, p_geo_country, p_last_seen_at, p_last_seen_at, 0)
  on conflict (session_id) do update
    set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
        user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
        geo_country  = coalesce(rum_session.geo_country, excluded.geo_country);
$$;

-- 2) Recalcule page_count depuis la source de vérité (rum_pageview, dédupliquée).
--    Idempotent : à appeler APRÈS l'insertion des pageviews du lot.
create or replace function set_session_page_count(p_session_id text)
returns void language sql as $$
  update rum_session s
     set page_count = (select count(*) from rum_pageview p where p.session_id = s.session_id)
   where s.session_id = p_session_id;
$$;

-- 3) Backfill : réaligne les sessions déjà en base sur le compte réel de pages
--    vues (corrige les éventuels doubles-comptes hérités de l'ancienne logique).
update rum_session s
   set page_count = (select count(*) from rum_pageview p where p.session_id = s.session_id);
