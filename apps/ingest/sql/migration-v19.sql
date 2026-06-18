-- migration-v19 : complète la parité console_ro pour app_registry (LECTURE).
-- Suite des findings #1 / v16 : la v05 n'accordait à console_ro que INSERT/UPDATE
-- (+ policies cro_ins/cro_upd) ; le GRANT SELECT + la policy cro_sel_app_registry
-- n'existaient QU'EN PROD (posés à la main). Sans eux, registeredApps()/listApps()
-- — donc le sélecteur d'app de toute la console ET /api/metrics (auto-observabilité)
-- — renverraient 0 lignes sous console_ro sur un déploiement propre / une reprise (DR),
-- alors que CI/local (connexion propriétaire) restent verts.
-- Idempotent, gardé par l'existence du rôle, NOM de policy identique au live (→ no-op
-- exact sur la prod existante).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on app_registry to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'app_registry' and policyname = 'cro_sel_app_registry') then
      create policy cro_sel_app_registry on app_registry for select to console_ro using (true);
    end if;
  end if;
end $$;
