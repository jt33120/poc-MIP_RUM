"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ICON_PATHS, Icon, type IconName } from "./icons";

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/presentation", label: "Présentation", icon: "book" },
  { href: "/", label: "Overview", icon: "gauge" },
  { href: "/pages", label: "Pages lentes", icon: "timer" },
  { href: "/errors", label: "Erreurs JS", icon: "alert" },
  { href: "/sessions", label: "Sessions", icon: "users" },
  { href: "/tracing", label: "Tracing", icon: "trace" },
  { href: "/alerts", label: "Alertes", icon: "bell" },
  { href: "/correlation", label: "Corrélation", icon: "compare" },
];

export function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString(); // filtres globaux persistés dans la navigation

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={qs ? `${it.href}?${qs}` : it.href}
            className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-white/[0.08] text-accent"
                : "text-slate-300/90 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {/* rail orange du lien actif — signature MIP */}
            <span
              className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
                active ? "opacity-100 shadow-glow" : "opacity-0"
              }`}
            />
            <Icon
              paths={ICON_PATHS[it.icon]}
              className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-slate-400 group-hover:text-slate-200"}`}
            />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
