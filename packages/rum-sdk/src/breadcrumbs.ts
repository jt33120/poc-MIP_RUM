// Fil d'Ariane du parcours : clics, navigations, erreurs, événements custom.
import { makeCap, type PageCap } from "./caps";
import { accesTerminalAutorise, CLE_SEQUENCE } from "./consent";
import type { Emit } from "./errors";

export const BREADCRUMB_CAP_PER_PAGE = 50;
export const BREADCRUMB_LABEL_MAX = 40;
/** Longueur d'un libellé sur le fil ; l'ingestion applique la même borne après son scrub. */
export const BREADCRUMB_WIRE_MAX = 120;
export const MIP_UI_ATTR = "data-mip-rum-ui";
const SEQ_KEY = CLE_SEQUENCE;

export type BreadcrumbType = "click" | "nav" | "error" | "custom";

export interface BreadcrumbTrail {
  add(type: BreadcrumbType, label: string, attrs?: Record<string, string | number | boolean>): void;
  cap: PageCap;
}

/** Libellé de clic : balise + texte tronqué (aria-label pour les boutons-icônes). */
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
 * Libellé borné sans mot ni segment de chemin coupé : l'ingestion ne reconnaît
 * plus la moitié d'un jeton pour la masquer. Le mot entamé devient « … ».
 */
export function boundedWireLabel(label: string, max: number = BREADCRUMB_WIRE_MAX): string {
  if (label.length <= max) return label;
  const tete = label.slice(0, max - 1);
  return `${/[\s/]/.test(label[max - 1]) ? tete : tete.replace(/[^\s/]*$/, "")}…`;
}

/**
 * Compteur de session persisté, monotone d'un rechargement à l'autre. Avant l'accord
 * il vit en mémoire : sous `requireConsent`, une deuxième page repart de 1
 * (la console ne trie pas par `seq`).
 */
export function createSeq(key: string = SEQ_KEY): () => number {
  let seq = 0;
  let relu = false;
  return () => {
    const acces = accesTerminalAutorise();
    if (acces && !relu) {
      relu = true;
      try {
        seq = Math.max(seq, parseInt(localStorage.getItem(key) || "0", 10) || 0);
      } catch {
        /* mode privé : compteur en mémoire seulement */
      }
    }
    seq += 1;
    if (acces) {
      try {
        localStorage.setItem(key, String(seq));
      } catch {
        /* ignore */
      }
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
        "breadcrumb.label": boundedWireLabel(String(label)),
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
