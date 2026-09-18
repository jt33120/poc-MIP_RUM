-- migration-v82 — P7.5 : runtime d'une session et modèle de capacités mobiles.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v81 est RÉSERVÉE à P8.1, développé
-- en parallèle : ce fichier ne dépend d'aucun de ses objets et ne les redéfinit
-- pas. Aucune table de crash natif n'est créée ici — elle appartient à P8.5, et
-- la poser d'avance donnerait une colonne vide à lire comme un zéro.
--
-- ═══════════════ 1. POURQUOI UNE COLONNE `runtime` SUR LA SESSION ════════════
--
-- L'écran `/mobile` mesure une POPULATION : « les sessions React Native ». Avant
-- ce fichier, la seule façon de la désigner était une déduction — `os` vaut
-- « iOS » ou « Android » ET `browser` est NULL. Elle est fausse dans les deux
-- sens : un navigateur mobile que le parseur ne sait pas nommer laisse
-- `browser` à NULL et serait compté React Native, tandis qu'une future WebView
-- MIP serait comptée à tort ou à raison selon son user-agent. Un taux d'erreur
-- dont le dénominateur est une devinette n'est pas un taux.
--
-- L'information EXISTE déjà à l'ingestion : `runtimeClientMip()` (otlp.mjs) lit
-- le `service.name` constant de nos SDK (`mip-rum-mobile`, `mip-rum-web`) et le
-- scope de l'émetteur web. Elle était calculée puis jetée. La colonne la garde.
--
-- Valeurs écrites par le code : `react_native`, `browser`. NULL = émetteur non
-- reconnu (OTel tiers, SDK antérieur au marqueur) — « Inconnu », jamais « web ».
-- La contrainte ne ferme PAS l'énumération : un troisième runtime déployé avant
-- cette migration ferait rejeter le lot ENTIER par Postgres, donc toute la
-- télémétrie de l'application. Elle borne la longueur et refuse les caractères
-- de contrôle, comme les dimensions de v74/v75.
--
-- ═════════════════ 2. LE MODÈLE DE CAPACITÉS, ET SES TROIS ÉTATS ═════════════
--
-- Voir `apps/ingest/supabase/functions/_shared/mobile-capabilities.mjs` pour le
-- vocabulaire et la raison d'être. En base, trois faits distincts :
--
--   ligne `declared = true`   le SDK a installé la capacité et l'observe ;
--   ligne `declared = false`  le SDK a REGARDÉ et n'a rien pu installer ;
--   aucune ligne              personne n'a rien dit.
--
-- `verified_at` NE VIENT QUE D'UNE RECETTE D'OPÉRATEUR. Aucun chemin
-- d'ingestion ne l'écrit : l'upsert du writer ne cite ni `verified_at`, ni
-- `verified_by`, ni `verified_note` dans son `do update set`, et un test SQL le
-- prouve en réingérant après vérification. Un booléen client dit ce que le SDK
-- CROIT avoir installé ; il ne dit pas qu'un crash a réellement été reçu,
-- symbolisé et affiché. Confondre les deux ferait passer une intention pour une
-- preuve.
--
-- ═════════════════════════ 3. CLÉ, RELEASE ET NULL ═══════════════════════════
--
-- L'unicité porte sur (app_id, runtime, release, capability). `release` est
-- NULLABLE : une application qui ne déclare pas sa version reste mesurable, et
-- fabriquer une chaîne vide pour tenir dans une clé primaire inventerait une
-- release nommée « ». D'où un identifiant de substitution et un index unique
-- `nulls not distinct` (PostgreSQL 15+) : deux déclarations sans release se
-- reconnaissent comme la même ligne au lieu de s'empiler à chaque lot.
--
-- ═══════════════════════════ 4. INDEX ET VOLUME ══════════════════════════════
--
-- UN index, et il est MESURÉ — pas supposé. Banc jetable PostgreSQL 15
-- (conteneur local, port 5433), 120 000 sessions sur 7 jours dont 30 000 React
-- Native, 250 000 erreurs et 400 000 pages vues, semées par `generate_series`
-- seul — aucune donnée client n'entre dans un banc. Médiane de 9 exécutions à
-- chaud, deux passes indépendantes donnant les mêmes chiffres à 0,5 ms près :
--
--   Lecture                                     sans index   avec index   plan
--   ─────────────────────────────────────────── ──────────── ─────────── ──────
--   sessions + visiteurs RN, 24 h                  27,1 ms      3,6 ms    index
--   sessions + visiteurs RN, 7 j                   47,1 ms     25,5 ms    index
--   sessions touchées par une erreur JS, 7 j      152,6 ms    148,7 ms    index
--
-- CE QUE LA MESURE A TRANCHÉ. L'intuition de départ était qu'il ne servirait à
-- rien : `idx_session_app_last_seen` (v61) borne déjà les sessions par app, et
-- `runtime` ne filtre qu'une fraction. C'était FAUX, pour une raison précise :
-- l'index de v61 porte sur `last_seen_at`, et la cohorte de `/mobile` borne sur
-- `started_at` — il n'y avait donc aucun index utilisable, et toute lecture de
-- l'écran parcourait `rum_session` en entier. Le planificateur choisit le
-- nouvel index dans les trois scénarios ; le gain va d'un facteur 7,5 sur la
-- fenêtre la plus courante (24 h) à rien du tout sur la jointure d'erreurs, que
-- la table `rum_error` domine. On le crée.
--
-- Coût : 1,3 Mio d'index pour 23 Mio de table, sur une table écrite à chaque lot.
--
-- Le banc est reproductible : `tests/integration/rum-mobile-bench-p75.test.ts`,
-- qui retire l'index, mesure, le recrée, remesure, et imprime les deux plans.
--
-- `mobile_capabilities` porte au plus six lignes par (app, runtime, release) :
-- quelques dizaines de lignes par application. Sa clé unique suffit à toutes ses
-- lectures ; aucun index supplémentaire n'est créé.
--
-- GARDE DE DÉPLOIEMENT (motif v68, v80). Le runner applique chaque migration
-- dans une transaction, donc ne peut pas employer CONCURRENTLY. Au-delà de
-- 32 Mio, `rum_session` est une table chaude : on refuse ici un build bloquant
-- plutôt que de figer l'ingestion, et l'index se précrée avec
-- `predeploy-v82-indexes.sql`.
--
-- ══════════════════ 5. RÉTENTION, EFFACEMENT ET QUOTAS ═══════════════════════
--
-- `mobile_capabilities` entre dans `erase_app_data` (offboarding art. 17) et
-- dans `purge_rum_app` (rétention). Elle n'entre PAS dans `erase_session` ni
-- dans les tables DSAR : elle ne porte ni session, ni visiteur, ni identité, ni
-- message — seulement une app, un runtime, une release et un nom de capacité.
-- L'y ajouter demanderait une colonne `session_id` qui n'existe pas, et la
-- requête d'effacement d'une personne échouerait. Voir `apps/console/lib/dsar.ts`.
--
-- Aucune projection, aucun quota : cette table ne compte aucun événement de
-- télémétrie. Un lot qui ne fait que redéclarer ses capacités n'ajoute pas une
-- ligne de plus au métering.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.rum_session') is null then
    raise exception 'v82 : schema.sql (rum_session) doit être appliqué avant ce fichier';
  end if;
  if to_regclass('public.app_registry') is null then
    raise exception 'v82 : migration-v03 (app_registry) doit être appliquée avant ce fichier';
  end if;
end $$;

-- ── 1. Runtime de l'émetteur d'une session ──────────────────────────────────

alter table rum_session add column if not exists runtime text;

alter table rum_session
  drop constraint if exists rum_session_runtime_v82,
  add constraint rum_session_runtime_v82 check (
    runtime is null or (char_length(runtime) between 1 and 40 and runtime !~ '[[:cntrl:]]')
  ) not valid;

comment on column rum_session.runtime is
  'Runtime de l''émetteur, figé à la première vue : react_native, browser, ou NULL quand '
  'aucun marqueur de SDK MIP ne le désigne. Jamais déduit de l''user-agent : c''est la '
  'population de l''écran /mobile, et un dénominateur deviné n''est pas un dénominateur';

-- Index de la cohorte /mobile. Voir § 4 pour la mesure ; la garde refuse un build
-- bloquant sur une table chaude plutôt que de figer l'ingestion.
do $$
begin
  if pg_total_relation_size('public.rum_session') > 33554432
     and to_regclass('public.idx_session_app_runtime_v82') is null then
    raise exception 'v82: précréer idx_session_app_runtime_v82 avec predeploy-v82-indexes.sql';
  end if;
end $$;

create index if not exists idx_session_app_runtime_v82 on rum_session (app_id, runtime, started_at);

comment on index idx_session_app_runtime_v82 is
  'Cohorte de l''écran /mobile : sessions d''un runtime COMMENÇANT dans la fenêtre. '
  'Mesuré : 27,1 → 3,6 ms sur 24 h, 47,1 → 25,5 ms sur 7 j (120 000 sessions). '
  'idx_session_app_last_seen (v61) ne sert pas : il borne last_seen_at, pas started_at.';

-- ── 2. Capacités déclarées par app, runtime et release ──────────────────────

create table if not exists mobile_capabilities (
  id                uuid primary key default gen_random_uuid(),
  app_id            text not null references app_registry (app_id) on delete cascade,
  runtime           text not null,
  -- NULL = l'application n'a pas déclaré de version. « Inconnue », pas « ».
  release           text,
  capability        text not null,
  -- Déclaration CLIENT : ce que le SDK croit avoir installé. Pas une preuve.
  declared          boolean not null,
  first_declared_at timestamptz not null default now(),
  last_declared_at  timestamptz not null default now(),
  -- Recette OPÉRATEUR, et elle seule. Aucun chemin d'ingestion n'écrit ces trois
  -- colonnes ; la console ne les écrit pas non plus (console_ro n'a que select).
  verified_at       timestamptz,
  verified_by       text,
  verified_note     text,
  constraint mobile_capabilities_v82 check (
    char_length(runtime) between 1 and 40 and runtime !~ '[[:cntrl:]]' and
    char_length(capability) between 1 and 60 and capability !~ '[[:cntrl:]]' and
    (release is null or (char_length(release) between 1 and 120 and release !~ '[[:cntrl:]]')) and
    (verified_by is null or (char_length(verified_by) between 1 and 200 and verified_by !~ '[[:cntrl:]]')) and
    (verified_note is null or char_length(verified_note) <= 1000) and
    -- Une note ou un auteur de vérification sans date de vérification décrirait
    -- une recette qui n'a pas eu lieu.
    (verified_at is not null or (verified_by is null and verified_note is null)) and
    first_declared_at <= last_declared_at
  )
);

-- `nulls not distinct` (PostgreSQL 15) : deux déclarations SANS release sont la
-- même ligne. Sans cette clause, chaque lot d'une application qui ne déclare pas
-- sa version ajouterait six lignes de plus, indéfiniment.
create unique index if not exists mobile_capabilities_cle_v82
  on mobile_capabilities (app_id, runtime, release, capability) nulls not distinct;

comment on table mobile_capabilities is
  'Ce qu''un runtime mobile DÉCLARE collecter, par app, runtime et release. Une ligne '
  'declared=false dit « le SDK a regardé et n''a rien pu installer » ; l''absence de ligne dit '
  '« personne n''a rien dit ». Les deux s''affichent « Non collecté » et « Inconnu », jamais 0';
comment on column mobile_capabilities.declared is
  'Déclaration du CLIENT. Elle dit ce que le SDK croit avoir installé, pas qu''un signal a été reçu';
comment on column mobile_capabilities.verified_at is
  'Recette d''opérateur uniquement : un signal réellement reçu, lu et affiché sur un appareil. '
  'Aucun chemin d''ingestion n''écrit cette colonne — un booléen client ne vaut pas un test passé';
comment on column mobile_capabilities.release is
  'Version applicative déclarée, ou NULL quand l''application n''en déclare aucune';

-- ── 3. RLS et droits ────────────────────────────────────────────────────────
-- Table créée après v47 : elle pose sa propre policy, la boucle de découverte de
-- v47 ayant déjà tourné. LECTURE SEULE pour la console : une capacité se déclare
-- depuis le SDK, elle ne se coche pas dans une interface — et `verified_at`
-- appartient à une recette d'opérateur, hors du périmètre d'un rôle applicatif.

alter table mobile_capabilities enable row level security;
drop policy if exists tenant_scope on mobile_capabilities;
create policy tenant_scope on mobile_capabilities
  for all to console_ro
  using (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on mobile_capabilities from console_ro;
    grant select on mobile_capabilities to console_ro;
  end if;
  -- Rôles de l'ancienne API publique : aucun droit, même par défaut.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on mobile_capabilities from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on mobile_capabilities from authenticated;
  end if;
end $$;

-- ── 4. Rétention et effacement d'app ────────────────────────────────────────
-- Reprise INTÉGRALE des définitions de migration-v80, plus `mobile_capabilities`.
-- Une app effacée ne doit rien laisser derrière elle, pas même la liste de ce que
-- son SDK déclarait collecter — elle nomme ses releases.
--
-- ET UNE RÉPARATION. v80 a repris `erase_app_data` depuis v72 au lieu de v79 :
-- les deux lignes que v79 venait d'ajouter — `analytics_saved_view` et
-- `dashboard` — ont disparu sans que rien ne le signale, exactement le défaut
-- que v79 documentait déjà pour v61. Un effacement d'app laisse donc aujourd'hui
-- derrière lui les analyses enregistrées et les tableaux de bord scopés sur
-- elle, avec leurs titres et leurs filtres. Les deux lignes sont remises ici.
-- Les tableaux transverses (`app_id` NULL) restent préservés, comme v18 le prévoyait.
--
-- Pour la rétention, la borne est `last_declared_at` : une déclaration qu'aucun
-- lot n'a rafraîchie depuis la fenêtre de rétention décrit une release qui
-- n'émet plus. Les release toujours actives se redéclarent à chaque lot.

create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_event_index where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action a
   where a.app_id = p_app_id and a.ts < p_cutoff
     and not exists (select 1 from rum_error x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_resource x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_breadcrumb x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_span x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_event x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id and last_seen < p_cutoff;   get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from rum_resource    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);
  delete from mobile_capabilities where app_id = p_app_id and last_declared_at < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('mobile_capabilities', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event x where x.session_id = s.session_id)
     and not exists (select 1 from rum_span x where x.session_id = s.session_id)
     and not exists (select 1 from rum_action x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event_index x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from sourcemap_upload_token
   where app_id = p_app_id and least(expires_at, coalesce(revoked_at, expires_at)) < p_cutoff;
  get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  return result;
end $$;

create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from ingest_raw      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from error_grouping_config where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_grouping_config', n);
  delete from rum_resource    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);
  delete from mobile_capabilities where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('mobile_capabilities', n);
  delete from route_pattern where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from sourcemap_upload_token where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  delete from syn_snapshot where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from analytics_saved_view where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_saved_view', n);
  delete from dashboard where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('dashboard', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;
