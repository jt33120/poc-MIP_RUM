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
  /** Capacité annoncée mais fermée : entrée non cliquable, cadenas, page barrée.
   *  Drapeau UNIQUE — la sidebar et la page le lisent tous les deux, donc rouvrir
   *  l'accès se fait en retirant cette ligne, sans risque d'en oublier une moitié. */
  verrouille?: boolean;
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
      { href: "/actions", label: "Actions" },
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
  // FERMÉ : ce n'est pas du RUM. rum_log porte le signal LOGS d'OpenTelemetry,
  // alimenté par le SERVEUR — la console qui forwarde ses propres logs
  // (lib/log-forward.ts) et l'agent Node (packages/agent-node) qui capture
  // console.*. Le SDK navigateur n'émet aucun log : la colonne `source` prévoit
  // 'sdk' et 'extension', rien ne produit ces valeurs. C'est de l'observabilité
  // back-end corrélée au RUM par trace_id, pas une mesure de l'expérience vécue.
  { href: "/logs", label: "Logs", icon: "logs", domain: "neutral", verrouille: true },
  // Supervision SVI (serveur vocal). Produit distinct du RUM web : un appel n'est
  // pas une visite, cf. migration-v51. La vue d'ensemble porte le containment NET.
  // Fermée comme la supervision IA : capacité annoncée, accès non ouvert. Les
  // sous-onglets restent déclarés pour que la réouverture soit un seul mot à
  // retirer, mais la sidebar ne les expose plus (l'entrée n'est plus cliquable).
  {
    href: "/svi",
    label: "Supervision SVI",
    icon: "activity",
    domain: "neutral",
    verrouille: true,
    children: [
      { href: "/svi", label: "Vue d'ensemble" },
      { href: "/svi/appels", label: "Appels" },
    ],
  },
  // Espace PARTENAIRE (sponsorisé xSOM) — supervision IA lue depuis xSOM AI Guard,
  // distincte du RUM MIP (cf. ADR-0001). Fermée pour l'instant : l'entrée reste
  // visible pour annoncer la capacité, mais ne mène nulle part.
  { href: "/ai", label: "Supervision IA", icon: "ai", domain: "neutral", verrouille: true },
  // « API et MCP » : les deux manières de sortir la donnée du portail. L'API REST
  // pour un front ou un partenaire, le serveur MCP pour un agent IA. Même socle
  // — le MCP n'est qu'un client de l'API v1 — donc une seule page.
  { href: "/api-docs", label: "API et MCP", icon: "grid", domain: "neutral" },
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
