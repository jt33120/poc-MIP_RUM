# Lecture — documentation Datadog : RUM Explorer et dashboards RUM prêts à l'emploi

Relevé du 18/09/2026, à partir de la documentation officielle `docs.datadoghq.com` (version en ligne à cette date).

## 0. Source, méthode, et ce que ce relevé garantit

**Pages consultées** (WebFetch, version `.md` de chaque page quand elle existait) :

- `https://docs.datadoghq.com/real_user_monitoring/explorer/` (+ `/search/`, `/search_syntax/`, `/group/`, `/visualize/`, `/events/`, `/saved_views/`, `/export/`, `/watchdog_insights/`)
- `https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/` (+ `/performance/`, `/usage/`, `/errors/`, `/testing_and_deployment/`)
- `https://docs.datadoghq.com/real_user_monitoring/browser/data_collected/`, `/monitoring_page_performance/`, `/monitoring_resource_performance/`, `/collecting_browser_errors/`, `/tracking_user_actions/`, `/frustration_signals/`
- `https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/optimizing_performance/` (page « Optimization »)
- `https://docs.datadoghq.com/real_user_monitoring/guide/setup-rum-deployment-tracking/`, `/guide/alerting-with-rum/`
- `https://docs.datadoghq.com/monitors/types/real_user_monitoring/`, `https://docs.datadoghq.com/dashboards/widgets/treemap/`
- `https://docs.datadoghq.com/error_tracking/issue_states/`, `/regression_detection/`, `/explorer/`, `/error_grouping/`
- `https://docs.datadoghq.com/product_analytics/charts/analytics_explorer/visualize/`, `/product_analytics/guide/rum_and_product_analytics/`
- `https://docs.datadoghq.com/standard-attributes/?product=rum`, `https://docs.datadoghq.com/real_user_monitoring/application_monitoring/android/mobile_vitals/`, `/ios/mobile_vitals/`
- Hors Datadog, une seule page : `https://web.dev/articles/vitals` (seuils Google).

**Copies brutes déjà présentes dans le scratchpad**, utilisées pour les libellés exacts et citées avec leur numéro de ligne : `scratchpad/plan/reads/raw/*.md` (chemin complet : `/private/tmp/claude-501/-Users-juliantalou-Documents-PRO-01-CLIENTS-MIP-DEV-poc-MIP-RUM/69c961b4-4adf-49b9-a810-3af9b5d672e7/scratchpad/plan/reads/raw/`). Le relevé vidéo d'un autre lecteur, `scratchpad/plan/reads/datadog-video-rum-db-new.md`, sert uniquement pour ce que la documentation ne dit pas et que l'écran montre ; ces points sont marqués **[observé vidéo]**.

**Trois marques, utilisées partout :**

- **[doc]** : phrase ou libellé présent tel quel dans la documentation (cité en anglais quand c'est un libellé d'interface).
- **[déduit]** : conclusion tirée par moi d'un texte de la documentation qui ne le dit pas explicitement (par exemple, le type de widget derrière « graphs of the average session duration »).
- **[observé vidéo]** : vu sur les images de la vidéo `rum-db-new.mp4`, pas dans la documentation.

**Ce que ce relevé ne garantit pas** : l'état de l'interface réelle au-delà de ce que la documentation décrit ; la liste des widgets exacts de chaque dashboard (la documentation nomme des *sections* et des *KPI*, pas des widgets un à un) ; les noms exacts des variables de template des dashboards RUM (voir § 10.1). Là où je ne sais pas, j'écris « non établi ».

**Ce que je n'ai pas fait** : consulter l'application Datadog elle-même (`app.datadoghq.com`), ni les screenshots `.jxl`/`.webp` du dossier `Downloads` (hors périmètre de cette tâche, réservée à la documentation).

---

## 1. RUM Explorer — structure de l'écran

### 1.1 Ce que l'Explorer permet de faire [doc]

Page `explorer/` : « The Real User Monitoring (RUM) Explorer allows you to examine data collected from your applications and granular information about your RUM events. » Trois usages listés :

- « Navigate through user sessions, including between sessions from the same user with session continuity »
- « Investigate performance issues affecting views, resources, or actions »
- « Troubleshoot application errors and long tasks »

Quatre sections dans la page : **View by application** (« Use the application selector in the top navigation to select and view all RUM data for a specific application »), **Search and filter** (« typing in the search bar and selecting a visualization type […] Use autocomplete suggestions to view facets and recent queries »), **Group** (« Group the RUM events you have queried into higher-level entities »), **Visualize** (« Select a visualization for your filters and aggregations »).

### 1.2 Mise en page [observé vidéo] — la documentation ne décrit pas la disposition

D'après `datadog-video-rum-db-new.md` § 2 : barre de titre (sélecteur de jeu « Views », « + Save », fenêtre « Past 1 Hour », défilement temporel avec pause, « Learn More ») ; onglets **Applications · Sessions & Replays · Dashboards** ; barre de requête « In [Views ▾] » suivie de pastilles retirables (`Application Id:Shop.ist ×`, `Has Replay:true ×`, `View Path:/ ×`) et d'un bouton `</>` pour la même requête en texte ; rangée **« Visualize as »** : List · Timeseries · Top List · Table · Distribution · Geomap · Funnel ; colonne de facettes à gauche (« Search facets », « Showing 175 of 175 », « + Add », groupes APPLICATION / CORE / BROWSER / GEO / DEVICE / OS / VIEW URL, chaque valeur avec case à cocher et compte) ; deux widgets de contexte au-dessus de la liste (« View count » en barres, « Page loading time distribution » en histogramme avec repères p50/p75/p90/p95) ; « Hide Controls », « Hide Metrics », « Export », « Options » ; bandeau « Watchdog Insights ».

Ce que la vidéo garantit : ces éléments existent sur l'écran Views de l'application de démonstration. Ce qu'elle ne garantit pas : que la même disposition vaut pour les autres jeux (Sessions, Errors…).

### 1.3 Types d'événements et rétention [doc]

Page `explorer/search/`, section « Event types » : « select an event type from the dropdown menu to the left of the search bar ».

| Type | Rétention | Définition [doc] |
|---|---|---|
| Session | 30 days | « A user session begins when a user starts browsing the web application. It contains high-level information about the user (such as browser, device, and geolocation). » |
| View | 30 days | « A view event is generated each time a user visits a page of the web application. » |
| Action | 30 days | « RUM action events track user interactions during a user journey and can be manually sent to monitor custom user actions. » |
| Error | 30 days | « RUM collects every frontend error emitted by the browser. » |
| Resource | 15 days | « A resource event is generated for images, XHR, Fetch, CSS, or JS libraries loaded on a webpage. » |
| Long Task | 15 days | « A long task event is generated for any task in the browser that blocks the main thread for more than 50ms. » |

Un septième jeu, **Vitals** (custom vitals), n'apparaît pas dans cette table ; il est documenté seulement par ses requêtes : « `@vital.name:dropdownRendering` and `@vital.duration:>10` » (page `monitoring_page_performance/`, section Custom Vitals). Le fait qu'il soit sélectionnable dans le menu déroulant : non établi.

Durée de session [doc] : `session.is_active` — « The session ends after 4 hours of activity or 15 minutes of inactivity. » (`raw/real_user_monitoring_application_monitoring_browser_data_collected.md`, l. 59).

### 1.4 Facettes et mesures [doc]

Page `explorer/search/`, section « Setup facets and measures » :

- « All RUM events contain attributes, which are automatically collected by the RUM SDKs, and your custom attributes. » Les attributs automatiques sont indexés et facettés par défaut ; « custom event attributes are not indexed and faceted by default. Index these attributes by creating a facet or measure ».
- **Facet** : « A facet displays all distinct members of an attribute or tag and provides basic analytics, such as the number of RUM events represented. » Création : clic sur l'attribut dans le side panel de l'événement, ou bouton **« + Add »** du panneau de gauche ; options avancées : display name, type, group, description.
- **Measure** : « A measure is an attribute with a numerical value contained in your RUM events. » Création par clic sur un attribut numérique ; unité affichée dans l'Explorer et les visualisations.
- Recherche d'une facette : « add it as a facet and enter `@` in your search query » ; exemple `@url:www.datadoghq.com`. Note : « If you are including a facet in your query, be sure to create the facet first. »

Groupes de facettes affichés par défaut : APPLICATION, CORE, BROWSER, GEO, DEVICE, OS, VIEW URL **[observé vidéo]** ; la page `visualize/` (Funnels › Filtering) nomme aussi « default attributes (core, device, operating system, geolocation, and user) » [doc].

### 1.5 Plage temporelle [doc]

« After applying a time range on the top right, you can find events with `key:value` pairs and a full-text search ». Presets et plages custom renvoyés à la page « Custom Time Frames » des dashboards. Valeur par défaut : non établi (la vidéo montre « Past 1 Hour » [observé vidéo]).

---

## 2. Recherche — syntaxe exacte [doc]

Page `explorer/search_syntax/` :

- Une requête = termes + opérateurs. **Single term** (`test`), **Sequence** (« Group of words surrounded by double quotes »).
- Opérateurs : `AND` (« Intersection […] default if omitted »), `OR` (« Union »), `-` (« Exclusion »).
- Caractères spéciaux à échapper : `?`, `>`, `<`, `:`, `=`, `"`, `~`, `/`, `\`. Espace dans un nom de facette : `@user.first\ name:myvalue`.
- Wildcard multi-caractères `*` : `@http.url:https:\/\/*`.
- Comparaisons numériques `<`, `>`, `<=`, `>=` : `@session.error.count:>5` ; intervalle `@session.error.count:[3 TO 10]`.
- Exemples RUM donnés tels quels : `@view.url_path:"/department/sofas"`, `@view.url_path:\/department\/sofas\/*`, `@view.loading_time:[1s TO 3s] @view.url_path:\/department\/sofas\/*` (les unités de durée `s` sont acceptées dans un intervalle).
- Autocomplétion sur les valeurs existantes.
- Exemple de filtre de la page `search/` : `@session.type:user`.

Ce que la syntaxe garantit : un filtre exact, un préfixe, un intervalle. Ce qu'elle ne garantit pas : une recherche par expression régulière (non mentionnée).

---

## 3. Group into fields — agrégations [doc]

Page `explorer/group/` (libellé de section : **« Group into fields »**) :

- « All RUM events that match your filter query are aggregated into groups based on the value of one or several event facets. »
- Mesures : « Count of events per group » ; « Unique count of coded values for a facet per group » ; « Statistical operations (such as minimum, maximum, average, and percentiles) on a facet's numerical values per group ». La liste exacte des percentiles n'est pas donnée ici ; la page des monitors RUM énumère `min`, `avg`, `sum`, `median`, `pc75`, `pc90`, `pc95`, `pc98`, `pc99`, `max` (voir § 11) ; le side panel Watchdog affiche `p50`, `p75`, `p99`, `max`. **[déduit]** : l'Explorer propose au moins p50/p75/p90/p95/p99.
- Dimensions : « supports one dimension for the Top list visualization and up to three dimensions for the timeseries, list and table visualizations ».
- Règle de tri hiérarchique : « the top values are determined based on the first dimension, then the second dimension within the top values of the first dimension, then the third dimension within the top values of the second dimension ».
- Multi-valeur : « Individual events with multiple values for a single facet belong to that number of aggregates. »
- « Your selection of fields to group, aggregate, and measure your events are preserved as you switch between visualization types. »

Non documenté sur cette page : « bottom N », « Patterns », « Transactions » (le mot « Patterns » n'apparaît pas pour RUM).

---

## 4. Visualisations — inventaire exact

Page `explorer/visualize/` (texte intégral relu). Libellés de titres de section : **Lists, Timeseries, Top list, Nested tables, Distributions, Geomaps, Funnels, Pie charts, Related events**. Le bouton d'interface s'appelle **« Visualize as »** [doc, page Watchdog : « select the Visualize as type under the search query »] et affiche List · Timeseries · Top List · **Table** · Distribution · Geomap · Funnel [observé vidéo] — « Table » à l'écran correspond à « Nested tables » dans la documentation [déduit].

| Visualisation | Ce qu'elle montre [doc] | Mesures / dimensions [doc] | Options d'affichage [doc] | Exemple documenté | Ce qu'elle permet de conclure |
|---|---|---|---|---|---|
| **Lists** | « paginated results of events and are ideal when individual results matter. You do not need prior knowledge of what defines a matching result » | Colonnes = champs ; tri par n'importe quelle colonne, facette ou mesure ; « Surface RUM events with the lowest or highest value for a measure first, then sort your events lexicographically for the unique value of a facet » | Colonnes triables, réordonnables, supprimables ; ajout d'une colonne depuis le panneau de facettes ou le side panel ; « non-faceted attributes […] may not sort correctly » ; configuration stockée dans les Saved Views | Tri par Loading Time ↓ puis clic sur la pire ligne [observé vidéo] | [doc] identifier les cas individuels extrêmes ; [déduit] point d'entrée vers le side panel |
| **List widget** (dashboards, Notebooks) | « shows individual events for a given data source, including RUM data […] like all errors on a particular page » | — | — | — | Même chose, posé sur un dashboard |
| **Timeseries** | « the evolution of a single measure (or a facet unique count of values) over a selected time frame, and optionally, split by an available facet » | 1 mesure (ou unique count) ; split par 1 facette ici, jusqu'à 3 selon la page `group/` | « bars (recommended for counts and unique counts), lines (recommended for statistical aggregations), areas, and several color sets » ; « The roll-up interval: Determines the width of buckets in the bars » | « number of pageviews on the Shopist application over the past day for every view path » | [doc] tendance dans le temps, comparée entre valeurs d'une facette ; [déduit] repérer un pic ou une cassure, pas sa cause |
| **Top list** | « the top values from a facet based on your chosen measure » | 1 dimension (page `group/`) ; 1 mesure | Bar graph | « top browsers used to visit the Shopist website over the last day » | [doc] classement ; [déduit] ne dit rien du volume relatif au total sans mesure « count » |
| **Nested tables** | « the top values from up to three facets according to your chosen measure (the first measure you choose in the list) and display the value of additional measures » | jusqu'à 3 facettes, plusieurs mesures | « the top or bottom list is determined according to the first measure » ; « The subtotal may differ from the actual sum of values in a group since only a subset (top or bottom) is displayed. Events with a null or empty value for this dimension are not displayed as a sub-group » ; « A table visualization used for one single measure and one single dimension is the same as a top list » | « top 5 URL paths for two countries, US and Japan, grouped by browser, over the last day » | [doc] croiser deux ou trois dimensions ; [doc] les sous-totaux ne sont pas des totaux |
| **Distributions** | « the distribution of measure attributes over the selected time frame to see the values fluctuate » | 1 mesure | Repères p50, p75, p90, p95 sur l'histogramme [observé vidéo] ; non exportable en CSV [doc, page export] | « distribution of the Largest Contentful Paint […] of the Shopist landing page » | [doc] forme de la distribution d'une mesure ; [déduit] situer un percentile, voir une longue queue |
| **Geomaps** | « a single measure (or a facet unique count of values) on the world map » | 1 mesure, dimension = pays | — | « 75th percentile of the Largest Contentful Paint over the past day » | [doc] variation géographique d'une mesure |
| **Funnels** | « track conversion rates across key workflows to identify and address any bottlenecks in end-to-end user journeys » ; « conversion rate is the number of visitors to your website that completed a desired goal (a conversion) out of the total number of visitors » | Étapes = views ou actions ; comptage par session | Construction : « choose your starting view or action and click on the plus icon » ; drag-and-drop ; **Suggested next steps** : champ « Search for View or Action Name » qui « automatically loads the top most common views and actions that users typically see and take next » ; **« Add Filter »** (attributs core, device, OS, géo, user, session) ; règle : « Any action or view that happens between two steps in a funnel does not impact the step-by-step or overall conversion rate. As long as step 1 and step 2 happen in the right order in a given session at least once, it counts as a single converted session » | — | [doc] « See if customers drop off at a certain point due to poor website performance » ; « Track how the conversion rate changes over time as new features are built » ; « Measure how adding new steps to a workflow impacts drop off rate » |
| **Funnel Insights** (panneau) | Bouton **« View Funnel Insights »** → « Funnel Analysis panel » | — | Sections : taux de conversion bout en bout et par étape ; Session Replay d'un converti vs d'un abandon ; **Performance** : « a graph with a correlation between the load time of that page and the conversion rate » + issues Error Tracking sur la page ; **User Behavior** : « compare the average frustration count […] with the conversion rate » + « conversion and drop off rate for specific countries » | — | [doc] relier abandon et performance / frustration / pays |
| **Pie charts** | « organize and show data as a percentage of a whole […] comparing the relationship between different dimensions such as services, users, hosts, countries » | 1 dimension, 1 mesure | — | « percentage breakdown by View Path » | [doc] part d'un tout |
| **Tree map** | **Absent de la page `visualize/` RUM.** Documenté (a) dans l'explorateur Product Analytics : « nested rectangles […] Compare different dimensions using both size and colors of the rectangles […] select multiple attributes to view a hierarchy » ; exemple « percentage breakdown by View Name » ; (b) comme **Treemap widget** de dashboard acceptant la source `rum` (exemple : « unique page views […] at both the country and browser level ») ; (c) sur la page Optimization : « Treemap of most visited pages » | dimension(s) hiérarchiques, 1 mesure de taille | — | — | [doc] part d'un tout avec hiérarchie ; disponibilité dans le menu « Visualize as » de l'Explorer RUM : non établi |
| **Related events** | « For all visualizations, select a section of the graph or click on the graph to either zoom in or see a list of events that correspond to your selection » ; « click on the graph and click View events » | — | — | — | [doc] tout agrégat mène à ses événements |

Depuis le 1er juin 2025 [doc, guide `rum_and_product_analytics/`] : « Product Analytics Summary, Retention Analytics, and Pathways (formerly Sankeys) are now part of Product Analytics » ; « The Funnel and Conversion tabs continue to be available in the RUM Explorer ». Rétention : RUM « 15 to 30 days », Product Analytics « 15 months ». Heatmaps : Product Analytics avec Session Replay.

---

## 5. Side panel d'un événement (« Events Side Panel »)

Source : `raw/real_user_monitoring_explorer_events.md` (147 lignes) — tout est [doc] sauf mention.

### 5.1 Ouverture et en-tête

- « click on a table row in the List visualization type » (l. 15).
- En-tête : « contextual information about your users (environment, country) and event-specific details like view path and loading type. For Synthetic test runs, click the test ID to view the result » (l. 17).
- [observé vidéo] en-tête « VIEW · Load Page / », bouton **« Jump to Replay »**, tags `service`, `env`, `version`, navigateur, pays, utilisateur ; « View Name », « View Loading Type:initial_load », « View Time Spent » ; « Parent Hierarchy : SESSION — Browser session lasting 2m by user Jane Doe ».

### 5.2 Distribution en tête de panneau (l. 19)

« The distribution visualization at the top helps you understand whether the current view is close to the median or is an outlier. » Menu déroulant : **Loading Time** (« Time until the page is ready and no network request or DOM mutation is happening. Mobile apps have a different, manually reported loading time »), **Time To First Byte**, **FCP**, **LCP**, **CLS**, **INP**, **Refresh Rate**, **Memory Average**. « Adjust the time range to view data by day, week, or month. »

Ce que cela garantit : la valeur de l'événement ouvert est située par rapport à la population. Ce que la doc ne dit pas : quelle population (même vue ? même application ?) — non établi.

### 5.3 Onglet Waterfall (l. 41-72)

- « an interactive timeline of the events associated with this view. Overlays display key performance markers, including Core Web Vitals or mobile timings, with pass or fail indicators. »
- Filtres : **« By critical path »** — « Click the Critical Events toggle to see only events directly impacting your key performance timings » ; **« By attribute »** — « filter buttons above the waterfall […] resource URL, action name, error message » ; **« By time range »** — « Drag the time selectors in the minimap, or expand the left sidebar and click a timing to filter to events before that point ».
- « The left sidebar reveals key timings, including custom timings from the addTiming API. »
- Survol : « timestamp, duration, and contributing factors (scripts, style/layout, or other processing). Hover over a Core Web Vital to view its definition, threshold, and how it compares to your p75. » Alt de l'image : « Loading Time popover showing performance details, threshold indicators, and comparison to p75 performance ».
- Connected telemetry : « Resources: View connected backend traces. Long Animation Frames: Access associated profiles ».
- [observé vidéo] mini-carte à quatre pistes (Actions, Errors, Resources, Long tasks), colonnes NAME / SIZE / DURATION, marqueurs FCP / LCP / LT, pied « Displaying 32 out of 32 events — See full list of events for this View in the RUM explorer ». L'onglet s'appelle « Performance » à l'écran de la vidéo et « Waterfall » dans la doc : les deux existent, l'écart de nom n'est pas expliqué.

### 5.4 Autres onglets (l. 74-131)

**Replay** (« Watch a visual replay of the user's session »), **Errors** (« View errors associated with the event »), **Resources** (« Inspect all resources loaded during the event »), **Traces** (« See backend traces connected to the event »), **Feature Flags** (« View feature flags evaluated during the event »), **Actions** (« Review user actions captured during the session »), **Logs** (« Access logs associated with the event »), **Attributes** (« View collected context attributes »).

### 5.5 Side panel par type d'événement

La documentation décrit le panneau d'une **view**. Pour session, action, error, resource, long task : la page frustration signals dit seulement que les signaux apparaissent dans « Actions, Views, Sessions, and Errors tabs in side panels » et que pour une session « You can see the type of signal (`rage click`, `dead click`, or `error click`) and the event timeline » (`raw/real_user_monitoring_browser_frustration_signals.md`, l. 124). Contenu détaillé des panneaux action / error / resource / long task : **non établi**.

### 5.6 Navigation entre sessions d'un même utilisateur (l. 28-33)

« When `@usr.id` is set in the RUM SDK and you filter the Explorer by a specific `@usr.id` value, Previous and Next buttons appear in the session side panel. » Limite documentée : « Only sessions retained by retention filters appear in the navigation. Non-retained sessions are skipped […] with no indication that a session occurred in between. »

---

## 6. Vues enregistrées (Saved Views) [doc]

Page `explorer/saved_views/` :

- Une vue enregistre : le type d'événements (« sessions, views, errors, actions, resources, and long tasks »), la requête, « Column sort order », « Live time range (such as the past hour or the past week) », « Visualizations (such as a timeseries, toplist, table, or funnel graph) », « Subset of facets ». La page search syntax le résume : « Saved Views contain your search query, columns, sort order, time range, and facets ».
- Libellés : panneau **« Views »**, bouton **« Save »** (« + Save » [observé vidéo]), **« Default view »**, « Sessions & Replays tab ».
- Partage : « All saved views except for the default view are shared across the organization » ; vues custom « editable by anyone in your organization and display the user's avatar who created the view » ; **« Saved view templates »** « predefined in the RUM Explorer » (avatar Datadog) ; lecteurs read-only : « Update, rename, and delete actions are disabled ».
- Opérations : charger, mettre à jour avec la configuration courante, renommer, supprimer, partager par lien court, mettre en favori.
- Default view : par utilisateur ; « Temporarily override your default saved view by completing an action in the UI ».

---

## 7. Export [doc]

Page `explorer/export/` (« Export RUM Events and Graphs ») : bouton **« More »** « on the right hand corner » de l'Explorer, puis :

- « Copy your query as a cURL command »
- « Export your search results to a monitor that triggers alerts on predefined thresholds »
- « Export your search results to an existing notebook »
- « Download your search results as a CSV file for individual RUM events and specific aggregations »
- « Generate a new metric using your search results » (visible dans Metrics Explorer)

Limites : « You can export up to 5,000 individual RUM events with lists and up to 500 aggregations for timeseries, top lists, and table graphs. » ; « you cannot download a distribution graph into a CSV file ».

Export vers **dashboard** : la description de la page dit « Export RUM queries, visualizations, and events to dashboards, monitors, notebooks » et la page Watchdog parle d'« export it into a monitor or dashboard » ; la page Deployment Tracking dit que la table des versions est « exportable to dashboards ». L'entrée exacte du menu « More » pour un dashboard n'est pas citée : libellé **non établi**. API : « Search RUM Events endpoint ».

---

## 8. Watchdog Insights pour RUM [doc]

Source : `raw/real_user_monitoring_explorer_watchdog_insights.md`.

- « The pink Watchdog Insights banner appears in the RUM Explorer and displays insights about the search query over a period of time. » Actions : **« View all »**, **« Filter on Insight »** (« add the anomalous insight behavior to your search query »), **« View in Analytics »** (« automatically set the Group into fields formulas and select the Visualize as type »).
- **Error outliers** : « Statistically overrepresented `key:value` pairs among errors » ; carte = « The field name », « The proportion of total errors and overall RUM events that the field contributes to », « Related tags » ; side panel = timeseries des erreurs avec le champ + « impact pie charts » + liste d'événements. Exemples : `env:staging`, `version:1234`, `browser.name:Chrome`.
- **Latency outliers** : « `key:value` pairs with worse performance than the baseline » ; calculés « for Core Web Vitals such as First Contentful Paint, First Input Delay, Cumulative Layout Shift, and Loading Time » ; carte = « The performance telemetry value containing the field and the baseline for the rest of the data » ; side panel = timeseries « with an X axis of increments of `p50`, `p75`, `p99`, and `max` ».
- [observé vidéo] bandeau replié : badge « 3 », « Error outliers and latency outliers », « View all ».

Ce que la doc ne dit pas : le test statistique, le seuil de sur-représentation, la fenêtre de baseline — non établi.

---

## 9. Données et règles chiffrées

### 9.1 Attributs par type d'événement [doc]

Source : `raw/real_user_monitoring_application_monitoring_browser_data_collected.md` (numéros de ligne entre parenthèses). Unités : les durées sont en **nanosecondes** (`number (ns)`).

**Session** (l. 46-73) : `session.time_spent` (ns), `session.view.count`, `session.error.count`, `session.resource.count`, `session.action.count`, `session.long_task.count`, `session.id`, `session.ip`, `session.is_active`, `session.type` (`user` ou `synthetics` — « Sessions from Synthetic Monitoring Browser Tests are excluded from billing »), `session.referrer`, `session.initial_view.{id,url_host,url_path,url_path_group,url_query,url_scheme}`, `session.last_view.{…}`. `url_path_group` = « The automatic URL group generated for similar URLs (for example, `/dashboard/?` for `/dashboard/123` and `/dashboard/456`) » (l. 65).

**View** (l. 81-106) : `view.time_spent`, `view.first_byte` (« Time elapsed until the first byte of the view has been received »), `view.largest_contentful_paint`, `view.largest_contentful_paint_target_selector`, `view.performance.lcp.sub_parts.{load_delay,load_time,render_delay}`, `view.first_input_delay`, `view.first_input_delay_target_selector`, `view.interaction_to_next_paint`, `view.interaction_to_next_paint_target_selector`, `view.performance.inp.sub_parts.{input_delay,processing_duration,presentation_delay}`, `view.cumulative_layout_shift`, `view.cumulative_layout_shift_target_selector`, `view.loading_time` (« Time until the page is ready and no network request or DOM mutation is currently occurring »), `view.first_contentful_paint`, `view.dom_interactive`, `view.dom_content_loaded`, `view.dom_complete`, `view.load_event`, `view.error.count`, `view.long_task.count`, `view.resource.count`, `view.action.count`.

**Resource** (l. 114-159) : `resource.duration`, `resource.size` (bytes), `resource.connect.duration` (connectEnd − connectStart), `resource.ssl.duration` (« If the last request is not over HTTPS, this attribute does not appear »), `resource.dns.duration`, `resource.redirect.duration`, `resource.first_byte.duration` (responseStart − requestStart), `resource.download.duration` (responseEnd − responseStart) ; `resource.type` (`css`, `javascript`, `media`, `XHR`, `image` ; la page resources ajoute `font`), `resource.method`, `resource.status_code` (« available for fetch/XHR resources only »), `resource.url`, `url_host`, `url_path`, `url_query`, `url_scheme`, `resource.provider.{name,domain,type}` (type : `first-party`, `cdn`, `ad`, `analytics` ; défaut `unknown`), en-têtes si `trackResourceHeaders`, attributs GraphQL si `allowedGraphQlUrls`. Cross-origin [doc, page resources] : timings soumis à `Timing-Allow-Origin`, status codes à `Access-Control-Allow-Origin` + attribut `crossorigin`.

**Long task** (l. 165) : `long_task.duration`.

**Error** (l. 171-174 ; `raw/error_tracking_frontend_collecting_browser_errors.md` l. 32-44) : `error.source` (`agent`, `console`, `custom`, `report`, `source` — ce dernier « From unhandled exceptions or unhandled promise rejections »), `error.type`, `error.message`, `error.stack`, `error.causes`. Error Tracking ne traite que les sources `custom`, `source`, `report`, `console` « that contain a stack trace ». `error.handling` : documenté côté Error Tracking Explorer — « RUM errors are `unhandled` if they are not captured manually in the code » (`raw/error_tracking_explorer.md`, table des facettes).

**Action** (l. 188-200 ; `raw/browser_tracking_user_actions.md` l. 38, 75) : `action.id`, `action.type` (`custom` pour l'API), `action.target.name`, `action.name` (« Click on #checkout »), `action.loading_time`, `action.long_task.count`, `action.resource.count`, `action.error.count`. Règle : « An action is considered complete when the page has no more activity » ; « when the same element is clicked multiple times in a row, which is considered a single action ». Nommage automatique : `data-dd-action-name` > (`enablePrivacyForActionName` → « Masked Element ») > `label` / `placeholder` / `aria-label` > texte interne.

**Frustration** (l. 206-210) : `session.frustration.count`, `view.frustration.count`, `action.frustration.type:{dead_click,rage_click,error_click}`.

**UTM** (l. 216-220) : `view.url_query.utm_{source,medium,campaign,content,term}`.

**Attributs standard communs** (page `standard-attributes/?product=rum`) : `date`, `type`, `application.id`, `application.name` ; `device.type/brand/model/name` ; `os.name/version/version_major` ; `geo.country`, `geo.country_iso_code`, `geo.country_subdivision`, `geo.continent_code`, `geo.continent`, `geo.city` ; `usr.id/name/email` ; `connectivity.status` (`connected`, `not connected`, `maybe`), `connectivity.interfaces`, `connectivity.cellular.{technology,carrier_name}` ; `view.id`, `view.url`, `view.name` ; `session.useragent`. `service`, `env`, `version` : présents comme tags de déploiement (§ 10.6) mais absents de cette table — leur statut d'attribut standard : non établi.

### 9.2 Core Web Vitals — seuils

Source : `raw/browser_monitoring_page_performance.md`, l. 34-64.

[doc] « Datadog recommends monitoring the 75th percentile for these KPIs. » Table « Target value » :

| Datapoint | Focus | Target value [doc] | Seuil « poor » |
|---|---|---|---|
| Largest Contentful Paint | Load performance | `<2.5s` | non documenté chez Datadog ; Google : > 4 s **[externe, déduit de web.dev]** |
| Interaction To Next Paint | Interactivity | `<200ms` (« Requires RUM SDK v5.1.0 ») | Google : > 500 ms **[externe]** |
| Cumulative Layout Shift | Visual stability | `<0.1` | Google : > 0,25 **[externe]** |
| First Input Delay | — | non listé dans la table actuelle ; attribut `view.first_input_delay` toujours collecté | non établi |

La page web.dev consultée confirme 2,5 s / 200 ms / 0,1 et « the 75th percentile of page loads, segmented across mobile and desktop devices » ; elle ne donne plus les seuils FID. La documentation Datadog ne publie pas de bande « Needs improvement » ; le waterfall affiche des « pass or fail indicators » (§ 5.3) — **[déduit]** deux états à l'écran, pas trois.

Conditions de collecte [doc, l. 62-64] : LCP « Reported on the initial view only […] Not reported if the page starts hidden, if the user interacts before any LCP entry arrives, or after a 10-minute cap » ; INP « Reported on every view, including SPA route changes. Requires at least one user interaction » ; CLS « Reported on every view, including SPA route changes ».

Élément cible [doc, l. 53-56] : sélecteur CSS de l'élément LCP, de l'interaction INP la plus longue, du premier élément touché (FID), de l'élément le plus déplacé (CLS).

Note [doc, l. 41] : « Synthetic Monitoring displays Largest Contentful Paint and Cumulative Layout Shift as lab telemetry, not real telemetry. »

### 9.3 Loading Time et activité de page [doc]

`raw/browser_monitoring_page_performance.md`, l. 148-189 :

- `loading_type` : `initial_load` ou `route_change` (« If an interaction on your web page leads to a different URL without a full refresh of the page, the RUM SDK starts a new view event with `loading_type:route_change` » ; History API et `HashChangeEvent`).
- « Datadog provides a unique KPI, `loading_time`, which calculates the time needed for a page to load. This KPI works for both `initial_load` and `route_change` navigation. »
- **Initial Load** : « whichever is longer » entre `navigationStart → loadEventEnd` et `navigationStart → first time the page has no activity`.
- **SPA Route Change** : « the difference between the URL change and the first time the page has no activity ».
- Activité : requêtes `xhr`/`fetch` en cours, entrées performance resource timing, mutations DOM ; « The page activity is considered to have ended when it hasn't had any activity for 100ms. » La doc liste elle-même des cas où « The criteria of 100ms […] might not be an accurate determination » (l. 189).
- Réglage manuel : `setViewLoadingTime()` (« Last-call-wins; stops automatic detection ») ; `excludedActivityUrls` ; attribut `data-dd-excluded-activity-mutations`.
- Custom timings : `addTiming('name')` → `@view.custom_timings.<name>` (ns).

### 9.4 Frustration signals — règles exactes [doc]

`raw/real_user_monitoring_browser_frustration_signals.md` :

- **Rage click** (l. 29) : « A user clicks on an element more than three times in a one-second sliding window. » Le dashboard Usage le formule « more than 3 times in a 1 second sliding window ».
- **Dead click** (l. 37) : « A user clicks on a static element that produces no action on the page. » Aucune fenêtre temporelle n'est publiée.
- **Error click** : « A user clicks on an element right before a JavaScript error occurs. » Le dashboard Usage : « When a user clicks an element and encounters a JavaScript error. » Aucun délai publié.
- Activation : `trackUserInteractions: true` (SDK ≥ 5.0.0 ; avant, aussi `trackFrustrations: true` ; minimum SDK 4.14.0).
- Requête type (l. 109) : `action.frustration.type:rage_click`.
- Exclusion (l. 186) : « Frustration signals are generated from mouse clicks, not keyboard strokes. »
- Où : RUM Applications page (liste des sessions), RUM Explorer (colonne « Options » et « Frustration Count »), Session Replay, Frustration Signals dashboard, onglets des side panels.

### 9.5 Erreurs — regroupement, états, régression [doc]

- **Regroupement en issues** (`raw/error_tracking_error_grouping.md`, l. 16-22) : empreinte calculée sur `error.type` (ou `error.kind`), `error.message`, et « The filename and function name of the top-most meaningful stack frame » ; « If any stack frame properties differ for two given errors, the two errors are grouped under different issues […] Error Tracking also ignores numbers, punctuation, and anything that is between quotes or parentheses: only word-like tokens are used. » Surcharge : `error.fingerprint` (l. 35-43 ; « Errors with different `service` attributes are grouped into different issues »).
- **Étiquettes** (`raw/error_tracking_explorer.md`, l. 30-36) : `New` « if the issue was first seen less than two days ago and is in state FOR REVIEW » ; `Regression` « if the issue was RESOLVED and occurred again in a newer version » ; `Crash` ; « Suspected Cause ».
- **Tris** : Relevance (« prioritize code related, recent, or spiking issues […] how old issues are, occurrences over the last day, notable increase over the past hour, or if they triggered an application crash »), Count, Newest, Impacted Sessions.
- **États** (page `issue_states/`) : FOR REVIEW (« New or regressed issues that need attention »), REVIEWED, RESOLVED, IGNORED, EXCLUDED. Passage automatique à REVIEWED si assignée ou si un work item est créé. **Résolution automatique** : « If the issue was last reported in a version that is more than 14 days old, and a newer version has been released but does not report the same error » ; sans tags de version : « no new errors reported for that issue within the last 14 days ».
- **Régression** (`raw/error_tracking_regression_detection.md`, l. 14-24) : « A regression refers to the unintended reappearance of a bug or issue that was previously fixed. » Déclenchement : « If a RESOLVED error recurs in a newer version of the code, or the error occurs again in code without versions, Error Tracking triggers a regression. The issue moves to the FOR REVIEW state, and is tagged with a Regression tag. » « Regressions take into account the versions of your service where the error is known to occur, and only trigger on new versions after an issue is marked as RESOLVED. » Sans tags de version : « issues are tagged with Regression when an error occurs on an issue marked as RESOLVED ».

À retenir : chez Datadog, le mot « régression » est **une notion d'Error Tracking** (réapparition d'une issue résolue, en version plus récente). Il n'existe **pas** de règle documentée de « régression de performance » ; la comparaison entre versions est faite à l'œil sur les widgets de Deployment Tracking (§ 10.6). La règle d'ordre des versions (sémantique ou chronologique) : non établie.

### 9.6 Mobile vitals — seuils [doc]

Pages `android/mobile_vitals/` et `ios/mobile_vitals/` :

| Vital | Règle documentée | Attributs |
|---|---|---|
| Refresh rate | « should render frames in under 60Hz » ; normalisé 0–60 fps | `@view.refresh_rate_average`, `@view.refresh_rate_min` |
| Slow renders | frames « taking longer than 16ms or 60Hz to render » | idem |
| Frozen frames | « Frames that take longer than 700ms to render » ; remontés comme long tasks « for any task taking longer then 100ms » | long task |
| ANR (Android) | « UI thread […] blocked for more than 5 seconds » | — |
| Hang rate (iOS) | « number of seconds per hour that the app is unresponsive, while only counting periods of unresponsiveness of more than 250 ms » | — |
| CPU ticks per second | « <40 for good and <60 for moderate » | `@view.cpu_ticks_per_second` |
| Memory | « <200MB for good and <400MB for moderate » | `@view.memory_average` |
| Crash-free sessions by version | « unexpected exit in the application typically caused by an unhandled exception or signal » | — |

---

## 10. Dashboards RUM prêts à l'emploi

### 10.1 Accès, variables, personnalisation [doc]

Page `platform/dashboards/` :

- « When you create a RUM application, Datadog collects data and generates dashboards about your application's performance, errors, resources, and user sessions. »
- Accès : « filtering for `RUM` in the search query of the Dashboard List », ou depuis « application summary pages » sous Digital Experience ; page performance : « switch to the Performance tab, then click the View Dashboard link ».
- Quatre familles nommées : **Performance Overviews** (« See a global view of your website/app performance and demographics »), **Testing and Deployment** (« Evaluate your browser tests' application coverage and identify popular elements in your application to track using RUM and Synthetics data »), **Usage** (« Analyze user session and usage data for your RUM applications, including frustration signals »), **Errors** (« Observe errors that appear in user consoles by browser and device type »).
- Variables de template : « The generated RUM dashboards automatically contain a set of default template variables […] Use the template variable dropdowns to select values and narrow your search. » **Les noms exacts ne sont pas listés.** [déduit] à partir de Deployment Tracking (`version`, `env`, `service`) et de l'attribut `@application.id` : au moins l'application, l'env et la version ; à confirmer sur l'application.
- Drill-down : « clicking graphs and selecting "View RUM events" » → Explorer pré-filtré.
- Personnalisation : « Settings icon and select Clone dashboard », puis « + icon at the bottom » pour ajouter des widgets.

La documentation nomme des **sections** et des **KPI** par dashboard, jamais la liste complète des widgets avec leur type. Dans les tables ci-dessous, la colonne « type probable » est **[déduit]** du vocabulaire (« graphs of » → timeseries ; « tables below list » → table ; « top » → top list ; « by country » → geomap ou top list).

### 10.2 Performance Overview — Web App Performance [doc]

Page `platform/dashboards/performance/` : « offers a bird's-eye view of RUM web applications ». Alt : « Out-of-the-box RUM Web App Performance Overview Dashboard ».

| Section [doc] | Contenu [doc] | Type probable [déduit] |
|---|---|---|
| **Core web vitals** | « For all views, additional browser KPIs are highlighted: Largest Contentful Paint, First Input Delay, and Cumulative Layout Shift. Other performance telemetry, such as Load Time, is also available. » | valeurs p75 + timeseries |
| **XHR and Fetch requests and resources** | aide à « identify loading bottlenecks » | top list / table par URL |
| **Long tasks** | « Events blocking the browser's main thread exceeding 50 milliseconds » | timeseries + top list |

Conclusion permise [doc] : vue globale performance ; [déduit] pas de diagnostic par élément (celui-ci est sur la page Optimization, § 10.7).

### 10.3 Performance Overview — Mobile App Performance [doc]

« gives an overview of RUM mobile applications » ; sections **Mobile vitals** (« slow renders, CPU ticks per seconds, frozen frames, and memory usage »), **Resources analysis** (« Identifying content request bottlenecks »), **Crashes and errors** (« Surfacing crash and error locations »). « App launch time » et « crash-free sessions » n'apparaissent pas dans le texte de cette page (ils apparaissent dans Deployment Tracking mobile, § 10.6).

### 10.4 Resources dashboard [doc]

« helps you identify which resources have the heaviest impact on your application ». Sections : **Most requested resources** (« Size and load time metrics »), **XHR and Fetch requests** (« Request repartition », « Method and error status codes »), **Resource load timings** (« DNS Lookup, Initial Connection, Time To First Byte, and Download trends »), **3rd party resources** (« Third-party resource impact assessment »). Type probable [déduit] : top lists par URL, pie chart méthode/statut, timeseries par phase réseau, top list par `resource.provider`.

### 10.5 Usage [doc]

Page `platform/dashboards/usage/` (texte intégral relu). Quatre dashboards :

**RUM Web App Usage** — « Application usage: See graphs of the average session duration, pageviews per sessions, actions per session, and errors per session. The tables below list usage metrics based on the first and last visited pages. » « User journeys: See what pages your users are spending the most time on, and see where they start and end their journey across your application. » « Engagement matrix: See what portion of your users are performing which actions. » « User demographics: Observe the number of sessions by country and the top countries, devices, and operating systems for your application. You can also view a graph of the top browser usage shares. » Alt : « Out-of-the-box RUM web app usage dashboard ».

**RUM Mobile App Usage** — Application usage : « what application version, Datadog SDK, and browser they are running. Compare this week's and last week's sessions. See overall bounce rate. » Puis mêmes sections User journeys / Engagement matrix / User demographics.

**RUM User Demographics** — « Global Data: […] which countries, regions, and cities use your application the most. » « Compare Continents and Compare Countries: See how your users experience your application differently based on their continent and country. »

**RUM Frustration Signals** — « gives you insight into where your users are getting frustrated, annoyed, or blocked on their workflow » ; trois types (règles § 9.4).

Types probables [déduit] : timeseries (graphs), tables (first/last page), top lists (countries/devices/OS), pie (browser shares), geomap (sessions by country), matrice actions × part d'utilisateurs (Engagement matrix — représentation exacte non établie).

### 10.6 Errors et Testing and Deployment [doc]

**RUM web app errors dashboard** : « helps you focus on the views or versions that are generating the most errors » ; sections **Code errors** (« Get an overview of which parts of your application are generating the most errors » + renvoi à Error Tracking « to investigate critical frontend errors and learn when new errors appear ») et **Network errors** (« Monitor which resources are generating the most errors »). **RUM mobile app crashes and errors dashboard** : mêmes sections. Alt : « Out-of-the-box RUM Web App Errors Dashboard ».

**Synthetics & RUM application testing coverage dashboard** (page `testing_and_deployment/`) : sections « Percentage of tested actions », « Untested actions » ; permet « Identification of tested vs. untested application sections », « Location of popular user actions requiring browser test coverage ». Alt : « Untested RUM actions and top Synthetic browser tests covering RUM actions sections ».

**RUM Web App Deployment Tracking dashboard** : prérequis « Add RUM versions to application » ; widgets nommés : « Core web vitals (Largest Contentful Paint, First Input Delay, Cumulative Layout Shift) », « Load Time and additional performance telemetry », « Error count and percentage of views with errors », comparaisons « across services and versions ». **RUM Mobile App Deployment Tracking dashboard** : « Crash count by version », « Crash rate by version », « Error count by version », « Error rate by version », mobile vitals par version (« slow renders, frozen frames, application start time, memory usage »).

**Section Deployment Tracking de la page résumé d'application** (guide `setup-rum-deployment-tracking/`) : version posée à l'init (`version: '1.0.0'`) ; widgets Browser : **« P75 Loading Time by Version »**, **« Total User Sessions by Version »**, **« Error Rate by Version »** ; Mobile : **« Average Application Start Time by Version »**, mêmes sessions et error rate. Table des versions (nom, sessions, erreurs, performance), « exportable to dashboards ». Page de comparaison : « The default shows a selected version against all previous versions, with optional custom comparisons within 30 days past » ; onglet Issues : **« Error Count by Version »**, **« % of Views with Errors by Version »** + issues Error Tracking. Un **« Deployment Version Tracking powerpack »** ajoute ces widgets à un dashboard.

### 10.7 Pages résumé « Performance Monitoring » et « Optimization » [doc]

- Page index RUM : « The Performance Monitoring summary page provides relevant and actionable insights for both web and mobile applications […] focus on key datapoints by platform, such as the UI latency for web or mobile crashes, and monitor application health through familiar KPIs, such as Core Web Vitals for web apps or hang rate for iOS […] dive into investigations directly from interactive widgets without leaving the page. » Liste des widgets : non établie.
- Page **Optimization** (`optimizing_performance/`), sous « Digital Experience > Performance Monitoring » ; prérequis SDK ≥ 5.4.0 et Session Replay actif sur une partie des sessions. Sections : **Selecting a vital** (« Treemap of most visited pages » ou saisie du nom de vue ; vitals : Loading Time (LT), LCP, FCP, CLS, INP) ; **Filter and evaluate** (fenêtre, filtres par attribut, « select breakdown groups », « evaluate vitals at different percentiles (e.g., pc75) ») ; **Visualize the user's experience** (« the most typical example of what users see on the page », bouton **« See a different element »**, sous-parties LCP/INP) ; **Troubleshoot resources and errors** (« slow/large resources and recurring errors ») ; **View event samples** (waterfall + timeline, échantillons sélectionnables) ; **Browser profiling within event samples**.

---

## 11. Monitors RUM (cible de l'export « to a monitor ») [doc]

Page `monitors/types/real_user_monitoring/` :

- Ce qu'on peut alerter : « RUM event count », « Facet » (« Unique value count of the facet »), « Measure » avec `min`, `avg`, `sum`, `median`, `pc75`, `pc90`, `pc95`, `pc98`, `pc99`, `max`.
- Étapes : **« Define the search query »**, **« Set alert conditions »**, notifications, permissions.
- Conditions : `above`, `above or equal to`, `below`, `below or equal to` ; fenêtres `5 minutes`, `15 minutes`, `1 hour`, `custom` (5 min à 48 h) ; seuils Alert et Warning.
- Group by jusqu'à 4 facettes (1 000 valeurs pour 1 ; 30 par facette pour 2 ; 10 pour 3 ; 5 pour 4).
- Guide `alerting-with-rum/` — exemples : anomalie de trafic (session count, sum, par application, anomaly detection) ; crash-free sessions (formule crash-free / total, par version) ; **INP p75 par view name, warning 200 ms, alert 500 ms** ; « Can also use anomaly detection or forecast alerts ».

---

## 12. Ce que chaque écran permet de conclure — synthèse

| Écran | Question à laquelle il répond | Ce qu'il ne dit pas |
|---|---|---|
| List + tri par mesure | quels sont les pires cas individuels, sur quel pays / navigateur / type de chargement [doc + observé vidéo] | rien sur la fréquence : dix pires lignes ne disent pas si le p75 est bon |
| Timeseries | quand ça a changé, pour quelle valeur de facette [doc] | pourquoi ; la doc renvoie aux Related events |
| Top list / Nested tables | qui pèse le plus, croisé sur 2-3 dimensions [doc] | les totaux (« subtotal may differ ») et les valeurs nulles (exclues) [doc] |
| Distribution | la forme de la mesure, où tombe p75 [doc + observé vidéo] | l'évolution dans le temps |
| Geomap | où ça se passe [doc] | à volume égal ? non : aucun garde-fou sur les pays à 3 sessions n'est documenté |
| Funnel + Insights | où l'on perd les sessions, et si performance/frustration/pays sont corrélés [doc] | la causalité ; « correlation » est le mot de la doc |
| Side panel view | pour cet utilisateur : LCP pass/fail, ressources, long tasks, erreurs, position vs p75 [doc] | la population de référence de la distribution : non établie |
| Watchdog Insights | quelles valeurs de facette sont sur-représentées dans les erreurs / plus lentes que la baseline [doc] | le test et le seuil : non établis |
| Web App Performance | l'état global des trois vitals + Load Time, XHR, long tasks [doc] | l'élément fautif (Optimization) |
| Usage | durée, pages/session, actions/session, erreurs/session, entrées/sorties, démographie [doc] | la conversion (Funnel) et la rétention (Product Analytics) |
| Errors | quelles vues / versions génèrent le plus d'erreurs ; quelles ressources échouent [doc] | le regroupement en issues et les états (Error Tracking) |
| Testing coverage | quelles actions réelles ne sont couvertes par aucun test Synthetics [doc] | — |
| Deployment Tracking | LCP/Loading Time p75, sessions, taux d'erreur **par version**, avant/après [doc] | un verdict « régression » chiffré : pas de règle documentée (§ 9.5) |
| Optimization | pour un vital et une page : élément cible, sous-parties, ressources et erreurs associées, échantillons [doc] | — |

---

## 13. Dix capacités que notre console devrait reprendre telles quelles

Repères sur notre état actuel : écrans dans `apps/console/app/*/page.tsx` ; visualisations de l'Explorer limitées à `value`, `toplist`, `timeseries`, `table` (`apps/console/lib/analytics-schema.ts:64`) ; composants graphiques dans `apps/console/components/charts/` (Donut, ForecastChart, Gauge, HealthHeatmap, LineTrend, ObservedTrend, RadarScore, RankBar, ScatterPlot, StackedBars, TrafficTimeseries, VitalsTimeseries).

1. **Une requête, plusieurs formes** — le sélecteur de jeu + « Visualize as » qui change la représentation sans changer le filtre, et la conservation des group-by au changement de visualisation [doc § 3]. Notre Explorer a le jeu et l'AST ; il lui manque **Distribution** et **Geomap** dans `VISUALIZATIONS`.
2. **Le panneau de facettes avec comptes** (« Browser Name : Chrome 8.83k, Firefox 1.62k… », cases à cocher) [observé vidéo, définition des facettes doc § 1.4] : on voit le poids d'une valeur avant de filtrer. Nous le faisons déjà sur `/events` pour les attributs d'événements custom (liste de facettes avec `facet.count`, `apps/console/app/events/page.tsx:125-128`) ; l'Explorer analytique (`/explorer`) et les filtres globaux proposent des dimensions sans compte.
3. **La liste triable par n'importe quelle mesure, puis le side panel sans quitter la page** (§ 4 Lists + § 5.1). Notre `/sessions/[id]` est une page entière ; les seuls `<aside>` de la console (`/events`, `/explorer`) sont des cartes « Total observé », pas un panneau d'événement.
4. **La distribution en tête du side panel qui situe l'événement vs la population** (§ 5.2) : « close to the median or is an outlier ». À reprendre avec la population nommée (nous savons la nommer : même route, même fenêtre).
5. **Le waterfall avec marqueurs de vitals et pass/fail, le toggle « Critical Events », et le survol qui donne définition + seuil + comparaison au p75** (§ 5.3). Notre `sessionTimeline` (`apps/console/lib/queries.ts:441-566`) a déjà pageview / vital / action / error / breadcrumb / resource / longtask / api : c'est le rendu qui manque (`components/sessions/Timeline.tsx` est une liste verticale).
6. **Nested tables jusqu'à trois dimensions avec la règle de tri hiérarchique et la note « subtotal may differ »** (§ 4). Notre Explorer accepte deux dimensions et 50 combinaisons au total (`MAX_GROUP_BY = 2`, `MAX_GROUPS = 50`, `apps/console/lib/analytics-schema.ts:49-51`) ; il manque la troisième dimension, le tri hiérarchique « top de la première dimension, puis top de la deuxième dans chaque groupe », et la mention explicite des sous-totaux partiels.
7. **Distribution avec repères p50/p75/p90/p95** (§ 4 + observé vidéo). Nous avons des histogrammes LCP/INP/CLS (`app/pages/page.tsx:43-264`, `vitalHistogram`) sans repères de percentiles.
8. **Related events : cliquer un point / une barre / une tranche mène à la liste des événements** (§ 4). Nous avons `breakdownDrillHref` pour les routes ; à généraliser à chaque graphique.
9. **Vues enregistrées complètes** : requête + colonnes + tri + fenêtre glissante + facettes + visualisation, avec vue par défaut et modèles fournis (§ 6). Nos `analytics_saved_view` (docs/DASHBOARDS.md) n'enregistrent que l'AST ; pas de colonnes/tri, pas de modèles.
10. **Deployment Tracking par version** : « P75 Loading Time by Version », « Total User Sessions by Version », « Error Rate by Version », table des versions et page de comparaison « selected version against all previous versions » (§ 10.6). Nous avons déjà la table par version (`components/VersionsTable.tsx` — colonnes Version, Sessions, LCP p75, INP p75, Sessions avec erreur — alimentée par `comparaisonVersions` et rendue sur la Vue d'ensemble, `app/page.tsx:92`) et `DeployPanel` (`components/tracing/DeployPanel.tsx:14-81`) ; il manque la page de comparaison « version choisie contre toutes les précédentes » (fenêtre de 30 jours chez Datadog) et les séries par version (sessions, Loading Time / LCP p75, taux d'erreur) qui donnent la tendance et pas seulement le tableau.

Deux candidats écartés du top 10 mais documentés : Watchdog error/latency outliers (§ 8) — utile, mais la règle statistique n'est pas publiée, donc à concevoir plutôt qu'à copier ; Funnel Insights (§ 4) — nous avons `/goals` (conversion par objectif) et `/paths` (Sankey), la corrélation « load time vs conversion » serait un ajout.

## 14. Cinq points où l'on peut faire mieux — plus honnête, plus lisible, moins de jargon

1. **Dire la règle à côté du chiffre.** Datadog publie « rage click : > 3 clics en 1 s glissante » mais **aucune fenêtre** pour le dead click ni l'error click (§ 9.4). Nos règles sont chiffrées (docs/FRUSTRATION.md : dead click = élément d'aspect actionnable sans réaction DOM/navigation/scroll en 1,5 s ; error click = première exception rattachée à l'action dans 5 s) et « conservatrices par conception » (sous-report assumé). À afficher dans l'écran `/ux`, avec la phrase de sous-report : c'est ce que Datadog ne dit pas.
2. **Une régression de performance déclarée avec sa règle et sa fenêtre.** Chez Datadog, « régression » n'existe que pour les erreurs (issue résolue qui revient, § 9.5) ; la performance par version se lit à l'œil. Notre `assessRegression` (`apps/console/lib/queries-deploys.ts:103`) déclare « +20 % ou plus, fenêtre ±2 h autour du déploiement, filtres de population non appliqués » — et le panneau le dit. À garder, en ajoutant l'effectif de chaque côté (un p75 sur 12 vues n'est pas un p75) ; et reprendre la règle Error Tracking des 14 jours pour l'auto-résolution, que nous n'avons pas (`REGRESSED_SQL`, `queries-errors.ts:598`, ne connaît que `resolved_at`).
3. **Annoncer les troncatures, toujours.** Datadog écrit en documentation que « the subtotal may differ » et que les valeurs nulles sont exclues (§ 4) ; l'écran ne le montre pas. Nous affichons déjà « N routes distinctes — les 200 plus lentes sont affichées » (`app/pages/page.tsx`, `routes-tronquees`) et l'Explorer refuse d'afficher des zéros quand le budget est dépassé (« Aucun chiffre n'est affiché : une série de zéros se lirait comme une absence de trafic », `app/explorer/page.tsx`). Étendre cette règle à toute table à N dimensions et à tout export (nous plafonnons le CSV à 10 000 lignes « troncature annoncée dans le fichier », docs/DASHBOARDS.md ; Datadog : 5 000 événements / 500 agrégats, § 7).
4. **Des métriques standard plutôt qu'un KPI maison.** « Loading Time » (fin d'activité après 100 ms sans requête ni mutation, § 9.3) est propre à Datadog et la doc liste elle-même ses cas d'imprécision. Nous notons LCP/INP/CLS/FCP/TTFB avec les seuils web.dev à trois états (`packages/rum-sdk/src/vitals.ts:12-24` : LCP 2500/4000, INP 200/500, CLS 0,1/0,25, FCP 1800/3000, TTFB 800/1800) — là où Datadog n'affiche qu'un pass/fail (§ 9.2). À garder ; et écrire sous chaque graphique, comme le fait déjà `HeroReading`, une phrase de lecture en français (« chaque point = un élément interactif… », `app/ux/page.tsx`) au lieu de « Group into fields », « Nested tables », « Top list ».
5. **Synthétique et réel côte à côte, avec l'écart nommé.** Datadog signale seulement que « Synthetic Monitoring displays Largest Contentful Paint and Cumulative Layout Shift as lab telemetry, not real telemetry » (§ 9.2) et livre un dashboard de couverture de tests (§ 10.6). Notre `/correlation` met robot et réel par route face à face et surligne l'écart (README : « 1,14 s (ok) » vs « LCP p75 réel 4,04 s (poor), +254 % »). C'est le point où nous faisons déjà ce que la documentation Datadog ne décrit pas ; à garder au premier plan, et y ajouter l'idée de couverture (« actions réelles fréquentes sans test synthétique »).
