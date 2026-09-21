# Lecture des écrans de la console — lot 2 (09 → 16)

Écrans : 09-experience, 10-mobile, 11-sessions, 12-session-detail, 13-acquisition, 14-retention, 15-paths, 16-forms.
Console : `apps/console` (Next.js 15, rendu serveur). Chemins ci-dessous relatifs à `/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM/apps/console` sauf mention contraire.

## 0. Méthode, sources, limites de cette lecture

- Captures lues : `scratchpad/console/09-experience.png` … `16-forms.png`, toutes à 1440 px de large, sur les données de démo locales (app « Mini-site de démo », preset 7 j, segment « tous les visiteurs », bots exclus). Aucune capture `-dark` ni `-390` n'existe pour ce lot (`ls scratchpad/console/ | grep -E "^(09|1[0-6])-"` ne rend que les huit fichiers de base) : le rendu sombre et la largeur 390 px sont **non établis** ici, sauf ce que le code dit (§ 1.6).
- Code lu en entier : les huit `page.tsx`, `app/mobile/loading.tsx`, `app/mobile/error.tsx`, `lib/queries-experience.ts`, `lib/experience.ts`, `lib/rating.ts`, `lib/queries-mobile.ts`, `lib/mobile-capabilities.ts`, `lib/queries-sessions.ts`, `lib/sessions.ts`, `lib/sessions-search.ts`, `lib/engagement.ts`, `lib/queries.ts` (L303-642), `lib/queries-acquisition.ts`, `lib/acquisition.ts`, `lib/queries-cohorts.ts`, `lib/cohorts.ts`, `lib/queries-paths.ts`, `lib/paths.ts`, `lib/sankey.ts`, `lib/queries-funnel.ts`, `lib/funnel.ts`, `lib/queries-form-analytics.ts`, `lib/form-analytics.ts`, `lib/surfaces.ts`, `lib/page-filters.ts`, `lib/dashboard-blocs.ts`, `lib/timeline-constants.tsx`, `components/charts/{RadarScore,LineTrend,Donut,ObservedTrend,RankBar}.tsx`, `components/{Sankey,Funnel,SupervisionHero,ExperienceUnavailable,PageHeader}.tsx`, `components/sessions/{Timeline,TabLink}.tsx`, `components/replay/ReplayPlayer.tsx`.
- Références Datadog : images du dossier `/Users/juliantalou/Downloads/datadog screenshots and videos ` converties en PNG dans `scratchpad/plan/tmp-dd/` (`datadog-rum-views-explorer.png`, `newoptimizeperformanceimage.png` = tableau de bord « RUM - User Sessions », `newrumperformanceimage.png` = « RUM - Performance Overview », `enhanceenduserimage.png` = résultat Synthetics lié à une session RUM, `dd_platform.png` = schéma plateforme) ; extraits de documentation déjà déposés dans `scratchpad/plan/reads/raw/*.md` ; pages consultées en ligne : https://docs.datadoghq.com/product_analytics/ , https://docs.datadoghq.com/real_user_monitoring/session_replay/browser/privacy_options/ , https://docs.datadoghq.com/real_user_monitoring/application_monitoring/android/mobile_vitals/ , https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/performance/ . Les pages Pathways / Funnels / Retention de Product Analytics ont répondu 404 aux adresses essayées : ce que Datadog affiche exactement sur ces trois écrans est **non établi** au-delà de la phrase de présentation de la page d'accueil Product Analytics et de l'extrait `raw/real_user_monitoring_explorer_visualize.md` (§ Funnels, L101-128).
- Les deux vidéos `.mp4` du dossier Datadog n'ont pas été lues (pas d'outil d'extraction d'images ici) : **non établi**.

## 1. Ce qui vaut pour les huit écrans

### 1.1 Deux générations de requêtes, deux comportements de filtre

| Écrans | Couche de lecture | Plage | Filtres de dimension | Preuve |
|---|---|---|---|---|
| `/experience`, `/mobile`, `/sessions` | contrat P6.2 : `sqlContext` / `queryOf`, fenêtre `[from, to)` liée, seaux dérivés | presets + personnalisée ≤ 30 j | dimensions du compilateur (route, session, release, os, pays, …) | `lib/surfaces.ts:73-77, 86, 89` (`range: "custom"`) ; `lib/queries-experience.ts:23-24` ; `lib/queries-mobile.ts:236-241, 256-258` ; `lib/queries.ts:364-365` |
| `/acquisition`, `/retention`, `/paths`, `/forms` | historique : `now() - interval '<PERIODS>'`, `$1` app, `$2` device desktop/mobile, segment v1 | presets 1 h / 24 h / 7 j seulement | `device`, `country`, `country_source`, `client`, `source` (liste `LEGACY_DIMENSIONS`) ; ni « Inconnu » ni tablette | `lib/surfaces.ts:119-123` (`range: "presets", legacy: "segments"`) ; `lib/surfaces.ts:46, 168-176, 179-184` ; `lib/queries-acquisition.ts:21-23` ; `lib/queries-paths.ts:32-34` ; `lib/queries-funnel.ts:31-33` ; `lib/queries-form-analytics.ts:21-24` ; `lib/queries-cohorts.ts:34-36` |

Ce que cela garantit : une URL qui demande une plage personnalisée ou la tablette sur un écran historique est **refusée** avec un message typé (`checkSurface`, `lib/surfaces.ts:196-206` ; messages L174, L182, L188) et la page rend `FilterProblemNotice` (chaque `page.tsx`, ex. `app/acquisition/page.tsx:37`). Aucun chiffre n'est calculé en ignorant un filtre. Ce que cela ne garantit pas : la fenêtre des quatre écrans historiques est `now() - intervalle` au moment de la requête, pas la fenêtre `[from, to)` du contrat ; deux onglets voisins (« Sessions » et « Acquisition ») peuvent donc dire « 7 j » avec deux bornes légèrement différentes. **Conséquence pour le plan** : toute reconception de ces quatre écrans qui ajoute une plage personnalisée, une dimension (route, navigateur, release) ou une comparaison de période exige une migration de leurs requêtes vers le contrat — ce n'est pas « sans changement backend ».

### 1.2 États chargement / erreur / partiel

- Seul `/mobile` a un `loading.tsx` (squelette à la taille des cartes, `aria-busy`, `role="status"` sr-only : `app/mobile/loading.tsx:7-9`) et un `error.tsx` (`role="alert"`, bouton « Réessayer » branché sur `reset`, aucune mesure partielle : `app/mobile/error.tsx:5-15`).
- Les sept autres routes n'ont ni `loading.tsx` ni `error.tsx` (`ls app/experience app/sessions app/sessions/[id] app/acquisition app/retention app/paths app/forms`), et `app/` ne contient que `layout.tsx` et `page.tsx` : une exception SQL remonte à la frontière d'erreur par défaut de Next. Ce qui s'affiche alors est **non établi** (pas reproduit). L'invariant « erreur avec réessai » n'est tenu que par `/mobile`.
- `/sessions` va plus loin dans le mauvais sens : `engagementStats` et `observedVisitorsTrend` avalent l'erreur (`softFail`, `lib/queries-sessions.ts:45-47, 92-94`) et rendent respectivement `ENGAGEMENT_VIDE` et `[]`. Une base injoignable se lit alors « 0 session(s) avec au moins une page vue … il en faut 30 » (`app/sessions/page.tsx:248-251`) — un message de données insuffisantes à la place d'une erreur.
- « Partiel avec raison » n'existe que sur `/mobile` (`data.unavailable`, `app/mobile/page.tsx:77-81`, motifs `lib/queries-mobile.ts:305-327`) et pour l'échantillonnage (`sampling.message`, L82-86 ; `samplingOf`, `lib/queries-mobile.ts:280-290`). Aucun autre écran du lot ne dit s'il est échantillonné, alors que `rum_session.sample_rate` et `error_sample_rate` existent (lus par `lib/queries-mobile.ts:247`).
- Plafonds silencieux : timeline 500 lignes (`lib/queries.ts:565`), acquisition 20 000 sessions (`lib/queries-acquisition.ts:14, 25`), formulaires 5 000 événements (`lib/queries-form-analytics.ts:14, 26`), transitions 50 (`lib/queries-paths.ts:23`), entrées/sorties 15 (`lib/queries-paths.ts:54`), écrans/requêtes mobiles 10 (`lib/queries-mobile.ts:45`), verbatims 30, routes CSAT 20 (`lib/queries-experience.ts:109, 147`). Seul le Sankey annonce sa couverture (`app/paths/page.tsx:48-54`).

### 1.3 Graphiques employés dans ce lot

| Composant (fichier) | Rendu | Alternative textuelle | Utilisé par |
|---|---|---|---|
| `components/charts/RadarScore.tsx` | recharts, client (`"use client"`) | aucune (tooltip seulement, L44-47) | 09 |
| `components/charts/LineTrend.tsx` | recharts, client, ligne + barres de volume | aucune | 09 (tendance CSAT), 14 (courbe de rétention) |
| `components/charts/Donut.tsx` | SVG serveur, `role="img"`, `<title>` par arc (L78) + légende `<ul>` avec valeur et % (L92-106) | la légende | 11, 13 |
| `components/charts/ObservedTrend.tsx` | divs serveur, barres `aria-hidden` (L31), **aucun axe temporel visible** (seul un `title` par barre, L37) | `<details>` « Alternative textuelle de la série » avec date et valeur (L41-56) | 11 |
| `components/charts/RankBar.tsx` | divs serveur, valeur en bout de barre | aucune propre au composant ; `/mobile` en ajoute une (`app/mobile/page.tsx:238-256`) | 10, 16 |
| `components/Sankey.tsx` | SVG serveur 720×380 (L6-7), `role="img"`, `<title>` par ruban (L56), `min-w-[560px]` + `overflow-x-auto` (L34-36) | la table « Transitions les plus fréquentes » qui suit | 15 |
| `components/Funnel.tsx` `FunnelChart` | divs serveur, chiffres écrits (L69-79) | lui-même | 15 |
| matrice de rétention | `<table>` avec cellules colorées en `rgba` inline (`app/retention/page.tsx:136-140`) | elle-même | 14 |

Autres graphiques présents dans `components/charts/` mais non employés par ce lot (noms seulement, non lus ici) : `Gauge.tsx`, `StackedBars.tsx`, `TrafficTimeseries.tsx`, `VitalsTimeseries.tsx`, `HealthHeatmap.tsx`, `ScatterPlot.tsx`, `ForecastChart.tsx` ; plus `components/Distribution.tsx` et `components/Breakdown.tsx`.

### 1.4 Le bouton flottant « Votre avis ? »

Présent sur toutes les captures en bas à droite (la console embarque son propre widget `public/mip-rum-feedback.js`). Il recouvre du contenu : la table des capacités sur `10-mobile.png` (ligne « ANR », x≈1300-1420, y≈840-880), le Sankey sur `15-paths.png`, le graphique des visiteurs sur `11-sessions.png`. À 390 px : non établi.

### 1.5 Seuils Web Vitals

`lib/rating.ts:5-11` : LCP [2500, 4000], INP [200, 500], CLS [0.1, 0.25], FCP [1800, 3000], TTFB [800, 1800] — ce sont les seuils web.dev (le fichier le dit L1-2). Ils sont appliqués tels quels dans la timeline de session (`components/sessions/Timeline.tsx:50, 54` via `RATING_CLASS`). L'écran Expérience, lui, n'utilise **pas** `rating.ts` : voir § 2.5.

### 1.6 Rendu sombre et largeur 390 px — ce que le code dit, faute de capture

- Sankey : `min-w-[560px]` dans un conteneur `overflow-x-auto` (`components/Sankey.tsx:34-36`) → défilement horizontal interne à 390 px, pas de débordement de page.
- Matrice de rétention : `overflow-x-auto` sur la carte (`app/retention/page.tsx:109`) ; couleurs de cellule en `rgba` inline non thémées (L136-140) → contraste en sombre **non établi**.
- Tables de `/mobile` : `min-w-table` + `overflow-x-auto` (`app/mobile/page.tsx:155, 161, 261, 267`).
- Tables de `/acquisition` (L89-90), `/paths` (L83-84), `/forms` (L100-101, L139-140) et « Satisfaction par page » de `/experience` (L171-177) : `w-full` dans une carte `overflow-hidden`, sans conteneur `overflow-x-auto` → à 390 px, débordement ou troncature **non établis**.
- Détail de session : grille de métadonnées `grid-cols-2` → 4 → 8 (`app/sessions/[id]/page.tsx:81`) ; lignes de timeline en `flex-wrap` (`components/sessions/Timeline.tsx:24`) ; lecteur de replay mis à l'échelle à la largeur disponible (`ReplayPlayer.tsx:104`).
- Hero `split` : une colonne sous `lg` (`components/SupervisionHero.tsx:59`).
- Recharts (`RadarScore`, `LineTrend`) : `ResponsiveContainer width="100%"`, couleurs de grille et de texte via variables CSS thémées (`RadarScore.tsx:28-33`) ; l'accent `#f89101` et la couleur `#059669` passées en dur (`app/experience/page.tsx:163`, `app/retention/page.tsx:85`) → rendu sombre **non établi**.

---

## 2. 09 — Expérience (`/experience`)

Fichiers : `app/experience/page.tsx` (237 l.), `lib/queries-experience.ts`, `lib/experience.ts` (pur, testé : `tests/unit/experience.test.ts`, `tests/unit/experience-unavailable-page.test.ts`), glossaire `lib/glossary.ts:192-198`.

### 2.1 Question posée
« Le ressenti des utilisateurs (feedbacks) relié à la performance qu'ils ont subie » (`page.tsx:66`). Concrètement : une note /100 = performance perçue × frustration × satisfaction déclarée, puis la tendance du CSAT, le CSAT par page et les verbatims.

### 2.2 Mise en page réelle (`09-experience.png`, 1440×1029 — tout au-dessus du pli)
1. `PageHeader` avec bulle glossaire (`help="experience"`, L63-67).
2. `SupervisionHero` en `split` (L83-125) : colonne gauche = `HeroStat` « Score d'expérience » 100/100 (vert), « CSAT » —, « Réponses » 0 (« note moy. —/5 · 0 détracteur(s) »), puis `HeroReading` ; colonne droite = titre « Score d'expérience » et le grand nombre « 100 /100 — perf perçue seule — aucun feedback sur la fenêtre » (L91-97).
3. Carte « Aucun feedback sur la période. » avec le snippet `<script src="/mip-rum-feedback.js">` et la règle de silence 60 jours (L129-146).
4. Non rendus sur la capture car conditionnels : « Satisfaction dans le temps » (L149), « Satisfaction par page » (L170), « Derniers retours » (L206).

### 2.3 Widgets
| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Graphe du hero | trois formes : `ExperienceUnavailable.tsx` si score null ; grand nombre si pas de feedback ; `RadarScore.tsx` (axes « Perf perçue », « Sérénité », « Satisfaction ») si feedback (L73-99) | `experienceScore` (`lib/experience.ts:50-58`) : base = clamp(vitals − pénalité, 0, 100) ; sans CSAT → base ; avec CSAT → 0,6·base + 0,4·CSAT·100. `vitalsScore` (`page.tsx:28-34`) : LCP p75 ≤ 2000 → 100, ≤ 2500 → 82, ≤ 4000 → 55, sinon 32. `frustrationPenalty` (`lib/experience.ts:61-64`) = 2 × (rage+dead pour 1 000 sessions), plafond 20 | `experienceContext` (`lib/queries-experience.ts:54-74`) : `percentile_cont(0.75)` de `rum_metric` name='LCP' ; `count(*)` de `rum_session` ; `count(*)` de `rum_event` name in ('frustration.rage','frustration.dead') | score null → « Données insuffisantes » (`ExperienceUnavailable.tsx:2-9`), jamais une valeur neutre fabriquée (`lib/experience.ts:51-54`) |
| HeroStat Score | `HeroStat` | score ou « données insuffisantes » | idem | tone via `scoreTone` (80 / 60, `lib/experience.ts:67-71`) |
| HeroStat CSAT | `HeroStat` | positives / count, positives = score ≥ 4 (`CSAT_POSITIVE`, `lib/experience.ts:8`) | `feedbackStats` (`lib/queries-experience.ts:22-45`) sur `rum_event` name='feedback', `props->>'score'` | « — » sans réponse (L109) |
| HeroStat Réponses | `HeroStat` | `stats.count`, moyenne, détracteurs (1-2) | idem | 0 réel affiché 0 |
| Carte « Aucun feedback » | carte inline | — | `stats.count === 0` (L129) | c'est l'état vide ; snippet + `cooldownDays` |
| « Satisfaction dans le temps » | `LineTrend.tsx` (ligne % + barres volume) | `positives/count × 100` par jour UTC, volume = count ; **0 quand count = 0** (L157) | `feedbackTrend` (`lib/queries-experience.ts:83-97`), seaux 86 400 s, `limit 30` | masqué si `trend.length === 0` |
| « Satisfaction par page » | `<table>` Page / Avis / CSAT / Note moy. | CSAT coloré < 0,5 rouge, < 0,8 orange ; **0 % si count = 0** (L188) | `feedbackByRoute` (L133-150), top 20 par volume ; `route` null → « (app) » | masqué si vide |
| « Derniers retours » | `<ul>` étoiles + commentaire + route + lien « session → » | — | `recentFeedback` (L109-123), 30 derniers, commentaire déjà scrubbé PII à l'ingestion (L108) | masqué si vide |

Erreur : aucun `error.tsx` (§ 1.2). Partiel : aucun avertissement d'échantillonnage. Refus de filtre : `FilterProblemNotice` (L42).

### 2.4 Meilleur que Datadog — à conserver
- Un score **null** plutôt qu'une note neutre quand il n'y a pas de LCP (`lib/experience.ts:51-54`, testé dans `experience-unavailable-page.test.ts`). CSAT « — » et note « — » sans réponse, jamais 0 (L109, L116).
- Le pont mesuré ↔ déclaré : aucune des sources Datadog consultées (dossier d'images, `reads/raw/*.md`, pages doc citées § 0) ne décrit de collecte de satisfaction déclarée (CSAT) dans RUM ; l'existence d'un équivalent chez Datadog est **non établie**. Le widget, sa règle de silence de 60 jours et le fait que le commentaire soit scrubbé à l'ingestion sont écrits à l'écran (L139-144) — c'est de la vie privée déclarée, pas supposée.
- L'état vide dit exactement ce que le score vaut « en attendant » (« perf perçue seule », L96, L123) et donne le geste à faire.
- Verbatim → session (L222-229) : le ressenti ouvre le parcours.
- Français partout, phrases de lecture (`HeroReading`, L118-124).

### 2.5 Plus faible
- **La « perf perçue » est le seul LCP** (`page.tsx:28-34, 55`) alors que le glossaire promet « rating des vitals (p75) » et le sous-titre « Core Web Vitals » (`lib/glossary.ts:194-196`). INP et CLS n'entrent pas dans le score. Les paliers 2000 → 100 / 82 / 55 / 32 ne viennent pas de `lib/rating.ts` (qui ne connaît que 2500 et 4000) : l'invariant « seuils affichés = ceux du produit » n'est tenu qu'à moitié, et le palier 2000 n'a pas de source.
- Le hero répète le même chiffre deux fois sans feedback (capture : « 100/100 » à gauche et « 100 /100 » en grand à droite). La surface du graphe principal ne montre **aucune preuve** : ni le LCP p75, ni le taux de frustration pour 1 000 sessions, ni le nombre de sessions qui sous-tendent le score — tous calculés (`ctx.lcp_p75`, `ctx.frustration`, `ctx.sessions`) et jamais affichés.
- « Sérénité » vaut 100 quand `ctx.sessions = 0` (`ratePer1k = 0`, L53) : une inconnue habillée en note (visible seulement quand le radar s'affiche).
- La tendance CSAT trace **0 %** pour un jour où aucun avis n'est noté (L157) et la table par page affiche **0 %** pour une route qui n'a que des commentaires (L188) — deux entorses à « inconnue = null, jamais 0 ».
- Pas de tendance du score lui-même, pas de comparaison avec la période précédente (`HeroStat.delta` existe, `components/SupervisionHero.tsx:86`, jamais passé ici).
- `RadarScore` et `LineTrend` sont des composants recharts côté client sans alternative textuelle (§ 1.3) : l'invariant d'accessibilité n'est pas tenu.
- Aucun drill : une route de « Satisfaction par page » n'ouvre ni `/pages` ni `/sessions` ; la frustration n'est qu'une pénalité, sans lien vers `/ux`.
- Aucun avertissement d'échantillonnage alors que `sample_rate` existe sur `rum_session` (§ 1.2).

### 2.6 Déjà disponible côté requêtes, non affiché
- `feedbackStats.promoters / passives / detractors` (`lib/queries-experience.ts:12-19`) : seule la valeur « détracteurs » apparaît dans un sous-texte → une barre empilée 5 / 3-4 / 1-2 (`RankBar` avec `segments`, `components/charts/RankBar.tsx:9-14, 81-94`) est possible sans requête nouvelle.
- `ctx.lcp_p75`, `ctx.sessions`, `ctx.frustration` (`lib/queries-experience.ts:47-51`) : le LCP p75 (formaté par `fmtVital`), le taux rage+dead pour 1 000 sessions et le dénominateur peuvent accompagner chaque sous-score.
- `recentFeedback[].ts` (L100-106) : la date d'un verbatim n'est pas affichée.
- `feedbackTrend[].count` : affiché en barres de volume, mais un seau `count = 0` devrait devenir un trou, pas un 0 (changement côté page, pas côté requête).

---

## 3. 10 — Mobile (`/mobile`)

Fichiers : `app/mobile/page.tsx` (307 l.), `app/mobile/loading.tsx`, `app/mobile/error.tsx`, `lib/queries-mobile.ts` (541 l.), `lib/mobile-capabilities.ts` (pur), `components/charts/RankBar.tsx`. Tests : `tests/unit/rum-mobile*.test.ts`, `tests/integration/rum-mobile-p75-sql.test.ts`, `tests/e2e/mobile-console.spec.ts`. Même lecture exposée par `GET /api/v1/mobile/summary` (`app/api/v1/mobile/summary/`).

### 3.1 Question posée
« Ce que la couche JavaScript React Native observe sur 7 j — et ce qu'elle n'observe pas » (L74). La règle de l'écran est écrite en tête de fichier (L4-14) : une capacité non collectée s'affiche « Non collecté », jamais 0 ; le taux affiché est « sans erreur JS », pas « sans crash ».

### 3.2 Mise en page réelle (`10-mobile.png`, 1440×1724)
1. En-tête (y≈170-240). Sur la capture, aucun bandeau « Réponse partielle » ni note d'échantillonnage (le schéma est complet et rien n'est échantillonné).
2. Formulaire « Plateforme » (select Toutes / iOS / Android, « Appliquer », « Réinitialiser », L88-106) — un formulaire GET séparé qui **intersecte** le contrat au lieu de le remplacer (`intersectQuery` sur `os`, L54-61).
3. Quatre cartes (L109-152) : « Sessions observées » 0 ; « Visiteurs observés » **Inconnu** ; « Erreurs JavaScript » 0 (« 0 non interceptée(s), 0 rejet(s) de promesse · fatales : Inconnu ») ; « Sessions sans erreur JS » **Non calculable** (« Aucune session React Native observée sur la fenêtre : le taux n'a pas de dénominateur »).
4. Section « Ce qui est collecté, et ce qui ne l'est pas » (L155-195) : table 6 lignes (Erreurs JavaScript, Crashes natifs, ANR, Démarrage natif, Reprise hors ligne, Suivi des écrans) × colonnes Capacité (libellé + note de 2 lignes) / État (badge « Inconnu ») / Releases déclarantes (—) / Vérifié (recette) (« Jamais »). Elle occupe y≈530-1150, c'est-à-dire toute la moitié basse du pli et au-delà.
5. Grille 2 colonnes (L198-258) : « Temps JS jusqu'au premier écran » (À froid / À chaud « Non mesuré ») ; « Écrans les plus consultés » (`RankBar` vide + `<details>` alternative textuelle).
6. « Requêtes les plus lentes » (L261-295) : table Chemin / Méthode / Appels / p75 / Max / ≥ 400, vide.
7. Nav « Aller plus loin » : « Issues des erreurs React Native », « Sessions mobiles » (L297-304).

Au-dessus du pli (1029 px) : en-tête, formulaire, quatre cartes, trois lignes de la table des capacités. **Aucune mesure chiffrée avec données n'est visible avant y≈1180** (démarrage) et y≈1430 (requêtes).

### 3.3 Widgets
Toutes les mesures partent de la même cohorte (`rum_session.runtime = 'react_native'`, sessions commencées dans la fenêtre, app comprise, `lib/queries-mobile.ts:230-253`) lue dans une transaction `repeatable read` (`snapshot`, L171-176) — les cartes répondent à la même question.

| Widget | Mesure / agrégation | Source | États |
|---|---|---|---|
| Sessions observées | `count(*)` de la cohorte | `SQL_SESSIONS` (L262-266) | 0 réel = 0 |
| Visiteurs observés | `count(distinct visitor_id)` ; `null` si aucun identifiant → « Inconnu » (L40, L343) | idem | sous-texte : sessions sans identifiant si > 0 (L123-125) |
| Erreurs JavaScript | **`sum(occurrences)`** (L446), dont `kind='crash'` et `'unhandledrejection'` ; `fatal` = `null` si aucune ligne ne renseigne `is_fatal` → « Inconnu » (L449, L459-460) | `lireErreursJs` (L435-463), `error_source='react_native_js'` (L42) | `null` entier si colonne v69 absente → « Inconnu » + motif dans `unavailable` (L325-327, L347) |
| Sessions sans erreur JS | `1 − sessions_touchées / sessions` (`errorFreeSessionRate`, `lib/mobile-capabilities.ts:161-175`) | même cohorte | `null` + raison : `no_sessions`, `capability_unavailable`, `capability_unknown` (L138-146) → « Non calculable » (L144-150) |
| Capacités | `capabilityMatrix` : `active` / `unavailable` / `unknown` (L92-120), releases déclarantes, dernière recette | `mobileDeclarations` (L389-421) sur `mobile_capabilities`, **hors fenêtre** (L380-384) | badge « Collecté » / « Non collecté » / « Inconnu » (L123-127) ; « Jamais » si non vérifié |
| Démarrage JS à froid / à chaud | p75 (grand chiffre), médiane, p95, nombre de mesures, **jamais fondus** (L466-471) | `lireDemarrage` (L473-494), `rum_event` timing `js_start_to_first_screen_ms` / `js_warm_start_to_first_screen_ms` (L38-39) | `null` → « Non mesuré » (L213, L218) |
| Écrans les plus consultés | `RankBar` : consultations, sous-texte sessions | `lireEcrans` (L497-511), top 10 | `emptyLabel` + table sr (L235-256) |
| Requêtes les plus lentes | table, tri p75 desc | `lireRequetes` (L522-541), `rum_span tier='front'`, origine retirée du chemin (L527) | ligne vide (L290-292) |
| Bandeaux | « Réponse partielle : … » `role="status"` ; échantillonnage `role="note"` | `unavailable`, `samplingOf` (L280-290) | n'apparaissent que si nécessaire |

Chargement / erreur : § 1.2 — c'est l'écran de référence du lot.

### 3.4 Meilleur que Datadog — à conserver
- **La matrice de capacités** avec ses trois états et sa quatrième information orthogonale « Vérifié (recette) » (`lib/mobile-capabilities.ts:2-17, 67-81`). Datadog affiche « Crash-free sessions by version » comme indicateur de tête (https://docs.datadoghq.com/real_user_monitoring/application_monitoring/android/mobile_vitals/ , page « RUM performance dashboards » § Mobile App Performance) ; qu'il distingue « 0 crash » de « rien ne mesure les crashes » est **non établi** dans les sources consultées. Ici, c'est la règle n°1 de l'écran (L4-10).
- Le libellé refuse « crash-free » (L12-14 ; « Sessions sans erreur JS » L141 ; note L149) : les crashes natifs ne sont pas collectés avant P8.5 et l'écran le dit.
- « Inconnu » pour les visiteurs sans identifiant, « fatales : Inconnu » quand `is_fatal` est nul, occurrences sommées : trois invariants tenus à la lettre.
- Même cohorte, même photographie pour toutes les cartes (L3-8) ; release filtrée sur la session pour un binaire mobile, avec la raison (L185-211).
- Échantillonnage : probabilité d'inclusion minimale annoncée, aucune extrapolation (L276-290).
- Démarrage : « Ce n'est pas le démarrage natif » écrit sous le titre (L201-204) ; à froid et à chaud jamais mélangés.
- Vie privée : « aucun en-tête MIP n'est envoyé hors des origines explicitement déclarées » (L264-265).
- Accessibilité : `caption` sr-only, `aria-labelledby`, alternative textuelle, `role="status"` ; états chargement/erreur avec réessai.

### 3.5 Plus faible
- **Pas un seul graphique** avec données : quatre cartes sans sparkline, aucune tendance des sessions ni des erreurs, démarrage en texte (p50 · p75 · p95 sur une ligne, L217), requêtes en table. Datadog met des séries temporelles et des distributions partout (`newoptimizeperformanceimage.png`, `raw/real_user_monitoring_platform_dashboards_usage.md:28-35`).
- **Ordre** : la table de référence des capacités (six lignes, chacune avec une note de deux lignes) passe avant les mesures et pousse tout chiffre sous le pli. Sur une application instrumentée, l'exploitant lira la doc avant les données.
- Le formulaire « Plateforme » est un second contrôle de filtre à côté de la barre globale (raison L54-61 valable, mais l'écran le paie en hauteur).
- « Sessions mobiles » (L68) pointe sur `/sessions?device=mobile` : `device` est la **classe d'appareil** (navigateurs mobiles compris), pas le runtime React Native. Le lien promet la cohorte de l'écran et en ouvre une autre. « Issues des erreurs React Native » passe `source: "react_native_js"` (L67) ; que `/errors/issues` lise ce paramètre comme `error_source` est **non établi** (hors lot).
- Table des requêtes sans taux d'erreur (seulement un compte « ≥ 400 »), sans lien vers `/tracing`.
- Écrans : pas de lien d'un écran vers ses sessions ou ses erreurs.
- L'état vide de la démo (tout « Inconnu », « Jamais ») est honnête mais sans geste suivant : `/experience` donne un snippet, `/mobile` non (comment déclarer les capacités, comment émettre `screen()` — non écrit).
- Pas de comparaison par release du taux sans erreur JS alors que la release est un fait exact par session (L185-199).

### 3.6 Déjà disponible côté requêtes, non affiché
- `CapabilityStatus.last_declared_at` (`lib/mobile-capabilities.ts:79-80`, calculé L104, L113) : le commentaire de `lib/queries-mobile.ts:384` affirme « `last_declared_at` dit depuis quand on n'a plus rien entendu ; l'écran l'affiche » — **`app/mobile/page.tsx` ne le rend nulle part** (aucune occurrence dans le fichier). Une colonne « Dernière déclaration » est un ajout sans backend.
- `declarations[]` (release, `first_declared_at`, `last_declared_at`, `declared`) (`lib/queries-mobile.ts:120-121`) : permet une ligne par release plutôt qu'une liste séparée par des virgules (L184-186).
- `js_errors.sessions_affected` (L80-81) : seulement dans le calcul du taux ; « N sessions touchées sur M » n'est pas écrit.
- `resources[].errors / calls` : un taux d'erreur par chemin est calculable côté page.
- `sampling.min_inclusion_probability` : seul le message est rendu.
- `startup.*.samples`, `p50`, `p95` : rendus en texte ; une barre d'étendue p50–p75–p95 ne demande rien de plus.

---

## 4. 11 — Sessions (`/sessions`)

Fichiers : `app/sessions/page.tsx` (433 l.) ; `lib/queries.ts` `listSessions` (L363-389), `visitStats` (L597-642), `releaseRechercheParOccurrence` (L353-355) ; `lib/queries-sessions.ts` `observedVisitorsTrend` (L68-95), `engagementStats` (L20-48) ; purs : `lib/sessions-search.ts`, `lib/engagement.ts`, `lib/sessions.ts` ; composition par cookie `lib/dashboard-blocs.ts:77-111` (quatre blocs : `resume`, `liste`, `visiteurs`, `engagement` ; deux « indisponibles » motivés : identité du visiteur, démasquage sélectif). Tests : `tests/unit/sessions.test.ts`, `tests/unit/session.test.ts`, `tests/unit/identite-visiteur.test.ts`.

### 4.1 Question posée
« Parcours réels, rattachés à un identifiant de visiteur tiré au hasard (aucune PII) — ouvre une session pour sa timeline pas à pas » (L108). En pratique quatre questions empilées : nouveaux ou revenants ? combien de visiteurs par seau ? combien de temps et combien de pages ? et la liste.

### 4.2 Mise en page réelle (`11-sessions.png`, 1440×3963)
1. En-tête.
2. `SupervisionHero` split (L120-168) : gauche « Sessions actives » 28 (≥ 1 page vue), « Visites » 28 (aucune reprise), « Part de revenants » 0 % (0 revenants · 28 nouveaux) + lecture ; droite `Donut` « Nouveaux vs revenants », centre « 28 identifiés », légende Nouveaux 28 100 % / Revenants 0 0 %.
3. `ObservedTrend` « Visiteurs observés par 6 h — 7 j » (L177-181) : 28 barres sans axe, deux non nulles (17/09 et 18/09), puis la note « Ces valeurs ne s'additionnent pas » (L182-194).
4. Carte « Durée observée et sessions à une seule vue » → « 28 session(s) avec au moins une page vue sur la fenêtre : il en faut 30 … Élargis la période. » (L248-251, seuil `ENGAGEMENT_MIN_SESSIONS = 30`, `lib/engagement.ts:21`).
5. Formulaire de recherche (L257-310) : « Chercher par » (Identifiant de session (exact) / Route normalisée / Release), « Valeur exacte », « Rechercher », aide « Égalité exacte, jamais un motif ni un préfixe. La recherche par identité … n'est pas proposée ».
6. 28 cartes de session (L320-378) : id tronqué (lien), badges appareil / navigateur / pays (avec provenance en `title` et sr-only, L335-342) / « extension » si capteur navigateur, « N page(s) », « N erreur(s) » en rouge, dates début → dernière vue, puis la chaîne des routes (`/ → /partners → /partners/:id`), chaque route liée par `breakdownDrillHref` (L367).
7. Pagination (L389-408) non rendue : 28 < `SESSION_PAGE_SIZE = 50`.

Au-dessus du pli : le hero et le haut du graphique. La liste commence à y≈1300 (÷1,98 sur l'aperçu) et occupe ~2 600 px.

### 4.3 Widgets
| Widget | Mesure | Source | États |
|---|---|---|---|
| Hero « Nouveaux vs revenants » (bloc `resume`) | sessions ≥ 1 page vue ; visites = découpage à 30 min d'inactivité (`VISIT_GAP_MS`, `lib/sessions.ts:10`) ; revenant = même `visitor_id`, même app, session antérieure (`lib/queries.ts:622-631`) ; sessions sans identifiant comptées à part | `visitStats` — deux fenêtres dans la même requête : vues sur `p.started_at`, sessions sur `s.last_seen_at` (L599-600) | `identified = 0` → texte « Aucun visiteur identifié … collectées avant le 09/09/2026, ou par un SDK pas encore à jour » (L133-142) |
| Tendance des visiteurs (bloc `visiteurs`) | `count(distinct visitor_id)` par seau, sur `s.started_at`, série complète via `bucketSeriesSql` | `observedVisitorsTrend` | `softFail` → `[]` (§ 1.2) ; aucun total |
| Engagement (bloc `engagement`) | médiane et p75 de `last_seen_at − started_at` (filtre `page_count ≥ 1`), part des sessions à une vue, sessions encore actives (30 dernières minutes) | `engagementStats` sur les sessions **commencées** dans la fenêtre | < 30 sessions → message ; `softFail` → même message |
| Recherche + liste (bloc `liste`) | 50 + 1 lignes, tri `(last_seen_at, session_id)` desc, curseur opaque base64url (`lib/sessions-search.ts:102-132`) | `listSessions` : `s.*`, routes agrégées, `err_count = sum(occurrences)` (L376-382) | saisie refusée → `role="alert"` (L293-301) ; curseur étranger refusé (L65) ; liste vide (L379-385) |
| Tous blocs éteints | `TousEteints` (L412) | cookie `mip-blocs-sessions` | — |

### 4.4 Meilleur que Datadog — à conserver
- Le partage nouveaux/revenants ne porte que sur les sessions identifiées, et les autres sont **comptées à part** (`lib/queries.ts:574-577`, `page.tsx:152-160`, `lib/dashboard-blocs.ts:86`).
- « Ces valeurs ne s'additionnent pas » et aucun total sous la courbe des visiteurs (L182-194, `lib/queries-sessions.ts:60-66`).
- « Durée observée » ≠ temps actif ; « sessions à une seule vue » ≠ taux de rebond, définitions écrites à l'écran (L230-236) et dans le module (`lib/engagement.ts:3-13`). Le tableau de bord Datadog « RUM - User Sessions » affiche « Average session duration » et, côté mobile, « overall bounce rate » (`newoptimizeperformanceimage.png` ; `raw/real_user_monitoring_platform_dashboards_usage.md:17, 32`) sans cette réserve.
- Rien n'est affiché sous 30 sessions (`lib/engagement.ts:20-21`).
- **Aucune recherche par identité, par décision** (`lib/sessions-search.ts:11-15`, écran L303-306) ; Datadog propose au contraire la navigation Previous/Next entre les sessions d'un `@usr.id` (`raw/real_user_monitoring_explorer_events.md:27-33`).
- Pagination par clé stable, expliquée (L391-394) ; pays estimé avec provenance (L335-342) ; bots exclus ; release lue sur l'occurrence quand la colonne existe, dit à l'écran sinon (L307).
- Chaque route de la chaîne ouvre les mesures de cette route (L361-376) : le parcours est un point de départ, pas une fin.

### 4.5 Plus faible
- **La liste est une pile de cartes**, pas une table : 28 sessions = 2 600 px, aucune colonne triable, aucune densité. L'Explorer Datadog (`datadog-rum-views-explorer.png`) combine facettes à gauche (avec comptes), série temporelle en haut, table dense, panneau latéral au clic.
- Aucune agrégation visible sur la population (appareils, navigateurs, pays, erreurs) alors que chaque ligne les porte ; aucun filtre « avec erreurs », « avec replay », « avec frustration ».
- `ObservedTrend` n'a **pas d'axe** : sur la capture, on ne sait pas quel jour est quelle barre sans ouvrir l'alternative textuelle (`components/charts/ObservedTrend.tsx:31-40`).
- Le hero et l'engagement comptent deux populations (« sessions actives » sur `last_seen_at`/vues, « sessions commencées » sur `started_at`) qui tombent toutes deux à 28 ici ; l'écran ne dit pas qu'elles peuvent diverger.
- `softFail` transforme une panne en « données insuffisantes » (§ 1.2).
- Une carte de session ne montre ni durée, ni vitals, ni frustration, ni présence d'un replay ; « desktop · Chrome · FR · 3 page(s) » est tout ce qu'on lit avant de cliquer.
- Recherche en égalité stricte seulement (par décision pour l'identifiant ; pour la route, un préfixe serait défendable mais est refusé, `lib/sessions-search.ts:17-19`).
- Pas de lien de la tendance vers la liste (un seau ne filtre pas la liste).

### 4.6 Déjà disponible côté requêtes, non affiché
- `VisitorsBucket.sessions` et `sans_identifiant` **par seau** (`lib/queries-sessions.ts:50-58`) : seule la somme des `sans_identifiant` est écrite (L186-193). Une série à deux mesures (sessions additionnables en barres, visiteurs distincts en points) est possible sans backend.
- `SessionRow.geo_source`, `geo_db_version` (`lib/queries.ts:307-309`) : seulement en `title`/sr-only.
- `listSessions` sélectionne `s.*` (L376) : toutes les colonnes de `rum_session` arrivent (au moins `release`, `runtime`, `sample_rate`, `error_sample_rate`, `is_bot`, `visitor_id` — attestées par `lib/queries-mobile.ts:246-250` et `lib/queries-cohorts.ts:33-36`) ; la liste exacte des colonnes est **non établie** ici (schéma non lu). `SessionRow` ne les type pas (L303-320) : un typage suffit pour les afficher.
- `VisitStats.unidentified_count` : dans un sous-texte seulement.
- `reprises = visits − sessions` (L116) : calculé, affiché en sous-texte.

---

## 5. 12 — Détail de session (`/sessions/[id]`)

Fichiers : `app/sessions/[id]/page.tsx` (183 l.) ; `lib/queries.ts` `sessionMeta` (L413-416, `select *`), `sessionTimeline` (L441-566) ; `components/sessions/Timeline.tsx`, `lib/timeline-constants.tsx` (`KIND_STYLE`, `KIND_ICON`), `components/sessions/TabLink.tsx`, `components/replay/ReplayPlayer.tsx` (client, `@rrweb/replay`). Tests : `tests/unit/timeline-actions-compat.test.ts`, `tests/unit/replay-masquage.test.ts`.

### 5.1 Question posée
« Timeline fusionnée : actions causales, pages vues, vitals, erreurs, ressources, appels API et événements métier » (L78) — que s'est-il passé dans cette session, dans l'ordre, et à quoi ressemblait l'écran (Replay).

### 5.2 Mise en page réelle (`12-session-detail.png`, 1440×1383)
1. « ← Sessions » (filtres globaux conservés, L47-51, 71-73), h1 « Session 5c8bd251… », sous-titre.
2. Huit cartes `Meta` (L81-111) : App demo-app · Device desktop · Navigateur Chrome · Pays estimé FR + « Fuseau horaire du… » (provenance, L88-92) · Source SDK · Visiteur (aléatoire) fb1067f4-b… · Durée 1 s · Pages 3.
3. Ligne dates + badges de comptes par type (L113-125) : « 3 page vue · 12 vital · 5 breadcrumb · 1 long task · 2 action ».
4. Onglets Timeline | Replay (L128-135).
5. Carte timeline (L140-153) : `<ol>` avec bordure gauche, une ligne par événement : décalage (`+0 ms`, `+269 ms`, … `fmtOffset`, `Timeline.tsx:8-12`), badge de type, corps typé. Sur la capture : 28 lignes, dont **12 « Vital » à +0 ms** (RTT, TTFB, REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE, DOWNLINK, FCP puis LCP, INP), 3 « Page vue », 5 « Breadcrumb », 1 « Long task » (4 ms), 2 « Action » (fuchsia) avec le rattachement causal « ↳ button "→ /partners" » sur les breadcrumbs (L30-34).

Au-dessus du pli : métadonnées, badges, onglets, ~15 lignes de timeline.

### 5.3 Widgets et sources
- Accès : `notFound()` si la session est hors périmètre du viewer (L30-34) ou si `?app=` ne correspond pas (L35-40) — une erreur forgée ne peut pas ouvrir la session d'un autre tenant.
- `sessionTimeline` : `union all` de `rum_pageview`, `rum_metric`, `rum_action` (si table v67), `rum_error`, `rum_breadcrumb`, `rum_resource` (seulement celles liées à une action, L461), `rum_longtask` (libellé attribué « Blocage · fonction », L462-469), `rum_event` hors `event_type='action'`, `rum_span tier='front'` avec le span serveur corrélé par `trace_id` (L482-500) ; tri `ts`, actions avant le reste au même instant (L503) ; **`limit 500`** (L565).
- Corps typés (`Timeline.tsx:40-134`) : vital noté via `RATING_CLASS` (seuils `lib/rating.ts`), erreur en rouge, appel API « 200 · serveur 211 ms » avec `rating='poor'` si ≥ 400 ou 0 (L490-491).
- Replay (`ReplayPlayer.tsx`) : `fetch /api/replay/[id]`, états `loading` / `empty` / `error` / `ready` (L16, L113-137) ; positionnement sur `?at=` borné à l'enregistrement, sinon « Replay indisponible à cet instant » (L64-71, L24-28) ; mise à l'échelle à la largeur disponible (L86-104) ; boutons Lecture / Pause (L140-145) ; `role="status"` présent dès le montage (L153-162).
- États : timeline vide → « Aucun événement enregistré pour cette session » (L148-150) ; replay vide → explication (session trop courte, DNT/GPC, consentement, `CompressionStream`) + rappel du masquage et du TTL 30 j (L116-132) ; replay en erreur → texte rouge sans réessai (L133-137) ; aucun `loading.tsx`/`error.tsx` de route.

### 5.4 Meilleur que Datadog — à conserver
- L'identité est un tirage aléatoire, dit à l'écran : « Visiteur (aléatoire) » ou « Classe d'appareil (héritée) … n'identifie pas une personne » (L98-108).
- Le pays n'est jamais affiché seul : provenance et version de base DB-IP sous la valeur (L85-92).
- Le masquage est **par défaut à l'enregistrement** (`maskAllInputs`, blocs `mip-rum-block`) et le TTL de 30 j est écrit dans le lecteur (L126-130, L147-150). Datadog masque aussi par défaut (`defaultPrivacyLevel: mask`, https://docs.datadoghq.com/real_user_monitoring/session_replay/browser/privacy_options/ ) et conserve 30 jours (`raw/getting_started_session_replay.md:199`) : parité de fond, mais ici c'est écrit dans l'interface, pas seulement dans la doc.
- « Replay indisponible à cet instant » plutôt qu'un positionnement approximatif (L64-71).
- Le rattachement causal action → breadcrumb/erreur/ressource/API (L30-34, `lib/queries.ts:449-451`).
- Un appel API affiche le temps serveur corrélé par `trace_id` sur la même ligne (`lib/queries.ts:482-500`) : le « ça vient du réseau ou du serveur ? » est dans la timeline.
- Vitals notés inline avec les seuils du produit (`Timeline.tsx:49-59`).

### 5.5 Plus faible
- **Liste verticale plate, pas de cascade temporelle** : Datadog propose un onglet « Waterfall » avec les Core Web Vitals en surimpression et un filtre par type (`raw/real_user_monitoring_explorer_events.md:39-56`). Ici le temps n'est qu'une colonne `+N ms`.
- **Les phases réseau (RTT, REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE, DOWNLINK) sont étiquetées « Vital »** parce qu'elles voyagent dans `rum_metric` (kind `'vital'`, `lib/queries.ts:452-453`) — `lib/rating.ts:15-21` explique justement qu'elles n'en sont pas. Douze lignes à +0 ms noient trois pages vues.
- Aucun regroupement par page vue (vitals, ressources, appels API sous leur vue), aucun filtre par type — les badges de compte (L118-124) ne filtrent pas.
- Le plafond de 500 lignes est silencieux.
- Aucun lien sortant : une erreur n'ouvre pas `/errors/[id]`, un appel API n'ouvre pas `/tracing/[trace_id]`, une route n'ouvre pas `/pages`.
- Timeline et Replay sont deux onglets **non synchronisés** ; Datadog déplace le replay au survol d'un événement (`raw/real_user_monitoring_browser_frustration_signals.md:158-162`) et segmente le replay en « smart chapters » (`raw/getting_started_session_replay.md:163`). Le lecteur n'a ni barre de progression, ni vitesse, ni saut d'inactivité, ni commande clavier (L140-145).
- « Durée 1 s » = `last_seen_at − started_at` (L62-63) sans mention « encore active » ; pas d'OS, de release, de viewport, de source de collecte détaillée.
- Les signaux de frustration (`frustration.rage`, `frustration.dead`) passeraient par le kind `event` (« Event métier ») : sans mise en valeur (non vérifié sur données, **non établi**).
- L'onglet Replay exige JavaScript (client) ; l'erreur de chargement n'a pas de réessai.

### 5.6 Déjà disponible côté requêtes, non affiché
- `sessionMeta` = `select *` (L414) : `client_id`, `id_kind` (L391-411) et toute colonne de `rum_session` non typée (release, runtime, sample_rate, is_bot — cf. § 4.6) sont dans la ligne ; `SessionMeta` ne les déclare pas.
- `TimelineItem.ts` absolu : seulement en `title` du décalage (`Timeline.tsx:25`).
- `TimelineItem.rating` des appels API : seulement une couleur.
- `counts` par type (L64-67) : rendus en badges, utilisables comme filtres sans requête.
- `item.action_id` : rendu comme badge « ↳ » ; permettrait de plier/déplier par action.

---

## 6. 13 — Acquisition (`/acquisition`)

Fichiers : `app/acquisition/page.tsx` (129 l.), `lib/queries-acquisition.ts` (29 l.), `lib/acquisition.ts` (pur, testé : `tests/unit/acquisition.test.ts`), `components/charts/Donut.tsx`.

### 6.1 Question posée
« D'où viennent les visiteurs — canal d'entrée (direct, recherche, social, référent) et sites référents » (L47).

### 6.2 Mise en page réelle (`13-acquisition.png`, 1440×1029 — tout au-dessus du pli)
1. En-tête.
2. `SupervisionHero` split (L58-84) : gauche « Sessions · 7 j » 28, « Canal dominant » Direct (100 % du trafic), « Sites référents » 0 (hôtes externes distincts) + lecture ; droite `Donut` « Répartition par canal d'entrée », centre « 28 sessions », une seule part grise « Direct 28 100 % ».
3. « Sites référents » : table Hôte / Canal / Sessions, ligne vide « Aucun site référent externe (trafic direct/interne) » (L111-117).
4. Note « les paramètres de campagne (UTM) ne sont pas captés (URL nettoyée côté SDK) — détection de campagne = évolution SDK à prévoir » (L121-124).

### 6.3 Widgets et sources
- `acquisition(f, cap = 20000)` (`lib/queries-acquisition.ts:14-28`) : `distinct on (session_id)` la **première** page vue (`referrer`, `url`) de chaque session de la fenêtre `now() - intervalle`, app / device / segment / bots ; puis `acquisitionReport` (`lib/acquisition.ts:62-88`).
- `classifyChannel` (L32-40) : pas de referrer → `direct` ; même hôte → `internal` ; listes de fragments moteurs (L12) et réseaux (L13-16) → `search` / `social` ; sinon `referral`. Top 20 hôtes externes (L82-85).
- Donut : parts > 0 seulement, triées (L55) ; couleurs `HEX` (L27-33).
- États : `total = 0` → une seule carte « Aucune session sur 7 j » (L50-51), le hero disparaît ; table vide (L111-117) ; refus de filtre (L37) ; plage personnalisée / tablette refusées (§ 1.1). Aucun chargement/erreur de route ; le plafond de 20 000 sessions est silencieux.

### 6.4 Meilleur que Datadog — à conserver
- La lecture prévient qu'un trafic très « direct » peut cacher des référents mal détectés (L80-83) et la note dit ce qui n'est **pas** capté et pourquoi (L121-124).
- Le canal `internal` est séparé, les règles sont pures et testées, les bots sont exclus.
- Dans les sources Datadog consultées (`raw/real_user_monitoring_platform_dashboards_usage.md:13-35`, images), aucun widget de canaux d'acquisition ou de référents n'apparaît ; l'existence d'un regroupement par canal chez Datadog est **non établie**.

### 6.5 Plus faible
- Un anneau à **une seule part** (capture) est un graphique vide de sens ; sans données de référents, l'écran ne montre rien qu'un chiffre.
- Aucune tendance par canal dans le temps (une requête par seau serait un changement backend).
- Aucun croisement canal × page d'atterrissage, ni canal × appareil, ni lien d'un référent vers `/sessions`.
- La table des référents n'a ni part (%) ni barre.
- Modèle de filtre historique (§ 1.1) ; fenêtre `now()`.
- Les canaux à 0 sont retirés de la légende (L55) : on ne voit pas « Recherche 0 », ce qui masque l'absence.

### 6.6 Déjà disponible côté requêtes, non affiché
- `url` de la première page vue de chaque session (`lib/queries-acquisition.ts:17-18`) : `acquisitionReport` ne s'en sert que pour détecter le canal interne (`lib/acquisition.ts:35-36`). Le chemin d'atterrissage (brut, non normalisé — c'est `url`, pas `route`) est jetable en « pages d'entrée par canal » dans la couche pure, sans requête nouvelle. Limite : `url` n'est pas la route normalisée ; **non établi** si `p.route` peut être ajouté sans toucher la requête (il faudrait le sélectionner : changement de requête, minime).
- `channels[]` complet avec les zéros (L81).

---

## 7. 14 — Rétention (`/retention`)

Fichiers : `app/retention/page.tsx` (161 l.), `lib/queries-cohorts.ts` (45 l.), `lib/cohorts.ts` (pur, testé : `tests/unit/cohorts.test.ts`), `components/charts/LineTrend.tsx`.

### 7.1 Question posée
« Part des visiteurs identifiés qui reviennent, par cohorte de première activité hebdomadaire » (L37).

### 7.2 Mise en page réelle (`14-retention.png`, 1440×1029 — tout au-dessus du pli)
1. En-tête.
2. Chips « Fenêtre : 4 sem. / 8 sem. / 12 sem. » (L40-53 ; paramètre `weeks`, borné 2..26 L21).
3. `SupervisionHero` split (L81-106) : gauche « Cohortes suivies » 1 (28 utilisateurs), « Rétention S+1 » —, « Rétention S+4 » — + lecture ; droite « Courbe de rétention moyenne » → « Pas encore assez de recul (une seule semaine observée). » (L87-89).
4. Matrice (L109-152) : Cohorte / Taille / S+0 ; une ligne « sem. 10/09 · 28 · 100 % » (cellule verte).
5. Note de bas : « S+0 = semaine de la cohorte (100 %). Les cases vides … (matrice triangulaire). » (L155-158).

### 7.3 Widgets et sources
- `retentionCohorts(f, weeks)` (`lib/queries-cohorts.ts:27-40`) : paires distinctes (`visitor_id`, index de semaine) sur `rum_session`, `visitor_id is not null`, `started_at > now() - weeks`, app / device / segment / bots — **le preset 1 h / 24 h / 7 j n'entre pas dans la requête**. Index de semaine = `floor(epoch(date_trunc('week', started_at)) / 604800)` (L31).
- `buildCohorts` (`lib/cohorts.ts:26-60`) : cohorte = première semaine d'activité ; cellules jusqu'à `min(maxOffset, latest − cohort)` ; `rate = retained / size`.
- Courbe moyenne (page L65-76) : à chaque offset, somme des retenus / somme des tailles des cohortes ayant atteint l'offset ; `LineTrend` domaine [0, 100] (L85).
- KPI S+1 / S+4 : `curve[1]`, `curve[4]` ; tone S+1 ≥ 40 bon, ≥ 20 moyen, sinon mauvais (L97) — seuils sans source.
- Cellule : fond `rgba(16,185,129, 0.12 + rate·0.88)`, texte blanc ou vert foncé selon `rate < 0.5` (L132-140), `title` « retenus / taille » (L141).
- États : aucune cohorte → carte « Aucun visiteur identifié sur la fenêtre. Les sessions collectées avant le 09/09/2026 ne portent pas d'identifiant … » (L55-59) ; une seule colonne → message dans le hero ; refus de filtre (L18) ; plage personnalisée refusée (`surfaces.ts:123`). Aucun chargement/erreur de route.

### 7.4 Meilleur que Datadog — à conserver
- La clé de cohorte est un identifiant **tiré au hasard**, jamais une empreinte de terminal, et l'écran vide explique la coupure historique (`lib/queries-cohorts.ts:6-14`, page L56-59). Rien n'est fabriqué pour les sessions sans identifiant.
- La matrice triangulaire est expliquée (L155-158), la lecture donne la grille d'interprétation (chute S+0→S+1 = activation, plateau = noyau fidèle, L101-105).
- Datadog décrit sa Rétention comme « how often users are successfully returning to a page or action » (https://docs.datadoghq.com/product_analytics/ ) ; le détail de son écran est **non établi** (404).

### 7.5 Plus faible
- **Étiquette de cohorte fausse de quatre jours** : `weekIndexToDate` (L43-45) rend `week × 604800 × 1000`, c'est-à-dire un instant aligné sur l'epoch (1970-01-01 est un jeudi), alors que le commentaire dit « (lundi) ». Les sessions de la démo sont des 17-18/09/2026 (`11-sessions.png`), semaine ISO du lundi 14/09 ; la matrice affiche « sem. 10/09 » (jeudi). Le regroupement par semaine reste exact (le plancher est stable au sein d'une semaine ISO), seule l'étiquette est décalée. Correction côté page (ajouter 4 jours ou reconstruire le lundi), pas côté requête. Fuseau de `date_trunc('week')` : **non établi** (dépend de la session PostgreSQL).
- La barre de filtres globale affiche « 7 j » sélectionné alors que l'écran l'ignore (§ 7.3) ; `surfaces.ts:123` le déclare `range: "presets"` au lieu de `"none"` avec une `rangeNote` — un contrôle qui a l'air actif et ne fait rien.
- « Revenir » = n'importe quelle session dans la semaine ; pas de rétention sur une page ou une action, pas de granularité jour/mois, pas de comparaison de segments.
- La courbe moyenne pondérée n'est pas expliquée à l'écran (commentaire L63-64 seulement).
- `LineTrend` (recharts client) sans alternative textuelle ; la matrice en tient lieu, mais elle ne porte pas la moyenne.
- Couleurs de cellule en `rgba` inline, non thémées : rendu sombre **non établi**.
- Les chips 4/8/12 sont le vrai contrôle de temps et sont loin de la barre de filtres.

### 7.6 Déjà disponible côté requêtes, non affiché
- `cell.retained` (`lib/cohorts.ts:10`) : seulement en `title` ; « 12 / 28 » écrit dans la cellule ou en survol accessible ne demande rien.
- `weeks` accepte 2..26 (L21) ; seuls 4/8/12 sont proposés.
- Le nombre de sessions **exclues** faute d'identifiant n'est pas dans la requête (changement backend) — à ne pas promettre « sans backend ».

---

## 8. 15 — Parcours (`/paths`)

Fichiers : `app/paths/page.tsx` (188 l.), `lib/queries-paths.ts`, `lib/paths.ts` (pur), `lib/sankey.ts` (pur), `components/Sankey.tsx`, `lib/queries-funnel.ts`, `lib/funnel.ts` (pur), `components/Funnel.tsx`. Tests : `tests/unit/paths.test.ts`, `sankey.test.ts`, `funnel.test.ts`.

### 8.1 Question posée
« Comment les visiteurs circulent entre les routes — pages d'entrée et de sortie, transitions les plus fréquentes (recharges exclues) » (L41), plus « quelle part des sessions franchit les étapes 1..N d'un entonnoir d'événements custom ».

### 8.2 Mise en page réelle (`15-paths.png`, 1440×1546)
1. En-tête.
2. `SupervisionHero` `layout="wide"` (L45-73) : rangée de trois `HeroStat` — « Page d'entrée n°1 » `/` (28 sessions y démarrent), « Page de sortie n°1 » `/partners/:id` (24 sessions s'y terminent), « Transitions distinctes » 2 — puis la lecture, puis le titre « Flux de navigation — route → route » et le Sankey pleine largeur (y≈460-1040 sur la capture : deux rubans, `/` → `/partners` en vert clair, `/partners` → `/partners/:id` en orange clair ; nœuds source colorés par hachage de la route, nœuds cible en accent).
3. Deux cartes `BoundaryCard` (L76-79) : « Pages d'entrée » (100 % `/` 28), « Pages de sortie » (86 % `/partners/:id` 24 ; 14 % `/partners` 4).
4. Table « Transitions les plus fréquentes » De / Vers / Volume (barre + chiffre) : 2 lignes (L83-125).
5. « Entonnoir de conversion » : quatre `<select>` « Étape 1..4 » (valeur « — ») + « Construire l'entonnoir » (L128-150) ; aucun graphe (0 étape choisie).

Au-dessus du pli : les trois chiffres, la lecture, le haut du Sankey.

### 8.3 Widgets et sources
- `routeTransitions` (`lib/queries-paths.ts:23-44`) : `lead(route) over (partition by session_id order by started_at, id)` sur `rum_pageview`, `next_route <> route` (boucles A→A retirées), top 50.
- `entryExitRoutes` (L52-90) : `distinct on (session_id)` première / dernière route, top 15 chacune.
- `buildSankey` (`lib/sankey.ts:40-111`) : 8 nœuds max par côté, liens gardés si les deux extrémités sont dans le top, `shownFlow / totalFlow` ; `Sankey.tsx` rend 720×380 fixe.
- `BoundaryCard` (page L155-188) : `%` = `n / somme des lignes reçues` (L164, L173) — c'est-à-dire sur le top 15, pas sur toutes les sessions.
- `availableEvents` (`lib/queries-funnel.ts:22-39`) : événements custom de la fenêtre avec `n` et `sessions`, top 50 ; `StepPicker` n'affiche que `name` (`Funnel.tsx:38-46`).
- `funnelReport` (L46-78) → `computeFunnel` (`lib/funnel.ts:63-65`) : profondeur = plus grand préfixe d'étapes présentes en ordre temporel non décroissant (première occurrence) ; `FunnelChart` affiche `reached`, `convFromStart`, `dropoff` (`Funnel.tsx:55-86`).
- États : pas de transition → message dans le hero (L59-61) et dans la table (L116-122) ; pas assez de liens → « Pas assez de transitions pour un flux » (`Sankey.tsx:28-30`) ; couverture partielle → « top routes · N / M transitions affichées » (L48-54) ; pas d'événement custom → phrase avec `MIPRum.track("nom")` (L137-142) ; étape 1 jamais réalisée → note (L144-148) ; refus de filtre (L18) ; presets seuls. Aucun chargement/erreur de route.

### 8.4 Meilleur que Datadog — à conserver
- Les recharges/re-rendus SPA sont exclus et le titre le dit (L41 ; `lib/paths.ts:8-9`).
- La couverture du Sankey est annoncée (`shownFlow / totalFlow`, L48-54) : le graphe dit ce qu'il ne montre pas.
- L'entonnoir respecte l'ordre temporel et le dit (L130-133) ; les noms d'étapes sont des valeurs liées, jamais interpolées (`lib/queries-funnel.ts:5-6`). Même sémantique que Datadog (« as long as step 1 and step 2 happen in the right order in a given session at least once, it counts », `raw/real_user_monitoring_explorer_visualize.md:126`).
- Rendu serveur sans JavaScript, logique pure testée, lecture en français (L68-72).

### 8.5 Plus faible
- **Le Sankey est biparti à un pas** (source → cible) : la même route apparaît des deux côtés (`/partners` à gauche et à droite sur la capture) et se lit comme deux nœuds ; aucun chemin à plusieurs pas, aucune sortie visible. Datadog vend « Pathways » comme « visualize all user journeys across your application to analyze the critical path » (https://docs.datadoghq.com/product_analytics/ ) — le détail de rendu est non établi.
- Hauteur fixe 380 (`Sankey.tsx:7`) : avec deux transitions, deux rubans de 280 px de haut — le graphe est surdimensionné pour peu de données et ne porte ni pourcentage ni total sur les nœuds.
- Couleurs par hachage de chaîne (`Sankey.tsx:16-21`) : non sémantiques, non stables au sens du produit.
- `BoundaryCard` : pourcentages calculés sur le top 15 (L164), gonflés dès qu'il y a plus de 15 routes d'entrée.
- Aucun drill : la recherche « Route normalisée » existe sur `/sessions` (`lib/sessions-search.ts:21`), mais aucune transition ni page d'entrée n'y renvoie.
- L'entonnoir n'accepte que des événements custom ; Datadog construit sur vues et actions, avec « Suggested next steps » (`raw/real_user_monitoring_explorer_visualize.md:111-124`).
- La colonne « Volume » de la table duplique visuellement le Sankey.
- Pas de tendance ; presets seuls ; fenêtre `now()`.

### 8.6 Déjà disponible côté requêtes, non affiché
- `EventOption.n` et `sessions` (`lib/queries-funnel.ts:15-19`) : les `<option>` du sélecteur ne montrent que le nom ; « nom (N sessions) » guide le choix des étapes.
- `FunnelStep.convFromPrev` (`lib/funnel.ts:14`) : calculé, jamais rendu.
- `SankeyNode.total` gauche/droite (`lib/sankey.ts:8-13`) : jamais écrit sur les nœuds.
- Le lien `/sessions?qf=route&q=<route>` est constructible depuis chaque route affichée (`SESSION_SEARCH_FIELD_PARAM`, `SESSION_SEARCH_PARAM`, `lib/sessions-search.ts:25-26`).

---

## 9. 16 — Formulaires (`/forms`)

Fichiers : `app/forms/page.tsx` (185 l.), `lib/queries-form-analytics.ts` (30 l.), `lib/form-analytics.ts` (pur, testé : `tests/unit/form-analytics.test.ts`), `components/charts/RankBar.tsx`.

### 9.1 Question posée
« Analyse des formulaires au niveau du champ — conversion, abandon et temps par champ. Aucune valeur saisie n'est collectée. » (L44)

### 9.2 Mise en page réelle (`16-forms.png`, 1440×1029)
En-tête, puis une seule carte : « Aucun événement de formulaire sur 7 j. Le SDK émet `form.submit` / `form.abandon` automatiquement (option `forms`). » (L47-52). Rien d'autre.

Avec des données (code) : `SupervisionHero` split — gauche « Formulaires entamés », « Soumissions » (tone `good`), « Conversion globale » (tone ≥ 0,6 bon, ≥ 0,3 moyen, sinon mauvais, L87) + lecture ; droite `RankBar` « Friction par champ — <form> » : jusqu'à 8 champs avec `dropoff > 0`, barres rouges, sous-texte « % saisi · N s » (L58-80) ou « Aucun abandon localisé … — parcours fluide 🎉 » ; table « Par formulaire » (Formulaire lien / Entamés / Soumis / Abandons / Conversion / Temps moyen, ligne sélectionnée surlignée, L99-132) ; table « Champs — <form> » (Champ / Interactions / Temps moyen / Taux de saisie / Abandons (dernier champ), L134-179).

### 9.3 Widgets et sources
- `formEvents` (`lib/queries-form-analytics.ts:14-30`) : `rum_event` `name in ('form.submit','form.abandon')`, `now() - intervalle`, app / device / segment / bots, `order by ts desc limit 5000`.
- `formReport` (`lib/form-analytics.ts:52-79`) : par formulaire, `starters = submits + abandons`, `conversion = submits / starters`, `avgTimeMs` = moyenne de `total_time_ms`.
- `fieldReport` (L86-115) : par champ, interactions, moyenne de `timeMs`, `changedRate`, `dropoff` = nombre d'abandons dont ce champ est `last_field`.
- Sélection de formulaire par `?form=` (L25, L31-35) ; par défaut le premier (le plus entamé).
- États : vide (L47-52) ; champs vides (L168-174) ; refus de filtre (L20) ; presets seuls ; plafond 5 000 silencieux (avec plus d'événements, seuls les 5 000 plus récents comptent, sans le dire). Aucun chargement/erreur de route.

### 9.4 Meilleur que Datadog — à conserver
- « Aucune valeur saisie n'est collectée » est dans le sous-titre (L44) et tenu par construction (`lib/form-analytics.ts:6`).
- `dropoff` a une définition précise et écrite : « le dernier touché avant abandon » (L82-84 ; en-tête de colonne L147).
- Aucune analyse de formulaire au niveau du champ n'apparaît dans les sources Datadog consultées (Product Analytics liste Pathways, Funnel, Retention, Analytics, Heatmaps, Segments, Session Replay) ; l'existence d'un équivalent est **non établie**.

### 9.5 Plus faible
- L'état vide ne montre pas le geste d'activation (le nom de l'option `forms` est cité, pas la syntaxe d'initialisation ; **non établi** ici quelle est cette syntaxe).
- **Moyennes** partout (`avgTimeMs`) là où le reste de la console parle en p75 ; « Temps moyen » d'un formulaire mélange soumissions et abandons.
- `starters = submits + abandons` : un formulaire commencé sans événement d'abandon (onglet fermé) n'existe pas ; la définition n'est pas écrite à l'écran.
- Seuils de couleur 0,6 / 0,3 sans source (L87) ; « parcours fluide 🎉 » (L77) détonne avec le ton du dépôt.
- Les champs sont triés par abandons, jamais dans l'ordre du formulaire ; pas de tendance ; pas de découpage par appareil ; pas de lien d'un formulaire vers les sessions qui l'ont abandonné.
- Le hero ne montre que les champs avec `dropoff > 0`, top 8 : un formulaire à 12 champs perd les autres sans le dire.

### 9.6 Déjà disponible côté requêtes, non affiché
- `FormFieldProps.order` et `refocus` (`lib/form-analytics.ts:8-14`) : émis par le SDK, jamais agrégés — l'ordre du formulaire et le nombre de retours sur un champ (signal de friction) sont calculables dans la couche pure.
- `FormEventProps.changed_count`, `total_time_ms` par événement : seule une moyenne en est tirée ; une médiane / p75 se calcule sur les mêmes lignes.
- La requête ne sélectionne que `name, props` (L18) : pas de `ts`, donc **pas de tendance sans changement de requête**.

---

## 10. Récapitulatif transversal pour le plan

### 10.1 À conserver tel quel (invariants tenus, meilleurs que la référence)
1. `/mobile` : matrice de capacités à trois états + recette ; « Non calculable » avec raison ; « Inconnu » ≠ 0 ; occurrences sommées ; pas de « crash-free » ; échantillonnage annoncé sans extrapolation ; états chargement / erreur / partiel (`app/mobile/*`, `lib/mobile-capabilities.ts`, `lib/queries-mobile.ts`).
2. `/sessions` : identifiés / non identifiés comptés à part ; « ne s'additionnent pas » ; définitions durée observée et session à une vue ; seuil 30 ; aucune recherche par identité, curseur stable, provenance du pays.
3. `/sessions/[id]` : identité aléatoire dite ; pays avec provenance ; masquage et TTL écrits dans le lecteur ; « indisponible à cet instant » ; causalité action → événements ; temps serveur corrélé sur la ligne d'un appel API.
4. `/experience` : score null plutôt qu'une note neutre ; CSAT « — » ; état vide avec le geste à faire ; verbatim → session.
5. `/retention` : clé de cohorte aléatoire ; explication de la coupure historique ; matrice triangulaire expliquée.
6. `/paths` : boucles exclues et dites ; couverture du Sankey annoncée ; entonnoir ordonné et lié.
7. `/acquisition`, `/forms` : ce qui n'est pas capté est écrit (UTM ; valeurs saisies).

### 10.2 Écarts aux invariants du produit relevés dans ce lot
| Invariant | Écart | Où |
|---|---|---|
| Inconnue = null, jamais 0 | 0 % tracé / affiché sans avis noté | `app/experience/page.tsx:157, 188` |
| Inconnue = null | « Sérénité » 100 avec 0 session | `app/experience/page.tsx:53, 74` |
| Seuils = ceux du produit | paliers LCP 2000/82/55/32 hors `lib/rating.ts` ; « perf perçue » = LCP seul contre un glossaire qui promet les vitals | `app/experience/page.tsx:28-34` ; `lib/glossary.ts:194-196` |
| Erreur avec réessai | seul `/mobile` ; `softFail` sur `/sessions` déguise la panne en données insuffisantes | § 1.2 |
| Partiel avec raison | plafonds silencieux (500, 20 000, 5 000, 50, 15) | § 1.2 |
| Alternative textuelle | `RadarScore`, `LineTrend` sans table ; `ObservedTrend` sans axe | § 1.3 |
| Fenêtre UTC [from, to) | quatre écrans en `now() - intervalle`, presets seuls (refus honnête de la plage personnalisée) | § 1.1 |
| Filtre actif = filtre appliqué | `/retention` ignore le preset mais la barre l'affiche sélectionné | § 7.5 |
| Exactitude des libellés | « sem. 10/09 » pour une semaine du lundi 14/09 ; phases réseau étiquetées « Vital » ; « Sessions mobiles » ouvre `device=mobile`, pas le runtime | § 7.5, § 5.5, § 3.5 |

### 10.3 Données déjà là, meilleurs graphiques possibles sans backend (synthèse)
| Écran | Donnée | Graphique possible |
|---|---|---|
| 09 | promoters / passives / detractors | barre empilée 5 / 3-4 / 1-2 (`RankBar` segments) |
| 09 | `lcp_p75`, `frustration`, `sessions` | sous-scores avec leur preuve chiffrée à côté du radar |
| 10 | `last_declared_at`, `declarations[]` par release | colonne « Dernière déclaration », une ligne par release |
| 10 | `sessions_affected`, `resources.errors/calls`, p50/p75/p95 | « N sur M sessions touchées », taux d'erreur par chemin, barre d'étendue de démarrage |
| 11 | `sessions` et `sans_identifiant` par seau | série double (barres additionnables + points distincts) avec axe daté |
| 11, 12 | colonnes de `rum_session` déjà sélectionnées (`s.*`) | release, runtime, échantillonnage, bot dans la carte et les métadonnées (typage à ajouter ; liste exacte non établie) |
| 12 | `counts` par type, `ts` absolu, `action_id` | filtres par type, horodatage absolu, pliage par action |
| 13 | `url` d'atterrissage | pages d'entrée par canal (brut) |
| 14 | `cell.retained` | « 12 / 28 » dans la cellule ; étiquette de semaine corrigée |
| 15 | `EventOption.n/sessions`, `convFromPrev`, `SankeyNode.total` | options du sélecteur annotées, conversion pas à pas, totaux sur les nœuds, lien route → `/sessions?qf=route` |
| 16 | `order`, `refocus`, distributions de `timeMs` | champs dans l'ordre du formulaire, retours par champ, médiane / p75 |

### 10.4 Ce qui exigera un changement backend (à ne pas promettre « sans backend »)
Tendance par canal (13), rétention sur une page/action ou par jour (14), tendance des transitions ou chemins multi-pas (15), tendance des formulaires (16, la requête n'a pas `ts`), plage personnalisée et dimensions du contrat sur les quatre écrans historiques (§ 1.1), sessions exclues de la rétention (14), avertissement d'échantillonnage sur 09/11 (les colonnes existent, les requêtes ne les lisent pas).
