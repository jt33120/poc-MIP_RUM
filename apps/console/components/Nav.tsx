"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CATEGORIES, activeCategory } from "./nav-items";
import { ICON_PATHS, Icon } from "./icons";

const DOMAIN_DOT = { perf: "text-perf", ai: "text-ai", neutral: "text-ink-faint" } as const;

/** Sidebar : une entrée par catégorie (les pages sœurs s'ouvrent en sous-onglets). */
export function Nav() {
  const pathname = usePathname();
  const qs = useSearchParams().toString(); // filtres (dont ?app) persistés
  const active = activeCategory(pathname);

  return (
    <nav className="flex flex-col gap-0.5">
      {CATEGORIES.map((c) => {
        const isActive = c === active;
        return (
          <Link
            key={c.href}
            href={qs ? `${c.href}?${qs}` : c.href}
            className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive ? "bg-perf/10 text-ink" : "text-ink-soft hover:bg-panel2 hover:text-ink"
            }`}
          >
            <span
              className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
            <Icon
              paths={ICON_PATHS[c.icon]}
              className={`h-4 w-4 shrink-0 ${isActive ? DOMAIN_DOT[c.domain] : "text-ink-faint group-hover:text-ink-soft"}`}
            />
            {c.label}
          </Link>
        );
      })}
    </nav>
  );
}
