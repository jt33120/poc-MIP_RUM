// Ce que la vue a coûté et retenu : temps passé visible, défilement le plus profond,
// ressources chargées et octets transférés. Passent par le canal des vitals : un même
// `webvital.id` par vue et des valeurs CUMULÉES, car l'ingestion garde la plus grande
// des valeurs reçues sous cet identifiant.
import type { Emit } from "./errors";
import { newEnvelopeId } from "./event-context";

/** Intervalle des relevés de défilement : un événement `scroll` par image serait du gâchis. */
export const SCROLL_THROTTLE_MS = 100;

type Cible = Element | Document;

export interface Engagement {
  /** Clôt la vue courante (dernier cumul) et ouvre la suivante ; `debut` en temps `performance`. */
  nouvelleVue(route: string, debut: number): void;
  /** Identifiant de la vue courante, partagé avec SPA_LOAD. */
  vueId(): string;
  /** Une ressource chargée (resources.ts), exports MIP déjà exclus. */
  ressource(entry: PerformanceResourceTiming): void;
  /** Émet le cumul de la vue courante : passage en `hidden`, `pagehide`. */
  emettre(): void;
}

/** Défilement d'une cible en % entier : (haut visible + hauteur visible) / hauteur totale. */
export function profondeur(haut: number, visible: number, total: number): number {
  if (!(total > 0) || !(visible >= 0)) return 100;
  return Math.max(0, Math.min(100, Math.round(((Math.max(0, haut) + visible) / total) * 100)));
}

function mesures(cible: Cible): { haut: number; visible: number; total: number } | null {
  if (typeof document === "undefined") return null;
  if (cible === document) {
    const racine = document.scrollingElement ?? document.documentElement;
    if (!racine) return null;
    const haut = typeof scrollY === "number" ? scrollY : racine.scrollTop;
    return { haut, visible: innerHeight, total: racine.scrollHeight };
  }
  const el = cible as Element;
  return { haut: el.scrollTop, visible: el.clientHeight, total: el.scrollHeight };
}

export function initEngagement(
  emit: Emit,
  maintenant: () => number = () => performance.now(),
): Engagement {
  // Fausse jusqu'à la première page vue : rien à clore avant elle.
  let ouverte = false;
  let id = newEnvelopeId();
  let route = "/";
  let debut = 0;
  let cumul = 0;
  // Instant du dernier passage en visible ; null tant que la vue est cachée.
  let visibleDepuis: number | null = null;
  let nombre = 0;
  let octets = 0;
  // Le plus grand conteneur qui défile : la fenêtre, ou un `<main>` en overflow
  // dans les apps dont le document lui-même ne défile pas.
  let conteneur: Cible | null = null;
  let hauteurConteneur = 0;
  let profondeurMax = 0;
  // Dernière valeur partie par mesure : rien ne repart si rien n'a bougé.
  let envoyes: Record<string, number> = {};

  const estVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

  const releverDefilement = (cible: Cible) => {
    const m = mesures(cible);
    if (!m || m.total <= m.visible + 1) return;
    // Un panneau latéral qui défile ne dit rien de la lecture de la page.
    if (cible !== document && m.visible < innerHeight / 2) return;
    if (cible !== conteneur) {
      if (m.visible <= hauteurConteneur) return;
      conteneur = cible;
      hauteurConteneur = m.visible;
      profondeurMax = 0;
    }
    profondeurMax = Math.max(profondeurMax, profondeur(m.haut, m.visible, m.total));
  };

  const defilementFinal = (): number | null => {
    if (typeof document === "undefined" || typeof innerHeight !== "number") return null;
    if (conteneur) releverDefilement(conteneur);
    else {
      // Aucun défilement vu : la position de départ de la page, ou de son `<main>`.
      releverDefilement(document);
      const main = typeof document.querySelector === "function" ? document.querySelector("main") : null;
      if (!conteneur && main) releverDefilement(main);
    }
    return conteneur ? profondeurMax : 100;
  };

  const envoyer = (nom: string, valeur: number) => {
    if (envoyes[nom] === valeur) return;
    envoyes[nom] = valeur;
    emit(`webvital.${nom}`, {
      "webvital.name": nom,
      "webvital.value": valeur,
      "webvital.id": id,
      // La route de la vue, pas celle qui l'a remplacée.
      "mip.route": route,
    });
  };

  const emettre = () => {
    if (!ouverte) return;
    if (visibleDepuis != null) {
      const t = maintenant();
      cumul += Math.max(0, t - visibleDepuis);
      visibleDepuis = estVisible() ? t : null;
    }
    const temps = Math.round(cumul);
    if (temps > 0) {
      envoyer("TIME_SPENT", temps);
      const scroll = defilementFinal();
      if (scroll != null) envoyer("SCROLL_DEPTH", scroll);
    }
    envoyer("RESOURCE_COUNT", nombre);
    envoyer("RESOURCE_BYTES", octets);
  };

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") emettre();
      else if (visibleDepuis == null) visibleDepuis = maintenant();
    });
    let planifie = false;
    let derniere: Cible | null = null;
    document.addEventListener(
      "scroll",
      (event: Event) => {
        derniere = (event.target as Cible | null) ?? document;
        if (planifie) return;
        planifie = true;
        setTimeout(() => {
          planifie = false;
          if (derniere) releverDefilement(derniere);
        }, SCROLL_THROTTLE_MS);
      },
      { capture: true, passive: true },
    );
  }
  if (typeof addEventListener === "function") addEventListener("pagehide", emettre, { capture: true });

  return {
    nouvelleVue(prochaineRoute, prochainDebut) {
      emettre();
      ouverte = true;
      id = newEnvelopeId();
      route = prochaineRoute;
      debut = prochainDebut;
      cumul = 0;
      visibleDepuis = estVisible() ? prochainDebut : null;
      nombre = 0;
      octets = 0;
      conteneur = null;
      hauteurConteneur = 0;
      profondeurMax = 0;
      envoyes = {};
    },
    vueId: () => id,
    ressource(entry) {
      // Une ressource partie avant la vue appartient à la précédente, déjà close.
      if (entry.startTime < debut) return;
      nombre++;
      octets += entry.transferSize > 0 ? entry.transferSize : 0;
    },
    emettre,
  };
}
