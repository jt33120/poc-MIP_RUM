-- migration-v81 — P8.1 : effacement sérialisé avec l'ingestion.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Aucune donnée n'est supprimée par
-- ce fichier, aucune colonne n'est retirée : il ajoute deux tables, trois
-- colonnes de registre, les primitives de verrou partagées, et il REPREND les
-- fonctions d'effacement et de purge pour qu'elles couvrent les tables de P5,
-- P6 et P7.
--
-- ════════════════════ 1. LA COURSE QUE CE FICHIER FERME ══════════════════════
--
-- L'effacement identifiait les sessions EXISTANTES et supprimait leurs lignes.
-- Tout ce qui arrivait après ce relevé — un lot déjà déposé dans `ingest_raw`,
-- un beacon en vol, un chunk de rejeu, un log OTel portant la même identité —
-- recréait les lignes que l'on venait de supprimer, sans qu'aucune erreur ne le
-- signale. Le drain aggravait le cas : il tenait un verrou de ligne de file sur
-- SA connexion, puis appelait `writeRows(pool, …)`, qui ouvrait sa PROPRE
-- transaction sur une AUTRE connexion. Les deux écritures n'étaient donc pas
-- sérialisées entre elles, et aucun verrou posé côté DSAR ne pouvait les voir.
--
-- La correction tient en deux objets :
--
--   a. UN VERROU CONSULTATIF DE TRANSACTION PAR APPLICATION, pris par TOUS les
--      chemins d'écriture et par l'effacement. `pg_advisory_xact_lock`, jamais
--      un verrou de session : la chaîne de production passe par le pooler
--      transactionnel de Neon (PgBouncer en mode transaction), où chaque
--      transaction peut atterrir sur un backend différent — un verrou de session
--      y est pris sur une connexion et perdu sur la suivante. C'est la leçon
--      déjà payée par `migrate.mjs`, on ne la repaie pas.
--
--   b. UNE BARRIÈRE DURABLE, `privacy_erasure_barrier` : après l'effacement, le
--      sujet supprimé y est inscrit, et tout writer refuse ce qui s'y rattache.
--      Sans elle, le verrou ne protégerait que l'instant de la transaction : le
--      lot suivant recréerait tout, légalement, une seconde plus tard.
--
-- ORDRE DES VERROUS : APPLICATION D'ABORD, FILE ENSUITE. Le drain lit un
-- candidat SANS verrou, puis prend le verrou d'app, puis seulement reprend CETTE
-- ligne de file en `for update skip locked`. L'inverse — verrou de file puis
-- verrou d'app — s'interbloque avec l'effacement, qui prend l'app puis la file.
--
-- ═════════════ 2. CE QUE LA BARRIÈRE EST, ET CE QU'ELLE N'EST PAS ════════════
--
-- La barrière EST ELLE-MÊME UNE DONNÉE PSEUDONYME : un identifiant de session ou
-- un HMAC app-scopé, conservé pour pouvoir refuser. On ne prétend pas le
-- contraire. `expires_at` est NULLABLE et vaut NULL par défaut : le code sait
-- conserver une barrière SANS expiration, parce qu'une purge à 30 jours
-- n'offrirait aucune garantie contre une restauration plus ancienne.
--
-- LA DURÉE DE CONSERVATION DES BARRIÈRES, LEUR RÉACTIVATION APRÈS UNE NOUVELLE
-- COLLECTE AUTORISÉE ET LE TRAITEMENT DES SAUVEGARDES SONT UNE DÉCISION DE
-- POLITIQUE QUI N'A PAS ÉTÉ PRISE. Le protocole, les tables et les tests sont
-- donc livrés DERRIÈRE UNE ACTIVATION EXPLICITE, par application :
-- `app_registry.privacy_barrier_mode` vaut `off` par défaut, et la protection
-- durable est déclarée NON ACTIVÉE tant que l'exploitant ne l'a pas posée à
-- `enforce` — après avoir vérifié qu'aucun writer d'une version antérieure ne
-- tourne encore. Un vieux writer qui ignore les barrières empêche de déclarer
-- cette garantie, quel que soit l'état de cette colonne.
--
-- RÉACTIVATION D'UN SUJET EFFACÉ : aucune voie n'est ouverte. Le SDK ne peut
-- porter aucun drapeau qui lève une barrière ; il n'existe pas de fonction de
-- levée dans ce fichier. Les identifiants de session supprimés restent refusés
-- pour toujours, même si la politique autorise un jour l'identité à reprendre
-- avec de NOUVEAUX identifiants.
--
-- ═══════════════════════════ 3. VERROUS DE MIGRATION ═════════════════════════
--
-- `alter table app_registry` prend un ACCESS EXCLUSIVE tenu jusqu'au commit.
-- `lock_timeout` borne l'attente ; s'il expire, le fichier entier est annulé et
-- rejoué. Les trois colonnes ajoutées ont un DEFAULT constant ou NULL :
-- PostgreSQL 11+ les écrit dans le catalogue, sans réécrire la table.
set local lock_timeout = '5s';

-- ── 1. Primitives de verrou, partagées par la console, l'ingestion et le SQL ──
--
-- Une SEULE clé, dérivée d'un espace de noms dédié et de l'application. 811801
-- est arbitraire et stable ; 811100 est déjà pris par `migrate.mjs`, et les deux
-- ne doivent pas se croiser (un déploiement ne doit pas attendre l'ingestion).
--
-- `hashtext` rend un int4 déterministe pour une même instance : c'est tout ce
-- qu'exige un verrou, qui n'a besoin d'être d'accord qu'entre sessions
-- concurrentes du MÊME serveur. Deux applications qui partageraient un hash
-- partageraient un verrou : elles se sérialiseraient inutilement, jamais à
-- tort.
create or replace function mip_verrou_ingestion_ns() returns int
  language sql immutable parallel safe as $$ select 811801 $$;

comment on function mip_verrou_ingestion_ns() is
  'Espace de noms des verrous consultatifs d''ingestion/effacement (P8.1). Constante partagée : '
  'la console, le noyau d''ingestion et les fonctions SQL doivent utiliser CELLE-CI, jamais une '
  'valeur recopiée à la main.';

create or replace function mip_verrouiller_app(p_app_id text) returns void
language plpgsql as $$
begin
  -- Verrou de TRANSACTION : relâché au commit ou au rollback, y compris si le
  -- backend meurt. Compatible avec un pooler en mode transaction.
  perform pg_advisory_xact_lock(mip_verrou_ingestion_ns(), hashtext(p_app_id));
end $$;

comment on function mip_verrouiller_app(text) is
  'Sérialise écritures et effacement d''une application. À appeler APRÈS le begin et AVANT toute '
  'lecture de barrière : lire avant de verrouiller laisserait passer un effacement concurrent.';

create or replace function mip_verrouiller_apps(p_app_ids text[]) returns void
language plpgsql as $$
declare r record;
begin
  -- ORDRE DÉTERMINISTE, ET IL N'EST PAS LEXICAL. Trier par `app_id` ferait
  -- dépendre l'ordre de la collation : un client qui trie en UTF-16 (JavaScript)
  -- et un serveur qui trie en `fr_FR.UTF-8` ne prennent alors pas les verrous
  -- dans le même ordre, et deux lots multi-app s'interbloquent. On trie sur la
  -- CLÉ DE VERROU, qui est la même partout.
  for r in select distinct hashtext(a) as cle
             from unnest(coalesce(p_app_ids, '{}'::text[])) as a
            where a is not null
            order by 1
  loop
    perform pg_advisory_xact_lock(mip_verrou_ingestion_ns(), r.cle);
  end loop;
end $$;

comment on function mip_verrouiller_apps(text[]) is
  'Verrouille plusieurs applications dans l''ordre croissant de leur CLÉ de verrou — le seul ordre '
  'que le serveur et les clients calculent à l''identique. Utilisé par les lots multi-app et par '
  'les rafraîchissements d''agrégats.';

-- ── 2. La barrière d'effacement ──────────────────────────────────────────────
create table if not exists privacy_erasure_barrier (
  app_id       text        not null,
  subject_kind text        not null,
  subject_key  text        not null,
  erased_at    timestamptz not null default now(),
  request_id   uuid,
  expires_at   timestamptz,
  primary key (app_id, subject_kind, subject_key)
);

alter table privacy_erasure_barrier
  drop constraint if exists privacy_erasure_barrier_v81,
  add constraint privacy_erasure_barrier_v81 check (
    subject_kind in ('session', 'visitor', 'user', 'account')
    and char_length(subject_key) between 1 and 200
  );

comment on table privacy_erasure_barrier is
  'Sujets effacés dont les writers doivent refuser les données. Contient un identifiant technique '
  '(session, visiteur) ou un HMAC app-scopé (utilisateur, compte) : c''est une donnée PSEUDONYME, '
  'conservée pour pouvoir refuser. Aucune purge automatique : expires_at vaut NULL par défaut, '
  'et la politique de conservation reste à décider.';
comment on column privacy_erasure_barrier.expires_at is
  'NULL = barrière sans expiration (défaut). Une date n''est posée que par une politique explicite ; '
  'inventer une expiration ne protégerait de rien contre une restauration plus ancienne.';
comment on column privacy_erasure_barrier.request_id is
  'Demande d''effacement qui a posé la barrière, quand elle est connue. Nullable : une barrière '
  'posée par une reprise technique n''a pas de demande.';

create index if not exists idx_privacy_erasure_barrier_app_v81
  on privacy_erasure_barrier (app_id, subject_kind);

-- ── 3. L'audit des demandes — sans identifiant brut, sans payload ────────────
create table if not exists privacy_erasure_request (
  id             uuid        primary key default gen_random_uuid(),
  app_id         text        not null,
  actor          text        not null,
  subject_kind   text        not null,
  subject_digest text,
  status         text        not null default 'planned',
  counts         jsonb       not null default '{}'::jsonb,
  failure_reason text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  ended_at       timestamptz
);

alter table privacy_erasure_request
  drop constraint if exists privacy_erasure_request_v81,
  add constraint privacy_erasure_request_v81 check (
    subject_kind in ('session', 'visitor', 'user', 'account', 'app')
    and status in ('planned', 'running', 'completed', 'failed')
    and char_length(actor) between 1 and 320
    and (subject_digest is null or char_length(subject_digest) <= 32)
    and (failure_reason is null or char_length(failure_reason) <= 500)
  );

comment on table privacy_erasure_request is
  'Journal des demandes d''effacement : qui, quelle app, quel type de sujet, combien de lignes, et '
  'pourquoi si ça a échoué. `subject_digest` est un PRÉFIXE d''identifiant (16 caractères au plus) '
  '— assez pour rapprocher deux traces, pas pour reconstituer la personne. Aucun payload, aucune '
  'stack, aucun message n''entre ici.';
comment on column privacy_erasure_request.failure_reason is
  'Motif borné à 500 caractères. Une erreur PostgreSQL peut citer une valeur de ligne : elle est '
  'tronquée par l''appelant avant d''arriver ici.';

create index if not exists idx_privacy_erasure_request_app_v81
  on privacy_erasure_request (app_id, created_at desc);

-- ── 4. Portée tenant des deux tables ─────────────────────────────────────────
-- Motif des tables créées après v47 : portée explicite, jamais `using (true)`.
-- Les policies permissives se combinent en OU — une seule ouverte annulerait le
-- filtrage des autres sans que rien ne le dise.
alter table privacy_erasure_barrier enable row level security;
drop policy if exists tenant_scope on privacy_erasure_barrier;
create policy tenant_scope on privacy_erasure_barrier
  for select to console_ro using (app_id = any (current_app_ids()));

alter table privacy_erasure_request enable row level security;
drop policy if exists tenant_scope on privacy_erasure_request;
create policy tenant_scope on privacy_erasure_request
  for select to console_ro using (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on privacy_erasure_barrier from console_ro;
    grant select on privacy_erasure_barrier to console_ro;
    revoke all on privacy_erasure_request from console_ro;
    grant select on privacy_erasure_request to console_ro;
  end if;
  -- `anon` et `authenticated` sont des rôles hérités de l'ère Supabase : rien de
  -- ce qui touche à l'effacement ne leur est accessible.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on privacy_erasure_barrier from anon;
    revoke all on privacy_erasure_request from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on privacy_erasure_barrier from authenticated;
    revoke all on privacy_erasure_request from authenticated;
  end if;
end $$;

-- ── 5. Registre : activation de la barrière, et suspension d'ingestion ───────
--
-- `privacy_barrier_mode` est l'ACTIVATION EXPLICITE. Elle vaut `off` par défaut :
-- la protection durable n'est pas déclarée active tant qu'un exploitant ne l'a
-- pas posée à `enforce`, application par application. Ce n'est PAS un réglage
-- que le SDK peut porter : il n'existe aucun chemin d'écriture depuis
-- l'ingestion vers cette colonne.
--
-- `ingestion_suspended_at` répond à une autre faille : `erase_app_data` seule ne
-- garantit pas le silence. Tant qu'une clé reste active, le prochain beacon
-- recrée des lignes dans l'app que l'on vient d'effacer. La suspension est donc
-- posée DANS LA MÊME TRANSACTION que l'effacement, et sa levée est une opération
-- d'exploitation explicite — jamais l'effet du prochain événement reçu.
alter table app_registry
  add column if not exists privacy_barrier_mode   text        not null default 'off',
  add column if not exists ingestion_suspended_at timestamptz,
  add column if not exists ingestion_suspended_by text;

alter table app_registry
  drop constraint if exists app_registry_privacy_v81,
  add constraint app_registry_privacy_v81 check (
    privacy_barrier_mode in ('off', 'enforce')
    and (ingestion_suspended_by is null or char_length(ingestion_suspended_by) <= 200)
  ) not valid;

comment on column app_registry.privacy_barrier_mode is
  'off (défaut) : les barrières sont ENREGISTRÉES mais pas appliquées — la protection durable '
  'n''est pas déclarée active. enforce : tout writer refuse les données rattachables à un sujet '
  'effacé. Bascule = décision d''exploitation, après vérification qu''aucun writer antérieur à '
  'v81 ne tourne. Aucun chemin d''ingestion n''écrit cette colonne.';
comment on column app_registry.ingestion_suspended_at is
  'Posée par erase_app_data, sous la même transaction que l''effacement : l''ingestion de l''app '
  'est refusée même sans REQUIRE_API_KEY. Sa levée est une opération explicite.';

-- ── 6. Lecture des barrières applicables ─────────────────────────────────────
create or replace function privacy_barrieres_actives(
  p_app_id text,
  p_kinds  text[],
  p_keys   text[]
) returns table (subject_kind text, subject_key text)
language sql stable as $$
  select b.subject_kind, b.subject_key
    from privacy_erasure_barrier b
    join unnest(p_kinds, p_keys) as d(kind, cle)
      on d.kind = b.subject_kind and d.cle = b.subject_key
   where b.app_id = p_app_id
     -- Une barrière expirée ne bloque plus. Par défaut aucune ne l'est : la
     -- colonne vaut NULL tant qu'une politique n'a pas décidé autre chose.
     and (b.expires_at is null or b.expires_at > now());
$$;

comment on function privacy_barrieres_actives(text, text[], text[]) is
  'Sous-ensemble BLOQUANT des couples (kind, clé) proposés, pour UNE application. Les deux '
  'tableaux sont appariés position par position. Rien n''est déduit d''une ressemblance de message '
  'ou de stack : seuls des identifiants techniques ou des HMAC app-scopés sont comparés.';

create or replace function privacy_poser_barrieres(
  p_app_id     text,
  p_kind       text,
  p_keys       text[],
  p_request_id uuid default null
) returns bigint
language plpgsql as $$
declare n bigint;
begin
  -- `do nothing` et non `do update` : la première date d'effacement est la
  -- bonne. Réécrire `erased_at` à chaque demande ultérieure effacerait la
  -- chronologie sans rien protéger de plus.
  with pose as (
    insert into privacy_erasure_barrier (app_id, subject_kind, subject_key, request_id)
    select p_app_id, p_kind, cle, p_request_id
      from unnest(coalesce(p_keys, '{}'::text[])) as cle
     where cle is not null and cle <> ''
    on conflict (app_id, subject_kind, subject_key) do nothing
    returning 1
  )
  select count(*) into n from pose;
  return n;
end $$;

comment on function privacy_poser_barrieres(text, text, text[], uuid) is
  'Inscrit des sujets effacés. Idempotente : une demande rejouée n''écrase pas la date du premier '
  'effacement. Aucune fonction de LEVÉE n''existe : la réactivation d''un sujet est une décision '
  'de politique qui n''a pas été prise, et elle ne sera pas l''effet d''un appel oublié ici.';

-- ── 7. Filtrage chirurgical de la file de débarquement ───────────────────────
--
-- UN LOT MIXTE NE SE SUPPRIME PAS EN ENTIER. `ingest_raw.lot` porte les
-- collections aplaties de plusieurs personnes : supprimer la ligne parce qu'une
-- seule est concernée effacerait les données de quelqu'un qui n'a rien demandé —
-- le défaut exact que lib/dsar.ts refuse par ailleurs. On retire donc les
-- ÉLÉMENTS rattachés, et on ne supprime la ligne que si plus rien de télémétrique
-- n'y reste.
--
-- Le rattachement se fait par identifiant : session, visiteur, HMAC utilisateur
-- ou compte. JAMAIS par ressemblance de message ou de stack.
create or replace function privacy_filtrer_file(
  p_app_id           text,
  p_sessions         text[] default '{}',
  p_visitors         text[] default '{}',
  p_user_hashes      text[] default '{}',
  p_account_hashes   text[] default '{}'
) returns jsonb
language plpgsql as $$
declare
  -- Toutes les collections que `writeRows` déstructure. `apiKeys` et `rejected`
  -- ne sont pas de la télémétrie : ils ne comptent pas pour décider si un lot
  -- reste vivant.
  collections constant text[] := array[
    'sessions', 'pageviews', 'metrics', 'errors', 'resources', 'longtasks',
    'breadcrumbs', 'events', 'actions', 'spans', 'eventIndex',
    'sviCalls', 'sviSteps', 'sviLegs'
  ];
  lignes      bigint := 0;
  elements    bigint := 0;
  supprimes   bigint := 0;
  r           record;
  cle         text;
  filtre      jsonb;
  conserves   jsonb;
  avant       bigint;
  apres       bigint;
  total_avant bigint;
  total_apres bigint;
begin
  for r in
    select id, lot from ingest_raw where app_id = p_app_id for update
  loop
    filtre := r.lot;
    total_avant := 0;
    total_apres := 0;
    foreach cle in array collections loop
      if jsonb_typeof(filtre -> cle) <> 'array' then continue; end if;
      select count(*) into avant from jsonb_array_elements(filtre -> cle);
      select coalesce(jsonb_agg(e), '[]'::jsonb) into conserves
        from jsonb_array_elements(filtre -> cle) e
       where not (
             (e ->> 'session_id')      = any (coalesce(p_sessions, '{}'))
          or (e ->> 'visitor_id')      = any (coalesce(p_visitors, '{}'))
          or (e ->> 'user_id_hash')    = any (coalesce(p_user_hashes, '{}'))
          or (e ->> 'account_id_hash') = any (coalesce(p_account_hashes, '{}'))
       );
      select jsonb_array_length(conserves) into apres;
      filtre := jsonb_set(filtre, array[cle], conserves);
      total_avant := total_avant + avant;
      total_apres := total_apres + apres;
    end loop;
    if total_avant = total_apres then continue; end if;
    elements := elements + (total_avant - total_apres);
    if total_apres = 0 then
      delete from ingest_raw where id = r.id;
      supprimes := supprimes + 1;
    else
      update ingest_raw set lot = filtre where id = r.id;
      lignes := lignes + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'lots_filtres', lignes, 'lots_supprimes', supprimes, 'elements_retires', elements);
end $$;

comment on function privacy_filtrer_file(text, text[], text[], text[], text[]) is
  'Retire d''un lot encore en file les éléments rattachés aux sujets effacés, et ne supprime la '
  'ligne que si plus aucune collection de télémétrie n''y subsiste. Un lot portant deux personnes '
  'perd celle qui a demandé l''effacement et conserve l''autre.';

-- ── 8. Réconciliation des issues après un effacement ────────────────────────
--
-- Une issue d'erreur ne porte ni session, ni identité, ni message : elle reste
-- hors du périmètre DSAR par construction (cf. lib/dsar.ts). Mais ses BORNES
-- (première/dernière vue, releases) sont dérivées de ses occurrences, et son
-- ACTIVITÉ contient du texte d'opérateur — un commentaire de triage peut citer
-- un extrait de données. Quand l'effacement retire toutes les occurrences d'une
-- issue, la garder reviendrait à conserver l'exemplaire et son commentaire alors
-- que la donnée d'origine n'existe plus.
--
-- On ne touche QUE les issues dont des occurrences viennent d'être supprimées :
-- une issue vidée par la rétention relève de `purge_rum_app`, pas d'ici.
create or replace function privacy_reconcilier_issues(p_app_id text, p_issue_ids uuid[])
returns jsonb
language plpgsql as $$
declare vides bigint := 0; recalculees bigint := 0;
begin
  if p_issue_ids is null or array_length(p_issue_ids, 1) is null then
    return jsonb_build_object('issues_supprimees', 0, 'issues_recalculees', 0);
  end if;
  -- Plus aucune occurrence : l'issue disparaît, et avec elle (par cascade) ses
  -- alias, son activité — donc les commentaires d'opérateur —, ses liens de
  -- ticket et ses notifications.
  with mortes as (
    delete from error_issue i
     where i.app_id = p_app_id and i.id = any (p_issue_ids)
       and not exists (select 1 from rum_error e
                        where e.app_id = i.app_id and e.issue_id = i.id)
    returning 1
  )
  select count(*) into vides from mortes;

  -- Il en reste : les bornes sont recalculées sur ce qui subsiste réellement.
  -- Laisser un `last_seen` d'une occurrence effacée ferait mentir la liste des
  -- issues et pourrait rouvrir une régression sur une donnée qui n'existe plus.
  with vivantes as (
    update error_issue i
       set first_seen    = agg.premiere,
           last_seen     = agg.derniere,
           first_release = agg.premiere_release,
           last_release  = agg.derniere_release,
           updated_at    = now()
      from (
        select e.issue_id,
               min(e.ts) as premiere,
               max(e.ts) as derniere,
               (array_agg(e.release order by e.ts asc)  filter (where e.release is not null))[1] as premiere_release,
               (array_agg(e.release order by e.ts desc) filter (where e.release is not null))[1] as derniere_release
          from rum_error e
         where e.app_id = p_app_id and e.issue_id = any (p_issue_ids)
         group by e.issue_id
      ) agg
     where i.app_id = p_app_id and i.id = agg.issue_id
       and (i.first_seen, i.last_seen) is distinct from (agg.premiere, agg.derniere)
    returning 1
  )
  select count(*) into recalculees from vivantes;

  return jsonb_build_object('issues_supprimees', vides, 'issues_recalculees', recalculees);
end $$;

comment on function privacy_reconcilier_issues(text, uuid[]) is
  'Après un effacement : supprime les issues dont plus aucune occurrence ne subsiste (leurs '
  'commentaires de triage partent avec elles, par cascade) et recalcule les bornes des autres. '
  'Aucune décision fondée sur une ressemblance de message ou de stack.';

-- ── 9. erase_session — verrou d'app, barrière, agrégats et issues ────────────
--
-- Reprise de la définition de v80, avec QUATRE additions :
--   a. le verrou d'application est pris AVANT toute lecture, de sorte qu'un
--      writer concurrent attende ou voie la barrière ;
--   b. la session effacée est inscrite en barrière — SI l'application a activé
--      la protection. Sous `off`, rien n'est conservé de la personne effacée :
--      une barrière est elle-même un identifiant pseudonyme, et en retenir un
--      « au cas où » serait précisément ce qu'on reproche à l'ingestion ;
--   c. les heures d'agrégat faussées sont marquées pour les DEUX sources ;
--   d. les issues qui perdent leurs occurrences sont réconciliées.
create or replace function erase_session(p_session_id text)
returns jsonb language plpgsql as $$
declare
  result  jsonb := jsonb_build_object('session_id', p_session_id);
  n       bigint;
  apps    text[];
  issues  uuid[];
  app     text;
begin
  select coalesce(array_agg(distinct app_id), '{}') into apps
    from rum_session where session_id = p_session_id;
  -- Verrou d'abord : une lecture faite avant le verrou pourrait être invalidée
  -- par une écriture concurrente entre-temps.
  perform mip_verrouiller_apps(apps);

  foreach app in array apps loop
    if (select privacy_barrier_mode from app_registry where app_id = app) = 'enforce' then
      perform privacy_poser_barrieres(app, 'session', array[p_session_id]);
    end if;
  end loop;

  delete from ingest_raw
   where lot @> jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('session_id', p_session_id)));
  get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);

  -- `rum_metric` alimente `metric_histogram_hourly` : les heures touchées sont
  -- marquées dans la même instruction que la suppression. Une CTE de
  -- modification s'exécute toujours, qu'on lise sa sortie ou non.
  with supprimees as (
    delete from rum_metric where session_id = p_session_id returning app_id, ts
  ), marquees as (
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select distinct source, app_id, date_trunc('hour', ts), 'dsar'
      from supprimees, unnest(array['metric_histogram_hourly', 'rum_rollup_hourly']) as source
    on conflict (source, app_id, hour) do update set reason = excluded.reason, noted_at = now()
    returning 1
  )
  select count(*) into n from supprimees;
  result := result || jsonb_build_object('rum_metric', n);

  with supprimees as (
    delete from rum_error where session_id = p_session_id returning app_id, ts, issue_id
  ), marquees as (
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select distinct 'rum_rollup_hourly', app_id, date_trunc('hour', ts), 'dsar' from supprimees
    on conflict (source, app_id, hour) do update set reason = excluded.reason, noted_at = now()
    returning 1
  )
  select count(*), coalesce(array_agg(distinct issue_id) filter (where issue_id is not null), '{}')
    into n, issues from supprimees;
  result := result || jsonb_build_object('rum_error', n);

  delete from rum_resource    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  -- `rum_ai` porte session_id et MANQUAIT : elle figurait dans le périmètre DSAR
  -- de la console mais pas dans cette fonction. Une session effacée par
  -- l'exploitation y laissait donc ses appels de modèle.
  delete from rum_ai          where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_ai', n);
  delete from replay_chunk    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);

  with supprimees as (
    delete from rum_pageview where session_id = p_session_id returning app_id, started_at
  ), marquees as (
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select distinct 'rum_rollup_hourly', app_id, date_trunc('hour', started_at), 'dsar' from supprimees
    on conflict (source, app_id, hour) do update set reason = excluded.reason, noted_at = now()
    returning 1
  )
  select count(*) into n from supprimees;
  result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session     where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);

  foreach app in array apps loop
    result := result || jsonb_build_object('issues', privacy_reconcilier_issues(app, issues));
  end loop;
  return result;
end $$;

comment on function erase_session(text) is
  'Efface une session et tout ce qui s''y rattache, sous le verrou de son application. Inscrit la '
  'barrière durable si l''app a activé la protection ; marque les heures d''agrégat faussées ; '
  'réconcilie les issues vidées. Reste indexée sur session_id seul pour compatibilité : les '
  'applications portant cet identifiant sont résolues puis verrouillées.';

-- ── 10. purge_rum_app / erase_app_data — la liste complète, enfin ───────────
--
-- POURQUOI CES DEUX FONCTIONS SONT REPRISES ICI. v79 (P6.5) et v80 (P6.6) ont
-- été écrites en parallèle et fusionnées sans conflit déclaré : v80 a repris la
-- définition d'`erase_app_data` telle qu'elle était AVANT v79, et lui a donc
-- retiré `analytics_saved_view` et `dashboard`. Sur une base où les deux
-- fichiers sont appliqués dans l'ordre, effacer un client laissait ses vues
-- enregistrées et ses tableaux de bord en place. Le test de v79 ne le voyait pas
-- parce que le test PRÉCÉDENT rejoue `migration-v79.sql`, ce qui restaure la
-- définition juste avant l'assertion. La liste ci-dessous est l'union des tables
-- app-scopées de P5, P6 et P7, et un test la compare désormais au CATALOGUE
-- plutôt qu'à une liste recopiée.
--
-- `purge_rum_app` NE PREND PAS le verrou d'application, à dessein : c'est une
-- suppression de données ANCIENNES, sous une borne de temps. Elle ne peut pas
-- recréer une ligne effacée, et un writer concurrent n'écrit que des lignes
-- postérieures à la coupure. La lui faire prendre ferait tenir tous les verrous
-- d'app pendant toute la purge nocturne (`purge_rum_tenants` boucle dans UNE
-- transaction) : on bloquerait l'ingestion entière pour protéger d'une course
-- qui n'existe pas.
create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_event_index where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action a
   where a.app_id = p_app_id and a.ts < p_cutoff
     and not exists (select 1 from rum_error x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_resource x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_breadcrumb x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_span x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_event x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id and last_seen < p_cutoff;   get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from rum_resource    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from rum_ai          where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_ai', n);
  delete from replay_chunk    where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event x where x.session_id = s.session_id)
     and not exists (select 1 from rum_span x where x.session_id = s.session_id)
     and not exists (select 1 from rum_action x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event_index x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from sourcemap_upload_token
   where app_id = p_app_id and least(expires_at, coalesce(revoked_at, expires_at)) < p_cutoff;
  get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  -- `privacy_erasure_barrier` N'EST PAS PURGÉE ICI. Une barrière n'est pas une
  -- observation datée : c'est le refus opposé à une résurrection, et sa durée de
  -- conservation est une décision de politique, pas un effet de la rétention des
  -- mesures. `expires_at` existe pour porter cette décision le jour où elle sera
  -- prise ; tant qu'elle vaut NULL, rien n'expire.
  return result;
end $$;

comment on function purge_rum_app(text, timestamptz) is
  'Rétention par application. Ne touche NI privacy_erasure_barrier NI privacy_erasure_request : '
  'une barrière n''est pas une observation datée. Ne prend pas le verrou d''ingestion : elle ne '
  'supprime que des lignes antérieures à sa coupure.';

create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  -- Verrou D'ABORD : un lot en cours d'écriture pour cette app termine, ou
  -- attend. Sans lui, un beacon en vol réinsérerait des lignes entre le début et
  -- la fin de cette fonction.
  perform mip_verrouiller_app(p_app_id);

  -- SUSPENDRE AVANT D'EFFACER, dans la même transaction. `erase_app_data` seule
  -- ne peut pas garantir le silence : tant que la clé reste active, le prochain
  -- événement reçu recrée des lignes dans l'app que l'on vient de vider. La
  -- reprise de l'ingestion est une opération d'exploitation explicite — remettre
  -- `active` à vrai et effacer `ingestion_suspended_at` — jamais l'effet d'un
  -- événement entrant.
  update app_registry
     set active = false,
         ingestion_suspended_at = coalesce(ingestion_suspended_at, now()),
         ingestion_suspended_by = coalesce(ingestion_suspended_by, 'erase_app_data')
   where app_id = p_app_id;
  get diagnostics n = row_count; result := result || jsonb_build_object('app_registry_suspendue', n);

  delete from ingest_raw      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from error_issue     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_issue', n);
  delete from error_grouping_config where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_grouping_config', n);
  delete from rum_resource    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from rum_ai          where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_ai', n);
  -- Triage historique par empreinte (v40) : app-scopé, et il porte du texte
  -- d'opérateur. Il MANQUAIT de cette liste.
  delete from error_status    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('error_status', n);
  -- SVI (v51) : télémétrie d'appels, app-scopée, écrite par le même writeRows.
  -- Elle manquait aussi — effacer un client lui laissait ses appels. Enfants
  -- avant parent : les FK pointent toutes vers svi_call.
  delete from svi_call_link     where app_id = p_app_id;
  delete from svi_quality_sample where app_id = p_app_id;
  delete from svi_queue_sample   where app_id = p_app_id;
  delete from svi_leg            where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('svi_leg', n);
  delete from svi_step           where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('svi_step', n);
  delete from svi_call           where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('svi_call', n);
  delete from replay_chunk    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from analytics_rollup_invalidation where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_rollup_invalidation', n);
  delete from route_pattern where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from sourcemap_upload_token where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap_upload_token', n);
  delete from syn_snapshot where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  -- v79 (P6.5), perdues par la reprise de v80 : réinstaurées ici.
  delete from analytics_saved_view where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('analytics_saved_view', n);
  delete from dashboard where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('dashboard', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  -- ── CE QUI SURVIT, ET POURQUOI ────────────────────────────────────────────
  -- Un test compare cette liste au CATALOGUE : une table app-scopée ajoutée
  -- plus tard sans être traitée ici fait échouer la recette, au lieu de laisser
  -- des données derrière un effacement client.
  --   · privacy_erasure_barrier / privacy_erasure_request : c'est ce qui empêche
  --     une réactivation de l'app de ressusciter un sujet effacé auparavant ;
  --   · app_registry : la ligne PORTE la suspension d'ingestion posée ci-dessus.
  --     La supprimer rouvrirait l'app au prochain événement reçu ;
  --   · tenant_usage_daily : métrage de facturation, pas de la télémétrie. Le
  --     détruire effacerait la preuve de ce qui a été facturé ;
  --   · rate_counter : compteurs de débit d'une fenêtre d'une minute, sans
  --     rattachement à une personne, purgés par la rétention ;
  --   · error_issue_activity / _alias / _ticket / _notification : supprimés en
  --     CASCADE avec leur issue (FK sur (app_id, issue_id)) ;
  --   · uptime_result : supprimé en cascade avec uptime_check.
  -- La configuration d'exploitation encore rattachée à l'app — slo, goal,
  -- notify_channel, uptime_check, read_tokens, deploy_marker, ai_briefing,
  -- extension_scope, extension_install_app, alert_config — n'est PAS supprimée
  -- ici : ce sont des objets d'exploitation, pas de la donnée de personnes, et
  -- leur suppression relève du retrait d'un client, pas de l'effacement de ses
  -- données. Écart ASSUMÉ, et consigné.
  return result;
end $$;

comment on function erase_app_data(text) is
  'Efface toutes les données d''une application et SUSPEND son ingestion dans le registre, sous le '
  'même verrou. Conserve privacy_erasure_barrier et privacy_erasure_request. La reprise de '
  'l''ingestion est une opération explicite.';

-- ── 11. Les rematérialisations passent par le même verrou ───────────────────
--
-- Un rafraîchissement d'agrégat lit les tables sources et réécrit une projection.
-- Deux défauts s'y logent quand il n'est pas sérialisé avec l'effacement :
--
--   a. il peut réécrire une cellule à partir de lignes qu'un effacement vient de
--      supprimer — un compteur périmé, pas une résurrection, mais faux ;
--   b. il LÈVE les marques d'invalidation des heures qu'il recalcule. Si une
--      marque est posée entre sa lecture et sa levée, elle disparaît sans que
--      l'heure ait été recalculée : la cellule fausse redevient « digne de foi ».
--
-- Les deux se ferment avec le verrou d'application, pris avant toute lecture.
-- On verrouille les apps du registre ET celles qui portent une marque : une app
-- non enregistrée n'ingère qu'en configuration ouverte (hors production).
--
-- REPRISE DES VIEILLES MARQUES. Jusqu'ici, une marque plus ancienne que la
-- fenêtre de rafraîchissement n'était jamais levée : son heure restait lue brute
-- indéfiniment (lent, jamais faux — mais jamais réparé non plus). La fenêtre est
-- désormais ÉLARGIE jusqu'à la plus vieille marque en attente, bornée à 90 jours.
-- Le coût est payé une fois après un effacement, puis la fenêtre redescend.
create or replace function mip_fenetre_reprise(p_source text, p_hours int)
returns int language sql stable as $$
  select least(
    24 * 90,
    greatest(
      greatest(p_hours, 1),
      coalesce(
        ceil(extract(epoch from (now() - min(hour))) / 3600)::int + 1,
        greatest(p_hours, 1)
      )
    )
  )
  from analytics_rollup_invalidation where source = p_source;
$$;

comment on function mip_fenetre_reprise(text, int) is
  'Fenêtre horaire à recalculer : la fenêtre ordinaire, élargie jusqu''à la plus vieille marque '
  'd''invalidation en attente, bornée à 90 jours. Sans marque, elle rend la fenêtre ordinaire.';

create or replace function mip_apps_a_verrouiller() returns text[]
language sql stable as $$
  select coalesce(array_agg(distinct app_id), '{}'::text[]) from (
    select app_id from app_registry
    union
    select app_id from analytics_rollup_invalidation
  ) u;
$$;

create or replace function refresh_rum_rollups(p_hours int default 26)
returns int language plpgsql as $$
declare n int; v_hours int; v_lo timestamptz;
begin
  perform mip_verrouiller_apps(mip_apps_a_verrouiller());
  v_hours := mip_fenetre_reprise('rum_rollup_hourly', p_hours);
  v_lo := date_trunc('hour', now()) - make_interval(hours => v_hours);

  -- La fenêtre est VIDÉE avant d'être réécrite, comme le fait déjà
  -- `refresh_metric_histogram` (v80) et pour la même raison : `on conflict do
  -- update` ne touche que les cellules que la nouvelle agrégation produit. Une
  -- cellule dont plus aucune ligne ne relève — après un effacement — survivait
  -- avec son ancien effectif et continuait d'être lue. En une instruction
  -- séparée, et non en CTE de modification : deux CTE qui écrivent la même table
  -- dans un seul ordre ne voient pas les effets l'une de l'autre.
  delete from rum_rollup_hourly where hour >= v_lo;

  with lo as (
    select v_lo as t
  ),
  agg as (
    select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
           sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
           sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
           0::bigint as pageviews, 0::bigint as errors
    from rum_metric m left join rum_session s using (session_id), lo
    where m.ts >= lo.t and m.name = any(mip_core_vitals()) group by 1, 2, 3
    union all
    select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
           0::float, 0::float, count(*)::bigint, 0::bigint
    from rum_pageview p left join rum_session s using (session_id), lo
    where p.started_at >= lo.t group by 1, 2, 3
    union all
    -- v64 : le rollup est la source de trafic quand RUM_USE_ROLLUPS=1, et
    -- compter les LIGNES y sous-estimerait chaque répétition que le SDK a
    -- volontairement compactée. Une erreur hors-ligne peut aussi conserver un
    -- `ts` ancien tout en venant d'être écrite : la fenêtre normale reconstruit
    -- donc aussi son bucket historique quand `ingested_at` est récent.
    select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
           0::float, 0::float, 0::bigint, coalesce(sum(e.occurrences), 0)::bigint
    from rum_error e left join rum_session s using (session_id), lo
    where e.ts >= lo.t or e.ingested_at >= lo.t group by 1, 2, 3
  ),
  merged as (
    select app_id, device_type, hour,
           sum(good_w) as good_w, sum(total_w) as total_w,
           sum(pageviews) as pageviews, sum(errors) as errors
    from agg group by 1, 2, 3
  ),
  up as (
    insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
    select app_id, device_type, hour, good_w, total_w, pageviews, errors from merged
    on conflict (app_id, device_type, hour) do update
      set good_w = excluded.good_w, total_w = excluded.total_w,
          pageviews = excluded.pageviews, errors = excluded.errors
    returning 1
  )
  select count(*) into n from up;

  -- Les heures recalculées redeviennent dignes de foi. Sous le verrou : aucune
  -- marque ne peut être posée entre l'agrégation ci-dessus et cette levée.
  delete from analytics_rollup_invalidation
   where source = 'rum_rollup_hourly'
     and hour >= date_trunc('hour', now()) - make_interval(hours => v_hours);
  return n;
end $$;

comment on function refresh_rum_rollups(int) is
  'Rafraîchit la heatmap horaire sous le verrou d''ingestion des applications concernées, élargit '
  'sa fenêtre jusqu''à la plus vieille marque d''invalidation (90 jours au plus) et lève les '
  'marques des heures réellement recalculées.';

-- Reprise de la définition de v80, avec DEUX additions : le verrou d'ingestion
-- avant toute lecture, et la fenêtre élargie aux marques en attente.
create or replace function refresh_metric_histogram(p_hours int default 26)
returns int language plpgsql as $function$
declare n int; v_now timestamptz := now(); v_max bigint; v_debut timestamptz; v_plein timestamptz; v_hours int;
begin
  perform mip_verrouiller_apps(mip_apps_a_verrouiller());
  v_hours := mip_fenetre_reprise('metric_histogram_hourly', p_hours);
  -- AVANT l'agrégation : une ligne insérée pendant le calcul doit se retrouver
  -- au-dessus de la borne, jamais en dessous.
  select coalesce(max(id), 0) into v_max from rum_metric;
  v_debut := v_now - make_interval(hours => greatest(v_hours, 1));
  v_plein := date_trunc('hour', v_debut)
             + case when date_trunc('hour', v_debut) = v_debut then interval '0' else interval '1 hour' end;

  -- La fenêtre recalculée est d'abord vidée : ce qui n'a plus de ligne derrière
  -- lui ne doit pas survivre à sa réécriture.
  delete from metric_histogram_hourly where hour >= v_plein and hour < v_now;

  with agg as (
    select m.app_id,
           coalesce(s.device_type, '') as device_type,
           m.name,
           date_trunc('hour', m.ts) as hour,
           mip_seau(m.value) as bucket,
           sum(coalesce(s.weight, 1))::double precision as weighted_count,
           count(*)::bigint as observed_count
      from rum_metric m
      left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
     where m.id <= v_max
       and m.ts >= v_plein
       and m.ts < v_now
       and m.name = any(mip_core_vitals())
       and not coalesce(s.is_bot, false)
     group by 1, 2, 3, 4, 5
  ),
  up as (
    insert into metric_histogram_hourly (app_id, device_type, name, hour, bucket, weighted_count, observed_count)
    select app_id, device_type, name, hour, bucket, weighted_count, observed_count from agg
    on conflict (app_id, device_type, name, hour, bucket)
      do update set weighted_count = excluded.weighted_count, observed_count = excluded.observed_count
    returning 1
  )
  select count(*) into n from up;

  -- Les heures recalculées redeviennent dignes de foi. La fenêtre couvrant
  -- désormais les marques en attente, une marque posée par un effacement plus
  -- ancien finit par être levée au lieu de rester indéfiniment.
  delete from analytics_rollup_invalidation
   where source = 'metric_histogram_hourly' and hour >= v_plein and hour < v_now;

  -- APRÈS l'insertion, dans la même transaction : si le rafraîchissement échoue,
  -- la borne ne bouge pas et la lecture recalcule simplement une fenêtre plus
  -- large. Un échec coûte du temps de calcul, jamais une valeur fausse.
  insert into metric_histogram_state (seul, refreshed_at, max_metric_id) values (true, v_now, v_max)
    on conflict (seul) do update set refreshed_at = excluded.refreshed_at,
                                     max_metric_id = excluded.max_metric_id;
  return n;
end $function$;

comment on function refresh_metric_histogram(int) is
  'Rafraîchit la distribution horaire des Core Web Vitals sous le verrou d''ingestion des '
  'applications concernées (P8.1), élargit sa fenêtre jusqu''à la plus vieille marque '
  'd''invalidation (90 jours au plus), lève les marques des heures recalculées et avance le '
  'filigrane. Rejouable sans double-compter : la fenêtre est vidée puis réécrite.';

-- ── 12. Index de la file, pour le pré-relevé sans verrou du drain ───────────
-- Le drain lit un candidat par application avant de prendre le moindre verrou
-- (cf. ingest-differe.mjs). Sans cet index, ce pré-relevé parcourt la file.
--
-- `ingest_raw` est VIDE quand `INGEST_DEFERRED` est éteint — le défaut — et la
-- construction est alors instantanée. Allumé, la file peut être chaude : on
-- refuse d'y construire un index sous le verrou de la transaction de migration,
-- et on exige le pré-déploiement en ligne. Même garde-fou que v80 sur rum_event.
do $$
begin
  if pg_total_relation_size('public.ingest_raw') > 33554432
     and to_regclass('public.idx_ingest_raw_app_a_faire_v81') is null then
    raise exception 'v81: précréer idx_ingest_raw_app_a_faire_v81 avec predeploy-v81-indexes.sql';
  end if;
end $$;

create index if not exists idx_ingest_raw_app_a_faire_v81
  on ingest_raw (app_id, reprendre_a, id) where tentatives < 5;

comment on index idx_ingest_raw_app_a_faire_v81 is
  'Pré-relevé d''un lot candidat PAR APPLICATION, hors verrou. Le prédicat partiel reprend celui '
  'de idx_ingest_raw_a_faire (v63) : MAX_TENTATIVES vaut 5 des deux côtés.';

-- ── 13. Heures d'agrégat faussées par un effacement DSAR ────────────────────
--
-- Les mêmes marques que celles posées par `erase_session`, mais pour un
-- effacement conduit ligne à ligne depuis la console : elles doivent être posées
-- AVANT les suppressions, sinon plus rien ne dit quelles heures recompter.
create or replace function privacy_marquer_heures(
  p_app_id         text,
  p_sessions       text[] default '{}',
  p_user_hashes    text[] default '{}',
  p_account_hashes text[] default '{}'
) returns bigint
language plpgsql as $$
declare n bigint;
begin
  with heures as (
    -- Les mesures alimentent les DEUX projections horaires.
    select s.source, m.app_id, date_trunc('hour', m.ts) as hour
      from rum_metric m,
           unnest(array['metric_histogram_hourly', 'rum_rollup_hourly']) as s(source)
     where m.app_id = p_app_id and m.session_id = any (coalesce(p_sessions, '{}'))
    union
    select 'rum_rollup_hourly', e.app_id, date_trunc('hour', e.ts)
      from rum_error e
     where e.app_id = p_app_id
       and (e.session_id = any (coalesce(p_sessions, '{}'))
            or e.user_id_hash = any (coalesce(p_user_hashes, '{}'))
            or e.account_id_hash = any (coalesce(p_account_hashes, '{}')))
    union
    select 'rum_rollup_hourly', p.app_id, date_trunc('hour', p.started_at)
      from rum_pageview p
     where p.app_id = p_app_id and p.session_id = any (coalesce(p_sessions, '{}'))
  ), posees as (
    insert into analytics_rollup_invalidation (source, app_id, hour, reason)
    select source, app_id, hour, 'dsar' from heures
    on conflict (source, app_id, hour) do update set reason = excluded.reason, noted_at = now()
    returning 1
  )
  select count(*) into n from posees;
  return n;
end $$;

comment on function privacy_marquer_heures(text, text[], text[], text[]) is
  'Marque les heures d''agrégat que l''effacement va fausser, AVANT de supprimer les lignes — '
  'après, plus rien ne dirait lesquelles recompter. Les rafraîchissements élargissent leur fenêtre '
  'jusqu''à la plus vieille marque et les lèvent.';

-- ── 14. Sessions d'une identité encore EN FILE ──────────────────────────────
--
-- La faille d'origine : l'effacement ne voyait que les sessions déjà écrites.
-- Un lot déposé après le relevé — ou avant, mais pas encore drainé — portait une
-- session de la même personne, et le drain la recréait. On lit donc aussi la
-- file, par identifiant, jamais par ressemblance.
create or replace function privacy_sessions_en_file(
  p_app_id         text,
  p_user_hashes    text[] default '{}',
  p_account_hashes text[] default '{}',
  p_visitors       text[] default '{}'
) returns text[]
language sql stable as $$
  select coalesce(array_agg(distinct e ->> 'session_id'), '{}'::text[])
    from ingest_raw r,
         lateral jsonb_array_elements(
           case when jsonb_typeof(r.lot -> 'sessions') = 'array' then r.lot -> 'sessions' else '[]'::jsonb end
         ) as e
   where r.app_id = p_app_id
     and e ->> 'session_id' is not null
     and ( (e ->> 'user_id_hash')    = any (coalesce(p_user_hashes, '{}'))
        or (e ->> 'account_id_hash') = any (coalesce(p_account_hashes, '{}'))
        or (e ->> 'visitor_id')      = any (coalesce(p_visitors, '{}')) );
$$;

comment on function privacy_sessions_en_file(text, text[], text[], text[]) is
  'Identifiants de session qu''un lot ENCORE EN FILE rattache à cette personne. Sans cette lecture, '
  'un effacement fondé sur les seules sessions existantes laisse le drain recréer ce qu''il vient '
  'de supprimer.';
