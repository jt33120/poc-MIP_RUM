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
   virgules, comparaison à temps constant). Accès **lecture seule, toutes apps**.
   👉 mode recommandé pour le **back Angular MIP** (appel serveur-à-serveur).
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
