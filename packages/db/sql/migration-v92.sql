-- migration-v92 — C11 : un jeton de CI porte un privilège parmi deux.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v91 (SSO) est le fichier précédent.
-- Les rôles de C13 (`mip_console`, `mip_identity`) glissent à v93.
--
-- POURQUOI. `POST /api/v1/deploys` — le marqueur de déploiement qu'une CI pose —
-- s'authentifie aujourd'hui par un jeton de CONSOLE_API_TOKENS : une variable
-- d'environnement de Vercel, qui est aussi un jeton de LECTURE de l'API. En C11,
-- la route passe au collector, qui ne lit aucun de ces jetons : il vérifie les
-- jetons de CI en base (`sourcemap_upload_token`, P5.4) — une application, une
-- expiration, révocables depuis la console, le secret haché. Une CI qui pose ses
-- source maps ET ses marqueurs reçoit deux jetons, un par privilège : la fuite de
-- l'un n'ouvre pas l'autre.
--
-- CE QUI CHANGE. `scope` accepte `deploys:write` à côté de `sourcemaps:write`.
-- Rien d'autre : la table garde son nom (le code parle de « jeton de CI »). La
-- contrainte est remplacée sous un nouveau nom, pour qu'un rejeu partiel se voie.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sourcemap_upload_token_v92') then
    alter table sourcemap_upload_token add constraint sourcemap_upload_token_v92 check (
      char_length(name) between 1 and 100 and name !~ '[[:cntrl:]]' and
      secret_hash ~ '^[0-9a-f]{64}$' and
      scope in ('sourcemaps:write', 'deploys:write') and
      expires_at > created_at and expires_at <= created_at + interval '90 days' and
      char_length(created_by) between 1 and 320 and
      (revoked_at is null) = (revoked_by is null)
    );
  end if;
  -- L'ancienne n'est retirée qu'une fois la nouvelle en place : à aucun moment la
  -- table n'est sans garde.
  if exists (select 1 from pg_constraint where conname = 'sourcemap_upload_token_v71') then
    alter table sourcemap_upload_token drop constraint sourcemap_upload_token_v71;
  end if;
end $$;

comment on table sourcemap_upload_token is
  'Jetons de CI (P5.4, C11) : un privilège par jeton — sourcemaps:write (upload de source maps) '
  'ou deploys:write (marqueur de déploiement) —, app-scopés et expirants. Distincts des jetons de '
  'lecture ; secret jamais stocké en clair.';
