-- migration-v101 — Détections horaires (refonte du monitoring, vague 3a, 29/09/2026) :
-- les p75 horaires des Web Vitals (`vital_horaire`) et les constats détectés par
-- calcul (`signal_detecte`), écrits par le travail `detections_horaires` du
-- scheduler, lus par la console par deux chargeurs.
--
-- Rejouable, additive, PostgreSQL 15 à 17. Ne dépend d'aucun objet de v98, v99
-- ou v100 (PR voisines non fusionnées au moment de l'écriture) : seulement de
-- `rum_metric` (schema), `current_app_ids()` (v47) et `erase_app_data` (v81 →
-- v97).
--
--   1. `vital_horaire` : p50, p75 (et son intervalle à 95 % par statistiques
--      d'ordre), p95, par app × route ('' = toutes routes) × vital × heure ;
--   2. `signal_detecte` : les constats (épisodes hors de la plage habituelle,
--      ruptures…), avec leur méthode, leurs preuves chiffrées et leur priorité ;
--   3. RLS : lecture `console_ro` à la PORTÉE du client, rien pour `anon` ni
--      `authenticated` ;
--   4. `refresh_vital_horaire(p_heures)` : le calcul horaire, en SQL, sur les
--      heures FERMÉES seulement ;
--   5. `purge_detections(p_semaines)` : la rétention de 8 semaines, appelée par
--      le passage quotidien du scheduler — une fonction À PART plutôt qu'une
--      redéfinition de `purge_rum_tenants`, que d'autres PR redéfinissent ;
--   6. `erase_app_data` vide les deux tables (télémétrie dérivée d'une app).
--
-- FENÊTRE DE DÉPLOIEMENT. Le scheduler appelle ces fonctions par
-- `appelerFnSiPresente` : sur une base qui n'a pas encore ce fichier, l'étape
-- rend « migration-v101 non appliquée » au lieu d'échouer. La console lit les
-- tables par ses chargeurs, qui rendent un état vide propre sur `42P01`.
set local lock_timeout = '3s';

-- ── 1. `vital_horaire` ──────────────────────────────────────────────────────
--
-- POURQUOI UNE TABLE et pas une lecture à la volée : la plage habituelle d'une
-- heure se calcule sur 9 à 48 heures de RÉFÉRENCE (même créneau des semaines
-- passées) ; relire le brut de six semaines à chaque passage coûterait des
-- millions de lignes. Ici : ~105 lignes par heure et par app.
--
-- Une ligne par route n'existe que si l'heure a au moins 13 mesures sur cette
-- route (sous ce seuil, ni intervalle de p75 ni détection) : c'est ce qui borne
-- le volume quand une app a beaucoup de routes. La ligne « toutes routes »
-- (route = '') existe dès une mesure : `n` dit l'effectif, un manque se voit.
create table if not exists vital_horaire (
  app_id      text not null,
  route       text not null default '',
  name        text not null,
  hour        timestamptz not null,
  n           int not null check (n >= 0),
  p50         double precision,
  p75         double precision,
  p75_bas     double precision,
  p75_haut    double precision,
  p95         double precision,
  calcule_le  timestamptz not null default now(),
  primary key (app_id, route, name, hour)
);

comment on table vital_horaire is
  'p50/p75/p95 horaires des Web Vitals par app × route ('''' = toutes routes) × vital (v101). '
  'p75_bas/p75_haut : intervalle à 95 % de la p75 par statistiques d''ordre — rangs exacts de 13 à 29 '
  'mesures, rangs normaux au-delà (apps/console/lib/stats/incertitude.ts), NULL sous 13. Recalculé '
  'sur les 3 dernières heures fermées par refresh_vital_horaire (upsert idempotent). Purgé à 8 semaines.';

-- La lecture de la référence : une app, une liste d'instants (`hour = any(…)`).
create index if not exists vital_horaire_app_hour_idx on vital_horaire (app_id, hour);
-- La purge : les heures les plus anciennes, toutes apps confondues.
create index if not exists vital_horaire_hour_brin on vital_horaire using brin (hour);

-- ── 2. `signal_detecte` ─────────────────────────────────────────────────────
--
-- Un constat = une règle publiée qui s'est déclenchée. Rien n'y est « deviné » :
-- `methode` dit le calcul et ses paramètres, `preuves` les chiffres affichés
-- (effectifs compris), `impact` ce qui est touché. `phrase` (dans `preuves`) est
-- rédigée par des règles, jamais par un modèle de langage.
--
-- UNICITÉ (app, détecteur, entité, début) : c'est la clé de l'upsert du travail
-- horaire, qui recalcule trois heures à chaque passage — le même épisode revu
-- trois fois reste UNE ligne.
create table if not exists signal_detecte (
  id          bigserial primary key,
  app_id      text not null,
  detecteur   text not null,
  entite      text not null,
  debut       timestamptz not null,
  fin         timestamptz,
  methode     jsonb not null,
  preuves     jsonb not null,
  impact      jsonb not null,
  priorite    double precision not null,
  statut      text not null default 'ouvert',
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  constraint signal_detecte_detecteur_v101 check (detecteur in
    ('plage', 'rupture', 'release', 'surrep', 'segment_lent', 'prevision', 'erreur', 'trafic')),
  constraint signal_detecte_statut_v101 check (statut in ('ouvert', 'clos', 'masque')),
  constraint signal_detecte_priorite_v101 check (priorite >= 0 and priorite <= 1),
  constraint signal_detecte_fin_v101 check (fin is null or fin >= debut),
  constraint signal_detecte_unique_v101 unique (app_id, detecteur, entite, debut)
);

comment on table signal_detecte is
  'Constats détectés par calcul (v101) : épisodes hors de la plage habituelle (detecteur = plage), '
  'ruptures, régressions après déploiement… Écrits par le travail detections_horaires du scheduler, '
  'lus par apps/console/lib/chargeurs/constats.ts. Vocabulaire : « associé à », jamais « cause ». '
  'Purgé à 8 semaines.';

create index if not exists signal_detecte_app_debut_idx on signal_detecte (app_id, debut desc);
create index if not exists signal_detecte_ouverts_idx on signal_detecte (app_id, detecteur, entite)
  where statut = 'ouvert';

-- ── 3. RLS : la portée du client, rien d'autre ──────────────────────────────
--
-- Motif des tables créées après v47 : portée explicite, jamais `using (true)`
-- (`scripts/verify-tenant-isolation.mjs` le refuse sur une table à `app_id`).
-- Portée vide : aucune ligne (fail-closed). Aucune policy ne vise `anon` ni
-- `authenticated` : la RLS leur ferme les deux tables, et le droit leur est
-- retiré par-dessus.
alter table vital_horaire enable row level security;
alter table signal_detecte enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    drop policy if exists tenant_scope on vital_horaire;
    create policy tenant_scope on vital_horaire for select to console_ro
      using (app_id = any (current_app_ids()));
    drop policy if exists tenant_scope on signal_detecte;
    create policy tenant_scope on signal_detecte for select to console_ro
      using (app_id = any (current_app_ids()));
    revoke all on vital_horaire, signal_detecte from console_ro;
    grant select on vital_horaire, signal_detecte to console_ro;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on vital_horaire, signal_detecte from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on vital_horaire, signal_detecte from authenticated;
  end if;
end $$;

-- ── 4. `refresh_vital_horaire` ──────────────────────────────────────────────
--
-- Les `p_heures` dernières heures FERMÉES (défaut 3, borné à 1…48) : l'heure en
-- cours est incomplète, et les événements tardifs d'une heure fermée arrivent
-- dans les deux suivantes — d'où le recalcul, en upsert (`on conflict do
-- update`, jamais `+=`), qui rend le même résultat au même contenu.
--
-- L'INTERVALLE DE LA P75, par statistiques d'ordre, avec les rangs de
-- `apps/console/lib/stats/incertitude.ts` : exacts (binomiale, queues égales)
-- de 13 à 29 mesures — la table ci-dessous est `rangsQuantileExact(n)` —, normaux
-- au-delà, par la formule de `rangsQuantileNormalSql`. Sous 13 mesures, aucune
-- borne haute ne tient : NULL, jamais une valeur par défaut.
--
-- Coût : trois heures de `rum_metric` (index BRIN sur `ts`), quelques milliers
-- de lignes par app ; `array_agg` trié par groupe pour lire deux rangs.
create or replace function refresh_vital_horaire(p_heures int default 3)
returns int
language plpgsql
as $$
declare
  v_fin   timestamptz := date_trunc('hour', now());
  v_debut timestamptz := date_trunc('hour', now()) - make_interval(hours => greatest(1, least(coalesce(p_heures, 3), 48)));
  v_n     int;
begin
  with mesures as (
    select m.app_id, coalesce(m.route, '') as route, m.name,
           date_trunc('hour', m.ts) as hour, m.value
      from rum_metric m
     where m.ts >= v_debut and m.ts < v_fin
       -- Les cinq Core Web Vitals (v56), jamais une liste recopiée : les phases
       -- réseau partagent `rum_metric` sans être des vitals.
       and m.name = any (mip_core_vitals())
       and m.value >= 0
  ),
  groupes as (
    -- Toutes routes : dès une mesure.
    select app_id, ''::text as route, name, hour, count(*)::int as n,
           percentile_cont(0.5)  within group (order by value) as p50,
           percentile_cont(0.75) within group (order by value) as p75,
           percentile_cont(0.95) within group (order by value) as p95,
           array_agg(value order by value) as triees
      from mesures
     group by app_id, name, hour
    union all
    -- Par route : 13 mesures au moins (le minimum d'un intervalle de p75).
    select app_id, route, name, hour, count(*)::int,
           percentile_cont(0.5)  within group (order by value),
           percentile_cont(0.75) within group (order by value),
           percentile_cont(0.95) within group (order by value),
           array_agg(value order by value)
      from mesures
     where route <> ''
     group by app_id, route, name, hour
    having count(*) >= 13
  ),
  rangs as (
    select g.*,
           case
             when g.n < 13 then null
             when g.n < 30 then e.r
             else greatest(1, floor(0.75::float8 * g.n - 1.96::float8 * sqrt(0.1875::float8 * g.n)))::int
           end as r,
           case
             when g.n < 13 then null
             when g.n < 30 then e.s
             else least(g.n, ceil(0.75::float8 * g.n + 1.96::float8 * sqrt(0.1875::float8 * g.n)) + 1)::int
           end as s
      from groupes g
      left join (values (13,7,13),(14,7,14),(15,8,15),(16,8,16),(17,9,17),(18,10,18),(19,10,19),
                        (20,11,19),(21,12,20),(22,12,21),(23,13,22),(24,14,23),(25,14,24),(26,15,25),
                        (27,16,25),(28,16,26),(29,17,27)) as e(n, r, s) on e.n = g.n
  )
  insert into vital_horaire (app_id, route, name, hour, n, p50, p75, p75_bas, p75_haut, p95, calcule_le)
  select app_id, route, name, hour, n, p50, p75,
         case when r is null then null else triees[r] end,
         case when s is null then null else triees[s] end,
         p95, now()
    from rangs
  on conflict (app_id, route, name, hour) do update
     set n = excluded.n, p50 = excluded.p50, p75 = excluded.p75,
         p75_bas = excluded.p75_bas, p75_haut = excluded.p75_haut,
         p95 = excluded.p95, calcule_le = excluded.calcule_le;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function refresh_vital_horaire(int) is
  'Recalcule vital_horaire sur les p_heures dernières heures fermées (défaut 3, 1 à 48), en upsert '
  'idempotent (v101). Rend le nombre de lignes écrites. Appelée par le passage horaire du scheduler.';

-- ── 5. `purge_detections` ───────────────────────────────────────────────────
--
-- 8 semaines : la référence la plus longue de la plage habituelle est de six
-- semaines (même créneau, K ≤ 6), plus deux de marge. Ce sont des agrégats et
-- des constats, sans donnée personnelle : la rétention n'a pas à suivre celle,
-- par client, de la télémétrie brute. L'effacement d'une app, lui, les vide
-- (§ 6).
create or replace function purge_detections(p_semaines int default 8)
returns jsonb
language plpgsql
as $$
declare
  v_coupure timestamptz := now() - make_interval(weeks => greatest(1, coalesce(p_semaines, 8)));
  v_horaire int;
  v_signal  int;
begin
  delete from vital_horaire where hour < v_coupure;
  get diagnostics v_horaire = row_count;
  delete from signal_detecte where coalesce(fin, debut) < v_coupure;
  get diagnostics v_signal = row_count;
  return jsonb_build_object('vital_horaire', v_horaire, 'signal_detecte', v_signal);
end $$;

comment on function purge_detections(int) is
  'Rétention des détections (v101) : efface les heures de vital_horaire et les constats de '
  'signal_detecte antérieurs à p_semaines (défaut 8). Appelée par le passage quotidien du scheduler.';

-- Des fonctions du scheduler (propriétaire) : aucun autre rôle ne les appelle.
revoke all on function refresh_vital_horaire(int) from public;
revoke all on function purge_detections(int) from public;

-- ── 6. `erase_app_data` vide les deux tables ────────────────────────────────
--
-- LA DÉFINITION N'EST PAS RECOPIÉE (même geste que v84 et v97) : les deux
-- `delete` sont insérés dans la définition COURANTE, devant son unique
-- `return result;`, et le fichier échoue bruyamment si ce point d'insertion
-- n'est pas trouvé exactement une fois. Rejeu : déjà posés, rien à réécrire.
do $$
declare
  src   text;
  ancre constant text := E'\n  return result;\n';
  ajout constant text :=
    E'\n  -- v101 : détections horaires, télémétrie dérivée de l''app.\n'
    '  delete from vital_horaire where app_id = p_app_id;'
    ' get diagnostics n = row_count; result := result || jsonb_build_object(''vital_horaire'', n);\n'
    '  delete from signal_detecte where app_id = p_app_id;'
    ' get diagnostics n = row_count; result := result || jsonb_build_object(''signal_detecte'', n);\n'
    '  return result;\n';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'erase_app_data'
     and p.pronargs = 1 and p.proargtypes[0] = 'text'::regtype;
  if src is null then
    raise exception 'v101: erase_app_data(text) introuvable — appliquer v81 d''abord';
  end if;
  if position('from vital_horaire ' in src) > 0 then
    return;
  end if;
  if (length(src) - length(replace(src, ancre, ''))) / length(ancre) <> 1 then
    raise exception 'v101: point d''insertion ambigu dans erase_app_data (% occurrences)',
      (length(src) - length(replace(src, ancre, ''))) / length(ancre);
  end if;
  execute 'create or replace function erase_app_data(p_app_id text) returns jsonb language plpgsql as '
       || quote_literal(replace(src, ancre, ajout));
end $$;

comment on function erase_app_data(text) is
  'Efface toutes les données d''une application et SUSPEND son ingestion dans le registre, sous le '
  'même verrou. Conserve privacy_erasure_barrier et privacy_erasure_request. Depuis v83, vide aussi '
  'backfill_run. Depuis v97, ne cite plus le SVI ni les tickets (tables supprimées). Depuis v101, '
  'vide vital_horaire et signal_detecte. La reprise de l''ingestion est une opération explicite.';
