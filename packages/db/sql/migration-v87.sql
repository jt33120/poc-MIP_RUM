-- migration-v87 — P3 : drapeaux de plateforme, et le premier d'entre eux,
-- `ingest_relay_pct` (part du trafic d'ingestion que la console relaie vers le
-- collector Railway).
--
-- Additive et rejouable, PostgreSQL 15 à 17. UNE TABLE, UNE LIGNE, AUCUNE
-- TABLE EXISTANTE TOUCHÉE. v86 est la dernière migration fusionnée ; la
-- contrainte `env:TICKET_*` du plan vise v88 ou au-delà : ce fichier prend v87.
--
-- ═══════════════════════ 1. POURQUOI UN DRAPEAU EN BASE ══════════════════════
--
-- C'est le COUPE-CIRCUIT de la bascule de la collecte (plan, P3). La console
-- Vercel relaie un pourcentage des beacons vers le collector ; si le collector
-- se comporte mal, il faut ramener ce pourcentage à 0 EN MOINS D'UNE MINUTE,
-- sans redéploiement. Une variable d'environnement Vercel ne le permet pas :
-- la changer impose un redéploiement (plusieurs minutes, et un build qui peut
-- échouer au pire moment). Une ligne en base se change par un `update`, et la
-- console la relit toutes les 30 s (`apps/console/lib/platform-flag.ts`).
--
--   update platform_flag set value = '10', updated_by = 'prénom'
--    where key = 'ingest_relay_pct';            -- monter
--   update platform_flag set value = '0',  updated_by = 'prénom'
--    where key = 'ingest_relay_pct';            -- couper, effet < 30 s
--
-- Mode d'emploi complet : `docs/operations/relais-ingestion.md`.
--
-- ═══════════════════ 2. POURQUOI CLÉ/VALEUR EN TEXTE ═════════════════════════
--
-- Une table générique plutôt qu'une colonne par drapeau : le prochain drapeau
-- de plateforme (il y en aura : notifier, bascule de lecture vers `api`) ne
-- demandera pas un `alter table`. La valeur est du TEXTE, lu et validé par le
-- code qui la consomme — et, pour les drapeaux dont une faute de frappe serait
-- dangereuse, par une contrainte ici (§ 3).
--
-- ════════════════ 3. LA VALEUR DU POURCENTAGE EST CONTRAINTE ═════════════════
--
-- `ingest_relay_pct` n'accepte qu'un entier de 0 à 100, écrit sans signe ni
-- zéro de tête ni « % ». POURQUOI EN BASE, alors que le code valide aussi :
-- une valeur que le code refuse le fait retomber sur son défaut d'environnement
-- (`INGEST_RELAY_PCT`, 0 en production). Un opérateur qui tape '10%' croirait
-- avoir monté la bascule, et rien ne bougerait ; pire, un '0 ' mal tapé
-- pendant un incident ne couperait rien si le défaut d'environnement était
-- non nul. Refuser l'`update` sur le moment est la seule réponse qui se voit.
--
-- ═══════════════════════════ 4. VALEUR INITIALE : 0 ══════════════════════════
--
-- La ligne naît à '0' : appliquer ce fichier ne relaie RIEN. Et elle n'est
-- JAMAIS réécrite par un rejeu (`on conflict do nothing`) : rejouer la
-- migration ne doit pas remettre à 0 une bascule en cours, ni la relancer
-- après une coupure.
--
-- ═════════════ 5. FENÊTRE DE DÉPLOIEMENT (expand / contract) ═════════════════
--
-- Le code de P3 part AVANT ce fichier, et c'est voulu : seul le scheduler
-- migre, à son prochain pré-déploiement réussi, et Railway n'ordonne pas les
-- déploiements entre Vercel et Railway. Tant que la table n'existe pas, la
-- lecture du drapeau échoue en `42P01` ; `platform-flag.ts` rend alors le
-- défaut d'environnement, sans exception ni journal par requête. Et tant que
-- `CONSOLE_INGEST_RELAY_URL` n'est pas posée sur Vercel, la console ne lit
-- même pas cette table.
--
-- ═══════════════════════════ 6. HORODATAGE ET AUTEUR ═════════════════════════
--
-- `updated_at` est tenu par un déclencheur : un `update` à la main l'oublierait,
-- et « depuis quand relaie-t-on 50 % ? » est la première question d'un
-- incident. Un `updated_at` posé explicitement par l'`update` est respecté :
-- le contrat de parité (`tests/contract/ingest-parity.test.ts`) recale tout
-- horodatage semé par les migrations sur une même horloge, et un déclencheur
-- qui écraserait ce recalage ferait différer deux bases identiques.
-- `updated_by` reste déclaratif (tout le monde se connecte avec le même rôle
-- propriétaire : `current_user` ne dirait rien) ; le mode d'emploi demande de
-- le renseigner.
--
-- ═════════════════════════════════ 7. DROITS ═════════════════════════════════
--
-- Table GLOBALE, sans `app_id` : aucune policy de tenant n'a de sens ici, et
-- la valeur n'est pas un secret. `console_ro` (rôle cible de la console, C13)
-- peut la LIRE et rien d'autre : écrire le coupe-circuit reste un geste
-- d'exploitant, sous le rôle propriétaire. Les rôles hérités de Supabase
-- (`anon`, `authenticated`) n'en voient rien, comme pour toute table récente.
--
-- ═════════════════════════════════ 8. VERROUS ═══════════════════════════════
--
-- Création de table et d'un déclencheur sur une table NEUVE : aucune table
-- chaude n'est verrouillée. `lock_timeout` court quand même (règle 6 du
-- contrat de service) : au rejeu, `drop/add constraint` et `drop trigger`
-- prennent un ACCESS EXCLUSIVE sur `platform_flag`, qu'une lecture de la
-- console tient le temps d'un `select` ; s'il expire, le migrateur annule le
-- fichier et le rejoue.
set local lock_timeout = '3s';

create table if not exists platform_flag (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table platform_flag
  drop constraint if exists platform_flag_ingest_relay_pct_v87,
  add constraint platform_flag_ingest_relay_pct_v87 check (
    key <> 'ingest_relay_pct' or value ~ '^(100|[1-9]?[0-9])$'
  );

insert into platform_flag (key, value, updated_by)
values ('ingest_relay_pct', '0', 'migration-v87')
on conflict (key) do nothing;

create or replace function platform_flag_touch() returns trigger
language plpgsql as $$
begin
  -- Un `updated_at` posé EXPLICITEMENT par l'update garde le dernier mot
  -- (réalignement d'horloge des tests, reprise d'un export) ; sinon, maintenant.
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists platform_flag_touch on platform_flag;
create trigger platform_flag_touch
  before update on platform_flag
  for each row execute function platform_flag_touch();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on platform_flag from console_ro;
    grant select on platform_flag to console_ro;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on platform_flag from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on platform_flag from authenticated;
  end if;
end $$;

comment on table platform_flag is
  'Drapeaux de plateforme lus par les services (cache 30 s côté console). ingest_relay_pct : part '
  'des beacons que la console relaie vers le collector (0 à 100). Coupe-circuit : value = ''0''. '
  'Mode d''emploi : docs/operations/relais-ingestion.md.';
comment on column platform_flag.updated_by is
  'Qui a changé la valeur — déclaratif, à renseigner dans l''update (tous les services partagent le rôle propriétaire).';
