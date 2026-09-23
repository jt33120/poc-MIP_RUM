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
