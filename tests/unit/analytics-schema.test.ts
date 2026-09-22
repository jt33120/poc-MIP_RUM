// Registre et validation de l'AST de l'Explorer (P6.4) — logique pure.
//
// Ce que ce fichier verrouille, et pourquoi chaque point est là :
//   · le registre est FERMÉ — un champ sensible n'y est pas, et son refus ne dit
//     pas s'il existe ailleurs ;
//   · aucune entrée hostile ne devient un identifiant SQL : elle est refusée
//     AVANT d'atteindre le compilateur ;
//   · un curseur ne survit ni à une falsification, ni à un changement de plage,
//     de filtre ou d'app ;
//   · `range` vaut exactement `{preset}` ou `{from,to}` ;
//   · les bornes du contrat P6 (10 conditions, 2 regroupements, 50 groupes,
//     200 lignes) sont appliquées avant tout SQL.
import { describe, expect, it } from "vitest";
import {
  EXPLORER_DATASET_IDS,
  EXPLORER_VERSION,
  MAX_GROUPS,
  MAX_ROWS,
  canonicalAst,
  datasetDefinition,
  encodeExplorerCursor,
  estAdditive,
  explorerErrorStatus,
  explorerFingerprint,
  mesureNumerique,
  parseExplorerQuery,
  publicSchema,
  type ExplorerRequest,
} from "../../apps/console/lib/analytics-schema";
import type { ScopePrincipal } from "../../apps/console/lib/query-contract";
import { parseAnalyticsQuery as f34ParseAnalyticsQuery } from "../../apps/console/lib/query-contract";
import { parseExplorerPlan as f34ParseExplorerPlan } from "../../apps/console/lib/analytics-schema";
import { explorerHrefFromAst as f34ExplorerHrefFromAst, explorerSource as f34ExplorerSource } from "../../apps/console/lib/explorer-page-params";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

/** Corps minimal valide, que chaque cas dégrade sur un seul point. */
function corps(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    app: "demo-app",
    range: { preset: "24h" },
    dataset: "errors",
    measure: { aggregation: "sum", field: "occurrences" },
    ...extra,
  };
}

function parse(extra: Record<string, unknown> = {}, principal: ScopePrincipal = ADMIN) {
  return parseExplorerQuery(corps(extra), { principal, nowMs: NOW });
}

function ok(extra: Record<string, unknown> = {}, principal: ScopePrincipal = ADMIN): ExplorerRequest {
  const parsed = parse(extra, principal);
  if (!parsed.ok) throw new Error(`${parsed.error.code} : ${parsed.error.message}`);
  return parsed.value;
}

function codeDe(extra: Record<string, unknown>, principal: ScopePrincipal = ADMIN): string {
  const parsed = parse(extra, principal);
  return parsed.ok ? "ok" : parsed.error.code;
}

describe("registre — une allowlist fermée, pas une carte du schéma", () => {
  it("chaque jeu déclare une table du contrat P6.2, une colonne temporelle et une clé de journal", () => {
    for (const id of EXPLORER_DATASET_IDS) {
      const definition = datasetDefinition(id);
      expect(definition.time, id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(definition.key.column, id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(["bigint", "text"], id).toContain(definition.key.type);
      expect(Object.keys(definition.fields).length, id).toBeGreaterThan(0);
      expect(definition.rows.length, id).toBeGreaterThan(0);
      expect(definition.population, id).toBeTruthy();
    }
  });

  it("aucun identifiant du registre n'est autre chose qu'un nom de colonne simple", () => {
    // La sûreté du compilateur repose là-dessus : une colonne du registre entre
    // TELLE QUELLE dans le SQL. Une entrée fantaisiste s'y verrait ici.
    const forme = /^[a-z][a-z0-9_]{0,62}$/;
    for (const id of EXPLORER_DATASET_IDS) {
      const definition = datasetDefinition(id);
      for (const [nom, field] of Object.entries(definition.fields)) {
        expect(nom, `${id}.${nom}`).toMatch(forme);
        for (const colonne of [field.column, field.identity?.column, field.identity?.guard?.column, field.json?.column]) {
          if (colonne) expect(colonne, `${id}.${nom}`).toMatch(forme);
        }
      }
      for (const colonne of definition.rows) {
        expect(colonne.column, `${id}.${colonne.id}`).toMatch(forme);
        expect(colonne.id, `${id}.${colonne.id}`).toMatch(forme);
      }
      if (definition.variant) expect(definition.variant.column, id).toMatch(forme);
    }
  });

  it("le journal ne projette jamais un champ libre : ni message, ni pile, ni URL brute, ni identité", () => {
    // Ces colonnes existent en base. Ne pas les mettre au catalogue est une
    // décision, pas un oubli : un journal générique les aurait toutes prises.
    const interdites = ["message", "stack", "stack_symbolicated", "url", "user_agent", "user_hash", "visitor_id", "user_id_hash", "account_id_hash", "context", "props", "attribution"];
    for (const id of EXPLORER_DATASET_IDS) {
      for (const colonne of datasetDefinition(id).rows) {
        expect(interdites, `${id}.${colonne.id}`).not.toContain(colonne.column);
      }
    }
  });

  it("seules count et sum sont additives : un percentile n'admet ni zéro ni « Autres »", () => {
    expect(estAdditive("count")).toBe(true);
    expect(estAdditive("sum")).toBe(true);
    for (const aggregation of ["avg", "p75", "p95", "distinct"] as const) {
      expect(estAdditive(aggregation), aggregation).toBe(false);
    }
  });

  it("les sessions commencées et les sessions actives sont deux mesures nommées différemment", () => {
    const sessions = datasetDefinition("sessions");
    expect(Object.keys(sessions.fields)).toContain("started");
    expect(Object.keys(sessions.fields)).toContain("active");
    expect(sessions.fields.active.window).toBe("overlap");
    // Une session commencée avant la fenêtre n'a pas de seau dedans : lui en
    // inventer un ferait diverger la série du total.
    expect(sessions.fields.active.bucketable).toBe(false);
  });

  it("les Web Vitals exigent un nom de métrique : la table accueille aussi d'autres produits", () => {
    const vitals = datasetDefinition("vitals");
    expect(vitals.variant?.required).toBe(true);
    expect(vitals.variant?.values).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
  });
});

describe("mesures — un champ absent du catalogue n'est pas mesurable", () => {
  it("les champs sensibles des erreurs sont refusés, sans dire s'ils existent", () => {
    for (const field of ["message", "stack", "user_id_hash", "visitor_id", "context"]) {
      const parsed = parse({ measure: { aggregation: "count", field } });
      expect(parsed.ok, field).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.code, field).toBe("unsupported_measure");
      // Le message nomme le jeu, jamais une colonne ni une table.
      expect(parsed.error.message, field).not.toMatch(/rum_|colonne|table/i);
    }
  });

  it("un couple champ × agrégation non déclaré est refusé, jamais approché par un autre", () => {
    expect(codeDe({ measure: { aggregation: "p95", field: "occurrences" } })).toBe("unsupported_measure");
    expect(codeDe({ measure: { aggregation: "sum", field: "sessions" } })).toBe("unsupported_measure");
    expect(codeDe({ dataset: "vitals", variant: "LCP", measure: { aggregation: "sum", field: "value" } })).toBe(
      "unsupported_measure",
    );
    expect(codeDe({ dataset: "vitals", variant: "LCP", measure: { aggregation: "p75", field: "value" } })).toBe("ok");
  });

  it("une mesure sur propriété JSON exige une clé bornée, et refuse un JSONPath", () => {
    const base = { dataset: "custom_events", variant: "custom" };
    expect(codeDe({ ...base, measure: { aggregation: "sum", field: "prop" } })).toBe("invalid_query");
    expect(codeDe({ ...base, measure: { aggregation: "sum", field: "prop", property: "$.a.b" } })).toBe("invalid_query");
    expect(codeDe({ ...base, measure: { aggregation: "sum", field: "prop", property: "a'; drop table x --" } })).toBe(
      "invalid_query",
    );
    expect(codeDe({ ...base, measure: { aggregation: "sum", field: "prop", property: "amount" } })).toBe("ok");
    // La propriété n'a de sens que là où elle est déclarée.
    expect(codeDe({ measure: { aggregation: "sum", field: "occurrences", property: "amount" } })).toBe("invalid_query");
  });

  it("une mesure réservée à une sous-population impose la sienne, et refuse la contradiction", () => {
    const timing = { dataset: "custom_events", measure: { aggregation: "p95", field: "timing_ms" } };
    expect(ok(timing).plan.variant).toBe("timing");
    expect(codeDe({ ...timing, variant: "custom" })).toBe("invalid_query");
  });
});

describe("entrées hostiles — refusées avant d'atteindre le compilateur", () => {
  it("un nom de jeu, de mesure ou de dimension porteur de SQL est refusé", () => {
    expect(codeDe({ dataset: "errors; drop table rum_error" })).toBe("unsupported_dataset");
    expect(codeDe({ measure: { aggregation: "count", field: 'occurrences"; drop table rum_error --' } })).toBe(
      "unsupported_measure",
    );
    expect(codeDe({ groupBy: ["route; select 1"] })).toBe("unsupported_dimension");
    expect(codeDe({ filters: [{ field: "route)", operator: "eq", value: "/a" }] })).toBe("unsupported_dimension");
    expect(codeDe({ visualization: "table; drop" })).toBe("unsupported_visualization");
  });

  it("une clé inconnue au premier niveau ou dans une mesure est refusée, pas ignorée", () => {
    expect(codeDe({ orderBy: "value" })).toBe("invalid_query");
    expect(codeDe({ measure: { aggregation: "sum", field: "occurrences", sql: "1=1" } })).toBe("invalid_query");
    expect(codeDe({ filters: [{ field: "route", operator: "eq", value: "/a", regex: true }] })).toBe("invalid_query");
  });

  it("une valeur de dimension reste une valeur, quelle que soit sa forme", () => {
    // Elle sera un paramètre lié : aucune raison de la refuser, seulement de la borner.
    const hostile = "'; drop table rum_error; --";
    const request = ok({ filters: [{ field: "route", operator: "eq", type: "string", value: hostile }] });
    expect(request.query.filters.segments).toEqual([{ dimension: "route", operator: "eq", value: hostile }]);
    expect(codeDe({ filters: [{ field: "route", operator: "eq", value: "x".repeat(501) }] })).toBe("invalid_filter");
    expect(codeDe({ filters: [{ field: "route", operator: "eq", value: "a b" }] })).toBe("invalid_filter");
  });

  it("un opérateur ou un type inventé est refusé", () => {
    expect(codeDe({ filters: [{ field: "route", operator: "like", value: "/a%" }] })).toBe("invalid_filter");
    expect(codeDe({ filters: [{ field: "route", operator: "eq", type: "number", value: "1" }] })).toBe("invalid_filter");
    expect(codeDe({ filters: [{ field: "device", operator: "eq", value: "montre" }] })).toBe("invalid_filter");
    expect(codeDe({ filters: [{ field: "route", operator: "is_null", value: "/a" }] })).toBe("invalid_filter");
  });
});

describe("bornes du contrat, appliquées avant tout SQL", () => {
  it("dix conditions ET au plus", () => {
    const filtre = (i: number) => ({ field: "route", operator: "eq", value: `/r${i}` });
    expect(codeDe({ filters: Array.from({ length: 10 }, (_, i) => filtre(i)) })).toBe("ok");
    expect(codeDe({ filters: Array.from({ length: 11 }, (_, i) => filtre(i)) })).toBe("too_many_conditions");
  });

  it("deux dimensions de regroupement au plus, et jamais deux fois la même", () => {
    expect(codeDe({ groupBy: ["route", "release"] })).toBe("ok");
    expect(codeDe({ groupBy: ["route", "release", "env"] })).toBe("invalid_query");
    expect(codeDe({ groupBy: ["route", "route"] })).toBe("invalid_query");
  });

  it("cinquante COMBINAISONS de groupes, deux cents lignes de journal", () => {
    expect(codeDe({ visualization: "toplist", limit: MAX_GROUPS })).toBe("ok");
    expect(codeDe({ visualization: "toplist", limit: MAX_GROUPS + 1 })).toBe("invalid_query");
    expect(codeDe({ visualization: "table", limit: MAX_ROWS })).toBe("ok");
    expect(codeDe({ visualization: "table", limit: MAX_ROWS + 1 })).toBe("invalid_query");
    expect(codeDe({ limit: 0 })).toBe("invalid_query");
    expect(codeDe({ limit: 1.5 })).toBe("invalid_query");
  });

  it("une mesure sans découpage temporel honnête refuse la série temporelle", () => {
    const actives = { dataset: "sessions", measure: { aggregation: "count", field: "active" } };
    expect(codeDe({ ...actives, visualization: "value" })).toBe("ok");
    expect(codeDe({ ...actives, visualization: "timeseries" })).toBe("unsupported_visualization");
  });
});

describe("plage — exactement {preset} ou {from,to}", () => {
  it("les deux ensemble sont refusés, et aucun des deux aussi", () => {
    expect(codeDe({ range: { preset: "24h", from: "2026-09-16T00:00:00Z", to: "2026-09-17T00:00:00Z" } })).toBe(
      "range_conflict",
    );
    expect(codeDe({ range: {} })).toBe("invalid_range");
    expect(codeDe({ range: { from: "2026-09-16T00:00:00Z" } })).toBe("invalid_range");
  });

  it("un preset inconnu est refusé, PAS rabattu sur 24 h comme dans les anciennes URL", () => {
    expect(codeDe({ range: { preset: "30d" } })).toBe("invalid_range");
    expect(codeDe({ range: { preset: "" } })).toBe("invalid_range");
  });

  it("les bornes personnalisées gardent les règles du contrat commun", () => {
    expect(codeDe({ range: { from: "2026-09-17T10:00:00Z", to: "2026-09-17T11:00:00Z" } })).toBe("ok");
    expect(codeDe({ range: { from: "2026-09-17T11:00:00Z", to: "2026-09-17T13:00:00Z" } })).toBe("range_in_future");
    expect(codeDe({ range: { from: "2026-07-01T00:00:00Z", to: "2026-09-17T00:00:00Z" } })).toBe("range_too_long");
    expect(codeDe({ range: { from: "2026-09-17T10:00:00", to: "2026-09-17T11:00:00Z" } })).toBe("invalid_range");
    expect(codeDe({ range: { preset: "24h", horizon: "large" } })).toBe("invalid_range");
  });
});

describe("périmètre — l'app du corps est une demande, jamais une autorisation", () => {
  it("une app hors périmètre est refusée, pas rabattue sur une autorisée", () => {
    const viewer: ScopePrincipal = { role: "viewer", apps: ["autre-app"] };
    expect(codeDe({}, viewer)).toBe("forbidden_app");
    expect(explorerErrorStatus({ code: "forbidden_app", message: "" })).toBe(403);
  });

  it("une liste d'apps vide n'ouvre rien", () => {
    expect(codeDe({ app: null }, { role: "viewer", apps: [] })).toBe("no_app_access");
  });

  it("sans app, le périmètre effectif est celui du principal signé", () => {
    expect(ok({ app: null }, { role: "viewer", apps: ["a", "b"] }).query.scope.effectiveApps).toEqual(["a", "b"]);
    expect(ok({ app: null }).query.scope.effectiveApps).toBeNull();
  });
});

describe("curseur — lié à la requête et à la plage résolue", () => {
  const journal = { visualization: "table", limit: 25 };

  function curseurDe(extra: Record<string, unknown> = {}): string {
    const request = ok({ ...journal, ...extra });
    return encodeExplorerCursor({
      fingerprint: explorerFingerprint(request.query, request.plan),
      ts: "2026-09-17T11:00:00.000000Z",
      key: "42",
    });
  }

  it("un curseur cohérent est accepté, et sa précision microseconde préservée", () => {
    const request = ok({ ...journal, cursor: curseurDe() });
    expect(request.plan.cursor?.ts).toBe("2026-09-17T11:00:00.000000Z");
    expect(request.plan.cursor?.key).toBe("42");
  });

  it("un curseur falsifié est refusé", () => {
    expect(codeDe({ ...journal, cursor: "pas-du-base64url!!" })).toBe("invalid_cursor");
    expect(codeDe({ ...journal, cursor: Buffer.from("[1,2]").toString("base64url") })).toBe("invalid_cursor");
    expect(codeDe({ ...journal, cursor: Buffer.from('["zzzz","x","1"]').toString("base64url") })).toBe("invalid_cursor");
    // Empreinte bien formée mais fausse : la requête n'a pas produit ce curseur.
    expect(codeDe({ ...journal, cursor: Buffer.from('["deadbeef","2026-09-17T11:00:00Z","1"]').toString("base64url") })).toBe(
      "stale_cursor",
    );
  });

  it("changer la plage, un filtre, le jeu ou l'app périme le curseur", () => {
    const cursor = curseurDe();
    expect(codeDe({ ...journal, cursor, range: { preset: "7d" } })).toBe("stale_cursor");
    expect(codeDe({ ...journal, cursor, filters: [{ field: "route", operator: "eq", value: "/a" }] })).toBe("stale_cursor");
    expect(codeDe({ ...journal, cursor, dataset: "views", measure: { aggregation: "count", field: "rows" } })).toBe(
      "stale_cursor",
    );
    expect(codeDe({ ...journal, cursor, includeBots: true })).toBe("stale_cursor");
    expect(codeDe({ ...journal, cursor, app: null })).toBe("stale_cursor");
  });

  it("changer la seule représentation ou le seul tri du haut ne périme PAS le curseur", () => {
    // Le journal est trié par temps décroissant, quelle que soit la mesure : une
    // mesure différente ne déplace aucune ligne, donc ne casse pas la pagination.
    const cursor = curseurDe();
    expect(codeDe({ ...journal, cursor, measure: { aggregation: "distinct", field: "sessions" } })).toBe("ok");
    expect(codeDe({ ...journal, cursor, limit: 100 })).toBe("ok");
  });

  it("un curseur n'a pas de sens hors du journal", () => {
    expect(codeDe({ visualization: "toplist", cursor: curseurDe() })).toBe("invalid_cursor");
  });
});

describe("AST canonique — rejouable, sans donnée de résultat", () => {
  it("une fenêtre glissante reste glissante, une plage personnalisée garde ses instants", () => {
    const glissante = ok({ groupBy: ["release"], visualization: "toplist", limit: 5 });
    expect(canonicalAst(glissante.query, glissante.plan)).toEqual({
      version: EXPLORER_VERSION,
      app: "demo-app",
      range: { preset: "24h" },
      dataset: "errors",
      measure: { aggregation: "sum", field: "occurrences" },
      filters: [],
      groupBy: ["release"],
      visualization: "toplist",
      limit: 5,
    });
    const fixe = ok({ range: { from: "2026-09-17T10:00:00Z", to: "2026-09-17T11:00:00Z" } });
    expect(canonicalAst(fixe.query, fixe.plan).range).toEqual({
      from: "2026-09-17T10:00:00.000Z",
      to: "2026-09-17T11:00:00.000Z",
    });
  });

  it("l'AST canonique se rejoue à l'identique", () => {
    const depart = ok({
      dataset: "vitals",
      variant: "LCP",
      measure: { aggregation: "p75", field: "value" },
      filters: [{ field: "browser", operator: "eq", type: "string", value: "Firefox" }, { field: "os", operator: "is_null" }],
      groupBy: ["release", "route"],
      visualization: "timeseries",
      limit: 3,
      includeBots: true,
    });
    const ast = canonicalAst(depart.query, depart.plan);
    const rejeu = parseExplorerQuery(ast, { principal: ADMIN, nowMs: NOW });
    expect(rejeu.ok).toBe(true);
    if (!rejeu.ok) return;
    expect(canonicalAst(rejeu.value.query, rejeu.value.plan)).toEqual(ast);
  });
});

describe("registre public — des capacités, jamais un schéma", () => {
  const schema = publicSchema(() => ({ available: true, reason: null }), { saveToDashboard: false });

  it("ne publie ni table, ni colonne interne, ni secret", () => {
    const texte = JSON.stringify(schema).toLowerCase();
    for (const interdit of ["rum_", "syn_snapshot", "app_registry", "select ", "information_schema", "jsonb"]) {
      expect(texte, interdit).not.toContain(interdit);
    }
    // Les colonnes qui n'appartiennent pas au vocabulaire public ne sortent pas
    // non plus sous leur nom nu : l'identifiant d'une colonne de journal est un
    // nom d'API, pas le nom de la colonne qui l'alimente.
    for (const interdit of [
      "device_type", "geo_country", "id_kind", "last_seen_at", "started_at", "session_id",
      "error_type", "error_source", "nav_type", "status_code", "event_type", "page_count",
      "visitor_id", "user_id_hash", "collection_source", "is_bot", "app_id", "metric_uid",
    ]) {
      expect(texte, interdit).not.toContain(interdit);
    }
  });

  it("un identifiant de colonne publique ne nomme jamais la colonne SQL qui l'alimente", () => {
    // Sauf là où le nom EST le contrat (route, occurrences, durée…) : ce sont des
    // identifiants d'API que la spec publie déjà.
    const vocabulairePublic = new Set([
      "route", "name", "type", "value", "rating", "occurrences", "fingerprint",
      // P8.7 : `country_source` est un identifiant d'API (contrat de filtre du
      // registre P6.2) ; la colonne qui l'alimente s'appelle `geo_source`.
      "country_source",
      "duration_ms", "transfer_size", "blocking_ms", "tier",
    ]);
    for (const id of EXPLORER_DATASET_IDS) {
      for (const colonne of datasetDefinition(id).rows) {
        if (vocabulairePublic.has(colonne.id)) continue;
        expect(colonne.id, `${id}.${colonne.id}`).not.toBe(colonne.column);
      }
    }
  });

  it("publie les limites du contrat et le droit d'écriture réel", () => {
    expect(schema.limits.groups).toBe(MAX_GROUPS);
    expect(schema.limits.rows).toBe(MAX_ROWS);
    expect(schema.capabilities.save_to_dashboard).toBe(false);
    expect(publicSchema(() => ({ available: true, reason: null }), { saveToDashboard: true }).capabilities.save_to_dashboard).toBe(
      true,
    );
  });

  it("annonce la raison d'une dimension indisponible plutôt que de la taire", () => {
    const partiel = publicSchema(
      (_dataset, dimension) =>
        dimension === "service" ? { available: false, reason: "pas encore collecté" } : { available: true, reason: null },
      { saveToDashboard: false },
    );
    const service = partiel.datasets[0].dimensions.find((d) => d.id === "service");
    expect(service).toEqual({ id: "service", label: expect.any(String), available: false, reason: "pas encore collecté" });
  });

  it("dérive l'additivité plutôt que de la déclarer deux fois", () => {
    for (const dataset of schema.datasets) {
      for (const field of dataset.fields) {
        expect(field.additive.every(estAdditive), `${dataset.id}.${field.id}`).toBe(true);
        expect(field.aggregations.filter(estAdditive), `${dataset.id}.${field.id}`).toEqual(field.additive);
      }
    }
  });
});

describe("mesures rendues sans arrondi silencieux", () => {
  it("un entier exact reste exact, un dépassement est SIGNALÉ", () => {
    expect(mesureNumerique("38")).toEqual({ value: 38, approx: false });
    expect(mesureNumerique(null)).toEqual({ value: null, approx: false });
    expect(mesureNumerique("12.5")).toEqual({ value: 12.5, approx: false });
    const enorme = mesureNumerique("9007199254740993");
    expect(enorme.approx).toBe(true);
    expect(enorme.value).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  it("une valeur illisible vaut null, jamais zéro", () => {
    expect(mesureNumerique("NaN")).toEqual({ value: null, approx: false });
    expect(mesureNumerique("Infinity")).toEqual({ value: null, approx: false });
  });
});

// F34 — une vue enregistrée depuis une URL garde TOUTES ses conditions de population.
describe("F34 — AST canonique : paramètres dédiés compris", () => {
  it("`release=` et `device=` de l'URL entrent dans `filters`, et la réouverture les rejoue", () => {
    const qs =
      "app=demo-app&period=1h&release=p65-e2e-rel&device=desktop&seg=v2:browser:is_null&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&limit=5";
    const query = f34ParseAnalyticsQuery(new URLSearchParams(qs), { principal: ADMIN, nowMs: NOW });
    if (!query.ok) throw new Error(query.error.code);
    const plan = f34ParseExplorerPlan(f34ExplorerSource(new URLSearchParams(qs)), query.value);
    if (!plan.ok) throw new Error(plan.error.code);

    const ast = canonicalAst(query.value, plan.value);
    expect(ast.filters).toEqual([
      { field: "device", operator: "eq", type: "string", value: "desktop" },
      { field: "release", operator: "eq", type: "string", value: "p65-e2e-rel" },
      { field: "browser", operator: "is_null" },
    ]);
    // Rejouée par l'API ou par une vue : même AST.
    const rejeu = parseExplorerQuery(ast, { principal: ADMIN, nowMs: NOW });
    expect(rejeu.ok).toBe(true);
    if (rejeu.ok) expect(canonicalAst(rejeu.value.query, rejeu.value.plan)).toEqual(ast);
    // Rouverte depuis la liste des vues : la release est dans la population rejouée.
    const ouvrir = f34ExplorerHrefFromAst(ast);
    expect(ouvrir.ok).toBe(true);
    if (ouvrir.ok) expect(new URLSearchParams(ouvrir.href.split("?")[1]).get("seg")).toContain("release:eq:p65-e2e-rel");
  });
});
