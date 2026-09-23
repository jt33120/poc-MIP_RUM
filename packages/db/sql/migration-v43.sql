-- migration-v43 — DÉPRÉCIATION de la supervision IA locale (sortie vers xSOM AI
-- Guard, source de vérité unique — ADR-0001). RÉVERSIBLE : aucun DROP, aucune
-- perte de données. On (1) arrête le cron d'anomalie de coût IA (plus alimenté
-- depuis le retrait de l'ingestion gen_ai) et (2) marque les objets IA comme
-- dépréciés (COMMENT). Les tables restent LISIBLES pour audit / rollback.
--
-- Le DROP dur (rum_ai, openrouter_balance, v_ai_op_anomaly, check_ai_op_anomalies,
-- branches ai_cost de check_alerts/metric_baseline) est une migration ULTÉRIEURE,
-- DIFFÉRÉE après une période de bake xSOM en prod — volontairement hors de ce lot.
--
-- Rollback (down) :
--   do $$ begin if exists (select 1 from pg_extension where extname='pg_cron')
--     then perform cron.schedule('mip-ai-op-anomaly','*/30 * * * *','select check_ai_op_anomalies()'); end if; end $$;
--   comment on table rum_ai is 'Appels LLM (usage & performance IA), conventions OTel GenAI. v20.';
--   comment on table openrouter_balance is null;
--   comment on view v_ai_op_anomaly is null;
--
-- Extension cloud pg_cron gardée par if exists (pg_extension) — absente en CI/local.

-- 1) Stopper l'alerte d'anomalie de coût IA (cron mip-ai-op-anomaly, v39).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mip-ai-op-anomaly');
  end if;
exception
  when others then
    -- job déjà absent (jamais programmé en CI/local) : non bloquant.
    null;
end $$;

-- 2) Marquer les objets IA comme dépréciés (traçabilité ; aucune donnée touchée).
comment on table rum_ai is 'DÉPRÉCIÉ (v43) — supervision IA migrée vers xSOM AI Guard (source de vérité). Conservé en lecture pour audit/rollback ; plus alimenté (ingestion gen_ai retirée en v0.9). DROP dur différé après bake xSOM. Voir ADR-0001.';

comment on table openrouter_balance is 'DÉPRÉCIÉ (v43) — budget/crédits IA suivis par xSOM AI Guard. Conservé pour audit/rollback ; DROP dur différé.';

comment on view v_ai_op_anomaly is 'DÉPRÉCIÉ (v43) — anomalie de coût IA calculée par xSOM AI Guard. Vue conservée (lecture) jusqu''au DROP différé.';
