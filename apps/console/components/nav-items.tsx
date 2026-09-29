// Modèle de navigation partagé par la sidebar (catégories) et la barre de
// sous-onglets (pages d'une même catégorie). Objectif : peu de titres de menu,
// chaque catégorie regroupant ses pages sœurs. Couleur = domaine (cf. tailwind).
import { estFermee } from "@/lib/capacites";
import type { IconName } from "./icons";

/**
 * `sousOnglet: false` (F09) : le lien compte pour `activeCategory` — la catégorie
 * reste allumée sur sa route — mais `SubNav` ne le rend pas. C'est le cas d'une
 * route gardée derrière un onglet INTERNE à une page (/actions, sous
 * « Interactions ») : une entrée de plus dans la barre dirait deux écrans là où
 * il n'y a qu'une question. Défaut : `true`.
 */
export type NavLink = { href: string; label: string; sousOnglet?: boolean };

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

// Cinq catégories ouvertes de 3 à 6 onglets (plan § 2.2) : aucune barre de
// sous-onglets ne dépasse six entrées — neuf sous « Performance » défilaient et se
// coupaient à 390 px (« Fru… »). AUCUNE ROUTE NE CHANGE D'ADRESSE : on range et on
// renomme, les liens partagés restent valides.
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
      // « Pages » et non « Pages lentes » : l'écran classe TOUTES les routes ;
      // « lentes » présupposait le verdict que le tri par gravité établit.
      { href: "/pages", label: "Pages" },
      // « JS » était faux : error_source couvre réseau, CSP, console, Node,
      // Python et React Native. « et issues » est retiré (contre-recette du
      // 26/09/2026) : les écrans disent « groupe », jamais « issue ».
      { href: "/errors", label: "Erreurs" },
      // Frustration et Actions : UNE question (« quels gestes échouent ou font
      // attendre »), donc une entrée ; les deux routes restent, l'onglet Actions
      // vit dans la page (§ 5.4).
      { href: "/ux", label: "Interactions" },
      { href: "/actions", label: "Actions", sousOnglet: false },
      // L'écran lit des notes 1-5 et des verbatims : « Expérience » désignait
      // tout le produit.
      { href: "/experience", label: "Satisfaction" },
      // P7.5 : le runtime React Native a son écran parce qu'il a ses angles
      // MORTS — crashes natifs, ANR, démarrage natif. Les fondre dans les
      // écrans web ferait lire leurs absences comme des zéros.
      { href: "/mobile", label: "Mobile" },
    ],
  },
  // Robot et réel : la promesse « synthétique + RUM unifiés », notre
  // différenciateur, était le 8ᵉ onglet d'une catégorie « Sessions ». Le tracing
  // et la carte suivent : ils répondent à « la lenteur vient-elle du back ? ».
  {
    href: "/correlation",
    label: "Robot et réel",
    icon: "compare",
    domain: "perf",
    children: [
      // Le nom de l'écran (« Robot et réel ») : « Corrélation synthétique ↔ RUM » était
      // du vocabulaire de fournisseur, et la seule entrée qui ne disait pas son titre.
      { href: "/correlation", label: "Robot et réel" },
      { href: "/tracing", label: "Tracing" },
      { href: "/map", label: "Carte" },
    ],
  },
  {
    href: "/sessions",
    label: "Usages",
    icon: "users",
    domain: "perf",
    children: [
      { href: "/sessions", label: "Sessions" },
      { href: "/paths", label: "Parcours" },
      // Objectifs de CONVERSION (pageview / event), pas des objectifs de
      // service : rangés avec les SLO, ils partageaient le même mot.
      { href: "/goals", label: "Conversions" },
      { href: "/forms", label: "Formulaires" },
      { href: "/acquisition", label: "Acquisition" },
      { href: "/retention", label: "Rétention" },
    ],
  },
  {
    href: "/slo",
    label: "Fiabilité",
    icon: "target",
    domain: "perf",
    children: [
      { href: "/slo", label: "SLO" },
      { href: "/alerts", label: "Alertes" },
      // Ajustement linéaire sur 14 points quotidiens : une tendance, pas une
      // prévision.
      { href: "/forecast", label: "Tendances" },
    ],
  },
  {
    href: "/explorer",
    label: "Explorer",
    icon: "compass",
    domain: "perf",
    children: [
      // Explorer générique (P6.4) : la même fenêtre et les mêmes filtres que les
      // écrans voisins, mais la mesure se compose au lieu d'être prédéfinie. C'est
      // la destination commune de « Ouvrir dans l'Explorer » de chaque figure.
      { href: "/explorer", label: "Explorer" },
      // Journal filtrable (liste + facettes + tendance) : il sert l'exploration.
      { href: "/events", label: "Journal" },
      // Un tableau est une composition de requêtes de l'Explorer (widgets v2 =
      // AST Explorer, lib/dashboards.ts) : il vit à côté d'elles, pas des alertes.
      { href: "/dashboards", label: "Tableaux de bord" },
    ],
  },
  // FERMÉ : ce n'est pas du RUM. rum_log porte le signal LOGS d'OpenTelemetry,
  // alimenté par le SERVEUR — la console qui forwarde ses propres logs
  // (lib/log-forward.ts) et l'agent OpenTelemetry officiel posé sur le serveur
  // du client (OTEL_LOGS_EXPORTER=otlp). Le SDK navigateur n'émet aucun log : la colonne `source` prévoit
  // 'sdk' et 'extension', rien ne produit ces valeurs. C'est de l'observabilité
  // back-end corrélée au RUM par trace_id, pas une mesure de l'expérience vécue.
  { href: "/logs", label: "Logs", icon: "logs", domain: "neutral", verrouille: estFermee("/logs") },
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
    verrouille: estFermee("/svi"),
    children: [
      { href: "/svi", label: "Vue d'ensemble" },
      { href: "/svi/appels", label: "Appels" },
    ],
  },
  // Espace PARTENAIRE (sponsorisé xSOM) — supervision IA lue depuis xSOM AI Guard,
  // distincte du RUM MIP (cf. ADR-0001). Fermée pour l'instant : l'entrée reste
  // visible pour annoncer la capacité, mais ne mène nulle part.
  { href: "/ai", label: "Supervision IA", icon: "ai", domain: "neutral", verrouille: estFermee("/ai") },
  // « API et MCP » : les deux manières de sortir la donnée du portail. L'API REST
  // pour un front ou un partenaire, le serveur MCP pour un agent IA. Même socle
  // — le MCP n'est qu'un client de l'API v1 — donc une seule page.
  { href: "/api-docs", label: "API et MCP", icon: "grid", domain: "neutral" },
];

/**
 * Le bloc Administration de la sidebar (admin seulement). Déclaré ICI, à côté des
 * catégories, pour que la sidebar et le surtitre des pages lisent la même liste :
 * rendu en dur dans le layout, il n'avait ni état actif ni `aria-current`, et ses
 * icônes reprenaient celles de la navigation principale (recette du 26/09/2026).
 * `seulementSi` : entrée conditionnelle, que le layout décide (connecteurs de
 * tickets : seulement quand un fournisseur est branché).
 */
export type LienAdministration = { href: string; label: string; icon: IconName; seulementSi?: "tickets" };

export const ADMINISTRATION: readonly LienAdministration[] = [
  { href: "/admin/customers", label: "Clients", icon: "building" },
  { href: "/admin/users", label: "Utilisateurs", icon: "user" },
  { href: "/admin/privacy", label: "Vie privée · RGPD", icon: "shield" },
  { href: "/admin/read-tokens", label: "Jetons de lecture", icon: "key" },
  { href: "/admin/sourcemaps", label: "Source maps", icon: "fileCode" },
  { href: "/admin/ticket-integrations", label: "Connecteurs de tickets", icon: "bell", seulementSi: "tickets" },
  { href: "/admin/extension-scope", label: "Extension navigateur", icon: "puzzle" },
  { href: "/admin/extension-installs", label: "Postes équipés", icon: "monitor" },
  // Le titre de l'écran, en français : « Uptime » à la barre latérale, « Sondes de
  // disponibilité » sur la page (recette du 26/09/2026).
  { href: "/admin/uptime", label: "Sondes de disponibilité", icon: "signal" },
  { href: "/admin/audit", label: "Audit", icon: "list" },
  { href: "/admin/usage", label: "Consommation", icon: "barChart" },
  { href: "/admin/health", label: "Santé interne", icon: "heartPulse" },
];

/** Entrée d'administration active pour ce chemin (préfixe le plus long), ou undefined. */
export function lienAdministrationActif(pathname: string): LienAdministration | undefined {
  let best: LienAdministration | undefined;
  for (const l of ADMINISTRATION) {
    if (hrefMatches(l.href, pathname) && (!best || l.href.length > best.href.length)) best = l;
  }
  return best;
}

/** Clé de domaine d'en-tête (`PageHeader.domain`, § 2.4) de chaque catégorie RUM,
 *  indexée par sa landing. Une page sans `domain` explicite prend celle-ci. */
export const DOMAINE_DE_CATEGORIE = {
  "/": "perf",
  "/correlation": "robot",
  "/sessions": "usages",
  "/slo": "fiabilite",
  "/explorer": "explorer",
} as const satisfies Record<string, string>;
export type DomaineRum = (typeof DOMAINE_DE_CATEGORIE)[keyof typeof DOMAINE_DE_CATEGORIE];

/** Domaine d'en-tête d'un chemin, ou null hors des cinq catégories RUM (admin…). */
export function domaineDe(pathname: string): DomaineRum | null {
  const c = activeCategory(pathname);
  if (!c) return null;
  return (DOMAINE_DE_CATEGORIE as Record<string, DomaineRum>)[c.href] ?? null;
}

/**
 * Surtitres HORS des cinq catégories RUM. Avant la recette du 26/09/2026, tout
 * écran qui n'y était pas rangé retombait sur « Performance » : l'administration,
 * « API et MCP », et les trois écrans fermés (Logs, Supervision SVI, Supervision
 * IA), alors que la sidebar les range ailleurs.
 */
export type DomaineHorsRum = "admin" | "integrations" | "logs" | "svi" | "ai";

const DOMAINES_HORS_RUM: readonly (readonly [string, DomaineHorsRum])[] = [
  ["/admin", "admin"],
  ["/api-docs", "integrations"],
  ["/logs", "logs"],
  ["/svi", "svi"],
  ["/ai", "ai"],
];

/**
 * Surtitre d'un chemin : le domaine de sa catégorie RUM, sinon celui de sa zone
 * (administration, intégrations, écrans fermés), sinon null (repli du composant).
 */
export function surtitreDe(pathname: string): DomaineRum | DomaineHorsRum | null {
  const rum = domaineDe(pathname);
  if (rum) return rum;
  for (const [prefixe, domaine] of DOMAINES_HORS_RUM) {
    if (hrefMatches(prefixe, pathname)) return domaine;
  }
  return null;
}

/** Sous-onglets RENDUS par la barre : les liens `sousOnglet: false` en sont retirés. */
export function sousOnglets(c: NavCategory): NavLink[] {
  return (c.children ?? []).filter((l) => l.sousOnglet !== false);
}

/**
 * Onglet RENDU à allumer pour ce chemin. Un lien masqué est rattaché à l'onglet
 * visible qui le précède : sur /actions, c'est « Interactions » qui est actif —
 * la barre ne doit jamais n'allumer aucun onglet sur une route de sa catégorie.
 */
export function ongletActif(c: NavCategory, pathname: string): string | undefined {
  let visible: string | undefined;
  let best: string | undefined;
  let bestLen = -1;
  for (const l of c.children ?? []) {
    if (l.sousOnglet !== false) visible = l.href;
    if (visible !== undefined && hrefMatches(l.href, pathname) && l.href.length > bestLen) {
      best = visible;
      bestLen = l.href.length;
    }
  }
  return best;
}

/** Un href de nav correspond-il au chemin courant ? ("/" exige l'égalité stricte). */
export function hrefMatches(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Catégorie active = celle dont un href (catégorie ou sous-onglet, masqués
 * compris) matche le plus longuement le chemin courant. */
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
