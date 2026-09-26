# ROADMAP v0.2 — Sprint nuit 10→11/06/2026 (« une semaine boostée IA »)

> **Archivé** (dans `docs/archive/` depuis le 01/07/2026) : plan de sprint écrit avant exécution. Ce qui a été livré est dans [CHANGELOG.md](../../CHANGELOG.md) (§ v0.2) ; l'état actuel est dans [docs/RUM_PARITY_STATUS.md](../RUM_PARITY_STATUS.md).

Objectif : transformer le POC v0.1 en **v0.2 produit**, le meilleur sur le créneau MIP
(OTel-native + souverain + corrélation synthétique↔RUM). GO complet de Julian le 10/06 soir.
Garde-fous maintenus : pas de push prod sur `uti-platform` cette nuit (PR seulement),
pas de dépense (free tiers), pas de récupération de credentials hors CLI/MCP déjà authentifiés.
Traite les limites n° 1-4, 7-11, 14-18, 23, 24-25 de `docs/LIMITES.md`.

## Contrat de données v0.2 (verrouillé avant build — tous les modules s'y conforment)

Nouveaux spans SDK → ingestion → tables :
- `resource` : `resource.url` (scrubbed), `resource.type`, `resource.duration_ms`, `resource.transfer_size`, `resource.render_blocking` → table `rum_resource` (cap 20/page, seuil 300 ms configurable)
- `longtask` : `longtask.duration_ms` → table `rum_longtask` (cap 30/page)
- `breadcrumb` : `breadcrumb.type` (click|nav|error|custom), `breadcrumb.label`, `breadcrumb.seq` → table `rum_breadcrumb` (cap 50/page)
- `track.<name>` : `mip.props` (JSON string) → table `rum_event` (name, props jsonb)
- Clé d'API : attribut resource `mip.api_key` (sendBeacon ne porte pas de header) → vérif sha256 contre `app_registry` ; enforcement via env `REQUIRE_API_KEY` (défaut false pour continuité G-IT)
- Fingerprint erreurs (partagé `_shared/otlp.mjs`) : fnv1a(error_type + message normalisé [chiffres/uuids/urls → ∅] + 1er frame de stack sans line:col) → colonne `rum_error.fingerprint`
- Nouvelles tables : `app_registry` (app_id pk, name, client_id, api_key_hash, active), `alert_rule` (metric, route?, comparator, threshold, window_minutes, webhook_url?, active), `alert_event` (rule_id, fired_at, value, message, acknowledged)
- Vue `v_error_group` (fingerprint, type, sample message, n, sessions, first/last seen) ; vue `v_blind_spot` (routes où robot=ok ET réel=poor, trié par écart)
- Alerting : fonction SQL `check_alerts()` (fenêtre glissante) exécutée par pg_cron (cloud), insère `alert_event` + webhook via pg_net si configuré
- Rétention : pg_cron quotidien, purge > 30 j
- Migration : `apps/ingest/sql/migration-v02.sql` (idempotente, appliquée localement par docker et en cloud par MCP)

## Chantiers (A = build parallèle, B = intégration, C = déploiement, D = recette)

### A1 — SDK v0.2 (`packages/rum-sdk`)
Resource timings + long tasks + breadcrumbs + consent mode (`requireConsent` + `MIPRum.consent()`)
+ file retry localStorage (export raté → rejoué au prochain load) + `apiKey` + `track()` persisté.
**Critère** : démo headless → spans `resource`/`longtask`/`breadcrumb`/`track.*` visibles dans le payload OTLP ;
consent=false → 0 requête ; bundle ≤ 35 KB gzip (valeur notée).

### A2 — Ingestion v0.2 (`apps/ingest`)
Migration v02, parser étendu (nouveaux spans, fingerprint, api_key), inserts batch multi-lignes,
rate limit 600 req/min/app, parité dev-server ↔ edge function.
**Critère** : fixture v2 → lignes dans les 4 nouvelles tables + fingerprint identique pour 2 erreurs
de même famille ; clé invalide avec REQUIRE_API_KEY=true → 403 ; tests unitaires parser verts.

### A3 — Console v0.3 cœur (`apps/console`)
Sélecteurs globaux app/période (1h/24h/7j)/device, Overview avec tendances vs période précédente,
Pages avec ressources lentes par route, **vue session détaillée** (timeline pageviews+vitals+erreurs+breadcrumbs+longtasks),
basic auth middleware (`/mip-rum.js` reste public), branding MIP, dogfooding (console auto-instrumentée, app_id `mip-rum-console`).
**Critère** : navigation complète en local avec les données de la démo ; basic auth actif ; /mip-rum.js accessible sans auth.

### A4 — Console v0.3 features (`apps/console`, fichiers nouveaux uniquement)
Erreurs groupées par fingerprint (occurrences, sessions touchées, sparkline, stack), page /alerts
(CRUD règles + flux d'événements + acquittement), corrélation v2 (série historisée robot vs réel + section « angles morts »).
**Critère** : 2 erreurs même famille = 1 groupe ; règle créée + dépassement simulé → alert_event visible et acquittable.

### A5 — CI & docs (`.github/`, docs/)
GitHub Actions (install, build, vitest, playwright + postgres service), README produit,
guide d'intégration client (`docs/INTEGRATION.md`), CHANGELOG.
**Critère** : workflow CI vert sur GitHub sur le commit de la nuit.

### B — Intégration (orchestrateur)
Build complet, tests unitaires + E2E existants ET nouveaux verts en local, corrections croisées.
**Critère binaire** : `pnpm -r build` + vitest + playwright tous verts.

### C — Déploiement cloud
Migration v02 sur Supabase (MCP), edge function v2, console Vercel, env basic auth,
enregistrement des apps (demo-app, gip-plateforme, mip-rum-console) avec clés (livrées en local, gitignorées).
**Critère** : smoke tests cloud (préflight, POST fixture v2, console authentifiée, /mip-rum.js public).

### D — Recette + rapport du matin
`validate-dod` rejoué sur le vrai site (le snippet G-IT existant continue de marcher SANS modification —
même URL SDK, enforcement clé off), `RAPPORT_NUIT.md` : fait/pas fait/écarts/valeurs réelles, commits poussés sur GitHub.
**Critère** : DoD verte + rapport écrit + repo GitHub à jour.

## Hors périmètre nuit (assumé)
Session replay vidéo, SDK mobile, ML, ClickHouse réel, RBAC/multi-tenant console, email d'alerte
(webhook seulement — pas de compte tiers à créer), tracing distribué.
