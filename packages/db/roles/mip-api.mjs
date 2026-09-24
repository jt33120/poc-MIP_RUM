// Le rôle `mip_api` (migration-v89) : CE QU'IL PEUT LIRE, et rien d'autre.
//
// C'est la liste blanche du service `api`, en un seul endroit. Deux lecteurs :
//   · `scripts/ci/verify-db-roles.mjs` compare les droits RÉELS d'une base à
//     cette liste, dans les deux sens (rien de plus, rien de moins), et vérifie
//     que toute relation nommée par le bundle du service y figure ;
//   · `tests/unit/role-mip-api.test.ts` vérifie que migration-v89.sql accorde
//     exactement cette liste.
// La migration est figée une fois fusionnée : un ajout passe par une migration
// NOUVELLE et une ligne ici, dans la même PR. La garde CI le rappelle.
//
// D'OÙ VIENT LA LISTE. Des relations que nomme le bundle du service
// (`services/api/dist/server.mjs`, construit depuis les routes v1 de la
// console), relevé le 24/09/2026 sur une base migrée jusqu'à v88. Le contrat de
// parité (`tests/contract/api-parity.test.ts`) fait tourner le service SOUS CE
// RÔLE : une table oubliée ici s'y voit comme un écart avec la console.

/** Tables et vues lues en entier. */
export const TABLES = Object.freeze([
  "analytics_rollup_invalidation",
  "app_registry",
  "error_grouping_config",
  "error_issue",
  "error_issue_activity",
  "error_issue_alias",
  "error_issue_ticket",
  "error_status",
  "metric_histogram_hourly",
  "metric_histogram_state",
  "mobile_capabilities",
  "read_tokens",
  "rum_action",
  "rum_breadcrumb",
  "rum_error",
  "rum_event",
  "rum_event_index",
  "rum_longtask",
  "rum_metric",
  "rum_pageview",
  "rum_resource",
  "rum_rollup_hourly",
  "rum_session",
  "rum_span",
  "sourcemap",
  "syn_snapshot",
  "ticket_outbox",
  "v_anomaly",
]);

/**
 * Tables lues PAR COLONNES : ce qui manque est un secret, ou un contenu que
 * l'API ne sert pas. Un `select *` y échoue, et c'est voulu.
 */
export const COLONNES = Object.freeze({
  // la jointure d'une activité d'issue à son acteur, par identifiant. L'e-mail
  // n'est servi qu'à une SESSION administrateur, que le service n'a jamais :
  // ni `email`, ni `password_hash`, ni `role`, ni `apps`
  console_user: Object.freeze(["id"]),
  // l'existence d'un rejeu pour une erreur ; jamais son contenu (`body`)
  replay_chunk: Object.freeze(["app_id", "session_id"]),
  // où part un ticket ; jamais `credential_ref`, `webhook_secret_ref`, `config`
  ticket_integration: Object.freeze(["id", "app_id", "provider", "target", "state", "enabled", "verified_at"]),
});

/** Fonctions à droits de propriétaire (SECURITY DEFINER) que l'API exécute : des lectures. */
export const FONCTIONS = Object.freeze(["event_metric_baseline"]);

/**
 * Relations que le bundle NOMME sans que l'API les lise : les écritures des
 * routes que le service refuse en 405. Chacune dit pourquoi.
 */
export const HORS_LECTURE = Object.freeze({
  analytics_saved_view: "vues enregistrées : personnelles, refusées à tout jeton (403) avant toute lecture",
  audit_log: "écrit par le triage et les tickets des issues — routes d'écriture, 405 dans le service",
  deploy_marker: "écrit par POST /api/v1/deploys — route d'écriture, 405 dans le service",
  slo: "nommé comme chemin d'écran (« /slo »), jamais lu : l'API v1 n'a pas de route SLO",
});

/**
 * Fonctions à droits de propriétaire qui ÉCRIVENT et que PUBLIC exécutait :
 * v89 les retire à PUBLIC. Sans cela, un rôle sans aucun droit d'écriture
 * écrirait quand même, par elles. Leurs appelants (collector, scheduler,
 * notifier) se connectent en propriétaire et gardent le droit.
 */
export const RETIREES_A_PUBLIC = Object.freeze([
  "check_ai_op_anomalies",
  "check_new_errors",
  "reconcile_alert_deliveries",
  "upsert_svi_call",
]);

/** Réglages du rôle, posés par la migration (`alter role … set`). */
export const REGLAGES = Object.freeze({
  default_transaction_read_only: "on",
  statement_timeout: "15s",
  idle_in_transaction_session_timeout: "30s",
});

/** Plafond de connexions du rôle : 2 répliques × pool de 6, et de la marge. */
export const LIMITE_CONNEXIONS = 20;
