# Limites explicites du produit actuel (v0.1 — POC, état au 10/06/2026)

Liste honnête, demandée par Julian. Colonne « v0.2 » = traité dans le sprint nuit du 10→11/06 (cf. ROADMAP_V02.md) ; « v0.3 » = sprint nuit 2 (cf. ROADMAP_V03.md et la section ci-dessous) ; « Phase 1+ » = nécessite un vrai chantier produit MIP.

## Mise à jour v0.4 (11/06/2026 — tracing distribué)

| Limite d'origine | Ce qui est livré en v0.4 |
|---|---|
| **Tracing distribué front→back** (#6, annoncé Phase 2) | Livré pour le web→FastAPI : SDK propage `traceparent` (fetch + XHR/axios), middleware backend 1 fichier stdlib (posé sur uti-platform, inactif sans env vars), corrélation par trace_id en console (/tracing + timeline session). Limites assumées : un seul framework backend (FastAPI/Starlette), un seul saut (pas de propagation backend→backend ni DB span) |
| Backend ClickHouse (#13) | **Décision : reporté volontairement** (zéro budget MVP). Le chemin reste prouvé en local (bench Δ=0) ; bascule possible dès qu'un hébergement est financé |

## Mise à jour v0.3 (sprint nuit 2)

### Résolu en v0.3

| # d'origine | Limite | Ce qui est livré en v0.3 |
|---|---|---|
| 1 | Pas de session replay | Replay rrweb : module SDK **séparé lazy-chargé** (le bundle cœur ne bouge pas), opt-in par app (`replay_sample_rate`), masquage des saisies par défaut, respect du consent, caps 2 min / 1 Mo par session ; player dans la vue session |
| 9 | Rate limiting basique (mémoire, par isolat) | Rate limit **durable** : compteur SQL `rate_counter` + `rate_check()`, partagé entre isolats edge, fallback mémoire si SQL indisponible |
| 12 | `geo_country` vide | Géo **par timezone** (attribut `mip.tz` du SDK → mapping tz→pays à l'ingestion) — granularité pays, **zéro adresse IP stockée** |
| 13 | Backend Postgres, pas ClickHouse | Chemin ClickHouse **prouvé en local** : docker-compose, schéma MergeTree, writer derrière `STORE=clickhouse\|both`, bench 100 k events PG vs CH (`infra/clickhouse.notes.md`). Reste : déploiement prod réel |
| 17 (reliquat) | Alerting sans notification sortante fiable | Webhooks sortants : pg_net (cloud) + dispatcher node (local), payload JSON compatible Slack, traçabilité `alert_delivery` |
| 19 | Pas de RBAC / multi-utilisateurs | Login email+mot de passe (bcrypt, JWT cookie httpOnly), rôles admin/viewer, viewer scopé par liste d'apps, gestion des utilisateurs, `audit_log` des actions sensibles |
| 23 (reliquat) | Pas de détection automatique | Vue `v_anomaly` (z-score du LCP p75 horaire vs 7 j glissants, \|z\| > 3) + badge anomalies et **health score** composite en Overview (formule documentée dans `apps/console/lib/health.ts`) |

### Ce qui RESTE après v0.3 (les vraies barrières enterprise)

| Limite | Pourquoi c'est dur | Horizon |
|---|---|---|
| **SDK mobile natif** (iOS/Android) | Deux plateformes, des SDK à maintenir, intestable sans devices/CI mobile — exclusion assumée du sprint | Phase 3 (cadrage d'origine) |
| **Mapping auto route↔mesure synthétique** | Nécessite une convention de nommage côté équipe DEM (Ekara) ; aujourd'hui `route_hint` manuel — ne passe pas à l'échelle | Chantier produit avec l'équipe DEM |
| **Branchement API DEM réelle** | Accès API mippoc/Ekara non disponible à ce jour ; la corrélation tourne sur seed/export | Dès accès MIP (interface `SyntheticSource` prête) |
| **Tracing distribué front→back** | Agent côté serveur, propagation de contexte — un produit en soi | Phase 2 (cadrage d'origine) |
| **ML avancé** | v0.3 = z-score statistique (assumé, explicable) ; saisonnalité, multi-métriques, forecast = vraie R&D | Phase 2+ |
| **Multi-région / haute dispo** | Une seule région UE aujourd'hui ; réplication, failover, SLA = travail d'infra conséquent | Phase 2+ |
| **Certifications (SOC2, ISO 27001, CSPN)** | Processus longs et coûteux, hors de portée d'un POC — or souvent éliminatoires en AO grand compte | Décision MIP (12-18 mois) |
| **Support 24/7 / engagement de service** | Une organisation, pas du code | Décision MIP |
| **Test de charge cloud réel** | ~4 000 events/s vérifiés en local seulement ; le comportement du free tier sous vraie charge reste inconnu | Phase 1 |

---

## Tableaux d'origine (état v0.1 → v0.2)

## Collecte (SDK)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 1 | **Pas de session replay** (ni vidéo, ni breadcrumbs) | on voit QUE les métriques, pas le parcours qui y mène | v0.2 : breadcrumbs (clics, navigations, erreurs) ; replay vidéo = Phase 1+ (rrweb, volumétrie, RGPD lourd) |
| 2 | **Pas de resource timings ni long tasks** | impossible de dire POURQUOI une page est lente (script tiers ? image ? JS bloquant ?) | v0.2 |
| 3 | **Pas de consent mode RGPD** | le SDK collecte dès l'init — OK POC interne, bloquant pour un déploiement client | v0.2 |
| 4 | **Pas de file de retry/offline** | événements perdus si l'ingestion est down ou le réseau coupe | v0.2 |
| 5 | **Pas de SDK mobile** (iOS/Android) | web uniquement | Phase 3 (cadrage d'origine) |
| 6 | **Pas de tracing distribué front→back** | on ne suit pas une requête lente jusqu'au backend | Phase 2 (agent serveur, cadrage d'origine) |
| 7 | `track()` accepté mais **non persisté** | les événements métier partent sur le fil mais ne sont pas stockés | v0.2 |

## Ingestion & sécurité

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 8 | **Endpoint ouvert** : aucune clé d'API | n'importe qui connaissant l'URL peut injecter de fausses données | v0.2 (clé par app, hashée) |
| 9 | **Pas de rate limiting** | vulnérable au flood (même accidentel) | v0.2 (basique) |
| 10 | **Pas de rétention/TTL** | la base grossit indéfiniment | v0.2 (purge 30 j) |
| 11 | **Mono-application de fait** | tout est câblé autour de `gip-plateforme` | v0.2 (registre d'apps) |
| 12 | `geo_country` vide | pas de vue géographique | Phase 1 (Collector/CDN frontal) |
| 13 | Backend **Postgres**, pas ClickHouse | OK jusqu'à ~10⁶-10⁷ events ; au-delà, requêtes p75 lentes | Phase 1 (chemin documenté `infra/`) |

## Restitution (console)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 14 | **Fenêtre fixe 24 h**, aucun filtre (période/device/app) | inutilisable pour investiguer | v0.2 |
| 15 | **Erreurs non regroupées** | 1000 occurrences de la même erreur = 1000 lignes (vs fingerprinting type Sentry) | v0.2 |
| 16 | **Pas de vue session détaillée** | on liste les sessions mais on ne peut pas « entrer dedans » | v0.2 |
| 17 | **Aucun alerting** | personne n'est prévenu si le LCP explose — un outil de monitoring qui n'alerte pas n'est pas un outil de monitoring | v0.2 (règles + webhook ; email = Phase 1) |
| 18 | **Console publique** (lecture seule mais ouverte) | données de perf du client visibles par quiconque a l'URL | v0.2 (basic auth) |
| 19 | Pas de RBAC/multi-tenant | tous les utilisateurs voient tout | Phase 1 (cadrage d'origine : hors POC) |

## Corrélation (le différenciateur)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 20 | **Source synthétique = seed** (pas l'API DEM réelle) | la corrélation est démontrée mais pas branchée sur les vrais robots MIP — accès API non disponible à ce jour | interface `SyntheticSource` prête ; branchement dès accès MIP |
| 21 | **Mapping route↔mesure manuel** (`route_hint`) | ne passe pas à l'échelle | chantier produit Phase 1 avec l'équipe DEM (nommage des mesures) |
| 22 | Comparaison **LCP vs latence robot** = approximation | les deux ne mesurent pas exactement la même chose (premier rendu vs scénario complet) — honnête en démo, à raffiner | Phase 1 (comparer à `first_load_time` mippoc, constaté au sondage) |
| 23 | Écarts non historisés, pas de détection d'« angle mort » automatique | l'analyse reste visuelle | v0.2 |

## Industrialisation

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 24 | **Pas de CI** (tests verts mais lancés à la main) | régressions silencieuses possibles | v0.2 (GitHub Actions) |
| 25 | **Pas de monitoring de l'outil lui-même** | si l'ingestion tombe, on ne le sait pas | v0.2 (dogfooding : la console s'auto-instrumente) |
| 26 | Edge function non testable en local (pas de runtime Deno) | validée en prod uniquement | v0.2 partiel (CI) ; propre = Phase 1 |
| 27 | Volume réel encaissé inconnu au-delà du test local (~4 000 events/s en local, 1 000 events en 0,3 s) | pas de certitude sur le free tier Supabase sous vraie charge | Phase 1 (test de charge cloud) |
