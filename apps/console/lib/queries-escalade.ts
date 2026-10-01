// L'ESCALADE DES ALERTES (migration-v108) : lectures et écritures de la console.
//
// Trois choses, et rien d'autre :
//   · les ÉTAPES de la politique (`alert_escalation_step`) — lues par l'écran,
//     créées et supprimées par les commandes `creerEtapeEscalade` et
//     `supprimerEtapeEscalade` (`lib/commandes/alertes.ts`) ;
//   · ce que l'escalade a fait d'un déclenchement — son heure d'acquittement, le
//     niveau atteint et la dernière relance —, pour les lignes « À traiter » ;
//   · le délai médian d'acquittement (MTTA) sur 30 jours.
//
// LA CONSOLE PEUT PRÉCÉDER SA MIGRATION. Chaque lecture le vérifie
// (`escaladeDisponible`) ou lit les colonnes de v108 par `to_jsonb(…)` : une clé
// absente vaut NULL, là où nommer la colonne ferait échouer l'écran (42703).
import { q } from "./db";
import { ecrire, type ClientEcriture } from "./requete";
import { queryOf, type FiltersLike } from "./filters";
import { binder, compileScope } from "./query-compiler";

/** v108 appliquée ? Détectée par sa table, comme v73 par la sienne. Aucune mise en cache. */
export async function escaladeDisponible(client?: ClientEcriture): Promise<boolean> {
  const texte = "select to_regclass('public.alert_escalation_step') is not null as v108";
  const rows = client ? (await client.query<{ v108: boolean }>(texte)).rows : await q<{ v108: boolean }>(texte);
  return rows[0]?.v108 === true;
}

// ─── Les étapes ─────────────────────────────────────────────────────────────

export interface EtapeEscaladeRow {
  id: number;
  /** `null` : toutes les applications. */
  app_id: string | null;
  severity_min: string;
  level: number;
  delay_minutes: number;
  channel_id: number;
  repeat_minutes: number | null;
  repeat_max: number | null;
  created_at: Date | string;
  created_by: string | null;
  /** Le canal visé, tel qu'il est aujourd'hui. */
  canal_kind: string;
  canal_target: string;
  canal_actif: boolean;
  /** Envois mis en file par cette étape sur 30 jours (relances comprises). */
  envois_30j: number;
}

/** Les étapes de l'écran : `disponible: false` tant que la base n'a pas v108. */
export interface LectureEtapes {
  disponible: boolean;
  etapes: EtapeEscaladeRow[];
}

/**
 * Les étapes globales (toutes les applications) et celles des applications du
 * périmètre, comme les canaux (`listChannels`) : par portée, niveau, délai.
 */
export async function listEtapesEscalade(f: FiltersLike): Promise<LectureEtapes> {
  if (!(await escaladeDisponible())) return { disponible: false, etapes: [] };
  const { params, bind } = binder();
  const etapes = await q<EtapeEscaladeRow>(
    `select st.id::int as id, st.app_id, st.severity_min, st.level::int as level, st.delay_minutes,
            st.channel_id::int as channel_id, st.repeat_minutes, st.repeat_max, st.created_at, st.created_by,
            c.kind as canal_kind, c.target as canal_target, c.active as canal_actif,
            (select count(*) from alert_delivery d
              where d.escalation_step_id = st.id and d.attempted_at >= now() - interval '30 days')::int as envois_30j
       from alert_escalation_step st
       join notify_channel c on c.id = st.channel_id
      where st.app_id is null or (true${compileScope(queryOf(f), "st.app_id", bind)})
      order by st.app_id nulls first, st.level, st.delay_minutes, st.id`,
    params,
  );
  return { disponible: true, etapes };
}

export interface EtapeEscaladeInput {
  app_id: string | null;
  severity_min: string;
  level: number;
  delay_minutes: number;
  channel_id: number;
  repeat_minutes: number | null;
  repeat_max: number | null;
  created_by: string;
}

/**
 * Crée une étape, ou rend `null` si son canal n'existe pas ou n'est pas à sa portée :
 * une étape d'application envoie vers un canal de CETTE application ou global ; une
 * étape globale, vers un canal global seulement — jamais les alertes de toutes les
 * applications vers le canal de l'une d'elles. Le contrôle est dans l'insertion même
 * (`insert … select … where`) : il ne peut pas être contourné par une course.
 */
export async function insertEtapeEscalade(e: EtapeEscaladeInput, client?: ClientEcriture): Promise<string | null> {
  const { rows } = await ecrire<{ id: string }>(
    client,
    `insert into alert_escalation_step
       (app_id, severity_min, level, delay_minutes, channel_id, repeat_minutes, repeat_max, created_by)
     select $1, $2, $3, $4, c.id, $6, $7, $8
       from notify_channel c
      where c.id = $5
        and (c.app_id is null or c.app_id = $1::text)
     returning id::text as id`,
    [e.app_id, e.severity_min, e.level, e.delay_minutes, e.channel_id, e.repeat_minutes, e.repeat_max, e.created_by],
  );
  return rows[0]?.id ?? null;
}

/**
 * Supprime l'étape `id` si elle est DANS le périmètre `apps` : d'une application de
 * la liste, ou — périmètre non restreint seulement — globale. Rend l'application de
 * l'étape supprimée, `undefined` si elle est introuvable ou hors périmètre
 * (indiscernables), comme `deleteChannel`.
 */
export async function deleteEtapeEscalade(
  id: number,
  apps: string[] | null,
  client?: ClientEcriture,
): Promise<{ app_id: string | null } | undefined> {
  const { rows } = await ecrire<{ app_id: string | null }>(
    client,
    `delete from alert_escalation_step
      where id = $1 and ($2::text[] is null or app_id = any($2::text[]))
      returning app_id`,
    [id, apps],
  );
  return rows[0];
}

// ─── Ce que l'escalade a fait d'un déclenchement ────────────────────────────

export interface SuiviDeclenchementRow {
  id: number;
  /** Heure de l'acquittement ; `null` : non acquitté, ou acquitté avant l'horodatage. */
  acknowledged_at: Date | string | null;
  acknowledged_by: string | null;
  /** Niveau d'escalade le plus haut atteint ; `null` : aucun envoi d'escalade. */
  niveau: number | null;
  /** Rang de la dernière relance à ce niveau ; 0 : son premier envoi seulement. */
  relance: number | null;
}

/**
 * Le suivi des déclenchements `ids`, DÉJÀ lus dans le périmètre par `alertEvents` :
 * aucune portée à rejouer ici, l'identifiant vient d'une lecture scopée.
 */
export async function suiviDesDeclenchements(ids: readonly number[]): Promise<SuiviDeclenchementRow[]> {
  if (ids.length === 0) return [];
  return q<SuiviDeclenchementRow>(
    `select e.id::int as id,
            (to_jsonb(e)->>'acknowledged_at')::timestamptz as acknowledged_at,
            to_jsonb(e)->>'acknowledged_by' as acknowledged_by,
            esc.niveau, esc.relance
       from alert_event e
       left join lateral (
         select (to_jsonb(d)->>'escalation_level')::int as niveau,
                (to_jsonb(d)->>'escalation_relance')::int as relance
           from alert_delivery d
          where d.alert_event_id = e.id and (to_jsonb(d)->>'escalation_level') is not null
          order by 1 desc, 2 desc
          limit 1
       ) esc on true
      where e.id = any($1::bigint[])`,
    [ids],
  );
}

// ─── Le délai médian d'acquittement ─────────────────────────────────────────

export interface Mtta {
  /** La base a-t-elle l'heure d'acquittement (v108) ? */
  disponible: boolean;
  /** Médiane du délai déclenchement → acquittement, en ms ; `null` sans acquittement. */
  mediane_ms: number | null;
  /** Acquittements comptés. */
  n: number;
  /** Déclenchements de la fenêtre nés après l'horodatage, acquittés ou non. */
  declenches: number;
}

/**
 * MTTA sur `jours` jours glissants : la médiane de `acknowledged_at − fired_at` sur
 * les déclenchements nés après v108 (`acquittement_horodate`) — un déclenchement
 * ancien acquitté aujourd'hui mesurerait l'absence d'horodatage, pas l'équipe. Même
 * périmètre que l'écran : l'application de la règle, du SLO ou de l'issue.
 */
export async function mttaAlertes(f: FiltersLike, jours = 30): Promise<Mtta> {
  if (!Number.isSafeInteger(jours) || jours < 1 || jours > 366) throw new Error(`fenêtre de jours invalide : ${jours}`);
  if (!(await escaladeDisponible())) return { disponible: false, mediane_ms: null, n: 0, declenches: 0 };
  const { params, bind } = binder();
  const pJours = bind(jours);
  const [r] = await q<{ mediane_ms: number | null; n: number; declenches: number }>(
    `select (percentile_cont(0.5) within group (order by ev.delai_ms)
               filter (where ev.delai_ms is not null))::float8 as mediane_ms,
            (count(*) filter (where ev.delai_ms is not null))::int as n,
            count(*)::int as declenches
       from (
         select coalesce(r.app_id, s.app_id,
                         (select n.app_id from error_issue_notification n where n.alert_event_id = ae.id limit 1)) as app_id,
                case when ae.acknowledged and ae.acknowledged_at is not null
                     then extract(epoch from (ae.acknowledged_at - ae.fired_at)) * 1000 end as delai_ms
           from alert_event ae
           left join alert_rule r on r.id = ae.rule_id
           left join slo s on s.id = ae.slo_id
          where ae.acquittement_horodate
            and ae.fired_at >= now() - make_interval(days => ${pJours}::int)
       ) ev
      where true${compileScope(queryOf(f), "ev.app_id", bind)}`,
    params,
  );
  return { disponible: true, mediane_ms: r?.mediane_ms ?? null, n: r?.n ?? 0, declenches: r?.declenches ?? 0 };
}
