// Glossaire central — source unique des explications affichées au survol (InfoTip).
//
// Chaque entrée porte trois niveaux de lecture pour un POC à la fois navigable
// par un commercial et crédible devant une équipe technique :
//   - term     : le nom technique exact (vocabulaire métier RUM/OTel)
//   - stack    : la brique technique qui produit/calcule la donnée
//   - business : la même chose expliquée à un non-technicien (valeur, décision)
//
// Ajouter une clé ici suffit à enrichir n'importe quel <GlossaryTip id="…" />.

export interface GlossaryEntry {
  /** Titre lisible affiché en tête de la bulle. */
  label: string;
  /** Nom technique exact (terme OTel / Web Vitals / SQL). */
  term: string;
  /** Stack technique : d'où vient la mesure, comment elle est calculée. */
  stack: string;
  /** Lecture commerciale : ce que ça veut dire, pourquoi ça compte. */
  business: string;
}

export const GLOSSARY = {
  // --- Core Web Vitals -------------------------------------------------------
  LCP: {
    label: "LCP — Largest Contentful Paint",
    term: "Largest Contentful Paint (Core Web Vital, seuil 2026 : bon < 2,0 s, à améliorer < 2,5 s).",
    stack:
      "Mesuré dans le navigateur réel par l'API PerformanceObserver (entry type 'largest-contentful-paint'), émis en span OTLP 'webvital.LCP' par le SDK.",
    business:
      "Le temps avant que le plus gros élément visible (image, titre) s'affiche. C'est la perception de « la page a chargé ». Au-delà de 2,5 s, l'internaute a l'impression d'attendre.",
  },
  INP: {
    label: "INP — Interaction to Next Paint",
    term: "Interaction to Next Paint (Core Web Vital, remplace FID ; bon < 200 ms, à améliorer < 500 ms).",
    stack:
      "Latence entre une interaction (clic, frappe) et le prochain rendu, captée via PerformanceObserver ('event'/'first-input') et agrégée au p75.",
    business:
      "La réactivité ressentie : quand on clique, le site répond-il tout de suite ? Un INP élevé = interface qui « rame », première cause d'agacement et d'abandon.",
  },
  CLS: {
    label: "CLS — Cumulative Layout Shift",
    term: "Cumulative Layout Shift (Core Web Vital sans unité ; bon < 0,1, à améliorer < 0,25).",
    stack:
      "Somme des décalages visuels inattendus (layout-shift) mesurés en continu par PerformanceObserver pendant la vie de la page.",
    business:
      "La stabilité visuelle : est-ce que le contenu « saute » pendant le chargement (un bouton se déplace au moment où on clique) ? Un CLS élevé crée des erreurs de clic et une impression de site bâclé.",
  },
  FCP: {
    label: "FCP — First Contentful Paint",
    term: "First Contentful Paint (bon < 1,8 s, à améliorer < 3,0 s).",
    stack:
      "Premier pixel de contenu peint, fourni par l'API Paint Timing du navigateur, émis en span 'webvital.FCP'.",
    business:
      "Le moment où la page n'est plus blanche : le premier signe visible que « ça charge ». Rassure l'internaute pendant l'attente.",
  },
  TTFB: {
    label: "TTFB — Time To First Byte",
    term: "Time To First Byte (bon < 800 ms, à améliorer < 1,8 s).",
    stack:
      "Délai jusqu'au premier octet de la réponse serveur, lu dans l'entrée Navigation Timing (responseStart − requestStart).",
    business:
      "Le temps de réaction du serveur avant même l'affichage. S'il est élevé, le problème est côté infrastructure/backend, pas côté navigateur.",
  },

  // --- Agrégats & santé ------------------------------------------------------
  p75: {
    label: "p75 — 75ᵉ percentile",
    term: "75ᵉ percentile : valeur sous laquelle se situent 75 % des mesures (percentile_cont(0.75) en SQL).",
    stack:
      "Calculé en base Postgres sur la fenêtre choisie ; standard Google pour les Web Vitals (résiste aux valeurs extrêmes, contrairement à la moyenne).",
    business:
      "On regarde l'expérience des 75 % « normaux », pas la moyenne (faussée par quelques cas extrêmes). Dit autrement : « 3 utilisateurs sur 4 vivent au moins cette qualité-là ».",
  },
  health: {
    label: "Score de santé",
    term: "Score composite 0–100 : 40 % vitals (LCP ×2), 30 % erreurs, 20 % stabilité, 10 % anomalies 24 h.",
    stack:
      "Pondération calculée côté console à partir des p75, du taux d'erreur et de la détection d'anomalies (vue SQL v_anomaly).",
    business:
      "Une note unique pour piloter en un coup d'œil, comme un bulletin de santé du site. Idéal pour un comité de direction : vert = tout va bien, rouge = il faut agir.",
  },
  anomaly: {
    label: "Anomalie (z-score)",
    term: "Écart statistique |z| > 3 du p75 LCP horaire vs moyenne 7 jours glissants.",
    stack:
      "Détection en SQL (vue v_anomaly) par z-score = (valeur − moyenne) / écart-type, sans modèle externe.",
    business:
      "Une alerte automatique quand le site se dégrade nettement par rapport à son comportement habituel — sans avoir à fixer de seuil à la main. Repère les incidents avant les clients.",
  },

  // --- Tracing distribué -----------------------------------------------------
  tracing: {
    label: "Tracing front → back",
    term: "Corrélation d'un appel API navigateur (span 'http.client') à son exécution serveur (span 'http.server') par trace_id.",
    stack:
      "Propagation W3C 'traceparent' injectée par le SDK (fetch/XHR), relue par le middleware backend (FastAPI/OTel) qui émet le span serveur.",
    business:
      "On suit un clic depuis le navigateur jusqu'au serveur et retour. Permet de répondre à « c'est lent : ça vient du réseau, du serveur ou du code ? » sans deviner.",
  },
  traceparent: {
    label: "W3C traceparent",
    term: "En-tête HTTP standard '00-<trace_id 32 hex>-<span_id 16 hex>-01' (W3C Trace Context).",
    stack:
      "Norme inter-éditeurs : le même identifiant voyage du front au back, ce qui rend la corrélation indépendante de la stack serveur.",
    business:
      "Le « fil rouge » standardisé qui relie chaque étape d'une requête. Étant un standard ouvert, il fonctionne avec n'importe quel outil — pas de dépendance à un fournisseur.",
  },
  span: {
    label: "Span",
    term: "Unité de travail tracée (début, durée, statut, attributs) — brique de base d'OpenTelemetry.",
    stack:
      "Stocké en table rum_span avec son tier (front/back), corrélé par trace_id ; durée en ms, route templatisée.",
    business:
      "Un segment chronométré d'une requête (« l'appel a pris 320 ms, dont 210 ms serveur »). En empilant les spans, on décompose précisément où part le temps.",
  },
  coverage: {
    label: "Taux de corrélation",
    term: "Part des appels navigateur disposant d'un span backend apparié (correlated / total).",
    stack:
      "Jointure SQL des spans front et back sur trace_id ; dépend du déploiement du middleware sur les services serveur.",
    business:
      "À quel point on voit la chaîne complète. 100 % = chaque appel est tracé de bout en bout ; un taux bas signale des services serveur pas encore instrumentés.",
  },

  // --- Erreurs, sessions, replay --------------------------------------------
  errorFingerprint: {
    label: "Regroupement d'erreurs (fingerprint)",
    term: "Hash FNV-1a de (type + message normalisé + 1er frame de stack) pour dédupliquer les erreurs.",
    stack:
      "Calculé à l'ingestion : URLs, UUID et nombres sont remplacés par '#' afin que les variantes d'une même erreur partagent une empreinte.",
    business:
      "Au lieu de 5 000 erreurs en vrac, on voit « 12 problèmes distincts », triés par impact. On corrige les vraies causes, pas le bruit.",
  },
  session: {
    label: "Session utilisateur",
    term: "Suite de pages vues d'un même visiteur (session_id), avec device, pays (timezone) et durée.",
    stack:
      "Upsert en table rum_session ; aucune IP stockée — le pays est déduit de la timezone (RGPD-friendly).",
    business:
      "Le parcours réel d'un visiteur. Permet de rejouer ce qu'il a vécu et de comprendre un abandon, sans collecter de données personnelles identifiantes.",
  },
  replay: {
    label: "Session replay",
    term: "Reconstruction visuelle de la session via instantanés DOM (pas de capture vidéo).",
    stack:
      "Librairie rrweb : enregistre les mutations du DOM côté navigateur, rejouées dans la console (@rrweb/replay).",
    business:
      "Comme « regarder par-dessus l'épaule » de l'utilisateur pour voir exactement où il a buté — sans caméra ni espionnage, juste la structure de la page.",
  },
  alert: {
    label: "Alerte",
    term: "Règle seuil (métrique/route/fenêtre/comparateur) déclenchant un webhook quand elle est franchie.",
    stack:
      "Évaluée en base (check_alerts), livrée via pg_net (cloud) ou le dispatcher Node ; payload compatible Slack.",
    business:
      "Être prévenu automatiquement (Slack, Teams…) quand un indicateur dérape, sans surveiller l'écran. On passe du curatif au préventif.",
  },

  // --- Corrélation & socle ---------------------------------------------------
  robotVsReal: {
    label: "Robot vs Réel",
    term: "Comparaison du synthétique (sondes programmées) au RUM (utilisateurs réels) pour une même route.",
    stack:
      "Vue SQL v_correlation : écart p75 robot ↔ réel ; surligne les routes où le monitoring synthétique ment.",
    business:
      "Vos tests automatiques disent « tout va bien » mais les vrais utilisateurs souffrent ? Cet écart le révèle — la mesure terrain prime sur le labo.",
  },
  otlp: {
    label: "OTLP — OpenTelemetry Protocol",
    term: "Protocole standard d'export de télémétrie (ici OTLP/HTTP JSON) reçu par l'ingestion /v1/traces.",
    stack:
      "Le SDK et les middlewares émettent du OTLP standard ; l'ingestion — un service Node autonome, monté aussi en routes Next le temps de la bascule — l'aplatit vers Postgres.",
    business:
      "Tout repose sur un standard ouvert, pas un format maison. Conséquence directe : pas d'enfermement fournisseur, et compatibilité avec l'écosystème observabilité existant.",
  },
  healthGrid: {
    label: "Heatmap de santé (jour × heure)",
    term: "Grille calendaire : une ligne par jour, une colonne par heure ; couleur = part de mesures « good » du créneau (LCP pondéré ×2), vert ≥ 90 %, orange ≥ 50 %, rouge sinon.",
    stack:
      "Agrégat SQL par date_trunc('day') × extract(hour) sur 14 jours glissants, mêmes filtres app/appareil ; rendu serveur en CSS grid (zéro JS client).",
    business:
      "La performance « vue de loin » : on repère en un clin d'œil les créneaux récurrents qui dérapent (tous les matins 9 h, les soirs de pic…) plutôt que de fixer une seule valeur instantanée. Idéal pour montrer la tenue dans la durée à un client.",
  },
  rum: {
    label: "RUM — Real User Monitoring",
    term: "Mesure de la performance et des erreurs vécues par les utilisateurs réels, en production.",
    stack:
      "SDK navigateur (Web Vitals, erreurs, traces) → OTLP → Postgres → console Next.js. Souverain UE, OTel-native.",
    business:
      "On mesure le vrai ressenti des clients sur le site live, pas une simulation. C'est la donnée qui compte pour le chiffre d'affaires : un site rapide convertit mieux.",
  },
  experience: {
    label: "Score d'expérience",
    term: "Note /100 combinant la qualité perçue (Core Web Vitals), les signaux de frustration et la satisfaction déclarée (CSAT).",
    stack:
      "Calculé côté console : rating des vitals (p75) × pénalité frustration (rage/dead clicks) × CSAT issu des feedbacks (rum_event name='feedback'). Fonction pure, testée.",
    business:
      "Une seule note qui marie le mesuré (vitesse, bugs) et le ressenti (ce que l'utilisateur dit). Le chaînon qui manque à un RUM classique : le pont entre chiffres et satisfaction.",
  },
  csat: {
    label: "CSAT — satisfaction déclarée",
    term: "Part de retours positifs (note ≥ 4/5, ou 👍) sur l'ensemble des feedbacks collectés sur la période.",
    stack:
      "Feedbacks émis par le widget via MIPRum.track('feedback', {score, comment}), ingérés en rum_event (commentaire scrubbé PII), agrégés côté console.",
    business:
      "Ce que les utilisateurs pensent vraiment, en direct, relié à leur parcours et à la performance qu'ils ont subie. On voit si une lenteur se paie en insatisfaction.",
  },
  forecast: {
    label: "Prévisions (AIOps)",
    term: "Projection linéaire (moindres carrés) des indicateurs sur 14 jours ; ETA au franchissement de seuil (LCP 2,5 s, taux d'erreur 2 %).",
    stack:
      "lib/forecast (pur) sur les séries journalières (rum_metric/rum_pageview/rum_error). Régression transparente — aucune boîte noire ; complète les anomalies z-score (réactives) par de l'anticipation.",
    business:
      "On ne se contente plus de réagir : on voit ce qui dérive et QUAND ça franchira le seuil. Le passage du curatif au prédictif — arbitrer avant que l'utilisateur ne subisse.",
  },
  experienceMap: {
    label: "Carte d'expérience",
    term: "Graphe de service front→back : pages → API appelées → routes backend, arêtes pondérées par le volume, nœuds colorés par santé et annotés d'une tendance.",
    stack:
      "Construite depuis rum_span (spans front/back corrélés par trace_id) et rum_metric ; santé = latence p75 + taux d'erreur, tendance = moitié récente vs ancienne de la fenêtre. Rendu SVG maison, aucune dépendance graphe.",
    business:
      "La version « expérience » d'une weather map réseau : on voit d'un coup d'œil quelles briques du parcours sont sollicitées, lesquelles souffrent, et lesquelles montent en charge — cartographie, flux et anticipation réunis.",
  },

  // --- Supervision SVI -------------------------------------------------------
  containment: {
    label: "Containment (apparent)",
    term:
      "Part des appels clos que le serveur vocal a terminés sans transfert vers un conseiller. Dit « apparent » ici parce qu'il ignore les rappels.",
    stack:
      "Compté sur svi_call.outcome = 'contained', rapporté aux appels de statut 'closed' sur la période. Les appels encore ouverts sont exclus du dénominateur : ils n'ont pas d'issue.",
    business:
      "L'indicateur roi du secteur — et le plus facile à embellir. Un appel « contenu » dont l'appelant rappelle le lendemain n'était pas résolu, il était différé. À ne jamais lire sans le containment net.",
  },
  containment_net: {
    label: "Containment net",
    term:
      "Part des appels clos résolus par le serveur vocal SANS rappel du même appelant dans les 7 jours.",
    stack:
      "Même base que le containment apparent, moins les appels dont l'empreinte d'appelant (HMAC) réapparaît dans les 7 jours suivants. Les appels sans empreinte ne sont pas vérifiables et sont comptés comme non rappelés : le taux net est donc une BORNE SUPÉRIEURE. Un rappel qui enjambe une rotation de clé HMAC est invisible, même sens de biais.",
    business:
      "Le seul taux de résolution défendable devant un acheteur du domaine. L'écart avec le taux apparent mesure exactement ce que le serveur vocal reporte au lieu de résoudre.",
  },
  abandon_svi: {
    label: "Abandon",
    term: "Part des appels clos où l'appelant a raccroché avant d'obtenir une résolution ou un conseiller.",
    stack: "svi_call.outcome = 'abandoned', rapporté aux appels clos.",
    business:
      "Le signal le plus coûteux : l'appelant est parti sans réponse. Croisé avec le nœud de sortie, il désigne l'endroit précis du menu qui décourage.",
  },
  rappel_7j: {
    label: "Rappel sous 7 jours",
    term:
      "Nouvel appel du même appelant dans les 7 jours suivant un appel résolu, quel qu'en soit le motif.",
    stack:
      "Appariement sur (caller_hash, caller_key_id). L'empreinte est posée par l'adaptateur chez le client : MIP ne détient jamais la clé, donc ne peut pas ré-identifier l'appelant.",
    business:
      "Approximation volontairement large de la non-résolution : on ne sait pas si le rappel porte sur le même sujet. Elle penche donc du côté sévère, ce qui est le bon sens pour un indicateur de qualité.",
  },
  couverture_parcours: {
    label: "Couverture du parcours",
    term:
      "Part des appels pour lesquels le détail nœud par nœud est disponible (niveau de provenance « journey »).",
    stack:
      "svi_call.provenance contient 'journey'. Ce niveau exige que le flow du serveur vocal soit instrumenté chez le client, flow par flow — les CDR seuls ne le fournissent pas.",
    business:
      "Dit sur quelle fraction du trafic l'entonnoir de menu est réellement calculé. Un entonnoir portant sur 34 % des appels ne doit jamais être présenté comme s'il en couvrait la totalité.",
  },
  // --- Analyses prêtes à l'emploi (P6.3) -------------------------------------
  decoupage: {
    label: "Découpage par dimension",
    term:
      "Répartition d'une mesure selon une dimension (route, navigateur, système, pays estimé, appareil, release), avec le nombre d'échantillons de chaque groupe.",
    stack:
      "Regroupement SQL sur la colonne du registre de dimensions ; les lignes sans valeur forment un groupe « Inconnu » (is null), jamais une chaîne. Les groupes sont plafonnés, et leur nombre réel est affiché.",
    business:
      "Répond à « pour qui est-ce lent ? » plutôt qu'à « est-ce lent ? ». Un p75 global correct peut cacher une release ou un navigateur très dégradé ; le découpage le fait apparaître, et chaque groupe ouvre son détail.",
  },
  dureeObservee: {
    label: "Durée observée d'une session",
    term:
      "session_duration_observed = max(0, last_seen_at − started_at), sur les sessions COMMENCÉES dans la fenêtre.",
    stack:
      "Écart entre la première et la dernière observation reçue pour la session. Les sessions encore actives à la fin de la fenêtre sont comptées et signalées : leur durée n'est pas finie.",
    business:
      "Une estimation de présence, pas du temps actif : un onglet laissé ouvert l'allonge, une fermeture brutale la raccourcit. À lire comme un ordre de grandeur comparatif, jamais comme du « temps passé sur le site ».",
  },
  sessionUneVue: {
    label: "Sessions à une seule vue",
    term:
      "single_view_session_rate = sessions ayant vu exactement une page / sessions ayant vu au moins une page.",
    stack:
      "Compté sur `rum_session.page_count`, maintenu par l'ingestion à partir du nombre réel de pages vues de la session. Affiché seulement au-delà d'un seuil de sessions.",
    business:
      "Ce N'EST PAS un taux de rebond : aucune durée minimale ni interaction n'entre dans la définition, contrairement aux conventions — incompatibles entre elles — des outils du marché. On mesure exactement ce qu'on nomme.",
  },
  ressourcesSeuil: {
    label: "Ressources collectées selon seuil SDK",
    term:
      "Une ressource n'est envoyée que si elle dépasse le seuil de lenteur configuré (300 ms par défaut) ou bloque le rendu, et au plus vingt par page vue.",
    stack:
      "Filtrage dans le SDK (PerformanceObserver 'resource'). Le partage première/tierce partie compare l'hôte de l'URL déjà collectée aux origines DÉCLARÉES de l'application ; aucun appel sortant n'est émis par le serveur.",
    business:
      "Un échantillon volontairement biaisé vers le lent, pas un inventaire du réseau. Les totaux ne sont donc jamais extrapolés, et une application qui ne déclare pas ses origines n'obtient pas de partage première/tierce partie inventé.",
  },
  blocages: {
    label: "Blocages du fil principal",
    term:
      "Tâches longues (Long Tasks) et Long Animation Frames (LoAF) : les moments où le fil principal du navigateur ne peut pas répondre.",
    stack:
      "Deux API distinctes, gardées séparées : un même blocage observé par les deux serait compté deux fois. La série compte des blocages et donne leur p75 ; aucune somme de durées n'est présentée.",
    business:
      "Additionner les durées de blocage de plusieurs visiteurs ne donne le temps d'attente de personne. On montre donc combien de fois ça bloque, à quel point, et dans quelle session aller regarder.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;
