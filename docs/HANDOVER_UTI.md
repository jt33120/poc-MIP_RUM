# Handover UTI — brancher la plateforme sur l'observabilité MIP RUM

> Objectif : la plateforme **UTI** affiche, dans son onglet **Administration**, un
> **miroir** de l'analyse MIP RUM — perfs IA, coût par utilisateur, solde OpenRouter,
> logs d'erreurs — en consommant l'**API MIP** (`/api/v1`). MIP reste la **source de
> vérité** et la maîtrise (ingestion, calculs, rétention, alertes) ; UTI ne fait
> qu'**afficher**. Aucune donnée n'est dupliquée côté UTI.

## 1. Principe

```
Front Admin UTI  ──►  Back UTI (garde le jeton)  ──►  MIP RUM /api/v1  ──►  Postgres
   affiche              proxy authentifié               cerveau + logique
```

Le **jeton reste côté serveur UTI** (jamais dans le navigateur). Le front UTI appelle
son propre back, qui relaie vers l'API MIP avec le jeton.

## 2. Mise en service (côté MIP, une fois)

Dans les variables d'environnement de la console MIP (Vercel) :

| Variable | Valeur |
|---|---|
| `CONSOLE_API_TOKENS` | ajouter un jeton **scopé à l'app UTI** : `openssl rand -hex 32` puis `<jeton>@gip-plateforme` |
| `CONSOLE_API_ALLOWED_ORIGINS` | ajouter l'origine du front UTI (ex. `https://app.uti.fr`) pour le CORS |

> ⚠️ **Le suffixe `@...` doit être l'`app_id` EXACT** tel qu'envoyé par le SDK RUM
> (`appId` dans `MIPRum.init(...)`) — pour la plateforme UTI c'est **`gip-plateforme`**,
> **pas** `uti`. Vérifiable à tout moment via `GET /api/v1/apps` (jeton non scopé). Un
> mauvais `app_id` de scope ne produit **aucune erreur** (le jeton est valide, la requête
> répond `200`) : il filtre juste sur une app qui n'a aucune donnée → **tout s'affiche à
> zéro** côté UTI sans qu'aucun log n'alerte. C'est la cause la plus fréquente d'un
> tableau de bord UTI vide alors que la console MIP montre des chiffres réels.
>
> Plusieurs jetons cohabitent (séparés par des virgules ; rotation sans coupure). Un
> jeton **sans** `@app` voit toutes les apps (réservé à MIP).

### Checklist si le tableau de bord UTI affiche des zéros

1. `GET /api/v1/apps` avec un jeton **non scopé** (ou depuis la console) → confirme que
   `gip-plateforme` a bien des sessions/appels IA sur la période demandée.
2. Vérifier la valeur réelle de `CONSOLE_API_TOKENS` sur Vercel (projet
   `mip-rum-console`) : le suffixe après `@` doit être `gip-plateforme`, à l'octet près
   (pas d'espace, pas de tiret différent).
3. Un changement de variable d'environnement Vercel **nécessite un redeploy** pour
   s'appliquer — vérifier que le déploiement courant postdate le changement.
4. Confirmer côté UTI que l'appel se fait **depuis leur back** (le jeton ne doit jamais
   apparaître dans le bundle JS envoyé au navigateur — sinon fuite du jeton en plus du
   bug d'affichage).
5. Tester en direct : `curl -H "Authorization: Bearer <jeton>" https://<console-mip>/api/v1/ai/costs?group_by=user` doit renvoyer des lignes non vides pour `gip-plateforme`.

## 3. Appels (côté back UTI)

Base : `https://<console-mip>/api/v1` · en-tête `Authorization: Bearer <jeton>` · réponse
`{ meta, data }`. Le paramètre `app` est **ignoré/forcé** à `uti` pour un jeton scopé.

```ts
const BASE = "https://<console-mip>/api/v1";
const TOKEN = process.env.MIP_RUM_TOKEN;           // côté serveur UNIQUEMENT

async function rum(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`RUM ${r.status}`);
  return (await r.json()).data;
}
```

## 4. Mapping « page Admin UTI » → endpoint

| Bloc voulu par Sullyvan | Endpoint | `data` |
|---|---|---|
| **Perfs IA** (coût, tokens, latence, taux d'erreur) | `GET /ai?period=7d&recent=50` | `overview`, `byModel`, `byRoute`, `daily`, `recent` |
| **Argent utilisé par utilisateur** (CV) | `GET /ai/costs?group_by=user` | `rows:[{user_hash, cost_usd, calls, …}]` + `unattributed` |
| **Solde OpenRouter + warning rouge < seuil** | `GET /ai/credits` | `{ status:"ok"\|"low", balance, threshold, currency, checked_at }` |
| **Journal d'erreurs backend** (échecs IA) | `GET /ai?recent=100` (appels `status:"error"`) **+** `GET /errors` | derniers appels en échec + groupes d'erreurs |
| Web-vitals / pages lentes / sessions / parcours | `GET /overview` `/pages` `/sessions` `/paths` | agrégats RUM |

Découverte complète : `GET /api/v1` (liste des endpoints) · spec machine : `GET /api/v1/openapi`.

### Exemple — warning solde bas
```ts
const c = await rum("/ai/credits");
if (c.status === "low") showRedBanner(`Solde OpenRouter : ${c.balance} ${c.currency}`);
```

## 5. Solde OpenRouter (côté MIP)

Le relevé est produit par un **cron** MIP (`/api/cron/openrouter-balance`). Pour l'activer,
côté env de la console MIP :

| Variable | Rôle |
|---|---|
| `OPENROUTER_API_KEY` | clé **lecture** du compte OpenRouter d'UTI (permet de lire le solde) |
| `CRON_SECRET` | secret du cron Vercel |
| `OPENROUTER_LOW_BALANCE` | seuil du warning (défaut `5`, unité = USD) |

> Sur un compte **Vercel Hobby**, le cron tourne **1×/jour** ; un compte **Pro** permet
> un relevé plus fréquent (changer `schedule` dans `apps/console/vercel.json`). Le solde
> peut aussi être rafraîchi via un appel externe à `/api/cron/openrouter-balance`
> (en-tête `Authorization: Bearer $CRON_SECRET`).

Quand le solde passe sous le seuil, MIP émet une alerte (`alert_event`) routée vers les
canaux configurés (**webhook/slack**). L'**e-mail** admin n'est pas encore livré (service
payant à décider — cf. `docs/ALERTING.md`).

## 6. Ce que MIP garde / ce qu'UTI fait

- **MIP** : ingestion, calculs, rétention, RGPD/DSAR, alertes, seuils — la maîtrise.
- **UTI** : affichage. Le front consomme l'API et stylise ses tableaux (API pure).
- **Confidentialité** : `user_hash` est anonymisé (aucune PII). Le jeton scopé garantit
  qu'UTI ne lit que son périmètre.

## 7. Références

`docs/API_CONSOLE.md` (contrat détaillé + variables d'env), `docs/DEPLOY_API.md`,
`docs/ALERTING.md`, `docs/CONFORMITE.md`.
