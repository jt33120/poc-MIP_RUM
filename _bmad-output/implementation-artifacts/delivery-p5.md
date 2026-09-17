# Livraison P5 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-error-tracking-p5.md](spec-rum-error-tracking-p5.md).
Base : `11e9f346474db10abef111c8a120a1cecfd41997` (P4 livré, v68 sur Neon).

Une case n’est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | Branche | Implémenté | Testé localement | Déployé | Vérifié sur vraie app | Bloqué |
|---|---|---|---|---|---|---|
| P5.1 — corrélation, compteurs, détail scoped | `feat/datadog-rum-error-tracking-p5-1` | en cours | — | — | — | — |
| P5.2 — collecte navigateur opt-in | — | — | — | — | — | — |
| P5.3 — erreurs OTel/backend | — | — | — | — | — | — |
| P5.4 — source maps CI | — | — | — | — | — | — |
| P5.5 — groupes versionnés | — | — | — | — | — | — |
| P5.6 — triage, régressions, notifications | — | — | — | — | — | — |

## P5.1 — détails fiables et corrélation

Démarré le 16/09/2026 sur `feat/datadog-rum-error-tracking-p5-1` (commit de baseline `3fe73ea` : plan et specs embarqués).

### Décisions d’implémentation

Contrat relu avant codage par trois revues contradictoires exécutées contre le code et PostgreSQL 15 (SQL/ingestion,
lecture console, API/UI). Décisions retenues :

- **Migration v69 additive** : 12 colonnes nullable (ou `context` par défaut `{}`) sur `rum_error`, contrainte
  `rum_error_envelope_v69` `NOT VALID` (aucun parcours de la table chaude sous verrou), `lock_timeout` de 5 s. Aucun
  index : l’existence d’une trace passe par `rum_span_trace_idx`.
- **Pas de source d’erreur dans `rum_event_index.source_name`** : migration-v67 revalide sa taxonomie fermée à chaque
  rejeu des tests SQL, et une valeur v69 y ferait échouer tous les `beforeAll` suivants. Aucun lecteur P5.1 n’en a
  besoin ; P6.1 (dimensions indexées) tranchera avec une colonne dédiée.
- **Enveloppe dérivée côté serveur** : source (`browser_js`, `react_native_js`…) déduite du runtime MIP et du
  `mip.error_kind`, `handled` connu seulement quand il l’est réellement, `is_fatal` jamais inféré, trace/span parent
  natifs validés (l’identifiant de trace synthétique du SDK mobile devient NULL), `service` NULL pour les SDK RUM MIP,
  `env` conservé comme « déclaré par l’émetteur » et exclu des filtres P5.1.
- **Durcissement d’ingestion** : NUL (U+0000) remplacé avant écriture, nombres en notation exponentielle retirés des
  contextes/props, `error_type`/`kind`/`lineno`/`colno` bornés — un attribut hostile ne doit plus annuler un lot entier.
  L’empreinte de regroupement reste l’algorithme actuel (P5.5).
- **Lecture console unique `queries-errors.ts`** : une base filtrée (app, `[from,to)`, appareil dont tablette, segment,
  bots, apps internes) partagée par liste, totaux, tendance, exemplaire et occurrences dans un seul snapshot ;
  compteurs `sum(occurrences)` en `float8`, ratios de couverture en division réelle, personnes touchées `null` quand
  l’identité est inconnue (compteurs historiques `sessions`/`users_affected` inchangés).
- **Échantillonnage** : avertissement fondé sur la probabilité d’inclusion d’une erreur
  (`sr + (1 − sr) × esr`), pas sur le taux de session ; aucune pondération.
- **Portée** : `apps = []` vaut zéro accès (pages et API). Un fingerprint présent dans plusieurs apps autorisées
  produit un choix (console) ou un `400` explicite (API), jamais un `limit 1` arbitraire.
- **Liens** : session, rejeu, trace et span parent affichés seulement si la relation existe dans la même app ; la page
  trace filtre ses spans par app et valide le span parent demandé.
- **Rejeu positionné** : `rrweb-player@2.0.1` tel qu’installé n’instancie jamais son `Replayer` (onglet rejeu inerte) ;
  le lecteur monte directement `@rrweb/replay@2.0.1`, déjà présent dans le lockfile comme dépendance transitive.

### Preuves

À compléter au fil de la livraison.

### Suivis identifiés hors P5.1

À compléter au fil de la livraison.
