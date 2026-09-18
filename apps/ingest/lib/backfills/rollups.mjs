// P8.2 — recalcul des agrégats horaires (besoin n° 1 de la spec).
//
// LE DÉFAUT À RÉPARER. Avant v64, la cellule « erreurs » de `rum_rollup_hourly`
// comptait des LIGNES. Le SDK compacte les répétitions d'une même erreur en une
// ligne portant `occurrences` : une erreur vue mille fois en comptait une. La
// v64 a corrigé le rafraîchissement — mais seulement pour les heures qu'il
// recalcule, c'est-à-dire les vingt-six dernières. Tout l'historique antérieur
// porte encore le compte de lignes.
//
// ════════════════ DEUX INTERDITS, QUI DÉCIDENT DE TOUT LE MODULE ═════════════
//
//   1. NE JAMAIS REMPLACER UN AGRÉGAT HISTORIQUE RESTANT PAR ZÉRO. Un bucket
//      dont les sources ont été purgées ou effacées ne se recalcule pas : la
//      recomputation rendrait zéro, et zéro n'est pas « inconnu ». Ce module
//      n'écrit une cellule que s'il a VU des lignes sources pour cette heure, ou
//      si la cellule existante est elle-même vide. Le reste est déclaré
//      impossible, compté et nommé.
//
//   2. LA MOYENNE DE p75 EST INTERDITE. Un percentile ne s'additionne pas. Deux
//      histogrammes ne se fusionnent que si leurs FRONTIÈRES et leur POPULATION
//      sont identiques ; sinon l'opération est déclarée impossible, pas
//      approchée. `fusionHistogrammesPossible` porte cette règle, et rien dans
//      ce fichier ne la contourne.
//
// ════════════════════════ UN ÉCART ASSUMÉ, ET DIT ════════════════════════════
//
// `refresh_rum_rollups` joint la session par `using (session_id)` — sans
// `app_id`. Deux applications qui émettent le même identifiant de session s'y
// échangent donc leur classe d'appareil. La règle dure du plan (§4) impose
// `app_id` lié dans CHAQUE requête : ce module joint sur (app_id, session_id).
// Sur les données où aucun identifiant de session n'est partagé entre deux
// applications — le cas normal — les deux calculs coïncident exactement. Là où
// ils divergent, c'est le rafraîchissement en place qui a tort, et le plan
// signale la collision au lieu de la corriger en silence.
import { ISO_US } from "./commun.mjs";

/** Les deux projections horaires, et la table qui les alimente. */
export const SOURCES = Object.freeze([
  { table: "rum_metric", ordre: "id", ts: "ts" },
  { table: "rum_error", ordre: "id", ts: "ts" },
  { table: "rum_pageview", ordre: "id", ts: "started_at" },
]);

/**
 * Compatibilité de DEUX histogrammes pré-agrégés. PURE, donc testable seule.
 *
 * On ne fusionne des seaux que si les frontières (le pas géométrique et le
 * plancher de `mip_seau`) ET la population (mêmes filtres : robots, pondération)
 * sont identiques. Sinon, le seau `k` de l'un et le seau `k` de l'autre ne
 * décrivent pas le même intervalle, ou pas la même population : les additionner
 * produirait une distribution qui n'a jamais existé, et le percentile qu'on en
 * tirerait serait faux sans être détectable.
 *
 * @returns {{possible: boolean, raison: string|null}}
 */
export function fusionHistogrammesPossible(a, b) {
  if (!a || !b) return { possible: false, raison: "histogramme_absent" };
  if (a.gamma !== b.gamma) return { possible: false, raison: "pas_geometrique_different" };
  if (a.plancher !== b.plancher) return { possible: false, raison: "plancher_different" };
  if (a.population !== b.population) return { possible: false, raison: "population_differente" };
  return { possible: true, raison: null };
}

/**
 * Percentile d'un histogramme issu de PLUSIEURS sources.
 *
 * Deux chemins, et un seul est autorisé :
 *   · frontières et population identiques → on additionne les EFFECTIFS par
 *     seau, puis on lit le percentile sur la distribution somme. Exact.
 *   · sinon → impossible. On ne moyenne pas les p75, on ne pondère pas les p75,
 *     on ne « rapproche » pas. On le dit.
 *
 * @returns {{possible: true, seaux: Map<number, number>} | {possible: false, raison: string}}
 */
export function fusionnerHistogrammes(parts) {
  if (!parts?.length) return { possible: false, raison: "aucun_histogramme" };
  const reference = parts[0];
  for (const part of parts.slice(1)) {
    const verdict = fusionHistogrammesPossible(reference, part);
    if (!verdict.possible) return { possible: false, raison: verdict.raison };
  }
  const seaux = new Map();
  for (const part of parts) {
    for (const [seau, effectif] of part.seaux) seaux.set(seau, (seaux.get(seau) ?? 0) + effectif);
  }
  return { possible: true, seaux };
}

/** Signature de frontières et de population du calcul COURANT (`mip_seau`, v61/v80). */
export async function signatureHistogramme(client) {
  const { rows } = await client.query(
    "select prosrc from pg_proc where proname = 'mip_seau'",
  );
  const src = rows[0]?.prosrc ?? "";
  const gamma = Number(src.match(/ln\(([\d.]+)\)/)?.[1] ?? NaN);
  const plancher = Number(src.match(/<=\s*([\d.]+)/)?.[1] ?? NaN);
  return {
    gamma,
    plancher,
    // La population de `metric_histogram_hourly` est fixée par
    // `refresh_metric_histogram` : core vitals, robots exclus, pondérée par le
    // poids d'échantillonnage de la session.
    population: "core_vitals_sans_robots_pondere_v80",
  };
}

const heures = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000));

export const ROLLUPS = {
  nom: "rollups",
  sources: SOURCES,
  cibles: ["rum_rollup_hourly", "metric_histogram_hourly"],
  cleUnique: "rum_rollup_hourly (app_id, device_type, hour) et metric_histogram_hourly (app_id, device_type, name, hour, bucket)",

  /** Un segment par projection. Les heures sont le curseur À L'INTÉRIEUR. PUR. */
  segments() {
    return [{ nom: "rum_rollup_hourly" }, { nom: "metric_histogram_hourly" }];
  },

  async bornes(client, { app, from, to }) {
    const out = {};
    for (const s of SOURCES) {
      const { rows } = await client.query(
        `select coalesce(max(id), 0)::text as borne, count(*)::bigint as lignes,
                coalesce(sum(${s.table === "rum_error" ? "occurrences" : "1"}), 0)::bigint as occurrences
           from ${s.table}
          where app_id = $1 and ${s.ts} >= $2::timestamptz and ${s.ts} < $3::timestamptz`,
        [app, from, to],
      );
      out[s.table] = {
        ordre: s.ordre,
        borne_haute: rows[0].borne,
        lignes_sous_la_borne: Number(rows[0].lignes),
        occurrences_sous_la_borne: Number(rows[0].occurrences),
      };
    }
    out._histogramme = await signatureHistogramme(client);
    return out;
  },

  /**
   * Comptes du plan, en HEURES et en OCCURRENCES.
   *
   * L'unité de ce `kind` n'est pas la ligne : c'est la cellule horaire. Et la
   * grandeur qui décide de l'écart à réparer n'est pas non plus la ligne, c'est
   * `sum(occurrences)` — dire « 12 000 lignes » ici laisserait croire que le
   * compte actuel est presque bon.
   */
  async comptes(client, plan, compter) {
    const { app, from, to } = plan;
    const { rows: cellules } = await client.query(
      `with sources as (
         select date_trunc('hour', ts) as hour from rum_metric
          where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz
         union select date_trunc('hour', ts) from rum_error
          where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz
         union select date_trunc('hour', started_at) from rum_pageview
          where app_id = $1 and started_at >= $2::timestamptz and started_at < $3::timestamptz
       ), existantes as (
         select hour, (good_w + total_w + pageviews + errors) > 0 as non_vide
           from rum_rollup_hourly
          where app_id = $1 and hour >= $2::timestamptz and hour < $3::timestamptz
       )
       select
         (select count(*) from sources)::bigint                                          as heures_avec_sources,
         (select count(distinct hour) from existantes)::bigint                           as heures_agregees,
         (select count(distinct e.hour) from existantes e
           where e.non_vide and not exists (select 1 from sources s where s.hour = e.hour))::bigint
                                                                                         as heures_sans_source_mais_non_vides`,
      [app, from, to],
    );
    const ecart = await client.query(
      `select coalesce(sum(occurrences), 0)::bigint as occurrences, count(*)::bigint as lignes
         from rum_error where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz`,
      [app, from, to],
    );
    const compteDurable = await compter(client, {
      ...plan,
      sqlCompte: `select count(*)::bigint as n from rum_metric
                   where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz`,
      sqlHeure: `select count(*)::bigint as n from rum_metric
                  where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz`,
    });
    const avecSources = Number(cellules[0].heures_avec_sources);
    const purgees = Number(cellules[0].heures_sans_source_mais_non_vides);
    return {
      methode: "exact",
      unite: "cellule horaire",
      eligibles: { valeur: avecSources, methode: "exact", quoi: "heures pour lesquelles des sources subsistent" },
      deja_presentes: { valeur: Number(cellules[0].heures_agregees), quoi: "heures déjà présentes dans rum_rollup_hourly" },
      id_source_nul: { valeur: 0, quoi: "sans objet : l'agrégat est identifié par (app, device, heure), pas par un span" },
      hors_retention: { valeur: 0, quoi: "le plan refuse une fenêtre antérieure à la rétention" },
      heures_de_la_fenetre: heures(from, to),
      sources_purgees: {
        valeur: purgees,
        consequence:
          "Recalcul IMPOSSIBLE pour ces heures : les sources n'existent plus. L'agrégat restant est "
          + "CONSERVÉ tel quel — le remplacer par zéro transformerait « inconnu » en « rien ».",
      },
      occurrences: {
        somme: Number(ecart.rows[0].occurrences),
        lignes: Number(ecart.rows[0].lignes),
        ecart: Number(ecart.rows[0].occurrences) - Number(ecart.rows[0].lignes),
        quoi:
          "`observed` est le défaut : la cellule « erreurs » vaut sum(occurrences). L'écart est "
          + "exactement ce que le compte de lignes d'avant v64 sous-comptait.",
      },
      mesures: compteDurable,
    };
  },

  async collisions(client, { app, from, to }) {
    const out = [];
    // L'écart assumé ci-dessus, chiffré : combien de sessions de cette fenêtre
    // portent un identifiant que porte AUSSI une autre application ?
    const { rows } = await client.query(
      `select count(*)::bigint as n from rum_session a
        where a.app_id = $1 and a.last_seen_at >= $2::timestamptz and a.last_seen_at < $3::timestamptz
          and exists (select 1 from rum_session b where b.session_id = a.session_id and b.app_id <> a.app_id)`,
      [app, from, to],
    );
    if (Number(rows[0].n) > 0) {
      out.push({
        genre: "session_partagee_entre_apps",
        lignes: Number(rows[0].n),
        consequence:
          "`refresh_rum_rollups` joint la session sans app_id : sur ces sessions, sa classe "
          + "d'appareil vient peut-être de l'autre application. Ce module joint sur (app_id, "
          + "session_id) — le recalcul les déplacera donc vers la bonne classe.",
      });
    }
    // Un histogramme dont les frontières courantes ne décrivent pas les seaux
    // déjà stockés : le plan le dit AVANT qu'on propose de les fusionner.
    const signature = await signatureHistogramme(client);
    if (!Number.isFinite(signature.gamma) || !Number.isFinite(signature.plancher)) {
      out.push({
        genre: "frontieres_histogramme_illisibles",
        consequence:
          "Les frontières de `mip_seau` n'ont pas pu être relevées : toute fusion d'histogrammes est "
          + "déclarée impossible, et le recalcul depuis les mesures reste la seule voie.",
      });
    }
    return out;
  },

  /**
   * Lit les heures à recalculer, DANS la transaction de l'appelant.
   *
   * Une « ligne » de ce lot est UNE HEURE, et le curseur est cette heure. Un lot
   * de 1 000 heures couvre quarante et un jours : la transaction reste courte
   * parce que le recalcul d'une heure est une agrégation indexée, pas un
   * parcours de table.
   */
  async lire(client, plan, seg, curseur, taille) {
    const histogramme = seg?.nom === "metric_histogram_hourly";
    const debut = curseur ?? plan.from;
    const { rows } = await client.query(
      histogramme
        ? `select to_char(h at time zone 'UTC', ${ISO_US}) as heure,
                  exists (select 1 from rum_metric m
                           where m.app_id = $1 and m.ts >= h and m.ts < h + interval '1 hour'
                             and m.name = any(mip_core_vitals())) as _sources,
                  exists (select 1 from metric_histogram_hourly x
                           where x.app_id = $1 and x.hour = h and x.observed_count > 0) as _non_vide
             from generate_series(date_trunc('hour', $2::timestamptz), $3::timestamptz - interval '1 hour',
                                  interval '1 hour') as h
            where ($4::timestamptz is null or h > $4::timestamptz)
            order by h limit $5`
        : `select to_char(h at time zone 'UTC', ${ISO_US}) as heure,
                  (exists (select 1 from rum_metric m where m.app_id = $1 and m.ts >= h and m.ts < h + interval '1 hour')
                   or exists (select 1 from rum_error e where e.app_id = $1 and e.ts >= h and e.ts < h + interval '1 hour')
                   or exists (select 1 from rum_pageview p where p.app_id = $1 and p.started_at >= h and p.started_at < h + interval '1 hour')
                  ) as _sources,
                  exists (select 1 from rum_rollup_hourly x
                           where x.app_id = $1 and x.hour = h
                             and (x.good_w + x.total_w + x.pageviews + x.errors) > 0) as _non_vide
             from generate_series(date_trunc('hour', $2::timestamptz), $3::timestamptz - interval '1 hour',
                                  interval '1 hour') as h
            where ($4::timestamptz is null or h > $4::timestamptz)
            order by h limit $5`,
      [plan.app, plan.from, plan.to, curseur ?? null, taille],
    );
    const skips = {};
    const lignes = [];
    for (const r of rows) {
      if (!r._sources) {
        if (r._non_vide) {
          // LA RÈGLE : un agrégat historique restant ne devient pas zéro.
          skips.sources_purgees_agregat_conserve = (skips.sources_purgees_agregat_conserve ?? 0) + 1;
        } else {
          skips.heure_sans_donnee = (skips.heure_sans_donnee ?? 0) + 1;
        }
        continue;
      }
      lignes.push({ heure: r.heure, cible: seg.nom });
    }
    return {
      lignes,
      scanned: rows.length,
      skips,
      curseur: rows.length ? rows[rows.length - 1].heure : (curseur ?? debut),
      fini: rows.length < taille,
    };
  },

  /**
   * Remplace ATOMIQUEMENT l'agrégat des heures du lot : vidage puis réécriture,
   * dans la même transaction que le curseur.
   *
   * `delete` puis `insert`, et non `on conflict do update` : une cellule dont
   * plus aucune ligne ne relève — une classe d'appareil disparue après un
   * effacement — survivrait à une simple mise à jour avec son ancien effectif.
   * C'est la correction que v81 a déjà apportée à `refresh_rum_rollups` ; on ne
   * la défait pas ici.
   */
  async ecrire(client, plan, seg, lignes) {
    if (!lignes.length) return { written: 0, skips: {} };
    const heuresDuLot = lignes.map((l) => l.heure);
    if (seg.nom === "metric_histogram_hourly") {
      await client.query(
        `delete from metric_histogram_hourly
          where app_id = $1 and hour = any($2::timestamptz[])`,
        [plan.app, heuresDuLot],
      );
      const { rowCount } = await client.query(
        `insert into metric_histogram_hourly (app_id, device_type, name, hour, bucket, weighted_count, observed_count)
         select m.app_id, coalesce(s.device_type, ''), m.name, date_trunc('hour', m.ts), mip_seau(m.value),
                sum(coalesce(s.weight, 1))::double precision, count(*)::bigint
           from rum_metric m
           left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
          where m.app_id = $1 and date_trunc('hour', m.ts) = any($2::timestamptz[])
            and m.name = any(mip_core_vitals())
            and not coalesce(s.is_bot, false)
          group by 1, 2, 3, 4, 5`,
        [plan.app, heuresDuLot],
      );
      await leverMarques(client, plan.app, "metric_histogram_hourly", heuresDuLot);
      return { written: rowCount ?? 0, skips: {} };
    }
    await client.query(
      "delete from rum_rollup_hourly where app_id = $1 and hour = any($2::timestamptz[])",
      [plan.app, heuresDuLot],
    );
    const { rowCount } = await client.query(
      `with agg as (
         select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
                sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
                sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
                0::bigint as pageviews, 0::bigint as errors
           from rum_metric m
           left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
          where m.app_id = $1 and date_trunc('hour', m.ts) = any($2::timestamptz[])
            and m.name = any(mip_core_vitals())
          group by 1, 2, 3
         union all
         select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
                0::float, 0::float, count(*)::bigint, 0::bigint
           from rum_pageview p
           left join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
          where p.app_id = $1 and date_trunc('hour', p.started_at) = any($2::timestamptz[])
          group by 1, 2, 3
         union all
         -- sum(occurrences), JAMAIS count(*) : c'est tout l'objet de ce kind.
         select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
                0::float, 0::float, 0::bigint, coalesce(sum(e.occurrences), 0)::bigint
           from rum_error e
           left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id
          where e.app_id = $1 and date_trunc('hour', e.ts) = any($2::timestamptz[])
          group by 1, 2, 3
       )
       insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
       select app_id, device_type, hour, sum(good_w), sum(total_w), sum(pageviews), sum(errors)
         from agg group by 1, 2, 3`,
      [plan.app, heuresDuLot],
    );
    await leverMarques(client, plan.app, "rum_rollup_hourly", heuresDuLot);
    return { written: rowCount ?? 0, skips: {} };
  },

  /**
   * Vérification indépendante : les cellules stockées sont-elles celles que les
   * sources produisent AUJOURD'HUI ?
   *
   * Elle recompte tout depuis les sources et compare. Elle ne lit ni le curseur
   * ni les compteurs de l'exécution : un runner qui se tromperait de compte ne
   * pourrait pas se vérifier lui-même.
   */
  async verifier(client, plan) {
    const { rows } = await client.query(
      `with attendu as (
         select app_id, device_type, hour, sum(good_w) as good_w, sum(total_w) as total_w,
                sum(pageviews) as pageviews, sum(errors) as errors from (
           select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
                  sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
                  sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
                  0::bigint as pageviews, 0::bigint as errors
             from rum_metric m left join rum_session s on s.app_id = m.app_id and s.session_id = m.session_id
            where m.app_id = $1 and m.ts >= $2::timestamptz and m.ts < $3::timestamptz
              and m.name = any(mip_core_vitals()) group by 1, 2, 3
           union all
           select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at), 0::float, 0::float,
                  count(*)::bigint, 0::bigint
             from rum_pageview p left join rum_session s on s.app_id = p.app_id and s.session_id = p.session_id
            where p.app_id = $1 and p.started_at >= $2::timestamptz and p.started_at < $3::timestamptz group by 1, 2, 3
           union all
           select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts), 0::float, 0::float, 0::bigint,
                  coalesce(sum(e.occurrences), 0)::bigint
             from rum_error e left join rum_session s on s.app_id = e.app_id and s.session_id = e.session_id
            where e.app_id = $1 and e.ts >= $2::timestamptz and e.ts < $3::timestamptz group by 1, 2, 3
         ) u group by 1, 2, 3
       ), stocke as (
         select * from rum_rollup_hourly
          where app_id = $1 and hour >= $2::timestamptz and hour < $3::timestamptz
       )
       select
         count(*) filter (where s.hour is null)::bigint                                   as manquantes,
         count(*) filter (where a.hour is null)::bigint                                   as sans_source,
         count(*) filter (where a.hour is not null and s.hour is not null
                            and (a.errors <> s.errors or a.pageviews <> s.pageviews
                                 or abs(a.good_w - s.good_w) > 1e-9 or abs(a.total_w - s.total_w) > 1e-9))::bigint as divergentes,
         coalesce(sum(a.errors), 0)::bigint                                               as occurrences_attendues,
         coalesce(sum(s.errors), 0)::bigint                                               as occurrences_stockees
       from attendu a full join stocke s using (app_id, device_type, hour)`,
      [plan.app, plan.from, plan.to],
    );
    return {
      cellules_manquantes: Number(rows[0].manquantes),
      cellules_sans_source: Number(rows[0].sans_source),
      cellules_divergentes: Number(rows[0].divergentes),
      occurrences_attendues: Number(rows[0].occurrences_attendues),
      occurrences_stockees: Number(rows[0].occurrences_stockees),
      note_sans_source:
        "`cellules_sans_source` est attendu et non corrigé : sources purgées ou effacées. Les "
        + "remplacer par zéro serait un mensonge ; les supprimer effacerait le seul témoignage "
        + "restant de ce trafic.",
    };
  },

  impossible: Object.freeze([
    {
      quoi: "les heures dont les sources sont purgées ou effacées",
      raison:
        "Un agrégat se recalcule depuis ses lignes. Sans elles, le recalcul rendrait zéro — et zéro "
        + "n'est pas « inconnu ». L'agrégat restant est conservé tel quel, et compté comme "
        + "non reconstructible.",
    },
    {
      quoi: "les occurrences qu'un ancien SDK n'a jamais envoyées",
      raison:
        "`sum(occurrences)` ne récupère que ce qui a été reçu. Une répétition compactée par un SDK "
        + "antérieur à la colonne `occurrences` vaut 1 en base : aucune requête SQL ne sait combien "
        + "de fois elle s'est réellement produite.",
    },
    {
      quoi: "un percentile historique par moyenne de p75",
      raison:
        "Un percentile ne s'additionne pas. Les histogrammes ne se fusionnent que si leurs "
        + "frontières et leur population sont identiques ; sinon l'opération est déclarée "
        + "impossible, jamais approchée.",
    },
  ]),
};

/**
 * Lève les marques d'invalidation des heures RÉELLEMENT recalculées.
 *
 * Sous le verrou d'application de P8.1 — le runner l'a pris avant d'entrer ici :
 * une marque posée entre l'agrégation et cette levée disparaîtrait sans que
 * l'heure ait été recalculée, et la cellule fausse redeviendrait « digne de
 * foi ». C'est le défaut que v81 a fermé pour les rafraîchissements ; il se
 * refermerait ici si la levée sortait de la transaction.
 */
async function leverMarques(client, app, source, heuresDuLot) {
  await client.query(
    `delete from analytics_rollup_invalidation
      where app_id = $1 and source = $2 and hour = any($3::timestamptz[])`,
    [app, source, heuresDuLot],
  );
}
