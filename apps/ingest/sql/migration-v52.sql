-- migration-v52 — Inventaire des postes équipés de l'extension navigateur.
--
-- POURQUOI UNE TABLE, ALORS QUE rum_session PORTE DÉJÀ user_hash
-- `user_hash` est un FNV-1a 32 bits de (userAgent | langue | résolution | fuseau),
-- cf. packages/rum-sdk/src/session.ts:19. Sur un PARC GÉRÉ — la cible même de
-- l'extension (docs/CADRAGE_EXTENSION.md §0) — c'est le pire identifiant
-- possible : deux cents postes sortis du même master, même Chrome, même
-- 1920×1080, même fr-FR, même UTC+1 produisent UN SEUL hash. Il change en plus à
-- chaque mise à jour de Chrome (userAgent) et à chaque branchement d'écran
-- externe (résolution). Il ne peut donc ni compter des postes ni les suivre dans
-- le temps : c'est un signal d'audience, pas un inventaire de parc.
--
-- CE QUI EST COLLECTÉ, ET CE QUI NE L'EST PAS
-- `install_id` est un UUID tiré au hasard par l'extension à sa première exécution
-- et gardé dans chrome.storage.local. Il n'est dérivé d'AUCUNE caractéristique du
-- poste ni de son utilisateur : il n'identifie personne, il distingue seulement
-- deux installations. Le battement de cœur ne transporte JAMAIS d'URL visitée —
-- seulement cet identifiant, la version de l'extension, et les app_id pour
-- lesquels ce poste a effectivement injecté le SDK. Ces app_id ne peuvent venir
-- que de domaines déjà déclarés dans `extension_scope` : hors périmètre,
-- l'extension n'injecte rien et n'a donc rien à déclarer.
--
-- `label` est le seul champ nominatif possible, et nous ne le fabriquons pas :
-- il vient de `chrome.storage.managed`, c'est-à-dire de la policy d'entreprise
-- poussée par la DSI du client. Sans policy, la colonne reste NULL et
-- l'inventaire reste anonyme. Aucune identité n'est jamais inférée côté serveur.
--
-- POURQUOI DEUX TABLES
-- Un poste peut alimenter plusieurs applications (un employé visite deux sites
-- supervisés). Un tableau `app_ids text[]` sur la ligne d'installation rendrait le
-- cloisonnement RLS inexprimable proprement et interdirait de dater l'entrée d'un
-- poste dans le périmètre d'une app. La table de liaison porte ses propres dates.

create table if not exists extension_install (
  install_id     uuid primary key,
  -- Libellé fourni par la policy d'entreprise (chrome.storage.managed). NULL =
  -- la DSI n'en pousse pas : inventaire anonyme, et c'est un cas normal.
  label          text,
  ext_version    text,
  -- Dérivés de l'en-tête User-Agent du battement de cœur, pas envoyés par le
  -- client : la même donnée est déjà stockée sur rum_session.user_agent.
  browser        text,
  browser_major  int,
  platform       text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

comment on table extension_install is
  'Un poste équipé de l''extension navigateur. install_id est un UUID aléatoire '
  'tiré par l''extension, dérivé d''aucune caractéristique du poste.';

create table if not exists extension_install_app (
  install_id     uuid not null references extension_install(install_id) on delete cascade,
  app_id         text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (install_id, app_id)
);

comment on table extension_install_app is
  'Quelles applications ce poste alimente. Uniquement des app_id résolus depuis '
  'extension_scope — jamais une trace de navigation hors périmètre.';

-- L'inventaire se lit trié par dernière activité (les postes silencieux en bas),
-- et se compte par application.
create index if not exists idx_ext_install_last_seen on extension_install (last_seen_at desc);
create index if not exists idx_ext_install_app_app   on extension_install_app (app_id, last_seen_at desc);

-- ── RLS : à poser ICI, v47 ne couvre pas les tables créées après elle ────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    create role console_ro nologin;
  end if;

  -- Table de liaison : cloisonnement direct, elle porte app_id.
  alter table public.extension_install_app enable row level security;
  drop policy if exists tenant_scope on public.extension_install_app;
  create policy tenant_scope on public.extension_install_app for all to console_ro
    using (app_id = any(current_app_ids()));
  grant select on public.extension_install_app to console_ro;

  -- Ligne d'installation : pas d'app_id à elle, le cloisonnement passe par ses
  -- liaisons. Un poste installé mais qui n'a encore alimenté aucune application
  -- n'appartient à aucun locataire — invisible ici, visible de l'administrateur
  -- (qui ne passe pas par console_ro). C'est le comportement voulu.
  alter table public.extension_install enable row level security;
  drop policy if exists tenant_scope on public.extension_install;
  create policy tenant_scope on public.extension_install for all to console_ro
    using (exists (select 1 from extension_install_app a
                    where a.install_id = extension_install.install_id
                      and a.app_id = any(current_app_ids())));
  grant select on public.extension_install to console_ro;
end $$;
