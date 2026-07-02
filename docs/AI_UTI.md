# Prompt à coller — session Claude sur `uti-platform` (instrumentation IA → MIP RUM)

> **UN SEUL document à donner.** Copie le bloc **PROMPT** dans ta session Claude ouverte sur
> `uti-platform`. Objectif : faire **remonter chaque appel LLM du backend** vers MIP RUM (page
> « Performance IA »), en réutilisant la config RUM déjà en place. **Backend only.**
>
> MIP RUM ingère les appels IA au format **OTel GenAI** (`gen_ai.*`) via l'edge function
> `v1-traces` déjà utilisée par ton middleware. Un appel LLM = **un span `gen_ai`**. Le coût est
> estimé côté RUM (table de prix) — tu n'envoies que provider/model/tokens/latence.

## PROMPT

Tu travailles sur **uti-platform** (backend FastAPI/Python). Il existe déjà
`backend/mip_rum_middleware.py` qui POST des spans OTLP `http.server` vers `MIP_RUM_ENDPOINT`.
**Ajoute l'instrumentation des appels LLM** : émettre un span OTLP **`gen_ai`** par appel, vers le
même endpoint, avec la même `MIP_RUM_APP_ID` / `MIP_RUM_API_KEY`. Ne touche pas à la logique métier.

### 1. Ce qu'il faut émettre (par appel LLM)

Un span OTLP/HTTP JSON, **même enveloppe** que le middleware existant :
- `resource.attributes` : `mip.app_id` (= `MIP_RUM_APP_ID`), `mip.api_key` (= `MIP_RUM_API_KEY`).
- `scopeSpans[].spans[]` : `name: "gen_ai"`, `spanId` (16 hex aléatoires), `startTimeUnixNano`,
  `endTimeUnixNano` (pour la **latence** = durée du span), et `attributes` :

| Attribut (OTel GenAI) | Valeur | Requis |
|---|---|---|
| `gen_ai.system` | provider : `openai` / `anthropic` / `mistral` / `openrouter` / `google` | ✅ (ou model) |
| `gen_ai.request.model` | modèle demandé (ex. `claude-sonnet-4`) | ✅ (ou provider) |
| `gen_ai.operation.name` | `chat` / `embeddings` | conseillé |
| `gen_ai.usage.input_tokens` | tokens prompt (int) | conseillé |
| `gen_ai.usage.output_tokens` | tokens complétion (int) | conseillé |
| `gen_ai.usage.cost` | coût réel USD si le provider le donne (OpenRouter) | optionnel (sinon estimé côté RUM) |
| `mip.route` | route backend qui a déclenché l'appel (ex. `/api/chat`) | conseillé |
| `error.type` | classe d'erreur si l'appel a échoué (→ statut `error`) | si erreur |
| `mip.session_id` **ou** `traceState: "mip=s:<sessionId>"` | session RUM du visiteur, si connue dans la requête | optionnel (relie l'usage IA au parcours utilisateur) |

Extraction des tokens selon le SDK (comme xsom `_inspect`) : OpenAI-compatible →
`usage.prompt_tokens` / `usage.completion_tokens` ; Anthropic → `usage.input_tokens` /
`usage.output_tokens`.

### 2. Implémentation conseillée

Réutilise le **mécanisme d'envoi du middleware existant** (`mip_rum_middleware.py` : sa file/batch
+ POST httpx best-effort, timeout court, échec silencieux). Ajoute un petit helper, ex.
`backend/mip_rum_ai.py` :

```python
# Enveloppe un appel LLM : chronomètre, extrait l'usage, émet un span gen_ai vers MIP RUM.
import time, secrets
def record_ai_call(*, provider, model, operation="chat", route=None, session_id=None):
    # context manager : mesure la latence, tu renseignes les tokens à la sortie
    ...
```
Usage type :
```python
with record_ai_call(provider="anthropic", model="claude-sonnet-4",
                    route=request.url.path, session_id=session_id) as call:
    resp = client.messages.create(...)
    call.usage(input_tokens=resp.usage.input_tokens,
               output_tokens=resp.usage.output_tokens)
# à la sortie du bloc : span gen_ai émis (latence = durée du bloc). En cas d'exception,
# call.error(type(exc).__name__) et on ré-émet quand même le span (status error).
```

- `spanId` = `secrets.token_hex(8)`. `startTimeUnixNano`/`endTimeUnixNano` = `time.time_ns()`.
- Best-effort : si l'envoi échoue, **ne casse jamais** l'appel métier (comme le middleware).
- N'envoie **aucun contenu** de prompt/réponse — uniquement des métadonnées (tokens, modèle, latence).

### 3. Config (déjà présente)
Réutilise `MIP_RUM_ENDPOINT`, `MIP_RUM_APP_ID`, `MIP_RUM_API_KEY` de `backend/.env` (OVH). Rien de neuf.

### 4. Vérifie
- Fais 2-3 appels IA. Réponse `v1-traces` = 200.
- Signale-le : côté RUM on vérifie l'arrivée dans `rum_ai` (provider/model/tokens/coût/latence) et
  la page **`/ai`** « Performance IA » se remplit (KPIs + par modèle + par route).

### 5. Livrable
PR draft « Instrumentation IA → MIP RUM » : le helper + les points d'appel wrappés. Backend only,
aucun contenu utilisateur exfiltré.
