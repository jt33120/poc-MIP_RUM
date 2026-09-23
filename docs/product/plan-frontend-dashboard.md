# Plan d'implémentation frontend — tableau de bord RUM (références IP-Label, Datadog, Grafana ; identité MIP)

> **Date** : 21/09/2026. **Base** : `master` au commit `322c9a7` (18/09/2026 17:27). **Périmètre** : la console
> `apps/console/` (écrans de suivi), plus deux épiques : P* (statistique explicable là où Datadog vend de
> l'apprentissage automatique) et P** (site de présentation `/presentation`). Le backend est jugé solide ;
> il n'est touché que par des patchs petits et nommés (registre B, § 6.3).
>
> **Ce que ce document garantit.** Chaque écran a sa question, sa grille à 1440 / 768 / 390 px et une table
> de widgets complète : libellé exact, type de graphique et pourquoi, mesure et agrégation, comparaison,
> source de données vérifiée dans le code (`fichier:ligne` au commit `322c9a7`) ou signature à créer,
> composant, interactions, états, critère d'acceptation. Chaque composant a **un** nom et **une**
> signature TypeScript (§ 4) ; chaque paramètre d'URL est déclaré une fois (§ 3.1) ; chaque dépendance
> backend a un identifiant unique et dit si elle est une migration (§ 6.3) ; chaque sous-lot a ses
> fichiers, ses tests nommés et sa preuve de fin (§ 6).
>
> **Ce qu'il ne garantit pas.** Aucun écran n'a été vu sur du trafic réel : les captures de travail
> montrent un mini-site local (LCP p75 44 ms, 28 sessions). 34 capacités sur 49 sont « déployé, non
> éprouvé » (`docs/RUM_PARITY_STATUS.md` § 4). Les écrans d'IP-Label Ekara n'ont jamais été vus : ce qui en
> est repris vient de leurs pages publiques (texte). Les tailles S / M / L sont des estimations. Les
> numéros de ligne cités bougeront : au début de chaque lot, on relit la fonction citée avant de la
> modifier. Ce qui n'a pas pu être établi est écrit « non établi » et rassemblé au § 9.4.

## Sommaire

0. Comment utiliser ce document
1. Principes de conception et invariants de vérité
2. Architecture d'information et navigation
3. Conventions transverses
4. Bibliothèque de composants
5. Spécification écran par écran (ordre de la navigation)
6. Sous-lots F00–F69 : récapitulatif, ordre, registre backend, détail
7. Épique P* — statistique explicable (« machine learning »)
8. Épique P** — site de présentation
9. Annexes : script des captures, glossaire des mesures, sources, non établi

---

## 0. Comment utiliser ce document

### 0.1 Pour qui, et dans quel ordre le lire

Ce plan est écrit pour un modèle d'exécution (ou un développeur) qui n'a lu ni les notes de lecture ni
les brouillons qui l'ont précédé. Il se suffit à lui-même :

1. Lire § 1 (principes, invariants, règles de domaine) : un écran qui les viole est refusé en revue.
2. Lire § 3 et § 4 en entier avant d'écrire la première ligne : les conventions d'URL, d'états et les
   signatures de composants ne se redécident pas écran par écran.
3. Prendre les sous-lots dans l'ordre du § 6.2. Pour un sous-lot donné : sa ligne du § 6.1 (résumé), puis
   son détail au § 6.4 / § 6.5, puis la sous-section d'écran du § 5 qu'il cite.
4. Les épiques P* (§ 7) et P** (§ 8) ont leurs propres sous-lots, placés dans l'ordre global au § 6.2.

### 0.2 Conventions d'écriture du plan

| Étiquette | Sens | Ce que fait l'exécutant |
|---|---|---|
| « existante » ou « ex. » + `fichier:ligne` | la fonction ou le composant existe, sa mesure et sa fenêtre ont été relues | relire au début du lot (les lignes bougent), puis réutiliser |
| « à créer : signature » | fonction TypeScript sans migration, dans `apps/console/lib/` ; elle fait partie du lot qui la cite | l'écrire avec cette signature exacte et son test |
| « backend : manque » + `Bn` | patch hors lots F (requête ou migration) listé au § 6.3 | livrer l'état « non disponible, raison : … » du widget tant que `Bn` manque, **jamais des zéros** |
| « non établi » | fait non vérifié | ne pas le supposer ; le vérifier en ouvrant le lot, et s'il est faux, appliquer le repli écrit |
| `§ x.y` | renvoi interne à ce plan | — |
| `reads/*.md Lnn`, `console-ecrans-*.md`, `iplabel.md`, `datadog-*.md`, `grafana.md` | notes de lecture qui ont fondé une décision, versionnées à côté de ce plan dans [`plan-frontend-notes/`](plan-frontend-notes/) (un renvoi `reads/x.md Lnn` désigne `plan-frontend-notes/x.md`, ligne nn) ; la décision et sa preuve dans le code sont reformulées ici | rien : ces renvois disent d'où vient un constat, ils ne sont pas nécessaires pour implémenter |
| `NN-nom.png` (ex. `01-overview.png`) | capture de travail de la console, régénérable (§ 0.6, § 9.1) | la régénérer pour comparer avant / après |

Chemins : `app/…`, `components/…`, `lib/…` sont relatifs à `apps/console/` ; `packages/…`, `apps/ingest/…`,
`apps/extension/…`, `tests/…`, `scripts/…`, `docs/…` sont relatifs à la racine du dépôt.

**Identifiants.** Pour qu'aucun identifiant ne désigne deux choses :

| Préfixe | Désigne | Où |
|---|---|---|
| P1–P15 | principes de conception | § 1.2 |
| V1–V10 | invariants de vérité | § 1.3 |
| R-S, R-P, R-E, R-F, R-A, R-V | règles transverses de domaine (seuils, populations, échantillonnage, frustration, périmètre d'app, verdict) | § 1.5 |
| CP1–CP19, CE1–CE14, CS1–CS6, DF1–DF5 | constats relevés dans le code (performance, exploration, sessions, fiabilité) | § 1.6 |
| S1–S8 | règles propres aux écrans d'usage | § 1.6 |
| W-E, W-V, W-D, W-B, W-M | widgets Explorer, Vues, Tableaux (liste), Tableau (détail), Mobile | § 5.21–5.25, § 5.6 |
| CR1–CR12, T1–T11, TD1–TD5, SL1–SL6, A1–A9, TE1–TE8, G1–G6 | widgets Corrélation, Tracing, Détail de trace, SLO, Alertes, Tendances, Conversions | § 5.7–5.20 |
| F00–F69 | sous-lots frontend | § 6 |
| B1–B62 | dépendances backend (registre unique) | § 6.3 |
| P*.1–P*.10, VM1–VM4, RM1–RM10 | sous-lots, constats et règles de l'épique statistique | § 7 |
| P**.0–P**.10, PS0–PS12, VS1–VS16, TP1–TP12, K1–K14, R1–R9 | sous-lots, sections, constats, tests, cartes et points « reste » de l'épique site | § 8 |
| A1…F3 dans le § 8 | lignes du document de couverture `docs/RUM_PARITY_STATUS.md` (pas des dépendances backend) | § 8 |

### 0.3 Conventions de code

- **Rendu.** Composants serveur (SSR) et SVG déterministe pour tout ce qui n'a pas besoin d'interaction
  continue (tuiles, sparklines, barres, distributions, heatmap, tables). `recharts` (client) reste cantonné
  aux séries temporelles et au nuage de points. Les props d'un composant client sont **sérialisables** :
  identifiants de format en chaîne (`FormatId`), jamais de fonction (une fonction passée d'un composant
  serveur à un composant client fait planter la page : c'est la cause probable de la panne de
  `/forecast`, § 5.20.0).
- **Éléments existants à réutiliser, jamais à dupliquer** : `PageHeader`, `GlobalFilters`, `SegmentBar`,
  la classe `card`, la classe `btn-accent`, la constante `INPUT_CLASS`, les composants de
  `components/charts/`, `Breakdown`, `TabLink` (`components/sessions/TabLink.tsx`), `hrefWithQuery`,
  `breakdownDrillHref`, `explorerHref`, `sqlContext`, `previousRange`, `rangeLabel`, `bucketLabel`,
  `bucketStarts`.
- **Couleurs.** Aucune couleur de donnée écrite en dur hors `lib/palette.ts` et des jetons de
  `app/globals.css` ; les graphiques lisent les variables CSS (mode sombre).
- **Seuils Web Vitals.** Importés de `lib/rating.ts` (`THRESHOLDS`, `rating2026`, `RATING_LABEL`),
  formatés par `formater` ; jamais recopiés dans un texte ou une requête (P2).
- **Lectures.** Toute lecture nouvelle ou réécrite passe par `sqlContext(f)` (`lib/query-sql.ts`), qui
  lie le périmètre effectif d'apps ; aucune nouvelle clause `($1::text is null or app_id = $1)` (R-A,
  § 1.5).
- **Chaque section d'écran** lit via `lire()` (`lib/lecture.ts`) et s'enveloppe dans `SectionErreur` : une
  lecture en échec n'efface pas les autres sections (§ 3.8).

### 0.4 Tests et définition de « fait »

Arborescence réelle (vérifiée) : `tests/unit/*.test.ts` (`pnpm test:unit`, vitest, environnement node),
`tests/integration/*-sql.test.ts` sur base réelle (`pnpm test:sql`, `--no-file-parallelism`),
`tests/e2e/*.spec.ts` (Playwright, `pnpm test:e2e`). Aucun environnement DOM n'est déclaré dans
`vitest.config.ts`.

**Nommage** : un test sur `lib/x.ts` vit dans `tests/unit/x.test.ts` ; un test sur `components/y/Z.tsx`
vit dans `tests/unit/Z.test.tsx` et rend le composant **SSR** par `renderToStaticMarkup` ; un composant
client `recharts` n'est pas testé unitairement : on teste la fonction pure qui prépare ses points ; un
test SQL vit dans `tests/integration/<sujet>-sql.test.ts` ; un e2e dans `tests/e2e/<sujet>.spec.ts`.
Chaque ligne de lot du § 6 nomme ses fichiers de test.

**Un sous-lot est « fait » quand**, dans cet ordre :

1. `pnpm --filter console typecheck` passe. Ce script n'existe pas au commit `322c9a7`
   (`apps/console/package.json` n'a que `dev`, `build`, `start`) : **F00 l'ajoute**
   (`"typecheck": "tsc --noEmit"`). Aucun linter n'est configuré dans le dépôt : aucun n'est exigé.
2. `pnpm test:unit` passe ; `pnpm test:sql` aussi si le lot touche une requête.
3. Les e2e cités passent, dont le helper « aucun débordement » (`debordements`,
   `tests/e2e/analyses-drilldowns.spec.ts:L140-147`, extrait vers `tests/e2e/helpers/debordements.ts` par
   F09) à 390, 768 et 1440 px sur chaque écran touché.
4. `pnpm --filter console build` passe.
5. Chaque écran touché est capturé en 1440 × 900 et 390 × 844 (script du § 9.1) et relu : aucun
   débordement, aucun écran en erreur. La PR **liste** les écrans capturés et ce qui a été vu ; elle ne
   joint pas les images (décision du 22/09/2026 : inutile, et impossible depuis la ligne de commande).
   Elle contient la « preuve de fin » du lot (une sortie de commande, un grep vide, un constat de capture).

### 0.5 Ce qu'on ne devine pas (règles d'arrêt)

- **Une signature citée ne correspond pas au code** : ne pas « adapter » en silence. Relire la fonction,
  appliquer l'intention écrite dans le plan (mesure, fenêtre, population), et écrire l'écart dans la PR.
- **Un fait « non établi » s'avère faux** : appliquer le repli écrit à côté ; s'il n'y en a pas, rendre
  l'état `partiel` avec la raison et le signaler.
- **Un `Bn` n'est pas livré** : le widget montre « non disponible, raison : … » (texte donné dans sa
  ligne) ; jamais un zéro, jamais une figure vide dessinée.
- **Aucun paramètre de population nouveau** : filtrer une population passe uniquement par
  `CONTRACT_PARAMS` et `seg` (§ 3.1). Les paramètres d'écran ne changent pas les chiffres.
- **Aucune route ne change d'adresse** (§ 1.1) ; aucun seuil hors `lib/rating.ts` ; aucune couleur de
  verdict sans seuil nommé (R-S) ; aucune moyenne de p75 ; aucun poids d'échantillonnage.
- **Aucune identité brute** à l'écran : ni `visitor_id` complet (8 caractères + « … » au plus), ni
  `user_id_hash`, ni IP, ni e-mail ; recherche par identité absente, par décision.
- **Écriture** : viewer, compte démo et jeton API sont en lecture seule ; un bouton d'écriture n'est pas
  **rendu** pour eux (plutôt que rendu puis refusé).
- **Libellés** : « Pays estimé » (jamais « Pays »), « Occurrences » seulement sur un `sum(occurrences)`,
  « Sessions » en tuile = sessions **commencées** (R-P), « Tendances » (jamais « Prévisions »),
  « Non collecté » pour une capacité absente.

### 0.6 Références visuelles

**Captures de travail de la console** (non versionnées). Elles vivent dans un répertoire temporaire
(`$MIP_CAPTURES_DIR`, par défaut un `mktemp -d`). On les régénère sur une base locale avec du trafic de
démonstration par `node scripts/captures-console.mjs` (script complet au § 9.1 ; il obtient le mot de
passe en exécutant `scripts/seed-admin.mjs`, aucun secret n'est écrit). Noms produits (le plan les
cite) :

| Fichier | Route | Fichier | Route |
|---|---|---|---|
| `01-overview.png` | `/` | `17-tracing.png` | `/tracing` |
| `02-pages.png` | `/pages` | `18-trace-detail.png` | `/tracing/<trace>` |
| `03-errors.png` | `/errors` | `19-map.png` | `/map` |
| `04-error-detail.png` | `/errors/<empreinte>` | `20-correlation.png` | `/correlation` |
| `05-ux-frustration.png` | `/ux` | `21-goals.png` | `/goals` |
| `06-actions.png` | `/actions` | `22-slo.png` | `/slo` |
| `07-events.png` | `/events` | `23-alerts.png` | `/alerts` |
| `08-explorer.png` | `/explorer` | `24-forecast.png` | `/forecast` |
| `09-experience.png` | `/experience` | `25-dashboards.png` | `/dashboards` |
| `10-mobile.png` | `/mobile` | `40-presentation.png` | `/presentation` |
| `11-sessions.png` | `/sessions` | `50-overview-dark.png`, `51-pages-dark.png` | `/`, `/pages` en sombre |
| `12-session-detail.png` | `/sessions/<id>` | `60-overview-390.png`, `61-errors-390.png` | `/`, `/errors` à 390 px |
| `13-acquisition.png` … `16-forms.png` | `/acquisition`, `/retention`, `/paths`, `/forms` | | |

**Références Datadog.** Source : la page https://www.datadoghq.com/dg/real-user-monitoring/overview/ et
son dossier local d'origine (`~/Downloads/datadog screenshots and videos /`, images `.jxl` / `.webp` et
trois vidéos). Le § 9.1 donne les commandes qui les convertissent en PNG et extraient les vidéos à
1 image/seconde dans `$MIP_CAPTURES_DIR/datadog/`. Ce sont des jeux de démonstration Datadog
(`shopist.io`) : aucune valeur n'est une référence ; on n'en reprend que la forme.

| Image | Ce qu'elle montre (une ligne) | Utilisée pour |
|---|---|---|
| `img/newrumperformanceimage.png` | Tableau de bord « RUM - Performance Overview » : tuiles, trois Core Web Vitals sur bandes de seuils, « vues et temps de chargement » à double axe, « Initial page load vs SPA route changes » | bandes pleines (P2), contre-exemple du double axe (P5), types de navigation (§ 5.2) |
| `img/newerrortrackingimage.png` | Error Tracking : liste d'issues à sparklines et panneau latéral (impact, versions touchées, pile, « Outliers ») | § 5.3, `ContrastBars` |
| `img/datadog-rum-views-explorer.png` | RUM Explorer (vues) : liste filtrée et panneau d'événement VIEW, onglets comptés, cascade | panneau latéral (§ 3.5), `Cascade` |
| `img/newoptimizeperformanceimage.png` | Tableau de bord « RUM - User Sessions » : groupes titrés, sessions, pages d'entrée / sortie, démographie (carte + top 10 pays) | § 5.11, § 5.13, sections de tableau (§ 5.25) |
| `img/enhanceenduserimage.png` | Résultat d'un test navigateur Synthetics relié à sa session RUM | robot et réel (§ 5.7) |
| `img/dd_platform_260623_en.png` | Schéma marketing de la plateforme (pas un écran) | vitrine seulement (§ 8), rien à reprendre |
| `frames/rum-db-new/f001–f004` | Explorer « Sessions & Replays », jeu Views, trié par temps de chargement décroissant | tri par la douleur, pastilles de requête (§ 5.21) |
| `frames/rum-db-new/f005–f007` | Panneau VIEW : Core Web Vitals à verdict, onglets comptés, cascade à pistes avec repères FCP / LCP | `DetailPanel`, `Cascade`, onglets comptés |
| `frames/newfastresponsiveengagingappsvideo/f001–f002` | Funnel à trois étapes et info-bulle « % de l'origine » | contre-exemple : deux conventions de % non nommées (§ 5.13) |
| `frames/newfastresponsiveengagingappsvideo/f003–f005` | Panneau d'analyse d'une marche : tuiles, séries « Last week », table de sessions avec ▶ par ligne | ▶ rejeu par ligne (§ 5.11) |
| `frames/newfastresponsiveengagingappsvideo/f006–f014` | Session Replay avec Event Timeline synchronisée (ligne surlignée qui suit la lecture), marqueurs, vitesses | Déroulé synchronisé (§ 5.12) |
| `frames/240523-rum-product-page-triageresolve-v01/f001–f002` | Sessions Explorer puis panneau SESSION (compteurs, liste d'événements) | panneau session (§ 5.11) |
| `frames/240523-rum-product-page-triageresolve-v01/f004–f007` | Panneau VIEW, popovers LCP / CLS avec barre de seuils et comparaison à la p75 des vues similaires | situer une valeur dans sa population (§ 3.5) |
| `frames/240523-rum-product-page-triageresolve-v01/f008–f011` | Onglet Traces : flame graph d'une trace, erreur backend liée | détail de trace (§ 5.9) |

**IP-Label Ekara** : aucune image. Principes repris de https://ip-label.com/fr/rum/ et des pages listées au
§ 9.3 (segments classés par gravité, vues préréglées nommées par facettes, release contre release,
synthétique et RUM unifiés, agent navigateur pour postes gérés). **Grafana** : documentation des panneaux
et bonnes pratiques de tableaux (une question par panneau, stat + tendance, annotations, liens de
données) ; aucune capture.

### 0.7 Ce qui a changé par rapport à l'existant, en une phrase par zone

- Navigation : cinq catégories au lieu de trois, aucune route renommée (§ 2).
- Chaque écran répond à **une** question, avec un hero au-dessus du pli à 1440 × 900 (P1).
- Séries sur bandes de seuils pleines, sans double axe, alignées sur une grille de seaux (trous = trous).
- Classements par gravité avec effectif et « échantillon faible » (IP-Label « top offenders »).
- Comparaison nommée partout (période précédente **complète** ou release contre release).
- Panneau latéral de détail, vues préréglées, constats automatiques à règle publiée, annotations de
  déploiement et d'alerte.
- L'inconnu reste inconnu (« — », « Inconnu », « Non collecté »), l'échantillonnage est dit, jamais corrigé.
---

## 1. Principes de conception et invariants de vérité

### 1.1 Trois décisions qui conditionnent tout le reste

1. **Aucune route ne change d'adresse dans ce chantier.** La refonte change des libellés, des
   rattachements de navigation et des contenus, pas les chemins (`/ux`, `/goals`, `/forecast` restent).
   Les liens partagés, les signets, les tests e2e (`tests/e2e/*.spec.ts`) et `lib/surfaces.ts:L53-137`
   sont indexés par chemin. Un renommage d'URL serait un chantier à part.
2. **Le frontend ne dessine que ce que le backend sait remplir aujourd'hui**, sauf les dépendances du
   registre B (§ 6.3), chacune petite et nommée. Un widget qui dépend d'un `Bn` est livré avec son état
   « non disponible, raison : … » tant que `Bn` manque — jamais avec des zéros.
3. **Ordre des références.** IP-Label Ekara d'abord pour l'**analyse** (segments critiques classés par
   gravité, release contre release, vues préréglées nommées par facettes, synthétique et RUM unifiés) ;
   Datadog ensuite pour la **richesse d'interaction** (bandes de seuils, panneau latéral, contraste
   « outliers », chaînage erreur → session → rejeu, cascade) ; Grafana pour la **discipline des panneaux**
   (une question par panneau, stat + tendance, annotations, liens de données). Là où la console fait déjà
   mieux, elle garde sa version (§ 1.8).

### 1.2 Quinze principes

Chaque principe : la règle, puis comment la vérifier. Une revue refuse un écran qui en viole un.

**P1 — Une question par écran, un hero qui y répond.** Le sous-titre (`sub`) du `PageHeader` formule la
question de l'écran en une phrase ; le premier bloc sous la rangée de KPI y répond sans défilement à
1440 × 900 (Grafana : « A dashboard should tell a story or answer a question »).
*Vérifier* : lire `sub` et la capture 1440 × 900 : le hero est visible et son titre reprend un mot de la
question.

**P2 — Le verdict est dessiné derrière la valeur, avec les seuils d'un seul fichier.** Toute série,
distribution ou tuile d'un Web Vital porte les zones Bon / À améliorer / Mauvais de `lib/rating.ts:L5-11`
en **bandes pleines** (pas deux pointillés), comme les « Core Web Vitals » de Datadog.
*Vérifier* : `grep -rnE "2500|4000|\b200\b.*500|0\.25" apps/console/{app,components}` ne renvoie aucun seuil
de vital hors `lib/rating.ts`. Au commit `322c9a7` il en reste dans `app/forecast/page.tsx:58`,
`app/experience/page.tsx:28-34`, `lib/queries-v2.ts:475,483`, `lib/glossary.ts:26,30` et
`app/page.tsx:182-183` : F00 et F55 les retirent. Le libellé « seuils 2026 » disparaît des écrans (les
seuils sont ceux de web.dev, § 1.4).

**P3 — Classer par gravité, pas par volume, et dire l'effectif.** Un classement de segments (route,
navigateur, pays estimé, appareil, release) est trié par défaut du plus dégradé au moins dégradé ; la
bascule « par volume » reste disponible ; chaque ligne affiche son effectif ; une ligne sous 30 mesures
est rangée en fin de liste avec « échantillon faible » (IP-Label « Top offenders by segment »).
*Vérifier* : sans paramètre `tri`, l'ordre est la gravité ; `tri=volume` rend l'ordre volume ; test
unitaire de `lib/impact.ts` : une ligne `n = 12` passe après une ligne `n = 400` quelle que soit sa p75.

**P4 — Tout chiffre clé a une référence nommée et comparable.** Une tuile ou une série se lit contre la
période précédente contiguë (`previousRange`, `lib/query-contract.ts:L306-316`), la release précédente ou
l'ensemble de la population ; la référence est écrite en toutes lettres (« vs 24 h précédentes, du 20/09
14:00 au 21/09 14:00 UTC »), pas seulement dans un `title`. Une référence **incomplète** (hors rétention,
avant le début de collecte de l'app ou de la colonne, fenêtre en cours d'ingestion) ne produit aucun
delta (§ 3.2, `couverturePrecedente`).
*Vérifier* : chaque `KpiTile` reçoit `reference` ou n'affiche pas de delta ; aucun delta sans libellé
visible ; une plage personnalisée de 30 jours n'affiche aucun delta.

**P5 — Deux populations, deux panneaux ; jamais de double axe, jamais d'addition.** Sessions, visiteurs
et identités ne s'additionnent pas et ne partagent pas un axe ; volume et latence se lisent en panneaux
empilés qui partagent l'axe des x (contre-exemple Datadog « Number of page views and loading time »).
*Vérifier* : `grep -rn yAxisId apps/console/components/charts` vide après F04 ; aucun total ni ligne
« Autres » sous un percentile ou un `distinct`.

**P6 — L'inconnu se dit, il ne se chiffre pas.** `null` → « — » ou « Inconnu » ; métrique sans
dénominateur → `null` avec sa raison ; capacité absente → « Non collecté » ; compteur réellement vide →
`0` ; lecture en échec → « lecture en échec » + « Réessayer », jamais « aucune donnée ».
*Vérifier* : test unitaire par composant (`valeur: null` → « — » et la raison, jamais « 0 ») ; e2e base
coupée → message d'erreur, pas d'état vide.

**P7 — La forme d'une distribution se montre ; un percentile ne se moyenne pas.** Quand la question est
« à quoi ressemble la population », on dessine l'histogramme avec ses repères p50 / p75 / p95 ; aucune
moyenne de p75 (horaire, par route ou par jour) n'est affichée ni calculée côté front.
*Vérifier* : aucun `reduce` sur des champs `p75` / `p95` dans `app/` ; `DistributionSeuils` reçoit
`percentiles` et les dessine.

**P8 — Tout élément de données mène au niveau suivant, filtres conservés.** Une barre, une ligne, un
point, une case, une annotation sont des liens construits par `hrefWithQuery`
(`lib/query-contract.ts:L668-683`) ou `breakdownDrillHref` (`lib/breakdowns.ts:L168`), selon la table du
§ 3.3.
*Vérifier* : e2e par écran : un clic sur le premier élément de chaque figure ouvre une URL qui contient
`app`, `period` ou `from/to`, et la condition ajoutée.

**P9 — Le temps porte ses événements.** Toute série temporelle affiche les déploiements de la fenêtre et,
là où c'est pertinent, les déclenchements d'alerte, en annotations verticales cliquables (Grafana
« annotations » ; absent des captures Datadog).
*Vérifier* : chaque `ThresholdSeries` et `StackedBars` d'un écran reçoit `annotations` (éventuellement
`[]` avec `annotationsIndisponibles` motivé tant que B1 manque).

**P10 — Chaque figure dit ce qu'elle montre et ce qu'elle ne montre pas.** Titre-question, phrase de
lecture, bulle `GlossaryTip`, et alternative textuelle `<details>` alimentée par les mêmes lignes que le
dessin ; l'explication ne prend jamais la place d'un graphique.
*Vérifier* : chaque `Figure` avec données a un `alternative` non vide.

**P11 — La couverture est déclarée.** Chaque figure dit son effectif, sa fenêtre réellement lue
(`rangeLabel`, `lib/query-contract.ts:L326`), sa largeur de seau (`bucketLabel`, L319), son
échantillonnage (probabilité d'inclusion minimale, jamais de poids appliqué), sa troncature
(`meta.truncated_groups`, « N routes, 200 affichées ») et son caractère approché (`meta.approximate`).
*Vérifier* : la zone `meta` d'une `Figure` n'est jamais vide quand la figure a des données.

**P12 — Synthétique et réel côte à côte, l'écart nommé par des états.** Là où une route a des passages
du robot (`syn_snapshot`), l'écran qui la détaille montre « vu par le robot » à côté de « vécu par les
visiteurs », en **états** (robot ok / warn / incident, réel Bon / À améliorer / Mauvais), jamais la
latence robot sur l'axe du LCP (DF1, § 1.6).
*Vérifier* : le panneau route (Pages) et la Vue d'ensemble renvoient vers `/correlation?serie=…` quand la
route a du robot.

**P13 — Des vues préréglées en un clic, nommées par leurs facettes.** Les écrans de premier niveau
portent une barre de vues préréglées (produit + personnelles) dont le nom est composé des facettes
séparées par « • » (« Mobile • Chrome • /checkout »), comme « EU • Mobile • Checkout » chez Ekara.
*Vérifier* : `PresetBar` est présent sur Vue d'ensemble, Pages, Erreurs, Interactions, Sessions, Mobile ;
un clic sur une vue ne change que des paramètres de `CONTRACT_PARAMS` (+ `cmp`).

**P14 — Densité maîtrisée, rien de tronqué en silence.** À 1440 px, KPI et hero tiennent au-dessus du
pli ; un libellé coupé garde son texte complet accessible ; pas plus de cinq séries par graphique
temporel ; un « top N » est un classement en barres, jamais N courbes.
*Vérifier* : e2e « aucun débordement » à 390 / 768 / 1440 sur chaque écran refondu ; revue des séries ≤ 5.

**P15 — La couleur porte un sens, un seul.** Vert / ambre / rouge (`RATING_HEX`) = état d'une mesure au
regard d'un seuil nommé, ou sévérité d'une alerte (palette `SEVERITE`, toujours doublée d'une forme ou
d'un motif) ; orange `accent` = la série mesurée principale (le « réel ») ; bleu `perf` pointillé = le
robot ; gris `ink-faint` pointillé = la période ou la release de référence ; échelle `SEQUENTIELLE` (une
teinte, cinq paliers) = une intensité sans verdict (heatmap, rétention, matrice de concordance) ; la
palette `CATEGORIELLE` n'emploie ni vert, ni ambre, ni rouge.
*Vérifier* : après F01, `grep -rn "emerald-\|amber-\|red-[0-9]" apps/console/{components,app}` ne renvoie
rien hors `lib/palette.ts` ; `Sankey.tsx` et `WidgetChart.tsx` importent `CATEGORIELLE`.

### 1.3 Invariants de vérité (opposables, non négociables)

| # | Invariant | Où il est fondé | Comment un écran le respecte |
|---|---|---|---|
| V1 | Occurrences = `sum(occurrences)`, jamais un compte de lignes | `lib/analytics-schema.ts:L277-284` ; `lib/queries.ts:L133-135` (`overviewStats.errors = coalesce(sum(e.occurrences), 0)`) | libellé « Occurrences » seulement sur un champ issu de `sum` |
| V2 | Sessions ≠ visiteurs ≠ identités ; jamais additionnés, jamais sur le même axe | modèle de données (`rum_session`, `visitor_id` aléatoire, empreintes d'identité) | tuiles séparées, nom de population dans le titre ; « Sessions » en tuile = sessions **commencées** (R-P) |
| V3 | Inconnu = `null` / « Inconnu » ; sans dénominateur = `null` ; vide réel = `0` ; rien collecté = « Non collecté » | `docs/API_CONSOLE.md:L468-481` | props `number \| null` + `raisonNull` ; jamais « 100 % sans crash » |
| V4 | Aucun poids d'échantillonnage appliqué ; l'incertitude s'affiche | `lib/queries-errors.ts:L403-421` | état `echantillonne` d'`EtatSurface` (R-E) |
| V5 | Jamais de moyenne de p75 ; distribution quand la forme compte | P7 | aucune agrégation de p75 côté front |
| V6 | Fenêtres UTC `[from, to)` ; presets `1h` / `24h` / `7d` + plage personnalisée ≤ 30 j ; seaux `bucketSecondsFor` | `lib/query-contract.ts:L15, L25, L230-235, L267-303` | la figure affiche la plage résolue et le fuseau de lecture ; une case ou un jour découpés dans le fuseau de l'app sont convertis en instants UTC avant de devenir un lien (§ 3.3) |
| V7 | `app_id` lié partout ; périmètre du principal ; `apps = []` = zéro accès | `lib/query-contract.ts:L192-203` | lectures par `sqlContext(f)` ; refus `FilterProblemNotice`, jamais un écran vide (R-A) |
| V8 | Seuils affichés = `lib/rating.ts` | `lib/rating.ts:L5-11` | § 1.4 |
| V9 | Viewer / démo en lecture seule ; jetons API en lecture ; ni identité brute ni IP | middleware (session démo : refus des requêtes non-GET, `app/demo/route.ts`) | aucun bouton d'écriture **rendu** pour ces rôles ; aucun champ « e-mail » |
| V10 | Un filtre inapplicable est refusé ou déclaré non appliqué, jamais ignoré | `lib/surfaces.ts:L204-214` ; `lib/page-filters.ts:L58-65` | `FiltersNotAppliedNote` ; `rangeNote` sur les écrans à fenêtre fixe |

### 1.4 Seuils Web Vitals : état de la vérification

`lib/rating.ts:L5-11` : LCP 2 500 / 4 000 ms, INP 200 / 500 ms, CLS 0,1 / 0,25, FCP 1 800 / 3 000 ms,
TTFB 800 / 1 800 ms ; `rating2026` classe « Bon » si `valeur ≤ borne basse`, « Mauvais » si
`valeur > borne haute` (L36-40) ; `RATING_LABEL` donne « Bon », « À améliorer », « Mauvais ». Le
commentaire de tête (`rating.ts:L1-2`) dit ces seuils « alignés sur web.dev » et « utilisés pour noter
les agrégats **p75** ». La page INP de web.dev (https://web.dev/articles/inp) a été relue ; les pages LCP,
CLS, FCP et TTFB (https://web.dev/articles/lcp, /cls, /fcp, /ttfb) **ne l'ont pas été** dans ce
travail : F00 inscrit leur relecture comme critère de fin avant qu'un texte d'écran n'écrive « seuils
web.dev ». Tout texte qui cite une borne l'importe de `THRESHOLDS` et la formate par `formater`.

### 1.5 Règles transverses de domaine

**R-S — Seuils hors Web Vitals.** Aucun seuil publié n'existe pour un taux d'erreur, un ratio
d'occurrences, un taux de frustration, un CSAT, une rétention, une conversion, une latence d'API ou un
démarrage mobile. Règle : **aucune couleur de verdict** sur ces mesures ; la tuile reste neutre, seul le
delta porte une flèche. Une tuile ne prend le ton `bad` que par sa prop `alerte`, qui exige une règle
écrite sous la valeur (« aucun canal : personne n'est prévenu »). Supprime l'orange « dès une
occurrence » de `app/errors/page.tsx`, le rouge « > 2 % » de `app/page.tsx:L179`, le seuil « 2 % » de
`/forecast`, les seuils 0,6 / 0,3 de `/forms`, 40 / 20 % de `/retention`, et le vert / ambre / rouge
0,9 / 0,5 de la heatmap (qui passe en échelle `SEQUENTIELLE`). Seul « budget ≥ 100 % = épuisé » est une
définition (SLO, § 5.18).

**R-P — Populations canoniques.** En tuile, « Sessions » veut dire **sessions commencées**
(`started_at ∈ [from, to)`, `engagementStats(f).sessions_started`, `lib/queries-sessions.ts:L20-33`) sur
**tous** les écrans : la Vue d'ensemble et `/sessions` affichent le même nombre pour la même URL de
filtres. « Sessions actives » (dernière activité dans la fenêtre, `last_seen_at`) n'apparaît que dans
une figure dont le titre porte ce mot, sans sparkline d'une autre population ; `overviewStats.sessions`
(`lib/queries.ts:L127`, dernière activité) n'est plus affiché en tuile. Le dénominateur « sessions ayant
au moins une vue dans la fenêtre » a **une seule** définition, `sessionsAvecVue(f)` (F10, § 4.5), que
les écrans d'usage réutilisent (après B31). Visiteurs = `count(distinct visitor_id)` à identifiant
aléatoire, jamais additionnés aux sessions. Valeur et sparkline d'une même tuile comptent la même
population.

**R-E — Échantillonnage dit, jamais corrigé.** Aucun poids n'est appliqué (V4). Dès que la population lue
contient une session dont la probabilité d'inclusion est < 1 ou inconnue, l'état `echantillonne`
s'affiche sous la rangée de KPI : « Échantillonné : chaque session avait au moins <p> % de chances d'être
retenue ; comptes observés, non extrapolés. » Sources : vitals `samplingVitals(f)` (F10), sessions
`samplingSessions` / `samplingSessionsHistorique` (B38), erreurs `ErrorListResult.sampling`
(`lib/queries-errors.ts:L204-213`), actions `ActionSummary.sampling_notice`, journal
`EventExplorerResult.sampling_notice`. Deux faits du SDK commandent les textes : l'échantillonnage est
**biaisé vers les erreurs** (une session tirée « biaisée-erreurs » n'envoie que ses erreurs, puis passe
en collecte complète à la première erreur, `packages/rum-sdk/src/sampling.ts:L10, L46-74`) et les
sessions antérieures au 09/09/2026 portent `sample_rate = 1` **par défaut, pas par mesure**
(`apps/ingest/sql/migration-v58.sql:L65, L81-83`) : elles rendent `probaMin: null` (« probabilité
d'inclusion non enregistrée »). Une part de sessions touchées vaut `null` dès que `tauxMin < 1` (CP15).

**R-F — Garde capteur des signaux de frustration.** Le SDK navigateur et l'extension (même bundle,
`apps/extension/build.mjs:L31`, `init` sans `frustration: false`) émettent `frustration.rage / dead /
error` ; le SDK React Native (`packages/rum-mobile`) n'en émet aucun (CP16). Donc : population
entièrement `rum_session.runtime = 'react_native'` → `non_collecte` « Non collecté : le SDK mobile n'émet
pas de signaux de frustration » ; population mixte → `partiel` « compté sur les sessions navigateur
seulement (N sur M) », numérateur et dénominateur restreints ; colonne `runtime` absente (avant v82) →
comptes affichés + `partiel` « capteur non identifiable : un 0 peut venir d'un capteur qui n'émet pas ».
Un SDK configuré `frustration: false` envoie 0 sans que la console le sache : une ligne fixe le dit. La
même garde vaut pour `form.*` sur `/forms` si le SDK mobile n'émet pas `form.*` (non vérifié : F51 le
vérifie dans `packages/rum-mobile/src`).

**R-A — Périmètre d'app lié dans chaque requête.** Toute lecture nouvelle ou réécrite passe par
`sqlContext(f)`, qui compile `query.scope.effectiveApps`. Sous `app=all`, `filtersOfQuery` recopie
`requestedApp = null` dans `Filters.app` (`lib/filters.ts:L110-114`) : les lectures « historiques » qui
filtrent par `($1::text is null or app_id = $1)` ne filtrent plus rien, et la console se connecte en
`BYPASSRLS` (`lib/db.ts:L112-113`). Écrans concernés : `/acquisition`, `/retention`, `/paths`, `/forms`
(CS1) et `/goals` (§ 5.14.0). F40 le prouve par un e2e puis pose un **refus typé** (« Cet écran lit une
application à la fois ») quand `requestedApp === null` et que le principal est restreint, jusqu'à la
migration des lectures (B31 → F53 ; F66 pour `/goals`).

**R-V — Verdict Web Vitals réservé au p75.** Une moyenne ou un p95 de LCP noté « Bon / À améliorer /
Mauvais » serait un verdict inventé (CE13). Une seule fonction décide : `vitalDeVerdict(plan)`
(`lib/explorer-page-params.ts`, F32) ; la prop `vital` de `KpiTile` et de `ThresholdSeries` ne reçoit
que son résultat ; pour `avg` / `p95` d'un vital : tuile neutre, barres de teinte neutre, **aucune bande**,
et la phrase « Seuils web.dev définis pour le p75 : aucun verdict n'est donné pour <la moyenne | le p95>. »

**R-T — Fuseaux.** Les fenêtres du contrat sont en UTC. Trois lectures découpent jours et heures dans le
fuseau de l'app (`healthGrid`, `dailyTraffic`, `dailyLcpSeries`, `lib/queries-grid.ts:L64-76, L114-120,
L177-183`). Quand une case ou un jour devient un lien, **le serveur** convertit ses bornes locales en
instants UTC (`bornesHeureLocale`, `bornesJourLocal`, `lib/fuseau.ts`, F05) ; l'écran d'arrivée affiche
les deux fuseaux (« 09:00-10:00 Europe/Paris (07:00-08:00 UTC) »).

### 1.6 Constats relevés dans le code (ils commandent des écrans)

Relus au commit `322c9a7`. Chaque constat est repris dans l'écran ou le lot qui le corrige.

**Performance (CP1–CP19).**
| # | Constat | Preuve | Conséquence pour les écrans |
|---|---|---|---|
| CP1 | `vitalsBreakdown` trie **par volume** (`order by samples desc`) **puis** coupe à `cap` (12 par défaut). Un tri « gravité » appliqué ensuite ne classerait que les 12 groupes les plus mesurés : une route lente et peu visitée n'y entre jamais. | `lib/queries-breakdowns.ts:L79-109`, tri L104 ; `BREAKDOWN_CAP = 12`, `lib/breakdowns.ts:L38` | L'`ImpactTable` appelle `vitalsBreakdown(f, dim, 200)` (le paramètre `cap` existe) puis trie côté serveur dans `lib/impact.ts`. La troncature restante est **par volume** et dite : « les 200 groupes les plus mesurés sont classés ; N autres, moins mesurés, ne le sont pas ». Patch propre : B10 (§ 6.3). |
| CP2 | `vitalsBreakdown` ne porte que LCP, INP, CLS (`where m.name in ('LCP','INP','CLS')`). | `queries-breakdowns.ts:L98` | Sur Pages, `vital=FCP` / `vital=TTFB` pilote les tuiles et la distribution, mais le classement des routes affiche « classement FCP non disponible : le découpage ne lit que LCP, INP, CLS » (onglet désactivé avec raison). Patch : B11 (§ 6.3). |
| CP3 | `comparaisonVersions` trie **par sessions** (`order by v.sessions desc`), pas par date ; `VersionRow` n'a ni date de première vue, ni CLS. | `queries-deploys.ts:L113-121, L212, L242` | La règle naïve « `rel_b` = release la plus récente de `comparaisonVersions` » n'est pas calculable. Nous prenons la version du **dernier marqueur de déploiement** (`listDeploys(f, 20)[0].version`, `queries-deploys.ts:L20-31`) si elle figure dans `comparaisonVersions`, sinon la release de plus grand volume, **et nous l'écrivons** (règle du § 3.2). |
| CP4 | `vitalSeries` ne renvoie que les seaux **non vides** (`group by 1`) et **sans effectif** par seau ; pas de variante « période précédente ». | `queries.ts:L150-163` | Le front aligne les points sur `bucketStarts(range)` (`query-contract.ts:L241-250`) : seau absent → `null` (trou), jamais 0. À créer : `vitalSeriesN(f, name, shift)` qui renvoie `{bucket, p75, n}` (§ 4.5). |
| CP5 | `topFrustrations` coupe à **50 lignes** (route × type × cible) et n'a ni sessions ni seaux ; `inpOffenders` coupe à **20** et ne porte pas la route ; les deux avalent l'erreur (`softFail`). | `queries-frustration.ts:L19-39` (limit 50 L33), `L52-72` (limit 20 L66) | Un total rage/dead/error calculé en sommant ces 50 lignes est **faux** dès qu'il y a plus de 50 couples. À créer : `frustrationTotaux(f)` et `frustrationParRoute(f)` (§ 5.4). |
| CP6 | `overviewStats.errors` = `coalesce(sum(e.occurrences),0)` ; `overviewStats.sessions` compte les sessions dont la **dernière activité** tombe dans la fenêtre. | `queries.ts:L124-142`, L127 | La tuile de trafic de la Vue d'ensemble **n'utilise plus** `overviewStats.sessions` : elle affiche « Sessions commencées » (`engagementStats(f).sessions_started`, `queries-sessions.ts:L20-33`, `started_at ∈ [from,to)`), la même population et le même nombre que la tuile de tête de `/sessions` (R-P, § 1.5). |
| CP7 | Aucune fonction ne compte « les sessions ayant au moins une vue dans la fenêtre », dénominateur honnête de « part des sessions touchées ». | inventaire `console-donnees.md` § 3 | À créer : `sessionsAvecVue(f)` (§ 4.5). Sans elle, la tuile « Part des sessions touchées » vaut `null` avec sa raison. |
| CP8 | Les groupes d'erreurs historiques n'ont **pas** de première / dernière release ; les issues v2 les ont. | `ErrorGroupRow`, `queries-errors.ts:L165-182` ; `IssueEntryIssue.first_release/last_release`, `lib/error-issues.ts:L201-207` | En mode historique, « versions touchées » vient d'une fonction à créer `releasesDuGroupe(ref, f)` ; en mode issue, des champs existants. |
| CP9 | L'ordre de la liste d'erreurs est figé : régressées, ouvertes, résolues, ignorées, puis **visiteurs** touchés, puis sessions, occurrences. Aucun paramètre de tri. | `queries-errors.ts:L639-645` | Défaut conservé (il est meilleur qu'un tri par occurrences) ; `tri=sessions` / `tri=recent` = options à créer, déclarées dans `TRIS_PAR_ECRAN` (§ 3.1) ; l'ordre existant est gardé et **nommé** (§ 5.3). |
| CP10 | `feedbackTrend` impose des seaux **journaliers** (`bucketSeconds: 86_400`) et `limit 30`. | `queries-experience.ts:L83-97` | Sous `1h` ou `24h`, la série a un point : état « partiel : seau journalier fixe ». À créer : variante sur les seaux du contrat. |
| CP11 | `experienceContext.frustration` = rage + dead seulement ; `feedbackByRoute` peut renvoyer `count = 0` (route à commentaire seul). | `queries-experience.ts:L47-74, L133-150` | Taux par route = `null` si `count = 0` (jamais 0 %). |
| CP12 | `listDeploys` lit la portée seule, **sans fenêtre** (20 derniers marqueurs). | `queries-deploys.ts:L20-31` | Les annotations sont filtrées côté serveur sur `[from, to)` ; hors fenêtre, rien n'est dessiné. Sous plage personnalisée, B1 reste nécessaire pour les fenêtres anciennes (les 20 derniers peuvent ne pas couvrir la plage) : message du § 3.7. |
| CP13 | `blindSpots` est plafonné à **50 lignes** (couples route × heure) et code la borne en dur (`rum_lcp_p75 > 2500`, borne **Bon**). | `queries-v2.ts:L476-488` (L483, L487) | Aucun compte d'angles morts n'est lu dans `blindSpots` : le compte vient de `correlationConcordance(f)` (CR8, § 5.7, lot F57). La règle affichée est celle de CR9 : « au-dessus de la borne Bon (`THRESHOLDS.LCP[0]`) ». |
| CP14 | `sessionJoin` est un `left join` : une erreur sans session (Node, Python, OTel) est comptée dans `overviewStats.errors` et dans `healthScore` alors qu'aucune page vue ne lui correspond. Le facteur de santé s'intitule pourtant « Erreurs JS ». | `query-compiler.ts:L226-228` ; `health.ts:L160-176, L220-229` ; sources `ERROR_SOURCES` (`queries-errors.ts:L44-52`, `browser_*` pour le navigateur, colonne `error_source` ajoutée en v69, test L387) | Tout ratio « erreurs / vues » de ce domaine restreint son numérateur à `error_source like 'browser_%'` ; les occurrences sans source déclarée sont comptées à part et dites. Sans la colonne v69 : numérateur non restreint, phrase « inclut les erreurs serveur sans page vue ». |
| CP15 | Une session hors `sampleRate` passe en mode « error-biased » : seules ses erreurs partent, **puis** la première erreur la promeut en collecte complète (vues comprises). Les sessions touchées entrent donc dans la population des sessions avec vue plus souvent que les autres. `sampleRate` vaut 1 par défaut. | `packages/rum-sdk/src/types.ts:L14-25` ; `sampling.ts:L10, L46-74` ; `index.ts:L184, L224` ; probabilité d'inclusion `queries-errors.ts:L403-410, L566-568` | « Part des sessions touchées » vaut `null` dès qu'une session de la population a `sample_rate < 1` (§ 5.3.2). |
| CP16 | L'extension navigateur injecte **le même bundle** que le SDK (`vendor/mip-rum.js` copié de `packages/rum-sdk/dist`, contrôle `check:sync` en CI) et appelle `init` sans `frustration: false` ni `forms: false` ; le SDK active frustration et formulaires par défaut. Le SDK mobile (`packages/rum-mobile`) n'a **aucun** détecteur de frustration. | `apps/extension/build.mjs:L31` ; `apps/extension/README.md:L13, L37-41` ; `apps/extension/src/background.ts:L79-90` ; `packages/rum-sdk/src/index.ts:L377-387` ; `grep -rn frustration packages/rum-mobile/src` vide ; `rum_session.runtime` (v82) distingue `react_native` (`queries-mobile.ts:L34, L50-51`) | Les signaux de frustration ne sont pas collectés pour les sessions `runtime = 'react_native'` : la tuile les exclut et le dit (§ 5.4.2 ; règle R-F, § 1.5). Pour l'extension, la capacité est établie par le code, pas observée en production. |
| CP17 | Une page vue est émise au chargement **et** à chaque changement de route SPA (`nav_type = 'spa'`) ; le LCP n'est émis qu'au chargement (web-vitals `onLCP`). | `packages/rum-sdk/src/context.ts:L28-40` ; `vitals.ts:L5, L59` ; `index.ts:L502-522` | Le panneau « vues » de « Charge, erreurs et LCP » sépare chargements et changements de route SPA (§ 5.1.2) ; Pages les classe par route (§ 5.2). |
| CP18 | `/events` lit déjà `name`, et ses champs d'attribut s'appellent `attr_source`, `attr_key`, `attr_type`, `attr_value`. | `app/events/page.tsx:L67-92` | Les facettes cliquables du Journal posent ces paramètres-là (§ 5.23.2), pas `source` / `key` / `type` / `value`. |
| CP19 | Les tests vivent à la racine du dépôt : `tests/unit/*.test.ts` (`pnpm test:unit`), `tests/integration/*-sql.test.ts` sur base réelle (`pnpm test:sql`, `--no-file-parallelism`), `tests/e2e/*.spec.ts` (Playwright). Aucun test de composant `.test.tsx` n'existe encore ; `vitest.config.ts` ne déclare pas d'environnement DOM. | `package.json:L9-11` ; `vitest.config.ts` ; `ls tests/unit` (168 fichiers, aucun `.tsx`) | Chaque lot du § 6 nomme ses fichiers de test selon la convention du § 0.4. Un test de composant SSR rend par `renderToStaticMarkup` (environnement node) ; un composant client recharts n'est pas testé unitairement : on teste la fonction pure qui prépare ses points. |

**Exploration (CE1–CE14).**
| # | Constat | Preuve | Conséquence à l'écran | Lot |
|---|---|---|---|---|
| CE1 | Un widget de tableau de bord « série temporelle » remplace un seau `null` (percentile, moyenne, distincts sans mesure) par **0**, alors que le commentaire dit « null (donc aucun point) ». | `lib/widget-data.ts` L233 (`fill(0)`), L234 (`point.value ?? 0`) ; type `WidgetSeriesGroup.values: number[]` L45-49 ; export CSV L479 (`?? 0`) | Une heure sans mesure LCP est dessinée « LCP = 0 ms », verdict « Bon ». Viole V3 / P6. | F30 |
| CE2 | Un widget « classement » dessine une barre de longueur 0 pour une valeur `null`. | `lib/widget-data.ts` L211 (`value: groupe.value ?? 0`) | Barre vide lue comme « meilleur groupe ». | F30 |
| CE3 | Une lecture de widget v1 qui lève une exception rend une **table vide**, pas une erreur. | `lib/widget-data.ts` L396-397 (`catch { return EMPTY; }`) | « Pas de ligne » indiscernable d'une base indisponible. Viole P6 et § 3.8 règle (2). | F30 |
| CE4 | La tuile `vital_p75` dit « aucune donnée » sans distinguer 0 mesure et p75 non calculable ; pas de verdict. | `lib/widget-data.ts` L333-337 | Chiffre sans référence (défaut relevé chez Datadog, `console-ecrans-4.md` L232). | F36 |
| CE5 | L'Explorer dessine un seau `null` comme une barre à 0 (la valeur réelle n'est que dans l'alternative). | `app/explorer/page.tsx` L588-590 | Idem CE1 sur la page elle-même. | F32 |
| CE6 | L'Explorer propose 10 séries temporelles superposables. | `app/explorer/page.tsx` L70 (`timeseries: [1, 3, 5, 10]`) | Contraire à P14 (≤ 5 séries). | F30 |
| CE7 | Le lien « Issues des erreurs React Native » de `/mobile` vise `/errors/issues`, route **sans page** (seul `app/errors/issues/[id]/page.tsx` existe). | `app/mobile/page.tsx` L67, L298 ; `find app/errors/issues` | Lien probablement en 404 (non vérifié en exécution). Le paramètre `source` est lu par `/errors` (`app/errors/page.tsx` L97, en mode issues seulement). | F30 |
| CE8 | Le lien « Sessions mobiles » ouvre `device=mobile` (classe d'appareil, navigateurs mobiles compris), pas la cohorte React Native. | `app/mobile/page.tsx` L68 ; `console-ecrans-2.md` L153 | Le lien promet une population et en ouvre une autre. | F30 |
| CE9 | Sans migration v82, `mobileSummary` rend `sessions: 0` au lieu d'une inconnue. | `lib/queries-mobile.ts` L305-311 | Le bandeau « Réponse partielle » le dit, mais la tuile affiche « 0 » : l'écran écrit 0 là où rien n'est mesurable. | F30 |
| CE10 | `AutoRefresh` rafraîchit **toutes** les routes toutes les 5 s, sans exception de chemin. | `components/AutoRefresh.tsx` L12-32 ; `app/layout.tsx` L210 | D'après le code (non observé en exécution) : un Explorer exécuté (`run=1`, page `force-dynamic`) relance `exploreAnalytics` toutes les 5 s, et un tableau de bord relit ses cartes au-delà du cache de 10 s (`WIDGET_CACHE_TTL_MS`, `widget-data.ts` L42). Le résultat change sous le curseur (contre-exemple Datadog, `datadog-video-rum-db-new.md` § 5 dernier point) et la promesse « exécution explicite » (`explorer/page.tsx` L3-7) n'est tenue qu'au premier rendu. | F09 (§ 3.11) |
| CE11 | Le bouton « Supprimer » d'une vue enregistrée est en `bg-red-600`. | `app/explorer/views/page.tsx` L140 | Viole P15 (le rouge est réservé à l'état d'une mesure). | F34 |
| CE12 | `dimensionValues` compte des **sessions** ou des **signaux** de la fenêtre, sans les filtres de segment, et non la population d'un jeu de l'Explorer. | `lib/queries-dimensions.ts` L25-40 ; `lib/dimensions.ts` L82-88, L164-175 | Ne peut pas servir de « facettes comptées » de l'Explorer sans mentir sur la population : la répartition est calculée par `exploreAnalytics` (§ 5.21, W-E7). | — |
| CE13 | Pour le jeu `vitals`, la mesure `value` accepte `avg`, `p75`, `p95` (pas `p50`, pas `max`) ; les seuils de `rating.ts` sont ceux de web.dev **pour le p75** (commentaire de tête : « utilisé pour noter les agrégats p75 au rendu »). | `lib/analytics-schema.ts` L179 (`DUREE = ["avg", "p75", "p95"]`), L389 ; `lib/rating.ts` L1-2, L5-11, L36-40 | Une moyenne ou un p95 de LCP noté « Bon / À améliorer / Mauvais » serait un verdict inventé : règle **R-V** (§ 1.5) — verdict, couleur de verdict et bandes seulement pour `p75`. | F32, F36 |
| CE14 | L'état d'une capacité mobile est `active` dès qu'**une** release la déclare (`capabilityStatus`) ; le taux « sessions sans erreur JS » de `mobileSummary` utilise cet état global, calculé sur **toutes** les sessions de la cohorte. | `lib/mobile-capabilities.ts` L83-98 ; `lib/queries-mobile.ts` L329-331, L346-350 | Les sessions d'une release qui ne déclare pas les erreurs JS entrent au dénominateur comme « sans erreur » : le taux global est gonflé, et une ligne par release sans garde propre afficherait « 0 % touchées ». Corrigé en W-M5 / W-M6 (état **par release**, taux calculé sur les releases déclarantes). | F38 |

**Usages (CS1–CS6).**
- **CS1 —** **Quatre des sept écrans lisent hors du contrat, et le code lu laisse passer toutes les apps sous
  `app=all`.** `/acquisition`, `/retention`, `/paths`, `/forms` utilisent `now() - interval` et le
  filtre `($1::text is null or x.app_id = $1)` (`lib/queries-acquisition.ts:L21-22`,
  `lib/queries-cohorts.ts:L34-35`, `lib/queries-paths.ts:L32-33, L78-79`, `lib/queries-funnel.ts:L31-32,
  L59-60`, `lib/queries-form-analytics.ts:L21-23`). Or `app=all` donne `requestedApp = null`
  (`lib/query-contract.ts:L182-185`) et `filtersOfQuery` recopie `requestedApp` dans `Filters.app`
  (`lib/filters.ts:L111-114`) sans les `effectiveApps` du principal (`resolveScope`,
  `lib/query-contract.ts:L192-203`). Un viewer restreint à l'app A qui ouvre `/acquisition?app=all`
  lit donc, d'après ce code, les premières vues de **toutes** les apps ; la RLS ne compense pas tant
  que la console se connecte en `BYPASSRLS` (`lib/db.ts:L112-113`, `docs/MULTITENANT.md` L47-53).
  **Non vérifié par exécution** : F40 commence par un test e2e qui le prouve ou l'infirme, puis ferme
  la porte (refus typé) avant toute refonte visuelle ; `/goals` a le même défaut (§ 5.14.0). C'est l'invariant V7 ; il passe avant le style.
- **CS2 —** **La liste des sessions ne sait pas dire lesquelles regarder.** `listSessions` trie par dernière
  activité (`lib/queries.ts:L363-389`) et ne renvoie ni frustration ni présence de rejeu. La question
  de l'écran (« quelles sessions regarder en premier ? ») n'a aujourd'hui aucune réponse chiffrée.
- **CS3 —** **Le détail empile, il ne raconte pas.** 12 lignes « Vital » à `+0 ms` dont 9 sont des phases réseau
  (`console/12-session-detail.png` ; `console-ecrans-2.md` L273), chronologie et rejeu dans deux onglets
  non synchronisés (`app/sessions/[id]/page.tsx:L52-61`), aucun lien sortant, plafond de 500 lignes muet
  (`lib/queries.ts:L506, L563`). Datadog montre la bonne forme : lecteur à gauche, chronologie à droite,
  ligne surlignée qui suit la tête de lecture, erreur indentée sous le clic
  (`datadog/frames/newfastresponsiveengagingappsvideo/f006.png` ; `reads/datadog-video-newfast…md`
  L92-109).
- **CS4 —** **Trois écrans affichent un chiffre là où le code a une inconnue.** `pageHealth(null)` rend « good »
  (`lib/map.ts:L19`) ; `apiHealth` traite une latence `null` comme 0 ms (`lib/map.ts:L11`) ;
  `funnelReport` rend `convFromStart = 0` sans dénominateur (`lib/funnel.ts:L55`). Invariant V3.
- **CS5 —** **Les définitions de nos compteurs d'usage ont des angles morts qu'aucun concurrent n'écrit, et
  que nous devons écrire.** Un « abandon » de formulaire est émis quand la page passe en arrière-plan
  (`packages/rum-sdk/src/forms.ts:L213-218`) : changer d'onglet compte comme un abandon, et la
  soumission qui suit n'est pas comptée (le suivi est vidé, L216). Un canal « direct » regroupe
  « aucun référent » et « référent retiré par la politique `Referrer-Policy` du site d'origine »
  (`lib/acquisition.ts:L33-34`). Le rejeu s'arrête après 2 minutes ou 1 Mo compressé
  (`packages/rum-sdk/src/replay.ts:L9-10`). Ces trois phrases sont des éléments d'écran, pas des notes
  de bas de page.
- **CS6 —** **Nos comptes de sessions sont observés, et l'échantillonnage peut les réduire sans qu'aucun écran
  d'usage le dise.** `rum_session.sample_rate` et `error_sample_rate` existent depuis v58
  (`apps/ingest/sql/migration-v58.sql:L65-66`). L'échantillonnage du SDK est **biaisé vers les
  erreurs** : une session tirée en mode « biaisé-erreurs » qui n'a pas d'erreur n'émet rien et n'est
  pas stockée ; la probabilité d'inclusion vaut `sr` pour une session sans erreur et
  `sr + (1 − sr) × esr` pour une session avec erreur (`migration-v58.sql:L41-57`, colonne `has_error`
  L70). Les lignes antérieures à v58 portent `sample_rate = 1` **par défaut, pas par mesure**
  (`not null default 1`, L65 ; commentaire L81-83 ; v58 datée du 09/09/2026, L26). L'Explorer et le
  Journal avertissent déjà (`lib/queries-events.ts:L191-200`, `lib/queries-errors.ts:L403-421`) ; aucune
  figure de `/sessions`, `/acquisition`, `/retention`, `/paths`, `/forms`, `/map` ne le fait. Règle S7.

---

**Règles propres aux écrans d'usage (S1–S8)**, en plus de P1–P15 :
| # | Règle | Vérification |
|---|---|---|
| S1 | **Une population par figure, nommée dans le titre ou la méta** : « sessions commencées » (`started_at` dans `[from, to)`), « sessions actives » (dernière activité dans la fenêtre, `last_seen_at`), « visiteurs distincts (identifiant aléatoire) », « visiteurs identifiés ». Deux populations ne partagent jamais une figure. En tuile, « Sessions » veut dire **sessions commencées** sur tous les écrans (population canonique, R-P) ; « actives » n'apparaît que dans une figure dont le titre porte ce mot, sans sparkline d'une autre population. | Revue : chaque `Figure.meta` contient l'un de ces quatre libellés exacts ; aucune tuile « Sessions » ne lit `last_seen_at`. |
| S2 | **Aucun écran d'usage ne mélange une lecture historique (`now() - intervalle`) et une lecture du contrat (`[from, to)`)** sur la même page tant que B31 n'est pas livré : deux « 7 j » aux bornes différentes (`console-ecrans-2.md` L22). | `grep` : une page importe soit `lib/queries-{acquisition,cohorts,paths,funnel,form-analytics}.ts`, soit des lectures `sqlContext`, pas les deux (exception : aucune). |
| S3 | **Les écrans historiques affichent la fenêtre réellement lue** : « 7 derniers jours glissants, lus à 14:02 UTC (lecture non migrée : ni plage personnalisée, ni tablette, ni « Inconnu ») ». | e2e : la méta de chaque figure de `/acquisition`, `/paths`, `/forms` contient « lecture non migrée » tant que B31 manque. |
| S4 | **Tout plafond de lecture est dit à côté du chiffre qu'il borne** : 20 000 sessions (acquisition), 5 000 événements (formulaires), 50 transitions / 15 bords (parcours), 40 nœuds / 80 arêtes (carte), 500 lignes (chronologie). Atteint → `EtatSurface{kind:"partiel"}` ; non atteint → rien. | Unitaire : fonction pure `plafondAtteint(n, plafond)` ; e2e sur données de démo : pas de bandeau partiel. |
| S5 | **Aucune identité à l'écran** : ni `visitor_id` complet (8 caractères + « … » au plus, déjà le cas `console/12-session-detail.png`), ni `user_id_hash`, ni user-agent brut hors du panneau « Attributs techniques » replié ; recherche par identité toujours absente (`lib/sessions-search.ts:L11-15`). | e2e : le HTML de `/sessions` ne contient aucun `visitor_id` complet de la base de démo. |
| S6 | **Un seuil propre à un écran d'usage est écrit à l'écran avec sa source** (30 sessions pour l'engagement, `lib/engagement.ts:L21` ; 30 min pour « encore active », L24 ; 2 % / 10 % d'erreurs et 1 s / 3 s de latence pour la carte, `lib/map.ts:L10-15`). Un seuil sans source (0,6 / 0,3 des formulaires, `app/forms/page.tsx:L87` ; 40 / 20 % de rétention, `app/retention/page.tsx:L97`) **disparaît** : la valeur s'affiche sans verdict coloré. | `grep -n "0\.6\|0\.3\|>= 40\|>= 20" app/forms app/retention` vide après F48–F51. |
| S7 | **Chaque écran d'agrégat du domaine dit s'il lit un échantillon.** Sous la rangée KPI (zones Z2b, A2b, R2b, P2b, Fm2b, M2b), `EtatSurface{kind:"echantillonne", unite:"session"}` dès que la population lue contient une session de probabilité d'inclusion < 1 **ou inconnue** : « Échantillonné : chaque session avait au moins <p> % de chances d'être retenue ; comptes observés, non extrapolés. » ; si `biaiseErreurs` : « les sessions avec erreur sont sur-représentées : une part de sessions en erreur calculée ici est surestimée » ; si `sansTaux > 0` : `probaMin: null` et « N sessions commencées avant le 09/09/2026 : probabilité d'inclusion non enregistrée ». Aucun poids appliqué (V4). Lecture B38 (§ 6.3) ; le détail de session le dit dans sa puce « Échantillonnage » (§ 5.12.4). | e2e `tests/e2e/usages-echantillonnage.spec.ts` : une session de démo à `sample_rate = 0,5` → bandeau « au moins 50 % » et « comptes observés, non extrapolés » sur les six écrans ; population postérieure au 09/09/2026 entièrement à 1 → aucun bandeau ; unitaire `tests/unit/echantillonnage.test.ts` sur `etatEchantillonnage`. |
| S8 | **Chaque test cité nomme son fichier** (convention du § 0.4) : un test sur `lib/x.ts` vit dans `tests/unit/x.test.ts`, un test de composant `components/y/Z.tsx` dans `tests/unit/Z.test.tsx`, un e2e du domaine dans `tests/e2e/usages-<écran>.spec.ts`. | Revue du § 6 : aucune ligne « Tests » sans chemin. |

**Fiabilité et robot (DF1–DF5).**
- **DF1 —** **Montrer ce qu'on sait décider, pas deux courbes à interpréter.** Robot et réel ne mesurent pas
  la même chose : `syn_snapshot.latency_ms` est le `first_load_time` du scénario robot
  (`BUILD_LOG.md:71`), le réel est un LCP p75 (`queries-v2.ts:384-412`). L'écran actuel calcule quand
  même un « écart −90 % » entre les deux (`RouteCard.tsx:11-32`, visible sur `20-correlation.png`).
  Ce badge disparaît. À sa place, on compare des **états** (robot `ok/warn/incident` × réel
  Bon / À améliorer / Mauvais) dans une matrice de concordance, et les angles morts sont définis par
  ces états. **Conséquence** : la latence du robot n'est jamais tracée sur l'axe du LCP ni sur
  ses bandes Bon / À améliorer / Mauvais. Le robot a son propre panneau, une frise d'états par heure
  (CR7-b, § 5.7). C'est la promesse d'Ekara (« détecter en synthétique, quantifier en RUM »,
  `iplabel.md` L125-154), rendue mesurable.
- **DF2 —** **Un percentile ne se soustrait pas, et ne se multiplie pas par une médiane.** Le hero de
  `/tracing` découpe aujourd'hui chaque barre en « serveur = back_p75 » et « réseau = front_p75 −
  back_p75 » (`app/tracing/page.tsx:L37-56`). Cette différence n'est le p75 de rien, et `front_p75 × part_serveur_p50`
  n'est la durée d'aucun appel non plus. Le hero refait dessine **une seule longueur en ms**
  (le p75 navigateur) et montre la part serveur médiane, mesurée appel par appel, sur une **échelle
  de part 0-100 %** à côté. Aucun empilement en millisecondes (V5).
- **DF3 —** **Un événement n'est pas un état.** `alert_event` n'enregistre ni la récupération ni l'heure
  d'acquittement (`migration-v02.sql:75-82`, v17 L47-49). On ne dessine donc pas de « frise d'état »
  d'alerte avec des durées : ce serait inventé. On dessine une **frise de déclenchements** par règle.
  La frise d'état d'alerte attend B51 (§ 6.3). La frise d'état du **robot** (CR7-b, § 5.7), elle, est licite :
  chaque heure a un état mesuré (`syn_state`, pire état de l'heure, `queries-v2.ts:405-406`), sans
  durée inventée entre deux passages.
- **DF4 —** **Une tendance se montre avec son bruit.** `/forecast` projette une droite des moindres carrés
  sans marge (`forecast.ts:14-30`) et annonce une échéance dès 3 points (L19). L'écran refait montre
  la dispersion des résidus. Il n'écrit une échéance que si la pente dépasse ce bruit. Il retire le
  seuil « 2 % » d'erreurs, qui ne s'appuie sur aucune source (`app/forecast/page.tsx:62-70`).
- **DF5 —** **Le périmètre d'apps est lié dans chaque requête, `app=all` compris.** Toute lecture nouvelle ou
  réécrite de ce domaine passe par `sqlContext(f)` (`lib/query-sql.ts:27-31`), qui compile
  `query.scope.effectiveApps`. Aucune lecture n'écrit plus `($1::text is null or app_id = $1)` avec
  `f.app` : sous `app=all`, `f.app` vaut `null` (`filtersOfQuery`, `lib/filters.ts:110-113`) et la
  clause n'exclut plus rien (§ 5.14.0).

### 1.7 Capacités des références : reprises, reportées ou écartées

Chaque capacité vue chez une référence et **absente** d'un écran de ce plan a sa décision écrite ici. Une
revue ne la compte donc pas comme un oubli.

| Capacité | Source | Décision | Raison | Dépendance |
|---|---|---|---|---|
| Corrélation erreurs ↔ Web Vitals **dans le temps** (pas seulement par release) | IP-Label, idée n° 5 (`iplabel.md` L379) | **Reprise** | « Charge, erreurs et LCP » (§ 5.1) : trois panneaux empilés, axe x partagé, mêmes annotations, aucun axe secondaire | `pageviewSeries`, `errorSeries` (F10) |
| Chargements initiaux vs changements de route SPA | Datadog « Initial page load vs SPA route changes » (`newrumperformanceimage.png`, `datadog-images-1.md` L87-95) | **Reprise, et mieux** | panneau (1) de « Charge, erreurs et LCP » (§ 5.1) et classement **par route** « Vues par type de navigation » (§ 5.2), avec la phrase « le LCP n'est mesuré qu'au chargement » (Datadog ne donne pas la route) ; population du LCP à revérifier dans le SDK au début de F15 (`packages/rum-sdk/src/vitals.ts:L5, L59`) | `vuesParNavType` (F15) |
| SLO et alerte au niveau d'un **parcours** (« journey-level ») | IP-Label (`iplabel.md` L166, L383) | **Reportée** | `slo_status()` ne connaît qu'une métrique × une route (`migration-v64.sql:247-295`) ; un SLO de parcours demande une métrique composée (étapes d'entonnoir) évaluée en base, et un entonnoir à étapes typées qui n'existe pas encore (B33) | B54 (migration), après B33 |
| Découpage par **type de réseau** (3G / 4G / 5G / Wi-Fi) | IP-Label (`iplabel.md` L326, L376) | **Reportée** | `rum_session.net_type` existe (`apps/ingest/sql/migration-v53.sql:L22`, `navigator.connection.effectiveType`, Chromium seulement) mais n'est ni une dimension du contrat ni de `vitalsBreakdown` | B8 (étendu à `net_type`) |
| Découpage par **opérateur / FAI** | IP-Label (`iplabel.md` L326, L376) | **Écartée par principe** | aucune adresse IP n'est stockée, sous aucune forme | — |
| **Click maps / scroll maps** | Datadog Heatmaps (`datadog-docs-product-analytics-mobile.md` L164-180) | **Écartée** | le SDK ne collecte ni coordonnées de clic ni profondeur de défilement hors rejeu (`grep -rln "clientX\|pageX\|scrollY" packages/rum-sdk/src` vide) ; dériver une carte des événements rrweb du rejeu échantillonné serait biaisé et hors de portée | — (collecte SDK à concevoir) |
| **Une bonne et une mauvaise session côte à côte** | Datadog « View sample » (`datadog-images-2.md` L398) | **Reportée** | le hero « À regarder d'abord » et le panneau session (§ 5.11) choisissent la session à lire ; une comparaison de deux rejeux n'a pas de question d'écran dans ce chantier, et l'échantillonnage biaisé-erreurs ne garantit pas une « bonne » session de la même route | — |
| Angle « **adoption** » de l'agent navigateur (postes gérés) | IP-Label (`iplabel.md` L390) | **Reprise en partie** | vue produit « Capteur extension » (§ 3.6) et onglet « Capteur » de « Qui sont ces sessions » (§ 5.11) ; un tableau d'adoption par version d'extension et par poste relève de `/admin/extension-installs` (hors périmètre) | — |
| Heatmap de la **distribution** du LCP dans le temps | Datadog (distribution + temps) | **Reportée** | `vitalHistogram` n'a pas de dimension temps (`lib/queries.ts:L96`) | B13 (requête) |
| Carte choroplèthe par pays | Datadog « Sessions by country » | **Écartée** | le format de `geo_country` selon sa provenance n'est pas établi ; un classement « Pays estimé » en barres suffit | — |
| Ville, région, profil d'utilisateur nommé, « Top users » | Datadog | **Écartée par principe** | aucune IP ni identité en clair ; le « top utilisateurs » par adresse n'est pas reproductible | — |
| Taux « sans crash » (crash-free) | Datadog Mobile | **Écartée** tant que le natif n'est pas collecté | aucune table de crash natif : « Non collecté », jamais 100 % | — |
| Export PNG / plein écran par widget | Datadog (trois icônes par widget) | **Reportée** | seule l'icône « Ouvrir dans l'Explorer » est reprise (§ 3.4) ; l'utilité des deux autres n'est pas établie | — |
| Vues partagées entre comptes | Datadog Saved Views | **Reportée** | `analytics_saved_view` n'enregistre qu'un AST, par compte et par app ; une vue personnelle se partage par son URL | B9 |
| Watchdog Insights, « cause suspectée » | Datadog | **Remplacée** | `InsightStrip` à règles publiées (§ 4.2) et P*.6 (sur-représentation avec test publié) ; la « cause » est écartée (§ 7.3) | B3 pour P*.6 |
| Résumé de session par modèle de langage | Datadog « AI summaries » | **Remplacée** | P*.9 : récit déterministe composé de faits, chaque phrase liée à un événement | — |
| Étapes d'entonnoir de type vue ou action | Datadog Funnels | **Reportée** | l'entonnoir ne prend que des événements custom | B33 |

### 1.8 Ce que la console fait déjà mieux, et qu'on garde

- Le **bandeau santé à formule affichée** (Vue d'ensemble) : aucune des trois références n'en a.
- **« Inconnu » groupe à part**, jamais versé dans une autre catégorie ; « Pays estimé » avec sa
  **provenance** ; identités jamais affichées ; recherche par identité absente par décision.
- **Échantillonnage dit sans extrapolation**, probabilité d'inclusion minimale écrite.
- **Règles de frustration chiffrées** écrites à l'écran (Datadog ne publie pas sa fenêtre de dead click).
- **Troncatures annoncées** (ressources > 300 ms, 20 par vue ; 200 routes ; 500 lignes de chronologie).
- **Explorer à exécution explicite** (URL = requête, budget qui refuse une série de zéros, dimensions
  indisponibles montrées avec leur raison).
- **Matrice de capacités mobile à trois états** et refus du mot « crash-free ».
- **Corrélation robot ↔ réel avec angles morts définis par une règle écrite** (Ekara n'en décrit aucune).
- **Causalité action → effets** et temps serveur corrélé sur la ligne d'un appel API dans la session.
- **Rejeu masqué par défaut** (saisies, texte, médias), masquage dit dans le lecteur.

---

## 2. Architecture d'information et navigation

### 2.1 Navigation avant (`components/nav-items.tsx:L20-106`, commit `322c9a7`)

| Catégorie (landing) | Sous-onglets |
|---|---|
| Performance (`/`) | Vue d'ensemble `/` · Pages lentes `/pages` · Erreurs JS `/errors` · Frustration `/ux` · Actions `/actions` · Événements `/events` · Explorer `/explorer` · Expérience `/experience` · Mobile `/mobile` |
| Sessions & traces (`/sessions`) | Sessions · Acquisition · Rétention · Parcours · Formulaires · Tracing · Carte · Corrélation |
| Objectifs & alertes (`/slo`) | Objectifs `/goals` · SLO · Alertes · Prévisions `/forecast` · Tableaux de bord `/dashboards` |
| Logs, Supervision SVI, Supervision IA | verrouillés (hors périmètre) |
| API et MCP | mono-page (hors périmètre) |

Défauts : neuf sous-onglets sous « Performance », qui défilent et se coupent à 390 px (« Fru… ») ;
« Objectifs » (conversions) rangé avec « SLO » (objectifs de service) sous un même mot ; la corrélation
robot ↔ réel, notre différenciateur face à IP-Label, est le 8ᵉ onglet d'une catégorie « Sessions » ; les
tableaux de bord sont rangés avec les alertes.

### 2.2 Navigation après

Cinq catégories ouvertes, chacune de 3 à 6 onglets : aucune barre de sous-onglets ne dépasse six
entrées.

| Catégorie | Icône | Landing | Sous-onglets (ordre) |
|---|---|---|---|
| **Performance** | `gauge` | `/` | Vue d'ensemble `/` · Pages `/pages` · Erreurs et issues `/errors` · Interactions `/ux` (onglets internes Frustration `/ux` / Actions `/actions`) · Satisfaction `/experience` · Mobile `/mobile` |
| **Robot et réel** | `compare` | `/correlation` | Corrélation synthétique ↔ RUM `/correlation` · Tracing `/tracing` · Carte `/map` |
| **Usages** | `users` | `/sessions` | Sessions `/sessions` · Parcours `/paths` · Conversions `/goals` · Formulaires `/forms` · Acquisition `/acquisition` · Rétention `/retention` |
| **Fiabilité** | `target` | `/slo` | SLO `/slo` · Alertes `/alerts` · Tendances `/forecast` |
| **Explorer** | `compass` | `/explorer` | Explorer `/explorer` · Journal `/events` · Tableaux de bord `/dashboards` |
| Logs · Supervision SVI · Supervision IA · API et MCP | inchangées | — | inchangées (hors périmètre) |

### 2.3 Décision écran par écran

| Écran (route) | Décision | Nouveau libellé / rattachement | Raison |
|---|---|---|---|
| Vue d'ensemble `/` | Garder | Performance, 1ᵉʳ onglet | écran d'atterrissage ; son bandeau santé à formule affichée est meilleur que Datadog et Ekara |
| Pages lentes `/pages` | Renommer | « Pages » | l'écran classe toutes les routes ; « lentes » présuppose le verdict que le tri par gravité établit |
| Erreurs JS `/errors` (+ `/errors/[fingerprint]`, `/errors/issues/[id]`) | Renommer | « Erreurs et issues » | `error_source` couvre réseau, CSP, console, Node, Python, React Native (`lib/queries-errors.ts:L40-51`) et les issues v2 vivent sous `/errors/issues` : « JS » est faux |
| Frustration `/ux` + Actions `/actions` | Fusionner (une entrée, deux onglets internes, deux routes gardées) | « Interactions » | les signaux de frustration sont des propriétés d'actions et l'INP mesure la réponse à une interaction : une seule question, « quels gestes échouent ou font attendre » |
| Événements `/events` | Déplacer + renommer | Explorer › « Journal » | journal filtrable (liste + facettes + tendance), le pendant « Lists » de l'Explorer Datadog ; il sert l'exploration |
| Explorer `/explorer` | Déplacer | catégorie Explorer, 1ᵉʳ onglet | destination commune de « Ouvrir dans l'Explorer » de chaque figure |
| Expérience `/experience` | Renommer | « Satisfaction » | l'écran lit des notes 1-5 et des verbatims ; « Expérience » désigne tout le produit |
| Mobile `/mobile` | Garder | Performance | ses angles morts (crash natif, ANR, démarrage natif : « Non collecté ») justifient un écran à part |
| Sessions `/sessions` + détail `/sessions/[id]` | Garder | Usages, landing | le détail reste une page (lien partageable) et s'ouvre aussi en panneau depuis les listes (§ 3.5) |
| Parcours `/paths` | Garder | Usages, 2ᵉ | Sankey + entonnoir : première question d'usage après la liste |
| Objectifs `/goals` | Déplacer + renommer | Usages › « Conversions » | objectifs de conversion (pageview / event), pas des objectifs de service |
| Formulaires `/forms` | Garder | Usages, 4ᵉ | — |
| Acquisition `/acquisition` | Garder | Usages, 5ᵉ | — |
| Rétention `/retention` | Garder | Usages, 6ᵉ | — |
| Corrélation `/correlation` | Déplacer + promouvoir | Robot et réel, landing | c'est la promesse Ekara « synthétique + RUM unifiés », avec des angles morts que nous définissons mieux |
| Tracing `/tracing` + détail | Déplacer | Robot et réel, 2ᵉ | répond à « la lenteur vient-elle du back ? », suite directe de la corrélation |
| Carte `/map` | Déplacer | Robot et réel, 3ᵉ | graphe front → back, même famille que le tracing |
| SLO `/slo` | Garder | Fiabilité, landing | — |
| Alertes `/alerts` | Garder | Fiabilité | — |
| Prévisions `/forecast` | Renommer | « Tendances » | ajustement linéaire sur 14 points quotidiens : une tendance, pas une prévision |
| Tableaux de bord `/dashboards` (+ `[id]`) | Déplacer | Explorer › « Tableaux de bord » | un tableau est une composition de requêtes de l'Explorer (widgets v2 = AST Explorer, `lib/dashboards.ts:L261-282`) |

### 2.4 Modifications exactes du code de navigation (lot F09)

**`components/nav-items.tsx`**

1. `NavLink` devient `{ href: string; label: string; sousOnglet?: boolean }` (défaut `true`). Un lien
   `sousOnglet: false` compte pour `activeCategory` mais n'est pas rendu par `SubNav`.
2. `CATEGORIES` : remplacer les trois premières catégories par les cinq du § 2.2, dans cet ordre, avec
   `domain: "perf"`. La catégorie Performance déclare `{ href: "/actions", label: "Actions",
   sousOnglet: false }` après `/ux` (l'onglet interne vit dans la page, § 5.4). Les catégories
   verrouillées et « API et MCP » ne changent pas.
3. `activeCategory` et `hrefMatches` ne changent pas (ils lisent tous les `children`, masqués compris).
   Test : `activeCategory("/actions")` rend « Performance » ; `activeCategory("/events")` rend
   « Explorer » ; `activeCategory("/goals")` rend « Usages » ; `activeCategory("/dashboards/abc")` rend
   « Explorer » (étendre le test existant de la navigation ou créer `tests/unit/nav-items.test.ts`).
4. Commentaires de tête : garder la justification de chaque écran (Explorer, Mobile) en la déplaçant à
   côté de sa nouvelle place.

**`components/SubNav.tsx`** : filtre `sousOnglet !== false` ; indicateur de débordement (dégradé à droite
+ `aria-hidden`) quand la rangée défile ; le lien actif est `aria-current="page"`.

**`components/Nav.tsx` et `SubNav.tsx`** : les liens portent `contextHref(pathname, sp)` (§ 3.1) pour
conserver population, plage et comparaison d'un écran à l'autre.

**`components/PageHeader.tsx`** : la table `DOMAIN` passe de `perf | ai` à six clés, et `sub` devient
obligatoire sur les écrans du périmètre (P1).

| Clé `domain` | Surtitre affiché | Écrans |
|---|---|---|
| `perf` | « Performance » | `/`, `/pages`, `/errors` (+ détails), `/ux`, `/actions`, `/experience`, `/mobile` |
| `robot` | « Robot et réel » | `/correlation`, `/tracing`, `/tracing/[traceId]`, `/map` |
| `usages` | « Usages » | `/sessions`, `/sessions/[id]`, `/paths`, `/goals`, `/forms`, `/acquisition`, `/retention` |
| `fiabilite` | « Fiabilité » | `/slo`, `/alerts`, `/forecast` |
| `explorer` | « Explorer » | `/explorer`, `/explorer/views`, `/events`, `/dashboards`, `/dashboards/[id]` |
| `ai` | « Intelligence artificielle » (inchangé) | hors périmètre |

Dans le § 5, « `domain="Explorer"` », « domain « Robot et réel » » ou « domain « Fiabilité » » désignent
ces clés (`explorer`, `robot`, `fiabilite`).

**Titres de page** (`title` du `PageHeader` et libellé de nav identiques) : « Vue d'ensemble », « Pages »,
« Erreurs et issues », « Interactions », « Satisfaction », « Mobile », « Corrélation synthétique ↔ RUM »,
« Tracing », « Carte », « Sessions », « Parcours », « Conversions », « Formulaires », « Acquisition »,
« Rétention », « SLO », « Alertes », « Tendances », « Explorer », « Journal », « Tableaux de bord ».

**Coquille (`app/layout.tsx`, `public/mip-rum-feedback.js`)** : le widget « Votre avis ? » est fixé à
20 px du bas et de la droite et masque du contenu sur les captures ; la coquille réserve 72 px en bas de
`main`, et sous 768 px le widget est configuré replié (F09).

**`components/InfoTip.tsx`** : bulle bornée à `max-width: calc(100vw - 2rem)` et positionnée au bord
(F09).

---

## 3. Conventions transverses

### 3.1 Barre de filtres et état d'URL

**Paramètres du contrat — les seuls qui changent une population.**
`CONTRACT_PARAMS = ["app", "period", "from", "to", "device", "bots", "internal", "seg", "browser", "os",
"env", "service", "release", "route", "country"]` (`lib/query-contract.ts:L506`) :

| Paramètre | Valeurs | Défaut (non écrit dans l'URL) | Source |
|---|---|---|---|
| `app` | identifiant d'app ou `all` | app courante du principal | `requestedAppOf` L182, `resolveScope` L192-203 |
| `period` | `1h` · `24h` · `7d` (`7j` toléré) | `24h` | `RANGE_PRESETS` L15, `queryToSearchParams` L633-634 |
| `from`, `to` | instants ISO UTC ; `from < to ≤ maintenant`, durée ≤ 30 j ; exclusifs de `period` | — | `resolveRange` L267-303 (refus `range_in_future` L284) |
| `device` | `desktop` · `mobile` · `tablet` | tous | `DEVICES` L71 |
| `bots`, `internal` | `1` = inclure | exclus | L518-519 |
| `browser`, `os`, `env`, `service`, `release`, `route`, `country` | texte ≤ 500 caractères | aucun | `PARAM_DIMENSIONS` L52 |
| `seg` | `v2:dim:op[:valeur];…` (`op` ∈ `eq`, `neq`, `is_null`, valeurs `encodeURIComponent`) | vide | `parseSegmentParam` L423-468, `serializeSegments` L470-480 |

Au plus 10 conditions (`MAX_CONDITIONS` L78). Un paramètre répété est refusé (`ambiguous_parameter`,
L515). Un drill-down qui ajoute une dimension utilise le **paramètre dédié** s'il existe (`route=/checkout`)
et `seg` sinon (`country_source`, `source`, `client`, et toute condition `neq` / `is_null`, par exemple
`seg=v2:browser:is_null` pour le groupe « Inconnu »).

**Paramètres d'écran existants — réutilisés tels quels** : `split` (dimension de découpage,
`BREAKDOWN_PARAM`, `lib/breakdowns.ts:L35`) ; `dataset`, `measure`, `prop`, `variant`, `g0`, `g1`, `viz`,
`limit`, `run`, `cursor` (Explorer, `lib/explorer-page-params.ts:L40`) ; `tab`, `at` (détail de session ;
`at` en millisecondes epoch) ; `span` (détail de trace) ; `hours=business` (heatmap) ; `weeks`
(rétention) ; `kind`, `name`, `attr_source`, `attr_key`, `attr_type`, `attr_value` (journal,
`app/events/page.tsx:L67-92`) ; `issue` (pré-remplissage d'une alerte depuis une issue, `app/alerts/page.tsx:L42-44`) ;
`form` (formulaires) ; `serie` (corrélation, format élargi ci-dessous) ; `qf`, `q` (recherche exacte de
sessions, `lib/sessions-search.ts`) ; `s1`…`s4` (étapes d'entonnoir).

**`fired` n'est pas un identifiant.** `app/alerts/page.tsx:L40-41` le lit comme un entier (`/^\d+$/`) et
l'affiche comme le **nombre** d'alertes déclenchées par « Évaluer maintenant » (« check_alerts()
exécutée : {fired} alerte(s) déclenchée(s). », L83-88) ; `app/alerts/actions.ts:L137` l'écrit
(`redirect(…&fired=${a + b})`, `a + b` = ce compte). Il n'est **jamais** réutilisé pour désigner un
événement : un lien vers un déclenchement précis porte `evt` (ci-dessous). F27 et F69 vérifient par
`grep` qu'aucun lien construit par le frontend ne contient `fired=`.

**Paramètres d'écran nouveaux — définis ici une fois pour tous** (module `lib/view-state.ts`, F06 ; les
paramètres propres à un écran y sont déclarés par le lot de cet écran) :

| Paramètre | Écran(s) | Valeurs | Défaut | Sens | Propagé à la navigation ? |
|---|---|---|---|---|---|
| `cmp` | tous | `prev` · `release` · `none` | `prev` sur les écrans de la catégorie Performance, `none` ailleurs | comparaison affichée (§ 3.2) | **oui** (`VIEW_CONTEXT_PARAMS`) |
| `rel_a`, `rel_b` | tous | libellés de release | règle du § 3.2 | releases comparées quand `cmp=release` | oui, avec `cmp` |
| `tri` | écrans de `TRIS_PAR_ECRAN` (ci-dessous) | valeurs de l'écran | défaut de l'écran | ordre des classements (P3) | non |
| `vital` | `/`, `/pages`, `/ux` | `LCP` · `INP` · `CLS` · `FCP` · `TTFB` | `LCP` | vital qui pilote un classement ou une distribution | non |
| `panel` | écrans à liste | `<type>:<identifiant encodé>`, `type` ∈ `route`, `error`, `issue`, `session`, `trace`, `event`, `action`, `noeud` (`noeud:<front\|back>:<route>`) | absent | panneau latéral ouvert (§ 3.5) | non |
| `vue` | écrans à `PresetBar` | `p:<clé>` (vue produit), `u:<index>` (vue personnelle) | absent | vue appliquée, affichée comme active (§ 3.6) | non |
| `evt` | `/alerts` | identifiant entier d'un `alert_event` | absent | met en évidence cet événement dans « À traiter » (contour, `aria-current="true"`, défilement) et sa piste dans la frise ; hors des 100 plus récents → ligne « Événement <id> hors des 100 plus récents » | non |
| `regle_metrique`, `regle_route`, `regle_seuil` | `/alerts` | valeur de `ALERT_METRICS` ou `event:<nom>` ; texte ≤ 500 ; nombre | absents | pré-remplissent le formulaire « Nouvelle règle » (`#nouvelle-regle`) ; le préfixe `regle_` évite `route`, qui est un paramètre du contrat et serait lu comme un filtre inapplicable puis propagé | non |
| `appel` | `/tracing` | `<méthode> <chemin>` (une espace, chemin sans origine) | absent | filtre « Traces les plus lentes » (T9) sur un appel ; lu par `lireAppel` (`lib/tracing-ancres.ts`) | non |
| `serie` | `/correlation` | `encodeURIComponent(app) + ":" + encodeURIComponent(route)` ; une valeur sans `:` (anciens liens) est lue comme une route | règle de CR7-a | couple app × route du hero | non |
| `avec` | `/sessions` | `erreurs` · `frustration` · `rejeu` | absent | restreint **la liste seule** (pas les KPI), dit au-dessus de la table | non |
| `voir` | `/sessions/[id]` | natures séparées par `,` (`vue`, `action`, `erreur`, `api`, `frustration`, `ressource`, `tache`, `evenement`) | toutes | filtre de la chronologie | non |
| `depuis` | `/paths` | route | absent | ancrage du Sankey « à partir de » (après B31) | non |
| `type` | `/ux` | `rage` · `dead` · `error` | tous | filtre le hero « Routes les plus frustrantes » sur un type de signal | non |
| `nouveaux` | `/errors` | `1` | absent | liste restreinte aux groupes apparus sur la période | non |
| `statut` | `/errors` (mode historique) | `open` · `resolved` · `ignored` · `regressed` | tous | filtre de statut de la liste (formulaire GET) | non |

**`TRIS_PAR_ECRAN`** (dans `lib/view-state.ts`) — une valeur de `tri` n'est acceptée que si l'écran la
déclare :

```ts
export type TriId = "gravite" | "volume" | "impact" | "statut" | "sessions" | "recent";
export const TRIS_PAR_ECRAN = {
  "/":           { valeurs: ["gravite", "volume", "impact"], defaut: "gravite" },
  "/pages":      { valeurs: ["gravite", "volume", "impact"], defaut: "gravite" },
  "/errors":     { valeurs: ["statut", "sessions", "recent"], defaut: "statut" }, // ordre SQL nommé (CP9)
  "/ux":         { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/experience": { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/mobile":     { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/map":        { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/explorer":   { valeurs: ["gravite", "volume"], defaut: "gravite" },
} as const satisfies Record<string, { valeurs: readonly TriId[]; defaut: TriId }>;
export function lireTri(pathname: string, sp: URLSearchParams): { tri: TriId; ignore: string | null };
```

`impact` n'est proposé qu'après B2 : avant, `tri=impact` est ignoré et signalé. Sur `/mobile`, sans `tri`,
le hero « Stabilité par release » garde l'ordre **fourni** (`ImpactTable tri="fourni"`, chronologie des
releases) — `fourni` n'est jamais une valeur d'URL.

**Règles.** (1) Un paramètre d'écran n'entre **jamais** dans `CONTRACT_PARAMS` ni dans `queryFingerprint`
(L692) : il ne change pas la population. (2) `contextSearchParams` (L658-662) est complété par
`contextHref(pathname, sp)`, qui reporte `CONTRACT_PARAMS` + `VIEW_CONTEXT_PARAMS = ["cmp", "rel_a",
"rel_b"]` ; `Nav` et `SubNav` l'emploient. (3) Un paramètre d'écran illisible (valeur inconnue, `tri` non
déclaré pour l'écran, `evt` non entier) est **ignoré et signalé** par une ligne « Réglage d'affichage
ignoré : … » (`role="note"`), jamais par un refus 400 : il ne touche pas aux chiffres. (4) `GlobalFilters`
et `SegmentBar` restent l'unique moyen d'éditer la population ; aucun formulaire de filtre propre à un
écran (le formulaire « Plateforme » de `/mobile` disparaît au profit de vues préréglées).

### 3.2 Comparaison temporelle

| Mode | Ce qui est comparé | Calcul | Affichage | Garde-fous |
|---|---|---|---|---|
| `cmp=prev` | même durée, immédiatement avant | `previousRange(range)` (L306-316) ; lectures `shift` (`vitalsP75(f, true)`, `overviewStats(f, true)` existent ; les autres sont à créer dans les lots) | tuiles : delta `relativeChange` (L313) + libellé visible « vs <plage précédente> » ; séries : seconde série grise pointillée, même largeur de seau, alignée **par rang de seau** | aucun delta si la période précédente n'est pas **complète** (`couverturePrecedente`, ci-dessous) ou si l'une des deux couvertures est sous `faibleSous` ; un delta de p75 est un écart de percentiles ; jamais de superposition de seaux de largeurs différentes |
| `cmp=release` | release B contre release A, **même fenêtre** | `comparaisonVersions(f, 12)` (`lib/queries-deploys.ts:L162`) pour le tableau ; séries = deux lectures intersectées `release=rel_a` / `release=rel_b` (dimension d'occurrence, `lib/query-compiler.ts:L69-78`) | `ReleaseCompare` (§ 4.2) ; séries en deux couleurs (orange = B, gris pointillé = A) | phrase obligatoire « même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte » ; sous 2 releases, mode désactivé avec sa raison |
| avant / après déploiement | ±2 h autour du dernier déploiement | `latestDeployImpact(f)`, `assessRegression` ratio 1,2 (`queries-deploys.ts:L61, L103`) | carte « Dernier déploiement » dans `InsightStrip` | règle affichée (« +20 % ou plus, ±2 h, filtres de population non appliqués ») et effectifs des deux côtés ; 0 page vue d'un côté → `null` (VM4, § 7.0.1) |

**Choix de `rel_b` et `rel_a`** (CP3 : `comparaisonVersions` trie par sessions, pas par date) :
`rel_b` = version du **dernier marqueur de déploiement** (`listDeploys(f, 20)[0].version`,
`queries-deploys.ts:L20-31`) si elle figure dans `comparaisonVersions`, sinon la release de plus grand
volume ; `rel_a` = version du marqueur précédent présente dans `comparaisonVersions`, sinon la deuxième
par volume. La règle appliquée est **écrite** sous le titre de la comparaison (« 1.4.2 : dernier
déploiement déclaré ; 1.4.1 : déploiement précédent »). Fonction pure `choisirReleases(deploys,
versions)` dans `lib/presets.ts` (F08), testée.

**Seuil relatif d'une alerte de régression de release** : +20 % par défaut, aligné sur
`assessRegression` (ratio 1,2) ; la valeur « 10 % » attribuée à Ekara n'est pas reprise (rapportée,
non vérifiée). L'évaluation côté base est B52.

**Couverture de la période précédente (`couverturePrecedente`).** Calculée **côté serveur** par
`lib/comparaison.ts` (F06) et passée à `KpiTile` (§ 4.2) et à toute série de référence :

```ts
export type CouverturePrecedente = {
  etat: "complete" | "partielle" | "inconnue";
  raison: string | null;   // obligatoire si etat !== "complete"
  n?: number | null;       // effectif de la période précédente (règle d'échantillon faible)
};
export async function couverturePrecedente(query: AnalyticsQuery, source: {
  table: string;                 // « rum_metric », « rum_session », « rum_event », « rum_error »…
  colonneTemps: string;          // « ts », « started_at »
  colonneRequise?: string;       // colonne ajoutée par une migration (ex. « browser », v75)
  additive: boolean;             // compte (sensible au retard d'ingestion) ou non
}): Promise<CouverturePrecedente>;
```

Règles, dans l'ordre (la première qui s'applique gagne) :

1. **Rétention** : si `previousRange.from < to − RETENTION_DAYS` (défaut 30 jours,
   `lib/queries-explorer.ts:L87`), `partielle`, raison « période précédente hors rétention (30 jours) : les
   données les plus anciennes ont été purgées ». On réutilise la fonction `couverture(query)` de
   `lib/queries-explorer.ts:L179-186` (exportée sous le nom `couvertureRetention`), qui produit déjà ce
   texte pour l'Explorer. **Conséquence : une plage personnalisée de 30 jours n'affiche jamais de delta.**
2. **Début de collecte** : une requête `debutCollecte(f, source)` lit `min(colonneTemps)` de la table pour
   les apps du périmètre (et `where colonneRequise is not null` si fournie). Si ce minimum est postérieur
   à `previousRange.from`, `partielle`, raison « <signal> collecté depuis le JJ/MM HH:MM UTC seulement ».
   Cas particulier : `rum_session.sample_rate` vaut 1 par défaut sur les lignes antérieures à v58
   (09/09/2026, `migration-v58.sql:L26, L65`) ; pour lui, la date de référence est le 09/09/2026 00:00 UTC.
3. **Retard d'ingestion** : si la mesure est additive, que la fenêtre courante se termine à moins de
   5 minutes de maintenant et dure 1 heure ou moins (`period=1h`), `partielle`, raison « période en cours :
   les derniers événements arrivent encore ; un delta serait faussement négatif ». Au-delà d'une heure,
   l'effet (quelques minutes) reste sous 1 % de la fenêtre : non traité, dit dans la bulle d'aide.
4. **Lecture en échec** de `debutCollecte` → `inconnue`, raison « début de collecte non lu ».
5. Sinon `complete`.

Si `etat` n'est pas `complete`, **aucun delta** ; la tuile écrit « période précédente incomplète :
<raison> ». Tests (`tests/unit/comparaison.test.ts`, `tests/integration/comparaison-sql.test.ts`) : plage
personnalisée de 30 jours → `partielle` (rétention) et aucun delta rendu ; app dont la première mesure
date d'hier sous `period=7d` → `partielle` (début de collecte) ; `period=1h` sur un compte → `partielle` ;
`period=24h` avec historique complet → `complete`.

### 3.3 Drill-down : destination et paramètres

Tout lien est construit par `hrefWithQuery(pathname, query, extra)` : il garde population et plage.
Ajouter une condition de release ou de route à une lecture passe par
`intersectQuery(query, { conditions: [...] })` (`lib/query-contract.ts:L613-622`).

| Élément cliqué | Destination | Paramètres ajoutés | Remarque |
|---|---|---|---|
| Barre / ligne d'un classement par **route** | écran courant, panneau route | `panel=route:<route>` | la page `/pages?route=<route>` reste accessible par « Ouvrir en page » |
| Barre / ligne d'un classement par **autre dimension** (navigateur, OS, pays estimé, appareil, release) | écran courant **filtré** | paramètre dédié (`browser=…`) ou `seg` ; groupe « Inconnu » → `seg=v2:<dim>:is_null` | même règle que `breakdownDrillHref` |
| Seau d'une série temporelle (point, barre, case de frise d'états) | écran courant zoomé | `from` / `to` = bornes UTC du seau ; `period` retiré | clic inactif (avec `title`) si le seau fait moins de 5 min, plus petit seau du contrat |
| Annotation de déploiement | écran courant | `cmp=release&rel_b=<version>&rel_a=<version précédente>` | libellé du lien : « Comparer <v> à <v-1> » |
| Annotation d'alerte | `/alerts?evt=<id d'alert_event>` | — | **`fired` est déjà le compte d'alertes déclenchées par « Évaluer maintenant » : ne pas le réutiliser comme identifiant** ; l'écran met l'événement en évidence (§ 3.1) |
| Bac d'un histogramme de valeurs | **non cliquable** | — | le contrat ne filtre pas sur une valeur de mesure (11 dimensions, `query-contract.ts:L31-48`) ; le dire dans l'alternative. Lien secondaire « Voir les mesures dans l'Explorer » (journal `viz=table`, **ordonné par date** — le tri par valeur n'existe pas : backend manque, le curseur du journal est `(ts, key)`, § 5.21 W-E6) |
| Groupe d'erreurs / issue | panneau `panel=error:<fingerprint>` ou `panel=issue:<id>` | — | page `/errors/[fingerprint]` via « Ouvrir en page » |
| Session (ligne, verbatim, occurrence) | panneau `panel=session:<id>` | — | page `/sessions/[id]` ; rejeu : `/sessions/[id]?tab=replay&at=<ms>` |
| Trace (ligne, appel API) | `/tracing/[traceId]` | `span=<spanId>` si connu | le détail n'applique aucun filtre (`surfaces.ts:L90`) |
| Nœud de la carte | panneau `panel=noeud:<front\|back>:<route>` | — | une même route peut exister côté front et côté back |
| Case de heatmap (jour × heure, fuseau de l'app) | écran courant | `from` / `to` = **instants UTC** de l'heure locale de la case, calculés par le serveur (`bornesHeureLocale(jour, heure, tz)`, `lib/fuseau.ts`) | la case vide est inactive (« aucune donnée ») ; l'écran d'arrivée affiche les deux fuseaux (« 09:00-10:00 Europe/Paris (07:00-08:00 UTC) ») ; test : Europe/Paris, case 9 h un jour d'été → `from=…T07:00:00Z` |
| Point quotidien (Tendances, carte « Trafic » d'un tableau de bord) | écran cible | `from` / `to` = instants UTC du début du jour local et du lendemain (`bornesJourLocal(jour, tz)`) | le 10/09 à Paris en été → `from=2026-09-09T22:00:00Z&to=2026-09-10T22:00:00Z` |
| KPI (tuile) | écran spécialisé de la mesure | ex. occurrences → `/errors` ; LCP → `/pages?vital=LCP` | la tuile est un lien entier, un seul arrêt de tabulation |
| « Ouvrir dans l'Explorer » (en-tête de figure) | `/explorer` | `dataset`, `measure`, `variant`, `g0`, `viz`, `run=1` via `explorerHref` (`explorer-page-params.ts:L130`) | seulement pour une figure exprimable en AST Explorer ; sinon l'icône n'apparaît pas |
| Élément de synthèse robot | `/correlation?serie=<app>:<route>` | — | P12 |

### 3.4 Destination « Explorer » depuis une figure

Chaque `Figure` accepte `explorer?: string` (href calculé côté serveur). Le rendu est une icône-lien
« Ouvrir dans l'Explorer » dans l'en-tête de figure (Datadog : trois icônes par widget ; seule celle-ci
est reprise, § 1.7).

### 3.5 Panneau latéral de détail

- **Ouverture** par l'URL (`panel=…`) : rendu serveur, partageable, fonctionnel sans JavaScript.
- **Largeur** : 50 % de la zone de contenu à partir de 1280 px (la liste reste lisible ; Datadog en
  recouvre 60-70 %) ; plein écran de 390 à 1279 px, bouton « Fermer » en tête.
- **En-tête** : type (badge), titre, puces « qui / sur quoi / où » (appareil, navigateur, pays estimé
  **avec sa provenance**, route, release), liens « Ouvrir en page » et « Fermer ».
- **Onglets comptés** : chaque onglet porte son compte avant le clic (« Erreurs (3) ») ; compte inconnu →
  « (—) », jamais « (0) ».
- **Navigation** : liens « précédent / suivant » dans la liste courante ; raccourcis ↑ / ↓ / Échap par
  un îlot client minime (`DetailPanelKeys`).
- **Pas de fenêtre de temps propre au panneau** : il lit la plage de l'écran, et le dit (contre-exemple
  Datadog : deux fenêtres de temps sur le même écran).
- **Situer l'élément dans sa population** : quand le panneau montre une valeur (LCP d'une vue, durée
  d'une action), il la place sur la distribution de la **même route, même fenêtre**, population nommée.
  **Exception déclarée** : le détail de session (§ 5.12) n'a pas de fenêtre de contrat ; sa distribution
  porte sur une fenêtre **ancrée sur la session**, `[started_at − 7 j, min(started_at + 1 j, maintenant))`
  en UTC, calculée par `fenetreDeSession(startedAtMs, nowMs)` (`lib/deroule.ts`), dates écrites en méta —
  sinon une session ancienne serait comparée à une population qui ne la contient pas.

### 3.6 Vues préréglées (à la IP-Label)

- **Emplacement** : une rangée `PresetBar` sous `SegmentBar`, sur Vue d'ensemble, Pages, Erreurs et
  issues, Interactions, Sessions et Mobile.
- **Vues produit** (lecture seule, calculées, préfixe `p:`) : « Mobile » (`device=mobile`), « Desktop »
  (`device=desktop`), « Dernière release » (`release=<rel_b du § 3.2>`), « Nouvelle release vs
  précédente » (`cmp=release`), « Pire navigateur » (`browser=<navigateur en tête du tri gravité LCP>`,
  affichée seulement si ≥ 30 mesures), « Pays estimé : <premier pays en volume> », « Capteur extension »
  (`seg=v2:source:eq:extension`, `/sessions`). Sur `/mobile` : `p:ios` (`os=iOS`), `p:android`
  (`os=Android`), `p:mobile-derniere-release` (`release=<release la plus récente des déclarations>`) —
  seules dimensions de cette surface, valeurs exactes de `PLATFORM_OS` (`lib/mobile-capabilities.ts:L189`).
  Une vue produit sans donnée pour se calculer est **affichée désactivée avec sa raison** (« moins de deux
  releases sur la fenêtre »).
- **Vues personnelles** (`u:`) : les segments enregistrés existants (`SAVED_SEGMENTS_KEY =
  "mip-saved-segments-v2"`, `query-contract.ts:L722-741`), stockés dans le navigateur ; nom par défaut
  composé des facettes jointes par « • », modifiable par un champ en ligne (remplace `window.prompt`,
  `SegmentBar.tsx:152`).
- **Partage entre comptes** : non couvert (B9) ; une vue personnelle se partage par son URL.
- Appliquer une vue ne touche qu'aux paramètres du contrat (+ `cmp`) ; la vue active est marquée
  (`aria-pressed`) tant que l'URL correspond exactement.

### 3.7 Annotations

- **Déploiements** : `listDeploys(f, 20)` (`queries-deploys.ts:L20-31`) lit la portée sans fenêtre (20
  derniers marqueurs) : les annotations sont **filtrées côté serveur** sur `[from, to)`. Sous plage
  personnalisée, les 20 derniers peuvent ne pas couvrir la plage : tant que B1 n'est pas livré, la figure
  écrit « déploiements non affichés sur une plage personnalisée (lecture non migrée) »
  (`annotationsIndisponibles`).
- **Alertes** (F67) : déclenchements d'`alert_event` filtrés par route et plage, lien `/alerts?evt=<id>`.
- **Anomalies** (P*.3) et **ruptures** (P*.7) : lien vers la plage du jour concerné.
- **Rendu** : trait vertical fin `ink-soft`, étiquette en haut (« v1.4.2 »), triangle cliquable ; plus
  de 6 annotations dans la fenêtre → regroupement « N déploiements » dont le clic ouvre la liste.
- **Type** : `Annotation` (§ 4.2) ; construction pure dans `lib/annotations.ts` (F08, F67).

### 3.8 États standard

Un seul vocabulaire, porté par `EtatSurface` (§ 4.2) et par des frontières Next par route.

| État | Quand | Texte type | Composant |
|---|---|---|---|
| `chargement` | lecture en cours | squelette à la taille de la figure, `aria-busy`, texte sr-only « Chargement de <titre> » | `loading.tsx` de route + `<Suspense>` par section |
| `vide` | lecture réussie, compteur réellement 0 | « Aucune <population> sur <plage> » + geste utile (élargir la plage, retirer un filtre) | `EtatSurface kind="vide"` |
| `partiel` | lecture réussie mais incomplète (troncature, rétention, jeu non projeté, filtre non appliqué, lecture historique) | « Partiel : <raison> » | `EtatSurface kind="partiel"` au-dessus de la figure |
| `erreur` | la lecture a levé une exception | « La lecture de <titre> a échoué. Les autres blocs restent valides. » + « Réessayer » | `SectionErreur` (frontière client, `router.refresh()`) et `error.tsx` de route |
| `non_collecte` | la capacité n'existe pas (table absente, SDK qui n'émet pas) | « Non collecté : <ce qui manque> » | `EtatSurface kind="non_collecte"` |
| `echantillonne` | probabilité d'inclusion < 1 ou inconnue dans la population | « Échantillonné : chaque <unité> avait au moins <p> % de chances d'être retenue ; comptes observés, non extrapolés. » | `EtatSurface kind="echantillonne"` (`role="note"`) |
| `refuse` | filtre ou périmètre refusé | message du contrat + lien de reprise | `FilterProblemNotice` (existe) |
| `ferme` | capacité annoncée, accès non ouvert | existant | `CapaciteFermee` (existe) |
| `compose_vide` | tous les blocs éteints | existant | `TousEteints` (existe) |

Règles : (1) une section en erreur n'empêche pas les autres de s'afficher (fin du `Promise.all` global
de `app/page.tsx:L81-94`) ; (2) les fonctions `softFail` cessent d'avaler l'erreur : elles la relancent,
et c'est la section qui décide (F02) ; (3) chaque route du périmètre a un `error.tsx` en français et un
`loading.tsx` ; (4) `not-found.tsx` en français pour `/errors/[fingerprint]`, `/errors/issues/[id]`,
`/sessions/[id]`, `/tracing/[traceId]`.

### 3.9 Accessibilité et largeurs

- Contrôles natifs labellisés ; un seul arrêt de tabulation par élément de données (la barre **est** le
  lien, `Breakdown.tsx:L4-9`) ; anneau `ring-perf` visible.
- Toute figure : `role="img"` + `aria-label` paramétré (« LCP p75 par heure, 24 h, 3 zones de seuil ») et
  `<details>` « Alternative textuelle » (table avec `<caption>` et `<th scope>`), mêmes lignes que le dessin.
- Aucune information portée par la seule couleur : verdict en texte (`RATING_LABEL`) à côté de la teinte ;
  séries distinguées aussi par le trait (plein / pointillé) ; sévérités doublées d'un motif.
- **Contraste** : le texte de moins de 18 px passe de `ink-faint` (≈ 2,8:1 en clair) à `ink-soft`
  (≈ 6,5:1) pour titres de figure, en-têtes de table et légendes ; `ink-faint` reste décoratif. Le
  contraste est **mesuré** par `@axe-core/playwright` (règle `color-contrast`, seuil 4,5:1 sur les paires
  texte), intégré à l'e2e de capture claire / sombre de F01.
- Largeurs vérifiées : 390, 768 (coquille mobile, sans sidebar), 1440 (sidebar 256 px, ≈ 1 150 px utiles).
- Tables à 390 px : enveloppe `overflow-x-auto`, première colonne `sticky left-0` (légitime pour le helper
  `debordements` : un élément dans un conteneur défilant n'est pas un débordement).
- `prefers-reduced-motion` respecté (aucune animation de série) ; mode sombre : les graphiques lisent les
  variables CSS (`globals.css:L156-178`).

### 3.10 Séries temporelles : grille, trous, empilement

- **Grille obligatoire.** Les lectures `vitalSeries`, `dailyLcpSeries`, `correlationSeries` ne renvoient
  que les seaux non vides : `recharts` relierait alors deux points séparés par une absence. Toute série
  est donc **alignée** sur la grille des débuts de seau attendus (`bucketStarts(range)`,
  `lib/query-contract.ts:L241-250`) par `alignerSeaux` (`lib/series.ts`, F04) avant d'être passée à
  `ThresholdSeries` ou `StackedBars`, qui reçoivent cette grille en prop.
- **Seau absent** : trou (segments séparés) pour une mesure non additive ; `0` seulement pour une série
  déclarée additive (compte) — jamais inventé autrement.
- **Effectif par seau** : une série peut déclarer la clé de son effectif (`effectifCle`) ; un seau sous
  `faibleSous` (défaut 30) est un point creux, légende « moins de 30 mesures ».
- **Seau de bord partiel** (le seau en cours) : dernier point creux + légende « seau en cours ».
- **Au plus 5 séries** par graphique (P14) ; au-delà, l'appelant passe à un classement.
- **Tout empilement additif passe par `StackedBars`** ; `ThresholdSeries` n'empile jamais.
- **Projection** (Tendances) : série de rôle `projection` (points après `to`, pointillé) et bande
  d'incertitude (`bande`).
- Plusieurs panneaux qui partagent l'axe x utilisent la même grille, la même largeur de seau et les mêmes
  marges (`SERIE_MARGES`, exporté par `ThresholdSeries`).

### 3.11 Rafraîchissement automatique

`AutoRefresh` (`components/AutoRefresh.tsx:L12-32`, monté dans `app/layout.tsx:L210`) rafraîchit toutes
les routes toutes les 5 s (CE10) : un Explorer exécuté relance sa requête et un classement bouge sous le
curseur. F09 ajoute `SANS_RAFRAICHISSEMENT`, exporté par `lib/surfaces.ts` : égalité exacte pour
`/explorer`, `/explorer/views`, `/dashboards` ; préfixe `/dashboards/` pour le détail. `AutoRefresh` lit
`usePathname()` et s'arrête sur ces routes, qui affichent « Lu à HH:MM:SS UTC » + bouton « Relire »
(`router.refresh()`) ; la pastille « LIVE · 5 s » de `GlobalFilters` y devient « Lecture à la demande ».
Test (étendre `tests/unit/surfaces.test.ts`) : `/dashboards/abc` et `/dashboards` exclus, `/errors` non
exclu.

### 3.12 Rangées de KPI

- Une rangée = une population. Vitals (mesures), trafic (sessions, vues), erreurs (occurrences,
  sessions) ne partagent jamais une tuile ni un axe.
- Chaque `KpiTile` porte `reference` en toutes lettres : `cmp=prev` → « vs 24 h précédentes (20/09 14:00 →
  21/09 14:00 UTC) », texte calculé par `rangeLabel(previousRange(range), "UTC")` ; `cmp=release` → « vs
  release 1.4.1 (même fenêtre) » ; `cmp=none` → pas de delta, pas de `reference`.
- `sensMeilleur` : `"bas"` pour vitals, occurrences, parts d'erreur, signaux ; `"haut"` pour CSAT,
  conversion, sessions sans erreur ; `"neutre"` pour sessions, vues, avis reçus (un volume n'est ni bon
  ni mauvais).
- `couverture.faibleSous` : 100 pour un vital (reprise de `VitalCard.tsx:L55`), 30 pour un taux par
  segment (P3), 10 pour les avis (volumes structurellement faibles ; « échantillon faible » s'affiche,
  rien n'est masqué).
- Un ratio « pour 100 » s'affiche au format `pour100` et un ratio décimal au format `ratio`, jamais au
  format `pct` : un pourcentage se lit comme une part, un ratio d'occurrences n'en est pas une.

---

## 4. Bibliothèque de composants

Règle : **un nom, une signature** par composant dans tout ce plan. Les écrans du § 5 n'emploient que les
props déclarées ici ; un besoin nouveau se déclare ici d'abord. Les props optionnelles marquées d'un lot
(ex. « P*.1 ») sont déclarées dès la création du composant, mais ne sont alimentées qu'à partir de ce lot.

### 4.0 Types partagés et formats

```ts
// lib/fmt-ids.ts (F03) — réutilise lib/format.ts
export type FormatId =
  | "ms"       // 820 → « 820 ms » ; 2 700 → « 2,7 s »
  | "s-auto"   // durée en ms : 372 000 → « 6 min 12 s »
  | "cls"      // 0,0312 → « 0,031 »
  | "pct"      // part 0..1 : 0,124 → « 12,4 % »
  | "count"    // 1240 → « 1 240 »
  | "bytes"    // 18 432 → « 18 Ko »
  | "score"    // 0..100 → « 72 »
  | "ratio"    // 3 → « 3,00 » (deux décimales ; un ratio n'est pas une part)
  | "pour100"; // 150 → « 150 pour 100 » ; 2,43 → « 2,4 pour 100 » ; jamais « % »
export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
export function formater(id: FormatId, v: number | null): string; // null → « — »
```

Le libellé de la tuile nomme le dénominateur d'un `pour100` (« Occurrences d'erreurs pour 100 pages
vues »). Test `tests/unit/fmt-ids.test.ts` : `formater("pour100", 150)` ne contient pas « % » ;
`formater("pct", null)` = « — » ; `formater("ratio", 3)` = « 3,00 ».

### 4.1 Composants existants : ce qu'on leur change

| Composant (fichier) | Changement | Lot |
|---|---|---|
| `PageHeader` (`components/PageHeader.tsx:13-27`) | `domain` à six clés (§ 2.4) ; `sub` obligatoire sur les écrans du périmètre (P1) | F09 |
| `SupervisionHero` | `state?: Etat` rendu à la place du graphe ; `explorer?: string` | F02 |
| `HeroStat` | remplacé à l'usage par `KpiTile` ; conservé pour compatibilité, couleurs passées aux jetons | F01, F03 |
| `DeltaBadge` | texte visible « vs <référence> » (prop `reference: string`) | F03 |
| `VitalCard` (`components/VitalCard.tsx:57-110`) | `periodLabel` obligatoire ; `serie?: (number \| null)[]` (sparkline) ; `href?` ; alternative textuelle de sa jauge interne `ThresholdMeter` (`:29`, rendue `:96`) ; `intervalle?` (même type que `KpiTile.intervalle`) et moustache sur la jauge (P*.1, incrément 0-b) | F03, P*.1 |
| `GlobalFilters` (`components/GlobalFilters.tsx:55`) | **exporter** `Segmented` (`:448`) et `Chip` (`:410`) ; ajouter `CompareToggle` à droite des presets ; pastille « Lecture à la demande » sur les routes sans rafraîchissement (§ 3.11) | F06, F09 |
| `SegmentBar` (`components/SegmentBar.tsx:63`) | nom de segment par champ en ligne (fin de `window.prompt`, `:152`) ; bascules « Bots exclus » / « Interne exclu » sans émoji | F08 |
| `Breakdown` (`components/Breakdown.tsx:40-211`) | prop `tri: "gravite" \| "volume"` + bascule ; colonne « écart à l'ensemble » ; prop `onglets?: BreakdownTab[]` qui remplace la liste par défaut (la liste des sessions ajoute l'onglet `source`, « Capteur », sans toucher `BREAKDOWN_DIMENSIONS`) ; reste la référence de la grammaire « barre = lien + table repliée » | F05 |
| `Histogram` (`components/Distribution.tsx:86`) | remplacé à l'usage par `DistributionSeuils` ; conservé | F05 |
| `PercentileTable` (`components/Distribution.tsx:23`) | `<th scope>` ; colonne n | F05 |
| `RankBar` (`components/charts/RankBar.tsx:34`) | inchangé dans ses props (`RankDatum` : `label`, `value`, `display`, `color`, `sub`, `href`, `segments`, `title`) ; ajoute l'alternative textuelle intégrée, `labelWidth` réduite à `7rem` sous 640 px, couleur par défaut depuis `lib/palette.ts` | F03 |
| `VitalsTimeseries` | devient une enveloppe de `ThresholdSeries` | F04 |
| `TrafficTimeseries` | double axe supprimé : un `StackedBars` (vues) et une `ThresholdSeries` (occurrences) empilés, axe x partagé | F04 |
| `ForecastChart` | `format: FormatId` au lieu d'une fonction (F55, en urgence) ; retrait de `connectNulls` ; supprimé quand `/forecast` passe sur `ThresholdSeries` (F65) et que plus rien ne l'importe | F55, F65 |
| `HealthHeatmap` (`components/charts/HealthHeatmap.tsx:55`) | échelle **`SEQUENTIELLE`** (plus de vert / ambre / rouge ; les seuils 0,9 / 0,5 n'ont pas de source), légende « % de mesures Bon (pondéré) », valeur exacte de chaque case dans l'alternative tabulaire ; cases cliquables dont le `href` est calculé côté serveur (`bornesHeureLocale`, § 3.3) et atteignables au clavier (une rangée = un groupe de liens) ; case vide inactive | F05 |
| `Donut` (`components/charts/Donut.tsx:34`) | `ariaLabel` ; part inconnue nommée ; refus d'emploi pour `avg` / `p75` / `distinct` documenté ; parts à 0 **affichées** dans la légende | F03 |
| `ScatterPlot` (`components/charts/ScatterPlot.tsx:38`) | signature unifiée au § 4.2 | F03 |
| `StackedBars` (`components/charts/StackedBars.tsx:23`) | signature unifiée au § 4.2 (grille, annotations, séries cliquables, tons de sévérité) | F04 |
| `LineTrend` (`components/charts/LineTrend.tsx:26`) | prop `series?: { cle: string; libelle: string; role: SerieDef["role"] }[]` (≤ 5) en plus de `valueName` ; alternative via `Figure` | F03 |
| `RadarScore` | `role="img"` + `ariaLabel` ; plus utilisé par Satisfaction (§ 5.5) | F03 |
| `GroupSparkline` (`components/errors/GroupSparkline.tsx:10`) | remplacé par `Sparkline` | F03 |
| `HealthBanner` (`components/health/HealthBanner.tsx:82`) | anneau en jetons (le bleu ciel `#0ea5e9` sort) ; `role="img"` + `aria-label` ; prop `compact?: boolean` (une ligne de facteurs, `detail` **visible** sous chaque barre, pas en `title`) ; facteur `earned: null` → « n/a » + raison ; libellé de facteur jamais tronqué à 390 px | F01, F11 |
| `VersionsTable` | inchangé ; ouvert depuis `ReleaseCompare` (« Toutes les versions ») | — |
| `FilterProblemNotice`, `CapaciteFermee`, `TousEteints`, `ExperienceUnavailable` | rendus par `EtatSurface` (même texte) | F02 |
| `InfoTip` (`components/InfoTip.tsx:9`) | `max-width: calc(100vw - 2rem)`, positionnement au bord | F09 |
| `TabLink` (`components/sessions/TabLink.tsx`) | prop `compte?: number \| null` (`null` → « (—) ») | F44 |
| `Timeline` / `TimelineRow` (`components/sessions/Timeline.tsx`) | inchangés ; `TimelineRow` est réutilisé par `Deroule` | — |
| `Sankey` (`components/Sankey.tsx`) | props `{ model: SankeyModel; ancre?: string \| null; hauteur?: number }` ; total écrit sur chaque nœud ; hauteur 120 px + 36 px par nœud (plafond 380) ; couleurs neutres (nœuds `ink-soft`, rubans `SERIE.principale` à 30 %) | F50 |
| `FunnelChart` (`components/Funnel.tsx:55-86`) | deux taux nommés par étape (« de l'étape précédente », « du départ ») ; plus forte perte encadrée ; abandon en jeton `bad` ; alternative textuelle | F50 |
| `ExperienceMap` (`components/map/ExperienceMap.tsx`) | type `Health` étendu à `"unknown"` ; nœud « Autres routes (N) » qui reçoit les arêtes masquées ; santé écrite dans le nœud | F52 |
| `ReplayPlayer` (`components/replay/ReplayPlayer.tsx:30-185`) | props `{ sessionId: string; atMs: number \| null; marqueurs: Marqueur[]; onTemps?: (ms: number) => void }` (client : `onTemps` n'est passé que par l'îlot `ReplaySynchro`) ; vitesses 1× / 2× / 4× ; « Réessayer » sur erreur ; bandeau de couverture « 2 minutes ou 1 Mo compressé, 30 jours » | F47 |
| `WidgetChart` (`components/dashboards/WidgetChart.tsx`) | retiré au profit de `ResultatAnalyse` | F36 |
| `LongtasksView`, `ResourcesView` | `SectionErreur` ; p75 du blocage en panneau empilé (tâches longues) | F16 |
| `IssueList` (`components/errors/IssueList.tsx`) | `Sparkline` à échelle commune (`max` partagé) ; cartes à 390 px | F19 |
| `DeployPanel` (`components/tracing/DeployPanel.tsx`) | sans déploiement : `EtatSurface non_collecte` au lieu de `return null` (`:16`) | F60 |
| `SloStatusRow` (`components/slo/SloStatusRow.tsx`) | types `attainment: number \| null`, `fast_burn: boolean \| null` ; colonnes Route et Alertes sur 7 j | F55, F63 |
| `RuleFields` (`components/alerts/RuleFields.tsx`) | `<fieldset>` par mode (seuil, baseline, régression de release désactivée avant B52), masquage par `:has(input[value=…]:checked)` | F64 |
| `ShareBar` (`components/tracing/ShareBar.tsx`) | inchangé ; utilisé aussi dans le hero de `/tracing` | — |

### 4.2 Composants transverses à créer (ou à réécrire)

#### `EtatSurface` — `components/states/EtatSurface.tsx` (SSR, F02)

```ts
export type Etat =
  | { kind: "vide"; population: string; plage: string; geste?: { libelle: string; href: string };
      borne?: string }                       // P*.2 : « Aucune erreur sur 210 sessions… exclut, à 95 %… »
  | { kind: "partiel"; raison: string }
  | { kind: "erreur"; titre: string; digest?: string }
  | { kind: "non_collecte"; manque: string }
  | { kind: "echantillonne"; probaMin: number | null; unite: string; biaiseErreurs?: boolean;
      sansTaux?: number }
  | { kind: "chargement"; titre: string };
export function EtatSurface(props: { etat: Etat; compact?: boolean }): JSX.Element;
```
- `echantillonne` avec `probaMin: null` → « probabilité d'inclusion inconnue », jamais « 100 % » ;
  `biaiseErreurs` → « les sessions avec erreur sont sur-représentées : une part de sessions en erreur
  calculée ici est surestimée » ; `sansTaux > 0` → « N sessions commencées avant le 09/09/2026 :
  probabilité d'inclusion non enregistrée ».
- `non_collecte` ne porte jamais de `borne` (rien n'est collecté, rien n'est borné).
- `erreur` ne contient pas le bouton (il vit dans `SectionErreur`).
- `role="status"` (chargement, vide), `role="note"` (partiel, échantillonné, non collecté), `role="alert"`
  (erreur).

#### `SectionErreur` — `components/states/SectionErreur.tsx` (client, F02)

```ts
export function SectionErreur(props: { titre: string; children: React.ReactNode }): JSX.Element;
```
Frontière d'erreur React autour d'une section ; rend `EtatSurface{kind:"erreur"}` + bouton « Réessayer »
(`router.refresh()`) ; n'affiche aucune valeur partielle de la section.

#### `lire` — `lib/lecture.ts` (serveur, F02)

```ts
export type Lecture<T> = { ok: true; data: T } | { ok: false; raison: string };
export async function lire<T>(fn: () => Promise<T>): Promise<Lecture<T>>;
```
Remplace les `softFail(e, [])` : une section reçoit `Lecture<T>` et choisit entre donnée et état
`erreur`. Journalise l'erreur côté serveur (même canal que `lib/log-forward.ts`).

#### `Figure` — `components/charts/Figure.tsx` (SSR, F03)

```ts
export interface AlternativeTexte {
  legende: string;                      // <caption>
  colonnes: string[];                   // en-têtes, la 1re = libellé de ligne
  lignes: (string | number | null)[][]; // null → « — »
}
export function Figure(props: {
  titre: string;                        // question courte ou mesure, jamais du langage de requête
  aide?: GlossaryId;
  meta?: React.ReactNode;               // effectif, plage, seau, « approché », troncature (P11)
  etat?: Etat;                          // si présent, remplace children
  alternative?: AlternativeTexte;       // obligatoire quand children dessine des données
  lecture?: React.ReactNode;            // phrase « ce que montre / ne montre pas »
  explorer?: string;                    // href « Ouvrir dans l'Explorer »
  id?: string;                          // ancre, cible des tests e2e
  children?: React.ReactNode;
}): JSX.Element;
```
Titre en `h2` 11 px `ink-soft` ; `<details>` « Alternative textuelle » ; `aria-labelledby` du titre sur la
zone graphique. Aucune figure du périmètre ne s'affiche hors d'une `Figure`.

#### `Sparkline` — `components/charts/Sparkline.tsx` (SSR SVG, F03)

```ts
export function Sparkline(props: {
  valeurs: (number | null)[];   // un point par seau, ordre chronologique, déjà aligné sur la grille
  label: string;                // aria-label : « LCP p75, 24 seaux d'une heure »
  seuils?: [number, number];    // dessine la bande « Bon » en fond si fourni
  max?: number;                 // échelle commune d'une liste : l'axe y va de 0 à max
  largeur?: number;             // défaut 96
  hauteur?: number;             // défaut 24
}): JSX.Element;
```
`null` = trou (segments séparés), jamais 0 ; moins de 2 valeurs non nulles → rien n'est dessiné et
`aria-label` dit « pas assez de points » ; avec `max`, `aria-label` ajoute « échelle commune, max N ».
`role="img"`. Test `tests/unit/Sparkline.test.tsx` : `[1, null, 3]` → deux segments ; même valeur et même
`max` → même hauteur.

#### `KpiTile` — `components/charts/KpiTile.tsx` (SSR, F03)

```ts
export function KpiTile(props: {
  label: string;                         // « LCP p75 », « Sessions commencées »
  valeur: number | null;
  format: FormatId;
  raisonNull?: string;                   // obligatoire si valeur === null
  vital?: VitalName;                     // badge de verdict + couleur via rating2026 (seulement un p75, R-V)
  precedent?: number | null;             // valeur de référence
  reference?: string;                    // « vs 24 h précédentes (…) » ; requis si precedent !== undefined
  couverturePrecedente?: CouverturePrecedente; // § 3.2 ; requis si precedent !== undefined et cmp=prev
  sensMeilleur?: "bas" | "haut" | "neutre"; // défaut "bas" pour un vital, "neutre" sinon
  serie?: (number | null)[];             // sparkline, même population que valeur (R-P)
  couverture?: { n: number | null; unite: string; faibleSous?: number }; // défaut faibleSous 100
  lecture?: string;                      // phrase sous la valeur (définition, sous-texte chiffré)
  alerte?: { si: ">" | ">=" | "<"; valeur: number; regle: string }; // ton bad SEULEMENT si la condition est vraie, avec la règle écrite
  intervalle?: { bas: number; haut: number; niveau: 0.95;
                 methode: "quantile_exact" | "quantile_normal" | "wilson" }
             | { indisponible: string }; // P*.1
  href?: string;                         // la tuile entière est un lien
}): JSX.Element;
```

Comportement, dans cet ordre :

- `valeur: null` → « — » + `raisonNull` ; pas de delta, pas de verdict, pas d'alerte.
- **Delta** : affiché seulement si `precedent` est un nombre, `couverturePrecedente.etat === "complete"`
  (quand la prop est fournie) et que ni `couverture.n` ni `couverturePrecedente.n` ne sont sous
  `faibleSous`. Sinon, textes exacts :
  - `precedent: null` → « pas de mesure sur <reference> » ;
  - `precedent: 0` et `valeur > 0` → pas de delta chiffré ; texte affiché : « pas de mesure de référence
    non nulle » (jamais « +∞ % ») ;
  - `couverturePrecedente.etat !== "complete"` → « période précédente incomplète : <raison> » ;
  - effectif faible sur l'une des deux périodes → « delta non affiché : échantillon faible sur l'une des
    deux périodes ».
- Delta neutre « → » sous ±2 % (reprise de `DeltaBadge`) ; sa couleur suit `sensMeilleur` ; `neutre` →
  flèche sans couleur.
- `couverture.n < faibleSous` → « échantillon faible » (et « médiane <x> » si l'appelant la passe dans
  `lecture`) ; `vital` : badge remplacé par « verdict non établi (moins de 13 mesures) » si
  `intervalle.indisponible` (P*.1).
- `vital` avec `intervalle` qui chevauche une borne de `THRESHOLDS` → « verdict incertain : entre Bon et
  À améliorer » ; texte d'intervalle « entre 2,1 s et 3,0 s (95 %) » sous la valeur.
- `alerte` : ton `bad` et règle écrite sous la valeur (« aucun canal : personne n'est prévenu ») si et
  seulement si `valeur <si> alerte.valeur` ; aucune autre voie ne colore une tuile hors `vital` (R-S).
- Accessibilité : un seul lien ; libellé annoncé complet (« LCP p75 2,7 s, À améliorer, +8 % vs 24 h
  précédentes, 1 240 mesures »).
- Tests `tests/unit/KpiTile.test.tsx` : `valeur: null` → « — » et la raison ; `precedent: 0` → texte
  exact ci-dessus ; `couverturePrecedente` partielle → aucun « % » de delta ; `alerte {si: ">", valeur:
  0}` avec 0 → pas de ton `bad` ; `vital` sans `intervalle` et `couverture.n = 40` → badge.

#### `KpiLibelle` — `components/charts/KpiLibelle.tsx` (SSR, F03)

```ts
export function KpiLibelle(props: {
  label: string;          // « Page d'entrée n°1 », « Service le plus sollicité »
  texte: string | null;   // « /partners · 28 sessions sur 28 », « GET /api/panier · 1 240 appels »
  raisonNull?: string;    // obligatoire si texte === null
  lecture?: string;
  href?: string;
}): JSX.Element;
```
Pour une tuile dont la valeur est un texte. Même gabarit visuel que `KpiTile`, sans delta ni verdict.

#### `ThresholdSeries` — `components/charts/ThresholdSeries.tsx` (client, recharts, F04)

```ts
export interface SerieDef {
  cle: string;                 // clé dans chaque point
  libelle: string;             // « LCP p75 », « Release 1.4.2 », « Période précédente »
  role: "principale" | "reference" | "robot" | "categorie" | "projection";
  categorieIndex?: number;     // couleur dans CATEGORIELLE si role = "categorie"
  forme?: "ligne" | "barres";  // défaut "ligne" ; "barres" réservé aux comptes (additifs)
  additive?: boolean;          // défaut false : seau absent de la grille = trou ; true : seau absent = 0
  effectifCle?: string;        // clé de l'effectif du seau dans chaque point (points creux sous faibleSous)
}
export interface Annotation {
  t: string;                   // instant ISO UTC
  libelle: string;             // « v1.4.2 », « Alerte LCP /checkout »
  type: "deploiement" | "alerte" | "anomalie" | "rupture";
  href?: string;               // déploiement → cmp=release… ; alerte → /alerts?evt=<id>
}
export const SERIE_MARGES: { gauche: number; droite: number }; // marges px partagées (StackedBars, FriseEtats)
export function ThresholdSeries(props: {
  grille: string[];            // OBLIGATOIRE : débuts de seau attendus, ISO UTC (bucketStarts ou jours)
  points: Array<{ t: string } & Record<string, number | null>>; // t ∈ grille ; déjà alignés (alignerSeaux)
  series: SerieDef[];          // ≤ 5 (P14)
  format: FormatId;
  vital?: VitalName;           // bandes Bon / À améliorer / Mauvais (THRESHOLDS) ; interdit avec forme "barres"
  faibleSous?: number;         // défaut 30 : point creux si effectif du seau < faibleSous
  bande?: { basseCle: string; hauteCle: string; libelle: string }; // bande d'incertitude (projection)
  annotations?: Annotation[];
  annotationsIndisponibles?: string; // raison si les annotations ne peuvent pas être lues (B1)
  seauSecondes: number;        // axe et zoom au clic
  fuseau: string;              // fuseau d'affichage des heures d'axe (« UTC » pour les seaux du contrat)
  zoomHref?: string;           // gabarit d'URL avec {from} {to} pour le clic sur un seau
  hauteur?: number;            // défaut 220
  ariaLabel: string;
}): JSX.Element;
```
- **Grille** : un élément de `grille` absent de `points` est un trou (série non additive) ou 0 (série
  `additive`), jamais une droite. Aucun `connectNulls`.
- **Bandes** : `ReferenceArea` pleines (opacité 0,08) ; domaine y =
  `[0, max(maxDonnées × 1,2, seuilBon × 1,1)]` ; si la borne « Mauvais » sort du domaine, étiquette
  « seuil Mauvais à 4,0 s, hors échelle ».
- Série `reference` gris pointillé, `robot` bleu `perf` pointillé, `principale` orange, `projection` même
  couleur que la principale en pointillé, seulement après `to` ; `bande` grisée.
- Seau de bord partiel : dernier point creux + légende « seau en cours ».
- Pas de double axe, pas d'empilement (P5, § 3.10).
- Accessibilité : `role="img"` + `ariaLabel` ; l'alternative est fournie par la `Figure` englobante (une
  ligne par seau, effectif compris).
- Tests : `tests/unit/series.test.ts` (`alignerSeaux`) et fonction pure `preparerPoints(grille, points,
  series)` exportée et testée dans `tests/unit/ThresholdSeries.test.ts` : points `[h0, h2]` sur la
  grille `[h0, h1, h2]` → deux segments séparés ; même cas avec `additive: true` → `h1 = 0` ; domaine y et
  bandes.

`alignerSeaux` — `lib/series.ts` (F04) :

```ts
export function alignerSeaux<T extends { bucket: string }>(
  rows: T[], starts: number[], additif: boolean,
): (T | null)[];
// rapprochement : Date.parse(row.bucket) === starts[i] ; absent → null (additif : l'appelant
// remplace null par 0 pour les champs de compte) ; une ligne hors grille est ignorée et comptée.
```

#### `StackedBars` — `components/charts/StackedBars.tsx` (client, recharts, réécrit en F04)

Seul composant qui empile. Réservé aux séries **additives** (comptes).

```ts
export interface SerieEmpilee {
  cle: string;
  libelle: string;
  categorieIndex?: number;               // couleur CATEGORIELLE
  ton?: "bad" | "warn" | "neutre";       // sévérités d'alerte (palette SEVERITE), doublé d'un motif
  motif?: "plein" | "hachure" | "points";
  href?: string;                         // clic sur un segment de cette série (ex. panel=error:<fp>)
}
export function StackedBars(props: {
  grille: string[];                      // débuts de seau ; seau absent = 0 (additif)
  points: Array<{ t: string } & Record<string, number | null>>;
  series: SerieEmpilee[];                // ≤ 5 ; une série « Autres (somme) » n'a pas de href
  format: FormatId;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  seauSecondes: number;
  fuseau: string;
  zoomHref?: string;                     // clic sur l'axe d'un seau (hors segment cliquable)
  hauteur?: number;                      // défaut 220
  ariaLabel: string;
}): JSX.Element;
```
Mêmes marges (`SERIE_MARGES`) que `ThresholdSeries` pour empiler les panneaux sur un axe x commun.
Alternative via `Figure` (seau × série).

#### `DistributionSeuils` — `components/charts/DistributionSeuils.tsx` (SSR SVG, F05)

```ts
export function DistributionSeuils(props: {
  vital: VitalName;
  bacs: { debut: number; fin: number; n: number }[]; // vitalHistogram (20 bacs linéaires jusqu'au plafond)
  plafond: number;               // plafond d'affichage ; dernière barre = « ≥ plafond »
  plafondLibelle?: string;       // « plafond d'affichage : p99 arrondi (320 ms) » quand il n'est pas VITAL_CAP
  percentiles: { p50: number | null; p75: number | null; p95: number | null } | null;
  n: number;
  valeurMarquee?: { valeur: number; libelle: string }; // « cette vue : 3,1 s », « p75 toutes routes »
  intervalleP75?: { bas: number; haut: number } | null; // P*.1 : bande grisée autour du repère p75
}): JSX.Element;
```
Barres colorées par zone de seuil (zone de la **mesure individuelle**, dit dans la légende) ; repères
verticaux p50 / p75 / p95 étiquetés ; `n = 0` → `EtatSurface vide` ; percentiles `null` → repères absents
et « percentiles non calculables » ; la barre « ≥ plafond » est dite. Alternative : bac, bornes, n. Bacs
non cliquables (§ 3.3).

#### `ImpactTable` — `components/ImpactTable.tsx` (SSR, F05)

Classement de segments (IP-Label « top offenders ») avec écart à la référence.

```ts
export interface ImpactMesure { cle: string; valeur: number | null; affichage: string; vital?: VitalName; n?: number | null }
export interface ImpactLigne {
  cle: string;                   // « Inconnu » a sa clé propre
  libelle: string;
  href: string | null;           // drill-down (§ 3.3) ; null = ligne non cliquable, raison dans l'alternative
  description: string;           // libellé complet annoncé par le lien
  pilote: number | null;         // valeur qui trie et dessine la barre
  volume: number | null;         // effectif de la ligne (mesures, sessions, appels…)
  mesures: ImpactMesure[];       // colonnes additionnelles
  ecart?: { valeur: number | null; affichage: string }; // « +1,2 s vs ensemble » (écart de p75, pas une contribution)
  intervalle?: string | null;    // P*.1 : « 2,1 – 3,0 s »
  echantillonFaible: boolean;
}
export type TriImpact = "gravite" | "volume" | "impact" | "fourni";
export function ImpactTable(props: {
  titre: string;
  onglets?: BreakdownTab[];      // dimensions, mêmes règles que Breakdown (raison si indisponible)
  tri: TriImpact;
  triHref: Record<TriImpact, string | null>; // null = tri indisponible (raison en title + sr-only) ; fourni : toujours null
  ordreLibelle?: string;         // OBLIGATOIRE si tri === "fourni" : affiché sous le titre
  reference: { libelle: string; valeurs: Record<string, string> } | null; // ligne « Ensemble », non classée
  referenceRaison?: string;      // OBLIGATOIRE si reference === null : texte à la place de la ligne
  lignes: ImpactLigne[];         // déjà triées côté serveur (lib/impact.ts), sauf tri "fourni"
  colonnes: string[];
  unitePilote: string;
  volumeLibelle: string;         // « Mesures LCP », « Sessions », « Appels »
  groupes: number;               // nombre réel de groupes
  tronque: boolean;
  notice: string;                // provenance de la dimension (BREAKDOWN_NOTICES)
  compact?: boolean;             // carte de tableau de bord
}): JSX.Element;
```
- Tri gravité : `pilote` décroissant pour les lignes non faibles, puis les faibles, puis `pilote: null`
  (« — »). Tri volume : `volume` décroissant. Tri impact : nombre de mesures « Mauvais » du groupe
  (additif) — **dépend de B2**, sinon `triHref.impact = null`. Tri fourni : ordre des `lignes` tel quel,
  `ordreLibelle` écrit sous le titre.
- La ligne de référence est une ligne de tableau distincte, jamais une barre ; pas de ligne « Autres »,
  pas de total sous un p75.
- Accessibilité : grammaire `Breakdown` (barre = lien, rectangles `aria-hidden`, table repliée).
- Tri et construction dans `lib/impact.ts` (`classerParGravite`, § 4.4), testés.

#### `ContrastBars` — `components/charts/ContrastBars.tsx` (SSR, F05)

« Qu'ont en commun les touchés ? » (Datadog « Outliers », en mieux : ratio et comptes).

```ts
export function ContrastBars(props: {
  dimensionLibelle: string;
  populationTouchee: string;     // « sessions avec cette erreur », « mesures LCP Mauvais »
  populationBase: string;        // « toutes les sessions de la fenêtre »
  lignes: {
    valeur: string;              // « Chrome Mobile », « Inconnu »
    nTouches: number; nBase: number;
    partTouches: number | null;  // nTouches / totalTouches
    partBase: number | null;     // nBase / totalBase
    href: string;
    test?: { pAjuste: number; retenu: boolean }; // P*.6
  }[];
  testees?: number;              // P*.6 : nombre de valeurs testées (toutes dimensions de l'écran)
  regle?: string;                // P*.6 : « test exact de Fisher unilatéral, Benjamini-Hochberg 5 % »
  indisponible?: string;         // raison tant que B3 n'est pas livré
}): JSX.Element;
```
Deux barres par valeur (touchés / base) + ratio écrit (« × 2,4 ») ; tri par ratio pour `nTouches ≥ 10`,
les autres en fin ; `partBase = null` → pas de ratio ; « Inconnu » affiché mais jamais testé.

#### `ReleaseCompare` — `components/ReleaseCompare.tsx` (SSR, F08)

```ts
export interface ReleaseStats {
  release: string; sessions: number | null;
  lcp_p75: number | null; inp_p75: number | null; cls_p75?: number | null;
  sessionsEnErreur: number | null;      // taux = sessionsEnErreur / sessions, null si sessions nul
  premiereVue?: string | null;          // ISO
}
export interface Intervalle { bas: number; haut: number; niveau: 0.95; methode: string }
export function ReleaseCompare(props: {
  a: ReleaseStats; b: ReleaseStats;     // a = référence, b = candidate
  plage: string;
  source: "occurrence" | "session";     // ComparaisonVersions.source
  regleChoix: string;                   // règle de choix de rel_a / rel_b (§ 3.2), affichée
  hrefs: { a: string; b: string };      // écran filtré sur chaque release
  verdict?: {                           // P*.5
    etat: "degradation" | "amelioration" | "non_etabli" | "insuffisant";
    mesure: string; difference: Intervalle | null; ecartDetectable: number | null;
    p: number | null; raison?: string;
  };
}): JSX.Element;
```
Deux colonnes, une ligne par mesure, écart relatif ; effectif sous chaque valeur ; ligne CLS « non lue par
cette comparaison » si `cls_p75` est absent ; phrase obligatoire « même fenêtre, sans normalisation de
trafic : l'écart mêle le code et le contexte » ; `a` ou `b` sans sessions → « aucune session de cette
release sur la fenêtre » ; lien « Toutes les versions » (`VersionsTable`).

#### `DetailPanel` — `components/DetailPanel.tsx` (SSR) + `components/DetailPanelKeys.tsx` (client, ≤ 40 lignes) (F07)

```ts
export function DetailPanel(props: {
  type: "route" | "error" | "issue" | "session" | "trace" | "event" | "action" | "noeud";
  titre: string;
  puces?: { label: string; valeur: string; provenance?: string }[]; // provenance du pays estimé
  fermerHref: string;
  pageHref: string;                       // « Ouvrir en page »
  precedentHref?: string | null;
  suivantHref?: string | null;
  onglets?: { cle: string; libelle: string; compte: number | null; href: string; actif: boolean }[];
  children: React.ReactNode;
}): JSX.Element;
```
`<aside aria-labelledby>` ; focus déplacé sur le titre à l'ouverture (îlot client) ; Échap = lien
`fermerHref` ; ↑ / ↓ = précédent / suivant ; `compte: null` → « (—) ». Mise en page du § 3.5.

#### `Cascade` — `components/charts/Cascade.tsx` (SSR, F07)

Axe horizontal partagé pour une trace, une vue ou une session (Datadog waterfall).

```ts
export function Cascade(props: {
  totalMs: number;
  pistes: { cle: string; libelle: string }[];      // « Navigateur », « Serveur », « Ressources », « Tâches longues »…
  elements: {
    id: string; piste: string; libelle: string;
    debutMs: number; dureeMs: number | null;       // null = instantané (marqueur)
    ton: "neutre" | "good" | "warn" | "poor" | "erreur"; // sévérité, pas statut
    parentId?: string | null; href?: string; detail?: string;
  }[];
  marqueurs?: { t: number; libelle: string; vital?: VitalName; valeur?: number }[]; // FCP / LCP
  partiel?: string;            // « ressources de plus de 300 ms seulement, 20 par vue »
  selection?: string | null;   // id mis en évidence (?span=)
  hauteur?: "normale" | "reduite"; // réduite dans un panneau
}): JSX.Element;
```
Couleur = sévérité ; alternative tabulaire (libellé, début, durée, piste) ; `partiel` affiché en tête
(la collecte de ressources est volontairement partielle, contrairement au « 32 out of 32 » de Datadog).

#### `PresetBar` — `components/PresetBar.tsx` (client, F08)

```ts
export interface VuePrereglee {
  id: string;                         // "p:mobile", "u:3"
  libelle: string;                    // facettes jointes par " • "
  origine: "produit" | "personnelle";
  params: Record<string, string | null>; // seuls CONTRACT_PARAMS et "cmp" autorisés
  indisponible?: string;              // raison, vue désactivée
}
export function PresetBar(props: { vues: VuePrereglee[]; actif: string | null }): JSX.Element;
```
Rangée défilante avec indicateur de débordement ; chaque vue = lien (`aria-pressed` si active) ;
« Enregistrer la vue actuelle » ouvre un champ en ligne ; vues personnelles lues / écrites via
`migrateSavedSegments` (`query-contract.ts:L742`).

#### `CompareToggle` — `components/CompareToggle.tsx` (client, F06)

```ts
export function CompareToggle(props: {
  mode: "prev" | "release" | "none";
  releases: string[] | null;          // null = liste indisponible ; < 2 → mode release désactivé avec raison
  relA: string | null; relB: string | null;
}): JSX.Element;
```
`Segmented` exporté de `GlobalFilters` + deux `select` labellisés quand `mode = "release"`.

#### `InsightStrip` — `components/InsightStrip.tsx` (SSR, F08)

Pendant honnête des « Watchdog Insights » : règles publiées.

```ts
export function InsightStrip(props: {
  constats: {
    type: "anomalie" | "regression" | "alerte" | "erreur_nouvelle" | "surrepresentation" | "rupture";
    titre: string;          // « LCP /checkout : 4,8 s à 14 h (moyenne 7 j : 2,1 s) »
    regle: string;          // « z-score > 3 sur la moyenne horaire des 7 derniers jours »
    href: string;
  }[];
  statuts?: { detecteur: string; etat: "teste" | "non_testable"; raison: string }[]; // P*.3
  fenetre: string;          // « 24 h fixes » si différente de la plage de l'écran
  ouvertParDefaut?: boolean;
}): JSX.Element;
```
Replié par défaut, compte en tête ; zéro constat → une ligne « Aucun constat automatique (règles : …) »,
jamais un bandeau caché : l'absence est une information. Les `statuts` (P*.3) sont toujours visibles.

#### `PopulationBar` — `components/PopulationBar.tsx` (SSR, F36)

```ts
export function PopulationBar(props: {
  puces: { libelle: string; retirerHref?: string }[]; // chaque condition du segment est retirable
  plage: string;
  fuseau: string;
}): JSX.Element;
```
La population effective toujours écrite (« tous les visiteurs · robots exclus »), y compris à « toutes
les apps ». Sert aux tableaux de bord et aux écrans « lecture non migrée ».

#### `EtenduePercentiles` — `components/charts/EtenduePercentiles.tsx` (SSR SVG, F38)

```ts
export function EtenduePercentiles(props: {
  lignes: { libelle: string; n: number; p50: number | null; p75: number | null; p95: number | null }[];
  format: FormatId;
  axeMax?: number;
  faibleSous?: number;  // défaut 30 : « échantillon faible »
}): JSX.Element;
```
Barre d'étendue p50 → p75 → p95 sur un axe commun, repère p75 marqué, `null` = extrémité absente et dite
(« p95 non calculable ») ; aucune couleur de verdict ; alternative tabulaire.

#### `FriseEtats` — `components/charts/FriseEtats.tsx` (SSR SVG, F56)

```ts
export interface EtatDef {
  cle: string;                                   // "ok" | "warn" | "incident" | "inconnu" | "absent"
  libelle: string;                               // « ok », « avertissement », « incident », « état inconnu », « aucun passage »
  forme: "basse" | "moyenne" | "haute" | "contour" | "hachure"; // la forme porte l'état
  glyphe?: string;                               // « ! » pour warn, « × » pour incident
  ton: "neutre" | "warn" | "bad" | "vide";       // couleur, jamais seule porteuse du sens
}
export function FriseEtats(props: {
  grille: string[];                              // mêmes débuts de seau que la ThresholdSeries au-dessus
  seauSecondes: number;
  cases: { t: string; etat: string; detail: string }[]; // une par élément de grille
  etats: EtatDef[];
  zoomHref?: string;                             // même gabarit que ThresholdSeries
  regrouperSousPx?: number;                      // défaut 2 : cases regroupées (pire état) si plus étroites
  hauteur?: number;                              // défaut 44
  ariaLabel: string;
}): JSX.Element;
```
Axe x en temps (domaine `[grille[0], dernier début + seau]`) et marges `SERIE_MARGES` : alignée à ≤ 2 px
avec la série au-dessus. Un seul arrêt de tabulation pour la frise, flèches gauche / droite de case en
case ; `aria-label` d'une case = heure UTC + état en toutes lettres + `detail`. Aucune bande, aucune
échelle de valeur.

#### `ScatterPlot` — `components/charts/ScatterPlot.tsx` (client, signature unifiée, F03)

```ts
export interface ScatterPoint { x: number; y: number; z?: number; label: string; color?: string; href?: string }
export function ScatterPlot(props: {
  points: ScatterPoint[];
  xLabel: string; yLabel: string;
  xUnit?: string; yUnit?: string;
  xFormat?: NumFmt; yFormat?: NumFmt;      // jetons sérialisables existants ("int" | "locale")
  etiquettes?: number;                     // n points les plus hauts étiquetés
  repereX?: { valeur: number; libelle: string }; // bande verticale (ex. seuil LCP « Bon »)
  bandesY?: { vital: VitalName };          // bandes horizontales Bon / À améliorer / Mauvais sur y seulement
  height?: number;
  ariaLabel: string;
}): JSX.Element;
```
`points[].href` : un clic navigue (`router.push`) ; sans `href`, le point n'est pas cliquable et
l'alternative le dit. Alternative via `Figure` (une ligne par point).

### 4.3 Composants de domaine

Composants propres à un écran, mais déclarés ici pour qu'il n'en existe qu'une version.

#### `QueryPills` — `components/explorer/QueryPills.tsx` (SSR, F31)

```ts
export function QueryPills(props: {
  pastilles: { cle: string; libelle: string; retirerHref: string | null; raison?: string }[];
  resume: string;  // explorerResume, rendu en aria-label
}): JSX.Element;
```
`retirerHref: null` pour un élément obligatoire (jeu, mesure, variante requise), avec `raison`.

#### `ModelesDepart` — `components/explorer/ModelesDepart.tsx` (SSR, F31)

```ts
export function ModelesDepart(props: {
  modeles: { cle: string; titre: string; question: string; href: string | null; raison?: string }[];
  compact?: boolean;
}): JSX.Element;
```

#### `ModeleCarte` — `components/dashboards/ModeleCarte.tsx` (SSR, F35)

```ts
export function ModeleCarte(props: {
  titre: string; question: string;
  sections: { titre: string; cartes: string[] }[];
  cloner: { apps: { id: string; libelle: string }[] } | null; // null → pas de bouton
  raisonSansClonage?: string;
}): JSX.Element; // formulaire vers cloneTemplateAction
```

#### `ResultatAnalyse` — `components/explorer/ResultatAnalyse.tsx` (SSR, sauf séries ; F32)

Une seule traduction « résultat Explorer → figure », pour l'Explorer et les cartes de tableau de bord.

```ts
export function ResultatAnalyse(props: {
  plan: ExplorerPlan; meta: ExplorerMeta; data: ExplorerData;
  precedent?: { total: number | null; series?: ExplorerPoint[]; plage: string;
                couverture: CouverturePrecedente } | null;
  hrefs: { groupe: (key: (string | null)[]) => string }; // appelée côté serveur ; les enfants client ne reçoivent que des chaînes
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  taille: "page" | "carte";
}): JSX.Element;
```
Choix de forme par `estAdditive` (`lib/analytics-schema.ts:L88-90`) ; verdict et bandes selon R-V
(`vitalDeVerdict`).

#### `RoutePanel` — `components/perf/RoutePanel.tsx` (SSR, fonction serveur locale à `/pages`, F17)

Signature fixée au § 5.2.3 ; non réutilisée ailleurs.

#### `PrioriteSessions` et `SessionsTable` — `components/sessions/` (SSR, F42)

```ts
export function PrioriteSessions(props: {
  lignes: SessionPrioritaire[];                       // § 5.11.4 (B30)
  hrefs: Record<string, { panel: string; rejeu: string | null }>;
  plage: string;
}): JSX.Element;
export function SessionsTable(props: {
  lignes: (SessionRow & { frustration: number | null; rejeu: boolean | null })[];
  panelHrefs: Record<string, string>;
  pageHrefs: Record<string, string>;
  suivantHref: string | null;
  vide: string;
}): JSX.Element; // liens pré-calculés côté serveur, aucune fonction en prop
```

#### `PanneauSession` — `components/sessions/PanneauSession.tsx` (SSR, fonction serveur locale à `/sessions`, F43)

Assemble `DetailPanel type="session"` + `Cascade` (hauteur réduite) à partir de `sessionMeta(id)` et
`sessionTimeline(id)` ; pas de props publiques, importé seulement par `app/sessions/page.tsx`. Contenu :
puces de contexte (§ 5.12.4), 4 `KpiTile` (durée observée, pages vues, occurrences d'erreur, signaux de
frustration avec garde R-F), mini-`Cascade`, 15 premiers événements groupés par vue (`grouperParVue`) ;
`precedentHref` / `suivantHref` calculés par la page depuis les lignes de la liste.

#### `Deroule` — `components/sessions/Deroule.tsx` (SSR, F45)

```ts
export function Deroule(props: {
  items: TimelineItem[];
  t0: number;
  voir: TimelineKind[] | null;
  liens: Record<number, string>;
  tronque: boolean;
}): JSX.Element;
// logique pure lib/deroule.ts :
export function grouperParVue(items: TimelineItem[]): {
  vue: TimelineItem | null; vitals: TimelineItem[]; phases: TimelineItem[];
  actions: { action: TimelineItem; effets: TimelineItem[] }[]; autres: TimelineItem[];
}[];
export function fenetreDeSession(startedAtMs: number, nowMs: number): { from: string; to: string };
```

#### `ReplaySynchro` — `components/replay/ReplaySynchro.tsx` (client, ≤ 120 lignes, F47)

```ts
export type Marqueur = { t: number; ton: "erreur" | "frustration" | "vue" | "action"; libelle: string };
export function ReplaySynchro(props: {
  sessionId: string;
  atMs: number | null;
  items: { id: string; t: number; ancre: string }[];
  marqueurs: Marqueur[];
}): JSX.Element;
```
Monte `ReplayPlayer`, écoute le temps courant, pose `aria-current="time"` sur la ligne `#ancre` de la
chronologie SSR, déplace la tête au focus ou au clic d'une ligne. Sans JavaScript, chaque ligne est un
lien `?tab=deroule&at=<t>`.

#### `MatriceCohortes` — `components/charts/MatriceCohortes.tsx` (SSR, F49)

```ts
export function MatriceCohortes(props: {
  lignes: { cohorte: string; taille: number;
            cellules: { offset: number; retenus: number; taux: number | null; incomplete: boolean }[] }[];
  colonnes: number;
  faibleSous?: number; // défaut 10 : « effectif faible »
}): JSX.Element;
```
Échelle `SEQUENTIELLE` ; cellule « 12 / 28 » + « 43 % » ; semaine incomplète hachurée.

#### `BudgetBars` — `components/charts/BudgetBars.tsx` (SSR, F56)

```ts
export interface BudgetLigne {
  cle: string;                 // slo_id
  libelle: string;             // nom du SLO
  detail: string;              // « LCP · /checkout · 28 j · objectif 95 % »
  consomme: number | null;     // burned_pct (0..999) ; null = non mesurable
  atteinte: number | null;     // 0..1 (peut être < 0 pour error_rate : voir raison)
  objectif: number;            // 0..1
  brule: boolean | null;       // fast_burn
  raison?: string;             // obligatoire si consomme === null ou atteinte < 0
  href: string;                // drill « qu'est-ce qui consomme »
}
export function BudgetBars(props: {
  lignes: BudgetLigne[];       // déjà triées (consommé décroissant, null en dernier)
  reperes?: number[];          // défaut [50, 75] : traits gris « repère », sans couleur de verdict
  epuise?: number;             // défaut 100 : seul seuil coloré (bad) et nommé « épuisé »
  echelleMax?: number;         // défaut 150 ; au-delà : hachures + valeur écrite
  ariaLabel: string;
}): JSX.Element;
```
Une barre = un lien ; `ink` sous `epuise`, `bad` à partir de `epuise` ; verdict écrit (« dans le budget »,
« épuisé ») ; `null` → pas de barre.

#### `MatriceConcordance` — `components/charts/MatriceConcordance.tsx` (SSR, F56)

```ts
export function MatriceConcordance(props: {
  lignes: { cle: string; libelle: string }[];      // états robot : ok, warn, incident
  colonnes: { cle: string; libelle: string }[];    // verdicts réels : Bon, À améliorer, Mauvais
  cellules: Record<string, Record<string, number>>; // [ligne][colonne] = heures × route
  nommees: { ligne: string; colonne: string; nom: string; href?: string; ton: "bad" | "warn" | "neutre" }[];
  horsMatrice: { libelle: string; n: number }[];   // robot seul, réel seul, réel insuffisant, état inconnu
  unite: string;                                    // « heures × route »
}): JSX.Element;
```
`<table>` à `<th scope>` ; intensité de fond `SEQUENTIELLE` proportionnelle au compte ; seules les
cellules `nommees` portent une teinte de sens (P15).

#### `FriseDeclenchements` — `components/charts/FriseDeclenchements.tsx` (SSR SVG, F56)

```ts
export function FriseDeclenchements(props: {
  debut: string; fin: string;                       // ISO UTC, 30 jours
  pistes: {
    cle: string; libelle: string; href: string;     // règle, SLO ou issue
    groupe: "regle" | "slo" | "issue";              // intertitres ; « slo » porte id="pistes-slo"
    etatActuel: { libelle: string; ton: "good" | "bad" | "neutre"; raison?: string } | null;
    marqueurs: { t: string; severite: "info" | "warning" | "critical"; livre: boolean; enAttente: boolean;
                 acquitte: boolean; href: string }[]; // href → /alerts?evt=<id>#evt-<id>
  }[];
  maxPistes?: number;                               // défaut 12 (P14)
  tronque?: string;                                 // raison si plafond atteint
}): JSX.Element;
```
Forme = livraison (plein = livré, creux = non livré, losange = en attente) ; couleur = sévérité
(`SEVERITE`) ; contour épais = non acquitté ; rien porté par la seule couleur.

#### `CopierTrace` — `components/tracing/CopierTrace.tsx` (client, ≤ 20 lignes, F61)

`{ traceId: string }` ; `navigator.clipboard`, repli : champ en lecture seule sélectionnable.

#### `RecitSession` — `components/sessions/RecitSession.tsx` (SSR, P*.9)

`{ phrases: { texte: string; ancre: string }[]; rejeu: "present" | "absent" | "masque" }` ; logique dans
`lib/recit-session.ts` (§ 7).

### 4.4 Modules de logique pure (testés, sans accès base)

| Module | Contenu | Lot | Test |
|---|---|---|---|
| `lib/palette.ts` | `RATING_HEX` (réexport), `SERIE = { principale: "#f89101", reference: "rgb(var(--ink-faint))", robot: "#2563eb" }`, `CATEGORIELLE` (8 teintes sans vert / ambre / rouge, contraste validé clair / sombre), `SEQUENTIELLE: (t: number) => string` (une teinte, 5 paliers), `SEVERITE = { critical, warning, info }` (jetons `bad`, `warn`, `ink-soft`, toujours doublés d'un motif) | F01 | `tests/unit/palette.test.ts` : `CATEGORIELLE` ne contient aucune couleur de `RATING_HEX` ; `SEQUENTIELLE` monotone |
| `lib/fmt-ids.ts` | `FormatId`, `VitalName`, `formater` | F03 | `fmt-ids.test.ts` |
| `lib/lecture.ts` | `lire`, `Lecture<T>` | F02 | `lecture.test.ts` |
| `lib/view-state.ts` | parse / sérialise `cmp`, `rel_a`, `rel_b`, `tri` (`TRIS_PAR_ECRAN`, `lireTri`), `vital`, `panel`, `vue`, `evt`, `appel`, `regle_*`, `avec`, `voir`, `depuis`, `type`, `nouveaux`, `statut` ; `VIEW_CONTEXT_PARAMS` ; `contextHref` ; `ignores` (liste des réglages ignorés) | F06 (+ lots d'écran) | `view-state.test.ts` : aller-retour de chaque paramètre ; `tri=impact` avant B2 ignoré et signalé ; `queryFingerprint` inchangé |
| `lib/comparaison.ts` | `couverturePrecedente`, `debutCollecte` (lecture), `CouverturePrecedente` | F06 | `comparaison.test.ts`, `comparaison-sql.test.ts` (§ 3.2) |
| `lib/series.ts` | `alignerSeaux` | F04 | `series.test.ts` : absent → `null` ; additif → 0 ; hors grille ignoré |
| `lib/fuseau.ts` | `bornesHeureLocale(jour: string, heure: number, tz: string): { from: string; to: string }`, `bornesJourLocal(jour: string, tz: string): { from: string; to: string }`, `libelleDeuxFuseaux(from, to, tz): string` | F05 | `fuseau.test.ts` : Europe/Paris, case 9 h un jour d'été → `from=…T07:00:00Z`, `to=…T08:00:00Z` ; jour d'été 10/09 → `2026-09-09T22:00:00Z` ; jour de changement d'heure (25 h) |
| `lib/impact.ts` | `classerParGravite<T>(lignes, { pilote, effectif, seuilFaible, tri, volume }): { lignes: T[]; faibles: number }`, garde d'échantillon, écart à la référence | F05 | `impact.test.ts` : `n = 12` après `n = 400` ; `null` en dernier ; aucun total de p75 |
| `lib/presets.ts` | vues produit (§ 3.6), nommage « a • b • c », `choisirReleases(deploys, versions)` (§ 3.2) | F08 (+ F38 pour les vues mobiles) | `presets.test.ts` : vue indisponible motivée ; « Mobile » ne pose que `device` ; vues mobiles ne posent que `os` / `release` |
| `lib/annotations.ts` | `DeployRow[]` + `AlertEvent[]` → `Annotation[]` filtrées sur `[from, to)`, regroupement au-delà de 6 | F08, F67 | `annotations.test.ts` |
| `lib/perf-domain.ts` | `partTouchees`, `deltaAffichable`, `ratioPour100`, `choisirRelB` (réexport de `presets`), `autresGroupes`, `colonnesPromues`, `plafondAffichage`, `avecCondition` si nécessaire | F10 et lots F11-F26 | `perf-domain.test.ts` |
| `lib/echantillonnage.ts` | `etatEchantillonnage(e: EchantillonnageSessions): Etat \| null` | F40 | `echantillonnage.test.ts` |
| `lib/deroule.ts` | `grouperParVue`, `fenetreDeSession`, conversion items → `Cascade.elements` | F45, F46 | `deroule.test.ts` |
| `lib/cohorts.ts` | `courbeRetention(rows, semaineCourante, colonnes)`, `lundiDeSemaine(index)` | F40, F49 | `cohorts.test.ts` |
| `lib/correlation-serie.ts` | `lireSerie`, `ecrireSerie` (format `<app>:<route>` encodé) | F57 | `correlation-serie.test.ts` |
| `lib/correlation.ts` (ou fonctions de `lib/queries-v2.ts` exportées) | `retardRobot`, `partCouverte`, `trierSansRobot` | F57, F58 | `correlation.test.ts` |
| `lib/tracing-ancres.ts`, `lib/tracing-hero.ts` | `ancreAppel`, `lireAppel` ; `lignesHero` | F59, F60 | `tracing-ancres.test.ts`, `tracing-hero.test.ts` |
| `lib/frustration-regles.ts` | règles de détection exportées depuis les constantes du SDK | F22 | `frustration-regles.test.ts` |
| `lib/explorer-modeles.ts`, `lib/explorer-page-params.ts` | `MODELES_EXPLORER` ; `vitalDeVerdict`, `resumeVue`, `resumePopulation` | F31, F32, F34, F36 | `explorer-page-params.test.ts` |
| `lib/dashboard-templates.ts` | `MODELES_TABLEAUX` (Performance, Erreurs, Usages, Releases) | F35 | `dashboards.test.ts` |
| `lib/forecast.ts` | `dispersionResidus`, `penteSignificative` (F65) ; `residuel`, `testPente`, `bandePrediction`, `etaIntervalle`, `HORIZON_JOURS` (P*.4) | F65, P*.4 | `forecast.test.ts` |
| `lib/goals.ts` | `conversionRate` (`null` sans session, F00), `intervalleWilson` | F00, F66 | `goals.test.ts` |
| `lib/mobile-capabilities.ts` | `etatCapaciteParRelease`, `tauxSansErreurDeclarant` | F38 | `rum-mobile-p75.test.ts` (étendu) |
| `lib/form-analytics.ts`, `lib/acquisition.ts`, `lib/funnel.ts`, `lib/map.ts`, `lib/sankey.ts` | `mediane`, `fieldReport` étendu ; `entrees` ; `convFromStart` `null` ; santé `unknown`, nœud « Autres » ; hauteur | F40, F48, F50, F51, F52 | tests existants étendus |
| `lib/stats/*` | lois, incertitude, comparaison, anomalies, rupture, concordance, sur-représentation (§ 7) | P*.1 et suivants | `stats-*.test.ts` |

### 4.5 Lectures serveur à créer (requêtes sans migration, sur `sqlContext`)

Registre unique des signatures ; le lot qui les crée les teste en SQL sur base réelle.

```ts
// lib/queries.ts — F10
export async function vitalSeriesN(f: Filters, name: VitalName, shift = false):
  Promise<{ bucket: string; p75: number | null; n: number }[]>;       // seaux du contrat, n par seau
export async function sessionsAvecVue(f: Filters, shift = false): Promise<number>;
  // sessions distinctes ayant au moins une vue dont started_at ∈ [from,to) — seule définition (R-P)
export async function pageviewSeries(f: Filters, shift = false):
  Promise<{ bucket: string; chargements: number; spa: number }[]>;     // additif, seau vide = 0
export async function samplingVitals(f: Filters): Promise<{ probaMin: number | null }>;
// lib/queries.ts — F15
export async function vuesParNavType(f: Filters):
  Promise<{ route: string | null; chargements: number; spa: number; inconnu: number }[]>;
// lib/queries-errors.ts — F10, F18, F20
export async function errorSeries(f: Filters, shift = false): Promise<{ restreint: boolean;
  points: { bucket: string; navigateur: number; sansSource: number; serveur: number }[] }>;
export async function erreursNavigateur(f: Filters, shift = false):
  Promise<{ restreint: boolean; navigateur: number; sansSource: number; serveur: number }>;
export async function partSessionsTouchees(f: Filters, ref?: ErrorGroupRef, shift = false):
  Promise<{ base: number; touchees: number; tauxMin: number | null }>;
export async function nouveauxGroupes(f: Filters): Promise<number>;
export async function topGroupesSeries(f: Filters, n: 4): Promise<{ groupes: { ref: ErrorGroupRef;
  message: string | null; error_type: string | null; occurrences: number; series: number[] }[] }>;
export async function releasesDuGroupe(ref: ErrorGroupRef, f: Filters): Promise<{
  premiere: { release: string; ts: string } | null; derniere: { release: string; ts: string } | null }>;
// lib/queries-frustration.ts — F22
export async function frustrationTotaux(f: Filters, shift = false): Promise<{
  parType: { kind: "rage" | "dead" | "error"; n: number; sessions: number }[];
  capteur: { sessionsCouvertes: number; sessionsTotal: number; runtimeLu: boolean } }>;
export async function frustrationParRoute(f: Filters): Promise<{ route: string | null; rage: number;
  dead: number; error: number; sessionsTouchees: number; sessionsRoute: number }[]>;
// lib/queries-sessions.ts — F10 (paramètre shift) ; lib/queries-experience.ts — F26
export async function engagementStats(f: FiltersLike, shift = false): Promise<EngagementStats>;
export async function feedbackTrendContrat(f: Filters): Promise<{ bucket: string; csat: number | null; avis: number }[]>;
// lib/queries-mobile.ts — F38
export async function mobileParRelease(f: FiltersLike, limite = 12, schema?: MobileSchema): Promise<
  { disponible: true; lignes: MobileReleaseRow[]; releases: number; tronque: boolean }
  | { disponible: false; raison: string }>;
// lib/queries-v2.ts (ou lib/queries-correlation.ts) — F57
export async function syntheticFreshness(f: FiltersLike): Promise<{ app_id: string; dernier: Date | null;
  intervalle_median_s: number | null; passages: number }[]>;
export async function correlationConcordance(f: FiltersLike, effectifMin = 30): Promise<{
  cellules: { robot: "ok" | "warn" | "incident"; reel: Rating; heures: number }[];
  robotSeul: number; reelSeul: number; reelInsuffisant: number; robotInconnu: number;
  anglesMortsParRoute: { serie: string; app_id: string; route: string; heures: number }[]; // serie = ecrireSerie(app, route)
  bornesLcp: [number, number] }>;
export async function correlationRoutes(f: FiltersLike): Promise<{ app_id: string; route: string }[]>;
export async function correlationSeries(app: string, route: string, f: FiltersLike): Promise<{
  bucket: Date; rum_lcp_p75: number | null; rum_lcp_n: number | null; syn_latency_avg: number | null;
  syn_state: "ok" | "warn" | "incident" | null; syn_measures: string | null }[]>;
// lib/queries-tracing.ts — F59
export async function apiCallsDecomposition(f: FiltersLike): Promise<{ url: string; method: string;
  n: number; n_suivis: number; front_p75: number | null; back_p75: number | null;
  reseau_p75: number | null; part_serveur_p50: number | null; err: number }[]>;
export async function spanLatencySeries(f: FiltersLike): Promise<{ t: string; front_p75: number | null;
  back_p75: number | null; n: number }[]>;
export async function errorsOfTrace(traceId: string, opts: { apps: string[] | null }): Promise<{
  fingerprint: string; message: string | null; occurrences: number; source_parent_span_id: string | null }[]>;
export async function slowTraces(f: FiltersLike, opts?: { appel?: { method: string; url: string } }): Promise<SlowTraceRow[]>;
// lib/queries-v2.ts — F62
export async function alertEventsByDay(f: FiltersLike, jours = 30): Promise<{ jour: string;
  severity: string; n: number; non_livres: number }[]>;
export async function alertFirings(f: FiltersLike, jours = 30, plafond = 2000): Promise<{ lignes: {
  source: "regle" | "slo" | "issue"; source_id: string; libelle: string; fired_at: Date; severity: string;
  delivered: number; pending: number; acknowledged: boolean; event_id: number }[]; tronque: boolean }>;
// lib/queries-goals.ts — F66 (détail § 5.14.3)
export async function listGoals(apps: string[] | null): Promise<GoalDef[]>;
export async function goalConversions(f: FiltersLike): Promise<{ total: number;
  rows: (GoalConversion & { derniere: Date | null })[] }>;
export async function goalConversionsByDevice(f: FiltersLike): Promise<{ goal_id: number;
  device: string | null; conversions: number; sessions: number }[]>;
// lib/queries-grid.ts — F65 (dailyTraffic garde ses autres appelants inchangés)
export async function dailyTraffic(f: Filters, opts?: { exclureAujourdhui?: boolean }): Promise<DailyRow[]>;
export async function dailyLcpSeries(f: Filters): Promise<{ jour: string; p75: number | null; n: number }[]>;

// lib/queries-deploys.ts — F00 (lecture existante, hors sqlContext : queryOf + compileScope conservés)
export interface DeployImpact {
  deploy_ts: Date | null;
  version: string | null;
  env: string | null;
  lcp_before: number | null;
  lcp_after: number | null;
  pageviews_before: number;        // count(*) rum_pageview, started_at ∈ [d.ts − 2 h, d.ts), même app_id que le marqueur
  pageviews_after: number;         // started_at ∈ [d.ts, d.ts + 2 h)
  sessions_before: number;         // count(distinct session_id) de ces mêmes pages vues (sessions, pas visiteurs)
  sessions_after: number;
  errors_before: number | null;    // sum(occurrences) ; null si pageviews_before = 0 (V3 : sans dénominateur)
  errors_after: number | null;     // null si pageviews_after = 0
}
export async function latestDeployImpact(f: Filters): Promise<DeployImpact | null>;
  // CTE `d` inchangée. Quatre sous-requêtes ajoutées sur `rum_pageview p, d`
  // (p.app_id = d.app_id ; colonne de temps `started_at`, apps/ingest/sql/schema.sql:241, pas `ts`),
  // coalesce(…, 0)::int. Les erreurs gardent leur coalesce(…, 0) en SQL ; la règle null est
  // appliquée en TypeScript sur la ligne rendue (testable avec `q` simulé) :
  // errors_before = pageviews_before === 0 ? null : errors_before (symétrique pour after).
  // Appelants de errors_* à relire pour accepter null avant assessRegression (qui rend déjà
  // deltaPct: null sur une entrée null, :103-110).

// lib/queries-actions.ts — F00
export async function actionsDisponible(): Promise<boolean>;   // existante (:52-58), seulement exportée
```

---

## 5. Spécification écran par écran

Ordre : celui de la navigation (§ 2.2). Chaque écran donne sa **question** (le `sub` du `PageHeader`),
la **question suivante** (où mène le drill-down), la **référence retenue** et pourquoi, la **grille**
(zones dans l'ordre, à 1440 / 768 / 390 px, et ce qui tient au-dessus du pli), la **table des widgets**,
puis ce qui est **conservé** et ce qui **disparaît**. Colonnes des tables de widgets :

- **Libellé** — texte exact affiché ; **Type et pourquoi** — le graphique et la question à laquelle il
  répond ; **Mesure** — mesure, agrégation, dimensions, grain ; **Cmp** — comparaison affichée ;
- **Source** — « ex. » (existante, `fichier:ligne`), « à créer : signature » (dans le lot), « backend :
  manque Bn » (§ 6.3) ; **Composant** — nom et props du § 4 ;
- **Interactions** — liens (§ 3.3) ; **États** — vide, partiel, erreur, non collecté, échantillonné, avec
  leurs textes ; **Critère** — vérifiable par un test (fichier nommé) ou une capture.

Règles valables pour tous les écrans, non répétées dans chaque table : chaque zone est une section
`SectionErreur` qui lit par `lire()` ; chaque figure est dans une `Figure` avec `meta` (P11) et
`alternative` (P10) ; toute série est alignée sur sa grille (§ 3.10) ; toute tuile en `cmp=prev` reçoit
`couverturePrecedente` (§ 3.2) ; viewer et démo ne voient aucun bouton d'écriture (V9).

**Catégorie Performance** — § 5.1 à § 5.6.

### 5.1 Vue d'ensemble `/`

**Question (sous-titre `PageHeader`, P1).** « Les vrais visiteurs vont-ils bien sur cette période, et
sinon, où et depuis quand ? »
**Question suivante.** « Quelle page, pour qui ? » → Pages filtrée ; « Quelle erreur ? » → Erreurs ;
« Depuis quel déploiement ? » → `cmp=release`.

**Référence retenue.** IP-Label pour l'ossature d'analyse (p75 par segment classé par gravité, release
contre release : `iplabel.md` L56-58, L87-114), Datadog pour la forme des séries (trois Core Web Vitals sur
bandes, `datadog-images-1.md` L97-126), Grafana pour la discipline stat + tendance (`grafana.md` § c
« Stat ») ; le bandeau santé à formule affichée est **nôtre, conservé** (aucune des trois références n'en
a : `console-ecrans-1.md` L67).

#### 5.1.1 Grille

Écart à l'ossature initiale, justifié : la rangée « KPI trafic » passe **à droite du bandeau
santé**, qui devient compact (une ligne de facteurs au lieu de deux). Sans cela, à 1440 × 900, coquille
(≈ 130 px, `console-ecrans-1.md` L11) + en-tête (≈ 70) + vues préréglées (≈ 40) + santé (≈ 190) + deux
rangées de tuiles (≈ 2 × 130) + constats (≈ 44) poussent le hero sous le pli, ce que P1 interdit.

| Ordre | Zone | 1440 (≈ 1150 px utiles) | 768 | 390 |
|---|---|---|---|---|
| 1 | `PageHeader` + `PresetBar` | pleine largeur | idem | `PresetBar` défile, indicateur de débordement |
| 2 | Santé (7/12) · KPI trafic ×3 (5/12) : « Sessions commencées », « Pages vues », « Occurrences d'erreurs pour 100 pages vues » | une rangée, ≈ 120 px | santé pleine largeur, puis 3 tuiles en ligne | santé ; tuiles trafic en 1 colonne |
| 3 | KPI Web Vitals ×5 | 5 colonnes | 3 + 2 | 2 colonnes (5ᵉ seule) |
| 4 | Constats (`InsightStrip`, replié) | pleine largeur | idem | idem |
| 5 | **Hero** « Core Web Vitals dans le temps » (3 petits multiples) | 3 colonnes, 200 px de haut | 3 empilés | 3 empilés |
| — | *pli à 1440 × 900 : le titre du hero et le haut des trois graphiques sont visibles* | | | |
| 6 | « Charge, erreurs et LCP » (3 panneaux empilés, axe x partagé, ≈ 3 × 110 px) · « Heures × route en angle mort » | 8/12 · 4/12 | empilés | empilés ; les 3 panneaux gardent l'axe x partagé, étiquettes d'axe réduites à 3 |
| 7 | « Segments les plus dégradés » (`ImpactTable`) | pleine largeur | idem | table repliée, barres + libellé |
| 8 | « Nouvelle release face à la précédente » (`ReleaseCompare`) | pleine largeur | idem | deux colonnes deviennent deux blocs |
| 9 | « Historique 14 jours » (`HealthHeatmap`) + « Anomalies LCP » (`AnomalyTable`, replié) | pleine largeur | idem | heatmap défile (`min-w-[640px]` existant) |

Rythme vertical : `mb-6` entre zones (existant, `console-identite.md` L124).

#### 5.1.2 Widgets

Abréviations : **Src** = source ; **Cmp** = comparaison ; « ex. » = existante.

| Libellé exact | Graphique et pourquoi | Mesure · agrégation · dimensions · grain | Cmp | Src | Composant | Interactions | États | Critère d'acceptation |
|---|---|---|---|---|---|---|---|---|
| Vues préréglées | rangée de liens : une vue = une question déjà posée (IP-Label « EU • Mobile • Checkout ») | — | — | ex. `comparaisonVersions(f,12)`, `vitalsBreakdown(f,"browser",200)`, `vitalsBreakdown(f,"country",200)` via `lib/presets.ts` | `PresetBar` (§ 4.2) | clic → URL avec seuls `CONTRACT_PARAMS` + `cmp` | vue incalculable → désactivée avec raison | appliquer « Mobile » ne change que `device=mobile` (e2e) |
| Santé de la période | anneau + barres de facteurs : un score **expliqué** (formule écrite) | score 0-100 : 40 % vitals (LCP ×2), 30 % erreurs navigateur / vues, 20 % sessions sans erreur, 10 % anomalies 24 h ; fenêtre du contrat, anomalies 24 h fixes | aucune (score non comparé : une variation de score composite n'a pas d'unité interprétable) | ex. `healthScore(f)` `lib/health.ts:L138`, type `Health` L123-128 ; **modifié en F11** : facteur « Erreurs JS » renommé « Erreurs navigateur », numérateur restreint à `error_source like 'browser_%'` (CP14, même requête que `erreursNavigateur`), `detail` = « N occurrences pour P pages vues (x pour 100) » ; `pageviews = 0` → `earned: null` « aucune page vue » (aujourd'hui 0 si des erreurs existent, `health.ts:L204-205`) | `HealthBanner` (`health/HealthBanner.tsx:L82`) en variante `compact` (prop `compact`, § 4.1) | clic sur un facteur → écran de la mesure (vitals → `/pages`, erreurs → `/errors`, stabilité → `/sessions`, anomalies → ancre `#anomalies`) | `score: null` → « Santé : données insuffisantes » ; facteur `earned: null` → « n/a » + `detail` **visible** (plus en `title`) ; anomalies exclues sous filtre → phrase existante ; sous le score, une ligne fixe : « Mêle la période choisie et des anomalies sur 24 h fixes. Sessions sans erreur : surestimé si l'échantillonnage garde les sessions en erreur » (CP15) | à 390 px, aucun libellé de facteur tronqué (e2e « aucun débordement » + texte complet présent dans le DOM) ; aucun facteur affiché en % d'erreurs |
| Sessions commencées | stat + sparkline (Grafana « Stat ») ; valeur et sparkline comptent **la même population** : la somme des seaux de la sparkline égale la valeur | `count rum_session` dont `started_at ∈ [from,to)` ; sparkline : même compte par seau du contrat | `cmp=prev` : second appel sur `previousRange` (à créer : paramètre `shift` de `engagementStats`, même patron que `overviewStats(f, shift)`, `queries.ts:L124-126`) ; sans lui, pas de delta | ex. `engagementStats(f).sessions_started` `queries-sessions.ts:L20-33` ; sparkline : ex. `observedVisitorsTrend(f)` champ `sessions` `queries-sessions.ts:L68-90` (grille zéro-remplie par `bucketSeriesSql`) | `KpiTile` `format="count" sensMeilleur="neutre"` | tuile → `/sessions` (même nombre en tête de `/sessions`, § 5.11) | 0 réel → « 0 » ; lecture en échec → `SectionErreur` (le `try` de `engagementStats` est retiré par F02, `queries-sessions.ts:L21`) | test unitaire `tests/unit/perf-domain.test.ts` : Σ sparkline = valeur sur un jeu de lignes fixé ; e2e : le chiffre de `/` égale celui de `/sessions` pour la même URL de filtres |
| Pages vues | stat + sparkline | `count rum_pageview`, `started_at ∈ [from,to)` ; sparkline par seau | `cmp=prev` | ex. `overviewStats` ; sparkline : à créer `pageviewSeries(f)` (§ 4.5) | `KpiTile` `format="count" sensMeilleur="neutre"` | tuile → `/pages` | idem | sparkline a autant de points que `bucketStarts(range)` |
| Occurrences d'erreurs pour 100 pages vues | stat + sparkline ; ratio de **deux** comptes de la même fenêtre, affiché comme un nombre (il peut dépasser 100) et jamais comme une part | `100 × Σ occurrences navigateur / count(pageview)` ; numérateur `error_source like 'browser_%'` (CP14) ; sous-texte : « erreurs navigateur seulement ; N occurrences sans source déclarée et M erreurs serveur non comptées » (M, N lus, écrits seulement s'ils sont > 0) ; sans la colonne v69 (`restreint: false`) : numérateur toutes sources + « inclut les erreurs serveur sans page vue » ; sparkline : même ratio par seau (`errorSeries` / `pageviewSeries`, seau sans vue → `null`) | `cmp=prev` (ratio des deux lectures `shift`) | à créer `erreursNavigateur(f, shift)` et `errorSeries(f, shift)` (§ 4.5) ; dénominateur ex. `overviewStats(f).pageviews` | `KpiTile` `format="pour100" sensMeilleur="bas"`, **sans** `vital` (neutre, § 1.5 R-S) | tuile → `/errors` | 0 vue → `valeur: null`, `raisonNull="aucune page vue : ratio non calculable"` (corrige `app/page.tsx:L98`) | `tests/unit/perf-domain.test.ts` : 0 vue → « — » et la raison ; 30 occurrences pour 20 vues → « 150 pour 100 vues », jamais « 150 % » ; `tests/integration/perf-lectures-sql.test.ts` : une erreur `node` sans session n'entre pas au numérateur |
| LCP p75 · INP p75 · CLS p75 · FCP p75 · TTFB p75 | 5 stats avec verdict, sparkline p75 sur bande « Bon », effectif | `percentile_cont(0.75)` par nom ; n ; p50 ; sparkline : p75 par seau | `cmp=prev` : `vitalsP75(f,true)` ; `cmp=release` : `vitalsP75` sur `release=rel_a` / `rel_b` | ex. `vitalsP75(f)` `queries.ts:L46-66` ; sparkline : à créer `vitalSeriesN(f,name)` ×5 | `KpiTile` `vital=…` (bandes et verdict lus dans `THRESHOLDS`) ; `couverture={n, unite:"mesures", faibleSous:100}` ; `intervalle` à partir de P*.1 | tuile → `/pages?vital=<NOM>` | `p75` absent → `null` + « aucune mesure <NOM> sur <plage> » ; n < 100 → « échantillon faible · médiane <p50> » ; `echantillonne` si `samplingVitals` < 1 | annonce complète au lecteur d'écran (« LCP p75 2,7 s, À améliorer, +8 % vs 24 h précédentes, 1 240 mesures ») |
| Constats | liste repliée de phrases à règle publiée (pendant honnête de Watchdog) | anomalies z > 3 (24 h), verdict du dernier déploiement (±2 h, +20 %), alertes non acquittées, groupes d'erreurs régressés | la règle est la comparaison | ex. `healthScore(f).anomalies`, `latestDeployImpact(f)` `queries-deploys.ts:L61` + `assessRegression` L103, `unackedAlertCount(f)` `queries-v2.ts:L254`, `listErrorGroups(f,{limit:50,offset:0})` filtré `regressed` `queries-errors.ts:L825` ; identifiant d'événement des alertes : `alertFirings(f, 1)` (`jours = 1` ; à créer, § 4.5, lot F62 ; champs `event_id` et `acknowledged`) filtré `acknowledged = false`, 3 plus récents au plus | `InsightStrip` | chaque constat → sa destination : anomalie → `/pages?route=…&from=…&to=…` ; déploiement → `?cmp=release&rel_b=v&rel_a=v-1` ; alerte → une ligne par événement non acquitté (≤ 3, puis « et N autres » → `/alerts`), lien `/alerts?evt=<event_id>` (paramètre `evt`, § 3.1, livré par F64 et F67 ; **jamais** `fired=<id>`, qui est déjà le nombre d'alertes émises par « Évaluer maintenant », `app/alerts/page.tsx:L40-41, L79-90`) ; tant que F62, F64 ou F67 manque : un seul constat « N alertes non acquittées » (`unackedAlertCount`) → `/alerts` sans paramètre ; régression → `?panel=error:<fp>` | zéro constat → « Aucun constat automatique (règles : …) » ; déploiement : effectifs avant/après écrits ; fenêtre « 24 h fixes » dite | le compte s'affiche replié ; règle visible sur chaque ligne ; `grep -n "fired=" apps/console/components/InsightStrip.tsx apps/console/lib/presets.ts` vide (F27) |
| **Core Web Vitals dans le temps** (hero) | 3 petits multiples LCP / INP / CLS, un par vital, sur **bandes pleines** Bon/À améliorer/Mauvais ; petits multiples plutôt qu'un seul graphe : trois unités, trois échelles (Datadog, en mieux : INP au lieu de FID, échelle qui garde les données lisibles) | p75 par seau du contrat (5 min / 1 h / 6 h / 24 h selon `bucketSecondsFor`, `query-contract.ts:L230-235`) | `cmp=prev` : série grise pointillée alignée par rang de seau ; `cmp=release` : deux séries (orange = `rel_b`, gris = `rel_a`) | à créer `vitalSeriesN(f, "LCP"\|"INP"\|"CLS", shift)` ; release : `vitalSeriesN` sur la requête intersectée | `ThresholdSeries` ×3 (`vital`, `annotations`, `seauSecondes`, `fuseau="UTC"`, `zoomHref`) dans une `Figure` chacun | survol : valeur, n du seau ; clic seau → zoom `from/to` ; annotation → `cmp=release` ; `explorer` = `explorerHref(dataset=vitals, measure=value, variant=<NOM>, viz=timeseries)` | seau `n < 30` → point creux + légende « seau à faible effectif » ; seau absent → trou ; aucune mesure → `EtatSurface vide` ; déploiements hors lecture → `annotationsIndisponibles` | les 3 bandes sont visibles avec les données de démo (domaine y du § 4.2) ; aucune série sans alternative textuelle |
| Charge, erreurs et LCP | **3 panneaux empilés, axe x partagé, aucun axe secondaire** (P5) : (1) vues en barres empilées « chargements » / « changements de route SPA » (comptes additifs, CP17) ; (2) occurrences d'erreurs navigateur en barres ; (3) LCP p75 en ligne sur bandes. Répond à « la dégradation coïncide-t-elle avec la charge ou avec des erreurs ? » (idée IP-Label n° 5, `iplabel.md` L379 ; écart « pas de courbe combinée », `iplabel.md` § 3.1 ; contre-exemple Datadog à double axe, `datadog-images-1.md` L75-85). Mêmes annotations de déploiement sur les trois panneaux ; un survol montre la même heure sur les trois | (1) vues par seau ; (2) Σ occurrences `browser_%` par seau ; (3) LCP p75 par seau + n | `cmp=prev` : sur le panneau LCP seulement (série grise pointillée) ; sur (1) et (2), une pile de référence rendrait la figure illisible : delta dans les tuiles | à créer `pageviewSeries(f)`, `errorSeries(f)` (§ 4.5) ; `vitalSeriesN(f,"LCP")` (même appel que le hero, mutualisé) | trois panneaux dans **une** `Figure`, même `grille`, même `seauSecondes`, même `zoomHref`, mêmes `annotations`, marges `SERIE_MARGES` : (1) `StackedBars` à deux séries additives, chargements (`categorieIndex 0`) + changements de route SPA (`categorieIndex 1`) — tout empilement passe par `StackedBars` (§ 4.2) ; (2) `ThresholdSeries` une série `forme: "barres"`, `additive: true` ; (3) `ThresholdSeries` `vital="LCP"`, `effectifCle: "n"` | clic seau (n'importe quel panneau) → zoom `from/to` ; annotation → `cmp=release` | vide → `EtatSurface vide` par panneau (un panneau vide n'efface pas les autres) ; `errorSeries.restreint = false` → titre du panneau (2) « Occurrences d'erreurs, toutes sources (colonne de source absente) » ; `lecture` de la figure : « Le LCP n'est mesuré qu'au chargement ; les changements de route SPA comptent des vues sans LCP » | P5 : `grep -rn yAxisId apps/console/components/charts` vide ; trois `role="img"` avec alternative seau × (chargements, SPA, erreurs, LCP p75, n) ; e2e : les trois panneaux ont le même nombre de seaux |
| Heures × route en angle mort | tuile-lien : **compte exact** d'heures × route où le robot dit « ok » et le LCP p75 réel de la même heure est au-dessus de la borne Bon ; + la route qui en a le plus. Différenciateur IP-Label (`iplabel.md` L271-281). Aucune comparaison chiffrée robot / réel (mesures non comparables, § 1.5 DF1) | Σ `heures` des cellules `robot = "ok"` × `reel ∈ {"needs-improvement","poor"}` ; pire route = `anglesMortsParRoute[0]` | `cmp=prev` : même lecture sur `previousRange` si `correlationConcordance` (CR4, § 5.7) la fournit ; sinon aucune | à créer : `correlationConcordance(f)` (§ 5.7, CR8, lot **F57**) ; existence du robot : ex. `correlationCards(f)` `queries-v2.ts:L415-426` (au moins une ligne `syn_latency_avg != null`). **Jamais** `blindSpots` (plafonné à 50, CP13) | `KpiTile format="count" sensMeilleur="bas"` (neutre, § 1.5 R-S : pas de ton `bad`) + phrase « pire route : <route>, N heures » ; `lecture` = règle de CR9 (§ 5.7) importée : « Robot à l'état ok ET LCP p75 réel au-dessus de <THRESHOLDS.LCP[0] formaté> (borne Bon de `lib/rating.ts`) sur la même heure et la même route » | tuile → `/correlation#angles-morts` ; phrase « pire route » → `/correlation?serie=<valeur>` où `<valeur>` est la clé `anglesMortsParRoute[].serie` rendue par `correlationConcordance` (format `<app>:<route>` encodé, § 5.7 CR7-a) | aucune route robot → `EtatSurface non_collecte` « Non collecté : aucune sonde synthétique sur ces routes » ; F57 non livré → tuile absente, rien à la place (pas de repli sur `blindSpots`) ; 0 réel → « 0 » | `tests/integration/perf-lectures-sql.test.ts` (ou le test de F57) : 60 heures seedées robot ok × LCP 3 000 ms → la tuile affiche « 60 » ; la phrase de règle contient le texte de `formater("ms", THRESHOLDS.LCP[0])` |
| Segments les plus dégradés | `ImpactTable` : classement par **gravité** (IP-Label « Top offenders ») avec écart à l'ensemble ; onglets Route / Navigateur / Système / Pays estimé / Appareil / Release | pilote = p75 du vital `vital=` (défaut LCP) ; volume = `lcp_n` (ou `inp_n`/`cls_n`) ; colonnes LCP, INP, CLS p75 + n ; référence « Ensemble » = `vitalsP75(f)` | écart de p75 à l'ensemble | ex. `vitalsBreakdown(f, split, 200)` `queries-breakdowns.ts:L79` (CP1) ; tri `lib/impact.ts` | `ImpactTable` (`tri`, `triHref.impact = null` tant que B2 manque) | ligne route → `panel=route:<r>` sur `/pages` ; autre dimension → `/pages?<dim>=…` ; « Inconnu » → `seg=v2:<dim>:is_null` | onglet indisponible (colonne absente) → barré + raison (`breakdownTabs`) ; troncature CP1 dite ; ligne n < 30 en fin | test : ligne n = 12 après ligne n = 400 ; `tri=volume` rend l'ordre volume |
| Nouvelle release face à la précédente | deux colonnes A / B, une ligne par mesure, écart et verdict de chaque côté | sessions, LCP p75, INP p75, taux de sessions en erreur (`sessionsEnErreur/sessions`) | release contre release, même fenêtre | ex. `comparaisonVersions(f,12)` `queries-deploys.ts:L162` (mapping `lcp→lcp_p75`, `inp→inp_p75`, `cls_p75` absent → ligne CLS « non lue par cette comparaison ») ; choix de B par CP3 | `ReleaseCompare` (+ lien « Toutes les versions » → `VersionsTable` replié) | liens `hrefs.a/b` → écran filtré sur chaque release | < 2 releases → désactivé avec raison ; phrase obligatoire « même fenêtre, sans normalisation de trafic » ; `source` écrite | la règle de choix de `rel_b` est affichée sous le titre |
| Historique 14 jours | heatmap jour × heure (seule vue où jour ET heure comptent, `grafana.md` règle 6) ; **échelle séquentielle** `SEQUENTIELLE` (`lib/palette.ts`, F01), plus de vert / ambre / rouge : 0,9 et 0,5 ne sont pas des seuils publiés (§ 1.5 R-S) | part pondérée de mesures « Bon » (LCP ×2), 14 j fixes, jours et heures **dans le fuseau de l'app** (`queries-grid.ts:L64-68, L74-76`) | — | ex. `healthGrid(f)` `queries-grid.ts:L60` ; bornes de chaque case converties en instants UTC côté serveur (`(jour + heure) at time zone <tz>`), fonction commune `bornesHeureLocale(jour, heure, tz)` de `lib/fuseau.ts` (F05, § 4.4) | `HealthHeatmap` (§ 4.1 : échelle séquentielle, cases cliquables, alternative) ; légende : « % de mesures Bon, pondéré » | case → `from/to` = les instants UTC de l'heure locale ; `Figure.meta` de l'écran d'arrivée : « 09:00-10:00 Europe/Paris (07:00-08:00 UTC) » (§ 3.3) | fenêtre fixe dite en tête (« 14 jours fixes, indépendants de la période ; le jour en cours est incomplet ») ; case vide = « aucune donnée » | `tests/unit/fuseau.test.ts` (F05) : fuseau `Europe/Paris`, case 9 h un jour d'été → `from=…T07:00:00Z` ; la mention « 14 jours fixes » est visible sans survol |
| Anomalies LCP (24 h) | table (valeurs comparables en colonnes) | route, heure, p75, moyenne 7 j, z | vs moyenne 7 j | ex. `healthScore(f).anomalies` | `AnomalyTable` (conservé), dans `<details id="anomalies">` | ligne → `/pages?route=…&from=…&to=…` | aucune → la section affiche « Aucune anomalie (règle : z > 3, ≥ 5 h d'historique) » au lieu de disparaître | la section existe toujours (P6 : l'absence est une information) |

#### 5.1.3 Conservé, disparaît

- **Conservé** : bandeau santé à formule (`HealthBanner`), « échantillon faible · médiane », onglets de
  dimension avec notices de provenance (`BREAKDOWN_NOTICES`), « Inconnu » groupe à part, refus d'une
  comparaison de versions sous deux versions, heatmap et sa bascule « Heures ouvrées », roue de blocs
  (`dashboard-blocs.ts`) : chaque zone 5-9 reste un bloc désactivable, lu avant les requêtes.
- **Disparaît** : `VitalCard` à l'usage (remplacé par `KpiTile` avec sparkline ; l'intervalle ajouté à `VitalCard` par P*.1 0-b passe à `KpiTile.intervalle`) ; hero « Sessions · Pages
  vues · Taux d'erreur + courbe LCP » (`app/page.tsx:L149-187`, remplacé par zones 2 et 5) ; « Volume &
  fiabilité par jour » à double axe et « p75 LCP par jour » (remplacés par la zone 6 sur la fenêtre
  courante ; le quotidien 14 j vit sur Tendances `/forecast`, § 5.20) ; phrase « bande verte
  sous 2,0 s » (fausse, `console-identite.md` L473) ; bloc « Décomposition réseau » (déplacé sur Pages, là
  où la question du TTFB se pose).
- **Disparaît aussi** : le compte « Sessions » par dernière activité (`overviewStats.sessions`)
  sur cet écran (une population différente de `/sessions`, CP6) ; le libellé « taux d'erreur » en % (un
  ratio d'occurrences n'est pas une part) ; le facteur de santé « Erreurs JS » qui comptait les erreurs
  serveur (CP14) ; tout compte lu dans `blindSpots` (CP13) ; le vert / ambre / rouge de la heatmap.
- **Écarté ou reporté, avec raison** (voir aussi § 1.7) : heatmap « distribution du LCP dans
  le temps » (une queue qui s'allonge sans que le p75 bouge) — reportée : il faudrait un histogramme
  par seau (`vitalHistogram` n'a pas de dimension temps, `queries.ts:L96`) ; à rouvrir comme demande
  backend si le hero ne suffit pas. Type de réseau : `rum_session.net_type` existe
  (`apps/ingest/sql/migration-v53.sql`) mais n'est pas une dimension de `vitalsBreakdown` : onglet non ajouté, noté pour B8 (§ 6.3).

### 5.2 Pages `/pages` (+ panneau route)

**Question.** « Quelles pages font attendre, pour qui, et depuis quand ? »
**Question suivante.** « Pourquoi cette page est lente : réseau, ressources, fil principal ? » → panneau
route, puis « Qui la subit ? » → `/sessions?route=…`.

**Référence.** IP-Label pour le classement par gravité et les vues par vital (`iplabel.md` L56-58, L96-98) ;
Datadog pour la distribution avec repères de percentiles et le panneau qui situe une valeur dans sa
population (`datadog-docs-explorer-dashboards.md` § 5.2) ; Grafana pour « histogramme = forme, barres =
classement » (`grafana.md` règle 7). La troncature-diagnostic des routes (`app/pages/page.tsx`
L85-101) est **nôtre, conservée**.

#### 5.2.1 Grille

| Ordre | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| 1 | `PageHeader` + `PresetBar` + sélecteur « Vital » (`Segmented` exporté : LCP INP CLS FCP TTFB) | pleine largeur | idem | `Segmented` défile |
| 2 | Bandeau de troncature (si > 200 routes) | pleine largeur | idem | idem |
| 3 | KPI ×3 | 3 colonnes | 3 | 1 colonne |
| 4 | **Hero** « Routes classées par <vital> » | pleine largeur, 12 lignes visibles | idem | barres + libellé, table repliée |
| — | *pli à 1440 × 900 : titre et ≈ 8 premières lignes du hero* | | | |
| 5 | « Distribution <vital> » ×3 (LCP INP CLS) | 3 colonnes | 3 empilés | empilés |
| 6 | « Percentiles par vital » | pleine largeur | défilement interne | idem |
| 6 bis | « Vues par type de navigation » | pleine largeur | idem | table repliée, barres + libellé |
| 7 | « D'où vient le TTFB » · « Tâches longues » | 5/12 · 7/12 | empilés | empilés |
| 8 | « Ressources lentes » | pleine largeur | idem | idem |
| — | Panneau `panel=route:` | 50 % à droite (≥ 1280) | plein écran | plein écran |

Un sommaire d'ancres (Distribution · Percentiles · Navigation · Réseau · Fil principal · Ressources) sous l'en-tête
répond à « page longue sans ancre » (`console-ecrans-1.md` L143).

#### 5.2.2 Widgets

| Libellé exact | Graphique et pourquoi | Mesure · agrég. · dims · grain | Cmp | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| <vital> p75 (ensemble) | stat + verdict + sparkline | p75 du vital choisi | `cmp` courant | ex. `vitalsP75` ; à créer `vitalSeriesN` | `KpiTile vital=…` | — (déjà sur l'écran) | comme § 5.1.2 | la tuile suit `vital=` |
| Routes au-delà de « Bon » | stat : compte de routes dont le p75 du vital dépasse la borne basse, **sur les routes non faibles** | `count(route où p75 > THRESHOLDS[v][0] et n ≥ 30)` / nombre de routes classées | `cmp=prev` : même calcul sur `shift` (à créer : `vitalsBreakdown` accepte `shift`, B12, § 6.3 ; sans lui : pas de delta, « sans référence : lecture non disponible ») | ex. `vitalsBreakdown(f,"route",200)` ; `nombreDeRoutes(f)` `queries.ts:L255` | `KpiTile format="count"` + phrase « sur N routes classées, M à faible effectif » | tuile → tri gravité du hero | 0 route → « aucune route mesurée » ; CP2 pour FCP/TTFB | le dénominateur est écrit dans la tuile |
| Pages vues | stat + sparkline | vues | `cmp` | ex. `overviewStats` ; `pageviewSeries` | `KpiTile` neutre | — | — | — |
| **Routes classées par <vital>** (hero) | `ImpactTable` : un classement est un classement (barres), jamais N courbes (P14) | pilote = p75 du vital par route ; volume = n mesures du vital ; colonnes : LCP, INP, CLS p75 (pastilles), vues, tâches longues ; écart à l'ensemble | écart de p75 à l'ensemble | ex. `vitalsBreakdown(f,"route",200)` pour p75 + n (CP1) ; `slowRoutes(f)` `queries.ts:L207` pour vues et tâches longues (jointure côté serveur sur `route`) ; troncature : `nombreDeRoutes` | `ImpactTable` (onglets absents : une seule dimension ici) ; sous-texte par ligne « 1 ressource bloquante » depuis `slowResourcesByRoute` `queries.ts:L278` | ligne → `panel=route:<route>` ; « Ouvrir en page » → `/pages?route=` | FCP/TTFB → « classement non disponible » (CP2) ; n < 30 en fin ; ligne « Ensemble » en tête | une seule liste de routes sur l'écran (les trois listes actuelles fusionnent) ; clic ligne ouvre le panneau (e2e) |
| Distribution LCP · INP · CLS | histogramme SSR coloré par zone + repères p50/p75/p95 : la forme se montre (P7) | 20 bacs linéaires sur [0, plafond] (`VITAL_CAP` LCP 6000, INP 1000, CLS 1) ; n | — (une distribution ne se compare pas bac à bac entre fenêtres de volumes différents : non spécifié) | ex. `vitalHistogram(f,name,cap,20)` `queries.ts:L96` + `vitalPercentiles(f)` L75 | `DistributionSeuils` | bacs non cliquables ; lien secondaire « Voir les mesures dans l'Explorer » (journal `viz=table`, **ordonné par date** : le tri par valeur n'existe pas, § 5.21 W-E6) | n = 0 → vide ; barre « ≥ plafond » dite ; plafond d'affichage : `VITAL_CAP` par défaut, et `p99` arrondi au multiple de 100 ms supérieur (0,05 pour CLS) quand `p95 < VITAL_CAP / 10`, sans quoi toute la démo (LCP p75 44 ms) tombe dans le premier bac ; le plafond retenu est écrit sous l'axe et dans l'alternative ; `vital=FCP/TTFB` : 3ᵉ graphique remplacé par la distribution du vital choisi (plafonds FCP 6000, TTFB 3000 existent, `lib/distribution.ts:L16-17`) | repères p50/p75/p95 visibles et étiquetés ; alternative = bacs, bornes, n |
| Percentiles par vital | table (comparaison précise de valeurs) | p50, p75, p90, p95, p99 + n par vital | — | ex. `vitalPercentiles(f)` | `PercentileTable` (`scope`, colonne n, § 4.1) | — | cellule `null` → « — » | `<th scope>` présents |
| Vues par type de navigation | classement en barres par route, chaque barre découpée en deux segments additifs « chargement » (`nav_type` ∈ `navigate`, `reload`, `back_forward`) et « changement de route SPA » (`nav_type = 'spa'`) ; répond à « quelle part des vues de cette route n'a pas de LCP ? » (Datadog « Initial page load vs SPA route changes », qui ne donne pas la route) | par route : vues par classe de navigation, `count` ; ligne « Ensemble » en tête ; 12 routes au plus, par volume décroissant | — | à créer `vuesParNavType(f): Promise<{ route: string \| null; chargements: number; spa: number; inconnu: number }[]>` dans `lib/queries.ts` (sur `sqlContext`, `rum_pageview.nav_type`, colonne du schéma initial `apps/ingest/sql/schema.sql:31`, valeurs `navigate/reload/back_forward/spa`) | `RankBar` avec `segments` (couleurs `CATEGORIELLE`) + phrase fixe « Le LCP n'est mesuré qu'au chargement : les changements de route SPA comptent des vues sans LCP (`packages/rum-sdk/src/vitals.ts:L5, L59`, `index.ts:L502-522` ; à revérifier dans le SDK au début de F15) » | barre → `panel=route:<r>` | `nav_type` nul → segment « type inconnu » nommé, jamais versé dans « chargement » ; aucune vue → vide | alternative : route, chargements, SPA, inconnu ; `tests/integration/perf-lectures-sql.test.ts` : 3 vues `spa` + 2 `navigate` sur une route → segments `[2, 3]` |
| D'où vient le TTFB | barres horizontales **non empilées**, une par phase (REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE) ; **pas d'empilement** : les p75 de phases ne s'additionnent pas — la somme de six p75 n'est pas le p75 du TTFB. Des barres séparées répondent à « quelle phase est la plus longue » sans suggérer une décomposition exacte | p75 de chaque phase + n | `cmp=prev` : écart par phase en colonne | ex. `vitalsP75(f)` (le `group by m.name` renvoie aussi les phases, `queries.ts:L46-66`, `rating.ts` commentaire L14-33) | `RankBar` (sans `segments`) + phrase « chaque barre est le p75 d'une phase mesurée à part ; leur somme n'est pas le TTFB » | — | phase absente (navigateur qui ne l'expose pas) → ligne « — » avec n = 0 ; aucune phase → `non_collecte` | aucune barre empilée ; phrase présente |
| Tâches longues dans le temps | 2 panneaux empilés, axe x partagé : barres LoAF / Long Tasks / non distinguées (comptes, **jamais additionnés** entre API), puis ligne p75 du blocage | comptes par seau et API ; p75 blocage par seau | — | ex. `longtaskSeries(f)` `queries-longtasks.ts:L31` (`p75_ms` L27) | `LongtasksView` conservé ; ajout d'une `ThresholdSeries` sans vital pour `p75_ms` | seau → zoom ; annotations de déploiement sur les deux panneaux (P9) | vide → « Aucun blocage mesuré… Chromium » (existant) | le p75 par seau n'est plus seulement dans la table repliée |
| Pires blocages | table | 10 pires | — | ex. `worstLongtasks(f)` L81 | table existante | ligne → `panel=session:<id>` | « sans session rattachée » | inchangé hors panneau |
| Ressources lentes | tables par type / hôte + part 1ʳᵉ/3ᵉ partie | n, p75, octets ; ≤ 15 lignes | — | ex. `resourcesVue(f)` `queries-resources.ts:L74` | `ResourcesView` conservé | — | avertissement de seuil **avant** les chiffres (existant) ; `softFail` retiré (F02) | inchangé, sauf `SectionErreur` |

#### 5.2.3 Panneau route (`panel=route:<route>`)

`DetailPanel type="route"`, titre = route (`chip-mono`), puces : vues, n mesures, release dominante
(non : **non calculée**, retirée — aucune source ; seules les puces sourcées restent).

| Bloc | Graphique | Src | Critère |
|---|---|---|---|
| « <vital> sur cette route » | `ThresholdSeries vital` + référence pointillée = série de l'ensemble (même seaux) | à créer `vitalSeriesN` sur la requête intersectée `route=` | deux séries au plus |
| « Où se situe cette route » | `DistributionSeuils` **de la route**, `valeurMarquee = {valeur: p75 ensemble, libelle: "p75 toutes routes"}` : la route est lue contre la population nommée (§ 3.5) | ex. `vitalHistogram` + `vitalPercentiles` sur `route=` | libellé de population visible |
| « Vu par le robot » | trois lignes d'**états**, aucune valeur robot en ms à côté d'un LCP (mesures non comparables, § 1.5 DF1) : « Robot : <ok / warn / incident> (pire état sur la plage) » · « Réel : LCP p75 <valeur>, <verdict `rating2026`> » · « Heures en angle mort : N » ; règle d'angle mort de CR9 (§ 5.7) en `title` et en sr-only | état robot : ex. `correlationCards(f)` `queries-v2.ts:L415-426` filtré sur la route (`syn_state` = pire état de la plage, L405-406) ; réel : ex. `vitalsP75` sur la requête intersectée `route=` ; heures : à créer `correlationConcordance(f).anglesMortsParRoute` (§ 5.7, F57), ligne de la route (absente → 0) | absent (aucune ligne robot) → « Aucune sonde synthétique sur cette route » ; sous `app=all`, une ligne par app si la route existe dans plusieurs apps ; F57 non livré → ligne « Heures en angle mort » absente ; lien « Voir robot et réel » → `/correlation?serie=<clé>` (clé `anglesMortsParRoute[].serie`) |
| « Ressources lentes de la route » | liste ≤ 3 (url, type, moyenne, bloquante) | ex. `slowResourcesByRoute(f)` | libellé « durée moyenne » (c'est une moyenne : dit) |
| « Erreurs sur la route » | 3 premiers groupes | ex. `listErrorGroups` sur requête intersectée `route=` | lien `/errors?route=` |
| Liens | « Sessions sur cette route » → `/sessions?route=` ; « Ouvrir en page » → `/pages?route=` | — | filtres conservés |

`RoutePanel` — `components/perf/RoutePanel.tsx` (SSR). Fonction serveur locale à la route `/pages`, non
réutilisée ailleurs : elle assemble `DetailPanel type="route"` (§ 4.2) avec les 5 blocs du tableau
ci-dessus, à partir des données déjà chargées par la page. Pas de props publiques au sens du § 4.
Pour que l'exécutant n'ait rien à deviner, sa signature interne est fixée ici (non exportée hors de
`app/pages/`) :

```ts
// Appelée depuis app/pages/page.tsx quand panel=route:<r> est lu (lib/view-state.ts).
export async function RoutePanel(props: {
  route: string;                 // valeur décodée de panel=route:<r>
  f: Filters;                    // filtres de la page, sans condition route
  query: AnalyticsQuery;         // pour hrefWithQuery / intersectQuery (§ 3.3)
  vital: VitalName;              // vital= de la page (défaut LCP)
}): Promise<JSX.Element>;
```

Elle lit elle-même, en parallèle et chacune derrière `lire()` + `SectionErreur` (un bloc en échec
n'efface pas les autres) : `vitalSeriesN` (route et ensemble), `vitalHistogram` + `vitalPercentiles`
(route), `correlationCards` + `correlationConcordance`, `slowResourcesByRoute`, `listErrorGroups`
(intersecté `route=`, `limit: 3`). « Déjà chargées par la page » vaut pour le p75 de l'ensemble
(`vitalsP75`), passé par `f` et relu en cache de requête : non établi que `lib/queries.ts` mette en
cache ; si ce n'est pas le cas, un second appel est accepté (coût d'une requête).

#### 5.2.4 Conservé, disparaît

- **Conservé** : bandeau de troncature diagnostic, `ResourcesView` (échantillon biaisé annoncé),
  `LongtasksView` (pas de cumul, LoAF/Long Tasks séparés, lien vers session), `PercentileTable`, mention
  Chromium.
- **Disparaît** : hero `RankBar` des 8 routes sans lien et tuile « Route la plus lente » en orange fixe
  (`tone="warn"` permanent, `console-ecrans-1.md` L138) ; bloc « Web Vitals par dimension » (doublon :
  la même analyse vit sur la Vue d'ensemble) ; table « Par route » (fusionnée dans le hero).

### 5.3 Erreurs et issues `/errors`, `/errors/[fingerprint]`, `/errors/issues/[id]`

**Question.** « Quelles erreurs touchent le plus de sessions, depuis quand, et après quelle release ? »
**Question suivante.** « Qu'ont en commun les sessions touchées, et que voit-on dans l'une d'elles ? »
→ panneau erreur → session / rejeu / trace.

**Référence.** Datadog Error Tracking pour la phrase d'impact, les versions touchées, l'analyse de
contraste et le chaînage erreur → rejeu (`datadog-images-1.md` § 2.3-2.5 ;
`datadog-docs-errors-replay-frustration.md` § 1.4) ; IP-Label « Error & Release Monitoring » pour
l'ancrage release (`iplabel.md` L59-61). **Nôtre, conservé** : « Inconnu » ≠ 0 personne, couverture
d'identité, symbolication expliquée, échantillonnage sans extrapolation, ambiguïté d'empreinte résolue
par un choix (`console-ecrans-1.md` L183-187, L238-244).

#### 5.3.1 Grille (`/errors`)

| Ordre | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| 1 | `PageHeader` + `PresetBar` + notices (`ErrorNotices` : échantillonnage, enrichissement) | pleine largeur | idem | idem |
| 2 | KPI ×4 | 4 colonnes | 2 × 2 | 2 × 2 |
| 3 | **Hero** « Occurrences dans le temps, par groupe » | pleine largeur, 240 px | idem | idem, légende sous le graphe |
| — | *pli à 1440 × 900 : hero entier* | | | |
| 4 | « Groupes » (liste) | pleine largeur | table défilante, colonne « Sessions » en 2ᵉ position | **cartes** empilées (voir critère) |
| 5 | « Répartition » (`Breakdown`) | pleine largeur | idem | idem |

#### 5.3.2 Widgets de la liste

| Libellé exact | Graphique et pourquoi | Mesure · agrég. · dims · grain | Cmp | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| Occurrences | stat + sparkline | `totals.occurrences` = sum(occurrences) | `cmp=prev` : `listErrorGroups` sur `previousRange` (à créer : option `shift` de `listErrorGroups`, ou second appel avec requête décalée — non établi lequel est le moins coûteux, F18 tranche) | ex. `listErrorGroups(f, page, {series:true})` `queries-errors.ts:L825` ; sparkline = `trend` | `KpiTile format="count" sensMeilleur="bas"` neutre (§ 1.5 R-S) | — | 0 réel → « 0 » | le libellé dit « Occurrences » et vient d'un `sum` (V1) |
| Sessions touchées | stat | `totals.sessions_affected` (`null` = aucune connue) | `cmp=prev` | ex. `ErrorTotals` `queries-errors.ts:L156-163, L197-200` | `KpiTile` ; `couverture` = `session_coverage` écrite (« 62 % des occurrences rattachées à une session ») | → liste triée | `null` → « Inconnu » + « aucune occurrence rattachée à une session (erreurs backend, par exemple) » | jamais « 0 » quand `null` |
| Part des sessions touchées | stat avec **dénominateur nommé** (Datadog le laisse non établi, `datadog-images-1.md` L254-257) ; numérateur **inclus** dans le dénominateur | `touchees / base` : `base` = sessions ayant ≥ 1 vue commencée dans `[from,to)` ; `touchees` = sessions **de cette base** ayant ≥ 1 occurrence dans `[from,to)` (jointure, jamais deux comptes indépendants) | `cmp=prev` (même lecture `shift`) | à créer `partSessionsTouchees(f)` (§ 4.5) ; règle de valeur `partTouchees` (§ 4.4) | `KpiTile format="pct"` + phrase « S sessions avec vue et au moins une erreur, sur T sessions avec au moins une vue » | — | `base = 0` → `null` « aucune session avec vue sur <plage> » ; `tauxMin < 1` → `null` « erreurs et vues échantillonnées différemment : part non calculable » (CP15) ; lecture en échec → `SectionErreur` | `tests/integration/perf-lectures-sql.test.ts` : une session `sample_rate=0,1`, `error_sample_rate=1` dans la base → `null` ; une session touchée sans vue dans la fenêtre n'entre pas au numérateur ; `tests/unit/perf-domain.test.ts` : `partTouchees` ne renvoie jamais > 1 |
| Groupes apparus sur la période | stat | nombre de groupes dont `first_seen ∈ [from,to)` | `cmp=prev` | à créer `nouveauxGroupes(f): Promise<number>` (même CTE `origine`, `queries-errors.ts` ~L620-637) | `KpiTile format="count"` | tuile → liste filtrée « nouveaux » (à créer, paramètre d'écran `nouveaux=1`) | — | « apparus » = première occurrence **conservée** dans la fenêtre ; phrase sous la tuile : « un groupe plus ancien que la rétention dont les premières occurrences ont été purgées peut apparaître comme nouveau » |
| **Occurrences dans le temps, par groupe** (hero) | barres empilées : les occurrences sont **additives**, l'empilement est vrai ; **4 groupes + « Autres groupes (somme) » = 5 séries au plus** (P14) | occurrences par seau ; les 4 groupes sont les **4 plus fréquents par occurrences dans la fenêtre** (pas les 4 premiers de la liste, triée par statut, CP9) ; « Autres groupes » = `trend − Σ4` borné à 0 | annotations de déploiement ; `cmp=prev` : **non** superposé (une pile de référence illisible) → delta dans la tuile seulement | à créer `topGroupesSeries(f, 4): Promise<{ groupes: { ref: ErrorGroupRef; message: string \| null; error_type: string \| null; occurrences: number; series: number[] }[] }>` dans `lib/queries-errors.ts` : `order by sum(occurrences) desc limit 4` sur la fenêtre, séries sur la grille de `trend` (même zéro-remplissage que `withSeries`, `queries-errors.ts:L808-818`) ; `trend` ex. (L180-181, L684) | `StackedBars` (avec `annotations`, § 4.2) dans une `Figure` ; légende = **message** tronqué à 40 car. + empreinte courte (corrige « ● Error » ×5, `console-ecrans-1.md` L191) ; titre de légende « 4 groupes les plus fréquents sur <plage> » | clic segment → `panel=error:<fp>` ; « Autres groupes » non cliquable (ce n'est pas un groupe) ; clic seau → zoom | vide → « Aucune erreur sur <plage> » ; ≤ 4 groupes dans la fenêtre → pas de série « Autres » ; alternative : seau × groupe | `tests/unit/perf-domain.test.ts` (`autresGroupes`) : « Autres » = trend − Σ4 borné à 0 ; `tests/integration/perf-lectures-sql.test.ts` : un groupe résolu à 500 occurrences figure parmi les 4 devant un groupe régressé à 3 ; ≤ 5 séries ; aucune légende ambiguë |
| Groupes | table (triable, dense) ; une ligne = une cause | par groupe : type + message, occurrences, sessions, visiteurs, sparkline (**échelle commune** aux lignes, max dit), première vue (depuis toujours), dernière vue, statut, badge régression ; en mode issue : première / dernière release | tendance par sparkline | ex. `ErrorGroupRow` `queries-errors.ts:L165-182` ; issues : `listIssues` `lib/error-issues.ts:L384` | table existante / `IssueList` ; `Sparkline` générique avec `max` partagé (§ 4.2) | ligne → `panel=error:<fp>` (ou `issue:<id>`) ; « Ouvrir en page » | ordre par défaut = celui du SQL (CP9), **écrit** en caption : « régressées, puis ouvertes, puis par visiteurs touchés » ; pagination existante ; `unfingerprinted` dit | à 390 px : une carte par groupe, occurrences et sessions visibles sans défilement horizontal (e2e) |
| Filtres du mode historique | formulaire GET (statut, source) — aujourd'hui absent en historique (`console-ecrans-1.md` L190) | — | — | statut : `error_status` via `listErrorGroups` (filtrage à créer : option `statut`) ; source : `error_source` n'est pas une dimension du contrat → à créer `seg` non supporté ; **décision** : n'ajouter que le statut (une requête), la source reste réservée au mode issue | `INPUT_CLASS` | — | — | aucun filtre ignoré en silence |
| Répartition | `Breakdown` par dimension (occurrences, sessions, signatures ; trois populations, pas de somme) | `errorsBreakdown(f, split)` | — | ex. `queries-breakdowns.ts:L119` | `Breakdown` (conservé, notice « le statut ne découpe pas » conservée) | barre → écran filtré | onglet indisponible barré | inchangé + `tri` (§ 4.1) |

#### 5.3.3 Panneau erreur (`panel=error:<fp>`) et page `/errors/[fingerprint]`

Même contenu ; le panneau en montre les blocs 1 à 5, la page tous.

| # | Bloc | Graphique | Src | États / critère |
|---|---|---|---|---|
| 1 | En-tête | type + message, empreinte · app, badge source et « gérée / non gérée » du dernier exemplaire (existant, page L146-159) ; bouton **« Voir le rejeu »** de premier niveau = première occurrence ayant `links.replay` → `/sessions/<id>?tab=replay&at=<ms>` | ex. `errorGroupDetail(ref,f,page)` `queries-errors.ts:L920` (`occurrences[].links`, L261-281) | aucun rejeu → bouton absent et texte « aucune occurrence de la fenêtre n'a de rejeu » |
| 2 | Phrase d'impact | « **N occurrences** sur <plage>, touchant **S sessions** et **V visiteurs** ; x % des T sessions avec au moins une vue » — chiffres en lien. S et V viennent de `ErrorImpact` (toutes sessions portant l'erreur) ; x % vient de `partSessionsTouchees(f, ref)` (sessions **de la base** portant l'erreur) : les deux nombres sont écrits dans deux propositions séparées pour ne pas lire S / T | `group` (`ErrorImpact`) + à créer `partSessionsTouchees(f, ref)` (§ 4.5) | `null` → « Inconnu » dans la phrase, jamais 0 ; part `null` → la proposition « x % … » est remplacée par sa raison (« part non calculable : erreurs et vues échantillonnées différemment ») ; test `tests/integration/perf-lectures-sql.test.ts` : part ≤ 100 % pour tout groupe seedé |
| 3 | « Versions touchées » | deux lignes : « Première release vue : <v> · <date> » / « Dernière : <v> · <date> » ; distingue régression et dette (Datadog, `datadog-images-1.md` L239-245) | issue : `first_release`, `last_release` (`error-issues.ts:L206-207`) ; historique : à créer `releasesDuGroupe(ref, f): Promise<{ premiere: {release, ts} \| null; derniere: {release, ts} \| null }>` | release absente → « release non déclarée » |
| 4 | « Occurrences dans le temps » | barres (compte discret : la barre dit zéro là où une ligne interpole) + annotations de déploiement ; même fenêtre que l'écran (pas de fenêtre propre, § 3.5) | ex. `detail.trend` | `ThresholdSeries` une série `forme: "barres"`, `additive: true` ; alternative par seau |
| 5 | « Qu'ont en commun les sessions touchées ? » | `ContrastBars` par route, navigateur, release (ratio touchés / base) | **B3** (backend : manque) | avant B3 : **repli honnête** = répartition des occurrences **affichées** (≤ 100) par route / release / appareil, titrée « Répartition des 100 dernières occurrences (pas de la population) » ; `ContrastBars.indisponible` = « base de comparaison non lue (B3) » |
| 6 | Pile du dernier exemplaire | existant (`ErrorStackCard`, symbolication expliquée) | ex. `detail.last` | inchangé |
| 7 | Occurrences | table existante (`ErrorOccurrences`) + colonnes `is_fatal`, `view_name` (déjà lus, `queries-errors.ts:L274-275`) | ex. | liens session / rejeu / trace inchangés |
| 8 | Triage | `ErrorTriage` ; date de résolution affichée (`resolved_at`, L177) | ex. | viewer / démo : boutons absents (V9) |

Page `/errors/issues/[id]` : mêmes blocs 2-7 + « État de l'issue », triage/assignation, tickets,
activité (existants, `app/errors/issues/[id]/page.tsx` L110-279). `not-found.tsx` en français pour les
deux pages (F02) : « Groupe introuvable : purgé par la rétention, autre application, ou empreinte
antérieure au regroupement » + lien « ← Tous les groupes ».

#### 5.3.4 Conservé, disparaît

- **Conservé** : `ErrorNotices`, couverture d'identité, `GroupChooser` (ambiguïté), `ErrorStackCard`,
  « (depuis toujours) » sur Première vue, frontière d'erreur qui refuse le partiel.
- **Disparaît** : `GroupSparkline` (→ `Sparkline` à échelle commune) ; tuile « Pic par 6 h » (l'information
  est dans le hero) ; `ObservedTrend` sans axe du détail ; sept tuiles `ErrorStat` en une rangée
  (`xl:grid-cols-7`) du **détail** → phrase d'impact + 4 tuiles (Occurrences, Sessions, Visiteurs, Couverture identité) ; la liste garde ses 4 tuiles du § 5.3.2.

### 5.4 Interactions `/ux` (onglet Frustration) et `/actions` (onglet Actions)

**Question.** « Quels gestes échouent, restent sans réponse ou font attendre ? »
**Question suivante.** « Sur quelle page, et quel code bloque ? » → panneau route (Pages) ; scripts
bloquants ; session d'exemple.

**Référence.** Datadog frustration signals pour la typologie (`datadog-docs-errors-replay-frustration.md`
§ 3) ; **nôtre, conservé** : règles chiffrées écrites à l'écran (Datadog ne publie aucune fenêtre pour le
dead click, § 3.1 de la même lecture) et chaîne élément → script → fonction (`console-ecrans-1.md`
L291-293).

Onglets internes (§ 2.2) : `components/sessions/TabLink.tsx` réutilisé, « Frustration » → `/ux`,
« Actions » → `/actions`, filtres conservés par `hrefWithQuery`.

#### 5.4.1 Grille — Frustration

| Ordre | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| 1 | En-tête + onglets + `PresetBar` | | | onglets en 2 liens pleins |
| 2 | KPI ×4 (rage, dead, error, INP p75) | 4 col. | 2 × 2 | 2 × 2 |
| 3 | « Règles de détection » (texte replié à 1 ligne, dépliable) | pleine largeur | idem | idem |
| 4 | **Hero** « Routes les plus frustrantes » | pleine largeur | idem | table repliée |
| — | *pli à 1440 × 900* | | | |
| 5 | « INP p75 dans le temps » · « Éléments responsables de l'INP » | 6/12 · 6/12 | empilés | empilés |
| 6 | « Scripts qui bloquent le fil principal » | pleine largeur | idem | idem |

#### 5.4.2 Widgets — Frustration

| Libellé exact | Graphique et pourquoi | Mesure · agrég. · dims · grain | Cmp | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| Rage clicks · Dead clicks · Error clicks | 3 stats neutres (§ 1.5 R-S) + sessions concernées en sous-texte (« 14 signaux, 9 sessions » distingue l'acharné des bloqués, `console-ecrans-1.md` L299) ; **population = sessions dont le capteur émet les signaux** (CP16), dite sous la rangée | compte par type + sessions distinctes, sur les sessions dont `runtime` ≠ `MOBILE_RUNTIME` (`"react_native"`, `queries-mobile.ts:L35`, liée en paramètre) ou `runtime` null (navigateur, ingestion antérieure à v82) | `cmp=prev` | à créer `frustrationTotaux(f, shift=false): Promise<{ parType: { kind: "rage"\|"dead"\|"error"; n: number; sessions: number }[]; capteur: { sessionsCouvertes: number; sessionsTotal: number; runtimeLu: boolean } }>` (CP5, CP16) ; `sessionsTotal` = sessions commencées dans la fenêtre ; `sessionsCouvertes` = celles dont `runtime` n'est pas `react_native` ; `runtimeLu = false` si la colonne v82 manque | `KpiTile format="count"` ×3 | tuile → hero filtré sur le type (paramètre d'écran `type=`) | `sessionsTotal > 0` et `sessionsCouvertes = 0` → `EtatSurface non_collecte` « Non collecté : le SDK mobile n'émet pas de signaux de frustration » (pas de « 0 ») ; `0 < sessionsCouvertes < sessionsTotal` → `EtatSurface partiel` « compté sur les sessions navigateur seulement (N sur M) » ; tout couvert et type sans ligne → 0 réel ; `runtimeLu = false` → comptes affichés + `partiel` « capteur non identifiable (colonne `runtime` absente) : un 0 peut venir d'un capteur qui n'émet pas » ; lecture en échec → `SectionErreur` (fin du `softFail`) ; ligne fixe sous la rangée : « Un SDK configuré avec `frustration: false` envoie 0 sans que la console puisse le savoir » (`packages/rum-sdk/src/types.ts:L81-82`) | `tests/integration/perf-lectures-sql.test.ts` : la somme n'est plus calculée sur les 50 lignes de `topFrustrations` (60 couples seedés) ; 3 sessions `react_native` seules → `non_collecte` ; 2 navigateur + 1 `react_native` → `partiel` « 2 sur 3 » ; e2e : aucun « 0 » visible sous `non_collecte` |
| INP p75 | stat + verdict + sparkline | p75 INP | `cmp` | ex. `vitalsP75` ; `vitalSeriesN(f,"INP")` | `KpiTile vital="INP"` | → ancre du hero INP | comme § 5.1.2 | — |
| Règles de détection | texte : « Rage : 3 clics sur la même cible en 1 s. Dead : élément d'aspect actionnable sans mutation, navigation ni défilement en 1,5 s. Error : première exception rattachée à l'action dans les 5 s. Clavier non compté ; règles conservatrices : sous-report assumé. » | — | — | constantes SDK (`frustration.ts:L13-15`) et `docs/FRUSTRATION.md:L11-12` ; F22 les **exporte** dans `lib/frustration-regles.ts` avec un test qui compare aux constantes SDK | `<details>` | — | — | test unitaire : valeurs affichées = constantes SDK |
| **Routes les plus frustrantes** (hero) | `ImpactTable` ; pilote = **part des sessions de la route ayant au moins un signal** (un taux, donc une gravité ; un compte brut classerait par trafic) ; colonnes rage / dead / error, sessions touchées | par route : sessions avec signal / sessions avec vue de la route, les deux restreints aux sessions dont `runtime` ≠ `MOBILE_RUNTIME` (CP16) ; comptes par type | écart au taux de l'ensemble | à créer `frustrationParRoute(f): Promise<{ route: string \| null; rage: number; dead: number; error: number; sessionsTouchees: number; sessionsRoute: number }[]>` ; **repli avant création** : agrégat par route de `topFrustrations` (`queries-frustration.ts:L19`) en tri volume, bandeau « partiel : calculé sur les 50 couples route × cible les plus fréquents, sans dénominateur » | `ImpactTable` (`triHref.gravite = null` en repli, raison en `title` + sr-only) | ligne → `/pages?panel=route:<r>` ; « Signaux de la route » → `/events?name=frustration.rage&route=<r>` | route `null` → « Inconnu » ; n < 30 sessions en fin | test : route à 3 sessions / 3 touchées classée après route à 400 / 40 |
| INP p75 dans le temps | `ThresholdSeries vital="INP"` (bandes 200 / 500) | p75 INP par seau | `cmp` | à créer `vitalSeriesN(f,"INP")` | `ThresholdSeries` | zoom ; annotations | comme hero Vue d'ensemble | bandes visibles |
| Éléments responsables de l'INP | nuage fréquence × latence (priorise « fréquent ET lent », nôtre) **avec étiquettes** des 5 points les plus hauts + table jumelle | par `interactionTarget` : n, p75, pire ; ≤ 20 | — | ex. `inpOffenders(f)` `queries-frustration.ts:L52` | `ScatterPlot` (`xUnit="interactions"`, `yUnit="ms"`, `etiquettes: 5`, § 4.2) + table | points non cliquables (aucune dimension « cible » dans le contrat : dit dans l'alternative) | « 20 éléments au plus » dit ; `softFail` retiré | alternative = la table ; axe X avec unité |
| Scripts qui bloquent le fil principal | classement en barres par blocage **cumulé** (le texte existant justifie le cumul : c'est la fréquence qui fait l'INP) | par script × fonction : frames, cumul, pire | — | ex. `scriptsBloquants(f)` `queries-frustration.ts:L105` | `RankBar` (valeur = `totalMs`, sous-texte « n frames · pire x ms ») + phrase existante | — | Chromium-only dit ; vide existant | la mention « cumul, pas temps vécu d'une personne » est affichée |

#### 5.4.3 Grille et widgets — Actions

Grille : en-tête + onglets + `PresetBar` → KPI ×3 → **hero** « Actions classées par erreurs liées »
(pleine largeur, au-dessus du pli) → table paginée. 768 / 390 : KPI 1 colonne à 390, hero en barres.

| Libellé exact | Graphique et pourquoi | Mesure · agrég. | Cmp | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| Actions | stat | `count` actions | `cmp=prev` (à créer : `topActionsSummary(f, shift)`) | ex. `topActionsSummary(f)` `queries-actions.ts:L202` | `KpiTile` neutre | — | table `rum_action` absente → `non_collecte` « Non collecté : la table des actions n'existe pas sur ce déploiement » (F00, `queries-actions.ts:L203-207`) | jamais « 0 action » quand la table manque |
| Sessions avec action | stat | `ActionSummary.sessions` | idem | ex. | `KpiTile` neutre | — | idem | — |
| Actions suivies d'une erreur | stat | `error_clicks` (actions dont le clic est suivi d'une erreur) — distinct de `errors` (occurrences liées) : les deux libellés sont écrits | idem | ex. `ActionSummary.error_clicks` L25-37 | `KpiTile` neutre | → tri du hero | idem | libellé « actions », pas « erreurs » |
| **Actions classées par erreurs liées** (hero) | barres **non empilées** : longueur = erreurs liées. **Pas d'empilement** erreurs / ressources / API : empiler un signal d'échec avec une activité neutre fait lire « beaucoup de réseau » comme « beaucoup d'erreurs » ; la question est « quels gestes échouent ». Ressources et API en colonnes | par (nom, type, route) : erreurs, error_clicks, ressources, appels API, sessions | — | ex. `topActions(f, page)` L175 | `RankBar` (valeur `errors`, `sub` = « n actions · s sessions · r ressources · a API ») | libellé → `/errors?route=<route>` (le nom d'action n'est pas une dimension du contrat, dit) ; « Sessions » → `/sessions?route=` | vide → « Aucune action sur <plage> » ; échantillonnage : `actionSamplingNotice` existant | aucune barre empilée ; 12 lignes, suite dans la table |
| Table des actions | table existante, colonne « Temps lié » **renommée** « Temps réseau lié, cumulé (toutes actions) » avec la phrase « un cumul de visiteurs différents n'est le temps d'attente de personne » (doctrine de `LongtasksView.tsx:L4-9`) ; colonnes ressources / API scindées (`resource_ms`, `api_ms`) | ex. `TopActionRow` L8-23 | — | ex. | table + pagination existantes | — | idem | à créer (option, F24) : `lie_p75_ms` par action pour remplacer le cumul ; tant qu'il manque, le cumul reste nommé comme tel |

#### 5.4.4 Conservé, disparaît

- **Conservé** : nuage fréquence × latence, table d'attribution INP, scripts bloquants et leur
  justification, Chromium-only, avertissement d'échantillonnage des actions qui nomme le biais, sous-titre
  « heuristique, bornée à 5 s ».
- **Disparaît** : tuile « Élément le plus lent » (le nuage et la table la portent) ; table « Signaux de
  frustration » type × cible × route (remplacée par le hero par route + lien vers le journal filtré) ;
  composant local `Stat` d'`/actions` (→ `KpiTile`) ; tons rouge/orange dès une occurrence.

### 5.5 Satisfaction `/experience`

**Question.** « Les visiteurs se disent-ils satisfaits, et le ressenti suit-il la performance ? »
**Question suivante.** « Sur quelle page, et que disent-ils ? » → verbatims → session.

**Référence.** Aucune des trois n'a d'écran de satisfaction déclarée (`console-ecrans-2.md` L103-104) :
**nôtre, conservé**, rendu honnête (plus de score à paliers propriétaires).

#### 5.5.1 Décision sur le « Score d'expérience »

Le score /100 est **retiré** (amélioration de l'ossature, justifiée) : sa composante performance repose
sur des paliers 2000/82/55/32 sans source (`app/experience/page.tsx:L28-34`) que F00 supprime ; le
recalculer sur `rating.ts` créerait un second score composite à côté de la santé, sans formule publiée.
À la place, les trois constituants sont montrés côte à côte avec leur preuve (CSAT, LCP p75 et verdict,
frustration pour 1 000 sessions) : chacun a sa source, aucun n'est pondéré au jugé.

#### 5.5.2 Grille

KPI ×4 → hero « Satisfaction dans le temps » (2 panneaux empilés) → « Répartition des notes » ·
« Ressenti face au LCP, par page » → « Satisfaction par page » → « Derniers verbatims ». 768 : KPI 2 × 2 ;
390 : 1 colonne. État vide (aucun avis) : carte existante avec le snippet et la règle de silence de
60 jours, **conservée**, placée sous les KPI.

#### 5.5.3 Widgets

| Libellé exact | Graphique et pourquoi | Mesure | Cmp | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| Satisfaction (CSAT) | stat | `positives / count` (note ≥ 4 / avis notés) | `cmp=prev` (à créer : `feedbackStats(f, shift)`) | ex. `feedbackStats(f)` `queries-experience.ts:L22` | `KpiTile format="pct" sensMeilleur="haut"` ; `couverture={n: count, unite:"avis", faibleSous:10}` | — | `count = 0` → `null` « aucun avis noté sur <plage> » | jamais « 0 % » sans avis |
| Avis reçus | stat | `count` (avis notés) | idem | ex. | `KpiTile` neutre | → verbatims | 0 réel → 0 | — |
| Part de détracteurs | stat | `detractors / count` (notes 1-2) | idem | ex. `FeedbackStats.detractors` L12-19 | `KpiTile format="pct" sensMeilleur="bas"` | — | `count = 0` → `null` | — |
| Frustration pour 1 000 sessions | stat | `frustration / sessions × 1000` (rage + dead seulement, **dit**, CP11) | — | ex. `experienceContext(f)` L54 | `KpiTile` neutre + lien `/ux` | → `/ux` | `sessions = 0` → `null` (corrige « Sérénité 100 avec 0 session », `console-ecrans-2.md` L107) | — |
| **Satisfaction dans le temps** (hero) | 2 panneaux empilés, axe x partagé : CSAT (ligne, **trou** si 0 avis) au-dessus, nombre d'avis (barres) dessous ; P5 | CSAT et volume par jour | `cmp=prev` : non (seaux journaliers fixes : décalage d'un jour non aligné) | ex. `feedbackTrend(f)` L83 (CP10) ; à créer `feedbackTrendContrat(f)` sur `bucketSecondsFor` | `ThresholdSeries format="pct"` (sans vital, `effectifCle: "avis"`) + `ThresholdSeries` une série `forme: "barres"`, `additive: true` | clic jour → zoom ; annotations de déploiement sur les deux panneaux (P9) | `1h`/`24h` → `partiel` « seau journalier fixe : moins de deux jours, pas de courbe » tant que la variante n'existe pas | jour sans avis = trou, jamais 0 % |
| Répartition des notes | une barre empilée 5 / 3-4 / 1-2 (parts d'un tout : l'empilement est vrai) | promoteurs, passifs, détracteurs | — | ex. `FeedbackStats` | `RankBar` avec `segments` (couleurs `CATEGORIELLE`, pas vert/rouge : une note n'est pas un état de mesure) | — | `count = 0` → vide | alternative : trois lignes avec comptes et parts |
| Ressenti face au LCP, par page | nuage : x = LCP p75 de la route, y = CSAT de la route, taille = avis ; répond à « le ressenti suit-il la performance ? » (analyse nôtre) ; phrase « corrélation observée sur N routes, pas une cause » | par route : LCP p75 (`vitalsBreakdown(f,"route",200)`) × CSAT (`feedbackByRoute`) ; routes avec ≥ 10 avis seulement | — | ex. `feedbackByRoute(f)` L133, `vitalsBreakdown` | `ScatterPlot` + bande verticale du seuil LCP « Bon » (prop `repereX`, § 4.2) | point → `/pages?panel=route:<r>` | < 3 routes éligibles → `EtatSurface partiel` « moins de trois pages avec au moins 10 avis : pas de nuage » | le nombre de routes éligibles est écrit |
| Satisfaction par page | `ImpactTable` ; pilote = **part d'avis non positifs** (1 − CSAT, pour que « décroissant = pire » reste vrai sans changer le composant) ; colonnes avis, part de notes 1-2, LCP p75 (la « note moyenne » d'une échelle ordinale 1-5 est retirée) | par route, top 20 par volume ; part 1-2 = `detracteurs / count` | écart à l'ensemble | ex. `feedbackByRoute(f)` (CP11), **modifié en F26** : colonne `detracteurs` ajoutée (`count(*) filter (where score <= 2)`, même expression que L141-142) ; `avg` n'est plus affiché | `ImpactTable` (tri par `classerParGravite` avec `seuilFaible: 10`, § 3.12) | ligne → `/pages?panel=route:<r>` ; « Sessions » → `/sessions?route=` | `count = 0` → pilote `null` (« commentaires sans note ») ; route `null` → « (toute l'app) » | plus de « 0 % » pour une route sans note |
| Derniers verbatims | liste : note, commentaire (scrubbé à l'ingestion, dit), route, **date** (ajoutée), lien session | 30 derniers | — | ex. `recentFeedback(f)` L109 (`ts` L100-106) | liste | → `panel=session:<id>` | vide → carte d'installation | la date figure sur chaque verbatim |

#### 5.5.4 Conservé, disparaît

- **Conservé** : `null` plutôt qu'une note neutre, CSAT « — », état vide avec le geste et la règle de
  silence, verbatim → session, commentaire scrubbé déclaré.
- **Disparaît** : score /100 et `RadarScore` (§ 5.5.1), hero qui répète deux fois « 100 /100 ».

### 5.6 Mobile — `/mobile`

#### 5.6.1 Question

« Comment se comporte l'app React Native, et que ne mesurons-nous pas ? ». Tranchée en
dix secondes par : la rangée de KPI (sessions, sessions sans erreur JS, occurrences) **et** le hero
« Stabilité par release ». Question suivante : « quelle release, quel écran, quel appel réseau ? ».

#### 5.6.2 Référence

**IP-Label Ekara Mobile** pour l'ordre stabilité → performance → impact, et la lecture par release
(`iplabel.md` L254-263) ; **Datadog** pour « Crash Rate / Error Rate by Version » et la version
sélectionnée comparée aux précédentes (`datadog-docs-product-analytics-mobile.md` § 2.6) ; **nôtre,
conservé** : la matrice de capacités à trois états et le refus du mot « crash-free »
(`app/mobile/page.tsx` L4-14 ; `console-ecrans-2.md` § 3.4). Nous gardons ce que Datadog ne dit pas :
aucun seuil de démarrage n'est publié (Datadog l'écrit lui-même, `datadog-docs-product-analytics-mobile.md`
§ 2.3 dernier point) — nous n'en inventons pas.

#### 5.6.3 Grille

L'écran actuel ouvre sur la matrice de capacités. Sur une app instrumentée, cela pousse tout chiffre sous le
pli (« aucune mesure chiffrée visible avant y ≈ 1180 », `console-ecrans-2.md` L120). Nouvel ordre :
**d'abord ce qui est mesuré, ensuite ce qui ne l'est pas** — mais la matrice garde un **résumé en tête**
(une ligne : « Non collecté : crashes natifs, ANR, démarrage natif »), pour qu'aucun chiffre ne se lise
sans son angle mort.

1. `PageHeader` (`domain="Performance"`, `sub` = question).
2. `PresetBar` — vues produit « iOS » (`os=iOS`), « Android » (`os=Android`), « Dernière release
   déclarée » (`release=<release la plus récente de declarations>`). Remplace le formulaire
   « Plateforme » (L88-106) : un second contrôle de filtre hors `GlobalFilters` viole la règle (4) du
   § 3.1 ; `PLATFORM_OS` donne les valeurs exactes (`lib/mobile-capabilities.ts` L189). Ajout
   de `PresetBar` sur cet écran : extension de P13, justifiée par le même motif.
3. **Ligne d'angles morts** (W-M1).
4. Bandeaux `partiel` / `echantillonne` (existants, L76-85, passés sur `EtatSurface`).
5. Rangée KPI (W-M2 à W-M5).
6. Hero « Stabilité par release » (W-M6).
7. Rangée 2 colonnes : « Démarrage JS jusqu'au premier écran » (W-M7) · « Écrans les plus consultés » (W-M8).
8. « Appels réseau les plus lents » (W-M9).
9. « Sessions et erreurs JS dans le temps » (W-M10, B8).
10. « Ce qui est collecté, et ce qui ne l'est pas » (W-M11, matrice détaillée).
11. « Aller plus loin » (W-M12).

1440 : 1 à 6 au-dessus du pli. 768 : KPI 2 × 2, zone 7 en une colonne. 390 : une colonne ; tables
défilantes ; la matrice passe en liste (une carte par capacité : libellé, état, dernière déclaration,
note dans un `<details>`) ; le hero W-M6 garde les colonnes Release · Part touchée · Sessions, les
autres passent dans un `<details>` « Détail » par ligne.

**Choix écrit pour le hero.** Le hero W-M6 est **livré dans
F38**, avec sa lecture `mobileParRelease` : c'est une requête sans migration sur la même `cohorte()`
et la même `snapshot()` que `mobileSummary` ; elle n'attend aucun patch backend. L'écran ne sort donc
pas avec un hero vide. **Seul cas de repli, décidé à l'exécution et non au calendrier** : si
`mobileParRelease` rend `{ disponible: false }` (schéma sans `rum_session.runtime` — v82 — ou sans la
dimension `rum_session.release`, sondés par `mobileSchema()`), la page rend l'ordre de repli :
zone 5 (KPI) puis zone 7 (W-M7) forment le hero, et W-M6 descend **sous** la zone 7 avec
`EtatSurface kind="partiel"` et la raison rendue par la lecture. Une **erreur** de lecture (exception)
ne déclenche pas ce repli : W-M6 reste en place avec `SectionErreur` et « Réessayer ». Test e2e
(`tests/e2e/mobile-console.spec.ts`) : ordre des zones vérifié dans les deux cas (le second par une
fixture de schéma sans release, même mécanisme que les tests existants de migration absente, non
établi : à confirmer à l'ouverture du lot).

#### 5.6.4 Table des widgets

Toutes les mesures portent sur la même cohorte `rum_session.runtime = 'react_native'`, sessions
**commencées** dans la fenêtre, dans une seule photographie `repeatable read` (`lib/queries-mobile.ts`
L171-176, L230-253). Surface : seuls `device`, `os`, `release` s'appliquent (`console-donnees.md` § 1.5).

| Id | Libellé | Type — pourquoi | Mesure · agrégation · dimensions · granularité | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| W-M1 | « Non mesuré par cette version du SDK » | Ligne de texte `role="note"` — l'angle mort doit précéder le chiffre | capacités `unavailable` ou `unknown` de `capabilityMatrix` + les trois capacités natives toujours absentes (crash natif, ANR, démarrage natif) | — | existante : `data.capabilities` (`queries-mobile.ts` L118-132 ; `mobile-capabilities.ts` L118) | `EtatSurface kind="non_collecte"` compact, `manque` = liste jointe | lien « Détail » → ancre `#capacites` (W-M11) | — | e2e : la ligne est visible au-dessus de la rangée KPI à 1440 |
| W-M2 | « Sessions React Native commencées » | `KpiTile` | `sessions.sessions`, count, fenêtre entière | `cmp=prev` : `mobileSummary(filtersOfQuery({ ...query, range: previousRange(query.range) }))` — deux appels, pas de nouveau SQL | existante : `mobileSummary` (L299) | `KpiTile` (`format: "count"`) | tuile → aucun lien tant que B8 manque (la liste `/sessions` ne sait pas filtrer le runtime) | v82 absente → `valeur: null`, `raisonNull` = « runtime non collecté (migration v82) » — corrige CE9 côté écran (la lecture renvoie 0 : la page lit `data.unavailable`) | test : `unavailable` contient v82 → « — », jamais « 0 » |
| W-M3 | « Visiteurs » | `KpiTile` séparé (V2 : jamais additionné aux sessions) | `sessions.visitors` distinct, `null` si aucun identifiant ; sous-texte « N sessions sans identifiant » (`sessions_without_visitor`) | précédent comme W-M2 | existante | `KpiTile` | — | `null` → « Inconnu » + « aucune session ne porte d'identifiant de visiteur » ; note « visiteurs surestimés sur mobile (identifiant en mémoire) » (`console-donnees.md` § 2.11, parity C3) | test : `visitors: null` → « Inconnu » |
| W-M4 | « Occurrences d'erreurs JS » | `KpiTile` + sous-texte détaillé | `js_errors.occurrences` = **sum(occurrences)** (V1, L446 via `console-ecrans-2.md` § 3.3), dont « non interceptées » (`crashes`), « rejets de promesse », « fatales » (`fatal`, `null` → « Inconnu ») | précédent | existante : `lireErreursJs` (L435-463) | `KpiTile` | tuile → `/errors?source=react_native_js` (corrige CE7 ; `parseIssueSource`, `lib/error-issues.ts` L88) | `js_errors = null` → « Inconnu » + raison (`unavailable`) ; capacité `js_errors` à l'état `unknown` → valeur affichée **avec** la mention « capacité non déclarée par le SDK : 0 ne prouve pas l'absence d'erreur » ; `unavailable` → « Non collecté » | test : capacité `unavailable` → texte « Non collecté », pas de chiffre |
| W-M5 | « Sessions sans erreur JS » | `KpiTile` en pourcentage, `sensMeilleur: "haut"` | **calculé sur les releases qui déclarent collecter les erreurs JS** (corrige CE14) : 1 − Σ `sessions_touchees` / Σ `sessions` des lignes de `mobileParRelease` dont `etat_js_errors = "active"`, toutes releases comprises (les totaux ne sont pas tronqués à 12) ; sous-texte « N sessions touchées sur M, releases déclarantes seulement ; K sessions de releases non déclarantes exclues » (le « N sur M » n'est pas écrit aujourd'hui, `console-ecrans-2.md` L162) | précédent (même calcul sur `previousRange`) | à créer : `tauxSansErreurDeclarant(lignes: MobileReleaseRow[]): { rate: number \| null; reason: ErrorFreeUnavailable \| null; sessions: number; touchees: number; exclues: number }` dans `lib/mobile-capabilities.ts` (pure) ; repli si `mobileParRelease` indisponible : `js_error_free_session_rate` de `mobileSummary` (`mobile-capabilities.ts` L161-175) | `KpiTile` (`format: "pct"`) | — | aucune ligne déclarante et des sessions → `null` + `ERROR_FREE_REASONS.capability_unknown` (ou `capability_unavailable` si toutes les releases déclarent ne pas collecter) ; aucune session → `no_sessions` ; en repli `mobileSummary` avec au moins une déclaration non `active` : mention « état de collecte lu sur tout le parc : des sessions de releases non déclarantes peuvent être comptées sans erreur » ; **libellé jamais « sans crash »** | test unitaire (`tests/unit/rum-mobile-p75.test.ts` (qui teste déjà `errorFreeSessionRate` ; étendu, pas dupliqué)) : releases A (active, 100 sessions, 10 touchées) et B (unknown, 50 sessions, 0 touchée) → taux 90 %, `exclues = 50` (et non 93,3 %) ; e2e : aucun texte « crash-free » ni « sans crash » sur la page |
| W-M6 | Hero « Stabilité par release » | Table-barres (une ligne par release, barre = **part des sessions touchées par au moins une erreur JS**, colonnes : sessions, occurrences, écart vs release précédente, démarrage à froid p75 avec son n, première session vue) — la release est un **fait exact** de la session mobile (`queries-mobile.ts` L185-199), c'est donc la coupe où numérateur et dénominateur parlent de la même population ; c'est le premier écran de Datadog (« Crash Rate / Error Rate by Version ») et d'Ekara pour le mobile. Pas de série par release : 12 releases dépassent P14 | par `rum_session.release` de la cohorte : `count(*)` sessions, sessions portant ≥ 1 erreur JS de la fenêtre (`error_source = 'react_native_js'`), `sum(occurrences)` (V1), `percentile_cont(0.75)` du démarrage à froid (`js_start_to_first_screen_ms`) et son effectif, `min(started_at)` ; **état `js_errors` propre à chaque release**, issu de ses seules déclarations ; toutes les releases agrégées, 12 affichées, ordre : première session vue décroissante | chaque release contre la **précédente dans l'ordre de première session vue** (calculé côté serveur, indépendant de l'ordre d'affichage) : écart en points de part touchée, « — » si l'une des deux parts est `null` ; phrase obligatoire « même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte » (§ 3.2) ; ligne de référence « Releases déclarantes » = Σ touchées / Σ sessions des lignes `active` (jamais une moyenne des parts) | **à créer dans F38** (requête sans migration, pas de Bn) : `mobileParRelease(f: FiltersLike, limite = 12, schema?: MobileSchema): Promise<{ disponible: true; lignes: MobileReleaseRow[]; releases: number; tronque: boolean } \| { disponible: false; raison: string }>` dans `lib/queries-mobile.ts`, avec `interface MobileReleaseRow { release: string \| null; sessions: number; sessions_touchees: number \| null; occurrences: number \| null; etat_js_errors: CapabilityState; part_touchee: number \| null; raison_part: string \| null; ecart_precedente_pts: number \| null; release_precedente: string \| null; demarrage_froid_p75_ms: number \| null; demarrage_froid_n: number; premiere_session: string }` ; même `cohorte()` (qui projette en plus `s.release, s.started_at`) et même `snapshot()` que `mobileSummary` ; `etat_js_errors = capabilityStatus("js_errors", declarations.filter(d => d.release === ligne.release)).state` via une fonction pure à créer `etatCapaciteParRelease(declarations, capability, release): CapabilityState` (`lib/mobile-capabilities.ts`) ; `part_touchee = 1 − errorFreeSessionRate({ sessions, sessionsWithJsError: sessions_touchees, jsErrorsState: etat_js_errors }).rate` quand `rate` n'est pas `null`, sinon `null` et `raison_part = ERROR_FREE_REASONS[reason]` ; `sessions_touchees = null` et raison « migration v69 absente : les erreurs JavaScript React Native ne sont pas distinguables » si `schema.errorSource` est faux | `ImpactTable` : `pilote` = part touchée, `volume` = sessions, `echantillonFaible` sous 30 sessions, `tri="fourni"` avec `ordreLibelle` = « par première session vue sur la fenêtre, la plus récente en tête » (§ 4.2), `triHref = { gravite: <href tri gravité>, volume: <href>, impact: null, fourni: null }`, `reference` = ligne « Releases déclarantes » | ligne → même écran filtré `release=<v>` (`release=` vide impossible : release `null` → `seg=v2:release:is_null`, § 3.3) ; survol de la barre : « 12 sessions touchées sur 340 » | release `null` → ligne « Inconnue » ; **release sans déclaration `js_errors` active → part « — » avec `ERROR_FREE_REASONS.capability_unknown` (aucune déclaration) ou `capability_unavailable` (déclarée non collectée), jamais « 0 % », même si une autre release déclare** ; `disponible: false` → ordre de repli du § 5.6.3 + `EtatSurface kind="partiel"` avec `raison` ; exception → `SectionErreur` + « Réessayer » ; aucune session → `EtatSurface kind="vide"` « Aucune session React Native sur <plage> » ; `releases > 12` → méta « 12 releases affichées sur N ; la ligne de référence porte sur toutes » ; échantillonnage : bandeau de la page (même `samplingOf`) | intégration SQL (`tests/integration/rum-mobile-par-release-sql.test.ts`, même style que `tests/integration/rum-mobile-p75-sql.test.ts`) : releases 1.4 (déclare `js_errors`, 3 sessions dont 1 touchée) et 1.2 (aucune déclaration, 2 sessions sans erreur) → 1.4 : part 33,3 %, 1.2 : `part_touchee = null`, `raison_part = ERROR_FREE_REASONS.capability_unknown` ; release `null` → ligne « Inconnue » ; test de rendu : la ligne 1.2 n'affiche aucun « % » ; e2e : ligne cliquable pose `release=`. |
| W-M7 | « Démarrage JS jusqu'au premier écran » | **Barre d'étendue** p50 → p75 → p95 par type (froid, chaud), sur un axe commun en ms — trois percentiles se lisent mieux comme une étendue que comme trois nombres en ligne (L217) ; **pas de couleur de verdict** : aucun seuil publié | `startup.cold` / `startup.warm` : `samples`, `p50_ms`, `p75_ms`, `p95_ms` ; jamais fondus (L466-471) | précédent (p75 seulement, écart de percentiles) | existante : `lireDemarrage` (L473-494) | à créer : `EtenduePercentiles` (§ 4.2) | — | mesure `null` → « Non mesuré : l'application n'a déclaré aucun premier écran sur la fenêtre » (texte existant) ; sous-titre conservé « Ce n'est pas le démarrage natif » ; `samples < 30` → « échantillon faible » | test de rendu : `p95_ms: null` → pas de moustache droite, texte « p95 non calculable » |
| W-M8 | « Écrans les plus consultés » | `RankBar` (classement de volume) | `screens` : `route`, `views` (count), `sessions` (distinct) — 10 max | part des consultations (additif) | existante : `lireEcrans` (L497-511) | `RankBar` dans `Figure` | pas de lien vers un écran filtré tant que B8 manque (le filtre `route` sur `/pages` mélangerait web et React Native) : raison écrite dans `lecture` | vide → « Aucun écran observé » + geste « émettre `screen()` ou brancher l'adaptateur de navigation » (texte de `CAPABILITY_NOTES`, L38) | e2e : alternative textuelle présente |
| W-M9 | « Appels réseau les plus lents » | `ImpactTable` (pilote = p75, volume = appels, colonnes max et **part des réponses ≥ 400** = `errors / calls`, `null` si `calls = 0`) — un classement de percentile, trié par gravité, avec l'effectif | `resources` : `path` (origine retirée), `method`, `calls`, `p75_ms`, `max_ms`, `errors` (appels ≥ 400) — 10 max | écart au p75 de l'ensemble : **non disponible** (aucune lecture ne rend le p75 de tous les appels) → `reference: null` + `referenceRaison` = « p75 de l'ensemble des appels non calculé : aucune lecture ne le rend » (`ImpactTable.reference` accepte `null` avec `referenceRaison`, § 4.2) | existante : `lireRequetes` (L522-541) | `ImpactTable` | pas de lien (le tracing ne filtre pas par chemin) | `calls < 30` → échantillon faible ; note conservée « aucun en-tête MIP n'est envoyé hors des origines déclarées » | test : `calls: 0` impossible par construction, `errors/calls` affiché en % |
| W-M10 | « Sessions et erreurs JS dans le temps » | Deux `ThresholdSeries` empilés (sessions commencées ; occurrences d'erreurs JS), axe x partagé (P5) | par seau du contrat | annotations de déploiement | **backend : manque** B8 (dimension `runtime`, `console-donnees.md` § 2.11) ; après B8 : `exploreAnalytics` avec `seg=v2:runtime:eq:react_native` | `ThresholdSeries` ×2 | zoom | avant B8 : `EtatSurface partiel` « Série non disponible : le runtime n'est pas encore une dimension de lecture (B8) » | e2e : le texte de raison est présent, aucun axe vide dessiné |
| W-M11 | « Ce qui est collecté, et ce qui ne l'est pas » (`id="capacites"`) | Table conservée, colonnes : Capacité · État · Releases déclarantes (une par ligne, via `declarations`) · **Dernière déclaration** (`last_declared_at`, calculé mais jamais affiché, `console-ecrans-2.md` L160) · Vérifié (recette) ; notes de 2 lignes dans un `<details>` | `capabilityMatrix(declarations)` + `declarations[]` (hors fenêtre) | — | existante : `mobileDeclarations` (L389-421) | table existante | — | badge « Collecté / Non collecté / Inconnu » (existant) ; couleur `warn` pour « Non collecté » conservée | e2e : colonne « Dernière déclaration » présente ; « Jamais » si non vérifié |
| W-M12 | « Aller plus loin » | Liens | — | — | — | liens | « Erreurs React Native » → `/errors?source=react_native_js` ; « Sessions React Native » → **désactivé** avec la raison « la liste des sessions ne filtre pas encore le runtime (B8) » (corrige CE8) | — | e2e : aucun lien vers `/errors/issues` (sans id) ni `device=mobile` |

#### 5.6.5 Conservé / disparaît

**Conservé** : la règle de l'écran en tête de fichier (L4-14) ; même cohorte et même photographie
pour tout l'écran ; « Inconnu » / « Non calculable » / « Non mesuré » ; release filtrée sur la session ;
probabilité d'inclusion sans extrapolation ; `loading.tsx` et `error.tsx` existants (modèle pour les autres routes).
**Disparaît** : le formulaire « Plateforme » (remplacé par `PresetBar`) ; la matrice en tête d'écran
(déplacée en fin, résumée en W-M1) ; le démarrage en texte « p50 · p75 · p95 » ; les deux liens faux
(CE7, CE8).

**Catégorie Robot et réel** — § 5.7 à § 5.10.
### 5.7 Corrélation synthétique ↔ RUM — `/correlation`

#### 5.7.1 Question, référence

- **Question (sub du `PageHeader`)** : « Le robot voit-il ce que vivent les visiteurs, et sur quelles
  routes, à quelles heures, ne le voit-il pas ? »
- **Question suivante** : « Sur cette route et à cette heure, qui a été touché et qu'ont-ils vécu ? »
  → `/pages?route=<r>&from=<h>&to=<h+1h>&panel=route:<r>` puis `/sessions?route=<r>&from&to`.
  Sous `app=all`, ces liens ajoutent `app=<app de la ligne>` : l'heure et la route désignent une app.
- **Référence retenue** : IP-Label Ekara Unified Monitoring. Raison : c'est la forme exacte de notre
  produit, un robot et un RUM corrélés dans un seul affichage codé par état (`iplabel.md` L125-154,
  L141-144 « weather report »). Nous gardons **notre** définition écrite de l'angle mort, qu'aucune
  source Ekara ne décrit (`iplabel.md` L271-281, L413-417). Grafana fournit la discipline stat +
  série + table (`grafana.md` § b.3, table L191-200) et la « status history » de la frise robot
  (`grafana.md` L100).

#### 5.7.2 Grille

| Ordre | Zone | 1440 px (≈ 1150 px utiles) | 768 px | 390 px |
|---|---|---|---|---|
| 1 | `PageHeader` (domain « Robot et réel », sub = question, `help="robotVsReal"`) | pleine largeur | idem | idem |
| 2 | Bandeau de fraîcheur du robot (`EtatSurface` `partiel`, seulement si le robot est en retard) | pleine largeur | idem | idem |
| 3 | Rangée KPI : 5 `KpiTile` | 5 colonnes | 3 + 2 | 2 colonnes, la 5ᵉ seule sur sa ligne |
| 4 | Hero « Robot face au réel » (2/3) : sélecteur, **panneau réel** (180 px) puis **frise robot** (44 px), même axe x ; « Concordance des états » (1/3) | côte à côte, **au-dessus du pli** | empilés, hero d'abord | empilés ; la frise reste sous la série, cases ≥ 2 px (au-delà, § CR7-b) |
| 5 | « Angles morts » (table) | pleine largeur, visible en tête au défilement de 1 écran | idem | table défilante |
| 6 | « Nuage des routes » (1/2) + « Routes à trafic réel sans robot » (1/2) | côte à côte | empilés | empilés |
| 7 | « Routes : robot et réel côte à côte » (table) | pleine largeur | idem | table défilante |

À 1440 × 900, les zones 1 à 4 tiennent au-dessus du pli : KPI ≈ 110 px, sélecteur 40 px, panneau
réel 180 px, frise 44 px, en-tête de figure ≈ 40 px. Les angles morts commencent au premier
défilement. On ne les remonte pas au-dessus du hero : le hero donne le contexte (l'heure, la route)
sans lequel une ligne d'angle mort ne se lit pas.

#### 5.7.3 Widgets

**Lectures communes à CR3, CR7, CR7-a, CR7-b, CR8, CR9, CR12.**

- `correlationSources` (`queries-v2.ts:384-412`) gagne une colonne dans la CTE `rum` :
  `count(*) filter (where m.name = 'LCP')::int as rum_lcp_n`. `correlationCards` (CR5) et
  `correlationSeries` la lisent. Aucun autre changement de la CTE.
- `correlationRoutes(f)` (`queries-v2.ts:429-442`) change de forme : **à modifier** en
  `correlationRoutes(f: FiltersLike): Promise<{ app_id: string; route: string }[]>` (`select
  coalesce(r.app_id, s.app_id) as app_id, coalesce(r.route, s.route) as route … group by 1, 2 …
  order by 2, 1`). Seul appelant : `app/correlation/page.tsx:26` (vérifié par recherche).
- `correlationSeries` **à modifier** : `correlationSeries(app: string, route: string, f: FiltersLike):
  Promise<{ bucket: Date; rum_lcp_p75: number | null; rum_lcp_n: number | null; syn_latency_avg:
  number | null; syn_state: "ok" | "warn" | "incident" | null; syn_measures: string | null }[]>`.
  Les deux sous-requêtes filtrent `app_id = ${sql.bind(app)} and route = ${sql.bind(route)}` en plus
  du `where` compilé (qui garde le périmètre `effectiveApps`) : une app hors périmètre rend 0 ligne.
  Aujourd'hui la série est filtrée sur la route seule et jointe `using (app_id, route, bucket)` : sous
  `app=all`, deux apps ayant `/checkout` donnent deux points par heure (`queries-v2.ts:451-463`).
- **Alignement des seaux (obligatoire avant tout tracé)** : `correlationSeries` ne renvoie que les
  heures où au moins un côté a une mesure (full outer join sans `generate_series`). Une heure vide
  est **absente**, et recharts relierait ses voisines. La page construit la grille horaire puis aligne :

  ```ts
  // app/correlation/page.tsx (serveur)
  const H = 3_600_000;
  const finMs = Date.parse(query.range.to);
  const debutMs = Math.max(Date.parse(query.range.from), finMs - 300 * H); // MAX_POINTS = 300 (query-contract.ts:27)
  const tronque = debutMs > Date.parse(query.range.from);                  // plage perso > 300 h
  const grille = bucketStarts({ from: new Date(debutMs).toISOString(), to: query.range.to, bucketSeconds: 3600 });
  const lignes = alignerSeaux(serie.map((r) => ({ ...r, bucket: r.bucket.toISOString() })), grille, false);
  // lignes[i] === null → heure sans aucune mesure → trou dans le panneau réel ET case « aucun passage » dans la frise
  ```

  `bucketStarts` : `query-contract.ts:241-249`. `alignerSeaux` : `lib/series.ts`, créé par F04 (§ 4.4, signature `alignerSeaux<T>(rows, starts,
  additif)` ; clé de rapprochement : `Date.parse(row.bucket)` égal à `starts[i]`) ; il n'en existe qu'un. `tronque` → bandeau `partiel` dans la `Figure` :
  « Seaux horaires : les 300 dernières heures de la plage sont affichées (plafond de points du
  contrat). La matrice et les angles morts portent sur toute la plage. »

| # | Libellé exact | Type et pourquoi | Mesure · agrégation · dimensions · granularité | Comparaison affichée | Source de données | Composant | Interactions | États | Critère d'acceptation |
|---|---|---|---|---|---|---|---|---|---|
| CR1 | Bandeau « Dernier passage du robot : il y a 3 h 12 (attendu toutes les 15 min) » | Bandeau `partiel` : si le robot s'est arrêté, « robot ok » ne veut plus rien dire, et l'écran doit le dire avant tout chiffre | `max(captured_at)` par app ; intervalle médian entre deux passages sur la plage | retard = `to − dernier` comparé à 2 × l'intervalle médian | **à créer** : `syntheticFreshness(f: FiltersLike): Promise<{ app_id: string; dernier: Date \| null; intervalle_median_s: number \| null; passages: number }[]>` sur `syn_snapshot` (schéma `schema.sql:67-78`), même `sql.where({dataset:"synthetic", row:"y", time:"y.captured_at"})` que `correlationSources` (`queries-v2.ts:386`) | `EtatSurface{kind:"partiel", raison}` | lien « Voir la santé interne » → `/admin/health` (admin seulement) | absent si le retard est < 2 × l'intervalle ; `dernier = null` → `EtatSurface{kind:"non_collecte", manque:"aucun passage du robot sur cette app"}` à la place des zones 4-7 robot | `tests/unit/correlation.test.ts` (fonction pure `retardRobot`) : retard 3 h avec intervalle 15 min → bandeau ; retard 20 min → rien ; `passages < 2` → intervalle `null`, bandeau « intervalle inconnu » |
| CR2 | KPI « Routes suivies par le robot » | Stat : un compte, lu d'un coup d'œil (Grafana Stat, `grafana.md` L93) | nombre de couples (app, route) avec `syn_latency_avg` non nul sur la plage | aucune ; `lecture` = « sans référence : configuration du robot » | **existante** : `correlationCards(f)` `queries-v2.ts:415-426` (compter les lignes où `syn_latency_avg != null`) | `KpiTile` `format:"count"`, `lecture` | lien → ancre `#routes` | `0` si le robot n'a aucune route (compteur vide réel) | le chiffre est égal au nombre de lignes robot de la table CR12 |
| CR3 | KPI « Routes vues des deux côtés » | Stat | couples (app, route) ayant ≥ 1 heure avec robot **et** réel ; sous `app=all`, `lecture` = « une route présente dans deux apps compte deux fois » | aucune | **existante, à modifier** : `correlationRoutes(f)` (forme `{app_id, route}[]`, ci-dessus) | `KpiTile` `format:"count"`, `lecture` | lien → ancre `#hero` | `0` → le hero passe à son état vide | égal au nombre d'options du sélecteur CR7-a |
| CR4 | KPI « Heures en angle mort » | Stat avec alerte nommée | nombre d'heures × (app, route) où robot = `ok` et LCP p75 réel > borne Bon, **sur des heures d'au moins 30 mesures LCP** | vs période précédente (`cmp=prev` si actif) | **à créer** : `correlationConcordance(f)` (voir CR8), cellules `robot=ok`, `reel ∈ {needs-improvement, poor}` | `KpiTile` `format:"count"`, `sensMeilleur:"bas"`, `precedent`, `alerte:{si:">", valeur:0, regle:"robot ok et réel au-delà de 2,5 s la même heure"}` (borne lue dans `THRESHOLDS.LCP[0]`) | lien → ancre `#angles-morts` | `0` affiché « 0 » (compteur réel) ; lecture en échec → « — » + `SectionErreur` | `tests/integration/correlation-sql.test.ts` : 60 heures seedées en angle mort → « 60 », alors que `blindSpots` renvoie 50 lignes |
| CR5 | KPI « Part du LCP réel sur des routes suivies par le robot » | Stat en % : répond à « mon robot regarde-t-il là où sont les visiteurs ? » (couverture, P11). Le seul ratio additif possible ici | `Σ rum_lcp_n (routes avec robot) / Σ rum_lcp_n (toutes routes)` ; `null` si le dénominateur vaut 0 | aucune | **à créer** : `rum_lcp_n` dans la CTE `rum` (ci-dessus), lu par `correlationCards`. **Pas** `rum_sessions`, car une session visite plusieurs routes et les sessions ne s'additionnent pas entre routes (V2) | `KpiTile` `format:"pct"`, `raisonNull:"aucune mesure LCP réelle sur la plage"` | lien → ancre `#sans-robot` | `null` → « — » + raison | `tests/unit/correlation.test.ts` (fonction `partCouverte`) : deux routes (300 mesures avec robot, 100 sans) → 75 % ; aucune mesure → `null` |
| CR6 | KPI « Dernier passage du robot » | Stat de fraîcheur, en date relative + absolue UTC | `dernier` de CR1 (le plus récent des apps du périmètre) | vs intervalle attendu | à créer (CR1) | `KpiTile` avec `valeur = âge en millisecondes`, `format:"s-auto"`, `lecture = date ISO UTC` | — | `null` → « Aucun passage » | le libellé annoncé contient la date ISO UTC |
| CR7-a | Sélecteur « Route affichée » du hero | `<select>` labellisé (formulaire GET) + 5 puces des couples aux angles morts les plus nombreux. Aujourd'hui, seules 6 puces s'affichent et les autres routes sont inaccessibles (`console-ecrans-3.md` L349) | options = `correlationRoutes(f)` ; libellé d'option = `<route>` si une seule app dans le résultat, sinon `<app> · <route>` ; ordre des puces = heures en angle mort décroissantes (`anglesMortsParRoute` de CR8) | — | existante à modifier + à créer (CR8) | `<select name="serie">` natif + `INPUT_CLASS` ; puces `Chip` exporté de `GlobalFilters` (F06) | change `serie` ; conserve `CONTRACT_PARAMS` + `VIEW_CONTEXT_PARAMS` | **Format de `serie`** : `encodeURIComponent(app) + ":" + encodeURIComponent(route)` (`encodeURIComponent` encode `:` en `%3A`, donc le premier `:` sépare toujours app et route, même pour `/partners/:id`). Lecture : couper au premier `:`, décoder les deux parties ; le couple doit figurer dans les options, sinon il est ignoré. **Compatibilité** : une valeur sans `:` (liens anciens, `serie=/checkout`) est lue comme une route ; elle est retenue si une seule option porte cette route, sinon ignorée. **Défaut** : si `route` (contrat) est posé, le premier couple de cette route par ordre d'app ; sinon le couple qui a le plus d'heures en angle mort ; sinon le premier par ordre (route, app). La règle est écrite sous le sélecteur | `tests/unit/correlation-serie.test.ts` (`lireSerie`, `ecrireSerie`) : aller-retour de `("demo", "/partners/:id")` ; `serie=/checkout` avec une seule app → retenu ; deux apps ayant `/checkout` → deux options distinctes, et `serie=/checkout` est ignoré. e2e `tests/e2e/fiabilite.spec.ts` : `/correlation?route=/partners` sans `serie` ouvre le hero sur `/partners` |
| CR7 | Hero, panneau haut : « Réel · LCP p75 par heure — <route> » (titre de `Figure` du hero : « Robot face au réel — <route> ») | Série temporelle à seuils, **une seule mesure** : le LCP p75 réel, sur ses bandes Bon / À améliorer / Mauvais. Elle situe dans le temps une dégradation vécue. Le robot n'est pas sur cet axe (décision 1) : sa latence et le LCP ne mesurent pas la même chose, et un point robot dans la bande rouge se lirait « robot Mauvais » | LCP p75 horaire (`percentile_cont(0.75)` sur `rum_metric name='LCP'`) ; effectif `rum_lcp_n` par heure ; seau fixe 1 h aligné UTC, quelle que soit la plage | bandes `THRESHOLDS.LCP` (`rating.ts:5-11`) ; `cmp=prev` : série « Réel, période précédente » grise pointillée, alignée par rang de seau sur sa propre grille (`previousRange`, `query-contract.ts:306-316`) | **existante, à modifier** : `correlationSeries(app, route, f)` (ci-dessus), alignée par `alignerSeaux`. Annotations : `listDeploys(f, 20)` `queries-deploys.ts:20-31` (sans borne de temps : filtrer `[from,to)` côté serveur ; B1 pour la plage personnalisée) + déclenchements d'alerte de la route (F67) | `ThresholdSeries` : `grille`, `points = lignes.map((l, i) => ({ t: grille[i] ISO, reel: l?.rum_lcp_p75 ?? null, n: l?.rum_lcp_n ?? null }))`, `series=[{cle:"reel", libelle:"Réel · LCP p75", role:"principale", effectifCle:"n"}]`, `faibleSous:30`, `vital:"LCP"`, `format:"ms"`, `seauSecondes:3600`, `fuseau:"UTC"`, `annotations`, `zoomHref`, `hauteur:180` ; `Figure.explorer` = vitals LCP p75 en série filtrée sur la route et l'app | clic sur un seau → `/correlation?serie=<app>:<route>&from=<h>&to=<h+1h>` (`period` retiré) ; annotation déploiement → `cmp=release&rel_b=…` ; annotation alerte → `/alerts?evt=<id>` (§ 3.3) | aucun couple vu des deux côtés → `EtatSurface{kind:"vide", population:"heures avec robot et réel", plage, geste:{libelle:"Élargir à 7 jours", href}}` ; heure sans mesure réelle → trou (grâce à `grille`) ; heure < 30 mesures → point creux, légende « moins de 30 mesures » ; seau en cours marqué creux | `tests/unit/ThresholdSeries.test.ts` (fonction `preparerPoints`, F04) : points `[h0, h2]` sur grille `[h0, h1, h2]` → deux segments séparés ; `tests/integration/correlation-sql.test.ts` : une heure seedée sans aucune mesure entre deux heures mesurées → `alignerSeaux` rend `null` à cet indice ; deux apps avec `/checkout` à la même heure → `correlationSeries("A", "/checkout", f)` rend une seule ligne par heure ; e2e : aucune série « Robot » dans ce panneau, et l'alternative a une ligne par heure avec « — » là où le réel manque |
| CR7-b | Hero, panneau bas : « Robot · état par heure » | **Frise d'états** (Grafana « status history », `grafana.md` L100) : une case par heure, même axe x que CR7. L'état se lit par la **forme et le texte**, pas seulement la couleur : `ok` = case pleine basse, `warn` = case pleine moyenne avec « ! », `incident` = case pleine haute avec « × », aucun passage = case vide hachurée, état inconnu = contour pointillé. **Aucune bande de seuil** sous cette donnée | par heure : `syn_state` (pire état de l'heure) ; en infobulle et dans l'alternative : premier chargement moyen (`syn_latency_avg`, ms) et scénarios (`syn_measures`) | aucune (l'état robot n'a pas de référence) ; la légende dit « état du robot, pas une note du LCP » | même lecture que CR7 (`syn_state`, `syn_latency_avg`, `syn_measures`), même `grille`, même alignement | **à créer** `FriseEtats` (§ 4.2), `cases = lignes.map((l, i) => ({ t: grille[i], etat: l == null ? "absent" : l.syn_state ?? "inconnu", detail: l?.syn_latency_avg != null ? "premier chargement " + fmtLatency(l.syn_latency_avg) + (l.syn_measures ? " · " + l.syn_measures : "") : "aucun passage du robot" }))` ; axe x : mêmes marges que `ThresholdSeries` (constante exportée `SERIE_MARGES`, § 4.2) | survol / focus clavier d'une case : infobulle (heure UTC, état en toutes lettres, latence robot, scénarios) ; clic → même zoom que CR7 | aucune heure avec robot sur la plage → frise remplacée par « Aucun passage du robot sur cette route et cette plage » (le panneau réel reste) ; > 300 heures → même troncature que CR7 ; à 390 px, si une case fait < 2 px, les cases sont regroupées par 3 h (pire état du groupe, dit dans la légende) | `tests/unit/FriseEtats.test.tsx` : état `incident` rendu avec le texte « incident » et le glyphe « × » ; case `absent` sans remplissage ; aucune `ReferenceArea` ni bande dans le rendu. e2e à 1440 et 390 : le centre de la première et de la dernière case est à ≤ 2 px de l'abscisse du premier et du dernier seau de CR7 |
| CR8 | « Concordance des états, par heure et par route » | Matrice 3 × 3 de comptes (table colorée). Elle transforme deux signaux en décision : sur la diagonale, le robot et le réel sont d'accord ; hors diagonale, l'un voit ce que l'autre ne voit pas. Heatmap réservée à une vraie densité 2D (`grafana.md` L143-147) : ici, deux axes catégoriels, donc une **table** | lignes = état robot du seau (`ok`, `warn`, `incident` = pire état de l'heure, `queries-v2.ts:405-406`) ; colonnes = verdict du LCP p75 réel de l'heure (`rating2026`) ; cellule = nombre d'heures × (app, route) ayant les deux mesures **et au moins 30 mesures LCP** ; hors matrice : « heures robot seul », « heures réel seul », « heures au réel insuffisant (moins de 30 mesures) », « état robot inconnu » | aucune comparaison temporelle ; la cellule « robot ok × réel non Bon » est nommée **angle mort**, la cellule « robot incident × réel Bon » est nommée **alerte robot non ressentie** | **à créer** : `correlationConcordance(f: FiltersLike, effectifMin = 30): Promise<{ cellules: { robot: "ok" \| "warn" \| "incident"; reel: Rating; heures: number }[]; robotSeul: number; reelSeul: number; reelInsuffisant: number; robotInconnu: number; anglesMortsParRoute: { app_id: string; route: string; heures: number }[]; bornesLcp: [number, number] }>`, construite sur `correlationSources(sql, "heure")` + `full outer join … using (app_id, route, bucket)`. Bornes et effectif **liés en paramètres** depuis `THRESHOLDS.LCP`, jamais écrits en dur dans le SQL | **à créer** `MatriceConcordance` (§ 4.3) dans une `Figure` | cellule angle mort → ancre `#angles-morts` ; autres cellules : non cliquables (aucune liste derrière), `title` explicatif | aucune heure avec les deux mesures → `vide` ; compte 0 dans une cellule → « 0 » | `tests/integration/correlation-sql.test.ts` : 4 heures seedées (ok/Bon, ok/Mauvais, incident/Bon, ok/Mauvais avec 12 mesures) → diagonale 1, angle mort 1, alerte robot non ressentie 1, réel insuffisant 1 ; le libellé « Mauvais » n'apparaît que pour LCP > 4 000 ms |
| CR9 | « Angles morts — heures où le robot dit ok alors que les visiteurs attendent » (`id="angles-morts"`) | Table triée : c'est une liste d'enregistrements à ouvrir un par un (Grafana Table, `grafana.md` L96). Notre différenciateur, conservé | une ligne par (app, route, heure) : robot = état + premier chargement moyen + scénarios ; réel = LCP p75 + verdict + mesures ; écart brut en ms (deux mesures différentes : colonne titrée « Réel − robot (ms, indicatif) ») | la règle, en toutes lettres au-dessus de la table : « Robot à l'état ok ET LCP p75 réel au-dessus de 2,5 s (borne Bon de `lib/rating.ts`) sur la même heure et la même route, heures d'au moins 30 mesures. » ; verdict réel écrit (« À améliorer » ou « Mauvais »), plus le mot unique « poor » | **existante, à modifier** : `blindSpots(f)` `queries-v2.ts:476-488`. Trois changements : borne liée depuis `THRESHOLDS.LCP[0]` au lieu du littéral `2500` (L483) ; filtre `r.rum_lcp_n >= $effectifMin` (même règle que CR8) ; ajouter `syn_measures` et `rum_lcp_n`. Plafond 50 conservé, total pris dans CR8 | table dans `Figure` (`meta` = « 50 premières sur N », N issu de CR8) | par ligne : « Voir l'heure » → `/correlation?serie=<app>:<route>&from&to` ; « Sessions de cette heure » → `/sessions?app=<app>&route=<r>&from&to` ; « Pages » → `/pages?app=<app>&route=<r>&from&to&panel=route:<r>` | 0 ligne → « Aucun angle mort sur la plage (règle : …) » **sans émoji** (aujourd'hui « 👍 », `page.tsx:135`) ; > 50 → bandeau `partiel` « 50 affichées sur N » | `tests/unit/correlation.test.ts` : la phrase de règle contient « 2,5 s » lu depuis `THRESHOLDS` (le test change la borne en mémoire et vérifie le texte) ; e2e : colonne « Scénarios robot » renseignée ; le nombre de lignes égale min(50, cellule angle mort de CR8) |
| CR10 | « Nuage des routes : premier chargement robot × LCP p75 réel » | Nuage de points : répond à « quelles routes sortent du lot » sur deux dimensions continues, taille = poids réel. Seul graphique où les deux mesures se lisent l'une contre l'autre, **par route et sans calcul d'écart** ; les axes sont séparés, donc aucune bande LCP ne s'applique à l'axe robot | x = moyenne robot sur la plage, y = LCP p75 réel sur la plage, z = `rum_lcp_n` ; un point par (app, route), seulement les couples vus des deux côtés | bandes horizontales Bon / À améliorer / Mauvais sur **y seulement**, (prop `bandesY`, § 4.2) | **existante** : `correlationCards(f)` + `rum_lcp_n` (CR5) | `ScatterPlot` (`charts/ScatterPlot.tsx:38-58`, props `points{x,y,z,label}`, `xLabel`, `yLabel`, `xFormat`, `yFormat` en identifiants) dans `Figure` | survol : infobulle route + trois valeurs ; clic sur un point → `/pages?app=<app>&route=<r>&panel=route:<r>` (`points[].href`, § 4.2) ; la table CR12 porte aussi les liens | < 2 couples → `EtatSurface{kind:"vide"}` « au moins deux routes vues des deux côtés sont nécessaires » | alternative textuelle : une ligne par couple (app, route, x, y, n) |
| CR11 | « Routes à trafic réel sans scénario robot » (`id="sans-robot"`) | Classement en barres (`RankBar`) : un top N reste un classement (P14). Prioriser le prochain scénario à écrire, à la manière d'Ekara (« ciblez les pires combinaisons », `iplabel.md` L87-98) | couples où `syn_latency_avg` est nul ; barre = `rum_lcp_n` ; sous-libellé = LCP p75 + verdict ; tri **gravité** (verdict Mauvais d'abord, puis volume), `n < 30` en fin avec « échantillon faible » (P3) | aucune | **existante** : `correlationCards(f)` (full outer join, `queries-v2.ts:415-426`) + `rum_lcp_n` (CR5) | `RankBar` (`data[].href`, `sub`, `color` = `RATING_HEX` du verdict) dans `Figure` | clic barre → `/pages?app=<app>&route=<r>&panel=route:<r>` | 0 couple → « Toutes les routes à trafic réel ont un scénario robot sur la plage » | `tests/unit/correlation.test.ts` (`trierSansRobot`) : une route Mauvais à 40 mesures passe avant une route Bon à 4 000 mesures ; une route à 12 mesures passe après les deux |
| CR12 | « Routes : robot et réel côte à côte » (`id="routes"`) | Table (remplace les `RouteCard`) : une carte par route prend ~200 px de haut (3 routes = 600 px sur `20-correlation.png`) et ne passe pas l'échelle ; la table compare des colonnes alignées | par (app, route) : robot premier chargement moyen · pire état robot · score robot moyen · scénarios ; réel LCP p75 + verdict · INP p75 + verdict · mesures LCP · sessions distinctes | la note sous la table : « l'état robot est le **pire** état de la plage, le score est une **moyenne** : un score 92 peut côtoyer un état incident » (défaut observé, `console-ecrans-3.md` L39-43) | **existante** : `correlationCards(f)` (`rum_lcp_p75`, `rum_inp_p75`, `rum_sessions`, `syn_latency_avg`, `syn_score_avg`, `syn_state`, `syn_measures`) + `rum_lcp_n` | table SSR dans `Figure` ; verdict via `RATING_LABEL` + pastille ; colonne « App » affichée seulement si plus d'une app dans le résultat | route → sélectionne le hero (`serie=<app>:<route>`) ; « Pages » → `/pages?app=<app>&route=` | robot absent → « pas de scénario robot sur cette route » ; réel absent → « pas de trafic réel sur la plage » (textes conservés, `RouteCard.tsx:56, 79`) ; route robot sans réel → avertissement « vérifier la correspondance `route_hint` ↔ route » (cas `/partners/:id` de la capture) | colonne « écart % » absente ; tri par défaut : lignes avec les deux mesures d'abord (ordre SQL actuel, L423) puis LCP p75 décroissant |

#### 5.7.4 Conservé, et pourquoi

- La définition écrite de l'angle mort (`blindSpots`), le choix d'agréger chaque côté **avant** la
  jointure (`CHANGELOG.md:256`, `v_correlation`), et le full outer join, qui laisse voir les routes
  d'un seul côté. C'est plus précis que ce qu'Ekara décrit (`iplabel.md` L413-417).
- Les messages d'absence d'un côté (`RouteCard.tsx:56, 79`).
- Le paramètre d'écran `serie` (§ 3.1), avec un format élargi et lu de
  façon compatible (CR7-a).

#### 5.7.5 Ce qui disparaît, et pourquoi

- Le badge « écart −90 % — réel plus rapide que le robot » : il divise deux mesures différentes
  (premier chargement du scénario contre LCP p75). La matrice CR8 le remplace.
- La courbe robot tracée sur l'axe et les bandes du LCP (`RobotVsRealChart`) : remplacée par la frise d'états CR7-b.
- `RobotVsRealChart` (`components/features/RobotVsRealChart.tsx`), hors `components/charts/`, sans
  bandes ni alternative. Le fichier est supprimé quand plus rien ne l'importe.
- Le libellé « poor » des angles morts pour LCP > 2,5 s (`correlation/page.tsx:114`). F00 le corrige,
  CR9 écrit le verdict réel.
- Le fond rouge du bloc « Angles morts » quand il est vide (capture) : l'absence d'angle mort n'est pas
  une alerte.

### 5.8 Tracing — `/tracing`

#### 5.8.1 Question, référence

- **Question** : « Quand un appel est lent, le temps part-il dans le serveur ou dans le trajet
  (réseau, proxy) ? »
- **Question suivante** : « Pour cet appel précis, quel segment prend le temps ? » →
  `/tracing/[traceId]`.
- **Référence retenue** : **nôtre, conservée**. La décomposition front / serveur / réseau vient d'un
  seul schéma `rum_span`, sans produit APM séparé (`console-ecrans-3.md` L182-190). Grafana « HTTP
  insights » fournit la grammaire RED (débit, erreurs, durée ; `grafana.md` L49-53). Datadog n'est
  pas retenu : aucune capture ni doc lue ne couvre son APM (`console-ecrans-3.md` L20-24).

#### 5.8.2 Grille

| Ordre | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| 1 | `PageHeader` (domain « Robot et réel », `help="tracing"`) | — | — | — |
| 2 | Rangée KPI : 5 `KpiTile` | 5 colonnes | 3 + 2 | 2 colonnes |
| 3 | Hero « Appels API les plus lents, et la part médiane du serveur » (3/5) + « Latence des appels dans le temps » (2/5) | côte à côte, **au-dessus du pli** | empilés | empilés ; la barre de part passe sous la barre de durée |
| 4 | « Traces les plus lentes » (`id="traces"`) | pleine largeur | idem | table défilante |
| 5 | « Tous les appels API » (table ; 10 premières lignes visibles, le reste dans `<details>`) | pleine largeur | idem | défilante |
| 6 | « Routes serveur » | pleine largeur | idem | défilante |
| 7 | « Dernier déploiement » (`DeployPanel`) | pleine largeur | idem | idem |

#### 5.8.3 Widgets

**Lecture commune T6 / T8** : **à créer** `apiCallsDecomposition(f: FiltersLike): Promise<{ url: string;
method: string; n: number; n_suivis: number; front_p75: number | null; back_p75: number | null;
reseau_p75: number | null; part_serveur_p50: number | null; err: number }[]>`. Même `from` et même
jointure « jumeau serveur dans la même app » que `apiCalls` (`queries-tracing.ts:52-73`), `limit 50`,
triée par gravité (`front_p75` décroissant, `n < 30` en fin). `back_p75` = p75 de `b.duration_ms` des
appels suivis ; `reseau_p75` = p75 de `greatest(fr.duration_ms − b.duration_ms, 0)` **calculé par
trace** ; `part_serveur_p50` = médiane de `b.duration_ms / nullif(fr.duration_ms, 0)` sur les appels
suivis, bornée à [0, 1]. Remplace `apiCalls` sur cet écran.

| # | Libellé exact | Type et pourquoi | Mesure · agrégation · dimensions · granularité | Comparaison | Source | Composant | Interactions | États | Critère d'acceptation |
|---|---|---|---|---|---|---|---|---|---|
| T1 | KPI « Appels API vus du navigateur » | Stat (débit, le R de RED) | `count(*)` des spans `tier='front'` sur la plage | vs période précédente si `cmp=prev` | **existante** : `traceCoverage(f).total` `queries-tracing.ts:20-40` | `KpiTile` `format:"count"`, `sensMeilleur:"neutre"` | tuile → ancre `#appels` | `0` réel ; échec → « — » | `tests/integration/tracing-sql.test.ts` : le nombre égale la somme des `n` de `apiCallsDecomposition` quand elle rend moins de 50 lignes |
| T2 | KPI « Appels suivis jusqu'au serveur » | Stat en % : la couverture de la corrélation conditionne tout le reste de l'écran (P11) | `correlated / total` ; `null` si `total = 0` | aucune | **existante** : `traceCoverage` (`correlated`) | `KpiTile` `format:"pct"`, `raisonNull:"aucun appel API sur la plage"`, `couverture:{n: total, unite:"appels"}`, `lecture` : « un appel sans jumeau serveur n'a pas pu être décomposé : middleware absent ou appel vers un tiers » | — | `null` → « — » + raison | à 0 appel, la tuile n'affiche jamais « 0 % » |
| T3 | KPI « Durée p75 vue du navigateur » | Stat (le D de RED) | `percentile_cont(0.75)` de `fr.duration_ms` | vs précédente | **existante** : `traceCoverage.front_p75` | `KpiTile` `format:"ms"` | tuile → ancre `#hero-traces` | `null` → « — » | — |
| T4 | KPI « Durée p75 côté serveur (appels suivis) » | Stat | `percentile_cont(0.75)` de `b.duration_ms` des jumeaux | vs précédente | **existante** : `traceCoverage.back_p75` | `KpiTile` `format:"ms"`, `couverture:{n: correlated, unite:"appels suivis"}` | — | `null` si aucun jumeau | le libellé dit « appels suivis » : ce p75 ne porte pas sur la même population que T3 |
| T5 | KPI « Appels en échec » | Stat en % (le E de RED) | appels front au statut ≥ 400 ou 0 (réseau) / appels front ; `null` si 0 appel | vs précédente | **à créer** : champ `err: number` ajouté à `traceCoverage` (`count(*) filter (where coalesce(fr.status_code,0) >= 400 or coalesce(fr.status_code,0)=0)`, même prédicat que `apiCalls` L62-63) | `KpiTile` `format:"pct"`, `sensMeilleur:"bas"`, `lecture` : « 0 = coupure réseau ou requête annulée » | tuile → ancre `#appels` (T8, colonne Échecs) | `null` → « — » | un appel au statut 0 compte comme échec |
| T6 (hero) | « Appels API les plus lents, et la part médiane du serveur » (`id="hero-traces"`) | Classement en barres (un top N, P14). **La longueur de la barre = p75 navigateur, et rien d'autre.** La part serveur est une **proportion**, mesurée appel par appel (médiane de `back/front`) ; elle s'affiche sur sa propre échelle 0-100 % (`ShareBar`), à côté, jamais convertie en ms ni empilée. Ainsi aucune longueur ne se lit « le serveur prend X ms » | par `(méthode, chemin)` : `n`, `n_suivis`, `front_p75`, `part_serveur_p50` ; top 10 de `apiCallsDecomposition` (ordre de gravité ci-dessus) | ligne « Ensemble » en tête : `front_p75` global (T3) et texte « serveur : p75 <T4> sur <correlated> appels suivis » ; sous chaque barre : « p75 820 ms · 150 appels » puis `ShareBar` + « médiane, 120 appels suivis sur 150 » | à créer : `apiCallsDecomposition` (lecture commune) | `RankBar` **sans `segments`** : `value = front_p75`, `display = fmtLatency(front_p75)`, `color` = accent (aucune couleur de verdict : aucun seuil publié pour une durée d'API), `sub` = `<>{n} appels · <ShareBar share={Math.round(part_serveur_p50 × 100)} /> <span>médiane, {n_suivis} appels suivis sur {n}</span></>` ; `front_p75 = null` → ligne exclue du classement (comptée dans la `meta`). Légende de la `Figure` : « Barre = durée p75 vue du navigateur. Part serveur = médiane, appel par appel, de la durée serveur rapportée à la durée navigateur, sur les appels suivis. » | barre (libellé) → `href = <URL courante, mêmes paramètres> + "#appel-" + hash` (ligne correspondante de T8, voir la note sous le tableau) ; lien secondaire « Traces de cet appel » → **T9 filtré** (paramètre `appel`, § 3.1) : `/tracing?<paramètres courants>&appel=<méthode> <chemin>#traces` | 0 appel → `vide` « Aucun appel API instrumenté sur <plage> » (texte actuel conservé, `page.tsx:71`) ; `n_suivis = 0` ou `part_serveur_p50 = null` → pas de `ShareBar`, texte « non décomposé : aucun jumeau serveur » | `tests/unit/tracing-hero.test.ts` (fonction `lignesHero` qui construit les `RankDatum`) : **aucune** ligne n'a de `segments` ; `part_serveur_p50 = null` → `sub` contient « non décomposé » ; `tests/integration/tracing-sql.test.ts` : deux appels (front 100 / back 90, front 1 000 / back 100) → `part_serveur_p50 = 0,5` (médiane de 0,9 et 0,1) |
| T7 | « Latence des appels dans le temps » | Série temporelle : situe une dégradation dans le temps et face aux déploiements (P9). Pas de bandes : aucun seuil publié pour une durée d'API. Deux séries, **non empilées** | p75 navigateur par seau et p75 serveur des appels suivis par seau ; seau `bucketSecondsFor` du contrat | `cmp=prev` : navigateur de la période précédente, gris pointillé (3 séries au plus) | **à créer** : `spanLatencySeries(f: FiltersLike): Promise<{ t: string; front_p75: number \| null; back_p75: number \| null; n: number }[]>` (seaux `bucketStarts` en SQL via `generate_series`, seaux vides à `null`, `n = 0`). L'Explorer (`exploreAnalytics`, `queries-explorer.ts:229`, jeu `spans`, `duration_ms` p75, `analytics-schema.ts:519-548`) ne sait pas restreindre le serveur aux appels suivis : le p75 « back » y inclurait robots et curl (`queries-tracing.ts:13`) | `ThresholdSeries` sans `vital`, `grille = bucketStarts(range)`, `format:"ms"`, `series=[{cle:"front_p75", libelle:"Navigateur · p75", role:"principale", effectifCle:"n"}, {cle:"back_p75", libelle:"Serveur · p75 (appels suivis)", role:"categorie", categorieIndex:0}]`, `faibleSous:30`, annotations déploiements ; `Figure.explorer` = spans `duration_ms` p75 `variant=front` en série | seau → zoom `from/to` | seau sans appel → trou ; `n` < 30 sur un seau → point creux (légende « moins de 30 appels ») | alternative : une ligne par seau avec `n` |
| T8 | « Tous les appels API » (`id="appels"`) | Table : 50 lignes max, colonnes comparables ; les durées serveur et trajet y sont **deux colonnes séparées**, chacune un vrai p75 | colonnes : Méthode · Chemin · Appels · Suivis · p75 navigateur · p75 serveur (appels suivis) · p75 trajet (par trace) · Part serveur (médiane) · Échecs (compte et %) | aucune | à créer (lecture commune), **même ordre que T6** : les 10 lignes de T6 sont les 10 premières lignes de T8, toujours hors du `<details>` | table SSR ; `ShareBar` (`components/tracing/ShareBar.tsx`) conservé pour « Part serveur », alimenté par `Math.round(part_serveur_p50 × 100)` ; chaque `<tr>` porte `id={"appel-" + hash}` | ligne → « Voir les traces » (**T9 filtré**, paramètre `appel`) ; « Ouvrir dans l'Explorer » (spans, `g0=name`) | > 10 lignes : `<details>` « Voir les 50 appels » ; 50 atteint → `partiel` « 50 appels les plus lents affichés » ; `part_serveur_p50 = null` → « — » (pas de `ShareBar`, qui n'accepte qu'un nombre) | `tests/integration/tracing-sql.test.ts` : la colonne « p75 trajet » ne vaut jamais `front_p75 − back_p75` (cas seedé où ces deux valeurs diffèrent) ; e2e : chaque `<tr>` a un `id` qui commence par `appel-` |
| T9 | « Traces les plus lentes » (`id="traces"`) | Table d'enregistrements, chacun ouvrant le détail | 20 appels front les plus longs : heure (UTC), méthode + chemin, statut, navigateur ms, serveur ms, trajet ms, session | aucune | **existante** : `slowTraces(f)` `queries-tracing.ts:158-176` (`limit 20`, `network_ms = greatest(front − back, 0)` par trace : correct) ; filtre par appel : `opts.appel` (§ 4.5) | table SSR (`SlowRow` conservé, `components/tracing/SlowRow.tsx`) ; si `appel` est posé : titre « Traces les plus lentes — <méthode> <chemin> » + lien « Retirer ce filtre » | ligne → `/tracing/<traceId>` ; « Session » → `panel=session:<id>` ; « Rejeu à cet instant » → `/sessions/<id>?tab=replay&at=<ts epoch ms>` (`app/sessions/[id]/page.tsx:42-44` : `at` en epoch ms) | 0 → « Aucune trace sur la plage » (avec `appel` : « Aucune trace de <méthode> <chemin> sur la plage ») ; `back_ms = null` → « non suivi » (pas « 0 ms ») | e2e : le lien de rejeu porte `at` = `ts` de la trace en ms ; `?appel=GET /api/x` ne liste que des lignes `GET /api/x` |
| T10 | « Routes serveur » | Table (templates d'URL serveur) | `n`, p75, p95, erreurs 5xx, taux 5xx = `err / n` | aucune | **existante** : `backRoutes(f)` `queries-tracing.ts:84-101` (tout trafic serveur rattaché à une session, sous-titre actuel conservé) | table SSR | ligne → Explorer spans `variant=back`, `g0=route` ; lien « Carte » → `/map` | 0 → « Aucun span serveur reçu : middleware non déployé ou trafic nul » (texte actuel, deux causes nommées) | la colonne taux vaut `—` si `n = 0` |
| T11 | « Dernier déploiement : avant / après » | Carte avant/après (règle écrite) | LCP p75 et `sum(occurrences)` d'erreurs, ±2 h autour du dernier déploiement | règle affichée : « +20 % ou plus, ±2 h, filtres de population non appliqués » (§ 3.2) | **existante** : `latestDeployImpact(f)` `queries-deploys.ts:61-92`, `assessRegression` L103-111, `listDeploys(f, 6)` | `DeployPanel` conservé (`components/tracing/DeployPanel.tsx`) | version → `/?cmp=release&rel_b=<v>` | **aucun déploiement** : ne disparaît plus (`return null`, `DeployPanel.tsx:16`) → `EtatSurface{kind:"non_collecte", manque:"aucun déploiement déclaré : POST /api/v1/deploys depuis la CI"}` (`app/api/v1/deploys/route.ts`) | e2e : sans déploiement, le texte « POST /api/v1/deploys » est visible |

**Ancre `#appel-<hash>` (T6 → T8) et paramètre `appel` (§ 3.1).** `<hash>` =
`encodeURIComponent(methode + " " + chemin)`, avec `methode` et `chemin` = `method` et `url` tels que
renvoyés par `apiCallsDecomposition` (aucune autre normalisation). C'est la même chaîne
`methode + " " + chemin` que la valeur du paramètre `appel=`, lu par `slowTraces(f, { appel })` : `and fr.method = $m and regexp_replace(coalesce(fr.url, ''), '^https?://[^/]+', '') = $u` (valeurs liées ; même expression de chemin que `apiCalls` et `slowTraces`, `queries-tracing.ts:56, 164`). Chaque ligne de T8 porte
`id={"appel-" + hash}`. Le lien de T6 écrit le fragment tel quel (déjà encodé) ; les tests e2e le
retrouvent par `document.getElementById("appel-" + hash)`, pas par un sélecteur CSS. Les deux
fonctions vivent dans `lib/tracing-ancres.ts` : `ancreAppel(method, url): string` et
`lireAppel(sp): { method: string; url: string } | null` (couper au premier espace).
`tests/unit/tracing-ancres.test.ts` : `ancreAppel("GET", "/api/a b")` = `"appel-GET%20%2Fapi%2Fa%20b"` ;
`lireAppel` sur `"GET /api/x"` rend `{method:"GET", url:"/api/x"}` ; valeur sans espace → `null`.

#### 5.8.4 Conservé / disparaît

- **Conservé** : la jointure « jumeau serveur dans la même app » (`queries-tracing.ts:1-4, 18`), les
  messages d'état qui nomment deux causes, `SlowRow`, `ShareBar` (désormais aussi dans le hero),
  `DeployPanel`.
- **Disparaît** : le calcul « réseau = front_p75 − back_p75 » du hero (`app/tracing/page.tsx:37-56`) ;
  toute barre empilée en ms dans le hero ; la légende de couleurs écrite dans la page (L62-65),
  remplacée par la légende de `Figure`.

### 5.9 Détail de trace — `/tracing/[traceId]`

#### 5.9.1 Question, référence, grille

- **Question** : « Pour cet appel, où est passé le temps, segment par segment, et qu'a vécu le
  visiteur à ce moment ? »
- **Question suivante** : la session et son rejeu à l'instant de l'appel ; l'erreur liée.
- **Référence** : cascade Datadog (`datadog-video-rum-db-new.md` M11), réalisée par `Cascade`
  (§ 4.2, F07). Nous gardons l'isolation par tenant (`traceApps()`, `console-ecrans-3.md`
  L245-251).
- **Grille** : en-tête à puces → bandeaux d'état → `Cascade` pleine largeur (au-dessus du pli à
  1440) → « Erreurs liées à cette trace » → table des segments (alternative). À 390 : les pistes
  passent sous le libellé, la cascade reste horizontale (pourcentages, `page.tsx:180-181`).

#### 5.9.2 Widgets

| # | Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| TD1 | En-tête : « Latence perçue », « Segments », « Route », « Session », « Apps » (si > 1) | Puces : identité de l'appel, pas une mesure agrégée | `front.duration_ms` ; `spans.length` ; route ; session ; apps distinctes (`TraceSpanRow.app_id`, affiché nulle part aujourd'hui, `console-ecrans-3.md` L266-268) | aucune | **existante** : `traceSpans(traceId, {apps})` `queries-tracing.ts:142-155` | `PageHeader` + puces du modèle `DetailPanel.puces` | Session → `/sessions/<id>` ; bouton « Copier l'identifiant de trace » (îlot client ≤ 20 lignes, `navigator.clipboard`, repli : champ en lecture seule sélectionnable) | route / session absentes → « — » | l'identifiant complet (32 caractères) est copiable, pas seulement les 16 affichés (L105) |
| TD2 | « Chronologie de l'appel » | Cascade : axe horizontal partagé, position réelle de chaque segment (conservé : offset réel) | un élément par span : début = `ts − t0`, durée ; pistes « Navigateur », « Serveur », « Base de données » (`kind='db'`), « Interne » | aucune | existante (TD1) | `Cascade` (F07) : `ton` = `"erreur"` si `status_code ≥ 500` ; `"warn"` si 400-499 ; `"neutre"` sinon (la couleur porte la sévérité, § 4.2 `Cascade`) ; `selection = span` ; `parentId = parent_span_id` | segment → met `?span=<id>` ; `?span` inconnu → bandeau « segment introuvable » (état `missing` conservé, `page.tsx:156-169`) | aucun span serveur → bandeau « Aucun span serveur reçu : déployez le middleware MIP ou un agent OpenTelemetry » (conservé) ; trace absente du périmètre → `notFound()` (conservé, choix de sécurité) avec `not-found.tsx` français (F02) | e2e (étend `tests/e2e/tracing.spec.ts:153`) : un span 503 a la classe de ton `erreur` |
| TD3 | « Rejeu à l'instant de l'appel » | Lien, pas une figure | `ts` du span front en epoch ms | — | existante (TD1) + `sessionMeta(id)` `queries.ts:413-416` pour vérifier que la session est lisible | lien | → `/sessions/<id>?tab=replay&at=<ms>` | pas de session → lien absent + « appel sans session (hors navigateur) » | — |
| TD4 | « Erreurs liées à cette trace » | Liste courte : une erreur JS portant ce `trace_id` explique souvent l'appel | groupes d'erreurs dont `rum_error.trace_id = traceId`, dans les apps autorisées : empreinte, message, `sum(occurrences)` | aucune | **à créer** : `errorsOfTrace(traceId: string, opts: { apps: string[] \| null }): Promise<{ fingerprint: string; message: string \| null; occurrences: number; source_parent_span_id: string \| null }[]>` sur `rum_error` (colonne `trace_id`, v69 ; lue dans `queries-errors.ts:708, 731`) | liste SSR | ligne → `/errors/<fingerprint>` ; si `source_parent_span_id` est présent → `?span=` du segment parent | 0 → « Aucune erreur JS ne porte cet identifiant de trace » | `tests/integration/tracing-sql.test.ts` : occurrences = `sum(occurrences)` (V1) ; `apps = []` → aucune ligne |
| TD5 | Table « Segments » (alternative de TD2) | Table | libellé, piste, début, durée, statut, app | — | existante | `Figure.alternative` | — | — | mêmes lignes que TD2 |

### 5.10 Carte `/map`

Rattachement : catégorie **Robot et réel** (§ 2.2), 3ᵉ onglet ; `PageHeader.domain = "Robot et réel"`. Écran sur le contrat
(`lib/surfaces.ts` : `/map`, `range: "custom"`, jeux `spans, vitals`).

#### 5.10.1 Question et suite

- **Question** : « Quelles pages appellent quels services back, et lesquels ralentissent ou échouent ? »
- **Réponse en dix secondes** : le graphe front → back coloré par santé, avec la liste « à risque ».
- **Question suivante** : « Quelles traces lentes passent par ce service ? » →
  `/tracing?route=<route>` ; « cette page est-elle lente pour les visiteurs ? » → `/pages?route=`.

#### 5.10.2 Référence retenue

**Nôtre, conservé** (un graphe qui réunit santé, volume et tendance, avec un seuil anti-bruit sur la
tendance : `console-ecrans-3.md` L308-316) ; **Grafana** pour la règle « un panneau = une question » et
les liens de données ; la Service Map Datadog n'a pas été vue (non établi).

#### 5.10.3 Grille

| # | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| M1 | En-tête + filtres | — | — | — |
| M2 | KPI : 4 `KpiTile` | 4 col. | 2 × 2 | 2 × 2 |
| M2b | Bandeau d'échantillonnage (S7) | pleine largeur | idem | idem |
| M3 | Hero « Pages → services » (graphe) | pleine largeur | défilement horizontal interne | **graphe remplacé** par la table des liens (le graphe à 390 px est illisible) avec lien « Voir le graphe » |
| M4 | « Services classés » (`ImpactTable`) | 7 col. | pleine largeur | cartes |
| M5 | « Pages les plus visitées » | 5 col. | pleine largeur | cartes |
| M6 | Panneau nœud | 50 % | plein écran | plein écran |

#### 5.10.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Routes cartographiées** | stat | nœuds front et back renvoyés (≤ 40) | — | existante : `mapNodes(f)` (`lib/queries-map.ts:L22-45`, `limit 40`) | `KpiTile` ; « 40 ou plus » à 40 (le libellé actuel « total réel » est faux au-delà de 40) | — | 0 → voir hero | — |
| **Appels front avec service corrélé** | stat : dit la couverture du graphe | part des spans front qui ont un jumeau back | — | existante : `traceCoverage(f)` (`lib/queries-tracing.ts:L20`) | `KpiTile format="pct"` | → `/tracing` | total 0 → `null` | — |
| **Services à risque** | stat | nœuds `atRisk` (volume en hausse **et** santé non bonne) | — | `atRisk`, `trend`, `apiHealth` (`lib/map.ts:L10-36`) | `KpiTile format="count"` | → ancre M4 trié gravité | — | — |
| **Service le plus sollicité** | libellé-valeur | route du nœud au plus d'appels, avec son nombre d'appels | — | `mapNodes` | `KpiLibelle` (§ 4.2) : « GET /api/panier · 1 240 appels » | → panneau nœud | aucun nœud → « — » + « aucun appel corrélé » | — |
| **Échantillonnage** (bandeau M2b, S7) | bandeau (voir § 5.11.4) | même calcul que § 5.11.4 sur les sessions portant au moins un span front dans `[from,to)` (une session « biaisée-erreurs » sans erreur n'émet aucun span, `migration-v58.sql:L85-86`) | — | **à créer** B38 `samplingSessions(f, { avecSpans: true })` | `EtatSurface kind="echantillonne"` sous M2 | aucune | idem § 5.11.4 | e2e S7 sur `/map` |
| **Pages → services** (hero) | graphe nœud-lien à deux colonnes (conservé) : la question est une relation ; **améliorations** : nœuds au-delà de 10 par colonne regroupés en un nœud « Autres routes (N) » qui **reçoit** les arêtes (aujourd'hui ignorées, `lib/map.ts` `layoutGraph`, `console-ecrans-3.md` L324-326) ; santé écrite dans le nœud (« 2,4 % err · p75 1,2 s ») en plus de la couleur ; tendance en % (`recent` / `older`, L16-17) | nœuds : appels, p75 latence, taux d'erreur HTTP ≥ 400 ; arêtes : paires front × back d'une même trace | tendance : moitié récente vs ancienne de la plage (dite) | existantes : `mapNodes`, `mapEdges` (L54-69) ; **corriger** : `apiHealth(errorRate, null)` → santé `inconnue` (pas 0 ms, `lib/map.ts:L11`) | `ExperienceMap` (props `{ layout }`) + type `Health` étendu à `"unknown"` | nœud → `panel=noeud:<tier>:<route>` (type de panneau `noeud`, § 3.1) | vide : `vide` « Aucun appel corrélé sur <plage> : la carte se remplit quand le tracing front → back émet » **sans masquer** M5 (aujourd'hui toute la page disparaît, `app/map/page.tsx:L58, L68`) | méta : « statut 0 (échec réseau) non compté comme erreur » (`queries-map.ts:L34` ne compte que ≥ 400) ; « une trace à deux spans serveur compte deux arêtes » |
| **Services classés** | classement par gravité (P3, IP-Label « top offenders ») avec bascule volume ; colonnes : tier, route, appels, p75, taux d'erreur, tendance chiffrée | par nœud | pas d'écart à l'ensemble : aucune p75 « tous appels » n'est servie (et une moyenne des p75 est interdite, V5) ; `reference` = « Tous les services : n appels », colonne `ecart` absente | `mapNodes` ; tri et garde n < 30 : `lib/impact.ts` (F05) | `ImpactTable` (`tri`, `triHref`, `pilote` = p75, `volume` = appels) | ligne → panneau nœud | `latency_p75 null` → « — » et en fin | test : `tri=volume` range par appels |
| **Pages les plus visitées** | table : route, sessions, LCP p75 avec verdict | top 12 routes par sessions ayant une mesure | — | existante : `mapPages(f)` (L78-94) ; **renommer** (« Pages d'entrée » est faux : ce sont les routes les plus mesurées) ; verdict par `rating2026` (**pas** `pageHealth`, qui dit « good » sans mesure, `lib/map.ts:L19`) | table SSR | route → `/pages?route=` | `lcp_p75 null` → « — » (jamais « Bon ») ; vide → `vide` dédié (absent aujourd'hui) | e2e : une route sans LCP n'affiche pas de pastille verte |
| **Panneau nœud** | panneau | appels, p75, taux d'erreur, tendance ; arêtes entrantes / sortantes classées | — | `mapNodes`, `mapEdges` (filtrage côté page) ; série de latence : **à créer** B37 `mapNodeSerie(f, tier, route): Promise<{t, p75, appels}[]>` | `DetailPanel` + `ThresholdSeries` (après B37) | « Traces lentes de ce service » → `/tracing?route=<route>` ; « Page » → `/pages?route=` (front) | série avant B37 : `partiel` « série à créer » | — |

#### 5.10.5 Conservé / disparaît

Conservé : graphe SVG serveur, seuil anti-bruit de la tendance, notion « à risque ». Disparaît : la
condition `empty` qui masque la section « pages » ; le libellé « Pages d'entrée » ; le tableau « Top
talkers » (absorbé par « Services classés », qui ajoute le tri par gravité et l'effectif).

**Catégorie Usages** — § 5.11 à § 5.17.
### 5.11 Sessions `/sessions`

#### 5.11.1 Question et suite

- **Question (sous-titre `PageHeader`)** : « Quelles sessions regarder en premier, et qui sont les
  visiteurs de cette période ? »
- **Réponse en dix secondes** : la figure « À regarder d'abord » (hero) liste les 10 sessions qui
  cumulent le plus d'occurrences d'erreur et de signaux de frustration, chacune avec sa raison écrite
  et son bouton de rejeu.
- **Question suivante** : « Que s'est-il passé dans celle-ci ? » → panneau `panel=session:<id>` puis
  `/sessions/<id>?tab=replay&at=<ms de la première erreur>`.

#### 5.11.2 Référence retenue

**Datadog** (Sessions Explorer : table dense avec `ERROR COUNT`, `FRUSTRATION COUNT`, ▶ par ligne,
panneau latéral, `reads/datadog-docs-errors-replay-frustration.md` L334 ; `datadog/frames/…/f005.png`)
pour la mécanique « de la liste au rejeu en un clic » ; **IP-Label** pour le classement par gravité et
les vues préréglées (`iplabel.md` L87-98, L62-63) ; **nôtre, conservé** pour les populations séparées
et l'absence de recherche par identité (`console-ecrans-2.md` L211-218). Datadog classe les sessions par
date et laisse l'analyste trier ; nous posons un classement par gravité **à côté** de l'index
chronologique, parce que le tri par signaux casserait la pagination stable par curseur
(`lib/sessions-search.ts:L102-132`) — voir § 5.11.6, écart justifié.

#### 5.11.3 Grille

Ordre des zones (1440 px, ≈ 1 150 px utiles) :

| # | Zone | 1440 px | 768 px | 390 px |
|---|---|---|---|---|
| Z1 | `PageHeader` + `GlobalFilters` + `SegmentBar` + `PresetBar` | pleine largeur | idem | `PresetBar` défilante avec indicateur |
| Z2 | Rangée KPI : 5 `KpiTile` | 5 colonnes | 3 + 2 | 2 colonnes, 3 rangées |
| Z2b | Bandeau d'échantillonnage (S7), rendu seulement s'il est dû | pleine largeur | idem | idem |
| Z3 | Hero « À regarder d'abord » (8 col.) + « Qui sont ces sessions » (4 col.) | côte à côte | empilés | empilés ; hero en cartes, 5 lignes puis « Voir les 10 » |
| Z4 | « Volume » : 2 `ThresholdSeries` empilées, axe x partagé | pleine largeur | idem | idem, hauteur 160 chacune |
| Z5 | « Engagement » (3 `KpiTile`) + « Nouveaux, revenants, non identifiés » (`Donut`) | 8 + 4 col. | empilés | empilés |
| Z6 | Recherche exacte + filtres rapides + table « Toutes les sessions » | pleine largeur | table défilante horizontalement dans sa carte (`overflow-x-auto`) | cartes compactes (une session = 3 lignes), pas de table |
| Z7 | Panneau `DetailPanel type="session"` | 50 % à droite (≥ 1280 px) | plein écran | plein écran |

**Au-dessus du pli à 1440 × 900** : Z1, Z2, Z2b (s'il est rendu) et les 6 premières lignes du hero Z3
(critère P1) ; avec le bandeau, le hero peut n'en montrer que 5 : accepté, le bandeau passe avant.

#### 5.11.4 Table des widgets

Colonnes : **Libellé** · **Type et pourquoi** · **Mesure / agrégation / dimensions / grain** ·
**Comparaison** · **Source** · **Composant** · **Interactions** · **États** · **Critère d'acceptation**.

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Vues préréglées** | rangée de liens : une vue = un clic (IP-Label « EU • Mobile • Checkout ») | — | — | `lib/presets.ts` (F08) ; vue produit supplémentaire « Capteur extension » (`source=extension`) (§ 3.6, vue `p:extension`) | `PresetBar` | clic → paramètres du contrat seulement | vue produit sans donnée : désactivée avec raison | e2e : clic « Mobile » ne change que `device` |
| **Sessions commencées** | stat + sparkline (Grafana « stat + tendance ») : un volume se juge d'un coup d'œil, sa forme dans la sparkline | `count(*)` de `rum_session`, `started_at ∈ [from,to)` ; sparkline = sessions par seau | `cmp=prev` : même lecture sur `previousRange` | existante : `engagementStats(f).sessions_started` (`lib/queries-sessions.ts:L20-48`) ; sparkline : `observedVisitorsTrend(f)[].sessions` (L68-95) ; précédent : **à créer** `engagementStats(f, shift = false)` sur le modèle de `overviewStats(f, shift)` (`lib/queries.ts:L124`) | `KpiTile format="count" couverture={{n, unite:"sessions"}}` | tuile → `/explorer?dataset=sessions&measure=count:started&viz=timeseries&run=1` | 0 réel → « 0 » + « Aucune session commencée sur <plage> » ; erreur → `SectionErreur` | la valeur égale `sum(observedVisitorsTrend.sessions)` (test d'intégration sur la base de démo) |
| **Visiteurs distincts** | stat sans sparkline : un distinct par seau ne s'additionne pas, une sparkline inviterait à le faire | `count(distinct visitor_id)` où `id_kind='random'` sur la fenêtre | `cmp=prev` (même requête décalée) | existante : `exploreAnalytics({query, plan:{dataset:"sessions", measure:{field:"visitors", aggregation:"distinct"}, groupBy:[], visualization:"value", …}})` (`lib/queries-explorer.ts:L229` ; mesure `VISITEURS_DISTINCTS`, `lib/analytics-schema.ts:L197-206`) | `KpiTile format="count"` + `lecture` « identifiant aléatoire seulement » | tuile → Explorer même plan | `null` → « — » + « aucune session identifiée » | libellé contient « identifiant aléatoire » |
| **Sessions sans identifiant** | stat : dit ce qui sort du compte des visiteurs | `sum(sans_identifiant)` par seau (additif : sessions) | aucune | existante : `observedVisitorsTrend(f)[].sans_identifiant` (L78) | `KpiTile format="count"` | aucun (pas de dimension `visitor_id is null` dans le contrat) | 0 → « 0 » (vrai zéro) | somme calculée côté serveur, jamais sur des visiteurs |
| **Occurrences d'erreur par session commencée** | stat : un taux borné plutôt qu'un total qui suit le trafic ; numérateur et dénominateur portent sur **la même population** | `sum(occurrences)` des erreurs **rattachées** aux sessions commencées dans `[from,to)` (toutes les erreurs de ces sessions, y compris celles d'après `to` pour une session à cheval sur la borne) ÷ nombre de ces sessions ; les erreurs sans session rattachée sont exclues et comptées à part | `cmp=prev` : même lecture avec `shift = true` | **à créer** B39 `erreursParSessionCommencee(f: FiltersLike, shift = false): Promise<{ sessions: number; occurrences: number; sansSession: number }>` sur `sqlContext` : CTE `commencees` de `engagementStats` (`lib/queries-sessions.ts:L25-33`, `time: "s.started_at"`) étendue à `s.app_id, s.session_id` ; `occurrences = coalesce(sum(e.occurrences), 0)` de `rum_error e join commencees c on c.app_id = e.app_id and c.session_id = e.session_id` ; `sansSession = sum(e.occurrences)` des erreurs de `[from,to)` (datées par `e.ts`) pour lesquelles `sessionJoin` (`lib/query-compiler.ts:L227-228`) ne trouve aucune session. **Retiré** : `overviewStats.errors / overviewStats.sessions` (`lib/queries.ts:L124-141`), dont le numérateur inclut les erreurs sans session et se date par `e.ts` quand le dénominateur compte les sessions par `last_seen_at` | `KpiTile format="ratio"` (2 décimales, § 4.0) ; sous-texte « N occurrences sans session rattachée, exclues » si N > 0 | tuile → `/errors` | `sessions = 0` → `valeur: null`, `raisonNull` « aucune session commencée : taux non calculable » ; `engagementStats.still_active > 0` → sous-texte « peut encore augmenter : M sessions encore actives » ; erreur → `SectionErreur` | test d'intégration `tests/unit/queries-sessions.test.ts` sur la base de démo (même harnais que « Sessions commencées ») : S1 commencée dans la plage avec 3 occurrences, S2 commencée avant `from` avec 5 occurrences dans la plage, une erreur sans session à 2 occurrences → valeur 3,00 et sous-texte « 2 occurrences sans session rattachée » ; `sessions = 0` rend « — », jamais « 0 » |
| **Sessions avec frustration** | stat | sessions ayant ≥ 1 événement `frustration.*` / sessions commencées | aucune | **backend : manque** — à créer B30 `sessionsAvecSignaux(f): Promise<{frustration: number; rejeu: number; total: number}>` (§ 6.3) | `KpiTile format="pct"` | tuile → `/ux` | avant B30 : `valeur: null`, `raisonNull` « lecture à créer (B30) » (ce n'est pas « Non collecté » : les événements existent, la lecture manque) ; après B30, garde capteur R-F (§ 1.5) : population entièrement `runtime = 'react_native'` → `non_collecte` « Non collecté : le SDK mobile n'émet pas de signaux de frustration » ; population mixte → `partiel` « compté sur les sessions navigateur seulement (N sur M) », numérateur et dénominateur restreints aux sessions dont `runtime` n'est pas `react_native` (ou est `null`) ; les sessions de l'extension navigateur comptent (même bundle que le SDK, CP16) | avant B30 la tuile n'affiche aucun nombre |
| **Échantillonnage** (bandeau Z2b, S7) | bandeau, pas un graphique : il qualifie toutes les figures qu'il surmonte | probabilité d'inclusion minimale de la population : `min(case when has_error then sample_rate + (1 − sample_rate) × error_sample_rate else sample_rate end)` sur les sessions **commencées ou actives** dans `[from,to)` (union des deux populations de l'écran : le minimum de l'union borne chacune) ; `sansTaux` = sessions de cette union commencées avant le 09/09/2026 ; `biaiseErreurs` = au moins une session avec `sample_rate < 1` et `error_sample_rate > 0` | — | **à créer** B38 `samplingSessions(f: FiltersLike, opts?: { avecSpans?: boolean }): Promise<EchantillonnageSessions>`, `EchantillonnageSessions = { probaMin: number \| null; sessions: number; sansTaux: number; biaiseErreurs: boolean }` (deux `sql.where`, `time: "s.started_at"` et `time: "s.last_seen_at"`, combinés par `or` ; repli si le compilateur ne le permet pas : deux requêtes et `min` côté serveur) ; fonction pure `etatEchantillonnage(e: EchantillonnageSessions): Etat \| null` dans `lib/echantillonnage.ts` | `EtatSurface` (`kind: "echantillonne"`, `unite: "session"`) | aucune | `probaMin ≥ 1` et `sansTaux = 0` → rien n'est rendu ; `sansTaux > 0` → `probaMin: null` + phrase S7 ; `sessions = 0` → rien (l'état `vide` des figures suffit) ; lecture en échec → `partiel` « échantillonnage non lu : les comptes peuvent porter sur un échantillon », jamais le silence | unitaire `tests/unit/echantillonnage.test.ts` : `{probaMin: 0.5, sansTaux: 0}` → texte « au moins 50 % » ; `{probaMin: 1, sansTaux: 3}` → `probaMin: null`, « 3 sessions » ; `{probaMin: 1, sansTaux: 0}` → `null` ; e2e S7 |
| **À regarder d'abord** (hero) | liste classée, pas un graphique : on regarde des sessions, pas une forme ; chaque ligne porte **sa raison écrite** (ce que Datadog ne fait pas) | top 10 sessions actives de la fenêtre, ordre : `err_occurrences desc, frustration desc, api_echecs desc, last_seen_at desc` ; ligne = début, durée observée, appareil · navigateur, pays estimé (+ provenance), parcours (première → dernière route, « +N »), raison (« 3 occurrences de TypeError · 2 clics de rage sur « Payer » · 1 appel POST /api/panier en 500 »), ▶ rejeu | aucune | **à créer** B30 `sessionsAPrioriser(f: FiltersLike, limit = 10): Promise<SessionPrioritaire[]>` sur `sqlContext`, `time: "s.last_seen_at"` ; `SessionPrioritaire = SessionRow & { frustration: number; api_echecs: number; premiere_erreur_ts: string \| null; rejeu: boolean \| null; raison: { erreurs: {type: string; occurrences: number}[]; frustration: {kind: string; cible: string; n: number}[]; api: {methode: string; chemin: string; statut: number \| null}[] } }` | `components/sessions/PrioriteSessions.tsx` (**à créer**, props § 4.3) dans `Figure titre="À regarder d'abord"` | ligne → `panel=session:<id>` ; ▶ → `/sessions/<id>?tab=replay&at=<premiere_erreur_ts en ms>` ; ▶ absent si `rejeu=false`, « ▶ — » avec `title` « existence du rejeu non lue » si `null` | aucune session avec signal → une ligne « Aucune session avec erreur, frustration ou appel en échec sur <plage> » + lien « Voir toutes les sessions » (ancre Z6) ; avant B30 : `partiel` « classement indisponible : lecture à créer (B30) », et rien d'autre (trier les 50 lignes de `listSessions` produirait un faux classement de la fenêtre) | e2e : avec une session de démo portant 1 erreur, elle est première ; sa raison contient le type d'erreur ; ▶ ouvre `?tab=replay&at=` |
| **Qui sont ces sessions** | barres classées à onglets (`Breakdown`) : répartition catégorielle, barre = lien, « Inconnu » à part (Grafana bar chart ; Datadog facettes comptées `f001.png`) | sessions commencées, `count`, groupées par 1 dimension parmi Appareil / Navigateur / Système / Pays estimé / Capteur ; ≤ 12 groupes | aucune (part de l'ensemble écrite) | existante : `exploreAnalytics` plan `{dataset:"sessions", measure:{field:"started", aggregation:"count"}, groupBy:[dim], visualization:"toplist", limit:12}` ; onglet actif par `split` (`BREAKDOWN_PARAM`, `lib/breakdowns.ts:L35`) ; « Capteur » = dimension `source` (`console-donnees.md` L37) — onglet hors `BREAKDOWN_DIMENSIONS` (L31) : liste d'onglets propre aux sessions, § 4.1 `Breakdown` | `Breakdown` (tabs `device`, `browser`, `os`, `country` + `source`) | barre → page filtrée (`device=…`, `browser=…`, `seg=v2:source:eq:extension`, « Inconnu » → `seg=v2:<dim>:is_null`) | tronqué → « N groupes, 12 affichés » ; pays : notice `BREAKDOWN_NOTICES.country` (provenance) | e2e : clic « Inconnu » ajoute `seg=v2:browser:is_null` |
| **Volume — sessions commencées par seau** | barres (Datadog : « bars recommended for counts ») ; additif, donc empilable dans le temps | `count(*)` par seau `bucketSecondsFor` ; annotations de déploiement | `cmp=prev` : série grise pointillée alignée par rang de seau | existante : `observedVisitorsTrend(f)[].sessions` ; annotations `listDeploys(f, 20)` (`lib/queries-deploys.ts:L20`, preset seulement tant que B1 manque) | `ThresholdSeries` avec `SerieDef.forme="barres"` (§ 4.2), `additive: true` | clic seau → `from`/`to` du seau (zoom) : la liste Z6 et les KPI se resserrent ; annotation → `cmp=release` | seau de bord partiel creux ; 0 = barre nulle (vrai zéro) | e2e : clic sur un seau écrit `from`/`to` et retire `period` |
| **Volume — visiteurs distincts par seau** | points reliés, **panneau séparé** (P5) : population différente, non additive | `count(distinct visitor_id)` par seau | aucune (une période précédente de distincts invite à sommer) | existante : `observedVisitorsTrend(f)[].visitors` | `ThresholdSeries` (ligne) sous la précédente, même axe x | idem zoom | méta : « Ces valeurs ne s'additionnent pas : un visiteur présent dans trois seaux y est compté trois fois » (texte conservé, `app/sessions/page.tsx:L182-194`) | alternative textuelle : une ligne par seau avec les deux mesures en colonnes séparées |
| **Engagement** | trois stats (p50, p75, part à une vue) : deux percentiles et un taux, pas de moyenne (P7) ; `EtenduePercentiles` (§ 4.2) non retenu ici : `engagementStats` ne sert pas de p95 (`lib/queries-sessions.ts:L38-41`) | durée observée `last_seen_at − started_at` p50 / p75 (sessions commencées, `page_count ≥ 1`) ; part à une vue = `single_view / with_view` ; « encore actives » (30 min) | `cmp=prev` après `engagementStats(f, shift)` | existante : `engagementStats(f)` ; `singleViewSessionRate`, `partActive`, `engagementSuffisant` (`lib/engagement.ts:L50-67`) | 3 `KpiTile` dans `Figure titre="Engagement"` ; `lecture` = définitions de `lib/engagement.ts:L5-13` | aucune | `< 30` sessions → `partiel` « N sessions avec au moins une page vue : il en faut 30 » (texte conservé, **vouvoyé**) ; erreur → `SectionErreur` (fin du `softFail`, L45-47) | base coupée → « La lecture de Engagement a échoué » + « Réessayer », jamais « 0 session » |
| **Nouveaux, revenants, non identifiés — sessions actives** | anneau à **trois** parts, la part inconnue nommée (`console-donnees.md` L121) ; parts d'un tout, peu de catégories (Grafana pie) | sessions actives (dernière activité) : identifiées nouvelles / identifiées revenantes / non identifiées | aucune | existante : `visitStats(f)` → `new_count`, `returning_count`, `unidentified_count` (`lib/queries.ts:L597-642`) ; **attention** : ces trois comptes portent sur `last_seen_at` (L599-600) quand `visitStats.sessions` porte sur les vues : la figure n'affiche **pas** `visitStats.sessions` | `Donut` (part `inconnu` nommée, F03) | tranche → aucune (pas de dimension « revenant ») | toutes à 0 → `vide` | méta contient « sessions actives (dernière activité dans la fenêtre) » et « revenant = session antérieure du même visiteur dans les données conservées (30 jours, `RETENTION_DAYS`) » (`lib/queries.ts:L626-633` : au-delà, un revenant est compté nouveau) ; la somme des trois parts est affichée comme « N sessions actives » |
| **Toutes les sessions** | table dense (Grafana table ; Datadog Sessions list) : 50 lignes lisibles sur un écran au lieu de 28 cartes sur 2 600 px (`console-ecrans-2.md` L221) | colonnes : Dernière activité · Début · Durée observée · Appareil · Navigateur · Système · Pays estimé (provenance en `title` + sr-only) · Capteur · Pages vues · Parcours (1ʳᵉ → dernière route, « +N ») · Occurrences d'erreur · Frustration · Rejeu ; tri fixe `(last_seen_at, session_id) desc` | aucune | existante : `listSessions(f, {limit: 51, cursor, search})` (`lib/queries.ts:L363-389`) — `s.*` renvoie `browser`, `os`, `release`, `sample_rate` (colonnes v75 / v53 / v58, `console-donnees.md` L111-114) : **typage à ajouter** à `SessionRow` ; Frustration et Rejeu : **à créer** B30 `signauxDeSessions(appIds: string[], sessionIds: string[]): Promise<Map<string, {frustration: number; rejeu: boolean}>>` | **à créer** `components/sessions/SessionsTable.tsx` (props § 4.3) | ligne → `panel=session:<id>` ; id → `/sessions/<id>` ; route du parcours → `breakdownDrillHref` (conservé) ; « Suivant » → curseur (conservé) | recherche refusée → `role="alert"` (conservé) ; vide → « Aucune session sur <plage> » ; Frustration/Rejeu avant B30 → « — » avec `title` « lecture à créer » | e2e : 51ᵉ ligne jamais affichée, bouton « Suivant » présent ; aucune colonne ne montre un `visitor_id` |
| **Filtres rapides de la liste** | bascules `Chip` : « Avec erreurs » · « Avec frustration » · « Avec rejeu » | restreignent **la liste seule** (pas les KPI) ; le dire au-dessus de la table | — | **à créer** : option `avec?: "erreurs" \| "frustration" \| "rejeu"` de `listSessions` (B30) | `Chip` exporté de `GlobalFilters` (F06) ; paramètre d'écran `avec` (§ 3.1) | bascule → `?avec=erreurs` (hors `CONTRACT_PARAMS`) | avant B30 : chips désactivées avec raison | e2e : `avec=erreurs` ne change pas la tuile « Sessions commencées » |
| **Recherche exacte** | formulaire GET (conservé) | identifiant exact, route normalisée, release | — | existante : `lib/sessions-search.ts` | inchangé ; `INPUT_CLASS`, `btn-accent` | — | texte « aucune recherche par identité, par décision » conservé | inchangé |
| **Panneau session** | panneau latéral (§ 3.5) : qualifier sans quitter la liste (Datadog panneau, `f003.png`) | puces : appareil, navigateur, système, pays estimé + provenance, capteur, release à l'ouverture ; 4 `KpiTile` (durée observée, pages vues, occurrences d'erreur, signaux de frustration) ; mini-`Cascade` de la session ; 15 premiers événements groupés par vue | — | existantes : `sessionMeta(id)` (`lib/queries.ts:L413-416`), `sessionTimeline(id)` (L441-566) ; périmètre : même garde que la page (`app/sessions/[id]/page.tsx:L30-40`) | `PanneauSession` (§ 4.3) : `DetailPanel type="session"` + `Cascade` (hauteur réduite) ; tuile « signaux de frustration » soumise à la garde capteur de § 1.5 R-F | « Ouvrir en page » → `/sessions/<id>` ; « Rejeu » → `?tab=replay` ; ↑/↓ = session précédente / suivante de la page de liste | session hors périmètre → le panneau ne s'ouvre pas, ligne « session introuvable ou hors périmètre » | e2e clavier : Échap ferme, focus sur le titre à l'ouverture |

#### 5.11.5 Conservé, et pourquoi

- Identifiés / non identifiés comptés à part, « ne s'additionnent pas », seuil de 30 sessions,
  définitions « durée observée » et « session à une vue » (`lib/engagement.ts:L3-18`) : plus honnête que
  « Average session duration » et « bounce rate » de Datadog (`newoptimizeperformanceimage.png`).
- Recherche exacte à trois champs, pagination par curseur (`lib/sessions-search.ts`).
- Pays estimé avec provenance ; bots exclus ; release lue sur l'occurrence (`app/sessions/page.tsx:L307`).
- Composition par cookie `mip-blocs-sessions` (`lib/dashboard-blocs.ts:L77-111`), avec deux blocs
  ajoutés : `priorite` (« À regarder d'abord », défaut actif) et `repartition` (« Qui sont ces sessions »,
  défaut actif). Les deux « indisponibles » motivés restent (identité, démasquage sélectif).

#### 5.11.6 Disparaît, et pourquoi

- **Les cartes de session** empilées : remplacées par une table (390 px : cartes compactes de 3 lignes).
- **`ObservedTrend` sans axe** (`components/charts/ObservedTrend.tsx:L31-40`) : remplacé par deux
  `ThresholdSeries` avec axe daté et zoom.
- **Le hero « Sessions actives / Visites / Part de revenants »** : « Visites » (découpage à 30 min) mêle
  une troisième population sans question associée ; la valeur reste accessible dans l'Explorer. La part
  de revenants passe dans l'anneau à trois parts.
- **Écart assumé (une liste « triable, défaut erreurs + frustration » était envisagée)** : la liste garde
  l'ordre chronologique, parce qu'un tri par signaux exige une pagination par décalage (instable quand
  des sessions arrivent) ; la priorité est portée par le hero, borné à 10 lignes et dit comme tel.

### 5.12 Détail de session et rejeu `/sessions/[id]`

#### 5.12.1 Question et suite

- **Question** : « Que s'est-il passé dans cette session, dans quel ordre, et qu'a vu le visiteur ? »
- **Réponse en dix secondes** : la bande « Résumé » (5 tuiles) et, à 1440 px, le rejeu calé sur la
  première erreur avec la chronologie synchronisée à sa droite.
- **Question suivante** : « Cette erreur touche-t-elle d'autres sessions ? » → `/errors/<fingerprint>` ;
  « l'appel lent vient-il du back ? » → `/tracing/<traceId>` ; « cette page est-elle lente pour tous ? »
  → `/pages?route=<route>`.

#### 5.12.2 Référence retenue

**Datadog** Session Replay + Event Timeline (`f006.png` à `f014.png` : lecteur ⅔, chronologie ⅓, ligne
surlignée synchronisée, filtres View / Action / Error, erreur indentée sous le clic, puces de contexte)
et onglets comptés du panneau VIEW (`datadog-docs-errors-replay-frustration.md` L247). **Nôtre,
conservé** : identité aléatoire dite, pays avec provenance, masquage et TTL écrits dans le lecteur,
« indisponible à cet instant », causalité action → effets, temps serveur corrélé sur la ligne d'un appel
API (`console-ecrans-2.md` L262-269). Datadog affiche le nom de l'utilisatrice et un rejeu non masqué
(`f006.png`) : nous ne le reprenons pas.

#### 5.12.3 Grille

| # | Zone | 1440 px (≥ 1280) | 768 px | 390 px |
|---|---|---|---|---|
| Y1 | « ← Sessions » (filtres conservés) + titre `Session 5c8bd251…` + puces de contexte | une ligne de puces | 2 lignes | puces en liste repliable « Contexte (7) » |
| Y2 | Résumé : 5 `KpiTile` | 5 colonnes | 3 + 2 | 2 colonnes |
| Y3 | Onglets comptés : Déroulé · Cascade · Erreurs (n) · Appels API (n) · Web Vitals (n) · Attributs — `TabLink` existant étendu d'une prop `compte?: number \| null` (`null` → « (—) », même règle que `DetailPanel.onglets`) | barre | barre défilante avec indicateur | idem |
| Y4 (onglet Déroulé, défaut) | Rejeu (60 %) + chronologie synchronisée (40 %, hauteur = lecteur, défilement interne) | côte à côte | **empilés** : rejeu puis chronologie | empilés ; le rejeu est replié derrière « Lancer le rejeu (N s enregistrées) » pour ne pas charger rrweb sur mobile sans geste |
| Y4 (onglet Cascade) | `Cascade` de la session, pleine largeur | — | défilement horizontal interne | idem |
| Y4 (autres onglets) | tables | — | — | cartes |

**Au-dessus du pli à 1440 × 900** : Y1, Y2, Y3 et le haut du lecteur + 8 lignes de chronologie.

Rupture avec l'existant : `?tab=` accepte `deroule` (défaut), `cascade`, `erreurs`, `api`, `vitals`,
`attributs` ; **`tab=replay` et `tab=timeline` restent acceptés** (liens existants depuis
`components/errors/error-view.ts:L90`) et sont lus comme `deroule`, avec `at` conservé.

#### 5.12.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Puces de contexte** | puces (Datadog `f006.png`) : qui / sur quoi / où, en une ligne | App · Appareil · Navigateur (+ version) · Système (+ version) · Pays estimé + provenance · Capteur (SDK / extension) · Release à l'ouverture · Visiteur (aléatoire, 8 car.) · Échantillonnage (« session retenue avec probabilité p ») | — | existante : `sessionMeta(id)` = `select *` (`lib/queries.ts:L413-416`) ; colonnes `browser`, `browser_version`, `os`, `os_version`, `release`, `sample_rate` présentes en base (v75, v53, v58 : `console-donnees.md` L111-114) mais **non typées** dans `SessionMeta` (L391-410) : typage à ajouter | `DetailPanel`-like en-tête : **réutiliser les puces** de `DetailPanel.puces` (`{label, valeur, provenance?}`) dans un en-tête de page | Pays → aucune ; Release → `/errors?release=<v>` | colonne `NULL` → « Inconnu » ; `sample_rate` est `not null default 1` (`migration-v58.sql:L65`) : session commencée avant le 09/09/2026 → « probabilité d'inclusion non enregistrée », jamais « 100 % » ; sinon « retenue avec probabilité p », p = `sample_rate` sans erreur, `sample_rate + (1 − sample_rate) × error_sample_rate` si `has_error` | e2e : la puce Pays contient la provenance en texte sr-only |
| **Durée observée** | stat : dit ce que la durée est, et si elle peut encore bouger | `last_seen_at − started_at` ; « encore active » si `last_seen_at ≥ now − 30 min` | position : « plus longue que X % des sessions commencées le même jour » — **non retenu** (pas de distribution servie ; ce serait une lecture de plus pour une phrase) | existante : `sessionMeta` ; seuil `STILL_ACTIVE_MINUTES` (`lib/engagement.ts:L24`) | `KpiTile format="s-auto"` + `lecture` « écart entre la première et la dernière observation, pas du temps actif » | — | « encore active » en badge | la tuile ne dit jamais « temps passé » |
| **Pages vues** | stat | `page_count` | — | `sessionMeta.page_count` | `KpiTile format="count"` | → onglet Déroulé filtré `voir=pageview` | — | — |
| **Occurrences d'erreur** | stat | `sum(occurrences)` des erreurs de la session (V1) | — | **à créer** : `sessionTimeline` ne sélectionne pas `occurrences` (ligne `error` : `value = null`, `lib/queries.ts:L462`) → B32 : renvoyer `occurrences` dans `value` pour `kind='error'` | `KpiTile format="count"` | → onglet Erreurs | avant B32 : libellé « Erreurs (lignes) » et `lecture` « une ligne peut regrouper plusieurs répétitions » | test : une erreur `occurrences=3` compte 3 après B32 |
| **Signaux de frustration** | stat | nombre d'événements `frustration.*` de la session (rage, dead, error) | — | existante : lignes `kind='event'` dont `title` commence par `frustration.` dans `sessionTimeline` (`lib/queries.ts:L481-482` ; nom réservé, `packages/rum-sdk/src/frustration.ts:L7`) — comptage côté page | `KpiTile format="count"` + `lecture` règles : 3 clics / 1 s, 1 500 ms sans réaction, erreur pendant l'action (`frustration.ts:L12-15`) | → Déroulé `voir=frustration` | garde capteur R-F (§ 1.5) : session `runtime = 'react_native'` → `valeur: null`, `raisonNull` « Non collecté : le SDK mobile n'émet pas de signaux de frustration » ; session navigateur (SDK ou extension, même bundle, CP16) : 0 → « 0 » ; un SDK configuré `frustration: false` envoie 0 sans que la console le sache : dit dans `lecture` | tuile présente même à 0 pour une session navigateur ; jamais « 0 » pour une session React Native |
| **Appels API en échec** | stat | appels `tier='front'` avec statut ≥ 400 ou 0 | — | existante : `sessionTimeline` → `kind='api'`, `rating='poor'` (`lib/queries.ts:L487-490`) | `KpiTile format="count"` | → onglet Appels API | — | le statut 0 est dit « réseau (statut 0) », pas « 500 » |
| **Rejeu** | lecteur rrweb (conservé) + barre de progression porteuse de marqueurs (Datadog `f006.png`), vitesse 1× / 2× / 4×, « Sauter l'inactivité » | événements rrweb de la session | — | existante : `GET /api/replay/[sessionId]` (`app/api/replay/[sessionId]/route.ts:L38-53`) ; `ReplayPlayer` (`components/replay/ReplayPlayer.tsx`) ; **à créer** B36 : la route renvoie `ignores: number` (chunks illisibles, aujourd'hui avalés L49-51) | `ReplayPlayer` étendu : props `{ sessionId; atMs; marqueurs: {t: number; ton: "erreur"\|"frustration"\|"vue"\|"action"; libelle: string}[]; onTemps?: (ms) => void }` → **îlot `ReplaySynchro`** (§ 4.3) | clic marqueur → saute à l'instant ; `?at=` conservé | en-tête du lecteur **toujours** : « Saisies, texte et médias masqués à l'enregistrement · conservé 30 jours · enregistrement limité aux 2 premières minutes ou 1 Mo compressé » (`replay.ts:L9-10`) ; vide → explication conservée (`ReplayPlayer.tsx:L116-132`) ; erreur → texte + **« Réessayer »** (manque aujourd'hui, L133-137) ; `ignores > 0` → `partiel` « N segments illisibles ignorés » | e2e : `?tab=replay&at=<ms>` positionne et affiche « Replay positionné à l'instant de l'erreur » |
| **Chronologie** (colonne droite du Déroulé) | liste groupée **par vue** (Datadog Event Timeline) : une section par page vue (route, `nav_type`, décalage), dessous ses actions, et sous chaque action ses effets indentés (`action_id`), erreurs en rouge, appels API avec statut + temps serveur ; vitals Web en **pastilles** sur la ligne de la vue ; phases réseau repliées en une ligne « Phases réseau (8) » | événements de la session, triés `ts`, actions d'abord au même instant | — | existante : `sessionTimeline(id)` (`lib/queries.ts:L441-566`) ; phases vs vitals : `CORE_VITALS` (`lib/rating.ts:L32`) ; **à créer** B32 : ajouter `fingerprint` (erreur) et `trace_id` (appel API) aux lignes pour les liens sortants | **à créer** `components/sessions/Deroule.tsx` (SSR, props § 4.3) ; lignes rendues par `TimelineRow` (conservé) | survol (clavier : focus) d'une ligne → le lecteur se place à l'instant (îlot) ; ligne surlignée = tête de lecture ; erreur → `/errors/<fingerprint>` (après B32) ; appel API → `/tracing/<traceId>` (après B32) ; route → `/pages?route=<route>` ; filtres `voir=` (vue, action, erreur, api, frustration, ressource, tâche longue, événement métier) | 500 lignes atteintes → `partiel` « chronologie tronquée à 500 événements » ; vide → texte conservé | unitaire : `grouperParVue(items)` place un vital `LCP` sur la vue de même route la plus proche avant lui, et les 8 phases réseau dans « Phases réseau » ; e2e : la capture 12 refaite ne montre plus de ligne « Vital RTT » |
| **Cascade de la session** (onglet) | cascade horizontale (Datadog Waterfall, `datadog-video-rum-db-new.md` M11) : l'ordre et la durée se lisent sur un axe, la colonne `+N ms` ne le permet pas | pistes : Pages vues (barre de la vue à la vue suivante, libellée « jusqu'à la vue suivante », pas « durée de vue » : `analytics-schema.ts:L322` refuse le temps passé) · Actions (marqueurs) · Appels API (barres, durée front, ton = statut) · Ressources liées (barres) · Tâches longues (barres) · Erreurs (marqueurs) ; marqueurs FCP / LCP par vue | — | existante : `sessionTimeline` (mêmes lignes) | `Cascade` (F07) avec `partiel="ressources rattachées à une action seulement (lib/queries.ts:L469), ≥ 300 ms, 20 par vue"` | clic élément → même lien que la chronologie ; aucun paramètre de sélection (le focus clavier suffit) | < 2 éléments → `vide` | alternative : table (libellé, début, durée, piste) |
| **Erreurs (n)** (onglet) | table | type, message (tronqué, complet en `title`), route, occurrences, action déclenchante, instant | — | `sessionTimeline` (lignes `error`) | table SSR | ligne → `/errors/<fingerprint>` ; « Voir au rejeu » → `?tab=deroule&at=<ms>` | 0 → « Aucune erreur dans cette session » | — |
| **Appels API (n)** (onglet) | table | méthode + chemin, statut, durée front, temps serveur corrélé, action | — | `sessionTimeline` (lignes `api`) | table SSR | → `/tracing/<traceId>` | « serveur — » si pas de jumeau back : « aucun span serveur corrélé » | — |
| **Web Vitals de la session** (onglet) | une tuile par vital (pire vue) + une ligne par vue ; **position de la valeur dans la distribution de la même route**, sur une fenêtre **ancrée sur la session** et non sur l'instant de lecture | valeur de la vue ; histogramme des mesures du même vital et de la même route sur `[started_at − 7 j, min(started_at + 1 j, now))` (UTC), toutes sessions | population nommée en méta : « mesures LCP de /partners du 03/09 au 11/09 (UTC), toutes sessions, celle-ci comprise si elle a duré moins de 24 h » | existantes : `sessionTimeline` (vitals) ; `vitalHistogram(f, name, cap, 20)` (`lib/queries.ts:L96-114`) et `vitalPercentiles(f)` (L75-87) avec `f` construit par `parseAnalyticsQuery(paramReader({app, from, to, route}), {principal, nowMs})` → `filtersOfQuery` (`lib/query-contract.ts:L491, L572` ; `lib/filters.ts:L111`) ; plage personnalisée de 8 j (≤ 30 j, `RANGE_MAX_MS`, `lib/query-contract.ts:L25`) ; `to` borné à `nowMs`, sinon refus `range_in_future` (L284) ; **à créer** fonction pure `fenetreDeSession(startedAtMs: number, nowMs: number): { from: string; to: string }` dans `lib/deroule.ts` | `KpiTile vital=…` + `DistributionSeuils valeurMarquee={{valeur, libelle:"cette vue"}}` | tuile → `/pages?route=<route>&vital=<v>&from=<from>&to=<to>` (même fenêtre, lien reproductible) | `from` antérieur à `now − RETENTION_DAYS` (`lib/queries-explorer.ts:L87`) → `partiel` « mesures conservées depuis le JJ/MM seulement » ; n = 0 → « aucune mesure de cette route entre le JJ/MM et le JJ/MM » ; refus du contrat → `partiel` avec le code du refus | unitaire `tests/unit/deroule.test.ts` : session commencée il y a 20 j → fenêtre de J−27 à J−19 ; session commencée il y a 2 h → `to = now` ; e2e : la méta contient les deux dates ; seuils de `rating.ts` seulement ; écart au § 3.5 déclaré (fenêtre ancrée sur la session, § 3.5) |
| **Attributs** (onglet) | liste clé / valeur repliée | colonnes non identifiantes de `rum_session` : `session_id`, `app_id`, `collection_source`, `runtime`, `sample_rate`, `error_sample_rate`, `geo_db_version`, user-agent | — | `sessionMeta` | `<dl>` SSR | — | colonnes identifiantes exclues : `visitor_id` tronqué, `user_hash`, `user_id_hash`, `account_id_hash` jamais affichés | e2e : le HTML ne contient pas `user_id_hash` |

#### 5.12.5 Conservé, et pourquoi

Garde de périmètre et refus d'une app qui ne correspond pas (`app/sessions/[id]/page.tsx:L30-40`) ;
`at` validé, jamais deviné (L43) ; « Visiteur (aléatoire) » et « Classe d'appareil (héritée) … n'identifie
pas une personne » ; badge causal « ↳ action » (`Timeline.tsx:L29-33`) ; temps serveur corrélé sur la
ligne d'un appel API ; messages vides du lecteur ; `TabLink` (lien, `aria-current`).

#### 5.12.6 Disparaît, et pourquoi

- Les huit cartes `Meta` en grille (`page.tsx:L81-111`) : remplacées par des puces (même information,
  une ligne, plus la version, le système, la release et l'échantillonnage).
- La ligne de badges de compte non cliquables (L113-125) : les comptes vivent dans les onglets.
- Les onglets exclusifs Timeline | Replay à ≥ 1280 px : juxtaposés (Datadog `f006.png`) ; les onglets
  restent sous 1280 px.
- L'étiquette « Vital » sur les phases réseau.

### 5.13 Parcours `/paths`

#### 5.13.1 Question et suite

- **Question** : « Par où passent les visiteurs, où entrent-ils, où sortent-ils, et où décrochent-ils
  dans un parcours donné ? »
- **Réponse en dix secondes** : le Sankey des transitions avec la couverture écrite, et l'entonnoir
  construit (s'il y en a un) avec sa pire marche mise en évidence.
- **Question suivante** : « Quelles sessions sont sorties sur cette page ? » →
  `/sessions?qf=route&q=<route>` ; « cette page de sortie est-elle lente ? » → `/pages?route=<route>`.

#### 5.13.2 Référence retenue

**Datadog** Pathways + Funnels (règles écrites : vue revisitée une fois, épaisseur = sessions, ancrage
avant / après une vue ; conversion par étape et depuis le départ, ordre respecté, intercalations
ignorées ; `datadog-docs-product-analytics-mobile.md` L75-142) ; la vidéo Datadog montre le défaut à
éviter : deux conventions de pourcentage sur la même barre sans étiquette (`reads/datadog-video-newfast…md`
L57, L140). **Nôtre, conservé** : boucles exclues et dites, couverture du Sankey annoncée, noms d'étapes
liés (`console-ecrans-2.md` L397-401).

#### 5.13.3 Grille

| # | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| P1 | En-tête + filtres + note « lecture non migrée » | — | — | — |
| P2 | KPI : 3 `KpiTile` | 3 col. | 3 col. | 1 col. |
| P2b | Bandeau d'échantillonnage (S7) | pleine largeur | idem | idem |
| P3 | Hero « Flux entre routes » (Sankey) + sélecteur d'ancrage « À partir de : [route] » | pleine largeur | défilement horizontal interne (560 px min) | idem + table alternative dépliée par défaut |
| P4 | « Pages d'entrée » et « Pages de sortie » (tables miroir) | 2 × 6 col. | empilées | empilées |
| P5 | « Entonnoir » : sélecteur d'étapes + graphe | pleine largeur | idem | étapes en liste verticale |

#### 5.13.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Page d'entrée n°1** | stat | route la plus fréquente en 1ʳᵉ vue, **part de toutes les sessions avec vue** | — | existante : `entryExitRoutes(f, 15).entries[0]` (`lib/queries-paths.ts:L52-61`) ; dénominateur : `sessionsAvecVue(f)` **sur le contrat**, fonction unique livrée par F10 (§ 4.5), utilisable ici **après B31 seulement** (S2 interdit de diviser une lecture historique par une lecture du contrat) — aujourd'hui les parts sont calculées sur le top 15 (`app/paths/page.tsx:L164`, faux dès 16 routes) | `KpiLibelle` (§ 4.2 ; `KpiTile.valeur` est numérique) : texte « /partners · 28 sessions sur 28 » | → `/pages?route=` | avant B31 : part non affichée, « part de l'ensemble non calculée (dénominateur à créer) » | aucune part calculée sur un top N |
| **Page de sortie n°1** | stat | idem, dernière vue | — | `entryExitRoutes(f).exits[0]` | idem | idem | idem | idem |
| **Transitions distinctes** | stat | nombre de paires (from, to) renvoyées (≤ 50) | — | `routeTransitions(f, 50).length` (L23-44) | `KpiTile` ; « 50 ou plus » à 50 | — | 0 → « 0 » | — |
| **Échantillonnage** (bandeau P2b, S7) | bandeau (voir § 5.11.4) | même calcul que § 5.11.4, sur la population de l'écran : sessions dont les vues sont lues par `routeTransitions` / `entryExitRoutes` | — | avant B31 : **à créer** B38 `samplingSessionsHistorique(f: Filters, fenetre: { jours: number } \| { semaines: number }): Promise<EchantillonnageSessions>`, mêmes prédicats `now() - interval` et même filtre d'app que la lecture qu'il qualifie (S2) ; après B31 : `samplingSessions(f)` | `EtatSurface kind="echantillonne"` sous P2 | aucune | idem § 5.11.4 | e2e S7 sur `/paths` |
| **Flux entre routes** (hero) | Sankey à deux colonnes « depuis » → « vers » (conservé) : c'est la seule forme qui montre à la fois volume et direction ; **améliorations** : total écrit sur chaque nœud, hauteur proportionnelle au nombre de nœuds (120 px + 36 px/nœud, plafond 380), couleurs neutres (nœuds `ink-soft`, rubans `SERIE.principale` à 30 %) au lieu du hachage (`Sankey.tsx:L16-21`) | transitions route → route hors boucles A→A, top 50, 8 nœuds par côté | aucune | existantes : `routeTransitions(f, 50)`, `buildSankey` (`lib/sankey.ts:L40-111`) ; ancrage « à partir de » : **à créer** B31 `routeTransitions(f, limit, {depuis?: string})` (filtre `route = $depuis` lié) | `Sankey` modifié : props `{ model: SankeyModel; ancre?: string \| null; hauteur?: number }` | ruban → `/sessions?qf=route&q=<to>` ; nœud gauche → ancrer `?depuis=<route>` (§ 3.1) ; nœud → « Ouvrir /pages » en `title` et dans l'alternative | couverture `shownFlow / totalFlow` conservée en méta ; < 2 liens → « Pas assez de transitions pour un flux » (conservé) | alternative = table De / Vers / Sessions (remplace la carte « Transitions les plus fréquentes », doublon) |
| **Pages d'entrée** / **Pages de sortie** | deux tables **miroir** aux colonnes identiques (Datadog first / last visited page, `datadog-images-2.md` L218-219) : Route · Sessions · Part de toutes les sessions · Sessions à une vue (entrée seulement) · LCP p75 de la route | top 15 par côté | aucune | existante : `entryExitRoutes(f, 15)` ; « Sessions à une vue » et LCP : **non retenus avant B31** (mélangerait lecture historique et contrat, S2) | table SSR `<th scope>` avec barre de part | route → `/sessions?qf=route&q=<route>` ; lien secondaire `/pages?route=` | part `null` avant B31 (voir KPI) | les deux tables ont les mêmes colonnes et le même ordre |
| **Entonnoir** — sélecteur | formulaire GET (conservé) ; options annotées « nom (N sessions) » | événements custom de la fenêtre, top 50 | — | existante : `availableEvents(f, 50)` (`lib/queries-funnel.ts:L22-39`) → `n`, `sessions` (non affichés aujourd'hui, `console-ecrans-2.md` L414) ; étapes de type **vue** ou **action** : backend manque, B33 (`console-donnees.md` L272) | `StepPicker` (props inchangées + `options` annotées) | paramètres `s1..s4` existants | aucun événement → phrase `MIPRum.track("nom")` conservée | l'option affiche le nombre de sessions |
| **Entonnoir** — graphe | barres horizontales par étape, deux nombres **nommés** par étape : « 67 % de l'étape précédente » et « 22 % du départ », abandon en nombre ; la marche la plus perdante encadrée « plus forte perte » | sessions ayant réalisé les étapes 1..k dans l'ordre (première occurrence), fenêtre de conversion = la session | aucune ; `cmp=prev` après B31 | existante : `funnelReport(f, steps)` (`lib/queries-funnel.ts:L46-78`) → `computeFunnel` ; **corriger** `convFromStart = 0` sans départ → `null` (`lib/funnel.ts:L55`) | `FunnelChart` étendu : colonnes `convFromPrev` (calculé, jamais rendu : `console-ecrans-2.md` L415) + alternative textuelle ; abandon en jeton `bad`, plus `red-600` | étape → `/sessions?qf=…` **non** : aucune recherche par événement ; lien « Voir au Journal » → `/events?name=<étape>`, rendu seulement après le lot performance F25 qui crée ce filtre | étape 1 à 0 → note conservée (L144-148) | test : départ 0 → pourcentages « — » ; e2e : les deux libellés de taux sont visibles |

#### 5.13.5 Conservé / disparaît

Conservé : exclusion des boucles et son titre, couverture du Sankey, ordre temporel de l'entonnoir, rendu
SSR sans JavaScript. Disparaît : la table « Transitions les plus fréquentes » en carte séparée (devient
l'alternative du Sankey) ; les `BoundaryCard` à parts calculées sur le top 15 ; les couleurs par hachage.

### 5.14 Conversions — `/goals` (libellé « Conversions », catégorie Usages)

#### 5.14.0 Périmètre d'apps : défaut constaté et correction

- **Constat (lu dans le code, non rejoué).** `listGoals`, `windowSessions` et `goalHits` filtrent par
  `($1::text is null or app_id = $1)` avec `f.app` (`lib/queries-goals.ts:20, 35, 60`). La page lit
  `f = ecran.filters` (`app/goals/page.tsx:22`), construit par `filtersOfQuery`, qui prend
  `app: query.scope.requestedApp` (`lib/filters.ts:110-113`). Sous `app=all`, `requestedApp` vaut
  `null` (`query-contract.ts:197`) : la clause n'exclut plus rien, et `effectiveApps` (les apps du
  principal) n'est lu nulle part. `q()` n'active pas les policies RLS : `withTenant` n'est pas
  appelé, et il est sans effet sous un rôle `BYPASSRLS` (`lib/db.ts`, commentaire de `withTenant`).
  Un viewer restreint à l'app A lit donc, sous `app=all`, les objectifs, conversions et sessions de
  toutes les apps (V7). C'est le même défaut que CS1 (§ 1.6).
- **Correction provisoire (avant F66).** Le refus de F40 (écrans d'usage : « Cet écran lit une
  application à la fois » quand `requestedApp === null && authorizedApps !== null` sur une surface
  `legacy`) s'applique à `/goals`, qui est `legacy: "segments"` (`surfaces.ts:121`). `/goals`
  figure dans la liste du test e2e de F40 (`tests/e2e/usages-perimetre.spec.ts`).
- **Correction définitive (F66).** Toute lecture de `/goals` passe par `sqlContext(f)` (cible
  compilée avec `effectiveApps`, `lib/query-sql.ts:27-31`) ; `listGoals` prend le périmètre, pas une
  app (voir ci-dessous). `/goals` quitte `legacy` et passe en `range: "custom"` (le `where` compilé
  applique `[from, to)` de la requête). F00 ne pose pas de `rangeNote` sur `/goals` (la plage personnalisée y est refusée, pas ignorée : F00 point 9) ; F66 n'en pose pas non plus, la plage s'appliquant alors.

#### 5.14.1 Question, référence

- **Question** : « Quelle part des sessions atteint chaque objectif de conversion, et avec quelle
  incertitude ? »
- **Question suivante** : « Pour quel appareil convertit-on moins ? » (G4), puis les sessions de la
  population via `/sessions?device=…`. Il n'existe pas de lien « sessions converties » : le contrat
  n'a pas de dimension « objectif » (11 dimensions, `query-contract.ts:31-48`) et l'écran le dit.
- **Référence** : **nôtre, conservé**. Les objectifs sont indépendants, pas des étapes d'entonnoir, et
  partagent un même dénominateur (`console-ecrans-3.md` L91-94). Datadog Funnel sert de contre-exemple
  à ne pas copier : « time to convert » en moyenne (`datadog-docs-product-analytics-mobile.md` § 8.3).

#### 5.14.2 Grille

1 `PageHeader` (domain « Usages ») → 2 KPI (3 tuiles) → 3 hero « Taux de conversion par objectif »
(**au-dessus du pli**) → 4 « Par appareil » → 5 table « Objectifs » → 6 gestion (admin). 390 : une
colonne.

#### 5.14.3 Lectures (F66)

```ts
// lib/queries-goals.ts — réécrit sur le contrat. Aucune clause `$1::text is null or app_id = $1`.
export async function listGoals(apps: string[] | null): Promise<GoalDef[]>;
//   where ($1::text[] is null or app_id = any($1)) ; apps = query.scope.effectiveApps ;
//   apps = [] → aucune ligne (any('{}') est faux) ; null = principal sans restriction.
export async function goalConversions(f: FiltersLike): Promise<{
  total: number;                                // sessions distinctes ayant ≥ 1 vue sur [from,to)
  rows: (GoalConversion & { derniere: Date | null })[];
}>;
//   UNE requête : dénominateur = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at" }) ;
//   numérateurs = count(distinct session_id) filter (where …) par objectif, via une jointure latérale
//   sur `goal` (motif lié en paramètre, jamais interpolé : commentaire queries-goals.ts:3-5 conservé) ;
//   événements : sql.where({ dataset: "events", row: "ev", session: "s", time: "ev.ts" }) ;
//   `goal.app_id = <app de la ligne>` : un objectif de l'app A ne compte que des sessions de A.
export async function goalConversionsByDevice(f: FiltersLike): Promise<{
  goal_id: number; device: string | null; conversions: number; sessions: number;
}[]>;
//   même construction, `group by goal.id, s.device_type` ; dénominateur par appareil.
```

Le motif N+1 actuel (`queries-goals.ts:75-78`, une requête par objectif, en série) disparaît.

#### 5.14.4 Widgets

| # | Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| G1 | KPI « Sessions de la fenêtre (dénominateur) » | Stat : le dénominateur est nommé (P4, V3) | sessions distinctes ayant vu ≥ 1 page sur `[from, to)` | vs période précédente si `cmp=prev` (même lecture avec `range: previousRange(query.range)` dans la cible) | **à modifier** : `goalConversions(f).total` (7.3) | `KpiTile` `count` | → `/sessions` | `0` réel → tous les taux passent à `null` (G3) | `tests/integration/goals-sql.test.ts` : viewer restreint à A, `app=all` → `total` ne compte aucune session de B |
| G2 | KPI « Objectifs actifs » | Stat | nombre d'objectifs actifs du périmètre | aucune | **à modifier** : `listGoals(query.scope.effectiveApps)` | `KpiTile` | → table | `0` → hero vide + geste « Créer un objectif » (admin) | même test : aucun objectif de B |
| G3 (hero) | « Taux de conversion par objectif » | Classement en barres sur une échelle fixe de 0 à 100 % (conservé, `page.tsx:66`) ; **intervalle de Wilson à 95 %** écrit à côté du taux (« 12,4 % ± 1,8 pt ») : sous quelques centaines de sessions, deux taux proches ne se départagent pas | par objectif : sessions ayant satisfait la condition / sessions de l'app de l'objectif ; intervalle ; tri par taux décroissant, objectifs à moins de 30 conversions **et** 30 non-conversions en fin avec « échantillon faible » | aucune | à modifier `goalConversions(f)` ; **à créer (pur)** : `intervalleWilson(k: number, n: number, z = 1.96): [number, number] \| null` dans `lib/goals.ts` ; **correction** : `conversionRate` rend `null` si `sessions = 0` (`goals.ts:25-27`, F00) | `RankBar` `max={100}`, `display` = « taux ± demi-largeur », `sub` = condition (« page vue = /merci », « événement contient checkout ») ; sous `app=all`, `sub` préfixé de l'app | barre → ligne de G5 | total = 0 → `vide` « Aucune session sur <période> : taux non calculables » ; taux `null` → barre absente, « — » | `tests/unit/goals.test.ts` : `intervalleWilson(0, 0) = null` ; `intervalleWilson(10, 100)` ≈ [0,055 ; 0,174] |
| G4 | « Conversion par appareil » | Petits multiples : une barre par appareil pour chaque objectif, même échelle (comparaison catégorielle, `grafana.md` L102) | taux par `device_type` (desktop, mobile, tablette, Inconnu), dénominateur = sessions de ce type | écart à l'ensemble en points | **à créer** : `goalConversionsByDevice(f: FiltersLike)` (7.3), **une seule requête** | table SSR avec barres (`RankBar` par objectif) | appareil connu → `/goals?device=<d>` ; « Inconnu » : non cliquable, `title` = « le contrat ne filtre pas l'appareil inconnu » (non établi que `seg` accepte `device:is_null`) | `sessions = 0` pour un appareil → « — » | le groupe « Inconnu » est une ligne à part (V3) ; `tests/integration/goals-sql.test.ts` : viewer A + `app=all` → aucune ligne d'un objectif de B |
| G5 | « Objectifs » | Table | Objectif · App (si > 1) · Condition · Conversions (sessions) · Taux ± intervalle · Dernière conversion | aucune | à modifier `goalConversions` (`derniere` = `max(ts)` dans la même requête) | table SSR | — | — | la colonne « Conversions » dit « sessions » (ce n'est pas un nombre d'événements) |
| G6 | Gestion (admin) | Formulaire + table | conservés | — | `createGoalAction`, `listGoals(effectiveApps)` | conservés | — | viewer : section non rendue | — |

### 5.15 Formulaires `/forms`

#### 5.15.1 Question et suite

- **Question** : « Quels formulaires perdent leurs visiteurs, et sur quel champ ? »
- **Réponse en dix secondes** : la barre « Formulaires classés par abandons » et, pour le formulaire
  sélectionné, le champ marqué « dernier touché avant abandon » le plus souvent.
- **Question suivante** : « Voir des sessions qui ont abandonné ici » → `/sessions?…` (après B34) ;
  « ce champ est-il lent à remplir ou revisité ? » → table des champs.

#### 5.15.2 Référence retenue

**Nôtre, conservé** : aucune analyse au niveau du champ n'est documentée chez Datadog
(`console-ecrans-2.md` L443) ni chez IP-Label (non établi). Grafana pour la discipline (distribution
plutôt que moyenne, `grafana.md` table « question → panneau »).

#### 5.15.3 Grille

| # | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| Fm1 | En-tête (« Aucune valeur saisie n'est collectée », conservé) + filtres + note de lecture historique | — | — | — |
| Fm2 | KPI : 4 `KpiTile` | 4 col. | 2 × 2 | 2 × 2 |
| Fm2b | Bandeau d'échantillonnage (S7) | pleine largeur | idem | idem |
| Fm3 | Hero « Formulaires classés par abandons » (6 col.) + « Ce que nous appelons un abandon » (6 col., texte) | côte à côte | empilés | empilés |
| Fm4 | « Champs de <formulaire> dans l'ordre de remplissage » | pleine largeur | défilement interne | cartes par champ |
| Fm5 | « Abandons dans le temps » (indisponible avant B34) | pleine largeur | — | — |

#### 5.15.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Formulaires entamés** | stat | `submits + abandons` (définition écrite) | — | existante : `formEvents(f, 5000)` (`lib/queries-form-analytics.ts:L14-30`) → `formReport` (`lib/form-analytics.ts:L52-79`) | `KpiTile format="count"` | — | `events.length === 5000` → `partiel` « 5 000 derniers événements seulement : les formulaires plus anciens de la fenêtre ne sont pas comptés » | bandeau si et seulement si 5 000 lus |
| **Soumissions** | stat | `form.submit` | — | idem | `KpiTile` | — | — | — |
| **Conversion** | stat **sans verdict coloré** (S6) | `submits / starters` | — | idem | `KpiTile format="pct"` | — | `starters = 0` → `null` | — |
| **Temps médian jusqu'à la soumission** | stat : médiane, pas moyenne (P7) | médiane de `total_time_ms` des `form.submit` | — | existante : `FormEventProps.total_time_ms` (`lib/form-analytics.ts:L20`) ; **fonction pure à créer** `mediane(valeurs)` dans `lib/form-analytics.ts` (aujourd'hui `avgTimeMs`, moyenne mêlant soumissions et abandons) | `KpiTile format="s-auto"` | — | aucune soumission → `null` | la moyenne disparaît de l'écran |
| **Échantillonnage** (bandeau Fm2b, S7) | bandeau (voir § 5.11.4) | même calcul que § 5.11.4, sur la population de l'écran : sessions des événements `form.*` lus par `formEvents` (une session « biaisée-erreurs » n'émet que ses erreurs : ses formulaires ne sont jamais lus) | — | avant B31 : **à créer** B38 `samplingSessionsHistorique(f: Filters, fenetre: { jours: number } \| { semaines: number }): Promise<EchantillonnageSessions>`, mêmes prédicats `now() - interval` et même filtre d'app que la lecture qu'il qualifie (S2) ; après B31 : `samplingSessions(f)` | `EtatSurface kind="echantillonne"` sous Fm2 | aucune | idem § 5.11.4 | e2e S7 sur `/forms` |
| **Formulaires classés par abandons** (hero) | barres classées par **abandons** (gravité, P3), effectif écrit, formulaires sous 30 entamés rangés en fin « échantillon faible » | par formulaire : abandons, entamés, conversion | aucune | `formReport` (tri à changer : aujourd'hui par entamés) | `RankBar` (valeur = abandons, `sub` = « 12 entamés · conversion 58 % ») | barre → `?form=<clé>` (paramètre existant) | vide → texte conservé (option `forms` active par défaut : `packages/rum-sdk/src/index.ts:L386-387`) | unitaire : un formulaire à n = 12 est après un formulaire à n = 400 |
| **Ce que nous appelons un abandon** | texte (`lecture`) | — | — | `packages/rum-sdk/src/forms.ts:L130-218` | `HeroReading` | — | — | contient les trois phrases : « un abandon est émis quand la page passe en arrière-plan avec un formulaire entamé et non soumis » ; « changer d'onglet puis revenir soumettre compte un abandon et pas la soumission » ; « un envoi sans événement `submit` (bouton géré en JavaScript) compte comme un abandon » |
| **Champs dans l'ordre de remplissage** | barres horizontales **dans l'ordre médian de première interaction**, pas triées par abandons : l'ordre du formulaire est la question (où ça décroche) ; chaque barre vaut les **tentatives qui ont touché le champ** et se découpe en deux segments qui s'additionnent : « abandons dont c'est le dernier champ » (jeton `bad`) puis « autres tentatives ayant touché le champ » (neutre) ; libellé « N tentatives, dont A abandons dont c'est le dernier champ » ; « ce n'est pas un entonnoir : un champ peut être sauté » | par champ : tentatives (`interactions` = événements `form.*` dont `fields` contient le champ : un événement par tentative, pas une session, `lib/form-analytics.ts:L93-101`), abandons ici (`dropoff`), part `abandonsIci / interactions`, ordre médian (`order`), temps médian et p75 (`timeMs`), retours moyens (`refocus`), taux de saisie | aucune | existante : `fieldReport` (`lib/form-analytics.ts:L86-115`) — `order` et `refocus` émis (`forms.ts:L13-17`) mais non agrégés (`console-ecrans-2.md` L454) : **à étendre** `fieldReport` → `{ordreMedian, tempsMedianMs, tempsP75Ms, retoursMoyens, abandonsIci, autres}` avec `autres = interactions − abandonsIci` (pur, testé), et `incoherents` au niveau du rapport. Le SDK ne pose `last_field` que sur un champ suivi (`packages/rum-sdk/src/forms.ts:L46-58` : au-delà de 40 champs, `focus` sort avant de changer `last`), donc `abandonsIci ≤ interactions` pour ses événements ; un abandon dont `last_field` n'est pas dans `fields` (autre émetteur, ancien SDK) n'est **pas** compté dans `abandonsIci` mais dans `incoherents` (aujourd'hui `ensure` crée un champ à 0 interaction qui porte l'abandon, L103) | `RankBar` avec `segments: [abandonsIci, autres]` + table SSR alternative à **trois colonnes** : Tentatives · Abandons ici · Part des tentatives | ligne → aucune | aucun champ → texte conservé (sans l'émoji « 🎉 », `app/forms/page.tsx:L77`) ; > 40 champs tronqués par le SDK (`MAX_FIELDS`, `forms.ts:L34`) → dit ; `incoherents > 0` → `partiel` « N abandons dont le dernier champ n'est pas dans la liste des champs touchés : exclus des barres » | unitaires `tests/unit/form-analytics.test.ts` : ordre médian de `[1,2,3]`,`[2,1,3]`,`[1,2,3]` → champ A premier ; champ touché 10 fois dont 4 abandons ici → segments `[4, 6]`, longueur 10 (jamais 14) ; abandon dont `last_field` est absent de `fields` → `incoherents = 1`, segments inchangés |
| **Abandons dans le temps** | barres par seau (abandons, soumissions ; additifs) | par seau | `cmp=prev` | **backend : manque** — `formEvents` ne sélectionne ni `ts` ni `session_id` (L18) ; B34 : `formEvents` renvoie `ts`, `session_id` | `StackedBars` (abandons, soumissions : additifs ; la pile vaut les formulaires entamés du seau) | clic seau → zoom (après B31) | avant B34 : `partiel` « série à créer (B34) » | — |

#### 5.15.5 Conservé / disparaît

Conservé : « aucune valeur saisie n'est collectée » en sous-titre ; définition du « dernier champ
touché ». Disparaît : moyennes de temps ; seuils 0,6 / 0,3 ; tri des champs par abandons ; émoji.

### 5.16 Acquisition `/acquisition`

#### 5.16.1 Question et suite

- **Question** : « D'où arrivent les sessions, et par quelles pages entrent-elles ? »
- **Réponse en dix secondes** : les barres « Sessions par canal d'entrée », tous canaux affichés, zéros
  compris, avec la part de l'ensemble.
- **Question suivante** : « Ces entrées tiennent-elles ? » → `/paths` (entrées et sorties, section
  « Pages d'entrée » avec leur qualité).

#### 5.16.2 Référence retenue

**Nôtre, conservé** : aucune des trois références n'a d'écran de canaux documenté (Datadog :
`console-ecrans-2.md` L313 ; Grafana, IP-Label : non établi). Datadog « Usage metrics based on first
visited page » (`newoptimizeperformanceimage.png`) inspire le croisement canal × page d'entrée.

#### 5.16.3 Grille

| # | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| A1 | En-tête + filtres ; note « lecture non migrée » (S3) | — | — | — |
| A2 | KPI : 3 `KpiTile` | 3 col. | 3 col. | 1 col. |
| A2b | Bandeau d'échantillonnage (S7) | pleine largeur | idem | idem |
| A3 | Hero « Sessions par canal d'entrée » (7 col.) + « Ce que « direct » recouvre » (5 col., texte) | côte à côte | empilés | empilés |
| A4 | « Pages d'entrée par canal » (table croisée) | pleine largeur | défilement interne | liste par canal repliable |
| A5 | « Sites référents » (barres) | pleine largeur | idem | idem |
| A6 | « Canaux dans le temps » | pleine largeur, état indisponible avant B31 | — | — |

#### 5.16.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Sessions lues** | stat | nombre de premières vues de session lues (≤ 20 000) | aucune avant B31 | existante : `acquisition(f).total` (`lib/queries-acquisition.ts:L14-28`, `lib/acquisition.ts:L86`) | `KpiTile format="count"` | — | `total = 20 000` → `partiel` « plafond de 20 000 sessions atteint : les canaux portent sur les 20 000 premières sessions par identifiant, pas les plus récentes » (tri `order by p.session_id`, L24) | bandeau affiché si et seulement si `total === cap` |
| **Part hors direct** | stat | `(total − direct − interne) / total` | — | `acquisition(f).channels` | `KpiTile format="pct"` | — | `total = 0` → `null` + raison | — |
| **Référents externes distincts** | stat | nombre d'hôtes distincts (top 20 renvoyés : écrire « 20 ou plus » si 20) | — | `acquisition(f).referrers.length` | `KpiTile format="count"` | — | 0 → « 0 » | la valeur 20 s'affiche « ≥ 20 » |
| **Échantillonnage** (bandeau A2b, S7) | bandeau (voir § 5.11.4) | même calcul que § 5.11.4, sur la population de l'écran : sessions dont la première vue est lue par `acquisition` (7 jours glissants) | — | avant B31 : **à créer** B38 `samplingSessionsHistorique(f: Filters, fenetre: { jours: number } \| { semaines: number }): Promise<EchantillonnageSessions>`, mêmes prédicats `now() - interval` et même filtre d'app que la lecture qu'il qualifie (S2) ; après B31 : `samplingSessions(f)` | `EtatSurface kind="echantillonne"` sous A2 | aucune | idem § 5.11.4 | e2e S7 sur `/acquisition` |
| **Sessions par canal d'entrée** (hero) | barres horizontales ordonnées dans l'ordre fixe `direct, search, social, referral, internal` (`CHANNELS`, `lib/acquisition.ts:L9`), **zéros affichés** : l'absence de recherche est une information que l'anneau actuel cache (parts à 0 filtrées, `Donut.tsx:L59`) | sessions par canal, part du total | aucune | existante : `acquisition(f).channels` | `RankBar` (valeur + part en `display`, couleur `CATEGORIELLE`) dans `Figure` | barre : **non cliquable** (le canal n'est pas une dimension du contrat), `title` et alternative le disent | `total = 0` → `vide` « Aucune session sur <fenêtre> » | les 5 canaux sont toujours rendus ; libellé « Direct ou référent masqué » |
| **Ce que « direct » recouvre** | texte (`lecture`) | — | — | règles de `classifyChannel` (`lib/acquisition.ts:L32-40`) | `HeroReading` | — | — | contient : « pas de référent reçu : saisie de l'adresse, favori, application, ou site d'origine qui retire son adresse (politique `Referrer-Policy`) » et « paramètres de campagne (UTM) non captés : l'URL est nettoyée par le SDK » (`app/acquisition/page.tsx:L121-124`, conservé) |
| **Pages d'entrée par canal** | table croisée route × canal, cellule = sessions + barre de fond proportionnelle à la ligne : répond à « la recherche amène-t-elle sur la bonne page ? » | top 10 routes d'entrée × 5 canaux ; total par ligne | aucune | **à créer** : `acquisition` sélectionne `p.url` mais pas `p.route` (L18) ; B31 ajoute `route` à la sélection et `acquisitionReport` renvoie `entrees: {route: string; parCanal: Record<Channel, number>; total: number}[]` (pur, testé) | table SSR `<th scope>` | route → `/sessions?qf=route&q=<route>` (le texte du lien dit « sessions passées par cette route » : la recherche porte sur toute la session, pas sur l'entrée) | avant B31 : `partiel` « route d'entrée non lue par cette lecture (à créer) » ; aucune route → `vide` | somme des cellules d'une ligne = total de la ligne (unitaire) |
| **Sites référents** | barres classées (top 20) avec canal en badge et part de toutes les sessions | sessions par hôte référent externe | aucune | existante : `acquisition(f).referrers` | `RankBar` | non cliquable (référent hors contrat) | 0 → « Aucun site référent externe sur <fenêtre> » (texte conservé L111-117) | part calculée sur `total`, pas sur le top 20 |
| **Canaux dans le temps** | barres empilées par seau (5 canaux, additifs) | sessions par canal par seau | `cmp=prev` | **backend : manque** — la lecture n'a pas `started_at` par ligne ; B31 : `acquisitionSerie(f: FiltersLike): Promise<{t: string; canaux: Record<Channel, number>}[]>` sur `sqlContext` | `StackedBars` (`components/charts/StackedBars.tsx` ; tout empilement passe par ce composant, mesures additives seulement) ; 5 séries ≤ P14 | clic seau → zoom (après migration) | avant B31 : `Figure etat={{kind:"partiel", raison:"série à créer : la lecture actuelle n'a pas d'horodatage (B31)"}}` | avant B31, aucune figure vide dessinée |

#### 5.16.5 Conservé / disparaît

Conservé : classement pur et testé (`tests/unit/acquisition.test.ts`), canal interne séparé, bots exclus,
note UTM. Disparaît : l'**anneau** (une seule part sur la capture, `13-acquisition.png`, et parts à 0
cachées) ; les couleurs `emerald`/`amber` pour des canaux (`app/acquisition/page.tsx:L20-33`, contraires
à P15 : vert et ambre sont des états).

### 5.17 Rétention `/retention`

#### 5.17.1 Question et suite

- **Question** : « Les visiteurs identifiés reviennent-ils, et au bout de combien de semaines
  décrochent-ils ? »
- **Réponse en dix secondes** : la courbe de rétention pondérée et la tuile « Retour en S+1 ».
- **Question suivante** : « Les mobiles reviennent-ils moins que les ordinateurs ? » → figure « Par
  appareil » ; « qui sont les revenants ? » → `/sessions` (anneau nouveaux / revenants).

#### 5.17.2 Référence retenue

**Datadog** Retention (grille + courbe, moyenne pondérée `Σ(valeur × taille) / Σ taille`, valeurs
grisées pour une période incomplète : `datadog-docs-product-analytics-mobile.md` L144-162) ; **nôtre,
conservé** pour la clé aléatoire et l'explication de la coupure historique (`lib/queries-cohorts.ts:L6-14`).

#### 5.17.3 Grille

| # | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| R1 | En-tête ; sélecteur « Fenêtre : 4 · 8 · 12 · 26 semaines » **dans** la barre d'en-tête (`PageHeader.children`), la période globale désactivée avec sa raison | — | — | chips sur une ligne défilante |
| R2 | KPI : 4 `KpiTile` | 4 col. | 2 × 2 | 2 × 2 |
| R2b | Bandeau d'échantillonnage (S7) | pleine largeur | idem | idem |
| R3 | Hero « Courbe de rétention » (7 col.) + « Par appareil » (5 col.) | côte à côte | empilés | empilés |
| R4 | « Matrice cohorte × semaine » | pleine largeur | défilement horizontal interne | idem, colonne « Cohorte » figée |

#### 5.17.4 Table des widgets

| Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|
| **Visiteurs identifiés suivis** | stat | `Σ size` des cohortes | — | existante : `retentionCohorts(f, weeks)` (`lib/queries-cohorts.ts:L27-40`) → `CohortRow.size` | `KpiTile format="count"` | — | 0 → carte vide conservée (explication de la coupure du 09/09/2026, `app/retention/page.tsx:L55-59`) | — |
| **Retour en S+1** | stat, **sans verdict coloré** (S6 : les seuils 40 / 20 % sont sans source) | moyenne pondérée à l'offset 1 : `Σ retenus / Σ taille` sur les cohortes dont la cellule S+1 est **complète** ; une cellule est incomplète quand `cohorte + offset ≥ semaineCourante` (semaine UTC contenant `nowMs`) : elle sort du numérateur **et** du dénominateur ; n cohortes restantes affiché | aucune | existante : calcul page (`app/retention/page.tsx:L65-76`, qui inclut aujourd'hui la semaine en cours et rend 0 sans cohorte) → **à déplacer** en fonction pure `courbeRetention(rows: CohortRow[], semaineCourante: number, colonnes: number): { offset: number; taux: number \| null; cohortes: number; taille: number; exclues: number }[]` dans `lib/cohorts.ts` ; `semaineCourante = floor(epoch(lundi UTC de nowMs) / 604800)`, même formule que l'index de `lib/queries-cohorts.ts:L36` | `KpiTile format="pct" couverture={{n: taille, unite:"visiteurs"}}` ; sous-texte « N cohortes complètes (k exclues : semaine en cours) » | → figure courbe | aucune cohorte complète à l'offset → `valeur: null`, `raisonNull` « pas encore une semaine complète de recul » | unitaire `tests/unit/cohorts.test.ts` : cohorte A (10 visiteurs, S+1 complète, 5 retenus) et cohorte B (30 visiteurs, S+1 incomplète, 0 retenu) → taux S+1 = 50 %, `cohortes = 1`, `exclues = 1`, identique au taux calculé sans B ; taux `null` jamais affiché 0 |
| **Retour en S+4** | idem | offset 4, mêmes exclusions | — | idem | idem | — | idem | idem, offset 4 |
| **Sessions sans identifiant, hors matrice** | stat | sessions de la fenêtre avec `visitor_id is null` | — | **backend : manque** — à créer B35 `sessionsSansIdentifiant(f, weeks): Promise<number>` | `KpiTile` | — | avant B35 : `raisonNull` « non lu (à créer) » | — |
| **Échantillonnage** (bandeau R2b, S7) | bandeau (voir § 5.11.4) | même calcul que § 5.11.4, sur la population de l'écran : sessions à `visitor_id` non nul lues par `retentionCohorts` sur N semaines | — | avant B31 : **à créer** B38 `samplingSessionsHistorique(f: Filters, fenetre: { jours: number } \| { semaines: number }): Promise<EchantillonnageSessions>`, mêmes prédicats `now() - interval` et même filtre d'app que la lecture qu'il qualifie (S2) ; après B31 : `samplingSessions(f)` | `EtatSurface kind="echantillonne"` sous R2 | aucune | idem § 5.11.4 | e2e S7 sur `/retention` |
| **Courbe de rétention** (hero) | courbe (Datadog « Retention curve ») sur l'axe des **semaines depuis l'arrivée**, points pleins si ≥ 2 cohortes **complètes** contribuent, creux sinon | taux pondéré par offset 0..weeks−1, **cellules incomplètes exclues** (numérateur et dénominateur) | aucune | `courbeRetention` (pure, ci-dessus) | `LineTrend` (existant, `domain=[0,100]`) dans `Figure` ; couleur `SERIE.principale`, plus `#059669` (`page.tsx:L85`) | aucune (pas de dimension temps de contrat) | 1 seule colonne → `partiel` « une seule semaine observée » (texte conservé) | méta : « moyenne pondérée par la taille des cohortes dont la semaine est complète ; semaine en cours exclue » ; alternative : offset, taux, cohortes, exclues, taille ; unitaire : la courbe et la tuile S+1 rendent le même nombre |
| **Par appareil** | 2 courbes (desktop, mobile) sur le même axe, **même population** (visiteurs identifiés), ≤ 5 séries | `courbeRetention` pour `device=desktop` puis `device=mobile` | les deux entre elles | existante : deux appels `retentionCohorts({...f, device:"desktop"}, weeks)` et `mobile` (le paramètre `$2` existe, L36) | `LineTrend` à 2 séries (prop `series`, § 4.1) | lien de chaque série → `/retention?device=<d>` | `lecture` obligatoire : « un visiteur mobile peut être surcompté (identifiant en mémoire, parity C3, `console-donnees.md` L125) » ; tablette non lue (lecture historique) | sous `device=` déjà posé, la figure est remplacée par « déjà filtré sur <appareil> » |
| **Matrice cohorte × semaine** | table colorée (Datadog « Retention grid ») : la seule figure qui montre la taille de chaque cohorte à côté de son taux | ligne = cohorte (semaine ISO du **lundi**, UTC), colonnes S+0..S+n ; cellule = « 12 / 28 » + « 43 % » | — | existante : `CohortRow.cells` (`lib/cohorts.ts:L8-18`) ; étiquette : **corriger** `weekIndexToDate` (`lib/queries-cohorts.ts:L43-45`, jeudi et non lundi : `console-ecrans-2.md` L357) → `lundiDeSemaine(index)` pur | **à créer** `components/charts/MatriceCohortes.tsx` (SSR, props § 4.3) ; échelle `SEQUENTIELLE` (`lib/palette.ts`) | cellule → aucune | semaine en cours : cellule hachurée + « semaine incomplète » ; cohorte < 10 visiteurs : texte `ink-soft` + « effectif faible » | unitaire : `lundiDeSemaine` rend un lundi pour 10 index ; e2e : aucune cellule sans « n / taille » |

#### 5.17.5 Conservé / disparaît

Conservé : clé `visitor_id` et exclusion des sessions sans identifiant (plutôt qu'une répartition au
jugé) ; explication de la matrice triangulaire. À écrire en `lecture` de la matrice : « cohorte = première semaine
d'activité **dans la fenêtre lue** (au plus 30 jours conservés), pas première visite absolue » (`lib/cohorts.ts:L37-42`).
Disparaît aussi : la grille de lecture « chute S+0 → S+1 = activation, plateau = noyau fidèle »
(`console-ecrans-2.md` L353), interprétation sans source que l'écran n'a pas à poser. Disparaît : les couleurs `rgba` inline non thémées
(`page.tsx:L136-140`) ; le verdict S+1 coloré sans source ; la **période globale active qui ne fait
rien** : `surfaces.ts:L123` passe de `range: "presets"` à `range: "none"` avec
`rangeNote: "La rétention se lit sur N semaines, choisies ci-dessous"` (le filtre est alors affiché
désactivé avec sa raison, `rangeAvailability`, L184-192).

**Catégorie Fiabilité** — § 5.18 à § 5.20.
### 5.18 SLO — `/slo`

#### 5.18.0 Ce que calcule vraiment `slo_status()` (relu pour cette spécification)

`migration-v64.sql:247-295`, dernière définition de la fonction (v17, v46, v56, v64 la redéfinissent) :

- **atteinte** : vital = part des mesures `rating = 'good'` du vital sur `window_days` jours glissants
  jusqu'à **maintenant** (L271-274). Le calcul se fait sur la table brute, sans exclure les bots, sans
  aucun filtre de population. `error_rate` = `1 − sum(occurrences) / count(pages vues)` (L263-269).
  Ce n'est **pas** une part de pages sans erreur : dès qu'il y a plus d'occurrences que de pages vues,
  l'atteinte est **négative**.
- **budget** = `1 − objectif` ; **consommé** = `(1 − atteinte) / budget × 100`, borné à [0, 999],
  `null` si le budget ou l'atteinte est nul (L257-258).
- **burn rapide** = atteinte **sur la dernière heure** telle que `1 − atteinte_1h ≥ 14,4 × budget`
  (L259, L277-292). Une seule fenêtre, sans fenêtre de confirmation. La valeur 14,4 n'est pas
  documentée dans le dépôt (**non établi** : origine du facteur). `null` si aucune mesure sur l'heure.
- Type TypeScript faux sur deux champs : `attainment: number` et `fast_burn: boolean`
  (`queries-alerting.ts:23-26`) alors que le SQL peut rendre `null`. F55 corrige le type.
- Une alerte « burn rapide » est émise par `check_slo_burn()` (`migration-v45.sql:46-80`), sévérité
  `critical`, avec un délai de rappel 1 h → 16 h. L'événement porte `slo_id`, mais `alertEvents` ne
  le renvoie pas (`queries-v2.ts:230-252`).

#### 5.18.1 Question, référence

- **Question** : « Quels objectifs de service consomment leur budget, et lesquels le brûlent en ce
  moment ? »
- **Question suivante** : « Qu'est-ce qui consomme ce budget ? » → pour un vital :
  `/pages?vital=<V>&route=<r>` ; pour `error_rate` : `/errors?route=<r>` ; puis les alertes du SLO.
- **Référence** : IP-Label pour les paliers de budget 50 / 75 / 100 % (`iplabel.md` L159-161,
  « rapporté (prudence) » pour les chiffres) ; Grafana pour le choix du composant. Une jauge convient
  à une valeur ou à quelques-unes ; une barre de jauge convient pour comparer plusieurs séries sur des
  seuils communs (`grafana.md` L94-95, L192).

#### 5.18.2 Des barres de budget plutôt que des jauges

L'ossature initiale prévoyait « `Gauge` par SLO + barre de budget ». Nous remplaçons les
jauges par **une seule figure de barres de budget alignées** (`BudgetBars`, § 4.3). Trois raisons.
Dix jauges de largeur fixe `w-[8.5rem]` (`console-identite.md` L260) ne se comparent pas d'un coup
d'œil. Une jauge 0-100 ne sait pas montrer un dépassement (consommé jusqu'à 999 %). Les paliers
50 / 75 / 100 % sont des repères communs à toutes les lignes, ce qui est le cas d'usage de la barre de
jauge. `Gauge` reste dans `components/charts/` pour d'autres écrans.

**Couleur.** Seul « ≥ 100 % = budget épuisé » est une définition ; les paliers 50 et 75 % viennent
d'une source rapportée avec prudence (`iplabel.md` L159-161). Donc : barre en jeton neutre (`ink`)
sous 100 %, `bad` à partir de 100 %, repères 50 et 75 % en traits gris étiquetés « repère ». Aligné
sur la règle « couleur seulement pour un seuil nommé » (§ 1.5 R-S).

#### 5.18.3 Grille

1 `PageHeader` + `FiltersNotAppliedNote` (conservée, `app/slo/page.tsx:53`) → 2 KPI (4 tuiles) →
3 hero `BudgetBars` (**au-dessus du pli** jusqu'à ~8 SLO à 1440) → 4 « Consommation dans le temps »
(état non collecté tant que B6 manque) → 5 table « Définitions et état » → 6 formulaire de création
(admin, replié si au moins un SLO existe). Les blocs configurables par roue (`dashboard-blocs.ts`,
catalogue `/slo` L113) sont conservés : `budget` = zones 2-4, `liste` = 5, `creation` = 6.
768 : identique, sur une colonne. 390 : les barres passent sous leur libellé sur deux lignes.

#### 5.18.4 Widgets

| # | Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| SL1 | KPI « SLO actifs » | Stat | nombre de lignes de `slo_status()` | aucune ; `lecture` = « sans référence : configuration » | **existante** : `sloStatus(f)` `queries-alerting.ts:30-42` | `KpiTile` `count`, `lecture` | → ancre `#definitions` | `0` → le hero devient l'état vide (SL3) | — |
| SL2 | KPI « Budget épuisé » | Stat avec alerte nommée | SLO avec `burned_pct ≥ 100` | aucune | existante | `KpiTile`, `alerte:{si:">", valeur:0, regle:"consommé ≥ 100 % du budget"}` | → ancre `#budget` | — | — |
| SL2b | KPI « Brûlent vite (dernière heure) » | Stat avec alerte nommée | SLO avec `fast_burn = true` | aucune | existante | `KpiTile`, `alerte:{si:">", valeur:0, regle:"consommation sur 1 h ≥ 14,4 fois le budget"}`, `lecture` : « une seule fenêtre, donc sensible aux pics courts » | → `/alerts#pistes-slo` (pistes SLO de la frise A5) | `fast_burn = null` compté dans SL2c, pas ici | — |
| SL2c | KPI « Non mesurables » | Stat : un SLO sans mesure n'est ni tenu ni manqué (V3) | SLO avec `attainment = null` | aucune | existante (après correction de type F55) | `KpiTile`, tonalité neutre | → ancre `#definitions` | — | un SLO sans aucune mesure apparaît ici et nulle part comme « 0 % consommé » |
| SL3 (hero) | « Budget d'erreur consommé, par SLO » (`id="budget"`) | Barres alignées sur une échelle commune de 0 à 150 %. La portion au-delà de 100 % est hachurée et la valeur écrite (« 312 % »). Repères verticaux à 50, 75 et 100 % | par SLO : `burned_pct` ; texte : « atteinte 96,4 % pour un objectif de 95 % sur 28 j » ; tri : consommé décroissant, `null` en dernier | repères 50 / 75 (« repère ») et 100 % (« épuisé ») ; badge « brûle vite » si `fast_burn` | existante (`sloStatus`) | **à créer** `BudgetBars` (§ 4.3) dans `Figure` (`meta` = « instantané calculé à <heure de lecture> ; chaque SLO sur sa fenêtre glissante jusqu'à maintenant ») | barre → drill « Qu'est-ce qui consomme » (4.1) ; nom → ligne de SL5 ; lien « Créer une alerte sur ce SLO » (admin) → `/alerts?regle_metrique=<métrique>&regle_route=<route>#nouvelle-regle` (paramètres `regle_*`, § 3.1) | 0 SLO → `vide` « Aucun SLO actif » + geste « Créer un SLO » (admin) ou « Demandez à un administrateur » (viewer) ; `attainment = null` → ligne « Non mesurable : aucune mesure <métrique> sur <fenêtre> j » sans barre ; atteinte < 0 (`error_rate`) → ligne « plus d'occurrences d'erreurs que de pages vues : atteinte non interprétable », barre pleine hachurée | `tests/unit/BudgetBars.test.tsx` : `burned_pct = 312` → barre bornée à 150 % + texte « 312 % » ; `null` → aucune barre et le texte de raison ; 80 % → barre neutre (aucune classe `bad`) |
| SL4 | « Consommation du budget dans le temps » | Série temporelle, prévue | budget consommé par heure | — | **backend : manque** B6 (`slo_status()` est un instantané, `console-donnees.md` L406, L703) | `Figure` avec `etat` | — | `EtatSurface{kind:"non_collecte", manque:"historique de consommation non conservé (instantané seulement)"}` | la figure est présente, avec ce texte, et sans aucune série |
| SL5 | « Définitions et état » (`id="definitions"`) | Table de configuration | SLO · Métrique **en clair** (« Part des mesures LCP notées Bon », « 1 − occurrences d'erreurs par page vue ») · **Route** (ajoutée, absente aujourd'hui, `console-ecrans-3.md` L170-172) · Objectif · Fenêtre · Atteinte · Consommé · Brûle vite · Alertes sur 7 j · Actif | aucune | existantes : `listSlo(f)` L57-66 + `sloStatus` ; « Alertes sur 7 j » : **à créer**, `slo_id` ajouté à `AlertEventRow` (F62) | `SloRow` conservé (`components/slo/SloStatusRow.tsx`), une colonne en plus | « Alertes sur 7 j » → `/alerts#slo-<id>` ; Activer / Désactiver / Supprimer : admin seulement | SLO désactivé : ligne grisée, état « désactivé » (conservé, `page.tsx:38-39`) | e2e (compte de démo) : aucun bouton d'écriture dans le DOM |
| SL6 | Formulaire « Nouvel SLO » | Formulaire | App, Nom, Métrique (`SLO_METRICS`, `queries-v2.ts:87`), Objectif %, Fenêtre (j), Route | — | action existante `createSloAction` | `Field`, `INPUT_CLASS` | — | la phrase sous « Métrique » dit la formule exacte de 4.0 | — |

#### 5.18.5 Conservé / disparaît

- **Conservé** : blocs configurables et `TousEteints` ; affichage des SLO désactivés pour les
  réactiver ; `FiltersNotAppliedNote`.
- **Disparaît** : les 10 jauges ; le libellé « Taux d'erreur JS » pour `error_rate`, remplacé par sa
  formule ; le vert / ambre sous 100 % de budget.

### 5.19 Alertes — `/alerts`

#### 5.19.1 Question, référence

- **Question** : « Qu'est-ce qui s'est déclenché, qui en a été averti, et qu'est-ce qui reste à
  traiter ? »
- **Question suivante** : « Pourquoi cette règle s'est-elle déclenchée ? » → l'écran de la mesure,
  sur la fenêtre évaluée : `[fired_at − window_minutes, fired_at)`. Métrique vitale → `/pages?vital=<V>&route=<r>&from&to` ;
  `error_rate` → `/errors?route=<r>&from&to` ; `issue:<uuid>` → `/errors/issues/<uuid>` ;
  `event:<nom>` → `/events?kind=…&from&to` ; `log_errors` → `/logs`. Déclenchement d'un SLO →
  `/slo#definitions`.
- **Référence** : Datadog Monitors pour la grammaire (seuils alerte / avertissement, « no data » dit,
  anomalie avec historique minimal : `datadog-docs-product-analytics-mobile.md` § 3.1-3.3) ;
  IP-Label pour le **seuil relatif** de régression de release (`iplabel.md` L100-114, L165-166) ;
  **nôtre, conservé** : livraison à trois états et bandeau « aucun canal actif » au-dessus du flux
  (`console-ecrans-3.md` L215-225).

#### 5.19.2 Grille

1 `PageHeader` (badge « N non acquittées », bouton « Évaluer maintenant » admin) +
`FiltersNotAppliedNote` → 2 bandeau de résultat d'évaluation (`?fired=N`, conservé) → 3 bandeau
« Aucun canal actif » (conservé, placé ici, avant tout chiffre) → 4 KPI (5 tuiles) → 5 hero
« Déclenchements des 30 derniers jours » : barres par jour (80 px) empilées au-dessus de la frise
par règle, même axe x (**au-dessus du pli** à 1440 avec ≤ 8 règles) → 6 « À traiter » (flux) →
7 « Règles » (table + formulaire `id="nouvelle-regle"`) → 8 « Canaux de notification » (conservé).
768 : identique. 390 : la frise garde ses lignes ; le libellé de règle passe au-dessus de sa piste.

#### 5.19.3 Widgets

| # | Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| A1 | KPI « Non acquittées » | Stat avec alerte nommée | nombre d'`alert_event` non acquittés du périmètre, sans plafond | aucune | **existante** : `unackedAlertCount(f)` `queries-v2.ts:254-269` | `KpiTile`, `alerte:{si:">", valeur:0, regle:"déclenchement non acquitté"}` | → A6 filtré sur non acquittées | `0` réel | égal au badge du `PageHeader` |
| A2 | KPI « Déclenchées sans que personne soit averti (30 j) » | Stat avec alerte nommée : c'est le risque principal d'un outil d'alerte (« la supervision voit, elle ne prévient pas », texte actuel) | événements sur 30 j avec `delivered = 0` et `pending = 0` | aucune | **à créer** (lecture A5) : compte exact sur 30 j, pas sur les 100 derniers | `KpiTile`, `alerte:{si:">", valeur:0, regle:"aucune livraison réussie ni en attente"}` | → A6 filtré « non livrées » | `0` réel | `tests/integration/alertes-sql.test.ts` : un événement « en attente » (`pending > 0`) n'est pas compté (définition v49, `queries-v2.ts:192-198`) |
| A3 | KPI « Règles franchies à la dernière évaluation » | Stat | règles actives avec `last_state = 'breached'` | aucune | **existante** : `alertRules(f)` `queries-v2.ts:159-179` | `KpiTile` | → A7 filtré | `last_state = null` (jamais évaluée, ou base antérieure à v73) → compté dans A4 | — |
| A4 | KPI « Règles sans données » | Stat neutre : `no_data` ≠ `ok` (conservé, `RuleRow.tsx:19-30`) | règles `no_data` + règles jamais évaluées | aucune | existante | `KpiTile`, `lecture` = « dont N jamais évaluées » | → A7 filtré | — | — |
| A4b | KPI « Canaux actifs » | Stat avec alerte nommée | canaux `active` (globaux + app) | aucune | **existante** : `listChannels(f)` `queries-alerting.ts:108-117` | `KpiTile`, `alerte:{si:"<", valeur:1, regle:"aucun canal : personne n'est prévenu"}` (`alerte.si` accepte `"<"`, § 4.2) | → ancre `#canaux` | — | — |
| A5 (hero, haut) | « Déclenchements par jour et par sévérité — 30 jours » | Barres empilées par jour : des comptes additifs par jour, donc l'empilement est licite (`grafana.md` L92 met en garde contre l'empilement de grandeurs non additives) | `count(*)` d'`alert_event` par jour UTC × sévérité, 30 jours fixes, **calcul SQL** (aujourd'hui en mémoire sur 100 lignes, `console-ecrans-3.md` L228-232) | aucune | **à créer** : `alertEventsByDay(f: FiltersLike, jours = 30): Promise<{ jour: string; severity: string; n: number; non_livres: number }[]>`, mêmes jointures de source que `alertEvents` (`sourcesEvenement`, `queries-v2.ts:209-228`), `generate_series` pour les jours vides à 0 | `StackedBars` (`charts/StackedBars.tsx:23-36`), couleurs de sévérité (critical = `bad`, warning = `warn`, info = `ink-soft`, palette `SEVERITE` de `lib/palette.ts`, § 1.2 P15) + motif par sévérité (§ 3.9), dans `Figure` (`meta` = « 30 jours fixes, jusqu'à maintenant ; la plage de l'écran ne s'applique pas ») | barre → A6 filtré sur ce jour | aucun événement sur 30 j → `vide` « Aucun déclenchement sur 30 jours » | `tests/integration/alertes-sql.test.ts` : 150 événements seedés sur 30 j → la somme des barres vaut 150, pas 100 |
| A5 (hero, bas) | « Déclenchements par règle » | Frise de déclenchements, une piste par source (règle, SLO, issue sans règle) : marqueur à `fired_at`, forme pleine = livré, creuse = non livré, losange = en attente, contour épais = non acquitté ; à droite de chaque piste, l'**état actuel** (Normale / Franchie / Données insuffisantes). Équivalent de « status history » de Grafana (chaque événement reste distinct, `grafana.md` L100). Pas de « state timeline » : il faudrait l'historique des évaluations (B51) | par source : liste des `fired_at` (30 j), sévérité, livraison, acquittement | aucune | **à créer** : `alertFirings(f: FiltersLike, jours = 30, plafond = 2000): Promise<{ lignes: { source: "regle" \| "slo" \| "issue"; source_id: string; libelle: string; fired_at: Date; severity: string; delivered: number; pending: number; acknowledged: boolean; event_id: number }[]; tronque: boolean }>` ; état actuel : `alertRules` (`last_state`) | **à créer** `FriseDeclenchements` (§ 4.3) dans la même `Figure` que la partie haute ; les pistes SLO sont groupées sous un intertitre `id="pistes-slo"`, chaque piste SLO a `id="slo-<id>"` | marqueur → A6 ancré sur l'événement (`#evt-<id>`) ; libellé de piste → A7 (`#regle-<id>`) ou `/slo#definitions` | > 2 000 → `partiel` « 2 000 déclenchements affichés sur 30 j » ; piste sans événement mais règle franchie → piste vide + état « Franchie » | alternative : une ligne par source avec compte et dernier déclenchement ; 12 pistes au plus visibles, les autres derrière « Voir les N règles » (P14) |
| A6 | « À traiter » | Flux d'enregistrements, non acquittés d'abord puis les plus récents | par événement : sévérité, message, métrique **et route** (route ajoutée : renvoyée mais non affichée aujourd'hui, `console-ecrans-3.md` L242-243), déclenché (UTC + relatif), livraison (livrée ×N / en attente ×N / non livrée, conservé), acquittée | aucune | **existante** : `alertEvents(f)` `queries-v2.ts:230-252` (100 derniers) + `slo_id` à ajouter (F62) | liste SSR, `SeverityBadge` conservé (`components/alerts/SeverityBadge.tsx`) ; chaque élément porte `id="evt-<id>"` ; `?evt=<id>` → élément mis en évidence (contour + `aria-current="true"`) et défilé à l'écran | « Voir la mesure » → drill de 5.1 ; « Acquitter » (admin) → action existante `acknowledgeAlertEvent` (`queries-v2.ts:335`) | 0 → « Aucun déclenchement » ; 100 atteint → `partiel` « 100 plus récents affichés » (le dire sur la liste, pas seulement dans une tuile) ; `evt` hors des 100 → ligne « Événement <id> hors des 100 plus récents » | e2e : un événement d'issue renvoie vers `/errors/issues/<uuid>` ; le lien de mesure porte `from`/`to` = fenêtre évaluée |
| A7 | « Règles » (`id="regles"`) | Table d'état + édition | par règle : état (Normale / Franchie / Données insuffisantes + raison), métrique (`metricLabel`, L116-120), route, env, mode (`ruleModeLabel`), seuil ou sensibilité, fenêtre, sévérité, dernière valeur et heure d'évaluation, non acquittés | aucune | existante : `alertRules(f)` | `RuleRow` conservé (`components/alerts/RuleRow.tsx`), avec **env** affiché ; chaque ligne `id="regle-<id>"` | édition (admin) | aucune règle → formulaire ouvert (comportement actuel) | — |
| A8 | Formulaire « Nouvelle règle » (`id="nouvelle-regle"`) | Formulaire à champs **conditionnés par le mode** : aujourd'hui, 13 champs visibles d'un coup, dont certains sans effet (`console-ecrans-3.md` L209, L234-236) | Mode = boutons radio « Seuil fixe » / « Écart à l'habitude (baseline) » / « Régression de release » (désactivé, B52). `<fieldset>` par mode ; le masquage passe par `:has(input[value=…]:checked)`. Sans ce support, les deux fieldsets restent visibles avec leur légende | — | action existante `createRuleAction` ; valeurs `ALERT_MODES` (`lib/alerting.ts:3`) | `RuleFields` (`components/alerts/RuleFields.tsx`) réorganisé ; `Field`, `INPUT_CLASS` | pré-remplissage : `?issue=<uuid>` (existe, `page.tsx:42-44`) + `regle_metrique`, `regle_route`, `regle_seuil` (§ 3.1) ; présence d'un de ces paramètres → formulaire ouvert | option « Régression de release » : désactivée, raison « l'évaluateur `check_alerts` ne connaît pas ce mode (B52) ; seuil par défaut prévu : +20 %, aligné sur `assessRegression` ratio 1,2 (`queries-deploys.ts:103`) » ; valeur de pré-remplissage illisible (métrique inconnue, seuil non numérique) → champ laissé vide + ligne « Réglage d'affichage ignoré : … » (§ 3.1 règle 3) | e2e à 390 : le formulaire en mode seuil n'affiche ni « Sensibilité » ni « Semaines baseline » (navigateur Playwright récent) ; `/alerts?regle_route=/checkout` : champ Route pré-rempli, **aucune** `FiltersNotAppliedNote` ne cite `route`, et le lien de navigation vers `/slo` ne porte pas `regle_route` |
| A9 | « Canaux de notification » (`id="canaux"`) | Liste + formulaire | conservés | — | existante `listChannels` | `ChannelsSection` conservé | — | — | — |

**Seuil relatif de release (§ 3.2).** Valeur par défaut **confirmée :
+20 %**, alignée sur `assessRegression` (`ratio = 1.2`, `queries-deploys.ts:103-111`) et sur le
bandeau de `/tracing`. La valeur « 10 % » attribuée à Ekara est « rapportée (prudence) »
(`iplabel.md` L102-103) : nous ne la reprenons pas. L'évaluation n'existe pas côté base (B52). La
phrase « l'écart mêle le code et le contexte » accompagne toute alerte de ce mode (§ 3.2).

**MTTA (délai d'acquittement).** Non affiché : `alert_event` n'a pas d'horodatage d'acquittement
(`migration-v02.sql:75-82`), seulement un booléen. Dépendance B50 (§ 6.3).

#### 5.19.4 Conservé / disparaît

- **Conservé** : livraison à trois états ; bandeau « aucun canal actif », remonté au-dessus des KPI ;
  `no_data` avec sa raison ; lecture `to_jsonb` tolérante aux migrations (`queries-v2.ts:161-162`) ;
  bouton « Évaluer maintenant » et son bandeau `?fired=N` (`page.tsx:40-41, 79-90`).
- **Disparaît** : l'histogramme par sévérité calculé en mémoire sur 100 événements
  (`page.tsx:102-117`) ; le formulaire à 13 champs à plat.

### 5.20 Tendances — `/forecast` (libellé « Tendances »)

#### 5.20.0 Cause probable du plantage de `24-forecast.png`

`app/forecast/page.tsx:146-151` est un composant serveur (aucun `"use client"`). Il passe
`format={(v) => fmtLatency(v)}` à `ForecastChart`, qui est un composant client
(`components/charts/ForecastChart.tsx:1`, prop `format?: (v: number) => string`, L39). Next.js refuse
de sérialiser une fonction vers un composant client (« Functions cannot be passed directly to Client
Components »). L'exception survient au rendu, et seulement quand `hasData` est vrai : c'est cohérent
avec une démo qui a des données. `console-identite.md` L259 l'avait noté comme défaut de
sérialisation, et `components/charts/ScatterPlot.tsx:29-31` documente le même piège. **Établi** : la fonction est passée. **Probable, non reproduit ici** : que
ce soit la cause du digest 2899484112. La correction (`format: FormatId`) figure en F04. F55
la fait **en tête**, sans attendre F04, parce que l'écran est aujourd'hui inutilisable.

#### 5.20.1 Question, référence

- **Question** : « Si la tendance des 14 derniers jours continue, quand franchit-on le seuil, et
  cette tendance se distingue-t-elle du bruit ? »
- **Question suivante** : « Depuis quand ça dérive, et sur quelles pages ? » → la Vue d'ensemble sur
  les 14 jours (plage personnalisée, bornes converties en UTC, voir TE5) puis `/pages?vital=LCP`.
- **Référence** : Datadog Forecast monitor pour ce qu'il ne faut pas promettre sans historique (au
  moins deux saisons pour du saisonnier, bornes de confiance qui franchissent le seuil :
  `datadog-docs-product-analytics-mobile.md` § 3.4) ; **nôtre, conservé** : narration déterministe
  et explicable (`forecast.ts:61-84`).

#### 5.20.2 Grille

1 `PageHeader` (domain « Fiabilité », titre « Tendances ») + bandeau de fenêtre fixe rendu par la page (le `rangeNote` statique de F00, point 9, grise le sélecteur de période ; le bandeau, lui, écrit les dates :
« 14 jours complets, du JJ/MM au JJ/MM, fuseau de l'app ; la plage choisie en haut ne s'applique
pas ; la journée en cours est exclue ») → 2 « Synthèse » (narration) → 3 KPI (3 tuiles) → 4 hero
« LCP p75 quotidien et sa tendance » (**au-dessus du pli**) → 5 deux petits multiples côte à côte :
« Occurrences d'erreurs pour 100 pages vues » et « Pages vues par jour » → 6 « Méthode ». À 768 et
390 : tout sur une colonne.

**Fenêtre de 14 jours complets.** Aujourd'hui, `dailyLcpSeries` lit
`m.ts > now() - interval '14 days'` (`queries-grid.ts:185`) : 13 jours complets, plus deux journées
partielles (la première et aujourd'hui) ; `dailyTraffic` rend 14 jours **dont** aujourd'hui (L117-120).
F65 change les deux lectures pour la fenêtre `[début du jour local J−14, début du jour local J)`
(J = aujourd'hui dans le fuseau de l'app) : 14 jours complets, aujourd'hui exclu. `dailyTraffic`
gagne un argument `opts?: { exclureAujourdhui?: boolean }` (défaut `false`, pour ne rien changer
chez ses autres appelants, dont exploration W-B7) ; `dailyLcpSeries` passe à `generate_series` sur
les 14 jours, jours sans mesure à `p75 = null`, `n = 0`.

#### 5.20.3 Widgets

| # | Libellé | Type et pourquoi | Mesure | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| TE1 | « Synthèse » | Texte déterministe (conservé) : il dit ce que la droite implique | par indicateur à seuil : échéance ou « non distinguable du bruit » | — | **existante** : `buildForecastNarrative` `forecast.ts:76-84`, avec deux corrections (F55) : (a) « horizon de 3 jours » (L82) contredit la fenêtre d'alerte de 7 jours (L78) → le texte dit « 7 jours » ; (b) l'échéance n'est donnée que si la pente est significative (TE5) | bandeau `role="note"`, texte | lien « Créer une alerte sur ce seuil » (admin) → `/alerts?regle_metrique=LCP&regle_seuil=<borne Bon>#nouvelle-regle` (paramètres `regle_*`, § 3.1) | données insuffisantes → « Pas assez de jours mesurés (N sur 14, 7 requis) » | `tests/unit/forecast.test.ts` : pente dans le bruit → aucune ligne « devrait franchir » |
| TE2 | KPI « LCP p75, dernier jour complet » | Stat avec verdict | p75 LCP du dernier jour **complet** (le jour en cours, partiel, est exclu : aujourd'hui `current` prend la dernière valeur non nulle, qui peut être celle d'une journée entamée, `page.tsx:93`) | vs même jour de la semaine précédente (J-7), libellé visible | **existante, à compléter** : `dailyLcpSeries(f)` `queries-grid.ts:176-194` ; **à créer** : champ `n: number` (mesures du jour), fenêtre ci-dessus | `KpiTile` `vital:"LCP"`, `serie` = 14 p75, `couverture:{n, unite:"mesures LCP"}` | → `/pages?vital=LCP` | jour sans mesure → `null` + « aucune mesure LCP ce jour-là » | — |
| TE3 | KPI « Occurrences d'erreurs pour 100 pages vues, dernier jour complet » | Stat **sans verdict** : aucun seuil publié pour ce ratio | `sum(occurrences) / pages vues × 100` du jour | vs J-7 | **existante** : `dailyTraffic(f, { exclureAujourdhui: true })` `queries-grid.ts:110-174` (`errors` = `sum(e.occurrences)`, L163) | `KpiTile` `format:"pour100"` (§ 4.0), `sensMeilleur:"bas"`, `lecture` : « inclut les erreurs sans page vue (backend) : le ratio peut dépasser 100 » | → `/errors` | pages vues = 0 → `null` + « aucune page vue ce jour-là » | le libellé n'est **jamais** « Taux d'erreur JS » ni « part de pages vues avec au moins une erreur » (faux aujourd'hui, `page.tsx:62-64` : le ratio peut dépasser 100) |
| TE4 | KPI « Pages vues, dernier jour complet » | Stat | `count(*)` de `rum_pageview` du jour | vs J-7 (le trafic a un cycle hebdomadaire) | existante `dailyTraffic` | `KpiTile` `count`, `sensMeilleur:"neutre"` | — | `0` réel | — |
| TE5 (hero) | « LCP p75 quotidien et sa tendance » | Série à seuils : 14 points observés (trait plein, points creux si n < 30, **exclus de l'ajustement**), droite ajustée tracée **sur les 14 jours** (pour voir si elle colle aux points), prolongée 3 jours en pointillé, avec une bande ± 1 écart type des résidus autour de la projection ; bandes Bon / À améliorer / Mauvais de `THRESHOLDS.LCP` | p75 quotidien (fuseau de l'app) ; ajustement moindres carrés sur les jours `n ≥ 30` ; écart type des résidus | seuils 2,5 s et 4 s lus dans `rating.ts` (plus de 2500 écrit en dur, `page.tsx:58`) | existantes : `dailyLcpSeries`, `linfit`, `forecastNext` (`forecast.ts:14-40`) ; **à créer (pur)** : `dispersionResidus(fit: Fit, ys: (number \| null)[]): number \| null` et `penteSignificative(fit: Fit, ys, k = 2): boolean` (vrai si `abs(pente) × 14 > k × dispersion`) dans `lib/forecast.ts` | `ThresholdSeries` : `grille` = 14 débuts de jour + 3 jours projetés, séries `observe` (`principale`, `effectifCle:"n"`), `ajuste` (`reference`), `projection` (`role:"projection"`), `bande:{basseCle:"bas", hauteCle:"haut", libelle:"± 1 écart type des résidus"}`, `faibleSous:30`, `vital:"LCP"`, `fuseau` = fuseau de l'app. Un seul composant de série pour tout le domaine ; `ForecastChart` reste pour `/` si F04 l'y garde | point → `/?from=<début du jour local, en UTC>&to=<début du lendemain local, en UTC>` : le serveur calcule les bornes par `bornesJourLocal(jour, tz)` de `lib/fuseau.ts` (F05, § 4.4) ; en été à Paris, le 10/09 donne `from=2026-09-09T22:00:00Z&to=2026-09-10T22:00:00Z`, et l'infobulle écrit « 10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC) » (§ 3.3) | < 7 jours `n ≥ 30` → pas de droite, `partiel` « tendance non calculée : 7 jours mesurés requis, N disponibles » ; pente non significative → droite grise + « tendance non distinguable du bruit » ; jour sans mesure → trou | `tests/unit/forecast.test.ts` : série plate bruitée → `penteSignificative = false` ; série 1 000 → 2 400 ms en 14 j → échéance ≤ 7 j ; `tests/unit/forecast-liens.test.ts` : fuseau `Europe/Paris`, jour d'été → `from` à `22:00:00Z` la veille ; e2e : aucune erreur serveur sur `/forecast` avec les données de démo |
| TE6 | « Occurrences d'erreurs pour 100 pages vues » | Petit multiple, même grammaire que TE5, **sans seuil ni échéance** (le seuil « 2 % » disparaît) | ratio quotidien ; ajustement si significatif | aucune | existante `dailyTraffic(f, { exclureAujourdhui: true })` | `ThresholdSeries` sans `vital`, `format:"pour100"`, hauteur 140 | point → `/errors?from&to` (mêmes bornes UTC que TE5) | jour sans page vue → trou | aucun texte « franchira » pour cet indicateur |
| TE7 | « Pages vues par jour » | Barres quotidiennes + repère « même jour, semaine précédente » (gris pointillé). **Pas de droite** : une droite sur 14 jours lit un cycle hebdomadaire comme une tendance (limite reconnue, `console-ecrans-3.md` L309-311) | `count` par jour, jours vides à 0 (`generate_series`, L117-121) | J vs J-7 | existante `dailyTraffic(f, { exclureAujourdhui: true })` | `ThresholdSeries` : `series=[{cle:"vues", libelle:"Pages vues", role:"principale", forme:"barres"}, {cle:"vues_j7", libelle:"Même jour, semaine précédente", role:"reference"}]` | barre → `/?from&to` (bornes UTC du jour local) | tous à 0 → `vide` | le libellé de la carte ne contient pas « projeté » |
| TE8 | « Méthode » | Texte | « Droite des moindres carrés sur les jours d'au moins 30 mesures ; bande = ± 1 écart type des résidus ; échéance écrite seulement si la pente sur 14 jours dépasse 2 écarts types ; aucune saisonnalité ; ce n'est pas une prévision » | — | — | `<details>` | — | — | la phrase « ce n'est pas une prévision » est présente (conservée, `page.tsx:204-207`) |

#### 5.20.4 Conservé / disparaît

- **Conservé** : narration déterministe ; positionnement comme complément des anomalies et de la
  consommation de budget SLO ; phrase de limite.
- **Disparaît** : `MetricCard` et `ForecastSpark` écrits dans la page (`page.tsx:213-302`),
  remplacés par `KpiTile` + `Sparkline` ; le seuil « 2 % » ; le libellé « Taux d'erreur JS » ; la
  projection du trafic.

**Catégorie Explorer** — § 5.21 à § 5.25.
### 5.21 Explorer — `/explorer`

#### 5.21.1 Question

- **Tranchée en moins de dix secondes** (sous-titre `PageHeader`, P1) : « Quelle mesure, pour quelle
  population, sous quelle forme ? » (question conservée). Le hero répond : le
  **résultat dans sa figure**, avec en tête ce qui est compté, l'effectif, la plage lue, la référence.
- **Question suivante (drill-down)** : « Quelles lignes composent ce chiffre, et qu'ont-elles en
  commun ? » → clic sur un groupe = filtre ajouté (paramètre dédié ou `seg`), bascule vers la
  représentation « Journal » pour lire les lignes, ou « Ouvrir l'écran spécialisé » (Pages, Erreurs…).

#### 5.21.2 Référence retenue

**Datadog RUM Explorer**, parce que c'est la seule des trois références qui a un explorateur
documenté : une requête en pastilles, une forme choisie par « Visualize as », deux widgets de contexte
(volume + distribution) au-dessus du résultat (`datadog-video-rum-db-new.md` § 2 et M1-M4 ;
`datadog-docs-explorer-dashboards.md` § 4, § 13 points 1, 7, 8). **Nôtre, conservé** : l'exécution
explicite, la méta qui dit ce qui est compté, le budget qui refuse les zéros, les dimensions
indisponibles avec leur raison (`console-ecrans-1.md` L434-440 de la lecture, § 08 (4)). **IP-Label**
fournit une idée : les **analyses de départ nommées** (vues préréglées, `iplabel.md` L62-63) pour que
l'écran ne s'ouvre pas vide.

#### 5.21.3 Grille

Ordre des zones (de haut en bas) :

1. `PageHeader` — `domain="Explorer"`, titre « Explorer », `sub` = la question ; à droite, lien
   « Vues enregistrées (N) ».
2. **Jeux de données** — rangée de liens (existant, `app/explorer/page.tsx` L150-166), inchangée.
3. **Requête appliquée** — `QueryPills` (§ 4.3) : une pastille par élément (jeu, mesure,
   variante, regroupements, chaque condition de population, bots / interne), chacune retirable.
4. **Composer** — le formulaire actuel (`<form method="get">`, L168-260) dans un `<details>` **ouvert
   si `run` est absent, fermé sinon** (libellé « Modifier la requête »). La représentation n'est plus
   dans le formulaire : elle passe en zone 5.
5. **Représentation** — rangée d'onglets-liens `TabLink` : Valeur · Classement · Série · Journal ·
   Distribution (désactivé, raison B5). Changer d'onglet garde la requête et relance (`run=1` conservé
   dans le lien) : c'est un geste explicite, pas une frappe.
6. **Constats de lecture** — bandeaux `EtatSurface` : `partiel` (couverture, troncature),
   `echantillonne` (jeu `errors`), avertissements du jeu (`meta.warnings`).
7. **Hero « Résultat »** — une `Figure` pleine largeur (W-E3 à W-E6 selon la représentation).
8. Rangée à deux colonnes : **« Volume du résultat »** (W-E2, 1/3) et **« Répartition par … »** (W-E7, 2/3).
9. **Enregistrer cette analyse** (existant, L447-560 environ : carte de tableau de bord, vue
   personnelle, JSON canonique), replié.
10. **Sans exécution** (`run` absent) : la zone 7 est remplacée par **« Analyses de départ »** (W-E1).

**Au-dessus du pli à 1440 × 900** (coquille ≈ 130 px, `console-ecrans-1.md` L11) : en-tête (≈ 90 px),
jeux (≈ 50), pastilles (≈ 40), « Modifier la requête » replié (≈ 40), onglets de représentation (≈ 40),
titre et méta de la figure puis ≥ 300 px de graphique. Avant exécution : formulaire ouvert + première
rangée des analyses de départ.

**768 px** (sans sidebar) : zone 8 passe en une colonne (Volume puis Répartition) ; les pastilles
passent à la ligne ; le formulaire en 2 colonnes (`md:grid-cols-2`).
**390 px** : tout en une colonne ; jeux et onglets de représentation en rangée défilante avec
indicateur de débordement (même règle que `PresetBar`, § 4.2) ; le formulaire en une colonne ;
tables en `overflow-x-auto` ; « Répartition » limitée aux 10 premières lignes avec « Voir les N »
(lien `limit=`).

#### 5.21.4 Table des widgets

Notations : `Q` = `ecran.query` (population de l'écran), `P` = plan validé
(`parseExplorerPlan`, `lib/analytics-schema.ts` L948-1026), `R` = `ExplorerResult`
(`lib/queries-explorer.ts` L91-150).

**Règle R-V — verdict Web Vitals réservé au p75** (corrige CE13 ; s'applique à l'Explorer **et** aux
cartes de tableau de bord, puisque les deux passent par `ResultatAnalyse`) :

- Une seule fonction décide : à créer dans `lib/explorer-page-params.ts`,
  `export function vitalDeVerdict(plan: Pick<ExplorerPlan, "dataset" | "measure" | "variant">): VitalName | null`
  — rend `plan.variant` **seulement si** `dataset === "vitals"`, `measure.field === "value"`,
  `measure.aggregation === "p75"` et `variant ∈ CORE_VITALS` (`rating.ts` L34) ; `null` sinon.
- La prop `vital` de `KpiTile` (badge et couleur de verdict) et celle de `ThresholdSeries` (bandes
  Bon / À améliorer / Mauvais) reçoivent **uniquement** `vitalDeVerdict(plan) ?? undefined`. Dans
  `ResultatAnalyse`, `rating2026` n'est appelé que sur le résultat de `vitalDeVerdict` (couleur des
  barres de W-E4 / W-B3), jamais sur `plan.variant` directement (vérifiable par grep).
- Pour `avg` et `p95` d'un vital : tuile **neutre** (valeur, unité, delta, couverture ; pas de badge),
  barres de classement de teinte neutre `SERIE.principale`, **aucune bande** sur la série. La `lecture`
  de la figure porte la phrase exacte : « Seuils web.dev définis pour le p75 : aucun verdict n'est
  donné pour <la moyenne | le p95>. » Nous n'affichons pas de bandes « indicatives » : une bande sous
  une courbe se lit comme un verdict, quelle que soit sa légende.
- Le format d'affichage ne dépend pas du verdict : `ms` pour LCP / INP / FCP / TTFB, `cls` pour CLS,
  quelle que soit l'agrégation.
- Test unitaire (`tests/unit/explorer-page-params.test.ts`) : `vitalDeVerdict` rend `"LCP"` pour
  `value:p75`, `null` pour `value:avg`, `value:p95`, `rows:count`, et pour une variante hors
  `CORE_VITALS`. Test de rendu (`tests/unit/ResultatAnalyse.test.tsx`) : plan `vitals value:avg LCP`,
  représentation Valeur → aucun texte « Bon », « À améliorer », « Mauvais » dans le rendu ; même plan en
  Série → aucun élément de bande (`ReferenceArea`). E2e (`tests/e2e/analytics-explorer.spec.ts`) :
  `measure=value:avg&variant=LCP&viz=value&run=1` → aucun badge de verdict ; `measure=value:p75` → badge
  présent.

| Id | Libellé exact | Type de graphique — pourquoi | Mesure · agrégation · dimensions · granularité | Comparaison affichée | Source | Composant | Interactions | États | Critère d'acceptation |
|---|---|---|---|---|---|---|---|---|---|
| W-E1 | « Analyses de départ » | Grille de 6 cartes-liens, sans graphique — une carte ne doit rien lire tant que personne n'a demandé (exécution explicite conservée) | Six plans fixes : « LCP p75 par route » (`vitals`, `value:p75`, variante `LCP`, `g0=route`, classement 10) ; « Occurrences d'erreurs dans le temps » (`errors`, `occurrences:sum`, série) ; « Sessions commencées par appareil » (`sessions`, `started:count`, `g0=device`, classement) ; « INP p75 par navigateur » (`vitals`, `value:p75`, `INP`, `g0=browser`) ; « Ressources : durée p75 par route » (`resources`, `duration_ms:p75`, `g0=route`) ; « Blocages LoAF p95 par route » (`longtasks`, `blocking_ms:p95`, variante `loaf`, `g0=route`) | — | à créer : `lib/explorer-modeles.ts` → `export const MODELES_EXPLORER: { cle: string; titre: string; question: string; plan: Omit<ExplorerPlan, "cursor"> }[]` ; lien = `explorerHref(Q, plan, { run: "1" })` (existant, `lib/explorer-page-params.ts` L130-137) | à créer dans le domaine : `components/explorer/ModelesDepart.tsx` (§ 4.3) | clic = ouvre l'Explorer exécuté sur ce plan, filtres de population conservés | un modèle dont une dimension est indisponible (`dimensionSupport`) est affiché désactivé avec sa raison, jamais masqué | test unitaire : chaque plan de `MODELES_EXPLORER` passe `parseExplorerPlan` ; e2e : `/explorer` sans `run` montre 6 liens, aucun appel `exploreAnalytics` (spy sur le journal serveur ou compteur de requêtes) |
| W-E2 | « Volume du résultat » | Barres par seau : `ThresholdSeries` à une série `forme: "barres"` (`SerieDef.forme`, § 4.2), sans `vital` donc sans bande ; **pas** `StackedBars` à une série (l'empilement reste réservé aux séries additives multiples) — un comptage se lit en barres (`datadog-docs-explorer-dashboards.md` § 4 « bars recommended for counts ») ; c'est le contexte que Datadog met au-dessus de toute liste (M3) | `count` des lignes du **même jeu, même population, même variante**, sans regroupement, série au seau de `bucketSecondsFor` ; affiché seulement si la représentation courante n'est pas « Série » | aucune (volume de contexte) | existante : deuxième appel `exploreAnalytics({ query: Q, plan: { ...P, measure: { field: "rows" \| "started" \| "occurrences", aggregation: "count" \| "sum" }, groupBy: [], visualization: "timeseries", limit: 1, cursor: null } })` ; `rows` existe sur tous les jeux sauf `sessions` (`started`) et `errors` (`occurrences:sum`, V1) — `analytics-schema.ts` L217-550 | `Figure` + `ThresholdSeries` (`series: [{ cle: "volume", libelle: "<unité du jeu>", role: "principale", forme: "barres" }]`, hauteur 120)  | clic sur un seau → même écran zoomé (`from`/`to` du seau, § 3.3), refus sous 5 min | chargement : squelette 120 px ; erreur : `SectionErreur` « La lecture du volume a échoué. Le résultat reste valide. » ; budget dépassé : `EtatSurface partiel` « Volume non lu : budget de lecture dépassé » (jamais des zéros) | e2e : avec `viz=toplist&run=1`, la figure `#volume-resultat` existe et son alternative a autant de lignes que de seaux ; avec `viz=timeseries`, elle n'existe pas |
| W-E3 | Valeur : « <Mesure> — <agrégation> » (ex. « LCP — p75 ») | `KpiTile` — un seul chiffre se juge contre une référence et un seuil (Grafana stat, `grafana.md` table « question → panneau ») | `R.data.total`, unité `R.meta.unit`, effectif `R.data.samples` | `cmp=prev` : `previousRange(Q.range)` (`query-contract.ts` L306) → second `exploreAnalytics` ; delta `relativeChange` (L313) ; libellé « vs <rangeLabel(précédente)> » ; delta masqué si la période précédente est incomplète (`R.meta.coverage` du second appel, prop `couverturePrecedente`, § 3.2) ou si l'une des deux couvertures est sous `faibleSous` ; **verdict seulement selon R-V** : `vital = vitalDeVerdict(P)` — p75 d'un vital → badge et couleur ; `avg` / `p95` → tuile neutre, pas de badge | existante : `exploreAnalytics` ×2 (courant, précédent) | `KpiTile` (`label`, `valeur = total`, `format` : `ms` pour une durée, `cls` si variante CLS, `count` sinon, `vital = vitalDeVerdict(P) ?? undefined` (R-V), `precedent`, `reference`, `couverture: { n: samples, unite: R.meta.counting }`) | tuile non cliquable (on y est déjà) | `total = null` → « — » + `raisonNull` « aucune ligne mesurée sur la fenêtre » ; précédent `null` → « pas de mesure sur la période précédente » | test de rendu : `total: null` → « — » et pas de delta ; `value:avg` + `variant=LCP` → aucun badge Bon / À améliorer / Mauvais, `value:p75` + `variant=LCP` → badge ; e2e : `viz=value&cmp=prev` affiche « vs » + la plage précédente en clair |
| W-E4 | Classement : « <Mesure> par <dimension> » | **Deux formes selon l'additivité** (`estAdditive`, L88-90) : mesure additive (`count`, `sum`) → `RankBar`, barre = valeur, sous-texte = part du total (une part n'a de sens que pour ce qui s'additionne) ; mesure non additive (`avg`, `p75`, `p95`, `distinct`) → `ImpactTable`, ligne de référence « Ensemble » = `R.data.total` (calculé sur toute la population, `docs/API_CONSOLE.md` L585-589 via `console-donnees.md` § 5 inv. 11), tri gravité, écart au total, échantillon faible sous 30 lignes | `R.data.groups` (`key` tuple, `value`, `samples`), ≤ `P.limit` groupes, 1 ou 2 dimensions (libellé « a • b », `libelleCle` L242) | `ImpactTable.ecart` = valeur − total (« écart de p75 », « écart de moyenne », « écart de p95 » selon l'agrégation ; jamais une contribution) ; couleur de barre = `rating2026` **seulement si** `vitalDeVerdict(P)` n'est pas `null` (R-V), teinte neutre sinon ; `cmp=prev` : **non affiché** (deux classements côte à côte trompent sur l'ordre ; dit dans `lecture`) | existante : `exploreAnalytics` | `RankBar` (existant) / `ImpactTable` (§ 4.2) ; tri fait par `lib/impact.ts` (F05) | clic sur une ligne → Explorer **filtré** sur la valeur (paramètre dédié `route=`, `browser=`… ou `seg=v2:<dim>:eq:<v>` ; groupe `null` → `seg=v2:<dim>:is_null`, § 3.3) ; 2 dimensions → deux conditions ; lien secondaire « Voir les lignes » = même filtre + `viz=table` | `groups = []` → `EtatSurface vide` « Aucun groupe sur <plage> » ; `meta.truncated_groups` → méta « N affichés ; le total porte sur toute la population » (texte existant L360-364) ; valeur `null` d'un groupe → « — », rangé en dernier, jamais une barre à 0 (corrige CE2 côté page) | test unitaire (`tests/unit/impact.test.ts`) : ligne `samples = 12` après `samples = 400` en tri gravité ; test de rendu : plan `vitals value:p95 INP` → aucune barre de teinte `RATING_HEX` ; e2e : un clic sur la 1re barre donne une URL contenant la condition et `period`/`from` (P8) |
| W-E5 | Série : « <Mesure> dans le temps[, par <dimension>] » | Mesure non additive → `ThresholdSeries` (lignes, bandes de seuil **seulement si `vitalDeVerdict(P)` n'est pas `null`** — p75 d'un vital, R-V —, **un seul axe partagé** — corrige les mini-graphes à échelles propres, `console-ecrans-1.md` § 08 (5)) ; mesure additive avec groupes → `StackedBars` (empiler n'est permis que pour l'additif, `widget-data.ts` L240-242) ; sans groupe → `ThresholdSeries` une série | `R.data.series` (`start`, `end`, `key`, `value`, `samples`), seau `R.meta.range.bucket_seconds`, ≤ 5 groupes (P14 ; CE6 réduit `LIMITES.timeseries` à `[1, 3, 5]`) | `cmp=prev` sans groupe : série `reference` grise pointillée = même plan sur `previousRange`, alignée **par rang de seau** (§ 3.2) ; avec groupes : pas de comparaison, raison dans `lecture` ; annotations de déploiement : `listDeploys(f, 20)` (`queries-deploys.ts` L20) via `lib/annotations.ts`, sous preset seulement avant B1 | existante : `exploreAnalytics` (×2 si `cmp=prev`) ; `listDeploys` | `ThresholdSeries` (`vital = vitalDeVerdict(P) ?? undefined`, `annotations`, `annotationsIndisponibles` = « déploiements non affichés sur une plage personnalisée (lecture non migrée) » avant B1, `seauSecondes`, `fuseau: "UTC"`, `zoomHref`) / `StackedBars` | survol = infobulle multi-séries ; clic sur un seau → zoom (`from`/`to`) ; clic sur une annotation → `cmp=release&rel_b=…&rel_a=…` | seau `null` = trou (jamais 0 — corrige CE5) ; seau de bord partiel marqué creux ; plus de 5 groupes demandés → refus par le formulaire (options absentes) ; `avg` / `p95` d'un vital → pas de bande, phrase R-V dans `lecture` | test de rendu : un point `value: null` ne produit aucun segment (pas de `connectNulls`) ; e2e : `viz=timeseries&g0=browser&limit=10` est refusé ou ramené à une option proposée ; bande « Bon » visible pour `variant=LCP&measure=value:p75`, **absente** pour `measure=value:p95` |
| W-E6 | Journal : « Lignes du résultat » | Table paginée (existante, `Journal` L607-637) — quand les lignes individuelles comptent (Datadog Lists) | `R.data.rows`, colonnes fermées du jeu, 25 à 200 lignes, curseur | — | existante | table existante dans une `Figure` | « Lignes suivantes » (curseur existant) ; colonne `session` → lien `panel=session:<id>` (§ 3.3), page `/sessions/[id]` par « Ouvrir en page » | vide réel → texte existant L406-409 ; « Aucun tri par mesure : le journal est ordonné par date » écrit en méta (le tri par valeur n'existe pas : **backend : manque**, le curseur est `(ts, key)`, L578-583) | e2e : colonne session cliquable ouvre le panneau (`panel=session:` dans l'URL) |
| W-E7 | « Répartition par <dimension> » | `RankBar` horizontal, compte par valeur, **sur la même population que le résultat** — reprend l'idée des facettes comptées de Datadog (M4) sans leur défaut : la population est nommée | `count` du jeu (`rows`, `started` ou `occurrences:sum`), `groupBy = [split]`, classement 10, fenêtre entière ; dimension choisie par `split` (paramètre existant, `lib/breakdowns.ts` L35), défaut `device` | part de chaque valeur dans le total (additif, donc permis) ; « Inconnu » = ligne à part | existante : troisième `exploreAnalytics` ; **pas** `dimensionValues` (CE12) | `Figure` + onglets de dimension (grammaire `Breakdown`, raison si indisponible via `dimensionSupport`) + `RankBar` | clic sur une barre → ajoute la condition à la requête (comme W-E4) ; onglet → change `split` | dimension non portée par le jeu → onglet désactivé avec `support.message` visible (pas seulement en `title`, corrige `console-ecrans-1.md` § 08 (5) dernier point) ; erreur → `SectionErreur` | e2e : `split=browser` → 1re barre cliquable ajoute `browser=` ; un onglet indisponible porte son texte de raison lisible au clavier |
| W-E8 | Méta de la figure (zone `meta` de `Figure`) | Texte — la couverture est déclarée (P11) | `R.meta.counting`, `samples`, `rangeLabel`, `bucketLabel(bucket_seconds)`, `additive`, `approximate`, `source`, **`rollup.reason`** (aujourd'hui non affiché, `console-ecrans-1.md` § 08 (6)), **`effective_apps`** (idem), `coverage` | — | existante : `R.meta` (`queries-explorer.ts` L103-137) | `Figure.meta` | — | `effective_apps = null` → « toutes les apps autorisées » | test : la méta n'est jamais vide quand `R.data.samples > 0` |
| W-E9 | « Distribution » (onglet) | Histogramme à seuils avec repères p50/p75/p95 (`DistributionSeuils`) — la forme compte (P7) | — | — | **backend : manque** B5 (représentation `distribution` absente de `VISUALIZATIONS`, `analytics-schema.ts` L64) | onglet désactivé ; après B5 : `DistributionSeuils` | — | onglet visible, désactivé, raison « représentation non disponible : la lecture en distribution n'est pas encore exposée par l'Explorer (B5) » ; lien « Voir la distribution sur Pages » (`/pages?vital=<variante>`) si `dataset = vitals` | e2e : l'onglet existe, `aria-disabled="true"`, texte de raison présent |

#### 5.21.5 Conservé, et pourquoi ; ce qui disparaît

**Conservé (meilleur que les références)** : exécution explicite par formulaire GET et URL = requête
(`explorer/page.tsx` L3-7) ; budget qui refuse une série de zéros (L114-127) ; changement de jeu par
lien (L9-12) ; dimensions indisponibles proposées désactivées avec raison (L99-108) ; résumé
« Requête appliquée » (`explorerResume`, `explorer-page-params.ts` L157) — il devient le texte
`aria-label` de `QueryPills` ; enregistrement en carte avec révision et « Figer la fenêtre » ; JSON
canonique ; avertissements du jeu propagés.

**Disparaît** : l'invite nue « Rien n'a encore été mesuré » (remplacée par W-E1) ; l'`<aside>`
« Total observé » séparé (fondu dans W-E3 et W-E8, il répétait le total) ; la phrase de « Valeur
unique » qui répétait le total (L411-415) ; les `ObservedTrend` un par groupe à échelles propres
(`Series` L583-605) ; l'option de 10 séries (CE6) ; la représentation dans le formulaire (déplacée en
onglets). **Pas d'ajout de Geomap** : le format de `geo_country` selon la provenance n'est pas établi
(`console-donnees.md` L812-813) ; **pas de camembert** : `Donut` existe mais n'apporte rien de plus
que la part écrite dans W-E4 / W-E7.

### 5.22 Vues enregistrées — `/explorer/views`

#### 5.22.1 Question

« Quelles analyses ai-je gardées, que mesurent-elles, et lesquelles ne se relisent plus ? » — tranchée
par la liste ; question suivante : « rejouer l'une d'elles » (lien = Explorer exécuté).

#### 5.22.2 Référence

**Datadog Saved Views** (vue enregistrée = requête + représentation, modèles fournis en lecture seule,
`datadog-docs-explorer-dashboards.md` § 6) ; **nôtre, conservé** : aucune vue publique, AST rejoué
avec les droits du lecteur, vue illisible conservée et diagnostiquée (`lib/saved-views.ts` L1-14 ;
`app/explorer/views/page.tsx` L1-9). Le partage entre comptes reste hors périmètre (B9, § 3.6).

#### 5.22.3 Grille

1. `PageHeader` (`domain="Explorer"`, `sub` = question) + « ← Explorer ».
2. Bandeaux existants (conflit, refus, plafond, indisponible v79) — inchangés.
3. **« Modèles fournis »** — les 6 analyses de W-E1, lecture seule, badge « fourni ».
4. **« Mes vues »** — table existante, colonnes : Nom (lien) · **Ce qu'elle mesure** (nouveau) · App ·
   Propriétaire · Mise à jour · Actions.

Tout est au-dessus du pli à 1440 jusqu'à ~8 vues. 768 : inchangé. 390 : la table défile
horizontalement (déjà `overflow-x-auto`, L73-76 ; justification écrite dans le code conservée), les
modèles passent en une colonne.

#### 5.22.4 Table des widgets

| Id | Libellé | Type — pourquoi | Donnée | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| W-V1 | « Modèles fournis » | Liste de liens — ne lit rien | `MODELES_EXPLORER` | — | à créer (cf. W-E1) | `ModelesDepart` (mode compact) | clic → Explorer exécuté | — | e2e : 6 liens, aucun bouton de suppression |
| W-V2 | colonne « Ce qu'elle mesure » | Texte court — le nom choisi par l'utilisateur ne dit pas la mesure | « <Jeu> · <Mesure> <agrégation> · <représentation>[ · par <dim>] » | — | à créer : `resumeVue(ast: unknown): { ok: true; texte: string } \| { ok: false; raison: string }` dans `lib/explorer-page-params.ts`, construit sur le même parsing que `explorerHrefFromAst` (L199) | cellule de table | — | AST illisible → la raison existante (L96-99) | test unitaire : un AST du jeu `vitals` produit « Web Vitals · Valeur p75 (LCP) · Classement · par Route » |
| W-V3 | Actions « Renommer » / « Supprimer » | Formulaires existants | — | — | `renameViewAction`, `deleteViewAction` (`app/explorer/actions.ts` L67, L85) | boutons `btn-ghost` ; suppression en deux temps (`<details>` « Supprimer… » puis bouton « Confirmer la suppression ») | clavier | viewer non propriétaire : texte existant « Lecture seule… » (L152-155) ; session démo : aucune action rendue (V9) | grep : plus de `bg-red-600` dans le fichier (CE11) ; e2e démo : aucun bouton d'écriture |

**Conservé** : toute la logique de périmètre et de conflit. **Disparaît** : le bouton rouge (CE11).

### 5.23 Journal `/events` (catégorie Explorer)

**Question.** « Que s'est-il passé exactement, dans quel ordre ? »
**Question suivante.** « Dans quelle session ? » → panneau session.

**Référence.** Datadog RUM Explorer « Lists » : un résultat filtré est toujours accompagné de sa
distribution (histogramme + facettes comptées, `datadog-images-1.md` L436-437). **Nôtre, conservé** :
instantané unique (total, tendance, facettes, liste cohérents, `console-ecrans-1.md` L384), « scrubbed »
dans l'en-tête, partiel dit (migration v65/v68), URL = requête.

#### 5.23.1 Grille

| Ordre | Zone | 1440 | 768 | 390 |
|---|---|---|---|---|
| 1 | En-tête ; formulaire GET (nom, source, clé, type, valeur) | 6 colonnes | 3 | 1 |
| 2 | Bandeaux `partiel` (v65 sans backfill, v68), `echantillonne` | pleine largeur | | |
| 3 | Colonne facettes (3/12) · « Volume du résultat » + total (9/12) | côte à côte | facettes sous le volume, repliées | idem |
| 4 | Table paginée (9/12, sous le volume) | | pleine largeur | cartes |
| — | Panneau `panel=event:<id>` | | | |

#### 5.23.2 Widgets

| Libellé exact | Graphique et pourquoi | Mesure | Src | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|
| Volume du résultat | barres par seau **avec axe daté** (compte discret) | `count(*)` par seau du contrat, seaux vides = 0 | ex. `exploreEvents(f, query, page, cursor).trend` `queries-events.ts:L284`, type L59 | `ThresholdSeries` une série `forme: "barres"`, `additive: true`, sans vital | clic seau → zoom `from/to` | partiel v65 : « journal commencé à v65 sans rattrapage : les événements antérieurs manquent » | axe x étiqueté (défaut actuel : aucune date lisible, `console-ecrans-1.md` L392) |
| Total observé | stat | `total` | ex. | `KpiTile format="count"` neutre | — | 0 → « Aucun événement ne correspond » | même instantané que la liste (test existant conservé) |
| Événements par nom | classement en barres (la facette la plus utile, aujourd'hui cachée dans une datalist) | 20 noms + comptes | ex. `facets.names` L60, L65-80 | `RankBar` avec `href` | barre → `?name=<nom>` | vide → « Aucun nom » | un clic pose le filtre sans ressaisie |
| Attributs fréquents | liste cliquable source · clé · compte | 30 clés | ex. `facets.attributes` | liste de liens | clic → pose `attr_source` + `attr_key` (noms des champs du formulaire existant, CP18) | « Aucune facette primitive » | e2e `tests/e2e/perf-domaine.spec.ts` : un clic produit `?attr_source=…&attr_key=…` et le formulaire les affiche |
| Valeurs | puces sous le champ « Valeur exacte » | `facets.values` | ex. | puces-liens | clic → pose `attr_type` + `attr_value` (CP18) | — | — |
| Table | table ; colonnes : événement, route, appareil (`device_type`, déjà lu), session, date ; **clés communes promues en colonnes** (clé présente sur ≥ 80 % des lignes de la page, calcul pur côté serveur `colonnesPromues(lignes)` dans `lib/perf-domain.ts` ; les valeurs affichées sont celles déjà rendues par la vue actuelle, donc passées par le même nettoyage à l'ingestion — aucune lecture d'attribut brut supplémentaire) | 50 lignes, curseur | ex. `events` (`EventIndexRow` L44-57) | table + `DetailPanel type="event"` | ligne → `panel=event:<id>` ; session → `panel=session:<id>` | « Voir le contexte » dans le panneau, plus en ligne | à 390 px : cartes, date et nom visibles |

`/events` force `kind=event` (`app/events/page.tsx:L35`) : conservé, écrit dans le sous-titre (« événements
custom et signaux émis par le SDK ; les vues et vitals ont leurs écrans »). `PageHeader.domain = "Explorer"`
(§ 2.2). Le paramètre `name` est déjà lu par la page (CP18) : le lien
« Signaux de la route » de `/ux` fonctionne dès aujourd'hui, `route` étant un paramètre du contrat.

### 5.24 Tableaux de bord — liste `/dashboards`

#### 5.24.1 Question

« Quelles cartes je surveille ensemble ? ». Tranchée par : les tableaux existants **et**
les modèles prêts à cloner (l'écran n'est plus vide à la première visite). Question suivante : ouvrir un
tableau, ou cloner un modèle.

#### 5.24.2 Référence

**Datadog** — tableaux prêts à l'emploi « Clone Dashboard » (`datadog-images-2.md` § 2.1 ;
`datadog-docs-explorer-dashboards.md` § 10.1) ; **Grafana** — un tableau = une histoire, groupes titrés
par question, description par panneau, pas de duplication sans changement (`grafana.md` § b.3, b.11,
b.12) ; **nôtre, conservé** : concurrence optimiste, carte illisible conservée, portée propre écrite
sur la carte (`console-ecrans-4.md` § 1.4).

#### 5.24.3 Grille

1. `PageHeader` : `domain="Explorer"`, titre « Tableaux de bord », `sub` = « Quelles cartes surveiller
   ensemble ? Chaque carte est une analyse de l'Explorer ; export CSV et impression par le navigateur. »
   (corrige « exporte en CSV / PDF », `app/dashboards/page.tsx` L36).
2. **« Modèles fournis »** — 4 cartes côte à côte (Performance, Erreurs, Usages, Releases).
3. **« Tableaux de ce périmètre »** — table existante.
4. **« + Nouveau tableau de bord »** — `<details>` existant (ouvert si liste vide, L41).

1440 : modèles sur 4 colonnes, table dessous, tout au-dessus du pli. 768 : modèles 2 × 2. 390 :
modèles en une colonne repliés (titre + bouton), table défilante.

#### 5.24.4 Table des widgets

| Id | Libellé | Type — pourquoi | Donnée | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| W-D1 | « Modèles fournis » : « Performance », « Erreurs », « Usages », « Releases » | 4 cartes texte : titre, question, liste des cartes du modèle — aucune lecture de données (un aperçu chiffré coûterait 24 lectures pour une page de navigation) | contenu figé (voir § 5.24.5) | — | à créer : `lib/dashboard-templates.ts` → `export const MODELES_TABLEAUX: { cle: "performance" \| "erreurs" \| "usages" \| "releases"; titre: string; question: string; sections: { titre: string; question: string; cartes: AnalyticsWidget[] }[] }[]` (widgets construits par `widgetFromPlan`, `lib/dashboards.ts` L261-282) | à créer dans le domaine : `components/dashboards/ModeleCarte.tsx` (§ 4.3) | « Cloner » → à créer : `cloneTemplateAction(fd: FormData)` dans `app/dashboards/actions.ts` = `insertDashboard({ name: "<Modèle> — copie", app_id, layout })` (L119) puis redirection vers `/dashboards/<id>` ; champ App requis (même sélecteur que la création) | bouton absent si `!canCreateDashboard(user, app)` (`lib/dashboard-access.ts` L117) avec la phrase « Création réservée aux comptes autorisés sur une app » ; session démo : aucun bouton (V9) | test unitaire : chaque carte de chaque modèle passe `parseAnalyticsWidget` après `serializeLayout` (aller-retour) et un modèle a ≤ 24 cartes (`MAX_WIDGETS`, `lib/dashboards.ts` L55) ; e2e : « Cloner Performance » crée un tableau dont la page affiche ses sections |
| W-D2 | « Tableaux de ce périmètre » | Table — des enregistrements à trier et ouvrir (Grafana table) | colonnes : Nom (lien, filtres conservés) · **App (libellé, pas `app_id`)** · Propriétaire · **Cartes** (puces du type de chaque carte : « Valeur », « Classement », « Série », « Journal », « v1 : Trafic »… au lieu d'un nombre) · Mise à jour | — | existante : `listDashboards(f)` (`queries-dashboards.ts` L94-105, renvoie `layout`) ; libellés d'app : `registeredApps()` déjà lu par la page (L28-29) | table existante | nom → `/dashboards/<id>` via `hrefWithQuery` | vide → « Aucun tableau de bord dans ce périmètre. Cloner un modèle ci-dessus, ou en créer un vide. » ; `FiltersNotAppliedNote` existante | e2e : la colonne App affiche le nom d'application (« Mini-site de démo »), pas `demo-app` |
| W-D3 | « + Nouveau tableau de bord » | Formulaire existant | — | — | `createDashboardAction` (actions.ts L99) | existant | — | erreurs de création : bandeau `role="alert"` (aujourd'hui aucune erreur en ligne, `console-ecrans-4.md` § 1.3) | e2e : nom vide → message sous le champ |

#### 5.24.5 Contenu des modèles (chaque carte = un plan Explorer existant)

Chaque modèle est écrit en **sections titrées par une question** (Grafana) ; la section est rendue par
`kind: "section"` (F37) ; avant F37, les cartes sont posées dans l'ordre et le titre de section figure
dans le titre de la première carte.

| Modèle | Section (question) | Cartes (titre · plan) |
|---|---|---|
| Performance | « Les vitals tiennent-ils les seuils ? » | « LCP p75 » · `vitals value:p75 LCP value` ; « INP p75 » · idem INP ; « CLS p75 » · idem CLS |
| | « Depuis quand ? » | « LCP p75 dans le temps » · `vitals value:p75 LCP timeseries` ; « INP p75 dans le temps » · idem INP |
| | « Où ? » | « LCP p75 par route » · `vitals value:p75 LCP toplist g0=route 10` ; « INP p75 par navigateur » · `… INP g0=browser 10` |
| Erreurs | « Combien, et qui ? » | « Occurrences » · `errors occurrences:sum value` ; « Sessions touchées » · `errors sessions:distinct value` (tuile séparée : V2) |
| | « Depuis quand ? » | « Occurrences dans le temps » · `errors occurrences:sum timeseries` |
| | « Où ? » | « Occurrences par route » · `… toplist g0=route` ; « Occurrences par release » · `… g0=release` ; carte v1 « Erreurs principales » (`top_errors`) |
| Usages | « Combien ? » | « Sessions commencées » · `sessions started:count value` ; « Visiteurs » · `sessions visitors:distinct value` (tuile séparée, jamais sommée) |
| | « Quand ? » | « Sessions commencées dans le temps » · `sessions started:count timeseries` |
| | « Qui ? » | « Sessions par appareil » · `… toplist g0=device` ; « Sessions par pays estimé » · `… g0=country` ; « Actions par route » · `actions rows:count toplist g0=route` |
| Releases | « La dernière release dégrade-t-elle l'expérience ? » | « LCP p75 par release » · `vitals value:p75 LCP toplist g0=release` ; « INP p75 par release » ; « Occurrences par release » ; « Pages vues par release » · `views rows:count toplist g0=release` (le dénominateur, écrit comme tel) |

Limite dite sur la carte « Releases » : un **taux** d'erreur par release n'est pas exprimable dans
l'Explorer (pas de mesure `ratio`, `console-donnees.md` § 4 ligne « Taux ») ; la carte renvoie vers
`ReleaseCompare` de la Vue d'ensemble (§ 5.1). Les noms de champs (`started`, `visitors`,
`occurrences`, `rows`, `value`, `sessions`) sont ceux de `analytics-schema.ts` L217-550 et doivent être
vérifiés par le test d'aller-retour de W-D1 : si l'un est refusé, la carte est retirée du modèle, pas
contournée.

### 5.25 Tableau de bord — détail `/dashboards/[id]`

#### 5.25.1 Question

« Les cartes que je surveille ensemble disent-elles que tout va bien, sur quelle population ? »
Tranchée par la **barre de population** + la première section. Question suivante : « ouvrir une carte
dans l'Explorer » pour la décomposer.

#### 5.25.2 Référence

**Grafana** pour l'agencement (sections titrées, description, liens de données, variables affichées ;
`grafana.md` § b.8-b.11) ; **Datadog** pour la barre de variables toujours visible, y compris à « tous »
(`datadog-images-2.md` § 2.4) et l'action « ouvrir en requête » par carte ; **nôtre, conservé** :
révision, cartes illisibles en diagnostic, portée propre écrite sur la carte, ordre au clavier.

#### 5.25.3 Grille

1. `PageHeader` : titre = nom ; `sub` = « Scope : <app ou toutes les apps> · Propriétaire : … » ;
   actions : « ← Tous », « Dupliquer » (existant), « Export CSV », « Imprimer » (existant).
2. **Barre de population** (W-B1).
3. Bandeaux existants (conflit, refus, hors périmètre, cartes illisibles) — inchangés.
4. **Sections** (F37) : titre-question `h2`, repliable (`<details open>`), chacune une grille de cartes.
   Sans section : une grille unique.
5. Grille : `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` ; une carte « Série » ou « Journal » occupe
   **toute la largeur de sa rangée** (`md:col-span-2 xl:col-span-3`), une « Valeur » une case. La
   largeur découle du type : aucun champ de taille à stocker (pas de changement de schéma).
6. « Éditer le tableau de bord » (existant) en bas.

1440 : barre + 1re section (3 valeurs + 1 série) au-dessus du pli. 768 : 2 colonnes. 390 : 1 colonne ;
les contrôles d'ordre de chaque carte restent des boutons (existant).

#### 5.25.4 Table des widgets

| Id | Libellé | Type — pourquoi | Donnée | Comparaison | Source | Composant | Interactions | États | Critère |
|---|---|---|---|---|---|---|---|---|---|
| W-B1 | « Population lue » | Ligne de texte à puces — chaque carte hérite de cette population, il faut la voir même à « tous » | app effective, `rangeLabel` résolu, appareil, chaque condition du segment, « robots exclus » / « internes exclus », fuseau d'axe (UTC) | — | existante : `ecran.query` + `explorerResume`-like ; à créer : `resumePopulation(query: AnalyticsQuery, timeZone: string): string[]` dans `lib/explorer-page-params.ts` (réutilise `OPERATEURS`, L147) | à créer : `components/PopulationBar.tsx` (§ 4.2) | chaque puce de condition = lien qui la retire | hors périmètre → bandeau existant | test unitaire : une requête sans condition rend « tous les visiteurs · robots exclus » ; e2e : puce retirable |
| W-B2 | Carte v2 « Valeur » | `KpiTile` (verdict **seulement selon R-V** : p75 d'un vital ; `avg` / `p95` → tuile neutre ; couverture n) | `R.data.total`, `samples` | `cmp=prev` (défaut `none` sur ce domaine, § 3.1) : second appel pour les cartes « Valeur » seulement ; les autres cartes disent « comparaison non calculée pour cette forme » | existante : `resolveWidget` → `exploreAnalytics` (`widget-data.ts` L280-316) ; **modifier** `WidgetData` pour transporter `total: number \| null`, `samples`, `vital?`, `precedent?` au lieu de chaînes formatées | à créer dans le domaine : `components/explorer/ResultatAnalyse.tsx` (§ 4.3), partagé avec l'Explorer (W-E3 à W-E6) | en-tête de carte : « Ouvrir dans l'Explorer » = `explorerHrefFromAst(widgetQueryJson(w))` (L199 ; L350) | `null` → « — » + raison ; erreur → carte « Mesure indisponible » + raison (existant `WidgetBody.tsx` L12-22) + bouton « Réessayer » | test unitaire (`tests/unit/widget-data.test.ts`) : `resolveWidget` sur un total `null` transporte `null`, pas « — » (le formatage se fait au rendu) ; carte `vitals value:avg LCP` → aucun badge de verdict dans le rendu |
| W-B3 | Carte v2 « Classement » | `RankBar` (additif) / `ImpactTable` compacte (non additif) — même règle que W-E4 | `R.data.groups` | écart au total (non additif) ; couleur de verdict seulement selon R-V | existante ; **corriger** CE2 | `ResultatAnalyse` | clic sur une ligne → Explorer filtré (même règle § 3.3) | valeur `null` → « — » en fin de liste | test : aucun `?? 0` dans `widget-data.ts` (grep) ; rendu d'un groupe `null` = « — » |
| W-B4 | Carte v2 « Série » | `ThresholdSeries` / `StackedBars` — même règle que W-E5 ; bandes seulement selon R-V | `R.data.series`, ≤ 5 groupes | annotations de déploiement (B1 : preset seulement) | existante ; **corriger** CE1 : `WidgetSeriesGroup.values: (number \| null)[]`, `null` conservé, export CSV écrit une cellule vide pour `null` (L479) | `ResultatAnalyse` ; `WidgetChart.tsx` retiré au profit de `ResultatAnalyse` | zoom par seau vers l'Explorer (pas vers le tableau : un tableau n'a pas de plage propre à changer au clic) | seau `null` = trou | test unitaire : série p75 avec un seau vide → `values[i] === null` ; CSV : cellule vide, pas « 0 » ; carte `vitals value:p95 LCP` en série → aucune bande |
| W-B5 | Carte v2 « Journal » | Table (existante) | `R.data.rows` | — | existante | table | — | — | inchangé |
| W-B6 | Carte v1 « <Vital> p75 » (`vital_p75`) | `KpiTile` avec verdict et `n` (corrige CE4) | `vitalsP75(f)` → `p75`, `p50`, `n` (`queries.ts` L46) | `vitalsP75(f, true)` pour `precedent` quand `cmp=prev` | existante | `KpiTile` | — | `n = 0` → « — » « aucune mesure de <vital> sur <plage> » ; `p75 = null` avec `n > 0` → « — » « percentile non calculable » ; exception → erreur (CE3) | test : `n = 0` rend « aucune mesure », pas « aucune donnée » |
| W-B7 | Carte v1 « Trafic » (`traffic`) | **Deux panneaux empilés** partageant l'axe x : pages vues (barres), occurrences d'erreurs (barres) ; dernière barre (journée en cours, incomplète) marquée creuse avec la légende « journée en cours » (`queries-grid.ts` L118-121 : la série se termine sur `date_trunc('day', now())`) — deux populations, deux axes (P5) ; remplace le tableau Jour / Pages vues / Erreurs (`widget-data.ts` L339-347) | `dailyTraffic(f)` (`queries-grid.ts` L110) : 14 jours fixes, jour découpé dans le fuseau de l'app | — | existante | `ThresholdSeries` ×2 (hauteur 120, une série `forme: "barres"` chacun, sans `vital`) | — | méta obligatoire « 14 jours fixes (13 complets + la journée en cours), quelle que soit la plage de l'écran ; jours dans le fuseau de l'app » (`console-donnees.md` § 5 inv. 22 ; surface `/dashboards/:id`) | e2e : la carte affiche « 14 jours fixes » et « journée en cours » |
| W-B8 | Carte v1 « Routes lentes » (`slow_routes`) | `ImpactTable` compacte (tri gravité LCP, colonnes INP p75, CLS p75, vues) — un classement de percentiles | `slowRoutes(f)` (`queries.ts` L207) : `RouteRow` porte `lcp_p75`, `inp_p75`, `cls_p75`, `views` (`console-ecrans-4.md` § 1.6) | écart au LCP p75 de l'app : `vitalsP75(f)` | existante | `ImpactTable` | ligne → `/pages?route=…` (panneau route après F07) | — | test : 8 lignes max, `cls_p75` affiché |
| W-B9 | Carte v1 « Erreurs principales » (`top_errors`) | Liste à `Sparkline` + occurrences + sessions + statut | `listErrorGroups(f, { limit: 8, offset: 0 }, { series: true })` (`queries-errors.ts` L825-829 ; `series?: number[]` L181) | tendance (sparkline) | existante (option `series` non utilisée aujourd'hui, `widget-data.ts` L353) | `Sparkline` + lignes | ligne → `/errors?panel=error:<fingerprint>` (§ 3.3) | échantillonnage → `EtatSurface echantillonne` (`sampling` renvoyé par `listErrorGroups`) | test : chaque ligne a une sparkline ou « pas assez de points » |
| W-B10 | Carte v1 « Frustration » (`frustration`) | Table conservée (type × cible × route × occurrences) — la cible est un texte long, un classement en barres la tronquerait | `topFrustrations(f)` (`queries-frustration.ts` L19) | — | existante (après F02, plus de `softFail` silencieux) | table | ligne → `/ux?route=…` | — | — |
| W-B11 | Carte v1 « Événement » (`event_count`) | `KpiTile` | `eventCount(f, name)` (`queries-events.ts` L407) | — | existante | `KpiTile` | — | `available = false` → « Non collecté » + diagnostic ; échantillonnage → note existante | — |
| W-B12 | Titre de section | `h2` + phrase-question, repliable | `kind: "section"` | — | **à créer** : dans `lib/dashboards.ts`, `interface SectionWidget { kind: "section"; title: string; question: string }` ajoutée à l'union `Widget` (L106), lue par `lireWidget` (L306-322) et écrite par `serializeLayout` (L378-399) ; pas de migration (la colonne `layout` est déjà une liste de widgets sérialisés) ; **règle fixée : une section compte dans `MAX_WIDGETS`** (24, `lib/dashboards.ts` L55), pour ne pas changer la borne de lecture ; un modèle de F35 reste donc ≤ 24 éléments, sections comprises | `<details open>` | « Ajouter une section » (formulaire d'édition) : rendu seulement si `canMutateDashboard(user, dashboard)` (`lib/dashboard-access.ts` L126), donc jamais pour un viewer non propriétaire ni une session démo (V9) ; l'action serveur refait la même vérification | un lecteur plus ancien lira une section comme une carte illisible (diagnostic, rien de perdu) | test aller-retour `serializeLayout` / `normalizeLayout` d'une section (`tests/unit/dashboards.test.ts`) ; 24 cartes + 1 section → refus au même titre que 25 cartes ; e2e démo : pas de formulaire « Ajouter une section » |

#### 5.25.5 Conservé / disparaît

**Conservé** : `resolveWidgets` par vagues de 4 (`WIDGET_CONCURRENCY`, L40) ; cache de 10 s ;
cartes illisibles ; conflits de révision ; portée propre de la carte (`WidgetCard.tsx` L9-11) ;
« Monter — 2 sur 5 » ; export CSV plafonné et annoncé.
**Disparaît** : `WidgetChart.tsx` (remplacé par `ResultatAnalyse`) ; les tableaux utilisés pour
`traffic` et `slow_routes` ; la grille figée à 2 colonnes ; le `catch { return EMPTY }` (CE3).

---

## 6. Sous-lots F00–F69

Tailles : S ≤ 1 jour, M ≤ 3 jours, L ≤ 5 jours (estimations, non mesurées). Chaque lot se termine par
la définition de « fait » du § 0.4. Plages : **F00–F09** fondations ; **F10–F29** performance (Vue
d'ensemble, Pages, Erreurs et issues, Interactions, Satisfaction, Journal) ; **F30–F39** exploration
(Explorer, Vues, Tableaux de bord, Mobile) ; **F40–F54** usages (Sessions, détail et rejeu, Parcours,
Formulaires, Acquisition, Rétention, Carte) ; **F55–F69** fiabilité et robot (Corrélation, Tracing,
Conversions, SLO, Alertes, Tendances). Les épiques ont leurs propres sous-lots (P*.n au § 7, P**.n au
§ 8), placés dans l'ordre global au § 6.2.

Un lot marqué d'un `Bn` se livre **avec** l'état « non disponible, raison : … » du widget concerné si le
patch n'est pas prêt ; il ne l'attend pas, sauf mention contraire (F39, F53, F68).

### 6.1 Table récapitulative

Dérivée des tables de détail (§ 6.4, § 6.5) : en cas d'écart, le détail fait foi.
| Lot | Titre | Dépend de | Taille | Fichiers de test | Preuve de fin |
|---|---|---|---|---|---|
| **F00** | Corrections de vérité et outillage | — | M | `tests/unit/deploys.test.ts` ; `tests/unit/glossary.test.ts` ; `tests/unit/goals.test.ts` ; `tests/unit/queries-actions.test.ts` | `pnpm --filter console typecheck` existe et passe ; `grep -rn "seuils 2026" apps/console` vide ; captures `01`, `09`, `20`, `21`, `24` relues ; liens web.dev relus notés dans la PR |
| **F01** | Palette et contraste | F00 | M | `tests/e2e/theme-contraste.spec.ts` ; `tests/unit/palette.test.ts` | `grep -rn "emerald-\|amber-\|red-[0-9]" apps/console/{components,app}` vide hors `lib/palette.ts` ; contraste calculé ≥ 4,5:1 sur les paires texte, mesuré par `@axe-core/playwright` (règle `color-contrast`), intégré à l'e2e de capture claire / sombre de ce lot |
| **F02** | États | F00 | L | `tests/e2e/etats.spec.ts` ; `tests/unit/EtatSurface.test.tsx` ; `tests/unit/lecture.test.ts` | `find apps/console/app -name error.tsx` couvre toutes les routes du § 2.2 ; `grep -rn "softFail" apps/console/lib` vide ou limité à des lectures hors périmètre, listées dans la PR |
| **F03** | Figure, tuiles, sparkline, vitrine de composants | F01, F02 | M | `tests/unit/fmt-ids.test.ts` ; `tests/unit/{KpiTile,KpiLibelle,Sparkline,Figure}.test.tsx` | `/admin/composants` à 390 et 1440 sans débordement ; texte exact « pas de mesure de référence non nulle » rendu pour `precedent: 0` |
| **F04** | Séries | F03 | L | `tests/e2e/series.spec.ts` ; `tests/unit/ThresholdSeries.test.ts` ; `tests/unit/series.test.ts` | `grep -rn yAxisId apps/console/components/charts` vide ; capture `01` refaite : bandes visibles, plus de double axe |
| **F05** | Distributions, classements, fuseaux | F03 | L | `tests/unit/HealthHeatmap.test.tsx` ; `tests/unit/fuseau.test.ts` ; `tests/unit/impact.test.ts` | e2e : `tri=volume` / défaut gravité sur `/` ; heatmap sans vert / ambre / rouge (capture) |
| **F06** | État de vue dans l'URL et comparaison | F00 | M | `tests/integration/comparaison-sql.test.ts` ; `tests/unit/comparaison.test.ts` ; `tests/unit/view-state.test.ts` | e2e : `cmp=release` survit à un changement d'onglet ; `queryFingerprint` inchangé ; une plage personnalisée de 30 jours n'affiche aucun delta sur `/` |
| **F07** | Panneau et cascade | F03, F06 | L | `tests/e2e/panneau.spec.ts` ; `tests/unit/Cascade.test.tsx` | capture `18` refaite |
| **F08** | Vues préréglées, constats, releases, annotations | F05, F06 | L | `tests/unit/InsightStrip.test.tsx` ; `tests/unit/annotations.test.ts` ; `tests/unit/presets.test.ts` | e2e : appliquer « Mobile » ne modifie que `device` |
| **F09** | Navigation et coquille | F06 | M | `tests/unit/nav-items.test.ts` ; `tests/unit/surfaces.test.ts` | tous les écrans du § 2.3 atteignables depuis la nouvelle navigation ; aucune route cassée (`pnpm test:e2e` vert) |
| **F10** | Lectures partagées du domaine | F00, F04 (`alignerSeaux`), F05 | M | `tests/integration/perf-lectures-sql.test.ts` ; `tests/unit/impact.test.ts` ; `tests/unit/perf-domain.test.ts` | `pnpm test:sql` vert ; `grep -rn "reduce" apps/console/app` ne trouve aucun cumul de `p75` |
| **F11** | Vue d'ensemble : santé, KPI, constats | F03, F06, F08, F10 ; F62 et F67 (§ 5.19) pour les constats d'alerte par événement seulement (repli écrit avant) | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/unit/HealthBanner.test.tsx` ; `tests/unit/perf-domain.test.ts` | capture 1440 : hero commence au-dessus du pli ; aucun « % » sur la tuile d'erreurs |
| **F12** | Vue d'ensemble : hero CWV et « Charge, erreurs et LCP » | F04 (`StackedBars` sur grille), F10 | M | `tests/e2e/perf-domaine.spec.ts` | `grep -rn yAxisId apps/console/components/charts` vide |
| **F13** | Vue d'ensemble : segments, release, angle mort, historique | F05, F08, F10 ; **F57** (§ 5.7) pour la tuile d'angle mort | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/integration/perf-lectures-sql.test.ts` ; `tests/unit/fuseau.test.ts` | captures 1440/390 ; `grep -n "blindSpots" apps/console/app/page.tsx` vide |
| **F14** | Pages : KPI, sélecteur de vital, hero classé | F05, F06, F10 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/unit/perf-domain.test.ts` | une seule liste de routes sur l'écran |
| **F15** | Pages : distributions, percentiles, TTFB, type de navigation | F05 | S | `tests/e2e/perf-domaine.spec.ts` ; `tests/unit/perf-domain.test.ts` | phrase « leur somme n'est pas le TTFB » présente |
| **F16** | Pages : tâches longues et ressources | F02, F04 | S | `tests/e2e/perf-domaine.spec.ts` | — |
| **F17** | Panneau route | F07, F10, F14 ; F57 pour la ligne « Heures en angle mort » | L | `tests/e2e/perf-domaine.spec.ts` | capture panneau ouvert 1440 et 390 |
| **F18** | Erreurs : KPI, hero, répartition | F03, F04 (`StackedBars.annotations`), F10 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/integration/perf-lectures-sql.test.ts` ; `tests/unit/perf-domain.test.ts` | hero : ≤ 5 séries |
| **F19** | Erreurs : liste et filtre de statut | F03 (`Sparkline.max`), F18 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/unit/Sparkline.test.tsx` | capture 390 |
| **F20** | Détail d'erreur (panneau et page) | F07, F10, F18 | L | `tests/e2e/perf-domaine.spec.ts` ; `tests/integration/perf-lectures-sql.test.ts` | capture 04 refaite (plus de 404 anglais) |
| **F21** | Issue v2 alignée | F20 | S | `tests/e2e/error-issues.spec.ts` ; `tests/e2e/error-tracking.spec.ts` | — |
| **F22** | Interactions : onglets, Frustration KPI, règles, hero | F02, F05, F09, F10 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/integration/perf-lectures-sql.test.ts` ; `tests/unit/frustration-regles.test.ts` | capture 05 refaite |
| **F23** | Interactions : INP et scripts | F04, F22 (`ScatterPlot.etiquettes`) | S | `tests/e2e/perf-domaine.spec.ts` | — |
| **F24** | Onglet Actions | F00, F03, F22 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/unit/queries-actions.test.ts` | capture 06 refaite |
| **F25** | Journal | F04, F07 | M | `tests/e2e/events-explorer.spec.ts` ; `tests/unit/perf-domain.test.ts` | capture 07 refaite |
| **F26** | Satisfaction | F00, F04, F05, F10 | M | `tests/e2e/perf-domaine.spec.ts` ; `tests/integration/perf-lectures-sql.test.ts` ; `tests/unit/experience.test.ts` | capture 09 refaite |
| **F27** | Recette transverse du domaine | F11-F26 | M | e2e cités dans le détail | CI verte ; `grep` du P2 vide sur `app/{,pages,errors,ux,actions,events,experience}` ; `grep -rn "fired=" apps/console/components apps/console/lib/presets.ts` vide ; `grep -rn "blindSpots" apps/console/app/page.tsx apps/console/components/perf` vide |
| F28-F29 | réservés | — | — | — | — |
| **F30** | Vérité du domaine | F00, F02 | S | e2e cités dans le détail | `grep -n "?? 0" lib/widget-data.ts` ne renvoie rien sur des valeurs de mesure ; `tests/e2e/mobile-console.spec.ts` vert |
| **F31** | Explorer : requête lisible et départ | F03, F06 | M | e2e cités dans le détail | capture 08 refaite : 6 analyses de départ visibles, formulaire ouvert |
| **F32** | Explorer : représentations | F04, F05, F31 | L | `tests/e2e/analytics-explorer.spec.ts` ; `tests/unit/ResultatAnalyse.test.tsx` ; `tests/unit/explorer-page-params.test.ts` | e2e P8 : clic sur la 1re barre d'un classement ajoute la condition et garde `period` |
| **F33** | Explorer : contexte et répartition | F32 | M | e2e cités dans le détail | e2e `split=browser` : la 1re barre filtre |
| **F34** | Vues enregistrées | F31 | S | e2e cités dans le détail | liste montrant la colonne « Ce qu'elle mesure » |
| **F35** | Tableaux de bord : modèles | F30 | M | e2e cités dans le détail | capture 25 refaite : 4 modèles visibles |
| **F36** | Tableau de bord : cartes | F32, F30 | L | `tests/e2e/dashboards-analytics.spec.ts` ; `tests/unit/widget-data.test.ts` | CSV exporté : cellules vides pour `null` |
| **F37** | Sections de tableau de bord | F35, F36 | M | `tests/unit/dashboard-actions-access.test.ts` ; `tests/unit/dashboards.test.ts` | tableau cloné depuis un modèle affiché en sections titrées |
| **F38** | Mobile : réagencement et stabilité par release | F03, F05 (`ImpactTable`, dont `tri="fourni"`), F08, F30 | L | `tests/e2e/mobile-console.spec.ts` ; `tests/integration/rum-mobile-par-release-sql.test.ts` ; `tests/unit/EtenduePercentiles.test.tsx` ; `tests/unit/presets.test.ts` ; `tests/unit/rum-mobile-p75.test.ts` | capture 10 refaite : KPI et hero « Stabilité par release » au-dessus du pli, matrice en fin ; sur la démo sans session RN, le hero montre l'état vide motivé (non établi : aucune session RN réelle, parity C7) |
| **F39** | Mobile : dans le temps | F38, B8 | S | `tests/e2e/mobile-console.spec.ts` | série rendue sur la cohorte React Native (`seg=v2:runtime:eq:react_native`) |
| **F40** | Vérité et périmètre du domaine | F00, F02 | L | `tests/unit/cohorts.test.ts` ; `tests/unit/echantillonnage.test.ts` ; `tests/unit/funnel.test.ts` ; `tests/unit/map.test.ts` | e2e périmètre vert ; `grep -n "convFromStart: start > 0 ? r / start : 0" apps/console/lib/funnel.ts` vide |
| **F41** | Sessions : KPI, volume, répartition | F03, F04 (`SerieDef.forme`), F05, F06 | M | `tests/e2e/usages-sessions.spec.ts` ; `tests/unit/queries-sessions.test.ts` | capture 11 refaite : KPI + hero au-dessus du pli ; plus d'`ObservedTrend` sur l'écran |
| **F42** | Sessions : priorité et table | F41, **B30** (sinon états « à créer ») | L | e2e cités dans le détail | e2e vert avec et sans B30 (états motivés) |
| **F43** | Sessions : panneau | F07, F42 | M | `tests/e2e/usages-sessions.spec.ts` | `grep -n "export function PanneauSession" apps/console/components/sessions/PanneauSession.tsx` rend une ligne et le composant n'est importé que par `app/sessions/page.tsx` |
| **F44** | Détail : en-tête, résumé, onglets | F03, F07 | M | e2e cités dans le détail | capture 12 refaite |
| **F45** | Détail : déroulé groupé par vue | F44, B32 (liens) | L | e2e cités dans le détail | plus aucune ligne « Vital RTT » sur la session de démo |
| **F46** | Détail : cascade et Web Vitals situés | F45, F04, F05, F07 | M | `tests/unit/deroule.test.ts` | ouverture d'une session de démo de plus de 7 jours : la méta ne contient pas « 7 derniers jours » |
| **F47** | Détail : rejeu synchronisé | F45, B36 | L | e2e cités dans le détail | vidéo de démonstration interne ; `tests/unit/replay-masquage.test.ts` toujours vert |
| **F48** | Acquisition | F40, F03 ; B31 pour A4, A6 | M | e2e cités dans le détail | capture 13 refaite |
| **F49** | Rétention | F40, F01 (`SEQUENTIELLE`), F03 (`LineTrend.series`, `MatriceCohortes`) | M | `tests/unit/cohorts.test.ts` | capture 14 refaite |
| **F50** | Parcours | F40, F03 ; B31 (ancrage, parts), B33 (étapes typées) | L | e2e cités dans le détail | capture 15 refaite ; aucune part calculée sur un top N |
| **F51** | Formulaires | F40, F03, F05 ; B34 (série, sessions) | M | `tests/unit/form-analytics.test.ts` | capture 16 refaite avec données (jeu de démo à ajouter : `demo/` — **non établi** qu'il contienne des événements `form.*`) |
| **F52** | Carte | F40, F05, F07 (type de panneau `noeud`) ; B37 | M | e2e cités dans le détail | capture 19 refaite (vide et non vide) |
| **F53** | Écrans d'usage sur le contrat | B31, F48, F50, F51 | M | e2e cités dans le détail | `grep -n "now() - interval" apps/console/lib/queries-{acquisition,paths,funnel,form-analytics}.ts` vide |
| **F54** | États et largeurs du domaine | F41–F52 | M | e2e cités dans le détail | `find apps/console/app/{sessions,acquisition,retention,paths,forms,map} -name error.tsx` rend 7 fichiers |
| **F55** | Vérité du domaine | F00 (pour ne pas refaire ses corrections de libellés) | S | `tests/e2e/fiabilite.spec.ts` ; `tests/unit/correlation.test.ts` ; `tests/unit/forecast.test.ts` ; `tests/unit/slo.test.ts` | capture `24-forecast.png` refaite : l'écran s'affiche ; `grep -n "2500" apps/console/app/forecast apps/console/lib/queries-v2.ts` vide |
| **F56** | Composants du domaine | F03 ; `SERIE_MARGES` exporté par `ThresholdSeries` (F04) | M | `tests/unit/{BudgetBars,FriseDeclenchements,MatriceConcordance,FriseEtats}.test.tsx` | page `/admin/composants` montrant chaque état de chaque composant, à 390 et 1440 sans débordement |
| **F57** | Lectures Robot et réel | F55 | M | `tests/integration/correlation-sql.test.ts` ; `tests/unit/correlation-serie.test.ts` | `GET /api/v1/correlation` inchangé (test de contrat `api-v1-contract.test.ts` vert) |
| **F58** | Écran Corrélation | F04 (dont `grille`, `effectifCle`), F08 (annotations), F56, F57 | L | `tests/e2e/fiabilite.spec.ts` | capture `20-correlation.png` refaite : hero (deux panneaux) + matrice au-dessus du pli à 1440 × 900 ; plus de « écart −90 % » |
| **F59** | Lectures Tracing | — | M | `tests/integration/tracing-sql.test.ts` ; `tests/unit/tracing-ancres.test.ts` | `GET /api/v1/tracing` inchangé |
| **F60** | Écran Tracing | F04, F59 | M | `tests/e2e/tracing.spec.ts` ; `tests/unit/tracing-hero.test.ts` | capture `17-tracing.png` refaite avec des spans seedés |
| **F61** | Détail de trace | F07, F59 | S | `tests/e2e/tracing.spec.ts` | capture `18-trace-detail.png` refaite |
| **F62** | Lectures SLO et alertes | F55 | M | `tests/integration/alertes-sql.test.ts` | `pnpm test:alerting` (`scripts/verify-alerting.mjs`) vert |
| **F63** | Écran SLO | F56, F62 | M | `tests/unit/BudgetBars.test.tsx` | capture `22-slo.png` refaite avec 3 SLO seedés (tenu, dépassé, non mesurable) |
| **F64** | Écran Alertes | F56, F62 | L | e2e cités dans le détail | capture `23-alerts.png` refaite ; le widget « Votre avis ? » ne recouvre plus les KPI (réserve basse F09) |
| **F65** | Écran Tendances | F04 (`bande`, `role:"projection"`, `forme`), F05 (`lib/fuseau.ts`), F55 | M | `tests/integration/grille-sql.test.ts` ; `tests/unit/forecast-liens.test.ts` ; `tests/unit/forecast.test.ts` | capture `24-forecast.png` refaite |
| **F66** | Écran Conversions | F03, F00 (`conversionRate` → `null`), F40 (refus provisoire, jusqu'à ce lot) | M | `tests/e2e/usages-perimetre.spec.ts` ; `tests/integration/goals-sql.test.ts` ; `tests/unit/goals.test.ts` | capture `21-goals.png` refaite avec 3 objectifs ; `grep -n "is null or app_id = \\$1\|is null or p.app_id\|is null or ev.app_id" apps/console/lib/queries-goals.ts` vide |
| **F67** | Annotations d'alerte et liens croisés | F08, F62 | S | `tests/unit/annotations.test.ts` | e2e : clic sur une annotation d'alerte → `/alerts?evt=<id>` avec l'événement mis en évidence |
| **F68** | Règle de régression de release (interface) | F64, **B52** | S | e2e cités dans le détail | — |
| **F69** | Recette du domaine | F58-F66 | M | e2e cités dans le détail | 21 captures (7 routes × 3 largeurs) déposées dans le dossier de captures de la PR |

### 6.2 Ordre global

**Neuf vagues, de 0 à 8, et rien en dehors.** Chaque lot du plan, épique P* et site P** compris, est
rangé dans une vague : il n'existe plus de file parallèle. Les dépendances réelles de chaque lot sont
dans sa ligne ; cet ordre les respecte. **Chaque vague se termine par une revue** (conformité au plan et
revue adverse du code) avant que la suivante commence ; les corrections de revue partent dans les PR de
la vague (règle posée le 22/09/2026). À l'intérieur d'une vague, un lot commence quand les lots dont il
dépend sont fusionnés.

L'ancienne « vague 0 bis » (F55 et l'incrément 0 de P*) est devenue la **tête de la vague 1** : F55 y
passe en premier parce que `/forecast` plante au rendu et que F57, F59 et F62 en dépendent.

| Vague | Lots | Conditions |
|---|---|---|
| 0 — tout de suite | **F00** ; **P**.1** (corrections de vérité de la vitrine, sur `master`) ; **P**.0** (document de couverture lisible par le code, sans effet visible) | aucune |
| 1 | **F55** (écran `/forecast` en panne, formats et libellés) et **P*.incrément 0** (0-a `lib/stats`, 0-b intervalle sur `VitalCard`, 0-c santé « non testable ») en tête ; puis **F01**, **F02**, **F06** ; lectures **F57**, **F59**, **F62** (après F55) ; **F40** (vérité et périmètre des écrans d'usage : le refus `app=all` passe avant tout style) ; **F30** (vérité du domaine exploration) | F00 (et F02 pour F40, F30 ; F55 pour F57, F59, F62) |
| 2 | **F03** | F01, F02 |
| 3 | **F04**, **F05**, **F07** en parallèle ; **F31** (Explorer : requête lisible) | F03 (+ F06 pour F07, F31) |
| 4 | **F08** ; **F09** ; **F10** (lectures partagées performance) ; **F56** (composants fiabilité) ; **P*.1** (intervalle sur chaque chiffre clé) ; **P*.9** (récit de session) | F05 + F06 (F08) ; F06 (F09) ; F04 + F05 (F10) ; F03 + F04 (F56) ; incrément 0 + F03 + F05 (P*.1) ; F07 (P*.9) |
| 5 — écrans | performance **F11–F16**, **F18**, **F22**, **F25**, **F26** ; exploration **F32**, **F34**, **F35**, **F38** ; usages **F41**, **F44**, **F48**, **F49** ; fiabilité **F58**, **F60**, **F61**, **F63**, **F65**, **F66** ; épique **P*.2**, **P*.3**, **P*.4**, **P*.5** | lignes de dépendances de chaque lot ; F13 attend F57 pour sa seule tuile d'angle mort ; P*.1 (P*.2 à P*.5), F02 (P*.2), F04 + F08 (P*.3, P*.5), F04 (P*.4) |
| 6 | **F17**, **F19**, **F20**, **F23**, **F24** ; **F33**, **F36** ; **F42**, **F45**, **F50**, **F51**, **F52** ; **F64** ; **F67** ; épique **P*.6** (après B3, livré avec F20), **P*.7**, **P*.8** | idem ; P*.3 (P*.7, P*.8) ; B3 (P*.6) |
| 7 | **F21** ; **F37** ; **F43**, **F46**, **F47** ; **P**.10** (nouveau relevé du document de couverture, sur `master`) puis P**.2 → (P**.3, P**.4, P**.5, P**.6) → P**.8 sur la branche `presentation/refonte`, puis **une** PR de bascule | idem ; § 8.4 ; P**.10 avant P**.2 |
| 8 — clôture | **F27**, **F54**, **F69** (recettes transverses de domaine) ; **F53** après B31 ; **F39** après B8 ; **F68** après B52 ; **P**.7** (captures) après F04, F09, F21 ; **P**.9** (README) après P**.0 et P**.3 ; épique **P*.10** (doublons d'issues), seulement si le regroupement v2 est activé sur au moins une application | backend et fondations cités ; B60 (P*.10), B61 (P*.8), B62 (P*.5) |

### 6.3 Registre unique des dépendances backend

Plages : **B1–B9** transverses ; **B10–B19** performance ; **B20–B29** exploration (vide : la lecture
`mobileParRelease` est une requête livrée dans F38) ; **B30–B49** usages ; **B50–B59** fiabilité et
robot ; **B60–B69** épiques. Aucun identifiant n'est réutilisé. Une ligne « Migration : oui » demande
l'accord explicite de l'utilisateur avant d'être écrite (le backend est jugé solide et n'est patché qu'au
besoin) ; les autres sont des requêtes sans migration, avec un test d'intégration sur la base de
démonstration et un test de périmètre (viewer restreint, `apps = []`).

| Id | Patch | Forme | Migration | Débloque | Attendu par |
|---|---|---|---|---|---|
| B1 | `listDeploys` sur le contrat | `listDeploys(f: FiltersLike, limit)` sur `sqlContext`, fenêtre `[from, to)` | non | annotations de déploiement sous plage personnalisée | F08, F12, F16, F58 (message avant) |
| B2 | mesures « Mauvais » par groupe | `vitalsBreakdown` renvoie `lcp_poor`, `inp_poor`, `cls_poor` (la colonne `rating` existe) | non | `tri=impact` | F05, F13, F14 (`triHref.impact = null` avant) |
| B3 | dénominateurs par groupe | `errorsBreakdown` et `vitalsBreakdown` renvoient, par valeur de dimension, sessions ou mesures de la population de base | non | `ContrastBars`, P*.6 | F20 (repli sur 100 occurrences avant), P*.6 |
| B4 | séries par groupe d'erreurs dans l'API | `GET /api/v1/errors?series=1` | non | séries par groupe hors page serveur | — (API) |
| B5 | représentation `distribution` dans l'Explorer | `VISUALIZATIONS` + lecture d'histogramme (`lib/analytics-schema.ts:L64`) | non | onglet « Distribution » (W-E9), distribution dans les tableaux | F32 (onglet désactivé avant) |
| B6 | historique de `slo_status()` | table horaire alimentée par le planificateur | **oui** | burn-down « Consommation du budget dans le temps » (SL4) | F63 (état « Non collecté » avant) |
| B7 | existence du rejeu par session | absorbé par B30 | — | — | — |
| B8 | dimensions de lecture `runtime`, `browser_version`, `os_version`, `net_type` | ajout au registre de dimensions du contrat (colonnes présentes : `runtime` v82, `net_type` v53) | non | séries mobiles (W-M10), INP par version de navigateur, type de réseau | F39 |
| B9 | vues partagées entre comptes | segment d'écran enregistré côté serveur | **oui** | partage de vues | — (reporté) |
| B10 | classement sans coupe par volume | `vitalsBreakdown(f, dim, cap, ordre?: "volume" \| "lcp" \| "inp" \| "cls")` | non | classement gravité exact au-delà de 200 groupes | F13, F14 (repli : `cap = 200` + troncature dite) |
| B11 | FCP et TTFB dans le découpage | `vitalsBreakdown` renvoie `fcp_n`, `ttfb_n`, `fcp_p75`, `ttfb_p75` | non | classement des routes par FCP / TTFB | F14 (onglet désactivé avec raison avant) |
| B12 | découpage de la période précédente | `vitalsBreakdown(…, shift?)`, même patron que `vitalsP75(f, shift)` | non | delta de la tuile « Routes au-delà de Bon » | F14 |
| B13 | distribution dans le temps | `vitalHistogram` par seau | non | heatmap de distribution du LCP | — (reporté, § 1.7) |
| B30 | signaux par session et classement | `sessionsAPrioriser(f, limit = 10)`, `signauxDeSessions(appIds, ids)`, `sessionsAvecSignaux(f)`, option `avec` de `listSessions` ; rejeu = `exists(replay_chunk …)` (la **durée** de rejeu n'est pas proposée : `replay_chunk.created_at` est l'heure de réception) | non | hero « À regarder d'abord », colonnes Frustration / Rejeu, filtres rapides | F41, F42 |
| B31 | lectures d'usage sur le contrat | `acquisition`, `routeTransitions`, `entryExitRoutes`, `availableEvents`, `funnelReport`, `formEvents`, `retentionCohorts` passent à `FiltersLike` + `sqlContext(f).where(…)` ; `acquisition` sélectionne `p.route` ; `acquisitionSerie(f)` ; option `depuis` de `routeTransitions` ; surfaces en `range: "custom"` (rétention : `range: "none"`) | non | fin de la fuite `app=all`, plage personnalisée, tablette, « Inconnu », `cmp=prev` | F48, F50, F53 |
| B32 | chronologie enrichie | `sessionTimeline(id)` renvoie `occurrences`, `fingerprint` (erreur), `trace_id` (appel API) | non | tuile Occurrences, liens sortants | F44, F45 |
| B33 | étapes d'entonnoir typées | `funnelReport(f, steps: {type: "evenement" \| "vue" \| "action"; nom: string}[])` | non | entonnoir « /panier → clic Payer → purchase » | F50 |
| B34 | événements de formulaire horodatés | `formEvents` renvoie `ts`, `session_id` | non | « Abandons dans le temps », sessions qui ont abandonné | F51 |
| B35 | sessions hors matrice de rétention | `sessionsSansIdentifiant(f, weeks)` | non | tuile « Sessions sans identifiant, hors matrice » | F49 |
| B36 | segments de rejeu illisibles comptés | `GET /api/replay/[id]` renvoie `ignores: number` | non | état partiel du lecteur | F47 |
| B37 | série d'un nœud de la carte | `mapNodeSerie(f, tier, route)` | non | série du panneau nœud | F52 |
| B38 | probabilité d'inclusion de la population lue | `samplingSessions(f, { avecSpans? })`, `samplingSessionsHistorique(f, fenetre)` (retiré par F53) ; `EchantillonnageSessions` | non | bandeau d'échantillonnage (S7) des six écrans d'usage | F40 |
| B39 | occurrences par session commencée | `erreursParSessionCommencee(f, shift = false)` | non | tuile « Occurrences d'erreur par session commencée » | F41 |
| B50 | horodatage d'acquittement | `alert_event.acknowledged_at timestamptz`, écrit par `acknowledgeAlertEvent` | **oui** | délai d'acquittement (MTTA) | F64 (non affiché avant) |
| B51 | historique des évaluations de règle | table `alert_rule_eval(rule_id, evaluated_at, state, value, reason)` alimentée par `check_alerts` | **oui** | frise d'**état** des règles avec durées | F64 (frise de déclenchements avant) |
| B52 | alerte de régression de release | mode `release` dans `check_alerts` (p75 d'un vital, release la plus récente contre la précédente, même fenêtre, ratio 1,2 par défaut) | **oui** | option « Régression de release » du formulaire | F68 |
| B53 | effectif et valeur du burn rate | `slo_status()` rend `n_mesures` et `atteinte_1h` | **oui** | effectif sous chaque barre de budget ; valeur du burn rate | F63 |
| B54 | SLO et alerte au niveau d'un parcours | métrique composée (étapes d'entonnoir) évaluée par `slo_status()` et `check_alerts` | **oui** | capacité IP-Label « journey-level » | — (reporté, § 1.7 ; après B33) |
| B60 | suggestions de doublons d'issues | table `error_issue_suggestion` (RLS par app) + étape horaire `suggest_issue_duplicates` du planificateur | **oui** | P*.10 | P*.10 |
| B61 | concordance quotidienne robot / réel | grain `"jour"` dans `correlationSources` et `correlationQuotidienne(app, route, f)` | non | P*.8 | P*.8 |
| B62 | données de test par release | `comparaisonVersions` renvoie, par release, mesures LCP, mesures LCP « Bon » et les valeurs nécessaires à l'intervalle P*.1 | non | verdict à trois issues (P*.5) | P*.5 |

Hors portée par principe (aucun `Bn`) : ville, région, opérateur réseau (aucune IP stockée), profil
d'utilisateur nommé, taux « sans crash » tant que le natif n'est pas collecté.

### 6.4 Détail des lots de fondation F00–F09
| Lot | Périmètre | Fichiers touchés | Dépend de | Taille | Tests | Preuve de fin |
|---|---|---|---|---|---|---|
| **F00 — Corrections de vérité et outillage** | (1) seuils LCP faux dans `lib/glossary.ts:26,30` et `app/page.tsx:182-183` : importés de `THRESHOLDS` ; (2) libellé « seuils 2026 » retiré des textes ; (3) taux « 0 % » sans page vue → `null` (`app/page.tsx:98`) ; (4) actions sans table → « Non collecté » : `actionsDisponible` (`lib/queries-actions.ts:52-58`, aujourd'hui **non exportée**) devient `export async function actionsDisponible(): Promise<boolean>` ; `app/actions/page.tsx` l'appelle une fois, avant `Promise.all([topActions, topActionsSummary])` (`:28`) ; si `false`, la page ne lance pas ces deux lectures et rend, à la place de la rangée KPI, du hero et de la table, un `card` portant le texte exact « Non collecté : la table des actions n'existe pas sur ce déploiement » (F02 le remplace par `EtatSurface kind="non_collecte"`, `manque: "la table des actions n'existe pas sur ce déploiement"`, § 4.2) ; `topActionsSummary` et `topActions` restent inchangés (zéros et `[]` internes, `:203-207`) mais ne sont plus affichés sans ce contrôle préalable ; (5) `conversionRate` sans dénominateur → `null` (`lib/goals.ts:25-27`) ; (6) paliers propriétaires d'`app/experience/page.tsx:28-34` retirés ; (7) `app/forecast/page.tsx:58` importe `THRESHOLDS.LCP` ; (8) libellé « poor » des angles morts aligné sur `rating2026` (`lib/queries-v2.ts:475,483`, `app/correlation/page.tsx:114`) ; (9) `/forecast` : un `rangeNote` n'est lu que sur une surface `range: "none"` (`lib/page-filters.ts:L58-65`, `lib/surfaces.ts:L184-192`) ; `/forecast` est `range: "presets"` (`surfaces.ts:126`), donc F00 le passe à `range: "none"` avec `rangeNote: "Cet écran lit une fenêtre fixe de 14 jours complets ; la période choisie en haut ne s'applique pas."` (texte statique ; les dates JJ/MM sont écrites par la page, § 5.20.2), après avoir vérifié que ni `app/forecast/page.tsx` ni ses lectures ne lisent `f.period` (`grep -n "f.period\|PERIODS"` vide sur ces fichiers ; sinon, écart écrit dans la PR et `/forecast` reste `presets`). **Pas de `rangeNote` pour `/goals`** : vérifié, une plage personnalisée n'y est pas ignorée mais refusée — `/goals` est `range: "presets"` (`surfaces.ts:121`), `GlobalFilters` désactive « Personnalisée » avec la raison « Cet écran n'accepte encore que les périodes 1 h, 24 h et 7 j. » (`components/GlobalFilters.tsx:93, 151` ; `surfaces.ts:188-189`), et une URL portant `from`/`to` est rejetée par `checkSurface` (`surfaces.ts:205-207`) → `FilterProblemNotice` ; les lectures suivent le préréglage (`lib/queries-goals.ts:28, 44`, `PERIODS[f.period].interval`). V10 est donc déjà tenu sur `/goals` ; (10) VM4 : `DeployImpact` (`lib/queries-deploys.ts:47-55`) et `latestDeployImpact` (`:61-92`) ne portent aujourd'hui que `lcp_*` et `errors_*` ; F00 ajoute `pageviews_before/after` et `sessions_before/after` et rend `errors_*` `null` sans page vue, selon la signature du § 4.5 (« lib/queries-deploys.ts — F00 ») ; (11) script `"typecheck": "tsc --noEmit"` dans `apps/console/package.json` ; (12) relecture des pages web.dev LCP / CLS / FCP / TTFB (§ 1.4), consignée dans la PR | fichiers cités | — | M | `tests/unit/glossary.test.ts` (seuils de `glossary.ts` = `THRESHOLDS`) ; `tests/unit/goals.test.ts` (`conversionRate(…, 0)` → `null`) ; `tests/unit/queries-actions.test.ts` (`actionsDisponible` importable ; `q` simulé `[{ present: false }]` → `false`, une seule requête, contenant `to_regclass` ; même mécanisme que le cas « fail-soft avant v67 » existant) ; `tests/unit/deploys.test.ts` (`latestDeployImpact` avec `@/lib/db` simulé comme dans `queries-actions.test.ts` : ligne `pageviews_before: 0, errors_before: 0` → `errors_before === null` ; `pageviews_after: 12, errors_after: 0` → `errors_after === 0` ; `assessRegression(null, 5)` → `deltaPct: null`, déjà couvert `:18`) | `pnpm --filter console typecheck` existe et passe ; `grep -rn "seuils 2026" apps/console` vide ; captures `01`, `09`, `20`, `21`, `24` relues ; liens web.dev relus notés dans la PR |
| **F01 — Palette et contraste** | `lib/palette.ts` (§ 4.4 : `SERIE`, `CATEGORIELLE`, `SEQUENTIELLE`, `SEVERITE`) ; `RATING_CLASS` / `RATING_BAR` de `lib/rating.ts` sur jetons ; `HeroStat`, `HealthBanner`, `HealthHeatmap`, `VitalsTimeseries`, `TrafficTimeseries`, `GroupSparkline`, `Sankey`, `WidgetChart` sur la palette ; `ink-faint` → `ink-soft` pour le texte < 18 px ; ajout de `@axe-core/playwright` aux dépendances de développement | `lib/palette.ts`, `lib/rating.ts`, composants cités, `app/globals.css`, `package.json`, `tests/e2e/theme-contraste.spec.ts` (nouveau) | F00 | M | `tests/unit/palette.test.ts` : `CATEGORIELLE` ne contient aucune couleur de `RATING_HEX` ; `SEQUENTIELLE` monotone ; `tests/e2e/theme-contraste.spec.ts` : capture claire / sombre de `/`, `/pages`, `/errors` | `grep -rn "emerald-\|amber-\|red-[0-9]" apps/console/{components,app}` vide hors `lib/palette.ts` ; contraste calculé ≥ 4,5:1 sur les paires texte, mesuré par `@axe-core/playwright` (règle `color-contrast`), intégré à l'e2e de capture claire / sombre de ce lot |
| **F02 — États** | `EtatSurface`, `SectionErreur`, `lib/lecture.ts` ; fin des `softFail` silencieux (`lib/queries-grid.ts`, `lib/queries-frustration.ts`, `lib/queries-sessions.ts:L21, L45-47, L69, L92-94`, `lib/queries-health.ts`, `resourcesVue`, `longtaskSeries`, `worstLongtasks`, `scriptsBloquants`, `dailyTraffic`, `healthGrid`) ; `error.tsx` + `loading.tsx` pour chaque route du périmètre (§ 2.2) ; `not-found.tsx` français (`/errors/[fingerprint]`, `/errors/issues/[id]`, `/sessions/[id]`, `/tracing/[traceId]`) ; `SupervisionHero.state` | `components/states/*`, `lib/lecture.ts`, `app/**/{error,loading,not-found}.tsx`, lectures citées | F00 | L | `tests/unit/lecture.test.ts` ; `tests/unit/EtatSurface.test.tsx` (`echantillonne` avec `probaMin: null` → pas de « 100 % ») ; `tests/e2e/etats.spec.ts` (nouveau) : base indisponible simulée → « lecture en échec » + « Réessayer » sur `/`, `/pages`, `/sessions` | `find apps/console/app -name error.tsx` couvre toutes les routes du § 2.2 ; `grep -rn "softFail" apps/console/lib` vide ou limité à des lectures hors périmètre, listées dans la PR |
| **F03 — Figure, tuiles, sparkline, vitrine de composants** | `Figure`, `KpiTile`, `KpiLibelle`, `Sparkline`, `lib/fmt-ids.ts` ; `ScatterPlot` (signature unifiée), `LineTrend` (`series`), alternatives et `role="img"` sur `RankBar`, `Donut`, `RadarScore` ; `VitalCard` (`periodLabel` obligatoire, sparkline, `intervalle`) ; vitrine `app/admin/composants/page.tsx` (réservée aux administrateurs ; **pas** `app/demo`, qui est la route d'accès démo) montrant chaque état de chaque composant sur des données fixes | `components/charts/{Figure,KpiTile,KpiLibelle,Sparkline,ScatterPlot,LineTrend}.tsx`, `lib/fmt-ids.ts`, `components/VitalCard.tsx`, `app/admin/composants/page.tsx` | F01, F02 | M | `tests/unit/{KpiTile,KpiLibelle,Sparkline,Figure}.test.tsx` (null, précédent null / 0, couverture partielle, échantillon faible, alerte) ; `tests/unit/fmt-ids.test.ts` | `/admin/composants` à 390 et 1440 sans débordement ; texte exact « pas de mesure de référence non nulle » rendu pour `precedent: 0` |
| **F04 — Séries** | `ThresholdSeries` (grille obligatoire, bandes, domaine, annotations, référence, trous, `additive`, `effectifCle`, `faibleSous`, `projection`, `bande`, seau partiel, zoom) ; `SERIE_MARGES` ; `lib/series.ts` (`alignerSeaux`) ; `StackedBars` réécrit (§ 4.2) ; `VitalsTimeseries`, `TrafficTimeseries` migrés ; `ForecastChart` sans `connectNulls` | `components/charts/{ThresholdSeries,StackedBars,VitalsTimeseries,TrafficTimeseries,ForecastChart}.tsx`, `lib/series.ts` | F03 | L | `tests/unit/series.test.ts` : absent → `null` ; additif → 0 ; `tests/unit/ThresholdSeries.test.ts` (fonction `preparerPoints`) : points `[h0, h2]` sur la grille `[h0, h1, h2]` → deux segments séparés ; domaine y et bandes ; `tests/e2e/series.spec.ts` (nouveau) : bande « Bon » visible sur `/` avec les données de démo | `grep -rn yAxisId apps/console/components/charts` vide ; capture `01` refaite : bandes visibles, plus de double axe |
| **F05 — Distributions, classements, fuseaux** | `DistributionSeuils`, `ImpactTable` + `lib/impact.ts`, `ContrastBars` (état `indisponible` tant que B3 manque), `Breakdown` (`tri`, `onglets`), `HealthHeatmap` (échelle séquentielle, cases liens, clavier, alternative), `PercentileTable` (`scope`, n) ; `lib/fuseau.ts` (`bornesHeureLocale`, `bornesJourLocal`, `libelleDeuxFuseaux`) | `components/charts/{DistributionSeuils,ContrastBars,HealthHeatmap}.tsx`, `components/{ImpactTable,Breakdown,Distribution}.tsx`, `lib/impact.ts`, `lib/fuseau.ts` | F03 | L | `tests/unit/impact.test.ts` (garde n < 30, `null` en dernier, pas de total de p75, `fourni` conserve l'ordre) ; `tests/unit/fuseau.test.ts` (Europe/Paris 9 h été → `T07:00:00Z` ; jour du 10/09 → `2026-09-09T22:00:00Z`) ; `tests/unit/HealthHeatmap.test.tsx` (aucune classe de verdict ; href UTC) | e2e : `tri=volume` / défaut gravité sur `/` ; heatmap sans vert / ambre / rouge (capture) |
| **F06 — État de vue dans l'URL et comparaison** | `lib/view-state.ts` (tous les paramètres du § 3.1, `TRIS_PAR_ECRAN`, `lireTri`, `contextHref`) ; `Nav` / `SubNav` l'emploient ; export de `Segmented` / `Chip` ; `CompareToggle` dans `GlobalFilters` ; `lib/comparaison.ts` (`couverturePrecedente`, `debutCollecte`) et export `couvertureRetention` depuis `lib/queries-explorer.ts:L179-186` | `lib/view-state.ts`, `lib/comparaison.ts`, `lib/queries-explorer.ts`, `components/{GlobalFilters,Nav,SubNav,CompareToggle}.tsx` | F00 | M | `tests/unit/view-state.test.ts` : aller-retour de chaque paramètre ; paramètre illisible → ignoré et signalé ; `tri=impact` avant B2 ignoré ; `tests/unit/comparaison.test.ts` + `tests/integration/comparaison-sql.test.ts` (§ 3.2 : plage personnalisée de 30 j → `partielle`) | e2e : `cmp=release` survit à un changement d'onglet ; `queryFingerprint` inchangé ; une plage personnalisée de 30 jours n'affiche aucun delta sur `/` |
| **F07 — Panneau et cascade** | `DetailPanel` + `DetailPanelKeys` ; `Cascade` ; cascade de `/tracing/[traceId]` réécrite sur `Cascade` (preuve de réutilisation) | `components/DetailPanel*.tsx`, `components/charts/Cascade.tsx`, `app/tracing/[traceId]/page.tsx` | F03, F06 | L | `tests/unit/Cascade.test.tsx` (ton par sévérité, `partiel` en tête) ; `tests/e2e/panneau.spec.ts` (nouveau) : clavier (Échap, ↑ / ↓, focus sur le titre), plein écran à 390 px | capture `18` refaite |
| **F08 — Vues préréglées, constats, releases, annotations** | `PresetBar` + `lib/presets.ts` (dont `choisirReleases`) ; `SegmentBar` sans `prompt` ni émoji ; `InsightStrip` ; `ReleaseCompare` ; `lib/annotations.ts` (déploiements filtrés sur `[from, to)` ; message B1 sous plage personnalisée) | fichiers cités | F05, F06 | L | `tests/unit/presets.test.ts` (nommage « • », vue indisponible motivée, `choisirReleases`) ; `tests/unit/annotations.test.ts` (regroupement > 6, hors fenêtre exclu) ; `tests/unit/InsightStrip.test.tsx` (zéro constat → phrase des règles) | e2e : appliquer « Mobile » ne modifie que `device` |
| **F09 — Navigation et coquille** | `nav-items.tsx` selon § 2.4 (`NavLink.sousOnglet`) ; indicateur de débordement de `SubNav` ; `PageHeader.domain` à six clés, `sub` ; réserve basse et repli du widget « Votre avis ? » ; `InfoTip` borné ; `AutoRefresh` + `SANS_RAFRAICHISSEMENT` (§ 3.11) ; extraction du helper `debordements` vers `tests/e2e/helpers/debordements.ts` ; e2e « aucun débordement » étendu à toutes les routes du périmètre | `components/{nav-items,Nav,SubNav,PageHeader,InfoTip,AutoRefresh}.tsx`, `lib/surfaces.ts`, `app/layout.tsx`, `public/mip-rum-feedback.js`, `tests/e2e/helpers/debordements.ts`, `tests/e2e/navigation-filtres.spec.ts` (étendu) | F06 | M | `tests/unit/nav-items.test.ts` (`activeCategory` : `/actions` → Performance, `/events` → Explorer, `/goals` → Usages) ; `tests/unit/surfaces.test.ts` (étendu : `SANS_RAFRAICHISSEMENT`) ; e2e 390 / 768 / 1440 sur chaque route du périmètre | tous les écrans du § 2.3 atteignables depuis la nouvelle navigation ; aucune route cassée (`pnpm test:e2e` vert) |

Précisions sur les fondations :

- **F03** : la vitrine `app/admin/composants/page.tsx` est protégée comme les autres pages
  d'administration ; elle rend chaque composant du § 4.2 dans tous ses états (données fixes écrites dans
  la page), à 390 et 1440 px. Elle sert de preuve de fin à F03, F04, F05, F07, F08 et F56.
- **F04** : `StackedBars` est réécrit sans changer ses usages existants d'un coup : chaque écran passe à
  la nouvelle signature dans son propre lot ; l'ancienne forme (`data`, `xKey`) reste acceptée jusqu'à
  F69, puis est retirée.
- **F06** : les paramètres propres à un écran (`evt`, `appel`, `regle_*`, `avec`, `voir`, `depuis`,
  `type`, `nouveaux`, `statut`) sont déclarés dans `lib/view-state.ts` dès F06 (lecture et sérialisation
  testées), même si l'écran qui les exploite vient plus tard.
- **F09** : l'e2e « aucun débordement » s'étend à mesure que les écrans sont livrés ; F09 le pose sur les
  routes existantes.

### 6.5 Détail des lots de domaine

#### Performance — F10 à F29

Fichiers de test du domaine :
| Fichier | Porte sur | Créé par |
|---|---|---|
| `tests/unit/series.test.ts` | `lib/series.ts` (`alignerSeaux`) | F04 (fondation) |
| `tests/unit/perf-domain.test.ts` | `lib/perf-domain.ts` (`partTouchees`, `deltaAffichable`, `choisirRelB`, `autresGroupes`, `colonnesPromues`, `ratioPour100`, jointure `vitalsBreakdown` × `slowRoutes`) | F10, étendu par F11-F25 |
| `tests/unit/impact.test.ts` | `lib/impact.ts` (`classerParGravite`) — fichier créé par F05 si absent | F05 / F10 |
| `tests/unit/frustration-regles.test.ts` | `lib/frustration-regles.ts` contre `packages/rum-sdk/src/frustration.ts` | F22 |
| `tests/unit/HealthBanner.test.tsx` | `components/health/HealthBanner.tsx` (variante `compact`) | F11 |
| `tests/unit/RoutePanel.test.tsx` | non créé : `RoutePanel` est asynchrone et lit la base ; couvert par e2e | — |
| `tests/integration/perf-lectures-sql.test.ts` | `vitalSeriesN`, `sessionsAvecVue`, `pageviewSeries`, `errorSeries`, `erreursNavigateur`, `partSessionsTouchees`, `nouveauxGroupes`, `topGroupesSeries`, `frustrationTotaux`, `frustrationParRoute`, `samplingVitals`, `releasesDuGroupe`, `feedbackByRoute.detracteurs`, `feedbackTrendContrat` | F10, étendu par F18, F20, F22, F26 |
| `tests/e2e/perf-domaine.spec.ts` | parcours et débordements du domaine | F11, étendu par chaque lot d'écran, clos par F27 |

| Lot | Périmètre | Fichiers touchés | Dépend de | Taille | Tests (fichier : cas) | Preuve de fin |
|---|---|---|---|---|---|---|
| **F10 — Lectures partagées du domaine** | `vitalSeriesN`, `sessionsAvecVue`, `pageviewSeries` (chargements / SPA), `errorSeries`, `erreursNavigateur`, `partSessionsTouchees`, `samplingVitals` (§ 4.5, § 1.5) ; `lib/perf-domain.ts` (`partTouchees`, `deltaAffichable`, `ratioPour100`, `avecCondition` si nécessaire, `choisirRelB` CP3, `classerParGravite` si F05 ne l'a pas) ; paramètre `shift` de `engagementStats` | `lib/queries.ts`, `lib/queries-errors.ts`, `lib/queries-sessions.ts`, `lib/perf-domain.ts` | F00, F04 (`alignerSeaux`), F05 | M | `tests/unit/impact.test.ts` : n = 12 après n = 400 ; `null` en dernier. `tests/unit/perf-domain.test.ts` : `partTouchees` (base 0 → `null` ; `tauxMin` 0,1 → `null` ; jamais > 1) ; `ratioPour100` (0 vue → `null` ; 30/20 → 150). `tests/integration/perf-lectures-sql.test.ts` : `vitalSeriesN` rend `n` par seau ; erreur `node` sans session hors de `erreursNavigateur.navigateur` ; session sr = 0,1 / esr = 1 → `tauxMin` 0,1 ; session touchée sans vue hors numérateur ; `pageviewSeries` sépare `spa` | `pnpm test:sql` vert ; `grep -rn "reduce" apps/console/app` ne trouve aucun cumul de `p75` |
| **F11 — Vue d'ensemble : santé, KPI, constats** | zones 1-4 du § 5.1 ; `HealthBanner` compact ; facteur « Erreurs navigateur » dans `healthScore` (CP14) ; « Sessions commencées » ; ratio pour 100 ; constats avec `evt=` (repli `/alerts` avant F67) | `app/page.tsx`, `components/health/HealthBanner.tsx`, `lib/health.ts` | F03, F06, F08, F10 ; F62 et F67 (§ 5.19) pour les constats d'alerte par événement seulement (repli écrit avant) | M | `tests/unit/HealthBanner.test.tsx` : `detail` visible en variante `compact`, facteur `earned: null` → « n/a ». `tests/unit/perf-domain.test.ts` : Σ sparkline sessions = valeur. `tests/e2e/perf-domaine.spec.ts` : tuile LCP → `/pages?vital=LCP` ; le nombre « Sessions commencées » de `/` = celui de `/sessions` ; 390 : facteurs non tronqués ; aucun `href` de constat ne contient `fired=` | capture 1440 : hero commence au-dessus du pli ; aucun « % » sur la tuile d'erreurs |
| **F12 — Vue d'ensemble : hero CWV et « Charge, erreurs et LCP »** | zones 5-6 (hors angle mort) ; `cmp=prev` et `cmp=release` sur les séries ; trois panneaux à axe x partagé | `app/page.tsx` | F04 (`StackedBars` sur grille), F10 | M | `tests/e2e/perf-domaine.spec.ts` : bandes visibles ; 3 `role="img"` au hero et 3 dans « Charge, erreurs et LCP » avec le même nombre de seaux ; `cmp=release` trace deux séries ; zoom au clic ajoute `from/to` | `grep -rn yAxisId apps/console/components/charts` vide |
| **F13 — Vue d'ensemble : segments, release, angle mort, historique** | zones 6 (tuile « Heures × route en angle mort »), 7, 8, 9 ; heatmap en échelle séquentielle, bornes locales → UTC | `app/page.tsx`, `lib/impact.ts` (appel), `components/ReleaseCompare.tsx` (appel), `lib/fuseau.ts` (appel de `bornesHeureLocale`) | F05, F08, F10 ; **F57** (§ 5.7) pour la tuile d'angle mort | M | `tests/unit/fuseau.test.ts` (créé par F05) : Europe/Paris 9 h été → `T07:00:00Z`. `tests/integration/perf-lectures-sql.test.ts` (ou test SQL de F57) : 60 heures seedées → 60. `tests/e2e/perf-domaine.spec.ts` : `tri=volume` vs défaut ; onglet Pays estimé → drill `country=` ; < 2 releases → désactivé avec raison ; tuile d'angle mort → `/correlation#angles-morts` | captures 1440/390 ; `grep -n "blindSpots" apps/console/app/page.tsx` vide |
| **F14 — Pages : KPI, sélecteur de vital, hero classé** | § 5.2.1-5.2.2 zones 1-4 ; jointure `vitalsBreakdown` × `slowRoutes` | `app/pages/page.tsx`, `lib/perf-domain.ts` | F05, F06, F10 | M | `tests/unit/perf-domain.test.ts` : jointure par route, route absente d'un côté → `null`. `tests/e2e/perf-domaine.spec.ts` : `vital=INP` re-trie ; `vital=FCP` → classement désactivé avec raison | une seule liste de routes sur l'écran |
| **F15 — Pages : distributions, percentiles, TTFB, type de navigation** | zones 5-7 (hors tâches longues) ; plafond d'affichage adaptatif ; « Vues par type de navigation » (`vuesParNavType`, § 4.5) | `app/pages/page.tsx`, `lib/perf-domain.ts` (`plafondAffichage`) | F05 | S | `tests/unit/perf-domain.test.ts` : phases filtrées sur les 6 noms ; `plafondAffichage` (p95 44 ms → plafond = p99 arrondi). `tests/e2e/perf-domaine.spec.ts` : repères p50/p75/p95 présents | phrase « leur somme n'est pas le TTFB » présente |
| **F16 — Pages : tâches longues et ressources** | p75 du blocage en panneau empilé ; annotations ; `SectionErreur` | `components/LongtasksView.tsx`, `app/pages/page.tsx` | F02, F04 | S | `tests/e2e/perf-domaine.spec.ts` : deux figures, axe x partagé ; base coupée → « lecture en échec » | — |
| **F17 — Panneau route** | § 5.2.3 ; `RoutePanel` (signature § 5.2.3) ; `panel=route:` ouvert depuis `/`, `/pages`, `/ux`, `/experience` ; bloc robot en états | `app/pages/page.tsx`, `components/perf/RoutePanel.tsx` (nouveau, SSR) | F07, F10, F14 ; F57 pour la ligne « Heures en angle mort » | L | `tests/e2e/perf-domaine.spec.ts` : clavier (Échap ferme, focus titre) ; 390 plein écran ; lien `/correlation?serie=` présent si robot ; aucune valeur robot en ms dans le panneau | capture panneau ouvert 1440 et 390 |
| **F18 — Erreurs : KPI, hero, répartition** | § 5.3.2 lignes 1-5 et 8 ; `nouveauxGroupes`, `topGroupesSeries`, `cmp=prev` des totaux ; « Part des sessions touchées » sur `partSessionsTouchees` | `app/errors/page.tsx`, `lib/queries-errors.ts` | F03, F04 (`StackedBars.annotations`), F10 | M | `tests/unit/perf-domain.test.ts` (`autresGroupes`) : « Autres » = trend − Σ4 borné à 0. `tests/integration/perf-lectures-sql.test.ts` : groupe résolu à 500 occurrences dans les 4 devant un régressé à 3 ; `nouveauxGroupes`. `tests/e2e/perf-domaine.spec.ts` : `sessions_affected: null` → « Inconnu » ; légende sans doublon « Error » | hero : ≤ 5 séries |
| **F19 — Erreurs : liste et filtre de statut** | table/cartes, sparkline à échelle commune, caption d'ordre, filtre statut en mode historique | `app/errors/page.tsx`, `components/errors/IssueList.tsx`, `lib/queries-errors.ts` | F03 (`Sparkline.max`), F18 | M | `tests/unit/Sparkline.test.tsx` (si F03 ne l'a pas créé) : `max` partagé → même hauteur pour la même valeur. `tests/e2e/perf-domaine.spec.ts` 390 : occurrences et sessions visibles sans défilement horizontal | capture 390 |
| **F20 — Détail d'erreur (panneau et page)** | § 5.3.3 ; `releasesDuGroupe` ; phrase d'impact sur `partSessionsTouchees(f, ref)` ; repli de contraste sur 100 occurrences ; bouton « Voir le rejeu » | `app/errors/[fingerprint]/page.tsx`, `components/errors/*`, `lib/queries-errors.ts` | F07, F10, F18 | L | `tests/integration/perf-lectures-sql.test.ts` : `releasesDuGroupe` ; part ≤ 100 % par groupe. `tests/e2e/perf-domaine.spec.ts` : phrase d'impact avec dénominateur ; rejeu → `/sessions/<id>?tab=replay&at=` ; empreinte inconnue → `not-found` français | capture 04 refaite (plus de 404 anglais) |
| **F21 — Issue v2 alignée** | `/errors/issues/[id]` reprend les blocs 2-7 | `app/errors/issues/[id]/page.tsx` | F20 | S | `tests/e2e/error-tracking.spec.ts` (existant) vert + un cas « versions touchées » ajouté dans `tests/e2e/error-issues.spec.ts` | — |
| **F22 — Interactions : onglets, Frustration KPI, règles, hero** | `frustrationTotaux` (avec garde de capteur, CP16), `frustrationParRoute`, `lib/frustration-regles.ts`, onglets `TabLink` | `app/ux/page.tsx`, `lib/queries-frustration.ts`, `lib/frustration-regles.ts` | F02, F05, F09, F10 | M | `tests/unit/frustration-regles.test.ts` : règles = constantes SDK. `tests/integration/perf-lectures-sql.test.ts` : total non borné à 50 ; sessions `react_native` seules → `sessionsCouvertes = 0` ; mixte 2/3. `tests/e2e/perf-domaine.spec.ts` : onglet Actions garde les filtres ; sous `non_collecte`, aucun « 0 » | capture 05 refaite |
| **F23 — Interactions : INP et scripts** | série INP, nuage étiqueté + table, scripts | `app/ux/page.tsx` | F04, F22 (`ScatterPlot.etiquettes`) | S | `tests/e2e/perf-domaine.spec.ts` : alternative du nuage = table ; 390 sans débordement | — |
| **F24 — Onglet Actions** | KPI (`non_collecte`), hero non empilé, colonne « temps lié » renommée ; option `lie_p75_ms` | `app/actions/page.tsx`, `lib/queries-actions.ts` | F00, F03, F22 | M | `tests/unit/queries-actions.test.ts` (existant, étendu) : table absente → `non_collecte`. `tests/e2e/perf-domaine.spec.ts` : lien libellé → `/errors?route=` | capture 06 refaite |
| **F25 — Journal** | § 5.23 ; facettes cliquables (`attr_*`), volume daté, colonnes promues, panneau événement | `app/events/page.tsx`, `lib/perf-domain.ts` (`colonnesPromues`) | F04, F07 | M | `tests/unit/perf-domain.test.ts` : promotion à 80 %. `tests/e2e/events-explorer.spec.ts` (existant, étendu) : clic nom → `?name=` ; clic attribut → `?attr_source=&attr_key=` ; 390 cartes | capture 07 refaite |
| **F26 — Satisfaction** | § 5.5 ; retrait score/radar ; `feedbackTrendContrat` ; colonne `detracteurs` ; nuage LCP × CSAT | `app/experience/page.tsx`, `lib/queries-experience.ts`, `lib/experience.ts` | F00, F04, F05, F10 | M | `tests/unit/experience.test.ts` (existant, étendu) : route `count = 0` → `null` ; jour sans avis = trou. `tests/integration/perf-lectures-sql.test.ts` : `detracteurs` compte les notes ≤ 2. `tests/e2e/perf-domaine.spec.ts` : < 3 routes → `partiel` | capture 09 refaite |
| **F27 — Recette transverse du domaine** | e2e P8 (premier élément de chaque figure → URL avec plage + condition), « aucun débordement » sur les 8 routes, contrôle P2 / P5 / P10 ; gardes `fired=` et `blindSpots` | `tests/e2e/perf-domaine.spec.ts` | F11-F26 | M | la spec elle-même | CI verte ; `grep` du P2 vide sur `app/{,pages,errors,ux,actions,events,experience}` ; `grep -rn "fired=" apps/console/components apps/console/lib/presets.ts` vide ; `grep -rn "blindSpots" apps/console/app/page.tsx apps/console/components/perf` vide |
| F28-F29 | réservés (retours de relecture du domaine) | — | — | — | — | — |

Ordre dans le domaine : F10 dès F04 et F05 ; puis F11-F13 et F14-F16 en parallèle (F13 attend F57
pour sa seule tuile d'angle mort : le reste du lot peut être livré avant, la tuile absente) ; F17 après
F07 ; F18-F21 ; F22-F24 ; F25, F26 ; F27 en dernier.

#### Exploration — F30 à F39

Tests existants à étendre : `tests/unit/{explorer-page-params,dashboards,dashboards-analytics,saved-views,widget-data-errors,rum-mobile-p75}.test.ts`,
`tests/e2e/{analytics-explorer,dashboards-analytics,mobile-console}.spec.ts`.
| Lot | Périmètre | Fichiers touchés | Dépend de | Taille | Tests | Preuve de fin |
|---|---|---|---|---|---|---|
| **F30 — Vérité du domaine** | CE1 (`values: (number\|null)[]`, CSV vide pour `null`), CE2, CE3 (exception → `{ kind: "error", reason }`), CE6 (`LIMITES.timeseries = [1, 3, 5]`), CE7, CE8, CE9 (écran), CE11 | `lib/widget-data.ts`, `components/dashboards/WidgetChart.tsx` (lecture de `null`), `app/explorer/page.tsx` (L70), `app/mobile/page.tsx`, `app/explorer/views/page.tsx` | F00, F02 | S | unitaires : série non additive avec seau vide → `null` ; toplist `null` → `null` ; `resolveLegacy` qui lève → `kind: "error"` ; e2e : liens mobile, absence de `bg-red-600` | `grep -n "?? 0" lib/widget-data.ts` ne renvoie rien sur des valeurs de mesure ; `tests/e2e/mobile-console.spec.ts` vert |
| **F31 — Explorer : requête lisible et départ** | `QueryPills` (§ 4.3) ; formulaire replié quand `run` ; représentation en onglets `TabLink` ; `lib/explorer-modeles.ts` + `ModelesDepart` (W-E1) | `app/explorer/page.tsx`, `components/explorer/QueryPills.tsx`, `components/explorer/ModelesDepart.tsx`, `lib/explorer-modeles.ts` | F03, F06 | M | unitaires : chaque modèle passe `parseExplorerPlan` ; retrait d'une pastille rend une URL sans cette condition et sans `cursor` ; e2e : aucun appel de lecture sans `run` ; 390 px sans débordement | capture 08 refaite : 6 analyses de départ visibles, formulaire ouvert |
| **F32 — Explorer : représentations** | W-E3 à W-E6, W-E8, W-E9 ; `ResultatAnalyse` (§ 4.3) ; règle R-V (`vitalDeVerdict`) ; `cmp=prev` (valeur, série sans groupe) ; annotations | `components/explorer/ResultatAnalyse.tsx`, `lib/explorer-page-params.ts` (`vitalDeVerdict`), `app/explorer/page.tsx` (retrait de `Series`, de l'`aside`) | F04, F05, F31 | L | unitaires `tests/unit/explorer-page-params.test.ts` (`vitalDeVerdict` : p75 → vital ; avg, p95, rows → `null`) et `tests/unit/ResultatAnalyse.test.tsx` (choix de la forme selon `estAdditive` ; ligne de référence = `total` ; `value:avg LCP` → aucun badge, aucune bande) ; e2e `tests/e2e/analytics-explorer.spec.ts` : chaque représentation a une alternative textuelle ; `variant=LCP&measure=value:p75` → bande « Bon » ; `measure=value:avg` → aucun badge Bon / À améliorer / Mauvais ; onglet Distribution désactivé avec raison | e2e P8 : clic sur la 1re barre d'un classement ajoute la condition et garde `period` |
| **F33 — Explorer : contexte et répartition** | W-E2 (volume), W-E7 (`split`) ; chaque section derrière `<Suspense>` + `SectionErreur` | `app/explorer/page.tsx`, `components/explorer/ResultatAnalyse.tsx` | F32 | M | unitaires : plan de volume dérivé (`rows`/`started`/`occurrences:sum`) pour chaque jeu ; e2e : budget dépassé simulé sur la répartition → message, le résultat principal reste affiché | e2e `split=browser` : la 1re barre filtre |
| **F34 — Vues enregistrées** | W-V1 à W-V3 ; `resumeVue` | `app/explorer/views/page.tsx`, `lib/explorer-page-params.ts` | F31 | S | unitaires `resumeVue` (AST valide, AST illisible) ; e2e : session démo sans bouton d'écriture | liste montrant la colonne « Ce qu'elle mesure » |
| **F35 — Tableaux de bord : modèles** | W-D1 à W-D3 ; `lib/dashboard-templates.ts`, `ModeleCarte`, `cloneTemplateAction` ; libellé d'app | `app/dashboards/page.tsx`, `app/dashboards/actions.ts`, `lib/dashboard-templates.ts`, `components/dashboards/ModeleCarte.tsx` | F30 | M | unitaires : aller-retour `serializeLayout` / `normalizeLayout` de chaque modèle, ≤ 24 cartes ; accès : démo et viewer sans app → pas de « Cloner » (étendre `dashboard-actions-access.test.ts`) ; e2e : cloner « Performance » | capture 25 refaite : 4 modèles visibles |
| **F36 — Tableau de bord : cartes** | W-B1 à W-B11 ; `PopulationBar` (§ 4.2) ; `WidgetData` porte des nombres ; `WidgetChart` retiré ; « Ouvrir dans l'Explorer » ; grille 1/2/3 colonnes, séries pleine largeur ; `cmp=prev` sur les valeurs | `lib/widget-data.ts`, `components/dashboards/{WidgetBody,WidgetCard}.tsx`, `app/dashboards/[id]/page.tsx`, `components/PopulationBar.tsx` | F32, F30 | L | unitaires `tests/unit/widget-data.test.ts` (types numériques, `null` conservés, v1 `vital_p75` avec `n = 0`, carte `vitals value:avg` sans verdict) ; e2e `tests/e2e/dashboards-analytics.spec.ts` : un tableau à 6 cartes v2 + 3 v1 rend chaque forme avec alternative ; carte « Trafic » marque « journée en cours » ; 390 sans débordement | CSV exporté : cellules vides pour `null` |
| **F37 — Sections de tableau de bord** | W-B12 : `SectionWidget`, lecture/écriture, rendu repliable, formulaire « Ajouter une section » ; modèles de F35 passés en sections | `lib/dashboards.ts`, `app/dashboards/actions.ts`, `app/dashboards/[id]/page.tsx`, `lib/dashboard-templates.ts` | F35, F36 | M | unitaires `tests/unit/dashboards.test.ts` : aller-retour d'une section ; une section compte dans `MAX_WIDGETS` ; une section inconnue d'un lecteur ancien devient une carte illisible (pas une perte) ; accès `tests/unit/dashboard-actions-access.test.ts` : « Ajouter une section » refusé à un viewer non propriétaire et en démo ; e2e clavier : section repliable au clavier | tableau cloné depuis un modèle affiché en sections titrées |
| **F38 — Mobile : réagencement et stabilité par release** | W-M1 à W-M9, W-M11, W-M12, dont le hero W-M6 ; lecture `mobileParRelease` (requête sans migration) ; fonctions pures `etatCapaciteParRelease`, `tauxSansErreurDeclarant` ; ordre de repli du § 5.6.3 si `disponible: false` ; `PresetBar` iOS / Android / dernière release ; `EtenduePercentiles` (§ 4.2) ; formulaire « Plateforme » retiré ; `ImpactTable tri="fourni"` avec `ordreLibelle` (§ 4.2) | `lib/queries-mobile.ts` (`cohorte()` projette `release`, `started_at` ; `mobileParRelease`), `lib/mobile-capabilities.ts`, `app/mobile/page.tsx`, `components/charts/EtenduePercentiles.tsx`, `lib/presets.ts` (vues mobiles) | F03, F05 (`ImpactTable`, dont `tri="fourni"`), F08, F30 | L | unitaires `tests/unit/rum-mobile-p75.test.ts` (qui teste déjà `errorFreeSessionRate` ; étendu, pas dupliqué) (`etatCapaciteParRelease` : deux releases dont une seule déclarante → `active` / `unknown` ; `tauxSansErreurDeclarant` : exemple de W-M5), `tests/unit/EtenduePercentiles.test.tsx` (`null`), `tests/unit/presets.test.ts` (vues mobiles ne posent que `os` / `release`) ; intégration `tests/integration/rum-mobile-par-release-sql.test.ts` (deux releases, une seule déclarante → pas de pourcentage sur la seconde ; release `null` = « Inconnue » ; somme des occurrences, pas des lignes) ; e2e `tests/e2e/mobile-console.spec.ts` : ordre des zones (hero W-M6 au-dessus du pli à 1440), aucun « crash-free » ni « sans crash », « Dernière déclaration » présente, ligne de release → `release=`, 390 sans débordement | capture 10 refaite : KPI et hero « Stabilité par release » au-dessus du pli, matrice en fin ; sur la démo sans session RN, le hero montre l'état vide motivé (non établi : aucune session RN réelle, parity C7) |
| **F39 — Mobile : dans le temps** | W-M10 (après B8) ; avant B8, état « non disponible » motivé (livré en F38) | `app/mobile/page.tsx` | F38, B8 | S | e2e `tests/e2e/mobile-console.spec.ts` : après B8, deux panneaux empilés avec alternative ; avant, le texte de raison et aucun axe vide | série rendue sur la cohorte React Native (`seg=v2:runtime:eq:react_native`) |

Ordre dans le domaine : F30 → F31 → F32 → (F33, F34, F36) → F35 → F37 ; F38 dès F03 + F05 + F08 (et
F30) ; F39 après B8. Aucun lot de ce domaine n'attend une dépendance backend propre.

#### Usages — F40 à F54

Les e2e du domaine vivent dans `tests/e2e/usages-<écran>.spec.ts` (règle S8).
| Lot | Périmètre | Fichiers touchés | Dépend de | Taille | Tests | Preuve de fin |
|---|---|---|---|---|---|---|
| **F40 — Vérité et périmètre du domaine** | (1) test e2e « viewer restreint à A + `app=all` » sur `/acquisition`, `/paths`, `/forms`, `/retention` ; s'il lit B : refus typé `forbidden_app`-like (« Cet écran lit une application à la fois ») quand `requestedApp === null && authorizedApps !== null` sur une surface `legacy`, en attendant B31 ; (2) `funnel.ts:L55` → `null` ; (3) `pageHealth(null)` / `apiHealth(_, null)` → `"unknown"` ; (4) `lundiDeSemaine` remplace `weekIndexToDate` à l'affichage ; (5) `/retention` en `range: "none"` + `rangeNote` ; (6) `softFail` de `lib/queries-sessions.ts:L45-47, L92-94` → `lire` (F02) ; (7) seuils sans source retirés (S6) ; (8) B38 et bandeau S7 sous les KPI des six écrans (`lib/echantillonnage.ts`, pur) ; (9) `/goals` inclus dans le test de périmètre et dans le refus provisoire (la réécriture sur le contrat est F66) | `lib/surfaces.ts`, `lib/page-filters.ts`, `lib/funnel.ts`, `lib/map.ts`, `lib/queries-cohorts.ts`, `lib/cohorts.ts`, `lib/queries-sessions.ts`, `lib/echantillonnage.ts` (nouveau), `app/{sessions,acquisition,retention,paths,forms,map}/page.tsx`, `tests/e2e/usages-perimetre.spec.ts` et `tests/e2e/usages-echantillonnage.spec.ts` (nouveaux) | F00, F02 | L | unitaires : `tests/unit/funnel.test.ts` (départ 0 → null), `tests/unit/map.test.ts` (null → unknown), `tests/unit/cohorts.test.ts` (lundi), `tests/unit/echantillonnage.test.ts` ; e2e : périmètre (dont `/goals`), échantillonnage (S7) | e2e périmètre vert ; `grep -n "convFromStart: start > 0 ? r / start : 0" apps/console/lib/funnel.ts` vide |
| **F41 — Sessions : KPI, volume, répartition** | Z2, Z4, « Qui sont ces sessions », « Engagement », anneau à trois parts ; `engagementStats(f, shift)` ; B39 `erreursParSessionCommencee` et tuile « par session commencée » | `app/sessions/page.tsx`, `lib/queries-sessions.ts`, `lib/dashboard-blocs.ts` | F03, F04 (`SerieDef.forme`), F05, F06 | M | unitaire `tests/unit/queries-sessions.test.ts` : somme des sessions par seau = `sessions_started` ; cas S1/S2/sans session de B39 (valeur 3,00) ; e2e `tests/e2e/usages-sessions.spec.ts` : clic seau → `from`/`to` ; « Inconnu » → `is_null` ; 390 px | capture 11 refaite : KPI + hero au-dessus du pli ; plus d'`ObservedTrend` sur l'écran |
| **F42 — Sessions : priorité et table** | hero « À regarder d'abord », `SessionsTable`, filtres rapides, cartes compactes 390 px | `components/sessions/{PrioriteSessions,SessionsTable}.tsx`, `app/sessions/page.tsx`, `lib/queries.ts` (typage `SessionRow`) | F41, **B30** (sinon états « à créer ») | L | unitaire : ordre de priorité (erreurs, puis frustration, puis API, puis récence) ; e2e : ▶ → `?tab=replay&at=` ; `avec=erreurs` ne change pas les KPI | e2e vert avec et sans B30 (états motivés) |
| **F43 — Sessions : panneau** | `panel=session:<id>`, précédent / suivant dans la page de liste, mini-cascade | `app/sessions/page.tsx`, `components/sessions/PanneauSession.tsx` (fonction serveur locale, sans props publiques, § 4.3) | F07, F42 | M | e2e `tests/e2e/usages-sessions.spec.ts` : clavier (Échap, ↑/↓, focus) ; 390 px plein écran ; session hors périmètre → pas de panneau ; session React Native → tuile frustration « Non collecté » (garde R-F) | `grep -n "export function PanneauSession" apps/console/components/sessions/PanneauSession.tsx` rend une ligne et le composant n'est importé que par `app/sessions/page.tsx` |
| **F44 — Détail : en-tête, résumé, onglets** | puces de contexte, 5 `KpiTile`, onglets comptés, compat `tab=replay`/`timeline`, `not-found.tsx`, `loading.tsx`, `error.tsx` | `app/sessions/[id]/{page,loading,error,not-found}.tsx`, `lib/queries.ts` (typage `SessionMeta`) | F03, F07 | M | e2e : ancien lien `?tab=replay&at=` fonctionne ; aucun `user_id_hash` dans le HTML ; onglet à compte inconnu → « (—) » | capture 12 refaite |
| **F45 — Détail : déroulé groupé par vue** | `lib/deroule.ts`, `Deroule.tsx`, filtres `voir=`, phases réseau repliées, liens sortants (après B32), bandeau 500 lignes | `lib/deroule.ts`, `components/sessions/Deroule.tsx`, `components/sessions/Timeline.tsx` | F44, B32 (liens) | L | unitaires `grouperParVue` (vital rattaché à la bonne vue ; 8 phases → « Phases réseau (8) » ; action et ses effets) ; e2e : `voir=error` ne montre que les erreurs | plus aucune ligne « Vital RTT » sur la session de démo |
| **F46 — Détail : cascade et Web Vitals situés** | onglet Cascade ; onglet Web Vitals avec `DistributionSeuils valeurMarquee`, fenêtre ancrée sur la session (`fenetreDeSession`, § 3.5) | `app/sessions/[id]/page.tsx`, `lib/deroule.ts` (conversion vers `Cascade.elements`) | F45, F04, F05, F07 | M | unitaire : conversion items → éléments de cascade (vue = jusqu'à la vue suivante, dernière vue = jusqu'à `last_seen_at`, dit) ; unitaire `tests/unit/deroule.test.ts` : `fenetreDeSession` (session de 20 j, session de 2 h) ; e2e : la méta contient « du JJ/MM au JJ/MM » et le lien de la tuile porte `from`/`to` | ouverture d'une session de démo de plus de 7 jours : la méta ne contient pas « 7 derniers jours » |
| **F47 — Détail : rejeu synchronisé** | `ReplaySynchro`, marqueurs, vitesses 1×/2×/4×, saut d'inactivité (option du `Replayer` rrweb — **non établi** : vérifier `skipInactive` dans `@rrweb/replay` avant de le promettre), « Réessayer », bandeau de couverture 2 min / 1 Mo / 30 j, `ignores` (B36) | `components/replay/{ReplayPlayer,ReplaySynchro}.tsx`, `app/api/replay/[sessionId]/route.ts` | F45, B36 | L | unitaire : correspondance temps → ligne active (recherche dichotomique) ; e2e : focus d'une ligne déplace la tête (lecture de l'état `positioned`) ; 390 px : rejeu non chargé sans geste | vidéo de démonstration interne ; `tests/unit/replay-masquage.test.ts` toujours vert |
| **F48 — Acquisition** | KPI, barres des canaux (zéros compris), texte « direct », référents, états plafond ; table croisée et série après B31 | `app/acquisition/page.tsx`, `lib/acquisition.ts` | F40, F03 ; B31 pour A4, A6 | M | unitaire `acquisition.test.ts` : 5 canaux toujours renvoyés, parts sur `total` ; e2e : aucun anneau ; bandeau plafond simulé | capture 13 refaite |
| **F49 — Rétention** | `courbeRetention` pure, `MatriceCohortes`, « Par appareil », sélecteur 4/8/12/26 dans l'en-tête | `lib/cohorts.ts`, `components/charts/MatriceCohortes.tsx`, `app/retention/page.tsx`, `lib/palette.ts` (`SEQUENTIELLE`) | F40, F01 (`SEQUENTIELLE`), F03 (`LineTrend.series`, `MatriceCohortes`) | M | unitaires `tests/unit/cohorts.test.ts` : pondération (2 cohortes complètes de 10 et 30 visiteurs, 50 % et 10 % → 20 %) ; `incomplete` sur la semaine courante ; cohorte à S+1 incomplète exclue (taux inchangé, `exclues = 1`) ; e2e : période globale affichée désactivée avec sa raison | capture 14 refaite |
| **F50 — Parcours** | Sankey (totaux, hauteur, couleurs, ancrage après B31), tables miroir, entonnoir (deux taux nommés, options annotées, plus forte perte) | `components/{Sankey,Funnel}.tsx`, `lib/sankey.ts`, `app/paths/page.tsx` | F40, F03 ; B31 (ancrage, parts), B33 (étapes typées) | L | unitaires `sankey.test.ts` (hauteur), `funnel.test.ts` (plus forte perte) ; e2e : clic ruban → `/sessions?qf=route&q=` | capture 15 refaite ; aucune part calculée sur un top N |
| **F51 — Formulaires** | KPI (médiane), classement par abandons avec garde n < 30, champs dans l'ordre médian (p50 / p75, retours), texte « abandon », bandeau 5 000 | `lib/form-analytics.ts`, `app/forms/page.tsx` | F40, F03, F05 ; B34 (série, sessions) | M | unitaires `tests/unit/form-analytics.test.ts` : ordre médian, médiane, garde n < 30, segments `[abandonsIci, autres]` de somme = tentatives, `incoherents` ; e2e sur un jeu de démo avec 2 formulaires | capture 16 refaite avec données (jeu de démo à ajouter : `demo/` — **non établi** qu'il contienne des événements `form.*`) |
| **F52 — Carte** | nœud « Autres routes », santé `unknown`, tendance chiffrée, `ImpactTable`, « Pages les plus visitées » toujours visible, panneau nœud (série après B37) | `lib/map.ts`, `components/map/ExperienceMap.tsx`, `app/map/page.tsx` | F40, F05, F07 (type de panneau `noeud`) ; B37 | M | unitaires `map.test.ts` : arêtes vers une route masquée agrégées dans « Autres » ; e2e : carte vide n'efface pas « Pages les plus visitées » ; 390 px : table au lieu du graphe | capture 19 refaite (vide et non vide) |
| **F53 — Écrans d'usage sur le contrat** | après B31 : retrait de `legacy` pour `/acquisition`, `/paths`, `/forms` ; `cmp=prev` sur leurs KPI ; retrait du refus provisoire de F40 ; notes « lecture non migrée » retirées | `lib/surfaces.ts`, pages citées | B31, F48, F50, F51 | M | e2e : plage personnalisée acceptée ; tablette acceptée ; `seg=v2:browser:is_null` accepté ; viewer restreint + `app=all` lit ses seules apps | `grep -n "now() - interval" apps/console/lib/queries-{acquisition,paths,funnel,form-analytics}.ts` vide |
| **F54 — États et largeurs du domaine** | `loading.tsx` / `error.tsx` pour les 7 routes ; `SectionErreur` autour de chaque figure ; e2e « aucun débordement » et « base coupée → Réessayer » sur les 7 écrans ; revue `role="img"` + alternative | `app/{sessions,sessions/[id],acquisition,retention,paths,forms,map}/{loading,error}.tsx`, `tests/e2e/usages-*.spec.ts` | F41–F52 | M | e2e cités | `find apps/console/app/{sessions,acquisition,retention,paths,forms,map} -name error.tsx` rend 7 fichiers |

Ordre dans le domaine : F40 (avant tout) → F41, F44, F48, F49 en parallèle → F42, F45, F50, F51, F52 →
F43, F46, F47 → F53 (après B31) → F54.

#### Fiabilité et robot — F55 à F69

Toutes les lectures « à créer » sont des requêtes sans migration ; les migrations (B50-B53) ne bloquent
que les widgets qui les citent, affichés avec leur raison.
| Lot | Périmètre | Fichiers touchés | Dépend de | Taille | Tests | Preuve de fin |
|---|---|---|---|---|---|---|
| **F55 — Vérité du domaine** | (1) `/forecast` : `format` passé en `FormatId` (ou chaîne) au lieu d'une fonction (§ 5.20.0), sans attendre F04 ; (2) libellé « Occurrences d'erreurs pour 100 pages vues », seuil « 2 % » retiré, `thresholdLabel` et seuil LCP lus dans `THRESHOLDS` ; (3) narration : « 7 jours » partout ; (4) `SloStatusRow.attainment: number \| null`, `fast_burn: boolean \| null` et les pages qui les lisent ; (5) `blindSpots` : borne liée depuis `THRESHOLDS.LCP[0]` ; (6) émoji « 👍 » retiré de `/correlation` | `app/forecast/page.tsx`, `components/charts/ForecastChart.tsx`, `lib/forecast.ts`, `lib/queries-alerting.ts`, `app/slo/page.tsx`, `components/slo/SloStatusRow.tsx`, `lib/queries-v2.ts`, `app/correlation/page.tsx` | F00 (pour ne pas refaire ses corrections de libellés) | S | `tests/unit/forecast.test.ts` (7 j) ; `tests/unit/slo.test.ts` (rendu avec `attainment = null`) ; `tests/unit/correlation.test.ts` (borne liée de `blindSpots`, forme SQL) ; e2e `tests/e2e/fiabilite.spec.ts` : `/forecast` rend sans « Application error » avec les données de démo | capture `24-forecast.png` refaite : l'écran s'affiche ; `grep -n "2500" apps/console/app/forecast apps/console/lib/queries-v2.ts` vide |
| **F56 — Composants du domaine** | `BudgetBars`, `FriseDeclenchements`, `MatriceConcordance`, `FriseEtats` (props au § 4.2 et § 4.3) ; démonstration dans la vitrine de composants `app/admin/composants/page.tsx` (F03) | `components/charts/{BudgetBars,FriseDeclenchements,MatriceConcordance,FriseEtats}.tsx`, `app/admin/composants/page.tsx` | F03 ; `SERIE_MARGES` exporté par `ThresholdSeries` (F04) | M | `tests/unit/{BudgetBars,FriseDeclenchements,MatriceConcordance,FriseEtats}.test.tsx` : `null`, dépassement > 150 %, troncature, cellule 0, case `absent`, aucune bande dans `FriseEtats` ; `role="img"` + alternative | page `/admin/composants` montrant chaque état de chaque composant, à 390 et 1440 sans débordement |
| **F57 — Lectures Robot et réel** | `syntheticFreshness`, `correlationConcordance` (effectif minimal 30), `rum_lcp_n` dans `correlationSources`, `correlationRoutes` en couples, `correlationSeries(app, route, f)` avec `syn_state`, `syn_measures`, `rum_lcp_n` ; `blindSpots` (`syn_measures`, `rum_lcp_n`, effectif) ; `lireSerie` / `ecrireSerie` | `lib/queries-v2.ts` (ou nouveau `lib/queries-correlation.ts` qui réexporte, sans casser l'API `/api/v1/correlation`), `lib/correlation-serie.ts` | F55 | M | `tests/integration/correlation-sql.test.ts` : seed de 4 heures → matrice attendue ; heure vide → `null` après alignement ; deux apps avec `/checkout` → deux couples, une ligne par heure et par couple ; robot arrêté → `dernier` ancien ; `apps = []` → aucune ligne ; `tests/unit/correlation-serie.test.ts` | `GET /api/v1/correlation` inchangé (test de contrat `api-v1-contract.test.ts` vert) |
| **F58 — Écran Corrélation** | § 5.7 entier (deux panneaux du hero, sélecteur à couples, matrice, tables) ; suppression de `RobotVsRealChart` et `RouteCard` s'ils ne sont plus importés | `app/correlation/page.tsx`, `components/correlation/*`, `components/features/RobotVsRealChart.tsx` | F04 (dont `grille`, `effectifCle`), F08 (annotations), F56, F57 | L | e2e `tests/e2e/fiabilite.spec.ts` : KPI CR4 = cellule angle mort de CR8 ; `?route=/partners` ouvre le hero sur `/partners` ; clic sur un seau → URL avec `from`/`to` et `serie=<app>:<route>` ; aucune série robot dans le panneau réel ; alignement frise / série ≤ 2 px à 390 et 1440 ; 390/768/1440 sans débordement | capture `20-correlation.png` refaite : hero (deux panneaux) + matrice au-dessus du pli à 1440 × 900 ; plus de « écart −90 % » |
| **F59 — Lectures Tracing** | `apiCallsDecomposition`, `spanLatencySeries`, champ `err` de `traceCoverage`, `errorsOfTrace`, `slowTraces(f, { appel })` (§ 4.5) ; `lib/tracing-ancres.ts` | `lib/queries-tracing.ts`, `lib/tracing-ancres.ts` | — | M | `tests/integration/tracing-sql.test.ts` : médiane de part serveur (cas 0,9 / 0,1 → 0,5) ; p75 trajet ≠ `front_p75 − back_p75` ; seaux vides à `null` ; `errorsOfTrace` avec `apps = []` → vide ; trace partagée entre deux apps → seulement l'app autorisée ; `slowTraces` avec `appel` ne rend que cet appel ; `tests/unit/tracing-ancres.test.ts` | `GET /api/v1/tracing` inchangé |
| **F60 — Écran Tracing** | § 5.8 entier ; `DeployPanel` en état `non_collecte` au lieu de disparaître | `app/tracing/page.tsx`, `components/tracing/*`, `lib/tracing-hero.ts` (`lignesHero`) | F04, F59 | M | `tests/unit/tracing-hero.test.ts` : aucun `segments` ; e2e (étend `tests/e2e/tracing.spec.ts`) : légende « Barre = durée p75 vue du navigateur » ; clic sur une barre de T6 → l'élément `appel-<hash>` existe et est visible (hors `<details>`) ; « Traces de cet appel » → URL avec `appel=` et `#traces` ; lien de rejeu avec `at` ; sans déploiement, « POST /api/v1/deploys » visible ; 390/768/1440 | capture `17-tracing.png` refaite avec des spans seedés |
| **F61 — Détail de trace** | ton par statut, copie de l'identifiant, apps multiples, rejeu à l'instant, « Erreurs liées » | `app/tracing/[traceId]/page.tsx`, îlot `components/tracing/CopierTrace.tsx` | F07, F59 | S | e2e `tests/e2e/tracing.spec.ts` : span 503 en ton `erreur` ; bouton de copie ; `?span=` inconnu → état `missing` | capture `18-trace-detail.png` refaite |
| **F62 — Lectures SLO et alertes** | `slo_id` dans `AlertEventRow`/`alertEvents` ; `alertEventsByDay` ; `alertFirings` ; compte « non livrées 30 j » | `lib/queries-v2.ts` | F55 | M | `tests/integration/alertes-sql.test.ts` : 150 événements sur 30 j → somme 150 ; événement `pending` non compté comme non livré ; base sans v73 → pas d'erreur (même garde `to_regclass`, L205-228) | `pnpm test:alerting` (`scripts/verify-alerting.mjs`) vert |
| **F63 — Écran SLO** | § 5.18 entier | `app/slo/page.tsx`, `components/slo/SloStatusRow.tsx` | F56, F62 | M | `tests/unit/BudgetBars.test.tsx` ; e2e : SLO sans mesure → « Non mesurable » (jamais « 0 % ») ; viewer → aucun bouton d'écriture ; SL4 affiche « Non collecté » | capture `22-slo.png` refaite avec 3 SLO seedés (tenu, dépassé, non mesurable) |
| **F64 — Écran Alertes** | § 5.19 entier, formulaire par mode, `evt` et pré-remplissage `regle_*` (§ 3.1) | `app/alerts/page.tsx`, `components/alerts/*`, `lib/view-state.ts` (déclaration des paramètres, si F06 est livré) | F56, F62 | L | e2e : bandeau « aucun canal » au-dessus des KPI ; mode seuil sans champs baseline ; lien de mesure avec `from/to` ; route affichée dans le flux ; `?evt=<id>` met l'événement en évidence ; `?regle_route=/checkout` pré-remplit sans note de filtre non appliqué ni propagation ; 390/768/1440 | capture `23-alerts.png` refaite ; le widget « Votre avis ? » ne recouvre plus les KPI (réserve basse F09) |
| **F65 — Écran Tendances** | § 5.20 entier ; `dispersionResidus`, `penteSignificative` ; fenêtre de 14 jours complets ; `n` et jours vides dans `dailyLcpSeries` ; `dailyTraffic(f, { exclureAujourdhui })` ; liens aux bornes UTC du jour local | `app/forecast/page.tsx`, `lib/forecast.ts`, `lib/queries-grid.ts` | F04 (`bande`, `role:"projection"`, `forme`), F05 (`lib/fuseau.ts`), F55 | M | `tests/unit/forecast.test.ts` (bruit, 7 jours requis, jour partiel exclu) ; `tests/unit/forecast-liens.test.ts` (fuseau) ; `tests/integration/grille-sql.test.ts` : `dailyLcpSeries` rend 14 lignes, aujourd'hui exclu, jour vide à `null` ; e2e : bandeau de fenêtre fixe visible, changer de preset ne change pas les chiffres | capture `24-forecast.png` refaite |
| **F66 — Écran Conversions** | § 5.14 entier : lectures sur `sqlContext` (§ 5.14.3), requête unique, `intervalleWilson`, `goalConversionsByDevice` ; `/goals` quitte `legacy`, `range: "custom"` | `app/goals/page.tsx`, `lib/goals.ts`, `lib/queries-goals.ts`, `lib/surfaces.ts` | F03, F00 (`conversionRate` → `null`), F40 (refus provisoire, jusqu'à ce lot) | M | `tests/unit/goals.test.ts` (Wilson, `null`) ; `tests/integration/goals-sql.test.ts` : même résultat que l'ancienne boucle sur un seed de 5 objectifs (une app) ; **viewer restreint à A + `app=all` → aucune ligne ni session de B** dans `listGoals`, `goalConversions`, `goalConversionsByDevice` ; `apps = []` → zéro ligne ; e2e `tests/e2e/usages-perimetre.spec.ts` (étendu) : même cas sur l'écran | capture `21-goals.png` refaite avec 3 objectifs ; `grep -n "is null or app_id = \\$1\|is null or p.app_id\|is null or ev.app_id" apps/console/lib/queries-goals.ts` vide |
| **F67 — Annotations d'alerte et liens croisés** | annotations `type:"alerte"` sur les séries CR7 et T7 depuis `alertEvents` filtré par route et plage ; paramètre `evt` (§ 3.1) ; liens SLO ↔ alertes | `lib/annotations.ts` (fonction ajoutée), pages du domaine | F08, F62 | S | `tests/unit/annotations.test.ts` (alerte hors plage exclue, regroupement > 6) | e2e : clic sur une annotation d'alerte → `/alerts?evt=<id>` avec l'événement mis en évidence |
| **F68 — Règle de régression de release (interface)** | option du formulaire activée quand B52 existe (détection par `to_regclass` ou colonne, comme v73) ; seuil par défaut 20 % ; phrase obligatoire | `components/alerts/RuleFields.tsx`, `app/alerts/actions.ts` | F64, **B52** | S | e2e : sans B52, l'option est désactivée avec sa raison ; avec B52 (base de test), création puis affichage | — |
| **F69 — Recette du domaine** | e2e 390 / 768 / 1440 sur les sept routes ; clavier (tabulation, Échap, focus des cases de `FriseEtats`), alternatives textuelles, contraste des légendes ; captures claires et sombres | `tests/e2e/fiabilite.spec.ts` (nouveau) | F58-F66 | M | `debordements` vide sur chaque route et chaque largeur ; chaque `Figure` avec données a une alternative non vide | 21 captures (7 routes × 3 largeurs) déposées dans le dossier de captures de la PR |

Ordre dans le domaine : F55 d'abord, **dès F00** : il débloque un écran en panne. Ensuite F57, F59 et
F62 (lectures) en parallèle des fondations F01-F06. Puis F56 après F03 et F04. Puis les écrans F58, F60,
F61, F63, F64, F65, F66 selon leurs dépendances, puis F67, puis F69. F68 attend B52. `/goals` reste
couvert par le refus de F40 tant que F66 n'est pas livré.

---
## 7. Épique P* — « machine learning » : de la statistique explicable là où Datadog propose de l'apprentissage automatique

> **Ce que cette épique garantit.** Dix sous-lots ordonnés du plus simple et du plus rentable au plus
> ambitieux. Chacun part d'une donnée qui existe déjà (table, colonne, fonction citées avec leur
> ligne), emploie la méthode la plus simple qui réponde à la question, dit à partir de quel volume
> elle répond et ce qu'elle affiche avant ce volume, et nomme l'écran (§ 5) et le composant (§ 4) où elle
> s'affiche. Toute formule est écrite à l'écran ou dans une bulle
> d'aide : aucune boîte noire.
>
> **Ce qu'elle ne garantit pas.** Aucun sous-lot n'est un modèle « appris » au sens où des paramètres
> seraient estimés sur un historique pour prédire : à notre volume, ce serait ajuster du bruit
> (§ 7.0). Le titre de l'épique dit « machine learning » parce que c'est la question posée ; la réponse
> honnête est de la statistique fermée et des règles publiées, plus une porte d'entrée chiffrée
> (§ 7.3) qui dit quand un modèle appris deviendrait défendable. Rien ici n'a été vu sur du trafic réel.
>
> Elle ne garantit pas non plus que ses sous-lots soient visibles à l'écran dès leur livraison : la
> donnée existe, mais **les composants d'affichage nommés sont, sauf trois (`VitalCard`,
> `HealthBanner`, `ForecastChart`), à créer par les lots de fondation F02 à F08**, absents
> du dépôt à `322c9a7` (§ 7.2.0). Les fondations sont un pré-requis de cette épique, pas une option.
>
> **Révision.** Version relue contre le dépôt et recalculée (binomiale exacte) ; les chiffres du § 7.0
> sont vérifiés par un test (P*.1).
>
> **Chemins.** Relatifs au dépôt ; code de la console sous `apps/console/`. Numéros de ligne relevés le
> 21/09/2026 sur `322c9a7`. Les renvois `reads/*.md` désignent les notes de lecture versionnées dans `plan-frontend-notes/` (§ 0.2).

---

### 7.0 Le volume qui décide de tout

**Ce que le dépôt établit.** Aucun trafic depuis le 17/09/2026 17:23
(`_bmad-output/implementation-artifacts/delivery-p8.md:270`) ; « 5 erreurs ingérées au total en
production » (`delivery-p8.md:538`, citation indirecte de `delivery-p5.md`) ; ≈ 97 lignes `rum_event`
sur deux apps en quatre semaines (`docs/RUM_PARITY_STATUS.md:192`). Relevé complet :
`reads/ml-paysage.md` L10-32.

**Hypothèse de dimensionnement retenue** (celle de la demande) : **30 sessions par jour et par app**,
soit ≈ 210 par semaine et ≈ 900 sur 30 jours (plafond de plage, `lib/query-contract.ts:L25`). C'est
un plafond optimiste par rapport au § précédent ; chaque sous-lot dit ce qu'il affiche en dessous.

Ce que ce volume permet, calculé (intervalle de Wilson à 95 %, règle de trois, rangs exacts d'un
quantile — formules en P*.1 et P*.2) :

| Question | 30 sessions (1 jour) | 210 (7 jours) | 900 (30 jours) |
|---|---|---|---|
| Part de sessions en erreur observée à 10 % : intervalle à 95 % | 3,5 % – 25,6 % | 6,6 % – 14,8 % | 8,2 % – 12,1 % |
| Zéro erreur observée : part maximale compatible (95 %) | 10 % | 1,4 % | 0,33 % |
| Deux releases, erreur à 10 % : plus petit écart détectable (puissance 80 %) ¹ | — | ≈ 12 points (100/100) | ≈ 12 points si 100/100 ; ≈ 5,6 points si 450/450 |
| p75 d'un vital : nombre minimal de mesures pour un intervalle à 95 % bilatéral ² | 13 | 13 | 13 |

¹ Formule de P*.5, deux échantillons : `(1,96 + 0,84) · √(p̄(1 − p̄)(1/nA + 1/nB))`, p̄ = 0,10.
100/100 : `2,8 · √(0,09 · 0,02) = 2,8 · 0,0424 = 0,119` → ≈ 12 points. 450/450 :
`2,8 · √(0,09 · 0,00444) = 2,8 · 0,0200 = 0,056` → ≈ 5,6 points. Passer de 7 à 30 jours divise
l'écart détectable par ≈ 2,1 (√4,5), pas par 3. Ce tableau n'est pas recopié à la main dans le code :
`tests/unit/stats-cadrage.test.ts` (P*.1) le recalcule à partir de `ecartDetectable`, `wilson` et
`regleDeTrois` et échoue si une cellule s'écarte de plus de 0,1 point de ce qui est écrit ici.

² Sous 13 mesures, aucune borne haute n'est possible avec un risque ≤ 2,5 % de ce côté :
`P(B = n) = 0,75ⁿ` vaut 0,032 à n = 12 et 0,024 à n = 13 (B ~ Binomiale(n ; 0,75), règle en P*.1).

Conséquences qui structurent l'épique :

1. **Le grain horaire par route est hors de portée.** Une p75 horaire d'une route calculée sur 1 à 3
   mesures n'est pas une p75 (13 mesures minimum pour la situer). Tout ce qui suit travaille au jour,
   à la semaine, ou à l'app entière.
2. **Le premier besoin n'est pas de détecter, c'est de dire à quel point un chiffre est sûr.** D'où
   l'ordre : incertitude (P*.1), sens du zéro (P*.2), détecteurs qui disent s'ils ont pu tester
   (P*.3), avant toute détection nouvelle.
3. **Un détecteur silencieux doit distinguer « testé, rien trouvé » de « pas testable ».** Le dépôt
   ne le fait pas aujourd'hui (constat VM2 ci-dessous).

#### 7.0.1 Quatre constats de vérité relevés en écrivant l'épique (à verser à F00)

| Id | Constat | Preuve | Correction proposée |
|---|---|---|---|
| VM1 | La narration des tendances annonce « l'horizon de 3 jours » alors qu'elle signale les franchissements jusqu'à J+7 | `apps/console/lib/forecast.ts:78` (`eta <= 7`) vs `:82` (« horizon de 3 jours ») | Phrase dérivée de la même constante `HORIZON_JOURS = 7` ; test unitaire qui compare le texte et le filtre. Repris par P*.4. |
| VM2 | La composante « Anomalies » du score de santé vaut 10/10 (« aucune anomalie détectée ») quand `v_anomaly` ne peut rien tester : aucune route n'atteint 5 heures d'historique ou l'écart-type est nul, et la vue ne rend alors aucune ligne | `apps/ingest/sql/migration-v03.sql:80` (garde `count(*) >= 5 and stddev_samp(p75) > 0`) ; `apps/console/lib/health.ts:207` (`anomaliesRatio` = 1 sans ligne), `:247` (« aucune anomalie détectée »), `:198-200` (bloc `catch` qui avale la vue absente, commentaire `:199`) | `earned: null` et « non testable : 0 route avec 5 heures de mesures » quand aucune route n'est éligible ; la composante est alors exclue et renormalisée comme les autres (`health.ts:259-262`, `available = factors.filter(x => x.earned != null)` ; le cas `filtree` y passe déjà, `:248`). Repris par P*.3. |
| VM3 | Sur `/forecast`, « Taux d'erreur JS » est aidé par « Part de pages vues avec au moins une erreur » mais calculé comme occurrences / pages vues × 100 (peut dépasser 100 %) | `apps/console/app/forecast/page.tsx:48` vs `:65` ; `dailyTraffic` somme bien `occurrences` (`lib/queries-grid.ts`, requête L125-168) | Libellé « Occurrences d'erreurs pour 100 pages vues », seuil d'alerte revu en conséquence. |
| VM4 | L'impact du dernier déploiement compte les occurrences ±2 h sans dénominateur : 0 occurrence sans aucune page vue s'affiche « 0 », et `assessRegression` ne peut jamais conclure à une régression quand l'avant vaut 0 | `apps/console/lib/queries-deploys.ts:83-88` (`coalesce(…, 0)`), `:103-110` (`before <= 0` → pas de régression) | F00 (10) : `pageviews_*`, `sessions_*` ajoutés et `errors_*` à `null` si 0 page vue, signature au § 4.5 (« lib/queries-deploys.ts — F00 ») ; verdict statistique de P*.5. |

Constat de périmètre : `reads/ml-paysage.md` L70 écrit « aucune » détection médiane/MAD chez nous.
C'est inexact : les règles d'alerte en mode `baseline` emploient déjà une médiane et un MAD
saisonniers (même jour de semaine, même heure, `baseline_weeks` = 4 par défaut), avec une garde
`n >= 4` (`apps/ingest/sql/migration-v17.sql:17-19` pour les colonnes ; fonction courante
`metric_baseline`, `migration-v68.sql:51`, garde `:232`). À 30 sessions par jour, cette garde n'est
atteinte que si la même heure du même jour a eu du trafic quatre semaines de suite : P*.3 l'affiche.

---

### 7.1 Règles communes aux dix sous-lots

- **RM1 — Logique pure, testée, sans accès base.** Chaque calcul vit dans un module `apps/console/lib/`
  sans import de `db`, sur le modèle de `lib/forecast.ts:1-4`. Les requêtes ne font que compter.
- **RM2 — Refus avant volume.** Chaque fonction rend un type à deux issues :
  `{ ok: true, … } | { ok: false, raison: string, manque: { requis: number; observe: number; unite: string } }`.
  L'écran affiche « Pas encore assez de données : 7 mesures LCP sur la période, 13 requises pour un
  intervalle » — jamais une valeur par défaut, jamais 0.
- **RM3 — L'incertitude est écrite en mots et en chiffres**, pas seulement dessinée : « entre 2,1 s et
  3,0 s (intervalle à 95 %) ». Le dessin (bande, moustache) double le texte, il ne le remplace pas.
- **RM4 — La règle est affichée à côté du résultat**, dans la `lecture` de la `Figure` ou dans
  `InsightStrip.regle` (§ 4.2) : nom du test, seuil, effectifs, fenêtre.
- **RM5 — Association n'est pas cause.** Les mots « cause », « à cause de », « responsable » sont
  interdits dans les textes produits par ces modules ; un test unitaire par module vérifie les
  gabarits (`expect(texte).not.toMatch(/cause|responsable/i)`).
- **RM6 — Populations.** Les tests portent sur des sessions **ou** sur des mesures **ou** sur des
  occurrences (`sum(occurrences)`), jamais un mélange ; sessions, visiteurs et identités ne
  s'additionnent pas. Un test de proportion porte sur des sessions (une session à 50 occurrences
  compte une fois).
- **RM7 — Aucun poids d'échantillonnage appliqué.** Les calculs portent sur ce qui est observé ; si
  `sample_rate` ou `error_sample_rate` < 1 dans la population, le bandeau `echantillonne`
  (§ 3.8) s'affiche et le texte de résultat dit « sur les sessions observées ».
- **RM8 — Plage et périmètre.** Toutes les lectures passent par `sqlContext(f)` (fenêtres UTC
  `[from, to)`, presets 1h / 24h / 7j, plage ≤ 30 j, `app_id` lié) ou disent qu'elles gardent une
  fenêtre fixe (14 j de `queries-grid.ts`) via `rangeNote`. `apps = []` = zéro accès : les lectures
  héritent de `resolveScope` (`lib/query-contract.ts:L192-203`).
- **RM9 — Lecture seule pour viewer et démo.** Seul P*.10 comporte un geste (« Écarter la
  suggestion ») ; il est masqué pour un viewer, un compte démo et un jeton API.
- **RM10 — Coût.** Tout ce qui est « JS pur » tourne dans les composants serveur de la console, sur des
  tableaux de quelques centaines de valeurs au plus ; aucun service ni dépendance npm ajouté (les
  fonctions de loi — binomiale, hypergéométrique, t de Student — sont écrites dans
  `lib/stats/lois.ts` et testées contre des valeurs tabulées).

Modules communs créés par P*.1 et réutilisés ensuite :

| Module | Contenu |
|---|---|
| `apps/console/lib/stats/lois.ts` | `lnFactorielle` (table + Stirling au-delà de 170), `binomCdf`, `hypergeomQueue`, `tStudentQuantile(p, ddl)` (table exacte ddl ≤ 30, approximation de Cornish-Fisher au-delà), `normQuantile` |
| `apps/console/lib/stats/incertitude.ts` | `rangsQuantileExact(n, q, niveau)`, `rangsQuantileNormal(n, q, niveau)`, `wilson(k, n)`, `newcombe(kA, nA, kB, nB)`, `regleDeTrois(n)`, `ecartDetectable(p, nA, nB)` |
| `apps/console/lib/stats/types.ts` | `Resultat<T>` (RM2), `Intervalle = { bas: number; haut: number; niveau: 0.95; methode: MethodeIntervalle }` |

---

### 7.2 Les dix sous-lots

#### 7.2.0 Pré-requis : les composants d'affichage n'existent pas encore

**Aucun sous-lot de cette épique ne peut être vu en entier à l'écran avant que les lots F02, F03,
F04, F05, F07 et F08 (§ 6) soient livrés ; c'est un pré-requis de l'épique, pas une
option.** Relevé sur `322c9a7` (`find apps/console -iname '*<nom>*'`) : `EtatSurface` (F02),
`KpiTile` (F03), `ThresholdSeries` (F04), `DistributionSeuils`, `ImpactTable`, `ContrastBars` (F05),
`DetailPanel`, `Cascade` (F07), `InsightStrip`, `ReleaseCompare` (F08) sont absents. Existent déjà :
`components/VitalCard.tsx` (avec la jauge `ThresholdMeter`, fonction interne non exportée,
`VitalCard.tsx:29`, rendue `:96`), `components/health/HealthBanner.tsx`,
`components/charts/ForecastChart.tsx`. Ces fondations ne figurent dans aucun verdict de
`docs/RUM_PARITY_STATUS.md` (qui couvre le backend) : leur statut est « non commencé ».

Ordre global recommandé, fondations comprises (voir aussi § 6.2) :

1. **F00** (corrections de vérité, M), puis **incrément 0 de cette épique** (ci-dessous), qui ne
   dépend que de F00 ;
2. F01, F02, F06 en parallèle → F03 → F04, F05, F07 → F08 (§ 6.2, ordre recommandé) ;
   F01 à F08 (F01 et F06 étant pré-requis de F03, F07 et F08) cumulent 3 M + 5 L, soit jusqu'à
   ≈ 34 jours en série, moins en parallèle (estimation, non mesurée) — un ordre de grandeur
   comparable à cette épique elle-même ;
3. P*.1 à P*.10 dans les vagues du § 6.2 : P*.1 et P*.9 en vague 4, P*.2 à P*.5 en vague 5, P*.6 à
   P*.8 en vague 6, P*.10 en vague 8 (sous condition). Chaque vague respecte la colonne « Affichage
   complet après » ci-dessous.

**Incrément 0 — retenu.** Pour montrer un résultat sans attendre les fondations, trois morceaux ne dépendent
que de F00 et de composants existants :

| Morceau | Contenu | Composant existant | Taille |
|---|---|---|---|
| 0-a | `lib/stats/{lois,incertitude,types}.ts` + tests unitaires de P*.1 (dont la table exhaustive n = 13…29) et `tests/unit/stats-cadrage.test.ts` | aucun (logique pure) | M |
| 0-b | Intervalle p75 en texte sous la valeur de `VitalCard` + moustache sur `ThresholdMeter` + verdict « incertain » ; `vitalsP75` rend les valeurs ou les rangs (P*.1 « Où ça tourne ») | `components/VitalCard.tsx` (utilisé par `app/page.tsx`) | S |
| 0-c | Constat VM2 : composante « Anomalies » à `earned: null` et « non testable » quand 0 route est éligible (partie (a) de P*.3) | `lib/health.ts`, `components/health/HealthBanner.tsx` | S |

Ce que l'incrément 0 ne garantit pas : aucun intervalle sur les proportions (il faut `KpiTile`), aucun
état vide chiffré (il faut `EtatSurface`), aucune ligne de statut des détecteurs (il faut
`InsightStrip`). Les morceaux 0-b et 0-c seront repris, pas refaits, quand F03 et F08 arrivent :
`VitalCard` est de toute façon amendé par F03 (§ 4.1), qui doit conserver l'intervalle.

#### 7.2.1 Planning

Tailles : S ≤ 1 jour, M ≤ 3 jours, L ≤ 5 jours (estimation, non mesurée), **hors fondations**. Chaque lot
se termine par la définition de « fait » du § 0.4 (`pnpm --filter console typecheck`, `pnpm test:unit`, e2e cités)
(`package.json:9-11`).

| Lot | Titre | Écrans (§ 5) | Dépend de (P*) | Affichage complet après (fondations) | Taille |
|---|---|---|---|---|---|
| P*.1 | Intervalle sur chaque chiffre clé | Vue d'ensemble, Pages, Erreurs, Mobile, Satisfaction, Conversions | incrément 0 | F03, F05 (vitals de `/` : dès 0-b) | M |
| P*.2 | Ce que « zéro » veut dire | Erreurs, Vue d'ensemble, Mobile, Interactions | P*.1 | F02 | S |
| P*.3 | Détecteurs qui disent s'ils ont pu tester + anomalies quotidiennes | Vue d'ensemble (`InsightStrip`, `HealthBanner`), Tendances | P*.1 | F04, F08 (score de santé : dès 0-c) | M |
| P*.4 | Tendance avec bande et test de pente | Tendances `/forecast` | P*.1 | F04 | M |
| P*.5 | Release contre release : verdict à trois issues | Vue d'ensemble (`ReleaseCompare`, carte déploiement), Alertes | P*.1 | F08 | L |
| P*.6 | Valeurs sur-représentées, test publié | Erreurs (panneau), Pages (panneau route), `InsightStrip` | P*.1 ; backend B3 (+ B2) | F05, F08 | L |
| P*.7 | « Depuis quand ? » : datation d'une rupture | Vue d'ensemble (hero), Tendances | P*.3 | F04 | M |
| P*.8 | Robot et réel : concordance mesurée | Corrélation `/correlation` | P*.1, P*.3 | F04 (hero `ThresholdSeries` robot / réel) | M |
| P*.9 | Récit de session composé de faits | Détail de session `/sessions/[id]` | — | F07 | M |
| P*.10 | Suggestion de doublons d'issues, sous contrôle humain | Issue `/errors/issues/[id]` | regroupement v2 activé sur au moins une app | F02 (`CapaciteFermee` existe déjà) | L |

La logique de chaque lot (`lib/stats/*`, `lib/forecast.ts`, requêtes) peut être écrite et testée
avant son « affichage complet » ; elle n'est pas montrée tant que le composant manque, et la PR le
dit. P*.9 ne dépend d'aucun autre P* et peut être avancé si l'écran de session est prioritaire.

---

#### P*.1 — Intervalle sur chaque chiffre clé

**Question métier.** « Ce LCP p75 de 2,4 s, ce taux de 8 % de sessions en erreur : à quel point
bougeraient-ils avec d'autres visiteurs de la même période ? Et le verdict « À améliorer » tient-il ? »

**Ce que les autres n'offrent pas.**
- Datadog : les tuiles et séries RUM des captures et de la documentation relues affichent une valeur
  et un verdict coloré, sans intervalle (`reads/datadog-images-1.md` § 1 ; `reads/datadog-docs-explorer-dashboards.md`
  § 4) ; les bornes de déviation n'existent que dans les monitors de prévision et d'anomalie
  ([Forecasts](https://docs.datadoghq.com/monitors/types/forecasts/), [Anomaly](https://docs.datadoghq.com/monitors/types/anomaly/)).
  Un intervalle sur une p75 RUM : **non trouvé** dans les sources consultées.
- IP-Label : « p75 par segment » décrit en texte, aucun intervalle mentionné (`reads/iplabel.md`
  L56-58, L87-98) — non établi au-delà.
- Grafana : panneaux « stat » + tendance (`reads/grafana.md` § b) ; intervalle sur percentile non
  trouvé.
- Pour eux, à des millions de sessions, l'intervalle est négligeable ; pour nous, à 13 mesures, il
  change le verdict. C'est un besoin propre à notre volume.

**Signal d'entrée.**
- Vitals : `rum_metric (name, value)` filtré sur `CORE_VITALS` (`lib/rating.ts:34`), via
  `vitalsP75(f, shift)` (`lib/queries.ts:L46`, rend déjà `n`).
- Proportions : `healthScore` (`lib/health.ts:167-182` : `sessions`, `clean_sessions`) ;
  `comparaisonVersions` (`lib/queries-deploys.ts:L162` : `sessions`, sessions en erreur) ;
  `mobileSummary.js_error_free_session_rate` (`lib/queries-mobile.ts:L299`) ; `goalConversions`
  (`lib/queries-goals.ts:L69`) ; `feedbackStats` (`lib/queries-experience.ts:L22`, promoteurs /
  détracteurs).

**Méthode la plus simple qui marche.**
- **p75 : intervalle de quantile par statistiques d'ordre** (aucune hypothèse de loi). Pour n mesures
  triées, l'intervalle est `[x(r), x(s)]` avec r, s choisis pour que `P(r ≤ B < s) ≥ 0,95`,
  B ~ Binomiale(n ; 0,75).
  - n de 13 à 29 : rangs **exacts** calculés par `rangsQuantileExact`, **règle à queues égales** :
    - `r` = le plus grand rang tel que `P(B ≤ r − 1) ≤ 0,025` (risque que la vraie p75 soit sous
      `x(r)`) ;
    - `s` = le plus petit rang tel que `P(B ≥ s) ≤ 0,025` (risque qu'elle soit au-dessus de `x(s)`) ;
    - couverture `P(r ≤ B ≤ s − 1) ≥ 0,95` par construction (chaque queue ≤ 0,025) ; si aucun `s ≤ n`
      n'existe (n ≤ 12, car `P(B = n) = 0,75ⁿ > 0,025`), refus RM2 — c'est l'origine du minimum 13.
    - Pas de choix de largeur minimale : celle-ci donne parfois deux intervalles de même largeur
      (n = 18, 19, 20, 23…) et obligerait à une règle de départage ; la règle à queues égales n'en a pas
      besoin et garde les deux risques bornés séparément, ce que le texte affiché peut dire.
    - Valeurs produites (recalculées par binomiale exacte, script de vérification de cette révision) :

      | n | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 |
      |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
      | (r, s) | 7, 13 | 7, 14 | 8, 15 | 8, 16 | 9, 17 | 10, 18 | 10, 19 | 11, 19 | 12, 20 | 12, 21 | 13, 22 | 14, 23 | 14, 24 | 15, 25 | 16, 25 | 16, 26 | 17, 27 |
      | couverture | 0,952 | 0,972 | 0,969 | 0,983 | 0,980 | 0,975 | 0,987 | 0,962 | 0,960 | 0,975 | 0,974 | 0,970 | 0,982 | 0,979 | 0,958 | 0,972 | 0,971 |

      Les deux exemples de référence (n = 13 → `[x(7), x(13)]` ; n = 20 → `[x(11), x(19)]`) sont bien
      produits par cette règle : à n = 13, `P(B = 13) = 0,024 ≤ 0,025` donc `s = 13` ; à n = 20,
      `P(B ≥ 19) = 0,024 ≤ 0,025` donc `s = 19`.
  - n ≥ 30 : rangs **normaux** `r = max(1, ⌊0,75n − 1,96·√(0,1875n)⌋)`,
    `s = min(n, ⌈0,75n + 1,96·√(0,1875n)⌉ + 1)` ; un test vérifie par la binomiale exacte que la
    couverture reste ≥ 0,95 pour tout n de 30 à 5 000 (vérifié par recalcul jusqu'à n = 1 000, pire
    cas 0,954 à n = 974). Au passage de 29 à 30 mesures, les rangs changent de règle (n = 30 : (17, 29)
    en normal contre (18, 28) en exact) : les deux couvrent ≥ 0,95, la bulle d'aide nomme la méthode
    (`methode: "quantile_exact" | "quantile_normal"`). Le calcul normal est gardé pour n ≥ 30 parce
    qu'il se calcule en SQL dans le même balayage (voir « Où ça tourne ») ; non établi qu'un calcul
    exact pour tout n, en JS après une première lecture de `n`, coûterait moins qu'un aller-retour.
- **Proportions : intervalle de Wilson** (`wilson(k, n)`), correct à petit n et près de 0 % / 100 %,
  contrairement à l'intervalle de Wald.
- **Verdict** : si l'intervalle d'une p75 chevauche un seuil de `THRESHOLDS` (`lib/rating.ts:5-11`),
  le badge devient « verdict incertain : entre Bon et À améliorer » ; sinon, badge inchangé.
- **Delta vs période précédente** (P4) : pour une proportion, intervalle de Newcombe sur la
  différence ; s'il contient 0 → « écart non établi ». Pour une p75, pas de test : les deux
  intervalles sont affichés ; s'ils se chevauchent → « écart non établi » (conservateur : un
  chevauchement n'établit pas l'absence d'écart, et le texte ne le prétend pas).

**Volume minimal et comportement avant.**
- p75 : **13 mesures**. En dessous : la valeur reste affichée (c'est la donnée observée) avec
  « intervalle non calculable : 7 mesures, 13 requises » ; le verdict est remplacé par « verdict non
  établi (moins de 13 mesures) » — pas de couleur de verdict.
- Proportion : pas de minimum mathématique pour Wilson ; sous **30 sessions** au dénominateur, la
  mention « échantillon faible » (P3, `KpiTile.couverture.faibleSous`) s'ajoute à
  l'intervalle. Dénominateur 0 → valeur `null` et sa raison (invariant), aucun intervalle.

**Affichage de l'incertitude et de l'explication.**
- `KpiTile` (§ 4.2) reçoit la prop `intervalle`, déjà déclarée dans sa signature unique :
  ```ts
  intervalle?: { bas: number; haut: number; niveau: 0.95;
                 methode: "quantile_exact" | "quantile_normal" | "wilson" }
             | { indisponible: string };   // « 7 mesures, 13 requises »
  ```
  Pour les Web Vitals de la Vue d'ensemble, la tuile est aujourd'hui `VitalCard`
  (`components/VitalCard.tsx`, utilisée par `app/page.tsx`) : elle reçoit la même prop `intervalle`
  (incrément 0-b), et `KpiTile` la reçoit pour les proportions quand F03 existe.
  Rendu : ligne sous la valeur « entre 2,1 s et 3,0 s (95 %) » ; moustache horizontale sur la jauge
  `ThresholdMeter` (`VitalCard.tsx:29`, fonction interne : elle gagne les props `bas`/`haut`, même
  échelle `max = warn × 1,4`, bornes rognées à l'échelle et signalées « au-delà de l'échelle » dans le
  texte) ; `aria-label` complet (« LCP p75 2,4 s, intervalle 2,1 à 3,0 s, verdict
  incertain entre Bon et À améliorer, 42 mesures »). Bulle `GlossaryTip` : « Intervalle à 95 % par
  rangs de la loi binomiale : si l'on retirait d'autres visiteurs de la même période, la p75 tomberait
  dans cet intervalle 95 fois sur 100. Aucun poids d'échantillonnage n'est appliqué. »
- `ImpactTable` : colonne « intervalle » facultative ; `echantillonFaible` devient vrai sous 13
  mesures pour un pilote p75 (en plus de la règle n < 30 de P3, la plus stricte des deux
  s'applique : n < 30).
- `DistributionSeuils` : bande grisée de l'intervalle autour du repère p75.

**Où ça tourne et coût.**
- SQL : `vitalsP75` gagne, par vital, `case when count(*) < 30 then array_agg(value order by value) end
  as valeurs` (≤ 29 valeurs) et, pour n ≥ 30, deux statistiques d'ordre lues par
  `row_number() over (partition by name order by value)` aux rangs r et s calculés en SQL par la même
  formule que `rangsQuantileNormal` (test d'égalité des deux côtés). Même balayage que
  `percentile_cont` : coût marginal. Lorsque la p75 vient de l'agrégat histogramme
  (`meta.approximate`), `intervalle = { indisponible: "p75 approchée lue sur agrégat : intervalle non
  calculé" }`.
- JS pur pour Wilson, Newcombe, rangs exacts.

**Invariants de vérité.** Jamais de moyenne de p75 (l'intervalle se calcule sur les mesures brutes de
la fenêtre, jamais sur des p75 horaires) ; `null` sans dénominateur ; aucun poids appliqué ; seuils lus
dans `lib/rating.ts` uniquement.

**Fichiers.** `lib/stats/{lois,incertitude,types}.ts` (nouveaux) ; `lib/queries.ts` (`vitalsP75`,
`vitalPercentiles`) ; `components/VitalCard.tsx` (prop `intervalle`, fonction interne
`ThresholdMeter` `:29` et son appel `:96` : moustache) ; `components/charts/KpiTile.tsx`,
`components/ImpactTable.tsx`, `components/charts/DistributionSeuils.tsx` (tous trois créés par
F03 et F05, modifiés ici) ; `lib/glossary.ts` (entrée `intervalle`).

**Tests.**
- `tests/unit/stats-lois.test.ts` : `binomCdf(12, 13, 0.75)` contre la valeur tabulée ;
  `tStudentQuantile(0.975, 10)` = 2,228 à 10⁻³ près.
- `tests/unit/stats-incertitude.test.ts` : **table exhaustive n = 13…29** — pour chaque n, `(r, s)`
  égal à la table de la méthode, chaque queue ≤ 0,025 et couverture ≥ 0,95 par binomiale exacte ;
  n = 12 → `{ ok: false, manque: { requis: 13, observe: 12 } }` ; couverture ≥ 0,95 de
  `rangsQuantileNormal` pour n ∈ [30 ; 5 000] ; `wilson(3, 30)` = [0,035 ; 0,256] à 10⁻³ ;
  `wilson(0, 0)` → `{ ok: false }` ; `ecartDetectable(0.10, 100, 100)` ≈ 0,119 et
  `ecartDetectable(0.10, 450, 450)` ≈ 0,056.
- `tests/unit/stats-cadrage.test.ts` : recalcule chaque cellule du tableau du § 7.0 (Wilson, règle de
  trois, écart détectable, minimum 13) et la compare au texte de ce document recopié en constante ;
  un écart > 0,1 point fait échouer le test.
- `tests/unit/vital-card.test.ts` : la jauge porte une moustache dont les bornes correspondent à
  l'intervalle ; intervalle `indisponible` → pas de moustache, pas de couleur de verdict.
- `tests/integration/vitals-intervalle-sql.test.ts` : jeu de 40 mesures connues → bornes SQL = bornes
  JS.
- `tests/unit/kpi-tile.test.ts` : intervalle chevauchant 2 500 ms → texte « verdict incertain » ;
  `indisponible` → aucun badge de verdict.

**Critère de recette.** Sur `/` avec les données de démo : chaque tuile Web Vital affiche soit un
intervalle, soit « intervalle non calculable : n mesures, 13 requises » ; aucune tuile n'a de couleur
de verdict sous 13 mesures ; la moustache d'intervalle est visible sur la jauge `ThresholdMeter` de
chaque tuile Web Vital qui a un intervalle, et absente des autres ; capture 390, 768 et 1440 px sans
débordement ; le lecteur d'écran annonce l'intervalle.

---

#### P*.2 — Ce que « zéro » veut dire

**Question métier.** « L'écran dit 0 erreur sur 7 jours. Est-ce que ça prouve qu'il n'y en a pas, ou
que nous avons trop peu de sessions pour en voir ? »

**Ce que les autres n'offrent pas.** Datadog affiche un taux d'échantillonnage brut, pas de borne de
détection dépendant du volume réel (`reads/ml-paysage.md` L185-199, candidat C7, sources consultées).
IP-Label, Grafana : non trouvé. Ce besoin n'existe qu'à faible volume : c'est le nôtre.

**Signal d'entrée.** Nombre de sessions observées de la fenêtre (`overviewStats`, `lib/queries.ts:L124` ;
`healthScore` `c.sessions`) ; somme des occurrences (`listErrorGroups.totals`,
`lib/queries-errors.ts:L825`) ; `min_inclusion_probability` (`lib/queries-errors.ts:569`, formule
`sr + (1 − sr) × esr`, et `:412-418` pour le message).

**Méthode la plus simple qui marche.** Règle de trois : zéro session touchée sur n sessions observées
→ la part de sessions touchées est inférieure à `3/n` avec 95 % de confiance (borne exacte
`1 − 0,05^(1/n)`, affichée arrondie). Et sa lecture inverse : « une erreur touchant au moins 1 % des
sessions aurait été vue avec une probabilité de `1 − 0,99^n` ».

**Volume minimal et comportement avant.** Aucun : la formule sert précisément à faible volume. Deux
exclusions : (1) n = 0 session → état `vide`, pas de borne ; (2) capacité non collectée
(`non_collecte`, ex. crash natif, `frustration.rage` dont l'émission est non établie,
`reads/console-donnees.md` L814) → **aucune borne**, le texte reste « Non collecté ».

**Affichage.** Dans l'état `vide` d'`EtatSurface` (§ 3.8), une phrase portée par le champ
`borne?: string` (§ 4.2) : « Aucune erreur sur 210 sessions observées du 14/09 au 21/09 (UTC). Cela exclut,
avec 95 % de confiance, une erreur touchant plus de 1,4 % des sessions observées ; une erreur plus
rare a pu passer inaperçue. » Si `min_inclusion_probability < 1` : « sur les sessions observées ;
l'échantillonnage retient chaque session avec au moins {p} % de chances et aucune extrapolation n'est
faite » (RM7), où `{p}` est `min_inclusion_probability` de la fenêtre, lue par
`lib/queries-errors.ts:568`, arrondie vers le bas à l'entier. Les valeurs de ce paragraphe (210
sessions, 1,4 %) sont un **exemple de gabarit**, pas des valeurs mesurées ; aucun taux d'échantillonnage de 40 % n'est configuré ni observé dans le dépôt. La valeur affichée reste `0` :
c'est un compteur réellement vide.

**Où ça tourne et coût.** JS pur (`regleDeTrois` dans `lib/stats/incertitude.ts`), dans les composants
serveur qui rendent l'état vide. Coût nul.

**Invariants.** `0` seulement pour un compteur réellement vide d'une capacité active ; « Non collecté »
sinon ; jamais « 100 % sans erreur » : la phrase dit « aucune erreur observée », jamais « sans
erreur ».

**Fichiers.** `lib/stats/incertitude.ts` (`regleDeTrois`, `probaDetection`) ;
`components/states/EtatSurface.tsx` (champ `borne`) ; `app/errors/page.tsx`, `app/page.tsx`,
`app/mobile/page.tsx`, `app/ux/page.tsx` (appels).

**Tests.** `regleDeTrois(210)` ≈ 0,0142 ; `regleDeTrois(0)` → `{ ok: false }` ; rendu : `non_collecte`
ne contient jamais de borne ; texte sans « sans erreur » ni « 100 % » (regex).

**Critère de recette.** Sur `/errors` d'une app sans erreur sur 7 j : la phrase de borne cite le
nombre de sessions et la plage résolue ; sur `/mobile`, la tuile « crash natif » reste « Non
collecté » sans borne.

---

#### P*.3 — Détecteurs qui disent s'ils ont pu tester, et anomalies quotidiennes

**Question métier.** « Quand l'écran dit “aucune anomalie”, a-t-il vérifié ? Et hier, un indicateur
s'est-il écarté de ses deux dernières semaines ? »

**Ce que les autres n'offrent pas.** Datadog nomme trois algorithmes (Basic / Agile / Robust) sans en
publier les paramètres effectifs ([Anomaly monitors](https://docs.datadoghq.com/monitors/types/anomaly/),
`reads/ml-paysage.md` L68, L116-118) ; Watchdog Insights ne publie ni test ni seuil
(`reads/datadog-docs-explorer-dashboards.md` L406). Grafana ML « apprend sur l'historique » sans
formule publiée ([Grafana ML](https://grafana.com/docs/grafana-cloud/ai-tools/machine-learning/)).
IP-Label « AI Incident Guard » : mécanisme non détaillé (`reads/ml-paysage.md` L68). Un état
« détecteur non testable, voici pourquoi » : non trouvé chez les trois.

**Livrable avant les fondations.** La partie (a) côté score de santé (constat VM2) ne dépend que de
`lib/health.ts` et de `components/health/HealthBanner.tsx`, qui existent : c'est l'incrément 0-c
(§ 7.2.0). La ligne de statut des détecteurs attend `InsightStrip` (F08), l'annotation d'anomalie
attend `ThresholdSeries` (F04).

**Signal d'entrée.**
- (a) Testabilité : `v_anomaly` (`migration-v03.sql:70-84`) et sa garde (L80) ; règles d'alerte en
  mode `baseline` et `metric_baseline` (`migration-v68.sql:51`, garde `:232`).
- (b) Séries quotidiennes 14 j déjà lues : `dailyTraffic` (pages vues, `sum(occurrences)`) et
  `dailyLcpSeries` (`lib/queries-grid.ts:110`, `:176`), découpées dans le fuseau de l'app.

**Méthode la plus simple qui marche.**
- (a) Une requête compagne de `v_anomaly` compte les routes éligibles (≥ 5 heures avec mesure LCP sur
  7 jours et écart-type > 0) et le nombre total de routes vues ; pour chaque règle `baseline`, le
  scheduler écrit déjà `last_state` / raison (v73) : on y ajoute la raison « base saisonnière
  insuffisante (n = 2, 4 requis) » quand la garde échoue.
- (b) **z modifié d'Iglewicz-Hoaglin** sur le **dernier jour complet** (fuseau de l'app ; le jour en
  cours est partiel et n'est jamais jugé) : `mz = 0,6745 × (x − médiane) / MAD` sur les 13 jours
  précédents ; anomalie si `|mz| > 3,5`. Indicateurs : LCP p75 du jour, occurrences pour 100 pages
  vues, pages vues. Médiane et MAD ne sont pas tirés par un seul jour extrême, contrairement à la
  moyenne et à l'écart-type de `v_anomaly`.

**Volume minimal et comportement avant.**
- Un jour n'entre dans la base que s'il a **≥ 13 mesures LCP** (P*.1) pour la p75, **≥ 30 pages vues**
  pour le taux ; sinon il est `null` (trou), pas 0.
- Base : **≥ 7 jours valides sur 13**, et **MAD > 0**. Sinon : « non testable : 4 jours avec assez de
  mesures sur 13, 7 requis ». Choix différent de `metric_baseline` (qui juge anormal le moindre écart
  quand MAD = 0, `migration-v68.sql:233-235`) : pour un affichage, un MAD nul veut dire « pas de
  dispersion observée », donc pas d'échelle pour juger — on se tait et on le dit.
- (a) Zéro route éligible → la composante « Anomalies » du score de santé passe à `earned: null`
  (constat VM2) ; le score est renormalisé et la ligne de facteur dit « non testable ».

**Affichage.**
- `InsightStrip` (§ 4.2) : chaque constat a sa `regle` (« z modifié > 3,5 sur la médiane des 13
  jours précédents ; 11 jours valides ») ; et une ligne de **statut des détecteurs**, toujours visible,
  même sans constat : « Anomalies LCP horaires : 0 route testable sur 12 (5 heures de mesures
  requises). Anomalies quotidiennes : testées sur LCP et pages vues ; taux d'erreur non testable
  (4 jours ≥ 30 pages vues). » Prop `statuts` d'`InsightStrip` (§ 4.2).
- `HealthBanner` : facteur « Anomalies » « non testable » en texte, sans points.
- Sur les séries 14 j (`/forecast`, heatmap) : `Annotation` de type `"anomalie"` sur le jour signalé,
  lien vers la plage de ce jour.

**Où ça tourne et coût.** (a) une requête SQL légère (compte groupé sur 8 jours de `rum_metric` LCP,
même balayage que la vue) ; (b) JS pur sur les 14 points déjà lus ; `dailyLcpSeries` gagne
`count(*) as n` (patch d'une ligne). Aucun job nouveau.

**Invariants.** Jour partiel jamais jugé ; `null` = jour sans assez de mesures ; aucune moyenne de
p75 (la médiane porte sur des p75 quotidiennes comparées entre elles, jamais agrégées en une p75) ;
fenêtre fixe 14 j dite via `rangeNote`.

**Fichiers.** `lib/stats/anomalies-jour.ts` (nouveau) ; `lib/health.ts` (composante anomalies) ;
`lib/queries-grid.ts` (`dailyLcpSeries` + `n`) ; `lib/queries-anomalies.ts` (nouveau : éligibilité) ;
`components/InsightStrip.tsx` ; `app/page.tsx`, `app/forecast/page.tsx`.

**Tests.** Série avec un pic à `mz = 4` → constat ; même série avec 6 jours valides → non testable,
raison chiffrée ; MAD = 0 → non testable ; jour courant jamais jugé (horloge figée) ; `healthScore`
avec 0 route éligible → facteur `earned: null` et score renormalisé
(`tests/unit/health-anomalies.test.ts`) ; SQL d'éligibilité sur fixtures
(`tests/integration/anomalies-eligibilite-sql.test.ts`).

**Critère de recette.** Sur la base de démo actuelle, la Vue d'ensemble n'affiche plus « aucune
anomalie détectée » quand aucune route n'a 5 heures de mesures ; la ligne de statut chiffre ce qui
manque ; le score de santé change en conséquence et la note de facteur le dit.

---

#### P*.4 — Tendance avec bande et test de pente

**Question métier.** « Si la tendance des 14 derniers jours continue, quand franchit-on le seuil — et
cette tendance existe-t-elle vraiment ? »

**Ce que les autres n'offrent pas.** Datadog propose des prévisions avec bornes dans ses monitors
(algorithmes linéaire et saisonnier, [Forecasts](https://docs.datadoghq.com/monitors/types/forecasts/)) :
la bande seule n'est donc pas une différence. La différence tient en deux points : un **refus
explicite** quand la pente n'est pas distinguable de zéro, et une formule écrite à l'écran. Refus
explicite : non trouvé dans les sources consultées (Datadog, Grafana ML « metric forecast »,
IP-Label).

**Signal d'entrée.** Les séries de `/forecast` (`app/forecast/page.tsx:42-48`) : LCP p75 quotidien
(`dailyLcpSeries` + `n` de P*.3), occurrences pour 100 pages vues (libellé corrigé, VM3), pages vues.

**Méthode la plus simple qui marche.** On garde `linfit` (`lib/forecast.ts:14-30`) et on ajoute :
- erreur-type résiduelle `s = √(Σ résidus² / (n − 2))`, `Sxx = Σ (x − x̄)²` ;
- **test de pente** : `t = pente / (s / √Sxx)` ; si `|t| < t(0,975 ; n − 2)` → « pente non
  distinguable de zéro sur n jours » et **aucune date de franchissement** ;
- **bande de prédiction** à 95 % : `ŷ(x) ± t(0,975 ; n − 2) · s · √(1 + 1/n + (x − x̄)²/Sxx)` ;
- **date de franchissement en intervalle** : premiers jours où la borne défavorable, puis la
  projection centrale, puis la borne favorable franchissent le seuil → « entre J+4 et J+11 », ou « au
  plus tôt J+4 » si la borne favorable ne le franchit pas dans l'horizon ;
- **horizon borné** : 7 jours, et jamais plus de la moitié de l'étendue observée
  (`HORIZON_JOURS`, corrige VM1).

**Volume minimal et comportement avant.** `linfit` accepte 3 points (`forecast.ts:19`) : trop peu pour
une bande (t à 1 ddl = 12,7). Minimum retenu : **7 jours valides** (même définition de jour valide
que P*.3). En dessous : série observée seule, « tendance non calculée : 5 jours avec assez de mesures
sur 14, 7 requis » ; pas de droite.

**Affichage.** `ForecastChart` migré sur `ThresholdSeries` (F04) : série observée orange, droite
ajustée grise, bande de prédiction grisée (`ReferenceArea` par segment) au-delà du dernier point,
bandes de seuil de `rating.ts`. `lecture` : « Ajustement linéaire sur 11 jours valides. Pente
+38 ms/jour, distinguable de zéro (t = 3,1 ; seuil 2,26). Franchissement de 2,5 s : entre J+4 et
J+11 si la tendance continue. C'est une extrapolation, pas une prévision. » Narration de
`buildForecastNarrative` réécrite sur ces sorties (statut « watch » seulement si la pente est
établie).

**Où ça tourne et coût.** JS pur dans `lib/forecast.ts` ; aucune requête nouvelle hors `n` quotidien.

**Invariants.** Aucune droite sur des jours `null` (pas de `connectNulls`) ; seuils de `rating.ts` ;
fenêtre fixe 14 j dite ; « tendance », jamais « prévision » (§ 2.3).

**Fichiers.** `lib/forecast.ts` (`residuel`, `testPente`, `bandePrediction`, `etaIntervalle`,
`HORIZON_JOURS`) ; `app/forecast/page.tsx` ; `components/charts/ForecastChart.tsx`.

**Tests.** `tests/unit/forecast.test.ts` étendu : droite parfaite → t infini, bande nulle ; bruit pur
(série tabulée) → « non distinguable » ; `etaIntervalle` sur un cas calculé à la main ; texte de
narration et `HORIZON_JOURS` cohérents (VM1) ; 6 jours valides → refus chiffré.

**Critère de recette.** `/forecast` sur la démo : pour chaque indicateur, soit une bande et un test
écrit, soit un refus chiffré ; plus aucune mention « horizon de 3 jours ».

---

#### P*.5 — Release contre release : verdict à trois issues

**Question métier.** « La nouvelle release a-t-elle dégradé l'expérience, l'a-t-elle améliorée, ou
n'avons-nous pas encore de quoi le dire ? Et quel écart aurions-nous pu voir ? »

**Ce que les autres n'offrent pas.** Datadog Deployment Tracking compare les versions (« Error Rate by
Version », « P75 Loading Time by Version », comparaison « against all previous versions »,
`reads/datadog-docs-product-analytics-mobile.md` L301-304) ; aucune p-value ni aucun intervalle
affichés dans les sources consultées (`reads/ml-paysage.md` L208-213). IP-Label : « track pre/post
release impact », seuil relatif « > 10 % » (`reads/iplabel.md` L100-106), sans test documenté. Le
« plus petit écart détectable » affiché : non trouvé chez les trois.

**Signal d'entrée.** `comparaisonVersions(f, 12)` (`lib/queries-deploys.ts:L162`) : sessions, sessions
en erreur, LCP p75, INP p75 par release, dimension d'occurrence (v75) ou de session. Patch **B62** (requête, § 6.3) : par release, nombre de mesures LCP et nombre de mesures LCP `rating = 'good'`,
plus les valeurs pour l'intervalle P*.1. Carte déploiement : `latestDeployImpact`
(`queries-deploys.ts:61-92`) + pages vues et sessions avant / après (VM4).

**Méthode la plus simple qui marche.** Trois mesures, chacune avec son propre résultat, jamais
combinées en un score :
1. **Mesure principale, déclarée d'avance : part de sessions en erreur.** Test exact de Fisher
   bilatéral sur la table 2 × 2 (sessions en erreur / sans erreur × release A / B) + intervalle de
   Newcombe sur la différence.
2. **Part de mesures LCP « Bon »** : même test, même intervalle (mesures, pas sessions : RM6).
3. **p75 LCP et INP** : intervalles P*.1 côte à côte, sans test.

Verdict de la mesure principale : « dégradation établie » (intervalle entièrement du côté défavorable),
« amélioration établie », ou « écart non établi ». Dans ce dernier cas, **plus petit écart
détectable** à puissance 80 % : `(1,96 + 0,84) · √(p̄(1 − p̄)(1/nA + 1/nB))` → « avec 100 sessions de
chaque côté, un écart de 12 points serait établi 8 fois sur 10 ; un écart plus petit, moins
souvent » (on n'écrit pas « passerait inaperçu » : un petit écart peut être établi par chance). Une seule mesure principale évite
de chercher l'écart parmi plusieurs tests ; les deux autres sont libellées « secondaires ».

**Volume minimal et comportement avant.** **30 sessions par release** pour afficher un verdict
(Fisher est valide à tout effectif, mais en dessous le plus petit écart détectable dépasse 25 points
et le verdict n'informe pas). En dessous : effectifs affichés, « pas encore assez de sessions pour un
verdict : 11 sur 30 pour 1.4.2 ». Moins de 2 releases : mode désactivé avec raison (§ 3.2).
Carte déploiement ±2 h : même test si ≥ 30 sessions de chaque côté ; sinon règle actuelle (+20 %)
affichée avec ses effectifs et « règle de seuil, pas un test » ; 0 page vue d'un côté → `null`.

**Affichage.** `ReleaseCompare` (§ 4.2) reçoit `verdict?: { etat: "degradation" | "amelioration" |
"non_etabli" | "insuffisant"; mesure: string; difference: Intervalle | null; ecartDetectable: number |
null; p: number | null; raison?: string }`. Texte : « Sessions en erreur : 14 % (1.4.2) contre 8 %
(1.4.1), écart +6 points, entre −1 et +13 (95 %). Écart non établi ; plus petit écart détectable ici :
12 points. Même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte. »
Carte « Dernier déploiement » dans `InsightStrip` : même phrase ou la règle de seuil. Écran Alertes :
la règle relative de release (§ 3.2, B52) peut exiger « dégradation établie » plutôt qu'un
pourcentage brut — option de F68, non imposée.

**Où ça tourne et coût.** Une requête d'agrégation par release (déjà existante, trois colonnes de
plus) ; Fisher en JS via `hypergeomQueue` (tables de quelques centaines de sessions : immédiat).

**Invariants.** Sessions en erreur = sessions avec au moins une occurrence (jamais `sum(occurrences)`
au numérateur d'une part de sessions) ; release par occurrence, jamais appliquée au passé
(`query-compiler.ts:L69-78`) ; « Inconnu » est une release à part, jamais comparée ; phrase « sans
normalisation de trafic » obligatoire.

**Fichiers.** `lib/stats/comparaison.ts` (`fisher2x2`, `verdictProportion`) ; `lib/queries-deploys.ts`
(`comparaisonVersions`, `latestDeployImpact`) ; `components/ReleaseCompare.tsx`,
`components/InsightStrip.tsx`.

**Tests.** Fisher contre valeurs tabulées (table 2 × 2 classique « thé » : p = 0,486) ; verdicts des
trois issues sur tables construites ; 29 sessions → `insuffisant` ; `assessRegression` : avant 0 et
pages vues 0 → `null`, pas « pas de régression » ; test de gabarit RM5.

**Critère de recette.** Sur la démo avec deux releases : le panneau affiche effectifs, intervalle,
verdict ou refus chiffré ; aucun pourcentage d'écart n'apparaît sans son intervalle ou son libellé
« règle de seuil ».

---

#### P*.6 — Valeurs sur-représentées, test publié (pendant de Watchdog Insights)

**Question métier.** « Les sessions touchées par cette erreur, ou les mesures LCP “Mauvais”, ont-elles
une valeur en commun — un navigateur, une release, un pays estimé, une route — plus souvent que
l'ensemble ? »

**Ce que les autres n'offrent pas.** Datadog Watchdog Insights signale des paires `key:value`
« statistically overrepresented » parmi les erreurs et plus lentes que la base
(`reads/datadog-docs-explorer-dashboards.md` L212-214) ; **le test et le seuil ne sont pas publiés**
(même fichier L406). L'onglet « Outliers » d'une issue fait de même (`reads/datadog-docs-errors-replay-frustration.md`
L158, L200). Les « conversion drivers » citent une « statistical analysis » sans méthode
(`reads/datadog-docs-product-analytics-mobile.md` L107). IP-Label : « Impact & correlation », non
établi (`reads/iplabel.md` L118). Nous publions le test, le seuil, les effectifs et le nombre de
valeurs testées.

**Signal d'entrée.** Dépendance **B3** (§ 6.3) : pour une dimension (`browser`, `os`,
`device`, `country`, `release`, `route`), par valeur, nombre de sessions touchées et nombre de sessions
de la population de base (sessions de la fenêtre et des filtres). Pour les vitals : B2 (mesures
« Mauvais » par groupe) + mesures par groupe (déjà dans `vitalsBreakdown`,
`lib/queries-breakdowns.ts:L79`). Sources : `errorsBreakdown` (`:L119`), `vitalsBreakdown`.

**Méthode la plus simple qui marche.** Pour chaque valeur v : table 2 × 2 (touchée / non touchée ×
v / autre), **test exact de Fisher unilatéral** (sur-représentation), puis correction de
**Benjamini-Hochberg** sur toutes les valeurs testées de toutes les dimensions de l'écran (taux de
fausses découvertes 5 %). Rapport de parts `partTouches / partBase` (déjà prévu par `ContrastBars`).

**Volume minimal et comportement avant.** Testé seulement si **≥ 10 unités touchées au total**,
**≥ 3 touchées portant v**, **≥ 30 unités de base**. En dessous : `ContrastBars` montre les parts
brutes, sans étiquette, avec « pas de test : 6 sessions touchées, 10 requises ». « Inconnu » est
affiché mais jamais testé (il agrège des causes de manque différentes, avant v75 notamment).
Exemple à 7 jours / 210 sessions : 9 des 12 sessions touchées sont sur Safari contre 30 % de la base →
p unilatéral (hypergéométrique) ≈ 0,001, soit ≈ 0,02 après correction sur 14 valeurs.

**Affichage.** `ContrastBars` (§ 4.2) reçoit par ligne `test?: { pAjuste: number; retenu: boolean }`
et en tête `testees?: number` et `regle?: string`. Une valeur retenue porte l'étiquette « sur-représentée »
et la phrase : « Safari : 9 des 12 sessions touchées (75 %) contre 63 des 210 sessions (30 %).
Test exact de Fisher, p ajusté = 0,02 sur 14 valeurs testées. Association observée, pas une cause. »
Les constats retenus alimentent `InsightStrip` (type `"surrepresentation"`, § 4.2).

**Où ça tourne et coût.** SQL = comptes B3 (une requête groupée par dimension, déjà dans le périmètre
de B3) ; Fisher + BH en JS (≤ 6 dimensions × 12 valeurs = 72 tests par écran).

**Invariants.** Population de sessions (RM6) : une session à 50 occurrences compte une fois ; aucune
ligne « Autres » ; le pays est « estimé » avec sa provenance ; pas de test sur une dimension refusée
par la surface (`/mobile` : `device`, `os`, `release` seulement, `surfaces.ts:L65-76`).

**Fichiers.** `lib/stats/surrepresentation.ts` (nouveau) ; `lib/queries-breakdowns.ts` (B3) ;
`components/charts/ContrastBars.tsx` ; panneaux d'erreur (`app/errors/[fingerprint]/page.tsx`) et de
route (`app/pages/page.tsx`).

**Tests.** Fisher unilatéral contre valeurs tabulées ; BH sur une liste connue ; seuils de volume
(9 touchées → pas de test) ; « Inconnu » jamais testé ; gabarit RM5 ; test SQL B3 : totaux de base
égaux au compte de sessions de la fenêtre.

**Critère de recette.** Sur un jeu de démo construit (erreur injectée sur Safari seulement), le
panneau de l'erreur retient Safari avec p ajusté écrit ; sur la base de démo actuelle, il affiche
« pas de test » avec les effectifs manquants.

---

#### P*.7 — « Depuis quand ? » : datation d'une rupture

**Question métier.** La question de la Vue d'ensemble se termine par « et sinon, où et depuis
quand ? » (§ 5.1) : « Le LCP a-t-il changé de niveau à une date précise, ou dérive-t-il ? »

**Ce que les autres n'offrent pas.** Datation d'un changement de niveau sur une série RUM : non
trouvée dans les sources consultées (Datadog anomaly / forecast / Watchdog ; Grafana ML forecast et
outliers ; IP-Label). Les annotations de déploiement existent chez Grafana (`reads/grafana.md` § b.13),
pas la datation statistique.

**Signal d'entrée.** Séries quotidiennes de P*.3 (14 j fixes) ; sur plage personnalisée ≥ 10 jours,
séries au seau de 24 h (`bucketSecondsFor`, `lib/query-contract.ts:L230-235`) via `vitalSeries` en
seaux quotidiens. Marqueurs `deploy_marker` (`migration-v32.sql:10-18`) via `listDeploys` (B1 pour la
plage personnalisée).

**Méthode la plus simple qui marche.** **Test de Pettitt** (non paramétrique, une rupture) : `U_t`
cumulé des signes, `K = max |U_t|`, `p ≈ 2·exp(−6K² / (n³ + n²))`. Si p < 0,05 : rupture au jour t,
avec médianes avant / après. Pas de méthode multi-ruptures : sur 14 à 30 points, une seule rupture
est déjà la limite de ce qui s'estime.

**Volume minimal et comportement avant.** **≥ 10 jours valides** (définition P*.3). En dessous : « datation
non tentée : 6 jours valides, 10 requis ». Si une tendance est établie par P*.4 et pas de rupture :
« évolution progressive, pas de rupture datée ».

**Affichage.** Annotation verticale de type `"rupture"` sur la série (type `Annotation`, § 4.2) ; phrase dans le hero : « Le LCP p75 est passé d'une médiane de
1,9 s à 2,7 s autour du 16/09 (test de Pettitt, p = 0,01, 13 jours valides). Un déploiement (1.4.2) a
eu lieu le 16/09 : coïncidence de date, pas une cause établie. » Le déploiement n'est cité que s'il
est à ± 1 jour.

**Où ça tourne et coût.** JS pur (`lib/stats/rupture.ts`) sur les séries déjà lues. Coût nul.

**Invariants.** Jours partiels exclus ; médianes de p75 quotidiennes présentées comme telles (« médiane
des p75 quotidiennes »), jamais comme une p75 de période ; RM5.

**Fichiers.** `lib/stats/rupture.ts` ; `components/charts/ThresholdSeries.tsx` (type `"rupture"`) ;
`app/page.tsx`, `app/forecast/page.tsx`.

**Tests.** Marche d'escalier nette → rupture au bon jour ; bruit pur → pas de rupture ; 9 jours →
refus ; déploiement à 2 jours → non cité.

**Critère de recette.** Sur un jeu de démo avec une marche injectée, l'annotation tombe sur le bon jour
et la phrase cite p et le nombre de jours ; sur la démo actuelle, le refus est chiffré.

---

#### P*.8 — Robot et réel : concordance mesurée

**Question métier.** « Le robot suit-il ce que vivent les visiteurs dans le temps, ou regarde-t-il
ailleurs ? » (écran landing de la catégorie « Robot et réel », § 2.2).

**Ce que les autres n'offrent pas.** Ni Datadog ni Grafana ne mettent nativement une sonde synthétique
et le RUM sur un même graphe dans les sources consultées ; IP-Label a les deux briques (Ekara STM +
RUM) mais aucun coefficient affiché trouvé (`reads/ml-paysage.md` L147-150 ; `reads/iplabel.md`
L125-154). Notre `/correlation` applique aujourd'hui une règle de seuil binaire, sans coefficient
(`app/correlation/page.tsx:88-92`).

**Signal d'entrée.** `syn_snapshot` (latence, route) et `rum_metric` LCP par route — aujourd'hui joints
à l'heure par `correlationSeries` (`lib/queries-v2.ts:451-463`), qui lit les sources de
`correlationSources(sql, "heure")` (`:384`) sous `sqlContext` ; les vues historiques `v_correlation` /
`v_blind_spot` ne sont plus lues (`queries-v2.ts:367-368`). Patch **B61** (requête, § 6.3) : `correlationQuotidienne(app, route, f)` — même couple app × route que `correlationSeries` (§ 5.7), de préférence en
ajoutant un grain `"jour"` à `correlationSources` (aujourd'hui `"fenetre" | "heure"`, `:384`) pour
garder la même exclusion des bots et le même périmètre →
par jour : latence robot moyenne, LCP p75 réel, n réel.

**Méthode la plus simple qui marche.** **Corrélation de rang de Spearman** entre les deux séries
quotidiennes (insensible aux valeurs extrêmes et aux échelles différentes : le robot mesure une
latence, le réel un LCP). Intervalle par transformation de Fisher avec l'erreur-type
`√(1,06 / (n − 3))`. Lecture en trois issues : « suit » (borne basse > 0,3), « ne suit pas » (borne
haute < 0,3), « non établi ». Le seuil 0,3 est un choix de produit, écrit à l'écran.

**Volume minimal et comportement avant.** **≥ 10 jours** où la route a au moins un passage robot ET
≥ 13 mesures LCP réelles. À 30 sessions par jour, seules les routes les plus vues l'atteindront :
les autres affichent « concordance non calculée : 4 jours communs, 10 requis » (le message actuel « Pas
encore de route avec données robot ET réel », `page.tsx:74-76`, reste pour le cas zéro).

**Affichage.** Colonne « Concordance robot ↔ réel » (ρ + intervalle) dans la table CR12 (§ 5.7) ; phrase dans la `lecture` du hero « Robot face au réel » (panneau réel CR7 + frise robot CR7-b, jamais sur le même axe) : « Sur 12 jours communs,
le robot et le réel évoluent ensemble (ρ de Spearman = 0,71, entre 0,21 et 0,92). ρ mesure si les deux
montent et descendent ensemble, pas si leurs valeurs sont égales. »

**Où ça tourne et coût.** Une requête quotidienne groupée par route sur ≤ 30 jours ; Spearman en JS.

**Invariants.** Seuil LCP de `rating.ts` pour les angles morts (F00) ; `syn_snapshot` non sessionné
(pas de dimension de session appliquée : dit) ; aucune moyenne de p75.

**Fichiers.** `lib/stats/concordance.ts` ; `lib/queries-v2.ts` (`correlationQuotidienne`) ;
`app/correlation/page.tsx`.

**Tests.** Séries monotones → ρ = 1 ; séries indépendantes tabulées ; 9 jours → refus ; ex-aequo
traités par rangs moyens ; test SQL de la requête quotidienne.

**Critère de recette.** `/correlation` affiche pour chaque route un ρ avec intervalle ou un refus
chiffré ; la phrase « pas si leurs valeurs sont égales » est présente.

---

#### P*.9 — Récit de session composé de faits

**Question métier.** « Que s'est-il passé dans cette session, sans regarder tout le rejeu ? »

**Ce que les autres n'offrent pas.** Datadog génère des résumés et chapitres de rejeu par modèle de
langage ([AI summaries and smart chapters](https://www.datadoghq.com/blog/ai-summaries-and-smart-chapters/)) :
coût et latence par résumé, risque de reformulation inexacte. IP-Label, Grafana : non établi. Notre
position est différente, pas supérieure : un récit **déterministe**, qui ne dit que des faits observés
et renvoie chaque phrase à l'événement qui la fonde ; en échange, il n'interprète pas.

**Ce n'est pas de l'apprentissage.** C'est le remplaçant honnête d'une fonctionnalité IA, à notre
volume et sans appel externe.

**Signal d'entrée.** `sessionMeta(id)` et `sessionTimeline(id)` (`lib/queries.ts:L413`, `:L441`) :
vues, vitals avec `rating`, erreurs (`occurrences`), breadcrumbs, tâches longues, événements dont
`frustration.*`, actions, ressources, appels API.

**Méthode.** Gabarits de phrases sur le modèle de `buildForecastNarrative` (`lib/forecast.ts:61-84`),
dans un ordre fixe : parcours (« 4 vues : / → /catalogue → /panier → /paiement ») ; durée observée
(« 6 min 12 s entre la première et la dernière observation ») ; pire vital par rapport à son seuil ;
erreurs (« 2 occurrences de TypeError sur /paiement, 3 s après le clic “Payer” » — lien d'action si
`action_id`) ; signaux de frustration ; fin (« dernière observation sur /paiement »). Liste de mots
interdits (« énervé », « abandonne », « cause », « à cause ») vérifiée par test.

**Volume minimal.** Aucun : fonctionne dès un événement. Session sans événement → pas de récit, état
`vide` « aucun événement pour cette session ».

**Affichage.** Bloc « En bref » en tête du détail de session (§ 5.12), chaque
phrase liée à l'ancre de l'événement dans la `Cascade` / `Timeline` ; mention fixe : « Récit composé
à partir des événements reçus, sans interprétation. Les événements non collectés n'y figurent pas. »
Si le rejeu est absent ou masqué, le récit le dit (masquage par application, `dashboard-blocs.ts:L101-106`).

**Où ça tourne et coût.** JS pur au rendu serveur ; aucune requête nouvelle.

**Invariants.** Aucune identité brute ni IP (le récit n'utilise ni `user_id_hash` ni `visitor_id`) ;
occurrences sommées ; pays « estimé » ; le détail de session n'applique aucun filtre (`surfaces.ts:L79-83`).

**Fichiers.** `lib/recit-session.ts` ; `app/sessions/[id]/page.tsx` ; `components/sessions/RecitSession.tsx`.

**Tests.** Timeline fixture → texte attendu mot pour mot ; mots interdits absents ; session avec
`occurrences = 3` sur une ligne → « 3 occurrences » ; session sans rejeu → mention.

**Critère de recette.** Sur trois sessions de démo, chaque phrase du récit a un lien qui mène à
l'événement correspondant ; relecture : aucune phrase ne décrit une intention.

---

#### P*.10 — Suggestion de doublons d'issues, sous contrôle humain

**Question métier.** « Ces deux issues ouvertes sont-elles probablement le même bug sous deux
empreintes ? »

**Ce que les autres n'offrent pas.** Sentry fusionne automatiquement par embeddings
([Issue Grouping](https://blog.sentry.io/enhancing-issue-grouping/)) ; Datadog regroupe et propose une
« cause suspectée » parmi des catégories fixes ([Suspected Causes](https://docs.datadoghq.com/error_tracking/suspected_causes/)).
Ici, une **suggestion** justifiée mot à mot, jamais une fusion : notre volume ne permet pas de valider
une fusion automatique.

**Condition d'ouverture.** Le regroupement v2 est activé pour **aucune** app (`reads/ml-paysage.md`
L46 ; parity A7). Le lot est spécifié et testé sur fixtures, mais son affichage reste fermé
(`CapaciteFermee`) tant qu'aucune app n'est activée. Aucune action de fusion d'issues v2 n'a été
trouvée dans le dépôt (non établi) : le lot ne crée pas de fusion, il pointe les deux issues.

**Signal d'entrée.** `error_issue` ouvertes d'une même app (`migration-v72.sql:83-113` : `status`,
`grouping_basis`, `first_seen`, `last_seen`) ; message du dernier exemplaire (`rum_error.message`) ;
`messageTemplate` (`apps/ingest/supabase/functions/_shared/error-normalize.mjs:380`).

**Méthode.** Pour chaque paire d'issues ouvertes de la même app et du même `error_type` : indice de
Jaccard sur les jetons de `messageTemplate(message)` ; suggestion si ≥ 0,8 **et** au moins une des
deux a `grouping_basis = 'low_confidence'` (les autres ont une frame applicative : leur séparation est
probablement voulue).

**Volume minimal.** ≥ 2 issues ouvertes dans l'app ; sinon rien, et aucun message (ce n'est pas un
constat attendu).

**Affichage.** Encart sur la page d'issue : « Issue probablement proche : #… (mots communs : “Cannot”,
“read”, “properties”, “of”, “undefined”, “reading”, “<id>” ; Jaccard 0,86). Suggestion, pas une
fusion. » Bouton « Écarter la suggestion » pour les rôles d'écriture seulement (RM9).

**Où ça tourne et coût.** Étape `suggest_issue_duplicates` ajoutée à la cadence **horaire** du scheduler
Railway (`apps/ingest/jobs/planifie.mjs:181-196`), idempotente sous concurrence (verrou de transaction,
`planifie.mjs:23-26`) ; table `error_issue_suggestion (app_id, issue_a, issue_b, jaccard, mots,
created_at, dismissed_by, dismissed_at)` avec RLS par app (migration nouvelle : **B60**, § 6.3). Coût : O(k²) paires
pour k issues ouvertes par app, négligeable sous quelques centaines. Pas de temps réel : cadence
horaire écrite à l'écran.

**Invariants.** Jamais de fusion automatique ; `app_id` lié (pas de paire inter-app) ; aucun contenu
d'une autre app ; viewer / démo / jeton API en lecture seule.

**Fichiers.** `apps/ingest/lib/suggestions-issues.mjs` ; `apps/ingest/jobs/planifie.mjs` ;
`apps/ingest/sql/migration-v86.sql` (numéro à confirmer au moment du lot) ; `apps/console/lib/error-issues.ts` ;
`app/errors/issues/[id]/page.tsx`.

**Tests.** Jaccard sur paires connues ; paire inter-app jamais produite
(`tests/integration/suggestions-issues-sql.test.ts`) ; idempotence de deux exécutions concurrentes ;
viewer sans bouton (e2e).

**Critère de recette.** Sur fixtures v2 activées : deux issues « Cannot read properties of undefined
(reading 'id' / 'name') » à base `low_confidence` sont suggérées avec leurs mots communs ; sur la
démo actuelle, l'encart est fermé avec sa raison.

---

### 7.3 Ce que nous refusons, et à partir de quand ce serait défendable

Refusé à notre volume (quelques dizaines de sessions par jour au mieux, beaucoup moins établi, § 7.0) :

| Refusé | Pourquoi ce ne serait pas honnête aujourd'hui | Condition d'ouverture (porte d'entrée) |
|---|---|---|
| Généraliser `v_anomaly` à toutes les métriques **par route et par heure** | p75 horaire d'une route sur 1 à 3 mesures ; la garde de 5 heures ne sera presque jamais atteinte (§ 7.0) | ≥ 13 mesures par route et par heure sur ≥ 5 heures de la semaine pour la route |
| Modèles saisonniers (SARIMA, Prophet, décomposition) | 14 à 30 points quotidiens : une saison hebdomadaire s'estime sur 2 à 4 cycles, c'est-à-dire du bruit | ≥ 8 semaines complètes de données quotidiennes valides |
| Détection d'anomalies apprise (forêt d'isolement, auto-encodeur) | aucun historique étiqueté d'incidents ; rien pour mesurer les faux positifs | ≥ 30 incidents étiquetés et une mesure de faux positifs sur 3 mois |
| Segmentation de sessions par regroupement (k-means, DBSCAN) | quelques centaines de sessions par mois : des groupes instables d'une exécution à l'autre, présentés comme des « profils » | ≥ 5 000 sessions sur la fenêtre et stabilité des groupes mesurée par rééchantillonnage |
| Prédiction d'abandon ou de conversion d'une session | règle usuelle ≥ 10 événements par variable ; à 30 sessions par jour et quelques conversions, un modèle à 5 variables demanderait des mois | ≥ 50 conversions et ≥ 50 abandons par variable explicative, sur une fenêtre où le parcours n'a pas changé |
| Effet de la lenteur sur la conversion en « conversions perdues par seconde de LCP » | une régression logistique à ce volume produirait un chiffre instable ; et c'est une association, pas une perte causale | P*.1 sur les taux de conversion par zone de LCP (Bon / À améliorer / Mauvais) d'abord ; régression seulement à la condition de la ligne précédente |
| Résumé de session par modèle de langage | coût, latence, reformulation possible ; pas de moyen de vérifier à notre échelle ; P*.9 couvre le besoin de lecture rapide | seulement en complément de P*.9, avec chaque phrase liée à un événement et un contrôle d'exactitude automatique |
| Fusion automatique d'issues | aucun volume pour mesurer les fusions fausses ; regroupement v2 non activé | ≥ 3 mois de suggestions P*.10 acceptées ou écartées, taux d'acceptation mesuré |
| « Cause suspectée » ou analyse de cause racine | un seul framework backend instrumenté, aucune propagation backend → backend (`docs/RUM_PARITY_STATUS.md` § 6.5) ; au mieux une association (P*.6) | topologie de services instrumentée de bout en bout ; même alors, présenter une association |
| Extrapolation des comptes par poids d'échantillonnage | contraire à l'invariant produit (RM7) | aucune : on affiche l'incertitude, on n'extrapole pas |
| Score de frustration « appris » | émission de `frustration.rage` / `dead` non établie en production (`reads/console-donnees.md` L814) | émission vérifiée sur trafic réel, puis règles publiées d'abord |

Hors écran de suivi et donc hors épique (mentionné pour mémoire) : prévision de palier d'hébergement
par `tenant_usage_daily` (candidat C6, `reads/ml-paysage.md` L170-183) — réutiliserait P*.4 tel quel
sur `/admin/usage` ; score d'impact d'issue (candidat C3 des notes de travail) — déjà couvert par le tri gravité / impact
d'`ImpactTable` (§ 4.2), sans modèle.

---

### 7.4 Vocabulaire de présentation (pour la P** et la vitrine)

- Dire « statistique explicable », « règle publiée », « intervalle à 95 % », « test exact » ; ne pas
  dire « IA », « intelligence », « apprentissage » pour P*.1 à P*.10.
- Dire ce que chaque lot garantit et ne garantit pas, avec son seuil de volume : « la tendance n'est
  tracée qu'à partir de 7 jours valides », « la sur-représentation est une association, pas une
  cause ».
- Ne pas comparer à un score « validé sur des milliards de sessions » (`reads/ml-paysage.md` L265-269).

---

### 7.5 Non établi

- Si la fraction d'un `percentile_disc` peut dépendre de `count(*)` dans la même agrégation : non vérifié ; P*.1 passe donc par `row_number()` et ne s'appuie pas dessus.
- L'existence d'une action utilisateur de fusion d'issues v2 dans la console (recherche de « merge »
  / « fusion » dans les modules de workflow d'issue : aucun résultat).
- Le coût comparé d'un calcul de rangs exacts pour tout n (deux lectures) et du calcul normal en SQL
  pour n ≥ 30 (une lecture) : non mesuré ; P*.1 garde le second.
- La date de livraison des lots F01 à F08, dont dépend l'affichage complet de chaque sous-lot (§ 7.2.1).
- Le numéro de la prochaine migration (v86 supposé ; dépend des lots backend en cours).
- Le rendu réel de chaque ajout sur du trafic réel : aucun n'a pu être vu, faute de trafic depuis le
  17/09/2026.
- Les pratiques internes de Datadog, IP-Label et Grafana au-delà de leur documentation publique et des
  lectures citées : là où ce document écrit « non trouvé », il ne dit pas « absent ».

---
## 8. Épique P** — Le site de présentation : ce que contient le POC, ce qu'il sait faire, ce qui reste pour un vrai outil de RUM

> Rédigée le 21/09/2026 sur `master` à `322c9a7` (dernier commit, 18/09/2026 17:27), relue contre le
> dépôt. **Identifiants** : dans ce § 8, `A1`…`F3` désignent les lignes du document de couverture
> `docs/RUM_PARITY_STATUS.md` (et non les dépendances backend B1… du § 6.3) ; `K1`–`K14` sont les
> cartes, `R1`–`R9` les points « Ce qui reste », `PS0`–`PS12` les sections de la page, `VS1`–`VS16` les
> constats, `TP1`–`TP12` les tests Playwright.
>
> **Ce que cette épique garantit.** Chaque phrase destinée au site est rattachée à une ligne du document
> de couverture (`docs/RUM_PARITY_STATUS.md`, relevé du 18/09/2026 sur `2f216cb`) ou à un fichier du
> dépôt, cité `fichier:ligne`. Chaque chiffre porte sa date et sa source. Un mécanisme (P**.0) fait
> échouer la CI si le site affiche une capacité avec un verdict que le document ne lui donne pas, ou
> s'il en tire le texte d'une ligne dont le verdict n'est pas celui de la partie qui l'affiche.
>
> **Ce qu'elle ne garantit pas.** Le document de couverture ne couvre que P5 à P8 : les écrans plus
> anciens (Web Vitals p75, sessions et rejeu, tracing, corrélation synthétique, score de santé,
> anomalies, tendances) n'y ont **pas de verdict**. Le site les cite donc comme **contenu**, jamais
> comme **capacité**. Rien de ce qui suit n'a été vu sur du trafic réel : aucune capacité n'est
> « éprouvée sur donnée réelle » (`RUM_PARITY_STATUS.md:133-134`). L'état de Railway après le 18/09
> (suppression éventuelle du service `ingest`) n'a pas été relevé : **non établi**, à relever avant
> publication (P**.8, liste de relecture).
>
> **Chemins.** Relatifs au dépôt ; console = `apps/console/`. Les renvois `plan/reads/*.md` et les
> captures `NN-*.png` sont des notes et captures de travail (§ 0.6, régénérables par l'annexe 9.1).

---

### 8.0 La règle de l'épique, et comment elle est tenue

**Règle : rien sur le site ne dépasse le document de couverture.** Concrètement :

1. La partie « Ce qu'il sait faire » ne montre **que** des lignes de `RUM_PARITY_STATUS.md` § 4 au
   verdict `deploye_non_eprouve` ou meilleur. Le vocabulaire du document ne contient aujourd'hui aucun
   verdict meilleur (`RUM_PARITY_STATUS.md:24-39`) : c'est donc `deploye_non_eprouve` et lui seul.
2. Chaque **identifiant** montré porte **sa propre limite**, en une phrase, tirée de la colonne
   « Limite » de **sa** ligne, sans en retirer la réserve principale. Une carte qui regroupe plusieurs
   identifiants affiche une liste : une puce par identifiant, préfixée de l'identifiant. Une phrase
   unique pour plusieurs identifiants n'est pas admise (elle perdrait des réserves, par exemple
   celles de `A8`, `A10`, `B1`, `B3`, `B4`, `B7`).
2 bis. Le **texte** d'une carte de la partie 2 (ce que ça fait, limites) ne vient que de lignes au
   verdict `deploye_non_eprouve`, ou de passages du document qui ne sont pas des lignes de capacité
   (par exemple les § 6.3 et § 6.4 du document de couverture), ou d'un fichier du dépôt. Une réserve tirée d'une ligne d'un autre
   verdict (par exemple `D7`, `non_commence`) va en partie 3, pas dans une carte de la partie 2.
3. Une ligne « déployée » mais **inerte** sur le trafic réel (`D12` connecteur de tickets, `D14`
   GeoIP) va dans « Ce qui reste », pas dans « Ce qu'il sait faire » : déployée ne veut pas dire
   active.
4. Tout chiffre de couverture (49, 34, date, SHA) est **calculé** à partir du document, jamais tapé
   dans un `.tsx`. Un nouveau relevé du document met le site à jour au build suivant.
5. Un verdict inconnu du parseur (par exemple un futur `eprouve_sur_donnee_reelle`) fait **échouer**
   l'extraction : un humain décide alors de ce que le site en dit.

Le mécanisme est le lot P**.0 (§ 8.4). Il reprend le principe déjà en place pour le poids du SDK :
`apps/console/lib/sdk-poids.ts:10-14` (« les valeurs sont REMESURÉES sur les fichiers versionnés par
`tests/unit/specs.test.ts` »).

---

### 8.1 Constat de départ : ce qui est faux ou trop affirmé aujourd'hui

Relevé sur les fichiers, le 21/09/2026. Source de synthèse : `plan/reads/site-presentation.md`.

| # | Où | Ce qui est affiché | Ce qui est vrai | Source |
|---|---|---|---|---|
| VS1 | `components/presentation/Capteurs.tsx:68` | « React Native (paquet privé, v0.1) » | le paquet est en `0.4.0`, et n'a jamais tourné sur un appareil | `packages/rum-mobile/package.json:3` ; `RUM_PARITY_STATUS.md:169`, `:178` (C1, C10) |
| VS2 | `lib/glossary.ts:188` (bulle `rum`, affichée sur `/presentation` par `page.tsx:52` et sur la Vue d'ensemble, capture de travail `01-overview`) | « Souverain UE, OTel-native. » | « Souveraineté : Non. Neon, Vercel et Railway sont trois sociétés de droit américain » | `lib/specs.ts:97-100` |
| VS3 | `app/presentation/page.tsx:70` | « Backend Node autonome — Railway » | le trafic entre par la route de la console sur Vercel ; le receveur Railway `ingest` n'a pas de domaine public | `docs/TOPOLOGIE_BACKEND.md:11`, `:78-82` ; `RUM_PARITY_STATUS.md:103-111` |
| VS4 | `lib/presentation-content.ts:23` | « Ingestion — Un service Node autonome — sans framework, déployable partout » | vrai pour l'auto-hébergement ; faux comme description du chemin de production | idem VS3 ; `TOPOLOGIE_BACKEND.md:88-91` |
| VS5 | `lib/specs.ts:108-112` | `ingest` : « Porte la commande pre-deploy des migrations », statut `atteint` | rôle repris par `scheduler` ; `ingest` en cours de retrait, sans domaine public | `TOPOLOGIE_BACKEND.md:24`, `:69-82` |
| VS6 | `app/presentation/page.tsx:73-75` (commentaire) | « fonctions serveur servies depuis iad1 » | la région configurée est `fra1` | `apps/console/vercel.json:3` ; `lib/legal.ts:34` |
| VS7 | `app/presentation/page.tsx:58-59` | « Un site rapide convertit mieux : le RUM le prouve avec des chiffres terrain. » | aucune ligne du document de couverture ne porte une preuve perf ↔ conversion ; aucune donnée réelle ingérée depuis les déploiements | `RUM_PARITY_STATUS.md:295-308` |
| VS8 | `components/AddClientCarousel.tsx:17` | `endpoint: "https://<ingest>/v1/traces"` | l'adresse servie est `/api/ingest/v1/traces` sur l'hôte de la console | `lib/ingest-endpoint.ts:16`, `:71` |
| VS9 | `components/AddClientCarousel.tsx:44-47` | la clé d'API est présentée comme l'étape qui sécurise | « le refus n'est pas encore le comportement par défaut » | `components/presentation/Specs.tsx:157-159` |
| VS10 | `components/AddClientCarousel.tsx:104` | « le RUM front fonctionne déjà à 100 % » | seul superlatif chiffré du site ; aucune mesure ne le fonde | `plan/reads/site-presentation.md:200-204` |
| VS11 | `lib/presentation-content.ts:38-116` (11 cartes « Les statistiques montrées ») | présent simple sans réserve : « triées par impact réel », « Chaque appel API relié à son exécution serveur », « sans seuil à régler » | ces écrans n'ont **aucun** verdict dans le document de couverture ; le tracing est « un seul saut, front → back » | `RUM_PARITY_STATUS.md:340-341` ; `lib/specs.ts:317` |
| VS12 | `lib/presentation-content.ts:28` | « chemin ClickHouse prouvé […] (mêmes p75, ×15 plus compact) » | exact, mais le banc est local, du 11/06/2026, avant P5–P8, et non rejoué depuis Neon | `infra/clickhouse.notes.md:7`, `:19-26` |
| VS13 | `lib/queries-planifie.ts:26-29` et `:53-56` | une lecture en échec rend `null`, que `Specs.tsx:201-240` affiche « aucune exécution constatée en production » | une panne de lecture est une **inconnue**, pas un fait « jamais exécuté » | invariant « Inconnu = null / « Inconnu » » |
| VS14 | `public/portail/console-tour.mp4` (1,7 Mo) + poster | présents, référencés nulle part | actif mort ; les écrans filmés vont changer (F04, F09) | `plan/reads/site-presentation.md:215-218` |
| VS15 | `app/presentation/page.tsx:1-5` (commentaire) | connecté → « rappel DANS la coquille console » | `/presentation` est un chemin public que le layout n'enveloppe pas, connecté ou non ; la capture `40-presentation.png` le montre sans barre latérale | `lib/chemins-publics.ts:4-12`, `:32-38` |
| VS16 | `lib/glossary.ts:190` (champ `business` de la même bulle `rum` que VS2, donc affichée aux mêmes endroits) | « C'est la donnée qui compte pour le chiffre d'affaires : un site rapide convertit mieux. » | même affirmation que VS7, même absence de preuve | `RUM_PARITY_STATUS.md:295-308` |

Ce qui est **juste** et se garde : le label « POC » partout (`Landing.tsx:37-47`), la légende
« Capture réelle de la console. Les chiffres affichés viennent d'un jeu de démonstration »
(`Landing.tsx:152-155`), la démo verrouillée plutôt qu'un lien mort (`Landing.tsx:55-84`), l'onglet
« Écart au marché » et sa liste « Ce qui manque » (`Specs.tsx:155-190`), la latence et la rétention
déduites d'une preuve en base plutôt qu'écrites en dur (`Specs.tsx:193-200`).

---

### 8.2 La nouvelle page, section par section

**Décision de structure.** Une seule page pour tous : visiteur et connecté voient les mêmes trois
parties (fin de la double rédaction `page.tsx` / `Landing.tsx`, source de VS15). Le connecté a en plus
le bouton « Ouvrir la console », les écrans cliquables et le carrousel « Brancher une application ».
Ordre : PS0 En-tête → PS1 Ancres → **Partie 1** (PS2–PS6) → **Partie 2** (PS7–PS9) → **Partie 3** (PS10) →
PS11 Annexe → PS12 Pied de page.

Conventions de rendu : `card` pour les blocs, `btn-accent` pour l'action principale, `PageHeader`
réservé au connecté ; tout texte < 18 px en `ink-soft`, pas `ink-faint` (§ 3.9). Aucune
couleur ne porte seule une information : le verdict est toujours écrit.

#### PS0 — En-tête (`components/presentation/Landing.tsx`, bloc `<main>` lignes 116-157)

- **Titre** : `MIP RUM` + label `POC` (inchangé).
- **Sous-titre (nouveau, texte exact)** :
  > Mesure de l'expérience vécue par les visiteurs réels d'un site ou d'une application : vitesse
  > d'affichage, réactivité, erreurs, parcours. Collecte au format OpenTelemetry, données hébergées
  > en Union européenne.
- **Ligne de relevé** (`components/presentation/Releve.tsx`, `data-testid="presentation-releve"`),
  valeurs calculées par `lib/couverture.ts` :
  > État relevé le **{releve}** sur `{sha}` : **{total}** capacités recensées, **{deployees}**
  > déployées, **aucune** éprouvée sur des données réellement ingérées.

  Valeurs au 21/09/2026 : `18/09/2026`, `2f216cb`, `49`, `34` (`RUM_PARITY_STATUS.md:3`, `:126-134`).
  Si la date de relevé a plus de 30 jours à la requête (la page est déjà `force-dynamic`,
  `page.tsx:16`), ajouter : « Ce relevé a plus de 30 jours ; l'état réel peut avoir changé. »
- **Actions** : visiteur = « Voir la démo » / « Se connecter » (inchangé, `Landing.tsx:58-94`) ;
  connecté = « Ouvrir la console → » (`btn-accent`, lien `/`).
- **Visuel** : capture V-A (§ 8.3), légende :
  > Capture réelle de la console, prise le {date du manifeste}. Les chiffres affichés viennent d'un
  > jeu de démonstration, pas d'un client en production.

  Tant que `public/portail/manifest.json` n'existe pas (avant P**.7), le segment « , prise le
  {date} » est omis : la date des captures actuelles n'est pas établie.

#### PS1 — Ancres (`components/presentation/Ancres.tsx`)

`<nav aria-label="Sommaire de la présentation">` : « Ce qu'il contient » · « Ce qu'il sait faire » ·
« Ce qui reste » · « Le détail ». À 390 px : rangée dans un conteneur `overflow-x-auto` (légitime pour
le test de débordement, `tests/e2e/analyses-drilldowns.spec.ts:140-150`). Chaque cible est un `<h2>`
avec `tabIndex={-1}` pour que le focus y arrive.

---

#### PARTIE 1 — « Ce qu'il contient » (`components/presentation/Contient.tsx`, `id="contient"`)

**Chapeau (texte exact)** :
> Ce que le dépôt contient et ce qui tourne aujourd'hui, pièce par pièce. Contenir n'est pas savoir
> faire : les capacités et leurs limites sont dans la partie suivante.

##### PS2 — Les capteurs (`components/presentation/Capteurs.tsx`, conservé, corrigé)

Garder les deux cartes. Changements :

- Carte « SDK embarqué », `limite` (texte exact, remplace `Capteurs.tsx:67-68`) :
  > Demande une mise en production côté client. Web ; React Native en paquet privé (v{RN_VERSION}),
  > jamais exécuté sur un appareil ni un simulateur ; pas de SDK iOS ou Android natif.

  `RN_VERSION` vient de `lib/versions.ts` (nouveau), vérifié contre `packages/rum-mobile/package.json:3`
  par `tests/unit/specs.test.ts` (même forme que la vérification d'`EXT_VERSION`,
  `tests/unit/specs.test.ts:184-185`). Source de la réserve : `RUM_PARITY_STATUS.md:169`, `:178`.
- Carte « Extension navigateur » : ajouter la version dans `specs` : `{ k: "Version", v: "{EXT_VERSION}, non publiée au Chrome Web Store" }`
  (`lib/specs.ts:56`). La limite existante (`Capteurs.tsx:46-47`) est juste : la garder.
- Ajouter, sous les deux cartes, une ligne (texte exact) :
  > Côté serveur : un agent Node (`packages/agent-node`) et un middleware FastAPI
  > (`integrations/fastapi`) relient un appel du navigateur à son exécution serveur, sur un seul saut.

  Source : `RUM_PARITY_STATUS.md:173-174` (C5, C6).

##### PS3 — Le chemin de la mesure (`components/presentation/Topologie.tsx`, nouveau, SVG rendu serveur)

Schéma à cinq boîtes, données dans `lib/presentation-topologie.ts` :

```
[Navigateur ou application : SDK, extension]
        │ OTLP/HTTP JSON
        ▼
[Collecteur : route /api/ingest/v1 de la console — Vercel, fra1 (Francfort)] ──► [PostgreSQL — Neon, aws-eu-central-1 (Francfort)]
                                                                                   ▲
[Travaux planifiés : alertes, SLO, sondes, purge — Railway, europe-west4 (Amsterdam)] ──┘
[Serveur MCP, lecture seule — Railway] ──► [API /api/v1 de la console] (ne touche pas la base)
```

- `role="img"`, `aria-label="Chemin de la mesure : du navigateur au collecteur de la console sur Vercel, puis à la base Neon à Francfort ; travaux planifiés et serveur MCP sur Railway à Amsterdam."`
  + `<details>` « Alternative textuelle » : table `<caption>` / `<th scope="col">` (Pièce · Hébergeur ·
  Région · Rôle), mêmes lignes que le dessin (§ 3.9).
- **Légende (texte exact)** :
  > Le collecteur est une route de la console : c'est l'adresse que visent les SDK. Le même parseur
  > existe en service Node autonome (`services/ingest/server.mjs`), construit et démarré par la CI,
  > pour un hébergement chez le client ; en production, il n'est pas sur le chemin du trafic.
  > Topologie relevée le 18/09/2026 par les API Railway et Vercel.

  Sources : `TOPOLOGIE_BACKEND.md:9-18`, `:22-25`, `:88-91` ; `RUM_PARITY_STATUS.md:80-87` ; régions :
  `lib/legal.ts:32-37`, `apps/console/vercel.json:3`.
- Pas d'animation de flux (§ 3.9, `prefers-reduced-motion`).
- Les migrations ne figurent pas dans le schéma : au 18/09/2026, qui les applique en production
  (`ingest` encore, `scheduler` visé) n'est pas prouvé (`TOPOLOGIE_BACKEND.md:71-76`) ; voir PS11.

##### PS4 — Où sont les données, et sous quel droit (`Contient.tsx`, table)

| Pièce | Hébergeur | Région | Droit de l'hébergeur |
|---|---|---|---|
| Base de données | Neon (sur AWS) | Francfort, Allemagne | américain |
| Console et collecteur | Vercel | Francfort (`fra1`) | américain |
| Travaux planifiés, serveur MCP | Railway | Amsterdam, Pays-Bas | américain |

Libellés importés de `HOSTS` (`lib/legal.ts:32-37`), comme le fait déjà `lib/specs.ts:90-96` —
jamais retapés. **Phrase sous la table (texte exact)** :
> La donnée et le calcul sont en Union européenne ; les trois hébergeurs relèvent d'un droit tiers.
> Ce POC n'est pas une offre souveraine. Aucune adresse IP n'est stockée, sous aucune forme.

Sources : `lib/specs.ts:97-100` ; `RUM_PARITY_STATUS.md:326-328`.

##### PS5 — Les écrans de la console (`components/presentation/EcransConsole.tsx`, remplace la grille STATS)

- Données : `CATEGORIES` exporté par `components/nav-items.tsx:20` (import direct, aucun libellé
  recopié : la liste suit la navigation refondue par le lot F09, § 2.4).
- Rendu : une `card` par catégorie, titre = libellé de catégorie, puis la liste des écrans. Visiteur :
  texte simple (ces routes exigent une session). Connecté : liens.
- **Chapeau (texte exact)** :
  > Les écrans qui existent dans la console. Ils ont été construits et testés sur des jeux de
  > démonstration ; aucun n'a encore été relu sur le trafic d'une vraie application.
- **Méthodes d'analyse (texte exact, un paragraphe sous les cartes)** :
  > Trois analyses automatiques, toutes en méthode statistique lisible, sans modèle entraîné : un
  > score de santé dont la pondération est affichée ; une détection d'anomalies par écart à la moyenne
  > (z-score, calculé en SQL) ; une projection de tendance par régression sur les séries journalières.
  > Elles ne sont pas couvertes par le relevé du 18/09/2026.

  Sources : `lib/glossary.ts:78`, `:86`, `:212` ; périmètre du relevé : `RUM_PARITY_STATUS.md:1`
  (« P5 à P8 »). Le mot « AIOps » et « du réactif au prédictif » (`presentation-content.ts:113-114`)
  disparaissent.
- Connecté seulement : sous PS5, section « Brancher une application » = `AddClientCarousel` corrigé
  (VS8, VS9, VS10 ; textes en P**.1).

##### PS6 — Autour de la console, et l'état de la chaîne (`Contient.tsx`)

Deux colonnes (une seule à 390 px).

**Accès programmatiques (texte exact)** :
> Une API publique en lecture (18 familles de routes, description OpenAPI servie sur `/api-docs`) et
> un serveur MCP en lecture seule (16 outils). Les jetons d'API ne donnent aucun droit d'écriture.

Sources : `RUM_PARITY_STATUS.md:203-204` (E1, E2 ; « 16 outils comptés le 18/09 »).

**L'état de la chaîne, relevé le 18/09/2026 (texte exact, valeurs depuis `lib/couverture.ts` et
`lib/sdk-poids.ts`)** :
> - 2 436 tests unitaires verts (168 fichiers) et 413 tests SQL (28 fichiers), joués sur un poste de
>   développement.
> - SDK cœur : {SDK_POIDS_TEXTE} ; le module de rejeu ({REPLAY_GZIP_KO} ko gzip) n'est chargé que si le
>   rejeu est activé.
> - Ce que ces chiffres ne disent pas : un test SQL échoue quand on joue la suite que la CI saute, la
>   CI ne vérifie pas les types, et la construction échoue sur un dépôt fraîchement installé. Tester
>   sur un poste ne dit rien du comportement sur du trafic réel.

Sources : `RUM_PARITY_STATUS.md:60-68`, `:414`, `:211-213` (F1–F3) ; `lib/sdk-poids.ts:17`, `:21`.
Les nombres de tests sont des constantes de `lib/couverture.ts` recopiées **du document** (pas du
dépôt) avec leur date : ils ne changent qu'avec un nouveau relevé.

**ClickHouse** : la phrase de `presentation-content.ts:28` est remplacée par (texte exact) :
> Pour les gros volumes, un chemin ClickHouse a été mesuré en local le 11/06/2026 : mêmes p75 au
> milliseconde près, stockage 15 fois plus compact à données identiques. Ce banc n'a pas été rejoué
> depuis la migration vers Neon.

Source : `infra/clickhouse.notes.md:7`, `:19-26`.

---

#### PARTIE 2 — « Ce qu'il sait faire » (`components/presentation/SaitFaire.tsx`, `id="sait-faire"`)

**Chapeau (texte exact)** :
> Ne figurent ici que les capacités que le document de couverture classe « déployé, non éprouvé » :
> le code est en service et ses tests passent, mais il n'a jamais rencontré de données réellement
> ingérées. Aucune capacité n'a encore de meilleur verdict. Chacune est donnée avec sa limite.

**Barre de couverture** (`components/presentation/CouvertureBarre.tsx`, SVG serveur, visuel V-E) :
49 segments groupés par verdict, légende écrite (« 34 déployées, non éprouvées · 5 livrées, non
déployées · 4 bloquées par un accès externe · 3 livrées avec un défaut connu · 2 non commencées ·
1 non retenue »), `role="img"` + table en `<details>`. Sources : `RUM_PARITY_STATUS.md:128-131`.

##### PS7 — Les capacités (`lib/presentation-sait-faire.ts` → cartes `data-testid="capacite"`)

Chaque carte : titre, une phrase « ce que ça fait », puis **« Limites : »** et une liste `<ul>` d'**une
puce par identifiant** (`data-testid="capacite-limite"`, `data-id="A8"`), chaque puce commençant par
sa pastille (`A8`) suivie de la phrase ; libellé du verdict (« Déployé, non éprouvé ») écrit une fois
dans l'en-tête de la carte ; attribut `data-verdict`. Une carte à un seul identifiant garde la même
structure (liste d'une puce), pour qu'un seul gabarit et un seul test suffisent. Grille 1 colonne à
390 px, 2 à 768, 3 à 1440 ; les cartes à 3 ou 4 puces ne sont pas tronquées (pas de « voir plus » :
une réserve cachée derrière un clic est une réserve cachée).

Modèle de données (`lib/presentation-sait-faire.ts`) :
`{ id: "K3", titre, faitQuoi, limites: { id: "A8", texte }[], sources: Source[] }` avec
`Source = { ligne: "A8" } | { passage: number /* ligne du document hors table de capacités */ } | { fichier: string /* chemin:ligne du dépôt */ }`.
Les identifiants de la carte sont **dérivés** de `limites` (pas de liste séparée qui pourrait diverger).

| Carte | Titre (exact) | Ce que ça fait (exact) | Limites (exactes, une puce par identifiant) | Sources |
|---|---|---|---|---|
| K1 | Remonter d'une erreur à son contexte | Depuis une erreur, ouvrir la session, l'action, la trace et le rejeu où elle s'est produite. | **A1** — Un lien n'apparaît que si la relation existe dans la même application ; une trace d'une autre application rend une erreur 404. Le rejeu s'arrête à ce qui a réellement été enregistré. | A1 (`:140`) |
| K2 | Compter sans confondre | Les occurrences sont la somme des répétitions reçues ; sessions, visiteurs et utilisateurs identifiés sont comptés à part et ne s'additionnent pas. | **A2** — Quand l'identité est inconnue, l'impact s'affiche « Inconnu », et une erreur de service backend sans session n'a aucun impact utilisateur. | A2 (`:141`) ; passage `:312-313` (§ 6.3) |
| K3 | Regrouper les erreurs en issues et les suivre | Regrouper les occurrences en issues stables, les trier (statut, assignation, commentaire, lien de ticket), distinguer régression et réapparition, alerter sur une nouvelle issue ou un pic. | **A7** — Le regroupement v2 n'est activé pour aucune application ; un « Script error. » sans contexte reste peu discriminant et tombe dans un regroupement marqué de faible confiance. · **A8** — Le commentaire libre d'un opérateur n'est pas nettoyé quand l'issue survit à un effacement : on ne peut pas savoir s'il cite une donnée personnelle, une relecture humaine reste nécessaire. · **A9** — Sans marqueur de déploiement comparable, l'écran affiche « Réapparition à vérifier » et ne rouvre pas l'issue. · **A10** — Sans données suffisantes, la règle rend « pas de données », jamais un zéro ; les alertes « nouvelle erreur » plus anciennes restent fondées sur l'empreinte, pas sur l'issue. | A7–A10 (`:146-149`) |
| K4 | Capter plus que les exceptions | Erreurs de console, ressources qui échouent, violations CSP et appels réseau en échec, par catégorie activable. | **A3** — Les quatre catégories sont à activer une à une et ne le sont pour aucune application ; quand le navigateur ne donne pas le statut HTTP d'une ressource, il reste inconnu. | A3 (`:142`) |
| K5 | Retrouver le code source d'une pile minifiée | Dé-minifier une pile avec une source map déposée par un jeton dédié ou une ligne de commande. | **A5** — Aucune source map n'a été déposée par une application réelle ; une source map arrivée après les premières occurrences peut ouvrir une seconde issue. · **A6** — Seule la route de la console est joignable, par lots de 3 Mio au plus ; le branchement dans la CI d'un client n'est pas fait (voir R3). | A5, A6 (`:144-145`) |
| K6 | Filtrer et découper partout de la même façon | Les mêmes filtres sur chaque écran ; découpage par navigateur, système, appareil, pays estimé, release et route ; recherche de session ; ressources lentes et blocages du fil principal. | **B1** — Les écrans plus anciens (journaux, SVI, assistant IA) filtrent encore par application nommée, pas par le périmètre effectif ; un écran qui ne sait pas appliquer un filtre l'annonce non appliqué. · **B2** — Les données antérieures à la migration v75 s'affichent « Inconnu » ; un iPad récent est compté comme ordinateur ; le pays est estimé depuis le fuseau horaire, ce n'est pas une géolocalisation. · **B3** — La recherche est une égalité stricte sur trois champs (identifiant technique, route normalisée, release) : ni motif, ni recherche par identité, par décision de produit. · **B4** — Seules les ressources retenues par le SDK (plus de 300 ms, 20 par page vue) sont mesurées : un échantillon biaisé vers le lent, jamais extrapolé ; aucune somme des blocages. | B1–B4 (`:155-158`) ; passage `:315-320` (§ 6.4) |
| K7 | Explorer, composer un tableau de bord, exporter | Interroger librement un jeu de champs borné, enregistrer une vue, construire un tableau de bord, exporter en CSV. | **B5** — Les champs viennent d'un registre fermé ; un dépassement de budget rend une erreur, jamais une série de zéros. · **B6** — 24 cartes par tableau, 4 lectures simultanées, aucun rafraîchissement automatique. · **B7** — 50 vues par compte et par application ; aucune vue publique ni partage à l'échelle de l'application. · **B8** — 10 000 lignes par export au plus, la troncature étant écrite dans le fichier. | B5–B8 (`:159-162`) |
| K8 | Répondre vite sur de gros volumes | Des agrégats horaires servent les lectures qui portent exactement les mêmes dimensions. | **B9** — Un agrégat ne sert que s'il porte toutes les dimensions demandées, sinon la lecture repart des données brutes ; les temps mesurés viennent d'un jeu synthétique sur un poste : ce n'est pas un engagement de service. | B9 (`:163`) |
| K9 | Relier le navigateur à un service Node ou FastAPI, et en capter les erreurs | Instrumenter un service Node ou une API FastAPI, capter ses erreurs sans inventer de session, et les rattacher à l'appel du navigateur. | **A4** — Aucun émetteur backend ne tourne en production ; une double instrumentation journal + span sans identifiant d'exception commun n'est pas fusionnée, et l'écran ne le signale pas. · **C5** — Aucun service Node n'émet vers la production ; un envoi peut être perdu à l'arrêt brutal du processus. · **C6** — Un seul framework (FastAPI/Starlette) et un seul saut de trace : ni propagation d'un service à un autre, ni span de base de données. | A4 (`:143`), C5, C6 (`:173-174`) ; passage `:340-341` (tableau de synthèse des runtimes, hors lignes de capacité) |
| K10 | Lire l'état d'une application mobile | Un écran, une route d'API et un outil MCP résument l'état d'une application React Native. | **C7** — Aucune session React Native réelle n'alimente l'écran ; crashes natifs, ANR et démarrage natif s'affichent « Non collecté », jamais 0 ; le taux affiché est celui des sessions sans erreur JavaScript, pas un taux sans crash. · **C8** — Aucune interface ne permet à un opérateur de valider une capacité déclarée ; une capacité déclarée par le SDK ne vaut pas une recette. | C7, C8 (`:175-176`) |
| K11 | Effacer et exporter les données d'une personne ou d'une application | Effacer sans qu'un envoi en cours ne recrée la donnée, refuser durablement la personne effacée, exporter ses données, effacer une application entière. | **D1** — Aucun effacement réel n'a encore été demandé : le protocole est prouvé par 17 tests de concurrence, pas par la production ; rien ne refuse automatiquement un émetteur antérieur à la migration v81. · **D2** — La trace de l'effacement est conservée sans expiration ; elle est elle-même une donnée pseudonyme ; aucune voie de réactivation n'existe ; un fragment de rejeu arrivé avant son ancre est perdu. · **D3** — L'export refuse les anciens identifiants de classe d'appareil, pour ne pas joindre les données d'un tiers ; un événement totalement anonyme n'est rattachable à personne. · **D4** — La configuration d'exploitation (SLO, objectifs, canaux de notification, sondes, jetons, marqueurs de déploiement) n'est pas supprimée. | D1–D4 (`:184-187`) |
| K12 | Purger selon la rétention | Une tâche planifiée purge les données au-delà de la durée de rétention de chaque client. | **D5** — La purge ne couvre pas encore les tables de supervision SVI. | D5 (`:188`) |
| K13 | Isoler les clients en base | Un script lit la base sous le rôle de la console, sans aucun filtre applicatif, et vérifie qu'aucune donnée d'un autre client n'est visible. | **D6** — L'isolation est prouvée en base, mais la connexion de production utilise encore un rôle propriétaire qui contourne ces règles : elle repose aujourd'hui sur le code de la console. | D6 (`:189`) ; fichier `components/presentation/Specs.tsx:160-163` |
| K14 | Lire par API et par MCP, écrire depuis la console | API publique en lecture, serveur MCP en lecture seule, écritures (triage, tableaux de bord, vues) réservées aux sessions d'administration. | **E1** — Les jetons d'API sont strictement en lecture ; aucune route n'a été appelée sur des données réellement ingérées. · **E2** — Lecture seule par construction ; le catalogue n'expose pas encore les dimensions de découpage. · **E3** — Viewer et démo n'ont aucun droit d'écriture ; un administrateur est limité à son périmètre d'applications. | E1–E3 (`:203-205`) |

Dans le tableau, « · » sépare les puces ; dans le code, ce sont des entrées distinctes de `limites`.
La réserve de `D7` (sauvegardes) **ne figure pas** dans K11 : `D7` est
`non_commence` (`:190`) et reste en R9, seul endroit où elle figure (règle 2 bis).

**Contrôle de couverture, recompté à la main identifiant par identifiant** :
A — K1 (A1), K2 (A2), K4 (A3), K9 (A4), K5 (A5, A6), K3 (A7–A10) = 10 ;
B — K6 (B1–B4), K7 (B5–B8), K8 (B9) = 9 ;
C — K9 (C5, C6), K10 (C7, C8) = 4 ;
D — K11 (D1–D4), K12 (D5), K13 (D6) = 6 ;
E — K14 (E1–E3) = 3.
Total 10 + 9 + 4 + 6 + 3 = **32** cartes-identifiants, plus `D12` et `D14` en Partie 3 (règle 3) =
**34**, égal au nombre de lignes `deploye_non_eprouve` (`RUM_PARITY_STATUS.md:128`). Oublier `A4`
donnerait 31 + 2 = 33 : le test P**.0 n° 3 échouerait, ce qui est précisément son rôle. Ce décompte manuel ne remplace pas le test ; il atteste que le contenu livré
par cette épique le passe.

##### PS8 — Une façon de compter (`SaitFaire.tsx`, bloc « Méthode »)

Quatre énoncés courts, chacun sourcé dans le document de couverture (texte exact) :

> - **Inconnu n'est pas zéro.** Une valeur qu'on ne connaît pas s'affiche « Inconnu » ; une mesure
>   sans dénominateur n'a pas de valeur ; seul un compteur réellement vide vaut 0.
> - **Une capacité absente n'affiche pas de zéro.** Il n'existe aucune table de crash natif : l'écran
>   mobile dit « Non collecté » plutôt qu'un taux sans crash qui ne reposerait sur rien.
> - **L'échantillonnage est dit, pas corrigé.** Les comptes sont ceux reçus, sans multiplicateur ;
>   l'écran indique la probabilité qu'une erreur avait d'être retenue.
> - **Aucune adresse IP n'est conservée.** Le pays est estimé, et nommé « Pays estimé » partout.

Sources : `RUM_PARITY_STATUS.md:43-45`, `:253-260`, `:312-313`, `:319-328`.

##### PS9 — Où se situe ce POC (`components/presentation/Positionnement.tsx`)

Table factuelle, sans superlatif. La colonne « IP-Label Ekara » n'admet que des éléments étiquetés
**documenté** dans `plan/reads/iplabel.md` (jamais « rapporté (prudence) ») ; en-tête de colonne :
« IP-Label Ekara, d'après ses pages publiques consultées en septembre 2026 ».

| Critère | IP-Label Ekara | Ce POC |
|---|---|---|
| Découpage par opérateur et type de réseau | Documenté (Orange, SFR, 4G, Wi-Fi…) — `iplabel.md:69-79` | Prévu, non branché |
| Robots synthétiques rapprochés du RUM | Documenté comme principe — `iplabel.md:125-154` | Un écran de corrélation existe, hors du relevé de couverture |
| Extension navigateur pour postes gérés | Documenté (Chrome/Edge, déploiement GPO/Intune) — `iplabel.md:168-185` | Extension MV3, non publiée au Chrome Web Store |
| Hébergement en UE | Documenté comme option — `iplabel.md:219-229` | Données en UE, hébergeurs de droit américain |
| SDK mobile natif iOS/Android | Non repris : source « rapporté (prudence) », `iplabel.md:254-263` | Non |

**Phrase sous la table (texte exact)** :
> Cette table compare ce qui est publié, pas ce qui a été essayé : nous n'avons pas utilisé Ekara.

La ligne « Non repris » **n'est pas affichée** sur le site ; elle est dans ce plan pour dire pourquoi.
Rien sur Datadog dans cette table : les comparaisons Datadog appartiennent aux écrans de la console
(§ 8.5), pas à la vitrine.

---

#### PARTIE 3 — « Ce qui reste pour un vrai outil de RUM » (`components/presentation/Reste.tsx`, `id="reste"`)

**Chapeau (texte exact)** :
> Ce qui sépare ce POC d'un outil qu'on met en service chez un client. Pour chaque point : ce qui
> manque, ce qui le débloquerait, et qui décide.

Données : `lib/presentation-reste.ts`, tableau de `{ id, titre, manque, debloque, decide, sources: string[] }`.
Rendu : une `card` par point, trois lignes étiquetées « Ce qui manque » / « Ce qui le débloque » /
« Qui décide », pastilles des identifiants de couverture. Ordre fixe ci-dessous.

| # | Titre (exact) | Ce qui manque (exact) | Ce qui le débloque (exact) | Qui décide | Sources |
|---|---|---|---|---|---|
| R1 | Une recette sur une vraie application | Aucune donnée n'a été ingérée depuis les déploiements ; le dernier événement reçu date du 17/09/2026 à 17:23, d'après le journal de livraison (non recontrôlé). | Réactiver un émetteur sur une application de recette, attendre quelques centaines d'événements, puis relire les erreurs, l'Explorer, un tableau de bord et l'écran mobile. | L'équipe MIP ; c'est le point le moins coûteux. | `:295-308`, `:560-563` |
| R2 | P8.3 — Reprise de l'historique | L'outil de reprise est livré et testé (dry-run, vérification), mais sa migration n'est pas appliquée en production. L'exécution a été écartée le 18/09/2026 : environ 97 lignes étaient concernées (chiffre non recontrôlé). | Rien n'est obligatoire. Appliquer la migration v83 si une reprise redevient nécessaire. | Le responsable du produit. | `:191-192` (D8, D9), `:546-548` |
| R3 | P8.4 — Source maps dans l'intégration continue du client | Jamais entamé. | Un accès au dépôt et au build du client, un identifiant d'application, une convention de release, un jeton d'upload rangé dans les secrets de sa CI. | Le client. | `:193` (D10) |
| R4 | P8.5 — Crashes natifs iOS et Android | Rien n'est livré, volontairement : aucune table de crash natif n'existe, pour qu'aucun écran ne lise un zéro. | Choisir un moteur ou un fournisseur, disposer d'une application native, de builds signés, de symboles et d'appareils. | Le client et l'équipe MIP. | `:194` (D11) |
| R5 | React Native : une matrice de compatibilité vide | Le paquet n'est pas publié et n'a tourné sur aucune version de React Native, Hermes, iOS ou Android ; un visiteur mobile est recompté à chaque lancement de l'application ; la file hors ligne durable est désactivée par défaut. | Choisir le registre, le compte, le nom et la politique de versions ; exécuter le paquet sur une matrice réelle ; persister l'identifiant du visiteur. | L'équipe MIP. | `:169-172`, `:177-178` (C1–C4, C9, C10) |
| R6 | Le pays par adresse IP, inerte tant que la collecte passe par Vercel | La résolution est déployée dans l'image Railway, mais le trafic entre par la route de la console sur Vercel, qui ne l'appelle pas ; la base elle-même reste à déposer. Aucun pays n'est résolu aujourd'hui. | Choisir entre un collecteur backend public et une résolution depuis la console. Aucun des deux n'est tranché. | L'équipe MIP. | `:197` (D14) ; `TOPOLOGIE_BACKEND.md:100-111` |
| R7 | Tickets : le connecteur existe, la cible ITSM n'est pas confirmée | Un connecteur GitHub Issues est déployé mais aucune intégration n'est configurée ; le webhook n'a jamais reçu de livraison d'un vrai fournisseur ; résoudre une issue ne ferme pas le ticket. La cible annoncée pour MIP (ServiceNow) n'est pas confirmée. | Confirmer l'outil ITSM cible, ouvrir un espace et ses droits, poser un secret de webhook, décider de la synchronisation des statuts. | La DSI de MIP. | `:195-196` (D12, D13) |
| R8 | Souveraineté et mise en service chez un client | Les trois hébergeurs relèvent du droit américain ; la console n'a pas d'image conteneur, donc « déployable chez vous » n'est pas livrable de bout en bout ; la clé d'ingestion n'est pas encore exigée par défaut ; aucune certification. | Choisir un hébergeur relevant du droit européen, conteneuriser la console, fermer l'ingestion par défaut, lancer une démarche de certification si un appel d'offres l'exige. | Le responsable du produit et le client. | `lib/specs.ts:97-100` ; `Specs.tsx:157-159`, `:182-189` |
| R9 | Une chaîne de livraison qui dit vrai | La CI ne vérifie pas les types ; deux suites SQL ne tournent jamais en CI, dont une est rouge ; la construction échoue sur un dépôt fraîchement installé ; la restauration d'une sauvegarde sans ressusciter des données effacées n'est pas écrite. | Quatre corrections courtes dans la CI et le build, et l'écriture de la procédure de restauration. | L'équipe MIP. | `:211-213` (F1–F3), `:190` (D7), `:567-575` |

Colonne « Sources » : lignes de `docs/RUM_PARITY_STATUS.md` sauf mention. Les chiffres de R1 et R2
viennent du document qui dit lui-même ne pas les avoir recontrôlés (`:303-304`, `:192`) : la mention
« non recontrôlé » est **obligatoire** dans le texte affiché.

---

#### PS11 — Le détail, ligne par ligne (`components/presentation/Annexe.tsx` + `Specs.tsx`)

- **Annexe (nouvelle)** : les 49 capacités du document, en six `<details>` (une famille chacun,
  titres de `RUM_PARITY_STATUS.md:126-127`), colonnes « # · Capacité · Verdict · Limite », générées
  depuis `lib/couverture.ts`. Chapeau (texte exact) :
  > Le document de couverture du {releve}, tel quel : une ligne par capacité, son verdict et sa limite.
- **`Specs.tsx` conservé** (onglets Infrastructure / Mesures / Écart au marché), avec :
  - le groupe « Backend — trois services autonomes » (`lib/specs.ts:104`) renommé « Backend — collecteur
    sur Vercel, travaux planifiés et MCP sur Railway » ; ligne `ingest` réécrite (texte exact) :
    > Receveur OTLP autonome (`services/ingest/server.mjs`), gardé pour l'hébergement chez le client et
    > démarré par la CI. En production, aucun domaine public ne pointe dessus et le trafic passe par la
    > route de la console ; sa suppression est proposée, pas actée au 18/09/2026.

    statut `partiel` ; ligne `scheduler` : ajouter (texte exact, au conditionnel tant que la bascule
    n'est pas constatée) :
    > A reçu la commande de pré-déploiement des migrations. Au 18/09/2026, elle n'était pas encore
    > prouvée par un déploiement réel : c'est `ingest` qui appliquait les migrations.

    Source : `TOPOLOGIE_BACKEND.md:71-76` (« État au 18/09/2026 : le service existe encore et applique
    toujours les migrations. Le `scheduler` a reçu la même commande de pré-déploiement ; elle sera
    prouvée par le premier vrai déploiement qu'il recevra »). La ligne de tableau `:24` décrit le rôle
    **visé** et ne suffit pas seule. Cette phrase n'est remplacée par « Applique les migrations au
    pré-déploiement. » qu'après la relecture P**.8 n° 1, sur la preuve d'un journal de déploiement du
    `scheduler` contenant « migrations à jour » (date et identifiant de déploiement notés dans la PR).
    Même règle pour la légende de PS3, qui ne cite plus les « migrations » dans la boîte des travaux
    planifiés avant cette preuve : la boîte PS3 devient « Travaux planifiés : alertes, SLO, sondes,
    purge — Railway, europe-west4 (Amsterdam) ».
  - VS13 : `dernierPassagePlanifie` / `dernierTickScheduler` rendent `{ etat: "lu", date } | { etat: "illisible" }` ;
    `volatiles` gagne une branche : `reel` = « Non établi : la lecture de l'état du planificateur a
    échoué » et statut `non-mesure` ; aucun ajout dans « Ce qui manque » sur une lecture en échec.
  - États : `Specs` est enveloppé dans `<Suspense>` avec un squelette `aria-busy` (« Chargement du
    détail technique ») ; le reste de la page est statique et ne dépend d'aucune lecture.

#### PS12 — Pied de page (`Landing.tsx:164-173`)

Remplacer « POC · OpenTelemetry-natif · données en UE, souveraineté visée » par (texte exact) :
> MIP RUM — POC · OpenTelemetry · données hébergées en UE, hébergeurs de droit américain

---

### 8.3 Visuels à produire

| Réf. | Contenu | Fichier | Produit par | Quand |
|---|---|---|---|---|
| V-A | Vue d'ensemble, 1440 × 900, clair et sombre | `public/portail/overview-light.png`, `overview-dark.png` (remplacés) | `scripts/captures-portail.mjs` (nouveau) | après les lots F04 et F09 (bandes de seuils, navigation) ; d'ici là, les fichiers actuels restent |
| V-B | Détail d'une issue avec les liens session / trace / rejeu (illustre K1) | `public/portail/issue-light.png`, `issue-dark.png` | idem | après F21 (`/errors/issues/[id]`, § 5.3) |
| V-C | Écran mobile affichant « Non collecté » (illustre K10 et PS8) | `public/portail/mobile-light.png` | idem | dès P**.7 |
| V-D | Topologie | aucun fichier : SVG rendu par `Topologie.tsx` depuis `lib/presentation-topologie.ts` | code | P**.3 |
| V-E | Barre de couverture 49 capacités | aucun fichier : SVG rendu par `CouvertureBarre.tsx` depuis `lib/couverture.ts` | code | P**.4 |
| V-F | Visite vidéo | `public/portail/console-tour.mp4` + poster : **retirés** en P**.7 | à ré-enregistrer par `scripts/record-console-tour.mjs` après F09, puis réintroduite par un lot séparé | hors épique |

**`scripts/captures-portail.mjs` (nouveau)** — cahier des charges :

1. Prérequis identiques à `scripts/record-console-tour.mjs:6-12` : Postgres migré, trafic de
   démonstration par `scripts/gen-traffic.mjs`, console en build de production sur `:3000`, compte
   créé par `scripts/seed-admin.mjs`. Variables : `MIP_BASE`, `MIP_APP` (défaut `demo-app`),
   `MIP_EMAIL`, `MIP_PASSWORD`.
2. Connexion hors capture (même méthode que `record-console-tour.mjs:44-50`), cookie `mip-project`.
3. Pour chaque vue (`/`, `/errors/issues/<première issue de la démo>`, `/mobile`) et chaque thème :
   poser `localStorage["mip-theme"]` (`components/ThemeToggle.tsx:13`) puis recharger ; attendre
   `networkidle` ; masquer le widget « Votre avis ? » par une feuille de style injectée (sélecteur à
   lire dans `public/mip-rum-feedback.js` : **non établi** aujourd'hui).
4. **Garde-fou avant chaque capture** : si `document.body.innerText` contient une adresse IPv4
   (`/\b\d{1,3}(\.\d{1,3}){3}\b/`) ou une adresse électronique, le script s'arrête en erreur sans
   écrire de fichier (invariant « aucune identité brute ni IP à l'écran »).
5. Écrit les PNG dans `apps/console/public/portail/` et un `manifest.json` :
   `{ fichier, route, theme, largeur, hauteur, date, sha, jeu: "scripts/gen-traffic.mjs" }`. La
   légende de PS0 lit `date` dans ce manifeste.
6. Échoue si un fichier dépasse 250 Ko (les captures actuelles font 120-122 Ko).

---

### 8.4 Sous-lots

Tailles : S ≤ 1 jour, M ≤ 3 jours (estimation, non mesurée). Chaque lot se termine par
la définition de « fait » du § 0.4 (`pnpm --filter console typecheck`, `pnpm test:unit`) et les e2e cités.

#### P**.0 — Le document de couverture, lisible par le code (M)

- **Fichiers** : `scripts/couverture-extraire.mjs` (nouveau) ; `apps/console/lib/couverture.generated.json`
  (produit, versionné) ; `apps/console/lib/couverture.ts` (types `Verdict`, `Capacite`, fonctions
  `compte(verdict)`, `parFamille()`, constantes `RELEVE`, `SHA`, `TESTS_UNITAIRES`, `TESTS_SQL`) ;
  `tests/unit/couverture-site.test.ts` (nouveau).
- **Extraction** : lit `docs/RUM_PARITY_STATUS.md` ; date et SHA sur la ligne 3 ; les lignes de table
  `| A1 |` … `| F3 |` des § 4.1–4.6 (colonnes # · Capacité · Verdict · Preuve · Limite) ; verdict
  obligatoirement dans les sept valeurs de `:27-35`, sinon sortie en erreur avec la ligne fautive.
  Chaque entrée du JSON porte aussi son **numéro de ligne** dans le document (`ligne`), pour que le
  test n° 3 sache à quelle capacité correspond une source citée par numéro.
- **Découpage des cellules** : un `|` n'est un séparateur de colonne que hors d'un segment
  `` `code` `` et s'il n'est pas échappé (`\|`). L'extracteur lit la ligne caractère par caractère
  (bascule dedans / dehors à chaque accent grave), pas par `split("|")`. Toute ligne de capacité qui
  ne donne pas **exactement cinq** cellules fait échouer l'extraction avec le numéro de ligne et le
  nombre de cellules trouvé. Aucune ligne actuelle du document n'a été constatée fautive ; la règle
  vise les cellules à code et points-virgules, par exemple `RUM_PARITY_STATUS.md:145`, `:195`.
- **Tests** (`couverture-site.test.ts`) :
  1. extraire le document et comparer au JSON versionné — un écart échoue avec « relancer
     `node scripts/couverture-extraire.mjs` » ;
  2. 49 lignes ; répartition égale à la phrase de `:128-129` (nombres relus dans le texte) ;
  0. (préalable) fixture `tests/unit/fixtures/couverture-cellules.md` : une ligne de capacité dont
     une cellule contient `` `a|b` `` et une autre `\|` ; l'extracteur en tire cinq cellules, et une
     ligne à six cellules le fait échouer avec son numéro ;
  3. partie 2, trois contrôles distincts :
     a. **identifiants** — chaque entrée de `limites` de chaque carte de `lib/presentation-sait-faire.ts`
        porte un identifiant au verdict `deploye_non_eprouve` ; aucun identifiant n'apparaît dans deux
        cartes ; l'union des identifiants des cartes + `{D12, D14}` = l'ensemble des lignes
        `deploye_non_eprouve` (échec avec la liste des manquants et des surnuméraires) ; `D12` et
        `D14` figurent dans `lib/presentation-reste.ts` ;
     b. **provenance du texte** — chaque `Source` d'une carte est résolue : `{ ligne: id }` doit
        désigner une capacité `deploye_non_eprouve` ; `{ passage: n }` doit désigner une ligne du
        document qui **n'est pas** une ligne de capacité (comparée aux numéros `ligne` du JSON) — si
        elle l'est, elle est traitée comme `{ ligne }` et soumise à la même règle ; `{ fichier }` doit
        exister dans le dépôt et avoir au moins autant de lignes que cité. Une source vers `D7` ou toute
        autre ligne d'un autre verdict fait échouer le test en nommant la carte ;
     c. **une puce par identifiant** — pour chaque carte, l'ensemble des identifiants de `limites` =
        l'ensemble des identifiants cités en `{ ligne }` dans `sources` ; chaque `texte` est non vide.
     Ce test ne vérifie pas que la phrase **reprend** la réserve principale : c'est un jugement,
     laissé à la relecture P**.8 n° 2, puce par puce ;
  4. chaque point de `presentation-reste.ts` cite au moins une source qui existe (identifiant ou
     `fichier:ligne`) ;
  5. lexique : dans `components/presentation/*.tsx`, `lib/presentation-*.ts`,
     `components/AddClientCarousel.tsx` et **tous les champs** de l'entrée `rum` de `lib/glossary.ts`
     (`term`, `stack`, `business`), aucun de `/\brobuste/i`, `/\bcomplète?s?\b/i`, `/100\s?%/`,
     `/prêt pour la production/i`, `/temps réel/i`, `/\bcertifié/i`, `/\bsouverain\b/i`,
     `/\bconverti(t|r|ssent)?\b/i`, `/\bconversion\b/i`, `/chiffre d'affaires/i` ; « souveraine »
     n'est admis que dans la phrase exacte de PS4. Les trois derniers motifs visent VS7 et VS16 : le site
     ne dit pas ce que le RUM prouverait sur les ventes ;
  6. aucun littéral `49` ou `34` dans `components/presentation/*.tsx` (ils viennent de `couverture.ts`).
- **Preuve de fin** : modifier à la main un verdict dans une copie du document fait rougir le test 1 ;
  remplacer `deploye_non_eprouve` par un verdict inventé fait échouer l'extraction ; retirer la puce
  `A4` de K9 fait échouer le test 3a en nommant `A4` ; ajouter `{ ligne: "D7" }` aux sources de K11
  fait échouer le test 3b en nommant K11 et `D7`. Les quatre sorties d'échec sont collées dans la PR.

#### P**.1 — Corrections de vérité sur l'existant (S, livrable seul, sans attendre la refonte)

- **Fichiers** : `components/presentation/Capteurs.tsx:67-68` ; `lib/versions.ts` (nouveau, `RN_VERSION`) ;
  `lib/glossary.ts:188` → « SDK navigateur (Web Vitals, erreurs, traces) → OTLP → PostgreSQL → console
  Next.js. Données hébergées en UE, format OpenTelemetry. » ; `lib/glossary.ts:190` (VS16, champ
  `business`) → « On mesure ce que vivent les visiteurs réels du site en production, pas une
  simulation. Ces mesures disent ce qu'ils ont vécu ; seules, elles ne disent pas l'effet sur les
  ventes. » ; `app/presentation/page.tsx:58-59`
  (supprimer la dernière phrase), `:70` (→ « Collecte : route de la console, Vercel (Francfort) » et
  « Travaux planifiés et MCP : Railway (Amsterdam) »), `:73-75` (commentaire `iad1` → `fra1`) ;
  `lib/presentation-content.ts:23` (→ « La route d'ingestion de la console aplatit le flux OTLP et
  l'écrit en base. Le même parseur existe en service Node autonome pour l'hébergement chez le
  client. »), `:28` (phrase ClickHouse de PS6) ; `lib/specs.ts:104-118` (PS11) ;
  `components/AddClientCarousel.tsx:17` (endpoint depuis `lib/ingest-endpoint.ts`), `:44-47` (ajouter :
  « Tant que l'ingestion n'est pas fermée par défaut, une requête sans clé valide n'est pas
  forcément refusée. »), `:104` (→ « Étape facultative : sans elle, la mesure côté navigateur
  fonctionne ; seul le lien vers l'exécution serveur manque. ») ; `lib/queries-planifie.ts` +
  `components/presentation/Specs.tsx:201-240` (VS13) ; `Landing.tsx:166` (PS12).
- **Tests** : `tests/unit/specs.test.ts` — `RN_VERSION` égal à `packages/rum-mobile/package.json` ;
  unitaire `volatiles({ etat: "illisible" })` → statut `non-mesure`, aucun point « Tâches planifiées à
  relancer » ; unitaire : le snippet du carrousel contient `/api/ingest/v1/traces`.
- **Preuve de fin** : `grep -rn "v0.1\|Souverain UE\|iad1\|<ingest>\|100 %\|convertit" apps/console/{app/presentation,components/presentation,components/AddClientCarousel.tsx,lib/glossary.ts}` ne rend rien.
- **Note** : P**.1 touche aussi `lib/specs.ts:104-118` ; la ligne `scheduler` y prend la phrase au
  conditionnel de PS11, pas la phrase affirmative.

#### P**.2 — Ossature : une page, trois parties (M) — dépend de P**.0

**Non livrable seul.** P**.2 remplace la page publique actuelle ; fusionné et déployé seul, il
montrerait à un vrai visiteur de `/presentation` (chemin public, `lib/chemins-publics.ts:24`) trois
titres sans contenu. Règle de livraison, qui vaut pour P**.2 à P**.6 et la recette P**.8 :

- tout est développé sur une **branche d'intégration** `presentation/refonte`, tirée de `master` après
  la fusion de P**.1 ; chaque sous-lot y est fusionné par sa propre PR (revue lot par lot) ;
- la branche n'est fusionnée dans `master` — donc déployée en production — qu'en **une seule PR**,
  quand P**.3, P**.4, P**.5, P**.6 y sont tous fusionnés et que la recette P**.8 y est verte ;
- `master` est refusionnée dans la branche au moins à chaque nouveau relevé du document de
  couverture, pour que le test P**.0 n° 1 y reste significatif ;
- d'ici là, la page publique reste celle de `master`, corrigée par P**.1.

Pas de drapeau de fonctionnalité : il ferait coexister deux pages dans le code, précisément la double
rédaction que la refonte supprime (VS15). Les aperçus Vercel de la branche, s'ils sont activés sur ce
projet (**non établi**), ne sont pas la page publique ; ils peuvent servir à la relecture P**.8.

- **Fichiers** : `app/presentation/page.tsx` (rend `<Landing user={user} />` pour tous ; supprime la
  branche connectée à part et la grille `STATS`) ; `components/presentation/Landing.tsx` (sous-titre,
  actions selon `user`, montage des parties) ; nouveaux `Releve.tsx`, `Ancres.tsx`, `Contient.tsx`,
  `SaitFaire.tsx`, `Reste.tsx`, `Annexe.tsx` dans `components/presentation/` ; `lib/presentation-content.ts`
  réduit à `PIPELINE` si encore utilisé, sinon supprimé.
- **Tests** : e2e TP1, TP2, TP9 (§ 8.5).
- **Preuve de fin** : sur la branche d'intégration seulement, capture 1440 et 390 de la page avec ses
  trois titres et ses parties encore vides.

#### P**.3 — Partie 1 (M) — dépend de P**.2

- **Fichiers** : `Capteurs.tsx` (PS2) ; `Topologie.tsx` + `lib/presentation-topologie.ts` (PS3) ; table
  d'hébergement dans `Contient.tsx` (PS4) ; `EcransConsole.tsx` (PS5, import de `CATEGORIES`,
  `components/nav-items.tsx:20`) ; bloc PS6.
- **Tests** : e2e TP7 (topologie accessible), TP10 (connecté : écrans cliquables, carrousel présent).

#### P**.4 — Partie 2 (M) — dépend de P**.0, P**.2

- **Fichiers** : `lib/presentation-sait-faire.ts` (K1–K14, textes exacts du § 8.2) ; `SaitFaire.tsx` ;
  `CouvertureBarre.tsx` ; bloc « Méthode » (PS8) ; `Positionnement.tsx` (PS9).
- **Tests** : unitaire P**.0 n° 3 ; e2e TP3, TP4.

#### P**.5 — Partie 3 (S) — dépend de P**.0, P**.2

- **Fichiers** : `lib/presentation-reste.ts` (R1–R9) ; `Reste.tsx`.
- **Tests** : unitaire P**.0 n° 4 ; e2e TP4.

#### P**.6 — Annexe et Specs (M) — dépend de P**.0

- **Fichiers** : `Annexe.tsx` ; `Specs.tsx` (renommage du groupe backend, `<Suspense>`) ; `lib/specs.ts`.
- **Tests** : e2e TP11 (six `<details>`, 49 lignes au total) ; e2e TP6 (clavier sur les onglets de Specs).

#### P**.7 — Visuels (M) — V-A et V-B dépendent des lots F04, F09 et F21

- **Fichiers** : `scripts/captures-portail.mjs` ; `apps/console/public/portail/{overview,issue}-{light,dark}.png`,
  `mobile-light.png`, `manifest.json` ; suppression de `console-tour.mp4` et `console-tour-poster.jpg`.
- **Tests** : unitaire — chaque fichier de `public/portail/` est cité par un composant ou le manifeste,
  et pèse ≤ 250 Ko ; e2e TP8.

P**.7 n'est **pas** dans la branche d'intégration : ses captures dépendent de lots F non
livrés. Il part de `master` après la bascule, en PR séparée, rejoue TP8, et ne remplace que des
fichiers existants (la page ne change pas de forme). D'ici là, la légende de PS0 s'affiche **sans
date** (« Capture réelle de la console. Les chiffres affichés viennent d'un jeu de démonstration, pas
d'un client en production. ») : la date des captures actuelles n'est pas établie, et on ne l'invente
pas.

#### P**.8 — Recette de la page et relecture (S) — dépend de P**.2 à P**.6, jouée sur la branche d'intégration

- **Fichiers** : `tests/e2e/presentation.spec.ts` (nouveau) ; helper de débordement
  `tests/e2e/helpers/debordements.ts` (extrait par F09 ; si F09 n'est pas encore livré, P**.8 l'extrait de
  `tests/e2e/analyses-drilldowns.spec.ts:140-150`).
- **Relecture avant publication** (cochée dans la PR) :
  1. relever Railway (services, domaines) et comparer à PS3 et PS11 ; si `ingest` a été supprimé,
     réécrire la ligne et la légende de PS3 ; chercher dans les journaux de déploiement du `scheduler`
     la mention « migrations à jour » : trouvée → la ligne `scheduler` de PS11 passe à l'affirmatif et
     la boîte PS3 peut citer les migrations, avec date et identifiant du déploiement dans la PR ; non
     trouvée → le conditionnel reste ;
  2. relire chacune des 32 puces de limite (K1–K14) contre la colonne « Limite » de **son**
     identifiant : la réserve principale y est ; cocher les 32 puces une à une dans la PR ;
  2 bis. relire la bascule : la PR de fusion de `presentation/refonte` contient P**.3 à P**.6 et
     TP1–TP12 sont verts sur son dernier commit ;
  3. relire PS9 contre `plan/reads/iplabel.md` : aucune cellule « rapporté (prudence) » ;
  4. vérifier que les seuils Web Vitals cités sur la page, s'il y en a, viennent de
     `lib/rating.ts:5-11` (LCP 2 500 / 4 000 ms, INP 200 / 500 ms, CLS 0,1 / 0,25) — valeurs à
     recontrôler sur web.dev avant publication, comme le demande le lot F00.

#### P**.9 — `README.md` de la racine (S, recommandé, hors périmètre strict)

Le README est la porte d'entrée GitHub et contredit la vitrine : Supabase Paris au lieu de Neon
Francfort, architecture « Deno edge function », statut arrêté à v0.3 (`plan/reads/site-presentation.md:83-90`,
`:117-125`). Relevé dans le dépôt : `README.md:12` (« Souverain : données hébergées en UE (Supabase
eu-west-3, Paris) »), `:25` (« edge function Deno (prod Supabase) »), `:100-104` (section Statut
arrêtée à v0.3).

- **Fichiers** : `README.md` ; `scripts/readme-sections.mjs` (nouveau) ; `tests/unit/readme.test.ts`
  (nouveau).
- **Contenu** : la ligne 12 (section « Pourquoi celui-là ») est réécrite à la main sur le modèle de PS4
  (« Données hébergées en UE ; hébergeurs de droit américain ; ce POC n'est pas une offre
  souveraine. ») ; les sections « Architecture » et « Statut » deviennent des **zones générées**,
  bornées par `<!-- genere:readme-architecture -->` / `<!-- /genere -->` et
  `<!-- genere:readme-statut -->` / `<!-- /genere -->`. `scripts/readme-sections.mjs` les écrit
  depuis `lib/presentation-topologie.ts` (pièces, hébergeurs, régions, lus dans `lib/legal.ts`) et
  `lib/couverture.generated.json` (date, SHA, 49 / 34, lien vers le document). L'historique v0.1–v0.3
  sort du README vers `CHANGELOG.md` (déjà cité par `README.md:103`) : le README dit l'état relevé,
  pas l'histoire.
- **Tests** (`readme.test.ts`) :
  1. régénérer les deux zones en mémoire et comparer au `README.md` versionné ; un écart échoue avec
     « relancer `node scripts/readme-sections.mjs` » — même filet que P**.0 n° 1, donc un nouveau
     relevé du document de couverture rougit le README comme il rougit le site ;
  2. lexique, **hors blocs de code** et limité aux sections « Pourquoi celui-là », « Architecture » et
     « Statut » (repérées par leur titre `##`) : aucun de `/Supabase/`, `/\bDeno\b/`, `/edge function/i`,
     `/\bv0\.\d\b/`, `/\bsouverain\b/i`. La limitation aux trois sections est voulue : ailleurs, le
     README peut nommer une ancienne version dans un lien d'archive (`README.md:103-104`) ;
  3. les deux paires de marqueurs existent, une fois chacune.
- **Preuve de fin** : réintroduire « Supabase » dans la section Architecture fait échouer le test 2 ;
  modifier un verdict dans une copie du document de couverture fait échouer le test 1.
- **Non établi** : `README.md:95` renvoie à `DEPLOY.md` « (Supabase + Vercel) » ; `DEPLOY.md` n'a pas
  été lu pour cette épique. Son état est à relever avant P**.9 ; s'il est périmé, le signaler dans la
  PR plutôt que d'élargir le lot.

#### P**.10 — Nouveau relevé du document de couverture (S) — vague 7, sur `master`, avant P**.2

Le site reprend les verdicts de `docs/RUM_PARITY_STATUS.md` tels quels (P**.0). Le relevé du 18/09/2026
est dépassé sur plusieurs lignes au moment où la vague 0 se termine (22/09/2026) : la CI vérifie les
types (F2, #213 et F00), la base `PRE_V83` est fournie (F3, #213), le service `ingest` est supprimé et le
`scheduler` lance les migrations (`TOPOLOGIE_BACKEND.md`), les mentions légales et le DPA en ligne sont
retirés. Les vagues 1 à 6 en changeront d'autres.

- **Fichiers** : `docs/RUM_PARITY_STATUS.md` (nouvelle date, nouveau SHA, lignes relevées à nouveau),
  `apps/console/lib/couverture.generated.json` (régénéré par `node scripts/couverture-extraire.mjs`),
  les repères datés de `tests/unit/couverture-site.test.ts` (49, `18/09/2026`, décomptes de tests).
- **Méthode** : rejouer les commandes du § 2 du document dans un worktree propre de `master`, sur
  bases jetables ; revoir chaque ligne au verdict `livre_avec_defaut_connu`, `livre_non_deploye` et
  `bloque_acces_externe` ; ne changer un verdict que sur une preuve nommée dans la ligne. `DATABASE_URL`
  n'est ni lue, ni employée.
- **Tests** : `tests/unit/couverture-site.test.ts` vert sur le nouveau relevé (tests 1 et 2).
- **Preuve de fin** : le diff du document, verdict par verdict, collé dans la PR.

**Ordre** : P**.1 (tout de suite, seul, sur `master`) ; P**.0 sur `master` (aucun effet visible) ;
P**.10 sur `master` en vague 7 ; puis, sur la branche `presentation/refonte` : P**.2 → (P**.3, P**.4, P**.5, P**.6 en parallèle) →
P**.8 → **une** PR de bascule vers `master`. Après la bascule : P**.7 (quand F04, F09 et F21 sont
livrés). P**.9 après P**.0 (il en lit le JSON) et P**.3 (il lit `lib/presentation-topologie.ts`) ;
d'ici là, sa réécriture manuelle de la ligne 12 peut partir avec P**.1.

---

### 8.5 Recette Playwright — `tests/e2e/presentation.spec.ts`

Visiteur non connecté sauf TP10. Largeurs 390, 768, 1440 pour TP5 ; 1440 ailleurs sauf mention.

| Test | Ce qu'il vérifie |
|---|---|
| TP1 | Trois `<h2>` dans l'ordre : « Ce qu'il contient », « Ce qu'il sait faire », « Ce qui reste pour un vrai outil de RUM » |
| TP2 | `presentation-releve` contient la date et le SHA de `lib/couverture.ts`, le total et le nombre de déployées calculés, et « aucune éprouvée » |
| TP3 | autant de `[data-testid=capacite]` que d'entrées de `presentation-sait-faire.ts` ; chacune a `data-verdict="deploye_non_eprouve"` ; dans chaque carte, autant de `[data-testid=capacite-limite]` que d'identifiants de l'entrée, chacun avec un `data-id` distinct, commençant par sa pastille et suivi d'un texte non vide ; 32 puces au total, dont une `data-id="A4"` |
| TP4 | les pastilles `D12` et `D14` n'apparaissent pas dans `#sait-faire` et apparaissent dans `#reste` |
| TP5 | aucun débordement horizontal à 390, 768, 1440 (helper extrait) ; à 390, les cartes sont sur une colonne |
| TP6 | clavier : Tab depuis le haut atteint les ancres ; Entrée sur « Ce qui reste » place le focus sur son titre ; les onglets de Specs se parcourent aux flèches |
| TP7 | la topologie a `role="img"` et un `aria-label` non vide ; l'alternative `<details>` contient « Vercel », « fra1 », « Neon », « Railway » |
| TP8 | chaque `<img>` a un `alt` non vide ou `aria-hidden` ; la légende de la capture contient « jeu de démonstration » ; elle contient une date **si et seulement si** `public/portail/manifest.json` existe (après P**.7) ; thème sombre émulé → capture sombre visible |
| TP9 | sans `DEMO_USER_APPS`, `presentation-demo` a `aria-disabled="true"` (comportement de `Landing.tsx:74-84`) |
| TP10 | connecté (helper de connexion de `tests/e2e/navigation-filtres.spec.ts:56-62`) : bouton « Ouvrir la console », écrans cliquables, carrousel présent, snippet contenant `/api/ingest/v1/traces` |
| TP11 | l'annexe contient six `<details>` et 49 lignes de capacité au total |
| TP12 | `reducedMotion: "reduce"` émulé : aucune animation active sur `.mip-fleche` (`Capteurs.tsx:72-95`) |

---

### 8.6 Non établi

- ~~L'état de Railway après le 18/09/2026~~ — **établi** : `ingest` supprimé le 21/09/2026, relevé par
  l'API Railway le 22/09 (`mcp` et `scheduler` seuls) ; appliqué dans P**.1 (#218).
- Le sélecteur DOM du widget « Votre avis ? » à masquer pendant les captures.
- Les captures V-A et V-B finales : elles dépendent de lots F non encore livrés.
- La date réelle du dernier événement ingéré : reprise de `delivery-p8.md` par le document de
  couverture, qui ne l'a pas recontrôlée (`RUM_PARITY_STATUS.md:303-304`).
- ~~Les seuils Web Vitals~~ — **établi** : pages web.dev LCP, INP, CLS, FCP et TTFB relues le
  22/09/2026 par F00 (#217) ; conformes à `THRESHOLDS` et à `rating2026`.
- L'apparence réelle des écrans Ekara : aucune capture vue (`iplabel.md:5-12`) ; PS9 ne compare que
  des textes publiés.
- ~~Qui applique les migrations en production~~ — **établi** : le `scheduler` lance la commande de
  pré-déploiement (déploiement `03850b30` du 18/09/2026, « migrations à jour », aucune en attente) ;
  appliqué dans P**.1 (#218).
- L'activation des aperçus Vercel pour les branches de ce projet (utile à la relecture de la branche
  d'intégration, sans effet sur la page publique).
- L'état de `DEPLOY.md`, auquel renvoie `README.md:95` (non lu).
- Le comportement de l'extraction sur les cellules à code : aucune ligne fautive constatée, mais le
  script n'existe pas encore ; la fixture de P**.0 n° 0 fixe le comportement attendu.

---

## 9. Annexes

### 9.1 Régénérer les captures de travail

Les captures ne sont **jamais versionnées** : elles servent à comparer avant / après et à remplir les
PR. Deux scripts, à ajouter au dépôt par F00 (ils ne touchent à aucune donnée hors de la base locale).

**Prérequis** (mêmes que `scripts/record-console-tour.mjs:6-12`) : Postgres local migré
(`postgres://postgres:postgres@localhost:5433/mip_rum` par défaut), trafic de démonstration généré par
`node scripts/gen-traffic.mjs`, console servie en **build de production** sur `:3000`
(`pnpm --filter console build && pnpm --filter console start`), navigateurs Playwright installés.

#### `scripts/captures-console.mjs`

```js
// Captures de travail de la console locale (build de production sur :3000), pour comparer un écran
// avant / après un lot. Sortie : un répertoire temporaire NON versionné ($MIP_CAPTURES_DIR, sinon un
// mktemp). Aucun secret n'est écrit : le mot de passe du compte local est régénéré à l'exécution par
// scripts/seed-admin.mjs (qui l'affiche une seule fois sur sa sortie standard) et gardé en mémoire.
//
//   node scripts/captures-console.mjs                  # tous les écrans, 1440 × 900, clair
//   MIP_CAPTURES_DIR=/tmp/avant node scripts/captures-console.mjs
//
// Variables : MIP_BASE (défaut http://localhost:3000), MIP_APP (défaut demo-app), MIP_PERIOD (défaut 7d),
// DATABASE_URL (défaut base locale 5433), MIP_CAPTURES_DIR.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.MIP_BASE ?? "http://localhost:3000";
const APP = process.env.MIP_APP ?? "demo-app";
const PERIOD = process.env.MIP_PERIOD ?? "7d";
const DB = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum";
const OUT = process.env.MIP_CAPTURES_DIR ?? mkdtempSync(join(tmpdir(), "mip-captures-"));
const EMAIL = "julian@mip-rum.local"; // compte créé par scripts/seed-admin.mjs

// Garde-fou : seed-admin.mjs RÉÉCRIT le mot de passe du compte. On refuse toute base qui n'est pas locale.
const hote = new URL(DB).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(hote)) {
  console.error(`Base non locale (${hote}) : refus. Ce script ne doit tourner que sur une base de développement.`);
  process.exit(1);
}
const sortie = execFileSync(process.execPath, ["scripts/seed-admin.mjs"], {
  env: { ...process.env, DATABASE_URL: DB },
  encoding: "utf8",
});
const password = sortie.match(/mot de passe \(affiché une seule fois\) : (\S+)/)?.[1];
if (!password) throw new Error("mot de passe introuvable dans la sortie de scripts/seed-admin.mjs");

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', password);
await Promise.all([page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }), page.click('button[type="submit"]')]);
await ctx.addCookies([{ name: "mip-project", value: APP, url: BASE }]);

const q = (chemin) => `${BASE}${chemin}${chemin.includes("?") ? "&" : "?"}app=${APP}&period=${PERIOD}`;
// Identifiants de détail lus sur les listes (aucun identifiant de démo codé en dur).
async function premierLien(liste, motif) {
  await page.goto(q(liste), { waitUntil: "networkidle", timeout: 45_000 });
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
  const h = hrefs.map((x) => x.split("?")[0]).find((x) => motif.test(x));
  return h ?? null;
}
const erreur = await premierLien("/errors", /^\/errors\/(?!issues)[^/]+$/);
const session = await premierLien("/sessions", /^\/sessions\/[^/]+$/);
const trace = await premierLien("/tracing", /^\/tracing\/[^/]+$/);

const ecrans = [
  ["/", "01-overview"], ["/pages", "02-pages"], ["/errors", "03-errors"], [erreur, "04-error-detail"],
  ["/ux", "05-ux-frustration"], ["/actions", "06-actions"], ["/events", "07-events"], ["/explorer", "08-explorer"],
  ["/experience", "09-experience"], ["/mobile", "10-mobile"], ["/sessions", "11-sessions"], [session, "12-session-detail"],
  ["/acquisition", "13-acquisition"], ["/retention", "14-retention"], ["/paths", "15-paths"], ["/forms", "16-forms"],
  ["/tracing", "17-tracing"], [trace, "18-trace-detail"], ["/map", "19-map"], ["/correlation", "20-correlation"],
  ["/goals", "21-goals"], ["/slo", "22-slo"], ["/alerts", "23-alerts"], ["/forecast", "24-forecast"],
  ["/dashboards", "25-dashboards"], ["/presentation", "40-presentation"],
];

// Garde-fou vérité : aucune IP ni adresse électronique ne doit apparaître à l'écran (le compte connecté,
// affiché par la coquille, est la seule adresse tolérée). Un faux positif (numéro de version à quatre
// segments) arrête la capture de cet écran avec son motif dans index.json : à regarder, pas à contourner.
const EMAIL_AFFICHE = /julian@mip-rum\.local/g;
async function verifierAffichage(nom) {
  const texte = await page.evaluate(() => document.body.innerText);
  if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(texte) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(texte.replace(EMAIL_AFFICHE, ""))) {
    throw new Error(`${nom} : une adresse IP ou électronique est affichée`);
  }
}

const index = [];
async function capturer(chemin, nom) {
  if (!chemin) { index.push({ nom, erreur: "aucun lien de détail trouvé sur la liste" }); return; }
  try {
    await page.goto(q(chemin), { waitUntil: "networkidle", timeout: 45_000 });
    await page.addStyleTag({ content: "#mip-rum-feedback, [data-mip-feedback] { display: none !important; }" }); // sélecteur à confirmer (§ 8.6)
    await page.waitForTimeout(500);
    await verifierAffichage(nom);
    const h1 = ((await page.locator("h1").first().textContent().catch(() => "")) ?? "").trim();
    await page.screenshot({ path: join(OUT, `${nom}.png`), fullPage: true });
    index.push({ nom, chemin, h1 });
  } catch (e) {
    index.push({ nom, chemin, erreur: String(e.message).slice(0, 160) });
  }
}
for (const [chemin, nom] of ecrans) await capturer(chemin, nom);
await page.emulateMedia({ colorScheme: "dark" });
for (const [chemin, nom] of [["/", "50-overview-dark"], ["/pages", "51-pages-dark"]]) await capturer(chemin, nom);
await page.emulateMedia({ colorScheme: "light" });
await page.setViewportSize({ width: 390, height: 844 });
for (const [chemin, nom] of [["/", "60-overview-390"], ["/errors", "61-errors-390"]]) await capturer(chemin, nom);

writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
await browser.close();
console.log(`${index.filter((i) => !i.erreur).length}/${index.length} captures dans ${OUT}`);
```

Différences avec le script de travail d'origine : aucun chemin absolu ni fichier de mot de passe ; le
mot de passe vient de `scripts/seed-admin.mjs` à l'exécution et ne quitte pas la mémoire ; refus d'une
base non locale (le script de seed réécrit le mot de passe) ; identifiants de session, d'erreur et de
trace lus sur les listes ; garde-fou IP / e-mail avant chaque capture ; sortie dans un répertoire
temporaire.

#### `scripts/references-datadog.sh`

```sh
#!/bin/sh
# Convertit les références Datadog (images .jxl / .webp, vidéos .mp4) en PNG de travail, non versionnés.
# Usage : scripts/references-datadog.sh "<dossier source>" [<sortie>]
# Dépendances : djxl (libjxl), dwebp (libwebp), ffmpeg. Aucune donnée n'est envoyée nulle part.
set -eu
SRC="$1"
OUT="${2:-${MIP_CAPTURES_DIR:-$(mktemp -d)}/datadog}"
mkdir -p "$OUT/img" "$OUT/frames"
for f in "$SRC"/*.jxl; do [ -e "$f" ] || continue; b=$(basename "$f" .jxl); djxl "$f" "$OUT/img/${b%.*}.png"; done
for f in "$SRC"/*.webp; do [ -e "$f" ] || continue; b=$(basename "$f" .webp); dwebp "$f" -o "$OUT/img/${b%.*}.png"; done
for v in "$SRC"/*.mp4; do
  n=$(basename "$v" .mp4); mkdir -p "$OUT/frames/$n"
  ffmpeg -loglevel error -i "$v" -vf fps=1 "$OUT/frames/$n/f%03d.png"   # 1 image par seconde : f001 ≈ t 0 s
done
echo "références dans $OUT"
```

Source des références : les images et vidéos de la page
https://www.datadoghq.com/dg/real-user-monitoring/overview/ (copie locale d'origine :
`~/Downloads/datadog screenshots and videos /`). Les noms produits sont ceux de la table du § 0.6.

### 9.2 Glossaire des mesures

| Terme | Définition exacte dans ce plan | Source dans le code |
|---|---|---|
| Session commencée | session dont `started_at ∈ [from, to)` ; population canonique de toute tuile « Sessions » (R-P) | `engagementStats(f).sessions_started`, `lib/queries-sessions.ts:L20-33` |
| Session active | session dont la dernière activité `last_seen_at ∈ [from, to)` ; n'apparaît que dans une figure dont le titre porte « actives » | `overviewStats`, `lib/queries.ts:L127` ; `visitStats` |
| Session avec vue | session ayant au moins une page vue dont `started_at ∈ [from, to)` ; seul dénominateur des parts de sessions | `sessionsAvecVue(f)` (F10) |
| Visiteur | `visitor_id` à identifiant aléatoire, compté `distinct` ; jamais additionné aux sessions ; surestimé sur mobile (identifiant en mémoire) | `lib/analytics-schema.ts:L197-206` |
| Occurrences | `sum(occurrences)` des erreurs reçues (une ligne peut porter plusieurs répétitions) | `lib/queries.ts:L133-135` |
| Sessions touchées | sessions portant au moins une occurrence dans la fenêtre ; `null` (« Inconnu ») si aucune occurrence n'est rattachée à une session | `ErrorTotals`, `lib/queries-errors.ts:L156-163` |
| Part des sessions touchées | sessions **de la base** (sessions avec vue) ayant au moins une occurrence, divisées par la base ; `null` si la base est vide ou si `tauxMin < 1` | `partSessionsTouchees` (F10), `partTouchees` |
| Occurrences d'erreurs pour 100 pages vues | `100 × Σ occurrences navigateur (error_source like 'browser_%') / pages vues` ; peut dépasser 100 ; format `pour100` | `erreursNavigateur` (F10) |
| p75 | 75ᵉ percentile continu (`percentile_cont(0.75)`) des mesures brutes de la fenêtre ; jamais une moyenne de p75 | `vitalsP75`, `lib/queries.ts:L46-66` |
| Verdict Bon / À améliorer / Mauvais | `rating2026` : « Bon » si `≤` borne basse, « Mauvais » si `>` borne haute ; seuils de `THRESHOLDS` ; réservé au p75 d'un vital (R-V) | `lib/rating.ts:L5-11, L36-46` |
| Échantillon faible | effectif sous `faibleSous` (100 mesures pour un vital, 30 pour un segment, 10 avis) ; rangé en fin de classement, jamais masqué | `KpiTile`, `lib/impact.ts` |
| Probabilité d'inclusion | `sample_rate` pour une session sans erreur, `sample_rate + (1 − sample_rate) × error_sample_rate` avec erreur ; `null` avant le 09/09/2026 | `migration-v58.sql:L41-57, L65` |
| Durée observée | `last_seen_at − started_at` : écart entre la première et la dernière observation, pas du temps actif | `lib/engagement.ts:L5-13` |
| Session à une vue | `single_view / with_view` (sessions avec au moins une vue) ; pas un « taux de rebond » | `lib/engagement.ts` |
| Angle mort | heure × (app, route) où le robot est `ok` et le LCP p75 réel de la même heure dépasse la borne Bon, sur des heures d'au moins 30 mesures LCP | `correlationConcordance` (F57), `blindSpots` |
| Budget d'erreur consommé | `(1 − atteinte) / (1 − objectif) × 100`, borné [0, 999], `null` si non mesurable ; « épuisé » à partir de 100 % | `slo_status()`, `migration-v64.sql:247-295` |
| Brûle vite | consommation sur la dernière heure ≥ 14,4 × le budget (origine du facteur non établie) | `migration-v64.sql:L259, L277-292` |
| Conversion (objectif) | sessions ayant satisfait la condition / sessions ayant vu au moins une page, par app de l'objectif ; intervalle de Wilson à 95 % | `goalConversions` (F66), `intervalleWilson` |
| Abandon de formulaire | émis quand la page passe en arrière-plan avec un formulaire entamé et non soumis (changer d'onglet compte) | `packages/rum-sdk/src/forms.ts:L130-218` |
| Signaux de frustration | rage = 3 clics sur la même cible en 1 s ; dead = élément d'aspect actionnable sans mutation, navigation ni défilement en 1,5 s ; error = première exception rattachée à l'action dans les 5 s | `packages/rum-sdk/src/frustration.ts:L13-15`, `docs/FRUSTRATION.md:L11-12` |
| Part serveur (tracing) | médiane, appel par appel, de `durée serveur / durée navigateur` sur les appels suivis ; une proportion, jamais convertie en ms | `apiCallsDecomposition` (F59) |
| Rétention S+k | moyenne pondérée par la taille des cohortes dont la cellule S+k est **complète** (`Σ retenus / Σ taille`) ; semaine en cours exclue | `courbeRetention` (F49) |
| Tendance | droite des moindres carrés sur les jours d'au moins 30 mesures ; échéance écrite seulement si la pente dépasse deux écarts types des résidus ; « ce n'est pas une prévision » | `lib/forecast.ts` (F65, P*.4) |

### 9.3 Sources consultées

**IP-Label (Ekara)** — pages publiques, aucun écran vu :
- https://ip-label.com/fr/rum/ (page de référence demandée)
- https://ip-label.com/real-user-monitoring/
- https://ip-label.com/fr/unified-monitoring-rumstm/ · https://ip-label.com/unified-monitoring/
- https://ip-label.com/fr/ekara-mobile/
- https://ip-label.com/fr/monitoring-synthetique-des-transactions/
- https://ip-label.com/synthetic-monitoring-vs-real-user-monitoring/
- https://ip-label.com/best-real-user-monitoring-rum-tools/
- https://ip-label.com/fr/documentation/ · https://ekara.ip-label.com/dashboards-and-reports-for-information-and-communication/
- https://www.itrsgroup.com/blog/itrs-acquires-ip-label ·
  https://www.lemagit.fr/actualites/366617872/Ip-label-ce-Francais-qui-se-veut-a-la-pointe-du-monitoring-de-lexperience-utilisateur

**Datadog** — page produit, captures et vidéos de démonstration (§ 0.6), documentation :
- https://www.datadoghq.com/dg/real-user-monitoring/overview/
- RUM : https://docs.datadoghq.com/real_user_monitoring/ · …/explorer/ · …/explorer/visualize/ ·
  …/explorer/watchdog_insights/ · …/platform/dashboards/performance/ · …/platform/dashboards/errors/ ·
  …/platform/dashboards/usage/ · …/browser/monitoring_page_performance/ · …/browser/frustration_signals/ ·
  …/guide/setup-rum-deployment-tracking/ · …/guide/sampling-browser-plans/ ·
  …/mobile_and_tv_monitoring/android/mobile_vitals/ (préfixe https://docs.datadoghq.com/real_user_monitoring/)
- Error Tracking : https://docs.datadoghq.com/error_tracking/explorer/ · …/error_grouping/ ·
  …/regression_detection/ · …/suspected_causes/ · …/frontend/replay_errors/
- Session Replay et heatmaps : https://docs.datadoghq.com/real_user_monitoring/session_replay/ ·
  https://docs.datadoghq.com/session_replay/heatmaps/ · https://docs.datadoghq.com/session_replay/privacy_options/
- Product Analytics : https://docs.datadoghq.com/product_analytics/charts/funnel_analysis/ ·
  …/charts/pathways/ · …/charts/retention_analysis/ (préfixe https://docs.datadoghq.com/product_analytics/)
- Monitors : https://docs.datadoghq.com/monitors/types/anomaly/ · …/forecasts/ · …/real_user_monitoring/
  (préfixe https://docs.datadoghq.com/monitors/types/)
- Synthetics ↔ RUM : https://docs.datadoghq.com/synthetics/guide/explore-rum-through-synthetics/
- https://www.datadoghq.com/blog/ai-summaries-and-smart-chapters/ (contre-point de P*.9)

**Grafana** — documentation (aucune capture) :
- https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/
- Panneaux : https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/ (stat, time-series,
  bar-chart, bar-gauge, gauge, heatmap, histogram, table, state-timeline, status-history, pie-chart, geomap)
- Frontend Observability :
  https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/
  (performance, errors, sessions, user-actions, http-insights, geolocation)
- Machine learning : https://grafana.com/docs/grafana-cloud/ai-tools/machine-learning/

**Autres** (épique P*) : https://web.dev/articles/vitals · https://web.dev/articles/inp ·
https://blog.sentry.io/enhancing-issue-grouping/ ·
https://help.fullstory.com/hc/en-us/articles/360020624154-Rage-Clicks-Error-Clicks-Dead-Clicks-and-Thrashed-Cursor-Frustration-Signals

**Dépôt** (commit `322c9a7`) : `apps/console/**`, `packages/rum-sdk/src/**`, `packages/rum-mobile/src/**`,
`apps/extension/**`, `apps/ingest/sql/**`, `docs/RUM_PARITY_STATUS.md`, `docs/TOPOLOGIE_BACKEND.md`,
`docs/FRUSTRATION.md`, `docs/API_CONSOLE.md`, `tests/**`, `scripts/**`.

### 9.4 Non établi (consolidé)

Chaque point est un fait que ce plan ne suppose pas ; le lot cité le vérifie en s'ouvrant.

| Fait | Conséquence si faux | Vérifié par |
|---|---|---|
| Rendu réel des écrans sur un vrai parc (tout a été vu sur un mini-site local, 28 sessions) | un graphique juste peut être illisible à grand volume | recette R1 (§ 8.2) sur une application de recette |
| Fuite de périmètre sous `app=all` sur `/acquisition`, `/retention`, `/paths`, `/forms`, `/goals` : lue dans le code, pas rejouée | le refus provisoire serait inutile (sans danger) | F40 (e2e), F66 |
| Conversion `Filters` ↔ `AnalyticsQuery` pour intersecter une route ou une release | écrire `avecCondition(f, dim, valeur)` dans `lib/perf-domain.ts` | F10 |
| Coût d'un second `listErrorGroups` décalé pour `cmp=prev` | choisir l'option `shift` | F18 |
| Émission **observée en production** de `frustration.*` par l'extension (établie par le code seulement) ; moment d'injection de l'extension | des signaux antérieurs à l'injection peuvent manquer | recette R1 |
| Émission de `form.*` par le SDK React Native | garde R-F à appliquer à `/forms` | F51 |
| Mise en cache des requêtes dans `lib/queries.ts` (relecture de `vitalsP75` par `RoutePanel`) | un second appel, accepté | F17 |
| Hauteurs de zones en pixels (estimations sur captures) | ajuster la grille | captures de fin de lot |
| Où la date d'application d'une migration est conservée en base | la règle « début de collecte » de `couverturePrecedente` s'appuie sur `min(ts)` des données, pas sur cette date | F06 |
| Que `explorerHrefFromAst(widgetQueryJson(w))` accepte le JSON d'une carte v2 | écrire le test d'aller-retour avant d'utiliser le lien | F36 |
| Identifiants exacts de mesure des modèles d'Explorer et de tableaux (`started`, `visitors`, `occurrences`, `rows`, `value`) | carte retirée du modèle, pas contournée | F31, F35 |
| Jeu de démonstration React Native, formulaires, spans corrélés, plus d'une cohorte | écrans vérifiables par leurs tests unitaires seulement | F38, F49, F51, F52 |
| Identité `mobile_capabilities.release` = `rum_session.release` pour une même version | « — » au lieu d'un pourcentage (erreur dans le sens prudent) | F38 |
| Mécanisme de fixture « schéma sans release » dans `tests/e2e/mobile-console.spec.ts` | tester l'ordre de repli autrement | F38 |
| Saut d'inactivité et changement de vitesse dans `@rrweb/replay` 2.0.1 | ne pas afficher ces contrôles | F47 |
| Heure exacte du déploiement de v58 le 09/09/2026 | sessions du 09/09 supposées porter leur taux réel | B38 |
| Combinaison de deux `where` par `or` dans `sqlContext` | repli à deux requêtes | B38 |
| Origine du facteur 14,4 de `fast_burn` | texte « origine non documentée » | F63 |
| Cause du plantage de `24-forecast.png` : fonction passée à un composant client (établi : la fonction est passée ; probable : c'est la cause) | chercher une autre cause | F55 |
| Correspondance `syn_snapshot.route_hint` ↔ routes RUM (`/partners/:id`) | avertissement « vérifier la correspondance » (CR12) | F58 |
| Intervalle réel de passage du robot en production (données de démo figées au 10/06) | le bandeau de fraîcheur se déclenche sur la démo | F58 |
| Que `seg` accepte `device:is_null` | « Inconnu » non cliquable sur `/goals` | F66 |
| Rendu réel à 390 px de `/ux`, `/actions`, `/tracing`, `/map`, `/goals`, `/slo`, `/alerts` | ajuster | F27, F54, F69 |
| Format de `geo_country` selon la provenance | aucune carte géographique | — |
| Pages web.dev LCP / CLS / FCP / TTFB non relues | ne pas écrire « seuils web.dev » avant relecture | F00 |
| Apparence réelle des écrans Ekara | seules leurs descriptions publiques sont reprises | — |
| État de Railway après le 18/09/2026 (service `ingest` supprimé ou non ; qui applique les migrations) | textes de la vitrine au conditionnel | P**.8 |
| Sélecteur DOM du widget « Votre avis ? » à masquer pendant les captures | adapter la feuille injectée par `scripts/captures-console.mjs` | F09 |

---

## Journal de rédaction

Corrections portées après relecture (lecture du code à `322c9a7`, sans modification du dépôt) :

1. **F00 (10) et § 4.5 — impact du dernier déploiement.** Signature exacte de `DeployImpact`
   ajoutée au registre (§ 4.5, « lib/queries-deploys.ts — F00 ») : `pageviews_*`, `sessions_*`,
   `errors_*` à `null` sans page vue. Écart avec la proposition de relecture : la colonne de temps de
   `rum_pageview` est `started_at` (`apps/ingest/sql/schema.sql:241`), pas `ts` ; la règle `null`
   est appliquée en TypeScript et non par `case` SQL, pour que `tests/unit/deploys.test.ts` (qui ne
   teste aujourd'hui que `assessRegression`, fonction pure) la vérifie avec `q` simulé. VM4 renvoie à F00.
   L'ancien test « `assessRegression` avec 0 page vue → `null` » était incohérent (la fonction ne
   reçoit pas de pages vues) : remplacé.
2. **F00 (9) — `rangeNote` de `/goals` retiré, pas écrit.** Relecture faite : un `rangeNote` n'est lu
   que sur une surface `range: "none"` (`lib/page-filters.ts:62`, `lib/surfaces.ts:186`). Sur
   `/goals` (`presets`), la plage personnalisée est désactivée dans `GlobalFilters` avec sa raison et
   refusée par `checkSurface` si elle arrive par l'URL : V10 est déjà tenu. Le texte proposé
   (« …n'est pas prise en compte… ») aurait été du code mort, et faux. § 5.14.0 et F66 alignés.
   Même constat pour `/forecast` (`presets`, `surfaces.ts:126`) : son `rangeNote` n'aurait jamais
   été affiché ; F00 le passe à `range: "none"`, sous condition vérifiée dans la PR ; § 5.20.2 distingue
   le `rangeNote` statique du bandeau daté rendu par la page.
3. **F00 (4) — « Non collecté » sur `/actions`.** Mécanisme écrit : export de `actionsDisponible`
   (`lib/queries-actions.ts:52-58`), appel unique dans `app/actions/page.tsx` avant les lectures,
   texte exact rendu dans un `card` en F00 puis par `EtatSurface kind="non_collecte"` en F02
   (F02 dépend de F00 : F00 ne peut pas employer `EtatSurface`, écart avec la proposition). Test
   unitaire par `q` simulé ; un test « sur une base sans `rum_action` » relèverait de
   `tests/integration`, non exigé ici.

