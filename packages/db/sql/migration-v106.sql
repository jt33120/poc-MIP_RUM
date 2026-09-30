-- migration-v106 — Les statistiques servies par l'API v1 (30/09/2026) : `mip_api`
-- lit les constats détectés et les marqueurs de déploiement.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucune donnée ne bouge : deux droits
-- de LECTURE et leurs policies, pour le rôle du service `api` seul. Numérotée
-- v106 : v104 est fusionnée, v105 est prise par une PR ouverte (alertes « hors
-- collecte ») ; elle ne touche aucun objet de l'une ni de l'autre.
--
-- v104 accorde `signal_detecte` à `mip_console` et le refusait à `mip_api` parce
-- que le bundle du service `api` ne nommait pas la table. Il la nomme désormais :
-- d'où ce fichier, et non une modification de v104 (figée).
--
-- POURQUOI. Les statistiques que la console calculait au rendu passent dans l'API
-- v1 (paquet `@mip/stats`), que le service `api` sert sous `mip_api` (v89) :
--   · `GET /api/v1/detections` lit `signal_detecte` (v101) : les épisodes écrits
--     par le travail `detections_horaires` du scheduler, avec la plage habituelle
--     qu'il y a consignée ;
--   · `GET /api/v1/trends` lit `deploy_marker` (v32) pour dire qu'un déploiement
--     tombe à ± 1 jour d'une rupture datée — une coïncidence de date, rien de plus.
-- Sans ces droits, le service répondrait 500 là où la console, qui lit en
-- propriétaire, répond 200 : le contrat de parité (`tests/contract/api-parity.test.ts`,
-- service lancé SOUS `mip_api`) le verrait.
--
-- CE QUI NE CHANGE PAS.
--   · `deploy_marker` reste écrit par la seule route `POST /api/v1/deploys`, que le
--     service refuse (405) : `mip_api` n'y gagne que le SELECT.
--   · `vital_horaire` (v101) n'est PAS accordé : l'API ne sert pas la série
--     horaire, seulement les épisodes et la plage que le scheduler a déjà écrits.
--   · Même politique que v89 § 5 : la policy `mip_api_lecture` est `using (true)`
--     pour `mip_api` seul ; le périmètre du jeton est appliqué par la requête
--     (`app_id = any($1)`), comme pour toute lecture v1. Elle ne vise ni
--     `console_ro` ni PUBLIC : les policies permissives ne se combinent qu'entre
--     policies du même rôle (`scripts/verify-tenant-isolation.mjs`).
--
-- La liste blanche est tenue dans `packages/db/roles/mip-api.mjs` (`AJOUTEES`) ;
-- `scripts/ci/verify-db-roles.mjs` compare les droits réels à cette liste.

set local lock_timeout = '3s';

grant select on table signal_detecte, deploy_marker to mip_api;

do $$
declare
  t text;
begin
  foreach t in array array['signal_detecte', 'deploy_marker'] loop
    if not exists (select 1 from pg_policy p where p.polrelid = format('public.%I', t)::regclass
                      and p.polname = 'mip_api_lecture') then
      execute format('create policy mip_api_lecture on public.%I as permissive for select to mip_api using (true)', t);
    end if;
  end loop;
end $$;
