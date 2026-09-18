# @mip/rum-mobile — SDK MIP RUM pour React Native

RUM natif pour applications **React Native** : crashes, écrans, appels réseau et
événements métier, émis en **OTLP** vers MIP. Réutilise **toute la pipeline
existante** (ingestion, corrélation, console) — les données mobiles atterrissent
dans les **mêmes tables** que le web, avec `device_type = mobile`. Aucun
changement côté serveur.

Depuis la v0.2 (P7.1), les primitives de validation, de contexte et d'encodage
OTLP viennent de [`@mip/rum-core`](../rum-core/) : le mobile et le web appliquent
**la même** validation, **les mêmes** limites et **la même** précédence.

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
});
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

Une nouvelle session démarre au retour au premier plan (`AppState`) et lors d'un
changement d'identité. Le tracing réseau permet la corrélation **mobile →
backend** exactement comme sur le web (même `trace_id`, jointure avec l'agent
Node ou le middleware serveur).

## API

| Fonction | Retour | Note |
| --- | --- | --- |
| `init(options)` | `void` | idempotent |
| `screen(name)` | `void` | signal de navigation : page vue, pas une vue P2 |
| `track(name, props?, context?)` | `void` | retour historique conservé |
| `flushNow()` | `Promise<void>` | résolu même si l'envoi échoue |
| `setGlobalContext(ctx)` / `setGlobalContextProperty(k, v)` / `removeGlobalContextProperty(k)` / `clearGlobalContext()` / `getGlobalContext()` | — | contexte global |
| `setUser(id \| {id, …})` / `clearUser()` | `boolean` | `false` = entrée invalide |
| `setAccount(id \| {id, …})` / `clearAccount()` | `boolean` | `false` = entrée invalide |
| `startView(name, context?)` | `boolean` | ouvre la vue et l'émet |
| `addAction(name, context?)` | `boolean` | action déclarée, `type = manual` |
| `addTiming(name, timestamp?)` | `boolean` | relatif au début de la vue |
| `addFeatureFlagEvaluation(name, value)` | `boolean` | `null` devient `"null"` |
| `addError(error, context?, options?)` | `boolean` | erreur **gérée** |
| `getDiagnostics()` | objet | `null` = information inconnue de ce lot |

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
- `visitor_id` est un tirage **aléatoire** du lancement — jamais un identifiant
  publicitaire, d'appareil ou une empreinte matérielle. Sa persistance et le
  consentement arrivent au lot suivant.
- `beforeSend` n'est **pas** une garantie de confidentialité : le scrub serveur
  reste obligatoire et autoritaire à réception.

### `beforeSend`

Filtre PII de dernière chance, **synchrone**. Trois garde-fous :

1. les attributs **structurels** (session, visiteur, vue, action, trace,
   échantillonnage) sont restaurés après le hook — une application ne peut pas
   casser la corrélation de sa propre télémétrie ;
2. une **exception** du hook jette l'événement et compte un diagnostic, sans
   remonter dans l'application ;
3. une **Promise** est une entrée invalide, pas une attente : bloquer le thread
   UI pour un filtre PII n'est pas une option.

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

> Périmètre v0.2 : couche JS React Native, enveloppe et contexte.
>
> - **Consentement, file durable, transport avec retry et persistance offline**
>   ne sont pas implémentés : `getDiagnostics()` renvoie `null` — et non `0` —
>   pour tout ce qu'il ne peut pas encore savoir.
> - **Adaptateurs navigation / Pressable**, durcissement d'`ErrorUtils` et de la
>   propagation `fetch` : à venir. Par défaut, `traceOrigins: []` propage encore
>   le `traceparent` à **toutes** les origines sauf l'endpoint de collecte —
>   déclarer explicitement ses origines est recommandé dès aujourd'hui.
> - **Crashes natifs** iOS/Android hors JS, ANR et démarrage natif : hors couche
>   JS, non collectés. Une erreur `ErrorUtils` **n'est pas** un crash natif.
