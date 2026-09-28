// Le chemin de la mesure (PS3) et l'hébergement (PS4) de la vitrine — données PURES.
//
// L'HÉBERGEMENT N'EST PAS RETAPÉ ICI. Société, région, ville et pays sont LUS dans
// les phrases `HOSTS` de lib/legal.ts : celles que sert /legal/confidentialite et
// que reprennent les Specs (lib/specs.ts). Une vitrine qui dirait « Francfort »
// quand la politique de confidentialité dit autre chose ferait une déclaration
// inexacte ; le dépôt l'a déjà vécu (« Supabase / Paris » douze jours après Neon).
// `lireHebergeur` découpe la phrase ; tests/unit/presentation-topologie.test.ts
// échoue si elle cesse de se découper. Sans découpage, la vitrine montre la phrase
// entière plutôt que d'en inventer un morceau.
//
// LES FAITS D'EXPLOITATION PORTENT LEUR DATE. Ils viennent de
// docs/TOPOLOGIE_BACKEND.md et des §§ 2-3 du document de couverture
// (docs/RUM_PARITY_STATUS.md), qui ne les a pas revérifiés en direct : la vitrine
// dit donc QUAND ils ont été relevés, jamais « aujourd'hui ». Le test vérifie que
// chaque date citée ici se lit encore dans ces deux documents.
import { HOSTS } from "./legal";

/** Ce que la phrase d'un hébergeur de lib/legal.ts permet d'en dire. */
export interface Hebergeur {
  /** La phrase de lib/legal.ts, telle quelle. */
  phrase: string;
  /** « Neon », « Vercel Inc. », « Railway Corp. » : ce qui précède la parenthèse. */
  societe: string;
  /** Premier mot de la société, pour le dessin : « Neon », « Vercel », « Railway ». */
  marque: string;
  /** « AWS » quand la phrase dit sur quelle infrastructure l'hébergeur repose. */
  infrastructure: string | null;
  /** Région, ville et pays ; null si la phrase ne se découpe plus (le test le signale). */
  lieu: { region: string; ville: string; pays: string } | null;
}

const SOCIETE = /^([^(]+?) \(/;
// « … région fra1 — Francfort, Allemagne) » ou « … région europe-west4, Amsterdam, Pays-Bas) »
const LIEU = /région ([a-z0-9-]+)(?: —|,) ([^,()]+), ([^,()]+)\)$/;
const INFRASTRUCTURE = /sur infrastructure ([A-Z][A-Za-z0-9]*)\b/;

/** Découpe une phrase `HOSTS` ; ce qui ne se découpe pas reste null, jamais deviné. */
export function lireHebergeur(phrase: string): Hebergeur {
  const societe = SOCIETE.exec(phrase)?.[1].trim() ?? phrase;
  const lieu = LIEU.exec(phrase);
  return {
    phrase,
    societe,
    marque: societe.split(" ")[0],
    infrastructure: INFRASTRUCTURE.exec(phrase)?.[1] ?? null,
    lieu: lieu ? { region: lieu[1], ville: lieu[2].trim(), pays: lieu[3].trim() } : null,
  };
}

/** Les trois hébergeurs, dans l'ordre de lib/legal.ts. */
export const HEBERGEURS = {
  base: lireHebergeur(HOSTS.data),
  console: lireHebergeur(HOSTS.app),
  railway: lireHebergeur(HOSTS.backend),
} as const;

/**
 * Droit dont relèvent les trois sociétés. Source : lib/specs.ts, ligne
 * « Souveraineté » (« Neon, Vercel et Railway sont trois sociétés de droit
 * américain ») ; le test vérifie que la ligne le dit toujours.
 */
export const DROIT_HEBERGEURS = "américain";

/**
 * « Francfort, Allemagne » ; la phrase entière si elle ne se découpe plus. Le code de
 * région de l'hébergeur (« fra1 ») n'est pas dans le tableau de la présentation, lu par
 * une DSI (recette du 26/09/2026) : il reste dans l'alternative du chemin de la mesure,
 * au dossier technique, pour qui veut le vérifier.
 */
export function lieuTexte(h: Hebergeur): string {
  return h.lieu ? `${h.lieu.ville}, ${h.lieu.pays}` : h.phrase;
}

/** « Neon (sur AWS) », « Vercel Inc. ». */
export function hebergeurTexte(h: Hebergeur): string {
  return h.infrastructure ? `${h.societe} (sur ${h.infrastructure})` : h.societe;
}

// ─────────────────────── PS4 — où sont les données ───────────────────────

export interface LigneHebergement {
  piece: string;
  hebergeur: string;
  lieu: string;
  droit: string;
}

// Relevé du 28/09/2026 : la console reçoit toujours toutes les mesures (les capteurs la
// visent), mais le collecteur qui écrit la part relayée tourne sur Railway, avec l'API,
// le backend de la console, le notifier, les travaux planifiés et le MCP.
export const HEBERGEMENT: readonly LigneHebergement[] = [
  { piece: "Base de données", h: HEBERGEURS.base },
  { piece: "Console et réception des mesures", h: HEBERGEURS.console },
  { piece: "Collecteur et services du backend", h: HEBERGEURS.railway },
].map(({ piece, h }) => ({ piece, hebergeur: hebergeurTexte(h), lieu: lieuTexte(h), droit: DROIT_HEBERGEURS }));

// ─────────────────────── PS3 — le chemin de la mesure ───────────────────────

/** Date de suppression du service Railway `ingest` (TOPOLOGIE_BACKEND.md:81-85 ; RUM_PARITY_STATUS.md:85, :103-106). */
export const INGEST_SUPPRIME_LE = "21/09/2026";

/**
 * Le `scheduler` applique les migrations au pré-déploiement : constaté dans les
 * journaux d'un vrai déploiement (TOPOLOGIE_BACKEND.md:75-79 ; RUM_PARITY_STATUS.md:86).
 */
export const MIGRATIONS_CONSTATEES = { le: "18/09/2026", deploiement: "03850b30" } as const;

/**
 * Quand la topologie a été relevée par les hébergeurs eux-mêmes : les API Railway et
 * Vercel le 18/09 (RUM_PARITY_STATUS.md:84-87), l'API Railway le 21/09 après la
 * suppression d'`ingest`, le 23/09 après la vague 8 (deux services), puis le 28/09
 * (TOPOLOGIE_BACKEND.md, « Relevé du 28/09/2026 ») : six services en ligne depuis
 * l'apply du 27/09, et la console qui relaie une part de la collecte au `collector`.
 * Vercel n'a pas été relevé par son API depuis le 18/09 : d'où les deux dates.
 */
export const TOPOLOGIE_RELEVEE = { railwayEtVercel: "18/09/2026", railway: "28/09/2026" } as const;

export type PieceId = "navigateur" | "console" | "collecteur" | "base" | "travaux" | "api" | "mcp";

/** Une pièce du chemin : une boîte du dessin, une ligne de l'alternative textuelle. */
export interface Piece {
  id: PieceId;
  /** Titre de la boîte (et en-tête de ligne de l'alternative). */
  titre: string;
  /** Lignes sous le titre. Un texte SVG ne revient pas à la ligne : le test borne leur longueur. */
  lignes: string[];
  /** Colonne « Hébergeur » de l'alternative. */
  hebergeur: string;
  /** Colonne « Région » ; null pour le poste du visiteur (« — »). */
  region: string | null;
  /** Colonne « Rôle ». */
  role: string;
}

const lieuCourt = (h: Hebergeur): string[] => (h.lieu ? [`${h.lieu.region} · ${h.lieu.ville}`] : []);
const regionAlt = (h: Hebergeur): string => (h.lieu ? `${h.lieu.region} — ${h.lieu.ville}, ${h.lieu.pays}` : h.phrase);

// Rôles : docs/TOPOLOGIE_BACKEND.md, « Les trois hébergeurs » et « Les services Railway
// en production » (relevé du 28/09/2026) ; E1 (API /api/v1) ; le relais : ce que la
// console transmet au collector, sans adresse (apps/console/lib/ingest-relay.ts,
// ENTETES_TRANSMIS) ; le MCP passe par le service `api` sur le réseau privé
// (.railway/railway.ts, MIP_API_HOST ; packages/mcp-tools/lib/client.mjs) ; travaux
// planifiés : services/scheduler/worker.mjs:8-10 ; D5 (purge de rétention).
// L'ordre est celui du dessin : le collecteur entre la console et la base, l'API
// au-dessus du MCP qu'elle sert. Le backend de la console (`console-api`) et le
// notifier ne sont pas sur le chemin de la mesure : les spécifications les décrivent.
export const PIECES: readonly Piece[] = [
  {
    id: "navigateur",
    titre: "Navigateur du visiteur",
    lignes: ["SDK web ou extension"],
    hebergeur: "poste du visiteur",
    region: null,
    role: "mesure et envoie en OTLP/HTTP JSON",
  },
  {
    id: "console",
    titre: `Console — ${HEBERGEURS.console.marque}`,
    lignes: [...lieuCourt(HEBERGEURS.console), "reçoit les mesures, en relaie", "une part, écrit le reste", "API de lecture /api/v1"],
    hebergeur: HEBERGEURS.console.societe,
    region: regionAlt(HEBERGEURS.console),
    role: "reçoit les mesures, en relaie une part au collecteur et écrit le reste ; sert la console et l'API",
  },
  {
    id: "collecteur",
    titre: `Collecteur — ${HEBERGEURS.railway.marque}`,
    lignes: [...lieuCourt(HEBERGEURS.railway), "pseudonymise, écrit en base"],
    hebergeur: HEBERGEURS.railway.societe,
    region: regionAlt(HEBERGEURS.railway),
    role: "reçoit la part relayée par la console, pseudonymise l'identité et l'écrit en base",
  },
  {
    id: "base",
    titre: `PostgreSQL — ${HEBERGEURS.base.marque}`,
    lignes: lieuCourt(HEBERGEURS.base),
    hebergeur: hebergeurTexte(HEBERGEURS.base),
    region: regionAlt(HEBERGEURS.base),
    role: "stocke les mesures",
  },
  {
    id: "travaux",
    titre: `Travaux planifiés — ${HEBERGEURS.railway.marque}`,
    lignes: [...lieuCourt(HEBERGEURS.railway), "migrations, alertes, SLO,", "sondes, purge"],
    hebergeur: HEBERGEURS.railway.societe,
    region: regionAlt(HEBERGEURS.railway),
    role: "migrations au pré-déploiement, alertes, SLO, sondes, purge",
  },
  {
    id: "api",
    titre: `API de lecture — ${HEBERGEURS.railway.marque}`,
    lignes: [...lieuCourt(HEBERGEURS.railway), "lecture seule, sur jeton"],
    hebergeur: HEBERGEURS.railway.societe,
    region: regionAlt(HEBERGEURS.railway),
    role: "sert l'API de lecture v1 au serveur MCP, sous un rôle de base en lecture seule",
  },
  {
    id: "mcp",
    titre: `Serveur MCP — ${HEBERGEURS.railway.marque}`,
    lignes: [...lieuCourt(HEBERGEURS.railway), "lecture seule, par l'API"],
    hebergeur: HEBERGEURS.railway.societe,
    region: regionAlt(HEBERGEURS.railway),
    role: "lit par l'API de lecture, sur le réseau privé, sans accès à la base",
  },
];

/** Une flèche du dessin : qui parle à qui, et par quoi. */
export interface Liaison {
  de: PieceId;
  vers: PieceId;
  /** Écrit le long de la flèche ; null quand la boîte le dit déjà. */
  libelle: string | null;
}

// Pas de flèche du serveur MCP vers la base : il n'y touche pas (ADR 0006). Les deux
// écritures de la mesure sont dessinées : la part relayée passe par le collecteur, le
// reste va de la console à la base, le long d'un rail sans place pour un libellé (la
// boîte de la console le dit). L'API de lecture rejoint la base par un second rail.
export const LIAISONS: readonly Liaison[] = [
  { de: "navigateur", vers: "console", libelle: "OTLP/HTTP JSON" },
  { de: "console", vers: "collecteur", libelle: "relais d'une part" },
  { de: "collecteur", vers: "base", libelle: "écrit" },
  { de: "console", vers: "base", libelle: null },
  { de: "travaux", vers: "base", libelle: null },
  { de: "api", vers: "base", libelle: null },
  { de: "mcp", vers: "api", libelle: "réseau privé" },
];

const aVille = (h: Hebergeur) => (h.lieu ? ` à ${h.lieu.ville}` : "");

/** `aria-label` du dessin (texte du plan § 8.2, PS3), composé depuis les mêmes hébergeurs. */
export const ARIA_TOPOLOGIE =
  `Chemin de la mesure : du navigateur à la console sur ${HEBERGEURS.console.marque}, ` +
  `qui en relaie une part au collecteur sur ${HEBERGEURS.railway.marque} et écrit le reste ` +
  `dans la base ${HEBERGEURS.base.marque}${aVille(HEBERGEURS.base)} ; ` +
  `travaux planifiés, API de lecture et serveur MCP sur ${HEBERGEURS.railway.marque}${aVille(HEBERGEURS.railway)}.`;
