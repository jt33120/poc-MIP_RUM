// Modèle de navigation partagé par la sidebar (catégories) et la barre de
// sous-onglets (pages d'une même catégorie). Objectif : peu de titres de menu,
// chaque catégorie regroupant ses pages sœurs. Couleur = domaine (cf. tailwind).
import type { IconName } from "./icons";

export type NavLink = { href: string; label: string };

export type NavCategory = {
  href: string; // page d'atterrissage de la catégorie (1er onglet)
  label: string;
  icon: IconName;
  domain: "perf" | "ai" | "neutral";
  children?: NavLink[]; // sous-onglets ; absent = catégorie mono-page
};

export const CATEGORIES: NavCategory[] = [
  { href: "/presentation", label: "Présentation", icon: "book", domain: "neutral" },
  {
    href: "/",
    label: "Performance",
    icon: "gauge",
    domain: "perf",
    children: [
      { href: "/", label: "Vue d'ensemble" },
      { href: "/pages", label: "Pages lentes" },
      { href: "/errors", label: "Erreurs JS" },
      { href: "/ux", label: "Frustration" },
      { href: "/experience", label: "Expérience" },
    ],
  },
  {
    href: "/sessions",
    label: "Sessions & traces",
    icon: "users",
    domain: "perf",
    children: [
      { href: "/sessions", label: "Sessions" },
      { href: "/tracing", label: "Tracing" },
      { href: "/map", label: "Carte" },
      { href: "/correlation", label: "Corrélation" },
    ],
  },
  {
    href: "/slo",
    label: "Objectifs & alertes",
    icon: "target",
    domain: "perf",
    children: [
      { href: "/slo", label: "SLO" },
      { href: "/alerts", label: "Alertes" },
      { href: "/forecast", label: "Prévisions" },
      { href: "/dashboards", label: "Tableaux de bord" },
    ],
  },
  { href: "/ai", label: "Performance IA", icon: "ai", domain: "ai" },
];

/** Un href de nav correspond-il au chemin courant ? ("/" exige l'égalité stricte). */
export function hrefMatches(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Catégorie active = celle dont un href (catégorie ou sous-onglet) matche le plus
 * longuement le chemin courant. */
export function activeCategory(pathname: string): NavCategory | undefined {
  let best: NavCategory | undefined;
  let bestLen = -1;
  for (const c of CATEGORIES) {
    const hrefs = c.children?.map((ch) => ch.href) ?? [c.href];
    for (const h of hrefs) {
      if (hrefMatches(h, pathname) && h.length > bestLen) {
        best = c;
        bestLen = h.length;
      }
    }
  }
  return best;
}
