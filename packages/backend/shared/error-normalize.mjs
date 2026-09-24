// Regroupement d'erreurs v2 (P5.5) — normalisation PURE : ni base, ni réseau, ni
// horloge. Importé par l'écrivain d'ingestion (pg-ingest.mjs) et par le parseur
// OTLP (clé déclarée), sous Node comme sous Deno.
//
// POURQUOI UNE VERSION 2 À CÔTÉ DE L'EMPREINTE HISTORIQUE. `fingerprint`
// (otlp.mjs:errorFingerprint) reste calculée à l'identique, octet pour octet :
// le watermark de check_new_errors (migration-v64) et le triage `error_status`
// en dépendent, et la changer signalerait chaque groupe connu comme nouveau au
// déploiement. La clé v2 est écrite À CÔTÉ (`grouping_key`, migration-v72), en
// ombre tant que l'application n'active pas le regroupement v2.
//
// CE QUE LA CLÉ V2 CORRIGE, cas par cas :
//   • 404 et 500 fusionnaient : le message historique remplace tous les chiffres.
//     Les codes sémantiques (statut HTTP, errno, ERR_*) entrent désormais dans la
//     clé, à part du gabarit de message.
//   • le même bug changeait de groupe à chaque build non hexadécimal (identifiant
//     de build Next.js en base 62, empreintes Rollup/Vite, esbuild, CRA
//     `main.<hash>.chunk.js`) : ces formes sont reconnues, une à une.
//   • la première frame pouvait être celle de React ou de Node : les frames de
//     bibliothèques et du runtime sont écartées par une liste de chemins bornée,
//     sans aucune expression régulière fournie par un client.
//   • aucun moyen de forcer un groupe : `mip.error_fingerprint` (SDK P5.2) devient
//     une clé déclarée, rescrubbée puis hachée dans le périmètre de l'app.
//
// ORDRE DE PRIORITÉ, du plus sûr au moins sûr :
//   1. override      clé déclarée valide ;
//   2. symbolicated_frame  première frame APPLICATIVE en positions source (source
//                    maps de la release) + type + codes. Le message en est exclu :
//                    il change d'un navigateur à l'autre pour le même bug
//                    (« Cannot read properties of undefined » / « x is undefined »).
//   3. normalized_frame    première frame applicative non symbolisée (chemin sans
//                    empreinte de build, nom de fonction) + type + codes + gabarit
//                    de message. SANS preuve source, le message est gardé : deux
//                    bugs d'une même fonction minifiée ne se distinguent que par
//                    lui, et fusionner deux bugs en cache un.
//   4. low_confidence aucune frame applicative (« Script error. », erreur sans
//                    pile, pile entièrement tierce) : type + codes + gabarit. Ce
//                    repli reste explicitement peu discriminant, et il est marqué.
//
// Ni la release ni un nom de fonction minifié ne suffisent jamais à eux seuls :
// la release n'entre dans aucune clé, et un nom de fonction n'y entre qu'avec son
// chemin, le type et, sans preuve source, le message.
//
// CONFIDENTIALITÉ. Chaque texte qui entre dans une clé repasse par le scrub
// serveur AVANT le hachage : une clé ne doit ni isoler une personne (un email
// dans un message ferait un groupe par utilisateur), ni servir d'oracle de
// dictionnaire. Le matériau est préfixé par l'app : deux apps n'ont jamais la
// même clé, même pour une clé déclarée identique.
//
// BORNES. Au plus 200 lignes de pile lues, 1 024 caractères par ligne (les
// expressions sont quadratiques sur une ligne hostile) et 50 frames retenues.
import { scrubText } from "./scrub.mjs";
import { sha256Hex } from "./sha256.mjs";

/** Version du regroupement écrite dans rum_error.grouping_version et error_issue. */
export const GROUPING_VERSION = 2;

/** Base de la clé, du plus sûr au moins sûr (contrainte `rum_error_grouping_v72`). */
export const GROUPING_BASES = Object.freeze(["override", "symbolicated_frame", "normalized_frame", "low_confidence"]);

/** Diagnostics d'une clé déclarée ignorée (contrainte `rum_error_grouping_v72`). */
export const GROUPING_DIAGNOSTICS = Object.freeze(["override_invalide", "override_vide_apres_scrub"]);

/** Longueur maximale d'une clé déclarée, identique à la borne du SDK. */
export const OVERRIDE_MAX_LENGTH = 100;

/** Chemins tiers configurables par app (contrainte `error_grouping_config_v72`). */
export const VENDOR_PATHS_MAX = 32;
export const VENDOR_PATH_MAX_LENGTH = 200;

const MAX_STACK_LINES = 200;
const MAX_FRAME_LINE_LENGTH = 1024;
const MAX_FRAMES = 50;
const MESSAGE_TEMPLATE_MAX = 300;
const CONTROLE = /[\u0000-\u001f\u007f]/;

const MATERIAU_CLE = "mip.grouping.v2";
const MATERIAU_OVERRIDE = "mip.grouping.override.v2";

// ─────────────────────────── Frames, par adaptateur ───────────────────────────

/** V8 (Chrome, Edge, Node) : « at fn (fichier:ligne:colonne) » ou « at fichier:ligne:colonne ». */
const FRAME_V8 = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
/** Gecko (Firefox) et JavaScriptCore (Safari) : « fn@fichier:ligne:colonne », colonne parfois absente. */
const FRAME_GECKO_JSC = /^\s*(?:([^@]*)@)?(.+?):(\d+)(?::(\d+))?\s*$/;
/** Python : « File "chemin", line N, in fonction ». */
const FRAME_PYTHON = /^\s*File "(.+)", line (\d+)(?:, in (.+?))?\s*$/;
const TRACEBACK_PYTHON = /^Traceback \(most recent call last\):\s*$/;

/**
 * Un « fichier » de frame doit ressembler à un chemin ou à une URL. Sans cette
 * garde, la ligne de message « Error: délai:30 » passerait pour une frame
 * Gecko dont le fichier serait « Error: délai ».
 */
function ressembleAChemin(fichier) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/|\.\.?\/|[a-z]:[\\/])/i.test(fichier) || fichier.includes("/") || fichier.includes("\\");
}

/**
 * Frames d'une pile, de la plus INTERNE à la plus externe, quel que soit le
 * runtime. Python liste l'appel le plus récent en DERNIER : sa pile est
 * retournée, et seule la dernière trace compte (une exception chaînée est la
 * dernière levée, pas la première).
 *
 * `lineIndex` est l'indice de la ligne dans la pile brute : c'est la clé qui
 * relie une frame à sa position symbolisée (P5.4, `positions[].index`).
 *
 * @returns {Array<{ fn: string|null, file: string, line: number, column: number|null, lineIndex: number }>}
 */
export function parseStackFrames(stack) {
  if (typeof stack !== "string" || !stack) return [];
  const lignes = stack.split("\n").slice(0, MAX_STACK_LINES);
  const python = lignes.some((l) => TRACEBACK_PYTHON.test(l) || FRAME_PYTHON.test(l.length <= MAX_FRAME_LINE_LENGTH ? l : ""));
  if (python) {
    let debut = 0;
    lignes.forEach((l, i) => {
      if (TRACEBACK_PYTHON.test(l)) debut = i;
    });
    const frames = [];
    for (let i = debut; i < lignes.length; i++) {
      const l = lignes[i];
      if (l.length > MAX_FRAME_LINE_LENGTH) continue;
      const m = FRAME_PYTHON.exec(l);
      if (m) frames.push({ fn: m[3] ?? null, file: m[1], line: Number(m[2]), column: null, lineIndex: i });
    }
    return frames.reverse().slice(0, MAX_FRAMES);
  }
  const frames = [];
  for (let i = 0; i < lignes.length && frames.length < MAX_FRAMES; i++) {
    const l = lignes[i];
    if (l.length > MAX_FRAME_LINE_LENGTH) continue;
    const v8 = /^\s*at\s/.test(l) ? FRAME_V8.exec(l) : null;
    if (v8) {
      if (ressembleAChemin(v8[2])) {
        frames.push({ fn: v8[1] ?? null, file: v8[2], line: Number(v8[3]), column: Number(v8[4]), lineIndex: i });
      }
      continue;
    }
    if (/^\s*at\s/.test(l)) continue;
    const gecko = FRAME_GECKO_JSC.exec(l);
    // Un fichier Gecko ou JavaScriptCore ne contient pas d'espace : sans cette
    // garde, la première ligne d'une pile V8 (« Error: échec /api/x:30 ») en
    // deviendrait une.
    if (gecko && ressembleAChemin(gecko[2]) && !/\s/.test(gecko[2])) {
      frames.push({
        fn: gecko[1] || null,
        file: gecko[2],
        line: Number(gecko[3]),
        column: gecko[4] === undefined ? null : Number(gecko[4]),
        lineIndex: i,
      });
    }
  }
  return frames;
}

/**
 * Nom de fonction comparable d'un navigateur à l'autre, ou null s'il est anonyme.
 *
 * V8 écrit « Object.handleClick », « async handleClick », « new Panier » ou
 * « Layer.handle [as handle_request] » ; Firefox « handleClick/< » ou
 * « async*handleClick » ; Safari « handleClick » ou « global code ». Le dernier
 * identifiant est le seul que les trois moteurs partagent.
 */
export function normalizeFunctionName(raw) {
  if (typeof raw !== "string") return null;
  const nom = raw
    .trim()
    .replace(/\s*\[as [^\]]*\]$/, "")
    .replace(/^(?:async|new)\s+/, "")
    .replace(/^.*\*/, "")
    .replace(/(?:\/<)+$/, "");
  if (!nom || /^(?:global|module|eval) code$/.test(nom)) return null;
  const dernier = nom.split(/[./]/).filter(Boolean).at(-1) ?? "";
  if (!dernier || /^<.*>$/.test(dernier) || dernier === "anonymous" || CONTROLE.test(dernier)) return null;
  return dernier.slice(0, 100);
}

// ─────────────────────── Chemins de modules et builds ─────────────────────────
//
// PRUDENCE, reprise de la v1 (otlp.mjs:normalizeModulePath). Trop normaliser est
// pire que pas assez : deux modules fondus dans un même chemin, c'est un bug qui
// disparaît. Chaque forme retirée ci-dessous est donc une forme DE BUILD connue,
// jamais une heuristique d'entropie appliquée à un nom quelconque.

/** Répertoires réservés de Next.js sous `/_next/static/` ; tout autre segment y est l'identifiant de build. */
const NEXT_STATIC_RESERVES = new Set(["chunks", "css", "media", "development", "webpack", "images", "fonts"]);

/** Extension, suffixes de bundle compris : `main.8e1a2b3c.chunk.js`, `app.min.js`. */
const EXTENSION = /((?:\.(?:chunk|bundle|min|esm|module|prod|production))*\.(?:m?js|cjs|jsx|mts|cts|tsx?|vue|svelte|css|html?|py))$/i;

/** Empreinte hexadécimale en fin de nom : webpack, Angular, CRA, Parcel, Next.js. */
const QUEUE_HEX = /([._-])([0-9a-f]{8,})$/i;
/**
 * Empreinte de 8 caractères : Rollup/Vite (base64url, tiret et souligné compris),
 * esbuild et Remix (base 32 en majuscules). Aucune empreinte base 62 plus longue
 * n'est reconnue : « context2024 » ou « V2Variant » sont des noms, et aucun
 * bundler courant ne produit ce format par défaut.
 */
const QUEUE_B64_8 = /([.-])([A-Za-z0-9_-]{8})$/;

const SEGMENT_HEX = /^[0-9a-f]{8,}$/i;
const SEGMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_ID_BUILD = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Jeton de build en base 62 : au moins deux classes parmi chiffres, majuscules et
 * minuscules. « checkout » ou « CHECKOUT » restent des noms ; « D8LbuEa1 »,
 * « 5Q6BZL4O » ou « BZkqRLmw » sont des empreintes.
 */
function jetonDeBuild(jeton) {
  const classes = [/\d/, /[A-Z]/, /[a-z]/].filter((re) => re.test(jeton)).length;
  return classes >= 2;
}

/**
 * Segment de répertoire long généré par un outil de build (identifiant de build
 * nanoid, horodatage de CI) : 16 caractères ou plus, lettres et chiffres mêlés,
 * et soit la casse mixte, soit au moins quatre chiffres. « material-icons-v140 »
 * reste un nom de répertoire.
 */
function segmentIdentifiantDeBuild(segment) {
  if (!SEGMENT_ID_BUILD.test(segment) || !/\d/.test(segment) || !/[a-z]/i.test(segment)) return false;
  return (/[A-Z]/.test(segment) && /[a-z]/.test(segment)) || (segment.match(/\d/g) ?? []).length >= 4;
}

/** Nom de fichier sans son empreinte de build ; l'extension et le nom logique restent. */
function nomSansEmpreinte(nom, repertoire) {
  const ext = EXTENSION.exec(nom)?.[1] ?? "";
  const tige = ext ? nom.slice(0, -ext.length) : nom;
  // Nuxt 3 nomme ses chunks par leur seule empreinte : `/_nuxt/BZ0K3Kx1.js`.
  if (repertoire === "_nuxt" && /^[A-Za-z0-9_-]{8}$/.test(tige) && /\d/.test(tige) && /[a-z]/i.test(tige)) return `#${ext}`;
  if (SEGMENT_HEX.test(tige)) return `#${ext}`;
  const hex = QUEUE_HEX.exec(tige);
  if (hex) return `${tige.slice(0, hex.index)}${hex[1]}#${ext}`;
  const b64 = QUEUE_B64_8.exec(tige);
  if (b64 && jetonDeBuild(b64[2])) return `${tige.slice(0, b64.index)}${b64[1]}#${ext}`;
  return nom;
}

/**
 * Chemin d'un module, débarrassé de ce qui change d'un déploiement ou d'un hôte
 * à l'autre : schéma et hôte (préproduction, préversion, CDN), requête et
 * fragment, empreintes de build dans les répertoires et dans le nom du fichier.
 * Le chemin logique et le nom du module restent : ce sont eux qui distinguent
 * deux bugs.
 *
 * @returns {string|null} null si la frame ne désigne aucun module (eval, anonyme)
 */
export function normalizeFramePath(file) {
  if (typeof file !== "string" || !file || CONTROLE.test(file)) return null;
  if (/\beval at\b|<anonymous>|\[native code\]|^native$/.test(file)) return null;
  let chemin = file
    .replace(/^blob:/i, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/\\/g, "/");
  const segments = chemin.split("/");
  const sortie = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "." && i > 0) continue;
    const dernier = i === segments.length - 1;
    const precedents = sortie.slice(-2).join("/");
    if (SEGMENT_UUID.test(segment) || (!dernier && SEGMENT_HEX.test(segment))) sortie.push("#");
    else if (!dernier && precedents === "_next/static" && !NEXT_STATIC_RESERVES.has(segment) && /^[A-Za-z0-9_-]{6,64}$/.test(segment)) {
      sortie.push("#");
    } else if (!dernier && segmentIdentifiantDeBuild(segment)) sortie.push("#");
    else if (dernier) sortie.push(nomSansEmpreinte(segment, segments[i - 1] ?? ""));
    else sortie.push(segment);
  }
  chemin = sortie.join("/");
  return chemin.replace(/^\.\//, "") || null;
}

// ─────────────────────── Frames tierces : chemins bornés ──────────────────────

/** Marqueurs de chemin des bibliothèques et du runtime, cherchés tels quels dans le chemin normalisé. */
export const DEFAULT_VENDOR_PATHS = Object.freeze([
  "node_modules/",
  "bower_components/",
  "jspm_packages/",
  "webpack/bootstrap",
  "webpack/runtime/",
  "(webpack)/",
  "/_next/static/chunks/framework-",
  "/_next/static/chunks/main-",
  "/_next/static/chunks/webpack-",
  "/_next/static/chunks/polyfills-",
  "site-packages/",
  "dist-packages/",
  "/lib/python3.",
  "<frozen ",
]);

/** Préfixes de nom de fichier des bundles de dépendances (webpack, Vue CLI, Vite `manualChunks`). */
const VENDOR_FILE_PREFIXES = Object.freeze(["vendor.", "vendor-", "vendors.", "vendors-", "vendors~", "chunk-vendors."]);

/** Schémas qui ne désignent jamais le code de l'application : extensions et runtime Node. */
const SCHEMA_TIERS = /^(?:(?:chrome|moz|safari|safari-web|ms-browser)-extension:|node:|internal\/)/i;

/**
 * Chemins tiers propres à une app, validés : au plus 32 chaînes littérales de 1 à
 * 200 caractères, sans caractère de contrôle. Jamais une expression régulière :
 * une regex fournie par un client serait un coût CPU sans borne à chaque lot.
 *
 * @returns {string[]|null} null si la liste est hors contrat
 */
export function validateVendorPaths(paths) {
  if (!Array.isArray(paths) || paths.length > VENDOR_PATHS_MAX) return null;
  const propres = [];
  for (const p of paths) {
    if (typeof p !== "string" || !p.length || p.length > VENDOR_PATH_MAX_LENGTH || CONTROLE.test(p)) return null;
    if (!propres.includes(p)) propres.push(p);
  }
  return propres;
}

/**
 * La frame appartient-elle à une bibliothèque, au runtime ou à une extension ?
 * `raw` est le fichier tel qu'émis (le schéma d'extension disparaît à la
 * normalisation), `normalized` le chemin normalisé.
 */
export function isVendorFrame(raw, normalized, vendorPaths = []) {
  if (typeof raw === "string" && SCHEMA_TIERS.test(raw)) return true;
  if (!normalized) return true;
  const nom = normalized.split("/").at(-1) ?? "";
  if (VENDOR_FILE_PREFIXES.some((prefixe) => nom.startsWith(prefixe))) return true;
  return DEFAULT_VENDOR_PATHS.some((m) => normalized.includes(m)) || vendorPaths.some((m) => normalized.includes(m));
}

// ────────────────────────── Codes sémantiques et message ──────────────────────

const RAISONS_HTTP = "not found|internal server error|bad gateway|bad request|unauthori[sz]ed|forbidden|service unavailable|" +
  "gateway time-?out|too many requests|conflict|client error|server error|method not allowed|" +
  "unprocessable (?:entity|content)|request time-?out|payload too large|gone";
const CODES_HTTP = [
  new RegExp(`\\b([1-5]\\d\\d)\\s+(?:${RAISONS_HTTP})\\b`, "i"),
  /\bHTTP(?:\/\d(?:\.\d)?)?\s*[:=]?\s*([1-5]\d\d)\b/i,
  /\bstatus(?:\s*code|code)?\s*[:=]?\s*\(?([1-5]\d\d)\b/i,
];
const CODE_NODE = /\bERR_[A-Z0-9_]{2,60}\b/g;
const ERRNO = /\bE(?:CONNREFUSED|CONNRESET|CONNABORTED|TIMEDOUT|NOTFOUND|AI_AGAIN|HOSTUNREACH|NETUNREACH|PIPE|NOENT|ACCES|PERM|EXIST|ISDIR|NOTDIR|MFILE|NOSPC|ADDRINUSE|ADDRNOTAVAIL|PROTO|CANCELED)\b/g;
const ERRNO_PYTHON = /\[Errno (\d{1,5})\]/;

/**
 * Codes d'erreur sémantiques du type et du message : statut HTTP, errno système,
 * code Node `ERR_*`, errno Python. Triés et dédoublonnés : l'ordre d'apparition
 * dans un message n'est pas une identité.
 */
export function semanticCodes(errorType, message) {
  const texte = `${typeof errorType === "string" ? errorType : ""}\n${typeof message === "string" ? message.slice(0, 1000) : ""}`;
  const codes = new Set();
  for (const re of CODES_HTTP) {
    const m = re.exec(texte);
    if (m) {
      codes.add(`http:${m[1]}`);
      break;
    }
  }
  for (const m of texte.matchAll(CODE_NODE)) codes.add(`code:${m[0]}`);
  for (const m of texte.matchAll(ERRNO)) codes.add(`errno:${m[0]}`);
  const python = ERRNO_PYTHON.exec(texte);
  if (python) codes.add(`errno:${python[1]}`);
  return [...codes].sort().slice(0, 8);
}

const URL_MESSAGE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const UUID_MESSAGE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_MESSAGE = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;

/**
 * Gabarit de message : scrub serveur d'abord (un email devient « [email] » et
 * n'isole plus une personne), puis URL, UUID, identifiants hexadécimaux et
 * nombres remplacés par « # ». Les codes sémantiques, eux, sont portés à part
 * par semanticCodes : « status code 404 » et « status code 500 » partagent ce
 * gabarit sans partager leur clé.
 */
export function messageTemplate(message) {
  const propre = (scrubText(typeof message === "string" ? message.slice(0, 1000) : "") ?? "");
  return propre
    .replace(URL_MESSAGE, "#")
    .replace(UUID_MESSAGE, "#")
    .replace(HEX_MESSAGE, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_TEMPLATE_MAX);
}

// ──────────────────────────────── Clé déclarée ────────────────────────────────

const JETONS_SCRUB = /\[(?:redacted|jwt|key|email|ip|number)\]/g;

/**
 * Clé de regroupement déclarée par l'émetteur (`mip.error_fingerprint`) : validée,
 * rescrubbée, puis hachée dans le périmètre de l'app.
 *
 * Seule l'empreinte sort d'ici : la clé elle-même n'est jamais recopiée dans une
 * ligne, pas même dans un lot différé (`ingest_raw`). Une clé qui ne contient plus
 * rien de significatif une fois le scrub passé (« alice@example.test » devient
 * « [email] ») est IGNORÉE avec un diagnostic : la garder rangerait dans un même
 * groupe toutes les erreurs dont la clé était une donnée personnelle.
 *
 * @returns {{ hash: string|null, diagnostic: null|"override_invalide"|"override_vide_apres_scrub" }}
 */
export function overrideHash(appId, raw) {
  if (raw === undefined || raw === null) return { hash: null, diagnostic: null };
  const brute = typeof raw === "string" ? raw.trim() : null;
  if (brute === null || brute.length > OVERRIDE_MAX_LENGTH || CONTROLE.test(brute)) {
    return { hash: null, diagnostic: "override_invalide" };
  }
  const propre = (scrubText(brute) ?? "").trim();
  if (!propre.replace(JETONS_SCRUB, "").replace(/[^\p{L}\p{N}]/gu, "")) {
    return { hash: null, diagnostic: "override_vide_apres_scrub" };
  }
  return { hash: sha256Hex(JSON.stringify([MATERIAU_OVERRIDE, String(appId), propre])), diagnostic: null };
}

// ──────────────────────────────── Clé de groupe ───────────────────────────────

const OVERRIDE_HASH = /^[0-9a-f]{64}$/;

function typeNormalise(errorType) {
  return (scrubText(typeof errorType === "string" ? errorType : "") ?? "").trim().slice(0, 200) || "Error";
}

function cle(appId, basis, parts) {
  return {
    version: GROUPING_VERSION,
    key: sha256Hex(JSON.stringify([MATERIAU_CLE, String(appId), basis, ...parts])).slice(0, 32),
    basis,
  };
}

/**
 * Positions symbolisées exploitables, indexées par ligne de pile brute. Forme
 * produite par la symbolication partagée de P5.4 (`positions`) :
 * `{ index, source, line }`, le reste est ignoré.
 */
function positionsParLigne(symbolicatedFrames) {
  const parLigne = new Map();
  for (const p of Array.isArray(symbolicatedFrames) ? symbolicatedFrames : []) {
    if (
      p && Number.isInteger(p.index) && p.index >= 0 && typeof p.source === "string" &&
      Number.isInteger(p.line) && p.line >= 1 && !parLigne.has(p.index)
    ) {
      parLigne.set(p.index, p);
    }
  }
  return parLigne;
}

/**
 * Clé de regroupement v2 d'une occurrence.
 *
 * @param {object} input
 * @param {string} input.appId
 * @param {string|null} input.errorType   `error_type` borné de la ligne
 * @param {string|null} input.message     message déjà scrubbé (rescrubbé ici)
 * @param {string|null} input.stack       pile brute scrubbée
 * @param {string|null} [input.overrideHash]  empreinte de clé déclarée (overrideHash)
 * @param {Array<{index:number, source:string, line:number}>|null} [input.symbolicatedFrames]
 *        positions source par ligne de pile (symbolication P5.4), absentes sans map
 * @param {string[]} [input.vendorPaths]  chemins tiers propres à l'app, déjà validés
 * @returns {{ version: 2, key: string, basis: string }}
 */
export function errorGrouping({ appId, errorType, message, stack, overrideHash: empreinte = null, symbolicatedFrames = null, vendorPaths = [] }) {
  const type = typeNormalise(errorType);
  const codes = semanticCodes(type, message);
  if (typeof empreinte === "string" && OVERRIDE_HASH.test(empreinte)) return cle(appId, "override", [empreinte]);

  const frames = parseStackFrames(scrubText(stack) ?? "");
  const tiers = validateVendorPaths(vendorPaths) ?? [];

  const positions = positionsParLigne(symbolicatedFrames);
  if (positions.size) {
    for (const frame of frames) {
      const position = positions.get(frame.lineIndex);
      if (!position) continue;
      const source = normalizeFramePath(position.source);
      if (isVendorFrame(position.source, source, tiers)) continue;
      return cle(appId, "symbolicated_frame", [type, codes, source, position.line]);
    }
  }

  for (const frame of frames) {
    const chemin = normalizeFramePath(frame.file);
    if (isVendorFrame(frame.file, chemin, tiers)) continue;
    return cle(appId, "normalized_frame", [type, codes, chemin, normalizeFunctionName(frame.fn), messageTemplate(message)]);
  }

  return cle(appId, "low_confidence", [type, codes, messageTemplate(message)]);
}
