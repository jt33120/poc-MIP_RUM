# Console MIP RUM — ce qu'un graphique peut afficher aujourd'hui, sans changement backend

Relevé le 18/09/2026 sur le HEAD de la session (`11e9f34`, « feat(rum): add custom events explorer »),
par lecture du code et des migrations, sans interroger aucune base. Les chemins sont relatifs à
`/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM/`, sauf mention contraire.

Ce document répond à une seule question : **quelle donnée existe, sous quelle forme, avec quelles
bornes, et quelle fonction ou route la sert** — pour que le plan frontend ne dessine que des graphiques
que le backend sait remplir. Il dit aussi ce qu'un graphique ne peut pas promettre.

Ce qu'il ne fait pas : il ne recette aucune donnée réelle. L'état de couverture
(`scratchpad/RUM_PARITY_STATUS.md` § 4) le rappelle : **zéro capacité éprouvée sur donnée réelle** ;
34 capacités sur 49 sont `deploye_non_eprouve`. Un graphique juste sur fixtures peut être faux sur du
trafic (§ 6.2 du même document).

## 0. Sources et méthode

| Source | Ce qui en a été lu |
|---|---|
| `apps/console/lib/query-contract.ts` | presets, dimensions, opérateurs, bornes, résolution de plage et de périmètre |
| `apps/console/lib/query-compiler.ts` | 11 jeux de données, colonnes des dimensions, seaux UTC |
| `apps/console/lib/analytics-schema.ts` | registre de l'Explorer : 9 jeux mesurables, mesures, agrégations, représentations, limites |
| `apps/console/lib/analytics-rollups.ts` | 2 agrégats déclarés, 1 seul utilisable, règle d'emploi |
| `apps/console/lib/queries*.ts` (46 fichiers) | squelette de chaque fichier, interfaces de retour, tables citées |
| `apps/console/lib/surfaces.ts` | quelles pages appliquent une plage personnalisée et quelles dimensions |
| `apps/console/lib/dashboard-blocs.ts`, `dashboards.ts`, `widget-data.ts` | blocs d'écran et widgets de tableau de bord |
| `docs/API_CONSOLE.md` | contrat des routes `/api/v1/*`, correspondance graphe → endpoint |
| `apps/ingest/sql/schema.sql` + `migration-v02…v85.sql` | tables et colonnes (via `grep`, pas lecture intégrale) |
| `scratchpad/RUM_PARITY_STATUS.md` | 49 capacités et verdicts |
| `apps/console/components/charts/` | les 12 représentations déjà codées (recharts 2.15.4, `apps/console/package.json:20`) |
| Datadog | `https://www.datadoghq.com/dg/real-user-monitoring/overview/`, `https://docs.datadoghq.com/real_user_monitoring/explorer/visualize/`, `https://docs.datadoghq.com/real_user_monitoring/product_analytics/` |
| Captures Datadog | dossier `/Users/juliantalou/Downloads/datadog screenshots and videos /` : **seule `dd_platform_260623_en.png.webp` a pu être affichée** (schéma de plateforme, pas un graphique RUM). Les cinq `.png.jxl` / `.jpeg.jxl` (`datadog-rum-views-explorer`, `newerrortrackingimage`, `newoptimizeperformanceimage`, `newrumperformanceimage`, `enhanceenduserimage`) ne sont pas lisibles par l'outil (flux binaire). Les trois `.mp4` n'ont pas été ouverts. |

Conventions : « non établi » signale ce que ce relevé n'a pas pu vérifier. « Inconnu » est la valeur
d'affichage d'une dimension à `NULL` (`query-contract.ts:L74`, opérateur `is_null`) — jamais une
chaîne.

---

## 1. Le socle commun : ce que toute lecture partage

### 1.1 Plage et seaux temporels

| Règle | Référence |
|---|---|
| Presets : `1h`, `24h`, `7d` (`7j` toléré, valeur inconnue = `24h`) | `query-contract.ts:L15`, `resolveRange` L267-303 |
| Plage personnalisée : `from`/`to` ISO UTC explicites, `from < to ≤ maintenant`, **30 jours au plus** ; preset ET from/to = refus `range_conflict` | `query-contract.ts:L25` (`RANGE_MAX_MS`), L267-303 |
| Largeur de seau dérivée de la durée : ≤ 1 h → 5 min ; ≤ 24 h → 1 h ; ≤ 7 j → 6 h ; au-delà → 24 h | `bucketSecondsFor`, `query-contract.ts:L230-235` |
| **300 points au plus** par série, seaux de bord partiels compris | `MAX_POINTS`, `query-contract.ts:L27` ; `bucketStarts` L241-250 |
| Seaux alignés sur une origine **UTC** (`date_bin`), série complète avec zéros | `query-compiler.ts:L302-328` (`bucketExpr`, `bucketSeriesSql`) |
| Période précédente contiguë pour les deltas (`previousRange`, `relativeChange`) | `query-contract.ts:L306-316` |
| Rétention de l'ingestion : `RETENTION_DAYS` (défaut 30) ; au-delà, `meta.coverage` de l'Explorer dit `partial`/`unknown` | `queries-explorer.ts:L86-89`, L179-186 |

Conséquence pour un graphique : une plage de 30 jours ne donne **jamais** plus de 30 points
quotidiens ; une plage de 7 jours donne 28 points de 6 h. Il n'existe pas de seau « 15 min » ni « 1 j
sur 7 j » sans changer `bucketSecondsFor`.

### 1.2 Périmètre d'apps

Le périmètre est résolu **contre le principal signé**, jamais depuis l'URL (`resolveScope`,
`query-contract.ts:L192-203`). `app=all` = toutes les apps autorisées lues ensemble ; une app hors
périmètre = `403 forbidden_app` ; un viewer sans app = `403 no_app_access`. `[]` vaut zéro accès, plus
« sans restriction » (`RUM_PARITY_STATUS.md` D6).

### 1.3 Dimensions et filtres

Onze dimensions (`query-contract.ts:L31-48`), trois opérateurs `eq | neq | is_null` (L74), **10
conditions au plus** (L78), 500 caractères par valeur (L80).

| Dimension | Portée | Colonne | Depuis | Note |
|---|---|---|---|---|
| `device` | session | `rum_session.device_type` | v0.1 | `desktop \| mobile \| tablet` ; iPadOS 13+ compté desktop (parity B2) |
| `browser`, `os` | session | `rum_session.browser`, `.os` | **v75** | `NULL` avant v75 → « Inconnu » ; `browser_version` / `os_version` existent (v75 L54-58) mais **ne sont pas des dimensions** |
| `country` | session | `rum_session.geo_country` | v0.1 | libellé imposé « Pays estimé » (`DIMENSION_LABELS`, L61) ; ni ville ni région |
| `country_source` | session | `rum_session.geo_source` | **v85** | `geoip \| timezone \| cdn` (`geo.ts:L27`) ; `NULL` = historique |
| `client`, `source` | session | `client_id`, `collection_source` (`sdk \| extension`) | v0.1 / v27 | |
| `route`, `release`, `env` | **occurrence** | colonne de la ligne (`rum_pageview`, `rum_metric`, `rum_error`, `rum_action`, `rum_resource`, `rum_longtask`, `rum_event`, `rum_span`, `rum_event_index`) | v75 (release sur `rum_error` : v13/v69) | la release de la session est mutable : elle ne s'applique jamais au passé (`query-compiler.ts:L69-78`) |
| `service` | occurrence | `rum_error.service`, `rum_span.service`, `rum_event_index.service` | v69 / v75 | `NULL` pour les SDK RUM MIP ; seul un émetteur backend le déclare |

Une dimension que le jeu ne porte pas, ou dont la colonne manque dans le schéma déployé, est
**refusée** (`unsupported_dimension`), jamais ignorée (`dimensionSupport`, `query-compiler.ts:L165-187`).

### 1.4 Jeux de données du contrat (11)

`query-compiler.ts:L21-33` et `DATASET_REGISTRY` L80-143 :

| Jeu | Table | Session jointe | Dimensions d'occurrence |
|---|---|---|---|
| `sessions` | `rum_session` | — | aucune (dimensions de session seulement) |
| `views` | `rum_pageview` | oui | route, release, env |
| `vitals` | `rum_metric` | oui | route, release, env |
| `errors` | `rum_error` | oui | route, release, env, **service** |
| `events` | `rum_event_index` | oui | route, release, env, **service** |
| `custom_events` | `rum_event` | oui | route, release, env |
| `actions` | `rum_action` | oui | route, release, env |
| `longtasks` | `rum_longtask` | oui | route, release, env |
| `resources` | `rum_resource` | oui | route, release, env |
| `spans` | `rum_span` | oui | route, release, env, **service** |
| `synthetic` | `syn_snapshot` | **non** | `route` seulement (`route_hint`, L136-140) |

### 1.5 Surfaces : quelle page applique quoi

`surfaces.ts:L53-137`. Deux familles de lecture coexistent :

- **Lectures sur le contrat** (`sqlContext(f)` → `where()` compilé) : `queries.ts`, `queries-actions`,
  `queries-breakdowns`, `queries-deploys`, `queries-experience`, `queries-frustration`, `queries-grid`,
  `queries-longtasks`, `queries-map`, `queries-resources`, `queries-sessions`, `queries-tracing`,
  `queries-v2` (corrélation) — plage personnalisée et 11 dimensions.
- **Lectures historiques** (`now() - interval` sur `PERIODS[f.period]`, `filters.ts:L29-35`) :
  `queries-acquisition`, `queries-form-analytics`, `queries-funnel`, `queries-goals`, `queries-cohorts`,
  `queries-paths`, `queries-logs`, `queries-svi`, `queries-v2` (alertes) — **presets seulement**, et
  seulement `device` (desktop/mobile), `country`, `country_source`, `client`, `source`
  (`LEGACY_DIMENSIONS`, `surfaces.ts:L50`) pour les `legacy: "segments"`, l'app et la période seules
  pour `period-only`.

| Page | Plage | Jeux | Particularité |
|---|---|---|---|
| `/` | custom | vitals, views, errors, sessions | heatmap 14 j et anomalies 24 h gardent leur fenêtre fixe |
| `/explorer` | custom | choisi par l'utilisateur | validation contre le jeu réellement choisi |
| `/errors`, `/errors/…` | custom | errors | |
| `/events` | custom | events | |
| `/actions` | custom | actions | |
| `/mobile` | custom | views, errors, custom_events, spans | **`only: device, os, release`** — route/service refusés (taux sur cohorte) |
| `/ux` | custom | custom_events, vitals, longtasks | |
| `/pages` | custom | views, vitals, longtasks, resources | |
| `/sessions` | custom | sessions, views | `/sessions/:id` : aucun filtre (« une session s'affiche en entier ») |
| `/correlation` | custom | vitals, synthetic | |
| `/map` | custom | spans, vitals | |
| `/experience` | custom | custom_events, vitals, sessions | |
| `/tracing` | custom | spans | `/tracing/:id` : aucun filtre |
| `/dashboards/:id` | custom | vitals, views, longtasks, errors, custom_events, events | le widget « Trafic » reste sur 14 j fixes |
| `/slo`, `/alerts`, `/dashboards` | none | — | chaque SLO/règle a sa propre fenêtre ; seule l'app filtre |
| `/paths`, `/forms`, `/goals`, `/acquisition`, `/retention` | **presets** | sessions | `legacy: segments` |
| `/logs`, `/ai`, `/forecast`, `/svi`, `/svi/…` | **presets** | — | `legacy: period-only` |

Sur une plage personnalisée, une lecture historique retombe sur le preset **de même largeur de seau**
(`periodOf`, `filters.ts:L99-103`) : la surface l'annonce comme non appliqué (`checkSurface`,
`surfaces.ts:L204-214`). Un graphique de ces pages doit afficher la fenêtre réellement lue.

### 1.6 L'Explorer : ce qu'on peut mesurer, agréger, représenter

Registre fermé `analytics-schema.ts:L217-550` ; bornes L50-56 : **2 dimensions de regroupement, 50
combinaisons au total, 200 lignes de journal (50 par défaut), 32 Kio de corps**.

Agrégations (L61) : `count | sum | avg | p75 | p95 | distinct`. Représentations (L64) :
`value | toplist | timeseries | table`. Additives : `count`, `sum` seulement (`estAdditive`, L88-90).

| Jeu | Population | Variante (colonne) | Mesures (agrégations) | Colonnes du journal |
|---|---|---|---|---|
| `custom_events` (L218) | événements reçus | `type` = `custom \| timing` (`event_type`, `NULL` = custom) | `rows` (count) · `sessions` (distinct) · `identified_users` (distinct `user_id_hash`) · `timing_ms` (sum/avg/p75/p95, variante `timing` seulement) · `prop` (propriété JSON **numérique** : sum/avg/p75/p95) | date, name, type, route, session |
| `errors` (L269) | occurrences reçues | — | `occurrences` (**sum** de `rum_error.occurrences`) · `sessions` · `visitors` (distinct `visitor_id`, garde `id_kind='random'`) · `identified_users` | date, error_type, error_source, occurrences, route, fingerprint, session |
| `views` (L305) | vues commencées | — | `rows` (count) · `sessions` | date, route, nav_type, session |
| `sessions` (L325) | sessions observées | — | `started` (count, dans la fenêtre) · `active` (count, chevauchement, **non seau-able**) · `visitors` | start, last_seen, device, country, country_source, page_count, session |
| `vitals` (L371) | mesures reçues | `metric` **obligatoire** = `LCP \| INP \| CLS \| FCP \| TTFB` (`name`) | `rows` · `value` (avg/p75/p95) · `sessions` | date, name, value, rating, route, session |
| `resources` (L406) | ressources collectées | — | `rows` · `duration_ms` (avg/p75/p95) · `transfer_size` (sum/avg/p75/p95) · `sessions` | date, type, duration_ms, transfer_size, route, session |
| `longtasks` (L439) | blocages observés | `api` = `longtask \| loaf` (`source`) | `rows` · `duration_ms` (sum/avg/p75/p95) · `blocking_ms` (idem) · `sessions` | date, source, duration_ms, blocking_ms, route, session |
| `actions` (L488) | actions observées | `type` = `click \| manual` | `rows` · `sessions` | date, name, type, route, session |
| `spans` (L519) | segments reçus | `tier` = `front \| back \| detail` | `rows` · `duration_ms` (avg/p75/p95) · `sessions` | date, name, tier, kind, duration_ms, status_code, route, session |

Absents du registre, donc **non mesurables dans l'Explorer** : `events` (`rum_event_index`, réservé au
journal `/events`) et `synthetic`. Le **nom** d'un événement, d'une action, d'une ressource ou d'un
span n'est pas une dimension : on ne peut pas grouper par nom dans l'Explorer (seulement filtrer le
journal `/events` par nom, `parseEventName`, `queries-events.ts:L88`).

Garanties de la réponse (`docs/API_CONSOLE.md` L559-624 ; `queries-explorer.ts:L229-340`) : total,
groupes et série calculés sur **une seule population** dans un seul instantané `repeatable read` ;
groupes de la série choisis **une fois** sur toute la fenêtre puis rendus dans tous les seaux ;
`meta.truncated_groups` ; seau vide = `0` seulement si additif, sinon `null` ; dépassement de budget =
`503 query_budget_exceeded`, jamais une série de zéros.

### 1.7 Agrégats pré-calculés

`analytics-rollups.ts:L100-170`, deux sources déclarées, **une seule utilisable** :

| Agrégat | Table | Grain | Dimensions | Répond à | Statut |
|---|---|---|---|---|---|
| `vitals_histogram` (L101) | `metric_histogram_hourly` (v61) + `metric_histogram_state` | 1 h | `device` seulement | `vitals.value` en `p75`/`p95`, `value` et `toplist` seulement (pas la série), variante obligatoire | **utilisable** si le schéma porte `COLONNES_HYBRIDE` (L314-325) ; percentile **approché** (seaux log-linéaires GAMMA = 1,02, `histogramme.ts:L28`), `meta.approximate = true` |
| `traffic_hourly` (L136) | `rum_rollup_hourly` (v12/v64) | 1 h | `device` | `views.rows` count, `errors.occurrences` sum | **jamais lu par l'Explorer** : inclut les robots, aucun filigrane (L138-146, `rollupCapability` L286-305 le masque) ; lu par `healthGrid`/`dailyTraffic` uniquement sous `RUM_USE_ROLLUPS=1` et sans autre filtre que `device` (`queries-grid.ts:L24-36`) |

Un `distinct` n'est jamais servi par un agrégat (L40-46). La partition brut/agrégat est prouvée par
deux bornes (temps + `max_metric_id`, v61 L88-135) : aucune ligne comptée deux fois.

### 1.8 Représentations déjà codées côté console

`apps/console/components/charts/` : `Donut`, `ForecastChart`, `Gauge`, `HealthHeatmap`, `LineTrend`,
`ObservedTrend`, `RadarScore`, `RankBar`, `ScatterPlot`, `StackedBars`, `TrafficTimeseries`,
`VitalsTimeseries`. Hors dossier : `Sankey.tsx`, `Funnel.tsx`, `Distribution.tsx`, `Breakdown.tsx`,
`SegmentBar.tsx`, `SupervisionHero.tsx`, `features/RobotVsRealChart.tsx`. Bibliothèque : recharts 2.15.4.

Widgets de tableau de bord : v1 `vital_p75 | traffic | slow_routes | top_errors | frustration |
event_count` (`dashboards.ts:L39-46`), v2 « analytics » = n'importe quel AST Explorer
(`widgetFromPlan`, L261-282) ; **24 widgets au plus** (L56), 4 lectures simultanées, pas de
rafraîchissement automatique (parity B6). Export CSV : 10 000 lignes, troncature écrite dans le fichier
(`widget-data.ts:L449-516`, parity B8).

---

## 2. (A) Catalogue « donnée → graphiques possibles », par signal

Lecture des colonnes : **Mesure** = ce qui est calculé ; **Dimensions** = ce qu'on peut filtrer ou
grouper ; **Grain** = découpage temporel disponible ; **Servi par** = fonction (`fichier:Lnn`) et
route ou page ; **Graphique** = ce que le front peut dessiner **sans nouvelle requête** ; **Ne garantit
pas** = la limite à écrire à côté du graphique.

### 2.1 Sessions

Table `rum_session` (`schema.sql:L7-21` + v23 `is_bot`, v27 `collection_source`, v53 `release`,
`net_type`, v57 `visitor_id`, `id_kind`, v58 `sample_rate`, `error_sample_rate`, `has_error`,
`weight`, v66 `user_id_hash`, `account_id_hash`, `context`, v75 `browser*`, `os*`, v82 `runtime`,
v85 `geo_source`, `geo_db_version`).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Sessions commencées / actives (chevauchement) / visiteurs distincts | les 7 de session | seaux du contrat (`started` seulement ; `active` **non seau-able**) | Explorer `sessions` (`exploreAnalytics`, `queries-explorer.ts:L229`) ; `POST /api/v1/explorer/query` | KPI, toplist (≤ 50 groupes, 2 dims), série des sessions commencées | `active` n'est pas comparable à `started` (`analytics-schema.ts:L343-355`) ; visiteurs = `id_kind='random'` seulement |
| Sessions, pages vues, erreurs de la fenêtre + période précédente | contrat | fenêtre entière | `overviewStats(f, shift)` `queries.ts:L124` ; `GET /api/v1/overview` | tuiles KPI avec delta | l'erreur comptée est une ligne `rum_error`, pas `sum(occurrences)` (non établi : vérifier la requête avant d'afficher un delta d'occurrences) |
| Visiteurs distincts par seau + sessions par seau + sessions sans identifiant | contrat | seaux du contrat | `observedVisitorsTrend(f)` `queries-sessions.ts:L68` ; page `/sessions` | `ObservedTrend` (existe) | les visiteurs **ne s'additionnent pas** d'un seau à l'autre (`VisitorsBucket`, L50-58) |
| Nouveaux / revenants / non identifiés ; visites (coupure 30 min, `sessions.ts:L10`) | contrat | fenêtre | `visitStats(f)` `queries.ts:L597` ; `/sessions` | donut à **trois** parts (la part « inconnu » est obligatoire) | revenant = déjà vu **sur cette app** par `visitor_id` ; l'historique avant le 09/09/2026 est « inconnu » |
| Durée observée p50/p75 (s), part des sessions à une vue, encore actives | contrat | fenêtre | `engagementStats(f)` `queries-sessions.ts:L20` ; `engagement.ts:L26-38` | KPI ; affiché seulement si `engagementSuffisant` | la durée est l'écart première/dernière observation, pas un temps passé |
| Liste des sessions (appareil, pays estimé + provenance, UA, vues, routes, erreurs) | contrat + recherche exacte (id, route, release : `sessions-search.ts`) | curseur stable `ts,id` | `listSessions(f, page)` `queries.ts:L363` ; `GET /api/v1/sessions` | table paginée ; la console s'arrête à 50 lignes | aucune recherche par motif ni par identité (parity B3) |
| Détail : méta + timeline fusionnée (`pageview, vital, error, breadcrumb, longtask, event, action, resource, api`) | aucun filtre | événement par événement | `sessionMeta(id)` L413, `sessionTimeline(id)` L441 ; `GET /api/v1/sessions/{id}` | frise chronologique ; lit `rum_pageview, rum_metric, rum_error, rum_breadcrumb, rum_longtask, rum_event, rum_action, rum_resource, rum_span` | pas de durée de vue ; `value`/`rating` seulement pour les vitals |
| Rétention hebdomadaire (cohortes, `visitor_id` non nul) | legacy segments | **semaine** (`WEEK_SECONDS`, `queries-cohorts.ts:L24`), `weeks` paramètre | `retentionCohorts(f, weeks)` L27, `buildCohorts` (`cohorts.ts:L26-60`) ; `/retention` | matrice cohorte × décalage | presets seulement ; robots exclus ; visiteurs mobiles surestimés (parity C3) |
| Acquisition : canal (`direct \| internal \| search \| social \| referral`) et top referrers, sur la **première vue** de chaque session | legacy segments | fenêtre preset, plafond 20 000 sessions | `acquisition(f, cap)` `queries-acquisition.ts:L14` ; `acquisition.ts:L32-88` ; `/acquisition` | donut canaux, classement referrers | classement par domaine du referrer, sans UTM (non établi : `classifyChannel` ne lit que `hostOf`) |
| Usage mensuel par tenant (événements, sessions, erreurs, quota) | — | jour (`tenant_usage_daily`) | `monthlyUsage()` `queries-usage.ts:L15` ; `/admin/usage` | barres par app | métering pg_cron : pas de série intra-mois exposée |

### 2.2 Vues de page

Table `rum_pageview` (`schema.sql:L23-33` : `route`, `url`, `referrer`, `nav_type`, `started_at` ;
v75 `env`, `release`).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Vues, sessions distinctes | contrat | seaux du contrat | Explorer `views` ; journal `date, route, nav_type, session` | série, toplist par route/navigateur/… , KPI | **aucun temps passé** (`analytics-schema.ts:L322`) |
| Vues + erreurs par **jour** sur 14 j (fuseau de l'app) | `device` seulement si rollup ; sinon contrat | jour | `dailyTraffic(f)` `queries-grid.ts:L110` ; `GET /api/v1/health-grid` | `TrafficTimeseries` (aire + ligne) | fenêtre **fixe 14 j** (`GRID_DAYS` L17), jours découpés dans le fuseau de l'app (L108-112) |
| Routes les plus lentes : `views`, `lcp_p75`, `inp_p75`, `cls_p75`, `longtasks` | contrat | fenêtre | `slowRoutes(f)` `queries.ts:L207`, plafond `ROUTES_MAX = 200` (L178), `nombreDeRoutes` L255 ; `GET /api/v1/pages` ; `/pages` | `RankBar` par LCP coloré par `rating2026` | le plafond est annoncé (`tronque`) ; FCP/TTFB par route passent par l'Explorer |
| Transitions route → route, entrées, sorties | legacy segments | fenêtre preset | `routeTransitions(f, 50)` `queries-paths.ts:L23`, `entryExitRoutes(f, 15)` L52 ; `sankey.ts:L40` ; `/paths` | `Sankey` (existe) | presets seulement |
| Objectifs (pageview ou event, `exact \| contains`) : conversions et taux sur les sessions de la fenêtre | legacy segments | fenêtre preset | `listGoals`, `goalConversions(f)` `queries-goals.ts:L16, L69` ; `/goals` | barres taux par objectif | presets ; `contains` = sous-chaîne, pas un motif |

### 2.3 Web Vitals et phases réseau

Table `rum_metric` (`schema.sql:L35-47` : `name`, `value`, `rating`, `attribution jsonb`, `route`,
`pageview_id` ; v51 `call_id` ; v58 `metric_uid` ; v75 `env`, `release`). `name` est du texte
libre : outre les cinq vitals, il porte les phases réseau `REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE`
(`rating.ts:L16-19`, bloc « Décomposition réseau » `dashboard-blocs.ts:L48`, `app/page.tsx:L299`), les
métriques SVI (v51) et les démarrages mobiles (`js_start_to_first_screen_ms`,
`js_warm_start_to_first_screen_ms`, `queries-mobile.ts:L38-39`). **Toute lecture « vitals » doit
filtrer sur le nom** (`CORE_VITALS`, `rating.ts:L34` ; `mip_core_vitals()` v56). Seuils 2026 :
`rating.ts:L5-11` (LCP 2500/4000, INP 200/500, CLS 0,1/0,25, FCP 1800/3000, TTFB 800/1800).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| p75, p50, n par vital ; période précédente | contrat | fenêtre | `vitalsP75(f, shift)` `queries.ts:L46` ; `GET /api/v1/overview`, `GET /api/v1/vitals` | `VitalCard` / jauges avec delta | percentile **non pondéré** par `weight` (voir `queries-histogramme.ts:L1-15`) |
| p50/p75/p90/p95/p99 par vital | contrat | fenêtre | `vitalPercentiles(f)` L75 ; `/pages` | tableau de percentiles | idem |
| Histogramme d'un vital (`nbuckets` seaux linéaires jusqu'à `cap`) | contrat | fenêtre | `vitalHistogram(f, name, cap, nbuckets)` L96 ; `histogramBins` (`distribution.ts:L35`, `HISTO_BUCKETS = 20` L21) ; `/pages` | `Distribution` (existe) | seaux linéaires bornés par `cap`, pas log ; non exposé par `/api/v1` |
| Série p75 d'un vital | contrat | seaux du contrat | `vitalSeries(f, name)` L150 ; `GET /api/v1/vitals?series=LCP,INP` (`all` = 5) | `VitalsTimeseries` avec lignes de seuil | |
| p75 LCP par **jour** sur 14 j | contrat | jour (fuseau app) | `dailyLcpSeries(f)` `queries-grid.ts:L176` ; `/`, `/forecast` | `ForecastChart` + `linfit` / `etaToThreshold` (`forecast.ts:L14-59`) | ajustement linéaire : c'est une tendance, pas une prévision |
| Valeur d'un vital nommé : `count`, `avg`/`p75`/`p95`, sessions ; groupé par 2 dimensions | contrat | seaux du contrat | Explorer `vitals` (variante obligatoire) ; p75/p95 en `value`/`toplist` peuvent venir de `metric_histogram_hourly` (approché à ≈ 1 %) | KPI, toplist (par route, navigateur, OS, pays, appareil, release, env), série | la **série** reste sur le brut (rollups L112-120) ; CLS/INP = une valeur par chargement (L397) |
| Découpage LCP/INP/CLS p75 + `samples` par `route \| browser \| os \| country \| device \| release` | contrat | fenêtre | `vitalsBreakdown(f, dim)` `queries-breakdowns.ts:L79`, `BREAKDOWN_CAP = 12` (`breakdowns.ts:L38`) ; `/`, `/pages` | `Breakdown` (existe), chaque groupe ouvre le détail filtré (`breakdownDrillHref`) | 12 groupes rendus, « Inconnu » compté à part, **pas de groupe « Autres »** (un p75 ne s'additionne pas) |
| Part de mesures `good` (LCP × 2) par jour × heure sur 14 j | contrat (rollup si `device` seul) | heure | `healthGrid(f)` `queries-grid.ts:L60` ; `GET /api/v1/health-grid` | `HealthHeatmap` (existe) | fenêtre fixe 14 j ; pondération LCP × 2 (`health.ts:L2-3`) |
| Percentile **pondéré** par `weight` (population, pas échantillon) | app seulement | fenêtre `24h \| 7d \| 30d` | `percentilesPonderes(app, interval, noms, p)` `queries-histogramme.ts:L92` ; `rumSummary` → `GET /api/rum/summary` (`p75_lcp_ms`, `p75_inp_ms`) | KPI partenaire | aucune dimension ; hybride agrégat + vif |
| Éléments responsables d'INP (`attribution->>'interactionTarget'`) : n, p75, pire | contrat | fenêtre | `inpOffenders(f)` `queries-frustration.ts:L52` ; `/ux` | classement, `ScatterPlot` | 20 lignes ; `attribution` non nul seulement |
| Anomalies LCP (z-score > 3 vs moyenne 7 j, par route, par heure) | app seulement | heure, **24 h fixes** | vue `v_anomaly` (`migration-v03.sql:L70-85`) via `healthScore` (`health.ts:L184-196`) | liste / marqueurs sur la série LCP | ≥ 5 heures d'historique et écart-type > 0 requis |
| Comparaison par version : sessions, LCP, INP, erreurs, sessions en erreur | contrat | fenêtre | `comparaisonVersions(f, 12)` `queries-deploys.ts:L162` ; `/` (bloc « versions ») | `VersionsTable` | source `occurrence` (v75) ou `session` ; **même fenêtre, sans normalisation de trafic** (`dashboard-blocs.ts:L73-77`) |

### 2.4 Erreurs et issues

Table `rum_error` (`schema.sql:L49-65` + v02 `fingerprint`, v13 `release`, v59 `occurrences`, v64
`ingested_at`, v67 `action_id`, v69 `trace_id`, `source_parent_span_id`, `error_source`, `handled`,
`is_fatal`, `context`, `view_id/name`, `user_id_hash`, `account_id_hash`, `env`, `service`, v70
`origin_signal`, `exception_id`, v71 `symbolication_status`, `stack_symbolicated`, v72
`grouping_version`, `grouping_key`). Tables satellites : `error_status` (v40), `error_issue`,
`error_issue_alias`, `error_grouping_config` (v72), `error_issue_ticket`, `error_issue_activity`,
`error_issue_notification` (v73), `rum_new_error_watermark` (v64). `error_source` fermé :
`browser_js, browser_console, browser_resource, browser_csp, browser_network, node, python,
react_native_js, native, otel` (`queries-errors.ts:L40-51`).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Groupes `(app_id, fingerprint)` : `occurrences` (sum), `sessions_affected`, `visitors_affected`, `identified_users_affected`, couvertures, `first_seen`, `last_seen`, `status`, `regressed` ; `totals` ; `trend` ; `series` par groupe (option) | contrat, dont `service`, `env`, `release`, `route` | seaux du contrat (`trendSql`, L682-695) | `listErrorGroups(f, page, {series})` `queries-errors.ts:L825` ; `GET /api/v1/errors` ; `/errors` | barres top groupes, série des occurrences, **barres empilées par groupe** (avec `series`, non exposé par l'API : `API_CONSOLE.md:L751-757`) | échantillonnage biaisé (`sampling`), comptes observés jamais extrapolés ; `null` = personne de connu, pas zéro ; `first_seen` seul champ hors fenêtre |
| Découpage des occurrences, sessions, signatures par `route \| browser \| os \| country \| device \| release` | contrat | fenêtre | `errorsBreakdown(f, dim)` `queries-breakdowns.ts:L119` ; `/errors` | `Breakdown` | 12 groupes rendus |
| Détail d'un groupe : dernier exemplaire, occurrences paginées par curseur, liens session/rejeu/trace/span parent/action, tendance | contrat | seaux | `errorGroupDetail(ref, f, page)` L920, `resolveErrorGroup` L893 ; `GET /api/v1/errors/{fingerprint}` | table + série + liens | un lien n'existe que dans la **même** app (parity A1) ; pile non symboliquée visible avec sa raison |
| Issues (identité durable v2) : liste, détail, activité, tickets | contrat | seaux | routes `GET /api/v1/issues*` (`lib/error-issues.ts`, `error-issue-workflow.ts`, hors `queries-*`) | liste triée, `coverage` (`active_apps`, `issue_share`) | **regroupement v2 activé pour aucune app** (parity A7) ; `reappeared` ≠ régression confirmée |
| Erreurs par version (sessions en erreur / sessions) | contrat | fenêtre | `comparaisonVersions` (ci-dessus) | barres taux par version | |
| Impact du dernier déploiement : LCP et erreurs avant/après | contrat | avant/après | `latestDeployImpact(f)` `queries-deploys.ts:L61`, `assessRegression` L103 ; `DeployPanel` | carte avant/après | ratio 1,2 codé en dur |
| Score de santé : 40 % vitals, 30 % erreurs/vues, 20 % sessions sans erreur, 10 % anomalies | contrat (anomalies : app seule, 24 h fixes) | fenêtre | `healthScore(f)` `health.ts:L138`, `dominantFactors` L267 ; `GET /api/v1/overview` | `Gauge` + facteurs | composante sans donnée exclue et renormalisée ; tout vide → `null` |

### 2.5 Actions

Table `rum_action` (`migration-v67.sql:L6-25` : `action_id`, `type` `click \| manual`, `name`,
`route`, `context`, `ts`) ; enfants rattachés par `action_id` sur `rum_error`, `rum_resource`,
`rum_span`, `rum_breadcrumb` (v67 L83-87).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Top actions : `actions`, `sessions`, `errors`, `error_clicks`, `resources`, `api_calls`, `resource_ms`, `api_ms`, `total_ms`, `last_seen` ; résumé sur toute la fenêtre | contrat | fenêtre | `topActions(f, page)` `queries-actions.ts:L175`, `topActionsSummary(f)` L202, `actionCtes` L61-168 (agrège `rum_error`, `rum_resource`, `rum_span` par `action_id` avant jointure) ; `GET /api/v1/actions` ; `/actions` | classement déterministe (erreurs, temps lié, volume), barres empilées ressource/API | volumes de l'échantillon (`sampling_notice`) ; « temps lié » ≠ durée de l'action |
| Actions, sessions distinctes ; variante `click \| manual` | contrat | seaux | Explorer `actions` | série, toplist par route/appareil/… | pas de causalité reconstruite (`analytics-schema.ts:L513`) ; **pas de groupe par nom** |
| Signaux de frustration (`rage`, `dead`, `error`) par route et cible | contrat | fenêtre | `topFrustrations(f)` `queries-frustration.ts:L19` (lit `rum_event` nommé `frustration.*`) ; `/ux` ; widget `frustration` | classement | non établi : le SDK web émet-il `frustration.rage`/`dead` en production (aucune donnée réelle) |

### 2.6 Événements : journal unifié et événements custom

`rum_event_index` (`migration-v65.sql:L9-40`) : projection append-only `kind ∈ {pageview, vital,
error, resource, longtask, breadcrumb, event, span}`, `source_name` fermé, **depuis v65 sans backfill**
(≈ 97 lignes `rum_event` non projetées, parity D9). `rum_event` (`migration-v02.sql:L49-60` + v66
`event_type`, `context`, `user_id_hash`, `account_id_hash`, `view_id/name`, `action_id`, `timing_ms`,
`feature_flag_value`, v75 `env`, `release`).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Journal paginé (`kind`, `name`, attribut `props`/`context` typé), `total`, `trend`, facettes noms / attributs / valeurs, `sampling_notice`, `enrichment` | contrat + `kind`, `name`, 1 attribut | seaux du contrat | `exploreEvents(f, query, page, cursor)` `queries-events.ts:L284` ; `GET /api/v1/events` (projection minimale, `limit ≤ 200`, offset ≤ 10 000) ; `/events` | série des événements filtrés, facettes en barres, table | la projection ne contient ni props ni message (`API_CONSOLE.md:L430-436`) ; `enrichment.available` dit si `rum_event` (P4) est joignable |
| Nombre d'un événement nommé | contrat | fenêtre | `eventCount(f, name)` L407 ; widget `event_count` ; `ReplayPlayer` | KPI | |
| Événements custom : `rows`, sessions, utilisateurs identifiés, `timing_ms` (variante `timing`), propriété JSON numérique (`prop`) | contrat, 2 dims | seaux | Explorer `custom_events` | série, toplist, KPI | `prop` écarte les valeurs non numériques (L246-251) ; **pas de groupe par nom** |
| Valeurs d'une dimension observées sur une fenêtre et une app (autocomplétion) | — | fenêtre | `dimensionValues(request)` `queries-dimensions.ts:L25` (lit `rum_event_index`, `rum_session`) | listes de filtres | ne publie jamais les valeurs d'un autre tenant |
| Formulaires : `form.submit` / `form.abandon` → par formulaire (starters, submits, abandons, conversion, temps moyen) et par champ (interactions, temps, taux de changement, abandons sur ce champ) | legacy segments | fenêtre preset, 5 000 événements | `formEvents(f, 5000)` `queries-form-analytics.ts:L14` ; `formReport`, `fieldReport` (`form-analytics.ts:L52, L86`) ; `/forms` | barres par formulaire, table par champ | presets ; échantillon de 5 000 événements les plus récents |
| Entonnoir : suite ordonnée de noms d'événements, première occurrence par session | legacy segments | fenêtre preset | `availableEvents(f, 50)`, `funnelReport(f, steps)` `queries-funnel.ts:L22, L46` ; `computeFunnel` (`funnel.ts:L63`) ; `/paths` | `Funnel` (existe) | étapes = **noms d'événements seulement** (ni route, ni action) ; sessions ayant réalisé l'étape 1 |
| Retour d'expérience (`rum_event` de score 1-5, non établi : nom exact de l'événement) : count, positives, moyenne, promoteurs/passifs/détracteurs ; tendance ; par route ; 30 derniers | contrat | seaux | `feedbackStats`, `feedbackTrend`, `feedbackByRoute`, `recentFeedback` `queries-experience.ts:L22-133` ; `experienceContext` L54 (LCP p75, sessions, frustrations) ; `/experience` | `RadarScore`, série CSAT, classement par route | non exposé par `/api/v1` |

### 2.7 Ressources

Table `rum_resource` (`migration-v02.sql:L14-26` : `url`, `type`, `duration_ms`, `transfer_size`,
`render_blocking` ; v67 `action_id` ; v75 `env`, `release`). Population : ressources **retenues par le
SDK** (seuil 300 ms, 20 par vue, parity B4).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Par type, par origine (hôte), par partie (première/tierce via `app_registry` hôtes déclarés) : `n`, `p75_ms`, `octets` ; `total`, `partageCalculable` | contrat | fenêtre | `resourcesVue(f, cap = 15)` `queries-resources.ts:L74` (`RESOURCE_CAP`, `resources.ts:L14`) ; `/pages` | `ResourcesView` : barres par type/hôte, donut 1ʳᵉ/3ᵉ partie | population partielle par construction ; total ≠ trafic réseau réel |
| Ressources lentes par route (`avg_ms`, `n`, `render_blocking`) | contrat | fenêtre | `slowResourcesByRoute(f)` `queries.ts:L278` ; `/pages` | table par route | |
| `rows`, `duration_ms` (avg/p75/p95), `transfer_size` (sum/avg/p75/p95), sessions | contrat, 2 dims | seaux | Explorer `resources` | série, toplist | pas de dimension `type` ni `hôte` dans l'Explorer (journal seulement) |

### 2.8 Tâches longues

Table `rum_longtask` (`migration-v02.sql:L28-36` ; v55 `source` `longtask \| loaf`, `blocking_ms`,
`render_ms`, `script_url`, `script_function`, `script_ms`, `invoker` ; v75 `env`, `release`).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Par seau : `loaf`, `longtask`, `inconnu` (avant le 09/09/2026), `p75_ms` du blocage | contrat | seaux du contrat | `longtaskSeries(f)` `queries-longtasks.ts:L31` ; `/pages` | `StackedBars` + ligne p75 | mélange de deux API décrivant le même blocage (`analytics-schema.ts:L448-453`) |
| Les 10 pires (`quoi`, `source`, `blocking_ms`, session, route) | contrat | — | `worstLongtasks(f, 10)` L81 | table | |
| Scripts bloquants : `url`, `quoi`, `n`, `totalMs`, `worstMs` | contrat | fenêtre | `scriptsBloquants(f)` `queries-frustration.ts:L105` ; `/ux` | classement | `totalMs` n'est pas du temps utilisateur unique |
| `rows`, `duration_ms`, `blocking_ms` (sum/avg/p75/p95), sessions ; variante `api` | contrat, 2 dims | seaux | Explorer `longtasks` | série, toplist | idem |

### 2.9 Spans, traces, carte de service

Table `rum_span` (`migration-v04.sql:L6-22` : `trace_id`, `parent_span_id`, `tier` `front \| back \|
detail` (v31), `url`, `method`, `status_code`, `duration_ms` ; v31 `name`, `kind` ; v67 `action_id` ;
v75 `env`, `release`, `service`). Vue `v_trace` (v04).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| Couverture : `total` (spans front), `correlated` (jumeau back même trace, même app), `back_total`, `front_p75`, `back_p75` | contrat | fenêtre | `traceCoverage(f)` `queries-tracing.ts:L20` ; `GET /api/v1/tracing` ; `/tracing` | KPI, jauge de corrélation | `back_total` inclut le trafic sans front (robots, curl) |
| Appels API vus du navigateur : `url`, `method`, `n`, `front_p75`, `back_p75`, `err` | contrat | fenêtre | `apiCalls(f)` L52 | barres empilées serveur (`back_p75`) / réseau (`front_p75 − back_p75`) (`API_CONSOLE.md:L742`) | `err` = statut ≥ 400 ou 0 |
| Routes backend : `n`, `p75`, `p95`, `err` | contrat | fenêtre | `backRoutes(f)` L84 | barres p75/p95 | un seul framework backend instrumenté (FastAPI), un seul saut |
| Traces lentes : `front_ms`, `back_ms`, `network_ms`, statut, session | contrat | — | `slowTraces(f)` L158 | table | |
| Détail d'une trace : spans `front/back/detail` avec parent | aucun filtre | span | `traceSpans(traceId, {apps})` L142 ; `/tracing/:id` | diagramme en cascade (Gantt) | une trace étrangère rend 404 |
| Carte : nœuds `front`/`back` (`calls`, `latency_p75`, `error_rate`, `recent`, `older`), arêtes route front → route back, pages (`sessions`, `lcp_p75`) | contrat | fenêtre coupée en deux moitiés | `mapNodes`, `mapEdges`, `mapPages` `queries-map.ts:L22-94` ; `/map` | graphe de service | non exposé par `/api/v1` |
| `rows`, `duration_ms` (avg/p75/p95), sessions ; variante `tier` ; dimension `service` | contrat, 2 dims | seaux | Explorer `spans` | série par service/release, toplist | un segment n'est pas une visite (L546) |

### 2.10 Rejeu de session

Table `replay_chunk` (`migration-v03.sql:L5-15` : `session_id`, `seq`, `events_count`, `body`
rrweb gzippé). Aucune fonction `queries-*` ne la lit : `GET /api/replay/[sessionId]` dégzippe les
chunks ; `queries-errors.ts` calcule `link_replay` (existence d'un chunk) ; `ReplayPlayer.tsx` lit
`eventCount`.

| Mesure | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|
| Rejeu d'une session, positionné sur une occurrence d'erreur | `app/api/replay/[sessionId]/route.ts`, `components/replay/` | lecteur rrweb | masquage par application, pas élément par élément (`dashboard-blocs.ts:L101-106`) ; sous `enforce`, un chunk arrivé avant son ancre est perdu (parity D2) |
| Part de sessions avec rejeu, durée de rejeu | **aucune fonction** | — | non établi ; voir § 4 |

### 2.11 Mobile (React Native)

Cohorte `rum_session.runtime = 'react_native'` (v82) ; `mobile_capabilities` (v82 L175-200).

| Mesure | Dimensions | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|---|
| `sessions` (commencées), `visitors` (`null` si aucun identifiant), `sessions_without_visitor` ; `js_errors` (`occurrences`, `crashes`, `unhandled_rejections`, `fatal`, `sessions_affected`) ; `js_error_free_session_rate` + raison si `null` ; `startup.cold/warm` (`samples`, p50/p75/p95) ; `screens` (route, vues, sessions) ; `resources` (path, method, calls, p75, max, errors) ; `capabilities` (`active \| unavailable \| unknown`) ; `sampling` ; `unavailable` | `device`, `os` (`platform`), `release` **seulement** | fenêtre entière (aucune série) | `mobileSummary(f)` `queries-mobile.ts:L299`, `mobileDeclarations` L389 ; `GET /api/v1/mobile/summary` ; `/mobile` | KPI, classement écrans et requêtes, tuiles de capacités | **ni crash natif, ni ANR, ni démarrage natif** — « Non collecté », jamais `0` ; aucune session RN réelle n'a jamais alimenté l'écran (parity C7) ; visiteurs surestimés (C3) |
| Série temporelle mobile | — | — | **aucune** (Explorer sans dimension `runtime`) | — | voir § 4 |

### 2.12 SVI (serveur vocal)

Tables `svi_call`, `svi_step`, `svi_leg`, `svi_quality_sample`, `svi_queue_sample`, `svi_call_link`
(`migration-v51.sql:L37-190`). Lectures **historiques** (app + période).

| Mesure | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|
| Résumé : `total`, `contained`, `transferred`, `abandoned`, `failed`, `open`, `with_journey`, durée et attente moyennes | fenêtre preset | `sviSummary(f)` `queries-svi.ts:L67` ; `/svi` | KPI, donut des issues | `outcome` est `NULL` tant que l'appel est ouvert (v51 contrainte L78-80) |
| Containment net à 7 j : `closed`, `contained`, `recalled`, `unevaluable` | fenêtre preset | `sviContainment(f)` L151 | jauge | rappel détecté par `caller_hash` (HMAC posé dans l'adaptateur) |
| Nœuds de sortie : `exit_node`, `total`, `abandoned`, `transferred` | fenêtre preset | `sviExitNodes(f, 8)` L179 | barres | exige la provenance `journey` |
| Issues par heure | **heure** | `sviOutcomesByHour(f)` L197 ; `/svi/appels` | barres empilées par issue | |
| Liste des appels ; détail appel + étapes | — | `sviCalls(f, 100)` L35, `sviCallDetail(app, callId)` L107 | table, frise d'étapes | saisie jamais stockée (`input_class`, `input_len` masqué) |
| Qualité voix (`mos`, `jitter`, `loss`, `rtt` par échantillon), files (`waiting`, `longest_wait_ms`, agents) | échantillon | **aucune fonction `queries-*`** ne lit `svi_quality_sample` ni `svi_queue_sample` | — | voir § 4 |

### 2.13 Uptime

Tables `uptime_check`, `uptime_result` (`migration-v42.sql:L14-35`).

| Mesure | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|
| Par contrôle : dernier résultat (`ok`, statut, latence, erreur), `checks_24h`, `up_24h`, `uptime_pct_24h` | **24 h glissantes, sans série** | `listUptimeStatus()` `queries-uptime.ts:L26` ; `/admin/uptime` | tuiles d'état, pourcentage | `uptime_result` porte `ts`, `latency_ms` par passage : la série existe en table, **aucune fonction ne la lit** (§ 4) |

### 2.14 SLO

Table `slo` (`migration-v17.sql:L22-32` : `metric` ∈ vitals (part `good`) ou `error_rate`,
`objective`, `window_days`, `route`).

| Mesure | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|
| Par SLO : `attainment`, `budget`, `burned_pct`, `fast_burn` | fenêtre propre au SLO (`window_days`), **instantané** | `sloStatus(f)` `queries-alerting.ts:L30` (fonction SQL `slo_status()`), `listSlo` L57 ; `/slo` | jauges de budget | aucun historique de consommation : pas de courbe de burn-down (§ 4) ; évaluation à la cadence du scheduler, pas en temps réel (`dashboard-blocs.ts:L120-128`) |

### 2.15 Alertes

Tables `alert_rule` (`migration-v02.sql:L62-73` + v49 `mode`, `severity`, `sensitivity`,
`baseline_weeks`, v73 `last_state`, …), `alert_event` (v02 L75-82 + v17 `slo_id`, `severity`),
`alert_delivery` (v03), `notify_channel` (v17).

| Mesure | Grain | Servi par | Graphique | Ne garantit pas |
|---|---|---|---|---|
| Règles : métrique, route, env, comparateur, seuil, fenêtre, mode, sensibilité, `unacked`, dernier état/valeur/raison/évaluation | — | `alertRules(f)` `queries-v2.ts:L159` ; `/alerts` | table d'état | filtres de population non appliqués (surface `/alerts`) |
| Déclenchements : `fired_at`, `value`, `message`, `severity`, `metric`, `route`, `acknowledged`, `delivered` (2xx confirmés), `pending` | événement | `alertEvents(f)` L230, `unackedAlertCount` L254 | frise chronologique, marqueurs sur les séries | `delivered = 0` = personne averti ; `sent` ≠ livré (L192-198) |
| Canaux (`webhook \| slack`) | — | `listChannels(f)` `queries-alerting.ts:L108` | liste | pas d'escalade (`dashboard-blocs.ts:L129-133`) |

### 2.16 Transverses

| Sujet | Mesure | Servi par | Graphique | Limite |
|---|---|---|---|---|
| Corrélation robot ↔ réel | cartes par route : `rum_lcp_p75`, `rum_inp_p75`, `rum_sessions`, `syn_latency_avg`, `syn_score_avg`, `syn_state` ; série horaire par route ; angles morts (`gap_ms`) | `correlationCards`, `correlationRoutes`, `correlationSeries(route, f)`, `blindSpots` `queries-v2.ts:L415-488` (vue `v_correlation`, `schema.sql:L100-130`) ; `GET /api/v1/correlation` ; `/correlation` | `ScatterPlot` (x robot, y réel, taille sessions), `RobotVsRealChart`, table angles morts | la série n'est pas exposée par l'API (`API_CONSOLE.md:L754`) ; `syn_snapshot` n'est pas sessionné |
| Déploiements | marqueurs (`ts`, `version`, `env`, `source`) ; impact du dernier | `listDeploys(f, 20)`, `latestDeployImpact(f)` `queries-deploys.ts:L20, L61` ; `POST /api/v1/deploys` | lignes verticales sur toute série (à assembler côté front) | `listDeploys` lit `Filters` historique |
| Logs (`rum_log`, v29) | entrées par sévérité, comptes par sévérité, anomalies de volume (z-score, v37), par route (erreurs/avertissements), volume par heure `error/warn/other` (24 seaux) | `logEntries`, `logSeverityCounts`, `logAnomalies`, `logsByRoute`, `logVolumeByHour` `queries-logs.ts:L44-154` ; `/logs` | barres empilées 24 h, table | `period-only` ; corrélation par `trace_id` possible (index v29) |
| Prévision | tendance linéaire sur les 14 séries quotidiennes, ETA vers un seuil | `linfit`, `etaToThreshold`, `buildForecastNarrative` (`forecast.ts`) sur `dailyLcpSeries` / `dailyTraffic` ; `/forecast` | `ForecastChart` | un ajustement linéaire sur 14 points ; presets seulement |
| Résumé partenaire | sessions, `users`, `unidentified_sessions`, `sampling_notice`, page_views, `avg_load_ms`, p75 LCP/INP pondérés, `error_rate`, `frustration_signals`, série quotidienne, top routes, top erreurs (+ section IA servie par xSOM, `unavailable` sinon) | `rumSummary(app, window, interval, generatedAt)` `queries-summary.ts:L182` ; `GET /api/rum/summary` (`24h \| 7d \| 30d`, `read-tokens.ts:L16`) | tableau de bord en un appel | champs extrapolés vs non corrigés listés dans `sampling_notice` (L111-120) |
| État interne | `internalHealth()` `queries-health.ts:L15` (`alert_delivery`, `route_cardinality`, `tenant_usage_daily`…), `dernierPassagePlanifie`, `dernierTickScheduler` (`queries-planifie.ts`) ; `signauxProjets` (`queries-projects.ts:L147` : mode de collecte `sdk \| extension \| mixte \| aucun`, anomalies par app) | `/admin/health`, `/select` | tuiles | |

---

## 3. Inventaire des fonctions exportées de `apps/console/lib/queries*.ts`

Une ligne par fonction **exportée** (relevé `grep "^export"`). « Tables » = tables et vues citées dans
le fichier ; une fonction n'en lit pas forcément toutes. Les fonctions d'écriture et d'administration
sont listées pour l'exhaustivité, marquées ✎.

### `queries.ts` — tables : `app_registry, rum_session, rum_pageview, rum_metric, rum_error, rum_breadcrumb, rum_longtask, rum_event, rum_action, rum_resource, rum_span`
| L | Fonction | Renvoie |
|---|---|---|
| 19 | `listApps(): Promise<AppItem[]>` | apps du registre + apps vues en session |
| 34 | `registeredApps(): Promise<AppItem[]>` | apps du registre seulement |
| 46 | `vitalsP75(f: Filters, shift = false): Promise<VitalAgg[]>` | `{name, p75, p50, n}` par vital ; `shift` = période précédente |
| 75 | `vitalPercentiles(f): Promise<VitalPercentiles[]>` | `{name, pcts:[p50,p75,p90,p95,p99], n}` |
| 96 | `vitalHistogram(f, name, cap, nbuckets): Promise<HistoRow[]>` | `{bucket, count}` linéaires |
| 124 | `overviewStats(f, shift = false): Promise<OverviewStats>` | `{sessions, errors, pageviews}` |
| 150 | `vitalSeries(f, name): Promise<SeriesRow[]>` | `{bucket, p75}` par seau |
| 207 | `slowRoutes(f): Promise<RouteRow[]>` | `{route, views, lcp_p75, inp_p75, cls_p75, longtasks}` ≤ 200 |
| 255 | `nombreDeRoutes(f): Promise<number>` | nombre réel de routes (pour annoncer la troncature) |
| 278 | `slowResourcesByRoute(f): Promise<Map<string, SlowResource[]>>` | par route : `{url, type, avg_ms, n, render_blocking}` |
| 353 | `releaseRechercheParOccurrence(): Promise<boolean>` | la recherche par release lit-elle v75 |
| 363 | `listSessions(f, page?): Promise<SessionRow[]>` | sessions avec `cursor_ts`, `geo_source` |
| 413 | `sessionMeta(id): Promise<SessionMeta \| null>` | `select * from rum_session` |
| 441 | `sessionTimeline(id): Promise<TimelineItem[]>` | frise fusionnée 9 sources |
| 597 | `visitStats(f): Promise<VisitStats>` | sessions, visites, nouveaux, revenants, non identifiés |

### `queries-accounts.ts` — `console_user, dashboard`
| 12 | `accountIdOf(email): Promise<string \| null>` | identifiant de compte |

### `queries-acquisition.ts` — `rum_pageview, rum_session`
| 14 | `acquisition(f, cap = 20000): Promise<AcquisitionReport>` | canaux + top referrers (première vue par session) |

### `queries-actions.ts` — `rum_action, rum_error, rum_resource, rum_span, rum_event, rum_session`
| 43 | `parseActionsPage(sp, defaultLimit = 50): Pagination` | pagination |
| 48 | `hasNextActionsPage(page, rowCount): boolean` | |
| 175 | `topActions(f, page): Promise<TopActionRow[]>` | classement causal |
| 202 | `topActionsSummary(f): Promise<ActionSummary>` | totaux fenêtre + `sampling_notice` |
| 238 | `actionSamplingNotice(min): ActionSamplingNotice \| null` | pur |

### `queries-alerting.ts` — `slo, notify_channel`
| 30 | `sloStatus(f): Promise<SloStatusRow[]>` | via `slo_status()` |
| 57 | `listSlo(f): Promise<SloRaw[]>` | |
| 77/86/90 | ✎ `insertSlo`, `toggleSlo`, `deleteSlo` | |
| 108 | `listChannels(f): Promise<NotifyChannelRow[]>` | |
| 126/134/138 | ✎ `insertChannel`, `toggleChannel`, `deleteChannel` | |

### `queries-breakdowns.ts` — `rum_metric, rum_error` (+ session jointe)
| 79 | `vitalsBreakdown(f, dimension, cap = 12): Promise<BreakdownResult<VitalsBreakdownRow>>` | `{rows, groups, truncated}` |
| 119 | `errorsBreakdown(f, dimension, cap = 12): Promise<BreakdownResult<ErrorsBreakdownRow>>` | idem, occurrences/sessions/signatures |

### `queries-cohorts.ts` — `rum_session`
| 27 | `retentionCohorts(f, weeks): Promise<CohortRow[]>` | matrice hebdomadaire |
| 43 | `weekIndexToDate(week): Date` | pur |

### `queries-customers.ts` — `app_registry, rum_session, rum_metric, rum_error, rum_span`
| 20 | `listCustomers(): Promise<CustomerRow[]>` | admin |
| 40 | `getCustomer(appId)` | |
| 54 | `probeOnboarding(appId): Promise<OnboardingProbe>` | premiers signaux reçus |

### `queries-dashboards.ts` — `dashboard, console_user`
| 61 | `dashboardOwnershipAvailable(): Promise<boolean>` | v79 présente |
| 76 | `forgetDashboardSchema(): void` | cache |
| 94 | `listDashboards(f): Promise<DashboardRow[]>` | |
| 107 | `getDashboard(id)` | `layout: Widget[]`, `revision` |
| 119/184/200/207 | ✎ `insertDashboard`, `updateDashboardMeta`, `updateLayout`, `deleteDashboard` | concurrence optimiste (`revision`) |

### `queries-deploys.ts` — `deploy_marker, rum_metric, rum_error, rum_pageview, rum_session`
| 20 | `listDeploys(f, limit = 20): Promise<DeployRow[]>` | |
| 33 | ✎ `recordDeploy(appId, version, env, source, ts?)` | |
| 61 | `latestDeployImpact(f): Promise<DeployImpact \| null>` | LCP/erreurs avant-après |
| 103 | `assessRegression(before, after, ratio = 1.2): RegressionVerdict` | pur |
| 162 | `comparaisonVersions(f, limit = 12): Promise<ComparaisonVersions>` | `{rows, source: "occurrence" \| "session"}` |
| 261/273/284/296 | `comparable`, `versionReference`, `tauxErreur`, `ecartPoints` | purs |

### `queries-dimensions.ts` — `rum_event_index, rum_session`
| 25 | `dimensionValues(request, lire = q): Promise<DimensionValues>` | valeurs d'une dimension (app + fenêtre) |

### `queries-dsar.ts` — `rum_session, rum_error, rum_action, rum_event_index, app_registry, privacy_*`
| 86 | `barriereActiveeSur(client, app)` | |
| 186/208/230 | `dsarCible`, `dsarCounts(app, visitorId): Promise<DsarCount[]>`, `dsarTotalRows` | comptes par table |
| 295/322/367 | `dsarIdentityCounts`, `dsarIdentityExport`, ✎ `dsarIdentityErase` | par `user_id_hash`/`account_id_hash` |
| 488/520/561 | `etatBarriere`, `dsarExport`, ✎ `dsarErase` | par `visitor_id` (refus si `device_class`) |

### `queries-errors.ts` — `rum_error, rum_session, rum_action, rum_span, replay_chunk, error_status, error_issue_alias`
| 74 | `stackSymbolisable(source): boolean` | pur |
| 90/99 | `parseErrorListPage(sp)`, `parseOccurrencesPage(sp)` | bornes 200 / 100 |
| 105/110/120/124 | `encodeErrorCursor`, `parseErrorCursor`, `isFingerprintParam`, `errorDeviceFrom` | purs |
| 133/141 | `errorScopeFor(principal): ErrorScope`, `scopeApps(scope)` | purs |
| 383 | `errorSchema(): Promise<ErrorSchema>` | v69/v72 présentes, dimensions |
| 396/411 | `enrichmentOf(v69)`, `samplingOf(p)` | purs |
| 431 | `snapshot(fn)` | `repeatable read` |
| 527 | `errorBase(f, schema, r?)` | CTE commune (SQL) |
| 653/664/682/705/727 | `totalsSql`, `bucketSql`, `trendSql`, `exemplarSql`, `occurrencesSql` | générateurs SQL |
| 784 | `toOccurrenceRow(row)` | pur |
| 825 | `listErrorGroups(f, page, opts?): Promise<ErrorListResult>` | groupes + totaux + tendance (+ séries) |
| 893 | `resolveErrorGroup(fingerprint, f, apps): Promise<ErrorGroupResolution>` | `found \| ambiguous \| not_found` |
| 920 | `errorGroupDetail(ref, f, page): Promise<ErrorGroupDetailResult \| null>` | détail + occurrences curseur |

### `queries-events.ts` — `rum_event_index, rum_event`
| 83-163 | `parseEventKind`, `parseEventName`, `isValidEventName`, `parseEventAttribute`, `parseEventQuery`, `parseEventPage`, `encodeEventCursor`, `parseEventCursor` | purs |
| 272 | `listEventIndex(app, kind, page)` | projection minimale (API v1) |
| 284 | `exploreEvents(f, query, page, cursor): Promise<EventExplorerResult>` | journal + total + tendance + facettes |
| 407 | `eventCount(f, name)` | `{count, sampling_notice, available, diagnostic}` |

### `queries-experience.ts` — `rum_event, rum_metric, rum_session`
| 22 | `feedbackStats(f): Promise<FeedbackStats>` | |
| 54 | `experienceContext(f): Promise<ExperienceContext>` | `{lcp_p75, sessions, frustration}` |
| 83 | `feedbackTrend(f): Promise<FeedbackTrendRow[]>` | `{bucket, count, positives}` |
| 109 | `recentFeedback(f, limit = 30)` | |
| 133 | `feedbackByRoute(f): Promise<RouteCsatRow[]>` | |

### `queries-explorer.ts` — (SQL compilé par `analytics-compiler.ts` ; tables des 9 jeux + `metric_histogram_*`, `analytics_rollup_invalidation`)
| 229 | `exploreAnalytics(request, options?): Promise<ExplorerResult>` | `{meta, data:{total, samples, groups, series, rows, next_cursor}}` |
| 445 | `explorerSchema(capabilities): Promise<PublicSchema>` | registre public (`GET /api/v1/explorer/schema`) |

### `queries-extension-installs.ts` — `extension_install, extension_install_app, extension_scope`
| 38/78/94 | ✎ `recordInstallBeat`, `listInstalls(): Promise<InstallRow[]>`, ✎ `forgetInstall` | |

### `queries-extension-scope.ts` — `extension_scope, app_registry`
| 15/26/34/51/65 | `resolveExtensionScope(domain)`, `listExtensionScopes()`, ✎ `createExtensionScope`, ✎ `allowOriginForApp`, ✎ `toggleExtensionScope` | |

### `queries-form-analytics.ts` — `rum_event, rum_session`
| 14 | `formEvents(f, limit = 5000): Promise<FormEvent[]>` | `form.submit` / `form.abandon` |

### `queries-frustration.ts` — `rum_event, rum_metric, rum_longtask`
| 19 | `topFrustrations(f): Promise<FrustrationRow[]>` | `{route, kind, target, n}` |
| 52 | `inpOffenders(f): Promise<InpOffender[]>` | `{target, n, p75, worst}` ≤ 20 |
| 105 | `scriptsBloquants(f): Promise<ScriptBloquant[]>` | `{url, quoi, n, totalMs, worstMs}` |

### `queries-funnel.ts` — `rum_event, rum_session`
| 22 | `availableEvents(f, limit = 50): Promise<EventOption[]>` | noms d'événements |
| 46 | `funnelReport(f, steps): Promise<FunnelStep[]>` | |

### `queries-goals.ts` — `goal, rum_event, rum_pageview, rum_session`
| 16 | `listGoals(app): Promise<GoalDef[]>` | |
| 69 | `goalConversions(f): Promise<{total, rows: GoalConversion[]}>` | |

### `queries-grid.ts` — `rum_metric, rum_pageview, rum_error, rum_rollup_hourly`
| 31 | `rollupCompatible(query): boolean` | pur |
| 60 | `healthGrid(f): Promise<HealthGridCell[]>` | `{day, hour, good_w, total_w}` 14 j |
| 110 | `dailyTraffic(f): Promise<DailyTraffic[]>` | `{day, pageviews, errors}` 14 j |
| 176 | `dailyLcpSeries(f): Promise<SeriesRow[]>` | p75 LCP par jour, 14 j |

### `queries-health.ts` — `alert_delivery, alert_event, app_registry, route_cardinality, rum_*, tenant_usage_daily`
| 15 | `internalHealth(): Promise<HealthSnapshot>` | état interne |

### `queries-histogramme.ts` — `metric_histogram_hourly, metric_histogram_state, rum_metric, rum_session`
| 92 | `percentilesPonderes(app, interval, noms, p = 0.75): Promise<Record<string, number \| null>>` | percentile pondéré hybride |

### `queries-logs.ts` — `rum_log`
| 23/30/36 | `severityFloor`, `parseLevel`, `severityBucket` | purs |
| 44 | `logEntries(f, level, limit = 200): Promise<LogRow[]>` | |
| 60 | `logSeverityCounts(f): Promise<Record<string, number>>` | |
| 88 | `logAnomalies(f): Promise<LogAnomalyRow[]>` | z-score horaire |
| 112 | `logsByRoute(f): Promise<LogRouteRow[]>` | |
| 131 | `logVolumeByHour(f): Promise<{error, warn, other: number[]}>` | 24 seaux |

### `queries-longtasks.ts` — `rum_longtask`
| 31 | `longtaskSeries(f): Promise<LongtaskBucket[]>` | |
| 81 | `worstLongtasks(f, limit = 10): Promise<LongtaskWorst[]>` | |

### `queries-map.ts` — `rum_span, rum_metric`
| 22/54/78 | `mapNodes(f)`, `mapEdges(f)`, `mapPages(f)` | graphe de service |

### `queries-mobile.ts` — `rum_session, rum_error, rum_event, rum_pageview, rum_span, mobile_capabilities`
| 144 | `mobileSchema(): Promise<MobileSchema>` | colonnes v82 présentes |
| 280 | `samplingOf(p): MobileSampling` | pur |
| 299 | `mobileSummary(f, schema?): Promise<MobileSummary>` | |
| 389 | `mobileDeclarations(query): Promise<CapabilityDeclaration[]>` | |

### `queries-paths.ts` — `rum_pageview, rum_session`
| 23 | `routeTransitions(f, limit = 50): Promise<TransitionRow[]>` | |
| 52 | `entryExitRoutes(f, limit = 15)` | `{entries, exits}` |

### `queries-planifie.ts` — `alert_event, rum_rollup_hourly, scheduler_lease, tenant_usage_daily`
| 20/47 | `dernierPassagePlanifie()`, `dernierTickScheduler()` | dates |

### `queries-projects.ts` — `app_registry, extension_scope, rum_pageview, rum_session, alert_event`
| 147 | `signauxProjets(appIds): Promise<SignauxParApp>` | mode de collecte, domaines, anomalies |

### `queries-read-tokens.ts` — `read_tokens`
| 8/25/33/42 | `resolveReadToken`, `listReadTokens`, ✎ `createReadToken`, ✎ `revokeReadToken` | |

### `queries-resources.ts` — `rum_resource, app_registry`
| 74 | `resourcesVue(f, cap = 15): Promise<ResourcesVue>` | par type, origine, partie |

### `queries-saved-views.ts` — `analytics_saved_view, console_user`
| 51/57/102 | `savedViewsAvailable`, `savedViewReader(user)`, `isSavedViewId` | |
| 111/144 | `listSavedViews(reader, filtre?)`, `getSavedView(reader, id)` | `SavedViewResult` |
| 162/203/252 | ✎ `createSavedView`, ✎ `updateSavedView`, ✎ `deleteSavedView` | 50 vues / compte / app |

### `queries-sessions.ts` — `rum_session`
| 20 | `engagementStats(f): Promise<EngagementStats>` | |
| 68 | `observedVisitorsTrend(f): Promise<VisitorsBucket[]>` | |

### `queries-sourcemap-tokens.ts` — `sourcemap_upload_token, app_registry, audit_log`
| 34/56/70/98 | `parseTokenRequest`, `listSourcemapTokens`, ✎ `createSourcemapToken`, ✎ `revokeSourcemapToken` | |

### `queries-sourcemap.ts` — `sourcemap`
| 38/44/57 | `schemaSourcemapAbsent`, `listSourcemapReleases(appId)`, `releaseManifest(appId, release)` | |

### `queries-summary.ts` — `rum_session, rum_pageview, rum_metric, rum_error, rum_event, rum_ai` (+ xSOM)
| 157 | `noticeEchantillonnage(min): SamplingNotice \| null` | pur |
| 182 | `rumSummary(app, windowKey, interval, generatedAt): Promise<RumSummary>` | |

### `queries-svi.ts` — `svi_call, svi_step`
| 35/67/107/151/179/197 | `sviCalls`, `sviSummary`, `sviCallDetail`, `sviContainment`, `sviExitNodes`, `sviOutcomesByHour` | voir § 2.12 |

### `queries-ticket-integrations.ts` — `ticket_integration, ticket_outbox, error_issue, app_registry, audit_log, console_user`
| 77/92/102/119 | `ticketSchemaDisponible`, `surfaceTicketsOuverte`, `listTicketIntegrations`, `integrationsUtilisables` | |
| 156/238/453 | `parseIntegrationRequest`, `parseIntegrationPatch`, `parseDemandeTicket` | purs |
| 276/307 | ✎ `createTicketIntegration`, ✎ `patchTicketIntegration` | |
| 369/413/489/564 | `origineConsole`, `apercuTicket`, ✎ `demanderTicket`, `livraisonsTicket` | |

### `queries-tracing.ts` — `rum_span`
| 20/52/84/142/158 | `traceCoverage`, `apiCalls`, `backRoutes`, `traceSpans(traceId, opts?)`, `slowTraces` | voir § 2.9 |

### `queries-uptime.ts` — `uptime_check, uptime_result`
| 26 | `listUptimeStatus(): Promise<UptimeStatusRow[]>` | |
| 39/52/57 | ✎ `createUptimeCheck`, ✎ `toggleUptimeCheck`, ✎ `deleteUptimeCheck` | |

### `queries-usage.ts` — `tenant_usage_daily, app_registry`
| 15 | `monthlyUsage(): Promise<TenantUsageRow[]>` | |

### `queries-v2.ts` — `alert_rule, alert_event, alert_delivery, error_status, error_issue, error_issue_notification, slo, rum_metric, syn_snapshot, v_correlation`
| 33/41/45 | `v2FiltersOf(query): Filters`, `periodInterval(f)`, `periodLabel(f)` | purs |
| 62 | ✎ `setErrorStatus(appId, fingerprint, status, operator)` | |
| 116/122 | `metricLabel`, `isAlertMetric` | purs |
| 159/230/254 | `alertRules(f)`, `alertEvents(f)`, `unackedAlertCount(f)` | |
| 306/317/331/335 | ✎ `insertAlertRule`, ✎ `updateAlertRule`, ✎ `toggleAlertRuleActive`, ✎ `acknowledgeAlertEvent` | |
| 340/346/354 | ✎ `runCheckAlerts`, ✎ `runRouteIssueNotifications`, ✎ `runCheckSloBurn` | cron |
| 415/429/451/476 | `correlationCards(f)`, `correlationRoutes(f)`, `correlationSeries(route, f)`, `blindSpots(f)` | voir § 2.16 |

---

## 4. (B) Ce qui manque pour des graphiques que Datadog propose

Classement : **requête** = fonction ou registre à ajouter sans migration (petit) ; **colonne/table** =
migration (moyen) ; **collecte SDK** = nouveau signal chez le visiteur (gros) ; **impossible par
principe** = contraire à un engagement du produit (aucune IP, aucune PII, aucune table vide qui se
lirait comme un zéro).

Référence Datadog : représentations de l'Explorer RUM (`docs.datadoghq.com/real_user_monitoring/explorer/visualize/`) :
« Lists, Timeseries, Top List, Nested Tables (up to three facets), Distributions, Geomaps, Funnels,
Pie Charts ». Product Analytics (`…/product_analytics/`) : « Pathways, Funnel, Retention, Analytics,
Users & Segments, Session Replay, Heatmaps (Click maps, Top elements, Scroll maps) ». Page
d'offre (`datadoghq.com/dg/real-user-monitoring/overview/`) : « Core Web Vitals », « tags for device,
OS, and country », « funnels and rage clicks », « Collect 100% of your user sessions (no sampling) »,
« First Contentful Paint, DOM Content Loaded, Time to Interactive ».

| Graphique Datadog | Ce qui existe déjà | Ce qui manque | Classe |
|---|---|---|---|
| **Distribution / histogramme** d'un vital (LCP…) dans l'Explorer | `vitalHistogram` sur `/pages` (20 seaux linéaires, non exposé par l'API) ; `metric_histogram_hourly` (seaux log GAMMA 1,02, `mip_seau()` v61) et `percentileDepuisSeaux` | une représentation `distribution` dans `VISUALIZATIONS` (`analytics-schema.ts:L64`) + un compilateur lisant `mip_seau(value)` sur le brut ou les seaux de l'agrégat, et l'exposition de `HistoRow` par `/api/v1/vitals` | **requête** |
| **Geomap** par pays | dimension `country` (toplist/série par pays estimé, `country_source` pour la provenance) | rien côté données : un fond de carte côté front. `geo_country` est un code pays (non établi : ISO-3166-1 alpha-2 dans toutes les provenances ; `v85` à vérifier avant de joindre un atlas) | **front seul** (pays) |
| Geomap **ville / région**, opérateur réseau | — | le produit ne stocke aucune adresse IP (`RUM_PARITY_STATUS.md` § 6.4 ; `dashboard-blocs.ts:L60-64`) ; D14 ne résout que le pays | **impossible par principe** |
| **Funnel multi-étapes** sur vues + actions + événements | `funnelReport` : étapes = noms d'événements `rum_event`, première occurrence par session, presets seulement | migrer sur le contrat (`sqlContext`) et accepter des étapes `pageview:route` (`rum_pageview.route`) et `action:name` (`rum_action.name`) ; Datadog précise que « any action or view that happens between two steps … does not impact the conversion rate » — même sémantique que `computeFunnel` (`funnel.ts:L23-33`, `reachedDepth`) | **requête** |
| **Nested tables** (3 facettes) | `MAX_GROUP_BY = 2` (`analytics-schema.ts:L50`), 50 combinaisons | passer à 3 et reborner `MAX_GROUPS` ; vérifier le budget SQL (parity B9 : les temps publiés ne sont pas un SLA) | **requête** |
| **Pie chart** | toplist (count/sum) | calcul de parts côté front ; **refuser** pour `avg`, `p75`, `p95`, `distinct` (`estAdditive`, L88-90) | **front seul** |
| **Heatmap de clics / scroll map / top elements** | `rum_action.context` (jsonb, 32 Kio) sans coordonnées ; `rum_breadcrumb` `click` sans position ; `attribution->>'interactionTarget'` (sélecteur) pour INP | coordonnées de clic, dimensions du viewport, profondeur de défilement, sélecteur CSS stable : nouveau signal SDK, à scrubber (un sélecteur peut porter du texte) | **collecte SDK** |
| **Rétention par cohorte** (jour, retour sur une page ou une action) | `retentionCohorts` hebdomadaire sur `visitor_id`, presets | cohorte quotidienne (paramètre de grain), critère « revenu sur route X / action Y » (jointure `rum_pageview` / `rum_action`), migration sur le contrat | **requête** ; la fiabilité reste bornée par `id_kind='random'` et, sur mobile, par le visiteur mémoire (C3) |
| **Crash-free rate** mobile | `js_error_free_session_rate` (JS seulement, `null` avec raison) | module natif iOS/Android, symboles, appareils (D11 `non_commence`) ; **aucune table n'a été créée volontairement** | **collecte SDK** (gros) — et interdit d'afficher un `0` ou un « 100 % » en attendant |
| **Views explorer** : temps de chargement / temps passé par vue | vitals par route ; `rum_pageview` sans fin de vue ; `analytics-schema.ts:L322` : « Aucun temps passé n'est dérivé » | une fin de vue ou un heartbeat émis par le SDK (`view_id` existe sur `rum_event`/`rum_error` depuis v66) ; une approximation « prochaine vue − vue » serait fausse sur la dernière vue de chaque session : à refuser sans le dire | **collecte SDK** (durée) ; **requête** seulement pour un « temps entre deux vues » explicitement nommé ainsi |
| « DOM Content Loaded », « Time to Interactive » | phases réseau (`REDIRECT…RESPONSE`) et TTFB dans `rum_metric` | DCL / TTI ne sont pas émis (non établi : vérifier `packages/rum-sdk` avant de conclure) | **collecte SDK** |
| **Sessions avec rejeu** (filtre, part, durée) | `replay_chunk` ; `link_replay` par occurrence d'erreur | une fonction `replay_chunk` × `rum_session` (existence, `events_count`, durée = `max(created_at) − min`) et une dimension `has_replay` | **requête** |
| **Série temporelle mobile** (sessions RN, erreurs JS par seau) | `mobileSummary` sans série | dimension `runtime` (colonne `rum_session.runtime` v82) dans `DIMENSIONS`/`SESSION_DIMENSIONS` ; puis l'Explorer suffit | **requête** |
| Découpage par **version de navigateur / d'OS**, par **qualité de lien** (`net_type`) | colonnes v75 `browser_version`, `os_version` ; v53 `net_type` (Chromium seulement) | trois entrées dans `SESSION_DIMENSIONS` (`query-compiler.ts:L56-68`) et la sonde de schéma | **requête** ; `net_type` reste `NULL` hors Chromium (v53 L15-25) |
| Groupement par **nom** d'événement / d'action / de span / type de ressource | journal filtrable par `name` (`/events`), toplist par route/appareil | une dimension d'occurrence `name` bornée (100 caractères, `PROPERTY_KEY`-like) par jeu, avec sa cardinalité plafonnée (`route_cardinality` v62 n'existe que pour `route`) | **requête** (moyen : cardinalité à borner) |
| **Taux** dans l'Explorer (erreurs / vues, sessions en erreur / sessions, part `good`) | taux fermés : `healthScore`, `comparaisonVersions`, `error_rate` de `rumSummary` ; `rating` en colonne | une mesure de type `ratio` (deux populations du **même** jeu ou d'une paire déclarée), refusée avec une dimension d'occurrence qui ne filtre pas le dénominateur (règle déjà appliquée à `/mobile`, `surfaces.ts:L65-76`) | **requête** (moyen) |
| **Comparaison à la période précédente** dans l'Explorer et les widgets | `previousRange` (`query-contract.ts:L306`), `vitalsP75(shift)`, `overviewStats(shift)` | un second appel avec `previousRange` côté route (pas de nouveau SQL) ; interdit de superposer deux seaux de largeurs différentes | **requête** (petit) |
| Percentiles **p50 / p90 / p99** dans l'Explorer | `AGGREGATIONS` = `avg, p75, p95` ; `vitalPercentiles` en donne 5 | ajouter les agrégations ; l'agrégat histogramme ne répond qu'en p75/p95 (`rollups L112`), le reste passe sur le brut | **requête** |
| **Waterfall** des ressources d'une vue | `rum_resource` (`ts`, `duration_ms`, `session_id`, `route`, sans `pageview_id`) | rattachement à la vue (approximation par `session_id` + `route` + fenêtre de la vue) ; population partielle (300 ms, 20/vue) → un waterfall incomplet par construction, à annoncer | **requête** avec caveat ; complet = **collecte SDK** |
| **Burn-down** d'un SLO dans le temps | `slo_status()` instantané | table d'historique (`slo_status_hourly`) alimentée par le scheduler, ou recalcul rétroactif coûteux depuis `rum_metric`/`rum_error` | **colonne/table** |
| **Latence uptime** dans le temps | `uptime_result(ts, latency_ms, ok)` par passage | une fonction de série (seaux du contrat) sur `uptime_result` | **requête** |
| **Qualité voix / files** SVI dans le temps | `svi_quality_sample`, `svi_queue_sample` en table | aucune fonction ne les lit | **requête** |
| **Utilisateurs & segments** (liste d'utilisateurs, profil) | `user_id_hash` distincts ; `visitor_id` aléatoire | pas de personne nommée, jamais (« Identité du visiteur », `dashboard-blocs.ts:L92-99`) ; une liste de hachés est possible mais n'identifie personne | **impossible par principe** (profil) ; segments enregistrés = **requête** (`SavedSegment` existe côté client, `query-contract.ts:L725-733`) |
| « 100 % des sessions, sans échantillonnage » | `sample_rate`, `error_sample_rate`, `weight` (v58) ; notices partout | rien à ajouter : c'est un choix inverse, à afficher tel quel (`sampling_notice`) | — |
| Marqueurs de **déploiement** sur toute série | `listDeploys` (historique) ; `deploy_marker` | migrer `listDeploys` sur le contrat pour respecter une plage personnalisée ; overlay côté front | **requête** (petit) |
| **Séries par groupe d'erreurs** exposées par l'API | `listErrorGroups(…, {series: true})` existe ; `/api/v1/errors` ne le publie pas | un paramètre `?series=1` sur la route | **requête** (petit) |
| **Session Replay** avec démasquage sélectif | rejeu masqué par application | rrweb sans sélecteur de démasquage (`dashboard-blocs.ts:L101-106`) | **collecte SDK** / bibliothèque |
| **Anomalies / Watchdog** sur toute métrique | `v_anomaly` (LCP par route, 24 h, z > 3), `logAnomalies` | généralisation : une vue par jeu, ou un calcul par requête ; voir l'épique ML du plan (hors périmètre de ce relevé) | **requête** (moyen) |

---

## 5. (C) Invariants de vérité à respecter dans tout graphique

Chaque invariant est une phrase que le front doit rendre vraie à l'écran, avec le code qui la fonde.

1. **Le périmètre vient du principal, jamais de l'URL.** Une app hors périmètre est refusée (`403`),
   pas rabattue. `resolveScope` `query-contract.ts:L192-203` ; `docs/API_CONSOLE.md:L85-100`.
2. **La plage est résolue une fois.** Preset ou `from/to`, jamais les deux ; `to ≤ maintenant` ; 30 jours
   au plus ; `to` capturé une seule fois par requête. `resolveRange` L267-303. Un graphique affiche
   la plage résolue (`rangeLabel`, L326-336), pas celle demandée.
3. **Un seau de bord est partiel** et une série n'a jamais plus de 300 points. `bucketStarts` L241-250.
   La largeur de seau est celle de `bucketSecondsFor` (L230-235) : elle s'affiche (`bucketLabel`
   L319-323).
4. **Les seaux sont alignés UTC** (`date_bin` sur `2000-01-01 00:00:00+00`, `query-compiler.ts:L308`) ;
   les journées de la heatmap et du trafic 14 j sont découpées dans le **fuseau de l'app**
   (`queries-grid.ts:L108-112`). Un axe temporel dit dans quel fuseau il est lu.
5. **Un filtre non applicable est refusé, jamais ignoré.** `unsupported_dimension` (`query-compiler.ts:
   L165-187` ; `analytics-schema.ts` `parseExplorerPlan` L948-1026). Les lectures historiques annoncent
   ce qu'elles n'appliquent pas (`checkSurface`, `surfaces.ts:L204-214`) : une plage personnalisée
   retombe sur le preset de même seau (`periodOf`, `filters.ts:L99-103`) et l'écran doit le dire.
6. **Les robots sont exclus par défaut** (`includeBots`, `query-contract.ts:L120`) ; l'agrégat
   `rum_rollup_hourly` les inclut, donc il ne sert que si la requête les inclut aussi
   (`analytics-rollups.ts:L136-146` ; `rollupCompatible`, `queries-grid.ts:L31-36`).
7. **Les populations ne s'additionnent pas** : lignes ≠ occurrences (`sum(occurrences)`,
   `analytics-schema.ts:L277-284`) ; sessions ≠ visiteurs ≠ identités déclarées (L182-215) ;
   `null` = « personne de connu », pas zéro (`docs/API_CONSOLE.md:L261-273`). Un graphique n'empile
   jamais deux de ces populations, et rend `null` comme « inconnu ».
8. **Visiteurs = identifiant aléatoire seulement** (`id_kind = 'random'`, L197-206). Les sessions
   sans identifiant sont comptées à part (`unidentified_count`, `queries.ts:L569-578` ;
   `sans_identifiant`, `queries-sessions.ts:L50-58`). Les visiteurs d'un seau ne s'additionnent pas
   d'un seau à l'autre (L50-58).
9. **Additivité** : un seau vide vaut `0` pour `count`/`sum`, `null` pour `avg`/`p75`/`p95`/`distinct`
   (`estAdditive`, L88-90 ; `docs/API_CONSOLE.md:L595-598`). Pas de ligne « Autres » ni de total pour
   un percentile (`breakdowns` : « additionner des p75 n'a pas de sens », parity B2).
10. **Une série temporelle garde ses groupes** : les groupes du haut sont choisis une fois sur toute
    la fenêtre et rendus dans tous les seaux ; `meta.truncated_groups` dit ce qui manque
    (`docs/API_CONSOLE.md:L590-593`).
11. **Le total ne dépend pas du top-N, et le journal ne calcule jamais un graphe** (L585-589 ;
    `MAX_ROWS`, `analytics-schema.ts:L53`).
12. **Un percentile lu sur des seaux est approché, et le dit** (`meta.approximate`, notice « ≈ 1 % »,
    `analytics-rollups.ts:L130-133`). Jamais de moyenne de percentiles horaires ; jamais de `distinct`
    servi par agrégat (L40-46).
13. **Deux mesures de sessions, deux noms** : « commencées dans la fenêtre » (seau-able) et « actives
    chevauchant la fenêtre » (`bucketable: false`), non comparables (`analytics-schema.ts:L334-355`).
14. **Le détail d'une session ou d'une trace n'applique aucun filtre** (`surfaces.ts:L79-83, L96`).
15. **Release et env sont des instantanés par occurrence** ; la release de session ne s'applique pas
    au passé (`query-compiler.ts:L69-78`). Tout ce qui précède v75 a ses dimensions à `NULL` →
    « Inconnu », jamais réparti au jugé (parity B2).
16. **Le pays est « estimé », avec sa provenance** (`DIMENSION_LABELS`, `query-contract.ts:L61-62` ;
    `geo.ts:L15-49`). Ni ville, ni région, ni adresse : aucune IP n'est stockée (parity § 6.4).
17. **Une lecture « vitals » filtre sur le nom** (`CORE_VITALS`, `rating.ts:L12-34`) : `rum_metric`
    porte aussi les phases réseau, les métriques SVI et les démarrages mobiles. La variante `metric` de
    l'Explorer est obligatoire (`analytics-schema.ts:L377-383`).
18. **CLS et INP sont rapportés une fois par chargement** (L397-398) ; un « total CLS » n'existe pas.
19. **Les ressources sont un échantillon biaisé vers le lent** (seuil 300 ms, 20 par vue, parity B4 ;
    notice `analytics-schema.ts:L431-434`) : un total de ressources ne vaut pas le trafic réseau.
20. **Les durées de blocage ne s'additionnent pas en temps vécu** (`analytics-schema.ts:L464-467`) ;
    Long Task et LoAF sont deux API du même blocage (L448-453) — choisir avant de sommer.
21. **Les erreurs sont échantillonnées avec biais** (`sampling.min_inclusion_probability`,
    `queries-errors.ts:L411-421`) ; les comptes sont observés, jamais extrapolés ; `first_seen` est le
    seul champ hors fenêtre (`docs/API_CONSOLE.md:L268`).
22. **Le score de santé exclut et renormalise** une composante sans donnée ; tout vide → `null`
    (`health.ts:L8-10`). Les anomalies sont sur 24 h fixes quelle que soit la période (L7,
    L184-196) ; la heatmap et le trafic quotidien sur 14 j fixes (`GRID_DAYS`, `queries-grid.ts:L17`).
23. **Un budget dépassé rend `503`, jamais une série de zéros** (`docs/API_CONSOLE.md:L603-605` ;
    `ExplorerBudgetError`, `analytics-schema.ts:L634-640`). Un `0` affiché est un vide réel.
24. **La couverture du stockage est annoncée** (`meta.coverage` `complete | partial | unknown`,
    `queries-explorer.ts:L179-186`) : au-delà de `RETENTION_DAYS`, une série est incomplète et le dit.
25. **Le journal unifié commence à v65, sans backfill** (`docs/API_CONSOLE.md:L440-446`) : un
    graphique « événements » sur une plage antérieure sous-compte, et ≈ 97 lignes `rum_event` restent
    non projetées (parity D9).
26. **« Non collecté » n'est pas zéro.** Crashes natifs, ANR, démarrage natif : aucun champ, aucune
    table (`docs/API_CONSOLE.md:L468-474` ; parity D11). `js_error_free_session_rate` n'est pas un
    taux « sans crash » et vaut `null` avec sa raison (L476-481).
27. **Un taux se calcule sur une cohorte filtrée des deux côtés** : `/mobile` refuse `route`, `env`,
    `service`, `country`, `browser` (`surfaces.ts:L65-76` ; `docs/API_CONSOLE.md:L462-467`).
28. **Une comparaison de versions n'est pas à trafic comparable** (`dashboard-blocs.ts:L73-77`) : même
    fenêtre, aucune pondération par route ni appareil.
29. **Un appel SVI ouvert n'a pas d'issue** (`svi_call_outcome_ck`, `migration-v51.sql:L77-80`) ;
    containment, abandon et transfert dérivent tous du même `outcome`.
30. **SLO et alertes portent leur propre fenêtre** ; les filtres de population ne s'y appliquent pas
    (`surfaces.ts:L97-113`). Une alerte `delivered = 0` s'est déclenchée sans avertir personne
    (`queries-v2.ts:L192-198`).
31. **Les valeurs de filtre sont demandées app par app et fenêtre par fenêtre** ; le registre public ne
    publie ni table, ni colonne, ni valeur de client (`docs/API_CONSOLE.md:L507-516`).
32. **Un tableau de bord a 24 cartes, 4 lectures simultanées, pas de rafraîchissement automatique** ;
    une carte invalide reste visible avec son diagnostic (parity B6 ; `dashboards.ts:L56`).
33. **Rien de ce qui précède n'a été vu sur du trafic réel** (parity § 4, § 6.2). Un écran qui affiche
    `0` ne prouve pas l'absence de problème quand rien n'arrive.

---

## 6. Ce que ce relevé n'établit pas

- La correspondance exacte entre `overviewStats.errors` et `sum(occurrences)` (non lu : corps de
  `overviewStats`, `queries.ts:L124-142`).
- Le nom exact de l'événement de retour d'expérience lu par `queries-experience.ts` (non lu : corps
  des requêtes L22-150).
- Le format de `geo_country` selon la provenance (`timezone` vs `geoip` vs `cdn`) — à vérifier dans
  `apps/ingest/lib/geoip-db.mjs` et `_shared/geoip.mjs` avant tout fond de carte.
- Si le SDK web émet aujourd'hui `frustration.rage` / `frustration.dead` et DCL / TTI (non lu :
  `packages/rum-sdk`).
- Le contenu des captures `.jxl` et des vidéos Datadog (non lisibles / non ouvertes ici).
