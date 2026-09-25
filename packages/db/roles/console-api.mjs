// Les rôles de `console-api` (C13, migration-v93) : CE QUE CHACUN PEUT FAIRE, et
// rien d'autre. Deux rôles, parce que le service a deux métiers qui ne doivent
// pas se prêter leurs droits :
//
//   · `mip_identity` — l'IDENTITÉ : la connexion (le haché du mot de passe), les
//     sessions, les compteurs de débit d'authentification, leur ligne d'audit.
//     Rien d'autre : pas une mesure, pas un tableau de bord ;
//   · `mip_console` — tout le reste : les écrans (lecture), les commandes (le plan
//     de contrôle), le RGPD. Il ne lit JAMAIS un haché de mot de passe, ni une
//     session, ni un compteur de débit.
//
// Trois lecteurs, comme pour `mip_api` :
//   · `scripts/ci/verify-db-roles-console.mjs` compare les droits RÉELS d'une base
//     à ces listes, dans les deux sens, et vérifie que toute relation nommée par le
//     bundle du service est couverte ;
//   · `tests/unit/roles-console-api.test.ts` vérifie que migration-v93 accorde
//     exactement ces listes ;
//   · la matrice d'autorisations (`tests/contract/console-api-authz.test.ts`) peut
//     faire tourner le service SOUS CES RÔLES (`CONSOLE_API_AUTHZ_ROLES=1`, en CI) :
//     un droit oublié s'y voit comme une panne d'écran ou de commande.
//
// D'OÙ VIENNENT LES LISTES. Des requêtes du bundle (`services/console-api/dist/
// server.mjs` : les chargeurs, les commandes et les modules du backend qu'ils
// appellent), relevées le 25/09/2026 sur une base migrée jusqu'à v92 ; plus ce que
// font les fonctions de l'effacement RGPD (`privacy_*`, à droits de l'APPELANT).
//
// UN ÉCART AU PLAN, ASSUMÉ. Le plan (C13) refusait à `mip_console` toute
// suppression dans la télémétrie. Mais l'effacement RGPD (C10) est exécuté par
// console-api : il SUPPRIME les lignes d'une personne (`DSAR_CHILD_TABLES`,
// `rum_session`) et verrouille ses sessions (`for update`, qui exige un droit
// UPDATE : accordé sur une seule colonne, `last_seen_at`, et rien ne l'écrit).
// Ces droits n'existent que pour lui. Les retirer demande un effacement porté par
// une fonction à droits de propriétaire — noté pour plus tard.

/** Les privilèges de table, dans l'ordre où PostgreSQL les nomme. */
export const PRIVILEGES = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);

/** Les tables de l'effacement RGPD (`apps/console/lib/dsar.ts`, DSAR_CHILD_TABLES + l'ancre). */
const EFFACEES = [
  "replay_chunk",
  "rum_action",
  "rum_ai",
  "rum_breadcrumb",
  "rum_error",
  "rum_event",
  "rum_event_index",
  "rum_log",
  "rum_longtask",
  "rum_metric",
  "rum_pageview",
  "rum_resource",
  "rum_session",
  "rum_span",
];

const L = ["SELECT"];
const LI = ["SELECT", "INSERT"];
const LIM = ["SELECT", "INSERT", "UPDATE"];
const TOUT = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const LS = ["SELECT", "DELETE"];

export const MIP_CONSOLE = Object.freeze({
  nom: "mip_console",
  limiteConnexions: 40,
  /**
   * Réglages du rôle. PAS de `statement_timeout` : l'échéance de chaque appel est
   * posée par le pipeline ; l'effacement RGPD attend un verrou jusqu'à 30 s.
   */
  reglages: Object.freeze({ idle_in_transaction_session_timeout: "60s" }),
  /** Privilèges par table ou vue (niveau table). */
  tables: Object.freeze({
    // Les écrans : la télémétrie et ses agrégats, en lecture.
    alert_delivery: L,
    deploy_marker: L,
    error_grouping_config: L,
    error_issue_alias: L,
    error_issue_notification: L,
    extension_install_app: L,
    metric_histogram_hourly: L,
    metric_histogram_state: L,
    platform_flag: L,
    route_cardinality: L,
    rum_rollup_hourly: L,
    scheduler_lease: L,
    sourcemap: L,
    svi_call: L,
    svi_step: L,
    syn_snapshot: L,
    tenant_usage_daily: L,
    v_anomaly: L,
    v_log_anomaly: L,
    v_uptime_status: L,
    // L'effacement RGPD (C10) : les lignes d'une personne.
    ...Object.fromEntries(EFFACEES.map((t) => [t, LS])),
    ingest_raw: ["SELECT", "UPDATE", "DELETE"],
    privacy_erasure_barrier: LI,
    privacy_erasure_request: LIM,
    // `privacy_marquer_heures` : un upsert (`on conflict … do update`).
    analytics_rollup_invalidation: LIM,
    // Le plan de contrôle : les commandes (C6 → C10).
    alert_event: ["SELECT", "UPDATE"],
    alert_rule: LIM,
    analytics_saved_view: TOUT,
    app_registry: LIM,
    audit_log: LI,
    dashboard: TOUT,
    error_issue: ["SELECT", "UPDATE", "DELETE"],
    error_issue_activity: LI,
    error_issue_ticket: LI,
    error_status: LIM,
    extension_install: LS,
    extension_scope: LIM,
    goal: TOUT,
    mobile_capabilities: ["SELECT", "UPDATE"],
    notify_channel: TOUT,
    read_tokens: LIM,
    slo: TOUT,
    sourcemap_upload_token: LIM,
    ticket_integration: LIM,
    ticket_outbox: LI,
    uptime_check: TOUT,
  }),
  /**
   * Privilèges par COLONNES, là où la table entière serait de trop :
   *   · console_user : qui est qui (écrans, assignation, administration des
   *     comptes) — jamais `password_hash` en LECTURE ; l'administration des
   *     comptes en ÉCRIT un (création, réinitialisation), sans jamais le relire ;
   *   · console_session : révoquer les sessions d'un compte désactivé (C9), sans
   *     lire ce qu'elles portent ;
   *   · rum_session.last_seen_at : le droit que `select … for update` exige
   *     (l'effacement verrouille les sessions qu'il supprime) ; rien ne l'écrit.
   */
  colonnes: Object.freeze({
    console_user: Object.freeze({
      SELECT: ["active", "apps", "created_at", "email", "id", "last_login_at", "role"],
      INSERT: ["apps", "email", "password_hash", "role"],
      UPDATE: ["active", "apps", "password_hash", "role"],
    }),
    console_session: Object.freeze({
      SELECT: ["id", "revoked_at", "user_id"],
      UPDATE: ["revoked_at", "revoked_reason"],
    }),
    rum_session: Object.freeze({ UPDATE: ["last_seen_at"] }),
  }),
  /** Fonctions à droits de propriétaire, retirées à PUBLIC, que le service appelle. */
  fonctions: Object.freeze([
    "alert_release_p75",
    "check_alerts",
    "check_slo_burn",
    "event_metric_baseline",
    "route_error_issue_notifications",
    "slo_status",
  ]),
});

export const MIP_IDENTITY = Object.freeze({
  nom: "mip_identity",
  limiteConnexions: 20,
  reglages: Object.freeze({ statement_timeout: "10s", idle_in_transaction_session_timeout: "30s" }),
  tables: Object.freeze({
    console_user: LIM,
    console_session: LIM,
    auth_throttle: TOUT,
    audit_log: ["INSERT"],
  }),
  colonnes: Object.freeze({}),
  fonctions: Object.freeze([]),
});

export const ROLES = Object.freeze([MIP_CONSOLE, MIP_IDENTITY]);

/**
 * Relations que le bundle NOMME sans que l'un des deux rôles les touche, et
 * pourquoi. (Le bundle embarque aussi des modules du backend dont le service
 * n'appelle qu'une partie.)
 */
export const HORS_DROITS = Object.freeze({
  auth_throttle: "l'identité seule (mip_identity)",
});
