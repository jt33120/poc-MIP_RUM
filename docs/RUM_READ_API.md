# API de lecture RUM propriétaire — `/api/rum/summary`

> Livrable : une API **lecture seule**, authentifiée par **token en base** (hashé,
> scopé à un `app_id`), pour qu'une app cliente (ex. UTI / `gip-plateforme`) affiche
> **ses** métriques RUM dans sa page « Supervision ». Appel **serveur-à-serveur** :
> le token reste côté backend client (jamais dans le navigateur). **Aucune PII** —
> agrégats techniques uniquement.

## URL de base

```
https://mip-rum-console.vercel.app/api
```

Côté client : `MIP_RUM_READ_URL=https://mip-rum-console.vercel.app/api` et
`MIP_RUM_READ_TOKEN=<token>`. L'appel se fait sur `${MIP_RUM_READ_URL}/rum/summary`.

## Endpoint

```
GET /rum/summary?app=<app_id>&window=<24h|7d|30d>
Authorization: Bearer <token>
```

- **Auth** : le token est cherché par son **hash** (sha256) dans `read_tokens`, doit
  être **non révoqué**, et son `app_id` doit **égaler** le paramètre `app` — sinon
  `401` (token invalide/révoqué) ou `403` (mauvaise app). Si `app` est omis, il est
  déduit du token.
- **`window`** : `24h` | `7d` | `30d` (défaut `30d`).
- **Rate-limit** : `RUM_READ_RATE_LIMIT` req/min/token (défaut 60) → `429` + `Retry-After`.

## Exemple d'appel

```bash
curl -s -H "Authorization: Bearer $MIP_RUM_READ_TOKEN" \
  "https://mip-rum-console.vercel.app/api/rum/summary?app=gip-plateforme&window=30d"
```

## Contrat de réponse (stable)

```jsonc
{
  "app": "gip-plateforme",
  "window": "30d",
  "generated_at": "2026-07-09T09:00:00.000Z",
  "sessions": 92,               // sessions distinctes (bots exclus)
  "users": 17,                  // utilisateurs distincts (user_hash anonymisé)
  "page_views": 1971,
  "avg_load_ms": 1210,          // temps de chargement moyen (FCP), null si indispo
  "p75_lcp_ms": 1835,           // LCP p75, null si indispo
  "p75_inp_ms": 180,            // INP p75, null si indispo
  "error_rate": 0.012,          // sessions en erreur / sessions, null si 0 session
  "frustration_signals": 44,    // rage + dead clicks
  "series": [                   // un point par jour de la fenêtre
    { "date": "2026-07-01", "sessions": 40, "page_views": 300, "errors": 2, "avg_load_ms": 810 }
  ],
  "top_routes": [               // top 10 par vues
    { "route": "/aos/:id", "views": 1200, "avg_ms": 940, "errors": 3 }
  ],
  "top_errors": [               // top 10 par fréquence (message scrubbé, tronqué 200)
    { "message": "TypeError: ...", "count": 12, "last_seen": "2026-07-08T12:00:00.000Z" }
  ]
}
```

Une métrique indisponible vaut **`null`** (la clé n'est jamais omise).

## Notes techniques

- **avg_load_ms** = moyenne du **First Contentful Paint** (perception de « la page
  s'affiche »). `p75_lcp_ms` / `p75_inp_ms` = percentiles des Core Web Vitals LCP / INP.
- **error_rate** = part des sessions ayant au moins une erreur front.
- Tout est **scopé à l'app du token**, borné à la fenêtre, **bots exclus**, et les
  messages d'erreur sont **scrubbés côté serveur** (aucune PII).

## Gestion des tokens (console admin)

`/admin/read-tokens` (admin only) : générer un token pour un `app_id` (affiché **une
seule fois** — seul le hash est stocké) et révoquer. Chaque action est tracée dans
`audit_log`. Table : `read_tokens (token_hash, app_id, label, created_at, revoked_at)`
— cf. `apps/ingest/sql/migration-v26.sql`.
