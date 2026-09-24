-- P2 — contexte navigateur, identité métier pseudonymisée et événements manuels.
-- Additif : le code détecte ces colonnes et continue d'ingérer avant migration.

alter table rum_session
  add column if not exists user_id_hash text,
  add column if not exists account_id_hash text,
  add column if not exists context jsonb not null default '{}'::jsonb;

alter table rum_event
  add column if not exists event_type text,
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists user_id_hash text,
  add column if not exists account_id_hash text,
  add column if not exists view_id text,
  add column if not exists view_name text,
  add column if not exists action_id text,
  add column if not exists timing_ms double precision,
  add column if not exists feature_flag_value text;

alter table rum_event_index
  add column if not exists event_type text,
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists user_id_hash text,
  add column if not exists account_id_hash text,
  add column if not exists view_id text,
  add column if not exists view_name text,
  add column if not exists action_id text,
  add column if not exists timing_ms double precision,
  add column if not exists feature_flag_value text;

do $$
begin
  alter table rum_session drop constraint if exists rum_session_identity_hashes_v66;
  alter table rum_session add constraint rum_session_identity_hashes_v66 check (
    jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768 and
    (user_id_hash is null or user_id_hash ~ '^[0-9a-f]{64}$') and
    (account_id_hash is null or account_id_hash ~ '^[0-9a-f]{64}$')
  );
  alter table rum_event drop constraint if exists rum_event_context_v66;
  alter table rum_event add constraint rum_event_context_v66 check (
    jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768 and
    (event_type is null or event_type in ('custom','view','action','timing','feature_flag','error')) and
    (user_id_hash is null or user_id_hash ~ '^[0-9a-f]{64}$') and
    (account_id_hash is null or account_id_hash ~ '^[0-9a-f]{64}$') and
    (timing_ms is null or timing_ms >= 0)
  );
  alter table rum_event_index drop constraint if exists rum_event_index_context_v66;
  alter table rum_event_index add constraint rum_event_index_context_v66 check (
    jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768 and
    (event_type is null or event_type in ('custom','view','action','timing','feature_flag','error')) and
    (user_id_hash is null or user_id_hash ~ '^[0-9a-f]{64}$') and
    (account_id_hash is null or account_id_hash ~ '^[0-9a-f]{64}$') and
    (timing_ms is null or timing_ms >= 0)
  );
end $$;

create index if not exists idx_session_user_identity_v66 on rum_session (app_id, user_id_hash) where user_id_hash is not null;
create index if not exists idx_session_account_identity_v66 on rum_session (app_id, account_id_hash) where account_id_hash is not null;
create index if not exists idx_event_user_identity_v66 on rum_event (app_id, user_id_hash, ts desc) where user_id_hash is not null;
create index if not exists idx_event_account_identity_v66 on rum_event (app_id, account_id_hash, ts desc) where account_id_hash is not null;
create index if not exists idx_event_context_v66 on rum_event using gin (context jsonb_path_ops);
create index if not exists idx_event_index_context_v66 on rum_event_index using gin (context jsonb_path_ops);

comment on column rum_session.user_id_hash is 'HMAC-SHA256 app-scopé ; jamais un identifiant brut';
comment on column rum_session.account_id_hash is 'HMAC-SHA256 app-scopé ; jamais un identifiant brut';
comment on column rum_event.context is 'Snapshot borné et scrubbed au moment de l émission';
