// La zone Neon de la carte : la base elle-même, ses protections, ses fonctions, puis
// ses domaines de tables, rangés en colonnes (chaque carte va dans la colonne la
// moins haute). Les tables et leur rôle sont dans ./base.ts.
import { DOMAINES } from "./base";
import type { Element, Zone } from "./types";

const SQL = "packages/db/sql";

export const LARGEUR_DOMAINE = 310;
const COLONNES = 4;
const ECART = 26;
const HAUT_ZONE = 1560;
const X_ZONE = 1100;
const MARGE = 40;
/** La place du titre de la zone, au-dessus des cartes. */
const ENTETE = 130;

/** La hauteur d'une carte qui montre sa liste : l'en-tête, puis une ligne par entrée. */
export const hauteurListe = (n: number) => Math.max(128, Math.ceil(100 + n * 16.5 + 14));

const TETE: readonly Omit<Element, "x" | "y">[] = [
  {
    id: "base",
    famille: "donnees",
    zone: "neon",
    titre: "PostgreSQL",
    sousTitre: "une seule base · 70 tables",
    resume:
      "Toutes les données de MIP RUM vivent dans une base PostgreSQL hébergée par Neon : les mesures brutes, les agrégats, les comptes, les alertes. Aucune autre base, aucun autre stockage.",
    etiquettes: ["70 tables", "migration v107", "RLS partout"],
    faits: [
      { texte: "70 tables, créées par schema.sql puis 99 migrations additives, jusqu'à la v107.", sources: [`${SQL}/schema.sql`, `${SQL}/migration-v107.sql`] },
      { texte: "Une migration fusionnée ne se modifie plus ; seul le scheduler migre, au pré-déploiement.", sources: ["scripts/ci/migrations-figees.mjs", "packages/db/migrate.mjs:101"] },
      { texte: "Neon est payé à l'usage depuis le 27/09/2026 : chaque réveil de la base se paie.", sources: ["AGENTS.md:127-129"] },
    ],
  },
  {
    id: "base-securite",
    famille: "securite",
    zone: "neon",
    titre: "Rôles, RLS et hachage",
    sousTitre: "ce que la base protège elle-même",
    resume:
      "La sécurité posée dans la base : Row Level Security sur toutes les tables, un rôle en lecture seule pour l'API, des fonctions privilégiées verrouillées, et tout secret stocké haché.",
    etiquettes: ["RLS", "mip_api lecture seule", "SHA-256 · bcrypt · HMAC"],
    faits: [
      { texte: "Row Level Security activée sur toutes les tables ; la dernière qui manquait corrigée en v97.", sources: [`${SQL}/migration-v10.sql`, `${SQL}/migration-v97.sql`] },
      { texte: "Rôle mip_api : lecture seule, 28 tables et vues en liste blanche, requêtes bornées à 15 s.", sources: ["packages/db/roles/mip-api.mjs:120", `${SQL}/migration-v89.sql:1`] },
      { texte: "Fonctions privilégiées : search_path figé, exécution retirée à PUBLIC.", sources: [`${SQL}/migration-v11.sql`] },
      { texte: "Aucune adresse IP stockée : celles du journal d'audit retirées en v96.", sources: [`${SQL}/migration-v96.sql:9-19`] },
    ],
  },
  {
    id: "base-fonctions",
    famille: "donnees",
    zone: "neon",
    titre: "Fonctions et vues",
    sousTitre: "74 fonctions · 10 vues · déclencheurs",
    resume:
      "Le calcul qui vit dans la base : purge, agrégats, alertes, sondes, effacement RGPD, normalisation des routes. Le scheduler les appelle ; des déclencheurs normalisent chaque insertion.",
    etiquettes: ["purge_rum_tenants", "check_alerts", "erase_app_data"],
    faits: [
      { texte: "Purge quotidienne à la rétention de chaque application, 30 jours par défaut.", sources: [`${SQL}/migration-v14.sql:9-11`] },
      { texte: "Un déclencheur normalise la route avant chaque insertion, dans 11 tables.", sources: [`${SQL}/migration-v62.sql:101`] },
      { texte: "Aucune extension Postgres requise : les blocs pg_cron hérités sont sautés sur Neon.", sources: ["services/README.md:84-85"] },
    ],
  },
];

/** La zone Neon et ses éléments, disposés en colonnes. */
export function disposerNeon(): { zone: Zone; elements: Element[] } {
  const cartes: Omit<Element, "x" | "y">[] = [
    ...TETE,
    ...DOMAINES.map(
      (d): Omit<Element, "x" | "y"> => ({
        id: d.id,
        famille: "donnees",
        zone: "neon",
        titre: d.titre,
        sousTitre: d.sousTitre,
        resume: d.resume,
        faits: d.faits,
        liste: { titre: "Tables", entrees: d.tables },
        hauteur: hauteurListe(d.tables.length),
      }),
    ),
  ];
  const hauts = Array.from({ length: COLONNES }, () => HAUT_ZONE + ENTETE);
  const elements = cartes.map((c) => {
    const col = hauts.indexOf(Math.min(...hauts));
    const e: Element = { ...c, largeur: LARGEUR_DOMAINE, x: X_ZONE + MARGE + col * (LARGEUR_DOMAINE + ECART), y: hauts[col] };
    hauts[col] += (c.hauteur ?? 128) + ECART;
    return e;
  });
  const bas = Math.max(...hauts) - ECART + MARGE;
  return {
    zone: {
      id: "neon",
      titre: "Neon",
      sousTitre: "PostgreSQL · la base",
      x: X_ZONE,
      y: HAUT_ZONE,
      largeur: MARGE * 2 + COLONNES * LARGEUR_DOMAINE + (COLONNES - 1) * ECART,
      hauteur: bas - HAUT_ZONE,
    },
    elements,
  };
}
