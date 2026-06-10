"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/pages", label: "Pages lentes" },
  { href: "/errors", label: "Erreurs JS" },
  { href: "/sessions", label: "Sessions" },
  { href: "/correlation", label: "Corrélation" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={`rounded px-3 py-2 text-sm font-medium ${
            pathname === it.href
              ? "bg-blue-600 text-white"
              : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
