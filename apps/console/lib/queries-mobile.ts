// Lectures de l'écran `/mobile` et de `GET /api/v1/mobile/summary` (P7.5).
//
// UNE COHORTE, UNE FENÊTRE, UNE PHOTOGRAPHIE. Toutes les mesures partent de la
// MÊME population — les sessions dont le runtime déclaré est `react_native`,
// commencées dans la fenêtre — et de la même transaction en lecture répétable.
// Sans cela, les cartes d'un même écran répondraient à des questions
// légèrement différentes, et le taux de sessions sans erreur JS aurait un
// numérateur et un dénominateur issus de deux populations.
//
// LE RUNTIME EST DÉCLARÉ, PAS DÉDUIT (migration-v82). Avant cette colonne, la
// seule façon de désigner « les sessions React Native » était `os in (iOS,
// Android) and browser is null` — une devinette fausse dans les deux sens. Un
// taux dont le dénominateur est une devinette n'est pas un taux.
//
// CE QUI N'EST PAS MESURÉ ICI, ET POURQUOI IL N'Y A PAS DE ZÉRO. Crashes
// natifs, ANR et démarrage natif ne sont pas observables depuis le runtime
// JavaScript ; aucune ligne ne les porte. Le modèle de capacités les déclare
// `unavailable`, et l'écran affiche « Non collecté ». Aucune fonction de ce
// fichier ne rend 0 pour eux : elles ne les lisent pas du tout.
import { q, tx } from "./db";
import { queryOf, type FiltersLike } from "./filters";
import { compileScope, compileWhereOrThrow, type DimensionSchema } from "./query-compiler";
import { conditionsOf, type AnalyticsQuery, type FilterCondition } from "./query-contract";
import { dimensionSchema } from "./query-schema";
import {
  ERROR_FREE_REASONS,
  RAISON_SANS_RUNTIME,
  RAISON_SANS_SOURCE_JS,
  capabilityMatrix,
  chainerReleases,
  errorFreeSessionRate,
  etatCapaciteParRelease,
  tauxSansErreurDeclarant,
  type CapabilityDeclaration,
  type CapabilityState,
  type CapabilityStatus,
  type DeclarationApp,
  type ErrorFreeUnavailable,
  type MobileCapability,
} from "./mobile-capabilities";

/** Le seul runtime mobile du modèle. Un navigateur n'a ni crash natif ni ANR. */
export const MOBILE_RUNTIME = "react_native" as const;

/** Noms EXACTS des mesures de démarrage JS émises par le SDK (P7.3). */
export const STARTUP_COLD = "js_start_to_first_screen_ms";
export const STARTUP_WARM = "js_warm_start_to_first_screen_ms";

/** Erreurs de la couche JavaScript React Native (enveloppe P5.1, colonne v69). */
export const MOBILE_ERROR_SOURCE = "react_native_js";

/** Bornes des listes : un écran ne classe pas 10 000 lignes, il en montre dix. */
export const TOP_LIMIT = 10;

// ─────────────────────────────── Types rendus ────────────────────────────────

export interface MobileSchema {
  /** `rum_session.runtime` (v82) : sans elle, aucune cohorte n'est identifiable. */
  runtime: boolean;
  /** Table `mobile_capabilities` (v82). */
  capabilities: boolean;
  /** `rum_error.error_source` (v69) : sans elle, les erreurs JS ne sont pas distinguables. */
  errorSource: boolean;
  dimensions: DimensionSchema;
}

export interface MobileSessions {
  /** Sessions React Native COMMENCÉES dans la fenêtre. Un vide réel vaut 0. */
  sessions: number;
  /**
   * Visiteurs distincts de ces sessions. `null` quand aucune session ne porte
   * d'identifiant : « inconnu », jamais 0 — et jamais additionné aux sessions.
   */
  visitors: number | null;
  /** Sessions dont l'identifiant de visiteur est absent : la part non attribuable. */
  sessions_without_visitor: number;
}

export interface MobileJsErrors {
  /** Somme des occurrences reçues (le SDK déduplique et joint son compte). */
  occurrences: number;
  /** Erreurs non interceptées (`kind='crash'`). */
  crashes: number;
  /** Rejets de promesses non gérés (`kind='unhandledrejection'`). */
  unhandled_rejections: number;
  /** Occurrences déclarées FATALES par le moteur. `null` si aucune ligne ne le dit. */
  fatal: number | null;
  /** Sessions de la cohorte portant au moins une erreur JS. */
  sessions_affected: number;
}

export interface MobileStartupMeasure {
  samples: number;
  p50_ms: number | null;
  p75_ms: number | null;
  p95_ms: number | null;
}

export interface MobileStartup {
  /** Depuis `init()` jusqu'au premier écran DÉCLARÉ rendu. Jamais le démarrage natif. */
  cold: MobileStartupMeasure | null;
  /** Depuis le retour au premier plan. Distinct du démarrage à froid, jamais mélangé. */
  warm: MobileStartupMeasure | null;
}

export interface MobileScreen {
  route: string | null;
  views: number;
  sessions: number;
}

export interface MobileResource {
  path: string;
  method: string | null;
  calls: number;
  p75_ms: number | null;
  max_ms: number | null;
  errors: number;
}

export interface MobileSampling {
  min_inclusion_probability: number | null;
  message: string | null;
}

export interface MobileSummary {
  capabilities: CapabilityStatus[];
  /** Déclarations brutes : quelle release dit quoi, et depuis quand. */
  declarations: CapabilityDeclaration[];
  sessions: MobileSessions;
  js_errors: MobileJsErrors | null;
  js_error_free_session_rate: number | null;
  js_error_free_unavailable_reason: ErrorFreeUnavailable | null;
  startup: MobileStartup;
  screens: MobileScreen[];
  resources: MobileResource[];
  sampling: MobileSampling;
  /** Ce que le schéma déployé ne permet pas encore de lire. Vide = complet. */
  unavailable: string[];
}

// ───────────────────────────── Sonde de schéma ───────────────────────────────

/**
 * Le schéma déployé porte-t-il ce que cet écran lit ?
 *
 * La console est publiée AVANT que la migration ne tourne : lire
 * `s.runtime` pendant cette fenêtre ferait échouer l'écran ENTIER. La sonde est
 * rejouée à chaque lecture — jamais mémorisée ici — pour basculer dès le passage
 * de la migration, sans redémarrage.
 */
export async function mobileSchema(): Promise<MobileSchema> {
  const [[row], dimensions] = await Promise.all([
    q<{ runtime: boolean; capabilities: boolean; error_source: boolean }>(
      `select exists(select 1 from information_schema.columns
               where table_schema='public' and table_name='rum_session' and column_name='runtime') as runtime,
              to_regclass('public.mobile_capabilities') is not null as capabilities,
              exists(select 1 from information_schema.columns
               where table_schema='public' and table_name='rum_error' and column_name='error_source') as error_source`,
    ),
    dimensionSchema(),
  ]);
  return {
    runtime: row?.runtime === true,
    capabilities: row?.capabilities === true,
    errorSource: row?.error_source === true,
    dimensions,
  };
}

// ────────────────────────────── Base commune ─────────────────────────────────

type Lecture = <T>(sql: string, params: unknown[]) => Promise<T[]>;

/**
 * Une photographie et une horloge pour toutes les instructions. `set transaction`
 * DOIT être la première : PostgreSQL la refuse après la moindre requête.
 */
function snapshot<T>(fn: (lire: Lecture) => Promise<T>): Promise<T> {
  return tx(async (client) => {
    await client.query("set transaction isolation level repeatable read read only");
    return fn(async <R>(sql: string, params: unknown[]) => (await client.query(sql, params)).rows as R[]);
  });
}

interface Base {
  /** CTE `cohorte` : les sessions React Native de la fenêtre, app comprise. */
  cte: string;
  params: unknown[];
  bind: (value: unknown) => string;
}

/**
 * La release d'une application MOBILE est stable pour toute une session, et
 * c'est ce qui autorise à la filtrer sur la cohorte.
 *
 * Le contrat P6 range `release` parmi les dimensions D'OCCURRENCE, et le jeu de
 * données `sessions` ne la porte donc pas. La raison est écrite dans
 * `query-compiler.ts` : sur le web, une mise en production PENDANT la visite
 * change la release, et la relire sur la session réécrirait le passé.
 *
 * Un binaire mobile, lui, ne se remplace pas sous les pieds de l'utilisateur :
 * changer de version exige un redémarrage, donc une nouvelle session.
 * `rum_session.release` est ici un fait exact, pas un instantané mouvant — et
 * c'est la SEULE façon d'avoir un taux dont le numérateur et le dénominateur
 * parlent de la même population. Filtrer les seules occurrences donnerait des
 * erreurs de la 4.2 rapportées à toutes les sessions du parc.
 */
function conditionsRelease(query: AnalyticsQuery, bind: (v: unknown) => string, schema: MobileSchema): string {
  if (!schema.dimensions.has("rum_session.release")) return "";
  return conditionsOf(query.filters)
    .filter((c: FilterCondition) => c.dimension === "release")
    .map((c) =>
      c.operator === "is_null"
        ? " and s.release is null"
        : ` and s.release ${c.operator === "eq" ? "=" : "<>"} ${bind(c.value)}`,
    )
    .join("");
}

/** La requête sans ses conditions de release : elles sont compilées à part, sur la session. */
function sansRelease(query: AnalyticsQuery): AnalyticsQuery {
  const { release: _release, ...reste } = query.filters;
  return {
    ...query,
    filters: { ...reste, segments: query.filters.segments.filter((c) => c.dimension !== "release") },
  };
}

/**
 * La cohorte, construite ICI et nulle part ailleurs.
 *
 * `app_id` est projeté avec `session_id` : toutes les jointures qui suivent le
 * reprennent. Un émetteur hostile peut citer l'identifiant de session d'un autre
 * tenant ; sans la clef d'app dans la jointure, il lui ferait porter ses
 * erreurs.
 */
function cohorte(query: AnalyticsQuery, schema: MobileSchema): Base {
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;
  // Plage, périmètre d'apps, conditions de session (appareil, plateforme) et
  // exclusion des robots : le contrat commun P6.2. La release est compilée juste
  // après, sur la session — voir `conditionsRelease`.
  const filtres = compileWhereOrThrow(
    sansRelease(query),
    { dataset: "sessions", row: "s", session: "s", time: "s.started_at" },
    schema.dimensions,
    bind,
  );
  // La release et le début de la session sont projetés pour la lecture par release
  // (F38). Sans la colonne `release` (schéma antérieur), la projection vaut NULL :
  // `mobileSummary` ne la lit pas, et `mobileParRelease` refuse avant de l'employer.
  const release = schema.dimensions.has("rum_session.release") ? "s.release" : "null::text as release";
  return {
    params,
    bind,
    cte: `cohorte as (
      select s.session_id, s.app_id, s.visitor_id, ${release}, s.started_at,
             coalesce(s.sample_rate, 1) + (1 - coalesce(s.sample_rate, 1)) * coalesce(s.error_sample_rate, 1)
               as inclusion_probability
        from rum_session s
       where s.runtime = ${bind(MOBILE_RUNTIME)}${filtres}${conditionsRelease(query, bind, schema)}
    )`,
  };
}

/** Prédicats de fenêtre et d'app d'une table enfant, jointe à la cohorte. */
function fenetre(query: AnalyticsQuery, colonne: string, bind: (v: unknown) => string): string {
  return ` and ${colonne} >= ${bind(query.range.from)}::timestamptz and ${colonne} < ${bind(query.range.to)}::timestamptz`;
}

// ────────────────────────────── Les mesures ──────────────────────────────────

const SQL_SESSIONS = `select count(*)::int as sessions,
       count(distinct visitor_id)::int as visitors,
       count(*) filter (where visitor_id is null)::int as sans_visiteur,
       min(inclusion_probability)::float8 as p_min
  from cohorte`;

const SQL_STARTUP = `select ev.name,
       count(*)::int as samples,
       percentile_cont(0.5)  within group (order by ev.timing_ms)::float8 as p50,
       percentile_cont(0.75) within group (order by ev.timing_ms)::float8 as p75,
       percentile_cont(0.95) within group (order by ev.timing_ms)::float8 as p95
  from rum_event ev
  join cohorte c on c.app_id = ev.app_id and c.session_id = ev.session_id`;

/**
 * Avertissement d'échantillonnage, sans pondération (règle P0 : aucune
 * extrapolation, on montre l'incertitude plutôt qu'une estimation).
 */
export function samplingOf(p: number | null | undefined): MobileSampling {
  if (p == null) return { min_inclusion_probability: null, message: null };
  const pct = (p * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return {
    min_inclusion_probability: p,
    message:
      p > 0 && p < 1
        ? `Sessions mobiles observées sur un échantillon (probabilité d'inclusion minimale ${pct} %). Aucune extrapolation n'est appliquée.`
        : null,
  };
}

/**
 * Le résumé complet d'un périmètre mobile.
 *
 * Toute mesure que le schéma déployé ne permet pas de lire vaut `null` et son
 * motif entre dans `unavailable` — jamais 0, qui se lirait comme « rien ne s'est
 * passé » au lieu de « rien n'a été lu ».
 */
export async function mobileSummary(f: FiltersLike, schema?: MobileSchema): Promise<MobileSummary> {
  const etat = schema ?? (await mobileSchema());
  const query = queryOf(f);
  const unavailable: string[] = [];

  if (!etat.runtime) {
    // `sessions: 0` ci-dessous n'est pas un compte : l'écran lit ce motif et affiche
    // « — » (`sessionsCohorte`, F30).
    unavailable.push(RAISON_SANS_RUNTIME);
    return {
      capabilities: capabilityMatrix([]),
      declarations: [],
      sessions: { sessions: 0, visitors: null, sessions_without_visitor: 0 },
      js_errors: null,
      js_error_free_session_rate: null,
      js_error_free_unavailable_reason: "capability_unknown",
      startup: { cold: null, warm: null },
      screens: [],
      resources: [],
      sampling: { min_inclusion_probability: null, message: null },
      unavailable,
    };
  }
  if (!etat.capabilities) {
    unavailable.push("migration v82 partielle : les capacités déclarées ne sont pas lisibles, toutes sont « Inconnu »");
  }
  if (!etat.errorSource) {
    unavailable.push(RAISON_SANS_SOURCE_JS);
  }

  const declarations = etat.capabilities ? await mobileDeclarations(query) : [];
  const capabilities = capabilityMatrix(declarations);
  const jsErrorsState = capabilities.find((c) => c.capability === "js_errors")?.state ?? "unknown";

  return snapshot(async (lire) => {
    const base = cohorte(query, etat);

    const [compte] = await lire<{ sessions: number; visitors: number; sans_visiteur: number; p_min: number | null }>(
      `with ${base.cte} ${SQL_SESSIONS}`,
      base.params,
    );
    const sessions: MobileSessions = {
      sessions: compte?.sessions ?? 0,
      // Aucune session porteuse d'identifiant : « inconnu », pas 0 visiteur.
      visitors: compte && compte.visitors > 0 ? compte.visitors : null,
      sessions_without_visitor: compte?.sans_visiteur ?? 0,
    };

    const jsErrors = etat.errorSource ? await lireErreursJs(lire, query, etat) : null;
    const { rate, reason } = errorFreeSessionRate({
      sessions: sessions.sessions,
      sessionsWithJsError: jsErrors?.sessions_affected ?? 0,
      jsErrorsState,
    });

    // Séquentiel, et non `Promise.all` : une transaction tient UNE connexion, et
    // paralléliser dessus ne gagne rien tout en rendant l'ordre des instructions
    // imprévisible en cas d'erreur.
    const startup = await lireDemarrage(lire, query, etat);
    const screens = await lireEcrans(lire, query, etat);
    const resources = await lireRequetes(lire, query, etat);

    return {
      capabilities,
      declarations,
      sessions,
      js_errors: jsErrors,
      js_error_free_session_rate: rate,
      js_error_free_unavailable_reason: reason,
      startup,
      screens,
      resources,
      sampling: samplingOf(compte?.p_min ?? null),
      unavailable,
    };
  });
}

/**
 * Déclarations de capacités du périmètre.
 *
 * Hors transaction de mesure et SANS fenêtre : une déclaration n'est pas une
 * occurrence. La borner à la fenêtre ferait disparaître les capacités d'une
 * application qui n'a pas émis depuis une heure — et l'écran annoncerait
 * « Inconnu » pour une application parfaitement instrumentée. `last_declared_at`
 * dit depuis quand on n'a plus rien entendu ; l'écran l'affiche.
 *
 * La release du contrat filtre, quand elle est demandée : la question « que
 * collecte la 4.2 ? » n'a pas la même réponse que « que collecte le parc ? ».
 */
export async function mobileDeclarations(query: AnalyticsQuery): Promise<CapabilityDeclaration[]> {
  // La forme publique (API v1, `MobileCapabilityDeclaration`) ne porte pas l'app.
  return (await declarationsParApp(query)).map(({ app_id: _app, ...d }) => d);
}

/**
 * Les mêmes déclarations, AVEC l'app qui les a émises (F38) : la stabilité par
 * release juge l'état de collecte d'une release DANS son app.
 */
async function declarationsParApp(query: AnalyticsQuery): Promise<DeclarationApp[]> {
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const perimetre = compileScope(query, "mc.app_id", bind);
  const release = query.filters.release ? ` and mc.release = ${bind(query.filters.release)}` : "";
  const rows = await q<{
    app_id: string;
    capability: string;
    runtime: string;
    release: string | null;
    declared: boolean;
    first_declared_at: Date;
    last_declared_at: Date;
    verified_at: Date | null;
    verified_by: string | null;
  }>(
    `select mc.app_id, mc.capability, mc.runtime, mc.release, mc.declared,
            mc.first_declared_at, mc.last_declared_at, mc.verified_at, mc.verified_by
       from mobile_capabilities mc
      where mc.runtime = ${bind(MOBILE_RUNTIME)}${perimetre}${release}
      order by mc.capability, mc.release nulls first, mc.app_id`,
    params,
  );
  return rows.map((r) => ({
    app_id: r.app_id,
    capability: r.capability as MobileCapability,
    runtime: r.runtime,
    release: r.release,
    declared: r.declared,
    first_declared_at: r.first_declared_at.toISOString(),
    last_declared_at: r.last_declared_at.toISOString(),
    verified_at: r.verified_at ? r.verified_at.toISOString() : null,
    verified_by: r.verified_by,
  }));
}

/**
 * Erreurs JavaScript de la cohorte.
 *
 * SOMME des occurrences, pas comptage de lignes : le SDK déduplique une erreur
 * qui se répète et joint le nombre qu'il a tu. Compter les lignes
 * sous-estimerait précisément la boucle qu'on veut voir.
 *
 * `fatal` vaut `null` quand aucune ligne ne renseigne `is_fatal` : avant P7.3,
 * le SDK jetait l'information que le moteur lui donnait, et toutes ces lignes
 * portent NULL. Les compter pour 0 annoncerait « aucune erreur fatale » sur des
 * erreurs dont on ignore la fatalité.
 */
async function lireErreursJs(lire: Lecture, query: AnalyticsQuery, schema: MobileSchema): Promise<MobileJsErrors> {
  const base = cohorte(query, schema);
  const perimetre = compileScope(query, "e.app_id", base.bind);
  const [row] = await lire<{
    occurrences: number;
    crashes: number;
    rejections: number;
    fatal: number | null;
    sessions_affected: number;
  }>(
    `with ${base.cte}
     select coalesce(sum(e.occurrences), 0)::float8 as occurrences,
            coalesce(sum(e.occurrences) filter (where e.kind = 'crash'), 0)::float8 as crashes,
            coalesce(sum(e.occurrences) filter (where e.kind = 'unhandledrejection'), 0)::float8 as rejections,
            sum(e.occurrences) filter (where e.is_fatal)::float8 as fatal,
            count(distinct e.session_id)::int as sessions_affected
       from rum_error e
       join cohorte c on c.app_id = e.app_id and c.session_id = e.session_id
      where e.error_source = ${base.bind(MOBILE_ERROR_SOURCE)}${perimetre}${fenetre(query, "e.ts", base.bind)}`,
    base.params,
  );
  return {
    occurrences: Number(row?.occurrences ?? 0),
    crashes: Number(row?.crashes ?? 0),
    unhandled_rejections: Number(row?.rejections ?? 0),
    fatal: row?.fatal == null ? null : Number(row.fatal),
    sessions_affected: row?.sessions_affected ?? 0,
  };
}

/**
 * Démarrage JS, à froid et à chaud, SÉPARÉS.
 *
 * Les fondre dans une moyenne unique rendrait les deux illisibles : un
 * démarrage à froid inclut le chargement du bundle, un retour au premier plan
 * non. Une mesure sans échantillon vaut `null`, jamais 0 — « personne n'a
 * mesuré » n'est pas « le démarrage est instantané ».
 */
async function lireDemarrage(lire: Lecture, query: AnalyticsQuery, schema: MobileSchema): Promise<MobileStartup> {
  const base = cohorte(query, schema);
  const perimetre = compileScope(query, "ev.app_id", base.bind);
  const rows = await lire<{ name: string; samples: number; p50: number | null; p75: number | null; p95: number | null }>(
    `with ${base.cte} ${SQL_STARTUP}
      where ev.event_type = 'timing' and ev.timing_ms is not null
        and ev.name = any(${base.bind([STARTUP_COLD, STARTUP_WARM])}::text[])${perimetre}${fenetre(query, "ev.ts", base.bind)}
      group by ev.name`,
    base.params,
  );
  const mesure = (name: string): MobileStartupMeasure | null => {
    const row = rows.find((r) => r.name === name);
    if (!row || row.samples <= 0) return null;
    return {
      samples: row.samples,
      p50_ms: row.p50 == null ? null : Number(row.p50),
      p75_ms: row.p75 == null ? null : Number(row.p75),
      p95_ms: row.p95 == null ? null : Number(row.p95),
    };
  };
  return { cold: mesure(STARTUP_COLD), warm: mesure(STARTUP_WARM) };
}

/** Écrans les plus consultés de la cohorte. Une page vue par consultation (P7.3). */
async function lireEcrans(lire: Lecture, query: AnalyticsQuery, schema: MobileSchema): Promise<MobileScreen[]> {
  const base = cohorte(query, schema);
  const perimetre = compileScope(query, "p.app_id", base.bind);
  return lire<MobileScreen>(
    `with ${base.cte}
     select p.route, count(*)::int as views, count(distinct p.session_id)::int as sessions
       from rum_pageview p
       join cohorte c on c.app_id = p.app_id and c.session_id = p.session_id
      where true${perimetre}${fenetre(query, "p.started_at", base.bind)}
      group by p.route
      order by views desc, p.route nulls last
      limit ${TOP_LIMIT}`,
    base.params,
  );
}

/**
 * Appels réseau les plus lents de la cohorte.
 *
 * Le SDK mobile émet un span `http.client` par appel (table `rum_span`, palier
 * `front`), y compris vers une origine à laquelle il ne propage AUCUN en-tête :
 * mesurer la latence d'un tiers n'expose rien à ce tiers. L'origine est retirée
 * du chemin affiché, comme sur l'écran de tracing — deux environnements du même
 * service ne doivent pas produire deux lignes.
 */
async function lireRequetes(lire: Lecture, query: AnalyticsQuery, schema: MobileSchema): Promise<MobileResource[]> {
  const base = cohorte(query, schema);
  const perimetre = compileScope(query, "sp.app_id", base.bind);
  return lire<MobileResource>(
    `with ${base.cte}
     select regexp_replace(coalesce(sp.url, ''), '^https?://[^/]+', '') as path,
            sp.method,
            count(*)::int as calls,
            percentile_cont(0.75) within group (order by sp.duration_ms)::float8 as p75_ms,
            max(sp.duration_ms)::float8 as max_ms,
            count(*) filter (where sp.status_code >= 400)::int as errors
       from rum_span sp
       join cohorte c on c.app_id = sp.app_id and c.session_id = sp.session_id
      where sp.tier = 'front'${perimetre}${fenetre(query, "sp.ts", base.bind)}
      group by 1, 2
      order by p75_ms desc nulls last, calls desc
      limit ${TOP_LIMIT}`,
    base.params,
  );
}

// ─────────────────────── Stabilité par release (F38) ─────────────────────────
//
// LA RELEASE EST LA COUPE OÙ NUMÉRATEUR ET DÉNOMINATEUR PARLENT DE LA MÊME
// POPULATION. Sur mobile, la release est un fait exact de la session (voir
// `conditionsRelease`) : « sessions de la 4.2 touchées par une erreur JS » sur
// « sessions de la 4.2 » est un vrai taux. C'est le premier écran de Datadog
// (« Error Rate by Version ») et d'Ekara pour le mobile.
//
// ET CHAQUE RELEASE A SON PROPRE ÉTAT DE COLLECTE (CE14). Une release qui ne
// déclare pas collecter les erreurs JS n'a pas « 0 % de sessions touchées » : elle
// n'a rien observé. Sa part vaut `null`, avec la raison — même quand une autre
// release du parc, elle, déclare.
//
// UNE RELEASE N'EXISTE QUE DANS SON APP. `/mobile` ne se limite pas à une app :
// sous `app=all`, la « 1.0.0 » de A et la « 1.0.0 » de B sont deux binaires. Les
// grouper ensemble prêtait à B l'état déclaré par A (ses sessions entraient au
// dénominateur comme non touchées : part sous-estimée, taux « sans erreur »
// gonflé) et pouvait donner pour « release précédente » une release de l'autre app.
// Le groupe est donc `(app_id, release)`, l'état se lit sur les déclarations de
// cette app, et la précédente se cherche dans la même app.

/** Releases affichées par défaut ; toutes sont agrégées, la référence porte sur toutes. */
export const RELEASES_AFFICHEES = 12;

export interface MobileReleaseRow {
  /** App de la release : une release n'est un fait que dans son app. */
  app_id: string;
  /** `null` : sessions sans release déclarée — ligne « Inconnue ». */
  release: string | null;
  /** Sessions React Native de cette release COMMENCÉES dans la fenêtre. */
  sessions: number;
  /** Sessions portant au moins une erreur JS de la fenêtre ; `null` sans `error_source` (v69). */
  sessions_touchees: number | null;
  /** `sum(occurrences)` (V1) ; `null` sans `error_source`. */
  occurrences: number | null;
  /** État `js_errors` issu des SEULES déclarations de cette release, dans son app. */
  etat_js_errors: CapabilityState;
  /** Part des sessions touchées (0..1) ; `null` si la release ne déclare pas collecter. */
  part_touchee: number | null;
  raison_part: string | null;
  /** Écart de part touchée, en POINTS, à la release précédente de la même app (première session vue). */
  ecart_precedente_pts: number | null;
  release_precedente: string | null;
  /** p75 du démarrage JS à froid jusqu'au premier écran ; `null` sans mesure. */
  demarrage_froid_p75_ms: number | null;
  demarrage_froid_n: number;
  /** Première session de la release DANS LA FENÊTRE (ISO), pas sa date de publication. */
  premiere_session: string;
}

/** Taux des releases déclarantes, sur TOUTES les releases (jamais les 12 affichées seules). */
export type MobileDeclarantes = ReturnType<typeof tauxSansErreurDeclarant> & {
  /** Σ occurrences des releases déclarantes ; `null` sans `error_source`. */
  occurrences: number | null;
};

export type MobileParRelease =
  | {
      disponible: true;
      lignes: MobileReleaseRow[];
      /** Nombre de groupes (app, release) sur la fenêtre (« Inconnue » compris). */
      releases: number;
      /** Apps distinctes lues : au-delà d'une, chaque ligne nomme son app. */
      apps: number;
      tronque: boolean;
      declarantes: MobileDeclarantes;
    }
  | { disponible: false; raison: string };

export const RAISON_SANS_RELEASE_SESSION =
  "la release des sessions n'est pas lisible sur ce schéma (colonne rum_session.release absente) : aucune coupe par release possible";

/**
 * Stabilité par release de la cohorte React Native : même `cohorte()`, même
 * `snapshot()` que `mobileSummary`. Requête sans migration.
 *
 * `disponible: false` quand le schéma ne permet pas la coupe (sans `runtime` —
 * v82 — ou sans `rum_session.release`) : l'écran applique alors l'ordre de repli.
 * Une EXCEPTION n'est pas un `disponible: false` : elle remonte, et l'écran rend la
 * section en erreur à sa place.
 */
export async function mobileParRelease(
  f: FiltersLike,
  limite = RELEASES_AFFICHEES,
  schema?: MobileSchema,
): Promise<MobileParRelease> {
  const etat = schema ?? (await mobileSchema());
  if (!etat.runtime) return { disponible: false, raison: RAISON_SANS_RUNTIME };
  if (!etat.dimensions.has("rum_session.release")) return { disponible: false, raison: RAISON_SANS_RELEASE_SESSION };
  const query = queryOf(f);
  // Hors transaction et sans fenêtre, comme pour `mobileSummary` : une déclaration
  // n'est pas une occurrence.
  const declarations = etat.capabilities ? await declarationsParApp(query) : [];

  const { groupes, demarrages } = await snapshot(async (lire) => {
    // Une base par instruction : ses paramètres liés n'appartiennent qu'à elle.
    const base = cohorte(query, etat);
    const groupes = etat.errorSource
      ? await lire<{ app_id: string; release: string | null; sessions: number; touchees: number; occurrences: number; premiere: Date }>(
          `with ${base.cte},
           err as (
             select e.app_id, e.session_id, sum(e.occurrences)::float8 as occ
               from rum_error e
               join cohorte c on c.app_id = e.app_id and c.session_id = e.session_id
              where e.error_source = ${base.bind(MOBILE_ERROR_SOURCE)}${compileScope(query, "e.app_id", base.bind)}${fenetre(query, "e.ts", base.bind)}
              group by e.app_id, e.session_id
           )
           select c.app_id, c.release,
                  count(*)::int as sessions,
                  count(err.session_id)::int as touchees,
                  coalesce(sum(err.occ), 0)::float8 as occurrences,
                  min(c.started_at) as premiere
             from cohorte c
             left join err on err.app_id = c.app_id and err.session_id = c.session_id
            group by c.app_id, c.release`,
          base.params,
        )
      : await lire<{ app_id: string; release: string | null; sessions: number; touchees: null; occurrences: null; premiere: Date }>(
          `with ${base.cte}
           select c.app_id, c.release, count(*)::int as sessions, null::int as touchees, null::float8 as occurrences,
                  min(c.started_at) as premiere
             from cohorte c
            group by c.app_id, c.release`,
          base.params,
        );
    const baseDemarrage = cohorte(query, etat);
    const demarrages = await lire<{ app_id: string; release: string | null; n: number; p75: number | null }>(
      `with ${baseDemarrage.cte}
       select c.app_id, c.release, count(*)::int as n,
              percentile_cont(0.75) within group (order by ev.timing_ms)::float8 as p75
         from rum_event ev
         join cohorte c on c.app_id = ev.app_id and c.session_id = ev.session_id
        where ev.event_type = 'timing' and ev.timing_ms is not null
          and ev.name = ${baseDemarrage.bind(STARTUP_COLD)}${compileScope(query, "ev.app_id", baseDemarrage.bind)}${fenetre(query, "ev.ts", baseDemarrage.bind)}
        group by c.app_id, c.release`,
      baseDemarrage.params,
    );
    return { groupes, demarrages };
  });

  const lignes = groupes.map((g) => {
    const etatJs = etatCapaciteParRelease(declarations, "js_errors", g.release, g.app_id);
    const touchees = g.touchees === null ? null : Number(g.touchees);
    let part: number | null = null;
    let raison: string | null = null;
    if (touchees === null) {
      raison = RAISON_SANS_SOURCE_JS;
    } else {
      const { rate, reason } = errorFreeSessionRate({ sessions: g.sessions, sessionsWithJsError: touchees, jsErrorsState: etatJs });
      if (rate === null) raison = reason ? ERROR_FREE_REASONS[reason] : null;
      else part = 1 - rate;
    }
    const demarrage = demarrages.find((d) => d.app_id === g.app_id && d.release === g.release);
    return {
      app_id: g.app_id,
      release: g.release,
      sessions: g.sessions,
      sessions_touchees: touchees,
      occurrences: g.occurrences === null ? null : Number(g.occurrences),
      etat_js_errors: etatJs,
      part_touchee: part,
      raison_part: raison,
      demarrage_froid_p75_ms: demarrage?.p75 == null ? null : Number(demarrage.p75),
      demarrage_froid_n: demarrage?.n ?? 0,
      premiere_session: new Date(g.premiere).toISOString(),
    };
  });

  const chainees = chainerReleases(lignes);
  const taux = tauxSansErreurDeclarant(chainees);
  const actives = chainees.filter((l) => l.etat_js_errors === "active");
  return {
    disponible: true,
    lignes: chainees.slice(0, Math.max(0, limite)),
    releases: chainees.length,
    apps: new Set(chainees.map((l) => l.app_id)).size,
    tronque: chainees.length > limite,
    declarantes: {
      ...taux,
      occurrences: etat.errorSource ? actives.reduce((s, l) => s + (l.occurrences ?? 0), 0) : null,
    },
  };
}
