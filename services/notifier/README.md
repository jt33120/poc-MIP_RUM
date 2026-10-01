# `notifier`

**Rôle.** Livre ce que la plateforme a décidé de dire — webhooks signés, e-mails par Resend — et, seul de tous les services, détient les secrets sortants. Une seule décision lui est propre : alerter quand les travaux planifiés se taisent (« Veille de l'ordonnanceur »).

| | |
|---|---|
| Groupe du canevas | 3 · Traitements |
| Point d'entrée | `node services/notifier/worker.mjs` (câblage seul, sur `@mip/service-kit`) |
| Logique | `@mip/backend/jobs/livreur.mjs` (la passe), `@mip/backend/jobs/veille-ordonnanceur.mjs` (la veille du tick), `@mip/backend/lib/dispatch-alerts.mjs` (webhooks et e-mails), `@mip/backend/lib/net/resend.mjs`, `@mip/backend/lib/net/signature-webhook.mjs` |
| Exposition | privée : sondes seulement, aucune route publique (le hook entrant des tickets, C11, est retiré depuis le 29/09/2026) |
| Rôle BDD | propriétaire (`DATABASE_URL`) ; pool de 2 (`PGPOOL_MAX`), `application_name = mip-notifier` |
| Réplicas | 1 (deux seraient sûrs : voir « Sûreté multi-réplique ») |
| Image | `services/notifier/Dockerfile` — ni `@mip/db`, ni base GeoIP |

État au 26/09/2026 : **pas encore créé** sur Railway — déclaré dans `.railway/railway.ts`, il attend ses variables partagées (`RESEND_API_KEY`, `ALERT_EMAIL_TEST_RECIPIENTS`, `WEBHOOK_SIGNING_SECRET`…) et un apply approuvé. En production, le scheduler livre à chaque tick (`SCHEDULER_DELIVERY` n'y est pas posée), et aucun e-mail d'alerte n'est jamais parti : `route_alert` les solde `skipped` tant que migration-v88 n'est pas appliquée (la production est à v86), et le scheduler n'a pas de clé Resend.

## Ce qu'il fait

| Boucle | Quand | Étapes |
|---|---|---|
| `livraison` | toutes les 15 s (`NOTIFIER_INTERVAL_MS`) — sur la base gratuite, toutes les 15 min alignées 45 s après le tick —, la première au démarrage | la veille de l'ordonnanceur (au plus une fois par minute), `route_error_issue_notifications` (outbox des issues → `alert_event` + livraisons), `dispatch_alerts` (webhooks, e-mails), puis le battement si les deux étapes ont abouti |
| `reconciliation` | à HH:00:50 | `reconcile_alert_deliveries` (livraisons `sent` de l'ère pg_net) |

Une passe n'entame plus de livraison au-delà de 10 s (`BUDGET_PASSE_MS`) : ce qui reste part 15 s plus tard, et le drainage d'un redéploiement couvre toujours la passe en cours.

**Battement.** Le notifier n'a pas de bail : sa trace en base est une ligne de `sonde_battement` (`service = 'notifier'`, `dernier_ok` à l'heure de la base, migration-v103), écrite en upsert à la fin d'une passe **aboutie**, au plus une fois par minute (`BATTEMENT_MIN_MS`). La base est déjà éveillée par la passe : aucun réveil de plus. Une passe en échec ne l'écrit pas, et une écriture ratée ne fait pas échouer la passe. La carte « Santé de la chaîne de mesure » (`/admin/health`) l'affiche. Le rôle est le propriétaire : aucun droit à accorder.

**Veille de l'ordonnanceur.** Le scheduler ne peut pas dire qu'il s'est tu : ses sondes meurent avec lui, et le dead-man's switch externe (`DEADMAN_URL`) n'est posé nulle part. Le notifier le dit à sa place. En tête de passe (au plus une fois par minute, `VEILLE_MIN_MS`), **une** requête lit, à l'heure de la base, le bail du tick (`scheduler_lease`, ligne `tick` : son échéance passée est l'heure du dernier tick **abouti**), la cadence publiée (`platform_flag.scheduler_tick_min`) et la fenêtre ouverte. Au-delà de **2 × cadence + 5 min** sans tick abouti (35 min au quart d'heure, 15 min à 5 min) — la règle de la reconstitution et de la carte « Santé de la chaîne de mesure » —, il ouvre une fenêtre du registre (`collecte_fenetre`, portée `*`, étage `ordonnanceur`, état `interrompue`, datée du dernier tick abouti) et lève **une** alerte `critical` par `sonde_alerter` (migration-v103), routée vers les seuls canaux **globaux** (sans application) : elle est mise en file avant la livraison, donc **livrée dans la même passe**. Les passes suivantes de l'épisode ne lèvent rien ; deux notifiers ne doublent ni la fenêtre (une seule ouverte par étage) ni l'alerte (ligne verrouillée). La fenêtre se ferme au tick revenu, datée de lui ; pas d'alerte de retour. Un tick manqué (redéploiement, migrations au pré-déploiement, bail tenu par l'instance sortante) ne suffit pas ; deux de suite, si. Cadence non publiée : 15 min supposées, et l'alerte le dit. Aucun réveil de base de plus : la requête part dans la passe. La veille ne lève jamais d'exception : en échec, elle l'écrit au journal et retente à la passe suivante, la livraison continue. Hors de la collecte : l'étage `ordonnanceur` n'est lu ni par les graphiques ni par `check_alerts` (la mesure arrive sans le scheduler). **Ce qu'elle ne couvre pas** : la panne du notifier lui-même, celle de la base, celle de tout Railway — l'astreinte reste à MIP. Sans canal global (`notify_channel.app_id` nul), l'alerte ne se lit que dans `/alerts`, périmètre « toutes les applications » (elle n'en porte aucune), et la fenêtre dans `/admin/health`.

**Webhooks.** `POST` JSON (champ `text` lisible par Slack), par `safeFetch` : ni réseau privé, ni métadonnées cloud, ni boucle locale — une cible refusée est soldée `skipped`. Chaque envoi porte `x-mip-delivery-id` (le destinataire dédoublonne un rejeu) ; avec `WEBHOOK_SIGNING_SECRET`, aussi `x-mip-timestamp` et `x-mip-signature: sha256=HMAC(secret, "<timestamp>.<corps>")`. Vérification de référence : `verifierSignature`, `packages/backend/lib/net/signature-webhook.mjs` (écart d'horloge admis : 5 min).

**E-mails.** Une cible qui est une adresse part chez Resend, `Idempotency-Key: mip-delivery-<id>` : une réponse perdue fait rejouer la livraison sans renvoyer le message. Identifiant Resend dans `alert_delivery.response`. Un refus 4xx est **terminal** (`dead`), sauf 429 et 409 `concurrent_idempotent_requests` ; un 5xx ou une panne réseau sont rejoués (5 tentatives, recul 30 s × 2ⁿ).

**Mode test.** Tant que le domaine d'envoi n'est pas vérifié chez Resend : `ALERT_EMAIL_FROM=onboarding@resend.dev`, et `ALERT_EMAIL_TEST_RECIPIENTS` liste les seuls destinataires servis. Tout autre est soldé `skipped` avec « domaine d'envoi non vérifié », **avant** l'appel. Un expéditeur `@resend.dev` sans liste fait refuser le démarrage.

## Routes et sondes

| Route | Exposition | Sens |
|---|---|---|
| `GET /health` | réseau privé | processus vivant **et** base joignable (ping en cache 30 s). **C'est la sonde Railway.** |
| `GET /live` | réseau privé | processus vivant, jamais la base — pour une supervision externe |
| `GET /ready` | jeton `METRICS_TOKEN` (sinon 404) | 503 dès SIGTERM ; sinon **fraîcheur** (une passe aboutie depuis moins de 4 intervalles, 60 s au moins, comptés depuis le démarrage tant qu'aucune n'a abouti) et **arriéré** (`queued` de plus de 15 min = bloqué). Le dernier bilan de la veille (`veille_ordonnanceur` : décision, dernier tick, silence, seuil) s'y lit, sans peser sur le verdict. Supervision seulement. |
| `GET /metrics` | jeton `METRICS_TOKEN` (sinon 404) | `notifier_deliveries_total{canal,status}`, `notifier_step_failures_total{step}`, `notifier_scheduler_watch_total{action}` (rien, ouvrir, alerter, fermer, erreur), `notifier_backlog_deliveries`, `notifier_backlog_oldest_seconds`, `loop_*`, pool, mémoire |
Toute autre route : 404. Le hook entrant des tickets (`POST /v1/webhooks/tickets/{id}`, C11) et l'en-tête `x-mip-notifier` qui servait à son relais sont retirés depuis le 29/09/2026, avec la fonctionnalité des tickets.

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
| `PORT`, `LOG_LEVEL`, `METRICS_TOKEN`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | voir le kit | | à poser : drainage 20 s |

**Le secret de signature est unique pour tous les canaux** : le communiquer à un destinataire lui permet de signer pour les autres. Tenable tant qu'un seul client reçoit des webhooks ; un secret par canal relève de C8.

## Coût

Quatre passes par minute gardent le compute Neon éveillé en permanence (veille après 5 min sans requête) : ~180 CU-h par mois à 0,25 CU, au-delà des 100 CU-h de l'offre gratuite **à lui seul** — l'incident du 24/09/2026.

**Sur la base gratuite (décision du 24/09/2026) : `NOTIFIER_INTERVAL_MS=900000`.** Dès 5 minutes d'intervalle, les passes s'**alignent** sur la grille du scheduler, 45 s après son tick (`prochainePasseAlignee`) : le tick réveille la base à :00 et met les livraisons en file, le notifier les envoie à :00:45, dans la même fenêtre d'éveil. La réconciliation horaire tombe à HH:00:50, pour la même raison. Un intervalle aligné doit diviser l'heure (sinon refus de démarrer). Calcul et limites : README du scheduler, « Base gratuite ».

Sur une offre payante (Neon Launch), 15 s coûtent ~19 $ par mois, dont l'essentiel est déjà payé par le reste de la plateforme.

## Sûreté multi-réplique

Pas de bail : chaque étape réserve ses lignes par `for update skip locked` (livraisons, outbox des issues). Deux répliques — ou le scheduler et le notifier pendant la bascule — se partagent les lignes sans jamais en livrer une deux fois. Dans un processus, la boucle du kit ne lance jamais deux passes de front.

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
| SIGTERM pendant une passe | la passe finit (≤ 10 s d'échéance), puis `pool.end()`, sortie 0 | `arrêt demandé`, `arrêt terminé` |
| scheduler muet (arrêté, bloqué, en échec à chaque tick) au-delà de 2 × cadence + 5 min | fenêtre `ordonnanceur` ouverte, une alerte `critical` aux canaux globaux, livrée dans la passe ; fermée au tick revenu | `travaux planifiés muets — alerte levée` (`error`), puis `travaux planifiés revenus — fenêtre fermée` ; `notifier_scheduler_watch_total{action="ouvrir"}` |
| veille en échec (base, schéma sans v87 ou v103) | la passe livre quand même ; nouvel essai à la passe suivante | `veille de l'ordonnanceur en échec` ou `en attente du schéma`, `{action="erreur"}` |

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
