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
import { type Filters, PERIODS } from "./filters";
import { CORE_VITALS } from "./rating";
import { internalClause } from "./queries";

export type HealthLabel = "Excellent" | "Bon" | "Dégradé" | "Critique";

export function healthLabel(score: number): HealthLabel {
  return score >= 90 ? "Excellent" : score >= 75 ? "Bon" : score >= 50 ? "Dégradé" : "Critique";
}

export const HEALTH_CLASS: Record<HealthLabel, string> = {
  Excellent:
    "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-400/30",
  Bon: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-400/10 dark:text-sky-300 dark:border-sky-400/30",
  Dégradé:
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30",
  Critique: "bg-red-100 text-red-800 border-red-300 dark:bg-red-400/10 dark:text-red-300 dark:border-red-400/30",
};

/** Couleur d'accent (anneau de score, texte) par libellé santé. */
export const HEALTH_ACCENT: Record<HealthLabel, string> = {
  Excellent: "text-emerald-500",
  Bon: "text-sky-500",
  Dégradé: "text-amber-500",
  Critique: "text-red-500",
};

export interface HealthFactor {
  key: "vitals" | "errors" | "stability" | "anomalies";
  label: string;
  detail: string; // valeurs brutes lisibles (ex : "112/122 mesures good")
  earned: number | null; // points obtenus ; null = pas de donnée (composante exclue)
  max: number;
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

const PENALTY_PER_ANOMALY = 2.5; // pts retirés (sur 10) par ligne v_anomaly 24 h

/** Calcule le health score sur les filtres globaux (anomalies = 24 h fixes, par app). */
export async function healthScore(f: Filters): Promise<Health> {
  const itv = PERIODS[f.period].interval;

  // part de mesures 'good', LCP pondéré x2
  const [v] = await q<{ good_w: number; total_w: number }>(
    `select coalesce(sum(case when x.rating = 'good' then x.w else 0 end), 0)::float as good_w,
            coalesce(sum(x.w), 0)::float as total_w
     from (
       select m.rating, case when m.name = 'LCP' then 2 else 1 end as w
       from rum_metric m
       left join rum_session s using (session_id)
       where m.ts > now() - interval '${itv}'
         -- Les phases réseau (DNS, TCP, TLS…) partagent ce canal et n'ont pas de
         -- seuil Google : sans ce filtre elles comptent au dénominateur sans
         -- pouvoir atteindre le numérateur, et le score est plafonné.
         and m.name = any($3::text[])
         and ($1::text is null or m.app_id = $1)
         and ($2::text is null or s.device_type = $2)${internalClause(f, "m.app_id")}
     ) x`,
    [f.app, f.device, CORE_VITALS],
  );

  // erreurs / pages vues / sessions propres, même fenêtre et mêmes filtres
  const [c] = await q<{ pageviews: number; errors: number; sessions: number; clean_sessions: number }>(
    `select
       (select count(*)::int from rum_pageview p
         left join rum_session s using (session_id)
         where p.started_at > now() - interval '${itv}'
           and ($1::text is null or p.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "p.app_id")}) as pageviews,
       (select count(*)::int from rum_error e
         left join rum_session s using (session_id)
         where e.ts > now() - interval '${itv}'
           and ($1::text is null or e.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "e.app_id")}) as errors,
       (select count(*)::int from rum_session s
         where s.last_seen_at > now() - interval '${itv}'
           and ($1::text is null or s.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "s.app_id")}) as sessions,
       (select count(*)::int from rum_session s
         where s.last_seen_at > now() - interval '${itv}'
           and ($1::text is null or s.app_id = $1)
           and ($2::text is null or s.device_type = $2)${internalClause(f, "s.app_id")}
           and not exists (select 1 from rum_error e
                            where e.session_id = s.session_id
                              and e.ts > now() - interval '${itv}')) as clean_sessions`,
    [f.app, f.device],
  );

  // anomalies LCP : 24 h FIXES (la vue est horaire vs 7 j glissants), filtre app seulement
  // (v_anomaly n'a pas de dimension device)
  let anomalies: AnomalyRow[] = [];
  try {
    anomalies = await q<AnomalyRow>(
      `select app_id, route, bucket, p75::float as p75, mean_7d::float as mean_7d, z_score::float as z_score
       from v_anomaly
       where bucket > now() - interval '24 hours'
         and ($1::text is null or app_id = $1)${internalClause(f, "app_id")}
       order by abs(z_score) desc, bucket desc
       limit 20`,
      [f.app],
    );
  } catch {
    // vue v_anomaly absente (migration v0.3 pas encore appliquée) : l'Overview reste rendable
  }

  const vitalsRatio = v.total_w > 0 ? v.good_w / v.total_w : null;
  const errorsRatio =
    c.pageviews > 0 ? Math.max(0, 1 - c.errors / c.pageviews) : c.errors > 0 ? 0 : null;
  const stabilityRatio = c.sessions > 0 ? c.clean_sessions / c.sessions : null;
  const anomaliesRatio = Math.max(0, 1 - (PENALTY_PER_ANOMALY / 10) * anomalies.length);

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
    {
      key: "anomalies",
      label: "Anomalies LCP (24 h)",
      detail: anomalies.length
        ? `${anomalies.length} anomalie(s), -${PENALTY_PER_ANOMALY} pt(s) chacune`
        : "aucune anomalie détectée",
      earned: round1(10 * anomaliesRatio),
      max: 10,
    },
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
