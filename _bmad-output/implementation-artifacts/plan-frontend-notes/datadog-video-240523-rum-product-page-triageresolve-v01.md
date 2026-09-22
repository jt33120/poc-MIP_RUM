# Lecture — vidéo Datadog RUM « 240523-rum-product-page-triageresolve-v01 »

## Source et limites de la lecture

- Source : 11 images extraites à 1 image/seconde, `f001.png` à `f011.png`, dans
  `scratchpad/datadog/frames/240523-rum-product-page-triageresolve-v01/`. La vidéo dure donc
  environ 11 secondes. C'est la boucle « Triage & resolve » embarquée sur la page produit RUM de
  Datadog (le nom du fichier le dit ; la page est
  https://www.datadoghq.com/dg/real-user-monitoring/overview/).
- Ce que la cadence garantit : chaque écran stable est vu au moins une fois. Ce qu'elle ne
  garantit pas : les clics eux-mêmes. Entre deux images, un clic peut avoir eu lieu sans être
  visible ; `f003.png` est une image de transition (panneau en cours de glissement, texte flou).
  Là où le clic n'est pas visible, je déduis l'interaction de l'écran suivant et je le dis.
- Pas de son, pas de sous-titre : le scénario ci-dessous est reconstruit de l'image seule.
- Les données montrées sont celles d'une application de démonstration (« Shop.ist ») et la
  session ouverte est générée par un test Synthetic, pas par un utilisateur réel (bandeau visible
  dès `f002.png`). Ce point compte pour la lecture : voir « À éviter ».

## Scénario reconstitué, image par image

| Image | Écran | Interaction déduite | Ce qui est mis en avant |
|---|---|---|---|
| `f001.png` | Sessions Explorer (liste) | Aucune ; curseur près de « 33.6k Sessions found » | Une requête déjà posée : `@geo.country:"United States"` `@session.last_view.name:"/checkout"`, plage « Past 2 Weeks », 33,6 k sessions, histogramme « Session count », tableau de sessions, bandeau « 2 Watchdog Insights » replié |
| `f002.png` | Panneau latéral SESSION (« Synthetic browser session lasting 52s ») | Clic sur la 1re ligne du tableau (déduit) | 4 compteurs (7 vues, 10 actions, 0 erreur, 0 signal de frustration), liste chronologique des événements de la session (View Load / Click / Custom), survol d'une ligne « View Load » qui révèle « Open View waterfall → » |
| `f003.png` | Transition : un 2e panneau VIEW glisse par-dessus le panneau SESSION | Clic sur la ligne « 8.76 s · View Load · Load Page /department/chairs » (déduit du contenu de f004) | Le panneau VIEW arrive avec l'onglet Performance ouvert |
| `f004.png` | Panneau VIEW, onglet Performance, survol de la tuile LCP | Survol de « LARGEST CONTENTFUL PAINT 132.5 ms » | Popover : barre de seuils (2,5 s / 4 s), verdict « good », sélecteur CSS de l'élément LCP, comparaison au p75 30 jours des vues similaires (858,45 ms) |
| `f005.png` | Idem f004 | Curseur déplacé de quelques pixels ; infobulle « Largest Contentful Paint: 132.5 ms » | Rien de nouveau |
| `f006.png` | Panneau VIEW, survol de la tuile CLS | Survol de « CUMULATIVE LAYOUT SHIFT 0 » | Popover : barre de seuils GOOD / 0.1 NEEDS IMPROVEMENT / 0.25 POOR ; « Most shifted element : No element available … deleted or changed since the time at which this vital was captured » |
| `f007.png` | Panneau VIEW, onglet Performance, popover fermée | Curseur sur l'onglet « Traces 1 » | Vue complète de l'onglet Performance : tuiles, FCP, Loading Time, mini-waterfall, table des ressources |
| `f008.png` | Panneau VIEW, onglet Traces | Clic sur « Traces 1 » puis survol du span racine `/products.json` à 70,2 ms | Flame graph de la trace (3 services), infobulle « 126 ms (100 % total duration) · Error detected », volet inférieur « Missing error message and stack trace » sur le span navigateur |
| `f009.png` | Idem, survol de `ProductsController#index` à 81,5 ms | Survol | Infobulle « 75.3 ms [p12] (59.8 %) · CODE HOTSPOTS CPU Time 43.7 ms · Error detected » ; volet inférieur : message Ruby ``undefined method `offer_timed_discount'``, « First seen 3 years ago in v. 8.4.3 », lien « View stack trace » |
| `f010.png` | Idem, survol de `POST /check-token` à 90,6 ms | Survol | Infobulle « auth-dotnet · aspnet_core.request · 11.5 ms [p53] (9.11 %) » ; volet inférieur : Span Tags |
| `f011.png` | Idem, survol d'une barre SQL à 92,6 ms | Survol | Infobulle « auth-dotnet · postgres.query · SELECT * FROM Sessions where Token = ? · 1.02 ms (0.81 %) » ; volet inférieur : la requête SQL, Span Tags |

Chaîne complète en 11 secondes : liste filtrée → une session → une vue de cette session → ses
vitals (avec l'élément responsable et un point de comparaison) → la trace backend rattachée à
la vue → l'exception dans le contrôleur → la requête SQL. Tout se passe sans quitter l'écran :
deux panneaux latéraux empilés, jamais de changement de page.

## Écran A — Sessions Explorer (`f001.png`)

Mise en page, de haut en bas et de gauche à droite :

- Barre produit : « RUM » puis sélecteur d'application (« Shop.ist », icône JS), sélecteur de
  plage (« 2w · Past 2 Weeks ») avec épingle, commandes de lecture temporelle (précédent /
  pause / suivant) et zoom.
- Onglets de section : Performance Monitoring ▾, Product Analytics ▾, Session Replay ▾, Error
  Tracking, Sessions Explorer (actif). Sous-ligne « Views | My View ⋮ » (vues enregistrées).
- Barre de requête : « In Sessions ▾ » (le jeu de données interrogé), puis la requête en
  syntaxe facette:valeur, effacement, bascule vers l'éditeur textuel (`</>`), et agrandissement.
- Ligne « Visualize as » : List (actif), Timeseries, Top List, Table, Distribution, Geomap,
  Funnel, Tree Map, Pie Chart. La même requête se rend sous neuf formes ; la vidéo n'en montre
  qu'une.
- Colonne de facettes (gauche) : case « Session Replay available » avec icône lecture ;
  recherche de facettes ; « Showing 246 of 246 | + Add » ; groupes repliables CORE, USER (User
  Name, User Account Type, User Email, User Id, usr.team, User Handle, User Type), DEVICE
  (Device Type : Desktop 16.1k, Mobile 9.95k, Tablet 7.48k — cases à cocher avec compte),
  Device Architecture. Les comptes sont ceux de la requête en cours : cocher une valeur
  restreint, et le compte annonce ce qu'on obtiendra.
- Graphique principal : « Session count », histogramme en barres, un axe temporel du 9 au
  22 mai (libellés Thu 9 … Wed 22), axe Y 0 / 0.5k / 1k. Une seule mesure (nombre de sessions),
  une seule couleur. Une périodicité hebdomadaire est visible (creux les 11-12 et 18-19).
- Ligne d'outils : « Hide Controls | 33.6k Sessions found | Download as CSV | More… | Options ».
- Bandeau « ⚠ 2 · Watchdog Insights · RUM | View all », replié. Il n'est jamais ouvert dans la
  vidéo : ce qu'il contient est non établi.
- Tableau : une icône lecture (replay disponible) et une barre violette par ligne, puis DATE,
  SESSION TYPE (synthetics), TIME SPENT, VIEW COUNT, ERROR COUNT, ACTION COUNT, FRUSTRATION
  COUNT, INITIAL VIEW NAME, LAST VIEW NAME (tri ↑ actif sur cette colonne). Les lignes
  montrent des durées de 15 à 57 s, 5 à 7 vues, 0 erreur, 7 à 13 actions, 0 ou 1 frustration,
  `/` en vue initiale et `/checkout` en vue finale.

Ce que l'écran garantit : la requête, le nombre trouvé et le tableau parlent de la même
population, et les facettes affichent leurs comptes dans cette population. Ce qu'il ne garantit
pas : rien sur l'écran ne dit si 33,6 k est un compte exact ou échantillonné.

## Écran B — panneau SESSION (`f002.png`)

Panneau latéral qui couvre environ 70 % de la largeur, la liste reste visible à gauche.

- En-tête : badge « SESSION », titre « Synthetic browser session lasting 52s », rangée de tags
  (service:shopist-web-ui, version:4.5.22, browser, Android, env:prod, Chrome, United States),
  horodatage (May 22, 2:56:49 pm), boutons « ▶ Replay Session » (principal), « Export », fermer.
- Bandeau : « This event was generated by a Synthetic test run · test_id:nbq-m9r-hk5 · View
  Synthetic Test Result ↗ ».
- Quatre tuiles chiffrées : 7 Views Loaded · 10 Actions · 0 Errors · 0 Frustration Signals.
- Onglets : Session (actif), Replay, Errors, Attributes.
- Contrôles de la liste : icône camembert (répartition), « Search for events by name », filtre
  « Type : view, action, error ▾ », case « Background Events » cochée, bouton « Generate
  Synthetic Browser Test ».
- Tableau chronologique : RELATIVE TIME ↑ (secondes depuis le début), TYPE (View Load, Click,
  Custom — chacun avec une icône), SERVICES (shopist-web-ui), EVENT (phrase : « click on ADD TO
  CART on page /department/chairs/product/7 », « Custom user action Product Page View on
  page … »). Le survol d'une ligne View Load fait apparaître « Open View waterfall → » à droite.
- Pied : « Use ↑ / ↓ to view previous/next event » (navigation clavier entre événements).

Ce que l'écran garantit : l'ordre et l'instant relatif de chaque événement, et le lien
texte → page sur laquelle il s'est produit. Ce qu'il ne montre pas : les vitals, les ressources
et les erreurs restent derrière les onglets ou derrière l'ouverture d'une vue.

## Écran C — panneau VIEW, onglet Performance (`f003.png` à `f007.png`)

Deuxième panneau empilé sur le premier (le panneau SESSION reste visible dessous pendant la
transition de `f003.png`, puis est entièrement recouvert).

- En-tête : badge « VIEW », titre « Load Page /department/chairs », mêmes tags de contexte,
  puis trois attributs de vue : View Name:/department/chairs · View Loading Type:initial_load ·
  View Time Spent:10.31s. Boutons « ▶ Jump to Replay », « Export », fermer.
- Bandeau Synthetic (le même).
- « Parent Hierarchy : ● ▶ SESSION Synthetic browser session lasting 52s ⋮ » — le fil d'Ariane
  vers le parent, avec son propre bouton de lecture.
- Onglets, chacun avec son compte : Performance (actif), Replay, Errors, Resources 25,
  Traces 1, Feature Flags 3, Actions 1, Logs 4, Attributes. Le compte annonce ce qu'un onglet
  contient avant de l'ouvrir ; un onglet à 0 (Errors) n'affiche pas de compte.
- Section « Event Timings and Core Web Vitals · Learn more ↗ » :
  - deux tuiles cliquables : LARGEST CONTENTFUL PAINT ● 132.5 ms, CUMULATIVE LAYOUT SHIFT ● 0
    (point coloré = verdict) ;
  - une ligne secondaire : First Contentful Paint 132.5ms · Loading Time 235ms · ▾ Show More.
- Popover LCP (`f004.png`, `f005.png`) : définition en une phrase ; « 132.5ms this view » ;
  barre horizontale de seuils, verte jusqu'à 2,5 s, jaune jusqu'à 4 s, rouge au-delà, avec un
  repère à la position de la valeur ; « Performance for this view : ● 132.5ms is considered
  good performance » ; « Largest rendered element · Go to page ↗ » puis le sélecteur
  `#main > DIV.products > DIV:nth-of-type(1) > DIV > A > DIV.product-card > IMG` avec bouton de
  copie ; « Compared to p75 performance : ● 858.45ms p75 aggregation of similar views from past
  30 days ».
- Popover CLS (`f006.png`) : même structure, barre libellée GOOD | 0.1 NEEDS IMPROVEMENT |
  0.25 POOR ; « Most shifted element · Go to page ↗ » puis « No element available — This
  element may have been deleted or changed since the time at which this vital was captured ».
  La donnée absente est expliquée, pas masquée.
- « Expand Waterfall » puis filtres Network · Events · Timings et « Search for events by name ».
- Mini-diagramme à couloirs : quatre lignes Actions, Errors, Resources, Long tasks ; axe X de
  1,0 s à 10,0 s ; les marques sont toutes dans les 300 premières millisecondes.
- Tableau des ressources : NAME, SIZE, DURATION, puis une colonne Gantt (repère « LT », ticks
  5,0 s et 10,0 s). Lignes : chairs 3 KB 28 ms ; datadog-rum-v5.js — ; 3b08283.js — ;
  f2e9055.js — ; datadog-logs-v4.js — ; f54aa38.js —. Les tirets sont des durées non mesurées,
  affichées comme telles.
- Pied : « Displaying 26 out of 26 events · See full list of events ▾ · for this View in the RUM
  explorer » — sortie vers l'explorateur, avec la vue comme filtre.

Ce que l'écran garantit : une valeur, son verdict, l'élément qui l'explique quand il existe, et
un point de comparaison daté (30 jours, vues similaires). Ce qu'il ne garantit pas : « similar
views » n'est pas défini à l'écran (même route ? même type de chargement ?) — non établi.

## Écran D — panneau VIEW, onglet Traces (`f008.png` à `f011.png`)

- Ligne d'intro : « 1 trace associated with this view. » puis fil d'Ariane
  « shopist-web-ui › /products.json », et à droite « View Trace in APM ↗ · Hide Legend ».
- Flame graph : axe X en millisecondes (0 à 120 ms) ; un curseur vertical suit la souris et
  affiche l'instant (70.2 ms, 81.5 ms, 90.6 ms, 92.6 ms). Barres empilées par profondeur,
  colorées par service : bleu = shopist-web-ui (navigateur), jaune = web-store (Ruby), violet =
  auth-dotnet (.NET). Racine « ! /products.json » 126 ms ; enfant « ! ProductsController#index »
  75,3 ms ; sous-spans (petits blocs jaunes, `{"op…`, « POST 19.1 ms » avec un bloc rouge en fin) ;
  sous-enfants « POST /c… », « POST /… » (violets) et une rangée de barres fines violettes (les
  requêtes SQL). Un « ! » marque les spans en erreur. Contrôles de zoom en bas à gauche.
- Légende (droite) : Service · % Exec Time : shopist-web-ui 70.1 %, web-store 25.3 %,
  auth-dotnet 4.55 %, avec mini-barres. Puis « Filter Spans : ☐ Errors ».
- Infobulle de survol : service · type d'opération · nom du span · durée · « [pNN] » (le rang
  percentile de cette durée pour ce span, p12, p53) · « (x % total duration) » ; pour le span
  Ruby, un bloc « CODE HOTSPOTS (EXECUTION TIME) · CPU Time 43.7 ms » ; « ⚠ Error detected »
  quand le span porte une erreur.
- Volet inférieur (détail du span survolé) : fil d'Ariane service › opération › nom, durée et
  « % total exec time », badge « pNN », onglets « Span : Info · Errors 3 · Infrastructure ·
  Metrics · Logs 4 · Network · Processes · SQL Queries 6 · Code Hotspots ». Contenu selon le span :
  - span navigateur (`f008.png`) : « Error Message · ⚠ Missing error message and stack trace » ;
  - span contrôleur (`f009.png`) : « Error Message · First seen 3 years ago in v. 8.4.3 ↗ »,
    encadré rouge ``undefined method `offer_timed_discount' for #<ProductsController:…>``,
    lien « View stack trace » ;
  - span HTTP .NET (`f010.png`) : « Span Tags ▾ » avec un arbre JSON (`api { … }`) ;
  - span SQL (`f011.png`) : la requête `SELECT * FROM Sessions where Token = ?` en bloc de code,
    puis Span Tags.

Ce que l'écran garantit : chaque span est situé dans le temps, rattaché à son service et à son
parent, et son détail s'ouvre sans quitter la vue. Ce qu'il ne garantit pas : le lien entre
« Errors 3 » et les erreurs visibles (une seule est lue dans la vidéo) — non établi.

## Ce que le parcours cherche à démontrer

1. « De la population à l'individu » : une requête sur 33,6 k sessions se réduit à une session
   en un clic, sans reformuler la question (`f001.png` → `f002.png`).
2. « De la session à la vue, de la vue au vital » : la hiérarchie session › vue › vital est
   rendue par des panneaux empilés et un fil d'Ariane (« Parent Hierarchy »), pas par des pages
   (`f002.png` → `f004.png`).
3. « Un chiffre ne vient jamais seul » : la valeur LCP est accompagnée de son verdict, de
   l'élément qui la produit, et d'une comparaison datée (`f004.png`). Quand l'élément manque,
   la raison est écrite (`f006.png`).
4. « De la douleur front à la ligne de code » : la vue renvoie à sa trace, la trace à
   l'exception Ruby avec son message, sa première apparition et sa version, puis à la requête
   SQL (`f008.png` → `f011.png`). C'est le cœur du « triage & resolve » du titre.
5. « Chaque compteur est une porte » : Resources 25, Traces 1, Logs 4, Errors 3, SQL Queries 6 —
   l'utilisateur sait combien il trouvera derrière chaque onglet avant de cliquer.

Ce que la vidéo ne démontre pas, malgré le titre : aucun geste de triage n'est fait (pas
d'assignation, pas de statut, pas d'issue ouverte), et Watchdog Insights reste replié. Le
« resolve » s'arrête à la lecture du message d'erreur.

## Motifs d'interaction et de drill-down à retenir

Chaque motif est rapporté à ce que le dépôt fait déjà, d'après le code lu.

1. **Panneaux latéraux empilés plutôt que pages.** La liste reste visible sous le panneau ; un
   deuxième panneau recouvre le premier ; « Parent Hierarchy » permet de remonter.
   Dépôt : la session est une page (`apps/console/app/sessions/[id]/page.tsx:L19-L156`) avec
   un lien retour « ← Sessions » qui conserve les filtres (L70-L73) ; le détail de trace est une
   autre page (`apps/console/app/tracing/[traceId]/page.tsx:L49-L229`). Pas de panneau empilé.

2. **La chronologie d'une session comme colonne vertébrale, avec le temps relatif.** Chaque
   événement a un instant depuis le début (0 s, 8.75 s, …), un type, une phrase lisible.
   Dépôt : la timeline fusionnée existe et couvre davantage de types que celle de la vidéo
   (`sessionTimeline`, `apps/console/lib/queries.ts:L441-L566` : pageview, vital, action, error,
   breadcrumb, resource, longtask, event, api avec la durée serveur en jointure latérale
   L493-L500). Le rendu par type est dans `apps/console/components/sessions/Timeline.tsx:L40-L135`
   ; `fmtOffset` (L8-L12) donne le temps relatif. Ce que je n'ai pas établi : si une ligne « api »
   renvoie vers `/tracing/[traceId]` (le corps de ligne lu, L119-L134, n'a pas de lien).

3. **Un compte sur chaque onglet.** Resources 25, Traces 1, Logs 4, Errors 3.
   Dépôt : la page session calcule `counts` par type de la timeline (`page.tsx:L64-L67`) ;
   l'usage visuel de ces comptes n'est pas établi (les onglets lus sont `timeline | replay`,
   L52-L61).

4. **La tuile de vital qui s'ouvre sur son explication** : seuils dessinés, verdict en une
   phrase, élément responsable copiable, comparaison à un p75 daté.
   Dépôt : le SDK envoie l'attribution web-vitals réduite à ses champs primitifs
   (`packages/rum-sdk/src/vitals.ts:L31-L39`, émise L41-L64) ; le barème 2026 est appliqué au
   SDK (L25-L28) et à l'ingestion (`apps/ingest/supabase/functions/_shared/otlp.mjs:L310-L314`).
   La console lit l'attribution pour l'INP seulement (`interactionTarget`,
   `apps/console/lib/queries-frustration.ts:L57`) ; l'élément LCP n'est lu nulle part dans
   `apps/console/lib` (recherche `attribution` : 13 occurrences, aucune sur `element`). La
   comparaison existe au niveau agrégé, période précédente (`vitalsP75(f, shift)`,
   `apps/console/lib/queries.ts:L46-L66`), pas « cette vue contre le p75 30 jours des vues
   similaires ». `apps/console/lib/specs.ts:L237` annonce l'attribution LCP comme intention.

5. **La donnée manquante est écrite, pas masquée.** « No element available — deleted or
   changed since… », tirets dans la colonne DURATION, « Missing error message and stack trace ».
   Dépôt : même ligne de conduite dans les textes lus (« Aucun chiffre n'est affiché : une
   série de zéros se lirait comme une absence de trafic », `apps/console/app/explorer/page.tsx:
   L124-L126` ; « Span parent introuvable dans cette trace », `tracing/[traceId]/page.tsx:L167`).

6. **Flame graph avec curseur temporel, légende par service et volet de détail au survol.**
   Le survol suffit : pas besoin de cliquer pour lire le message d'erreur ou la requête SQL.
   Dépôt : un waterfall existe, barres positionnées au début réel, profondeur par chaîne parent
   → enfant, couleur par tier (`tracing/[traceId]/page.tsx:L171-L222`, légende L223-L225), mise
   en évidence d'un span par `?span=` (L88-L91). Le détail d'un span se limite à un attribut
   `title` (L207) : pas de volet, pas de % du total, pas de rang percentile, pas de légende par
   service. Les spans serveur portent les exceptions en événements
   (`packages/agent-node/src/core.ts:L241-L285`) et les spans DB ont un libellé paramétré sans
   données (`apps/console/lib/server-trace-core.ts:L52`, lignes L113-L156).

7. **Le rang percentile sur une durée de span (« p12 », « p53 »).** Une durée seule ne dit pas
   si elle est normale ; le rang le dit.
   Dépôt : non établi (aucun calcul de rang par span lu).

8. **Une requête, plusieurs rendus (« Visualize as »).** Neuf formes pour la même requête.
   Dépôt : l'explorateur porte une mesure, une visualisation et une limite par visualisation
   (`apps/console/app/explorer/page.tsx:L79-L313`, `LIMITES[vizCourante]` L142-L144), et des vues
   enregistrées (`apps/console/lib/queries-saved-views.ts:L51-L54`). Le nombre de formes n'est
   pas établi ici.

9. **Facettes avec comptes dans la population courante** (Desktop 16.1k, Mobile 9.95k…).
   Dépôt : `EventExplorerResult.facets` existe pour les événements custom
   (`apps/console/lib/queries-events.ts:L65-L77`) ; pour les sessions, la liste est paginée par
   curseur et filtrée par un champ de recherche (`listSessions`,
   `apps/console/lib/queries.ts:L363-L389`), sans facettes comptées — non établi au-delà.

10. **Le replay comme sortie disponible partout** : « Replay Session » sur la session, « Jump to
    Replay » sur la vue, icône lecture sur chaque ligne de liste.
    Dépôt : le lecteur accepte un instant `atMs`
    (`apps/console/components/replay/ReplayPlayer.tsx:L30-L185`), et la page session le
    positionne depuis `?at=` (`sessions/[id]/page.tsx:L44`, repris dans le lien d'onglet L52-L61).
    L'enregistrement est masqué par défaut, borné à
    2 min et 1 Mo gzip (`packages/rum-sdk/src/replay.ts:L197-L280`).

11. **Insights automatiques en tête de liste** (« 2 Watchdog Insights »), repliés.
    Dépôt : anomalies z-score sur p75 contre moyenne 7 jours (`AnomalyRow`,
    `apps/console/lib/health.ts:L114-L121`) et sur les logs (`LogAnomalyRow`,
    `apps/console/lib/queries-logs.ts:L81-L87`), prévision (`apps/console/lib/forecast.ts:L38-L40`),
    événements d'alerte (`apps/console/lib/queries-v2.ts:L230-L252`). Leur présence en tête d'une
    liste filtrée n'est pas établie.

12. **Frustration comptée par session** (colonne FRUSTRATION COUNT, tuile « 0 Frustration
    Signals »).
    Dépôt : rage / dead / error clicks détectés au SDK (`packages/rum-sdk/src/frustration.ts:
    L120-L223`) et agrégés par route et cible sur la page `/ux`
    (`apps/console/app/ux/page.tsx:L14-L208`) ; un compte par session dans la liste n'est pas
    établi.

## Ce qui serait à éviter

1. **Faire la démonstration sur une session synthétique.** La session ouverte est un test
   automatisé (bandeau, SESSION TYPE = synthetics, 0 erreur, 0 frustration). Elle ne montre ni
   un vrai visiteur ni une vraie douleur. Le dépôt distingue déjà la source de collecte
   (`Meta label="Source"`, `sessions/[id]/page.tsx:L92-L96`) et compare robot et réel
   (`apps/console/components/features/RobotVsRealChart.tsx:L25-L65`) : garder cette séparation
   visible plutôt que de mélanger les deux populations dans une même liste sans le dire.

2. **Un « 0 Errors » sur la session alors que la trace rattachée porte 3 erreurs.** Les tuiles
   de `f002.png` disent 0 erreur ; l'onglet Traces de `f008.png` dit « Errors 3 » et « Error
   detected » sur le span navigateur. Ce sont deux populations (erreurs RUM et erreurs APM), et
   l'écran ne le dit pas. À éviter : afficher un compteur d'erreurs de session sans préciser sa
   portée quand un backend corrélé existe.

3. **Un span navigateur en erreur sans message ni stack** (`f008.png`). Marquer un span « ! »
   sans pouvoir dire pourquoi oblige l'utilisateur à descendre d'un cran pour comprendre. Si le
   front ne sait pas, le dire au niveau du span (« erreur portée par un span enfant ») plutôt que
   « Missing error message ».

4. **Une comparaison dont la population n'est pas définie.** « similar views from past 30 days »
   n'explique pas « similar ». Le dépôt a l'habitude d'écrire le périmètre d'un chiffre
   (`sub=` des `PageHeader`, mentions de sampling) : conserver cette habitude pour toute
   comparaison.

5. **Des durées non mesurées rendues par un tiret sans explication** (colonne DURATION de
   `f007.png`). Le tiret est honnête mais muet ; une infobulle « durée non exposée par le
   navigateur (Timing-Allow-Origin) » dirait pourquoi. Le dépôt a fait le choix inverse ailleurs
   (« tâche longue (sans attribution) », `apps/console/lib/queries-longtasks.ts:L89`).

6. **Neuf visualisations à un clic sans garde-fou.** « Visualize as » propose Pie Chart et
   Tree Map sur une mesure temporelle ; rien à l'écran ne dit quelles formes conviennent à quelle
   mesure. Le dépôt lie déjà la limite à la représentation (`explorer/page.tsx:L140`) et
   refuse une dimension non applicable avec sa raison (L127-L128) : ne pas relâcher cela pour
   ressembler à la barre de Datadog.

7. **Un bandeau d'insights replié qu'on n'ouvre jamais.** Dans la vidéo, « 2 Watchdog Insights »
   est un badge, pas une information. Un insight qui n'est pas lu dans le parcours n'a pas
   prouvé son utilité ; s'il en existe chez nous, il doit dire en une ligne ce qu'il a trouvé,
   pas seulement combien.

8. **Le survol comme seul moyen d'accès au détail d'un span.** Pratique à la souris, inaccessible
   au clavier et sur écran tactile. Le pied de page de Datadog prévoit ↑/↓ pour la liste
   d'événements (`f002.png`) mais rien n'est visible pour le flame graph — non établi.

## Non établi

- Le contenu des deux « Watchdog Insights ».
- La définition de « similar views » dans la comparaison p75.
- Le contenu des onglets Replay, Errors, Attributes (session) et Resources, Feature Flags,
  Actions, Logs, Attributes (vue) : jamais ouverts.
- Le lien entre « Errors 3 » du volet span et les trois erreurs elles-mêmes (une seule lue).
- Ce que « Export » exporte.
- Si la ligne « api » de notre timeline renvoie vers le détail de trace (`TimelineRow`,
  `apps/console/components/sessions/Timeline.tsx:L14-L38`, non lu).
- Si notre liste de sessions affiche des colonnes équivalentes à VIEW COUNT / ACTION COUNT /
  FRUSTRATION COUNT / INITIAL & LAST VIEW (`listSessions` renvoie `routes` et `err_count`,
  `apps/console/lib/queries.ts:L373-L385` ; le tableau de `sessions/page.tsx` n'a pas été lu
  au-delà de L48-L130).
