// Upload de source maps (P5.4) — UN contrat pour les deux ports d'entrée :
//
//   POST /api/sourcemaps   console (Vercel) : cookie admin OU jeton dédié ;
//   POST /v1/sourcemaps    backend direct (receiver.mjs, Railway) : jeton dédié SEUL.
//
// Ce module porte tout ce qui doit être identique des deux côtés : bornes,
// lecture du corps, validation, jetons, écriture. Un port qui validerait moins
// que l'autre deviendrait la porte d'entrée des maps refusées.
//
// L'ORDRE EST LA GARANTIE. Authentifier avant de lire le corps ; borner le corps
// en octets avant tout JSON.parse ; valider TOUTES les maps avant la première
// écriture ; écrire dans UNE transaction. Une liste dont la dernière map est
// invalide ne persiste donc rien, et un conflit sur une seule map annule la
// requête entière : jamais de succès partiel déguisé.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { boundedRelease } from "../shared/dimensions.mjs";
import {
  hasControlCharacters,
  SourceMapError,
  validateSourceMap,
} from "../shared/sourcemap.mjs";

const MIO = 1024 * 1024;

export const LIMITES_UPLOAD = Object.freeze({
  /** Corps complet accepté par le backend direct. */
  corpsDirect: 20 * MIO,
  /** Corps complet accepté par la console : sous le plafond publié de Vercel (4,5 Mo). */
  corpsConsole: 4 * MIO,
  /** Une map, en octets UTF-8. */
  map: 15 * MIO,
  /** Maps par requête. */
  maps: 200,
  /** Lot par défaut du CLI vers le port console. */
  lotConsole: 3 * MIO,
  /** Lecture du corps : au-delà, 408. */
  delaiCorpsMs: 60_000,
  /** Silence maximal entre deux morceaux du corps : au-delà, 408. */
  delaiInactiviteMs: 10_000,
  /** Uploads par jeton ou par admin, par minute et par instance. */
  parMinute: 60,
  /** Uploads simultanés d'un même émetteur, par instance. */
  simultanesParCle: 2,
  /** Uploads simultanés tous émetteurs confondus, par instance : borne la mémoire des corps lus. */
  simultanes: 6,
});

/** Durée de vie d'un jeton, en jours. */
export const EXPIRATION_JETON = Object.freeze({ min: 1, max: 90, defaut: 30 });

/** Le privilège d'un jeton d'upload de source maps. */
export const PRIVILEGE_JETON = "sourcemaps:write";

/**
 * Les privilèges qu'un jeton de CI peut porter — un par jeton (migration-v92) :
 * poser des source maps, ou un marqueur de déploiement (C11). La fuite de l'un
 * n'ouvre pas l'autre.
 */
export const PRIVILEGES_JETON = Object.freeze(["sourcemaps:write", "deploys:write"]);

const MESSAGE_SCHEMA_ABSENT =
  "schéma source maps non migré : migration-v71 requise avant tout upload";

/** Erreur attendue, traduite telle quelle en réponse HTTP par les deux ports. */
export class ErreurUpload extends Error {
  constructor(statut, message) {
    super(message);
    this.name = "ErreurUpload";
    this.statut = statut;
  }
}

/** Colonne ou table absente : le code est déployé avant migration-v71. */
function schemaAbsent(err) {
  return err?.code === "42703" || err?.code === "42P01";
}

const sha256 = (texte) => createHash("sha256").update(texte, "utf8").digest("hex");

/** Empreinte SHA-256 (hex) d'un contenu de map, sur ses octets UTF-8 — celle que calcule la base. */
export function empreinteContenu(contenu) {
  return sha256(contenu);
}

/**
 * Empreinte d'un manifeste de release : SHA-256 de la liste triée des couples
 * (fichier, checksum). Le CLI la calcule sur ce qu'il envoie, la console sur ce
 * que la base contient : deux valeurs égales disent que la release est complète.
 *
 * @param {Array<{ filename: string, checksum: string|null }>} entrees
 */
export function empreinteManifeste(entrees) {
  const triees = entrees
    .map((e) => [e.filename, e.checksum ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(JSON.stringify(triees));
}

// ─────────────────────────────── Jetons dédiés ───────────────────────────────
//
// Format : msu_<id 32 hex>_<secret 64 hex>. L'identifiant est public (il sert à
// retrouver la ligne sans comparer de secret dans un index) ; le secret, 256 bits
// aléatoires, n'est stocké que haché et comparé en temps constant.

const FORMAT_JETON = /^msu_([0-9a-f]{32})_([0-9a-f]{64})$/;

const enUuid = (hex) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** Nouveau jeton : le secret en clair n'existe que dans la valeur rendue ici. */
export function genererJetonUpload() {
  const id = randomUUID();
  const secret = randomBytes(32).toString("hex");
  return { id, jeton: `msu_${id.replaceAll("-", "")}_${secret}`, empreinte: sha256(secret) };
}

/** `Authorization: Bearer msu_…` → { id, secret }, ou null pour toute autre forme. */
export function lireJetonUpload(authorization) {
  const m = typeof authorization === "string" ? authorization.match(/^Bearer\s+(\S+)\s*$/i) : null;
  const j = m ? FORMAT_JETON.exec(m[1]) : null;
  return j ? { id: enUuid(j[1]), secret: j[2] } : null;
}

/**
 * Vérifie un jeton dédié. `null` pour un jeton absent, mal formé, inconnu,
 * révoqué ou expiré — sans dire lequel. Un jeton de lecture CONSOLE_API_TOKENS
 * n'a pas ce format : il est refusé ici, jamais promu.
 *
 * Le privilège est EXIGÉ tel quel : un jeton de source maps ne pose pas de
 * marqueur de déploiement, ni l'inverse.
 *
 * @param {{ query: Function }} db
 * @param {string|null} authorization
 * @param {"sourcemaps:write"|"deploys:write"} [privilege]
 * @returns {Promise<{ id: string, app_id: string } | null>}
 */
export async function verifierJetonUpload(db, authorization, privilege = PRIVILEGE_JETON) {
  const lu = lireJetonUpload(authorization);
  if (!lu) return null;
  let ligne;
  try {
    ({ rows: [ligne] } = await db.query(
      `select id::text as id, app_id, secret_hash, revoked_at is null and expires_at > now() as actif
         from sourcemap_upload_token where id = $1 and scope = $2`,
      [lu.id, privilege],
    ));
  } catch (err) {
    if (schemaAbsent(err)) throw new ErreurUpload(503, MESSAGE_SCHEMA_ABSENT);
    throw err;
  }
  // Comparaison toujours faite, même sans ligne : la durée ne dit pas si
  // l'identifiant existe.
  const attendu = Buffer.from(ligne?.secret_hash ?? "0".repeat(64), "utf8");
  const recu = Buffer.from(sha256(lu.secret), "utf8");
  const egal = attendu.length === recu.length && timingSafeEqual(attendu, recu);
  return ligne && egal && ligne.actif ? { id: ligne.id, app_id: ligne.app_id } : null;
}

/**
 * Limiteur par instance : uploads par minute et uploads simultanés pour une clé
 * (jeton ou admin), plus un plafond global de simultanéité. Le plafond par clé
 * empêche un émetteur lent d'occuper toutes les places ; le plafond global borne
 * la mémoire des corps en cours de lecture. Un refus porte le délai à annoncer.
 */
export function creerLimiteurUpload({
  parMinute = LIMITES_UPLOAD.parMinute,
  simultanesParCle = LIMITES_UPLOAD.simultanesParCle,
  simultanes = LIMITES_UPLOAD.simultanes,
  maintenant = () => Date.now(),
} = {}) {
  const coups = new Map();
  const enCoursParCle = new Map();
  let enCours = 0;
  return {
    /** @returns {{ refus: { message: string, retryAfter: number } } | { liberer: () => void }} */
    prendre(cle) {
      const t = maintenant();
      const recents = (coups.get(cle) ?? []).filter((x) => x > t - 60_000);
      if (recents.length) coups.set(cle, recents);
      else coups.delete(cle);
      if (recents.length >= parMinute) {
        return { refus: { message: "trop d'uploads de source maps pour cet émetteur : réessayer dans une minute", retryAfter: 60 } };
      }
      const siens = enCoursParCle.get(cle) ?? 0;
      if (siens >= simultanesParCle || enCours >= simultanes) {
        return { refus: { message: "trop d'uploads de source maps simultanés : réessayer dans quelques secondes", retryAfter: 5 } };
      }
      recents.push(t);
      coups.set(cle, recents);
      enCoursParCle.set(cle, siens + 1);
      enCours++;
      let libere = false;
      return {
        liberer: () => {
          if (libere) return;
          libere = true;
          enCours--;
          const restants = enCoursParCle.get(cle) - 1;
          if (restants > 0) enCoursParCle.set(cle, restants);
          else enCoursParCle.delete(cle);
        },
      };
    },
  };
}

// ──────────────────────────── Corps et contrat ───────────────────────────────

/**
 * Lit un corps (flux Node ou ReadableStream web) en bornant les octets, la durée
 * totale et le silence entre deux morceaux. Le dépassement est détecté au morceau
 * qui le provoque : rien n'est accumulé au-delà de `max`.
 *
 * Le flux n'est PAS détruit en cas de refus. Détruire la requête coupe la
 * connexion (mesuré : le client reçoit EPIPE, pas le 413) ; laissé tel quel, le
 * serveur HTTP jette le reste du corps après la réponse, sans le mémoriser, et
 * le client lit son 413 ou son 408 avec le message qui dit quoi faire.
 *
 * @param {AsyncIterable<Uint8Array|string>} flux
 * @param {{ max: number, delaiMs?: number, delaiInactiviteMs?: number }} opts
 */
export async function lireCorpsLimite(
  flux,
  { max, delaiMs = LIMITES_UPLOAD.delaiCorpsMs, delaiInactiviteMs = LIMITES_UPLOAD.delaiInactiviteMs },
) {
  const iterateur = flux[Symbol.asyncIterator]();
  const morceaux = [];
  let total = 0;
  const echeance = Date.now() + delaiMs;
  for (;;) {
    const restant = Math.min(echeance - Date.now(), delaiInactiviteMs);
    if (restant <= 0) throw new ErreurUpload(408, "corps de requête reçu trop lentement");
    let minuteur;
    const expiration = new Promise((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new ErreurUpload(408, "corps de requête reçu trop lentement")), restant);
    });
    let lu;
    try {
      lu = await Promise.race([iterateur.next(), expiration]);
    } finally {
      clearTimeout(minuteur);
    }
    if (lu.done) break;
    const morceau = typeof lu.value === "string"
      ? Buffer.from(lu.value, "utf8")
      : Buffer.from(lu.value.buffer, lu.value.byteOffset, lu.value.byteLength);
    total += morceau.length;
    if (total > max) {
      throw new ErreurUpload(413, `corps trop volumineux (limite ${Math.floor(max / MIO)} Mio)`);
    }
    morceaux.push(morceau);
  }
  return Buffer.concat(morceaux, total);
}

function texteRequis(valeur, champ, max) {
  const texte = typeof valeur === "string" ? valeur.trim() : "";
  if (!texte || texte.length > max || hasControlCharacters(texte)) {
    throw new ErreurUpload(400, `${champ} requis (texte de ${max} caractères au plus)`);
  }
  return texte;
}

/** Nom du fichier minifié tel qu'il apparaît dans les stacks, jamais le `.map`. */
function nomDeFichier(valeur, i) {
  const nom = typeof valeur === "string" ? valeur.trim() : "";
  if (
    !nom || nom.length > 512 || hasControlCharacters(nom) || nom.includes("\\") ||
    nom.split("/").some((segment) => segment === "..")
  ) {
    throw new ErreurUpload(400, `maps[${i}].filename invalide : nom du fichier minifié tel qu'il apparaît dans les stacks`);
  }
  if (nom.endsWith(".map")) {
    throw new ErreurUpload(400, `maps[${i}].filename (${nom}) : indiquer le bundle minifié (ex. main.abc123.js), pas le fichier .map`);
  }
  return nom;
}

const EXTERNE = /^(https?:|data:|\/\/[#@]\s*sourceMappingURL=)/i;

/** Contenu JSON d'une map : chaîne telle qu'envoyée, ou objet sérialisé. */
function parserContenu(valeur, filename) {
  const contenu = valeur !== null && typeof valeur === "object" && !Array.isArray(valeur)
    ? JSON.stringify(valeur)
    : valeur;
  if (typeof contenu !== "string" || !contenu.trim()) {
    throw new ErreurUpload(400, `contenu de source map absent (${filename})`);
  }
  const octets = Buffer.byteLength(contenu, "utf8");
  if (octets > LIMITES_UPLOAD.map) {
    throw new ErreurUpload(
      413,
      `source map trop volumineuse (${filename} : ${octets} octets, limite ${LIMITES_UPLOAD.map / MIO} Mio)`,
    );
  }
  const externe = new ErreurUpload(
    400,
    `map externe non prise en charge (${filename}) : envoyer le contenu JSON de la map, pas une URL ni un sourceMappingURL`,
  );
  let map;
  try {
    map = JSON.parse(contenu);
  } catch {
    if (EXTERNE.test(contenu.trimStart())) throw externe;
    throw new ErreurUpload(400, `source map invalide (${filename}) : JSON illisible`);
  }
  if (typeof map === "string" && EXTERNE.test(map.trim())) throw externe;
  try {
    validateSourceMap(map);
  } catch (err) {
    if (err instanceof SourceMapError) throw new ErreurUpload(400, `source map invalide (${filename}) : ${err.message}`);
    throw err;
  }
  return { content: contenu, octets, checksum: empreinteContenu(contenu) };
}

/**
 * Contrat d'upload, validé en entier : `{ appId, release, maps: [{ filename,
 * content }], replace? }`, ou la forme historique `{ appId, release, filename,
 * content }`. Lève `ErreurUpload` (400/413) à la première violation.
 *
 * @param {Buffer|string} corps corps déjà borné en octets
 * @returns {{ appId: string, release: string, remplacer: boolean,
 *   maps: Array<{ filename: string, content: string, octets: number, checksum: string }> }}
 */
export function lireRequeteUpload(corps) {
  let json;
  try {
    json = JSON.parse(typeof corps === "string" ? corps : corps.toString("utf8"));
  } catch {
    throw new ErreurUpload(400, "JSON invalide");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new ErreurUpload(400, "objet JSON attendu");
  const appId = texteRequis(json.appId, "appId", 200);
  // La règle de l'ingestion (P6.1) : une release qu'elle ne stockerait pas ne
  // serait jamais associée à ces maps. Mieux vaut un 400 en CI qu'un succès inutile.
  const release = boundedRelease(json.release);
  if (!release) {
    throw new ErreurUpload(400, "release requise (1 à 120 caractères, sans caractère de contrôle ni de format)");
  }
  if (json.replace !== undefined && typeof json.replace !== "boolean") {
    throw new ErreurUpload(400, "replace : booléen attendu");
  }
  const brutes = Array.isArray(json.maps)
    ? json.maps
    : json.filename !== undefined
      ? [{ filename: json.filename, content: json.content }]
      : [];
  if (!brutes.length) throw new ErreurUpload(400, "au moins une map { filename, content } requise");
  if (brutes.length > LIMITES_UPLOAD.maps) {
    throw new ErreurUpload(413, `au plus ${LIMITES_UPLOAD.maps} maps par requête : découper en lots`);
  }
  const vus = new Set();
  const maps = brutes.map((brute, i) => {
    const filename = nomDeFichier(brute?.filename, i);
    if (vus.has(filename)) throw new ErreurUpload(400, `fichier présent deux fois dans la requête : ${filename}`);
    vus.add(filename);
    return { filename, ...parserContenu(brute?.content, filename) };
  });
  return { appId, release, remplacer: json.replace === true, maps };
}

// ─────────────────────────────────── Écriture ────────────────────────────────

/**
 * Écrit les maps d'une requête déjà validée, dans UNE transaction.
 *
 * - contenu identique déjà présent : `unchanged`, rien n'est réécrit ;
 * - contenu différent sous le même (app, release, fichier) : `409` pour TOUTE la
 *   requête, sauf remplacement explicite, réservé à l'admin et audité ;
 * - jeton dédié : revérifié dans la transaction (révocation concurrente) et
 *   `last_used_at` mis à jour.
 *
 * L'empreinte et la taille stockées sont calculées par la base (déclencheur de
 * migration-v71) : aucun écrivain ne peut les désaccorder du contenu.
 *
 * @param {import("pg").Pool} pool
 * @param {{ appId: string, release: string, maps: Array<{ filename: string, content: string, checksum: string }>,
 *   remplacer?: boolean, par: string, jetonId?: string|null }} demande
 * @returns {Promise<{ statut: number, corps: object }>}
 */
export async function enregistrerMaps(pool, { appId, release, maps, remplacer = false, par, jetonId = null }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (jetonId) {
      const { rowCount } = await client.query(
        `update sourcemap_upload_token set last_used_at = now()
          where id = $1 and app_id = $2 and revoked_at is null and expires_at > now()`,
        [jetonId, appId],
      );
      if (!rowCount) {
        await client.query("rollback");
        return { statut: 401, corps: { error: "jeton d'upload de source maps invalide, expiré ou révoqué" } };
      }
    }
    const { rowCount: appConnue } = await client.query("select 1 from app_registry where app_id = $1", [appId]);
    if (!appConnue) {
      await client.query("rollback");
      return { statut: 404, corps: { error: `application inconnue : ${appId}` } };
    }

    const resultats = [];
    const conflits = [];
    // Ordre fixe : deux requêtes concurrentes verrouillent les mêmes lignes dans
    // le même ordre, sans interblocage.
    const ordonnees = [...maps].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
    for (const map of ordonnees) {
      const cle = [appId, release, map.filename];
      const cree = await client.query(
        `insert into sourcemap (app_id, release, filename, content, uploaded_by)
         values ($1, $2, $3, $4, $5)
         on conflict (app_id, release, filename) do nothing
         returning checksum, size_bytes`,
        [...cle, map.content, par],
      );
      if (cree.rowCount) {
        resultats.push({ filename: map.filename, status: "created", ...cree.rows[0] });
        continue;
      }
      const { rows: [existante] } = await client.query(
        `select checksum, size_bytes from sourcemap
          where app_id = $1 and release = $2 and filename = $3 for update`,
        cle,
      );
      if (existante.checksum === map.checksum) {
        resultats.push({ filename: map.filename, status: "unchanged", ...existante });
        continue;
      }
      if (!remplacer) {
        conflits.push({ filename: map.filename, existing_checksum: existante.checksum, received_checksum: map.checksum });
        continue;
      }
      const { rows: [remplacee] } = await client.query(
        `update sourcemap set content = $4, uploaded_at = now(), uploaded_by = $5
          where app_id = $1 and release = $2 and filename = $3
          returning checksum, size_bytes`,
        [...cle, map.content, par],
      );
      await client.query(
        "insert into audit_log (user_email, action, detail) values ($1, 'sourcemap_replace', $2)",
        [par, JSON.stringify({ app_id: appId, release, filename: map.filename, avant: existante.checksum, apres: remplacee.checksum })],
      );
      resultats.push({ filename: map.filename, status: "replaced", ...remplacee });
    }

    if (conflits.length) {
      await client.query("rollback");
      return {
        statut: 409,
        corps: {
          error: "contenu différent déjà enregistré pour cette release : rien n'a été écrit ; remplacement explicite réservé à un admin",
          conflicts: conflits,
        },
      };
    }
    const { rows: manifeste } = await client.query(
      "select filename, checksum from sourcemap where app_id = $1 and release = $2",
      [appId, release],
    );
    await client.query("commit");
    const compte = (statut) => resultats.filter((r) => r.status === statut).length;
    return {
      statut: 200,
      corps: {
        uploaded: resultats.length,
        created: compte("created"),
        unchanged: compte("unchanged"),
        replaced: compte("replaced"),
        maps: resultats,
        release: { app_id: appId, release, files: manifeste.length, fingerprint: empreinteManifeste(manifeste) },
      },
    };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    if (schemaAbsent(err)) throw new ErreurUpload(503, MESSAGE_SCHEMA_ABSENT);
    throw err;
  } finally {
    client.release();
  }
}
