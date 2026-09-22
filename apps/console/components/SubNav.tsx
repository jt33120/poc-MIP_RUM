"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { contextHref } from "@/lib/view-state";
import { activeCategory, hrefMatches } from "./nav-items";

/** Barre de sous-onglets d'une catégorie (rien si la catégorie est mono-page).
 * Rend la hiérarchie visible sans multiplier les titres dans la sidebar. */
export function SubNav() {
  const pathname = usePathname();
  // Contexte persisté (app, plage, filtres, comparaison) ; les réglages propres à l'écran quitté restent derrière.
  const sp = useSearchParams();
  const cat = activeCategory(pathname);
  if (!cat?.children?.length) return null;
  // Catégorie fermée : pas de barre d'onglets. Elle s'afficherait au-dessus de
  // l'écran « accès fermé » en proposant d'entrer dans la zone qu'on vient de
  // verrouiller — la sidebar n'y mène plus, cette barre ne doit pas y mener non plus.
  if (cat.verrouille) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-panel px-4 sm:px-6">
      <span className="mr-2 hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint md:inline">
        {cat.label}
      </span>
      {cat.children.map((t) => {
        const active = hrefMatches(t.href, pathname);
        return (
          <Link
            key={t.href}
            href={contextHref(t.href, sp)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
              active
                ? "border-perf text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
