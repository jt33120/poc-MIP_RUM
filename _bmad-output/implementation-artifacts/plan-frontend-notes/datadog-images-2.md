# Lecture des captures Datadog — lot 2

> Trois images : le résultat d'un test navigateur Synthetics relié à sa session RUM, le tableau de bord
> prêt-à-l'emploi « RUM - User Sessions », et le schéma marketing de la plateforme. Pour chacune : l'écran,
> la grille, chaque widget, les interactions, les motifs d'analyse, et ce qui est mal fait. Une synthèse
> classée ferme le document.

**Ce que ce document garantit.** Chaque libellé cité a été lu sur l'image d'origine ou sur un zoom ×2
(`scratchpad/datadog/crops/*.png`, produits par `sips`). Les libellés que l'image tronque sont reproduits
tronqués (`Total user sessi…`) et leur complétion, quand elle est proposée, est marquée comme hypothèse.
Les comportements d'interaction non visibles sur l'image sont sourcés dans la documentation Datadog citée
en fin de document, ou marqués « non établi ».

**Ce qu'il ne garantit pas.** Les captures viennent de la page marketing de Datadog, pas d'une instance :
les données sont des jeux de démonstration (`shopist.io`), datées (mai 2022 pour la première), et rien ne
prouve que l'interface actuelle soit identique. Aucune valeur numérique n'est à réutiliser comme référence.

Méthode : zooms dans `scratchpad/datadog/crops/` (`enh_header2`, `enh_steps_left`, `enh_steps_right`,
`enh_steps_bottom`, `opt_header2`, `opt_sessions_overview`, `opt_demographics`, `opt_appusage_top`,
`opt_appusage_tables`). Aucun fichier du dépôt n'a été modifié.

---

## 0. Provenance des trois images

| Fichier | Nature | Section du site d'origine | Taille |
|---|---|---|---|
| `enhanceenduserimage.png` | Capture produit — Synthetics, page de résultat d'un test navigateur | D'après le nom de fichier : « Enhance End-User Experience and Customer Satisfaction ». L'association image ↔ section n'a pas été confirmée par la page : **non établi**. | 1304 × 668 |
| `newoptimizeperformanceimage.png` | Capture produit — tableau de bord « RUM - User Sessions » | D'après le nom de fichier : « Easily Optimize Performance ». Même réserve : **non établi**. | 1304 × 670 |
| `dd_platform_260623_en.png` | Schéma marketing, pas un écran produit | Légende « Platform Diagram », sous « The Essential Monitoring and Security Platform for the Cloud Age » (confirmé par la lecture de la page, cf. sources). | 1756 × 988 |

Les trois viennent de `https://www.datadoghq.com/dg/real-user-monitoring/overview/` (copie locale :
`/Users/juliantalou/Downloads/datadog screenshots and videos /`).

---

## 1. `enhanceenduserimage.png` — résultat d'un test navigateur, relié à sa session RUM

### 1.1 Quel écran

Datadog **Synthetic Monitoring**, page de résultat d'un *browser test* nommé
`Shop.ist Checkout w/ Coupon Test w/ trace` (fil d'Ariane `Synthetics > Shop.ist Checkout w/ Coupon Test w/ trace`,
zoom `enh_header2`). C'est l'écran du **robot** : un scénario de 13 étapes rejoué depuis `NYC Office` sur
`Laptop Large` / `edge 101.0.1210.32`, et dont la particularité — celle qui justifie sa présence sur une page
RUM — est la ligne `1 Related RUM Session` : le passage du robot a lui-même été enregistré comme une session
RUM, avec rejeu.

Ce n'est **pas** une vue « robot contre utilisateurs réels ». Le lien est un lien d'**identité** (ce run =
cette session), pas une comparaison de populations. La différence compte pour MIP (voir § 1.7).

### 1.2 Grille de mise en page

Trois bandes horizontales, une colonne principale, un rail de navigation à gauche.

| Zone | Contenu | Au-dessus du pli ? |
|---|---|---|
| Rail gauche (≈ 34 px, navy) | Logo, icônes produit (recherche, infra, logs, APM, RUM, etc.) | oui |
| Bandeau 1 — identité du test | Fil d'Ariane ; badge `OK` + `Last ran 2 mins ago (May 24, 2022, 1:50 pm)` ; H1 ; à droite `Run Test Now`, `Pause Scheduling`, engrenage ; sélecteur `All locations` ; sélecteur de temps `1h Past 1 Hour` avec ⏮ ⏸ ⏭ et loupe « dézoom » | oui |
| Bandeau 2 — échantillon et métadonnées | `View sample` → segmented `Successful Run` / `Failed Run` ; ligne de 9 micro-en-têtes uppercase : `STATUS PASSED`, `STARTING URL https://www.shopist.io/ ↗`, `STEPS 13 / 13`, `DURATION 30s`, `LOCATION NYC Office`, `DEVICE Laptop Large`, `BROWSER edge 101.0.1210.32`, `TIME RAN 2 mins ago (May 24, 2022, 1:50 pm)`, `RUN TYPE Scheduled (fast retry) View original ↗` | oui |
| Bandeau 3 — pont vers RUM | `1 Related RUM Session` · bouton `View Session in RUM` · bouton `▶ Replay Session 1` (grisé) | oui |
| Corps — table des étapes | Colonnes : index + statut, `SCREENSHOT`, `ACTION`, pastilles de comptage, `DURATION`, chronologie sur axe partagé `0 µs … 30 s` | 7 étapes sur 13 visibles |

Hiérarchie visuelle : le H1 et le badge de statut portent la réponse à « ça marche ? » ; la ligne de
métadonnées porte « dans quelles conditions ? » ; la table porte « où passe le temps et où sont les
erreurs ? ». Le pont vers RUM est placé **entre** le résumé et le détail : c'est un pivot, pas un widget.

### 1.3 Widgets, un par un

| Libellé exact | Type | Mesure / agrégation | Découpage | Axes, légendes, seuils | Ce qu'on comprend en un regard | Choix de représentation |
|---|---|---|---|---|---|---|
| `OK` + `Last ran …` | badge de statut + horodatage | dernier état du moniteur | — | couleur verte | le test est vert maintenant | juste : un état, pas une série |
| `STATUS PASSED` … `RUN TYPE` | ligne de faits (micro-en-têtes uppercase, valeur en dessous) | métadonnées du run (pas d'agrégation) | — | — | conditions du run (lieu, appareil, navigateur, planification) | juste : une ligne de « key facts » évite neuf tuiles ; `13 / 13` dit à la fois le total et l'avancement |
| `View sample : Successful Run / Failed Run` | segmented control | choisit **quel** run est affiché | — | — | on peut regarder un échantillon réussi et un échantillon échoué du même test | juste : la comparaison bon/mauvais est une intention d'analyse, pas un filtre |
| `1 Related RUM Session` + `View Session in RUM` + `Replay Session 1` | pivot | compte de sessions RUM produites par ce run | — | bouton de rejeu grisé (rejeu indisponible sur cet échantillon : **non établi** pourquoi) | ce run existe aussi côté RUM, on peut le rejouer | juste comme pivot ; le compteur `1` vaut promesse de cardinalité |
| Colonne index + ✓ | indicateur par ligne | statut de l'étape | par étape | coche verte | toutes les étapes visibles ont réussi | juste, mais un ✓ par ligne sur 13 lignes est du bruit quand tout est vert ; n'afficher que les écarts serait plus lisible |
| `SCREENSHOT` | vignette | capture après l'étape | par étape | — | le robot était bien sur la bonne page | juste comme **ancre de confiance**, faible en information ; la vignette n'est pas comparée à la précédente |
| `ACTION` | cellule composite | 1) libellé de l'action (`Navigate to start URL`, `Click on div "Shop now"`, `Click on image "2.77cffca.jpg"`, `Click on div "Add to cart"`, `Click on div "Lighting"`, `Click on image "30.54e8738.jpg"`) ; 2) URL d'arrivée ; 3) pastilles `LCP ✓ 1.03s` `CLS ✓ 0` ; 4) `Started at <URL d'origine> ↗` | par étape | coche verte devant la valeur = « good » selon les seuils Web Vitals ; aucune bande de seuil dessinée | quelle page, quel LCP, quel CLS, à partir d'où | discutable : quatre informations dans une cellule, dont une redondante (l'URL d'arrivée de l'étape *n* est le `Started at` de l'étape *n+1*) |
| Pastilles `⚠ 5 Errors` / `18 Resources` / `1 Trace` | compteurs cliquables (chips) | nombre d'erreurs, de ressources chargées, de traces APM liées | par étape | rouge pour les erreurs, gris pour le reste | où creuser | juste : le compteur **est** le point d'entrée du drill-down (doc : les erreurs sont séparées `js` / `network`, les ressources donnent le `Fully Loaded`) |
| `DURATION` | valeur | durée de l'étape (`1 s`, `3.4 s`, `1.4 s`, `734 ms`, `1.7 s`, `752 ms`, `1.1 s`) | par étape | unités adaptées (ms / s) | quelle étape est lente | juste, mais sans seuil ni comparaison au run précédent |
| Chronologie (sans titre) | Gantt sur axe partagé | position = décalage cumulé depuis le début du run ; largeur = durée de l'étape | par étape | axe `0 µs, 5 s, 10 s, 15 s, 20 s, 25 s, 30 s` ; piste vert clair pleine largeur, segment vert foncé | où sont passées les 30 s ; les étapes 1 (3.4 s) et 4 (1.7 s) dominent le début | juste pour des étapes **ordonnées et non chevauchantes** ; la piste pleine largeur n'encode rien (30 s = durée totale, ou budget ? **non établi**) ; la couleur code le statut (vert), pas la sévérité — une étape de 3,4 s a la même couleur qu'une de 734 ms |

Détail des lignes visibles (zooms `enh_steps_left`, `enh_steps_right`, `enh_steps_bottom`) :

| # | Action | Page d'arrivée | LCP | CLS | Erreurs / ressources / traces | Durée |
|---|---|---|---|---|---|---|
| 0 | `Navigate to start URL` | `https://www.shopist.io/` | ✓ 1.03s | ✓ 0 | 5 / 18 / 1 | 1 s |
| 1 | `Click on div "Shop now"` | `/department/chairs` | ✓ 1.42s | ✓ 0 | 5 / 28 / 1 | 3.4 s |
| 2 | `Click on image "2.77cffca.jpg"` | `/department/chairs/product/2` | ✓ 0.84s | — | 5 / 22 / 3 | 1.4 s |
| 3 | `Click on div "Add to cart"` | (pas de navigation) | — | — | aucune pastille | 734 ms |
| 4 | `Click on div "Lighting"` | `/department/lighting` | ✓ 1.31s | ✓ 0 | 2 / 28 / 1 | 1.7 s |
| 5 | `Click on image "30.54e8738.jpg"` | `/department/lighting/product/30` | ✓ 0.97s | — | 2 / 19 / — | 752 ms |
| 6 | `Click on div "Add to cart"` | (pas de navigation) | — | — | 2 / 2 / 2 | 1.1 s |

Deux lectures que la table rend possibles sans clic : (a) les Web Vitals ne sont posés que sur les étapes
qui **naviguent** — une action sans navigation (`Add to cart`) n'a ni LCP ni CLS, et Datadog ne lui donne
aucune mesure de réactivité en remplacement ; (b) le compte d'erreurs passe de 5 à 2 à partir de l'étape 4,
sans qu'on sache s'il est cumulé ou par étape (**non établi**).

### 1.4 Interactions visibles ou implicites

- **Pivot Synthetics → RUM** : `View Session in RUM` ouvre la session RUM du robot ; `Replay Session` lance
  le rejeu. La doc décrit le sens inverse : depuis l'explorateur RUM, une session issue d'un test porte
  « This event was generated by a Synthetic test run » et un bouton `View Synthetic Test Result`
  (source : doc « Explore RUM through Synthetics », cf. sources). Le lien est **bidirectionnel**.
- **Pastilles de comptage** : `Errors`, `Resources`, `Traces` sont des chips cliquables ouvrant un panneau
  latéral (doc « Browser test results »). Le compteur sert d'affordance.
- **Comparaison d'échantillons** : `Successful Run` / `Failed Run` ; la doc ajoute une comparaison de
  captures côte à côte entre un run échoué et le dernier réussi quand les paramètres coïncident.
- **Variables de contexte** : `All locations` (lieu d'exécution) et fenêtre de temps avec lecture/pause
  (le bouton ⏸ bleu indique un rafraîchissement automatique actif).
- **Actions sur le moniteur** : `Run Test Now`, `Pause Scheduling`, `View original` (le run affiché est un
  `fast retry` ; l'original est le run qui a déclenché la relance).
- Survol des segments du Gantt, tri des colonnes, clic sur la vignette : **non établi** depuis l'image.

### 1.5 Motifs d'« intelligence d'analyse »

1. **Le rating collé à la valeur** : `LCP ✓ 1.03s`. Le seuil n'est pas dessiné, mais le verdict est là où
   l'œil lit le chiffre. Garantie : on sait si c'est bon. Non garanti : on ne sait pas *de combien* on est
   loin du seuil.
2. **Le compteur comme pivot** : `5 Errors` est à la fois un fait et un bouton. Zéro clic pour savoir où
   creuser, un clic pour y aller.
3. **L'axe partagé** entre étapes : le Gantt fait apparaître la répartition du temps dans le parcours, ce
   qu'une colonne `DURATION` seule ne donne pas.
4. **Bon/mauvais échantillon** comme premier geste d'analyse (`View sample`), avant tout filtre.
5. **Le passage du robot vu comme une session** : la même donnée dans les deux produits, avec rejeu.

Ce qu'il n'y a **pas** : aucune comparaison au run précédent (la durée de 3,4 s de l'étape 1 est-elle
habituelle ?), aucune bande de seuil, aucune annotation, aucun tri par impact — la table suit l'ordre du
scénario, ce qui est le bon ordre pour un parcours mais interdit de repérer une étape dégradée sans
parcourir 13 lignes.

### 1.6 Ce que Datadog fait mal ou de façon discutable

- **Redondance** : l'URL d'arrivée de chaque étape est répétée en `Started at` de la suivante ; la cellule
  `ACTION` porte quatre lignes pour une information et demie.
- **Coches vertes partout** : 13 ✓ sur un run réussi est du bruit ; le statut au niveau du run suffit tant
  qu'aucune étape ne diverge.
- **Piste vert clair pleine largeur** dans le Gantt : de l'encre sans donnée. Si elle représente le budget
  de 30 s, il faudrait le dire ; sinon l'ôter.
- **Couleur = statut, pas sévérité** : une étape lente réussie est aussi verte qu'une rapide. La durée est
  la variable d'intérêt de cette vue, et elle n'est encodée que par la largeur.
- **Aucune mesure sur les actions sans navigation** : `Add to cart` ne reçoit ni INP ni délai de réponse ;
  la seule chose mesurée est la durée technique de l'étape robot.
- **Jargon** : `Scheduled (fast retry)`, `View original`, `1 Trace` supposent connus le modèle de relance et
  la notion de trace APM. Rien n'explique ce qu'est un `fast retry` sur l'écran.
- **Vignettes sans usage** : elles ne servent ni à comparer ni à repérer un écart ; elles occupent la
  colonne plus large que `DURATION`.

### 1.7 Ce que ça dit pour MIP (court)

La console MIP fait déjà ce que cet écran **ne** fait **pas** : comparer le robot à la population réelle,
route par route, et lister les « angles morts » (robot « ok » / réel « poor ») —
`apps/console/app/correlation/page.tsx` L15-L144 (hero `RobotVsRealChart`, `HeroStat "Angles morts"`),
`apps/console/lib/queries-v2.ts` L465-L473 (`BlindSpotRow` : `rum_lcp_p75`, `syn_latency_avg`,
`syn_state`, `gap_ms`). Ce que la console ne fait pas et que Datadog fait : le lien d'**identité** run ↔
session (« ce passage du robot, vu depuis le RUM, rejoué »). Si `syn_snapshot` porte un identifiant de run
réutilisable côté session : **non établi** dans cette lecture ; à vérifier avant de promettre ce pivot.

---

## 2. `newoptimizeperformanceimage.png` — tableau de bord « RUM - User Sessions »

### 2.1 Quel écran

Un **dashboard** Datadog (pas l'explorateur RUM) intitulé `RUM - User Sessions`, de la famille des tableaux
prêts-à-l'emploi (« Usage: Analyze user session and usage data for your RUM applications, including
frustration signals », doc « RUM Dashboards », cf. sources). Fenêtre `1w Past 1 Week`. Le bouton
`Clone Dashboard` indique un tableau fourni en lecture seule, à cloner pour être modifié. Le `sessionType`
est fixé à `user` : les sessions synthétiques sont exclues de tout l'écran.

L'écran répond à trois questions : *combien de sessions, comment elles évoluent, d'où elles viennent* ;
*que font les utilisateurs par session* ; *par où ils entrent et sortent*.

### 2.2 Grille de mise en page

| Zone | Contenu |
|---|---|
| Barre 1 | ★ favori, icône, `RUM - User Sessions ▾`, `Clone Dashboard` ; à droite : `1w Past 1 Week ▾`, ⏮ ⏸ ⏭, loupe |
| Barre 2 | `Search…` ; chips de variables de template : `$service *`, `$version *`, `$applicationId *`, `$country *`, `$device *`, `$OS *`, `$browser *`, `$env *`, `$sessionType user` ; à droite `ON High Density Mode`, icônes clavier / écran / engrenage |
| Colonne gauche (≈ 50 %) | groupe repliable **`Sessions overview`** (3 tuiles empilées + 2 séries temporelles) puis groupe **`User demographics`** (carte, 3 toplists, 1 barres empilées) |
| Colonne droite (≈ 50 %) | groupe repliable **`Application usage`** (4 mini-séries en ligne, puis deux tables jumelles « first visited page » / « last visited page ») |

Au-dessus du pli (à 670 px de haut, tout l'écran l'est ; à une hauteur réelle d'écran, le premier rang de
chaque colonne l'est) : les trois totaux, la courbe de sessions, les 15 pages, les quatre mini-séries.
Le sens de lecture est **en Z par colonne** : d'abord « combien », puis « comment », puis « qui / d'où ».
Chaque groupe a un titre-phrase (`Sessions overview`), chaque widget un titre-mesure (`Number of sessions`).

### 2.3 Widgets, un par un

**Groupe `Sessions overview`** (zoom `opt_sessions_overview`)

| Libellé exact | Type | Mesure / agrégation | Découpage | Axes, légendes, seuils | Ce qu'on comprend | Choix de représentation |
|---|---|---|---|---|---|---|
| `Total user sessi…` → `45.04k` | query value (grand chiffre) | count(sessions) sur la fenêtre | aucun | — | volume | juste, mais **sans variation vs période précédente** ; la console MIP calcule ce delta (`pctOf`, `apps/console/app/page.tsx` L100-L101) |
| `Average session…` → `3.13 min` | query value | avg(durée de session) | aucun | — | engagement moyen | discutable : une moyenne de durées de session est tirée par les sessions longues ouvertes en arrière-plan ; une médiane ou un p75 dirait autre chose |
| `Page views per …` → `10.56` | query value | avg(vues par session) | aucun | — | profondeur de visite | juste comme ratio ; même remarque sur la moyenne |
| `Number of sessions` | série temporelle, 2 séries | count(sessions) par seau (≈ 250–300 par seau) | par seau de temps | y `0 / 200 / 400` ; x `Fri 19 / Aug 21 / Tue 23` ; ligne violette pleine + ligne grise pointillée ; **tableau de légende** `T… / M… / Avg / Min / Max / Sum` : gris `*` `La…` 283 / 149 / 451 / 47.5k ; violet `*` `S…` 267 / 65 / 368 / 44.9k | la semaine (violet) suit la précédente (gris, hypothèse « Last week » — **non établi**) puis chute nettement en fin de fenêtre | juste : la superposition décalée est le bon outil pour « est-ce normal ? » ; la légende-tableau donne Avg/Min/Max/Sum sans survol. Mal : les libellés sont tronqués au point d'être illisibles |
| `Top 15 pages` | série temporelle, 15 séries | count(vues) par page et par seau | par `@view.name` (hypothèse, libellé tronqué `@…` / `P…`) | y `0k / 0.5k / 1k` ; palette bleu / jaune / violet ; légende-tableau `Tags / Metric / Avg / Min / Max / Sum` (3 lignes visibles : 95.3 / 29 / 156 / 16.0k ; 29.6 / 22 / 37 / 5.0k ; 33.0 / 21 / 66 / 5.5k) | qu'il y a beaucoup de pages, et une chute finale commune | **mauvais choix** : 15 courbes enchevêtrées ne se lisent pas ; le classement (qui est la question posée par « Top 15 ») est absent du graphique et relégué dans une légende tronquée. Un toplist à barres, ou 15 petits multiples, répondrait à la question |

**Groupe `User demographics`** (zoom `opt_demographics`)

| Libellé exact | Type | Mesure / agrégation | Découpage | Axes, légendes, seuils | Ce qu'on comprend | Choix de représentation |
|---|---|---|---|---|---|---|
| `Number of sessions by country` | carte choroplèthe mondiale, zoom ± | count(sessions) | par pays | dégradé de bleus, pas d'échelle affichée | la géographie du trafic (États-Unis dominants, Europe, Inde, Australie, Japon, Corée) | juste **parce qu'elle est doublée** par la liste ; seule, une choroplèthe sans échelle ne donne aucune valeur |
| `Top 10 countries` | toplist à barres horizontales, valeur à gauche | count(sessions), tri décroissant | par pays | `16.76k United States`, `4.72k Germany`, `4.51k Ireland`, `3.78k United Kingdom`, `2.74k France`, `2.35k Norway`, `2.25k Japan`, `2.03k South Korea`, `1.65k India`, `1.55k Australia` | l'ordre et le rapport d'échelle (US ≈ 3,5 × le 2e) | juste : la valeur exacte est lue, la barre donne le rapport |
| `Top 5 devices` | toplist | count(sessions) | par type d'appareil | `34.85k Mo…`, `10.19k Des…`, `1 Bot` | mobile ≈ 3,4 × desktop | juste, mais une ligne `1 Bot` dans un « top 5 » à 3 valeurs montre que le widget affiche tout ce qu'il trouve, y compris l'insignifiant ; et le libellé `Mobile` est tronqué à 3 lettres |
| `Top 5 operating …` | toplist | count(sessions) | par OS | `20.18k Android`, `14.67k iOS`, `9.71k Windows`, `0.48k Mac O…`, `1 Linux` | Android > iOS > Windows | juste ; même remarque sur `1 Linux` |
| `Top 10 browser usage share` | barres empilées par seau de temps | « usage share » par navigateur — unité **non établie** | par `@browser…` (10 séries) | y `0 / 20 / 40 / 60` ; x `Fri 19 / Aug 21 / Tue 23` ; pic à ≈ 55 en fin de fenêtre ; légende-tableau `Tags / Metric / Avg / Value` avec `2e-3 / 0`, `2e-3 / 0`, `1.45 / 6.02`, `4e-3 / 0`, `0.022 / 0` | qu'une part navigateur bondit en fin de période | **discutable** : les valeurs de légende (`2e-3`, `1.45`) ne correspondent pas à l'échelle dessinée (0–60) — soit une autre unité, soit un autre calcul ; le lecteur ne peut pas réconcilier les deux. Une « part » devrait se lire en % et sommer à 100 ; ici les hauteurs varient de 20 à 55 |

**Groupe `Application usage`** (zooms `opt_appusage_top`, `opt_appusage_tables`)

| Libellé exact | Type | Mesure / agrégation | Découpage | Axes, légendes, seuils | Ce qu'on comprend | Choix de représentation |
|---|---|---|---|---|---|---|
| `Session duration` | mini-série (sparkline avec axe) | avg(durée) par seau | temps | y `0–5` (unité **non établie** : minutes ?), x `Aug 21` seul ; bleu | très bruité, chute finale | discutable : le bruit domine ; sans unité ni lissage la courbe ne dit que « ça bouge » |
| `Pages views per session` | mini-série | avg(vues / session) par seau | temps | y `0–10`, bleu | stable ≈ 10, creux final | juste comme sparkline de stabilité |
| `Actions per session` | mini-série | avg(actions / session) par seau | temps | y `0–20`, violet | ≈ 12–13 puis bond final | juste ; la couleur violette est reprise dans les tables (colonne actions) |
| `Errors per session` | mini-série | avg(erreurs / session) par seau | temps | y `0–10`, **rouge** | ≈ 7 puis chute à ≈ 0 puis ≈ 3 | juste ; le rouge est sémantique (erreur) et repris dans les tables. Ce que ça ne dit pas : 7 erreurs par session en moyenne est énorme, et aucun seuil ne le signale |
| `⬇ Usage metrics based on first visited page` | table avec **barres en cellule** | par page d'entrée : `COUNT[@TYPE:S…` (sessions), `AVG:@SESSION.TIM…` (durée), `AVG:@SESSION.VIE…` (vues), `AVG:@SESSION.ACTI…` (actions), `AVG:@SESSION.ERR…` (erreurs) | `INITIAL VIEW NAME` ; tri ↓ sur le count | barres bleues (count, durée, vues), violettes (actions), rouges (erreurs), chacune **échelonnée sur le max de sa colonne** | quelles pages d'entrée pèsent, et lesquelles produisent des sessions longues / actives / en erreur | **juste** : cinq mesures hétérogènes lues d'un coup sans cinq graphiques ; le tri par volume met l'impact en haut |
| `⬆ Usage metrics based on last visited page` | même table | mêmes colonnes | `LAST VIEW NAME` | idem | quelles pages de sortie, et dans quel état les sessions y finissent | **juste** : la **paire** entrée / sortie est l'idée d'analyse ; les colonnes identiques permettent de lire les deux tables en miroir |

Contenu des deux tables (valeurs lues, libellés tronqués reproduits tels quels) :

| Première page | Sessions | Durée moy. | Vues moy. | Actions moy. | Erreurs moy. |
|---|---|---|---|---|---|
| `HomeViewController` | 10.63k | 34.1 s | 12.67 | 25.51 | 8.2 |
| `Background` | 8k | 38.5 s | 7.7 | 3.25 | 5.99 |
| `/` | 7.44k | 58.0 s | 9.29 | 14.78 | 0.57 |
| `Home` | 7.37k | 10.94 min | 14.99 | 8.17 | 12.27 |
| `/department/tables…` | 4.77k | 10.2 s | 1 | 0 | 0 |
| `ApplicationLaunch` | 3.06k | 38.4 s | 13.12 | 24.71 | 7.86 |
| `Catalog` | 2.84k | 13.15 min | 16.44 | 7.96 | 13.65 |

| Dernière page | Sessions | Durée moy. | Vues moy. | Actions moy. | Erreurs moy. |
|---|---|---|---|---|---|
| `Background` | 17.85k | 6.56 min | 12.1 | 6.03 | 9.85 |
| `HomeViewController` | 10.3k | 34.9 s | 12.93 | 25.64 | 8.73 |
| `/department/tables…` | 4.76k | 10.2 s | 1 | 0 | 0 |
| `/checkout` | 3.75k | 12.7 s | 8.97 | 12.97 | 0.018 |
| `CheckoutViewContr…` | 2.96k | 32.3 s | 12.58 | 24.93 | 6.93 |
| `/` | 1.94k | 138.3 s | 11.95 | 22.07 | 1.92 |
| `/cart` | 1.13k | 86.4 s | 7.65 | 9.91 | 0.055 |

Ce que ces tables laissent voir sans clic, et que le tableau de bord ne dit **pas** :

- `/department/tables…` : 1 vue, 0 action, 0 erreur, 10,2 s, en entrée comme en sortie, à 4,7k sessions —
  la signature d'un trafic non humain ou d'une page d'atterrissage sans suite. Aucun marqueur ne le signale.
- `HomeViewController`, `Background`, `ApplicationLaunch`, `CheckoutViewContr…` sont des noms de vues
  **mobiles** ; `/`, `/checkout`, `/cart` des routes **web**. Avec `$applicationId = *`, l'écran mélange
  deux populations dont les « pages » ne sont pas comparables ; `Background` (état de cycle de vie d'une
  app mobile) est la première « page de sortie » avec 17,85k sessions.
- Les erreurs moyennes par session (8,2 ; 12,27 ; 13,65) n'ont ni seuil ni couleur graduée : la barre rouge
  est proportionnelle au max de la colonne, pas à une notion de « trop ».

### 2.4 Interactions visibles ou implicites

- **Variables de template** (barre 2) : neuf dimensions globales, dont `$sessionType` préréglé sur `user`.
  Toute carte de l'écran hérite de la sélection. C'est l'équivalent du contrat commun `pageFilters` de la
  console MIP (`apps/console/lib/page-filters.ts` L67-L91, via `graft repo_map`), avec une différence :
  Datadog **affiche** la valeur en cours de chaque variable en permanence, même quand elle vaut `*`.
- **Fenêtre de temps** avec ⏮ ⏸ ⏭ (pause = rafraîchissement automatique actif) et loupe « dézoom ».
- **Groupes repliables** (chevron `˅` devant `Sessions overview`, `Application usage`, `User demographics`).
- **`High Density Mode` ON** : resserre la grille (davantage de cartes par rangée). Sa présence dit que
  la densité par défaut ne suffisait pas à l'auteur du tableau.
- **`Clone Dashboard`** : le tableau fourni ne s'édite pas ; on le copie pour l'adapter.
- **Implicites, non visibles sur l'image** : clic sur une ligne de toplist → filtrer / exclure la valeur ;
  clic sur une ligne de légende → isoler la série ; survol d'une série → infobulle multi-séries ; clic sur
  une cellule de table → pivot vers l'explorateur RUM avec le filtre posé. Ce sont des comportements
  standard des dashboards Datadog ; leur présence sur **ce** tableau est **non établie** depuis l'image.

### 2.5 Motifs d'« intelligence d'analyse »

1. **Comparaison décalée** (ligne grise pointillée sous la ligne violette) : la question « est-ce normal ? »
   est posée sur la carte de tête. Garantie : on voit l'écart. Non garanti : rien ne chiffre
   l'écart ni ne signale la chute finale.
2. **Légende-tableau** `Avg / Min / Max / Sum` : la légende devient un résumé statistique. La somme
   (47.5k vs 44.9k) donne l'écart hebdomadaire sans survol.
3. **Barres en cellule, échelonnées par colonne, triées par impact** : la table des pages d'entrée porte
   cinq mesures par ligne et se lit sans survol.
4. **Paire entrée / sortie** avec colonnes identiques : c'est une construction d'analyse (d'où on vient,
   où on finit), pas un simple regroupement.
5. **Couleur par nature de mesure**, constante entre mini-séries et tables : bleu volume / durée, violet
   actions, rouge erreurs. La cohérence permet de lire une table comme on lit les sparklines.
6. **Carte + liste** : la carte pour la forme, la liste pour les nombres. Ni l'une ni l'autre seule.
7. **Population déclarée** : `$sessionType user` visible dans la barre dit que les robots sont exclus.

Ce qu'il n'y a **pas** : aucun seuil (ni sur les erreurs par session, ni sur la durée), aucun delta sur les
grands chiffres, aucune annotation d'événement (déploiement, incident) sur les séries, aucune ligne
« autres » sous les tops, aucun tri par **dégradation** (les tables sont triées par volume, jamais par
erreurs ou par durée), et aucun texte de lecture : l'écran montre, il n'explique pas.

### 2.6 Ce que Datadog fait mal ou de façon discutable

- **Troncatures systématiques** : titres (`Total user sessi…`, `Average session…`, `Page views per …`,
  `Top 5 operating …`), en-têtes de colonnes (`AVG:@SESSION.TIM…`), légendes (`T…`, `M…`, `La…`, `S…`,
  `@browse…`, `Usag…`), valeurs (`Mo…`, `Des…`, `Mac O…`). À 1304 px de large, un tiers des libellés est
  illisible. La légende de `Number of sessions` ne permet pas de savoir ce que sont les deux séries.
- **En-têtes en langage de requête** : `COUNT[@TYPE:S…`, `AVG:@SESSION.ACTI…`. L'auteur n'a pas nommé ses
  colonnes ; l'outil affiche l'expression brute. C'est du jargon, et tronqué.
- **Spaghetti** : `Top 15 pages` en 15 courbes. Le « top » n'est pas lisible ; la question posée par le
  titre n'est pas celle à laquelle le graphique répond.
- **Incohérence légende / échelle** sur `Top 10 browser usage share` (valeurs `2e-3` pour des barres à 20).
- **Moyennes partout** (`Average session`, `AVG:…`) sur des distributions asymétriques ; aucune médiane,
  aucun percentile, alors que RUM est précisément le domaine où la moyenne trompe.
- **Mélange de populations** web / mobile dans les mêmes tables sans le dire.
- **Aucun seuil ni couleur graduée** : 12 erreurs par session et 0,018 ont la même teinte, seule la
  longueur change.
- **Catégories résiduelles affichées** (`1 Bot`, `1 Linux`) sans regroupement « autres ».
- **Mini-séries sans unité** (`Session duration` 0–5 : minutes ? secondes ?) et sans lissage.
- **Densité sans hiérarchie** : 17 cartes de taille voisine ; rien ne dit laquelle regarder d'abord ; le
  `High Density Mode` aggrave ce point.
- **Aucune lecture** : pas une phrase sur l'écran. La console MIP en met une par hero (`HeroReading`,
  `apps/console/app/correlation/page.tsx` L15-L144) ; c'est un choix qu'il faut garder.

---

## 3. `dd_platform_260623_en.png` — schéma marketing de la plateforme

### 3.1 Quel écran

Ce n'est pas un écran produit : c'est le **schéma « Platform Diagram »** de la page marketing, sous
« The Essential Monitoring and Security Platform for the Cloud Age ». Il n'y a aucune donnée, aucun
graphique au sens dataviz ; c'est un **diagramme de flux** gauche → droite qui porte une thèse : *beaucoup
de sources, une plateforme, beaucoup de produits, un seul écran, toutes les équipes*.

### 3.2 Grille de mise en page

Cinq colonnes séparées par des filets verticaux gris, chacune surmontée d'un titre en capitales colorées
(rose → magenta → violet), et deux formes translucides en entonnoir qui relient les colonnes 1 → 2 → 3 :

| Colonne | Titre | Contenu (libellés exacts) | Forme |
|---|---|---|---|
| 1 | `MULTIPLE DATA SOURCES` | `1,000+ Sources`, `Logs`, `Traces`, `Metrics`, `Activity`, `Metadata`, `Sessions` | 7 cartes blanches avec icône |
| 2 | `PLATFORM SERVICES` | `Dashboards`, `Agents`, `Collaboration`, `Mobile`, `Workflows`, `Notebooks`, `OpenTelemetry` | 1 panneau magenta, liste séparée par filets |
| 3 | `PRODUCTS / USE CASES` | `Infrastructure`, `APM`, `DBM`, `Log Management`, `Cloud SIEM`, `CI Visibility`, `Continuous Profiler`, `RUM`, `Network`, `Synthetics`, `Product Analytics`, `Bits AI`, `Code Security`, `Cloud Security`, `Observability Pipelines`, `Cloud Cost Management`, `… and more` | 17 pastilles violettes, en nuage |
| 4 | `SINGLE PANE OF GLASS…` | hexagone magenta avec le chien Datadog | 1 icône, 3 flèches sortantes |
| 5 | `…ACROSS TEAMS` | `Dev`, `IT Ops`, `Security`, `Support`, `Business` | 5 pastilles avec icône « utilisateur » |

Hiérarchie : l'hexagone (colonne 4) domine par la taille et la saturation ; les titres 4 et 5 forment
une seule phrase coupée par des points de suspension (`SINGLE PANE OF GLASS… …ACROSS TEAMS`). `RUM` et
`Sessions` sont présents mais pas mis en avant : sur une page RUM, le schéma dit « RUM n'est qu'un produit
parmi 17 ».

### 3.3 Widgets

Aucun widget de données. Les seuls « chiffres » sont `1,000+ Sources` (une revendication, pas une mesure).
Type de représentation : diagramme de flux à colonnes. Il est adapté à ce qu'il fait — raconter une
architecture en une lecture gauche → droite — et il n'est pas adapté à autre chose.

### 3.4 Interactions

Aucune (image statique). **Non établi** si les pastilles sont des liens sur la page d'origine.

### 3.5 Motifs d'analyse

- **Sens de lecture unique** (gauche → droite), avec un seul point de convergence (l'hexagone) : on sait où
  regarder.
- **Entonnoirs translucides** pour dire « tout ceci alimente cela » sans flèches multiples.
- **Symétrie** : 7 sources à gauche, 5 audiences à droite ; le produit au centre.

### 3.6 Ce qui est discutable

- `… and more` et `1,000+ Sources` sont du remplissage : ils disent « nous sommes gros », pas ce que la
  plateforme garantit.
- 17 pastilles produit en nuage sans ordre ni regroupement : le lecteur ne peut pas retrouver « RUM » sans
  balayer.
- Le dégradé rose → violet sur les titres n'encode rien.
- Le schéma promet un « single pane of glass » ; les deux écrans précédents montrent que la lecture reste
  fragmentée (troncatures, jargon de requête, deux produits pour un même parcours robot).

### 3.7 Ce que ça dit pour le site de présentation MIP

Le message à opposer est l'inverse de celui-ci : **peu de boîtes**. Sources (SDK web, SDK mobile, agent
Node, extension navigateur, synthétique DEM) → un seul fil OTLP → un backend souverain → une console →
trois lectures (perf réelle, robot vs réel, erreurs / sessions). Un schéma à 4 colonnes et une douzaine de
libellés, avec les garanties écrites dessous (OTel-native, hébergement UE, pas de format propriétaire —
`README.md` « Pourquoi celui-là »). Ce que le schéma MIP doit dire aussi : ce qui **n'est pas** là (pas
d'APM, pas de SIEM), parce que le dépôt écrit déjà ses limites (`docs/LIMITES.md`).

---

## 4. Synthèse transversale — les dix idées de conception à retenir, classées

Classement par ce qu'une idée apporte à la **justesse de lecture** (bon graphique pour la bonne donnée,
agencement, intelligence d'analyse), pas par ce qu'elle coûte. La dernière colonne dit ce que la console
MIP a déjà, d'après les fichiers cités ; « non établi » quand la lecture ne l'a pas vérifié.

| # | Idée | Vue dans | Ce qu'elle garantit | Ce qu'elle ne garantit pas / condition | État dans la console MIP |
|---|---|---|---|---|---|
| 1 | **Table à barres en cellule, échelonnées par colonne, triée par impact** | `Usage metrics based on first visited page` | cinq mesures hétérogènes lues d'un regard ; l'ordre dit le poids | pas de notion de « trop » sans seuil ; le tri par volume cache les lignes peu fréquentes mais dégradées — prévoir un second tri « par dégradation » | `RankBar.tsx`, `VersionsTable.tsx` existent (`apps/console/components/charts/`, `components/`) ; barres en cellule multi-colonnes : **non établi** |
| 2 | **Paire entrée / sortie à colonnes identiques** | `first visited page` / `last visited page` | on lit le parcours par ses deux bouts avec le même vocabulaire | sans séparation web / mobile, les « pages » ne sont pas comparables ; sans ligne « autres », le total n'est pas retrouvable | `/paths`, `/acquisition` existent (`apps/console/app/`) ; miroir entrée / sortie : **non établi** |
| 3 | **Gantt de parcours sur axe partagé, avec vitals et compteurs par étape** | table des étapes Synthetics | on voit où passe le temps dans un parcours ordonné, et où creuser | seulement pour des étapes non chevauchantes ; la couleur doit encoder la sévérité, pas le statut ; les actions sans navigation ont besoin d'une mesure (INP / délai) | cascade de traces `/tracing` et timeline de session (`docs/design/README.md` « timeline de session ») ; Gantt de parcours robot avec vitals par étape : **non établi** |
| 4 | **Le rating collé à la valeur** (`LCP ✓ 1.03s`) et le **compteur comme pivot** (`5 Errors`) | Synthetics | verdict et point d'entrée sans quitter la ligne | le ✓ ne dit pas la distance au seuil ; un compteur non cliquable trahit l'affordance | `VitalCard.tsx` L26-L47 : jauge de seuils 2026 avec zones good / à améliorer / poor — **fait mieux** que le ✓ seul ; compteurs-pivots par ligne : **non établi** |
| 5 | **Pont d'identité synthétique ↔ RUM, bidirectionnel** | `1 Related RUM Session`, `View Session in RUM`, `Replay Session` ; retour `View Synthetic Test Result` (doc) | un run robot se rejoue et se lit comme une session ; le lien existe dans les deux sens | ce n'est pas une comparaison de populations ; suppose un identifiant de run partagé | `/correlation` compare robot vs réel par route et liste les angles morts (`page.tsx` L15-L144, `BlindSpotRow` L465-L473) — **fait autre chose, et mieux pour la question MIP** ; lien d'identité par run : **non établi** |
| 6 | **Superposition de la période précédente + légende-tableau Avg / Min / Max / Sum** | `Number of sessions` | « est-ce normal ? » répondu sur la carte principale ; la somme donne l'écart | la comparaison doit être nommée lisiblement (ici `La…`) ; les distincts ne se somment pas (`docs/LIMITES.md`, « Distincts ») | `pctOf` sur les tuiles (`app/page.tsx` L100-L101), `vitalsP75(f, true)` et `overviewStats(f, true)` pour la période précédente (L84-L86) ; pointillé de période précédente sur une série : **non établi** |
| 7 | **Barre de variables de template toujours visible, population déclarée** (`$sessionType user`) | dashboard | on sait sur quelle population chaque carte parle | une variable à `*` sur `$applicationId` mélange web et mobile sans prévenir | `pageFilters` (`lib/page-filters.ts` L67-L91) et drapeaux robots / apps internes (`docs/DASHBOARDS.md`) ; affichage permanent de la population effective : **non établi** |
| 8 | **Couleur par nature de mesure, constante entre sparklines et tables** (bleu volume, violet actions, rouge erreurs) | `Application usage` | une table se lit comme ses sparklines | ne remplace pas une couleur graduée par seuil ; orange MIP réservé au « réel » (`docs/design/README.md`) — à concilier | direction « série réel en orange vs robot bleu acier pointillé » (`docs/design/README.md`) ; palette par nature de mesure : **non établi** |
| 9 | **Groupes repliables titrés par question, lecture en Z par colonne** | `Sessions overview` / `Application usage` / `User demographics` | on sait quoi regarder d'abord ; un groupe fermé ne coûte rien | 17 cartes de même taille annulent la hiérarchie ; un groupe doit avoir un hero | `Overview` lit les blocs choisis avant les requêtes (`app/page.tsx` L59-L68 : « un bloc éteint ne coûte rien ») — **même principe, côté serveur** ; groupes repliables dans les dashboards utilisateur : **non établi** |
| 10 | **Carte choroplèthe doublée d'un toplist**, et **bon / mauvais échantillon** comme premier geste | `Number of sessions by country` + `Top 10 countries` ; `View sample` | la forme et les nombres ; la comparaison avant le filtre | jamais une carte seule ; un « failed run » n'existe qu'avec un échantillonnage biaisé-erreurs qui le conserve | `ExperienceMap.tsx` (`components/map/`) ; échantillonnage biaisé-erreurs dans le SDK (`docs/context/produit-rum.md` § 2.1) — la donnée existe ; vue « une bonne / une mauvaise session côte à côte » : **non établi** |

Trois idées n'entrent pas dans le top mais valent d'être notées : la vignette d'écran comme ancre de
confiance (Synthetics) ; le `13 / 13` qui dit total et avancement en un token ; le schéma à un seul sens de
lecture pour le site de présentation.

---

## 5. Contre-exemples à ne pas reproduire

Liste courte, tirée des § 1.6, 2.6 et 3.6, pour que le plan d'implémentation les exclue explicitement :

1. Un graphique « Top N » dessiné en N courbes (`Top 15 pages`). Un top est un classement : barres ou petits
   multiples.
2. Des en-têtes de colonnes en langage de requête (`AVG:@SESSION.ACTI…`). Chaque colonne porte un nom
   humain et une unité.
3. Des libellés tronqués par la grille. Si un titre ne tient pas, c'est la carte qui est trop petite, pas
   le titre qui est trop long.
4. Une légende dont les valeurs ne se réconcilient pas avec l'échelle dessinée (`browser usage share`).
5. Des moyennes sur des durées de session et des vitals. Médiane, p75, distribution (`docs/LIMITES.md`,
   « Percentiles » : jamais une moyenne de p75).
6. Une barre proportionnelle au max de la colonne présentée comme une alerte (rouge partout). La couleur
   graduée suit un seuil, la longueur suit la valeur.
7. Deux populations dans une table sans le dire (web + mobile ; humains + robots).
8. De l'encre sans donnée : piste pleine largeur sous un Gantt, ✓ sur chaque ligne d'un run réussi,
   `… and more`.
9. Un écran sans une seule phrase de lecture.
10. Une densité qu'il faut un « High Density Mode » pour supporter, sans hero ni hiérarchie.

---

## Sources

**Images (originales et zooms)**
- `scratchpad/datadog/img/enhanceenduserimage.png` ; zooms `scratchpad/datadog/crops/enh_header2.png`,
  `enh_steps_left.png`, `enh_steps_right.png`, `enh_steps_bottom.png`.
- `scratchpad/datadog/img/newoptimizeperformanceimage.png` ; zooms `opt_header2.png`,
  `opt_sessions_overview.png`, `opt_demographics.png`, `opt_appusage_top.png`, `opt_appusage_tables.png`.
- `scratchpad/datadog/img/dd_platform_260623_en.png` (lu sans zoom).
- Originaux fournis : `/Users/juliantalou/Downloads/datadog screenshots and videos /` (`.jxl`, `.webp`).

**Datadog (web)**
- Page d'origine des images : `https://www.datadoghq.com/dg/real-user-monitoring/overview/` — sections
  « Easily Optimize Performance », « Enhance End-User Experience and Customer Satisfaction »,
  « The Essential Monitoring and Security Platform for the Cloud Age » (légende « Platform Diagram »).
- Résultats de tests navigateur (colonnes `Screenshot`, `Action`, `Duration`, pastilles `Errors` `js` /
  `network`, `Resources` avec `Fully Loaded`, `Traces` ; vitals LCP / CLS par étape ; comparaison de
  captures ; `View Session in RUM`, `Replay Session`) :
  `https://docs.datadoghq.com/synthetics/browser_tests/test_results/`.
- Lien Synthetics ↔ RUM dans les deux sens (`Go to the View in RUM`, `Replay Session`,
  `View all sessions in RUM` ; retour « This event was generated by a Synthetic test run »,
  `View Synthetic Test Result`) : `https://docs.datadoghq.com/synthetics/guide/explore-rum-through-synthetics/`.
- Tableaux de bord RUM prêts-à-l'emploi (« Performance Overviews », « Testing and Deployment », « Usage »,
  « Errors » ; variables de template par défaut) : `https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/`
  et `…/dashboards/usage/`. Les noms exacts des variables et le `High Density Mode` ne sont pas décrits
  dans ces pages : ils sont lus sur l'image.

**Dépôt `poc-MIP_RUM` (lecture seule, via graft)**
- `README.md` — « Pourquoi celui-là », architecture, tableau des workspaces.
- `apps/console/app/page.tsx` L39-L294 (`Overview`), L59-L68 (blocs lus avant les requêtes), L84-L86
  (`vitalsP75(f, true)`), L100-L101 (`pctOf`), L320-L353 (`PhasesReseau`).
- `apps/console/app/correlation/page.tsx` L15-L144 (`Correlation`, `RobotVsRealChart`, `HeroStat`
  « Angles morts », `HeroReading`).
- `apps/console/lib/queries-v2.ts` L465-L473 (`BlindSpotRow`).
- `apps/console/lib/page-filters.ts` L67-L91 (`pageFilters`, d'après `graft repo_map`).
- `apps/console/components/VitalCard.tsx` L26-L47 (jauge de seuils 2026).
- `apps/console/components/charts/` : `Donut`, `ForecastChart`, `Gauge`, `HealthHeatmap`, `LineTrend`,
  `ObservedTrend`, `RadarScore`, `RankBar`, `ScatterPlot`, `StackedBars`, `TrafficTimeseries`,
  `VitalsTimeseries` ; `components/map/ExperienceMap.tsx` ; `components/correlation/BlindSpotRow.tsx`,
  `RouteCard.tsx`.
- `docs/DASHBOARDS.md` (widgets v1 / v2, représentations `value` / `toplist` / `timeseries` / `table`,
  règle d'empilement `meta.additive`).
- `docs/design/README.md` (direction artistique, charte, série réel orange vs robot bleu acier).
- `docs/LIMITES.md` (P6.6 : percentiles fusionnés, distincts jamais sommés, `meta.approximate`).
- `docs/context/produit-rum.md` § 2.1 (échantillonnage biaisé-erreurs), § 2.3 (pages de la console).
