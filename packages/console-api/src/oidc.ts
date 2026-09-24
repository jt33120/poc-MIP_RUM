// LE SSO (OIDC, code d'autorisation + PKCE), porté par console-api (C1c).
//
// Aujourd'hui la console fait tout : la découverte, l'échange du code avec son
// secret client OIDC, la vérification de l'ID token, et elle retrouve le compte
// par l'E-MAIL — sans regarder `email_verified`, avec `preferred_username` en
// repli. Ici :
//   · l'émetteur est ÉPINGLÉ (celui de la configuration, vérifié dans la
//     découverte ET dans l'ID token) ;
//   · l'e-mail ne vient que du claim `email`, et ne vaut pour un lien que si
//     l'IdP l'atteste (`email_verified`) dans un domaine autorisé ;
//   · état, nonce et vérificateur PKCE voyagent dans une TRANSACTION scellée
//     (JWE `dir` + A256GCM, clé `OIDC_TX_KEY`) : la console la garde en cookie
//     sans pouvoir la lire, et elle expire en 10 minutes.
// Le lien au compte (par émetteur et sujet) est dans `operations/identite.ts`.
import { CompactEncrypt, compactDecrypt, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

export interface ConfigOidc {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: string;
  /** Claim portant les rôles ou groupes ; absent : le rôle géré dans la console est préservé. */
  readonly roleClaim: string | null;
  readonly adminValues: readonly string[];
  /** Claim portant la liste d'applications ; absent : le périmètre géré dans la console est préservé. */
  readonly appsClaim: string | null;
  /** Domaines dont une adresse ATTESTÉE par l'IdP peut créer ou lier un compte. Vide : aucun. */
  readonly domainesAutorises: readonly string[];
  /** 32 octets : la clé qui scelle la transaction (`OIDC_TX_KEY`, base64url). */
  readonly cleTransaction: Uint8Array;
}

/** Ce que l'IdP atteste d'une personne, une fois l'ID token vérifié. */
export interface IdentiteSso {
  readonly iss: string;
  readonly sub: string;
  /** Le claim `email`, en minuscules ; jamais `preferred_username`. */
  readonly email: string | null;
  readonly emailVerifie: boolean;
  /** Rôle déduit du claim configuré ; `null` : pas de claim de rôle configuré. */
  readonly role: "admin" | "viewer" | null;
  /** Applications du claim configuré (jamais `null` : l'IdP ne donne pas la portée plateforme) ; `undefined` : non fournies. */
  readonly apps: readonly string[] | undefined;
}

interface Meta {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export interface Oidc {
  debut(): Promise<{ url: string; transaction: string }>;
  fin(retour: { code: string; state: string; transaction: string }): Promise<IdentiteSso>;
}

const DUREE_TRANSACTION_S = 600;
const DELAI_RESEAU_MS = 5_000;
const CACHE_MS = 10 * 60_000;

function b64url(octets: Uint8Array): string {
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const aleatoire = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Un refus de SSO : sa raison va au journal d'audit, jamais au navigateur. */
export class RefusSso extends Error {
  constructor(readonly raison: string) {
    super(`SSO refusé : ${raison}`);
    this.name = "RefusSso";
  }
}

function tableau(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? [v] : [];
}

/** Les claims d'un ID token VÉRIFIÉ → ce que l'IdP atteste. */
export function identiteDesClaims(claims: Record<string, unknown>, cfg: ConfigOidc): IdentiteSso {
  if (typeof claims.iss !== "string" || typeof claims.sub !== "string" || !claims.sub) throw new RefusSso("jeton_sans_sujet");
  const email = typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim().toLowerCase() : null;
  const role = cfg.roleClaim ? (tableau(claims[cfg.roleClaim]).some((v) => cfg.adminValues.includes(v)) ? "admin" : "viewer") : null;
  const apps = cfg.appsClaim && cfg.appsClaim in claims ? tableau(claims[cfg.appsClaim]) : undefined;
  return { iss: claims.iss, sub: claims.sub, email, emailVerifie: claims.email_verified === true, role, apps };
}

/** L'adresse est-elle dans un domaine autorisé ? (Comparaison exacte du domaine, en minuscules.) */
export function domaineAutorise(email: string, cfg: Pick<ConfigOidc, "domainesAutorises">): boolean {
  const domaine = email.split("@").pop() ?? "";
  return cfg.domainesAutorises.some((d) => d.toLowerCase() === domaine);
}

export function creerOidc(cfg: ConfigOidc, deps: { fetch?: typeof fetch; horloge?: () => number } = {}): Oidc {
  const recuperer = deps.fetch ?? fetch;
  const horloge = deps.horloge ?? (() => Date.now());
  let meta: { valeur: Meta; jusqua: number } | null = null;
  let jwks: { valeur: ReturnType<typeof createLocalJWKSet>; jusqua: number } | null = null;

  async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await recuperer(url, { ...init, redirect: "error", signal: AbortSignal.timeout(DELAI_RESEAU_MS) });
    if (!res.ok) throw new RefusSso(`idp_${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async function decouverte(): Promise<Meta> {
    if (meta && meta.jusqua > horloge()) return meta.valeur;
    const m = (await json(`${cfg.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`)) as unknown as Meta;
    // L'émetteur ANNONCÉ doit être celui qu'on a configuré : sinon une découverte
    // détournée fournirait ses propres clés.
    if (m.issuer !== cfg.issuer) throw new RefusSso("emetteur_inattendu");
    for (const champ of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
      const u = m[champ];
      // https, sauf un IdP de développement sur la boucle locale.
      if (typeof u !== "string" || !(u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u))) {
        throw new RefusSso("decouverte_incomplete");
      }
    }
    meta = { valeur: m, jusqua: horloge() + CACHE_MS };
    return m;
  }

  async function cles(m: Meta, rafraichir = false) {
    if (!rafraichir && jwks && jwks.jusqua > horloge()) return jwks.valeur;
    const jeu = (await json(m.jwks_uri)) as unknown as JSONWebKeySet;
    jwks = { valeur: createLocalJWKSet(jeu), jusqua: horloge() + CACHE_MS };
    return jwks.valeur;
  }

  return {
    async debut() {
      const m = await decouverte();
      const verifier = aleatoire(32);
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const state = aleatoire(24);
      const nonce = aleatoire(24);
      const exp = Math.floor(horloge() / 1000) + DUREE_TRANSACTION_S;
      const transaction = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({ state, nonce, verifier, exp })))
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .encrypt(cfg.cleTransaction);
      const url = new URL(m.authorization_endpoint);
      for (const [k, v] of Object.entries({
        response_type: "code",
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: cfg.scopes,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })) url.searchParams.set(k, v);
      return { url: url.toString(), transaction };
    },

    async fin(retour) {
      let tx: { state?: unknown; nonce?: unknown; verifier?: unknown; exp?: unknown };
      try {
        const { plaintext } = await compactDecrypt(retour.transaction, cfg.cleTransaction, { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
        tx = JSON.parse(new TextDecoder().decode(plaintext));
      } catch {
        throw new RefusSso("transaction_illisible");
      }
      if (typeof tx.exp !== "number" || tx.exp * 1000 < horloge()) throw new RefusSso("transaction_expiree");
      if (typeof tx.state !== "string" || tx.state !== retour.state) throw new RefusSso("etat_different");
      if (typeof tx.nonce !== "string" || typeof tx.verifier !== "string") throw new RefusSso("transaction_illisible");

      const m = await decouverte();
      const jetons = await json(m.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: retour.code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code_verifier: tx.verifier,
        }),
      });
      if (typeof jetons.id_token !== "string") throw new RefusSso("id_token_absent");

      const verifier = async (rafraichir: boolean) =>
        jwtVerify(jetons.id_token as string, await cles(m, rafraichir), { issuer: cfg.issuer, audience: cfg.clientId });
      let claims: Record<string, unknown>;
      try {
        claims = (await verifier(false)).payload as Record<string, unknown>;
      } catch (e) {
        // Une clé inconnue : l'IdP a peut-être tourné ses clés — on relit le jeu une fois.
        if ((e as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw new RefusSso("id_token_invalide");
        try {
          claims = (await verifier(true)).payload as Record<string, unknown>;
        } catch {
          throw new RefusSso("id_token_invalide");
        }
      }
      if (claims.nonce !== tx.nonce) throw new RefusSso("nonce_different");
      return identiteDesClaims(claims, cfg);
    },
  };
}
