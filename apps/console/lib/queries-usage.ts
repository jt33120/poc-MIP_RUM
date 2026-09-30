// Consommation par client (métering, migration-v15). Mois courant, joint au registre
// + quota. Fail-soft (vide si la base est indisponible).
//
// LE COMPTAGE PORTE SUR LA VEILLE. `meter_tenant_usage()` compte, chaque nuit, le
// jour PRÉCÉDENT : le jour en cours n'est jamais compté avant le lendemain, et le
// premier jour du mois n'a encore rien. La recette du 26/09/2026 affichait « 0 »
// partout — `coalesce` faisait d'une ABSENCE de comptage un zéro, que l'on lit
// « aucune consommation ». Sans aucun comptage sur le mois, chaque compteur vaut
// donc `null` (« — » à l'écran), et l'écran dit jusqu'à quel jour il est mesuré.
//
// UN COMPTAGE QUI N'A RIEN TROUVÉ A QUAND MÊME TOURNÉ (contre-recette du 26/09/2026).
// `meter_tenant_usage()` n'écrit aucune ligne pour un jour sans trafic : l'écran
// disait « Aucun comptage ce mois-ci » alors que le travail de la nuit avait tourné,
// et ne distinguait pas « rien à compter » d'une panne. Le témoin de passage est le
// battement du travail quotidien (`scheduler_lease`, cadence `quotidien`) : il n'est
// écrit qu'à un passage ABOUTI, métrage compris (packages/backend/jobs/bail.mjs),
// et le métrage de ce passage porte sur la veille (UTC), plus les jours qu'un passage
// manqué a laissés sans comptage depuis le filigrane (migration-v102, 14 jours au plus).
import { q } from "./db";

export interface TenantUsageRow {
  app_id: string;
  name: string;
  /** `null` : aucun comptage sur le mois — jamais 0, qui affirmerait l'absence de données. */
  events: number | null;
  sessions: number | null;
  errors: number | null;
  quota: number | null; // monthly_quota ; null = illimité
}

/** Jusqu'où le mois est mesuré : dernier jour compté et instant du dernier comptage (ISO UTC). */
export interface EtatComptage {
  /** « AAAA-MM-JJ » du dernier jour compté ce mois-ci ; `null` sans aucun comptage. */
  dernierJour: string | null;
  dernierComptage: string | null;
}

export interface ConsommationDuMois {
  lignes: TenantUsageRow[];
  comptage: EtatComptage;
}

interface LigneBrute {
  app_id: string;
  name: string;
  events: number | null;
  sessions: number | null;
  errors: number | null;
  quota: number | null;
}

/** Le dernier passage abouti du travail quotidien : le jour qu'il a compté (s'il est du mois) et sa fin. */
export interface PassageQuotidien {
  /** « AAAA-MM-JJ » : la veille du passage, si elle appartient au mois courant. */
  jour_du_mois: string | null;
  /** Fin du passage, ISO UTC. */
  fin: string | null;
}

/** Le plus tardif de deux textes triables (dates ISO), `null` ignoré. */
const plusTard = (a: string | null | undefined, b: string | null | undefined): string | null =>
  a == null ? (b ?? null) : b == null ? a : a > b ? a : b;

/**
 * Les compteurs d'après l'état du comptage. Le métrage n'écrit une ligne que pour une
 * app qui a émis ce jour-là : dès qu'un jour du mois est compté, une app sans ligne a
 * vraiment consommé 0. Aucun jour compté : rien n'est connu, pour aucune app. Un
 * passage abouti du travail quotidien dans le mois vaut un jour compté, même vide.
 */
export function consommationDuMois(
  lignes: readonly LigneBrute[],
  lu: { dernier_jour: string | null; dernier_comptage: string | null } | undefined,
  passage?: PassageQuotidien | null,
): ConsommationDuMois {
  // Un passage abouti du mois a compté sa veille, même sans rien y trouver.
  const etat = {
    dernier_jour: plusTard(lu?.dernier_jour, passage?.jour_du_mois),
    dernier_comptage: plusTard(lu?.dernier_comptage, passage?.jour_du_mois ? passage.fin : null),
  };
  const compte = etat.dernier_jour != null;
  const valeur = (v: number | null) => (compte ? Number(v ?? 0) : null);
  return {
    lignes: lignes.map((r) => ({
      app_id: r.app_id,
      name: r.name,
      events: valeur(r.events),
      sessions: valeur(r.sessions),
      errors: valeur(r.errors),
      quota: r.quota,
    })),
    comptage: { dernierJour: etat.dernier_jour, dernierComptage: etat.dernier_comptage },
  };
}

/** Usage du mois courant par app (events/sessions/erreurs) + quota, trié par volume. */
export async function monthlyUsage(): Promise<ConsommationDuMois> {
  try {
    const [lignes, etat, passage] = await Promise.all([
      q<LigneBrute>(
        `select a.app_id,
                coalesce(a.name, a.app_id) as name,
                u.events::float8   as events,
                u.sessions::float8 as sessions,
                u.errors::float8   as errors,
                a.monthly_quota::int as quota
           from app_registry a
           left join (
             select app_id, sum(events) as events, sum(sessions) as sessions, sum(errors) as errors
               from tenant_usage_daily
              where day >= date_trunc('month', current_date)
              group by app_id
           ) u using (app_id)
          order by coalesce(u.events, 0) desc, name`,
      ),
      q<{ dernier_jour: string | null; dernier_comptage: string | null }>(
        `select to_char(max(day), 'YYYY-MM-DD') as dernier_jour,
                to_char(max(metered_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as dernier_comptage
           from tenant_usage_daily
          where day >= date_trunc('month', current_date)`,
      ),
      // Le battement du travail quotidien : lu à part, une table absente ne coûte que lui.
      q<PassageQuotidien>(
        `select case when (max(expires_at) at time zone 'UTC')::date - 1 >= date_trunc('month', current_date)::date
                     then to_char((max(expires_at) at time zone 'UTC')::date - 1, 'YYYY-MM-DD') end as jour_du_mois,
                to_char(max(expires_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as fin
           from scheduler_lease
          where job = 'quotidien' and expires_at <= now()`,
      ).catch(() => [] as PassageQuotidien[]),
    ]);
    return consommationDuMois(lignes, etat[0], passage[0] ?? null);
  } catch {
    return { lignes: [], comptage: { dernierJour: null, dernierComptage: null } };
  }
}
