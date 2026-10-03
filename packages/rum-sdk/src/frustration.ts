// Clics rageurs (rafale sur la même cible) et clics morts (élément d'aspect
// actionnable, sans mutation DOM, navigation ni scroll dans le délai).
// Span 'frustration', stocké en rum_event sous 'frustration.<kind>' (shared/otlp.mjs).
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
 * Marqueur des interfaces de MIP RUM (widget d'avis) : leurs clics sont ignorés,
 * sinon l'instrument gonflerait le score de frustration de l'application.
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
 * Détecteur de clics rageurs : une fois par rafale de `min` clics dans `windowMs`
 * sur la même cible ; un changement de cible ou une pause le réarme.
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
 * Clic mort : aucune réaction depuis le clic (sous-reporte plutôt que d'inventer).
 * Comparaison STRICTE : l'écouteur en capture horodate avant le gestionnaire, donc
 * une réaction en moins d'une milliseconde porte le même horodatage que le clic.
 */
export function isDeadClick(
  clickT: number,
  signals: { mutation: number; nav: number; scroll: number },
): boolean {
  return signals.mutation < clickT && signals.nav < clickT && signals.scroll < clickT;
}

/** L'élément a-t-il l'air actionnable (seul cas surveillé en clic mort) ? */
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

/** Écoute les clics et les réactions DOM, navigation et scroll. */
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

      // La rafale prime : elle ne compte pas aussi en clic mort.
      const burst = rage.click(label, t);
      if (burst != null) {
        signal("rage", label, burst, actionAttrs);
        return;
      }

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
