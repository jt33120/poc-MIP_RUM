// LA SANTÉ DE LA CHAÎNE DE MESURE, en lecture — la carte de `/admin/health`.
//
// Le scheduler prouve à chaque tick que la porte des clients écrit (le canari,
// `packages/backend/jobs/sondes.mjs`, migration-v103) : une ligne par étage dans
// `sonde_passage`, les périodes non nominales dans `collecte_fenetre`, le
// battement des services sans bail dans `sonde_battement`. Cette lecture en
// rend l'essentiel en UNE requête (Neon se paie au réveil) : le dernier passage
// et ses étages, les fenêtres ouvertes et celles des 30 derniers jours, le taux
// de canaris aboutis sur 7 jours, les battements, et la frise de 7 jours
// (résultats par heure et par étage, latences p50/p95), bornée par l'index
// `sonde_passage_etage_emis_idx` (étage, portée, émission) : ~2 000 lignes au plus.
//
// LE BADGE DE L'EN-TÊTE (`lireEtatMesure`) est une autre lecture, bien plus petite
// (le dernier passage, la fenêtre ouverte, la cadence) : la coquille la fait pour
// chaque écran, donc elle est gardée 60 s en mémoire — l'actualisation de 5 s ne
// la relit pas.
//
// LE SCHÉMA PEUT MANQUER : tant que v103 n'est pas appliquée (42P01), qu'une
// colonne manque (42703) ou que le rôle de lecture n'a pas son droit (42501), la
// lecture rend `null` — la carte dit « sondes pas encore en service », sans mettre
// la page en échec. Toute autre erreur remonte (une panne se dit, F02).
import { cadencePubliee } from "@mip/console-contract";
import { q } from "./db";
import { registreCollecteAbsent } from "./queries-collecte";

export type EtagePassage = {
  etage: string;
  resultat: string;
  latence_ms: number | null;
  http_status: number | null;
  chemin: string | null;
  detail: string | null;
};

export type FenetreRegistre = {
  id: number;
  portee: string;
  etage: string;
  etat: "degradee" | "interrompue";
  debut: string;
  fin: string | null;
  cause: string | null;
  preuve: string | null;
  source: "sonde" | "reconstitution" | "operateur";
};

/** Une heure d'un étage : le nombre de passages de chaque résultat (`{ ok: 3, lent: 1 }`). */
export type HeureEtage = { etage: string; heure: string; resultats: Record<string, number> };
/** Latences d'un étage sur 7 jours, en ms arrondies ; `n` passages mesurés. */
export type LatencesEtage = { etage: string; p50: number | null; p95: number | null; n: number };

export type SanteChaineBrute = {
  /** Le dernier passage du canari (`ingest_console`), ou `null` s'il n'y en a jamais eu. */
  dernier: { passage_id: string; emis_at: string } | null;
  etages: EtagePassage[];
  /** Ouvertes d'abord, puis les plus récentes ; 20 au plus. */
  fenetres: FenetreRegistre[];
  taux7j: { total: number; aboutis: number };
  battements: Array<{ service: string; dernier_ok: string; detail: string | null }>;
  /** La frise de 7 jours : par étage et par heure (début, ISO sans millisecondes, comme `grilleIso`). */
  heures: HeureEtage[];
  /** Latences sur 7 jours des étages qui en mesurent une. */
  latences7j: LatencesEtage[];
};

/** Fenêtres affichées : les ouvertes et celles closes depuis 30 jours, 20 au plus. */
const LIMITE_FENETRES = 20;

const iso = (v: unknown): string => new Date(v as string).toISOString();
/** Même forme que `grilleIso` (lib/series.ts) : la frise apparie ses cases par cette chaîne. */
const isoHeure = (v: unknown): string => iso(v).replace(/\.\d{3}Z$/, "Z");
const entierOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function lireSanteChaine(): Promise<SanteChaineBrute | null> {
  try {
    const [r] = await q<{
      dernier: { passage_id: string; emis_at: string } | null;
      etages: EtagePassage[] | null;
      fenetres: FenetreRegistre[] | null;
      taux: { total: number; aboutis: number } | null;
      battements: Array<{ service: string; dernier_ok: string; detail: string | null }> | null;
      heures: Array<{ etage: string; heure: string; resultats: Record<string, number> | null }> | null;
      latences: Array<{ etage: string; p50: number | null; p95: number | null; n: number }> | null;
    }>(
      `with dernier as (
         select passage_id, emis_at from sonde_passage
          where etage = 'ingest_console' and portee = '*'
          order by emis_at desc limit 1
       ),
       -- Les 7 jours des trois étages de la carte, par l'index (étage, portée, émission).
       sept as (
         select etage, emis_at, resultat, latence_ms from sonde_passage
          where etage in ('ingest_console', 'ecriture', 'ingest_collector') and portee = '*'
            and emis_at > now() - interval '7 days'
       )
       select
         (select json_build_object('passage_id', d.passage_id, 'emis_at', d.emis_at) from dernier d) as dernier,
         (select json_agg(json_build_object('etage', p.etage, 'resultat', p.resultat, 'latence_ms', p.latence_ms,
                                            'http_status', p.http_status, 'chemin', p.chemin, 'detail', p.detail)
                          order by p.etage)
            from sonde_passage p join dernier d on d.passage_id = p.passage_id
           where p.portee = '*') as etages,
         (select json_agg(f) from (
            select id, portee, etage, etat, debut, fin, cause, preuve, source
              from collecte_fenetre
             where fin is null or fin > now() - interval '30 days'
             order by (fin is null) desc, debut desc
             limit ${LIMITE_FENETRES}) f) as fenetres,
         (select json_build_object('total', count(*), 'aboutis', count(*) filter (where resultat = 'ok'))
            from sonde_passage
           where etage = 'ecriture' and portee = '*' and emis_at > now() - interval '7 days') as taux,
         (select json_agg(json_build_object('service', b.service, 'dernier_ok', b.dernier_ok, 'detail', b.detail)
                          order by b.service)
            from sonde_battement b) as battements,
         (select json_agg(json_build_object('etage', h.etage, 'heure', h.heure, 'resultats', h.resultats) order by h.etage, h.heure)
            from (select c.etage, c.heure, json_object_agg(c.resultat, c.n) as resultats
                    from (select etage, date_trunc('hour', emis_at) as heure, resultat, count(*)::int as n
                            from sept group by 1, 2, 3) c
                   group by c.etage, c.heure) h) as heures,
         (select json_agg(json_build_object('etage', l.etage, 'p50', l.p50, 'p95', l.p95, 'n', l.n) order by l.etage)
            from (select etage,
                         percentile_cont(0.5) within group (order by latence_ms) as p50,
                         percentile_cont(0.95) within group (order by latence_ms) as p95,
                         count(*)::int as n
                    from sept where latence_ms is not null group by etage) l) as latences`,
    );
    return {
      dernier: r?.dernier ? { passage_id: r.dernier.passage_id, emis_at: iso(r.dernier.emis_at) } : null,
      etages: r?.etages ?? [],
      fenetres: (r?.fenetres ?? []).map((f) => ({ ...f, id: Number(f.id), debut: iso(f.debut), fin: f.fin === null ? null : iso(f.fin) })),
      taux7j: { total: Number(r?.taux?.total ?? 0), aboutis: Number(r?.taux?.aboutis ?? 0) },
      battements: (r?.battements ?? []).map((b) => ({ ...b, dernier_ok: iso(b.dernier_ok) })),
      heures: (r?.heures ?? []).map((h) => ({
        etage: h.etage,
        heure: isoHeure(h.heure),
        resultats: Object.fromEntries(Object.entries(h.resultats ?? {}).map(([k, n]) => [k, Number(n)])),
      })),
      latences7j: (r?.latences ?? []).map((l) => ({ etage: l.etage, p50: entierOuNull(l.p50), p95: entierOuNull(l.p95), n: Number(l.n) })),
    };
  } catch (err) {
    if (registreCollecteAbsent(err)) return null;
    throw err;
  }
}

// ─── Le badge de l'en-tête ───────────────────────────────────────────────────

/** Ce que lit le badge de l'en-tête : de quoi rendre le verdict de la carte, rien de plus. */
export type EtatMesure = {
  /** Émission du dernier canari (`ingest_console`), ou `null` s'il n'y en a jamais eu. */
  dernier: string | null;
  /** La fenêtre ouverte de la plateforme (`portee = '*'`, étage `chaine`), s'il y en a une. */
  ouverte: { etat: "degradee" | "interrompue"; debut: string; cause: string | null } | null;
  /** La cadence publiée du tick (`platform_flag.scheduler_tick_min`). */
  cadenceMin: number | null;
};

/** 60 s au plus : la coquille est relue à chaque actualisation (5 s), le badge non. */
export const DUREE_CACHE_MESURE_MS = 60_000;
let cacheMesure: { expire: number; promesse: Promise<EtatMesure | null> } | null = null;

/**
 * L'état de la chaîne pour le badge de l'en-tête, ou `null` si le schéma des
 * sondes manque (le badge ne s'affiche pas). Trois lectures par clé en une
 * requête, gardées `DUREE_CACHE_MESURE_MS` ; un échec ne reste pas en cache.
 * L'âge du dernier passage se calcule au rendu : le cache ne fige pas le verdict.
 */
export function lireEtatMesure(maintenant = Date.now()): Promise<EtatMesure | null> {
  if (cacheMesure && cacheMesure.expire > maintenant) return cacheMesure.promesse;
  const entree = { expire: maintenant + DUREE_CACHE_MESURE_MS, promesse: lireEtatMesureEnBase() };
  cacheMesure = entree;
  entree.promesse.catch(() => {
    if (cacheMesure === entree) cacheMesure = null;
  });
  return entree.promesse;
}

/** Pour les tests : vide le cache du badge. */
export function viderCacheEtatMesure(): void {
  cacheMesure = null;
}

async function lireEtatMesureEnBase(): Promise<EtatMesure | null> {
  try {
    const [r] = await q<{
      dernier: string | Date | null;
      ouverte: { etat: string; debut: string; cause: string | null } | null;
      cadence: string | null;
    }>(
      `select
         (select emis_at from sonde_passage
           where etage = 'ingest_console' and portee = '*'
           order by emis_at desc limit 1) as dernier,
         (select json_build_object('etat', etat, 'debut', debut, 'cause', cause)
            from collecte_fenetre
           where portee = '*' and etage = 'chaine' and fin is null
           limit 1) as ouverte,
         (select value from platform_flag where key = 'scheduler_tick_min') as cadence`,
    );
    return {
      dernier: r?.dernier ? iso(r.dernier) : null,
      ouverte: r?.ouverte
        ? { etat: r.ouverte.etat === "interrompue" ? "interrompue" : "degradee", debut: iso(r.ouverte.debut), cause: r.ouverte.cause ?? null }
        : null,
      cadenceMin: cadencePubliee(r?.cadence ?? undefined),
    };
  } catch (err) {
    if (registreCollecteAbsent(err)) return null;
    throw err;
  }
}
