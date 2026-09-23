// Chargement de la base DB-IP Lite — la seule partie du GeoIP qui touche un
// disque (P8.7).
//
// ═════════════════════ TROIS RÈGLES, ET LEUR RAISON ══════════════════════════
//
//   1. GEOIP EST OPTIONNEL. Base absente, illisible, périmée, variable mal
//      déclarée : le chargement échoue, GeoIP reste éteint, et l'ingestion se
//      comporte EXACTEMENT comme avant ce lot — pays estimé d'après le fuseau.
//      Aucun de ces cas ne peut faire échouer un lot de mesures, ni retarder une
//      réponse : c'est la condition même pour que P6 continue de fonctionner
//      sans fournisseur.
//
//   2. LE CHARGEMENT NE BLOQUE PAS LE DÉMARRAGE. 717 000 plages représentent une
//      trentaine de méga-octets de texte à lire et à indexer : une seconde ou
//      deux. Le serveur écoute pendant ce temps, et les lots reçus avant la fin
//      du chargement sont traités sans GeoIP. Une mesure arrivée trop tôt garde
//      son pays de fuseau ; elle n'est jamais mise en attente.
//
//   3. LA BASE N'EST CHARGÉE QU'UNE FOIS. Elle vit en mémoire du processus,
//      partagée par toutes les requêtes. Elle n'est jamais rechargée à chaud :
//      déposer une nouvelle livraison est un redéploiement, ce qui rend la
//      version qui a servi à écrire une ligne traçable au déploiement près.
//
// ═══════════════════════ PÉREMPTION : POURQUOI UN REFUS ══════════════════════
//
// DB-IP publie tous les mois. Les plages se réattribuent d'un opérateur à
// l'autre, d'un pays à l'autre : une base d'il y a deux ans ne se trompe pas
// « un peu », elle affirme avec la même assurance un pays qui n'est plus le bon.
// Passé `GEOIP_MAX_AGE_DAYS` (180 jours par défaut, soit six livraisons
// manquées), la base est REFUSÉE — pas dégradée, pas signalée puis utilisée.
// Un pays inconnu est une information honnête ; un pays périmé n'en est pas une.
//
// L'âge se lit dans le NOM du fichier, jamais dans sa date de modification :
// une image Docker remet les dates à la construction.
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ageEnJours, chargerBase, paysDe, versionDepuisNom } from "../shared/geoip.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Dossier livré avec le code ; le fichier de données, lui, est déposé par l'exploitation. */
export const DOSSIER_DONNEES = path.join(ICI, "..", "data");

/** Âge maximal accepté, en jours. Six livraisons DB-IP manquées. */
export const AGE_MAX_JOURS_DEFAUT = 180;

/** Plafond de taille du fichier compressé : la livraison réelle pèse 4,5 Mio. */
export const MAX_OCTETS = 64 * 1024 * 1024;

/** `dbip-country-lite-2026-09.csv.gz` et rien d'autre. */
const NOM_ATTENDU = /^dbip-country-lite-\d{4}-\d{2}\.csv(\.gz)?$/;

/**
 * Chemin de la base, dans l'ordre de priorité :
 *   1. `GEOIP_DB_PATH` — chemin explicite (volume monté, base d'essai) ;
 *   2. la livraison la plus récente déposée dans `packages/backend/data/`.
 *
 * Le nom PORTE la version, et c'est volontaire : un fichier nommé
 * `dbip-country-lite.csv.gz` serait intraçable — on ne saurait ni ce qu'il vaut,
 * ni s'il est périmé, et la colonne de provenance mentirait par omission. C'est
 * aussi ce qui permet de déposer la base sans toucher à une variable : le
 * dossier est lu, la plus récente gagne.
 */
export async function cheminBase(env = process.env, dossier = DOSSIER_DONNEES) {
  const explicite = env.GEOIP_DB_PATH?.trim();
  if (explicite) return explicite;
  let noms;
  try {
    noms = await readdir(dossier);
  } catch {
    return null;
  }
  const livraisons = noms.filter((n) => NOM_ATTENDU.test(n)).sort();
  return livraisons.length ? path.join(dossier, livraisons[livraisons.length - 1]) : null;
}

/**
 * Charge la base et rend un résolveur, ou explique pourquoi il n'y en a pas.
 *
 * NE LÈVE JAMAIS.
 *
 * @returns {Promise<{ok:true, version:string, stats:object, pays:(ip:string)=>string|null}
 *                 | {ok:false, raison:string, detail?:object}>}
 */
export async function chargerGeoip({ chemin, maintenant = Date.now(), ageMaxJours = AGE_MAX_JOURS_DEFAUT } = {}) {
  if (!chemin) return { ok: false, raison: "geoip_db_absente" };

  const v = versionDepuisNom(chemin);
  if (!v) return { ok: false, raison: "geoip_db_nom_invalide", detail: { attendu: "dbip-country-lite-AAAA-MM.csv[.gz]" } };

  const age = ageEnJours(v, maintenant);
  if (age !== null && age > ageMaxJours) {
    return { ok: false, raison: "geoip_db_perimee", detail: { version: v.version, age_jours: age, max: ageMaxJours } };
  }
  // Une base datée du futur n'est pas plus crédible qu'une base périmée : c'est
  // une horloge fausse ou un nom bricolé. Tolérance d'un mois, le temps qu'une
  // livraison du mois suivant soit déposée en avance.
  if (age !== null && age < -31) {
    return { ok: false, raison: "geoip_db_datee_futur", detail: { version: v.version, age_jours: age } };
  }

  let brut;
  try {
    brut = await readFile(chemin);
  } catch (err) {
    return { ok: false, raison: "geoip_db_illisible", detail: { code: err?.code ?? "ENOENT" } };
  }
  if (brut.length > MAX_OCTETS) {
    return { ok: false, raison: "geoip_db_trop_grande", detail: { octets: brut.length, max: MAX_OCTETS } };
  }

  let csv;
  try {
    csv = chemin.endsWith(".gz") ? gunzipSync(brut).toString("utf8") : brut.toString("utf8");
  } catch {
    return { ok: false, raison: "geoip_db_decompression" };
  }

  const charge = chargerBase(csv, { version: v.version });
  if (!charge.ok) return charge;

  const base = charge.base;
  return {
    ok: true,
    version: base.version,
    stats: { ...base.stats, age_jours: age },
    pays: (ip) => paysDe(base, ip),
  };
}

/**
 * Le résolveur du processus. Une seule base, chargée une seule fois, jamais
 * rechargée à chaud.
 *
 * `resoudre()` rend `null` tant que le chargement n'est pas fini, et pour
 * toujours s'il a échoué : l'appelant n'a donc qu'un cas à traiter — « pas de
 * pays », qui est aussi celui d'une IP privée ou d'une plage non attribuée.
 */
export function creerGeoip({ env = process.env, log, maintenant = () => Date.now(), dossier = DOSSIER_DONNEES } = {}) {
  const ageMaxDeclare = Number(env.GEOIP_MAX_AGE_DAYS ?? AGE_MAX_JOURS_DEFAUT);
  const ageMaxJours = Number.isFinite(ageMaxDeclare) && ageMaxDeclare > 0 ? ageMaxDeclare : AGE_MAX_JOURS_DEFAUT;
  let base = null;
  let etat = "chargement";
  let raison = null;
  let chemin = null;

  const pret = (async () => {
    chemin = await cheminBase(env, dossier);
    if (!chemin) {
      etat = "eteint";
      raison = "geoip_db_absente";
      log?.info?.("geoip éteint", { raison: "aucune base déposée" });
      return;
    }
    const r = await chargerGeoip({ chemin, maintenant: maintenant(), ageMaxJours });
    if (r.ok) {
      base = r;
      etat = "actif";
      log?.info?.("geoip chargé", { version: r.version, ...r.stats });
    } else {
      etat = "eteint";
      raison = r.raison;
      // LE CHEMIN N'EST PAS JOURNALISÉ AVEC L'ERREUR au-delà de son nom de
      // fichier : un chemin absolu de volume n'apprend rien à l'exploitant qui
      // ne connaisse déjà sa configuration.
      log?.warn?.("geoip indisponible", { raison: r.raison, fichier: path.basename(chemin), ...(r.detail ?? {}) });
    }
  })().catch((err) => {
    etat = "eteint";
    raison = "geoip_db_exception";
    log?.warn?.("geoip indisponible", { raison: "exception", err: String(err?.message ?? err) });
  });

  return {
    /** Promesse de fin de chargement — pour les tests et pour /health, jamais pour l'ingestion. */
    pret,
    /** État lisible sur /health : `actif`, `chargement`, `eteint`. */
    etat: () => etat,
    version: () => base?.version ?? null,
    raison: () => raison,
    stats: () => base?.stats ?? null,
    /**
     * Pays d'une adresse, ou `null`. Ne lève jamais, ne journalise jamais
     * l'adresse, ne la retient nulle part.
     */
    resoudre: (ip) => {
      if (!base || !ip) return null;
      const code = base.pays(ip);
      return code ? { country: code, version: base.version } : null;
    },
  };
}
