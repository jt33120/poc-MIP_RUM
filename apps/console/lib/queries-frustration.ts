// Signaux de frustration (P1) — lecture console. Rage/dead clicks stockés dans
// rum_event ('frustration.<kind>') ; attribution INP (élément lent) dans
// rum_metric.attribution. Requête commune P6.2 (plage, périmètre, filtres, bots)
// compilée en paramètres liés. Une lecture en échec LÈVE (F02) : elle rendait
// autrefois `[]`, soit « Aucun signal » et des tuiles à 0 pendant une panne.
// L'écran l'enveloppe dans `lire()` (lib/lecture.ts) et dit « Lecture en échec ».
import { q } from "./db";
import { type Filters } from "./filters";
import { sessionJoin } from "./query-compiler";
import { sqlContext } from "./query-sql";
import { plageLue } from "./queries";
import { MOBILE_RUNTIME } from "./queries-mobile";

export interface FrustrationRow {
  route: string;
  kind: "rage" | "dead" | "error";
  target: string;
  n: number;
}

/** Top des signaux de frustration (rage + dead + error clicks), groupés par route/cible. */
export async function topFrustrations(f: Filters): Promise<FrustrationRow[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "custom_events", row: "e", session: "s", time: "e.ts" });
  return await q<FrustrationRow>(
    `select coalesce(e.route, '(inconnu)') as route,
            replace(e.name, 'frustration.', '') as kind,
            coalesce(e.props->>'target', '(inconnu)') as target,
            count(*)::int as n
     from rum_event e
     ${sessionJoin("e", "s")}
     where e.name in ('frustration.rage', 'frustration.dead', 'frustration.error')${where}
     group by 1, 2, 3
     order by n desc
     limit 50`,
    sql.params,
  );
}

export interface InpOffender {
  target: string;
  n: number;
  p75: number;
  worst: number;
}

/**
 * Éléments responsables des interactions lentes (attribution INP) : le sélecteur
 * `interactionTarget` de web-vitals, classé par p75 de la latence INP.
 */
export async function inpOffenders(f: Filters): Promise<InpOffender[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "vitals", row: "m", session: "s", time: "m.ts" });
  return await q<InpOffender>(
    `select coalesce(m.attribution->>'interactionTarget', '(inconnu)') as target,
            count(*)::int as n,
            percentile_cont(0.75) within group (order by m.value) as p75,
            max(m.value) as worst
     from rum_metric m
     ${sessionJoin("m", "s")}
     where m.name = 'INP' and m.attribution is not null${where}
     group by 1
     order by p75 desc nulls last
     limit 20`,
    sql.params,
  );
}


export interface ScriptBloquant {
  /** URL du script, déjà nettoyée de sa query string à la collecte. */
  url: string;
  /** Nom de fonction, ou ce qui a invoqué le script quand la fonction est minifiée. */
  quoi: string;
  n: number;
  /** Somme du temps de blocage attribué, en millisecondes. */
  totalMs: number;
  /** La pire frame observée. */
  worstMs: number;
}

/**
 * Les scripts qui bloquent le fil principal, classés par temps de blocage CUMULÉ.
 *
 * POURQUOI LE CUMUL ET NON LE PIRE CAS. Un script qui bloque 400 ms une fois est
 * un incident ; un script qui bloque 60 ms à chaque frappe au clavier est le
 * problème. Classer par maximum remonte le premier et enterre le second, alors
 * que c'est le second qui décide de l'INP. Le pire cas reste affiché à côté —
 * il dit s'il faut chercher une opération unique ou une répétition.
 *
 * `blocking_ms` de préférence à `duration_ms` : la durée compte tout le cycle de
 * rendu, y compris la part que le navigateur aurait passée à peindre de toute
 * façon. Le blocage est la part que l'utilisateur SUBIT. Repli sur la durée pour
 * les navigateurs qui ne renseignent pas le champ.
 *
 * Ne rend QUE des lignes attribuées (`script_url is not null`) : une entrée
 * Long Tasks n'a pas de script, et l'afficher sous « (inconnu) » ferait une
 * première ligne écrasante qui n'apprend rien.
 */
export async function scriptsBloquants(f: Filters): Promise<ScriptBloquant[]> {
  const sql = await sqlContext(f);
  const where = sql.where({ dataset: "longtasks", row: "l", session: "s", time: "l.ts" });
  return await q<ScriptBloquant>(
    `select l.script_url as url,
            coalesce(nullif(l.script_function, ''), nullif(l.invoker, ''), '(anonyme)') as quoi,
            count(*)::int as n,
            round(sum(coalesce(l.blocking_ms, l.duration_ms))::numeric)::float as "totalMs",
            round(max(coalesce(l.blocking_ms, l.duration_ms))::numeric)::float as "worstMs"
     from rum_longtask l
     ${sessionJoin("l", "s")}
     where l.script_url is not null${where}
     group by 1, 2
     order by "totalMs" desc
     limit 20`,
    sql.params,
  );
}

// ═══════════════════ Interactions : tuiles et hero de /ux (F22) ═══════════════════
//
// Registre : plan § 4.5 et § 5.4.2. Deux défauts de `topFrustrations` commandent ces
// lectures (CP5) : elle coupe à 50 couples route × type × cible — un total calculé en
// sommant ses lignes est FAUX dès qu'il y a plus de 50 couples — et elle ne dit rien
// des sessions. Ici, des comptes entiers et des sessions distinctes.
//
// LA GARDE DE CAPTEUR (CP16, R-F). Le SDK navigateur et l'extension émettent
// `frustration.rage|dead|error` ; le SDK React Native n'en émet AUCUN. Une session
// `runtime = 'react_native'` a donc zéro signal par construction : la compter au
// dénominateur ferait lire « personne ne s'acharne » là où personne n'écoute.
// Numérateurs et dénominateurs sont restreints aux sessions dont le capteur émet
// (runtime autre que `MOBILE_RUNTIME`, ou NULL : navigateur, ingestion antérieure à
// v82). Sans la colonne `runtime` (avant v82), rien n'est restreint et l'écran le dit.

/** `rum_session.runtime` (v82) présente ? Sondée à chaque lecture, comme `mobileSchema`. */
async function runtimeDeclare(): Promise<boolean> {
  const [row] = await q<{ runtime: boolean }>(
    `select exists(select 1 from information_schema.columns
             where table_schema='public' and table_name='rum_session' and column_name='runtime') as runtime`,
  );
  return row?.runtime === true;
}

/** Une session (alias `s`) dont le capteur émet des signaux de frustration. */
function capteurEmet(runtimeLu: boolean, s: string, mobile: string): string {
  return runtimeLu ? `(${s}.runtime is null or ${s}.runtime <> ${mobile})` : "true";
}

export type TypeSignal = "rage" | "dead" | "error";
const TYPES_SIGNAL: readonly TypeSignal[] = ["rage", "dead", "error"];

export interface CapteurFrustration {
  /** Sessions de la base dont le capteur émet (navigateur, extension, runtime inconnu). */
  sessionsCouvertes: number;
  /** Sessions de la base : au moins une vue dans la fenêtre (définition de `sessionsAvecVue`). */
  sessionsTotal: number;
  /** `false` : colonne `runtime` absente (avant v82), aucune session n'a pu être écartée. */
  runtimeLu: boolean;
}

export interface FrustrationTotaux {
  /** Par type : signaux émis (compte ENTIER, jamais borné) et sessions distinctes qui les portent. */
  parType: { kind: TypeSignal; n: number; sessions: number }[];
  capteur: CapteurFrustration;
  /**
   * Sessions COUVERTES de la base portant au moins un signal (tous types, puis par
   * type) : numérateur du taux de l'ensemble, référence du hero par route.
   */
  baseTouchee: Record<"tous" | TypeSignal, number>;
}

/**
 * Totaux des signaux de frustration (tuiles de `/ux`, § 5.4.2), avec la garde de
 * capteur.
 *
 * `sessionsTotal` — ÉCART au registre, qui dit « sessions commencées » : `/ux`
 * accepte des filtres de route, de release et d'environnement, que les sessions ne
 * portent pas (le jeu `sessions` les refuserait). La base est donc celle des sessions
 * ayant au moins une vue dans la fenêtre sous les MÊMES filtres que les signaux — la
 * définition unique de `sessionsAvecVue` (R-P) : un clic suppose une page.
 */
export async function frustrationTotaux(f: Filters, shift = false): Promise<FrustrationTotaux> {
  const runtimeLu = await runtimeDeclare();
  const sql = await sqlContext(f);
  const range = plageLue(sql.query.range, shift);
  const vues = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at", range });
  const signaux = sql.where({ dataset: "custom_events", row: "e", session: "se", time: "e.ts", range });
  // Liée seulement si elle sert : un paramètre sans `$n` fait refuser l'instruction.
  const mobile = runtimeLu ? sql.bind(MOBILE_RUNTIME) : "";
  const parType = TYPES_SIGNAL.map(
    (k) => `count(*) filter (where kind = '${k}')::int as n_${k},
            count(distinct (app_id, session_id)) filter (where kind = '${k}' and session_id is not null)::int as s_${k}`,
  ).join(",\n            ");
  const touchees = TYPES_SIGNAL.map(
    (k) => `count(*) filter (where b.couverte and exists (
              select 1 from signaux x where x.app_id = b.app_id and x.session_id = b.session_id and x.kind = '${k}'))::int as t_${k}`,
  ).join(",\n            ");
  const [row] = await q<Record<string, number>>(
    `with base as (
       select distinct p.app_id, p.session_id, ${capteurEmet(runtimeLu, "s", mobile)} as couverte
         from rum_pageview p
         ${sessionJoin("p", "s")}
        where p.session_id is not null${vues}
     ), signaux as (
       select e.app_id, e.session_id, replace(e.name, 'frustration.', '') as kind
         from rum_event e
         ${sessionJoin("e", "se")}
        where e.name in ('frustration.rage', 'frustration.dead', 'frustration.error')
          and ${capteurEmet(runtimeLu, "se", mobile)}${signaux}
     ), comptes as (
       select ${parType}
         from signaux
     ), base_comptee as (
       select count(*)::int as sessions_total,
              count(*) filter (where b.couverte)::int as sessions_couvertes,
              count(*) filter (where b.couverte and exists (
                select 1 from signaux x where x.app_id = b.app_id and x.session_id = b.session_id))::int as t_tous,
              ${touchees}
         from base b
     )
     select * from comptes, base_comptee`,
    sql.params,
  );
  const lu = (cle: string) => Number(row?.[cle] ?? 0);
  return {
    parType: TYPES_SIGNAL.map((kind) => ({ kind, n: lu(`n_${kind}`), sessions: lu(`s_${kind}`) })),
    capteur: { sessionsCouvertes: lu("sessions_couvertes"), sessionsTotal: lu("sessions_total"), runtimeLu },
    baseTouchee: { tous: lu("t_tous"), rage: lu("t_rage"), dead: lu("t_dead"), error: lu("t_error") },
  };
}

export interface FrustrationRoute {
  /** `null` : signal ou vue sans route (« Inconnu » à l'écran). */
  route: string | null;
  rage: number;
  dead: number;
  error: number;
  /** Sessions de la route (au moins une vue de la route) portant un signal SUR la route. */
  sessionsTouchees: number;
  /** Sessions ayant au moins une vue de la route dans la fenêtre. */
  sessionsRoute: number;
}

/**
 * Routes et leurs signaux (hero « Routes les plus frustrantes », § 5.4.2) : par route,
 * les comptes par type et la part des sessions de la route qui portent au moins un
 * signal — un TAUX, donc une gravité (un compte brut classerait par trafic).
 *
 * Numérateur INCLUS dans le dénominateur (jointure, comme `partSessionsTouchees`) :
 * une session touchée sur la route sans vue de la route dans la fenêtre n'y entre
 * pas. Les deux sont restreints aux sessions dont le capteur émet (CP16). Les comptes
 * par type, eux, portent sur tous les signaux de la route.
 *
 * `type` (écart au registre, paramètre d'écran `type=`, § 3.1) : les comptes et les
 * sessions touchées ne retiennent que ce type de signal.
 */
export async function frustrationParRoute(f: Filters, type: TypeSignal | null = null): Promise<FrustrationRoute[]> {
  const runtimeLu = await runtimeDeclare();
  const sql = await sqlContext(f);
  const vues = sql.where({ dataset: "views", row: "p", session: "s", time: "p.started_at" });
  const signaux = sql.where({ dataset: "custom_events", row: "e", session: "se", time: "e.ts" });
  // Liée seulement si elle sert : un paramètre sans `$n` fait refuser l'instruction.
  const mobile = runtimeLu ? sql.bind(MOBILE_RUNTIME) : "";
  const noms = type ? [`frustration.${type}`] : TYPES_SIGNAL.map((k) => `frustration.${k}`);
  const rows = await q<FrustrationRoute>(
    `with vues as (
       select distinct p.app_id, p.session_id, p.route
         from rum_pageview p
         ${sessionJoin("p", "s")}
        where p.session_id is not null and ${capteurEmet(runtimeLu, "s", mobile)}${vues}
     ), signaux as (
       select e.app_id, e.session_id, e.route, replace(e.name, 'frustration.', '') as kind
         from rum_event e
         ${sessionJoin("e", "se")}
        where e.name = any(${sql.bind(noms)}::text[]) and ${capteurEmet(runtimeLu, "se", mobile)}${signaux}
     ), routes as (
       select route from vues union select route from signaux
     ), comptes as (
       select route,
              count(*) filter (where kind = 'rage')::int as rage,
              count(*) filter (where kind = 'dead')::int as dead,
              count(*) filter (where kind = 'error')::int as error
         from signaux
        group by route
     ), touchees as (
       select v.route,
              count(*)::int as sessions_route,
              count(*) filter (where exists (
                select 1 from signaux x
                 where x.app_id = v.app_id and x.session_id = v.session_id and x.route is not distinct from v.route
              ))::int as sessions_touchees
         from vues v
        group by v.route
     )
     select r.route,
            coalesce(c.rage, 0)::int as rage, coalesce(c.dead, 0)::int as dead, coalesce(c.error, 0)::int as error,
            coalesce(t.sessions_touchees, 0)::int as "sessionsTouchees",
            coalesce(t.sessions_route, 0)::int as "sessionsRoute"
       from routes r
       left join comptes c on c.route is not distinct from r.route
       left join touchees t on t.route is not distinct from r.route
      order by "sessionsRoute" desc, r.route nulls last`,
    sql.params,
  );
  return rows;
}
