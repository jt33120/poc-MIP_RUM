// Bulle d'aide au survol — primitive accessible, sans dépendance ni état JS.
//
// Pourquoi CSS pur (group-hover + focus-within) plutôt qu'une lib de tooltip :
// rendable côté serveur (RSC), zéro hydratation, ouvrable au clavier (le
// déclencheur est un <button> focusable), et role="tooltip" pour les lecteurs
// d'écran. Le POC reste léger tout en étant navigable et accessible.
import { ICON_PATHS, Icon, type IconName } from "./icons";

export function InfoTip({
  children,
  icon = "help",
  side = "bottom",
  className = "",
  label = "Aide",
}: {
  children: React.ReactNode;
  icon?: IconName;
  side?: "top" | "bottom";
  className?: string;
  label?: string;
}) {
  const pos =
    side === "top"
      ? "bottom-full mb-2"
      : "top-full mt-2";
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-faint transition hover:text-accent focus:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon paths={ICON_PATHS[icon]} className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-72 -translate-x-1/2 rounded-xl border border-line bg-panel p-3 text-left text-xs leading-relaxed text-ink-soft opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${pos}`}
      >
        {children}
      </span>
    </span>
  );
}
