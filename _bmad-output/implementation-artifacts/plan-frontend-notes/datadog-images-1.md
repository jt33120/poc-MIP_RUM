# Lecture Datadog RUM — lot 1 : trois captures d'écran

Analyse produit des trois images du dossier `scratchpad/datadog/img/` :

| # | Fichier | Écran Datadog |
|---|---------|---------------|
| 1 | `newrumperformanceimage.png` | Dashboard « RUM - Performance Overview » |
| 2 | `newerrortrackingimage.png` | Error Tracking, liste d'issues + panneau latéral d'une issue |
| 3 | `datadog-rum-views-explorer.png` | RUM Explorer (événements `view`) + panneau latéral d'un événement |

Conventions de ce document :

- Chaque libellé entre guillemets « » est lu tel quel sur l'image. Les valeurs chiffrées sont celles affichées ; elles sont
  des données de démonstration Datadog, pas des références de performance.
- Ce qui n'est pas lisible ou vérifiable est marqué **non établi**. Une interprétation qui n'est pas confirmée par une source
  est marquée *(interprétation)*.
- Sources externes utilisées : la doc Datadog « Monitoring page performance »
  (<https://docs.datadoghq.com/real_user_monitoring/browser/monitoring_page_performance/>), la page web.dev sur INP
  (<https://web.dev/articles/inp>), et la page marketing donnée par l'utilisateur
  (<https://www.datadoghq.com/dg/real-user-monitoring/overview/>). Les noms de fichiers `new*image.png` suggèrent que les
  images 1 et 2 proviennent de cette page marketing ; ce point est **non établi**.
- Sources dépôt : `README.md:24` (Core Web Vitals, « seuils 2026 ») ; `packages/rum-sdk/src/vitals.ts:18-20`
  (seuils `LCP: [2500, 4000]`, `INP: [200, 500]`, `CLS: [0.1, 0.25]`) ; inventaire des pages `apps/console/app/**/page.tsx`
  (chemins listés en annexe, contenu non examiné ici).

---

## 1. `newrumperformanceimage.png` — Dashboard « RUM - Performance Overview »

### 1.1 Quel écran

Un dashboard Datadog pré-construit (bouton « Clone Dashboard » : c'est un modèle fourni, que l'utilisateur copie avant de
le modifier). Il agrège les métriques RUM de performance sur toutes les applications, sans découpage par défaut.
Fenêtre de temps « 1d — Past 1 Day ».

### 1.2 Grille de mise en page

Trois bandes horizontales au-dessus du contenu :

1. **Barre de titre** : étoile (favori), icône dashboard, titre « RUM - Performance Overview » avec chevron (menu du
   dashboard), « Clone Dashboard ». À droite : sélecteur de temps « 1d / Past 1 Day », trois boutons de lecture
   (reculer, pause — actif, en bleu —, avancer), loupe « zoom out ».
2. **Barre de variables** : champ « Search... », puis dix variables de template avec valeur « * » chacune :
   `$viewName`, `$country`, `$browser`, `$device`, `$service`, `$env`, `$version`, `$applicationId`, `$loadingType`,
   `$pathGroup`. À droite : icônes clavier, écran (mode plein écran/TV), engrenage.
3. **Corps** : deux *groupes de widgets* côte à côte, chacun avec un titre de groupe.
   - Gauche, ≈ 1/3 de la largeur : groupe « Overview » = 2 tuiles de valeur + 1 série temporelle + 1 toplist, empilés.
   - Droite, ≈ 2/3 : groupe « Core Web Vitals » = grille 2 × 2 : trois séries temporelles (LCP, FID, CLS) et une
     note explicative en bas à droite.

Hiérarchie visuelle : les deux grands chiffres « 346.71k » et « 2.99s » sont les éléments les plus lourds de la page ;
viennent ensuite les trois bandes colorées (vert / jaune / rouge) des graphes CWV, lisibles avant même les courbes.
Tout tient au-dessus du pli à ≈ 1300 × 700 px : le dashboard est conçu pour être lu sans défilement.

### 1.3 Widgets

#### Groupe « Overview »

**« Total page views » — 346.71k**
- Type : tuile de valeur (query value).
- Mesure : `count` des événements `view`, sur 1 jour, tous filtres = *.
- Ce que ça donne en un regard : le volume qui pondère tout le reste. Sans ce chiffre, un p75 n'est pas interprétable.
- Pertinence : bonne. Une tuile est le bon support pour une valeur unique. Ce qu'elle ne fournit pas : la tendance
  (aucune comparaison avec la veille, aucune sparkline).

**« P75 loading time » — 2.99s**
- Type : tuile de valeur.
- Mesure : percentile 75 de `view.loading_time` (métrique Datadog propre, « custom KPI for page readiness » selon la
  doc citée), sur 1 jour.
- Ce que ça donne : la latence « ressentie » globale.
- Pertinence : discutable en l'état. Aucune couleur, aucun seuil, aucune tendance : l'utilisateur ne sait pas si 2.99 s
  est bon ou mauvais alors que les trois graphes voisins, eux, ont des bandes. Une tuile de latence sans référence
  n'apporte qu'un chiffre.

**« Number of page views and loading time »**
- Type : série temporelle combinée bâtons + ligne, **double axe**.
- Mesures : bâtons bleu clair = « Page view count » (count par intervalle, intervalle **non établi**) sur l'axe droit
  0k–8k ; ligne violette = « p75 loading time » en secondes sur l'axe gauche 0–5.
- Axe x : « 18:00 », « Wed 24 », « 06:00 », « 12:00 ». Légende sous le graphe (deux carrés colorés + libellés).
- Ce que ça donne : la lecture « la latence suit-elle le trafic ? ». Ici, la ligne violette monte de ≈ 2.5 s à ≈ 3.5 s
  quand les bâtons grossissent après 06:00 : c'est une corrélation visuelle volume ↔ latence.
- Pertinence : l'intention est juste (mettre volume et latence sur le même temps), la réalisation est discutable. Un
  double axe force le lecteur à vérifier quelle échelle appartient à quelle série ; ici les couleurs sont proches
  (bleu clair / violet) et les deux échelles commencent à 0 sans que cela signifie quoi que ce soit. Deux panneaux
  empilés partageant l'axe x donnent la même information sans l'ambiguïté.

**« Initial page load vs SPA route changes »**
- Type : toplist (barres horizontales triées par valeur).
- Mesure : count des vues, découpée par `view.loading_type` : « 286.9k initial_load », « 27.4k route_change »,
  « 8.3k fragment_display ».
- Ce que ça donne : la part de navigations SPA dans le trafic. Ici ≈ 89 % de chargements initiaux : l'application
  démo est peu « SPA ». Cette proportion conditionne la lecture des Core Web Vitals (LCP n'a de sens que sur
  `initial_load`).
- Pertinence : bonne. Trois catégories, une dimension : la toplist est le bon graphe, un camembert aurait été pire.
  Ce qu'elle ne fournit pas : la latence par type de chargement, qui est pourtant la question suivante.

#### Groupe « Core Web Vitals »

Les trois graphes partagent la même construction, décrite une fois :

- Type : série temporelle, une seule ligne bleue, sur fond de **trois bandes horizontales** : vert (bon), jaune
  (« needs improvement »), rouge (« poor »). La bande rouge porte une étiquette de seuil en texte rouge.
- Agrégation : p75 (nom de métrique « p75 LCP », « p75 FID », « p75 CLS » dans la table), sur tous les tags (« Tags * »).
- Sous chaque graphe : une **table récapitulative** à cinq colonnes : « Tags », « Metric », « Avg », « Min », « Max »,
  « Value ». « Value » est vraisemblablement la dernière valeur de la fenêtre *(interprétation, non vérifiée dans la doc)*.

**« Largest Contentful Paint »**
- Axe y « Seconds » 0–5 ; bandes : rouge « > 4s » (4–5), jaune (2.5–4), vert (0–2.5).
- Table : Avg 1.66 s, Min 1.52 s, Max 1.79 s, Value 1.64 s.
- Lecture : ligne stable en zone verte. Le graphe dit « rien à faire sur le LCP global ».

**« First Input Delay »**
- Axe y « Milliseconds » 0–400 ; bandes : rouge « > 300ms », jaune (100–300), vert (0–100).
- Table : Avg 396 µs, Min 300 µs, Max 600 µs, Value 400 µs.
- Lecture : la ligne est collée au plancher (0.4 ms sur une échelle de 400 ms). Le graphe n'apporte rien d'autre que
  « vert ».

**« Cumulative Layout Shift »**
- Axe y 0–0.25 ; bandes : rouge « > 0.25 » (bande fine tout en haut), jaune (0.1–0.25), vert (0–0.1).
- Table : Avg 0.13, Min 0.019, Max 0.14, Value 0.13.
- Lecture : la ligne à ≈ 0.13 est dans la bande jaune, avec des pics *vers le bas* (des intervalles où le CLS chute à
  ≈ 0.02). C'est le seul des trois graphes qui montre un problème : le CLS global est « à améliorer ».

Pourquoi ce type de graphe est le bon : une métrique à seuils normatifs (Google publie les trois bornes) lue sur fond de
bandes donne l'état *et* la tendance sans lire un chiffre. La ligne unique p75 est cohérente avec la recommandation
« Datadog recommends monitoring the 75th percentile for these KPIs » (doc citée).

Ce que ce type ne garantit pas : la variance. L'échelle y est calée sur les seuils, pas sur les données ; une série qui
vit à 10 % de l'échelle (FID) est un trait plat. Et un p75 global masque les routes en souffrance (cf. `README.md`,
l'exemple `/login` à 4.04 s « poor » pendant que le robot mesure 1.14 s).

**Note « Core Web Vitals »** (bas droite)
- Type : widget note (texte + images).
- Contenu : trois pictogrammes « LCP — Largest Contentful Paint (Loading) », « FID — First Input Delay
  (Interactivity) », « CLS — Cumulative Layout Shift (Visual Stability) », chacun avec une réglette
  « GOOD / NEEDS IMPROVEMENT / POOR » et ses bornes : 2.5 sec / 4.0 sec ; 100 ms / 300 ms ; 0.1 / 0.25. Puis un
  paragraphe : « Core Web Vitals give you an overview of load performance, interactivity, and visual stability. Each
  metric comes with guidance on the range of values that translate to good user experience. Datadog recommends
  monitoring the 75th percentile for these metrics. Learn more ».
- Pertinence : utile pour un premier contact, coûteux ensuite : un quart du groupe « Core Web Vitals » est occupé par
  un texte que l'utilisateur ne lit qu'une fois.

### 1.4 Interactions visibles ou implicites

- **Variables de template** (dix, en tête) : toute sélection filtre tous les widgets. La valeur « * » signifie « tout ».
  Ce mécanisme garantit un contexte de filtre unique pour la page ; il ne garantit pas que chaque widget ait un sens
  une fois filtré (un p75 sur 3 vues n'est pas un p75).
- **Sélecteur de temps + lecture** (pause / reculer / avancer / zoom out) : le dashboard est un « lecteur » de temps.
- **Clone Dashboard** : le modèle est en lecture seule, la personnalisation passe par la copie.
- **Zoom par sélection** sur les graphes, **survol** avec valeur par série, **clic sur légende** pour isoler une
  série : conventions Datadog, non visibles sur l'image, **non établi** pour ce dashboard précis.
- **Drill-down** vers l'Explorer depuis un widget (menu contextuel « View in RUM Explorer ») : convention Datadog,
  **non établi** ici.
- Aucun lien visible depuis une tuile vers une liste « quelles pages sont en rouge ».

### 1.5 Motifs d'intelligence d'analyse

- **Bandes de seuils normatifs** derrière la série : le graphe porte lui-même le jugement bon / à améliorer / mauvais.
- **Table Avg / Min / Max / Value** sous chaque série : les quatre chiffres qu'une ligne ne donne pas (amplitude et
  dernier point).
- **Volume et latence sur le même temps** : première question de tout incident de performance (« c'est la charge ? »).
- **Découpage par type de chargement** (initial / route change / fragment) : distinction SPA qui conditionne
  l'interprétation des CWV.
- Absents : comparaison avec la période précédente, distribution (histogramme des LCP, pas seulement p75), tri par impact
  (aucune liste « top routes en poor »), annotation de déploiement sur l'axe du temps.

### 1.6 Ce que Datadog fait mal ou de façon discutable

1. **FID au lieu d'INP.** Google a remplacé FID par INP comme Core Web Vital ; web.dev présente INP comme « the
   successor metric to First Input Delay » avec les bornes 200 ms / 500 ms. La doc Datadog liste aujourd'hui INP parmi
   les Core Web Vitals (« Target value: <200ms », « Requires RUM SDK v5.1.0 ») et relègue FID en métrique
   additionnelle. Le dashboard capturé est donc antérieur à ce changement ; la date exacte de la capture est
   **non établi**. Le SDK MIP est déjà sur INP (`packages/rum-sdk/src/vitals.ts:19`).
2. **Échelle y calée sur les seuils, pas sur les données** : le graphe FID est un trait à 0.1 % de la hauteur ; celui
   du CLS écrase la bande rouge en une ligne. Il faut choisir l'échelle en fonction de `max(données, seuil poor) × marge`.
3. **Double axe** sur « Number of page views and loading time », avec deux couleurs proches.
4. **La tuile « P75 loading time » n'a pas de seuil** alors que ses voisines en ont ; incohérence dans la même page.
5. **La note explicative** occupe l'emplacement d'un quatrième graphe (INP, ou TTFB, ou une distribution).
6. **Dix variables de template sur une ligne**, toutes à « * » : dense, et les noms (`$loadingType`, `$pathGroup`)
   sont du vocabulaire interne Datadog.
7. **Rien n'est trié par impact** : le dashboard dit « globalement vert » et s'arrête là. Il n'oriente pas vers une
   action.
8. **Table récapitulative répétée trois fois** avec une colonne « Tags * » toujours identique : de la hauteur perdue.

---

## 2. `newerrortrackingimage.png` — Error Tracking, liste d'issues + panneau latéral

### 2.1 Quel écran

L'écran « Error Tracking » (titre en haut à gauche, source « Web and Mobile Apps »). Une *issue* est un regroupement
d'erreurs par empreinte (type + message + pile normalisée) ; l'écran liste les issues et ouvre l'une d'elles dans un
panneau latéral qui recouvre ≈ 70 % de la largeur : « Error: Error generating recommendation », service
« shopist-web-ui », badge « ISSUE », icône JS.

### 2.2 Grille de mise en page

De gauche à droite :

1. **Rail de navigation** Datadog (icônes, fond sombre, ≈ 40 px).
2. **Colonne de facettes** (≈ 200 px) : sélecteur « Web and Mobile Apps », lien « Muted », champ « Search facets »,
   compteur « Showing 181 of 181 », puis groupes repliables :
   - « CORE » : « Service » (avec icône filtre et pastille rouge = filtre actif), « Browser SDK Version », « Env »,
     « SDK Version », « Session Plan », « Source », « Variant », « Version ».
   - « APPLICATION » : « Application Id » déplié : « Shop.ist 6 », « Shop.ist iOS 2 », « Shop.ist Flutter 1 »
     (cases cochées + compte d'issues).
   - « BROWSER » : « Browser Name » déplié : « Chrome 4 ».
3. **Colonne liste** (visible sur ≈ 140 px, le reste sous le panneau) : barre de recherche « - Service:(2 terms) »
   (filtre négatif sur deux valeurs), lien « Hide Controls », « 9 is… » (probablement « 9 issues », **non établi**),
   en-tête « ISSUES », puis des cartes d'issue à bord gauche rouge.
4. **Panneau latéral** (le reste) : en-tête, actions, section « WHAT HAPPENED », barre de filtre locale, phrase
   d'impact, graphe, « Error Stack », et une colonne droite étroite « distribution of Views impacted ».

Au-dessus du pli : l'en-tête de l'issue, les versions impactées, la phrase d'impact et le graphe. La pile d'appels
commence juste au-dessus du pli ; les cadres de code sont sous le pli.

### 2.3 Widgets

**Cartes d'issue (liste)** — cinq visibles :
- « JS ReferenceError — profile is not defined — last seen 4 minutes ago — OPEN »
- « No Error Type — Tax&shipping cost ca… — last seen 1 minute ag… — OPEN »
- « JS TypeError — <an… — Converting circular st… — last seen 4 minutes ago — OPEN »
- « JS TypeError — pag… — cyclic object value — last seen 5 minutes a… — OPEN »
- « JS Error — pages/de… — Error generating reco… — last seen 2 minutes ago — OPEN »
- Type : liste de cartes, une par issue. Chaque carte : badge langage, type d'erreur (gras), fichier/route (tronqué),
  message, « last seen », statut en menu déroulant. Le bord gauche rouge signale **non établi** (statut « open » ou
  gravité).
- Ce que ça donne : la file de travail. Ce qu'elle ne montre pas dans la partie visible : le nombre d'occurrences et de
  sessions (les colonnes de droite sont cachées par le panneau) ; le tri courant est **non établi**.

**En-tête du panneau**
- « ISSUE » (badge rouge), « shopist-web-ui » (service), « JS », titre « Error: Error generating recommendation ».
  À droite : « Open Full Page » (icône externe), « × ».
- Ligne d'actions : statut « OPEN » (menu), « Mute Issue », « Actions » (menu).

**« WHAT HAPPENED »**
- Ligne 1 : « Couldn't load error pattern » en gris italique. C'est un **état d'erreur de l'interface** figé dans une
  capture marketing : la fonctionnalité « error pattern » (résumé automatique) n'a pas répondu.
- Ligne 2 : « The last version impacted was 32bec16 — 2 minutes ago (10:59) ».
- Ligne 3 : « The first version impacted was f1c84eb — 11 months ago (Nov 01, 14:30) ».
- Type : bloc de texte structuré à valeurs mises en lien.
- Ce que ça donne : l'âge de l'issue et son ancrage sur des versions de déploiement. « First impacted il y a 11 mois »
  signale une erreur chronique et non une régression du dernier déploiement.
- Pertinence : bonne ; c'est la donnée qui distingue « régression » de « dette ». Elle suppose que le SDK envoie
  `version` à chaque événement.

**Barre de filtre locale au panneau**
- Chip « - Service:(2 terms) » avec croix, bouton `</>` (bascule requête texte), sélecteur « 2w — Past 2 Weeks »,
  bouton rafraîchir. Le panneau a **sa propre fenêtre de temps** (2 semaines), distincte de celle de la liste.

**Phrase d'impact**
- « There were **13.4k errors** over the past **14 days** affecting **13.1k sessions** » — les chiffres sont des liens.
- Type : phrase en langage courant avec valeurs en lien.
- Ce que ça donne : l'impact en sessions, pas seulement en occurrences. 13.4k erreurs pour 13.1k sessions = ≈ 1 erreur
  par session : l'erreur se produit une fois par session, elle est donc probablement déclenchée par une action précise
  et non par une boucle *(interprétation)*. La phrase ne dit pas quelle proportion du trafic cela représente
  (13.1k sessions sur combien ?) : l'impact relatif est **non établi**.

**Graphe « errors over time »** (sans titre propre)
- Type : bâtons rouges, un par intervalle (intervalle **non établi**, ≈ 4 h vu la densité sur 14 jours).
- Axe y « 0k – 1.5k », axe x « Wed 31, September, Sat 3, Mon 5, Wed 7, Fri 9, Sep 11, Tue 13 ». Une ligne verticale
  pointillée à droite (maintenant).
- Ce que ça donne : une forme temporelle : pic à ≈ 1.5k autour du 1er septembre, puis plancher à ≈ 100–200 avec de
  petites bosses quotidiennes. L'issue a eu un épisode aigu puis est redevenue chronique.
- Pertinence : bonne pour un comptage d'événements discrets ; les bâtons disent « zéro » là où une ligne interpolerait.
  Ce qu'il ne fournit pas : la normalisation par le trafic (le pic est-il une hausse d'erreurs ou une hausse de
  sessions ?) et l'annotation des déploiements « 32bec16 » et « f1c84eb » mentionnés trois lignes plus haut : la
  donnée existe mais n'est pas dessinée.
- Sous le graphe : « Latest error » et lien « See all errors ».

**« Error Stack »**
- Sous-titre : « Here is the latest stack trace within your filters and selected time period. »
- Ligne : badge « ERROR », « Sep 13 10:59:33.058 (2 minutes ago) », boutons « ▶ Jump to Replay » et « View in RUM ».
- Onglets « Parsed » / « Raw » ; bascule « Unminified » / « Minified » ; icônes copier et agrandir.
- Première ligne de pile sur fond rose : « ⚠ Error: Error generating recommendation », puis un cadre tronqué
  « at … /department/… product.vue… » avec bouton « View » et un compteur.
- Type : visionneuse de pile d'appels, avec dé-minification (source maps).
- Ce que ça donne : le fichier et la ligne d'origine ; le lien vers la session (replay) qui a produit cette occurrence.
- Pertinence : bonne. « Unminified » actif par défaut suppose que les source maps sont chargées ; ce que ce widget ne
  garantit pas : que la *dernière* occurrence soit représentative (c'est la dernière, pas la plus fréquente).

**Colonne droite « distribution of Views impacted »**
- Texte : « Here is the distribution of Views impacted by this issue for each tag. See all tags ».
- Onglets « Outliers » (actif) / « Distribution ».
- « VIEW NAME » : « /department/bedding/product/? — 2.57% of Views », « /department/sofas/product/? — 1.95% of
  Views », « /department/chairs/product/? — 1.65% of Views », « 1 more hidden ». Chaque ligne a une barre fine.
- « BROWSER NAME » : « Chrome Mobile — 3.30% of Views ».
- Type : mini-toplists par facette, avec barre proportionnelle.
- Ce que ça donne : sur quelles pages et quels navigateurs l'issue frappe. Les trois routes sont des pages produit :
  l'erreur « generating recommendation » est liée au bloc de recommandations produit *(interprétation)*.
- « Outliers » : d'après le libellé, les valeurs de tag **sur-représentées** parmi les vues touchées par rapport à
  l'ensemble des vues, par opposition à « Distribution » qui liste la répartition brute. Le mode de calcul est
  **non établi**. Le sens de « 2.57% of Views » est ambigu : part des vues de cette route qui sont touchées, ou part des
  vues touchées qui sont sur cette route ? **Non établi.**
- Pertinence : l'idée est forte (voir § 4), la présentation est faible : pas de valeur de référence, pas de ratio, pas
  de compte absolu.

**Pied de panneau** : « Use ↑ / ↓ to view previous/next issue ».

### 2.4 Interactions visibles ou implicites

- **Facettes** à cases à cocher avec compte ; **filtre négatif** « - Service:(2 terms) » ; « Hide Controls » replie
  la colonne de facettes.
- **Panneau latéral** ouvert sur clic d'une carte ; **navigation clavier** ↑/↓ entre issues sans fermer le panneau ;
  « Open Full Page » pour l'URL partageable.
- **Cycle de vie de l'issue** : statut (menu « OPEN »), « Mute Issue », « Actions » (contenu du menu **non établi** :
  assigner, créer un ticket, sont des conventions Datadog).
- **Fenêtre de temps propre au panneau** (« Past 2 Weeks ») et filtre local éditable, avec bascule vers la syntaxe
  texte (`</>`).
- **Pivots** : chiffres de la phrase d'impact en lien (vers la liste d'erreurs ou de sessions), « See all errors »,
  « Jump to Replay » (Session Replay), « View in RUM » (Explorer filtré sur cette erreur), « See all tags ».
- **Bascule** « Parsed / Raw » et « Unminified / Minified » sur la pile.
- **Onglets** « Outliers / Distribution » sur la colonne de tags.

### 2.5 Motifs d'intelligence d'analyse

- **Regroupement en issues** (empreinte) + **first seen / last seen** + **première et dernière version impactées** :
  c'est l'ossature de la détection de régression. Ce qu'elle garantit : dater l'apparition. Ce qu'elle ne garantit
  pas : attribuer la cause à un déploiement (corrélation temporelle, pas causalité).
- **Impact en sessions**, pas en occurrences ; phrase lisible avec valeurs cliquables.
- **Forme temporelle** (pic vs plancher) sur 14 jours, indépendante de la fenêtre de la liste.
- **« Outliers »** : quelles dimensions sont anormalement représentées chez les victimes. C'est une analyse de
  contraste (touchés vs ensemble) : la seule vraie « intelligence » de l'écran.
- **Chaînage erreur → session → replay → explorer** en un clic chacun.
- **Résumé automatique** (« error pattern ») : prévu, mais en échec sur la capture.
- Absents : normalisation par trafic, annotation des déploiements sur le graphe, tri d'issues par impact visible (caché
  par le panneau), lien vers la page ou le composant applicatif fautif.

### 2.6 Ce que Datadog fait mal ou de façon discutable

1. **« Couldn't load error pattern »** dans une capture marketing : une fonctionnalité d'analyse qui échoue sans
   message d'action.
2. **Le panneau recouvre la liste** : la colonne des issues perd ses colonnes de droite (compte, sessions, tendance) ;
   la navigation ↑/↓ compense mais on ne voit plus « où on en est » dans la file.
3. **Pourcentages « of Views » sans définition** ni valeur de référence : « 2.57% » n'est pas interprétable seul.
4. **Graphe sans normalisation** ni annotations de version, alors que les versions sont affichées au-dessus.
5. **Jargon de facturation dans les facettes** (« Session Plan »), doublon « Browser SDK Version » / « SDK Version »,
   facettes de version en tête alors qu'elles servent rarement.
6. **Filtre « - Service:(2 terms) »** : un filtre négatif replié dont on ne voit pas les valeurs.
7. **« No Error Type »** comme type d'issue : un défaut de qualité de donnée exposé tel quel dans la file de travail.
8. **Deux fenêtres de temps** sur le même écran (liste et panneau) sans rappel visuel de la différence.
9. **Densité** : trois colonnes + un panneau à trois zones + un rail, sur ≈ 1300 px ; les titres tronqués
   (« Tax&shipping cost ca… », « 9 is… ») sont fréquents.

---

## 3. `datadog-rum-views-explorer.png` — RUM Explorer (vues) + panneau d'événement

### 3.1 Quel écran

Le « RUM Explorer » (titre en haut à gauche) en mode liste, sur des événements de type `view`, avec un événement ouvert
dans un panneau latéral : « VIEW — Dec 03, 2019 at 08:17:03.672 (a few seconds ago) ». La date (2019) indique une capture
ancienne ; l'Explorer actuel diffère dans le détail (**non établi** ici, hors sujet pour l'analyse des motifs).

### 3.2 Grille de mise en page

1. **Rail de navigation** sombre (≈ 55 px, logo Datadog en haut).
2. **Colonne de facettes** (≈ 290 px) : champ « Search facets », groupe « CORE » > « Application Id » : « Datadog demo
   350 » ; groupe « VIEW » > « Path Group » avec champ « Filter values » et huit valeurs cochées avec compte : « / 223 »,
   « /department/sofas/produ… 165 », « /department/sofas 164 », « /cart 157 », « /checkout 101 »,
   « /department/bedding/pr… 80 », « /department/chairs/prod… 80 », « /department/chairs 79 ».
3. **Zone principale** : en tête, trois boutons de mode (liste — actif, bleu —, courbe, loupe) puis un histogramme de
   volume (y 0–20, x « 08:03 », « 08:04 », « 08:05 », « 08:06 »), puis « Hide Controls », compteur « 1,478 » (tronqué),
   puis la table : colonnes « DATE ↓ » (tri actif, décroissant) et « PA… » (« PATH », tronqué) ; treize lignes visibles
   de « Dec 03 08:17:03.672 » (sélectionnée, marqueur bleu à gauche) à « Dec 03 08:16:47.893 », chemins tronqués à
   trois caractères (« /in… », « /ap… », « /da… », « /no… »).
4. **Panneau latéral** (≈ 60 % de la largeur) : bandeau d'en-tête, ligne d'attributs clés, tags, onglets, contenu de
   l'onglet « Attributes ».

Au-dessus du pli : tout ; la table et le panneau défilent chacun de leur côté.

### 3.3 Widgets

**Histogramme de volume** (au-dessus de la table)
- Type : bâtons bleus, un par intervalle (≈ 5 s vu ≈ 12 bâtons par minute, **non établi**).
- Mesure : count d'événements `view` du résultat courant. Axe y 0–20, sans libellé ; axe x horodaté.
- Ce que ça donne : la densité temporelle du résultat filtré. Un creux à 08:04:30 est visible.
- Pertinence : bonne comme « carte » du résultat ; l'absence de libellé d'axe et de survol visible limite sa lecture.
  Il ne garantit rien sur la latence : c'est un volume.

**Facettes avec comptes**
- Type : listes de cases à cocher, valeur + compte, triées par compte décroissant, avec filtre textuel par facette.
- Ce que ça donne : la distribution du résultat courant sur chaque dimension : c'est déjà un graphe (une toplist).
  « Path Group » montre que la page d'accueil et les pages produit dominent.
- Pertinence : bonne. Ce que ça ne garantit pas : que les comptes soient ceux de la fenêtre affichée par
  l'histogramme (fenêtre de temps **non établi** sur l'image).

**Table des événements**
- Type : table triable, une ligne par vue, colonnes configurables (voir menu « Add column » plus bas).
- Colonnes visibles : « DATE » (tri ↓), « PATH » ; les autres sont cachées par le panneau.
- Sélection : marqueur bleu à gauche de la ligne ouverte.

**Panneau latéral — en-tête**
- Badge « VIEW » ; « Dec 03, 2019 at 08:17:03.672 (a few seconds ago) » (date absolue + relative).
- Ligne d'attributs clés, en capitales grises + valeur : « COUNTRY Australia », « DEVICE CATEGORY Desktop »,
  « OS FAMILY 🐧 Linux », « BROWSER FAMILY ● Chrome », « PATH /infrastructure/map ».
- « TAGS » : chips « source:browser », « version:1.1.0 ».
- Pertinence : bonne. Cinq attributs choisis pour répondre à « qui, sur quoi, où » avant tout défilement.

**Panneau latéral — onglets**
- « Resources », « Traces », « Errors (0) », « User Actions (0) », « Long Tasks (0) », « Logs », « Attributes » (actif).
- Type : onglets avec **compte dans le libellé** pour les enfants dénombrables.
- Ce que ça donne : la vue est un *conteneur* : ses ressources, ses traces APM (corrélation front ↔ back), ses erreurs,
  ses actions, ses long tasks, ses logs. Les « (0) » disent avant le clic qu'il n'y a rien à voir.
- Pertinence : bonne. Ce que les onglets ne garantissent pas : que « Traces » et « Logs » soient alimentés (cela dépend
  de la propagation d'en-têtes vers l'APM et du produit Logs).

**Onglet « Attributes »**
- Type : arbre JSON repliable, clé / valeur, valeurs typées en couleur (chaîne, nombre vert).
- Contenu : « application_id a7caf4b4-d55a-4cae-8beb-a30cd2b63d03 », « duration 75000 » (unité **non établi** ;
  Datadog stocke les durées en nanosecondes, ce qui donnerait 75 µs, valeur peu plausible pour une vue —
  *interprétation*), « evt { category view } », « http {…} », « network {…} », « rum { document_version 1 } »,
  « screen {…} », « session_id 386b26f0-3d53-4474-89f4-7c8a68f6dc9c ».
- Menu contextuel ouvert sur `session_id` : « 🔍 Search for @session_id:386b26f0-…dc9c », « ⊘ Exclude
  @session_id:386b26f0-…dc9c », « ||| Add column for @session_id ».
- Ce que ça donne : la donnée brute, et surtout **le pivot depuis n'importe quelle valeur** : chercher, exclure, ajouter
  en colonne.
- Pertinence : l'arbre brut est le bon support pour l'exhaustivité ; il est le mauvais support pour la lecture
  courante (UUID, sections repliées « {…} » sans aperçu, unités absentes).

### 3.4 Interactions visibles ou implicites

- **Trois modes** sur le même résultat : liste, série temporelle (icône courbe), recherche.
- **Facettes** cochables, filtrables par texte, comptées.
- **Tri** par colonne (« DATE ↓ »), **ajout de colonne** depuis n'importe quel attribut.
- **Pivot contextuel** « Search for / Exclude / Add column » sur chaque valeur d'attribut : le résultat se construit par
  clics, sans écrire de requête.
- **Panneau** avec onglets enfants ; chaque onglet est vraisemblablement une liste cliquable vers l'événement enfant
  (**non établi**).
- **Navigation vers la session** : depuis `session_id` (pivot) ; un lien direct « View session » est **non établi** sur
  cette version.
- « Hide Controls » replie les facettes.

### 3.5 Motifs d'intelligence d'analyse

- **Le résultat filtré est toujours accompagné de sa distribution** (histogramme + comptes de facettes) : un filtre
  n'est jamais une liste aveugle.
- **Comptes dans les libellés d'onglets** : l'information avant le clic.
- **Tout attribut est un pivot** : chercher, exclure, colonne.
- **La vue comme hub de corrélation** : ressources, traces, erreurs, actions, long tasks, logs rattachés à une seule
  vue : c'est le modèle « événement parent / événements enfants ».
- Absents : aucun jugement (pas de bandes, pas de seuil sur `duration`), aucune comparaison de cette vue à la médiane de
  sa route, aucune mise en avant de « ce qui est anormal dans cet événement ».

### 3.6 Ce que Datadog fait mal ou de façon discutable

1. **Le panneau masque la table** au point de ne laisser que deux colonnes tronquées (« PA… », « /in… ») : la liste ne
   sert plus qu'à cliquer la ligne suivante.
2. **Attributs bruts en premier plan** : UUID d'application, `duration 75000` sans unité, sections repliées sans aperçu.
3. **Histogramme sans libellé d'axe ni unité**, et sans lien visuel avec la fenêtre de temps active.
4. **Toutes les facettes cochées par défaut** (huit coches) : du bruit visuel qui n'exprime aucun filtre.
5. **Troncature** systématique des chemins (« /department/sofas/produ… ») dans une facette qui sert précisément à les
   distinguer.
6. **Onglet « Attributes » actif par défaut** sur une capture qui veut montrer la corrélation : le contenu utile
   (Resources, Traces) est derrière un clic.
7. **Aucun jugement** : l'Explorer ne dit pas si `/infrastructure/map` à 75000 (unité inconnue) est lent pour cette
   route.

---

## 4. Synthèse transversale — les dix idées de conception à retenir, classées

Classement par valeur d'analyse rapportée au coût d'implémentation, en gardant en tête ce que chaque idée garantit et ce
qu'elle ne garantit pas. Les références à la console MIP renvoient à des chemins existants dont le contenu n'a pas été
examiné ici.

1. **Bandes de seuils normatifs derrière la série p75 de chaque Web Vital** (image 1). Le graphe porte le jugement
   bon / à améliorer / mauvais ; la lecture est immédiate. À faire mieux que Datadog : INP au lieu de FID (seuils déjà
   dans `packages/rum-sdk/src/vitals.ts:18-20`), échelle y = `max(données × 1.2, seuil poor × 1.1)` pour que ni la
   variance ni la bande rouge ne disparaissent, et un p75 **par route** à côté du p75 global (c'est l'identité MIP,
   cf. `README.md` : robot ok / utilisateurs en souffrance).
2. **Analyse de contraste « Outliers »** (image 2) : quelles valeurs de dimension (route, navigateur, pays, version)
   sont sur-représentées chez les sessions touchées par rapport à l'ensemble. À faire mieux : afficher le ratio
   (part chez les touchés / part dans la base) et les deux comptes, au lieu d'un pourcentage sans définition.
   Réutilisable pour les erreurs *et* pour les vues lentes (« qu'est-ce que les LCP poor ont en commun ? »).
3. **Issue = empreinte + first seen / last seen + première et dernière version impactées** (image 2). C'est ce qui
   sépare régression et dette. Ne garantit qu'une corrélation temporelle avec un déploiement. Le dépôt expose déjà
   `apps/console/app/api/v1/deploys/route.ts` et `apps/console/app/errors/issues/[id]/page.tsx`.
4. **Phrase d'impact en langage courant avec valeurs en lien** (« 13.4k errors … affecting 13.1k sessions »). À faire
   mieux : ajouter le dénominateur (« sur 210k sessions, 6.2 % ») : Datadog laisse l'impact relatif non établi.
5. **Tout attribut est un pivot** : chercher / exclure / ajouter en colonne depuis n'importe quelle valeur (image 3).
   Le résultat se construit par clics ; concerne `apps/console/app/explorer/page.tsx`.
6. **Événement parent → onglets d'enfants avec compte dans le libellé** (« Errors (0) », « Long Tasks (0) »).
   L'information est disponible avant le clic ; concerne `apps/console/app/sessions/[id]/page.tsx`.
7. **Le résultat filtré est toujours accompagné de sa distribution** : histogramme de volume au-dessus de la liste et
   comptes de facettes à gauche (images 2 et 3). Un filtre n'est jamais une liste aveugle.
8. **Volume et latence sur le même axe de temps** (image 1), mais en **deux panneaux empilés partageant l'axe x**, pas
   en double axe. Répondre à « c'est la charge ? » sans ambiguïté d'échelle.
9. **Un contexte de filtre unique pour toute la page** (variables de template) avec une fenêtre de temps
   « lecteur » (pause / reculer / avancer). À faire mieux : cinq variables au lieu de dix (application, route, version,
   appareil, pays) et des libellés en français lisibles, pas `$pathGroup`.
10. **Chaînage en un clic : erreur → occurrence → session → replay → explorer** (« Jump to Replay », « View in RUM »).
    La valeur vient de la continuité : aucune de ces vues n'est utile isolée. Les pages `errors/[fingerprint]`,
    `sessions/[id]`, `explorer` existent dans la console ; les liens entre elles sont **non établi**.

Idées secondaires à garder : la table Avg / Min / Max / dernier point sous une série (image 1, à compresser sur une
ligne) ; la toplist « initial_load / route_change / fragment_display » (à compléter par la latence par type) ; les
attributs clés en en-tête de panneau (« qui, sur quoi, où ») ; la navigation clavier ↑/↓ dans une file d'issues.

Ce qu'il faut éviter : le double axe ; FID ; l'échelle y calée uniquement sur les seuils ; la note pédagogique qui
occupe un emplacement de graphe (mettre l'explication sous un « ? ») ; un panneau latéral qui rend la liste inutilisable
(préférer 50 % de largeur ou un mode plein écran) ; les pourcentages sans définition ; le jargon interne dans les
facettes ; les UUID et durées sans unité en premier plan ; les états d'erreur silencieux (« Couldn't load error
pattern ») dans une zone d'analyse.

---

## 5. Points non établis (récapitulatif)

- Origine exacte des images (page marketing citée) et dates de capture.
- Intervalle des bâtons dans les trois histogrammes.
- Signification exacte de la colonne « Value » des tables récapitulatives (image 1).
- Contenu du menu « Actions » et tri courant de la liste d'issues (image 2).
- Mode de calcul de « Outliers » et définition de « x % of Views » (image 2).
- Signification du bord rouge des cartes d'issue (image 2).
- Unité de `duration 75000` et fenêtre de temps active de l'Explorer (image 3).
- Existence, sur ces versions, des drill-downs « widget → Explorer » et « attribut → session ».
- Contenu réel des pages de la console MIP citées en annexe.

## Annexe — pages de la console MIP concernées par les motifs ci-dessus

Chemins relevés par `find apps/console -name page.tsx` (contenu non examiné) :
`apps/console/app/page.tsx` (accueil), `apps/console/app/experience/page.tsx`, `apps/console/app/pages/page.tsx`,
`apps/console/app/errors/page.tsx`, `apps/console/app/errors/[fingerprint]/page.tsx`,
`apps/console/app/errors/issues/[id]/page.tsx`, `apps/console/app/explorer/page.tsx`,
`apps/console/app/sessions/page.tsx`, `apps/console/app/sessions/[id]/page.tsx`,
`apps/console/app/correlation/page.tsx`, `apps/console/app/dashboards/[id]/page.tsx`,
`apps/console/app/api/v1/deploys/route.ts`, `apps/console/app/api/v1/vitals/route.ts`.
