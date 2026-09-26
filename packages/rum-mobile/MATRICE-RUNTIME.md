# Matrice runtime de `@mip/rum-mobile` — ce qui a été RÉELLEMENT exercé

> **Résumé en une phrase : aucune plage de compatibilité React Native n'est
> déclarée, parce qu'aucune version réelle de React Native n'a été exécutée.**

Ce fichier existe pour dire ce qui a été exercé et ce qui ne l'a pas été. Il ne
dit pas « compatible RN 0.72 à 0.76 » : ce serait extrapoler d'un test sous
doubles vers un moteur, un bundler et un système d'exploitation que personne n'a
lancés. Une plage inventée coûte plus cher qu'une plage absente — elle se lit
comme une promesse, et elle se découvre fausse chez le client.

Dernière mise à jour : 18/09/2026, lot P7.5.

> **Note du 26/09/2026.** Le tableau ci-dessous est l'état du 18/09 : il n'a pas
> été réexécuté depuis. La CI a changé entre-temps (P1, 23/09/2026) : Node 24
> (`.nvmrc`, `engines` du `package.json` racine) au lieu de 26, et PostgreSQL 17
> au lieu de 15 (`.github/workflows/ci.yml`). Aucune version de React Native n'a
> été exécutée davantage : la phrase de tête reste vraie.

---

## 1. Ce qui a été exécuté

| Élément | Version exacte | Où |
| --- | --- | --- |
| Node.js | 26.0.0 (poste), 26.x (CI GitHub `ubuntu-latest`) | tests unitaires, intégration, empaquetage |
| pnpm | 9.15.9 (`packageManager`) | installation, build, filtres d'espace de travail |
| TypeScript | 5.9.3 | compilation des paquets et du consommateur isolé |
| esbuild | 0.28.0 | bundle CJS + ESM de `dist/` |
| Vitest | 4.1.8 | 2 279 tests unitaires, 284 tests d'intégration |
| Playwright | 1.60.0, Chromium | écran `/mobile` (console, pas le SDK) |
| PostgreSQL | 15.18 (conteneur aarch64) et 15 (service CI) | round-trip SDK → parseur → writer → tables |
| Système du poste | macOS 26.1 (arm64) | exécution locale |

## 2. Ce qui NE l'a PAS été

| Élément | État | Pourquoi |
| --- | --- | --- |
| React Native (toutes versions) | **non exercé** | aucune version n'est installée dans ce dépôt ; le paquet n'a ni dépendance ni peer dependency vers elle |
| React (toutes versions) | **non exercé** | `instrumentPressable` est une transformation props → props, elle n'importe pas React |
| Hermes | **non exercé** | aucun moteur Hermes n'a été lancé |
| JavaScriptCore | **non exercé** | idem |
| Metro (bundler) | **non exercé** | aucun bundle Metro n'a été produit ni exécuté |
| iOS (simulateur ou appareil) | **non exercé** | appartient à P8.5 |
| Android (émulateur ou appareil) | **non exercé** | appartient à P8.5 |
| Nouvelle architecture (Fabric / TurboModules) | **non exercé** | aucune architecture native n'a été chargée |
| Ancienne architecture (Paper) | **non exercé** | idem |
| React Navigation (toutes versions) | **non exercé** | voir § 3 |
| Expo (toutes versions) | **non exercé** | voir § 4 |
| `promise/setimmediate/rejection-tracking` | **non exercé** | voir § 3 |

## 3. Ce que les adaptateurs ont RÉELLEMENT vu

`navigationDepuisRouteur(ref)` et `rejetsDepuisTracker(module)` n'importent
aucun module : l'application passe SES objets. Ils ont été exercés contre des
**doubles** qui implémentent la surface publique qu'ils consomment, et rien de
plus :

| Adaptateur | Surface consommée | Double utilisé |
| --- | --- | --- |
| `navigationDepuisRouteur` | `addListener("state", cb)`, `getCurrentRoute()`, `isReady()` | objet littéral de `tests/unit/rum-mobile-p73.test.ts` |
| `rejetsDepuisTracker` | `enable({ allRejections, onUnhandled, onHandled })`, `disable()` | objet littéral de `tests/unit/rum-mobile-p73.test.ts` |
| `adapters.storage` | `getItem`, `setItem`, `removeItem` | magasin mémoire, avec variantes « disque plein » et « tronqué » |
| `adapters.lifecycle` | `subscribe(cb) → unsubscribe` | émetteur synchrone piloté par le test |
| `adapters.monotonicClock` | `nowMs()` | compteur déterministe |
| `ErrorUtils` | `getGlobalHandler()`, `setGlobalHandler()` | global stubé par le test |

**Un double conforme prouve le contrat, pas l'intégration.** Il prouve que le
SDK appelle les bons membres, dans le bon ordre, et qu'il retire exactement ce
qu'il a posé. Il ne prouve pas qu'une version donnée de React Navigation expose
`getCurrentRoute()` avec cette sémantique, ni que le module de suivi de rejets
livré avec une version donnée de React Native accepte cette forme d'appel.

## 4. Expo

**Non testé, donc non documenté comme prise en charge.** Le README ne donne
aucun exemple Expo, et c'est délibéré : la spec P7 demande de ne documenter Expo
que s'il est réellement testé. Rien ne s'oppose *a priori* à son fonctionnement —
le paquet est du JavaScript sans dépendance native — mais « rien ne s'y oppose »
n'est pas « vérifié », et seule la seconde formule a sa place dans une
documentation d'intégration.

## 5. Ce qui est vérifié à chaque CI, et qui compte

Ce n'est pas une matrice de versions, mais ce sont des garanties réelles, et
elles échouent si on les casse :

- **Le paquet CONSTRUIT s'installe** dans un consommateur isolé et s'y importe en
  CommonJS (chemin `react-native`/`main` de Metro), en ESM et en types
  (`tsc` contre les `.d.ts` publiés) — `scripts/verify-sdk-packaging.mjs`,
  36 contrôles.
- **Aucun global DOM n'est touché** : le consommateur pose des accesseurs qui
  lèvent sur `document`, `window`, `navigator` et `localStorage`.
- **Aucun import résiduel** vers `@mip/*` ni vers un fichier `.ts` dans `dist/`.
- **Aucune référence à `react-native`, `ErrorUtils` ou `AppState` dans le bundle
  WEB** : les trois runtimes restent étanches.
- **Le round-trip complet** — paquet réel → parseur OTLP → writer → PostgreSQL →
  lectures de la console — tourne sur une base réelle
  (`tests/integration/rum-runtime-parity-sql.test.ts`).

## 6. Comment cette matrice se remplira

Elle se remplira en P8.5, et par une recette sur appareil, pas par un test
supplémentaire dans ce dépôt. Ce qu'il faudra y consigner, cellule par cellule :
version de React Native, de React, moteur (Hermes ou JSC) et sa version, version
d'OS, routeur et sa version, architecture native (Fabric ou Paper), et le
résultat observé pour chaque signal — écran, appui, erreur JS, rejet, démarrage,
crash natif, ANR.

D'ici là, la couverture native reste **non vérifiée**, et l'écran `/mobile`
l'affiche : « Non collecté », jamais 0.
