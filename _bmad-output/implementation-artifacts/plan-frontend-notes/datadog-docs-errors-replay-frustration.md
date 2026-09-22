# Datadog — Error Tracking, Session Replay, Frustration signals : inventaire documentaire

Lecture du 18 septembre 2026, à partir de la documentation officielle (`docs.datadoghq.com`, versions `.md` brutes téléchargées), du code source public du SDK navigateur (`DataDog/browser-sdk`, branche `main`) et des captures fournies par l'utilisateur. Ce document dit ce que Datadog documente, ce que l'on peut en déduire, et ce qui n'est pas établi. Il ne dit pas ce que Datadog fait réellement en production au-delà de ce que ses pages affirment.

## 0. Méthode, sources et convention de marquage

Convention utilisée dans tout le document :

- **[DOC]** : écrit tel quel dans une page de documentation officielle. Citation = nom du fichier brut + ligne, ou URL.
- **[CODE SDK]** : lu dans le code source public du SDK navigateur, pas dans la doc. Datadog peut le changer sans préavis.
- **[CAPTURE]** : vu sur une capture ou une image de vidéo fournie par l'utilisateur. Les captures datent (une porte « Dec 03, 2019 », la vidéo de triage « May 22 »), l'interface a pu changer.
- **[DÉDUIT]** : conclusion tirée par croisement ; à lire comme une hypothèse.
- **non établi** : ni documenté, ni visible, ni lisible dans le code.

Fichiers bruts (préfixe `raw/` = `/private/tmp/claude-501/-Users-juliantalou-Documents-PRO-01-CLIENTS-MIP-DEV-poc-MIP-RUM/69c961b4-4adf-49b9-a810-3af9b5d672e7/scratchpad/plan/reads/raw/`) :

| Fichier brut | URL source |
| --- | --- |
| `raw/error_tracking_explorer.md` | https://docs.datadoghq.com/error_tracking/explorer/ |
| `raw/error_tracking_issue_states.md` | https://docs.datadoghq.com/error_tracking/issue_states/ |
| `raw/error_tracking_regression_detection.md` | https://docs.datadoghq.com/error_tracking/regression_detection/ |
| `raw/error_tracking_error_grouping.md` | https://docs.datadoghq.com/error_tracking/error_grouping/ |
| `raw/error_tracking_suspect_commits.md` | https://docs.datadoghq.com/error_tracking/suspect_commits/ |
| `raw/error_tracking_suspected_causes.md` | https://docs.datadoghq.com/error_tracking/suspected_causes/ |
| `raw/error_tracking_issue_team_ownership.md` | https://docs.datadoghq.com/error_tracking/issue_team_ownership/ |
| `raw/error_tracking_auto_assign.md` | https://docs.datadoghq.com/error_tracking/auto_assign/ |
| `raw/error_tracking_ticketing_systems.md` | https://docs.datadoghq.com/error_tracking/ticketing_systems/ |
| `raw/error_tracking_manage_data_collection.md` | https://docs.datadoghq.com/error_tracking/manage_data_collection/ |
| `raw/error_tracking_frontend_browser.md` | https://docs.datadoghq.com/error_tracking/frontend/browser/ |
| `raw/error_tracking_frontend_collecting_browser_errors.md` | https://docs.datadoghq.com/error_tracking/frontend/collecting_browser_errors/ |
| `raw/error_tracking_frontend_replay_errors.md` | https://docs.datadoghq.com/error_tracking/frontend/replay_errors/ |
| `raw/monitors_types_error_tracking.md` | https://docs.datadoghq.com/monitors/types/error_tracking/ |
| `raw/real_user_monitoring_session_replay.md` | https://docs.datadoghq.com/real_user_monitoring/session_replay/ (identique octet pour octet à `…/session_replay/browser/` et à `getting_started/session_replay`) |
| `raw/real_user_monitoring_session_replay_browser_troubleshooting.md` | https://docs.datadoghq.com/session_replay/troubleshooting/ |
| `raw/session_replay_setup_and_configuration.md` | https://docs.datadoghq.com/session_replay/setup_and_configuration/ |
| `raw/session_replay_privacy_options.md` | https://docs.datadoghq.com/session_replay/privacy_options/ |
| `raw/session_replay_heatmaps.md` | https://docs.datadoghq.com/session_replay/heatmaps/ (l'URL de départ `…/session_replay/browser/heatmaps/` renvoie 404) |
| `raw/session_replay_dev_tools.md` | https://docs.datadoghq.com/session_replay/dev_tools/ |
| `raw/session_replay_playlists.md` | https://docs.datadoghq.com/session_replay/playlists/ |
| `raw/real_user_monitoring_guide_sampling-browser-plans.md` | https://docs.datadoghq.com/real_user_monitoring/guide/sampling-browser-plans/ |
| `raw/real_user_monitoring_browser_frustration_signals.md` | https://docs.datadoghq.com/real_user_monitoring/browser/frustration_signals/ |
| `raw/real_user_monitoring_platform_dashboards_usage.md` | https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/usage/ |
| `raw/real_user_monitoring_platform_dashboards_errors.md` | https://docs.datadoghq.com/real_user_monitoring/platform/dashboards/errors/ |
| `raw/real_user_monitoring_application_monitoring_browser_data_collected.md` | https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/data_collected/ |
| `raw/browser_tracking_user_actions.md` | https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/tracking_user_actions/ |
| `raw/browser_monitoring_page_performance.md` | https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/monitoring_page_performance/ |
| `raw/real_user_monitoring_explorer_events.md` | https://docs.datadoghq.com/real_user_monitoring/explorer/events/ |
| `raw/real_user_monitoring_explorer_search.md` | https://docs.datadoghq.com/real_user_monitoring/explorer/search/ |
| `raw/real_user_monitoring_explorer_visualize.md` | https://docs.datadoghq.com/real_user_monitoring/explorer/visualize/ |
| `raw/real_user_monitoring_explorer_watchdog_insights.md` | https://docs.datadoghq.com/real_user_monitoring/explorer/watchdog_insights/ |
| `raw/sdk_computeFrustration.ts`, `raw/sdk_clickChain.ts`, `raw/sdk_trackClickActions.ts`, `raw/sdk_frustrationIgnore.ts`, `raw/sdk_waitPageActivityEnd.ts` | https://github.com/DataDog/browser-sdk/tree/main/packages/browser-rum-core/src/domain/action/ et `…/domain/waitPageActivityEnd.ts` |

Captures (converties en PNG dans `…/scratchpad/plan/reads/shots/`) : `newerrortrackingimage.png` (panneau d'issue Error Tracking), `datadog-rum-views-explorer.png` (RUM Explorer, 2019), `enhanceenduserimage.png` (résultat Synthetics, hors périmètre), `triage/f_001…f_005.png` (images de `240523-rum-product-page-triageresolve-v01.mp4`), `rumdb/f_002.png` (image de `rum-db-new.mp4`). Page marketing consultée : https://www.datadoghq.com/dg/real-user-monitoring/overview/ — elle ne contient aucun chiffre ni libellé d'écran utile ; non citée ensuite.

Pages non trouvées (404) : `session_replay/browser/heatmaps`, ancien chemin `packages/rum-core/src/domain/action/*.ts` du SDK (déplacé vers `packages/browser-rum-core/…`). Une divergence interne à la doc est signalée en §1.3.

---

## 1. Error Tracking

### 1.1 Modèle : issue, empreinte, sources acceptées

**Ce qu'est une issue [DOC].** « An issue is a group of similar errors related to the same bug. Datadog creates issues by computing a fingerprint for each error using some of its attributes such as the error type, the error message, or the stack trace. » (`raw/error_tracking_explorer.md`, §Overview).

**Règle de regroupement par défaut [DOC]** (`raw/error_tracking_error_grouping.md`, l.15-22) — quatre propriétés :

- `service` : le service où l'erreur a eu lieu ;
- `error.type` ou `error.kind` : la classe de l'erreur ;
- `error.message` ;
- `error.stack` : « The filename and function name of the top-most meaningful stack frame ».

Règles associées, écrites telles quelles : si une propriété de frame diffère, deux erreurs vont dans deux issues ; jamais de regroupement entre services ni entre types ; « Error Tracking also ignores numbers, punctuation, and anything that is between quotes or parentheses: only word-like tokens are used » ; Datadog retire des frames les « versions, ids, dates ». Conseil donné : mettre les variables des messages entre guillemets ou parenthèses.

**Regroupement personnalisé [DOC]** (l.37 et l.306) : attribut `error.fingerprint` (chaîne libre), prioritaire sur la stratégie par défaut, applicable à un sous-ensemble ; même `service` + même `error.fingerprint` = même issue ; services différents = issues différentes. Navigateur : SDK ≥ v4.42.0, soit `error.dd_fingerprint = '…'` sur l'objet `Error`, soit `event.error.fingerprint` dans `beforeSend`.

**Sources d'erreur navigateur [DOC]** (`raw/error_tracking_frontend_collecting_browser_errors.md`, l.28-32 et l.93) : `agent` (exécution du SDK), `console` (`console.error()`), `custom` (`addError`), `report` (`ReportingObserver`), `source` (exceptions et rejets de promesse non gérés). Error Tracking ne traite que `custom`, `source`, `report`, `console` **avec une stack trace** ; `network` et les erreurs venant d'extensions navigateur ne sont pas traitées. `error.handling` : « RUM errors are `unhandled` if they are not captured manually in the code » (`raw/error_tracking_explorer.md`, table des facettes).

**Attributs d'erreur [DOC]** (`raw/…data_collected.md`, §Error attributes) : `error.source`, `error.type`, `error.message`, `error.stack`, `error.causes` (liste optionnelle d'erreurs-causes, affichées séparément). `error.file`, `error.is_crash`, `error.category`, `error.handling` existent comme variables de notification de monitor (`raw/monitors_types_error_tracking.md`, l.137-143) ; leur définition côté navigateur n'est pas documentée sur ces pages.

**Effets d'une erreur collectée [DOC]** (`collecting_browser_errors.md`, l.15-21) : événement Error dans RUM, rétention de session si un filtre de rétention cible les erreurs, mise à jour des métriques `rum.measure.error`, `rum.measure.session.error`, `rum.measure.view.error_free`. Les règles Error Tracking et les statuts Ignored/Excluded **ne suppriment pas** les événements Error de RUM ; seul `beforeSend` le fait.

### 1.2 Explorer des issues

**Accès [DOC]** : « Digital Experience > Error Tracking » (`raw/real_user_monitoring_error_tracking.md`). [CAPTURE] `newerrortrackingimage.png` : titre « Error Tracking », sélecteur « Web and Mobile Apps », entrée « Muted », champ « Search facets », compteur « Showing 181 of 181 », en-tête de liste « ISSUES ».

**Ce que montre chaque ligne [DOC]** (`raw/error_tracking_explorer.md`, §Explore your issues) :

- le type et le message de l'erreur ;
- le chemin du fichier où les erreurs sont levées ;
- première et dernière occurrence ;
- graphique d'occurrences dans le temps ;
- nombre d'occurrences sur la période.

[CAPTURE] Sur `newerrortrackingimage.png`, une ligne = icône de source (JS), `ReferenceError`, message tronqué, « last seen 4 minutes ago », badge de statut « OPEN » avec menu. Les colonnes exactes (en-têtes) : **non établi** — la doc parle de « items », pas de colonnes, et la capture montre une liste de cartes, pas un tableau.

**Badges d'issue [DOC]** (l.32-35) :

- `New` : première occurrence **il y a moins de deux jours** ET statut FOR REVIEW ;
- `Regression` : issue RESOLVED réapparue dans une version plus récente (règle §1.3) ;
- `Crash` : l'application a planté (critère navigateur : **non établi** ; c'est un concept mobile) ;
- indicateur de « Suspected Cause » (§1.5).

**Plage temporelle [DOC]** : timeline en haut à droite, plages prédéfinies, affiche les issues ayant des occurrences dans la fenêtre. [CAPTURE] : « 2w · Past 2 Weeks ».

**Tris [DOC]** (l.49-52), libellés exacts et règle :

| Libellé | Règle documentée |
| --- | --- |
| Relevance | combine plusieurs signaux « to prioritize code related, recent, or spiking issues » : âge de l'issue, occurrences sur le dernier jour, hausse notable sur la dernière heure, crash |
| Count | total des occurrences sur la plage |
| Newest | date de première occurrence |
| Impacted Sessions | nombre de sessions RUM impactées |

Aucun poids ni formule de « Relevance » n'est publié : **non établi**.

**Facettes [DOC]** : indexées automatiquement, « displays all the distinct members of an attribute for the selected time period and provides some basic analytics, such as the number of issues represented ». Facettes citées : `error.message`, `error.type`, `error.stack`, `error.handling`. Icône « Edit » (crayon) pour masquer/afficher. [CAPTURE] groupes visibles : CORE (Service, Browser SDK Version, Env, SDK Version, Session Plan, Source, Variant, Version), APPLICATION (Application Id), BROWSER (Browser Name).

**Filtres de niveau issue [DOC]** (§Issue level filters) : **Sources** (All, Browser, Mobile, Backend ; affinable par source de logs, SDK, langage) ; **Fix available** (issues avec correctif généré par IA — le contenu de ce correctif n'est pas documenté) ; **Teams filters** (propriété d'équipe, §1.5) ; **Assigned to** ; **Suspected Cause**.

**Export vers monitor [DOC]** : la requête de l'explorer s'exporte directement en monitor Error Tracking (§1.6).

### 1.3 Statuts d'issue et transitions

**Cinq statuts [DOC]** (`raw/error_tracking_issue_states.md`, l.15-19), libellés et définitions exactes :

| Statut | Définition documentée |
| --- | --- |
| FOR REVIEW | « New or regressed issues that need attention. » |
| REVIEWED | « Triaged issues that need to be fixed, now or later. » |
| RESOLVED | « Issues that have been fixed and are no longer occurring. » |
| IGNORED | « Issues that require no further investigation or action. » |
| EXCLUDED | « Issues that require no further investigation, stops collecting new errors, and no longer count towards usage or billing » |

Toute issue naît en FOR REVIEW. Le statut se change à la main par le menu déroulant, partout où l'issue s'affiche (liste et panneau).

**Transitions automatiques [DOC]** :

- → REVIEWED (l.35-36) : « The issue has been assigned » ou « A work item has been created from the issue ».
- → RESOLVED (l.46-47) : (a) avec `version` : dernière occurrence dans une version de plus de 14 jours **et** une version plus récente a été publiée sans reproduire l'erreur ; (b) sans `version` : aucune nouvelle erreur depuis 14 jours.
- → FOR REVIEW + badge `Regression` (`raw/error_tracking_regression_detection.md`, l.19 et l.27) : une issue RESOLVED réapparaît « in a newer version of the code, or the error occurs again in code without versions ». « Regressions take into account the versions of your service where the error is known to occur, and only trigger on new versions after an issue is marked as RESOLVED. » Sans tag de version : toute réoccurrence d'une issue RESOLVED est une régression. L'ordre des versions (semver ? lexicographique ?) : **non établi**.

**Divergence interne à la doc à signaler** : la même page écrit d'abord la règle (a) qui dépend de `version`, puis l.49 : « **Note**: The auto-resolution logic does not take `version` into account. » Les deux phrases se contredisent ; à ne pas reproduire sans choisir.

**EXCLUDED [DOC]** (l.67) : arrête la collecte et la facturation ; « Excluded issues are still accessible in the IGNORED tab » ; reprendre la collecte = choisir un autre statut. Rappel §1.1 : RUM continue d'enregistrer les événements Error.

**Historique [DOC]** (l.77) : onglet « Activity » du panneau → « Activity Timeline » des changements de statut.

**Effet sur les monitors [DOC]** (`raw/monitors_types_error_tracking.md`, l.153) : les issues IGNORED sont « automatically muted from monitor notifications ».

[CAPTURE] La capture `newerrortrackingimage.png` montre un modèle plus ancien : statut « OPEN », bouton « Mute Issue », menu « Actions ». Le vocabulaire actuel de la doc (FOR REVIEW / REVIEWED / …) ne correspond pas à cette capture ; retenir la doc.

### 1.4 Panneau de détail d'une issue

**Partie haute [DOC]** (`raw/error_tracking_explorer.md`, l.115) : « first and last occurrence dates, total count, as well as the count over time for the given issue ». [CAPTURE] Libellés visibles : bandeau « ISSUE · shopist-web-ui · Error: Error generating recommendation », boutons « OPEN ▾ », « Mute Issue », « Actions ▾ », « Open Full Page » ; bloc « WHAT HAPPENED » avec « The last version impacted was 32bec16 · 2 minutes ago » et « The first version impacted was f1c84eb · 11 months ago » ; barre de recherche interne au panneau ; phrase « There were **13.4k errors** over the past **14 days** affecting **13.1k sessions** » ; histogramme à barres des occurrences par jour ; lien « Latest error » / « See all errors ».

**Partie basse [DOC]** (l.123) : navigation entre « error samples » ; chaque échantillon donne « the stack trace of the error, and the characteristics of impacted users ». Le contenu « varies depending on the error source » (APM : tags de span, accès trace/logs). [CAPTURE] Section « Error Stack » (« Here is the latest stack trace within your filters and selected time period. »), ligne « ERROR · Sep 13 10:59:33.058 (2 minutes ago) », boutons « Jump to Replay » et « View in RUM », onglets « Parsed | Raw » puis « Unminified | Minified ».

**Ventilation par dimension** : la doc ne liste pas de dimensions (version, navigateur, OS, pays, URL) pour le panneau. [CAPTURE] Colonne droite : « Here is the distribution of Views impacted by this issue for each tag. See all tags », onglets « Outliers | Distribution », sections « VIEW NAME » (ex. `/department/bedding/product/?` · « 2.57% of Views ») et « BROWSER NAME » (« Chrome Mobile · 3.30% of Views »), « 1 more hidden ». [DÉDUIT] la mesure est une part de vues impactées par valeur de tag, avec un mode « Outliers » (valeurs surreprésentées) et un mode « Distribution » (toutes valeurs). La liste des tags disponibles : **non établi**.

**Stack symbolisée [DOC]** (`raw/error_tracking_frontend_browser.md`, Step 5 et 7) : upload des source maps (« unminified stack traces »), symboles WebAssembly via plugin, lien de chaque frame vers GitHub/GitLab/Bitbucket (CLI ≥ 0.12.0) ; correspondance par `service` + `version` identiques à l'upload. Le mot « Script error. » signale une erreur cross-origin sans détail (`collecting_browser_errors.md`, §Troubleshooting).

**Suspect commit [DOC]** (`raw/error_tracking_suspect_commits.md`, l.31-34) : un commit est suspect s'il modifie une ligne de la stack, est antérieur à la première occurrence, de **90 jours au plus**, et est le plus récent de ces candidats ; bouton « View Commit ». Requiert Source Code Integration + intégration GitHub.

**Assignation [DOC]** : « Assigned to » (filtre) ; « Auto Assign » assigne à l'auteur du suspect commit et notifie (`raw/error_tracking_auto_assign.md`, l.13-35) ; réassignation manuelle possible. Propriété d'équipe (`raw/error_tracking_issue_team_ownership.md`, l.17-20, 26, 55, 108) : trois sources par priorité — attribut `team` sur l'événement (immuable ensuite), `CODEOWNERS` GitHub sur la frame la plus haute du dépôt (immuable), propriété de service (dynamique, non retirable) ; boutons « Add team », « Unlink team from issue ». Uniquement GitHub pour CODEOWNERS.

**Tickets [DOC]** (`raw/error_tracking_ticketing_systems.md`, l.17-19) : créer un ticket Jira / Linear / Work Management depuis le panneau ; rattacher plusieurs issues à un même ticket ; règles de création automatique.

**Sessions et replays liés [DOC]** : « Issues from RUM errors include the stack trace, user session timelines, and metadata—including user location, version, and any custom attributes » (`raw/real_user_monitoring_error_tracking.md`). « Error Tracking Replay Snippets » (`raw/error_tracking_frontend_replay_errors.md`, l.16-36, en Preview) : « pixel-perfect recreation of a user's journey **15 seconds before and after** an error occurred » ; aperçu du replay sous la stack ; `sessionReplaySampleRate` entre 1 et 100 requis.

**Commentaires sur une issue** : **non établi** (aucune page ne décrit de commentaires sur une issue ; les commentaires documentés sont ceux des replays, §2.4). Le panneau a un onglet « Activity » (historique de statut).

**Suspected Cause [DOC]** (`raw/error_tracking_suspected_causes.md`, l.17-21) : étiquette attribuée à la création parmi « Code Exception », « Failed Request », « Illegal Object Access », « Invalid Argument », « Network » ; modifiable à la main ; page titrée « Suspected Causes in backend Error Tracking » — l'application aux issues navigateur : **non établi**.

### 1.5 Monitors Error Tracking

**Deux conditions d'alerte [DOC]** (`raw/monitors_types_error_tracking.md`, l.31-32) :

| Libellé | Définition |
| --- | --- |
| New Issue | « Alert when an issue occurs for the first time or a regression occurs. » Exemple donné : « more than 2 users are impacted by a new error » |
| High Impact | « Alert on issues with a high number of impacted end users. » Exemple : « more than 500 users » |

Règles : New Issue ne considère que les issues FOR REVIEW créées ou régressées **après** la création/édition du monitor, avec un **lookback de 24 h** (l.44) ; High Impact considère FOR REVIEW et REVIEWED. Il n'existe **pas** de type « Regression » ni « Spike » séparé : la régression est couverte par New Issue (repasse en FOR REVIEW) ; « spike » n'apparaît que dans le tri Relevance. Une alerte de pic : **non établi**.

**Mesures [DOC]** (l.60-62) : « Error Occurrences » (compte d'erreurs `above` seuil), « Impacted Users » (nombre d'e-mails utilisateur distincts), « Impacted Sessions » (nombre d'IDs de session distincts), ou mesure personnalisée (compte de valeurs distinctes d'une facette). Sources All/Backend : Error Occurrences seulement. Fenêtre : « last day » par défaut ; seuil par défaut **0** (déclenche à la première occurrence, l.72) ; multi-alert par issue recommandé. Requête programmatique (l.86, l.126) : `error-tracking("{filter}").source("browser").new().rollup("count").by("@issue.id").last("1d") > 0` (`.impact()` pour High Impact). Variables de notification : `issue.attributes.error.{type,message,stack,file,is_crash,category,handling}`. Limite : 1000 monitors par compte (l.22). Bruit : la doc déconseille `issue.age` / `issue.regression.age`, et recommande triage, fenêtre plus large, seuil > 0.

### 1.6 Contrôle de la collecte

[DOC] `raw/error_tracking_manage_data_collection.md` (l.28-33, 87, 117, 138) : règles ordonnées avec un filtre d'inclusion (requête) et des filtres d'exclusion imbriqués ; évaluation s'arrête à la première règle active qui correspond ; règle par défaut `*` sans exclusion ; « Rate Limits » en `errors/day`, événement « Rate limit applied » ; « Dynamic Sampling » activé par défaut, échantillonne une issue dont le débit dépasse un seuil dérivé du quota journalier et de l'historique, événement « Dynamic Sampling activated ».

### 1.7 Ce que chaque écran d'Error Tracking permet de conclure

| Écran / élément | Permet de conclure | Ne permet pas de conclure |
| --- | --- | --- |
| Liste triée « Relevance » | quelles issues méritent l'attention selon Datadog | pourquoi (formule non publiée) |
| Badge `New` | l'issue a moins de 2 jours et n'a pas été triée | qu'elle est nouvelle dans **cet** environnement (la doc des monitors cite ce piège staging → prod) |
| Badge `Regression` | une issue résolue a réapparu (dans une version plus récente si versionné) | que la correction était fausse : sans `version`, toute réoccurrence compte |
| Tri « Impacted Sessions » | volume de sessions touchées | nombre d'utilisateurs (mesure séparée, par e-mail) |
| Partie haute du panneau | première/dernière occurrence, total, tendance | cause |
| « Outliers » par tag [CAPTURE] | quelles valeurs de tag sont surreprésentées | qu'elles causent l'erreur |
| Stack « Unminified » | ligne de code d'origine, si la map de la même `version` a été téléversée | l'état des variables (Exception Replay est APM, pas navigateur) |
| Suspect commit | le commit le plus récent (≤ 90 j) ayant touché une ligne de la stack | qu'il est fautif |
| Replay snippet | ce que l'utilisateur a fait ±15 s autour de l'erreur | reproduction garantie : dépend de l'échantillonnage replay |
| Statut EXCLUDED | arrêt de collecte et de facturation Error Tracking | disparition des événements Error côté RUM |

---

## 2. Session Replay

### 2.1 Enregistreur navigateur

[DOC] `raw/real_user_monitoring_session_replay.md` (l.24-36) : snapshot du DOM et du CSS, puis enregistrement horodaté des « DOM modification, mouse move, click, and input events » ; reconstruction en rejouant les événements ; basé sur **rrweb** (SDK open source) ; compression avant envoi, travail lourd dans un web worker ; « expected network bandwidth impact is less than 100kB/min ».

**Échantillonnage [DOC]** (`raw/session_replay_setup_and_configuration.md`, l.24-26, 70, 645-703 ; `raw/…sampling-browser-plans.md`, l.23, 34, 159) : `sessionReplaySampleRate` entre 0.0 et 100.0, appliqué **après** `sessionSampleRate` (exemple doc : 60 % × 50 % → 40 % de sessions non collectées, 30 % RUM seul, 30 % RUM + replay) ; défaut **0** depuis SDK v5.0.0 (100 avant) ; avant v5 il fallait appeler `startSessionReplayRecording()` ; `startSessionReplayRecordingManually: true` puis `startSessionReplayRecording()` pour démarrer à un moment choisi ; possibilité de forcer l'enregistrement d'une session échantillonnée hors replay (l.703).

**Non capturé [DOC]** (`raw/…browser_troubleshooting.md`, l.24-46) : éléments `iframe`, `video`, `audio`, `canvas` (iframes instrumentables séparément, `trackSessionAcrossSubdomains: true`, rendues comme pages distinctes de la même session) ; Web Animations API ; HTTPS obligatoire ; polices et images dépendent des ressources d'origine (CORS vers `session-replay-datadoghq.com`) ; CSS embarqué via `CSSStyleSheet` sinon lien, `crossorigin="anonymous"` requis pour le hover. Le replay « is not a video, but an actual iframe rebuilt based on snapshots of the DOM ».

**Rétention [DOC]** (l.199-207) : 30 jours ; « Extended Retention » à 15 mois par replay, uniquement sur sessions non actives, compté depuis l'activation, n'inclut pas les événements associés ; désactivation → expiration à la fin des 30 jours ou immédiate si déjà au-delà. Une session se termine « after 4 hours of activity or 15 minutes of inactivity » (`raw/…data_collected.md`, l.59). Événements RUM : Session/View/Action/Error 30 jours, Resource/Long Task 15 jours (`raw/…explorer_search.md`, l.23-28).

### 2.2 Lecteur et timeline annotée

Ce que la doc décrit du lecteur (aucune page « player » dédiée n'existe) :

- **Accès [DOC]** : bouton « Replay » dans le panneau d'événement du RUM Explorer (`raw/…explorer_events.md`, l.78 : « Replay — Watch a visual replay of the user's session ») ; [CAPTURE] bouton « Jump to Replay » en haut à droite du panneau VIEW (`triage/f_002.png`) et dans le panneau d'issue (`newerrortrackingimage.png`) ; filtre « Session Replay available » dans l'explorer (`triage/f_001.png`).
- **User Journey [DOC]** : « A session replay's user journey details the events that occur in chronological order. Hover over an event to move to that point in time in the replay: for example, when a dead click occurred. » (`raw/…frustration_signals.md`, §Watch frustration signals). Résultat de recherche docs : « event timeline on the right side of the page », clic sur un événement pour s'y rendre.
- **Smart chapters [DOC]** (l.163-169) : segmentation automatique de la timeline en étapes nommées (ex. « Browse lighting », « Review cart and checkout »), visibles au survol de la timeline et dans un menu des contrôles ; générées seulement si **≥ 4 actions utilisateur et ≥ 45 s**. **Summaries** : intention, actions clés, signaux de friction, issue de la session, avec liens vers les instants ; aperçu au survol dans la liste.
- **Commentaires [DOC]** (l.183-190) : commentaire à un horodatage, marqueurs sur la timeline et onglet « Comments », `@mention` avec e-mail, lien partageable ouvrant le replay à l'instant, fils, édition/suppression.
- **Historique de lecture [DOC]** (l.221-227) : compteur « watched » sur la page du lecteur ; événement Audit Trail ; playlist « My Watch History ».
- Boutons documentés : « Share » (l'entrée « Save to Playlist » y est), « </> Dev Tools » à droite de Share (`raw/session_replay_dev_tools.md`, l.17).
- Contrôles de lecture (vitesse, saut d'inactivité, plein écran) : **non établi**.

### 2.3 Dev Tools (panneau intégré au lecteur)

[DOC] `raw/session_replay_dev_tools.md` (l.13-50). Disponible « only for RUM sessions that have been retained », sans configuration. Quatre onglets :

| Onglet | Contenu documenté |
| --- | --- |
| Performance | « waterfall of events (such as actions, errors, resources, and long tasks) and timestamps » ; filtres « Action Name », « Resource Type » ; curseurs pour élargir la plage |
| Console | logs du navigateur et erreurs par vue ; filtres « Error », « Warn », « Info », « Debug » ; « View in Log Explorer » |
| Errors | erreurs RUM et issues Error Tracking corrélées à la session |
| Attributes | tous les attributs de la session |

Il n'y a pas d'onglet « Network » séparé ; le réseau est dans la waterfall Performance.

### 2.4 Panneau d'attributs et panneau d'événement (RUM Explorer)

[DOC] `raw/…explorer_events.md` (l.29-110) : en-tête avec contexte (environnement, pays, chemin de vue, type de chargement) ; visualisation de distribution « whether the current view is close to the median or is an outlier », sélecteur Loading Time / TTFB / FCP / LCP / CLS / INP / Refresh Rate / Memory Average ; onglet **Waterfall** avec repères Core Web Vitals « pass or fail », bascule « Critical Events », filtres par attribut, minimap temporelle, survol donnant durée et facteurs (« scripts, style/layout, or other processing »), comparaison au p75 ; onglets « Replay », « Errors », « Resources », « Traces », « Feature Flags », « Actions », « Logs », « Attributes » ; boutons « Previous » / « Next » entre sessions d'un même `@usr.id` (sessions non retenues sautées, sans indication). [CAPTURE] `triage/f_002…f_005.png` : onglets « Performance | Replay | Errors | Resources 25 | Traces 1 | Feature Flags 3 | Actions 1 | Logs 4 | Attributes », tuiles « LARGEST CONTENTFUL PAINT 132.5 ms » / « CUMULATIVE LAYOUT SHIFT 0 », « First Contentful Paint », « Loading Time », « Expand Waterfall », filtres « Network | Events | Timings », popover CLS avec échelle « GOOD · NEEDS IMPROVEMENT · POOR », « Most shifted element », « Compared to p75 performance » ; onglet Traces = flame graph avec « View Trace in APM ». [CAPTURE] `datadog-rum-views-explorer.png` (2019) : onglet Attributes = JSON déplié avec menu « Search for / Exclude / Add column for @session_id ».

### 2.5 Heatmaps

[DOC] `raw/session_replay_heatmaps.md`. Navigateur uniquement. Trois types (l.28-30) :

| Libellé | Définition |
| --- | --- |
| Click maps | clics agrégés « as blobs on the map » ; à gauche, « list of all actions that occurred on the page, listed by frequency » ; une action ouvre son nombre d'occurrences, sa place dans le classement, ses signaux de frustration ; bouton « Start a Funnel » (l.97-108) |
| Top Elements | classement « up to the top 10 most interacted-with elements » ; numéro sur la carte ↔ nom d'action dans le panneau ; survol pour surligner |
| Scroll maps | profondeur de défilement ; « average fold » = point le plus bas visible sans défiler ; barre bleue déplaçable ; panneau d'insights avec liens vers des requêtes (ex. vues ayant dépassé un percentile) ; minimap + « distribution graph » pour repérer le plus gros décrochage (l.116-122) |

Prérequis (l.43-46) : SDK ≥ v4.40.0 (click), ≥ v4.50.0 (scroll), Session Replay activé, `trackUserInteractions: true`. Sélecteurs : « View Name », « Application », « Device type », « Filter actions by », « Add Filter ». Construction : **overlay** (actions RUM, 30 j) + **background screenshot** (replay, 30 j par défaut) — les deux sont nécessaires, sinon état « No Replay Data » (l.214-218, 253) ; état « Not enough data to generate a heatmap » si SDK < 4.20.0 ou page très changée (l.259-263). Capture d'écran de fond : « Change Screenshot » → « Existing screenshots » / « Take new screenshot » (extension Chrome « Datadog Test Recorder », choix d'un niveau de masquage) / « Grab from replay » ; « Save » / « Unpin » ; plusieurs captures par vue. Les heatmaps sont indexées par **nom de vue** ; un élément fréquent absent de la capture est signalé « element is not visible ».

### 2.6 Playlists

[DOC] `raw/session_replay_playlists.md` (l.23-92) : création depuis « Digital Experience > Session Replay > Playlists » (« New Playlist », nom + description) ou depuis un replay (« Share » → « Save to Playlist »). Trois playlists par défaut : « My Watch History », « All mentions to me », « Commented replays ». Seules les sessions terminées sont acceptées ; requête donnée : `@session.is_active:false @session.type:user @session.has_replay:true`. Permissions : « playlist write », « Session Replay read ». Ajouter à une playlist **prolonge automatiquement la rétention** du replay (jusqu'à 15 mois, révocable). Limite de taille : **non établi**.

### 2.7 Confidentialité (mask / mask-user-input / allow / hidden)

[DOC] `raw/session_replay_privacy_options.md` (l.30-151, 1587) :

| `defaultPrivacyLevel` | Effet documenté |
| --- | --- |
| `mask` (défaut si non spécifié, l.43) | masque « all HTML text, user input, images, links and `data-*` attributes » ; texte remplacé par `X` (page en fil de fer) |
| `mask-user-input` | masque « most form fields such as inputs, text areas, and checkbox values » ; inputs → `***`, textareas → `x` en conservant les espaces ; le reste du texte est lisible |
| `allow` | « Records everything unmasked. » |

Disponible en SDK ≥ v3.6.0. Surcharge par élément : attribut `data-dd-privacy="allow" | "mask" | "hidden" | "mask-user-input"` ou classe `dd-privacy-allow | dd-privacy-mask-user-input | dd-privacy-mask | dd-privacy-hidden`. `hidden` : bloc gris à l'enregistrement, placeholder « Hidden » à la lecture, sous-éléments non enregistrés. **Toujours masqués** quel que soit le réglage : inputs `password`, `email`, `tel` ; éléments avec `autocomplete` (carte, expiration, code). Noms d'action : `data-dd-action-name` pour renommer ; `enablePrivacyForActionName` → « Masked Element » sauf nom explicite. « Session Replay masking is permanent and cannot be reversed later » ; « Masked data is not stored on Datadog servers ». Stratégies de texte (l.1583-1598, table écrite pour mobile mais nommée pour les trois modes) : « No mask », « Space-preserving mask » (`xxxxx xxxxx`), « Fixed-length mask » (`***`).

### 2.8 Ce que chaque écran de Session Replay permet de conclure

| Écran / élément | Permet de conclure | Ne permet pas de conclure |
| --- | --- | --- |
| Replay | l'enchaînement visible d'actions, en fil de fer si `mask` | le rendu exact : iframe, vidéo, canvas, animations absents ; polices/images dépendent des origines |
| User Journey + icônes de frustration | à quel instant un rage/dead/error click a eu lieu | pourquoi l'élément n'a pas répondu |
| Smart chapters / summary | le découpage en étapes d'une session assez longue (≥ 4 actions, ≥ 45 s) | quoi que ce soit sur les sessions courtes |
| Dev Tools › Performance | ordre et durées des actions, erreurs, ressources, long tasks | ce qui s'est passé avant l'init du SDK |
| Dev Tools › Errors | quelles issues Error Tracking touchent cette session | l'impact global de l'issue |
| Click map | où les utilisateurs cliquent sur **cette capture de fond** | la validité sur une mise en page qui a changé (la doc l'écrit) |
| Scroll map | quelle part atteint une profondeur ; où est le pli moyen | la lecture réelle du contenu |
| Compteur « watched » | qui a ouvert le replay dans le lecteur | les vues par vignette (exclues) |
| Playlist | un lot de replays conservés jusqu'à 15 mois | les événements associés (non prolongés) |

---

## 3. Frustration signals

### 3.1 Définitions documentées

[DOC] `raw/real_user_monitoring_browser_frustration_signals.md` (l.29-45) :

| Libellé | Définition (page Frustration Signals) | Variante (page RUM Usage Dashboard, l.60-62) |
| --- | --- | --- |
| Rage Clicks | « A user clicks on an element more than three times in a one-second sliding window. » | « clicks the same button more than 3 times in a 1 second sliding window » |
| Dead Clicks | « A user clicks on a static element that produces no action on the page. » | identique |
| Error Clicks | « A user clicks on an element right before a JavaScript error occurs. » | « clicks an element and encounters a JavaScript error » |

Prérequis : SDK ≥ 4.14.0 ; `trackUserInteractions: true` (v5+) ; avant v5, `trackFrustrations: true` (qui active `trackUserInteractions`). Les trois types sont collectés ensemble ; pas de sélection documentée par type côté init.

Les définitions documentées ne chiffrent ni la « fenêtre d'inaction » du dead click, ni la proximité temporelle de l'error click, ni la distance spatiale du rage click.

### 3.2 Règles exactes lues dans le code source du SDK [CODE SDK]

Fichiers `raw/sdk_*.ts` (copie de `packages/browser-rum-core/src/domain/action/` et `…/domain/waitPageActivityEnd.ts`, branche `main`, 18/09/2026). Ces règles ne sont pas documentées ; Datadog peut les changer.

**Chaîne de clics** (`sdk_clickChain.ts`, l.12-13 et `areClicksSimilar`) : deux clics sont « similaires » si même `event.target`, distance euclidienne ≤ **100 px** (`MAX_DISTANCE_BETWEEN_CLICKS`), écart ≤ **1 s** (`MAX_DURATION_BETWEEN_CLICKS = ONE_SECOND`) et même politique d'exclusion. Un clic non similaire clôt la chaîne. La chaîne se finalise quand tous ses clics sont arrêtés.

**Rage click** (`sdk_computeFrustration.ts`, l.6, 38-56) : `MIN_CLICKS_PER_SECOND_TO_CONSIDER_RAGE = 3` ; la chaîne est « rage » s'il existe trois clics consécutifs dont le premier et le troisième sont séparés de ≤ 1 s (fenêtre glissante). Donc **3 clics en 1 s suffisent** — la doc dit « more than three ». Exclusions : un clic avec sélection de texte ou scroll dans la chaîne annule le rage ; attribut d'exclusion (ci-dessous). En cas de rage, **une seule action** est émise (le clic initiateur cloné), les autres clics sont écartés ; cette action porte aussi `dead_click` si un des clics était mort, et `error_click` si le clic initiateur porte une erreur (l.9-20). Le doc « Tracking User Actions » confirme : plusieurs clics de suite sur le même élément = une seule action (`raw/browser_tracking_user_actions.md`, §Track user interactions).

**Dead click** (`isDead`, l.59-91) : un clic est mort si **aucune activité de page** n'est validée, **et** aucune saisie (`input`) ni scroll, **et** la cible ne correspond pas au sélecteur d'exclusion `DEAD_CLICK_EXCLUDE_SELECTOR` : inputs textuels (tout `input` sauf checkbox/radio/button/submit/reset/range), `textarea`, `select`, `[contenteditable]` et descendants, `canvas`, `a[href]` et descendants. Un `label[for]` est remplacé par l'élément ciblé. Les clics d'une double/triple sélection ne sont pas morts (`hasSelectionChanged`, l.21-29). Un clic sur un élément `hidden` (privacy) n'est pas suivi du tout (`sdk_trackClickActions.ts`, `processPointerDown`).

**Activité de page** (`sdk_waitPageActivityEnd.ts`, l.14-16 et `createPageActivityObservable`) : `PAGE_ACTIVITY_VALIDATION_DELAY = 100` ms pour qu'une activité apparaisse, sinon « no activity » ; `PAGE_ACTIVITY_END_DELAY = 100` ms sans activité pour clore ; activité = mutation DOM (sauf éléments `data-dd-excluded-activity-mutations`), `window.open`, entrée Performance de type resource, requête xhr/fetch démarrée ou terminée (sauf `excludedActivityUrls`). Une pré-mesure est aussi lancée au `pointerdown` (`hadActivityOnPointerDown`) : une activité déclenchée au pointer-down mais avant le clic compte comme activité (durée 0). **Ce seuil de 100 ms est aussi documenté** pour le loading time : « The page activity is considered to have ended when it hasn't had any activity for 100ms. » (`raw/browser_monitoring_page_performance.md`, l.179-183, 194, 212) [DOC].

**Error click** (`Click.hasError`, `sdk_trackClickActions.ts`) : le clic porte `error_click` si le compteur d'erreurs de l'action (`counts.errorCount`) est > 0 — c'est-à-dire une erreur RUM survenue pendant la durée de l'action, bornée par `CLICK_ACTION_MAX_DURATION = 10 s` (`interactionSelectorCache.ts`) ou la fin de la vue. Le « right before » de la doc est donc en pratique « pendant l'action qui suit le clic ».

**Désactivation par élément** (`sdk_frustrationIgnore.ts`, l.3-9) : attribut `data-dd-ignore-frustration` sur l'élément ou un ancêtre, valeurs `all` (ou vide), `rage-click`, `dead-click`, `error-click`, combinables par espaces. Non trouvé dans les pages consultées : [CODE SDK] uniquement.

### 3.3 Attributs et champs

[DOC] `raw/…data_collected.md` (l.206-210) : `session.frustration.count`, `view.frustration.count`, `action.frustration.type` ∈ {`dead_click`, `rage_click`, `error_click`}. Recherche (`frustration_signals.md`, §Search) : `action.frustration.type:rage_click`, `session.frustration.count:>1`, `view.frustration.count:>1` (la doc écrit `>1` pour « au moins un » — à lire comme `>=1`, **[DÉDUIT]**). Attributs d'action liés : `action.loading_time` (ns), `action.error.count`, `action.long_task.count`, `action.resource.count`, `action.name`, `action.target.name`, `action.type` (`click` ou `custom`).

### 3.4 Où et comment ils s'affichent

[DOC] `raw/…frustration_signals.md` (l.84-148) :

- page « RUM Applications » : « high-level datapoints » ; lien « Frustrated Sessions » ;
- RUM Explorer : bouton « Options » → colonne `@session.frustration.count` ; [CAPTURE] `triage/f_001.png` montre un tableau Sessions avec colonnes « DATE · SESSION TYPE · TIME SPENT · VIEW COUNT · ERROR COUNT · ACTION COUNT · FRUSTRATION COUNT · INITIAL VIEW NAME · LAST VIEW NAME » et un bandeau « Watchdog Insights » ;
- panneau Session : type de signal (`rage click`, `dead click`, `error click`) + timeline d'événements ;
- panneau View : tag « frustration detected » ; la waterfall de performance affiche les actions porteuses de signal ;
- onglet Actions : tag « frustration detected » ; plusieurs signaux sur une action listés sous « What Happened » ;
- onglet Errors : le panneau d'erreur indique si un signal a eu lieu ;
- Session Replay : icônes dans le user journey, survol → saut à l'instant ;
- dashboard « RUM Frustration Signals » (`dashboards_usage.md`, §Frustration signals) : « most frustrated users and pages with the highest number of frustration signals » ; clonable. Widgets exacts : **non établi** (seule une image est publiée) ;
- Heatmap Click map : signaux affichés sur l'action sélectionnée (§2.5) ;
- Funnels (`raw/…explorer_visualize.md`, l.138-148) : « Funnel Insights » compare « the average frustration count » à la conversion, et un graphique conversion/abandon par pays ;
- Monitors RUM : alerte sur le compte de signaux sur une page (image seulement).

**Limites [DOC]** (l.186-190) : « generated from mouse clicks, not keyboard strokes » ; sur une session « live », les bannières et la timeline peuvent différer.

### 3.5 Ce que les signaux permettent de conclure

| Signal | Conclure | Ne pas conclure |
| --- | --- | --- |
| Rage click | trois clics rapprochés sur la même cible (≤ 100 px, ≤ 1 s) sans sélection ni scroll | que l'interface ne répondait pas : un bouton « + quantité » cliqué trois fois est un rage click |
| Dead click | aucune mutation DOM, requête, ressource ni ouverture de fenêtre dans les 100 ms | que l'élément est inerte : une action différée > 100 ms, une animation CSS pure, un `canvas` (exclu) passent au travers |
| Error click | une erreur RUM pendant l'action (≤ 10 s) | causalité clic → erreur |
| `session.frustration.count` | nombre de signaux, toutes causes | gravité ; un rage sur un carrousel et un dead sur « Payer » comptent pareil |

---

## 4. Synthèse documenté / déduit / non établi

| Sujet | Statut |
| --- | --- |
| 4 tris de l'explorer, 5 statuts, badges New/Regression/Crash, 5 filtres d'issue | [DOC] |
| Colonnes du tableau d'issues | non établi (liste de cartes en capture) |
| Règle `New` (< 2 jours + FOR REVIEW), auto-resolve 14 j, auto-review (assignation, work item) | [DOC] ; contradiction interne sur la prise en compte de `version` |
| Définition de régression | [DOC] ; ordre des versions non établi |
| Dimensions du breakdown du panneau (version/browser/OS/pays/URL) | [CAPTURE] View Name, Browser Name, « See all tags » ; liste complète non établie |
| Commentaires d'issue | non établi ; « Activity » documenté |
| Monitors « new-issue / high-impact » | [DOC] ; « regression » = via New Issue ; « spike » non établi |
| Replay : recorder, sampling, rétention, privacy, playlists, heatmaps, dev tools | [DOC] |
| Contrôles du lecteur (vitesse, skip) | non établi |
| Seuils rage 3/1 s, dead 100 ms, distance 100 px, error ≤ 10 s, sélecteurs exclus | [CODE SDK] ; 100 ms d'activité aussi [DOC] |
| Widgets du dashboard Frustration Signals | non établi |

---

## 5. Où en est notre console (repères pour les recommandations)

Lu par graft, sans lecture intégrale :

- Statuts d'issue : `open`, `for_review`, `resolved`, `ignored` (`apps/console/lib/error-issues.ts:50`) avec libellés « Ouverte », « À revoir », « Résolue », « Ignorée » (l.56-61) ; bases de regroupement nommées (`override`, `symbolicated_frame`, `normalized_frame`, `low_confidence`, l.52).
- Liste d'issues : colonnes « Issue · Occurrences · Sessions · Visiteurs · Tendance · Première vue (depuis toujours) · Dernière vue » (`apps/console/components/errors/IssueList.tsx:220-228`) ; découpage par dimension partagé avec l'accueil (`apps/console/app/errors/page.tsx:64-85`).
- Stack : dé-minifiée à la lecture si une map existe, bascule « Stack brute (minifiée) », contexte de code pour l'admin (`apps/console/components/errors/ErrorStackCard.tsx:8-84`).
- Replay : lecteur positionné à l'instant d'une erreur (`apps/console/components/replay/ReplayPlayer.tsx:26`), onglets « Timeline | Replay » de la session (`apps/console/app/sessions/[id]/page.tsx:127-134`), timeline unifiée pageview/vital/action/error/breadcrumb/resource/longtask/event/api (`apps/console/lib/queries.ts:441-566`). SDK : cap 2 min et 1 Mo gzip par session (`packages/rum-sdk/src/replay.ts:9-10`), masquage par défaut.
- Frustration : `RAGE_MIN_CLICKS = 3`, `RAGE_WINDOW_MS = 1000`, `DEAD_CLICK_WINDOW_MS = 1500`, `FRUSTRATION_CAP_PER_PAGE = 20` (`packages/rum-sdk/src/frustration.ts:12-15`) ; requêtes `topFrustrations`, `inpOffenders`, `scriptsBloquants` (`apps/console/lib/queries-frustration.ts`).

Notre fenêtre de dead click (1 500 ms) est quinze fois celle de Datadog (100 ms) ; notre rage (3 clics / 1 s) coïncide avec le code Datadog, pas avec sa doc (« more than three »).

---

## 6. Dix capacités à reprendre telles quelles

1. **Les cinq statuts et leurs transitions automatiques** (FOR REVIEW → REVIEWED sur assignation ou ticket ; → RESOLVED après 14 jours sans occurrence ; → FOR REVIEW + `Regression` sur réoccurrence). Notre modèle a quatre statuts ; il manque « Reviewed » (trié, à corriger plus tard) et l'auto-résolution.
2. **Le badge `New` défini par une règle écrite** : < 2 jours et non trié. Une règle chiffrée vaut mieux qu'un « nouveau » implicite.
3. **Le tri « Impacted Sessions »** distinct de « Count » et de « Newest », et la mesure « Impacted Users » séparée (nos colonnes Sessions/Visiteurs existent déjà : en faire des tris).
4. **La phrase de synthèse du panneau** : « There were N errors over the past P affecting S sessions » — une phrase, trois nombres, la fenêtre nommée.
5. **La distinction Parsed/Raw et Unminified/Minified** dans la stack, avec la `version` de la map indiquée (nous l'avons : la garder telle quelle).
6. **Le lien « Jump to Replay » depuis l'erreur, positionné à l'instant** (Replay snippets ±15 s). Notre lecteur sait déjà se positionner ; reprendre la fenêtre ±15 s comme mode par défaut.
7. **Le « User Journey » à droite du lecteur, avec les signaux de frustration cliquables** qui déplacent la tête de lecture.
8. **Les Dev Tools en quatre onglets** (Performance en waterfall filtrable, Console par sévérité, Errors corrélées, Attributes) — notre timeline unifiée est le bon matériau, il manque l'ancrage à la lecture.
9. **Le monitor « New Issue » avec seuil 0 par défaut, lookback 24 h et mute automatique des issues Ignored** : une règle simple, et le triage qui coupe le bruit.
10. **Les heatmaps « Top Elements » (≤ 10, rang ↔ nom d'action)** et la Scroll map avec le pli moyen : deux visualisations qui se lisent sans légende.

## 7. Cinq points où faire mieux (plus honnête, plus lisible, moins de jargon)

1. **Dire ce qu'un dead click ne prouve pas.** Datadog affiche « frustration detected » sans rappeler que la règle est « rien dans les 100 ms ». Afficher, à côté du signal, la règle appliquée et les cas exclus (liens, champs de saisie, canvas) ; nommer notre propre fenêtre (1 500 ms) et la justifier ou la ramener vers 100 ms.
2. **Une seule règle d'auto-résolution, écrite sans contradiction.** La doc Datadog dit deux choses opposées sur `version`. Écrire une règle (« aucune occurrence depuis 14 jours dans la dernière release vue ») et l'afficher dans le panneau au moment où elle s'applique (« Résolue automatiquement le … : 14 jours sans occurrence »).
3. **Relevance sans boîte noire.** Le tri « Relevance » combine âge, volume du jour, hausse de l'heure et crash, sans poids publié. Proposer les mêmes ingrédients comme colonnes triables séparées (« Hausse sur 1 h », « Occurrences 24 h ») plutôt qu'un score composite.
4. **Le breakdown du panneau doit nommer la mesure.** « 2.57% of Views » ne dit pas si c'est la part des vues impactées ou la part des vues totales. Écrire « 2,57 % des vues touchées par cette issue sont sur /department/bedding » et donner le dénominateur.
5. **Remplacer le jargon d'écran par des phrases** : « Impacted Sessions » → « Sessions touchées » ; « What Happened » → « Ce qui s'est passé : 3 clics en 0,8 s sur “Payer”, puis TypeError » ; « No Replay Data » → « Aucun enregistrement de replay sur cette période : la carte ne peut pas se dessiner ». Et rappeler la couverture : un compteur de sessions touchées calculé sur un échantillonnage replay de 20 % n'est pas un compteur de sessions, c'est une estimation — l'écrire.
