// Signaux de frustration (P1) — rage clicks & dead clicks, à la FullStory/Dynatrace.
//   - rage click : ≥ RAGE_MIN_CLICKS clics sur la même cible dans une fenêtre courte
//     (l'utilisateur s'acharne : l'UI ne répond pas comme attendu) ;
//   - dead click  : clic sur un élément qui SEMBLE actionnable mais ne produit
//     AUCUNE réaction (mutation DOM, navigation, scroll) dans le délai imparti.
// Émis comme span 'frustration' (kind/target/count) ; stocké côté serveur dans
// rum_event sous le nom réservé 'frustration.<kind>' (cf. _shared/otlp.mjs).
import { formatClickLabel, MIP_UI_ATTR } from "./breadcrumbs";
import { makeCap, type PageCap } from "./caps";
import type { Emit } from "./errors";

export const FRUSTRATION_CAP_PER_PAGE = 20;
export const RAGE_MIN_CLICKS = 3;
export const RAGE_WINDOW_MS = 1000;
export const DEAD_CLICK_WINDOW_MS = 1500;
export const TARGET_MAX = 80;

const INTERACTIVE = "button,a,[role='button'],input,select,textarea,label,summary";

/**
 * Marqueur posé par les interfaces fournies par MIP RUM lui-même (aujourd'hui le
 * widget d'avis, mip-rum-feedback.js). Tout clic à l'intérieur d'un élément ainsi
 * marqué est ignoré par le détecteur.
 *
 * Sans cette exclusion, on mesure l'INSTRUMENT au lieu de mesurer l'application :
 * chaque ouverture du panneau d'avis alimenterait les clics morts/rageurs de
 * l'application cliente, et donc son score d'expérience.
 */
export { MIP_UI_ATTR } from "./breadcrumbs";

/** Le clic vise-t-il une interface de MIP RUM plutôt que l'application hôte ? */
export function isOwnUi(el: Element): boolean {
  try {
    return el.closest(`[${MIP_UI_ATTR}]`) != null;
  } catch {
    return false; // closest indisponible (très vieux navigateur) : on ne filtre pas
  }
}

export type FrustrationKind = "rage" | "dead" | "error";

/**
 * Détecteur de rage clicks (pur, testable). Émet UNE fois par rafale : dès que la
 * même cible atteint `min` clics dans la fenêtre glissante `windowMs`. Un changement
 * de cible ou une coupure supérieure à la fenêtre réarme le détecteur.
 */
export class RageDetector {
  private times: number[] = [];
  private key: string | null = null;
  private fired = false;

  constructor(
    private readonly min = RAGE_MIN_CLICKS,
    private readonly windowMs = RAGE_WINDOW_MS,
  ) {}

  /** Nombre de clics de la rafale au franchissement du seuil, sinon null. */
  click(key: string, t: number): number | null {
    const last = this.times[this.times.length - 1];
    if (key !== this.key || (last != null && t - last > this.windowMs)) {
      this.key = key;
      this.times = [];
      this.fired = false;
    }
    this.times = this.times.filter((x) => t - x < this.windowMs);
    this.times.push(t);
    if (!this.fired && this.times.length >= this.min) {
      this.fired = true;
      return this.times.length;
    }
    return null;
  }
}

/**
 * Décision dead-click (pure, testable) : mort si AUCUNE réaction n'est survenue
 * APRÈS le clic. Conservateur par construction (toute mutation/nav/scroll postérieur
 * disqualifie) → sous-reporte plutôt que de produire des faux positifs.
 *
 * La comparaison est STRICTE, et c'est le cœur du correctif du 11/08/2026.
 *
 * L'écouteur de clic est posé en phase de CAPTURE : il horodate `clickT` AVANT que
 * le gestionnaire de l'élément ne s'exécute. Une réaction causée par le clic porte
 * donc toujours un horodatage `>= clickT` — et l'égalité est le cas NORMAL dès que
 * le gestionnaire répond en moins d'une milliseconde, c'est-à-dire quand l'interface
 * est parfaitement réactive.
 *
 * Avec `<=`, ces réactions instantanées étaient comptées comme « aucune réaction » :
 * le détecteur sanctionnait la réponse la plus rapide possible. C'est ce qui a fait
 * remonter un `frustration.dead` sur le bouton du widget d'avis de MIP RUM lui-même
 * (gip-plateforme, 11/08/2026 12:01:33 UTC), alors que le panneau s'ouvrait bien.
 */
export function isDeadClick(
  clickT: number,
  signals: { mutation: number; nav: number; scroll: number },
): boolean {
  return signals.mutation < clickT && signals.nav < clickT && signals.scroll < clickT;
}

/** Un clic « mérite-t-il » une surveillance dead-click ? (élément d'aspect actionnable) */
export function isActionable(el: Element, interactive: boolean): boolean {
  if (interactive) return true;
  try {
    return getComputedStyle(el).cursor === "pointer";
  } catch {
    return false;
  }
}

export interface FrustrationWatch {
  reset(): void;
  error(
    actionAttrs: Record<string, string | number | boolean>,
    target: string,
    ts?: number,
  ): void;
}

/** Câble l'écoute des clics + le suivi des réactions DOM/nav/scroll. */
export function initFrustration(
  emit: Emit,
  opts: {
    enabled?: boolean;
    action?: () => Record<string, string | number | boolean>;
  } = {},
): FrustrationWatch {
  const cap = makeCap(FRUSTRATION_CAP_PER_PAGE);
  if (opts.enabled === false || typeof document === "undefined") {
    return { reset: () => cap.reset(), error: () => {} };
  }

  const rage = new RageDetector();
  const now = () => Date.now();
  let lastMutation = 0;
  let lastNav = 0;
  let lastScroll = 0;
  let forwardedControl: Element | null = null;
  let forwardedAt = 0;

  // Observateur partagé (léger) : marque la dernière réaction structurelle du DOM.
  try {
    const mo = new MutationObserver(() => {
      lastMutation = now();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch {
    lastMutation = Number.POSITIVE_INFINITY; // pas d'observateur : ne jamais conclure « mort »
  }

  const markNav = () => {
    lastNav = now();
  };
  addEventListener("popstate", markNav, { passive: true });
  addEventListener("hashchange", markNav, { passive: true });
  addEventListener("scroll", () => { lastScroll = now(); }, { capture: true, passive: true });

  const signal = (
    kind: FrustrationKind,
    target: string,
    count: number,
    actionAttrs: Record<string, string | number | boolean>,
  ) => {
    if (!cap.take()) return;
    emit("frustration", {
      ...actionAttrs,
      "frustration.kind": kind,
      "frustration.target": target.slice(0, TARGET_MAX),
      "frustration.count": count,
    });
  };

  document.addEventListener(
    "click",
    (e: Event) => {
      const me = e as MouseEvent;
      if (!(me.target instanceof Element)) return;
      // L'instrument ne se mesure pas lui-même (cf. MIP_UI_ATTR).
      if (isOwnUi(me.target)) return;
      const interactive = me.target.closest(INTERACTIVE);
      const el = interactive ?? me.target;
      const clickAt = now();
      if (forwardedControl === el && me.detail === 0 && clickAt - forwardedAt < 1_000) {
        forwardedControl = null;
        return;
      }
      if (el.tagName.toLowerCase() === "label") {
        forwardedControl = (el as HTMLLabelElement).control;
        forwardedAt = clickAt;
      }
      const label = formatClickLabel(el.tagName, el.textContent, el.getAttribute("aria-label"));
      const t = clickAt;
      const actionAttrs = opts.action?.() ?? {};

      // rage : prioritaire (un acharnement n'est pas un dead click)
      const burst = rage.click(label, t);
      if (burst != null) {
        signal("rage", label, burst, actionAttrs);
        return;
      }

      // dead : seulement sur un élément d'aspect actionnable, évalué après délai
      if (!isActionable(el, !!interactive)) return;
      setTimeout(() => {
        if (isDeadClick(t, { mutation: lastMutation, nav: lastNav, scroll: lastScroll }))
          signal("dead", label, 1, actionAttrs);
      }, DEAD_CLICK_WINDOW_MS);
    },
    { capture: true, passive: true },
  );

  return {
    reset: () => cap.reset(),
    error(actionAttrs, target, ts) {
      if (!cap.take()) return;
      emit("frustration", {
        ...actionAttrs,
        "frustration.kind": "error",
        "frustration.target": target.slice(0, TARGET_MAX),
        "frustration.count": 1,
      }, ts);
    },
  };
}
