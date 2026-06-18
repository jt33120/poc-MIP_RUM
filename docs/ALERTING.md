# Alerting mature — baselines, SLO/error-budget, routing (P1)

> Passer de l'alerting **statique** (seuil fixe) à un alerting **mature** attendu au
> niveau grand compte. Contrat SQL : `apps/ingest/sql/migration-v17.sql`. Console :
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

- **`slo_status(app?)`** calcule, par SLO actif : **atteinte** (part conforme sur la
  fenêtre — vitals « good » ou `1 − taux d'erreur`), **budget** (`1 − objectif`),
  **% de budget consommé**, et **`fast_burn`**.
- **Burn-rate** : `fast_burn` = le taux non conforme de la **dernière heure** dépasse
  **14,4×** le budget (convention SRE multi-fenêtres — épuiserait un budget 30 j en ~2 j).
- **`check_slo_burn()`** (pg_cron toutes les 5 min) crée un `alert_event` **critical**
  rattaché au SLO (`slo_id`) sur burn rapide, avec dédup horaire. Flux d'événements
  **unifié** avec les règles (`alert_event.rule_id` OU `slo_id`).
- Console **`/slo`** : barre d'atteinte, statut (ok / at_risk ≥ 75 % / breached), badge
  « burn rapide ». Helper pur testé : `lib/alerting.ts` → `sloView()`.

## Pilier 3 — Routing multi-canal + sévérité

- Chaque règle porte une **`severity`** (`info` < `warning` < `critical`), reprise sur
  l'`alert_event` et dans la charge utile.
- Table **`notify_channel(app_id?, kind, target, severity_min, active)`**. À chaque
  déclenchement, **`route_alert()`** notifie **tous** les canaux éligibles (sévérité ≥
  `severity_min`, app correspondante ou globale `app_id null`), **en plus** du
  `webhook_url` historique de la règle (rétro-compatible).
- Canaux livrés : **`webhook`** (JSON complet) et **`slack`** (payload `{text}` pour les
  *incoming webhooks* — gratuit). Envoi via `pg_net` (asynchrone) ; en local sans
  l'extension, la livraison reste `queued` et part via `apps/ingest/dispatch-alerts.mjs`.
- **E-mail / SMS** : `kind='email'` est **tracé `skipped`** (hook prêt) mais **non livré**
  — nécessite un service externe **payant** (Resend/SES/Postmark). À brancher sur décision.

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

- Canal e-mail/SMS (service payant) — décision commerciale.
- Baseline multi-fenêtres (court + long) pour les alertes de tendance lente.
- Silencing / maintenance windows (suppression programmée des alertes).
