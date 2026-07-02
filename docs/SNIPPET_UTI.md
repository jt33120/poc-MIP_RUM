# Prompt à coller — session Claude sur `uti-platform` (mise à niveau RUM)

> **UN SEUL document à donner.** Copie tout le bloc **PROMPT** ci-dessous dans ta session
> Claude Code ouverte sur le repo **jt33120/uti-platform** (prod `https://plateforme.groupement-it.com`).
>
> Le snippet RUM est **déjà présent** (`frontend/index.html`, Vite/React) et les données
> remontent déjà — la démo fonctionne **sans rien faire**. Cette mise à niveau est **optionnelle** :
> ne la lance que si tu veux le **session-replay** dans la démo et/ou activer la **sécurité par
> clé API**. C'est **front-only** pour le snippet ; le backend ne reçoit qu'une variable d'env.

---

## PROMPT

Tu travailles sur le repo **uti-platform** (front Vite/React `frontend/`, backend FastAPI `backend/`,
prod `plateforme.groupement-it.com`). Un snippet RUM « MIP RUM » existe déjà dans
`frontend/index.html` (`<head>`, `MIPRum.init(...)`). Objectif : le **mettre à niveau** — ajouter la
clé API et le session-replay — et poser la même clé côté backend. **Ne touche ni à la logique
métier ni au middleware `backend/mip_rum_middleware.py`** (déjà propre).

### 1. FRONT — `frontend/index.html`

Dans l'appel `MIPRum.init({...})` existant, ajoute `apiKey` et `replay` (garde le reste) :

```js
MIPRum.init({
  endpoint: "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces",
  appId: "gip-plateforme",
  clientId: "groupement-it",
  apiKey: "mip_live_gip_59ca708ce596d20a52d58ea976dc512c516b442a",
  env: "prod",
  sampleRate: 1.0,
  replay: 0.1        // 10% des sessions en session-replay (rrweb, maskAllInputs actif)
});
```

Retire le commentaire « POC à retirer ». (Version propre optionnelle : sortir
`endpoint`/`appId`/`apiKey` en variables d'env Vite — soit via la syntaxe HTML `%VITE_MIP_API_KEY%`
dans `index.html`, soit en déplaçant l'init dans `src/main.jsx` avec `import.meta.env.VITE_MIP_*`
— `index.html` statique n'a PAS accès à `import.meta`. Ajoute alors un `.env` avec `VITE_MIP_*`.)

### 2. BACKEND — variable d'env (pas de code)

Sur le serveur OVH, dans `~/app/backend/.env` :

```
MIP_RUM_API_KEY=mip_live_gip_59ca708ce596d20a52d58ea976dc512c516b442a
```

puis `restart uti-backend`. (Le middleware l'enverra en `mip.api_key` ; **requis avant** que
l'équipe RUM active l'enforcement `REQUIRE_API_KEY`, sinon les spans backend passeraient en 403.)

### 3. Vérifie

- Build/lance le front. DevTools → **Network** → filtre `v1-traces` : en naviguant, des `POST`
  répondent **200**. `window.MIPRum` est défini.
- Pour le replay : après ~1–2 min de navigation, des `POST` partent aussi vers `.../v1/replay`.

### 4. Livrable

Ouvre une **PR draft** décrivant : fichier(s) modifié(s), et les beacons `v1-traces` 200 observés.
Ne modifie rien d'autre.

---

*Notes valeurs de prod : projet Supabase `nupxrdpsliqptqnjkmgw` · appId `gip-plateforme` ·
la clé `mip_live_gip_…` identifie l'app à l'ingestion (exposée côté navigateur = normal, ce n'est
pas un secret fort). L'enforcement `REQUIRE_API_KEY` s'active côté RUM une fois front + backend à jour.*
