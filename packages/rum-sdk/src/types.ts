import type { EventMeta } from "./event-context";

export interface MIPRumConfig {
  /** Endpoint OTLP/HTTP JSON, ex. https://<ingest>/v1/traces */
  endpoint: string;
  /** Identifiant de l'application, ex. 'gip-plateforme' */
  appId: string;
  /** Identifiant du client, ex. 'client-recette' */
  clientId?: string;
  env?: string;
  /** Version de l'app (SHA git, "1.4.2"), envoyée en mip.release pour retrouver la source map des erreurs. */
  release?: string;
  /** 0..1, part des sessions collectées en entier (défaut 1). */
  sampleRate?: number;
  /**
   * true (défaut) : une session hors `sampleRate` n'envoie que ses erreurs, et la
   * première la fait passer en collecte complète. false : elle n'envoie rien.
   */
  keepOnError?: boolean;
  /** 0..1, part des sessions hors `sampleRate` gardées sur erreur (défaut 1). */
  errorSampleRate?: number;
  /** Intervalle d'envoi des lots, en ms (défaut 3000). */
  flushIntervalMs?: number;
  /** Clé d'API de l'app, envoyée en attribut de resource mip.api_key (sendBeacon ne porte pas d'en-têtes). */
  apiKey?: string;
  /** Seuil en ms au-delà duquel une ressource donne un span 'resource' (défaut 300). */
  slowResourceMs?: number;
  /**
   * Spans 'resource' : "slow" (défaut) les lentes et les bloquantes, 20 par page ;
   * "all" toutes, 150 par page. Le résumé par vue (nombre, octets) part toujours.
   */
  resources?: "slow" | "all";
  /** performance.mark / performance.measure de l'app → timings `mark:` / `measure:` (défaut true). */
  userTimings?: boolean;
  /** RGPD : true garde tout en mémoire jusqu'à MIPRum.consent(true) (défaut false). */
  requireConsent?: boolean;
  /**
   * RGPD : true (défaut) respecte Do Not Track et Global Privacy Control, sans
   * aucune collecte sur refus. false : réservé aux apps qui recueillent elles-mêmes
   * le consentement et pilotent la collecte via MIPRum.consent().
   */
  honorDNT?: boolean;
  /** Dernier filtre de données personnelles sur les attributs de chaque span ; rendre null pour le jeter. */
  beforeSend?: (
    attributes: Record<string, unknown>,
    meta?: EventMeta,
  ) => Record<string, unknown> | null;
  /** Rejeu de session : false (défaut), true (toutes les sessions) ou taux 0..1. */
  replay?: boolean | number;
  /** Endpoint du rejeu ; défaut : `endpoint` avec /v1/traces remplacé par /v1/replay. */
  replayEndpoint?: string;
  /**
   * Ce que le rejeu masque (défaut "all") : "all" saisies, texte et médias ;
   * "media" saisies et médias, texte lisible ; "inputs" saisies seulement, tout ce
   * que l'app affiche part en clair. Les saisies restent toujours masquées et
   * `.mip-rum-block` n'est jamais capturé.
   */
  replayMask?: "all" | "media" | "inputs";
  /**
   * Sélecteur CSS des zones démasquées sous "all" et "media", en plus de
   * `.mip-rum-unmask` (défaut : aucune). Leur texte et leurs médias partent en
   * clair, sauf champs natifs, `contenteditable`, `designMode` et `.mip-rum-block`.
   * Un widget de saisie maison écrit du texte ordinaire : le marquer `.mip-rum-block`.
   * Sélecteur invalide : ignoré avec un avertissement. Sans `:is()` (navigateurs
   * d'avant 2021), seul le texte se démasque.
   */
  replayUnmask?: string;
  /**
   * Tracing distribué : true (défaut) propage `traceparent` aux appels same-origin ;
   * string[] y ajoute des origines (ex. 'https://api.exemple.fr') ; false le coupe.
   */
  trace?: boolean | string[];
  /**
   * Voies d'erreur en plus des exceptions et rejets non interceptés : console,
   * ressources, CSP et réseau sur option ; workers et WebSockets actifs par défaut,
   * coupables (le guide d'intégration).
   */
  captureErrors?: CaptureErrorsConfig;
  /** Signaux de frustration (rage clicks, dead clicks) : true (défaut) ou false. */
  frustration?: boolean;
  /**
   * Analyse des formulaires par champ (ordre, temps, abandon) : true (défaut) ou
   * false. Jamais les valeurs saisies, seulement identifiants et durées.
   */
  forms?: boolean;
  /**
   * Étiquette du capteur, portée en mip.collection_source : 'sdk' (défaut, script
   * posé dans l'app) ou 'extension' (injecté par l'extension). Ne change pas la collecte.
   */
  collectionSource?: "sdk" | "extension";
  /**
   * Widget d'avis (CSAT) : false (défaut) ; true charge en différé le bouton
   * « Votre avis ? » (mip-rum-feedback.js, même origine que le SDK), note 1–5 →
   * MIPRum.track('feedback', {score}) ; objet : options de window.MIPRumFeedback.
   * `onlyPaths` : préfixes de chemin où l'afficher (réévalués à chaque navigation).
   * `offset` (px, défaut 20) : écart au coin bas-droit, face à une autre pastille.
   * `cooldownDays` (défaut 60, 0 = aucun) : silence après un avis, par appId ;
   * `once: true` le rend définitif et plafonne les avis au nombre d'utilisateurs.
   */
  feedback?:
    | boolean
    | {
        label?: string;
        accent?: string;
        offset?: number;
        onlyPaths?: string[];
        cooldownDays?: number;
        once?: boolean;
      };
}

export interface CaptureErrorsConfig {
  /** `console.error` → erreur `console`, marquée gérée. Défaut false. */
  console?: boolean;
  /** Échecs de chargement (img, script, link, média…) → erreur `resource`. Défaut false. */
  resources?: boolean;
  /** Violations CSP (événement + ReportingObserver, dédupliqués) → erreur `csp`. Défaut false. */
  csp?: boolean;
  /**
   * Appels fetch/XHR tracés (`trace`) → erreur `network` : true = échecs réseau,
   * délais et 5xx ; l'objet ajoute les 4xx (`clientErrors`) et les abandons (`aborts`). Défaut false.
   */
  network?: boolean | { clientErrors?: boolean; aborts?: boolean };
  /** Erreur non interceptée dans un Web Worker → erreur `[Worker] …`. Défaut true. */
  workers?: boolean;
  /** WebSocket en erreur ou fermée anormalement (1006, 1011…) → erreur réseau. Défaut true. */
  websockets?: boolean;
}

/** Voie de capture d'une erreur ; `uncaught` = exceptions et rejets non interceptés. */
export type ErrorCategory = "uncaught" | "console" | "resources" | "csp" | "network" | "workers" | "websockets";

/** Compteurs d'une voie depuis init(), en occurrences. */
export interface ErrorCategoryStats {
  /** La voie est active (demandée, et ses prérequis de configuration réunis). */
  enabled: boolean;
  /** API navigateur absentes : la voie est partielle, ou muette. */
  unsupported: string[];
  /** Occurrences prises en charge par l'émission (livrées ou en attente de consentement). */
  emitted: number;
  /** Occurrences d'erreurs distinctes tues par le plafond de la page. */
  capped: number;
  /** Occurrences refusées par l'émission : beforeSend, consentement refusé ou révoqué. */
  rejected: number;
}

export type ErrorCollectionStats = Record<ErrorCategory, ErrorCategoryStats>;

/** Troisième argument de `addError`. */
export interface AddErrorOptions {
  /**
   * Clé de regroupement opaque, sans donnée personnelle, 100 caractères au plus,
   * envoyée en `mip.error_fingerprint` et prioritaire au regroupement. Invalide :
   * ignorée, l'erreur part quand même.
   */
  fingerprint?: string;
}

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
