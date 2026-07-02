# Déploiement de l'API console v1

> API REST **lecture seule** des agrégats RUM (`/api/v1/*`), servie par la console Next.js.
> Contrat fonctionnel : [`docs/API_CONSOLE.md`](API_CONSOLE.md). Spec machine :
> `GET /api/v1/openapi` (OpenAPI 3.0, sans auth) → à brancher dans Swagger UI ou un
> générateur de clients.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `CONSOLE_API_TOKENS` | Jetons machine (CSV) pour `Authorization: Bearer`. Vide = mode jeton désactivé. | — |
| `CONSOLE_API_ALLOWED_ORIGINS` | Origines CORS autorisées (CSV, ou `*`). Vide = same-origin only. | — |
| `CONSOLE_API_RATE_LIMIT` | Requêtes/min par principal (jeton ou utilisateur). `0` = throttling désactivé. | `120` |
| `AUTH_SECRET` | Secret JWT (déjà utilisé par la console) — pour le mode cookie. | requis (prod) |
| `DATABASE_URL` | Postgres lu par les agrégats (déjà utilisé). | requis (prod) |

Génération d'un jeton : `openssl rand -hex 32`. Plusieurs jetons cohabitent (rotation sans coupure) :
mets-en deux, migre les clients, retire l'ancien.

Sur **Vercel** (projet `mip-rum-console`) : Settings → Environment Variables → ajouter
`CONSOLE_API_TOKENS` et `CONSOLE_API_ALLOWED_ORIGINS` (origine du front Angular MIP), puis redeploy.

## Authentification

- **Machine (recommandé pour le back Angular)** : `Authorization: Bearer <token>` (comparé en temps
  constant à `CONSOLE_API_TOKENS`). Accès lecture seule, toutes apps. Le jeton vit **côté serveur**
  du front (jamais dans le bundle navigateur).
- **Cookie de session** : cookie JWT `mip_session` de la console — respecte le RBAC (`viewer` scopé).

Sans auth valide → `401`. Le middleware laisse passer `/api/v1` (auth dans le handler → 401 JSON, pas de redirection `/login`).

## Comportement HTTP

- **Enveloppe** : `{ meta, data }` (voir API_CONSOLE.md). Erreurs : `{ error }`.
- **Filtres** : `app`, `period` (`1h|24h|7d`), `device` (`mobile|desktop|tablet|all`).
- **Pagination** (`/errors`, `/sessions`) : `limit` (1..200) & `offset` ; page effective renvoyée dans `data.page`.
- **Cache** : `ETag` + `Cache-Control: private, max-age=15`. Renvoie `304` si `If-None-Match` correspond.
- **Rate limit** : en-têtes `RateLimit-Limit/Remaining/Reset` ; `429` + `Retry-After` au dépassement.
  Best-effort **par instance** serverless — pour un throttling strict, brancher un store partagé.

## Santé / readiness

- **Liveness** : `GET /api/v1/health` (sans auth) → `{ status: "ok", ... }`. Ne touche pas la DB.
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
