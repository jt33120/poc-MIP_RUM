"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { contextHref } from "@/lib/view-state";
import { ICON_PATHS, Icon } from "./icons";
import { activeCategory, ongletActif, sousOnglets } from "./nav-items";
import { useDebordementHorizontal } from "./TableDefilante";

/** Barre de sous-onglets d'une catégorie (rien si la catégorie est mono-page).
 * Rend la hiérarchie visible sans multiplier les titres dans la sidebar. */
export function SubNav() {
  const pathname = usePathname();
  // Contexte persisté (app, plage, filtres, comparaison) ; les réglages propres à l'écran quitté restent derrière.
  const sp = useSearchParams();
  const cat = activeCategory(pathname);
  const rangee = useRef<HTMLDivElement>(null);
  // Onglets coupés : un dégradé ET un chevron le signalent, du côté où il en reste.
  // Le dégradé seul se lisait comme un libellé tronqué (« Int… » à 390 px, recette
  // du 26/09) : le dernier onglet visible semblait être le dernier tout court.
  // `cat` relance la mesure quand la barre change de catégorie.
  const { gauche, droite } = useDebordementHorizontal(rangee, cat);

  // Les liens `sousOnglet: false` (/actions) allument la catégorie sans être rendus.
  const onglets = cat ? sousOnglets(cat) : [];
  if (!cat || !onglets.length) return null;
  // Catégorie fermée : pas de barre d'onglets. Elle s'afficherait au-dessus de
  // l'écran « accès fermé » en proposant d'entrer dans la zone qu'on vient de
  // verrouiller — la sidebar n'y mène plus, cette barre ne doit pas y mener non plus.
  if (cat.verrouille) return null;
  const actif = ongletActif(cat, pathname);
  // Le nom de la catégorie à gauche des onglets redit un onglet du même nom
  // (« Explorer » : catégorie, onglet, surtitre et titre, recette du 26/09/2026) :
  // il n'est écrit que s'il dit autre chose que ses onglets.
  const libelleUtile = !onglets.some((t) => t.label === cat.label);

  return (
    <nav aria-label={`Onglets ${cat.label}`} className="relative border-b border-line bg-panel" data-testid="subnav">
      <div ref={rangee} className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6">
        {libelleUtile && (
          <span className="mr-2 hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint md:inline">
            {cat.label}
          </span>
        )}
        {onglets.map((t) => {
          const active = t.href === actif;
          return (
            <Link
              key={t.href}
              href={contextHref(t.href, sp)}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                active ? "border-perf text-ink" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {gauche && (
        <span
          aria-hidden
          data-testid="subnav-debordement-gauche"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-start bg-gradient-to-r from-panel via-panel/90 to-transparent pl-1 text-ink-soft"
        >
          <Icon paths={ICON_PATHS.chevronLeft} className="h-4 w-4" />
        </span>
      )}
      {droite && (
        <span
          aria-hidden
          data-testid="subnav-debordement"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-panel via-panel/90 to-transparent pr-1 text-ink-soft"
        >
          <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
