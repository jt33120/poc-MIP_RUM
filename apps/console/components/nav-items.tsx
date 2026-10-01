// Modèle de navigation partagé par la sidebar (catégories) et la barre de
// sous-onglets (pages d'une même catégorie). Objectif : peu de titres de menu,
// chaque catégorie regroupant ses pages sœurs. Couleur = domaine (cf. tailwind).
import type { IconName } from "./icons";

/**
 * `sousOnglet: false` (F09) : le lien compte pour `activeCategory` — la catégorie
 * reste allumée sur sa route — mais `SubNav` ne le rend pas. C'est le cas d'une
 * route gardée derrière un onglet INTERNE à une page (/actions, sous
 * « Interactions ») : une entrée de plus dans la barre dirait deux écrans là où
 * il n'y a qu'une question. Défaut : `true`.
 *
 * `horsMenu: true` (recette du 30/09/2026) : la page n'a rien à montrer à aucun
 * projet actuel, elle quitte le menu mais GARDE son adresse (liens partagés, e2e).
 * Sur sa route, la catégorie reste allumée et AUCUN onglet ne l'est : l'onglet
 * voisin allumé dirait qu'on lit un autre écran, ce que `sousOnglet: false` fait
 * exprès pour un onglet interne.
 */
export type NavLink = { href: string; label: string; sousOnglet?: boolean; horsMenu?: boolean };

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
      // Hors menu depuis la recette du 30/09/2026 : seul le SDK React Native
      // l'alimente, il n'est pas publié et aucun projet n'est mobile — l'onglet
      // ne menait qu'à un écran vide. La page reste à son adresse, prête pour le
      // premier projet mobile.
      { href: "/mobile", label: "Mobile", horsMenu: true },
      // Tendances (recette du 01/10/2026) : la dérive des Web Vitals sur 14 jours est
      // une question de PERFORMANCE, pas de fiabilité ; l'adresse ne change pas.
      // Ajustement linéaire sur 14 points quotidiens : une tendance, pas une prévision.
      { href: "/forecast", label: "Tendances" },
    ],
  },
  // Synthétique × RUM : la promesse « synthétique + RUM unifiés », notre
  // différenciateur, était le 8ᵉ onglet d'une catégorie « Sessions ». Le tracing
  // et la carte suivent : ils répondent à « la lenteur vient-elle du back ? ».
  // Recette du 30/09/2026 : « Robot et réel » ne disait pas qu'on CORRÈLE deux
  // mesures ; les mots du métier (synthétique, RUM) le disent.
  {
    href: "/correlation",
    label: "Synthétique × RUM",
    icon: "compare",
    domain: "perf",
    children: [
      { href: "/correlation", label: "Corrélation" },
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
    ],
  },
  {
    href: "/events",
    label: "Données",
    icon: "compass",
    domain: "perf",
    children: [
      // Journal filtrable (liste + facettes + tendance) : il sert l'exploration.
      { href: "/events", label: "Journal" },
      // Un tableau est une composition de requêtes de l'Explorer (widgets v2 =
      // AST Explorer, lib/dashboards.ts) : il vit à côté d'elles, pas des alertes.
      { href: "/dashboards", label: "Tableaux de bord" },
      // Explorer générique (P6.4) : la mesure se compose au lieu d'être prédéfinie.
      // Hors menu depuis la recette du 01/10/2026 : on y entre par la loupe de la
      // barre du haut (`components/Loupe.tsx`) et par « Ouvrir dans l'Explorer » de
      // chaque figure ; l'adresse ne change pas.
      { href: "/explorer", label: "Explorer", horsMenu: true },
    ],
  },
  // Retirés du menu (recette du 30/09/2026), les pages restent à leur adresse :
  //   · « Logs » et « Supervision IA », fermés (`lib/capacites.ts`) : une entrée
  //     verrouillée ne menait nulle part ;
  //   · « Installer » : l'installation fait partie de l'ouverture d'un projet
  //     (/select/new, qui renvoie au guide /installer pour le détail).
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
 */
export type LienAdministration = { href: string; label: string; icon: IconName };

export const ADMINISTRATION: readonly LienAdministration[] = [
  { href: "/admin/customers", label: "Clients", icon: "building" },
  { href: "/admin/users", label: "Utilisateurs", icon: "user" },
  { href: "/admin/privacy", label: "Vie privée · RGPD", icon: "shield" },
  // « Jetons d'accès » (recette du 30/09/2026) : un « jeton de lecture » EST un jeton
  // d'accès porteur, en lecture seule, limité à la synthèse d'une application — le
  // nom que le métier connaît. L'adresse, la table et le code gardent « read ».
  { href: "/admin/read-tokens", label: "Jetons d'accès", icon: "key" },
  { href: "/admin/sourcemaps", label: "Source maps", icon: "fileCode" },
  { href: "/admin/extension-scope", label: "Extension navigateur", icon: "puzzle" },
  { href: "/admin/extension-installs", label: "Postes équipés", icon: "monitor" },
  // Le titre de l'écran, en français : « Uptime » à la barre latérale, « Sondes de
  // disponibilité » sur la page (recette du 26/09/2026).
  { href: "/admin/uptime", label: "Sondes de disponibilité", icon: "signal" },
  { href: "/admin/audit", label: "Audit", icon: "list" },
  { href: "/admin/usage", label: "Consommation", icon: "barChart" },
  { href: "/admin/health", label: "Santé interne", icon: "heartPulse" },
];

/** Le chemin est-il un écran d'administration ? Le bloc repliable s'y ouvre d'office. */
export function estAdministration(pathname: string): boolean {
  return hrefMatches("/admin", pathname);
}

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
  "/events": "explorer",
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
 * « API et MCP », et les écrans fermés (Logs, Supervision IA), alors que la
 * sidebar les range ailleurs.
 */
export type DomaineHorsRum = "admin" | "integrations" | "logs" | "ai";

const DOMAINES_HORS_RUM: readonly (readonly [string, DomaineHorsRum])[] = [
  ["/admin", "admin"],
  ["/installer", "integrations"],
  ["/api-docs", "integrations"],
  ["/logs", "logs"],
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

/** Sous-onglets RENDUS par la barre : les liens `sousOnglet: false` et `horsMenu` en sont retirés. */
export function sousOnglets(c: NavCategory): NavLink[] {
  return (c.children ?? []).filter((l) => l.sousOnglet !== false && !l.horsMenu);
}

/**
 * Onglet RENDU à allumer pour ce chemin. Un lien masqué est rattaché à l'onglet
 * visible qui le précède : sur /actions, c'est « Interactions » qui est actif —
 * la barre ne doit jamais n'allumer aucun onglet sur une route gardée derrière un
 * onglet interne. Une route `horsMenu` (/mobile) n'en allume AUCUN : elle n'est
 * derrière aucun onglet.
 */
export function ongletActif(c: NavCategory, pathname: string): string | undefined {
  let visible: string | undefined;
  let best: string | undefined;
  let bestLen = -1;
  for (const l of c.children ?? []) {
    if (l.sousOnglet !== false && !l.horsMenu) visible = l.href;
    if (visible !== undefined && hrefMatches(l.href, pathname) && l.href.length > bestLen) {
      best = l.horsMenu ? undefined : visible;
      bestLen = l.href.length;
    }
  }
  return best;
}

/**
 * Le lien dont l'écran courant EST la page (chemin identique), dans une catégorie qui
 * rend sa barre d'onglets ; sinon undefined. Sur cet écran, l'onglet allumé nomme déjà
 * la page : le titre n'est pas écrit une deuxième fois en dessous (recette du
 * 01/10/2026, « Pages » sous l'onglet Pages). Il reste écrit sur une sous-page
 * (/tracing/abc, /dashboards/x : il dit ce que l'onglet ne dit pas) et sur une route
 * `horsMenu` (/mobile : aucun onglet ne la nomme). Un onglet INTERNE (`sousOnglet:
 * false`, /actions) compte : l'onglet de la page porte son nom.
 */
export function ongletExact(pathname: string): NavLink | undefined {
  const c = activeCategory(pathname);
  if (!c || c.verrouille || !sousOnglets(c).length) return undefined;
  return c.children?.find((l) => l.href === pathname && !l.horsMenu);
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
