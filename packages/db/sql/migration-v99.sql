-- migration-v99 — Les sondes de la chaîne de mesure : journal des passages,
-- registre des fenêtres de collecte, application canari, alerte d'absence.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Refonte du monitoring, vague 1,
-- lot L1 de l'étude des sondes (29/09/2026). v98 est réservée à un autre lot de
-- la même nuit : ce fichier ne suppose NI son absence NI sa présence (aucune
-- définition recopiée, voir § 7).
--
-- CE QUE LA BASE Y GAGNE :
--   1. `sonde_passage` : UNE preuve par passage du scheduler et par étage sondé
--      (console, écriture…). Une fenêtre sans ligne EST une interruption ;
--   2. `collecte_fenetre` : les seules périodes NON nominales (dégradée,
--      interrompue), pour la plateforme (`portee = '*'`) ou pour une
--      application. « Ouverte » est l'absence de fenêtre : quelques lignes par
--      mois, lues demain par chaque graphique ;
--   3. `sonde_attendue`, `sonde_battement` : les battements déclarés d'une
--      application et ceux des services sans bail (lots suivants, tables
--      posées ici pour ne pas rouvrir le schéma) ;
--   4. `app_registry.sonde` et l'application `mip-canari`, SANS clé : le
--      scheduler tire la sienne au démarrage et n'en écrit que l'empreinte ;
--   5. le comptage d'usage (`tenant_usage_daily`) n'admet jamais une
--      application sonde ;
--   6. la purge quotidienne borne le journal (90 j) et le registre (400 j) ;
--   7. l'alerte d'absence (« dead man's switch ») : `check_collecte_silence`
--      ouvre une fenêtre `silence` par application muette, et `sonde_alerter`
--      lève UNE alerte par fenêtre, par le chemin des autres (`alert_event`
--      puis `route_alert`).
--
-- DROITS. Lecture pour `console_ro` (motif de v87), rien pour `anon` ni
-- `authenticated`. PAS de droit pour `mip_api` : le service `api` ne lit aucune
-- de ces tables, et sa garde (`scripts/ci/verify-db-roles.mjs`) signale une
-- table accordée que son bundle ne nomme pas. La carte « Santé de la chaîne de
-- mesure » (lot suivant) lira par `console-api` et accordera alors à
-- `mip_console` ce qu'elle lit. RLS activée sur les quatre tables, comme sur
-- toute table `public` depuis v97.
--
-- VERROUS. Quatre tables NEUVES ; `app_registry` gagne une colonne à défaut
-- constant (pas de réécriture, ACCESS EXCLUSIVE bref) ; `tenant_usage_daily`
-- gagne un déclencheur. `lock_timeout` : s'il expire, le migrateur annule le
-- fichier et le rejoue.
set local lock_timeout = '3s';

-- ── 1. Le journal : une ligne par passage et par étage sondé ────────────────
create table if not exists sonde_passage (
  id           bigint generated always as identity primary key,
  -- Un par tick ; c'est aussi le trace_id du canari (32 hex, sans tirets).
  passage_id   uuid        not null,
  etage        text        not null check (etage in (
                 'capteur_sdk', 'capteur_config', 'capteur_navigateur',
                 'ingest_console', 'relais', 'ingest_collector',
                 'ecriture', 'agregat', 'agregat_parite', 'comptage',
                 'lecture_api', 'lecture_console_api', 'lecture_mcp',
                 'livraison', 'app')),
  -- '*' : la plateforme ; sinon l'app_id d'un battement déclaré.
  portee       text        not null default '*',
  emis_at      timestamptz not null,
  verifie_at   timestamptz,
  resultat     text        not null check (resultat in ('ok', 'lent', 'repli', 'echec', 'absent', 'saute')),
  latence_ms   integer     check (latence_ms is null or latence_ms >= 0),
  chemin       text        check (chemin is null or chemin in ('relais', 'local', 'direct')),
  http_status  smallint,
  -- Un code (statut, SQLSTATE, table manquante), JAMAIS un corps de réponse.
  detail       text        check (detail is null or char_length(detail) <= 200),
  unique (passage_id, etage, portee)
);
create index if not exists sonde_passage_etage_emis_idx on sonde_passage (etage, portee, emis_at desc);

comment on table sonde_passage is
  'Journal des sondes (v99) : une ligne par passage du scheduler et par étage sondé. Une fenêtre '
  'sans ligne est une interruption. Purgé à 90 jours par purge_rum_tenants.';

-- ── 2. Le registre des fenêtres de collecte ─────────────────────────────────
create table if not exists collecte_fenetre (
  id          bigint generated always as identity primary key,
  portee      text        not null default '*',
  -- 'chaine' : synthèse de la plateforme, lue par les graphiques ;
  -- 'silence' : une application qui recevait des données n'en reçoit plus.
  etage       text        not null default 'chaine',
  etat        text        not null check (etat in ('degradee', 'interrompue')),
  debut       timestamptz not null,
  fin         timestamptz,
  cause       text        check (cause is null or char_length(cause) <= 120),
  preuve      text        check (preuve is null or char_length(preuve) <= 300),
  source      text        not null default 'sonde' check (source in ('sonde', 'reconstitution', 'operateur')),
  -- L'alerte levée pour CET épisode, une seule (sonde_alerter). Sans clé
  -- étrangère : `alert_event` est purgée à 30 jours, la fenêtre vit 400 jours.
  alerte_event_id bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint collecte_fenetre_bornes check (fin is null or fin > debut)
);
alter table collecte_fenetre add column if not exists alerte_event_id bigint;
create index if not exists collecte_fenetre_portee_debut_idx on collecte_fenetre (portee, debut);
create unique index if not exists collecte_fenetre_une_ouverte
  on collecte_fenetre (portee, etage) where fin is null;

comment on table collecte_fenetre is
  'Registre des fenêtres de collecte NON nominales (v99). Pas de ligne = collecte en service. '
  'fin null = en cours. Purgé à 400 jours (fenêtres closes) par purge_rum_tenants.';

-- ── 3. Les battements attendus d'une application (sonde déclarée) ───────────
create table if not exists sonde_attendue (
  app_id        text     not null,
  signal        text     not null check (signal in ('span_route')),
  route         text     not null check (route like '/%' and char_length(route) <= 512),
  cadence_min   smallint not null check (cadence_min between 1 and 1440),
  tolerance_min smallint not null check (tolerance_min >= cadence_min),
  active        boolean  not null default true,
  primary key (app_id, signal, route)
);

-- ── 4. Le battement des services qui n'ont pas de bail (notifier) ───────────
create table if not exists sonde_battement (
  service    text primary key,
  dernier_ok timestamptz not null,
  detail     text check (detail is null or char_length(detail) <= 200)
);

-- ── 5. L'application canari ─────────────────────────────────────────────────
--
-- Interne ET sonde : exclue des statistiques clients même quand on inclut les
-- apps internes. Née SANS clé (`api_key_hash` nul) : avec REQUIRE_API_KEY, rien
-- n'entre sous son nom tant que le scheduler n'a pas écrit l'empreinte de la
-- clé qu'il tire au démarrage (il n'en garde le clair qu'en mémoire). Rétention
-- 7 jours : le canari ne sert qu'à prouver le passage.
alter table app_registry add column if not exists sonde boolean not null default false;
comment on column app_registry.sonde is
  'Application de sonde (v99, mip-canari) : exclue du périmètre des écrans, du comptage d''usage et '
  'de l''alerte d''absence, même quand les apps internes sont incluses.';

insert into app_registry (app_id, name, internal, active, sonde, retention_days, timezone, notes)
values ('mip-canari', 'Canari de la chaîne de mesure', true, true, true, 7, 'Europe/Paris',
        'Lot OTLP synthétique du scheduler, à chaque tick, par l''URL publique des capteurs. '
        'Aucune donnée personnelle. Clé tirée par le scheduler à son démarrage.')
on conflict (app_id) do nothing;

-- ── 6. Droits et RLS ────────────────────────────────────────────────────────
do $$
declare
  t   text;
  seq text;
begin
  foreach t in array array['sonde_passage', 'collecte_fenetre', 'sonde_attendue', 'sonde_battement'] loop
    execute format('alter table %I enable row level security', t);
    -- Séquence d'identité des deux tables qui en ont une (journal, registre).
    seq := case when t in ('sonde_passage', 'collecte_fenetre') then pg_get_serial_sequence('public.' || t, 'id') end;
    if exists (select 1 from pg_roles where rolname = 'console_ro') then
      execute format('revoke all on %I from console_ro', t);
      execute format('grant select on %I to console_ro', t);
      -- Tables GLOBALES, sans secret : la policy ouvre la lecture à qui en a le
      -- droit. Sans elle, un rôle soumis à la RLS lirait zéro ligne, sans erreur.
      if not exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass
                                                 and polname = 'console_ro_lecture') then
        execute format('create policy console_ro_lecture on %I as permissive for select to console_ro using (true)', t);
      end if;
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on %I from anon', t);
      if seq is not null then execute format('revoke all on sequence %s from anon', seq); end if;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on %I from authenticated', t);
      if seq is not null then execute format('revoke all on sequence %s from authenticated', seq); end if;
    end if;
  end loop;
end $$;

-- ── 7. Le comptage d'usage n'admet jamais une application sonde ─────────────
--
-- Un DÉCLENCHEUR plutôt qu'une réécriture de `meter_tenant_usage` : la
-- fonction de comptage peut être redéfinie par une migration voisine (le
-- rattrapage des jours sans comptage est prévu), et une copie ici effacerait
-- ce changement sans bruit. La garde tient à la table, quel que soit
-- l'écrivain. BEFORE INSERT qui rend NULL : la ligne est ignorée, `on conflict`
-- compris ; BEFORE UPDATE qui rend NULL : la mise à jour aussi.
create or replace function tenant_usage_sans_sonde() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from app_registry a where a.app_id = new.app_id and a.sonde) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists tenant_usage_sans_sonde on tenant_usage_daily;
create trigger tenant_usage_sans_sonde
  before insert or update on tenant_usage_daily
  for each row execute function tenant_usage_sans_sonde();

delete from tenant_usage_daily u using app_registry a where a.app_id = u.app_id and a.sonde;

-- ── 8. La purge du journal et du registre ───────────────────────────────────
create or replace function purge_sondes(p_jours_journal int default 90, p_jours_registre int default 400)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare n_journal bigint; n_registre bigint;
begin
  delete from sonde_passage where emis_at < now() - make_interval(days => greatest(p_jours_journal, 1));
  get diagnostics n_journal = row_count;
  -- Une fenêtre EN COURS ne se purge jamais, si vieille soit-elle.
  delete from collecte_fenetre
   where fin is not null and fin < now() - make_interval(days => greatest(p_jours_registre, 1));
  get diagnostics n_registre = row_count;
  return jsonb_build_object('sonde_passage', n_journal, 'collecte_fenetre', n_registre);
end $$;

-- `purge_rum_tenants` l'appelle : UNE ligne insérée devant son unique
-- `return result;` (même geste que v97 : la définition courante n'est pas
-- recopiée). `create or replace` remet les réglages de la fonction à ceux de
-- la commande : le `search_path` posé par v35 est donc reposé juste après.
do $$
declare
  src   text;
  ancre constant text := E'\n  return result;\n';
  ajout constant text :=
    E'\n  -- v99 : journal des sondes (90 j) et registre des fenêtres de collecte (400 j).\n'
    '  result := result || jsonb_build_object(''sondes'', purge_sondes(90, 400));\n'
    '  return result;\n';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'purge_rum_tenants'
     and p.pronargs = 1 and p.proargtypes[0] = 'integer'::regtype;
  if src is null then
    raise exception 'v99: purge_rum_tenants(integer) introuvable — appliquer v14 d''abord';
  end if;
  if position('purge_sondes(' in src) > 0 then
    return;
  end if;
  if (length(src) - length(replace(src, ancre, ''))) / length(ancre) <> 1 then
    raise exception 'v99: point d''insertion ambigu dans purge_rum_tenants (% occurrences)',
      (length(src) - length(replace(src, ancre, ''))) / length(ancre);
  end if;
  execute 'create or replace function purge_rum_tenants(default_days int default 30) returns jsonb language plpgsql as '
       || quote_literal(replace(src, ancre, ajout));
  execute 'alter function purge_rum_tenants(integer) set search_path = public, pg_temp';
end $$;

-- ── 9. Une alerte par épisode ───────────────────────────────────────────────
--
-- Le chemin des autres alertes sans règle (l'uptime, v42) : un `alert_event`
-- puis `route_alert`, qui met en file une livraison par canal éligible. La
-- fenêtre porte l'alerte qu'elle a levée : tant qu'elle est ouverte, un second
-- appel ne fait rien (verrou de ligne : deux schedulers ne doublent pas).
-- Rend l'identifiant de l'événement créé, ou NULL.
create or replace function sonde_alerter(
  p_fenetre_id bigint, p_app_id text, p_severity text, p_message text, p_payload jsonb
) returns bigint language plpgsql set search_path = public, pg_temp as $$
declare deja bigint; trouvee boolean; ev_id bigint;
begin
  select true, alerte_event_id into trouvee, deja from collecte_fenetre where id = p_fenetre_id for update;
  if trouvee is null or deja is not null then
    return null;
  end if;
  insert into alert_event (rule_id, slo_id, value, message, severity)
  values (null, null, null, left(p_message, 1000), p_severity)
  returning id into ev_id;
  perform route_alert(ev_id, p_app_id, p_severity, '[MIP RUM] ' || left(p_message, 1000),
                      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('source', 'mip-rum', 'app_id', p_app_id));
  update collecte_fenetre set alerte_event_id = ev_id, updated_at = now() where id = p_fenetre_id;
  return ev_id;
end $$;

-- ── 10. L'alerte d'absence par application ──────────────────────────────────
--
-- Pour chaque application active, ni sonde ni suspendue, qui a reçu des
-- données dans les `p_horizon_jours` derniers jours : sa dernière donnée
-- (`rum_event_index`, la projection de tous les signaux, lue par l'index
-- (app_id, ts desc) : une ligne par application) a plus de `p_silence_min`
-- minutes → une fenêtre `silence` s'ouvre, datée de cette dernière donnée, et
-- UNE alerte part. Elle se ferme au retour de la donnée. Une application qui
-- n'a jamais rien reçu n'est pas « muette » : elle est ignorée.
--
-- `p_chaine_ok` faux (le canari échoue) : aucune fenêtre ne s'ouvre. Quand la
-- chaîne est coupée, toutes les applications se taisent ensemble, et c'est la
-- fenêtre de la plateforme qui le dit — pas une alerte par application.
create or replace function check_collecte_silence(
  p_silence_min int default 60, p_chaine_ok boolean default true, p_horizon_jours int default 7
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  a record;
  dernier timestamptz;
  ouverte_id bigint;
  ouverte_debut timestamptz;
  retour timestamptz;
  fid bigint;
  msg text;
  ouvertes int := 0;
  fermees int := 0;
  alertes int := 0;
begin
  if p_silence_min is null or p_silence_min < 5 then
    raise exception 'check_collecte_silence : seuil de silence invalide (% min)', p_silence_min;
  end if;
  for a in
    select r.app_id from app_registry r
     where r.active and not r.sonde
       -- `to_jsonb` : la colonne vient de v81 ; la lire ainsi ne casse rien.
       and (to_jsonb(r) ->> 'ingestion_suspended_at') is null
     order by r.app_id
  loop
    dernier := null; ouverte_id := null; ouverte_debut := null;
    select i.ts into dernier from rum_event_index i
     where i.app_id = a.app_id
       and i.ts > now() - make_interval(days => greatest(p_horizon_jours, 1))
       -- Une horloge cliente en avance ne doit pas masquer un silence.
       and i.ts <= now() + interval '5 minutes'
     order by i.ts desc limit 1;
    select f.id, f.debut into ouverte_id, ouverte_debut from collecte_fenetre f
     where f.portee = a.app_id and f.etage = 'silence' and f.fin is null;

    if dernier is not null and dernier >= now() - make_interval(mins => p_silence_min) then
      if ouverte_id is not null then
        select min(i.ts) into retour from rum_event_index i
         where i.app_id = a.app_id and i.ts > ouverte_debut;
        update collecte_fenetre
           set fin = greatest(coalesce(retour, now()), ouverte_debut + interval '1 second'), updated_at = now()
         where id = ouverte_id;
        fermees := fermees + 1;
      end if;
    elsif dernier is not null and ouverte_id is null and p_chaine_ok then
      insert into collecte_fenetre (portee, etage, etat, debut, cause, preuve, source)
      values (a.app_id, 'silence', 'interrompue', dernier,
              format('aucune donnée reçue depuis %s min', p_silence_min),
              format('dernière donnée le %s UTC', to_char(dernier at time zone 'UTC', 'YYYY-MM-DD HH24:MI')),
              'sonde')
      returning id into fid;
      ouvertes := ouvertes + 1;
      msg := format('Collecte muette — app %s : aucune donnée reçue depuis %s min (dernière le %s UTC)',
                    a.app_id, p_silence_min, to_char(dernier at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
      if sonde_alerter(fid, a.app_id, 'warning', msg,
                       jsonb_build_object('kind', 'collecte_silence', 'silence_min', p_silence_min,
                                          'derniere_donnee', dernier, 'text', msg)) is not null then
        alertes := alertes + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ouvertes', ouvertes, 'fermees', fermees, 'alertes', alertes);
end $$;

-- Écritures : exécutées par le scheduler (propriétaire) seulement.
do $$
declare fn text;
begin
  foreach fn in array array[
    'purge_sondes(integer, integer)',
    'sonde_alerter(bigint, text, text, text, jsonb)',
    'check_collecte_silence(integer, boolean, integer)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
  end loop;
end $$;

comment on function check_collecte_silence(integer, boolean, integer) is
  'Alerte d''absence (v99) : une fenêtre silence et UNE alerte par application muette depuis '
  'p_silence_min minutes ; fermée au retour de la donnée. Rien ne s''ouvre si la chaîne est coupée.';
comment on function sonde_alerter(bigint, text, text, text, jsonb) is
  'Lève l''alerte d''une fenêtre de collecte, une seule par fenêtre : alert_event puis route_alert (v99).';
