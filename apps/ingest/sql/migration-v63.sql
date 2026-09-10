-- migration-v63 — la table de débarquement de l'ingestion.
--
-- Finding 2.9 de docs/AUDIT_RUM_EXTERNE.md. Le receveur écrit le lot ICI, en une
-- insertion, et rend la main ; un travailleur fait le reste. Le chantier avait
-- été différé faute de banc de charge : ajouter une file, un travailleur et une
-- perte de durabilité sur une intuition aurait été exactement le genre de
-- décision que ce dépôt refuse ailleurs. Le banc existe désormais
-- (scripts/bench-ingest.mjs) et ses chiffres sont dans docs/BUILD_LOG.md.
--
-- ═══════════ UNLOGGED : CE QUE ÇA DONNE, ET CE QUE ÇA COÛTE ══════════════════
--
-- Une table UNLOGGED n'écrit pas de WAL : c'est là qu'est le gain. Le prix est
-- qu'elle est VIDÉE au redémarrage de PostgreSQL après un arrêt brutal. Un lot
-- acquitté 200 mais pas encore drainé serait alors perdu — définitivement, sans
-- trace.
--
-- Ce prix est acceptable pour de la télémétrie RUM et il ne l'est PAS pour tout :
-- on perd quelques secondes de mesures d'audience, jamais une facture. Il est
-- écrit ici et dans docs/INTEGRATION.md plutôt que laissé à découvrir, et le
-- mode reste OPTIONNEL (INGEST_DEFERRED) : par défaut, le receveur écrit
-- toujours en synchrone dans les tables finales.
create unlogged table if not exists ingest_raw (
  id          bigserial primary key,
  app_id      text not null,
  recu_at     timestamptz not null default now(),
  lot         jsonb not null,
  tentatives  int not null default 0,
  -- Quand ce lot redevient éligible. Un échec ne se retente pas immédiatement :
  -- sans ce recul, une coupure de base d'une seconde ferait brûler les cinq
  -- tentatives d'un lot en quelques millisecondes, et un incident transitoire
  -- deviendrait une perte définitive.
  reprendre_a timestamptz not null default now(),
  erreur      text
);

comment on table ingest_raw is
  'Table de DÉBARQUEMENT de l''ingestion différée (INGEST_DEFERRED). UNLOGGED : vidée par '
  'PostgreSQL après un arrêt brutal, donc un lot acquitté mais non drainé est perdu. Compromis '
  'assumé pour de la télémétrie, inacceptable pour de la donnée transactionnelle. Le lot y est '
  'stocké DÉJÀ APLATI (sortie de flattenOtlp) : le travailleur n''a plus qu''à écrire, et le '
  'contrôle de clé d''API reste dans le chemin de la requête, où il doit être.';

comment on column ingest_raw.tentatives is
  'Nombre d''échecs d''écriture. Au-delà de 5, le lot cesse d''être repris et garde son erreur : '
  'une file qui rejoue indéfiniment un lot empoisonné n''avance plus, et le silence ressemble à '
  'du travail.';
comment on column ingest_raw.reprendre_a is
  'Recul exponentiel après échec (1, 2, 4, 8, 16 s). Retenter tout de suite ferait brûler les cinq '
  'tentatives en quelques millisecondes sur une coupure d''une seconde — un incident transitoire '
  'deviendrait une perte définitive.';

-- Le drain lit ce qui est ÉLIGIBLE (`reprendre_a <= now()`), le plus vieux
-- d'abord, et saute ce qu'un autre travailleur tient déjà (`for update skip
-- locked`) : deux instances peuvent drainer en parallèle sans se marcher dessus
-- ni traiter deux fois le même lot, et un lot en échec sort de la file le temps
-- de son recul au lieu de la retenir.
--
-- `skip locked` est là pour le DÉBIT, pas pour l'exactitude : `for update` seul
-- ne dupliquerait rien non plus, il ferait attendre le second travailleur au
-- lieu de lui faire prendre le lot suivant. Le test d'intégration ne distingue
-- pas les deux, et il le dit.
create index if not exists idx_ingest_raw_a_faire
  on ingest_raw (reprendre_a, id) where tentatives < 5;

-- L'effacement d'un client emporte aussi ce qui n'est pas encore drainé.
--
-- Redéfinie ici plutôt qu'ajoutée à côté : une seconde fonction à appeler est
-- une fonction qu'on oublie d'appeler, et l'oubli produit des données qui
-- survivent à un effacement RGPD.
create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  -- EN PREMIER : un lot encore en attente de drain réintroduirait, quelques
  -- secondes plus tard, des données qu'on vient d'effacer. L'ordre compte.
  delete from ingest_raw     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_metric     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from route_pattern     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    alter table ingest_raw enable row level security;
    drop policy if exists tenant_scope on ingest_raw;
    create policy tenant_scope on ingest_raw
      for select to console_ro using (app_id = any (current_app_ids()));
    grant select on ingest_raw to console_ro;
  end if;
end $$;
