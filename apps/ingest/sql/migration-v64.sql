-- migration-v64 — l'historique synthétique cesse d'être détruit, et son silence
-- devient visible.
--
-- ═══════════════ CE QUI SE PASSAIT, VÉRIFIÉ DANS LE CODE ══════════════════════
--
-- `apps/sync-synthetic/src/sync.mjs` faisait, à chaque exécution :
--
--     delete from syn_snapshot where measure_id = any($1)
--
-- sans AUCUNE borne de temps. Sur la source `seed`, où `measure_id` vaut
-- 'seed-1', c'est tout l'historique de la mesure qui partait à chaque passage —
-- puis 24 h étaient réinsérées. Le miroir synthétique ne portait donc jamais plus
-- d'une journée, et un mois de corrélation était impossible par construction.
--
-- Sur la source `mippoc-json`, le même code écrivait `measure_id: String(e.id)`,
-- c'est-à-dire l'identifiant de l'EXÉCUTION dans la colonne qui désigne la
-- MESURE. Les deux identités étaient confondues : on ne pouvait ni regrouper les
-- exécutions d'une mesure, ni détecter un doublon d'import.
--
-- ═══════════════ POURQUOI CELA BLOQUE TOUT LE RESTE ══════════════════════════
--
-- Le noyau statistique du dépôt (apps/console/lib/correlation-stats.ts) refuse de
-- rendre un coefficient en dessous de huit seaux appariés — à n = 8 il faut déjà
-- |r| ≥ 0,707 pour atteindre le seuil de 5 %. Un miroir qui ne retient qu'une
-- journée ne peut pas fournir ces huit points sur une fenêtre de sept jours dès
-- que le trafic réel est intermittent. Aucune matrice de corrélation honnête
-- n'est possible tant que cette ligne existe.
--
-- ═══════════════ CE QU'ON GARDE, ET POURQUOI ═════════════════════════════════
--
-- Les exécutions réelles sondées (apps/sync-synthetic/data/mippoc-sample.json)
-- portent six métriques : completion_time, first_load_time, dns_time,
-- nb_requests, nb_requests_ko, http_status. L'adaptateur n'en projetait QU'UNE
-- (`first_load_time` → latency_ms) et jetait les cinq autres. On ne peut pas
-- corréler ce qu'on n'a pas conservé, et on ne sait pas aujourd'hui laquelle
-- servira demain : on conserve donc le bloc entier en jsonb, SANS l'interpréter.
-- `latency_ms` reste la projection explicite de `first_load_time`, et reste la
-- seule grandeur déclarée comparable au LCP.
alter table syn_snapshot add column if not exists ingested_at  timestamptz not null default now();
alter table syn_snapshot add column if not exists execution_id text;
alter table syn_snapshot add column if not exists measure_type text;
alter table syn_snapshot add column if not exists metrics      jsonb;
alter table syn_snapshot add column if not exists state_source text;

comment on column syn_snapshot.ingested_at is
  'Heure d''ARRIVÉE de la ligne, distincte de captured_at qui est l''heure du passage du robot. '
  '« Le robot n''a pas tourné » et « l''import n''a pas tourné » sont deux pannes différentes, chez '
  'deux équipes différentes. Les confondre fait chercher au mauvais endroit.';
comment on column syn_snapshot.execution_id is
  'Identifiant du PASSAGE chez la source, quand elle en fournit un. L''export mippoc réel n''en '
  'fournit PAS : son champ `id` vaut 483 sur les neuf exécutions du fichier d''exemple, c''est '
  'donc l''identifiant de la MESURE. La colonne reste, pour une source qui en donnerait un ; elle '
  'n''est pas la clé de déduplication.';
comment on column syn_snapshot.metrics is
  'Le bloc de métriques de la source, conservé TEL QUEL et non interprété. L''adaptateur n''en '
  'projetait qu''une sur six ; on ne corrèle pas ce qu''on n''a pas gardé, et on ne sait pas '
  'aujourd''hui laquelle servira demain.';
comment on column syn_snapshot.state_source is
  'L''état BRUT tel que la source l''écrit (OK, WARNING, …). `state` en est la normalisation. '
  'Sans le brut, une valeur inconnue de la source serait écrasée sur un état choisi par nous, et '
  'plus rien ne permettrait de s''en apercevoir.';

-- L'IDENTITÉ D'UN PASSAGE, ET DONC L'IDEMPOTENCE DE L'IMPORT.
--
-- (app_id, measure_id, captured_at) — et non un identifiant d'exécution, PARCE
-- QUE LA SOURCE N'EN DONNE PAS. Vérifié sur le fichier d'exécutions réelles :
-- le champ `id` vaut 483 sur les neuf entrées, c'est l'identifiant de la mesure.
-- Ce qui distingue deux passages est leur horodatage, et rien d'autre.
--
-- La première version de cette migration prenait `execution_id` pour clé ; elle
-- écrivait neuf lignes qui s'écrasaient l'une l'autre et n'en laissait qu'une.
-- C'est l'import réel qui l'a montré, pas la relecture.
create unique index if not exists uq_syn_passage
  on syn_snapshot (app_id, measure_id, captured_at);

create index if not exists idx_syn_app_capture on syn_snapshot (app_id, captured_at desc);

-- ─────────────── LE TÉMOIN : une trace à CHAQUE passage, échec compris ───────
--
-- Sans lui, un import qui cesse de tourner est indiscernable d'un robot qui ne
-- trouve rien : dans les deux cas la table ne bouge plus. C'est exactement le
-- genre de silence que ce dépôt refuse ailleurs — la ligne est donc écrite AVANT
-- le travail et complétée après, pour qu'un import qui meurt en cours laisse
-- quand même sa trace.
create table if not exists syn_import (
  id             bigserial primary key,
  source         text not null,
  demarre_le     timestamptz not null default now(),
  termine_le     timestamptz,
  ok             boolean,
  lignes_vues    int not null default 0,
  lignes_ecrites int not null default 0,
  non_rattachees int not null default 0,
  erreur         text
);

comment on table syn_import is
  'Journal des imports synthétiques. Une ligne par passage, écrite AVANT le travail et complétée '
  'après : un import qui meurt en cours laisse sa trace, avec ok = null, ce qui se lit « parti et '
  'jamais revenu » — un état distinct de l''échec propre. Pas de app_id : un import peut couvrir '
  'plusieurs applications, et cette table est opérationnelle, pas applicative.';

create index if not exists idx_syn_import_recent on syn_import (demarre_le desc);

-- Ouvre un passage. Rendre l'identifiant permet de le clore même après un échec.
create or replace function syn_import_ouvrir(p_source text) returns bigint
language sql as $$
  insert into syn_import (source) values (p_source) returning id;
$$;

create or replace function syn_import_clore(
  p_id bigint, p_ok boolean, p_vues int, p_ecrites int, p_non_rattachees int, p_erreur text
) returns void language sql as $$
  update syn_import
     set termine_le = now(), ok = p_ok, lignes_vues = p_vues, lignes_ecrites = p_ecrites,
         non_rattachees = p_non_rattachees, erreur = left(p_erreur, 1000)
   where id = p_id;
$$;

-- ─────────────────── LA SONDE : deux âges, pas un ────────────────────────────
--
-- `capture` répond « le robot tourne-t-il ? », `import` répond « le miroir
-- suit-il ? ». Un seul chiffre confondrait les deux pannes.
create or replace function syn_fraicheur()
returns table (
  derniere_capture   timestamptz,
  age_capture_s      double precision,
  dernier_import     timestamptz,
  age_import_s       double precision,
  dernier_import_ok  boolean,
  imports_24h        int,
  echecs_24h         int
) language sql stable as $$
  select
    (select max(captured_at) from syn_snapshot),
    extract(epoch from (now() - (select max(captured_at) from syn_snapshot)))::double precision,
    (select max(termine_le) from syn_import),
    extract(epoch from (now() - (select max(termine_le) from syn_import)))::double precision,
    -- `ok` du dernier passage TERMINÉ. Un passage encore ouvert (ok null) ne doit
    -- pas se lire comme un échec, ni masquer le dernier verdict connu.
    (select ok from syn_import where termine_le is not null order by termine_le desc limit 1),
    (select count(*)::int from syn_import where demarre_le > now() - interval '24 hours'),
    (select count(*)::int from syn_import
      where demarre_le > now() - interval '24 hours' and ok is distinct from true);
$$;

comment on function syn_fraicheur() is
  'Deux âges et non un : celui de la dernière CAPTURE du robot, et celui du dernier IMPORT. '
  'Confondre les deux fait chercher la panne chez la mauvaise équipe. `echecs_24h` compte aussi '
  'les passages jamais terminés (ok null) : partir sans revenir est un échec.';

-- Rétention du journal : 90 jours. Une table d'exploitation qui ne purge jamais
-- finit par coûter plus que ce qu'elle documente.
create or replace function syn_import_purger(p_jours int default 90) returns bigint
language plpgsql as $$
declare n bigint;
begin
  delete from syn_import where demarre_le < now() - make_interval(days => greatest(p_jours, 1));
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    -- Pas de RLS sur syn_import : la table ne porte AUCUN app_id, seulement des
    -- dates et des comptes. La lire ne révèle rien d'un autre locataire.
    grant select on syn_import to console_ro;
    grant execute on function syn_fraicheur() to console_ro;
  end if;
end $$;
