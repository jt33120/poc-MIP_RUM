# `notifier`

**Rôle.** Livre ce que la plateforme a décidé de dire — webhooks signés, e-mails par Resend, tickets — et, seul de tous les services, détient les secrets sortants.

| | |
|---|---|
| Groupe du canevas | 3 · Traitements |
| Point d'entrée | `node services/notifier/worker.mjs` (câblage seul, sur `@mip/service-kit`) |
| Logique | `@mip/backend/jobs/livreur.mjs` (la passe), `@mip/backend/lib/dispatch-alerts.mjs` (webhooks et e-mails), `@mip/backend/lib/net/resend.mjs`, `@mip/backend/lib/net/signature-webhook.mjs`, `@mip/backend/lib/integrations/tickets/dispatcher.mjs` |
| Exposition | privée : aucun domaine généré, joignable par le réseau privé du projet |
| Rôle BDD | propriétaire (`DATABASE_URL`) ; pool de 2 (`PGPOOL_MAX`), `application_name = mip-notifier` |
| Réplicas | 1 (deux seraient sûrs : voir « Sûreté multi-réplique ») |
| Image | `services/notifier/Dockerfile` — ni `@mip/db`, ni base GeoIP |

État au 24/09/2026 : **pas encore déployé**. En production, le scheduler livre à chaque tick (5 min), et aucun e-mail d'alerte n'est jamais parti (`route_alert` les soldait `skipped` avant migration-v88).

## Ce qu'il fait

| Boucle | Quand | Étapes |
|---|---|---|
| `livraison` | toutes les 15 s (`NOTIFIER_INTERVAL_MS`) — sur la base gratuite, toutes les 15 min alignées 45 s après le tick —, la première au démarrage | `route_error_issue_notifications` (outbox des issues → `alert_event` + livraisons), `dispatch_alerts` (webhooks, e-mails), `dispatch_tickets` (P8.6) |
| `reconciliation` | à HH:00:50 | `reconcile_alert_deliveries` (livraisons `sent` de l'ère pg_net) |

Une passe n'entame plus de livraison au-delà de 10 s (`BUDGET_PASSE_MS`) : ce qui reste part 15 s plus tard, et le drainage d'un redéploiement couvre toujours la passe en cours.

**Webhooks.** `POST` JSON (champ `text` lisible par Slack), par `safeFetch` : ni réseau privé, ni métadonnées cloud, ni boucle locale — une cible refusée est soldée `skipped`. Chaque envoi porte `x-mip-delivery-id` (le destinataire dédoublonne un rejeu) ; avec `WEBHOOK_SIGNING_SECRET`, aussi `x-mip-timestamp` et `x-mip-signature: sha256=HMAC(secret, "<timestamp>.<corps>")`. Vérification de référence : `verifierSignature`, `packages/backend/lib/net/signature-webhook.mjs` (écart d'horloge admis : 5 min).

**E-mails.** Une cible qui est une adresse part chez Resend, `Idempotency-Key: mip-delivery-<id>` : une réponse perdue fait rejouer la livraison sans renvoyer le message. Identifiant Resend dans `alert_delivery.response`. Un refus 4xx est **terminal** (`dead`), sauf 429 et 409 `concurrent_idempotent_requests` ; un 5xx ou une panne réseau sont rejoués (5 tentatives, recul 30 s × 2ⁿ).

**Mode test.** Tant que le domaine d'envoi n'est pas vérifié chez Resend : `ALERT_EMAIL_FROM=onboarding@resend.dev`, et `ALERT_EMAIL_TEST_RECIPIENTS` liste les seuls destinataires servis. Tout autre est soldé `skipped` avec « domaine d'envoi non vérifié », **avant** l'appel. Un expéditeur `@resend.dev` sans liste fait refuser le démarrage.

## Routes et sondes

| Route | Exposition | Sens |
|---|---|---|
| `GET /health` | réseau privé | processus vivant **et** base joignable (ping en cache 30 s). **C'est la sonde Railway.** |
| `GET /live` | réseau privé | processus vivant, jamais la base — pour une supervision externe |
| `GET /ready` | jeton `METRICS_TOKEN` (sinon 404) | 503 dès SIGTERM ; sinon **fraîcheur** (une passe aboutie depuis moins de 4 intervalles, 60 s au moins, comptés depuis le démarrage tant qu'aucune n'a abouti) et **arriéré** (`queued` de plus de 15 min = bloqué). Supervision seulement. |
| `GET /metrics` | jeton `METRICS_TOKEN` (sinon 404) | `notifier_deliveries_total{canal,status}`, `notifier_step_failures_total{step}`, `notifier_backlog_deliveries`, `notifier_backlog_oldest_seconds`, `loop_*`, pool, mémoire |
| `POST /v1/webhooks/tickets/{id}` | **public** (domaine généré), 1 Mio | C11 — la livraison signée d'un fournisseur de tickets (GitHub, `X-Hub-Signature-256` sur le corps brut). Refus muets : 400 cookie de la console ou corps illisible, 401 signature, 404 intégration inconnue ou éteinte (le même), 413, 503 secret du webhook injoignable. `{ ok: true, received }` sinon — jamais un détail RUM. Rejeu reconnu par `(integration_id, delivery_id)`. L'alias `/api/webhooks/tickets/{id}` mène au même traitement. |

**Toute réponse porte `x-mip-notifier: 1`** : le relais de la console (`lib/ticket-hook-relay.ts`, `CONSOLE_TICKET_HOOK_URL`) distingue ainsi le notifier du routeur Railway — non signée, il traite la livraison lui-même (sûr : un rejeu n'applique rien deux fois). Le code du point d'entrée est partagé avec la console (`@mip/backend/lib/integrations/tickets/webhook-entrant.mjs`). Le secret du webhook se résout ICI : les variables `TICKET_*` qu'une intégration référence (`env:TICKET_…`) doivent exister sur le notifier, et être déclarées dans l'IaC (`preserve()`), sans quoi un apply les supprimerait.

Toute autre route : 404.

## Configuration

`node services/notifier/worker.mjs --print-env-example` écrit le gabarit à jour. Une valeur invalide, ou une configuration e-mail incohérente, fait refuser le démarrage (code 2) avec **toutes** les erreurs sur une ligne, sans jamais citer un secret.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | **oui** (secret) | — | Postgres. Pas de repli sur un Postgres local. |
| `PGPOOL_MAX` | non | 2 | une livraison à la fois, plus les sondes |
| `NOTIFIER_INTERVAL_MS` | non | 15000 | délai entre deux passes (5 000 à 3 600 000) ; dès 300 000, passes alignées sur le tick, un diviseur de l'heure — **900000 sur la base gratuite**, voir « Coût » |
| `RESEND_API_KEY` | non (secret) | — | clé Resend, droit « Sending access » seul ; absente : e-mails soldés `skipped` |
| `ALERT_EMAIL_FROM` | avec la clé | — | expéditeur ; `@resend.dev` exige la liste de test |
| `ALERT_EMAIL_TEST_RECIPIENTS` | avec `@resend.dev` | — | seuls destinataires servis, séparés par des virgules |
| `WEBHOOK_SIGNING_SECRET` | non (secret, ≥ 32 car.) | — | signe les webhooks ; `nouveau,ancien` pendant une rotation |
| `TICKET_SECRET_KEY` | non (secret, 32 octets) | — | déchiffre les références `enc:v1:` — la **même**, à l'octet près, que celle qui les a chiffrées |
| `TICKET_*` | selon les intégrations | — | jetons désignés par `env:TICKET_…` dans `ticket_integration` |
| `PORT`, `LOG_LEVEL`, `METRICS_TOKEN`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | voir le kit | | à poser : drainage 20 s |

**Le secret de signature est unique pour tous les canaux** : le communiquer à un destinataire lui permet de signer pour les autres. Tenable tant qu'un seul client reçoit des webhooks ; un secret par canal relève de C8.

## Coût

Quatre passes par minute gardent le compute Neon éveillé en permanence (veille après 5 min sans requête) : ~180 CU-h par mois à 0,25 CU, au-delà des 100 CU-h de l'offre gratuite **à lui seul** — l'incident du 24/09/2026.

**Sur la base gratuite (décision du 24/09/2026) : `NOTIFIER_INTERVAL_MS=900000`.** Dès 5 minutes d'intervalle, les passes s'**alignent** sur la grille du scheduler, 45 s après son tick (`prochainePasseAlignee`) : le tick réveille la base à :00 et met les livraisons en file, le notifier les envoie à :00:45, dans la même fenêtre d'éveil. La réconciliation horaire tombe à HH:00:50, pour la même raison. Un intervalle aligné doit diviser l'heure (sinon refus de démarrer). Calcul et limites : README du scheduler, « Base gratuite ».

Sur une offre payante (Neon Launch), 15 s coûtent ~19 $ par mois, dont l'essentiel est déjà payé par le reste de la plateforme.

## Sûreté multi-réplique

Pas de bail : chaque étape réserve ses lignes par `for update skip locked` (livraisons, outbox des issues, file des tickets). Deux répliques — ou le scheduler et le notifier pendant la bascule — se partagent les lignes sans jamais en livrer une deux fois. Dans un processus, la boucle du kit ne lance jamais deux passes de front.

## La bascule depuis le scheduler

1. Créer le service (IaC) avec ses variables ; `SCHEDULER_DELIVERY=off` sur le scheduler **dans le même apply**. Le scheduler n'a pas la clé Resend : une livraison e-mail qu'il prendrait serait soldée `skipped`. Entre les deux démarrages, les livraisons attendent `queued` ; rien ne se perd.
2. Vérifier : `/ready` du notifier (passe `fait`), une alerte de test → webhook reçu en moins de 30 s, e-mail reçu sur l'adresse de test avec l'identifiant Resend dans `alert_delivery.response`, un destinataire hors liste soldé `skipped`.
3. Régénérer la clé Resend (elle a circulé en clair), la reposer.

**Retour arrière :** `SCHEDULER_DELIVERY=on`, notifier à 0 réplique. Retirer `RESEND_API_KEY` ramène l'e-mail à `skipped`.

## Modes de panne

| Situation | Ce qui se passe | Ce qu'on voit |
|---|---|---|
| base injoignable | passe en échec, la suivante à l'heure ; `/health` à 503 | `étape planifiée en échec` (pile), `loop_runs_total{result}` |
| Resend en panne (5xx, réseau) | livraison `failed`, rejouée avec la même clé d'idempotence | `delivery` en `warn`, `canal: email`, `response: resend …` |
| clé Resend révoquée (401/403) | livraison `dead` d'emblée | `notifier_deliveries_total{canal="email",status="dead"}` |
| destinataire hors liste de test | `skipped` avant tout appel | la raison dans `alert_delivery.response` |
| webhook vers le réseau privé ou les métadonnées | `skipped`, jamais posté | `cible refusée : …` |
| jeton de ticket absent ou révoqué | intégration `degraded`, demandes gardées en file | `ticket_integration.last_error` |
| SIGTERM pendant une passe | la passe finit (≤ 10 s d'échéance), puis `pool.end()`, sortie 0 | `arrêt demandé`, `arrêt terminé` |

## Lancement local

```bash
docker run -d --rm --name mip-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
export METRICS_TOKEN=$(openssl rand -hex 24)
node services/scheduler/migrate.mjs
PORT=4321 node services/notifier/worker.mjs &
curl -s localhost:4321/health
curl -s -H "authorization: Bearer $METRICS_TOKEN" localhost:4321/ready
```
