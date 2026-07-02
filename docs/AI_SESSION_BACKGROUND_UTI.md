# Prompt à coller — propager la session RUM aux appels IA en tâche de fond (`uti-platform`)

> **But** : relier les appels IA exécutés en **BackgroundTask** (`matching-extract`, `matching-score`)
> à la **session RUM** du visiteur qui les a déclenchés — comme le fait déjà `assistant-chat` (#118).
> Aujourd'hui le `tracestate` de la requête HTTP n'est **pas transmis** à `background_tasks.add_task`,
> donc ces spans `gen_ai` arrivent sans `session_id` et « Performance IA » ne peut pas les rattacher
> au parcours utilisateur.
>
> **Impact perf : nul.** On passe une chaîne (l'id de session) déjà présente dans la requête à une
> tâche déjà planifiée. Aucun appel réseau ajouté, aucune latence.
>
> Copie le bloc **PROMPT** dans ta session Claude sur `uti-platform`.

---

## PROMPT

Tu travailles sur **uti-platform** (backend FastAPI). Les appels LLM en **tâche de fond**
(`services/ai_matching.py::extract_features`, `services/llm_scoring.py::llm_score`, et
`services/consultant_skills.py::auto_extract_skills`) émettent un span `gen_ai` **sans `session_id`**,
car le `tracestate` de la requête déclenchante n'est pas propagé jusqu'à la tâche. Corrige-le **sans
changer la logique métier** ni la signature publique des routes.

### 1. Extraire la session au niveau de la requête

Dans chaque route qui planifie une de ces tâches (`POST /matching/run`, soumission de CV, etc.),
récupère l'id de session RUM **depuis la requête entrante**, avec la même source que
`assistant-chat` (#118) : l'en-tête `tracestate` (format W3C `mip=s:<sessionId>`) ou le mécanisme
déjà utilisé par `mip_rum_middleware.py`. Factorise si possible dans un helper :

```python
# backend/mip_rum_ai.py (ou util existant)
def session_id_from_request(request) -> str | None:
    ts = request.headers.get("tracestate", "")
    for part in ts.split(","):
        part = part.strip()
        if part.startswith("mip=s:"):
            return part[len("mip=s:"):] or None
    return None
```

### 2. Passer la session à la tâche de fond

```python
sid = session_id_from_request(request)
background_tasks.add_task(run_matching, ao_id, session_id=sid)   # <-- ajoute session_id
```

Propage `session_id` le long de la chaîne jusqu'à l'appel IA : `run_matching(...) ->
extract_features(..., session_id=sid) -> record_ai_call(..., session_id=sid)`. Même chose pour
`auto_extract_skills` et `llm_score`. Quand la session est inconnue (tâche non déclenchée par une
requête utilisateur), passe `None` — le span est simplement émis sans session, comme aujourd'hui.

### 3. Poser la session sur le span

Dans le helper qui émet le span `gen_ai` (`record_ai_call` / équivalent), si `session_id` est fourni,
ajoute-le comme aujourd'hui pour `assistant-chat` : soit l'attribut `mip.session_id`, soit
`traceState: "mip=s:<session_id>"` dans le span. **Ne l'invente pas** : réutilise exactement le même
mécanisme que `assistant-chat`.

### 4. Contraintes

- **Aucune** nouvelle dépendance, **aucun** appel réseau supplémentaire, émission best-effort inchangée.
- Ne bloque jamais la tâche si la session est absente/malformée.
- Ne touche pas au format du span par ailleurs (provider/model/tokens/route restent identiques).

Rends un diff minimal, limité à la propagation de `session_id`.

---

## Vérification côté MIP RUM

Après déploiement, dans **Performance IA → Gouvernance des données**, la colonne **« Reliés session »**
doit passer de `—` à un pourcentage non nul pour les usages `matching/extract` et `matching/score`
(quand ils sont déclenchés depuis une session RUM active).
