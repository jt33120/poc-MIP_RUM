---
review: rubric-walker
gate: Reviewer Gate — bmad-architecture
target: _bmad-output/planning-artifacts/architecture/architecture-poc-MIP_RUM-2026-08-25/ARCHITECTURE-SPINE.md
date: 2026-08-25
method: 'good-spine checklist (6 points), ancrée sur le code réel via graft + lecture ciblée'
---

# Revue rubric-walker — ARCHITECTURE-SPINE.md (MIP RUM)

## Verdict

**Le spine est bien construit dans sa forme — 14 AD au bon niveau, un paradigme qui tient, des
Prevents qui nomment des incidents réels — mais il ratifie un codebase qu'il décrit
inexactement sur trois points structurants (le cœur OTLP est classé code mort, la surface
d'AD-3 est sous-estimée d'un facteur 3, l'enveloppe de déploiement OEM/self-host n'est jamais
décidée), et deux de ses Rules ne portent aucun mécanisme applicable.** Il n'est pas prêt à
projeter des épics en l'état : F1, F2 et F3 doivent être corrigés avant le niveau features.

Synthèse par point de checklist :

| # | Point | Statut |
| --- | --- | --- |
| 1 | Fixe les vrais points de divergence pour features/épics | ⚠ **Partiel** — 3 divergences majeures non fixées (F5, F7, F13) |
| 2 | Chaque Rule est enforceable | ⚠ **Partiel** — AD-2 et AD-13 sont des intentions ; AD-3, AD-5, AD-8, AD-10 nomment un résultat sans point d'application (F2, F6, F9, F10, F11, F12) |
| 3 | Rien sous Deferred ne peut faire diverger deux unités | ❌ **Échec** — le mécanisme d'AD-2 et la frontière open-core sont tous deux divergents (F6, F8) |
| 4 | Technologies nommées vérifiées-courantes | ✅ **Passe**, sauf « PostgreSQL 15+ » qui masque un écart réel (F13) et le runtime de prod non nommé (F15) |
| 5 | Ratifie le brownfield au lieu de le contredire | ❌ **Échec** — F1 (critique), F2 (critique), F4 |
| 6 | Aucune dimension de l'altitude initiative laissée silencieuse | ❌ **Échec** — enveloppe opérationnelle : unité de déploiement, environnements, exécutant du heartbeat (F3, F11) |

---

## Findings

### F1 — Le cœur OTLP de production est décrit comme du code décommissionné, et la convention de frontières ordonne sa suppression

- **Checklist :** 5 (ratification du brownfield), 2 (Rule qui casserait la prod si appliquée)
- **Sévérité : CRITICAL**

**Ce qui cloche.** Le memlog pose que `apps/ingest/supabase/functions/` « n'est plus déployé […]
c'est du code mort encore présent au dépôt », et le spine hérite de ce cadrage : sa Consistency
Convention « Frontières » dit *« le code d'un adaptateur décommissionné est supprimé du dépôt,
pas laissé en place »*. C'est faux pour la moitié du dossier, et dangereux.

Vérification sur le code :

```jsonc
// /home/user/poc-MIP_RUM/apps/ingest/package.json
"exports": {
  "./lib/pg-ingest.mjs": "./lib/pg-ingest.mjs",
  "./dispatch-alerts.mjs": "./dispatch-alerts.mjs",
  "./shared/*": "./supabase/functions/_shared/*"    // <- alias de PRODUCTION
}
```

La console importe **9 fois** depuis cet alias en production (`ingest/shared/otlp.mjs` ×2,
`retry.mjs` ×3, `log.mjs` ×2, `limits.mjs` ×2, `cors.mjs` ×2). `_shared/otlp.mjs` contient
`flattenOtlp` (`apps/ingest/supabase/functions/_shared/otlp.mjs:208-705`, 18 appelants,
1er hotspot d'ingestion du dépôt) — c'est-à-dire exactement l'actif que le spine désigne comme
« l'actif de portabilité le plus fort du dépôt, et le fondement matériel d'AD-1 ».

Ce qui est réellement mort, ce sont les 4 handlers Deno : `v1-traces/`, `v1-logs/`,
`v1-replay/`, `uptime/`. Les 9 fichiers de `_shared/` sont vivants.

Conséquence en cascade : la table des couches place le Cœur dans `apps/ingest/lib/` — or ce
dossier ne contient **qu'un seul fichier**, `pg-ingest.mjs`, qui fait la persistance et
l'authenticité, pas le parsing. L'arborescence du Structural Seed la reprend
(`lib/ # CŒUR — parsing OTLP, authenticité, résolution tenant`) et **n'affiche nulle part**
`supabase/functions/_shared/`. Le fichier le plus structurant du dépôt est invisible dans le
seed structurel, sous un chemin que la convention marque pour suppression.

**Correction proposée.**
1. Corriger la table des couches : Cœur = `apps/ingest/supabase/functions/_shared/` (parsing,
   scrub, limites, CORS) + `apps/ingest/lib/pg-ingest.mjs` (authenticité, débit) ;
   Port sortant stockage = `apps/console/lib/db.ts` **et** `apps/ingest/lib/pg-ingest.mjs`.
2. Poser un AD ou une entrée de convention explicite : *« le cœur sort de
   `supabase/functions/_shared/` vers `apps/ingest/core/` ; l'alias `ingest/shared/*` est le
   contrat, le chemin physique ne doit plus nommer un fournisseur décommissionné »*. C'est un
   renommage à faible risque, gouverné et daté.
3. Restreindre la convention de suppression à une liste nommée
   (`v1-traces/`, `v1-logs/`, `v1-replay/`, `uptime/`), jamais au dossier parent.

---

### F2 — AD-3 sous-scope sa surface d'un facteur 3, et ignore entièrement la seconde voie d'écriture tenant

- **Checklist :** 5 (ratification), 1 (divergence non couverte), 2 (mécanisme non nommé)
- **Sévérité : CRITICAL**

**Ce qui cloche.** AD-3 (et AD-2, qui reprend le même chiffre) déclare :
*« Binds : les 49 appelants de `q()` dans `apps/console/lib/queries-*.ts` »*. Comptage réel
sur le dépôt :

| | Sites d'appel `q()` / `q<T>()` | Fichiers |
| --- | --- | --- |
| `apps/console/lib/queries-*.ts` | 112 | 25 |
| **Hors `queries-*.ts`** | **35** | **19** |
| **Total** | **147** | **44** |

Le « 49 » de graft est un nombre d'**arêtes de symboles** (49 fonctions appelantes), pas de
sites d'appel — et même cette liste contient déjà `apps/console/lib/cron.ts` et
`apps/console/lib/health.ts`, donc pas « tous dans `queries-*.ts` ».

Les 19 fichiers hors périmètre incluent des chemins tenant de plein droit :

- `apps/console/app/api/replay/[sessionId]/route.ts` (lecture de replay, 2 sites)
- `apps/console/app/admin/customers/actions.ts` (5 sites — dont
  `update app_registry set allowed_origins = $2 where app_id = $1` en ligne 87, une écriture
  tenant en `q()` brut, et c'est précisément la table dont dépend AD-5)
- `apps/console/app/admin/users/actions.ts`, `.../uptime/actions.ts`, `.../privacy/actions.ts`,
  `.../read-tokens/actions.ts`, `.../extension-scope/actions.ts`
- `apps/console/app/goals/actions.ts`, `.../select/new/actions.ts`,
  `.../errors/[fingerprint]/actions.ts`, `.../login/actions.ts`, `.../logout/actions.ts`
- `apps/console/app/api/cron/tick/route.ts`, `.../api/auth/oidc/callback/route.ts`
- `apps/console/lib/server-trace-core.ts`, `lib/cron.ts`, `lib/health.ts`
- deux pages serveur : `app/admin/audit/page.tsx`, `app/admin/users/page.tsx`

**Et une seconde voie d'écriture tenant est totalement absente des Binds** : l'ingestion
n'écrit pas par `q()` mais par `apps/ingest/lib/pg-ingest.mjs`
(`batchInsert`, `writeLogs`, `writeReplayChunk`), et `insertServerSpans`
(`apps/console/lib/server-trace-core.ts:164-177`) insère dans `rum_span` — qui porte `app_id`.
La Rule dit *« toute lecture ou écriture scopée tenant »*, les Binds ne couvrent que la lecture
console. Une épic dérivée de ce spine migrerait `queries-*.ts` et déclarerait AD-3 atteint avec
~24 % de la surface restée en accès brut.

Par ailleurs `withTenant()` (`apps/console/lib/db.ts:114`) existe déjà, a **zéro appelant**, et
son propre docblock note qu'il est « sans effet tant que la console se connecte avec un rôle
`BYPASSRLS` » — ce que DEPLOY.md:76 impose explicitement (`DATABASE_URL = neondb_owner`,
« ⚠ PAS console_ro »). La cible est donc atteignable, mais elle est plus large que ce que le
spine annonce.

**Correction proposée.**
1. Reformuler les Binds sans chiffre trompeur : *« tout site d'accès Postgres touchant une
   table porteuse d'`app_id`, côté console (147 sites, 44 fichiers, dont 19 hors
   `lib/queries-*.ts`) comme côté ingestion (`apps/ingest/lib/pg-ingest.mjs`,
   `insertServerSpans`) »*.
2. Nommer le mécanisme qui rend l'accès brut inaccessible, sinon « erreur de compilation »
   reste un vœu : `q()` cesse d'être exporté par `lib/db.ts` ; un module
   `lib/db/tenant.ts` exporte la seule voie scopée (typée `TenantScope`) ; les usages non-tenant
   légitimes (`audit_log`, `users`, sessions OIDC) passent par un `lib/db/global.ts` explicite ;
   une règle `no-restricted-imports` en CI interdit d'importer `q` hors de ces deux modules.
3. Ajouter à AD-11 le test qui prouve la propriété : un compteur CI qui échoue si un import de
   `q` apparaît hors de la liste blanche.

---

### F3 — L'enveloppe opérationnelle est illustrée mais jamais décidée : unité de déploiement OEM/self-host, et environnements

- **Checklist :** 6 (dimension silencieuse), 1
- **Sévérité : CRITICAL**

**Ce qui cloche.** Le Structural Seed contient un diagramme « Enveloppe de déploiement et
d'exploitation » — c'est une **description du statu quo**, pas une décision : aucun AD, aucune
entrée Deferred, aucune question ouverte ne tranche ce qu'on déploie, ni où, ni combien de fois.
Or le dépôt porte **trois topologies concurrentes, toutes vivantes** :

| Topologie | Preuve | Ce qui y tourne |
| --- | --- | --- |
| Vercel + Neon (prod) | `apps/console/vercel.json`, DEPLOY.md | ingestion **dans les routes Next** de la console |
| Docker self-host « souverain » | `infra/docker/docker-compose.yml`, testé à chaque PR par `.github/workflows/docker-smoke.yml` | ingestion par `apps/ingest/dev-server.mjs` + Postgres 15 — **sans la console** |
| Collector on-prem → ClickHouse | `infra/otel-collector.example.yaml` (« ce Collector REMPLACE la fonction serverless d'ingestion ») | ni la console ni `pg-ingest.mjs` |

Deux conséquences que le spine laisse ouvertes :
- **AD-14 bind « le déploiement self-host »** et l'argument produit est « vos données chez
  vous » — mais rien ne dit quelle est l'unité livrée à un OEM (image Docker ? paquets npm ?
  l'app Next entière ?), ni si la console fait partie du livrable. Deux épics peuvent partir
  dans deux directions incompatibles sans contredire une seule ligne du spine.
- **Deux implémentations d'ingestion divergent déjà** : les routes Next (prod) et
  `dev-server.mjs` (self-host, seul chemin couvert par `docker-smoke.yml`). Le spine appelle
  `dev-server.mjs` « port entrant local **et self-host** » — il ratifie donc la dualité sans
  aucune règle de parité, alors que AD-1/AD-5/AD-6 bindent « tous les ports entrants ».

**Environnements : silence complet.** Un grep sur `preview|staging|NODE_ENV|VERCEL_ENV` dans
`apps/console/vercel.json`, `.github/workflows/`, `apps/console/next.config.mjs` et `DEPLOY.md`
ne renvoie **rien**. Vercel crée par défaut un déploiement de preview par branche, qui hérite
des variables du projet — donc du `DATABASE_URL` de production, celui du rôle `neondb_owner`
qui contourne la RLS. Aucune ligne du spine ne l'interdit ni ne le déclare acceptable. Pour un
produit dont la promesse porteuse est l'isolation tenant, c'est la dimension la plus coûteuse
à laisser muette.

**Correction proposée.** Ajouter deux AD (ou un AD + un Deferred explicitement borné) :
1. **AD — Unité de déploiement.** Nommer le livrable OEM et son contenu ; poser que le port
   entrant de production et le port entrant self-host exécutent **le même** code d'ingestion
   (une implémentation, deux hôtes), et que `docker-smoke.yml` couvre celle-là. Décider le sort
   des trois topologies : laquelle est supportée, laquelle est un exemple gelé.
2. **AD — Environnements et provenance de la configuration.** Lister les environnements
   (local / preview / prod / self-host client), et poser la règle : *aucun environnement non
   productif ne reçoit une chaîne de connexion vers la base de production* — avec le mécanisme
   (branches Neon par preview, ou preview désactivée, ou variable scopée par environnement).

---

### F4 — AD-1 est contredit par un port entrant de production : `/api/ingest/v1/replay` n'est pas de l'OTLP

- **Checklist :** 5 (ratification), 2 (Rule contredite par le code sans exception nommée)
- **Sévérité : HIGH**

**Ce qui cloche.** AD-1 pose : *« aucune donnée n'entre dans le cœur autrement qu'en OTLP/HTTP
JSON standard. Un émetteur tiers (Collector OTel) doit pouvoir remplacer n'importe quel SDK
maison sans modification côté ingestion. »* Le spine range `apps/console/app/api/ingest/v1/*`
en bloc sous « Ports entrants ». Or l'un des trois est un contrat entièrement propriétaire :

```ts
// apps/console/app/api/ingest/v1/replay/route.ts:1-6
// POST /api/ingest/v1/replay — chunk rrweb (corps binaire gzip) -> replay_chunk.
// métadonnées en en-têtes x-mip-session / x-mip-app / x-mip-seq (+ x-mip-key),
// corps stocké COMPRESSÉ, gunzip de contrôle pour compter les events.
```

Corps = JSON rrweb gzippé, métadonnées en en-têtes `x-mip-*`, aucun `resourceSpans`. Aucun
Collector OTel standard ne peut produire ça. La promesse de réversibilité est donc vraie pour
les traces/logs/metrics et **fausse pour le session replay**, sans que le spine le dise — c'est
exactement la classe d'erreur qu'AD-12 est censé empêcher (« l'invalidation de la promesse
porteuse par un prospect technique »), reproduite dans le spine lui-même.

**Correction proposée.** Trancher explicitement dans AD-1, au choix :
- **carve-out nommé** : *« le replay de session est hors du contrat OTLP : c'est un port entrant
  distinct, à contrat propriétaire assumé, exclu de la promesse de substituabilité par
  Collector. Il est documenté comme tel dans le matériel OEM. »* — et alors AD-12 doit tester
  la conformité sur traces/logs/metrics uniquement, en le disant ;
- **ou** poser la cible : le replay est transporté en `OTLP logs` avec charge utile encodée en
  attribut `mip.replay.*`, et le port propriétaire est daté pour retrait.

Ne pas trancher laisse deux épics livrer deux réponses opposées à la question « un client peut-il
remplacer nos SDK par un Collector ? ».

---

### F5 — Il existe deux surfaces de lecture publiques concurrentes ; le spine parle de « l'API publique » au singulier sans trancher

- **Checklist :** 1 (point de divergence non fixé), 5
- **Sévérité : HIGH**

**Ce qui cloche.** AD-2 et la table des couches supposent un « contrat de lecture » unique. Le
code en expose deux, de conception incompatible :

| | `/api/v1/*` | `/api/rum/summary` |
| --- | --- | --- |
| Entrée | `apps/console/lib/api/handle.ts:39` | `apps/console/app/api/rum/summary/route.ts` |
| Auth | `authenticateApi(authorization, cookie de session)` — cookie **ou** bearer | bearer uniquement, résolu sur `read_tokens` |
| Portée tenant | `parseApiFilters(searchParams, principal)` — `filters.app ?? "all"` | forcée à `resolved.app_id`, `403` si l'app demandée diffère |
| Enveloppe | `{ meta, data }` + ETag + `Cache-Control` | corps nu |
| Débit | `CONSOLE_API_RATE_LIMIT` (défaut 120/min/principal) | `RUM_READ_RATE_LIMIT` (défaut 60/min/token) |
| Auto-description | — | *« API de LECTURE **propriétaire** (livrable UTI) »* |

Pour une vente OEM, c'est la question la plus déterminante du dossier : *avec quel identifiant
un SaaS tiers lit-il des données, et comment sa portée tenant est-elle dérivée ?* Le spine ne
tranche ni la surface, ni le modèle d'authentification, ni le versionnage du contrat (il existe
pourtant déjà `/api/v1/openapi` et `/api/v1/docs`). AD-5 ne couvre que l'authenticité **en
entrée** ; la lecture n'a aucun AD.

**Correction proposée.** Ajouter un AD « Contrat de lecture faisant autorité » :
- nommer la surface (`/api/v1/*`), et le sort de `/api/rum/summary` (migré derrière `handle`
  avec un principal de type `read_token`, ou gelé et daté) ;
- poser le modèle d'identité côté lecture : un principal OEM est **toujours** scopé à une app
  (interdire `app=all` hors principal console admin) — c'est aujourd'hui la seule différence de
  sécurité entre les deux surfaces, et elle est du mauvais côté ;
- poser la politique de compatibilité du contrat (le `v1` du chemin doit vouloir dire quelque
  chose : ce que casse une version majeure, et le préavis).

---

### F6 — Le mécanisme d'AD-2 est déféré, alors qu'il est la seule chose qui rendrait AD-2 vérifiable — et il fait diverger deux unités

- **Checklist :** 3 (Deferred divergent), 2 (Rule sans mécanisme)
- **Sévérité : HIGH**

**Ce qui cloche.** AD-2 dit : *« Le mécanisme (appel HTTP ou couche partagée en processus) est
Deferred ; l'équivalence des capacités ne l'est pas. »* Deux problèmes.

**a) C'est un Deferred divergent au sens strict.** Deux épics prenant chacune une branche
produisent une console à deux chemins de lecture — précisément le « chemin privilégié réservé à
la console » qu'AD-2 déclare sous Prevents. Le Deferred autorise donc la divergence que l'AD
interdit. De plus, le choix est déjà fait de facto par le code : `/api/v1/correlation` appelle
`correlationCards`/`blindSpots` de `queries-v2.ts`, les mêmes fonctions que les pages serveur —
la couche partagée en processus **existe**. Déférer une décision déjà prise revient à autoriser
son annulation silencieuse.

**b) L'équivalence n'est pas enforceable telle qu'écrite.** Constat sur le code : 26 modules
`queries*.ts` alimentent la console, contre 14 routes `/api/v1/*`. Sans équivalent public
aujourd'hui : `cohorts`, `funnel`, `goals`, `map`, `paths`, `frustration`, `form-analytics`,
`logs`, `svi`, `uptime`, `dashboards`, `usage`, `briefing`, `acquisition`, `experience`, `dsar`,
`extension-scope`, `sourcemap`, `summary`. Une Rule qui dit « toute requête que la console sait
exprimer, l'API sait l'exprimer » sans point d'application ne détectera jamais le 27ᵉ module.

**Correction proposée.**
1. Sortir le mécanisme du Deferred et ratifier l'état réel : *couche de lecture partagée en
   processus, `lib/queries-*.ts` ; une capacité n'existe que si elle y est exportée*.
2. Rendre l'équivalence mesurable : *« toute fonction exportée de `lib/queries-*.ts` consommée
   par une page de la console a une route `/api/v1/*` correspondante »*, avec un test CI
   (inventaire des exports vs inventaire des routes, liste d'exceptions explicite et datée).
   C'est ce test, pas la formulation, qui empêche l'API OEM d'être incomplète.

---

### F7 — AD-4 ignore une quatrième source d'endpoint et un second registre d'origines ; AD-5 casserait l'extension telle qu'elle est

- **Checklist :** 1, 2 (Rule dont les Binds manquent l'adaptateur concerné)
- **Sévérité : HIGH**

**Ce qui cloche.** AD-4 recense « trois sites, trois valeurs de repli ». Les trois sont
confirmés :

- `apps/console/app/select/new/page.tsx:229` → `https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces` (host décommissionné)
- `apps/console/app/layout.tsx:34` → même host décommissionné
- `apps/console/app/admin/customers/[appId]/page.tsx:43` → `http://localhost:4318/v1/traces`

Il en manque une **quatrième, en base et servie publiquement** : `extension_scope.endpoint`,
renvoyée par `GET /api/console/app/api/extension/resolve` (`apps/console/app/api/extension/resolve/route.ts`)
et consommée par le service worker MV3 via `ScopeEntry.endpoint`
(`apps/extension/lib/scope.ts:6-10`). AD-4 ne bind pas l'extension ; son Binds s'arrête à
l'onboarding, au layout, à l'écran admin, aux défauts SDK et à la doc.

**Et le conflit AD-5 × extension n'est pas vu.** L'extension injecte le SDK dans des pages
tierces : l'origine émettrice est le site du client. AD-5 rend l'allowlist d'origines par app
**obligatoire** et rejetante. Il y a donc deux registres d'origines sans règle de cohérence —
`app_registry.allowed_origins` (lu par `originsFromRegistry`, `_shared/cors.mjs:50-56`) et
`extension_scope` — et le jour où AD-5 est appliqué, toute injection par extension sur un
domaine absent d'`allowed_origins` est rejetée en 403. Aucune épic ne verra ça venir depuis
le spine.

**Correction proposée.**
1. Étendre les Binds d'AD-4 à `apps/extension` et à `extension_scope`, et préciser que la
   résolution unique vaut aussi pour la valeur **stockée en base** (le registre est une source
   de configuration, pas une exception à la source unique).
2. Ajouter à AD-5 une clause de cohérence : *« l'enregistrement d'un domaine dans
   `extension_scope` déclare de facto son origine dans l'allowlist de l'app ; les deux registres
   sont dérivés l'un de l'autre ou fusionnés »*.

---

### F8 — La frontière open-core est déférée avec la licence, alors qu'elle est architecturale et qu'elle fait diverger les modules

- **Checklist :** 3 (Deferred divergent)
- **Sévérité : HIGH**

**Ce qui cloche.** Le Deferred dit : *« Décision juridique et commerciale, pas architecturale »*.
La licence l'est ; la **frontière**, non. Elle détermine ce qui peut vivre dans quel paquet, et
deux épics peuvent la franchir en sens opposés sans jamais se contredire :

- `packages/rum-sdk` est **servi publiquement** (`apps/console/public/mip-rum.js`, injecté dans
  le HTML des clients) et embarque `rrweb@2.0.1` + `web-vitals@5.3.0` : c'est la surface la plus
  exposée du produit, et il est aujourd'hui `"private": true` sans licence.
- Vérifié : **aucun fichier `LICENSE` dans tout le dépôt** — le point est correctement noté par
  le spine, mais laissé sans conséquence architecturale.
- Une épic peut placer une heuristique différenciante (scoring de santé, détection d'anomalie)
  dans `packages/rum-sdk` « pour réduire la charge serveur » : elle est alors publiée en clair
  chez tous les clients, irréversiblement.

**Correction proposée.** Garder la licence en Deferred, et **remonter la frontière en AD**, dès
maintenant, formulée de manière enforceable : *« ce qui est expédié chez le client
(`packages/*`, `apps/extension`, `integrations/*`) ne contient aucune logique différenciante :
il collecte, encode en OTLP et émet, rien d'autre. Toute règle métier, tout barème et toute
heuristique vivent côté serveur. »* C'est architectural, testable (revue de diff sur `packages/`),
et ça rend la décision de licence ultérieure sans coût de reprise.

---

### F9 — AD-5 couche 1 : l'allowlist d'origines existe déjà… en en-têtes CORS, qui ne rejettent rien

- **Checklist :** 2 (Rule qu'une équipe croira appliquée alors qu'elle ne l'est pas)
- **Sévérité : MEDIUM-HIGH**

**Ce qui cloche.** AD-5 pose : *« Un POST depuis une origine non déclarée est rejeté même avec
une clé valide. »* Le dépôt a déjà `app_registry.allowed_origins`, mais il ne s'en sert que
pour **composer des en-têtes** :

```js
// apps/ingest/supabase/functions/_shared/cors.mjs:50-56
export function originsFromRegistry(registryValues) {
  for (const app of registryValues) {
    if (app?.active && Array.isArray(app.allowed_origins)) out.push(...app.allowed_origins);
  }
}
```
```ts
// apps/console/lib/ingest.ts — corsFor()
catch {
  // registre indisponible : on retombe sur le socle statique plutôt que de
  // refuser toute origine (même esprit fail-open que checkApiKey).
}
```

Un en-tête `Access-Control-Allow-Origin` est appliqué **par le navigateur**, jamais par le
serveur : il n'a aucun effet sur un `curl`, donc aucun sur le data-poisoning qu'AD-5 vise. Et le
chemin est fail-open en cas d'indisponibilité du registre, ce qu'AD-6 interdit — sans que le
registre d'origines figure dans les Binds d'AD-6 (qui listent authenticité d'ingestion,
limitation de débit, tâches planifiées).

Le risque concret : une équipe lira « allowlist d'origines », verra `allowed_origins` déjà
peuplé et le CORS déjà branché, et cochera AD-5 couche 1 sans écrire une seule ligne de rejet.

**Correction proposée.** Écrire la distinction dans la Rule d'AD-5 : *« les en-têtes CORS ne
sont pas un contrôle d'accès : la couche 1 est un rejet serveur, avant écriture, sur comparaison
de l'en-tête `Origin` à l'allowlist de l'app — un lot sans `Origin` déclarée est refusé quel que
soit le résultat du préflight »*. Et ajouter le chargement du registre d'origines aux Binds
d'AD-6 (registre indisponible → 503, pas socle statique).

---

### F10 — AD-8 est un dead-man switch auto-référentiel : l'alerte d'absence est évaluée par le cron dont on surveille l'absence

- **Checklist :** 2 (Rule non applicable telle quelle)
- **Sévérité : MEDIUM**

**Ce qui cloche.** AD-8 pose : *« chaque tâche planifiée écrit une trace horodatée de son
exécution. L'absence d'exécution est une alerte, pas un silence. »* La première moitié est
enforceable ; la seconde n'a pas d'exécutant désigné. Aujourd'hui l'évaluation des alertes est
elle-même une tâche planifiée : `check_alerts` / `check_slo_burn` sont déclenchées par
`/api/cron/tick`, appelée par `.github/workflows/cron.yml` — le workflow dont l'en-tête
documente lui-même que *« GitHub DÉSACTIVE les workflows planifiés d'un dépôt resté 60 jours
sans activité »*. Si le cron s'éteint, personne n'évalue l'alerte disant que le cron est éteint.

**Correction proposée.** Rendre le lien explicite dans la Rule : *« la détection d'absence est
portée par le témoin externe d'AD-9, jamais par un déclencheur de la plateforme : le témoin lit
la table des exécutions et alerte hors plateforme si l'horodatage le plus récent dépasse la
cadence déclarée »*. Cela transforme deux AD isolés en un mécanisme unique et vérifiable.

---

### F11 — AD-9 et AD-13 nomment une contrainte sans trancher l'exécutant ni le plan — et rien ne les défère

- **Checklist :** 6 (dimension d'exploitation silencieuse), 2
- **Sévérité : MEDIUM**

**Ce qui cloche.**
- **AD-9** exige un battement de cœur « hébergé hors de la plateforme applicative et hors de la
  base ». Le diagramme le nomme `EXT — hors plateforme` sans dire *quoi*. Le seul « hors
  plateforme » déjà en place est GitHub Actions — c'est-à-dire l'exécutant que le spine
  lui-même incrimine dans AD-13 (best-effort, pas de 5 min, désactivation à 60 jours). Une épic
  qui implémente AD-9 sur GitHub Actions reproduit le mode de défaillance d'août.
- **AD-13** dit *« aucune latence annoncée commercialement ne peut dépendre d'un plan
  d'hébergement qui ne la permet pas »*. C'est une interdiction adressée au discours commercial,
  pas un mécanisme : elle ne décide ni la cadence, ni le plan. Rien n'en découle pour une épic —
  or l'écart est chiffré et connu (`apps/console/vercel.json` ne contient qu'un cron quotidien
  `17 3 * * *`, parce que le plan Hobby refuse l'infra-journalier ; `cron.yml` documente la
  bascule vers Vercel Pro comme « la vraie réponse »).

**Correction proposée.** Une décision, pas deux règles :
- nommer l'exécutant du témoin d'AD-9 (service tiers de supervision, ou un runner distinct du
  dépôt applicatif) et interdire nommément le dépôt GitHub du produit comme hôte du témoin ;
- soit AD-13 tranche le plan (Vercel Pro, crons infra-journaliers, `cron.yml` supprimé), soit
  la décision descend en **Deferred borné** : *« plan d'hébergement — à trancher avant toute
  annonce de latence d'alerte inférieure à 24 h »*. Aujourd'hui, ni l'un ni l'autre.

---

### F12 — AD-10 s'appuie sur une version SDK figée en dur, déjà désynchronisée

- **Checklist :** 2 (Rule inapplicable en l'état), 5
- **Sévérité : MEDIUM**

**Ce qui cloche.** AD-10 pose : *« l'ingestion déclare quelles versions de SDK elle accepte et
pendant combien de temps »*. Ce que porte réellement le fil :

| Émetteur | Version sur le fil | Version du paquet |
| --- | --- | --- |
| `packages/rum-sdk/src/otlp-encode.ts:65` | `"0.4.0"` | **`0.4.3`** |
| `packages/agent-node/src/core.ts:190,292` | `"0.1.0"` | `0.1.0` |
| `packages/rum-mobile/src/core.ts:141` | `"0.1.0"` | `0.1.0` |

La valeur du SDK web est écrite en dur et a déjà décroché de trois correctifs. Une politique
d'acceptation de versions bâtie sur une constante figée n'accepte ni ne rejette rien de réel :
le parc déclarera éternellement `0.4.0`.

**Correction proposée.** Ajouter la clause manquante à AD-10 : *« la version portée par le
`scope` OTLP est dérivée de la version du paquet au build ; aucune version n'est écrite en dur
dans le code source »* — et, tant que le parc collé en snippet ne peut pas être mis à jour,
c'est le seul signal qui rend AD-10 opérant (il conditionne aussi la « césure datée » de la
seconde moitié de la Rule).

---

### F13 — « PostgreSQL 15+ » masque un écart de deux versions majeures entre la prod, la CI et le self-host

- **Checklist :** 4 (technologie nommée imprécise), 1 (divergence non fixée), 2 (AD-11 contredit)
- **Sévérité : MEDIUM-HIGH**

**Ce qui cloche.** La Stack annonce « PostgreSQL (Neon, `aws-eu-central-1`) — 15+ ». Réel :

| Cible | Version | Preuve |
| --- | --- | --- |
| Production (Neon) | **Postgres 17** | `docs/NEON_MIGRATION.md:17` — « Postgres 17, base `neondb` » |
| CI | **postgres:15** | `.github/workflows/ci.yml:61` |
| Self-host Docker | **postgres:15** (épinglé) | `infra/docker/docker-compose.yml` |

« 15+ » est vrai au sens littéral et faux au sens utile : les 51 migrations et toutes les
requêtes sont validées en CI sur PG15, exécutées en prod sur PG17. C'est exactement le mode
d'échec qu'AD-11 déclare interdire (*« un test qui choisit lui-même sa configuration ne prouve
rien sur la production »*) — et le spine ne le voit pas parce que sa propre table de stack
l'efface.

**Correction proposée.** Nommer les deux versions dans la Stack (prod PG17 / self-host+CI PG15)
et poser la règle du plus petit dénominateur : *« le SQL du dépôt ne dépend d'aucune
fonctionnalité indisponible sur la plus ancienne version supportée ; la CI s'exécute sur la
version de production ou l'écart est déclaré »*. Et étendre les Binds d'AD-11 à la version de
base de données, pas seulement au rôle de connexion.

---

### F14 — L'inventaire des adaptateurs émetteurs est incomplet

- **Checklist :** 5, 1
- **Sévérité : LOW-MEDIUM**

**Ce qui cloche.** La table des couches liste 4 émetteurs (`rum-sdk`, `agent-node`,
`rum-mobile`, Collector tiers). Le dépôt en porte deux de plus, tous deux hors Binds d'AD-1 et
d'AD-10 :

- `integrations/fastapi/mip_rum_middleware.py` — middleware Python émettant de l'OTLP, avec
  ses propres tests (`test_mip_rum_middleware.py`) ; absent de la table **et** de l'arborescence
  du Structural Seed.
- `apps/extension` — présent dans l'arborescence comme « adaptateur d'injection MV3 », mais
  absent de la ligne « Adaptateurs émetteurs » : il injecte le SDK, donc il émet, donc AD-1,
  AD-4 (cf. F7) et AD-10 le bindent.

**Correction proposée.** Compléter la ligne « Adaptateurs émetteurs » et l'arborescence, et
étendre les Binds d'AD-1/AD-10 (« tout émetteur du dépôt, maison ou d'intégration, y compris
`integrations/*` »). Sinon un correctif de sémantique de mesure sera déployé sur trois paquets
sur cinq.

---

### F15 — La Stack ne nomme pas le runtime de production

- **Checklist :** 4
- **Sévérité : LOW**

**Ce qui cloche.** La table donne « Node.js (CI) — 26 », exact (`.github/workflows/ci.yml:31,79`)
mais volontairement restreint à la CI ; le runtime d'exécution des routes n'est nommé nulle
part, alors que les trois routes d'ingestion déclarent `export const runtime = "nodejs"` et
tournent sur la version choisie par Vercel, pas par le dépôt. Node 26 est la ligne *Current*
(LTS seulement en octobre 2026) : faire porter la CI par une ligne non-LTS sans épingler la
version de prod, c'est se rendre aveugle au delta.

Le reste de la table est vérifié conforme : pnpm `9.15.9` (`package.json`), Next `15.5.19`,
React `19.2.7` (`apps/console/package.json`), Vitest `4.1.8`, Playwright `1.60.0`
(`package.json` racine). Manquent, avec un caractère structurant : TypeScript `5.9.3`, pilote
`pg` `8.21.0` (identique côté console et ingestion — c'est ce qui permet le pool unique),
Tailwind `3.4.19`, `rrweb` `2.0.1` (partagé SDK/lecteur, cf. F4).

**Correction proposée.** Ajouter une ligne « Node.js (runtime de production, routes `nodejs`) »
avec la version épinglée, et les trois ou quatre versions structurantes ci-dessus.

---

### F16 — Le Deferred ClickHouse ne dit rien de l'actif ClickHouse déjà présent

- **Checklist :** 3, 5
- **Sévérité : LOW**

**Ce qui cloche.** Le Deferred pose que « AD-1 et le port sortant gardent la porte ouverte » et
que le palier n'est pas atteint. Mais le dépôt contient déjà `infra/clickhouse/`,
`infra/clickhouse.notes.md` et un `infra/otel-collector.example.yaml` qui décrit une topologie
de production complète `Collector on-prem → ClickHouse on-prem`. La convention « Frontières »
du spine dit de supprimer le code décommissionné — ces fichiers ne sont ni vivants ni
décommissionnés, et rien ne dit ce qu'on en fait.

**Correction proposée.** Une ligne dans le Deferred : *« l'actif existant (`infra/clickhouse/`,
`infra/otel-collector.example.yaml`) est gelé et marqué comme exemple non supporté jusqu'à ce
que le palier soit atteint »* — sinon il continuera d'être lu comme un chemin de déploiement
officiel (cf. F3).

---

## Ce que le spine fait bien (à conserver tel quel)

- **AD-7** est l'AD le plus enforceable du document : *« un changement d'hébergeur casse le
  build tant que la déclaration légale n'est pas mise à jour »* nomme un mécanisme réel et
  vérifiable, et le défaut qu'il corrige est confirmé mot pour mot
  (`apps/console/lib/legal.ts:24-36` déclare toujours Supabase / AWS `eu-west-3` Paris, commenté
  « factuel », et liste Supabase en sous-traitant art. 28, servis sur `/legal/*`).
- **AD-6** inverse un défaut réel et documenté dans le code
  (`apps/ingest/lib/pg-ingest.mjs:265` — `"api key check fail-open (registry never loaded)"`),
  et la clause « toute exception est un mode POC nommé, jamais le défaut » est directement
  applicable à `REQUIRE_API_KEY` (aujourd'hui `false` par défaut).
- **AD-11** est exact jusqu'au détail : `scripts/verify-tenant-isolation.mjs` crée lui-même
  `console_ro` (ligne 37), lui accorde ses droits (38-40) et fait `set role console_ro`
  (ligne 88) sur une base `mip_rum_rls` créée pour l'occasion — pendant que la prod se connecte
  en `neondb_owner` (DEPLOY.md:76). Le faux vert est réel et bien nommé.
- Le paradigme hexagonal est le bon cadrage pour un livrable OEM, et la lecture de
  `flattenOtlp` comme actif de portabilité est juste — c'est bien du JS pur sans dépendance de
  runtime.
- La question ouverte sur la capacité en cloud est correctement classée (bloquante pour la
  promesse chiffrée, non bloquante pour le build).

---

## Ordre de correction suggéré

1. **F1, F2, F3** — avant toute projection en épics : le spine décrit mal le cœur, sous-estime
   la surface d'AD-3, et ne décide pas l'enveloppe de déploiement.
2. **F4, F5, F6, F7, F8** — avant le premier matériel OEM : ce sont les cinq points sur lesquels
   un acheteur technique ou un juriste bloquera.
3. **F9 à F13** — pendant le durcissement des AD concernés.
4. **F14 à F16** — passe de cohérence documentaire.
