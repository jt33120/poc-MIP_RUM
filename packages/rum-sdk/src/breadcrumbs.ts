// Breadcrumbs (LIMITES §1) : trail du parcours utilisateur — clics, navigations,
// erreurs, événements custom. Span 'breadcrumb' avec type/label/seq, cap 50/page.
import { makeCap, type PageCap } from "./caps";
import type { Emit } from "./errors";

export const BREADCRUMB_CAP_PER_PAGE = 50;
export const BREADCRUMB_LABEL_MAX = 40;
export const MIP_UI_ATTR = "data-mip-rum-ui";
const SEQ_KEY = "mip_rum_seq";

export type BreadcrumbType = "click" | "nav" | "error" | "custom";

export interface BreadcrumbTrail {
  add(type: BreadcrumbType, label: string, attrs?: Record<string, string | number | boolean>): void;
  cap: PageCap;
}

/** Label de clic : tag + texte tronqué 40c (aria-label en secours pour les boutons-icônes). */
export function formatClickLabel(
  tag: string,
  text: string | null,
  ariaLabel: string | null,
): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim() || (ariaLabel ?? "").trim();
  const t = raw.slice(0, BREADCRUMB_LABEL_MAX);
  return t ? `${tag.toLowerCase()} "${t}"` : tag.toLowerCase();
}

/**
 * Compteur incrémental de session, persisté en localStorage (monotone : ne
 * redémarre pas à zéro au reload, l'ordre intra-session reste garanti).
 */
export function createSeq(key: string = SEQ_KEY): () => number {
  let seq = 0;
  try {
    seq = parseInt(localStorage.getItem(key) || "0", 10) || 0;
  } catch {
    /* mode privé : compteur en mémoire seulement */
  }
  return () => {
    seq += 1;
    try {
      localStorage.setItem(key, String(seq));
    } catch {
      /* ignore */
    }
    return seq;
  };
}

export function createBreadcrumbTrail(emit: Emit): BreadcrumbTrail {
  const cap = makeCap(BREADCRUMB_CAP_PER_PAGE);
  const nextSeq = createSeq();
  return {
    cap,
    add(type: BreadcrumbType, label: string, attrs = {}): void {
      if (!cap.take()) return;
      emit("breadcrumb", {
        ...attrs,
        "breadcrumb.type": type,
        "breadcrumb.label": String(label).slice(0, 120),
        "breadcrumb.seq": nextSeq(),
      });
    },
  };
}

/** Écoute les clics (capture) sur l'élément interactif le plus proche. */
export function initClickBreadcrumbs(
  trail: BreadcrumbTrail,
  action: () => Record<string, string | number | boolean> = () => ({}),
): void {
  let forwardedControl: Element | null = null;
  let forwardedAt = 0;
  document.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element)) return;
      const el =
        e.target.closest("button,a,[role='button'],input,select,textarea,label") ?? e.target;
      if (el.closest(`[${MIP_UI_ATTR}]`)) return;
      const now = Date.now();
      if (forwardedControl === el && e.detail === 0 && now - forwardedAt < 1_000) {
        forwardedControl = null;
        return;
      }
      if (el.tagName.toLowerCase() === "label") {
        forwardedControl = (el as HTMLLabelElement).control;
        forwardedAt = now;
      }
      trail.add(
        "click",
        formatClickLabel(el.tagName, el.textContent, el.getAttribute("aria-label")),
        action(),
      );
    },
    { capture: true, passive: true },
  );
}
