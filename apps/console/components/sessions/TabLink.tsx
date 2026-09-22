// Onglet-lien rendu serveur : détail session (Timeline | Replay), représentation
// de l'Explorer (F31). L'onglet actif se dit aussi hors de la couleur : trait sous
// le libellé à l'écran, `aria-current` pour un lecteur d'écran.
import Link from "next/link";

export function TabLink({
  href,
  active,
  className = "",
  children,
}: {
  href: string;
  active: boolean;
  /** Classes de disposition ajoutées (ex. `flex-1` : onglets pleins à 390 px, F22). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px shrink-0 whitespace-nowrap rounded-t border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
        active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
