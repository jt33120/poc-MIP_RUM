// Onglet-lien rendu serveur : détail session, représentation de l'Explorer (F31),
// panneau latéral (F07). L'onglet actif se dit aussi hors de la couleur : trait
// sous le libellé à l'écran, `aria-current` pour un lecteur d'écran.
//
// ONGLET COMPTÉ (F44, § 4.1). `compte` écrit le nombre AVANT le clic
// (« Erreurs (3) ») ; un compte inconnu s'écrit « (—) », jamais « (0) » (V3) — même
// règle que `DetailPanel.onglets`. Absent : l'onglet n'a pas de compte.
import Link from "next/link";

/** « 3 », « — » : le compte d'un onglet tel qu'il s'écrit entre parenthèses. */
export function texteCompte(compte: number | null): string {
  return compte == null || !Number.isFinite(compte) ? "—" : compte.toLocaleString("fr-FR");
}

export function TabLink({
  href,
  active,
  compte,
  className = "",
  children,
}: {
  href: string;
  active: boolean;
  /** `null` = compte inconnu → « (—) » ; absent = onglet sans compte. */
  compte?: number | null;
  /** Classes de disposition ajoutées (ex. `flex-1` : onglets pleins à 390 px, F22). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px shrink-0 whitespace-nowrap rounded-t border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
        // Inactif en `ink-soft`, pas `ink-faint` (≈ 2,8:1) : un libellé de 14 px reste lisible (§ 3.9).
        active ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
      } ${className}`}
    >
      {children}
      {compte !== undefined && (
        <span className="tabular-nums" data-testid="onglet-compte">
          {" "}
          ({texteCompte(compte)})
        </span>
      )}
    </Link>
  );
}
