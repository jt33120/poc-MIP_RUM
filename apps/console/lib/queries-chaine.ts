// LA SANTÉ DE LA CHAÎNE DE MESURE, en lecture — la carte de `/admin/health`.
//
// Le scheduler prouve à chaque tick que la porte des clients écrit (le canari,
// `packages/backend/jobs/sondes.mjs`, migration-v103) : une ligne par étage dans
// `sonde_passage`, les périodes non nominales dans `collecte_fenetre`, le
// battement des services sans bail dans `sonde_battement`. Cette lecture en
// rend l'essentiel en UNE requête (Neon se paie au réveil) : le dernier passage
// et ses étages, les fenêtres ouvertes et celles des 30 derniers jours, le taux
// de canaris aboutis sur 7 jours, les battements.
//
// LE SCHÉMA PEUT MANQUER : tant que v103 n'est pas appliquée (42P01), qu'une
// colonne manque (42703) ou que le rôle de lecture n'a pas son droit (42501), la
// lecture rend `null` — la carte dit « sondes pas encore en service », sans mettre
// la page en échec. Toute autre erreur remonte (une panne se dit, F02).
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

export type SanteChaineBrute = {
  /** Le dernier passage du canari (`ingest_console`), ou `null` s'il n'y en a jamais eu. */
  dernier: { passage_id: string; emis_at: string } | null;
  etages: EtagePassage[];
  /** Ouvertes d'abord, puis les plus récentes ; 20 au plus. */
  fenetres: FenetreRegistre[];
  taux7j: { total: number; aboutis: number };
  battements: Array<{ service: string; dernier_ok: string; detail: string | null }>;
};

/** Fenêtres affichées : les ouvertes et celles closes depuis 30 jours, 20 au plus. */
const LIMITE_FENETRES = 20;

const iso = (v: unknown): string => new Date(v as string).toISOString();

export async function lireSanteChaine(): Promise<SanteChaineBrute | null> {
  try {
    const [r] = await q<{
      dernier: { passage_id: string; emis_at: string } | null;
      etages: EtagePassage[] | null;
      fenetres: FenetreRegistre[] | null;
      taux: { total: number; aboutis: number } | null;
      battements: Array<{ service: string; dernier_ok: string; detail: string | null }> | null;
    }>(
      `with dernier as (
         select passage_id, emis_at from sonde_passage
          where etage = 'ingest_console' and portee = '*'
          order by emis_at desc limit 1
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
            from sonde_battement b) as battements`,
    );
    return {
      dernier: r?.dernier ? { passage_id: r.dernier.passage_id, emis_at: iso(r.dernier.emis_at) } : null,
      etages: r?.etages ?? [],
      fenetres: (r?.fenetres ?? []).map((f) => ({ ...f, id: Number(f.id), debut: iso(f.debut), fin: f.fin === null ? null : iso(f.fin) })),
      taux7j: { total: Number(r?.taux?.total ?? 0), aboutis: Number(r?.taux?.aboutis ?? 0) },
      battements: (r?.battements ?? []).map((b) => ({ ...b, dernier_ok: iso(b.dernier_ok) })),
    };
  } catch (err) {
    if (registreCollecteAbsent(err)) return null;
    throw err;
  }
}
