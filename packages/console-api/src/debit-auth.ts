// LE DÉBIT D'AUTHENTIFICATION : des compteurs en base, partagés entre répliques.
//
// Aujourd'hui la console compte ses échecs de connexion EN MÉMOIRE, par instance
// serverless : un attaquant qui tombe sur une instance neuve repart de zéro. Ici,
// les compteurs vivent dans `auth_throttle` (migration-v90) et valent pour toutes
// les répliques. Ils sont vérifiés AVANT bcrypt : un compte bloqué ne coûte pas
// un calcul de hachage.
//
// La clé d'un compteur est `<compteur>:<HMAC-SHA256>` — jamais une IP ni un
// e-mail en clair ; la contrainte de v90 refuse toute autre forme. La clé HMAC
// est DÉRIVÉE (HKDF, séparation de domaine) du secret client du service : pas de
// variable de plus à poser, et une rotation du secret remet simplement les
// compteurs à zéro — ils ne vivent qu'une heure.
import type { Lecteur } from "./contexte";

export type Compteur = "ip_email" | "ip" | "email" | "demo_ip";

export interface Regle {
  /** Au-delà de ce nombre d'événements dans la fenêtre, le compteur bloque. */
  readonly max: number;
  readonly fenetreS: number;
  /** Premier blocage, puis doublé à chaque événement de plus, jusqu'au plafond. */
  readonly blocageS: number;
  readonly plafondS: number;
}

/**
 * Les règles du plan (C1) :
 *   · IP + e-mail : 8 échecs par 10 min — le bourrage d'un compte depuis un poste ;
 *   · IP seule : 30 échecs par 10 min — un poste qui essaie beaucoup de comptes ;
 *   · e-mail : 20 échecs par heure, puis un délai qui double (1 min → 1 h) — un
 *     compte visé depuis beaucoup d'adresses ;
 *   · démo : 5 sessions par heure et par IP (chaque ouverture compte, pas les échecs).
 */
export const REGLES: Readonly<Record<Compteur, Regle>> = Object.freeze({
  ip_email: { max: 8, fenetreS: 600, blocageS: 600, plafondS: 600 },
  ip: { max: 30, fenetreS: 600, blocageS: 600, plafondS: 600 },
  email: { max: 20, fenetreS: 3600, blocageS: 60, plafondS: 3600 },
  demo_ip: { max: 5, fenetreS: 3600, blocageS: 3600, plafondS: 3600 },
});

export interface DebitAuth {
  /** La clé d'un compteur pour une valeur (IP, e-mail, ou `ip\ne-mail`). */
  cle(compteur: Compteur, valeur: string): Promise<string>;
  /** Secondes à attendre si l'une des clés est bloquée, 0 sinon. */
  attente(db: Lecteur, cles: readonly string[]): Promise<number>;
  /** Compte un événement ; rend l'attente qu'il déclenche (0 si aucune). */
  compter(db: Lecteur, cle: string, compteur: Compteur): Promise<number>;
  /** Efface des compteurs (une connexion réussie). */
  effacer(db: Lecteur, cles: readonly string[]): Promise<void>;
}

const texte = (s: string) => new TextEncoder().encode(s);

export async function creerDebitAuth(secretClient: string): Promise<DebitAuth> {
  const materiau = await crypto.subtle.importKey("raw", texte(secretClient) as BufferSource, "HKDF", false, ["deriveKey"]);
  const cleHmac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: texte("mip-console-api") as BufferSource, info: texte("auth-throttle/v1") as BufferSource },
    materiau,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );

  return {
    async cle(compteur, valeur) {
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cleHmac, texte(`${compteur}\n${valeur.trim().toLowerCase()}`) as BufferSource));
      return `${compteur}:${[...mac].map((o) => o.toString(16).padStart(2, "0")).join("")}`;
    },

    async attente(db, cles) {
      const { rows } = await db.query<{ s: number | null }>(
        "select ceil(extract(epoch from max(blocked_until) - now()))::int as s from auth_throttle where key = any($1::text[]) and blocked_until > now()",
        [cles],
      );
      return Math.max(0, rows[0]?.s ?? 0);
    },

    async compter(db, cle, compteur) {
      const r = REGLES[compteur];
      // Une fenêtre échue repart à 1 ; au-delà de `max`, le blocage double à
      // chaque événement de plus, jusqu'au plafond. Le comptage est atomique (un
      // seul `insert … on conflict`) : deux répliques qui comptent en même temps
      // ne perdent pas d'événement.
      const { rows } = await db.query<{ failures: number }>(
        `insert into auth_throttle (key, window_start, failures, updated_at)
         values ($1, now(), 1, now())
         on conflict (key) do update set
           failures = case when auth_throttle.window_start < now() - make_interval(secs => $2) then 1 else auth_throttle.failures + 1 end,
           window_start = case when auth_throttle.window_start < now() - make_interval(secs => $2) then now() else auth_throttle.window_start end,
           updated_at = now()
         returning failures`,
        [cle, r.fenetreS],
      );
      const n = rows[0]?.failures ?? 0;
      if (n < r.max) return 0;
      const s = Math.min(r.plafondS, r.blocageS * 2 ** (n - r.max));
      await db.query("update auth_throttle set blocked_until = now() + make_interval(secs => $2) where key = $1", [cle, s]);
      return s;
    },

    async effacer(db, cles) {
      if (cles.length) await db.query("delete from auth_throttle where key = any($1::text[])", [cles]);
    },
  };
}
