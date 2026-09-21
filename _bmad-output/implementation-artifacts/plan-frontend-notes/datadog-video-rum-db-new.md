# Lecture — vidéo Datadog RUM « rum-db-new »

Relevé le 18/09/2026 sur les images extraites à 1 image/seconde.

## 0. Source et ce qu'elle garantit

- Fichier d'origine : `/Users/juliantalou/Downloads/datadog screenshots and videos /rum-db-new.mp4` (433 093 octets).
- Images lues, dans l'ordre, une par une : `scratchpad/datadog/frames/rum-db-new/f001.png` à `f009.png`
  (9 fichiers, chemin complet :
  `/private/tmp/claude-501/-Users-juliantalou-Documents-PRO-01-CLIENTS-MIP-DEV-poc-MIP-RUM/69c961b4-4adf-49b9-a810-3af9b5d672e7/scratchpad/datadog/frames/rum-db-new/`).
- Neuf images à 1 image/s : la vidéo dure environ 9 secondes. Ce relevé garantit ce qui est **visible sur
  ces neuf images**. Il ne garantit rien de ce qui se passe entre deux images (un clic, un survol
  intermédiaire), ni du son, ni de ce qui suit la dernière image. Les données affichées sont celles de
  l'application de démonstration « Shop.ist » de Datadog ; ce ne sont pas des données réelles.
- Aucune page du site Datadog n'a été consultée pour ce relevé : là où une définition Datadog serait
  nécessaire (ex. la mesure « Loading Time »), elle est marquée « non établi ».

## 1. Scénario reconstitué, image par image

| Image | Ce qui est visible | Ce qui change par rapport à l'image précédente |
|---|---|---|
| `f001.png` | Explorateur RUM, onglet **Sessions & Replays**, jeu « Views », liste triée par **Loading Time** décroissant. Curseur à gauche de la liste, près de « Hide Controls ». | — |
| `f002.png` | Idem. | Le curseur est sur l'en-tête de colonne **DATE**, qui passe en surbrillance bleue avec un chevron : le survol d'un en-tête révèle un menu de colonne (tri, options). |
| `f003.png` | Idem. | Le curseur est sur la **première ligne** (Apr 15 14:31:20.819, 102.8 s, United Kingdom, Chrome) ; la ligne est surlignée. |
| `f004.png` | Idem. | Aucun changement visible : le clic a lieu entre `f004` et `f005`. |
| `f005.png` | Un **panneau latéral** s'ouvre par la droite (environ 70 % de la largeur), l'explorateur reste visible dessous. En-tête « VIEW · Load Page / », bouton **Jump to Replay**, croix. Tags de contexte en **squelette gris**. Onglets : Performance (actif), Errors, Resources 19, Traces 1, Actions, Logs 2, Attributes. Deux cartes Core Web Vitals déjà remplies (LCP 25.23 s ✕ rouge, CLS 0.0003 ✓ vert), FCP 1930.8 ms, Loading Time 102.8 s. Zone waterfall : **spinner**. | Navigation liste → détail sans changer de page. |
| `f006.png` | Les tags se remplissent : `service:shopist-web-ui`, `Linux`, `env:prod`, `version:6956739`, `Chrome`, `United Kingdom`, `Jane Doe` ; `View Name:/`, `View Loading Type:initial_load`, `View Time Spent:110.79s` ; horodatage « Apr 15, 2:31:20 pm ». « Parent Hierarchy : SESSION — Browser session lasting 2m by user Jane Doe ». Le waterfall montre ses en-têtes NAME / SIZE / DURATION et « Loading... ». | Deuxième étape de chargement : le contexte arrive avant le waterfall. |
| `f007.png` | Le **waterfall** est rendu : mini-carte à quatre pistes (Actions, Errors, Resources, Long tasks) sur un axe 0 → 1 m 50 s, avec trois repères verticaux ; tableau des ressources (`shopist.io` 18 KB 949 ms, `datadog-rum-v4.js` 315 ms, `datadog-logs-v4.js` 323 ms, `runtime.6fa51d7.js` 3 KB 150 ms, `commons.app.923dbe0.js` 173 KB 352 ms, `app.ad67d88.js` 82 KB 348 ms…) avec une colonne chronologique portant les marqueurs **FCP**, **LCP**, **LT**. Pied : « Displaying 32 out of 32 events — [See full list of events ▾] for this View in the RUM explorer ». | Troisième étape : les données de détail. |
| `f008.png` | Identique à `f007`. | Aucun. |
| `f009.png` | Identique à `f007`. | Aucun : la vidéo se termine sur le waterfall (ou boucle). |

Le parcours tient en trois gestes : **trier la population par la douleur** (Loading Time ↓), **cliquer la
pire ligne**, **lire la cause dans le panneau** (LCP en échec, tâches longues, ressources) avec le replay à
un clic. Ce qui suit le waterfall (clic sur « Jump to Replay », « Expand Waterfall », onglets Errors /
Traces) n'est **pas montré** : non établi.

## 2. Écran A — explorateur « Sessions & Replays », jeu Views (`f001`–`f004`)

### Mise en page (de haut en bas, de gauche à droite)

1. **Barre de titre** : sélecteur « Views », titre « Real User Monitoring », bouton « + Save » (enregistre
   la requête courante comme vue), sélecteur de fenêtre « 1h · Past 1 Hour », trois boutons de
   défilement temporel (◀◀ ▐▐ ▶▶ — un bouton **pause** est actif, la liste est donc en rafraîchissement
   continu), un bouton de zoom arrière, « Learn More ».
2. **Onglets de section** : Applications · **Sessions & Replays** (actif) · Dashboards ▾.
3. **Barre de requête** : « In [Views ▾] » (le jeu de données est un choix explicite), puis la requête
   sous forme de **pastilles retirables** : `Application Id:Shop.ist ×`, `Has Replay:true ×`,
   `View Path:/ ×`, bouton d'effacement global, et un bouton `</>` qui bascule la même requête en mode
   texte.
4. **« Visualize as »** : List (actif) · Timeseries · Top List · Table · Distribution · Geomap · Funnel.
   À droite, « Hide Metrics » replie les deux widgets du point 6.
5. **Colonne de facettes** (gauche, ~20 % de la largeur) : champ « Search facets », « Showing 175 of 175 »,
   « + Add ». Groupes repliables APPLICATION, CORE, **BROWSER** (déplié) → « Browser Name » avec cases à
   cocher et **comptes** : Chrome 8.83k, Firefox 1.62k, Edge 1.20k, Chrome Mobile 1.11k, Firefox Mobile 707,
   Edge Mobile 628, HeadlessChrome 29, Safari 1 ; puis « Browser Main Version », « Browser Version »
   (repliés) ; GEO, DEVICE, OS, VIEW URL (repliés).
6. **Deux widgets de contexte** au-dessus de la liste, côte à côte :
   - **« View count »** — série temporelle en **barres** (comptage), axe y 0–400, axe x 14:15 → 15:00
     (un seau par minute environ sur la fenêtre d'une heure). Elle dit le volume ; elle ne dit rien de la
     latence.
   - **« Page loading time distribution »** — **histogramme** de la mesure « loading time », axe x gradué
     « 10 s », « 20 s », avec quatre repères verticaux pointillés étiquetés en haut **p50, p75, p90, p95**.
     La distribution est asymétrique à droite (mode sous 5 s, longue queue au-delà de 20 s). Les repères
     situent la ligne cliquée (102,8 s) très au-delà du p95.
7. **Rangée de contrôles** : « Hide Controls » (replie les facettes), interrupteur actif « Show only
   sessions with replay available · NEW · Get Started », à droite « Export » et « Options ».
8. **Bandeau « Watchdog Insights »** (bord pointillé magenta, replié, chevron) : badge **3**, texte
   « Error outliers and latency outliers », lien « View all ». Le contenu des trois insights n'est jamais
   déplié dans la vidéo : non établi.
9. **Liste** (le « Visualize as : List ») : par ligne, un bouton ▶ (replay) et une fine barre colorée, puis
   les colonnes **DATE · LOADING TYPE · VIE… (view path, tronqué) · ↓ LOADING TIME · COUNTRY · BROWSER
   NAME**. Le tri actif est « Loading Time » décroissant (flèche). Dix lignes visibles, toutes
   `initial_load` sur `/` : 102.8 s (United Kingdom, Chrome), 92.52 s (Canada, Chrome), 84.07 s (Ireland,
   Chrome), 81.74 s (United States, Chrome), 80.34 s (Canada, Chrome), 78.76 s (United States, Chrome),
   69.97 s (United Kingdom, Chrome), 69.79 s (United Kingdom, Edge), 68.34 s (Sweden, Chrome Mobile).

### Ce que l'écran cherche à démontrer

- **Une seule requête, plusieurs formes** : la barre de pastilles est l'état de l'écran ; « Visualize as »
  change la représentation sans changer la requête ; « + Save » la conserve.
- **La liste n'est jamais lue sans son contexte** : volume (barres) et distribution (histogramme avec
  percentiles) précèdent les lignes, et se replient d'un clic quand on n'en a plus besoin.
- **Triage « pire d'abord »** : tri par la mesure de douleur, filtre `Has Replay:true` pour que chaque
  ligne soit rejouable, bouton ▶ sur chaque ligne.
- **Les anomalies sont signalées, pas imposées** : le bandeau Watchdog est compté (3) et replié.

### Ce que l'écran ne montre pas

- Le clic sur une facette (ajoute-t-il une pastille ? remplace-t-il ?) : non établi.
- Le contenu de « Top List », « Geomap », « Funnel » sur ce jeu : non établi.
- Ce que compte exactement « View count » (vues, ou vues filtrées par la requête) : non établi ; les
  ordres de grandeur (≈ 300/min vs 8,83 k Chrome sur l'heure) sont cohérents avec « vues filtrées ».

## 3. Écran B — panneau latéral « VIEW · Load Page / » (`f005`–`f009`)

### Mise en page

1. **En-tête fixe** : badge « VIEW », titre « Load Page / », bouton **« ▶ Jump to Replay »** (toujours visible,
   à droite), croix de fermeture.
2. **Tags de contexte** (deux rangées) : `service:shopist-web-ui`, OS `Linux`, `env:prod`,
   `version:6956739`, navigateur `Chrome`, pays `United Kingdom` (drapeau), utilisateur `Jane Doe` ;
   `View Name:/`, `View Loading Type:initial_load`, `View Time Spent:110.79s` ; horodatage à droite.
   Chaque tag reprend une colonne ou une facette de l'écran A : le panneau est une **ligne de la liste
   dépliée**, pas un autre objet.
3. **« Parent Hierarchy »** : « ● ▶ SESSION — Browser session lasting 2m by user Jane Doe », menu ⋮. La vue
   sait d'où elle vient (sa session) et le dit avant tout détail.
4. **Onglets comptés** : Performance (actif) · Errors · **Resources 19** · **Traces 1** · Actions ·
   **Logs 2** · Attributes. Le compte est affiché avant le clic : on sait s'il y a quelque chose derrière.
5. **« Event Timings and Core Web Vitals »** (onglet Performance) : deux **cartes à verdict** —
   LARGEST CONTENTFUL PAINT **25.23 s** avec ✕ rouge, CUMULATIVE LAYOUT SHIFT **0.0003** avec ✓ vert ;
   puis en ligne : First Contentful Paint **1930.8 ms**, Loading Time **102.8 s**, « ▾ Show More ».
   Le verdict est porté par la carte, pas par le lecteur.
6. **Waterfall** : lien « Expand Waterfall » (plein écran), trois filtres à entonnoir **Network · Events ·
   Timings**, champ « Search for events by name ». Puis :
   - **mini-carte** à quatre pistes horizontales **Actions · Errors · Resources · Long tasks** sur l'axe
     temporel de la vue (0 → 1 m 50 s). Resources : une barre bleue continue de 0 à ≈ 1 m 30 s (des
     ressources se chargent pendant toute la vue). Long tasks : segments jaunes à ≈ 2–5 s, ≈ 25 s, ≈ 30 s,
     ≈ 35 s, ≈ 1 m, ≈ 1 m 10 s, ≈ 1 m 20 s–1 m 30 s, ≈ 1 m 45 s. Actions et Errors : vides sur cette vue.
     Trois repères verticaux à ≈ 2 s, ≈ 25 s, ≈ 1 m 40 s, qui coïncident avec **FCP, LCP, LT**.
   - **tableau** NAME · SIZE · DURATION · colonne chronologique (barres alignées sur l'axe, marqueurs FCP,
     LCP, LT en tête). Les six premières ressources sont toutes sous 1 s : la lenteur de la vue n'est pas
     dans ces lignes-là, elle est dans les tâches longues et dans ce qui vient après (non visible sans
     défilement).
   - **pied** : « Displaying 32 out of 32 events · [See full list of events ▾] · for this View in the RUM
     explorer » — pivot inverse, du détail vers la population.

### Trois états de chargement successifs

`f005` : cartes CWV remplies, tags en squelette, waterfall en spinner. `f006` : tags remplis, waterfall
« Loading... ». `f007` : tout est là. Sur une vidéo de 9 s, le panneau passe ≈ 2 s sans ses tags et ≈ 3 s
sans son waterfall. Les valeurs des tags (pays, navigateur, date, chemin, type de chargement) étaient
**déjà sur la ligne cliquée** : le squelette y est un choix de mise en œuvre, pas une contrainte de donnée.

### Ce que l'écran cherche à démontrer

« **De la vue lente à sa cause, puis à sa preuve** » : LCP en échec (25 s) → tâches longues réparties sur
toute la vue → ressources listées → replay à un clic. Et « **de l'instance à sa session** » (Parent
Hierarchy) et « **de l'instance à la population** » (See full list… in the RUM explorer).

### Ce que l'écran ne montre pas

- La définition de **« Loading Time »** (102,8 s pour une vue dont le LCP est à 25 s et le « time spent »
  à 110,79 s) : non établi. Un chiffre de 100 s sans définition à côté se lit comme une anomalie de
  mesure.
- Le contenu des onglets Errors, Resources, Traces, Actions, Logs, Attributes : non établi.
- Le replay lui-même : non établi.
- Ce que filtrent « Network / Events / Timings » : non établi (par leur nom, les trois familles de
  lignes du waterfall).

## 4. Motifs d'interaction et de drill-down à retenir

Chaque motif est rattaché à ce que la console MIP fait déjà, ou pas, avec la preuve.

| # | Motif observé chez Datadog | Chez nous (preuve) | À retenir |
|---|---|---|---|
| M1 | La requête est **visible en pastilles retirables**, avec un mode texte `</>`. | Les filtres vivent dans l'URL et sont validés avant toute requête : `apps/console/lib/page-filters.ts:L67-L91` (`pageFilters`). Une représentation en pastilles retirables n'est pas établie. | Rendre la requête lisible et retirable élément par élément, sans changer le principe « l'URL est l'état ». |
| M2 | **« Visualize as »** : la même requête, sept représentations. | L'Explorer porte un jeu de données, une mesure et une représentation (`apps/console/app/explorer/page.tsx:L79-L313`, `ExplorerPage`, variable `vizCourante`) ; la liste exacte des représentations n'est pas établie ici. Funnel existe à part : `apps/console/lib/queries-funnel.ts:L46-L78`, `apps/console/components/Funnel.tsx:L55-L86`. | Garder le principe « requête d'abord, forme ensuite » ; ne pas dupliquer la requête par représentation. |
| M3 | **Deux widgets de contexte** au-dessus de la liste : comptage en barres + distribution avec **p50/p75/p90/p95**. | Histogramme coloré par verdict 2026 mais **sans repères de percentiles** : `apps/console/components/Distribution.tsx:L86-L151` (`Histogram`), requête `apps/console/lib/queries.ts:L96-L115` (`vitalHistogram`). Série temporelle p75 avec seuils good/poor : `apps/console/components/charts/VitalsTimeseries.tsx:L21-L81`. | Ajouter les repères de percentiles à l'histogramme : c'est ce qui situe une ligne dans sa population. Garder nos seuils good/poor sur la série, que Datadog ne montre pas ici. |
| M4 | **Facettes avec comptes** par valeur. | L'Explorer propose les dimensions non collectées **désactivées avec leur raison** (`ExplorerPage`, bloc `dimensions`, `dimensionSupport`). Les comptes par valeur ne sont pas établis. | Ajouter les comptes ; conserver la raison d'indisponibilité, que Datadog n'affiche pas. |
| M5 | **Tri par la douleur, décroissant, par défaut** ; bouton ▶ par ligne ; filtre « replay disponible ». | `/pages` classe les routes par LCP p75 (`apps/console/app/pages/page.tsx:L76-L77`, « Pages lentes »). Une liste **d'instances** de vues triée par mesure, avec un ▶ par ligne, n'est pas établie. Le lecteur de replay existe : `apps/console/components/replay/ReplayPlayer.tsx:L30-L185`, ouvert par l'onglet Replay de la session et positionnable par `?at=` (`apps/console/app/sessions/[id]/page.tsx:L19-L156`). | Une liste d'instances (une ligne = une page vue) triée par mesure, avec l'accès replay sur la ligne, complète `/pages` (agrégé par route) sans le remplacer. |
| M6 | **Insights automatiques** comptés, repliés, « View all ». | Matière existante : `v_anomaly` (`apps/console/lib/queries-projects.ts:L132-L141`, `anomaliesParApp`) et z-score sur les logs (`apps/console/lib/queries-logs.ts:L88-L102`, `logAnomalies`). Un bandeau dans l'Explorer n'est pas établi. | Un bandeau compté et replié, qui ne s'affiche pas quand le compte est zéro. |
| M7 | **Panneau latéral** au lieu d'une navigation : le contexte reste visible dessous. | Le détail de session est une page (`/sessions/[id]`), pas un panneau. | Le panneau vaut pour « lire une ligne sans perdre la liste » ; la page vaut pour un lien partageable. Les deux peuvent coexister (panneau avec lien « ouvrir en page »). |
| M8 | **En-tête = la ligne dépliée** (tags qui reprennent les colonnes) + **Parent Hierarchy** (la session). | La page session affiche App, Device, Navigateur, **Pays estimé avec sa provenance** (`sessions/[id]/page.tsx`, bloc `Meta`, P8.7), Source SDK/Extension, Durée, Pages. | Garder la provenance du pays : Datadog montre un drapeau sans dire d'où il vient. Ajouter la remontée « vue → session » d'un clic. |
| M9 | **Onglets comptés** (Resources 19, Traces 1, Logs 2). | La session affiche les comptes par famille de timeline (`counts[k]` sur `TimelineKind`, `apps/console/lib/queries.ts:L418-L427` : pageview, vital, error, breadcrumb, longtask, event, action, resource, api). | Nos familles couvrent les quatre pistes Datadog (Actions, Errors, Resources, Long tasks) et plus. Les compter dans les onglets avant le clic. |
| M10 | **Cartes CWV à verdict** (✕/✓) puis mesures secondaires en ligne, « Show More ». | Verdicts 2026 calculés (`rating2026`, utilisé dans `Distribution.tsx`). | Porter le verdict sur la carte, pas dans une légende. |
| M11 | **Waterfall** = mini-carte par pistes + tableau aligné sur le même axe + marqueurs FCP/LCP/LT + filtres par famille + recherche. | Un waterfall existe pour les **traces** (`apps/console/app/tracing/[traceId]/page.tsx:L49-L229`, « douleur utilisateur → cause backend »). La timeline de session est une **liste verticale** (`TimelineRow`), sans axe temporel horizontal. Les ressources agrégées portent un avertissement de **seuil de collecte** (`apps/console/components/ResourcesView.tsx:L92-L186`, `RESOURCE_THRESHOLD_NOTICE`). | Le motif « mini-carte + tableau sur un axe commun » est celui à reprendre pour une page vue. Chez nous il devra **dire qu'il est partiel** (seuil SDK) là où Datadog affiche « 32 out of 32 ». |
| M12 | **Pivot inverse** « See full list of events for this View in the RUM explorer ». | Les liens d'erreur gardent le périmètre en tête (`apps/console/components/errors/error-view.ts:L37-L49`, `errorsHref`). | Tout détail doit offrir le chemin retour vers la population filtrée sur lui. |
| M13 | **« Jump to Replay »** en en-tête, toujours visible. | Replay positionnable à un instant : `?tab=replay&at=` (`sessions/[id]/page.tsx`, commentaire sur `at`). | Exposer ce lien depuis la vue (avec `at` = début de la vue), pas seulement depuis l'erreur. |

## 5. Ce qui serait à éviter

- **175 facettes déroulables** : la liste est là parce que tout est indexé, pas parce que tout sert.
  Notre choix — une dimension proposée désactivée **avec sa raison** — dit plus avec moins.
- **Une mesure sans définition à l'écran** (« Loading Time 102.8 s »). Toute mesure maison (notre
  « temps lié » des actions, `apps/console/app/actions/page.tsx:L17-L116`, est déjà défini dans le
  sous-titre : « corrélation heuristique, bornée à 5 secondes ») doit garder sa définition à côté du
  chiffre.
- **Un tri « pire d'abord » sur une population qui contient des robots** : « HeadlessChrome 29 » figure dans
  les facettes de la vidéo, et rien n'indique qu'il est exclu de la liste. Nos requêtes portent une clause
  d'exclusion des bots (`botClause`, visible dans `apps/console/lib/queries-funnel.ts:L46-L78`) : la garder
  active par défaut sur toute liste d'instances.
- **Un waterfall qui se dit complet** (« 32 out of 32 ») alors que notre SDK ne collecte les ressources
  qu'au-dessus d'un seuil (`RESOURCE_THRESHOLD_NOTICE`). Un waterfall chez nous affiche « N ressources
  retenues au-dessus du seuil », jamais « toutes ».
- **Trois états de chargement** pour un panneau dont l'en-tête était déjà connu de la ligne cliquée. Ouvrir
  le panneau avec les valeurs de la ligne, et ne mettre en attente que ce qui n'est pas encore lu.
- **Un pays sans provenance** (drapeau seul). Garder « Pays estimé · source », P8.7.
- **Un bandeau d'insights qui attire l'œil (magenta, pointillé) sans dire ce qu'il contient** : acceptable
  s'il est compté et si zéro le fait disparaître ; à éviter s'il s'affiche vide ou en permanence.
- **Collision de vocabulaire** : chez Datadog, « Views » = pages vues (jeu de données) ; chez nous,
  `/explorer/views` = **vues enregistrées** de l'Explorer (`apps/console/app/explorer/views/page.tsx:L23-L168`,
  « Vues enregistrées »). Trancher le mot avant d'implémenter une liste de pages vues, sinon deux écrans
  porteront le même nom pour deux objets.
- **Le rafraîchissement continu par défaut** (bouton pause actif dans la barre de titre) sur une liste que
  l'on est en train de trier et de cliquer : une ligne qui bouge sous le curseur entre `f003` et `f004`
  ferait cliquer la mauvaise. Sur une liste de triage, le rafraîchissement est explicite, pas implicite.

## 6. Non établi (récapitulatif)

- Définition Datadog de « Loading Time » et de « View Time Spent ».
- Contenu des trois « Watchdog Insights » et des onglets Errors / Resources / Traces / Actions / Logs /
  Attributes.
- Comportement d'un clic sur une facette ou sur « Visualize as : Geomap / Funnel / Top List ».
- Ce qui suit `f009` (replay, « Expand Waterfall »).
- Liste exacte des représentations de notre Explorer (`vizCourante`) : à lire dans
  `apps/console/lib/analytics-schema.ts` avant de la comparer aux sept de Datadog.
- Existence chez nous d'un filtre « sessions avec replay disponible » sur `/sessions`.
