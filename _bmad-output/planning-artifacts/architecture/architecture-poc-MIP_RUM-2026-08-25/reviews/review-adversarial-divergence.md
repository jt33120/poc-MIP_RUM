---
name: 'Revue adversariale — divergence de construction'
type: architecture-review
lens: 'adversarial-divergence (altitude initiative)'
target: 'ARCHITECTURE-SPINE.md — MIP RUM v0.4'
reviewer: 'Reviewer Gate — bmad-architecture'
date: '2026-08-25'
verdict: 'CHANGES REQUESTED — 9 trous, dont 4 déjà matérialisés dans le code livré'
---

# Revue adversariale — divergence de construction

## Méthode

La lentille n'évalue pas si les 14 AD sont *bons*. Elle suppose qu'ils sont tous
respectés à la lettre, et cherche les paires de features — le niveau juste en dessous
du spine — qui peuvent chacune obéir intégralement et **se construire quand même de
façon incompatible**. Chaque paire trouvée est un trou : le spine autorise deux
réalités qui ne peuvent pas coexister.

Neuf trous. Quatre d'entre eux ne sont pas hypothétiques : le code du dépôt **contient
déjà les deux moitiés divergentes**, ce qui est la démonstration la plus forte qu'un AD
ne les interdit pas.

Convention de gravité :

| Niveau | Sens |
| --- | --- |
| **Bloquant** | La divergence casse une propriété vendue (isolation, RGPD, réversibilité). |
| **Majeur** | La divergence produit une reprise coûteuse ou une preuve inconstruisible. |
| **Notable** | La divergence est réelle mais rattrapable tard sans reprise structurelle. |

---

## T1 — Bloquant · Quatre registres d'identité tenant concurrents, aucun ne fait autorité

### Les deux unités

- **Unité A — « voie d'accès tenant » (ingestion).** Elle construit l'identité tenant
  sur la table `app_registry` : `app_id`, `api_key_hash`, `active`, `allowed_origins`,
  `monthly_quota`, `retention_days`. Tout ce qui entre est jugé contre cette ligne.
- **Unité B — « jeton de lecture OEM / partenaire ».** Elle construit l'identité tenant
  sur une variable d'environnement, `CONSOLE_API_TOKENS`, au format
  `token@app1;app2` (`apps/console/lib/api/auth.ts`, `parseTokenConfig`). Un
  partenaire reçoit un jeton porteur de son propre périmètre d'apps.

### Comment chacune respecte tous les AD

A respecte AD-1 (OTLP seul contrat), AD-3 (portée tenant scopée), AD-5 (la clé
identifie, l'allowlist authentifie), AD-6 (fail-closed quand le registre est chargé).
B respecte AD-2 (elle est *dans* l'API publique, donc pas de chemin privilégié), AD-3
(elle scope ses lectures par `app`), AD-11 (elle est testée). Aucun AD ne dit **qui
possède la notion de tenant**, ni qu'il n'en existe qu'un registre.

### Où elles deviennent incompatibles

Le dépôt porte aujourd'hui **quatre** définitions indépendantes de « ce tenant existe
et voici son périmètre », et aucune ne se valide contre les autres :

| Porteur | Emplacement | Ce qu'il définit |
| --- | --- | --- |
| `app_registry` | table SQL, lue par `createPgAuth.getAppRegistry` (`apps/ingest/lib/pg-ingest.mjs:L245-258`) | existence, clé, origines, quota, rétention |
| `CONSOLE_API_TOKENS` | env, `parseTokenConfig` (`apps/console/lib/api/auth.ts`) | périmètre de lecture machine |
| claim `apps` du JWT | `verifyJwt` / `SessionUser` (`apps/console/lib/auth.ts`) | périmètre de lecture humain |
| `extension_scope.domain → app_id` | `apps/console/lib/queries-extension-scope.ts` | rattachement d'un domaine à une app |

Rien ne vérifie qu'un `app_id` cité dans `CONSOLE_API_TOKENS` ou dans un JWT existe dans
`app_registry`, ni qu'il est `active`. Conséquences directes et opposées :

- Désactiver un client (`app_registry.active = false`) **coupe son ingestion** mais
  **ne coupe pas** son jeton de lecture : le partenaire continue de lire.
- Une faute de frappe dans `CONSOLE_API_TOKENS` (`tok@app-clientA` au lieu de
  `app-clienta`) ne produit aucune erreur : elle produit un jeton au périmètre
  silencieusement vide, ou pire — voir T2 — au périmètre *total*.
- L'unité A pense « un tenant = une ligne de registre » ; l'unité B pense « un tenant =
  une chaîne dans une variable d'environnement ». La première est révocable en base et
  auditée ; la seconde exige un redéploiement et n'a pas d'historique.

C'est le cas d'école demandé par la lentille : **une clé d'API par app, une origine par
app, un quota par app, un jeton de lecture par app — quatre entités, pas une.**

### AD qui referme le trou

> ### AD-15 — `app_registry` est le registre d'identité tenant faisant autorité
>
> - **Binds :** l'ingestion, l'API de lecture, l'authentification console, l'extension,
>   le metering, la facturation.
> - **Prevents :** un tenant révoqué d'un côté et vivant de l'autre — l'écart entre « le
>   client est parti » et « le client lit encore ».
> - **Rule :** un `app_id` n'existe que s'il a une ligne dans `app_registry`. Toute
>   feature qui accorde un droit à un tenant — clé d'ingestion, origine, quota,
>   rétention, jeton de lecture, session humaine, rattachement de domaine — **résout ce
>   droit contre cette ligne au moment de l'usage**, et refuse si la ligne est absente ou
>   inactive. Un périmètre tenant porté par une variable d'environnement, un fichier de
>   configuration ou un claim de jeton est une *référence* à cette ligne, jamais une
>   source. Désactiver une app coupe, dans le même geste, toutes ses voies d'entrée
>   **et** toutes ses voies de lecture.

---

## T2 — Bloquant · AD-3 ne dit rien du cross-tenant, et deux échappatoires existent déjà

### Les deux unités

- **Unité A — « metering et vue d'usage globale ».** Elle doit agréger la consommation
  de **tous** les tenants (`apps/console/app/admin/usage/page.tsx`,
  `meter_tenant_usage()`). Par nature, elle est cross-tenant.
- **Unité B — « jeton partenaire agrégateur ».** Un intégrateur OEM veut une vue
  consolidée de son parc, donc un jeton multi-apps.

### Comment chacune respecte tous les AD

AD-3 impose « toute lecture ou écriture **scopée tenant** passe par une fonction unique
qui pose la GUC ». Ni A ni B n'est *scopée tenant* : ce sont des requêtes délibérément
transverses. Elles sortent donc du champ littéral de l'AD sans le violer. AD-2 est
respecté (la capacité existe des deux côtés). AD-11 aussi.

### Où elles deviennent incompatibles

Le spine ne définit pas la voie cross-tenant, alors le code en a inventé **deux**, de
sémantiques différentes :

1. **Élargissement par la portée** — `withTenant` (`apps/console/lib/db.ts:L114-135`)
   accepte `string | string[]` et concatène les `app_id` par virgule dans la GUC ; côté
   SQL, `current_app_ids()` (`apps/ingest/sql/migration-v47.sql:L90-103`) les redécoupe
   et la policy filtre en `app_id = any(...)`. Passer la liste complète des apps donne
   une portée globale **tout en respectant AD-3 à la lettre** : la fonction unique a bien
   été appelée, la GUC a bien été posée.
2. **Élargissement par l'absence de portée** — `scopeApp`
   (`apps/console/lib/api/params.ts:L19`) :

   ```ts
   function scopeApp(p: ApiPrincipal, requested: string | null): string | null {
     if (p.role === "admin" || !p.apps?.length) return requested;
     return requested && p.apps.includes(requested) ? requested : p.apps[0];
   }
   ```

   `!p.apps?.length` — donc **`apps: null` vaut « toutes les apps »**. Un jeton
   `CONSOLE_API_TOKENS` sans suffixe `@app` obtient `apps: null`, `role: "viewer"`, et
   lit l'intégralité du parc. `handle.ts` l'assume et l'expose : `meta.app = filters.app ?? "all"`.

Les deux mécanismes sont incompatibles dans leur *défaut* : le premier échoue fermé
(`withTenant` jette sur portée vide — « une portée vide rendrait toute la session
aveugle »), le second échoue **ouvert** (portée vide = tout voir). Deux features
construites séparément, chacune conforme à AD-3, produisent donc la règle inverse pour
le même cas limite. La bascule RLS annoncée par AD-3 (« rôle de connexion restreint une
fois l'adoption à 100 % ») transformera l'un en écran vide et laissera l'autre intact.

### AD qui referme le trou

> ### AD-3 (resserré) — dernier paragraphe ajouté
>
> Une portée tenant **absente ou vide n'est jamais une portée universelle** : elle
> refuse. Le cross-tenant n'est pas l'absence de portée, c'est une portée explicitement
> plurielle.

> ### AD-16 — Le cross-tenant est une capacité nommée, jamais un effet de bord
>
> - **Binds :** metering, facturation, écrans d'administration, jetons partenaires,
>   agrégations globales, supervision.
> - **Prevents :** deux features inventant deux échappatoires de sémantiques opposées à
>   la voie tenant, dont l'une échoue ouverte.
> - **Rule :** une requête transverse déclare son périmètre de façon positive et
>   énumérée — jamais par omission, jamais par `null`, jamais par un rôle. Elle emprunte
>   la même voie unique qu'une requête tenant, avec une portée plurielle explicite. Le
>   droit d'émettre une requête transverse est une capacité distincte du droit de lire un
>   tenant : la posséder pour un tenant ne la donne jamais pour tous. Toute réponse
>   produite par une requête transverse porte, dans ses métadonnées, le périmètre
>   réellement appliqué.

---

## T3 — Bloquant · La « voie d'accès unique » d'AD-3 est du code mort ; deux voies brutes sont exportées

### Les deux unités

- **Unité A — « restauration testée » / self-host** ou toute feature d'écriture
  d'ingestion : elle a besoin d'un accès transactionnel direct au pool.
- **Unité B — « voie d'accès tenant »** : elle a besoin que cet accès soit impossible.

### Comment chacune respecte tous les AD

AD-3 dit que « l'accès brut est **inaccessible** pour une requête tenant — l'oubli est
une erreur de compilation ». A n'écrit pas de requête *tenant* : elle écrit de
l'ingestion, dont l'`app_id` vient du payload et non d'une session. Elle se croit donc
hors champ. B applique l'AD.

### Où elles deviennent incompatibles

Le graphe est sans appel : **`withTenant` n'a aucun appelant indexé**, tandis que `q`
(`apps/console/lib/db.ts:L82-95`) en a **49** — c'est le hub numéro un du dépôt. La voie
unique existe, est correctement écrite (transaction + `set_local`), et n'est **jamais
empruntée**. Pire, `db.ts` exporte trois portes de largeur croissante :

| Export | Pose la GUC ? | Appelants |
| --- | --- | --- |
| `withTenant` | oui (`set_config(..., true)`, transaction-locale) | 0 |
| `q` | non | 49 |
| `pool` | non | importé directement par `apps/console/lib/ingest.ts`, `app/api/ingest/v1/traces/route.ts`, `app/api/ingest/v1/replay/route.ts`, `app/api/cron/tick/route.ts` |

Rien dans le langage n'empêche une nouvelle feature d'importer `pool`. AD-3 promet une
erreur de compilation ; le dépôt offre un export public. Deux features construites en
parallèle — l'une disciplinée, l'autre pressée — obéissent toutes deux à un AD dont la
condition matérielle (« inaccessible ») n'est réalisée nulle part.

Divergence supplémentaire, plus insidieuse, sur la **portée** de la GUC :
`withTenant` utilise `set_config(..., true)` — transaction-locale, avec un commentaire
qui explique correctement pourquoi c'est une exigence de correction sur un pool
partagé. Le test d'isolation `scripts/verify-tenant-isolation.mjs` utilise
`set_config(..., false)` — **session-globale** (lignes 89, 106, 114). Les deux « posent
la GUC » et respectent AD-3 ; ils prouvent et exécutent des propriétés différentes. C'est
aussi une seconde instance d'AD-11 : le test ne s'exécute pas dans la configuration
expédiée.

### AD qui referme le trou

> ### AD-3 (resserré) — remplacement du paragraphe « Rule »
>
> - **Rule :** toute lecture ou écriture portant un `app_id` — de session **comme de
>   payload** — passe par une fonction unique qui pose la portée tenant dans sa
>   transaction, avec une portée transaction-locale et jamais de session. Le pool et tout
>   exécuteur de requête non scopé ne sont pas exportés hors du module de stockage : une
>   feature qui veut contourner la voie doit modifier le port sortant, ce qui se voit en
>   revue. Une voie unique sans appelant n'est pas une voie unique — le taux d'adoption
>   est mesuré en continu et publié ; la bascule RLS est conditionnée à 100 %, mesurés,
>   pas déclarés. Tout test d'isolation s'exécute avec le rôle de connexion **et** la
>   portée de GUC de la production.

---

## T4 — Bloquant · AD-5 ne fixe ni l'ordre de ses quatre couches ni la forme de la première

### Les deux unités

- **Unité A — « allowlist d'origines par app »** (couche 1 d'AD-5).
- **Unité B — « voie d'ingestion replay »** (second port entrant, corps binaire,
  métadonnées en en-têtes).

### Comment chacune respecte tous les AD

A implémente exactement la couche 1. B implémente AD-1 (OTLP/HTTP), AD-4 (endpoint
dérivé de `/v1/traces` → `/v1/replay`), AD-5 (« parité d'auth avec la route traces »,
dit son propre en-tête), AD-6. Toutes deux sont conformes.

### Où elles deviennent incompatibles

**(a) Trois formes d'allowlist, aucune n'étant un contrôle serveur.**

| Mécanisme | Emplacement | Sémantique |
| --- | --- | --- |
| Union globale + socle statique | `apps/ingest/supabase/functions/_shared/cors.mjs:L50-56` (`originsFromRegistry`) + `L11` (`STATIC_ALLOWED_ORIGINS`) | **toutes** les origines de **toutes** les apps actives, fusionnées |
| Copie inline | `apps/ingest/supabase/functions/v1-replay/index.ts:L35-42` | ré-implémente la même union, à la main |
| Liste d'environnement | `apps/console/lib/api/cors.ts` (`CONSOLE_API_ALLOWED_ORIGINS`) | déconnectée d'`app_registry`, **supporte `"*"`** |

`originsFromRegistry` aplatit le registre : l'origine du client A autorise un POST qui se
déclare `mip.app_id = "B"`. AD-5 dit « allowlist d'origines **par app** » ; le code livre
une allowlist **par déploiement**. La couche 1 d'AD-5 est donc, telle qu'implémentée,
sans effet d'isolation.

Plus grave : sur les routes d'ingestion, l'origine **n'est jamais un motif de refus**.
`corsFor` ne produit que des *en-têtes* ; `POST` de `traces/route.ts` et de
`replay/route.ts` poursuit quelle que soit l'origine. Le contrôle est délégué au
navigateur de l'attaquant. AD-5 promet « un POST depuis une origine non déclarée est
rejeté même avec une clé valide » — un `curl` le dément.

**(b) Un quatrième écrivain de l'allowlist, hors du champ d'AD-5.** La feature extension
appelle `allowOriginForApp` (`apps/console/lib/queries-extension-scope.ts:L51-62`), qui
fait un `update app_registry set allowed_origins = ... || $2`. Enregistrer un domaine
pour l'extension **élargit l'allowlist d'ingestion**, globalement, via l'union du point
(a). Deux features, deux propriétaires en écriture de la même colonne, deux intentions
sans rapport.

**(c) L'ordre des couches diffère entre les deux ports entrants.** La clé d'API voyage
par deux transports incompatibles :

| Port | Transport de la clé | Ordre effectif |
| --- | --- | --- |
| `/v1/traces`, `/v1/logs` | **attribut resource `mip.api_key`**, *dans le corps* (`packages/rum-sdk/src/otel.ts:L113`, `otlp.mjs:L406` et `L745`) | parser tout le corps → **puis** vérifier la clé |
| `/v1/replay` | **en-tête `x-mip-key`** (`packages/rum-sdk/src/replay.ts:L170`) | vérifier la clé → **puis** lire le corps |

Sur la voie OTLP, `flattenOtlp` — 500 lignes, jusqu'à `MAX_SPANS_PER_REQUEST` spans —
s'exécute sur une entrée **non authentifiée**. C'est l'inverse de la voie replay. Les
deux respectent AD-5 : les couches y sont bien toutes présentes, dans un ordre que
l'AD ne fixe pas. Et parce que la clé est un attribut de télémétrie, elle traverse le
scrub PII sans être traitée comme un secret : rien dans `otlp.mjs` ne retire
`mip.api_key` de la resource. Un secret transporté comme une donnée métier finit
journalisé comme une donnée métier.

**(d) La couche 4 n'est nulle part.** `guardApps` (`apps/console/lib/ingest.ts:L61-81`)
vérifie clé puis débit. `monthly_quota` n'apparaît dans aucun chemin d'ingestion — il
n'est lu que par l'écran d'administration. La couche « quotas par app » d'AD-5 est
décorative.

### AD qui referme le trou

> ### AD-17 — L'authenticité est une séquence ordonnée, identique sur tous les ports entrants
>
> - **Binds :** `/v1/traces`, `/v1/logs`, `/v1/replay`, le dev-server, tout port entrant
>   futur, les trois adaptateurs émetteurs.
> - **Prevents :** deux ports composant les quatre couches d'AD-5 dans deux ordres, et un
>   parseur de 500 lignes exécuté sur une entrée non authentifiée.
> - **Rule :** l'ordre d'évaluation est fixe et le même partout : **origine → identité →
>   débit → quota → corps**. Chaque étape refuse sans exécuter la suivante. Aucun corps de
>   requête n'est parsé, décompressé ni parcouru avant que l'identité ne soit établie.
>   L'origine est un **contrôle serveur qui refuse**, pas un en-tête CORS : une origine
>   non déclarée **pour cette app** produit un refus, quelle que soit la clé. Le
>   rapprochement origine↔app est exact — jamais une union de parc. Le secret
>   d'identification voyage hors de la charge utile de télémétrie ; s'il doit y figurer
>   pour une contrainte de transport, il en est retiré avant tout traitement, journal ou
>   stockage. `app_registry.allowed_origins` a **un seul écrivain** ; toute feature qui
>   veut y ajouter une origine passe par lui et déclare pour quelle app.

---

## T5 — Majeur · AD-8 exige une trace sans en fixer la forme : l'alerte « absence d'exécution » est inconstruisible

### Les deux unités

- **Unité A — « restauration testée » / purge de rétention.**
- **Unité B — « battement de cœur externe » (AD-9), qui doit alerter sur le silence.**

### Comment chacune respecte tous les AD

A écrit bien une trace horodatée : `runSteps` (`apps/console/lib/cron.ts`) journalise
`log.info("cron tick", { steps, failed })` et renvoie un corps JSON par étape avec `ms`
et `ok`. B lit… quoi ? AD-8 ne le dit pas.

### Où elles deviennent incompatibles

Trois producteurs de « trace d'exécution », trois formes, aucune interrogeable :

| Producteur | Forme de la trace | Lisible par une requête ? |
| --- | --- | --- |
| `runSteps` (`apps/console/lib/cron.ts`) | ligne stdout `cron tick` + corps HTTP de réponse | non — journaux Vercel, éphémères |
| `purgeOnce` (`apps/ingest/purge.mjs`) | ligne stdout `purged` avec `{retention_days, detail}` | non — stdout du process self-host |
| `probeUptime` (`app/api/cron/tick/route.ts`) | `record_uptime_result(...)` — **une vraie table** | oui |

L'unité B ne peut pas construire « la purge n'a pas tourné cette nuit » : il n'existe
aucune table de journal d'exécution. `graft` ne trouve aucun `cron_run`, `job_run`,
`last_run` ni équivalent dans les 445 fichiers indexés. AD-8 est donc respecté par A et
inexploitable par B — l'AD produit une obligation d'écrire sans obligation de pouvoir
lire. « L'absence d'exécution est une alerte » reste une phrase.

**Divergence jumelle sur la rétention.** Deux implémentations coexistent, avec des
sémantiques RGPD opposées :

- `purge.mjs` appelle `purge_rum($1)` (`migration-v09`) — **délai global**, piloté par
  la variable `RETENTION_DAYS`. C'est le chemin **self-host**.
- `app/api/cron/daily/route.ts` appelle `purge_rum_tenants(30)` (`migration-v14`) —
  **rétention par client** via `app_registry.retention_days`, avec un défaut de 30
  codé en dur dans la route. C'est le chemin **cloud**.

Un client dont `retention_days = 7` voit ses données purgées à 7 jours en cloud et à 30
jours en self-host — pour un produit dont l'argument est « vos données chez vous ». Les
deux chemins respectent AD-8 (ils tracent) et AD-14 (self-host supporté). Aucun AD ne dit
que la rétention a un seul propriétaire.

### AD qui referme le trou

> ### AD-18 — La trace d'exécution a une forme unique, durable et interrogeable
>
> - **Binds :** purge, metering, rollups, alerting, sondes uptime, réconciliations,
>   battement de cœur externe, et toute tâche planifiée future.
> - **Prevents :** une obligation d'écrire sans possibilité de lire — trois formats de
>   trace qui rendent l'alerte de silence inconstruisible.
> - **Rule :** chaque exécution planifiée écrit **une ligne dans un journal d'exécution
>   unique et persistant** : nom de tâche, début, fin, issue, volumétrie traitée. La forme
>   est la même pour toutes les tâches, sur tous les modes de déploiement — cloud comme
>   self-host. Une tâche déclare aussi sa **cadence attendue** : c'est cette déclaration,
>   confrontée au journal, qui rend l'alerte de silence constructible sans connaissance
>   particulière de la tâche. Le journal survit à la rétention de télémétrie. Une
>   obligation légale — la rétention en premier — a **une seule implémentation**,
>   partagée par tous les déclencheurs, et ses paramètres viennent du registre tenant
>   (AD-15), jamais d'une variable d'environnement locale ni d'une constante de route.

---

## T6 — Majeur · AD-6 renvoie à un « mode POC nommé » que personne ne définit

### Les deux unités

- **Unité A — « allowlist d'origines »**, qui doit décider quoi faire quand le registre
  est indisponible.
- **Unité B — « voie d'accès tenant »**, qui doit décider la même chose.

### Comment chacune respecte tous les AD

AD-6 autorise explicitement une exception : « Toute exception à cette règle est un mode
POC nommé, activé explicitement, et jamais le défaut. » Les deux unités s'y engouffrent
— et le spine ne dit ni où ce mode est défini, ni comment il se nomme, ni qui le lit.

### Où elles deviennent incompatibles

Le dépôt contient déjà **cinq** exceptions fail-open, chacune nommée selon une
convention différente, aucune n'étant un « mode » :

| Exception | Emplacement | Comment elle se « nomme » |
| --- | --- | --- |
| Registre jamais chargé → clé non vérifiée | `pg-ingest.mjs:L261-275`, `_shared/auth.mjs:L58-76`, `v1-logs/index.ts:L60-73`, `dev-server.mjs:L59-73` | **rien** — condition implicite `!registryEverLoaded` |
| Registre indisponible → repli sur le socle statique d'origines | `apps/console/lib/ingest.ts:L31-43` (`corsFor`), commentaire « même esprit fail-open que checkApiKey » | **rien** — un `catch {}` |
| `rate_check` SQL en échec → passage | `pg-ingest.mjs`, `rateLimitedDurable` | **rien** — un `catch` retournant `false` |
| Secret de session absent → secret de dev | `apps/console/lib/auth.ts`, `resolveAuthSecret` | `NODE_ENV !== "production"` |
| Quota nul → jamais dépassé | `migration-v15`, cf. `scripts/verify-tenant.mjs:L59` | `monthly_quota is null` |

Quatre conventions de nommage pour une même notion : un drapeau d'environnement
(`REQUIRE_API_KEY`), une variable de plateforme (`NODE_ENV`), un état interne non
exposé (`registryEverLoaded`), une valeur nulle en base. Aucune n'est interrogeable :
impossible de répondre à « ce déploiement tourne-t-il en mode dégradé ? ». Et la
divergence la plus nette est déjà là — **le même `checkApiKey` existe en trois copies
avec deux comportements opposés** pour une app sans clé :

```js
// apps/ingest/lib/pg-ingest.mjs:L270 et _shared/auth.mjs — REJETTE
if (app.api_key_hash == null) return `app requires an API key: ${appId}`;

// apps/ingest/supabase/functions/v1-logs/index.ts:L68 — ACCEPTE
if (app.api_key_hash == null) return null;
```

Deux ports entrants, le même drapeau `REQUIRE_API_KEY=true`, deux verdicts contraires sur
la même app. Aucun AD ne l'interdit.

### AD qui referme le trou

> ### AD-6 (resserré) — remplacement du dernier paragraphe
>
> - **Rule :** l'indisponibilité d'un contrôle de sécurité refuse la requête. Registre non
>   chargé → 503, jamais 200. Échec du contrôle de débit → refus, jamais passage.
>   L'assouplissement d'un contrôle **n'est jamais une décision locale** : il n'existe
>   qu'un seul mode dégradé, porté par un nom unique, résolu par une seule fonction, lu
>   par tous les composants, et **rapporté par l'API de santé** — de sorte qu'un
>   déploiement puisse répondre « oui, je suis dégradé, voici quels contrôles ». Une
>   exception qui se signale par un `catch`, un état interne, un `NODE_ENV` ou une valeur
>   nulle en base n'est pas un mode nommé : c'est un contournement, et c'est un défaut.
>   Un même contrôle de sécurité a **une seule implémentation** partagée par tous les
>   ports entrants ; deux ports ne peuvent pas rendre deux verdicts sur la même entrée.

---

## T7 — Majeur · AD-10 parle d'une « césure datée » sans porteur, et le parc SDK n'a pas d'identité de version lisible

### Les deux unités

- **Unité A — « politique de versions SDK »** : l'ingestion doit déclarer quelles
  versions elle accepte, donc les lire.
- **Unité B — « calculs comparatifs / score de santé »** : elle doit refuser de comparer
  à travers une césure, donc la lire.

### Comment chacune respecte tous les AD

Chaque adaptateur émetteur émet bien une version, et AD-1 est respecté : ce sont des
champs OTLP standard. Aucun AD ne dit **dans quel champ**.

### Où elles deviennent incompatibles

Trois émetteurs, trois emplacements, deux sémantiques :

| Émetteur | Version du SDK | Version applicative |
| --- | --- | --- |
| `packages/rum-sdk` | `resource["service.version"] = SDK_VERSION` (`otel.ts:L17`, `L105`) — **"0.4.0"** | `mip.release` |
| `packages/rum-mobile` | `resource["service.version"] = "0.1.0"` **et** `scopeSpans[].scope.version` (`core.ts:L132`, `L141`) | `mip.release` |
| `packages/agent-node` | `scopeSpans[].scope.version` **seulement** (`core.ts:L190`, `L292`) — aucun `service.version` | — |

Deux conséquences frontales :

1. **L'unité A ne peut pas faire son travail.** `flattenOtlp` ne lit ni
   `service.version` ni `scope.version` — la seule version qu'il extrait est
   `res["mip.release"]` (`otlp.mjs:L407`), qui est la version de **l'application du
   client**, pas du SDK. L'ingestion ne peut donc pas « déclarer quelles versions de SDK
   elle accepte » : elle ne les voit pas. Pour `agent-node`, elle ne les verrait dans
   aucun cas, la version n'étant portée que par le scope.
2. **Collision de sémantique avec AD-1.** `service.version` désigne, en sémantique
   OpenTelemetry, la version du **service observé** — c'est-à-dire l'application du
   client. `rum-sdk` et `rum-mobile` y écrivent la version de l'instrumentation. Un
   Collector OTel tiers — la voie d'intégration de première classe promue par AD-5 —
   remplira ce champ selon la norme. Après remplacement d'un SDK maison par un
   Collector, comme AD-1 le promet explicitement, le même champ change de signification
   sans que rien ne le signale. C'est exactement la « comparaison statistique
   silencieusement fausse » qu'AD-10 prétend prévenir, **provoquée par la conformité à
   AD-1**.

Et la césure elle-même n'a aucun porteur : ni colonne, ni table, ni attribut. L'unité B
n'a rien à lire ; deux consommateurs construits séparément la représenteront
différemment — ou pas du tout.

### AD qui referme le trou

> ### AD-10 (resserré) — remplacement du paragraphe « Rule »
>
> - **Rule :** tout émetteur déclare l'identité de son instrumentation — nom **et**
>   version — dans un champ **propre au produit** (préfixe `mip.`, conformément à AD-1),
>   au même emplacement pour les trois adaptateurs et pour tout émetteur futur. Ce champ
>   ne réutilise jamais un champ de sémantique OTel standard, dont un Collector tiers
>   changerait le sens. Un lot sans identité d'instrumentation est traité comme
>   « émetteur inconnu » — une catégorie explicite, jamais un silence. L'ingestion
>   déclare quelles versions elle accepte et pendant combien de temps, et cette
>   déclaration est vérifiable sur le flux réel.

> ### AD-19 — La césure est une entité de première classe, pas une convention
>
> - **Binds :** l'ingestion, les rollups, les calculs d'anomalie, le score de santé, les
>   comparaisons de période, l'API de lecture, la console.
> - **Prevents :** deux consommateurs lisant deux formes de césure — ou aucune — et
>   comparant en silence des mesures de sémantiques différentes.
> - **Rule :** un changement de sémantique d'une mesure ou d'un identifiant crée une
>   **ligne de césure** — date, portée, mesures touchées, raison — dans un registre
>   unique. Tout calcul comparatif consulte ce registre : franchir une césure sans le
>   signaler dans la réponse est un défaut. La signalisation traverse l'API publique
>   (AD-2) : la console ne peut pas être le seul consommateur à la voir.

---

## T8 — Majeur · AD-7 nomme quatre récitants du fait d'hébergement ; le dépôt en compte au moins six

### Les deux unités

- **Unité A — « source unique des faits légaux »**, qui dérive les pages `/legal/*` et le
  DPA d'une constante d'infrastructure.
- **Unité B — « assistant IA de la console »**, qui répond aux questions des clients à
  partir d'une base de connaissances rédigée.

### Comment chacune respecte tous les AD

A applique AD-7 littéralement : ses `Binds` sont `apps/console/lib/legal.ts`, les pages
`/legal/*`, le DPA et la documentation de déploiement. B n'y figure pas — elle ne se
croit pas concernée, et n'a violé aucun AD.

### Où elles deviennent incompatibles

Le fait « où vivent les données » est écrit à la main dans au moins six endroits, et il
est **déjà faux dans cinq d'entre eux** :

| Emplacement | Ce qu'il affirme |
| --- | --- |
| `DEPLOY.md:L20` | Neon `aws-eu-central-1` (Francfort) — **vrai** |
| `apps/console/lib/legal.ts:L25`, `L31` | « Supabase … eu-west-3 — Paris, France » |
| `apps/console/lib/assistant-kb.ts:L84` | « Supabase en région eu-west-3 (Paris) » — **récité au client par l'assistant** |
| `apps/console/app/extension-privacy/page.tsx:L72` | « infrastructure à Paris » |
| `docs/CONFORMITE.md:L9`, `L63` | « Supabase … eu-west-3 (Paris) » |
| `docs/DPA.md:L32` | « région UE (`eu-west-3`) » |

Note que `legal.ts` **se contredit lui-même en interne** : `HOSTS` et `SUBPROCESSORS`
sont deux littéraux distincts qui doivent s'accorder à la main. Et la corriger ne
corrige pas `assistant-kb.ts` : un client qui pose la question à l'assistant de la
console reçoit une déclaration RGPD inexacte que l'AD-7 en vigueur n'oblige personne à
mettre à jour. Une unité conforme et une unité hors périmètre produisent deux réponses
opposables contradictoires à la même question.

### AD qui referme le trou

> ### AD-7 (resserré) — remplacement du paragraphe « Rule »
>
> - **Rule :** l'hébergeur, la région et la liste des sous-traitants sont dérivés d'une
>   constante d'infrastructure unique. **Tout ce qui récite un fait d'infrastructure à un
>   tiers est lié par cet AD** — pages légales, DPA, base de connaissances de
>   l'assistant, pages produit, documentation d'intégration, réponses d'API, supports
>   commerciaux — que ce soit du code, du contenu ou de la prose. Aucun fait
>   d'hébergement n'existe sous forme de littéral rédigé à la main : sa présence est un
>   défaut détectable, et sa détection casse le build. Un changement d'hébergeur casse le
>   build tant que **toutes** les déclarations dérivées ne sont pas régénérées.

---

## T9 — Notable · Le mécanisme différé d'AD-2 permet deux implémentations incompatibles du même RBAC

### Les deux unités

- **Unité A — « contrat de lecture public »** : elle applique le périmètre tenant dans
  `parseApiFilters` / `scopeApp` (`apps/console/lib/api/params.ts:L19`).
- **Unité B — « pages de la console »** : elle applique le périmètre tenant dans
  `allowedApps` (`apps/console/lib/auth.ts:L89`).

### Comment chacune respecte tous les AD

AD-2 exige l'**équivalence des capacités** et laisse le **mécanisme** en *Deferred* :
« appel HTTP réel ou couche de lecture partagée en processus ». Les deux unités
exposent bien les mêmes capacités. Aucune ne viole l'AD.

### Où elles deviennent incompatibles

Les deux fonctions sont, aujourd'hui, la **même règle recopiée** :

```ts
// apps/console/lib/api/params.ts:L19
if (p.role === "admin" || !p.apps?.length) return requested;
return requested && p.apps.includes(requested) ? requested : p.apps[0];

// apps/console/lib/auth.ts:L89
if (!user || user.role === "admin" || !user.apps?.length) return requestedApp;
return requestedApp && user.apps.includes(requestedApp) ? requestedApp : user.apps[0];
```

Tant que le mécanisme reste différé, ces deux copies vivent séparément. Corriger le
défaut de T2 (`!apps?.length` = toutes les apps) dans l'une **sans** l'autre produit
précisément le chemin privilégié qu'AD-2 prétend interdire : la console et l'API
appliqueraient deux périmètres tenant différents à la même identité. AD-2 protège
l'équivalence des *capacités* et laisse diverger l'équivalence des *restrictions* — or
c'est la seconde qui porte l'isolation. Le même reproche vaut pour `Filters` legacy vs
`Filters` v2, dont `parseApiFilters` maintient les deux formes en parallèle.

### AD qui referme le trou

> ### AD-2 (resserré) — ajout au paragraphe « Rule »
>
> L'équivalence porte sur les capacités **et sur les restrictions** : le calcul du
> périmètre tenant d'un principal a une seule implémentation, partagée par la console et
> par l'API publique. Deux copies de la règle de portée sont un défaut, quel que soit le
> mécanisme de transport retenu — et ce point n'est pas différé.

---

## Récapitulatif

| # | Trou | Gravité | Déjà dans le code ? | Correctif |
| --- | --- | --- | --- | --- |
| T1 | Quatre registres d'identité tenant concurrents | Bloquant | oui | **AD-15** (nouveau) |
| T2 | Cross-tenant non gouverné ; portée vide = tout voir | Bloquant | oui | **AD-3** resserré + **AD-16** (nouveau) |
| T3 | Voie unique AD-3 sans appelant ; `q`/`pool` exportés | Bloquant | oui | **AD-3** resserré |
| T4 | Ordre des couches AD-5 non fixé ; allowlist non appliquée serveur | Bloquant | oui | **AD-17** (nouveau) |
| T5 | Forme de la trace AD-8 non fixée ; deux rétentions | Majeur | oui | **AD-18** (nouveau) |
| T6 | « Mode POC nommé » indéfini ; cinq fail-open, deux verdicts | Majeur | oui | **AD-6** resserré |
| T7 | Version SDK sans emplacement ; césure sans porteur | Majeur | oui | **AD-10** resserré + **AD-19** (nouveau) |
| T8 | AD-7 ne lie pas tous les récitants du fait d'hébergement | Majeur | oui | **AD-7** resserré |
| T9 | Mécanisme AD-2 différé → RBAC recopié en deux endroits | Notable | oui | **AD-2** resserré |

**Bilan de la lentille.** Le spine tient bien sur ce qu'il nomme ; il ne tient pas sur
ce qu'il laisse à la discrétion du niveau inférieur. Les neuf trous relèvent tous du même
motif : un AD impose une **propriété** sans imposer la **forme** ni le **propriétaire**
qui la portent. Trois questions manquent à chaque AD du spine et suffiraient à fermer
huit trous sur neuf :

1. **Qui possède cette notion ?** (T1, T5, T7, T8 — quatre registres de tenant, deux
   rétentions, trois emplacements de version, six récitants de l'hébergeur)
2. **Quelle est sa forme unique ?** (T4, T5, T7 — trois allowlists, trois traces
   d'exécution, deux transports de clé)
3. **Que se passe-t-il dans le cas vide ou dégradé ?** (T2, T3, T6 — portée vide,
   registre indisponible, secret absent)

Deux corrections dominent en effet de levier : **AD-15** (registre tenant faisant
autorité) ferme T1 et une bonne moitié de T2 et T5 ; **AD-17** (séquence d'authenticité
ordonnée et unique) ferme T4 et la partie « deux verdicts » de T6.
