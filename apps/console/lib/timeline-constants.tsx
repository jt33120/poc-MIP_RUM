// Styles et pictos par type d'événement de la timeline session (config statique).
// Extrait de app/sessions/[id]/page.tsx — partagé entre la page et ses sous-composants.
import type { TimelineKind } from "@/lib/queries";

// styles + pictos par type d'événement de la timeline
export const KIND_STYLE: Record<TimelineKind, { label: string; dot: string; badge: string }> = {
  pageview: {
    label: "Page vue",
    dot: "bg-blue-500",
    badge:
      "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30",
  },
  vital: {
    label: "Vital",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-400/30",
  },
  error: {
    label: "Erreur JS",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-800 border-red-300 dark:bg-red-400/10 dark:text-red-300 dark:border-red-400/30",
  },
  breadcrumb: {
    label: "Breadcrumb",
    dot: "bg-violet-500",
    badge:
      "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-400/10 dark:text-violet-300 dark:border-violet-400/30",
  },
  longtask: {
    label: "Long task",
    dot: "bg-orange-500",
    badge:
      "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-400/10 dark:text-orange-300 dark:border-orange-400/30",
  },
  event: {
    label: "Event métier",
    dot: "bg-cyan-600",
    badge:
      "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-400/10 dark:text-cyan-300 dark:border-cyan-400/30",
  },
  action: {
    label: "Action",
    dot: "bg-fuchsia-600",
    badge: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:border-fuchsia-400/30",
  },
  resource: {
    label: "Ressource",
    dot: "bg-amber-600",
    badge: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30",
  },
  api: {
    label: "Appel API",
    dot: "bg-sky-600",
    badge: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-400/10 dark:text-sky-300 dark:border-sky-400/30",
  },
};

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
