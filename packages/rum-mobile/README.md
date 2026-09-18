# @mip/rum-mobile — SDK MIP RUM pour React Native

RUM natif pour applications **React Native** : crashes, écrans, appels réseau et
événements métier, émis en **OTLP** vers MIP. Réutilise **toute la pipeline
existante** (ingestion, corrélation, console) — les données mobiles atterrissent
dans les **mêmes tables** que le web, avec `device_type = mobile`. Aucun
changement côté serveur.

Depuis la v0.2 (P7.1), les primitives de validation, de contexte et d'encodage
OTLP viennent de [`@mip/rum-core`](../rum-core/) : le mobile et le web appliquent
**la même** validation, **les mêmes** limites et **la même** précédence.

P7.2 ajoute le **consentement**, le **visiteur d'installation** et un transport
qui ne retire un lot qu'**après acquittement** : hors ligne, la télémétrie
attend au lieu de disparaître.

## Installation & init

```ts
import RUM from "@mip/rum-mobile";
import { Platform } from "react-native";

RUM.init({
  endpoint: "https://<ingest>/v1/traces",
  appId: "mon-app-mobile",
  apiKey: "mip_…",
  env: "prod",
  appVersion: "1.2.3",
  platform: Platform.OS,          // 'ios' | 'android'
  osVersion: String(Platform.Version),
  traceOrigins: ["https://api.exemple.fr"], // où propager le traceparent
  beforeSend: (attributs) => attributs,     // filtre PII SYNCHRONE, facultatif

  // P7.2 — consentement. `false` par défaut pour ne pas éteindre une
  // intégration déjà en place ; une installation NEUVE devrait le mettre à true.
  requireConsent: true,
  initialConsent: "pending",                // 'pending' | 'granted' | 'denied'

  // P7.2 — points de contact avec la plateforme. Rien n'est découvert à
  // l'exécution : ce que l'application ne fournit pas est ABSENT, et
  // `getDiagnostics()` le dit.
  adapters: {
    storage: AsyncStorage,                  // { getItem, setItem, removeItem }
    lifecycle: { subscribe: (cb) => AppState.addEventListener("change", cb).remove },
  },

  // P7.2 — file hors ligne. `persistent` reste FAUX par défaut : voir plus bas.
  offline: { persistent: false, maxEvents: 500, maxBytes: 1_048_576, ttlMs: 86_400_000 },
});

// Réponse de l'utilisateur à l'écran de consentement.
RUM.consent(true);
```

## Ce qui est capté (v0.2)

| Signal | Comment | Table |
| --- | --- | --- |
| **Crashes / erreurs JS** | handler global `ErrorUtils` | `rum_error` |
| **Erreur déclarée** | `RUM.addError(e, ctx?, { fingerprint }?)` | `rum_error` |
| **Écrans** | `RUM.screen("Accueil")` | `rum_pageview` |
| **Vue nommée** | `RUM.startView("Checkout", ctx?)` | `rum_event` (`view`) |
| **Action** | `RUM.addAction("Payer", ctx?)` | `rum_event` + `rum_action` |
| **Timing** | `RUM.addTiming("prete")` | `rum_event` (`timing`) |
| **Feature flag** | `RUM.addFeatureFlagEvaluation("nom", true)` | `rum_event` (`feature_flag`) |
| **Réseau** | patch `fetch` + propagation `traceparent` | `rum_span` (front) |
| **Événements** | `RUM.track("checkout", { amount: 42 })` | `rum_event` (`custom`) |

### Session = visite, visiteur = installation

Une session est une **visite**. Elle tourne au lancement, après **30 minutes
d'inactivité** (`sessionInactivityMs`, borné à [1 min, 4 h]) et lors d'un
changement d'identité. Une bascule arrière-plan → actif de deux secondes n'en
ouvre **pas** une nouvelle : facturer une visite à chaque notification consultée
multiplierait artificiellement le nombre de sessions et ferait s'effondrer
toutes les métriques par session.

L'inactivité se mesure sur une horloge **monotone** (`adapters.monotonicClock`,
`performance.now()` par défaut) ; les horodatages restent en **UTC**. Une horloge
murale qui recule — fuseau, NTP, réglage manuel — ne peut donc produire ni
rotation fantôme, ni durée négative.

Le tracing réseau permet la corrélation **mobile → backend** exactement comme sur
le web (même `trace_id`, jointure avec l'agent Node ou le middleware serveur).

## API

| Fonction | Retour | Note |
| --- | --- | --- |
| `init(options)` | `void` | idempotent |
| `screen(name)` | `void` | signal de navigation : page vue, pas une vue P2 |
| `track(name, props?, context?)` | `void` | retour historique conservé |
| `flushNow()` | `Promise<void>` | résolu même si l'envoi échoue ; ne court-circuite pas un retrait en cours |
| `consent(granted)` | `void` | `false` purge mémoire **et** disque, synchronement |
| `shutdown()` | `Promise<void>` | flush borné puis retrait des hooks posés par MIP |
| `setGlobalContext(ctx)` / `setGlobalContextProperty(k, v)` / `removeGlobalContextProperty(k)` / `clearGlobalContext()` / `getGlobalContext()` | — | contexte global |
| `setUser(id \| {id, …})` / `clearUser()` | `boolean` | `false` = entrée invalide |
| `setAccount(id \| {id, …})` / `clearAccount()` | `boolean` | `false` = entrée invalide |
| `startView(name, context?)` | `boolean` | ouvre la vue et l'émet |
| `addAction(name, context?)` | `boolean` | action déclarée, `type = manual` |
| `addTiming(name, timestamp?)` | `boolean` | relatif au début de la vue |
| `addFeatureFlagEvaluation(name, value)` | `boolean` | `null` devient `"null"` |
| `addError(error, context?, options?)` | `boolean` | erreur **gérée** |
| `getDiagnostics()` | objet | `null` = information réellement inconnue, jamais `0` |

Aucune de ces fonctions ne lève dans l'application hôte : une entrée invalide
renvoie `false`.

### `screen` et `startView` ne sont pas la même chose

`screen` est le signal de **navigation** — l'équivalent mobile d'un changement
d'URL — et produit une page vue. `startView` ouvre une **vue nommée P2**, à
laquelle se rattachent `view_id`, les timings et les flags. Les émettre tous les
deux depuis `screen` doublerait le volume d'événements des intégrations déjà en
place ; le web garde exactement la même séparation.

## Identité et vie privée

- Les identifiants métier passés à `setUser`/`setAccount` restent **bruts en
  mémoire** et ne sont transportés que vers l'endpoint MIP, qui seul détient le
  secret HMAC **app-scopé**. Aucun secret de hachage n'est embarqué dans le SDK.
- `mip.user_hash` (ancienne empreinte de classe d'appareil du POC) n'est **plus
  émis** : ce n'était pas une identité personnelle, et une session qui n'aurait
  que lui ne répondrait à aucune demande d'accès RGPD.
- `visitor_id` est un identifiant **d'installation** : tirage aléatoire, persisté
  par `adapters.storage`, **app-scopé**. Jamais un identifiant publicitaire,
  d'appareil, un e-mail ou une empreinte matérielle — ces valeurs traversent les
  applications et survivent à la désinstallation, ce qu'aucun consentement ne
  couvre. Sans stockage disponible, il redevient un identifiant **mémoire** et
  `getDiagnostics().identityPersistence` vaut `"memory"`.
- Il n'est créé qu'**après** consentement lorsque celui-ci est requis : un
  identifiant d'installation tiré « au cas où » serait déjà une collecte.
- `beforeSend` n'est **pas** une garantie de confidentialité : le scrub serveur
  reste obligatoire et autoritaire à réception, et un **scrub portable** est
  appliqué avant toute écriture durable — identités brutes et clef d'API ne
  franchissent jamais le disque.

### `beforeSend`

Filtre PII de dernière chance, **synchrone**. Trois garde-fous :

1. les attributs **structurels** (session, visiteur, vue, action, trace,
   échantillonnage) sont restaurés après le hook — une application ne peut pas
   casser la corrélation de sa propre télémétrie ;
2. une **exception** du hook jette l'événement et compte un diagnostic, sans
   remonter dans l'application ;
3. une **Promise** est une entrée invalide, pas une attente : bloquer le thread
   UI pour un filtre PII n'est pas une option.

## Consentement, file et transport (P7.2)

| État | Réseau | Disque | Mémoire |
| --- | --- | --- | --- |
| `pending` | aucun | aucun | tampon borné à 200 événements |
| `granted` | oui | selon `offline.persistent` | file bornée |
| `denied` | aucun | **effacé** | **purgée** |

Une transition `granted → denied` purge **avant** tout nouvel `enqueue`, annule
la requête en vol quand le moteur l'autorise, et incrémente une **époque** : la
réponse d'un lot déjà parti ne peut plus rien réinjecter. Une requête **déjà
reçue** par le serveur n'est pas effaçable depuis le client — c'est la voie DSAR,
côté serveur, qui répond à cette demande-là.

**Acquittement avant retrait.** Un lot reste en file tant que le serveur ne l'a
pas acquitté. `408/425/429/5xx` et les erreurs réseau sont **rejoués** avec
retrait exponentiel et bruit, `Retry-After` **borné à 15 minutes** ;
`400/401/403` sont **abandonnés** — rejouer une clef refusée ne la fera pas
accepter — avec un diagnostic qui ne porte **qu'un statut**, jamais un corps de
réponse. Un événement rejoué **garde ses identifiants OTLP** : l'ingestion
applique ses `on conflict` au lieu de compter une seconde occurrence.

**La file est bornée** : 500 événements / 1 Mio par défaut, 1 000 / 2 Mio au
maximum, TTL 24 h, lots de 64 événements au plus, et un plafond mesuré sur le
**corps HTTP réel** (2 Mo côté ingestion). Au dépassement, les plus **anciens**
tombent et sont comptés. Un seul événement énorme est refusé à l'entrée : le
garder en évinçant tout le reste échangerait N événements utiles contre un seul
qui ne partirait pas davantage.

> ### `offline.persistent` est **désactivé par défaut**
>
> Son activation en **production** exige **P8.1** (effacement transactionnel
> côté serveur) : sans lui, une reprise de file pourrait réécrire des données que
> l'utilisateur vient de faire supprimer. Le SDK le rappelle une fois au
> démarrage lorsque l'option est activée. Tant que P8.1 n'est pas livré, cette
> option est destinée à la recette.

Quand elle est activée : écriture **versionnée**, atomique si l'adaptateur
déclare `capabilities.atomicWrite`, sinon deux emplacements alternés et un
manifeste écrit en dernier — une écriture interrompue laisse l'emplacement
précédent, intact. Une somme de contrôle détecte la troncature ; une file
illisible est **abandonnée**, jamais une exception dans l'application. La reprise
au démarrage n'a lieu qu'après **consentement**, et refuse tout enregistrement
dont l'`appId`, l'**époque** ou le **TTL** ne correspondent pas : la file de
l'application A ne peut pas partir dans B.

Un événement restauré ne porte **aucune identité brute**. Il est rattaché à une
personne seulement si le serveur connaît déjà sa session d'origine — jamais
reconstruit depuis l'utilisateur courant au lancement suivant.

## Garanties

- **Zéro dépendance runtime** : `@mip/rum-core` est *inliné* au build, l'artefact
  publié est autonome (`react-native` en peer optionnel, `AppState` chargé en
  `require` optionnel).
- **Aucun global DOM** dans le bundle — vérifié à chaque CI par
  `scripts/verify-sdk-packaging.mjs`, qui installe le paquet construit dans un
  consommateur isolé et interdit l'accès à `document`/`window`/`navigator`.
- **Best-effort** : émission asynchrone, hors chemin critique ; une erreur réseau
  ne casse jamais l'application. Le handler de crash **n'écrase pas** le
  comportement d'origine (redbox / remontée natif).
- **Souverain** : OTLP/HTTP JSON, backend remplaçable, données en UE.

## Ce qui n'est PAS encore là

> Périmètre v0.2 : couche JS React Native — enveloppe, contexte, consentement,
> identité et transport.
>
> - **Adaptateur navigation** : le type existe et `init` l'accepte, mais rien ne
>   s'y abonne encore. `screen()` reste la voie manuelle.
> - **Adaptateur Pressable / interactions**, durcissement d'`ErrorUtils` et de la
>   propagation `fetch`, mesure de démarrage JS : à venir. Par défaut,
>   `traceOrigins: []` propage encore le `traceparent` à **toutes** les origines
>   sauf l'endpoint de collecte — déclarer explicitement ses origines est
>   recommandé dès aujourd'hui.
> - **Capacités natives** (`getDiagnostics().nativeCapabilities`) restent `null` :
>   rien ne les observe encore.
> - **Crashes natifs** iOS/Android hors JS, ANR et démarrage natif : hors couche
>   JS, non collectés. Une erreur `ErrorUtils` **n'est pas** un crash natif.
> - **Aucune recette sur appareil réel** : la couverture native reste « non
>   vérifiée » et appartient à P8.5.
