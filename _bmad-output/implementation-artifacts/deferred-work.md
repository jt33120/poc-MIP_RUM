- source_spec: `spec-rum-parity-p0-safety-truth.md`
  summary: Planifier un backfill contrôlé des rollups historiques déjà sous-comptés avant la migration v64.
  evidence: La migration corrige les agrégations futures et les arrivées tardives, mais recalculer l'historique complet impose une fenêtre, une charge et un calendrier de production qui relèvent du déploiement à valider séparément.

- source_spec: `spec-rum-event-foundation.md`
  summary: Planifier un backfill contrôlé de `rum_event_index` pour les signaux RUM antérieurs à la migration v65.
  evidence: La migration indexe les nouvelles écritures immédiates et différées. Rejouer l'historique exige une fenêtre de rétention, une estimation de charge et un créneau de production à valider avant toute exécution.
