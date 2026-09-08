// Signaux affichés sur l'écran de sélection de projet : domaines surveillés,
// mode de collecte réellement observé, et anomalies en cours.
//
// TROIS REQUÊTES POUR TOUTE LA LISTE, jamais une par carte. L'écran affiche N
// projets ; un helper par projet donnerait 3N allers-retours, et `healthScore()`
// en particulier fait à lui seul 3 requêtes dont une agrégation sur 8 jours.
//
// Chaque fonction est fail-soft : une vue absente (base non migrée, CI) rend un
// résultat vide plutôt qu'une erreur. Un écran de choix de projet ne doit jamais
// refuser de s'afficher parce qu'un signal décoratif manque.
import { q } from "@/lib/db";

/** Mode de collecte observé pour une application. */
export type ModeCollecte = "sdk" | "extension" | "mixte" | "aucun";

export interface SignauxProjet {
  /** Domaines surveillés, déclaratifs (CORS + périmètre extension). */
  domaines: string[];
  /** Ce que la télémétrie montre réellement — pas ce qui est déclaré. */
  mode: ModeCollecte;
  /** Une ligne extension_scope active existe, même sans données. */
  extensionDeclaree: boolean;
  /** Anomalies de LCP détectées sur les dernières 24 h (z-score > 3). */
  anomalies: number;
}

export type SignauxParApp = Record<string, SignauxProjet>;

const VIDE: SignauxProjet = {
  domaines: [],
  mode: "aucun",
  extensionDeclaree: false,
  anomalies: 0,
};

/**
 * Domaines par application. Source DÉCLARATIVE, à dessein :
 * `app_registry.allowed_origins` (l'allowlist CORS, renseignée à la création du
 * site et complétée par l'onboarding extension) réunie au registre
 * `extension_scope`. C'est disponible avant le moindre trafic, ça se lit sur
 * clé primaire, et ça survit à la purge de rétention.
 *
 * `rum_pageview.url` dirait ce qui est VU plutôt que ce qui est déclaré, mais
 * la table n'a pas d'index sur app_id (scan), la colonne est purgée à 30 jours,
 * et le bookmarklet d'onboarding y laisse des hôtes de test. Mauvaise source
 * pour une liste de référence.
 *
 * localhost et 127.0.0.1 sont écartés : ce sont des origines de développement,
 * pas des domaines supervisés, et elles s'affichent mal devant un client.
 */
async function domainesParApp(appIds: string[]): Promise<Map<string, string[]>> {
  const rows = await q<{ app_id: string; domaines: string[] }>(
    `select app_id, array_agg(distinct host order by host) as domaines
       from (
         select a.app_id,
                -- équivalent SQL d'originHost() : sans schéma, sans chemin, sans port
                lower(split_part(split_part(
                  regexp_replace(o, '^[a-z][a-z0-9+.-]*://', ''), '/', 1), ':', 1)) as host
           from app_registry a
           cross join unnest(coalesce(a.allowed_origins, '{}'::text[])) as o
          where a.app_id = any($1::text[])
         union
         select e.app_id, lower(e.domain)
           from extension_scope e
          where e.app_id = any($1::text[]) and e.active
       ) t
      where host <> ''
        and host not in ('localhost', '127.0.0.1', '::1')
      group by app_id`,
    [appIds],
  );
  return new Map(rows.map((r) => [r.app_id, r.domaines ?? []]));
}

/**
 * Mode de collecte OBSERVÉ, par jointure sur `rum_session.collection_source`,
 * plus la déclaration d'un périmètre extension.
 *
 * Deux avertissements que l'affichage doit respecter :
 *  - `'sdk'` est la valeur PAR DÉFAUT de la colonne, pas une affirmation : elle
 *    signifie « pas extension ». Tout l'historique antérieur à la migration v27
 *    la porte, et le SDK mobile l'émet aussi.
 *  - une ligne `extension_scope` est déclarative. L'extension ne s'injecte pas
 *    si le SDK est déjà présent, donc un périmètre déclaré peut ne produire
 *    aucune session extension. D'où `extensionDeclaree` séparé de `mode`.
 *
 * Fenêtre de 30 jours, alignée sur la rétention : au-delà, les sessions sont
 * purgées de toute façon, et la borne évite un scan de tout l'historique
 * (rum_session n'a pas d'index b-tree simple sur app_id).
 */
async function modesParApp(
  appIds: string[],
): Promise<Map<string, { mode: ModeCollecte; declaree: boolean }>> {
  const rows = await q<{ app_id: string; sdk: number; ext: number; declaree: boolean }>(
    `select ids.app_id,
            count(*) filter (where s.collection_source = 'sdk')::int       as sdk,
            count(*) filter (where s.collection_source = 'extension')::int as ext,
            exists (select 1 from extension_scope e
                     where e.app_id = ids.app_id and e.active)             as declaree
       from unnest($1::text[]) as ids(app_id)
       left join rum_session s
              on s.app_id = ids.app_id
             and s.last_seen_at > now() - interval '30 days'
      group by ids.app_id`,
    [appIds],
  );
  return new Map(
    rows.map((r) => {
      const mode: ModeCollecte =
        r.sdk > 0 && r.ext > 0 ? "mixte" : r.ext > 0 ? "extension" : r.sdk > 0 ? "sdk" : "aucun";
      return [r.app_id, { mode, declaree: r.declaree }];
    }),
  );
}

/**
 * Anomalies de LCP en cours, par application.
 *
 * `v_anomaly` est une vue NON matérialisée : elle ne dépend d'aucune tâche
 * planifiée, ce qui est décisif ici — les crons de ce déploiement ne tournent
 * pas, donc `alert_event` serait vide quoi qu'il arrive et une pastille fondée
 * dessus mentirait par silence.
 *
 * Un seul appel GLOBAL, groupé : la CTE interne de la vue est référencée deux
 * fois, donc PostgreSQL la matérialise et un `where app_id = …` n'élague rien.
 * Filtrer par application coûterait le même prix que tout lire.
 *
 * L'heure courante est EXCLUE : elle est incomplète dans la vue mais absente de
 * sa ligne de base, ce qui produit des z-scores extrêmes en début d'heure. Une
 * pastille d'alerte fondée là-dessus crierait au loup chaque heure.
 */
async function anomaliesParApp(): Promise<Map<string, number>> {
  const rows = await q<{ app_id: string; n: number }>(
    `select app_id, count(*)::int as n
       from v_anomaly
      where bucket >= date_trunc('hour', now()) - interval '24 hours'
        and bucket <  date_trunc('hour', now())
      group by app_id`,
  );
  return new Map(rows.map((r) => [r.app_id, r.n]));
}

/**
 * Tous les signaux pour la liste de projets, en trois requêtes.
 * Une application sans aucune donnée est toujours présente dans le résultat.
 */
export async function signauxProjets(appIds: string[]): Promise<SignauxParApp> {
  if (appIds.length === 0) return {};

  const souple = <T,>(p: Promise<T>, defaut: T): Promise<T> =>
    p.catch(() => defaut); // vue ou colonne absente : signal muet, écran intact

  const [domaines, modes, anomalies] = await Promise.all([
    souple(domainesParApp(appIds), new Map<string, string[]>()),
    souple(modesParApp(appIds), new Map<string, { mode: ModeCollecte; declaree: boolean }>()),
    souple(anomaliesParApp(), new Map<string, number>()),
  ]);

  const out: SignauxParApp = {};
  for (const id of appIds) {
    const m = modes.get(id);
    out[id] = {
      ...VIDE,
      domaines: domaines.get(id) ?? [],
      mode: m?.mode ?? "aucun",
      extensionDeclaree: m?.declaree ?? false,
      anomalies: anomalies.get(id) ?? 0,
    };
  }
  return out;
}
