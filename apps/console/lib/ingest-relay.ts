// Relais de collecte : la console transmet chaque requête de collecte au
// collector Railway, qui seul l'écrit. Depuis C12 (06/10/2026), c'est le SEUL
// chemin : la console n'a plus de chemin d'écriture local, ni tirage au
// pourcentage, ni repli — ADR 0005, point 5.
//
// SERVEUR SEULEMENT. Ce module lit `EDGE_PROXY_SECRET` ; il n'est importé que
// par les routes de collecte (`app/api/ingest/v1/{traces,logs,replay}`,
// `app/api/sourcemaps`) et par les routes MACHINE que le collector sert aussi
// (`app/api/extension/{resolve,heartbeat}`, `app/api/v1/deploys`). La garde
// ci-dessous fait échouer tout chargement côté navigateur. Il n'atteint pas la
// base : c'est ce qui fait sortir ces routes du cliquet « console sans base ».
//
// ═══════════════════════════ CE QUI DÉCIDE DU RELAIS ═════════════════════════
//
// Rien à décider : tout part au collector. Deux conditions, et le premier
// « non » rend 503 + `retry-after` (le SDK rejoue, rien n'est écrit ici) :
//   1. `CONSOLE_INGEST_RELAY_URL` et `EDGE_PROXY_SECRET` posées et valides ;
//   2. collector vérifié : `GET /health` (cache 60 s, réussi ou non) rend 200,
//      signé, avec `edge_protocol = "mip-edge/1"` et `edge_trust = true`. Le
//      cache tient lieu de disjoncteur : un collector tombé coûte une sonde de
//      2 s par minute et par instance, pas une attente de 8 s par beacon.
//
// POURQUOI LE SECRET EST EXIGÉ. Sans `x-mip-edge-auth` valide, le collector
// traite la requête comme DIRECTE et, si le GeoIP est allumé, géolocalise…
// l'adresse de la fonction Vercel : tout le trafic relayé deviendrait « US »
// ou « DE ». Relayer sans secret serait écrire des pays faux ; on ne relaie pas.
//
// ══════════════════════════════ CE QUI EST TRANSMIS ══════════════════════════
//
// Le corps, OCTET POUR OCTET (lu une fois, borné, par la route). Le collector
// décode, hache l'identité et écrit ; la console ne fait rien de tout cela.
//
// Les en-têtes, par LISTE EXACTE (`ENTETES_TRANSMIS`) — tout le reste est
// perdu, et d'abord toute adresse : ni `x-forwarded-for`, ni `x-real-ip`, ni
// `x-vercel-forwarded-for`, ni `forwarded`. Ce que le collector lit vraiment :
//   · `x-mip-session`, `x-mip-app`, `x-mip-seq`, `x-mip-key` : le rejeu ;
//   · `authorization` : les source maps et les marqueurs de déploiement ;
//   · `content-type`, `content-encoding` : ils DÉCRIVENT les octets transmis
//     (JSON ou protobuf, gzip ou non) ;
//   · `origin` (traces, logs, rejeu) : le collector en tire les en-têtes CORS,
//     avec les origines du registre que la console ne lit plus.
// Plus le bord de confiance (`mip-edge/1`) : `x-mip-edge-auth` (le secret),
// `x-mip-edge-country` (le pays de Vercel, s'il a la forme ^[A-Z]{2}$) et, pour
// traces et logs, `x-mip-edge-origin` (le site de la page, qui autorise un lot
// de l'extension sans clé). LE PAYS ET LE SITE, JAMAIS L'IP : « aucune
// adresse IP n'est transmise ni stockée » (`lib/legal.ts`) reste vrai.
//
// ═══════════════════════════════════ LA RÉPONSE ══════════════════════════════
//
// Délai de 8 s, au-delà du budget de 4 s du collector (qui répond donc
// toujours avant, 503 compris). Au-delà : 503 + `retry-after`.
//
// QUI A RÉPONDU. Le collector signe TOUTES ses réponses (`x-mip-collector: 1`) ;
// le routeur Railway, lui, ne signe rien. Réponse SIGNÉE, quel que soit le
// statut : rendue telle quelle, c'est le collector qui parle. Réponse NON
// SIGNÉE 404, 405 (service mal routé), 502 ou 504 (aucune réplique à temps) :
// 503 + `retry-after`. Tout autre statut non signé est rendu tel quel. Une
// erreur réseau, avant ou après l'envoi : 503 + `retry-after`. Les logs ne sont
// pas idempotents (`rum_log`, sans clé naturelle) : un rejeu après une coupure
// tardive peut doubler un lot — c'était déjà le cas du SDK face au collector
// direct, et c'est lui seul qui rejoue désormais.
//
// La réponse relayée est RECONSTRUITE : statut, corps et `retry-after` du
// collector ; `content-type: application/json` IMPOSÉ et `nosniff` — seule
// exception, `application/x-protobuf` quand la réponse est SIGNÉE et l'annonce.
// Un hôte qui répondrait `text/html` (URL mal posée) ne doit pas faire rendre du
// HTML sous l'origine de la console, là où vit le cookie de session admin.
// CORS : ceux du COLLECTOR sur une réponse signée des signaux navigateur (il
// lit le registre des origines) ; sinon ceux que la route a passés — le socle
// statique, sans base (`corsSansBase`).
import { corsHeaders } from "@mip/backend/shared/cors.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";
import { corpsReponseOtlp, formatOtlp, TYPE_JSON, TYPE_PROTOBUF } from "@mip/backend/shared/otlp-corps.mjs";

if (typeof window !== "undefined") {
  throw new Error("lib/ingest-relay est réservé au serveur (il lit EDGE_PROXY_SECRET)");
}

// Même nom de journal qu'avant C12 : les requêtes d'exploitation filtrent sur « ingest ».
export const log = createLogger("ingest");

export type Signal = "traces" | "logs" | "replay" | "sourcemaps" | "extensionResolve" | "extensionHeartbeat" | "deploys";

/** Protocole de bord attendu dans `/health` du collector (`client-ip.mjs`, EDGE_PROTOCOL). */
export const PROTOCOLE_BORD = "mip-edge/1";

/**
 * Signature des réponses du collector (`receiver.mjs`, ENTETE_COLLECTOR ; valeur
 * « 1 »). Recopiée et non importée : le receveur tire le GeoIP, pg-ingest… que
 * la console n'a pas à embarquer. Le test unitaire tient l'égalité des deux.
 */
export const ENTETE_COLLECTOR = "x-mip-collector";

/**
 * Hôtes où `http:` est permis : la machine elle-même (tests, collector local).
 * Ailleurs, le secret de bord, les clés d'API et le jeton d'upload partiraient
 * en clair sur le réseau : `https:` exigé.
 */
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** En-têtes du client transmis au collector — liste EXACTE (voir l'en-tête du fichier). */
export const ENTETES_TRANSMIS = Object.freeze([
  "content-type",
  "content-encoding",
  "x-mip-session",
  "x-mip-app",
  "x-mip-seq",
  "x-mip-key",
  "origin",
] as const);

/** Source maps : le contenu et le jeton d'upload, sans rien de la page. */
export const ENTETES_SOURCEMAPS = Object.freeze(["content-type", "content-encoding", "authorization"] as const);

/**
 * Les routes MACHINE, par liste exacte elles aussi : la résolution d'un domaine
 * ne transmet rien (le domaine est dans la requête) ; le battement d'un poste,
 * son User-Agent (le collector l'inscrit à l'inventaire) ; le marqueur de
 * déploiement, le jeton de sa CI.
 */
const ENTETES_PAR_SIGNAL: Partial<Record<Signal, readonly string[]>> = Object.freeze({
  sourcemaps: ENTETES_SOURCEMAPS,
  extensionResolve: [],
  extensionHeartbeat: ["content-type", "user-agent"],
  deploys: ["content-type", "authorization"],
});

/**
 * Signaux dont le relais transmet l'`Origin` de la page (`x-mip-edge-origin`) :
 * ceux dont les gardes du collector la lisent, pour un lot de l'extension sans
 * clé (`autoriseParDomaine`, `pg-ingest.mjs`).
 */
const SIGNAUX_ORIGINE: ReadonlySet<Signal> = new Set<Signal>(["traces", "logs"]);

/**
 * Signaux appelés par un navigateur d'une autre origine : leurs en-têtes CORS
 * viennent du collector, qui seul lit le registre des origines autorisées.
 */
const SIGNAUX_NAVIGATEUR: ReadonlySet<Signal> = new Set<Signal>(["traces", "logs", "replay"]);

/** Chemins canoniques du collector (il accepte aussi les alias historiques). */
export const CHEMINS: Readonly<Record<Signal, string>> = Object.freeze({
  traces: "/v1/traces",
  logs: "/v1/logs",
  replay: "/v1/replay",
  sourcemaps: "/v1/sourcemaps",
  extensionResolve: "/v1/extension/resolve",
  extensionHeartbeat: "/v1/extension/heartbeat",
  deploys: "/v1/deploys",
});

export const DELAIS = Object.freeze({
  /** Relais d'une requête : au-delà du budget de 4 s du collector. */
  relaisMs: 8_000,
  /** Vérification `/health`. */
  santeMs: 2_000,
  /** Durée de validité d'une vérification (réussie ou non). */
  santeCacheMs: 60_000,
});

/** `retry-after` d'un 503 du relais : le collector a peut-être déjà eu 8 s, inutile de le relancer dans 2. */
export const RETRY_AFTER_DELAI_S = "5";

/** Longueur minimale du secret de relais (même règle que le collector, `EDGE_SECRET_MIN_LENGTH`). */
const SECRET_MIN = 32;
const PAYS = /^[A-Z]{2}$/;

type Journal = { info: (m: string, c?: object) => void; warn: (m: string, c?: object) => void };

export type ConfigRelais = { url: string; secret: string };

/**
 * En-têtes CORS sans lire la base : le socle statique seul. Ce sont ceux des
 * réponses que la console rend elle-même (refus de taille, 503 du relais) ; une
 * réponse du collector porte les siens, calculés sur le registre.
 */
export function corsSansBase(origin: string | null, opts?: { allowHeaders?: string }): Record<string, string> {
  return corsHeaders(origin ?? "", [], opts);
}

/** Une réponse JSON de la console (refus local avant relais, 503). */
export function json(
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors, ...extraHeaders },
  });
}

/**
 * Met la réponse d'une route OTLP au format de la REQUÊTE : une requête
 * protobuf reçoit un corps protobuf (vide sur un 2xx, `google.rpc.Status` sinon)
 * et `content-type: application/x-protobuf` — la spec OTLP/HTTP l'exige. Ne
 * touche que les réponses JSON (les refus et 503 de la console) : une réponse
 * déjà en protobuf, signée par le collector, passe telle quelle.
 */
export async function formaterReponseOtlp(req: Request, res: Response): Promise<Response> {
  if (formatOtlp(req.headers.get("content-type")) !== "protobuf") return res;
  if (res.headers.get("content-type") !== TYPE_JSON) return res;
  const corps: unknown = await res.json().catch(() => null);
  const { contentType, octets } = corpsReponseOtlp("protobuf", res.status, corps);
  const entetes = new Headers(res.headers);
  entetes.set("content-type", contentType);
  return new Response(octets.length ? new Uint8Array(octets) : null, { status: res.status, headers: entetes });
}

/**
 * Configuration du relais, ou la raison de son absence. Ne cite jamais le secret.
 */
export function lireConfigRelais(
  env: Record<string, string | undefined>,
): { config: ConfigRelais } | { config: null; raison: string } {
  const brute = env.CONSOLE_INGEST_RELAY_URL?.trim();
  if (!brute) return { config: null, raison: "CONSOLE_INGEST_RELAY_URL absente" };
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return { config: null, raison: "CONSOLE_INGEST_RELAY_URL n'est pas une URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { config: null, raison: "CONSOLE_INGEST_RELAY_URL doit être en http(s)" };
  }
  // `http:` hors de la machine : le relais envoie `x-mip-edge-auth`, les
  // `x-mip-key` et l'`authorization` des source maps — en clair, à quiconque
  // écoute entre Vercel et Railway. Refusé plutôt que dégradé. (`URL` rend
  // l'IPv6 entre crochets : « [::1] ».)
  if (url.protocol === "http:" && !HOTES_LOCAUX.has(url.hostname)) {
    return { config: null, raison: "CONSOLE_INGEST_RELAY_URL doit être en https (http: réservé à localhost)" };
  }
  const secret = env.EDGE_PROXY_SECRET?.trim() ?? "";
  // UNE valeur côté console : c'est le collector qui en accepte deux pendant
  // une rotation ; la console, elle, envoie la nouvelle.
  if (secret.length < SECRET_MIN || secret.includes(",")) {
    return { config: null, raison: `EDGE_PROXY_SECRET absent ou invalide (une valeur, ≥ ${SECRET_MIN} caractères)` };
  }
  return { config: { url: url.origin + url.pathname.replace(/\/+$/, ""), secret } };
}

/** Code réseau d'un échec de `fetch` (undici le range dans `cause`, parfois dans un AggregateError). */
function codeReseau(err: unknown): string {
  const codes: string[] = [];
  const visiter = (e: unknown, profondeur: number) => {
    if (!e || typeof e !== "object" || profondeur > 3) return;
    const o = e as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof o.code === "string") codes.push(o.code);
    if (Array.isArray(o.errors)) for (const x of o.errors) visiter(x, profondeur + 1);
    visiter(o.cause, profondeur + 1);
  };
  visiter(err, 0);
  return codes[0] ?? "inconnu";
}

function estDelaiDepasse(err: unknown): boolean {
  const nom = (err as { name?: string } | null)?.name;
  return nom === "TimeoutError" || nom === "AbortError";
}

/**
 * Une réponse NON signée qui dit que la requête n'a atteint aucun collector
 * à temps (routage raté, aucune réplique) : 503 + `retry-after` plutôt que de
 * rendre au client un 404 ou un 502 du routeur.
 * @param signee la réponse porte `x-mip-collector: 1`
 */
export function collectorAbsent(statut: number, signee: boolean): boolean {
  return !signee && (statut === 404 || statut === 405 || statut === 502 || statut === 504);
}

/** 503 + `retry-after` : la console n'a rien écrit, le client rejoue. */
function indisponible(cors: Record<string, string>, erreur = "ingestion unavailable, retry"): Response {
  return json({ error: erreur, retry: true }, 503, cors, { "retry-after": RETRY_AFTER_DELAI_S });
}

/**
 * Le relais, injectable pour les tests. Un seul par instance en production
 * (`relaisParDefaut`) : c'est lui qui porte le cache de santé.
 */
export function creerRelais(deps: {
  env?: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
  maintenant?: () => number;
  log?: Journal;
  delais?: Partial<typeof DELAIS>;
} = {}) {
  const env = deps.env ?? (() => process.env);
  const fetcher = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const maintenant = deps.maintenant ?? Date.now;
  const journal = deps.log ?? log;
  const d = { ...DELAIS, ...(deps.delais ?? {}) };

  // ── Santé du collector (mémoire d'instance) ──
  let sante: { url: string; ok: boolean; expire: number } | null = null;
  let santeEnVol: Promise<boolean> | null = null;
  let derniereRaisonConfig: string | null = null;

  async function verifierSante(config: ConfigRelais): Promise<boolean> {
    const t = maintenant();
    if (sante && sante.url === config.url && sante.expire > t) return sante.ok;
    if (santeEnVol) return santeEnVol;
    santeEnVol = (async () => {
      let ok = false;
      let raison = "ok";
      try {
        const res = await fetcher(`${config.url}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(d.santeMs),
          redirect: "error",
          cache: "no-store",
        });
        const corps = (await res.json().catch(() => null)) as { edge_protocol?: unknown; edge_trust?: unknown } | null;
        if (!res.ok) raison = `statut ${res.status}`;
        // Sans signature, un 404 métier ne se distinguerait plus d'un routage
        // raté (voir « QUI A RÉPONDU ») : un collector antérieur n'est pas relayé.
        else if (res.headers.get(ENTETE_COLLECTOR) !== "1") raison = `réponse sans ${ENTETE_COLLECTOR}`;
        else if (corps?.edge_protocol !== PROTOCOLE_BORD) raison = "edge_protocol inattendu";
        else if (corps?.edge_trust !== true) raison = "collector sans EDGE_PROXY_SECRET (edge_trust)";
        else ok = true;
      } catch (err) {
        raison = estDelaiDepasse(err) ? "délai" : `réseau ${codeReseau(err)}`;
      }
      const precedent = sante?.ok;
      sante = { url: config.url, ok, expire: maintenant() + d.santeCacheMs };
      if (!ok && precedent !== false) journal.warn("relay: collector unhealthy", { raison });
      if (ok && precedent === false) journal.info("relay: collector health ok");
      return ok;
    })().finally(() => {
      santeEnVol = null;
    });
    return santeEnVol;
  }

  async function envoyer(
    signal: Signal,
    config: ConfigRelais,
    req: Request,
    corps: Uint8Array,
    cors: Record<string, string>,
  ): Promise<Response> {
    const entetes = new Headers();
    for (const nom of ENTETES_PAR_SIGNAL[signal] ?? ENTETES_TRANSMIS) {
      const v = req.headers.get(nom);
      if (v !== null) entetes.set(nom, v);
    }
    entetes.set("x-mip-edge-auth", config.secret);
    const pays = req.headers.get("x-vercel-ip-country");
    if (pays && PAYS.test(pays)) entetes.set("x-mip-edge-country", pays);
    // Sous le préfixe du bord : le collector ne la lit que si la signature
    // est bonne, et la retire sinon. Sa forme est jugée là-bas, en un seul
    // endroit (`hoteDOrigine`) ; ici, seulement une borne de longueur.
    const origine = req.headers.get("origin");
    if (origine && origine.length <= 2048 && SIGNAUX_ORIGINE.has(signal)) entetes.set("x-mip-edge-origin", origine);

    // Préflight et lectures (diagnostic GET, résolution d'un domaine) : la même
    // méthode, sans corps ; la requête d'une lecture passe avec elle.
    const methode = req.method === "OPTIONS" || req.method === "GET" ? req.method : "POST";
    const recherche = methode === "GET" ? new URL(req.url).search : "";

    let res: Response;
    let corpsReponse: ArrayBuffer;
    try {
      res = await fetcher(`${config.url}${CHEMINS[signal]}${recherche}`, {
        method: methode,
        headers: entetes,
        body: methode === "POST" ? (corps as unknown as BodyInit) : undefined,
        signal: AbortSignal.timeout(d.relaisMs),
        redirect: "error",
        cache: "no-store",
      });
      // Le corps est lu SOUS LE MÊME DÉLAI : un collector qui envoie son
      // statut puis se tait tombe dans la branche « délai ».
      corpsReponse = await res.arrayBuffer();
    } catch (err) {
      if (estDelaiDepasse(err)) {
        journal.warn("relay timeout", { signal, timeout_ms: d.relaisMs });
        return indisponible(cors, "ingestion relay timeout, retry");
      }
      journal.warn("relay failed", { signal, code: codeReseau(err) });
      return indisponible(cors, "ingestion relay failed, retry");
    }

    const statut = res.status;
    const signee = res.headers.get(ENTETE_COLLECTOR) === "1";
    if (collectorAbsent(statut, signee)) {
      journal.warn("relay: collector unreachable", { signal, statut });
      return indisponible(cors);
    }

    const typeReponse = res.headers.get("content-type");
    const entetesReponse: Record<string, string> = {
      // Protobuf : seulement signé, et seulement ce type exact (voir l'en-tête).
      "content-type": signee && typeReponse === TYPE_PROTOBUF ? TYPE_PROTOBUF : "application/json",
      "x-content-type-options": "nosniff",
      ...cors,
    };
    if (signee && SIGNAUX_NAVIGATEUR.has(signal)) {
      // Les CORS du collector remplacent le socle statique : lui seul connaît
      // les origines des applications enregistrées.
      for (const nom of Object.keys(entetesReponse)) {
        if (nom.toLowerCase().startsWith("access-control-")) delete entetesReponse[nom];
      }
      res.headers.forEach((valeur, nom) => {
        if (nom.startsWith("access-control-")) entetesReponse[nom] = valeur;
      });
    }
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) entetesReponse["retry-after"] = retryAfter;
    // La résolution d'un domaine se met en cache (60 s) : l'extension la relit.
    const cacheControl = res.headers.get("cache-control");
    if (signal === "extensionResolve" && cacheControl && signee) entetesReponse["cache-control"] = cacheControl;
    const sansCorps = statut === 204 || statut === 304;
    return new Response(sansCorps ? null : corpsReponse, { status: statut, headers: entetesReponse });
  }

  /**
   * Transmet UNE requête au collector. Rend toujours une réponse : celle du
   * collector, ou 503 + `retry-after`. Ne lève jamais, n'écrit jamais.
   * @param cors en-têtes CORS des réponses que la console rend elle-même
   */
  async function relayer(
    signal: Signal,
    req: Request,
    corps: Uint8Array,
    cors: Record<string, string>,
  ): Promise<Response> {
    try {
      const lu = lireConfigRelais(env());
      if (!lu.config) {
        // Une configuration manquante ne se corrige pas d'elle-même : dite une
        // fois par instance et par raison, pas à chaque beacon.
        if (lu.raison !== derniereRaisonConfig) journal.warn("relay not configured", { raison: lu.raison });
        derniereRaisonConfig = lu.raison;
        return indisponible(cors);
      }
      derniereRaisonConfig = null;
      if (!(await verifierSante(lu.config))) return indisponible(cors);
      return await envoyer(signal, lu.config, req, corps, cors);
    } catch (err) {
      journal.warn("relay failed", { signal, err: String(err) });
      return indisponible(cors);
    }
  }

  return { relayer };
}

// UN relais par instance : il porte le cache de santé.
let relaisParDefaut = creerRelais();

/** Tests seulement : santé oubliée. */
export function _resetRelais(): void {
  relaisParDefaut = creerRelais();
}

/** Transmet une requête au collector, corps déjà lu : sa réponse, ou 503. */
export const relayer = (signal: Signal, req: Request, corps: Uint8Array, cors: Record<string, string>) =>
  relaisParDefaut.relayer(signal, req, corps, cors);
