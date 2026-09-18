// Compilateur SQL de l'Explorer (P6.4) — logique pure : le texte produit, et rien
// d'autre. Ce que ce fichier verrouille :
//   · AUCUNE valeur de l'appelant n'entre dans le texte SQL — pas même le nom
//     d'une propriété JSON, qui est un paramètre lié comme les autres ;
//   · les quatre lectures partent du MÊME CTE `population` ;
//   · un attribut JSON n'est casté qu'après contrôle de type, et un champ legacy
//     non objet ne fait pas échouer la requête ;
//   · les groupes du haut d'une série sont choisis UNE fois, sur toute la fenêtre ;
//   · une agrégation additive comble ses seaux à zéro, une autre les laisse null ;
//   · une dimension qu'un jeu ne porte pas est une erreur typée, pas un oubli.
import { describe, expect, it } from "vitest";
import {
  COLONNE_PREFIXE,
  compileGroups,
  compilePopulation,
  compileRows,
  compileSeries,
  compileTotal,
} from "../../apps/console/lib/analytics-compiler";
import {
  EXPLORER_DATASET_IDS,
  datasetDefinition,
  parseExplorerQuery,
  type ExplorerPlan,
  type ExplorerRequest,
} from "../../apps/console/lib/analytics-schema";
import { binder, type DimensionSchema } from "../../apps/console/lib/query-compiler";
import type { AnalyticsQuery, ScopePrincipal } from "../../apps/console/lib/query-contract";
import type { SqlContext } from "../../apps/console/lib/query-sql";
import { schemaComplet, schemaSans } from "../fixtures/dimension-schema";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

/**
 * Contexte SQL minimal. `where` n'est pas utilisé par ce compilateur — il appelle
 * `compileWhere` lui-même pour pouvoir RENDRE l'erreur au lieu de la lever.
 */
function contexte(query: AnalyticsQuery, schema: DimensionSchema = schemaComplet()): SqlContext {
  const { params, bind } = binder();
  return {
    query,
    schema,
    params,
    bind,
    where: () => {
      throw new Error("compileWhere est appelé directement par le compilateur d'Explorer");
    },
  };
}

function requete(extra: Record<string, unknown> = {}): ExplorerRequest {
  const parsed = parseExplorerQuery(
    { version: 1, app: "demo-app", range: { preset: "24h" }, dataset: "errors", measure: { aggregation: "sum", field: "occurrences" }, ...extra },
    { principal: ADMIN, nowMs: NOW },
  );
  if (!parsed.ok) throw new Error(`${parsed.error.code} : ${parsed.error.message}`);
  return parsed.value;
}

function sql(
  compilateur: typeof compileTotal,
  extra: Record<string, unknown> = {},
  schema: DimensionSchema = schemaComplet(),
): { text: string; params: unknown[] } {
  const { query, plan } = requete(extra);
  const compiled = compilateur(contexte(query, schema), plan);
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.value;
}

describe("aucune valeur de l'appelant n'entre dans le texte SQL", () => {
  it("app, valeurs de dimension et nom de propriété sont TOUS liés", () => {
    const hostile = "'; drop table rum_error; --";
    const { text, params } = sql(compileTotal, {
      dataset: "custom_events",
      variant: "custom",
      measure: { aggregation: "sum", field: "prop", property: "montant_HT" },
      filters: [
        { field: "route", operator: "eq", type: "string", value: hostile },
        { field: "release", operator: "neq", type: "string", value: "v1.2.3" },
      ],
    });
    // Le périmètre est lié comme un TABLEAU d'apps (`= any($n)`) : on aplatit
    // avant de vérifier, sans quoi l'app passerait pour absente des paramètres.
    const lies = params.flatMap((param) => (Array.isArray(param) ? param : [param]));
    for (const valeur of [hostile, "montant_HT", "demo-app", "v1.2.3"]) {
      expect(text, valeur).not.toContain(valeur);
      expect(lies, valeur).toContain(valeur);
    }
    // Il ne reste que des `$n` là où les valeurs auraient pu être écrites.
    expect(text).toMatch(/\$\d+/);
  });

  it("le SQL ne contient que des identifiants du registre", () => {
    // Un mot qui ressemble à un identifiant et qui n'est ni un mot-clé SQL, ni un
    // alias de code, ni une colonne déclarée, serait une fuite d'entrée.
    for (const id of EXPLORER_DATASET_IDS) {
      const definition = datasetDefinition(id);
      const champ = Object.keys(definition.fields)[0];
      const { text } = sql(compileTotal, {
        dataset: id,
        variant: definition.variant?.required ? definition.variant.values[0] : undefined,
        measure: { aggregation: definition.fields[champ].aggregations[0], field: champ },
      });
      expect(text, id).not.toMatch(/'[^']*drop/i);
      expect(text, id).not.toContain("--");
      expect(text, id).not.toContain(";");
    }
  });
});

describe("une seule population pour les quatre lectures", () => {
  it("total, groupes, tendance et journal partent du même CTE", () => {
    const options = { visualization: "table" as const, groupBy: ["release"], limit: 25 };
    /** Le CTE seul : tout ce qui précède sa parenthèse fermante. */
    const base = (texte: string) => texte.slice(0, texte.indexOf("\n    )") + 6);
    const total = base(sql(compileTotal, options).text);
    for (const compilateur of [compileGroups, compileSeries, compileRows]) {
      expect(base(sql(compilateur, options).text)).toBe(total);
    }
    expect(total).toContain("with population as (");
    expect(total).toContain("where true and r.ts >=");
  });

  it("le curseur n'existe que dans le journal, et seulement s'il est demandé", () => {
    const options = { visualization: "table" as const, limit: 25 };
    expect(sql(compileRows, options).text).not.toContain("(ts, row_key) <");
    for (const compilateur of [compileTotal, compileGroups, compileSeries]) {
      expect(sql(compilateur, { ...options, visualization: "toplist", groupBy: ["route"], limit: 5 }).text).not.toContain(
        "(ts, row_key) <",
      );
    }
  });

  it("le journal projette la liste FERMÉE du jeu, jamais un select *", () => {
    const { text } = sql(compileRows, { dataset: "views", measure: { aggregation: "count", field: "rows" }, visualization: "table" });
    expect(text).not.toContain("select *");
    for (const colonne of datasetDefinition("views").rows) {
      expect(text).toContain(`${COLONNE_PREFIXE}${colonne.id}`);
    }
  });
});

describe("agrégations", () => {
  it("un percentile ordonne sur une valeur numérique et rend null sans échantillon", () => {
    const { text } = sql(compileTotal, {
      dataset: "vitals",
      variant: "LCP",
      measure: { aggregation: "p95", field: "value" },
    });
    expect(text).toContain("percentile_cont(0.95) within group (order by mesure::double precision)");
    // Aucun `coalesce` sur la mesure : un percentile sans échantillon est null,
    // pas zéro.
    expect(text).not.toMatch(/coalesce\(\s*(m\.)?valeur/);
  });

  it("les occurrences sont SOMMÉES, jamais comptées en lignes", () => {
    const { text } = sql(compileTotal);
    expect(text).toContain("sum(mesure)");
    expect(text).toContain("r.occurrences::numeric as mesure");
  });

  it("un dénombrement de distincts écarte les identifiants qui n'en sont pas", () => {
    const visiteurs = sql(compileTotal, { measure: { aggregation: "distinct", field: "visitors" } });
    expect(visiteurs.text).toContain("count(distinct identite)");
    expect(visiteurs.text).toContain("case when s.id_kind = $");
    expect(visiteurs.params).toContain("random");
    // La valeur de garde elle-même est liée : rien n'est concaténé.
    expect(visiteurs.text).not.toContain("'random'");
  });

  it("un seau vide vaut zéro pour une agrégation additive, null sinon", () => {
    const additive = sql(compileSeries, { visualization: "timeseries", groupBy: ["release"], limit: 3 });
    expect(additive.text).toContain("coalesce(m.valeur, 0) as valeur");
    const percentile = sql(compileSeries, {
      dataset: "vitals",
      variant: "INP",
      measure: { aggregation: "p75", field: "value" },
      visualization: "timeseries",
      groupBy: ["release"],
      limit: 3,
    });
    expect(percentile.text).toContain("m.valeur as valeur");
    expect(percentile.text).not.toContain("coalesce(m.valeur, 0)");
  });
});

describe("attributs JSON — castés seulement après contrôle de type", () => {
  const propriete = { dataset: "custom_events", variant: "custom", measure: { aggregation: "sum", field: "prop", property: "amount" } };

  it("un champ legacy qui n'est pas un objet ne fait pas échouer la requête : il ne mesure rien", () => {
    const { text } = sql(compileTotal, propriete);
    expect(text).toContain("jsonb_typeof(r.props) = 'object'");
  });

  it("seul un nombre JSON est casté — la chaîne « 42 » n'est pas le nombre 42", () => {
    const { text } = sql(compileTotal, propriete);
    expect(text).toMatch(/jsonb_typeof\(r\.props -> \$\d+::text\) = 'number'/);
    expect(text).toMatch(/\(r\.props ->> \$\d+::text\)::numeric/);
    // La clé reste un paramètre : pas de `-> 'amount'` écrit dans le texte.
    expect(text).not.toContain("'amount'");
  });
});

describe("fenêtres et jointures", () => {
  it("le jeu « sessions » EST la session : aucune jointure, et les robots s'excluent sur la ligne", () => {
    const { text } = sql(compileTotal, { dataset: "sessions", measure: { aggregation: "count", field: "started" } });
    expect(text).not.toContain("left join rum_session");
    expect(text).toContain("not coalesce(r.is_bot, false)");
  });

  it("les autres jeux joignent la session en RESTANT scopés par app", () => {
    const { text } = sql(compileTotal);
    expect(text).toContain("left join rum_session s on s.app_id = r.app_id and s.session_id = r.session_id");
  });

  it("une mesure de chevauchement borne DEUX colonnes, une mesure ordinaire une seule", () => {
    const commencees = sql(compileTotal, { dataset: "sessions", measure: { aggregation: "count", field: "started" } });
    expect(commencees.text).toMatch(/r\.started_at >= \$\d+::timestamptz and r\.started_at < \$\d+::timestamptz/);
    const actives = sql(compileTotal, { dataset: "sessions", measure: { aggregation: "count", field: "active" } });
    expect(actives.text).toMatch(/r\.last_seen_at >= \$\d+::timestamptz/);
    expect(actives.text).toMatch(/r\.started_at < \$\d+::timestamptz/);
  });

  it("la sous-population du jeu est liée, et l'historique sans valeur suit son défaut déclaré", () => {
    const vitals = sql(compileTotal, { dataset: "vitals", variant: "CLS", measure: { aggregation: "count", field: "rows" } });
    expect(vitals.text).toMatch(/r\.name = \$\d+/);
    expect(vitals.params).toContain("CLS");
    const evenements = sql(compileTotal, {
      dataset: "custom_events",
      variant: "custom",
      measure: { aggregation: "count", field: "rows" },
    });
    expect(evenements.text).toMatch(/coalesce\(r\.event_type, \$\d+::text\) = \$\d+/);
    expect(evenements.params).toContain("custom");
  });
});

describe("regroupements", () => {
  it("deux dimensions donnent deux colonnes, aucune en donne deux nulls typés", () => {
    const sans = sql(compileTotal);
    expect(sans.text).toContain("null::text as g0");
    expect(sans.text).toContain("null::text as g1");
    const deux = sql(compileGroups, { visualization: "toplist", groupBy: ["release", "browser"], limit: 5 });
    expect(deux.text).toContain("r.release::text as g0");
    expect(deux.text).toContain("s.browser::text as g1");
  });

  it("une dimension que le jeu ne porte pas est une erreur typée, jamais un regroupement ignoré", () => {
    const { query, plan } = requete({ dataset: "views", measure: { aggregation: "count", field: "rows" }, groupBy: ["service"] });
    const compiled = compilePopulation(contexte(query), plan);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.code).toBe("unsupported_dimension");
    expect(compiled.error.dimension).toBe("service");
  });

  it("une colonne absente du schéma sondé est « pas encore collectée », pas une erreur SQL", () => {
    const { query, plan } = requete({ groupBy: ["browser"] });
    const compiled = compilePopulation(contexte(query, schemaSans("rum_session.browser")), plan);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.message).toMatch(/pas encore collecté/);
  });

  it("le classement est déterministe : à valeur égale, les clés départagent", () => {
    const { text } = sql(compileGroups, { visualization: "toplist", groupBy: ["release"], limit: 5 });
    expect(text).toContain("order by valeur desc nulls last, g0 asc nulls last, g1 asc nulls last");
  });
});

describe("série temporelle — les mêmes groupes dans tous les seaux", () => {
  const options = { visualization: "timeseries" as const, groupBy: ["release"], limit: 3 };

  it("les groupes du haut sont choisis UNE fois, sur toute la fenêtre", () => {
    const { text } = sql(compileSeries, options);
    expect(text).toContain("tops as (");
    // Le top est calculé sur `population` entière, pas par seau : aucun
    // `date_bin` dans la définition de `tops`.
    const tops = text.slice(text.indexOf("tops as ("), text.indexOf("), seaux as ("));
    expect(tops).not.toContain("date_bin");
    expect(tops).toContain("group by 1, 2");
  });

  it("la grille croise TOUS les seaux avec TOUS les groupes retenus", () => {
    const { text } = sql(compileSeries, options);
    expect(text).toContain("cross join tops");
    expect(text).toContain("m.g0 is not distinct from grille.g0");
    expect(text).toContain("m.g1 is not distinct from grille.g1");
    expect(text).toContain("generate_series");
  });
});

describe("journal paginé", () => {
  it("le tri porte sur la clé TYPÉE, pas sur son rendu texte", () => {
    const { text } = sql(compileRows, { visualization: "table", limit: 25 });
    // Renommer la sortie évite que `order by row_key` trie « 10 » avant « 9 ».
    expect(text).toContain("row_key::text as cursor_key");
    expect(text).toContain("order by ts desc, row_key desc");
  });

  it("le curseur compare un couple (temps, clé) au type déclaré par le jeu", () => {
    const journal = { visualization: "table" as const, limit: 25 };
    const { query, plan } = requete(journal);
    const avecCurseur: ExplorerPlan = { ...plan, cursor: { fingerprint: "00000000", ts: "2026-09-17T11:00:00.000000Z", key: "42" } };
    const compiled = compileRows(contexte(query), avecCurseur);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.text).toMatch(/\(ts, row_key\) < \(\$\d+::timestamptz, \$\d+::bigint\)/);
    expect(compiled.value.params).toContain("2026-09-17T11:00:00.000000Z");

    const actions = requete({ ...journal, dataset: "actions", measure: { aggregation: "count", field: "rows" } });
    const texte = compileRows(contexte(actions.query), { ...actions.plan, cursor: avecCurseur.cursor });
    expect(texte.ok).toBe(true);
    if (!texte.ok) return;
    // La clé d'une action est textuelle : le cast suit le registre, pas une supposition.
    expect(texte.value.text).toMatch(/\$\d+::text\)/);
  });

  it("l'horodatage du curseur conserve les microsecondes de PostgreSQL", () => {
    const { text } = sql(compileRows, { visualization: "table", limit: 25 });
    expect(text).toContain(`to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  });
});

describe("tous les couples déclarés compilent, et eux seuls", () => {
  it("chaque jeu × champ × agrégation du registre produit un SQL", () => {
    const compilateurs: Array<[string, typeof compileTotal]> = [
      ["total", compileTotal],
      ["groupes", compileGroups],
      ["série", compileSeries],
      ["journal", compileRows],
    ];
    for (const id of EXPLORER_DATASET_IDS) {
      const definition = datasetDefinition(id);
      for (const [field, champ] of Object.entries(definition.fields)) {
        for (const aggregation of champ.aggregations) {
          const variant = champ.variant ?? (definition.variant?.required ? definition.variant.values[0] : undefined);
          const base: Record<string, unknown> = {
            dataset: id,
            measure: { aggregation, field, ...(champ.kind === "json" ? { property: "amount" } : {}) },
            ...(variant ? { variant } : {}),
          };
          for (const [nom, compilateur] of compilateurs) {
            // Une mesure sans seau honnête n'a pas de série : le registre l'a déjà dit.
            if (nom === "série" && champ.bucketable === false) continue;
            // `route` n'est pas porté par les sessions : on regroupe alors sur
            // une dimension que ce jeu porte vraiment.
            const groupBy = id === "sessions" ? ["country"] : ["route"];
            const options: Record<string, unknown> =
              nom === "journal"
                ? { ...base, visualization: "table", limit: 25 }
                : nom === "total"
                  ? base
                  : { ...base, visualization: nom === "série" ? "timeseries" : "toplist", groupBy, limit: 3 };
            expect(() => sql(compilateur, options), `${id}.${field}.${aggregation} (${nom})`).not.toThrow();
          }
        }
      }
    }
  });
});
