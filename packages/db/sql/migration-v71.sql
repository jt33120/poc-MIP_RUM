-- migration-v71 — P5.4 : source maps automatisables et symbolication partagée.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v70 est réservée à P5.3 : aucun
-- objet de ce fichier n'en dépend, ni l'inverse.
--
--   1. sourcemap : empreinte SHA-256, taille et date de mise en ligne CALCULÉES
--      PAR LA BASE (déclencheur), auteur de la mise en ligne. `size_bytes` (v13)
--      est déjà la taille en octets : réutilisée, pas doublée.
--   2. sourcemap_upload_token : jetons de CI dédiés, app-scopés, expirants,
--      révocables sans suppression ; seul le hash du secret est stocké.
--   3. purge_rum_app / erase_app_data : les jetons morts suivent la rétention,
--      tous les jetons suivent l'effacement d'une app.
--   4. rum_error : statut et résultat de la symbolication faite à l'ingestion.
--
-- FENÊTRE DE DÉPLOIEMENT. Le code P5.4 publié AVANT ce fichier écrit et lit
-- rum_error comme avant (colonnes détectées), symbolique à la lecture et répond
-- 503 aux uploads. Le code d'AVANT P5.4 encore en service après ce fichier écrit
-- ses maps par l'ancien upsert : le déclencheur recalcule empreinte, taille et
-- date, donc aucune ligne ne peut porter une empreinte fausse.
--
-- VERROUS. rum_error est la table la plus chaude : son `alter table` vient EN
-- DERNIER, pour que le verrou exclusif ne soit pas tenu pendant le calcul des
-- empreintes des maps existantes. `lock_timeout` borne chaque attente : s'il
-- expire, le fichier entier est annulé et le déploiement rejoué.
set local lock_timeout = '5s';

-- ── 1. sourcemap ────────────────────────────────────────────────────────────
alter table sourcemap
  add column if not exists checksum text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists uploaded_by text;

-- Rattrapage des maps existantes (table froide, quelques lignes par release).
-- `created_at` valait la date du dernier upsert : c'est la date de mise en ligne
-- du contenu présent.
update sourcemap
   set checksum = encode(sha256(convert_to(content, 'UTF8')), 'hex'),
       size_bytes = octet_length(content),
       uploaded_at = coalesce(uploaded_at, created_at)
 where checksum is null or uploaded_at is null;

alter table sourcemap
  alter column checksum set not null,
  alter column uploaded_at set not null;

-- Empreinte, taille et date suivent le contenu, quel que soit l'écrivain : la
-- console, le backend direct, l'ancien upsert ou une requête manuelle. Une mise
-- à jour qui ne change pas le contenu ne peut pas les modifier.
create or replace function sourcemap_empreinte_v71() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content then
    new.checksum := old.checksum;
    new.size_bytes := old.size_bytes;
    new.uploaded_at := old.uploaded_at;
  else
    new.checksum := encode(sha256(convert_to(new.content, 'UTF8')), 'hex');
    new.size_bytes := octet_length(new.content);
    new.uploaded_at := now();
  end if;
  return new;
end $$;

drop trigger if exists sourcemap_empreinte_v71 on sourcemap;
create trigger sourcemap_empreinte_v71
  before insert or update on sourcemap
  for each row execute function sourcemap_empreinte_v71();

comment on column sourcemap.checksum is
  'SHA-256 hex du contenu (octets UTF-8), calculé par le déclencheur sourcemap_empreinte_v71';
comment on column sourcemap.size_bytes is 'Taille du contenu en octets, calculée par le déclencheur depuis v71';
comment on column sourcemap.uploaded_at is 'Mise en ligne du contenu présent (created_at = premier upload)';
comment on column sourcemap.uploaded_by is
  'Email admin (console) ou jeton:<uuid> (CI) ; NULL pour une map antérieure à v71';

-- ── 2. sourcemap_upload_token ───────────────────────────────────────────────
create table if not exists sourcemap_upload_token (
  id           uuid primary key,
  app_id       text not null references app_registry (app_id) on delete cascade,
  name         text not null,
  secret_hash  text not null,
  scope        text not null default 'sourcemaps:write',
  created_at   timestamptz not null default now(),
  created_by   text not null,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoked_by   text,
  last_used_at timestamptz,
  constraint sourcemap_upload_token_v71 check (
    char_length(name) between 1 and 100 and name !~ '[[:cntrl:]]' and
    secret_hash ~ '^[0-9a-f]{64}$' and
    scope = 'sourcemaps:write' and
    expires_at > created_at and expires_at <= created_at + interval '90 days' and
    char_length(created_by) between 1 and 320 and
    (revoked_at is null) = (revoked_by is null)
  )
);

create index if not exists idx_sourcemap_upload_token_app_v71
  on sourcemap_upload_token (app_id, created_at desc);

comment on table sourcemap_upload_token is
  'Jetons de CI dédiés à l''upload de source maps (privilège unique sourcemaps:write), '
  'app-scopés et expirants. Distincts des jetons de lecture ; secret jamais stocké en clair.';
comment on column sourcemap_upload_token.secret_hash is
  'SHA-256 hex du secret (256 bits aléatoires), comparé en temps constant par l''application';

-- Table créée après v47 : policy explicite, fermée sans portée tenant. La
-- console n'y écrit que la création et la révocation ; aucune suppression, la
-- trace reste jusqu'à la purge de rétention.
alter table sourcemap_upload_token enable row level security;
drop policy if exists tenant_scope on sourcemap_upload_token;
create policy tenant_scope on sourcemap_upload_token
  for all to console_ro
  using (app_id = any (current_app_ids()))
  with check (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on sourcemap_upload_token from console_ro;
    grant select, insert on sourcemap_upload_token to console_ro;
    grant update (revoked_at, revoked_by, last_used_at) on sourcemap_upload_token to console_ro;
  end if;
  -- Rôles de l'ancienne API publique : aucun droit, même par défaut.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on sourcemap_upload_token from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on sourcemap_upload_token from authenticated;
  end if;
end $$;

-- ── 3. Rétention et effacement ──────────────────────────────────────────────
-- Reprise intégrale des définitions de migration-v67, plus les jetons. Rétention :
-- un jeton révoqué ou expiré avant la date de coupure est purgé ; un jeton
-- actif ne l'est jamais. Effacement d'une app : tous ses jetons.
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
  delete from rum_resource    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);

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
  delete from route_pattern where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from sourcemap_upload_token where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  delete from syn_snapshot where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

-- ── 4. rum_error : symbolication à l'ingestion ──────────────────────────────
-- Nullable, sans défaut : ajout de métadonnées seul. `fingerprint` et `stack`
-- restent la source brute ; la stack symboliquée ne sert qu'à l'affichage et ne
-- change jamais l'identité d'un groupe.
alter table rum_error
  add column if not exists symbolication_status text,
  add column if not exists stack_symbolicated text;

-- NOT VALID : les lignes antérieures portent NULL et satisfont la règle ; la
-- valider parcourrait toute la table sous verrou pour ne rien prouver de plus.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rum_error'::regclass
       and conname = 'rum_error_symbolication_v71'
  ) then
    alter table rum_error add constraint rum_error_symbolication_v71 check (
      (symbolication_status is null or
        symbolication_status in ('pending', 'resolved', 'unavailable', 'failed')) and
      (stack_symbolicated is null or
        (symbolication_status = 'resolved' and char_length(stack_symbolicated) <= 8000))
    ) not valid;
  end if;
end $$;

comment on column rum_error.symbolication_status is
  'Symbolication à l''ingestion : resolved, unavailable (aucune map ou position), failed (map inutilisable), '
  'pending (budget épuisé, tentée à la lecture) ; NULL sans frame JavaScript';
comment on column rum_error.stack_symbolicated is
  'Stack réécrite en positions source et rescrubbée (8 000 caractères au plus) ; stack reste la version brute';
