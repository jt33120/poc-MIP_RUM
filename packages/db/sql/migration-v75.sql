-- migration-v75 — P6.1 : dimensions aux bonnes frontières.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucun backfill : les lignes
-- antérieures gardent NULL, affiché « Inconnu » ; un enrichissement rétrospectif
-- relève de P8. Aucune identité, rétention, policy ni fonction n'est modifiée :
-- les colonnes vivent sur des tables déjà couvertes par RLS, purge_rum_app,
-- erase_session, erase_app_data et les exports DSAR (`select *`).
--
--   1. rum_session : navigateur et système (famille ≤ 80 caractères, version
--      majeure ≤ 120), déduits de l'user-agent déjà collecté
--      (_shared/dimensions.mjs). La classe d'appareil reste `device_type`,
--      tablette comprise pour les nouvelles sessions.
--   2. Signaux consommés par les analyses — vues, vitals, actions, ressources,
--      long tasks, événements, spans — et projection rum_event_index : env et
--      release DE L'ÉVÉNEMENT, service sur les spans et la projection. Relue sur
--      la session, une release décrirait le passé avec une valeur posée plus tard :
--      `rum_session.release` reste la première release vue et n'est recopiée
--      nulle part. rum_error porte déjà release, env et service (v69).
--   3. Contraintes NOT VALID sur ces seules colonnes neuves, aux bornes exactes de
--      l'ingestion. Les lignes antérieures (NULL) les respectent : les valider
--      parcourrait des tables chaudes sous verrou sans rien prouver de plus.
--
-- FENÊTRE DE DÉPLOIEMENT. Le code P6.1 publié avant ce fichier détecte l'absence
-- des colonnes (pg-ingest.mjs) et écrit comme avant ; la console rend les
-- sélecteurs de valeurs indisponibles. Le code antérieur encore en service après
-- ce fichier n'écrit pas ces colonnes : NULL, donc inconnu. AUCUNE contrainte ne
-- porte sur une colonne existante : une release longue ou un `device_type`
-- « ios » écrits par l'ancien code ne peuvent pas faire échouer un lot.
--
-- INDEX : AUCUN, et c'est mesuré. PostgreSQL 15 jetable, 1,56 M de signaux et
-- autant de vues sur 7 jours (app A 1,2 M, B 300 k, C 60 k), 500 k sessions :
--   • sélecteur de valeurs, seul lecteur livré : 7 jours 392 ms (signaux, via
--     (app_id, ts) et l'index partiel des sessions robots), 37 ms (sessions, via
--     idx_session_app_seen). Un index (app_id, release, ts) construit n'y est pas
--     choisi.
--   • filtre release ou env sur une fenêtre, lecture que P6.2 n'a pas encore
--     écrite : 100 à 120 ms en parcours séquentiel, 0,4 à 7 ms avec (app_id,
--     release|env, ts), pour 60 Mio d'index par table. Le premier lecteur qui en
--     dépend le crée, sur sa table, avec son pré-déploiement CONCURRENTLY.
-- Construits ici, ces index bloqueraient l'écriture des tables les plus chaudes
-- pendant leur construction, pour des lectures qui n'existent pas encore.
--
-- VERROUS. Chaque `alter table` prend un ACCESS EXCLUSIVE tenu jusqu'au commit
-- (le runner applique le fichier dans une transaction). Les tables sont prises
-- dans l'ordre où writeRows les écrit — session, vue, métrique, action,
-- ressource, long task, événement, span, projection — : une ingestion en cours et
-- la migration s'attendent l'une l'autre au lieu de s'interbloquer. Chaque
-- instruction ne modifie que le catalogue. `lock_timeout` borne chaque attente ;
-- s'il expire, le fichier entier est annulé et le déploiement rejoué.
set local lock_timeout = '5s';

-- ── 1. Session : navigateur et système ──────────────────────────────────────
alter table rum_session
  add column if not exists browser text,
  add column if not exists browser_version text,
  add column if not exists os text,
  add column if not exists os_version text,
  drop constraint if exists rum_session_dimensions_v75,
  add constraint rum_session_dimensions_v75 check (
    (browser is null or char_length(browser) between 1 and 80) and
    (browser_version is null or char_length(browser_version) between 1 and 120) and
    (os is null or char_length(os) between 1 and 80) and
    (os_version is null or char_length(os_version) between 1 and 120)
  ) not valid;

comment on column rum_session.browser is
  'Famille de navigateur déduite de l''user-agent (taxonomie fermée) ; NULL si inconnu, robot ou React Native';
comment on column rum_session.browser_version is 'Version majeure du navigateur ; NULL si inconnue';
comment on column rum_session.os is 'Système déduit de l''user-agent ou de la plateforme React Native ; NULL si inconnu ou robot';
comment on column rum_session.os_version is
  'Version majeure du système ; NULL si inconnue ou figée par le navigateur (Windows NT 10.0, macOS 10.15, Android 10; K)';

-- ── 2. Dimensions déclarées de chaque signal ────────────────────────────────
alter table rum_pageview
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_pageview_dimensions_v75,
  add constraint rum_pageview_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_metric
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_metric_dimensions_v75,
  add constraint rum_metric_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_action
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_action_dimensions_v75,
  add constraint rum_action_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_resource
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_resource_dimensions_v75,
  add constraint rum_resource_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_longtask
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_longtask_dimensions_v75,
  add constraint rum_longtask_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_event
  add column if not exists env text,
  add column if not exists release text,
  drop constraint if exists rum_event_dimensions_v75,
  add constraint rum_event_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120)
  ) not valid;

alter table rum_span
  add column if not exists env text,
  add column if not exists release text,
  add column if not exists service text,
  drop constraint if exists rum_span_dimensions_v75,
  add constraint rum_span_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120) and
    (service is null or char_length(service) between 1 and 120)
  ) not valid;

alter table rum_event_index
  add column if not exists env text,
  add column if not exists release text,
  add column if not exists service text,
  drop constraint if exists rum_event_index_dimensions_v75,
  add constraint rum_event_index_dimensions_v75 check (
    (env is null or char_length(env) between 1 and 120) and
    (release is null or char_length(release) between 1 and 120) and
    (service is null or char_length(service) between 1 and 120)
  ) not valid;

comment on column rum_pageview.release is
  'Release déclarée par l''émetteur au moment de la vue (mip.release bornée, jamais scrubbée) ; jamais relue sur la session';
comment on column rum_pageview.env is 'Environnement déclaré par l''émetteur au moment de la vue ; pas une vérité de déploiement';
comment on column rum_span.service is
  'Service déclaré par un émetteur backend (service.name) ; NULL pour les SDK RUM MIP';
comment on column rum_span.release is
  'Release du signal : mip.release, sinon service.version d''un backend ; NULL si inconnue';
comment on column rum_event_index.release is 'Release de la ligne source, recopiée à la projection';
