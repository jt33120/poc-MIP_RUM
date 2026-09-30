-- migration-v103 — Les sondes de la chaîne de mesure : journal des passages,
-- registre des fenêtres de collecte, application canari, alerte d'absence.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Refonte du monitoring, vague 1,
-- lot L1 de l'étude des sondes (29/09/2026). Numérotée v99 à l'écriture, renumérotée
-- v103 le 30/09/2026 (v100 et v101 fusionnées avant elle). v102 (agrégats) est d'un
-- autre lot de la même nuit : ce fichier ne suppose NI son absence NI sa présence (aucune
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
--   7. l'alerte d'absence (« dead man's switch ») sur un silence ANORMAL :
--      `sonde_etat_silence` rend, par application, sa dernière donnée et ses
--      heures d'activité habituelles (lues dans `rum_rollup_hourly`) ; le
--      scheduler décide ; `sonde_ouvrir_silence` ouvre une fenêtre `silence`
--      et `sonde_alerter` lève UNE alerte par fenêtre, par le chemin des autres
--      (`alert_event` puis `route_alert`) ;
--   8. les 30 jours d'avant le journal, reconstitués depuis `uptime_result` au
--      démarrage du scheduler (`sonde_reconstituer_uptime`), et T2, la panne
--      silencieuse du capteur de la console, posée par l'opérateur (§ 11, 12).
--
-- DROITS. Lecture pour `console_ro` (motif de v87), rien pour `anon` ni
-- `authenticated`, et `mip_console` pour `collecte_fenetre` (§ 6 bis). PAS de
-- droit pour `mip_api` : le service `api` ne lit aucune de ces tables, et sa
-- garde (`scripts/ci/verify-db-roles.mjs`) signale une table accordée que son
-- bundle ne nomme pas. La carte « Santé de la chaîne de
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
  'Journal des sondes (v103) : une ligne par passage du scheduler et par étage sondé. Une fenêtre '
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
-- Une fenêtre reconstituée ou posée à la main n'existe qu'une fois : la
-- reconstitution se rejoue à chaque démarrage du scheduler et la migration se
-- rejoue, tous deux en `on conflict do nothing` sur cet index. Les fenêtres
-- des sondes en sont exclues : leur unicité est celle de la fenêtre ouverte.
create unique index if not exists collecte_fenetre_hors_sonde_uniq
  on collecte_fenetre (portee, etage, debut) where source <> 'sonde';

comment on table collecte_fenetre is
  'Registre des fenêtres de collecte NON nominales (v103). Pas de ligne = collecte en service. '
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
  'Application de sonde (v103, mip-canari) : exclue du périmètre des écrans, du comptage d''usage et '
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
      -- Sans policy, un rôle soumis à la RLS lirait zéro ligne, sans erreur. La
      -- lecture suit la portée de la session, comme `audit_log` (v90) : la
      -- plateforme ('*') pour tous, une application pour qui la voit. Une
      -- `using (true)` sur une table qui porte un `app_id` annulerait le filtrage
      -- des autres policies (garde de scripts/verify-tenant-isolation.mjs).
      if not exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass
                                                 and polname = 'console_ro_lecture') then
        execute format('create policy console_ro_lecture on %I as permissive for select to console_ro using (%s)', t,
          case t
            when 'sonde_attendue' then 'app_id = any(current_app_ids())'
            when 'sonde_battement' then 'true'  -- battement des services : global, sans app
            else 'portee = ''*'' or portee = any(current_app_ids())'
          end);
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

-- ── 6 bis. `mip_console` lit le registre des fenêtres ─────────────────────
--
-- `console-api` compile les lectures de la console (`apps/console/lib`) : la
-- comparaison à la période précédente y consulte `collecte_fenetre` pour
-- invalider un écart calculé sur une période trouée (#357). Sans ce droit, sa
-- garde (`scripts/ci/verify-db-roles-console.mjs`) refuse un bundle qui nomme
-- une relation qu'il ne peut pas lire. Motif de v97 pour `platform_flag` :
-- SELECT et policy de lecture propres à `mip_console` ; la table rejoint
-- `packages/db/roles/console-api.mjs`. `mip_api` n'en a pas besoin : le bundle
-- du service `api` ne la nomme pas.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mip_console') then
    grant select on collecte_fenetre to mip_console;
    if not exists (select 1 from pg_policy where polrelid = 'public.collecte_fenetre'::regclass
                                               and polname = 'mip_console_acces') then
      create policy mip_console_acces on collecte_fenetre as permissive for select to mip_console using (true);
    end if;
  end if;
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
    E'\n  -- v103 : journal des sondes (90 j) et registre des fenêtres de collecte (400 j).\n'
    '  result := result || jsonb_build_object(''sondes'', purge_sondes(90, 400));\n'
    '  return result;\n';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'purge_rum_tenants'
     and p.pronargs = 1 and p.proargtypes[0] = 'integer'::regtype;
  if src is null then
    raise exception 'v103: purge_rum_tenants(integer) introuvable — appliquer v14 d''abord';
  end if;
  if position('purge_sondes(' in src) > 0 then
    return;
  end if;
  if (length(src) - length(replace(src, ancre, ''))) / length(ancre) <> 1 then
    raise exception 'v103: point d''insertion ambigu dans purge_rum_tenants (% occurrences)',
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

-- ── 10. L'alerte d'absence par application : un silence ANORMAL ────────────
--
-- Une application au trafic de jour se tait chaque soir : ce silence est
-- normal, et une alerte quotidienne à 18 h ruinerait la confiance dans toutes
-- les autres. Le silence n'alerte donc que s'il tombe à des heures où
-- l'application reçoit HABITUELLEMENT des données : au moins `p_min_jours` des
-- `p_jours` derniers jours (jour en cours exclu) avec une activité dans la même
-- heure d'horloge, au fuseau de l'application (`app_registry.timezone`).
--
-- LA DÉCISION est prise par le scheduler (`decisionSilence`,
-- `packages/backend/jobs/sondes.mjs`, testée sans base) ; la base fournit les
-- faits en UNE requête, par index :
--   · la dernière donnée : `rum_event_index` (projection de tous les signaux,
--     spans serveur compris), index (app_id, ts desc), une ligne par app ;
--   · les heures habituelles : `rum_rollup_hourly` (pages vues, vitals,
--     erreurs), clé primaire (app_id, …), au plus 7 × 24 cellules par app et
--     par type d'appareil. JAMAIS le brut. Limite : une application qui
--     n'émet que des spans serveur n'a pas de ligne de rollup, donc aucune
--     heure habituelle, donc aucune alerte — son battement se déclarera dans
--     `sonde_attendue` (lot suivant).
create or replace function sonde_etat_silence(
  p_jours int default 7, p_min_jours int default 4, p_horizon_jours int default 7, p_apps text[] default null
) returns table (
  app_id text, fuseau text, dernier timestamptz, heures_habituelles int[],
  fenetre_id bigint, fenetre_debut timestamptz
) language sql stable set search_path = public, pg_temp as $$
  select r.app_id, r.timezone, d.ts, coalesce(h.heures, '{}'::int[]), f.id, f.debut
    from app_registry r
    left join lateral (
      select i.ts from rum_event_index i
       where i.app_id = r.app_id
         and i.ts > now() - make_interval(days => greatest(p_horizon_jours, 1))
         -- Une horloge cliente en avance ne doit pas masquer un silence.
         and i.ts <= now() + interval '5 minutes'
       order by i.ts desc limit 1
    ) d on true
    left join lateral (
      select array_agg(x.heure order by x.heure) as heures
        from (
          select extract(hour from c.hour at time zone r.timezone)::int as heure
            from rum_rollup_hourly c
           where c.app_id = r.app_id
             and c.hour >= (date_trunc('day', now() at time zone r.timezone) - make_interval(days => greatest(p_jours, 1))) at time zone r.timezone
             and c.hour <  date_trunc('day', now() at time zone r.timezone) at time zone r.timezone
             and (c.pageviews > 0 or c.errors > 0 or c.total_w > 0)
           group by 1
          having count(distinct (c.hour at time zone r.timezone)::date) >= p_min_jours
        ) x
    ) h on true
    left join collecte_fenetre f on f.portee = r.app_id and f.etage = 'silence' and f.fin is null
   where r.active and not r.sonde
     -- `to_jsonb` : la colonne vient de v81 ; la lire ainsi ne casse rien.
     and (to_jsonb(r) ->> 'ingestion_suspended_at') is null
     and (p_apps is null or r.app_id = any(p_apps))
   order by r.app_id
$$;

-- Ouvre la fenêtre `silence` d'une application, datée de sa dernière donnée,
-- et lève son alerte — une seule : la fenêtre ouverte est unique par
-- (portée, étage), un second appel ne trouve rien à ouvrir. Rend l'alerte.
create or replace function sonde_ouvrir_silence(
  p_app_id text, p_dernier timestamptz, p_silence_min int, p_heures int[]
) returns bigint language plpgsql set search_path = public, pg_temp as $$
declare fid bigint; msg text; quand text;
begin
  if p_silence_min is null or p_silence_min < 5 then
    raise exception 'sonde_ouvrir_silence : seuil de silence invalide (% min)', p_silence_min;
  end if;
  quand := to_char(p_dernier at time zone 'UTC', 'YYYY-MM-DD HH24:MI');
  insert into collecte_fenetre (portee, etage, etat, debut, cause, preuve, source)
  values (p_app_id, 'silence', 'interrompue', p_dernier,
          format('aucune donnée depuis %s min, à des heures habituellement actives', p_silence_min),
          left(format('dernière donnée le %s UTC ; heures locales habituelles manquées : %s',
                      quand, array_to_string(p_heures, ', ')), 300),
          'sonde')
  on conflict (portee, etage) where fin is null do nothing
  returning id into fid;
  if fid is null then
    return null;
  end if;
  msg := format('Collecte muette — app %s : aucune donnée depuis %s min (dernière le %s UTC), '
                'à des heures où elle en reçoit habituellement (%s h, heure locale)',
                p_app_id, p_silence_min, quand, array_to_string(p_heures, ' h, '));
  return sonde_alerter(fid, p_app_id, 'warning', msg,
                       jsonb_build_object('kind', 'collecte_silence', 'silence_min', p_silence_min,
                                          'derniere_donnee', p_dernier, 'heures', to_jsonb(p_heures), 'text', msg));
end $$;

-- Ferme la fenêtre `silence` à la première donnée revenue (sinon maintenant).
create or replace function sonde_fermer_silence(p_fenetre_id bigint)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare f record; retour timestamptz;
begin
  select id, portee, debut into f from collecte_fenetre
   where id = p_fenetre_id and etage = 'silence' and fin is null for update;
  if f.id is null then
    return false;
  end if;
  select min(i.ts) into retour from rum_event_index i where i.app_id = f.portee and i.ts > f.debut;
  update collecte_fenetre
     set fin = greatest(coalesce(retour, now()), f.debut + interval '1 second'), updated_at = now()
   where id = f.id;
  return true;
end $$;

-- ── 11. Reconstituer les 30 jours d'avant le journal ────────────────────────
--
-- Le journal des sondes commence au premier passage du canari : avant, aucune
-- preuve. `uptime_result` en tient lieu : le tick y écrit une ligne par check à
-- chaque passage (v42), c'est le seul historique de fait que le scheduler
-- tournait ET écrivait en base. Un silence plus long que `2 × cadence + 5 min`
-- entre deux lignes est une interruption : base coupée (quota Neon du 24/09,
-- T1 de l'étude A3) ou scheduler arrêté. Aucune date n'est codée ici : la
-- coupure se lit dans les données.
--
-- Bornes : de la DERNIÈRE ligne avant le silence à la PREMIÈRE revenue — les
-- deux seules preuves. Le premier passage du journal compte comme une ligne
-- revenue (un scheduler arrêté juste avant le déploiement du canari), et rien
-- n'est reconstitué après lui : de là, le journal fait foi (`planReconstitution`).
--
-- Rejouable : le scheduler l'appelle une fois par démarrage. Une fenêtre qui
-- recoupe une fenêtre de chaîne déjà connue n'est pas posée, et l'index
-- `collecte_fenetre_hors_sonde_uniq` écarte le doublon exact. Coût : un
-- parcours de 30 jours de `uptime_result` par démarrage (quelques dizaines de
-- milliers de lignes au plus), dans la fenêtre où le tick a réveillé la base.
-- Rend le nombre de fenêtres posées.
create or replace function sonde_reconstituer_uptime(p_jours int default 30, p_cadence_min int default 15)
returns int language plpgsql set search_path = public, pg_temp as $$
declare borne timestamptz; n int;
begin
  if p_cadence_min is null or p_cadence_min < 1 or p_cadence_min > 60 then
    raise exception 'sonde_reconstituer_uptime : cadence invalide (% min)', p_cadence_min;
  end if;
  select min(emis_at) into borne from sonde_passage where etage = 'ingest_console' and portee = '*';
  with lignes as (
    select r.ts from uptime_result r
     where r.ts > now() - make_interval(days => greatest(coalesce(p_jours, 30), 1))
       and r.ts < coalesce(borne, now())
    union all
    select borne where borne is not null
  ), silences as (
    select ts as avant, lead(ts) over (order by ts) as apres from lignes
  )
  insert into collecte_fenetre (portee, etage, etat, debut, fin, cause, preuve, source)
  select '*', 'chaine', 'interrompue', s.avant, s.apres,
         'base ou scheduler injoignable : aucun passage du scheduler',
         format('uptime_result muet du %s au %s UTC ; reconstitué au démarrage du scheduler',
                to_char(s.avant at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                to_char(s.apres at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
         'reconstitution'
    from silences s
   where s.apres - s.avant > make_interval(mins => 2 * p_cadence_min + 5)
     and not exists (
       select 1 from collecte_fenetre f
        where f.portee = '*' and f.etage = 'chaine'
          and f.debut < s.apres and coalesce(f.fin, 'infinity'::timestamptz) > s.avant)
  on conflict (portee, etage, debut) where source <> 'sonde' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 12. T2 : la panne silencieuse du capteur de la console ──────────────────
--
-- Aucune sonde ne l'a vue, `uptime_result` non plus (le scheduler tournait) :
-- du 29/08 18:00 au 08/09 12:00 UTC, le capteur de la console postait vers un
-- hôte décommissionné, la route d'ingestion répondait 200 et rien n'arrivait
-- (étude A3, T2). Posée par l'opérateur, une fois, et seulement là où
-- l'application existe : une autre installation n'a pas cette histoire.
insert into collecte_fenetre (portee, etage, etat, debut, fin, cause, preuve, source)
select 'mip-rum-console', 'capteur', 'interrompue',
       '2026-08-29 18:00:00+00'::timestamptz, '2026-09-08 12:00:00+00'::timestamptz,
       'capteur de la console vers un hôte décommissionné',
       'aucune ligne de l''app avant le 08/09 12:10 UTC ; la route d''ingestion répondait 200, sans erreur ; '
       'correctif e0e7c561 (08/09 12:39) ; étude A3, T2',
       'operateur'
 where exists (select 1 from app_registry where app_id = 'mip-rum-console')
on conflict (portee, etage, debut) where source <> 'sonde' do nothing;

-- Écritures : exécutées par le scheduler (propriétaire) seulement.
do $$
declare fn text;
begin
  foreach fn in array array[
    'purge_sondes(integer, integer)',
    'sonde_alerter(bigint, text, text, text, jsonb)',
    'sonde_ouvrir_silence(text, timestamp with time zone, integer, integer[])',
    'sonde_fermer_silence(bigint)',
    'sonde_reconstituer_uptime(integer, integer)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
  end loop;
end $$;

comment on function sonde_etat_silence(integer, integer, integer, text[]) is
  'Alerte d''absence (v103) : par application, dernière donnée, heures locales d''activité habituelle '
  '(rum_rollup_hourly, au moins p_min_jours des p_jours derniers jours) et fenêtre silence ouverte.';
comment on function sonde_alerter(bigint, text, text, text, jsonb) is
  'Lève l''alerte d''une fenêtre de collecte, une seule par fenêtre : alert_event puis route_alert (v103).';
