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
`tracestate: mip=s:<session>`) posés par le SDK web MIP RUM ; pour une exception
non gérée, son type, son message et sa traceback, nettoyés de la PII à
l'ingestion. **Ni corps, ni query string, ni headers métier, ni IP.** Envoi par
batch (5 s / 20 spans), best effort, timeout 3 s : l'API ne ralentit ni ne casse
jamais.

## Exceptions non gérées

Une exception qui traverse toute l'app devient un **événement `exception`** du span
(type, message, traceback, `mip.exception_id`), puis **remonte intacte** au serveur ASGI :
le middleware ne l'avale jamais.

- **Avant le début de la réponse** : le serveur répondra 500, le span porte `http.status_code`
  500, le statut OTLP ERROR et `error.type`.
- **Après le début de la réponse** (flux interrompu) : le span garde le **statut réellement
  envoyé** et porte l'indicateur d'échec (statut OTLP ERROR, `error.type`) — jamais un 500
  inventé.
- Une réponse d'erreur rendue par l'app (`HTTPException`) n'est pas une exception ; une
  annulation (`asyncio.CancelledError`, client parti) non plus.

L'ingestion en fait une erreur `python`, rattachée à la trace et au span de la requête, sans
session inventée.

## Tests

```bash
python3 -m unittest discover integrations/fastapi -v
```
