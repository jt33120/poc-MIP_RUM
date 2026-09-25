# `console-api` — ce que la piste C doit porter

> **Ré-inventaire C-R du 24/09/2026**, sur `master` après la refonte frontend et P0 à P6a. Les chiffres viennent de [inventaire.md](inventaire.md), **généré** depuis le code par `node scripts/dev/inventaire-console.mjs` : ils se recalculent, ils ne se recopient pas. Cible et découpage : [architecture](../overview.md), plan backend (piste C, C0 → C13).

## Ce qui atteint la base aujourd'hui

| | Total | Atteignent la base |
|---|---|---|
| Écrans | 57 | **50** (51 au ré-inventaire) |
| Fichiers d'actions serveur | 17 (53 actions) | **16** |
| Routes | 54 | **47** |
| Composants serveur | — | **14** (27 au ré-inventaire, avant les scissions ci-dessous) |
| Layout racine | 1 | **oui** : projets, fuseau (C2 le remplace par `GET /v1/shell`) |

« Atteindre la base », c'est avoir `lib/db.ts` ou `pg` dans son graphe d'import **à l'exécution** (les `import type` ne comptent pas). La piste C doit amener ces quatre nombres à zéro (jalon M4).

**Le cliquet** : [`cliquet.json`](cliquet.json) liste ces entrées **nominativement**, et `tests/unit/inventaire-console.test.ts` le tient à chaque `pnpm test:unit`.
- Une entrée **nouvelle** est refusée. Un écran branché sur la base pendant qu'un autre en est libéré ferait stagner le compte sans que rien ne le signale.
- Une entrée **libérée** doit sortir du cliquet dans la PR même qui la libère.

Le plan prévoyait ce cliquet en C0. Il est posé dès C-R, parce que le script qui le calcule est celui de l'inventaire.

## Ce que le ré-inventaire corrige dans le plan

1. **`app=all` n'est refusé nulle part.** Le plan décrivait quatre surfaces « une application à la fois » (`/paths`, `/forms`, `/acquisition`, `/retention`), refusées à un principal restreint par `perimetreAvailability()`.
   - Ce refus a été **levé par F53**. Toutes les lectures lient les apps **effectives** du principal (`sqlContext`), et `perimetreAvailability` n'existe plus.
   - Conséquence pour le contrat : `console-api` accepte `app=all` pour tout principal et le résout en périmètre effectif signé. Il n'y a **pas** de refus typé « app unique » à porter.
2. **27 composants serveur**, pas « une poignée ». La plupart n'atteignaient la base que par **un seul maillon**, que l'inventaire nomme (colonne « chemin »). Trois familles :
   - un **module de `lib/` qui mêle un calcul pur et une requête**, importé pour le calcul. **Famille vidée** : chaque module mixte a été scindé en un module pur et un module de requêtes qui le réexporte (les autres appelants n'ont rien changé), et les composants importent le module pur :

     | Module mixte | Partie pure, sans base | Composants libérés |
     |---|---|---|
     | `lib/fuseau.ts` | `lib/fuseau-local.ts` | `HealthHeatmap` |
     | `lib/error-issues.ts` | `lib/issues-libelles.ts` (statuts, bases de regroupement, libellés) | `IssueBadges`, `IssueWorkflow`, `IssueList` (avec la ligne suivante) |
     | `lib/queries-errors.ts` | `lib/erreurs-sources.ts` (sources, libellés, `stackSymbolisable`) | `ErrorBadges`, `ErrorOccurrences`, `DetailErreur` |
     | `lib/health.ts` | `lib/health-libelles.ts` (libellés, classes, `dominantFactors`) | `HealthBanner` |
     | `lib/queries-v2.ts` | `lib/alertes-metriques.ts` (métriques, comparateurs, libellés) | `RuleFields` |
     | `lib/queries-deploys.ts` | `lib/deploys-verdict.ts` (verdict de régression, référence, taux, écarts) | `DeployPanel`, `VersionsTable`, `SeriesVueEnsemble` ; et l'écran `/admin/composants` |
     | `lib/queries-ticket-integrations.ts` | l'adaptateur de `@mip/backend`, qui n'importe rien | `IssueTickets` |

     `DeployPanel` était classé plus bas, « lit vraiment » : il n'importait de `queries-deploys` que le verdict, un calcul. Le chemin nommé par l'inventaire n'en dit pas plus : c'est la liste des symboles importés qui tranche ;
   - un **fichier d'actions serveur importé pour être passé à un formulaire** : `app/alerts/actions.ts`, `app/dashboards/actions.ts`, `app/explorer/actions.ts`, `app/errors/[fingerprint]/actions.ts` — 7 composants (`ChannelsSection`, `RuleRow`, `SloStatusRow`, `ModeleCarte`, `WidgetCard`, `ActionsVue`, `ErrorTriage`). Le composant ne lit rien : c'est l'action qui écrit ;
   - un **composant qui lit vraiment**, 7 composants : `PanneauErreur`, `PanneauSession` et `RoutePanel` (les panneaux, qui lisent leurs sections), `ErrorStackCard` (la symbolication), et `Specs`, qui entraîne `Annexe` et `Landing` (la vitrine lit le dernier passage planifié). Leur lecture ira dans le loader de leur écran ; pour la vitrine, dans `console-api` (C0b) puis hors du cliquet une fois le repli local retiré.

   Seule la **première famille** se libère sans attendre `console-api`, en scindant le module : ce sont les premiers pas du cliquet. La deuxième ne se libère que quand l'action elle-même passe par `console-api` (C6 → C9). Déplacer l'import vers l'écran ne ferait que maquiller le compte : l'écran atteint déjà la base.
3. **261 appels `lire()`**, pas 222. C'est l'unité de découpage des loaders : un écran rend un **résultat par section**.
4. **54 routes**, pas 52. Leur destination (colonne « Destination » de l'inventaire) :
   - **25 vont au service `api`**, et cette destination est déjà livrée (#291, #292) : les lectures de l'API v1, `/api/rum/summary` et la documentation ;
   - **7 vont au `collector`** : les 3 routes d'ingestion (relais P3), les 2 de l'extension, les source maps et les marqueurs de déploiement ;
   - **16 vont à `console-api`** : l'identité, l'administration, l'export RGPD et celui des tableaux de bord, la relecture des rejeux, et les 5 écritures de l'API v1 (triage, commentaires, liens, vues) ;
   - **4 sont à supprimer** : les trois cron (410 depuis P0) et `/api/metrics` ;
   - **1 reste sur Vercel**, en relais serveur (`/api/releases`, appelée par le navigateur) ; **1 va au `notifier`**, le crochet entrant des tickets.
5. **Panneaux** : 5 types de `panel=` sont réellement ouverts (`route`, `error`, `event`, `session`, `noeud`), chacun par un seul écran.
   - `lib/view-state.ts` en déclare 3 de plus (`issue`, `trace`, `action`), qu'aucun écran n'ouvre ni n'écrit.
   - Ne pas les porter dans `console-api` avant qu'un écran s'en serve.
6. **Audit** : trois fichiers d'actions écrivent **sans** audit : `app/dashboards/actions.ts` (11 actions), `app/explorer/actions.ts` (3) et `app/select/actions.ts` (1).
   - La règle de C0, « toute route non-GET déclare une action d'audit ou une exemption », devra trancher pour chacun.
   - Proposition : **exemption motivée** pour les objets personnels de l'espace de travail (tableaux de bord, vues, projet sélectionné), audit pour tout le reste.

## Le contrat de lecture, tel que le code l'impose

Ces règles ne sont pas des choix nouveaux. Ce sont les invariants du frontend livré, que `console-api` doit garder.

- **Un résultat par section, jamais un échec en bloc.** Un chargeur d'écran rend une section par lecture, `{ ok: true, data } | { ok: false, code: "lecture_en_echec" }` (`Section<T>` du contrat, formée par `section()`, la forme de `lire()` sans sa raison). C'est le point de conception de F02 : un `Promise.all` emportait tout l'écran au premier échec.
- **La `raison` ne sort jamais vers le navigateur.** Elle peut nommer un hôte ou une table. Elle va au journal serveur, avec le `request_id` ; l'écran n'affiche que le titre de la section en échec.
- **`UnsupportedFilterError` n'est pas une panne** : `lire()` la relève. Dans le contrat, c'est un **refus typé** (400 avec un `code` stable), rendu pour l'appel entier.
- **Pas de `<Suspense>` par section** (F02 : une frontière bloquait `router.replace`). Le loader est **un** appel serveur par rendu d'écran ; les sections s'y exécutent en parallèle, côté `console-api`.
- **Le régime réel est un sondage.** 53 écrans sur 57 sont rejoués par `AutoRefresh` **toutes les 5 s**, soit 12 rendus par minute et par onglet ouvert.
  - La limite de débit se calibre sur ce régime, **par rendu** et non par requête SQL.
  - La somme des pools doit tenir sous `max_connections` (112) **avec plusieurs onglets ouverts**.
  - Le mémo par module et `cache()` de React ne couvrent qu'**un** rendu : ni l'un ni l'autre n'amortit ces rendus successifs.
- **Un panneau est lu par le chargeur de son écran**, en parallèle de ses sections, seulement quand `panel=` le demande (révisé en C3). Le plan prévoyait une opération à part ; mais la page lit déjà le panneau dans le même rendu que ses sections, et une opération séparée ajouterait un aller-retour par rendu, douze fois par minute. Le coût d'un panneau ouvert reste visible : ce sont ses sections dans la réponse de l'écran.

## Les chargeurs d'écrans (C2 → C5), tels qu'ils sont faits

Un écran = un **chargeur** dans `apps/console/lib/chargeurs/<écran>.ts`. Il reçoit ce que reçoit la page — le principal, les paramètres d'URL, ceux du chemin — et rend ce que la page affiche. Le même code tourne à deux endroits :

- **dans la console**, aujourd'hui : la page appelle `chargerEcran(chargeur, sp)` (`lib/ecran-local.ts`), avec le principal de la session ;
- **dans `console-api`**, qui l'embarque tel quel (`services/console-api/ecrans.mjs`) et le sert sous l'opération de l'écran (`ECRANS` du contrat), avec le principal relu en base.

La parité n'est pas un test : c'est la construction. Cinq règles la tiennent.

1. **La page lit déjà la forme du fil.** `chargerEcran` passe la sortie du chargeur par JSON (`versLeFil`), exactement ce que fait le service : la page est typée `Fil<…>` (une date y est une chaîne ISO, un `Set` n'y passe pas), et le compilateur refuse l'écran qui l'oublierait. La bascule (après P6b) change `chargerEcran` : il appellera l'opération au lieu du chargeur, sans qu'aucune page change de type. Chaque page lui passera alors la CLÉ de son écran au lieu d'importer son chargeur (un `import type` garde le type) — ce que les server actions font déjà pour leurs commandes (C6) : sans cela, l'import du chargeur garderait la page dans le cliquet.
2. **Une section ne porte pas sa raison.** Un chargeur lit par `section()` (`lib/chargeurs/commun.ts`) : c'est `lire()`, l'échec journalisé côté serveur (dans le service, avec le `request_id` de l'appel), mais sur le fil ne passe que `{ ok: false, code: "lecture_en_echec" }`. Les composants qui n'affichent que le titre d'une section en échec prennent `SectionLue<T>` (`lib/lecture.ts`), qui accepte les deux formes.
3. **Un chargeur ne lit ni cookie ni en-tête.** Ce que la page tenait d'un cookie lui est passé en paramètre : la composition d'un écran (blocs allumés, `/`, `/sessions`, `/slo`) voyage sous `blocs`, même forme que le cookie (`avecBlocs`). Le projet courant, lui, est déjà dans `?app=` (porte projet du middleware).
4. **Ce que l'URL demande se lit une fois, par la même fonction des deux côtés.** Quand un écran a sa propre requête (Journal, Explorer, recherche de sessions), une fonction pure l'analyse (`demandeDuJournal`, `demandeExplorer`, `demandeDesSessions`) : le chargeur s'en sert pour savoir quoi lire, la page pour savoir quoi afficher.
5. **Un instant voyage en ISO, un JOUR en clé « AAAA-MM-JJ ».** Un `timestamptz` devient une `Date` puis une chaîne ISO : le même instant des deux côtés. Mais un `date`, ou un `timestamp` sans fuseau (`date_trunc('day', … at time zone <app>)`), devient une `Date` à minuit HEURE LOCALE du processus — que JSON écrirait en UTC, la veille sur un poste à Paris. Le chargeur forme donc la clé du jour lui-même (`cleJour`), dans le processus qui a lu la ligne : la grille d'historique de la vue d'ensemble et les quatorze jours des tendances. Les interfaces des lectures déclarent leurs instants `Date | string` : les helpers qui les lisent passent par `new Date(…)`, jamais par `.getTime()` sur la valeur brute.

**Politique commune des écrans** (`packages/console-api/src/operations/ecrans.ts`) : une session, la portée `app` (confrontée au périmètre relu en base AVANT le chargeur, `all` résolu), la démo en lecture, des paramètres bornés (48 au plus, noms à un motif, valeurs de 2 048 caractères au plus). Le chargeur reçoit `app` **tel que demandé** : `all` et une app seule n'ont pas le même sens pour lui (libellés, périmètre effectif). Un refus de filtre (`UnsupportedFilterError`) part en 400 `filtre_non_supporte` ; une panne en 500 générique, la cause au journal.

**Pages de détail** (`/sessions/[id]`, `/errors/[fingerprint]`, `/errors/issues/[id]`, `/tracing/[traceId]`, puis les appels SVI) : l'identifiant est dans le chemin, la portée reste `app`. Le pipeline ne résout pas la ressource (ses identifiants ne sont pas des UUID : un identifiant de session est émis par le client) ; le **chargeur** relit l'app de la ressource et la confronte au périmètre — introuvable ailleurs, comme absente, exactement la garde de la page.

**Décisions plutôt que rendus.** Un chargeur ne redirige ni ne rend rien : quand la page doit rediriger ou faire choisir (une issue qui reprend un groupe historique, une empreinte présente dans deux apps, une issue ouverte sous une autre app), il rend un état qui le dit (`issue`, `choix_app`, `autre_app`…) et la page l'exécute. Ce que la page tenait de sa requête — l'origine publique de la console, pour les liens d'un aperçu de ticket — lui est passé en paramètre, comme les blocs.

**Panneaux** : sessions (C3), groupes d'erreurs, routes (C4). Leur lecture a quitté leur composant pour `lib/chargeurs/panneau-*.ts` ; la pile d'un exemplaire aussi (`pile-erreur.ts` : symbolication, et contexte de code réservé à l'administrateur hors démo — décidé par le principal du chargeur, relu en base côté service). Trois composants sortent ainsi du cliquet.

**Capacités fermées** (Supervision SVI, Logs, Supervision IA) : une seule liste, `lib/capacites.ts`, lue par la sidebar, la page et le chargeur. Tant qu'une capacité y figure, son chargeur ne lit rien et rend `fermee` — dans console-api aussi : le cadenas n'est pas qu'un décor. Leurs chargeurs sont exécutés « rouverts » par un test dédié (`tests/contract/console-api-ecrans-fermes.test.ts`), pour que la réouverture ne découvre rien. La façade xSOM de l'IA lit `XSOM_AI_TOKEN` dans le processus qui exécute le chargeur : Vercel aujourd'hui, console-api après la bascule.

**Réduire avant d'envoyer.** Un chargeur rend ce que l'écran affiche, pas ce qu'il a lu : les 5 000 événements de formulaire d'une fenêtre deviennent des rapports (par formulaire, champ par champ pour le formulaire affiché) dans le chargeur de `/forms` — l'écran est rejoué toutes les 5 s. Même règle pour les tableaux de bord candidats de l'Explorer (identifiant, nom, app, révision : ni disposition ni propriétaire) et la session d'une trace (seul le verdict « lisible » voyage).

**Rejeu** (`replay.session`, `GET /v1/replays/{sessionId}`) : la route `/api/replay/[sessionId]` du lecteur appelle le même chargeur. C3 y ajoute le **plafond par session** que le plan demandait : 16 Mio compressés lus au plus (fenêtre SQL : les segments suivants ne quittent pas la base), 64 Mio décompressés rendus au plus ; au-delà, le lecteur dit combien de segments ne sont pas chargés (`tronques`).

**Vérifié par** : la matrice d'autorisations, qui exécute les VRAIS chargeurs (le module du service) sur une base migrée, pour 8 profils × 3 cibles, puis vérifie qu'un viewer obtient chaque écran — et ses variantes (comparaison, panneau, Explorer exécuté, onglet) — sans une seule section en échec ; le build du service, dont la garde refuse tout écran, composant, module de session ou `next/…` réel dans le bundle ; le crawl E2E des 57 écrans × 3 profils, qui rend chaque page à partir de la forme du fil.

## Les commandes (C6 → C9), telles qu'elles sont faites

Une écriture = une **commande** dans `apps/console/lib/commandes/<domaine>.ts`, enregistrée dans `lib/commandes/index.ts` sous la clé de son opération (`COMMANDES` du contrat — le type refuse une opération sans commande, ou l'inverse). C'est l'exact pendant d'un chargeur : le même code tourne dans la console aujourd'hui (`executerCommande`, `lib/commande-locale.ts`) et dans `console-api`, qui l'embarque (`services/console-api/commandes.mjs`) et la sert sous son opération.

1. **La server action appelle la commande PAR SA CLÉ** — `executerCommande("creerObjectif", { app, corps })` — et n'importe aucune commande. Elle lit son formulaire, puis tire de la DÉCISION rendue sa redirection ou sa revalidation. À la bascule, seul `executerCommande` change (il appellera l'opération) : les fichiers d'actions quittent alors le cliquet sans changer d'une ligne, et avec eux les composants qui les importent pour leurs formulaires.
2. **La règle est déclarée avec la commande** (`RegleCommande` du contrat) : qui (`session`, `admin`, `admin-plateforme`), sur quoi (`app` : UNE application nommée du périmètre ; `globale` : la commande résout elle-même la ressource et ses droits), et l'audit (une action `domaine.action`, ou une exemption motivée). Deux côtés l'appliquent :
   - `console-api` en TIRE la politique de l'opération (`politiqueDeCommande`) : `app` devient la portée `une-app` du pipeline (`all` refusé en 400), toute commande est refusée à la démo, et `verifierTable` refuse au démarrage une commande sans audit ni exemption ;
   - la console l'applique avant la commande, par `refusDAcces` (contrat), dans l'ordre du pipeline : session, démo, rôle, application.
   `tests/unit/console-api-commandes.test.ts` confronte les deux côtés pour chaque commande, huit profils et cinq applications demandées : même code de refus, ou le même passage.
3. **L'entrée est validée par la commande**, des deux côtés : le corps (passé par JSON en local, comme sur le fil) par son validateur — le pipeline l'utilise à l'étape 7 —, les paramètres du chemin par le sien. Un refus d'entrée part avant la commande, en `entree_invalide`.
4. **Une commande rend une DÉCISION, jamais une redirection** : `cree`, `ok`, `introuvable`, `interdit`, `conflit` (révision dépassée), `plein`… En 200 côté service : ce sont des réponses, pas des pannes. Une ligne demandée hors de l'application de la portée est `introuvable`, comme absente — chaque commande de portée `app` filtre `where id = $1 and app_id = $2`.
5. **L'audit s'écrit dans la transaction de l'écriture** (`auditer`, lié à la règle), avec l'identifiant de la requête, l'acteur (`user` : une démo n'écrit jamais) et l'application. Tant que migration-v90 n'est pas appliquée en production, la présence de ces colonnes est sondée et la ligne s'écrit sous sa forme d'avant (`lib/commandes/audit.ts`). Les actions d'audit prennent la forme `domaine.action` de `console-api` (`goal.create` au lieu de `goal_create`) : le journal montrera les deux formes autour de la bascule.

**C6 — l'espace de travail** (17 commandes, 3 écrans et l'export CSV) :

| Domaine | Commandes | Règle | Audit |
|---|---|---|---|
| Tableaux de bord | créer, cloner un modèle, cloner, modifier (nom, app), supprimer | `session`, `globale` : la porte unique des tableaux (`lib/dashboard-access.ts`) décide — propriétaire, périmètre, tableau transverse réservé à l'administrateur de la plateforme | `dashboard.*` |
| Cartes d'un tableau | ajouter une carte, une section, une analyse de l'Explorer ; régler, retirer, déplacer une carte | `session`, `globale`, même porte ; la révision affichée est citée (le `If-Match` du contrat, dans le corps) | exemptées : gestes fréquents, sans effet sur qui lit quoi |
| Vues enregistrées | créer, modifier, supprimer | `session`, `globale` : propriétaire seul, application de son périmètre (`lib/saved-views.ts`) | exemptées : personnelles, elles ne donnent aucun droit |
| Objectifs de conversion | créer, activer ou suspendre (l'état VOULU, plus un « inverser »), supprimer | `admin`, `app` | `goal.*` |

Deux corrections de droits en passant : activer ou supprimer un objectif filtrait par identifiant seul (un administrateur touchait l'objectif d'une application hors de sa liste), et un administrateur avec une liste pouvait créer un objectif hors de celle-ci. Les écrans `/dashboards`, `/dashboards/[id]` et `/explorer/views` ont leur chargeur ; l'export CSV aussi (`dashboards.export`), qui partage la donnée de l'écran — la route de la console lui passe le signal de sa requête, pour qu'un export abandonné n'ouvre pas les lectures restantes.

**C7 — le workflow des erreurs** (5 commandes) : trier une issue (statut, assigné), la commenter, y lier un ticket, demander la création d'un ticket (P8.6), et trier un groupe historique par son empreinte. Règle `admin` + portée `app` : la mutation cherche l'issue DANS cette application (`apps: [app]`), l'audit (`issue.*`, `error.set_status`) entre dans la transaction du workflow. L'origine de la console, que la demande de ticket écrit dans ses liens, vient de la requête de la console (`origineConsole`), jamais du formulaire — comme `PARAM_ORIGINE` pour le chargeur de l'issue.

**Les mutations « cookie » de l'API v1 quittent le contrat public** (plan, C7) : `POST /api/v1/issues/{id}/triage`, `/comments`, `/links`, `/tickets`, et les écritures de vues (`POST /api/v1/explorer/views`, `PATCH`/`DELETE …/{id}`). Elles n'acceptaient que le cookie d'une session de la console, de même origine : leur seul client était l'écran de la console. Les formulaires de l'issue, qui les appelaient par `fetch`, appellent désormais une server action (`app/errors/issues/actions.ts`) qui exécute la commande. Les lectures restent (`GET …/activity`, `GET …/tickets`, `GET …/explorer/views`). `API_CONSOLE.md`, l'OpenAPI, le descripteur `GET /api/v1` et la doc MCP le disent ; l'API ne garde qu'une écriture, celle de la CI (`POST /api/v1/deploys`, C11).

L'inventaire ne suit plus l'import d'une server action par un composant CLIENT : Next le remplace par une référence, le rendu ne charge pas la base. (Un composant SERVEUR qui importe une action pour son formulaire, lui, charge le module : cet arc reste suivi.)

Reste de C7, **conditionnel** (R7) : fermer le ticket quand l'issue est résolue (un événement sortant dans `ticket_outbox`). Il attend la confirmation de l'outil ITSM cible — si ce n'est pas GitHub, l'adaptateur change.

**C8 — l'alerting et la disponibilité** (14 commandes, 3 écrans) : règles (créer, modifier, activer ou suspendre), acquittement d'un événement, « Évaluer maintenant », SLO (créer, activer, supprimer), canaux de notification (créer, activer, supprimer), sondes de disponibilité (créer, activer, supprimer). Trois règles de droits, qu'appliquent la console et `console-api` :

- **une ligne se relit dans son application** : règles, événements, SLO et sondes ont la portée `app`, et chaque écriture filtre `where id = $1 and app_id = $2` (un événement, par sa règle ou par le SLO qui l'a levé). Avant C8, basculer, acquitter ou supprimer visait un identifiant seul ;
- **un administrateur d'une liste n'administre que ces applications** (plan, C8 → C9) : il ne crée, ne modifie ni ne déplace une règle hors de sa liste, et le sélecteur d'application ne lui propose qu'elle ;
- **ce qui touche toutes les applications est à l'administrateur de la plateforme** : « Évaluer maintenant » (`check_alerts()` et `check_slo_burn()` sur tout le parc) et le canal GLOBAL (`app_id` nul). Un canal a donc la portée `globale`, et la commande le confronte au périmètre du principal (`app_id = any(apps)`, ou tout pour la plateforme).

Activer ou suspendre POSE l'état voulu (`PUT …/active`), au lieu d'inverser : le formulaire le porte dans un champ — pas dans la valeur de son bouton, qu'une action appelée par `formAction` ne reçoit pas (relevé par la fumée). Les formulaires de règle, de SLO et de canal voyagent en **champs** (un dictionnaire de chaînes bornées) : la commande les lit par les mêmes règles qu'avant, au mot près, et rend `invalide` avec le message, ou `url_refusee` avec le code du motif (`safe-fetch`) que la page traduit.

**Les écrans d'administration** forment une famille à part du contrat (`ECRANS_ADMIN`) : un administrateur, sans portée d'application — `/admin/uptime` en C8, les autres écrans d'`/admin` en C9. Leur chargeur restreint ce qu'il liste au périmètre du principal, et dit `interdit` à qui n'est pas administrateur (la page redirige, comme `requireAdmin`).

**C9 — l'administration** (18 commandes). Deux règles, et elles seules :

- **l'administrateur de la PLATEFORME** (rôle admin, aucune liste) : les comptes de la console (créer, activer ou désactiver, réinitialiser un mot de passe — un administrateur d'une liste créerait sinon un compte aux applications de son choix), la création d'une application (un nouveau client, un site ajouté depuis `/select`), ce qui n'appartient à aucune application (oublier un poste de l'extension) et la **recette d'une capacité mobile** (R5 : `verified_at`, qui se posait par un `update` direct sans contrôle de droits ; un formulaire sur `/mobile` pour l'administrateur de la plateforme) ;
- **l'administrateur de l'application** (portée `app`) : sa clé d'ingestion, son activation, ses origines CORS, ses jetons de lecture et de CI, ses connecteurs de tickets, les domaines de l'extension qui lui sont rattachés. Un domaine déjà rattaché à une application hors de son périmètre n'est plus repris (avant C9, l'enregistrement le déplaçait sans rien vérifier).

Désactiver un compte ou réinitialiser son mot de passe **révoque ses sessions** (`console_session`, migration-v90, quand elle est appliquée). Un secret (mot de passe, clé, jeton) est généré et haché par la commande et **rendu une fois** par sa décision ; la console l'affiche comme avant (stash mémoire), jamais écrit en clair. Les routes `/api/admin/sourcemap-tokens` et `/api/admin/ticket-integrations` ont été retirées : leurs seuls clients étaient les écrans, qui appellent désormais leurs commandes (les jetons de CI par des server actions, depuis leurs composants client).

**Le lint des écritures** (`tests/unit/ecritures-par-application.test.ts`) relit tout le SQL d'écriture de la console : un `update` ou un `delete` par identifiant sans `app_id` échoue, hors des tables listées avec leur raison (un compte, une session, un tableau de bord et sa porte, une vue personnelle, un poste de l'extension, le registre des applications). Il a trouvé deux écritures à corriger : la clôture d'une demande d'effacement et la mise à jour d'un connecteur de tickets, désormais filtrées par leur application.

**C9b — les écrans de l'administration** (13 écrans, `lib/chargeurs/administration.ts` et `lib/chargeurs/projets.ts`). Tous les écrans d'`/admin` (hors `/admin/privacy`, C10) ont leur chargeur, et avec eux `/select` et `/select/new`. Une règle : **un administrateur d'une liste ne LIT pas plus qu'il n'administre**.

- Les écrans de la plateforme seule — comptes, santé interne, postes de l'extension — disent `interdit` à un administrateur d'une liste (la page renvoie à l'accueil, comme `requireAdmin` le faisait pour un viewer).
- Les autres restreignent leurs listes à son périmètre : applications clientes (et le formulaire de création, à la plateforme seule), jetons de lecture, domaines de l'extension, source maps, connecteurs, consommation, et le journal d'audit (par `audit_log.app_id`, migration-v90 ; sans elle, rien ne rattache une ligne à une application : une liste n'en lit aucune). La fiche d'une application hors de son périmètre est `introuvable`, comme absente.
- `authorizedAppsOf` (`lib/query-contract.ts`) ne rend plus « toutes les applications » à un administrateur qui a une liste : le sélecteur de projet, la coquille et `/select` lui montrent sa liste. Seul `apps = null` vaut toutes.
- `/select` est un écran **de session sans portée** : une famille à part du contrat (`ECRANS_SESSION`), toute session, le chargeur ne lisant que le périmètre du principal. La carte « Ajouter un site » n'est proposée qu'à la plateforme (la commande `creerSite` l'est). `/select/new` est un écran d'administration : le formulaire à la plateforme, l'intégration d'un site existant à ses administrateurs.

Ce qu'une page tient de sa requête reste à la page : l'hôte (URL du SDK et de l'ingestion d'un snippet) et, jusqu'à C9c, le secret à usage unique relu du stash mémoire.

`tests/contract/console-api-authz.test.ts` joue chaque écran d'administration pour l'administrateur d'une liste et pour celui de la plateforme (état attendu de chacun, 403 au viewer), l'intégration d'un site dans et hors du périmètre, et `/select` pour chaque profil.

**Reste de C9 — C9c** : les secrets à usage unique (mot de passe créé ou réinitialisé, clé d'une application créée ou tournée, jeton de lecture, site ajouté) passent par `useActionState` : la décision de la commande les porte jusqu'au formulaire, `stashSecret`/`popSecret` disparaissent. Cela corrige aussi le « déjà affiché » du mot de passe généré sur `/admin/users` (Next rend la page cible dans la réponse de l'action, puis la relit : le stash est vidé deux fois).

## Ordre proposé pour libérer le cliquet

1. **Sans `console-api`** : scinder les modules mixtes (famille 1). **Fait** : 13 composants et un écran sortis du cliquet (27 → 14 composants, 51 → 50 écrans). C0 démarre sur une base plus petite.
2. **C0** : fondations (`console-api`, session, pipeline, v90). Le cliquet ne bouge pas.
3. **C2** : `GET /v1/shell`. Le layout racine sort du cliquet, ce qui est le plus gros gain unitaire : il pèse sur les 57 écrans.
4. **C3 → C5** : les chargeurs des écrans, par lots (colonne « Lot » de l'inventaire ; colonne « Chargeur » pour l'avancement). Décision du 24/09 : `console-api` est mis en service **à la fin, après P6b** — d'ici là les écrans exécutent leur chargeur dans la console, et le cliquet ne descend que par ce qui sort des écrans (les panneaux déplacés dans un chargeur, par exemple). Il descend d'un coup à la bascule, quand `chargerEcran` appelle le service.
5. **C6 → C9** : les écritures, en commandes (section ci-dessus) ; les fichiers d'actions et les composants qui les importent quittent le cliquet à la bascule, quand `executerCommande` appelle le service. **C10** : le RGPD. **C11** : les routes machine. **C12** : cliquet vide, gardes de build.
