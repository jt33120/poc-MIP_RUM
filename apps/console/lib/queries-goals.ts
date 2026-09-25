// Objectifs & conversions — couche I/O (Lot 8b, réécrite sur le contrat par F66,
// plan § 5.14.3).
//
// PÉRIMÈTRE (R-A, V7, § 5.14.0). Ces lectures filtraient l'app par une clause
// « app demandée, ou toutes si elle est nulle » : sous `app=all`, l'app demandée
// valait null et la clause laissait passer toutes les apps de la base, qu'elles
// soient ou non dans le périmètre du principal (la console lit en BYPASSRLS). Elles
// passent désormais par `sqlContext(f)`, qui lie les apps EFFECTIVES du principal ;
// `listGoals` prend ce périmètre, jamais une app demandée. `apps = []` : aucune ligne.
//
// UNE REQUÊTE. L'ancienne boucle (une requête par objectif, en série) disparaît :
// dénominateur et numérateurs sortent du même balayage, par une jointure sur
// `goal`. Le motif d'un objectif n'est jamais interpolé : c'est une COLONNE lue en
// base (`g.pattern`), comparée par `=` ou `position(… in …)` ; le type d'objectif
// choisit la table par une constante de code.
//
// POPULATION. Dénominateur : sessions distinctes ayant au moins une page vue sur
// `[from, to)`, filtres de population appliqués, bots exclus. Un objectif ne compte
// que des sessions de SON app (`g.app_id = p.app_id`) et se rapporte aux sessions de
// SON app : sous `app=all`, un objectif de A n'a pas pour dénominateur les sessions
// de B. Numérateur : sessions DU DÉNOMINATEUR ayant satisfait la condition — un
// taux reste une part (≤ 1) même pour une session qui n'a émis qu'un événement.
//
// Une lecture en échec LÈVE (F02) : l'écran l'enveloppe dans `lire()`.
import { q } from "./db";
import type { FiltersLike } from "./filters";
import type { GoalConversion, GoalDef } from "./goals";
import { conversionRate } from "./goals";
import { compileScope, sessionJoin } from "./query-compiler";
import { previousRange } from "./query-contract";
import { sqlContext, type SqlContext } from "./query-sql";

/** Objectifs du périmètre (apps effectives du principal), actifs d'abord. `null` : sans restriction. */
export async function listGoals(apps: string[] | null): Promise<GoalDef[]> {
  // `any('{}')` est faux : un principal sans app ne lit aucun objectif.
  return q<GoalDef>(
    `select id::int as id, app_id, name, kind, pattern, match_type, active
     from goal
     where ($1::text[] is null or app_id = any($1::text[]))
     order by active desc, name`,
    [apps],
  );
}

export interface GoalConversionLue extends GoalConversion {
  /** Dénominateur de l'objectif : sessions de la fenêtre dans SON app. */
  sessions: number;
  /** Dernière conversion lue sur la fenêtre (page vue ou événement) ; null sans conversion. */
  derniere: Date | string | null;
}

export interface GoalConversionsParAppareil {
  goal_id: number;
  /** `device_type` de la session ; null = « Inconnu » (V3), une ligne à part. */
  device: string | null;
  conversions: number;
  /** Sessions de la fenêtre dans l'app de l'objectif ET sur cet appareil. */
  sessions: number;
}

/**
 * Les CTE communes aux deux lectures : les sessions de la fenêtre (une ligne par
 * session, avec son appareil), les objectifs actifs du périmètre, et les
 * conversions (session du dénominateur × objectif satisfait).
 */
function ciblesObjectifs(sql: SqlContext, shift: boolean): string {
  const range = shift ? previousRange(sql.query.range) : undefined;
  const cible = (dataset: "views" | "custom_events", row: string, time: string) =>
    sql.where({ dataset, row, session: "s", time, ...(range ? { range } : {}) });
  // Les objectifs suivent le MÊME périmètre compilé que leurs sessions (apps
  // effectives ; sous « toutes », apps internes exclues comme leurs pages vues) :
  // un objectif listé a toujours un dénominateur lisible.
  const perimetre = compileScope(sql.query, "g.app_id", sql.bind);
  return `vues as (
       select distinct p.app_id, p.session_id, s.device_type
         from rum_pageview p
         ${sessionJoin("p", "s")}
        where true${cible("views", "p", "p.started_at")}
     ),
     objectifs as (
       select g.id, g.app_id, g.name, g.kind, g.pattern, g.match_type, g.active
         from goal g
        where g.active${perimetre}
     ),
     atteintes as (
       select g.id as goal_id, p.app_id, p.session_id, p.started_at as ts
         from objectifs g
         join rum_pageview p
           on p.app_id = g.app_id
          and case when g.match_type = 'contains' then position(g.pattern in coalesce(p.route, '')) > 0
                   else p.route = g.pattern end
         ${sessionJoin("p", "s")}
        where g.kind = 'pageview'${cible("views", "p", "p.started_at")}
       union all
       select g.id, ev.app_id, ev.session_id, ev.ts
         from objectifs g
         join rum_event ev
           on ev.app_id = g.app_id
          and case when g.match_type = 'contains' then position(g.pattern in coalesce(ev.name, '')) > 0
                   else ev.name = g.pattern end
         ${sessionJoin("ev", "s")}
        where g.kind = 'event'${cible("custom_events", "ev", "ev.ts")}
     ),
     conversions as (
       select a.goal_id, v.app_id, v.session_id, v.device_type, max(a.ts) as ts
         from atteintes a
         join vues v on v.app_id = a.app_id and v.session_id = a.session_id
        group by a.goal_id, v.app_id, v.session_id, v.device_type
     )`;
}

/**
 * Report de conversion, en UNE requête : sessions de la fenêtre (dénominateur
 * affiché) et, par objectif actif du périmètre, ses conversions, son dénominateur
 * (les sessions de son app), son taux et sa dernière conversion.
 *
 * `shift` (`cmp=prev`) : la même lecture sur la période précédente contiguë
 * (`previousRange`), même patron que `overviewStats(f, shift)`.
 */
export async function goalConversions(
  f: FiltersLike,
  shift = false,
): Promise<{ total: number; rows: GoalConversionLue[] }> {
  const sql = await sqlContext(f);
  const rows = await q<{
    total: number;
    id: number | null;
    app_id: string;
    name: string;
    kind: GoalDef["kind"];
    pattern: string;
    match_type: GoalDef["match_type"];
    active: boolean;
    sessions: number;
    conversions: number;
    derniere: Date | null;
  }>(
    `with ${ciblesObjectifs(sql, shift)},
     par_app as (select app_id, count(*)::int as sessions from vues group by app_id),
     lignes as (
       select g.id::int as id, g.app_id, g.name, g.kind, g.pattern, g.match_type, g.active,
              coalesce(d.sessions, 0)::int as sessions,
              count(c.session_id)::int as conversions,
              max(c.ts) as derniere
         from objectifs g
         left join par_app d on d.app_id = g.app_id
         left join conversions c on c.goal_id = g.id
        group by g.id, g.app_id, g.name, g.kind, g.pattern, g.match_type, g.active, d.sessions
     )
     select t.total, l.*
       from (select count(*)::int as total from vues) t
       left join lignes l on true
      order by l.conversions desc nulls last, l.name`,
    sql.params,
  );
  const total = rows[0]?.total ?? 0;
  return {
    total,
    rows: rows
      .filter((r) => r.id !== null)
      .map((r) => ({
        id: r.id as number,
        app_id: r.app_id,
        name: r.name,
        kind: r.kind,
        pattern: r.pattern,
        match_type: r.match_type,
        active: r.active,
        sessions: r.sessions,
        conversions: r.conversions,
        rate: conversionRate(r.conversions, r.sessions),
        derniere: r.derniere,
      })),
  };
}

/**
 * Conversions par appareil (G4), en UNE requête : même construction, groupée par
 * objectif et `device_type` ; le dénominateur est celui de l'appareil, dans l'app de
 * l'objectif. Un appareil sans session n'a pas de ligne (aucun taux à calculer).
 */
export async function goalConversionsByDevice(f: FiltersLike): Promise<GoalConversionsParAppareil[]> {
  const sql = await sqlContext(f);
  return q<GoalConversionsParAppareil>(
    `with ${ciblesObjectifs(sql, false)},
     par_appareil as (
       select app_id, device_type, count(*)::int as sessions from vues group by app_id, device_type
     )
     select g.id::int as goal_id, d.device_type as device, d.sessions,
            count(c.session_id)::int as conversions
       from objectifs g
       join par_appareil d on d.app_id = g.app_id
       left join conversions c on c.goal_id = g.id and c.device_type is not distinct from d.device_type
      group by g.id, d.device_type, d.sessions
      order by g.id, d.device_type nulls last`,
    sql.params,
  );
}
