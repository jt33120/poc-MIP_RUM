-- migration-v46 — La cause racine des 627 alertes de burn : fast_burn était une
-- tautologie, pas une détection.
--
-- CE QUE v45 A MANQUÉ. La migration précédente a traité la CADENCE des alertes de
-- burn (backoff dégressif) en concluant « le coupable n'est pas un bug mais une
-- règle trop simple ». C'était faux. La cadence n'était que le symptôme : les
-- alertes elles-mêmes n'ont jamais rien détecté. Appliquer v45 seule aurait fait
-- passer 23 fausses alertes par jour à ~3 fausses alertes par jour.
--
-- LE DÉFAUT. `slo.objective` est contractuellement une FRACTION dans ]0,1[ — le
-- schéma le dit (« 0..1 (ex. 0.99) »), la console le respecte (`objective =
-- objectivePct / 100`, app/alerts/actions.ts), le script de vérification aussi
-- (0.99). Rien ne l'IMPOSAIT. La ligne de production porte `objective = 99`,
-- c'est-à-dire l'échelle en pourcent, écrite par un chemin qui a contourné le
-- formulaire.
--
-- Une seule valeur hors contrat, et toute l'arithmétique de budget d'erreur
-- bascule sans jamais échouer :
--
--   budget        = 1 - 99                    = -98
--   burned_pct    → gardé par `budget > 0`    = NULL      (affiché « 0 % »)
--   fast_burn     = (1 - atteinte) >= 14,4 × (-98)
--                 = (1 - atteinte) >= -1411,2 → TOUJOURS VRAI
--
-- `1 - atteinte` appartient à [0,1] : la comparaison ne peut pas être fausse. Le
-- SLO s'est donc déclaré « en burn rapide » à chaque passage du cron, toutes les
-- 5 minutes, depuis le 2 juillet — 627 alertes « critical » qui ne mesuraient
-- rien. Le message affichait « objectif 9900,00 % », seul indice visible.
--
-- CORRECTIF EN TROIS TEMPS
--   1. Réparer la donnée : 99 → 0,99 (l'intention, « LCP 99 % / 28 j », est
--      préservée).
--   2. Imposer le contrat : CHECK (objective > 0 and objective < 1), pour que le
--      chemin qui a écrit 99 échoue désormais à l'écriture.
--   3. Rendre l'arithmétique non tautologique : `fast_burn` retourne false quand
--      le budget n'est pas strictement positif. Le CHECK rend ce cas
--      inatteignable ; la garde est une défense en profondeur, et elle choisit le
--      silence plutôt que la sirène permanente — un SLO mal configuré ne doit pas
--      pouvoir noyer les vraies alertes.
--
-- Idempotente. Aucune donnée supprimée. Retour arrière : supprimer la contrainte
-- `slo_objective_is_ratio` et réappliquer slo_status() depuis migration-v17.sql.

-- ── 1. Réparer les lignes écrites en pourcent ────────────────────────────────
-- Ne convertit que ce qui atterrit réellement dans ]0,1[ ; tout le reste est
-- signalé bruyamment plus bas plutôt que corrigé au jugé.
update slo
   set objective = objective / 100
 where objective >= 1
   and objective / 100 > 0
   and objective / 100 < 1;

-- Ce qui resterait hors contrat après normalisation relève d'une décision
-- humaine (objectif à 100 %, valeur négative…) : on refuse de deviner.
do $$
declare bad text;
begin
  select string_agg(format('id=%s (%s) objective=%s', id, name, objective), ', ')
    into bad from slo where not (objective > 0 and objective < 1);
  if bad is not null then
    raise exception 'slo.objective hors du contrat ]0,1[ et non normalisable : %', bad
      using hint = 'Corriger manuellement : un objectif se stocke en fraction (99 % -> 0.99).';
  end if;
end $$;

-- ── 2. Imposer le contrat au niveau du stockage ──────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'slo_objective_is_ratio') then
    alter table slo add constraint slo_objective_is_ratio
      check (objective > 0 and objective < 1);
  end if;
end $$;

comment on column slo.objective is
  'Objectif de service, FRACTION dans ]0,1[ (99 % se stocke 0.99). Contrainte '
  'slo_objective_is_ratio : une valeur en pourcent rendait fast_burn tautologique (cf. migration-v46).';

-- ── 3. fast_burn ne peut plus être vrai par construction ─────────────────────
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
         case when (1 - s.objective) > 0
              then least(greatest((1 - att.attainment) / (1 - s.objective), 0) * 100, 999) end as burned_pct,
         -- Budget non positif = objectif hors contrat. Sans cette garde, le
         -- membre de droite devient négatif et la comparaison est toujours vraie
         -- (627 fausses alertes en production, cf. en-tête de migration-v46).
         case when (1 - s.objective) > 0
              then (1 - att1h.attainment) >= 14.4 * (1 - s.objective)
              else false end as fast_burn
  from slo s
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - make_interval(days => s.window_days))
            / greatest((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - make_interval(days => s.window_days)), 1)
      else
        (select count(*) filter (where m.rating = 'good')::float / greatest(count(*),1)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - make_interval(days => s.window_days))
    end as attainment
  ) att
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - interval '1 hour')
            / greatest((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - interval '1 hour'), 1)
      else
        (select count(*) filter (where m.rating = 'good')::float / greatest(count(*),1)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - interval '1 hour')
    end as attainment
  ) att1h
  where s.active and (p_app_id is null or s.app_id = p_app_id)
  order by burned_pct desc nulls last;
$$;

comment on function slo_status(text) is
  'Atteinte / budget d''erreur / burn rapide par SLO. fast_burn est false si le '
  'budget n''est pas strictement positif (garde anti-tautologie, cf. migration-v46).';
