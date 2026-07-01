# RAPPORT DE NUIT — Sprint v0.2 (10→11/06/2026)

Pour Julian, au réveil. Verdict : **les 4 phases du ROADMAP_V02 sont passées, tout est livré, testé et EN PROD.** Zéro chantier abandonné.

## Ce qui tourne ce matin (et qui ne tournait pas hier soir)

| Brique | Hier soir (v0.1) | Ce matin (v0.2) |
|---|---|---|
| SDK (23,8 KB gzip, +1,5 KB) | 5 vitals, erreurs, sessions, routes | + resource timings, long tasks, breadcrumbs, consent RGPD, retry offline, clé d'API, `track()` persisté |
| Ingestion | endpoint ouvert, inserts unitaires | + fingerprinting d'erreurs, clés d'API sha256 (enforcement off = continuité G-IT), rate limit 600 req/min, inserts batch |
| Console | 5 vues fixes 24 h, publique | + filtres app/période/device, tendances, timeline de session, **erreurs groupées façon Sentry**, **page /alerts** (règles + événements + acquittement), **angles morts**, basic auth, dogfooding |
| Exploitation | rien | pg_cron : `check_alerts()` toutes les 5 min + purge rétention 30 j quotidienne ; CI GitHub Actions verte |

**La plateforme G-IT remonte déjà des données v0.2 sans qu'on ait touché au snippet** (même URL `/mip-rum.js`) : la session de recette de cette nuit a produit 5 spans `resource` réels (img/link/script) et 6 breadcrumbs (click/nav) en plus des vitals.

## Preuves (recette complète)

- **Local** : 66/66 tests unitaires (dont 30 nouveaux), 5/5 E2E Playwright, `tsc --noEmit` propre.
- **CI GitHub** : run `27305991349` **vert en 1 m 44 s** sur le commit v0.2 (build SDK + unitaires + E2E avec Postgres de service).
- **Cloud** : migration v02 appliquée (8 nouvelles tables/vues, RLS + grants `console_ro`, 2 jobs pg_cron) ; edge function **version 2** ; fixture v2 → 200 → lignes dans les 4 nouvelles tables ; 2 erreurs de même famille → **1 fingerprint** (`bacb7359`).
- **Console prod** : `/` → 401 sans credentials, 200 avec ; `/mip-rum.js` public (73 183 octets = SDK v0.2) ; `/alerts` et `/correlation` rendent.
- **Vrai site** : recette DoD rejouée → VERTE (vitals + 4 routes SPA + breadcrumbs + resources en base cloud).
- Chiffres mesurés en cours de nuit : rate limit prouvé sur 605 requêtes (600×200 puis 429) ; alerte test déclenchée à 737,6 ms de LCP p75 ; angles morts détectés en local avec gaps +1 771 ms.

## Ce qui N'est PAS fait (honnêteté)

1. **Webhook d'alerte non câblé** : la règle stocke `webhook_url` et l'événement se déclenche bien (visible/acquittable dans /alerts), mais l'appel HTTP sortant (pg_net) n'est pas branché. Les alertes sont « in-app » seulement. ~1 h de travail, à prioriser.
2. **Rate limit edge = par isolat** Deno (best effort, suffisant contre le flood accidentel, pas contre une attaque distribuée).
3. **Retry offline best-effort** (documenté dans `retry.ts`) : doublons possibles dans de rares cas de faux négatif réseau.
4. `geo_country` toujours vide (limitation runtime Supabase, inchangée).
5. Long tasks : 0 observée depuis le vrai site cette nuit — rien d'anormal (la page n'a pas bloqué >50 ms pendant la recette), à confirmer avec du vrai trafic.
6. Les limites « Phase 1+ » de docs/LIMITES.md restent (replay vidéo, mobile, ClickHouse, RBAC, mapping auto route↔mesure).

## Tes 3 actions au réveil

1. **Console** : https://mip-rum-console.vercel.app — credentials dans `.secrets-v02.local.md` (à la racine du repo, gitignoré). Va voir `/alerts` (crée une règle « LCP > 2500 sur gip-plateforme, fenêtre 60 min » → elle s'évaluera toutes les 5 min toute seule) et `/errors` (groupes).
2. **Navigue 2 min sur la plateforme G-IT** (idéalement aussi depuis ton téléphone) : tu alimenteras les timelines de session v0.2 — puis ouvre ta session dans Console → Sessions → clic.
3. **Point de midi** : la tâche planifiée `point-rum-uti-j1` tournera à 12 h sur le trafic réel de la matinée (BILAN_J1.md).

Repo : https://github.com/jt33120/mip-rum (privé, CI verte). Détail technique complet par chantier : BUILD_LOG.md §v0.2.
