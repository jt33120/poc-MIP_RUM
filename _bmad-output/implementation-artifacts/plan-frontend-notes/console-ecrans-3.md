# Lecture des écrans de la console — lot 3 (17 → 24)

Écrans : 17-tracing, 18-trace-detail, 19-map, 20-correlation, 21-goals, 22-slo, 23-alerts, 24-forecast.
Console : `apps/console` (Next.js 15, rendu serveur). Chemins ci-dessous relatifs à
`/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM/apps/console` sauf mention contraire.

## 0. Méthode, sources, limites de cette lecture

- Captures lues : `scratchpad/console/17-tracing.png` … `24-forecast.png`, toutes à 1440 px de large, app
  « Mini-site de démo », preset 7 j, segment « tous les visiteurs », bots exclus (routes exactes dans
  `scratchpad/console/index.json`, entrées 17-24). Aucune capture `-dark` ni `-390` pour ce lot : rendu sombre
  et largeur 390 px sont **non établis** ici, sauf ce que le code dit (§ 1.5).
- Code lu (fichiers cités avec numéro de ligne au fil du texte) : `app/tracing/page.tsx`,
  `app/tracing/[traceId]/page.tsx`, `app/map/page.tsx`, `app/correlation/page.tsx`, `app/goals/page.tsx`,
  `app/slo/page.tsx`, `app/alerts/page.tsx`, `app/forecast/page.tsx` ; `lib/queries-tracing.ts`,
  `lib/queries-map.ts`, `lib/map.ts`, `lib/queries-v2.ts` (sections corrélation/alerting/SLO),
  `lib/queries-goals.ts`, `lib/goals.ts`, `lib/queries-alerting.ts`, `lib/queries-deploys.ts`,
  `lib/queries-grid.ts` (§ dailyTraffic/dailyLcpSeries), `lib/forecast.ts`, `lib/rating.ts`,
  `lib/dashboard-blocs.ts`, `lib/surfaces.ts`, `lib/page-filters.ts`, `lib/filters.ts`, `lib/format.ts` ;
  composants `components/SupervisionHero.tsx`, `components/FilterProblemNotice.tsx`,
  `components/charts/{RankBar,Gauge,StackedBars,ForecastChart}.tsx`, `components/map/ExperienceMap.tsx`,
  `components/features/RobotVsRealChart.tsx`, `components/correlation/{RouteCard,BlindSpotRow,state}.tsx`,
  `components/tracing/{DeployPanel,Section,Empty,ShareBar,SlowRow,format}.tsx`,
  `components/slo/SloStatusRow.tsx`, `components/alerts/{RuleRow,RuleFields,ChannelsSection}.tsx`.
- Comparaison Datadog/IP-Label : pas de nouvelle capture Datadog consultée pour ce lot (aucun des dossiers
  `/Users/juliantalou/Downloads/datadog screenshots and videos` ne couvre distributed tracing / service map /
  synthetic-RUM correlation / SLO / forecasting de façon isolable en une lecture d'image) ; les comparaisons
  ci-dessous s'appuient sur la connaissance générale documentée des produits Datadog APM/RUM, Watchdog et
  Synthetic Monitoring, et IP-Label (DEM synthétique + RUM). Toute affirmation non vérifiable par une capture
  ou un extrait de doc déjà déposé dans `scratchpad/plan/reads/raw/` est marquée **non établi**.
- Un écran vide sur la capture (17, 19, 21, 22) a été lu via le code, pas déduit visuellement : le texte
  ci-dessous dit ce que chaque écran afficherait avec des données, en citant la requête et le composant.

---

## 1. Ce qui vaut pour les huit écrans

### 1.1 Trois régimes de filtre — et un écran qui n'annonce pas le sien

| Écran | `lib/surfaces.ts` | Plage | Filtres de dimension |
|---|---|---|---|
| `/tracing`, `/tracing/[id]` (données) | `range: "custom"` (L91) / `range: "none"` pour `/tracing/` avec `noFilters: "Une trace s'affiche en entier."` (L90) | presets + personnalisée ≤ 30 j | contrat complet |
| `/map` | `range: "custom"` (L88) | idem | contrat complet |
| `/correlation` | `range: "custom"` (L87) | idem | contrat complet |
| `/goals` | `range: "presets", legacy: "segments"` (L121) | **1 h / 24 h / 7 j uniquement — pas de plage personnalisée** | dimensions v1 (`device`, segment) |
| `/slo` | `range: "none"`, `rangeNote: "Chaque SLO se mesure sur sa propre fenêtre glissante."`, `noFilters: "…seule l'app sélectionnée filtre la liste."` (L92-98) | aucune (écran de configuration) | aucune (sauf app) |
| `/alerts` | `range: "none"`, `rangeNote`/`noFilters` équivalents (L99-106) | aucune | aucune (sauf app) |
| `/forecast` | `range: "presets", legacy: "period-only"` (L126), **aucun `rangeNote`** | preset affiché, mais **sans effet réel** (§ 9.5) | aucune |

Ce que cela garantit : `/tracing`, `/map`, `/correlation` sont sur le contrat commun P6.2 — plage
personnalisée ≤ 30 j et toutes les dimensions du compilateur s'y appliquent, refusées proprement sinon
(`FilterProblemNotice`). `/slo` et `/alerts` disent explicitement à l'écran, via `FiltersNotAppliedNote`, que
la plage et les filtres ne s'y appliquent pas (`app/slo/page.tsx:53`, `app/alerts/page.tsx:77`), avec la
raison exacte tirée de `surface.noFilters`/`rangeNote`.

Ce que cela ne garantit pas : `/goals` est sur la couche legacy comme `/acquisition`, `/retention`, `/paths`,
`/forms` (déjà notée dans `console-ecrans-2.md` § 1.1) — le bouton « Personnalisée » de la barre du haut n'a
pas d'effet utile sur cet écran, sans que l'écran le dise (il n'a ni `noFilters` ni `rangeNote` dans
`surfaces.ts`, donc `notAppliedOn()` ne produit jamais de note pour `/goals`, `lib/page-filters.ts:58-65`).
`/forecast` est pire : `lib/queries-grid.ts:17` fixe `GRID_DAYS = 14` et `dailyTraffic`/`dailyLcpSeries`
construisent leur fenêtre en dur (`now() - interval '14 days'`, `queries-grid.ts:91, 119`) — **les boutons
1 h / 24 h / 7 j / Personnalisée affichés en haut de `/forecast` n'ont donc aucun effet sur les données du
graphe**, quel que soit le preset cliqué. Contrairement à `/dashboards` et `/` — qui ont exactement le même
comportement de fenêtre fixe 14 j sur un widget, mais le déclarent avec un `rangeNote` explicite
(`"Le widget « Trafic » garde sa fenêtre fixe de 14 jours."`, L111 ; `"L'historique de santé (14 j)…"`,
L133) — `/forecast` ne porte aucun `rangeNote` et n'affiche pas `FiltersNotAppliedNote` (la page ne l'importe
même pas). C'est un écart direct à la règle commune du plan (« presets 1h/24h/7j + plage personnalisée ≤30j »
appliqués partout) : ici le sélecteur existe visuellement mais ment sur son effet.

### 1.2 États chargement / erreur / partiel — aucun de ces huit écrans n'a de frontière dédiée

`ls app/tracing app/tracing/\[traceId\] app/map app/correlation app/goals app/slo app/alerts app/forecast`
ne montre ni `loading.tsx` ni `error.tsx` sur aucune des huit routes (seuls `page.tsx`, et `actions.ts` pour
`/goals` et `/alerts`). Comme déjà noté pour le lot précédent (`console-ecrans-2.md` § 1.2, qui ne l'avait
vérifié que sur 7 routes et disait « non établi, pas reproduit » pour l'absence d'`error.tsx`), une exception
SQL ou de rendu tombe sur la frontière d'erreur par défaut de Next.js. **Ce lot en apporte la preuve directe :
la capture `24-forecast.png` montre exactement cela** — une page blanche avec « Application error: a
server-side exception has occurred while loading localhost … Digest: 2899484112 » (§ 9.2). Lecture du code de
`/forecast` (`lib/queries-grid.ts:110-194`, déjà enveloppé en `try/catch` → `softFail`, `lib/forecast.ts`,
logique pure sans division non gardée, `components/charts/ForecastChart.tsx`, recharts sans garde visible
contre un tableau vide mais qui en reçoit toujours un) : **aucune cause de plantage n'a été identifiée dans
le code lu** pour cette page précise — la cause exacte de ce crash de capture reste **non établie** (incident
ponctuel du serveur de démo au moment de la capture, ou défaut reproductible : à vérifier en relançant
l'écran, pas à classer comme confirmé sur cette seule preuve). Ce qui EST établi : rien dans ces huit écrans
n'affiche de bouton « Réessayer » ni de message d'erreur contrôlé si leur requête plante — contrairement à
`/mobile` qui a les deux (`app/mobile/error.tsx`, cité dans le lot précédent).

Partiel avec raison : seuls `/slo` et `/alerts` ont un message « Filtres non appliqués » dédié
(`FiltersNotAppliedNote`, § 1.1). Aucun des huit écrans n'affiche d'avertissement d'échantillonnage, alors
que `rum_session.sample_rate` existe (déjà relevé dans le lot précédent).

### 1.3 Graphiques employés dans ce lot

| Composant (fichier) | Rendu | Alternative textuelle | Utilisé par |
|---|---|---|---|
| `components/charts/RankBar.tsx` | divs serveur, barres à segments (`RankSegment`, L9-14) | aucune propre au composant | 17 (hero), 21 (hero) |
| `components/charts/Gauge.tsx` | SVG serveur, arc de progression | aucune (pas de `role="img"`/texte alterné identifié dans le skeleton lu) | 22 (hero, une jauge par SLO) |
| `components/charts/StackedBars.tsx` | recharts, `"use client"` probable (non vérifié explicitement mais pattern du fichier) | aucune identifiée | 23 (hero) |
| `components/charts/ForecastChart.tsx` | recharts client (`"use client"`, L1), `LineChart` + `ReferenceLine` de seuil | aucune (juste un `Tooltip` recharts) | 24 (hero — non visible sur la capture, § 9.2) |
| `components/map/ExperienceMap.tsx` | SVG serveur maison, node-link (hors `components/charts/`) | non lue en entier — **non établi** | 19 (hero) |
| `components/features/RobotVsRealChart.tsx` | recharts (composant hors `components/charts/`, dans `components/features/`) | non lue en entier — **non établi** | 20 (hero) |
| waterfall de `/tracing/[traceId]` | HTML/CSS fait main **dans la page elle-même** (pas de fichier dédié dans `components/charts/` ni ailleurs) | aucune (barres positionnées en `%`, `title` HTML seulement) | 18 |
| mini-graphe `ForecastSpark` | SVG fait main **dans `app/forecast/page.tsx:265-302`**, pas dans `components/charts/` | aucune | 24 (3 `MetricCard`) |

Trois graphiques de ce lot vivent hors de `components/charts/` (`ExperienceMap`, `RobotVsRealChart`,
`ForecastSpark`, plus le waterfall qui n'est même pas un composant réutilisable) — l'inventaire du dossier
`components/charts/` seul (`Donut, ForecastChart, Gauge, HealthHeatmap, LineTrend, ObservedTrend, RadarScore,
RankBar, ScatterPlot, StackedBars, TrafficTimeseries, VitalsTimeseries`) sous-compte donc la variété réelle
des rendus visuels de la console — `ScatterPlot.tsx`, `HealthHeatmap.tsx`, `TrafficTimeseries.tsx`,
`VitalsTimeseries.tsx`, `Donut.tsx`, `LineTrend.tsx`, `ObservedTrend.tsx`, `RadarScore.tsx` ne sont utilisés
par **aucun** des huit écrans de ce lot (noms seulement, non lus ici).

### 1.4 Seuils Web Vitals — cohérents sauf sur `/forecast`

`lib/rating.ts:5-11` : `LCP [2500, 4000]`, `INP [200, 500]`, `CLS [0.1, 0.25]`, `FCP [1800, 3000]`,
`TTFB [800, 1800]` — le fichier l'annonce lui-même comme « alignés sur la référence web.dev » (L1) ; ces
valeurs correspondent aux seuils publics web.dev pour les Core Web Vitals. `components/correlation/RouteCard.tsx`
les utilise correctement via `rating2026("LCP", rum)` (L12, import `lib/rating.ts:5`). En revanche
`app/forecast/page.tsx:58` écrit `threshold: 2500` **en dur**, sans importer `THRESHOLDS.LCP` de
`lib/rating.ts` — même valeur aujourd'hui, mais deux sources de vérité pour le même seuil : si `rating.ts`
change un jour (ex. mise à jour des seuils web.dev), `/forecast` ne suivrait pas automatiquement (§ 9.5).

### 1.5 Rendu sombre et largeur 390 px — ce que le code dit, faute de capture

- `SupervisionHero` : une colonne sous `lg` en layout `"split"` (comportement déjà noté dans le lot
  précédent, `components/SupervisionHero.tsx:59`) ; `layout="wide"` (utilisé par `/map`, `app/map/page.tsx:85`)
  place les tuiles au-dessus et le graphe pleine largeur.
- `/tracing/[traceId]` : le waterfall utilise des pourcentages de largeur (`page.tsx:180-181`), donc pas de
  débordement horizontal en soi, mais la largeur plancher de barre est fixée à 0,6 % (L181) — sur une trace à
  beaucoup de spans, illisible en dessous d'un certain nombre plutôt qu'à une largeur d'écran donnée : **non
  établi** à 390 px précisément.
- Tableaux `/tracing`, `/map`, `/correlation`, `/goals`, `/slo`, `/alerts` : `<table className="w-full …">`
  dans une carte `overflow-hidden` (ex. `app/tracing/page.tsx:102, 158, 194`), sans `overflow-x-auto` dédié
  identifié dans les extraits lus → débordement ou troncature à 390 px **non établis**.
- `ExperienceMap` (`/map`) : layout calculé en pixels fixes (`lib/map.ts` `layoutGraph`, largeur =
  `backX + NODE_W + PAD_X`) — l'adaptation à 390 px n'est pas visible dans le skeleton lu, **non établi**.

### 1.6 Le bouton flottant « Votre avis ? »

Présent sur toutes les captures de ce lot en bas à droite, comme pour les lots précédents. Sur
`23-alerts.png`, il recouvre partiellement le bord droit du panneau « Non acquittées »/« Critiques » (zone
x≈1300-1420, y≈820-880).

---

## 2. 17 — Tracing front → back (`/tracing`)

Fichiers : `app/tracing/page.tsx` (215 l.), `lib/queries-tracing.ts` (177 l.), `lib/queries-deploys.ts`,
`components/tracing/{DeployPanel,Section,Empty,ShareBar,SlowRow,format}.tsx`, `components/charts/RankBar.tsx`,
glossaire `lib/glossary.ts:92-115` (clé `tracing`) et `:116` (clé `coverage`, utilisée par le hero).

### 2.1 Question posée
« Une requête lente : est-ce le réseau, le serveur ou le code qui la retarde ? » — décomposer chaque appel
API vu du navigateur en part serveur (jumeau backend trouvé par `trace_id`) contre part réseau/proxy
(`front − back`) (`index.json` entrée 17, `page.tsx:35-36, 58`).

### 2.2 Mise en page réelle (`17-tracing.png`, 1440×1316)
1. `PageHeader` avec bulle glossaire (`help="tracing"`, `page.tsx:32`).
2. `SupervisionHero` en `split` (L34-93) : 3 `HeroStat` + `HeroReading` à gauche, `RankBar` (top 8 appels par
   `front_p75`) à droite avec une légende couleur inline (serveur bleu / réseau-proxy ambre, L62-65).
3. `DeployPanel` (L96) — conditionnel, ne s'affiche pas s'il n'y a aucun déploiement enregistré.
4. Trois sections tableau (`Section`, L98-212) : « Appels API vus du navigateur », « Routes backend »,
   « Traces les plus lentes ».

Capture réelle : **écran entièrement vide sur 7 j** — 0 appel API, 0 route backend, 0 trace, `DeployPanel`
absent (aucun déploiement enregistré dans la démo). Cohérent avec `19-map.png` (§ 4.2), également vide sur la
même fenêtre — les deux écrans partagent la même source (`rum_span`, front+back corrélés).

### 2.3 Widgets

| Widget | Composant / fichier | Mesure — agrégation — dimensions | Requête exacte | États |
|---|---|---|---|---|
| Hero « Latence par appel API — serveur vs réseau » | `RankBar` (`components/charts/RankBar.tsx:34-110`) | `front_p75` = `percentile_cont(0.75)` sur `fr.duration_ms`, `tier='front'` ; segmenté en serveur (`back_p75`) + réseau/proxy (`front_p75 − back_p75`, borné à 0) si un span back existe (même `app_id`+`trace_id`) ; dimension = `method + url` ; top 8 triés par `front_p75` desc (`page.tsx:37-56`) | `apiCalls` (`lib/queries-tracing.ts:52-73`) | vide : texte « Aucun appel API instrumenté sur {période}. » (`page.tsx:71`), pas un graphe vide silencieux |
| `HeroStat` « Appels API (navigateur) » | — | `cov.total` = `count(*) filter (tier='front')` | `traceCoverage` (`queries-tracing.ts:20-40`) | `0` si aucune donnée (compteur réellement vide → `0`, conforme à l'invariant) |
| `HeroStat` « Corrélés au backend » | — | `covPct = round(100·correlated/total)` ou **`"—"`** si `total=0` (`page.tsx:28, 81`) | idem | dénominateur nul → `—`, pas `0 %` (conforme) |
| `HeroStat` « p75 navigateur » | — | `fmtMs(cov.front_p75)`, hint `fmtMs(cov.back_p75)` — `fmtMs` rend `"—"` si `null` (`components/tracing/format.ts:5-6`) | idem | |
| Tableau « Appels API vus du navigateur » | `ShareBar` (`components/tracing/ShareBar.tsx`) pour la colonne Répartition | `n`, `front_p75`, `back_p75`, `err = count(*) filter (status_code≥400 OR status_code=0)` | `apiCalls` (`queries-tracing.ts:52-73`, `limit 50`) | vide : `Empty cols=6 msg="Aucun appel API instrumenté sur la fenêtre"` (`page.tsx:149`) |
| Tableau « Routes backend » | — | `n`, `p75`/`p95` = `percentile_cont`, `err = count(*) filter (status_code≥500)` — **tout trafic confondu, y compris hors navigateur** (sous-titre `page.tsx:156`) | `backRoutes` (`queries-tracing.ts:84-101`, `limit 50`) | vide : « Aucun span backend reçu — middleware non déployé ou trafic nul » (`page.tsx:187`) — **deux causes distinctes nommées**, pas un vide générique |
| Tableau « Traces les plus lentes » | `SlowRow` (`components/tracing/SlowRow.tsx`) | `front_ms`, `back_ms`, `network_ms = greatest(front-back, 0)` si back connu | `slowTraces` (`queries-tracing.ts:158-176`, tri `front.duration_ms desc`, `limit 20`) | vide : `Empty` « Aucune trace sur la fenêtre » (`page.tsx:209`) ; lien vers `/tracing/{traceId}` et `/sessions/{id}` par ligne |
| `DeployPanel` — « Déploiements & régression » | `components/tracing/DeployPanel.tsx` | LCP p75 et **somme** `occurrences` erreurs, avant/après (±2 h) le dernier déploiement ; régression si `after ≥ before × 1.2` (`assessRegression`, `lib/queries-deploys.ts:103-111`, ratio par défaut 1.2) | `listDeploys` (limite 6) + `latestDeployImpact` (`lib/queries-deploys.ts:20-30, 61-92`) — **app entière, fenêtre fixe, plage et filtres de population de l'écran ignorés** (texte affiché, `DeployPanel.tsx:27`) | vide : **ne s'affiche pas du tout** (`return null`, `DeployPanel.tsx:16`) — aucun message « pas de déploiement enregistré » |

### 2.4 Meilleur que Datadog / IP-Label — à conserver
- **Décomposition front/serveur/réseau par appel**, calculée à partir du même schéma `rum_span` (front + back
  corrélés par `trace_id`) que le reste de la console, sans produit séparé. Chez Datadog, la corrélation
  RUM↔APM (trace propagée jusqu'au serveur) est un produit distinct (APM) à connecter en plus du RUM — le
  détail exact de cette intégration chez Datadog n'a pas été relu dans ce lot, **non établi** en profondeur,
  mais le principe d'un produit APM séparé est de notoriété publique.
- `DeployPanel` : bandeau de régression post-déploiement en langage clair (« LCP p75 +X % », « erreurs JS
  +Y % ») directement sur l'écran de tracing, sans tableau de bord séparé à construire, avec un seuil de
  régression documenté et testable (`ratio = 1.2`). Sera conservé.
- Messages d'état vide qui nomment la cause probable (« middleware non déployé ou trafic nul ») plutôt qu'un
  « aucune donnée » générique.

### 2.5 Plus faible
- `DeployPanel` disparaît silencieusement tant qu'aucun déploiement n'est enregistré, sans dire comment en
  enregistrer un (pas de CTA ni de lien vers une doc d'intégration) — l'utilisateur ne découvre la
  fonctionnalité qu'après avoir déjà branché l'enregistrement de déploiements ailleurs.
- Le hero (`RankBar`) et le tableau « Appels API » n'ont ni recherche ni filtre texte sur l'URL — sur un
  grand nombre d'endpoints distincts, retrouver un appel précis demande de parcourir jusqu'à 50 lignes.
- `DeployPanel` ne calcule la régression QUE pour le **dernier** déploiement (`latestDeployImpact`) alors que
  `listDeploys` en remonte jusqu'à 6 — les 5 précédents sont listés sans verdict de régression associé.

### 2.6 Déjà disponible côté requêtes, non affiché
- `TraceSpanRow.kind` (db vs interne) existe (`queries-tracing.ts:115-129`) mais n'est exploité que sur
  `/tracing/[traceId]` ; la liste `/tracing` n'affiche jamais la proportion d'appels dont le ralentissement
  vient spécifiquement de la base de données.
- `mapNodes`/`mapEdges` (`lib/queries-map.ts`) recalculent une partie des mêmes données (`rum_span` front/back
  corrélés) pour `/map` — aucun lien croisé identifié dans le code lu entre le tableau « Routes backend » de
  `/tracing` et la carte de `/map` pour la même route.

---

## 3. 18 — Détail de la trace (`/tracing/[traceId]`)

Fichiers : `app/tracing/[traceId]/page.tsx` (230 l.), `lib/queries-tracing.ts` (`traceSpans`, L142-155),
`lib/query-contract.ts` (`authorizedAppsOf`).

### 3.1 Question posée
« Pour CETTE requête précise, où est passé le temps, span par span, jusqu'à la cause backend ? » — c'est
l'écran de zoom que `/tracing` (agrégé) ne fournit pas (commentaire en tête de fichier, `page.tsx:1-5`).

### 3.2 Mise en page réelle (`18-trace-detail.png`, 1440×1029, route
`/tracing/1ef6ed51e9aff8b619fa50d9ff1f15ed`)
1. `PageHeader` avec lien retour « ← Tracing » (`page.tsx:100-112`).
2. 4 cartes résumé en grille (`grid-cols-2 sm:grid-cols-4`, L115-147) : Latence perçue / Spans / Route /
   Session.
3. Bandeaux conditionnels (absents sur cette capture) : « Aucun span backend reçu » si `!hasBackend`
   (L149-154) ; état du span ciblé par `?span=` si présent (L156-169).
4. Waterfall : liste de spans, chacun une barre positionnée par son offset réel + durée (L172-220).
5. Légende couleur en pied de page (L222-226).

Capture réelle : trace à **2 spans seulement** — `front` 163 ms (navigateur, statut 200), `back` 160 ms
(serveur, statut 200) — donc ~98 % du temps perçu est côté serveur sur cet exemple précis. Latence perçue
163 ms, Spans = 2, Route « / », Session `bf0a49c2…` (lien cliquable).

### 3.3 Widgets

| Widget | Composant / fichier | Mesure | Requête | États |
|---|---|---|---|---|
| 4 cartes résumé | — | Latence perçue = `front?.duration_ms ?? total` ; Spans = `spans.length` ; Route = `front?.route ?? front?.url ?? "—"` ; Session = lien `/sessions/{id}?app=…` si un span porte un `session_id`, sinon `—` (`page.tsx:93-146`) | `traceSpans` (`lib/queries-tracing.ts:142-155`) | Route/Session à `—` si absents (jamais de valeur inventée) |
| Waterfall | HTML/CSS fait main **dans la page** (pas de composant `components/charts/`) | Barre par span, `leftPct = (start−t0)/total×100`, `widthPct = duration/total×100` (plancher 0,6 %, `page.tsx:180-181`) ; couleur par `tier` : front=bleu (`bg-perf`), back=orange (`bg-accent`), `detail`+`kind='db'`=violet (`bg-ai`), sinon gris ; profondeur visuelle = chaîne `parent_span_id` réelle si connue, sinon repli par `tier` (`depthOf`, L71-77) | `traceSpans`, triée `ts asc, tier(front<back<detail)` (`queries-tracing.ts:152`) | 0 span dans le périmètre autorisé → `notFound()` **404 Next.js**, pas un message « aucune donnée » in-page (L67) |
| Bandeau « Aucun span backend reçu » | — | conditionnel sur `hasBackend = spans.some(tier∈{back,detail})` | idem | affiché seulement si absent — donne l'action (« Déployez le middleware MIP ou un agent OpenTelemetry ») |
| Bandeau span ciblé | — | `?span=<id>` (deep-link, ex. depuis une erreur) → 2 états distincts : `"found"` (span mis en évidence) ou `"missing"` (`spanState`, L88-91, 156-169) — pas un simple booléen | — | `role="status"`, `data-span-state` |

### 3.4 Meilleur que Datadog / IP-Label — à conserver
- Isolation multi-tenant explicite et commentée : `traceApps()` (L43-47) borne les spans visibles au
  périmètre applicatif signé même si le `trace_id` est partagé entre deux tenants, avec la justification
  écrite dans le code (« un trace_id est émis par le client, deux tenants peuvent le partager »). Le
  comportement voulu (« une trace dont il ne reste rien est introuvable, sans dire si elle existe ailleurs »,
  L64-66) est un choix de sécurité assumé, pas un oubli.
- Trois messages d'état distincts (span introuvable / aucun span backend / trace introuvable) plutôt qu'un
  état d'erreur générique unique.
- Le waterfall positionne chaque span sur son offset réel (`ts`), donc un chevauchement front/back ou un
  écart temporel entre deux appels se voit directement — pas un simple ordre de liste.

### 3.5 Plus faible
- Pas de zoom ni d'échelle temporelle graduée sur le waterfall — juste un pourcentage de largeur totale avec
  un plancher de 0,6 % ; sur une trace à beaucoup de sous-appels internes, les barres les plus courtes
  deviennent illisibles sans qu'aucun mécanisme de zoom ne soit identifié dans le code lu.
- Aucun bouton de copie pour le `trace_id` complet (tronqué à 16 caractères à l'écran, L105).
- Un span de statut d'erreur (5xx/4xx) porte la même couleur qu'un span identique de statut 200 — le
  `status_code` est affiché en petit texte (L200-202) mais ne colore pas la barre.

### 3.6 Déjà disponible côté requêtes, non affiché
- `TraceSpanRow.app_id` existe par span (utilisé pour le filtrage de sécurité) mais n'est jamais affiché à
  l'écran — utile pourtant pour une trace dont les spans viendraient de plusieurs apps autorisées à la fois.
- `kind` distingue déjà `db` des autres sous-appels (utilisé pour la couleur) mais aucun texte de requête ou
  de cible (ex. nom de table) n'est stocké/affiché — cohérent avec ce que `rum_span` retient (`name`, `kind`,
  `duration_ms`, pas de détail de requête).

---

## 4. 19 — Carte d'expérience (`/map`)

Fichiers : `app/map/page.tsx` (223 l.), `lib/queries-map.ts` (95 l.), `lib/map.ts` (fonctions pures :
`apiHealth`, `pageHealth`, `trend`, `atRisk`, `layoutGraph`), `components/map/ExperienceMap.tsx`, glossaire
`lib/glossary.ts:216` (clé `experienceMap`).

### 4.1 Question posée
« Quelles briques du parcours (pages → API → backend) sont sollicitées, lesquelles souffrent, et lesquelles
montent en charge ? » — un seul graphe pour cartographie + volumétrie + tendance (`index.json` entrée 19,
`page.tsx:65`).

### 4.2 Mise en page réelle (`19-map.png`, 1440×1029)
1. `PageHeader` avec bulle glossaire (`help="experienceMap"`).
2. Si `nodes.length === 0` : **un seul encart texte**, rien d'autre (`page.tsx:68-72`).
3. Sinon (non visible sur la capture, décrit depuis le code, `page.tsx:74-209`) : bandeau conditionnel
   « N route(s) en hausse à surveiller » ; `SupervisionHero` `layout="wide"` avec `ExperienceMap` (graphe SVG
   2 colonnes) ; tableau « Top talkers » (8 lignes) ; tableau « Pages d'entrée » (jusqu'à 12 lignes,
   conditionnel).

Capture réelle : **vide** — « Aucun appel corrélé sur la période — la carte se remplit dès que le tracing
front→back émet (voir Tracing). » Cohérent avec `/tracing` vide sur la même fenêtre (§ 2.2) : `mapNodes` lit
`rum_span`, la même table que le tracing.

### 4.3 Widgets

| Widget | Composant / fichier | Mesure — agrégation — dimensions | Requête | États |
|---|---|---|---|---|
| `ExperienceMap` (hero) | `components/map/ExperienceMap.tsx` — SVG serveur fait main, aucune dépendance de graphe (`index.json` entrée 19) | nœuds = routes front/back (`mapNodes`), **CAP=10 par colonne** (top volume, `page.tsx:26, 45-47`, compteur « +N masquées ») ; arêtes = `mapEdges`, largeur 1-6 px proportionnelle au volume (`layoutGraph`, `lib/map.ts:84-126`) ; couleur = `apiHealth(error_rate, latency_p75)` : `bad` si err≥10 % ou p75≥3000 ms, `warn` si err≥2 % ou p75≥1000 ms, sinon `good` (`lib/map.ts:10-15`) ; tendance = `trend(recent, older)` sur les deux moitiés temporelles de la fenêtre, `"flat"` si `recent+older<5` (évite de conclure sur peu de données, `lib/map.ts:26-31`) ; « à risque » = tendance `up` ET santé non-`good` (`atRisk`, `lib/map.ts:34-36`) | `mapNodes` (`lib/queries-map.ts:22-45`, `limit 40`), `mapEdges` (`:54-69`, `limit 80`, jointure `trace_id`) | vide bloqué en amont par `nodes.length===0` (§ 4.2) |
| Bandeau « routes à risque » | — | liste jusqu'à 4 routes à risque, `+N` au-delà (`page.tsx:75-81`) | dérivé de `mapNodes` | absent si `riskNodes.length===0` |
| `HeroStat` « Routes cartographiées » | — | `frontAll.length+backAll.length` — total réel, **y compris les routes masquées** au-delà du `CAP` | idem | |
| `HeroStat` « Routes à risque » | — | `riskNodes.length` | idem | tone `warn`/`good` |
| `HeroStat` « Route la plus active » | — | `talkers[0]` | idem | |
| Tableau « Top talkers » | — | 8 routes triées par `calls desc` (front+back confondus) : tier/route/appels/latence p75/% erreur/tendance textuelle (▲/▼/—, pas de valeur chiffrée) | réutilise `mapNodes` | pas de message vide dédié — la section n'apparaît que si `!empty` |
| Tableau « Pages d'entrée » | — | route/sessions (`count distinct session_id`)/LCP p75 | `mapPages` (`lib/queries-map.ts:78-94`, dataset `vitals`, `limit 12`) | section entière absente si `pages.length===0` (`page.tsx:177`) — **pas de message dédié**, juste rien |

### 4.4 Meilleur que Datadog / IP-Label — à conserver
- Un seul graphe fusionne trois lectures que Datadog sépare en produits distincts (Service Map côté APM,
  Watchdog pour les anomalies, capacity planning en dashboard custom) : santé, tendance et « à risque »
  (santé dégradée + volume en hausse) sont calculés et affichés ensemble sur chaque nœud, sans corrélation
  manuelle entre écrans. Comparaison Datadog **non établie** en détail (pas de capture de leur Service Map
  dans ce lot), fondée sur la connaissance générale des produits.
- Seuil explicite anti-sur-interprétation sur la tendance (`trend()`, `lib/map.ts:26-31`) : pas de flèche
  « en hausse » affichée sur du bruit statistique à faible volume.
- Rendu SVG interne sans dépendance de graphe tierce (allégement potentiel, non mesuré).

### 4.5 Plus faible
- La carte dépend entièrement de `rum_span` (front+back corrélés) via `mapNodes` ; si `nodes.length===0`
  (aucun span, y compris si le middleware backend seul manque), **toute la page** — y compris la section
  « Pages d'entrée », qui elle dépend de `rum_metric`/`vitals` et pourrait avoir des données — reste masquée
  par la condition `empty` (`page.tsx:58, 68`). Une perte d'information potentiellement affichable.
- Plafond fixe de 10 nœuds par colonne sans pagination ni recherche pour atteindre les routes masquées.
- `mapEdges` ne restreint pas au `CAP` ; `layoutGraph` ignore silencieusement (`continue`) une arête dont une
  extrémité n'est pas dans le top 10 affiché (`lib/map.ts`, section `layoutGraph`) — le volume vers une route
  masquée est donc invisible, pas seulement le nœud lui-même.
- Tendance affichée en texte (▲/▼/—) sans pourcentage, alors que `mapNodes` calcule `recent`/`older` bruts.

### 4.6 Déjà disponible côté requêtes, non affiché
- `MapNodeRow.recent`/`older` (compte d'appels par demi-fenêtre) : seule la direction (up/down/flat) est
  utilisée dans le graphe ET le tableau — l'amplitude n'apparaît nulle part.
- `mapEdges` retourne toutes les paires front→back avec leur volume ; celles dont une extrémité est masquée
  (au-delà du `CAP`) pourraient au moins alimenter un total « N appels vers des routes non affichées ».

---

## 5. 20 — Corrélation synthétique ↔ RUM (`/correlation`)

Fichiers : `app/correlation/page.tsx` (145 l.), `lib/queries-v2.ts` (§ corrélation, L384-488),
`components/correlation/{RouteCard,BlindSpotRow,state}.tsx`, `components/features/RobotVsRealChart.tsx`.

### 5.1 Question posée
« Ce que le robot MIP voit (DEM synthétique) correspond-il à ce que les vrais utilisateurs vivent (RUM) — et
où le robot a-t-il un angle mort ? » (`page.tsx:39`, sous-titre).

### 5.2 Mise en page réelle (`20-correlation.png`, 1440×1552)
1. `PageHeader`.
2. `SupervisionHero` (`split`) : chips de sélection de route à droite du titre (jusqu'à 6 affichées, L46-62),
   courbe double robot/réel pour la route sélectionnée.
3. Liste de `RouteCard` (une carte par route corrélée, robot vs réel côte à côte).
4. Bloc rouge « Angles morts » avec tableau (L107-141).

Capture réelle : **données présentes** (contrairement aux écrans précédents) — 2 routes corrélées, 0 angle
mort, courbe « /partners » avec un pic net vers 18/09 09 h (~950 ms) puis retour à la normale.

### 5.3 Widgets

| Widget | Composant / fichier | Mesure — agrégation — dimensions | Requête | États |
|---|---|---|---|---|
| Hero « Robot vs réel dans le temps » | `RobotVsRealChart` (`components/features/RobotVsRealChart.tsx`, hors `components/charts/`) | 2 séries par seau horaire : robot = `avg(latency_ms)` (`syn_snapshot`), réel = `LCP p75` (`percentile_cont`, `rum_metric`) — jointure `full outer`, donc un point peut être robot-only, réel-only ou les deux | `correlationSeries(route, f)` (`lib/queries-v2.ts:451-463`) pour la route sélectionnée (`?serie=`) | texte « Pas encore de route avec données robot ET réel sur la période. » si aucune route sélectionnable (`page.tsx:74-77`) |
| `HeroStat` « Routes corrélées » | — | routes avec robot ET réel disponibles sur la fenêtre (`HAVING count(robot)>0 AND count(réel)>0`) | `correlationRoutes` (`queries-v2.ts:429-442`) | |
| `HeroStat` « Angles morts » | — | `spots.length` | `blindSpots` | tone `poor`/`good` |
| `RouteCard` (par route) | `components/correlation/RouteCard.tsx` | Robot : `avg(latency_ms)`, `score` moyen, état = **pire** `syn_state` sur la fenêtre (`ok`/`warn`/`incident`), `syn_measures` = `string_agg` des noms de mesure DEM. Réel : LCP p75 + `rating2026("LCP", rum)`, INP p75, `count distinct session_id`. Badge d'écart signé = `(rum−syn)/syn×100`, vert si négatif avec phrase « réel plus rapide que le robot », rouge si positif avec phrase « les utilisateurs subissent plus que le robot ne voit » (`RouteCard.tsx:11-32`) | `correlationCards` (`queries-v2.ts:415-426`, `full outer join` sur route) | pas de mesure robot → « pas de mesure synthétique sur cette route » ; pas de trafic réel → « pas encore de trafic réel sur cette route » (`RouteCard.tsx:56, 79`) |
| Tableau « Angles morts » | `BlindSpotRow` | Prédicat exact codé : heures où `syn_state='ok'` ET `rum_lcp_p75>2500` ET `syn_latency_avg` non nul (`blindSpots`, `queries-v2.ts:476-488`) — écart en ms affiché, trié desc, `limit 50` | idem | vide : « Aucun angle mort détecté sur la période 👍 » (`page.tsx:135`) |

### 5.4 Meilleur que Datadog / IP-Label — à conserver
- Définition d'« angle mort » codée en un prédicat SQL exact et documenté (robot `ok` + réel LCP>2,5 s), pas
  une simple superposition visuelle de deux courbes laissée à l'interprétation — **non établi** que Datadog
  ou IP-Label calculent une telle divergence de façon automatisée (pas de capture ni de doc consultée sur ce
  point précis dans ce lot) ; le principe général (DEM et RUM séparés en produits/écrans distincts chez
  IP-Label) est de notoriété publique.
- Badge d'écart signé avec phrase explicite plutôt qu'un simple chiffre laissé à interpréter.

### 5.5 Plus faible
- Le « score » synthétique (`syn_score_avg`) est affiché sans barème documenté sur cet écran (pas d'échelle
  0-100 expliquée ni de seuil visible) — la capture montre « score 92 » avec un badge « incident » simultané
  sur la même carte (`20-correlation.png`, carte « / ») : le badge d'état vient du **pire** `syn_state` sur
  toute la fenêtre tandis que le score est une **moyenne** — les deux peuvent diverger sans qu'aucun texte à
  l'écran n'explique pourquoi un score élevé côtoie un badge « incident ».
- Un seul sélecteur de route à la fois pour le graphe temporel (chips, max 6 affichées) — pas de
  superposition multi-route.
- Le tableau « Angles morts » est plafonné à 50 lignes sans pagination ni compteur « sur N au total ».

### 5.6 Déjà disponible côté requêtes, non affiché
- `correlationSeries` ne remonte que `rum_lcp_p75`/`syn_latency_avg` (`queries-v2.ts:451-463`) — la courbe
  temporelle ne trace jamais l'INP, alors que `RouteCard` l'affiche déjà en instantané
  (`rum_inp_p75`, `correlationCards`) et que `rum_metric` porte la donnée (`name='INP'`).
- `syn_measures` (types de mesures DEM ayant contribué) est affiché en petit texte tronqué dans `RouteCard`
  mais absent du tableau des angles morts, qui pourrait en bénéficier pour dire QUEL scénario robot a raté
  l'incident réel.

---

## 6. 21 — Objectifs (`/goals`)

Fichiers : `app/goals/page.tsx` (232 l.), `app/goals/actions.ts`, `lib/queries-goals.ts` (82 l.),
`lib/goals.ts`.

### 6.1 Question posée
« Quelle part des sessions atteint chaque objectif (page ou événement) au moins une fois — et lequel convertit
le mieux ? » (`page.tsx:37-40`).

### 6.2 Mise en page réelle (`21-goals.png`, 1440×1029)
1. `PageHeader`.
2. Bandeau erreur conditionnel (`?error=1`, formulaire invalide, L43-47).
3. Hero conditionnel (`rows.length>0` seulement) : `RankBar` du taux par objectif (L49-87).
4. Tableau « objectifs » — taux + barre de progression inline (L89-127).
5. Section admin (visible seulement si `user.role==='admin'`) : formulaire de création + tableau de gestion
   incluant les objectifs inactifs (L129-228).

Capture réelle : **vide** — aucun objectif actif dans la démo (« Aucun objectif actif — crées-en un
ci-dessous. »), formulaire de création affiché (utilisateur admin), tableau de gestion « Aucun objectif
défini ».

### 6.3 Widgets

| Widget | Composant / fichier | Mesure — agrégation — dimensions | Requête | États |
|---|---|---|---|---|
| Hero `RankBar` « Taux de conversion par objectif » | `components/charts/RankBar.tsx` | `rate = conversions/total`, échelle **fixe** 0-100 % (`max={100}` explicite, `page.tsx:66`, pas relative aux données) ; top 8 triés par taux desc | `goalConversions` (`lib/queries-goals.ts:69-81`) | absent si `rows.length===0` (pas de message hero dédié, juste pas de hero) |
| `HeroStat` « Sessions » | — | `total = windowSessions(f)` = `count distinct session_id` ayant vu ≥1 page sur la fenêtre — dénominateur commun à tous les objectifs (`queries-goals.ts:27-40`) | idem | |
| `HeroStat` « Objectifs suivis » / « Meilleur taux » | — | `rows.length` / `byRate[0]` | idem | |
| Tableau détail | — | Objectif / Condition (`kind` event\|page + `match_type` exact `=` ou contient `⊃`) / Conversions / Taux (barre + %) — une requête `goalHits` **par objectif**, en boucle séquentielle (`for (const g of goals) { await goalHits(...) }`, `queries-goals.ts:75-78`) | `goalHits` (`queries-goals.ts:43-66`, `count distinct session_id`, jointure `rum_event.name` ou `rum_pageview.route` selon `kind`, pattern lié en `$3` jamais interpolé, commentaire explicite L4-5) | vide : « Aucun objectif actif{ — crées-en un ci-dessous si admin} » (`page.tsx:118-124`), message conditionnel selon rôle |
| Formulaire création (admin) | — | App/Nom/Type(page vue\|événement)/Correspondance(exacte\|contient)/Motif | action `createGoalAction` (`app/goals/actions.ts`, non détaillée) | |
| Tableau gestion (admin) | — | tous les objectifs (actifs+inactifs), toggle Activer/Désactiver, Supprimer | `listGoals` (`queries-goals.ts:16-24`) | vide : « Aucun objectif défini » |

### 6.4 Meilleur que Datadog / IP-Label — à conserver
- Les objectifs sont explicitement indépendants les uns des autres (« pas des étapes d'un même entonnoir »,
  `HeroReading`, `page.tsx:82`) — évite la confusion fréquente objectif/funnel ; tous les taux partagent le
  même dénominateur (`windowSessions`), donc les barres sont comparables entre elles sans biais de
  dénominateur variable.
- Le pattern de correspondance est un paramètre SQL lié (`$3`), jamais interpolé — anti-injection documenté
  explicitement dans le commentaire du fichier, pas seulement supposé.

### 6.5 Plus faible
- **`conversionRate` renvoie `0`, pas `null`, quand le dénominateur est nul** (`sessions > 0 ? conversions /
  sessions : 0`, `lib/goals.ts:25-27`) — si `windowSessions(f)` vaut 0 (aucune session sur la fenêtre), tous
  les taux d'objectifs actifs s'afficheraient à « 0,0 % » comme une vraie mesure, pas comme une inconnue. Ceci
  **contredit directement l'invariant « métrique sans dénominateur = null »** que le reste des écrans du dépôt
  respecte scrupuleusement (`fmtMs`/`fmtVital`/`fmtPct` rendent tous `"—"` sur `null`, `lib/format.ts`,
  `components/tracing/format.ts`).
- `/goals` est sur la couche legacy (`lib/surfaces.ts:121`, `range: "presets", legacy: "segments"`) : **pas de
  plage personnalisée possible**, contrairement à `/tracing`, `/map`, `/correlation` du même lot — et rien à
  l'écran ne le signale (§ 1.1).
- `goalConversions` exécute N requêtes SQL séquentielles (une par objectif actif) plutôt qu'une seule requête
  agrégée — non chiffré ici, mais un motif N+1 qui peut ralentir l'écran à mesure que le nombre d'objectifs
  actifs augmente.
- Aucun graphique temporel du taux de conversion (tendance jour/jour) — seulement un instantané sur la
  fenêtre choisie.

### 6.6 Déjà disponible côté requêtes, non affiché
- `windowSessions` et `goalHits` filtrent déjà par `device` et par segment (`f.device`, `buildSegment`) — la
  ventilation par device n'est cependant jamais affichée côte à côte (un seul total, pas de répartition
  visible à l'écran).
- `rum_event`/`rum_pageview` portent un `ts` exploitable ; aucun horodatage de « dernière conversion » n'est
  affiché par objectif.

---

## 7. 22 — SLO & error-budget (`/slo`)

Fichiers : `app/slo/page.tsx` (207 l.), `lib/queries-alerting.ts` (§ SLO, L1-92), `lib/dashboard-blocs.ts`,
`components/slo/SloStatusRow.tsx`, `components/charts/Gauge.tsx`, `components/TousEteints.tsx`.

### 7.1 Question posée
« Chaque objectif de service (SLO) est-il tenu, et à quelle vitesse le budget d'erreur autorisé se
consomme-t-il (burn-rate) ? » (`page.tsx:47-51`).

### 7.2 Mise en page réelle (`22-slo.png`, 1440×1029)
Écran composé de **3 blocs configurables** via une roue (⚙️ dans la nav, `lib/dashboard-blocs.ts`, catalogue
`href:"/slo"` L113) : `budget` (hero jauges), `creation` (formulaire), `liste` (tableau) — cookie de
préférence lu côté serveur (`page.tsx:29-31`). Si les 3 sont éteints : `<TousEteints/>` (L203).
`FiltersNotAppliedNote` en tête d'écran (L53) — l'écran est une configuration, ignore volontairement
plage/device/segment ; seul `app_id` s'applique.

Capture réelle : bloc « budget » **absent** (aucun SLO actif → `statuses.length===0` empêche le hero,
condition `page.tsx:55`) ; formulaire de création affiché, **déplié par défaut** (`open={!slos.length}`,
L105) ; tableau vide « Aucun SLO — crée le premier ci-dessus. »

### 7.3 Widgets

| Widget | Composant / fichier | Mesure | Requête | États |
|---|---|---|---|---|
| Hero « Budget d'erreur consommé » | `Gauge` (`components/charts/Gauge.tsx`), une jauge par SLO actif, jusqu'à 10 (`statuses.slice(0,10)`) | `burned_pct` — **calculé côté SQL par la fonction `slo_status()`, non relue dans ce passage** ; formule exacte d'`attainment`/`burned_pct`/`fast_burn` **non établie** ici (vit en migration SQL, pas en TypeScript) | `sloStatus` (`lib/queries-alerting.ts:30-42`, appelle `slo_status(app?)`) | tone `poor` si `fast_burn` ou `burned_pct≥100`, `warn` si `≥75`, sinon `good` (`page.tsx:56-60`) |
| `HeroStat` « SLO actifs » / « En dépassement » / « Burn rapide » | — | `statuses.length` / `burned_pct≥100` count / `fast_burn` count | idem | tone `poor`/`warn`/`good` |
| Formulaire création | `Field`, `INPUT_CLASS` (`components/forms/Field.tsx`) | App / Nom / Métrique (`SLO_METRICS = [LCP,INP,CLS,FCP,TTFB,error_rate]`, `lib/queries-v2.ts:87`) / Objectif % (0,1-99,99) / Fenêtre jours (1-90, défaut 28) / Route optionnelle | action `createSloAction` (**partagée avec `/alerts`**, `app/alerts/actions.ts`) | |
| Tableau liste | `SloRow` (`components/slo/SloStatusRow.tsx`) | superpose le statut calculé (indexé par `slo_id`) sur **TOUS** les SLO déclarés (actifs + désactivés) — permet de réactiver un SLO qui sort de `slo_status()` une fois désactivé (commentaire `page.tsx:38-39`) | `listSlo` (`lib/queries-alerting.ts:57-66`) | vide : message conditionnel selon si le bloc « creation » est aussi actif (`page.tsx:191-196`) — évite « crée le premier ci-dessus » si le formulaire est justement masqué par la config de blocs |

### 7.4 Meilleur que Datadog / IP-Label — à conserver
- Écran personnalisable par blocs (budget/création/liste) via cookie, avec un état « tout éteint » explicite
  géré (`TousEteints`) — mécanique transversale (partagée avec `/` et `/sessions`, `lib/dashboard-blocs.ts:43,
  78, 113`) qui n'a pas d'équivalent identifié dans les captures/docs Datadog consultées jusqu'ici
  (**non établi** en comparaison directe, pas de capture Datadog SLO dans ce lot).
- Le tableau superpose statut calculé et SLO désactivés pour permettre la réactivation — évite l'écueil « un
  SLO désactivé disparaît et on ne sait plus comment le réactiver ».

### 7.5 Plus faible
- La formule exacte d'« attainment » / « burned_pct » / « fast_burn » vit dans une fonction SQL (`slo_status()`)
  non lue dans ce passage — ce qu'affiche vraiment la jauge n'est donc pas vérifiable depuis le seul code
  TypeScript de ce lot ; à documenter/vérifier côté migration SQL avant d'en promettre le comportement exact.
- La capture est vide : impossible de confirmer visuellement le rendu des couleurs poor/warn/good sur des
  données réelles dans ce lot (jugé sur lecture de code uniquement).
- Aucun lien croisé identifié entre une ligne SLO et les alertes qu'il a pu déclencher (l'écran `/alerts`
  existe séparément).

### 7.6 Déjà disponible côté requêtes, non affiché
- `SloStatusRow.route` (route optionnelle du SLO) est utilisée dans le formulaire de création mais absente
  des colonnes du tableau de statut (SLO/Métrique/Objectif/Fenêtre/Atteinte/Budget consommé — pas de colonne
  « Route », `page.tsx:174-183`) alors que deux SLO peuvent porter le même nom sur des routes différentes.

---

## 8. 23 — Alertes (`/alerts`)

Fichiers : `app/alerts/page.tsx` (256 l.), `app/alerts/actions.ts`, `lib/queries-v2.ts` (§ alerting,
L87-269), `components/alerts/{RuleRow,RuleFields,ChannelsSection,SeverityBadge}.tsx`,
`components/charts/StackedBars.tsx`.

### 8.1 Question posée
« Quelles règles de seuil/anomalie se sont déclenchées, ont-elles été notifiées quelque part, et ont-elles
été traitées (acquittées) ? » (`page.tsx:63-67`).

### 8.2 Mise en page réelle (`23-alerts.png`, 1440×1578)
1. `PageHeader` avec badge « N non acquittée(s) » conditionnel + bouton « Évaluer maintenant »
   (`evaluateNowAction`, L48-76).
2. Bandeau résultat d'évaluation conditionnel (`?fired=N`, L79-90).
3. Hero (si `events.length>0`) : `StackedBars` par sévérité/jour (L92-142).
4. Formulaire « + Nouvelle règle » — déplié si aucune règle ou `?issue=` pré-rempli (L145-155).
5. Liste `RuleRow` (L158-167).
6. Avertissement « Aucun canal de notification actif » — conditionnel (L174-184).
7. Flux d'événements déclenchés (L169-249).
8. `ChannelsSection` (L252).

Capture réelle : 1 règle active (LCP, seuil visible « > 100 », `window_minutes=60`), 1 événement déclenché
(`warning`, « LCP > 737.6 (seuil 100, fenêtre 60 min, app demo-app) », **non livré**), 0 canal actif →
avertissement jaune affiché au-dessus du flux.

### 8.3 Widgets

| Widget | Composant / fichier | Mesure — agrégation | Requête | États |
|---|---|---|---|---|
| Hero « Événements d'alerte dans le temps — par sévérité » | `StackedBars` (`components/charts/StackedBars.tsx`) | count d'`alert_event` par jour (libellé JJ/MM) × sévérité (couleur fixe : critical/page/error=rouge, warning/warn=ambre, info=bleu) — **agrégation faite en mémoire côté page** sur les 100 événements déjà remontés par `alertEvents`, pas une requête SQL groupée par jour sur toute la fenêtre (`page.tsx:102-117`) | `alertEvents` (`lib/queries-v2.ts:230-252`, `order by fired_at desc limit 100`) | absent si `events.length===0` |
| `HeroStat` « Événements » | — | `events.length`, hint « 100 plus récents » — **l'écran annonce lui-même sa limite** | idem | |
| `HeroStat` « Non acquittées » | — | `unackedAlertCount` — requête SQL séparée, **non plafonnée à 100** | `unackedAlertCount` (`queries-v2.ts:254-269`) | tone `poor`/`good` |
| `HeroStat` « Critiques » | — | `events.filter(sev∈{critical,page,error}).length` | dérivé de `alertEvents` | |
| Formulaire règle | `RuleFields` (`components/alerts/RuleFields.tsx`, formulaire HTML pur, **aucun `"use client"`/`useState`** — server component, champs affichés à plat sans masquage conditionnel côté client) | 2 modes : `threshold` (comparateur `>`/`<` + seuil fixe) ou `baseline` (sensibilité + semaines de référence, `lib/alerting.ts` `ALERT_MODES`) ; 4 familles de métriques : `SLO_METRICS` (vitals+`error_rate`), `log_errors`, `event:<nom>`, `issue:<uuid>` (`ALERT_METRICS`, `queries-v2.ts:87-93`) | action `createRuleAction` | la capture montre les 13 champs dépliés simultanément (Comparateur/Seuil ET Sensibilité/Semaines baseline visibles ensemble) — confirmé par le code : pas de logique de masquage par mode |
| `RuleRow` (par règle) | `components/alerts/RuleRow.tsx` | `last_state` (`ok`/`breached`/`no_data`, `RULE_STATES`, `queries-v2.ts:99`) lu via `to_jsonb(r)->>'last_state'` plutôt qu'une colonne nommée — commentaire explicite : « une clé absente vaut NULL, là où citer la colonne ferait échouer la page si la console précède la migration-v73 » (`queries-v2.ts:161-162`) ; `no_data` affiche **la raison** (`rule.last_reason`) au lieu de passer pour une valeur normale (`RuleRow.tsx:19-30`, commentaire « no_data dit pourquoi, au lieu de passer pour une valeur normale ») | `alertRules` (`queries-v2.ts:159-179`) | 3 états visuels distincts (Normale/Franchie/Données insuffisantes, `ETATS`, `RuleRow.tsx:7-17`) |
| Flux d'événements | — | 3 états de livraison, pas 2 : `delivered>0` (« livrée ×N », code 2xx confirmé) / `pending>0` (« en attente ×N », transmis mais code pas encore confirmé) / sinon « non livrée » — commentaire explicite : « confondre [pending] avec un succès était le défaut corrigé par v49 » (`page.tsx:206-208`) | `alertEvents` (jointure `alert_delivery`, `queries-v2.ts:235-237`) | |
| Avertissement « Aucun canal de notification actif » | — | `!channels.some(c=>c.active) && events.length>0` — placé **au-dessus** du flux, pas seulement dans la section Canaux plus bas (commentaire explicite, `page.tsx:171-173`) | `listChannels` | |
| `ChannelsSection` | `components/alerts/ChannelsSection.tsx` | webhook/Slack livrés, e-mail « inactif tant qu'un provider n'est pas configuré » (sous-titre affiché à l'écran) | — | |

### 8.4 Meilleur que Datadog / IP-Label — à conserver
- État de livraison à 3 valeurs (livrée/en attente/non livrée) plutôt qu'une simplification binaire
  envoyé/pas-envoyé — et le code documente explicitement le bug qu'il corrige (v49), signal de rigueur plutôt
  qu'une simple assertion.
- Le bandeau « aucun canal actif » place le risque « alerte déclenchée sans que personne ne le sache »
  directement sur l'écran des alertes lui-même, au-dessus du flux — **non établi** que Datadog affiche un
  avertissement aussi frontal au même endroit (pas de capture Monitors/Notify consultée dans ce lot).
- `no_data` (donnée insuffisante) est distingué de `ok`, avec sa raison textuelle affichée — cohérent avec
  l'invariant « inconnu ≠ 0 » du dépôt.
- Compatibilité de schéma explicite (`to_jsonb` + commentaire) pour ne pas casser l'écran si la migration
  correspondante n'est pas encore appliquée en production.

### 8.5 Plus faible
- Le graphe empilé par sévérité est calculé en mémoire sur un maximum de **100 événements** (les plus
  récents) et non par une requête SQL groupée sur toute la fenêtre — sur une fenêtre à fort volume
  d'alertes, les jours les plus anciens de la période peuvent être tronqués silencieusement au-delà de la
  limite, sans aucune mention à l'écran de cette troncature (seul le `HeroStat` « Événements » dit « 100 plus
  récents », pas le graphe lui-même).
- Aucun indicateur de délai moyen entre déclenchement et acquittement (MTTA).
- Le formulaire de règle affiche tous les champs à plat sans masquage conditionnel selon le mode choisi
  (confirmé § 8.3) — sur la capture, cela produit un formulaire à 13 champs visibles simultanément, dont
  certains sans effet selon le mode sélectionné.

### 8.6 Déjà disponible côté requêtes, non affiché
- `alertRules` renvoie `env` (issue, optionnel) — champ du formulaire mais absent de l'affichage de chaque
  règle dans `RuleRow` au vu du skeleton lu (à confirmer par une lecture intégrale de `RuleFields.tsx` si le
  champ y réapparaît en mode édition — **non établi** au-delà de `RuleRow.tsx` lu en entier).
- `alertEvents` renvoie `route` (`queries-v2.ts:249`) mais le flux affiché ne montre que
  message/métrique/`rule_id` (`page.tsx:203-205`), jamais la route associée à l'événement.

---

## 9. 24 — Prévisions (`/forecast`)

Fichiers : `app/forecast/page.tsx` (303 l.), `lib/forecast.ts` (95 l., logique pure testée),
`lib/queries-grid.ts` (§ `dailyTraffic`/`dailyLcpSeries`), `components/charts/ForecastChart.tsx`.

### 9.1 Question posée
« Les indicateurs clés (LCP, taux d'erreur, trafic) sont-ils en train de dériver vers un seuil critique — et
quand l'atteindraient-ils si la tendance se poursuit ? » — anticipation **avant** l'incident, explicitement
positionnée comme complément (pas remplacement) des anomalies z-score (réactives) et du burn-rate SLO
(commentaire en tête de fichier, `page.tsx:1-4`, sous-titre `page.tsx:109-114`).

### 9.2 Mise en page réelle — capture en échec

`24-forecast.png` (1440×916) ne montre **pas** l'écran attendu : erreur serveur Next.js — « Application
error: a server-side exception has occurred while loading localhost (see the server logs for more
information). Digest: 2899484112 » sur fond blanc. Ni l'état vide ni l'état « assez de données » prévus par
le code (§ 9.3) ne sont visibles sur cette capture.

Lecture de code pour la cause : `dailyTraffic()` et `dailyLcpSeries()` (`lib/queries-grid.ts:110-194`) sont
déjà chacune enveloppées dans un `try/catch` → `softFail(e, [])`, donc une erreur SQL ne devrait pas remonter
telle quelle. `lib/forecast.ts` (`linfit`/`etaToThreshold`/`buildForecastNarrative`/`trendDir`) est une
logique pure sans accès I/O, avec des gardes explicites (`denom===0 → null`, `pts.length<3 → null`).
`ForecastChart.tsx` (recharts) ne montre pas de garde visible contre un tableau `data` vide, mais reçoit
toujours un tableau construit côté page. **Aucune cause de plantage reproductible n'a été identifiée dans le
code lu pour cette page précise — non établi.** Comme relevé § 1.2, aucune des huit routes de ce lot n'a
d'`error.tsx` : cette capture est la preuve directe que, sans frontière d'erreur dédiée, une exception sur
l'une de ces routes tombe sur la page blanche générique de Next.js plutôt que sur un message contrôlé avec
un bouton « Réessayer ».

### 9.3 Widgets (décrits depuis le code, la capture ne les montrant pas)

| Widget | Composant / fichier | Mesure — agrégation | Requête | États |
|---|---|---|---|---|
| Hero « LCP p75 — réel + projection à J+3 » | `ForecastChart` (`components/charts/ForecastChart.tsx`, recharts) | ligne pleine = 14 valeurs réelles journalières (`percentile_cont(0.75)` sur `rum_metric` `name='LCP'`, `GRID_DAYS=14`, `lib/queries-grid.ts:17, 176-194`) ; ligne pointillée = projection par régression linéaire moindres carrés (`lib/forecast.ts:14-30`, `null` si <3 points non-nuls) sur `HORIZON=3` jours ; ligne rouge = seuil **fixe 2500 ms, dur-codé** (`page.tsx:58`, § 1.4) | `dailyLcpSeries` (`lib/queries-grid.ts:176-194`) | vide : « Pas assez d'historique sur 14 jours… » si `!hasData` (`page.tsx:117-120`, `hasData` = ≥1 pageview OU ≥1 point LCP sur 14 j) |
| `HeroStat` « Tendance générale » | — | `narrative.status` : `risk` si un seuil déjà dépassé, `watch` si dépassement <7 j, `ok` sinon | `buildForecastNarrative` (`lib/forecast.ts:76-84`) | |
| `HeroStat` « LCP p75 actuel » / « Seuil 2,5 s » | — | valeur courante / ETA en jours (« dépassé », `~J+N`, ou « hors horizon » si >7 j) | `etaToThreshold` (`lib/forecast.ts:46-59`) | |
| Bandeau « Synthèse » | — | narration textuelle **déterministe** (pas de LLM), phrases générées par des règles fixes (« X dépasse déjà son seuil », « X devrait franchir Y vers J+Z ») — commentaire du fichier : « transparente, explicable… pas de boîte noire » (`lib/forecast.ts:3-4`) | `buildForecastNarrative` | |
| 3 `MetricCard` (LCP p75 / Taux d'erreur JS / Trafic pages vues) | fait main dans `page.tsx:213-262`, mini-graphe `ForecastSpark` en SVG (`page.tsx:265-302`, hors `components/charts/`) | valeur actuelle + flèche de tendance (▲/▼/—, colorée selon le sens défavorable) + valeur projetée J+3 + badge de seuil (dépassé / ⚠ vers J+N / sous le seuil) pour LCP et erreur — **le trafic n'a pas de seuil** (`threshold: null`), donc pas de badge affiché pour cette carte | `dailyTraffic` (`errVals = errors/pageviews×100`, `pvVals`) | |

### 9.4 Meilleur que Datadog / IP-Label — à conserver
- Narration explicable par des règles fixes, pas un modèle de prévision propriétaire opaque — traçable ligne
  par ligne jusqu'à la formule de régression ; **non établi** en détail comment Datadog Watchdog/Forecasts
  présente ses projections à l'utilisateur (pas de capture consultée dans ce lot), mais le principe d'un
  modèle propriétaire non explicité est de notoriété publique pour ce type de fonctionnalité.
- Positionnement explicite comme complément (pas remplacement) des alertes réactives et du burn-rate SLO —
  évite la confusion « à quoi sert cet écran par rapport aux autres ».
- Limite de méthode assumée à l'écran : « Une projection n'est pas une certitude — elle signale une tendance
  à surveiller, pas un futur garanti. » (`page.tsx:204-207`) — formule conforme à la règle du dépôt de ne pas
  sur-promettre.

### 9.5 Plus faible
- **Capture de démo en échec** (§ 9.2) — à la date de cette lecture, l'écran n'est pas démontrable de bout en
  bout sur les données de démo (constat factuel, cause non établie).
- **Les boutons de preset (1 h / 24 h / 7 j / Personnalisée) affichés en haut de l'écran n'ont aucun effet
  réel sur cette page** : `dailyTraffic`/`dailyLcpSeries` fixent leur fenêtre à `GRID_DAYS=14` jours en dur
  (`lib/queries-grid.ts:17, 91, 119`), indépendamment du preset sélectionné. Contrairement à `/dashboards` et
  `/` — qui ont le même comportement de fenêtre fixe sur un widget mais le déclarent via un `rangeNote`
  explicite dans `lib/surfaces.ts` (§ 1.1) — l'entrée `/forecast` de `surfaces.ts:126` n'a **aucun**
  `rangeNote`, et la page n'importe même pas `FiltersNotAppliedNote`. Rien ne dit à l'utilisateur que changer
  de preset ne change rien à ce qu'il regarde.
- Seuil LCP 2500 ms dur-codé plutôt qu'importé de `lib/rating.ts` (§ 1.4) — deux sources de vérité pour la
  même valeur.
- Régression linéaire simple uniquement (pas de saisonnalité, pas de moyenne mobile) — assumé par le
  commentaire du fichier, donc pas un manque caché, mais une limite de méthode : une baisse de trafic le
  week-end sera lue comme une tendance alors que c'est un effet de calendrier.

### 9.6 Déjà disponible côté requêtes, non affiché
- `dailyTraffic()` retourne `errors` en valeur absolue (pas seulement le taux) — la page ne calcule que
  `errVals = errors/pageviews×100` (`page.tsx:48`) ; le nombre absolu d'erreurs par jour n'est jamais montré.
- `ForecastSpark` ne porte aucun label d'axe (J/J+1/J+2/J+3) contrairement au graphe hero qui a un vrai axe X
  labellisé — la mini-visualisation par métrique est donc moins lisible que le graphe principal pour la même
  donnée.

---

## 10. Synthèse rapide pour la suite du plan

- **Deux écrans de ce lot dépendent totalement du tracing distribué** (`/tracing`, `/map`) : sur les données
  de démo actuelles (fenêtre 7 j), les deux sont vides simultanément — le plan doit prévoir soit des données
  de démo qui peuplent `rum_span` front+back, soit accepter que ces deux écrans restent à l'état vide dans
  les captures de présentation.
- **Un écran (`/forecast`) est actuellement invérifiable en démo** (crash de capture, cause non établie) —
  à reproduire manuellement avant toute reconception, pour savoir si le plan part d'un écran qui fonctionne.
- **Une violation confirmée de l'invariant « inconnu ≠ 0 »** existe dans `lib/goals.ts:25-27`
  (`conversionRate` retourne `0` sans dénominateur) — à corriger indépendamment de toute refonte visuelle,
  puisque c'est un défaut de données, pas de mise en page.
- **`/forecast` ignore silencieusement les presets de plage** — à corriger ou à documenter (`rangeNote`)
  avant d'en faire un écran vitrine du plan.
- **Trois graphiques de ce lot vivent hors de `components/charts/`** (`ExperienceMap`, `RobotVsRealChart`,
  `ForecastSpark` + le waterfall fait main) — un plan qui réutilise « components/charts/ » comme unique
  inventaire de référence sous-estimera ces quatre rendus.
