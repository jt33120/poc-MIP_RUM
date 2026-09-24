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
  "users": 17,                  // visiteurs distincts (visitor_id, tirage aléatoire du SDK)
  "unidentified_sessions": 4,   // sessions SANS identifiant de visiteur, donc hors de `users`
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
  // --- Section IA : servie EXCLUSIVEMENT par xSOM AI Guard (façade). Si xSOM est
  //     injoignable, ai_status="unavailable" et tous les ai_* valent null / [] -----
  "ai_status": "ok",            // "ok" | "unavailable"
  "ai_calls": 279,              // appels LLM backend (null si ai_status="unavailable")
  "ai_tokens": 342300,          // tokens prompt + complétion, cumulés
  "ai_cost_usd": 0.5243,        // coût réel (facturation fournisseur), cumulé sur la fenêtre
  "ai_p75_latency_ms": 4820,    // latence p75 des appels IA, null si aucun appel
  "ai_error_rate": 0,           // part d'appels IA en erreur, null si aucun appel
  "ai_by_model": [               // top 10 par coût décroissant
    { "provider": "openrouter", "model": "gpt-4o-mini", "calls": 134, "tokens": 210000, "cost_usd": 0.29 }
  ],
  "ai_top_users": [               // top 10 par coût décroissant (user_hash anonymisé)
    { "user_hash": "a1b2c3...", "calls": 12, "cost_usd": 0.08 }
  ],
  "ai_by_operation": [            // ventilation par fonction IA × route (top 100 par coût).
                                  // `operation` renvoyé BRUT (valeurs métier du client, jamais renommé) ;
                                  // `operation`/`route` peuvent être null (appels non catégorisés).
    {
      "operation": "extraction", "route": "matching/extract",
      "calls": 194, "cost_usd": 0.8975, "tokens": 317089,
      "p75_latency_ms": 4018.7, "ttft_p75_ms": null, "error_rate": 0,
      "anomaly": false,          // true si coût 24 h anormal (z > 3) vs baseline journalière
      "anomaly_score": null,     // z-score du coût (null hors anomalie). Détection auto, sans seuil.
      // --- qualité par fonction (« coûte cher ET déçoit ») : 0..1, null si non mesurable ---
      "refusal_rate": 0,         // part d'appels refusés par le modèle (error_type refus/guardrail/safety)
      "regen_rate": 0,           // régénérations / appels — 0 tant qu'UTI n'émet pas l'event (cf. § Signaux qualité)
      "thumbs_down_rate": null,  // 👎 / (👍+👎) — null si aucun pouce
      "csat": null               // CSAT des sessions ayant utilisé la fonction (notes ≥ 4/5), null si aucun feedback
    }
  ],
  "ai_series": [                  // un point par JOUR de la fenêtre (jours creux : calls 0, latence null)
    { "date": "2026-07-14", "calls": 238, "cost_usd": 1.3675, "p75_latency_ms": 8775.6, "error_rate": 0 }
  ]
}
```

Une métrique indisponible vaut **`null`** (la clé n'est jamais omise). La **section IA**
est servie par **xSOM AI Guard** via façade : si xSOM est injoignable, `ai_status` vaut
`"unavailable"` et tous les `ai_*` sont `null` (scalaires) ou `[]` (listes) — **jamais de
faux « 0 »** (le consommateur doit afficher « indisponible »). Sinon `ai_status="ok"`.

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
| **Perf IA par fonction** | barres / tableau | `ai_by_operation[].{operation,route,calls,cost_usd,tokens,p75_latency_ms,ttft_p75_ms,error_rate}` |
| **Anomalie coût par fonction** | badge / tri | `ai_by_operation[].{anomaly,anomaly_score}` (z-score du coût 24 h vs baseline) |
| **Qualité par fonction** (« coûte cher ET déçoit ») | tableau croisé coût×qualité | `ai_by_operation[].{refusal_rate,regen_rate,thumbs_down_rate,csat}` |
| **Série IA journalière** (latence sur volume) | ligne + barres | `ai_series[].date` → `calls`, `cost_usd`, `p75_latency_ms`, `error_rate` |

### Signaux qualité IA — état réel du contrat

> ⚠️ **Trois des quatre signaux qualité ne sont pas alimentés aujourd'hui, et ne
> peuvent pas l'être en l'état.** Un consommateur doit les traiter comme
> **absents**, jamais comme « 0 = parfait ».

Depuis la scission de la supervision IA (cf. [ADR-0001](./ADR-0001-supervision-ia-xsom.md)),
c'est **xSOM AI Guard** qui sert toute la section `ai_*`. Or trois de ces signaux se
calculent à partir d'événements **du produit RUM**, stockés dans `rum_event` côté
`mip-rum` — que xSOM n'a aucun moyen d'observer.

| Champ | Source de calcul | Servi par xSOM ? |
|---|---|---|
| `refusal_rate` | `error_type` de l'appel LLM | ✅ oui |
| `regen_rate` | événement RUM `ai_regenerate` | ❌ donnée côté MIP |
| `thumbs_down_rate` | événement RUM `ai_feedback` | ❌ donnée côté MIP |
| `csat` | événement RUM `feedback` (grain session) | ❌ donnée côté MIP |

Émettre les événements côté client **ne suffit donc pas** : ils atterrissent en
`rum_event` chez `mip-rum`, pas chez xSOM. Le chemin de retour MIP → xSOM
n'existe pas encore. En production au 29 juillet 2026, `rum_event` ne contient
d'ailleurs aucun `ai_regenerate` ni `ai_feedback` — ces champs sont vides depuis
leur création.

**Ce que cela implique pour un intégrateur :** ne construisez aucun visuel, seuil
ou alerte sur `regen_rate`, `thumbs_down_rate` ou `csat`. `refusal_rate` reste
exploitable. Les quatre champs demeurent **présents et nullables** dans la réponse
— ils ne disparaîtront pas sans préavis.

**Trois issues possibles**, à trancher avec l'équipe xSOM :

1. la façade MIP complète la réponse de xSOM avec les trois champs calculés
   localement — simple, mais réintroduit du calcul IA côté MIP, ce que l'ADR-0001
   proscrit ;
2. MIP pousse les événements d'expérience vers un endpoint xSOM dédié — respecte
   la frontière, demande un développement côté xSOM (**cible recommandée**) ;
3. retirer les trois champs du contrat et assumer que la qualité perçue relève du
   RUM, hors du résumé IA.

`refusal_rate` = part d'appels dont `error_type` matche
`refus|content_filter|guardrail|safety|moderation` (insensible à la casse) —
émettre l'`error_type` en conséquence pour qu'il compte. Toutes les valeurs
qualité sont des **fractions 0..1** (comme `error_rate`), `null` si non mesurable.

### Ce que `/rum/summary` ne couvre pas

`/rum/summary` expose des **scalaires + une série journalière trafic**. Pour ces visuels,
passer par `/api/v1/*` (jeton `CONSOLE_API_TOKENS@gip-plateforme`, cf. `docs/API_CONSOLE.md`) :

- **LCP p75 _dans le temps_** (courbe vs seuils) → `GET /api/v1/vitals?series=LCP`
- **Heatmap de santé jour × heure** → `GET /api/v1/health-grid`
- **INP / CLS p75 par route**, détail des routes lentes → `GET /api/v1/pages`
- **Décomposition de latence front/back** → `GET /api/v1/tracing`
- **Détail IA** (coût par jour/route, appels récents, gouvernance) → **console xSOM AI
  Guard** : la supervision IA a quitté mip-rum (ADR-0001) ; `/api/v1/ai*` n'existe plus.

Les graphes Frustration, Expérience, Acquisition, Rétention, Parcours, Formulaires,
Objectifs, SLO, Alertes et Carte ne sont **exposés par aucune API** à ce jour (cf. la
section « Non exposé » de `docs/API_CONSOLE.md`) — nous les ouvrons sur demande.

## Notes techniques

- **avg_load_ms** = moyenne du **First Contentful Paint** (perception de « la page
  s'affiche »). `p75_lcp_ms` / `p75_inp_ms` = percentiles des Core Web Vitals LCP / INP.
- **error_rate** = part des sessions ayant au moins une erreur front.
- **ai_*** = agrégats des appels LLM backend, **servis par xSOM AI Guard** (source de
  vérité unique ; mip-rum n'ingère ni ne calcule plus l'IA — ADR-0001). `/rum/summary`
  agit en **façade** : `ai_status="ok"` + valeurs xSOM, ou `ai_status="unavailable"` +
  `ai_*` null/[] si xSOM est injoignable (jamais de recalcul local). `ai_top_users`
  référence `user_hash` (anonymisé), jamais d'email ni d'IP.
- Tout est **scopé à l'app du token**, borné à la fenêtre, **bots exclus**, et les
  messages d'erreur sont **scrubbés côté serveur** (aucune PII). Un seul token/endpoint
  couvre l'activité RUM **et** (via la façade xSOM) l'usage/coûts IA.

## Gestion des tokens (console admin)

`/admin/read-tokens` (admin only) : générer un token pour un `app_id` (affiché **une
seule fois** — seul le hash est stocké) et révoquer. Chaque action est tracée dans
`audit_log`. Table : `read_tokens (token_hash, app_id, label, created_at, revoked_at)`
— cf. `packages/db/sql/migration-v26.sql`.
