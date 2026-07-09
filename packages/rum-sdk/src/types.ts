export interface MIPRumConfig {
  /** OTLP/HTTP JSON endpoint, ex: https://<ingest>/v1/traces */
  endpoint: string;
  /** Application identifier, ex: 'gip-plateforme' */
  appId: string;
  /** Client identifier, ex: 'groupement-it' */
  clientId?: string;
  env?: string;
  /** Version/release de l'app (ex. git SHA, "1.4.2") — envoyé en attribut resource
   *  mip.release. Sert à associer les erreurs à la bonne source map (dé-minification). */
  release?: string;
  /** 0..1, fraction of sessions fully sampled (default 1.0) */
  sampleRate?: number;
  /**
   * Échantillonnage biaisé-erreurs (A1) : si true (défaut), les sessions hors
   * fraction `sampleRate` ne sont pas jetées mais passent en mode « error-biased »
   * — la télémétrie de routine est supprimée, mais toute erreur est conservée et
   * promeut la session en collecte complète pour la suite. Mettre false pour
   * l'ancien comportement (session non échantillonnée = rien n'est collecté).
   */
  keepOnError?: boolean;
  /** 0..1, fraction des sessions hors `sampleRate` gardées sur erreur (default 1.0) */
  errorSampleRate?: number;
  /** Batch flush interval in ms (default 3000) */
  flushIntervalMs?: number;
  /** Per-app API key, sent as OTLP resource attribute mip.api_key (sendBeacon carries no headers) */
  apiKey?: string;
  /** Slow resource threshold in ms for 'resource' spans (default 300) */
  slowResourceMs?: number;
  /** RGPD: if true, buffer everything in memory until MIPRum.consent(true) (default false) */
  requireConsent?: boolean;
  /**
   * Souveraineté / RGPD (Lot 5) : honorer les signaux navigateur d'opt-out
   * Do Not Track (DNT) et Global Privacy Control (GPC). true (défaut) = si le
   * navigateur signale un refus, aucune collecte n'a lieu (0 session, 0 requête).
   * false = ignore le signal — à réserver aux apps qui recueillent elles-mêmes un
   * consentement affirmatif et pilotent la collecte via MIPRum.consent().
   */
  honorDNT?: boolean;
  /** Last-chance PII filter applied to every span's attributes; return null to drop */
  beforeSend?: (attributes: Record<string, unknown>) => Record<string, unknown> | null;
  /** Session replay (v0.3) : false (défaut) | true (toutes les sessions) | taux 0..1 */
  replay?: boolean | number;
  /** Replay endpoint override; default = endpoint with /v1/traces replaced by /v1/replay */
  replayEndpoint?: string;
  /**
   * Tracing distribué (v0.4) : false = off ; true (défaut) = propagation
   * traceparent sur les appels same-origin ; string[] = origins SUPPLÉMENTAIRES
   * (ex. 'https://api.exemple.fr') en plus du same-origin.
   */
  trace?: boolean | string[];
  /** Signaux de frustration (P1) : rage clicks & dead clicks. true (défaut) | false pour désactiver. */
  frustration?: boolean;
  /**
   * Form analytics (Lot 7) : instrumentation des formulaires au niveau du champ
   * (ordre, temps par champ, abandon). true (défaut) | false pour désactiver.
   * Ne capte JAMAIS les valeurs saisies (identifiants + durées seulement ;
   * champs password réduits à "[password]").
   */
  forms?: boolean;
  /**
   * Mode de collecte (Ext-A) : 'sdk' (défaut) quand le script est posé dans le
   * code de l'app par le développeur ; 'extension' quand le SDK est injecté par
   * l'extension navigateur MIP RUM. Porté en attribut mip.collection_source et
   * persisté sur rum_session.collection_source — permet de segmenter/comparer les
   * deux capteurs dans la console. N'affecte PAS la collecte, juste son étiquette.
   */
  collectionSource?: "sdk" | "extension";
}

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
