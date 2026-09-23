// Logger structuré (JSON lines) — runtime-agnostic : importé tel quel par le
// dev-server Node (local) ET les edge functions Deno (prod), comme otlp.mjs.
//
// Pourquoi : en prod, des logs `console.log("texte libre")` ne sont ni
// requêtables, ni corrélables, ni filtrables par niveau. Une ligne JSON par
// événement ({ts, level, service, msg, ...champs}) est ingérable telle quelle
// par Supabase Logs / Loki / Datadog, et le niveau se filtre via LOG_LEVEL.
//
// Garanties : aucun secret en clair (clés api_key/authorization/service_role…
// redacted), aucune exception ne remonte (le logging ne casse jamais l'appelant).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** Lecture d'env tolérante aux deux runtimes (Deno.env.get / process.env). */
function readEnv(name) {
  try {
    // typeof évite le ReferenceError quand Deno n'existe pas (Node) et vice-versa
    if (typeof Deno !== "undefined" && Deno?.env) return Deno.env.get(name) ?? undefined;
  } catch {
    /* accès env refusé (Deno sans --allow-env) : on retombe sur process */
  }
  if (typeof process !== "undefined" && process?.env) return process.env[name];
  return undefined;
}

const ENV_LEVEL = (readEnv("LOG_LEVEL") || "info").toLowerCase();
const THRESHOLD = LEVELS[ENV_LEVEL] ?? LEVELS.info;

// Clés dont la valeur ne doit jamais apparaître en clair dans les logs.
const REDACT = /^(api_?key|authorization|password|secret|token|service_role|cookie)$/i;

/** Remplace récursivement les valeurs sensibles par "[redacted]". Profondeur bornée. */
function redact(value, depth = 0) {
  if (depth > 4 || value == null || typeof value !== "object") return value;
  // les Error passent intactes : safeStringify les normalise (message/code)
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

/** Sérialisation défensive : BigInt -> string, cycles/Error -> message. */
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Error) return { name: v.name, message: v.message, code: v.code };
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[circular]";
      seen.add(v);
    }
    return v;
  });
}

function emit(service, level, msg, fields) {
  if (LEVELS[level] < THRESHOLD) return;
  let line;
  try {
    line = safeStringify({
      ts: new Date().toISOString(),
      level,
      service,
      msg: String(msg),
      ...redact(fields ?? {}),
    });
  } catch {
    line = `{"level":"${level}","service":"${service}","msg":${JSON.stringify(String(msg))}}`;
  }
  // warn/error -> stderr (séparation des flux pour les collecteurs)
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * Logger lié à un service.
 * @param {string} service nom logique du composant (ex: "v1-traces", "ingest").
 * @returns {{debug:Function, info:Function, warn:Function, error:Function, child:Function}}
 */
export function createLogger(service) {
  const at = (level) => (msg, fields) => emit(service, level, msg, fields);
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    /** Sous-logger avec des champs hérités (ex: { app_id }). */
    child: (bound) => {
      const childAt = (level) => (msg, fields) =>
        emit(service, level, msg, { ...bound, ...(fields ?? {}) });
      return {
        debug: childAt("debug"),
        info: childAt("info"),
        warn: childAt("warn"),
        error: childAt("error"),
      };
    },
  };
}

export const LOG_LEVELS = LEVELS;
