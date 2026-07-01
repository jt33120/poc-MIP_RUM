// Badge de sévérité (critical=rouge, warning=ambre, info=slate) — rendu serveur.

/** Classes Tailwind d'un badge de sévérité (critical=rouge, warning=ambre, info=slate). */
const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  info: "bg-slate-100 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info}`}
    >
      {severity}
    </span>
  );
}
