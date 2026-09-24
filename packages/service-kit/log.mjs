// Journal structuré : une ligne JSON par événement, sur stdout (debug/info) ou
// stderr (warn/error). C'est LE logger de tous les services et du noyau.
//
// POURQUOI UN SEUL. Repris de `@mip/backend/shared/log.mjs`, qui le RÉEXPORTE
// désormais tel quel : ce qui ne doit jamais sortir dans un journal (secret,
// adresse IP, identité brute) se décide à un seul endroit. Deux loggers, c'est
// deux listes d'expurgation qui divergent au premier ajout.
//
// Ce que le kit ajoute à la version d'origine, et pourquoi :
//   - `version` et `replica` sur chaque ligne. Sur Railway, deux répliques et un
//     déploiement qui chevauche le précédent écrivent dans le même flux : sans
//     ces deux champs, on ne sait pas QUEL processus a parlé. `replica` vient de
//     RAILWAY_REPLICA_ID ; `version` de SERVICE_VERSION, à défaut des douze
//     premiers caractères de RAILWAY_GIT_COMMIT_SHA. Absents hors Railway : le
//     champ est alors omis, pas rempli d'un « inconnu » qui ferait du bruit.
//   - `request_id` / `run_id` sans passer un logger de main en main. Le noyau
//     crée ses loggers au niveau du module (`createLogger("ingest")`) : pour
//     qu'une ligne émise au fond du pipeline porte l'identifiant de la requête
//     en cours, le logger interroge un FOURNISSEUR DE CONTEXTE, que
//     `context.mjs` branche sur AsyncLocalStorage. Ce module-ci n'importe rien
//     de `node:` (voir plus bas), d'où l'indirection.
//   - la PILE COMPLÈTE des erreurs, `cause` comprise. L'ancienne version ne
//     gardait que `{name, message, code}` : un « Connection terminated » sans
//     pile ne dit pas quelle requête l'a subi.
//   - JAMAIS D'IP. Une adresse IP est une donnée personnelle ; la collecte en
//     voit passer des milliers. Les clés qui la portent (`ip`, `x-forwarded-for`,
//     `remote_addr`…) sont expurgées comme des secrets, même glissées dans un
//     objet d'en-têtes. Même chose pour l'e-mail (identité brute).
//
// RUNTIME-AGNOSTIQUE, À DESSEIN : aucun import `node:`. La console Next importe
// ce module (via @mip/backend/shared/log.mjs) dans ses routes ; un import de
// `node:async_hooks` ici suffirait à le rendre inutilisable ailleurs.
//
// Garantie héritée : le journal ne casse JAMAIS l'appelant — aucune exception
// ne remonte d'un appel de log, quoi qu'on lui passe (cycle, BigInt, getter qui
// lève).

export const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 99 });

/** Lecture d'env qui ne lève jamais (process absent, accès refusé). */
function lireEnv(nom) {
  try {
    return typeof process !== "undefined" ? process.env?.[nom] : undefined;
  } catch {
    return undefined;
  }
}

// Clés dont la valeur ne sort jamais en clair. Correspondance EXACTE (insensible
// à la casse) : `secret_configure: true` doit rester lisible, `secret` non.
const CLES_SECRETES =
  /^(api[-_]?key|x[-_]api[-_]key|authorization|proxy[-_]authorization|password|passwd|secret|client[-_]secret|token|access[-_]token|refresh[-_]token|id[-_]token|service[-_]role|cookie|set[-_]cookie|database[-_]url|connection[-_]?string)$/i;

// Clés qui portent une adresse IP ou une identité brute. Même traitement que les
// secrets : la VALEUR disparaît, la clé reste (savoir qu'elle était là aide).
const CLES_PERSONNELLES =
  /^(ip|ips|ip[-_]?addr(ess)?|client[-_]?ip|remote[-_]?(addr(ess)?|ip)|x[-_]forwarded[-_]for|x[-_]real[-_]ip|cf[-_]connecting[-_]ip|true[-_]client[-_]ip|fly[-_]client[-_]ip|forwarded|e[-_]?mail|user[-_]?e[-_]?mail)$/i;

// Au-delà, un objet est tronqué plutôt que recopié. L'ancienne version RENDAIT
// l'objet tel quel passé la profondeur 4 — donc sans expurgation : un secret
// enfoui assez loin sortait en clair.
const PROFONDEUR_MAX = 6;

/** Vrai pour une Error, y compris venue d'un autre royaume (vm, worker). */
function estErreur(v) {
  return v instanceof Error || Object.prototype.toString.call(v) === "[object Error]";
}

/**
 * Remplace récursivement les valeurs sensibles par "[redacted]".
 * `ancetres` coupe les cycles ICI, avant `serialiser` : sans lui, un objet qui
 * se contient serait recopié jusqu'à la profondeur maximale — six copies de
 * lui-même dans la ligne au lieu d'un « [circular] ».
 */
function expurger(valeur, profondeur = 0, ancetres = new Set()) {
  if (valeur == null || typeof valeur !== "object") return valeur;
  // Les Error passent intactes : `serialiser` en extrait les champs utiles, et
  // n'en recopie jamais les propriétés arbitraires (une lib y range parfois sa
  // configuration, mot de passe compris).
  if (estErreur(valeur)) return valeur;
  if (ancetres.has(valeur)) return "[circular]";
  if (profondeur >= PROFONDEUR_MAX) return "[tronqué]";
  ancetres.add(valeur);
  try {
    if (Array.isArray(valeur)) return valeur.map((v) => expurger(v, profondeur + 1, ancetres));
    const sortie = {};
    for (const [cle, v] of Object.entries(valeur)) {
      sortie[cle] =
        CLES_SECRETES.test(cle) || CLES_PERSONNELLES.test(cle) ? "[redacted]" : expurger(v, profondeur + 1, ancetres);
    }
    return sortie;
  } finally {
    // Un objet PARTAGÉ (deux branches pointent dessus) n'est pas un cycle : on
    // le retire en remontant, pour qu'il soit recopié dans chaque branche.
    ancetres.delete(valeur);
  }
}

/**
 * Sérialisation défensive : BigInt → chaîne, cycles coupés, Error → objet avec
 * sa pile complète et sa cause. `detail` des erreurs pg n'est PAS repris : il
 * recopie les valeurs fautives (« Key (email)=(…) already exists »).
 */
function serialiser(objet) {
  const vus = new WeakSet();
  return JSON.stringify(objet, (_cle, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v !== null && typeof v === "object") {
      if (vus.has(v)) return "[circular]";
      vus.add(v);
      if (estErreur(v)) {
        const e = { name: v.name, message: v.message };
        if (v.code !== undefined) e.code = v.code;
        if (typeof v.stack === "string") e.stack = v.stack;
        if (v.cause !== undefined) e.cause = v.cause;
        if (Array.isArray(v.errors)) e.errors = v.errors; // AggregateError
        return e;
      }
    }
    return v;
  });
}

// --- Contexte (request_id, run_id) ---------------------------------------------
// Rangé sur `globalThis` sous un symbole partagé, et pas dans une variable de
// module : si deux copies de ce fichier finissaient chargées (un bundler, une
// installation dédoublée), elles liraient quand même le même fournisseur.
const CLE_CONTEXTE = Symbol.for("@mip/service-kit/log#contexte");

/**
 * Branche le fournisseur de contexte : une fonction sans argument qui rend les
 * champs à ajouter à chaque ligne (`{ request_id }`, `{ run_id }`), ou rien.
 * `context.mjs` le fait à son import ; un test peut le remplacer.
 * @param {(() => Record<string, unknown> | undefined) | null} fournisseur
 */
export function setLogContextProvider(fournisseur) {
  globalThis[CLE_CONTEXTE] = typeof fournisseur === "function" ? fournisseur : null;
}

function contexteCourant() {
  try {
    const c = globalThis[CLE_CONTEXTE]?.();
    return c && typeof c === "object" ? c : null;
  } catch {
    return null; // un fournisseur qui lève ne coûte que le contexte, pas la ligne
  }
}

/** Version courte et stable : le SHA entier alourdit chaque ligne pour rien. */
function versionParDefaut() {
  const explicite = lireEnv("SERVICE_VERSION");
  if (explicite) return explicite;
  const sha = lireEnv("RAILWAY_GIT_COMMIT_SHA");
  return sha ? sha.slice(0, 12) : undefined;
}

const SORTIE_CONSOLE = {
  // warn/error → stderr : les collecteurs de journaux séparent les deux flux.
  out: (ligne) => console.log(ligne),
  err: (ligne) => console.error(ligne),
};

/**
 * @typedef {object} Logger
 * @property {(msg: string, fields?: object) => void} debug
 * @property {(msg: string, fields?: object) => void} info
 * @property {(msg: string, fields?: object) => void} warn
 * @property {(msg: string, fields?: object) => void} error
 * @property {(bound: object) => Logger} child  sous-logger aux champs hérités
 */

/**
 * Logger lié à un service (ou à un composant : « ingest », « v1-traces »).
 *
 * @param {string} service
 * @param {{ version?: string, replica?: string, level?: string,
 *           sink?: { out: (l: string) => void, err: (l: string) => void } }} [options]
 *   Tout est facultatif : par défaut `version` et `replica` viennent de l'env
 *   Railway, `level` de LOG_LEVEL, et la sortie est la console.
 * @returns {Logger}
 */
export function createLogger(service, options = {}) {
  const nomNiveau = String(options.level ?? lireEnv("LOG_LEVEL") ?? "info").toLowerCase();
  const seuil = LOG_LEVELS[nomNiveau] ?? LOG_LEVELS.info;
  const sortie = options.sink ?? SORTIE_CONSOLE;

  // Champs d'identité du processus, calculés UNE fois : ils ne changent pas
  // pendant la vie du processus, et relire l'env à chaque ligne coûte.
  const identite = {};
  const version = options.version ?? versionParDefaut();
  const replica = options.replica ?? lireEnv("RAILWAY_REPLICA_ID");
  if (version) identite.version = version;
  if (replica) identite.replica = replica;

  function emettre(niveau, msg, lies, champs) {
    if (LOG_LEVELS[niveau] < seuil) return;
    let ligne;
    try {
      ligne = serialiser({
        ts: new Date().toISOString(),
        level: niveau,
        service,
        ...identite,
        msg: String(msg),
        ...expurger(contexteCourant() ?? {}),
        ...expurger(lies ?? {}),
        ...expurger(champs ?? {}),
      });
    } catch {
      // Dernier recours (getter qui lève, objet exotique) : une ligne minimale
      // plutôt que rien — et surtout pas une exception chez l'appelant.
      ligne = `{"level":"${niveau}","service":${JSON.stringify(String(service))},"msg":${JSON.stringify(String(msg))}}`;
    }
    try {
      if (niveau === "error" || niveau === "warn") sortie.err(ligne);
      else sortie.out(ligne);
    } catch {
      /* flux fermé (EPIPE) : le journal ne casse jamais l'appelant */
    }
  }

  function construire(lies) {
    const a = (niveau) => (msg, champs) => emettre(niveau, msg, lies, champs);
    return {
      debug: a("debug"),
      info: a("info"),
      warn: a("warn"),
      error: a("error"),
      child: (encore) => construire({ ...(lies ?? {}), ...(encore ?? {}) }),
    };
  }

  return construire(null);
}
