-- migration-v95 — Recette du 26/09/2026 : une échéance pour les jetons de lecture.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v94 (SLO d'erreurs navigateur) est le
-- fichier précédent.
--
-- Un jeton de lecture sans fin reste valable tant que personne ne pense à le
-- révoquer. Les jetons de CI des source maps en ont une (1 à 90 jours) ; ceux de
-- lecture n'en avaient pas. La console propose désormais 30, 90 (défaut), 180 ou
-- 365 jours à la création, et `/api/rum/summary` refuse un jeton échu.
--
-- NULL = jeton créé avant cette migration, sans échéance : il reste valable jusqu'à
-- sa révocation — aucun jeton en service n'est coupé par la migration.
--
-- Droits : `mip_api` (v89) et `mip_console` (v93) ont des privilèges au niveau de la
-- TABLE `read_tokens`, donc la nouvelle colonne leur est lisible sans nouveau grant.
-- Tant que cette migration n'est pas appliquée, la console lit l'échéance par
-- `to_jsonb(t) ->> 'expires_at'` (NULL) et n'en propose pas à la création.
alter table read_tokens add column if not exists expires_at timestamptz;

comment on column read_tokens.expires_at is
  'Échéance du jeton de lecture (création + 30 à 365 jours) ; NULL = jeton antérieur, sans échéance.';
