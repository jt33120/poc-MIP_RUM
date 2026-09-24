// D'où vient l'adresse IP du client — et d'où elle ne vient JAMAIS (P8.7).
//
// ═══════════════════ LE PIÈGE QUE CE MODULE EXISTE POUR ÉVITER ═══════════════
//
// `X-Forwarded-For` est une LISTE que chaque relais allonge. Le premier élément
// est celui que le client a envoyé : n'importe qui peut écrire
// `X-Forwarded-For: 1.2.3.4` dans sa requête et se faire attribuer le pays de son
// choix. Prendre « le premier de la liste », geste réflexe, revient donc à faire
// confiance au client. Prendre « le dernier » ne vaut pas mieux : c'est alors le
// relais le plus proche, c'est-à-dire l'hébergeur, jamais le visiteur.
//
// La seule lecture correcte demande de savoir COMBIEN de relais de confiance se
// trouvent devant nous. Ce nombre n'est pas devinable depuis le code : il décrit
// un déploiement. Il est donc DÉCLARÉ, et le défaut ne suppose rien.
//
// ═════════════════════════ MODES, ET CE QU'ILS VALENT ════════════════════════
//
//   `none`      (DÉFAUT) aucune adresse n'est lue. GeoIP est éteint. Un
//               déploiement dont personne n'a décrit la façade ne doit pas
//               deviner : il retombe sur le pays estimé par fuseau, comme avant
//               ce lot.
//   `socket`    l'adresse de la CONNEXION (`req.socket.remoteAddress`). Correcte
//               quand le processus est exposé directement. Derrière un relais,
//               elle rend l'adresse du relais — visible et inoffensive.
//   `railway`   l'en-tête `X-Real-IP` posé par la façade Railway, et seulement si
//               la requête porte aussi un marqueur d'arête Railway. Cf. la note
//               ci-dessous sur ce qui est constaté et ce qui ne l'est pas.
//   `xff:<n>`   `X-Forwarded-For` avec <n> relais de confiance devant nous : on
//               prend le n-ième élément EN PARTANT DE LA DROITE, ce qui ignore
//               par construction tout préfixe forgé par le client.
//
// ══════════════ CE QUI EST CONSTATÉ SUR RAILWAY, ET CE QUI NE L'EST PAS ══════
//
// CONSTATÉ (documentation Railway, « Specs & Limits », et journaux HTTP de
// l'arête) : la façade pose `X-Real-IP` avec l'adresse distante du client, ainsi
// que `X-Railway-Request-Id`, `X-Railway-Edge`, `X-Request-Start`,
// `X-Forwarded-Proto` et `X-Forwarded-Host`. `X-Forwarded-For` ne figure PAS
// dans la liste des en-têtes documentés : rien ne garantit qu'il soit posé ni
// assaini. Le journal HTTP de l'arête enregistre `srcIp` = la source TCP réelle,
// y compris quand la requête transporte un `X-Forwarded-For` forgé.
//
// NON CONSTATÉ : que la façade ÉCRASE un `X-Real-IP` envoyé par le client. Le
// service déployé ne renvoie pas ses en-têtes et ce lot ne déploie pas de sonde
// pour le vérifier. Conséquence assumée, et bornée : un client pourrait se
// choisir un pays. Ce n'est pas une aggravation — il choisit déjà son fuseau
// horaire, d'où vient le pays estimé d'aujourd'hui. C'est une donnée déclarée,
// jamais une preuve, et la colonne de provenance le dit.
//
// ═══════════════════ LE BORD DE CONFIANCE (P2, relais Vercel) ════════════════
//
// En P3, la route de la console RELAIE les beacons vers le collector. Vu du
// collector, l'appel vient alors d'une fonction Vercel : son adresse est celle
// d'un centre de données américain ou allemand, jamais celle du visiteur. Deux
// défauts à éviter, symétriques :
//
//   1. résoudre cette adresse par GeoIP — tout le trafic relayé deviendrait
//      « US » ou « DE » (le pic DE/NL que P3 surveille) ;
//   2. croire un en-tête pays posé par n'importe qui — `x-vercel-ip-country`
//      n'est qu'un en-tête : un client qui frappe le collector EN DIRECT peut
//      l'écrire lui-même et se choisir un pays.
//
// D'où un protocole explicite, `mip-edge/1` : le relais signe sa requête avec
// `x-mip-edge-auth` (un secret partagé, EDGE_PROXY_SECRET), et n'y met QUE le
// pays (`x-mip-edge-country`), jamais l'adresse. Le collector :
//
//   - vérifie la signature en TEMPS CONSTANT, contre une ou deux valeurs (deux
//     pendant une rotation : on pose la nouvelle à côté de l'ancienne, on
//     bascule le relais, on retire l'ancienne — sans fenêtre de refus) ;
//   - RETIRE tout `x-mip-edge-*` de la requête, authentifiée ou non : aucun
//     code en aval ne peut relire un en-tête de bord qui n'a pas été vérifié
//     ici, ni le secret lui-même ;
//   - n'accepte un pays que s'il est exactement `^[A-Z]{2}$` ;
//   - IGNORE `x-vercel-ip-country` et `cf-ipcountry` hors requête authentifiée ;
//   - pour une requête relayée, SAUTE le GeoIP : le pays vient du relais, et
//     aucune adresse n'a traversé. C'est ce qui garde vraie la phrase publique
//     « aucune adresse IP n'est transmise ni stockée » (`lib/legal.ts`).
//
// Une signature PRÉSENTE mais FAUSSE (secret désaccordé pendant une rotation
// ratée) n'est pas traitée comme du trafic direct : ce serait géolocaliser
// l'adresse de Vercel. Elle ne donne aucun pays du tout — le fuseau reste.

import { createHash, timingSafeEqual } from "node:crypto";

/** Nombre maximal de relais déclarables. Au-delà, la déclaration est une faute de frappe. */
export const MAX_HOPS = 8;

/**
 * Lit la déclaration de façade.
 * @param {string|null|undefined} brut valeur de GEOIP_IP_SOURCE
 * @returns {{mode:"none"} | {mode:"socket"} | {mode:"railway"} | {mode:"xff", hops:number} | {mode:"invalide", brut:string}}
 */
export function parseSourceIp(brut) {
  const v = typeof brut === "string" ? brut.trim().toLowerCase() : "";
  if (v === "" || v === "none") return { mode: "none" };
  if (v === "socket") return { mode: "socket" };
  if (v === "railway") return { mode: "railway" };
  const m = /^xff:(\d{1,2})$/.exec(v);
  if (m) {
    const hops = Number(m[1]);
    if (hops >= 1 && hops <= MAX_HOPS) return { mode: "xff", hops };
  }
  return { mode: "invalide", brut: v };
}

/** En-têtes posés par l'arête Railway, et qu'un client seul n'a aucune raison d'émettre. */
const MARQUEURS_RAILWAY = ["x-railway-request-id", "x-railway-edge", "x-request-start"];

/**
 * Adresse du client selon la façade déclarée — ou `null`.
 *
 * `null` n'est pas un échec : c'est « on ne sait pas », et la suite du chemin
 * retombe sur le pays estimé par fuseau. Aucune adresse n'est journalisée, ni
 * renvoyée dans une erreur, ni attachée à une clef de cache.
 *
 * @param {{headers?: Record<string,string|string[]|undefined>, socket?: {remoteAddress?: string}}} req
 * @param {ReturnType<typeof parseSourceIp>} source
 * @returns {string|null}
 */
export function ipClient(req, source) {
  if (!req || !source || source.mode === "none" || source.mode === "invalide") return null;

  if (source.mode === "socket") {
    const brut = req.socket?.remoteAddress;
    return typeof brut === "string" && brut.length > 0 ? brut : null;
  }

  if (source.mode === "railway") {
    // Le marqueur d'arête n'est pas un secret : il rend seulement impossible
    // qu'un appel arrivé par un autre chemin (réseau privé, test local) soit
    // traité comme s'il venait de la façade.
    if (!MARQUEURS_RAILWAY.some((h) => entete(req, h) !== null)) return null;
    const brut = entete(req, "x-real-ip");
    return brut ? dernierJeton(brut) : null;
  }

  // xff:<n> — le n-ième EN PARTANT DE LA DROITE. Avec un relais de confiance et
  // `X-Forwarded-For: 9.9.9.9, 203.0.113.7`, on retient 203.0.113.7 : le
  // `9.9.9.9` que le client a pu écrire lui-même est ignoré par construction.
  const liste = entete(req, "x-forwarded-for");
  if (!liste) return null;
  const elements = liste.split(",").map((s) => s.trim()).filter(Boolean);
  if (elements.length < source.hops) return null;
  return elements[elements.length - source.hops] ?? null;
}

/** Lecture d'en-tête indifférente à la casse et à la forme (Node rend parfois un tableau). */
function entete(req, nom) {
  const h = req.headers;
  if (!h) return null;
  // `Headers` du web (console Next) : la méthode `get` est déjà insensible à la casse.
  if (typeof h.get === "function") return h.get(nom);
  const v = h[nom] ?? h[nom.toLowerCase()];
  const brut = Array.isArray(v) ? v[0] : v;
  return typeof brut === "string" && brut.length > 0 ? brut : null;
}

/**
 * `X-Real-IP` est simple-valué, mais Node concatène les doublons. On garde le
 * DERNIER : un relais ajoute sa valeur après celles qu'il a reçues, donc la
 * dernière est celle du relais le plus proche — la seule que quelqu'un d'autre
 * que le client ait pu écrire.
 */
function dernierJeton(brut) {
  const morceaux = brut.split(",").map((s) => s.trim()).filter(Boolean);
  return morceaux.length ? morceaux[morceaux.length - 1] : null;
}

// ───────────────────────────── Bord de confiance ─────────────────────────────

/** Nom STABLE du protocole de relais, exposé par `/health` et vérifié par le relais (P3). */
export const EDGE_PROTOCOL = "mip-edge/1";
/** Préfixe réservé : tout en-tête entrant qui le porte est retiré après lecture. */
export const EDGE_HEADER_PREFIX = "x-mip-edge-";
export const EDGE_AUTH_HEADER = "x-mip-edge-auth";
export const EDGE_COUNTRY_HEADER = "x-mip-edge-country";
/** Un secret de relais plus court se devine ; 32 caractères = 128 bits en hex. */
export const EDGE_SECRET_MIN_LENGTH = 32;
/** Deux valeurs au plus : l'ancienne et la nouvelle, le temps d'une rotation. */
export const EDGE_SECRET_MAX_COUNT = 2;

const CODE_PAYS_STRICT = /^[A-Z]{2}$/;

/**
 * Contrôle d'une liste de secrets de relais (valeur de `EDGE_PROXY_SECRET`
 * découpée à la virgule). Rend un message d'erreur, ou `null`. Le message ne
 * cite jamais une valeur.
 * @param {readonly string[]} secrets
 */
export function verifierSecretsBord(secrets) {
  if (!Array.isArray(secrets) || secrets.length === 0) return null;
  if (secrets.length > EDGE_SECRET_MAX_COUNT) {
    return `${EDGE_SECRET_MAX_COUNT} valeurs au plus (l'ancienne et la nouvelle, pendant une rotation)`;
  }
  if (secrets.some((s) => typeof s !== "string" || s.length < EDGE_SECRET_MIN_LENGTH)) {
    return `chaque valeur doit compter au moins ${EDGE_SECRET_MIN_LENGTH} caractères`;
  }
  return null;
}

/**
 * Le lecteur du bord de confiance.
 *
 * POURQUOI DES EMPREINTES ET NON LES SECRETS. `timingSafeEqual` exige deux
 * tampons de même longueur ; comparer des sha256 rend la durée indépendante de
 * la longueur ET du contenu de ce que le client envoie. Chaque valeur connue
 * est comparée à chaque appel, sans court-circuit : la durée ne dit pas non
 * plus LAQUELLE des deux valeurs de rotation a répondu.
 *
 * @param {readonly string[] | null | undefined} secrets valeurs d'EDGE_PROXY_SECRET
 */
export function creerBordDeConfiance(secrets) {
  const attendues = (secrets ?? [])
    .filter((s) => typeof s === "string" && s.length > 0)
    .map((s) => createHash("sha256").update(s).digest());

  /**
   * Lit, vérifie et RETIRE les en-têtes de bord de `req`.
   *
   *   `relaye`   la signature est valide : le pays (éventuel) vient du relais,
   *              et l'appelant doit sauter le GeoIP ;
   *   `refuse`   une signature est présente mais fausse : ni GeoIP (l'adresse
   *              serait celle d'un relais), ni pays ;
   *   `direct`   aucune signature : trafic direct, GeoIP permis, en-têtes pays
   *              de CDN ignorés.
   *
   * @param {{headers?: any, rawHeaders?: string[]}} req
   * @returns {{ mode: "relaye"|"refuse"|"direct", pays: string|null, forges: number }}
   */
  function lire(req) {
    // PRÉSENCE, pas valeur : un `x-mip-edge-auth` VIDE vient d'un relais dont
    // le secret est vide (le cas réel d'IDENTITY_HASH_SECRET sur Vercel, relevé
    // le 23/09). Le lire comme « direct » ferait géolocaliser l'adresse du
    // relais — tout le trafic relayé deviendrait DE ou US. C'est un refus.
    const signature = enteteBrut(req, EDGE_AUTH_HEADER);
    let mode = "direct";
    if (signature !== null) {
      const recue = createHash("sha256").update(signature).digest();
      let ok = false;
      for (const attendue of attendues) ok = timingSafeEqual(recue, attendue) || ok;
      mode = ok ? "relaye" : "refuse";
    }
    let pays = null;
    if (mode === "relaye") {
      // Le premier en-tête PRÉSENT décide ; invalide, il ne cède pas la place
      // au suivant : un relais qui envoie « fr » ou « XXX » a un défaut à
      // corriger, pas un repli à trouver.
      for (const nom of [EDGE_COUNTRY_HEADER, "x-vercel-ip-country", "cf-ipcountry"]) {
        const v = entete(req, nom);
        if (v === null) continue;
        pays = CODE_PAYS_STRICT.test(v) ? v : null;
        break;
      }
    }
    const retires = retirerEntetesBord(req);
    return { mode, pays, forges: mode === "relaye" ? 0 : retires };
  }

  return { actif: attendues.length > 0, lire };
}

/** Valeur d'un en-tête MÊME VIDE (`""`), ou `null` s'il est absent. */
function enteteBrut(req, nom) {
  const h = req?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(nom);
  const v = h[nom];
  if (v === undefined || v === null) return null;
  return String(Array.isArray(v) ? v[0] ?? "" : v);
}

/**
 * Retire tout `x-mip-edge-*` de la requête (objet d'en-têtes Node, `rawHeaders`,
 * ou `Headers` du web). Rend le nombre d'en-têtes retirés.
 */
export function retirerEntetesBord(req) {
  const h = req?.headers;
  let n = 0;
  if (h && typeof h.get === "function" && typeof h.delete === "function") {
    for (const nom of [...h.keys()]) {
      if (nom.toLowerCase().startsWith(EDGE_HEADER_PREFIX)) {
        h.delete(nom);
        n++;
      }
    }
    return n;
  }
  if (h && typeof h === "object") {
    for (const nom of Object.keys(h)) {
      if (nom.toLowerCase().startsWith(EDGE_HEADER_PREFIX)) {
        delete h[nom];
        n++;
      }
    }
  }
  if (Array.isArray(req?.rawHeaders)) {
    const garde = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase().startsWith(EDGE_HEADER_PREFIX)) continue;
      garde.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    req.rawHeaders = garde;
  }
  return n;
}
