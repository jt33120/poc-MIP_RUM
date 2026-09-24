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

- **Un résultat par section, jamais un échec en bloc.** Un loader d'écran rend `Lecture<T>[]`, avec `{ ok: true, data } | { ok: false, raison }` (`lib/lecture.ts`). C'est le point de conception de F02 : un `Promise.all` emportait tout l'écran au premier échec.
- **La `raison` ne sort jamais vers le navigateur.** Elle peut nommer un hôte ou une table. Elle va au journal serveur, avec le `request_id` ; l'écran n'affiche que le titre de la section en échec.
- **`UnsupportedFilterError` n'est pas une panne** : `lire()` la relève. Dans le contrat, c'est un **refus typé** (400 avec un `code` stable), rendu pour l'appel entier.
- **Pas de `<Suspense>` par section** (F02 : une frontière bloquait `router.replace`). Le loader est **un** appel serveur par rendu d'écran ; les sections s'y exécutent en parallèle, côté `console-api`.
- **Le régime réel est un sondage.** 53 écrans sur 57 sont rejoués par `AutoRefresh` **toutes les 5 s**, soit 12 rendus par minute et par onglet ouvert.
  - La limite de débit se calibre sur ce régime, **par rendu** et non par requête SQL.
  - La somme des pools doit tenir sous `max_connections` (112) **avec plusieurs onglets ouverts**.
  - Le mémo par module et `cache()` de React ne couvrent qu'**un** rendu : ni l'un ni l'autre n'amortit ces rendus successifs.
- **Un panneau est une opération à part**, pas une variante de l'appel d'écran. Un écran avec un panneau ouvert fait deux appels par rendu.

## Ordre proposé pour libérer le cliquet

1. **Sans `console-api`** : scinder les modules mixtes (famille 1). **Fait** : 13 composants et un écran sortis du cliquet (27 → 14 composants, 51 → 50 écrans). C0 démarre sur une base plus petite.
2. **C0** : fondations (`console-api`, session, pipeline, v90). Le cliquet ne bouge pas.
3. **C2** : `GET /v1/shell`. Le layout racine sort du cliquet, ce qui est le plus gros gain unitaire : il pèse sur les 57 écrans.
4. **C3 → C5** : les écrans, par lots (colonne « Lot » de l'inventaire). Chaque PR resserre le cliquet.
5. **C6 → C11** : les écritures, puis les routes machine. **C12** : cliquet vide, gardes de build.
