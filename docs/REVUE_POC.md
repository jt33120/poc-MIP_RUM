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

## 3. Défauts / risques restants (non corrigés — à arbitrer)

| # | Observation | Pourquoi ça compte | Reco |
|---|---|---|---|
| R1 | **`upsert_rum_session` incrémente `page_count`** alors que l'ingestion est *at-least-once* (le client peut rejouer après un 500). | Un rejeu après succès partiel **double-compte** les pages vues d'une session. Les autres tables sont idempotentes (`on conflict do nothing`), pas celle-ci. | Dédupliquer par identifiant de requête, **ou** dériver `page_count` d'un `count(*)` sur `rum_pageview` (source de vérité) plutôt que d'incrémenter. |
| R2 | **Écritures de l'edge function non transactionnelles** (le dev-server, lui, est transactionnel). | Un échec à mi-parcours laisse un état partiel ; conjugué au rejeu, ça amplifie R1. | Regrouper les écritures dans **une RPC Postgres transactionnelle** (un aller-retour, atomique). Bonus : moins de latence. |
| R3 | **Rate limit durable = fail-open** : si `rate_check` échoue, on accepte. | Choix d'availability assumé (le pré-filtre mémoire protège encore), mais une panne DB prolongée lève toute limite. | OK pour le POC ; documenter, et envisager un fail-closed au-delà de N échecs consécutifs. |
| R4 | **Premier chargement du registre d'apps en échec** (edge) ⇒ map vide ⇒ avec `REQUIRE_API_KEY`, toutes les apps deviennent « inconnues » (403). | Dépendance dure au premier `select` ; un hoquet DB au démarrage bloque l'ingestion. | Conserver le dernier registre connu (déjà le cas entre rafraîchissements) ; au boot, **fail-open sur la vérif clé** si le registre n'a jamais pu être chargé, en le journalisant. |
| R5 | **Livraisons d'alerte `failed` non rejouées** (`dispatch-alerts`). | Un webhook momentanément down = alerte définitivement perdue. | Ajouter `attempts` + backoff et re-sélectionner les `failed` récents sous un plafond d'essais. |
| R6 | **Edge function non testée automatiquement** (pas de runtime Deno en CI). | Le dev-server est le miroir testé, mais l'edge peut diverger (CORS, statuts, env). | Ajouter un job **`deno test`** sur un test de contrat (mêmes fixtures que le dev-server), ou extraire le handler en module testable. |
| R7 | **CORS : origine refusée ⇒ on renvoie `ALLOWED_ORIGINS[0]`** comme `Access-Control-Allow-Origin`. | Comportement volontairement permissif ; sans cookies/credentials c'est sans risque, mais c'est surprenant. | Documenter explicitement, ou renvoyer l'absence d'en-tête ACAO pour une origine non listée. |
| R8 | **Pas de purge/TTL vérifiée en continu** (limite #10 d'origine). | La base croît ; le free tier Supabase a un plafond. | Job de rétention (`delete … where ts < now() - interval '30 days'`) planifié + métrique de volumétrie. |

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
1. Transformer les écritures en **une RPC transactionnelle** (résout R1 + R2).
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
