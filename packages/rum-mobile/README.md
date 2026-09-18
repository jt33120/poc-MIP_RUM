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

P7.3 ajoute la **navigation**, les **interactions**, la **fenêtre causale**, les
**rejets de promesses**, la **mesure de démarrage JS** — et **change le défaut de
`traceOrigins`** : [lire la migration](#migration-v02--v03--traceorigins-est-une-liste-fermée)
**avant** de mettre à jour.

P7.4 (v0.4) ajoute la **déclaration de capacités** : le SDK dit au serveur, à
chaque envoi, ce qu'il collecte et ce qu'il ne collecte pas. C'est ce qui permet
à l'écran `/mobile` d'afficher « Non collecté » au lieu de `0` — voir
[Capacités déclarées](#capacités-déclarées-p75). Aucun changement d'API : rien
à faire pour en bénéficier.

> **Versions réellement exercées : [MATRICE-RUNTIME.md](MATRICE-RUNTIME.md).**
> Aucune plage de compatibilité React Native n'est déclarée, parce qu'aucune
> version réelle de React Native n'a été exécutée. Ce n'est pas une omission,
> c'est le refus d'extrapoler un test sous doubles vers un moteur, un bundler et
> un système d'exploitation que personne n'a lancés.

> ## Migration v0.2 → v0.3 — `traceOrigins` est une liste fermée
>
> **Avant**, `traceOrigins: []` (ou l'option absente) propageait `traceparent` et
> `tracestate` vers **toutes** les origines appelées par l'application, sauf
> l'endpoint de collecte. **Désormais, une liste vide ne propage vers rien.**
>
> **Pourquoi.** `tracestate` transporte l'identifiant de **session** et
> `traceparent` l'identifiant de **trace**. Les envoyer à une régie publicitaire,
> à un fournisseur de cartes ou à une passerelle de paiement leur donne de quoi
> relier leurs propres journaux à la visite en cours. Aucun consentement recueilli
> pour de la mesure d'audience ne couvre cela, et personne ne l'avait demandé :
> c'était le défaut.
>
> **Ce que vous devez faire.** Si vous utilisiez la corrélation mobile → backend,
> **déclarez vos origines** :
>
> ```diff
>   RUM.init({
>     endpoint: "https://<ingest>/v1/traces",
> -   // rien : le traceparent partait partout
> +   traceOrigins: ["https://api.exemple.fr", "https://auth.exemple.fr"],
>   });
> ```
>
> Chaque entrée doit être une **origine absolue** (`schéma://hôte[:port]`) ; une
> URL complète est acceptée, seule son origine est retenue. Une entrée mal formée
> est **refusée** avec un avertissement unique au démarrage — depuis que le défaut
> ne propage plus rien, l'ignorer en silence couperait la corrélation d'un client
> qui croit l'avoir demandée.
>
> **Ce qui ne change pas.** Les spans `http.client` restent émis pour **tous** les
> appels hors endpoint : mesurer la latence d'un appel tiers n'expose rien à ce
> tiers. Seuls les **en-têtes sortants** sont concernés. L'endpoint de collecte
> reste exclu même s'il figure dans la liste — une requête d'ingestion tracée
> produirait un span, qui produirait une requête.

## Installation & init — React Native **bare**

> L'exemple ci-dessous est celui d'un projet **React Native bare** : les modules
> cités (`Platform`, `AppState`, `AsyncStorage`, la référence du conteneur de
> navigation, le module de suivi de rejets) sont ceux que l'application possède
> déjà, et c'est elle qui les résout. Le SDK n'en importe **aucun**.
>
> **Expo n'est pas documenté ici, parce qu'il n'a pas été testé.** Rien ne s'y
> oppose *a priori* — le paquet est du JavaScript sans dépendance native — mais
> « rien ne s'y oppose » n'est pas « vérifié », et seule la seconde formule a sa
> place dans une documentation d'intégration. Voir
> [MATRICE-RUNTIME.md](MATRICE-RUNTIME.md).

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
  // LISTE FERMÉE : ce qui n'y figure pas ne reçoit aucun en-tête de trace.
  traceOrigins: ["https://api.exemple.fr"],
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

    // P7.3 — navigation : les callbacks PUBLICS de votre routeur.
    navigation: RUM.navigationDepuisRouteur(refConteneur),

    // P7.3 — rejets de promesses non gérés. C'est VOTRE module, vous le
    // résolvez ; le SDK ne fait aucun `require` (voir plus bas).
    unhandledRejection: RUM.rejetsDepuisTracker(
      require("promise/setimmediate/rejection-tracking"),
    ),
  },

  // P7.2 — file hors ligne. `persistent` reste FAUX par défaut : voir plus bas.
  offline: { persistent: false, maxEvents: 500, maxBytes: 1_048_576, ttlMs: 86_400_000 },
});

// Réponse de l'utilisateur à l'écran de consentement.
RUM.consent(true);
```

## Ce qui est capté (v0.3)

| Signal | Comment | Table |
| --- | --- | --- |
| **Erreurs JS non interceptées** | handler global `ErrorUtils`, fatalité **déclarée** | `rum_error` (`kind=crash`) |
| **Rejets de promesses** | `adapters.unhandledRejection` ou événement standard | `rum_error` (`kind=unhandledrejection`) |
| **Erreur déclarée** | `RUM.addError(e, ctx?, { fingerprint }?)` | `rum_error` |
| **Écrans** | `adapters.navigation`, ou `RUM.screen("Accueil", key?)` | `rum_pageview` |
| **Vue nommée** | `RUM.startView("Checkout", ctx?)` | `rum_event` (`view`) |
| **Action déclarée** | `RUM.addAction("Payer", ctx?)` | `rum_event` + `rum_action` (`manual`) |
| **Appui instrumenté** | `RUM.instrumentPressable({ mipActionName, onPress })` | `rum_event` + `rum_action` (`click`) |
| **Timing** | `RUM.addTiming("prete")` | `rum_event` (`timing`) |
| **Démarrage JS** | `RUM.markFirstScreenRendered()` | `rum_event` (`timing`) |
| **Feature flag** | `RUM.addFeatureFlagEvaluation("nom", true)` | `rum_event` (`feature_flag`) |
| **Réseau** | patch `fetch` + `traceparent` vers `traceOrigins` | `rum_span` (front) |
| **Événements** | `RUM.track("checkout", { amount: 42 })` | `rum_event` (`custom`) |

### Navigation : les callbacks publics du routeur

`adapters.navigation` reçoit les notifications du routeur et **dédoublonne** : un
même écran — ou une même **clef de route** — ne produit pas deux pages vues parce
qu'un callback s'est répété. Un routeur notifie son état plusieurs fois pour une
seule transition (conteneur, puis chaque pile imbriquée) ; sans dédoublonnage,
toutes les métriques par écran seraient fausses dans ce rapport.

```ts
import { createNavigationContainerRef } from "@react-navigation/native";
const refConteneur = createNavigationContainerRef();
// init({ adapters: { navigation: RUM.navigationDepuisRouteur(refConteneur) } })
<NavigationContainer ref={refConteneur}>…</NavigationContainer>
```

`navigationDepuisRouteur` ne lit que trois membres publics —
`addListener("state")`, `getCurrentRoute()` et `isReady()` — et n'importe
**aucune** bibliothèque : c'est votre référence que vous passez. Pour tout autre
routeur, `RUM.screen(nom, clefFacultative)` fait la même chose à la main, avec le
même dédoublonnage.

> `A → B → A` produit bien **trois** pages vues : le dédoublonnage ne compare
> qu'à l'écran **courant**, jamais à l'historique. Un retour en arrière est une
> nouvelle consultation. En revanche, `screen("A")` appelé deux fois de suite
> n'en produit qu'une — **changement par rapport à la v0.2**, où la seconde
> passait.

### Interactions : nom déclaré, jamais le texte affiché

```tsx
<Pressable {...RUM.instrumentPressable({
  mipActionName: "checkout.payer",          // OBLIGATOIRE — sinon rien n'est fait
  accessibilityLabel: "Payer la commande",  // préservée telle quelle
  onPress: payer,
})} />
```

Le nom est **déclaré**, jamais extrait des `children`. Sur mobile, le libellé
d'un bouton est très souvent une **donnée** — « Payer 128,40 € », « Appeler
Marie D. », « Supprimer mon compte » — et le lire l'enverrait dans un champ de
télémétrie que personne ne relit avant l'envoi. Le SDK ne l'évalue même pas :
les props sont recopiées **par descripteurs**, pas par `{...props}`.

Sans `mipActionName` ou sans `onPress`, les props sont rendues **à l'identique**
(le même objet). L'appel d'origine est préservé : arguments, `this`, valeur
rendue et **exceptions**, qui remontent inchangées. Le gestionnaire enveloppé est
mémorisé — un même `onPress` rend le même wrapper, sans re-rendu par frame.

### Fenêtre causale

Une action — `addAction` ou un appui instrumenté — ouvre une fenêtre de **5 s**,
mesurée sur l'horloge monotone. Tout signal émis pendant cette fenêtre porte
`mip.action_id`. Ensuite, **plus rien** : un travail asynchrone démarré hors
fenêtre reste **non attribué**, et le SDK ne « devine » jamais le dernier clic.

Une **promesse rendue par `onPress`** est la seule prolongation : tant qu'elle
est en vol, la fenêtre est maintenue (plafond **30 s**), parce que cette promesse
est une preuve *observée* de causalité, pas une supposition. Son règlement
referme le maintien.

La fenêtre se ferme aussi à chaque **navigation** et à chaque **rotation
d'identité** : ce qui se passe sur l'écran suivant appartient à l'écran suivant.

**Une racine refusée ne laisse aucun orphelin.** Si le consentement ou
`beforeSend` rejette l'action, ou si elle tombe de la file (capacité, TTL, refus
définitif du serveur), les signaux qu'elle a causés perdent leur `mip.action_id`
— un identifiant qui désigne une action absente de l'ingestion est un lien cassé,
pas une information partielle.

### Démarrage : **JS**, et seulement JS

`RUM.markFirstScreenRendered()` émet `js_start_to_first_screen_ms`, mesuré depuis
**`init()`** jusqu'à cet appel — typiquement dans le `onLayout` du premier écran.

> Ce **n'est pas** un temps de démarrage d'application. Il ne contient ni le
> lancement du processus, ni le pré-main natif, ni l'écran de lancement, ni le
> chargement du bundle avant `init()`. Présenté comme « le démarrage », il
> mentirait d'un facteur inconnu, et toujours dans le même sens : il sous-estime.
> Le démarrage natif complet appartient à P8.5.

Après un retour au premier plan, le même appel émet
`js_warm_start_to_first_screen_ms`, mesuré depuis ce retour — nom **distinct**,
parce que les deux populations n'ont ni la même cause ni le même ordre de
grandeur. Une durée supérieure à **60 s** est refusée : ce n'est plus un
démarrage.

**Aucun ANR n'est déduit.** Un compteur JS ne sait pas distinguer un thread
principal bloqué d'une application qui n'a rien à faire. L'ANR est une mesure
native, et elle appartient à P8.5.

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
| `screen(name, key?)` | `void` | page vue, dédoublonnée sur l'écran courant |
| `instrumentPressable(props)` | props | opt-in via `mipActionName` ; sans lui, objet inchangé |
| `markFirstScreenRendered()` | `boolean` | démarrage **JS** ; `false` si déjà mesuré |
| `navigationDepuisRouteur(ref)` | adaptateur | à passer dans `adapters.navigation` |
| `rejetsDepuisTracker(module)` | adaptateur | à passer dans `adapters.unhandledRejection` |
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

## Erreurs JS : ce qui est collecté, et ce qui ne l'est pas

| Mécanisme | Collecté | `kind` | `is_fatal` |
| --- | --- | --- | --- |
| `ErrorUtils` (erreur JS non interceptée) | oui | `crash` | **déclaré** par le moteur |
| Rejet de promesse non géré | si un mécanisme est disponible | `unhandledrejection` | `false` |
| `RUM.addError(...)` | oui | `error` | `null` (inconnu) |
| **Crash natif** iOS/Android | **non** — hors couche JS | — | — |
| **ANR** | **non** | — | — |

Le handler précédent est **toujours** rappelé : la redbox, la remontée au natif
et la terminaison ne sont jamais masquées. Une erreur `ErrorUtils` **n'est pas**
un crash natif : sa source reste `react_native_js`, le processus natif survit, et
les compter ensemble produirait un taux de « sessions sans crash » qui ne décrit
ni l'un ni l'autre.

**Rejets non gérés — pourquoi un adaptateur.** Aucun moteur JS visé (Hermes, JSC)
n'expose de mécanisme standard **et retirable**. Celui de React Native passe par
le module de suivi livré avec son polyfill de promesses, dont l'activation est
**globale** et remplacerait la vôtre ; le SDK refuse de la poser lui-même, parce
qu'il ne pose que ce qu'il sait retirer. `rejetsDepuisTracker(module)` réduit le
branchement à un appel, avec **votre** module.

À défaut, le SDK utilise l'événement standard `unhandledrejection` **s'il existe**
sur l'objet global (sans `preventDefault` : la trace du moteur reste visible).
Il n'utilise **jamais** `process.on("unhandledRejection")` : sous Node, la seule
présence d'un écouteur supprime le comportement par défaut du runtime — collecter
ne doit pas faire survivre un processus que l'exploitant voulait voir mourir.

Quand rien n'est disponible, `getDiagnostics().jsCapabilities.unhandledRejection`
vaut `"unavailable"`. **Ce n'est pas « zéro rejet »** : toute surface qui lit cet
état doit afficher « non collecté ».

```ts
getDiagnostics().jsCapabilities
// { errorHandler, unhandledRejection, navigation, appStart } — "active" | "unavailable"
// null AVANT init. Grain FIN, propre au runtime : il décrit ce que la couche JS
// a pu installer. La déclaration envoyée au serveur, elle, est plus grossière —
// six noms et deux états. Voir ci-dessous.
```

## Capacités déclarées (P7.5)

Le SDK **transmet** à chaque envoi, sur la resource OTLP, ce qu'il collecte et ce
qu'il ne collecte pas. Le serveur valide contre un **vocabulaire fermé** — six
noms, deux états — et range la déclaration par app, runtime et release.

```ts
getDiagnostics().capabilities
// {
//   js_errors:           "active" | "unavailable",
//   native_crashes:      "unavailable",   // toujours
//   anr:                 "unavailable",   // toujours
//   native_start:        "unavailable",   // toujours
//   offline_persistence: "active" | "unavailable",
//   screen_tracking:     "active" | "unavailable",
// }
getDiagnostics().nativeCapabilities        // [] après init — un FAIT, pas une inconnue
getDiagnostics().nativeCapabilitiesReason  // pourquoi, en toutes lettres
```

**Pourquoi déclarer plutôt que laisser deviner.** Une console qui ne reçoit
aucun crash natif ne peut pas distinguer « cette application ne plante pas » de
« rien ne mesure ses plantages ». Les deux rendent zéro ligne. Le premier mérite
d'être annoncé ; le second est un angle mort — et c'est celui que ce SDK laisse
ouvert, en entier, pour tout ce qui est natif.

**Les trois capacités natives sont TOUJOURS `unavailable`, et ce n'est pas
configurable.** Aucun module natif MIP n'existe, ni pour iOS ni pour Android. Un
crash natif — signal POSIX, exception Objective-C, `SIGABRT`, ANR du watchdog
Android — n'est pas observable depuis le runtime JavaScript, qui en est la
première victime. Ajouter une option d'`init` ne les rendrait pas observables :
cela donnerait seulement le moyen de déclarer une collecte qui n'a pas lieu.

**Une capacité active n'est pas un test natif passé.** La déclaration dit ce que
le SDK croit avoir installé, sur la foi de son propre code. Elle ne dit pas qu'un
signal a été reçu, écrit et affiché. La console distingue les deux : la colonne
« Vérifié » ne se remplit que par une recette d'opérateur, jamais par ce que
le client envoie.

**Trois états côté console**, et la différence compte :

| En base | Sur l'écran `/mobile` | Ce que ça veut dire |
| --- | --- | --- |
| ligne `declared = true` | **Collecté** | une release déclare collecter ; les chiffres ont un sens |
| ligne `declared = false` | **Non collecté** | le SDK a regardé et n'a rien pu installer |
| aucune ligne | **Inconnu** | personne n'a rien dit (SDK antérieur à la v0.4) |

## Garanties

- **Zéro dépendance runtime et zéro peer dependency** : `@mip/rum-core` est
  *inliné* au build, l'artefact publié est autonome, et le paquet n'importe
  **ni** `react-native`, **ni** React, **ni** aucun routeur.
- **Aucune découverte de capacité à l'exécution.** Le repli historique
  `global.require("react-native")` a été **supprimé** : sous Metro,
  `global.require` n'est pas le `require` de CommonJS mais le résolveur interne du
  bundler, indexé par numéro de module. Il réussissait sur le poste du
  développeur et échouait en production, sans le signaler. Ce que l'application
  ne branche pas est **absent**, et `getDiagnostics()` le dit.
- **Aucun global DOM** dans le bundle — vérifié à chaque CI par
  `scripts/verify-sdk-packaging.mjs`, qui installe le paquet construit dans un
  consommateur isolé et interdit l'accès à `document`/`window`/`navigator`.
- **Best-effort** : émission asynchrone, hors chemin critique ; une erreur réseau
  ne casse jamais l'application. Le handler de crash **n'écrase pas** le
  comportement d'origine (redbox / remontée natif).
- **Souverain** : OTLP/HTTP JSON, backend remplaçable, données en UE.

## Ce qui n'est PAS là

> Périmètre v0.4 : **couche JS React Native**. Enveloppe, contexte, consentement,
> identité, transport, navigation, interactions, causalité, erreurs JS et
> déclaration de capacités.
>
> - **Crashes natifs** iOS/Android hors JS, **ANR** et **démarrage natif** : hors
>   couche JS, **non collectés**. Aucun badge « 100 % sans crash » ne peut être
>   dérivé de ce SDK — et il ne l'est pas : l'écran `/mobile` affiche
>   « Non collecté », et son taux porte le nom de ce qu'il mesure, « sessions
>   sans erreur JS ».
> - **Aucune matrice de compatibilité déclarée**, et le fichier qui le dit est
>   [MATRICE-RUNTIME.md](MATRICE-RUNTIME.md). Les adaptateurs
>   `navigationDepuisRouteur` et `rejetsDepuisTracker` sont éprouvés contre des
>   doubles conformes à la surface publique qu'ils consomment ; **aucune version
>   réelle** de React Native, de React, de Hermes, d'OS ou de routeur n'a été
>   exercée. La matrice se remplira par la recette sur appareil de P8.5.
> - **Aucune publication npm ni store.** Le paquet est `private: true`, il se
>   construit et s'installe (`scripts/verify-sdk-packaging.mjs` l'installe dans un
>   consommateur isolé, en CJS, en ESM et en types), mais **aucun registre cible
>   ni compte de publication n'a été décidé**. Publier exige ce choix : registre
>   public ou privé, nom définitif du paquet, politique de versions et de
>   dépréciation. Ce lot ne le suppose pas.
> - **Aucune recette sur appareil réel** : la couverture native reste « non
>   vérifiée » et appartient à P8.5. Aucun test sous Metro ni sur simulateur.
> - **`onLongPress` n'est pas instrumenté** : c'est un geste différent, et lui
>   donner le même nom que l'appui court fondrait deux intentions sous un seul
>   libellé.
