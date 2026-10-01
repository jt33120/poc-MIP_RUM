"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { contextHref } from "@/lib/view-state";
import { refHote } from "./emplacements-coquille";
import { ICON_PATHS, Icon } from "./icons";
import { activeCategory, ongletActif, sousOnglets } from "./nav-items";
import { useDebordementHorizontal } from "./TableDefilante";

/** Barre de sous-onglets d'une catégorie (rien si la catégorie est mono-page).
 * Rend la hiérarchie visible sans multiplier les titres dans la sidebar.
 *
 * SA PLACE LIBRE SERT (recette du 01/10/2026). Les onglets n'occupent qu'une moitié de
 * la rangée : à droite, l'emplacement `onglets` reçoit ce que l'écran rangeait sur des
 * rangées à lui — le bref de la Vue d'ensemble, l'aide et les actions d'un écran dont
 * le titre redisait l'onglet (`PageHeader`), l'assistant (`emplacements-coquille.tsx`).
 * Il passe sous les onglets quand la largeur manque, jamais par-dessus.
 *
 * `data-hote-onglets` : l'emplacement existe ; la feuille de style masque alors, dès le
 * rendu serveur, les replis de ce qui va y monter (`main`, frère de cette barre dans le
 * layout ; fin de `app/globals.css`). */
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
  // Recette du 30/09/2026 : plus du tout — la barre latérale allume déjà la catégorie.
  const libelleUtile = false;

  return (
    // Sous 640 px, une seule ligne, les onglets défilent : rien n'y monte (l'assistant y
    // est un rond fixé en bas d'écran ; le reste ne monte qu'à partir de 1 024 px).
    <div
      data-hote-onglets=""
      className="flex flex-nowrap items-center border-b border-line bg-panel sm:flex-wrap"
    >
    <nav aria-label={`Onglets ${cat.label}`} className="relative min-w-0 flex-1 sm:flex-auto" data-testid="subnav">
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
      {/* Hors du <nav> : ce qui s'y range n'est pas un onglet (la barre ne compte que
          ses liens d'onglets). Vide, il ne prend aucune place. */}
      <div
        ref={refHote("onglets")}
        data-emplacement="onglets"
        className="ml-auto flex min-w-0 max-w-full shrink-0 items-center justify-end gap-2 pr-4 empty:hidden sm:py-1 sm:pl-4 sm:pr-6"
      />
    </div>
  );
}
