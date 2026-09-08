// Décomposition RÉSEAU d'une navigation, et qualité du lien — les deux signaux
// que le tableau de bord ne savait pas expliquer.
//
// POURQUOI ÇA MANQUAIT. On mesurait le TTFB, donc le SYMPTÔME (« la première
// donnée arrive en 900 ms ») sans jamais la CAUSE : une résolution DNS lente, une
// poignée de main TLS coûteuse et un serveur lent produisent le même TTFB et
// appellent trois corrections opposées. `PerformanceNavigationTiming` porte déjà
// la ventilation, elle n'était simplement pas lue.
//
// AUCUN CHANGEMENT DE BACKEND N'EST NÉCESSAIRE. `rum_metric.name` est du texte
// libre et `rating2026()` rend `null` pour un nom qu'il ne connaît pas — ces
// phases voyagent donc sur le canal des vitals, sans note de qualité, ce qui est
// exactement correct : il n'existe pas de seuil Google pour une phase DNS.
import type { Emit } from "./errors";

/** Une phase, en millisecondes. Absente quand le navigateur ne la renseigne pas. */
export type Phases = Record<string, number>;

/**
 * Ventile une entrée de navigation en phases réseau.
 *
 * Trois pièges respectés :
 *
 *  - `secureConnectionStart` vaut 0 quand il n'y a pas de TLS, PAS une date. Le
 *    soustraire aveuglément donnerait une poignée de main de la taille de l'epoch.
 *  - une phase à 0 est une VRAIE mesure, pas une absence : connexion réutilisée,
 *    DNS en cache. On la garde — c'est même l'information la plus utile sur un
 *    site bien configuré.
 *  - `connectEnd - connectStart` englobe TLS. On borne donc la phase TCP au début
 *    de la poignée de main, sinon TCP et TLS comptent deux fois le même temps et
 *    la somme des phases dépasse le TTFB.
 */
export function phasesReseau(nav: PerformanceNavigationTiming): Phases {
  const tls = nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0;
  const finConnexionSeule = nav.secureConnectionStart > 0 ? nav.secureConnectionStart : nav.connectEnd;

  const brut: Phases = {
    REDIRECT: nav.redirectEnd - nav.redirectStart,
    DNS: nav.domainLookupEnd - nav.domainLookupStart,
    TCP: finConnexionSeule - nav.connectStart,
    TLS: tls,
    REQUEST: nav.responseStart - nav.requestStart,
    RESPONSE: nav.responseEnd - nav.responseStart,
  };

  // Une borne manquante donne NaN, une horloge incohérente donne un négatif :
  // ni l'un ni l'autre ne doit atteindre la base. Un plafond de 5 min écarte les
  // valeurs absurdes vues sur les onglets restaurés (borne à l'epoch).
  const out: Phases = {};
  for (const [k, v] of Object.entries(brut)) {
    if (Number.isFinite(v) && v >= 0 && v <= 300_000) out[k] = Math.round(v);
  }
  return out;
}

/** Ce que `navigator.connection` expose — jamais l'opérateur, qu'aucun navigateur ne donne. */
export interface Reseau {
  /** '4g' | '3g' | '2g' | 'slow-2g' — estimation du navigateur, pas la techno réelle. */
  type: string | null;
  /** Aller-retour estimé (ms) et débit descendant estimé (Mbit/s). */
  mesures: Phases;
  /** L'utilisateur a demandé l'économie de données. */
  economie: boolean;
}

interface ConnexionLike {
  effectiveType?: unknown;
  rtt?: unknown;
  downlink?: unknown;
  saveData?: unknown;
}

/**
 * Qualité du lien. API non standardisée (Chromium seulement, absente de Safari et
 * Firefox) : tout est optionnel et lu défensivement.
 *
 * `effectiveType` est une ESTIMATION du navigateur à partir des temps observés,
 * pas la technologie réelle du terminal — un wifi saturé s'y annonce « 3g ». On
 * le garde quand même : c'est la qualité VÉCUE, qui est justement ce qu'un RUM
 * mesure, et c'est le seul angle réseau que le navigateur consente à donner.
 */
export function qualiteReseau(c: ConnexionLike | undefined | null): Reseau {
  const nombre = (v: unknown, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

  const rtt = nombre(c?.rtt, 60_000);
  const downlink = nombre(c?.downlink, 10_000);
  const mesures: Phases = {};
  if (rtt != null) mesures.RTT = Math.round(rtt);
  // Mbit/s avec deux décimales : arrondir à l'entier écraserait toutes les
  // connexions lentes, qui sont précisément celles qu'on cherche.
  if (downlink != null) mesures.DOWNLINK = Math.round(downlink * 100) / 100;

  return {
    type: typeof c?.effectiveType === "string" ? c.effectiveType.slice(0, 16) : null,
    mesures,
    economie: c?.saveData === true,
  };
}

/**
 * Émet les phases réseau une fois la réponse du document terminée.
 *
 * L'entrée de navigation existe dès le début du document, mais ses bornes tardives
 * (`responseEnd`) ne sont renseignées qu'ensuite. On lit donc APRÈS l'événement
 * `load` — ou tout de suite s'il est déjà passé, ce qui est le cas quand le SDK
 * est injecté par l'extension navigateur sur une page déjà chargée.
 */
export function initNavTiming(emit: Emit): void {
  if (typeof performance?.getEntriesByType !== "function") return;

  const lire = (): void => {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav) return;

    const reseau = qualiteReseau(
      (navigator as Navigator & { connection?: ConnexionLike }).connection,
    );
    // Attributs posés seulement s'ils existent : un `undefined` explicite
    // traverserait l'encodeur OTLP et arriverait en base comme une valeur.
    const commun: Record<string, string | boolean> = {};
    if (reseau.type) commun["mip.net_type"] = reseau.type;
    if (reseau.economie) commun["mip.net_save_data"] = true;

    for (const [name, value] of Object.entries({ ...phasesReseau(nav), ...reseau.mesures })) {
      emit(`webvital.${name}`, {
        "webvital.name": name,
        "webvital.value": value,
        ...commun,
      });
    }
  };

  if (document.readyState === "complete") lire();
  else addEventListener("load", () => lire(), { once: true });
}
