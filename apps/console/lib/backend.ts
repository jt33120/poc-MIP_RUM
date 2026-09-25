// LE CLIENT DE console-api, CÔTÉ SERVEUR DE LA CONSOLE (piste C, C0b).
//
// C'est par ici que la console cessera, écran par écran, d'ouvrir la base : un
// écran appelle une OPÉRATION du contrat (`@mip/console-contract`), typée de bout
// en bout, au lieu d'une fonction de `lib/queries*`. Le navigateur ne parle
// jamais à console-api ; seul ce module, exécuté sur le serveur Vercel, le fait.
//
// CE QUE CHAQUE APPEL PORTE :
//   · `x-mip-client` : le secret client. Sans lui, console-api répond 404 nu ;
//   · `x-request-id` : celui de la requête de la console (posé par le
//     middleware), repris dans le journal du service et, en C0c, dans `audit_log` ;
//   · `x-mip-deadline-ms` : le budget du SERVICE, plus court que celui du client
//     (délai − 500 ms) — le service rend la main avant que la console n'abandonne.
//
// LA POIGNÉE DE MAIN, AVANT TOUT SECRET. Le domaine généré d'un service Railway
// (`*.up.railway.app`) peut être réattribué si le service est recréé. Avant
// d'envoyer le secret client à un hôte, on lui demande de signer un nonce
// (`GET /v1/version?nonce=`, SANS secret) et on vérifie la signature ES256 avec
// la clé PUBLIQUE des sessions (`SESSION_PUBLIC_JWKS`) : seul le vrai service a
// la clé privée. Échec : aucun appel ne part, et le journal le dit. Réussite :
// valable 10 minutes, par instance.
//
// CE QUE VERCEL DÉTIENT : `CONSOLE_API_URL`, `CONSOLE_API_CLIENT_SECRET`,
// `SESSION_PUBLIC_JWKS` (non secrète). Jamais une clé privée : un jeu qui porte
// un `d` est REFUSÉ ici, et le module se déclare non branché.
//
// Pas de `server-only` (le paquet n'est pas une dépendance) : une garde
// d'exécution refuse le navigateur, et les variables ci-dessus n'y sont de toute
// façon pas exposées (aucune n'est `NEXT_PUBLIC_`).
import { createLogger } from "@mip/backend/shared/log.mjs";
import {
  ENTETE_CLIENT,
  ENTETE_ECHEANCE,
  ENTETE_IP_VISITEUR,
  ENTETE_REQUETE,
  ENTETE_SERVICE,
  lignesDuContrat,
  messageDePoignee,
  OPERATIONS,
  VERSION,
  type ClePublique,
  type CodeErreur,
  type Fil,
  type Operation,
  type Version,
} from "@mip/console-contract";

const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ID_REQUETE = /^[A-Za-z0-9._-]{8,64}$/;

export const DELAIS = Object.freeze({
  lectureMs: 8_000,
  ecritureMs: 10_000,
  /** Ce que le service garde de moins que le client : il rend la main avant qu'on abandonne. */
  margeServiceMs: 500,
  poigneeMs: 3_000,
  poigneeValableMs: 10 * 60_000,
  /** Un nouvel essai (lecture seulement) n'a de sens que s'il reste ce budget. */
  budgetNouvelEssaiMs: 2_000,
});

export interface ConfigBackend {
  readonly url: string;
  readonly secret: string;
  readonly cles: readonly ClePublique[];
}

/**
 * La configuration, ou pourquoi elle manque. `absente` : console-api n'est pas
 * branché (les appelants gardent leur lecture locale). `invalide` : quelque chose
 * est posé mais faux — journalisé, et traité comme absent.
 */
export function lireConfigBackend(
  env: Record<string, string | undefined> = process.env,
): { etat: "branche"; config: ConfigBackend } | { etat: "absente" } | { etat: "invalide"; raison: string } {
  const brute = env.CONSOLE_API_URL?.trim();
  const secret = env.CONSOLE_API_CLIENT_SECRET?.trim();
  const jwks = env.SESSION_PUBLIC_JWKS?.trim();
  if (!brute && !secret && !jwks) return { etat: "absente" };
  if (!brute || !secret || !jwks) {
    return { etat: "invalide", raison: "CONSOLE_API_URL, CONSOLE_API_CLIENT_SECRET et SESSION_PUBLIC_JWKS vont ensemble" };
  }
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return { etat: "invalide", raison: "CONSOLE_API_URL illisible" };
  }
  if (url.username || url.password) return { etat: "invalide", raison: "CONSOLE_API_URL ne porte pas d'identifiants" };
  // Le secret client voyage à chaque appel : jamais en clair hors de la machine.
  if (!(url.protocol === "https:" || (url.protocol === "http:" && HOTES_LOCAUX.has(url.hostname)))) {
    return { etat: "invalide", raison: "CONSOLE_API_URL doit être en https" };
  }
  if (secret.length < 32) return { etat: "invalide", raison: "CONSOLE_API_CLIENT_SECRET : 32 caractères au moins" };
  let cles: unknown;
  try {
    cles = (JSON.parse(jwks) as { keys?: unknown }).keys;
  } catch {
    return { etat: "invalide", raison: "SESSION_PUBLIC_JWKS : JSON illisible" };
  }
  if (!Array.isArray(cles) || cles.length === 0 || cles.length > 3) return { etat: "invalide", raison: "SESSION_PUBLIC_JWKS : 1 à 3 clés attendues" };
  for (const k of cles as Record<string, unknown>[]) {
    // Une clé PRIVÉE sur Vercel : exactement ce que la piste C retire.
    if ("d" in k) return { etat: "invalide", raison: "SESSION_PUBLIC_JWKS contient une clé PRIVÉE : ne poser que la partie publique (--publique)" };
    if (k.kty !== "EC" || k.crv !== "P-256" || typeof k.x !== "string" || typeof k.y !== "string" || typeof k.kid !== "string") {
      return { etat: "invalide", raison: "SESSION_PUBLIC_JWKS : clés EC P-256 avec x, y et kid attendues" };
    }
  }
  return { etat: "branche", config: { url: url.origin, secret, cles: cles as ClePublique[] } };
}

export type RaisonLocale = "non_branche" | "hote_non_verifie" | "reseau";

export type Resultat<T> =
  | { readonly ok: true; readonly data: T; readonly requestId: string }
  | {
      readonly ok: false;
      readonly code: CodeErreur | RaisonLocale;
      readonly statut: number;
      readonly message: string;
      readonly requestId: string | null;
    };

export interface OptionsAppel {
  /** Délai du client (défaut : 8 s en lecture, 10 s en écriture). */
  readonly delaiMs?: number;
  /** Le jeton de session de l'utilisateur (C1). */
  readonly jeton?: string;
  readonly requestId?: string;
  /** Opération indépendante de l'utilisateur (sans jeton) : cache Next de N secondes. */
  readonly revalider?: number;
  /** L'adresse du visiteur, pour le débit d'authentification de console-api (C1) — jamais stockée en clair. */
  readonly ipVisiteur?: string;
}

function base64url(octets: Uint8Array): string {
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function depuisBase64url(texte: string): Uint8Array {
  const b64 = texte.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (texte.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function empreinteContrat(): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lignesDuContrat(OPERATIONS))));
  return [...h].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Le chemin d'une opération, paramètres encodés : `/v1/dashboards/{id}` → `/v1/dashboards/a%2Fb`. */
export function cheminDe(chemin: string, params: Record<string, unknown> = {}): string {
  return chemin.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, nom: string) => {
    const v = params[nom];
    if (v === undefined || v === null || v === "") throw new Error(`backend : paramètre « ${nom} » manquant pour ${chemin}`);
    return encodeURIComponent(String(v));
  });
}

type Champs = Record<string, unknown>;
type Journal = { info: (m: string, c?: Champs) => void; warn: (m: string, c?: Champs) => void; error: (m: string, c?: Champs) => void };

export function creerBackend(deps: {
  env?: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
  maintenant?: () => number;
  aleatoire?: () => number;
  journal?: Journal;
} = {}) {
  const env = deps.env ?? (() => process.env);
  const fetcher = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const maintenant = deps.maintenant ?? Date.now;
  const aleatoire = deps.aleatoire ?? Math.random;
  const journal: Journal = deps.journal ?? createLogger("backend");

  let poigneeValableJusqua = 0;
  let poigneeEnCours: Promise<boolean> | null = null;
  let contratSignale: string | null = null;
  let configSignalee: string | null = null;

  function config(): ConfigBackend | null {
    const c = lireConfigBackend(env());
    if (c.etat === "branche") return c.config;
    if (c.etat === "invalide" && configSignalee !== c.raison) {
      configSignalee = c.raison;
      journal.error("console-api mal configuré : non branché", { raison: c.raison });
    }
    return null;
  }

  async function poignee(c: ConfigBackend): Promise<boolean> {
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
    let v: Version;
    try {
      const res = await fetcher(`${c.url}${VERSION.chemin}?nonce=${nonce}`, {
        headers: { accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(DELAIS.poigneeMs),
      });
      if (!res.ok || res.headers.get(ENTETE_SERVICE) !== "1") throw new Error(`réponse ${res.status}${res.headers.get(ENTETE_SERVICE) ? "" : " non signée"}`);
      v = ((await res.json()) as { data: Version }).data;
    } catch (e) {
      journal.error("poignée de main impossible : aucun appel ne part", { url: c.url, err: e instanceof Error ? e.message : String(e) });
      return false;
    }
    const cle = c.cles.find((k) => k.kid === v?.kid);
    let valide = false;
    if (v?.service === "console-api" && v.nonce === nonce && cle && typeof v.signature === "string") {
      try {
        const pub = await crypto.subtle.importKey("jwk", { ...cle, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        valide = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          pub,
          depuisBase64url(v.signature) as BufferSource,
          new TextEncoder().encode(messageDePoignee(v)),
        );
      } catch {
        valide = false;
      }
    }
    if (!valide) {
      // L'hôte ne prouve pas qu'il est console-api : c'est peut-être un domaine réattribué.
      journal.error("poignée de main REFUSÉE : l'hôte n'a pas prouvé qu'il est console-api — aucun secret envoyé", {
        url: c.url,
        kid: v?.kid ?? null,
        kid_connu: Boolean(cle),
      });
      return false;
    }
    const local = await empreinteContrat();
    if (v.contrat !== local && contratSignale !== v.contrat) {
      contratSignale = v.contrat;
      // Pas bloquant : console-api sert N et N−1 (changements additifs, backend d'abord).
      journal.warn("contrat de console-api différent de celui de la console", { service: v.contrat.slice(0, 12), console: local.slice(0, 12), version: v.version });
    }
    poigneeValableJusqua = maintenant() + DELAIS.poigneeValableMs;
    return true;
  }

  async function hoteVerifie(c: ConfigBackend): Promise<boolean> {
    if (maintenant() < poigneeValableJusqua) return true;
    poigneeEnCours ??= poignee(c).finally(() => {
      poigneeEnCours = null;
    });
    return poigneeEnCours;
  }

  /** console-api est-il branché (configuration présente et valide) ? */
  function estBranche(): boolean {
    return config() !== null;
  }

  async function appeler<P, Q, B, R>(
    operation: Operation<P, Q, B, R>,
    entree: { params?: P; requete?: Q; corps?: B } = {},
    options: OptionsAppel = {},
  ): Promise<Resultat<Fil<R>>> {
    const c = config();
    if (!c) return { ok: false, code: "non_branche", statut: 0, message: "console-api n'est pas branché", requestId: null };
    if (!(await hoteVerifie(c))) return { ok: false, code: "hote_non_verifie", statut: 0, message: "hôte console-api non vérifié", requestId: null };

    const debut = maintenant();
    const ecriture = operation.methode !== "GET";
    const delai = options.delaiMs ?? (ecriture ? DELAIS.ecritureMs : DELAIS.lectureMs);
    const requestId = options.requestId && ID_REQUETE.test(options.requestId) ? options.requestId : crypto.randomUUID();
    const chemin = cheminDe(operation.chemin, (entree.params ?? {}) as Record<string, unknown>);
    const recherche = new URLSearchParams();
    for (const [k, v] of Object.entries((entree.requete ?? {}) as Record<string, unknown>)) {
      if (v !== undefined && v !== null) recherche.set(k, String(v));
    }
    const url = `${c.url}${chemin}${recherche.size ? `?${recherche}` : ""}`;

    for (let essai = 1; ; essai++) {
      const reste = delai - (maintenant() - debut);
      const entetes: Record<string, string> = {
        accept: "application/json",
        [ENTETE_CLIENT]: c.secret,
        [ENTETE_REQUETE]: requestId,
        [ENTETE_ECHEANCE]: String(Math.max(200, reste - DELAIS.margeServiceMs)),
      };
      if (options.jeton) entetes.authorization = `Bearer ${options.jeton}`;
      if (options.ipVisiteur) entetes[ENTETE_IP_VISITEUR] = options.ipVisiteur;
      if (entree.corps !== undefined) entetes["content-type"] = "application/json";
      let res: Response;
      try {
        res = await fetcher(url, {
          method: operation.methode,
          headers: entetes,
          body: entree.corps === undefined ? undefined : JSON.stringify(entree.corps),
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, reste)),
          ...(options.revalider && !options.jeton ? { next: { revalidate: options.revalider } } : { cache: "no-store" as const }),
        } as RequestInit);
      } catch (e) {
        if (!ecriture && essai === 1 && delai - (maintenant() - debut) >= DELAIS.budgetNouvelEssaiMs) {
          await new Promise((r) => setTimeout(r, 100 + aleatoire() * 200));
          continue;
        }
        journal.error("console-api injoignable", { operation: operation.id, request_id: requestId, err: e instanceof Error ? e.message : String(e) });
        return { ok: false, code: "reseau", statut: 0, message: "console-api injoignable", requestId };
      }

      // Une réponse NON signée vient du routeur Railway (service absent, en
      // redéploiement) ou d'un secret refusé (404 nu) : jamais de console-api.
      if (res.headers.get(ENTETE_SERVICE) !== "1") {
        if (!ecriture && essai === 1 && [502, 503, 504].includes(res.status) && delai - (maintenant() - debut) >= DELAIS.budgetNouvelEssaiMs) {
          await new Promise((r) => setTimeout(r, 100 + aleatoire() * 200));
          continue;
        }
        journal.error(res.status === 404 ? "console-api répond 404 nu : secret client refusé, ou mauvais hôte" : "réponse non signée devant console-api", {
          operation: operation.id,
          request_id: requestId,
          statut: res.status,
        });
        return { ok: false, code: "indisponible", statut: res.status, message: "console-api indisponible", requestId };
      }

      let corps: { data?: unknown; error?: { code: CodeErreur; message: string }; meta?: { request_id?: string } } | null = null;
      try {
        corps = await res.json();
      } catch {
        corps = null;
      }
      if (res.ok && corps && "data" in corps) return { ok: true, data: corps.data as Fil<R>, requestId };
      const code = corps?.error?.code ?? "erreur_interne";
      if (res.status >= 500) journal.error("console-api en échec", { operation: operation.id, request_id: requestId, statut: res.status, code });
      return { ok: false, code, statut: res.status, message: corps?.error?.message ?? `console-api a répondu ${res.status}`, requestId };
    }
  }

  return { appeler, estBranche };
}

let parDefaut: ReturnType<typeof creerBackend> | null = null;

/** Le client de l'instance (poignée de main partagée entre les rendus). */
export function backend(): ReturnType<typeof creerBackend> {
  if (typeof window !== "undefined") throw new Error("lib/backend : réservé au serveur de la console");
  parDefaut ??= creerBackend();
  return parDefaut;
}
