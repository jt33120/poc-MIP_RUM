# Reprise Claude — plan d’implémentation P5 à P8

Date : 16 septembre 2026. Base inspectée : `11e9f346474db10abef111c8a120a1cecfd41997`, branche `master`.
Statut : **plan livré ; P5 à P8 non implémentés par cette livraison documentaire**.

## 1. Prompt de reprise à donner à Claude

> Travaille dans le dépôt `poc-MIP_RUM`. Lis ce fichier puis les quatre specs liées ci-dessous. Commence par vérifier `git status`, les instructions du dépôt, le HEAD et les migrations présentes ; préserve toute modification locale. P0 à P4 ont déjà été livrés. Utilise `graft` pour retrouver les points de code, puis les tests et les fichiers cités pour vérifier les détails. Implémente les sous-lots dans l’ordre de la section 3, sur une branche dédiée par livraison. Chaque sous-lot contient son contrat, ses fichiers et ses critères de recette ; coche ses cases uniquement sur preuve. Réutilise le produit existant. N’ajoute pas un autre SDK ou un fournisseur SaaS sans choix explicite. Termine les tâches autonomes même si une validation native ou un compte externe manque ; marque seulement la tâche dépendante comme bloquée, avec l’élément exact nécessaire. L’utilisateur a déjà autorisé commit, push, merge et migrations Neon ordinaires après vérification. Cette autorisation ne choisit pas de fournisseur, ne modifie pas la rétention et n’autorise pas un backfill de périmètre indéterminé. Prépare le dry-run et le périmètre chiffré avant les opérations historiques. Vérifie le SHA déployé et le flux réel après publication. Ne confonds pas tests locaux, fixtures et validation en production.

## 2. Documents à suivre

| Lot | Spec exécutable | Résultat |
|---|---|---|
| P5 | [spec-rum-error-tracking-p5.md](spec-rum-error-tracking-p5.md) | Erreurs enrichies, regroupement versionné, source maps CI, triage et alertes fiables |
| P6 | [spec-rum-analytics-dashboards-p6.md](spec-rum-analytics-dashboards-p6.md) | Filtres communs, dimensions, Explorer générique et dashboards graphiques |
| P7 | [spec-rum-runtime-parity-p7.md](spec-rum-runtime-parity-p7.md) | Parité des contrats React Native, Node et FastAPI ; UX mobile JS |
| P8 | [spec-rum-operations-integrations-p8.md](spec-rum-operations-integrations-p8.md) | Effacement concurrent, reprise historique contrôlée, validations natives et intégrations externes |

Ces documents se suffisent pour commencer. Le texte d’audit original reste une **photo antérieure à P0–P4** :
`/Users/juliantalou/.codex/attachments/c9a279cd-de52-44d7-a989-d50917ffac9d/pasted-text.txt`.
Il n’est pas requis sur la machine de Claude et ses numéros de ligne ne doivent pas guider les modifications actuelles.
Les docs `SOLUTION_DESIGN.md` et `docs/AUDIT_RUM_EXTERNE.md` donnent du contexte mais peuvent aussi précéder ces livraisons.

### Déjà acquis, à conserver

| Livraison | Preuve locale à lire | Conséquence pour la suite |
|---|---|---|
| P0 / v64 | `spec-rum-parity-p0-safety-truth.md`, `migration-v64.sql`, `packages/rum-sdk/src/errors.ts` | Scrub breadcrumbs, scope dashboard, drainage des répétitions, `sum(occurrences)`, détection des arrivées tardives déjà traités ; étendre leurs preuves |
| P1 / v65 | `spec-rum-event-foundation.md`, `migration-v65.sql` | `rum_event_index` est une projection idempotente, hors métering, avec rétention/DSAR ; pas de backfill historique automatique |
| P2 / v66 | `spec-rum-browser-context-identity.md`, `event-context.ts`, `identity-hash.mjs` | Contexte global/user/account/view/local, `startView`, `addTiming`, flags, `addError`, HMAC avant la file et DSAR POST existent |
| P3 / v67 | `spec-rum-actions-causal-p3.md`, `migration-v67.sql` | Actions causales, `action_id`, liens et signaux de frustration : préserver leur attribution et leur sampling |
| P4 / v68 | `spec-rum-events-explorer-p4.md`, `queries-events.ts`, `migration-v68.sql` | `/events`, total/tendance/facettes, filtres primitifs typés, curseur microseconde, widget `event_count`, alertes `event:<nom>`, MCP `mip_rum_list_events` existent |

Le rapport de livraison précédent a confirmé v68 sur Neon et le déploiement de ce SHA sur Vercel/Railway. Ce plan vérifie le checkout, pas à nouveau l’état distant. Les anciennes sections « résultats » de certaines specs décrivent leur état local avant leur publication : ne pas les prendre pour le registre actuel de Neon.

## 3. Ordre précis, quick wins puis dépendances externes

Tailles = estimations de travail d’ingénierie, tests/revue inclus, hors attente externe : S ≈ 0,5–1 jour ; M ≈ 1–3 jours ; L ≈ 3–6 jours. Ce ne sont pas des délais garantis d’agent. Découper un L si le diff dépasse une revue cohérente.

| Ordre | Sous-lot | Taille | Dépendance | Autonomie |
|---:|---|---|---|---|
| 1 | P5.1 — corrélation, compteurs, détail scoped | M | P0–P4 | Dépôt seul |
| 2 | P5.2 — collecte navigateur opt-in | M | P5.1 | Dépôt + navigateur de test |
| 3 | P5.3 — erreurs OTel/backend | M | P5.1 | Dépôt + processus Node/Python |
| 4 | P5.4 — source maps CI et symbolication partagée | M | P5.1 | Dépôt ; accès CI client pour sa recette réelle |
| 5 | P5.5 — groupes versionnés, identité d’issue | L | P5.3–4 | Dépôt ; regroupement historique en P8 |
| 6 | P5.6 — triage, régressions et notifications | L | P5.5 | Dépôt ; destinations existantes seulement |
| 7 | P6.1 — dimensions collectées | M | P5 champs communs | Dépôt |
| 8 | P6.2 — contrat unifié des filtres | L | P6.1 | Dépôt |
| 9 | P6.3 — breakdowns et drill-downs | M | P6.2 | Dépôt |
| 10 | P6.4 — Explorer générique borné | L | P6.2 | Dépôt |
| 11 | P6.5 — dashboards et vues enregistrées | L | P6.4 | Dépôt |
| 12 | P6.6 — stratégie agrégats et budgets | M | P6.3–5 | Dépôt ; profil de charge réel à mesurer |
| 13 | P7.1 — contrats communs et adaptateurs RN | M | P2/P5/P6 | Dépôt |
| 14 | P7.2 — consentement, identité et transport RN | L | P7.1 | Dépôt ; stockage natif persistant préparé mais activation après P8.1 |
| 15 | P7.3 — navigation, interactions et erreurs JS RN | M | P7.2 | Dépôt ; recette RN réelle séparée |
| 16 | P7.4 — API Node et contexte FastAPI | M | P5.3 | Dépôt |
| 17 | P7.5 — vue `/mobile`, API/MCP et package | M | P6/P7.3–4 | Dépôt ; certification native en P8.5 |
| 18 | P8.1 — transactions ingestion/effacement et tombstones | L | Tous chemins d’écriture P5–P7 recensés | Dépôt ; politique d’expiration à valider avant activation durable |
| 19 | P8.2 — outillage de backfill et dry-run | M | P8.1 | Dépôt seul, sans réécriture prod |
| 20 | P8.3 — exécution/reconciliation des backfills | M | Dry-run et périmètre explicite | Fenêtre/capacité de production |
| 21 | P8.4 — intégration source maps dans la CI du client | S | P5.4 | Repo/build/releases du client |
| 22 | P8.5 — crashes natifs, symboles et appareils | L+ | P7, moteur retenu | Choix moteur, app native et builds de test |
| 23 | P8.6 — connecteurs de tickets | M par connecteur | P5.6 | Fournisseur/espace/droits choisis |
| 24 | P8.7 — GeoIP optionnel | M | P6.1 | Source/licence/résidence et politique décidées |
| 25 | P8.8 — bilan de couverture et transfert | S | Résultats de chaque lot | Dépôt ; limites explicites |

P8.1 peut être avancé juste après P5.1 si la suppression de données est prioritaire. Il est obligatoire **avant** P8.3 et avant activation d’une reprise offline persistante P7 en production. Ne pas attendre un fournisseur pour faire P8.1–2.

## 4. Règles communes d’implémentation

### Compatibilité et chiffres

- Les numéros de migrations sont attribués à l’implémentation, à partir du plus grand numéro réellement présent. v69 est seulement le prochain candidat à la base inspectée. Ne jamais réserver à l’avance v69–v99 dans le code, ni modifier une migration déjà appliquée.
- Extensions additives des API existantes, mêmes enveloppes et champs historiques. Nouveau contrat strict versionné pour les fonctions non représentables dans les API anciennes.
- `app_id` lié dans chaque SQL, y compris sous-requêtes, totaux, listes de valeurs, exports, exemplaires et relations. Jointures session/action/span toujours app-scopées. Un `[]` d’apps autorisées signifie zéro accès, jamais toutes apps.
- `observed` est le défaut : occurrences = somme des répétitions effectivement reçues ; lignes != occurrences ; sessions != visiteurs != identités déclarées. Ne pas additionner ces populations.
- Aucun multiplicateur `weight` automatique : le sampling `error-biased` exige une probabilité d’inclusion par signal. Afficher l’incertitude plutôt qu’une estimation sans démonstration.
- Donnée inconnue = `null`/« Inconnu » ; métrique sans dénominateur = `null` ; compteur réellement vide = `0`. Les populations de chaque taux sont définies dans les specs.
- Fenêtres UTC `[from,to)`, une borne `to` capturée par requête, curseurs préservant les microsecondes PostgreSQL. Ne pas convertir un timestamp de curseur en `Date` JavaScript avant sérialisation.

### UI et permissions

- Réutiliser `PageHeader`, `GlobalFilters`, `SegmentBar`, `card`, `btn-accent`, `INPUT_CLASS` et les graphiques sous `components/charts/`. Respecter les tokens et thèmes existants.
- Toute surface : chargement, vide, erreur avec réessai, partiel avec raison, succès. Contrôles natifs labellisés, navigation clavier, alternative textuelle aux séries et absence de débordement à 390/768/1440 px.
- Viewer/demo : lecture dans le scope existant ; aucune écriture de triage, de source maps, d’intégration, d’opération ou de dashboard sans le droit existant explicitement prévu. Admin : mutations app-scopées. Jetons `CONSOLE_API_TOKENS` : lecture seule ; ne jamais leur ajouter un droit d’upload.
- Les filtres ne sont pas une autorisation : intersecter avec le principal signé avant les lectures. Les mutations doivent revérifier le scope après résolution de la ressource.
- Aucun secret `.env`, token GitHub, identité brute ou payload de production dans les plans, fixtures, logs de test ou commits.

### Déploiement et preuves

1. Branche dédiée et commit de baseline ; journal des sous-lots dans un fichier de livraison, par exemple `delivery-p5.md` (à créer au début de l’implémentation).
2. Tests ciblés pendant le travail, suite requise avant publication. Ne pas relancer sans raison une suite passée si aucun code correspondant n’a changé.
3. Migrations sur PostgreSQL jetable et sur un schéma de version précédente. Vérifier idempotence, RLS, purge, DSAR et qu’une projection ne double pas le quota.
4. Gros index : `predeploy-vNN-indexes.sql` avec `CREATE INDEX CONCURRENTLY`, hors transaction du runner. Vérifier `indisvalid`/`indisready` ; un index invalide existant n’est pas corrigé par `IF NOT EXISTS`.
5. Appliquer les migrations ordinaires autorisées via `apps/ingest/migrate.mjs` et le `DATABASE_URL` configuré, sans afficher sa valeur. Contrôler `schema_migration`, checksum et objets réellement créés. Ne pas exécuter les tests sur ce `DATABASE_URL`.
6. Push/merge de la branche après revue ; suivre CI et déploiements. Branches par défaut à confirmer (`master` au départ). Ne pas supposer que le login GitHub read-only peut publier : utiliser le mécanisme authentifié déjà disponible.
7. Preuve : SHA/URL, API authentifiée et UI réelle, outil MCP effectivement appelé. Si les seules données sont vides, prouver le contrat vide et distinguer cette preuve de la recette fonctionnelle sur fixtures.
8. Rollback applicatif compatible avec le schéma additif. Pas de down-migration destructive. Désactiver les nouvelles fonctionnalités et conserver leur état pour diagnostic.

Commandes existantes à la base inspectée :

```sh
pnpm test:unit
SQL_TEST_DATABASE_URL=<base-jetable> pnpm test:sql
pnpm test:isolation
pnpm test:alerting
pnpm --filter console exec tsc --noEmit
pnpm --filter console build
pnpm --filter @mip/rum-sdk size-check
pnpm exec playwright test <spec-du-lot> --workers=1
python3 -m unittest discover -s integrations/fastapi -p 'test_*.py'
git diff --check
```

Les placeholders ne sont pas des commandes à coller telles quelles. Vérifier la configuration effective de chaque script SQL : `test:isolation` et `test:alerting` ne prennent pas forcément la même variable que Vitest. Utiliser des bases jetables explicitement nommées, et s’assurer que le script n’hérite pas de la connexion prod. Les nouveaux noms de tests listés dans les specs sont **à créer**, pas des preuves déjà obtenues.

## 5. Frontières entre les lots

| Sujet partagé | Propriétaire | Contrat consommé par les autres |
|---|---|---|
| Enveloppe d’erreur et identifiant d’issue | P5 | P7 l’émet ; P6 la filtre ; P8 la reprend sans re-notifier |
| Erreurs OTel avec/sans session | P5.3 | P7 enrichit les SDK, sans second parser serveur |
| Filtres/ranges et AST d’analytics | P6 | P5 reçoit un adaptateur puis migre ; P7 mobile réutilise ; P8 ne réimplémente pas les métriques |
| Contexte/consentement/HMAC | P2 puis P7 | HMAC demeure aux deux ports serveur ; aucun secret HMAC dans le SDK |
| Transactions et suppression concurrente | P8.1 | Tous writers et backfills doivent utiliser la même primitive |
| Ingestion des crashes natifs | P8.5 | Les interfaces P7 et le modèle d’erreur P5 la reçoivent |
| Source maps applicatives | P5.4 | CI locale testable ; accès CI client en P8.4 |

## 6. Ce que « fini » voudra dire

Tenir une matrice par capacité avec `implémenté`, `testé localement`, `déployé`, `vérifié sur vraie app`, `bloqué` et une preuve. Un connecteur simulé n’est pas intégré ; une erreur ErrorUtils n’est pas un crash natif ; un pays déduit du fuseau n’est pas une géolocalisation exacte ; un SDK backend sans session n’a pas un utilisateur impacté connu.

Les lots traitent le backlog P5–P8, pas une équivalence intégrale Datadog. Heatmaps, replay mobile complet, instrumentation automatique de tous frameworks, classifications de cause par IA et hébergement souverain ne sont pas implicitement inclus. Si demandés, les ajouter comme lots distincts avec budget/prérequis. Les providers P8 sont optionnels : leur absence doit rester visible dans le bilan final.

Les références officielles vérifiées le 16/09/2026 sont dans chaque spec. Elles servent à fixer le périmètre de comparaison, pas à imposer une dépendance Datadog au produit.
