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

/**
 * Chemin d'un canal, sans hôte : pour un texte qui montre l'adresse à un humain
 * (`https://<console>/api/ingest/v1/traces`) plutôt que de la résoudre.
 */
export function ingestPath(signal: IngestSignal): string {
  return PATHS[signal];
}

/** http en local (y compris IPv6 ::1), https partout ailleurs. */
function protocolFor(host: string): "http" | "https" {
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) ? "http" : "https";
}

/** Chemins des canaux sur le collector, qui sert `/v1/*` et non `/api/ingest/v1/*`. */
const CHEMINS_COLLECTOR = {
  traces: "/v1/traces",
  logs: "/v1/logs",
  replay: "/v1/replay",
} as const satisfies Record<IngestSignal, string>;

/**
 * Par où passe la collecte d'un navigateur (P6b.G) :
 *   - `console` : `/api/ingest/v1/*` de la console, qui relaie au collector SANS
 *     l'adresse IP (ADR 0005) — le pays reste estimé (fuseau horaire) ou inconnu ;
 *   - `directe` : le collector lui-même, qui lit l'adresse posée par la façade
 *     Railway pour en déduire le pays, sans la conserver.
 */
export type VoieCollecte = "console" | "directe";

/**
 * Une origine de collector utilisable par une page, ou `null`. Deux refus, qui
 * ramènent au chemin par la console (il marche, lui) : une valeur qui n'est pas
 * une URL, et `http:` hors poste local — une page https ne peut pas l'appeler.
 * Un chemin éventuel est ignoré : seule l'origine compte, les chemins sont ceux
 * du collector.
 */
function origineSure(brut: string | undefined): string | null {
  const valeur = brut?.trim();
  if (!valeur) return null;
  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    return null;
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/**
 * L'origine du collector pour la COLLECTE DIRECTE des navigateurs des clients,
 * ou `null` : alors rien ne change, tout passe par la console.
 *
 * POURQUOI UNE TROISIÈME VARIABLE, `NEXT_PUBLIC_DIRECT_COLLECTOR_URL`.
 *   - `NEXT_PUBLIC_RUM_ENDPOINT` déplace l'adresse de la CONSOLE (un chemin
 *     `/api/ingest/v1/*` que le collector sert aussi, mais par alias) et vaut
 *     pour les agents serveur comme pour les navigateurs ;
 *   - `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL` ne vaut que pour le capteur de la
 *     console elle-même, et seulement sur l'hôte de production.
 * Les confondre aurait lié deux paliers que le plan sépare : le dogfooding
 * d'abord, pour prouver que `geo_source = 'geoip'` s'écrit, PUIS les clients.
 * Même valeur que la variable du dogfooding une fois celui-ci prouvé (l'origine
 * du collector) ; posée plus tard, et à part (le mode d'emploi du relais d'ingestion).
 *
 * Pas de refus d'hôte ici, contrairement au dogfooding : la page qui enverra
 * n'est pas la console mais le site du client, dont l'origine est au registre
 * de SON application (`app_registry.allowed_origins`) — le collector l'accepte
 * quelle que soit la console qui a produit le code de suivi.
 */
export function origineCollecteDirecte(): string | null {
  return origineSure(process.env.NEXT_PUBLIC_DIRECT_COLLECTOR_URL);
}

/** La voie à proposer PAR DÉFAUT : directe dès que la variable est posée. */
export function voieRecommandee(): VoieCollecte {
  return origineCollecteDirecte() ? "directe" : "console";
}

/**
 * Adresse DIRECTE d'un canal (`<collector>/v1/<canal>`), ou `null` si la
 * collecte directe n'est pas ouverte. `null` est un vrai « rien » : l'appelant
 * garde alors son comportement d'avant (la résolution de l'extension, par
 * exemple, continue de rendre `endpoint: null`).
 */
export function ingestEndpointDirect(signal: IngestSignal): string | null {
  const origine = origineCollecteDirecte();
  return origine ? `${origine}${CHEMINS_COLLECTOR[signal]}` : null;
}

/**
 * Endpoint d'ingestion pour un canal donné.
 *
 * @param signal  canal visé — `traces`, `logs` ou `replay`.
 * @param host    hôte de la requête courante (`headers().get("host")`). À fournir dès
 *                qu'on est dans un contexte de requête : c'est le repli le plus juste,
 *                celui qui suit naturellement les previews et le self-host.
 * @param voie    `directe` : l'adresse du collector si la collecte directe est
 *                ouverte (`ingestEndpointDirect`), SINON la console, comme sans
 *                ce paramètre. Absent : `console`, la résolution d'avant P6b.G.
 *
 * Ordre de résolution (voie `console`) :
 *   1. `NEXT_PUBLIC_RUM_ENDPOINT` — URL complète du canal traces ; les autres canaux en
 *      dérivent par substitution de chemin, jamais par remplacement de sous-chaîne (le
 *      `replace("v1-traces", …)` d'avant était devenu un no-op silencieux après la
 *      migration, et forwardait les logs vers le canal traces).
 *   2. l'hôte de la requête courante.
 *   3. l'hôte de déploiement, pour le code qui tourne hors requête (tâches planifiées,
 *      journalisation différée).
 *   4. le développement local.
 */
export function ingestEndpoint(signal: IngestSignal, host?: string | null, voie: VoieCollecte = "console"): string {
  if (voie === "directe") {
    const directe = ingestEndpointDirect(signal);
    if (directe) return directe;
  }
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
 * L'origine du collector que le dogfooding vise EN DIRECT, ou `null` : alors il
 * passe par la console, comme avant (P6b.G, le mode d'emploi du relais d'ingestion).
 *
 * POURQUOI UNE VARIABLE À PART, `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL`. Le relais de la
 * console ne transmet que le pays, jamais l'adresse (ADR 0005) : seul un envoi du
 * navigateur au collector lui permet de résoudre le pays par l'adresse IP. On
 * l'ouvre d'abord sur le seul capteur que nous maîtrisons, celui de la console.
 * `NEXT_PUBLIC_RUM_ENDPOINT` aurait déplacé du même geste l'endpoint des snippets
 * donnés aux CLIENTS — et le chemin, que le collector n'a pas.
 *
 * TROIS REFUS, qui ramènent tous au chemin par la console (il marche, lui) :
 *   - une valeur qui n'est pas une URL ;
 *   - `http:` hors poste local : une page https ne peut pas l'appeler ;
 *   - un hôte de requête qui n'est pas l'hôte de production. Le collector n'accepte
 *     que les origines enregistrées pour `mip-rum-console` : une preview ou l'URL
 *     propre d'un déploiement verrait ses envois bloqués par CORS, en silence.
 */
export function origineCollecteurDogfooding(host: string | null): string | null {
  const origine = origineSure(process.env.NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL);
  if (!origine) return null;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production && host && host !== production) return null;
  return origine;
}

/**
 * Endpoint d'ingestion DU DOGFOODING : l'hôte de la requête, jamais
 * `NEXT_PUBLIC_RUM_ENDPOINT` — sauf la collecte directe au collector, qui a sa
 * propre variable (`origineCollecteurDogfooding`).
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
  const collecteur = origineCollecteurDogfooding(host);
  if (collecteur) return `${collecteur}${CHEMINS_COLLECTOR.traces}`;
  if (host) return `${protocolFor(host)}://${host}${PATHS.traces}`;
  const deploye = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  return deploye ? `https://${deploye}${PATHS.traces}` : `http://localhost:3000${PATHS.traces}`;
}
