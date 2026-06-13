# Revue d'ingénierie — POC MIP RUM (13/06/2026)

Revue menée du point de vue d'un ingénieur backend, à la demande de Julian. Elle
**complète** `docs/LIMITES.md` (qui reste la liste produit de référence) en se
concentrant sur la **qualité de code, la robustesse prod et l'expérience du POC**.
Les éléments marqués ✅ sont **corrigés dans cette itération (v0.7)** ; les autres
sont des recommandations priorisées.

---

## 1. Appréciation générale

Le POC est **nettement au-dessus de l'état de l'art d'un POC**. Points forts réels :

- **Architecture saine et lisible** : un seul parser OTLP (`_shared/otlp.mjs`)
  partagé entre l'edge function Deno (prod) et le dev-server Node (local/CI) —
  zéro divergence de comportement, c'est la bonne décision.
- **OTel-natif et sans enfermement** : format OTLP standard de bout en bout, le
  backend accepte aussi l'auto-instrumentation OpenTelemetry « codeless ».
- **RGPD by design** : pas d'IP stockée, géo par timezone, scrubbing des query
  strings/PII, masquage replay par défaut, consent mode.
- **Commentaires de grande qualité** : chaque fichier explique le *pourquoi*, pas
  seulement le *quoi*. Rare et précieux.
- **Tests** : 147 unitaires + middleware Python + E2E Playwright, CI en place.

La suite liste ce qui manquait pour passer de « POC solide » à « backend prêt
pour la prod ».

---

## 2. Défauts corrigés dans cette itération (v0.7)

| # | Défaut constaté | Risque | Correctif livré |
|---|---|---|---|
| D1 | **L'edge function renvoyait `400` pour TOUTE erreur**, y compris une panne Postgres (`catch ⇒ 400 "bad request"`). | Un incident serveur était signalé au client comme « requête invalide » → le beacon ne rejoue pas → **perte de données silencieuse**. | ✅ Séparation stricte **400 (validation, non rejouable)** / **500 (incident, rejouable)** via `BadRequestError`. |
| D2 | **Aucun garde-fou de taille** : `await req.json()` / concaténation du corps sans borne. | Un POST de plusieurs centaines de Mo fait exploser la mémoire de l'isolat (DoS, même accidentel). | ✅ `_shared/limits.mjs` : rejet **413** sur `Content-Length`, coupure du flux côté dev-server, plafond `maxSpans` dans le parser. |
| D3 | **Pas de retry sur erreur Postgres transitoire** (failover du pooler, recyclage de connexion, `too_many_connections`). | Une micro-coupure DB = des lots perdus alors qu'un simple rejeu aurait réussi. | ✅ `_shared/retry.mjs` : backoff exponentiel + jitter, **rejoue uniquement les erreurs transitoires** (codes réseau + SQLSTATE), laisse remonter les fautes déterministes. |
| D4 | **Logs en texte libre** (`console.log("[ingest] …")`). | Non requêtables, non filtrables par niveau, non corrélables en prod. | ✅ `_shared/log.mjs` : **JSON lines** (`ts/level/service/msg/…`), niveaux via `LOG_LEVEL`, **redaction des secrets**, warn/error sur stderr. |
| D5 | **Pas de sonde de santé** sur le dev-server. | Un orchestrateur ne peut pas savoir si le service est vivant / prêt à recevoir du trafic. | ✅ `GET /health` (liveness) et `GET /ready` (ping DB) ; `GET /health` aussi sur l'edge function. |
| D6 | **Pas d'arrêt propre** (dev-server, dispatcher). | Au redéploiement, connexions Postgres orphelines, requêtes en vol coupées. | ✅ `SIGTERM`/`SIGINT` : on draine puis on ferme le pool, avec filet de sécurité. |
| D7 | **Le middleware FastAPI jetait des spans en silence** quand la file était pleine. | Perte de données invisible : impossible de savoir que l'ingestion ne suit pas. | ✅ Compteur observable `_dropped`. |

> Tous ces correctifs sont **runtime-agnostic** (Node + Deno) et couverts par
> `tests/unit/backend-hardening.test.ts` (15 tests) + un test Python ajouté.

---

## 3. Défauts / risques restants (à arbitrer)

> **R1, R2, R4 et R5 sont désormais corrigés** (v0.7) — détails en §3bis et §3ter.

| # | Observation | Pourquoi ça compte | Reco |
|---|---|---|---|
| R3 | **Rate limit durable = fail-open** : si `rate_check` échoue, on accepte. | Choix d'availability assumé (le pré-filtre mémoire protège encore), mais une panne DB prolongée lève toute limite. | OK pour le POC ; documenter, et envisager un fail-closed au-delà de N échecs consécutifs. |
| R6 | **Edge function non testée automatiquement** (pas de runtime Deno en CI). | Le dev-server est le miroir testé, mais l'edge peut diverger (CORS, statuts, env). | Ajouter un job **`deno test`** sur un test de contrat (mêmes fixtures que le dev-server), ou extraire le handler en module testable. |
| R7 | **CORS : origine refusée ⇒ on renvoie `ALLOWED_ORIGINS[0]`** comme `Access-Control-Allow-Origin`. | Comportement volontairement permissif ; sans cookies/credentials c'est sans risque, mais c'est surprenant. | Documenter explicitement, ou renvoyer l'absence d'en-tête ACAO pour une origine non listée. |
| R8 | **Pas de purge/TTL vérifiée en continu** (limite #10 d'origine). | La base croît ; le free tier Supabase a un plafond. | Job de rétention (`delete … where ts < now() - interval '30 days'`) planifié + métrique de volumétrie. |

### 3bis. R1 + R2 — idempotence des écritures (corrigé en v0.7)

**Problème.** `upsert_rum_session` **incrémentait** `page_count`, alors que
l'ingestion est *at-least-once* : un beacon/middleware peut rejouer un lot après
un `500`. Un rejeu **double-comptait** donc les pages vues. Les écritures de
l'edge function n'étant pas transactionnelles, un échec à mi-parcours amplifiait
le problème.

**Correctif (`migration-v07.sql`).** `page_count` est désormais **dérivé** du
nombre de lignes `rum_pageview` de la session — table déjà dédupliquée par
`span_id` (`on conflict do nothing`). Le compte est donc exact **quel que soit le
nombre de rejeux**, et chaque étape d'écriture devient idempotente :

- `upsert_rum_session` ne touche plus `page_count` (métadonnées seulement,
  signature inchangée → appelants compatibles) ;
- `set_session_page_count(session_id)` recalcule depuis `rum_pageview` (appelée
  par l'edge function après l'insertion des pageviews) ;
- le dev-server fait l'équivalent **dans sa transaction** (un `update … set
  page_count = count(*)`) ;
- backfill des sessions existantes.

**Vérifié sur Postgres réel** : un même lot de 2 pageviews **rejoué deux fois**
donne `page_count = 2` (et non 4) ; la RPC et la migration sont **ré-exécutables**
sans effet de bord. L'E2E CI (assertion `page_count ≥ 2`) reste satisfaite.

### 3ter. R4 + R5 — résilience ingestion & alertes (corrigé en v0.7)

**R4 — anti-tempête de 403.** Si le registre d'apps n'a **jamais** pu être chargé
(panne DB au démarrage), la vérif de clé d'API passe en **fail-open** (journalisée)
au lieu de rejeter 100 % du trafic en 403 — cohérent avec le fail-open assumé du
rate limit (R3). Dès qu'un chargement réussit, l'enforcement normal reprend.
Appliqué **symétriquement** à l'edge function et au dev-server.
*Vérifié sur dev-server réel* : table registre absente au boot → `POST` accepté
(`200` + warning) ; registre chargé + app non enregistrée → `403`.

**R5 — rejeu des alertes en échec (`migration-v08.sql`).** Une livraison `failed`
(webhook momentanément down) n'était jamais rejouée. Ajout d'un compteur
`attempts` ; le dispatcher re-sélectionne les `failed` **sous un plafond**
(`DISPATCH_MAX_ATTEMPTS`, défaut 5) et **après un backoff exponentiel**
(`30 s × 2^attempts`), puis bascule en état terminal **`dead`** une fois le plafond
atteint. Logique de décision extraite en `decideStatus()` (testée en unitaire).
*Vérifié sur Postgres réel* : webhook 500 → `failed` ; après backoff, webhook 200
→ `sent` ; à `attempts=4` un échec → `dead` ; une `failed` trop récente est
**ignorée** (backoff actif).

---

## 4. Manques produit (rappel + nouveautés de cette itération)

Les manques structurants restent ceux de `docs/LIMITES.md` (SDK mobile, ClickHouse
prod, API DEM réelle, certifications, test de charge cloud, multi-région). **Deux
manques d'expérience** étaient criants pour un POC commercial — **traités ici** :

- ✅ **Aucun tutoriel / onboarding** → ajout d'un **guide de navigation** (`TourGuide`)
  qui s'ouvre au premier passage et reste ré-ouvrable via le bouton « Guide ».
- ✅ **Aucune aide contextuelle sur les indicateurs** → ajout d'un **glossaire
  central** (`lib/glossary.ts`) et de **bulles au survol** (`InfoTip` / `GlossaryTip`)
  donnant pour chaque métrique/outil/graphe **trois niveaux de lecture** : nom
  technique, stack technique, explication pour un commercial non technique.

---

## 5. Suggestions priorisées (au-delà du POC)

**P0 — avant un vrai trafic client**
1. ✅ **Idempotence des écritures** (R1+R2) faite en v0.7. Reste optionnel :
   regrouper l'écriture edge dans **une seule RPC transactionnelle** (atomicité
   stricte + moins de latence réseau).
2. **Test de charge cloud** réel (limite #27) pour calibrer rate limit, taille de
   lot et le free tier Supabase.
3. **Rétention/TTL** planifiée + alerte de volumétrie (R8).

**P1 — industrialisation**
4. **Métriques de l'ingestion** (taux 4xx/5xx, `rejected`, p95 d'écriture,
   `_dropped` du middleware) exposées en `/metrics` ou via les logs structurés
   désormais en place — l'outil doit se monitorer lui-même (limite #25).
5. **Test de contrat de l'edge function** sous Deno (R6).
6. **Rejeu des alertes `failed`** avec backoff (R5).

**P2 — produit**
7. Brancher la **source synthétique DEM réelle** (interface `SyntheticSource` prête).
8. Détection d'anomalies au-delà du z-score (saisonnalité), quand le volume le justifie.
9. Internationalisation de la console (FR uniquement aujourd'hui).

---

## 6. Ce que cette itération a changé (récapitulatif)

**Backend (`apps/ingest`, `integrations/fastapi`)**
- Nouveaux modules partagés runtime-agnostic : `_shared/log.mjs`,
  `_shared/retry.mjs`, `_shared/limits.mjs`.
- `v1-traces` (edge) et `dev-server.mjs` : 400/500, 413, retries, logs
  structurés, health/ready, arrêt propre, plafond de spans.
- **`migration-v07.sql`** : `page_count` idempotent (dérivé de `rum_pageview`),
  fonction `set_session_page_count`, backfill (R1+R2).
- **R4** : fail-open des clés d'API si le registre n'a jamais chargé (edge + dev-server).
- **`migration-v08.sql`** + `dispatch-alerts` : rejeu borné des alertes `failed`
  (`attempts`, backoff, état `dead`, `decideStatus` testé) (R5).
- `dispatch-alerts.mjs` : logs structurés + arrêt propre du `--loop`.
- Middleware FastAPI : compteur de spans perdus.
- Tests : `tests/unit/backend-hardening.test.ts` (15) + 1 test Python.

**Frontend (`apps/console`)**
- `lib/glossary.ts`, `components/InfoTip.tsx`, `components/GlossaryTip.tsx`,
  `components/TourGuide.tsx`.
- Câblage des bulles d'aide : Overview (santé, anomalies, vitals), Tracing
  (corrélation), en-têtes de page ; bouton « Guide » dans l'en-tête.

Aucune régression : **147 tests unitaires + Python verts**, `tsc --noEmit` de la
console clean.
