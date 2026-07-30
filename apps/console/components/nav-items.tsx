// Modèle de navigation partagé par la sidebar (catégories) et la barre de
// sous-onglets (pages d'une même catégorie). Objectif : peu de titres de menu,
// chaque catégorie regroupant ses pages sœurs. Couleur = domaine (cf. tailwind).
import type { IconName } from "./icons";

export type NavLink = { href: string; label: string };

export type NavCategory = {
  href: string; // page d'atterrissage de la catégorie (1er onglet)
  label: string;
  icon: IconName;
  domain: "perf" | "neutral";
  children?: NavLink[]; // sous-onglets ; absent = catégorie mono-page
};

export const CATEGORIES: NavCategory[] = [
  // NB : /presentation n'est PLUS dans la nav — c'est la vitrine PUBLIQUE (avant
  // login). Post-login son intérêt est faible ; elle reste joignable directement
  // (/presentation) et depuis le login (« Découvrir MIP RUM »).
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
      { href: "/acquisition", label: "Acquisition" },
      { href: "/retention", label: "Rétention" },
      { href: "/paths", label: "Parcours" },
      { href: "/forms", label: "Formulaires" },
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
      { href: "/goals", label: "Objectifs" },
      { href: "/slo", label: "SLO" },
      { href: "/alerts", label: "Alertes" },
      { href: "/forecast", label: "Prévisions" },
      { href: "/dashboards", label: "Tableaux de bord" },
    ],
  },
  { href: "/logs", label: "Logs", icon: "logs", domain: "neutral" },
  // Supervision SVI (serveur vocal) — incrément I0 : liste d'appels et déroulé.
  // Produit distinct du RUM web : un appel n'est pas une visite, cf. migration-v51.
  { href: "/svi/appels", label: "Appels SVI", icon: "activity", domain: "neutral" },
  // Espace PARTENAIRE (sponsorisé xSOM) — supervision IA lue depuis xSOM AI Guard,
  // distincte du RUM MIP (cf. ADR-0001). Le libellé « · xSOM » signale le partenaire.
  { href: "/ai", label: "IA · xSOM", icon: "ai", domain: "neutral" },
  { href: "/api-docs", label: "API", icon: "grid", domain: "neutral" },
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
