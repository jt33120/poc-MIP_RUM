// Seuils MIP — la règle de verdict (bon / à améliorer / mauvais) des mesures
// qui n'ont PAS de seuil publié.
//
// POURQUOI CE FICHIER. Jusqu'au 29/09/2026, seules les cinq Web Vitals portaient
// une couleur de verdict : leurs bornes sont publiées par web.dev et vivent dans
// `lib/rating.ts`. Tout le reste restait neutre par la règle R-S
// du plan de la refonte du frontend (hors dépôt) : aucun seuil publié n'existe
// pour une phase DNS, une durée d'appel API ou une part de clics rageurs.
// L'utilisateur a décidé le 29/09/2026 (vague 4 de la refonte du monitoring) de
// colorer AUSSI ces mesures, à une condition : la règle est écrite à l'écran à
// côté de la valeur (« règle MIP : DNS > 150 ms »), comme `REGLE_SANTE_API` /
// `texteRegleSanteApi` le font déjà pour la carte (`lib/map.ts`). Une couleur
// sans règle lisible affirmerait une norme qui n'existe pas.
//
// D'OÙ VIENNENT LES VALEURS. Du tableau « Les mesures du SDK MIP RUM », relu et
// validé par l'utilisateur le 29/09/2026 (document de relecture, hors dépôt).
// Ce tableau le dit lui-même : ce sont des ORDRES DE GRANDEUR DE TERRAIN, que le
// code ne définissait nulle part et qui n'ont pas été confrontés aux données
// réelles. Aucune n'a de source publiée comparable à web.dev ; le commentaire de
// chaque mesure dit le raisonnement qui la rend défendable, jamais une norme.
// Les parts de sessions (clics, erreurs) sont une traduction chiffrée, décidée le
// même jour, d'un tableau qui disait seulement « ≈ 0 » / « récurrent ».
//
// CE QUI N'EST PAS ICI :
//   - les cinq Web Vitals (LCP, INP, CLS, FCP, TTFB) : `THRESHOLDS` de
//     `lib/rating.ts`, source web.dev, recopiés à l'identique dans le SDK et à
//     l'ingestion (test de parité : `tests/unit/seuils-vitals-parite.test.ts`).
//     Les dupliquer ici créerait une quatrième copie ;
//   - les formulaires : voir `SANS_SEUIL_MIP` plus bas.
//
// INVARIANT. Une note MIP est de l'AFFICHAGE. Le score de santé, la heatmap et
// les rollups ne comptent que `CORE_VITALS` (`tests/unit/agregats-qualite.test.ts`) :
// `noteMip` n'entre jamais au numérateur d'un score.
//
// Aucun écran ne recopie une borne : il lit `SEUILS_MIP`, `noteMip` et
// `texteRegleMip` (garde : `tests/unit/perf-domaine-gardes.test.ts`).
import type { Rating } from "./rating";

/**
 * `haut-mauvais` : plus la valeur est haute, pire c'est (une durée).
 * `bas-mauvais` : l'inverse (un débit).
 */
export type SensSeuil = "haut-mauvais" | "bas-mauvais";

/**
 * La statistique à laquelle la règle s'applique.
 *
 *   - `p75` : comme web.dev pour les vitals, une mesure est « bonne » si 75 % des
 *     visites passent la borne — pour une mesure où HAUT est mauvais, c'est le 75ᵉ
 *     centile qui doit être sous la borne ;
 *   - `p25` : le MÊME critère pour une mesure où BAS est mauvais. « 75 % des visites
 *     au-dessus de 5 Mbit/s » se lit sur le 25ᵉ centile. Le p75 d'un débit dirait
 *     seulement qu'un quart des visites ont un bon lien : un site dont 70 % des
 *     visiteurs sont sous 1 Mbit/s serait « bon » ;
 *   - `part-sessions` : part (0..1) des sessions touchées au moins une fois.
 */
export type StatistiqueSeuil = "p75" | "p25" | "part-sessions";

/** `part` : une part 0..1, écrite en pourcentage (comme `formater("pct")`). */
export type UniteSeuil = "ms" | "Mbit/s" | "part";

export interface SeuilMip {
  /** Borne « bon », INCLUSIVE : ≤ bon (ou ≥ bon en sens `bas-mauvais`) est « bon ». */
  bon: number;
  /** Borne « mauvais », STRICTE : > mauvais (ou < mauvais en sens `bas-mauvais`) est « mauvais ». */
  mauvais: number;
  unite: UniteSeuil;
  sens: SensSeuil;
  statistique: StatistiqueSeuil;
  /** Ce que l'écran écrit devant la règle : « règle MIP : <libelle> > 150 ms ». */
  libelle: string;
}

/**
 * Les seuils MIP, par mesure. Les clés des phases réseau et de la qualité du lien
 * sont les noms de `rum_metric.name` émis par le SDK (`packages/rum-sdk/src/navtiming.ts`) :
 * `noteMip(ligne.name, ligne.p75)` s'applique tel quel à une ligne de `rum_metric`.
 */
export const SEUILS_MIP = {
  // ───────────────────────── Phases réseau de la navigation ─────────────────────────
  // Les six phases qui précèdent et composent le TTFB. Libellés = ceux de
  // `PHASES_TTFB` (`lib/perf-domain.ts`), un test les compare.

  // 0 : une redirection est un aller-retour évitable, payé avant même la requête du
  // document ; la seule bonne valeur est l'absence de redirection. 300 : au-delà, la
  // redirection seule consomme plus du tiers du budget d'un TTFB bon (800 ms,
  // `THRESHOLDS.TTFB` de `lib/rating.ts`), avant tout le reste.
  REDIRECT: { bon: 0, mauvais: 300, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Redirection" },

  // 0 si le nom est en cache ; une résolution par un résolveur proche tient en
  // quelques dizaines de millisecondes (tableau de relecture : 0 – 50). Au-delà de
  // 150 ms : résolveur lent ou éloigné, ou nom jamais en cache — et ce temps est
  // payé avant d'ouvrir la moindre connexion.
  DNS: { bon: 50, mauvais: 150, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "DNS" },

  // Ouvrir une connexion TCP coûte un aller-retour (0 si elle est réutilisée).
  // Tableau de relecture : 10 – 100 bon, > 300 mauvais. Au-delà de 300 ms, c'est un
  // lien lent ou un serveur loin du visiteur (pas de point de présence proche).
  TCP: { bon: 100, mauvais: 300, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Connexion TCP" },

  // Poignée de main : un aller-retour en TLS 1.3, deux en TLS 1.2, plus le calcul
  // cryptographique. 150 ms laisse un aller-retour correct et le calcul ; au-delà
  // de 300 ms, la poignée de main pèse autant que toute une phase serveur.
  TLS: { bon: 150, mauvais: 300, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "TLS" },

  // L'attente entre l'envoi de la requête et le premier octet : surtout le SERVEUR
  // (c'est la phase qui désigne un back-end lent ; ce n'est pas le TTFB, qui ajoute
  // redirection, DNS, TCP et TLS). 200 laisse les trois quarts du budget d'un TTFB
  // bon (800 ms) aux phases réseau ; au-delà de 600, la requête seule en consomme
  // les trois quarts et une connexion neuve ne peut plus tenir le TTFB « bon ».
  REQUEST: { bon: 200, mauvais: 600, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Requête" },

  // Le téléchargement du document HTML seul (pas de ses ressources). Au-delà de
  // 300 ms : document lourd, ou débit faible — à croiser avec DOWNLINK.
  RESPONSE: { bon: 100, mauvais: 300, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Réponse" },

  // ─────────────────────────────── Qualité du lien ───────────────────────────────
  // Estimations du NAVIGATEUR (`navigator.connection`, Chromium seulement), pas des
  // mesures du site : elles expliquent une mesure lente, elles ne la produisent pas.

  // 150 : ordre de grandeur d'un bon lien 4G (tableau de relecture : 50 – 150).
  // 400 : une connexion neuve paie au moins deux allers-retours avant d'envoyer la
  // requête (TCP, puis TLS 1.3) ; à 400 ms chacun, c'est déjà 800 ms, tout le budget
  // d'un TTFB bon, avant que le serveur ait reçu quoi que ce soit.
  RTT: { bon: 150, mauvais: 400, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Aller-retour réseau (RTT)" },

  // SENS INVERSE : un débit bas est mauvais, d'où `bas-mauvais` et le 25ᵉ centile
  // (voir `StatistiqueSeuil`). 1 Mbit/s = 125 ko/s : une page de 1 Mo (valeur
  // d'illustration) met 8 s à descendre, et aucun LCP ne peut plus être bon
  // (2,5 s) quoi que fasse le site. 5 Mbit/s : le même Mo en 1,6 s.
  DOWNLINK: { bon: 5, mauvais: 1, unite: "Mbit/s", sens: "bas-mauvais", statistique: "p25", libelle: "Débit descendant" },

  // ──────────────────────────────── Fil principal ────────────────────────────────

  // Durée d'une tâche longue, au p75 des tâches collectées. Une tâche n'est
  // « longue » qu'au-delà de 50 ms (seuil natif de l'API Long Tasks,
  // `packages/rum-sdk/src/longtasks.ts`) : toute tâche collectée l'est déjà.
  // 100 = deux fois ce seuil. 250 : une seule tâche de cette durée qui croise une
  // interaction suffit à sortir l'INP de « bon » (200 ms, `THRESHOLDS.INP`).
  // Le NOMBRE de tâches (« nombreuses », dit le tableau de relecture) n'a pas de
  // règle chiffrée : il n'est pas noté.
  LONGTASK: { bon: 100, mauvais: 250, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Tâche longue" },

  // Durée d'une frame d'animation longue (LoAF). MÊMES bornes que les tâches
  // longues, exprès : le SDK prend LoAF À LA PLACE des long tasks quand le
  // navigateur le permet (`packages/rum-sdk/src/loaf.ts`, colonne `source`). Deux
  // échelles pour le même blocage feraient changer la couleur selon le navigateur
  // du visiteur, pas selon le site.
  LOAF: { bon: 100, mauvais: 250, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Frame d'animation longue (LoAF)" },

  // ──────────────────────────────── Ressources et API ────────────────────────────

  // Durée d'une ressource. 300 = le seuil d'émission du SDK
  // (`DEFAULT_SLOW_RESOURCE_MS`, `packages/rum-sdk/src/resources.ts`) : sous 300 ms,
  // une ressource n'est même pas envoyée, sauf si elle bloque le rendu. ATTENTION :
  // le p75 porte donc sur des ressources DÉJÀ lentes ou bloquantes (échantillon
  // biaisé, `RESOURCE_THRESHOLD_NOTICE` de `lib/resources.ts`) et sera le plus
  // souvent au-dessus de 300. 1 000 : une ressource d'une seconde sur le chemin de
  // l'élément principal consomme 40 % du budget d'un LCP bon (2,5 s).
  RESOURCE: { bon: 300, mauvais: 1000, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Ressource" },

  // `http.duration_ms` : durée d'un fetch/XHR vue du NAVIGATEUR (réseau + serveur).
  // Tableau de relecture : < 300 bon, > 1 000 mauvais. Repère, pas source : 1 s est
  // la limite couramment admise au-delà de laquelle l'utilisateur perd le fil de
  // son action (J. Nielsen, « Response Times: The 3 Important Limits »).
  // À NE PAS CONFONDRE avec `REGLE_SANTE_API` (`lib/map.ts` : 1 s / 3 s), la santé
  // d'un NŒUD de la carte, combinée au taux d'erreur. L'écart entre les deux
  // règles est connu (29/09/2026) et se tranche avec les écrans (lot 4b).
  API: { bon: 300, mauvais: 1000, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Appel API" },

  // ─────────────────────────── Navigation dans l'application ─────────────────────
  // `SPA_LOAD` (SDK web ≥ 0.6, 04/10/2026) : d'un pushState / popstate au calme de la
  // page (100 ms sans mutation du DOM ni requête en cours), méthode « loading time »
  // de Datadog. 1 000 : la limite au-delà de laquelle l'utilisateur perd le fil de
  // son action (même repère que `API`, J. Nielsen). 2 500 : la borne « bon » du LCP
  // (`THRESHOLDS.LCP`) — un changement d'écran aussi lent qu'un chargement complet
  // a perdu ce qu'une application monopage devait apporter.
  SPA_LOAD: { bon: 1000, mauvais: 2500, unite: "ms", sens: "haut-mauvais", statistique: "p75", libelle: "Changement d'écran (SPA)" },

  // ──────────────────────────── Comportement et erreurs ──────────────────────────
  // Des PARTS de sessions touchées, jamais des nombres : un compte grandit avec le
  // trafic et ne se compare pas d'une période à l'autre. Le tableau de relecture
  // dit « ≈ 0 » (bon) et « récurrent » (mauvais), sans chiffre ; les parts
  // ci-dessous sont la traduction décidée le 29/09/2026 (plan de la vague 4), pas
  // une norme publiée — il n'en existe pas (R-S).

  // Clic rageur (SDK) : au moins 3 clics sur la même cible en 1 s
  // (`RAGE_MIN_CLICKS`, `RAGE_WINDOW_MS`, `packages/rum-sdk/src/frustration.ts`).
  // 1 % = une session sur cent ; 5 % = une sur vingt.
  RAGE_CLICKS: { bon: 0.01, mauvais: 0.05, unite: "part", sens: "haut-mauvais", statistique: "part-sessions", libelle: "Clics rageurs" },

  // Clic mort (SDK) : clic sur un élément qui semble actionnable, sans réaction
  // (DOM, navigation, défilement) sous 1,5 s (`DEAD_CLICK_WINDOW_MS`). Plus tolérant
  // que les clics rageurs : le détecteur a plus de faux positifs — une réaction
  // qui ne touche pas la page (un téléchargement, un appel sans rendu) passe pour
  // « aucune réaction ».
  DEAD_CLICKS: { bon: 0.02, mauvais: 0.08, unite: "part", sens: "haut-mauvais", statistique: "part-sessions", libelle: "Clics morts" },

  // Part des sessions avec au moins une erreur NAVIGATEUR (JS, réseau, CSP). Le
  // tableau de relecture dit « proche de 0 % », et « mauvais » surtout en hausse
  // après une mise en ligne. À NE PAS CONFONDRE avec la métrique d'alerte
  // `error_rate` (`check_alerts`, migration-v86 : occurrences / pages vues, toutes
  // sources), qui n'est pas une part de sessions (lot 4c).
  BROWSER_ERRORS: { bon: 0.01, mauvais: 0.05, unite: "part", sens: "haut-mauvais", statistique: "part-sessions", libelle: "Erreurs navigateur" },
} as const satisfies Record<string, SeuilMip>;

export type MesureMip = keyof typeof SEUILS_MIP;

/**
 * Les mesures SANS seuil, et pourquoi — écrit ici pour qu'aucun écran ne leur en
 * invente un, et que la question ne revienne pas.
 */
export const SANS_SEUIL_MIP = {
  // Temps de remplissage, abandons, champs corrigés : le tableau de relecture le
  // dit, aucune norme n'existe — un formulaire de connexion et une déclaration de
  // sinistre n'ont rien de comparable. On suit la tendance et les ruptures.
  FORMULAIRES:
    "pas de seuil : la durée d'un formulaire dépend de ce qu'il demande ; suivre la tendance et les ruptures",
} as const;

/** Le seuil MIP d'une mesure, ou `null` si elle n'en a pas (vital, formulaire, nom inconnu). */
export function seuilMip(mesure: string): SeuilMip | null {
  // `hasOwnProperty` et non `mesure in` : « constructor » ou « toString » ne sont
  // pas des mesures.
  return Object.prototype.hasOwnProperty.call(SEUILS_MIP, mesure)
    ? SEUILS_MIP[mesure as MesureMip]
    : null;
}

/**
 * Note MIP d'une valeur : même vocabulaire que `rating2026` (`lib/rating.ts`), pour
 * que les écrans réutilisent `RATING_CLASS` / `RATING_BAR` / `RATING_LABEL`.
 * « Bon » inclusif, « mauvais » strict, comme web.dev pour les vitals. `null` : pas
 * de seuil MIP pour cette mesure, ou pas de valeur — jamais « bon » par défaut.
 */
export function noteMip(mesure: string, valeur: number | null | undefined): Rating | null {
  const s = seuilMip(mesure);
  if (!s || valeur == null || !Number.isFinite(valeur)) return null;
  if (s.sens === "bas-mauvais") {
    return valeur >= s.bon ? "good" : valeur >= s.mauvais ? "needs-improvement" : "poor";
  }
  return valeur <= s.bon ? "good" : valeur <= s.mauvais ? "needs-improvement" : "poor";
}

// Espace insécable entre un nombre et son unité, construite par son code (comme
// dans `lib/format.ts` et `lib/fmt-ids.ts`) : écrite telle quelle, elle est
// invisible à la relecture.
const NBSP = String.fromCharCode(0xa0);

/** Une borne dans son unité : « 150 ms », « 1 s », « 5 Mbit/s », « 1 % ». */
export function formaterBorneMip(unite: UniteSeuil, valeur: number): string {
  const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (unite === "part") return `${n(valeur * 100)}${NBSP}%`;
  if (unite === "Mbit/s") return `${n(valeur)}${NBSP}Mbit/s`;
  return valeur >= 1000 ? `${n(valeur / 1000)}${NBSP}s` : `${n(valeur)}${NBSP}ms`;
}

/** « des sessions » après une part : « 5 % » seul ne dit pas de quoi. */
function suffixe(s: SeuilMip): string {
  return s.statistique === "part-sessions" ? " des sessions" : "";
}

/**
 * La règle écrite à côté d'une valeur colorée : « règle MIP : DNS > 150 ms ».
 * C'est la borne « mauvais » (ce qui fait passer au rouge). Chaîne vide pour une
 * mesure sans seuil MIP.
 */
export function texteRegleMip(mesure: string): string {
  const s = seuilMip(mesure);
  if (!s) return "";
  const comparateur = s.sens === "bas-mauvais" ? "<" : ">";
  return `règle MIP : ${s.libelle} ${comparateur} ${formaterBorneMip(s.unite, s.mauvais)}${suffixe(s)}`;
}

/**
 * Les deux bornes, pour une légende : « bon ≤ 50 ms, mauvais au-delà de 150 ms » —
 * le pendant de `texteSeuils` (`lib/rating.ts`) pour les vitals.
 */
export function texteSeuilsMip(mesure: string): string {
  const s = seuilMip(mesure);
  if (!s) return "";
  const b = (v: number) => formaterBorneMip(s.unite, v);
  if (s.sens === "bas-mauvais") {
    return `bon ≥ ${b(s.bon)}, mauvais en dessous de ${b(s.mauvais)}`;
  }
  // REDIRECT : « bon ≤ 0 ms » se lit mal ; la seule bonne valeur est zéro.
  const bon = s.bon === 0 ? `bon = ${b(0)}` : `bon ≤ ${b(s.bon)}`;
  return `${bon}${suffixe(s)}, mauvais au-delà de ${b(s.mauvais)}`;
}
