-- migration-v107 — L'inscription en libre-service, plafonnée (vitrine du 30/09/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucune donnée ne bouge.
--
-- POURQUOI. La vitrine propose « S'inscrire » : un visiteur crée son compte et son
-- premier site en une fois (`POST /v1/auth/accounts`, servi par `console-api` sous
-- `mip_identity`), puis installe le capteur. Ouverte à l'internet, donc plafonnée
-- (décision du 30/09/2026) :
--   · par adresse IP : trois inscriptions par heure — le compteur `inscription_ip`
--     de `auth_throttle` (v90), une empreinte HMAC, jamais l'adresse ;
--   · pour toute la plateforme : `INSCRIPTIONS_PAR_JOUR` du service, compté sur
--     `console_user.inscrit_le` (ci-dessous) — la table elle-même, pas un compteur
--     de plus ;
--   · par compte : un site, créé avec le compte ; le compte n'en crée pas d'autre
--     (la création de site reste un geste de l'administrateur de la plateforme) ;
--   · par site : un débit de collecte plus bas que celui de la plateforme,
--     `app_registry.debit_max_min`, que le collecteur applique (`pg-ingest.mjs`).
--
-- VERROUS. Un `alter table` bref sur trois tables ; `lock_timeout` : s'il expire, le
-- migrateur annule le fichier et le rejoue.
set local lock_timeout = '3s';

-- 1. Le compteur d'inscriptions par IP. La contrainte de v90 nomme les compteurs
--    admis : on la remplace par la même, avec un nom de plus.
alter table auth_throttle drop constraint if exists auth_throttle_cle;
alter table auth_throttle add constraint auth_throttle_cle
  check (key ~ '^(ip_email|ip|email|demo_ip|inscription_ip):[0-9a-f]{64}$');

-- 2. Le compte inscrit en libre-service : la date de son inscription. NULL : un
--    compte créé par un administrateur (ou par le SSO), comme tous ceux d'avant.
alter table console_user add column if not exists inscrit_le timestamptz;
create index if not exists idx_console_user_inscrit_le on console_user (inscrit_le) where inscrit_le is not null;

-- 3. Le débit de collecte propre à une application, en événements par minute. NULL :
--    celui de la plateforme (`RATE_LIMIT_PER_MIN` du collecteur). Le collecteur lit
--    la colonne par `to_jsonb(...)`, et tolère donc son absence tant que ce fichier
--    n'est pas appliqué.
alter table app_registry add column if not exists debit_max_min integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_registry_debit_max_min') then
    alter table app_registry add constraint app_registry_debit_max_min check (debit_max_min is null or debit_max_min > 0);
  end if;
end $$;

-- 4. `mip_identity` crée le site d'un compte inscrit, dans la transaction de
--    l'inscription : l'application et le compte ensemble, ou rien. Des colonnes
--    nommées, en INSERT seul — il ne lit ni ne modifie aucune application — et une
--    policy d'insertion qui n'admet qu'un site plafonné, créé par quelqu'un.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mip_identity') then
    grant insert (active, allowed_origins, api_key_hash, app_id, created_by, debit_max_min, name) on app_registry to mip_identity;
    if not exists (select 1 from pg_policy where polrelid = 'public.app_registry'::regclass
                                               and polname = 'mip_identity_inscription') then
      create policy mip_identity_inscription on app_registry as permissive for insert to mip_identity
        with check (created_by is not null and debit_max_min is not null);
    end if;
  end if;
end $$;
