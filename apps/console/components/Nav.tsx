"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/pages", label: "Pages lentes" },
  { href: "/errors", label: "Erreurs JS" },
  { href: "/sessions", label: "Sessions" },
  { href: "/alerts", label: "Alertes" },
  { href: "/correlation", label: "Corrélation" },
];

export function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString(); // filtres globaux persistés dans la navigation

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={qs ? `${it.href}?${qs}` : it.href}
            className={`rounded px-3 py-2 text-sm font-medium ${
              active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
