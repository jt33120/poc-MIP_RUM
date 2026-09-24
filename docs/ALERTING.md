# Alerting mature — baselines, SLO/error-budget, routing (P1)

> Passer de l'alerting **statique** (seuil fixe) à un alerting **mature** attendu au
> niveau grand compte. Contrat SQL : `packages/db/sql/migration-v17.sql`. Console :
> `/alerts` (règles + canaux) et `/slo`.

## Pilier 1 — Baselines dynamiques (anomalie saisonnière)

Une règle a un **`mode`** : `threshold` (historique, seuil fixe) ou **`baseline`**.

- En mode `baseline`, on ne compare plus à un seuil mais au **normal saisonnier** : la
  médiane et le **MAD** (écart absolu médian, robuste aux outliers) des échantillons
  **horaires** au **même créneau** (jour-de-semaine + heure) sur `baseline_weeks` semaines.
- Déclenche si la valeur courante s'écarte de plus de **`sensitivity` × MAD** du normal
  (`>` au-dessus, `<` en dessous). Garde-fou : il faut **≥ 4 échantillons** saisonniers et
  un MAD non nul, sinon on ne déclenche pas (pas de fausse alarme sur historique mince).
- Couvre les vitals (p75 horaire) et `error_rate` (taux d'erreur horaire). Fonction
  `metric_baseline(app, metric, route, weeks)` → `(med, mad, n)`.

Pourquoi : un seuil fixe hurle la nuit (trafic faible) et rate une dérive diurne. Le
baseline répond à « est-ce anormal **pour ce moment** ? » — la base du moteur d'anomalie
(à la Dynatrace Davis / Datadog anomaly).

## Pilier 2 — SLO & error-budget

Table `slo(app_id, name, metric, objective ∈ ]0,1[, window_days, route?)`.

> **L'objectif se stocke en fraction, jamais en pourcent** — 99 % s'écrit `0.99`.
> La contrainte `slo_objective_is_ratio` (migration-v46) l'impose désormais au
> stockage. Ce n'est pas cosmétique : avec `objective = 99`, le budget devient
> négatif (`1 − 99 = −98`) et la condition de burn `(1 − atteinte) ≥ 14,4 × budget`
> est satisfaite **par construction**. La production a ainsi émis 627 alertes
> « critical » en 27 jours sans jamais rien détecter — y compris sur un SLO à
> 100 % d'atteinte. `slo_status()` retourne en outre `fast_burn = false` si le
> budget n'est pas strictement positif (défense en profondeur).

- **`slo_status(app?)`** calcule, par SLO actif : **atteinte** (part conforme sur la
  fenêtre — vitals « good » ou `1 − taux d'erreur`), **budget** (`1 − objectif`),
  **% de budget consommé**, et **`fast_burn`**.
- **Burn-rate** : `fast_burn` = le taux non conforme de la **dernière heure** dépasse
  **14,4×** le budget (convention SRE multi-fenêtres — épuiserait un budget 30 j en ~2 j).
- **`check_slo_burn()`** (pg_cron toutes les 5 min) crée un `alert_event` **critical**
  rattaché au SLO (`slo_id`) sur burn rapide. Flux d'événements **unifié** avec les
  règles (`alert_event.rule_id` OU `slo_id`). **Cadence dégressive** (migration-v45)
  : 1 h, 2 h, 4 h, 8 h puis 16 h de plafond selon le nombre d'alertes déjà émises
  sur 24 h glissantes — une dégradation durable reste visible sans devenir du bruit,
  et la cadence se réinitialise seule après 24 h sans alerte.
- Console **`/slo`** : barre d'atteinte, statut (ok / at_risk ≥ 75 % / breached), badge
  « burn rapide ». Helper pur testé : `lib/alerting.ts` → `sloView()`.

## Pilier 3 — Routing multi-canal + sévérité

- Chaque règle porte une **`severity`** (`info` < `warning` < `critical`), reprise sur
  l'`alert_event` et dans la charge utile.
- Table **`notify_channel(app_id?, kind, target, severity_min, active)`**. À chaque
  déclenchement, **`route_alert()`** notifie **tous** les canaux éligibles (sévérité ≥
  `severity_min`, app correspondante ou globale `app_id null`), **en plus** du
  `webhook_url` historique de la règle (rétro-compatible).
- Canaux livrés : **`webhook`** (JSON complet, champ `text` lisible par Slack) et **`slack`**
  (*incoming webhooks*). Depuis la migration v88, `route_alert` ne fait que **mettre en file**
  une livraison `queued` par canal éligible ; l'envoi appartient au livreur
  (`packages/backend/lib/dispatch-alerts.mjs`) : le service **`notifier`**, ou le tick du
  scheduler tant que `SCHEDULER_DELIVERY` vaut `on`. pg_net n'existe pas sur Neon.
- Chaque webhook porte `x-mip-delivery-id` ; avec `WEBHOOK_SIGNING_SECRET`, aussi
  `x-mip-timestamp` et `x-mip-signature: sha256=HMAC(secret, "<timestamp>.<corps>")`
  (vérification de référence : `verifierSignature`, `packages/backend/lib/net/signature-webhook.mjs`).
- **E-mail** (`kind='email'`, cible = adresse) : envoyé par **Resend** depuis le notifier,
  seul détenteur de la clé, avec une clé d'idempotence par livraison. **Mode test** tant que
  le domaine d'envoi n'est pas vérifié : expéditeur `onboarding@resend.dev`, seuls les
  destinataires de `ALERT_EMAIL_TEST_RECIPIENTS` sont servis, les autres soldés `skipped`
  avec la raison. Sans clé (le scheduler), `skipped` avec la raison. **Avant v88, aucun
  e-mail d'alerte n'était jamais parti** : `route_alert` les soldait `skipped` en SQL.
- **SMS** : non livré.

## Pilier 4 — Issues d'erreurs : nouvelle, régression, pic (P5.6, migrations v73 et v74)

- **Outbox `error_issue_notification`** : une notification par clé d'événement unique
  (`new:<issue>`, `regression:<résolution>:<issue>`, `spike:<règle>:<fenêtre>`), avec une
  charge minimale — ni message d'erreur, ni stack, ni identité. Écrite **dans la
  transaction qui la justifie** : le déclencheur de création d'une issue `new` (jamais
  une issue `migration`), l'écrivain d'ingestion pour une régression, `check_alerts` pour un
  pic. Jamais un curseur d'identifiants : une transaction validée tard n'est pas perdue.
  Une release qui n'est pas un nom court (1 à 200 octets, sans caractère de contrôle) n'est
  pas recopiée dans la charge (v74) : elle ne peut plus faire échouer le lot qui crée l'issue.
- **`route_error_issue_notifications()`**, étape du tick juste après `check_alerts` : crée
  l'`alert_event` (rattaché à la règle pour un pic) et appelle `route_alert` — mêmes
  canaux, même sévérité, même livraison. `for update skip locked` : le scheduler et le cron
  GitHub ne routent jamais deux fois la même notification ; échec = nouvel essai à 30 s ×
  2^n, `failed` après 5.
- **Régression confirmée** : issue résolue, occurrence postérieure à la résolution, dans
  l'env de référence, sur une release dont le **premier marqueur de déploiement** de cet env
  est strictement postérieur à celui de la release de référence (release et env de la
  dernière occurrence au moment de la résolution). Même release, plus ancienne, sans
  marqueur, env inconnu : « réapparition à vérifier », l'issue reste résolue. Une issue
  ignorée le reste. Décidée par `error_issue_record_occurrences()` dans la transaction de
  l'écrivain, issue verrouillée `for no key update` (v74) : deux lots concurrents donnent une
  activité et une notification, et le verrou n'attend pas les clés étrangères posées par un
  alias, une note ou un pic (plus d'interblocage croisé). Une release ou un env hors bornes
  ne confirme rien : réapparition à vérifier.
- **Règle `issue:<uuid>`** (console `/alerts`, ou « Créer une alerte de pic » depuis une
  issue) : somme des occurrences **observées** sur la fenêtre de la règle, bots exclus,
  `route` et `env` de la règle appliqués. Baseline P4 exacte : même fenêtre les semaines
  précédentes, zéros compris, **4 fenêtres comparables minimum**, MAD=0 sensible au moindre
  écart — une fenêtre n'est comparable que si l'issue y était suivie (activation v2) et
  ses données encore conservées. Délai de grâce : pas de nouvelle notification tant que
  l'événement de la règle n'est pas acquitté dans la fenêtre, ni deux dans une même fenêtre.
- **`no_data` explicite** pour toutes les règles : `alert_rule.last_state` (`ok`,
  `breached`, `no_data`), `last_value`, `last_reason`, `last_evaluated_at`, affichés sur
  `/alerts`. Issue absente ou regroupement inactif, fenêtre incomplète, aucune mesure,
  comparables insuffisants : jamais un zéro silencieux.
- **`check_new_errors`** (watermark v64) écarte la ligne d'une issue qui a sa notification
  `new` dans l'outbox (v74) : notifiée une fois, pas deux. Une issue née avant v73, sans
  notification, reste couverte par le watermark.
- **Dispatcher local** : livre désormais aussi les événements **sans règle** (nouvelles
  erreurs, SLO, uptime, issues) déclenchés depuis `alert_config.rule_less_dispatch_since` ;
  l'arriéré antérieur a été soldé `skipped` par la migration. Chaque livraison est réservée
  (`for update skip locked`), postée et marquée dans **sa** transaction : une passe coupée
  ne reposte que la livraison en cours. Passe bornée à 50 livraisons et par une échéance
  (10 s dans le notifier, 45 s dans le tick) ; une cible ni HTTP ni adresse e-mail est
  `skipped` au lieu d'échouer cinq fois.

## Sécurité / exploitation

- `check_alerts` / `check_slo_burn` / `route_alert` / `metric_baseline` sont
  **`SECURITY DEFINER`** à **`search_path` figé** (anti-injection, cf. v11), appelés par
  pg_cron (propriétaire) — jamais via l'API.
- Accès **`console_ro`** des nouvelles tables (`slo`, `notify_channel`) + `alert_rule`/
  `alert_event` codifié dans v17 (RLS + grant + policy, motif du finding #1).

## Preuves

- `scripts/verify-alerting.mjs` (Postgres réel) : threshold rétro-compatible, baseline qui
  **déclenche sur l'anomalie mais pas sur le normal**, `slo_status`/`fast_burn`,
  `check_slo_burn`, sélection de canaux par sévérité, lecture `console_ro`.
- `tests/unit/alerting.test.ts` : `sloView` (budget/burn/statut), `severityRank`.

## Suivi (non bloquant)

- Canal e-mail : vérifier un domaine d'envoi chez Resend (région UE `eu-west-1`) pour sortir
  du mode test ; SMS non prévu.
- Latence : 15 min tant que la base reste sur l'offre gratuite (ADR-0014).
- Baseline multi-fenêtres (court + long) pour les alertes de tendance lente.
- Silencing / maintenance windows (suppression programmée des alertes).
