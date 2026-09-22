# Ce que Grafana apporte à la conception d'un tableau de bord RUM

Portée : uniquement Grafana (Frontend Observability, Faro, bonnes pratiques de dashboard, catalogue de panneaux). Datadog et IP Label sont hors périmètre de ce document — ils font l'objet d'autres lectures du même dossier `plan/reads/`.

Méthode : lecture directe de la documentation Grafana via `WebFetch` (résumé produit par un petit modèle à partir du HTML de chaque page — donc un résumé, pas une citation exhaustive ; ce que ce résumé n'a pas remonté est marqué « non établi » plutôt que complété au jugé), complétée par `WebSearch` pour retrouver les URL exactes des sous-pages « Visualize data ». Les exemples « chez nous » viennent de `apps/console` (le RUM POC), localisés avec `graft` (find_code / find_all / file_api / repo_map) plutôt que par lecture de fichiers entiers.

Aucun fichier du dépôt n'a été modifié pour produire cette lecture.

---

## a) Grafana Cloud Frontend Observability et Grafana Faro

### Faro — le SDK

Grafana Faro est l'agent JavaScript open source de collecte RUM de Grafana Labs. Il capture :
- des Web Vitals (performance perçue, interactivité, stabilité visuelle) ;
- des erreurs (exceptions non gérées, promesses rejetées), avec support des source maps ;
- des traces (intégration OpenTelemetry-JS, corrélées aux traces backend) ;
- des logs structurés ;
- des événements et sessions utilisateur (navigation, clics, événements personnalisés).

Il s'intègre à la stack LGTM (Loki/Grafana/Tempo/Mimir) : le collecteur reçoit les données, Loki stocke les logs, Tempo les traces, Grafana les visualise.

Sources : https://grafana.com/oss/faro/ · dépôt https://github.com/grafana/faro-web-sdk · doc technique https://grafana.com/docs/grafana-cloud/faro-web-sdk/

### Écrans de Frontend Observability

Note sur les URL : la documentation a été réorganisée sous `/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/...` ; les URL de départ fournies (`/docs/grafana-cloud/monitor-applications/frontend-observability/...`, sans `observe-and-act`) redirigent probablement vers ce nouveau chemin — non vérifié explicitement, mais les deux formes apparaissent dans les résultats de recherche pour les mêmes pages.

**1. Performance (écran d'atterrissage — « Application Performance Overview »)**
- Panneaux : ligne de **Core Web Vitals** (TTFB, FCP, CLS, LCP, FID) en tête ; **Page Loads** (chargements réussis vs échoués, code couleur bleu/rouge) ; **Page Performance** (table des pages avec identifiants et Web Vitals associés, couleur rouge/jaune/vert = poor/needs improvement/good) ; onglet **Errors** (distribution d'erreurs dans le temps, top erreurs par page, comptage par navigateur) ; onglet **Sessions** (comptage par identifiant Faro) ; **Web Vitals P75 Time Series** (séries temporelles scindées « Page Load » / « Cumulative Layout Shift ») ; onglet **HTTP overview** (requêtes totales, erreurs, taux d'erreur, TTFB moyen).
- Filtres : source de données + intervalle temporel (haut droit) ; filtre de métadonnées SDK ajouté/retiré via un bouton « + » (haut gauche) ; bouton **k6 Browser** pour isoler les données synthétiques k6 du trafic réel.
- Drill-down : cliquer une erreur ouvre stack trace + sessions affectées ; cliquer une session ouvre son résumé (Web Vitals + parcours) ; zoom sur les séries temporelles pour resserrer la fenêtre.
- Source : https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/performance/

**2. Errors**
- Panneaux : **Top Exceptions**, **Top URLs by Exception Count**, **Top Browsers by Exception Count** (colonnes Name/Version).
- Filtres : inclusion/exclusion (« + » / « - ») directement sur une erreur ; mêmes filtres de métadonnées que l'écran Performance.
- Drill-down : cliquer une exception (lien bleu) révèle stack trace, navigateur, OS, autres métadonnées, identifiant de session.
- Non établi dans l'extrait obtenu : liste complète des colonnes de chaque panneau, libellés exacts au-delà des trois cités.
- Source : https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/errors/

**3. Sessions**
- Panneaux : liste des sessions ; vue **Session Details** ; table **User Journey** (événements `session_start`, `session_resume`, `view_changed`, `faro.performance.navigation`, `faro.tracing.fetch`, signaux measurement/exception/log).
- Filtres : `page_url`, `browser_*`, `event_*`, recherche textuelle.
- Drill-down : colonne Trace ID → Grafana Cloud Trace Explore ; colonne Explore → actions contextuelles (Traces/Logs/Errors/Services) ; chevron gauche → détail du timing de navigation.
- Source : https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/sessions/

**4. HTTP insights**
- Panneaux : ligne de KPI (Requests total, Errors total, Error rate, TTFB avg, Duration avg, Transfer size) ; panneau **RED** (Rate/Errors/Duration) ; panneau de corrélation santé/performance client ; panneau **Duration** (courbe avec choix de percentile) ; **Calls and erroneous calls** ; **HTTP status codes** (2xx–5xx + 0) ; **Resource load timings** (redirection, DNS, TCP, TTFB…) ; table **HTTP Requests by domain** ; table **HTTP Requests** (détail par requête).
- Filtres : localisation, bascule données k6 (lab + field), sélecteur de percentile (p50/p75/p90/p99/Average), filtre « tous les codes » vs « erreurs seulement ».
- Drill-down : cliquer un domaine dans la table d'ensemble ouvre une page de détail par requête individuelle.
- Source : https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/http-insights/

**5. Geolocation, User actions, Custom tabs — non établi ici.** Leur existence est confirmée (URL ci-dessous, retrouvées via la page « visualize-data » et le moteur de recherche), mais leur contenu (libellés de panneaux, filtres, drill-down) n'a pas été récupéré dans cette lecture.
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/geolocation/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/geolocation-tab/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/user-actions/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/custom-tabs/ (marquée « Experimental » par Grafana)

### Ce que Frontend Observability dit permettre, en général

RUM (Web Vitals, navigation timings, métadonnées device, géolocalisation, information réseau), suivi d'erreurs, interactions utilisateur, traçage côté client, logs navigateur, dashboards, et alertes (« custom alerts or start with built-in presets »).
Source : https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/introduction/what-you-can-do/

---

## b) Bonnes pratiques de conception de dashboards Grafana

Source pour tout ce bloc, sauf mention contraire : https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/

1. **Hiérarchie** — « Hierarchical dashboards with drill-downs to the next level » ; « Dashboard design reflects service hierarchies ». La navigation va du général vers le spécifique, pas l'inverse.
2. **RED / USE** — USE (Utilization, Saturation, Errors) convient aux ressources matérielles ; RED (Rate, Errors, Duration) convient aux services, pour l'alerting et les SLA.
3. **Un panneau = une question** — « A dashboard should tell a story or answer a question » ; « Keep your graphs simple and focused on answering the question that you are asking. »
4. **Réduction de la charge cognitive** — les graphiques doivent être « easy to interpret » : le critère est le temps que met quelqu'un d'autre à comprendre le panneau, pas ce qu'il peut techniquement afficher.
5. **Seuils et couleurs** — « Blue means it's good, red means it's bad. Thresholds can help with that. » Le code couleur doit porter un sens fixe, pas varier d'un panneau à l'autre.
6. **Unités et normalisation des axes** — mesurer en pourcentage plutôt qu'en valeur brute (exemple donné : CPU) pour rendre des ressources comparables entre elles. La page ne détaille pas au-delà de cet exemple ; le reste (choix d'unité par type de métrique, formats) est non établi dans l'extrait obtenu.
7. **Légendes** — non couverte explicitement par cette page dans l'extrait obtenu ; le panneau *time series* (partie c, ci-dessous) donne en revanche des recommandations concrètes (visibilité de série, mode tableau pour les agrégats).
8. **Variables de template** — « prevent sprawl » : « you don't need a separate dashboard for each node. » Une variable qui change la portée d'un dashboard évite d'en dupliquer un par entité.
9. **Répétition de panneaux** — liée aux variables ci-dessus (un panneau répété par valeur de variable plutôt que copié à la main) ; la page « Gauge » (partie c) le confirme séparément : « With repeat options, you can display multiple gauges, each corresponding to a different series. »
10. **Liens et drill-down** — « Directed browsing cuts down on guessing », via dashboard links, panel links ou data links : on clique pour aller au niveau suivant plutôt que de deviner quoi filtrer à la main.
11. **Documentation du panneau** — ajouter une `description` à chaque panneau, et utiliser des panneaux Text pour documenter l'objet du dashboard dans le dashboard lui-même.
12. **Éviter la duplication / le « dashboard sprawl »** — « Copying dashboards with no significant changes is not a good idea » : ça produit des copies qui divergent en silence de l'original.
13. **Annotations de déploiement** — non établi précisément dans cet extrait : le panneau *time series* (partie c) mentionne « Liez les règles d'alerte comme annotations pour observer déclenchements et résolutions », ce qui est une annotation d'événement d'alerte, pas explicitement un marqueur de déploiement. L'usage spécifique « ligne verticale posée au moment d'un déploiement » est une fonctionnalité connue de Grafana (annotations API) mais son comportement précis n'a pas été récupéré dans cette lecture — à vérifier sur la page dédiée aux annotations si le besoin devient concret.

---

## c) Bon usage de chaque type de panneau

| Type | Quand l'utiliser (doc Grafana) | Quand l'éviter | Source |
|---|---|---|---|
| **Time series** | Grand nombre de points datés, difficiles à suivre en table ; comparaisons temporelles, y compris avec décalage de période | Données non chronologiques ; plusieurs points d'une même série au même timestamp (rendu imprévisible) ; peu de points (mieux en table) ; l'empilement (« stacking can create misleading graphs ») | /panels-visualizations/visualizations/time-series/ |
| **Stat** | Surveiller une métrique clé d'un coup d'œil (ex. santé globale) ; valeur agrégée (moyenne, total) ; mise en évidence de dépassement de seuil | Suivre l'évolution détaillée d'une série ; comparer plusieurs métriques en profondeur ; afficher plus de quelques dizaines de valeurs | /panels-visualizations/visualizations/stat/ |
| **Gauge** | Une valeur unique (ou un petit nombre, via repeat) dans une plage min/max connue : SLO, taux de remplissage, latence réseau, CPU 0-100 % | Comparer beaucoup de séries simultanément — la doc ne fixe pas de seuil chiffré précis, mais ne recommande le Gauge que pour peu de valeurs liées | /panels-visualizations/visualizations/gauge/ |
| **Bar gauge** | KPI, santé système, objectifs, taux d'achèvement — une ou plusieurs barres selon le nombre de séries | Non établi précisément (la page ne compare pas explicitement à Gauge/Stat ni ne donne de seuil de nombre de séries) | /panels-visualizations/visualizations/bar-gauge/ |
| **Table** | Données structurées en lignes/colonnes : logs, traces, métriques, tout ce qui irait dans un tableur | Annotations et alertes (non supportées) ; données sans structure colonne-ligne complète ; gros volumes sans pagination | /panels-visualizations/visualizations/table/ |
| **Heatmap** | Grande densité de distribution à condenser par couleur ; détection d'anomalies ; évolution d'une distribution dans le temps — nécessite des données de séries temporelles | La page ne formule pas d'interdiction explicite, mais le panneau suppose des données bucketisées dans le temps — hors de ce cas, un autre panneau convient mieux | /panels-visualizations/visualizations/heatmap/ |
| **Histogram** | Analyser une distribution de valeurs sur une plage de temps donnée (fréquence d'occurrence), détection d'anomalies statistiques | Comparer des catégories discrètes (→ bar chart) ou visualiser une densité à deux dimensions dans le temps (→ heatmap) | /panels-visualizations/visualizations/histogram/ |
| **State timeline** | Suivre l'état (chaîne/nombre/booléen) d'une ou plusieurs entités dans le temps ; valeurs consécutives identiques **fusionnées** | Données non structurées en table (timestamp + entité + état) ; besoin de voir chaque transition séparément (→ status history) | /panels-visualizations/visualizations/state-timeline/ |
| **Status history** | Même usage que state timeline, mais quand chaque changement doit rester **distinct** — « Unlike state timelines, status histories don't merge consecutive values » | Quand une vue compactée est préférable (→ state timeline) | /panels-visualizations/visualizations/status-history/ |
| **Geomap** | La dimension spatiale est centrale : flotte de véhicules, localisation d'infrastructure, tendance géographique — nécessite coordonnées, geohash ou code de référence géographique | Données sans localisation ; un seul point statique (une alternative plus légère suffit) ; très haute densité de points sans clustering | /panels-visualizations/visualizations/geomap/ |
| **Bar chart** | Comparaison catégorielle (une colonne texte/temps + au moins une colonne numérique) : répartition par âge/lieu, usage CPU par application, coût par service | Grand volume de séries temporelles (→ time series configuré en barres) ; jeux de données multiples (« unexpected behavior ») | /panels-visualizations/visualizations/bar-chart/ |
| **Pie chart** | Données qui totalisent un ensemble et dont on veut montrer la proportion de chaque part : part de marché navigateur, causes d'incident par catégorie | Comparaison précise de valeurs proches (le rendu proportionnel s'y prête mal) ; beaucoup de petites catégories (étiquettes tronquées, lisibilité) | /panels-visualizations/visualizations/pie-chart/ |

Base URL commune : `https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/`

---

## 12 règles de conception de panneaux applicables à NOTRE console

Chaque règle relie une bonne pratique Grafana (partie b/c ci-dessus) à un exemple existant dans `apps/console`, avec une manière de le vérifier sans confiance aveugle dans ce document.

**1. Un panneau = une question**
Grafana : « A dashboard should tell a story or answer a question. »
Chez nous : le hero de « Pages lentes » ne porte qu'une question — quelles routes sont les plus lentes en LCP p75 — via un seul `RankBar`, pas un empilement de métriques sur le même panneau.
`apps/console/app/pages/page.tsx:L104-L134` (calcul de `ranked`/`worst`/`poorCount` puis rendu du hero).
Vérifier : ouvrir ce fichier à ces lignes, confirmer qu'aucune métrique annexe (erreurs, trafic) n'est mêlée au graphique du hero.

**2. Hiérarchie avec drill-down progressif**
Grafana : « Hierarchical dashboards with drill-downs to the next level. »
Chez nous : le découpage Web Vitals de l'accueil renvoie vers `/pages` déjà filtré sur la route cliquée, pas vers un écran générique.
`apps/console/components/breakdown-view.tsx:L36-L50` (`vitalsBreakdownItems`, champ `href: drill(ctx, row.valeur)`).
Vérifier : sur l'accueil, ouvrir le bloc « Découpage », cliquer un groupe, constater que l'URL de `/pages` porte le paramètre de route et que l'écran s'ouvre déjà filtré.

**3. Un vocabulaire de seuils et de couleurs, pas un par graphique**
Grafana : « Blue means it's good, red means it's bad. Thresholds can help with that. »
Chez nous : `rating2026` est l'unique fonction qui décide good/needs-improvement/poor ; elle est réutilisée par `VitalPill`, `VitalCard`, `Distribution.Histogram`, `VersionsTable`, `RouteCard`, `UxFrustration` — la couleur « poor » a le même seuil et le même sens partout.
`apps/console/lib/rating.ts:L36-L40`.
Vérifier : `graft grep "rating2026" --in apps/console` — un seul point de définition, de nombreux appelants, aucun composant qui recode ses propres bornes de couleur.

**4. Stat + tendance pour un chiffre qu'on doit juger d'un coup d'œil**
Grafana Stat : « Monitor key metrics at a glance. »
Chez nous : une ligne de groupe d'erreurs affiche le compte ET une mini-courbe (`GroupSparkline`), pas le compte seul — sans la tendance, un compte élevé mais stable et un pic récent se liraient pareil.
`apps/console/components/errors/GroupSparkline.tsx:L10-L40`, utilisé dans `apps/console/components/errors/IssueList.tsx:L316`.
Vérifier : ouvrir `/errors`, constater que chaque ligne de groupe porte une courbe à côté du nombre.

**5. Un tableau reste un tableau — colonnes comparables, pas de prose**
Grafana Table : « Any information you might want to put in a spreadsheet. »
Chez nous : `AnomalyTable` a des colonnes fixes et alignées (App, Route, Heure, LCP p75, Moyenne 7 j, z-score), toutes numériques en `tabular-nums` sauf les deux identifiants.
`apps/console/components/health/AnomalyTable.tsx:L8-L52`.
Vérifier : sur l'accueil, section Anomalies, comparer les en-têtes affichés à cette liste ; aucune colonne ne devrait être ajoutée sans unité ni comparable aux autres lignes.

**6. Heatmap réservée à une vraie densité 2D temporelle**
Grafana Heatmap : « Visualize a large density of your data distribution », données de séries temporelles.
Chez nous : `HealthHeatmap` est la seule vue à croiser deux axes temporels (14 jours × 24 heures) avec un bascule « heures ouvrées » pour ne pas polluer la lecture avec des créneaux sans trafic attendu — ce n'est pas un habillage, c'est la seule vue où jour ET heure comptent en même temps.
`apps/console/components/charts/HealthHeatmap.tsx:L55-L129`.
Vérifier : `graft grep "Heatmap" --in apps/console/components/charts` — un seul composant heatmap dans la console, pas une variante par écran.

**7. Histogram pour une distribution, jamais pour un classement**
Grafana Histogram : distribution de valeurs, fréquence d'occurrence sur une plage.
Chez nous : `Histogram` (dans `Distribution.tsx`) trace des bacs de fréquence colorés par `rating2026`, avec le total de mesures affiché — c'est délibérément un composant distinct de `RankBar`, qui classe des routes.
`apps/console/components/Distribution.tsx:L86-L151`.
Vérifier : sur `/pages`, comparer le bloc « Distribution LCP/INP/CLS » (des bacs de fréquence, sans ordre de routes) au hero « Routes les plus lentes » (un classement) — deux composants, deux questions.

**8. Panneau désactivable plutôt que dashboard dupliqué**
Grafana : les variables de template « prevent sprawl » ; « you don't need a separate dashboard for each node. »
Chez nous : le catalogue de blocs (`dashboard-blocs.ts`) laisse activer/désactiver des sections d'un même écran par cookie, et — point que Grafana ne couvre pas mais qui en prolonge l'esprit — un bloc éteint ne déclenche même pas sa requête, il n'est pas juste masqué en CSS.
`apps/console/lib/dashboard-blocs.ts:L16-L169` (interfaces `Bloc`/`Catalogue`, fonctions `lireChoix`/`serialiserChoix`) ; le commentaire qui explicite le choix est en `apps/console/app/page.tsx:L59` (« Le choix des blocs est lu ICI, AVANT les requêtes : un bloc éteint ne coûte rien »).
Vérifier : dans les réglages d'affichage de l'accueil, décocher un bloc, recharger — même écran, même URL, un ensemble de requêtes en moins (observable dans les logs serveur), pas une page séparée.

**9. Drill-down par lien de données, pas par ressaisie de filtre**
Grafana : « Directed browsing cuts down on guessing. »
Chez nous : une route cliquée dans « Pages lentes » construit un lien direct vers l'écran suivant déjà filtré, sans repasser par un champ de saisie.
`apps/console/app/pages/page.tsx` (fonction `routeHref`, qui s'appuie sur `breakdownDrillHref`).
Vérifier : cliquer une route dans la liste, constater que l'écran ouvert est déjà filtré sur cette route sans étape intermédiaire.

**10. Onglets de dimension comme équivalent de la variable de template**
Grafana : une variable évite de dupliquer un dashboard par entité.
Chez nous : `Breakdown` change la dimension de regroupement (route/app/device/…) par des tabs qui gardent le même composant et la même mise en page ; un tab indisponible reste visible, désactivé, avec sa raison affichée (`tab.reason`) plutôt que d'être caché en silence.
`apps/console/components/Breakdown.tsx:L40-L211`.
Vérifier : sur un écran qui utilise `Breakdown`, cliquer différents tabs — l'URL change de dimension, le composant reste le même.

**11. Pagination par curseur, pas par comptage complet**
Grafana Table : activer la pagination pour les grandes tables plutôt que tout charger.
Chez nous : la liste de sessions demande une ligne de plus que la taille de page pour savoir s'il en reste, sans compter toute la population à chaque affichage.
`apps/console/app/sessions/page.tsx:L78` (commentaire « Une ligne de plus que la page : c'est ainsi qu'on sait s'il en reste, sans compter toute la population à chaque affichage »).
Vérifier : lire ce commentaire et l'appel à `listSessions` juste après (`limit: SESSION_PAGE_SIZE + 1`) ; confirmer qu'aucun `count(*)` séparé n'est fait pour la pagination de cette liste.

**12. Liste plafonnée qui le dit, plutôt qu'une liste silencieusement tronquée**
Grafana (principe de réduction de charge cognitive / lisibilité, partie b n°4) appliqué à un cas que Grafana ne traite pas explicitement dans les extraits obtenus : que faire quand la cardinalité dépasse ce qu'un panneau peut lisiblement montrer.
Chez nous : quand le nombre de routes distinctes dépasse la limite d'affichage, l'écran affiche un bandeau explicite (nombre total, nombre affiché, explication de la cause probable — identifiants non normalisés dans l'URL) plutôt que de couper la liste sans le dire.
`apps/console/app/pages/page.tsx:L60-L76` (bandeau conditionné par `routesTotal > ROUTES_MAX`).
Vérifier : sur une app dont le catalogue de routes dépasse `ROUTES_MAX`, constater la présence du bandeau et son chiffre exact (`routesTotal.toLocaleString("fr-FR")`).

---

## Table « question → type de panneau »

| Question posée | Type de panneau | Pourquoi (doc Grafana / conséquence pratique) |
|---|---|---|
| Combien vaut ma métrique clé maintenant, avec sa tendance récente ? | **Stat** (+ sparkline) | « Monitor key metrics at a glance » |
| Où est-ce que ma métrique se situe dans sa plage connue (SLO, 0-100 %) ? | **Gauge** ou **Bar gauge** | Gauge pour une valeur (ou un petit nombre via repeat) dans un min/max ; Bar gauge pour comparer plusieurs séries à seuils communs |
| Comment cette métrique évolue-t-elle dans le temps ? | **Time series** | Panneau par défaut pour une série temporelle dense |
| Quel est l'état (up/down/ok/warn) de plusieurs entités au fil du temps ? | **State timeline** (fusionne les valeurs identiques consécutives) ou **Status history** (les garde distinctes) | Selon qu'on veut une vue compactée ou chaque transition |
| Quelle est la forme de la distribution de mes valeurs (pas leur ordre) ? | **Histogram** | Fréquence d'occurrence sur une plage, pas un classement |
| Comment une distribution évolue-t-elle dans le temps (2 axes) ? | **Heatmap** | Condense une densité 2D par couleur, nécessite des données temporelles |
| Quelles sont mes N pires/meilleures entités, classées ? | **Bar chart** (catégories discrètes) | Comparaison catégorielle, pas une série temporelle dense |
| Quelle est la part de chaque catégorie dans un total ? | **Pie chart** | Seulement si les valeurs s'additionnent en un tout et le nombre de tranches reste faible |
| Où se passe l'événement géographiquement ? | **Geomap** | Nécessite une dimension spatiale réelle (coordonnées, geohash, code pays…) |
| Je dois lister/trier/filtrer des enregistrements détaillés | **Table** | Données structurées en lignes/colonnes, avec tri et data links |
| Je documente l'objet d'un dashboard ou d'une section | **Text** | Markdown/HTML, pas une visualisation de données |

Base URL des types de panneaux : `https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/`

---

## Sources consultées (URLs)

- https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/ (page d'entrée — n'a pas donné le détail des écrans)
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/performance/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/errors/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/sessions/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/http-insights/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/introduction/what-you-can-do/
- https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/ (liste des sous-pages, dont geolocation, geolocation-tab, user-actions, error-awareness, custom-tabs — non lues en détail)
- https://grafana.com/oss/faro/
- https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/ (index)
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/time-series/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/gauge/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/bar-gauge/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/table/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/heatmap/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/histogram/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/state-timeline/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/status-history/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/geomap/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/bar-chart/
- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/pie-chart/

Non lues dans cette session mais repérées par `WebSearch` comme potentiellement utiles pour un approfondissement futur : le billet de blog Grafana Labs « Actionable insights into the end-user experience: an overview of Grafana Cloud Frontend Observability dashboards » (https://grafana.com/blog/actionable-insights-into-the-end-user-experience-an-overview-of-grafana-cloud-frontend-observability-dashboards/) et la page produit https://grafana.com/products/cloud/frontend-observability/.

## Sources internes (repo, via graft)

- `apps/console/app/page.tsx` (Overview) — L39-L294, L59
- `apps/console/app/pages/page.tsx` (Pages lentes) — L43-L264, L60-L76, L104-L134
- `apps/console/app/sessions/page.tsx` (Sessions) — L48-L415, L78
- `apps/console/lib/dashboard-blocs.ts` — L16-L169
- `apps/console/lib/dashboard-access.ts` — L142-L154
- `apps/console/lib/rating.ts` — L36-L40
- `apps/console/lib/health.ts` — L138-L264
- `apps/console/lib/queries.ts` — L124-L142
- `apps/console/lib/queries-errors.ts` — L825-L882
- `apps/console/components/charts/VitalsTimeseries.tsx` — L21-L81
- `apps/console/components/charts/HealthHeatmap.tsx` — L55-L129
- `apps/console/components/charts/Gauge.tsx` — L26-L73
- `apps/console/components/charts/RadarScore.tsx` — L24-L51
- `apps/console/components/charts/ScatterPlot.tsx` — L38-L118
- `apps/console/components/health/AnomalyTable.tsx` — L8-L52
- `apps/console/components/health/HealthBanner.tsx` — L82-L142
- `apps/console/components/errors/GroupSparkline.tsx` — L10-L40
- `apps/console/components/errors/IssueList.tsx` — L316
- `apps/console/components/Distribution.tsx` — L86-L151
- `apps/console/components/Breakdown.tsx` — L40-L211
- `apps/console/components/breakdown-view.tsx` — L36-L50
