-- migration-v90 — C0 : les sessions de la console en base, le débit
-- d'authentification, et un journal d'audit en ajout seul.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v89 (`mip_api`, P4) est le fichier
-- précédent. Aucun code en production ne lit encore ces tables : `console-api`
-- (piste C) les vérifie dès C0, les ÉCRIT à partir de C1 (connexion, démo,
-- déconnexion). Elles peuvent donc passer avant tout déploiement de service.
--
-- ═══════════════════════════ 1. console_session ═════════════════════════════
--
-- POURQUOI UNE LIGNE PAR SESSION. Aujourd'hui une session est un cookie HS256
-- signé par la console, sans rien en base : rien ne la révoque avant son
-- expiration (8 h), ni une déconnexion, ni un compte désactivé. Demain, le jeton
-- (ES256, signé par `console-api`) ne porte QU'UN identifiant de session ; à
-- chaque vérification, `console-api` relit la ligne, et le compte qu'elle
-- désigne. Révoquer, c'est poser `revoked_at` : effet en 30 s au plus (le cache
-- de vérification du service).
--
-- CE QUE LA LIGNE NE PORTE PAS, à dessein : le rôle et le périmètre d'un
-- utilisateur. Ils se lisent dans `console_user` à chaque vérification — un
-- administrateur rétrogradé l'est tout de suite, pas à sa prochaine connexion.
-- Une session de DÉMO, elle, n'a pas de compte : elle porte son étiquette et son
-- périmètre, figés à l'ouverture. Et elle n'a PAS de colonne de rôle : une démo
-- est `viewer` par construction, aucune valeur en base ne peut dire autre chose
-- (le plan écrivait « CHECK demo ⇒ role = 'viewer' » ; l'absence de colonne est
-- plus forte qu'une contrainte).
--
-- Aucune donnée d'identification du navigateur : ni adresse IP, ni agent. Le
-- débit d'authentification (ci-dessous) n'en garde qu'un HMAC.
create table if not exists console_session (
  id             uuid primary key default gen_random_uuid(),
  user_id        bigint references console_user (id) on delete cascade,
  demo           boolean not null default false,
  demo_email     text,
  demo_apps      text[],
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_reason text,
  -- Deux formes, et aucune autre : un compte sans rien de la démo, ou une démo
  -- sans compte, avec une étiquette et au moins une application. Chaque terme
  -- est NON NUL par construction (`coalesce`) : un CHECK qui s'évalue à NULL
  -- PASSE, et `cardinality(NULL) > 0` aurait laissé entrer une démo sans
  -- périmètre — c'est-à-dire, pour un lecteur distrait, « toutes les apps ».
  constraint console_session_forme check (
    (not demo and user_id is not null and demo_email is null and demo_apps is null)
    or (demo and user_id is null and demo_email is not null
        and coalesce(cardinality(demo_apps), 0) > 0
        and array_position(demo_apps, null) is null)
  ),
  -- Une session ne dure pas plus de 30 jours, quoi que dise le code qui l'ouvre.
  constraint console_session_duree check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint console_session_revocation check ((revoked_at is null) = (revoked_reason is null)),
  constraint console_session_raison check (revoked_reason is null or revoked_reason ~ '^[a-z_]{3,32}$')
);

-- Révoquer toutes les sessions d'un compte (désactivation, mot de passe changé).
create index if not exists idx_console_session_user_active
  on console_session (user_id) where revoked_at is null;
-- La purge quotidienne.
create index if not exists idx_console_session_expires on console_session (expires_at);

-- ═══════════════════════════ 2. auth_throttle ═══════════════════════════════
--
-- Les compteurs d'échecs de connexion (C1) : par IP et e-mail, par IP, par
-- e-mail, et les ouvertures de démo par IP. Vérifiés AVANT bcrypt, partagés
-- entre répliques — un compteur en mémoire se contournerait en changeant de
-- réplique. La clé est `<compteur>:<HMAC-SHA256 hexadécimal>` : ni adresse IP
-- ni e-mail n'est jamais écrit en clair, et la contrainte le garantit.
create table if not exists auth_throttle (
  key           text primary key,
  window_start  timestamptz not null,
  failures      integer not null default 0,
  blocked_until timestamptz,
  updated_at    timestamptz not null default now(),
  constraint auth_throttle_cle check (key ~ '^(ip_email|ip|email|demo_ip):[0-9a-f]{64}$'),
  constraint auth_throttle_echecs check (failures >= 0)
);
create index if not exists idx_auth_throttle_updated on auth_throttle (updated_at);

-- Ni `console_ro` ni `mip_api` n'y ont droit (aucun privilège par défaut dans
-- ce schéma, migration-v10) ; la sécurité par ligne, sans aucune policy, fait de
-- tout rôle non propriétaire un lecteur de rien — même si un droit s'égarait.
alter table console_session enable row level security;
alter table auth_throttle enable row level security;

-- ═══════════════════════════ 3. audit_log ═══════════════════════════════════
--
-- Trois colonnes, que `console-api` remplira à chaque écriture (C6 et suivants) :
--   · `request_id` : l'identifiant de la requête, celui de l'écran d'erreur
--     (« réf. … ») et du journal du service — une ligne d'audit se relie à
--     tout ce qui s'est passé pendant l'appel ;
--   · `actor_kind` : qui agit — un compte, une démo, une machine (jeton), le
--     système (scheduler) ;
--   · `app_id` : l'application concernée, quand il y en a une — ce qui permettra
--     à un administrateur restreint de lire le journal de SES applications.
-- Les lignes existantes gardent NULL partout : elles datent d'avant, et le
-- dire vaut mieux qu'inventer une valeur.
--
-- `audit_log` devient ainsi une table « app-scopée ». L'effacement d'un client
-- (`erase_app_data`, v81) ne la vide PAS, et c'est voulu : le journal est en
-- ajout seul (ci-dessous) et doit garder la trace de l'effacement lui-même.
-- Exclusion consignée dans le garde-fou de catalogue de P8.1
-- (tests/integration/dsar-concurrency-sql.test.ts).
alter table audit_log add column if not exists request_id text;
alter table audit_log add column if not exists actor_kind text;
alter table audit_log add column if not exists app_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_log_actor_kind_v90') then
    alter table audit_log add constraint audit_log_actor_kind_v90
      check (actor_kind is null or actor_kind in ('user', 'demo', 'machine', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_log_request_id_v90') then
    -- La forme exacte qu'accepte le pipeline de `console-api` (`x-request-id`).
    alter table audit_log add constraint audit_log_request_id_v90
      check (request_id is null or request_id ~ '^[A-Za-z0-9._-]{8,64}$');
  end if;
end $$;

create index if not exists idx_audit_log_app_ts on audit_log (app_id, ts desc) where app_id is not null;
create index if not exists idx_audit_log_request on audit_log (request_id) where request_id is not null;

-- EN AJOUT SEUL. Aucune ligne du journal ne se modifie ni ne s'efface — ni par
-- la console, ni par un script, ni par une purge. Le code n'en a jamais eu
-- besoin (v09 et v14 l'excluaient déjà de toute purge) ; désormais la base le
-- refuse, et le refus est un 42501 lisible.
--
-- CE QUE CE N'EST PAS : une barrière contre le PROPRIÉTAIRE des tables. Il peut
-- désactiver un déclencheur (`alter table … disable trigger`), et un
-- superutilisateur passer outre (`session_replication_role = replica`, ce que
-- font les tests pour nettoyer leurs lignes). La barrière contre le processus
-- qui écrit, c'est C13 : `console-api` passe sous `mip_console`, qui n'a sur
-- `audit_log` qu'INSERT et SELECT. D'ici là, ce déclencheur arrête l'erreur de
-- code et le script de nettoyage trop large — pas un attaquant propriétaire.
create or replace function audit_log_ajout_seul() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log est en ajout seul : % refusé', tg_op
    using errcode = '42501',
          hint = 'Le journal d''audit ne se modifie ni ne s''efface (migration-v90).';
end
$$;

drop trigger if exists trg_audit_log_ajout_seul on audit_log;
create trigger trg_audit_log_ajout_seul
  before update or delete on audit_log
  for each row execute function audit_log_ajout_seul();

drop trigger if exists trg_audit_log_sans_truncate on audit_log;
create trigger trg_audit_log_sans_truncate
  before truncate on audit_log
  for each statement execute function audit_log_ajout_seul();

-- ═══════════════════════════ 4. La purge quotidienne ════════════════════════
--
-- Appelée par le scheduler, cadence `quotidien` (packages/backend/jobs/planifie.mjs).
--   · une session expirée ou révoquée depuis plus de 7 jours : elle ne peut plus
--     servir, et sept jours laissent le temps d'enquêter sur une session volée ;
--   · un compteur d'échecs sans activité depuis 24 h et sans blocage en cours :
--     sa fenêtre la plus longue (l'heure du compteur par e-mail) est close.
-- Rend le nombre de lignes effacées.
create or replace function purge_console_sessions() returns integer
language plpgsql
as $$
declare
  n_sessions integer;
  n_compteurs integer;
begin
  delete from console_session
   where expires_at < now() - interval '7 days'
      or revoked_at < now() - interval '7 days';
  get diagnostics n_sessions = row_count;

  delete from auth_throttle
   where updated_at < now() - interval '24 hours'
     and (blocked_until is null or blocked_until < now());
  get diagnostics n_compteurs = row_count;

  return n_sessions + n_compteurs;
end
$$;

-- Une fonction qui efface n'est exécutable que par le propriétaire (le scheduler).
revoke execute on function purge_console_sessions() from public;
