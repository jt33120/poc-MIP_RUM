// Vue des ressources (P6.3) — couche I/O. Durée, taille, type et origine des
// ressources retenues par le SDK, bornées et accompagnées de leur avertissement
// de collecte (lib/resources.ts).
//
// L'hôte est extrait de l'URL DÉJÀ COLLECTÉE, en SQL, par une expression
// constante du code : aucune URL n'est résolue ni appelée par le serveur. Le
// partage première/tierce partie compare cet hôte aux origines déclarées de
// L'APPLICATION DE LA LIGNE — une vue multi-app ne prête donc pas l'allowlist
// d'un tenant aux ressources d'un autre.
import { q } from "./db";
import type { FiltersLike } from "./filters";
import { binder, compileScope, sessionJoin } from "./query-compiler";
import { softFail, sqlContext, type SqlContext } from "./query-sql";
import { RESOURCE_CAP, declaredHostPairs, type ResourceParty } from "./resources";

/**
 * Hôte d'une URL de ressource : minuscules, sans identifiants ni port. Miroir
 * exact de `hostOfOrigin` côté TypeScript, appliqué aux deux côtés de la
 * comparaison. Expression constante : aucune valeur d'URL n'y est concaténée.
 */
const HOTE_SQL = `nullif(
  regexp_replace(
    regexp_replace(coalesce(substring(lower(r.url) from '^[a-z][a-z0-9+.-]*://([^/?#]*)'), ''), '^[^@]*@', ''),
    ':[0-9]+$', ''),
  '')`;

export interface ResourceGroupe {
  /** Type (`script`, `img`…) ou hôte, selon la vue ; null = non renseigné. */
  cle: string | null;
  party: ResourceParty | null;
  /** Ressources retenues par le SDK dans le groupe. */
  n: number;
  /** p75 de la durée observée, en millisecondes ; null sans mesure. */
  p75_ms: number | null;
  /** Somme des tailles transférées, en octets. */
  octets: number;
}

export interface ResourcesVue {
  parType: ResourceGroupe[];
  typesTotal: number;
  typesTronques: boolean;
  parOrigine: ResourceGroupe[];
  originesTotal: number;
  originesTronquees: boolean;
  /** Partage première / tierce partie ; vide si rien n'est collecté. */
  parParty: ResourceGroupe[];
  /** Ressources retenues sur la fenêtre, toutes origines confondues. */
  total: number;
  /** Au moins une ressource a pu être classée : le partage porte un sens. */
  partageCalculable: boolean;
}

type LigneSql = ResourceGroupe & { kind: "type" | "origine" | "party"; groupes: number };

const VIDE: ResourcesVue = {
  parType: [],
  typesTotal: 0,
  typesTronques: false,
  parOrigine: [],
  originesTotal: 0,
  originesTronquees: false,
  parParty: [],
  total: 0,
  partageCalculable: false,
};

/**
 * Les trois lectures de la vue — par type, par hôte, et le partage première /
 * tierce partie — en UNE instruction : elles partagent la même population, donc
 * la même photographie. Trois requêtes séparées pourraient afficher trois totaux
 * différents si une ingestion passait entre elles.
 */
export async function resourcesVue(f: FiltersLike, cap = RESOURCE_CAP): Promise<ResourcesVue> {
  try {
    const sql = await sqlContext(f);
    const where = sql.where({ dataset: "resources", row: "r", session: "s", time: "r.ts" });
    const declarees = await originesDeclarees(sql);
    const appsDeclarees = sql.bind(declarees.apps);
    const hotesDeclares = sql.bind(declarees.hosts);
    const limite = Number(cap);
    const rows = await q<LigneSql>(
      `with base as (
         select r.app_id, r.type, r.duration_ms, r.transfer_size, ${HOTE_SQL} as hote
           from rum_resource r
           ${sessionJoin("r", "s")}
          where true${where}
       ),
       hotes as (
         select d.app_id, array_agg(d.host) as declares
           from unnest(${appsDeclarees}::text[], ${hotesDeclares}::text[]) as d(app_id, host)
          group by d.app_id
       ),
       classe as (
         select b.type, b.duration_ms, b.transfer_size, b.hote,
                case when b.hote is null or h.declares is null then 'unknown'
                     when b.hote = any(h.declares) then 'first'
                     else 'third' end as party
           from base b
           left join hotes h on h.app_id = b.app_id
       ),
       agrege as (
         select 'type' as kind, c.type as cle, null::text as party, count(*)::int as n,
                percentile_cont(0.75) within group (order by c.duration_ms) as p75_ms,
                coalesce(sum(c.transfer_size), 0)::float8 as octets
           from classe c group by c.type
         union all
         select 'origine', c.hote, c.party, count(*)::int,
                percentile_cont(0.75) within group (order by c.duration_ms),
                coalesce(sum(c.transfer_size), 0)::float8
           from classe c group by c.hote, c.party
         union all
         select 'party', null::text, c.party, count(*)::int,
                percentile_cont(0.75) within group (order by c.duration_ms),
                coalesce(sum(c.transfer_size), 0)::float8
           from classe c group by c.party
       ),
       classee as (
         select a.*, count(*) over (partition by a.kind)::int as groupes,
                row_number() over (partition by a.kind order by a.n desc, a.cle asc nulls last) as rang
           from agrege a
       )
       select kind, cle, party, n, p75_ms, octets, groupes
         from classee
        where kind = 'party' or rang <= ${limite}
        order by kind, n desc, cle asc nulls last`,
      sql.params,
    );
    return assembler(rows);
  } catch (e) {
    return softFail(e, VIDE);
  }
}

/**
 * Origines déclarées des apps du périmètre, normalisées en couples (app, hôte).
 * Lecture à part, sur `app_registry` seul : une jointure aurait mêlé la
 * normalisation des origines à celle des URL collectées, et elles n'ont ni la
 * même source ni les mêmes cas limites.
 */
async function originesDeclarees(sql: SqlContext): Promise<{ apps: string[]; hosts: string[] }> {
  const { params, bind } = binder();
  const rows = await q<{ app_id: string; allowed_origins: string[] | null }>(
    `select ar.app_id, ar.allowed_origins from app_registry ar
      where true${compileScope(sql.query, "ar.app_id", bind)}`,
    params,
  );
  return declaredHostPairs(rows);
}

function assembler(rows: LigneSql[]): ResourcesVue {
  const de = (kind: LigneSql["kind"]) => rows.filter((row) => row.kind === kind);
  const nettoyer = (lignes: LigneSql[]): ResourceGroupe[] =>
    lignes.map(({ kind: _k, groupes: _g, ...reste }) => reste);
  const types = de("type");
  const origines = de("origine");
  const parties = de("party");
  const typesTotal = types[0]?.groupes ?? 0;
  const originesTotal = origines[0]?.groupes ?? 0;
  return {
    parType: nettoyer(types),
    typesTotal,
    typesTronques: typesTotal > types.length,
    parOrigine: nettoyer(origines),
    originesTotal,
    originesTronquees: originesTotal > origines.length,
    parParty: nettoyer(parties),
    total: parties.reduce((somme, ligne) => somme + ligne.n, 0),
    partageCalculable: parties.some((ligne) => ligne.party !== "unknown"),
  };
}
