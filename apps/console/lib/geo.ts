// Ce que « pays » veut dire à l'écran (P8.7) — logique PURE, sans accès base.
//
// ═══════════════════ POURQUOI CE MODULE EXISTE ═══════════════════════════════
//
// Un pays affiché sans sa provenance est un chiffre dont personne ne sait ce
// qu'il mesure. Depuis la migration v85, `rum_session.geo_country` peut venir de
// trois endroits qui ne valent pas la même chose, et l'historique antérieur n'en
// déclare aucun. Les libellés sont réunis ici pour que l'écran, l'API, le
// catalogue MCP et la documentation disent LA MÊME PHRASE — c'est déjà ce que le
// dépôt a payé une fois, quand les mentions légales ont déclaré un hébergeur
// pendant douze jours après en avoir changé.
//
// ═══════════════════ CE QUE LA MESURE VAUT, ET CE QU'ELLE NE VAUT PAS ════════
//
// Aucune des trois provenances ne localise une personne :
//   · une base IP→pays situe une ADRESSE, le plus souvent celle d'un opérateur,
//     d'un relais d'entreprise ou d'un VPN. Un télétravailleur derrière le VPN
//     de son employeur est classé au pays de la sortie du VPN, pas au sien ;
//   · un fuseau horaire est un RÉGLAGE du terminal, que la personne choisit, et
//     une zone couvre souvent plusieurs pays ;
//   · un en-tête de CDN est la même résolution d'adresse, faite chez un tiers.
//
// C'est pourquoi le libellé de la dimension reste « Pays estimé », partout, et
// n'a jamais été « Pays ».

/** Provenance d'un `geo_country`. `null` = inconnue (tout l'historique avant v85). */
export const GEO_SOURCES = ["geoip", "timezone", "cdn"] as const;
export type GeoSource = (typeof GEO_SOURCES)[number];

export const GEO_SOURCE_LABELS: Record<GeoSource, string> = {
  geoip: "Base IP→pays locale",
  timezone: "Fuseau horaire du terminal",
  cdn: "En-tête pays du CDN",
};

/** Ce que chaque provenance vaut, en une phrase, pour une infobulle ou une note. */
export const GEO_SOURCE_NOTICES: Record<GeoSource, string> = {
  geoip:
    "Pays de l'adresse réseau par laquelle la mesure est arrivée, résolu dans une base locale sans qu'aucune adresse " +
    "ne sorte ni ne soit stockée. Une adresse est souvent celle d'un opérateur, d'un relais d'entreprise ou d'un VPN : " +
    "ce n'est pas la position d'une personne.",
  timezone:
    "Pays déduit du fuseau horaire déclaré par le terminal. C'est un réglage, que la personne choisit, et une zone " +
    "couvre souvent plusieurs pays.",
  cdn:
    "Pays posé par le CDN placé devant l'ingestion, à partir de l'adresse réseau. Même nature qu'une base locale, " +
    "mais la résolution a eu lieu chez un tiers.",
};

/** Libellé affichable d'une provenance, `null` compris. Jamais une valeur par défaut. */
export function geoSourceLabel(source: string | null | undefined): string {
  if (!source) return "Inconnue";
  return GEO_SOURCE_LABELS[source as GeoSource] ?? "Inconnue";
}

/**
 * Note affichée partout où un pays est rendu. Elle ne promet pas une
 * géolocalisation, et elle nomme les trois provenances possibles pour qu'un
 * chiffre agrégé ne soit pas lu comme s'il n'en avait qu'une.
 */
export const GEO_NOTICE =
  "Pays ESTIMÉ, jamais une géolocalisation. Selon la session, il vient d'une base IP→pays locale, du fuseau horaire " +
  "du terminal ou d'un en-tête de CDN — et « Inconnue » pour les sessions antérieures à la collecte de cette " +
  "provenance. Aucune adresse IP n'est stockée ; une adresse situe un réseau, pas une personne.";
