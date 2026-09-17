// Vue des ressources (P6.3) — logique PURE, testée, sans accès base.
//
// CE QUI EST MESURÉ, ET CE QUI NE L'EST PAS. Le SDK n'émet une ressource que si
// elle dépasse son seuil de lenteur OU bloque le rendu, et il en garde au plus
// vingt par page (packages/rum-sdk/src/resources.ts). La vue n'est donc PAS un
// inventaire du réseau : c'est un échantillon volontairement biaisé vers le lent.
// L'avertissement accompagne chaque total ; aucun chiffre n'est extrapolé.
//
// PREMIÈRE OU TIERCE PARTIE, SANS AUCUN APPEL SORTANT. Le partage se lit sur les
// origines DÉCLARÉES de l'application (`app_registry.allowed_origins`), comparées
// à l'hôte extrait de l'URL déjà collectée. Le serveur ne résout, ne contacte et
// ne récupère jamais une URL de ressource : une URL hostile ne déclenche rien.

export const RESOURCE_CAP = 15;

/** Part de l'origine d'une ressource par rapport à l'application mesurée. */
export type ResourceParty = "first" | "third" | "unknown";

export const PARTY_LABELS: Record<ResourceParty, string> = {
  first: "Première partie",
  third: "Tierce partie",
  unknown: "Origine non classable",
};

export const PARTY_HINTS: Record<ResourceParty, string> = {
  first: "Hôte déclaré dans les origines autorisées de l'application.",
  third: "Hôte absent des origines déclarées : CDN, régie, police de caractères, service tiers.",
  unknown:
    "Aucune origine déclarée pour l'application, ou URL sans hôte lisible (donnée en ligne, chemin relatif). Le partage n'est pas calculable pour ces lignes.",
};

export const RESOURCE_THRESHOLD_NOTICE =
  "Ressources collectées selon le seuil du SDK : une ressource n'est envoyée que si elle dépasse le seuil de lenteur configuré (300 ms par défaut) ou si elle bloque le rendu, et au plus vingt par page vue. Ces chiffres décrivent donc les ressources RETENUES, pas tout le trafic réseau — et ne sont pas extrapolés.";

/**
 * Hôte d'une origine déclarée : minuscules, sans schéma, sans identifiants et
 * sans port. Le port est retiré des DEUX côtés de la comparaison, de sorte que
 * `http://localhost:8080` reconnaisse une ressource servie sur un autre port du
 * même hôte — ce qui est le cas en développement.
 */
export function hostOfOrigin(origin: string): string | null {
  const host = origin
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "");
  return host || null;
}

/** Hôtes distincts déclarés par une application, triés. */
export function hostsFromOrigins(origins: readonly string[] | null | undefined): string[] {
  const hosts = new Set<string>();
  for (const origin of origins ?? []) {
    const host = hostOfOrigin(origin);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

/**
 * Les origines déclarées, mises à plat en couples (app, hôte) pour être liées en
 * DEUX tableaux parallèles dans le SQL. La normalisation reste écrite ICI, une
 * seule fois : la répéter en expression régulière PostgreSQL ferait deux règles
 * qui dérivent l'une de l'autre au premier cas limite.
 */
export function declaredHostPairs(
  apps: readonly { app_id: string; allowed_origins: string[] | null }[],
): { apps: string[]; hosts: string[] } {
  const paires = { apps: [] as string[], hosts: [] as string[] };
  for (const app of apps) {
    for (const host of hostsFromOrigins(app.allowed_origins)) {
      paires.apps.push(app.app_id);
      paires.hosts.push(host);
    }
  }
  return paires;
}

/** Octets lisibles : ko/Mo à une décimale, jamais un nombre brut de 9 chiffres. */
export function fmtOctets(octets: number): string {
  if (octets < 1024) return `${Math.round(octets)} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
