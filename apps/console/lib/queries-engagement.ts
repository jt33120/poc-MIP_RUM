// Les signaux de vue du SDK web ≥ 0.6 (04/10/2026) — couche I/O : engagement,
// chargements SPA, poids des vues, repères du développeur.
//
// Lues par l'écran /pages (`chargeurs/pages.ts`) et destinées à l'API v1 et au MCP :
// chaque fonction prend des filtres (`FiltersLike`) et rend des données qui voyagent
// en JSON (aucune `Map`, aucune `Date`).
//
// UNE LIGNE PAR VUE ET PAR NOM dans `rum_metric` (le SDK envoie des cumuls, l'écriture
// garde le plus grand), donc un percentile se calcule sur les lignes, sans regrouper
// par vue. L'ensemble et les routes sortent de la MÊME instruction (`grouping sets`) :
// les tuiles et le classement disent la même photographie.
//
// « PAS ASSEZ DE DONNÉES » plutôt qu'un zéro : sous `EFFECTIF_MIN_SIGNAL_VUE`
// mesures, percentiles et parts valent `null` et `manque` dit ce qui manque.
//
// Une lecture en échec LÈVE (F02) ; l'écran l'enveloppe dans `section()`.
import { q } from "./db";
import type { FiltersLike } from "./filters";
import { ROUTES_MAX } from "./queries";
import { STARTUP_COLD, STARTUP_WARM } from "./queries-mobile";
import { sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";
import { EFFECTIF_MIN_SIGNAL_VUE, SEUIL_DEFILEMENT_PROFOND, manqueEffectif, type SourceRepere } from "./signaux-vue";

/** Un classement par route, avec la ligne de l'ensemble (toutes routes, y compris sans route). */
export interface ParRoute<L> {
  ensemble: L;
  /** Les routes les plus vues, au plus `cap`, de la plus vue à la moins vue. */
  routes: L[];
  /** Routes distinctes mesurées sur la fenêtre (avant le plafond). */
  routesTotal: number;
  tronque: boolean;
  /** Effectif sous lequel une valeur n'est pas rendue. */
  requis: number;
}

export interface EngagementRoute {
  /** `null` pour la ligne de l'ensemble. */
  route: string | null;
  /** Vues portant un temps passé (`TIME_SPENT`). */
  vues: number;
  /** Temps passé visible, en millisecondes ; `null` sous l'effectif requis. */
  temps_p50_ms: number | null;
  temps_p75_ms: number | null;
  /** « 7 vues, 13 requises », ou `null`. */
  manque: string | null;
  /** Vues portant une profondeur de défilement (`SCROLL_DEPTH`). */
  defilement_n: number;
  /** Médiane de la profondeur maximale atteinte, en pour cent (0-100). */
  defilement_p50_pct: number | null;
  /** Part (0..1) des vues dont le défilement atteint `SEUIL_DEFILEMENT_PROFOND` %. */
  part_defilement_profond: number | null;
  manque_defilement: string | null;
}

export interface ChargementSpaRoute {
  route: string | null;
  /** Changements d'écran SPA mesurés jusqu'au calme du DOM et du réseau (`SPA_LOAD`). */
  n: number;
  p50_ms: number | null;
  p75_ms: number | null;
  manque: string | null;
}

export interface PoidsVueRoute {
  route: string | null;
  /** Vues portant un nombre de ressources (`RESOURCE_COUNT`). */
  vues: number;
  /** Médiane du nombre de ressources chargées par vue. */
  ressources_p50: number | null;
  manque: string | null;
  /** Vues portant un poids transféré (`RESOURCE_BYTES`). */
  octets_n: number;
  /** p75 des octets transférés par vue (somme des `transferSize`). */
  octets_p75: number | null;
  manque_octets: string | null;
}

export interface RepereNom {
  /** Nom tel qu'émis : `mark:<nom>`, `measure:<nom>`, ou le nom d'un `addTiming`. */
  nom: string;
  source: SourceRepere;
  n: number;
  /** En millisecondes : instant depuis le début de la vue (mark) ou durée (measure, manuel). */
  p50_ms: number | null;
  p75_ms: number | null;
  manque: string | null;
}

export interface Reperes {
  reperes: RepereNom[];
  /** Noms distincts sur la fenêtre (avant le plafond). */
  total: number;
  tronque: boolean;
  requis: number;
}

/** Plafond par défaut de la liste des repères : au-delà, un tableau ne se lit plus. */
export const REPERES_MAX = 50;

// node-postgres rend `percentile_cont` en nombre, mais un `numeric` en chaîne : tout
// passe par ici, et une valeur absente reste `null`.
const nombre = (v: unknown): number | null => (v == null ? null : Number(v));
const sousEffectif = (n: number, v: unknown): number | null => (n >= EFFECTIF_MIN_SIGNAL_VUE ? nombre(v) : null);

type Niveau = { niveau: "ensemble" | "route"; groupes: number };

/** Sépare l'ensemble des routes ; l'ensemble manque seulement si la requête n'a rien rendu. */
function assembler<L, R extends Niveau>(rows: R[], ligne: (r: R) => L, vide: L): ParRoute<L> {
  const ensemble = rows.find((r) => r.niveau === "ensemble");
  const routes = rows.filter((r) => r.niveau === "route");
  const routesTotal = routes[0]?.groupes ?? 0;
  return {
    ensemble: ensemble ? ligne(ensemble) : vide,
    routes: routes.map(ligne),
    routesTotal,
    tronque: routesTotal > routes.length,
    requis: EFFECTIF_MIN_SIGNAL_VUE,
  };
}

/**
 * Agrège `rum_metric` par route ET pour l'ensemble, sur les noms donnés. `colonnes`
 * : les agrégats (sur `x.name`, `x.value`), dont un `<tri>` entier qui ordonne les
 * routes. Les routes nulles n'entrent que dans l'ensemble.
 */
async function parRouteSql<R>(f: FiltersLike, noms: readonly string[], colonnes: string, tri: string, cap: number): Promise<(R & Niveau)[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  const liste = sql.bind([...noms]);
  return await q<R & Niveau>(
    `with x as (
       select m.route, m.name, m.value
         from rum_metric m
         ${sessionJoin("m", "s")}
        where m.name = any(${liste}::text[])${where}
     ),
     g as (
       select case when grouping(x.route) = 1 then 'ensemble' else 'route' end as niveau,
              x.route,
              ${colonnes}
         from x
        group by grouping sets ((x.route), ())
     ),
     r as (
       select g.*,
              count(*) over (partition by g.niveau)::int as groupes,
              row_number() over (partition by g.niveau order by g.${tri} desc, g.route asc) as rang
         from g
        where g.niveau = 'ensemble' or g.route is not null
     )
     select * from r where niveau = 'ensemble' or rang <= ${Number(cap)}
      order by niveau, rang`,
    sql.params,
  );
}

const P = (q: number, nom: string) => `percentile_cont(${q}) within group (order by x.value) filter (where x.name = '${nom}')`;
const N = (nom: string, condition = "") => `count(*) filter (where x.name = '${nom}'${condition})::int`;

/**
 * Engagement par route : vues mesurées, temps passé visible p50/p75 (ms), défilement
 * maximal p50 (%), part des vues qui atteignent `SEUIL_DEFILEMENT_PROFOND` %.
 */
export async function engagementParRoute(f: FiltersLike, cap = ROUTES_MAX): Promise<ParRoute<EngagementRoute>> {
  type Lue = { route: string | null; vues: number; t50: unknown; t75: unknown; dn: number; d50: unknown; dprofond: number };
  const rows = await parRouteSql<Lue>(
    f,
    ["TIME_SPENT", "SCROLL_DEPTH"],
    `${N("TIME_SPENT")} as vues,
              ${P(0.5, "TIME_SPENT")} as t50,
              ${P(0.75, "TIME_SPENT")} as t75,
              ${N("SCROLL_DEPTH")} as dn,
              ${P(0.5, "SCROLL_DEPTH")} as d50,
              ${N("SCROLL_DEPTH", ` and x.value >= ${SEUIL_DEFILEMENT_PROFOND}`)} as dprofond`,
    "vues",
    cap,
  );
  const ligne = (r: Lue): EngagementRoute => ({
    route: r.route,
    vues: r.vues,
    temps_p50_ms: sousEffectif(r.vues, r.t50),
    temps_p75_ms: sousEffectif(r.vues, r.t75),
    manque: manqueEffectif(r.vues, "vue"),
    defilement_n: r.dn,
    defilement_p50_pct: sousEffectif(r.dn, r.d50),
    part_defilement_profond: r.dn >= EFFECTIF_MIN_SIGNAL_VUE ? r.dprofond / r.dn : null,
    manque_defilement: manqueEffectif(r.dn, "vue"),
  });
  return assembler(rows, ligne, ligne({ route: null, vues: 0, t50: null, t75: null, dn: 0, d50: null, dprofond: 0 }));
}

/** Changements d'écran SPA par route (la route d'ARRIVÉE) : nombre, `SPA_LOAD` p50/p75 (ms). */
export async function chargementsSpaParRoute(f: FiltersLike, cap = ROUTES_MAX): Promise<ParRoute<ChargementSpaRoute>> {
  type Lue = { route: string | null; n: number; p50: unknown; p75: unknown };
  const rows = await parRouteSql<Lue>(
    f,
    ["SPA_LOAD"],
    `${N("SPA_LOAD")} as n,
              ${P(0.5, "SPA_LOAD")} as p50,
              ${P(0.75, "SPA_LOAD")} as p75`,
    "n",
    cap,
  );
  const ligne = (r: Lue): ChargementSpaRoute => ({
    route: r.route,
    n: r.n,
    p50_ms: sousEffectif(r.n, r.p50),
    p75_ms: sousEffectif(r.n, r.p75),
    manque: manqueEffectif(r.n, "chargement"),
  });
  return assembler(rows, ligne, ligne({ route: null, n: 0, p50: null, p75: null }));
}

/** Poids des vues par route : ressources par vue (p50), octets transférés par vue (p75). */
export async function poidsDesVuesParRoute(f: FiltersLike, cap = ROUTES_MAX): Promise<ParRoute<PoidsVueRoute>> {
  type Lue = { route: string | null; vues: number; r50: unknown; octn: number; o75: unknown };
  const rows = await parRouteSql<Lue>(
    f,
    ["RESOURCE_COUNT", "RESOURCE_BYTES"],
    `${N("RESOURCE_COUNT")} as vues,
              ${P(0.5, "RESOURCE_COUNT")} as r50,
              ${N("RESOURCE_BYTES")} as octn,
              ${P(0.75, "RESOURCE_BYTES")} as o75`,
    "vues",
    cap,
  );
  const ligne = (r: Lue): PoidsVueRoute => ({
    route: r.route,
    vues: r.vues,
    ressources_p50: sousEffectif(r.vues, r.r50),
    manque: manqueEffectif(r.vues, "vue"),
    octets_n: r.octn,
    octets_p75: sousEffectif(r.octn, r.o75),
    manque_octets: manqueEffectif(r.octn, "vue"),
  });
  return assembler(rows, ligne, ligne({ route: null, vues: 0, r50: null, octn: 0, o75: null }));
}

/**
 * Repères du développeur par nom : `performance.mark` / `performance.measure` relevés
 * par le SDK (`mark:<nom>`, `measure:<nom>`) et `addTiming` manuels. Les démarrages
 * de l'app mobile, aussi des timings, restent sur /mobile.
 */
export async function reperesParNom(f: FiltersLike, cap = REPERES_MAX): Promise<Reperes> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  const mobiles = sql.bind([STARTUP_COLD, STARTUP_WARM]);
  const rows = await q<{ nom: string; source: SourceRepere; n: number; p50: unknown; p75: unknown; groupes: number }>(
    `with g as (
       select e.name as nom,
              case when e.name like 'mark:%' then 'mark'
                   when e.name like 'measure:%' then 'measure'
                   else 'manuel' end as source,
              count(*)::int as n,
              percentile_cont(0.5) within group (order by e.timing_ms) as p50,
              percentile_cont(0.75) within group (order by e.timing_ms) as p75
         from rum_event e
         ${sessionJoin("e", "s")}
        where e.event_type = 'timing' and e.timing_ms is not null
          and e.name <> all(${mobiles}::text[])${where}
        group by e.name
     )
     select g.*, count(*) over ()::int as groupes
       from g
      order by g.n desc, g.nom asc
      limit ${Number(cap)}`,
    sql.params,
  );
  const total = rows[0]?.groupes ?? 0;
  return {
    reperes: rows.map((r) => ({
      nom: r.nom,
      source: r.source,
      n: r.n,
      p50_ms: sousEffectif(r.n, r.p50),
      p75_ms: sousEffectif(r.n, r.p75),
      manque: manqueEffectif(r.n, "mesure"),
    })),
    total,
    tronque: total > rows.length,
    requis: EFFECTIF_MIN_SIGNAL_VUE,
  };
}
