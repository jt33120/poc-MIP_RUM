# API console RUM — contrat v1 (LOT C, option B)

> **But** : exposer les agrégats RUM via une **API REST stable**, consommable par le
> front **Angular de MIP** (ou tout autre client) **sans réécrire la console**. C'est
> l'option B du cadrage (`docs/CADRAGE_LOT_C.md`) : découplage, console livrable seule,
> migration incrémentale. L'API réutilise la couche data existante (`lib/queries*.ts`,
> `lib/health.ts`) — **aucune logique SQL dupliquée**.

- **Base** : `/api/v1` (servie par la console Next.js).
- **Lecture seule** : que des `GET`. Aucune mutation exposée.
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

Erreurs : `{ "error": "message" }` avec le statut HTTP (`401`, `404`, `500`).

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
`data = { groups: ErrorGroupRow[], unfingerprinted: number }`.

### `GET /api/v1/errors/{fingerprint}` — détail d'un groupe
`data: ErrorGroupDetail` (groupe + dernier échantillon avec stack + occurrences).
`404` si le fingerprint est inconnu (sur le scope).

### `GET /api/v1/sessions` — sessions récentes
`data.sessions: SessionRow[]`.

### `GET /api/v1/sessions/{id}` — détail d'une session
`data = { meta: SessionMeta, timeline: TimelineItem[] }`. `404` si inconnue ou
hors-scope (un `viewer` ne lit que ses apps).

### `GET /api/v1/tracing` — tracing distribué
`data = { coverage: TraceCoverage, apiCalls: ApiCallRow[], backRoutes: BackRouteRow[] }`.

### `GET /api/v1/correlation` — corrélation front/back
`data = { cards: CorrCardRow[], blindSpots: BlindSpotRow[] }`.

### `GET /api/v1/health-grid` — heatmap santé
`data = { grid: HealthGridCell[], dailyTraffic: DailyTraffic[] }`
(cellule = une heure, jour×heure ; + trafic quotidien).

### `GET /api/v1/ai` — performance IA
`data = { overview: AiOverview, byModel: AiModelRow[], byRoute: AiRouteRow[], daily: AiDailyRow[], recent: AiCallRow[] }`.
Coût (`cost_usd`), tokens, latence p75 et **taux d'erreur** — en global, par modèle/fournisseur,
par route, en série journalière, plus les **derniers appels** (dont les **échecs** :
`status='error'`, `error_type` — ex. OpenRouter en échec). `rum_ai` n'a pas de notion
d'appareil : seuls `app` et `period` s'appliquent (`device` ignoré). `?recent=N` borne les
derniers appels (0..200, défaut 50 ; `0` = aucun). Sources : `lib/queries-ai.ts`.

### `GET /api/v1/ai/costs` — coût IA par dimension
`data = { group_by, rows, unattributed? }`. `?group_by=user` (défaut) agrège le coût **par
utilisateur** (`user_hash` anonymisé, join `rum_ai.session_id → rum_session.user_hash`) et
ajoute `unattributed` (appels sans session ou sans `user_hash`) ; `?group_by=model|route`
réutilise les agrégats correspondants. `?limit=1..500` (défaut 100) pour `group_by=user`.
La dimension est validée par allowlist (`lib/ai-costs.ts`) — anti-injection.

### `GET /api/v1/ai/credits` — solde OpenRouter
`data = { status, balance, total_credits, total_usage, threshold, currency, checked_at }`
(ou `{ status: null, note }` tant qu'aucun relevé). `status` vaut `ok` ou `low` — le front
affiche le **warning rouge** quand `low` (solde < seuil, défaut 5, `OPENROUTER_LOW_BALANCE`).
Le relevé est produit par le cron **`/api/cron/openrouter-balance`** (Vercel Cron, clé
`OPENROUTER_API_KEY` en env) ; l'alerte « solde bas » émet un `alert_event` routé vers
webhook/slack (e-mail = stub existant, cf. `docs/ALERTING.md`). Compte OpenRouter global :
`app`/`period` sans effet. Sources : `lib/openrouter.ts`, `lib/queries-openrouter.ts`.

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
| Coût LLM par jour (`/ai`) | ligne + volume | `GET /ai` | `daily[].day` → `cost_usd` (ligne) & `calls` (barres) |
| Coût / usage par modèle (`/ai`) | donut ou barres | `GET /ai` | `byModel[].{provider,model,cost_usd,calls,total_tokens}` |
| Scatter corrélation robot ↔ réel (`/correlation`) | nuage de points | `GET /correlation` | `cards[]` : x = `syn_latency_avg` (robot), y = `rum_lcp_p75` (réel), taille = `rum_sessions` |
| Angles morts (`/correlation`) | table / barres | `GET /correlation` | `blindSpots[].{route,bucket,rum_lcp_p75,syn_latency_avg,gap_ms}` |
| Groupes d'erreurs (top) (`/errors`) | barres | `GET /errors` | `groups[].{error_type,sample_message,occurrences,sessions}` |

### Non exposé par l'API (visuels console uniquement)

Ces graphes s'appuient sur des agrégats **non publiés** par `/api/v1` — les reproduire
demanderait un **nouvel endpoint** (petit ajout : la couche `lib/queries*.ts` existe déjà,
il ne reste qu'à l'exposer). À nous signaler si UTI en a besoin :

- **Erreurs par heure empilées (24 h)** — `/errors` ne renvoie que les compteurs agrégés,
  pas la série horaire par signature.
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
