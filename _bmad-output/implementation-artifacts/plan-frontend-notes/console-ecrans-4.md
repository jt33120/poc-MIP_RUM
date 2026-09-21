# Lecture de la console MIP RUM — lot 4 (11 écrans)

Écrans : `25-dashboards`, `26-logs`, `27-svi`, `28-ai`, `29-api-docs`, `30-admin-privacy`, `31-admin-health`, `50-overview-dark`, `51-pages-dark`, `60-overview-390`, `61-errors-390`.

## 0. Ce que ce document garantit, et ce qu'il ne garantit pas

- Chaque capture a été regardée (`scratchpad/console/<nom>.png`) et le code de la route lue : `page.tsx`, ses composants, les fonctions de requête, les graphiques de `components/charts/`. Les chemins sont relatifs à `apps/console/` sauf mention contraire ; les lignes sont celles du dépôt au 18/09/2026 (commit `ae05385`). Une seconde passe le 19/09/2026 a recontrôlé une soixantaine de citations contre le dépôt et les onze captures : toutes concordent ; quatre ont été précisées (§ 1.2, § 6.5, § 8.2, § 12.3) et une hauteur mesurée (§ 11).
- Les hauteurs de page viennent de `scratchpad/console/index.json` (captures à 1 440 px) ou des métadonnées d'image (variantes `-dark` et `-390`). Une hauteur de 1 029 px est la hauteur de la fenêtre de capture : la page tient au-dessus du pli.
- Les comparaisons avec Datadog s'appuient sur les lectures déjà rédigées dans `scratchpad/plan/reads/datadog-images-1.md`, `datadog-images-2.md`, `datadog-video-rum-db-new.md`, `datadog-video-240523-rum-product-page-triageresolve-v01.md`, `datadog-video-newfastresponsiveengagingappsvideo.md`. Ce qui n'y figure pas est marqué **non établi** ; le site de Datadog n'a pas été consulté pour ce lot.
- Aucun fichier du dépôt n'a été modifié.
- Les données des captures sont celles de la démo locale (`demo-app`, « Mini-site de démo ») : une valeur de 44 ms de LCP dit ce que le graphique fait avec des données très en deçà des seuils, pas ce qu'il vaut en production.

Trois constats transversaux, valables pour plusieurs écrans du lot, sont regroupés en § 12 pour ne pas être répétés onze fois.

---

## 1. `25-dashboards` — `/dashboards` (1 440 × 1 029)

### 1.1 Question posée

« Quels tableaux de bord existent dans mon périmètre, à qui sont-ils, et comment en créer un ? » La page est une **liste** ; le tableau de bord lui-même vit sur `/dashboards/[id]`, non capturé mais lu (`app/dashboards/[id]/page.tsx`).

### 1.2 Mise en page réelle

De haut en bas (capture `25-dashboards.png`) :

1. Barre de filtres globaux (`components/GlobalFilters.tsx`) : presets 1 h / 24 h / 7 j / Personnalisée, appareil Tous / Desktop / Mobile / Tablette, bouton Filtres, badge « LIVE · 5 s », bascule de thème. Aucune barre de segment : `SegmentBar.tsx:L85` ne rend rien quand aucune dimension n'est applicable à la surface.
2. Sous-onglets « OBJECTIFS & ALERTES » : Objectifs · SLO · Alertes · Prévisions · **Tableaux de bord** (`components/nav-items.tsx:L63-L72`).
3. `PageHeader` : surtitre « PERFORMANCE UTILISATEUR », titre « Tableaux de bord », sous-titre « Assemble tes propres vues à partir de widgets (…), puis exporte en CSV / PDF. » (`app/dashboards/page.tsx:L34-L37`).
4. `<details open>` « + Nouveau dashboard » — ouvert parce que la liste est vide (`L41`, `open={!dashboards.length}`) : champ Nom (`INPUT_CLASS`), sélecteur App (valeurs = `app_id`, ici « demo-app »), bouton `btn-accent` « Créer ».
5. Tableau Nom / App / Propriétaire / Widgets / Mise à jour, une seule ligne : « Aucun tableau de bord — crée le premier ci-dessus. » (`L105-L111`).

Tout est au-dessus du pli ; le bas de l'écran est vide sur ~55 % de la hauteur.

### 1.3 Widgets

| Zone | Composant | Mesure / dimensions | Source | États |
|---|---|---|---|---|
| Formulaire de création | HTML natif + `INPUT_CLASS` (`L49-L72`) | — | `createDashboardAction` (`app/dashboards/actions.ts`) ; apps proposées = `dashboardApps(registeredApps(), user)` (`L28-L29`), option « (toutes apps) » seulement si `canCreateDashboard(user, null)` (`L61`) | pas d'état d'erreur inline ; refus de filtre → `FilterProblemNotice` (`L27`) |
| Liste | `<table>` (`L78-L114`) | une ligne par tableau de bord : nom (lien avec filtres conservés, `hrefWithQuery`), app ou « toutes », propriétaire (`ownerLabel`), nombre de widgets (`d.layout.length`), `fmtDate(updated_at)` | `listDashboards(ecran.filters)` (`lib/queries-dashboards.ts:L94-L105`) : tableaux des apps du périmètre + tableaux non scopés | vide → phrase ; note `FiltersNotAppliedNote` si les filtres d'écran ne s'appliquent pas (`L38`) |

Ce qu'une ligne ouvre (`app/dashboards/[id]/page.tsx`), non capturé :

- Grille `grid-cols-1 md:grid-cols-2` de `WidgetCard` (`components/dashboards/WidgetCard.tsx`), corps `WidgetBody` (`components/dashboards/WidgetBody.tsx`) : `value` → chiffre ; `toplist` → `components/charts/RankBar.tsx` ; `timeseries` → `WidgetChart.tsx` qui réutilise `LineTrend.tsx` (une courbe par groupe, jamais empilées si non additif) ou `StackedBars.tsx` (si `series.stacked`) ; `table` → tableau HTML.
- Widgets v1 (`lib/dashboards.ts:L38-L45`) et ce qu'ils rendent (`lib/widget-data.ts:L330-L399`) : `vital_p75` → tuile valeur `fmtVital` + « n mesures » ; `traffic` → **tableau** Jour / Pages vues / Erreurs (`dailyTraffic`) ; `slow_routes` → **tableau** Route / Vues / LCP p75 / INP p75 (`slowRoutes`, 8 lignes) ; `top_errors` → **tableau** Erreur / Occurrences / Sessions (`listErrorGroups`, 8 lignes) ; `frustration` → tableau ; `event_count` → tuile valeur avec avis d'échantillonnage.
- Widgets v2 : une analyse enregistrée depuis l'Explorer, avec fenêtre et filtres propres, écrits sur la carte (`WidgetCard.tsx:L58-L63`).
- États : `invalid` / `error` → carte « Configuration illisible » ou « Mesure indisponible » avec raison (`WidgetBody.tsx:L12-L22`) ; vide → « aucune donnée » (`L24-L28`) ; `?conflit=1` → alerte « rien n'a été écrit » (`[id]/page.tsx:L105-L114`) ; `?refus=1` ; hors périmètre (`L125-L130`) ; N cartes illisibles (`L132-L139`). Export CSV (`/api/dashboards/[id]/export`) et « Imprimer / PDF » = `window.print()` (`PrintButton.tsx:L6`).

### 1.4 Meilleur que Datadog (à conserver)

- **Concurrence optimiste visible** : chaque écriture cite la révision lue ; un conflit entre deux onglets est refusé et dit (`lib/queries-dashboards.ts:L5-L9`, `[id]/page.tsx:L105-L114`). Non établi que Datadog fasse autrement, mais rien dans les lectures ne le montre.
- **Un widget illisible n'est ni perdu ni caché** : il devient une carte de diagnostic, réécrit intact (`lib/dashboards.ts:L15-L19`).
- **La portée propre d'une carte est écrite dessus** — fenêtre différente de l'écran, filtres supplémentaires (`WidgetCard.tsx:L9-L11`). Sur le dashboard Datadog « Performance Overview », les widgets héritent silencieusement des dix variables de template (`datadog-images-1.md` § 1.2).
- **Pas d'empilement d'une mesure non additive** (`WidgetChart.tsx:L7-L9`) ; **alternative textuelle** de chaque série (`WidgetBody.tsx:L4-L6`).
- **Ordre au clavier** avec position annoncée (« Monter — 2 sur 5 », `WidgetCard.tsx:L4-L7`).
- **Propriétaire et périmètre** lisibles dans la liste ; lecture seule pour qui ne peut pas éditer (`editable`, `[id]/page.tsx:L68`).
- Français, y compris dans les messages d'erreur.

### 1.5 Plus faible

- **État vide pauvre** : une phrase dans une cellule. Datadog livre des tableaux de bord préconstruits à cloner (« RUM - Performance Overview », « RUM - User Sessions », bouton « Clone Dashboard », `datadog-images-1.md` § 1.1, `datadog-images-2.md` § 0). Ici, aucun modèle, aucune vignette, aucun exemple de ce qu'un tableau peut contenir.
- **Mauvais type de représentation pour quatre des six widgets v1** : `traffic`, `slow_routes`, `top_errors`, `frustration` rendent des tableaux (`widget-data.ts:L339-L378`) là où la console dispose déjà de `TrafficTimeseries`, `RankBar` et `GroupSparkline`. Le widget « trafic » est un tableau de 14 lignes Jour / Pages vues / Erreurs, alors que la même donnée est dessinée sur l'accueil.
- **La tuile `vital_p75` n'a ni verdict ni couleur ni tendance** (`widget-data.ts:L334-L338`) — c'est le défaut que la lecture Datadog reproche à la tuile « P75 loading time » de Datadog (`datadog-images-1.md` § 1.3 : « Une tuile de latence sans référence n'apporte qu'un chiffre »). `rating2026` et `VitalCard` existent et ne sont pas réutilisés.
- **Sélecteur d'app par `app_id`** (« demo-app », `page.tsx:L64`) alors que la barre de filtres et la sidebar disent « Mini-site de démo » : deux noms pour la même chose sur le même écran.
- **Grille figée à deux colonnes**, pas de taille de carte ; les widgets Datadog ont trois actions en en-tête (ouvrir en requête, export, plein écran — `datadog-video-newfastresponsiveengagingappsvideo.md` L81, L136) ; ici une carte ne redevient pas une requête Explorer.
- **Placement dans l'arborescence** : « Tableaux de bord » sous « Objectifs & alertes ». Chez Datadog, « Dashboards » est un onglet de premier niveau (`datadog-video-rum-db-new.md` L45).
- Sous-titre : « exporte en CSV / PDF » — le PDF est le dialogue d'impression du navigateur ; c'est exact mais l'utilisateur ne le sait qu'en cliquant.

### 1.6 Données déjà disponibles côté requêtes, non affichées

- `listDashboards` renvoie `layout` (la liste des widgets) : la colonne « Widgets » pourrait montrer les types (puces) plutôt qu'un nombre. `created_at`, `owner_email`, `revision` sont aussi rapatriés (`queries-dashboards.ts:L20-L33`).
- Widget `vital_p75` : `vitalsP75` renvoie `p50` et `n` (`lib/queries.ts:L38-L43`) ; `rating2026` (`lib/rating.ts:L36`) donne le verdict ; le même rendu que `VitalCard` (verdict, échantillon faible, médiane) est possible sans nouvelle requête.
- Widget `slow_routes` : `RouteRow` porte `cls_p75` et `longtasks` (`queries.ts:L165-L172`), non affichés dans les colonnes du widget.
- Widget `top_errors` : `listErrorGroups(f, …, { series: true })` renvoie `series` par groupe, `visitors_affected`, `status`, `regressed`, `sampling` (`lib/queries-errors.ts:L165-L182`, `L194-L213`) ; le widget n'affiche ni sparkline, ni statut, ni l'avis d'échantillonnage.
- Widget `traffic` : `dailyTraffic` renvoie exactement l'entrée de `TrafficTimeseries` (`lib/queries-grid.ts:L103-L107`).

---

## 2. `26-logs` — `/logs` (1 440 × 1 029)

### 2.1 Question posée

Telle que fermée : aucune. Telle que codée : « Quel bruit applicatif (error / warn) sur la fenêtre, d'où vient-il, et à quelle trace ou session remonte-t-il ? » (`app/logs/page.tsx:L1-L3`).

### 2.2 Mise en page réelle

Capture : barre de filtres globaux (rendue par le layout, `app/layout.tsx:L345`) ; pas de sous-onglets (catégorie mono-page) ; pas de barre de segment. `PageHeader` « Logs », sous-titre « Signal LOGS d'OpenTelemetry, alimenté par le serveur et non par le navigateur. Capacité annoncée, accès non ouvert. » ; une carte `CapaciteFermee` (`components/CapaciteFermee.tsx:L17-L32`) : icône cadenas, « Accès fermé pour le moment », phrase indiquant que le reste de la console fonctionne. Le garde vit dans la page, avant toute requête (`logs/page.tsx:L44-L51` ; principe expliqué `CapaciteFermee.tsx:L3-L7`). Le drapeau vient de `nav-items.tsx:L81` (`verrouille: true`).

Ce qu'elle montrerait ouverte (`L85-L279`) :

1. `SupervisionHero` (`components/SupervisionHero.tsx`) : tuiles Erreurs (ton `poor` si > 0), Avertissements, Total logs (indice « pic horaire N »), lecture en une phrase ; graphe `StackedBars.tsx` **24 seaux horaires** error / warn / autres.
2. Bandeau rouge « Pics d'erreurs anormaux (24 h) · z-score horaire vs moyenne 7 j », 4 lignes au plus, masqué si aucune anomalie (`L126-L149`).
3. Pastilles de niveau Tous / Info+ / Warn+ / Error+ — des liens qui conservent le contexte global (`L152-L170`).
4. Tableau Heure / Sévérité (badge coloré) / Source / Message (2 lignes max, `title` complet) / Route / Corrélation (lien « session » ou « trace xxxxxxxx… », sinon « — ») ; vide → « Aucun log sur la période. Envoie des logs au format OTLP sur `/v1/logs` … » (`L230-L237`).
5. « Routes les plus bruyantes » : tableau Route / Erreurs / Warnings / Total, rendu seulement s'il y a des lignes (`L243-L277`).

### 2.3 Widgets (état ouvert)

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Volume par heure | `charts/StackedBars.tsx` | `count(*)` par heure × bucket de sévérité (≥ 17 error, ≥ 13 warn, sinon autres) — **toujours 24 h** | `logVolumeByHour` (`lib/queries-logs.ts:L131-L154`, `interval '24 hours'`) | total 0 → « Aucun log sur la période. » |
| Tuiles | `HeroStat` | comptes par bucket sur la **fenêtre choisie** | `logSeverityCounts` (`L60-L76`) | 0 → ton `good` |
| Anomalies | bloc HTML | z-score horaire vs 7 j, top 20 lu, 4 affichés | `logAnomalies` (`L88-L102`, vue `v_log_anomaly`, `[]` si la vue manque) | masqué si vide |
| Liste | `<table>` | 200 derniers logs, plancher de sévérité | `logEntries` (`L44-L57`) | vide → consigne d'intégration |
| Routes bruyantes | `<table>` | erreurs / warnings / total par route, 10 lignes | `logsByRoute` (`L112-L128`) | masqué si vide |

### 2.4 Meilleur que Datadog

- **L'état fermé dit qu'il est fermé** — « Capacité annoncée, accès non ouvert » — au lieu d'un écran de démonstration ; le refus précède la première requête (`CapaciteFermee.tsx:L3-L7`).
- **Corrélation en colonne** : chaque log qui porte une session ou une trace y mène en un lien (`L206-L226`). Chez Datadog, les logs d'une vue sont un onglet compté du panneau (« Logs 2 », `datadog-video-rum-db-new.md` L26) ; le sens log → session n'est pas établi dans les lectures.
- **Anomalie sans seuil à régler**, avec la moyenne 7 j et le z affichés (`L133-L146`).
- **Dégradation douce** si la vue d'anomalies manque (`queries-logs.ts:L99-L101`).

### 2.5 Plus faible

- **Deux fenêtres sur le même bandeau** : le graphe est toujours sur 24 h, les tuiles sur la période choisie (`L93`, `L103`). Le titre le dit (« 24 h ») ; le voisinage laisse croire que les tuiles résument le graphe.
- **Les requêtes sont relatives à `now()`** (`ts > now() - $2::interval`, `queries-logs.ts:L51`, `L69`) : la plage personnalisée [from, to) du contrat commun n'est pas honorée sur cet écran.
- **Liste plafonnée à 200 sans pagination ni facettes** ; aucun compte par source ni par app ; la ligne d'anomalie ne montre l'app que si `app=all` (`L144`).
- **Écran fermé, barre de filtres ouverte** : les presets et le sélecteur d'appareil restent actionnables au-dessus d'une carte qui ne lit rien (constat § 12.2).
- Aucune indication de qui ouvre l'accès ni de quand.

### 2.6 Données disponibles non affichées

- `LogRow.span_id` et `app_id` (`queries-logs.ts:L6-L18`) : l'app n'apparaît que sur les anomalies en périmètre « toutes ».
- `logAnomalies` rapatrie 20 lignes, la page en affiche 4 (`L133`).
- `logsByRoute` ne porte pas de série temporelle ; `logVolumeByHour` n'est pas ventilé par route : un graphe « bruit par route dans le temps » demanderait une requête — non disponible.

---

## 3. `27-svi` — `/svi` (1 440 × 1 029)

### 3.1 Question posée

Fermée sur la capture (`nav-items.tsx:L88-L92`). Codée : « Sur les appels clos de la période, quelle part a été résolue par le serveur vocal **sans rappel sous 7 jours**, et où les appels quittent-ils le parcours ? » (`app/svi/page.tsx:L1-L12`).

### 3.2 Mise en page réelle

Identique à `26-logs` : filtres globaux, `PageHeader` « Supervision SVI » + « Supervision du serveur vocal interactif. Capacité annoncée, accès non ouvert. », carte `CapaciteFermee`. Pas de sous-onglets bien que la catégorie en ait deux (Vue d'ensemble, Appels) : `SubNav.tsx:L15-L18` les masque quand la catégorie est verrouillée, pour ne pas proposer d'entrer dans une zone fermée.

Ouverte (`L69-L145`) :

1. `SupervisionHero` : à gauche Containment net / « dont apparent » / Attente moyenne / Durée moyenne + lecture (`containmentReading`, `lib/svi-recall.ts:L72-L84`) ; à droite un `Donut` (`charts/Donut.tsx`, SVG serveur) des issues des appels clos, centre = nombre d'appels clos, lien « Voir les appels → ».
2. Note de couverture si < 100 % des appels portent le niveau « journey » (`L112-L119`).
3. « Où les appels quittent le SVI » : `RankBar` à segments (abandonnés / transférés / résolus) par nœud de sortie, 8 lignes (`L121-L143`).

`/svi/appels` (lu, non capturé) : `StackedBars` des issues par heure + tableau des 100 derniers appels (Début, Issue, Point d'entrée, Parcours, Attente, Durée, MOS, Étapes), appels de test badgés (`app/svi/appels/page.tsx:L148-L153`).

### 3.3 Widgets (état ouvert)

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Donut des issues | `charts/Donut.tsx` | comptes par `outcome` sur les appels **clos** ; tranches à 0 retirées (`L62-L67`) | `sviSummary` (`lib/queries-svi.ts:L67-L88`) | aucune tranche → « Aucun appel clos sur la période. » |
| Containment net / apparent | `HeroStat` | net = résolus sans rappel du même `caller_hash` sous 7 j ; apparent = résolus / clos | `sviContainment` (`L151-L176`) + `containment()` (`svi-recall.ts:L47-L65`) | clos = 0 → « — » ; appels sans empreinte → « borne supérieure » dans la lecture |
| Attente / durée moyennes | `HeroStat` | `avg(wait_ms)`, `avg(duration_ms)` | `sviSummary` | null → `fmtDuration` (« — », non établi au caractère près) |
| Sorties | `charts/RankBar.tsx` (segments) | total / abandonnés / transférés par `exit_node`, « (non instrumenté) » si absent | `sviExitNodes` (`L179-L194`) | vide → « Aucun appel clos sur la période. » |

### 3.4 Meilleur que Datadog

Datadog RUM n'a pas de supervision de serveur vocal dans les lectures disponibles : la comparaison n'est **pas établie**. Ce qui est à conserver en soi :

- **Le net domine, le brut est libellé « apparent »**, et un test de source interdit d'afficher l'un sans l'autre (`svi/page.tsx:L4-L12`).
- **La couverture est affichée, pas extrapolée** (`L112-L119`, `queries-svi.ts:L59-L62`).
- **Le biais de rotation de clé est documenté dans le sens où il flatte** (`queries-svi.ts:L145-L149`) et la borne supérieure est dite à l'écran (`svi-recall.ts:L80-L82`).
- **Appels de test jamais confondus avec le trafic réel** (`appels/page.tsx:L148`).

### 3.5 Plus faible

- **Erreur d'étiquette dans les barres de sortie** : le troisième segment vaut `total − abandonnés − transférés` et s'appelle « résolus » (`svi/page.tsx:L133-L138`) ; il contient aussi les appels `failed`. Un nœud où les appels échouent apparaît en vert « résolus ».
- **Des moyennes, pas des percentiles**, pour l'attente et la durée (`queries-svi.ts:L76-L77`) : une file d'attente a une longue traîne, la moyenne la cache. Le reste de la console travaille au p75.
- **Aucune série temporelle sur la vue d'ensemble** ; l'histogramme horaire n'existe que sur `/svi/appels` alors que la requête est prête (§ 3.6).
- Même remarque que § 2.5 : requêtes relatives à `now()` (`queries-svi.ts:L44`, `L79`), plage personnalisée non honorée.
- Écran fermé, filtres ouverts (§ 12.2).

### 3.6 Données disponibles non affichées

- `sviOutcomesByHour` (`queries-svi.ts:L197-L208`) n'est appelée que par `/svi/appels` : la vue d'ensemble pourrait porter la même série sans requête nouvelle.
- `sviSummary.open` (appels en cours, `L74`) : dit sur `/appels`, muet sur la vue d'ensemble.
- `ContainmentRow.unevaluable` et `recalled` (`L131-L136`) : le nombre d'appels rappelés n'est pas affiché comme tel, seulement l'écart en points.

---

## 4. `28-ai` — `/ai` (1 440 × 1 029)

### 4.1 Question posée

Fermée (`nav-items.tsx:L101`). Codée : « Que dit xSOM AI Guard des agents et modèles de cette application ? » — un espace **partenaire**, lecture seule via façade, aucune donnée IA stockée côté MIP (`app/ai/page.tsx:L1-L4`).

### 4.2 Mise en page réelle

Identique aux deux précédents : filtres, `PageHeader` « Supervision IA » + « Supervision des agents et modèles en production. Capacité annoncée, accès non ouvert. », carte `CapaciteFermee`. Le garde précède l'appel à la façade (`L20-L30`).

Ouverte (`L41-L76`) : `PageHeader` avec `domain="ai"` et pastille « par xSOM » ; `XsomSponsorBanner` ; `XsomAiPanel` si la façade répond, sinon carte « Supervision IA indisponible ici » avec deux textes selon qu'une app est choisie ou non, et un lien sortant « Ouvrir xSOM AI Guard → » (`L55-L75`). Le contenu de `XsomAiPanel` (`components/xsom/XsomAiPanel.tsx`) n'a pas été lu : **non établi**.

### 4.3 Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Panneau IA | `components/xsom/XsomAiPanel.tsx` (non lu) | non établi | `fetchAiSummary(f.app, windowKey)` (`lib/xsom-ai`), `null` si échec ou app non couverte | `null` → carte d'indisponibilité, pas de distinction « injoignable » / « pas de données » dans le texte (`L62`) |

### 4.4 Meilleur que Datadog

- **Le placement partenaire est dit** — badge, bannière, sous-titre « distinct du RUM MIP » (`L44-L53`). Non établi que Datadog distingue ainsi un module tiers.
- **Zéro stockage** côté produit, affirmé dans le code (`L2-L3`).

### 4.5 Plus faible

- **Fenêtre silencieusement remplacée** : `windowKey = f.period === "7d" ? "7d" : "24h"` (`L37`), donc une période « 1 h » interroge 24 h, tandis que `periodLabel(f)` — « 1 h » — est passé au panneau (`L56`). Le libellé et la donnée divergent. La plage personnalisée n'est pas gérée.
- **Un seul état d'indisponibilité** pour deux causes (service injoignable, app non couverte) ; l'utilisateur ne sait pas laquelle.
- Écran fermé, filtres ouverts (§ 12.2).

### 4.6 Données disponibles non affichées

Non établi : la forme de retour de `fetchAiSummary` n'a pas été lue.

---

## 5. `29-api-docs` — `/api-docs` (1 440 × 4 281)

### 5.1 Question posée

« Comment sortir la donnée du portail : en API REST pour un partenaire, ou en serveur MCP pour un agent IA — et que garantit chacun ? » (`app/api-docs/page.tsx:L1-L5`). Page de documentation, sans requête analytique.

### 5.2 Mise en page réelle

Pas de barre de filtres (surface hors filtres, `GlobalFilters.tsx:L75-L76`) ; seuls « LIVE · 5 s » et la bascule de thème restent en haut. Ordre :

1. `PageHeader` « API et MCP » (`L82-L91`).
2. Carte « Brancher une IA sur MIP RUM » (`L94-L195`) : pastille d'état **mesurée** (« en ligne · v0.1.0 » sur la capture ; sinon « état non vérifié — motif », `L99-L107`, `sonderMcp()` `lib/mcp-sonde.ts:L28-L49`) ; adresse du serveur en `CopyBlock` ; encart ambre « Il vous faut un jeton » ; deux colonnes config JSON / commande CLI ; bloc « Vérifier soi-même — le troisième appel DOIT échouer » ; `<details>` transport stdio.
3. Trois `LinkCard` : Swagger UI, spec OpenAPI, doc MCP sur GitHub (`L198-L214`).
4. « Deux points d'entrée REST » : `GET /api/rum/summary` (recommandé partenaire) et `GET /api/v1/*` (23 endpoints) (`L217-L264`).
5. « Serveur MCP — interroger le portail avec une IA » : authentification, deux transports, tableau des **16 outils** dérivé du catalogue réel du serveur (`L69-L73`, `OUTILS` de `mcp/lib/catalogue.mjs`), paragraphe « ce que le serveur ne fait pas » (`L322-L328`).
6. « Authentification & filtres » : `app=<slug>|all`, `period=1h|24h|7d`, `device=…` (`L332-L352`).
7. Tableau des endpoints `/api/v1` issu de `endpointsDeclares()` (`L34`, `L355-L380`) + `POST /api/v1/deploys`.
8. « Exemples » : deux `curl`, une config stdio (`L383-L414`).

Au-dessus du pli : la carte MCP jusqu'au bloc de vérification. Le reste demande ~4 écrans de défilement.

### 5.3 Widgets

Aucun graphique. Composants : `CopyBlock` (`components/CopyBlock.tsx`), `LinkCard` local (`L36-L67`), tableaux HTML. Sources : `sonderMcp()`, `endpointsDeclares()` (`lib/api/openapi`), `MCP_ENDPOINT`, `configDistante()`, `commandeCli()`, `curlVerification()`, `configLocale()` (`lib/mcp-public`). État : la sonde échoue doucement (« pas pu vérifier » n'est pas « en panne », `L76-L78`).

### 5.4 Meilleur que Datadog

- **L'état du serveur est mesuré à chaque rendu**, pas affirmé (`L97-L98`).
- **Une seule source pour la liste des endpoints**, après qu'une copie manuelle a menti (`L7-L12`).
- **Le test négatif est fourni** (« le troisième appel doit répondre 401 », `L171-L181`).
- **Les limites sont écrites** : pas d'écriture, trois fenêtres, pas de total sur les sessions, app hors périmètre ramenée au jeton et signalée (`L322-L328`).
- Un serveur MCP en lecture seule sur les agrégats RUM : **non établi** que Datadog RUM en propose un dans les lectures disponibles.

### 5.5 Plus faible

- **4 281 px sans sommaire ni ancres** ; la table des 23 endpoints et celle des 16 outils sont deux listes plates sans regroupement par domaine.
- **Deux vocabulaires de fenêtre** sur la même page : `period=1h|24h|7d` (`L346`) pour `/api/v1`, `window=30d` dans l'exemple `/api/rum/summary` (`L388`). Rien ne dit pourquoi ni lequel accepte quoi.
- **Deux hôtes** : `PROD_BASE` Vercel en dur (`L29`) pour les exemples, Railway pour le MCP ; un lecteur ne sait pas si c'est le même produit.
- Le surtitre « PERFORMANCE UTILISATEUR » coiffe une page de documentation (§ 12.1).
- À 390 px (non capturé) : les tableaux d'endpoints ont une première colonne `whitespace-nowrap` dans une carte `overflow-hidden` (`L355`, `L365`) et non `overflow-x-auto` — risque de coupe, **non établi** faute de capture.

### 5.6 Données disponibles non affichées

- `endpointsDeclares()` porte au moins `method`, `path`, `desc` (`L363-L369`) ; s'il porte aussi les paramètres et schémas (il alimente Swagger), ils ne sont pas rendus ici — **non établi** sans lecture de `lib/api/openapi`.
- `sonderMcp()` renvoie `version` et `motif` (`lib/mcp-sonde.ts:L17-L23`) ; la latence de la sonde, si elle existe, n'est pas affichée — non établi.

---

## 6. `30-admin-privacy` — `/admin/privacy` (1 440 × 1 029)

### 6.1 Question posée

« Pour une personne désignée par une identité métier pseudonymisée (ou un ancien `visitor_id`), quelles lignes détenons-nous, et pouvons-nous les exporter ou les effacer — et qu'est-ce que l'effacement garantit ? » (`app/admin/privacy/page.tsx:L59-L67`).

### 6.2 Mise en page réelle

Pas de filtres globaux (surface admin). Ordre (capture) :

1. `PageHeader` « Vie privée · DSAR » avec sous-titre (accès/portabilité, effacement, audit des refus).
2. Bandeau ambre « Recherche indisponible : `IDENTITY_HASH_SECRET` manque. L'ingestion historique continue sans ces champs. » (`L69-L75`, `identityPersistenceHealth`).
3. Carte « Portée de la garantie d'effacement » : encart ambre = état réel de la barrière (`etatBarriere(app)` → « off » sur la capture, texte `DSAR_BARRIERE_MESSAGES.off`, `lib/dsar.ts:L272-L277`) ; quatre limites `DSAR_LIMITES` (`L254-L265`).
4. Carte « Rechercher une identité métier » : App (« Mini-site de démo »), Type (utilisateur / compte), Identifiant brut (« saisi puis HMAC en mémoire »), bouton « Chercher » (`L117-L151`).
5. Filet, puis carte « Compatibilité · identifiant visiteur historique » : App (« toutes ») + `visitor_id` + « Chercher » (`L232-L253`).

Tout tient au-dessus du pli. Avec un résultat (non capturé) : tableau Table / Lignes et total (`L153-L186`) ; deux cartes « Accès & portabilité » (lien « Exporter en JSON », `prefetch={false}`) et « Effacement » (re-saisie de l'identifiant brut, bouton rouge « Effacer définitivement », `L188-L229`) ; pour le flux `visitor_id`, trois verdicts : `execute`, `refus_empreinte` (bandeau ambre + nombre de sessions héritées), `inconnu` (`L255-L264`, messages `lib/dsar.ts:L143-L153`).

### 6.3 Widgets

| Zone | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Bandeau identité | HTML | configuré ? schéma v66 ? | `identityPersistenceHealth()` (`lib/health.ts:L34-L57`) | `degraded` → bandeau ; sinon rien |
| Portée de la garantie | HTML | état de barrière `enforce` / `off` / `indisponible` | `etatBarriere(app)` (`lib/queries-dsar.ts:L488-L501`) | trois textes, couleur verte seulement pour `enforce` |
| Recherche identité | formulaire POST | HMAC calculé côté serveur, jamais stocké en URL en clair (l'URL porte le hash 64 hex, `L35`) | `searchIdentityAction` → `dsarIdentityCounts` (`L295-L320`) | erreurs par `?error=` : `empty`, `app`, `kind`, `secret`, `confirm`, `refus_empreinte`, `inconnu` (`L13-L22`) |
| Compatibilité visiteur | formulaire GET | lignes par table pour un `visitor_id` | `dsarCible` → verdict, puis `dsarCounts` (`L186-L199`, `L208-L227`) | `refus_empreinte` / `inconnu` / tableau |
| Export / effacement | liens et formulaires | — | `/admin/privacy/export`, `eraseIdentityAction`, `eraseUserAction` | succès → bandeau vert « N ligne(s) supprimée(s) » (`L110-L114`) |

### 6.4 Meilleur que Datadog

- **Le refus motivé** : une ancienne empreinte de classe d'appareil (`user_hash`) désigne plusieurs personnes ; exporter reviendrait à communiquer les données de tiers, effacer à supprimer celles d'autrui ; l'écran refuse et l'explique (`lib/dsar.ts:L12-L32`, `L145-L151`).
- **La portée de la garantie est dans le rapport, pas dans une doc** (`page.tsx:L77-L79`, `dsar.ts:L245-L249`), et l'état de la barrière affiché est celui qui est **réellement configuré** (`L46-L48`).
- **Confirmation par re-saisie** de l'identifiant brut (`L212-L219`).
- **Cloisonnement par application du HMAC** dit à l'écran (limite 3).
- Français juridique lisible (accès/portabilité, effacement, art. 15/17 dans le code).
- Le traitement RGPD chez Datadog n'est pas décrit dans les lectures disponibles : **non établi**.

### 6.5 Plus faible

- **Le formulaire reste actif alors que le bandeau dit la recherche indisponible** (`L69-L75` vs `L119-L150`) ; l'erreur `secret` n'arrive qu'après soumission (`L17`). Un champ désactivé avec la même phrase éviterait un aller-retour.
- **Champs hors de la constante `INPUT_CLASS`** : les `select` et `input` écrivent la classe `field` en dur (`L122`, `L132`, `L144`, `L240`, `L249`) au lieu d'importer `INPUT_CLASS` (`components/forms/Field.tsx:L6`, qui vaut `"field py-1"`). Le rendu est celui du reste de la console, à 4 px de hauteur près ; ce qui manque est le point d'entrée unique, pas le style.
- **Largeur fixe `w-96`** (384 px) sur les deux champs d'identifiant (`L144`, `L249`) : à 390 px, la marge latérale ne tient pas — non établi faute de capture, mais la classe est inconditionnelle.
- **Deux flux empilés sans état vide** : avant toute recherche, aucun texte ne dit ce qu'un résultat contiendra (tables, format d'export `mip-rum-dsar-identity-export` v1, nom de fichier `dsarExportFilename`).
- Aucun graphique n'est attendu ici ; ce n'est pas un défaut.

### 6.6 Données disponibles non affichées

- `dsarCible.sessionsHeritees` n'est montré qu'en cas de refus (`L259`) ; en cas d'exécution, on ne dit pas si des sessions héritées coexistent.
- `identityHealth.schema` et `configured` sont distingués dans le bandeau (`L71-L72`) — déjà affiché.
- Le résumé `summary` (lignes par table) de l'export (`dsar.ts:L218-L223`) est le même tableau que l'écran ; pas de donnée supplémentaire connue.

---

## 7. `31-admin-health` — `/admin/health` (1 440 × 1 215)

### 7.1 Question posée

« MIP RUM lui-même tourne-t-il : l'ingestion reçoit-elle, les alertes partent-elles, la file tient-elle, le métering est-il à jour — et la console envoie-t-elle sa propre télémétrie au bon endroit ? » (`app/admin/health/page.tsx:L10`, `L19-L24`).

### 7.2 Mise en page réelle

Pas de filtres. Ordre (capture) :

1. `PageHeader` « Santé interne », sous-titre citant `/api/metrics`.
2. Bandeau ambre « Identité métier dégradée. `IDENTITY_HASH_SECRET` est absent… » (`L52-L59`). Le bandeau « Actions causales dégradées » (`L61-L66`) est absent : la migration v67 est détectée.
3. « Où la console s'envoie » : deux adresses (capteur de la console, endpoint remis aux clients) avec le motif de résolution ; carte teintée `warn` si l'endpoint pointe un autre hôte (`L69-L92`).
4. « Ingestion (5 min glissantes) » : 4 tuiles (717 / 112 / 12 / 26).
5. « Alertes & livraison » : 4 tuiles (1 non acquittée en ambre, 0, 0, 0).
6. « File de débarquement » : paragraphe explicatif + 3 tuiles (0, 0, « — »).
7. « Cardinalité des routes » : paragraphe + 2 tuiles (0, 39).
8. « Tenants & métering » : 2 tuiles (6, « — » + « dernier meter_tenant_usage »).

Au-dessus du pli : jusqu'à la rangée « Alertes & livraison ».

### 7.3 Widgets

Tous rendus par un composant `Stat` **local** (`L159-L168`), pas par `HeroStat`. Source unique : `internalHealth()` (`lib/queries-health.ts:L15-L48`), une seule requête de sous-sélections.

| Tuile | Mesure | Ligne SQL | Ton |
|---|---|---|---|
| Events (vitals) | `count(*)` `rum_metric` 5 min | `L19` | — |
| Pages vues | `count(*)` `rum_pageview` 5 min | `L20` | — |
| Erreurs | `sum(occurrences)` `rum_error` 5 min (invariant respecté) | `L21` | — |
| Sessions | `count(distinct session_id)` des pages vues 5 min | `L22` | — |
| Alertes non acquittées | `count` `alert_event` | `L24` | ambre si > 0 |
| Livraisons en file / échouées / abandonnées | `count` `alert_delivery` par statut | `L25-L27` | ambre / rouge |
| Lots en attente / abandonnés / plus vieux lot | `ingest_raw` tentatives < 5 / ≥ 5 ; âge en s | `L39-L42` | ambre > 1000 ; rouge > 0 ; « — » si file vide (`page.tsx:L123`) |
| Apps au plafond / routes distinctes (max) | `route_cardinality` vs `route_limit` (2000) | `L32-L35` | ambre si > 0 |
| Apps actives | `app_registry.active` | `L23` | — |
| Retard métering | heures depuis `max(metered_at)` | `L28` | ambre > 26 h, rouge > 30 h ; `null` → « — » (`page.tsx:L150`) |

### 7.4 Meilleur que Datadog

- **La panne silencieuse est cherchée** : l'endpoint effectivement utilisé par le capteur est affiché, avec l'anecdote des douze jours perdus (`L19-L24`, `L85-L91`).
- **Chaque section explique ce que son chiffre veut dire** — « UNLOGGED : ce qui attend ici est exactement ce qu'un redémarrage brutal perdrait » (`L111-L116`), « une application au plafond doit recevoir des règles de normalisation, pas un plafond plus haut » (`L129-L134`).
- **Mêmes chiffres que `/api/metrics`** (Prometheus), donc alertables ailleurs.
- Non établi que Datadog expose l'auto-observabilité de son ingestion à ses clients.

### 7.5 Plus faible

- **Fail-soft à zéro** : sur erreur de base, `internalHealth` renvoie un instantané de zéros (`queries-health.ts:L7-L12`, `L45-L47`) et la page affiche « 0 » partout, sans mention d'indisponibilité. C'est le cas exact que l'invariant interdit — un 0 à la place d'une inconnue — et sur cet écran c'est le plus trompeur possible : « 0 lot abandonné » rassure quand la base ne répond plus.
- **Quinze instantanés, aucune histoire** : pas de sparkline, pas de « il y a 5 min », pas d'horodatage du relevé. Un opérateur ne peut pas distinguer « 717 events, normal » de « 717, en chute ».
- **Aucun drill-down** : « Alertes non acquittées 1 » ne mène pas à `/alerts` ; « Apps au plafond » ne nomme pas l'app.
- **Composant `Stat` dupliqué** au lieu de `HeroStat` (`L159-L168`) ; les seuils de couleur (1000, 26 h, 30 h) ne sont écrits nulle part à l'écran.
- « 5 min glissantes » avec un badge « LIVE · 5 s » en haut : la page se rafraîchit, mais la fenêtre de 5 min n'est pas datée.

### 7.6 Données disponibles non affichées

- Tous les champs de `HealthSnapshot` sont affichés ; `ingest_backlog_age_s` l'est seulement quand la file n'est pas vide (`L123`), ce qui est correct.
- Une série (rollups horaires `rum_rollup_hourly`, `lib/queries-grid.ts:L20-L24`) existe en base mais **aucune fonction de requête** ne l'expose pour cet écran : une sparkline demanderait une requête, pas seulement un changement de front.

---

## 8. `50-overview-dark` — `/` en mode sombre (1 440 × 2 096)

### 8.1 Question posée

« Sur la fenêtre choisie, l'expérience est-elle bonne — score, Core Web Vitals, volume, erreurs — et qu'est-ce qui la tire vers le bas, par dimension et dans la durée ? » (`app/page.tsx`).

### 8.2 Mise en page réelle

Capture (thème sombre, `data-theme` géré par `ThemeToggle`) :

1. Filtres globaux ; sous-onglets PERFORMANCE (9 onglets, `nav-items.tsx:L30-L43`) ; barre de segment « SEGMENT tous les visiteurs · + Filtre » et puce « Bots exclus ».
2. `PageHeader` « Vue d'ensemble » avec bulle d'aide.
3. `HealthBanner` (`components/health/HealthBanner.tsx`) : anneau 85 / 100 « Bon », 4 `FactorBar` (Web Vitals 40 / 40, Erreurs JS 24,8 / 30, Stabilité des sessions 10 / 20, Anomalies LCP (24 h) 10 / 10), ligne « 40 % vitals (LCP x2) · 30 % erreurs · … Points perdus : Stabilité des sessions −10 pt (14/28 session(s) sans erreur) · Erreurs JS −5,2 pt (14 erreur(s) / 80 page(s) vue(s)) ».
4. Cinq `VitalCard` (`components/VitalCard.tsx`) : LCP 44 ms, INP 48 ms, CLS 0.035, FCP 44 ms, TTFB 3 ms — toutes « Bon », toutes « échantillon faible · médiane … » (n < 100, `VitalCard.tsx:L53-L55`), jauge de seuils sous le chiffre.
5. Bloc « Décomposition réseau » absent : éteint par défaut (`defaut: false`, `lib/dashboard-blocs.ts:L48`) et rendu seulement si une phase a des mesures (`page.tsx:L329-L332`).
6. `SupervisionHero` : Sessions · 7 j 28, Pages vues 80, Taux d'erreur JS / page vue 17,5 % (rouge), lecture ; graphe « LCP p75 dans le temps (buckets 6 h) » — `VitalsTimeseries` (`charts/VitalsTimeseries.tsx`) : aire orange plate à ~45 ms entre 08:00 et 14:00, axe y 0–60 ms.
7. `Breakdown` « Web Vitals par dimension » (`components/Breakdown.tsx`) : onglets Route / Navigateur / Système / Pays estimé / Appareil / Release ; barres `/partners` 29, `/partners/:id` 24, `/` 2 ; pilules LCP / INP / CLS (« — » quand absent) ; repli « Alternative textuelle du découpage ».
8. Carte « Historique de santé — 14 derniers jours » : bascule 24 h/24 · Heures ouvrées ; `HealthHeatmap` (`charts/HealthHeatmap.tsx`, divs serveur) 14 lignes × 24 colonnes, deux cases vertes ; légende ; puis deux graphes côte à côte : « Volume & fiabilité par jour » (`TrafficTimeseries.tsx`, aire pages vues + ligne erreurs, deux axes) et « p75 LCP par jour » (`VitalsTimeseries` en mode jour).
9. `VersionsTable` et `AnomalyTable` absents (moins de deux versions ; aucune anomalie).

Au-dessus du pli (1 029 px) : score, cinq vitals, début du hero. Hauteur totale 2 096 px.

### 8.3 Widgets

| Widget | Composant | Mesure / dimensions | Source | États |
|---|---|---|---|---|
| Score de santé | `HealthBanner` (SVG serveur) | 40 % part « good » pondérée LCP ×2 sur les 5 Core Vitals ; 30 % `1 − erreurs/pages vues` ; 20 % sessions sans erreur ; 10 % anomalies 24 h (−2,5 pt chacune) ; renormalisé sur les composantes disposant de données | `healthScore(f)` (`lib/health.ts:L138-L264`) | aucune composante trafic → « Santé : données insuffisantes… » (`HealthBanner.tsx:L83-L90`) ; composante sans donnée → « n/a » |
| VitalCards | `VitalCard.tsx` | p75, p50, n, p75 période précédente, verdict `rating2026` (seuils `lib/rating.ts:L5-L11` = 2 500/4 000, 200/500, 0,1/0,25, 1 800/3 000, 800/1 800 — ce sont les seuils web.dev) | `vitalsP75(f)` et `vitalsP75(f, true)` (`lib/queries.ts:L46-L66`) | p75 null → « — » et pas de badge ; n < 100 → « échantillon faible · médiane » |
| Tuiles du hero | `HeroStat` | sessions, pages vues, `errors/pageviews` ; delta vs période précédente | `overviewStats(f)` ×2 (`queries.ts:L124-L142`) | delta masqué si la période précédente vaut 0 (`page.tsx:L100-L101`) |
| Série LCP | `charts/VitalsTimeseries.tsx` | p75 par seau aligné UTC de la plage | `vitalSeries(f, "LCP")` (`queries.ts:L150-L163`) | vide → « Pas de données sur la fenêtre — élargis la période ou ouvre la démo. » |
| Découpage | `Breakdown.tsx` + `breakdown-view.tsx` | mesures LCP+INP+CLS par groupe, p75 de chacun ; « Inconnu » = groupe à part ; troncature dite | `vitalsBreakdown(f, dimension)` (`lib/queries-breakdowns.ts:L79-L109`) | vide → « Aucune mesure LCP, INP ou CLS sur 7 j. » ; onglet indisponible barré avec raison |
| Heatmap 14 j | `charts/HealthHeatmap.tsx` | part « good » pondérée par (jour, heure), fenêtre fixe, fuseau de l'app | `healthGrid(f)` (`queries-grid.ts:L60-L101`) | vide → « Pas assez de données sur 14 jours… » |
| Volume & fiabilité | `charts/TrafficTimeseries.tsx` | pages vues (aire, axe gauche), erreurs = `sum(occurrences)` (ligne, axe droit) par jour, jours vides à 0 | `dailyTraffic(f)` (`L110-L173`) | vide → « Pas de données. » |
| p75 LCP par jour | `VitalsTimeseries` `xAxis="day"` | p75 LCP par jour, 14 j | `dailyLcpSeries(f)` (`L176-L194`) | idem |
| Versions | `components/VersionsTable.tsx` | LCP, INP, taux d'erreur par release | `comparaisonVersions(f)` | se cache sous deux versions |
| Anomalies | `components/health/AnomalyTable.tsx` | p75 horaire vs 7 j, \|z\| > 3, 24 h fixes, sans filtre de population | `health.anomalies` | masqué si aucune |

Mode sombre : les couleurs de verdict ont leurs variantes `dark:` (`lib/rating.ts:L48-L53`) ; les axes recharts sont thémés via `globals.css` (commentaire `VitalsTimeseries.tsx:L18`) ; l'anneau lit `--c-line` (`HealthBanner.tsx:L20`). Aucun texte illisible constaté sur la capture. Les cases « aucune donnée » de la heatmap (`bg-panel2 opacity-60`) se distinguent peu du fond sombre : lisible, mais faible.

### 8.4 Meilleur que Datadog

- **Le score est décomposé et ses points perdus sont écrits** (`HealthBanner.tsx:L128-L138`) ; une composante sans donnée est exclue et le score renormalisé, jamais compté à zéro (`lib/health.ts:L247-L263`). Le dashboard Datadog « Performance Overview » n'a pas de score composite (`datadog-images-1.md` § 1.3).
- **Échantillon faible et médiane** sur chaque vital (`VitalCard.tsx:L53-L55`, `L100-L107`). Rien d'équivalent sur les tuiles Datadog lues.
- **Tendance vs période précédente** sur les tuiles (`HeroStat` `delta`, `VitalCard` `Trend`), alors que la tuile « Total page views » de Datadog n'en a pas (`datadog-images-1.md` § 1.3).
- **Seuils du produit = seuils web.dev** (`lib/rating.ts:L1-L11`) et dérivation des Core Vitals depuis ces seuils, avec le récit du bug de dénominateur (`L13-L34`).
- **Découpage avec « Inconnu » comme groupe à part**, provenance de chaque dimension écrite (`lib/breakdowns.ts:L61-L71`), drill-down qui **ajoute** la condition sans remplacer les filtres, troncature dite sans « Autres » (`Breakdown.tsx:L192-L198`).
- **Cases vides expliquées** (« le RUM n'enregistre que le trafic réel — les nuits/week-ends creux sont normaux », `page.tsx:L242-L248`).
- **Bots exclus par défaut et dit** (puce), blocs configurables avec une liste honnête des **indisponibles** et leur raison — Speed Index, opérateur réseau, comparaison à trafic comparable (`lib/dashboard-blocs.ts:L60-L75`).
- Alternative textuelle du découpage ; rendu serveur de la heatmap, du score et des barres.

### 8.5 Plus faible

- **Les seuils promis ne sont pas visibles** : la lecture dit « bande verte « bon » sous 2,0 s, rouge « mauvais » au-delà » (`page.tsx:L182-L184`) ; l'implémentation trace deux `ReferenceLine` pointillées à 2 500 et 4 000 ms (`VitalsTimeseries.tsx:L53-L67`), et l'axe y s'arrête à 60 ms sur la capture : aucune ligne n'apparaît. Trois écarts : « bande » ≠ ligne ; « 2,0 s » ≠ 2 500 ms ; hors domaine = invisible. Datadog dessine trois bandes pleines et cale l'axe sur les seuils (`datadog-images-1.md` § 1.3, « Pourquoi ce type de graphe est le bon »).
- **Un seul vital en série** (LCP) ; INP et CLS n'ont pas de courbe sur l'accueil alors que la grille CWV de Datadog en montre trois côte à côte (même source). `vitalSeries(f, name)` accepte tout nom, mais chaque vital est un appel de plus : ce n'est pas « déjà disponible », c'est « disponible au prix d'une requête ».
- **« 0 % » quand rien n'est collecté** : `errorRate = stats.pageviews ? … : "0"` (`page.tsx:L98`) — sans page vue, la tuile affiche « 0 % » et le ton `good`. L'invariant demande null / « — ».
- **Deux courbes LCP** (hero par seau, historique par jour) : redondance ; la seconde est la seule à 14 j, la première suit la fenêtre.
- **Double axe** sur « Volume & fiabilité » (`TrafficTimeseries.tsx:L41-L50`) — la critique que `datadog-images-1.md` § 1.3 adresse au widget « Number of page views and loading time » de Datadog s'applique ici ; la ligne d'erreurs rouge, en pic à 12 sur 80 vues, se lit comme un incident alors que c'est la démo.
- **Heatmap 14 × 24 = 336 cases pour 2 remplies** : c'est le bloc le plus haut de la page pour la moins d'information sur trafic clairsemé ; aucune bascule automatique vers « heures ouvrées » ou 7 jours.
- **Détail des facteurs en `title` seulement** (`HealthBanner.tsx:L67`) : « 14/28 sessions sans erreur » n'est lisible qu'au survol (repris partiellement dans la ligne « Points perdus », uniquement pour les facteurs dominants).
- « CLS · 1 mesures » avec badge « Bon » : le badge est posé avant l'avertissement ; un verdict sur une mesure devrait céder la place à « non établi ».
- Le bouton flottant « Votre avis ? » chevauche le graphe du hero (constat § 12.3).

### 8.6 Données disponibles non affichées

- `vitalsP75` renvoie `p50` pour chaque vital (`queries.ts:L38-L43`) : affiché seulement sous 100 mesures.
- **Les phases réseau** REDIRECT / DNS / TCP / TLS / REQUEST / RESPONSE sont dans le même résultat (`page.tsx:L307-L318`) ; bloc éteint par défaut.
- `vitalsPrev` porte aussi `p50` et `n` (variation du volume de mesures, non montrée).
- `health.factors[].detail` (texte brut lisible) — en `title`.
- `HealthGridCell.good_w / total_w` : le pourcentage exact n'est que dans l'infobulle (`HealthHeatmap.tsx:L97-L107`).
- `dailyTraffic` : pages vues et erreurs par jour permettent un taux d'erreur quotidien, calculable côté rendu.
- `statsPrev` : sessions et pages vues de la période précédente sont lues ; quand elles valent 0, ni le delta ni la raison (« période précédente vide ») n'apparaissent.
- `decoupe.groups` et `truncated` — déjà affichés.

---

## 9. `51-pages-dark` — `/pages` en mode sombre (1 440 × 2 862)

### 9.1 Question posée

« Quelles routes ont le chargement perçu le plus lent (LCP p75), à quoi ressemble la distribution derrière le p75, et qu'est-ce qui cause la lenteur — ressources, blocages du fil principal ? » (`app/pages/page.tsx:L75-L78`).

### 9.2 Mise en page réelle

1. Filtres, sous-onglets (Pages lentes actif), barre de segment.
2. `PageHeader`.
3. Bandeau « N routes distinctes — les 200 plus lentes sont affichées » : absent (3 routes < `ROUTES_MAX`, `L85-L101`).
4. `SupervisionHero` : Routes suivies · 7 j 3 ; Routes « mauvais » LCP 0 (indice « LCP p75 > 4,0 s (seuil 2026) ») ; Route la plus lente 47 ms « / » (en ambre) ; lecture ; graphe `RankBar` « Routes les plus lentes — LCP p75 » : `/` 47 ms, `/partners` 44 ms, barres vertes, sous-texte « 28 vues · 1 long tasks ».
5. `Breakdown` « Web Vitals par dimension » (même composant que l'accueil, drill vers `/pages` filtré).
6. `PercentileTable` (`components/Distribution.tsx:L23-L72`) : LCP / INP / CLS / FCP / TTFB × p50 / p75 / p90 / p95 / p99 / mesures, pilules colorées par verdict.
7. Trois `Histogram` (`Distribution.tsx:L86-L151`) LCP / INP / CLS : SVG serveur, 20 tranches sur [0, cap] (6 000 ms, 1 000 ms, 1), barres colorées par verdict du milieu de tranche ; sur la capture, **une seule barre à l'extrême gauche** dans chaque.
8. « Par route » : tableau Route (lien de drill + repli « N ressource(s) lente(s) ») / Vues / LCP p75 / INP p75 / CLS p75 / Long tasks.
9. `ResourcesView` (`components/ResourcesView.tsx`) : bandeau ambre `RESOURCE_THRESHOLD_NOTICE` (`lib/resources.ts:L32-L33`), barre « Première partie 28 · 100 % · 1,7 Mo », tableaux « Par type » (script 28, 1 ms, 1,7 Mo) et « Par origine » (localhost, Première partie).
10. `LongtasksView` (`components/LongtasksView.tsx`) : « Blocages du fil principal dans le temps » — `StackedBars` LoAF / Long Tasks / API non distinguée par seau de 6 h (une barre à 8 le 18/09 14 h), repli textuel, paragraphe « Aucun cumul de durées n'est affiché » ; tableau « Les blocages les plus longs, et leur session » (8 lignes « frame longue (script non attribué) · loaf », 12 ms → 0 ms, lien session).

Au-dessus du pli : hero et début du découpage. Huit sections, 2 862 px, pas d'ancres.

### 9.3 Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Classement des routes | `charts/RankBar.tsx` | 8 routes au LCP p75 le plus haut, couleur = verdict, sous-texte vues + long tasks | `slowRoutes(f)` (`lib/queries.ts:L207-L248`, CTE, limite 200, ordre `lcp_p75 desc nulls last`) | vide → « Aucune donnée sur la fenêtre. » |
| Tuiles | `HeroStat` | nombre de routes, routes « poor », pire route | idem + `rating2026` | pire route absente → « — » |
| Découpage | `Breakdown.tsx` | comme § 8.3 | `vitalsBreakdown` | idem |
| Percentiles | `PercentileTable` | `percentile_cont` p50…p99 par vital | `vitalPercentiles(f)` (`queries.ts:L75-L88`) | aucun vital → composant masqué (`L26`) ; valeur null → pilule « — » |
| Histogrammes | `Histogram` | `width_bucket` sur [0, cap], 20 tranches, débordement replié dans la dernière (`lib/distribution.ts:L35-L51`) | `vitalHistogram(f, name, cap, 20)` (`queries.ts:L96-L115`) | total 0 → « pas de mesure sur la fenêtre » |
| Par route | `<table>` | vues, p75 LCP / INP / CLS, long tasks ; ressources lentes repliées (type, URL, `avg_ms`, × n, « bloquant ») | `slowRoutes`, `slowResourcesByRoute` (`L278-L301`) | vide → « Aucune donnée sur 7 j » |
| Ressources | `ResourcesView` | comptes, p75 durée, octets par type / origine / partie ; partage lu sur les origines déclarées | `resourcesVue(f)` (`lib/queries-resources.ts:L74-L133`) | total 0 → carte « Aucune ressource retenue… » ; partage non calculable → texte dédié (`ResourcesView.tsx:L148-L155`) |
| Blocages | `LongtasksView` + `StackedBars` | comptes par API par seau ; p75 de blocage par seau dans le repli ; 25 pires blocages | `longtaskSeries(f)`, `worstLongtasks(f)` (`lib/queries-longtasks.ts:L31-L61`, `L81-L101`) | total 0 → « Aucun blocage mesuré… LoAF n'existe que sur Chromium » |

### 9.4 Meilleur que Datadog

- **La liste dit qu'elle est plafonnée** et pourquoi la cardinalité grimpe (`page.tsx:L80-L101`).
- **L'avertissement précède les chiffres** sur les ressources — échantillon biaisé vers le lent, non extrapolé (`ResourcesView.tsx:L101-L110`).
- **Aucune somme de durées de blocage**, avec la raison (`LongtasksView.tsx:L4-L9`, `L94-L100`) ; le cas individuel (la session) est offert à la place.
- **Partage première / tierce partie sans requête sortante**, sur les seules origines déclarées (`ResourcesView.tsx:L156-L160`).
- **Percentiles jusqu'au p99** avec l'explication de chaque colonne en `title` (`Distribution.tsx:L74-L83`) ; Datadog montre p50/p75/p90/p95 dans l'explorateur (`datadog-video-rum-db-new.md` L158).
- Drill-down d'une route qui conserve plage et filtres (`L70-L71`) ; « sans session rattachée » plutôt qu'une cellule vide (`LongtasksView.tsx:L141-L143`).
- Tout le haut de page est rendu serveur (RankBar, table, histogrammes SVG).

### 9.5 Plus faible

- **Histogrammes à échelle fixe** : avec des mesures à 45 ms sur un axe de 6 s, les trois graphes sont une barre collée à gauche (capture). Aucun repère de percentile sur l'histogramme — c'est la recommandation M3 déjà notée dans `datadog-video-rum-db-new.md` (L158) ; aucune échelle adaptative ni log.
- **« Route la plus lente » toujours en ambre** (`page.tsx:L145`, `tone="warn"` inconditionnel) : 47 ms est « Bon » et s'affiche en couleur d'alerte.
- **Redondance** : le hero et « Par route » listent les mêmes routes (3 ici) ; à faible cardinalité, le hero n'apporte que la couleur.
- **Deux vitals sans distribution** : FCP et TTFB sont dans la table des percentiles, pas dans les histogrammes (`L180-L182`).
- **Pas de dimension « type de chargement »** : `/partners/:id` a un INP mais pas de LCP — signature d'une navigation SPA — et rien ne le dit. Datadog découpe par `view.loading_type` (`datadog-images-1.md` § 1.3, « Initial page load vs SPA route changes »). Collecte de cette dimension : **non établi**.
- **Tableau des pires blocages avec des lignes à 0 ms** (capture : « 0 ms » sur deux lignes) — un « pire » à 0 ms n'informe pas ; la définition de `blocking_ms` (durée − 50 ms ?) est **non établie** ici.
- Huit sections sur 2 862 px sans sommaire ; la colonne « Long tasks » du tableau et la section « Blocages » sont à un écran l'une de l'autre.
- Bouton flottant sur l'onglet « Release » du découpage (capture, § 12.3).

### 9.6 Données disponibles non affichées

- `LongtaskBucket.p75_ms` (`queries-longtasks.ts:L18-L28`) n'apparaît que dans le repli textuel (`LongtasksView.tsx:L78-L80`) ; `LineTrend.tsx` sait dessiner une valeur + un volume sur deux axes : une courbe de p75 au-dessus des barres est possible sans requête.
- `SlowResource.render_blocking`, `type`, `n`, `avg_ms` (`queries.ts:L268-L275`) : repliés par défaut sous chaque route ; le nombre de ressources bloquantes par route n'est pas une colonne.
- `ResourceGroupe.octets` et `p75_ms` — affichés ; `partageCalculable` — affiché.
- `vitalPercentiles` porte FCP et TTFB : `vitalHistogram` sait les tracer (fonction existante, appel supplémentaire).
- `LongtaskWorst.source` — puce affichée ; `route` — colonne affichée.

---

## 10. `60-overview-390` — `/` à 390 px (390 × 3 570)

### 10.1 Question posée

Même écran que § 8 ; ce qui change est l'agencement.

### 10.2 Mise en page réelle à 390 px

1. En-tête : logo, sélecteur d'app tronqué « Mini-site de dé… », icône grille (menu) — la sidebar est repliée.
2. Filtres sur **trois rangées** : presets (1 h / 24 h / 7 j / Personnalisée) ; appareils + Filtres ; LIVE + thème. ≈ 130 px.
3. Sous-onglets en défilement horizontal (« Fr » coupé au bord droit : `overflow-x-auto`, `SubNav.tsx:L21`), sans dégradé ni flèche.
4. Barre de segment sur deux lignes.
5. Surtitre, titre « Vue d'ensemble » + bulle.
6. `HealthBanner` : anneau et libellé à gauche ; **les quatre facteurs deviennent « W. 40 / 40 », « E. 24,8 / 30 », « S. 10 / 20 », « A. 10 / 10 »** — le libellé est tronqué à une lettre (`FactorBar` `truncate`, `HealthBanner.tsx:L69` ; le `min-w-0` de `L67` évite le débordement mais sacrifie le mot). Le texte « Points perdus » suit, sur 6 lignes.
7. `VitalCard` en **deux colonnes** (`grid-cols-2`, `page.tsx:L132`) : LCP / INP, CLS / FCP, puis **TTFB seule** sur la troisième rangée.
8. Le bouton flottant « Votre avis ? » **recouvre** le bas de la carte INP (« p75 · 26 mesures » partiellement caché, capture).
9. Hero empilé : Sessions 28, Pages vues 80, Taux 17,5 %, lecture ; puis « LCP p75 dans le temps (buckets 6 h) » à 260 px de haut, axe y de 80 px (`VitalsTimeseries.tsx:L51`) — le tracé occupe ≈ 250 px de large.
10. Découpage : onglets sur deux lignes ; chaque route sur deux lignes (libellé + barre, puis pilules) — voulu (`Breakdown.tsx:L118-L140`).
11. Historique 14 j : la heatmap défile horizontalement dans sa carte (`min-w-[640px]` + `overflow-x-auto`, `HealthHeatmap.tsx:L73-L74`) ; colonnes visibles 0 h → 18 h ; légende ; puis « Volume & fiabilité » et « p75 LCP par jour » empilés.

Au-dessus du pli (≈ 844 px sur un téléphone courant, non établi sur la capture) : en-tête, trois rangées de filtres, onglets, segment, titre et anneau. **Aucun Web Vital n'est visible sans défiler.** Hauteur totale 3 570 px, soit plus de quatre écrans.

Aucun débordement horizontal de page : les commentaires du code documentent les corrections faites pour 390 px (`VitalCard.tsx:L77-L79`, `HealthBanner.tsx:L64-L66`, `L98-L101`, `page.tsx:L212-L215`).

### 10.3 Widgets

Identiques à § 8.3 ; les composants ne changent pas de rendu selon la largeur, seule la grille CSS se replie.

### 10.4 Meilleur que Datadog

- **La page tient dans 390 px sans défilement latéral**, et le seul défilement horizontal est contenu dans la heatmap. Les captures Datadog des lectures sont toutes à ≥ 1 300 px ; le rendu mobile de Datadog RUM est **non établi**.
- Les alternatives textuelles restent disponibles à cette largeur.

### 10.5 Plus faible

- **Libellés de facteurs réduits à une lettre** : « W. / E. / S. / A. » n'est pas lisible ; la troncature `truncate` est le mauvais outil ici (un libellé court dédié, ou le libellé au-dessus de la barre, garderait le mot).
- **Chevauchement** du bouton flottant sur une carte de mesure (§ 12.3).
- **Chrome de filtres ≈ 330 px** avant le premier chiffre ; rien n'est replié par défaut.
- **Carte orpheline** (TTFB) sur une grille de deux colonnes pour cinq cartes.
- **Graphe de 260 px de haut avec 80 px d'axe** : un cinquième de la largeur pour les graduations « 0 ms … 60 ms » ; la largeur d'axe est fixe (`width={80}`).
- **Heatmap 14 × 24 à faire défiler** : à 390 px, la vue « Heures ouvrées » (12 colonnes) ou 7 jours serait le défaut naturel ; ici l'utilisateur doit cliquer la bascule.
- Onglets défilants sans affordance de défilement.
- Les paragraphes de lecture (hero, heatmap) font 5 à 7 lignes ; ce sont les mêmes textes qu'à 1 440 px.

### 10.6 Données disponibles non affichées

Comme § 8.6. À 390 px s'ajoute : le libellé complet du facteur est disponible (`factor.label`) et n'est plus affiché.

---

## 11. `61-errors-390` — `/errors` à 390 px (390 × 1 925 mesurés sur l'image ; la capture s'arrête sous la première ligne du tableau, la hauteur réelle de la page est donc ≥ 1 925 px et non établie)

### 11.1 Question posée

« Combien d'erreurs, en combien de causes récurrentes, quand ont-elles piqué, sur quelles routes / navigateurs — et lesquelles traiter d'abord ? » La démo est en **mode historique** (titre « Groupes distincts », sous-titre « Erreurs regroupées par signature (type + message + frame) », `app/errors/page.tsx:L139-L142`) : le regroupement v2 « issues » (`IssueList.tsx`) n'est pas actif sur `demo-app` (`L92-L121`).

### 11.2 Mise en page réelle à 390 px

1. En-tête, filtres sur trois rangées, sous-onglets (Erreurs JS actif), segment — comme § 10.2.
2. `PageHeader` : titre + sous-titre sur quatre lignes.
3. `ErrorNotices` : rien (pas d'échantillonnage, enrichissement disponible).
4. Hero empilé : Occurrences · 7 j **14** (ambre) ; Groupes distincts 1 ; Pic par 6 h 12 « à partir de 18/09 14 h » ; lecture de **sept lignes** (`L190-L196`) — le bouton flottant la recouvre sur la capture.
5. « Volume d'erreurs par 6 h (7 j) — par groupe » : `StackedBars` (`charts/StackedBars.tsx`), une seule série, légende « Error », barres à 3 (15/09) et 12 (18/09 14 h), axe x « 11/09 14 h · 13/09 08 h · 15/09 02 h · 18/09 14 h » (`bucketTick`, `components/errors/error-view.ts:L108-L112` — les autres citations `error-view.ts` de cette section visent ce même fichier) ; repli « Alternative textuelle de la série ».
6. `Breakdown` « Occurrences par dimension » (Route actif) : `/partners` 12 (Sessions 12 · Signatures 1), `/` 2 (Sessions 2 · Signatures 1) ; notice précisant que le découpage porte sur **toutes** les occurrences, hors triage (`L82`).
7. Tableau « Groupe » dans une carte `overflow-x-auto` avec `min-w-table` (`L201-L202`) : à 390 px, seule la colonne « Groupe » est visible (« C… » coupé à droite = « Occurrences ») ; première ligne : badge « Error », « Uncaught Error: Erreur de démo MIP RUM », « df1b74ca · demo-app ».

### 11.3 Widgets

| Widget | Composant | Mesure | Source | États |
|---|---|---|---|---|
| Tuiles | `HeroStat` | `sum(occurrences)` ; nombre de groupes ; seau maximal et son début | `listErrorGroups(f, page, { series: true })` (`lib/queries-errors.ts:L825-L882`) → `totals`, `total`, `trend` | 0 occurrence → ton `good` ; pic absent → pas d'indice |
| Volume empilé | `StackedBars` via `errorVolumeChart` (`error-view.ts:L124-L148`) | par seau : 5 groupes dominants de la page + « autres » = tendance − dessinés, borné à 0 | `groups[].series`, `trend` | `totals.occurrences === 0` → « Aucune erreur sur cette période » |
| Découpage | `Breakdown.tsx` + `errorsBreakdownItems` | occurrences, sessions touchées (« aucune » si 0), signatures par groupe | `errorsBreakdown(f, dimension)` (`queries-breakdowns.ts:L119-L145`) | vide → « Aucune occurrence d'erreur sur 7 j. » |
| Tableau | `<table>` + `GroupSparkline.tsx` (SVG serveur) + badges | occurrences, `fmtCount(sessions_affected)` et `visitors_affected` (« Inconnu » si null), sparkline par seau, première vue (depuis toujours), dernière vue | même lecture | vide → « Aucune erreur sur cette période » ; offset hors population → lien « revenir au début » (`L266-L279`) ; pagination `Groupes N–M sur T` |
| Avis | `ErrorNotices.tsx` | échantillonnage : probabilité d'inclusion minimale, **sans extrapolation** (`samplingOf`, `queries-errors.ts:L411-L421`) ; enrichissement v69 absent | `sampling`, `enrichment` | masqués si sans objet |
| Sans empreinte | texte | occurrences v0.1 non groupées, hors compteurs | `unfingerprinted` | masqué si 0 |

### 11.4 Meilleur que Datadog

- **« Inconnu » n'est pas zéro**, et la lecture l'explique (« une erreur backend sans session, par exemple — ce n'est pas zéro personne », `L194-L195` ; `fmtCount`, `error-view.ts:L97-L100`).
- **Occurrences = somme des répétitions** (`ErrorImpact.occurrences`, requêtes `sum(occurrences)`), avis d'échantillonnage fondé sur la probabilité d'inclusion, aucune pondération (`queries-errors.ts:L403-L410`).
- **« Première vue (depuis toujours) »** : la seule colonne hors fenêtre est nommée comme telle (`L213-L219`).
- **Occurrences sans empreinte comptées à part et dites** (`L308-L313`).
- **Un lien par ligne** au clavier (`L235`), sparkline libellée avec la fenêtre réelle (`GroupSparkline.tsx:L4-L6`).
- **Le découpage annonce sa population** (toutes les occurrences, hors triage, `L82`).
- Le panneau Error Tracking de Datadog (`datadog-images-1.md`, image 2 : liste d'issues + panneau latéral) n'a pas été relu pour ce lot ; les points ci-dessus ne lui sont pas opposés, ils sont à conserver.

### 11.5 Plus faible

- **Légende du graphe = type d'erreur tronqué à 22 caractères** (`error-view.ts:L143`, `name: (g.error_type ?? "Error").slice(0, 22)`) : ici « Error » ; avec plusieurs groupes du même type, la légende répète « Error », « Error », « TypeError » sans les distinguer. Le message d'exemple ou l'empreinte courte identifierait la couche.
- **Tableau inutilisable à 390 px** : les colonnes Occurrences / Sessions / Visiteurs / Tendance sont hors écran ; aucune mise en page en cartes pour le mobile (la carte défile, `L201`, mais rien ne le signale).
- **Lecture de sept lignes** sur mobile, recouverte par le bouton flottant (§ 12.3).
- **Pas de comparaison à la période précédente** sur « Occurrences » : `HeroStat` sait afficher un delta, `listErrorGroups` n'a pas d'option `shift` — non disponible sans requête.
- **Mode historique sans filtres** : le formulaire Statut / Source / Release n'existe qu'en mode issues (`IssueList.tsx:L111-L151`) ; ici, aucun moyen de masquer les groupes résolus.
- Jargon dans le sous-titre (« type + message + frame ») sans bulle.
- Trois rangées de filtres avant le titre (§ 12.2, 10.5).

### 11.6 Données disponibles non affichées

- `ErrorImpact.session_coverage`, `identity_coverage`, `identified_users_affected` (`queries-errors.ts:L156-L163`) : la part des occurrences rattachées à une session qualifierait « Inconnu » (« 12 sessions · couverture 100 % ») — lu, non rendu.
- `ErrorTotals.sessions_affected` / `visitors_affected` (`L189-L192`) : une tuile « Sessions touchées · 7 j » est possible sans requête.
- `sampling.min_inclusion_probability` : le nombre est dans le message seulement.
- `status`, `regressed`, `resolved_at` — rendus en badges ; `series` — rendu en sparkline.

---

## 12. Constats transversaux du lot

### 12.1 Surtitre « PERFORMANCE UTILISATEUR » sur tous les écrans

Les captures 25 à 31 portent le même surtitre, y compris « Vie privée · DSAR », « Santé interne » et « API et MCP ». `PageHeader` accepte un `domain` (`app/ai/page.tsx:L44`, `domain="ai"`) ; les autres pages ne le renseignent pas. Un surtitre qui ne change jamais n'oriente pas.

### 12.2 Barre de filtres au-dessus d'écrans qui ne la lisent pas

Les trois écrans fermés (26, 27, 28) rendent la barre de filtres globaux — presets, appareil, Filtres — au-dessus d'une carte qui n'exécute aucune requête. `GlobalFilters.tsx:L75-L76` masque la barre pour les surfaces sans filtres (admin) ; les surfaces verrouillées ne sont pas dans ce cas. La sous-navigation, elle, est bien masquée quand la catégorie est verrouillée (`SubNav.tsx:L15-L18`).

### 12.3 Bouton flottant « Votre avis ? »

Présent sur les onze captures, fixé en bas à droite. À 1 440 px il recouvre le graphe du hero (capture 50) et l'onglet « Release » du découpage (capture 51) ; à 390 px il recouvre le texte de la carte INP (capture 60) et la lecture du hero (capture 61).

Ce n'est pas un composant React : c'est le script public `public/mip-rum-feedback.js`, chargé par `app/layout.tsx:L115` pour que la console collecte son propre ressenti (événement `feedback` → `rum_event`, app `mip-rum-console`, commentaire `layout.tsx:L112-L114`). Ce que le script garantit : position `fixed` à 20 px du bas et de la droite (`OFFSET`, `L70`, `L205`), `z-index` 2 147 483 000 (`L71`), donc au-dessus de tout ; il ne se monte pas pendant la période de silence qui suit un avis envoyé (`silenced()`, `L138-L149`, horodatage en `localStorage` ; `mount()`, `L459-L460`) et se masque sur les chemins non autorisés (`refreshGate()`, `L447-L455`). Ce qu'il ne garantit pas : aucune règle de repli, d'évitement du contenu ni de position différente sous une largeur donnée. Tant qu'aucun avis n'a été envoyé, le bouton reste sur toute page autorisée, à toute largeur, par-dessus ce qui s'y trouve : le chevauchement observé est structurel, pas accidentel.

### 12.4 Invariants de vérité : trois écarts trouvés dans ce lot

| Écran | Écart | Emplacement |
|---|---|---|
| `/` | « 0 % » de taux d'erreur quand il n'y a aucune page vue | `app/page.tsx:L98` |
| `/admin/health` | instantané à zéros sur erreur de base, sans mention d'indisponibilité | `lib/queries-health.ts:L7-L12`, `L45-L47` |
| `/svi` | segment « résolus » = total − abandonnés − transférés, incluant les échecs | `app/svi/page.tsx:L133-L138` |

Et un écart libellé / donnée : `/ai` interroge 24 h sous une période « 1 h » (`app/ai/page.tsx:L37`, `L56`).

### 12.5 Ce que le lot fait mieux que ce que les lectures Datadog montrent, en une liste

Honnêteté des inconnues (« Inconnu » ≠ 0, « — » pour un p75 sans mesure, « n/a » pour un facteur sans donnée) ; avis d'échantillonnage sans extrapolation ; couverture affichée plutôt qu'un taux sur une fraction (SVI, issues, ressources) ; explication écrite de chaque graphique et de chaque silence (cases vides, pas de cumul de durées, liste plafonnée) ; garantie d'effacement délimitée dans l'écran ; refus motivé d'une demande RGPD non exécutable ; état d'un service mesuré avant d'en distribuer l'adresse ; blocs indisponibles listés avec leur raison ; alternatives textuelles ; rendu serveur des graphiques simples ; français partout.

### 12.6 Ce que Datadog fait mieux, d'après les lectures, et qui manque ici

Bandes de seuils pleines avec axe calé sur les seuils (`datadog-images-1.md` § 1.3) ; trois Core Web Vitals en séries côte à côte ; tableaux de bord préconstruits à cloner et variables de template ; chaque widget redevient une requête (trois icônes, `datadog-video-newfastresponsiveengagingappsvideo.md` L136) ; repères de percentiles sur les distributions (`datadog-video-rum-db-new.md` L158) ; découpage par type de chargement (`initial_load` / `route_change`) ; comptes annoncés sur les onglets avant le clic (`datadog-video-240523…md` L214).
