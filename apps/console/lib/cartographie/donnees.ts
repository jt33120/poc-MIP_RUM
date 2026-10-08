// La cartographie assemblée : les zones, puis les éléments et les liens de chaque
// partie. La disposition suit le chemin d'une mesure, de haut en bas : chez le
// client, les capteurs et leurs mesures, puis trois colonnes (Railway, Neon, Vercel),
// et enfin le dépôt, les tests et le déploiement.
//
// CHIFFRES : les nombres que la carte affiche et que tests/unit/cartographie.test.ts
// recompte dans le dépôt. Un service, une table ou un écran de plus fait échouer le
// test, pour que la carte suive.
import { TABLES_CARTE } from "./base";
import { ELEMENTS_CAPTEURS, ELEMENTS_CLIENT, ELEMENTS_MESURES, LIENS_CAPTEURS } from "./capteurs";
import { ELEMENTS_RAILWAY_LECTURE, ELEMENTS_TIERS_LECTURE, ELEMENTS_VERCEL, LIENS_LECTURE } from "./lecture";
import { disposerNeon } from "./neon";
import { PARCOURS } from "./parcours";
import { ELEMENTS_GITHUB, FICHIERS_DE_TESTS, LIENS_QUALITE } from "./qualite";
import { ELEMENTS_RAILWAY_TRAITEMENT, ELEMENTS_TIERS_TRAITEMENT, LIENS_TRAITEMENT } from "./traitement";
import type { Cartographie, Lien, Zone } from "./types";

export const CHIFFRES = {
  tables: 71,
  derniereMigration: 110,
  outilsMcp: 23,
  ecrans: 54,
  routesApiV1: 32,
  operationsConsoleApi: 118,
  fichiersDeTests: FICHIERS_DE_TESTS,
} as const;

const neon = disposerNeon();

const LARGEUR = 3600;

const ZONES: readonly Zone[] = [
  { id: "client", titre: "Chez le client", sousTitre: "son serveur, les navigateurs de ses visiteurs", x: 0, y: 0, largeur: LARGEUR, hauteur: 330 },
  { id: "capteurs", titre: "Capteurs et mesures", sousTitre: "ce qui mesure, et ce qui en part", x: 0, y: 420, largeur: LARGEUR, hauteur: 680 },
  { id: "railway", titre: "Railway", sousTitre: "réception, traitement, lecture · Amsterdam", x: 0, y: 1260, largeur: 1000, hauteur: 1620 },
  neon.zone,
  { id: "vercel", titre: "Vercel", sousTitre: "la console · Francfort", x: 2600, y: 1260, largeur: 1000, hauteur: 1620 },
  { id: "github", titre: "GitHub", sousTitre: "le dépôt, les tests, le déploiement", x: 0, y: 2980, largeur: LARGEUR, hauteur: 480 },
];

/**
 * Chaque mesure va au collector en direct depuis le 06/10/2026 ; seul le battement du
 * parc d'extensions passe encore par la console.
 */
const VERS_RECEPTION: readonly Lien[] = ELEMENTS_MESURES.map((m) => ({
  de: m.id,
  vers: m.id === "m-parc" ? "reception" : "collector",
  nature: "mesure" as const,
  libelle: m.id === "m-journaux" ? "OTLP/HTTP · /v1/logs" : m.id === "m-rejeu" ? "/v1/replay" : m.id === "m-parc" ? "/api/extension/*" : "OTLP/HTTP · /v1/traces",
}));

/** Les liens qui traversent les parties : réception, écrans et services vers la base. */
const LIENS_CROISES: readonly Lien[] = [
  { de: "reception", vers: "collector", nature: "appel", libelle: "relais pur, ancienne adresse" },
  { de: "console", vers: "reception", nature: "embarque" },
  { de: "console", vers: "console-ecrans", nature: "embarque" },
  { de: "console", vers: "api-v1", nature: "embarque" },
  { de: "s-porte-console", vers: "console-ecrans", nature: "protege" },
  { de: "s-porte-console", vers: "console-auth", nature: "protege" },
  { de: "s-jetons", vers: "api-v1", nature: "protege" },
  { de: "s-jetons", vers: "api", nature: "protege" },
  { de: "console-ecrans", vers: "base", nature: "lit", libelle: "chargeurs : accès direct" },
  { de: "api-v1", vers: "base", nature: "lit", libelle: "lectures à la session, et repli" },
  { de: "console-commandes", vers: "base-espace", nature: "ecrit", libelle: "tableaux, vues, objectifs" },
  { de: "console-commandes", vers: "base-alertes", nature: "ecrit", libelle: "règles, canaux, SLO" },
  { de: "console-commandes", vers: "base-applications", nature: "ecrit", libelle: "applications, clés, origines" },
  { de: "console-commandes", vers: "base-rgpd", nature: "ecrit", libelle: "audit, effacements" },
  { de: "console-commandes", vers: "base-comptes", nature: "ecrit", libelle: "comptes, jetons" },
  { de: "console-api", vers: "base-comptes", nature: "ecrit", libelle: "sessions, compteurs de connexion" },
  { de: "console-api", vers: "base", nature: "lit" },
  { de: "api", vers: "base", nature: "lit", libelle: "rôle mip_api, lecture seule" },
  { de: "base-securite", vers: "base", nature: "protege" },
  { de: "base-fonctions", vers: "base", nature: "embarque", libelle: "dans la base" },
];

export const CARTOGRAPHIE: Cartographie = {
  releveeLe: "30/09/2026",
  zones: ZONES,
  elements: [
    ...ELEMENTS_CLIENT,
    ...ELEMENTS_CAPTEURS,
    ...ELEMENTS_MESURES,
    ...ELEMENTS_RAILWAY_TRAITEMENT,
    ...ELEMENTS_RAILWAY_LECTURE,
    ...neon.elements,
    ...ELEMENTS_VERCEL,
    ...ELEMENTS_GITHUB,
    ...ELEMENTS_TIERS_TRAITEMENT,
    ...ELEMENTS_TIERS_LECTURE,
  ],
  liens: [...LIENS_CAPTEURS, ...VERS_RECEPTION, ...LIENS_TRAITEMENT, ...LIENS_LECTURE, ...LIENS_CROISES, ...LIENS_QUALITE],
  parcours: PARCOURS,
};

export { TABLES_CARTE };
