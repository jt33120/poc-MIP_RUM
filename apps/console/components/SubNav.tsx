"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { contextHref } from "@/lib/view-state";
import { activeCategory, ongletActif, sousOnglets } from "./nav-items";

/** Barre de sous-onglets d'une catégorie (rien si la catégorie est mono-page).
 * Rend la hiérarchie visible sans multiplier les titres dans la sidebar. */
export function SubNav() {
  const pathname = usePathname();
  // Contexte persisté (app, plage, filtres, comparaison) ; les réglages propres à l'écran quitté restent derrière.
  const sp = useSearchParams();
  const cat = activeCategory(pathname);
  const rangee = useRef<HTMLDivElement>(null);
  // Onglets coupés à droite : un dégradé le signale. Sans lui, à 390 px, le
  // dernier onglet visible semblait être le dernier tout court.
  const [coupe, setCoupe] = useState(false);

  useEffect(() => {
    const el = rangee.current;
    if (!el) return;
    const mesurer = () => setCoupe(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    mesurer();
    el.addEventListener("scroll", mesurer, { passive: true });
    const obs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mesurer);
    obs?.observe(el);
    return () => {
      el.removeEventListener("scroll", mesurer);
      obs?.disconnect();
    };
  }, [cat]);

  // Les liens `sousOnglet: false` (/actions) allument la catégorie sans être rendus.
  const onglets = cat ? sousOnglets(cat) : [];
  if (!cat || !onglets.length) return null;
  // Catégorie fermée : pas de barre d'onglets. Elle s'afficherait au-dessus de
  // l'écran « accès fermé » en proposant d'entrer dans la zone qu'on vient de
  // verrouiller — la sidebar n'y mène plus, cette barre ne doit pas y mener non plus.
  if (cat.verrouille) return null;
  const actif = ongletActif(cat, pathname);

  return (
    <nav aria-label={`Onglets ${cat.label}`} className="relative border-b border-line bg-panel" data-testid="subnav">
      <div ref={rangee} className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6">
        <span className="mr-2 hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint md:inline">
          {cat.label}
        </span>
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
      {coupe && (
        <span
          aria-hidden
          data-testid="subnav-debordement"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent"
        />
      )}
    </nav>
  );
}
