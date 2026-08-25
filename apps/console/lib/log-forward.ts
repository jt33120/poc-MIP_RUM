// Dogfooding — forwarde les logs serveur NOTABLES de la console vers l'ingestion
// LOGS (edge function v1-logs), tagués app_id 'mip-rum-console' (le même que le
// RUM auto-instrumenté). La console se supervise ainsi elle-même dans la page /logs.
//
// Best-effort par construction : jamais d'exception vers l'appelant (le logging ne
// doit pas casser une requête), timeout court, à planifier via after() pour ne pas
// retarder la réponse. Serveur uniquement (utilise fetch + env, importé côté serveur).

import { ingestEndpoint } from "./ingest-endpoint";
import { traceFields } from "./server-trace-core";

/**
 * Endpoint logs : explicite (CONSOLE_LOGS_ENDPOINT) sinon résolu par la fonction
 * unique d'AD-4.
 *
 * L'implémentation précédente dérivait cette URL du canal traces par
 * `replace("v1-traces", "v1-logs")`. Cette sous-chaîne datait des edge functions
 * Supabase (`/functions/v1/v1-traces`) et n'existe plus dans le chemin actuel
 * (`/api/ingest/v1/traces`) : le remplacement était donc devenu un no-op, et les
 * logs serveur de la console partaient sur le canal TRACES. Une résolution par
 * chemin, et non par substitution de sous-chaîne, ne peut pas échouer ainsi.
 *
 * Pas d'hôte de requête ici : ce code s'exécute en différé (`after()`), hors du
 * contexte de la requête d'origine — la résolution retombe donc sur l'hôte de
 * déploiement.
 */
function logsEndpoint(): string {
  return process.env.CONSOLE_LOGS_ENDPOINT ?? ingestEndpoint("logs");
}

const APP_ID = process.env.CONSOLE_LOG_APP_ID ?? "mip-rum-console";

export type LogLevel = "info" | "warn" | "error";
// OTLP severityNumber : INFO 9, WARN 13, ERROR 17.
const SEV_NUM: Record<LogLevel, number> = { info: 9, warn: 13, error: 17 };

type Fields = { route?: string; trace_id?: string; session_id?: string } & Record<
  string,
  string | undefined
>;

function kv(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

/**
 * Construit un enregistrement OTLP logs et le POST vers v1-logs. Résout toujours
 * (échec réseau avalé). Les champs `route`/`trace_id`/`session_id` sont mappés sur
 * les attributs mip.* attendus par le parser (corrélation trace/session).
 */
export async function forwardLog(level: LogLevel, body: string, fields?: Fields): Promise<void> {
  try {
    // Corrélation par défaut depuis la trace active : l'appelant n'a plus à
    // transporter trace_id à la main. Ce qu'il fournit explicitement gagne.
    const merged: Fields = { ...traceFields(), ...(fields ?? {}) };
    const attrs: { key: string; value: { stringValue: string } }[] = [];
    const map: Record<string, string> = {
      route: "mip.route",
      trace_id: "mip.trace_id",
      session_id: "mip.session_id",
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v == null) continue;
      attrs.push(kv(map[k] ?? k, String(v)));
    }
    const payload = {
      resourceLogs: [
        {
          resource: { attributes: [kv("mip.app_id", APP_ID), kv("mip.source", "backend")] },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(Date.now() * 1_000_000),
                  severityNumber: SEV_NUM[level],
                  severityText: level.toUpperCase(),
                  body: { stringValue: body.slice(0, 4000) },
                  // Champ NATIF OTLP en plus de l'attribut mip.* : c'est la forme
                  // canonique, celle que le parser lit en premier (otlp.mjs:604).
                  ...(merged.trace_id ? { traceId: merged.trace_id } : {}),
                  attributes: attrs,
                },
              ],
            },
          ],
        },
      ],
    };
    await fetch(logsEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // best-effort : jamais d'exception vers l'appelant.
  }
}
