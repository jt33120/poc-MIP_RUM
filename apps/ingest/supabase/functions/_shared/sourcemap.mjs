// Moteur de source maps v3 — PUR : ni dépendance, ni entrée/sortie, ni horloge.
//
// UNE implémentation pour quatre usages (P5.4) : la validation des uploads
// (lib/sourcemap-upload.mjs), la symbolication au moment de l'ingestion
// (lib/error-symbolication.mjs), le CLI de CI (scripts/upload-sourcemaps.mjs)
// et l'affichage console (réexporté par apps/console/lib/sourcemap.ts). Un
// décodeur plus permissif à la lecture qu'à l'upload accepterait en base ce que
// l'upload refuse — et inversement, une map acceptée hier deviendrait illisible.
//
// POURQUOI UN INDEX À POINTS DE REPRISE. La version d'origine rangeait chaque
// segment dans un objet JavaScript (~80 octets) ; des tableaux typés en coûtent
// encore 20. Mesuré : une map de 15 Mio donne trois millions de segments, soit
// 80 Mio décodés — plus que tout le cache de l'ingestion. On garde donc la
// chaîne `mappings` (1 octet par caractère) et, tous les `CHECKPOINT_EVERY`
// segments d'une ligne, l'état cumulé du décodeur. Une recherche repart du
// point de reprise le plus proche et décode au plus quelques dizaines de
// segments : environ 1 octet par segment en mémoire, quelques microsecondes par
// frame. Le coût mémoire est CALCULABLE AVANT le décodage (`consumerFootprint`) :
// une map trop lourde est refusée sans rien allouer.
//
// COÛT BORNÉ FACE À UNE ENTRÉE HOSTILE. Une recherche ne quitte jamais sa ligne
// générée (elle s'arrête au premier `;`) et ne décode qu'entre deux points de
// reprise ; un segment vide (`,,`) est une erreur de structure, pas une suite de
// séparateurs à parcourir. Les frames de stack sont lues par un analyseur
// linéaire, sans expression régulière à retour arrière : la stack vient du client.
// Le consommateur ne retient ni le JSON d'origine ni `sourcesContent`.
//
// CE QUE CE MODULE NE FAIT JAMAIS. Suivre un `sourceRoot` ou une URL de source,
// lire un fichier, résoudre un `sourceMappingURL`. Les chemins des sources sont
// des ÉTIQUETTES : `virtualSourcePath` les réduit à un chemin relatif sans
// schéma ni `..`, qui ne désigne rien d'atteignable.

/** Erreur de contenu : la map est refusée (upload) ou inutilisable (lecture). */
export class SourceMapError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceMapError";
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALEUR_B64 = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) VALEUR_B64[B64.charCodeAt(i)] = i;

const VIRGULE = 44;
const POINT_VIRGULE = 59;
/** Plus grande valeur cumulée acceptée : au-delà, un Int32Array la tronquerait. */
const MAX_INDEX = 2 ** 31 - 1;
/** Poids du septième chiffre VLQ : 35 bits suffisent à tout Int32 signé. */
const POIDS_MAX = 2 ** 30;

/** Un point de reprise tous les N segments d'une ligne générée. */
export const CHECKPOINT_EVERY = 32;
/** Octets d'un point de reprise : huit Int32. */
const OCTETS_REPRISE = 32;
/** Au-delà, une ligne de stack n'est pas une frame : aucune frame réelle n'est aussi longue. */
export const MAX_FRAME_LINE_LENGTH = 1024;
/** Longueur maximale d'un chemin virtuel de source. */
const MAX_SOURCE_PATH = 512;
/** Longueur maximale d'un nom de fonction rendu par une map. */
const MAX_NAME = 256;

/**
 * Décodeur séquentiel de `mappings`, sans allocation par segment. Après un
 * `next()` vrai, les champs publics décrivent le segment lu ; `before*` gardent
 * l'état cumulé AVANT lui, ce qu'un point de reprise enregistre.
 */
class MappingsCursor {
  constructor(mappings, { strict = false, sources = Infinity, names = Infinity, uneLigne = false } = {}) {
    this.mappings = mappings;
    this.strict = strict;
    // Recherche : la ligne générée demandée seulement, jamais les suivantes.
    this.uneLigne = uneLigne;
    this.sourceCount = sources;
    this.nameCount = names;
    this.champs = [0, 0, 0, 0, 0];
    this.seek(0, 0, 0, 0, 0, 0, 0);
  }

  /** Place le curseur sur un début de segment avec l'état cumulé qui le précède. */
  seek(offset, line, column, source, originalLine, originalColumn, name) {
    this.offset = offset;
    this.line = line;
    this.column = column;
    this.source = source;
    this.originalLine = originalLine;
    this.originalColumn = originalColumn;
    this.name = name;
    this.hasSource = false;
    this.hasName = false;
    this.indexInLine = 0;
    this.start = offset;
    // Tous les champs existent dès la construction : une forme d'objet stable
    // garde `next()` monomorphe pour l'optimiseur.
    this.beforeColumn = column;
    this.beforeSource = source;
    this.beforeOriginalLine = originalLine;
    this.beforeOriginalColumn = originalColumn;
    this.beforeName = name;
  }

  next() {
    const m = this.mappings;
    const len = m.length;
    let i = this.offset;
    // Une virgule consommée par le segment précédent annonce un segment.
    const apresVirgule = i > 0 && i <= len && m.charCodeAt(i - 1) === VIRGULE;
    if (apresVirgule && (i === len || m.charCodeAt(i) === VIRGULE || m.charCodeAt(i) === POINT_VIRGULE)) {
      throw new SourceMapError(`segment vide en position ${i}`);
    }
    for (; i < len; i++) {
      const c = m.charCodeAt(i);
      if (c === POINT_VIRGULE) {
        if (this.uneLigne) {
          this.offset = i;
          return false;
        }
        this.line++;
        this.column = 0;
        this.indexInLine = 0;
      } else if (c === VIRGULE) {
        // Hors d'un segment, une virgule ouvre un segment vide : `,,` ou `;,`.
        throw new SourceMapError(`segment vide en position ${i}`);
      } else break;
    }
    if (i >= len) {
      this.offset = len;
      return false;
    }
    this.start = i;
    this.beforeColumn = this.column;
    this.beforeSource = this.source;
    this.beforeOriginalLine = this.originalLine;
    this.beforeOriginalColumn = this.originalColumn;
    this.beforeName = this.name;

    const champs = this.champs;
    let n = 0;
    let valeur = 0;
    let poids = 1;
    for (; i < len; i++) {
      const c = m.charCodeAt(i);
      if (c === VIRGULE || c === POINT_VIRGULE) break;
      const chiffre = c < 128 ? VALEUR_B64[c] : -1;
      if (chiffre < 0) throw new SourceMapError(`caractère invalide dans mappings en position ${i}`);
      // Arithmétique flottante, pas de décalage binaire : exacte bien au-delà
      // d'Int32, donc un dépassement est détecté au lieu d'être replié.
      valeur += (chiffre & 31) * poids;
      if (chiffre & 32) {
        poids *= 32;
        if (poids > POIDS_MAX) throw new SourceMapError(`valeur VLQ hors bornes en position ${i}`);
      } else {
        if (n === 5) throw new SourceMapError(`segment à plus de 5 champs en position ${i}`);
        const absolu = Math.floor(valeur / 2);
        champs[n++] = valeur % 2 === 1 ? -absolu : absolu;
        valeur = 0;
        poids = 1;
      }
    }
    if (poids !== 1) throw new SourceMapError(`valeur VLQ tronquée en position ${i}`);
    if (n !== 1 && n !== 4 && n !== 5) {
      throw new SourceMapError(`segment à ${n} champ(s) en position ${this.start} (1, 4 ou 5 attendus)`);
    }
    // La virgule appartient au segment ; le point-virgule reste pour le prochain
    // appel, qui changera de ligne.
    this.offset = i < len && m.charCodeAt(i) === VIRGULE ? i + 1 : i;

    const column = this.column + champs[0];
    if (column < 0 || column > MAX_INDEX) throw new SourceMapError(`colonne générée hors bornes en position ${this.start}`);
    if (this.strict && this.indexInLine > 0 && column < this.column) {
      throw new SourceMapError(`segments non ordonnés dans la ligne générée ${this.line + 1}`);
    }
    this.column = column;
    this.hasSource = n >= 4;
    this.hasName = n === 5;
    if (this.hasSource) {
      this.source += champs[1];
      this.originalLine += champs[2];
      this.originalColumn += champs[3];
      if (
        this.source < 0 || this.originalLine < 0 || this.originalColumn < 0 ||
        this.source > MAX_INDEX || this.originalLine > MAX_INDEX || this.originalColumn > MAX_INDEX
      ) {
        throw new SourceMapError(`position d'origine hors bornes en position ${this.start}`);
      }
      if (this.strict && this.source >= this.sourceCount) {
        throw new SourceMapError(`index de source ${this.source} hors bornes en position ${this.start}`);
      }
      if (this.hasName) {
        this.name += champs[4];
        if (this.name < 0 || this.name > MAX_INDEX) throw new SourceMapError(`index de nom hors bornes en position ${this.start}`);
        if (this.strict && this.name >= this.nameCount) {
          throw new SourceMapError(`index de nom ${this.name} hors bornes en position ${this.start}`);
        }
      }
    }
    this.indexInLine++;
    return true;
  }
}

/**
 * Segments, lignes générées et lignes portant au moins un segment, en un
 * parcours et sans décoder : c'est ce qui dimensionne l'index.
 */
function structure(mappings) {
  let segments = 0;
  let lines = 1;
  let linesWithSegments = 0;
  let dansSegment = false;
  let ligneComptee = false;
  for (let i = 0; i < mappings.length; i++) {
    const c = mappings.charCodeAt(i);
    if (c === POINT_VIRGULE) {
      lines++;
      dansSegment = false;
      ligneComptee = false;
    } else if (c === VIRGULE) {
      dansSegment = false;
    } else if (!dansSegment) {
      dansSegment = true;
      segments++;
      if (!ligneComptee) {
        ligneComptee = true;
        linesWithSegments++;
      }
    }
  }
  return { segments, lines, linesWithSegments };
}

/** Coût mémoire approché d'un tableau de chaînes (en-tête d'objet + UTF-16). */
function octetsChaines(valeurs) {
  let n = 0;
  for (const v of valeurs) n += 16 + (typeof v === "string" ? v.length * 2 : 0);
  return n;
}

/**
 * Mémoire qu'un consommateur retiendrait pour cette map, calculée SANS décoder :
 * la chaîne `mappings`, les points de reprise, les chemins et les noms. Une map
 * de points-virgules (des millions de lignes vides) ne coûte rien de plus :
 * aucune structure n'est dimensionnée par le nombre de lignes.
 */
export function consumerFootprint(map) {
  const mappings = typeof map?.mappings === "string" ? map.mappings : "";
  return empreinteMemoire(map, mappings, structure(mappings));
}

function empreinteMemoire(map, mappings, { segments, linesWithSegments }) {
  return (
    mappings.length +
    (Math.ceil(segments / CHECKPOINT_EVERY) + linesWithSegments) * OCTETS_REPRISE +
    octetsChaines(Array.isArray(map?.sources) ? map.sources : []) +
    octetsChaines(Array.isArray(map?.names) ? map.names : [])
  );
}

const CONTROLE = /[\u0000-\u001f\u007f]/;

/** Vrai si le texte contient un caractère de contrôle (NUL compris). */
export function hasControlCharacters(texte) {
  return CONTROLE.test(texte);
}

/**
 * Chemin d'affichage d'une source : `sourceRoot` appliqué aux sources relatives,
 * schéma retiré (`webpack://`, `https://`, `file://`), barres normalisées,
 * `.` et `..` résolus sans jamais remonter au-dessus de la racine, requête et
 * fragment ôtés. Le résultat est relatif, sans schéma : il ne désigne ni un
 * fichier du serveur ni une URL, et rien ne le lit.
 *
 * @returns {string|null} null si la source n'est pas une chaîne ou ne laisse aucun segment
 */
export function virtualSourcePath(sourceRoot, source) {
  if (typeof source !== "string") return null;
  const absolue = /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("/");
  const brut = typeof sourceRoot === "string" && sourceRoot && !absolue
    ? `${sourceRoot.replace(/\/+$/, "")}/${source}`
    : source;
  const chemin = brut
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[?#]/)[0]
    .replace(/\\/g, "/")
    .replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, "")
    .replace(/^\/+/, "")
    .replace(/^[a-z]:\//i, "");
  const segments = [];
  for (const s of chemin.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") segments.pop();
    else segments.push(s);
  }
  const out = segments.join("/").slice(0, MAX_SOURCE_PATH);
  return out || null;
}

/** Chaîne optionnelle bornée, sans caractère de contrôle. */
function chaineOptionnelle(valeur, champ, max) {
  if (valeur === undefined || valeur === null) return;
  if (typeof valeur !== "string" || valeur.length > max || CONTROLE.test(valeur)) {
    throw new SourceMapError(`champ ${champ} invalide (chaîne de ${max} caractères au plus, sans caractère de contrôle)`);
  }
}

/**
 * Validation STRICTE d'une source map v3 déjà parsée, sans allocation
 * proportionnelle aux segments. Refus explicites : map indexée (`sections`),
 * version ≠ 3, types inattendus, chemins avec caractères de contrôle, mappings
 * mal formés (segment vide compris), non ordonnés ou incohérents avec
 * `sources`/`names`.
 *
 * @returns {{ sources: number, names: number, segments: number }}
 */
export function validateSourceMap(map) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    throw new SourceMapError("le contenu n'est pas un objet JSON de source map");
  }
  if ("sections" in map) {
    throw new SourceMapError("source map indexée (sections) non prise en charge : envoyer la map de chaque fichier");
  }
  if (map.version !== 3) throw new SourceMapError("version 3 attendue");
  if (typeof map.mappings !== "string") throw new SourceMapError("champ mappings (chaîne) attendu");
  if (!Array.isArray(map.sources)) throw new SourceMapError("champ sources (tableau) attendu");
  if (map.names !== undefined && !Array.isArray(map.names)) throw new SourceMapError("champ names : tableau attendu");
  map.sources.forEach((s, i) => chaineOptionnelle(s, `sources[${i}]`, 2048));
  const names = map.names ?? [];
  names.forEach((n, i) => {
    if (typeof n !== "string") throw new SourceMapError(`champ names[${i}] : chaîne attendue`);
    chaineOptionnelle(n, `names[${i}]`, 1024);
  });
  chaineOptionnelle(map.sourceRoot, "sourceRoot", 2048);
  chaineOptionnelle(map.file, "file", 1024);
  if (map.sourcesContent !== undefined && map.sourcesContent !== null) {
    if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length > map.sources.length) {
      throw new SourceMapError("champ sourcesContent : tableau au plus aussi long que sources attendu");
    }
    map.sourcesContent.forEach((c, i) => {
      if (c !== null && typeof c !== "string") throw new SourceMapError(`champ sourcesContent[${i}] : chaîne ou null attendu`);
    });
  }
  const curseur = new MappingsCursor(map.mappings, { strict: true, sources: map.sources.length, names: names.length });
  let segments = 0;
  while (curseur.next()) segments++;
  return { sources: map.sources.length, names: names.length, segments };
}

const VIDE = Object.freeze({ source: null, line: null, column: null, name: null });

/** Nom rendu par une map : chaîne sans caractère de contrôle, bornée ; sinon null. */
function nomAffichable(nom) {
  if (typeof nom !== "string") return null;
  return nom.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME) || null;
}

/**
 * Consommateur d'une source map : position générée (ligne 1-based, colonne
 * 0-based) → position d'origine. `bytes` est la mémoire qu'il retient — la
 * valeur de `consumerFootprint`, que le cache d'ingestion additionne.
 *
 * Seuls la chaîne `mappings`, les chemins virtuels et les noms nettoyés passent
 * à `indexer` : aucune fonction retournée ne capture l'objet `map`, dont le JSON
 * complet (`sourcesContent` compris) peut ainsi être libéré.
 *
 * Tolérant par défaut (maps anciennes, uploadées avant la validation stricte) ;
 * `strict` refuse les incohérences comme l'upload. Les erreurs de structure
 * (VLQ invalide, segment vide…) sont refusées dans les deux modes.
 *
 * @param {object} map source map v3 parsée
 * @param {{ strict?: boolean }} [opts]
 */
export function createConsumer(map, { strict = false } = {}) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    throw new SourceMapError("le contenu n'est pas un objet JSON de source map");
  }
  if ("sections" in map) throw new SourceMapError("source map indexée (sections) non prise en charge");
  const mappings = typeof map.mappings === "string" ? map.mappings : "";
  const racine = map.sourceRoot;
  const sources = Array.isArray(map.sources) ? map.sources.map((s) => virtualSourcePath(racine, s)) : [];
  const names = Array.isArray(map.names) ? map.names.map(nomAffichable) : [];
  const forme = structure(mappings);
  return indexer(mappings, sources, names, empreinteMemoire(map, mappings, forme), forme, strict);
}

/** Index à points de reprise et recherche bornée, construits sans la map d'origine. */
function indexer(mappings, sources, names, bytes, forme, strict) {
  const nbLignes = forme.lines;
  const capacite = Math.ceil(forme.segments / CHECKPOINT_EVERY) + forme.linesWithSegments;
  const reprise = {
    offset: new Int32Array(capacite),
    line: new Int32Array(capacite),
    column: new Int32Array(capacite),
    source: new Int32Array(capacite),
    originalLine: new Int32Array(capacite),
    originalColumn: new Int32Array(capacite),
    name: new Int32Array(capacite),
    // Colonne générée du segment lui-même : la clé de la recherche dichotomique.
    at: new Int32Array(capacite),
  };
  const curseur = new MappingsCursor(mappings, { strict, sources: sources.length, names: names.length });
  let k = 0;
  while (curseur.next()) {
    if ((curseur.indexInLine - 1) % CHECKPOINT_EVERY !== 0) continue;
    reprise.offset[k] = curseur.start;
    reprise.line[k] = curseur.line;
    reprise.column[k] = curseur.beforeColumn;
    reprise.source[k] = curseur.beforeSource;
    reprise.originalLine[k] = curseur.beforeOriginalLine;
    reprise.originalColumn[k] = curseur.beforeOriginalColumn;
    reprise.name[k] = curseur.beforeName;
    reprise.at[k] = curseur.column;
    k++;
  }
  /** Premier point de reprise dont la ligne est ≥ `ligne` (points triés par ligne). */
  const premierDeLigne = (ligne) => {
    let lo = 0;
    let hi = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (reprise.line[mid] < ligne) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const lecteur = new MappingsCursor(mappings, { uneLigne: true });

  return {
    bytes,
    /** @returns {{ source: string|null, line: number|null, column: number|null, name: string|null }} */
    originalPositionFor(genLine1, genCol0) {
      const ligne = genLine1 - 1;
      if (!Number.isInteger(ligne) || ligne < 0 || ligne >= nbLignes || !(genCol0 >= 0)) return VIDE;
      const a = premierDeLigne(ligne);
      const b = premierDeLigne(ligne + 1);
      if (a === b || reprise.at[a] > genCol0) return VIDE;
      let lo = a;
      let hi = b - 1;
      let p = a;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (reprise.at[mid] <= genCol0) {
          p = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      lecteur.seek(
        reprise.offset[p], ligne, reprise.column[p], reprise.source[p],
        reprise.originalLine[p], reprise.originalColumn[p], reprise.name[p],
      );
      let trouve = false;
      let source = -1;
      let line = -1;
      let column = -1;
      let nom = -1;
      // Plus grand segment de la ligne dont la colonne générée est ≤ la colonne
      // demandée : au plus un intervalle entre deux points de reprise, le point
      // suivant ayant, par la dichotomie, une colonne supérieure.
      while (lecteur.next() && lecteur.column <= genCol0) {
        trouve = true;
        source = lecteur.hasSource ? lecteur.source : -1;
        line = lecteur.originalLine;
        column = lecteur.originalColumn;
        nom = lecteur.hasName ? lecteur.name : -1;
      }
      if (!trouve || source < 0 || sources[source] == null) return VIDE;
      return {
        source: sources[source],
        line: line + 1,
        column,
        name: nom >= 0 ? (names[nom] ?? null) : null,
      };
    },
  };
}

// Formats reconnus, avec EXACTEMENT le résultat des expressions historiques
//   Chrome/V8        /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/
//   Firefox/Safari   /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/
// mais en un parcours : ces deux expressions reviennent en arrière de façon
// quadratique (mesuré : 406 ms pour une ligne hostile de 1 022 caractères), et la
// stack est une donnée du client. tests/unit/sourcemap.test.ts compare les deux
// implémentations sur un corpus aléatoire.

/** Caractères que `.` refuse : une frame ne les contient pas hors des espaces. */
const FIN_DE_LIGNE = /[\n\r\u2028\u2029]/;
const ESPACE = /\s/;
const estChiffre = (code) => code >= 48 && code <= 57;

/**
 * `:ligne:colonne` en fin de texte, après les espaces finaux et, pour Chrome,
 * une parenthèse fermante. Rend l'indice de fin du fichier, ou null.
 */
function positionFinale(texte, debut, parenthese) {
  let fin = texte.length;
  while (fin > debut && ESPACE.test(texte[fin - 1])) fin--;
  if (parenthese && fin > debut && texte[fin - 1] === ")") fin--;
  let i = fin;
  while (i > debut && estChiffre(texte.charCodeAt(i - 1))) i--;
  if (i === fin || i - 1 < debut || texte[i - 1] !== ":") return null;
  let j = i - 1;
  while (j > debut && estChiffre(texte.charCodeAt(j - 1))) j--;
  if (j === i - 1 || j - 1 < debut || texte[j - 1] !== ":") return null;
  return { finFichier: j - 1, line: Number(texte.slice(j, i - 1)), col: Number(texte.slice(i, fin)) };
}

/** Premier et dernier indice d'un caractère de fin de ligne dans [debut, fin), ou -1. */
function bornesFinDeLigne(texte, debut, fin) {
  let premier = -1;
  let dernier = -1;
  for (let i = debut; i < fin; i++) {
    if (FIN_DE_LIGNE.test(texte[i])) {
      if (premier < 0) premier = i;
      dernier = i;
    }
  }
  return { premier, dernier };
}

/**
 * Découpe `[debut, finFichier)` en fonction et fichier au premier séparateur
 * valide (`@` pour Firefox, espaces puis `(` pour Chrome), comme le quantificateur
 * paresseux d'origine ; sans séparateur valide, tout est fichier.
 */
function decouper(texte, debut, finFichier, chrome, espacesAvant) {
  const { premier, dernier } = bornesFinDeLigne(texte, debut, finFichier);
  // Une fonction commence à `debut`, un fichier finit à `finFichier` : le premier
  // (resp. dernier) caractère de fin de ligne de la zone suffit à les juger.
  const fonctionPropre = (fin) => premier < 0 || premier >= fin;
  const fichierPropre = (depart) => dernier < depart;
  const marque = chrome ? "(" : "@";
  for (let p = texte.indexOf(marque, debut); p >= 0 && p < finFichier; p = texte.indexOf(marque, p + 1)) {
    let finFn = p;
    if (chrome) {
      while (finFn > debut && ESPACE.test(texte[finFn - 1])) finFn--;
      if (finFn === p || finFn === debut) continue; // `\s+\(` après une fonction non vide
    }
    if (!fonctionPropre(finFn)) break; // toute fonction plus longue contiendrait ce caractère
    if (p + 1 >= finFichier) break; // tout fichier plus court serait vide
    if (!fichierPropre(p + 1)) continue;
    return { fn: texte.slice(debut, finFn) || null, file: texte.slice(p + 1, finFichier) };
  }
  if (debut < finFichier) return fichierPropre(debut) ? { fn: null, file: texte.slice(debut, finFichier) } : null;
  // Fichier vide : l'expression reprend un espace de tête pour en faire le fichier,
  // sauf si c'est un caractère de fin de ligne, que `.` refuse.
  return espacesAvant && !FIN_DE_LIGNE.test(texte[debut - 1]) ? { fn: null, file: texte[debut - 1] } : null;
}

/**
 * Frame JavaScript d'une ligne de stack, ou null. Une ligne de plus de
 * `MAX_FRAME_LINE_LENGTH` caractères n'en est pas une.
 *
 * @returns {{ fn: string|null, file: string, line: number, col: number }|null}
 */
export function parseStackLine(line) {
  if (typeof line !== "string" || line.length > MAX_FRAME_LINE_LENGTH) return null;
  let debut = 0;
  while (debut < line.length && ESPACE.test(line[debut])) debut++;
  // Chrome : `at` suivi d'au moins un espace.
  if (line.startsWith("at", debut) && debut + 2 < line.length && ESPACE.test(line[debut + 2])) {
    let apres = debut + 3;
    while (apres < line.length && ESPACE.test(line[apres])) apres++;
    const position = positionFinale(line, apres, true);
    const morceaux = position && decouper(line, apres, position.finFichier, true, apres - (debut + 2) >= 2);
    if (morceaux) return { ...morceaux, line: position.line, col: position.col };
  }
  const position = positionFinale(line, debut, false);
  const morceaux = position && decouper(line, debut, position.finFichier, false, debut > 0);
  return morceaux ? { ...morceaux, line: position.line, col: position.col } : null;
}

/** Nom de bundle d'un fichier de frame : dernier segment, sans requête ni fragment. */
export function bundleName(file) {
  const dernier = String(file).split(/[/\\]/).pop() ?? "";
  return dernier.split(/[?#]/)[0];
}

/**
 * Réécrit une stack avec un fournisseur de consommateurs : `consumerFor(file)`
 * rend le consommateur du bundle cité par la frame, ou null. Lignes non
 * résolues conservées telles quelles, ligne pour ligne : la i-ème ligne du
 * résultat correspond toujours à la i-ème ligne brute.
 *
 * @param {string} stack
 * @param {(file: string) => ({ originalPositionFor: Function }|null)} consumerFor
 * @param {{ maxFrames?: number }} [opts] au-delà, les frames suivantes restent brutes
 * @returns {{ stack: string, resolved: number, frames: number,
 *   positions: Array<{ index: number, bundle: string, source: string, line: number, column: number, name: string|null }> }}
 */
export function symbolicateStackWith(stack, consumerFor, { maxFrames = Infinity } = {}) {
  let resolved = 0;
  let frames = 0;
  const positions = [];
  const out = String(stack).split("\n").map((ligne, index) => {
    if (frames >= maxFrames) return ligne;
    const frame = parseStackLine(ligne);
    if (!frame) return ligne;
    frames++;
    const consumer = consumerFor(frame.file);
    if (!consumer) return ligne;
    const pos = consumer.originalPositionFor(frame.line, frame.col - 1); // colonne de stack 1-based
    if (pos.source == null || pos.line == null) return ligne;
    resolved++;
    const fn = pos.name || frame.fn || "?";
    const column = pos.column ?? 0;
    positions.push({ index, bundle: bundleName(frame.file), source: pos.source, line: pos.line, column, name: pos.name });
    return `    at ${fn} (${pos.source}:${pos.line}:${column + 1})`;
  });
  return { stack: out.join("\n"), resolved, frames, positions };
}

/**
 * Réécrit une stack minifiée avec des maps déjà parsées, indexées par nom de
 * fichier minifié (« main.abc.js ») ou par URL complète.
 *
 * @param {string} stack
 * @param {Record<string, object>} maps
 * @returns {{ stack: string, resolved: number }}
 */
export function symbolicateStack(stack, maps) {
  const consumers = new Map();
  const consumerFor = (file) => {
    const cle = bundleName(file);
    if (!consumers.has(cle)) {
      const map = maps[cle] ?? maps[file];
      consumers.set(cle, map ? createConsumer(map) : null);
    }
    return consumers.get(cle);
  };
  const { stack: out, resolved } = symbolicateStackWith(stack, consumerFor);
  return { stack: out, resolved };
}

/**
 * Contexte de code autour d'une ligne d'origine (±`radius`), tiré de
 * `sourcesContent`. Réservé à l'affichage admin : c'est du code du client.
 *
 * @returns {{ source: string, line: number, start: number, lines: string[] }|null}
 */
export function codeContext(map, source, line, radius = 3) {
  if (!map || !Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)) return null;
  if (!Number.isInteger(line) || line < 1) return null;
  const index = map.sources.findIndex((s) => virtualSourcePath(map.sourceRoot, s) === source);
  const contenu = index >= 0 ? map.sourcesContent[index] : null;
  if (typeof contenu !== "string") return null;
  const lignes = contenu.split(/\r?\n/);
  if (line > lignes.length) return null;
  const start = Math.max(1, line - radius);
  const fin = Math.min(lignes.length, line + radius);
  return { source, line, start, lines: lignes.slice(start - 1, fin).map((l) => l.slice(0, 240)) };
}
