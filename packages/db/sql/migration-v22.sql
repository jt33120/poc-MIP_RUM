-- v22 : Expérience utilisateur (feedback + score). Le feedback réutilise le canal
-- d'événements custom (rum_event, name='feedback', props={score,comment}) — donc
-- AUCUNE nouvelle table ni changement d'ingestion. On ajoute seulement un index
-- pour que les agrégats « Expérience » (filtrés par app + name + fenêtre) restent
-- rapides quand rum_event grossit. Purement additif & idempotent.

create index if not exists idx_event_app_name_ts on rum_event (app_id, name, ts desc);
