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
  ],
  "ai_calls": 279,              // appels LLM backend rattachés à cette app
  "ai_tokens": 342300,          // tokens prompt + complétion, cumulés
  "ai_cost_usd": 0.5243,        // coût réel (facturation fournisseur), cumulé sur la fenêtre
  "ai_p75_latency_ms": 4820,    // latence p75 des appels IA, null si aucun appel
  "ai_error_rate": 0,           // part d'appels IA en erreur, null si aucun appel
  "ai_by_model": [               // top 10 par coût décroissant
    { "provider": "openrouter", "model": "gpt-4o-mini", "calls": 134, "tokens": 210000, "cost_usd": 0.29 }
  ],
  "ai_top_users": [               // top 10 par coût décroissant (user_hash anonymisé)
    { "user_hash": "a1b2c3...", "calls": 12, "cost_usd": 0.08 }
  ]
}
```

Une métrique indisponible vaut **`null`** (la clé n'est jamais omise).

## Reproduire les graphes avec `/rum/summary`

> Un **seul appel** suffit à alimenter un tableau de bord partenaire complet. Correspondance
> champ → graphe (tous les champs sont à la racine de la réponse) :

| Graphe | Type conseillé | Champs (x → y) |
|---|---|---|
| Trafic & charge par jour | aire / ligne | `series[].date` → `sessions`, `page_views`, `errors`, `avg_load_ms` |
| Tuiles Core Web Vitals + fiabilité | KPI / jauges | `p75_lcp_ms`, `p75_inp_ms`, `avg_load_ms`, `error_rate`, `frustration_signals` |
| Pages les plus consultées / lentes | barres classées | `top_routes[].route` → `views` ou `avg_ms` ; `errors` en libellé |
| Top erreurs | barres | `top_errors[].message` → `count` (`last_seen` en infobulle) |
| Coût IA par modèle | donut / barres | `ai_by_model[].{provider,model,cost_usd,calls,tokens}` |
| Coût IA par utilisateur | barres classées | `ai_top_users[].{user_hash,cost_usd,calls}` |
| Tuiles IA | KPI | `ai_calls`, `ai_tokens`, `ai_cost_usd`, `ai_p75_latency_ms`, `ai_error_rate` |

### Ce que `/rum/summary` ne couvre pas

`/rum/summary` expose des **scalaires + une série journalière trafic**. Pour ces visuels,
passer par `/api/v1/*` (jeton `CONSOLE_API_TOKENS@gip-plateforme`, cf. `docs/API_CONSOLE.md`) :

- **LCP p75 _dans le temps_** (courbe vs seuils) → `GET /api/v1/vitals?series=LCP`
- **Heatmap de santé jour × heure** → `GET /api/v1/health-grid`
- **INP / CLS p75 par route**, détail des routes lentes → `GET /api/v1/pages`
- **Décomposition de latence front/back** → `GET /api/v1/tracing`
- **Coût IA _par jour_** (série) et par route → `GET /api/v1/ai`

Les graphes Frustration, Expérience, Acquisition, Rétention, Parcours, Formulaires,
Objectifs, SLO, Alertes et Carte ne sont **exposés par aucune API** à ce jour (cf. la
section « Non exposé » de `docs/API_CONSOLE.md`) — nous les ouvrons sur demande.

## Notes techniques

- **avg_load_ms** = moyenne du **First Contentful Paint** (perception de « la page
  s'affiche »). `p75_lcp_ms` / `p75_inp_ms` = percentiles des Core Web Vitals LCP / INP.
- **error_rate** = part des sessions ayant au moins une erreur front.
- **ai_*** = agrégats des appels LLM backend (table `rum_ai`), même fenêtre/scope que le
  reste de la réponse. `ai_cost_usd` est le coût **réel** renvoyé par le fournisseur
  (pas une estimation). `ai_top_users` référence `user_hash` (anonymisé), jamais d'email
  ni d'IP.
- Tout est **scopé à l'app du token**, borné à la fenêtre, **bots exclus**, et les
  messages d'erreur sont **scrubbés côté serveur** (aucune PII). Un seul token/endpoint
  couvre désormais activité RUM **et** usage/coûts IA — plus besoin d'un second jeton
  `CONSOLE_API_TOKENS` pour un tableau de bord partenaire complet.

## Gestion des tokens (console admin)

`/admin/read-tokens` (admin only) : générer un token pour un `app_id` (affiché **une
seule fois** — seul le hash est stocké) et révoquer. Chaque action est tracée dans
`audit_log`. Table : `read_tokens (token_hash, app_id, label, created_at, revoked_at)`
— cf. `apps/ingest/sql/migration-v26.sql`.
