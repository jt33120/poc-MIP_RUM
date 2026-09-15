import type { EventMeta } from "./event-context";

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
  beforeSend?: (
    attributes: Record<string, unknown>,
    meta?: EventMeta,
  ) => Record<string, unknown> | null;
  /** Session replay (v0.3) : false (défaut) | true (toutes les sessions) | taux 0..1 */
  replay?: boolean | number;
  /** Replay endpoint override; default = endpoint with /v1/traces replaced by /v1/replay */
  replayEndpoint?: string;
  /**
   * Ce que le rejeu MASQUE. Défaut : `"all"`.
   *
   *   "all"    saisies + texte + médias (images, vidéos, canvas, SVG).
   *            Le standard 2026 : on masque, et l'app démasque ce qu'elle a
   *            décidé de montrer.
   *   "media"  saisies + médias ; le texte de la page reste lisible. Pour une
   *            application interne dont l'écran ne porte pas de donnée
   *            personnelle, mais dont les pièces jointes en portent.
   *   "inputs" saisies seulement — le comportement d'avant. À ne choisir qu'en
   *            connaissance de cause : tout ce que l'application AFFICHE est
   *            alors enregistré en clair.
   *
   * Dans les trois cas, les saisies sont masquées et un bloc marqué
   * `.mip-rum-block` par l'application n'est jamais capturé.
   */
  replayMask?: "all" | "media" | "inputs";
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
  /**
   * Widget d'avis (CSAT) : false (défaut) = rien. true = charge en lazy le
   * bouton flottant « Votre avis ? » (script mip-rum-feedback.js, même origine
   * que ce SDK) ; l'utilisateur note 1–5 → MIPRum.track('feedback', {score}).
   * Objet = mêmes options que window.MIPRumFeedback ({ label, accent, offset,
   * cooldownDays, once }).
   * `onlyPaths` restreint l'affichage à des préfixes de chemin (ex. pages
   * authentifiées) — ré-évalué à la navigation, SPA comprise ; absent = partout.
   * `offset` (px, défaut 20) écarte le bouton du coin bas-droit : à augmenter
   * quand l'application y place déjà une pastille flottante (chat, aide…).
   * Aucun script séparé à poser côté site : une ligne de config suffit.
   *
   * `cooldownDays` (défaut 60) est la période de SILENCE qui suit un avis
   * envoyé : le lanceur n'est pas monté tant qu'elle court, cloisonnée par appId
   * (deux apps du même navigateur ne se masquent pas l'une l'autre). 0 = aucun
   * silence. `once: true` rend le silence définitif — à réserver aux
   * intégrations qui veulent vraiment un avis unique : un CSAT mesure une
   * satisfaction dans le temps, et « une fois pour toutes » plafonne le nombre
   * d'avis au nombre d'utilisateurs, pour la vie du produit.
   *
   * Le widget marque ses racines avec `data-mip-rum-ui` : ses propres clics sont
   * donc exclus du détecteur de frustration (cf. frustration.ts), sans quoi
   * chaque ouverture du panneau polluerait les clics morts de l'application.
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

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
