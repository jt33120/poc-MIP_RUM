# Lecture des écrans 01 → 08 de la console MIP RUM

Lot : `01-overview`, `02-pages`, `03-errors`, `04-error-detail`, `05-ux-frustration`, `06-actions`, `07-events`, `08-explorer`.
Captures : `/private/tmp/claude-501/-Users-juliantalou-Documents-PRO-01-CLIENTS-MIP-DEV-poc-MIP-RUM/69c961b4-4adf-49b9-a810-3af9b5d672e7/scratchpad/console/<nom>.png` (index : `index.json` du même dossier). Code : `/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM/apps/console/` — les chemins ci-dessous sont relatifs à ce dossier.
Références Datadog lues : dossier `/Users/juliantalou/Downloads/datadog screenshots and videos ` converti en PNG dans `scratchpad/datadog/` (`sips` pour les JXL/WebP, `ffmpeg` pour des images fixes des trois MP4), plus trois pages web citées à l'endroit où elles servent. Rien n'est affirmé sur Datadog qui ne vienne d'une de ces sources ; le reste est marqué « non établi ».

---

## 0. Ce que les huit écrans partagent (lu une fois, valable partout)

**Coquille** (`app/layout.tsx` L210, L226, L345) : barre latérale `components/Nav.tsx` (Performance / Sessions & traces / Objectifs & alertes / Logs, SVI, IA verrouillés / API et MCP / Administration), roue de réglage des blocs par catégorie (`lib/dashboard-blocs.ts` L40-100), bandeau supérieur `components/GlobalFilters.tsx` L55-247 (presets 1 h / 24 h / 7 j / Personnalisée avec éditeur de plage L249-332 ; Tous / Desktop / Mobile / Tablette ; tiroir « Filtres » de dimensions L334-408 ; pastille « LIVE · 5 s » ; bascule de thème), sous-navigation `components/SubNav.tsx` L9-43 (Vue d'ensemble, Pages lentes, Erreurs JS, Frustration, Actions, Événements, Explorer, Expérience, Mobile), barre de segment `components/SegmentBar.tsx` L63-396 (« Segment tous les visiteurs · + Filtre », « Bots exclus »). `AutoRefresh` re-rend les composants serveur toutes les 5 s (layout L210, L348). Cette coquille occupe ~130 px en haut à 1440 px et ~300 px à 390 px (`60-overview-390.png`, `61-errors-390.png`).

**Filtres refusés** : chaque page passe par `pageFilters(sp, pathname)` (`lib/page-filters.ts` L67-91) et rend `FilterProblemNotice` (`components/FilterProblemNotice.tsx` L8-25 : « Accès refusé » ou « Filtres non appliqués », message, lien de reprise sans le filtre fautif). Périmètre vide = refus, jamais un écran vide : invariant respecté sur les huit routes.

**Seuils Web Vitals** : `lib/rating.ts` L5-11 — LCP 2500/4000 ms, INP 200/500, CLS 0,1/0,25, FCP 1800/3000, TTFB 800/1800 ; ce sont les valeurs web.dev (commentaire L1-2). Datadog documente les mêmes cibles « LCP < 2.5 s, INP < 200 ms, CLS < 0.1, 75th percentile » (https://docs.datadoghq.com/real_user_monitoring/browser/monitoring_page_performance/). **Le produit se contredit à l'écran** : `app/page.tsx` L182 promet une « bande verte “bon” sous 2,0 s » et `lib/glossary.ts` L26 dit « bon < 2,0 s, à améliorer < 2,5 s » pour le LCP, alors que `rating2026` note « bon » jusqu'à 2 500 ms et « mauvais » au-delà de 4 000 ms ; `app/pages/page.tsx` L139 (« > 4,0 s (seuil 2026) ») est, lui, cohérent avec le code. L'étiquette « 2026 » habille des seuils web.dev : à décider une fois (garder web.dev et corriger les deux textes, ou changer `THRESHOLDS`), puis ne plus l'écrire qu'à un endroit.

**Bouton flottant « Votre avis ? »** : ce n'est pas un composant de la console mais le widget d'avis du SDK, chargé sur la console elle-même (`apps/console/public/mip-rum-feedback.js` L3, L68). Fixé en bas à droite, il **masque des valeurs sur toutes les captures 1440 px** : la courbe LCP (`01-overview.png` ≈ x 1240-1355, y 800-840), les pastilles INP/CLS de la ligne « / » du découpage (`02-pages.png` ≈ x 905-990, y 590-615), « Sessions 12 · Signatures 1 » (`03-errors.png` ≈ x 1300-1420, y 840-880), le compte « 2 » de la seconde ligne de signaux (`05-ux-frustration.png` ≈ y 840-880), une cellule de date (`07-events.png` ≈ y 860). Décision de produit à prendre (décaler, replier, ne pas charger sur les écrans de données), pas un défaut de graphique.

**États** :
- Chargement : aucun `loading.tsx` sur ces huit routes (seul `app/mobile/loading.tsx` existe) ; les pages sont des composants serveur qui attendent tous leurs `Promise.all` avant de rendre quoi que ce soit.
- Erreur avec réessai : présent pour `/errors` et `/errors/[fingerprint]` (`app/errors/error.tsx` L5-13), `/actions` (`app/actions/error.tsx` L3-19), `/events` (`app/events/error.tsx`), `/explorer` (`app/explorer/error.tsx`). **Absent** pour `/`, `/pages`, `/ux` (leurs dossiers ne contiennent que `page.tsx`, et il n'y a pas de `app/error.tsx` racine) : une lecture qui échoue y tombe sur la page d'erreur par défaut de Next, en anglais. Plusieurs lectures sont « fail-soft » (`lib/queries-grid.ts` L5-6, `lib/queries-frustration.ts` L4-5 `softFail(e, [])`) : une base qui bronche y devient un écran « aucune donnée », indiscernable d'un vrai zéro — c'est l'inverse de l'invariant « erreur avec réessai / partiel avec raison ».
- Alternative textuelle : fournie par `Breakdown` (L146-190), `ObservedTrend` (L41-56), `LongtasksView` (L53-86), et par le détail « Alternative textuelle de la série » ajouté sous `StackedBars` dans `/errors` (L152-172). **Absente** pour `VitalsTimeseries`, `TrafficTimeseries` (`app/page.tsx` L154-157, L263, L273-277) et `ScatterPlot` (`app/ux/page.tsx` L57-63) : trois graphiques recharts sans table équivalente. Les `Histogram` SVG n'ont qu'un `<title>` par barre (`components/Distribution.tsx` L128-130).

**Données de démo** : le mini-site tourne sur `localhost` (`02-pages.png` : hôte `localhost`, script `http://localhost:8080/`), d'où un LCP p75 à 44 ms, un TTFB à 3 ms, 28 sessions, 80 pages vues, 14 erreurs, une seule signature. Conséquence pour la lecture : toutes les pastilles sont « Bon », les bandes de seuils sont hors de l'axe, les histogrammes tiennent dans la première tranche, la heatmap 14 j n'a que deux cases remplies. Ce n'est pas un défaut de collecte ; c'est une raison de juger les graphiques sur le code autant que sur la capture, et de prévoir un jeu de démo réaliste pour la présentation.

**Invariants vérifiés sur le lot** : occurrences = `sum(e.occurrences)` (`lib/queries.ts` L134 ; `lib/queries-breakdowns.ts` L42-43) ; sessions / visiteurs / identités jamais additionnés (`fmtCount` → « Inconnu » quand null, `components/errors/error-view.ts` L98-100 ; tuiles distinctes L171-174 du détail) ; « Inconnu » comme groupe à part dans les découpages (`components/breakdown-view.tsx` L25-28) ; fenêtres et presets portés par le contrat commun ; aucun poids d'échantillonnage, seulement des avertissements (`lib/queries-errors.ts` L403-421, `lib/queries-actions.ts` L238-246, `lib/queries-events.ts` L191-199). **Deux écarts** : `app/page.tsx` L98 affiche « 0 % » de taux d'erreur quand il n'y a aucune page vue (dénominateur absent → devrait être null / « — ») ; `lib/queries-actions.ts` L203-207 renvoie des zéros quand la table `rum_action` n'existe pas, et l'écran dit « 66 actions » ou « Aucune action causale » au lieu de « Non collecté ».

---

## 01 — Vue d'ensemble (`/`, `app/page.tsx`, capture `01-overview.png`, 1440 × 2096 ; sombre `50-overview-dark.png` ; 390 px `60-overview-390.png`)

### (1) Question
« Le site va-t-il bien pour les vrais visiteurs sur la fenêtre choisie, et sinon, quel facteur coûte des points ? » Le sous-titre n'est pas écrit : `PageHeader` reçoit `help="rum"` (L112) et la réponse tient dans la bulle de glossaire (`lib/glossary.ts` L184-191).

### (2) Mise en page réelle
Ordre vertical (L110-292), tous les blocs pilotés par le cookie `mip-blocs` (`lib/dashboard-blocs.ts` L40-100 ; un bloc éteint n'est pas requêté, L59-66) :
1. En-tête « Performance utilisateur / Vue d'ensemble ? » (L112).
2. Encart d'intégration si l'app n'a aucune session (L114-127) — non visible sur la capture.
3. **Bandeau santé** (L129) : anneau 85/100 « Bon », quatre barres de facteurs, phrase de pondération et « Points perdus » (y ≈ 230-420).
4. **Cinq cartes Web Vitals** LCP / INP / CLS / FCP / TTFB (L131-145, y ≈ 440-620).
5. Décomposition réseau du TTFB (L147, `PhasesReseau` L320-353) — **bloc éteint par défaut** (`defaut: false`, `dashboard-blocs.ts` L49), absent de la capture.
6. **Hero** en deux panneaux (L149-187) : à gauche Sessions · 7 j = 28, Pages vues = 80, Taux d'erreur JS / page vue = 17,5 % (rouge) et phrase de lecture ; à droite « LCP p75 dans le temps (buckets 6 h) », aire orange (y ≈ 640-960).
7. **Web Vitals par dimension** (L192-206) : onglets Route / Navigateur / Système / Pays estimé / Appareil / Release, trois barres (y ≈ 985-1240).
8. **Historique de santé — 14 derniers jours** (L210-283) : bascule 24 h/24 · Heures ouvrées, heatmap 14 × 24, puis deux courbes « Volume & fiabilité par jour » et « p75 LCP par jour » (y ≈ 1265-1990).
9. Comparaison par version (L287) — masquée : moins de deux versions (`components/VersionsTable.tsx` L44).
10. Anomalies LCP 24 h (L289) — masquée : aucune anomalie (`components/health/AnomalyTable.tsx` L9).

Au-dessus du pli (≈ 900 px à 1440) : bandeau santé, cartes vitals, haut du hero. La courbe principale commence sous le pli. À 390 px, la page fait 3 570 px ; le hero passe en une colonne (tuiles puis courbe), les cartes en deux colonnes, la heatmap défile horizontalement (`min-w-[640px]`, `components/charts/HealthHeatmap.tsx` L74).

### (3) Widgets

| Widget | Composant (fichier) | Mesure / agrégation / dimensions | Source | États implémentés |
|---|---|---|---|---|
| Bandeau santé | `components/health/HealthBanner.tsx` L82-142 ; anneau SVG `HealthRing` L14-40 ; `FactorBar` L43-79 | Score 0-100 = 40 % part de mesures « good » (LCP ×2) + 30 % (1 − erreurs/pages vues) + 20 % sessions sans erreur / sessions + 10 % (1 − 0,25 × anomalies 24 h) ; renormalisé sur les facteurs disposant de données (`lib/health.ts` L253-264) ; anomalies exclues sous filtre de population (L184-200, L239-249) | `healthScore(f)` (`lib/health.ts` L138-264) ; anomalies : vue `v_anomaly`, 24 h fixes, \|z\| > 3 | Vide : « Santé : données insuffisantes sur la fenêtre (…) » quand vitals, erreurs et sessions sont tous null (L83-90 ; `lib/health.ts` L253-256). Facteur sans donnée : « n/a » et barre grise (L70-71). Partiel : « non comptées sous filtre… » (`lib/health.ts` L243-245). |
| Cartes vitals | `components/VitalCard.tsx` L57-110 : badge de rating, valeur, `Trend` vs période précédente (L7-23, masqué si prev null/0, plat < 2 %), `ThresholdMeter` (L29-51, échelle 0 → 1,4 × seuil « poor »), « p75 · n mesures · période », « échantillon faible · médiane » si n < 100 (L55, L100-107) | p75 et p50 par nom, `count(*)`, `rum_metric` groupé par `m.name` | `vitalsP75(f)` et `vitalsP75(f, true)` (`lib/queries.ts` L46-66) | Vide : p75 null → « — », pas de badge, pas de jauge (`lib/format.ts` L3). |
| Hero — tuiles | `HeroStat` (`components/SupervisionHero.tsx` L76-107) + `DeltaBadge` L110-125 | Sessions (`count rum_session` par `last_seen_at`), pages vues (`count rum_pageview`), erreurs = `sum(occurrences)` ; taux = erreurs/pages vues ; delta = variation % vs période précédente contiguë | `overviewStats(f)` et `overviewStats(f, true)` (`lib/queries.ts` L124-142) | Delta masqué si période précédente à 0 (L100-101). **Taux affiché « 0 % » sans page vue** (L98) — écart à l'invariant. Ton rouge > 2 %, orange > 1 % (L179). |
| Hero — courbe LCP | `components/charts/VitalsTimeseries.tsx` L21-81 (recharts `AreaChart`, `ReferenceLine` good/poor à `THRESHOLDS.LCP` = 2 500 / 4 000 ms) | p75 LCP par seau (largeur = celle de la plage) | `vitalSeries(f, "LCP")` (`lib/queries.ts` L150-163) | Vide : « Pas de données sur la fenêtre — élargis la période ou ouvre la démo. » (L158-162). Pas d'alternative textuelle. |
| Web Vitals par dimension | `components/Breakdown.tsx` L40-211 ; lignes via `vitalsBreakdownItems` (`components/breakdown-view.tsx` L36-50) | Longueur de barre = **nombre de mesures LCP+INP+CLS** du groupe ; cellules LCP/INP/CLS p75 en `VitalPill` ; ≤ 12 groupes (`BREAKDOWN_CAP`, `lib/breakdowns.ts` L38) ; « Inconnu » à part | `vitalsBreakdown(f, dimension)` (`lib/queries-breakdowns.ts` L79-109) ; onglets et notices `lib/breakdowns.ts` L61-71, L100-119 | Vide : « Aucune mesure LCP, INP ou CLS sur 7 j » (L204) ; onglet indisponible barré avec raison (L91-101, L202-208) ; troncature dite avec « additionner des p75 n'a pas de sens » (L192-198). Chaque ligne ouvre `/pages` filtré sur le groupe (L71-74). |
| Heatmap 14 j | `components/charts/HealthHeatmap.tsx` L55-129 (grille CSS serveur) ; seuils vert ≥ 90 %, orange ≥ 50 %, rouge sinon (L30-34) | Part pondérée de mesures « good » par (jour, heure), LCP ×2 ; fenêtre fixe 14 j indépendante de la période (`lib/queries-grid.ts` L1-6, L17) ; option Lun-Ven 8 h-19 h (`?hours=business`, L48-57 de la page) | `healthGrid(f)` (`lib/queries-grid.ts` L60-101, fail-soft) | Vide : « Pas assez de données sur 14 jours — la heatmap se remplit au fil des mesures. » (L251-255) ; case vide = « aucune donnée » (légende L114-125). Pourcentage exact uniquement en `title` (L103-107). |
| Volume & fiabilité par jour | `components/charts/TrafficTimeseries.tsx` L25-79 (recharts `ComposedChart` : aire pages vues à gauche, ligne erreurs à droite) | Pages vues et occurrences d'erreurs par jour, 14 j, jours vides à 0 | `dailyTraffic(f)` (`lib/queries-grid.ts` L110-173) | Vide : « Pas de données. » (L265). Pas d'alternative textuelle. |
| p75 LCP par jour | `VitalsTimeseries` avec `xAxis="day"` | p75 LCP par jour, 14 j | `dailyLcpSeries(f)` (L176-194) | Vide : « Pas de données. » (L279). |
| Comparaison par version | `components/VersionsTable.tsx` L36-131 | Sessions, LCP p75, INP p75, sessions avec erreur, écart en points vs version de référence | `comparaisonVersions(f)` (`lib/queries-deploys.ts` L162-172) | Ne se rend pas sous deux versions (L44) ; note de non-normalisation et de source « occurrence / session » (L110-129). |
| Anomalies LCP 24 h | `components/health/AnomalyTable.tsx` L8-52 | App, route, heure, p75, moyenne 7 j, z-score | `health.anomalies` | Ne se rend pas si vide (L9). |
| Écran composé à vide | `components/TousEteints.tsx` | — | — | « Cet écran est vide parce que vous l'avez composé ainsi. » |

### (4) Ce qui est meilleur que Datadog (à conserver)
- **Un score expliqué, pas un score** : anneau + barres de facteurs + phrase « Points perdus : Stabilité des sessions −10 pt (14/28 session(s) sans erreur) · Erreurs JS −5,2 pt (14 erreur(s) / 80 page(s) vue(s)) » (`HealthBanner.tsx` L128-139). Le tableau de bord « RUM - Performance Overview » de Datadog (`scratchpad/datadog/newrumperformanceimage.png`) n'a pas de score composite : il aligne « Total page views », « P75 loading time » et trois séries CWV.
- **L'échantillon est dit** : « p75 · 28 mesures · 7 j » et « échantillon faible · médiane 42 ms » sous 100 mesures (`VitalCard.tsx` L53-55, L100-107). Datadog affiche un p75 sans effectif sur ses widgets (même image : « p75 LCP … 1.64 s »).
- **Le découpage refuse de mentir** : « Inconnu » est un groupe (`breakdown-view.tsx` L25-28), les onglets indisponibles restent visibles avec leur raison, la troncature dit pourquoi on n'additionne pas, chaque onglet porte sa notice de provenance — dont celle du pays : « Pays ESTIMÉ, jamais une géolocalisation… Aucune adresse IP n'est stockée » (`lib/geo.ts` L61-64) et celle de la release « SUR CHAQUE MESURE » (`lib/breakdowns.ts` L69-70).
- **La heatmap dit ce qu'une case vide veut dire** (« aucune page vue ce créneau — les nuits/week-ends creux sont normaux », L245-247) et la bascule « Heures ouvrées » retire les créneaux où l'absence de trafic n'apprend rien.
- **Les blocs indisponibles ont un motif** (`dashboard-blocs.ts` L25-30, L56-80 : Speed Index, opérateur réseau, comparaison à trafic comparable) — une liste grisée sans raison « se lit comme une feuille de route ». Datadog ne montre pas ce qu'il ne mesure pas.
- **Comparaison par version qui refuse de s'afficher** sous deux versions et dit que « l'écart mêle le code et le contexte » (`VersionsTable.tsx` L9-13, L110-114).
- Français intégral, bulles « Technique / Stack / En clair » (`GlossaryTip`), aucune donnée nominative.

### (5) Ce qui est plus faible
- **Une seule série de vital** (LCP) dans le hero et dans l'historique. Datadog montre LCP, FID/INP et CLS côte à côte, chacun sur fond coloré par zone de seuil et avec sa table Avg/Min/Max/Value (`newrumperformanceimage.png`, panneau « Core Web Vitals »). Ici INP et CLS n'ont ni courbe ni bande.
- **Les bandes de seuil promises ne se voient pas** : la lecture dit « bande verte “bon” sous 2,0 s, rouge “mauvais” au-delà » (L182-184) mais le graphique ne dessine que deux `ReferenceLine` à 2 500 et 4 000 ms, hors de l'axe 0-60 ms de la démo (`01-overview.png`, y ≈ 690-910 : aucune ligne visible). Le domaine Y n'est pas forcé à inclure les seuils, et le texte contredit `rating.ts` (voir § 0).
- **Pas de volumétrie sur la fenêtre courante** : sessions et pages vues sont des nombres secs ; la courbe « pages vues + p75 » n'existe que sur 14 jours, sous le pli. Datadog superpose « Number of page views and loading time » sur la même fenêtre que les tuiles.
- **Le découpage classe par volume, pas par gravité** : la barre la plus longue est la route la plus mesurée (`/partners`, 29), pas la plus lente ; les p75 sont rejetés en fin de ligne, en petites pastilles. L'œil lit un classement de « mauvais » qui n'en est pas un.
- **Facteurs tronqués à 390 px** : « W 40 / 40 », « E 24,8 / 30 », « S. 10 / 20 », « A. 10 / 10 » (`60-overview-390.png`, y ≈ 400-520 ; `FactorBar` `truncate` L69). L'information de pondération y disparaît.
- **Sans état de chargement ni d'erreur** : onze lectures en `Promise.all` (L81-94), page blanche jusqu'à la dernière, page d'erreur Next anglaise en cas d'échec ; heatmap/trafic/LCP quotidien fail-soft → « Pas de données. » peut signifier « la base a échoué ».
- **Trois graphiques sans alternative textuelle** (courbe LCP, trafic, LCP quotidien) sur l'écran qui en compte le plus.
- « Anomalies LCP (24 h) » dans un bandeau « Santé (7 j) » : la fenêtre différente est expliquée dans un `title` et dans le glossaire, pas à l'écran (`HealthBanner.tsx` L125 passe `detail`, rendu en `title` L67).
- Taux d'erreur « 0 % » sans dénominateur (L98).

### (6) Déjà disponible côté requêtes, non affiché
- **Phases réseau** : `vitalsP75` renvoie aussi REDIRECT / DNS / TCP / TLS / REQUEST / RESPONSE (commentaire L313-315 de la page) ; le bloc `reseau` est éteint par défaut. `RankBar` sait rendre des barres empilées (`segments`, `components/charts/RankBar.tsx` L28-29, L81-94) : une barre « d'où vient le TTFB » ne coûte aucune requête.
- **Médiane de chaque vital** (`VitalAgg.p50`, `lib/queries.ts` L41) : affichée seulement sous 100 mesures.
- **Valeurs absolues de la période précédente** (`vitalsPrev`, `statsPrev`) : réduites à un pourcentage, masquées quand la période précédente est vide.
- **Séries INP / CLS / FCP / TTFB** : `vitalSeries(f, name)` accepte n'importe quel nom (L150) ; une ligne par vital dans `Promise.all` suffit.
- **Effectifs par vital dans le découpage** (`lcp_n`, `inp_n`, `cls_n`, `lib/queries-breakdowns.ts` L31-33) : qualifieraient chaque pastille p75 comme le fait la carte.
- **Pourcentage exact de chaque case de heatmap** (`good_w / total_w`) : seulement en infobulle.
- **Taux d'erreur quotidien** : `dailyTraffic` porte pages vues et erreurs par jour (L103-107) ; le ratio se calcule côté page.
- **Détail de chaque facteur** (`HealthFactor.detail`, `lib/health.ts` L109) : en `title` seulement.

---

## 02 — Pages lentes (`/pages`, `app/pages/page.tsx`, capture `02-pages.png`, 1440 × 2862 ; sombre `51-pages-dark.png`)

### (1) Question
« Les routes au chargement perçu le plus lent (LCP p75) et ce qui le cause — ressources et tâches JS longues. » (sous-titre L76-77).

### (2) Mise en page réelle
1. En-tête (L75-78).
2. Avertissement de troncature si plus de 200 routes distinctes (`ROUTES_MAX`, `lib/queries.ts` L178 ; L85-101) — absent sur la démo.
3. **Hero** (L103-154) : Routes suivies · 7 j = 3, Routes « mauvais » LCP = 0 (« LCP p75 > 4,0 s (seuil 2026) »), Route la plus lente = 47 ms « / » ; à droite `RankBar` des 8 routes les plus lentes (y ≈ 265-620).
4. **Web Vitals par dimension** (L158-173), même bloc que l'accueil, cible `/pages` (y ≈ 640-900).
5. **Percentiles** p50 → p99 pour LCP/INP/CLS/FCP/TTFB + **trois histogrammes** LCP / INP / CLS (L177-184, y ≈ 940-1360).
6. **Par route** : table Route / Vues / LCP p75 / INP p75 / CLS p75 / Long tasks, repli « n ressource(s) lente(s) » (L186-246, y ≈ 1385-1600).
7. **Ressources** (L251, `ResourcesView`) : avertissement de seuil SDK, part première/tierce partie, tables « Par type » et « Par origine » (y ≈ 1610-1990).
8. **Blocages du fil principal** (L254-261, `LongtasksView`) : barres empilées LoAF / Long Tasks / non distinguées, note, table des 10 pires blocages avec session (y ≈ 2020-2830).

Au-dessus du pli : en-tête, hero, début du découpage. Trois listes de routes se succèdent dans le premier tiers (hero, découpage par route, table « Par route »).

### (3) Widgets

| Widget | Composant | Mesure / agrégation | Source | États |
|---|---|---|---|---|
| Hero — classement | `components/charts/RankBar.tsx` L34-110 (divs serveur, largeur %) ; couleur = `RATING_HEX[rating2026("LCP", p75)]` | LCP p75 par route (CTE `vitals` : `percentile_cont(0.75) filter (where name='LCP')`), sous-texte « n vues · k long tasks » ; top 8 trié desc (L105-108) | `slowRoutes(f)` (`lib/queries.ts` L207-248, `limit 200`, `order by lcp_p75 desc nulls last`) | Vide : `emptyLabel` par défaut « Aucune donnée sur la fenêtre. » (RankBar L39, L50-52). **Pas de lien** : `href` de `RankDatum` (L27) non renseigné (L119-129). |
| Hero — tuiles | `HeroStat` | Routes = lignes renvoyées ; « mauvais » = `rating2026 === "poor"` ; pire = premier du tri | idem | « — » sans route (L143) ; **tone="warn" permanent** sur « Route la plus lente » (L146) même quand elle est bonne. |
| Percentiles | `PercentileTable` (`components/Distribution.tsx` L23-72), infobulles p50…p99 (L74-83) | `percentile_cont(array[.5,.75,.9,.95,.99])` par nom + n | `vitalPercentiles(f)` (`lib/queries.ts` L75-88) | Rend `null` sans vital (L26). Cellule « — » grise quand la valeur manque. |
| Histogrammes | `Histogram` (`Distribution.tsx` L86-151), SVG serveur, 20 tranches sur [0, plafond] (`HISTO_BUCKETS` L21, `VITAL_CAP` LCP 6 000 / INP 1 000 / CLS 1, `lib/distribution.ts` L12-18), barre colorée par rating du milieu de tranche | `width_bucket(value, 0, cap, 20)` + count | `vitalHistogram(f, name, cap, 20)` (`lib/queries.ts` L96-115) | Vide : « pas de mesure sur la fenêtre » (L107-110). Effectif en tête. Valeurs seulement en `<title>`. |
| Table par route | table HTML (L187-246), `VitalPill` (« — » si null), badge long tasks, `SlowResources` (L267-292 : top 3 par durée moyenne, chip type, « bloquant ») | vues, p75 LCP/INP/CLS, nb long tasks par route | `slowRoutes`, `slowResourcesByRoute(f)` (`lib/queries.ts` L278-301) | Vide : « Aucune donnée sur 7 j » (L237-243). Un seul lien par ligne, drill vers cet écran filtré (L211-218, `breakdownDrillHref`). |
| Ressources | `components/ResourcesView.tsx` L92-186 | part par partie (première / tierce / inconnue) sur origines déclarées ; par type et par hôte : n, p75 durée, octets ; ≤ 15 lignes (`RESOURCE_CAP`, `lib/resources.ts` L14) | `resourcesVue(f)` (`lib/queries-resources.ts` L74-133) | Avertissement **avant** les chiffres (L101-110, texte `RESOURCE_THRESHOLD_NOTICE` `lib/resources.ts` L32-33) ; vide : « Aucune ressource retenue… ou la collecte n'est pas activée » (L112-116) ; « Partage non calculable : aucune origine n'est déclarée… » (L148-155) ; troncature dite (L82-87). |
| Blocages dans le temps | `components/LongtasksView.tsx` L22-159, `StackedBars` (`components/charts/StackedBars.tsx` L23-63, recharts) séries LoAF / Long Tasks / « API non distinguée » (L16-20) | comptes par seau et par API, **jamais additionnés** (`lib/queries-longtasks.ts` L1-12) ; p75 du blocage par seau seulement dans la table repliée (L78-80) | `longtaskSeries(f)` (L31-61) | Vide : « Aucun blocage mesuré… Long Animation Frames n'existe que sur Chromium » (L89-92). Alternative textuelle L53-86. |
| Pires blocages | table (L103-156) : ce qui a bloqué + source, route, quand, blocage, session (lien) | 10 lignes (`LONGTASK_WORST_LIMIT` L74) | `worstLongtasks(f)` (L81-101) | « sans session rattachée » (L141-143) ; vide « Aucun blocage sur 7 j » (L147-153). |

### (4) Meilleur que Datadog (à conserver)
- **La troncature est un diagnostic** : « N routes distinctes — les 200 plus lentes sont affichées… une cardinalité qui grimpe vient presque toujours d'identifiants non normalisés que `normalizeRoute` ne reconnaît pas encore » (L85-101).
- **Au-delà du p75** : p90/p95/p99 avec infobulles en clair (« longue traîne — le 1 % le plus lent ») et histogrammes colorés par seuil. Datadog montre une « Page loading time distribution » avec repères p50/p75/p90/p95 (`scratchpad/datadog/rum-db-new-t2.png`) — sur le temps de chargement, pas par vital.
- **Ressources annoncées comme un échantillon biaisé** (« RETENUES, pas tout le trafic réseau — et ne sont pas extrapolés ») et **partage première/tierce partie sans aucune requête sortante** (`ResourcesView.tsx` L156-160).
- **Blocages sans cumul de durées** : « des blocages concurrents de plusieurs visiteurs ne s'additionnent pas en temps d'attente vécu » (L94-100), LoAF et Long Tasks tenus séparés, et **le chemin vers la session** de chaque pire blocage (L133-144) — le cas individuel plutôt que la somme.
- Chaque vue pense à Safari/Firefox (Chromium-only dit à l'écran).

### (5) Plus faible
- **Trois fois la liste des routes** (hero, découpage, table) sur un écran qui en a une à raconter ; le hero et la table portent les mêmes p75. Datadog n'en a qu'une (toplist) par tableau.
- **Le graphique principal ne mène nulle part** : les barres du hero ne sont pas des liens alors que `RankBar` le permet ; il faut descendre à la table pour filtrer.
- **Couleur qui ment** : « Route la plus lente 47 ms » en orange (`02-pages.png` y ≈ 335) parce que `tone="warn"` est fixé, alors que la route est « Bon » partout ailleurs.
- **Aucune tendance** : ni série de LCP par route, ni comparaison à la période précédente. Le Performance Overview Datadog a une série « p75 loading time » ; la vue de page Datadog (`rum-db-new-t8.png`) a une cascade par vue avec repères FCP/LCP — nous n'avons pas de cascade de vue (les ressources sont agrégées par type/hôte).
- **Blocages : on voit combien, pas combien de temps** — le p75 par seau existe (`LongtaskBucket.p75_ms`) mais n'est que dans la table repliée ; `LineTrend` (`components/charts/LineTrend.tsx` L26-84) sait tracer une valeur + un volume sur deux axes.
- **Histogrammes sans axe Y ni effectif par tranche lisible**, `<title>` uniquement ; à 1440 les trois font 92 px de haut (`02-pages.png` y ≈ 1210-1360).
- **Sans `error.tsx`** ; `resourcesVue`, `longtaskSeries`, `worstLongtasks` sont fail-soft (`softFail`) → « Aucune ressource retenue » peut cacher un échec.
- Page longue (2 862 px), ressources et blocages sont à 1 600-2 800 px sans ancre ni sommaire.

### (6) Déjà disponible, non affiché
- `LongtaskBucket.p75_ms` par seau (`lib/queries-longtasks.ts` L27) → deuxième axe du graphique de blocages.
- `VITAL_CAP` a des plafonds pour FCP (6 000) et TTFB (3 000) (`lib/distribution.ts` L16-17) : les histogrammes FCP/TTFB sont deux appels de `vitalHistogram` de plus, aucune requête nouvelle à écrire.
- `SlowResource.avg_ms` / `n` / `render_blocking` par route : pourraient nourrir le sous-texte (`sub`) de chaque barre du hero (« 1 ressource bloquante »).
- `RankDatum.href` : lien de drill depuis le hero, identique à `routeHref` (L71).
- `VitalsBreakdownRow.lcp_n / inp_n / cls_n` : effectif derrière chaque pastille du découpage.
- `RouteRow.views` est dans le sous-texte du hero mais pas dans la longueur de barre : un mode « pondéré par les vues » (LCP × vues) ne demande rien de plus que ce que `slowRoutes` renvoie.

---

## 03 — Erreurs JS (`/errors`, `app/errors/page.tsx`, capture `03-errors.png`, 1440 × 1159 ; 390 px `61-errors-390.png`)

### (1) Question
« Quelles causes récurrentes d'erreurs touchent combien de sessions et de visiteurs sur la fenêtre, et lesquelles montent ? » (sous-titre L141 : « une ligne = une cause récurrente »).

### (2) Mise en page réelle
Deux rendus possibles. Si le regroupement v2 est actif pour l'app (`issueModeFor(await groupingState(apps), f.app)`, L94-121), la page rend `IssueList` (`components/errors/IssueList.tsx` L60-272) avec un formulaire Statut / Source / Release exacte (L111-151) et une note de couverture (L154-160). **La capture montre le rendu historique** (ligne « df1b74ca · demo-app », pas « issue … ») : L123-315.
1. En-tête (L139-142).
2. Bandeaux `ErrorNotices` (échantillonnage, enrichissement pré-v69) — aucun sur la capture (L144).
3. **Hero** (L146-197) : Occurrences · 7 j = 14 (orange), Groupes distincts = 1, Pic par 6 h = 12 « à partir de 18/09 14 h » ; à droite barres empilées « Volume d'erreurs par 6 h (7 j) — par groupe » + détail « Alternative textuelle de la série » (y ≈ 265-680).
4. **Occurrences par dimension** (L77-90, L199) : onglets, deux barres `/partners` 12 et `/` 2 avec « Sessions 12 · Signatures 1 » (y ≈ 705-955).
5. **Table des groupes** (L201-282) : Groupe (badge type, badges statut/régression, message ≤ 120 car., empreinte · app), Occurrences, Sessions, Visiteurs, Tendance · 7 j (sparkline), Première vue (depuis toujours), Dernière vue (y ≈ 985-1125).
6. Pagination (L284-306) et note « n occurrence(s) sans empreinte » (L310-313) — absentes ici.

Tout tient en 1 159 px : l'écran entier est au-dessus du pli à 1440 × 1100 environ. À 390 px, le hero empile tuiles puis graphique ; la table défile dans sa carte, seule la colonne « Groupe » est visible sans défilement (`61-errors-390.png`, y ≈ 1790-1900).

### (3) Widgets

| Widget | Composant | Mesure / agrégation | Source | États |
|---|---|---|---|---|
| Hero — tuiles | `HeroStat` | occurrences = `totals.occurrences` (somme des répétitions) ; groupes = `total` ; pic = seau max de `trend` + son heure (`bucketTick`, `components/errors/error-view.ts` L108-112) | `listErrorGroups(f, page, { series: true })` (`lib/queries-errors.ts` L825-882) | Occurrences en orange dès > 0 (L182). |
| Hero — barres empilées | `components/charts/StackedBars.tsx` L23-63 ; données `errorVolumeChart` (`error-view.ts` L124-148) : 5 groupes de la page + « autres » = population − dessinés, borné à 0 ; légende = `error_type` tronqué à 22 car. (L143) | occurrences par seau et par groupe | `trend` + `series` par groupe | Vide : « Aucune erreur sur cette période » (L175). Alternative textuelle : table Période / Occurrences (L152-172). |
| Découpage | `Breakdown` + `errorsBreakdownItems` (`components/breakdown-view.tsx` L54-72 : « aucune » session quand 0, colonnes Sessions / Signatures) | occurrences par valeur de dimension | `errorsBreakdown(f, dimension)` (`lib/queries-breakdowns.ts` L119-145) | Notice enrichie : « Ce classement porte sur TOUTES les occurrences… le statut de triage et la source… ne le découpent pas » (L82). Vide : « Aucune occurrence d'erreur sur 7 j ». |
| Table des groupes | table HTML (L202-282) ; `ErrorTypeBadge`, `ErrorStatusBadges` (`components/errors/ErrorBadges.tsx` L7-44), `GroupSparkline` (`components/errors/GroupSparkline.tsx` L10-…, SVG 96 × 24, libellé = « n occurrence(s) sur 7 j ») ; `fmtCount` → « Inconnu » | tri « par statut de triage puis par impact » (caption L204) ; lignes résolues/ignorées non régressées atténuées (L225, L230) | idem | Vide : « Aucune erreur sur cette période » ou, offset au-delà de la population, lien « revenir au début » (L266-279). Un seul lien par ligne (L235-248). |
| Notices | `components/errors/ErrorNotices.tsx` L8-23 | — | `samplingOf` (`lib/queries-errors.ts` L411-421 : « Erreurs observées sur un échantillon (probabilité d'inclusion minimale X %). Aucune extrapolation n'est appliquée. ») ; `enrichmentOf` (L396-400) | Rendues seulement si pertinentes. |
| Frontière d'erreur | `app/errors/error.tsx` L5-13 | — | — | « Impossible de charger les erreurs — La lecture a échoué ; aucun chiffre partiel n'est affiché. » + Réessayer. |

### (4) Meilleur que Datadog (à conserver)
- **« Inconnu » n'est pas zéro** : sessions/visiteurs null → « Inconnu », et la lecture du hero l'explique (« une erreur backend sans session, par exemple — ce n'est pas zéro personne », L194-195). L'Error Tracking Datadog titre « 13.4k errors … affecting 13.1k sessions » (`scratchpad/datadog/newerrortrackingimage.png`) sans dire ce qui n'est pas rattaché.
- **Fenêtre dite partout** : « Tous les compteurs de cet écran portent sur 7 j — sauf “Première vue”, qui remonte à la première apparition connue, par définition hors fenêtre » (L192-194) et l'en-tête de colonne « (depuis toujours) » avec `title` (L213-219).
- **Échantillonnage sans extrapolation, avec la probabilité d'inclusion réelle** (`samplingOf`), et la note des occurrences « sans empreinte » (L310-313).
- **Le découpage dit ce qu'il ne filtre pas** (statut/source) — un chiffre qui ne bouge pas quand on filtre serait sinon lu comme un bug.
- Un lien par ligne, alternative textuelle de la série, frontière d'erreur qui refuse le partiel.

### (5) Plus faible
- **Aucun contrôle en mode historique** : ni statut, ni source, ni release, ni recherche par message ; le formulaire n'existe qu'en mode issues (`IssueList.tsx` L111-151). Datadog offre facettes (Service, Version, Browser…), « Mute », « Actions » (`newerrortrackingimage.png`, colonne gauche et bandeau).
- **Légende ambiguë** : les séries sont nommées par `error_type` (L143) ; avec cinq groupes de type « Error », cinq entrées « Error » de couleurs différentes. Sur la capture la légende dit « ● Error » pour un groupe intitulé « Uncaught Error: Erreur de démo MIP RUM ».
- **Pas d'impact humain dans le hero** : `totals.sessions_affected` / `visitors_affected` existent (`ErrorTotals`, L189-192) mais les tuiles ne disent que occurrences / groupes / pic. La phrase de Datadog « affecting N sessions » est celle qu'un lecteur attend.
- **Le tri n'est pas manipulable** et la notion d'« impact » n'est pas une colonne.
- **Sparkline sans échelle** ni valeur max — comparable à Datadog, mais rien ne dit si deux sparklines partagent la même échelle (elles ne la partagent pas : `max` local, `GroupSparkline.tsx` L11).
- **Orange dès une occurrence** (L182) : aucun seuil ne distingue 1 de 10 000.
- À 390 px, occurrences/sessions/visiteurs disparaissent derrière un défilement horizontal (`61-errors-390.png`) — la colonne la plus utile n'est pas la première.
- Le widget d'avis masque « Sessions 12 · Signatures 1 » à 1440.

### (6) Déjà disponible, non affiché
- `ErrorTotals.sessions_affected`, `visitors_affected`, `identified_users_affected`, `session_coverage`, `identity_coverage` (`lib/queries-errors.ts` L156-163, L189-192) → une tuile « Sessions touchées · couverture X % ».
- `ErrorGroupRow.session_coverage` / `identity_coverage` / `identified_users_affected` par groupe (L165-182) : seuls sessions et visiteurs sont en colonne.
- `ErrorGroupRow.resolved_at` (L177) et `status` (badge seulement) : « résolue le … » manque.
- En mode issues : `IssueEntryIssue.first_release` / `last_release` (`lib/error-issues.ts` L206-207) ne sont pas rendus par `IssueRow` (L278-324) ; `IssueCoverage.issue_share` (L230) non plus. Datadog affiche « first/last version impacted » dès la liste.
- `ErrorsBreakdownRow.signatures` est affiché ; `sessions` vaut « aucune » quand 0 — bon.

---

## 04 — Détail d'une erreur (`/errors/[fingerprint]`, `app/errors/[fingerprint]/page.tsx`, capture `04-error-detail.png`, 1440 × 1099)

### (1) Question
« Cette cause d'erreur : qui touche-t-elle, depuis quand, où dans le code, et quelles occurrences ouvrir (session, replay, trace) ? »

### (2) Ce que montre la capture, et pourquoi
La capture est un **404 par défaut de Next** (« 404 — This page could not be found. », en anglais, centré, dans la coquille) pour `/errors/501bd6d3` (`index.json`). Mécanique lue dans le code : `isFingerprintParam` accepte toute chaîne imprimable de 1 à 64 caractères (`lib/queries-errors.ts` L81, L120-122) ; `resolveErrorGroup` ne trouve aucun groupe (`kind: "not_found"`) → `notFound()` (page L109) ; aucun `not-found.tsx` n'existe (`app/not-found.tsx` et `app/errors/not-found.tsx` absents, vérifié) → gabarit Next. La seule empreinte des données de démo est `df1b74ca` (`03-errors.png`) ; pourquoi la capture a visé `501bd6d3` : **non établi** (script de capture). Ce que vaut cet état vide : rien — pas de titre en français, pas de lien « ← Tous les groupes », aucune des causes possibles (purgée par la rétention, autre app, empreinte antérieure au regroupement). À comparer avec `GroupChooser` (L218-257), qui est un bon état d'ambiguïté : « Cette signature existe dans plusieurs applications », liste des apps avec occurrences et dernière vue.

### (2 bis) Mise en page avec données (lue dans le code, L143-202)
1. Lien « ← Tous les groupes » (`BackLink` L205-211).
2. Titre : badge de type + message (L146-151) ; ligne « fingerprint … · app … » + badge de source + badge « gérée / non gérée » du dernier exemplaire (L152-159).
3. **Barre de triage** (`components/errors/ErrorTriage.tsx` L53-89) : statut Ouverte / Résolue / Ignorée, alerte « ⚠ Régression — réapparue après résolution », boutons Marquer résolu / Ignorer / Rouvrir (server action).
4. Notices échantillonnage / enrichissement (L168).
5. **Sept tuiles** `ErrorStat` (`components/errors/ErrorStat.tsx`, grille 2 / 4 / 7 colonnes, L170-182) : Occurrences · 7 j, Sessions touchées, Visiteurs touchés, Utilisateurs identifiés, Couverture identité (« part des occurrences rattachées à un visiteur ou à une identité »), Première vue (« depuis toujours, hors fenêtre »), Dernière vue.
6. **Tendance** `ObservedTrend` (`components/charts/ObservedTrend.tsx` L15-59) : barres serveur sans axe + table repliée (L184-190).
7. **Stack du dernier exemplaire** (`components/errors/ErrorStackCard.tsx` L8-84) : badge « dé-minifié · release », « env dev (déclaré) » avec `title` de prudence (L50), vue, fichier:ligne:colonne ; `SymbolicationNotice` (L91-118 : « Source map inutilisable », « Symbolication différée », « Stack non symbolisée » + raison) ; stack brute repliée ; contexte de code ±3 lignes pour un admin hors démo (L121-144).
8. **Occurrences** (`components/errors/ErrorOccurrences.tsx` L12-112) : Quand, ×n (répétitions), Route, Release, Source + gérée/non gérée, Message, Appareil, Liens Session / Replay / Trace / « Action « … » » (liens vérifiés dans la même app, `error-view.ts` L80-95) ; 100 lignes par défaut (`ERROR_OCCURRENCES_DEFAULT_LIMIT`, `lib/queries-errors.ts` L34), pagination par curseur avec « Occurrences les plus récentes ».

Variante issue (`app/errors/issues/[id]/page.tsx`, L110-204) : mêmes blocs plus **État de l'issue** (statut et sa provenance, avertissement « Regroupement v2 désactivé », table des groupes historiques repris, L219-279), carte de triage/assignation, carte tickets, historique d'activité ; les tuiles Première/Dernière vue portent la release (L161-171).

### (3) Widgets (avec données)

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Tuiles | `ErrorStat` | occurrences (somme), sessions/visiteurs/identifiés (null → « Inconnu »), couverture identité (null → « Inconnue », `fmtCoverage` L102-105), dates | `errorGroupDetail(ref, f, page)` (`lib/queries-errors.ts` L920-959) | — |
| Tendance | `ObservedTrend` | occurrences par seau | `detail.trend` | Sans donnée : barres à 2 % de hauteur (L36) ; table vide. |
| Stack | `ErrorStackCard` | dernier exemplaire | `detail.last`, `exemplarSymbolication` | « (pas de stack capturée) » (L71) ; statuts de symbolication explicites. |
| Occurrences | `ErrorOccurrences` | 100 dernières | `detail.occurrences` | « Aucune occurrence sur cette période avec ces filtres » (L86-90) ; liens « — » quand rien n'existe (L123). |
| Curseur invalide | page L64-77 | — | — | « Curseur de pagination invalide : il ne provient pas de cette console. » + lien. |

### (4) Meilleur que Datadog (à conserver)
- **Couverture identité** : « part des occurrences rattachées à un visiteur ou à une identité » — Datadog compte des sessions sans dire la part non attribuable.
- **Symbolication expliquée** : quatre états nommés avec leur raison (`SymbolicationNotice`), « Symbolisée à l'affichage : la source map… mise en ligne après l'erreur » ; Datadog propose Parsed/Raw et Unminified/Minified (`newerrortrackingimage.png`) sans dire pourquoi une stack reste minifiée.
- **« env dev (déclaré) : pas une vérité de déploiement »** (L50) et « Source et caractère géré sont ceux du dernier exemplaire, pas une moyenne du groupe » (page L156).
- **Liens seulement vers ce qui existe dans la même app**, identifiants émis par le client revérifiés à destination (`error-view.ts` L80-95) ; noms accessibles distincts par occurrence (`ErrorOccurrences.tsx` L124-126).
- **Ambiguïté d'empreinte résolue par un choix explicite, jamais un tirage** (L94-121, `GroupChooser`).
- Régression = « réapparue après résolution », vérifiable (`regressed` = `last_seen > resolved_at`, `lib/queries-errors.ts` L178-179).

### (5) Plus faible
- **Le 404** (ci-dessus) : l'état « introuvable » est le seul état non francisé et non expliqué du lot.
- **Tendance sans axe, sans repère de date** : `ObservedTrend` ne trace que des barres ; Datadog dessine « errors over the past 14 days » avec axe Y et dates (`newerrortrackingimage.png`).
- **Aucune ventilation des occurrences** (par route, release, navigateur, appareil) : Datadog affiche à droite « Outliers / Distribution » par View Name et Browser Name avec pourcentages. Ici les cent lignes portent route/release/appareil mais rien ne les compte.
- **Pas de « première / dernière version touchée »** dans le détail historique (la release n'apparaît que sur le dernier exemplaire et par ligne) — Datadog l'affiche en tête (« The last version impacted was… The first version impacted was… »).
- **Pas d'accès direct au replay** en tête : « Jump to Replay » est un bouton de premier niveau chez Datadog ; ici un lien par occurrence.
- **Sept tuiles en une rangée** à ≥ 1280 px (`xl:grid-cols-7`) : dates et pourcentages en 18 px dans des colonnes étroites — non vérifié par capture (404), déduit de la grille L170.
- Stack en `<pre>` sans frame cliquable ni distinction frames applicatives / tierces.

### (6) Déjà disponible, non affiché
- `ErrorImpact.session_coverage` (`lib/queries-errors.ts` L161) : seule `identity_coverage` a sa tuile.
- `ErrorOccurrenceRow.is_fatal`, `view_name`, `env`, `service` (L274-277) : absents de la table.
- `ErrorExemplar.action_id`, `is_fatal`, `service` (L228-251).
- `group.resolved_at` (L177) : la barre de triage ne date pas la résolution.
- Les 100 occurrences chargées permettent une ventilation route / release / appareil **côté page**, à condition d'écrire « sur les 100 occurrences affichées » (ce n'est pas la population).
- Mode issue : `first_release` / `last_release` sont rendus ; `IssueCoverage` (L219-231) n'a pas de rendu dans le détail.

---

## 05 — Frustration (`/ux`, `app/ux/page.tsx`, capture `05-ux-frustration.png`, 1440 × 1270)

### (1) Question
« Signaux d'agacement et d'échec : rage clicks, dead clicks, actions suivies d'une erreur, interactions lentes et scripts qui bloquent le fil principal. » (L33) — autrement dit : où les visiteurs s'agacent, quel élément est lent, quel code tient le fil principal.

### (2) Mise en page réelle
1. En-tête (L31-34).
2. **Hero** (L36-85) : Rage clicks = 0 (vert), Dead clicks = 0, Error clicks = 14 (rouge), Élément le plus lent = 50 ms « #btn-nav-list » ; à droite nuage « Éléments lents à l'INP — fréquence × latence », deux points (y ≈ 265-690).
3. **Signaux de frustration** (L87-112) : Type / Cible / Route / Occurrences, deux lignes `error · action · /partners · 12` et `error · action · / · 2` (y ≈ 715-860).
4. **Interactions lentes — éléments responsables (attribution INP)** (L114-141) : Élément / Interactions / INP p75 / Pire, deux lignes (y ≈ 890-1040).
5. **Scripts qui bloquent le fil principal (Long Animation Frames)** (L146-200) : Script (fichier + hôte) / Fonction / Frames / Blocage cumulé / Pire, une ligne, puis la note « Classé par blocage cumulé, pas par pire cas » (L201-205) (y ≈ 1070-1235).

Tout tient au-dessus du pli à 1440 × 1270. Pas de capture 390 px ; les trois cartes de tables sont `overflow-hidden` (L88, L117, L149) et non `overflow-x-auto` — le débordement à 390 px est **non vérifié**, et le choix de classe laisse craindre une coupe plutôt qu'un défilement.

### (3) Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Nuage | `components/charts/ScatterPlot.tsx` L38-118 (recharts) : X = nombre d'interactions, Y = INP p75, taille = pire cas (`ZAxis` L89), couleur = `rating2026("INP")` ; tooltip maison L90-109 | par `attribution->>'interactionTarget'` : count, `percentile_cont(0.75)`, `max`, 20 lignes triées par p75 | `inpOffenders(f)` (`lib/queries-frustration.ts` L52-72) | Vide : « Aucune interaction lente sur 7 j. » (L65). Pas d'alternative textuelle (la table du § 4 en tient lieu de fait, sans le dire). Points non étiquetés, non cliquables. |
| Tuiles | `HeroStat` | sommes de `n` par `kind` (L25-27) ; élément le plus lent = p75 max | `topFrustrations(f)` (L19-39 : `rum_event` `frustration.rage/dead/error`, groupé route + cible, 50 lignes) | Tons : rage > 0 rouge, dead > 0 orange, error > 0 rouge (L69-71). |
| Signaux | table + `KindChip` (L210-222) | occurrences par (type, cible, route) | idem | Vide : « Aucun signal sur 7 j » (L234-241). |
| Attribution INP | table + `InpCell` (L224-232, pastille de rating) | n, p75, pire | `inpOffenders` | « — » si null ; vide « Aucun signal sur 7 j ». |
| Scripts | table, `decouperUrlScript` (fichier en évidence, hôte dessous, L163-176) | `sum(coalesce(blocking_ms, duration_ms))`, `max`, count par (script_url, fonction/invoker), 20 lignes | `scriptsBloquants(f)` (L105-126) | Vide : « Aucun blocage attribué sur 7 j. L'API Long Animation Frames n'existe que sur Chromium… » (L189-197). |
| Échec de lecture | — | — | `softFail(e, [])` sur les trois lectures (L36-38, L69-71, L123-125) ; pas de `error.tsx` | **Un échec se rend comme « Aucun signal »**. |

### (4) Meilleur que Datadog (à conserver)
- **Du symptôme au code** : élément (`interactionTarget`) → script → fonction/invocation, avec la justification du classement par cumul : « un script qui bloque 400 ms une fois est un incident, un script qui bloque 60 ms à chaque frappe est le problème — et c'est le second qui décide de l'INP » (L201-205 ; `lib/queries-frustration.ts` L87-104). La documentation Datadog des signaux de frustration liste rage / dead / error clicks, un tableau de bord dédié et des tags dans le replay (https://docs.datadoghq.com/real_user_monitoring/browser/frustration_signals/) ; l'attribution d'INP à un script n'y figure pas — **non établi** qu'elle existe ailleurs chez Datadog.
- **Nuage fréquence × latence coloré par seuil** : « ceux en haut à droite sont à la fois fréquents et lents — à corriger en priorité » (L79-81) — une priorisation, pas une liste.
- **Chromium-only dit à l'écran** ; `blocking_ms` préféré à `duration_ms` avec la raison (L96-99).

### (5) Plus faible
- **Les définitions manquent** : rien à l'écran ne dit ce qu'est un rage click ou un dead click pour ce SDK (Datadog écrit « more than three times in a one-second sliding window », « static element that produces no action »). Seuils du SDK MIP : **non établi** (non lu dans ce lot).
- **Aucune dimension temporelle** : ni série des signaux, ni tendance ; `topFrustrations` n'a pas de seau. Datadog a un « Frustration Signals Dashboard » avec les pages les plus touchées (doc citée).
- **Points muets** : avec deux points, on ne sait pas lequel est `#btn-nav-list` sans survoler ; pas de `LabelList`, pas de lien depuis un point vers l'élément ou les sessions.
- **Signaux sans sessions** : « Occurrences » seulement ; le nombre de sessions concernées demande une requête, mais le rapport occurrences/sessions est ce qui distingue un visiteur qui s'acharne de dix visiteurs bloqués.
- **Silence sur l'échec** (fail-soft sans frontière d'erreur, § 3).
- **Trois tables non liées** : l'élément `#btn-nav-list` de l'attribution INP et la cible `action` des signaux ne se rejoignent pas ; aucune route dans la table d'attribution.
- Le widget d'avis masque le compte de la seconde ligne à 1440.

### (6) Déjà disponible, non affiché
- `FrustrationRow.route` par type : un cumul rage + dead + error **par route** se calcule côté page sur les lignes reçues → `RankBar` « routes les plus frustrantes » sans requête.
- `InpOffender.worst` est déjà la taille des bulles et la colonne « Pire » ; `n` et `p75` pourraient étiqueter les points (`label` est dans `ScatterPoint`, L23).
- `ScatterPlot` accepte `xUnit`/`yUnit` ; l'axe X n'a pas d'unité (« Interactions » en libellé seulement).
- `ScriptBloquant.quoi` distingue fonction et invoker mais l'écran ne dit pas lequel des deux est affiché.

---

## 06 — Actions (`/actions`, `app/actions/page.tsx`, capture `06-actions.png`, 1440 × 1029)

### (1) Question
« Interactions qui déclenchent le plus d'erreurs ou de temps réseau. La corrélation est heuristique, bornée à 5 secondes et figée au départ de chaque effet. » (L41).

### (2) Mise en page réelle
1. En-tête (L39-42).
2. **Trois tuiles** locales `Stat` (L44-48, L118-125) : Actions · 7 j = 66, Erreurs liées = 14 (rouge), Temps lié = 0 ms (y ≈ 265-350).
3. Bandeau d'échantillonnage si `min(sample_rate)` < 1 (L50-54) — absent.
4. **Table** (L56-101, `table-fixed` avec `colgroup` ≈ 1 024 px) : Action (nom, chip « clic / manuelle », app), Route, Actions, Sessions, Erreurs, Ressources, API, Temps lié, Dernière vue ; quatre lignes (y ≈ 375-730).
5. Pagination Précédentes / Suivantes (L108-113) — vide ici.

Aucun graphique. L'écran tient dans 1 029 px ; la moitié basse est vide.

### (3) Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Tuiles | `Stat` local (L118-125) — pas `HeroStat` | `count(*)` actions, `sum(errors)`, `sum(resource_ms + api_ms)` sur toute la période filtrée | `topActionsSummary(f)` (`lib/queries-actions.ts` L202-234) | **Table `rum_action` absente → zéros** (L203-207, `actionsDisponible` L52-58) : « Non collecté » se lit « 0 ». Ton rouge dès une erreur (L46). |
| Table | table HTML, `N` (L127-129, rouge si `danger`) | par (app, nom, type, route) : actions, sessions distinctes, erreurs, ressources, appels API, temps lié, dernière vue ; 50 par page, offset ≤ 10 000 (`ACTIONS_MAX_OFFSET` L6) | `topActions(f, page)` (L175-199) | Vide : « Aucune action causale sur 7 j. » (L102-106). Route null → « (inconnue) » (L89). |
| Notice | `<p role="note">` (L50-54) | — | `actionSamplingNotice` (L238-246 : « Vue de l'échantillon observé (taux minimal X %). Les volumes ne sont pas extrapolés et les sessions en erreur peuvent être sur-représentées. ») | — |
| Frontière | `app/actions/error.tsx` L3-19 | — | — | « Actions indisponibles — Les agrégats causaux n'ont pas pu être chargés. Les données collectées ne sont pas modifiées. » + Réessayer. |

### (4) Meilleur que Datadog (à conserver)
- **La limite de la méthode est dans le sous-titre** (heuristique, 5 s, figée au départ de chaque effet) — Datadog présente ses actions dans la chronologie de session avec « Open Action waterfall » (`scratchpad/datadog/240523-rum-product-page-triageresolve-v01-t2.png`) et une série « Actions per session » (`newoptimizeperformanceimage.png`) ; sa règle de rattachement action → erreur n'est pas écrite à l'écran (**non établi** au-delà de ces images).
- Avertissement d'échantillonnage qui nomme le biais (sessions en erreur sur-représentées).
- Frontière d'erreur en français qui dit ce qui n'est pas touché.

### (5) Plus faible
- **Aucun graphique** sur un écran dont la question est un classement : un `RankBar` « actions par erreurs liées » (barres empilées erreurs / ressources / API) est le composant déjà écrit pour cela.
- **« Temps lié » est un cumul de millisecondes de visiteurs différents** (66 actions → « 0 ms » ici, mais des secondes en production) : c'est exactement ce que `LongtasksView` refuse d'afficher (« n'est le temps perdu de personne », `components/LongtasksView.tsx` L4-9). Deux écrans, deux doctrines. À trancher : p75 du temps lié par action, ou cumul avec sa mention.
- **Pas de drill** : le nom d'action n'ouvre ni les sessions, ni les erreurs qu'il déclenche ; le chemin inverse existe (« Action « … » » dans les occurrences d'erreur, `ErrorOccurrences.tsx` L144-148) mais pas celui-ci.
- **Zéros au lieu de « Non collecté »** quand la table est absente (§ 3).
- **Composant `Stat` local** au lieu de `HeroStat` / `SupervisionHero` : le seul écran du lot hors du gabarit commun (pas de phrase de lecture).
- Colonnes « Ressources » et « API » sont des comptes ; leurs durées (`resource_ms`, `api_ms`) existent mais seul le total est montré.
- Pas de tendance, pas de comparaison à la période précédente.

### (6) Déjà disponible, non affiché
- `TopActionRow.error_clicks`, `resource_ms`, `api_ms` (`lib/queries-actions.ts` L15-20) → distinguer « erreurs » de « clics suivis d'une erreur », et scinder le temps lié ressources / API.
- `ActionSummary.sessions`, `error_clicks`, `resources`, `api_calls`, `resource_ms`, `api_ms` (L26-33) → tuiles « Sessions avec action », « Appels API liés ».
- `TopActionRow.type` (« clic / manuelle ») pourrait être un filtre.

---

## 07 — Événements (`/events`, `app/events/page.tsx`, capture `07-events.png`, 1440 × 1737)

### (1) Question
« Explorer les événements custom observés sur 7 j, sans extrapolation du sampling. » (L59) — quels événements, avec quels attributs, dans quelle session.

### (2) Mise en page réelle
1. En-tête (L57-60).
2. **Formulaire GET** (L62-101, `lg:grid-cols-6`) : Nom d'événement (datalist des 20 noms les plus fréquents), Source attribut (props / context), Clé, Type (string / number / boolean / null), Valeur exacte (datalist), Appliquer / Réinitialiser (y ≈ 265-390).
3. Bandeaux : enrichissement indisponible (`role=status`, L103-107), échantillonnage (`role=note`, L108-112) — absents.
4. **Grille 2fr / 1fr** (L114-134) : « Événements observés dans le temps » (`ObservedTrend`, 28 barres sans étiquette d'axe) ; à droite « Total observé 14 » et « Attributs fréquents » (`props.count` 14, `props.target` 14) (y ≈ 415-655).
5. **Table** (L136-159) : Événement (+ app), Route, Attributs scrubbed (« ▸ Voir le contexte » → JSON), Session (lien 8 car.), Date ; 14 lignes `frustration.error` (y ≈ 680-1690).
6. « Événements suivants » par curseur (L166-168) — absent.

Au-dessus du pli : formulaire, tendance, total ; la table commence à ≈ 680 px. Le paramètre `kind` est forcé à `event` (L35) : l'écran ne montre que les événements custom (ici les `frustration.*` émis par le SDK).

### (3) Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Formulaire | `<form method="get">`, `INPUT_CLASS` (`components/forms/Field`), champs cachés du contrat (L64-66) | — | `parseEventQuery` (`lib/queries-events.ts` L143-151), facettes `names` / `values` | Filtre invalide : `role=alert` « Filtre invalide. Les noms sont bornés à 100 caractères ; une facette exige une source, une clé sûre, un type primitif et une valeur exacte. » (L42-52). |
| Tendance | `components/charts/ObservedTrend.tsx` L15-59 | `count(*)` par seau, seaux vides à 0 (L336-346) | `exploreEvents` → `trend` | Barres à 2 % sans donnée ; table repliée « Période / Événements ». |
| Total + facettes | `<aside>` (L120-133) | `count(*)` de la population filtrée ; attributs (source, clé, count) sur les 30 clés primitives les plus fréquentes (L355-371) | idem | « Aucune facette primitive. » (L131). |
| Table | table HTML (L137-159) | 50 lignes (défaut `parsePagination`) triées `ts desc, id desc` ; JSON `{ props, context }` en `<pre>` ≤ 13 rem | `exploreEvents` (L284-404, transaction `repeatable read read only`, L310-313) | Vide : « Aucun événement ne correspond à ces filtres sur 7 j. » (L160-164). Route « — », session « — » (L147, L153). |
| Diagnostics | bandeaux | — | `schemaStatus` (L182-189) : « migration v65 absente : projection d'événements indisponible » ; « migration v68 absente : journal P1 disponible, tendances et facettes désactivées » (L296-305) | Partiel avec raison — invariant respecté. |
| Frontière | `app/events/error.tsx` | — | — | « Impossible de charger les événements — La requête est restée bornée et aucune donnée partielle n'est affichée. » |

### (4) Meilleur que Datadog (à conserver)
- **« scrubbed » est dans l'en-tête de colonne** et le JSON est ce qui a été retenu, pas ce qui a été reçu ; « sans extrapolation du sampling » dans le sous-titre ; avertissement qui nomme le biais (L191-199 des requêtes).
- **Un seul instantané** pour journal, total, tendance et facettes (L310-313) : un total qui ne peut pas contredire la liste.
- **Partiel dit avec sa raison** (migration manquante) au lieu d'une tendance vide.
- Formulaire GET : l'URL est la requête, partageable ; datalists alimentées par les facettes réelles.
- Le RUM Explorer Datadog (`scratchpad/datadog/datadog-rum-views-explorer.png`) montre un JSON d'attributs avec « Search for / Exclude / Add column » — nous avons le JSON, pas les actions (voir § 5).

### (5) Plus faible
- **La facette la plus utile n'est pas dessinée** : `facets.names` (20 noms + comptes) ne sert qu'une datalist invisible tant qu'on ne tape pas. Datadog affiche les facettes à gauche avec leurs comptes, cliquables.
- **Attributs fréquents non cliquables** : une clé listée ne devient pas un filtre en un clic ; il faut ressaisir source, clé, type, valeur.
- **Tendance sans axe des temps** : 28 barres, aucune date lisible sans déplier l'alternative (`07-events.png` y ≈ 460-610) ; Datadog date son histogramme.
- **Quatorze « Voir le contexte » repliés** : les clés communes (`props.count`, `props.target` présentes 14/14 d'après les facettes) devraient être des colonnes.
- **Pas de regroupement** (nom × route) — c'est le rôle de l'Explorer, mais rien ne renvoie vers lui avec le filtre courant.
- Formulaire à six colonnes où le type par défaut « string » s'applique même sans clé (L86) ; ce que fait une valeur saisie sans clé : **non établi** (`parseEventAttribute` non lu).
- Le widget d'avis masque une date à 1440.

### (6) Déjà disponible, non affiché
- `facets.names` (`EventNameFacet`, L60) → `RankBar` des événements par nom, avec lien qui pose `name=`.
- `facets.values` (L62) → chips de valeurs sous le champ « Valeur exacte ».
- `EventIndexRow.device_type`, `kind`, `source_name` (L44-57) : absents de la table.
- `trend[].bucket` (dates) → étiquettes d'axe ; `ObservedTrend` les a dans `title` seulement (L37).
- `sampling_notice.min_sample_rate` (nombre) n'est rendu que par sa phrase.

---

## 08 — Explorer (`/explorer`, `app/explorer/page.tsx`, capture `08-explorer.png`, 1440 × 1029)

### (1) Question
« Composer une mesure bornée sur 7 j, puis l'exécuter. Aucune requête n'est lancée avant. » (L147-148) — jeu × mesure × agrégation × (2 dimensions) × représentation, puis enregistrer comme carte ou vue.

### (2) Mise en page réelle (capture = état avant exécution)
1. En-tête (L145-149).
2. **Navigation des jeux** (L150-166, liens, pas un `<select>` — raison L9-12) : Événements custom, Erreurs, Pages vues (actif), Sessions, Web Vitals, Ressources, Tâches longues, Actions, Appels tracés (y ≈ 265-295).
3. **Constructeur** `<form method="get">` (L168-260, `lg:grid-cols-4`) : Mesure (« Nombre — Pages vues »), [Propriété numérique], [variante du jeu], Grouper par, Puis par (« Aucun regroupement », options indisponibles désactivées avec « — indisponible » et `title` L228-233), Représentation (Valeur unique / Classement / Série temporelle / Journal, `VISUALIZATION_LABELS` `lib/analytics-schema.ts` L76-81), [Nombre maximum selon la représentation, `LIMITES` L73], Exécuter / Réinitialiser (y ≈ 310-495).
4. **Invite** (L282-286) : « Rien n'a encore été mesuré. Composez la requête ci-dessus puis choisissez « Exécuter ». » (y ≈ 520-620).
5. Reste de l'écran vide (≈ 400 px).

**Avec un résultat** (`Resultat` L315-580) : « Requête appliquée — … » (`explorerResume`, `lib/explorer-page-params.ts` L157-191) ; bandeaux « Résultat partiel : … rétention » (L356-359), « D'autres combinaisons existent au-delà des N affichées. Le total, lui, porte sur toute la population. » (L360-364), avertissements du jeu (L365-369 ; ex. erreurs « échantillonnage biaisé… jamais extrapolés », `lib/analytics-schema.ts` L299-303 ; Web Vitals « CLS et INP sont rapportés une fois par chargement de page », L400-403 ; pages vues « Aucun temps passé n'est dérivé de ces vues », L322) ; grille 1fr / 2fr : à gauche « Total observé », unité · ce qui est compté · « valeur approchée », Lignes de population, Largeur de seau, Agrégation additive oui/non, Source « lignes brutes / agrégat + lignes » (L371-401) ; à droite la représentation : phrase pour « Valeur unique » (L411-415), `RankBar` pour « Classement » (L416-426), un `ObservedTrend` **par groupe** pour « Série temporelle » (`Series` L583-605), `Journal` paginé à projection fermée (L607-637) ; puis « Enregistrer cette analyse » (carte de tableau de bord avec révision et option « Figer la fenêtre », vue personnelle, JSON canonique) et « Colonnes disponibles ».

### (3) Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Constructeur | form + `INPUT_CLASS` | plan validé par `parseExplorerPlan` (`lib/analytics-schema.ts`) : agrégations count / sum / avg / p75 / p95 / distinct (L62), ≤ 2 dimensions, ≤ 50 combinaisons (`MAX_GROUPS` L51), journal ≤ 200 lignes (L54) | `dimensionSupport` par jeu (bloc `dimensions` de la page) | Plan refusé : `role=alert` « Requête refusée » + message + code (L274-280). |
| Exécution | `exploreAnalytics` (`lib/queries-explorer.ts` L229-340) : une transaction `repeatable read`, `statement_timeout` 5 s (`EXPLORER_TIMEOUT_MS` L80) | total, groupes, série, journal | — | « Budget de lecture dépassé … Aucun chiffre n'est affiché : une série de zéros se lirait comme une absence de trafic. » (L123-127) ; « Dimension non applicable » (L128). |
| Total | `<aside>` (L371-401) | `data.total` (null → « — », fonction `nombre`), `meta.counting`, `meta.approximate`, `meta.additive`, `meta.source` | `ExplorerMeta` (`lib/queries-explorer.ts` L103-137) | Couverture partielle (rétention) et troncature dites (L356-364). |
| Classement | `RankBar` (L416-426), sous-texte « n lignes » | valeur par groupe | `data.groups` | « Aucun groupe sur la fenêtre. » |
| Série | `ObservedTrend` × groupes (L583-605) | valeur par seau, **null rendu 0** avec la valeur réelle dans la table (L588-590) | `data.series` | — |
| Journal | table (L607-637), colonnes déclarées du jeu, « — » pour null (L639-644) | 50 → 200 lignes | `data.rows`, curseur | « Lignes suivantes » (L438-444). |
| Population vide | (L406-409) | — | — | « Aucune ligne ne correspond… Ce n'est pas une erreur : la population est réellement vide. » |
| Frontière | `app/explorer/error.tsx` | — | — | « Impossible d'exécuter cette requête — Aucun chiffre partiel n'est affiché ». |

### (4) Meilleur que Datadog (à conserver)
- **Exécution explicite et URL = requête** (L3-7) ; Datadog interroge à chaque changement (`rum-db-new-t2.png` : liste et histogrammes déjà remplis).
- **Chaque résultat dit ce qu'il compte** (« counting »), s'il est additif, s'il est approché, d'où il vient (agrégat + lignes) et pourquoi il est partiel (rétention) ou tronqué (« Le total, lui, porte sur toute la population »). Rien de tel sur le RUM Explorer Datadog lu.
- **Un budget qui refuse les zéros** plutôt qu'une série vide (`lib/queries-explorer.ts` L10-14).
- **Dimensions indisponibles visibles avec leur raison** ; enregistrement de l'AST seul, « rejouée avec les droits de son lecteur », révision de tableau de bord vérifiée (L471-478), figer la fenêtre seulement en plage personnalisée (L493-498).
- Avertissements de jeu propagés jusqu'à la carte.

### (5) Plus faible
- **Invite nue** : aucune requête d'exemple, aucun résultat par défaut ; Datadog ouvre sur « View count » + « Page loading time distribution » (p50/p75/p90/p95) et une liste.
- **Séries par groupe non comparables** : chaque `ObservedTrend` normalise sur son propre maximum (L25) ; cinq groupes = cinq mini-graphiques dont la plus haute barre vaut toujours 100 % — l'œil compare des échelles différentes. Pas de superposition, pas de légende, pas d'axe commun. `StackedBars` / `LineTrend` existent et savent superposer.
- **Aucune représentation « Distribution »** alors que `Histogram` (`components/Distribution.tsx`) et les agrégations p75/p95 existent ; pas de « Geomap » alors que la dimension pays existe ; Datadog propose List / Timeseries / Top List / Table / Distribution / Geomap / Funnel (`rum-db-new-t2.png`).
- **Série sans axe des temps** (même défaut que `/events` et le détail d'erreur).
- **Classement sans lien de drill** ni couleur de seuil pour les vitals.
- « Valeur unique » rend une phrase qui répète le total de la colonne de gauche (L411-415).
- Les raisons d'indisponibilité d'une dimension ne sont qu'en `title` de `<option>` (L231) : illisibles au clavier et au tactile.

### (6) Déjà disponible, non affiché
- `meta.rollup.reason` (« pourquoi l'agrégat n'a pas servi », `lib/queries-explorer.ts` L17-20, L129) : seule la source est affichée (L398).
- `meta.effective_apps` (L112) : le périmètre effectif n'est pas dit.
- `ExplorerPoint.start / end` (L98-101) → étiquettes d'axe ; `meta.range.bucket_seconds` est rendu dans la colonne de gauche.
- `ExplorerGroup.samples` par point de série : perdu dans `Series` (seule `value` est transmise, L590).
- `AGGREGATION_LABELS` p95 et `distinct` sont proposés ; la représentation ne colore pas selon `rating2026` quand le jeu est Web Vitals et la mesure `value` (le nom de métrique est dans la clé de groupe).

---

## Synthèse transversale (ce qui vaut pour tout plan qui suit)

**À garder tel quel** (c'est l'identité du produit) : le triptyque « chiffres · graphe · phrase de lecture » de `SupervisionHero` ; « Inconnu » ≠ 0 partout ; les avertissements d'échantillonnage avec la probabilité d'inclusion et sans extrapolation ; les découpages avec troncature et onglets indisponibles motivés ; les notices de provenance (pays estimé, release par mesure, ressources retenues, LoAF/Long Tasks) ; les frontières d'erreur qui refusent le partiel ; les blocs indisponibles avec raison ; le français, les bulles Technique / Stack / En clair.

**Ce que Datadog fait et que le lot ne fait pas** (sources : images `scratchpad/datadog/*.png`, pages docs citées) : trois Core Web Vitals en séries côte à côte sur fond de seuils ; un histogramme de distribution avec repères de percentiles ; des facettes latérales à comptes cliquables ; « affecting N sessions » en tête d'une erreur ; « first / last version impacted » ; ventilation d'une erreur par vue / navigateur ; « Jump to Replay » de premier niveau ; cascade par vue ; représentations Distribution / Geomap / Funnel dans l'explorateur ; « Watchdog insights » (anomalies) sur l'explorateur.

**Corrections de vérité avant tout chantier de graphique** :
1. Seuils LCP : `app/page.tsx` L182 et `lib/glossary.ts` L26 contredisent `lib/rating.ts` L6.
2. Taux d'erreur « 0 % » sans page vue (`app/page.tsx` L98) → null.
3. Actions : table absente → « Non collecté », pas 0 (`lib/queries-actions.ts` L203-207).
4. Fail-soft sans frontière (`/`, `/pages`, `/ux`) → un `error.tsx` par route, et distinguer « vide » de « la lecture a échoué ».
5. Alternative textuelle pour `VitalsTimeseries`, `TrafficTimeseries`, `ScatterPlot` (et étiquettes d'axe pour `ObservedTrend`).
6. `not-found.tsx` en français pour `/errors/[fingerprint]` et `/errors/issues/[id]`.
7. Le widget « Votre avis ? » ne doit pas recouvrir la dernière colonne des écrans de données.
8. « Temps lié » (`/actions`) : aligner sur la doctrine de `/pages` (pas de cumul de millisecondes présenté comme du temps vécu), ou l'annoncer.

**Graphiques réalisables sans nouvelle requête** (données déjà renvoyées) : décomposition réseau du TTFB (barres empilées `RankBar`), séries INP/CLS (`vitalSeries(name)`), histogrammes FCP/TTFB, deuxième axe p75 des blocages, classement des actions par erreurs liées (barres empilées erreurs / ressources / API), routes les plus frustrantes (cumul côté page), toplist des noms d'événements (`facets.names`), tuile « Sessions touchées » du hero d'erreurs (`totals`), étiquettes d'axe sur toutes les `ObservedTrend`.

**Non établi dans ce lot** : les seuils rage/dead click du SDK MIP ; le comportement du formulaire d'événements avec une valeur sans clé ; le rendu réel de `/ux` et `/actions` à 390 px ; l'existence chez Datadog d'une attribution d'INP au script ; la raison pour laquelle la capture 04 vise l'empreinte `501bd6d3`.
