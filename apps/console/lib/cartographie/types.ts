// La cartographie du graphe technique (/presentation/graphe-technique, 30/09/2026) :
// tout MIP RUM sur une seule carte qu'on explore — des capteurs chez le client
// jusqu'à la console, avec la base et ses tables, les travaux planifiés, la sécurité,
// les tests et le déploiement.
//
// Ce module ne porte que la FORME : familles (le code couleur), natures de liens,
// éléments, zones, parcours guidés. Le contenu est dans ./donnees.ts, et chaque fait
// y cite sa source (`fichier:ligne`) : tests/unit/cartographie.test.ts vérifie que la
// source existe, et confronte les listes (tables, services, workflows…) au dépôt.

/** Le code couleur de la carte : une famille par élément. */
export type Famille =
  | "client"
  | "capteur"
  | "mesure"
  | "service"
  | "donnees"
  | "interface"
  | "securite"
  | "qualite"
  | "externe";

export interface DefinitionFamille {
  libelle: string;
  /** Pour la légende : ce que la couleur désigne, en quelques mots. */
  explication: string;
  couleur: string;
}

export const FAMILLES: Record<Famille, DefinitionFamille> = {
  client: { libelle: "Chez le client", explication: "son serveur, ses navigateurs", couleur: "#94a3b8" },
  capteur: { libelle: "Capteurs", explication: "ce qui mesure", couleur: "#f89101" },
  mesure: { libelle: "Mesures", explication: "ce qui circule", couleur: "#fbbc64" },
  service: { libelle: "Services", explication: "ce qui reçoit, traite et planifie", couleur: "#38bdf8" },
  donnees: { libelle: "Données", explication: "la base et ses tables", couleur: "#34d399" },
  interface: { libelle: "Interfaces", explication: "console, API, MCP", couleur: "#a78bfa" },
  securite: { libelle: "Sécurité", explication: "ce qui protège", couleur: "#fb7185" },
  qualite: { libelle: "Tests et CI", explication: "ce qui vérifie et déploie", couleur: "#a3e635" },
  externe: { libelle: "Tiers", explication: "utilisateurs et services externes", couleur: "#cbd5e1" },
};

export const ORDRE_FAMILLES: readonly Famille[] = [
  "client",
  "capteur",
  "mesure",
  "service",
  "donnees",
  "interface",
  "securite",
  "qualite",
  "externe",
];

/** Ce qu'un lien transporte ou signifie. */
export type Nature = "embarque" | "mesure" | "appel" | "ecrit" | "lit" | "declenche" | "protege" | "verifie" | "deploie";

export interface DefinitionNature {
  libelle: string;
  couleur: string;
  /** Un flux (animé) plutôt qu'une relation (pointillés fixes). */
  flux: boolean;
  pointille?: string;
}

export const NATURES: Record<Nature, DefinitionNature> = {
  embarque: { libelle: "embarque", couleur: "#94a3b8", flux: false, pointille: "1 5" },
  mesure: { libelle: "envoie des mesures", couleur: "#f89101", flux: true },
  appel: { libelle: "appelle", couleur: "#38bdf8", flux: true },
  ecrit: { libelle: "écrit", couleur: "#34d399", flux: true },
  lit: { libelle: "lit", couleur: "#a78bfa", flux: false },
  declenche: { libelle: "déclenche", couleur: "#fbbc64", flux: true },
  protege: { libelle: "protège", couleur: "#fb7185", flux: false, pointille: "2 5" },
  verifie: { libelle: "vérifie", couleur: "#a3e635", flux: false, pointille: "2 5" },
  deploie: { libelle: "déploie", couleur: "#cbd5e1", flux: false, pointille: "8 6" },
};

export type Statut = "en-service" | "option" | "pilote" | "drapeau" | "archive" | "prevu";

export const STATUTS: Record<Statut, string> = {
  "en-service": "en service",
  option: "sur option",
  pilote: "en pilote",
  drapeau: "éteint par un drapeau",
  archive: "archivé",
  prevu: "prévu",
};

/** Un fait vérifiable : une phrase, et d'où elle vient dans le dépôt. */
export interface Fait {
  texte: string;
  /** `chemin/du/fichier.ts:12` ou `chemin/du/fichier.ts:12-18` ; un chemin seul désigne le fichier. */
  sources: readonly string[];
}

/** Une ligne d'une liste détaillée (les tables d'un domaine, les outils MCP…). */
export interface Entree {
  nom: string;
  role: string;
}

export type ZoneId = "client" | "capteurs" | "railway" | "neon" | "vercel" | "github";

export interface Zone {
  id: ZoneId;
  titre: string;
  /** L'hébergeur et son lieu, ou ce que la zone regroupe. */
  sousTitre: string;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export interface Element {
  id: string;
  famille: Famille;
  /** La zone qui l'entoure ; aucune pour un tiers (utilisateurs, services externes). */
  zone?: ZoneId;
  titre: string;
  /** Une ligne sous le titre, lisible de loin. */
  sousTitre: string;
  /** Ce que c'est, en une phrase simple. */
  resume: string;
  /** Deux à six mots-clés ou chiffres, en pastilles sur la carte. */
  etiquettes?: readonly string[];
  faits: readonly Fait[];
  statut?: Statut;
  /** Une liste détaillée, montrée de près et dans le panneau. */
  liste?: { titre: string; entrees: readonly Entree[] };
  /** Position du coin haut-gauche, en unités de la carte. */
  x: number;
  y: number;
  /** Largeur de la carte (260 par défaut). */
  largeur?: number;
  /** Hauteur réservée (128 par défaut) : une liste la demande plus grande. */
  hauteur?: number;
}

export interface Lien {
  de: string;
  vers: string;
  nature: Nature;
  /** Ce qui circule, en quelques mots (montré quand le lien est mis en avant). */
  libelle?: string;
}

export interface EtapeParcours {
  titre: string;
  texte: string;
  /** Les éléments mis en avant ; la vue se cadre sur eux. */
  elements: readonly string[];
}

export interface Parcours {
  id: string;
  titre: string;
  resume: string;
  etapes: readonly EtapeParcours[];
}

export interface Cartographie {
  zones: readonly Zone[];
  elements: readonly Element[];
  liens: readonly Lien[];
  parcours: readonly Parcours[];
  /** La date du relevé : la carte dit quand elle a été confrontée au dépôt. */
  releveeLe: string;
}

export const LARGEUR_ELEMENT = 260;
export const HAUTEUR_ELEMENT = 128;

/** L'adresse d'une source sur le dépôt public, à la ligne près. */
export function adresseSource(source: string, depot: string): string {
  const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(source);
  if (!m) return depot;
  const [, chemin, debut, fin] = m;
  const ancre = debut ? `#L${debut}${fin ? `-L${fin}` : ""}` : "";
  return `${depot}/blob/master/${chemin}${ancre}`;
}

/** L'identifiant d'un lien, stable : deux éléments ne sont reliés qu'une fois par nature. */
export const idLien = (l: Lien) => `${l.de}→${l.vers}:${l.nature}`;
