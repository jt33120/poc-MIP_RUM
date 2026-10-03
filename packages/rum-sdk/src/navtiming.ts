// Phases réseau d'une navigation et qualité du lien : DNS lent, TLS coûteux et
// serveur lent donnent le même TTFB mais appellent des corrections différentes.
// Elles passent par le canal des vitals, sans note (aucun seuil Google n'existe).
import type { Emit } from "./errors";

/** Une phase, en millisecondes. Absente quand le navigateur ne la renseigne pas. */
export type Phases = Record<string, number>;

/**
 * Ventile une entrée de navigation en phases réseau. `secureConnectionStart` vaut 0
 * sans TLS ; TCP s'arrête au début de TLS, que `connectEnd` englobe ; une phase
 * à 0 (connexion réutilisée, DNS en cache) est une vraie mesure, gardée.
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

  // Ni NaN (borne manquante) ni négatif ; le plafond de 5 min écarte les onglets
  // restaurés, dont une borne vaut l'epoch.
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
 * Qualité du lien (`navigator.connection`, Chromium seulement : lu défensivement).
 * `effectiveType` est la qualité vécue, pas la techno : un wifi saturé dit « 3g ».
 */
export function qualiteReseau(c: ConnexionLike | undefined | null): Reseau {
  const nombre = (v: unknown, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

  const rtt = nombre(c?.rtt, 60_000);
  const downlink = nombre(c?.downlink, 10_000);
  const mesures: Phases = {};
  if (rtt != null) mesures.RTT = Math.round(rtt);
  // Deux décimales : l'entier écraserait les connexions lentes, celles qu'on cherche.
  if (downlink != null) mesures.DOWNLINK = Math.round(downlink * 100) / 100;

  return {
    type: typeof c?.effectiveType === "string" ? c.effectiveType.slice(0, 16) : null,
    mesures,
    economie: c?.saveData === true,
  };
}

/**
 * Émet les phases réseau après `load`, quand `responseEnd` est renseigné — ou
 * tout de suite si la page est déjà chargée (injection par l'extension).
 */
export function initNavTiming(emit: Emit): void {
  if (typeof performance?.getEntriesByType !== "function") return;

  const lire = (): void => {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav) return;

    const reseau = qualiteReseau(
      (navigator as Navigator & { connection?: ConnexionLike }).connection,
    );
    // Un `undefined` explicite traverserait l'encodeur OTLP comme une valeur.
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
