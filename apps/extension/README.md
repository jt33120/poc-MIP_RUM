# MIP RUM — extension navigateur

2ᵉ capteur RUM du catalogue MIP : instrumente un site **sans toucher à son code**, en
injectant le SDK par domaine explicitement enregistré côté MIP.

## Ce que fait l'extension

Sur chaque navigation top-level, le service worker (`src/background.ts`) résout le
domaine visité via `GET /api/extension/resolve` (registre `extension_scope`, géré
côté console à `/admin/extension-scope`). Si le domaine est enregistré, la permission
déjà accordée, et que le site n'a pas déjà son propre SDK (`window.MIPRum`), le SDK RUM
(`vendor/mip-rum.js` — **le même bundle** que le script classique, copié depuis
`packages/rum-sdk/dist`) est injecté en `world: "MAIN"`, avec
`collectionSource: "extension"`.

**Le popup (`popup.html` / `src/popup.ts`)** est le SEUL endroit où l'extension passe
d'un domaine « reconnu » à « observé » : `chrome.permissions.request()` exige un geste
utilisateur (le clic sur l'icône). Le popup affiche toujours l'état courant, un bouton
« Activer sur ce domaine » ou « Retirer l'autorisation pour ce domaine », et une **note de
transparence** (ce qui est mesuré : Core Web Vitals + erreurs ; aucune frappe clavier, aucun
contenu de formulaire). La note dit aussi « anonyme » : c'est inexact, le SDK injecté émet
l'identifiant de visiteur `mip.visitor_id`, un pseudonyme tiré au hasard et gardé dans le
stockage local de la page (`IDENTIFIANTS_PSEUDONYMES`, `apps/console/lib/legal.ts`).

## Périmètre — ce que le mode extension couvre (et pas)

L'extension n'instrumente **que les navigateurs où elle est installée** : c'est l'outil
d'un **pilote** (poste géré, panel, équipe) ou d'un site dont on n'a pas le code — pas
une couverture 100 % des visiteurs. Pour du RUM exhaustif, c'est le **snippet** dans le
HTML du site (page « Installer » de la console). Les deux écrivent dans les mêmes tables ;
`collection_source` distingue `extension` de `sdk`.

## Build & synchro

```bash
pnpm --filter @mip/rum-sdk build   # d'abord : (re)génère le bundle SDK
pnpm --filter extension build      # vendor/{background,popup}.js + copie vendor/mip-rum.js
pnpm --filter extension gen:icons  # (re)génère icons/icon-{16,32,48,128}.png (déterministe)
pnpm --filter extension check:sync # garde : vendor == SDK buildé ET version == SDK (rejoué en CI)
```

La version du `manifest.json` **suit celle du SDK** (`check:sync` échoue sinon). Le
bundle `vendor/mip-rum.js` doit être identique au SDK fraîchement buildé — la CI le
vérifie pour empêcher d'expédier un SDK périmé.

## Validation navigateur réelle (smoke-test)

```bash
PW_CHROME=/chemin/vers/chrome xvfb-run -a pnpm --filter extension smoke
```

Charge l'extension dans un **vrai Chromium** (Playwright, headed) et vérifie : service
worker MV3 exécuté, manifest + icônes parsés, et le bundle expédié injecté en MAIN world
expose `window.MIPRum`, s'initialise **sans erreur** et **émet réellement de l'OTLP** vers
l'endpoint. Sans binaire Chromium complet : SKIP (c'est un outil local, pas une garde CI).
Le chemin permission/popup (geste utilisateur) reste couvert par les tests unitaires de
`decideInjection`.

## Charger en local (sideload)

1. `pnpm --filter extension build`
2. `chrome://extensions` (ou `edge://extensions`) → « mode développeur »
3. « Charger l'extension non empaquetée » → sélectionner `apps/extension/`
4. Épingler l'icône pour accéder au popup

Un `.zip` prêt à charger est aussi produit par `pnpm --filter extension pack`
(`apps/console/public/downloads/mip-rum-extension.zip`).

## Configurer l'endpoint (staging / test)

Défauts prod codés dans `src/background.ts`. Surchargeables sans rebuild via
`chrome.storage.local` : clés `mip_resolve_url` et `mip_default_endpoint` (utilisé par le
smoke-test et pour pointer une pré-prod).

## Inventaire de parc (Ext-D)

À l'installation et à chaque mise à jour, puis au fil des navigations au plus une fois
toutes les 6 h (tout de suite quand le poste alimente une nouvelle application ; 15 min
d'attente après un échec), le service worker déclare son installation à la console
(`POST /api/extension/heartbeat`, `lib/install.ts`) : un UUID tiré au hasard au premier
démarrage et gardé dans `chrome.storage.local` (clé `mip_install`), la version du manifest,
le libellé du poste s'il vient de la policy (voir plus bas), et les `app_id` pour lesquels le
SDK a réellement été injecté. **Jamais d'URL visitée.** L'inventaire se lit dans
`/admin/extension-installs`.

L'URL du battement est DÉRIVÉE de `mip_resolve_url` (`/resolve` → `/heartbeat`) : un
override de pré-prod emmène le battement avec lui, au lieu de déclarer les postes de
staging en production.

**Côté serveur, aujourd'hui** : les deux routes (`/api/extension/resolve` et
`/api/extension/heartbeat`) sont servies par la console, sur Vercel. Depuis C11, le
collector (`services/collector`) sait servir les mêmes sous `/v1/extension/*`, et depuis
C12 (06/10/2026) la console les lui relaie toujours (`apps/console/lib/ingest-relay.ts`), sans
plus lire ni écrire la base elle-même : collector injoignable, 503. L'extension n'a rien eu à
changer : elle vise la console, ou le collector quand la résolution le lui indique
(collecte directe).

Le libellé lisible d'un poste vient de `chrome.storage.managed` (clé `poste`, déclarée
dans `managed-schema.json`), donc de la policy d'entreprise du client — l'extension ne
le fabrique jamais. Sans policy, l'inventaire reste anonyme. La console génère le bloc
de policy à coller dans `/select/new?mode=extension`.

## Enregistrer un domaine à observer

Via `/admin/extension-scope` dans la console (admin), ou en SQL :

```sql
-- l'app doit exister dans app_registry (créez-la d'abord si besoin)
insert into extension_scope (domain, app_id) values ('www.exemple.fr', 'mon-app');
```

Désactiver = `update extension_scope set active=false where domain=...` : l'injection
cesse sous ~60 s (TTL du cache de résolution).

## Sans clé d'API : le domaine enregistré en tient lieu

Depuis le 29/09/2026, la collecte exige une clé (`REQUIRE_API_KEY: "true"` pour le
`collector`, `.railway/railway.ts`). L'extension n'en a pas et n'en aura pas : son bundle
est lisible par quiconque l'installe. Depuis le 30/09/2026 (décision du responsable du
produit), un lot **sans clé** est accepté si et seulement si tous ses spans portent
`mip.collection_source = "extension"` (ce que pose le SDK injecté avec
`collectionSource: "extension"`), si l'`Origin` de la page est un domaine **actif** du
registre pour cet `app_id`, et si l'application est active et non suspendue. Rien à
changer dans l'extension ni sur les postes déjà équipés : le contrôle est côté serveur
(`createPgAuth`, `packages/backend/lib/pg-ingest.mjs`), et la console transmet l'origine
de la page au collector sous la signature du relais (`x-mip-edge-origin`).

Conséquences pratiques :

- le domaine enregistré doit être le **nom d'hôte exact** de la page (`www.exemple.fr` et
  `exemple.fr` sont deux domaines) ; désactiver un domaine coupe aussi sa collecte, en
  60 s au plus (cache du registre, par instance) ;
- un domaine hors registre prend 403 `extension origin not registered for app: <app_id>` ;
- la limite de débit par application s'applique comme au snippet ;
- l'extension n'envoie ni rejeu ni logs : ils resteraient soumis à la clé.

Pourquoi ce n'est pas un affaiblissement : la clé d'un snippet se lit dans le code source
de toute page qui le porte ; un domaine enregistré, qu'un en-tête `Origin` forgé suffit à
usurper hors d'un navigateur, ne protège ni plus ni moins (`createPgAuth`).

## Publication (Chrome Web Store) — 🔑 compte externe requis

Le déploiement large passe soit par le **Chrome Web Store** (compte développeur payant,
non fourni), soit par **sideload/`.crx` + policy entreprise** (stratégies prêtes à
coller : page « Installer » de la console). L'extension est **prête à publier** (manifest
complet, icônes, packaging `pnpm pack:store`, visuels `store-assets/`) ; il ne manque que le
compte Store pour la première voie, la clé privée de signature (hors dépôt) pour empaqueter
un `.crx` dans la seconde. Tant que ce n'est pas fourni, on reste en sideload/policy — sans
faire croire à une publication.
