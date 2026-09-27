-- migration-v94 — Recette du 26/09/2026 : le SLO d'erreurs compte les erreurs NAVIGATEUR,
-- et son budget consommé n'est plus plafonné à 999 %.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v93 (rôles de console-api) est le
-- fichier précédent. AUCUNE DONNÉE TOUCHÉE : `slo_status()` est redéfinie à
-- l'identique de sa signature (v64) — `create or replace` garde son propriétaire
-- et ses droits (PUBLIC retiré, `mip_api` et `mip_console` accordés par v89 et v93).
-- `check_slo_burn()` la lit telle quelle : rien d'autre à recréer.
--
-- CE QUI ÉTAIT FAUX, relevé sur la base de recette :
--
--   1. LA POPULATION. Le cas `error_rate` (« Pages sans erreur JS » à la recette)
--      divisait TOUTES les occurrences — exceptions Node, Python, OpenTelemetry,
--      React Native — par des pages vues NAVIGATEUR. Une exception serveur n'a
--      aucune page vue en face. La Vue d'ensemble, elle, ne retient que les sources
--      `browser_*` (CP14, `comptesParSource` dans lib/queries-errors.ts) : 72,3 % à
--      côté de 63,0 % pour le SLO, sur les mêmes données. Le numérateur prend
--      désormais la MÊME définition : `error_source like 'browser\_%'`. Une
--      occurrence sans source déclarée reste hors du compte, comme sur la Vue
--      d'ensemble (qui l'écrit à part).
--
--   2. LE PLAFOND. `least(…, 999)` écrivait « 999 % » pour 1 233 % : une valeur
--      bornée affichée comme exacte. Le budget consommé est rendu tel quel (jamais
--      négatif) ; l'écran écrit ce qu'il reçoit.
--
-- CE QUI NE CHANGE PAS. La formule reste « 1 − occurrences ÷ pages vues », pas une
-- part de pages sans erreur : `rum_error.pageview_id` n'est pas renseigné, aucune
-- occurrence ne se rattache à SA page. L'écran la nomme pour ce qu'elle est
-- (lib/slo-ecran.ts). Les vitaux, la fenêtre glissante, le burn rapide sur la
-- dernière heure et le facteur 14,4 sont repris à l'octet près de v64.
create or replace function slo_status(p_app_id text default null)
returns table(slo_id bigint, app_id text, name text, metric text, route text,
              objective double precision, window_days int,
              attainment double precision, budget double precision,
              burned_pct double precision, fast_burn boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.id, s.app_id, s.name, s.metric, s.route, s.objective, s.window_days,
         att.attainment,
         (1 - s.objective) as budget,
         case when (1 - s.objective) > 0 and att.attainment is not null
              then greatest((1 - att.attainment) / (1 - s.objective), 0) * 100 end as burned_pct,
         (1 - att1h.attainment) >= 14.4 * (1 - s.objective) as fast_burn
  from slo s
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select coalesce(sum(e.occurrences), 0)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.error_source like 'browser\_%'
                and e.ts > now() - make_interval(days => s.window_days))
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - make_interval(days => s.window_days)), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - make_interval(days => s.window_days))
    end as attainment
  ) att
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select coalesce(sum(e.occurrences), 0)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.error_source like 'browser\_%'
                and e.ts > now() - interval '1 hour')
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - interval '1 hour'), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - interval '1 hour')
    end as attainment
  ) att1h
  where s.active and (p_app_id is null or s.app_id = p_app_id)
  order by burned_pct desc nulls last;
$$;

comment on function slo_status(text) is
  'Statut des SLO actifs (v94) : vitaux = part des mesures Bon ; error_rate = 1 − occurrences '
  'd''erreurs NAVIGATEUR (error_source browser_*) ÷ pages vues. Budget consommé non plafonné.';
