---
name: 'Revue sécurité & conformité — ARCHITECTURE-SPINE MIP RUM'
type: architecture-review
lens: securite-conformite
target: '_bmad-output/planning-artifacts/architecture/architecture-poc-MIP_RUM-2026-08-25/ARCHITECTURE-SPINE.md'
reviewer: 'Lentille ad-hoc sécurité/conformité — Reviewer Gate bmad-architecture'
date: '2026-08-25'
method: 'Ancrage systématique sur le code réel via graft (445 fichiers indexés, 2620 symboles)'
---

# Revue sécurité & conformité — ARCHITECTURE-SPINE MIP RUM

## Verdict

**Le spine ne tient pas encore sa promesse d'auditabilité.** Il diagnostique juste — AD-3, AD-5,
AD-6, AD-7, AD-8 et AD-11 nomment des défauts réels, vérifiés dans le code — mais il énonce
massivement des **résultats attendus** là où un auditeur cherche des **mécanismes contraignants**,
et il laisse hors champ quatre dimensions qu'aucun acheteur grand compte ne laissera passer :
la gestion des secrets, le journal d'audit, la qualification des rôles RGPD, et la notification
de violation. Sur les trois invariants les plus vendeurs — isolation, authenticité, réversibilité —
l'écart entre ce que le dépôt *fait* et ce que le spine *garantit* est structurel, pas cosmétique.

La bonne nouvelle : le dépôt est **plus mûr que le spine ne le reflète** (scrub PII, zéro IP,
rétention par tenant, DSAR, purge, RLS écrite et testée, `assertCronAuth` fail-closed, comparaison
de secrets en temps constant). Le problème n'est pas l'absence de travail, c'est que le spine ne
sait pas dire lequel de ces acquis est *garanti* et lequel est *présent par accident*.

### Table de synthèse

| # | Axe | Sévérité | Écart en une ligne |
| --- | --- | --- | --- |
| F1 | 1 — Isolation | **Critique** | AD-3 décrit une voie unique dont l'implémentation existe et n'a **zéro appelant** |
| F2 | 1 — Isolation | **Critique** | Le chemin d'écriture n'est pas couvert : injection cross-tenant écriture→lecture sur le replay |
| F3 | 1 — Isolation | Élevée | Les chemins trans-tenants légitimes existent et ne sont énumérés nulle part |
| F4 | 1 — Isolation | Moyenne | Le contrat de lecture **clampe** au lieu de refuser, et s'ouvre par défaut à toutes les apps |
| F5 | 2 — Authenticité | **Critique** | L'allowlist d'origines d'AD-5 n'existe pas comme contrôle : c'est du CORS |
| F6 | 2 — Authenticité | Élevée | L'allowlist « par app » contient un socle statique inter-tenants |
| F7 | 2 — Authenticité | Élevée | Les 4 couches couvrent l'origine du POST, jamais la véracité du contenu |
| F8 | 2 — Authenticité | Élevée | La réversibilité par lot est irréalisable : le modèle n'a aucun identifiant de lot |
| F9 | 2 — Authenticité | Moyenne | AD-6 ferme les défaillances, pas les **défauts de configuration** ouverts |
| F10 | 3 — RGPD | **Critique** | Deux définitions divergentes du périmètre DSAR, et six tables dans aucune des deux |
| F11 | 3 — RGPD | Élevée | Rétention unique par app : aucune durée différenciée par finalité ; `audit_log` jamais purgé |
| F12 | 3 — RGPD | Élevée | Sous-traitant hors UE câblé en code et absent de la liste ; AD-7 ne couvre pas les sorties |
| F13 | 3 — RGPD | Moyenne | Le journal d'audit est absent du spine, sans `app_id`, et visible de tous les tenants |
| F14 | 3 — RGPD | Moyenne | Base légale et périmètre DSAR du dogfooding jamais posés — les e-mails console sont en télémétrie |
| F15 | 3 — RGPD | Élevée | Rôles RGPD jamais qualifiés : responsable vs sous-traitant, ni en SaaS, ni en OEM |
| F16 | 3 — RGPD | Moyenne | Notification de violation (art. 33/34) et AIPD (art. 35) entièrement absentes |
| F17 | 4 — Secrets | Élevée | Zéro ligne sur les secrets, la rotation, le chiffrement — dans 320 lignes de spine |
| F18 | 4 — Secrets | Élevée | Deux systèmes de jetons de lecture concurrents aux propriétés de sécurité opposées |
| F19 | 3 — RGPD | Moyenne | La minimisation (« zéro IP ») est tenue en fait, garantie par rien |

---

## Axe 1 — Isolation multi-tenant (AD-3)

> *Résiste-t-elle à un pentest « un token du tenant A ne lit jamais B » ?* **Non.** Trois raisons
> distinctes, dont deux que le spine ne voit pas.

### F1 — AD-3 décrit une voie unique qui n'a aucun appelant `[Critique]`

**Écart.** AD-3 pose : « toute lecture ou écriture scopée tenant passe par une fonction unique qui
pose la GUC `app.current_app_id` dans sa transaction. L'accès brut est **inaccessible** pour une
requête tenant — l'oubli est une erreur de compilation, pas une revue à refaire. »

Le code dit autre chose. La fonction existe — `withTenant`, `apps/console/lib/db.ts:L114-L135` —
et graft ne lui trouve **aucune arête entrante** : elle n'est appelée nulle part. Les 49 sites de
lecture passent tous par `q()` (`apps/console/lib/db.ts:L82-L95`, 49 arêtes entrantes), qui exécute
directement sur le pool, sans transaction et sans GUC. Sa propre docstring ferme le dossier :

```
Sans effet tant que la console se connecte avec un rôle BYPASSRLS : la GUC est posée,
mais les policies ne s'appliquent pas.
```

L'écart n'est pas « la voie unique n'est pas encore adoptée » — le spine l'admet. L'écart est que
**AD-3 énonce l'inaccessibilité comme un fait acquis sans nommer ce qui la produit**. « Erreur de
compilation » n'est pas un mécanisme : `q` est un export public d'un module que les 49 fichiers
importent déjà. Rien dans le spine ne dit *comment* cet import cesse d'être possible. Un auditeur
lit AD-3, ouvre `queries-v2.ts`, voit `q()`, et conclut que le spine décrit une intention.

**AD-3 resserré.** Ajouter à la règle la clause de mécanisme, testable :

> L'inaccessibilité de l'accès brut est portée par une frontière de module, pas par une consigne :
> `q()` cesse d'être exporté hors de `db.ts` ; toute requête tenant reçoit un handle de transaction
> déjà scopé, qu'elle ne peut pas fabriquer elle-même. Un test de frontière échoue si un import de
> l'accès brut apparaît hors du module de stockage. Tant que ce test n'existe pas, aucune propriété
> d'isolation n'est citée en rendez-vous (AD-11).

---

### F2 — Le chemin d'écriture n'est pas couvert : injection cross-tenant sur le replay `[Critique]`

**Écart.** AD-3 dit « lecture ou écriture », mais tout le raisonnement du spine (« l'oubli d'un
`WHERE app_id` », « 49 sites d'appel de **lecture** ») est un raisonnement de lecture. Le chemin
d'écriture d'ingestion n'est ni compté, ni analysé — et il porte un défaut exploitable.

La racine est structurelle : **le discriminant tenant ne fait pas partie de l'identité**.
`rum_session.session_id` est la clé primaire *globale*, `app_id` n'est qu'une colonne. Or les
`session_id` sont générés côté client (`packages/rum-mobile/src/index.ts:L154` — `hex(16)` ;
`getOrCreateSession()` côté SDK web). La chaîne complète :

1. `apps/ingest/lib/pg-ingest.mjs:L197-L219` — `writeReplayChunk` insère
   `rum_session (session_id, app_id) … on conflict (session_id) do nothing`, puis
   `replay_chunk (session_id, app_id, seq, …)` avec l'`app_id` **lu dans l'en-tête `x-mip-app`**.
2. Le tenant B poste un chunk sous un `session_id` appartenant au tenant A : le `on conflict do
   nothing` préserve la ligne de A, et le chunk de B s'insère (conflit uniquement sur
   `(session_id, seq)` — il suffit de choisir un autre `seq`).
3. `apps/console/app/api/replay/[sessionId]/route.ts:L40` — la lecture est
   `select seq, events_count, body from replay_chunk where session_id = $1 order by seq`.
   **Aucun prédicat `app_id`.** Les chunks de B sont concaténés dans le replay servi au viewer de A.

Le contrôle de portée qui précède (`route.ts:L28-L36`) ne rattrape rien : il interroge une *autre*
table (`rum_session`) pour vérifier le propriétaire, puis lit `replay_chunk` sans reporter la
contrainte. Et il est conditionné à `if (user?.apps)` — un principal sans portée (admin, ou
`getUser()` qui rend `undefined`) le saute entièrement, la route ne tenant alors que par un
commentaire : « protégée par le middleware global ».

Coût d'exploitation : une clé `mip_live_*` valide de B (publiée dans le HTML de son propre site),
ou aucune clé du tout puisque `REQUIRE_API_KEY` vaut `false` par défaut (F9), plus un `session_id`
de A. Symétriquement, l'effacement DSAR de A supprime les chunks injectés par B, et les chunks de
B injectés dans A survivent à l'effacement de B — la réversibilité et l'art. 17 sont atteints en
même temps que la confidentialité.

**AD nouveau — AD-15 : le tenant fait partie de l'identité, pas des filtres.**

> **Binds :** toutes les tables tenant, tous les écrivains d'ingestion, tous les lecteurs.
> **Prevents :** l'injection cross-tenant par collision d'identifiants fournis par le client — le
> mode de défaillance qu'aucun `WHERE app_id` côté lecture ne rattrape, parce que la ligne
> *appartient déjà* au mauvais tenant au moment où on la lit.
> **Rule :** aucun identifiant fourni par un émetteur n'est unique globalement. La clé d'identité
> d'une ligne tenant est `(app_id, <identifiant>)`, jamais `<identifiant>` seul. Toute lecture qui
> résout un identifiant client porte `app_id` **dans le même prédicat**, jamais dans une requête
> de contrôle séparée. Un écrivain d'ingestion n'écrit jamais sous une identité qu'il n'a pas
> prouvé posséder : réutiliser l'identifiant d'un autre tenant est un rejet, pas une fusion
> silencieuse (`on conflict do nothing`).

---

### F3 — Les chemins trans-tenants existent et ne sont énumérés nulle part `[Élevée]`

**Écart.** AD-3 pose une règle universelle (« toute lecture ou écriture scopée tenant ») sans
énumérer ses exceptions. Or le dépôt en compte au moins six, toutes légitimes, toutes non nommées :

| Chemin | Ancrage | Nature |
| --- | --- | --- |
| Export/effacement DSAR en mode `'all'` | `apps/console/lib/queries-dsar.ts:L16` — `($1 = 'all' or app_id = $1)` | Trans-tenant par conception |
| Journal d'audit | `audit_log` n'a pas de colonne `app_id` ; `migration-v47.sql:L67` l'exclut explicitement (« journal global ») | Trans-tenant structurel |
| Fonctions `security definer` | `check_alerts`, `check_slo_burn`, `route_alert`, `purge_old_data`, `record_uptime_result`, `rate_check` — `migration-v47.sql` en-tête | Exploitation, hors RLS |
| Metering / quotas | `meter_tenant_usage()`, `v_tenant_usage_month` | Agrégation trans-tenant |
| Upload de sourcemaps | `apps/console/app/api/sourcemaps/route.ts:L16-L17` — contrôle `role !== "admin"`, **jamais** `user.apps.includes(appId)` | Code source client, non scopé |
| Assistant IA | `apps/console/app/api/ask/route.ts` | Sortie vers un tiers (cf. F12) |

Un invariant dont les exceptions ne sont pas écrites n'est pas auditable : le pentesteur ne peut
pas distinguer une exception voulue d'une fuite. Et l'exception `sourcemaps` est déjà un défaut
latent — elle ne tient que parce que `admin` signifie aujourd'hui « toutes les apps » ; le jour où
un intégrateur OEM veut un admin scopé, elle devient une fuite de code source client.

**AD-3 resserré.** Ajouter :

> Les chemins qui franchissent délibérément la frontière tenant sont **énumérés** dans le spine,
> pas découverts en revue. Chacun nomme sa justification, son autorisation, et sa trace dans le
> journal d'audit. Un chemin trans-tenant non déclaré est un défaut, quelle que soit sa légitimité.
> Corollaire : le rôle `admin` n'est pas un contournement de portée — un principal a une portée,
> même totale, et elle est explicite.

---

### F4 — Le contrat de lecture clampe au lieu de refuser, et s'ouvre par défaut `[Moyenne]`

**Écart.** `apps/console/lib/api/params.ts:L20-L23` :

```ts
function scopeApp(p: ApiPrincipal, requested: string | null): string | null {
  if (p.role === "admin" || !p.apps?.length) return requested;
  return requested && p.apps.includes(requested) ? requested : p.apps[0];
}
```

Deux comportements qu'un auditeur relèvera :

1. `!p.apps?.length` → la portée demandée est rendue **sans contrôle**. Or `apps: null` est le
   défaut rétro-compatible d'un jeton `CONSOLE_API_TOKENS` sans suffixe `@app`
   (`apps/console/lib/api/auth.ts:L36`) — la documentation OpenAPI l'assume :
   « Jeton machine listé dans CONSOLE_API_TOKENS (lecture seule, **toutes apps**) »
   (`lib/api/openapi.ts:L186`). Un jeton OEM émis sans scope explicite lit tous les tenants.
2. Un viewer scopé qui demande l'app d'un autre reçoit **`p.apps[0]` et un 200**, pas un 403. Il
   n'y a donc aucun événement de refus : rien à journaliser, rien à alerter, rien à produire en
   preuve. À comparer avec `/api/ask` (`app/api/ask/route.ts:L114-L116`) qui, lui, rend un 403 —
   l'incohérence entre deux surfaces de lecture est en soi un constat d'audit.

AD-2 impose l'équivalence des **capacités** entre console et API publique. Elle ne dit rien du
**modèle d'autorisation** de cette API — c'est-à-dire précisément ce qu'un pentest attaque.

**AD-2 resserré.** Ajouter un second membre à l'invariant :

> L'équivalence porte sur les capacités **et** sur les contrôles : une capacité offerte à l'API
> publique y est soumise au même modèle de portée, avec la même granularité de refus, que dans la
> console. Une portée non résoluble est un **refus explicite**, jamais un repli silencieux sur une
> portée voisine ni sur la portée totale. Un jeton sans portée déclarée n'est pas un jeton « toutes
> apps » : c'est un jeton invalide.

---

## Axe 2 — Authenticité d'ingestion (AD-5, AD-6)

### F5 — L'allowlist d'origines n'existe pas comme contrôle : c'est du CORS `[Critique]`

**Écart.** AD-5, couche 1 : « **Allowlist d'origines par app** — obligatoire. Un POST depuis une
origine non déclarée est rejeté même avec une clé valide. »

Dans le code, `app_registry.allowed_origins` ne sert qu'à **composer les en-têtes de réponse** :

- `apps/ingest/supabase/functions/_shared/cors.mjs:L33-L42` — `corsHeaders()` pose
  `Access-Control-Allow-Origin` si l'origine est connue, et se contente des en-têtes de préflight
  sinon. Le commentaire est explicite : « le navigateur bloque, ce qui est le comportement voulu ».
- `apps/console/lib/ingest.ts:L61-L81` — `guardApps()`, la **seule** garde serveur du chemin
  d'ingestion, ne vérifie que deux choses : la clé d'API (403) et le débit (429). L'origine n'y
  entre jamais.

CORS est une protection **du navigateur contre le navigateur**. Un POST `curl`, un Collector, un
script serveur, une extension, un bot : rien de tout cela n'est arrêté par un en-tête de réponse
absent. La couche 1 d'AD-5 n'est donc aujourd'hui **aucune** couche.

Ce que le spine ne tranche pas, et qui explose à l'implémentation : **la couche 1 et la couche 2
d'AD-5 se contredisent**. La couche 2 fait du Collector OTel serveur-à-serveur une voie
d'intégration de première classe — or un appel serveur-à-serveur n'envoie **pas d'en-tête
`Origin`**, et `isAllowedOrigin()` (`cors.mjs:L19-L22`) rend `false` sur origine vide. Appliquer la
couche 1 telle qu'écrite ferme la couche 2. Le spine doit dire lequel des deux régimes s'applique
à quel type d'émetteur, sinon la première implémentation choisira au hasard.

**AD-5 resserré, couche 1.**

> La vérification d'origine est un **contrôle serveur qui refuse la requête (403)**, décidé avant
> l'écriture et indépendant des en-têtes CORS ; CORS reste une conséquence de la décision, jamais
> sa mise en œuvre. Le régime dépend du **profil d'émetteur déclaré par l'app** :
> profil *navigateur* → une requête sans `Origin`, ou avec une `Origin` non déclarée, est refusée ;
> profil *serveur-à-serveur* → l'`Origin` n'est pas le facteur : l'authenticité repose sur un
> secret non exposé au navigateur, et une requête portant une `Origin` est refusée. Une app ne
> cumule pas les deux profils sur la même clé.

---

### F6 — L'allowlist « par app » contient un socle inter-tenants `[Élevée]`

**Écart.** `apps/ingest/supabase/functions/_shared/cors.mjs:L11-L16` :

```js
export const STATIC_ALLOWED_ORIGINS = [
  "https://plateforme.groupement-it.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
];
```

Ce socle est **global** : il vaut pour toutes les apps, et l'union `socle ∪ origines de l'app` est
calculée sans distinction (`originsFromRegistry`, `cors.mjs:L50-L56`). Une allowlist « par app »
qui commence par quatre origines communes à tous les tenants n'est pas par app. Deux conséquences :
un tenant hérite d'origines qu'il n'a pas déclarées, et `localhost:3000/8080` — qui existe sur le
poste de n'importe qui — est acceptable en production. Au passage, le host en dur
`https://plateforme.groupement-it.com` est exactement ce qu'AD-4 interdit, à un endroit qu'AD-4 ne
lie pas (`Binds` ne cite que l'onboarding, le layout, l'écran admin, les défauts SDK et la doc).

**AD-5 resserré, et `Binds` d'AD-4 élargi.**

> L'allowlist est **exclusivement** par app : il n'existe aucun socle d'origines partagé entre
> tenants. Les origines de développement sont portées par le mode POC nommé d'AD-6, jamais par la
> configuration expédiée. AD-4 lie également le socle CORS d'ingestion : aucune origine ni aucun
> host de production n'est écrit dans le code.

---

### F7 — Les quatre couches couvrent l'origine du POST, jamais la véracité du contenu `[Élevée]`

**Écart.** *Que peut encore faire un attaquant qui respecte l'allowlist ?* Tout, et c'est le point
aveugle d'AD-5. Les quatre couches répondent à « d'où vient ce POST », aucune à « ce qu'il
raconte est-il vrai ». Le scénario n'est même pas exotique : la clé `mip_live_*` est publiée dans le
HTML du client (AD-5 le dit), et l'origine autorisée **est** le site du client. Donc quiconque
exécute du code sur ce site — un XSS, une extension navigateur, une dépendance tierce compromise,
un utilisateur avec la console F12 — satisfait les couches 1 et 3 par construction et peut :

- injecter des `exception` fabriquées jusqu'à noyer le score de santé et déclencher les alertes ;
- injecter des métriques de vitals biaisées, qui contaminent `rum_rollup_hourly`, les p75, les SLO
  et les comparaisons de déploiement (`deploy_marker`) — des données **dérivées** qu'on ne peut
  pas dépoisonner en supprimant les lignes sources ;
- écrire sous un `session_id` arbitraire (cf. F2), y compris celui d'un autre tenant.

La couche 4 (« quotas, détection d'anomalie de volume ») ne voit que le **volume**. Un
data-poisoning de faible volume et de fort effet — 200 exceptions bien choisies — passe sous tous
les seuils.

**AD-5 resserré, couche 4.**

> La détection d'anomalie porte sur la **forme** autant que sur le volume : un émetteur qui change
> brutalement de distribution (nouveaux `session_id`, cardinalité de routes, sévérité) est signalé,
> pas seulement celui qui change de débit. Les agrégats dérivés (rollups, p75, scores, SLO) portent
> la trace des lots qui les composent, faute de quoi la purge d'un lot ne dépoisonne pas ce qu'il a
> contaminé. Un lot suspect est **mis en quarantaine** — écrit, isolé, invisible des lectures et
> des agrégats jusqu'à décision — plutôt que rejeté ou accepté.

---

### F8 — La réversibilité par lot est irréalisable avec le modèle actuel `[Élevée]`

**Écart.** AD-5, couche 4 : « **réversibilité** — tout lot identifiable doit pouvoir être purgé. »
La formule contient sa propre échappatoire (« identifiable »), et le modèle de données ne rend
aucun lot identifiable. Vérifié table par table : `rum_metric`, `rum_error`, `rum_pageview`,
`rum_log` (`migration-v29.sql:L11`), `rum_span`, `replay_chunk` — **aucune** ne porte
d'identifiant de lot, d'horodatage de réception distinct de l'horodatage émetteur, d'empreinte de
l'émetteur, ni de référence à la clé utilisée. L'idempotence est par `span_id` (Consistency
Conventions), ce qui déduplique mais n'identifie pas une provenance.

Les seuls gestes de suppression disponibles sont donc :

- `purge_rum_tenants(default_days)` — par **âge**, honore `app_registry.retention_days`
  (`migration-v14.sql:L52`) ;
- `erase_app_data(app_id)` — **tout** le tenant (`migration-v14.sql:L78`, redéfini v18 et v30) ;
- `erase_session(session_id)` — **une** session (`migration-v14.sql:L101`, redéfini v30).

Aucun ne correspond à « purger le lot poisonné du 14 août entre 9h et 11h émis par la clé
compromise ». La seule réponse réelle à un incident de poisoning aujourd'hui est
`erase_app_data()` — détruire l'intégralité de la télémétrie du client pour retirer l'injection.
Ce n'est pas une réversibilité, c'est un dommage collatéral total.

**AD nouveau — AD-16 : toute écriture d'ingestion porte sa provenance.**

> **Binds :** tous les écrivains d'ingestion, le modèle de données tenant, les agrégats dérivés,
> la procédure de réponse à incident.
> **Prevents :** l'incident de data-poisoning sans remédiation proportionnée — aujourd'hui, retirer
> une injection impose d'effacer toute la télémétrie du client.
> **Rule :** chaque ligne écrite par l'ingestion porte une coordonnée de lot : instant de
> **réception** (distinct de l'instant émetteur), app, source, version de SDK, et identité de la
> clé utilisée. La purge sélective par coordonnée de lot — et la recomposition des agrégats
> dérivés qui en découlent — est une fonctionnalité testée, pas une requête SQL improvisée en
> incident. Un lot qu'on ne sait pas retirer sans effacer le tenant n'est pas réversible.

---

### F9 — AD-6 ferme les défaillances, pas les défauts de configuration `[Moyenne]`

**Écart.** AD-6 est juste et bien ciblé : les trois fail-open qu'il vise existent bel et bien —
`checkApiKey` rend `null` quand le registre n'a jamais chargé
(`apps/ingest/lib/pg-ingest.mjs:L264-L267`), `rateLimitedDurable` rend `false` sur exception SQL
(`pg-ingest.mjs:L297-L300`), et le contre-exemple positif existe aussi
(`assertCronAuth`, `apps/console/lib/cron.ts:L26-L36`, 503 sans `CRON_SECRET`).

Mais AD-6 parle d'**indisponibilité d'un contrôle**. Il ne dit rien du contrôle **désactivé par
défaut** — et c'est le cas de la garde principale :

```ts
export const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";  // apps/console/lib/ingest.ts:L16
```

Toute valeur autre que la chaîne `"true"` — absente, `"1"`, `"TRUE"`, faute de frappe — désactive
entièrement `checkApiKey`, qui rend `null` dès la première ligne. Ce n'est pas une défaillance :
c'est la posture livrée. Un contrôle éteint par défaut n'est pas « fail-closed », il n'est pas.
Même remarque pour `CONSOLE_API_RATE_LIMIT` (`0` = désactivé, `lib/api/handle.ts:L29-L32`).

**AD-6 resserré.**

> Un contrôle de sécurité est **actif par défaut** dans la configuration expédiée : son absence de
> configuration l'active, elle ne l'éteint pas. Une variable d'environnement ne peut que
> *restreindre*. Sa désactivation est le mode POC nommé, qui s'annonce au démarrage et se voit dans
> l'état de santé du produit. Un contrôle dont le défaut est « éteint » est traité comme absent
> dans tout discours commercial et tout dossier d'audit.

---

## Axe 3 — RGPD

> AD-7 et AD-8 sont nécessaires et bien visés, mais ils couvrent **deux** obligations sur la
> douzaine qu'un DPO passe en revue. Voici ce qui manque, du plus grave au moins.

### F10 — Deux définitions divergentes du périmètre DSAR, six tables dans aucune `[Critique]`

**Écart.** Le périmètre de l'export et de l'effacement (art. 15 et 17) est défini **deux fois**,
dans deux langages, et les deux définitions ne coïncident pas :

| Définition | Ancrage | Contenu |
| --- | --- | --- |
| TypeScript — chemin console | `apps/console/lib/dsar.ts:L25-L33` (`DSAR_CHILD_TABLES`) | 10 tables : `rum_metric`, `rum_error`, `rum_pageview`, `rum_span`, `rum_event`, `rum_breadcrumb`, `rum_longtask`, `rum_resource`, `rum_ai`, `replay_chunk` + ancre `rum_session` |
| SQL — fonctions de conformité | `migration-v30.sql:L67-L78` (`erase_session`) | Les mêmes **plus `rum_log`** |

`rum_log` porte `session_id`, `route` et un `body` de 4000 caractères de message applicatif
(`migration-v29.sql:L11`). Il est purgé par le SQL, **jamais par le chemin console** : un
effacement DSAR déclenché depuis `/admin/privacy` laisse les logs de la personne en base. Deux
sources de vérité pour une obligation légale, dont une incomplète — c'est le constat type d'un
audit DPO.

Pire : les six tables de `migration-v51.sql` — `svi_call` (L37), `svi_step` (L102), `svi_leg`
(L139), `svi_quality_sample` (L160), `svi_queue_sample` (L170), `svi_call_link` (L181) — ne sont
**dans aucune des deux définitions**, ni dans `purge_rum_tenants`, ni dans `erase_app_data`, ni
dans `erase_session`. Or `svi_call` porte un `caller_hash` : de la donnée d'appel rattachable à une
personne, sans export, sans effacement et **sans rétention**, conservée indéfiniment.

Le spine n'a aucun AD sur la complétude du périmètre. AD-8 garantit que la purge *tourne* — pas
qu'elle *couvre*. Une purge prouvée sur un périmètre incomplet donne un faux vert opposable, le
motif même d'AD-11 transposé à la conformité.

**AD nouveau — AD-17 : le périmètre des données personnelles est déclaré une fois et dérivé.**

> **Binds :** le schéma, l'export DSAR, l'effacement, la purge de rétention, le registre des
> traitements, le DPA.
> **Prevents :** l'export incomplet et l'effacement partiel — un manquement aux art. 15 et 17 qui
> ne produit aucun symptôme et qu'aucune relecture ne rattrape à mesure que le schéma grossit.
> **Rule :** toute table portant une donnée rattachable à une personne est déclarée dans un
> **registre unique**, avec sa finalité, son ancre d'identification et sa durée de conservation.
> Export, effacement et purge sont **dérivés** de ce registre, jamais réécrits en parallèle. Une
> table créée sans déclaration casse le build — le défaut de couverture ouvert et documenté dans
> l'en-tête de `migration-v47` (les policies ne suivent pas les tables nouvelles) est le même
> défaut, et se ferme au même endroit.

---

### F11 — Rétention unique par app ; le journal d'audit n'est jamais purgé `[Élevée]`

**Écart.** `app_registry.retention_days` est **un entier** (`migration-v14.sql:L9`), appliqué
uniformément à toutes les tables du tenant. Le modèle ne peut donc pas exprimer ce que tout DPO
exige : des durées **différenciées par finalité**. Or les finalités présentes dans le produit sont
manifestement hétérogènes — un enregistrement de session (`replay_chunk`, rrweb : contenu d'écran,
saisies, parcours) et un rollup horaire anonyme ne se conservent pas la même durée, ni sous le même
régime.

Et une table échappe entièrement à la rétention : `audit_log`. Les en-têtes de `migration-v09.sql:L9`
et `migration-v14.sql:L6` sont explicites — « N'EFFACE PAS audit_log ni console_user ». Elle stocke
`user_email` (`migration-v03.sql:L29`), donnée personnelle directe, **sans limite de durée** et
sans qu'aucune purge ne la vise. AD-8 ne peut rien y faire : il prouve qu'une tâche planifiée a
tourné ; ici il n'y en a aucune à prouver.

**AD-8 resserré, et AD-17 complété.**

> La durée de conservation est un attribut de la **finalité**, pas du tenant : le registre d'AD-17
> porte une durée par catégorie de donnée, et la purge en dérive. Toute donnée personnelle a une
> durée déclarée — y compris les journaux d'exploitation et d'audit, dont la conservation
> prolongée est une décision motivée et bornée, jamais un effet de bord de leur exclusion des
> purges. AD-8 s'applique alors à ce qu'il sait prouver : que chaque purge déclarée s'est exécutée.

---

### F12 — Sous-traitant hors UE câblé en code, absent de la liste ; AD-7 ne couvre pas les sorties `[Élevée]`

**Écart.** AD-7 est le bon invariant appliqué au mauvais périmètre. Il dérive « l'hébergeur, la
région et la liste des sous-traitants » d'une constante d'**infrastructure**. Mais un sous-traitant
n'arrive pas toujours par l'infrastructure : il arrive par un `fetch`.

`apps/console/lib/legal.ts:L30-L35` déclare quatre sous-traitants, dont deux placeholders :

```ts
{ name: "[Fournisseur LLM — Mistral AI recommandé]",
  role: "Assistance / synthèse (si activée) sur données agrégées, sans PII",
  location: "[UE si Mistral 🇫🇷]" },
```

Le code, lui, appelle **deux** fournisseurs, et l'un est américain :

- `apps/console/app/api/ask/route.ts:L36-L37, L59-L74` — `MISTRAL_API_KEY` puis
  `ANTHROPIC_API_KEY` → `https://api.anthropic.com/v1/messages` ;
- même paire dans `app/api/briefing/route.ts:L43-L44` et `app/api/assist/route.ts:L48-L49`.

Anthropic est donc un sous-traitant ultérieur non déclaré, avec transfert hors UE, pour un produit
dont l'argument de vente est la souveraineté. Et l'affirmation « sur données agrégées, sans PII »
n'est garantie par aucune frontière : le prompt est bâti sur `gatherBriefingSignals`
(`lib/queries-briefing.ts:L47-L135`), qui remonte les messages d'erreur (`type`, `fingerprint`) et
les routes — deux champs où de la donnée personnelle transite couramment. AD-7 ne casserait le
build pour aucun de ces faits : brancher un tiers ne touche pas la constante d'infrastructure.

**AD-7 resserré.**

> La source unique ne couvre pas seulement l'hébergement mais **toute sortie de données vers un
> tiers** : un appel réseau sortant vers un hôte non déclaré dans le registre des sous-traitants
> casse le build. Le registre porte, par tiers, la finalité, la catégorie de données transmise, la
> localisation et la base du transfert. La mention « sans donnée personnelle » n'est pas une
> déclaration : c'est une frontière de code, testée, ou elle n'est pas écrite. Les champs
> d'identité de l'éditeur et le contact du DPO (`ORG`, `legal.ts:L9-L21`, aujourd'hui des
> placeholders) sont soumis à la même règle : une valeur légale non renseignée casse le build de
> production.

---

### F13 — Le journal d'audit est absent du spine `[Moyenne]`

**Écart.** Le spine ne mentionne le journal d'audit **nulle part** — ni dans un AD, ni dans les
conventions, ni dans le Structural Seed. Il existe pourtant, et il est plutôt bien fait :
`audit_log` reçoit login, logout, échecs d'authentification, créations d'app, tokens de lecture,
actions RGPD (`app/admin/privacy/actions.ts:L12`), scopes d'extension — 24 sites d'appel — et
`migration-v16.sql:L69-L70` ne lui accorde que `select, insert` : jamais d'`update` ni de `delete`,
donc append-only par les droits. C'est un acquis à revendiquer.

Trois défauts, qu'aucun AD ne tient :

1. **Pas d'`app_id`.** `migration-v47.sql:L67` l'exclut explicitement du scoping (« journal
   global ») et `migration-v16.sql:L72` lui laisse une policy `using (true)`. La page
   `/admin/audit` (`app/admin/audit/page.tsx:L20`) lit `select … from audit_log order by ts desc
   limit 100`, sans filtre : en déploiement OEM, l'admin d'un intégrateur voit les actions
   effectuées sur les autres tenants.
2. **Pas de rétention** (cf. F11).
3. **Pas d'exportabilité ni d'intégrité démontrable** — un acheteur demandera un export vers son
   SIEM et une garantie de non-altération. « Append-only par les droits » tient tant que la
   connexion n'est pas propriétaire ; elle l'est aujourd'hui (F1).

**AD nouveau — AD-18 : le journal d'audit est une frontière, pas une commodité.**

> **Binds :** l'authentification console, les actions d'administration, les gestes RGPD, les refus
> de sécurité, le déploiement OEM.
> **Prevents :** l'impossibilité de répondre à « qui a fait quoi, quand, sur quel tenant » — la
> première question de toute due diligence et de toute réponse à incident.
> **Rule :** tout geste privilégié — administration, accès trans-tenant (AD-3), export ou
> effacement de données personnelles, refus de sécurité — écrit une entrée d'audit portant l'acteur,
> l'instant, le **tenant concerné** et l'effet. Le journal est en ajout seul, scopé à la lecture
> comme n'importe quelle table tenant, exportable dans un format standard, et sa durée de
> conservation est déclarée. Une action privilégiée qui ne laisse pas de trace est un défaut.

---

### F14 — Base légale et périmètre DSAR du dogfooding jamais posés `[Moyenne]`

**Écart.** AD-9 fait du dogfooding un élément d'architecture. Personne n'a posé sa base légale ni
son périmètre. Concrètement, `apps/console/lib/log-forward.ts:L41-L88` poste les logs serveur de la
console vers l'ingestion, sous `app_id = 'mip-rum-console'` (L21) — et `app/login/actions.ts:L105`
y envoie **l'adresse e-mail de l'utilisateur console** :

```ts
after(() => forwardLog("info", `connexion console (${u.role})`, { user: u.email }));
```

Ces personnes — salariés de l'éditeur, utilisateurs des clients — sont des personnes concernées à
part entière. Elles n'ont accès à **aucun** chemin DSAR : l'ancre du périmètre est
`rum_session.user_hash` (`lib/dsar.ts:L13`), et un utilisateur console n'a pas de `user_hash` ;
`rum_log`, la table qui les contient, est hors du périmètre TS (F10). Accessoirement,
`log-forward.ts:L11` porte encore un host en dur
(`https://mip-rum-console.vercel.app/api/ingest/v1/traces`) — un quatrième site de divergence
d'endpoint, non couvert par les `Binds` d'AD-4.

**AD-9 complété.**

> Le dogfooding est un **traitement** : il a une finalité déclarée, une base légale, un périmètre
> de données explicite et une durée. Les personnes qu'il observe — utilisateurs de la console
> compris — relèvent des mêmes droits d'accès et d'effacement que les visiteurs des sites clients,
> par le même chemin (AD-17). Aucune donnée directement identifiante n'entre dans la télémétrie de
> dogfooding sans que le registre de traitements ne la porte.

---

### F15 — Les rôles RGPD ne sont jamais qualifiés `[Élevée]`

**Écart.** Le spine parle de DPA, de sous-traitants et de RGPD, mais ne dit **jamais** qui est
responsable de traitement et qui est sous-traitant — ni pour le SaaS, ni pour le déploiement OEM,
ni pour le dogfooding. Or toute la chaîne d'obligations en découle : qui recueille le consentement
des visiteurs, qui répond aux DSAR, qui notifie une violation, qui signe le DPA et dans quel sens,
qui tient le registre de l'art. 30.

C'est particulièrement critique en OEM, où le produit est *installé chez le tiers* : l'éditeur
n'est alors plus sous-traitant du même traitement, et le DPA « modèle signable » de
`legal.ts:L52` ne s'applique plus dans le même sens. Le dépôt fait bien sa part côté SDK — le
`ConsentGate` (`packages/rum-sdk/src/consent.ts:L16`) et le respect de DNT/GPC
(`packages/rum-sdk/src/index.ts:L58-L70`, aucune collecte si opt-out signalé) sont un vrai acquis —
mais **rien ne dit à qui incombe le recueil du consentement**, ni ce qui se passe quand le client
ne l'a pas recueilli.

**AD nouveau — AD-19 : les rôles RGPD sont une propriété de l'architecture de déploiement.**

> **Binds :** le SaaS, le déploiement OEM/self-host, le dogfooding, le DPA, la documentation
> d'intégration, le SDK.
> **Prevents :** un DPA qui ne correspond à aucun déploiement réel, et une obligation (consentement,
> DSAR, notification) dont chaque partie croit qu'elle incombe à l'autre.
> **Rule :** chaque **enveloppe de déploiement** déclare explicitement le responsable de traitement,
> le ou les sous-traitants, et la partie qui porte le recueil du consentement, la réponse aux DSAR
> et la notification de violation. Le SDK expose les moyens de cette répartition (consentement,
> opt-out, minimisation) ; il ne présume jamais qu'elle a eu lieu. Un déploiement dont les rôles ne
> sont pas qualifiés n'est pas livrable.

---

### F16 — Notification de violation et AIPD entièrement absentes `[Moyenne]`

**Écart.** Deux dimensions RGPD n'apparaissent nulle part dans les 320 lignes du spine :

- **Art. 33/34 — notification de violation sous 72 h.** Aucun AD ne dit comment on *détecte* une
  violation de données (par opposition à une panne — c'est AD-9 qui couvre la panne), comment on
  en établit le périmètre (quels tenants, quelles personnes, quelles données — ce qui exige
  précisément le journal d'audit de F13 et la provenance de F8), ni qui notifie qui. Un acheteur
  grand compte inscrit ce délai au contrat ; il demandera la procédure.
- **Art. 35 — AIPD.** L'enregistrement de session (`replay_chunk` : contenu d'écran et parcours),
  le suivi comportemental systématique de visiteurs et l'analyse par LLM cochent plusieurs critères
  du CEPD. Le spine ne dit pas si une AIPD est requise, ni qui la conduit — question qui se pose
  différemment en SaaS et en OEM (cf. F15).

**AD-8 étendu, ou AD nouveau selon le découpage retenu.** AD-8 pose le bon principe — « aucune
obligation légale ne dépend d'un déclencheur dont on ne peut pas prouver qu'il a tourné » — mais
ne couvre que les **tâches planifiées**. À généraliser :

> Toute obligation légale assortie d'un **délai** — notification sous 72 h, réponse à une DSAR sous
> un mois, suppression à l'échéance de rétention — est adossée à un mécanisme dont on peut prouver
> le déclenchement et mesurer le délai tenu. La détection d'une violation de données, la
> détermination de son périmètre (tenants, personnes, catégories) et la chaîne de notification sont
> des capacités du produit, pas une procédure d'exploitation improvisée. Le besoin d'AIPD est
> tranché par enveloppe de déploiement (AD-19).

---

### F19 — La minimisation est tenue en fait, garantie par rien `[Moyenne — à porter au crédit]`

**Écart.** La promesse « aucune adresse IP stockée, à aucun étage » (Consistency Conventions) est
**vraie** : graft ne trouve aucun `x-forwarded-for` ni `remoteAddress` dans les 445 fichiers
indexés, et la géolocalisation est dérivée du fuseau horaire déclaré par le navigateur
(`packages/rum-sdk/src/index.ts:L86-L88` — `mip.tz`, commentaire « B1 : mapping tz -> geo_country,
zéro IP stockée »). Le scrub PII à l'ingestion existe
(`apps/ingest/supabase/functions/_shared/scrub.mjs`), et `scrubUrl` retire query et fragment
(`packages/rum-sdk/src/context.ts:L22-L24`).

C'est l'un des meilleurs arguments de conformité du produit — et le spine le range en **convention**,
au même rang que le nommage des migrations. Une convention n'est pas testée, ne casse rien, et
n'oppose rien à un adaptateur futur qui capterait une IP. Pour un dossier d'audit, la différence
entre « nous ne stockons pas d'IP » et « aucune IP ne *peut* entrer » est exactement la différence
entre une déclaration et une garantie.

**Promotion en invariant.**

> La minimisation est un invariant, pas une convention : la liste des catégories de données que le
> produit **refuse** de collecter (adresse IP en tête) est déclarée, et un test qui s'exécute dans
> la configuration expédiée (AD-11) échoue si l'une d'elles atteint le stockage, quel que soit
> l'adaptateur émetteur. Le scrub s'applique à l'ingestion, jamais en aval — un adaptateur ne peut
> pas le contourner en écrivant directement.

---

## Axe 4 — Secrets et surface d'attaque

### F17 — Zéro ligne sur les secrets dans 320 lignes de spine `[Élevée]`

**Écart.** Recherche exhaustive dans `ARCHITECTURE-SPINE.md` : aucune occurrence de *chiffrement*,
*encryption*, *au repos*, *at rest*, ni *rotation*. Le mot « secrets » n'apparaît qu'une fois, dans
les Consistency Conventions — « secrets fail-closed (AD-6) » — ce qui traite de leur *absence*,
jamais de leur gestion.

Le dépôt en compte au moins neuf, tous en variables d'environnement en clair :
`AUTH_SECRET` (`apps/console/lib/auth.ts:L26`), `CRON_SECRET`, `CONSOLE_API_TOKENS`,
`METRICS_TOKEN`, `ALERT_RELAY_TOKEN`, `OIDC_CLIENT_SECRET`, `MISTRAL_API_KEY`,
`ANTHROPIC_API_KEY`, `DATABASE_URL`. Deux d'entre eux sont des secrets de tenant
(`CONSOLE_API_TOKENS`, cf. F18). Un seul vit dans un coffre — `alert_email_api_key` dans
`vault.decrypted_secrets` (`migration-v50.sql`) — et l'en-tête de cette migration explique
justement pourquoi (« chiffré au repos, hors des sauvegardes en clair et des journaux »),
raisonnement qu'aucun autre secret ne reçoit. `notify_channel.target` stocke les URLs de webhook
Slack **en clair en base** (`migration-v49.sql`, assumé).

**Est-ce une omission acceptable à cette altitude ?** Non. Un spine décrit des frontières et des
invariants ; « où vit un secret » est une frontière (celle entre le code, la configuration, le
coffre et la base), et « comment on le remplace sans redéployer » est une propriété structurelle,
pas une tâche d'exploitation. La preuve par l'exemple est dans le dépôt : la révocation d'un jeton
`CONSOLE_API_TOKENS` **exige un redéploiement** — c'est une conséquence de conception, pas
d'exploitation. Et la question sera posée telle quelle en due diligence.

**AD nouveau — AD-20 : les secrets ont un domicile et un cycle de vie déclarés.**

> **Binds :** l'ingestion, la console, les tâches planifiées, l'alerting, le déploiement self-host,
> l'engagement de souveraineté.
> **Prevents :** le secret qu'on ne peut pas remplacer sans redéployer, celui qui survit en clair
> dans une sauvegarde ou un journal, et l'impossibilité de répondre à « que se passe-t-il si un
> secret client fuite ».
> **Rule :** tout secret a un domicile déclaré et un mécanisme de remplacement qui **n'exige pas de
> redéploiement**. Un secret par tenant est révocable individuellement et de façon immédiate.
> Aucun secret n'est stocké en clair là où il est lisible par une lecture applicative, une
> sauvegarde ou un journal ; ce qui doit l'être (une URL de webhook) est déclaré comme tel et
> justifié. Le chiffrement en transit et au repos est une propriété **déclarée** de l'enveloppe de
> déploiement, y compris en self-host — où elle ne peut pas être déléguée au fournisseur — et non
> une conséquence subie du choix d'hébergeur.

*Point à conserver au crédit :* le chiffrement en transit vers la base est correct et explicite
(`apps/console/lib/db.ts:L52` — `ssl: isLocal ? undefined : { rejectUnauthorized: true }`, avec
l'historique du dépinglage de CA commenté), et les comparaisons de secrets sont en temps constant
avec parcours complet anti-chronométrage (`lib/api/auth.ts:L52-L78`). Ces acquis méritent d'être
portés par l'invariant plutôt que laissés à la vigilance.

---

### F18 — Deux systèmes de jetons de lecture concurrents `[Élevée]`

**Écart.** Le produit expose deux surfaces de lecture machine-à-machine, chacune avec son propre
système de jetons, aux propriétés de sécurité **opposées** :

| | `read_tokens` (`/api/rum/*`) | `CONSOLE_API_TOKENS` (`/api/v1/*`) |
| --- | --- | --- |
| Stockage | Haché en base (`lib/queries-read-tokens.ts:L33-L39`) | **En clair**, variable d'env (`lib/api/auth.ts:L73`) |
| Portée | Scopé à une app à l'émission | **Toutes apps par défaut** (F4) |
| Révocation | Ligne en base, immédiate | **Redéploiement** |
| Émission | UI admin, tracée dans `audit_log` | Édition de configuration, non tracée |
| Affichage | Une seule fois (`app/admin/read-tokens/page.tsx`) | Persiste en clair dans la configuration |

Le second est celui que l'OEM et les partenaires utiliseront — le commentaire de `lib/api/auth.ts`
cite nommément « le front Angular MIP » et « un partenaire (ex. UTI) ». C'est donc la surface la
plus exposée qui porte le modèle le plus faible. AD-2 impose l'équivalence des **capacités** entre
console et API publique ; elle ne dit rien de l'équivalence des **contrôles**, et le résultat est
exactement l'asymétrie qu'AD-2 voulait empêcher, déplacée d'un cran.

**AD-2 resserré (second membre, cf. F4) + AD-20.** Un seul système d'identité machine, adossé au
registre, haché au repos, scopé à l'émission, révocable sans redéploiement et tracé dans le
journal d'audit (AD-18). Deux systèmes concurrents pour la même fonction sont un défaut, pas une
compatibilité ascendante.

---

## Axe 5 — Ce qu'un acheteur demandera et que le spine ne permet pas de produire

Liste des artefacts standards d'une due diligence sécurité chez un grand compte, confrontée à ce
que le spine rend **productible aujourd'hui**.

| Artefact demandé | Le spine permet-il de le produire ? | Verrou |
| --- | --- | --- |
| Matrice de contrôle d'accès (qui lit quoi, avec quel jeton, à quelle portée) | **Non** | F1, F3, F4, F18 — deux systèmes de jetons, portée par défaut totale, exceptions non énumérées |
| Rapport de pentest sur « un token de A ne lit jamais B » | **Non** | F1, F2 — le test existant choisit son rôle (AD-11 le dit) ; la propriété n'est portée par aucune configuration expédiée |
| Registre des traitements (art. 30) et liste de sous-traitants à jour | **Non** | F12 — sous-traitant hors UE non déclaré ; AD-7 ne couvre pas les sorties |
| DPA signable correspondant au déploiement réel | **Non** | F15 — rôles RGPD jamais qualifiés ; le DPA modèle ne vaut pas en OEM |
| Preuve de DSAR de bout en bout sur toutes les tables | **Non** | F10 — deux périmètres divergents, six tables hors couverture |
| Politique de rétention par finalité + preuve d'exécution | **Partiellement** | AD-8 prouve l'exécution ; F11 — le modèle ne sait pas exprimer des durées par finalité, `audit_log` non purgé |
| Politique de gestion et rotation des secrets | **Non** | F17 — dimension absente du spine |
| Journal d'audit scopé, inviolable, exportable | **Non** | F13 — pas d'`app_id`, pas de rétention, absent du spine |
| Procédure de notification de violation sous 72 h | **Non** | F16 — dimension absente ; dépend aussi de F8 (périmètre d'un incident) et F13 |
| AIPD / analyse d'impact | **Non** | F16 — le replay de session est pourtant un candidat manifeste |
| RPO/RTO chiffrés et restauration testée | **Oui** | **AD-14** — le seul artefact de cette liste que le spine couvre pleinement |
| Réversibilité / export tenant sans frais de sortie | **Oui, pour l'export** | AD-14 ; mais F8 — la réversibilité *par lot* d'AD-5 est irréalisable |
| Localisation des données et sous-traitants d'hébergement | **Oui, une fois AD-7 appliqué** | AD-7 corrige le défaut réel (Supabase/Paris déclaré vs Neon/Francfort effectif) |
| Licence et frontière open-core | **Non** | Le spine le classe en *Deferred* et note l'absence de `LICENSE` — bloquant pour toute vente OEM |

**Trois questions que le premier acheteur posera et auxquelles rien ne répond aujourd'hui :**

1. « Montrez-moi la trace de qui a accédé aux données de mon tenant le mois dernier. » → F13.
2. « Un de vos autres clients est compromis : qu'est-ce qui garantit que mes données n'ont pas été
   lues ni polluées ? » → F1, F2, F7.
3. « Votre clé d'API est dans le HTML de mon site. Qu'est-ce qui empêche mon concurrent de la
   copier et de fausser mes métriques ? » → F5, F7, F8. C'est la question qui tue la démonstration,
   et AD-5 est aujourd'hui la *bonne réponse mal spécifiée* : les quatre couches sont le bon
   raisonnement, mais aucune n'est encore un contrôle.

---

## Ce qui existe et que le spine sous-vend

À ne pas perdre dans le durcissement : le dépôt porte déjà des acquis de conformité réels, que le
spine range en conventions ou ne mentionne pas. Chacun mérite d'être promu en propriété opposable,
adossée à un test en configuration expédiée (AD-11).

- **Zéro adresse IP, à aucun étage** — vérifié exhaustivement (F19).
- **Scrub PII à l'ingestion**, en amont du stockage, avec `scrubUrl` retirant query et fragment.
- **Consentement et signaux d'opt-out** — `ConsentGate` avec rejeu à `consent(true)` et purge à
  `consent(false)` ; DNT/GPC honorés par défaut, aucune session créée ni requête émise en cas de
  refus (`packages/rum-sdk/src/index.ts:L58-L70`).
- **Rétention par tenant** effectivement implémentée et testée (`scripts/verify-conformite.mjs`).
- **DSAR** : export, effacement, comptage préalable, transaction tout-ou-rien, allowlist de tables
  en constantes anti-injection.
- **RLS écrite, correcte et fail-closed** — `current_app_ids()` rend un tableau vide sans GUC,
  donc zéro ligne visible ; les tables filles sont scopées via leur parent. Elle est inerte, mais
  elle est *juste*, et `migration-v47` documente honnêtement ses trois verrous ouverts.
- **`console_ro` réellement restreint** en écriture par `migration-v48`, sur une liste relevée du
  code et non devinée.
- **Fail-closed exemplaire sur le cron** (`assertCronAuth`, 503 sans secret) — le modèle à
  généraliser par AD-6.
- **Comparaison de secrets en temps constant** avec parcours complet anti-chronométrage.
- **Journal d'audit en ajout seul par les droits** (`select, insert` uniquement).
- **TLS vérifié vers la base** hors développement local.

Le problème du spine n'est pas de décrire un produit peu mûr. C'est qu'à sa lecture, un auditeur ne
peut pas distinguer ces acquis — solides — de ce qui n'existe que dans l'intention. C'est cet écart,
et lui seul, que les AD ci-dessus referment.

---

## Récapitulatif des AD à créer ou resserrer

| AD | Nature | Ce qu'il ferme |
| --- | --- | --- |
| **AD-2** | Resserré | L'équivalence porte aussi sur les contrôles d'accès ; refus explicite, jamais repli silencieux (F4, F18) |
| **AD-3** | Resserré ×2 | Mécanisme d'inaccessibilité nommé et testé (F1) ; registre des chemins trans-tenants (F3) |
| **AD-4** | `Binds` élargi | Le socle CORS d'ingestion et `log-forward` sont des sites de host en dur (F6, F14) |
| **AD-5** | Resserré ×3 | Contrôle serveur par profil d'émetteur (F5) ; allowlist strictement par app (F6) ; anomalie de forme et quarantaine (F7) |
| **AD-6** | Resserré | Actif par défaut : un contrôle éteint par configuration est traité comme absent (F9) |
| **AD-7** | Resserré | Couvre toute sortie vers un tiers, pas seulement l'infrastructure ; placeholders légaux bloquants (F12) |
| **AD-8** | Étendu | Généralisé à toute obligation légale assortie d'un délai, pas seulement aux tâches planifiées (F16) ; durées par finalité (F11) |
| **AD-9** | Complété | Le dogfooding est un traitement : finalité, base légale, périmètre, droits (F14) |
| **AD-15** | **Nouveau** | Le tenant fait partie de l'identité, pas des filtres (F2) |
| **AD-16** | **Nouveau** | Toute écriture d'ingestion porte sa provenance ; purge par lot testée (F8) |
| **AD-17** | **Nouveau** | Registre unique des données personnelles ; export, effacement et purge en sont dérivés (F10, F11) |
| **AD-18** | **Nouveau** | Le journal d'audit est une frontière : scopé, en ajout seul, exportable, à durée déclarée (F13) |
| **AD-19** | **Nouveau** | Les rôles RGPD sont une propriété de l'enveloppe de déploiement (F15) |
| **AD-20** | **Nouveau** | Les secrets ont un domicile et un cycle de vie déclarés ; chiffrement déclaré, y compris en self-host (F17, F18) |
| — | Promotion | La minimisation passe de convention à invariant testé (F19) |
