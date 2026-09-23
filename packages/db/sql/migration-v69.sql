-- migration-v69 — P5.1 : enveloppe d'erreur fiable et corrélation.
--
-- Additif, sans backfill et sans index. Chaque occurrence d'erreur garde
-- désormais sa propre corrélation (trace, span parent), sa source et son
-- caractère géré/fatal quand ils sont connus, ainsi que le snapshot P2 déjà
-- parsé à l'ingestion (contexte, vue, identités HMAC) et l'environnement/service
-- déclarés par l'émetteur. Les colonnes historiques (fingerprint, stack, release,
-- occurrences, action_id) ne changent pas.
--
-- VERROU. `alter table` prend un ACCESS EXCLUSIVE sur rum_error jusqu'au commit
-- (le runner applique chaque fichier dans une transaction). Tant qu'il attend,
-- toute ingestion est suspendue derrière lui : on borne donc l'attente. Si le
-- délai expire, le fichier entier est annulé et le déploiement rejoué ; le code
-- tolère déjà un schéma sans v69 (détection des colonnes à l'écriture comme à la
-- lecture).
--
-- CONTRAINTE NOT VALID. Les lignes antérieures portent NULL/'{}' dans ces
-- colonnes et satisfont donc la règle : la valider imposerait un parcours complet
-- de la table la plus chaude sous ce même verrou, pour ne rien prouver de plus.
-- Elle s'applique à toute écriture future, quel que soit l'émetteur.
--
-- PAS D'INDEX. Aucun lecteur P5.1 n'en consomme : l'existence d'une trace se
-- vérifie par rum_span_trace_idx, et les occurrences d'un groupe par
-- idx_error_fingerprint. La projection rum_event_index n'est pas modifiée : sa
-- taxonomie fermée est revalidée par migration-v67 à chaque rejeu des tests, et
-- aucun lecteur P5.1 n'y cherche la source d'une erreur.
set local lock_timeout = '5s';

alter table rum_error
  add column if not exists trace_id text,
  add column if not exists source_parent_span_id text,
  add column if not exists error_source text,
  add column if not exists handled boolean,
  add column if not exists is_fatal boolean,
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists view_id text,
  add column if not exists view_name text,
  add column if not exists user_id_hash text,
  add column if not exists account_id_hash text,
  add column if not exists env text,
  add column if not exists service text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rum_error'::regclass
       and conname = 'rum_error_envelope_v69'
  ) then
    alter table rum_error add constraint rum_error_envelope_v69 check (
      (trace_id is null or (trace_id ~ '^[0-9a-f]{32}$' and trace_id !~ '^0{32}$')) and
      (source_parent_span_id is null or
        (source_parent_span_id ~ '^[0-9a-f]{16}$' and source_parent_span_id !~ '^0{16}$')) and
      (error_source is null or error_source in (
        'browser_js', 'browser_console', 'browser_resource', 'browser_csp', 'browser_network',
        'node', 'python', 'react_native_js', 'native', 'otel'
      )) and
      jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768 and
      (view_id is null or char_length(view_id) <= 100) and
      (view_name is null or char_length(view_name) <= 100) and
      (user_id_hash is null or user_id_hash ~ '^[0-9a-f]{64}$') and
      (account_id_hash is null or account_id_hash ~ '^[0-9a-f]{64}$') and
      (env is null or char_length(env) <= 120) and
      (service is null or char_length(service) <= 120)
    ) not valid;
  end if;
end $$;

comment on column rum_error.trace_id is
  'Trace OTLP native de l''occurrence (32 hex non nuls) ; NULL si absente ou synthétique';
comment on column rum_error.source_parent_span_id is
  'Span parent OTLP natif (16 hex non nuls) ; valider son app avant tout lien';
comment on column rum_error.error_source is
  'Taxonomie fermée de la source (browser_js, react_native_js…) ; NULL si l''émetteur est inconnu';
comment on column rum_error.handled is 'Erreur capturée volontairement (true) ou non interceptée (false) ; NULL si inconnu';
comment on column rum_error.is_fatal is 'Fatalité déclarée par l''émetteur ; jamais déduite, NULL si inconnue';
comment on column rum_error.context is 'Snapshot P2 borné et scrubbed au moment de l''émission';
comment on column rum_error.user_id_hash is 'HMAC-SHA256 app-scopé ; jamais un identifiant brut';
comment on column rum_error.account_id_hash is 'HMAC-SHA256 app-scopé ; jamais un identifiant brut';
comment on column rum_error.env is 'Environnement déclaré par l''émetteur (défaut du SDK web : dev) ; pas une vérité de déploiement';
comment on column rum_error.service is 'Service déclaré par un émetteur backend ; NULL pour les SDK RUM MIP';
