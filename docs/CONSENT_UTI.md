# Prompt — consentement RGPD (à utiliser UNIQUEMENT quand le replay sera activé)

> ⚠️ **Pas nécessaire aujourd'hui.** Le déploiement actuel a **retiré le replay** : la collecte
> RUM est **anonyme, exemptée de consentement** (pas d'IP, pseudonyme, usage interne) → **aucune
> bannière requise** (voir `docs/ROADMAP_REPLAY.md`). Il suffit d'une phrase « mesure d'audience
> anonyme » dans la politique de confidentialité, `replay:0` dans le snippet.
>
> **Ce document ne sert QUE le jour où on (ré)active le session replay** — car le replay, lui,
> impose un consentement explicite. Dans ce cas, copie le bloc **PROMPT** ci-dessous dans la
> session Claude d'`uti-platform`.

## Comment fonctionne le consent du SDK MIP RUM (à respecter)

- `MIPRum.init({ ..., requireConsent: true })` → **rien n'est envoyé** : tous les événements
  (vitals, erreurs, pageviews, **replay**) sont bufferisés en mémoire (cap 200, FIFO). Aucune
  requête réseau tant que le consentement n'est pas donné.
- `MIPRum.consent(true)` → rejoue le buffer **et démarre le replay**.
- `MIPRum.consent(false)` → **purge** le buffer et désactive (plus rien n'est collecté).
- ⚠️ **Le SDK ne mémorise PAS le choix** (état en mémoire, par chargement de page). C'est au
  **site** de stocker le choix et de le **réappliquer à chaque chargement**.

## PROMPT

Tu travailles sur **uti-platform** (front Vite/React `frontend/`). Rends le RUM conforme RGPD :
consentement explicite avant toute collecte, cohérent avec la bannière. **Ne touche pas au
backend ni au middleware.** Ouvre une **PR draft** dédiée.

### 1. `frontend/index.html` — activer le mode consentement

Ajoute `requireConsent: true` à l'`init` (garde `apiKey`, `replay: 0.1`, etc.) :

```js
MIPRum.init({
  endpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
  appId: "gip-plateforme",
  clientId: "groupement-it",
  apiKey: "mip_live_gip_59ca708ce596d20a52d58ea976dc512c516b442a",
  env: "prod",
  sampleRate: 1.0,
  replay: 0.1,
  requireConsent: true        // ← rien n'est collecté avant MIPRum.consent(true)
});
```

### 2. Réappliquer le choix stocké à chaque chargement + piloter le SDK

Dans le code d'amorçage (ex. `src/main.jsx` ou un petit module `src/rum-consent.js` importé tôt) :

```js
const KEY = "mip-consent"; // "granted" | "denied" | absent (= pas encore choisi)
const choice = localStorage.getItem(KEY);
if (choice === "granted") window.MIPRum?.consent(true);
else if (choice === "denied") window.MIPRum?.consent(false);
// si absent : ne rien appeler → le SDK bufferise jusqu'au choix via la bannière

export function setRumConsent(granted) {
  localStorage.setItem(KEY, granted ? "granted" : "denied");
  window.MIPRum?.consent(granted);
}
```

### 3. Bannière cookies — corriger le texte + brancher Accepter/Refuser

- Remplace le message « aucun traçage » par une description **exacte** de ce qui est collecté
  (voir copie proposée ci-dessous).
- Bouton **Accepter** → `setRumConsent(true)` ; bouton **Refuser** → `setRumConsent(false)`.
- Masque la bannière une fois le choix fait ; ne la ré-affiche que si `localStorage[KEY]` est absent.
- Ajoute un moyen de **revenir sur le choix** (lien « Cookies / confidentialité » en pied de page
  qui efface `localStorage[KEY]` et ré-affiche la bannière).

**Copie FR proposée pour la bannière :**
> Nous mesurons les performances et la fiabilité de la plateforme (temps de chargement, erreurs,
> parcours anonymisé). Un échantillon de sessions peut être **rejoué** pour diagnostic, avec les
> **champs de saisie masqués**. Aucune adresse IP n'est conservée ; l'identifiant est une
> **empreinte anonyme**. Vous pouvez **accepter** ou **refuser** ; choix modifiable à tout moment.
> [Refuser] [Accepter]

### 4. Vérifie (critères de conformité)

- **Avant tout choix** : DevTools → Network → **aucun** `POST` vers `v1-traces` ni `v1-replay`.
- **Après « Accepter »** : les `POST v1-traces` partent (200) ; après ~1-2 min, `v1-replay` aussi.
- **Après « Refuser »** : toujours **aucune** requête, même en rechargeant (choix persistant).
- Le texte de la bannière décrit fidèlement la mesure + le replay masqué + l'empreinte anonyme.

### 5. Livrable

PR draft « RGPD : consentement RUM » : `index.html` (requireConsent), le module de consentement,
la bannière corrigée + le lien de révocation. Décris les 3 états testés (avant/accepté/refusé).

---

*Côté MIP RUM (rien à faire ici) : replay déjà masqué (`maskAllInputs`), pas d'IP stockée,
empreinte anonyme, rétention 30 j, effacement sur demande (`erase_session` / `erase_app_data`).
Réf. conformité : `docs/CONFORMITE.md`, `docs/DPA.md`.*
