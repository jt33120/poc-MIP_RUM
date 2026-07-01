// Onglet de navigation du détail session (Timeline | Replay). Rendu serveur, simple lien stylé.
import Link from "next/link";

export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
      }`}
    >
      {children}
    </Link>
  );
}
