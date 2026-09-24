// Relais d'ingestion (P3) : la console transmet un beacon au collector Railway
// au lieu de l'écrire elle-même, pour un pourcentage tiré à chaque requête.
//
// SERVEUR SEULEMENT. Ce module lit `EDGE_PROXY_SECRET` et le pool de la base ;
// il n'est importé que par les route handlers d'ingestion
// (`app/api/ingest/v1/{traces,logs,replay}`, `app/api/sourcemaps`). La garde
// ci-dessous fait échouer tout chargement côté navigateur (le paquet
// `server-only` n'est pas une dépendance de la console : pas de dépendance
// nouvelle pour une ligne).
//
// ═══════════════════════════ CE QUI DÉCIDE DU RELAIS ═════════════════════════
//
// Dans cet ordre, et le premier « non » rend la main au chemin local, celui
// d'avant P3, sans rien changer à la requête :
//   1. `CONSOLE_INGEST_RELAY_URL` et `EDGE_PROXY_SECRET` posées et valides.
//      Absentes (c'est l'état de la production à la fusion) : relais éteint
//      QUEL QUE SOIT LE DRAPEAU — et la base n'est même pas interrogée ;
//   2. disjoncteur fermé (voir plus bas) ;
//   3. tirage du pourcentage (`platform_flag.ingest_relay_pct`, cache 30 s,
//      défaut `INGEST_RELAY_PCT`, 0). À 0 %, AUCUN appel réseau n'est fait ;
//   4. collector vérifié : `GET /health` (cache 60 s) rend 200 avec
//      `edge_protocol = "mip-edge/1"` et `edge_trust = true`. `id_fp` n'est PAS
//      comparé : Vercel ne hache plus rien depuis la décision du 23/09 (secret
//      d'identité vide), c'est le collector seul qui hache.
//
// POURQUOI LE SECRET EST EXIGÉ. Sans `x-mip-edge-auth` valide, le collector
// traite la requête comme DIRECTE et, si le GeoIP est allumé, géolocalise…
// l'adresse de la fonction Vercel : tout le trafic relayé deviendrait « US »
// ou « DE ». Relayer sans secret serait écrire des pays faux ; on ne relaie pas.
// Et `edge_trust` est vérifié pour la même raison, vue de l'autre côté : un
// collector sans secret refuserait la signature et jetterait le pays.
//
// ══════════════════════════════ CE QUI EST TRANSMIS ══════════════════════════
//
// Le corps, OCTET POUR OCTET : lu une seule fois par la route (lecture bornée),
// il sert au relais ET, en cas de repli, au chemin local. Le collector hache
// l'identité lui-même ; sur le repli, la console continue de la retirer
// (secret vide sur Vercel) : une donnée manquante, jamais incohérente.
//
// Les en-têtes, par LISTE EXACTE (`ENTETES_TRANSMIS`) — tout le reste est
// perdu, et d'abord toute adresse : ni `x-forwarded-for`, ni `x-real-ip`, ni
// `x-vercel-forwarded-for`, ni `forwarded`. Ce que les routes lisent vraiment
// (vérifié le 24/09) :
//   · `x-mip-session`, `x-mip-app`, `x-mip-seq`, `x-mip-key` : la route replay
//     (et le receveur du collector) — le SDK web les pose (`replay.ts`) ;
//   · `authorization` : la branche JETON des source maps, et elle seule
//     (`ENTETES_SOURCEMAPS`) ;
//   · `content-type`, `content-encoding` : AUCUNE route ne les lit
//     aujourd'hui, et le SDK n'envoie pas de `content-encoding`. Ils sont
//     transmis parce qu'ils DÉCRIVENT les octets transmis tels quels : les
//     taire ferait mentir la requête relayée sur son propre corps. Un corps
//     gzip annoncé reste refusé en 400 des deux côtés (même contrat).
// Plus deux en-têtes du bord de confiance (`mip-edge/1`) : `x-mip-edge-auth`
// (le secret) et `x-mip-edge-country` (le pays que Vercel a résolu,
// `x-vercel-ip-country`, s'il a la forme ^[A-Z]{2}$). LE PAYS, JAMAIS L'IP :
// la phrase « aucune adresse IP n'est transmise ni stockée » de `lib/legal.ts`
// reste vraie avec le relais.
//
// ═════════════════════════════ LA RÉPONSE, ET LE REPLI ═══════════════════════
//
// Délai de 8 s, au-delà du budget de 4 s du collector (qui répond donc
// toujours avant, 503 compris). Au-delà : 503 + `retry-after` pour TOUS les
// signaux, sans repli — le collector a peut-être écrit, et on ne sait pas quoi.
//
// Repli local SEULEMENT quand le collector n'a, de façon certaine ou sans
// conséquence, rien écrit :
//   · erreur de connexion (DNS, refus, TLS, délai de connexion) : la requête
//     n'est jamais partie ;
//   · 502 / 504 : réponse du routeur Railway (aucune réplique ne répond ; son
//     délai à lui est de plusieurs minutes, notre 8 s passe avant) ;
//   · 404 / 405 : collector mal routé ou signal non servi — rien n'est écrit ;
//   · 500, pour les signaux IDEMPOTENTS seulement.
// Tout autre statut (200, 400, 401, 403, 409, 410, 413, 425, 429, 503…) est la
// réponse du collector : elle est rendue telle quelle. Un 403 notamment NE
// déclenche PAS de repli (plan, P2 : provisionner les clés AVANT la bascule).
//
// IDEMPOTENCE, vérifiée dans le code d'écriture (`packages/backend/lib/`) :
//   · traces   : oui. `writeRowsWithClient` écrit tout en `on conflict (…) do
//     nothing` (clé `span_id`, `action_id`…) et `greatest` sur la session :
//     rejouer le même lot ne crée aucune ligne ;
//   · replay   : oui. `replay_chunk` en `on conflict (session_id, seq) do
//     nothing` ;
//   · sourcemaps : oui. Même contenu déjà présent → `unchanged` ; contenu
//     différent → 409 pour tout le lot, rien d'écrit (`enregistrerMaps`) ;
//   · logs     : NON. `writeLogsWithClient` insère dans `rum_log` (clé
//     `bigserial`, aucune clé naturelle) avec une clause de conflit VIDE : le
//     même lot écrit deux fois donne deux fois chaque log. D'où : pas de repli
//     sur 500, et pas de repli sur une erreur réseau survenue APRÈS l'envoi
//     (connexion coupée pendant la réponse) — dans ces deux cas le lot a pu
//     être écrit ; on rend 500 / 503 et c'est le SDK qui décide de rejouer.
// Seul effet de bord d'un repli sur un signal idempotent : le compteur de
// débit durable (`rate_counter`) compte le beacon deux fois.
//
// La réponse relayée est RECONSTRUITE : statut, corps, `content-type`,
// `retry-after` du collector ; en-têtes CORS de la CONSOLE (`corsFor` local),
// jamais ceux du collector — l'origine autorisée se décide ici, sur l'hôte
// historique que le navigateur voit.
//
// ═════════════════════════════════ DISJONCTEUR ═══════════════════════════════
//
// 5 échecs en 30 s (délai, erreur réseau, 500, 502, 504, 404, 405) → le relais
// est contourné pendant 60 s : chemin local pour tout le monde. État EN MÉMOIRE
// D'INSTANCE : chaque instance serverless Vercel a le sien, il naît fermé et
// disparaît avec l'instance. Ce n'est pas un disjoncteur global — c'est une
// protection de l'instance contre une attente de 8 s par beacon ; le vrai
// coupe-circuit global est `platform_flag` (value = '0').
//
// `OPTIONS` n'est jamais relayé (préflight local, CORS local), et
// `NEXT_PUBLIC_RUM_ENDPOINT` n'est pas touché : les navigateurs continuent de
// viser la console.
import { log as logIngest } from "./ingest";
import { pourcentageRelais } from "./platform-flag";

if (typeof window !== "undefined") {
  throw new Error("lib/ingest-relay est réservé au serveur (il lit EDGE_PROXY_SECRET)");
}

export type Signal = "traces" | "logs" | "replay" | "sourcemaps";

/** Protocole de bord attendu dans `/health` du collector (`client-ip.mjs`, EDGE_PROTOCOL). */
export const PROTOCOLE_BORD = "mip-edge/1";

/** En-têtes du client transmis au collector — liste EXACTE (voir l'en-tête du fichier). */
export const ENTETES_TRANSMIS = Object.freeze([
  "content-type",
  "content-encoding",
  "x-mip-session",
  "x-mip-app",
  "x-mip-seq",
  "x-mip-key",
] as const);

/** Branche jeton des source maps : la même liste, plus le jeton d'upload. */
export const ENTETES_SOURCEMAPS = Object.freeze([...ENTETES_TRANSMIS, "authorization"] as const);

/** Chemins canoniques du collector (il accepte aussi les alias historiques). */
export const CHEMINS: Readonly<Record<Signal, string>> = Object.freeze({
  traces: "/v1/traces",
  logs: "/v1/logs",
  replay: "/v1/replay",
  sourcemaps: "/v1/sourcemaps",
});

/** Rejouer le même lot n'écrit rien de plus (voir « IDEMPOTENCE » en tête). */
export const IDEMPOTENTS: Readonly<Record<Signal, boolean>> = Object.freeze({
  traces: true,
  logs: false,
  replay: true,
  sourcemaps: true,
});

export const DELAIS = Object.freeze({
  /** Relais d'une requête : au-delà du budget de 4 s du collector. */
  relaisMs: 8_000,
  /** Vérification `/health`. */
  santeMs: 2_000,
  /** Durée de validité d'une vérification (réussie ou non). */
  santeCacheMs: 60_000,
  /** Fenêtre et seuil du disjoncteur, durée de contournement. */
  fenetreEchecsMs: 30_000,
  seuilEchecs: 5,
  contournementMs: 60_000,
});

/** `retry-after` d'un relais expiré : le collector a déjà eu 8 s, inutile de le relancer dans 2. */
export const RETRY_AFTER_DELAI_S = "5";

/** Longueur minimale du secret de relais (même règle que le collector, `EDGE_SECRET_MIN_LENGTH`). */
const SECRET_MIN = 32;
const PAYS = /^[A-Z]{2}$/;

/**
 * Codes d'erreur réseau qui prouvent que la requête n'a JAMAIS atteint le
 * collector : résolution de nom, refus, hôte injoignable, délai de CONNEXION,
 * poignée de main TLS. Tout autre échec (connexion coupée, socket fermée…) est
 * INCERTAIN : le corps a pu partir et être écrit.
 */
const CODES_CONNEXION = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

type Journal = { info: (m: string, c?: object) => void; warn: (m: string, c?: object) => void };

export type ConfigRelais = { url: string; secret: string };

/** Ce qu'une décision rend : `null` = chemin local, sinon de quoi envoyer. */
export type Relais = {
  envoyer: (req: Request, corps: Uint8Array, cors: Record<string, string>) => Promise<Response | null>;
};

/**
 * Configuration du relais, ou `null` (relais éteint). Ne cite jamais le secret.
 * @returns la config, ou la raison de l'extinction
 */
export function lireConfigRelais(
  env: Record<string, string | undefined>,
): { config: ConfigRelais } | { config: null; raison: string | null } {
  const brute = env.CONSOLE_INGEST_RELAY_URL?.trim();
  // Absente : l'état NORMAL avant la bascule. Pas de raison à journaliser.
  if (!brute) return { config: null, raison: null };
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return { config: null, raison: "CONSOLE_INGEST_RELAY_URL n'est pas une URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { config: null, raison: "CONSOLE_INGEST_RELAY_URL doit être en http(s)" };
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
function codesReseau(err: unknown): string[] {
  const codes: string[] = [];
  const visiter = (e: unknown, profondeur: number) => {
    if (!e || typeof e !== "object" || profondeur > 3) return;
    const o = e as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof o.code === "string") codes.push(o.code);
    if (Array.isArray(o.errors)) for (const x of o.errors) visiter(x, profondeur + 1);
    visiter(o.cause, profondeur + 1);
  };
  visiter(err, 0);
  return codes;
}

/** La requête n'est-elle, à coup sûr, jamais partie ? */
export function echecAvantEnvoi(err: unknown): boolean {
  const codes = codesReseau(err);
  return codes.length > 0 && codes.every((c) => CODES_CONNEXION.has(c));
}

function estDelaiDepasse(err: unknown): boolean {
  const nom = (err as { name?: string } | null)?.name;
  return nom === "TimeoutError" || nom === "AbortError";
}

/** Le statut du collector appelle-t-il un repli local pour ce signal ? */
export function statutDeRepli(signal: Signal, statut: number): boolean {
  if (statut === 502 || statut === 504 || statut === 404 || statut === 405) return true;
  return statut === 500 && IDEMPOTENTS[signal];
}

/**
 * Le relais, injectable pour les tests. Un seul par instance en production
 * (`relaisParDefaut`) : c'est lui qui porte le disjoncteur et le cache de santé.
 */
export function creerRelais(deps: {
  env?: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
  maintenant?: () => number;
  aleatoire?: () => number;
  pourcentage?: () => Promise<number>;
  log?: Journal;
  delais?: Partial<typeof DELAIS>;
} = {}) {
  const env = deps.env ?? (() => process.env);
  const fetcher = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const maintenant = deps.maintenant ?? Date.now;
  const aleatoire = deps.aleatoire ?? Math.random;
  const pourcentage = deps.pourcentage ?? pourcentageRelais;
  const log = deps.log ?? logIngest;
  const d = { ...DELAIS, ...(deps.delais ?? {}) };

  // ── Disjoncteur (mémoire d'instance) ──
  let echecs: number[] = [];
  let contourneJusqua = 0;
  // ── Santé du collector (mémoire d'instance) ──
  let sante: { url: string; ok: boolean; expire: number } | null = null;
  let santeEnVol: Promise<boolean> | null = null;
  let derniereRaisonConfig: string | null = null;

  function echec(signal: Signal, raison: string) {
    const t = maintenant();
    echecs = echecs.filter((x) => x > t - d.fenetreEchecsMs);
    echecs.push(t);
    if (echecs.length >= d.seuilEchecs) {
      contourneJusqua = t + d.contournementMs;
      echecs = [];
      log.warn("relay circuit open", { signal, raison, bypass_ms: d.contournementMs });
    }
  }

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
        else if (corps?.edge_protocol !== PROTOCOLE_BORD) raison = "edge_protocol inattendu";
        else if (corps?.edge_trust !== true) raison = "collector sans EDGE_PROXY_SECRET (edge_trust)";
        else ok = true;
      } catch (err) {
        raison = estDelaiDepasse(err) ? "délai" : `réseau ${codesReseau(err)[0] ?? "inconnu"}`;
      }
      const precedent = sante?.ok;
      sante = { url: config.url, ok, expire: maintenant() + d.santeCacheMs };
      if (!ok && precedent !== false) log.warn("relay bypass: collector health", { raison });
      if (ok && precedent === false) log.info("relay: collector health ok");
      return ok;
    })().finally(() => {
      santeEnVol = null;
    });
    return santeEnVol;
  }

  function envoyeur(signal: Signal, config: ConfigRelais): Relais {
    return {
      async envoyer(req, corps, cors) {
        const entetes = new Headers();
        for (const nom of signal === "sourcemaps" ? ENTETES_SOURCEMAPS : ENTETES_TRANSMIS) {
          const v = req.headers.get(nom);
          if (v !== null) entetes.set(nom, v);
        }
        entetes.set("x-mip-edge-auth", config.secret);
        const pays = req.headers.get("x-vercel-ip-country");
        if (pays && PAYS.test(pays)) entetes.set("x-mip-edge-country", pays);

        let statut: number;
        let corpsReponse: ArrayBuffer;
        let typeReponse: string | null;
        let retryAfter: string | null;
        try {
          const res = await fetcher(`${config.url}${CHEMINS[signal]}`, {
            method: "POST",
            headers: entetes,
            body: corps as unknown as BodyInit,
            signal: AbortSignal.timeout(d.relaisMs),
            redirect: "error",
            cache: "no-store",
          });
          statut = res.status;
          typeReponse = res.headers.get("content-type");
          retryAfter = res.headers.get("retry-after");
          // Le corps est lu SOUS LE MÊME DÉLAI : un collector qui envoie son
          // statut puis se tait tombe dans la branche « délai ».
          corpsReponse = await res.arrayBuffer();
        } catch (err) {
          if (estDelaiDepasse(err)) {
            echec(signal, "délai");
            log.warn("relay timeout", { signal, timeout_ms: d.relaisMs });
            return new Response(JSON.stringify({ error: "ingestion relay timeout, retry", retry: true }), {
              status: 503,
              headers: { "content-type": "application/json", ...cors, "retry-after": RETRY_AFTER_DELAI_S },
            });
          }
          const code = codesReseau(err)[0] ?? "inconnu";
          echec(signal, `réseau ${code}`);
          if (echecAvantEnvoi(err) || IDEMPOTENTS[signal]) {
            log.warn("relay fallback", { signal, raison: "réseau", code });
            return null;
          }
          // Logs, connexion perdue APRÈS l'envoi : le lot a peut-être été écrit.
          log.warn("relay failed, outcome unknown", { signal, code });
          return new Response(JSON.stringify({ error: "ingestion relay failed, retry", retry: true }), {
            status: 503,
            headers: { "content-type": "application/json", ...cors, "retry-after": RETRY_AFTER_DELAI_S },
          });
        }

        if (statutDeRepli(signal, statut)) {
          echec(signal, `statut ${statut}`);
          log.warn("relay fallback", { signal, raison: "statut", statut });
          return null;
        }
        if (statut >= 500 && statut !== 503) echec(signal, `statut ${statut}`);

        const entetesReponse: Record<string, string> = {
          "content-type": typeReponse ?? "application/json",
          ...cors,
        };
        if (retryAfter) entetesReponse["retry-after"] = retryAfter;
        const sansCorps = statut === 204 || statut === 304;
        return new Response(sansCorps ? null : corpsReponse, { status: statut, headers: entetesReponse });
      },
    };
  }

  /**
   * Décide du relais pour UNE requête. `null` : chemin local. Ne lève jamais.
   */
  async function choisir(signal: Signal): Promise<Relais | null> {
    try {
      const lu = lireConfigRelais(env());
      if (!lu.config) {
        if (lu.raison && lu.raison !== derniereRaisonConfig) log.warn("relay disabled", { raison: lu.raison });
        derniereRaisonConfig = lu.raison;
        return null;
      }
      derniereRaisonConfig = null;
      if (maintenant() < contourneJusqua) return null;
      const pct = await pourcentage();
      if (!(pct > 0)) return null;
      if (pct < 100 && aleatoire() * 100 >= pct) return null;
      if (!(await verifierSante(lu.config))) return null;
      return envoyeur(signal, lu.config);
    } catch {
      return null;
    }
  }

  /** Raccourci des routes OTLP : corps déjà lu, décision + envoi. */
  async function relayer(
    signal: Signal,
    req: Request,
    corps: Uint8Array,
    cors: Record<string, string>,
  ): Promise<Response | null> {
    const relais = await choisir(signal);
    return relais ? relais.envoyer(req, corps, cors) : null;
  }

  return {
    choisir,
    relayer,
    /** Pour les tests et le diagnostic : état du disjoncteur. */
    etat: () => ({ echecs: echecs.length, contourne: maintenant() < contourneJusqua }),
  };
}

// UN relais par instance : il porte le disjoncteur et le cache de santé.
let relaisParDefaut = creerRelais();

/** Tests seulement : disjoncteur refermé, santé oubliée. */
export function _resetRelais(): void {
  relaisParDefaut = creerRelais();
}

/** Décision de relais pour une requête (`null` = chemin local). */
export const choisirRelais = (signal: Signal) => relaisParDefaut.choisir(signal);

/** Décision + envoi, pour un corps déjà lu. `null` = chemin local. */
export const relayer = (signal: Signal, req: Request, corps: Uint8Array, cors: Record<string, string>) =>
  relaisParDefaut.relayer(signal, req, corps, cors);
