- source_spec: `spec-rum-parity-p0-safety-truth.md`
  summary: Planifier un backfill contrôlé des rollups historiques déjà sous-comptés avant la migration v64.
  evidence: La migration corrige les agrégations futures et les arrivées tardives, mais recalculer l'historique complet impose une fenêtre, une charge et un calendrier de production qui relèvent du déploiement à valider séparément.

- source_spec: `spec-rum-event-foundation.md`
  summary: Planifier un backfill contrôlé de `rum_event_index` pour les signaux RUM antérieurs à la migration v65.
  evidence: La migration indexe les nouvelles écritures immédiates et différées. Rejouer l'historique exige une fenêtre de rétention, une estimation de charge et un créneau de production à valider avant toute exécution.

- source_spec: `spec-rum-browser-context-identity.md`
  summary: Sérialiser l'effacement DSAR avec toute ingestion simultanée de la même identité, y compris les lots encore sans session matérialisée.
  evidence: La suppression actuelle retire les lots connus et verrouille les sessions existantes, mais une arrivée concurrente après le snapshot peut recréer des données; fermer ce cas impose un verrou/tombstone partagé avec tous les chemins d'ingestion.

- source_spec: none
  summary: P4 — construire l’Explorer d’événements avec attributs, tendances, API/MCP, widgets et alertes.
  evidence: Cet Explorer est un livrable consultable autonome fondé sur l’index P1/P2 et peut être développé après le modèle causal d’actions sans bloquer P3.

- source_spec: none
  summary: P5 — renforcer Error Tracking avec regroupement, collecte élargie, régressions et workflow de triage.
  evidence: Le cycle de vie des erreurs et son modèle de regroupement forment un domaine indépendant qui exige ses propres migrations, règles de compatibilité et preuves de non-régression.

- source_spec: none
  summary: P6 — unifier les filtres et ajouter les breakdowns navigateur, OS et pays ainsi que les dashboards avancés.
  evidence: Les dimensions d’analyse et les dashboards constituent une surface autonome, réutilisable par plusieurs pages mais non nécessaire à la corrélation causale P3.

- source_spec: none
  summary: P7 — étendre la parité aux runtimes React Native et Node, y compris la collecte mobile et native.
  evidence: Les SDK non web ont des contraintes de cycle de vie et de distribution distinctes; les coupler au modèle d’actions navigateur augmenterait inutilement le blast radius de P3.

- source_spec: none
  summary: P8 — exécuter les backfills, fermer la concurrence DSAR et intégrer les capacités dépendant de fournisseurs tiers.
  evidence: Ces opérations demandent une fenêtre de production, une estimation de charge ou des comptes externes et restent donc séparées des changements applicatifs déterministes de P3.
