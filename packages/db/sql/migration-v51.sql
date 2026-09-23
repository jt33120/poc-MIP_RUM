-- migration-v51 — Supervision SVI, incrément I0 : le modèle d'appel.
--
-- (Le plan d'implémentation numérote cette migration v48 ; les numéros 48 à 50
-- ont été pris entre-temps par le durcissement RLS et la boucle d'alerte. Seul
-- le numéro change.)
--
-- POURQUOI DES TABLES DÉDIÉES ET NON UNE EXTENSION DU MODÈLE RUM
-- `rum_session` modélise une VISITE (user_agent, device_type, is_bot, page_count
-- incrémental, fusion de vues successives) ; un appel est atomique et borné.
-- `rum_pageview` est structuré par route/referrer/nav_type ; un nœud de SVI est un
-- chemin d'arbre. `rum_span.duration_ms` est NOT NULL et le writer d'ingestion fait
-- `upsert(..., ignoreDuplicates: true)` : aucun span ne peut être ouvert puis
-- fermé, alors qu'un appel arrive au fil de l'eau et parfois en DÉSORDRE. Enfin
-- aucune table du schéma ne porte de champ d'ISSUE, qui est le pivot du domaine.
-- Réutiliser les tables RUM produirait un abus de nommage permanent pour un gain nul.
--
-- UNE SEULE GREFFE SUR LE SOCLE PARTAGÉ : `rum_metric.call_id`. Elle suffit à
-- rendre `slo_status()` et `check_alerts()` utilisables sur des appels sans
-- réécrire une ligne de PL/pgSQL — la branche générique de slo_status() calcule
-- déjà « part de rating='good' » sur n'importe quel `name` de métrique.
--
-- ⚠ LES POLICIES DE v47 NE COUVRENT PAS CES TABLES. La boucle qui pose
-- `tenant_scope` est un `do $$ … loop` exécuté UNE FOIS, au moment de v47 : ce
-- n'est pas un event trigger. Les tables créées ici n'en héritent pas et doivent
-- poser leurs policies elles-mêmes — ce que fait la section 8. C'est exactement
-- le défaut ouvert documenté dans l'en-tête de v47.
--
-- PAS DE MIROIR DANS `rum_span` : écart assumé à la porte E-SVI-1 du cadrage.
-- `duration_ms NOT NULL` + `ignoreDuplicates` rendraient le miroir divergent par
-- construction (figé sur sa première version), et `app/tracing/[traceId]` code en
-- dur des paliers navigateur/serveur/base. `svi_call.trace_id` est conservé pour
-- rendre une projection ultérieure possible sans migration de données.
--
-- Idempotente.

-- ── 1. L'appel : agrégat MUTABLE ─────────────────────────────────────────────
create table if not exists svi_call (
  id              bigint generated always as identity primary key,
  app_id          text not null,
  call_id         text not null,            -- DÉTERMINISTE : sha256(app|plateforme|clé source)
  trace_id        text not null,
  merged_into     text,                     -- fusion leg A/B : on ne supprime JAMAIS un appel
  platform        text not null,
  adapter_version text not null,
  source_schema   text,
  provenance      text[] not null default '{}',   -- 'cdr' | 'journey' | 'voice'
  direction       text not null default 'inbound'
                    check (direction in ('inbound','outbound','internal')),
  entry_point     text,
  flow_id         text,
  flow_version    text,
  caller_hash     text,                     -- HMAC posé DANS L'ADAPTATEUR : la clé ne vient jamais ici
  caller_key_id   text,
  caller_country  text,
  started_at      timestamptz not null,
  answered_at     timestamptz,
  ended_at        timestamptz,
  status          text not null default 'open' check (status in ('open','closed')),
  close_reason    text,
  duration_ms int, ivr_ms int, queue_ms int, talk_ms int, setup_ms int,
  -- CHAMP PIVOT : containment, abandon et transfert s'en déduisent tous les trois.
  outcome         text check (outcome in ('contained','transferred','abandoned','failed')),
  outcome_detail  text,
  hangup_party    text check (hangup_party in ('caller','callee','platform','unknown')),
  sip_final_code  int,
  queue_name text, wait_ms int, transfer_target text, agent_group text,
  menu_path_final text, menu_depth int, exit_node text,
  task_name text, task_success boolean,     -- succès self-service ≠ containment
  ai_agent        boolean not null default false,
  ai_disclosed_at timestamptz,
  ai_disclosure_source text check (ai_disclosure_source in ('flow_event','declared')),
  mos_p05 double precision, mos_avg double precision,
  jitter_p95_ms double precision, loss_max_pct double precision, rtt_avg_ms double precision,
  quality_tags    text[] not null default '{}',
  is_test         boolean not null default false,
  source_ref      jsonb,
  ingested_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Un appel clos porte forcément une issue ; un appel ouvert n'en porte jamais.
  -- Inventer 'failed' à la création empoisonnerait les trois taux dérivés.
  constraint svi_call_outcome_ck check (
    (status = 'open'   and outcome is null) or
    (status = 'closed' and outcome is not null))
);
create unique index if not exists svi_call_key on svi_call (app_id, call_id);
create index if not exists svi_call_app_ts_idx on svi_call (app_id, started_at desc);
create index if not exists svi_call_outcome_idx on svi_call (app_id, outcome, started_at desc);
create index if not exists svi_call_recall_idx on svi_call (app_id, caller_hash, started_at)
  where caller_hash is not null;                    -- containment NET à 7 jours
create index if not exists svi_call_open_idx on svi_call (app_id, started_at)
  where status = 'open';                            -- balayage des appels jamais clos

comment on column svi_call.outcome is
  'Issue de l''appel. NULL tant que status=''open'' : un appel en cours n''a pas '
  'd''issue. Containment, abandon et transfert se déduisent tous les trois de ce champ.';
comment on column svi_call.provenance is
  'Niveaux de données réellement disponibles : cdr (sans travail client), journey '
  '(exige l''instrumentation du flow), voice (exige l''accès au média). Sert à '
  'afficher la couverture plutôt qu''extrapoler un taux calculé sur une fraction.';

-- ── 2. L'étape : niveau « parcours », exige une instrumentation côté client ──
create table if not exists svi_step (
  id             bigint generated always as identity primary key,
  step_id        text not null unique,      -- DÉTERMINISTE : sha256(call_id|seq|kind)
  parent_step_id text,
  app_id         text not null,             -- et pas seulement call_id : sinon hors scoping
  call_id        text not null,             -- pas de FK : l'étape peut précéder l'entête
  seq            int not null,
  kind           text not null check (kind in
                   ('disclosure','greeting','prompt','menu','input','lookup',
                    'queue','transfer','agent','bot_turn','disconnect','error')),
  node_id        text,
  node_label text, menu_path text, depth int, branch text,
  -- SAISIE : jamais la valeur. Un nœud sensible n'émet qu'une étape agrégée SANS
  -- longueur — `len=16` puis `len=3` serait un oracle PAN+CVV (PCI DSS 4.0.1).
  input_class    text check (input_class in ('menu_choice','digits','speech','masked')),
  input_len      int check (input_len is null or input_len between 1 and 6),
  input_sensitive boolean not null default false,
  no_match       boolean not null default false,
  no_input       boolean not null default false,
  reprompt_index int not null default 0,
  asr_confidence double precision,
  rejected       boolean,
  milestone text, flow_outcome text,        -- parité Genesys Flow Milestones/Outcomes
  started_at     timestamptz not null,
  duration_ms    int,                       -- NULLABLE, contrairement à rum_span : étape ouverte
  exit_reason    text,
  constraint svi_step_masked_ck check (
    not (input_class = 'masked' and input_len is not null))
);
create index if not exists svi_step_call_idx on svi_step (app_id, call_id, seq);
create index if not exists svi_step_node_idx on svi_step (app_id, node_id, started_at desc);

comment on constraint svi_step_masked_ck on svi_step is
  'Un nœud de saisie sensible n''émet aucune longueur : la contrainte « une seule '
  'touche par ligne » serait du théâtre, string_agg reconstituant un PAN.';

-- ── 3. Le tronçon voix ───────────────────────────────────────────────────────
create table if not exists svi_leg (
  id       bigint generated always as identity primary key,
  app_id   text not null, call_id text not null, leg_ref text not null,
  role     text not null check (role in ('carrier_edge','sbc_edge','ivr_edge','agent_edge')),
  dir      text not null check (dir in ('rx','tx')),  -- la voix se qualifie par SENS
  codec text, ptime_ms int, sample_rate int, carrier text,
  -- Non nullable : aucun MOS ne s'affiche sans sa provenance. G.107 est une
  -- ESTIMATION passive ; P.863/POLQA une mesure perçue, intrusive et sous licence.
  mos_method text not null check (mos_method in ('g107_e_model','g107_1_wb','vendor_reported')),
  mos_avg double precision, mos_min double precision,
  r_factor_avg double precision, r_factor_min double precision,
  jitter_avg_ms double precision, jitter_max_ms double precision,
  loss_avg_pct double precision, loss_max_pct double precision,
  rtt_avg_ms double precision, rtt_max_ms double precision,
  packets_sent bigint, packets_lost bigint,
  e_model_params jsonb,                     -- Ie_eff, Bpl, Ta, R0 : calcul auditable
  started_at timestamptz, ended_at timestamptz
);
create unique index if not exists svi_leg_key on svi_leg (app_id, call_id, leg_ref, dir);

-- ── 4. Séries : qualité voix et état de file ─────────────────────────────────
create table if not exists svi_quality_sample (
  app_id   text not null, call_id text not null, leg_ref text not null,
  dir      text not null check (dir in ('rx','tx')),
  ts       timestamptz not null,
  mos double precision, jitter_ms double precision,
  loss_pct double precision, rtt_ms double precision,
  primary key (app_id, call_id, leg_ref, dir, ts)
);
create index if not exists svi_quality_ts_idx on svi_quality_sample (app_id, ts desc);

create table if not exists svi_queue_sample (
  app_id     text not null, queue_name text not null, ts timestamptz not null,
  waiting    int, longest_wait_ms int, agents_available int, agents_busy int,
  primary key (app_id, queue_name, ts)
);
create index if not exists svi_queue_ts_idx on svi_queue_sample (app_id, ts desc);

-- ── 5. Liaison leg A / leg B ─────────────────────────────────────────────────
-- Un transfert produit deux identifiants. On enregistre le lien plutôt que de
-- fusionner destructivement : la réconciliation est heuristique quand la
-- plateforme ne propage pas d'identifiant de liaison, donc elle doit rester auditable.
create table if not exists svi_call_link (
  app_id     text not null,
  parent_call_id text not null,
  child_call_id  text not null,
  link_kind  text not null check (link_kind in ('transfer','consult','conference','redial')),
  confidence text not null default 'exact' check (confidence in ('exact','heuristic')),
  evidence   jsonb,                         -- ce qui a permis d'apparier : audit
  created_at timestamptz not null default now(),
  primary key (app_id, parent_call_id, child_call_id)
);

-- ── 6. L'unique greffe sur le socle partagé ──────────────────────────────────
alter table rum_metric add column if not exists call_id text;
create index if not exists rum_metric_call_idx on rum_metric (app_id, call_id)
  where call_id is not null;

comment on column rum_metric.call_id is
  'Rattache une métrique à un appel SVI. Unique greffe du SVI sur le socle RUM : '
  'elle rend slo_status() et check_alerts() utilisables sur des appels sans SQL neuf. '
  'Les lecteurs de vitals web DOIVENT filtrer par nom de métrique — cf. WEB_VITAL_NAMES.';

-- ── 7. Écriture de l'appel : idempotente et tolérante au DÉSORDRE ────────────
-- Les événements d'un SVI arrivent au fil de l'eau et pas toujours dans l'ordre :
-- la fin peut précéder l'entête, une étape peut précéder la création de l'appel.
-- Cette fonction ne régresse JAMAIS un champ déjà renseigné vers NULL, et ne
-- rouvre jamais un appel clos.
create or replace function upsert_svi_call(p jsonb) returns text
language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_call_id text;
begin
  v_call_id := p->>'call_id';
  if v_call_id is null or p->>'app_id' is null then
    raise exception 'upsert_svi_call: app_id et call_id sont obligatoires';
  end if;

  insert into svi_call (
    app_id, call_id, trace_id, platform, adapter_version, source_schema, provenance,
    direction, entry_point, flow_id, flow_version, caller_hash, caller_key_id,
    caller_country, started_at, answered_at, ended_at, status, close_reason,
    duration_ms, ivr_ms, queue_ms, talk_ms, setup_ms, outcome, outcome_detail,
    hangup_party, sip_final_code, queue_name, wait_ms, transfer_target, agent_group,
    menu_path_final, menu_depth, exit_node, task_name, task_success, ai_agent,
    ai_disclosed_at, ai_disclosure_source, is_test, source_ref)
  values (
    p->>'app_id', v_call_id, coalesce(p->>'trace_id', v_call_id),
    coalesce(p->>'platform','unknown'), coalesce(p->>'adapter_version','0'),
    p->>'source_schema',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p->'provenance') x), '{}'),
    coalesce(p->>'direction','inbound'), p->>'entry_point', p->>'flow_id', p->>'flow_version',
    p->>'caller_hash', p->>'caller_key_id', p->>'caller_country',
    coalesce((p->>'started_at')::timestamptz, now()),
    (p->>'answered_at')::timestamptz, (p->>'ended_at')::timestamptz,
    coalesce(p->>'status','open'), p->>'close_reason',
    (p->>'duration_ms')::int, (p->>'ivr_ms')::int, (p->>'queue_ms')::int,
    (p->>'talk_ms')::int, (p->>'setup_ms')::int, p->>'outcome', p->>'outcome_detail',
    p->>'hangup_party', (p->>'sip_final_code')::int, p->>'queue_name', (p->>'wait_ms')::int,
    p->>'transfer_target', p->>'agent_group', p->>'menu_path_final', (p->>'menu_depth')::int,
    p->>'exit_node', p->>'task_name', (p->>'task_success')::boolean,
    coalesce((p->>'ai_agent')::boolean, false), (p->>'ai_disclosed_at')::timestamptz,
    p->>'ai_disclosure_source', coalesce((p->>'is_test')::boolean, false), p->'source_ref')
  on conflict (app_id, call_id) do update set
    -- `coalesce(nouveau, ancien)` partout : un lot partiel n'efface rien.
    trace_id        = coalesce(excluded.trace_id, svi_call.trace_id),
    platform        = case when excluded.platform = 'unknown' then svi_call.platform else excluded.platform end,
    adapter_version = case when excluded.adapter_version = '0' then svi_call.adapter_version else excluded.adapter_version end,
    source_schema   = coalesce(excluded.source_schema, svi_call.source_schema),
    provenance      = (select coalesce(array_agg(distinct v), '{}')
                         from unnest(svi_call.provenance || excluded.provenance) v),
    entry_point     = coalesce(excluded.entry_point, svi_call.entry_point),
    flow_id         = coalesce(excluded.flow_id, svi_call.flow_id),
    flow_version    = coalesce(excluded.flow_version, svi_call.flow_version),
    caller_hash     = coalesce(excluded.caller_hash, svi_call.caller_hash),
    caller_key_id   = coalesce(excluded.caller_key_id, svi_call.caller_key_id),
    caller_country  = coalesce(excluded.caller_country, svi_call.caller_country),
    -- Le début le PLUS TÔT et la fin la PLUS TARD gagnent : l'ordre d'arrivée
    -- des lots ne doit pas décider des bornes de l'appel.
    started_at      = least(svi_call.started_at, excluded.started_at),
    answered_at     = coalesce(excluded.answered_at, svi_call.answered_at),
    ended_at        = greatest(coalesce(excluded.ended_at, svi_call.ended_at),
                               coalesce(svi_call.ended_at, excluded.ended_at)),
    -- Un appel clos ne se rouvre pas : 'closed' est un état terminal.
    status          = case when svi_call.status = 'closed' then 'closed' else excluded.status end,
    close_reason    = coalesce(excluded.close_reason, svi_call.close_reason),
    duration_ms     = coalesce(excluded.duration_ms, svi_call.duration_ms),
    ivr_ms          = coalesce(excluded.ivr_ms, svi_call.ivr_ms),
    queue_ms        = coalesce(excluded.queue_ms, svi_call.queue_ms),
    talk_ms         = coalesce(excluded.talk_ms, svi_call.talk_ms),
    setup_ms        = coalesce(excluded.setup_ms, svi_call.setup_ms),
    outcome         = coalesce(excluded.outcome, svi_call.outcome),
    outcome_detail  = coalesce(excluded.outcome_detail, svi_call.outcome_detail),
    hangup_party    = coalesce(excluded.hangup_party, svi_call.hangup_party),
    sip_final_code  = coalesce(excluded.sip_final_code, svi_call.sip_final_code),
    queue_name      = coalesce(excluded.queue_name, svi_call.queue_name),
    wait_ms         = coalesce(excluded.wait_ms, svi_call.wait_ms),
    transfer_target = coalesce(excluded.transfer_target, svi_call.transfer_target),
    agent_group     = coalesce(excluded.agent_group, svi_call.agent_group),
    menu_path_final = coalesce(excluded.menu_path_final, svi_call.menu_path_final),
    menu_depth      = coalesce(excluded.menu_depth, svi_call.menu_depth),
    exit_node       = coalesce(excluded.exit_node, svi_call.exit_node),
    task_name       = coalesce(excluded.task_name, svi_call.task_name),
    task_success    = coalesce(excluded.task_success, svi_call.task_success),
    ai_agent        = svi_call.ai_agent or excluded.ai_agent,
    ai_disclosed_at = coalesce(excluded.ai_disclosed_at, svi_call.ai_disclosed_at),
    ai_disclosure_source = coalesce(excluded.ai_disclosure_source, svi_call.ai_disclosure_source),
    is_test         = svi_call.is_test or excluded.is_test,
    source_ref      = coalesce(svi_call.source_ref, '{}'::jsonb) || coalesce(excluded.source_ref, '{}'::jsonb),
    updated_at      = now();

  return v_call_id;
end $fn$;

comment on function upsert_svi_call(jsonb) is
  'Écrit ou complète un appel. Idempotente et tolérante au désordre : ne régresse '
  'jamais un champ vers NULL, ne rouvre jamais un appel clos, retient le début le '
  'plus tôt et la fin la plus tard.';

-- ── 8. RLS : à poser ICI, v47 ne couvre pas les tables créées après elle ─────
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    create role console_ro nologin;
  end if;

  foreach t in array array['svi_call','svi_step','svi_leg','svi_quality_sample',
                           'svi_queue_sample','svi_call_link']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_scope on public.%I', t);
    execute format(
      'create policy tenant_scope on public.%I for all to console_ro using (app_id = any(current_app_ids()))', t);
    -- La console LIT le SVI ; elle ne l'écrit pas (l'ingestion s'en charge avec
    -- le rôle de service). Cohérent avec migration-v48.
    execute format('grant select on public.%I to console_ro', t);
  end loop;
end $$;
