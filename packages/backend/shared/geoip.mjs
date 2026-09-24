// Résolution IP → pays, EN MÉMOIRE, sans appel réseau (P8.7).
//
// ═══════════════════════ CE QUE CE MODULE EST, ET N'EST PAS ══════════════════
//
// Il transforme une adresse IP en un CODE PAYS à deux lettres, en interrogeant
// une base locale chargée une fois au démarrage. Il ne sort rien du processus :
// aucun fournisseur ne reçoit l'adresse, aucun compte ni clef n'existe. C'est le
// point décisif du lot : la variante « appel à un fournisseur » aurait envoyé
// l'IP AVANT tout scrub MIP, ce qui demandait une décision distincte, et elle
// n'a pas été retenue.
//
// Il ne localise PAS une personne. Il situe une adresse, qui est le plus souvent
// celle d'un opérateur, d'un relais d'entreprise ou d'un VPN. Un pays rendu ici
// dit « le trafic est arrivé par un réseau enregistré dans ce pays », jamais
// « cette personne était dans ce pays ». Les libellés d'écran et la
// documentation disent la même chose, dans les mêmes termes.
//
// ═══════════════════════ POURQUOI AUCUN CACHE DE RÉSOLUTION ══════════════════
//
// La spec autorise un cache borné à TTL documenté. On n'en pose aucun, et c'est
// un choix de confidentialité autant que de simplicité : une recherche
// dichotomique sur un tableau typé coûte une vingtaine de comparaisons en
// mémoire, sans entrée/sortie. Un cache serait le SEUL endroit où une adresse IP
// survivrait à la requête qui l'a apportée — et il faudrait alors la protéger,
// la borner, l'expirer et prouver qu'elle n'entre pas dans un journal. On préfère
// ne pas créer l'objet à protéger.
//
// Corollaire : il n'y a pas de « timeout de résolution », parce qu'il n'y a
// aucune attente. Le seul point qui dure est le CHARGEMENT de la base, borné
// ailleurs (lib/geoip-db.mjs). Le cas « timeout » de la spec appartenait à la
// variante fournisseur.
//
// ═════════════════════ FORMAT ATTENDU : DB-IP LITE, CSV ══════════════════════
//
// Trois colonnes, sans en-tête, une plage par ligne, bornes INCLUSES :
//
//     0.0.0.0,0.255.255.255,ZZ
//     1.0.0.0,1.0.0.255,AU
//     2001::,2001:0:ffff:ffff:ffff:ffff:ffff:ffff,US
//
// IPv4 et IPv6 cohabitent dans le même fichier. `ZZ` n'est pas un pays : DB-IP
// s'en sert pour les plages réservées et non attribuées. Il est chargé comme
// « inconnu » et ne peut jamais être persisté.

/** Code pays accepté : deux majuscules. `XK` (Kosovo) n'est pas ISO 3166-1 mais figure dans la base. */
export const CODE_PAYS = /^[A-Z]{2}$/;

/** Marqueur DB-IP d'une plage sans pays. Jamais persisté. */
const INCONNU = "ZZ";

// ───────────────────────────── Adresses ──────────────────────────────────────

/**
 * Analyse une adresse IPv4 ou IPv6 textuelle.
 *
 * STRICTE PAR CONSTRUCTION : `01.2.3.4` est refusé (un zéro de tête se lit en
 * octal chez certaines piles et en décimal chez d'autres — c'est une technique
 * d'évasion de filtre connue), tout comme une forme abrégée à moins de quatre
 * octets (`10.1` = 10.0.0.1 chez inet_aton). Ce qu'on ne sait pas lire d'une
 * seule façon, on le refuse.
 *
 * @returns {{v:4,a:number} | {v:6,hi:bigint,lo:bigint} | null}
 */
export function parseIp(texte) {
  if (typeof texte !== "string") return null;
  const brut = texte.trim();
  if (!brut || brut.length > 45) return null;
  // Forme `[2001:db8::1]:443` ou `1.2.3.4:443` : le port n'est pas notre affaire,
  // mais une adresse qui en porte un serait sinon refusée en silence.
  const sansPort = deporter(brut);
  if (sansPort.includes(":")) return parseIpv6(sansPort);
  return parseIpv4(sansPort);
}

/** Retire un éventuel port, et les crochets d'une IPv6 littérale. */
function deporter(brut) {
  if (brut.startsWith("[")) {
    const fin = brut.indexOf("]");
    return fin > 0 ? brut.slice(1, fin) : brut;
  }
  // `1.2.3.4:443` — un seul deux-points ET des points avant lui : c'est un port.
  const premier = brut.indexOf(":");
  if (premier > 0 && brut.indexOf(":", premier + 1) === -1 && brut.includes(".")) {
    return brut.slice(0, premier);
  }
  return brut;
}

function parseIpv4(texte) {
  const parts = texte.split(".");
  if (parts.length !== 4) return null;
  let a = 0;
  for (const p of parts) {
    if (p.length === 0 || p.length > 3) return null;
    if (p.length > 1 && p[0] === "0") return null; // zéro de tête : ambigu, refusé
    let n = 0;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c < 48 || c > 57) return null;
      n = n * 10 + (c - 48);
    }
    if (n > 255) return null;
    a = (a * 256 + n) >>> 0;
  }
  return { v: 4, a: a >>> 0 };
}

function parseIpv6(texte) {
  // Zone d'interface (`fe80::1%eth0`) : elle ne fait pas partie de l'adresse.
  let corps = texte.split("%")[0];

  // Un IPv4 en queue (`::ffff:192.0.2.1`, `1:2:3:4:5:6:7.8.9.10`) vaut deux
  // groupes de 16 bits. On le RÉÉCRIT en hexadécimal plutôt que de traiter deux
  // formes en parallèle : la suite n'a plus qu'une grammaire à connaître.
  if (corps.includes(".")) {
    const coupe = corps.lastIndexOf(":");
    if (coupe < 0) return null;
    const v4 = parseIpv4(corps.slice(coupe + 1));
    if (!v4) return null;
    const haut = ((v4.a >>> 16) & 0xffff).toString(16);
    const bas = (v4.a & 0xffff).toString(16);
    corps = `${corps.slice(0, coupe + 1)}${haut}:${bas}`;
  }

  const moities = corps.split("::");
  if (moities.length > 2) return null;
  const abrege = moities.length === 2;
  const gauche = groupes(moities[0]);
  const droite = abrege ? groupes(moities[1]) : [];
  if (gauche === null || droite === null) return null;

  // Sans `::`, huit groupes exactement. Avec, sept au plus : `::` en vaut au moins un.
  if (!abrege && gauche.length !== 8) return null;
  if (abrege && gauche.length + droite.length > 7) return null;

  const mots = new Array(8).fill(0);
  for (let i = 0; i < gauche.length; i++) mots[i] = gauche[i];
  for (let i = 0; i < droite.length; i++) mots[8 - droite.length + i] = droite[i];

  let hi = 0n;
  let lo = 0n;
  for (let i = 0; i < 4; i++) hi = (hi << 16n) | BigInt(mots[i]);
  for (let i = 4; i < 8; i++) lo = (lo << 16n) | BigInt(mots[i]);
  return { v: 6, hi, lo };
}

/** Groupes hexadécimaux d'une moitié d'IPv6 ; null si l'un d'eux est invalide. */
function groupes(morceau) {
  if (morceau === "") return [];
  const out = [];
  for (const g of morceau.split(":")) {
    if (g === "") return null;
    if (g.length > 4) return null;
    let n = 0;
    for (let i = 0; i < g.length; i++) {
      const c = g.charCodeAt(i);
      const d = c >= 48 && c <= 57 ? c - 48
        : c >= 97 && c <= 102 ? c - 87
        : c >= 65 && c <= 70 ? c - 55
        : -1;
      if (d < 0) return null;
      n = n * 16 + d;
    }
    out.push(n);
  }
  return out.length > 8 ? null : out;
}

/**
 * `::ffff:a.b.c.d` : une IPv4 déguisée, ramenée à son vrai domaine.
 *
 * C'est la forme que Node rend sur une socket à double pile : sans ce
 * dépliage, toute connexion IPv4 d'un serveur écoutant en `::` serait cherchée
 * dans la moitié IPv6 de la base et sortirait « inconnue ».
 *
 * La forme historique `::a.b.c.d` (IPv4-compatible, dépréciée depuis 2006) n'est
 * PAS dépliée : elle est indiscernable de `::1`, et confondre la boucle locale
 * avec 0.0.0.1 serait pire que de la laisser inconnue.
 */
export function demasquer(ip) {
  if (!ip || ip.v !== 6) return ip;
  if (ip.hi === 0n && (ip.lo >> 32n) === 0xffffn) {
    return { v: 4, a: Number(ip.lo & 0xffffffffn) >>> 0 };
  }
  return ip;
}

// ───────────────────── Plages qui ne désignent aucun réseau public ───────────

const RESERVEES_V4 = [
  // [premier, dernier] inclus, en entiers 32 bits.
  [0x00000000, 0x00ffffff], // 0.0.0.0/8      « ce réseau »
  [0x0a000000, 0x0affffff], // 10.0.0.0/8     privé
  [0x64400000, 0x647fffff], // 100.64.0.0/10  CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8    boucle locale
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 lien-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12  privé
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24   affectations IETF
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24   documentation (TEST-NET-1)
  [0xc0586300, 0xc05863ff], // 192.88.99.0/24 6to4 relais, déprécié
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 privé
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15  bancs de mesure
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 documentation (TEST-NET-2)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 documentation (TEST-NET-3)
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 multicast + 240.0.0.0/4 réservé
];

/**
 * L'adresse désigne-t-elle autre chose qu'un hôte public ?
 *
 * CE CONTRÔLE PASSE AVANT LA BASE, ET C'EST INDISPENSABLE. Vérifié sur la
 * livraison DB-IP de septembre 2026 : la base range bien `10.0.0.0/8` en `ZZ`,
 * mais elle attribue `fe00::/9` et `fec0::/10` à « CH ». Une adresse de réseau
 * interne pourrait donc ressortir avec un pays si on interrogeait la base en
 * premier. Une IP privée est « inconnu », jamais un pays.
 */
export function estReservee(ip) {
  const a = demasquer(ip);
  if (!a) return true;
  if (a.v === 4) {
    const n = a.a >>> 0;
    for (const [debut, fin] of RESERVEES_V4) {
      if (n >= debut >>> 0 && n <= fin >>> 0) return true;
    }
    return false;
  }
  // EN IPv6, ON RAISONNE À L'ENVERS DE L'IPv4. Une seule plage est de
  // l'unicast global : `2000::/3`. Tout ce qui est en dehors — `::`, `::1`,
  // `fc00::/7` (unique-local), `fe80::/10` (lien-local), `fec0::/10`
  // (site-local, abandonné), `ff00::/8` (multicast) et tout l'espace non
  // attribué — n'est pas l'adresse d'un hôte joignable publiquement. Énumérer
  // les exclusions laisserait passer les trous ; on énumère la seule inclusion.
  if ((Number(a.hi >> 56n) & 0xe0) !== 0x20) return true;
  if ((a.hi >> 32n) === 0x20010db8n) return true; // 2001:db8::/32 documentation
  return false;
}

// ──────────────────────────── Chargement de la base ─────────────────────────

/** Nombre de lignes au-delà duquel on refuse de charger (garde-fou mémoire). */
export const MAX_LIGNES = 4_000_000;

/**
 * Construit la base interrogeable à partir du CSV DB-IP.
 *
 * REFUS PLUTÔT QUE RÉPARATION. Un fichier non trié, ou dont une ligne est
 * illisible au-delà d'une tolérance minime, est REFUSÉ en bloc : DB-IP livre un
 * fichier trié, donc un fichier qui ne l'est pas a été tronqué, concaténé ou
 * édité à la main. Le trier nous-mêmes masquerait l'accident ; le refuser
 * éteint simplement GeoIP, et l'ingestion continue avec le fuseau.
 *
 * @param {string} csv contenu complet du fichier
 * @param {{version: string}} meta
 * @returns {{ok:true, base:object} | {ok:false, raison:string, detail?:object}}
 */
export function chargerBase(csv, { version }) {
  if (typeof csv !== "string" || csv.length === 0) {
    return { ok: false, raison: "geoip_db_vide" };
  }

  // DEUX PASSES, ET C'EST MESURÉ. La version naïve — `split("\n")` puis des
  // tableaux JavaScript qu'on convertit à la fin — fait culminer le processus à
  // 240 Mio résidents pour un index qui n'en pèse que 15 : 717 000 chaînes et
  // autant de BigInt boîtés, que V8 ne rend pas au système une fois collectés.
  // On compte d'abord, on alloue exactement, on remplit ensuite : le pic
  // retombe à la taille du texte lui-même.
  const compte = compter(csv);
  if (compte.lignes > MAX_LIGNES) {
    return { ok: false, raison: "geoip_db_trop_grande", detail: { lignes: compte.lignes } };
  }

  // Table des pays internée : un index 16 bits par plage au lieu d'une chaîne.
  const pays = [null];
  const indexPays = new Map([[INCONNU, 0]]);
  const codePour = (code) => {
    const connu = indexPays.get(code);
    if (connu !== undefined) return connu;
    const i = pays.push(code) - 1;
    indexPays.set(code, i);
    return i;
  };

  const v4 = {
    debut: new Uint32Array(compte.v4),
    fin: new Uint32Array(compte.v4),
    cc: new Uint16Array(compte.v4),
  };
  const v6 = {
    debutHi: new BigUint64Array(compte.v6),
    debutLo: new BigUint64Array(compte.v6),
    finHi: new BigUint64Array(compte.v6),
    finLo: new BigUint64Array(compte.v6),
    cc: new Uint16Array(compte.v6),
  };
  let i4 = 0;
  let i6 = 0;
  let ignorees = 0;

  for (let debutLigne = 0; debutLigne < csv.length;) {
    let finLigne = csv.indexOf("\n", debutLigne);
    if (finLigne < 0) finLigne = csv.length;
    const suivante = finLigne + 1;
    if (finLigne > debutLigne && csv.charCodeAt(finLigne - 1) === 13) finLigne--; // CRLF
    if (finLigne <= debutLigne) { debutLigne = suivante; continue; }

    const a = csv.indexOf(",", debutLigne);
    const b = a < 0 || a >= finLigne ? -1 : csv.indexOf(",", a + 1);
    if (a < 0 || b < 0 || b >= finLigne) { ignorees++; debutLigne = suivante; continue; }
    const code = csv.slice(b + 1, finLigne);
    const debut = CODE_PAYS.test(code) ? parseIp(csv.slice(debutLigne, a)) : null;
    const fin = debut ? parseIp(csv.slice(a + 1, b)) : null;
    if (!debut || !fin || debut.v !== fin.v) { ignorees++; debutLigne = suivante; continue; }

    if (debut.v === 4 && (debut.a >>> 0) <= (fin.a >>> 0) && i4 < v4.debut.length) {
      v4.debut[i4] = debut.a >>> 0;
      v4.fin[i4] = fin.a >>> 0;
      v4.cc[i4] = codePour(code);
      i4++;
    } else if (debut.v === 6 && (debut.hi < fin.hi || (debut.hi === fin.hi && debut.lo <= fin.lo)) && i6 < v6.cc.length) {
      v6.debutHi[i6] = debut.hi;
      v6.debutLo[i6] = debut.lo;
      v6.finHi[i6] = fin.hi;
      v6.finLo[i6] = fin.lo;
      v6.cc[i6] = codePour(code);
      i6++;
    } else {
      ignorees++;
    }
    debutLigne = suivante;
  }

  const retenues = i4 + i6;
  if (retenues === 0) return { ok: false, raison: "geoip_db_illisible", detail: { ignorees } };
  // Une poignée de lignes illisibles dans un fichier de 700 000 est un artefact ;
  // 1 % l'est déjà beaucoup moins, et le fichier n'est alors plus celui qu'on croit.
  if (ignorees > retenues / 100) {
    return { ok: false, raison: "geoip_db_illisible", detail: { ignorees, retenues } };
  }

  for (let i = 1; i < i4; i++) {
    if (v4.debut[i] <= v4.fin[i - 1]) {
      return { ok: false, raison: "geoip_db_non_triee", detail: { famille: 4, ligne: i } };
    }
  }
  for (let i = 1; i < i6; i++) {
    const apres = v6.debutHi[i] > v6.finHi[i - 1]
      || (v6.debutHi[i] === v6.finHi[i - 1] && v6.debutLo[i] > v6.finLo[i - 1]);
    if (!apres) {
      return { ok: false, raison: "geoip_db_non_triee", detail: { famille: 6, ligne: i } };
    }
  }

  // `subarray` et non `slice` : on borne la vue aux lignes retenues sans
  // recopier l'index — le surplus vaut le nombre de lignes rejetées, nul sur la
  // livraison réelle.
  return {
    ok: true,
    base: {
      version,
      pays,
      v4: { debut: v4.debut.subarray(0, i4), fin: v4.fin.subarray(0, i4), cc: v4.cc.subarray(0, i4) },
      v6: {
        debutHi: v6.debutHi.subarray(0, i6),
        debutLo: v6.debutLo.subarray(0, i6),
        finHi: v6.finHi.subarray(0, i6),
        finLo: v6.finLo.subarray(0, i6),
        cc: v6.cc.subarray(0, i6),
      },
      stats: { lignes: retenues, v4: i4, v6: i6, ignorees },
    },
  };
}

/**
 * Première passe : combien de plages, et de quelle famille. La famille se lit au
 * premier champ — une IPv6 porte un deux-points, une IPv4 n'en porte jamais.
 * Aucune validation ici : c'est un DIMENSIONNEMENT, la passe suivante juge.
 */
function compter(csv) {
  let lignes = 0;
  let v4 = 0;
  let v6 = 0;
  for (let debut = 0; debut < csv.length;) {
    let fin = csv.indexOf("\n", debut);
    if (fin < 0) fin = csv.length;
    const suivante = fin + 1;
    if (fin > debut && csv.charCodeAt(fin - 1) === 13) fin--;
    if (fin > debut) {
      lignes++;
      const virgule = csv.indexOf(",", debut);
      const borne = virgule < 0 || virgule > fin ? fin : virgule;
      // Balayage explicite du PREMIER CHAMP. `lastIndexOf(":", borne)` remontait
      // sinon jusqu'au début du fichier à chaque ligne IPv4 — coût quadratique,
      // et un chargement qui ne se terminait plus (constaté sur la vraie base).
      let sixieme = false;
      for (let k = debut; k < borne; k++) {
        if (csv.charCodeAt(k) === 58 /* : */) { sixieme = true; break; }
      }
      if (sixieme) v6++;
      else v4++;
    }
    debut = suivante;
  }
  return { lignes, v4, v6 };
}

// ───────────────────────────── Interrogation ─────────────────────────────────

/**
 * Pays d'une adresse, ou `null`.
 *
 * NE LÈVE JAMAIS. Une base absente, une adresse illisible, une plage réservée,
 * un `ZZ` : tous rendent `null`, c'est-à-dire « inconnu ». C'est la règle du
 * dépôt — une donnée inconnue est `null`, jamais un pays par défaut — et c'est
 * aussi ce qui garantit que GeoIP ne peut pas faire échouer une ingestion.
 *
 * L'ADRESSE N'EST JAMAIS JOURNALISÉE ICI, ni renvoyée, ni attachée à une erreur.
 */
export function paysDe(base, ip) {
  try {
    if (!base) return null;
    const a = demasquer(typeof ip === "string" ? parseIp(ip) : ip);
    if (!a) return null;
    if (estReservee(a)) return null;
    const cc = a.v === 4 ? chercherV4(base.v4, a.a >>> 0) : chercherV6(base.v6, a.hi, a.lo);
    if (cc === 0 || cc < 0) return null;
    return base.pays[cc] ?? null;
  } catch {
    // Une base corrompue en mémoire ne doit pas faire tomber un lot de mesures.
    return null;
  }
}

/** Dichotomie sur des plages disjointes et croissantes. -1 = aucune plage. */
function chercherV4(t, n) {
  let bas = 0;
  let haut = t.debut.length - 1;
  while (bas <= haut) {
    const mid = (bas + haut) >> 1;
    if (n < t.debut[mid]) haut = mid - 1;
    else if (n > t.fin[mid]) bas = mid + 1;
    else return t.cc[mid];
  }
  return -1;
}

function chercherV6(t, hi, lo) {
  let bas = 0;
  let haut = t.debutHi.length - 1;
  while (bas <= haut) {
    const mid = (bas + haut) >> 1;
    if (hi < t.debutHi[mid] || (hi === t.debutHi[mid] && lo < t.debutLo[mid])) haut = mid - 1;
    else if (hi > t.finHi[mid] || (hi === t.finHi[mid] && lo > t.finLo[mid])) bas = mid + 1;
    else return t.cc[mid];
  }
  return -1;
}

// ───────────────────── Provenance posée sur les sessions ─────────────────────

/** Les trois provenances possibles d'un pays. Reflétées par la contrainte de v85. */
export const PROVENANCES = ["geoip", "timezone", "cdn"];

/**
 * Pose pays ET provenance sur les sessions d'un lot.
 *
 * ORDRE DE PRÉCÉDENCE, ET SA RAISON :
 *
 *   1. `geoip` — l'adresse par laquelle le trafic est RÉELLEMENT arrivé. C'est
 *      la seule des trois qui mesure le réseau plutôt qu'une déclaration.
 *   2. `timezone` — déjà posée par `flattenOtlp` depuis `mip.tz`. Le fuseau est
 *      un réglage du terminal : le client le choisit, et une zone couvre
 *      souvent plusieurs pays.
 *   3. `cdn` — l'en-tête pays d'un CDN placé devant (Vercel, Cloudflare). C'est
 *      aussi une résolution d'IP, mais faite chez un tiers ; elle n'existe que
 *      là où un CDN est en façade. Elle reste EN DERNIER pour ne pas déplacer
 *      des chiffres déjà publiés : jusqu'à ce lot, le fuseau primait déjà sur
 *      elle, et rien dans P8.7 ne justifie d'inverser un classement existant.
 *
 * `geoip` passe DEVANT le fuseau, et c'est le seul changement de classement du
 * lot : la spec demande que GeoIP « précise l'approximation ». Sans cela il ne
 * servirait presque jamais — le SDK web émet toujours `mip.tz`.
 *
 * CE QUE CETTE FONCTION NE FAIT PAS : toucher à une session déjà écrite. Elle
 * ne remplit que les lignes du lot courant ; la clause `on conflict` de
 * `pg-ingest.mjs` garde la première valeur connue. Une adresse d'aujourd'hui ne
 * peut donc pas réécrire le pays d'une session d'hier.
 */
export function appliquerGeo(sessions, { geoip = null, cdn = null } = {}) {
  if (!Array.isArray(sessions)) return;
  const paysCdn = typeof cdn === "string" && CODE_PAYS.test(cdn.trim().toUpperCase())
    ? cdn.trim().toUpperCase()
    : null;
  for (const s of sessions) {
    if (!s) continue;
    if (geoip?.country) {
      s.geo_country = geoip.country;
      s.geo_source = "geoip";
      s.geo_db_version = geoip.version ?? null;
      continue;
    }
    if (s.geo_country) continue; // fuseau déjà posé, provenance comprise
    if (paysCdn) {
      s.geo_country = paysCdn;
      s.geo_source = "cdn";
    }
  }
}

// ─────────────────────────── Version et péremption ───────────────────────────

/** `dbip-country-lite-2026-09.csv.gz` → `dbip-country-lite-2026-09`. */
export function versionDepuisNom(nom) {
  if (typeof nom !== "string") return null;
  const base = nom.split("/").pop() ?? "";
  const m = /^(dbip-country-lite-(\d{4})-(\d{2}))\.csv(\.gz)?$/.exec(base);
  if (!m) return null;
  const mois = Number(m[3]);
  if (mois < 1 || mois > 12) return null;
  return { version: m[1], annee: Number(m[2]), mois };
}

/**
 * Âge de la livraison, en jours, au premier du mois annoncé.
 *
 * L'ÂGE SE LIT DANS LE NOM, PAS DANS LE SYSTÈME DE FICHIERS. Une image Docker
 * remet les dates de modification à la construction : `mtime` dirait qu'une base
 * de mars est neuve. DB-IP nomme ses livraisons par mois, et c'est cette date-là
 * qui décrit la donnée.
 */
export function ageEnJours(version, maintenant) {
  const v = typeof version === "string" ? versionDepuisNom(`${version}.csv`) : version;
  if (!v) return null;
  const publiee = Date.UTC(v.annee, v.mois - 1, 1);
  return Math.floor((maintenant - publiee) / 86_400_000);
}
