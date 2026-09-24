// Sonde de banc : compte les allers-retours SQL et chronomètre le verrou
// d'ingestion, SANS toucher au code de production.
//
// POURQUOI UNE SONDE CÔTÉ CLIENT. La porte go/no-go de P2 se lit en
// « utilisation du verrou » (temps tenu / temps total) et en allers-retours par
// lot. Le verrou est consultatif : `withAppIngestTransaction`
// (`packages/backend/lib/privacy-barriere.mjs`) le prend par
// `pg_advisory_xact_lock` et le rend au COMMIT. Aucune vue Postgres ne donne sa
// durée de tenue — `pg_locks` ne montre que l'instant. On l'observe donc là où
// il se voit : sur le client `pg`, à la réponse de la requête de verrou et à la
// réponse du COMMIT. Instrumenter `privacy-barriere.mjs` aurait fait embarquer
// au collector un code de mesure ; la sonde, elle, ne vit que dans un
// processus de banc (préchargée par `sonde-pg-preload.mjs`, ou installée par
// `bench-verrou-p81.mjs`).
//
// CE QUE DIT CHAQUE CHIFFRE, vu du client, en horloge murale haute résolution
// (`performance.timeOrigin + performance.now()` : deux processus du même poste
// partagent donc la même échelle, ce qui permet au pilote de découper ses
// fenêtres sans échanger d'horloge) :
//
//   debut ──BEGIN… ──▶ verrouDebut ──attente──▶ verrouFin ──tenu──▶ fin (COMMIT rendu)
//
//   - `transaction` = fin − debut ;
//   - `attente`     = verrouFin − verrouDebut. C'est l'attente RÉELLE du verrou
//     PLUS un aller-retour : le pilote retranche l'A/R mesuré à vide ;
//   - `tenu`        = fin − verrouFin. C'est EXACTEMENT la tenue côté serveur :
//     le serveur accorde le verrou un aller simple (aval) avant que la réponse
//     n'arrive, et le relâche au COMMIT un aller simple (aval) avant que la
//     réponse du COMMIT n'arrive — les deux décalages s'annulent ;
//   - `requetes`    = appels `client.query` de BEGIN à COMMIT inclus, sur CE
//     client. `pg` ne pipeline pas : chaque appel est un aller-retour, même
//     lancés ensemble par un `Promise.all` (ils attendent en file).
//
// Les requêtes HORS transaction (débit `rate_check`, registre d'apps, sondes)
// sont comptées à part, horodatées : elles coûtent un aller-retour à la
// requête HTTP mais ne prolongent pas la tenue du verrou.
//
// CE QU'ELLE NE FAIT PAS : elle ne modifie ni les requêtes, ni leurs
// résultats, ni leurs erreurs. Elle ajoute une lecture d'horloge et une
// écriture en mémoire par requête, hors du chemin réseau.

/** Même espace de noms que `VERROU_INGESTION_NS` : seul CE verrou est suivi. */
import { VERROU_INGESTION_NS } from "../../packages/backend/lib/privacy-barriere.mjs";

export const maintenant = () => performance.timeOrigin + performance.now();

/**
 * Étiquette courte d'une requête, pour dire QUELS allers-retours composent un
 * lot (le rapport les liste). Pure, testable, jamais de valeur liée : seul le
 * texte SQL, qui ne porte aucune donnée (tout est paramétré).
 */
export function etiquette(texte) {
  const s = String(texte ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (/^(begin|start transaction)\b/.test(s)) return "begin";
  if (/^commit\b/.test(s)) return "commit";
  if (/^rollback\b/.test(s)) return "rollback";
  if (/^set local\b/.test(s)) return "set local";
  if (s.includes("pg_advisory_xact_lock")) return "verrou";
  let m = s.match(/^insert into (\w+)/);
  if (m) return `insert ${m[1]}`;
  m = s.match(/^update (\w+)/);
  if (m) return `update ${m[1]}`;
  m = s.match(/^delete from (\w+)/);
  if (m) return `delete ${m[1]}`;
  m = s.match(/^select (\w+)\(/);
  if (m && !["count", "exists", "to_jsonb"].includes(m[1])) return `select ${m[1]}()`;
  if (s.includes("information_schema")) return "select information_schema";
  m = s.match(/ from (\w+)/);
  if (m) return `select ${m[1]}`;
  return s.slice(0, 32);
}

const texteDe = (config) => (typeof config === "string" ? config : config?.text ?? "");

/**
 * Installe la sonde sur le module `pg` donné (celui du processus mesuré).
 * Idempotent : une seconde installation rend la première.
 *
 * @param {{ Client: { prototype: { query: Function } } }} pg
 * @param {{ genresParLot?: boolean }} [opts]  garder la liste des étiquettes de
 *   chaque lot (quelques dizaines de chaînes courtes par lot : négligeable)
 */
export function installerSonde(pg, opts = {}) {
  const proto = pg?.Client?.prototype;
  if (!proto || typeof proto.query !== "function") throw new TypeError("installerSonde : passer le module `pg`");
  if (proto.__sondeBanc) return proto.__sondeBanc;
  const garderGenres = opts.genresParLot ?? true;
  const original = proto.query;

  /** Transaction EN COURS par client (un client n'en porte qu'une à la fois). */
  const enCours = new WeakMap();
  let lots = [];
  let horsTransaction = [];
  let autres = 0; // transactions sans le verrou d'ingestion (migrateur, travaux…)

  function noter(client, texte, valeurs, debut) {
    const genre = etiquette(texte);
    let tx = enCours.get(client);
    if (genre === "begin") {
      tx = { debut, verrouDebut: null, verrouFin: null, fin: null, requetes: 0, genres: garderGenres ? [] : null, app: null, issue: null };
      enCours.set(client, tx);
    }
    if (!tx) {
      horsTransaction.push({ t: debut, genre });
      return () => {};
    }
    tx.requetes++;
    if (tx.genres) tx.genres.push(genre);
    const estVerrou = genre === "verrou" && Array.isArray(valeurs) && Number(valeurs[0]) === VERROU_INGESTION_NS;
    if (estVerrou && tx.verrouDebut == null) {
      tx.verrouDebut = debut;
      if (typeof valeurs[1] === "string") tx.app = valeurs[1];
    }
    const fin = genre === "commit" || genre === "rollback";
    return (erreur) => {
      const t = maintenant();
      // Plusieurs verrous (lot multi-app) : la tenue commence au DERNIER accordé.
      if (estVerrou && !erreur) tx.verrouFin = t;
      if (fin) {
        tx.fin = t;
        tx.issue = erreur ? "erreur" : genre;
        enCours.delete(client);
        if (tx.verrouDebut != null) lots.push(tx);
        else autres++;
      }
    };
  }

  proto.query = function sondeQuery(config, values, callback) {
    let clore;
    try {
      clore = noter(this, texteDe(config), Array.isArray(values) ? values : config?.values, maintenant());
    } catch {
      clore = () => {};
    }
    // Forme rappel (celle de pg-pool pour `pool.query`) : on enveloppe le rappel.
    if (typeof values === "function") {
      const cb = values;
      return original.call(this, config, (err, res) => { clore(err); cb(err, res); });
    }
    if (typeof callback === "function") {
      const cb = callback;
      return original.call(this, config, values, (err, res) => { clore(err); cb(err, res); });
    }
    const sortie = original.call(this, config, values, callback);
    // Branche LATÉRALE : la promesse rendue à l'appelant reste l'originale,
    // rejet compris ; celle-ci ne fait que chronométrer (et ne rejette jamais).
    if (sortie && typeof sortie.then === "function") sortie.then(() => clore(null), (e) => clore(e ?? true));
    else clore(null);
    return sortie;
  };

  const sonde = {
    /** Rend ce qui a été relevé depuis le dernier `vider` (ou l'installation). */
    releve: () => ({ lots, horsTransaction, autres }),
    /** Rend le relevé ET repart de zéro (le préchargement le fait à chaque vidage). */
    vider() {
      const r = { lots, horsTransaction, autres };
      lots = [];
      horsTransaction = [];
      autres = 0;
      return r;
    },
    desinstaller() {
      proto.query = original;
      delete proto.__sondeBanc;
    },
  };
  proto.__sondeBanc = sonde;
  return sonde;
}

/** Percentile (0..100), rang supérieur ; null si vide. */
export function percentile(valeurs, p) {
  if (!valeurs.length) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  return tri[Math.min(tri.length - 1, Math.max(0, Math.ceil((p / 100) * tri.length) - 1))];
}

const arrondi = (v, n = 1) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);

/**
 * Réduit un relevé à ce que la porte P2 lit, sur une fenêtre [depuis, jusqua]
 * (horloge murale, ms). PURE : testable sans base.
 *
 * - seuls comptent les lots d'ÉCRITURE : un lot qui a pris le verrou et fait
 *   plus que BEGIN/SET/verrou/COMMIT (la sonde de `bench-verrou-p81` en fait
 *   exactement quatre : elle mesure l'attente, pas l'écriture) ;
 * - `utilisation` = somme des tenues, rognées à la fenêtre, / durée de la
 *   fenêtre. Pour UNE application, le verrou sérialise : les tenues ne se
 *   chevauchent pas, la somme est donc un temps d'occupation réel (≤ 1) ;
 * - `attenteNette` retranche l'aller-retour à vide `rttMs` (voir l'en-tête).
 *
 * @param {{lots: object[], horsTransaction: {t:number, genre:string}[]}} releve
 * @param {{ depuis: number, jusqua: number, rttMs?: number }} fenetre
 */
export function analyser(releve, { depuis, jusqua, rttMs = 0 }) {
  const duree = Math.max(1e-9, jusqua - depuis);
  const dans = (t) => t >= depuis && t <= jusqua;
  const tous = (releve.lots ?? []).filter((l) => dans(l.debut));
  const ecritures = tous.filter((l) => l.requetes > 4 && l.issue === "commit" && l.verrouFin != null);
  const refus = tous.filter((l) => l.issue !== "commit").length;
  const tenues = ecritures.map((l) => l.fin - l.verrouFin);
  const occupation = ecritures.reduce(
    (s, l) => s + Math.max(0, Math.min(l.fin, jusqua) - Math.max(l.verrouFin, depuis)), 0);
  const attentes = ecritures.map((l) => l.verrouFin - l.verrouDebut);
  const horsTx = (releve.horsTransaction ?? []).filter((q) => dans(q.t));
  const parGenre = {};
  for (const q of horsTx) parGenre[q.genre] = (parGenre[q.genre] ?? 0) + 1;
  const requetes = ecritures.map((l) => l.requetes);
  // Séquence la plus fréquente : c'est elle que le rapport détaille ; les
  // variantes (lot porteur d'une erreur, par exemple) sont rendues à part.
  const sequences = new Map();
  for (const l of ecritures) {
    if (!l.genres) continue;
    const cle = l.genres.join(" › ");
    sequences.set(cle, (sequences.get(cle) ?? 0) + 1);
  }
  const classees = [...sequences.entries()].sort((a, b) => b[1] - a[1]);
  const [sequenceType, sequenceN] = classees[0] ?? [null, 0];
  const moy = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
  return {
    lots: ecritures.length,
    lotsParSeconde: arrondi(ecritures.length / (duree / 1000), 2),
    transactionMs: { p50: arrondi(percentile(ecritures.map((l) => l.fin - l.debut), 50)), p95: arrondi(percentile(ecritures.map((l) => l.fin - l.debut), 95)) },
    attenteVerrouMs: {
      p50: arrondi(percentile(attentes, 50)),
      p95: arrondi(percentile(attentes, 95)),
      max: arrondi(percentile(attentes, 100)),
      nette_p50: arrondi(Math.max(0, (percentile(attentes, 50) ?? 0) - rttMs)),
      nette_p95: arrondi(Math.max(0, (percentile(attentes, 95) ?? 0) - rttMs)),
    },
    tenuMs: { moyenne: arrondi(moy(tenues)), p50: arrondi(percentile(tenues, 50)), p95: arrondi(percentile(tenues, 95)) },
    utilisation: arrondi(occupation / duree, 4),
    allersRetoursParLot: {
      dansTransaction: { min: percentile(requetes, 0), p50: percentile(requetes, 50), max: percentile(requetes, 100) },
      horsTransaction: ecritures.length ? arrondi(horsTx.length / ecritures.length, 2) : null,
      horsTransactionParGenre: parGenre,
    },
    refusOuAnnulations: refus,
    sequenceType: sequenceType ? { n: sequenceN, sur: ecritures.length, genres: sequenceType.split(" › ") } : null,
    variantes: classees.slice(1, 4).map(([cle, n]) => ({ n, requetes: cle.split(" › ").length, genres: cle.split(" › ") })),
  };
}
