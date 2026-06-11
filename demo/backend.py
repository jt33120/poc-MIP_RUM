"""Mini backend FastAPI de démo — cible du tracing distribué (v0.4).

Lancement (depuis la racine du repo) :
  MIP_RUM_ENDPOINT=http://localhost:4318/v1/traces MIP_RUM_APP_ID=demo-app \
  MIP_RUM_API_KEY=demo-key-local python3 demo/backend.py

Sert /api/demo/* sur :8001 ; le middleware MIP RUM y est branché exactement
comme sur un backend client (uti-platform) : env vars + add_middleware.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "integrations", "fastapi"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from mip_rum_middleware import MIPRumMiddleware

app = FastAPI(title="Démo MIP RUM — backend")

# ordre Starlette : dernier ajouté = plus externe ; MIP RUM en premier pour
# mesurer le temps serveur seul (CORS au-dessus répond aux préflights sans span)
app.add_middleware(
    MIPRumMiddleware,
    flush_s=float(os.environ.get("MIP_RUM_FLUSH_S", "5")),
    batch_size=int(os.environ.get("MIP_RUM_BATCH", "20")),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],  # couvre traceparent / tracestate
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), log_level="warning")
