// Writer ClickHouse — interface HTTP, zéro dépendance (fetch natif node 26).
// Insertion par lots JSONEachRow + helper de requête (FORMAT JSON).
// Conçu pour être branché derrière STORE=clickhouse|both dans le dev-server,
// et utilisé tel quel par bench.mjs.
import { readFile } from "node:fs/promises";

const DEFAULT_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const DEFAULT_DB = process.env.CLICKHOUSE_DB || "mip_rum";

/**
 * Construit les query-string de l'API HTTP CH. `params` → binding serveur natif
 * `param_<name>` (anti-injection : la valeur n'est jamais concaténée dans le SQL ;
 * référencée par `{name:Type}` dans la requête). PUR → testable sans réseau.
 */
export function chSearchParams(database, query, params = {}) {
  const sp = new URLSearchParams({ database, query });
  for (const [k, v] of Object.entries(params)) sp.set(`param_${k}`, String(v));
  return sp;
}

export function createChWriter({ url = DEFAULT_URL, database = DEFAULT_DB, batchSize = 10_000 } = {}) {
  const base = url.replace(/\/$/, "");

  async function raw(query, body, params = {}) {
    const sp = chSearchParams(database, query, params);
    const res = await fetch(`${base}/?${sp}`, {
      method: "POST",
      body: body ?? "",
      headers: { "content-type": "text/plain" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ClickHouse HTTP ${res.status}: ${text.slice(0, 500)}`);
    return text;
  }

  return {
    /** Exécute une requête (DDL/DML). `params` = binding serveur CH `{name:Type}`. */
    exec: (sql, params = {}) => raw(sql, undefined, params),

    /**
     * SELECT → tableau d'objets (FORMAT JSON ajouté automatiquement). `params`
     * = binding serveur CH (`{name:Type}` dans le SQL), jamais concaténé.
     */
    async query(sql, params = {}) {
      const text = await raw(`${sql.trim().replace(/;\s*$/, "")} FORMAT JSON`, undefined, params);
      return JSON.parse(text).data;
    },

    /** Insertion par lots JSONEachRow. rows = objets {col: valeur}. */
    async insert(table, rows) {
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const body = chunk.map((r) => JSON.stringify(r)).join("\n");
        await raw(`INSERT INTO ${table} FORMAT JSONEachRow`, body);
      }
      return rows.length;
    },

    /** Applique un fichier .sql (statements séparés par ';' — HTTP = 1 statement/requête). */
    async applySchemaFile(path) {
      const sql = await readFile(path, "utf8");
      const statements = sql
        .split(/;\s*(?:\n|$)/)
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);
      for (const stmt of statements) await raw(stmt);
      return statements.length;
    },

    /** true si le serveur répond (healthcheck). */
    async ping() {
      try {
        const res = await fetch(`${base}/ping`);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
