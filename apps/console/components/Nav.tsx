"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ICON_PATHS, Icon, type IconName } from "./icons";

type Item = { href: string; label: string; icon: IconName };

// Navigation groupée par domaine — la couleur du groupe code le sens :
// bleu = performance utilisateur (RUM), violet = intelligence artificielle.
const TOP: Item = { href: "/presentation", label: "Présentation", icon: "book" };

const GROUPS: { title: string; dot: string; items: Item[] }[] = [
  {
    title: "Performance utilisateur",
    dot: "bg-perf",
    items: [
      { href: "/", label: "Overview", icon: "gauge" },
      { href: "/pages", label: "Pages lentes", icon: "timer" },
      { href: "/errors", label: "Erreurs JS", icon: "alert" },
      { href: "/sessions", label: "Sessions", icon: "users" },
      { href: "/ux", label: "Frustration", icon: "frown" },
      { href: "/tracing", label: "Tracing", icon: "trace" },
      { href: "/correlation", label: "Corrélation", icon: "compare" },
      { href: "/slo", label: "SLO", icon: "target" },
      { href: "/alerts", label: "Alertes", icon: "bell" },
      { href: "/dashboards", label: "Dashboards", icon: "grid" },
    ],
  },
  {
    title: "Intelligence artificielle",
    dot: "bg-ai",
    items: [{ href: "/ai", label: "Performance IA", icon: "ai" }],
  },
];

export function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString(); // filtres globaux (dont ?app) persistés dans la navigation

  const link = (it: Item) => {
    const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
    return (
      <Link
        key={it.href}
        href={qs ? `${it.href}?${qs}` : it.href}
        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active ? "bg-perf/10 text-ink" : "text-ink-soft hover:bg-panel2 hover:text-ink"
        }`}
      >
        {/* rail orange du lien actif — signature MIP */}
        <span
          className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
            active ? "opacity-100" : "opacity-0"
          }`}
        />
        <Icon
          paths={ICON_PATHS[it.icon]}
          className={`h-4 w-4 shrink-0 ${active ? "text-perf" : "text-ink-faint group-hover:text-ink-soft"}`}
        />
        {it.label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-0.5">
      {link(TOP)}
      {GROUPS.map((g) => (
        <div key={g.title} className="mt-4">
          <div className="flex items-center gap-1.5 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            <span className={`h-1.5 w-1.5 rounded-full ${g.dot}`} />
            {g.title}
          </div>
          {g.items.map(link)}
        </div>
      ))}
    </nav>
  );
}
