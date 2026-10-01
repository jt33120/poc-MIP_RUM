# Le film de présentation de la vitrine

État au 01/10/2026. Le film dure 1 min 29, en 1920 × 1080 à 30 images/s, avec une
musique. Il est déclaré dans `FILM_ACCUEIL` (`apps/console/lib/vitrine.ts`) et joué par
`apps/console/components/presentation/vitrine/FilmAccueil.tsx`.

**Depuis le 01/10/2026, ce film est aussi le film d'accueil** (`FILM_ACCUEIL`) : il
tourne en fond du premier écran, muet et en boucle, avec les commandes lecture et son.
Le premier clip de 15 s (`scripts/monter-film-accueil.mjs`) est retiré, et le bouton
« Voir le film » aussi (`FILM_PRESENTATION = null`) : un seul film. Quand il joue, les
voiles du haut et du bas se réduisent pour laisser lisibles ses titres et ses chiffres.

## Comment il est fait

Le film est animé avec [Remotion](https://www.remotion.dev) 4.0.532 (React), puis
encodé avec ffmpeg. Le projet Remotion (`video-mip-rum`) reste **hors du dépôt**, pour
qu'aucune dépendance ni aucun lockfile n'entre dans le monorepo : il est chez le
mainteneur, versionné en local. Seuls la vidéo finale et son affiche sont versionnées
ici. Le projet contient :

- une composition par scène (`src/scenes/S0Ouverture.tsx` … `S8Fin.tsx`), assemblées par
  `src/Film.tsx` (`TransitionSeries`) ;
- les polices variables Inter, Inter Tight et JetBrains Mono (SIL OFL 1.1), copiées
  localement : le rendu ne dépend pas du réseau ;
- deux outils Python (`outils/suivre-ecran.py`, `outils/detourer-telephone.py`). Le
  premier suit image par image l'écran vert d'un plan de téléphone ; le second le
  détoure en vidéo à couche alpha. L'écran de la boutique fictive y est posé en
  perspective, sous le pouce ;
- `CREDITS.md` : les plans réels et la musique, avec leur source et leur licence.

Pour refaire le film, depuis ce projet :

```sh
npx remotion render FilmPresentation out/film-presentation-maitre.mp4 --codec=h264 --crf=16 --concurrency=3
# version web : H.264, crf 23, lecture progressive
ffmpeg -i out/film-presentation-maitre.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -profile:v high -c:a aac -b:a 128k -movflags +faststart out/film-presentation.mp4
# l'affiche : une image de la carte de la marque (scène 2)
npx remotion still FilmPresentation out/film-presentation.png --frame=<image>
ffmpeg -i out/film-presentation.png -q:v 3 out/film-presentation.jpg
```

Copier ensuite `film-presentation.mp4` et `film-presentation.jpg` dans
`apps/console/public/vitrine/`. Le middleware sert ce dossier sans session (son
`matcher` l'exclut) ; ailleurs, la vidéo redirigerait vers `/login`. Le test limite la
vidéo à 15 Mo.

## Plans réels, musique et crédits

Le film utilise six plans réels et une musique, tous libres de droits. Les plans sont
étalonnés aux couleurs MIP et ne montrent ni visage reconnaissable ni marque lisible.

- **Pixabay** : mains sur un clavier, téléphone sur fond vert, commutateur réseau, baies
  de serveurs, open space flou. Licence de contenu Pixabay, sans attribution requise.
- **Pexels** : doigts qui pianotent, de Vlada Karpovich. Licence Pexels, créditée par
  courtoisie.
- **Musique** : « Cipher » de Kevin MacLeod (incompetech.com), sous licence
  **CC BY 3.0**. Elle est la seule à exiger une attribution, que la carte finale affiche.

Le détail de chaque fichier (page source, auteur, licence, extrait utilisé) est dans
`CREDITS.md`, dans le projet vidéo.

## Ce que montrent les écrans

Les chiffres d'écran (note 92/100, LCP 1,9 s…) sont ceux de la boutique
fictive de la vitrine (`SceneConsole.tsx`). Chaque écran porte la mention
« Illustration · boutique fictive ».

## D'où vient chaque affirmation

Chaque phrase du film a été vérifiée dans le dépôt le 01/10/2026. Si l'un de ces
fichiers change, le film doit être refait.

| Affirmation à l'écran | Preuve |
|---|---|
| SDK web `mip-rum.js`, 22,6 Ko compressé ; rejeu en option | `docs/INTEGRATION.md` (poids gzip), `packages/rum-sdk/package.json` |
| Extension Chrome, Manifest V3, en pilote | `apps/extension/manifest.json`, `docs/INTEGRATION.md` |
| Côté serveur : agent OpenTelemetry officiel (Python, Node, Java, .NET), pas de capteur maison | `AGENTS.md`, `docs/capteurs-serveur.md` |
| Mobile React Native « en préparation », jamais éprouvé | `packages/rum-mobile/MATRICE-RUNTIME.md` |
| Traces et journaux en OTLP/HTTP, JSON ou protobuf | `services/collector/README.md`, `apps/console/lib/cartographie/traitement.ts` |
| Web Vitals LCP, INP, CLS, FCP, TTFB ; seuil LCP de 2,5 s | `packages/rum-sdk/src/vitals.ts`, `apps/console/lib/rating.ts` |
| Pages, erreurs par release, sessions et rejeu, clics de rage | `apps/console/app/pages`, `apps/console/app/errors`, `apps/console/app/sessions/[id]`, `packages/rum-sdk/src/frustration.ts`, `apps/console/app/ux/page.tsx` |
| Alertes et SLO ; webhook signé et e-mail | `apps/console/app/alerts`, `apps/console/app/slo`, `services/README.md` (notifier) |
| L'assistant cite ses sources ; sinon « cause non établie » ; Mistral AI, traitement en UE ; sans clé, réponse par règles | `apps/console/components/assistant/Assistant.tsx`, `apps/console/lib/assistant/mistral.ts`, `apps/console/lib/legal.ts` |
| Données et traitement dans l'UE : base et console à Francfort, services à Amsterdam | `docs/CONFORMITE.md` (§ hébergement), `apps/console/lib/legal.ts` |
| Aucune adresse IP stockée, le pays seulement ; Do Not Track et GPC respectés | `docs/CONFORMITE.md` (tableau des données, opt-out) |
| API v1 documentée (OpenAPI), 28 routes ; serveur MCP : 19 outils, qui ne font que lire (l'API garde une écriture, `POST /api/v1/deploys`, pour la CI : le film ne dit pas l'API en lecture seule) | `apps/console/lib/cartographie/lecture.ts`, `docs/MCP.md`, `packages/mcp-tools/lib/catalogue.mjs` |
| Un seul calcul statistique (`@mip/stats`) pour la console, l'API v1 et `console-api` ; il dit quand les données manquent | `packages/stats`, `AGENTS.md` |
| 86 composants open source inventoriés, 10 licences, relevé du 30/09/2026, page publique | `apps/console/lib/composants-open-source.generated.json`, `apps/console/app/presentation/open-source/page.tsx` |
| Console Next.js 15 (Vercel, Francfort) ; collector et 5 autres services (Railway, Amsterdam) ; PostgreSQL 17 (Neon, Francfort) | `apps/console/package.json`, `services/README.md`, `.railway/railway.ts`, `docs/architecture/overview.md` |
| Ingestion relayée par la console au collector ; les écrans lisent la base | `docs/architecture/overview.md`, `AGENTS.md` |
| 70 tables, 6 services, 54 écrans, 28 routes API v1, 19 outils MCP, 550 fichiers de tests | `apps/console/lib/cartographie/donnees.ts` et `qualite.ts`, gardés par `tests/unit/cartographie.test.ts` ; les tests comptés sont des fichiers |

Le film évite volontairement certains mots, selon la règle de la vitrine
(`tests/unit/couverture-site.test.ts`) : « souverain », « temps réel », « 100 % ».
Il ne montre pas non plus les capacités fermées (Logs, Supervision IA).
