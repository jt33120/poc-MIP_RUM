// Recettes d'intégration backend (tracing front→back) affichées dans le wizard
// client. Pur : de simples chaînes paramétrées par l'endpoint d'ingestion et
// l'app_id. Extrait de app/admin/customers/[appId]/page.tsx pour garder la page
// focalisée sur le rendu.

export interface BackendRecipes {
  /** Auto-instrumentation OpenTelemetry, sans toucher au code applicatif. */
  otel: string;
  /** Câblage du middleware FastAPI/Starlette (Python). */
  fastapi: string;
  /** Câblage du middleware Express/Connect (Node). */
  express: string;
  /** Protocole générique pour toute autre stack. */
  other: string;
}

/** Construit les 4 recettes backend pour un client donné (endpoint + app_id). */
export function buildBackendRecipes({
  endpoint,
  appId,
}: {
  endpoint: string;
  appId: string;
}): BackendRecipes {
  const otel = `# Backend codeless — aucune modification du code (exemple Python : FastAPI/Django/Flask) :
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install

# Lancer l'app sous l'agent OTel, en pointant vers le Collector local (otel-collector.yaml) :
OTEL_SERVICE_NAME=${appId} \\
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318" \\
opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000

# Le Collector ne garde que les spans serveur, injecte mip.app_id + la clé, et
# réémet en OTLP/HTTP JSON vers ${endpoint}. L'ingestion MIP accepte nativement
# les spans serveur OpenTelemetry standard (Java/.NET/Go/Node/Ruby/PHP de même).`;

  const fastapi = `# 1. Pose mip_rum_middleware.py à côté de main.py (télécharge-le ci-dessous)
# 2. Dans config.py (pydantic-settings) — ATTENTION : le .env chargé par
#    pydantic-settings ne remplit PAS os.environ, il faut passer par Settings :
class Settings(BaseSettings):
    ...
    mip_rum_endpoint: Optional[str] = None
    mip_rum_app_id: Optional[str] = None
    mip_rum_api_key: Optional[str] = None

# 3. Dans main.py :
from mip_rum_middleware import MIPRumMiddleware
app.add_middleware(
    MIPRumMiddleware,
    endpoint=settings.mip_rum_endpoint,
    app_id=settings.mip_rum_app_id,
    api_key=settings.mip_rum_api_key,
)

# 4. Dans le .env du serveur :
MIP_RUM_ENDPOINT=${endpoint}
MIP_RUM_APP_ID=${appId}
MIP_RUM_API_KEY=<la clé affichée à la création>`;

  const express = `// 1. Pose mip-rum-express.js dans ton projet (télécharge-le ci-dessous)
// 2. Dans app.js / server.js (Node >= 18) :
const mipRum = require("./mip-rum-express");
app.use(mipRum()); // AVANT tes routes

// 3. Dans l'environnement du serveur :
MIP_RUM_ENDPOINT=${endpoint}
MIP_RUM_APP_ID=${appId}
MIP_RUM_API_KEY=<la clé affichée à la création>`;

  const other = `Protocole (toute stack) — 3 règles :
1. Lire le header "traceparent" entrant : 00-<trace_id 32hex>-<parent_span_id 16hex>-01
   (et la session dans "tracestate" : mip=s:<session_id>)
2. Chronométrer la requête, puis construire un span OTLP/HTTP JSON :
   name "http.server", kind 2, attributs mip.trace_id, mip.span_id,
   mip.route (template, ex /partners/:id), http.method, http.status_code,
   http.duration_ms, mip.parent_span_id, mip.session_id
3. POST en batch vers ${endpoint}
   resource.attributes : mip.app_id="${appId}" (+ mip.api_key)
   Jamais de corps/query/header métier. Jamais d'exception vers l'app hôte.
Les deux fichiers fournis (FastAPI, Express) sont la référence d'implémentation.`;

  return { otel, fastapi, express, other };
}
