// Résolution UNIQUE de l'endpoint d'ingestion — invariant AD-4 du spine d'architecture.
//
// POURQUOI CE FICHIER EXISTE. Quatre sites produisaient cette URL avec quatre replis
// différents : deux pointaient `nupxrdpsliqptqnjkmgw.supabase.co`, un projet Supabase
// décommissionné lors de la migration vers Neon ; un retombait sur `localhost:4318` ;
// le dernier codait en dur l'hôte de production. Un client onboardé recevait donc un
// snippet qui n'ingérait rien, sans erreur exploitable — le pire mode de défaillance
// possible sur un premier contact commercial.
//
// RÈGLE. Aucun hôte d'ingestion n'est écrit en dur ailleurs que dans ce fichier. En
// l'absence de configuration explicite, la résolution rend l'hôte courant — jamais un
// hôte tiers, jamais une valeur de développement.

/** Chemins des trois canaux d'ingestion servis par cette console. */
const PATHS = {
  traces: "/api/ingest/v1/traces",
  logs: "/api/ingest/v1/logs",
  replay: "/api/ingest/v1/replay",
} as const;

export type IngestSignal = keyof typeof PATHS;

/** http en local (y compris IPv6 ::1), https partout ailleurs. */
function protocolFor(host: string): "http" | "https" {
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) ? "http" : "https";
}

/**
 * Endpoint d'ingestion pour un canal donné.
 *
 * @param signal  canal visé — `traces`, `logs` ou `replay`.
 * @param host    hôte de la requête courante (`headers().get("host")`). À fournir dès
 *                qu'on est dans un contexte de requête : c'est le repli le plus juste,
 *                celui qui suit naturellement les previews et le self-host.
 *
 * Ordre de résolution :
 *   1. `NEXT_PUBLIC_RUM_ENDPOINT` — URL complète du canal traces ; les autres canaux en
 *      dérivent par substitution de chemin, jamais par remplacement de sous-chaîne (le
 *      `replace("v1-traces", …)` d'avant était devenu un no-op silencieux après la
 *      migration, et forwardait les logs vers le canal traces).
 *   2. l'hôte de la requête courante.
 *   3. l'hôte de déploiement, pour le code qui tourne hors requête (tâches planifiées,
 *      journalisation différée).
 *   4. le développement local.
 */
export function ingestEndpoint(signal: IngestSignal, host?: string | null): string {
  const path = PATHS[signal];

  const configured = process.env.NEXT_PUBLIC_RUM_ENDPOINT;
  if (configured) {
    try {
      return new URL(path, configured).toString();
    } catch {
      // Valeur inexploitable : on préfère un repli correct à une URL invalide.
    }
  }

  if (host) return `${protocolFor(host)}://${host}${path}`;

  const deployed =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  if (deployed) return `https://${deployed}${path}`;

  return `http://localhost:3000${path}`;
}

/**
 * Endpoint d'ingestion DU DOGFOODING : toujours l'hôte de la requête, jamais
 * `NEXT_PUBLIC_RUM_ENDPOINT`.
 *
 * La console SERT elle-même /api/ingest/v1/* : son propre hôte est donc correct
 * par construction, et un override ne peut que la faire émettre ailleurs. C'est
 * exactement ce qui s'est produit deux fois — la variable a survécu à la
 * migration Supabase -> Neon et la console a posté dans le vide, sans erreur,
 * pendant douze jours la première fois.
 *
 * Le reste de la résolution (snippet client, logs serveur) garde l'override :
 * là, l'ingestion PEUT légitimement vivre ailleurs.
 */
export function dogfoodingEndpoint(host: string | null): string {
  if (host) return `${protocolFor(host)}://${host}${PATHS.traces}`;
  const deploye = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  return deploye ? `https://${deploye}${PATHS.traces}` : `http://localhost:3000${PATHS.traces}`;
}
