// P8.2 — le PLAN d'une reprise d'historique, et rien d'autre.
//
// CE MODULE NE TOUCHE JAMAIS AUX TABLES RUM. Il lit, il compte, il mesure, il
// signe ; il n'écrit ni une ligne de télémétrie ni une projection. Le seul objet
// qu'il produit est un manifeste technique — comptes, bornes, empreintes — dans
// lequel aucun payload n'entre : ni message, ni stack, ni identifiant de
// personne, ni route. Un plan qu'on peut relire à voix haute en réunion.
//
// POURQUOI UN PLAN SIGNÉ. Une reprise d'historique réécrit des données que
// personne ne regarde plus : si elle se trompe, personne ne le verra avant des
// mois. L'empreinte du plan et celle du code sont donc exigées à l'exécution —
// reprendre une exécution interrompue avec un autre plan, ou avec un code dont
// la règle de reconstruction a changé entre-temps, produirait une moitié de
// fenêtre traitée d'une façon et l'autre moitié d'une autre, sans que rien ne le
// dise. Le refus est explicite : nouveau dry-run.
//
// « EXACT » EST UN MOT QUI S'ACHÈTE. Un comptage exact sur une fenêtre de
// plusieurs millions de lignes coûte un parcours complet, sous les yeux d'une
// ingestion en cours. Quand le planificateur voit que ce coût est excessif, il
// ÉCHANTILLONNE et le dit — méthode, taille d'échantillon, intervalle à 95 % —
// au lieu d'annoncer un nombre rond en espérant qu'il soit juste.
//
// LA FENÊTRE TIENT DANS LA RÉTENTION RÉELLEMENT DISPONIBLE. Pas « 30 jours » :
// la rétention de CETTE application (`app_registry.retention_days`, sinon le
// défaut de `purge_rum_tenants`), et — séparément — la plus ancienne ligne
// RÉELLEMENT présente dans chaque table source. Les deux sont rapportées : une
// fenêtre peut tenir dans la politique de rétention et ne contenir aucune donnée
// parce que la purge est passée.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ISO_US } from "./commun.mjs";
import { EVENEMENT_INDEX } from "./event-index.mjs";
import { ROLLUPS } from "./rollups.mjs";
import { DIMENSIONS } from "./dimensions.mjs";
import { GROUPES_ERREUR } from "./error-groups.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));

export { ISO_US };

/** Les quatre reconstructions de la spec §3, dans l'ordre où elle les énumère. */
export const KINDS = Object.freeze({
  "event-index": EVENEMENT_INDEX,
  rollups: ROLLUPS,
  dimensions: DIMENSIONS,
  "error-groups": GROUPES_ERREUR,
});

/** `all` n'est pas une application. Le refus est ici, pas dans l'aide de la CLI. */
export const APP_INTERDITES = Object.freeze(["all", "*", "tous", "toutes"]);

/**
 * Taille de lot : 1 000 par défaut, bornée à 100..5 000 (spec §3).
 *
 * En dessous de 100, le coût fixe d'une transaction domine le travail utile ; au
 * delà de 5 000, la transaction dépasse la cible de 2 s et tient le verrou
 * d'application de P8.1 pendant tout ce temps — c'est-à-dire qu'elle fait
 * attendre l'ingestion de l'application qu'on prétend ne pas perturber.
 */
export const LOT = Object.freeze({ defaut: 1_000, min: 100, max: 5_000 });

/** Rétention par défaut de `purge_rum_tenants`, quand le registre ne dit rien. */
export const RETENTION_DEFAUT_JOURS = 30;

/**
 * Au-delà de ce coût estimé par le planificateur PostgreSQL, un comptage exact
 * est jugé excessif et remplacé par un échantillonnage annoncé comme tel.
 *
 * Le seuil porte sur le COÛT et non sur un nombre de lignes : c'est la seule
 * grandeur que PostgreSQL sait rendre sans exécuter la requête.
 */
export const SEUIL_COUT_COMPTE_EXACT = 2_000_000;

/** Nombre d'heures tirées au sort quand le comptage exact est trop cher. */
export const HEURES_ECHANTILLON = 24;

/** Erreur de plan : typée, jamais un `throw new Error("…")` anonyme. */
export class ErreurPlan extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ErreurPlan";
    this.code = code;
  }
}

// ───────────────────────────── Fenêtre et bornes ─────────────────────────────

/**
 * Valide une borne de fenêtre. ACCEPTE UNIQUEMENT UN INSTANT UTC EXPLICITE.
 *
 * Une chaîne sans fuseau (« 2026-09-01 »), interprétée par `Date`, prendrait le
 * fuseau de la machine qui lance l'outil : la même commande jouée à Paris et à
 * Montréal ne décrirait pas la même fenêtre, et personne ne le verrait dans le
 * journal. Les fenêtres sont UTC `[from, to)`, point.
 */
export function borneUtc(valeur, nom) {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?Z$/.test(valeur)) {
    throw new ErreurPlan(
      "borne_invalide",
      `${nom} doit être un instant UTC explicite (ex. 2026-09-01T00:00:00Z), reçu « ${String(valeur)} »`,
    );
  }
  return valeur;
}

/** Fenêtre `[from, to)` validée : bornes UTC, non vide, ordonnée. */
export function fenetre(from, to) {
  const debut = borneUtc(from, "--from");
  const fin = borneUtc(to, "--to");
  if (Date.parse(debut) >= Date.parse(fin)) {
    throw new ErreurPlan("fenetre_vide", `--from doit précéder --to ([from, to) est semi-ouvert)`);
  }
  return { from: debut, to: fin };
}

/**
 * Rétention RÉELLEMENT applicable à cette application, et ce qu'elle implique
 * pour la borne basse d'une fenêtre.
 *
 * `retention_days` du registre, sinon le défaut de `purge_rum_tenants`. La
 * valeur n'est pas « 30 » par décret : elle est lue, et sa provenance est dite.
 */
export async function retentionApp(client, appId) {
  const { rows } = await client.query(
    `select retention_days,
            to_char((now() - make_interval(days => greatest(coalesce(retention_days, $2), 1)))
                    at time zone 'UTC', ${ISO_US}) as cutoff
       from app_registry where app_id = $1`,
    [appId, RETENTION_DEFAUT_JOURS],
  );
  if (!rows.length) {
    throw new ErreurPlan(
      "app_inconnue",
      `application « ${appId} » absente de app_registry : une reprise ne s'invente pas un périmètre`,
    );
  }
  const jours = rows[0].retention_days ?? RETENTION_DEFAUT_JOURS;
  return {
    jours,
    source: rows[0].retention_days == null ? "defaut_purge_rum_tenants" : "app_registry.retention_days",
    cutoff: rows[0].cutoff,
  };
}

/**
 * Plus ancienne ligne RÉELLEMENT présente dans chaque table source, pour cette
 * application.
 *
 * La rétention dit ce que la politique autorise à conserver ; ceci dit ce qui
 * reste. Les deux diffèrent après une purge, un effacement ou un démarrage
 * récent, et confondre les deux fait promettre une reconstruction sur des
 * données qui n'existent plus.
 */
export async function disponibiliteReelle(client, appId, sources) {
  const dispo = {};
  for (const { table, ts } of sources) {
    const { rows } = await client.query(
      `select to_char(min(${ts}) at time zone 'UTC', ${ISO_US}) as plus_ancien,
              to_char(max(${ts}) at time zone 'UTC', ${ISO_US}) as plus_recent,
              count(*)::bigint as lignes
         from ${table} where app_id = $1`,
      [appId],
    );
    dispo[table] = {
      plus_ancien: rows[0].plus_ancien,
      plus_recent: rows[0].plus_recent,
      lignes: Number(rows[0].lignes),
    };
  }
  return dispo;
}

// ────────────────────────────── Empreintes ───────────────────────────────────

const sha256 = (texte) => createHash("sha256").update(texte).digest("hex");

/**
 * Fichiers dont le contenu DÉTERMINE une reconstruction : les modules de reprise
 * et les normalisateurs qu'ils réutilisent.
 *
 * Ils sont nommés un par un, et c'est délibéré : hacher « tout le dépôt »
 * invaliderait chaque plan à chaque commit de documentation, et hacher le seul
 * module de reprise laisserait passer un changement de `buildEventIndex` ou de
 * la clé de regroupement — c'est-à-dire précisément le changement qui ferait
 * reconstruire la deuxième moitié d'une fenêtre autrement que la première.
 */
export const FICHIERS_CODE = Object.freeze([
  "lib/backfills/planner.mjs",
  "lib/backfills/runner.mjs",
  "lib/backfills/event-index.mjs",
  "lib/backfills/rollups.mjs",
  "lib/backfills/dimensions.mjs",
  "lib/backfills/error-groups.mjs",
  "lib/error-grouping.mjs",
  "lib/error-issue-workflow.mjs",
  "shared/otlp.mjs",
  "shared/dimensions.mjs",
  "shared/error-normalize.mjs",
  "shared/scrub.mjs",
]);

/** sha256 des modules de reconstruction et des normalisateurs réutilisés. */
export function empreinteCode() {
  const racine = join(ICI, "..", "..");
  const morceaux = FICHIERS_CODE.map((rel) => `${rel} ${sha256(readFileSync(join(racine, rel), "utf8"))}`);
  return sha256(morceaux.join("\n"));
}

/**
 * sha256 du SCHÉMA réellement en place pour les tables du plan : noms de
 * colonnes, types, nullabilité.
 *
 * Une colonne ajoutée ou retirée entre le plan et l'exécution change ce qu'une
 * reconstruction peut écrire. Le registre `schema_migration` ne suffit pas : une
 * base de recette qui applique les fichiers à la main n'en a pas.
 */
export async function empreinteSchema(client, tables) {
  const { rows } = await client.query(
    `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[])
      order by table_name, column_name`,
    [[...tables].sort()],
  );
  return sha256(rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}:${r.is_nullable}`).join("\n"));
}

/**
 * Empreinte du plan : tout ce qui décide du travail, rien de ce qui le décrit.
 *
 * Les comptes, les durées et l'espace estimé N'ENTRENT PAS dans l'empreinte :
 * ils changent à chaque relevé, et exiger qu'ils soient identiques à la reprise
 * interdirait toute reprise dès qu'un seul événement est arrivé. Ce qui entre :
 * le `kind`, l'application, la fenêtre, la taille de lot, les bornes hautes de
 * source, et les empreintes de code et de schéma.
 */
export function empreintePlan(plan) {
  return sha256(canonique({
    kind: plan.kind,
    app: plan.app,
    from: plan.from,
    to: plan.to,
    taille_lot: plan.taille_lot,
    cutoffs: plan.cutoffs,
    code_sha: plan.code_sha,
    schema_sha: plan.schema_sha,
  }));
}

/**
 * JSON à ordre de clés STABLE.
 *
 * `JSON.stringify` suit l'ordre d'insertion ; `jsonb` de PostgreSQL, lui, range
 * les clés par longueur puis par octets. Les bornes relues du journal
 * reviendraient donc dans un autre ordre que celles du plan, et l'empreinte
 * différerait à chaque reprise — un refus permanent, pour une raison invisible.
 */
function canonique(valeur) {
  if (valeur === null || typeof valeur !== "object") return JSON.stringify(valeur) ?? "null";
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(",")}]`;
  return `{${Object.keys(valeur).sort()
    .filter((k) => valeur[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonique(valeur[k])}`)
    .join(",")}}`;
}

// ──────────────────────────── Comptage honnête ───────────────────────────────

/** Coût total estimé par le planificateur PostgreSQL, sans exécuter la requête. */
export async function coutEstime(client, sql, params) {
  const { rows } = await client.query(`explain (format json) ${sql}`, params);
  const plan = rows[0]["QUERY PLAN"][0].Plan;
  return { cout: plan["Total Cost"], lignes_estimees: plan["Plan Rows"] };
}

/**
 * Compte exact, OU estimation par échantillon d'heures avec intervalle à 95 %.
 *
 * L'échantillon porte sur des HEURES tirées au sort dans la fenêtre, et non sur
 * un `tablesample` : les tables sources sont indexées par (app, horodatage),
 * donc une heure se compte exactement pour presque rien, et la dispersion entre
 * heures — la seule qui compte ici, le trafic n'étant pas uniforme — est
 * directement mesurée par l'échantillon.
 *
 * `sqlCompte` compte la fenêtre entière, `sqlHeure` une sous-fenêtre : les deux
 * reçoivent $1 = app, $2 = borne basse, $3 = borne haute.
 *
 * @returns {Promise<{methode: 'exact'|'echantillon', valeur: number, ...}>}
 */
export async function compter(client, { app, from, to, sqlCompte, sqlHeure }) {
  const { cout, lignes_estimees: estimees } = await coutEstime(client, sqlCompte, [app, from, to]);
  if (cout <= SEUIL_COUT_COMPTE_EXACT) {
    const { rows } = await client.query(sqlCompte, [app, from, to]);
    return { methode: "exact", valeur: Number(rows[0].n), cout_estime: cout };
  }

  const heures = Math.max(1, Math.floor((Date.parse(to) - Date.parse(from)) / 3_600_000));
  const tirees = Math.min(HEURES_ECHANTILLON, heures);
  const { rows: bornes } = await client.query(
    `select to_char(h at time zone 'UTC', ${ISO_US}) as lo,
            to_char((h + interval '1 hour') at time zone 'UTC', ${ISO_US}) as hi
       from generate_series($1::timestamptz, $2::timestamptz - interval '1 hour', interval '1 hour') as h
      order by md5(h::text) limit $3`,
    [from, to, tirees],
  );
  const mesures = [];
  for (const { lo, hi } of bornes) {
    const { rows } = await client.query(sqlHeure, [app, lo, hi]);
    mesures.push(Number(rows[0].n));
  }
  const moyenne = mesures.reduce((a, b) => a + b, 0) / mesures.length;
  // Variance d'échantillon (n-1) : avec une seule heure tirée, la dispersion
  // n'est pas mesurable et l'intervalle est déclaré inconnu plutôt qu'à zéro.
  const variance = mesures.length > 1
    ? mesures.reduce((a, b) => a + (b - moyenne) ** 2, 0) / (mesures.length - 1)
    : null;
  const demiLargeur = variance == null
    ? null
    // 1,96 σ/√n × H : approximation normale de la moyenne, extrapolée aux H
    // heures de la fenêtre. Correction de population finie quand on a tiré une
    // part notable des heures — sans elle, l'intervalle resterait large même
    // après avoir tout compté.
    : 1.96 * Math.sqrt((variance / mesures.length) * (1 - mesures.length / heures)) * heures;
  return {
    methode: "echantillon",
    valeur: Math.round(moyenne * heures),
    cout_estime: cout,
    lignes_estimees_par_le_planificateur: estimees,
    echantillon: { heures_tirees: mesures.length, heures_totales: heures },
    confiance: demiLargeur == null ? null : "95 %",
    intervalle: demiLargeur == null
      ? null
      : [Math.max(0, Math.round(moyenne * heures - demiLargeur)), Math.round(moyenne * heures + demiLargeur)],
  };
}

// ─────────────────────────────── Le plan ─────────────────────────────────────

/** Index présents sur les tables citées : ce sur quoi la reprise va s'appuyer. */
export async function indexesDe(client, tables) {
  const { rows } = await client.query(
    `select tablename, indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = any($1::text[]) order by 1, 2`,
    [[...tables].sort()],
  );
  return rows.map((r) => ({ table: r.tablename, index: r.indexname, definition: r.indexdef }));
}

/**
 * Espace attendu : lignes à écrire × largeur moyenne observée de la table cible.
 *
 * Quand la table cible est vide, aucune largeur n'est observable : l'espace est
 * `null`, « inconnu », et non zéro. Un chiffre inventé ici deviendrait un
 * argument dans la décision de P8.3.
 */
export async function espaceAttendu(client, cibles, lignesAEcrire) {
  const detail = {};
  let total = 0;
  let inconnu = false;
  for (const table of cibles) {
    const { rows } = await client.query(
      `select pg_total_relation_size($1::regclass)::bigint as taille,
              (select reltuples::bigint from pg_class where oid = $1::regclass) as lignes`,
      [table],
    );
    const lignes = Number(rows[0].lignes);
    const largeur = lignes > 0 ? Number(rows[0].taille) / lignes : null;
    detail[table] = {
      octets_par_ligne: largeur == null ? null : Math.round(largeur),
      methode: largeur == null ? "table_vide_ou_jamais_analysee" : "pg_total_relation_size/reltuples",
      octets_estimes: largeur == null ? null : Math.round(largeur * lignesAEcrire),
    };
    if (largeur == null) inconnu = true;
    else total += largeur * lignesAEcrire;
  }
  return { par_table: detail, octets_estimes: inconnu ? null : Math.round(total) };
}

/**
 * Construit le plan. LECTURE SEULE sur les tables RUM, sans exception.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {{kind: string, app: string, from: string, to: string, taille?: number}} demande
 */
export async function planifier(client, demande) {
  const kind = KINDS[demande.kind];
  if (!kind) {
    throw new ErreurPlan("kind_inconnu", `kind « ${demande.kind} » inconnu (${Object.keys(KINDS).join(", ")})`);
  }
  const app = demande.app;
  if (typeof app !== "string" || !app.trim()) {
    throw new ErreurPlan("app_obligatoire", "--app est obligatoire : une reprise ne s'applique jamais implicitement");
  }
  if (APP_INTERDITES.includes(app.trim().toLowerCase())) {
    throw new ErreurPlan(
      "app_globale_refusee",
      `« ${app} » n'est pas une application : une reprise d'historique se décide application par application`,
    );
  }
  const taille = tailleLot(demande.taille);
  const { from, to } = fenetre(demande.from, demande.to);

  const retention = await retentionApp(client, app);
  // LA FENÊTRE TIENT DANS LA RÉTENTION, ET LE REFUS EST ICI. Reconstruire des
  // lignes que la politique de rétention condamne, c'est écrire ce que la purge
  // de la nuit prochaine effacera — au mieux inutile, au pire une résurrection.
  if (Date.parse(from) < Date.parse(retention.cutoff)) {
    throw new ErreurPlan(
      "fenetre_hors_retention",
      `--from (${from}) précède la limite de rétention de « ${app} » (${retention.cutoff}, `
      + `${retention.jours} j, source : ${retention.source}). Borne basse admissible : ${retention.cutoff}.`,
    );
  }
  const dispo = await disponibiliteReelle(client, app, kind.sources);

  const cutoffs = await kind.bornes(client, { app, from, to });
  // Ce qui décide du travail entre dans l'empreinte : la taille de lot et la
  // rétention en font partie, pas la date de coupure (elle bouge avec `now()`).
  cutoffs._taille_lot = taille;
  cutoffs._retention_jours = retention.jours;
  const tables = [...new Set([...kind.sources.map((s) => s.table), ...kind.cibles])];
  const code_sha = empreinteCode();
  const schema_sha = await empreinteSchema(client, tables);

  const base = { app, from, to, cutoffs, taille, taille_lot: taille, retention_jours: retention.jours };
  const comptes = await kind.comptes(client, base, compter);
  const charge = await chargeAttendue(client, kind, base, comptes);
  const collisions = await kind.collisions(client, { app, from, to });

  const plan = {
    plan_version: 1,
    kind: kind.nom,
    app,
    from,
    to,
    taille_lot: taille,
    // ── Ce que la reprise lit et écrit ───────────────────────────────────────
    tables_sources: kind.sources.map((s) => ({ table: s.table, ordre: s.ordre, horodatage: s.ts })),
    tables_cibles: kind.cibles,
    cle_unique: kind.cleUnique,
    // ── Bornes hautes, et ce qu'elles ne prouvent pas ────────────────────────
    cutoffs,
    borne_haute_avertissement:
      "Un identifiant de séquence n'est PAS un ordre de commit : ces bornes ferment la fenêtre "
      + "historique, et le scan de réconciliation final (après drain des écritures en vol) rattrape "
      + "ce qui a été validé après leur relevé. Aucune de ces bornes n'est un instantané.",
    // ── Rétention réellement disponible ──────────────────────────────────────
    retention: {
      jours: retention.jours,
      source: retention.source,
      cutoff: retention.cutoff,
      // Le plan REFUSE une fenêtre qui déborde de la rétention : ce champ vaut
      // donc toujours 0 ici. Il reste rendu parce que le RUNNER, lui, peut voir
      // des lignes franchir la limite pendant une reprise longue, et les compte
      // sous le même nom.
      lignes_hors_retention: 0,
      donnees_reellement_presentes: dispo,
      note:
        "`cutoff` vient de la rétention de CETTE application, pas d'un défaut de 30 jours écrit "
        + "quelque part. `donnees_reellement_presentes` dit ce qui RESTE : après une purge ou un "
        + "effacement, une fenêtre peut être dans la rétention et pourtant vide.",
    },
    // ── Comptes, avec leur méthode ───────────────────────────────────────────
    comptes,
    // ── Coût ────────────────────────────────────────────────────────────────
    indexes: await indexesDe(client, tables),
    charge,
    espace: await espaceAttendu(client, kind.cibles, comptes.eligibles?.valeur ?? 0),
    // ── Ce qui coince ────────────────────────────────────────────────────────
    collisions,
    impossible: kind.impossible,
    // ── Signatures ──────────────────────────────────────────────────────────
    code_sha,
    schema_sha,
  };
  plan.plan_sha = empreintePlan(plan);
  return plan;
}

/** Taille de lot validée, ou l'erreur qui dit la borne franchie. */
export function tailleLot(valeur) {
  if (valeur == null) return LOT.defaut;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < LOT.min || n > LOT.max) {
    throw new ErreurPlan("taille_lot_invalide", `--batch doit être un entier entre ${LOT.min} et ${LOT.max}`);
  }
  return n;
}

/**
 * Charge attendue, MESURÉE pour ce qu'elle peut l'être et dite inconnue ailleurs.
 *
 * Le plan est en lecture seule : il peut chronométrer la LECTURE d'un lot, pas
 * son écriture. La durée annoncée est donc un plancher explicitement étiqueté —
 * jamais une promesse de durée totale.
 */
export async function chargeAttendue(client, kind, plan, comptes) {
  const eligibles = comptes.eligibles?.valeur ?? 0;
  const lots = Math.ceil(eligibles / plan.taille);
  const segment = kind.segments(plan)[0];
  const debut = process.hrtime.bigint();
  const contexte = kind.preparer
    ? await kind.preparer(client, { ...plan, phase: "fenetre" }, segment, null, plan.taille)
    : null;
  const echantillon = await kind.lire(client, { ...plan, phase: "fenetre" }, segment, null, plan.taille, contexte);
  const lectureMs = Number(process.hrtime.bigint() - debut) / 1e6;
  return {
    lots_estimes: lots,
    taille_lot: plan.taille,
    lignes_par_lot_mesurees: echantillon.lignes.length,
    duree_lecture_ms_par_lot: Math.round(lectureMs * 100) / 100,
    duree_lecture_totale_s: Math.round((lectureMs * lots) / 10) / 100,
    methode: "calibrage_lecture_seule",
    avertissement:
      "Plancher de lecture seule. Le coût d'écriture, la contention du verrou d'application (P8.1) "
      + "et le trafic concurrent ne sont PAS mesurés par un plan : ils le seront par le canari de P8.3.",
    cible_transaction_s: 2,
    travailleurs: "un par application",
  };
}
