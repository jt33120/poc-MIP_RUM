# IP-Label / Ekara — RUM et supervision unifiée : documentation et comparaison à notre console
> **État au 26/09/2026.** Notes rédigées du 18 au 21/09/2026, avant la refonte de la console : le § 3 décrit la console d'avant les vagues 0 à 8, ses `fichier:ligne` ont bougé, et les notes voisines qu'il cite (`console-ecrans-1.md`…) sont hors du dépôt (encadré de [plan-frontend-dashboard.md](plan-frontend-dashboard.md)). La vitrine cite ce fichier par numéro de ligne (`apps/console/components/presentation/Positionnement.tsx`) : n'y ajouter ni n'y retirer aucune ligne.
## 0. Méthode, sources, et limites de fiabilité (à lire avant tout le reste)

**Ce que j'ai utilisé.** Aucun accès direct à une capture d'écran du dashboard Ekara : le dossier fourni
`datadog screenshots and videos ` (un dossier local, hors dépôt ; avec l'espace final dans le nom, vérifié
par `ls`) ne contient QUE du contenu Datadog (9 fichiers : captures RUM/Error Tracking/Explorer + 2 vidéos),
déjà exploité dans `console-ecrans-1.md`. Aucune capture IP-Label/Ekara n'a été trouvée dans mes recherches
web (WebSearch ne renvoie pas d'URL d'image exploitable, WebFetch ne peut pas lire une image). **Tout ce qui
suit sur l'apparence visuelle du dashboard Ekara est donc déduit de texte (pages produit, articles tiers),
jamais observé sur une image** — à la différence de `console-ecrans-1.md` qui, lui, a pu lire les captures
Datadog au pixel près.

**Fiabilité des citations « exactes ».** Les pages IP-Label ont été lues via l'outil `WebFetch`, qui ne
renvoie pas le HTML brut : il convertit la page en markdown puis la fait résumer par un petit modèle avant
de me la rendre. Ce résumé peut paraphraser, et j'ai constaté un signal net d'invention sur un point précis :
un résumé m'a rendu un endpoint « `https://ingest.eu.ekara.example` » et un bloc CSP complet — or `.example`
est le domaine réservé (RFC 2606) qu'on utilise pour des exemples fictifs, jamais un vrai lien produit. Ce
n'est donc **pas** une citation de la page mais une illustration générée par l'outil de synthèse, présentée
à tort comme un extrait exact. Par prudence, je traite **toute valeur numérique précise** (seuils d'alerte en
%, ms, durées de budget d'erreur, chiffres de cas clients) rapportée par ces résumés comme **« rapporté par
l'outil de synthèse — non vérifié mot pour mot »**, pas comme une citation directe garantie, même quand le
résumé dit « texto ». Les éléments structurels (quelles dimensions existent, quel vocabulaire, quelle
architecture de page) sont plus fiables qu'un chiffre isolé et sont notés « documenté ».

**Étiquettes utilisées ci-dessous** : **documenté** (lu sur une page IP-Label ou un article tiers, contenu
plausible et cohérent entre plusieurs sources) · **rapporté (prudence)** (vient d'un résumé d'outil, non
recoupé, à vérifier avant de s'en servir comme fait marketing) · **déduit** (inférence raisonnable, pas
affirmée par la source) · **non établi** (je ne sais pas).

**Sources consultées** (WebFetch sauf mention contraire) :
- https://ip-label.com/fr/rum/ (redirige probablement vers le contenu anglais `/real-user-monitoring/`)
- https://ip-label.com/real-user-monitoring/ (anglais, plus détaillé)
- https://ip-label.com/fr/unified-monitoring-rumstm/ et https://ip-label.com/unified-monitoring/
- https://ip-label.com/fr/monitoring-synthetique-des-transactions/
- https://ip-label.com/fr/ekara-mobile/
- https://ip-label.com/fr/documentation/
- https://ip-label.com/best-real-user-monitoring-rum-tools/ (comparatif écrit par IP-Label lui-même)
- https://ip-label.com/synthetic-monitoring-vs-real-user-monitoring/ (titre lu via WebSearch, non fetché en détail)
- https://ekara.ip-label.com/dashboards-and-reports-for-information-and-communication/ — **échec technique** :
  certificat TLS invalide (le sous-domaine pointe vers l'infrastructure WordPress.com générique, pas vers un
  certificat IP-Label) ; page non lue, contenu non établi.
- WebSearch : « Ekara RUM dashboard tableau de bord ip-label », « Ekara Browser Agent Microsoft 365
  Salesforce ip-label », « ip-label Ekara Unified Monitoring RUM capture d'écran », « ip-label RUM segments
  critiques top impact release comparaison », « site:ip-label.com blog Web Vitals RUM », « ip-label Ekara
  étude de cas client RUM performance résultats »
- Article tiers indépendant : LeMagIT, « ip-label, ce Français qui se veut à la pointe du monitoring de
  l'expérience utilisateur » — https://www.lemagit.fr/actualites/366617872/Ip-label-ce-Francais-qui-se-veut-a-la-pointe-du-monitoring-de-lexperience-utilisateur

---

## 1. Structure du dashboard RUM Ekara

### 1.1 Vues et widgets nommés (page `real-user-monitoring/`, **documenté** pour la liste, **rapporté (prudence)** pour les libellés exacts)

- **Dashboard Core Web Vitals** : fenêtre réglable (« 28 days » cité par le résumé), p75 par device/browser/country/network.
- **Vue LCP** segmentée pays/opérateur, **vue INP** segmentée version de navigateur/groupe de pages, **vue
  CLS** segmentée page/device — trois vues séparées par vital plutôt qu'un seul panneau à trois courbes.
- **Error & Release Monitoring** : « Error groups », « Stack trace », « Impact & correlation » — un
  regroupement d'erreurs avec, à côté, une mesure d'impact et une corrélation (avec quoi exactement :
  **non établi** — le résumé ne précise pas si c'est erreur↔vital, erreur↔session ou erreur↔release).
- **Segmentation & analyses** avec une vue nommée en exemple : **« EU • Mobile • Checkout »** — un intitulé
  de segment composé de trois facettes séparées par `•`, présenté comme une vue qu'on peut nommer et retrouver.
- Libellés de métriques cités par le résumé : « LCP p75 », « INP p75 », « CLS p75 », « JS error rate »,
  « TTFB p75 », « Top offenders by segment », « Matching rows ». **Top offenders by segment** est le nom le
  plus proche de ce que la tâche appelle « segments critiques (top impact) » — **rapporté (prudence)**, mais
  cohérent avec la citation trouvée indépendamment côté monitoring synthétique (§ 1.3).

### 1.2 Dimensions et segments (**documenté**, recoupé sur trois pages + WebSearch)

Dimensions citées de façon cohérente sur plusieurs sources (page RUM anglaise, page comparatif, résultats
WebSearch) :
- **Terminal** (device) : mobile / desktop
- **Navigateur** (browser) : Chrome, Safari, Edge, Firefox — avec version pour INP
- **Pays** (country) : France, Allemagne, Espagne, Royaume-Uni cités en exemple
- **FAI / opérateur** (ISP/carrier) : Orange, SFR, Bouygues, Deutsche Telekom, O2, Vodafone cités en exemple
- **Réseau** (network) : 3G/4G/5G/Wi-Fi
- **Groupe de pages** (page group) : Home, PDP (fiche produit), Checkout (tunnel), Account (compte)
- **Release** : version déployée

C'est un jeu de dimensions **superposable presque terme à terme** à nos propres dimensions de découpage
(Route / Navigateur / Système / Pays estimé / Appareil / Release — `console-ecrans-1.md` L43), à deux
différences près : **FAI/opérateur** et **type de réseau (3G/4G/5G/Wi-Fi)** n'existent pas chez nous
(confirmé absent : `dashboard-blocs.ts` liste un bloc « opérateur réseau » **désactivé par défaut avec
raison affichée**, `console-ecrans-1.md` L71 — donc la dimension est *prévue* mais pas *branchée*).

### 1.3 Segments critiques / « top impact » (**documenté** le concept, **rapporté (prudence)** la formulation)

Deux formulations indépendantes convergent sur la même idée :
- Page RUM (WebFetch) : « ciblez les pires combinaisons (ex : Safari sur iOS en 4G FR) » et « Top offenders
  by segment ».
- Résultat WebSearch indépendant, page comparatif RUM : « RUM can segment by geo/ISP/device and track Core
  Web Vitals at p75. This provides actionable prioritization by focusing on the worst combinations (e.g.,
  Safari on iOS over 4G in FR) instead of guesswork. »

Le principe documenté : **classer les segments par gravité de l'expérience (p75 dégradé), pas par volume de
trafic**, pour designer d'emblée la pire combinaison plutôt que la plus fréquente. C'est l'inverse exact de
notre découpage actuel (§ 3).

### 1.4 Comparaison release actuelle vs précédente (**documenté**, concept ; **rapporté (prudence)**, mécanique exacte)

- « track pre/post release impact » et « Alert when LCP p75 degrades by > 10% on any key page group »
  (WebFetch — seuil numérique à traiter en prudence, cf. § 0).
- Recoupé indépendamment par WebSearch : « You can define threshold alerts on LCP/INP/CLS (p75) by page
  group/segment, track pre/post release impact, and set SLOs with dashboards & notifications. RUM allows you
  to quantify the before/after impact of each deployment on p75 LCP/INP/CLS. »

Le principe (documenté, recoupé deux fois indépendamment) : une comparaison **avant/après déploiement**,
par **groupe de pages**, sur **LCP/INP/CLS p75**, avec alerte si dégradation au-delà d'un seuil relatif
(pourcentage, pas valeur absolue). C'est la même logique que notre `VersionsTable` (comparaison par version,
`app/page.tsx` L287, `lib/queries-deploys.ts` L138 : « Comparaison des versions déployées : volume, LCP, INP
et erreurs par release »), à un détail près : le seuil IP-Label est **relatif** (« dégrade de > 10 % »)
alors que le nôtre affiche un **écart en points** sans seuil d'alerte associé (`console-ecrans-1.md` L62,
« écart en points vs version de référence » — pas de déclenchement d'alerte documenté sur ce module).

### 1.5 Corrélation erreurs ↔ Web Vitals (comment c'est MONTRÉ)

**Non établi précisément.** La seule trace est le libellé « Impact & correlation » à côté de « Error groups »
et « Stack trace » (§ 1.1), sans description du widget lui-même (courbe superposée ? tableau ? simple
mention textuelle ?). Je ne peux pas dire si Ekara affiche un graphique qui superpose visuellement occurrences
d'erreurs et dégradation de LCP/INP sur une même fenêtre de temps, ou si « correlation » désigne autre chose
(par exemple la release commune aux deux). **Point à vérifier avant de s'en inspirer** : je ne peux pas
reprendre une conception que je n'ai pas vue.

### 1.6 Corrélation synthétique ↔ RUM (comment c'est MONTRÉ)

C'est la zone la mieux documentée, car recoupée sur trois pages indépendantes :
- Page RUM : « Utilisez les deux : planifiez des checks synthétiques pour détecter les problèmes tôt, puis
  validez l'impact réel par segment » (**rapporté (prudence)**, traduction FR d'un résumé).
- Page monitoring synthétique (WebFetch, anglais) : « *utilisez le monitoring synthétique pour détecter &
  reproduire, et le RUM pour quantifier l'impact et vérifier le correctif* » — RUM = « tells you what is
  happening », STM = « tells you what could happen » (**rapporté (prudence)** pour la formulation exacte,
  mais le sens est recoupé trois fois).
- Page « Unified Monitoring » (WebFetch direct) : **« ne montre pas de captures d'écran détaillées avec
  widgets ou graphiques spécifiques »** — la corrélation y est décrite comme un **critère d'évaluation**
  (« Can you correlate synthetic failures with RUM impact (affected users, regions, devices)? »), pas comme
  une démonstration visuelle d'un widget concret. Vocabulaire confirmé sur cette page : **« Journey-level
  SLOs »**, **« journey-level alerting »**, **matrice comparative RUM vs STM vs APM** organisée en tableau
  (colonnes : Detection style, Traffic dependency, Depth, Best for, KPIs, Weak spots, Pricing driver).
- WebSearch indépendant (recherche « Unified Monitoring RUM capture d'écran ») confirme sans image
  spécifique : « RUM and synthetic monitoring are summarized in a **single display**, with all displays
  **color coded**, offering a **'weather report' of availability and performance at a glance** » — et « Users
  can dive deep into performance measurements of each step of user journeys on applications, with adjustable
  timeframes (day, week, month) and the ability to **click to zoom in** on specific events ».

**Conclusion honnête** : IP-Label documente le PRINCIPE (un affichage unique, codé par couleur, métaphore
météo, zoom cliquable sur un pas de temps) mais je n'ai trouvé **aucune description fine du widget lui-même**
(un graphique à deux courbes superposées ? une grille de tuiles colorées par étape de parcours ? un tableau ?)
— **non établi**. Ce que je peux affirmer avec confiance : le principe de corrélation synthétique↔RUM
existe et est mis en avant comme différenciateur (« hybrid platform where the editor correlates the results
of robot executions with RUM metrics », confirmé indépendamment par l'article LeMagIT : « plateforme
"hybride" corrélant les résultats d'exécution des robots avec les métriques RUM »). C'est exactement ce que
fait notre écran `/correlation` (§ 3.1), avec un widget concret que je PEUX décrire précisément puisque j'ai
lu son code.

### 1.7 Alerting et SLO (**rapporté (prudence)** pour les chiffres, **documenté** pour la structure)

Structure recoupée sur plusieurs pages : alertes à seuil sur LCP/INP/CLS p75 par segment/groupe de pages,
comparaison pré/post-release, SLO avec tableaux de bord et notifications. Côté monitoring synthétique, un
vocabulaire de SRE plus classique apparaît : **budget d'erreur** (« consommation du budget » suivie à
50/75/100 %), règles anti-bruit type « n échecs consécutifs avant alerte ». Ces éléments sont **cohérents
avec des pratiques SRE standard** (budget d'erreur = 1 − disponibilité cible, alerte après plusieurs échecs
consécutifs pour éviter le bruit) mais je ne peux pas garantir que les chiffres précis rapportés (10 %, 20 %,
99,90 %, 3 échecs) sont ceux réellement affichés sur le site plutôt que des illustrations du résumé — voir
§ 0. Ce qui est solide : **le principe du seuil relatif** (« dégrade de X % vs baseline ») plutôt qu'absolu,
et **l'alerte au niveau du parcours** (« journey-level »), pas seulement au niveau d'une métrique isolée.

### 1.8 Agent navigateur pour Microsoft 365 / Salesforce

**Documenté et recoupé trois fois indépendamment** (page RUM, WebSearch dédiée, WebSearch générale) :
- Page RUM : « Surveillez vos applications web et SaaS à partir des mêmes appareils » ; « **Ekara Browser
  Agent** » ciblant Microsoft 365 et Salesforce ; « mesure la **performance et l'adoption de l'application**,
  pas le contenu employé » (**rapporté (prudence)** pour la formulation exacte de cette dernière phrase) ;
  déploiement via **GPO/Intune**, scope par BU/rôle.
- WebSearch indépendante : « Ekara is designed to monitor web tools like Microsoft 365 and Salesforce using
  a browser extension for Chrome/Edge. Deployed to employees' workstations… The solution is particularly
  useful for organizations that need to monitor applications they don't have direct code access to, making
  it ideal for SaaS applications like Microsoft 365 and Salesforce. »
- Article LeMagIT (indépendant, non-marketing) confirme l'existence d'une **extension Chrome/Edge nommée
  « Ekara RUM Browser »** pour un usage interne entreprise, et ajoute un axe non retrouvé sur les pages
  produit : capacités de **screen scraping, OCR et vision par ordinateur** pour reconnaître des éléments à
  l'écran « au-delà des simples clics à position fixe » — ce qui suggère que l'agent ne fait pas que du RUM
  passif mais peut aussi piloter/valider des parcours dans ces applications SaaS fermées (registre lu comme
  proche du monitoring synthétique plutôt que du RUM pur — **déduit**, l'article ne tranche pas explicitement
  RUM vs synthétique pour cette capacité).

**Ce que ça mesure concrètement, précisément (dans les apps M365/Salesforce)** : **non établi au-delà de**
« performance et adoption de l'application ». Aucune page ne détaille (dans ce que j'ai pu lire) si l'agent
mesure des Web Vitals classiques à l'intérieur de ces SPA propriétaires, ou des métriques spécifiques (temps
d'ouverture d'un email Outlook, temps de chargement d'un rapport Salesforce). **Comment c'est affiché** :
non établi — aucune capture ni description de dashboard spécifique M365/Salesforce trouvée.

**Comparaison directe avec notre produit** : notre « Extension navigateur » (`Capteurs.tsx` L27-48, lu
intégralement) est conceptuellement très proche — même promesse (« zéro ligne de code chez le client »,
« l'IT le déploie par politique d'entreprise »), même mécanique de registre domaine→app plutôt que
`<all_urls>` (`docs/CADRAGE_EXTENSION.md`, cité `Capteurs.tsx` L7-9 et confirmé par
`apps/console/app/admin/extension-scope/page.tsx` L13-20 : « Domaines observés par l'extension navigateur
(2ᵉ capteur RUM). Un domaine absent de cette liste — ou désactivé — n'est **jamais** observé »), même
pipeline que le SDK embarqué (`collection_source`, `Capteurs.tsx` L206-213). **Différence structurelle** :
notre extension est **générique** (n'importe quel domaine enregistré par un admin, `createExtensionScopeAction`,
`apps/console/app/admin/extension-scope/actions.ts` L22-35), alors qu'Ekara Browser Agent est **packagé et
commercialisé nommément pour deux cibles SaaS précises** (Microsoft 365, Salesforce) avec un discours dédié
(« adoption », déploiement GPO/Intune documenté par nom). Nous avons la même capacité technique mais pas le
même emballage produit ni le vocabulaire « adoption ».

### 1.9 Impact business (**rapporté (prudence)**, chiffres non recoupés — voir § 0)

Une série de chiffres de cas clients est ressortie d'une seule recherche WebSearch (pas de page source
directement fetchée, donc pas de citation ni de nom de client vérifiable) : amélioration de taux de
conversion (+18 %), baisse de MTTR de moitié en six mois, baisse d'abandon de paiement (18 % → 11 %),
réduction d'incidents majeurs (10 → 4 par an) avec un coût moyen par incident passant de 50 k€ à 30 k€,
« 380 000 € économisés contre une facture annuelle de 80 000 € », hausse des ventes de 25 % en une semaine
après correction d'un bug détecté par Ekara, +30 % de satisfaction client pour un site e-commerce cité.
**Je marque explicitement tout ce paragraphe « rapporté (prudence), non vérifié »** : ces chiffres arrondis,
non attribués à un client nommé ni à une page source précise, ressemblent à un contenu générique de
comparatif marketing (le même type de chiffres circule sur plusieurs sites concurrents pour illustrer un
ROI). Je ne les reprendrais pas comme fait établi sans avoir lu la page source d'origine.

### 1.10 Conformité (sans cookie, troncature IP, résidence UE)

**Documenté, recoupé deux fois** (page RUM directe + cohérence avec le positionnement général de la marque
« Best EU Data Sovereignty » trouvé sur la page comparatif) :
- Fonctionnement **sans cookie** possible (« session heuristics ») ou avec **cookie propre, courte durée**.
- **Troncature ou suppression totale d'adresse IP** possible.
- **Résidence des données en UE** proposée comme option (vs option globale), présentée comme argument de
  différenciation stratégique face à Datadog sur la page comparatif : « **Best EU Data Sovereignty** »,
  « Data residency & sovereignty options », face à Datadog jugé fort sur « Deep correlation of RUM ↔ APM ↔
  Logs » et « rich integrations ecosystem » mais « sans mention explicite de contrôles de souveraineté
  équivalents » (résumé du comparatif, **rapporté (prudence)** pour cette dernière formulation).
- **Consentement lié au CMP** : « le tag écoute votre CMP et n'active la collecte que lorsque les finalités
  requises sont accordées » (**rapporté (prudence)**, traduction).
- **Non établi** : mécanisme exact de troncature IP (nombre d'octets tronqués), documentation DSAR détaillée,
  éventuelle certification (SecNumCloud, HDS, ISO 27001) — aucune page consultée ne les cite explicitement,
  malgré une requête ciblée sur la page documentation.

### 1.11 Vocabulaire (glossaire IP-Label/Ekara relevé)

| Terme | Sens documenté |
|---|---|
| RUM | Real User Monitoring — télémétrie passive du trafic réel |
| STM / monitoring synthétique | Synthetic Transaction Monitoring — scénarios scriptés, exécutés depuis plusieurs régions, à intervalle régulier |
| Unified Monitoring / supervision unifiée | Rapprochement RUM + STM (+ APM chez certains concurrents cités) dans un affichage commun |
| Parcours (Journey) | Transaction utilisateur critique multi-étapes (ex. login → recherche → paiement) |
| Journey-level SLO / alerting | Objectif et alerte définis au niveau du parcours entier, pas d'une métrique isolée |
| Top offenders by segment | Classement des segments par gravité, pas par volume |
| Budget d'erreur | 1 − disponibilité cible, consommé en %, suivi dans le temps |
| Field data | Données de terrain (RUM), par opposition aux données de laboratoire (synthétique/Lighthouse) |
| Cohortes (mobile) | Regroupements par OS/device/région/version, vocabulaire Ekara Mobile |
| ANR | Application Not Responding — blocage perçu, vocabulaire Ekara Mobile (Android) |
| Weather report | Métaphore météo pour l'affichage codé-couleur de disponibilité/performance |

---

## 2. Ekara Mobile (survol, **rapporté (prudence)**)

Trois axes mesurés : **stabilité** (crashes, ANR, freezes), **performance** (cold/warm start, fluidité UI),
**impact utilisateur** (latence réseau, taux d'erreur API par opérateur/région/version/tier device). Dashboards
« orientés parcours », vues par version de release, une « matrice KPI » à 12 indicateurs citée sans détail
(crash-free, ANR-free, startup, latence, jank UI, disponibilité). Aucun widget ni capture décrits
précisément — la page reste conceptuelle (constat du résumé lui-même). **Non établi** : maquette réelle du
dashboard mobile. Notre produit n'a pas d'équivalent mobile natif — confirmé absent de `Capteurs.tsx`
(seulement extension navigateur + SDK web ; SDK React Native mentionné L68 « v0.1 », mais pas iOS/Android
natif : « pas de SDK iOS ou Android natif »).

---

## 3. Comparaison à notre console

### 3.1 Ce que nous avons déjà, sous une forme proche

- **Écran de corrélation synthétique ↔ RUM dédié** : `apps/console/app/correlation/page.tsx` L15-144. Titre
  affiché « Corrélation synthétique ↔ RUM », sous-titre « Ce que le robot MIP voit (DEM synthétique) face à
  ce que les utilisateurs réels subissent (RUM) ». Widget concret (que je peux décrire, contrairement à
  celui d'Ekara, § 1.6) : un hero à deux courbes superposées — « robot » (latence synthétique moyenne) vs
  « réel » (LCP p75 RUM) — sur des seaux horaires, sélecteur de route par puces cliquables, plus une tuile
  **« Angles morts »** = nombre de routes où le robot dit « ok » mais où le réel est « poor »
  (`blindSpots`, `apps/console/lib/queries-v2.ts` L476-488 : jointure `rum` et `syn` sur `app_id, route,
  bucket`, filtre `s.syn_state = 'ok' and r.rum_lcp_p75 > 2500`, trié par écart décroissant). C'est une
  version **plus précise** du principe IP-Label « détecter tôt en synthétique, valider l'impact réel en
  RUM » : nous, nous listons explicitement les cas où le synthétique **ment** (dit "ok" alors que le réel
  souffre) — un widget qu'aucune source IP-Label consultée ne décrit à ce niveau de détail.
- **Comparaison release actuelle vs précédente** : `VersionsTable` (`app/page.tsx` L287,
  `lib/queries-deploys.ts` L138-172 : « Comparaison des versions déployées : volume, LCP, INP et erreurs par
  release ») + impact du dernier déploiement (`queries-deploys.ts` L58 : « p75 LCP et nombre d'erreurs JS
  sur les 2 h qui [suivent] »). Même principe que le « pre/post release impact » IP-Label, sans le seuil
  d'alerte relatif associé (§ 1.4).
- **Erreurs ↔ Web Vitals, au niveau agrégé** : le score de santé composite pondère explicitement vitals et
  erreurs ensemble (`lib/health.ts` L138-264, `HealthFactor.key: "vitals" | "errors" | "stability" |
  "anomalies"`, formule `40 % vitals (LCP ×2) + 30 % erreurs + 20 % stabilité + 10 % anomalies`,
  `lib/glossary.ts` L76) et la comparaison de version fait de même par release
  (`lib/queries-deploys.ts` L3 : « on compare le p75 LCP et le volume d'erreurs sur la fenêtre AVANT vs
  APRÈS »). Ce que nous **n'avons pas** : un widget qui superpose dans le temps occurrences d'erreurs et
  dégradation de vital à un grain plus fin que la release (pas de courbe combinée par jour/heure) —
  contrairement au score composite qui, lui, résume mais ne montre pas la co-variation.
- **Segments nommés / vues enregistrées** : nous avons `SegmentBar` (« Segment tous les visiteurs · +
  Filtre », `console-ecrans-1.md` L11) et surtout, dans l'Explorer, « **Enregistrer cette analyse** » (carte
  de tableau de bord avec révision, option « Figer la fenêtre », vue personnelle, JSON canonique —
  `console-ecrans-1.md` L419). C'est l'équivalent fonctionnel du segment nommé IP-Label (« EU • Mobile •
  Checkout ») mais **positionné différemment** : chez IP-Label c'est un raccourci affiché en préréglage sur
  chaque écran RUM ; chez nous c'est une fonctionnalité de l'Explorer (composition libre), pas un préréglage
  visible en un clic sur `/`, `/pages` ou `/errors`.
- **Agent sans code pour applications qu'on ne contrôle pas** : notre extension navigateur (`Capteurs.tsx`
  L27-48) répond au même besoin que l'Ekara Browser Agent, avec le même argument de vente (« Zéro ligne de
  code chez le client — l'IT le déploie par politique d'entreprise », L45) et le même registre de portée
  contrôlée (domaine→app, jamais `<all_urls>`, confirmé par `extension-scope/page.tsx` L13-20 et
  `createExtensionScopeAction` qui ouvre aussi automatiquement le CORS du domaine,
  `apps/console/app/admin/extension-scope/actions.ts` L22-35). Nous avons aussi un **inventaire de parc**
  (`app/admin/extension-installs/page.tsx` L30-195 : postes équipés, version du parc, retard de version,
  postes « sans remontée ») qu'aucune source IP-Label consultée ne décrit avec ce niveau de détail
  opérationnel (mais absence de description ≠ absence chez eux — **non établi** côté Ekara).
- **Conformité déclarée à l'écran, pas seulement en doc** : `app/admin/privacy/page.tsx` L25-298 (DSAR
  RGPD, portée de la garantie d'effacement affichée directement dans l'écran d'administration,
  `identity_hash`, `DSAR_LIMITES`) ; pays **estimé** jamais géolocalisé, aucune IP stockée
  (`lib/geo.ts` L61-64, cité dans `console-ecrans-1.md` L69). C'est plus détaillé et plus visible
  (affiché dans le produit lui-même) que ce que les pages IP-Label documentent sur leur propre interface de
  gestion des droits — **mais** IP-Label revendique un choix de **résidence UE** explicite (§ 1.10) que rien
  dans mon périmètre de lecture ne confirme ou n'infirme pour notre produit (**non établi**, hors périmètre
  de cette recherche).

### 3.2 Ce qui nous manque

1. **Classement des segments par gravité (top impact), pas par volume.** Confirmé absent :
   `console-ecrans-1.md` L79 — « Le découpage classe par volume, pas par gravité : la barre la plus longue
   est la route la plus mesurée (`/partners`, 29), pas la plus lente ». C'est l'écart le plus net avec le
   principe IP-Label documenté au § 1.3 (« ciblez les pires combinaisons »).
2. **Dimensions FAI/opérateur et type de réseau (3G/4G/5G/Wi-Fi).** Prévues dans le code (bloc
   `dashboard-blocs.ts`, désactivé par défaut avec raison affichée) mais non branchées — IP-Label les
   documente comme actives et citées en exemple concret (Orange, SFR, Deutsche Telekom…).
3. **Segments nommés en préréglage visible sur chaque écran** (pas seulement dans l'Explorer). IP-Label
   présente des exemples courts et lisibles (« EU • Mobile • Checkout ») directement associés à l'écran RUM
   principal.
4. **Alerte à seuil relatif sur la comparaison de version** (« dégrade de > X % »), pas seulement un écart
   en points affiché sans notification (§ 1.4 vs notre `VersionsTable`).
5. **Agent SaaS packagé et commercialisé nommément** (Microsoft 365, Salesforce) avec un vocabulaire dédié
   (« adoption ») — nous avons la même mécanique technique générique mais pas cet emballage produit ciblé.
6. **Web Vitals par navigateur AVEC numéro de version** (INP segmenté par version de navigateur, documenté
   côté Ekara) : notre découpage a un onglet « Navigateur » (`console-ecrans-1.md` L43) mais **non établi**
   s'il descend à la version — à vérifier dans `lib/queries-breakdowns.ts` (non lu dans cette recherche,
   hors périmètre demandé).

### 3.3 Ce que nous faisons mieux (déjà écrit en détail dans `console-ecrans-1.md`, résumé ici)

Ces points sont déjà démontrés en détail — avec fichier:ligne — dans `console-ecrans-1.md` §§ « Meilleur que
Datadog » de chaque écran (01 à 08) et sa « Synthèse transversale » (L459-476) ; je ne les répète pas
intégralement, seulement ceux qui valent aussi face à IP-Label d'après ce que j'ai pu documenter :
- **L'échantillonnage est dit avec sa probabilité d'inclusion, sans extrapolation** (`lib/queries-errors.ts`
  L403-421) — rien de comparable n'est documenté côté IP-Label (silence, pas une infirmation).
- **« Inconnu » est un groupe à part, jamais confondu avec zéro**
  (`components/breakdown-view.tsx` L25-28) — même remarque.
- **Le pays est dit « ESTIMÉ », jamais une géolocalisation, aucune IP stockée** (`lib/geo.ts` L61-64) —
  IP-Label documente la troncature/suppression d'IP en option, nous l'avons en garantie par défaut sur cette
  dimension précise (à ne pas généraliser à tout le produit sans vérification — **déduit** de ce seul point).
- **Le score composite explique sa pondération à l'écran** (`HealthBanner.tsx` L128-139, « Points perdus :
  Stabilité des sessions −10 pt… ») — rien d'équivalent documenté côté Ekara (silence, pas une infirmation :
  **non établi** s'ils ont un score composite).
- **L'angle mort synthétique↔RUM est un widget nommé et quantifié** (§ 3.1) — plus précis que ce que j'ai pu
  documenter côté Ekara sur ce point précis (§ 1.6).

---

## 4. Les 12 idées de conception d'IP-Label à reprendre (classées)

Classement par utilité perçue pour notre produit (le plus transposable et le plus fort différenciateur
d'abord), avec le niveau de certitude sur ce qu'IP-Label fait réellement.

1. **Classer les segments par gravité (p75 dégradé), pas par volume — « top offenders by segment ».**
   [documenté] Le changement le plus direct et le moins coûteux : `Breakdown`/`RankBar` trient déjà des
   lignes, il s'agit de changer la clé de tri pour les dimensions à vital, avec un mode explicite
   (« par volume » / « par gravité ») plutôt qu'un remplacement silencieux.
2. **Comparaison de release avec seuil d'alerte relatif** (« dégrade de > X % »), pas seulement un écart en
   points affiché sans notification. [documenté le principe, rapporté (prudence) le chiffre] Vient
   compléter `VersionsTable` d'une alerte, pas juste d'un affichage.
3. **Segments nommés, courts, visibles en préréglage sur l'écran principal** (« EU • Mobile • Checkout »).
   [documenté] Notre mécanique de sauvegarde d'analyse existe déjà dans l'Explorer ; la reprendre comme
   raccourci visible sur `/` et `/pages` change surtout l'emplacement, pas la donnée.
4. **Dimension FAI/opérateur et type de réseau, branchée et affichée** (Orange, SFR, 4G/5G/Wi-Fi).
   [documenté] Le bloc existe déjà, désactivé avec raison — l'activer complète une lacune déjà identifiée en
   interne.
5. **Widget de corrélation erreurs ↔ Web Vitals à grain fin (temps), pas seulement par release.**
   [non établi côté Ekara — je propose ceci en m'inspirant du LIBELLÉ « Impact & correlation » trouvé, pas
   d'un widget vu] Attention : je ne peux pas garantir que ceci reprend un vrai widget Ekara puisque je ne
   l'ai pas vu — c'est une idée motivée par leur vocabulaire, pas une capture de leur écran.
6. **SLO et alerte au niveau du parcours entier (« journey-level »), pas seulement par métrique isolée.**
   [documenté, page Unified Monitoring] Idée forte pour un produit qui a déjà une notion d'action/parcours
   (`app/actions/page.tsx`) mais pas de SLO dessus.
7. **Agent SaaS packagé nommément pour des cibles précises** (dans notre cas : à définir — Microsoft 365 et
   Salesforce sont les cibles IP-Label, à adapter à notre propre marché cible). [documenté le principe
   général, la mécanique technique existe déjà côté nôtre via l'extension générique] Surtout un travail de
   packaging/discours produit, pas de nouveau code.
8. **Vocabulaire « adoption » à côté de « performance »** pour l'agent navigateur d'application interne — un
   angle produit (est-ce que les gens utilisent l'outil, pas seulement est-ce qu'il est rapide) qu'on n'a
   pas aujourd'hui. [documenté]
9. **Budget d'erreur suivi en pourcentage de consommation** (50/75/100 %) plutôt qu'un simple seuil
   binaire franchi/non franchi. [rapporté (prudence)] Vocabulaire SRE standard, transposable à nos alertes
   existantes si elles n'ont pas déjà cette granularité (**non établi** — hors périmètre de cette lecture).
10. **Argument de résidence des données en UE comme choix explicite et documenté** (endpoint dédié, région
    de stockage nommée). [documenté le principe général, rapporté (prudence) les détails techniques
    précis — § 0] Pertinent si notre hébergement le permet déjà ; à vérifier avant de le promettre.
11. **Matrice comparative RUM vs synthétique vs APM affichée au visiteur du site** (pas seulement dans une
    doc) pour expliquer où chaque outil sert — un contenu de vitrine, pas de dashboard. [documenté]
12. **Métaphore météo / codage couleur pour un coup d'œil disponibilité + performance unique.**
    [documenté le principe, non établi le widget exact] Le moins prioritaire : notre `HealthBanner` fait
    déjà un rôle proche (anneau + facteurs) avec une explication que la simple métaphore météo n'a pas
    (§ 3.3) — reprendre l'idée risquerait de reculer par rapport à ce qu'on a déjà de mieux.

## 5. Cinq points où nous pouvons faire mieux qu'IP-Label (au-delà de ce qu'on fait déjà mieux que Datadog)

1. **Dire pourquoi une comparaison de version est fiable ou non**, là où IP-Label (d'après ce que j'ai pu
   lire) documente un seuil d'alerte mais pas de mise en garde sur ce que l'écart mélange — nous l'avons
   déjà sur `VersionsTable` (« l'écart mêle le code et le contexte », `console-ecrans-1.md` L72) : à
   conserver et à étendre si un seuil d'alerte relatif est ajouté (point 2 du § 4), pour ne pas perdre cette
   nuance en gagnant l'alerte.
2. **Nommer explicitement la méthode de corrélation synthétique↔RUM** (jointure sur route+bucket, condition
   précise « robot ok mais réel poor », `blindSpots`) là où le principe IP-Label reste, dans mes lectures,
   au niveau du slogan (« validez l'impact réel par segment ») sans mécanique visible. Documenter à l'écran
   *la règle exacte* de ce qui compte comme « angle mort » est un différenciateur qu'on peut renforcer
   (ex. afficher l'ampleur du seuil 2 500 ms utilisé) sans rien copier.
3. **Étendre le classement par gravité (point 1 du § 4) en gardant la transparence de méthode** qui nous
   distingue déjà (troncature dite, « Inconnu » à part) — le risque en copiant IP-Label serait de perdre
   cette rigueur en optimisant seulement pour « qui a l'air pire en premier ». Il faut classer par p75
   dégradé **et** continuer à dire l'effectif et la troncature sur ce nouveau tri.
4. **Documenter la conformité dans le produit, pas seulement en discours commercial.** Nous avons déjà un
   écran DSAR qui affiche sa propre garantie et ses limites en direct (`app/admin/privacy/page.tsx` L25-52)
   ; IP-Label documente la conformité surtout comme argument de page produit. Pousser plus loin sur les
   dimensions où on l'a déjà (pays estimé) est moins risqué que de promettre une résidence UE qu'on n'a pas
   encore vérifiée (§ 3.3, dernier point).
5. **Ne pas dupliquer le flou qu'on a trouvé chez IP-Label sur « ce que mesure vraiment » l'agent SaaS**
   (Microsoft 365/Salesforce) : si nous emballons notre extension pour une cible précise (§ 4 point 7), le
   décrire avec la même précision que le reste du produit (quelle mesure exacte à l'intérieur de l'app
   propriétaire, pas seulement « performance et adoption ») serait un avantage net, puisque même leurs
   propres pages produit restent vagues sur ce point (§ 1.8, « non établi au-delà de… »).

---

## Non établi (récapitulatif)

- Le widget exact de corrélation erreurs↔Web Vitals chez Ekara (§ 1.5, 1.6).
- Le contenu de la documentation Ekara détaillée derrière l'espace client (le wiki public trouvé,
  `https://iplabel.atlassian.net/wiki/spaces/EWF/overview`, n'a pas été fetché — hors périmètre de cette
  passe, à faire si besoin).
- Le contenu de `ekara.ip-label.com/dashboards-and-reports-for-information-and-communication/` — erreur TLS,
  page non lue.
- Les seuils numériques précis d'alerte/SLO et les chiffres de cas clients (§ 0, § 1.7, § 1.9) — rapportés
  par un outil de synthèse, non vérifiés mot pour mot sur la page source.
- Ce que mesure précisément l'agent Ekara à l'intérieur de Microsoft 365/Salesforce, et comment c'est
  affiché (§ 1.8).
- Si notre découpage par navigateur descend jusqu'à la version (§ 3.2 point 6) — non vérifié dans cette
  recherche.
- Toute certification de conformité (SecNumCloud, HDS, ISO 27001) côté IP-Label — non trouvée.
