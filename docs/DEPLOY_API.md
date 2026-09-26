# Déploiement de l'API console v1

> API REST des agrégats RUM (`/api/v1/*`) : des lectures, plus une seule écriture de
> machine, le marqueur de déploiement de la CI (`POST /api/v1/deploys`). Contrat
> fonctionnel : [`docs/API_CONSOLE.md`](API_CONSOLE.md). Spec machine :
> `GET /api/v1/openapi` (OpenAPI 3.0.3, sans auth) → à brancher dans Swagger UI ou un
> générateur de clients ; `GET /api/v1/docs` la rend dans un navigateur.

## Qui sert l'API (au 26/09/2026)

- **En production** : la console Next.js sur Vercel (`mip-rum-console.vercel.app`), qui lit
  Neon directement (`DATABASE_URL`). Tant que le calcul Neon est suspendu (quota de l'offre
  gratuite dépassé le 24/09, jusqu'au 01/10/2026), les lectures qui touchent la base
  échouent ; `GET /api/v1/health`, qui ne la touche pas, répond.
- **Dans le code, pas encore en service** : le service `api` de Railway
  (`services/api`, [README](../services/api/README.md)) sert les mêmes routes, compilées
  depuis la console, en lecture seule (toute écriture y répond 405) ; toutes ses réponses
  portent `x-mip-api: 1`. La console peut lui relayer les lectures **au jeton** — jamais
  celles au cookie de session — par `apps/console/lib/api-relay.ts`. Le relais est éteint
  par défaut : le service n'est pas créé sur Railway, et le drapeau
  `platform_flag.api_relay_pct` arrive avec migration-v87, pas encore appliquée en
  production.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `CONSOLE_API_TOKENS` | Jetons machine (CSV) pour `Authorization: Bearer` : `jeton` (toutes apps) ou `jeton@app1;app2` (scopé). Vide = mode jeton désactivé. | — |
| `CONSOLE_API_ALLOWED_ORIGINS` | Origines CORS autorisées (CSV, ou `*`). Vide = same-origin only. | — |
| `CONSOLE_API_RATE_LIMIT` | Requêtes/min par principal (jeton ou utilisateur). `0` = throttling désactivé. | `120` |
| `AUTH_SECRET` | Secret JWT (déjà utilisé par la console) — pour le mode cookie. | requis (prod) |
| `DATABASE_URL` | Postgres lu par les agrégats (déjà utilisé). | requis (prod) |
| `CONSOLE_API_RELAY_URL` | URL du service `api` (https, sauf localhost). Absente = relais éteint. | — |
| `API_RELAY_PCT` | Part des lectures au jeton relayées, si `platform_flag.api_relay_pct` est absent. | `0` |
| `CONSOLE_API_RELAY_STRICT` | `1` = toute lecture au jeton part au service ; s'il ne répond pas, 503 au lieu du repli local. | — |

Sans les trois dernières, le relais est inerte — l'état attendu tant que le service `api` n'existe pas.

Génération d'un jeton : `openssl rand -hex 32`. Plusieurs jetons cohabitent (rotation sans coupure) :
mets-en deux, migre les clients, retire l'ancien.

Sur **Vercel** (projet `mip-rum-console`) : Settings → Environment Variables → ajouter
`CONSOLE_API_TOKENS` et `CONSOLE_API_ALLOWED_ORIGINS` (origine du front Angular MIP), puis redeploy.

## Authentification

- **Machine (recommandé pour le back Angular)** : `Authorization: Bearer <token>` (comparé en temps
  constant à `CONSOLE_API_TOKENS`). Accès lecture seule, toutes apps ou les apps du scope
  (`jeton@app`). Le jeton vit **côté serveur** du front (jamais dans le bundle navigateur).
- **Cookie de session** : cookie JWT `mip_session` de la console — respecte le RBAC (`viewer` scopé).
  En production, c'est le jeton HS256 que signe la console (`AUTH_SECRET`) ; le code accepte
  aussi le jeton ES256 de `console-api`, qui n'est pas encore émis (connexion par
  `console-api` non branchée).

Sans auth valide → `401`. Le middleware laisse passer `/api/v1` (auth dans le handler → 401 JSON, pas de redirection `/login`).

## Comportement HTTP

- **Enveloppe** : `{ meta, data }` (voir API_CONSOLE.md). Erreurs : `{ error, code?, parameter?, dimension? }`
  (`apps/console/lib/api/respond.ts`, `apps/console/lib/query-contract.ts`).
- **Filtres** : `app`, `period` (`1h|24h|7d`), `from`/`to`, `device` (`mobile|desktop|tablet|all`),
  dimensions et segment — détail dans API_CONSOLE.md.
- **Pagination** (`/errors`, `/sessions`, `/events`, `/actions`) : `limit` (1..200) & `offset` ; page
  effective renvoyée dans `data.page`. `/issues` et les occurrences paginent par `cursor`.
- **Cache** : `ETag` + `Cache-Control: private, max-age=15`. Renvoie `304` si `If-None-Match` correspond.
- **Rate limit** : en-têtes `RateLimit-Limit/Remaining/Reset` ; `429` + `Retry-After` au dépassement.
  Best-effort **par instance** serverless — pour un throttling strict, brancher un store partagé.

## Santé / readiness

- **Liveness** : `GET /api/v1/health` (sans auth) → `{ status: "ok", service, version, generatedAt }`
  (hors enveloppe). Ne touche pas la DB.
- **Readiness** (DB OK) : un appel authentifié `GET /api/v1/apps` → `200` signifie DB accessible.

## Exemples

```bash
# Découverte + spec
curl -H "Authorization: Bearer $TOKEN" https://rum.mip.example/api/v1
curl https://rum.mip.example/api/v1/openapi   # public

# Vue d'ensemble d'un client sur 7 jours
curl -H "Authorization: Bearer $TOKEN" \
  "https://rum.mip.example/api/v1/overview?app=gip-plateforme&period=7d"

# Sessions paginées
curl -H "Authorization: Bearer $TOKEN" \
  "https://rum.mip.example/api/v1/sessions?app=gip-plateforme&limit=20&offset=40"
```

```ts
// Client Angular (côté serveur/proxy — le jeton ne va JAMAIS dans le bundle navigateur)
const BASE = process.env.RUM_API_BASE!;      // https://rum.mip.example/api/v1
const TOKEN = process.env.RUM_API_TOKEN!;
async function rum<T>(path: string, params: Record<string,string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`RUM API ${res.status}`);
  return (await res.json()).data as T;
}
```

## Checklist prod

- [ ] `CONSOLE_API_TOKENS` défini (≥ 1 jeton fort) sur l'hébergeur de la console.
- [ ] `CONSOLE_API_ALLOWED_ORIGINS` = origine(s) du front Angular (pas `*` en prod).
- [ ] `CONSOLE_API_RATE_LIMIT` ajusté au trafic serveur-à-serveur attendu.
- [ ] `GET /api/v1/health` → 200 ; `GET /api/v1/apps` (avec jeton) → 200 (DB OK).
- [ ] Spec `GET /api/v1/openapi` importée dans l'outillage client (Swagger/codegen).
