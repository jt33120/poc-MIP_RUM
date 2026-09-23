// SORTIES HTTP VERS UNE URL SAISIE PAR UN UTILISATEUR — sondes uptime, webhooks
// d'alerte. Tout ce qui part vers une adresse que le code n'a pas écrite lui-même
// passe par ici.
//
// POURQUOI. Une URL saisie dans la console est une requête que NOTRE réseau émet
// pour le compte de quelqu'un d'autre. Sur Railway, ce réseau voit ce que
// l'internet ne voit pas : le réseau privé IPv6 du projet (`*.railway.internal`,
// fc00::/7), où la base, le collector et le scheduler s'écoutent sans
// authentification réseau ; l'adresse de métadonnées du fournisseur
// (169.254.169.254) ; la boucle locale du conteneur. Un `fetch(url)` nu en fait
// un relais : l'uptime enregistre le statut et l'erreur, et la console les
// affiche — de quoi cartographier l'intérieur, une sonde toutes les 5 minutes.
//
// CE QUI EST REFUSÉ, ET À QUEL MOMENT.
//   Avant tout réseau (`verifierUrlSortante`, appelée aussi À L'ÉCRITURE par la
//   console, pour un message clair au lieu d'un échec muet au premier tick) :
//     - tout protocole autre que http/https, les identifiants dans l'URL ;
//     - tout hôte IP LITTÉRAL, public compris. Le parseur WHATWG ramène déjà
//       `0x7f.1`, `2130706433` ou `127.1` à `127.0.0.1` ; refuser la forme
//       littérale entière coupe court à ces jeux d'écriture, et une sonde ou un
//       webhook légitime a un nom ;
//     - les noms qui ne peuvent pas être publics : sans domaine (`redis`,
//       `postgres` — des services voisins sous Docker), `localhost`, et les
//       suffixes réservés à l'usage privé, dont `*.railway.internal`.
//   Après résolution (`verifierCible`) : TOUTES les adresses rendues par le DNS
//   (`all: true`), une seule interdite suffit à refuser — sinon l'attaquant
//   choisit laquelle sera tentée. Plages : `motifAdresseInterdite`.
//   À chaque redirection (3 au plus) : les deux contrôles, de nouveau.
//
// ÉPINGLAGE — LA PARADE AU DNS REBINDING. Vérifier un nom puis laisser `fetch` le
// résoudre À NOUVEAU ne prouve rien : un DNS hostile répond une adresse publique
// à la vérification, puis 127.0.0.1 à la connexion (TTL 0). La connexion est donc
// ouverte par `node:http(s)` avec un `lookup` qui rend les adresses DÉJÀ
// vérifiées, sans seconde requête DNS. Le nom reste l'hôte de la requête : l'en-
// tête Host, le SNI et la vérification du certificat portent sur lui, pas sur
// l'adresse.
//
// POURQUOI PAS `fetch` AVEC UN DISPATCHER. `fetch` de Node n'accepte pas de
// résolveur ; il faudrait le paquet `undici` pour lui passer un `connect.lookup`,
// soit une dépendance de plus, versionnée à part de celle que Node embarque. Le
// kit backend reste à zéro dépendance : `node:http(s)` fait l'affaire, et la
// réponse rendue est une vraie `Response` (status, ok, headers, text(), json()).
//
// CE QUE CE MODULE NE FAIT PAS. Il ne décide pas de ce qu'on fait d'un refus : la
// sonde uptime l'enregistre en DOWN sans second essai (un refus ne change pas en
// une seconde), le dispatcher solde la livraison `skipped`. Il ne suit pas les
// variables d'environnement de proxy, ne décompresse pas (aucun
// `accept-encoding` n'est envoyé) et ne garde aucune connexion ouverte.
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable, Transform, pipeline } from "node:stream";

/** Redirections suivies au plus ; la quatrième est refusée. */
export const MAX_REDIRECTIONS = 3;
/** Délai total par défaut : résolution, connexions, redirections ET corps. */
export const TIMEOUT_DEFAUT_MS = 10_000;
/**
 * Plafond du corps lu. Une sonde et un webhook n'ont besoin que du statut ; un
 * serveur hostile qui déverse des gigaoctets ne doit pas remplir la mémoire du
 * scheduler avant que le délai ne tombe.
 */
export const CORPS_MAX_OCTETS = 1024 * 1024;

/**
 * Motifs de refus, par code. Le code voyage (query string de la console, champ
 * `code` de l'erreur) ; le texte est celui qu'un administrateur lit. La console
 * relit le texte par `motifDeRefus` plutôt que de le recevoir dans l'URL : une
 * page qui afficherait n'importe quel texte passé en paramètre serait un
 * support d'hameçonnage à notre nom.
 */
export const MOTIFS_REFUS = Object.freeze({
  url_invalide: "URL illisible.",
  protocole: "Seules les URL http:// et https:// sont acceptées.",
  identifiants: "L'URL ne doit pas contenir d'identifiants (utilisateur:mot-de-passe@).",
  ip_litterale: "Adresse IP littérale refusée : indiquez un nom d'hôte public.",
  hote_interne:
    "Nom d'hôte interne refusé : localhost, nom sans domaine, *.internal (dont *.railway.internal), *.local, *.home.arpa.",
  adresse_interdite: "Le nom d'hôte résout vers une adresse privée, locale ou réservée.",
  redirections: `Trop de redirections (${MAX_REDIRECTIONS} au plus).`,
});

/** Le texte d'un code de refus ; null pour un code inconnu (jamais d'écho brut). */
export function motifDeRefus(code) {
  return Object.hasOwn(MOTIFS_REFUS, code) ? MOTIFS_REFUS[code] : null;
}

/**
 * Refus par POLITIQUE, distinct d'une panne : il est déterministe, le rejouer
 * dans une seconde donnerait le même verdict. `code` est une clé de
 * MOTIFS_REFUS ; `detail` précise sans jamais nommer l'adresse résolue (la
 * console l'afficherait, et ce serait une réponse DNS interne de plus livrée).
 */
export class ErreurCibleRefusee extends Error {
  constructor(code, detail = null) {
    super(`cible refusée : ${MOTIFS_REFUS[code] ?? code}${detail ? ` (${detail})` : ""}`);
    this.name = "ErreurCibleRefusee";
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Adresses
// ---------------------------------------------------------------------------

/** `a.b.c.d` → entier non signé, ou null. Arithmétique, pas de décalages : `<<` signe sur 32 bits. */
function entierIPv4(texte) {
  const parts = String(texte).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

/**
 * Plages IPv4 refusées. Celles du plan (boucle, RFC 1918, lien-local, CGNAT,
 * 0.0.0.0/8), plus ce qui n'est joignable en TCP unicast par aucun service
 * public : assignations IETF, banc d'essai, multicast, réservé et diffusion.
 */
const PLAGES_V4 = [
  ["0.0.0.0", 8, "« ce réseau » 0.0.0.0/8"],
  ["10.0.0.0", 8, "privée RFC 1918"],
  ["100.64.0.0", 10, "CGNAT 100.64.0.0/10"],
  ["127.0.0.0", 8, "boucle locale"],
  ["169.254.0.0", 16, "lien-local 169.254.0.0/16 (métadonnées cloud)"],
  ["172.16.0.0", 12, "privée RFC 1918"],
  ["192.0.0.0", 24, "assignations IETF 192.0.0.0/24"],
  ["192.168.0.0", 16, "privée RFC 1918"],
  ["198.18.0.0", 15, "banc d'essai 198.18.0.0/15"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "réservée (dont diffusion)"],
].map(([base, prefixe, libelle]) => ({ base: entierIPv4(base), taille: 2 ** (32 - prefixe), libelle }));

function motifIPv4(n) {
  for (const p of PLAGES_V4) {
    if (Math.floor(n / p.taille) === Math.floor(p.base / p.taille)) return p.libelle;
  }
  return null;
}

/**
 * IPv6 → huit mots de 16 bits, ou null. Accepte `::`, la queue pointée
 * (`::ffff:1.2.3.4`) et l'identifiant de zone (`fe80::1%eth0`, ignoré). Appelée
 * sur des chaînes que `isIP` a déjà reconnues : elle n'a pas à tout valider.
 */
function motsIPv6(texte) {
  let a = String(texte).toLowerCase();
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const dernier = a.lastIndexOf(":");
  const queue = a.slice(dernier + 1);
  if (queue.includes(".")) {
    const v4 = entierIPv4(queue);
    if (v4 === null) return null;
    a = `${a.slice(0, dernier + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const moities = a.split("::");
  if (moities.length > 2) return null;
  const groupes = (s) => (s ? s.split(":") : []);
  const gauche = groupes(moities[0]);
  let tous = gauche;
  if (moities.length === 2) {
    const droite = groupes(moities[1]);
    const manque = 8 - gauche.length - droite.length;
    if (manque < 1) return null;
    tous = [...gauche, ...Array(manque).fill("0"), ...droite];
  }
  if (tous.length !== 8 || !tous.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return tous.map((g) => parseInt(g, 16));
}

function motifIPv6(m) {
  const zeros = (de, a) => m.slice(de, a).every((x) => x === 0);
  if (zeros(0, 8)) return "non spécifiée ::";
  if (zeros(0, 7) && m[7] === 1) return "boucle locale ::1";
  // Refusée d'office, quelle que soit l'IPv4 embarquée : une réponse DNS AAAA en
  // ::ffff:… n'a aucune raison d'exister, et la pile la traiterait comme l'IPv4.
  if (zeros(0, 5) && m[5] === 0xffff) return "IPv4 mappée ::ffff:0:0/96";
  if (zeros(0, 6)) return "IPv4 compatible ::/96 (obsolète)";
  if ((m[0] & 0xfe00) === 0xfc00) return "ULA fc00::/7 (réseau privé Railway)";
  if ((m[0] & 0xffc0) === 0xfe80) return "lien-local fe80::/10";
  if ((m[0] & 0xffc0) === 0xfec0) return "site-local fec0::/10 (obsolète)";
  if ((m[0] & 0xff00) === 0xff00) return "multicast ff00::/8";
  // Traductions vers IPv4 : le paquet finit sur l'IPv4 embarquée. NAT64 bien
  // connu (64:ff9b::/96) et 6to4 (2002::/16) sont jugés sur elle ; le NAT64
  // d'usage local (64:ff9b:1::/48) et Teredo (2001::/32, IPv4 masquée) sont
  // refusés d'office — aucune cible légitime ne s'écrit ainsi.
  if (m[0] === 0x64 && m[1] === 0xff9b && zeros(2, 6)) {
    const embarque = motifIPv4(m[6] * 65536 + m[7]);
    return embarque ? `NAT64 vers ${embarque}` : null;
  }
  if (m[0] === 0x64 && m[1] === 0xff9b && m[2] === 1) return "NAT64 local 64:ff9b:1::/48";
  if (m[0] === 0x2002) {
    const embarque = motifIPv4(m[1] * 65536 + m[2]);
    return embarque ? `6to4 vers ${embarque}` : null;
  }
  if (m[0] === 0x2001 && m[1] === 0) return "Teredo 2001::/32";
  return null;
}

/**
 * Pourquoi une adresse IP est interdite comme destination, ou null si elle est
 * publique. Une chaîne qui n'est pas une IP est interdite : ce qu'on ne sait
 * pas classer ne sort pas.
 */
export function motifAdresseInterdite(adresse) {
  const texte = String(adresse ?? "");
  const famille = isIP(texte);
  if (famille === 4) return motifIPv4(entierIPv4(texte));
  if (famille === 6) {
    const mots = motsIPv6(texte);
    return mots ? motifIPv6(mots) : "IPv6 illisible";
  }
  return "adresse illisible";
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/**
 * Suffixes réservés à l'usage privé : `internal` (ICANN, 2024 — dont
 * `railway.internal` et `metadata.google.internal`), `local` (mDNS),
 * `localhost` (RFC 6761), `home.arpa` (RFC 8375). Un nom sous l'un d'eux ne
 * désigne jamais un service public.
 */
const SUFFIXES_INTERNES = ["localhost", "internal", "local", "home.arpa"];

function refus(code) {
  return { ok: false, code, message: MOTIFS_REFUS[code] };
}

/**
 * Contrôle SANS RÉSEAU d'une URL sortante. C'est celui que la console applique à
 * l'écriture : il attrape les cas évidents avec un message, sans prétendre
 * juger ce que le DNS répondra au moment de la requête — ce jugement-là est
 * celui de `safeFetch`, et lui seul fait foi.
 *
 * @param {unknown} texte
 * @returns {{ok: true, url: URL} | {ok: false, code: string, message: string}}
 */
export function verifierUrlSortante(texte) {
  let url;
  try {
    url = new URL(String(texte ?? "").trim());
  } catch {
    return refus("url_invalide");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return refus("protocole");
  if (url.username || url.password) return refus("identifiants");
  const hote = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(hote)) return refus("ip_litterale");
  const nom = hote.replace(/\.$/, "").toLowerCase();
  if (!nom.includes(".") || SUFFIXES_INTERNES.some((s) => nom === s || nom.endsWith(`.${s}`))) {
    return refus("hote_interne");
  }
  return { ok: true, url };
}

/** Résolveur par défaut : toutes les adresses, dans l'ordre du système. */
async function resoudreParDefaut(nom) {
  return dnsLookup(nom, { all: true });
}

/** Une promesse qui cède au signal ; la résolution DNS de Node ne s'annule pas. */
function avecSignal(promesse, signal) {
  if (!signal) return promesse;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((ok, ko) => {
    const abandon = () => ko(signal.reason);
    signal.addEventListener("abort", abandon, { once: true });
    promesse.then(
      (v) => {
        signal.removeEventListener("abort", abandon);
        ok(v);
      },
      (e) => {
        signal.removeEventListener("abort", abandon);
        ko(e);
      },
    );
  });
}

/**
 * Contrôle complet d'une cible : l'URL, puis CHAQUE adresse que le nom résout.
 * Rend les adresses vérifiées, sur lesquelles la connexion sera épinglée.
 *
 * @param {string|URL} texte
 * @param {{resoudre?: (nom: string) => Promise<Array<{address: string, family?: number}|string>>,
 *          adresseRefusee?: (adresse: string) => string|null, signal?: AbortSignal}} [options]
 * @returns {Promise<{url: URL, adresses: Array<{address: string, family: 4|6}>}>}
 */
export async function verifierCible(texte, { resoudre = resoudreParDefaut, adresseRefusee = motifAdresseInterdite, signal } = {}) {
  const verdict = verifierUrlSortante(texte instanceof URL ? texte.href : texte);
  if (!verdict.ok) throw new ErreurCibleRefusee(verdict.code);
  const nom = verdict.url.hostname.replace(/\.$/, "");
  const reponse = await avecSignal(Promise.resolve().then(() => resoudre(nom)), signal);
  const brutes = Array.isArray(reponse) ? reponse : [reponse];
  if (!brutes.length) {
    const err = new Error(`aucune adresse pour ${nom}`);
    err.code = "ENOTFOUND";
    throw err;
  }
  const adresses = [];
  for (const brute of brutes) {
    const address = typeof brute === "string" ? brute : String(brute?.address ?? "");
    const family = isIP(address);
    if (!family) throw new ErreurCibleRefusee("adresse_interdite", "réponse DNS illisible");
    const motif = adresseRefusee(address);
    if (motif) throw new ErreurCibleRefusee("adresse_interdite", motif);
    adresses.push({ address, family });
  }
  return { url: verdict.url, adresses };
}

// ---------------------------------------------------------------------------
// Requête
// ---------------------------------------------------------------------------

/**
 * `lookup` de connexion qui ne résout RIEN : il rend les adresses déjà vérifiées.
 * Toutes quand la pile les demande (`all`, Happy Eyeballs de `net.connect`) — un
 * hôte à double pile reste joignable en IPv4 quand l'IPv6 sortant manque —, et
 * filtrées quand elle impose une famille. Rappel asynchrone, comme `dns.lookup`.
 */
function lookupEpingle(adresses) {
  return (_nom, options, rappel) => {
    if (typeof options === "function") {
      rappel = options;
      options = {};
    }
    const famille = typeof options === "number" ? options : options?.family;
    const choix = famille === 4 || famille === 6 ? adresses.filter((a) => a.family === famille) : adresses;
    process.nextTick(() => {
      if (!choix.length) {
        const err = new Error(`aucune adresse vérifiée en IPv${famille}`);
        err.code = "ENOTFOUND";
        rappel(err);
      } else if (options?.all) {
        rappel(null, choix.map(({ address, family }) => ({ address, family })));
      } else {
        rappel(null, choix[0].address, choix[0].family);
      }
    });
  };
}

const STATUTS_REDIRECTION = new Set([301, 302, 303, 307, 308]);
/** Statuts dont une `Response` refuse le corps. */
const STATUTS_SANS_CORPS = new Set([101, 103, 204, 205, 304]);
/** Ce qui ne suit pas une redirection vers une autre origine (comme `fetch`). */
const ENTETES_D_ORIGINE = ["authorization", "cookie", "proxy-authorization"];

function octetsDuCorps(body, entetes) {
  if (body == null) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) {
    if (!entetes["content-type"]) entetes["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    return Buffer.from(body.toString());
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError("safeFetch : corps attendu string, Uint8Array, ArrayBuffer ou URLSearchParams");
}

/** Une requête, sur les adresses épinglées ; rend la réponse Node brute. */
function unSaut(url, adresses, { methode, entetes, corps, signal }) {
  return new Promise((ok, ko) => {
    const pile = url.protocol === "https:" ? https : http;
    const requete = pile.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: methode,
        headers: corps ? { ...entetes, "content-length": String(corps.length) } : entetes,
        // Pas de connexion réutilisée : une socket d'un pool pourrait avoir été
        // ouverte vers une autre adresse, et l'épinglage ne vaudrait plus rien.
        agent: false,
        lookup: lookupEpingle(adresses),
        signal,
      },
      ok,
    );
    requete.on("error", ko);
    requete.end(corps ?? undefined);
  });
}

/** Le corps, plafonné : au-delà, le flux échoue et la socket est fermée. */
function corpsPlafonne(res, max) {
  let recus = 0;
  const plafond = new Transform({
    transform(morceau, _codage, suite) {
      recus += morceau.length;
      if (recus > max) suite(new Error(`corps de réponse au-delà de ${max} octets`));
      else suite(null, morceau);
    },
  });
  pipeline(res, plafond, () => {});
  return Readable.toWeb(plafond);
}

function reponseDe(res, { methode, url, redirige, maxCorpsOctets }) {
  const statut = res.statusCode ?? 0;
  if (statut < 200 || statut > 599) {
    res.destroy();
    throw new Error(`statut HTTP hors norme : ${statut}`);
  }
  const entetes = new Headers();
  const brutes = res.rawHeaders ?? [];
  for (let i = 0; i + 1 < brutes.length; i += 2) {
    try {
      entetes.append(brutes[i], brutes[i + 1]);
    } catch {
      // En-tête que `Headers` refuse (octet hors norme) : ignoré, pas fatal.
    }
  }
  let corps = null;
  if (methode === "HEAD" || STATUTS_SANS_CORPS.has(statut)) res.resume();
  else corps = corpsPlafonne(res, maxCorpsOctets);
  let reponse;
  try {
    reponse = new Response(corps, { status: statut, statusText: res.statusMessage ?? "", headers: entetes });
  } catch {
    reponse = new Response(corps, { status: statut, headers: entetes });
  }
  // `url` et `redirected` sont des accesseurs du prototype, que le constructeur ne
  // permet pas de fixer : une propriété propre les masque, pour le diagnostic.
  Object.defineProperties(reponse, { url: { value: url }, redirected: { value: redirige } });
  return reponse;
}

/**
 * `fetch` restreint aux destinations publiques. Même forme d'appel pour ce que
 * les appelants utilisent : `method`, `headers`, `body`, `signal`, `redirect`
 * (`follow` par défaut, ou `manual`). En plus :
 *   - `timeoutMs` : délai TOTAL (`AbortSignal.timeout`), combiné au `signal` de
 *     l'appelant — résolution, connexions, redirections et lecture du corps ;
 *   - `maxCorpsOctets` : plafond du corps lu ;
 *   - `resoudre`, `adresseRefusee` : injectables pour les TESTS (résolveur
 *     simulé, boucle locale admise pour joindre un serveur de test). Aucun
 *     appelant de production ne les passe.
 *
 * Lève `ErreurCibleRefusee` pour un refus de politique, l'erreur d'origine pour
 * une panne (DNS, connexion, TLS, délai).
 *
 * @param {string|URL} entree
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
export async function safeFetch(entree, options = {}) {
  const {
    method = "GET",
    headers,
    body,
    signal,
    timeoutMs = TIMEOUT_DEFAUT_MS,
    redirect = "follow",
    maxCorpsOctets = CORPS_MAX_OCTETS,
    resoudre = resoudreParDefaut,
    adresseRefusee = motifAdresseInterdite,
  } = options;
  if (redirect !== "follow" && redirect !== "manual") {
    throw new TypeError(`safeFetch : redirect « ${redirect} » non pris en charge (follow ou manual)`);
  }
  const delai = AbortSignal.timeout(timeoutMs);
  const signalTotal = signal ? AbortSignal.any([signal, delai]) : delai;

  const entetes = { accept: "*/*", "user-agent": "mip-rum/1.0 (safe-fetch)" };
  for (const [nom, valeur] of new Headers(headers ?? {})) entetes[nom] = valeur;
  let methode = String(method).toUpperCase();
  let corps = octetsDuCorps(body, entetes);
  let courante = entree instanceof URL ? entree.href : String(entree ?? "");

  for (let saut = 0; ; saut++) {
    const cible = await verifierCible(courante, { resoudre, adresseRefusee, signal: signalTotal });
    let res;
    try {
      res = await unSaut(cible.url, cible.adresses, { methode, entetes, corps, signal: signalTotal });
    } catch (err) {
      // Une annulation par signal sort de `node:http` en AbortError générique ;
      // la raison du signal (délai dépassé, annulation de l'appelant) dit mieux.
      if (signalTotal.aborted && err?.name === "AbortError") throw signalTotal.reason ?? err;
      throw err;
    }
    const location = res.headers.location;
    if (redirect === "follow" && STATUTS_REDIRECTION.has(res.statusCode) && location) {
      res.destroy();
      if (saut >= MAX_REDIRECTIONS) throw new ErreurCibleRefusee("redirections");
      let suivante;
      try {
        suivante = new URL(location, cible.url);
      } catch {
        throw new ErreurCibleRefusee("url_invalide", "en-tête Location d'une redirection");
      }
      // Réécriture de méthode, celle de `fetch` : 303 → GET (sauf HEAD) ; 301/302
      // d'un POST → GET. 307/308 rejouent la méthode et le corps (gardé en octets).
      const versGet =
        (res.statusCode === 303 && methode !== "HEAD") ||
        ((res.statusCode === 301 || res.statusCode === 302) && methode === "POST");
      if (versGet) {
        methode = "GET";
        corps = null;
        delete entetes["content-type"];
      }
      if (suivante.origin !== cible.url.origin) for (const nom of ENTETES_D_ORIGINE) delete entetes[nom];
      courante = suivante.href;
      continue;
    }
    return reponseDe(res, { methode, url: cible.url.href, redirige: saut > 0, maxCorpsOctets });
  }
}
