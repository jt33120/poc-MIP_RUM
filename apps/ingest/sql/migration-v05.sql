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
