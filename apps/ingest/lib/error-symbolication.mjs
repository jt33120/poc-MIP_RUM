// Symbolication des erreurs à partir des source maps en base (P5.4).
//
// Utilisée à l'ingestion (writeRows, avant la transaction) et à la lecture par
// la console, pour qu'une map mise en ligne APRÈS l'erreur améliore quand même
// l'affichage. Elle ne touche jamais `fingerprint` : l'identité d'un groupe ne
// dépend pas du moment où la map est arrivée.
//
// CE QUE CE MODULE GARANTIT À L'INGESTION. Un fichier hostile ou démesuré ne
// bloque pas un lot : la mémoire retenue est bornée (32 consommateurs, 64 Mio
// d'index calculés AVANT décodage), le travail par lot aussi (octets parsés,
// frames, durée). Ce qui dépasse le budget reste `pending` et sera tenté à la
// lecture ; une map inutilisable donne `failed` avec un diagnostic journalisé
// une fois par version de la map. Dans tous les cas la stack brute scrubbed est
// écrite telle quelle — la symbolication ne peut qu'ajouter une colonne.
//
// Aucune lecture réseau : les maps viennent de la table `sourcemap`, et le
// moteur ne suit ni `sourceRoot` ni URL (voir _shared/sourcemap.mjs).
import { createLogger } from "../supabase/functions/_shared/log.mjs";
import { scrubText } from "../supabase/functions/_shared/scrub.mjs";
import {
  bundleName,
  consumerFootprint,
  createConsumer,
  parseStackLine,
  symbolicateStackWith,
} from "../supabase/functions/_shared/sourcemap.mjs";

const MIO = 1024 * 1024;

/** Bornes par défaut, à ajuster sur mesure (voir docs/SOURCEMAPS.md). */
export const LIMITES_SYMBOLICATION = Object.freeze({
  /** Consommateurs gardés en cache (LRU). */
  entrees: 32,
  /** Mémoire retenue par le cache, mesurée par `consumerFootprint`. */
  octetsCache: 64 * MIO,
  /** Au-delà, une map n'est pas indexée : `failed`. */
  octetsParMap: 32 * MIO,
  /** Contenu JSON parsé par lot ; la première map d'un lot passe toujours. */
  octetsLusParLot: 8 * MIO,
  framesParErreur: 50,
  framesParLot: 2000,
  /** Fichiers distincts recherchés par lot (nom de bundle et URL complète). */
  fichiersParLot: 64,
  msParLot: 1000,
  /** Présence, absence et échec d'une map sont revérifiés après ce délai. */
  ttlMs: 60_000,
  /** Absences et échecs mémorisés, au plus. */
  negatifs: 4096,
  /** Longueur maximale de la stack symboliquée écrite (contrainte de migration-v71). */
  longueurStack: 8000,
});

const cle = (app, release, fichier) => `${app}\u0000${release}\u0000${fichier}`;

/** Coupe à la dernière fin de ligne sous la borne : jamais une frame à moitié. */
function borner(stack, max) {
  if (stack.length <= max) return stack;
  const coupe = stack.lastIndexOf("\n", max);
  return stack.slice(0, coupe > 0 ? coupe : max);
}

/**
 * @param {{ limites?: Partial<typeof LIMITES_SYMBOLICATION>, maintenant?: () => number,
 *   log?: { warn?: Function } }} [options]
 */
export function creerSymbolicateur(options = {}) {
  const limites = { ...LIMITES_SYMBOLICATION, ...options.limites };
  const maintenant = options.maintenant ?? (() => Date.now());
  const log = options.log ?? null;
  /** clé → { version, consommateur, octets, verifieA } ; l'ordre d'insertion sert de LRU. */
  const cache = new Map();
  let octetsCache = 0;
  /** clé → { version, etat: "absente"|"echec", raison, verifieA } */
  const negatifs = new Map();

  function retirer(k) {
    const entree = cache.get(k);
    if (!entree) return;
    cache.delete(k);
    octetsCache -= entree.octets;
  }

  function memoriser(k, entree) {
    retirer(k);
    negatifs.delete(k);
    cache.set(k, entree);
    octetsCache += entree.octets;
    for (const [ancienne] of cache) {
      if (cache.size <= limites.entrees && octetsCache <= limites.octetsCache) break;
      retirer(ancienne);
    }
  }

  function noter(k, negatif) {
    retirer(k);
    negatifs.delete(k);
    negatifs.set(k, negatif);
    if (negatifs.size > limites.negatifs) negatifs.delete(negatifs.keys().next().value);
  }

  /**
   * Résultat par erreur, aligné sur `erreurs` : `null` si la ligne n'a aucune
   * frame JavaScript (rien à symboliquer), sinon
   * `{ status, stack, raison, positions }`.
   *
   * @param {{ query: Function }} db pool ou client pg — lectures seules, hors transaction
   * @param {Array<{ app_id?: string, release?: string|null, stack?: string|null }>} erreurs
   * @param {{ checksum?: boolean }} [opts] `checksum: false` sur un schéma antérieur à v71
   */
  async function symboliquerLot(db, erreurs, { checksum = true } = {}) {
    const debut = maintenant();
    const resultats = erreurs.map(() => null);
    const candidates = [];
    erreurs.forEach((erreur, i) => {
      if (!erreur?.stack) return;
      const fichiers = [];
      for (const ligne of String(erreur.stack).split("\n")) {
        if (fichiers.length >= limites.framesParErreur) break;
        const frame = parseStackLine(ligne);
        if (frame) fichiers.push(frame.file);
      }
      if (!fichiers.length) return;
      if (!erreur.app_id || !erreur.release) {
        resultats[i] = { status: "unavailable", stack: null, raison: "release absente", positions: [] };
        return;
      }
      candidates.push({ i, app: erreur.app_id, release: erreur.release, fichiers });
    });
    if (!candidates.length) return resultats;

    // Noms recherchés par (app, release) : nom de bundle, puis URL complète.
    const groupes = new Map();
    let fichiersDemandes = 0;
    for (const c of candidates) {
      const g = `${c.app}\u0000${c.release}`;
      if (!groupes.has(g)) groupes.set(g, { app: c.app, release: c.release, noms: new Set() });
      const noms = groupes.get(g).noms;
      for (const fichier of c.fichiers) {
        for (const nom of [bundleName(fichier), fichier]) {
          if (noms.has(nom) || fichiersDemandes >= limites.fichiersParLot) continue;
          noms.add(nom);
          fichiersDemandes++;
        }
      }
    }

    /** Consommateurs utilisables par CE lot, indépendamment des évictions du cache. */
    const utilisables = new Map();
    /** Clés présentes en base mais non chargées faute de budget. */
    const differees = new Set();
    try {
      const version = checksum ? "coalesce(checksum, extract(epoch from created_at)::text)" : "extract(epoch from created_at)::text";
      let octetsLus = 0;
      for (const { app, release, noms } of groupes.values()) {
        const t = maintenant();
        const aVerifier = [...noms].filter((nom) => {
          const k = cle(app, release, nom);
          const entree = cache.get(k) ?? negatifs.get(k);
          if (!entree || t - entree.verifieA >= limites.ttlMs) return true;
          if (cache.has(k)) {
            // Accès récent : l'entrée repasse en fin d'ordre LRU.
            cache.delete(k);
            cache.set(k, entree);
            utilisables.set(k, entree.consommateur);
          }
          return false;
        });
        if (!aVerifier.length) continue;

        const { rows } = await db.query(
          `select filename, ${version} as version, size_bytes
             from sourcemap where app_id = $1 and release = $2 and filename = any($3::text[])`,
          [app, release, aVerifier],
        );
        const presentes = new Map(rows.map((r) => [r.filename, r]));
        const aCharger = [];
        for (const nom of aVerifier) {
          const k = cle(app, release, nom);
          const ligne = presentes.get(nom);
          if (!ligne) {
            noter(k, { version: null, etat: "absente", raison: null, verifieA: t });
            continue;
          }
          const connue = cache.get(k);
          if (connue && connue.version === ligne.version) {
            connue.verifieA = t;
            memoriser(k, connue);
            utilisables.set(k, connue.consommateur);
            continue;
          }
          const echec = negatifs.get(k);
          if (echec?.etat === "echec" && echec.version === ligne.version) {
            echec.verifieA = t;
            continue;
          }
          const tropTard = maintenant() - debut > limites.msParLot;
          const horsBudget = octetsLus > 0 && octetsLus + Number(ligne.size_bytes) > limites.octetsLusParLot;
          if (tropTard || horsBudget) {
            differees.add(k);
            continue;
          }
          octetsLus += Number(ligne.size_bytes);
          aCharger.push({ nom, k, version: ligne.version });
        }
        if (!aCharger.length) continue;

        const contenus = await db.query(
          "select filename, content from sourcemap where app_id = $1 and release = $2 and filename = any($3::text[])",
          [app, release, aCharger.map((a) => a.nom)],
        );
        const parNom = new Map(contenus.rows.map((r) => [r.filename, r.content]));
        for (const { nom, k, version: v } of aCharger) {
          const contenu = parNom.get(nom);
          if (typeof contenu !== "string") {
            noter(k, { version: null, etat: "absente", raison: null, verifieA: t });
            continue;
          }
          let raison = null;
          try {
            const map = JSON.parse(contenu);
            const octets = consumerFootprint(map);
            if (octets > limites.octetsParMap) {
              raison = `map trop lourde à indexer (${Math.ceil(octets / MIO)} Mio, limite ${Math.floor(limites.octetsParMap / MIO)} Mio)`;
            } else {
              const entree = { version: v, consommateur: createConsumer(map), octets, verifieA: t };
              memoriser(k, entree);
              utilisables.set(k, entree.consommateur);
            }
          } catch (err) {
            raison = err instanceof SyntaxError ? "JSON illisible" : String(err?.message ?? err);
          }
          if (raison) {
            noter(k, { version: v, etat: "echec", raison, verifieA: t });
            log?.warn?.("symbolication: source map inutilisable", { app_id: app, release, filename: nom, raison });
          }
        }
      }
    } catch (err) {
      // Une lecture de maps qui échoue ne doit pas faire perdre le lot : les
      // erreurs sont écrites brutes, `pending`, et la lecture retentera.
      log?.warn?.("symbolication: lecture des source maps impossible", { err: String(err?.message ?? err) });
      for (const c of candidates) {
        resultats[c.i] = { status: "pending", stack: null, raison: "lecture des source maps impossible", positions: [] };
      }
      return resultats;
    }

    let framesLot = 0;
    for (const c of candidates) {
      if (framesLot >= limites.framesParLot || maintenant() - debut > limites.msParLot) {
        resultats[c.i] = { status: "pending", stack: null, raison: "budget de symbolication du lot épuisé", positions: [] };
        continue;
      }
      let echec = null;
      let differee = false;
      let presente = false;
      const consumerFor = (fichier) => {
        for (const nom of [bundleName(fichier), fichier]) {
          const k = cle(c.app, c.release, nom);
          const consommateur = utilisables.get(k);
          if (consommateur) {
            presente = true;
            return consommateur;
          }
          const negatif = negatifs.get(k);
          if (negatif?.etat === "echec") echec ??= negatif.raison;
          if (differees.has(k)) differee = true;
        }
        return null;
      };
      const r = symbolicateStackWith(erreurs[c.i].stack, consumerFor, { maxFrames: limites.framesParErreur });
      framesLot += r.frames;
      if (r.resolved > 0) {
        resultats[c.i] = {
          status: "resolved",
          stack: borner(scrubText(r.stack) ?? "", limites.longueurStack),
          raison: null,
          positions: r.positions,
        };
      } else if (differee) {
        resultats[c.i] = { status: "pending", stack: null, raison: "budget de symbolication du lot épuisé", positions: [] };
      } else if (echec) {
        resultats[c.i] = { status: "failed", stack: null, raison: echec, positions: [] };
      } else {
        const raison = presente
          ? "positions absentes des source maps de cette release"
          : `aucune source map pour la release ${c.release}`;
        resultats[c.i] = { status: "unavailable", stack: null, raison, positions: [] };
      }
    }
    return resultats;
  }

  return {
    symboliquerLot,
    /** Observabilité et tests : ce que le cache retient. */
    etat: () => ({ entrees: cache.size, octets: octetsCache, negatifs: negatifs.size }),
  };
}

/** Instance du processus, partagée par tous les lots d'ingestion. */
export const symbolicateurIngestion = creerSymbolicateur({ log: createLogger("symbolication") });
