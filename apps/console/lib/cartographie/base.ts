// La base Postgres (Neon) sur la carte : ses 70 tables, rangées par domaine, puis ses
// fonctions, ses vues et ses protections. Relevé du 30/09/2026, jusqu'à
// migration-v107.sql ; tests/unit/cartographie.test.ts refait la liste des tables à
// partir des migrations (créées, moins supprimées, plus `schema_migration` que crée
// le migrateur) et échoue si une table manque ici, ou n'existe plus.
import type { Element } from "./types";

const SQL = "packages/db/sql";

export interface Domaine {
  id: string;
  titre: string;
  sousTitre: string;
  resume: string;
  faits: Element["faits"];
  tables: readonly { nom: string; role: string }[];
}

export const DOMAINES: readonly Domaine[] = [
  {
    id: "base-mesures",
    titre: "Mesures brutes",
    sousTitre: "ce que les capteurs envoient, ligne à ligne",
    resume:
      "Chaque visite, page vue, Web Vital, erreur, appel, span et journal reçu, écrit par l'ingestion et lu par la console et l'API.",
    faits: [
      { texte: "Aucune table partitionnée : un index BRIN sur le temps pour les plus grosses.", sources: [`${SQL}/migration-v12.sql`] },
      {
        texte: "Purgées chaque jour à la rétention de leur application (30 jours par défaut).",
        sources: ["packages/backend/jobs/planifie.mjs"],
      },
      {
        texte: "`ingest_raw` est UNLOGGED : la file de l'ingestion différée, perdue en cas d'arrêt brutal.",
        sources: [`${SQL}/migration-v63.sql:22`],
      },
    ],
    tables: [
      { nom: "rum_session", role: "une visite : appareil, pays, identifiant visiteur aléatoire, release" },
      { nom: "rum_pageview", role: "une page vue : route normalisée, référent, type de navigation" },
      { nom: "rum_metric", role: "une mesure Web Vital ou de navigation (LCP, INP, CLS, FCP, TTFB…)" },
      { nom: "rum_error", role: "une occurrence d'erreur : message, pile, empreinte, release" },
      { nom: "rum_resource", role: "les ressources lentes ou bloquantes" },
      { nom: "rum_longtask", role: "les tâches longues et les entrées LoAF" },
      { nom: "rum_breadcrumb", role: "le fil d'actions de la session" },
      { nom: "rum_event", role: "les événements personnalisés et les signaux de frustration" },
      { nom: "rum_action", role: "les actions nettoyées : clics et actions manuelles" },
      { nom: "rum_span", role: "les spans de traçage, navigateur et serveur, reliés par trace_id" },
      { nom: "rum_log", role: "les journaux OpenTelemetry : sévérité, corps nettoyé, attributs" },
      { nom: "rum_event_index", role: "l'index des signaux, en ajout seul, à taxonomie fermée" },
      { nom: "rum_ai", role: "appels LLM : dépréciée, plus alimentée" },
      { nom: "ingest_raw", role: "la file de l'ingestion différée (UNLOGGED)" },
    ],
  },
  {
    id: "base-agregats",
    titre: "Agrégats et détections",
    sousTitre: "ce que le scheduler calcule",
    resume:
      "Les agrégats horaires, les histogrammes, les percentiles des Web Vitals, les constats détectés et la consommation quotidienne, recalculés par le scheduler.",
    faits: [
      { texte: "p50, p75 (avec son intervalle à 95 %) et p95 horaires, par route et par vital.", sources: [`${SQL}/migration-v101.sql:41`] },
      { texte: "Les constats détectés et les percentiles se purgent à 8 semaines.", sources: [`${SQL}/migration-v101.sql:77`] },
      { texte: "Un filigrane par agrégat dit jusqu'où tout est déjà agrégé.", sources: [`${SQL}/migration-v102.sql:41`] },
    ],
    tables: [
      { nom: "rum_rollup_hourly", role: "agrégat horaire par app et appareil : parts « bonnes », pages vues, erreurs" },
      { nom: "metric_histogram_hourly", role: "histogramme horaire des Core Web Vitals, en classes logarithmiques additionnables" },
      { nom: "metric_histogram_state", role: "les bornes du dernier calcul d'histogramme (une ligne)" },
      { nom: "analytics_rollup_invalidation", role: "les heures d'agrégat faussées par un effacement, relues sur le brut" },
      { nom: "agregat_filigrane", role: "l'instant avant lequel chaque agrégat est à jour" },
      { nom: "vital_horaire", role: "p50, p75 et p95 horaires des Web Vitals par route" },
      { nom: "signal_detecte", role: "les constats calculés : plage habituelle, rupture, release" },
      { nom: "tenant_usage_daily", role: "la consommation quotidienne par application, jamais purgée" },
    ],
  },
  {
    id: "base-erreurs",
    titre: "Erreurs et releases",
    sousTitre: "problèmes, source maps, déploiements",
    resume:
      "Les erreurs regroupées en problèmes durables avec leur cycle de vie, les source maps qui dé-minifient les piles, et les marqueurs de déploiement.",
    faits: [
      { texte: "Une erreur rejoint un problème par son empreinte ; les anciennes empreintes restent en alias.", sources: [`${SQL}/migration-v72.sql:83`, `${SQL}/migration-v72.sql:128`] },
      { texte: "Les notifications de problème passent par une file en base.", sources: [`${SQL}/migration-v73.sql:150`] },
    ],
    tables: [
      { nom: "error_issue", role: "un problème durable : statut, assignation, releases" },
      { nom: "error_issue_alias", role: "le lien d'une ancienne empreinte vers son problème" },
      { nom: "error_issue_activity", role: "l'historique du traitement d'un problème, en ajout seul" },
      { nom: "error_issue_notification", role: "la file des notifications : nouveau, régression, pic" },
      { nom: "error_status", role: "l'ancien triage par empreinte" },
      { nom: "rum_new_error_watermark", role: "le curseur de la détection des nouvelles erreurs (une ligne)" },
      { nom: "sourcemap", role: "les source maps par application, release et fichier" },
      { nom: "deploy_marker", role: "les marqueurs de déploiement : version, environnement" },
    ],
  },
  {
    id: "base-alertes",
    titre: "Alertes et SLO",
    sousTitre: "règles, déclenchements, livraisons",
    resume:
      "Les règles d'alerte et les objectifs de service, les alertes déclenchées par le scheduler, et leurs livraisons par le notifier.",
    faits: [
      { texte: "Une règle : un seuil, un écart à l'habitude, ou une régression de release.", sources: [`${SQL}/migration-v02.sql:62`] },
      { texte: "Les alertes déclenchées se purgent à 30 jours.", sources: [`${SQL}/migration-v02.sql:75`] },
    ],
    tables: [
      { nom: "alert_rule", role: "les règles d'alerte et leur dernier état" },
      { nom: "alert_event", role: "les alertes déclenchées" },
      { nom: "alert_delivery", role: "les livraisons : en file, envoyée, échouée" },
      { nom: "alert_config", role: "la configuration globale du routage (une ligne)" },
      { nom: "notify_channel", role: "les canaux : webhook, Slack, e-mail" },
      { nom: "slo", role: "les objectifs de niveau de service" },
    ],
  },
  {
    id: "base-comptes",
    titre: "Comptes et accès",
    sousTitre: "utilisateurs, sessions, jetons",
    resume:
      "Les comptes de la console, leurs sessions révocables, les compteurs anti-force brute et d'inscription, et les jetons d'API, tous hachés.",
    faits: [
      { texte: "Mots de passe hachés en bcrypt ; jetons et clés en SHA-256.", sources: [`${SQL}/migration-v03.sql:18`, `${SQL}/migration-v26.sql:6`] },
      { texte: "Une session dure 30 jours au plus, contrainte posée en base.", sources: [`${SQL}/migration-v90.sql:30`] },
      { texte: "Les échecs de connexion se comptent sous une clé HMAC-SHA256.", sources: [`${SQL}/migration-v90.sql:70`] },
    ],
    tables: [
      { nom: "console_user", role: "les comptes : e-mail, mot de passe bcrypt, rôle, apps autorisées, SSO, date d'inscription" },
      { nom: "console_session", role: "une session de console ou de démo, révocable" },
      { nom: "auth_throttle", role: "les compteurs d'échecs de connexion et d'inscriptions par IP" },
      { nom: "read_tokens", role: "les jetons de lecture de l'API v1, hachés" },
      { nom: "sourcemap_upload_token", role: "les jetons de CI : source maps et déploiements" },
    ],
  },
  {
    id: "base-applications",
    titre: "Applications",
    sousTitre: "registre, routes, configuration",
    resume:
      "Le registre des applications suivies (clé hachée, origines autorisées, rétention, quota) et la normalisation de leurs routes.",
    faits: [
      { texte: "La clé d'ingestion est stockée hachée, avec les origines autorisées.", sources: [`${SQL}/migration-v02.sql:5`, `${SQL}/migration-v05.sql`] },
      { texte: "Au-delà d'un plafond, une route nouvelle devient « (other) ».", sources: [`${SQL}/migration-v62.sql:78`] },
    ],
    tables: [
      { nom: "app_registry", role: "les applications : clé hachée, origines, rétention, quota, débit propre, fuseau" },
      { nom: "route_pattern", role: "les règles de normalisation des routes" },
      { nom: "route_registry", role: "les routes déjà vues, pour plafonner leur nombre" },
      { nom: "route_cardinality", role: "le compte de routes distinctes par application" },
      { nom: "error_grouping_config", role: "la version de regroupement d'erreurs active" },
      { nom: "mobile_capabilities", role: "ce qu'un SDK mobile déclare collecter" },
    ],
  },
  {
    id: "base-chaine",
    titre: "Surveillance de la chaîne",
    sousTitre: "sondes, battements, fenêtres",
    resume:
      "Le journal des sondes que le scheduler passe sur chaque étage de la collecte, et le registre des périodes où elle a été dégradée.",
    faits: [
      { texte: "Une ligne par passage du scheduler et par étage sondé, gardée 90 jours.", sources: [`${SQL}/migration-v103.sql:50`] },
      { texte: "Les alertes tiennent compte des fenêtres hors collecte.", sources: [`${SQL}/migration-v103.sql:79`] },
    ],
    tables: [
      { nom: "sonde_passage", role: "une ligne par passage et par étage sondé" },
      { nom: "collecte_fenetre", role: "les périodes de collecte dégradée ou interrompue" },
      { nom: "sonde_attendue", role: "les battements qu'une application déclare" },
      { nom: "sonde_battement", role: "le dernier signe de vie des services sans bail" },
    ],
  },
  {
    id: "base-plateforme",
    titre: "Plateforme",
    sousTitre: "migrations, verrou, drapeaux, débit",
    resume:
      "Ce qui fait tourner la plateforme : le registre des migrations, le verrou du scheduler, les drapeaux de bascule et les compteurs de débit.",
    faits: [
      { texte: "Le verrou est une ligne, pas un verrou de session : le pooler de Neon les annule.", sources: [`${SQL}/migration-v54.sql:31`] },
      {
        texte: "Quatre drapeaux : ingest_relay_pct, api_relay_pct, console_api_ecrans_pct, scheduler_tick_min.",
        sources: [`${SQL}/migration-v87.sql:91`],
      },
    ],
    tables: [
      { nom: "schema_migration", role: "les migrations appliquées et leur empreinte sha256" },
      { nom: "scheduler_lease", role: "le verrou des travaux planifiés" },
      { nom: "platform_flag", role: "les drapeaux de bascule" },
      { nom: "rate_counter", role: "les requêtes par application et par minute" },
      { nom: "backfill_run", role: "le journal des reprises d'historique" },
    ],
  },
  {
    id: "base-espace",
    titre: "Espace de travail",
    sousTitre: "tableaux, vues, objectifs",
    resume: "Ce que les utilisateurs enregistrent dans la console : tableaux de bord, analyses de l'Explorer, objectifs.",
    faits: [
      { texte: "Le cache du briefing IA n'est plus lu ni écrit depuis le retrait du copilote.", sources: [`${SQL}/migration-v28.sql:6`] },
    ],
    tables: [
      { nom: "dashboard", role: "les tableaux de bord et leurs widgets" },
      { nom: "analytics_saved_view", role: "les analyses enregistrées de l'Explorer" },
      { nom: "goal", role: "les objectifs : une page vue ou un événement atteint" },
      { nom: "ai_briefing", role: "l'ancien cache du briefing IA, inutilisé" },
    ],
  },
  {
    id: "base-rgpd",
    titre: "Audit et RGPD",
    sousTitre: "journal, effacements",
    resume: "Le journal d'audit, que la base refuse de modifier, et les effacements de personnes demandés au titre du RGPD.",
    faits: [
      {
        texte: "Le journal d'audit est en ajout seul : des déclencheurs refusent modification, suppression et troncature.",
        sources: [`${SQL}/migration-v90.sql`],
      },
      { texte: "Une personne effacée reste bloquée à l'ingestion, sans échéance.", sources: [`${SQL}/migration-v81.sql:127`] },
    ],
    tables: [
      { nom: "audit_log", role: "le journal d'audit, en ajout seul" },
      { nom: "privacy_erasure_barrier", role: "les personnes effacées que l'ingestion refuse" },
      { nom: "privacy_erasure_request", role: "le journal des demandes d'effacement" },
    ],
  },
  {
    id: "base-disponibilite",
    titre: "Disponibilité",
    sousTitre: "sondes HTTP et synthétiques",
    resume: "Les vérifications HTTP que le scheduler lance sur les sites, et les résultats des sondes synthétiques externes.",
    faits: [{ texte: "Les résultats des sondes HTTP suivent la rétention de leur application.", sources: [`${SQL}/migration-v42.sql:26`] }],
    tables: [
      { nom: "uptime_check", role: "les vérifications HTTP configurées" },
      { nom: "uptime_result", role: "l'historique des vérifications" },
      { nom: "syn_snapshot", role: "les résultats des sondes synthétiques externes" },
    ],
  },
  {
    id: "base-extension",
    titre: "Extension et postes",
    sousTitre: "domaines, postes équipés",
    resume: "Les domaines que l'extension a le droit d'observer, et les postes équipés qui battent.",
    faits: [{ texte: "Un poste est un UUID aléatoire : ni nom de personne, ni adresse.", sources: [`${SQL}/migration-v52.sql:34`] }],
    tables: [
      { nom: "extension_scope", role: "un domaine associé à une application" },
      { nom: "extension_install", role: "un poste équipé : version, navigateur" },
      { nom: "extension_install_app", role: "les applications qu'alimente chaque poste" },
    ],
  },
  {
    id: "base-rejeu",
    titre: "Rejeu",
    sousTitre: "sessions enregistrées",
    resume: "Les morceaux de rejeu (rrweb), compressés, par session et numéro d'ordre.",
    faits: [{ texte: "Compressés en gzip, purgés à la rétention de leur application.", sources: [`${SQL}/migration-v03.sql:5`] }],
    tables: [{ nom: "replay_chunk", role: "un morceau de rejeu rrweb compressé" }],
  },
];

/** Toutes les tables de la carte, dans l'ordre des domaines. */
export const TABLES_CARTE: readonly string[] = DOMAINES.flatMap((d) => d.tables.map((t) => t.nom));
