// Les pages publiques des trois parcours d'installation (/presentation/installation/…),
// refondues le 30/09/2026 : plus de check-list (elle vit dans la console, sur
// /installer, aux valeurs de l'application), mais une phrase, l'essentiel en quelques
// chiffres, puis un tutoriel animé qui montre l'installation assistée par IA.
//
// Chaque chiffre se vérifie : les poids sont ceux des fichiers servis par la console
// (tests/unit/installation-faits.test.ts les remesure), le budget du SDK est celui que
// `packages/rum-sdk/build.mjs` fait respecter, les langages sont ceux des recettes
// (lib/recettes-agents-otel.ts), le reste suit docs/INTEGRATION.md (§ 2, § 3, annexe H).
import type { Parcours } from "./installer";
import { recettesAgentsOtel } from "./recettes-agents-otel";

export interface Fait {
  /** Ce qui se lit en gros : un chiffre ou deux mots. */
  valeur: string;
  libelle: string;
}

export type VueTutoriel = "installer" | "copier" | "ia" | "verifier" | "resultat";

export interface EtapeTutoriel {
  nom: VueTutoriel;
  onglet: string;
  titre: string;
  texte: string;
  chemin: string;
}

export interface FicheParcours {
  /** L'installation, d'un point de vue haut, en une phrase. */
  accroche: string;
  faits: readonly Fait[];
  etapes: readonly EtapeTutoriel[];
}

/** Poids gzip, en Kio, des fichiers servis (remesurés par le test). */
export const POIDS_KO = { sdk: 22.6, rejeu: 56.7, extension: 82 } as const;
/** Le budget du cœur du SDK, que son build refuse de dépasser. */
export const BUDGET_SDK_KO = 35;

const ko = (n: number) => `${String(n).replace(".", ",")} Ko`;

const LANGAGES_EPROUVES = recettesAgentsOtel({ appId: "x", adresses: { traces: "", logs: "" } }).agents.length;

/** Les deux premières étapes, communes : la console, puis le prompt. */
const debut = (onglet: string, chemin: string): EtapeTutoriel[] => [
  {
    nom: "installer",
    onglet: "Installer",
    titre: "Dans la console, ouvrez Installer.",
    texte: `Choisissez votre application, puis l'onglet ${onglet} : tout y est déjà rempli à ses valeurs.`,
    chemin,
  },
  {
    nom: "copier",
    onglet: "Prompt",
    titre: "Copiez le prompt pour votre IA.",
    texte: "Un clic : les instructions, les codes et les valeurs de votre application. Jamais la clé d'API.",
    chemin,
  },
];

export const FICHES: Record<Parcours, FicheParcours> = {
  snippet: {
    accroche:
      "Un script à poser dans le <head> de vos pages, et chaque visiteur est mesuré — votre IA de code s'en charge à partir d'un prompt copié dans la console.",
    faits: [
      { valeur: ko(POIDS_KO.sdk), libelle: `gzip, sous un budget de ${BUDGET_SDK_KO} Ko que chaque build fait respecter` },
      { valeur: "0 dépendance", libelle: "un seul fichier, servi par MIP ou par votre domaine" },
      { valeur: "4 mesures", libelle: "Web Vitals, erreurs, sessions et appels réseau, sans rien coder de plus" },
      { valeur: "0 blocage", libelle: "envoi par lots en arrière-plan ; le rejeu de session, optionnel, se charge à part" },
    ],
    etapes: [
      ...debut("SDK JavaScript", "/installer#snippet"),
      {
        nom: "ia",
        onglet: "Votre IA",
        titre: "Votre IA l'installe.",
        texte: "Elle repère la pile, pose le SDK dans le bon gabarit, met la CSP à jour, et vous demande la clé.",
        chemin: "votre projet",
      },
      {
        nom: "verifier",
        onglet: "Vérifier",
        titre: "Mettez en ligne : ça arrive.",
        texte: "La page Installer vérifie en direct : les cases passent au vert avec les premières Web Vitals.",
        chemin: "/installer#snippet",
      },
      {
        nom: "resultat",
        onglet: "Mesurer",
        titre: "Vos vrais visiteurs, mesurés.",
        texte: "La santé du site, page par page, dès les premières visites.",
        chemin: "/",
      },
    ],
  },
  extension: {
    accroche:
      "Sans toucher au site : l'extension, déployée par votre service informatique, mesure les postes équipés — le prompt de la console traduit sa stratégie pour votre outil de parc.",
    faits: [
      { valeur: "Chrome · Edge", libelle: "Manifest V3, sur les postes gérés" },
      { valeur: "0 ligne", libelle: "de code du site modifiée : elle injecte le même SDK" },
      { valeur: "0 clé", libelle: "embarquée : c'est le domaine enregistré qui ouvre la collecte" },
      { valeur: ko(POIDS_KO.extension), libelle: "l'archive, déployée par GPO, Intune ou Google Admin" },
    ],
    etapes: [
      ...debut("Extension navigateur", "/installer#extension"),
      {
        nom: "ia",
        onglet: "Votre IA",
        titre: "Votre IA prépare le déploiement.",
        texte: "Elle traduit la stratégie pour votre outil de parc, domaines accordés d'avance, postes nommés.",
        chemin: "votre outil de parc",
      },
      {
        nom: "verifier",
        onglet: "Vérifier",
        titre: "Un poste équipé : ça arrive.",
        texte: "Le battement du poste, puis ses premières mesures : les cases passent au vert.",
        chemin: "/installer#extension",
      },
      {
        nom: "resultat",
        onglet: "Mesurer",
        titre: "Les postes, mesurés sans toucher au site.",
        texte: "Sur chaque domaine enregistré, l'extension observe ; ailleurs, rien.",
        chemin: "boutique.exemple.fr",
      },
    ],
  },
  serveur: {
    accroche:
      "L'agent OpenTelemetry officiel de votre langage, réglé par quelques variables : chaque appel du navigateur est suivi jusqu'au serveur — votre IA de code l'installe à partir du prompt de la console.",
    faits: [
      { valeur: "0 code MIP", libelle: "l'agent OpenTelemetry officiel, rien de propriétaire" },
      { valeur: `${LANGAGES_EPROUVES} langages`, libelle: "éprouvés en production : Python, Node.js, Java, .NET" },
      { valeur: "OTLP/HTTP", libelle: "traces et journaux, en protobuf ou en JSON" },
      { valeur: "traceparent", libelle: "l'en-tête qui relie chaque appel du navigateur à sa part serveur" },
    ],
    etapes: [
      ...debut("Serveur", "/installer#serveur"),
      {
        nom: "ia",
        onglet: "Votre IA",
        titre: "Votre IA branche l'agent.",
        texte: "Elle trouve comment le service démarre, le lance sous l'agent, et range la clé dans les secrets.",
        chemin: "votre projet",
      },
      {
        nom: "verifier",
        onglet: "Vérifier",
        titre: "Relancez : ça arrive.",
        texte: "Les premiers temps serveur, puis les appels reliés à leur part serveur : tout passe au vert.",
        chemin: "/installer#serveur",
      },
      {
        nom: "resultat",
        onglet: "Localiser",
        titre: "La lenteur, localisée.",
        texte: "Un appel lent, décomposé : le serveur d'un côté, le trajet de l'autre.",
        chemin: "/tracing",
      },
    ],
  },
};
