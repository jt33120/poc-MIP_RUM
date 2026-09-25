// Relais de l'API de lecture v1 (P4) : la console transmet une lecture MACHINE
// au service `api` de Railway au lieu de la servir elle-même, pour un pourcentage
// tiré à chaque requête.
//
// SERVEUR SEULEMENT (il lit l'environnement et la base, par `platform-flag`).
//
// ═══════════════════════════ CE QUI EST RELAYÉ ═══════════════════════════════
//
// Une requête qui porte `Authorization: Bearer …` — un jeton machine : partenaire,
// front tiers, CI, serveur MCP —, en `GET`/`HEAD`, ou en `POST` sur la seule lecture
// POST (l'Explorer). JAMAIS une requête au cookie de session : les écrans de la
// console appellent l'API v1 avec leur session, et le service `api` n'accepte pas
// les sessions (il n'embarque pas leur vérification) — les relayer rendrait 401 à
// la console elle-même. Jamais une écriture : le service n'en sert aucune.
//
// Dans cet ordre, le premier « non » rend la main au chemin local, inchangé :
//   1. `CONSOLE_API_RELAY_URL` posée (https, sauf localhost) ;
//   2. requête éligible (ci-dessus) ;
//   3. disjoncteur fermé ;
//   4. tirage du pourcentage (`platform_flag.api_relay_pct`, cache 30 s, défaut
//      `API_RELAY_PCT`, 0). À 0 %, aucun appel réseau.
//
// ═══════════════════════════ LA RÉPONSE, ET LE REPLI ═════════════════════════
//
// Une LECTURE se rejoue sans risque : contrairement à la collecte, il n'y a pas
// d'issue incertaine à protéger. D'où une règle simple :
//   · réponse SIGNÉE `x-mip-api: 1` et statut < 500 : c'est le service qui parle
//     (200, 304, et ses refus 400/401/403/404, identiques à ceux de la console —
//     contrat de parité, tests/contract/api-parity.test.ts) → rendue telle quelle ;
//   · tout le reste — non signée (le routeur Railway), 5xx du service, délai de
//     8 s, erreur réseau → REPLI LOCAL, et un échec compté.
// Disjoncteur par instance : 5 échecs en 30 s → plus de relais pendant 60 s.
//
// Le geste d'urgence : `update platform_flag set value = '0' where key = 'api_relay_pct'`,
// effectif en 30 s.
//
// RELAIS PUR (C11). `CONSOLE_API_RELAY_STRICT=1` : une lecture au jeton part
// TOUJOURS au service (le pourcentage est ignoré), et ce qui déclenchait un repli
// rend 503 + `retry-after`. C'est ce qui permet de retirer `CONSOLE_API_TOKENS`
// (et `XSOM_*`) de Vercel : la console ne sert plus elle-même aucune lecture au
// jeton. Les lectures à la session (les écrans) restent locales. Retour arrière :
// retirer la variable (et reposer les jetons) puis redéployer.

import { pourcentageRelaisApi } from "./platform-flag";

export const ENTETE_API = "x-mip-api";
/** Ce qui est transmis, et rien d'autre : ni cookie, ni adresse du client. */
export const ENTETES_TRANSMIS = Object.freeze([
  "authorization",
  "accept",
  "content-type",
  "if-none-match",
  "origin",
  "x-request-id",
] as const);
/** Les POST qui lisent (miroir de `services/api/routeur.mjs`). */
export const POST_DE_LECTURE = Object.freeze(["/api/v1/explorer/query"]);
export const DELAIS = Object.freeze({ reponseMs: 8_000, fenetreEchecsMs: 30_000, echecsMax: 5, coupureMs: 60_000 });
/** Au-delà, la lecture de l'Explorer reste locale : aucun AST ne pèse ça. */
const CORPS_MAX_OCTETS = 256 * 1024;
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** En-têtes de la réponse qui ne se recopient pas : `fetch` a déjà décodé le corps. */
const NON_RECOPIES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

/** L'URL du service `api`, ou `null` (relais éteint). */
export function lireUrlRelaisApi(env: Record<string, string | undefined>): string | null {
  const brute = env.CONSOLE_API_RELAY_URL?.trim();
  if (!brute) return null;
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return null;
  }
  // Le relais transmet le jeton du client : jamais en clair hors de la machine.
  if (url.protocol === "https:" || (url.protocol === "http:" && HOTES_LOCAUX.has(url.hostname))) {
    return url.origin;
  }
  return null;
}

/** La requête peut-elle partir au service `api` ? */
export function eligible(req: Request): boolean {
  if (!/^Bearer\s+\S/i.test(req.headers.get("authorization") ?? "")) return false;
  const methode = req.method.toUpperCase();
  if (methode === "GET" || methode === "HEAD") return true;
  return methode === "POST" && POST_DE_LECTURE.includes(new URL(req.url).pathname);
}

export function creerRelaisApi(deps: {
  env?: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
  maintenant?: () => number;
  aleatoire?: () => number;
  pourcentage?: () => Promise<number>;
} = {}) {
  const env = deps.env ?? (() => process.env);
  const fetcher = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const maintenant = deps.maintenant ?? Date.now;
  const aleatoire = deps.aleatoire ?? Math.random;
  const pourcentage = deps.pourcentage ?? pourcentageRelaisApi;
  let echecs: number[] = [];
  let coupeJusqua = 0;

  function echec() {
    const t = maintenant();
    echecs = echecs.filter((x) => t - x < DELAIS.fenetreEchecsMs);
    echecs.push(t);
    if (echecs.length >= DELAIS.echecsMax) {
      coupeJusqua = t + DELAIS.coupureMs;
      echecs = [];
    }
  }

  /** Relais pur, service injoignable : 503 que le client rejoue, jamais le chemin local. */
  const indisponible = () =>
    Response.json({ error: "service de lecture indisponible, réessayer" }, { status: 503, headers: { "retry-after": "5" } });

  /** La réponse du service, ou `null` : la console sert elle-même. Ne lève jamais. */
  async function relayer(req: Request): Promise<Response | null> {
    const variables = env();
    const base = lireUrlRelaisApi(variables);
    if (!base || !eligible(req)) return null;
    const strict = variables.CONSOLE_API_RELAY_STRICT === "1";
    const repli = () => (strict ? indisponible() : null);
    if (maintenant() < coupeJusqua) return repli();
    if (!strict) {
      const pct = await pourcentage().catch(() => 0);
      if (pct <= 0 || aleatoire() * 100 >= pct) return null;
    }

    const url = new URL(req.url);
    const entetes = new Headers();
    for (const nom of ENTETES_TRANSMIS) {
      const v = req.headers.get(nom);
      if (v !== null) entetes.set(nom, v);
    }
    let corps: ArrayBuffer | undefined;
    if (req.method.toUpperCase() === "POST") {
      const annonce = Number(req.headers.get("content-length") ?? 0);
      if (annonce > CORPS_MAX_OCTETS) return strict ? Response.json({ error: "corps trop volumineux" }, { status: 413 }) : null;
      // Un CLONE : le corps original reste lisible pour le repli local.
      corps = await req.clone().arrayBuffer();
      if (corps.byteLength > CORPS_MAX_OCTETS) return strict ? Response.json({ error: "corps trop volumineux" }, { status: 413 }) : null;
    }

    let res: Response;
    try {
      res = await fetcher(`${base}${url.pathname}${url.search}`, {
        method: req.method,
        headers: entetes,
        body: corps,
        redirect: "manual",
        signal: AbortSignal.timeout(DELAIS.reponseMs),
      });
    } catch {
      echec();
      return repli();
    }
    if (res.headers.get(ENTETE_API) !== "1" || res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      echec();
      return repli();
    }
    const sortie = new Headers();
    for (const [nom, valeur] of res.headers) if (!NON_RECOPIES.has(nom)) sortie.append(nom, valeur);
    return new Response(req.method.toUpperCase() === "HEAD" ? null : res.body, { status: res.status, headers: sortie });
  }

  return { relayer, etat: () => ({ coupeJusqua, echecs: echecs.length }) };
}

const relaisParDefaut = creerRelaisApi();

/** Le relais de l'instance : la réponse du service `api`, ou `null` (chemin local). */
export const relayerLectureApi = (req: Request) => relaisParDefaut.relayer(req);
