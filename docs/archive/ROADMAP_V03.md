# ROADMAP v0.3 — Sprint nuit 2 (11/06/2026, GO « zéro limite » de Julian)

Objectif : produit RUM **enterprise-grade vendable** (cible grands comptes type Carrefour/AXA).
Traite TOUT le reste à faire de v0.2 + les limites « Phase 1+ » prouvables : session replay,
alerting sortant (webhooks), RBAC/multi-utilisateurs, ClickHouse, géo, rate limit durable,
détection d'anomalies. Exclusion assumée : SDK mobile natif (intestable sans device — le web
mobile est déjà couvert par le SDK actuel). Garde-fous inchangés : pas de dépense, pas de push
prod uti-platform, secrets via fichiers.

## Contrat de données v0.3 (migration-v03.sql, verrouillé avant build)

- `replay_chunk` (session_id, app_id, seq, events_count, body bytea gzip, created_at) — chunks rrweb compressés
- `console_user` (email unique, password_hash bcrypt, role admin|viewer, apps text[] null=toutes, last_login_at)
- `audit_log` (user_email, action, detail, ts)
- `alert_delivery` (alert_event_id, target, status, response, attempted_at) — traçabilité des webhooks
- `app_registry` + `replay_sample_rate float default 0` (0=off, 1=toutes les sessions)
- `rum_session.geo_country` rempli via **timezone → pays** (attribut `mip.tz` du SDK, mapping à l'ingestion — zéro IP stockée, RGPD-friendly)
- `check_alerts()` v2 : après insert d'un alert_event, si `webhook_url` → `net.http_post` (pg_net, cloud) + ligne `alert_delivery` ; en local (pas de pg_net) → no-op silencieux, dispatch via script node
- Vue `v_anomaly` : z-score du LCP p75 horaire vs moyenne/écart-type 7 j glissants par app/route (|z| > 3 = anomalie)
- Rate limit durable : table `rate_counter` (app_id, minute, hits) + fonction SQL `rate_check(app_id, limit)` — partagée entre isolats edge

## Chantiers

### B1 — Alerting sortant + geo + rate limit durable (ingest + SQL)
Webhooks pg_net (cloud) + dispatch-alerts.mjs (local/test), payload JSON générique compatible Slack ;
SDK : attribut `mip.tz` (Intl.resolvedOptions().timeZone) ; ingestion : mapping tz→pays (~200 zones majeures,
module `_shared/tz-country.mjs`) → `rum_session.geo_country` ; répartition géo dans la console (Sessions + Overview) ;
rate limit SQL durable dans l'edge function (fallback mémoire si SQL indisponible).
**Critère** : alerte test → ligne alert_delivery + POST reçu par un receveur local ; session avec tz Europe/Paris → geo_country='FR' visible console ; 2 « isolats » simulés partagent le compteur.

### B2 — Session replay (SDK + ingestion + console)
SDK : module séparé **lazy-loadé** `mip-rum-replay.js` (rrweb, masquage inputs par défaut, respecte le consent),
activé par `replay: true|sampleRate` ; chunks gzip (CompressionStream) → `POST /v1/replay` ; caps (2 min ou 1 Mo/session).
Ingestion : endpoint replay (dev-server + edge function `v1-replay`), stockage bytea.
Console : player rrweb dans la vue session (onglet « Replay »), streaming des chunks via route API authentifiée.
**Critère** : démo headless → naviguer/cliquer → chunks en base → la page session rejoue la visite (E2E : le player monte et lit > 0 events) ; bundle CŒUR inchangé ≤ 35 KB (le replay est dans le bundle séparé).

### B3 — RBAC / authentification console
Login email+mot de passe (page /login, JWT cookie httpOnly signé AUTH_SECRET, bcryptjs), remplace le basic auth ;
rôles : admin (tout + gestion utilisateurs + alertes) / viewer (lecture, scopé à une liste d'apps) ;
page /admin/users (CRUD, admin only) ; audit_log des actions sensibles ; /mip-rum*.js et /v1/* restent publics.
Seed : admin julian (mot de passe généré → .secrets-v02.local.md).
**Critère** : sans cookie → redirect /login ; viewer scopé app A ne voit pas l'app B (testé) ; création/désactivation d'utilisateur par l'admin opérationnelle ; actions tracées dans audit_log.

### B4 — ClickHouse (chemin prod prouvé, local)
docker-compose.clickhouse.yml (image officielle), schéma MergeTree (rum_metric/rum_error/rum_pageview a minima),
writer ClickHouse dans le dev-server derrière `STORE=clickhouse|both`, script de bench : 100 k events insérés,
comparaison p75 par route PG vs CH (latence requête), résultats dans infra/clickhouse.notes.md.
**Critère** : bench exécuté, chiffres réels notés, mêmes résultats de p75 sur les deux stores (±arrondi).

### B5 — Produit & vente
Health score par app (composite vitals/erreurs, formule documentée) en bandeau Overview ; vue v_anomaly affichée
(badge « anomalie ») ; docs/OFFRE.md (positionnement vs Datadog/Dynatrace/Ekara-ITRS, argumentaire souveraineté/CSPN,
on-prem, pricing indicatif POC→prod) ; docs/DEMO_SCRIPT.md (déroulé démo 10 min grand compte, avec les chiffres réels
G-IT) ; LIMITES.md mis à jour (colonne v0.3) ; README/CHANGELOG.
**Critère** : health score cohérent avec les données réelles ; docs relus sans sur-promesse (pas de « parité Dynatrace »).

### Phases C/D (orchestrateur)
C : intégration, tests complets, CI verte, migration v03 cloud (+pg_net), edge functions v3 + v1-replay,
console redéployée (AUTH_SECRET, admin seedé). D : recette vraie plateforme + replay live démo, RAPPORT_NUIT_2.md.
