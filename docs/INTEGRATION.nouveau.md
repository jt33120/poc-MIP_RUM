# Intégrer MIP RUM

Au 29/09/2026. Ce guide s'adresse à l'équipe technique d'un client : il dit comment
faire marcher la mesure, du navigateur au serveur. Les détails (options, CSP,
consentement, routes…) sont en annexe, à la fin.

Toute la collecte arrive sur la console, `https://mip-rum-console.vercel.app/api/ingest/v1/`
(`traces`, `logs`, `replay`), qui la relaie au service `collector` (Railway,
`ingest_relay_pct` à 100 % depuis le 28/09/2026) et l'écrit elle-même si le relais
échoue. Pour le client, une seule adresse.

## 1. Créer l'application dans la console

1. **Administration → Clients → « Ajouter un client »** : un nom, un identifiant
   (`app_id` : minuscules, chiffres et tirets, par exemple `mon-application`) et les
   **domaines du site** (les origines autorisées à envoyer des mesures, pour le CORS).
2. À la validation, la console génère la **clé d'API**, affichée une seule fois. Elle est
   facultative tant que la collecte ne l'exige pas (`REQUIRE_API_KEY=false` en production
   au 29/09/2026). Posée dans une page, elle est lisible par tout visiteur : elle identifie
   le projet, elle ne protège rien.
3. Les domaines se modifient à tout moment depuis la fiche du client ; c'est pris en
   compte en 60 s au plus, sans redéploiement.

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

Si la collecte exige une clé, ajouter l'option `apiKey` avec la clé du projet.

- **HTML statique, Vite, CRA** : dans le `<head>` de `index.html`.
- **Next.js** : deux `<Script strategy="beforeInteractive">` dans `app/layout.tsx`
  (App Router), ou les balises dans `pages/_document.tsx` (Pages Router).
- **CMS, tag manager** : un tag « HTML personnalisé » déclenché sur toutes les pages.
- **Sans toucher au code** : la fiche du client génère une configuration Cloudflare
  Worker (qui injecte les balises et assouplit la CSP), nginx (`ngx_http_sub_module`)
  ou Google Tag Manager (qui ne corrige pas la CSP).

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
Installation et déploiement : `apps/extension/README.md`, `docs/DEPLOY_EXTENSION.md`.

## 3. Serveur : l'agent OpenTelemetry officiel

MIP ne fournit aucun capteur serveur : le service tourne sous l'agent OpenTelemetry
**officiel** de son langage, configuré par des variables `OTEL_*`, et envoie traces et
journaux en OTLP/HTTP (protobuf ou JSON). Le socle commun, la commande par langage
(Python, Node, Java, .NET, Go, PHP, Ruby), ce qui a été éprouvé et les pièges :
**[`docs/capteurs-serveur.md`](capteurs-serveur.md)**.

Étape facultative : sans elle, la mesure navigateur marche ; il manque seulement la part
serveur de chaque appel.

## 4. Vérifier que ça arrive

1. **La fiche du client**, étape « Vérifier » : la liste se met à jour toutes les 5
   secondes (premières Web Vitals, sessions sur 24 h, appels suivis depuis le
   navigateur, temps serveur). Ouvrir le site dans un autre onglet et la regarder
   passer au vert.
2. **Le navigateur du site** : `window.MIPRum` existe ; dans l'onglet Réseau, les
   `POST …/api/ingest/v1/traces` répondent 200.
3. **La console**, application sélectionnée : Vue d'ensemble, Sessions, Tracing, Erreurs.

## 5. Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Erreur CORS dans la console du navigateur | domaine absent des domaines autorisés | l'ajouter sur la fiche du client (60 s) |
| 403 `inactive app`, `ingestion suspended` | application désactivée ou suspendue | la réactiver (administration) |
| 403 `invalid api key`, `app requires an API key` | la collecte exige une clé, absente ou fausse | poser la bonne clé (`apiKey`, ou `mip.api_key` côté serveur) |
| 429 | plus de 600 requêtes par minute pour l'application | attendre (`retry-after: 60`) ; le SDK rejoue ses lots plus tard |
| 413 | requête de plus de 2 Mo | réduire les lots (côté serveur : taille de lot de l'exportateur) |
| 415 | ni JSON ni protobuf, ou gRPC | côté serveur : `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| Aucune requête, aucune erreur | refus de suivi du navigateur (DNT, GPC), consentement attendu (`requireConsent`), session hors échantillon, ou CSP qui bloque le script | annexes B, C, E |
| Appels du navigateur sans leur part serveur | API sur une autre origine, ou pas d'agent serveur | option `trace` du SDK (annexe A), CORS de l'API qui accepte `traceparent` et `tracestate`, § 3 |
| Agent serveur muet | voir les pièges par langage | `docs/capteurs-serveur.md` § 3 |

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

API : `MIPRum.consent(bool)`, `track(nom, props)`, `setUser` / `clearUser`,
`setAccount` / `clearAccount`, `startView(nom)`, `addAction(nom)`, `addTiming(nom)`,
`addFeatureFlagEvaluation(nom, valeur)`, `addError(erreur, contexte, { fingerprint })`,
`setGlobalContext` et ses variantes, `getErrorCollectionStats()`, `flush()`.

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
- Le détail (identifiant de visiteur, minimisation, droits des personnes,
  sous-traitants) : `docs/CONFORMITE.md`.

## Annexe C — Politique de sécurité (CSP)

Autoriser `script-src https://mip-rum-console.vercel.app` (le script) et
`connect-src https://mip-rum-console.vercel.app` (la collecte). Autre possibilité,
recommandée : héberger `mip-rum.js` sur le domaine du site ; le rejeu charge alors
`mip-rum-replay.js` depuis la même origine que le script principal, à poser à côté. Le
Worker Cloudflare de la fiche client assouplit la CSP tout seul ; Google Tag Manager non.

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
plafond ou refusé (`beforeSend`, consentement).

## Annexe E — Échantillonnage

`sampleRate` garde une part des sessions en entier ; par défaut (`keepOnError`), une
session hors échantillon n'envoie que ses erreurs, et passe en collecte complète à la
première. Ne pas l'abaisser sans raison de volume : la console repondère sessions, pages
vues, taux d'erreur et percentiles LCP et INP par la probabilité d'inclusion de chaque
session, et le dit (`sampling_notice` dans l'API), mais les visiteurs uniques, la
moyenne de chargement et les signaux de frustration ne se redressent pas : extrapoler un
compte de distincts demande une estimation de cardinalité, pas une somme de poids. Et
l'échantillon sur-représente les sessions en erreur, donc les plus lentes.

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

## Annexe G — Ingestion différée (exploitant)

`INGEST_DEFERRED=true` fait acquitter la collecte (200) avant l'écriture : le lot est
déposé dans une table `UNLOGGED` (`ingest_raw`) et écrit ensuite par un travailleur.
Le prix : PostgreSQL vide cette table après un arrêt brutal, et un lot acquitté mais non
encore écrit est alors perdu, sans trace. Éteint par défaut ; `/health` du service dit
s'il est allumé (`ingest_deferred`).
