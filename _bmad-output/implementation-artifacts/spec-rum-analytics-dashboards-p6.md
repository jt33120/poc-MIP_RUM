---
title: 'P6 — Filtres communs, breakdowns, Explorer et dashboards'
status: 'planned'
created: '2026-09-16'
baseline_commit: '11e9f346474db10abef111c8a120a1cecfd41997'
depends_on: ['P4', 'P5']
---

# P6 — Analytics et dashboards

Lire [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md). P4 `/events` reste l’Explorer spécialisé custom ; P6 ajoute l’analyse générique multi-signaux par une requête validée et bornée.

## 1. Résultat et existant à respecter

Un utilisateur filtre app/période/appareil/navigateur/OS/env/release/route, compare une dimension, ouvre le détail concerné et enregistre cette analyse dans un dashboard. Export, API et MCP rendent la même mesure, avec la même population et l’incertitude éventuelle.

Au HEAD inspecté : `filters.ts` utilise `app:null` pour toutes apps et desktop/mobile ; `queries-v2.ts` utilise `'all'` et accepte aussi tablet. `segments.ts` expose geo/device/client/source. `dashboards.ts` contient six types dont `event_count`, un layout JSON, un titre et une métrique, avec 24 widgets maximum. P4 a son adaptateur tablet et ses filtres additionnels. **Ne pas maintenir un troisième modèle.**

## 2. Contrat commun des filtres

Créer `apps/console/lib/query-contract.ts` (pur), puis utiliser `filters.ts` comme façade UI/URL. Les champs ci-dessous sont les noms du contrat P6 v1.

```ts
type QueryScope = {
  requestedApp: string | null;
  authorizedApps: string[] | null; // null = admin transverse autorisé ; [] = aucun accès
  effectiveApps: string[] | null;
};
type ResolvedRange = {
  from: string; to: string; // timestamps UTC, from inclusif / to exclusif
  preset: '1h' | '24h' | '7d' | null;
  bucketSeconds: number;
};
type AnalyticsFilters = {
  device?: 'desktop' | 'mobile' | 'tablet';
  browser?: string; os?: string; env?: string; service?: string;
  release?: string; route?: string; country?: string;
  includeBots: boolean; includeInternal: boolean;
  segments: Array<{dimension: string; operator: 'eq' | 'neq'; value: string}>;
};
```

- Le client ne transmet **jamais** `authorizedApps/effectiveApps` comme autorisation ; ils sont résolus serveur. Le JSON de réponse annonce le scope réellement appliqué.
- Presets anciens inchangés. Nouvelle plage `from/to` : ISO UTC explicite, from < to, durée ≤30 jours, to ≤heure serveur ; entrée invalide →400 dans la nouvelle API. Le maximum n’étend pas la rétention : une fenêtre hors données conservées porte `coverage`.
- Si preset et from/to sont envoyés ensemble dans le nouveau contrat, 400. Les anciennes URLs restent supportées via adaptateur, avec leurs défauts documentés. Pas de fallback silencieux d’une plage custom invalide.
- Résoudre une seule fois `to` puis utiliser ces deux bornes pour chaque SQL. Pour comparaison période précédente : même durée, période précédente contiguë ; dénominateur précédent nul → variation null.
- Buckets proposés : ≤1h=5 min, ≤24h=1h, ≤7j=6h, ≤30j=24h ; alignement UTC explicite et coupure des buckets partiels aux bornes. Au plus 300 points, y compris buckets de bord. Compteurs à zéro ; percentiles sans échantillon à null.
- Filtres de même dimension : globaux ET widget ET scope ; une intersection vide rend zéro résultat. Un widget ne peut pas remplacer `app=A` par `app=B` ni effacer un filtre global.
- Bornes : 10 conditions AND, 100 caractères par nom de dimension, 500 caractères par valeur, 32 Kio corps de requête ; pas de OR récursif, regex, SQL ni JSONPath. `neq` exclut null ; « Inconnu » utilise `is_null` dans l’AST générique, pas une chaîne qui pourrait être une vraie valeur.
- Cursor lié à l’empreinte de requête et au `to` résolu ; changement de filtre/sort/range invalide le curseur. La précision PostgreSQL est conservée ; pas de snapshot long tenu entre pages.

### Dimensions : provenance et stockage

| Dimension | Source | Stockage cible / sens |
|---|---|---|
| browser/browser_version | UA déjà présent, parser serveur déterministe | colonnes session nullables ; pas de fingerprinting ou de nouvelle collecte UA haute entropie |
| os/os_version | UA existant ou attributs runtime validés | colonnes session nullables ; iOS/Android ne sont pas des `device_type` |
| env/service | resource/span OTLP explicitement normalisés | snapshot par occurrence dans index et tables sources consommées ; session seule insuffisante pour erreur backend ou changement de release |
| release | attribut P2/runtime, snapshot par événement | réutiliser les colonnes existantes ; pas de copie de la dernière release session sur le passé |
| route/view | route normalisée, view_id P2 | événement/vue ; requêtes sur template, jamais URL brute |
| country | `geo_country` existant issu du fuseau | afficher « Pays estimé d’après le fuseau », `geo_source=timezone`; null reste inconnu ; GeoIP seulement P8.7 |
| device | desktop/mobile/tablet | normaliser mobile pour iOS/Android tout en gardant platform séparément |
| source/platform | collection_source + runtime/browser/react_native/node/python + ios/android/web | préserver collection_source sdk/extension ; ne pas lui faire porter le runtime |
| ctx.<key>/props.<key> | snapshot borné P2/P4 | primitives typées ; ctx sur événements qui le possèdent, props sur custom seulement |

Ajouter uniquement les colonnes manquantes et la propagation dans les writers ; ne pas changer les identités ni la rétention. Historique inconnu affiché comme tel, enrichissement rétrospectif uniquement P8. Les champs de dimension sont bornés (famille ≤80, version/env/service/release ≤120 chars), scrubbed et non indexés comme texte libre arbitraire. Utiliser un parser UA existant si disponible ; sinon module ciblé et corpus, après vérification de licence/dépendances. Ne pas choisir une lib sans vérifier sa licence.

## 3. Contrat de requête analytique

Créer `analytics-schema.ts` (validation pure), `analytics-compiler.ts` (SQL à templates/allowlists) et `queries-explorer.ts` (I/O). L’AST versionné est partagé par UI, dashboard, API/MCP et export.

```json
{
  "version": 1,
  "app": "demo-app",
  "range": {"preset": "24h"},
  "dataset": "errors",
  "measure": {"aggregation": "sum", "field": "occurrences"},
  "filters": [{"field": "browser", "operator": "eq", "type": "string", "value": "Firefox"}],
  "groupBy": ["release"],
  "visualization": "timeseries",
  "limit": 10
}
```

`range` accepte exactement `{preset}` ou `{from,to}`. GroupBy ≤2 dimensions ; limite groupes 1..50 ; journal limit ≤200. Les deux groupBy produisent **au plus 50 combinaisons au total**, pas 50×50. Pour timeseries, choisir les top groupes sur toute la fenêtre puis afficher ces mêmes groupes dans tous les buckets ; ne pas changer de top-N bucket par bucket. Signaler les groupes omis ; le total est calculé indépendamment du top-N. Rendre « Autres » uniquement si l’agrégation est additive (jamais pour un percentile ou un distinct).

### Registre dataset/measure (allowlist fermée)

| Dataset | Source et unité | Agrégations initiales |
|---|---|---|
| `events` | `rum_event`, événements manuels ; type explicite, custom par défaut ; pas toutes projections P1 | count ; sum/avg/p75/p95 sur `timing_ms` seulement pour type timing, ou propriété numérique explicitement déclarée et validée pour custom |
| `errors` | `rum_error`, occurrences reçues | sum(occurrences), distinct sessions, distinct visitors, distinct identified_users, séparés |
| `views` | `rum_pageview`, started_at | count, distinct sessions ; pas de temps passé fabriqué |
| `sessions` | `rum_session` | sessions commencées dans fenêtre et sessions actives chevauchant fenêtre sont deux mesures nommées différentes |
| `vitals` | `rum_metric`, nom CWV explicite | count, avg, p75, p95 sur valeur canonique par vue/metric_uid selon le writer existant |
| `resources` | `rum_resource`, durée/taille observée | count, avg/p75/p95(duration), sum(transfer_size) ; avertissement collecte partielle |
| `longtasks` | `rum_longtask` | count, sum/avg/p95(duration) ; conserver distinction LoAF/longtask sans addition implicite si chevauchement |
| `actions` | `rum_action` P3 | count, durées si disponibles, frustration par type ; pas de reconstruction de causalité |
| `spans` | `rum_span` | count, avg/p95(duration), split tier/service ; un span n’est pas une visite |

Le registre déclare pour chaque couple dataset/champ : type, unité, colonne/template, dimensions disponibles, opérateurs autorisés, population, capacité rollup et notice de sampling/collecte. Une dimension absente du dataset produit 400 `unsupported_dimension`, jamais un filtre ignoré. Les attributs numériques ne sont castés qu’après test `jsonb_typeof='number'` ; string `"42"` != number `42` ; NaN/Infinity rejetés. Les champs JSON legacy non objets ne doivent pas faire échouer la requête.

Réponse additive `{meta,data}` :

```json
{
  "meta": {
    "query_version": 1,
    "effective_apps": ["demo-app"],
    "range": {"from": "2026-09-15T12:00:00.000Z", "to": "2026-09-16T12:00:00.000Z", "bucket_seconds": 3600},
    "dataset": "errors", "unit": "occurrences", "aggregation": "sum",
    "counting": "observed", "source": "raw", "warnings": [],
    "coverage": {"status": "complete", "reason": null},
    "truncated_groups": false
  },
  "data": {"total": 38, "groups": [], "series": [], "rows": [], "next_cursor": null}
}
```

Forme des éléments : `groups[{key:[string|null,...],value:number|null,samples:number}]` ; `series[{start,end,key:[...],value,samples}]` ; `rows` contient le DTO source déjà scrubbed et autorisé, jamais un `select *` générique. La clé est un tuple JSON, pas une concaténation à séparateur ambigu. Mesures > entier JS sûr : appliquer la règle commune de sérialisation sans arrondi silencieux. `coverage.status` = complete/partial/unknown ; complete signifie couverture du stockage interrogé, pas garantie de collecte de tout le trafic. Sampling/ressources partielles restent dans `warnings` même si le stockage est complet.

## 4. Sous-lots et acceptation

### P6.1 — dimensions aux bonnes frontières (M)

- [x] Ajouter parser/dimensions normalisés dans `_shared/dimensions.mjs`, couvrir navigateurs usuels, UA inconnus, bots, UA RN ; propager dans `otlp.mjs`, `pg-ingest.mjs`, index et sources nécessaires.
  - Preuve : `tests/unit/dimensions.test.ts` (corpus), `tests/unit/otlp-dimensions.test.ts`. Tablette déduite de l’UA (prime sur l’indice du SDK web), `ios`/`android` → `mobile` + `os`, robots sans navigateur ni système.
- [x] Ajouter migration additive, colonnes optionnelles détectées pour le writer avant migration et fixtures vieux SDK. Aucune obligation d’UA si backend sans session.
  - Preuve : `migration-v75.sql` ; `tests/integration/dimensions-v75-sql.test.ts` (rejeu, bornes, lot différé antérieur, backend sans UA, fenêtre v74 → v75).
- [x] Stocker env/release à l’événement, pas via session mutable. Fenêtres d’analytics ne dépendent pas de données futures de session.
  - Preuve : même fichier, « une release qui change pendant la visite, puis une session modifiée après coup, ne réécrivent pas le passé ». `mip.release` bornée à l’ingestion (1–120 caractères, jamais scrubbée), règle reprise par l’upload de source maps.
- [x] Ajouter sélecteurs de valeurs distinctes limités à app/fenêtre, avec `unknown` et cap 100. Aucun inventaire global transverse envoyé au viewer.
  - Preuve : `apps/console/lib/{dimensions,queries-dimensions}.ts` (lib seule, aucun endpoint), `tests/unit/dimension-values.test.ts` et le test SQL (A/B, `[from,to)`, plafond, robots, historique).
- [ ] Index ciblés `(app_id,env,ts)` / `(app_id,release,ts)` selon plans réels, pas toutes combinaisons de dimensions.
  - Mesuré (en-tête de `migration-v75.sql`) : aucun lecteur P6.1 n’en a besoin ; un filtre release/env sur fenêtre passe de 100–120 ms à 0,4–7 ms avec l’index. À créer par le premier lecteur filtré (P6.2 ou P6.6), sur sa table, avec pré-déploiement CONCURRENTLY.

Recette : vieilles lignes null, mobile/tablet, changement release dans une même session et erreur backend sans UA. Le regroupement historique ne change pas après mise à jour de la session.

### P6.2 — unifier les filtres sans rupture (L)

- [x] Créer contrat/parseur/compilateur des prédicats ; traiter toutes apps autorisées vs aucune, sans réutiliser aveuglément le fallback « première app » des anciens helpers.
- [x] Adapter `filters.ts`, `queries-v2.ts`, P4 `queries-events.ts`, P5 `queries-errors.ts`. Les façades publiques anciennes restent testées jusqu’à migration de leurs derniers appelants.
- [x] Migrer par tranches : home/pages/sessions → events/actions/ux → errors → correlation/map/experience → SLO/alerts et widgets. Pour SLO/alertes, distinguer la **liste des configurations** des **mesures temporelles** ; un filtre absent du modèle d’une règle n’est pas annoncé comme appliqué à son évaluation.
- [x] Les filtres sans sens sur une surface sont désactivés avec raison, ou la surface expose sa capacité ; ne pas afficher un browser sélectionné au-dessus d’un chiffre qui l’ignore.
- [x] Préserver les query params lors de tous les drill-downs. Reprise URL ancienne et segments localStorage avec version ; token invalide rejeté dans API nouvelle et erreur UI récupérable.
- [x] Mettre scope/AST/range/permissions dans les clés de cache/ETag. Une réponse A ne peut pas être réutilisée pour B.

Recette (livrée le 17/09/2026, journal : delivery-p6.md) : matrice page×filtre réellement exécutée ; A/B, empty scope, window UTC et changement d’heure Paris, to futur, range >30j, routes hostile/unknown, intersections widget. Les doubles modèles ne subsistent que sous wrappers de compatibilité testés.

### P6.3 — analyses prêtes à l’emploi et drill-downs (M)

- [ ] Home et `/pages` : tabs Route/Navigateur/OS/Pays/Appareil/Release avec count d’échantillons, LCP/INP/CLS et indication collecte. `/errors` : mêmes splits selon les dimensions réellement disponibles.
- [ ] `/sessions` : recherche bornée par ID technique exact, route normalisée, release ; pagination stable et tendance des visiteurs observés. Ne pas autoriser une recherche par identité brute dans une URL.
- [ ] Ressources : vue durée/taille/type/origine avec cap et avertissement « ressources collectées selon seuil SDK ». Le domaine de ressource nettoyé peut servir au split first/third party, selon allowlist d’origines app ; une URL arbitraire ne déclenche aucun fetch serveur.
- [ ] Longtasks/LoAF : série temporelle et liens vers sessions. Pas de somme des durées qui prétend être du temps utilisateur unique.
- [ ] Temps passé/bounce : n’afficher que si le dataset dispose de signal suffisant. Définition initiale `session_duration_observed = max(0,last_seen_at-started_at)` (estimation, pas temps actif) ; `single_view_session_rate = sessions avec exactement 1 vue / sessions avec >=1 vue` (libellé explicite, pas « rebond » sans convention). Inclure seules sessions commencées dans fenêtre, indiquer les sessions encore actives.
- [ ] Les barres/tableaux cliquables ouvrent la surface détail avec même range et filtre additionnel ; états clavier et texte alternatif vérifiés.

### P6.4 — Explorer générique (L)

- [ ] Implémenter registre dataset/champs, validation AST et SQL paramétré. Les identifiants SQL proviennent exclusivement du registre interne.
- [ ] Faire tourner tables/total/groupes/tendances sur population commune et snapshot cohérent. Le journal paginé ne sert jamais à calculer les graphes.
- [ ] Endpoint `POST /api/v1/explorer/query` : même auth read-only que GET, corps validé ≤32 Kio, résultat borné ; query timeouts →503 `query_budget_exceeded`, jamais une série de zéros.
- [ ] Endpoint `GET /api/v1/explorer/schema` : registre public de capacités filtré par rôle, sans valeurs clients ; consommé par builder UI et MCP. Il ne révèle ni tables SQL ni secrets.
- [ ] UI `/explorer` : dataset → mesure → filtres → groupBy → représentation table/toplist/série/valeur ; bouton Exécuter explicite, pas une requête à chaque frappe. Résumé en français des filtres effectivement appliqués, reset du curseur à tout changement.
- [ ] « Enregistrer dans un dashboard » uniquement avec droits ; AST canonique, sans matérialiser les données résultats.
- [ ] MCP `mip_rum_query_explorer` : même AST, mêmes erreurs, read-only. Les outils existants P4/P5 gardent leurs descriptions et contrats.

Recette : nom de colonne hostile, cast JSON, champ sensible absent du catalogue, 2 dimensions dont valeurs contiennent des séparateurs, top stable sur plusieurs buckets, timeout, curseur falsifié/change range, zéro résultat réel et percentile null.

### P6.5 — dashboards graphiques, ownership et vues enregistrées (L)

- [ ] Étendre la config `Widget` avec `schemaVersion:2`, `query` AST et `visualization`, `filters` additionnels, `rangeOverride` optionnel borné. Préserver les six types v1 par adaptateur en lecture ; ne pas réécrire tous les layouts au chargement.
- [ ] Réutiliser les graphiques `LineTrend`, `RankBar`, `StackedBars` ; types temps série/toplist/table/valeur. Pas d’éditeur de formule libre.
- [ ] Ajouter propriétaire de dashboard via FK vers compte interne (résolution du `created_by` existant si compte connu, sinon legacy-owner-null). Admin peut gérer dans son scope ; propriétaire conserve seulement les droits déjà autorisés. Viewer/demo ne gagne aucun droit d’écriture. Préciser les actions dans `dashboard-access.ts` et tests.
- [ ] Ajouter clone (nouvel ID/propriétaire, même app autorisée), rename, ordre clavier, filtres par widget, `revision`/conflit 409. Ne pas masquer la disparition d’un widget invalide : carte diagnostic avec possibilité admin de corriger.
- [ ] Un `rangeOverride` est explicite et affiché sur la carte ; sans override le widget hérite de la fenêtre globale. Filtres globaux et locaux restent AND.
- [ ] Vues enregistrées de l’Explorer : table `analytics_saved_view(id,app_id,owner_id,name,query_json,revision,created_at,updated_at)`, schéma JSON versionné, max 50/user/app et nom ≤100. Lecture par propriétaire/admin autorisé, aucune vue globale publique créée implicitement. Partage app-wide hors périmètre initial.
- [ ] Export CSV utilise la même AST/permissions/fenêtre. Maximum 10 000 lignes, mention de troncature et échappement des cellules commençant par `= + - @` pour éviter exécution par un tableur. PDF = impression de la vue existante, sans service tiers.
- [ ] Charger max 4 widgets en parallèle, annuler requêtes périmées, cache court server scoped si pertinent. Pas de refresh 5 s de 24 requêtes lourdes.

API des saved views : `GET/POST /api/v1/explorer/views`, `PATCH/DELETE /api/v1/explorer/views/:id` avec app/name/query/revision selon opération. Écritures session uniquement et contrôle propriétaire+app ; read token n’expose pas les vues privées d’un opérateur. Dashboard conserve ses server actions et endpoint export existants, étendus plutôt que dupliqués.

### P6.6 — agrégats et performance (M)

- [ ] Mesurer EXPLAIN (ANALYZE, BUFFERS) sur base jetable représentative : tailles consignées, plusieurs apps et skew, traces de temps/mémoire. Objectifs initiaux de test : ≤2 s p95 à chaud pour 1M événements sur 7j par app, timeout SQL 5 s ; ajuster et documenter après mesure, pas une promesse de SLA prod.
- [ ] Timeouts transactionnels avec `SET LOCAL`; ne pas laisser des paramètres de session fuir via pooler. Borne AST/body/groupe/points appliquée avant SQL.
- [ ] Utiliser les rollups seulement si toutes les dimensions ET filtres demandés y existent. Un rollup sans browser ne répond jamais à browser=Firefox.
- [ ] Pour percentiles, fusionner histogrammes compatibles puis calculer quantile ; ne pas moyenner des p75. Si source canonique/denominator/filtre non représentés dans l’histogramme existant, lire brut borné ou renvoyer indisponibilité explicite.
- [ ] Hybridation raw/rollup : intervalles disjoints, pas de double comptage de l’heure en cours. Exposer `meta.source` et une approximation des histogrammes. Distinct users/sessions n’est pas une somme de distincts horaires ; calcul brut ou structure fusionnable prouvée.
- [ ] Invalidation sur ingestion tardive, purge et DSAR. P8 fait les historiques ; cette étape ne recalcule rien massivement en production.

## 5. Écrans et états

| Surface | Layout/interactions | États spécifiques |
|---|---|---|
| Header global | App + preset/custom range, drawer filtres secondaires, chips supprimables | Plage invalide près du champ ; to futur refusé ; scope corrigé annoncé |
| Home/pages/errors | Tabs breakdown au-dessus du graphe + tableau accessible | Sans samples : null/« Pas de mesure » ; pays estimé ; segments non supportés désactivés |
| `/explorer` | Builder en haut, synthèse requête, résultat dessous ; colonnes/facettes sur large écran | Premier affichage invite à Exécuter ; parsing 400 explicite ; timeout avec réduire période ; résultat partiel annoté |
| Dashboard | Header titre/owner/clone, grille responsive, configuration par carte | Carte invalide visible ; autorisation changée → contenu masqué ; conflit de revision → recharger |
| Vues enregistrées | Liste nom/app/date, ouvrir/renommer/supprimer selon droits | Vue legacy invalide éditable, pas supprimée silencieusement |

Sur chaque surface : loading sans faux total, empty réel, erreur récupérable, partial motivé et success. Pas de styles parallèles aux tokens existants. Requêtes éteintes lorsqu’onglet caché, focus clavier visible, reduced motion respecté.

## 6. Fichiers et tests

Modifier `apps/console/lib/{filters,segments,queries-v2,queries-events,queries,queries-dashboards,dashboards,widget-data,dashboard-access}.ts`, les autres `queries-*` par tranches déclarées, `components/{GlobalFilters,SegmentBar}.tsx`, `components/charts/*`, pages concernées, server actions dashboard/export, API OpenAPI/MCP. Ingestion : `otlp.mjs`, `pg-ingest.mjs`, `buildEventIndex`, migrations/rollups. Ajouter les cinq modules de contrat/compilateur décrits, `app/explorer/**`, routes et modèle saved views. Mettre à jour docs filtres et limites.

- [ ] `tests/unit/query-contract.test.ts` : compatibilité URL, scope vide, plage et DST, paramètres bornés, widget AND.
- [ ] `tests/unit/analytics-compiler.test.ts` : tous couples autorisés/interdits, JSON typing et aucune interpolation de valeur.
- [ ] `tests/integration/analytics-explorer-sql.test.ts` : totals/series/table identiques, A/B, données manquantes, raw/histogram limites et `distinct` non additionnable.
- [ ] Étendre tests dashboard-access/export/layout, segments et erreurs P5.
- [ ] `tests/e2e/analytics-explorer.spec.ts` et `dashboards-analytics.spec.ts` : UI→AST→résultat→save→reload→clone→CSV ; viewer/demo ; 390/768/1440 ; accès clavier.
- [ ] API et MCP mêmes fixtures/résultat ; ancienne API P4 stable ; résultat partiel jamais présenté comme exact.
- [ ] Bench limité/reproductible avec budget, taille et hardware consignés ; aucune donnée cliente copiée pour le benchmark.

## 7. Déploiement et terminaison

Dimensions/schema avant nouveaux lecteurs ; versionner layouts et AST ; garder l’adaptateur v1 pour rollback. Migration page par page, avec matrice des filtres cochée. P6 fini lorsque chaque surface annoncée applique ses filtres, les dashboards réouvrent v1/v2 et les chiffres/API/export concordent. L’Explorer générique ne garantit pas recherche de n’importe quelle clé arbitraire, formule libre ou scan sans limite.

Références : [Datadog — Search RUM Events](https://docs.datadoghq.com/real_user_monitoring/explorer/search/) et [Search Syntax / saved views](https://docs.datadoghq.com/real_user_monitoring/explorer/search_syntax/), consultées le 16/09/2026 : recherche, facettes/mesures et vues enregistrées sont les capacités comparées. Le produit MIP adopte son propre contrat borné, sans reproduire la syntaxe Datadog.
