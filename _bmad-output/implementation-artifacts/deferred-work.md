- source_spec: `spec-rum-parity-p0-safety-truth.md`
  summary: Planifier un backfill contrôlé des rollups historiques déjà sous-comptés avant la migration v64.
  evidence: La migration corrige les agrégations futures et les arrivées tardives, mais recalculer l'historique complet impose une fenêtre, une charge et un calendrier de production qui relèvent du déploiement à valider séparément.

- source_spec: `spec-rum-event-foundation.md`
  summary: Planifier un backfill contrôlé de `rum_event_index` pour les signaux RUM antérieurs à la migration v65.
  evidence: La migration indexe les nouvelles écritures immédiates et différées. Rejouer l'historique exige une fenêtre de rétention, une estimation de charge et un créneau de production à valider avant toute exécution.

- source_spec: `spec-rum-browser-context-identity.md`
  summary: Sérialiser l'effacement DSAR avec toute ingestion simultanée de la même identité, y compris les lots encore sans session matérialisée.
  evidence: La suppression actuelle retire les lots connus et verrouille les sessions existantes, mais une arrivée concurrente après le snapshot peut recréer des données; fermer ce cas impose un verrou/tombstone partagé avec tous les chemins d'ingestion.

- source_spec: `spec-rum-events-explorer-p4.md`
  summary: P4 — Explorer d’événements livré ; retiré des travaux restant à implémenter.
  evidence: Livraison sur master au commit 11e9f346474db10abef111c8a120a1cecfd41997, migration v68 ; consulter la spec et son rapport de vérification.

- source_spec: [spec-rum-error-tracking-p5.md](spec-rum-error-tracking-p5.md)
  summary: P5 — renforcer Error Tracking avec regroupement, collecte élargie, régressions et workflow de triage.
  evidence: Plan détaillé livré le 16/09/2026, six sous-lots ordonnés ; implémentation à faire. Point d’entrée commun [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md).

- source_spec: [spec-rum-analytics-dashboards-p6.md](spec-rum-analytics-dashboards-p6.md)
  summary: P6 — unifier les filtres et ajouter les breakdowns navigateur, OS et pays ainsi que les dashboards avancés.
  evidence: Plan détaillé livré le 16/09/2026 : contrat partagé de filtres/AST, six sous-lots, mesures/populations et compatibilité des dashboards ; implémentation à faire.

- source_spec: [spec-rum-runtime-parity-p7.md](spec-rum-runtime-parity-p7.md)
  summary: P7 — étendre la parité aux runtimes React Native et Node, y compris la collecte mobile et native.
  evidence: Plan détaillé livré le 16/09/2026, cinq sous-lots JS/runtime. Certification native et crashes natifs séparés en P8.5 ; stockage offline durable activable après P8.1.

- source_spec: [spec-rum-operations-integrations-p8.md](spec-rum-operations-integrations-p8.md)
  summary: P8 — exécuter les backfills, fermer la concurrence DSAR et intégrer les capacités dépendant de fournisseurs tiers.
  evidence: Plan détaillé livré le 16/09/2026, huit sous-lots. Protocole transactionnel et dry-run réalisables dans le dépôt ; périmètre historique, politique des barrières et activations fournisseurs explicitement à décider sur résultat concret.
