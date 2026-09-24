-- migration-v26.sql — Livrable UTI : tokens de lecture propriétaires.
-- Un token d'accès en LECTURE, SCOPÉ à un app_id, pour l'API /api/rum/summary.
-- On stocke un HASH (sha256 hex) du token, jamais le token en clair. La révocation
-- se fait par revoked_at (on ne supprime pas la ligne : trace conservée).

create table if not exists read_tokens (
  id          bigserial primary key,
  token_hash  text not null unique,      -- sha256 hex du token présenté
  app_id      text not null,             -- périmètre : le token ne lit que cet app_id
  label       text,                      -- libellé humain (ex. "UTI Supervision")
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz                -- null = actif
);

-- Recherche par hash sur les tokens actifs (chemin d'auth de l'endpoint).
create index if not exists idx_read_tokens_hash on read_tokens (token_hash) where revoked_at is null;

-- Accès console (lecture au runtime de l'auth + gestion admin ; pas de delete).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update on read_tokens to console_ro;
    grant usage, select on sequence read_tokens_id_seq to console_ro;
  end if;
end $$;
