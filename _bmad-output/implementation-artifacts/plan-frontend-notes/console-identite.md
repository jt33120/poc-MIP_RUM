# Identité visuelle et éditoriale de la console MIP RUM — état du code au 18/09/2026

Lecture de direction de conception. Tout ce qui suit est tiré du code du dépôt `poc-MIP_RUM`
(chemins relatifs à sa racine), des quatre captures nommées dans la commande, et de trois
documents (`PLAN-CLAUDE-P5-P8.md` §4, `docs/LIMITES.md`, `docs/CONFORMITE.md`, `docs/context/produit-rum.md`).
Ce document dit ce que la console garantit aujourd'hui et ce qu'elle ne garantit pas ; il ne
propose pas encore de refonte — il fixe ce qu'une refonte doit respecter. Là où le code ne permet
pas de trancher, il est écrit « non établi ».

Ce qui n'a PAS été lu : les pages `apps/console/app/**/page.tsx` autres que celles citées, les
composants des sous-dossiers `alerts/`, `correlation/`, `features/`, `map/`, `replay/`, `slo/`,
`sourcemaps/`, `tracing/`, `wizard/`, `onboarding/`, `legal/`, `xsom/` (sauf mentions ponctuelles
issues d'un grep), et la vitrine `components/presentation/*`. Les captures Datadog n'ont pas été
regardées ici : la section 4 compare à ce que Datadog est en général, pas à ses captures.

---

## 1. La charte telle qu'elle existe

### 1.1 Jetons de couleur et leur sens constant

Source : `apps/console/tailwind.config.ts:3-46` et `apps/console/app/globals.css:60-95`.
Le commentaire de `globals.css:61-69` pose la règle : « La couleur n'est JAMAIS décorative ;
chaque teinte porte un sens constant dans toute l'app ». Les surfaces sont neutres (gris ardoise),
pas bleutées.

| Jeton Tailwind | Valeur clair | Valeur sombre | Sens constant | Source |
|---|---|---|---|---|
| `app` | `249 250 251` | `10 14 23` | fond de page | globals.css:72 / :85 |
| `panel` | `255 255 255` | `17 23 35` | cartes, surfaces | :73 / :86 |
| `panel2` | `246 248 250` | `24 31 46` | surfaces incrustées (thead, chips, fond de barre) | :74 / :87 |
| `line` | `228 232 238` | `38 47 64` | bordures ; `borderColor.DEFAULT` | :75 / :88 ; tailwind:47-49 |
| `ink` / `ink-soft` / `ink-faint` | `17 24 39` / `82 95 117` / `143 154 172` | `229 234 242` / `156 167 185` / `104 116 136` | texte principal / secondaire / tertiaire | :76-78 / :89-91 |
| `brand` / `brand-strong` | `37 99 235` / `29 78 216` | `96 165 250` / `147 197 253` | « bleu perf — liens & accents de domaine » ; éclairci la nuit | :79-80 / :92-93 |
| `accent` (+ `soft`, `deep`) | `#f89101` / `#fbbc64` / `#d97b00` | identiques | action primaire, marque MIP, « rare, un CTA » | tailwind:25-29 ; globals:64 |
| `perf` (+ `soft`, `ink`) | `#2563eb` / `#dbeafe` / `#1d4ed8` | identiques (pas de variante sombre) | domaine « Performance utilisateur » (RUM) | tailwind:32 |
| `ai` (+ `soft`, `ink`) | `#7c3aed` / `#ede9fe` / `#6d28d9` | identiques | domaine « Intelligence artificielle » (LLM) | tailwind:34 |
| `good` / `warn` / `bad` (+ `soft`) | `#059669` / `#d97706` / `#dc2626` | identiques | état d'une mesure : bon / à surveiller / mauvais | tailwind:36-38 |
| `navy.700…950` | `#16275c` … `#060c20` | identiques | navy MIP fixe, texte sur bouton orange | tailwind:40-45 |

Ombres : `shadow-card` (cartes), `shadow-pop` (bulles, survol de VitalCard), `shadow-glow`
(orange, réservé à la marque) — tailwind:70-74. Animations : `pulse-dot` (vert, point « live »),
`fade-up` (entrée d'écran, 0,3 s) — tailwind:80-93 ; `mip-fleche` avec repli
`prefers-reduced-motion` — globals.css:51-58.

Ce que la charte dit et ce que le code fait réellement (compté par grep sur `app/` + `components/`, `*.tsx`) :

| Classe | Occurrences | Lecture |
|---|---:|---|
| `text/bg/border-good` | 20 | jeton d'état « bon » réellement utilisé, mais minoritaire |
| `text/bg/border-warn` | 63 | jeton « à surveiller » — c'est le plus employé des trois (bandeaux `role=note`, chips non appliquées) |
| `text/bg/border-bad` | 45 | jeton « mauvais » |
| `emerald-*` | 44 | palette Tailwind brute, même sens que `good` |
| `amber-*` | 48 | palette Tailwind brute, même sens que `warn` |
| `red-*` | 90 | palette Tailwind brute, même sens que `bad` — deux fois plus fréquente que le jeton |
| `perf` (`text/bg/border/ring-perf`) | 74 | anneaux de focus, onglet actif, chips appliquées, kicker |
| `accent` | 84 | barres classées, CTA, série principale des courbes |

Conclusion : le sens est constant (vert = bon, ambre = à surveiller, rouge = mauvais) mais la
**valeur** ne l'est pas. `RATING_CLASS` (`apps/console/lib/rating.ts:48-53`) et `RATING_BAR`
(:56-60) sont écrits en `emerald/amber/red`, `RATING_HEX` (:63-67) en `#059669/#d97706/#dc2626`
(= les jetons). Les graphes recharts emploient une troisième série : `VitalsTimeseries.tsx:57,63`
(`#10b981` / `#ef4444`), `TrafficTimeseries.tsx:23` (`#ef4444`), `GroupSparkline.tsx:14`
(`text-red-500`). L'anneau de santé ajoute un **bleu ciel** pour l'état « Bon »
(`HealthBanner.tsx:8` `#0ea5e9`, `lib/health.ts:92` `sky-*`) qui n'appartient à aucun domaine
de la charte — ni `perf`, ni `good`. Une refonte doit ramener tout cela aux quatre valeurs
`RATING_HEX` + `perf` ; ce n'est pas une question de goût, c'est la règle écrite dans `globals.css:62`.

Palette catégorielle (séries à N groupes) : huit teintes déterministes, définies deux fois à
l'identique — `Sankey.tsx:16` et `dashboards/WidgetChart.tsx:15`
(`#2563eb #059669 #d97706 #dc2626 #7c3aed #0891b2 #db2777 #65a30d`). Elle réutilise les couleurs
d'état (vert, ambre, rouge) pour des catégories qui n'ont pas d'état : une route dessinée en rouge
dans le Sankey n'est pas « mauvaise ». C'est une entorse à la règle « couleur = sens », documentée
nulle part.

### 1.2 Domaines sémantiques à l'écran

- Le **kicker** au-dessus du titre (`PageHeader.tsx:8-11, :32-35`) : point coloré + libellé en
  capitales 11 px, `perf` → « Performance utilisateur » (bleu), `ai` → « Intelligence artificielle »
  (violet). Défaut `perf`. Visible sur les quatre captures.
- La navigation porte le domaine (`nav-items.tsx:12` `domain: "perf" | "neutral"`) : icône bleue
  quand la catégorie est active, grise sinon (`Nav.tsx:8, :23`). Le liseré d'activation est
  **orange** (`Nav.tsx:84` `bg-accent`), le fond `bg-perf/10` (:80).
- Le violet `ai` n'est employé que sur des surfaces fermées ou de sélection : `app/ai/page.tsx:44-70`,
  `components/xsom/XsomAiPanel.tsx:21-33`, `app/select/page.tsx:40`, `app/select/new/page.tsx:313,561`,
  et une pastille de span « db » dans la cascade de trace (`app/tracing/[traceId]/page.tsx:22`).
  Dans la console de supervision ouverte, le violet est donc quasi absent — ce qui est cohérent avec
  « Supervision IA » verrouillée (`nav-items.tsx:101`).
- L'orange `accent` : bouton primaire (`.btn-accent`, globals.css:133-135), liseré de navigation,
  onglet de découpage actif (`Breakdown.tsx:85`), et **série principale de la plupart des graphes**
  (`VitalsTimeseries.tsx:19`, `TrafficTimeseries.tsx:22`, `LineTrend.tsx:24`, `RadarScore.tsx:22`,
  `ScatterPlot.tsx:28`, `RankBar.tsx:54`, `Breakdown.tsx:126` `bg-accent/70`, `Funnel.tsx:68`).
  Le commentaire de `globals.css:64` dit « rare, un CTA » ; le code en fait la couleur de donnée
  par défaut. Les deux lectures coexistent : orange = « ce que MIP mesure », bleu = « où on est ».
  Cette ambiguïté est à trancher dans la refonte, pas à laisser dériver.

### 1.3 Typographie

- Pile système, sans police web : `tailwind.config.ts:50-69` (`ui-sans-serif, system-ui, …`) ;
  mono `ui-monospace, SFMono-Regular, JetBrains Mono, Menlo…`. Aucun `next/font` ni
  `fonts.googleapis` dans `app/` ni `components/` (grep vide).
- Échelle observée dans les composants partagés :

| Rôle | Classes | Source |
|---|---|---|
| Kicker de domaine | `text-[11px] font-semibold uppercase tracking-[0.14em]` | PageHeader.tsx:32 |
| Titre de page (h1) | `text-xl font-bold tracking-tight text-ink` | PageHeader.tsx:36 |
| Sous-titre | `text-sm text-ink-soft` | PageHeader.tsx:40 |
| Titre de carte / de graphe (h2) | `text-[11px] font-semibold uppercase tracking-wider text-ink-faint` | SupervisionHero.tsx:38 ; Breakdown.tsx:71 ; Distribution.tsx:100 |
| En-tête de table | `.th` = `text-[11px] font-semibold uppercase tracking-wider text-ink-faint` | globals.css:125-127 |
| Chiffre-clé (hero) | `text-2xl font-bold tabular-nums tracking-tight` | SupervisionHero.tsx:101 |
| Valeur de vital | `text-3xl font-bold tabular-nums tracking-tight` | VitalCard.tsx:91 |
| Score de santé | `text-3xl font-bold tabular-nums leading-none` | HealthBanner.tsx:33 |
| Route / code | `.chip-mono` = `font-mono text-xs` sur `bg-panel2` | globals.css:129-131 ; Breakdown.tsx:120 |
| Notes et légendes | `text-xs` / `text-[11px]` / `text-[10px]` en `text-ink-faint` | partout |
| Phrase de lecture | `text-xs leading-relaxed text-ink-soft` | SupervisionHero.tsx:132 |

Les nombres sont toujours en `tabular-nums` et formatés `fr-FR` (`toLocaleString("fr-FR")`,
`lib/format.ts:1-30` : « 245 ms », « 2,34 s », « 3,2 % », CLS à trois décimales, « — » pour null).

### 1.4 Densité et surfaces

- Carte : `.card` = `rounded-xl border border-line bg-panel shadow-card` (globals.css:121-123) ;
  intérieur `p-4` (cartes de mesure) ou `p-5` (hero) ; sections espacées de `mb-6`.
- Hero de supervision : deux panneaux jointifs séparés par un filet `gap-px bg-line`, grille
  `lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]` — contexte à gauche, graphe dominant à droite
  (`SupervisionHero.tsx:58-66`) ; variante `wide` pour les graphes larges (:46-54).
- Coquille : sidebar `w-64` visible à partir de `lg` (`layout.tsx:214`), en-tête mobile avec
  menu `details/summary` en dessous (:292-320) ; barre de filtres globale puis `SubNav`
  (onglets, `overflow-x-auto`, `SubNav.tsx:21`) puis `SegmentBar` (`SegmentBar.tsx:159`).
- Tables denses : `minWidth.table = 70rem` (tailwind:75-78) dans un conteneur qui défile.
- Rythme vertical d'une page de supervision, lu sur `50-overview-dark.png` : kicker + h1 →
  bandeau santé → cinq VitalCards en rangée → hero (chiffres + courbe) → découpage par dimension →
  historique 14 jours (heatmap) → deux courbes journalières. Sur `51-pages-dark.png` : hero →
  découpage → table de percentiles → trois histogrammes → table par route → ressources →
  blocages. La page est longue (2 096 px et 2 862 px de haut à 1 440 px de large) ; rien n'est
  replié par défaut sauf les alternatives textuelles.

### 1.5 Ton des textes

Règle non écrite mais tenue partout : une phrase dit ce qu'une chose mesure et ce qu'elle ne
mesure pas. Exemples pris dans les composants partagés :

- « Les autres ne sont ni repliés dans un groupe « Autres », ni ajoutés : additionner des p75
  n'a pas de sens. » — `Breakdown.tsx:194-196`.
- « case vide = aucune page vue ce créneau · part de mesures « good », LCP pondéré ×2 » —
  `HealthHeatmap.tsx:123`.
- « échantillon faible · médiane 42 ms » sous 100 mesures — `VitalCard.tsx:55, :100-107`.
- « Aucune mesure exploitable sur cette période. » — `ExperienceUnavailable.tsx:6`.
- « Cet écran est vide parce que vous l'avez composé ainsi. » — `TousEteints.tsx:8`.
- « Capacité annoncée, accès non ouvert. » — `CapaciteFermee.tsx:20`.
- Chips de filtre non applicable : barrées, avec la raison en `sr-only` — `GlobalFilters.tsx:430-434`.
- « aucune » à la place de 0 sessions quand l'erreur vient du backend — `breakdown-view.tsx:56-58`.

Vocabulaire : « Inconnu » (groupe `is null`, `breakdown-view.tsx:25-27`), « — » (mesure absente,
`VitalPill.tsx:7`), « Non collecté » (capacité absente, `app/mobile/page.tsx:4-5`), « Pays estimé »
jamais « Pays » (`docs/CONFORMITE.md:132`). Les libellés de note Web Vitals sont en français —
« Bon / À améliorer / Mauvais » (`rating.ts:42-46`) — mais deux étiquettes de graphe restent en
anglais : « good » et « poor » sur les lignes de seuil de `VitalsTimeseries.tsx:59,65`, et la
légende de la heatmap parle de « part de mesures « good » » (`HealthHeatmap.tsx:123`).

Adresse au lecteur : vouvoiement dans les composants (« Rouvrez la roue », `TousEteints.tsx:10` ;
« retirez-la », `GlobalFilters.tsx:190`) mais tutoiement dans l'état vide de la Vue d'ensemble
(« élargis la période ou ouvre la démo », `app/page.tsx:160`). À unifier.

### 1.6 Place des explications

Trois niveaux, toujours au même endroit :

1. **Glossaire en bulle** — `GlossaryTip` (`GlossaryTip.tsx:7-25`) restitue trois lectures
   étiquetées « Technique » (bleu brand), « Stack » (orange), « En clair » (vert) à partir de
   `lib/glossary.ts` (entrées : LCP, INP, CLS, FCP, TTFB, health, anomaly, tracing, traceparent,
   span, coverage, errorFingerprint, session, replay, alert, robotVsReal, otlp, healthGrid, rum,
   experience, csat, forecast, experienceMap, containment, containment_net, abandon_svi,
   couverture_parcours — `glossary.ts:24-260`). Points d'accroche : le h1 (`PageHeader help`),
   le titre du graphe principal (`SupervisionHero chartHelp`), le nom d'une VitalCard
   (`VitalCard.tsx:81`, placé **avant** le nom pour ne pas déborder à 390 px), le libellé de santé
   (`HealthBanner.tsx:100-101`).
2. **Phrase de lecture** — `HeroReading` en bas de la colonne de contexte (`SupervisionHero.tsx:130-135`),
   ou `notice` sous les onglets d'un découpage (`Breakdown.tsx:105`). Elle dit ce que montre le graphe
   et ce qu'il ne montre pas.
3. **Bandeau d'avertissement** — `role="note"` ou `role="status"`, bordure et fond `warn/10`
   (`FilterProblemNotice.tsx:28-39`, `errors/ErrorNotices.tsx:6-22`, `dashboards/WidgetBody.tsx:14-22`) :
   échantillonnage, enrichissement partiel, filtres non appliqués, configuration illisible.

Aucune explication n'est portée par un lien vers une documentation externe : tout est dans l'écran.

### 1.7 Thème clair / sombre

- Classe `dark` sur `<html>` (`tailwind.config.ts:7`), posée avant le premier rendu par un script
  inline (`layout.tsx:31-33`, `localStorage["mip-theme"]` sinon `prefers-color-scheme`), basculée
  par `ThemeToggle` (`ThemeToggle.tsx:7-35`, icônes commutées en CSS pur).
- Les jetons neutres et `brand` changent ; `perf`, `ai`, `good/warn/bad`, `accent`, `navy` ne
  changent pas (tailwind:25-45). Les classes Tailwind brutes portent leurs variantes à la main
  (`dark:text-emerald-400`, etc. — `SupervisionHero.tsx:93-95`, `rating.ts:49-52`).
- Recharts est thémé par CSS (`globals.css:156-178`) ; le lecteur rrweb aussi (:181-184).
- Fond « papier millimétré » `.mip-sci` et bande `.mip-bande-claire` réservés à la vitrine et au
  choix de projet (`globals.css:13-47` ; utilisés dans `app/select/*`, `components/presentation/*`).
  Ils ne font pas partie de l'identité de la console de supervision.

---

## 2. Inventaire des composants réutilisables

Convention de lecture : « SSR » = rendu serveur, aucun JavaScript client ; « client » = `"use client"`.
« À ajouter » = ce qui manque pour respecter les invariants (états, alternative textuelle, null).

### 2.1 Structure de page

| Composant | Props exactes | Rendu | Ce qu'il garantit | Limites / à ajouter |
|---|---|---|---|---|
| `PageHeader` (`PageHeader.tsx:13-27`) | `title: ReactNode` ; `sub?: ReactNode` ; `help?: GlossaryId` ; `domain?: "perf"\|"ai"` (défaut `perf`) ; `children?` (actions, à droite) | SSR | kicker de domaine, h1, actions qui **passent à la ligne** (:42-49, corrigé pour 390 px) | pas d'emplacement pour un état « partiel avec raison » ; pas de fil d'Ariane |
| `SupervisionHero` (`SupervisionHero.tsx:11-35`) | `chartTitle: ReactNode` ; `chartHelp?: GlossaryId` ; `chartMeta?: ReactNode` ; `chart: ReactNode` ; `children: ReactNode` ; `layout?: "split"\|"wide"` | SSR | même bandeau sur toutes les pages de supervision ; ne présume rien de la source | pas de prop d'état (chargement/vide/erreur) : l'appelant passe un `<p>` à la place du graphe (`app/page.tsx:158-163`) ; à ajouter : `state?: {kind, reason}` rendu au même endroit |
| `HeroStat` (:77-90) | `label` ; `value` ; `delta?: {pct: number; lowerIsBetter?: boolean}\|null` ; `hint?` ; `tone?: "neutral"\|"good"\|"warn"\|"poor"` | SSR | tuile uniforme ; delta masqué si `null` | couleurs en `emerald/amber/red` (:93-95) et non `good/warn/bad` ; `value` est un `ReactNode` : rien n'empêche d'y passer `0` pour une inconnue — la garde est dans l'appelant |
| `DeltaBadge` (:111-125) | `pct: number` ; `lowerIsBetter?` | SSR | ±2 % = « → » neutre | pas de texte « vs période précédente » lisible (seulement `title`) |
| `HeroReading` (:130-135) | `children` | SSR | phrase de lecture, `basis-full` | — |
| `Nav` (`Nav.tsx:48`) / `SubNav` (`SubNav.tsx:9`) / `nav-items.tsx` | `reglages?: Record<href, ReactNode>` ; catégories `{href,label,icon,domain,children?,verrouille?}` | client | contexte d'URL préservé (`contextSearchParams`) ; catégorie verrouillée = `<span aria-disabled>` non atteignable (:59-73) | `SubNav` défile horizontalement sans indicateur (390 px : « Fru… » coupé sur `61-errors-390.png`) |
| `ThemeToggle`, `AutoRefresh` (`AutoRefresh.tsx:12`, 5 s, onglet visible seulement), `CoquilleGarde`, `DashboardSettings` (`catalogue`, `choix`, `action`), `TousEteints`, `CapaciteFermee` (`titre`, `sujet`) + `estFermee(href)`, `FilterProblemNotice` (`title`, `problem: FilterProblem`) + `FiltersNotAppliedNote` (`note: string\|null`), `LockedBadge` (`label="Inactif"`, `title?`, `className?`), `ExperienceUnavailable` () | — | états « fermé », « filtre refusé, récupérable », « composé à vide », « capacité inactive », « données insuffisantes » | ces cinq états existent mais **ne sont pas un système** : chacun a sa carte et son ton ; à unifier en une brique `EtatEcran` avec `kind ∈ {chargement, vide, erreur+réessai, partiel+raison, fermé, refusé}` |

États de route Next : `error.tsx` présents pour `actions`, `errors`, `events`, `explorer`, `mobile` ;
`loading.tsx` seulement pour `mobile` (find sur `apps/console/app`). Les autres pages n'ont ni
squelette de chargement ni frontière d'erreur avec réessai — le rendu est SSR, donc la page
« attend » sans rien montrer. C'est l'écart le plus large avec la règle « toute surface :
chargement, vide, erreur avec réessai, partiel avec raison, succès » (PLAN §4, :85).

### 2.2 Filtres

| Composant | Props | Ce qu'il garantit | Limites |
|---|---|---|---|
| `GlobalFilters` (`GlobalFilters.tsx:55-64`) | `schema: string[]` ; `timeZones: Record<string,string>` ; `defaultTimeZone: string` | état dans l'URL ; presets 1 h / 24 h / 7 j + plage personnalisée validée avant navigation (≤ 30 j, fin ≤ maintenant, heure d'été) (:49-53, :267-285) ; contrôle désactivé **avec sa raison** (`lib/surfaces.ts`) ; chip « non appliqué » barrée + `sr-only` (:429-434) | `Segmented`, `Chip`, `RangeEditor`, `DimensionDrawer` ne sont pas exportés (`Segmented` :448, `Chip` :410, `RangeEditor` :249, `DimensionDrawer` :334) — inutilisables ailleurs sans les dupliquer |
| `SegmentBar` (`SegmentBar.tsx:63`) | `schema: string[]` | conditions `=`, `≠`, `inconnu` (:32-36), 1 arrêt de tabulation par chip, segment illisible refusé avec bouton « Retirer » (:167-182) ; bascules « Bots exclus » / « Interne exclu » (:317-352) ; segments enregistrés en `localStorage` versionné | `window.prompt` pour nommer un segment (:152) ; émojis 🤖 🏠 dans les bascules (:333, :351) — seul endroit de la console qui en emploie |

### 2.3 Aide

| Composant | Props | Garanties | Limites |
|---|---|---|---|
| `InfoTip` (`InfoTip.tsx:9-21`) | `children` ; `icon?: IconName` (défaut `help`) ; `side?: "top"\|"bottom"` ; `className?` ; `label?` (défaut « Aide ») | CSS pur, `<button>` focusable, `role="tooltip"`, sans hydratation | largeur fixe `w-72` (288 px, :37) centrée sur le déclencheur : déborde à 390 px si le déclencheur est près d'un bord — contourné au cas par cas en plaçant la bulle avant le libellé (`VitalCard.tsx:77-79`, `HealthBanner.tsx:96-99`) ; jamais résolu dans la primitive |
| `GlossaryTip` (`GlossaryTip.tsx:7-15`) | `id: GlossaryId` ; `side?` ; `className?` | trois niveaux « Technique / Stack / En clair » | le contenu de `glossary.ts` porte des seuils périmés (voir §5, constat ③) |

### 2.4 Mesures et blocs de supervision

| Composant | Props | Rendu | Null / partiel | Accessibilité | À ajouter |
|---|---|---|---|---|---|
| `VitalCard` (`VitalCard.tsx:57-71`) | `name: string` ; `p75: number\|null` ; `median?: number\|null` ; `n: number` ; `prev?: number\|null` ; `periodLabel?` (défaut « 24 h ») | SSR | `p75 null` → « — », pas de note, pas de jauge ; `n < 100` → « échantillon faible · médiane » (:55, :100-107) | note textuelle « Bon/À améliorer/Mauvais » ; jauge de seuils décorative avec `title` seulement (:44-48) | la jauge (`ThresholdMeter`) n'a pas d'alternative textuelle ; `periodLabel` par défaut « 24 h » peut mentir si l'appelant oublie de le passer |
| `VitalPill` / `vitalText` (`VitalPill.tsx:6, :17`) | `name` ; `value: number\|null` | SSR | null → « — » / « pas de mesure » | couleur + texte | — |
| `ErrorStat` (`errors/ErrorStat.tsx:3`) | `label` ; `value: string` ; `testid?` ; `hint?` | SSR | valeur déjà formatée par l'appelant | — | doublon de `HeroStat` sans `tone` ni `delta` ; à fusionner |
| `HealthBanner` (`health/HealthBanner.tsx:82`) | `health: Health` ; `periodLabel: string` | SSR | score `null` → « données insuffisantes » (:83-91) ; facteur sans donnée → « n/a » (:71) | anneau SVG sans `role`/`aria-label` (:19) | anneau en bleu ciel pour « Bon » (voir §1.1) ; pondérations écrites en clair (:118) — à conserver |
| `Breakdown` (`Breakdown.tsx:40-64`) | `title` ; `tabs: BreakdownTab[]` ; `notice: string` ; `items: BreakdownItem[]` ; `columns: string[]` ; `groups: number` ; `truncated: boolean` ; `emptyLabel` ; `measureLabel` | SSR | onglet indisponible barré **avec raison** (:91-101, :202-208) ; vide → `emptyLabel` ; tronqué → phrase explicite (:192-198) | la barre EST le lien (1 arrêt de tabulation), rectangles `aria-hidden`, `<details>` « Alternative textuelle du découpage » avec `<caption>` sr-only (:146-190) | c'est le composant de référence : sa grammaire (lien = barre, table repliée, raison affichée) doit être imposée aux autres |
| `PercentileTable` (`Distribution.tsx:23`) | `rows: VitalPercentiles[]` | SSR | cellule null → non colorée (:49-54) | `title` sur les en-têtes p50…p99 (:34, :74-83) | `<th>` sans `scope` |
| `Histogram` (`Distribution.tsx:86`) | `name` ; `rows: HistoRow[]` ; `cap: number` | SSR SVG | total 0 → « pas de mesure sur la fenêtre » (:107-110) | `role="img"` + `aria-label` (:112) ; `<title>` par barre | pas d'alternative textuelle tabulaire ; axe à trois repères seulement |
| `StepPicker` / `FunnelChart` (`Funnel.tsx:21-29, :56`) | `events: EventOption[]`, `selected: string[]`, `sp` / `steps: FunnelStep[]` | SSR (formulaire GET) | `steps` vide → `null` (:57) | libellés `<label>` natifs ; chiffres en texte | pas d'alternative textuelle ni de `<table>` ; abandon en `red-600` brut (:76) ; largeur de colonne fixe `w-40` + `w-32` : à 390 px, la barre se réduit à presque rien (non vérifié sur capture) |
| `Sankey` (`Sankey.tsx:27`) | `model: SankeyModel` | SSR SVG 720×380 | pas de liens → « Pas assez de transitions pour un flux » (:29) | `role="img"` + `aria-label` (:38-39) ; `<title>` par ruban | `min-w-[560px]` + `overflow-x-auto` (:34-37) ; aucune alternative textuelle ; palette catégorielle réemployant les couleurs d'état |

### 2.5 Graphiques `components/charts/*.tsx`

| Fichier | Props exactes | Rendu | Null / partiel / vide | Accessibilité | Limites et ce qu'il faudrait ajouter |
|---|---|---|---|---|---|
| `Donut.tsx:34-48` | `slices: {label, value: number, color}[]` ; `centerValue?` ; `centerLabel?` ; `size=200` ; `thickness=34` | SSR SVG | total 0 → anneau gris (:73-74) ; parts à 0 filtrées (:59) | `role="img" aria-label="Répartition"` (générique, :72) ; `<title>` par arc ; légende HTML avec valeurs et % (:92-106) | `aria-label` à paramétrer ; `value` non nullable : une part inconnue ne peut pas être dite |
| `ForecastChart.tsx:26-40` | `data: {label, real: number\|null, proj: number\|null}[]` ; `threshold?: number\|null` ; `thresholdLabel?` ; `unit=""` ; `height=260` ; `format?: (v)=>string` | recharts (client) | `connectNulls` sur les deux lignes (:60, :69) : **un trou de données est tracé comme une droite** — contraire à « inconnu = null » | aucun `role`, aucune alternative textuelle | `format` est une fonction : non sérialisable depuis un server component (contrairement à `ScatterPlot`) ; retirer `connectNulls` ou dessiner les trous |
| `Gauge.tsx:26-41` | `value: number` (borné 0..100) ; `tone: "good"\|"warn"\|"poor"` ; `label` ; `sub?` ; `size=116` ; `thickness=11` | SSR SVG | `value` non nullable ; 0 → pas d'arc (:53) | `role="img" aria-label="{v} %"` (:51) ; libellé tronqué avec `title` | largeur fixe `w-[8.5rem]` (:49) ; couleurs = `RATING_HEX` (cohérent) |
| `HealthHeatmap.tsx:55-66` | `dayKeys: string[]` ; `byKey: Map<"{day}\|{h}", {good_w, total_w}>` ; `businessOnly=false` | SSR divs | `total_w = 0` → « aucune donnée », case grise atténuée (:31, :20, :102) — jamais un 0 | tooltips via `title` seulement (:103-107), non atteignables au clavier ; légende textuelle (:115-125) | seuils 0,9 / 0,5 codés en dur (:33) ; `bg-emerald/amber/red-500` (:16-21) ; `min-w-[640px]` dans `overflow-x-auto` (:73-74) ; UTC (`dayKey`, :37 ; `lastNDayKeys`, :132) ; pas d'alternative tabulaire |
| `LineTrend.tsx:26-43` | `data: {label, value: number, volume?: number}[]` ; `valueName: string` ; `valueUnit=""` ; `volumeName="volume"` ; `color=#f89101` ; `height=240` ; `domain?: [number, number]` | recharts | `value` non nullable ; `data` vide → grille vide sans message | aucune | brique de base des cartes de tableau de bord (`WidgetChart.tsx:47-55`) : l'alternative textuelle vit dans `WidgetBody`, pas ici |
| `ObservedTrend.tsx:15-24` | `title: string` ; `rows: {bucket: Date, value: number}[]` ; `valueLabel: string` | SSR | `rows` vide → figure vide (non gérée) | `<figure>/<figcaption>`, barres `aria-hidden`, `<details>` « Alternative textuelle de la série » avec table (:29-56) | modèle à généraliser ; pas d'axe |
| `RadarScore.tsx:24` | `data: {axis, value: 0..100}[]` ; `height=260` | recharts | — | aucune | tooltip « sous-score » ; pas d'alternative |
| `RankBar.tsx:34-49` | `data: RankDatum[]` (`label`, `value`, `display?`, `color?`, `sub?`, `href?`, `segments?: {value,color,label?}[]`, `title?`) ; `max?` ; `labelWidth="11rem"` ; `barClassName=""` ; `emptyLabel="Aucune donnée sur la fenêtre."` | SSR | vide → `emptyLabel` (:50-52) ; barre plancher 2 % (:59) | valeurs en texte dans le DOM ; lien sur le libellé si `href` (:72) ; segments avec `title` seulement | pas de `<table>` équivalente ; libellé à largeur fixe (11 rem = 176 px) : à 390 px il reste ~150 px pour la barre ; couleur par défaut orange |
| `ScatterPlot.tsx:38-59` | `points: {x, y, z?, label, color?}[]` ; `xLabel` ; `yLabel` ; `xUnit=""` ; `yUnit=""` ; `height=300` ; `xFormat`/`yFormat: "int"\|"locale"` | recharts | — | tooltip HTML thémé (:92-108) ; aucun `role` | formats sérialisables (:30-36) : c'est le bon patron pour les props de graphes clients |
| `StackedBars.tsx:23-37` | `data: Record<string, number\|string>[]` ; `xKey` ; `series: {key, name, color}[]` ; `height=260` ; `yUnit=""` ; `showLegend=true` | recharts | — | légende recharts (cercle 8 px) ; aucun `role` | « empiler est une affirmation » (`WidgetChart.tsx:7-9`) : l'appelant décide, le composant ne vérifie rien |
| `TrafficTimeseries.tsx:25` | `data: {day: ISO, pageviews, errors}[]` | recharts | — | aucune | hauteur fixe 220 ; erreurs en `#ef4444` (pas `bad`) ; libellés de tooltip traduits (:52-55) |
| `VitalsTimeseries.tsx:21-32` | `data: {bucket: ISO, p75: number}[]` ; `unit="ms"` ; `thresholds?: [number, number]` ; `xAxis?: "time"\|"day"` | recharts | — | aucune | lignes de seuil `#10b981`/`#ef4444` étiquetées « good »/« poor » (:55-66) ; **sans `ifOverflow="extendDomain"`, elles n'apparaissent pas quand la série est loin des seuils** — sur `50-overview-dark.png` l'axe va de 0 à 60 ms et aucune ligne de seuil n'est visible, alors que la phrase de lecture promet une « bande verte » (`app/page.tsx:182`) qui n'existe pas dans le composant (deux pointillés, pas de bande) |

Hors `charts/` mais de même nature : `errors/GroupSparkline.tsx:10` (`values: number[]`, `label: string` ;
SSR ; `role="img"` + `<title>`), `dashboards/WidgetChart.tsx:17` (`data: WidgetData`, `unit?` ; choisit
`StackedBars` si la mesure s'additionne, sinon **une courbe par groupe**, jamais une somme, :35-38),
`dashboards/WidgetBody.tsx:11` (états `invalid`/`error` en `role="note"`, vide « aucune donnée »,
alternative textuelle de la série, :14-60).

Où l'alternative textuelle existe (grep « Alternative textuelle ») : `app/errors/page.tsx`,
`app/mobile/page.tsx`, `Breakdown.tsx`, `LongtasksView.tsx`, `charts/ObservedTrend.tsx`,
`dashboards/WidgetBody.tsx`, `errors/IssueList.tsx`. Où des graphes recharts sont rendus sans que
ce libellé apparaisse dans le fichier : `app/page.tsx` (deux `VitalsTimeseries`, un `TrafficTimeseries`),
`app/alerts/page.tsx`, `app/experience/page.tsx`, `app/forecast/page.tsx`, `app/retention/page.tsx`,
`app/ux/page.tsx` (plus `logs`, `svi/appels`, `xsom` qui sont fermés). Une alternative sous un autre
libellé n'est pas exclue : à vérifier page par page avant de conclure.

### 2.6 Ce qu'il faudrait ajouter, transversalement

1. Une enveloppe `Figure` unique pour tout graphe : titre (h2 11 px), `GlossaryTip`, `chartMeta`,
   zone graphe, **état** (chargement / vide / erreur avec réessai / partiel avec raison), et
   `<details>` « Alternative textuelle » alimentée par les mêmes lignes que le dessin. `ObservedTrend`
   et `WidgetBody` la font déjà chacun de leur côté.
2. Un module `lib/palette.ts` unique : `RATING_HEX` (existe), `SERIE_PRINCIPALE` (orange ou perf,
   à trancher), `CATEGORIELLE` (huit teintes **sans** vert/ambre/rouge), consommé par Sankey,
   WidgetChart, VitalsTimeseries, TrafficTimeseries, HealthHeatmap, HealthBanner.
3. `role="img"` + `aria-label` paramétrable sur chaque graphe recharts, et `ifOverflow="extendDomain"`
   sur les lignes de seuil.
4. Exporter `Segmented` et `Chip` de `GlobalFilters.tsx` pour qu'un écran puisse proposer une
   bascule locale (`24 h/24 · Heures ouvrées` de la heatmap est réécrite à la main).
5. Une brique `EtatEcran` qui unifie `TousEteints`, `CapaciteFermee`, `FilterProblemNotice`,
   `ExperienceUnavailable`, l'état vide de `SupervisionHero`, et fournit le bouton « Réessayer »
   qui n'existe nulle part aujourd'hui (aucun `error.tsx` lu ne propose de réessai — non vérifié
   fichier par fichier : « non établi »).
6. `InfoTip` : calcul de position (ou `max-width: calc(100vw - 2rem)`) au lieu de contournements.

---

## 3. Contraintes d'accessibilité et de largeur

Règles écrites : `PLAN-CLAUDE-P5-P8.md:82-88` — réutiliser `PageHeader`, `GlobalFilters`,
`SegmentBar`, `card`, `btn-accent`, `INPUT_CLASS` (`components/forms/Field.tsx:6` = `"field py-1"`)
et `components/charts/` ; cinq états par surface ; contrôles natifs labellisés, clavier, alternative
textuelle aux séries, aucun débordement à 390 / 768 / 1440 px ; viewer/demo en lecture seule.

Ce qui est vérifié par les tests : « aucun débordement horizontal à 390, 768 et 1440 px »
(`tests/e2e/analyses-drilldowns.spec.ts:285-296`, helper `debordements` :140-147 qui tolère un
ancêtre `overflow-x: auto|scroll|hidden`) ; même recette dans `analytics-explorer.spec.ts:170-173`,
`error-tracking.spec.ts:360, :629`, `dashboards-analytics.spec.ts:277` ; viewport 390×844 dans
`events-explorer.spec.ts:56`, `sourcemaps.spec.ts:212`, `mobile-console.spec.ts:137`. Aucun test
de contraste ni d'audit `axe` (grep vide) : le contraste n'est pas vérifié par la CI.

Mécanismes de largeur en place : actions d'en-tête qui passent à la ligne (`PageHeader.tsx:42-49`) ;
`min-w-0` sur les cellules de grille (`HealthBanner.tsx:64-67`) ; conteneurs `overflow-x-auto` pour
la heatmap (640 px), le Sankey (560 px), la table de percentiles, les tables denses (70 rem) ;
bulle placée avant le libellé quand elle est près du bord droit. Sur `60-overview-390.png` et
`61-errors-390.png` : en-tête empilé (marque, projet, menu), filtres sur trois lignes, sous-onglets
qui défilent, VitalCards sur deux colonnes, hero en une colonne, heatmap réduite (cases de quelques
pixels, lisible seulement par la couleur), courbes pleine largeur. Aucun débordement visible.
Le bouton flottant « Votre avis ? » (widget `mip-rum-feedback.js`, `layout.tsx:115`) **recouvre**
la carte INP sur la première capture et la phrase de lecture sur la seconde : à 390 px il masque du
contenu.

Sidebar à partir de 1024 px (`lg`), donc 768 px utilise la coquille mobile : le plan de refonte
doit prévoir trois compositions (390, 768 sans sidebar, 1440 avec sidebar de 256 px → ~1 150 px
utiles).

Clavier et lecteurs d'écran, ce qui est acquis : `InfoTip` déclenché par un `<button>` et ouvert au
focus (`InfoTip.tsx:28-40`) ; `Segmented` en `role="group"` + `aria-pressed` + raison en `sr-only`
(`GlobalFilters.tsx:467-498`) ; chips avec bouton « Retirer » labellisé ; barre de découpage = lien
unique avec `aria-label` complet (`Breakdown.tsx:114-118`) ; boutons d'ordre des cartes qui annoncent
la position (`dashboards/WidgetCard.tsx:4-7`) ; anneaux de focus `ring-perf` partout ; `<details>`
natif pour les alternatives. Ce qui ne l'est pas : tooltips `title` des heatmaps et rubans ;
graphes recharts sans rôle ni nom ; `window.prompt` ; menu mobile en `details/summary` sans
fermeture à Échap (non vérifié : « non établi »).

Contraste (calcul approché WCAG 2.x fait ici, à confirmer avec un outil) : `ink-soft` sur `panel`
clair ≈ 6,5:1 (AA) ; **`ink-faint` sur `panel` clair ≈ 2,8:1 et sur `panel` sombre ≈ 3,8:1**, sous
le seuil 4,5:1 des textes de moins de 18 px. Or `ink-faint` porte les titres de cartes (11 px),
les en-têtes de tables, les légendes et les phrases de note. Une refonte qui garde cette couleur
pour du texte de 10-11 px reste sous AA ; la remplacer par `ink-soft` sur les titres et garder
`ink-faint` aux seuls éléments décoratifs est le choix le moins coûteux. `btn-accent` (orange sur
navy 950) est annoncé AA dans `globals.css:132` ; non recalculé ici.

---

## 4. Ce qui fait notre identité par rapport à Datadog et doit être protégé

Datadog RUM (connaissance générale du produit, non vérifiée sur les captures dans cette lecture) :
un explorateur à facettes, des tableaux de bord composés de widgets, des vues « Performance
Summary », « Errors », « Session Replay », des signaux de frustration, des seuils Web Vitals de
web.dev, et des explications renvoyées vers la documentation. Ce que MIP RUM fait autrement, et qui
doit survivre à toute refonte :

1. **L'inconnu se dit, il ne se chiffre pas.** `null` → « — », « Inconnu », « Non collecté »,
   « aucune », « Données insuffisantes », « n/a » ; un onglet ou un filtre inapplicable est barré
   **avec sa raison**, jamais ignoré (`lib/surfaces.ts:4-7`, `Breakdown.tsx:91-101`, `GlobalFilters.tsx:388-393`).
   Datadog affiche un 0 ou une série plate là où MIP RUM affiche une raison. Invariant à protéger
   tel quel.
2. **La phrase de lecture et le glossaire à trois niveaux.** Chaque hero porte une phrase qui dit ce
   que le graphe montre et ce qu'il ne montre pas (`HeroReading`) ; chaque terme a une lecture
   « Technique / Stack / En clair » (`GlossaryTip`). C'est l'outil de vente de MIP autant que
   l'outil d'analyse : un commercial et un développeur lisent le même écran.
3. **La couleur porte un sens, et un seul** (`globals.css:61-69`). Pas de dégradé décoratif, pas de
   violet de marque partout : bleu = domaine RUM, orange = MIP / mesure principale, vert-ambre-rouge =
   état. À protéger en corrigeant les écarts du §1.1, pas en les tolérant.
4. **Rendu serveur et SVG déterministe** pour Donut, Gauge, Heatmap, RankBar, Breakdown, Histogram,
   Sankey, Funnel, Sparkline : zéro JavaScript client, même dessin à chaque rendu, testable en
   e2e sans attendre une hydratation. Recharts reste cantonné aux séries temporelles et au nuage de
   points. Une refonte qui basculerait tout en client-side perdrait cette propriété.
5. **L'alternative textuelle est une partie du graphe, pas un accessoire** (`Breakdown.tsx:4-9`,
   `ObservedTrend.tsx:5-7`, `WidgetBody.tsx:4-6`) : « aucun chiffre n'est visible dans les barres
   sans être retrouvable dans le tableau ». À étendre aux recharts, jamais à retirer.
6. **L'URL est l'état** : période, appareil, dimensions, segment, découpage, pagination — tout se
   partage par lien, et un lien illisible est refusé avec un chemin de sortie
   (`FilterProblemNotice.tsx:1-4`, `SegmentBar.tsx:8-9`).
7. **Ce qui est fermé se montre fermé** : cadenas dans la sidebar, `<span aria-disabled>`, écran
   « Accès fermé pour le moment » (`Nav.tsx:59-73`, `CapaciteFermee.tsx`), `LockedBadge` « Inactif »
   sur une capacité non branchée. Aucune fonctionnalité factice.
8. **Les populations ne s'additionnent pas et l'écran le dit** : sessions ≠ visiteurs ≠ identités
   (`breakdown-view.tsx:52-70` sépare « Sessions » et « Signatures » ; `VersionsTable.tsx:1-12` refuse
   de s'afficher sous deux versions ; `LongtasksView.tsx:4-9` refuse de cumuler des durées ;
   `Breakdown.tsx:194-196` refuse un groupe « Autres »). Occurrences = somme des répétitions
   (`PLAN §4:76`).
9. **Vie privée à l'écran** : aucune adresse IP nulle part, « Pays estimé » avec sa provenance,
   identifiant de visiteur pseudonyme, recherche de session par identifiant technique exact
   seulement — « une URL partageable ne doit pas permettre de retrouver le parcours d'une personne »
   (`docs/LIMITES.md:59-63`, `docs/CONFORMITE.md:36-39, :128-132`). Rejeu masqué par défaut au
   niveau « all ». Aucune refonte ne doit ajouter un champ « rechercher par e-mail » ou une carte
   par ville.
10. **Score de santé à formule affichée** (`HealthBanner.tsx:118`, `lib/health.ts:1-11`) et
    **anomalies par z-score assumé** (`docs/LIMITES.md:91`) : explicable en réunion, contrairement
    à un « Watchdog » opaque. Toute proposition de ML (épique P*) doit garder ce trait : la
    formule ou l'incertitude s'affiche à côté du chiffre.
11. **Robots exclus par défaut, apps internes exclues de « Tous »** (`SegmentBar.tsx:90-94, :317-352`) :
    « Real User » est pris au pied de la lettre.
12. **Écran composable par l'exploitant** (roue `DashboardSettings`, catalogue par catégorie,
    `TousEteints` quand tout est décoché) — le choix appartient à l'utilisateur et l'écran le dit.
13. **Dogfooding visible** : la console se mesure elle-même (`layout.tsx:43-57`) et son widget
    « Votre avis ? » alimente sa page Expérience (:112-115). À garder ; à repositionner à 390 px.
14. **Marque MIP** : pictogramme pouls sur carré orange, wordmark « MIP RUM » avec « RUM » en orange,
    sous-titre « Real User Monitoring » (`layout.tsx:60-76`) ; pied « v0.3 — OTel-native · données
    en UE » (:285-287). Navy réservé au texte sur orange.

Ce qui, chez Datadog, vaut d'être repris sans trahir ces points : la densité des tableaux de bord
composés (déjà amorcée par `WidgetCard`/`WidgetBody`), la lecture « au-dessus du pli » (déjà
`SupervisionHero`), et les seuils Web Vitals de web.dev (déjà alignés, voir §5). Ce qui ne doit
pas être repris : les zéros silencieux, les explications hors produit, la couleur de marque
appliquée aux données.

---

## 5. Les quatre constats de juillet, vérifiés un à un dans le code d'aujourd'hui

La fiche `docs/context/produit-rum.md` (établie le 29/07/2026, `:7`) numérote quatre constats
en §4 (`:95-139`). Vérification au commit `11e9f34` (état de la branche `master` au 18/09/2026).

### ① « OpenTelemetry côté client n'est pas encore stable » (`produit-rum.md:101-106`)

Constat de marché, pas de code : rien dans le dépôt ne peut le confirmer ni l'infirmer. Les
sources citées par la fiche (`:245-247`) n'ont pas été relues ici. **Non établi** à la date du jour ;
la conséquence que la fiche en tire — « interdit de promettre une portabilité totale » — reste une
règle de ton à respecter dans les textes de la console et de la vitrine.

### ② « traceparent aléatoire pour chaque span » (`produit-rum.md:108-119`, citant `otel.ts:109-110`)

**Corrigé.** `packages/rum-sdk/src/otel.ts` :

- `:55-66` — commentaire « AVANT : chaque span portait un traceId ET un spanId tirés au hasard …
  MAINTENANT : un traceId par PAGE VUE » ; `let pageTraceId = hexId(16)` (:66).
- `:77` — `let pageSpanId = hexId(8)` : span racine `pageview`, parent de tout ce que la page produit.
- `:100-106` — `newPageTrace()` fait tourner la trace à chaque page vue (initiale et SPA).
- `:241-243` — chaque span émis porte `traceId: pageTraceId`, `spanId: estRacine ? pageSpanId : hexId(8)`,
  `parentSpanId: pageSpanId` quand la racine existe (:79-88 explique pourquoi un parent fantôme est refusé).
- `:262-264` — les spans d'appel API recopient `mip.trace_id` / `mip.span_id` / `mip.parent_span_id`
  dans les champs natifs OTLP, « pour que les deux vues désignent le même span ».
- `packages/rum-sdk/src/apispans.ts:88-90` — `traceparent(traceId, spanId)` = `00-{traceId}-{spanId}-01` ;
  `:179-185` — `traceId = opts.traceId?.() ?? randHex(16)` (:179), en-têtes `traceparent` (:184) et
  `tracestate: mip=s:{session}` (:185) posés sur `fetch` (et XHR, `:232`).

Dernière modification du fichier : `eef7f89` (16/09/2026). Ce qui reste vrai : la propagation ne
concerne que les appels same-origin et les origines listées (`types.ts:70`), un seul saut
front → backend (`docs/LIMITES.md:76`), et le repli `?? randHex(16)` (:179) recrée une trace
orpheline si `opts.traceId` n'est pas fourni. Le glossaire a une entrée `traceparent`
(`glossary.ts:100`) — contenu non relu ici.

### ③ « Seuil LCP [2000, 2500] au lieu de [2500, 4000] » + « delta non transmis » (`produit-rum.md:121-134`)

**Corrigé dans les trois fichiers de seuils, périmé dans les textes.**

- `apps/console/lib/rating.ts:6` — `LCP: [2500, 4000]` ; en-tête `:1-2` « alignés sur la référence
  web.dev (E0) ». Dernière modification `b39c018` (09/09/2026, « six affirmations fausses retirées »).
- `packages/rum-sdk/src/vitals.ts:18` — `LCP: [2500, 4000]` ; commentaire `:13-15` « le LCP était
  noté [2000, 2500] … ».
- `apps/ingest/supabase/functions/_shared/otlp.mjs:24` — `LCP: [2500, 4000]`, « SOURCE DE VÉRITÉ du
  rating : il est recalculé ici à l'ingestion » (:20-21).
- `delta` : `packages/rum-sdk/src/vitals.ts:52` — `"webvital.delta": metric.delta` est émis.
  Son exploitation côté ingestion et console n'a pas été vérifiée : **non établi**.

Ce qui contredit encore ces seuils à l'écran ou dans les calculs :

| Emplacement | Texte ou valeur | Problème |
|---|---|---|
| `apps/console/lib/glossary.ts:26` | « seuil 2026 : bon < 2,0 s, à améliorer < 2,5 s » | bulle d'aide LCP fausse ; visible sur chaque VitalCard LCP et l'accueil |
| `apps/console/lib/glossary.ts:30` | « Au-delà de 2,5 s, l'internaute a l'impression d'attendre » | 2,5 s est la borne « bon », pas la borne d'attente |
| `apps/console/app/page.tsx:182-183` | « bande verte « bon » sous 2,0 s, rouge « mauvais » au-delà » | phrase de lecture du hero fausse deux fois (2,0 s ; « au-delà » = 4,0 s) et décrit une bande qui n'est pas dessinée |
| `apps/console/app/experience/page.tsx:28-34` | `vitalsScore` : 100 si ≤ 2000, 82 si ≤ 2500, 55 si ≤ 4000, 32 au-delà | sous-score « perçu » à paliers propriétaires, commentés « repères Web Vitals 2026 » : un LCP à 2,4 s (« bon » pour web.dev et pour `rating.ts`) est noté 82 |
| `apps/console/app/correlation/page.tsx:114` et `lib/queries-v2.ts:475, :483` | « poor (LCP p75 > 2,5 s) », `r.rum_lcp_p75 > 2500` | les « angles morts » classent « poor » ce que `rating.ts` classe « à améliorer » |
| `apps/console/lib/map.ts:21` | `warn` si ≥ 2500 | cohérent avec la borne bon/à améliorer ; à confirmer que le « bad » de la carte est à 4000 (non lu) |
| `apps/console/app/forecast/page.tsx:55-60, :166` | seuil 2500 « à améliorer » | cohérent (2,5 s est bien la frontière bon → à améliorer) |

La capture `51-pages-dark.png` affiche « LCP p75 > 4,0 s (seuil 2026) » pour les routes « mauvais » :
la page Pages lentes est à jour ; la Vue d'ensemble et le glossaire ne le sont pas.

### ④ « Masquage du rejeu en deçà du standard 2026 » (`produit-rum.md:136-139`, citant `replay.ts:190`)

**Corrigé.** `packages/rum-sdk/src/replay.ts` :

- `:15-25` — commentaire « CE QUI ÉTAIT ENREGISTRÉ EN CLAIR … Le standard 2026 attend l'inverse par
  défaut : on masque, et on démasque ce qu'on a décidé de montrer. C'est ce que fait "all". »
- `:47` — `export type NiveauMasquage = "all" | "media" | "inputs"` ; « `all` est le défaut » (:46).
- `:64-70` — `optionsMasquage(niveau = "all")` : `maskAllInputs: true` + `blockClass` à tous les
  niveaux (« le plancher, pas une option », :59-62) ; `all` ajoute `maskTextSelector: "*"` et
  `blockSelector` = `img,video,audio,canvas,svg,picture,object,embed` (:41).
- `packages/rum-sdk/src/types.ts:67` — option publique `replayMask?: "all" | "media" | "inputs"`.
- `docs/CONFORMITE.md:39` — « masquage par défaut des saisies, du texte et des médias (réglable par
  app via `replayMask`) ».

Dernière modification `26c7d68` (17/09/2026). Ce qui est resté périmé : le commentaire de
`startReplay` (`replay.ts:194-195`, « Masquage par défaut : maskAllInputs + blockClass ») et celui
du dogfooding (`apps/console/app/layout.tsx:35-36`, « saisies masquées à l'enregistrement
(maskAllInputs) ») décrivent encore l'ancien comportement. Le coût assumé du niveau `all` — les
icônes SVG disparaissent du rejeu (`replay.ts:30-35`) — doit être dit dans la console au-dessus du
lecteur (non vérifié : « non établi »).

---

## Sources

- `apps/console/tailwind.config.ts` ; `apps/console/app/globals.css` ; `apps/console/app/layout.tsx:1-320`.
- `apps/console/components/` : `PageHeader.tsx`, `GlobalFilters.tsx`, `SegmentBar.tsx`, `InfoTip.tsx`,
  `GlossaryTip.tsx`, `SupervisionHero.tsx`, `Breakdown.tsx`, `breakdown-view.tsx`, `Distribution.tsx`,
  `Funnel.tsx`, `Sankey.tsx`, `VitalCard.tsx`, `VitalPill.tsx`, `CapaciteFermee.tsx`,
  `FilterProblemNotice.tsx`, `TousEteints.tsx`, `Nav.tsx`, `SubNav.tsx`, `nav-items.tsx`,
  `ThemeToggle.tsx`, `AutoRefresh.tsx`, `OnboardingPoll.tsx`, `CoquilleGarde.tsx`, `LockedBadge.tsx`,
  `ExperienceUnavailable.tsx`, `DashboardSettings.tsx:1-30`, `VersionsTable.tsx:1-12`,
  `LongtasksView.tsx:1-12`, `ResourcesView.tsx:1-12`, `errors/ErrorStat.tsx`, `errors/ErrorNotices.tsx:1-22`,
  `errors/GroupSparkline.tsx`, `health/HealthBanner.tsx`, `dashboards/WidgetChart.tsx`,
  `dashboards/WidgetBody.tsx:1-60`, `dashboards/WidgetCard.tsx:1-40`, `sessions/Timeline.tsx:1-25`,
  `forms/Field.tsx:1-9`, `icons.tsx` (noms seulement).
- `apps/console/components/charts/` : les douze fichiers, en entier.
- `apps/console/lib/` : `rating.ts`, `glossary.ts:11-31, :210`, `format.ts:1-30`, `surfaces.ts:1-40`,
  `health.ts:1-11, :89-96`, `map.ts:21`, `queries-v2.ts:475-483` (grep).
- `apps/console/app/page.tsx:2-32, :134-186, :250-273` ; `app/experience/page.tsx:22-45` ;
  `app/correlation/page.tsx:114` ; `app/forecast/page.tsx:55-60, :166` ; `app/mobile/page.tsx:4-5`.
- `packages/rum-sdk/src/otel.ts:44-110, :236-266` ; `apispans.ts:80-95, :175-190, :232` ;
  `replay.ts:10-75, :185-215` ; `vitals.ts:1-52` ; `types.ts:67, :70`.
- `apps/ingest/supabase/functions/_shared/otlp.mjs:1-30`.
- `_bmad-output/implementation-artifacts/PLAN-CLAUDE-P5-P8.md:70-118` ; `docs/LIMITES.md` ;
  `docs/CONFORMITE.md` ; `docs/context/produit-rum.md`.
- `tests/e2e/analyses-drilldowns.spec.ts:138-147, :285-296` ; `analytics-explorer.spec.ts:75-79, :170-173` ;
  `error-tracking.spec.ts:360, :629` ; `dashboards-analytics.spec.ts:277` ; `events-explorer.spec.ts:56` ;
  `sourcemaps.spec.ts:212` ; `mobile-console.spec.ts:137`.
- Captures : `scratchpad/console/50-overview-dark.png` (1440×2096), `51-pages-dark.png` (1440×2862),
  `60-overview-390.png` (390×3570), `61-errors-390.png` (390×1924).
- `git log -1` sur `rating.ts` (`b39c018`, 09/09/2026), `otel.ts` (`eef7f89`, 16/09/2026),
  `replay.ts` (`26c7d68`, 17/09/2026), `glossary.ts` (`1c2cbd4`, 17/09/2026).
