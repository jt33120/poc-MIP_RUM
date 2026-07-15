# @mip/rum-mobile — SDK MIP RUM pour React Native

RUM natif pour applications **React Native** : crashes, écrans, appels réseau et
événements métier, émis en **OTLP** vers MIP. Réutilise **toute la pipeline
existante** (ingestion, corrélation, console) — les données mobiles atterrissent
dans les **mêmes tables** que le web, avec `device_type = mobile`. Aucun
changement côté serveur.

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
});
```

## Ce qui est capté (v0.1)

| Signal | Comment | Table |
| --- | --- | --- |
| **Crashes / erreurs JS** | handler global `ErrorUtils` | `rum_error` |
| **Écrans** | `RUM.screen("Accueil")` | `rum_pageview` |
| **Réseau** | patch `fetch` + propagation `traceparent` | `rum_span` (front) |
| **Événements** | `RUM.track("checkout", { amount: 42 })` | `rum_event` |

Une nouvelle session démarre au retour au premier plan (`AppState`). Le tracing
réseau permet la corrélation **mobile → backend** exactement comme sur le web
(même `trace_id`, jointure avec l'agent Node ou le middleware serveur).

## API

- `RUM.init(options)` — démarre la collecte (idempotent).
- `RUM.screen(name)` — déclare l'écran courant + émet une vue.
- `RUM.track(name, props?)` — événement métier.
- `RUM.flushNow()` — force l'envoi des spans en attente.

## Garanties

- **Zéro dépendance** runtime (`react-native` en peer optionnel) — `AppState`
  chargé en `require` optionnel.
- **Best-effort** : émission asynchrone, hors chemin critique ; une erreur réseau
  ne casse jamais l'application. Le handler de crash **n'écrase pas** le
  comportement d'origine (redbox / remontée natif).
- **Souverain** : OTLP/HTTP JSON, backend remplaçable, données en UE.

> Périmètre v0.1 : couche JS React Native. Les modules **natifs** (crashes natifs
> iOS/Android hors JS, démarrage à froid) viendront enrichir la même pipeline.
