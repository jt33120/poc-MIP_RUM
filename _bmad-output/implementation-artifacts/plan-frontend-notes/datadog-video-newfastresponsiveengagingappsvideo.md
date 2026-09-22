# Lecture — vidéo Datadog RUM « newfastresponsiveengagingappsvideo »

Analyse image par image d'une démonstration Datadog RUM, avec ce que chaque écran garantit, ce qu'il ne garantit pas, et ce que le POC possède déjà en face.

## 0. Source, méthode, limites

- Vidéo source : `/Users/juliantalou/Downloads/datadog screenshots and videos /newfastresponsiveengagingappsvideo.mp4` — 14,14 s, 2390 × 1300 px (ffprobe, `duration=14.140000`, `width=2390`, `height=1300`).
- Images extraites : `/private/tmp/claude-501/-Users-juliantalou-Documents-PRO-01-CLIENTS-MIP-DEV-poc-MIP-RUM/69c961b4-4adf-49b9-a810-3af9b5d672e7/scratchpad/datadog/frames/newfastresponsiveengagingappsvideo/f001.png` … `f014.png`, une par seconde : `f001` ≈ t 0 s, `f014` ≈ t 13 s. Les 14 images ont été regardées dans l'ordre.
- Ce que cette lecture garantit : tout ce qui est décrit ci-dessous est visible sur au moins une image nommée. Ce qu'elle ne garantit pas : entre deux images, jusqu'à une seconde d'interaction est perdue (un clic peut ne pas apparaître, seule sa conséquence apparaît) ; il n'y a pas de bande-son ; rien n'est connu de ce qui précède `f001` ni de ce qui suit `f014`.
- Le site Datadog cité par la demande (`https://www.datadoghq.com/dg/real-user-monitoring/overview/…`) n'a pas été consulté pour ce document : ce qui n'est pas sur les images est marqué « non établi ».
- Le dépôt `/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM` a été lu via graft, sans modification. Les correspondances citent fichier + ligne.

## 1. Scénario reconstitué

Trois écrans s'enchaînent en 14 s. Le fil : un funnel de conversion agrégé → un panneau d'analyse de ce funnel → une session concrète rejouée, dont la timeline expose une erreur réseau au moment du paiement.

| Image | t | Écran | Ce qui se passe |
|---|---|---|---|
| `f001.png` | 0 s | A · Sessions › Analytics › Funnel | Funnel à 3 étapes affiché ; le curseur est sur la barre de la 3ᵉ étape (« click on CHECKOUT »). |
| `f002.png` | 1 s | A | Info-bulle de survol : « 719678 sessions (15% of original) @action.name:click on CHECKOUT ». |
| `f003.png` | 2 s | B · panneau latéral | Un clic (non visible) a ouvert un panneau depuis la droite ; les 3 tuiles KPI sont déjà rendues, les graphiques affichent « Loading… ». |
| `f004.png` | 3 s | B | Panneau chargé : 4 séries temporelles, « User Analysis », Top Users, Browser Repartition, table de sessions. Curseur sur la barre « homer@doe.com ». |
| `f005.png` | 4 s | B | Curseur sur le bouton ▶ de la première ligne de la table ; info-bulle « Replay Session » ; la barre d'état du navigateur montre une URL `…/rum/replay/sessions/f4a47411-…`. |
| `f006.png` | 5 s | C · Session Replay | Lecteur plein écran, à 00:19 / 01:40 ; page produit « Wicker Chair », curseur sur ADD TO CART ; à droite, la timeline surligne « 19.5 s Click on ADD TO CART ». |
| `f007.png` | 6 s | C | 00:20 ; le curseur rejoué survole l'onglet SOFAS ; la timeline surligne « 20.4 s Load Page /department/sofas ». |
| `f008.png` | 7 s | C | 00:20 ; page grisée avec un indicateur de chargement (navigation en cours dans le rejeu). |
| `f009.png` | 8 s | C | 00:21 ; grille de produits `/department/sofas` (neuf produits, un badge SOLD OUT). |
| `f010.png` | 9 s | C | 00:22 ; survol de la carte « Brown Leather Couch » (cadre de survol rejoué). |
| `f011.png` | 10 s | C | 00:23 ; la timeline surligne « 23.2 s Load Page /department/sofas/product/? » ; barre d'état `…/department/sofas/product/11`. |
| `f012.png` | 11 s | C | 00:23 ; page produit « Brown Leather Couch $1200 », panier passé à CART (2), curseur sur ADD TO CART. |
| `f013.png` | 12 s | C | 00:25 ; contour pointillé orange sur l'onglet BEDDING ; la timeline surligne « 25.7 s Load Page /department/bedding ». |
| `f014.png` | 13 s | C | 00:26 ; survol de BEDDING ; même état de timeline. La vidéo s'arrête là. |

Entre `f005` et `f006`, l'ouverture du replay se fait par un changement de page entier (l'URL `…/rum/replay/sessions/<id>` en barre d'état sur `f005.png`) : le panneau B n'est pas conservé derrière le lecteur.

## 2. Écrans traversés

### Écran A — Sessions › Analytics, visualisation « Funnel » (`f001.png`, `f002.png`)

Mise en page, en trois zones :

1. Barre haute : « RUM » · onglets Applications / **Sessions** / Dashboards ▾ ; à droite, sélecteur de plage « 2mo · Jul 10, 12:00 am – Sep 10, 11:32 am », flèches de défilement de plage, loupe, « Learn More ». Deuxième rangée : boutons « Search » et **« Analytics »** (actif), et à l'extrême droite une icône `</>` (export de requête, non établi).
2. Panneau de facettes à gauche (≈ 10 % de la largeur) : champ « Search facets » + « + Add » ; groupes repliables APPLICATION, CORE, BROWSER, GEO. Chaque facette liste ses valeurs avec une case cochée et un décompte : Application Id (Shop.ist 416M, Datadog App 38.7M, Shop.ist Android 3.45M, Shop.ist iOS 4.60M, deux identifiants bruts à 3.95k et 73) ; Type (resource 366M, long_task 32.6M, view 30.4M, action 22.9M, session 5.95M, error 4.52M, chacune avec une pastille de couleur) ; Service, Env, Variant, Version repliés ; Browser Name (Chrome 401M, Firefox 23.8M, Edge 11.6M, Chrome Mobile 8.14M, Edge Mobile 3.96M, Firefox Mobile 3.25M, HeadlessChrome 2.52M, Mobile Safari UI/WK… 39.2k) avec un champ « Filter values » ; Browser Main Version, Browser Version ; Country (United States 158M…).
3. Zone d'analyse : « Hide Controls · Funnel ▾ » (sélecteur de représentation) ; une bande « Watchdog Insights BETA » avec « Error outliers 0 · Latency outliers 0 » ; le constructeur d'étapes ; le graphique.

Constructeur d'étapes : trois champs typés, `View ▾ [/]` → `Action ▾ [click on ADD TO CART]` → `Action ▾ [click on CHECKOUT]`, chacun avec une croix d'effacement ; boutons « + » (ajouter une étape) et « Reset ». Le type de l'étape (vue ou action) se choisit avant sa valeur.

Graphique funnel (`f001.png`) :
- Type : trois barres verticales suspendues au haut de l'axe (l'axe Y va de 0M en haut à 5M en bas), reliées par des bandes translucides qui vont du haut de la barre N au haut de la barre N+1.
- Mesure : sessions ayant atteint l'étape. Étape 1 « @view.name:/ — 4.77M sessions of 5.95M total » (barre verte, hauteur = 4.77M) ; étape 2 « @action.name:click on ADD TO CART — 3.21M sessions » (barre bleu-vert, « 67 % » à mi-hauteur, segment saumon en dessous « 33% dropoff ») ; étape 3 « @action.name:click on CHECKOUT — 720K sessions » (barre bleue, « 22 % », segment saumon « 78% dropoff »).
- Dimensions : aucune ventilation ; la seule dimension est l'étape.
- Info-bulle (`f002.png`) : « 719678 sessions (15% of original) » sur la 3ᵉ barre.

Ce que l'écran cherche à démontrer : on construit une question de conversion (vue → action → action) sans écrire de requête, et le graphique répond en sessions et en pourcentage de perte à chaque marche.

Lecture attentive :
- Le « 22 % » peint sur la barre 3 est un ratio marche à marche (720K / 3.21M) ; le « 15% of original » de l'info-bulle est un ratio par rapport à la première étape (720K / 4.77M). Deux conventions pour la même barre, sans étiquette qui les distingue.
- « 4.77M sessions of 5.95M total » : la première étape n'inclut pas toutes les sessions de la plage (5.95M sessions au total, facette Type). Le funnel commence donc à la vue `/`, et le total sert de dénominateur implicite mais n'est pas dessiné.
- La bande « Watchdog Insights » occupe une rangée entière pour annoncer 0 et 0.

### Écran B — Panneau latéral d'analyse du funnel (`f003.png` à `f005.png`)

Mise en page : un panneau glisse depuis la droite et couvre ≈ 55 % de la largeur ; le funnel reste visible (tronqué) derrière. En-tête : les étapes en fil d'Ariane « View / → Action click on ADD TO CART → Action click on CHECKOUT » ; à droite, une plage propre au panneau « 1w · Past 1 Week ▾ », une case « Use Analytics Page Time » (décochée) et une croix de fermeture.

Widgets, de haut en bas (`f004.png`) :

| Widget | Type | Mesure · dimensions |
|---|---|---|
| Conversion Rate | tuile KPI, fond vert | 16.57 % |
| Highest Dropoff | tuile KPI, fond rouge pâle | 75.47 % |
| Average Time Spent | tuile KPI, fond neutre | 1.81 min |
| Conversion Rate Over Time | courbes | taux de conversion (0–40) par jour Sat 4 → Fri 10 ; deux séries « Conversion Rate » et « Last week » |
| Session Count | courbes | sessions (0–4k) ; séries « Last Week » et « Session Count » |
| Conversion Rate By Version | courbes | taux de conversion ; une série par version (55e9764, aa80944, cc94778, da18b6a) |
| Session Count By Version | courbes | sessions ; une série par version |
| User Analysis | barre d'onglets | **Conversions** / Dropoffs ; liens « Query for Conversions », « Query for Dropoffs » |
| Top Users | barres horizontales classées | sessions par utilisateur : 20.8k sherry@doe.com, 20.7k jane@doe.com, 20.6k shane@, kelner@, albert@, 20.5k **undefined**, 20.5k homer@doe.com, 20.4k melissa@, britt@ |
| Browser Repartition | table triée | Browser Name · Browser Version · Count (Chrome 91.0.4472.77 162.62k, Firefox 89.0 8,987, Edge 91.0.831.1 6,040, Chrome Mobile 4,016, Edge Mobile 3,294, Chrome 92.0.4515.131 173, HeadlessChrome 30) avec une barre proportionnelle |
| Sessions | table | ▶ · DATE · SESSION TYPE · TIME SPENT · VIEW COUNT · ERROR COUNT · ACTION COUNT · INI… (tronqué) · LAST VIEW PATH ; lignes du type « Sep 10 11:22:45.498 · synthetics · 109.19s · 8 · 1 · 7 · / · /cart » |

Chaque widget porte trois icônes en en-tête (`f003.png`, `f004.png`) : une pour « ouvrir en requête » (cercle), une d'export, une de plein écran.

Ce que l'écran cherche à démontrer : un clic sur une marche du funnel ne quitte pas la page ; il ouvre une qualification de la perte dans l'ordre des questions qu'on se pose — combien (tuiles), depuis quand (courbes avec la semaine précédente), à cause de quelle release (par version), pour qui (Top Users, navigateurs), et quelles sessions regarder (table avec ▶).

Lecture attentive :
- Les chiffres du panneau (16.57 % / 75.47 %) ne sont pas ceux du graphique derrière (15 % / 78 %) : le panneau est sur « Past 1 Week », le graphique sur deux mois, et rien à l'écran ne le dit autrement que la case décochée.
- « undefined » figure comme un utilisateur parmi les autres dans Top Users.
- Les sessions listées sont de type « synthetics » (tests synthétiques Datadog), mélangées dans une « User Analysis ».
- La table de sessions à neuf colonnes ne tient pas dans le panneau : un en-tête est tronqué (« INI… »).
- Sur `f003.png`, les tuiles KPI s'affichent avant les graphiques : l'ordre de chargement suit l'ordre de lecture.

### Écran C — Session Replay et Event Timeline (`f006.png` à `f014.png`)

Mise en page : deux colonnes. À gauche (≈ 2/3), le lecteur ; à droite (≈ 1/3), « EVENT TIMELINE ». Pas de panneau de facettes, pas de barre RUM : le rejeu est une page à part entière.

En-tête (`f006.png`) : « ← Sessions · Browser session replay lasting 2m by user Melissa Doe » ; à droite « Share ». Sous l'en-tête, une rangée de puces de contexte : `shopist-web-ui` (service), `env:prod`, `version:aa80944`, `Chrome`, `Linux`, `Japan` ; la date « Sep 10, 11:22 am » à droite.

Lecteur : la page rejouée (« COUCH CACHE », boutique de démonstration) avec le curseur de l'utilisateur, les états de survol (`f007.png`, `f010.png`, `f014.png`) et le contour de focus (`f013.png`) restitués. En bas : une barre de défilement avec des marqueurs d'événements colorés (violet, bleu, rouge), « 00:19 / 01:40 », le chemin courant (`/department/chairs/product/1` sur `f006.png`, `/department/sofas` sur `f009.png`, `/department/sofas/product/11` sur `f012.png`), un interrupteur « Skip inactivity » (actif), les vitesses `.25x .5x 1x 2x 4x` (1x sélectionné), pause.

Event Timeline (identique de `f006.png` à `f014.png`, seule la ligne surlignée change) :
- Filtres en en-tête : cases cochées « View », « Action », « Error », plus une icône d'horloge (non établi : bascule temps relatif / absolu ?).
- Colonnes : temps relatif au début de session, icône de nature, libellé.
- Lignes : `0 Load Page /` · `14.2 s Load Page /department/chairs` · `16.3 s Load Page /department/chairs/product/?` · `19.5 s Click on ADD TO CART on page /department/chairs/product/?` · `20.4 s Load Page /department/sofas` · `23.2 s Load Page /department/sofas/product/?` · `24.3 s Click on ADD TO CART on page /department/sofas/product/?` · `25.7 s Load Page /department/bedding` · `27.8 s Load Page /department/bedding/product/?` · `30.9 s Click on ADD TO CART on page /department/bedding/product/?` · `31.8 s Load Page /cart` · `33.9 s Click on APPLY on page /cart` · `33.9 s Custom user action apply coupon on page /cart` · `36.2 s Click on CHECKOUT on page /cart` · `36.2 s` (indentée, icône rouge) `network error Fetch error post https://api.shopist.io/checkout.json?coupon_code=WINTER100` · `39.5 s Custom user action purchase on page /cart`.
- Les libellés de vue sont des routes normalisées (`/department/sofas/product/?`) alors que le lecteur affiche le chemin brut (`/department/sofas/product/11`) : deux niveaux de la même information, chacun à sa place.
- L'erreur réseau est indentée sous le clic qui l'a provoquée : la timeline dessine la causalité clic → requête échouée, avec la même horodate (36.2 s).

Synchronisation : la ligne surlignée suit la tête de lecture (19.5 s sur `f006.png` quand le curseur rejoué est sur ADD TO CART ; 20.4 s sur `f007.png` ; 23.2 s sur `f011.png` ; 25.7 s sur `f013.png`). Le panneau ne défile pas pendant ces 8 s (16 lignes tiennent à l'écran ; le comportement au-delà est non établi).

Ce que l'écran cherche à démontrer : après le funnel et le panneau, on regarde une session qui a atteint CHECKOUT, et la timeline montre que la requête de paiement a échoué (`checkout.json?coupon_code=WINTER100`) juste après le clic. Le parcours complet de la vidéo est « de la conversion à la requête qui échoue » : agrégat → cohorte → session → événement.

Lecture attentive :
- La session « lasting 2m » se lit dans un lecteur de 01:40 ; l'écart (arrondi ? inactivité sautée ?) est non établi.
- L'action métier « purchase » est émise à 39.5 s, après l'erreur réseau de 36.2 s ; la vidéo ne dit pas si l'achat a abouti.
- Le nom de l'utilisatrice, le service, la version, l'OS et le pays sont affichés en clair dans l'en-tête ; les textes, prix et images du site sont visibles dans le rejeu (aucun masquage).
- La vidéo ne montre ni clic sur la ligne d'erreur, ni ouverture d'un détail d'erreur ou d'une trace : ce pivot est non établi.

## 3. Motifs d'interaction et de drill-down à retenir

Pour chacun : où il apparaît, ce qu'il garantit, et ce que le POC a en face (fichier + ligne, lus via graft).

1. **Un sélecteur de représentation sur une même requête** (« Funnel ▾ », `f001.png`). La question (facettes + plage) est la même quelle que soit la représentation. En face : `apps/console/app/explorer/page.tsx:L79-L313` compose une mesure et une représentation sur un jeu de données, sans lancer de requête avant validation ; le funnel n'y est pas une représentation, il vit sur une page à part (`apps/console/app/paths/page.tsx:L21-L29`).
2. **Des étapes de funnel typées** (View / Action, `f001.png`), ajoutées avec « + », effacées avec « Reset ». En face : `apps/console/lib/funnel.ts:L2` — « Un funnel = suite ORDONNÉE d'étapes (noms d'événements custom) » ; les étapes `s1..s4` viennent d'un formulaire GET (`apps/console/app/paths/page.tsx:L21`). Une vue (route) ou un clic ne peuvent pas être une étape aujourd'hui.
3. **Une barre par étape, coupée en deux** (atteint / perdu), reliée à la suivante par une bande, avec le nombre absolu et le pourcentage (`f001.png`). L'info-bulle donne l'absolu et le ratio à l'origine (`f002.png`). En face : `apps/console/components/Funnel.tsx:L55-L86` (`FunnelChart`) ; sa forme n'a pas été comparée ici (non établi).
4. **Un clic sur une marche ouvre un panneau, pas une page** (`f003.png`). Le contexte (funnel, facettes) reste visible derrière ; le panneau a sa propre plage, avec une case pour l'aligner sur la page. Rien d'équivalent repéré dans le POC (non établi).
5. **L'ordre des widgets du panneau suit l'ordre des questions** : combien → tendance → par version → cohortes → sessions (`f004.png`). Ce n'est pas un choix de style, c'est un ordre de lecture.
6. **La période précédente en seconde série** (« Last week », `f004.png`) sur les deux premières courbes. Une régression se lit sans calcul.
7. **La version comme dimension de découpage par défaut** (« By Version », `f004.png`) : le taux de conversion par release répond à « quelle mise en production a cassé le paiement ? ». En face : le POC porte une release par occurrence (`releaseRechercheParOccurrence`, `apps/console/app/sessions/page.tsx:L90`) ; un découpage de conversion par release est non établi.
8. **Deux cohortes, et un pivot vers la recherche** (Conversions / Dropoffs + « Query for … », `f004.png`) : la cohorte devient une requête réutilisable ailleurs. Non établi : la forme de la requête produite.
9. **Un bouton ▶ par ligne de la table de sessions** (`f005.png`, info-bulle « Replay Session ») : de la cohorte au rejeu en un clic. En face : `listSessions` (`apps/console/lib/queries.ts:L363-L389`) renvoie routes et `err_count` ; un indicateur « rejeu disponible » par ligne est non établi (non vérifié dans `apps/console/app/sessions/page.tsx`).
10. **Le contexte de session en puces d'en-tête** (service, env, version, navigateur, OS, pays, `f006.png`). En face : la grille `Meta` de `apps/console/app/sessions/[id]/page.tsx:L82-L110` (App, Device, Navigateur, Pays estimé avec sa provenance, Source SDK/Extension). Le POC dit d'où vient le pays (`geoSourceLabel`, L88-L91) ; Datadog affiche « Japan » sans provenance.
11. **La timeline à côté du lecteur, surlignage synchronisé** (`f006.png` → `f013.png`), temps relatifs, erreur indentée sous le clic causal. En face : `apps/console/components/sessions/Timeline.tsx:L14-L38` — offset relatif (`fmtOffset`), badge de nature, et badge `↳ action_name` quand un item est rattaché à une action (L29-L33) ; mais timeline et rejeu sont deux onglets (`apps/console/app/sessions/[id]/page.tsx:L52-L61`, `L127-L138`), et le rejeu se positionne sur l'instant d'une erreur via `?tab=replay&at=` (`apps/console/components/errors/error-view.ts:L90`). La causalité est là ; la juxtaposition ne l'est pas.
12. **Filtrer la timeline par nature** (cases View / Action / Error, `f006.png`). En face : des badges de comptage par nature, sans bascule (`apps/console/app/sessions/[id]/page.tsx:L118-L122`).
13. **Une barre de lecture porteuse d'événements** (marqueurs colorés), « Skip inactivity », vitesses (`f006.png`). En face : `apps/console/components/replay/ReplayPlayer.tsx:L30-L185` — lecture, pause, positionnement à un instant avec état `positioned` / `unavailable` (L18, L26-L27) ; aucune occurrence de vitesse ni de saut d'inactivité dans `apps/console/components/replay`.
14. **Des facettes avec décompte, recherche par facette et « + Add »** (`f001.png`). En face : `pageFilters` (`apps/console/lib/page-filters.ts:L67-L91`, 31 appelants) porte les filtres ; un panneau de facettes avec décomptes est non établi.
15. **Une bande « Watchdog Insights »** (outliers d'erreur et de latence, `f001.png`) attachée à l'analyse en cours. Aucun équivalent dans le POC ; candidat pour l'épique d'apprentissage automatique demandée par ailleurs.
16. **Trois icônes par widget** (requête, export, plein écran, `f004.png`) : chaque graphique peut redevenir une requête.

## 4. Ce qu'il serait à éviter

- Deux conventions de pourcentage sur la même barre (22 % marche à marche peint, 15 % de l'origine en info-bulle, `f001.png`/`f002.png`) sans étiquette. Une seule convention affichée, l'autre nommée explicitement (« 15 % des sessions de départ »).
- Un panneau dont les chiffres portent sur une autre plage que le graphique qu'il commente (`f003.png` : « Past 1 Week » contre « 2mo »), avec pour seul indice une case décochée. La plage du panneau doit être celle de la page par défaut, ou la différence écrite en clair à côté des tuiles.
- « undefined » présenté comme un utilisateur (`f004.png`). Une ligne « non identifié » nommée comme telle, ou hors classement.
- Des sessions synthétiques dans une « User Analysis » (`f004.png`, SESSION TYPE = synthetics). Le POC distingue déjà SDK et Extension à la source (`apps/console/app/sessions/[id]/page.tsx:L93-L96`) ; garder cette séparation visible dans toute liste.
- Une identité en clair dans l'en-tête du rejeu et dans Top Users (`f006.png`, `f004.png`). Le POC n'affiche aucune PII (`apps/console/app/sessions/page.tsx:L108`) et ne stocke que des empreintes (`user_id_hash`, `apps/console/lib/health.ts:L44`). Un « top utilisateurs » par adresse n'est donc pas reproductible ; un classement par empreinte serait lisible par un administrateur DSAR seulement, pas par un analyste.
- Un rejeu non masqué par défaut (`f006.png` : textes, prix, images visibles). Le POC masque par défaut, saisies, texte et médias (`packages/rum-sdk/src/replay.ts:L261-L263`) : à garder, et à dire dans le lecteur (déjà le cas : « saisies masquées à l'enregistrement », `ReplayPlayer.tsx:L147`).
- Une bande d'« insights » qui occupe une rangée pour dire 0 et 0 (`f001.png`). Ne l'afficher qu'avec un contenu, ou dire ce qui a été vérifié et sur quelle fenêtre.
- Un axe Y inversé (0M en haut, `f001.png`) sans mention : lisible ici parce que les barres pendent, déroutant si on le reprend sans le dire.
- Une table de neuf colonnes dans un panneau latéral (`f004.png`, « INI… » tronqué) : choisir cinq colonnes et renvoyer au détail pour le reste.
- Des cases toutes cochées qui signifient « aucun filtre » (`f001.png`, facettes) : l'inclusion et l'exclusion se ressemblent ; l'état « aucun filtre » doit se distinguer d'un filtre qui inclut tout.
- Timeline et rejeu en deux onglets (l'état actuel du POC, `apps/console/app/sessions/[id]/page.tsx:L127-L138`) : c'est le point que la vidéo invite à changer, pas à conserver.
- Un rejeu ouvert par changement de page complet depuis le panneau (`f005.png` → `f006.png`) : le funnel et le panneau sont perdus ; un retour « ← Sessions » ne les restitue pas forcément (non établi).

## 5. Non établi

- Ce qui précède `f001.png` et ce qui suit `f014.png`.
- Le clic qui ouvre le panneau B (entre `f002.png` et `f003.png`) : barre, libellé ou pourcentage.
- Si « Funnel » est une représentation parmi d'autres du même sélecteur, et lesquelles.
- La forme de la requête produite par « Query for Conversions » / « Query for Dropoffs ».
- Le rôle de l'icône `</>` (barre haute) et de l'icône d'horloge (en-tête de la timeline).
- Si un clic sur la ligne « network error » ouvre un détail, une trace, ou rien.
- L'origine du contour pointillé orange (`f013.png`) : style de focus du site rejoué, ou surcouche du lecteur.
- L'écart entre « lasting 2m » et « 01:40 ».
- Si la timeline défile avec la lecture au-delà d'une hauteur d'écran.
- Si les lignes de la table de sessions sans rejeu montrent un ▶ inactif.
- Le contenu de « Watchdog Insights » quand les compteurs ne sont pas à zéro.
- Côté POC : la forme actuelle de `FunnelChart` et la présence d'un indicateur de rejeu dans la liste des sessions (non lus dans cette passe).

## 6. Résumé

La vidéo montre en 14 s un seul parcours : un funnel typé (vue → clic → clic) avec la perte à chaque marche, un panneau latéral qui qualifie la perte (taux, tendance contre la semaine passée, par version, par utilisateur, par navigateur) et liste des sessions rejouables, puis un rejeu dont la timeline synchronisée indente une erreur réseau sous le clic CHECKOUT. Ce qui est à retenir tient en trois motifs : le panneau qui qualifie sans quitter la page, la version comme découpage par défaut, et la timeline juxtaposée au lecteur avec la causalité dessinée. Ce qui est à ne pas reprendre : les pourcentages à deux conventions, les chiffres d'un panneau sur une autre plage que la page, et l'identité et le contenu en clair. Le POC possède la causalité clic → effet (`Timeline.tsx:L29-L33`, `actions/page.tsx:L41`), le rejeu positionné à l'instant d'une erreur (`error-view.ts:L90`) et un funnel limité aux événements custom (`funnel.ts:L2`) ; il lui manque la juxtaposition timeline/lecteur, les étapes de funnel typées vue/action, et le panneau d'analyse d'une marche.
