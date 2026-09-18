# @mip/rum-core — primitives pures des runtimes MIP RUM

Ce paquet ne contient que ce qui est **réellement utilisé par au moins deux
runtimes** et dont le résultat **ne dépend d'aucun environnement**.

| Primitive | Utilisée par |
| --- | --- |
| `EventContextStore`, `sanitizeContext`, `boundedName`, `CONTEXT_LIMITS`, `validateIdentity`, `newEnvelopeId` | web (`@mip/rum-sdk`), React Native (`@mip/rum-mobile`) |
| `applyBeforeSend`, `STRUCTURAL_ATTRIBUTES` | web, React Native |
| `encodeAttributes`, `toAnyValue`, `hrToNanos`, `msToHr`, `msToNanos`, `buildResourceSpans`, `kindPour`, `statutPour`, `SPAN_KIND`, `STATUS_CODE` | web, React Native, agent Node (`@mip/agent-node`) |

## Ce qui n'y entre pas, et pourquoi

Aucun import **DOM**, **React Native**, **module natif Node** ni **réseau**. Ce
n'est pas une règle de relecture : le `tsconfig` n'inclut ni la lib `DOM` ni
`@types/node`, et la seule surface ambiante autorisée est déclarée — en toutes
lettres — dans [`src/ambient.d.ts`](src/ambient.d.ts). Toute autre utilisation
échoue à la compilation.

Les **gates** de consentement, les **horloges**, le **stockage** et les **patchs
d'API** restent des adaptateurs chez l'appelant : ce sont précisément les points
qui diffèrent d'un runtime à l'autre, et les mutualiser reviendrait à faire
porter à un navigateur le comportement d'un téléphone.

Le paquet n'expose **aucun singleton**. Chaque runtime instancie son propre
`EventContextStore` : un store partagé ferait fuir le contexte d'une application
dans l'autre le jour où les deux cohabitent dans une WebView.

## Build et consommation

```sh
pnpm build:sdk                      # cœur PUIS runtimes, dans l'ordre topologique
pnpm --filter @mip/rum-core build   # esbuild -> dist/index.{js,mjs} ; tsc -> dist/*.d.ts
```

Un runtime ne se construit jamais seul : le suffixe `...` du filtre pnpm
(`pnpm --filter "@mip/rum-sdk..." build`) entraîne ses dépendances, donc ce
paquet. `pnpm build:sdk` le fait pour les trois d'un coup.

`exports` pointe sur `dist/`, jamais sur `src/` : un consommateur n'a jamais à
compiler du TypeScript qui ne lui a pas été publié. Les trois runtimes
**inlinent** ce paquet dans leur propre bundle — leurs artefacts ne contiennent
donc aucun import résiduel vers `@mip/*`, ce que vérifie
`scripts/verify-sdk-packaging.mjs`.

Les tests unitaires du dépôt résolvent `@mip/rum-core` vers sa **source** via un
alias Vitest : ils importent les SDK par chemin relatif, et exiger un build
préalable casserait `pnpm test:unit` sur un clone neuf. L'artefact publié, lui,
est vérifié par le mini-consommateur isolé du script ci-dessus.
