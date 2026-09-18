# Livraison P7 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-runtime-parity-p7.md](spec-rum-runtime-parity-p7.md).
Base : `154936a` (P6 complet, v80), plus le correctif `origin/fix/rum-analytics-p6-6-plan-sans-fenetre` (PR #197)
sans lequel deux tests de `tests/unit/dashboards.test.ts` échouent pour une raison étrangère à P7.

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P7.1 — primitives pures et enveloppe RN | — | **aucune** | oui | oui | — | non | non |
| P7.2 — consentement, visiteur, transport | — | — | non | — | — | — | — |
| P7.3 — navigation, actions, erreurs JS | — | — | non | — | — | — | — |
| P7.4 — API Node et FastAPI | — | — | non | — | — | — | — |
| P7.5 — `/mobile`, API/MCP, distribution | — | — | non | — | — | — | — |

## P7.1 — primitives pures et enveloppe RN

Démarré le 18/09/2026 sur `feat/rum-runtime-p7-1`. **Aucune migration** : tout ce que le mobile émet désormais
(`mip.visitor_id`, `mip.context`, `mip.identity.*`, `mip.view_id`, `mip.action_id`, `mip.timing_ms`,
`mip.feature_flag_value`, `mip.error_fingerprint`) est déjà lu par l'ingestion depuis P2/P5/P6. Le sous-lot
n'ajoute aucune colonne et ne change aucune requête.

### Décisions d'implémentation

- **`packages/rum-core/` ne contient que ce qui sert à deux runtimes au moins.** Trois familles : le contexte
  d'événement (limites, validation, précédence, snapshot figé, identités), la couture `beforeSend`, l'encodeur
  OTLP. Les gates, horloges, stockages et patchs d'API restent des adaptateurs chez l'appelant : ce sont
  exactement les points qui diffèrent d'un runtime à l'autre.
- **L'absence de DOM est prouvée par le compilateur, pas par la relecture.** Le `tsconfig` du cœur n'inclut ni la
  lib `DOM` ni `@types/node` ; la seule surface ambiante autorisée (`TextEncoder`, `crypto`) est déclarée en
  toutes lettres dans `src/ambient.d.ts`. Même chose pour `@mip/rum-mobile`.
- **Aucun singleton dans le cœur.** `EventContextStore` est exporté comme CLASSE ; le web et React Native
  instancient chacun le leur. Un store partagé ferait fuir le contexte d'une application dans l'autre le jour où
  les deux cohabitent dans une WebView.
- **`exports` pointe sur `dist/`, jamais sur `src/`.** Les trois runtimes *inlinent* le cœur au build : leurs
  artefacts publiés ne contiennent aucun import résiduel vers `@mip/*` ni vers un fichier `.ts`.
  `scripts/verify-sdk-packaging.mjs` le vérifie, puis INSTALLE les paquets construits dans un consommateur isolé
  (CJS, ESM, et un `tsc` contre les `.d.ts`), avec un piège qui lève si le bundle RN touche
  `document`/`window`/`navigator`/`localStorage`.
- **`beforeSend` : une implémentation, deux contrats.** La restauration des attributs structurels est commune.
  L'ISOLATION (exception jetée au lieu de remonter, Promise traitée comme entrée invalide) est activée par un
  garde explicite que seul React Native fournit — le web garde son comportement historique, où l'exception d'un
  hook remonte à l'appelant. Changer cela silencieusement ferait disparaître, chez un client déjà intégré, une
  exception qu'il remonte peut-être à son propre outillage.
- **`mip.user_hash` n'est plus émis par le mobile.** C'était une empreinte de classe d'appareil, pas une
  identité : une session qui n'aurait qu'elle ne répond à aucune demande d'accès RGPD. Le champ reste dans le
  type `Ctx` (marqué déprécié) pour ne casser aucun appelant, mais il ne part plus sur le fil. L'ingestion
  continue de l'accepter des SDK déjà posés — le test de compatibilité v0.1 le prouve.
- **`screen` et `startView` restent deux signaux distincts**, comme sur le web : `screen` produit une page vue,
  `startView` ouvre une vue P2 nommée. Les émettre tous les deux depuis `screen` doublerait le volume
  d'événements des intégrations déjà en place.
- **`getDiagnostics()` distingue `0` de « inconnu ».** `queued` et `dropped` sont connus ; `retries`,
  `storageAvailable`, `consent` et `nativeCapabilities` valent `null` tant que P7.2/P7.5 ne les auront pas
  implémentés. Annoncer « 0 renvoi » sans transport avec retry serait faux.

### Écarts assumés

- **Le bundle web n'est pas identique à l'octet** : 22,00 Kio → 22,10 Kio gzip (+116 octets, +0,5 %), très en
  deçà du budget de 35 Kio. Une extraction réelle déplace du code ; exiger l'identité binaire reviendrait à
  interdire l'extraction. Le COMPORTEMENT et la SURFACE, eux, sont gelés par
  `tests/unit/rum-core-partage.test.ts` (liste d'exports figée, sémantique de `beforeSend` rejouée, budget mesuré
  sur l'artefact réellement livré).
- **`packages/agent-node/src/core.ts` est touché** (P7.4 est livré en parallèle) : ses fonctions `encodeAttrs` et
  `nanos` gardent leurs NOMS et leurs signatures, mais délèguent au cœur. `register.ts` n'est pas modifié.
  Effet de bord utile : l'ancienne `encodeAttrs` encodait un objet en `stringValue` — elle l'ignore désormais,
  comme les deux autres runtimes.
- **Le visiteur mobile est un tirage MÉMOIRE**, remis à zéro à chaque lancement. C'est le repli documenté
  (`identity_persistence=memory`) ; la persistance, le consentement et les adaptateurs arrivent en P7.2. Tant
  qu'elle n'est pas là, les compteurs de visiteurs mobiles surestiment les personnes.
- **`installFetchPatch`, `installAppState` et `ErrorUtils` ne sont pas durcis** : `traceOrigins: []` propage
  encore le `traceparent` à toutes les origines sauf l'endpoint, et la découverte d'`AppState` passe encore par
  `global.require`. C'est le périmètre explicite de P7.3 ; le README le signale déjà comme risque et recommande
  de déclarer ses origines.
- **Aucune recette sur appareil réel.** La couverture native (crashes natifs, ANR, démarrage) reste « non
  vérifiée » : elle appartient à P8.5.

### Preuves locales

| Preuve | Résultat |
|---|---|
| `pnpm test:unit` | 157 fichiers, 2078 tests verts (dont 20 `rum-mobile` et 10 `rum-core-partage`) |
| `pnpm --filter @mip/rum-sdk size-check` | `dist/mip-rum.js` 63,6 Kio brut / **22,1 Kio gzip** (budget 35 Kio) |
| `pnpm --filter console exec tsc --noEmit` | aucune erreur |
| `pnpm -r build` | 13 paquets, cœur construit avant les runtimes (ordre topologique pnpm) |
| `node scripts/verify-sdk-packaging.mjs` | 33 contrôles verts (étanchéité + mini-consommateur CJS/ESM/types) |
| `SQL_TEST_DATABASE_URL=… pnpm test:sql` | 19 fichiers, 235 tests verts — dont `rum-runtime-parity-sql` (3) |

Base de test jetable dédiée (`p71_rum_core` sur le PostgreSQL 15 local, port 5433), supprimée après la recette.
`DATABASE_URL` n'a jamais été utilisée.
