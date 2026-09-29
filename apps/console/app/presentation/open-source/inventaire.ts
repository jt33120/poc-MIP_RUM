// L'inventaire des composants open source, lisible par la page /presentation/open-source.
//
// AUCUNE LIGNE N'EST TAPÉE ICI. Les composants viennent du JSON produit par
// `node scripts/composants-open-source.mjs` (manifestes npm installés, Dockerfile,
// workflows, plus la courte liste tenue à la main à côté du script) ; le test
// tests/unit/composants-open-source.test.ts échoue si ce JSON n'est plus ce que le
// script produit. Ce module ne fait que typer, compter et libeller.
//
// Sans import serveur : la page de filtre, côté client, le lit aussi.
import donnees from "@/lib/composants-open-source.generated.json";

export type CategorieId = "console" | "backend" | "capteurs" | "outils" | "ci" | "conteneurs" | "agents" | "donnees";

export type TypeComposant = "npm" | "image" | "action" | "python" | "outil" | "externe";

export interface Usage {
  nom: string;
  /** Déclaré en `devDependencies` seulement dans cet espace de travail. */
  dev?: boolean;
}

export interface Composant {
  categorie: CategorieId;
  type: TypeComposant;
  nom: string;
  version: string;
  licence: string;
  /** URL https du dépôt source, ou « non déclaré ». */
  depot: string;
  utilisePar: Usage[];
  /** Fichiers du dépôt où le composant est déclaré : la preuve, gardée pour qui vérifie. */
  sources: string[];
  portee?: "execution" | "developpement";
  role?: string;
  note?: string;
  empreinte?: string;
  attribution?: string;
}

export interface Inventaire {
  generePar: string;
  releveLe: string;
  paquetsDuLockfile: number;
  espaces: { chemin: string; nom: string; categorie: CategorieId }[];
  categories: CategorieId[];
  composants: Composant[];
}

export const INVENTAIRE = donnees as Inventaire;
export const COMPOSANTS: readonly Composant[] = INVENTAIRE.composants;

/** Les valeurs que le script écrit quand un paquet ne déclare rien : la page le dit tel quel. */
export const LICENCE_NON_DECLAREE = "non déclarée";
export const DEPOT_NON_DECLARE = "non déclaré";

/** Titre et chapeau de chaque section, dans l'ordre du JSON. */
export const CATEGORIES: Record<CategorieId, { titre: string; chapeau: string }> = {
  console: {
    titre: "Console",
    chapeau: "L'application web des équipes : écrans, API de lecture, réception des mesures.",
  },
  backend: {
    titre: "Services backend",
    chapeau:
      "Collecteur, API de lecture, backend de la console, travaux planifiés, notifications et serveur MCP.",
  },
  capteurs: {
    titre: "Capteurs navigateur et mobile",
    chapeau: "Ce qui part chez les clients : SDK navigateur, enregistrement du rejeu, extension, SDK mobile.",
  },
  outils: {
    titre: "Outils de build et de test",
    chapeau: "Compilation, typage, styles et tests, plus l'environnement d'exécution et le gestionnaire de paquets.",
  },
  ci: {
    titre: "Intégration continue",
    chapeau: "Les actions GitHub des workflows, à la version qu'ils épinglent.",
  },
  conteneurs: {
    titre: "Conteneurs",
    chapeau: "Les images Docker de base des services, de la CI et de l'environnement local.",
  },
  agents: {
    titre: "Agents OpenTelemetry recommandés aux clients",
    chapeau:
      "Ils ne tournent pas chez nous : ce sont les agents officiels que nous recommandons pour instrumenter les services des clients, qui envoient leurs traces en OTLP.",
  },
  donnees: {
    titre: "Données tierces",
    chapeau: "Les bases de données de tiers que le produit embarque. Leur licence peut exiger une attribution.",
  },
};

/** Comment le composant a été trouvé, en clair. */
export const TYPE_LIBELLE: Record<TypeComposant, string> = {
  npm: "paquet npm",
  image: "image Docker",
  action: "action GitHub",
  python: "paquet Python",
  outil: "outil",
  externe: "hors manifeste",
};

/**
 * Pourquoi une licence mérite qu'on la regarde, ou `null`. Prudent : une double
 * licence dont l'une est copyleft est signalée, même si l'autre suffirait.
 */
export function vigilance(licence: string): string | null {
  if (licence === LICENCE_NON_DECLAREE) return "Aucune licence déclarée par le paquet : à lire dans son dépôt.";
  if (/(^|[^A-Z])(A?GPL|LGPL|EUPL|OSL|SSPL)/i.test(licence)) {
    return "Copyleft : un dérivé redistribué doit l'être sous la même licence.";
  }
  if (/(^|[^A-Z])(MPL|EPL|CDDL)/i.test(licence)) {
    return "Copyleft faible, fichier par fichier : un fichier modifié se redistribue sous la même licence.";
  }
  if (/CC[- ]BY/i.test(licence)) return "Attribution exigée : la source doit être créditée de façon visible.";
  return null;
}

/**
 * L'ancre d'une section, partagée par le sommaire (rendu serveur) et le titre (rendu
 * client) : ici et pas dans le module client, dont le serveur ne peut pas appeler
 * les fonctions.
 */
export const ancreCategorie = (id: string) => `os-${id}`;

/** Le lien du dépôt, lisible : sans le protocole ni le `tree/HEAD` des monodépôts. */
export function depotLisible(url: string): string {
  return url.replace(/^https:\/\//, "").replace("/tree/HEAD/", "/");
}

/** Les licences distinctes, de la plus fréquente à la plus rare, puis par nom. */
export function licences(composants: readonly Composant[] = COMPOSANTS): { licence: string; n: number }[] {
  const parLicence = new Map<string, number>();
  for (const c of composants) parLicence.set(c.licence, (parLicence.get(c.licence) ?? 0) + 1);
  return [...parLicence]
    .map(([licence, n]) => ({ licence, n }))
    .sort((a, b) => b.n - a.n || a.licence.localeCompare(b.licence, "fr"));
}

/** Ce qu'une recherche compare : nom, version, licence, rôle, usages. */
export function texteRecherche(c: Composant): string {
  return [c.nom, c.version, c.licence, c.role, c.note, TYPE_LIBELLE[c.type], ...c.utilisePar.map((u) => u.nom)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
