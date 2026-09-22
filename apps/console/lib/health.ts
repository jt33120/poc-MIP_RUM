// Health score composite v0.3 (chantier B5) — formule documentée, 0-100 :
//   - 40 % vitals     : part des mesures notées 'good' sur la fenêtre, LCP pondéré x2
//                       (le LCP est le vital le plus corrélé au ressenti — et au créneau MIP)
//   - 30 % erreurs    : 1 - (erreurs JS / pages vues), plancher 0
//   - 20 % stabilité  : part des sessions de la fenêtre sans aucune erreur JS
//   - 10 % anomalies  : 10 pts - 2,5 pts par ligne v_anomaly des dernières 24 h, plancher 0
//                       (les anomalies sont TOUJOURS sur 24 h fixes, indépendamment de la période)
// Une composante sans donnée (0 mesure / 0 page vue / 0 session) est exclue et le score est
// renormalisé sur les composantes restantes. Tout sans donnée => score null.
// Libellés : Excellent >= 90 / Bon >= 75 / Dégradé >= 50 / Critique < 50.
import { q } from "./db";
import { type Filters } from "./filters";
import { compileScope, sessionJoin } from "./query-compiler";
import { conditionsOf } from "./query-contract";
import { sqlContext } from "./query-sql";
import { CORE_VITALS } from "./rating";

export type HealthLabel = "Excellent" | "Bon" | "Dégradé" | "Critique";

export function healthLabel(score: number): HealthLabel {
  return score >= 90 ? "Excellent" : score >= 75 ? "Bon" : score >= 50 ? "Dégradé" : "Critique";
}

/** État de la pseudonymisation métier, affiché dans les surfaces admin. */
export function identityHashHealth(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  label: "ok" | "degraded";
} {
  const configured = typeof env.IDENTITY_HASH_SECRET === "string" && env.IDENTITY_HASH_SECRET.length > 0;
  return { configured, label: configured ? "ok" : "degraded" };
}

/** Vérifie aussi que la projection v66 est réellement présente. Fail-soft. */
export async function identityPersistenceHealth(env: NodeJS.ProcessEnv = process.env): Promise<{
  configured: boolean;
  schema: boolean;
  label: "ok" | "degraded";
}> {
  const secret = identityHashHealth(env).configured;
  try {
    const [row] = await q<{ columns_ok: boolean; constraints_ok: boolean }>(
      `select
        (select count(*) = 21 from information_schema.columns where table_schema='public' and (
          (table_name='rum_session' and column_name = any(array['user_id_hash','account_id_hash','context'])) or
          (table_name in ('rum_event','rum_event_index') and column_name = any(array[
            'event_type','context','user_id_hash','account_id_hash','view_id','view_name','action_id','timing_ms','feature_flag_value'
          ])))) as columns_ok,
        (select count(*) = 3 from pg_constraint where conname = any(array[
          'rum_session_identity_hashes_v66','rum_event_context_v66','rum_event_index_context_v66'
        ])) as constraints_ok`,
    );
    const schema = row?.columns_ok === true && row?.constraints_ok === true;
    return { configured: secret, schema, label: secret && schema ? "ok" : "degraded" };
  } catch {
    return { configured: secret, schema: false, label: "degraded" };
  }
}

/** État de la projection causale v67; le code d'ingestion reste compatible v66. */
export async function causalActionsHealth(): Promise<{
  schema: boolean;
  label: "ok" | "degraded";
}> {
  try {
    const [row] = await q<{ table_ok: boolean; columns_ok: boolean; policy_ok: boolean }>(
      `select
         to_regclass('public.rum_action') is not null as table_ok,
         (select count(*) = 14 from information_schema.columns
           where table_schema = 'public' and (
             (table_name = 'rum_action' and column_name = any(array[
               'action_id','span_id','session_id','app_id','type','name','route','context','ts'
             ])) or
             (table_name = 'rum_error' and column_name = 'action_id') or
             (table_name = 'rum_resource' and column_name = 'action_id') or
             (table_name = 'rum_breadcrumb' and column_name = any(array['action_id','route'])) or
             (table_name = 'rum_span' and column_name = 'action_id')
           )) as columns_ok,
         exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'rum_action'
                    and policyname = 'tenant_scope') as policy_ok`,
    );
    const schema = row?.table_ok === true && row?.columns_ok === true && row?.policy_ok === true;
    return { schema, label: schema ? "ok" : "degraded" };
  } catch {
    return { schema: false, label: "degraded" };
  }
}

export const HEALTH_CLASS: Record<HealthLabel, string> = {
  Excellent:
    "bg-good/10 text-good-ink border-good/30",
  // « Bon » sans être le vert d'un seuil web.dev : le bleu perf, qui suit le thème.
  Bon: "bg-perf/10 text-perf border-perf/30",
  Dégradé:
    "bg-warn/10 text-warn-ink border-warn/30",
  Critique: "bg-bad/10 text-bad-ink border-bad/30",
};

/** Couleur d'accent (anneau de score, texte) par libellé santé. */
export const HEALTH_ACCENT: Record<HealthLabel, string> = {
  Excellent: "text-good-ink",
  Bon: "text-perf",
  Dégradé: "text-warn-ink",
  Critique: "text-bad-ink",
};

export interface HealthFactor {
  key: "vitals" | "errors" | "stability" | "anomalies";
  label: string;
  detail: string; // valeurs brutes lisibles (ex : "112/122 mesures good")
  earned: number | null; // points obtenus ; null = pas de donnée (composante exclue)
  max: number;
  /** Ce que la jauge écrit quand `earned` est null (« non testable »), à la place de « n/a ». */
  raisonNull?: string;
}

/** Pénalité d'une anomalie, sur les 10 points de la composante. */
export const PENALTY_PER_ANOMALY = 2.5;

/**
 * La composante « Anomalies » du score de santé — PURE (P*.1, incrément 0-c).
 *
 * « Aucune anomalie détectée » valait 10/10 même quand la détection n'avait rien
 * pu TESTER : v_anomaly n'examine une route qu'à partir de 5 heures de mesures LCP
 * sur 8 jours et d'un écart-type non nul (migration-v03). À 30 sessions par jour,
 * c'est souvent aucune — et « testé, rien trouvé » se lisait comme « pas testable ».
 * Sans route éligible, la composante vaut `null` : elle sort du score, qui se
 * renormalise sur les autres, et l'écran dit pourquoi.
 */
export function facteurAnomalies(entree: {
  filtree: boolean;
  /** Routes que v_anomaly a pu tester ; null si la détection n'a pas pu être lue. */
  eligibles: number | null;
  anomalies: number;
}): HealthFactor {
  const base = { key: "anomalies" as const, label: "Anomalies LCP (24 h)", max: 10 };
  if (entree.filtree) {
    return {
      ...base,
      detail: "non comptées sous filtre : la détection ne connaît que l'app et la route",
      earned: null,
      raisonNull: "sous filtre",
    };
  }
  if (entree.eligibles == null) {
    // Vue absente OU lecture en échec : on ne sait pas lequel, et on ne l'affirme pas.
    return { ...base, detail: "non testable : la détection d'anomalies n'a pas pu être lue", earned: null, raisonNull: "non testable" };
  }
  if (entree.eligibles === 0) {
    return {
      ...base,
      detail: "non testable : 0 route avec 5 heures de mesures LCP sur 8 jours",
      earned: null,
      raisonNull: "non testable",
    };
  }
  const ratio = Math.max(0, 1 - (PENALTY_PER_ANOMALY / 10) * entree.anomalies);
  return {
    ...base,
    detail: entree.anomalies
      ? `${entree.anomalies} anomalie(s), -${PENALTY_PER_ANOMALY} pt(s) chacune`
      : `aucune anomalie détectée sur ${entree.eligibles} route(s) testable(s)`,
    earned: round1(10 * ratio),
  };
}

export interface AnomalyRow {
  app_id: string;
  route: string | null;
  bucket: Date;
  p75: number;
  mean_7d: number;
  z_score: number;
}

export interface Health {
  score: number | null; // null = données insuffisantes
  label: HealthLabel | null;
  factors: HealthFactor[];
  anomalies: AnomalyRow[];
}


/**
 * Calcule le health score sur la requête commune (plage, périmètre, filtres). Les
 * anomalies restent sur 24 h fixes et ne connaissent que l'app : sous un filtre de
 * population, leur composante est EXCLUE (et le score renormalisé) plutôt que
 * comptée au nom d'une population qu'elle ne filtre pas.
 */
export async function healthScore(f: Filters): Promise<Health> {
  const sql = await sqlContext(f);
  const vitaux = sql.bind(CORE_VITALS);
  const vitals = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });

  // part de mesures 'good', LCP pondéré x2
  const [v] = await q<{ good_w: number; total_w: number }>(
    `select coalesce(sum(case when x.rating = 'good' then x.w else 0 end), 0)::float as good_w,
            coalesce(sum(x.w), 0)::float as total_w
     from (
       select m.rating, case when m.name = 'LCP' then 2 else 1 end as w
       from rum_metric m
       ${sessionJoin("m", "s")}
       -- Les phases réseau (DNS, TCP, TLS…) partagent ce canal et n'ont pas de
       -- seuil Google : sans ce filtre elles comptent au dénominateur sans
       -- pouvoir atteindre le numérateur, et le score est plafonné.
       where m.name = any(${vitaux}::text[])${vitals}
     ) x`,
    sql.params,
  );

  // erreurs / pages vues / sessions propres, même plage et mêmes filtres
  const comptes = await sqlContext(f);
  const pageviews = comptes.where({ dataset: "views", row: "p", session: "s", time: "p.started_at" });
  const errors = comptes.where({ dataset: "errors", row: "e", session: "s", time: "e.ts" });
  const sessions = comptes.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at" });
  const propres = comptes.where({ dataset: "sessions", row: "s", session: "s", time: "s.last_seen_at" });
  const debut = comptes.bind(comptes.query.range.from);
  const fin = comptes.bind(comptes.query.range.to);
  const [c] = await q<{ pageviews: number; errors: number; sessions: number; clean_sessions: number }>(
    `select
       (select count(*)::int from rum_pageview p
         ${sessionJoin("p", "s")}
         where true${pageviews}) as pageviews,
       (select coalesce(sum(e.occurrences), 0)::int from rum_error e
         ${sessionJoin("e", "s")}
         where true${errors}) as errors,
       (select count(*)::int from rum_session s where true${sessions}) as sessions,
       (select count(*)::int from rum_session s
         where true${propres}
           and not exists (select 1 from rum_error e
                            where e.app_id = s.app_id and e.session_id = s.session_id
                              and e.ts >= ${debut}::timestamptz and e.ts < ${fin}::timestamptz)) as clean_sessions`,
    comptes.params,
  );

  // anomalies LCP : 24 h FIXES (la vue est horaire vs 7 j glissants), app seulement.
  const filtree = conditionsOf(sql.query.filters).length > 0;
  let anomalies: AnomalyRow[] = [];
  // Routes que la vue a pu TESTER : sa garde (≥ 5 heures sur 8 jours, écart-type
  // non nul) recopiée de migration-v03, sur le même périmètre.
  let eligibles: number | null = null;
  if (!filtree) {
    try {
      // Un contexte par requête : les paramètres liés s'accumulent dans le contexte,
      // et une seconde requête sur le même aurait reçu ceux de la première.
      const garde = await sqlContext(f);
      const [e] = await q<{ eligibles: number }>(
        `with h as (
           select m.app_id, m.route, date_trunc('hour', m.ts) as bucket,
                  percentile_cont(0.75) within group (order by m.value) as p75
           from rum_metric m
           where m.name = 'LCP' and m.ts > now() - interval '8 days'
             and m.ts < date_trunc('hour', now())${compileScope(garde.query, "m.app_id", garde.bind)}
           group by 1, 2, 3
         )
         select count(*)::int as eligibles
         from (select 1 from h group by app_id, route having count(*) >= 5 and stddev_samp(p75) > 0) x`,
        garde.params,
      );
      eligibles = e?.eligibles ?? 0;
      const vue = await sqlContext(f);
      anomalies = await q<AnomalyRow>(
        `select app_id, route, bucket, p75::float as p75, mean_7d::float as mean_7d, z_score::float as z_score
         from v_anomaly v
         where bucket > now() - interval '24 hours'${compileScope(vue.query, "v.app_id", vue.bind)}
         order by abs(z_score) desc, bucket desc
         limit 20`,
        vue.params,
      );
    } catch {
      // vue v_anomaly absente (migration v0.3 pas encore appliquée) : l'Overview reste
      // rendable, et la composante dit « non testable » au lieu de « rien trouvé ».
      eligibles = null;
      anomalies = [];
    }
  }

  const vitalsRatio = v.total_w > 0 ? v.good_w / v.total_w : null;
  const errorsRatio =
    c.pageviews > 0 ? Math.max(0, 1 - c.errors / c.pageviews) : c.errors > 0 ? 0 : null;
  const stabilityRatio = c.sessions > 0 ? c.clean_sessions / c.sessions : null;

  const factors: HealthFactor[] = [
    {
      key: "vitals",
      label: "Web Vitals",
      detail:
        vitalsRatio == null
          ? "aucune mesure"
          : `${Math.round(vitalsRatio * 100)} % de mesures « good » (pondéré, LCP x2)`,
      earned: vitalsRatio == null ? null : round1(40 * vitalsRatio),
      max: 40,
    },
    {
      key: "errors",
      label: "Erreurs JS",
      detail:
        errorsRatio == null
          ? "aucune page vue"
          : `${c.errors} erreur(s) / ${c.pageviews} page(s) vue(s)`,
      earned: errorsRatio == null ? null : round1(30 * errorsRatio),
      max: 30,
    },
    {
      key: "stability",
      label: "Stabilité des sessions",
      detail:
        stabilityRatio == null
          ? "aucune session"
          : `${c.clean_sessions}/${c.sessions} session(s) sans erreur`,
      earned: stabilityRatio == null ? null : round1(20 * stabilityRatio),
      max: 20,
    },
    facteurAnomalies({ filtree, eligibles, anomalies: anomalies.length }),
  ];

  // toutes les composantes "trafic" vides => pas de score (anomalies seules = pas significatif)
  if (vitalsRatio == null && errorsRatio == null && stabilityRatio == null) {
    return { score: null, label: null, factors, anomalies };
  }

  // renormalisation sur les composantes disposant de données
  const available = factors.filter((x) => x.earned != null);
  const earned = available.reduce((acc, x) => acc + (x.earned ?? 0), 0);
  const max = available.reduce((acc, x) => acc + x.max, 0);
  const score = Math.round((earned / max) * 100);
  return { score, label: healthLabel(score), factors, anomalies };
}

/** Facteurs qui coûtent le plus de points (>= 1 pt perdu), pour le bandeau. */
export function dominantFactors(h: Health): HealthFactor[] {
  return h.factors
    .filter((x) => x.earned != null && x.max - x.earned >= 1)
    .sort((a, b) => b.max - b.earned! - (a.max - a.earned!))
    .slice(0, 3);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
