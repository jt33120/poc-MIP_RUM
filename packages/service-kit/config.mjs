// Configuration d'un service : un schéma déclaratif, lu UNE fois au démarrage,
// et un refus de démarrer qui dit TOUT ce qui ne va pas.
//
// POURQUOI « TOUTES LES ERREURS D'UN COUP ». Un service qui s'arrête à la
// première variable manquante fait payer un déploiement par variable : on pose
// DATABASE_URL, on redéploie, il réclame METRICS_TOKEN, on redéploie… Sur
// Railway chaque tour coûte une construction d'image. La liste complète sort en
// une ligne de journal, et le processus quitte avec le code 2 — celui que les
// services utilisent déjà pour « refus de démarrer » (`worker.mjs`, `server.mjs`).
//
// POURQUOI UNE VARIABLE VIDE COMPTE COMME ABSENTE. Le tableau de bord Railway
// laisse créer une variable sans valeur, et c'est arrivé : le relevé du
// 23/09/2026 a trouvé `IDENTITY_HASH_SECRET` posé mais VIDE sur Vercel. Un
// `process.env.X ?? défaut` ne voit pas la différence entre « vide » et
// « valeur » ; ici, "" et "   " déclenchent le défaut, ou l'erreur si la
// variable est obligatoire.
//
// POURQUOI LE JOURNAL DE DÉMARRAGE EST EXPURGÉ PAR LE SCHÉMA, et pas seulement
// par la liste de clés de `log.mjs` : `METRICS_TOKEN` ou `CONSOLE_API_CLIENT_SECRET`
// ne correspondent à aucun motif générique. C'est le schéma qui sait qu'une
// variable est secrète (`secret: true`), et alors sa valeur ne sort JAMAIS — ni
// dans le journal de démarrage, ni dans un message d'erreur de validation.
//
// Zéro dépendance : pas de zod ni de convict. Huit types suffisent à la
// configuration d'un service ; le reste est une fonction `validate`.
import { createLogger } from "./log.mjs";

const TYPES = new Set(["string", "int", "number", "bool", "port", "url", "enum", "list"]);

/**
 * @typedef {object} VarSpec
 * @property {"string"|"int"|"number"|"bool"|"port"|"url"|"enum"|"list"} type
 * @property {string} [description]   une phrase, reprise par --print-env-example
 * @property {boolean} [required]     absente ou vide → refus de démarrer
 * @property {unknown} [default]      valeur si absente ou vide (interdit avec `secret`)
 * @property {boolean} [secret]       jamais journalisée, jamais citée dans une erreur
 * @property {number} [min]           int, number : borne incluse
 * @property {number} [max]           int, number : borne incluse
 * @property {number} [minLength]     string : longueur minimale
 * @property {RegExp} [pattern]       string : format attendu
 * @property {string[]} [values]      enum : valeurs admises ; list : éléments admis
 * @property {string[]} [protocols]   url : protocoles admis, ex. ["postgres:", "postgresql:"]
 * @property {string} [example]       valeur d'exemple pour --print-env-example (jamais pour un secret)
 * @property {(valeur: any) => string | undefined | null} [validate]
 *   contrôle final sur la valeur CONVERTIE ; rend un message d'erreur, ou rien.
 *   Le message ne doit pas citer la valeur d'un secret : c'est à l'auteur du
 *   schéma d'y veiller.
 */

/**
 * Les variables que tout service du kit partage. À étaler dans son propre
 * schéma : `defineConfig({ ...COMMON_ENV, DATABASE_URL: {…} })`.
 * @type {Readonly<Record<string, VarSpec>>}
 */
export const COMMON_ENV = Object.freeze({
  PORT: { type: "port", default: 8080, description: "Port d'écoute HTTP, imposé par Railway." },
  LOG_LEVEL: {
    type: "enum",
    values: ["debug", "info", "warn", "error", "silent"],
    default: "info",
    description: "Seuil du journal.",
  },
  METRICS_TOKEN: {
    type: "string",
    secret: true,
    minLength: 32,
    description: "Jeton exigé par /ready et /metrics. Absent : les deux répondent 404.",
  },
  RAILWAY_DEPLOYMENT_DRAINING_SECONDS: {
    type: "int",
    min: 0,
    max: 3600,
    description: "Délai entre SIGTERM et SIGKILL (Railway). À poser explicitement : 15 à 30 s.",
  },
});

/** Faute de PROGRAMMATION dans un schéma : on lève tout de suite, au chargement. */
function verifierSchema(schema) {
  if (!schema || typeof schema !== "object") throw new TypeError("defineConfig : schéma attendu");
  for (const [nom, spec] of Object.entries(schema)) {
    if (!spec || !TYPES.has(spec.type)) {
      throw new TypeError(`defineConfig : ${nom} — type inconnu « ${spec?.type} » (${[...TYPES].join(", ")})`);
    }
    if (spec.secret && spec.default !== undefined) {
      // Un défaut de secret, c'est un secret commité dans le dépôt.
      throw new TypeError(`defineConfig : ${nom} — un secret ne peut pas avoir de valeur par défaut`);
    }
    if (spec.required && spec.default !== undefined) {
      throw new TypeError(`defineConfig : ${nom} — « required » et « default » s'excluent`);
    }
    if (spec.type === "enum" && !(Array.isArray(spec.values) && spec.values.length)) {
      throw new TypeError(`defineConfig : ${nom} — un enum exige « values »`);
    }
  }
}

/** Une valeur citable dans un message d'erreur : courte, et jamais un secret. */
function citer(spec, brut) {
  if (spec.secret) return "";
  const court = brut.length > 60 ? `${brut.slice(0, 57)}…` : brut;
  return ` (« ${court} »)`;
}

/** Convertit et valide une valeur brute non vide. Rend `{ valeur }` ou `{ erreur }`. */
function convertir(spec, brut) {
  const c = citer(spec, brut);
  switch (spec.type) {
    case "string": {
      if (spec.minLength != null && brut.length < spec.minLength) {
        return { erreur: `trop courte : ${spec.minLength} caractères au minimum${c}` };
      }
      if (spec.pattern && !spec.pattern.test(brut)) return { erreur: `format inattendu${c}` };
      return { valeur: brut };
    }
    case "int":
    case "port": {
      if (!/^[+-]?\d+$/.test(brut)) return { erreur: `entier attendu${c}` };
      const n = Number(brut);
      if (!Number.isSafeInteger(n)) return { erreur: `entier hors limites${c}` };
      const min = spec.type === "port" ? 1 : spec.min;
      const max = spec.type === "port" ? 65535 : spec.max;
      if (min != null && n < min) return { erreur: `doit valoir au moins ${min}${c}` };
      if (max != null && n > max) return { erreur: `doit valoir au plus ${max}${c}` };
      return { valeur: n };
    }
    case "number": {
      const n = Number(brut);
      if (!Number.isFinite(n)) return { erreur: `nombre attendu${c}` };
      if (spec.min != null && n < spec.min) return { erreur: `doit valoir au moins ${spec.min}${c}` };
      if (spec.max != null && n > spec.max) return { erreur: `doit valoir au plus ${spec.max}${c}` };
      return { valeur: n };
    }
    case "bool": {
      // Strict, à dessein : « oui », « on », « yes » ne passent pas. Une faute de
      // frappe dans un drapeau de sécurité (REQUIRE_API_KEY=ture) doit arrêter
      // le déploiement, pas valoir `false` en silence.
      const v = brut.toLowerCase();
      if (v === "true" || v === "1") return { valeur: true };
      if (v === "false" || v === "0") return { valeur: false };
      return { erreur: `booléen attendu : true, false, 1 ou 0${c}` };
    }
    case "url": {
      // Une URL n'est JAMAIS citée, même non secrète : une URL de base de
      // données collée dans la mauvaise variable porterait son mot de passe
      // jusque dans le message d'erreur.
      let u;
      try {
        u = new URL(brut);
      } catch {
        return { erreur: "URL invalide" };
      }
      if (spec.protocols && !spec.protocols.includes(u.protocol)) {
        return { erreur: `protocole « ${u.protocol} » refusé (attendu : ${spec.protocols.join(", ")})` };
      }
      return { valeur: brut };
    }
    case "enum": {
      if (!spec.values.includes(brut)) return { erreur: `valeur hors liste (attendu : ${spec.values.join(", ")})${c}` };
      return { valeur: brut };
    }
    case "list": {
      const elements = brut
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (spec.values) {
        const inconnus = elements.filter((e) => !spec.values.includes(e));
        if (inconnus.length) {
          const cites = spec.secret ? "" : ` (« ${inconnus.join(", ")} »)`;
          return { erreur: `éléments hors liste${cites} (attendu : ${spec.values.join(", ")})` };
        }
      }
      return { valeur: Object.freeze(elements) };
    }
    default:
      return { erreur: "type inconnu" }; // inatteignable : verifierSchema l'a refusé
  }
}

/**
 * Lit l'environnement selon le schéma, SANS effet de bord : ni journal, ni
 * sortie du processus. C'est le cœur testable de `defineConfig`.
 *
 * @param {Record<string, VarSpec>} schema
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ valeurs: Record<string, any>, erreurs: {variable: string, erreur: string}[], sources: Record<string, "env"|"défaut"|"absente"> }}
 */
export function parseConfig(schema, env = process.env) {
  verifierSchema(schema);
  const valeurs = {};
  const sources = {};
  const erreurs = [];
  for (const [nom, spec] of Object.entries(schema)) {
    const brut = env[nom] == null ? "" : String(env[nom]).trim();
    if (brut === "") {
      if (spec.default !== undefined) {
        valeurs[nom] = spec.default;
        sources[nom] = "défaut";
      } else if (spec.required) {
        erreurs.push({ variable: nom, erreur: "obligatoire, absente ou vide" });
      } else {
        valeurs[nom] = undefined;
        sources[nom] = "absente";
      }
      continue;
    }
    const r = convertir(spec, brut);
    if (r.erreur === undefined && spec.validate) {
      const message = spec.validate(r.valeur);
      if (message) r.erreur = String(message);
    }
    if (r.erreur !== undefined) {
      erreurs.push({ variable: nom, erreur: r.erreur });
    } else {
      valeurs[nom] = r.valeur;
      sources[nom] = "env";
    }
  }
  return { valeurs, erreurs, sources };
}

/** Une URL non secrète, montrable : sans identifiants ni paramètres. */
function urlMontrable(brut) {
  try {
    const u = new URL(brut);
    u.username = "";
    u.password = "";
    const avaitParametres = u.search !== "";
    u.search = "";
    return avaitParametres ? `${u.toString()}?…` : u.toString();
  } catch {
    return "[URL illisible]";
  }
}

/**
 * Ce que le journal de démarrage montre de la configuration. Un secret y
 * figure comme « [secret] » s'il est posé : savoir QU'il est posé aide au
 * diagnostic ; sa valeur, jamais.
 */
export function redactConfig(schema, valeurs) {
  const apercu = {};
  for (const [nom, spec] of Object.entries(schema)) {
    const v = valeurs[nom];
    if (v === undefined) apercu[nom] = "(absente)";
    else if (spec.secret) apercu[nom] = "[secret]";
    else if (spec.type === "url") apercu[nom] = urlMontrable(v);
    else apercu[nom] = v;
  }
  return apercu;
}

/**
 * Le gabarit `.env` du service, tiré du schéma : la table d'env du README et
 * le fichier d'exemple ne peuvent plus diverger du code.
 * @param {Record<string, VarSpec>} schema
 * @param {{ service?: string }} [options]
 */
export function envExample(schema, { service } = {}) {
  verifierSchema(schema);
  const lignes = [
    `# Variables d'environnement${service ? ` de ${service}` : ""} — généré par --print-env-example.`,
    "# Une variable obligatoire absente ou vide fait refuser le démarrage (code 2).",
  ];
  for (const [nom, spec] of Object.entries(schema)) {
    const notes = [];
    if (spec.required) notes.push("obligatoire");
    if (spec.secret) notes.push("secret");
    if (spec.default !== undefined) notes.push(`défaut : ${Array.isArray(spec.default) ? spec.default.join(",") : spec.default}`);
    if (spec.type === "enum" || (spec.type === "list" && spec.values)) notes.push(`valeurs : ${spec.values.join(", ")}`);
    lignes.push("", `# ${spec.description ?? nom}${notes.length ? ` (${notes.join(" ; ")})` : ""}`);
    // Une variable facultative sort commentée : décommenter est un choix.
    const exemple = spec.secret ? "" : (spec.example ?? (spec.default !== undefined ? String(spec.default) : ""));
    lignes.push(`${spec.required ? "" : "# "}${nom}=${exemple}`);
  }
  return `${lignes.join("\n")}\n`;
}

/**
 * Lit et valide la configuration, ou arrête le processus.
 *
 *   - `--print-env-example` dans argv : écrit le gabarit `.env` et sort (0) ;
 *   - une erreur ou plus : UNE ligne de journal qui les liste TOUTES, sortie (2) ;
 *   - sinon : une ligne « configuration chargée » expurgée, et l'objet figé.
 *
 * `env`, `argv`, `log`, `exit` et `print` sont injectables pour les tests ; en
 * service, on n'en passe aucun. Après `exit`, la fonction rend `null` (ce qui
 * n'arrive qu'avec un `exit` factice).
 *
 * @template {Record<string, VarSpec>} S
 * @param {S} schema
 * @param {{ service?: string, env?: Record<string, string|undefined>, argv?: string[],
 *           log?: import("./log.mjs").Logger, exit?: (code: number) => void,
 *           print?: (texte: string) => void }} [options]
 * @returns {Readonly<Record<keyof S, any>>}
 */
export function defineConfig(schema, options = {}) {
  const {
    service,
    env = process.env,
    argv = process.argv,
    exit = (code) => process.exit(code),
    print = (texte) => process.stdout.write(texte),
  } = options;

  if (argv.includes("--print-env-example")) {
    print(envExample(schema, { service }));
    exit(0);
    return /** @type {any} */ (null);
  }

  const log = options.log ?? createLogger(service ?? "config");
  const { valeurs, erreurs, sources } = parseConfig(schema, env);

  if (erreurs.length) {
    log.error("configuration invalide — le service refuse de démarrer", {
      nombre: erreurs.length,
      erreurs: erreurs.map((e) => `${e.variable} : ${e.erreur}`),
    });
    exit(2);
    return /** @type {any} */ (null);
  }

  log.info("configuration chargée", {
    config: redactConfig(schema, valeurs),
    // Ce qui tourne sur un défaut du code, et non sur une valeur posée :
    // c'est la première question devant un comportement inattendu.
    defauts: Object.keys(sources).filter((k) => sources[k] === "défaut"),
  });
  return Object.freeze(valeurs);
}
