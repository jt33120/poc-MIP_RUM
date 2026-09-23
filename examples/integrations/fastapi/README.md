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

## Contexte de requête et capture manuelle

Trois fonctions, toujours **stdlib seule** (`contextvars`, `contextlib`) :

```python
from mip_rum_middleware import MIPRumMiddleware, capture_exception, current_context, rum_context
```

| Fonction | Rôle |
| --- | --- |
| `rum_context(**attributs)` | scope de contexte, restauré à la sortie du bloc |
| `capture_exception(exc, context=None)` | exception rattrapée → événement du span de la requête |
| `current_context()` | copie en lecture du contexte courant, ou `None` hors requête |

```python
@app.post("/commandes")
async def creer(commande: Commande):
    with rum_context(user_id=commande.client, canal="web"):
        try:
            return await traiter(commande)
        except PaiementRefuse as exc:
            capture_exception(exc, {"moyen": commande.moyen})
            raise
```

**Isolation.** Le contexte vit dans un `ContextVar` : chaque requête a le sien,
chaque tâche `asyncio` hérite du sien, et le scope précédent est restauré dans un
`finally` — y compris quand le bloc lève. Rien ne survit à la fin d'une requête
(vérifié sur 100 requêtes concurrentes entrelacées, `test_mip_rum_middleware.py`).

**Scopes imbriqués.** `rum_context` hérite du scope englobant. Sa vue lexicale
disparaît à la sortie du bloc, mais ce qu'il **déclare** reste attaché à la
requête : c'est son span qui le portera (`mip.context`).

**Clés reconnues** : `session_id`, `route`, `user_id`, `account_id` alimentent les
champs du span ; tout le reste est du contexte métier libre (chaînes bornées à
500 caractères, nombres, booléens, et `None` qui reste « inconnu »). Les
identités partent **brutes** (`mip.identity.user_id`) : leur HMAC app-scopé est
calculé au port d'ingestion, jamais ici.

**Déduplication.** L'identifiant `mip.exception_id` est porté par l'objet
exception. `capture_exception(exc)` puis `raise` ne produit donc **qu'une** erreur.
Deux exceptions différentes (`raise Autre from exc`) restent deux erreurs : on ne
devine pas une égalité. Une exception capturée puis **traitée** ne fait pas échouer
la requête — la réponse est partie normalement, le span garde son statut.

**Hors requête**, `capture_exception` renvoie `False` et `rum_context` ne fait
rien : cette intégration n'ouvre pas de route pour un script ou une tâche de
fond, et le code instrumenté reste appelable depuis un test.

## Tests

```bash
python3 -m unittest discover examples/integrations/fastapi -v
```
