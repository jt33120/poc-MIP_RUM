"use client";
// Le bloc Administration de la sidebar (admin seulement).
//
// Client parce qu'il lit le chemin : rendu en dur dans le layout, il n'allumait
// jamais l'écran courant — ni état actif, ni `aria-current` — alors que la
// navigation principale le fait (recette du 26/09/2026, écrans 14 à 17). Même
// allure que `Nav` : fond teinté et trait d'accent à gauche sur l'entrée active.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMINISTRATION, lienAdministrationActif } from "./nav-items";
import { ICON_PATHS, Icon } from "./icons";

export function NavAdministration({ tickets }: { tickets: boolean }) {
  const pathname = usePathname() ?? "";
  const actif = lienAdministrationActif(pathname);
  const liens = ADMINISTRATION.filter((l) => l.seulementSi !== "tickets" || tickets);

  return (
    <nav aria-label="Administration" className="flex flex-col gap-0.5">
      {liens.map((it) => {
        const estActif = it === actif;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={estActif ? "page" : undefined}
            className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              estActif ? "bg-perf/10 text-ink" : "text-ink-soft hover:bg-panel2 hover:text-ink"
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
                estActif ? "opacity-100" : "opacity-0"
              }`}
            />
            <Icon
              paths={ICON_PATHS[it.icon]}
              className={`h-4 w-4 shrink-0 ${estActif ? "text-perf" : "text-ink-faint group-hover:text-ink-soft"}`}
            />
            <span className="truncate">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
