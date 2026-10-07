"""Mini backend FastAPI de démo — cible du tracing distribué bout en bout.

Aucun capteur MIP ici : le serveur tourne sous l'agent OpenTelemetry OFFICIEL de
Python, sans une ligne d'instrumentation, exactement comme un backend client
(socle OTEL_* de la recette serveur). Ce que ce fichier prouve, c'est que MIP accueille ce
que l'agent envoie tel quel.

Installation (une fois, versions figées) :
  python3 -m venv tests/e2e/site-cobaye/.venv
  tests/e2e/site-cobaye/.venv/bin/pip install -r tests/e2e/site-cobaye/requirements.txt

Lancement (depuis la racine du dépôt), socle commun `OTEL_*` seul :
  OTEL_SERVICE_NAME=site-cobaye-backend \
  OTEL_RESOURCE_ATTRIBUTES=mip.app_id=demo-app,mip.api_key=demo-key-local,deployment.environment.name=e2e \
  OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces \
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs \
  OTEL_EXPORTER_OTLP_COMPRESSION=gzip \
  OTEL_TRACES_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp OTEL_METRICS_EXPORTER=none \
  tests/e2e/site-cobaye/.venv/bin/opentelemetry-instrument \
    tests/e2e/site-cobaye/.venv/bin/uvicorn --app-dir tests/e2e/site-cobaye backend:app \
    --host 127.0.0.1 --port 8001

Sert /api/demo/* sur :8001. `tests/e2e/tracing.spec.ts` le lance ainsi, avec un
délai d'export court (`OTEL_BSP_SCHEDULE_DELAY`) pour que les spans partent vite.
"""

import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Démo MIP RUM — backend")

# Le front (:8080) appelle ce backend en cross-origin avec `traceparent` et
# `tracestate` : sans ces en-têtes autorisés, le préflight les refuserait et la
# trace s'arrêterait au navigateur.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/demo/items/{item_id}")
async def item(item_id: int):
    await asyncio.sleep(0.15)  # travail serveur simulé (visible dans la part serveur)
    return {"id": item_id, "name": f"item {item_id}"}


@app.get("/api/demo/fail")
async def fail():
    raise HTTPException(status_code=500, detail="erreur de démo backend")


@app.get("/health")
async def health():
    return {"status": "ok"}
