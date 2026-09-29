-- migration-v97 — Base propre (29/09/2026) : onze tables mortes, un index en
-- double, la rétention de `uptime_result`, la RLS de `platform_flag`.
--
-- Rejouable, PostgreSQL 15 à 17. v96 (adresses IP du journal d'audit) est le
-- fichier précédent. Décisions du propriétaire du produit du 29/09/2026, prises
-- sur un relevé de la production en lecture seule.
--
--   1. `erase_app_data` cesse de citer les tables supprimées (§ 1) ;
--   2. suppression des tables du SVI (v51), du solde OpenRouter (v24) et des
--      tickets (v73, v84), toutes VIDES en production le 29/09, avec leur
--      fonction d'écriture `upsert_svi_call` (§ 2) ;
--   3. `purge_rum_app` purge `uptime_result` à la rétention de l'application
--      (§ 3) ;
--   4. RLS sur `platform_flag`, seule table `public` qui n'en avait pas, avec
--      une policy de LECTURE pour chaque rôle qui la lit (§ 4) ;
--   5. suppression de l'index `rum_span_trace_idx`, doublon de
--      `rum_span_trace_ts_idx` (§ 5).
--
-- CE QUI RESTE, À DESSEIN. `rum_metric.call_id` (la greffe du SVI sur le socle,
-- v51) et `error_issue_activity.ticket_id` (le lien d'une activité `link` vers
-- son ticket, v73) sont des COLONNES de tables vivantes : les retirer n'était pas
-- demandé, et l'ancien code les nomme encore pendant la fenêtre de déploiement.
-- Seule la clé étrangère de `ticket_id` part, puisque sa cible disparaît ; aucune
-- activité `link` n'existait en production le 29/09.
--
-- FENÊTRE DE DÉPLOIEMENT. Le scheduler applique ce fichier à son pré-déploiement ;
-- la console (Vercel) et les autres services peuvent tourner quelques minutes sur
-- l'ancien code. Ce qui lisait ou écrivait les tables supprimées échoue alors en
-- `42P01` : écrans SVI et tickets de la console, écriture d'un appel SVI par
-- l'ingestion (aucun émetteur en production), passe du dispatcher de tickets
-- (aucune intégration configurée). Rien d'autre : la purge, l'effacement d'app,
-- les relais et la lecture des drapeaux gardent leur comportement.
--
-- VERROUS. Toutes les tables supprimées sont vides ; `error_issue_activity` perd
-- une contrainte (ACCESS EXCLUSIVE bref). L'index de `rum_span` part EN DERNIER :
-- DROP INDEX prend un ACCESS EXCLUSIVE sur la table la plus écrite, tenu jusqu'au
-- commit — le plus tard possible, le moins longtemps possible. `lock_timeout` est
-- celui du migrateur (3 s) : s'il expire, le fichier entier est annulé et rejoué.

-- ── 1. `erase_app_data` ne cite plus les tables supprimées ──────────────────
--
-- LA DÉFINITION N'EST PAS RECOPIÉE (même geste que v84) : on RETIRE les lignes
-- des tables supprimées de la définition COURANTE, quelle qu'elle soit, puis on
-- échoue bruyamment s'il en reste une trace. Recopier cent lignes pour en ôter
-- sept, c'est la panne de v80 (deux tables perdues sans bruit).
--
-- Une fonction PL/pgSQL ne résout ses tables qu'à l'exécution : sans ce retrait,
-- le premier effacement d'app après la migration échouerait sur `svi_call`.
do $$
declare
  src   text;
  avant text;
  -- Les deux blocs de commentaire qui présentaient ces lignes : retirés avec elles.
  bloc_svi constant text :=
    E'  -- SVI (v51) : télémétrie d''appels, app-scopée, écrite par le même writeRows.\n'
    '  -- Elle manquait aussi — effacer un client lui laissait ses appels. Enfants\n'
    '  -- avant parent : les FK pointent toutes vers svi_call.\n';
  bloc_tickets constant text :=
    E'  -- v84 (P8.6) : connecteurs de tickets, app-scopés. La file de sortie et le\n'
    '  -- journal des livraisons entrantes partent en cascade avec l''intégration.\n';
  mortes constant text :=
    'svi_call_link|svi_quality_sample|svi_queue_sample|svi_leg|svi_step|svi_call|'
    'ticket_integration|ticket_outbox|ticket_webhook_event|error_issue_ticket|openrouter_balance';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'erase_app_data'
     and p.pronargs = 1 and p.proargtypes[0] = 'text'::regtype;
  if src is null then
    raise exception 'v97: erase_app_data(text) introuvable — appliquer v81 d''abord';
  end if;
  avant := src;
  src := replace(src, bloc_svi, '');
  src := replace(src, bloc_tickets, '');
  src := regexp_replace(src, E'\\n  delete from (' || mortes || E') [^\\n]*', '', 'g');
  -- Plus aucune instruction ne doit viser une table supprimée ; un commentaire
  -- peut encore la nommer, une requête non.
  if src ~ ('(from|into|update|join)\s+(' || mortes || ')\M') then
    raise exception 'v97: erase_app_data cite encore une table supprimée — retrait à faire à la main';
  end if;
  -- Rejeu : la définition est déjà propre, rien à réécrire.
  if src = avant then
    return;
  end if;
  execute 'create or replace function erase_app_data(p_app_id text) returns jsonb language plpgsql as '
       || quote_literal(src);
end $$;

comment on function erase_app_data(text) is
  'Efface toutes les données d''une application et SUSPEND son ingestion dans le registre, sous le '
  'même verrou. Conserve privacy_erasure_barrier et privacy_erasure_request. Depuis v83, vide aussi '
  'backfill_run. Depuis v97, ne cite plus le SVI ni les tickets (tables supprimées). La reprise de '
  'l''ingestion est une opération explicite.';

-- ── 2. Les tables supprimées ────────────────────────────────────────────────
--
-- SANS `cascade`, et c'est voulu : les dépendances connues (clé étrangère
-- entrante, fonction d'écriture) sont retirées nommément ci-dessous ; les
-- policies, les droits et les séquences propres partent avec leur table. Une
-- dépendance INCONNUE (une vue créée à la main, par exemple) fait échouer le
-- fichier au lieu d'être emportée sans bruit.
alter table if exists error_issue_activity drop constraint if exists error_issue_activity_ticket_v73;

comment on column error_issue_activity.ticket_id is
  'Ticket d''une activité `link` (v73). Sans cible depuis v97 : la table error_issue_ticket est supprimée, '
  'et aucune activité `link` n''existait en production.';

-- SVI (v51) : l'écriture d'un appel passait par cette fonction à droits de
-- propriétaire (retirée à PUBLIC par v89).
drop function if exists upsert_svi_call(jsonb);

-- Enfants et parents dans la même instruction : l'ordre des clés étrangères
-- internes à chaque groupe ne compte pas.
drop table if exists ticket_webhook_event, ticket_outbox, error_issue_ticket, ticket_integration;
drop table if exists svi_call_link, svi_quality_sample, svi_queue_sample, svi_leg, svi_step, svi_call;
-- Déprécié depuis v43 ; `pending/migration-v44-drop-deprecated-ai.sql` le
-- supprimait aussi (`if exists` : sans effet s'il est un jour activé).
drop table if exists openrouter_balance;

-- ── 3. `uptime_result` suit la rétention de son application ─────────────────
--
-- Aucune purge ne touchait l'historique des sondes : la production gardait des
-- résultats depuis le 20/07. Un résultat appartient à un check, et un check à UNE
-- application (`uptime_check.app_id`, non nul) : il suit donc la rétention de
-- cette application, que `purge_rum_tenants` passe à `purge_rum_app` (registre,
-- sinon 30 jours). L'index `idx_uptime_result_check_ts (check_id, ts desc)` sert
-- la suppression.
--
-- Même geste qu'au § 1 : une ligne INSÉRÉE dans la définition courante, devant
-- son unique `return result;`, rien d'autre de changé.
do $$
declare
  src   text;
  ancre constant text := E'\n  return result;\n';
  ajout constant text :=
    E'\n  -- v97 : l''historique des sondes de disponibilité, à la rétention de l''app de son check.\n'
    '  delete from uptime_result r using uptime_check c\n'
    '   where c.id = r.check_id and c.app_id = p_app_id and r.ts < p_cutoff;\n'
    '  get diagnostics n = row_count; result := result || jsonb_build_object(''uptime_result'', n);\n'
    '  return result;\n';
begin
  select p.prosrc into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'purge_rum_app'
     and p.pronargs = 2 and p.proargtypes[0] = 'text'::regtype and p.proargtypes[1] = 'timestamptz'::regtype;
  if src is null then
    raise exception 'v97: purge_rum_app(text, timestamptz) introuvable — appliquer v82 d''abord';
  end if;
  -- Déjà posée : rejouer le fichier ne double pas l'instruction.
  if position('from uptime_result ' in src) > 0 then
    return;
  end if;
  if (length(src) - length(replace(src, ancre, ''))) / length(ancre) <> 1 then
    raise exception 'v97: point d''insertion ambigu dans purge_rum_app (% occurrences)',
      (length(src) - length(replace(src, ancre, ''))) / length(ancre);
  end if;
  execute 'create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz) returns jsonb language plpgsql as '
       || quote_literal(replace(src, ancre, ajout));
end $$;

-- Le commentaire de v81, plus une phrase.
comment on function purge_rum_app(text, timestamptz) is
  'Rétention par application. Ne touche NI privacy_erasure_barrier NI privacy_erasure_request : '
  'une barrière n''est pas une observation datée. Ne prend pas le verrou d''ingestion : elle ne '
  'supprime que des lignes antérieures à sa coupure. Depuis v97, purge aussi uptime_result '
  '(historique des sondes des checks de l''application).';

-- ── 4. RLS sur `platform_flag` ──────────────────────────────────────────────
--
-- Table GLOBALE (sans `app_id`) et sans secret : la policy n'a rien à filtrer,
-- elle ouvre la lecture à qui en a le DROIT. Sans elle, un rôle soumis à la RLS
-- lirait ZÉRO ligne, sans erreur — et un relais qui ne lit plus son drapeau
-- retombe sur son défaut d'environnement.
--
-- QUI LIT, relevé le 29/09 (`has_table_privilege`) :
--   · le propriétaire (console, collector, scheduler, api-relay de la console) :
--     propriétaire de la table, il n'est pas soumis à la RLS (pas de FORCE) ;
--   · `mip_console` (v93, console-api : `scheduler_tick_min`) : SELECT ;
--   · `console_ro` (v87) : SELECT, rôle cible historique de la console ;
--   · `mip_api` : AUCUN droit, et c'est voulu — le service `api` est la cible du
--     relais, il ne le lit pas (`services/api/shims/`). Pas de policy pour lui.
-- Les écritures restent au propriétaire : aucune policy d'écriture.
alter table platform_flag enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mip_console')
     and not exists (select 1 from pg_policy where polrelid = 'public.platform_flag'::regclass
                                                and polname = 'mip_console_acces') then
    create policy mip_console_acces on platform_flag as permissive for select to mip_console using (true);
  end if;
  if exists (select 1 from pg_roles where rolname = 'console_ro')
     and not exists (select 1 from pg_policy where polrelid = 'public.platform_flag'::regclass
                                                and polname = 'console_ro_lecture') then
    create policy console_ro_lecture on platform_flag as permissive for select to console_ro using (true);
  end if;
end $$;

-- ── 5. L'index en double de `rum_span` ──────────────────────────────────────
--
-- `rum_span_trace_idx (trace_id)` (v04) est un préfixe strict de
-- `rum_span_trace_ts_idx (trace_id, ts)` (v31) : toute recherche par `trace_id`
-- — y compris l'existence d'une trace, que v69 disait vérifiée « par
-- rum_span_trace_idx » — est servie par le second. Relevé le 29/09 : 26 Mo,
-- aucun parcours depuis la remise à zéro des statistiques. Aucune requête ni
-- aucun test ne le nomme.
--
-- Pas CONCURRENTLY : impossible dans la transaction du migrateur. Le verrou est
-- pris ici, en fin de fichier, et relâché au commit qui suit.
drop index if exists rum_span_trace_idx;
