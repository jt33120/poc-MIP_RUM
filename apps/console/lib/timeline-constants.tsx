// Styles et pictos par type d'événement de la timeline session (config statique).
// Extrait de app/sessions/[id]/page.tsx — partagé entre la page et ses sous-composants.
import type { TimelineItem, TimelineKind } from "@/lib/queries";
import { CORE_VITALS, RATING_BAR, rating2026, type Rating } from "@/lib/rating";
import { noteMip } from "@/lib/seuils";

// styles + pictos par type d'événement de la timeline
export const KIND_STYLE: Record<TimelineKind, { label: string; dot: string; badge: string }> = {
  pageview: {
    label: "Page vue",
    dot: "bg-blue-500",
    badge:
      "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30",
  },
  // Le point et le badge d'une mesure sont NEUTRES ici : un point vert fixe disait
  // « bon » pour toute mesure, phases réseau comprises (relevé du 29/09/2026). La
  // couleur vient de la note de la ligne (`noteDeLigne`, `pointDeLigne`).
  vital: {
    label: "Web Vital",
    dot: "bg-ink-faint",
    badge: "bg-panel2 text-ink-soft border-line",
  },
  error: {
    label: "Erreur JS",
    dot: "bg-bad",
    badge: "bg-bad/10 text-bad-ink border-bad/30",
  },
  // Libellés en français (recette du 26/09/2026 : « Breadcrumb », « Long task » et
  // « Event métier » côtoyaient « Tâches longues » et « Événements » du filtre).
  breadcrumb: {
    label: "Repère",
    dot: "bg-violet-500",
    badge:
      "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-400/10 dark:text-violet-300 dark:border-violet-400/30",
  },
  longtask: {
    label: "Tâche longue",
    dot: "bg-orange-500",
    badge:
      "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-400/10 dark:text-orange-300 dark:border-orange-400/30",
  },
  event: {
    label: "Événement",
    dot: "bg-cyan-600",
    badge:
      "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-400/10 dark:text-cyan-300 dark:border-cyan-400/30",
  },
  action: {
    label: "Action",
    dot: "bg-fuchsia-600",
    badge: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:border-fuchsia-400/30",
  },
  // Même correction : une ressource n'est pas « à améliorer » par nature (ambre fixe
  // jusqu'au 29/09/2026) ; sa note se lit sur sa durée (`SEUILS_MIP.RESOURCE`).
  resource: {
    label: "Ressource",
    dot: "bg-ink-faint",
    badge: "bg-panel2 text-ink-soft border-line",
  },
  api: {
    label: "Appel API",
    dot: "bg-sky-600",
    badge: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-400/10 dark:text-sky-300 dark:border-sky-400/30",
  },
};

/**
 * La mesure MIP d'une ligne de chronologie, ou `null` : une ligne `vital` qui n'est
 * pas une Core Web Vital porte le nom de sa mesure (`rum_metric.name` : DNS, TCP…,
 * les clés de `SEUILS_MIP`) ; une ressource se note par `RESOURCE`, un appel par `API`.
 */
export function mesureMipDeLigne(item: Pick<TimelineItem, "kind" | "title">): string | null {
  if (item.kind === "vital") return item.title && !CORE_VITALS.includes(item.title) ? item.title : null;
  if (item.kind === "resource") return "RESOURCE";
  if (item.kind === "api") return "API";
  return null;
}

/**
 * La note d'une ligne : une Core Web Vital par ses seuils web.dev (la note stockée,
 * sinon `rating2026`), une autre mesure par sa règle MIP (`noteMip`), rien sinon.
 * Jamais « bon » par défaut : sans valeur ou sans règle, `null`.
 */
export function noteDeLigne(item: Pick<TimelineItem, "kind" | "title" | "value" | "rating">): Rating | null {
  const valeur = item.value == null ? null : Number(item.value);
  if (item.kind === "vital" && item.title && CORE_VITALS.includes(item.title)) {
    if (item.rating === "good" || item.rating === "needs-improvement" || item.rating === "poor") return item.rating;
    return valeur == null || !Number.isFinite(valeur) ? null : rating2026(item.title, valeur);
  }
  const mesure = mesureMipDeLigne(item);
  return mesure ? noteMip(mesure, valeur) : null;
}

/** Le point de la ligne : couleur de sa note s'il y en a une, sinon celle de sa nature. */
export function pointDeLigne(item: Pick<TimelineItem, "kind" | "title" | "value" | "rating">): string {
  if (item.kind === "vital" || item.kind === "resource") {
    const note = noteDeLigne(item);
    return note ? RATING_BAR[note] : KIND_STYLE[item.kind].dot;
  }
  return KIND_STYLE[item.kind].dot;
}

/** Le libellé de la ligne : « Web Vital » pour les cinq seulement, « Mesure réseau » pour les autres. */
export function libelleDeLigne(item: Pick<TimelineItem, "kind" | "title">): string {
  if (item.kind === "vital" && !(item.title && CORE_VITALS.includes(item.title))) return "Mesure réseau";
  return KIND_STYLE[item.kind].label;
}

/** Petit picto SVG monochrome (hérite de currentColor). */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 18 18" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export const KIND_ICON: Record<TimelineKind, React.ReactNode> = {
  pageview: <Icon d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 0v4h4" />,
  vital: <Icon d="M2 9h3l2-5 3 9 2-4h4" />,
  error: <Icon d="M9 2 16 15H2L9 2Zm0 5v4m0 2v.5" />,
  breadcrumb: <Icon d="M4 3l9 5-4 1.5L7.5 14 4 3Z" />,
  longtask: <Icon d="M9 4.5V9l3 2M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14Z" />,
  event: <Icon d="M3 3h6l6 6-6 6-6-6V3Zm3 3h.5" />,
  action: <Icon d="M3 9h12M9 3v12" />,
  resource: <Icon d="M3 4h12v10H3zM6 7h6" />,
  api: <Icon d="M2 9h5m4 0h5M7 9l2-3m0 6 2-3" />,
};

/**
 * Nom lisible d'un événement émis par le SDK (`frustration.dead`, `form.abandon`…) ;
 * un événement métier déclaré par l'application garde son nom. La recette du
 * 26/09/2026 lisait « frustration.dead » et « form.abandon » dans la chronologie.
 */
const EVENEMENTS_SDK: Record<string, string> = {
  "frustration.rage": "Clics de rage",
  "frustration.dead": "Clic sans réaction",
  "frustration.error": "Erreur pendant l'action",
  "form.submit": "Formulaire envoyé",
  "form.abandon": "Formulaire abandonné",
};

export function libelleEvenement(nom: string | null | undefined): string {
  if (!nom) return "Événement sans nom";
  return EVENEMENTS_SDK[nom] ?? nom;
}
