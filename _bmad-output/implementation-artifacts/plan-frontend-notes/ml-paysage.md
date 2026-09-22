# Paysage du machine learning en RUM — ce qu'on trouve ailleurs, ce qu'on a déjà, ce qui aurait du sens ici

Relevé le 21/09/2026. Méthode : lecture du dépôt (chemins et lignes cités) + recherche web (URLs
citées). Aucun fournisseur n'est recommandé nulle part dans ce document — les produits cités servent
de point de comparaison, pas de modèle à suivre. Là où une information n'a pas été trouvée dans les
sources consultées, c'est écrit « non établi », pas déduit.

---

## 0. Un chiffre qui encadre tout le reste : le volume réel

Avant de parler de méthode, il faut dire sur quoi elle s'exercerait. Ce qui est écrit dans le dépôt,
à la date de ce relevé, ne correspond pas à « quelques dizaines de sessions par jour » :

- **Aucun trafic n'est arrivé depuis le 17/09/2026 17:23** (`_bmad-output/implementation-artifacts/delivery-p8.md:270`),
  et `docs/RUM_PARITY_STATUS.md:40` et `:258` disent la même chose en des termes différents :
  « aucune donnée n'a été ingérée depuis les déploiements », « aucun trafic n'est arrivé ».
- Le seul ordre de grandeur chiffré trouvé est **« 5 erreurs ingérées au total en production au
  17/09/2026 »**, cité par `_bmad-output/implementation-artifacts/delivery-p8.md:538` (et `:181`) en
  reprenant `delivery-p5.md` — la phrase exacte n'a pas été retrouvée telle quelle dans
  `delivery-p5.md` lui-même (recherche infructueuse) ; elle n'est donc établie que par cette citation
  indirecte.
- `docs/RUM_PARITY_STATUS.md:192` (ligne `D9`) donne un deuxième chiffre, non recontrôlé pour ce
  document mais présent dans le dépôt : **≈ 97 lignes** de `rum_event` sur deux applications
  (90 sur `gip-plateforme` du 19/08 au 15/09, 7 sur `mip-rum-console` du 08/09 au 15/09), sur
  **4 046 lignes indexées** au total dans `rum_event_index`.

Conclusion factuelle : **« non établi »** qu'il existe un flux quotidien de plusieurs dizaines de
sessions en production. Ce que le dépôt établit, c'est un volume total de l'ordre de la dizaine à la
centaine de lignes sur plusieurs semaines, avec des trous de plusieurs jours. Toute méthode proposée
plus bas est jugée à cette aune, pas à celle d'un trafic continu — c'est la contrainte qui domine tout
le document, comme `docs/RUM_PARITY_STATUS.md` § 6.2 le dit pour le reste du produit.

---

## 1. Ce que nous avons déjà (pour ne pas proposer une deuxième fois la même chose)

| Capacité | Fichier : ligne | Méthode réelle |
|---|---|---|
| Prévision de dérive (`ForecastChart`) | `apps/console/lib/forecast.ts:14-30` (`linfit`) | Régression linéaire par moindres carrés sur une série quotidienne ; `null` si moins de 3 points. Le fichier le dit lui-même : « Logique PURE, testée. Volontairement transparente (moindres carrés), pas de boîte noire » (`forecast.ts:1-4`). |
| ETA avant franchissement de seuil | `forecast.ts:46-59` (`etaToThreshold`) | Projection de la droite jusqu'au seuil ; `0` si déjà franchi, `null` si la tendance s'en éloigne. |
| Narration déterministe | `forecast.ts:76-84` (`buildForecastNarrative`) | Gabarit de phrases à partir des ETA, explicitement commenté « déterministe, sans LLM » (`forecast.ts:61`). |
| Score de santé | `apps/console/lib/health.ts:138-264` (`healthScore`) | Score composite pondéré (Vitals 40, Erreurs 30, Stabilité 20, Anomalies 10 — `health.ts:209-251`), renormalisé sur les seules composantes disponibles (`health.ts:258-262`) ; `null` si aucune composante de trafic n'a de donnée (`health.ts:254-256`). |
| Anomalies LCP | vue SQL `v_anomaly`, `apps/ingest/sql/migration-v03.sql:70-84` | Z-score du LCP p75 horaire vs moyenne/écart-type glissants sur 7 jours, seuil `\|z\| > 3`. **N'émet une ligne que si `count(*) >= 5` buckets ET `stddev_samp(p75) > 0`** (`migration-v03.sql:80`) : sous ce volume, silence plutôt que faux positif. |
| Score d'expérience | `apps/console/lib/experience.ts:50-58` (`experienceScore`) | Vitals moins une pénalité de frustration bornée (`experience.ts:61-64`, plafonnée à 20 pts) et un ratio promoteurs/détracteurs façon NPS (`experience.ts:26-34`). |
| Regroupement d'erreurs v2 | `apps/ingest/lib/error-grouping.mjs`, `apps/ingest/supabase/functions/_shared/error-normalize.mjs` (migration v72) | Normalisation **déterministe** du message/pile (pas d'apprentissage), calculée en ombre sur chaque occurrence dans toutes les apps mais activée dans aucune (`_bmad-output/implementation-artifacts/delivery-p5.md:16` : « v2 activé pour aucune app »). Confiance explicite : `low_confidence` quand aucune frame applicative n'est exploitable (`error-normalize.mjs:36`, base `GROUPING_BASES`, `error-normalize.mjs:59`). |
| Corrélation synthétique ↔ RUM | `apps/console/app/correlation/page.tsx:15-144` | Règle de seuil, pas une corrélation calculée : « angle mort » = robot « ok » ET réel LCP p75 > 2,5 s au même bucket horaire (texte affiché, `page.tsx:88-92`). Aucun coefficient de corrélation n'est calculé aujourd'hui. |
| Agrégats hybrides | `apps/console/lib/analytics-rollups.ts:358-444` | Fusion de buckets d'histogrammes et percentile recalculé sur la fusion (`fusionnerSeaux`, `percentileFusionne`) — de la statistique d'agrégation, pas de la prévision ni de la détection. |
| Supervision SVI | `apps/console/lib/svi-outcome.ts`, `svi-recall.ts` | Taux de containment/abandon calculés directement (division), aucune détection ni prévision. |

**Point de vigilance sur le périmètre de la tâche confiée** : `app/ai/page.tsx` et
`apps/console/lib/xsom-ai.ts` ne sont **pas** de l'IA appliquée au RUM — c'est une façade
d'observabilité des **coûts et de la latence d'appels LLM externes** (un produit tiers, « xSOM AI
Guard », interrogé par jeton Bearer, `xsom-ai.ts:1-4` et `:27-38`) : nombre d'appels, tokens, coût,
p75, taux d'erreur, par modèle/opération/utilisateur. Rien à voir avec la détection ou la prévision
sur les données RUM elles-mêmes. Le comparer aux fonctionnalités ML des concurrents RUM serait une
erreur de périmètre.

---

## 2. Tableau comparatif — Datadog / IP-Label (Ekara) / Grafana / nous

Sources : URLs en bas de chaque bloc du § 3 et liste finale. Colonnes vides = non établi dans les
sources consultées (pas d'accès à un compte payant pour vérifier au-delà de la documentation publique).

| Capacité | Datadog | IP-Label (Ekara) | Grafana (Cloud) | Nous |
|---|---|---|---|---|
| Détection d'anomalies sur métrique | 3 algorithmes documentés (Basic/Agile/Robust — moyenne mobile, SARIMA robuste, décomposition saisonnière) | mentionné en page produit (« AI Incident Guard », « Flow AI ») sans détail public trouvé | Grafana ML, apprend sur l'historique | z-score 7 j glissants, LCP seulement, seuil `\|z\|>3`, min. 5 buckets (§1) |
| Prévision de tendance | Monitor de prévision avec bande de déviation attendue | non établi | Prévision de métrique (Grafana ML) | régression linéaire (moindres carrés), sans bande d'incertitude affichée (§1) |
| Détection d'outliers entre groupes | Monitor dédié (DBSCAN/scaledDBSCAN, MAD/scaledMAD), exige un groupe de 3+ membres homogènes | non établi | Détection d'outliers (Grafana ML) | aucune |
| Regroupement d'erreurs | manuel par défaut + « Suspected Cause » par catégorie fixe (5 catégories) | « improve the grouping » via source maps, mécanisme non détaillé publiquement | non concerné (pas un outil d'error tracking) | empreinte déterministe multi-moteurs, jamais activée en production (§1) |
| Fusion d'issues par ML | Sentry (hors comparatif demandé, cité pour mémoire) : embeddings, fusion automatique | non établi | — | aucune |
| Cause suspectée / RCA | catégories fixes à la création de l'issue | AI Incident Guard : « analyse les tendances et livre un diagnostic », mécanisme non détaillé | Sift : diagnostic assisté sur métriques/logs/traces pendant un incident | aucune |
| Résumé de session/replay par IA | résumés + chapitres générés par LLM | non établi | non établi (pas un outil de session replay) | aucun (le seul texte généré côté produit est la narration déterministe du forecast, §1) |
| Score de frustration comportementale | non trouvé comme tel dans les sources consultées pour Datadog RUM | non établi | non concerné | signaux `frustration.rage/dead/error` captés (`apps/console/lib/queries-frustration.ts:30`) mais pas de score agrégé |
| Corrélation synthétique ↔ réel comme indicateur affiché | non trouvé comme métrique dédiée | les deux briques existent (STM + RUM) mais pas de coefficient affiché trouvé dans les sources consultées | non concerné | page dédiée, mais seuil binaire, pas de coefficient (§1) |
| Formule visible / explicable | non — moteurs propriétaires | non — moteurs propriétaires | partiellement (Grafana ML documente les grandes lignes, pas les poids) | oui — chaque score cité au §1 a sa formule dans le dépôt |
| Où ça tourne / coût | SaaS Datadog, facturé à la métrique/à l'hôte | SaaS/on-prem Ekara | Grafana Cloud, inclus dans les offres ML | SQL (vues), job planifié Railway (`scheduler`), ou JS pur au rendu — coût marginal nul à ce volume |

---

## 3. Candidats ML pour notre produit

Dix candidats. Chacun réutilise des tables/colonnes déjà en place, part de la méthode la plus simple
qui marche, et dit explicitement où elle cesse de marcher.

### C1 — Bande d'incertitude sur les prévisions existantes
- **Question métier** : à quel point la projection affichée par `ForecastChart` peut-elle se tromper ?
- **Signal d'entrée** : les mêmes séries quotidiennes que `linfit` consomme déjà (`forecast.ts:14`).
- **Méthode la plus simple** : après l'ajustement des moindres carrés, calculer l'erreur-type des
  résidus (écart entre chaque point observé et `projectAt`) puis une bande ± 1,96 × erreur-type — un
  intervalle de prédiction gaussien classique, pas un nouvel algorithme.
- **Volume minimal** : `linfit` refuse déjà sous 3 points (`forecast.ts:19`, retourne `null`) ;
  l'erreur-type n'est stable qu'à partir d'une dizaine de points — en dessous, afficher la projection
  seule, comme aujourd'hui.
- **Incertitude / explication** : la bande EST l'affichage de l'incertitude ; le texte reste celui de
  `buildForecastNarrative`.
- **Où ça tourne / coût** : JS pur, même endroit que `linfit` aujourd'hui — coût nul.
- **Ce que les autres n'offrent pas tel quel** : Datadog affiche des « expected deviation bounds »
  mais dans son monitor de prévision facturé, pas sur le graphe RUM exploratoire lui-même
  ([Forecasts Monitor](https://docs.datadoghq.com/monitors/types/forecasts/)).

### C2 — Anomalies génériques par médiane/MAD plutôt que moyenne/écart-type
- **Question métier** : repérer un décrochage sur d'autres indicateurs que le LCP horaire (taux
  d'erreur, INP, CLS), sans qu'une minute chargée ne masque l'anomalie suivante.
- **Signal d'entrée** : `rum_error`/`rum_pageview` pour le taux d'erreur, `rum_metric` pour les autres
  vitaux déjà listés dans `CORE_VITALS` (importé `health.ts:16`).
- **Méthode la plus simple** : garder le z-score de `v_anomaly` mais remplacer moyenne/écart-type par
  médiane/MAD (Median Absolute Deviation) — une ligne SQL de plus, aucune bibliothèque, plus adapté à
  des distributions à queue épaisse que la moyenne actuelle.
- **Volume minimal** : reprendre à l'identique la garde déjà écrite (`migration-v03.sql:80`,
  `count(*) >= 5 and stddev_samp(p75) > 0`) — sous ce seuil, aucune ligne, pas un zéro.
- **Incertitude / explication** : garder le format `AnomalyRow` déjà affiché brut
  (`health.ts:114-121` : `p75`, `mean_7d`, `z_score`).
- **Où ça tourne / coût** : vue SQL, comme aujourd'hui — aucun service de plus.
- **Ce que les autres n'offrent pas** : les 3 algorithmes Datadog (Basic/Agile/Robust) sont documentés
  en principe mais fermés en pratique ([Anomaly Monitors](https://docs.datadoghq.com/monitors/guide/anomaly-monitor/)) ;
  la formule ici reste lisible dans le dépôt.

### C3 — Score d'impact d'une issue d'erreur, déterministe et expliqué composante par composante
- **Question métier** : parmi les issues ouvertes (`error_issue`, v72), lesquelles traiter en premier.
- **Signal d'entrée** : occurrences et sessions distinctes déjà présentes dans `error_issue` /
  `rum_error` depuis la migration v72 (`apps/ingest/lib/error-grouping.mjs:1-9`).
- **Méthode la plus simple** : un score pondéré de la même famille que `healthScore`
  (`health.ts:209-251`) : occurrences récentes, sessions distinctes touchées, part de sessions closes
  juste après l'erreur — une formule visible, pas un modèle appris.
- **Volume minimal** : le calcul ne pose pas de seuil dur, mais un classement n'a d'intérêt que si
  plusieurs issues coexistent ; à une issue, rien à trier.
- **Incertitude / explication** : afficher chaque composante et son poids, comme `HealthFactor.detail`
  le fait déjà (`health.ts:106-112`).
- **Où ça tourne / coût** : SQL + composant serveur Next.js, comme `error-issues.ts` existant.
- **Ce que les autres n'offrent pas tel quel** : Datadog classe par 5 catégories fixes de « suspected
  cause » ([Suspected Causes](https://docs.datadoghq.com/error_tracking/suspected_causes/)), pas par
  un score continu et décomposé.

### C4 — Corrélation quantifiée robot/réel, au-delà du seuil binaire actuel
- **Question métier** : la sonde synthétique reste-t-elle représentative des utilisateurs réels dans
  le temps, pas seulement à un instant donné.
- **Signal d'entrée** : `correlationSeries` (`apps/console/app/correlation/page.tsx:33`), qui joint
  déjà `syn_latency_avg` et `rum_lcp_p75` par bucket horaire et par route.
- **Méthode la plus simple** : coefficient de corrélation de Pearson glissant entre les deux séries,
  affiché à côté du `RobotVsRealChart` existant — une formule à quatre sommes, aucune bibliothèque.
- **Volume minimal** : proposition de 8 buckets communs avant d'afficher un coefficient (même ordre de
  grandeur que C1) ; en dessous, garder le message actuel « Pas encore de route avec données robot ET
  réel » (`page.tsx:74-76`).
- **Où ça tourne / coût** : même composant serveur que `/correlation` aujourd'hui.
- **Ce que les autres n'offrent pas** : dans les sources consultées, ni Datadog ni Grafana ne mettent
  en regard nativement une sonde synthétique et du RUM sur le même graphe ; IP-Label a les deux
  briques (Ekara STM + RUM) mais aucun coefficient de corrélation affiché comme indicateur de
  confiance n'a été trouvé sur les pages consultées — **non établi** au-delà de ces pages.

### C5 — Suggestion de fusion d'issues par similarité lexicale, jamais automatique
- **Question métier** : repérer que deux issues ouvertes sont probablement le même bug sous une
  empreinte différente, sans fusionner à la place de la personne qui triage.
- **Signal d'entrée** : le message normalisé déjà produit pour le hachage
  (`messageTemplate`, référencé `error-normalize.mjs:494`).
- **Méthode la plus simple** : similarité de Jaccard sur les tokens du message normalisé entre paires
  d'issues ouvertes de la même app — un ensemble de mots et une intersection/union, aucun embedding.
- **Volume minimal** : au moins 2 issues ouvertes dans la même app pour qu'une paire existe.
- **Incertitude / explication** : afficher les mots communs qui motivent la suggestion — explicable
  mot à mot, contrairement à une distance d'embedding qui ne s'explique pas.
- **Où ça tourne / coût** : job planifié du `scheduler` Railway (`apps/ingest/jobs/planifie.mjs`,
  boucle déjà responsable du « rafraîchissement des agrégats », `docs/TOPOLOGIE_BACKEND.md:22`).
- **Ce que les autres n'offrent pas** : Sentry fusionne automatiquement par embedding transformer
  (« 40% de réduction des nouveaux issues », [Issue Grouping: Smarter, Faster, Half as Wrong](https://blog.sentry.io/enhancing-issue-grouping/)) ;
  ici la fusion reste une suggestion sous contrôle humain, avec sa justification lexicale visible —
  une position différente, pas supérieure, cohérente avec un volume trop faible (§0) pour valider un
  modèle appris.

### C6 — Prévision de capacité d'ingestion propre à notre hébergement
- **Question métier** : dans combien de jours atteint-on un palier d'hébergement (quota, palier
  tarifaire) au rythme actuel.
- **Signal d'entrée** : table d'usage quotidien par tenant (`tenant_usage_daily`, citée comme table
  d'exploitation survivante `docs/RUM_PARITY_STATUS.md` ligne `D4`).
- **Méthode la plus simple** : réutiliser `linfit` + `etaToThreshold` tels quels (`forecast.ts:14-59`,
  déjà écrits pour « anticiper la dérive AVANT l'incident », `forecast.ts:1-2`), avec le seuil = palier
  connu.
- **Volume minimal** : identique à `linfit`, 3 points.
- **Où ça tourne / coût** : job planifié `scheduler` ou calcul à la volée dans une page d'admin —
  réutilisation de code, coût nul.
- **Ce que les autres n'offrent pas** : aucun outil tiers ne peut prévoir un palier propre à notre
  contrat d'hébergement — c'est une prévision sur nos contraintes d'exploitation, pas sur un SLA
  client.

### C7 — Probabilité de détection selon le taux d'échantillonnage et le volume réel
- **Question métier** : à ce volume et ce taux d'échantillonnage, quelle est la probabilité d'avoir
  manqué une erreur qui touche 1 session sur N ?
- **Signal d'entrée** : `sr` (taux de session) et `esr` (taux d'échantillonnage d'erreur), déjà
  mentionnés dans la formule de probabilité d'inclusion (`docs/RUM_PARITY_STATUS.md` § 5.3, ligne
  ~249 : « sr + (1 − sr) × esr »).
- **Méthode la plus simple** : ce n'est **pas** du machine learning — loi binomiale fermée :
  `1 − (1 − f × p_inclusion)^N` pour quelques fréquences repères (1/1000, 1/10000 sessions).
- **Volume minimal** : aucun — la formule est utile précisément à faible volume, et c'est le cas
  mesuré au § 0.
- **Incertitude / explication** : la formule est l'explication.
- **Où ça tourne / coût** : SQL/JS pur, à côté du bandeau d'échantillonnage déjà affiché.
- **Ce que les autres n'offrent pas** : dans les sources consultées, Datadog affiche un taux
  d'échantillonnage brut mais pas de probabilité de détection dépendante du volume réel — un candidat
  qui n'a de sens QUE parce que notre volume réel est faible (§ 0), pas un candidat « en plus ».

### C8 — Test statistique de régression après déploiement
- **Question métier** : le taux d'erreur a-t-il vraiment changé après un déploiement, ou est-ce du
  bruit ?
- **Signal d'entrée** : marqueurs de déploiement déjà utilisés pour décider une « régression » en
  transaction d'ingestion (`_bmad-output/implementation-artifacts/delivery-p5.md:96`, P5.6).
- **Méthode la plus simple** : test de proportion à deux échantillons (z-test) comparant le taux
  d'erreur avant/après le marqueur — une formule fermée standard, pas un modèle.
- **Volume minimal** : un z-test de proportions n'est indicatif qu'avec `n × p ≥ 5` des deux côtés ;
  en dessous, garder la règle binaire actuelle (réapparition = régression) et l'écrire à l'écran
  (« volume insuffisant pour un test statistique »).
- **Où ça tourne / coût** : dans la transaction d'ingestion existante ou en job planifié.
- **Ce que les autres n'offrent pas** : Deployment Tracking de Datadog signale une corrélation
  temporelle, mais aucune p-value affichée n'a été trouvée dans les sources consultées.

### C9 — Narration de session déterministe, à partir des événements structurés
- **Question métier** : comprendre une session sans regarder l'intégralité du replay vidéo.
- **Signal d'entrée** : `rum_pageview`, `rum_error`, signaux `frustration.rage`/`dead`/`error`
  (`apps/console/lib/queries-frustration.ts:30`), tout déjà structuré.
- **Méthode la plus simple** : un gabarit de phrases, sur le modèle de `buildForecastNarrative`
  (`forecast.ts:76-84`, déjà commenté « déterministe, sans LLM », `forecast.ts:61`), appliqué à la
  chronologie d'une session — pas de génération de texte libre, des phrases composées à partir de
  faits.
- **Volume minimal** : aucun — fonctionne dès la première session avec un événement, ce n'est pas un
  modèle appris.
- **Incertitude / explication** : rien à afficher comme incertitude, c'est un résumé de faits observés
  — la distinction à assumer explicitement face à un résumé LLM, qui peut reformuler ou halluciner.
- **Où ça tourne / coût** : JS pur au rendu de la page de session, aucun appel API externe.
- **Ce que les autres n'offrent pas tel quel** : Datadog génère ses résumés de replay via un modèle de
  langage ([AI summaries and smart chapters](https://www.datadoghq.com/blog/ai-summaries-and-smart-chapters/)) —
  coût et latence par résumé, et un risque de reformulation inexacte qu'une version déterministe
  n'a pas ; en échange elle décrit moins librement. Un compromis à dire, pas à cacher.

### C10 — Avertissement de significativité sur le score de santé
- **Question métier** : le `healthScore` affiché reflète-t-il assez de sessions pour être stable d'un
  jour à l'autre, ou 2 sessions du jour ?
- **Signal d'entrée** : `c.sessions`, déjà compté par la requête existante (`health.ts:167-182`).
- **Méthode la plus simple** : aucun modèle — un seuil de volume minimal explicite (proposition : 30
  sessions) sous lequel une mention s'affiche à côté du score (« peu de sessions sur la période, le
  score peut varier fortement »), sans changer le calcul lui-même.
- **Volume minimal** : c'est l'objet même du candidat — en dessous du seuil, avertir, pas masquer (le
  produit préfère déjà « `null` plutôt que `0` » ailleurs, `docs/RUM_PARITY_STATUS.md` § 5.3 : « Une
  métrique sans dénominateur rend `null`, pas `0` »).
- **Où ça tourne / coût** : dans `healthScore` lui-même, un champ de plus.
- **Ce que les autres n'offrent pas** : c'est moins une fonctionnalité absente chez Datadog/Grafana
  qu'une discipline sans intérêt pour eux — un client Datadog voit des millions de sessions ; pour
  nous, au volume mesuré au § 0, c'est l'avertissement le plus utile de toute cette liste.

---

## 4. Ce qu'il ne faut PAS promettre

- **Pas de détection d'anomalies « intelligente » tant que le volume réel reste celui du § 0.** Une
  méthode statistique n'est correcte à ce volume que si elle refuse de répondre plutôt que d'inventer
  — c'est déjà le comportement de `v_anomaly` (`migration-v03.sql:80`) et il doit rester la règle pour
  tout ce qui précède.
- **Rien de ce qui précède n'est un modèle « appris »** au sens où des paramètres seraient estimés sur
  un historique de données réelles — tout reste de la statistique fermée ou de la règle déterministe.
  Le dire ainsi, pas « intelligence artificielle », dans toute présentation du produit.
- **Pas de fusion automatique d'erreurs.** C5 reste une suggestion sous contrôle humain, jamais une
  fusion automatique — contrairement à Sentry, et tant que la méthode reste lexicale, non validée sur
  du volume réel.
- **Un résumé déterministe (C9) n'est pas un résumé généré par IA** et ne doit pas être présenté comme
  l'équivalent fonctionnel du résumé de replay Datadog — c'est un texte qui liste des faits, pas un
  texte qui les interprète.
- **Pas de comparaison à un score « validé sur des milliards de sessions ».** LogRocket dit avoir
  entraîné Galileo sur « des milliards de points de données »
  ([AI Issues](https://logrocket.com/products/ai-issues)) ; nos scores (santé, expérience) sont
  déterministes et lisibles dans le dépôt, ce qui est une garantie différente (explicabilité), pas une
  promesse de performance validée sur un grand volume — parce qu'il n'y en a pas (§ 0).
- **Pas de « cause suspectée » causale à la Dynatrace Davis.** Davis s'appuie sur une topologie
  complète de dépendances construite en continu (« Grail », causal AI —
  [Davis AI](https://docs.dynatrace.com/docs/platform/davis-ai)). Nous n'avons qu'un seul framework
  backend réellement instrumenté et aucune propagation backend→backend
  (`docs/RUM_PARITY_STATUS.md` § 6.5). Toute « cause suspectée » chez nous doit rester présentée comme
  une corrélation statistique, jamais comme une causalité prouvée.
- **Pas de promesse de temps réel** pour ce qui tourne en job planifié `scheduler` (C5, C6) — la boucle
  de travaux a sa propre cadence (`docs/TOPOLOGIE_BACKEND.md:22`), pas celle de l'écriture.
- **Pas de citation de l'ordre de grandeur « quelques dizaines de sessions par jour »** sans le
  qualifier : ce que le dépôt établit est plus proche de quelques lignes à quelques dizaines sur
  plusieurs semaines, avec des trous (§ 0). Toute épique ou tout argumentaire construit sur ce document
  doit reprendre les chiffres du § 0, pas un ordre de grandeur supposé.

---

## Sources

**Dépôt** (chemins relatifs à `/Users/juliantalou/Documents/PRO/01-CLIENTS/MIP/DEV/poc-MIP_RUM`) :
`apps/console/lib/forecast.ts`, `apps/console/lib/health.ts`, `apps/console/lib/experience.ts`,
`apps/console/lib/analytics-rollups.ts`, `apps/console/lib/queries-frustration.ts`,
`apps/console/lib/xsom-ai.ts`, `apps/console/app/correlation/page.tsx`, `apps/console/app/ai/page.tsx`,
`apps/console/app/svi/page.tsx`, `apps/console/app/svi/appels/page.tsx`,
`apps/console/lib/svi-outcome.ts`, `apps/console/lib/svi-recall.ts`,
`apps/ingest/lib/error-grouping.mjs`, `apps/ingest/supabase/functions/_shared/error-normalize.mjs`,
`apps/ingest/sql/migration-v03.sql`, `apps/ingest/jobs/planifie.mjs`,
`docs/RUM_PARITY_STATUS.md`, `docs/TOPOLOGIE_BACKEND.md`, `docs/LIMITES.md`, `docs/context/produit-rum.md`,
`_bmad-output/implementation-artifacts/delivery-p5.md`, `_bmad-output/implementation-artifacts/delivery-p8.md`
(lignes précises citées dans le corps du document).

**Web** :
[Watchdog Insights for RUM](https://docs.datadoghq.com/real_user_monitoring/explorer/watchdog_insights/) ·
[Anomaly Monitors](https://docs.datadoghq.com/monitors/guide/anomaly-monitor/) ·
[Anomaly Monitor (algorithmes)](https://docs.datadoghq.com/monitors/types/anomaly/) ·
[AI Investigations](https://docs.datadoghq.com/real_user_monitoring/ai_investigations/) ·
[Suspected Causes](https://docs.datadoghq.com/error_tracking/suspected_causes/) ·
[Error Tracking Explorer](https://docs.datadoghq.com/real_user_monitoring/error_tracking/explorer/) ·
[Forecasts Monitor](https://docs.datadoghq.com/monitors/types/forecasts/) ·
[Outlier Monitor](https://docs.datadoghq.com/monitors/types/outlier/) ·
[Alerting With RUM Data](https://docs.datadoghq.com/real_user_monitoring/guide/alerting-with-rum/) ·
[AI summaries and smart chapters](https://www.datadoghq.com/blog/ai-summaries-and-smart-chapters/) ·
[Ekara by ip-label](https://ip-label.com/) · [ip-label.com/fr/rum/](https://ip-label.com/fr/rum/) ·
[ITRS Acquires ip-label](https://www.itrsgroup.com/blog/itrs-acquires-ip-label) ·
[Sift investigations](https://grafana.com/docs/grafana-cloud/ai-tools/machine-learning/sift/sift/) ·
[Machine learning | Grafana Cloud](https://grafana.com/docs/grafana-cloud/ai-tools/machine-learning/) ·
[AI-powered diagnostics for incident response](https://grafana.com/blog/2024/02/21/ai-powered-diagnostics-for-incident-response-new-sift-features-in-grafana-irm/) ·
[Issue Grouping: Smarter, Faster, Half as Wrong (Sentry)](https://blog.sentry.io/enhancing-issue-grouping/) ·
[Seer (Sentry)](https://docs.sentry.io/product/ai-in-sentry/seer/) ·
[Davis AI (Dynatrace docs)](https://docs.dynatrace.com/docs/platform/davis-ai) ·
[Advancing AIOps: Davis AI (Dynatrace blog)](https://www.dynatrace.com/news/blog/advancing-aiops-preventive-operations-powered-by-davis-ai/) ·
[AI Issues (LogRocket)](https://logrocket.com/products/ai-issues) ·
[Galileo AI (LogRocket docs)](https://docs.logrocket.com/docs/galileo) ·
[Sentiment/Frustration Signals (FullStory)](https://www.fullstory.com/platform/frustration-signals/) ·
[Rage Clicks, Error Clicks, Dead Clicks, Thrashed Cursor (FullStory Help)](https://help.fullstory.com/hc/en-us/articles/360020624154-Rage-Clicks-Error-Clicks-Dead-Clicks-and-Thrashed-Cursor-Frustration-Signals).
