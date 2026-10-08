// La collecte en UN aller-retour SQL (migration-v109) — le côté JavaScript.
//
// POURQUOI. Le banc du 24/09/2026 (docs/operations/banc-collecteur-2026-09-24.md)
// compte 18 allers-retours SQL par lot de traces, dont 15 SOUS le verrou
// d'application (v81). À ~10 ms l'aller-retour, le verrou est tenu ≈ 150 ms par
// lot, et une application plafonne à ≈ 0,58 lot/s pour tenir le critère de P2.
// Ici, le lot part en UNE requête, `select mip_ingerer_lot_v2(…)` (v111), hors
// transaction explicite : la fonction prend le verrou, lit les barrières, écrit,
// et le COMMIT implicite suit sans attente réseau. Plus aucun aller-retour sous
// le verrou.
//
// LA MÊME SÉMANTIQUE, PAR CONSTRUCTION. Chaque ligne subit ICI les mêmes
// transformations que dans `writeRowsWithClient` (`context` sérialisé,
// `started_at`, `page_count`…), puis `prepareValue` du pilote `pg` : la fonction
// qui transformait chaque paramètre en texte. La fonction SQL relit ce texte par
// `->>` et le convertit par la fonction d'entrée du type de la colonne — ce que
// faisait le paramètre lié. Ce qui dépend du TYPE JavaScript (une chaîne non vide
// pour les barrières, la clé de consolidation d'un vital, sa valeur numérique, la
// session revendiquée d'une exception) est calculé ici et voyage dans des champs
// `__x`, qui ne sont aucune colonne.
//
// LE DRAPEAU. `platform_flag.ingest_un_aller_retour_pct` (0 à 100) dit quelle
// part des lots prend ce chemin. ABSENT, ILLISIBLE OU HORS BORNES : 0 — le chemin
// historique, éprouvé. Relu au plus toutes les 30 s par processus, à l'arrivée
// d'un lot seulement (aucune boucle qui réveille la base).
//
// LES REPLIS VERS LE CHEMIN HISTORIQUE, toujours AVANT toute écriture :
//   · fonction absente (migration non appliquée, `42883`) ou non exécutable
//     (`42501`) : repli, et ce processus n'essaie plus pendant 60 s ;
//   · `MIP02` : une application du lot a le regroupement v2 ACTIF (issues,
//     alias, régression : non portés en SQL), ou sa configuration a changé depuis
//     sa lecture ;
//   · client fourni (le drain de la file différée tient déjà sa transaction).
import pgUtils from "pg/lib/utils.js";
import { SQL_CONFIG_REGROUPEMENT, lignesEnOmbre } from "./error-grouping.mjs";
import { isNativeSpanId } from "../shared/otlp.mjs";
import {
  ErreurEcheance,
  ErreurPorteeApp,
  ErreurVerrouIngestion,
  GRACE_COMMIT_MS,
  STRATEGIE_VERROU,
  appsDuLot,
  sousEcheance,
} from "./privacy-barriere.mjs";

/** La clé du drapeau, dans `platform_flag` (migration-v109). */
export const DRAPEAU_UN_AR = "ingest_un_aller_retour_pct";

/** Les deux chemins d'écriture. */
export const CHEMINS = Object.freeze({ historique: "historique", unAR: "un_ar" });

const TTL_DRAPEAU_MS = 30_000;
const TTL_ABSENCE_MS = 60_000;
const TTL_CONFIG_MS = 30_000;

/** Par pool : `{ at, pct }` du drapeau, `absentJusqua` de la fonction, config de regroupement. */
const etats = new WeakMap();
const etatDe = (pool) => {
  let e = etats.get(pool);
  if (!e) etats.set(pool, (e = { drapeau: null, absentJusqua: 0, v2AbsenteJusqua: 0, config: new Map() }));
  return e;
};

/** Réinitialise les caches (tests). */
export function _resetUnAR(pool) {
  if (pool) etats.delete(pool);
}

/** Valeur du drapeau → pourcentage ; tout ce qui n'est pas un entier de 0 à 100 vaut 0. */
export function lirePourcentage(valeur) {
  return typeof valeur === "string" && /^(100|[1-9]?[0-9])$/.test(valeur) ? Number(valeur) : 0;
}

/**
 * Le chemin de CE lot. `force` (tests, banc) l'emporte ; sinon, tirage contre le
 * drapeau. Une lecture en échec vaut 0 pendant 30 s : jamais d'exception ici.
 */
export async function choisirChemin(pool, { force = null, echeance = null, tirage = Math.random } = {}) {
  if (force === CHEMINS.historique || force === CHEMINS.unAR) return force;
  const etat = etatDe(pool);
  if (Date.now() < etat.absentJusqua) return CHEMINS.historique;
  if (!etat.drapeau || Date.now() - etat.drapeau.at > TTL_DRAPEAU_MS) {
    let pct = 0;
    try {
      const lecture = pool.query("select value from platform_flag where key = $1", [DRAPEAU_UN_AR]);
      const { rows } = await (echeance == null ? lecture : sousEcheance(lecture, echeance));
      pct = lirePourcentage(rows[0]?.value);
    } catch {
      pct = 0;
    }
    etat.drapeau = { at: Date.now(), pct };
  }
  const pct = etat.drapeau.pct;
  if (pct <= 0) return CHEMINS.historique;
  return pct >= 100 || tirage() * 100 < pct ? CHEMINS.unAR : CHEMINS.historique;
}

// ─────────────────────────────── Encodage ─────────────────────────────────────

/** Toutes les colonnes optionnelles présentes : le schéma de la fonction v109. */
const TOUT = Object.freeze({ has: () => true });

/** Un paramètre tel que `pg` l'aurait envoyé : texte (ou null), UTF-16 bien formé. */
function parametre(valeur) {
  const v = pgUtils.prepareValue(valeur);
  // Un Buffer n'arrive jamais dans ces collections ; `String` le dirait.
  if (v == null) return null;
  const texte = typeof v === "string" ? v : String(v);
  // `pg` écrit en UTF-8, où une moitié de paire devient U+FFFD ; JSON.stringify
  // la garderait échappée, et le jsonb la refuserait : on fait comme `pg`.
  return texte.toWellFormed();
}

const chaine = (v) => (typeof v === "string" && v !== "" ? v.toWellFormed() : null);

/**
 * Une ligne encodée : ses colonnes en texte, plus les sujets de barrière
 * (`__app`, `__s`, `__v`, `__u`, `__a`), seulement s'ils sont des chaînes non
 * vides — ce que comparent `sujetsDuLot` et `filtrerLot`.
 */
function encoderLigne(brute, prete, colonnes) {
  const sortie = {};
  for (const c of colonnes) sortie[c] = parametre(prete[c]);
  const meta = { __app: brute?.app_id, __s: brute?.session_id, __v: brute?.visitor_id, __u: brute?.user_id_hash, __a: brute?.account_id_hash };
  for (const [k, v] of Object.entries(meta)) {
    const s = chaine(v);
    if (s !== null) sortie[k] = s;
  }
  return sortie;
}

/** La valeur d'un vital pour le `>` de JavaScript : nombre, ±Infinity en texte, sinon null. */
function valeurComparee(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return Number.isFinite(v) ? v : String(v);
}

/**
 * Le lot de traces, encodé pour `mip_ingerer_lot_v2` (et `_v1`, qui ignore `log_uid`). PUR (testable sans base).
 * `colonnes` : les listes de `pg-ingest.mjs`, prises au schéma complet.
 * `errors` porte DÉJÀ sa symbolication et sa clé en ombre.
 */
export function encoderLot(rows, colonnes) {
  const lot = {};
  const coll = (nom, prep, cols, extra) => {
    const source = rows[nom];
    if (!Array.isArray(source)) return;
    lot[nom] = source.map((r) => {
      const ligne = encoderLigne(r, prep(r), cols);
      if (extra) Object.assign(ligne, extra(r));
      return ligne;
    });
  };
  const id = (r) => r ?? {};
  coll("logs", (l) => ({ ...l, attributes: l.attributes ? JSON.stringify(l.attributes) : null }), colonnes.log);
  coll("sessions", (s) => ({
    ...s,
    context: s.context ? JSON.stringify(s.context) : "{}",
    started_at: s.last_seen_at,
    page_count: 0,
  }), colonnes.session);
  coll("pageviews", (p) => ({ ...p, started_at: p.ts }), colonnes.pageview);
  coll("metrics", (m) => ({ ...m, attribution: m.attribution ? JSON.stringify(m.attribution) : null }), colonnes.metrique, (m) => ({
    // La clé de `consoliderMetriques` (la conversion en chaîne d'un gabarit), et
    // celle de `indexAvecVitalsConsolides` : seulement si `metric_uid` est vrai.
    ...(m.metric_uid ? { __mk: JSON.stringify([`${m.app_id}`, `${m.session_id}`, `${m.name}`, `${m.metric_uid}`]).toWellFormed() } : {}),
    __mv: valeurComparee(m.value),
    ...(m.metric_uid && isNativeSpanId(m.span_id) ? { __ns: m.span_id.toLowerCase() } : {}),
  }));
  coll("actions", (a) => ({ ...a, context: a.context ? JSON.stringify(a.context) : "{}" }), colonnes.action);
  coll("errors", (e) => ({ ...e, context: JSON.stringify(e.context ?? {}) }), colonnes.erreur, (e) => {
    // `rattacherSessions` : une revendication VRAIE est cherchée ; elle ne peut
    // correspondre que si c'est une chaîne (la comparaison passe par JSON).
    if (!e.session_claim) return {};
    return typeof e.session_claim === "string" ? { __claim: e.session_claim.toWellFormed() } : { __claim_nul: true };
  });
  coll("resources", id, colonnes.resource);
  coll("longtasks", id, colonnes.longtask);
  coll("breadcrumbs", id, colonnes.breadcrumb);
  coll("events", (e) => ({
    ...e,
    props: e.props ? JSON.stringify(e.props) : null,
    context: e.context ? JSON.stringify(e.context) : "{}",
  }), colonnes.evenement);
  coll("spans", id, colonnes.span);
  coll("eventIndex", (e) => ({ ...e, context: e.context ? JSON.stringify(e.context) : "{}" }), colonnes.index);
  coll("capabilities", id, colonnes.capacite);
  return lot;
}

// ─────────────────────────────── Appel ────────────────────────────────────────

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repli demandé par la fonction ou par son absence : rien n'a été écrit. */
export class RepliHistorique extends Error {
  constructor(raison) {
    super(`écriture en un aller-retour indisponible : ${raison}`);
    this.name = "RepliHistorique";
    this.raison = raison;
  }
}

/** SQLSTATE qui disent « l'échéance serveur a coupé ». */
const SQLSTATE_ECHEANCE = new Set(["57014", "25P03", "25P04"]);

/**
 * Appelle une fonction v109 en UNE requête, avec la stratégie de verrou de
 * l'ancien chemin : `lock_timeout`, reprises sur `55P03` avec le même recul,
 * échéance (P2) tenue côté serveur (la fonction lève `57014`) et côté client
 * (verdict attendu jusqu'à l'échéance + `GRACE_COMMIT_MS`, comme le COMMIT).
 *
 * Une échéance perdue côté client lève `ErreurEcheance` « inconnue » marquée
 * `connexionCompromise` : l'appelant DÉTRUIT la connexion au lieu de la rendre.
 * @returns {Promise<any>} la valeur `jsonb` rendue par la fonction
 */
export async function appelerUnAR(client, pool, sql, valeurs, apps, verrou = {}) {
  // v111 : le lot part par `mip_ingerer_lot_v2` ; tant qu'elle manque (code
  // déployé avant la migration), par `mip_ingerer_lot_v1`, sans repli historique.
  if (sql === SQL_LOT && Date.now() < etatDe(pool).v2AbsenteJusqua) sql = SQL_LOT_V1;
  const delaiMs = Math.max(0, Math.round(Number(verrou.delaiVerrouMs ?? STRATEGIE_VERROU.delaiMs)) || 0);
  const tentatives = verrou.tentatives ?? STRATEGIE_VERROU.tentatives;
  const echeance = verrou.echeance != null ? Number(verrou.echeance) : null;
  for (let essai = 1; ; essai++) {
    let options;
    if (echeance == null) {
      options = { lock_timeout_ms: delaiMs };
    } else {
      const restant = echeance - Date.now();
      if (!(restant > 0)) throw new ErreurEcheance();
      const reste = Math.max(1, Math.floor(restant));
      options = { lock_timeout_ms: Math.min(delaiMs, reste), restant_ms: reste };
    }
    try {
      const requete = client.query(sql, [...valeurs(options)]);
      const { rows } = echeance == null ? await requete : await sousEcheance(requete, echeance + GRACE_COMMIT_MS);
      return rows[0]?.r;
    } catch (err) {
      if (err instanceof ErreurEcheance) {
        // Pas de verdict à temps : la requête — donc le COMMIT implicite — est
        // partie. Même cas que « COMMIT envoyé sans verdict » : issue inconnue,
        // connexion à détruire.
        const e = new ErreurEcheance("écriture en un aller-retour sans verdict : issue inconnue", { issue: "inconnue", cause: err });
        e.connexionCompromise = true;
        throw e;
      }
      if (SQLSTATE_ECHEANCE.has(String(err?.code))) {
        throw new ErreurEcheance(`échéance serveur atteinte (${err.code})`, { cause: err });
      }
      if (err?.code === "MIP01") throw new ErreurPorteeApp(String(err.message));
      if (err?.code === "MIP02") throw new RepliHistorique("regroupement v2 actif ou configuration changée");
      if (err?.code === "42883" && sql === SQL_LOT) {
        // Rien n'a été écrit (l'appel n'a pas commencé) : même essai, par v1.
        etatDe(pool).v2AbsenteJusqua = Date.now() + TTL_ABSENCE_MS;
        sql = SQL_LOT_V1;
        essai--;
        continue;
      }
      if (err?.code === "42883" || err?.code === "42501") {
        etatDe(pool).absentJusqua = Date.now() + TTL_ABSENCE_MS;
        throw new RepliHistorique(err.code === "42883" ? "fonction absente (migration-v109)" : "droit d'exécution manquant");
      }
      if (err?.code !== "55P03") throw err;
      const recul = STRATEGIE_VERROU.reculMs[Math.min(essai - 1, STRATEGIE_VERROU.reculMs.length - 1)];
      if (essai >= tentatives || (echeance != null && echeance - Date.now() <= recul)) {
        throw new ErreurVerrouIngestion(apps, tentatives);
      }
      await dormir(recul);
    }
  }
}

/**
 * Configuration de regroupement des applications d'un lot (vendor_paths,
 * version active), en cache 30 s : la fonction SQL la RE-VÉRIFIE sous le verrou
 * (`MIP02` si elle a changé), donc un cache périmé ne coûte qu'un repli.
 */
async function configRegroupement(client, pool, apps) {
  const etat = etatDe(pool);
  const manquantes = apps.filter((a) => {
    const vu = etat.config.get(a);
    return !vu || Date.now() - vu.at > TTL_CONFIG_MS;
  });
  if (manquantes.length) {
    const { rows } = await client.query(SQL_CONFIG_REGROUPEMENT, [manquantes]);
    const lues = new Map(rows.map((r) => [r.app_id, r]));
    for (const a of manquantes) etat.config.set(a, { at: Date.now(), ligne: lues.get(a) ?? null });
  }
  return new Map(apps.map((a) => [a, etat.config.get(a)?.ligne]).filter(([, l]) => l));
}

/** Oublie la configuration en cache (après un `MIP02`). */
export function oublierConfig(pool) {
  etatDe(pool).config.clear();
}

/**
 * Prépare les erreurs : clé en ombre calculée ici, avec la configuration lue.
 * Rend `null` si une application du lot a le regroupement v2 actif : ce lot
 * prend directement le chemin historique.
 */
export async function preparerErreurs(client, pool, errors) {
  if (!errors.length) return { errors, regroupement: {} };
  const apps = [...new Set(errors.map((e) => e.app_id).filter((a) => typeof a === "string"))];
  const config = await configRegroupement(client, pool, apps);
  if ([...config.values()].some((c) => c.active_version === 2)) return null;
  const regroupement = {};
  for (const [app, c] of config) regroupement[app] = c.vendor_paths ?? [];
  return { errors: lignesEnOmbre(errors, config), regroupement };
}

/**
 * Le lot de traces ou de logs : `mip_ingerer_lot_v2` (migration-v111, logs
 * idempotents), et `mip_ingerer_lot_v1` (v109) en repli si v2 manque.
 */
export const SQL_LOT = "select mip_ingerer_lot_v2($1::text[], $2::jsonb, $3::jsonb) as r";
export const SQL_LOT_V1 = "select mip_ingerer_lot_v1($1::text[], $2::jsonb, $3::jsonb) as r";
export const SQL_REJEU = "select mip_ecrire_rejeu_v1($1, $2, $3::int4, $4::int4, $5::bytea, $6::jsonb) as r";

/** Les apps d'un lot, comme le verrou historique les prend. */
export { appsDuLot };
