// LE TRAVAIL `detections_horaires` (A2 § 7.0 et § 7.1) — la plage habituelle des
// p75 horaires, et les épisodes qui en sortent.
//
// Greffé sur le passage HORAIRE du scheduler (HH:05, `planifie.mjs`) : aucun
// cron à part, aucun réveil de la base en plus — le tick de :00 l'a déjà
// réveillée. Deux temps :
//
//   1. `refresh_vital_horaire(3)` (SQL, migration-v101) : les p75 des trois
//      dernières heures fermées, en upsert — les événements tardifs arrivent ;
//   2. ici, en JS, SUR DES AGRÉGATS (jamais sur le brut) : pour chaque série
//      app × route × vital, l'écart robuste des quatre dernières heures fermées
//      à leur plage habituelle, puis l'ouverture ou la fermeture d'un épisode
//      dans `signal_detecte`.
//
// Lecture par app : ~170 instants de référence × ~105 séries, par
// `hour = any(…)` sur l'index (app_id, hour) — de l'ordre de 10⁴ lignes.
//
// IDEMPOTENT : rejouer le même passage rend le même état. Un épisode ouvert
// n'est jugé que sur les heures qui suivent son début ; l'unicité (app,
// détecteur, entité, début) empêche un doublon ; le budget de bruit (6 h) empêche
// qu'un épisode refermé renaisse aussitôt.
import {
  BUDGET_BRUIT_MS,
  FUSEAU_CRENEAUX,
  MESURES_MIN_HEURE,
  Z_FERMETURE,
  Z_OUVERTURE,
  choisirReference,
  entiteSerie,
  evaluerHeure,
  gardeFraicheur,
  instantsReference,
  phraseEpisode,
  priorite,
  suivreEpisode,
  transformer,
} from "../shared/plage-habituelle.mjs";

const HEURE_MS = 3_600_000;
/** Heures fermées évaluées à chaque passage : les trois recalculées, plus une pour la règle « trois sur quatre ». */
export const HEURES_EVALUEES = 4;
/** Profondeur de lecture des épisodes passés (6 semaines de référence, plus une). */
const HISTORIQUE_EPISODES_MS = 43 * 24 * HEURE_MS;

const iso = (ms) => new Date(ms).toISOString();

/**
 * Les heures évaluées : les `HEURES_EVALUEES` dernières heures FERMÉES, en ms,
 * dans l'ordre chronologique.
 */
export function heuresEvaluees(maintenantMs) {
  const courante = Math.floor(maintenantMs / HEURE_MS) * HEURE_MS;
  return Array.from({ length: HEURES_EVALUEES }, (_, i) => courante - (HEURES_EVALUEES - i) * HEURE_MS);
}

/** Vrai si l'instant tombe dans un épisode passé (on ne l'emploie pas comme référence). */
function dansUnEpisode(ms, episodes) {
  return episodes.some((e) => ms >= e.debutMs && (e.finMs == null || ms < e.finMs));
}

/**
 * La décision pour UNE série, sans base : ce qu'il faut écrire.
 *
 * @param {object} p
 * @param {string} p.nom          vital
 * @param {string} p.route        '' = toutes routes
 * @param {Map<number, {n: number, p75: number|null, p75_bas: number|null, p75_haut: number|null}>} p.lignes  par heure (ms)
 * @param {Map<number, number>} p.totaux  n de la série « toutes routes » du même vital, par heure (la part d'une route)
 * @param {{id?: number, debutMs: number, finMs: number|null, statut: string}[]} p.episodes  épisodes de la même entité
 * @param {number[]} p.heures     heures évaluées (ms, chronologique)
 * @returns {{ evaluees: number, action: null | {type: 'ouvrir', ligne: object} | {type: 'fermer', id: number, finMs: number} | {type: 'suivre', id: number, preuves: object, priorite: number} , budget?: boolean }}
 */
export function deciderSerie({ nom, route, lignes, totaux, episodes, heures, fuseau = FUSEAU_CRENEAUX }) {
  const valeurA = (ms) => {
    const l = lignes.get(ms);
    if (!l || l.n < MESURES_MIN_HEURE || l.p75 == null || dansUnEpisode(ms, episodes)) return null;
    return transformer(nom, l.p75);
  };
  const ouvert = episodes.find((e) => e.statut === "ouvert") ?? null;
  // Un épisode ouvert n'est jugé que sur les heures qui suivent son début : les
  // heures calmes d'AVANT ne le referment pas (c'est ce qui rend le passage rejouable).
  const fenetre = ouvert ? heures.filter((h) => h >= ouvert.debutMs) : heures;
  const evals = fenetre.map((h) => {
    const l = lignes.get(h);
    if (!l || l.n < MESURES_MIN_HEURE || l.p75 == null) return null;
    const ref = choisirReference(h, valeurA, fuseau);
    if (!ref) return null;
    const e = evaluerHeure({ nom, p75: l.p75, p75Bas: l.p75_bas, p75Haut: l.p75_haut }, ref.valeurs);
    return e ? { h, l, ref, e } : null;
  });
  const evaluees = evals.filter(Boolean).length;
  const res = suivreEpisode(evals.map((x) => x?.e.z ?? null), ouvert != null);

  if (ouvert) {
    if (res.fin != null && !res.ouvert) {
      return { evaluees, action: { type: "fermer", id: ouvert.id, finMs: Math.max(fenetre[res.fin], ouvert.debutMs) } };
    }
    const derniere = [...evals].reverse().find(Boolean);
    if (!derniere) return { evaluees, action: null };
    return { evaluees, action: { type: "suivre", id: ouvert.id, ...contenu(derniere, ouvert.debutMs) } };
  }

  if (res.debut == null) return { evaluees, action: null };
  const debutMs = fenetre[res.debut];
  // Budget de bruit : un épisode refermé il y a moins de 6 h ne renaît pas.
  const recent = episodes.some((e) => e.finMs != null && e.finMs > debutMs - BUDGET_BRUIT_MS);
  if (recent) return { evaluees, action: null, budget: true };
  // La preuve : la dernière heure au-dessus du seuil depuis le début.
  const pic = evals.slice(res.debut).filter((x) => x && x.e.z > Z_OUVERTURE).at(-1) ?? evals[res.debut];
  const finMs = res.fin != null && !res.ouvert ? fenetre[res.fin] : null;
  return {
    evaluees,
    action: {
      type: "ouvrir",
      ligne: {
        entite: entiteSerie(nom, route),
        debutMs,
        finMs,
        statut: finMs == null ? "ouvert" : "clos",
        methode: {
          nom: "plage habituelle saisonnière (médiane et écart absolu médian, échelle logarithmique)",
          niveau: pic.ref.niveau,
          legende: pic.ref.legende,
          references: pic.ref.valeurs.length,
          seuil_ouverture: Z_OUVERTURE,
          seuil_fermeture: Z_FERMETURE,
          regle: "z > 3 deux heures de suite ou trois heures sur quatre ; fermé après deux heures à z ≤ 2",
          mesures_min_heure: MESURES_MIN_HEURE,
        },
        ...contenu(pic, debutMs),
      },
    },
  };

  /** Preuves, impact et priorité d'une heure évaluée. */
  function contenu(x, depuisMs) {
    const total = route ? totaux.get(x.h) : x.l.n;
    const part = total ? Math.min(1, x.l.n / total) : 1;
    const preuves = {
      vital: nom,
      route,
      heure: iso(x.h),
      p75: x.l.p75,
      p75_bas: x.l.p75_bas,
      p75_haut: x.l.p75_haut,
      n: x.l.n,
      mediane_habituelle: x.e.mediane,
      plage_bas: x.e.bas,
      plage_haut: x.e.haut,
      z: Math.round(x.e.z * 100) / 100,
      ecart_relatif: Math.round(x.e.ecartRelatif * 1000) / 1000,
      niveau: x.ref.niveau,
      phrase: phraseEpisode({
        nom,
        route,
        valeur: x.l.p75,
        mediane: x.e.mediane,
        z: x.e.z,
        n: x.l.n,
        debutMs: depuisMs,
        niveau: x.ref.niveau,
        legende: x.ref.legende,
        fuseau,
      }),
    };
    return {
      preuves,
      impact: { part_mesures: Math.round(part * 1000) / 1000, mesures: x.l.n, mesures_total: total ?? x.l.n },
      priorite: priorite({ part, ecartRelatif: x.e.ecartRelatif, z: x.e.z }),
    };
  }
}

/**
 * Le passage : pour chaque app qui a des p75 dans les heures évaluées, la garde de
 * fraîcheur, la lecture des références, les décisions, les écritures.
 * @returns {Promise<object>} le bilan (journalisé par le scheduler)
 */
export async function detecterPlages(pool, { maintenantMs = Date.now(), fuseau = FUSEAU_CRENEAUX } = {}) {
  const heures = heuresEvaluees(maintenantMs);
  const bilan = { apps: 0, series: 0, evaluees: 0, ouverts: 0, fermes: 0, suivis: 0, budget: 0, suspendues: [] };

  const { rows: apps } = await pool.query(
    "select distinct app_id from vital_horaire where hour >= $1 and hour < $2 order by app_id",
    [iso(heures[0]), iso(heures.at(-1) + HEURE_MS)],
  );
  if (apps.length === 0) return bilan;
  const { rows: fraicheurs } = await pool.query(
    "select app_id, max(ts) as derniere from rum_metric where ts >= $1 group by app_id",
    [iso(maintenantMs - 3 * HEURE_MS)],
  );
  const derniere = new Map(fraicheurs.map((r) => [r.app_id, new Date(r.derniere).getTime()]));

  // Tous les instants utiles, une fois : les heures évaluées et leurs références.
  const instants = new Set(heures);
  for (const h of heures) for (const liste of Object.values(instantsReference(h, fuseau))) for (const ms of liste) instants.add(ms);
  const instantsIso = [...instants].map(iso);

  for (const { app_id: app } of apps) {
    bilan.apps++;
    const garde = gardeFraicheur(maintenantMs, derniere.get(app) ?? null);
    if (garde.suspendue) {
      bilan.suspendues.push({ app_id: app, raison: garde.raison });
      continue;
    }
    const { rows } = await pool.query(
      `select route, name, hour, n, p75, p75_bas, p75_haut
         from vital_horaire where app_id = $1 and hour = any($2::timestamptz[])`,
      [app, instantsIso],
    );
    const { rows: passes } = await pool.query(
      `select id, entite, debut, fin, statut from signal_detecte
        where app_id = $1 and detecteur = 'plage' and coalesce(fin, now()) >= $2`,
      [app, iso(maintenantMs - HISTORIQUE_EPISODES_MS)],
    );
    const series = new Map();
    for (const r of rows) {
      const cle = `${r.route}\u0000${r.name}`;
      if (!series.has(cle)) series.set(cle, { route: r.route, nom: r.name, lignes: new Map() });
      series.get(cle).lignes.set(new Date(r.hour).getTime(), {
        n: Number(r.n),
        p75: r.p75 == null ? null : Number(r.p75),
        p75_bas: r.p75_bas == null ? null : Number(r.p75_bas),
        p75_haut: r.p75_haut == null ? null : Number(r.p75_haut),
      });
    }
    const episodesDe = new Map();
    for (const p of passes) {
      if (!episodesDe.has(p.entite)) episodesDe.set(p.entite, []);
      episodesDe.get(p.entite).push({
        id: Number(p.id),
        debutMs: new Date(p.debut).getTime(),
        finMs: p.fin == null ? null : new Date(p.fin).getTime(),
        statut: p.statut,
      });
    }

    for (const s of series.values()) {
      // Une série sans aucune heure évaluable dans la fenêtre n'est pas lue plus loin.
      if (!heures.some((h) => (s.lignes.get(h)?.n ?? 0) >= MESURES_MIN_HEURE)) continue;
      bilan.series++;
      const toutes = series.get(`\u0000${s.nom}`);
      const totaux = new Map([...(toutes?.lignes ?? new Map())].map(([h, l]) => [h, l.n]));
      const d = deciderSerie({
        nom: s.nom,
        route: s.route,
        lignes: s.lignes,
        totaux,
        episodes: episodesDe.get(entiteSerie(s.nom, s.route)) ?? [],
        heures,
        fuseau,
      });
      bilan.evaluees += d.evaluees;
      if (d.budget) bilan.budget++;
      if (!d.action) continue;
      await ecrire(pool, app, d.action);
      if (d.action.type === "ouvrir") bilan.ouverts++;
      else if (d.action.type === "fermer") bilan.fermes++;
      else bilan.suivis++;
    }
  }
  return bilan;
}

/** Une décision, écrite. Un constat masqué par un humain le reste. */
async function ecrire(pool, app, action) {
  if (action.type === "fermer") {
    await pool.query(
      `update signal_detecte set fin = $2, statut = case when statut = 'masque' then statut else 'clos' end, maj_le = now()
        where id = $1`,
      [action.id, iso(action.finMs)],
    );
    return;
  }
  if (action.type === "suivre") {
    await pool.query(
      "update signal_detecte set preuves = $2, impact = $3, priorite = $4, maj_le = now() where id = $1",
      [action.id, action.preuves, action.impact, action.priorite],
    );
    return;
  }
  const l = action.ligne;
  await pool.query(
    `insert into signal_detecte (app_id, detecteur, entite, debut, fin, methode, preuves, impact, priorite, statut)
     values ($1, 'plage', $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (app_id, detecteur, entite, debut) do update
        set fin = excluded.fin, methode = excluded.methode, preuves = excluded.preuves,
            impact = excluded.impact, priorite = excluded.priorite, maj_le = now(),
            statut = case when signal_detecte.statut = 'masque' then signal_detecte.statut else excluded.statut end`,
    [app, l.entite, iso(l.debutMs), l.finMs == null ? null : iso(l.finMs), l.methode, l.preuves, l.impact, l.priorite, l.statut],
  );
}
