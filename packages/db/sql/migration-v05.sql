-- Migration v0.5 — onboarding clients self-service (page /admin/customers).
-- Idempotente. Les origines CORS passent du code (const en dur dans l'edge
-- function) à la base : ajouter un client ne demande plus aucun redéploiement.

alter table app_registry add column if not exists allowed_origins text[] not null default '{}';
alter table app_registry add column if not exists created_by text;
alter table app_registry add column if not exists notes text;

-- Backfill des apps existantes (uniquement si la colonne vient d'arriver :
-- on ne touche pas une liste déjà renseignée).
update app_registry set allowed_origins = array['https://plateforme.groupement-it.com']
  where app_id = 'gip-plateforme' and allowed_origins = '{}';
update app_registry set allowed_origins = array['http://localhost:8080']
  where app_id = 'demo-app' and allowed_origins = '{}';
update app_registry set allowed_origins = array['https://mip-rum-console.vercel.app']
  where app_id = 'mip-rum-console' and allowed_origins = '{}';

-- Cloud : la console écrit dans le registre (création client, clé, origines).
-- Grant + politiques RLS (le grant seul est inerte, RLS activé sur la table —
-- motif v0.3 identique à cro_all_user). Local (docker, superuser) : rôle absent, sauté.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant insert, update on app_registry to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'app_registry' and policyname = 'cro_ins_app_registry') then
      create policy cro_ins_app_registry on app_registry for insert to console_ro with check (true);
    end if;
    if not exists (select 1 from pg_policies where tablename = 'app_registry' and policyname = 'cro_upd_app_registry') then
      create policy cro_upd_app_registry on app_registry for update to console_ro using (true) with check (true);
    end if;
  end if;
end $$;
