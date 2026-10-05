// Requêtes /admin/customers (v0.5) — liste des apps clientes + sonde
// d'onboarding (la checklist live du wizard s'appuie dessus).
import { q } from "./db";
import { PLAFOND_COMPTE, type SondeInstallation } from "./installer";
import type { OnboardingProbe } from "./onboarding";

export interface CustomerRow {
  app_id: string;
  name: string;
  client_id: string | null;
  active: boolean;
  has_key: boolean;
  allowed_origins: string[];
  created_by: string | null;
  notes: string | null;
  created_at: Date | string;
  sessions_7d: number;
  /**
   * Dernière donnée reçue : le plus récent des Web Vitals, des événements et de
   * l'activité de session. Les seuls Web Vitals disaient « jamais » d'une app mobile
   * qui envoie des sessions et des événements mais aucun Web Vital (recette du
   * 26/09/2026) : l'administrateur croyait qu'elle ne remontait rien.
   */
  last_event_at: Date | string | null;
}

export async function listCustomers(): Promise<CustomerRow[]> {
  return q<CustomerRow>(`
    select a.app_id, a.name, a.client_id, a.active,
           (a.api_key_hash is not null) as has_key,
           coalesce(a.allowed_origins, '{}') as allowed_origins,
           a.created_by, a.notes, a.created_at,
           coalesce(s.sessions_7d, 0)::int as sessions_7d,
           greatest(m.dernier, ev.dernier, se.dernier) as last_event_at
    from app_registry a
    left join lateral (
      select count(distinct session_id) as sessions_7d
      from rum_session where app_id = a.app_id and started_at > now() - interval '7 days'
    ) s on true
    left join lateral (
      select max(ts) as dernier from rum_metric where app_id = a.app_id
    ) m on true
    -- greatest() ignore les NULL : une source muette n'efface pas les autres.
    left join lateral (
      select max(ts) as dernier from rum_event where app_id = a.app_id
    ) ev on true
    left join lateral (
      select max(last_seen_at) as dernier from rum_session where app_id = a.app_id
    ) se on true
    order by a.created_at desc
  `);
}

export async function getCustomer(appId: string): Promise<CustomerRow | null> {
  const rows = await q<CustomerRow>(
    `select app_id, name, client_id, active,
            (api_key_hash is not null) as has_key,
            coalesce(allowed_origins, '{}') as allowed_origins,
            created_by, notes, created_at,
            0::int as sessions_7d, null::timestamptz as last_event_at
     from app_registry where app_id = $1`,
    [appId],
  );
  return rows[0] ?? null;
}

/** Ce que la page « Installer » lit d'une application : son identité, son état de collecte, sa clé, ses domaines. */
export interface ConfigInstallation {
  name: string;
  client_id: string | null;
  active: boolean;
  /** Collecte suspendue (dépassement de consommation) : refusée comme une application coupée. */
  suspendue: boolean;
  has_key: boolean;
  allowed_origins: string[];
  /** Conservation des données, en jours (`app_registry.retention_days`, 30 par défaut) : la mention de confidentialité la cite. */
  retention_days: number;
}

/**
 * La configuration d'une application pour `/installer`. `active` et `suspendue` :
 * les deux refus que la collecte oppose AVANT la clé (`checkApiKey` du noyau) — le
 * client doit les voir avant de chercher pourquoi rien n'arrive.
 */
export async function configInstallation(appId: string): Promise<ConfigInstallation | null> {
  const rows = await q<ConfigInstallation>(
    `select name, client_id, active,
            (ingestion_suspended_at is not null) as suspendue,
            (api_key_hash is not null) as has_key,
            coalesce(allowed_origins, '{}') as allowed_origins,
            coalesce(retention_days, 30)::int as retention_days
     from app_registry where app_id = $1`,
    [appId],
  );
  return rows[0] ?? null;
}

/**
 * LA SONDE DE `/installer`, par mode de collecte : ce que `probeOnboarding` ne
 * distingue pas (le code de suivi de l'extension, le battement des postes, les
 * appels reliés à leur part serveur). Rejouée toutes les 5 s pendant 10 minutes au
 * plus : chaque lecture est BORNÉE par un index et une limite, jamais un parcours
 * de tout l'historique de l'application —
 *   · les 200 sessions les plus récentes d'un mode sur 7 jours
 *     (`idx_session_app_seen`, et l'index partiel `idx_session_source` pour
 *     l'extension, d'où la condition `<> 'sdk'` écrite en toutes lettres), puis
 *     leurs Web Vitals par `idx_metric_session` ;
 *   · les comptes sur 24 h plafonnés à 1 000 lignes (`PLAFOND_COMPTE`) ;
 *   · les 200 derniers temps serveur (`rum_span_app_tier_ts_idx`), dont un seul
 *     jumeau navigateur suffit (`rum_span_trace_idx`).
 */
export async function sondeInstallation(appId: string): Promise<SondeInstallation> {
  const [row] = await q<SondeInstallation>(
    `with sdk as (
       select session_id from rum_session
        where app_id = $1 and collection_source = 'sdk' and last_seen_at > now() - interval '7 days'
        order by last_seen_at desc limit 200
     ), ext as (
       select session_id from rum_session
        where app_id = $1 and collection_source <> 'sdk' and collection_source = 'extension'
          and last_seen_at > now() - interval '7 days'
        order by last_seen_at desc limit 200
     ), serveur as (
       select trace_id, ts from rum_span
        where app_id = $1 and tier = 'back' and ts > now() - interval '7 days'
        order by ts desc limit 200
     )
     select
       (select max(m.ts) from rum_metric m where m.session_id in (select session_id from sdk)) as derniere_mesure_sdk,
       (select count(*) from (select 1 from rum_session
          where app_id = $1 and collection_source = 'sdk' and last_seen_at > now() - interval '24 hours'
          limit ${PLAFOND_COMPTE}) x)::int                                               as sessions_sdk_24h,
       (select max(last_seen_at) from extension_install_app where app_id = $1)           as dernier_battement,
       (select count(*) from extension_install_app where app_id = $1)::int              as postes,
       (select max(m.ts) from rum_metric m where m.session_id in (select session_id from ext)) as derniere_mesure_extension,
       (select count(*) from (select 1 from rum_session
          where app_id = $1 and collection_source <> 'sdk' and collection_source = 'extension'
            and last_seen_at > now() - interval '24 hours'
          limit ${PLAFOND_COMPTE}) x)::int                                               as sessions_extension_24h,
       (select max(ts) from serveur)                                                     as dernier_span_serveur,
       (select count(*) from (select 1 from rum_span
          where app_id = $1 and tier = 'back' and ts > now() - interval '24 hours'
          limit ${PLAFOND_COMPTE}) x)::int                                               as spans_serveur_24h,
       (select max(b.ts) from serveur b
         where exists (select 1 from rum_span f where f.trace_id = b.trace_id and f.tier = 'front')) as dernier_appel_relie
    `,
    [appId],
  );
  return row;
}

/** Sonde unique pour la checklist : 4 marqueurs + compteurs 24 h. */
export async function probeOnboarding(appId: string): Promise<OnboardingProbe> {
  const [row] = await q<OnboardingProbe>(
    `select
       (select min(ts) from rum_metric where app_id = $1)                       as first_metric_at,
       (select max(ts) from rum_metric where app_id = $1)                       as last_metric_at,
       (select count(distinct session_id) from rum_session
         where app_id = $1 and started_at > now() - interval '24 hours')::int   as sessions_24h,
       (select min(ts) from rum_span where app_id = $1 and tier = 'front')      as first_front_span_at,
       (select min(ts) from rum_span where app_id = $1 and tier = 'back')       as first_back_span_at,
       (select coalesce(sum(occurrences), 0) from rum_error
         where app_id = $1 and ts > now() - interval '24 hours')::int           as errors_24h
    `,
    [appId],
  );
  return row;
}
