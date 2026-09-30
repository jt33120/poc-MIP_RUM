# Intégrer MIP RUM

Au 30/09/2026. Ce guide s'adresse à l'équipe technique d'un client : il dit comment
faire marcher la mesure, du navigateur au serveur. Les détails (options, CSP,
consentement, routes…) sont en annexe, à la fin.

Toute la collecte arrive sur la console, `https://mip-rum-console.vercel.app/api/ingest/v1/`
(`traces`, `logs`, `replay`), qui la relaie au service `collector` (Railway,
`ingest_relay_pct` à 100 % depuis le 28/09/2026) et l'écrit elle-même si le relais
échoue. Pour le client, une seule adresse.

**La collecte directe, quand elle sera ouverte** (P6b.G : code prêt le 30/09/2026,
mise en service pas avant le 05/10/2026). Le navigateur du site écrit alors
directement au collecteur (`https://<collecteur>/v1/traces`, le rejeu sur `/v1/replay`),
qui déduit le **pays de l'adresse IP** du visiteur — le relais de la console ne la
transmet pas, et le pays n'y est qu'estimé d'après le fuseau horaire. La fiche du client
propose alors ce code par défaut, et garde le code par la console pour un site dont la
CSP fige `connect-src` (annexe C). Les agents serveur restent sur la console.

## 1. Créer l'application dans la console

1. **Administration → Clients → « Ajouter un client »** : un nom, un identifiant
   (`app_id` : minuscules, chiffres et tirets, par exemple `mon-application`) et les
   **domaines du site** (les origines autorisées à envoyer des mesures, pour le CORS,
   en liste blanche stricte : une origine absente n'est jamais acceptée par reflet).
2. À la validation, la console génère la **clé d'API**, affichée une seule fois. Posée
   dans une page, elle est lisible par tout visiteur : elle identifie le projet, elle ne
   protège rien.
3. Les domaines se modifient à tout moment depuis la fiche du client ; c'est pris en
   compte en 60 s au plus, sans redéploiement.

**La clé, exigée.** L'IaC du collecteur l'exige depuis le 29/09/2026
(`REQUIRE_API_KEY: "true"` dans `.railway/railway.ts`) : un lot sans clé ou avec une clé
fausse est refusé en 403, que le navigateur écrive par la console (le relais rend le 403
tel quel) ou directement au collecteur. Posez-la dans le snippet (`apiKey`) et côté
serveur (`mip.api_key`).

La fiche du client ouvre ensuite un guide en cinq étapes : vérifier la configuration,
poser le code de suivi, brancher le serveur, vérifier en direct, donner un accès au
client.

## 2. Navigateur

### Le snippet : tous les visiteurs

Deux balises dans le `<head>`, **avant tout autre script**. La fiche du client les donne
pré-remplies :

```html
<script src="https://mip-rum-console.vercel.app/mip-rum.js"></script>
<script>
  MIPRum.init({
    endpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
    appId: "mon-application",
    env: "prod",
  });
</script>
```

Ajouter l'option `apiKey` avec la clé du projet (§ 1).

**Collecte directe** (quand elle est ouverte, voir en tête) : la fiche donne le même code,
précédé de `<!-- MIP RUM — collecte directe (pays par l'adresse IP) -->`, avec
`endpoint: "https://<collecteur>/v1/traces"`. Le script reste servi par la console ; seul
l'envoi change d'adresse, et le rejeu suit (`/v1/replay`, dérivé par le SDK). Le site doit
alors autoriser l'origine du collecteur en `connect-src` s'il a une CSP (annexe C) ; si sa
CSP n'autorise que la console et ne peut pas changer, prendre le code « par la console »
de la même fiche : le pays y reste estimé.

- **HTML statique, Vite, CRA** : dans le `<head>` de `index.html`.
- **Next.js** : deux `<Script strategy="beforeInteractive">` dans `app/layout.tsx`
  (App Router), ou les balises dans `pages/_document.tsx` (Pages Router).
- **CMS, tag manager** : un tag « HTML personnalisé » déclenché sur toutes les pages.
- **Sans toucher au code** : la fiche du client génère une configuration Cloudflare
  Worker (qui injecte les balises et assouplit la CSP), nginx (`ngx_http_sub_module`)
  ou Google Tag Manager (qui ne corrige pas la CSP). Détails : annexe I.
- **Auto-hébergé** : `mip-rum.js` est un fichier unique (`packages/rum-sdk/dist/`), qui
  peut être servi depuis le domaine du site ; moins exposé aux bloqueurs, CSP plus
  simple (annexe C).

Rien d'autre à coder : Web Vitals, erreurs, sessions et appels réseau sont mesurés, et les appels vers la même origine portent l'en-tête `traceparent`
qui les relie au serveur (§ 3). Tout le reste est optionnel (annexe A).

### L'extension : sans toucher au site, pour les navigateurs qui l'ont

L'extension Chrome (MV3) injecte **le même SDK** sur les domaines enregistrés dans
`/admin/extension-scope`, une fois que l'utilisateur l'a autorisée d'un clic dans son
menu. Elle n'injecte rien si la page porte déjà le SDK (`window.MIPRum`).

**Sa limite** : elle ne mesure que les navigateurs où elle est installée (un pilote, un
parc de postes gérés, un site dont on n'a pas le code), jamais l'ensemble des visiteurs.
Pour une mesure exhaustive, c'est le snippet. Les deux écrivent dans les mêmes tables ;
la console les distingue (`collection_source` : `sdk` ou `extension`).

Collecte directe ouverte, l'extension vise elle aussi le collecteur : la résolution de
son domaine lui rend cette adresse, sans mise à jour de l'extension. Un domaine dont la
CSP n'autorise que la console garde la console si son point de collecte est déclaré
(`extension_scope.endpoint`, posé par l'équipe MIP).
Installation et déploiement : `apps/extension/README.md`, `docs/DEPLOY_EXTENSION.md`.

## 3. Serveur : l'agent OpenTelemetry officiel

MIP ne fournit aucun capteur serveur : le service tourne sous l'agent OpenTelemetry
**officiel** de son langage, configuré par des variables `OTEL_*`, et envoie traces et
journaux en OTLP/HTTP (protobuf ou JSON). Le socle commun, la commande par langage
(Python, Node, Java, .NET, Go, PHP, Ruby), ce qui a été éprouvé et les pièges :
**[`docs/capteurs-serveur.md`](capteurs-serveur.md)**. Compléments (débit, messages
d'échec, ce qui est écrit en base) : annexe J.

Étape facultative : sans elle, la mesure navigateur marche ; il manque seulement la part
serveur de chaque appel.

## 4. Vérifier que ça arrive

1. **La fiche du client**, étape « Vérifier » : la liste se met à jour toutes les 5
   secondes (premières Web Vitals, sessions sur 24 h, appels suivis depuis le
   navigateur, temps serveur). Ouvrir le site dans un autre onglet et la regarder
   passer au vert.
2. **Le navigateur du site** : `window.MIPRum` existe ; dans l'onglet Réseau, les
   `POST …/api/ingest/v1/traces` répondent 200 (en collecte directe : un `OPTIONS` puis
   des `POST …/v1/traces` vers le collecteur, en 204 puis 200).
3. **La console**, application sélectionnée : Vue d'ensemble, Sessions, Tracing, Erreurs.

## 5. Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Erreur CORS dans la console du navigateur | domaine absent des domaines autorisés | l'ajouter sur la fiche du client (60 s) |
| Collecte directe : « Refused to connect », violation CSP | la CSP du site n'autorise pas le collecteur en `connect-src` | l'y ajouter (annexe C), ou prendre le code « par la console » de la fiche |
| 403 `inactive app`, `ingestion suspended` | application désactivée ou suspendue | la réactiver (administration) |
| 403 `invalid api key`, `app requires an API key` | la collecte exige une clé, absente ou fausse | poser la bonne clé (`apiKey`, ou `mip.api_key` côté serveur) |
| 429 | plus de 600 requêtes par minute pour l'application | attendre (`retry-after: 60`) ; le SDK rejoue ses lots plus tard. Si ça dure : une boucle d'émission, `flushIntervalMs` à allonger ; côté serveur, annexe J |
| 413 | requête de plus de 2 Mo | réduire les lots (côté serveur : taille de lot de l'exportateur) |
| 415 | ni JSON ni protobuf, ou gRPC | côté serveur : `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| 200, mais rien dans la console | `appId` (ou, côté serveur, `mip.app_id`) absent : le lot est accepté puis ignoré | vérifier `appId` dans `MIPRum.init`, `OTEL_RESOURCE_ATTRIBUTES` côté serveur |
| Aucune requête, aucune erreur | refus de suivi du navigateur (DNT, GPC), consentement attendu (`requireConsent`), session hors échantillon, bloqueur de publicité, ou CSP qui bloque le script | annexes B, C, E ; tester avec `sampleRate: 1` ; servir le SDK depuis le domaine du site |
| INP ou CLS absents | ils se finalisent quand la page passe en arrière-plan | normal : ils arrivent quand l'utilisateur masque ou quitte la page |
| Appels du navigateur sans leur part serveur | API sur une autre origine, ou pas d'agent serveur | option `trace` du SDK (annexe A), CORS de l'API qui accepte `traceparent` et `tracestate`, § 3 |
| Agent serveur muet | voir les pièges par langage | `docs/capteurs-serveur.md` § 3, annexe J |

Joindre la collecte sans navigateur (un lot vide : rien n'est écrit) :

```sh
curl -s https://mip-rum-console.vercel.app/api/ingest/v1/traces \
  -H "content-type: application/json" -d '{"resourceSpans":[]}'
# attendu : {"partialSuccess":{}}
```

## 6. Pour aller plus loin

- Toutes les options du SDK, commentées : `packages/rum-sdk/src/types.ts`.
- Données personnelles, sous-traitants, rejeu : `docs/CONFORMITE.md`.
- Source maps (piles d'erreurs lisibles) : `docs/SOURCEMAPS.md`, `docs/integration/sourcemaps-ci.md`.
- Lire les données par API : `docs/RUM_READ_API.md`, `docs/API_CONSOLE.md`.
- Les anciens capteurs serveur maison (archivés) : `docs/archive/capteurs-serveur-maison.md`.

---

## Annexe A — Options de `MIPRum.init` et API du SDK

| Option | Défaut | Rôle |
|---|---|---|
| `endpoint` | (obligatoire) | adresse de collecte `…/api/ingest/v1/traces` |
| `appId` | (obligatoire) | l'identifiant de l'application |
| `clientId`, `env`, `release` | — | client, environnement, version (sert aux source maps) |
| `apiKey` | — | clé du projet, envoyée en attribut de ressource `mip.api_key` |
| `sampleRate` | 1 | part des sessions collectées en entier (annexe E) |
| `keepOnError`, `errorSampleRate` | `true`, 1 | hors échantillon, garder les sessions qui ont une erreur |
| `flushIntervalMs` | 3000 | intervalle d'envoi des lots |
| `slowResourceMs` | 300 | seuil d'une ressource lente |
| `requireConsent`, `honorDNT` | `false`, `true` | consentement et refus du navigateur (annexe B) |
| `beforeSend` | — | dernier filtre des attributs de chaque span ; `null` jette le span |
| `replay`, `replayMask`, `replayEndpoint` | `false`, `"all"` | rejeu de session : `true` ou un taux 0..1 ; masquage |
| `trace` | `true` | `traceparent` sur la même origine ; une liste ajoute d'autres origines |
| `captureErrors` | — | voies d'erreurs opt-in (annexe D) |
| `frustration`, `forms` | `true`, `true` | clics rageurs et morts ; formulaires champ par champ, sans les valeurs |
| `collectionSource` | `"sdk"` | `"extension"` quand l'extension injecte le SDK |
| `feedback` | `false` | bouton « Votre avis ? » (note de 1 à 5) |

Précisions :

- **`release`** : 1 à 120 caractères, sans caractère de contrôle, recopiée sur chaque
  signal ; au-delà, ignorée (« Inconnue »). C'est la clé des source maps.
- **`replayEndpoint`** : par défaut, `endpoint` dont `/v1/traces` devient `/v1/replay`.
- **`trace: false`** coupe le tracing, et avec lui la voie `network` de `captureErrors`.
- **`feedback`** accepte aussi un objet : `label`, `accent`, `offset`, `onlyPaths`,
  `exceptPaths`, `cooldownDays` (60 par défaut), `once`, `compact`, `compactBelow`,
  `discreet`. La note part en `MIPRum.track("feedback", { score })`.
- **`beforeSend(attrs, meta)`** : `meta` donne le type et le nom de l'événement. Le SDK
  restaure les champs structurels (session, application, trace, type, liaisons ; pour
  une erreur, sa voie et son lien vers l'appel) : un filtre peut masquer ou jeter, pas
  déplacer.

API : `MIPRum.consent(bool)`, `track(nom, props)`, `setUser` / `clearUser`,
`setAccount` / `clearAccount`, `startView(nom)`, `addAction(nom)`, `addTiming(nom)`,
`addFeatureFlagEvaluation(nom, valeur)`, `addError(erreur, contexte, { fingerprint })`,
`setGlobalContext` et ses variantes, `getErrorCollectionStats()`, `flush()`.

- `init` ne vaut qu'une fois : un second appel est ignoré.
- `track(nom, props)` émet un span `track.<nom>`, rangé dans les événements métier.
- `setUser` / `setAccount` : l'identifiant brut reste dans le navigateur et en transit ;
  la collecte le remplace par une empreinte HMAC-SHA256 propre à l'application avant
  toute écriture. Une identité différente, ou `clearUser()`, ouvre une nouvelle session
  sans changer de visiteur.
- **Contexte** : précédence `global < user/account < view < action < événement` ;
  noms et clés de 100 caractères au plus, chaînes de 500, profondeur 4, 64 clés, 16 Kio
  sérialisés. Les champs `mip.*`, de session, de trace et d'application sont réservés.
- `addError(…, { fingerprint })` : une clé opaque de 100 caractères au plus, sans
  donnée personnelle ; elle prime sur la pile pour regrouper les erreurs en une issue.
- **Actions** : chaque clic sur un élément interactif ouvre une action, nommée par
  `data-mip-action-name` (préférer un libellé métier stable, `checkout.submit`), sinon
  par un libellé accessible borné ; appels, ressources et erreurs des 5 s suivantes s'y
  rattachent. Les éléments marqués `data-mip-rum-ui` sont exclus. Si le libellé peut
  contenir une donnée personnelle, le réécrire (`mip.event_name`) dans `beforeSend`.

## Annexe B — Consentement et RGPD

- **`requireConsent: true`** : rien ne part tant que l'outil de consentement n'a pas
  appelé `MIPRum.consent(true)`, qui envoie alors ce qui attendait en mémoire.
  `MIPRum.consent(false)` purge ce qui attendait (mémoire, file de rejeu, erreurs
  compactées) et arrête la collecte. La fiche du client donne le snippet dans cette
  version.
- **`honorDNT: true`** (défaut) : si le navigateur signale un refus (Do Not Track ou
  Global Privacy Control), aucune collecte. `false` est réservé aux applications qui
  recueillent elles-mêmes un consentement affirmatif et pilotent `consent()`.
- **Rejeu** : `replayMask: "all"` (défaut) masque saisies, texte et médias ; `"media"`
  laisse le texte ; `"inputs"` ne masque que les saisies (tout ce que l'écran affiche est
  alors enregistré). Un bloc marqué `.mip-rum-block` n'est jamais capturé.
- **Formulaires** : identifiants de champ et durées seulement, jamais les valeurs.
- **Sans cookie** : la session vit dans `localStorage` (30 min d'inactivité) ; le
  visiteur est un tirage aléatoire, sans lien avec le terminal. Query strings et
  fragments des URL sont retirés par le SDK, puis de nouveau par la collecte.
- **Rétention** : 30 jours par défaut, réglable par application.
- **À la charge du client** : mentionner la mesure d'audience et de performance dans sa
  politique de confidentialité, et brancher `requireConsent` si sa CMP l'exige.
- Le détail (identifiant de visiteur, minimisation, droits des personnes,
  sous-traitants, hébergement) : `docs/CONFORMITE.md`.

## Annexe C — Politique de sécurité (CSP)

Autoriser `script-src https://mip-rum-console.vercel.app` (le script) et
`connect-src https://mip-rum-console.vercel.app` (la collecte). Autre possibilité,
recommandée : héberger `mip-rum.js` sur le domaine du site ; le rejeu charge alors
`mip-rum-replay.js` depuis la même origine que le script principal, à poser à côté. Le
Worker Cloudflare de la fiche client assouplit la CSP tout seul ; Google Tag Manager non.

Le bloc d'initialisation est un script en ligne : la CSP doit l'autoriser (un nonce,
`'unsafe-inline'`), sinon déplacer `MIPRum.init(…)` dans un fichier JavaScript du site.

```
Content-Security-Policy: script-src 'self' https://mip-rum-console.vercel.app; connect-src 'self' https://mip-rum-console.vercel.app;
```

**En collecte directe**, `connect-src` porte l'origine du **collecteur**, que la fiche du
client cite (au 30/09/2026 : `https://collector-production-d769.up.railway.app`) ; le
script, lui, reste servi par la console :

```
Content-Security-Policy: script-src 'self' https://mip-rum-console.vercel.app; connect-src 'self' https://collector-production-d769.up.railway.app;
```

Une CSP qui n'autorise que la console en `connect-src` et ne peut pas changer (politique
figée par un tiers, validation longue) : le code « par la console » de la fiche, qui
marche sans rien toucher ; le pays y reste estimé (fuseau horaire) ou « Inconnue », et
l'écran des sessions le dit (onglet « Pays estimé »).

## Annexe D — Collecte d'erreurs du navigateur

Les exceptions non interceptées et les promesses rejetées sont toujours collectées.
Les autres voies s'allument une à une (`captureErrors`), parce qu'elles peuvent changer
le volume d'une application du jour au lendemain. Chaque voie a son plafond d'erreurs
**distinctes** par page ; une même erreur répétée est comptée, et transmise au plus une
fois toutes les 10 s avec son nombre d'occurrences.

| Voie | Option | Ce qui est capté | Plafond par page |
|---|---|---|---|
| `uncaught` | toujours active | exceptions et promesses rejetées non interceptées | 50 |
| `console` | `captureErrors.console` | `console.error`, marquée gérée | 20 |
| `resources` | `captureErrors.resources` | échecs de chargement (image, script, feuille, média) | 20 |
| `csp` | `captureErrors.csp` | violations CSP, dédupliquées | 10 |
| `network` | `captureErrors.network` | échecs réseau, délais, réponses 5xx des appels suivis ; `{ clientErrors, aborts }` ajoute les 4xx et les abandons | 20 |

`MIPRum.getErrorCollectionStats()` rend, voie par voie, ce qui a été émis, tu par le
plafond ou refusé (`beforeSend`, consentement). Ces compteurs restent dans le navigateur.

Ce qui ne part jamais : query string, fragment, corps ni en-têtes d'un appel ou d'une
ressource ; l'extrait de code d'une violation CSP ; les valeurs des clés sensibles d'un
objet passé à `console.error`. La voie `network` n'observe que les appels suivis par le
tracing (même origine et origines de `trace`, 100 par page au plus), jamais la collecte
de MIP. `console.error(err)` suivi de `throw err` ne fait qu'un incident.

## Annexe E — Échantillonnage

`sampleRate` garde une part des sessions en entier ; par défaut (`keepOnError`), une
session hors échantillon n'envoie que ses erreurs, et passe en collecte complète à la
première. Ne pas l'abaisser sans raison de volume : la console repondère sessions, pages
vues, taux d'erreur et percentiles LCP et INP par la probabilité d'inclusion de chaque
session, et le dit (`sampling_notice` dans l'API), mais les visiteurs uniques, la
moyenne de chargement et les signaux de frustration ne se redressent pas : extrapoler un
compte de distincts demande une estimation de cardinalité, pas une somme de poids. Et
l'échantillon sur-représente les sessions en erreur, donc les plus lentes.

La probabilité d'inclusion n'est pas `1 / sampleRate` : une session sans erreur est
gardée avec la probabilité `sampleRate`, une session en erreur avec
`sampleRate + (1 − sampleRate) × errorSampleRate`. Les percentiles repondérés le sont à
±1 % près (des seaux pondérés) : une résolution, pas un biais.

## Annexe F — Routes

- **Navigateur** : le SDK remplace dans le chemin les nombres, les UUID et les
  hexadécimaux de 16 caractères ou plus par `:id` (`/commandes/42` → `/commandes/:id`).
- **Serveur** : la route vient de l'agent (`http.route`), ramenée à la forme `:nom`
  (`docs/capteurs-serveur.md` § 4).
- **Règles propres à une application** : ce que le SDK ne reconnaît pas (slugs, dates,
  références) se normalise par des règles en expressions rationnelles POSIX (table
  `route_pattern`, la première qui correspond gagne), posées par l'équipe MIP et
  appliquées à l'écriture. `mip_apercu_backfill(app_id)` montre ce qu'une réécriture de
  l'historique toucherait ; `backfill_route_patterns(app_id)` la fait, sans retour.
- **Plafond** : 2 000 routes distinctes par application ; au-delà, une route inédite
  devient `(other)`, et l'écran de santé de l'administration le signale.

Une règle, par exemple :

```sql
insert into route_pattern (app_id, motif, remplacement, priorite)
values ('mon-application', '^/produit/[^/]+$', '/produit/:slug', 10);
```

L'ordre est `priorite`, puis `id` ; les règles ne s'enchaînent pas ; les groupes de
capture marchent (`\1`). La réécriture de l'historique est **irréversible** : la route
d'origine n'est gardée nulle part, d'où l'aperçu d'abord. Au plafond
(`app_registry.route_limit`), les routes déjà connues continuent de passer : la réponse
est d'écrire des règles, pas de relever le plafond.

## Annexe G — Ingestion différée (exploitant)

`INGEST_DEFERRED=true` fait acquitter la collecte (200) avant l'écriture : le lot est
déposé dans une table `UNLOGGED` (`ingest_raw`) et écrit ensuite par un travailleur.
Le prix : PostgreSQL vide cette table après un arrêt brutal, et un lot acquitté mais non
encore écrit est alors perdu, sans trace. Éteint par défaut ; `/health` du service dit
s'il est allumé (`ingest_deferred`).

Seul le `collector` le connaît (la route de la console écrit toujours avant de
répondre), et `.railway/railway.ts` ne le pose pas : éteint en production au 29/09/2026.
Mesuré par `scripts/bench-ingest.mjs` : p95 divisé par deux environ, débit multiplié par
2,5. `/admin/health` montre la file en attente, les lots abandonnés et l'âge du plus
vieux : c'est ce qu'un redémarrage emporterait.

## Annexe H — Poids et impact sur la page

- `mip-rum.js` : **22,6 Ko gzip** (64,7 Ko brut, build du 29/09/2026), sous le budget de
  35 Ko gzip que `packages/rum-sdk/build.mjs` fait respecter. Le rejeu est un second
  fichier (`mip-rum-replay.js`, 56,7 Ko gzip), chargé seulement si `replay` est allumé.
- Envoi par lots (toutes les `flushIntervalMs`), vidés par `sendBeacon` quand la page
  passe en arrière-plan : aucune requête bloquante pendant la navigation.
- Plafonds par page : 20 ressources lentes, 30 tâches longues, 50 fils d'Ariane, 50
  erreurs distinctes, plus ceux des voies d'erreurs (annexe D).

## Annexe I — Injection sans toucher au code

| Point d'injection | Corrige la CSP ? | À savoir |
|---|---|---|
| Cloudflare Worker (`HTMLRewriter`) | oui (`script-src`, `connect-src`) | le plus robuste ; suppose Cloudflare devant le site |
| nginx (`ngx_http_sub_module`) | à la main (`add_header`) | `sub_filter '</head>' …` et `proxy_set_header Accept-Encoding ""`, sinon un HTML compressé n'est pas réécrit |
| Google Tag Manager | non | chargement asynchrone : premières mesures (TTFB, FCP) parfois partielles |

Aucune de ces configurations n'embarque la clé d'API. Un site statique (Vercel, Netlify,
S3) n'a pas de proxy HTML à réécrire : Cloudflare devant le domaine, une injection au
build dans `index.html`, ou, le plus simple quand on a le code, les deux balises en dur.
Dans tous les cas, l'origine du site va dans les domaines autorisés (§ 1).

## Annexe J — Agents serveur : compléments

À lire avec `docs/capteurs-serveur.md`.

- **Endpoints.** `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` et `…_LOGS_ENDPOINT` sont pris
  tels quels (URL complète). `OTEL_EXPORTER_OTLP_ENDPOINT` reçoit, lui, `/v1/traces` et
  `/v1/logs` en suffixe : sur la console, il vaudrait
  `https://mip-rum-console.vercel.app/api/ingest`.
- **`OTEL_RESOURCE_ATTRIBUTES`** est une liste `clé=valeur` séparée par des virgules :
  une valeur qui contient une virgule, un `=` ou une espace s'encode en pourcentage.
- **Propagation.** Le défaut des agents est `tracecontext,baggage` (`OTEL_PROPAGATORS`) ;
  ne le changer qu'en gardant `tracecontext`. Sans navigateur, le
  `tracestate: mip=s:<session>` suffit à rattacher le span serveur à la session ; la
  console dit la session introuvable tant que le SDK web ne l'a pas envoyée.
- **Débit.** La limite (600 requêtes par minute) est par application, et chaque export
  est une requête. Un agent exporte les traces toutes les 5 s au plus
  (`OTEL_BSP_SCHEDULE_DELAY`) et les journaux toutes les secondes
  (`OTEL_BLRP_SCHEDULE_DELAY`) : jusqu'à ~72 requêtes par minute par processus actif.
  Pour un parc, allonger `OTEL_BLRP_SCHEDULE_DELAY` (5000), relever la limite de
  l'application, ou regrouper les lots par un Collector OpenTelemetry.
- **Succès et échec.** Un export réussi rend 200 (corps protobuf vide). La plupart des
  agents ne disent rien d'un succès ; un refus s'écrit dans leur journal, avec le statut :
  Java `WARN … HttpExporter - Failed to export …`, Python
  `Failed to export spans batch code: <statut>` (visible seulement si l'application a un
  gestionnaire `logging`), .NET dans `OTEL_DOTNET_AUTO_LOG_DIRECTORY`
  (`Export succeeded for …` quand tout va bien).
- **En base.** Un span `SERVER` porteur des attributs HTTP devient un span serveur
  rattaché à sa trace (et à la session par le `tracestate`) ; ses appels SQL et HTTP
  sortants, des spans de détail ; ses exceptions, et les journaux `ERROR` porteurs
  d'`exception.type`, des erreurs serveur (une panne, une occurrence :
  `docs/capteurs-serveur.md` § 4) ; les autres journaux, des lignes de journal.
- **.NET sous Windows** : le module PowerShell du même projet,
  `Register-OpenTelemetryForCurrentSession -OTelServiceName "<service>"`, après avoir
  posé les mêmes variables en `$env:…`.
- **Python avant 1.40.0** : les journaux de `logging` ne partent qu'avec
  `OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true`.
