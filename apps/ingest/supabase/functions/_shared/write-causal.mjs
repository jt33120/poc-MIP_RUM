/**
 * Écritures Supabase compatibles avec une fenêtre de déploiement code v67 / DB v66,
 * puis code v69 / DB v66 à v68 (enveloppe d'erreur P5.1), puis code v70 / DB v69
 * (exceptions dérivées P5.3).
 *
 * Ce module ne dépend ni de Deno ni du client Supabase concret : le receiver Edge
 * l'utilise en production et les tests Node exercent exactement les mêmes branches
 * de repli. Les racines sont toujours écrites avant les enfants causaux.
 */
export function createSchemaCompatibleWriter(supabase, { retry, onRetry }) {
  // Colonnes de migration-v69 (P5.1) : enveloppe d'erreur et corrélation.
  const errorEnvelopeColumns = [
    "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal", "context",
    "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
  ];
  // Colonnes de migration-v70 (P5.3) : origine d'une exception dérivée.
  const errorOriginColumns = ["origin_signal", "exception_id"];
  const columns = {
    rum_action: ["action_id", "span_id", "session_id", "app_id", "type", "name", "route", "context", "ts"],
    rum_pageview: ["span_id", "session_id", "app_id", "route", "url", "referrer", "nav_type", "started_at"],
    rum_metric: ["span_id", "session_id", "app_id", "route", "name", "value", "rating", "attribution", "metric_uid", "ts"],
    rum_error: ["span_id", "session_id", "app_id", "route", "kind", "message", "error_type", "stack", "source", "lineno", "colno", "release", "fingerprint", "occurrences", "action_id", ...errorEnvelopeColumns, ...errorOriginColumns, "ts"],
    rum_resource: ["span_id", "session_id", "app_id", "route", "url", "type", "duration_ms", "transfer_size", "render_blocking", "action_id", "ts"],
    rum_longtask: ["span_id", "session_id", "app_id", "route", "duration_ms", "source", "blocking_ms", "render_ms", "script_url", "script_function", "script_ms", "invoker", "ts"],
    rum_breadcrumb: ["span_id", "session_id", "app_id", "route", "type", "label", "seq", "action_id", "ts"],
    rum_event: ["span_id", "session_id", "app_id", "route", "name", "props", "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value", "ts"],
    rum_span: ["span_id", "trace_id", "parent_span_id", "tier", "session_id", "app_id", "route", "url", "method", "status_code", "duration_ms", "name", "kind", "action_id", "ts"],
    rum_event_index: ["app_id", "session_id", "ts", "route", "kind", "source_name", "source_span_id", "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value"],
  };
  const p2EventColumns = [
    "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name",
    "action_id", "timing_ms", "feature_flag_value",
  ];
  const schemaMismatch = (error) =>
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code ?? "") ||
    /column .* does not exist|could not find .* column|table .* schema cache/i.test(error?.message ?? "");

  const without = (batch, cols) => batch.map((row) => {
    const copy = { ...row };
    for (const col of cols) delete copy[col];
    return copy;
  });
  const project = (table, batch) => {
    const allowed = new Set(columns[table] ?? []);
    return batch.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))));
  };
  // Un upsert en masse envoie NULL pour une clé absente d'une ligne, et non le
  // DEFAULT : sans `{}` explicite, une erreur sans contexte violerait le NOT NULL
  // de v69 et ferait échouer tout le lot.
  const errorRows = (errors) => project("rum_error", errors).map((row) => ({ ...row, context: row.context ?? {} }));

  const write = async (table, batch, options) => retry(async () => {
    const { error } = await supabase.from(table).upsert(batch, options);
    if (error) throw error;
  }, { onRetry });

  /**
   * `stripOnOldSchema` liste des PALIERS, de la migration la plus récente à la
   * plus ancienne ; chaque repli retire en plus les colonnes du palier suivant.
   * Tout retirer d'un coup ferait perdre, sur une base v67/v68, l'action_id
   * qu'elle sait déjà stocker, pour la seule absence des colonnes v69.
   */
  const ins = async (table, batch, opts = {}) => {
    if (!batch.length) return;
    const options = { onConflict: "span_id", ignoreDuplicates: true };
    const paliers = opts.stripOnOldSchema ?? [];
    for (let replis = 0; ; replis++) {
      const retirees = paliers.slice(0, replis).flat();
      try {
        await write(table, retirees.length ? without(batch, retirees) : batch, options);
        return;
      } catch (error) {
        if (!schemaMismatch(error)) throw error;
        if (opts.optionalOnOldSchema) return;
        if (replis >= paliers.length) throw error;
      }
    }
  };

  /**
   * Erreurs d'un lot. Les lignes reçues suivent les paliers de schéma. Une
   * exception dérivée (P5.3) exige v70 : sans `origin_signal`, le métering la
   * facturerait en plus de son span porteur ; elle est alors ignorée, comme sur le
   * chemin PostgreSQL. Ce receveur ne vérifie pas les sessions revendiquées : ses
   * exceptions dérivées restent sans session, jamais rattachées à l'aveugle.
   */
  const writeErrors = async (errors) => {
    const rows = errorRows(errors);
    await ins("rum_error", rows.filter((row) => !row.origin_signal), { stripOnOldSchema: [errorEnvelopeColumns, ["action_id"]] });
    await ins("rum_error", rows.filter((row) => row.origin_signal), { optionalOnOldSchema: true });
  };

  const insOn = async (
    table,
    batch,
    conflict,
    optionalOnOldSchema = false,
    legacyBatch,
    ignoreDuplicates = false,
    schemaLegacyBatch = legacyBatch,
  ) => {
    if (!batch.length) return;
    const options = { onConflict: conflict, ...(ignoreDuplicates ? { ignoreDuplicates: true } : {}) };
    try {
      await write(table, batch, options);
    } catch (error) {
      if (legacyBatch && error?.code === "23514" && /source_name/i.test(error.message ?? "")) {
        await write(table, legacyBatch, options);
        return;
      }
      if (!schemaMismatch(error)) throw error;
      if (schemaLegacyBatch?.length) {
        await write(table, schemaLegacyBatch, options);
        return;
      }
      if (!optionalOnOldSchema) throw error;
    }
  };

  return {
    ins,
    insOn,
    /** Table absente en v66 : ce repli est volontairement silencieux. */
    writeActionRoots: (actions) => insOn("rum_action", project("rum_action", actions), "action_id", true, undefined, true),
    /** Colonnes/taxonomie absentes en v66 : réécriture sans perdre le lot P2. */
    async writeCausalChildren({ errors, resources, breadcrumbs, spans, eventIndex }) {
      await writeErrors(errors);
      await ins("rum_resource", project("rum_resource", resources), { stripOnOldSchema: [["action_id"]] });
      await ins("rum_breadcrumb", project("rum_breadcrumb", breadcrumbs), { stripOnOldSchema: [["action_id", "route"]] });
      await ins("rum_span", project("rum_span", spans), { stripOnOldSchema: [["action_id"]] });
      const currentIndex = project("rum_event_index", eventIndex);
      const taxonomyFallback = currentIndex.map((event) => event.source_name === "frustration.error"
        ? { ...event, source_name: "track" }
        : event);
      const schemaFallback = without(taxonomyFallback, p2EventColumns);
      await insOn(
        "rum_event_index",
        currentIndex,
        "app_id,kind,source_span_id",
        true,
        taxonomyFallback,
        false,
        schemaFallback,
      );
    },
    /** Exacte phase collections du receiver Edge, testable hors runtime Deno. */
    async writeTraceCollections({
      actions = [], pageviews = [], metrics = [], errors = [], resources = [],
      longtasks = [], breadcrumbs = [], events = [], spans = [], eventIndex = [],
    }) {
      await insOn("rum_action", project("rum_action", actions), "action_id", true, undefined, true);
      await ins("rum_pageview", project("rum_pageview", pageviews.map(({ ts, ...pageview }) => ({ ...pageview, started_at: ts }))));
      await ins("rum_metric", project("rum_metric", metrics));
      await ins("rum_longtask", project("rum_longtask", longtasks));
      await ins("rum_event", project("rum_event", events), { stripOnOldSchema: [p2EventColumns] });
      await writeErrors(errors);
      await ins("rum_resource", project("rum_resource", resources), { stripOnOldSchema: [["action_id"]] });
      await ins("rum_breadcrumb", project("rum_breadcrumb", breadcrumbs), { stripOnOldSchema: [["action_id", "route"]] });
      await ins("rum_span", project("rum_span", spans), { stripOnOldSchema: [["action_id"]] });
      const currentIndex = project("rum_event_index", eventIndex);
      const taxonomyFallback = currentIndex.map((event) => event.source_name === "frustration.error"
        ? { ...event, source_name: "track" }
        : event);
      const schemaFallback = without(taxonomyFallback, p2EventColumns);
      await insOn(
        "rum_event_index",
        currentIndex,
        "app_id,kind,source_span_id",
        true,
        taxonomyFallback,
        false,
        schemaFallback,
      );
    },
  };
}
