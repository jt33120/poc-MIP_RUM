// LES EFFECTIFS D'UN GROUPE D'ERREURS, VALEUR PAR VALEUR — la lecture de
// `GET /api/v1/errors/{fingerprint}/overrepresentation` (servie par le service `api`
// seul). Le test lui-même (Fisher unilatéral, Benjamini-Hochberg) est dans
// `@mip/stats/surrepresentation` : ici, on ne fait que compter.
//
// UNE SEULE POPULATION : DES SESSIONS (RM6). La base : les sessions de l'app actives
// sur la période (dernière activité dans [from, to)), sous le contrat commun
// (appareil, dimensions, robots exclus par défaut) — celles que compte la Vue
// d'ensemble. Les touchées : celles de la base qui portent au moins une occurrence
// du groupe sur la même période. Une session à cinquante occurrences compte une
// fois ; une occurrence sans session (erreur backend) ne compte pas, faute de
// valeur de session à lui prêter.
//
// DES DIMENSIONS DE SESSION, ET ELLES SEULES. Navigateur, système, appareil, pays
// estimé et release de la session : une valeur par session. La route et la release
// de l'OCCURRENCE en sont exclues — une session en porte plusieurs, et la compter
// dans chacune ferait de la même session deux unités (RM6). Une valeur vide vaut
// « Inconnu », affichée et jamais testée (`@mip/stats`).
import { VALEUR_INCONNUE, type DimensionObservee } from "@mip/stats/surrepresentation";
import { q } from "./db";
import { queryOf } from "./filters";
import { resourceScope } from "./query-contract";
import { sqlContext } from "./query-sql";
import type { ErrorFilters, ErrorGroupRef } from "./queries-errors";

/** Les dimensions testées : une colonne de `rum_session` chacune (constantes de code). */
export const DIMENSIONS_SURREPRESENTATION = Object.freeze([
  { cle: "browser", colonne: "browser", libelle: "Navigateur" },
  { cle: "os", colonne: "os", libelle: "Système" },
  { cle: "device", colonne: "device_type", libelle: "Appareil" },
  { cle: "country", colonne: "geo_country", libelle: "Pays estimé" },
  { cle: "release", colonne: "release", libelle: "Release de la session" },
] as const);

/**
 * Valeurs rendues par dimension, les plus touchées d'abord. Six dimensions × douze
 * valeurs, c'était le cadrage du test (`@mip/stats/surrepresentation`) : vingt laisse
 * de la marge, et une valeur au-delà n'a presque jamais trois sessions touchées.
 */
export const VALEURS_MAX_PAR_DIMENSION = 20;

export interface EffectifsGroupe {
  totaux: { touches: number; base: number };
  dimensions: (DimensionObservee & { libelle: string })[];
}

interface Ligne {
  cle: string;
  valeur: string;
  n_base: number;
  n_touches: number;
}

/**
 * Les effectifs d'un groupe RÉSOLU (son app fait foi) sur la période et les filtres
 * du contrat. Une instruction, une photographie : base, touchées et dimensions
 * viennent du même balayage.
 */
export async function effectifsDuGroupe(ref: ErrorGroupRef, f: ErrorFilters): Promise<EffectifsGroupe> {
  const query = resourceScope(queryOf(f), ref.app_id);
  const sql = await sqlContext({ ...f, app: ref.app_id, query });
  const sessions = sql.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at" });
  const app = sql.bind(ref.app_id);
  const empreinte = sql.bind(ref.fingerprint);
  const de = sql.bind(query.range.from);
  const a = sql.bind(query.range.to);
  const inconnu = sql.bind(VALEUR_INCONNUE);
  const colonnes = DIMENSIONS_SURREPRESENTATION.map(
    (d) => `coalesce(nullif(s.${d.colonne}, ''), ${inconnu}::text) as ${d.cle}`,
  ).join(",\n              ");
  const parDimension = DIMENSIONS_SURREPRESENTATION.map(
    (d) =>
      `select '${d.cle}'::text as cle, ${d.cle} as valeur, count(*)::int as n_base,
              (count(*) filter (where touchee))::int as n_touches
         from base group by ${d.cle}`,
  ).join("\n       union all\n       ");
  const lignes = await q<Ligne>(
    `with touchees as (
       select distinct e.session_id
         from rum_error e
        where e.app_id = ${app} and e.fingerprint = ${empreinte} and e.session_id is not null
          and e.ts >= ${de}::timestamptz and e.ts < ${a}::timestamptz
     ),
     base as (
       select ${colonnes},
              (t.session_id is not null) as touchee
         from rum_session s
         left join touchees t on t.session_id = s.session_id
        where true${sessions}
     )
     select ''::text as cle, ''::text as valeur, count(*)::int as n_base,
            (count(*) filter (where touchee))::int as n_touches
       from base
       union all
       ${parDimension}`,
    sql.params,
  );
  const total = lignes.find((l) => l.cle === "");
  return {
    totaux: { touches: Number(total?.n_touches ?? 0), base: Number(total?.n_base ?? 0) },
    dimensions: DIMENSIONS_SURREPRESENTATION.map((d) => ({
      cle: d.cle,
      libelle: d.libelle,
      valeurs: lignes
        .filter((l) => l.cle === d.cle)
        .map((l) => ({ valeur: l.valeur, nTouches: Number(l.n_touches), nBase: Number(l.n_base) }))
        // Les plus touchées d'abord, puis les plus fréquentes ; la valeur tranche, par
        // code et non par locale : un ordre total, le même sur la console et le service.
        .sort((x, y) => y.nTouches - x.nTouches || y.nBase - x.nBase || (x.valeur < y.valeur ? -1 : x.valeur > y.valeur ? 1 : 0))
        .slice(0, VALEURS_MAX_PAR_DIMENSION),
    })),
  };
}
