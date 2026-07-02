"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { activeCategory, hrefMatches } from "./nav-items";

/** Barre de sous-onglets d'une catégorie (rien si la catégorie est mono-page).
 * Rend la hiérarchie visible sans multiplier les titres dans la sidebar. */
export function SubNav() {
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const cat = activeCategory(pathname);
  if (!cat?.children?.length) return null;

  return (
    <div className="flex items-center gap-1 border-b border-line bg-panel px-6">
      <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {cat.label}
      </span>
      {cat.children.map((t) => {
        const active = hrefMatches(t.href, pathname);
        return (
          <Link
            key={t.href}
            href={qs ? `${t.href}?${qs}` : t.href}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition ${
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
