# Datadog — Product Analytics, RUM mobile, monitors : inventaire documenté

Lecture faite le 2026-09-18 sur la documentation officielle (docs.datadoghq.com), complétée par trois billets du blog Datadog et deux pages produit. Chaque affirmation porte une source. Ce qui n'est pas écrit dans la documentation est marqué **[déduit]** ; ce qui n'a pas pu être établi est marqué **non établi**.

Convention : les libellés d'interface sont laissés en anglais entre guillemets ou en `code`, tels qu'ils apparaissent dans la documentation. Les URL « app.datadoghq.com/… » sont les écrans du produit, les URL « docs.datadoghq.com/… » la documentation.

Note de périmètre : les pages `product_analytics/journeys/funnels/` et `journeys/retention/` données comme points de départ répondent 404 ; la documentation vit désormais sous `product_analytics/charts/` (funnel_analysis, retention_analysis, pathways, journey_paths, analytics_explorer). Le crash reporting mobile a lui aussi déménagé sous `error_tracking/frontend/mobile/`.

---

## 0. Ce que ce document garantit et ne garantit pas

- Il garantit que chaque seuil numérique, chaque libellé et chaque règle listés ci-dessous figurent dans une page citée, telle qu'elle était le jour de la lecture.
- Il ne garantit pas que l'interface réelle affiche exactement les widgets décrits : la documentation décrit rarement la composition d'un écran widget par widget ; là où elle ne le fait pas, c'est dit.
- Il ne garantit pas que les seuils cités soient ceux du produit dans six mois ; plusieurs pages ont changé d'URL entre la rédaction de la tâche et la lecture.

---

## 1. Product Analytics

### 1.1 Modèle de données

Source : https://docs.datadoghq.com/product_analytics/ et https://docs.datadoghq.com/product_analytics/data_collected/

| Événement | Définition documentée | Rétention |
|---|---|---|
| Session | « A session represents a real user journey through your application. It begins when a user opens the application and remains open as long as the user is active. » Fin : « The session ends after 4 hours of activity or 15 minutes of inactivity. » | 15 mois |
| View | « A view represents a unique page or screen a user visits within a session. » | 15 mois |
| Action | « An action represents user activity in your application, such as a click, tap, swipe, or scroll. » (collectée automatiquement) | 15 mois |
| Labeled Action | action auto-capturée renommée via Action Management (§1.10) | 15 mois |
| Server-side event | événement métier envoyé par l'API Product Analytics (« completed checkout », « processed payment ») | 15 mois ; facturé à part |

Ce que Product Analytics **ne collecte pas** (documenté) : « Product Analytics does not collect Errors, Resources, Long Tasks, or Vitals events. » Ces événements restent dans RUM avec leur propre rétention (sessions/views/actions/erreurs 30 jours, resources/long tasks 15 jours — https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/data_collected/).

Attributs documentés (extrait utile pour une console) :
- Session : `session.id`, `session.type`, `session.is_active`, `session.time_spent` (nanosecondes), `session.view.count`, `session.action.count`, `session.initial_view.url|name`, `session.last_view.url|name`, `session.has_replay`, `session.useragent`, `session.ip`.
- View : `view.id`, `view.url`, `view.name`, `view.is_active`, `view.time_spent` (ns), `view.action.count`, `view.loading_time` (ns), `view.interaction_to_next_view_time` (ns) ; UTM (navigateur seulement) : `view.url_query.utm_source|utm_medium|utm_campaign|utm_content|utm_term`.
- Action : `action.id`, `action.type`, `action.name`, `action.target.name`, `action.loading_time` (ns).
- Frustration (navigateur seulement) : `session.frustration.count`, `view.frustration.count`, `action.frustration.type:dead_click|rage_click|error_click`.
- Utilisateur : `usr.id`, `usr.name`, `usr.email`, `usr.anonymous_id` (« persisting up to one year » pour les non authentifiés).
- Contexte : `device.*`, `os.*`, `geo.country|country_iso_code|country_subdivision|continent|city`, `application.id|name`, `service`.

### 1.2 Home et ses cinq sous-sections

Source : https://docs.datadoghq.com/product_analytics/ (section « Home »), écran https://app.datadoghq.com/product-analytics

Documenté, mot pour mot : « By default, this page displays the `active users`, `page views`, and `average time spent by user` charts, but you can add additional charts or a dashboard. » Le blog (https://www.datadoghq.com/blog/datadog-product-analytics/) ajoute que la page porte des raccourcis « building a funnel, reviewing session replays, or creating a segment ».

| Sous-section (libellé exact) | Écran | Phrase documentée | Ce que l'écran permet de conclure |
|---|---|---|---|
| Users | /product-analytics/user-trends | « At a glance, see who is using your product. » | Qui utilise le produit (démographie, géographie). Composition exacte des widgets : **non établie**. |
| App & Devices | /product-analytics/app-and-devices | « Visualize the split between desktop and mobile usage, spot which versions are in use, and identify what can be deprecated. » | Part desktop/mobile ; versions encore en usage ; ce qu'on peut retirer. |
| Engagement | /product-analytics/engagement-and-features | « Understand how users are engaging with your product, answering questions such as how long users are staying on pages, and what their top actions are. » | Temps passé par page ; actions les plus fréquentes. |
| Traffic | /product-analytics/traffic-and-acquisition | « See bounce rates, top traffic sources, and where your growth is really coming from. » | Taux de rebond ; sources ; origine de la croissance. Définition du rebond : **non établie** (le mot apparaît aussi dans le dashboard Mobile Usage sans définition). |
| Performance | /product-analytics/performance | « View the most common errors and frustrations, and see exactly which views they impact. » | Erreurs et frustrations les plus fréquentes, et les vues touchées. |

**[déduit]** La sous-section Performance affiche des erreurs alors que Product Analytics « does not collect Errors » : elle lit donc les événements RUM (rétention 30 jours), pas les données Product Analytics (15 mois). La documentation ne le dit pas.

**[déduit]** « active users » = utilisateurs distincts sur `usr.id` ou, à défaut, `usr.anonymous_id` ; « page views » = nombre d'événements View ; « average time spent by user » = moyenne de `session.time_spent` par utilisateur. Aucune de ces trois formules n'est écrite dans la documentation.

### 1.3 Analytics Explorer

Sources : https://docs.datadoghq.com/product_analytics/charts/analytics_explorer/ , …/analytics_explorer/visualize/ , https://docs.datadoghq.com/real_user_monitoring/explorer/group/ , https://docs.datadoghq.com/real_user_monitoring/explorer/visualize/

Construction d'une requête (libellés exacts, dans l'ordre) : « View event type » (Sessions, Views, Actions ; « Server Events » apparaît dans le sélecteur une fois des événements serveur envoyés) → « Choose a measure » → « Filter by » → « Break down by » → fonction (référence aux fonctions des dashboards) → « Graph type » et « Time interval ».

Mesures documentées : « Event count », « Unique count of coded values for a facet per group », et pour les facettes numériques « minimum, maximum, average, and percentiles ». Le géomap d'exemple montre « the 75th percentile of the Largest Contentful Paint ».

Limites de dimensions documentées : Top List = 1 dimension ; Timeseries, List, Table = jusqu'à 3 dimensions, classées hiérarchiquement (top valeurs de la dimension 1, puis 2 dans celles-ci, puis 3).

Visualisations listées (page Product Analytics « visualize ») : Timeseries, Top List, Nested Tables (jusqu'à trois facettes), Distributions, Tree Maps, Pie Charts, Geomaps, Lists, Funnel. La page équivalente côté RUM Explorer ne mentionne pas Tree Maps.

Règles d'affichage documentées : « bars (recommended for counts and unique counts), lines (recommended for statistical aggregations), areas » ; le « roll-up interval » fixe la largeur des seaux ; cliquer sur un graphe « zoom in or see a list of events » (sauf pour le funnel).

### 1.4 Funnels

Source : https://docs.datadoghq.com/product_analytics/charts/funnel_analysis/ ; écran https://app.datadoghq.com/product-analytics/user-journey/funnel ; complément https://docs.datadoghq.com/real_user_monitoring/explorer/visualize/ (section Funnel) et blog https://www.datadoghq.com/blog/product-analytics-funnels/

Construction : « Product Analytics > Create New > Funnel » ; « Add step » ; réordonnancement par glisser-déposer ; plusieurs événements dans une étape avec « or ». Filtre global « Filter by » et filtre par étape (icône de filtre sur l'étape). Suggestion de l'étape suivante : le champ « Search for View or Action Name » charge « the top most common views and actions that users typically see and take next ».

Mesures (menu déroulant, libellés exacts) :
- « Unique converted sessions » (même `@session.id`)
- « Unique converted users » (`@user.id`)
- « Unique converted accounts » (`@account.id`)
- « Total conversions »
- « Time to convert » (vue timeseries)

Affichage : « count or rate » ; toutes les étapes ou une étape.

Fenêtre de conversion : pour utilisateurs/comptes, « define conversion window in hours or days (default: 24-hour window) ».

Règles de comptage documentées :
- « Any action or view that happens between two steps in a funnel does not impact the step-by-step or overall conversion rate. As long as step 1 and step 2 happen in the right order in a given session at least once, it counts as a single converted session. » (ordre respecté, intercalations ignorées)
- « Each A starts an independent attempt. Because all three attempts complete on the same C event, Datadog counts only the earliest attempt. »
- Unique : une conversion par session/utilisateur/compte quel que soit le nombre de répétitions ; Total : chaque parcours complet compte.
- Temps moyen : « Averaged total duration between first and last step across all conversions divided by total steps » (formule telle que documentée ; elle donne un temps moyen **par étape**, pas un temps de conversion de bout en bout).

« Compare » (trois modes, libellés exacts) :
1. « By Breakdown » : groupement par attribut (device type, geolocation), « top or bottom values » avec un nombre configurable ;
2. « By Property or Segment » : funnels côte à côte (segments, ou valeurs d'un attribut comme Browser Name, Country) ;
3. « By Time » : deux périodes.

Visualisations du funnel : « Timeseries » (count ou rate), « Query Value », « Top List ».

Section « User Behavior » (documentée sur la page RUM Explorer visualize) : compare « the average frustration count … with the conversion rate » ; à côté, « a chart showing the conversion and drop off rate for specific countries ».

« Conversion drivers » (documenté comme « Preview ») : cliquer une étape ouvre « conversion drivers, user journeys, session replay availability, user details ». Le blog précise le panneau « Conversion analysis » : classement statistique des attributs et « behavioral segments » corrélés à la conversion ou à l'abandon, bascule « Converted » / « Dropped off », création d'un segment de convertis ou d'abandons depuis le panneau, ouverture de Session Replay sans quitter le funnel. Méthode statistique : **non établie** (le blog dit « statistical analysis » sans plus).

Widget Funnel des dashboards (https://docs.datadoghq.com/dashboards/widgets/funnel/) : mesures `__dd.conversion` et `__dd.conversion_rate` ; `grouped_display` = « stacked » ou « side_by_side » ; comparaison temporelle « previous_timeframe », « custom_timeframe », « previous_day », « previous_week », « previous_month » ; `audience_filters` (comptes, segments, utilisateurs) ; `graph_filters` (seuils de valeur entre étapes).

Export : Notebooks, dashboards, PNG.

Ce que l'écran permet de conclure : où les sessions s'arrêtent dans un parcours ordonné ; si un attribut (device, pays, segment) change la conversion ; si la conversion bouge d'une période à l'autre ; quels attributs sont associés à l'abandon (sans preuve de causalité — la documentation parle de corrélation).

### 1.5 Journey Paths

Source : https://docs.datadoghq.com/product_analytics/charts/journey_paths/ ; page « Charts » https://docs.datadoghq.com/product_analytics/charts/

Définition documentée : « the most common paths users take between selected events », ordonnés par fréquence de sessions ; chaque chemin affiche « percentage, session count, and average time spent ».

Configuration : au moins deux événements (départ, arrivée) ; alternatives par étape via « or… » ; filtres par propriété (country, device type…) ; bascule « Converted » / « Dropped » ; sélecteur d'étape pour les parcours à plusieurs étapes ; bascules de type d'événement (Views, Actions, Custom Actions) ; densité « More Paths » / « Fewer Paths » ; « View more » pour déplier la suite d'un chemin. Les transitions directes apparaissent comme chemins sans événement intermédiaire.

Différence avec Pathways : Journey Paths est borné par deux événements choisis et accepte les actions ; Pathways balaie toutes les vues et n'accepte pas les actions (§1.6).

### 1.6 Pathways (Sankey)

Source : https://docs.datadoghq.com/product_analytics/charts/pathways/ ; écran https://app.datadoghq.com/product-analytics/user-journey/pathways ; widget https://docs.datadoghq.com/dashboards/widgets/sankey/

Règles documentées :
- Un nœud = une vue ; « node thickness » = nombre de sessions (« A page with fewer visitors has a thinner node »).
- Point d'ancrage : « the steps users took *after* visiting a given view » ou « *before* ».
- Jokers Datadog : `/department/*` pour regrouper des routes.
- « Action events are not supported in the Pathways diagram. »
- « If a user visits the same page multiple times during their session, that page is only counted once. »
- Survol d'un nœud : « the number of sessions that included visits to that view ».
- Clic sur un nœud : voir un Session Replay d'exemple ; « Start Pathways from here » ; « Build Funnel » → sélectionner des nœuds → « Create Funnel From Selection ».
- Nombre d'étapes affichées : exemples à quatre et cinq étapes ; limite configurable **non établie**.
- Représentation des sorties (drop-off) : **non établie** dans la documentation.

Widget Sankey (dashboards) : options « Display N views per step », « Sort by session count », « Display paths to other views » ; filtre par segment ou attribut d'application.

Ce que l'écran permet de conclure : les enchaînements de vues les plus empruntés à partir (ou vers) une vue ; pas la fréquence des actions, ni les boucles (une vue revisitée compte une fois).

### 1.7 Retention

Source : https://docs.datadoghq.com/product_analytics/charts/retention_analysis/ ; écran https://app.datadoghq.com/rum/retention-analysis

Prérequis documenté : `usr.id` doit être renseigné par le SDK.

Construction (libellés exacts) :
1. « Start event » (vue ou action) définit la cohorte ; « Return event » (vue ou action) définit le retour. Seuls views et actions sont acceptés.
2. Mesure : « Return on » (retour pendant une période précise) ou « Return on or after » (pendant cette période ou n'importe laquelle après) ; métrique « Retention rate » (%) ou « Unique users » (compte).
3. Période : « Daily retention: Up to 1 month » ; « Weekly retention: Up to 1 year » ; « Monthly retention: Up to 16 months ».
4. Optionnel : segment (par défaut tous les utilisateurs), filtres (country, device type, OS), « group by » sur un attribut.

Calcul documenté de la courbe : moyenne pondérée des cohortes, `(Σ (cohort_value × cohort_size)) / (Σ cohort_size)`.

Lecture documentée : si start = return, « Week 0 = 100% » ; sinon Week 0 montre les utilisateurs ayant fait les deux. Les valeurs grisées signalent une période incomplète.

Visualisations : « Retention curve », « Retention grid » (cohorte × période), « Timeseries », « Query value », « Top list ».

Ce que l'écran permet de conclure : si les utilisateurs reviennent à une page ou une action, et à quelle vitesse la cohorte s'érode ; pas pourquoi.

### 1.8 Heatmaps

Sources : https://docs.datadoghq.com/session_replay/heatmaps/ et https://docs.datadoghq.com/product_analytics/session_replay/heatmaps/ ; écrans app.datadoghq.com/rum/heatmap/ et app.datadoghq.com/product-analytics/heatmap

Trois types (libellés exacts) :
- « Click maps » : clics agrégés « as blobs on the map » ; panneau gauche listant les actions par fréquence, avec le nombre d'exécutions, le rang parmi les actions, et les signaux de frustration associés (ex. rage clicks) ; bouton « Start a Funnel ».
- « Top Elements » : « maximum 10 most-clicked elements », numérotés sur la carte et dans le panneau ; surbrillance au survol.
- « Scroll maps » : « average fold » (point le plus bas visible sans défiler) ; nombre d'utilisateurs à chaque profondeur ; percentiles de profondeur avec liens de requête ; barre bleue déplaçable ; mini-carte ; graphe de distribution.

Prérequis documentés : Browser SDK ≥ 4.40.0 (click/top elements), ≥ 4.50.0 (scroll) ; Session Replay activé ; `trackUserInteractions: true` ; navigateur seulement (« mobile not supported »). Messages d'état : « No Replay Data », « Not enough data ».

Sélecteurs : application / nom de vue, type d'appareil, « Filter actions by » (nom d'action), « Add Filter », plage de temps. Fond d'écran : capture existante, « Take new screenshot » (extension Chrome Datadog test recorder), « Grab from replay » ; masquage configurable ; épingler/désépingler.

Rétention : superposition RUM 30 jours ; superposition Product Analytics 15 mois ; capture de fond 30 jours, « extendable to 15 months via save ».

Ce que l'écran permet de conclure : quels éléments sont cliqués, jusqu'où on lit une page. Ne permet pas de conclure sur mobile natif ni sans Session Replay.

### 1.9 Segments, profils, identité

Sources : https://docs.datadoghq.com/product_analytics/segmentation/ , https://docs.datadoghq.com/product_analytics/profiles/ , https://docs.datadoghq.com/product_analytics/profiles/identity_resolution/

Segments (écran app.datadoghq.com/product-analytics/segments) : « User Segments » par « performed event(s) » et/ou « have attribute(s) » ; « Account Segments » par événements des utilisateurs du compte ou attributs de compte (ARR, start date…) ; import CSV (colonnes `usr.id`, `usr.email` ou identifiant de compte). Exemple documenté : « viewed `/cart` page then did not click CHECKOUT ». Règle : « A segment returns either user or account profiles, not both. » Utilisable dans Pathways, Analytics Explorer, Funnels (filtre ou comparaison côte à côte), Retention, Dashboards.

User Profiles (/product-analytics/profiles) : pages les plus visitées et actions fréquentes de l'utilisateur ; historique de sessions ; attributs : User ID (obligatoire), email, nom ; « First seen / last seen » ; premier/dernier city, country, region, device type, OS, browser, application. Account Profiles : `account_id`, `account_name`, `first_seen`, `last_seen`. Attributs importés : reference tables, Salesforce, Snowflake.

Identity Resolution (règles documentées) : « operates at the device level » ; « the anonymous ID is mapped to the first user identified on that device » ; persistance 15 mois ; résolution rétroactive sur la fenêtre de 15 mois.

### 1.10 Événements personnalisés

Sources : https://docs.datadoghq.com/product_analytics/guide/action_management/ , https://docs.datadoghq.com/product_analytics/data_collected/server_side_events/

Trois voies documentées :
1. **Labeled actions (Action Management)** — « no-code method for labeling autocaptured actions » ; écran « Actions » (app.datadoghq.com/product-analytics/data-management). « Visual Labeler » (extension Chrome) : cliquer un élément, Datadog affiche « usage frequency over the past 7 days », nom suggéré modifiable, option « Target all pages » (sélecteur CSS sur tout le site). Création manuelle (« Add Labeled Action » → « Create manually ») : label, description, tags, définitions par « Action Type » (`click` ou `custom`), « Action Name », « Page Location ». Application rétroactive à l'historique. Limites : pas d'étiquetage des éléments derrière un survol ; supprimer un label le retire des dashboards.
2. **Custom actions SDK** (`action.type: custom`) — comptées comme actions, utilisables dans funnels et Journey Paths (bascule « Custom Actions »).
3. **Server-side events** — API Product Analytics ; recommandation « include the `session_id` from the client's active RUM session » ; disponibles « in any Product Analytics chart » via « Server Events » dans le sélecteur ; facturés séparément ; rétention 15 mois. Limites de charge utile et débit : **non établies** sur la page lue.

### 1.11 Feature flags

Sources : https://docs.datadoghq.com/real_user_monitoring/feature_flag_tracking/ , …/feature_flag_tracking/using_feature_flags/ ; écran app.datadoghq.com/rum/feature-flags

Écran documenté : liste des flags « with health and usage metrics » ; onglet « Users » (statistiques de synthèse, analyse par attribut) ; onglet « Issues » (erreurs des sessions portant le flag) ; onglet « Performance » (Core Web Vitals et temps de chargement par variante). Attribut de requête : `@feature_flags.{flag_name}` (group by dans RUM Explorer).

Statut, règle documentée sur 2 semaines :
- « Active » : « evaluated different variants for the past 2 weeks »
- « Inactive » : « only … evaluations for your control variant »
- « Out to 100% » : « only … evaluations for one of your non-control variants »

Intégrations listées : LaunchDarkly, Split, Statsig, DevCycle, Flagsmith, Kameleoon, Amplitude, Eppo, GrowthBook, ConfigCat, solutions maison. SDK : Browser, iOS, Android, Flutter, React Native.

Ce que l'écran permet de conclure : combien d'utilisateurs voient chaque variante ; si une variante porte plus d'erreurs ou de moins bons vitals. Il ne conclut pas à une causalité.

---

## 2. RUM mobile

### 2.1 Modèle d'événements mobile

Sources : https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/android/data_collected/ , https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/ios/data_collected/

| Événement | Rétention | Points documentés |
|---|---|---|
| Session | 30 j | « A session represents a real user journey on your mobile application » ; réinitialisée après « 15 minutes of inactivity » ; `session.time_spent`, compteurs `session.view|action|error|resource|long_task.count`, `session.initial_view.*`, `session.last_view.*`, `session.has_replay` |
| View (écran) | 30 j | « A view represents a unique screen (or screen segment) » ; `view.name`, `view.url` (nom de classe), `view.time_spent`, `view.loading_time` (posé par `addViewLoadingTime()`), `view.network_settled_time`, `view.interaction_to_next_view_time`, `view.memory_average|max` (échantillonnage 500 ms par défaut), `view.refresh_rate_average|min`, attributs d'accessibilité optionnels |
| Action | 30 j | `action.type` : tap, swipe, scroll, application_start (déprécié en SDK ≥ 3.5.0), custom ; « other actions within the next 100 ms do not get sent, unless they are custom actions » |
| Resource | 15 j | `resource.duration`, `dns|connect|ssl|first_byte|download|redirect.duration`, `resource.provider.type` (first-party, cdn, ad, analytics) |
| Error | 30 j | `error.source` (webview, logger, network…), `error.is_crash` (booléen), `error.category` : Android « ANR or Exception » ; iOS « ANR, App Hang, Exception, Watchdog Termination, Memory Warning, Network » |
| Long Task | 15 j | tâche bloquant le thread principal au-delà d'un seuil (voir §2.2 : 100 ms) |

Stratégies de suivi d'écran Android documentées : ActivityViewTrackingStrategy (onResume → onPause), FragmentViewTrackingStrategy, MixedViewTrackingStrategy, NavigationViewTrackingStrategy, suivi manuel.

### 2.2 Mobile Vitals

Sources : https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/android/mobile_vitals/ , …/ios/mobile_vitals/ , https://docs.datadoghq.com/error_tracking/frontend/mobile/ios/ , https://docs.datadoghq.com/error_tracking/frontend/mobile/android/

| Vital (libellé exact) | Définition et seuil documentés | Attribut / mesure |
|---|---|---|
| Refresh Rate | « normalized on a range of zero to 60fps » (100 fps sur un écran 120 Hz → 50 fps rapporté) ; cible « under 60Hz » | `@view.refresh_rate_average`, `@view.refresh_rate_min` |
| Slow Renders | vues rendues en plus de 16 ms (60 Hz) | mêmes attributs |
| Frozen Frames | « Frames that take longer than 700ms to render appear as stuck and unresponsive » ; mesuré via les « long task » events « for any task taking longer then 100ms » | long tasks |
| Application Not Responding (ANR, Android) | « When the UI thread of an application is blocked for more than 5 seconds » ; boîte de dialogue système si l'app est au premier plan ; stack trace complète capturée | `error.category: ANR` |
| App Hangs (iOS) | désactivés par défaut ; `appHangThreshold` en secondes, minimum 0,1 s, plage recommandée 0,25–3,0 s, tolérance 2,5 % ; « fatal app hang » (marqué « Crash ») vs « non-fatal » ; conseil prod : 2,0–3,0 s | `error.category: App Hang` |
| Hang Rate (iOS/Unity) | définition Apple : « the number of seconds per hour that the app is unresponsive, while only counting periods of unresponsiveness of more than 250 ms » | — |
| CPU Ticks Per Second | « <40 for good and <60 for moderate » ; par vue et sur la session | — |
| Memory Utilization | « <200MB for good and <400MB for moderate » ; risque OutOfMemoryError (Android), watchdog terminations (iOS) | `view.memory_average|max` |
| Crash-free Sessions by Version | crash = « unexpected exit … caused by an unhandled exception or signal » ; tendance via Error Tracking | métriques `rum.measure.session.crash_free`, `rum.measure.view.crash_free` (§2.6) |
| Watchdog Terminations (iOS) | désactivé par défaut (`trackWatchdogTerminations`) ; rattaché à la session précédente si l'app n'a pas été mise à jour, n'a pas appelé exit/abort, n'a pas crashé, n'a pas été tuée par l'utilisateur, et sans redémarrage | `error.category: Watchdog Termination` |

Affichage documenté : « Digital Experience > Performance Summary » → onglet « Performance » → « View Dashboard » ; graphes en lignes « across application versions », cliquables pour filtrer par version ou ouvrir sessions/vues ; dans RUM Explorer, une vue affiche « recommended benchmark ranges » ; clic sur « Refresh Rate Average » → « Search Views With Poor Performance ».

Formule du taux de sessions sans crash : **non établie** (seuls les noms de métriques sont documentés). **[déduit]** sessions sans `error.is_crash:true` / sessions terminées.

Avertissement documenté (métriques RUM without Limits) : les compteurs de sessions sont émis « on detection » et les compteurs crash-free « on inactivity » (fin de session), ce qui « can create ratios exceeding 100% over short windows ».

### 2.3 App start : TTID et TTFD

Sources : https://docs.datadoghq.com/real_user_monitoring/application_monitoring/android/application_launch_monitoring/ , …/ios/application_launch_monitoring/ , blog https://www.datadoghq.com/blog/rum-mobile-app-launch-monitoring/ (24 février 2026)

- « Time to Initial Display (TTID) » : « The time it takes to display the first frame of the app's UI » — collecté automatiquement, SDK iOS/Android ≥ 3.5.0.
- « Time to Full Display (TTFD) » : « The time it takes for an app to become interactive for the user » — déclaré par l'application (`reportAppFullyDisplayed()`) ; si non déclaré, « only TTID is collected; TTFD metric not calculated ».
- Types de lancement : « Cold start », « Warm start », et sur iOS 15+ « Prewarmed ».
- Attributs : `@vital.type:app_launch`, `@vital.name:time_to_initial_display|time_to_full_display`, `@vital.startup_type` (cold/warm), `@vital.is_prewarmed` (iOS).
- Métriques : `rum.measure.app.startup_to_initial_display`, `rum.measure.app.startup_to_full_display` ; `rum.measure.app.startup_time` déprécié.
- L'action `application_start` « is not collected in … SDK versions 3.5.0+ » ; motif documenté : elle « didn't distinguish between different launch types and often produced inconsistent results ».
- Vue automatique « ApplicationLaunch » créée au démarrage du processus, contenant logs, actions, ressources antérieurs au premier `startView`.
- Affichage : « RUM Summary » sous « Mobile Performance » ; « Mobile Performance Dashboard » avec « distribution visuals » ; panneau de session avec distribution, type de lancement et « event waterfall ».
- Seuils recommandés : **aucun documenté** (la page et le blog le disent explicitement).

### 2.4 Crash reporting et contraintes de collecte

Sources : https://docs.datadoghq.com/error_tracking/frontend/mobile/android/ , https://docs.datadoghq.com/error_tracking/frontend/mobile/ios/

Android :
- ANR fatals détectés via `ApplicationExitInfo` (Android 30+) ; « unavailable on Android 29 and below » ; groupés par similarité (plusieurs issues possibles) ; remontés au lancement suivant.
- ANR non fatals : « grouped under a single issue in Error Tracking due to noise levels » ; désactivés par défaut sur Android 30+, activés par défaut ≤ 29 ; `trackNonFatalAnrs(true)`.
- Déobfuscation via mapping ProGuard/R8 (limite 500 Mo), appariement par `build_id` (plugin ≥ 1.13.0, SDK ≥ 2.8.0) ; crashs NDK à activer séparément.
- Contraintes documentées : « The crash can only be detected after the SDK is initialised » ; « RUM crashes must be attached to a RUM view. If a crash occurs before a view is visible… the crash is muted and isn't reported » ; « Only crashes that occur in sampled sessions are kept ».

iOS : `CrashReporting.enable()` ; envoi au redémarrage suivant ; dSYM (limite 2 Go), appariement par `uuid` ; App Hangs et Watchdog Terminations (voir §2.2).

Ce que ces pages permettent de conclure : un taux de crash Datadog est calculé sur les sessions échantillonnées et sur les crashs survenus pendant une vue ; ce n'est pas écrit sur les dashboards.

### 2.5 Écrans (dashboards) mobile

Sources : https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/performance/ , …/dashboards/usage/ , …/dashboards/errors/ , https://docs.datadoghq.com/real_user_monitoring/

- « Performance Summary » (page principale) : « Key datapoints by platform (UI latency for web, crashes for mobile) », KPIs « like Core Web Vitals and hang rates », widgets cliquables.
- « Mobile App Performance » : sections « Mobile vitals », « Resources analysis », « Crashes and errors » ; métriques citées : slow renders, CPU ticks per second, frozen frames, memory usage, crash-free sessions. Découpages et variables de template : **non établis**.
- « Mobile Usage » : « Application usage: … what application version, Datadog SDK, and browser they are running. Compare this week's and last week's sessions. See overall bounce rate. » ; « User journeys: … what pages your users are spending the most time on, … where they start and end their journey » ; « Engagement matrix: … what portion of your users are performing which actions » ; sessions par pays, appareils, OS.
- « Mobile App Crashes and Errors » : même structure que le web — « Code Errors » (quelles parties de l'app génèrent le plus d'erreurs, lien Error Tracking) et « Network Errors » (quelles ressources).
- « User Demographics » : adoption par pays, région, ville ; comparaison de performance par continent/pays.

### 2.6 Versions : adoption et comparaison

Sources : https://docs.datadoghq.com/real_user_monitoring/guide/setup-rum-deployment-tracking/ , https://docs.datadoghq.com/real_user_monitoring/rum_without_limits/metrics/

Version : Android « captured automatically from application manifest », iOS « from `info.plist` », navigateur `version` dans `init`.

« Application Overview » (Deployment Tracking), libellés documentés :
- Mobile : « Average Application Start Time by Version », « Total User Sessions by Version », « Error Rate by Version » ; table : version, « app launches », « error rate », « crash rate », « P90 Application Start Time ».
- Navigateur : « P75 Loading Time by Version », « Total User Sessions by Version », « Error Rate by Version » ; table : version, « user session count », « average errors per view », « P75 Loading Time », « P75 Core Web Vitals ».
- Comparaison : sélectionner une version compare « against all previous versions » par défaut ; deux versions quelconques « within 30 days » ; les autres versions passent en gris ; onglet erreurs avec « count-by-version » et « percentage-of-views-with-errors » ; onglet issues Error Tracking.
- Powerpack « Deployment Version Tracking » pour les dashboards.

« Version adoption » en pourcentage : **non établi** comme libellé ; **[déduit]** de « Total User Sessions by Version » et de la phrase App & Devices « spot which versions are in use, and identify what can be deprecated ».

Métriques « RUM without Limits » (calculées sur « 100% of ingested traffic », 15 mois) : `rum.measure.session`, `rum.measure.session.action`, `rum.measure.session.error`, `rum.measure.session.frustration`, `rum.measure.session.time_spent`, `rum.measure.view`, `rum.measure.view.loading_time`, `rum.measure.view.time_spent`, `rum.measure.error` ; mobile seulement : `rum.measure.session.crash_free`, `rum.measure.view.crash_free`, `rum.measure.app.startup_to_full_display`, `rum.measure.view.memory`, `rum.measure.view.refresh_rate` ; navigateur seulement : `rum.measure.view.first_contentful_paint`, `…largest_contentful_paint`, `…cumulative_layout_shift`. Dimensions par défaut : « environment, app name, app ID, app version, service, OS name, OS version, browser name, and country ».

---

## 3. Monitors et alerting RUM

### 3.1 Monitor « Real User Monitoring »

Source : https://docs.datadoghq.com/monitors/types/real_user_monitoring/ ; création app.datadoghq.com/monitors/create/rum

- Deux points de départ : « pre-built templates » (error rates, performance vitals, availability) ou monitor custom.
- Source de données : métriques sur le trafic complet (« RUM without Limits », 15 mois, « advanced alerting conditions such as anomaly detection ») ou événements retenus (indexés).
- Agrégation (une au choix) : nombre d'événements RUM (aucune facette) ; « Unique value count » d'une facette ; valeur numérique d'une mesure avec `min`, `avg`, `sum`, `median`, `pc75`, `pc90`, `pc95`, `pc98`, `pc99`, `max`.
- Group by : jusqu'à 4 facettes ; 1 facette → 1 000 valeurs ; 2 → 30 par facette (900 groupes) ; 3 → 10 (1 000) ; 4 → 5 (625).
- Condition : `above`, `above or equal to`, `below`, `below or equal to` ; fenêtre 5 min, 15 min, 1 h ou custom « 5 minutes to 48 hours » ; « Alert threshold » obligatoire, « Warning threshold » optionnel.
- Absence de données : « Set condition to `below 1` to alert when no RUM events match the query ».
- Plafond : 1 000 monitors RUM par compte par défaut.

### 3.2 Réglages communs (page Configuration)

Source : https://docs.datadoghq.com/monitors/configuration/

- « Alert Recovery Threshold » et « Warning Recovery Threshold » optionnels ; sans eux, la récupération suit les seuils d'alerte.
- Fenêtres « rolling » (taille fixe, glissante) ou « cumulative » (Current hour / day / month, métriques seulement) ; custom 1 min à 48 h (1 mois pour les métriques).
- Données manquantes après N minutes : « Evaluate as zero », « Show last known status », « Show NO DATA », « Show NO DATA and notify », « Show OK ».
- « Evaluation delay » jusqu'à 86 400 s ; recommandation 15 min pour les métriques cloud, 60 s pour les divisions.
- « Simple Alert » (une alerte agrégée) vs « Multi Alert » (une par entité) ; « Auto-Resolve » après N heures quand les données cessent ; renotification.

### 3.3 Anomaly

Source : https://docs.datadoghq.com/monitors/types/anomaly/

- Algorithmes : « Basic » (quantile glissant, pas de saisonnalité), « Agile » (SARIMA, s'adapte vite aux changements de niveau), « Robust » (décomposition saisonnière, stable, lent à suivre un changement voulu).
- Direction : « above or below » (défaut), « above », « below ».
- Fenêtres : trigger et recovery 15 min, 1 h ou custom « 15 minutes to 2 weeks ».
- « Deviations » = largeur de la bande grise ; saisonnalité « Hourly », « Daily », « Weekly » ; option heure d'été (agile/robust, daily/weekly) ; rollup ; seuils = « percentage of points » anormaux requis pour alerte/avertissement/récupération.
- Historique minimal : « Weekly seasonality: 3 weeks ; Daily: 3 days ; Hourly: 3 hours » ; jusqu'à 6 semaines utilisées.
- Requête : `avg(<query_window>):anomalies(<metric_query>, '<algorithm>', <deviations>, direction=…, alert_window=…, interval=…, count_default_zero=… [, seasonality=…]) >= <threshold>` ; `interval` ≤ 1/5 de `alert_window`.

### 3.4 Forecast

Source : https://docs.datadoghq.com/monitors/types/forecasts/

- « Linear » : modèles « default », « simple » (régression linéaire robuste sur tout l'historique), « reactive ».
- « Seasonal » : hourly / daily / weekly ; « at least two seasons of history and uses up to six seasons ».
- Horizon : 24 h, 1 semaine, 1 mois, ou custom « 12 hours to 3 months ».
- Alerte quand les bornes de confiance de la prévision franchissent le seuil ; « deviations » : « a value of 1 or 2 is generally large enough ».
- Fonctions non imbriquables dans `forecast()` : anomalies, cumsum, integral, outliers, piecewise_constant, robust_trend, trend_line.

### 3.5 Outlier

Source : https://docs.datadoghq.com/monitors/types/outlier/

- Groupes de « three or more members » au comportement homogène ; fenêtre 5 min, 15 min, 1 h ou custom « 1 minute to 1 year ».
- Algorithmes « DBSCAN », « MAD », « scaledDBSCAN », « scaledMAD » ; « tolerance » (0.33, 1.0, 3.0…) ; « percent » (MAD seulement) ; recommandation par défaut DBSCAN.

### 3.6 Monitor Error Tracking, états d'issue, régression

Sources : https://docs.datadoghq.com/monitors/types/error_tracking/ (copie brute : scratchpad/plan/reads/raw/monitors_types_error_tracking.md, lignes 15–173), https://docs.datadoghq.com/error_tracking/issue_states/ , https://docs.datadoghq.com/error_tracking/regression_detection/

- Deux types : « New Issue » — « Alert when an issue occurs for the first time or a regression occurs. For example, … more than 2 users are impacted by a new error » ; « High Impact » — « … more than 500 users are impacted by this error ».
- New Issue : issues en « For Review » ; « Regressions are automatically transitioned to the For Review state, so they are monitored by default » ; « 24-hour lookback period » ; fenêtre par défaut « last day » ; seuil par défaut 0 (« triggers at the first occurrence ») ; clause `.new()`. High Impact : issues « For Review or Reviewed », clause `.impact()`.
- États (libellés exacts) : FOR REVIEW, REVIEWED, RESOLVED, IGNORED, EXCLUDED.
- Régression, définition documentée : « the unintended reappearance of a bug or issue that was previously fixed » ; avec versions taguées, ne se déclenche que « on new versions after an issue is marked as RESOLVED » ; sans version, « issues are tagged with Regression when an error occurs on an issue marked as RESOLVED ». Marquage : passage en FOR REVIEW + tag « Regression ». Comparaison de versions (semver ou non) : **non établie**.
- Auto-résolution : dernier rapport dans une version « older than 14 days », une version plus récente existe et l'erreur n'y apparaît pas ; sans tag de version, 14 jours d'inactivité.

### 3.7 Watchdog Insights (RUM Explorer)

Source : https://docs.datadoghq.com/watchdog/insights/

- « Error outliers » : facettes sur-représentées dans les erreurs (ex. `env:staging`, `version:1234`, `browser.name:Chrome`) ; carte avec nom du champ, part des erreurs et des événements ; panneau avec série temporelle, camemberts d'impact, liste d'événements.
- « Latency outliers » : facettes « with worse performance than the baseline » sur FCP, FID, CLS et Loading Time ; panneau avec p50, p75, p99, max.
- Méthode : **non documentée**.

### 3.8 Exemples documentés du guide « Alerting with RUM »

Source : https://docs.datadoghq.com/real_user_monitoring/guide/alerting-with-rum/

1. Anomalie de trafic sur le nombre de sessions (« adapting to daily/weekly variations »).
2. Sessions sans crash : combinaison crash-free / total, filtrée sur une app (« Shop.ist iOS »), « grouped by version to detect release regressions ».
3. INP par nom de vue : « Warning: >200 milliseconds », « Alert: >500 milliseconds » ; anomalie et forecast possibles sur la même métrique.
Export depuis la page RUM : « Export > Create Monitor ».

---

## 4. Règles et seuils : table de synthèse

| Règle | Valeur documentée | Source |
|---|---|---|
| Rage click | « A user clicks on an element more than three times in a one-second sliding window. » | frustration_signals ; dashboards/usage dit « more than 3 times in a 1 second sliding window » |
| Dead click | « clicks on a static element that produces no action on the page » — aucun délai numérique documenté | frustration_signals |
| Error click | « clicks on an element right before a JavaScript error occurs » — aucun délai documenté | frustration_signals |
| Long task navigateur | > 50 ms | browser/data_collected |
| Long task mobile | > 100 ms | mobile_vitals |
| Slow render | > 16 ms | mobile_vitals |
| Frozen frame | > 700 ms | mobile_vitals |
| ANR Android | thread UI bloqué > 5 s | mobile_vitals |
| App hang iOS | seuil configurable, min 0,1 s, recommandé 0,25–3,0 s ; Hang Rate compte > 250 ms | error_tracking/frontend/mobile/ios, ios/mobile_vitals |
| CPU | < 40 ticks/s bon, < 60 modéré | mobile_vitals |
| Mémoire | < 200 Mo bon, < 400 Mo modéré | mobile_vitals |
| LCP | ≤ 2,5 s bon ; 2,5–4 s ; > 4 s mauvais | browser/monitoring_page_performance |
| INP | ≤ 200 ms ; 200–500 ms ; > 500 ms | idem |
| CLS | < 0,1 ; 0,1–0,25 ; > 0,25 | idem |
| Loading time (chargement initial) | max(navigationStart→loadEventEnd, navigationStart→première inactivité) | idem |
| Loading time (changement de route) | changement d'URL → inactivité (« 100ms … without network requests or DOM mutations ») | idem |
| Session | fin après 4 h d'activité ou 15 min d'inactivité (web/PA) ; 15 min d'inactivité (mobile) | data_collected |
| anonymous_id | jusqu'à 1 an | product_analytics/data_collected |
| Identité | 15 mois, par appareil, premier utilisateur identifié | identity_resolution |
| Fenêtre de conversion funnel | 24 h par défaut (utilisateurs/comptes) | funnel_analysis |
| Retention | daily ≤ 1 mois, weekly ≤ 1 an, monthly ≤ 16 mois | retention_analysis |
| Heatmap Top Elements | 10 éléments max | heatmaps |
| Statut de feature flag | fenêtre 2 semaines | using_feature_flags |
| Régression | issue RESOLVED réapparaissant (nouvelle version si versions taguées) | regression_detection |
| Auto-résolution d'issue | 14 jours | issue_states |
| Monitor RUM | fenêtre 5 min–48 h ; ≤ 4 facettes ; 1 000 monitors | monitors/types/real_user_monitoring |
| Anomalie | historique min 3 saisons ; fenêtre 15 min–2 semaines | monitors/types/anomaly |
| Forecast | ≥ 2 saisons ; horizon 12 h–3 mois | monitors/types/forecasts |
| Outlier | ≥ 3 membres ; 1 min–1 an | monitors/types/outlier |
| Comparaison de versions | deux versions « within 30 days » | setup-rum-deployment-tracking |

Ambiguïté relevée : « more than three times » se lit ≥ 4 clics ; la phrase du dashboard Usage se lit de la même façon. Notre SDK déclenche à 3 (`RAGE_MIN_CLICKS = 3`, `RAGE_WINDOW_MS = 1000`, packages/rum-sdk/src/frustration.ts:L13-L14) et fixe un délai de dead click à 1 500 ms (L15), que Datadog ne documente pas.

---

## 5. Ce que chaque écran permet de conclure, et ce qu'il ne permet pas

| Écran | Permet de conclure | Ne permet pas de conclure |
|---|---|---|
| Home (3 KPI) | volume d'usage et sa tendance | qui est « actif » exactement (définition non documentée) |
| Users / App & Devices | répartition démographique, desktop/mobile, versions à retirer | — |
| Engagement | temps par page, actions les plus fréquentes | pourquoi une action est fréquente |
| Traffic | sources, rebond | définition du rebond (non documentée) |
| Performance (PA) | erreurs et frustrations par vue | sur 15 mois : les erreurs vivent 30 jours côté RUM **[déduit]** |
| Funnel | où ça s'arrête, pour qui, depuis quand | causalité (les « drivers » sont des corrélations) |
| Journey Paths | chemins réels entre deux événements, avec durée | — |
| Pathways | enchaînements de vues dominants | actions ; boucles (vue comptée une fois) |
| Retention | retour à une page/action par cohorte | raison du non-retour ; utilisateurs sans `usr.id` exclus |
| Heatmaps | zones cliquées, profondeur lue | mobile natif ; pages sans replay |
| Feature flags | utilisateurs par variante, erreurs et vitals par variante | causalité |
| Mobile Vitals | vues lentes, gel, CPU/mémoire par version | crashs hors vue ou hors échantillon (mutés) |
| App launch | TTID/TTFD par type de lancement | seuil « bon » (aucun documenté) |
| Versions | sessions, erreurs, crash rate, P90 start par version ; comparaison 2 versions | adoption au-delà de 30 jours de comparaison |
| Monitors | dépassement de seuil, anomalie saisonnière, prévision | anomalie sans 3 saisons d'historique |

---

## 6. Documenté vs déduit — récapitulatif des déductions

Tout ce qui précède est documenté, sauf :
1. Le calcul de « active users », « page views », « average time spent by user » (§1.2).
2. La source de données de la sous-section Performance (§1.2).
3. La formule de « crash-free sessions » (§2.2).
4. Le libellé « version adoption » (§2.6).
5. La définition du taux de rebond (§1.2, §2.5).
6. La représentation des sorties dans Pathways (§1.6).
7. La méthode statistique des « conversion drivers » et de Watchdog Insights (§1.4, §3.7).
8. La composition widget par widget des dashboards Users, App & Devices, Engagement, Traffic, Mobile App Performance (§1.2, §2.5).

---

## 7. Dix capacités à reprendre telles quelles dans notre console

Chaque ligne indique la règle Datadog et l'endroit de notre code qui s'en rapproche aujourd'hui.

1. **Funnel : mesures et règle de comptage** — « Unique converted sessions / users », « Total conversions », fenêtre de conversion (24 h par défaut), ordre respecté avec intercalations ignorées, seule la première tentative compte. Notre `FunnelChart` affiche atteint / % depuis le départ / abandon (apps/console/components/Funnel.tsx:L55-L86 ; calcul apps/console/lib/funnel.ts:L63-L65) ; la fenêtre de conversion et le choix session/utilisateur n'y sont pas visibles.
2. **Funnel : « Compare »** en trois modes (breakdown, segment ou propriété côte à côte, période). Nos écrans ont déjà un « découpage » par dimension partagé entre accueil, `/pages` et `/errors` (apps/console/app/errors/page.tsx:L66-L68) ; le mode « par période » manque au funnel.
3. **Panneau « Conversion analysis »** : attributs classés par corrélation avec conversion/abandon, bascule « Converted / Dropped off », création d'un segment depuis l'étape. Rien d'équivalent repéré dans le dépôt.
4. **Journey Paths** : chemins réels entre deux événements avec %, sessions et durée moyenne, bascule convertis/abandons. Notre `/paths` est un Sankey à deux colonnes (apps/console/components/Sankey.tsx:L27-L97), sans borne de départ/arrivée.
5. **Pathways : règles explicites** — vues seulement, vue revisitée comptée une fois, épaisseur = sessions, ancrage avant/après une vue, « Create Funnel From Selection ». Notre `buildSankey` plafonne à 8 nœuds par colonne (apps/console/lib/sankey.ts:L40-L111) ; l'ancrage et le passage vers un funnel manquent.
6. **Retention** : « Return on » vs « Return on or after », plafonds daily/weekly/monthly, courbe pondérée + grille de cohortes, cellules grisées quand la période est incomplète. Un écran `/retention` existe (apps/console/app/retention/page.tsx) ; son contenu n'a pas été lu ici.
7. **Home : trois KPI et cinq questions** (Users, App & Devices, Engagement, Traffic, Performance), chacune formulée comme une question à laquelle l'écran répond.
8. **Mobile Vitals avec les seuils publiés** (16 ms, 700 ms, 5 s, CPU 40/60, mémoire 200/400 Mo, hang ≥ 250 ms) et « crash-free sessions by version » ; TTID/TTFD **par type de lancement**, en distribution et non en moyenne. Notre paquet mobile ne mesure que le démarrage JS (`js_start_to_first_screen_ms`, `js_warm_start_to_first_screen_ms`, packages/rum-mobile/src/index.ts:L325-L344) et dit lui-même que crash natif, ANR et démarrage natif ne sont pas livrés (L36-L39, L266).
9. **Table des versions** (sessions, error rate, crash rate, P90 app start / P75 loading time) avec comparaison de deux versions sous 30 jours, et **définition de la régression** (issue RESOLVED qui réapparaît sur une version plus récente → FOR REVIEW + tag). Nos issues ont un filtre `release` (apps/console/app/errors/page.tsx:L98-L106).
10. **Grammaire de monitor** : mesure + agrégation (`pc75`…`pc99`), group by ≤ 4 facettes avec plafonds, fenêtre 5 min–48 h, seuils alerte/avertissement/récupération, options « no data », plus l'exemple INP (avertissement > 200 ms, alerte > 500 ms) et l'anomalie saisonnière avec son minimum de trois saisons d'historique. Un écran `/alerts` et un `/forecast` existent (apps/console/app/alerts/page.tsx, apps/console/app/forecast/page.tsx) ; non lus ici.

---

## 8. Cinq points où l'on peut faire mieux (plus honnête, plus lisible, moins de jargon)

1. **Dire la population de chaque chiffre.** Datadog annonce « 100% user session collection without sampling » sur sa page produit, tandis que sa documentation dit que les crashs hors vue sont mutés et que seuls les crashs des sessions échantillonnées sont gardés ; ses ratios crash-free peuvent dépasser 100 % sur une fenêtre courte. Notre console affiche déjà une note d'échantillonnage sur `/actions` (apps/console/app/actions/page.tsx:L50-L54) et un avertissement de troncature sur `/pages` (apps/console/app/pages/page.tsx:L85-L101). À généraliser : chaque KPI porte sa population (« sessions closes dans la fenêtre »), sa rétention et son taux d'échantillonnage.
2. **Publier nos seuils de frustration dans l'interface.** Datadog documente le rage click (> 3 clics / 1 s) mais aucun délai pour le dead click. Nos constantes existent (3 clics / 1 000 ms, dead click 1 500 ms, 20 signaux par page — packages/rum-sdk/src/frustration.ts:L12-L16) et la requête d'agrégation aussi (apps/console/lib/queries-frustration.ts:L19-L39). Les afficher dans l'infobulle du tableau, avec la phrase « ce que nous appelons un clic mort ».
3. **Remplacer la moyenne par des distributions là où Datadog donne une moyenne.** La formule documentée du « Time to convert » (« divided by total steps ») produit un temps moyen par étape difficile à lire ; la courbe de rétention pondérée masque la taille des cohortes. Montrer médiane et p75 par étape, et la taille de cohorte à côté de chaque pourcentage, avec grisé sous un effectif minimal.
4. **Traduire les concepts, garder les termes en infobulle.** « Pathways », « Return on or after », « TTID/TTFD », « Out to 100% » sont des libellés qu'il faut apprendre. Formuler chaque écran comme la question à laquelle il répond (« Où vont les visiteurs après /panier ? », « Combien sont revenus au moins une fois depuis ? », « Premier écran / écran utilisable »), en gardant le terme Datadog entre parenthèses pour qui le connaît.
5. **Relier une action à ses effets, ce que Datadog ne fait pas dans Engagement.** Datadog classe les « top actions » par fréquence ; notre `/actions` les classe par erreurs et temps réseau déclenchés, avec une fenêtre causale bornée à 5 s et énoncée dans le sous-titre (apps/console/app/actions/page.tsx:L41-L42 ; agrégats apps/console/lib/queries-actions.ts:L175-L199). À conserver, en ajoutant la lecture Datadog (sessions par action) sur la même ligne pour que les deux lectures coexistent, et en gardant le mot « heuristique » à l'écran.

Identité à conserver, hors des cinq points : la grille jour × heure `HealthHeatmap` (part de mesures « good », LCP pondéré ×2, apps/console/components/charts/HealthHeatmap.tsx:L55-L129) n'a pas d'équivalent documenté chez Datadog ; l'explorateur d'événements personnalisés avec facettes sur `props`/`context` (apps/console/lib/queries-events.ts:L284-L404) recoupe « Server Events » + « Labeled actions » sans extension Chrome.

---

## 9. Sources

Documentation (lues le 2026-09-18) :
- https://docs.datadoghq.com/product_analytics/
- https://docs.datadoghq.com/product_analytics/data_collected/
- https://docs.datadoghq.com/product_analytics/data_collected/server_side_events/
- https://docs.datadoghq.com/product_analytics/charts/
- https://docs.datadoghq.com/product_analytics/charts/analytics_explorer/ (+ /visualize/, /events/)
- https://docs.datadoghq.com/product_analytics/charts/funnel_analysis/
- https://docs.datadoghq.com/product_analytics/charts/journey_paths/
- https://docs.datadoghq.com/product_analytics/charts/pathways/
- https://docs.datadoghq.com/product_analytics/charts/retention_analysis/
- https://docs.datadoghq.com/product_analytics/segmentation/
- https://docs.datadoghq.com/product_analytics/profiles/ et /profiles/identity_resolution/
- https://docs.datadoghq.com/product_analytics/guide/action_management/
- https://docs.datadoghq.com/product_analytics/session_replay/heatmaps/ et https://docs.datadoghq.com/session_replay/heatmaps/
- https://docs.datadoghq.com/real_user_monitoring/feature_flag_tracking/ et /using_feature_flags/
- https://docs.datadoghq.com/real_user_monitoring/ et /application_monitoring/
- https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/data_collected/
- https://docs.datadoghq.com/real_user_monitoring/browser/monitoring_page_performance/
- https://docs.datadoghq.com/real_user_monitoring/browser/frustration_signals/
- https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/android/mobile_vitals/ et /ios/mobile_vitals/
- https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/android/data_collected/ et /ios/data_collected/
- https://docs.datadoghq.com/real_user_monitoring/application_monitoring/android/application_launch_monitoring/ et /ios/application_launch_monitoring/
- https://docs.datadoghq.com/error_tracking/frontend/mobile/android/ et /ios/
- https://docs.datadoghq.com/error_tracking/issue_states/ et /regression_detection/
- https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/ (+ /performance/, /usage/, /errors/)
- https://docs.datadoghq.com/real_user_monitoring/guide/setup-rum-deployment-tracking/
- https://docs.datadoghq.com/real_user_monitoring/rum_without_limits/metrics/
- https://docs.datadoghq.com/real_user_monitoring/explorer/ (+ /group/, /visualize/)
- https://docs.datadoghq.com/real_user_monitoring/guide/alerting-with-rum/
- https://docs.datadoghq.com/monitors/types/real_user_monitoring/ , /anomaly/ , /forecasts/ , /outlier/ , /error_tracking/
- https://docs.datadoghq.com/monitors/configuration/
- https://docs.datadoghq.com/watchdog/insights/
- https://docs.datadoghq.com/dashboards/widgets/sankey/ et /funnel/

Blog et pages produit :
- https://www.datadoghq.com/blog/datadog-product-analytics/
- https://www.datadoghq.com/blog/product-analytics-funnels/
- https://www.datadoghq.com/blog/rum-mobile-app-launch-monitoring/
- https://www.datadoghq.com/product/product-analytics/
- https://www.datadoghq.com/product/real-user-monitoring/mobile-rum/
- https://www.datadoghq.com/dg/real-user-monitoring/overview/

Copies brutes déjà présentes dans le scratchpad (autre lecture) : scratchpad/plan/reads/raw/monitors_types_error_tracking.md, real_user_monitoring_platform_dashboards_usage.md, real_user_monitoring_explorer_visualize.md.

Dépôt (lecture seule) : packages/rum-sdk/src/frustration.ts, packages/rum-sdk/src/vitals.ts, packages/rum-mobile/src/index.ts, apps/console/components/Funnel.tsx, apps/console/components/Sankey.tsx, apps/console/lib/sankey.ts, apps/console/lib/funnel.ts, apps/console/app/actions/page.tsx, apps/console/lib/queries-actions.ts, apps/console/lib/queries-frustration.ts, apps/console/app/pages/page.tsx, apps/console/app/errors/page.tsx, apps/console/lib/queries-events.ts, apps/console/components/charts/HealthHeatmap.tsx.

Dossier de captures fourni par l'utilisateur (« /Users/juliantalou/Downloads/datadog screenshots and videos ») : images marketing au format .jxl/.webp et trois vidéos ; non exploité ici (la tâche porte sur la documentation).
