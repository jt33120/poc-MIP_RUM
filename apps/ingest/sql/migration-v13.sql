-- migration-v13 : dé-minification des erreurs (P0 #3 — source maps).
-- 1. release sur rum_error (version de l'app émettrice, attribut SDK mip.release)
--    → associe une erreur à la bonne source map.
-- 2. table sourcemap : une source map v3 par (app, release, fichier minifié),
--    uploadée via POST /api/sourcemaps. La console dé-minifie les stacks à
--    l'affichage (lib/sourcemap.ts), jamais à l'ingestion (lazy, seulement vu).
-- Idempotente.

alter table rum_error add column if not exists release text;
create index if not exists idx_error_release on rum_error (app_id, release) where release is not null;

create table if not exists sourcemap (
  app_id     text not null,
  release    text not null,
  filename   text not null,                 -- nom du fichier minifié (ex: main.abc123.js)
  content    text not null,                 -- JSON de la source map v3
  size_bytes int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (app_id, release, filename)
);

comment on table sourcemap is
  'Source maps v3 par app/release/fichier — dé-minification des stacks (P0 #3). Uploadées via /api/sourcemaps.';

-- Accès console : RLS + CRUD pour console_ro (l'admin uploade/upserte via la console,
-- cf. DEPLOY.md ; motif cro_all_user de v0.3). Sans ce bloc, l'upload de source map
-- échouerait en "permission denied" et la lecture (dé-minification) renverrait 0 ligne.
-- Local/CI : rôle absent ⇒ sauté (connexion propriétaire, bypass RLS).
alter table sourcemap enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update, delete on sourcemap to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'sourcemap' and policyname = 'cro_all_sourcemap') then
      create policy cro_all_sourcemap on sourcemap for all to console_ro using (true) with check (true);
    end if;
  end if;
end $$;
