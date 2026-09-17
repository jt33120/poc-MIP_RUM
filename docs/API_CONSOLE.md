# API console RUM — contrat v1 (LOT C, option B)

> **But** : exposer les agrégats RUM via une **API REST stable**, consommable par le
> front **Angular de MIP** (ou tout autre client) **sans réécrire la console**. C'est
> l'option B du cadrage (`docs/CADRAGE_LOT_C.md`) : découplage, console livrable seule,
> migration incrémentale. L'API réutilise la couche data existante (`lib/queries*.ts`,
> `lib/health.ts`) — **aucune logique SQL dupliquée**.

- **Base** : `/api/v1` (servie par la console Next.js).
- **Lecture**, plus quelques écritures annoncées à part (section « Écritures ») : le marqueur de
  déploiement de la CI et le workflow des issues, réservé à une session admin de la console.
- **Format** : JSON UTF-8, enveloppe stable `{ meta, data }` (voir plus bas).
- **Découverte** : `GET /api/v1` renvoie la liste des endpoints et des filtres.

---

## Authentification

Deux modes (le handler tranche, le middleware ne redirige pas `/api/v1`) :

1. **Jeton machine** — en-tête `Authorization: Bearer <token>`. Le jeton doit figurer
   dans la variable d'environnement **`CONSOLE_API_TOKENS`** (liste séparée par des
   virgules, comparaison à temps constant). Accès **lecture seule**.
   👉 mode recommandé pour le **back Angular MIP** (appel serveur-à-serveur).
   - `token` → **toutes apps** (réservé à MIP).
   - `token@app1;app2` → jeton **scopé** à ces apps (comme un viewer scopé) : un
     partenaire (ex. UTI) reçoit `<jeton>@<app_id exact>` et ne voit **que** son app.
     ⚠️ `<app_id>` doit être l'identifiant **exact** tel qu'envoyé par le SDK
     (`appId` dans `MIPRum.init(...)`), pas le nom de la plateforme partenaire — pour
     UTI c'est `gip-plateforme` (vérifiable via `GET /api/v1/apps`), **pas** `uti`.
     Un mauvais `app_id` de scope ne provoque **aucune erreur** : le jeton fonctionne
     mais filtre sur une app vide → tout s'affiche à zéro côté partenaire. Voir
     `docs/HANDOVER_UTI.md`.
2. **Cookie de session** — le cookie JWT `mip_session` de la console. Respecte le
   **RBAC** existant : un `viewer` scopé ne voit que ses apps. Pratique pour un appel
   depuis le navigateur d'un utilisateur déjà connecté à la console.

Sans authentification valide : **`401`** `{ "error": "..." }`.

> Génération d'un jeton : n'importe quel secret aléatoire long (`openssl rand -hex 32`),
> ajouté à `CONSOLE_API_TOKENS`. Plusieurs jetons cohabitent (rotation sans coupure).

## CORS

Le front Angular étant sur une autre origine, renseigner **`CONSOLE_API_ALLOWED_ORIGINS`**
(liste d'origines séparées par des virgules ; `*` possible mais déconseillé en prod).
Une origine listée reçoit `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`
(le cookie de session cross-origin fonctionne). Préflight `OPTIONS` géré sur chaque route.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `CONSOLE_API_TOKENS` | jetons d'accès machine (CSV). Vide = mode jeton désactivé. |
| `CONSOLE_API_ALLOWED_ORIGINS` | origines CORS autorisées (CSV, ou `*`). Vide = same-origin. |
| `AUTH_SECRET` | secret JWT (déjà utilisé par la console) — pour le mode cookie. |
| `DATABASE_URL` | base Postgres lue par les agrégats (déjà utilisé). |
| `CRON_SECRET` | secret du cron Vercel (en-tête `Authorization: Bearer` sur `/api/cron/*`). |
| `OPENROUTER_API_KEY` | clé (lecture) du compte OpenRouter à surveiller — poll du solde. Absent = poll ignoré. |
| `OPENROUTER_LOW_BALANCE` | seuil « bas » du solde (défaut `5`, unité native = USD). |
| `OPENROUTER_CURRENCY` | libellé de devise affiché (défaut `USD`). |
| `OPENROUTER_ALERT_COOLDOWN_HOURS` | anti-spam : re-rappel de l'alerte tant que bas (défaut `24`). |
| `OPENROUTER_ACCOUNT_APP` | app à cibler pour le routage de l'alerte (défaut : canaux globaux). |

---

## Filtres communs (query string)

Tous les endpoints de données acceptent :

| Param | Valeurs | Défaut |
|---|---|---|
| `app` | slug d'app, ou `all` | `all` (toutes apps autorisées) |
| `period` | `1h` \| `24h` \| `7d` (`7j` toléré) | `24h` |
| `device` | `mobile` \| `desktop` \| `tablet` \| `all` | `all` |

Le **scoping RBAC** s'applique au paramètre `app` : un `viewer` scopé qui demande une
app hors de son périmètre (ou `all`) est **rabattu sur sa première app autorisée**.

## Enveloppe de réponse

```jsonc
{
  "meta": {
    "app": "all",            // app effective APRÈS scoping
    "period": "24h",
    "device": "all",
    "generatedAt": "2026-06-17T08:00:00.000Z"
  },
  "data": { /* spécifique à l'endpoint */ }
}
```

Erreurs : `{ "error": "message" }` avec le statut HTTP (`400`, `401`, `403`, `404`, `429`, `500`).

---

## Journal des changements

### 17/09/2026 — workflow des issues : triage, commentaires, liens et historique (P5.6)

Une lecture et trois écritures s'ajoutent, sans rien changer aux routes existantes :
`GET /api/v1/issues/{id}/activity`, `POST /api/v1/issues/{id}/triage`, `POST /api/v1/issues/{id}/comments` et
`POST /api/v1/issues/{id}/links`. Les écritures exigent une **session admin de la console** et son Origin : un
jeton `CONSOLE_API_TOKENS` reste en lecture seule (`403`), comme une session viewer ou démo. Chaque écriture
porte `expectedRevision`, la révision lue : `409` si l'issue a changé depuis, avec la révision courante. Le
serveur MCP n'expose aucune de ces écritures. Commentaires et liens restent dans la console : rien n'est
envoyé à un outil de tickets.

### 17/09/2026 — issues d'erreurs : regroupement versionné et identité durable (P5.5)

Deux routes de lecture s'ajoutent, sans rien changer à `/errors` ni à `/errors/{fingerprint}` :
`GET /api/v1/issues` et `GET /api/v1/issues/{id}`. Une **issue** est l'identité durable d'un problème dans
une app (UUID), calculée par le regroupement v2 : clé déclarée par l'émetteur, sinon première frame
applicative en positions source, sinon frame normalisée, sinon repli marqué `low_confidence`. Le regroupement
v2 s'active **par app** ; avant, et pour les occurrences antérieures, les groupes historiques restent listés
tels quels (`kind: "legacy"`). Aucune occurrence n'est comptée deux fois. Les anciennes URL de groupe
restent valides. Ces deux routes sont en lecture seule : le triage des issues viendra avec ses propres routes.

### 16/09/2026 — erreurs : une seule lecture pour la console, l'API et le MCP (P5.1)

`GET /api/v1/errors` et `GET /api/v1/errors/{fingerprint}` lisent désormais la même base filtrée que
l'écran `/errors` (`apps/console/lib/queries-errors.ts`). Auparavant la liste, le détail et ses
occurrences appliquaient chacun leurs propres prédicats : ouvrir un groupe pouvait afficher un autre nombre
que celui de la liste. Ce qui change pour un client :

- **`device` s'applique aux compteurs d'erreurs** (tablette comprise). La liste l'ignorait.
- **Bots et apps internes exclus**, comme dans la console. Une app interne reste lisible en la nommant
  dans `app`.
- **Fenêtre `[début, fin)`** en UTC, bornée des deux côtés et figée pour toute la réponse.
- **Jointures de session scopées par app** : un identifiant de session cité par une autre app ne prête
  plus ni appareil, ni visiteur, ni lien. `sessions` et `users_affected` gardent leur nom, leur type et
  leur définition (sessions et visiteurs distincts touchés, jamais `null`), mais ne comptent plus que des
  sessions existant dans la même app.
- **`regressed` n'est jamais `null`** : `false` pour un groupe sans statut de triage.
- **Nouveaux champs d'impact** : `sessions_affected`, `visitors_affected`, `identified_users_affected`
  (`null` = personne de connu, pas zéro), `session_coverage`, `identity_coverage`.
- **Liste** : `total`, `totals`, `trend`, `sampling` et `enrichment` s'ajoutent après les clés
  historiques ; `offset` est plafonné à 10 000.
- **Détail** : l'exemplaire `last` et les `occurrences` suivent la même fenêtre et les mêmes filtres que le
  groupe (ils n'étaient pas bornés dans le temps). Occurrences paginées par curseur (`limit` 1..100,
  `cursor`), chacune avec ses `links` ; `trend`, `page`, `sampling` et `enrichment` ajoutés.
- **Empreinte ambiguë** : sans `app`, une empreinte présente dans plusieurs apps du périmètre répond `400`
  en listant les apps candidates, au lieu d'en retenir une arbitrairement.
- **Session viewer sans aucune app** : `403` sur la liste, `404` sur le détail. Sur ces deux routes, une
  liste d'apps vide ne vaut plus « toutes les apps ».
- **`env`** est l'environnement **déclaré par l'émetteur**, non vérifié (le SDK web déclare `dev` par
  défaut) ; aucun filtre ne s'appuie dessus.

---

## Endpoints

> Les **formes de `data`** ci-dessous référencent les interfaces TypeScript de la couche
> data (sources de vérité : `apps/console/lib/queries*.ts`, `lib/health.ts`).

### `GET /api/v1` — découverte
`data` = `{ version, description, filters, endpoints[] }`.

### `GET /api/v1/apps` — catalogue
`data.apps: { app_id, name }[]` — filtré au scope du principal.

### `GET /api/v1/overview` — vue d'ensemble
`data = { health: Health, vitals: { current: VitalAgg[], previous: VitalAgg[] }, stats: { current: OverviewStats, previous: OverviewStats } }`.
Les `previous` couvrent la **période précédente** (calcul des deltas côté front).

### `GET /api/v1/vitals` — Core Web Vitals
`data = { p75: VitalAgg[], series: Record<string, SeriesRow[]> }`.
`?series=LCP,INP` choisit les vitals à détailler en série temporelle ; `?series=all`
= les 5 (LCP, INP, CLS, FCP, TTFB) ; absent = pas de série.

### `GET /api/v1/pages` — pages lentes
`data.routes: RouteRow[]` (p75 LCP/INP, volume, part mobile).

### `GET /api/v1/errors` — groupes d'erreurs
`data = { groups: ErrorGroupRow[], unfingerprinted, page: { limit, offset }, total, totals: ErrorTotals, trend: ErrorTrendPoint[], sampling: ErrorSampling, enrichment: ErrorEnrichment }`
(sources de vérité : `ErrorListResult` dans `apps/console/lib/queries-errors.ts`, schéma
`ErrorGroupList` de la spec OpenAPI). Les clés historiques viennent en tête.

**Même population que l'écran `/errors`** : fenêtre UTC `[now − period, now)`, `app` après scoping,
`device` (tablette comprise), trafic de bots et apps internes exclus (une app interne reste lisible avec
`app` explicite). Un groupe est un couple `(app_id, fingerprint)` ; un groupe sans occurrence dans la
fenêtre n'est pas renvoyé.

| Champ d'un groupe | Sens |
|---|---|
| `occurrences` | somme des répétitions reçues sur la fenêtre — pas un nombre de lignes |
| `sessions_affected` | sessions distinctes de la même app ; `null` si aucune occurrence n'a de session connue |
| `visitors_affected` | visiteurs distincts (`visitor_id` du SDK) ; `null` si aucun n'est connu |
| `identified_users_affected` | identités métier distinctes (HMAC par app) ; `null` si aucune n'est connue |
| `session_coverage` | part (0..1) des occurrences rattachées à une session de la même app ; `null` sans occurrence |
| `identity_coverage` | part (0..1) des occurrences rattachées à un visiteur ou à une identité |
| `sessions`, `users_affected` | champs historiques : `sessions_affected` et `visitors_affected`, `null` ramené à `0` |
| `first_seen` | première apparition connue, **toutes fenêtres confondues** — seul champ hors fenêtre |
| `last_seen` | dernière occurrence de la fenêtre |
| `status`, `resolved_at`, `regressed` | triage ; `regressed` = marqué résolu puis revu depuis (`last_seen > resolved_at`), jamais `null` |

Sessions, visiteurs et identités sont trois populations distinctes, **jamais additionnées**. Un compte à
`null` veut dire « personne de connu » (une erreur backend sans session, par exemple), pas zéro personne.

- `totals` : le même impact sur **toute la population filtrée** — des personnes distinctes, pas la somme
  des groupes (un visiteur touché par deux groupes reste un visiteur) —, plus `groups` et `unfingerprinted`.
- `total` : nombre de groupes de la population (égal à `totals.groups`).
- `trend` : occurrences par intervalle (`bucket` de 5 min, 1 h ou 6 h pour `1h`, `24h`, `7d`), zéros
  compris : 13, 25 ou 29 points, la fenêtre glissante entamant deux intervalles partiels. La somme de
  `trend[].occurrences` vaut `totals.occurrences`.
- `unfingerprinted` : occurrences sans empreinte (erreurs v0.1) de la même population, absentes de tout
  groupe.
- `sampling` : `{ min_inclusion_probability, message }`. Probabilité minimale qu'une erreur de la
  population ait été conservée : `sample_rate + (1 − sample_rate) × error_sample_rate` de sa session
  (`null` sans session connue). `message` n'est renseigné que si elle est strictement entre 0 et 1.
  **Aucune extrapolation** : les volumes restent ceux observés.
- `enrichment` : `{ available, diagnostic }`. `available: false` tant que la migration v69 n'est pas
  appliquée : trace, source, identité d'occurrence et `handled` valent alors `null`, les compteurs
  historiques restent exacts.

Tri : triage d'abord (régression, ouverte, résolue, ignorée), puis l'**impact sur la fenêtre** — visiteurs
distincts, puis sessions (inconnus en dernier), puis occurrences, dernière vue, et enfin `app_id`,
`fingerprint` pour un ordre total : deux pages d'offset ne répètent ni ne sautent un groupe.

Pagination : `limit` 1..200 (défaut 100), `offset` plafonné à 10 000. `403` `aucune application autorisée`
pour une session viewer sans aucune app.

Jusqu'au 09/09/2026 `occurrences`, `sessions` et `users_affected` venaient d'une vue **sans borne
temporelle** : ils valaient le cumul depuis la première ingestion quelle que soit la `period` demandée. Un
client qui s'en servait pour suivre une tendance lisait une constante. Le tri a changé à cette date pour
classer par impact sur la fenêtre au lieu du volume cumulé.

### `GET /api/v1/errors/{fingerprint}` — détail d'un groupe
`data = { group: ErrorGroupRow, last: ErrorSample | null, occurrences: ErrorOccurrence[], trend: ErrorTrendPoint[], page: { limit, next_cursor }, sampling, enrichment }`
(source de vérité : `ErrorGroupDetailResult` dans `apps/console/lib/queries-errors.ts`).

Mêmes filtres et même fenêtre que la liste : `group.occurrences` est le nombre affiché par la ligne qu'on
vient d'ouvrir.

- **Résolution de l'app.** Une empreinte n'est unique que dans une app. Avec `app`, le groupe est cherché
  dans cette app (ramenée au périmètre comme ailleurs). Sans `app` (ou `app=all`), il est cherché dans tout
  le périmètre du principal : une seule app candidate → détail de celle-ci, dont `meta.app` porte
  l'identifiant ; plusieurs → **`400`** `fingerprint présent dans plusieurs apps : préciser app (<apps>)`,
  apps candidates limitées au périmètre ; aucune → `404`.
- `last` : dernière occurrence de la fenêtre filtrée (stack, release, `source:lineno:colno`, `route`,
  `view_name`, `trace_id`, `source_parent_span_id`, `error_source`, `handled`, `is_fatal`, `env`,
  `service`, `action_id`). `null` si aucune.
- `last.stack_symbolicated` / `last.symbolication_status` (P5.4) : stack réécrite en positions source
  par les source maps de la release, scrubbed. Écrite à l'ingestion, ou calculée à la lecture quand la
  map a été mise en ligne après l'erreur — sans changer `fingerprint`. `stack` reste la stack brute.
  Statuts : `resolved` ; `unavailable` (aucune map pour la release, ou positions absentes) ; `failed`
  (map inutilisable) ; `pending` (budget d'ingestion épuisé) ; `null` sans frame JavaScript. Le code
  source des maps n'est jamais exposé par l'API.
- `occurrences` : de la plus récente à la plus ancienne (`ts`, `id`), chacune avec ses propres `ts`,
  `release`, `device_type`, `trace_id`… et ses `links` :
  `session` (une session de la même app existe), `replay` (cette session a aussi un enregistrement),
  `trace` (la trace existe dans la même app), `parent_span` (le span parent y existe aussi), `action`
  (`{ id, name, type }` de l'action causale, dans la même app et la même session, ou `null`). Un lien à
  `false` veut dire que la relation n'existe pas dans la même app : `session_id` et `trace_id` sont émis
  par le client, et une erreur forgée ne doit pas ouvrir la session ou la trace d'un autre tenant.
- **Pagination par curseur.** `limit` 1..100 (défaut 100). `page.next_cursor` n'est renseigné que si la
  page est pleine ; le renvoyer tel quel dans `cursor`, avec les mêmes filtres. Il conserve les
  microsecondes PostgreSQL : deux occurrences à 1 µs d'écart ne sont jamais perdues entre deux pages. Un
  curseur modifié reçoit `400` `cursor invalide`.
- `400` `fingerprint invalide` (vide, plus de 64 caractères ou caractère de contrôle) ; `404` `groupe
  d'erreurs introuvable` si le groupe n'a aucune occurrence sur cette fenêtre avec ces filtres, ou pour une
  session viewer sans aucune app.

### `GET /api/v1/issues` — issues d'erreurs
`data = { issues: IssueEntry[], total, next_cursor, sampling: ErrorSampling, coverage: IssueCoverage }`
(sources de vérité : `IssueListResult` dans `apps/console/lib/error-issues.ts`, schéma `IssueList` de la
spec OpenAPI).

**Même population que `/errors`** (fenêtre, `app`, `device`, bots et apps internes exclus), plus deux
filtres d'occurrence : `release` (exacte, 200 caractères au plus) et `source` (`browser_js`, `node`…). Chaque
occurrence est comptée **une fois**, dans une seule entrée :

- `kind: "issue"` (`id` UUID) — occurrences rattachées à l'issue à l'ingestion, plus celles, antérieures, dont
  l'empreinte historique n'est reprise que par CETTE issue ;
- `kind: "legacy"` (`fingerprint`) — groupe historique qu'aucune issue ne reprend seule : app sans
  regroupement v2, occurrences antérieures à l'activation, ou empreinte répartie sur plusieurs issues.

| Champ | Sens |
|---|---|
| impact | mêmes champs que les groupes d'erreurs (`occurrences`, `sessions_affected`, `visitors_affected`, `identified_users_affected`, couvertures), sur la fenêtre |
| `status` | `open`, `for_review` (statuts historiques divergents à trancher), `resolved`, `ignored` ; un groupe historique n'est jamais `for_review` |
| `reappeared` | résolue puis revue depuis : réapparition **à vérifier**, pas une régression confirmée |
| `origin` | `new` ou `migration` (clé v2 recouvrant un groupe historique déjà vu : jamais présentée comme nouveau bug) |
| `grouping_basis` | `override`, `symbolicated_frame`, `normalized_frame`, `low_confidence` |
| `first_seen`, `last_seen` | issue : cycle de vie persisté, groupes historiques repris compris ; groupe historique : première apparition connue et dernière occurrence de la fenêtre |
| `revision` | bigint en chaîne, pour la concurrence optimiste des futures décisions de triage |

`coverage` : `available` (migration v72 appliquée), `active_apps` (apps du périmètre où le regroupement v2 est
actif), nombre d'`issues` et de `legacy_groups`, `occurrences_in_issues`, `occurrences_legacy`,
`occurrences_low_confidence` et `issue_share` (part des occurrences rattachées à une issue, `null` sans
occurrence). `status` filtre les entrées, jamais les occurrences : il ne change pas les nombres d'une issue.

Tri : à revoir, réapparitions, ouvertes, résolues, ignorées ; puis impact (visiteurs, sessions, inconnus en
dernier), occurrences, dernière vue, `app_id` et référence pour un ordre total. Pagination **par curseur
uniquement** : `limit` 1..100 (défaut 50) ; `next_cursor`, renseigné quand la page est pleine, se renvoie tel
quel dans `cursor` avec les mêmes filtres. `400` pour `status`, `source`, `release` ou `cursor` hors contrat ;
`403` `aucune application autorisée` pour une session viewer sans app.

### `GET /api/v1/issues/{id}` — détail d'une issue
`data = { issue: IssueRecord, impact: ErrorImpact, trend: ErrorTrendPoint[], last_sample: ErrorSample | null, occurrences: ErrorOccurrence[], next_cursor, sampling }`
(source de vérité : `IssueDetailResult` dans `apps/console/lib/error-issues.ts`).

- **L'identifiant fait foi.** L'UUID d'une issue est global : les chiffres sont ceux de son app, annoncée
  par `meta.app`, quelle que soit `app` dans la requête. Hors du périmètre du principal : `404`.
- `issue` : état persisté (`status`, `status_source`, `origin`, `grouping_basis`, première et dernière vue et
  release, résolution, `revision`), `grouping_active` (`false` après un retour arrière : l'issue reste
  lisible, ses nouvelles occurrences ne lui sont plus rattachées) et `legacy_groups` — chaque empreinte
  historique reprise avec son statut au rattachement (`legacy_status`, `null` si elle n'avait jamais été vue),
  son statut actuel, sa `note` de triage relue telle quelle, et le nombre d'`issues` qui la reprennent.
- `impact`, `trend`, `last_sample`, `occurrences` : mêmes définitions et mêmes liens vérifiés que
  `/errors/{fingerprint}`, sur la fenêtre et les filtres demandés ; `last_sample` porte aussi
  `stack_symbolicated` et `symbolication_status` (P5.4). Une issue sans occurrence sur la fenêtre répond
  `200` avec un impact nul, jamais `404`.
- Occurrences paginées par curseur : `limit` 1..100 (défaut 100), `next_cursor` à renvoyer dans `cursor`.
- `400` `id invalide (UUID attendu)` ou `cursor invalide` ; `404` `issue introuvable`.

### `GET /api/v1/issues/{id}/activity` — historique d'une issue
`data = { activities: IssueActivity[], next_cursor }` (source de vérité : `IssueActivity` dans
`apps/console/lib/error-issue-workflow.ts`, schéma `IssueActivityPage` de la spec OpenAPI).

- Lecture : session ou jeton, dans le périmètre du principal. L'identifiant fait foi : `meta.app` est l'app de
  l'issue ; hors périmètre, `404`.
- `kind` : `status` (ancien et nouveau statut ; une résolution porte sa release et son env de référence),
  `assignee` (ancien et nouvel assigné), `comment` (texte scrubbé ; `legacy_fingerprint` quand c'est la note
  d'un groupe historique reprise une seule fois), `link` (lien de ticket) et `regression` (release qui a rouvert
  l'issue et release de référence dépassée). `actor` : `user` (compte console, `email` null s'il a été
  supprimé) ou `system`. Jamais de stack, de message d'erreur ni d'identité RUM.
- Le plus récent d'abord ; `limit` 1..100 (défaut 50) ; `next_cursor` (horodatage à la microseconde et
  identifiant) à renvoyer dans `cursor`. `400` `id invalide (UUID attendu)` ou `cursor invalide` ; `503` avant
  migration-v73.

### `GET /api/v1/sessions` — sessions récentes
`data.sessions: SessionRow[]`.

### `GET /api/v1/sessions/{id}` — détail d'une session
`data = { meta: SessionMeta, timeline: TimelineItem[] }`. `404` si inconnue ou
hors-scope (un `viewer` ne lit que ses apps).

### `GET /api/v1/events` — journal RUM unifié
`data = { events: EventIndexRow[], page: { limit, offset } }`, trié de façon stable
par `ts DESC, id DESC`. La projection ne contient que `app_id`, `session_id`, `ts`,
route scrubbed, normalisée et plafonnée, `kind`, libellé source de taxonomie fermée et
`source_span_id` OTLP hexadécimal : jamais de props,
message/stack, URL brute, UA ou identité visiteur.

- `kind` est optionnel et fermé à `pageview`, `vital`, `error`, `resource`, `longtask`,
  `breadcrumb`, `event`, `span` ; toute autre valeur reçoit `400`.
- `limit` est borné à `1..200` (défaut `100`) ; `offset` est borné à `10 000`.
- `id` est un `bigint` PostgreSQL sérialisé en chaîne décimale (`int64`) afin de ne
  jamais perdre de précision côté JavaScript.
- Le scope `app` est appliqué avant la requête : un viewer ou jeton scopé ne peut lire
  qu'une app autorisée, même en demandant une autre valeur. Cette liste parcourt la
  rétention disponible ; `period` et `device` ne la filtrent pas.

La projection commence avec la migration v65 : aucun backfill historique n'est lancé
automatiquement. Le collecteur actif est le chemin Node (`/api/ingest/v1/traces`).
Le receiver Edge Supabase, conservé pour les installations historiques, applique lui
aussi les écritures progressives v65/v66/v67 : table ou colonne optionnelle absente
n'annule jamais les écritures sources du lot.

### `GET /api/v1/tracing` — tracing distribué
`data = { coverage: TraceCoverage, apiCalls: ApiCallRow[], backRoutes: BackRouteRow[] }`.

### `GET /api/v1/correlation` — corrélation front/back
`data = { cards: CorrCardRow[], blindSpots: BlindSpotRow[] }`.

### `GET /api/v1/health-grid` — heatmap santé
`data = { grid: HealthGridCell[], dailyTraffic: DailyTraffic[] }`
(cellule = une heure, jour×heure ; + trafic quotidien).

### Performance IA — **déplacé hors de cette API**

> Trois endpoints figuraient ici : `GET /api/v1/ai`, `GET /api/v1/ai/costs` et
> `GET /api/v1/ai/credits`. **Ils n'existent plus** — la supervision IA a été extraite
> vers le service **xSOM AI Guard**, qui en est désormais la source de vérité unique
> (ADR-0001, `docs/EXTRACTION_XSOM_AI_GUARD.md`). Aucun fichier de route ne leur
> correspond dans `apps/console/app/api/v1/` : un client qui les appelle reçoit un **404**.
>
> Ils sont restés documentés ici après leur suppression. Le descripteur
> `GET /api/v1` les annonçait aussi, et a été corrigé depuis ; ce document ne l'avait pas
> été. Un test verrouille désormais la correspondance entre les endpoints décrits dans ce
> fichier et les routes qui existent réellement — voir `tests/unit/api-doc-verite.test.ts`.
>
> **Où lire les données IA aujourd'hui** : `GET /api/rum/summary`
> (`docs/RUM_READ_API.md`) porte la moitié IA sous les champs `ai_*`, servie par xSOM.
> Quand xSOM est indisponible, la section est marquée `unavailable` avec des champs vides —
> **aucun recalcul local**, donc jamais de chiffre inventé pour combler.

---

## Endpoints de service

Trois routes qui ne portent pas d'agrégats, et qu'un client a pourtant besoin de connaître.

### `GET /api/v1/health` — liveness
`data = { status, version }`. **Sans authentification** : un contrôle de vivacité qui exigerait
un jeton ne dirait rien à un superviseur qui n'en a pas. Ne touche pas la base — c'est
délibéré : cette route doit répondre même quand la base est en panne, sinon elle mesure
autre chose que ce qu'elle annonce.

### `GET /api/v1/openapi` — spec machine
Spec **OpenAPI 3.0** en JSON, sans authentification. Construite à partir des mêmes schémas
que les réponses (`lib/api/openapi.ts`) : elle ne peut pas décrire un champ que le code
ne renvoie pas.

### `GET /api/v1/docs` — Swagger UI
Page HTML (pas de JSON, pas d'enveloppe `{ meta, data }`), sans authentification. Rend la
spec ci-dessus lisible dans un navigateur.

---

## Écritures

Quatre routes non-`GET`, annoncées séparément dans le descripteur `GET /api/v1` (champ `write`) plutôt
que noyées dans l'énumération des lectures. Tout le reste de `/api/v1` est en lecture seule.

### `POST /api/v1/deploys` — marqueur de déploiement
Enregistre un marqueur de déploiement depuis une chaîne d'intégration continue, ce qui permet aux écrans de
dater une régression par rapport à une mise en production. Les marqueurs ordonnent aussi les releases d'une
app et d'un env pour confirmer la régression d'une issue (P5.6) : jamais d'ordre lexical ni SemVer.

### Garde commune des écritures d'une issue
Session admin de la console (cookie `mip_session`, rôle `admin`, jamais une session démo) et en-tête `Origin`
de la console : `401` sans session ; `403` pour un jeton d'API, une session viewer ou démo, ou une autre
origine ; `429` au-delà du débit ; `413` au-delà de 16 Kio ; `400` pour un JSON ou un contrat invalide ; `404`
pour une issue inconnue, hors périmètre ou d'une autre `app` que celle du corps ; `409` si `expectedRevision`
n'est plus la révision courante (corps `{ error, revision }` : recharger puis rejouer) ; `503` avant
migration-v73. Réponse `{ meta: { app, generatedAt }, data }`, jamais mise en cache. Chaque écriture
incrémente la révision, trace une activité et une entrée `audit_log` (sans le texte d'un commentaire).

### `POST /api/v1/issues/{id}/triage` — statut et assigné
Corps `{ app, status?, assigneeUserId?, expectedRevision }`, au moins `status` ou `assigneeUserId`
(`null` : désassigner). `status` : `open`, `for_review`, `resolved` ou `ignored`. L'assigné doit être un compte
actif autorisé sur l'app de l'issue (`console_user.apps` nul ou la contenant), sinon `400` ; l'assignation ne
change jamais le statut. Résoudre fige la **référence** : release et env de la dernière occurrence rattachée.
Une occurrence ultérieure ne rouvre l'issue que si sa release, dans cet env, a été déployée strictement après
la référence d'après les marqueurs de déploiement ; sinon la réapparition reste « à vérifier ». Une issue
ignorée le reste. Rien à changer : `200` sans nouvelle révision. `data = { issue: IssueWorkflowState }`.

### `POST /api/v1/issues/{id}/comments` — commentaire
Corps `{ app, body, expectedRevision }`. Le texte est scrubbé (e-mails, secrets, longues suites de chiffres)
puis borné à 2 000 caractères **après** masquage (`400` au-delà). `201`, `data = { activity, revision }`.

### `POST /api/v1/issues/{id}/links` — lien de ticket
Corps `{ app, url, label, expectedRevision }`. `url` : HTTPS, sans identifiants, normalisée (hôte en punycode,
caractères encodés), 2 048 caractères au plus ; `label` : une ligne scrubbée de 120 caractères. La même URL deux
fois sur une issue : `409`. `201`, `data = { link, activity, revision }`. Aucune synchronisation avec l'outil
de tickets (P8.6).

---

## Reproduire les graphes de supervision

> Correspondance **graphe de la console → endpoint → champs à tracer**, pour rejouer
> les visuels côté client (ex. plateforme UTI). Tous les champs ci-dessous sont dans
> l'objet `data` de l'enveloppe. Les seuils Core Web Vitals 2026 : LCP bon < 2000 ms /
> mauvais > 4000 ms · INP < 200 / > 500 · CLS < 0,1 / > 0,25.

| Graphe (page console) | Type conseillé | Endpoint | Champs (x → y) |
|---|---|---|---|
| Courbe LCP p75 vs seuils (`/`, `/forecast`) | aire ou ligne + lignes de seuil | `GET /vitals?series=LCP` | `series.LCP[].bucket` → `series.LCP[].p75` |
| Tuiles Core Web Vitals + tendance (`/`) | KPI / jauges | `GET /overview` | `vitals.current[].{name,p75}` vs `vitals.previous[]` ; `stats.current.{sessions,pageviews,errors}` vs `stats.previous` |
| Heatmap de santé jour × heure (`/`) | heatmap | `GET /health-grid` | `grid[].{day,hour,good_w,total_w}` → couleur = `good_w/total_w` |
| Trafic & fiabilité par jour (`/`, `/forecast`) | aire + ligne | `GET /health-grid` | `dailyTraffic[].day` → `pageviews` (aire) & `errors` (ligne) |
| Routes les plus lentes (`/pages`) | barres classées | `GET /pages` | `routes[].route` → `lcp_p75` (couleur = rating) ; `views` en libellé |
| Décomposition latence serveur vs réseau (`/tracing`) | barres empilées | `GET /tracing` | `apiCalls[]` : segment serveur = `back_p75`, réseau = `front_p75 − back_p75` |
| Routes backend p75/p95 (`/tracing`) | barres | `GET /tracing` | `backRoutes[].{route,p75,p95,err}` |
| Scatter corrélation robot ↔ réel (`/correlation`) | nuage de points | `GET /correlation` | `cards[]` : x = `syn_latency_avg` (robot), y = `rum_lcp_p75` (réel), taille = `rum_sessions` |
| Angles morts (`/correlation`) | table / barres | `GET /correlation` | `blindSpots[].{route,bucket,rum_lcp_p75,syn_latency_avg,gap_ms}` |
| Groupes d'erreurs (top) (`/errors`) | barres | `GET /errors` | `groups[].{error_type,sample_message,occurrences,sessions}` |
| Occurrences d'erreurs dans le temps (`/errors`) | barres | `GET /errors` | `trend[].bucket` → `trend[].occurrences` (population entière) |

### Non exposé par l'API (visuels console uniquement)

Ces graphes s'appuient sur des agrégats **non publiés** par `/api/v1` — les reproduire
demanderait un **nouvel endpoint** (petit ajout : la couche `lib/queries*.ts` existe déjà,
il ne reste qu'à l'exposer). À nous signaler si UTI en a besoin :

- **Erreurs empilées par groupe** — `/errors` renvoie la tendance de toute la population
  (`trend`), pas la série de chaque signature.
- **Robot vs réel _dans le temps_** — `/correlation` renvoie les cartes + angles morts
  (scalaires), pas la série horaire `v_correlation`.
- **Frustration** (scatter INP), **Expérience** (radar + tendance CSAT), **Sessions**
  (nouveaux/revenants), **Acquisition** (canaux), **Rétention** (cohortes), **Parcours**
  (Sankey/transitions), **Formulaires** (friction par champ), **Objectifs**, **SLO**
  (jauges de budget), **Alertes** (timeline), **Carte** (graphe de service) — aucun
  endpoint `/api/v1` dédié à ce jour.

> Pour un **tableau de bord partenaire en un seul appel** (sans gérer 10 endpoints), voir
> l'API `GET /rum/summary` (`docs/RUM_READ_API.md`) : elle agrège trafic, CWV, top routes,
> top erreurs et coûts IA dans une seule réponse — c'est le point d'entrée recommandé pour
> UTI. Utiliser `/api/v1/*` seulement pour le détail (série LCP, heatmap, tracing, etc.).

---

## Exemple de client (Angular / fetch)

```ts
// service Angular minimal — le jeton vit côté back/proxy, jamais dans le bundle navigateur.
const BASE = "https://rum.mip.example/api/v1";
const TOKEN = process.env.RUM_API_TOKEN; // côté serveur

async function rum<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`RUM API ${res.status}`);
  const { data } = await res.json();
  return data as T;
}

// ex. vue d'ensemble du client « partenaires » sur 7 jours
const overview = await rum("/overview", { app: "partenaires", period: "7d" });
```

> **Note SDK** : si MIP préfère l'unification totale (module Angular natif, option A du
> cadrage), cette API reste le socle data — la migration des vues se branche dessus.

### `GET /api/v1/actions` — Top Actions causal

Filtres communs `app`, `period`, `device` et pagination `limit`/`offset` (offset borné à 10 000). Le classement est déterministe : erreurs, temps lié, volume, puis clefs textuelles. Les erreurs, ressources et spans sont d'abord agrégés par `action_id` dans PostgreSQL avant la jointure, afin qu'une action ne soit jamais multipliée par ses différentes familles d'effets.

La réponse expose la liste paginée `actions`, un `summary` calculé sur toute la fenêtre filtrée, puis `page`. Le résumé contient notamment `actions`, `sessions`, `errors`, `error_clicks`, `resources`, `api_calls`, `resource_ms`, `api_ms` et `total_ms`. Quand `sampleRate < 1` est observé, `summary.sampling_notice` précise que ces volumes sont ceux de l'échantillon, sans extrapolation, et que le mode biaisé-erreurs peut sur-représenter les sessions en incident. Un viewer scopé ne peut pas élargir son périmètre avec `?app=`.
