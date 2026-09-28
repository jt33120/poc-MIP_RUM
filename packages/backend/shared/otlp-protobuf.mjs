// Décodeur OTLP/HTTP PROTOBUF (traces et logs) -> la MÊME forme d'objet que
// l'OTLP/HTTP JSON, celle que `otlp.mjs` consomme déjà.
//
// POURQUOI. Les agents OpenTelemetry officiels (Java, .NET, Go, PHP, Ruby,
// Python, Node) exportent par défaut en `http/protobuf`. Jusqu'ici l'ingestion
// ne lisait que du JSON : il fallait un Collector entre l'agent et nous, rien
// que pour changer d'encodage. Décoder vers la forme JSON — plutôt que d'écrire
// un second parser — garde UN seul chemin en aval : mêmes gardes, même
// hachage d'identité, mêmes lignes.
//
// POURQUOI À LA MAIN, SANS DÉPENDANCE. OTLP n'emploie que quatre types de
// fil (varint, fixed64, length-delimited, fixed32) et une douzaine de messages
// stables : ~300 lignes suffisent. Une bibliothèque protobuf générique
// (protobufjs…) ajouterait une dépendance d'exécution aux DEUX ports — la
// console Vercel et le collector — et un code d'évaluation dynamique à auditer,
// pour un format que ce fichier décrit entièrement.
//
// CONVENTIONS DE SORTIE, calquées sur l'OTLP/JSON (spec OTLP, « JSON Protobuf
// Encoding ») :
//   - identifiants (`traceId`, `spanId`, `parentSpanId`) en hexadécimal
//     minuscule, et non en base64 comme le voudrait le mapping JSON générique ;
//   - horodatages `fixed64` en CHAÎNE d'entier de nanosecondes
//     (`startTimeUnixNano: "1727…"`) : un Number perdrait la précision ;
//   - enums (`kind`, `status.code`, `severityNumber`) en entiers ;
//   - `intValue` en Number s'il est sûr, sinon en chaîne décimale exacte
//     (`anyValue` fait `Number(v.intValue)` dans les deux cas) ;
//   - `bytesValue` en base64 (mapping JSON standard) ;
//   - un champ scalaire ABSENT du fil reste absent de l'objet (comme un
//     exportateur JSON qui omet les valeurs par défaut) ; les champs répétés
//     valent toujours un tableau, vide au besoin.
//
// DÉFENSIF. Le corps arrive d'Internet, d'un client qui n'a montré qu'une clé
// publique. Le décodeur est borné (profondeur d'imbrication, longueurs vérifiées
// contre les octets restants, varint de 10 octets au plus), ignore les champs
// inconnus comme le veut protobuf (un OTLP plus récent reste lisible), et ne
// lève qu'`ErreurProtobuf`, que les deux ports traduisent en 400.

/** Corps protobuf illisible : TOUJOURS un 400 (le rejouer ne changera rien). */
export class ErreurProtobuf extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurProtobuf";
  }
}

/**
 * Profondeur d'imbrication maximale des messages. Le squelette OTLP en compte
 * sept (requête → ressource → scope → span → événement → attribut → valeur) ;
 * le reste est la récursion `arrayValue`/`kvlistValue`. 32 laisse de la marge à
 * un attribut structuré réel, et coupe court à un corps qui imbriquerait des
 * milliers de niveaux pour épuiser la pile.
 */
export const PROFONDEUR_MAX_PROTOBUF = 32;

// Types de fil protobuf.
const VARINT = 0;
const FIXED64 = 1;
const LONGUEUR = 2;
const FIXED32 = 5;

// ───────────────────────────── Schéma OTLP ──────────────────────────────────
//
// Numéros de champ de opentelemetry-proto (v1 : common, resource, trace, logs,
// collector/*). Chaque entrée : [nom JSON, type, répété ?, sous-message].
// Les champs dépréciés et retirés (`instrumentation_library_spans` = 1000…)
// n'y figurent pas : ignorés comme tout champ inconnu.

const T = Object.freeze({
  chaine: "chaine",
  hex: "hex",
  octets64: "octets64",
  fixed64: "fixed64",
  double: "double",
  uint32: "uint32",
  enumeration: "enumeration",
  int64: "int64",
  booleen: "booleen",
  fixed32: "fixed32",
  message: "message",
});

/** @type {Record<string, Record<number, [string, string, boolean, string?]>>} */
const SCHEMA = {
  KeyValue: {
    1: ["key", T.chaine, false],
    2: ["value", T.message, false, "AnyValue"],
  },
  // `AnyValue` est un oneof : traité à part (`decoderAnyValue`), une seule clé.
  AnyValue: {
    1: ["stringValue", T.chaine, false],
    2: ["boolValue", T.booleen, false],
    3: ["intValue", T.int64, false],
    4: ["doubleValue", T.double, false],
    5: ["arrayValue", T.message, false, "ArrayValue"],
    6: ["kvlistValue", T.message, false, "KeyValueList"],
    7: ["bytesValue", T.octets64, false],
  },
  ArrayValue: {
    1: ["values", T.message, true, "AnyValue"],
  },
  KeyValueList: {
    1: ["values", T.message, true, "KeyValue"],
  },
  Resource: {
    1: ["attributes", T.message, true, "KeyValue"],
    2: ["droppedAttributesCount", T.uint32, false],
  },
  InstrumentationScope: {
    1: ["name", T.chaine, false],
    2: ["version", T.chaine, false],
    3: ["attributes", T.message, true, "KeyValue"],
    4: ["droppedAttributesCount", T.uint32, false],
  },
  // ── Traces ──
  ExportTraceServiceRequest: {
    1: ["resourceSpans", T.message, true, "ResourceSpans"],
  },
  ResourceSpans: {
    1: ["resource", T.message, false, "Resource"],
    2: ["scopeSpans", T.message, true, "ScopeSpans"],
    3: ["schemaUrl", T.chaine, false],
  },
  ScopeSpans: {
    1: ["scope", T.message, false, "InstrumentationScope"],
    2: ["spans", T.message, true, "Span"],
    3: ["schemaUrl", T.chaine, false],
  },
  Span: {
    1: ["traceId", T.hex, false],
    2: ["spanId", T.hex, false],
    3: ["traceState", T.chaine, false],
    4: ["parentSpanId", T.hex, false],
    5: ["name", T.chaine, false],
    6: ["kind", T.enumeration, false],
    7: ["startTimeUnixNano", T.fixed64, false],
    8: ["endTimeUnixNano", T.fixed64, false],
    9: ["attributes", T.message, true, "KeyValue"],
    10: ["droppedAttributesCount", T.uint32, false],
    11: ["events", T.message, true, "Event"],
    12: ["droppedEventsCount", T.uint32, false],
    13: ["links", T.message, true, "Link"],
    14: ["droppedLinksCount", T.uint32, false],
    15: ["status", T.message, false, "Status"],
    16: ["flags", T.fixed32, false],
  },
  Event: {
    1: ["timeUnixNano", T.fixed64, false],
    2: ["name", T.chaine, false],
    3: ["attributes", T.message, true, "KeyValue"],
    4: ["droppedAttributesCount", T.uint32, false],
  },
  Link: {
    1: ["traceId", T.hex, false],
    2: ["spanId", T.hex, false],
    3: ["traceState", T.chaine, false],
    4: ["attributes", T.message, true, "KeyValue"],
    5: ["droppedAttributesCount", T.uint32, false],
    6: ["flags", T.fixed32, false],
  },
  Status: {
    2: ["message", T.chaine, false],
    3: ["code", T.enumeration, false],
  },
  // ── Logs ──
  ExportLogsServiceRequest: {
    1: ["resourceLogs", T.message, true, "ResourceLogs"],
  },
  ResourceLogs: {
    1: ["resource", T.message, false, "Resource"],
    2: ["scopeLogs", T.message, true, "ScopeLogs"],
    3: ["schemaUrl", T.chaine, false],
  },
  ScopeLogs: {
    1: ["scope", T.message, false, "InstrumentationScope"],
    2: ["logRecords", T.message, true, "LogRecord"],
    3: ["schemaUrl", T.chaine, false],
  },
  LogRecord: {
    1: ["timeUnixNano", T.fixed64, false],
    11: ["observedTimeUnixNano", T.fixed64, false],
    2: ["severityNumber", T.enumeration, false],
    3: ["severityText", T.chaine, false],
    5: ["body", T.message, false, "AnyValue"],
    6: ["attributes", T.message, true, "KeyValue"],
    7: ["droppedAttributesCount", T.uint32, false],
    8: ["flags", T.fixed32, false],
    9: ["traceId", T.hex, false],
    10: ["spanId", T.hex, false],
    12: ["eventName", T.chaine, false],
  },
};

/** Champs répétés de chaque message, calculés une fois (pas à chaque message lu). */
const REPETES = Object.fromEntries(
  Object.entries(SCHEMA).map(([nom, champs]) => [nom, Object.values(champs).filter((c) => c[2]).map((c) => c[0])]),
);

/** Type de fil attendu pour chaque type de champ. */
const FIL = {
  [T.chaine]: LONGUEUR,
  [T.hex]: LONGUEUR,
  [T.octets64]: LONGUEUR,
  [T.message]: LONGUEUR,
  [T.fixed64]: FIXED64,
  [T.double]: FIXED64,
  [T.uint32]: VARINT,
  [T.enumeration]: VARINT,
  [T.int64]: VARINT,
  [T.booleen]: VARINT,
  [T.fixed32]: FIXED32,
};

// ───────────────────────────── Lecture du fil ───────────────────────────────

/**
 * Lecteur sur une tranche [pos, fin) d'un Buffer. Le varint est rendu en deux
 * moitiés de 32 bits (`lo`, `hi`) : un int64 ne tient pas dans un Number, et
 * passer par BigInt pour chaque étiquette coûterait cher sur 2 Mo de corps.
 */
class Lecteur {
  constructor(buf, pos, fin) {
    this.buf = buf;
    this.pos = pos;
    this.fin = fin;
    this.lo = 0;
    this.hi = 0;
  }

  octet() {
    if (this.pos >= this.fin) throw new ErreurProtobuf("corps protobuf tronqué");
    return this.buf[this.pos++];
  }

  /** Lit un varint dans `lo`/`hi`. 10 octets au plus (un uint64). */
  varint() {
    let lo = 0;
    let hi = 0;
    let b;
    for (let decalage = 0; decalage < 28; decalage += 7) {
      b = this.octet();
      lo |= (b & 0x7f) << decalage;
      if (b < 0x80) return this.poser(lo, 0);
    }
    // 5e octet : 4 bits pour `lo`, 3 pour `hi`.
    b = this.octet();
    lo |= (b & 0x0f) << 28;
    hi = (b & 0x7f) >>> 4;
    if (b < 0x80) return this.poser(lo, hi);
    for (let decalage = 3; decalage < 32; decalage += 7) {
      b = this.octet();
      hi |= (b & 0x7f) << decalage;
      if (b < 0x80) return this.poser(lo, hi);
    }
    throw new ErreurProtobuf("varint trop long");
  }

  poser(lo, hi) {
    this.lo = lo >>> 0;
    this.hi = hi >>> 0;
  }

  /** Longueur d'un champ length-delimited, vérifiée contre ce qui reste. */
  longueur() {
    this.varint();
    const n = this.lo;
    if (this.hi !== 0 || n > this.fin - this.pos) throw new ErreurProtobuf("longueur protobuf hors du corps");
    return n;
  }

  /** Saute un champ inconnu. Les groupes (3, 4 : proto2, jamais OTLP) sont refusés. */
  sauter(fil) {
    if (fil === VARINT) this.varint();
    else if (fil === FIXED64) this.avancer(8);
    else if (fil === LONGUEUR) this.avancer(this.longueur());
    else if (fil === FIXED32) this.avancer(4);
    else throw new ErreurProtobuf(`type de fil protobuf non pris en charge (${fil})`);
  }

  avancer(n) {
    if (n > this.fin - this.pos) throw new ErreurProtobuf("corps protobuf tronqué");
    this.pos += n;
  }
}

/** int64 signé (complément à deux sur 64 bits) : Number si sûr, sinon chaîne exacte. */
function int64(lo, hi) {
  if (hi === 0) return lo;
  const v = BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
}

/** Valeur d'un champ scalaire, le curseur posé sur sa donnée. */
function lireScalaire(l, type) {
  switch (type) {
    case T.chaine: {
      const n = l.longueur();
      // UTF-8 invalide → U+FFFD, exactement comme `toString("utf8")` du chemin JSON.
      const s = l.buf.toString("utf8", l.pos, l.pos + n);
      l.pos += n;
      return s;
    }
    case T.hex: {
      const n = l.longueur();
      const s = l.buf.toString("hex", l.pos, l.pos + n);
      l.pos += n;
      return s;
    }
    case T.octets64: {
      const n = l.longueur();
      const s = l.buf.toString("base64", l.pos, l.pos + n);
      l.pos += n;
      return s;
    }
    case T.fixed64: {
      l.avancer(8);
      return l.buf.readBigUInt64LE(l.pos - 8).toString();
    }
    case T.double: {
      l.avancer(8);
      return l.buf.readDoubleLE(l.pos - 8);
    }
    case T.fixed32: {
      l.avancer(4);
      return l.buf.readUInt32LE(l.pos - 4);
    }
    case T.uint32:
      l.varint();
      return l.lo;
    case T.enumeration:
      // int32 : un enum négatif arrive sur 10 octets, seuls les 32 bits bas comptent.
      l.varint();
      return l.lo | 0;
    case T.int64:
      l.varint();
      return int64(l.lo, l.hi);
    case T.booleen:
      l.varint();
      return (l.lo | l.hi) !== 0;
    default:
      throw new ErreurProtobuf(`type interne inconnu (${type})`);
  }
}

/**
 * Décode UN message `nom` sur [l.pos, fin). `profondeur` compte les messages
 * ouverts depuis la racine.
 */
function decoderMessage(l, fin, nom, profondeur) {
  if (profondeur > PROFONDEUR_MAX_PROTOBUF) throw new ErreurProtobuf("imbrication protobuf trop profonde");
  const schema = SCHEMA[nom];
  const estAnyValue = nom === "AnyValue";
  let sortie = {};
  for (const cle of REPETES[nom]) sortie[cle] = [];

  const finParent = l.fin;
  l.fin = fin;
  try {
    while (l.pos < fin) {
      l.varint();
      if (l.hi !== 0) throw new ErreurProtobuf("étiquette protobuf invalide");
      const numero = l.lo >>> 3;
      const fil = l.lo & 7;
      if (numero === 0) throw new ErreurProtobuf("numéro de champ protobuf nul");
      const champ = schema[numero];
      // Champ inconnu, ou type de fil qui ne correspond pas au schéma : ignoré,
      // comme le fait protobuf (un émetteur plus récent reste lisible).
      if (!champ || FIL[champ[1]] !== fil) {
        l.sauter(fil);
        continue;
      }
      const [cle, type, repete, sousMessage] = champ;
      let valeur;
      if (type === T.message) {
        const n = l.longueur();
        const finSous = l.pos + n;
        valeur = decoderMessage(l, finSous, sousMessage, profondeur + 1);
        l.pos = finSous;
      } else {
        valeur = lireScalaire(l, type);
      }
      if (estAnyValue) {
        // oneof : le dernier membre lu l'emporte, et lui seul reste.
        sortie = { [cle]: valeur };
      } else if (repete) {
        sortie[cle].push(valeur);
      } else if (type === T.message && sortie[cle] && typeof sortie[cle] === "object") {
        // Un message non répété vu deux fois se FUSIONNE (règle protobuf) : les
        // champs du second l'emportent, les tableaux s'ajoutent.
        sortie[cle] = fusionner(sortie[cle], valeur);
      } else {
        sortie[cle] = valeur;
      }
    }
    if (l.pos !== fin) throw new ErreurProtobuf("message protobuf déborde de sa longueur");
  } finally {
    l.fin = finParent;
  }
  return sortie;
}

function fusionner(a, b) {
  const sortie = { ...a };
  for (const [cle, v] of Object.entries(b)) {
    if (Array.isArray(v) && Array.isArray(sortie[cle])) sortie[cle] = [...sortie[cle], ...v];
    else sortie[cle] = v;
  }
  return sortie;
}

function decoderRacine(octets, nom) {
  if (!(octets instanceof Uint8Array)) throw new ErreurProtobuf("corps protobuf absent");
  const buf = Buffer.isBuffer(octets) ? octets : Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
  const l = new Lecteur(buf, 0, buf.length);
  return decoderMessage(l, buf.length, nom, 0);
}

/**
 * `ExportTraceServiceRequest` protobuf → `{ resourceSpans: [...] }` (forme OTLP/JSON).
 * Un corps vide est une requête valide sans span (`resourceSpans: []`).
 * @param {Uint8Array} octets
 * @throws {ErreurProtobuf}
 */
export function decoderTracesProtobuf(octets) {
  return decoderRacine(octets, "ExportTraceServiceRequest");
}

/**
 * `ExportLogsServiceRequest` protobuf → `{ resourceLogs: [...] }` (forme OTLP/JSON).
 * @param {Uint8Array} octets
 * @throws {ErreurProtobuf}
 */
export function decoderLogsProtobuf(octets) {
  return decoderRacine(octets, "ExportLogsServiceRequest");
}

// ───────────────────────────── Réponse ──────────────────────────────────────

/**
 * `google.rpc.Status` protobuf portant le seul `message` (champ 2). La spec
 * OTLP/HTTP veut ce message dans le corps de toute réponse 4xx/5xx à une
 * requête protobuf ; elle permet d'omettre `code`, que les clients ne lisent pas.
 * Un message vide donne un corps vide (valeurs par défaut omises).
 * @param {string} message
 * @returns {Buffer}
 */
export function encoderStatusProtobuf(message) {
  const texte = Buffer.from(String(message ?? ""), "utf8");
  if (!texte.length) return Buffer.alloc(0);
  const longueur = [];
  let n = texte.length;
  while (n >= 0x80) {
    longueur.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  longueur.push(n);
  return Buffer.concat([Buffer.from([0x12, ...longueur]), texte]);
}
