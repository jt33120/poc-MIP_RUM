// Compilateur SQL de l'Explorer (P6.4) — logique PURE, testée, sans accès base.
//
// SÛRETÉ. Tout identifiant SQL — table, colonne, alias — vient du registre
// (`lib/analytics-schema.ts`) ou du contrat P6.2 (`lib/query-compiler.ts`), et
// chacun est revérifié ici contre une forme stricte : un registre mal écrit lève
// à la compilation, il ne produit pas de SQL. Les valeurs de l'appelant sont
// TOUTES des paramètres liés `$n` — y compris le nom d'une propriété JSON, qui
// entre dans `props -> $n` et jamais dans le texte de l'instruction.
//
// UNE SEULE POPULATION. Les quatre lectures — total, groupes, tendance, journal —
// partent du MÊME CTE `population`. Elles ne peuvent donc pas diverger sur les
// filtres, la fenêtre ou les robots exclus. Le curseur n'existe que dans le
// journal : une page de journal ne calcule jamais un graphe.
import {
  datasetDefinition,
  estAdditive,
  type Aggregation,
  type ExplorerDatasetId,
  type ExplorerError,
  type ExplorerPlan,
} from "./analytics-schema";
import {
  DATASET_REGISTRY,
  bucketExpr,
  bucketSeriesSql,
  compileWhere,
  dimensionSupport,
  sessionJoin,
  type CompileTarget,
  type DimensionSchema,
} from "./query-compiler";
import type { AnalyticsQuery, Dimension, Parsed } from "./query-contract";
import type { SqlContext } from "./query-sql";

/** Alias de code, jamais dérivés d'une entrée : la ligne et sa session. */
const ROW = "r";
const SESSION = "s";

const IDENTIFIANT = /^[a-z][a-z0-9_]{0,62}$/;

function identifiant(nom: string, role: string): string {
  if (!IDENTIFIANT.test(nom)) throw new Error(`identifiant SQL invalide (${role}) : ${nom}`);
  return nom;
}

export type CompiledSql = { text: string; params: unknown[] };

/** Forme d'une ligne de groupe, de seau et de journal, telles que le SQL les rend. */
export interface GroupRow {
  g0: string | null;
  g1: string | null;
  valeur: string | number | null;
  samples: string | number;
}
export interface SeriesRow extends GroupRow {
  bucket: Date;
}
export interface JournalRow {
  cursor_key: string;
  cursor_ts: string;
  [column: string]: unknown;
}
export interface TotalRow {
  valeur: string | number | null;
  samples: string | number;
}

/** Colonnes du journal, préfixées pour ne jamais entrer en collision avec `ts`/`row_key`. */
export const COLONNE_PREFIXE = "c_";

// ─────────────────────────────── La population ───────────────────────────────

/**
 * Expression de mesure, projetée une fois dans la population puis agrégée par
 * chaque lecture. `null` quand la mesure est un dénombrement de lignes.
 */
function mesureExpr(plan: ExplorerPlan, ctx: SqlContext): string | null {
  const definition = datasetDefinition(plan.dataset);
  const field = definition.fields[plan.measure.field];
  if (field.kind === "rows" || field.kind === "identity") return null;
  if (field.kind === "json") {
    const colonne = `${ROW}.${identifiant(field.json!.column, "colonne JSON")}`;
    const cle = ctx.bind(plan.measure.property);
    // Trois refus explicites, dans cet ordre : un champ JSON legacy qui n'est pas
    // un objet (il ne fait pas échouer la requête, il ne mesure rien) ; une
    // propriété absente ; une propriété qui n'est pas un nombre — la chaîne « 42 »
    // n'est pas le nombre 42, et aucune conversion implicite ne les rapproche.
    return `case when jsonb_typeof(${colonne}) = 'object' and jsonb_typeof(${colonne} -> ${cle}::text) = 'number'
                 then (${colonne} ->> ${cle}::text)::numeric end`;
  }
  return `${ROW}.${identifiant(field.column!, "colonne de mesure")}::numeric`;
}

/** Expression d'identité à dénombrer en distincts, ou `null`. */
function identiteExpr(plan: ExplorerPlan, ctx: SqlContext): string | null {
  const field = datasetDefinition(plan.dataset).fields[plan.measure.field];
  if (field.kind !== "identity") return null;
  const identity = field.identity!;
  const alias = identity.on === "session" ? sessionAlias(plan.dataset) : ROW;
  const colonne = `${alias}.${identifiant(identity.column, "colonne d'identité")}`;
  if (!identity.guard) return colonne;
  // Compter un identifiant qui n'en est pas un donnerait un nombre de visiteurs
  // plus petit que la réalité, sans le dire. Il est écarté, pas approché.
  const garde = `${alias}.${identifiant(identity.guard.column, "garde d'identité")}`;
  return `case when ${garde} = ${ctx.bind(identity.guard.value)}::text then ${colonne} end`;
}

/** Colonne d'une dimension de regroupement, ou erreur typée si le jeu ne la porte pas. */
function dimensionExpr(
  dataset: ExplorerDatasetId,
  dimension: Dimension,
  schema: DimensionSchema,
): Parsed<string> {
  const definition = datasetDefinition(dataset);
  const support = dimensionSupport(definition.dataset, dimension, schema);
  if (!support.supported) {
    return { ok: false, error: { code: "unsupported_dimension", message: support.message, dimension } };
  }
  const alias = support.source.on === "session" ? sessionAlias(dataset) : ROW;
  return { ok: true, value: `${alias}.${identifiant(support.source.column, "colonne de dimension")}` };
}

/** Le jeu « sessions » EST la session : pas de jointure, la ligne porte tout. */
function sessionAlias(dataset: ExplorerDatasetId): string {
  return dataset === "sessions" ? ROW : SESSION;
}

/**
 * CTE `population` : la seule définition de « ce qui est compté ». Fenêtre,
 * périmètre d'apps, robots, apps internes et filtres viennent du compilateur
 * commun P6.2 ; la sous-population du jeu (nom de métrique, API de blocage, type
 * d'événement) s'y ajoute en paramètre lié.
 */
export function compilePopulation(ctx: SqlContext, plan: ExplorerPlan): Parsed<string> {
  const definition = datasetDefinition(plan.dataset);
  // La table vient du registre P6.2 : une seule déclaration pour le filtrage et
  // pour la mesure, donc aucune dérive possible entre les deux.
  const table = identifiant(DATASET_REGISTRY[definition.dataset].table, "table");
  const time = `${ROW}.${identifiant(definition.time, "colonne temporelle")}`;
  const chevauchement = datasetDefinition(plan.dataset).fields[plan.measure.field].window === "overlap";

  const target: CompileTarget = {
    dataset: definition.dataset,
    row: ROW,
    session: sessionAlias(plan.dataset),
    // Une mesure de chevauchement borne DEUX colonnes : la fenêtre est écrite ici,
    // pas par le compilateur commun, qui n'en connaît qu'une.
    time: chevauchement ? null : time,
  };
  const where = compileWhere(ctx.query, target, ctx.schema, ctx.bind);
  if (!where.ok) return where;

  let predicats = where.value;
  if (chevauchement) {
    const fin = `${ROW}.${identifiant(definition.timeEnd!, "colonne de fin")}`;
    predicats =
      ` and ${fin} >= ${ctx.bind(ctx.query.range.from)}::timestamptz` +
      ` and ${time} < ${ctx.bind(ctx.query.range.to)}::timestamptz` +
      predicats;
  }
  if (plan.variant !== null && definition.variant) {
    const colonne = `${ROW}.${identifiant(definition.variant.column, "colonne de sous-population")}`;
    predicats += definition.variant.nullDefault
      ? ` and coalesce(${colonne}, ${ctx.bind(definition.variant.nullDefault)}::text) = ${ctx.bind(plan.variant)}`
      : ` and ${colonne} = ${ctx.bind(plan.variant)}`;
  }

  const groupes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const dimension = plan.groupBy[i];
    if (!dimension) {
      groupes.push(`null::text as g${i}`);
      continue;
    }
    const expr = dimensionExpr(plan.dataset, dimension, ctx.schema);
    if (!expr.ok) return expr;
    groupes.push(`${expr.value}::text as g${i}`);
  }

  const mesure = mesureExpr(plan, ctx);
  const identite = identiteExpr(plan, ctx);
  const colonnes = definition.rows.map((column) => {
    const alias = column.on === "session" ? sessionAlias(plan.dataset) : ROW;
    return `${alias}.${identifiant(column.column, "colonne de journal")} as ${COLONNE_PREFIXE}${identifiant(column.id, "identifiant de colonne")}`;
  });

  const jointure = plan.dataset === "sessions" ? "" : `\n        ${sessionJoin(ROW, SESSION)}`;
  return {
    ok: true,
    value: `with population as (
      select ${time} as ts,
             ${ROW}.${identifiant(definition.key.column, "clé de journal")} as row_key,
             ${mesure ?? "null::numeric"} as mesure,
             ${identite ?? "null::text"} as identite,
             ${groupes.join(", ")},
             ${colonnes.join(", ")}
        from ${table} ${ROW}${jointure}
       where true${predicats}
    )`,
  };
}

// ──────────────────────────────── L'agrégation ───────────────────────────────

const PERCENTILES: Partial<Record<Aggregation, string>> = { p75: "0.75", p95: "0.95" };

/**
 * Agrégation appliquée à la population. Un percentile ordonne sur `double
 * precision` ; une somme reste en `numeric`, exacte jusqu'à la sérialisation.
 */
function agregat(aggregation: Aggregation): string {
  if (aggregation === "count") return "count(*)::numeric";
  if (aggregation === "distinct") return "count(distinct identite)::numeric";
  if (aggregation === "sum") return "sum(mesure)";
  if (aggregation === "avg") return "avg(mesure)";
  // Sans aucun échantillon, `percentile_cont` rend NULL — et un percentile nul
  // n'est pas un zéro : c'est l'absence de mesure, affichée comme telle.
  return `percentile_cont(${PERCENTILES[aggregation]}) within group (order by mesure::double precision)`;
}

// ──────────────────────────── Les quatre lectures ────────────────────────────

/** Total sur toute la population, calculé INDÉPENDAMMENT du top-N des groupes. */
export function compileTotal(ctx: SqlContext, plan: ExplorerPlan): Parsed<CompiledSql> {
  const population = compilePopulation(ctx, plan);
  if (!population.ok) return population;
  return {
    ok: true,
    value: {
      text: `${population.value}
       select ${agregat(plan.measure.aggregation)} as valeur, count(*)::bigint as samples from population`,
      params: ctx.params,
    },
  };
}

/**
 * Groupes classés. Une combinaison de plus que la limite est demandée : elle ne
 * sert qu'à savoir s'il en reste, jamais à en afficher une de plus.
 */
export function compileGroups(ctx: SqlContext, plan: ExplorerPlan): Parsed<CompiledSql> {
  const population = compilePopulation(ctx, plan);
  if (!population.ok) return population;
  return {
    ok: true,
    value: {
      text: `${population.value}
       select g0, g1, ${agregat(plan.measure.aggregation)} as valeur, count(*)::bigint as samples
         from population group by 1, 2
        ${ORDRE_GROUPES} limit ${ctx.bind(plan.limit + 1)}`,
      params: ctx.params,
    },
  };
}

// Départage explicite : deux groupes de même valeur doivent sortir dans le même
// ordre d'un appel à l'autre, sinon le « top » changerait de composition entre
// deux seaux de la même série.
const ORDRE_GROUPES = "order by valeur desc nulls last, g0 asc nulls last, g1 asc nulls last";

/** Même ordre, là où la valeur n'est pas projetée (choix des groupes du haut). */
function ordreTops(aggregation: Aggregation): string {
  return `order by ${agregat(aggregation)} desc nulls last, g0 asc nulls last, g1 asc nulls last`;
}

/**
 * Série temporelle. Les groupes du haut sont choisis UNE fois, sur toute la
 * fenêtre, puis rendus dans TOUS les seaux : un groupe ne peut pas apparaître au
 * seau 3 et disparaître au seau 4 parce qu'il y était douzième. Un seau sans
 * ligne vaut zéro pour une agrégation additive, et null sinon — une moyenne sans
 * échantillon n'est pas zéro.
 */
export function compileSeries(ctx: SqlContext, plan: ExplorerPlan): Parsed<CompiledSql> {
  const population = compilePopulation(ctx, plan);
  if (!population.ok) return population;
  const range = ctx.query.range;
  const defaut = estAdditive(plan.measure.aggregation) ? "coalesce(m.valeur, 0)" : "m.valeur";
  return {
    ok: true,
    value: {
      text: `${population.value}, tops as (
         select g0, g1 from population group by 1, 2
          ${ordreTops(plan.measure.aggregation)} limit ${ctx.bind(plan.limit)}
       ), seaux as (
         select ${bucketSeriesSql(range, ctx.bind)} as bucket
       ), grille as (
         select seaux.bucket, tops.g0, tops.g1 from seaux cross join tops
       ), mesures as (
         select ${bucketExpr("ts", range)} as bucket, g0, g1,
                ${agregat(plan.measure.aggregation)} as valeur, count(*)::bigint as samples
           from population group by 1, 2, 3
       )
       select grille.bucket, grille.g0, grille.g1, ${defaut} as valeur,
              coalesce(m.samples, 0)::bigint as samples
         from grille
         left join mesures m on m.bucket = grille.bucket
              and m.g0 is not distinct from grille.g0
              and m.g1 is not distinct from grille.g1
        order by grille.bucket asc, grille.g0 asc nulls last, grille.g1 asc nulls last`,
      params: ctx.params,
    },
  };
}

/**
 * Journal paginé. C'est la SEULE lecture qui connaît le curseur, et elle ne sert
 * jamais à calculer total, groupes ou tendance. Le départage `(ts, clé)` conserve
 * la précision PostgreSQL : le curseur transporte l'horodatage en microsecondes.
 */
export function compileRows(ctx: SqlContext, plan: ExplorerPlan): Parsed<CompiledSql> {
  const population = compilePopulation(ctx, plan);
  if (!population.ok) return population;
  const definition = datasetDefinition(plan.dataset);
  const curseur = plan.cursor
    ? ` where (ts, row_key) < (${ctx.bind(plan.cursor.ts)}::timestamptz, ${ctx.bind(plan.cursor.key)}::${definition.key.type})`
    : "";
  const colonnes = definition.rows.map((column) => `${COLONNE_PREFIXE}${column.id}`);
  // La clé est rendue en texte sous un AUTRE nom : réutiliser `row_key` comme
  // alias de sortie ferait trier `order by row_key` sur le texte — où « 10 »
  // précède « 9 » —, et la page suivante sauterait des lignes.
  return {
    ok: true,
    value: {
      text: `${population.value}
       select ${colonnes.join(", ")}, row_key::text as cursor_key,
              to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
         from population${curseur}
        order by ts desc, row_key desc limit ${ctx.bind(plan.limit)}`,
      params: ctx.params,
    },
  };
}

/** Erreur typée d'une dimension que le jeu de données ne porte pas. */
export function asExplorerError(error: { code: string; message: string; dimension?: string }): ExplorerError {
  return {
    code: error.code as ExplorerError["code"],
    message: error.message,
    ...(error.dimension ? { dimension: error.dimension } : {}),
  };
}
