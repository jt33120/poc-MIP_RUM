# MIP RUM — intégration FastAPI (tracing distribué)

Un seul fichier à copier dans le backend client : `mip_rum_middleware.py`
(stdlib uniquement, aucune dépendance ajoutée à `requirements.txt`).

## Installation

```python
# main.py
from mip_rum_middleware import MIPRumMiddleware
app.add_middleware(MIPRumMiddleware)
```

Sans variables d'environnement, le middleware est un **passthrough total**
(aucun objet créé par requête au-delà d'un test booléen) : le merge est sans
risque, l'activation se fait au déploiement.

## Activation (variables d'environnement)

```ini
MIP_RUM_ENDPOINT=https://<projet>.supabase.co/functions/v1/v1-traces
MIP_RUM_APP_ID=gip-plateforme
MIP_RUM_API_KEY=            # optionnel (app sans clé : laisser vide)
MIP_RUM_IGNORE=/health      # défaut : /health,/docs,/openapi.json,/favicon.ico
```

## Ce qui est collecté (et rien d'autre)

Par requête : route template (`/aos/{ao_id}`, jamais l'URL brute), méthode,
statut HTTP, durée serveur en ms, et les identifiants W3C (`traceparent` /
`tracestate: mip=s:<session>`) posés par le SDK web MIP RUM. **Ni corps, ni
query string, ni headers métier, ni IP.** Envoi par batch (5 s / 20 spans),
best effort, timeout 3 s : l'API ne ralentit ni ne casse jamais.

## Tests

```bash
python3 -m unittest discover integrations/fastapi -v
```
