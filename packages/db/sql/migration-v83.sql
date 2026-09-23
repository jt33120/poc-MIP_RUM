-- migration-v83 — P8.2 : journal des reprises d'historique (backfills).
--
-- Additive et rejouable, PostgreSQL 15 à 17. Elle ajoute UNE table technique,
-- `backfill_run`, et raccroche cette table à l'effacement d'application de P8.1.
-- Aucune donnée n'est supprimée, aucune colonne retirée, aucune fonction de
-- lecture modifiée.
--
-- v81 est prise par P8.1, v82 par P7.5 : ce fichier prend v83.
--
-- ═════════════════ 1. CE QUE CETTE TABLE EST, ET N'EST PAS ═══════════════════
--
-- `backfill_run` est un JOURNAL TECHNIQUE : quelle application, quel `kind`,
-- quelle fenêtre, quelles bornes hautes de source, quelles empreintes de plan et
-- de code, où en est le curseur, et combien de lignes ont été lues, écrites,
-- ignorées ou en échec. Elle ne contient AUCUN extrait de télémétrie : pas de
-- message, pas de stack, pas d'identifiant de personne, pas de route. Le
-- curseur (`checkpoint_json`) ne porte que des clés d'ordre — identifiant de
-- ligne et horodatage —, jamais le contenu de la ligne.
--
-- Elle n'est pas non plus un manifeste de plan : `plan_sha` suffit à prouver
-- qu'une reprise rejoue LE MÊME plan, et le manifeste lui-même vit dans un
-- fichier hors base (cf. scripts/backfill-rum.mjs). Persister le plan complet
-- en base n'apporterait rien et ferait entrer des comptes détaillés par table
-- dans un objet qu'on veut garder trivialement lisible.
--
-- ═══════════ 2. POURQUOI UNE SEULE EXÉCUTION ACTIVE PAR PÉRIMÈTRE ════════════
--
-- Deux exécutions simultanées sur la même application et le même `kind` se
-- disputeraient le même verrou d'ingestion (P8.1) et avanceraient deux curseurs
-- indépendants sur la même fenêtre : chacune relirait ce que l'autre vient
-- d'écrire, les compteurs cesseraient de vouloir dire quelque chose, et une
-- pause n'arrêterait qu'une moitié du travail. L'unicité est donc posée EN BASE,
-- par un index partiel sur les états vivants — pas par une convention de code
-- que deux processus lancés à une seconde d'intervalle ne verraient pas.
--
-- Le périmètre est (app, kind, from, to) : deux fenêtres disjointes du même
-- `kind` restent interdites en parallèle, et c'est voulu — un seul travailleur
-- par application (spec §3), sinon le verrou d'ingestion sérialise de toute
-- façon les deux, en plus lent et sans garantie de progression équitable.
--
-- ═════════════ 3. CE QUE L'EFFACEMENT D'UNE APPLICATION EN FAIT ══════════════
--
-- `erase_app_data` la vide. Une ligne de journal ne contient pas de donnée de
-- personne, mais elle est app-scopée, et une application effacée ne doit pas
-- laisser derrière elle la trace de ce qu'on a reconstruit chez elle. Le test
-- de recette compare la liste des tables app-scopées AU CATALOGUE : oublier
-- cette table ferait échouer la recette, pas un audit six mois plus tard.
--
-- LA DÉFINITION DE `erase_app_data` N'EST PAS RECOPIÉE ICI. Recopier une
-- fonction de cent lignes pour y ajouter un `delete` est exactement le geste qui
-- a fait perdre `analytics_saved_view` et `dashboard` entre v79 et v80 : deux
-- fichiers écrits en parallèle, fusionnés sans conflit déclaré, et le second
-- reprend la définition d'avant le premier. On insère donc la ligne manquante
-- dans la définition COURANTE, quelle qu'elle soit, et on échoue bruyamment si
-- le point d'insertion n'est pas trouvé exactement une fois.
set local lock_timeout = '5s';

-- ── 1. Le journal des reprises ──────────────────────────────────────────────
create table if not exists backfill_run (
  id                 uuid        primary key default gen_random_uuid(),
  kind               text        not null,
  app_id             text        not null,
  -- `from`/`to` sont des mots réservés : les colonnes sont nommées ainsi
  -- quand même (la spec les nomme), et toujours citées.
  "from"             timestamptz not null,
  "to"               timestamptz not null,
  source_cutoffs_json jsonb      not null default '{}'::jsonb,
  plan_sha           text        not null,
  code_sha           text        not null,
  state              text        not null default 'planned',
  checkpoint_json    jsonb       not null default '{}'::jsonb,
  scanned            bigint      not null default 0,
  written            bigint      not null default 0,
  skipped            bigint      not null default 0,
  failed             bigint      not null default 0,
  started_at         timestamptz,
  updated_at         timestamptz not null default now(),
  ended_at           timestamptz,
  error_code         text
);

alter table backfill_run
  drop constraint if exists backfill_run_v83,
  add constraint backfill_run_v83 check (
    kind in ('event-index', 'rollups', 'dimensions', 'error-groups')
    and state in ('planned', 'running', 'paused', 'completed', 'failed')
    and "from" < "to"
    and char_length(app_id) between 1 and 120
    -- sha256 hexadécimal des deux côtés : un plan ou un code qu'on ne sait pas
    -- nommer exactement ne peut pas autoriser une reprise.
    and plan_sha ~ '^[0-9a-f]{64}$'
    and code_sha ~ '^[0-9a-f]{64}$'
    and scanned >= 0 and written >= 0 and skipped >= 0 and failed >= 0
    -- `error_code` est un CODE, jamais un message : une erreur PostgreSQL peut
    -- citer une valeur de ligne, donc une donnée de personne.
    and (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,59}$')
  );

comment on table backfill_run is
  'Journal technique des reprises d''historique (P8.2) : périmètre, bornes hautes de source, '
  'empreintes de plan et de code, curseur et compteurs. AUCUN extrait de télémétrie n''y entre — '
  'ni message, ni stack, ni identifiant de personne, ni route.';
comment on column backfill_run.source_cutoffs_json is
  'Borne haute par table source ET par ordre de clé, relevée au plan. Un identifiant de séquence '
  'n''est PAS un ordre de commit : ces bornes ferment la fenêtre historique, et le scan de '
  'réconciliation final rattrape ce qui a été validé après leur relevé.';
comment on column backfill_run.checkpoint_json is
  'Curseur de reprise, écrit dans LA MÊME transaction que les lignes du lot. Ne porte que des clés '
  'd''ordre (identifiant, horodatage), jamais le contenu d''une ligne.';
comment on column backfill_run.plan_sha is
  'Empreinte du plan. Une reprise l''exige identique : reprendre sur un autre plan écrirait la '
  'suite d''un travail que personne n''a validé.';
comment on column backfill_run.code_sha is
  'Empreinte des modules de reconstruction et des normalisateurs qu''ils réutilisent. Le code a '
  'changé = la règle de reconstruction a peut-être changé : nouveau dry-run explicite.';
comment on column backfill_run.error_code is
  'Code d''échec borné (identifiant technique en minuscules). Jamais un message PostgreSQL : il '
  'peut citer la valeur d''une ligne.';

-- UNE SEULE EXÉCUTION ACTIVE PAR APP + KIND + PÉRIMÈTRE. Posée en base : deux
-- processus lancés à une seconde d'intervalle ne verraient pas une convention
-- de code, et se partageraient la même fenêtre sans le savoir.
create unique index if not exists backfill_run_active_v83
  on backfill_run (app_id, kind, "from", "to")
  where state in ('planned', 'running', 'paused');

comment on index backfill_run_active_v83 is
  'Une seule exécution vivante par (app, kind, fenêtre). Les exécutions terminées ou en échec '
  'restent en historique et n''empêchent pas une reprise ultérieure du même périmètre.';

-- UN SEUL TRAVAILLEUR PAR APPLICATION (spec §3). Deux reprises qui tournent en
-- même temps sur la même application se disputent son verrou d'ingestion (P8.1)
-- et font attendre le trafic réel deux fois plus longtemps, pour un débit qui ne
-- monte pas — la sérialisation est par application, mesurée en v81.
create unique index if not exists backfill_run_un_travailleur_v83
  on backfill_run (app_id) where state = 'running';

comment on index backfill_run_un_travailleur_v83 is
  'Un seul travailleur par application. Une exécution en pause ne bloque pas : seule celle qui '
  'tourne compte.';

-- Listing par application, du plus récent au plus ancien (écran d'exploitation
-- et sous-commande `status`).
create index if not exists idx_backfill_run_app_v83
  on backfill_run (app_id, updated_at desc);

-- ── 2. Portée tenant ────────────────────────────────────────────────────────
-- Motif des tables créées après v47 : portée explicite, jamais `using (true)`.
-- Les policies permissives se combinent en OU — une seule ouverte annulerait le
-- filtrage des autres sans que rien ne le dise.
alter table backfill_run enable row level security;
drop policy if exists tenant_scope on backfill_run;
create policy tenant_scope on backfill_run
  for select to console_ro using (app_id = any (current_app_ids()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on backfill_run from console_ro;
    grant select on backfill_run to console_ro;
  end if;
  -- `anon` et `authenticated` sont des rôles hérités de l'ère Supabase : une
  -- opération d'exploitation ne leur est jamais accessible.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on backfill_run from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on backfill_run from authenticated;
  end if;
end $$;

-- ── 3. `erase_app_data` atteint la nouvelle table ───────────────────────────
--
-- Insertion dans la définition COURANTE, pas recopie. Le point d'ancrage est le
-- `return result;` final de la fonction ; s'il n'apparaît pas exactement une
-- fois, le fichier échoue — mieux vaut un déploiement arrêté qu'une table
-- oubliée par un effacement client.
do $$
declare
  src   text;
  ancre constant text := E'\n  return result;\n';
  ajout constant text :=
    E'\n  -- v83 (P8.2) : journal des reprises d''historique, app-scopé.\n'
    '  delete from backfill_run where app_id = p_app_id;'
    ' get diagnostics n = row_count; result := result || jsonb_build_object(''backfill_run'', n);\n'
    '  return result;\n';
begin
  -- Le type d'argument, pas son NOM : `pg_get_function_identity_arguments`
  -- rend « p_app_id text » et non « text ».
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'erase_app_data'
     and p.pronargs = 1 and p.proargtypes[0] = 'text'::regtype;
  if src is null then
    raise exception 'v83: erase_app_data(text) introuvable — appliquer v81 d''abord';
  end if;
  -- Déjà posée : rejouer le fichier ne doit pas doubler l'instruction.
  if position('from backfill_run ' in src) > 0 then
    return;
  end if;
  if (length(src) - length(replace(src, ancre, ''))) / length(ancre) <> 1 then
    raise exception 'v83: point d''insertion ambigu dans erase_app_data (% occurrences)',
      (length(src) - length(replace(src, ancre, ''))) / length(ancre);
  end if;
  execute 'create or replace function erase_app_data(p_app_id text) returns jsonb language plpgsql as '
       || quote_literal(replace(src, ancre, ajout));
end $$;

comment on function erase_app_data(text) is
  'Efface toutes les données d''une application et SUSPEND son ingestion dans le registre, sous le '
  'même verrou. Conserve privacy_erasure_barrier et privacy_erasure_request. Depuis v83, vide '
  'aussi backfill_run. La reprise de l''ingestion est une opération explicite.';
