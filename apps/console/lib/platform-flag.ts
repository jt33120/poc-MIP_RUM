// Drapeaux de plateforme (`platform_flag`, migration-v87), lus par la console.
//
// SERVEUR SEULEMENT : ce module lit la base par le pool de la console. Il n'est
// importé que par le relais de l'API v1 (`lib/api-relay.ts`) et l'aiguillage
// vers console-api (`lib/ecran.ts`) — jamais par un composant client. (Le
// drapeau de la collecte, `ingest_relay_pct`, n'est plus lu depuis C12 : la
// console relaie toute la collecte.)
//
// POURQUOI UN CACHE DE 30 S. Un drapeau est consulté à CHAQUE requête
// relayable. Une requête SQL de plus par requête doublerait les allers-retours
// pour lire une valeur qui change quelques fois par semaine. 30 s, c'est le
// délai promis au coupe-circuit : un `update …
// set value = '0'` est vu par toutes les instances en moins de 30 s (chaque
// instance serverless tient son propre cache ; aucune ne le garde plus longtemps).
//
// JAMAIS D'EXCEPTION, ET C'EST LE CONTRAT (expand / contract). Le code part
// AVANT la migration : tant que le scheduler n'a pas appliqué v87, la table
// n'existe pas (`42P01`). Et la base peut être injoignable, suspendue
// (incident Neon du 24/09) ou lente. Dans TOUS ces cas la lecture rend `null`
// et l'appelant retombe sur son défaut d'environnement. Un drapeau illisible ne
// doit jamais faire tomber une route : il la ramène au comportement par défaut.
//
// L'échec lui aussi est mis en cache 30 s : une base coupée ne doit pas être
// relancée à chaque beacon (ni rallonger chaque beacon du délai de connexion).
// Et la lecture est bornée (`DELAI_LECTURE_MS`) : au-delà, défaut.
import { pool } from "./db";
import { createLogger } from "./journal";

// Son propre journal : l'API de lecture lit aussi ce module (relais de l'API v1),
// et le service `api`, qui compile ces routes, n'a pas à tirer le journal de la
// collecte.
const log = createLogger("platform-flag");

/** Durée de vie d'une valeur lue (ou d'un échec de lecture). */
export const TTL_DRAPEAU_MS = 30_000;
/** Au-delà, la lecture est abandonnée et le défaut s'applique. */
export const DELAI_LECTURE_MS = 1_500;

/** Clé du pourcentage de relais de l'API de lecture v1 vers le service `api` (P4). */
export const CLE_RELAIS_API = "api_relay_pct";
/**
 * La bascule vers console-api (après P6b) : la part des SESSIONS dont les écrans
 * (et la coquille), puis les écritures, passent par le service. Deux clés : les
 * lectures montent d'abord, les écritures ensuite (`lib/aiguillage-console-api.ts`).
 */
export const CLE_CONSOLE_API = Object.freeze({ ecrans: "console_api_ecrans_pct", commandes: "console_api_commandes_pct" });
/** Les défauts d'environnement des deux pourcentages, quand la base ne dit rien. */
const DEFAUT_CONSOLE_API = Object.freeze({ ecrans: "CONSOLE_API_ECRANS_PCT", commandes: "CONSOLE_API_COMMANDES_PCT" });

type Requeteur = (sql: string, params: unknown[]) => Promise<{ rows: Array<{ value: unknown }> }>;

type Entree = { valeur: string | null; expire: number };

/**
 * Lecteur de drapeaux, injectable pour les tests. `lire(cle)` rend la valeur
 * brute, ou `null` (ligne absente, table absente, base en erreur, délai
 * dépassé). Ne lève jamais.
 */
export function creerLecteurDrapeaux(deps: {
  requete: Requeteur;
  maintenant?: () => number;
  ttlMs?: number;
  delaiMs?: number;
}) {
  const maintenant = deps.maintenant ?? Date.now;
  const ttlMs = deps.ttlMs ?? TTL_DRAPEAU_MS;
  const delaiMs = deps.delaiMs ?? DELAI_LECTURE_MS;
  const cache = new Map<string, Entree>();
  // Une seule lecture en vol par clé : cinquante beacons simultanés à
  // l'expiration du cache ne font qu'UNE requête.
  const enVol = new Map<string, Promise<string | null>>();
  // Une ligne de journal par changement d'état, pas par lecture.
  let dernierEtat: "ok" | "absente" | "erreur" | null = null;

  const noter = (etat: "ok" | "absente" | "erreur", champs: Record<string, unknown> = {}) => {
    if (etat === dernierEtat) return;
    dernierEtat = etat;
    if (etat === "ok") log.info("platform_flag lisible", champs);
    else log.warn("platform_flag illisible : défaut d'environnement", { etat, ...champs });
  };

  async function interroger(cle: string): Promise<string | null> {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const expiration = new Promise<"delai">((resoudre) => {
      minuteur = setTimeout(() => resoudre("delai"), delaiMs);
    });
    try {
      const issue = await Promise.race([
        deps.requete("select value from platform_flag where key = $1", [cle]),
        expiration,
      ]);
      if (issue === "delai") {
        noter("erreur", { raison: "delai" });
        return null;
      }
      noter("ok");
      const v = issue.rows[0]?.value;
      return typeof v === "string" ? v : null;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? null;
      // 42P01 : la migration v87 n'est pas encore passée — cas NORMAL de la
      // fenêtre de déploiement, distingué dans le journal pour ne pas le lire
      // comme une panne.
      noter(code === "42P01" ? "absente" : "erreur", { code });
      return null;
    } finally {
      clearTimeout(minuteur);
    }
  }

  async function lire(cle: string): Promise<string | null> {
    const t = maintenant();
    const connue = cache.get(cle);
    if (connue && connue.expire > t) return connue.valeur;
    const courante = enVol.get(cle);
    if (courante) return courante;
    const promesse = interroger(cle)
      .catch(() => null)
      .then((valeur) => {
        cache.set(cle, { valeur, expire: maintenant() + ttlMs });
        return valeur;
      })
      .finally(() => enVol.delete(cle));
    enVol.set(cle, promesse);
    return promesse;
  }

  return { lire, vider: () => cache.clear() };
}

/**
 * Pourcentage entier 0–100 écrit sans fioriture (la contrainte de v87 impose
 * la même forme en base). Rend `null` si la valeur n'en est pas un.
 */
export function lirePourcentage(brut: string | null | undefined): number | null {
  if (brut == null) return null;
  const v = brut.trim();
  if (!/^(100|[1-9]?[0-9])$/.test(v)) return null;
  return Number(v);
}

// Un lecteur par instance. Pas sur `globalThis` : ce n'est qu'un cache, le
// perdre au rechargement à chaud de `next dev` coûte une requête.
const lecteur = creerLecteurDrapeaux({
  requete: (sql, params) => pool.query(sql, params),
});

/**
 * Pourcentage de relais de l'API v1 (P4) : la base si elle répond avec une valeur
 * valide, sinon `API_RELAY_PCT`, sinon 0. Ne lève jamais.
 */
export async function pourcentageRelaisApi(): Promise<number> {
  const pct = lirePourcentage(await lecteur.lire(CLE_RELAIS_API));
  return pct ?? lirePourcentage(process.env.API_RELAY_PCT) ?? 0;
}

/**
 * La part des sessions servies par console-api, pour les écrans ou pour les
 * écritures : la base si elle répond avec une valeur valide, sinon
 * `CONSOLE_API_ECRANS_PCT` / `CONSOLE_API_COMMANDES_PCT`, sinon 0. Ne lève jamais.
 */
export async function pourcentageConsoleApi(famille: keyof typeof CLE_CONSOLE_API): Promise<number> {
  const pct = lirePourcentage(await lecteur.lire(CLE_CONSOLE_API[famille]));
  return pct ?? lirePourcentage(process.env[DEFAUT_CONSOLE_API[famille]]) ?? 0;
}

/** Tests seulement : oublie les valeurs en cache. */
export function _resetPlatformFlagCache(): void {
  lecteur.vider();
}
