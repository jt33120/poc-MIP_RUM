# Livraison P7 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-runtime-parity-p7.md](spec-rum-runtime-parity-p7.md).
Base : `154936a` (P6 complet, v80), plus le correctif `origin/fix/rum-analytics-p6-6-plan-sans-fenetre` (PR #197)
sans lequel deux tests de `tests/unit/dashboards.test.ts` échouent pour une raison étrangère à P7.

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P7.1 — primitives pures et enveloppe RN | [#199](https://github.com/jt33120/poc-MIP_RUM/pull/199) | **aucune** | oui | oui | verte | non | non |
| P7.2 — consentement, visiteur, transport | [#202](https://github.com/jt33120/poc-MIP_RUM/pull/202) | **aucune** | oui | oui | verte | non | non |
| P7.3 — navigation, actions, erreurs JS | [#204](https://github.com/jt33120/poc-MIP_RUM/pull/204) | **aucune** | oui | oui | verte | non | non |
| P7.4 — API Node et FastAPI | [#200](https://github.com/jt33120/poc-MIP_RUM/pull/200) | **aucune** | oui | oui | verte | non | non |
| P7.5 — `/mobile`, API/MCP, distribution | à ouvrir | **v82** | oui | oui | à vérifier | non | non |

« Déployé » et « Vérifié sur vraie app » restent à **non** pour les cinq :
aucune de ces livraisons n'a été poussée en production, et **aucune n'a tourné
sur un appareil**. C'est le périmètre de P8.5, et l'écran `/mobile` l'affiche
plutôt que de le taire — voir la clôture en fin de fichier.

P7.4 n'a pas de section propre dans ce journal : il a été livré en parallèle de
P7.1, avant l'ouverture de ce fichier. Sa PR (#200) et ses commits
(`55caeab`, `f3ca72c`) font foi.

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

## P7.2 — consentement, visiteur et transport

Démarré le 18/09/2026 sur `feat/rum-runtime-p7-2`, branchée sur `feat/rum-runtime-p7-1` (PR #199) :
cette livraison **contient P7.1** et se relit après elle. **Aucune migration** — le sous-lot ne touche
ni le schéma, ni le parseur, ni le writer. Tout ce qu'il change vit dans `packages/rum-mobile/`, et
l'idempotence dont il dépend (`on conflict (span_id) do nothing`) existe depuis P0.

Cinq modules nouveaux, un par frontière : `consent.ts` (gate et époques), `session.ts` (visite et
visiteur), `queue.ts` (file bornée avec baux), `transport.ts` (classement des réponses et retrait),
`persist.ts` (enregistrements versionnés), plus `scrub.ts` (variante portable du scrub d'ingestion)
et `adapters.ts` (les seuls points de contact avec la plateforme).

### Décisions d'implémentation

- **L'époque encadre `enqueue`, pas le store.** Un compteur incrémenté à chaque RÉVOCATION suffit à
  rendre inéligible tout ce qui précède : la file mémoire, la file disque, et la réponse d'un lot déjà
  parti. `consent(false)` purge SYNCHRONEMENT avant de rendre la main — un événement émis à la ligne
  suivante ne peut donc pas se glisser dans la file qu'on vient de vider. Un `granted` après un refus
  n'incrémente PAS une seconde fois : l'incrément a déjà eu lieu, et un second abandonnerait sur le
  disque une file d'époque orpheline que plus rien ne viendrait nettoyer.
- **L'époque est PERSISTÉE avec l'identité.** Un compteur mémoire revient à sa valeur initiale au
  lancement suivant et ne saurait plus reconnaître une file écrite avant un refus. L'enregistrement
  d'identité porte donc `{appId, epoch, visitorId}` ; un refus y écrit `visitorId: null` et l'époque
  suivante, même quand l'effacement du fichier de file échoue.
- **Le consentement est évalué AVANT `beforeSend`.** Appeler du code applicatif pour un événement que
  l'utilisateur vient de refuser serait une collecte en soi, et un hook peut avoir des effets de bord.
- **Horloge monotone pour les durées, UTC pour les horodatages.** Les deux sont séparées parce
  qu'elles répondent à deux questions différentes : « combien de temps » et « à quel moment ». Un
  serveur ne sait pas relire l'origine de l'horloge d'un téléphone ; un téléphone ne peut pas garantir
  que son horloge murale avance. L'inactivité de session, le retrait exponentiel et les timings de vue
  passent tous par `adapters.monotonicClock` (repli : `performance.now()`, puis un compteur cliquetant
  qui ignore les reculs). `addTiming(name, horodatageMural)` convertit l'argument en ANCIENNETÉ puis le
  reporte sur l'horloge monotone, borné à l'instant présent : ni durée négative, ni durée supérieure au
  temps réellement écoulé depuis l'ouverture de la vue.
- **Session = visite, et une bascule de 2 s n'en est pas une.** P7.1 tournait la session à chaque
  retour `active` ; c'est ce que fait une application consultée depuis une notification vingt fois par
  jour, et cela multiplie les sessions sans que rien ne le signale. La rotation demande maintenant
  30 min d'inactivité (`sessionInactivityMs`, borné à [1 min, 4 h]), mesurées en monotone. Elle est
  évaluée à chaque événement, pas seulement sur callback de cycle de vie : aucune plateforme ne
  garantit qu'un callback arrive.
- **Le visiteur est une installation, pas un lancement.** Identifiant aléatoire de 16 octets, persisté
  sous une clef app-scopée dont l'enregistrement RECOPIE l'`appId` : la clef seule ne suffit pas quand
  deux applications partagent un conteneur de stockage. Il n'est créé qu'APRÈS consentement lorsque
  celui-ci est requis, et un refus l'efface — un identifiant d'installation survivant à une révocation
  serait exactement le traceur que la révocation visait.
- **Le visiteur est estampillé, pas attendu.** Le stockage est asynchrone et `init` est synchrone. Les
  événements émis pendant la résolution portent `mip.visitor_id: null`, et le bootstrap le remplit
  avant tout envoi — `flush()` attend cette promesse. Aucun événement ne part avec un visiteur
  provisoire, et l'application n'attend rien.
- **Acquittement avant retrait, par BAIL.** `lease()` marque sans retirer ; seul `ack()` retire. Un lot
  non acquitté redevient candidat AVEC SES IDENTIFIANTS : c'est la seule raison pour laquelle
  l'ingestion peut appliquer ses `on conflict (span_id)` au lieu de compter une seconde occurrence. Un
  span n'est jamais reconstruit entre deux tentatives.
- **Le plafond HTTP est mesuré sur le corps RÉEL.** L'encodage OTLP multiplie la taille des attributs
  par deux à trois ; un plafond appliqué à la forme aplatie serait une estimation. Le transport mesure
  le corps sérialisé et coupe le lot en deux tant qu'il dépasse `MAX_BODY_BYTES` (2 Mo, la valeur de
  `apps/ingest/supabase/functions/_shared/limits.mjs`). Un événement qui dépasse À LUI SEUL est
  abandonné : le garder bloquerait tout ce qui le suit.
- **Un refus définitif fait reculer, pas seulement jeter.** 400/401/403 abandonnent le lot ET arment le
  retrait avant le suivant. Sans cela, une clef d'API mal saisie déclencherait autant de requêtes qu'il
  y a de lots en file — huit requêtes vouées au même refus pour une file pleine. Le diagnostic ne
  retient qu'un STATUT : le corps d'une réponse peut réfléchir la charge émise.
- **`Retry-After` est borné à 15 minutes.** Un serveur mal configuré peut annoncer 24 h ; on n'abrège
  jamais un délai plus court que le nôtre, mais on ne laisse pas une en-tête décider d'une journée de
  silence. Le bruit (±50 %) ne raccourcit jamais l'attente demandée : il ne fait que DISPERSER le
  retour, pour que le rétablissement d'un service ne reçoive pas un pic supérieur au trafic nominal.
- **Deux emplacements et un manifeste, sauf capacité déclarée.** Quand l'adaptateur déclare
  `capabilities.atomicWrite`, une clef suffit. Sinon le SDK alterne `clef.0` / `clef.1` et écrit le
  manifeste EN DERNIER : une écriture interrompue par un kill de l'OS laisse le manifeste précédent,
  qui désigne l'emplacement précédent, qui est complet. Une somme FNV-1a détecte la troncature ; ce
  n'est pas une signature — un attaquant qui contrôle le disque contrôle aussi la somme — mais la
  troncature est précisément le risque auquel une file locale est exposée.
- **Le scrub portable est une TRANSPOSITION du scrub serveur, pas une réécriture.** Mêmes motifs, même
  ordre de passes, mêmes jetons. `tests/unit/rum-mobile-scrub-portable.test.ts` rejoue le corpus de
  `tests/unit/scrub.test.ts` contre les DEUX implémentations et compare leurs sorties : une divergence
  devient un échec de test, pas une fuite silencieuse. Le scrub serveur reste obligatoire et
  autoritaire à réception ; `beforeSend` seul n'est pas une garantie de confidentialité du disque.
- **Les attributs JSON sont nettoyés STRUCTURELLEMENT.** `{"email":"a@b.fr"}` devient
  `{"email":"[redacted]"}`, pas `{"email":"[email]"}` : le nom de la clef porte la sensibilité, et
  l'appliquer en texte plat la perdrait.
- **`shutdown` vérifie avant de retirer.** Chaque désinstallation contrôle que ce qu'elle retire est
  encore le nôtre. Si un tiers a patché `fetch` après nous, on ne peut pas se retirer de la chaîne sans
  casser la sienne : notre couche devient un passe-plat inerte. Même règle pour `ErrorUtils` —
  restaurer le handler précédent effacerait celui que l'application a posé entre-temps.
- **Le scrub portable n'entre pas dans `@mip/rum-core`.** Un seul runtime écrit sur un disque qu'il ne
  contrôle pas. La règle posée en P7.1 — le cœur ne contient que ce qui sert à deux runtimes au moins —
  tient tant que c'est vrai ; l'extraction sera justifiée le jour où un second runtime persistera.
- **Le classement des réponses n'est pas mutualisé avec le web non plus.** `packages/rum-sdk/src/retry.ts`
  est couplé à un décorateur `SpanExporter` et à `localStorage` ; l'extraire changerait le bundle web au
  milieu d'un lot mobile. Les deux implémentations restent alignées sur la même table de statuts
  (408/425/429/5xx rejouables, 4xx définitifs), écrite en toutes lettres des deux côtés.

### Écarts assumés

- **`offline.persistent` est désactivé par défaut, et le restera jusqu'à P8.1.** Sans effacement
  transactionnel côté serveur, une reprise de file pourrait réécrire des données que l'utilisateur
  vient de faire supprimer. C'est écrit dans le code (avertissement unique au démarrage lorsque
  l'option est activée), dans le README, et ici. Tant que P8.1 n'est pas livré, l'option est destinée à
  la recette.
- **`adapters.navigation` est accepté mais rien ne s'y abonne.** Le contrat `init` de la spec §3 le
  prévoit ; brancher un routeur demande de traiter les callbacks répétés, les routes imbriquées et le
  retour sur le même écran, ce qui est le périmètre entier de P7.3. Le refuser obligerait P7.3 à casser
  la signature d'`init` ; l'utiliser à moitié produirait des vues doublées.
- **`installFetchPatch`, la découverte `global.require("react-native")` et `ErrorUtils` ne sont toujours
  pas durcis.** `traceOrigins: []` propage encore le `traceparent` à toutes les origines sauf
  l'endpoint. C'est le périmètre explicite de P7.3 ; ce lot n'a touché à ces trois points que pour leur
  DÉSINSTALLATION (registre de teardown) et pour router le cycle de vie vers la nouvelle politique de
  session.
- **`nativeCapabilities` reste `null`.** Rien ne les observe ; les déclarer serait une promesse sans
  mesure. P7.5 porte le modèle de capacités.
- **`identity_persistence` est un DIAGNOSTIC, pas un attribut de span.** L'émettre sur le fil
  demanderait une colonne, donc une migration, pour une information opérationnelle que
  `getDiagnostics().identityPersistence` rend déjà, avec exactement le vocabulaire de la spec §3
  (`storage` / `memory`).
- **Le retrait exponentiel démarre à 1 s et plafonne à 5 min**, là où le SDK web démarre à 30 s. Un
  mobile retrouve le réseau par intermittence — sortie de tunnel, changement de cellule — et attendre
  30 s après une coupure d'une seconde perdrait des événements au TTL pour rien.
- **Aucune recette sur appareil réel.** La couverture native (crashes natifs, ANR, démarrage) reste
  « non vérifiée » : elle appartient à P8.5. Aucun test sous Metro ni sur simulateur n'a été joué.
- **Le bundle React Native double** : `dist/index.js` passe de 28,3 Kio à 60,6 Kio brut (17,0 Kio
  gzip), mesuré sur les deux artefacts construits. Aucun budget n'est défini sur ce paquet — les
  35 Kio gzip portent sur le SDK web, inchangé à 22,1 Kio. Une file acquittée, une gate de
  consentement et une persistance versionnée ne tiennent pas dans zéro octet ; l'alternative était de
  ne pas les livrer.

### Preuves locales

| Preuve | Résultat |
|---|---|
| `pnpm test:unit` | **159 fichiers, 2131 tests verts** (157/2078 en P7.1 : +2 fichiers, +53 tests) |
| dont `tests/unit/rum-mobile-p72.test.ts` | 44 tests — gate, époques, session, visiteur, file, transport, persistance, `shutdown` |
| dont `tests/unit/rum-mobile-scrub-portable.test.ts` | 9 tests — corpus du scrub serveur rejoué contre les deux implémentations |
| `pnpm --filter @mip/rum-sdk size-check` | `dist/mip-rum.js` 63,6 Kio brut / **22,1 Kio gzip** (budget 35 Kio) — **inchangé** |
| `pnpm --filter console exec tsc --noEmit` | aucune erreur |
| `pnpm --filter @mip/rum-mobile exec tsc --noEmit` | aucune erreur |
| `pnpm build:sdk` puis `pnpm -r build` | 12 paquets construits, console incluse |
| `node scripts/verify-sdk-packaging.mjs` | **33 contrôles verts**, surface publique à 22 exports (`consent` et `shutdown` ajoutés) |
| `SQL_TEST_DATABASE_URL=… pnpm test:sql` | **19 fichiers, 237 tests verts** (2 fichiers / 26 tests skippés, inchangé) |
| dont `rum-runtime-parity-sql` | 5 tests — dont la preuve d'idempotence SDK + ingest |

Base de test jetable dédiée (`p72_transport` sur le PostgreSQL 15 local, port 5433), supprimée après la
recette. `DATABASE_URL` n'a jamais été utilisée.

CI de [#202](https://github.com/jt33120/poc-MIP_RUM/pull/202) **verte** : « Build SDK + tests
unitaires » et « E2E Playwright (Postgres service) » passent tous deux. La PR est ouverte sur `master`
et contient P7.1 (#199), faute de pouvoir cibler une branche non mergée sans y empiler la relecture.

Un échec PRÉ-EXISTANT, non joué par la CI, reste ouvert et n'appartient pas à ce lot :
`pnpm --filter @mip/rum-sdk exec tsc --noEmit` échoue sur `packages/rum-sdk/src/replay.ts:242`
(`Uint8Array` / `BodyInit`), identiquement sur `master`.

### Recette exigée, et où elle est prouvée

| Scénario | Preuve |
|---|---|
| Réseau hors ligne → en ligne | `rum-mobile-p72` : rien n'est perdu, le rejeu porte les mêmes identifiants |
| Perte d'acquittement après commit | `rum-runtime-parity-sql` : les deux corps HTTP réels ingérés, une seule ligne par signal |
| 429 | `rum-mobile-p72` : `Retry-After` respecté, puis borné |
| 401 | `rum-mobile-p72` : lot abandonné, aucune boucle, diagnostic sans corps |
| Disque plein | `rum-mobile-p72` : `storageAvailable: false`, la collecte continue en mémoire |
| Disque corrompu | `rum-mobile-p72` : emplacement tronqué, file abandonnée, `flushNow()` résolu |
| Révocation pendant un flush | `rum-mobile-p72` : la réponse du lot en vol ne réinjecte rien |
| Fermeture puis réouverture | `rum-mobile-p72` : sauvegarde en arrière-plan, restauration au démarrage |
| Changement d'utilisateur pendant un retry | `rum-mobile-p72` **et** `rum-runtime-parity-sql` : hash de l'identité d'origine |
| Deux applications | `rum-mobile-p72` : enregistrement de A recopié sous la clef de B, refusé |
| Horloge qui recule | `rum-mobile-p72` : aucun `timing_ms` négatif |
| Même événement acquitté deux fois | `rum-runtime-parity-sql` : 1 session, 1 page vue, 1 erreur, 1 action, 3 événements |

### Ce que P7.3 hérite

Surface publique de `@mip/rum-mobile` (CJS + ESM, vérifiée sur le paquet construit), **22 exports** :
`addAction, addError, addFeatureFlagEvaluation, addTiming, clearAccount, clearGlobalContext, clearUser,
consent, default, flushNow, getDiagnostics, getGlobalContext, init, removeGlobalContextProperty, screen,
setAccount, setGlobalContext, setGlobalContextProperty, setUser, shutdown, startView, track`.

Points d'accroche laissés en place :

- `adapters.navigation` (`{ subscribeScreen(cb): unsubscribe }`) est déclaré, accepté par `init` et
  conservé — personne ne s'y abonne. C'est là que le routeur se branche ; `screen()` reste la voie
  manuelle et pose la route sans ouvrir de vue P2.
- `teardown: Array<() => void>` dans `index.ts` : tout hook posé doit y enregistrer sa désinstallation,
  et celle-ci doit vérifier que ce qu'elle retire est encore le sien. `shutdown()` le rejoue en ordre
  inverse de pose.
- `envelopeCtx(action, local)` est le seul chemin traversé par tous les signaux : il applique la
  rotation de session par inactivité et fige l'enveloppe. Une fenêtre causale P7.3 s'y rattache.
- `Ctx.actionId` (`core.ts`) est câblé dans `commonAttrs()` et vaut toujours `null` : le renseigner
  suffit à faire porter l'action causale par tous les signaux, sans toucher aux builders.
- `enqueue(span)` applique gate → `beforeSend` → file. Une action racine refusée par la gate ou par le
  hook ne doit pas laisser d'enfants porteurs de son `action_id` — le web traite ce cas dans
  `packages/rum-sdk/src/consent.ts` (`revokedRoots`), le mobile ne le fait PAS encore, faute de
  causalité côté RN.
- `installCrashHandler()` et `installFetchPatch()` sont **non durcis** et le restent.
- `getDiagnostics().nativeCapabilities` vaut `null` et attend P7.5.

## P7.3 — navigation, actions et erreurs JS

Démarré le 18/09/2026 sur `feat/rum-runtime-p7-3`, branchée sur `origin/master` (P7.1, P7.2 et
P7.4 fusionnés). **Aucune migration** : tout ce que le sous-lot ajoute sur le fil existe déjà
côté serveur — `mip.action_id` et `mip.action_type` depuis P3, `mip.error_fatal` depuis v69
(`rum_error.is_fatal`), et la mesure de démarrage est un `rum.timing` P2 nommé. Le schéma, le
parseur et le writer ne sont pas touchés.

Cinq modules nouveaux, un par frontière : `navigation.ts` (dédoublonnage et adaptateur de
routeur), `interactions.ts` (instrumentation d'appui), `causal.ts` (fenêtre causale),
`rejets.ts` (rejets non gérés et capacité absente), `trace.ts` (origines et `traceparent`).

> ### Rupture de comportement : `traceOrigins` est une liste FERMÉE
>
> **Avant**, `traceOrigins: []` ou absent propageait `traceparent` **et** `tracestate` vers
> TOUTES les origines appelées par l'application, sauf l'endpoint. `tracestate` porte
> `mip=s:<session_id>` : le défaut donnait donc à n'importe quel tiers appelé — régie,
> fournisseur de cartes, passerelle de paiement — de quoi relier ses propres journaux à la
> visite en cours. Aucun consentement recueilli pour de la mesure d'audience ne couvre cela.
>
> **Désormais**, une liste vide ne propage vers rien. Un client qui utilisait la corrélation
> mobile → backend doit déclarer ses origines. La migration est documentée dans
> [le README du paquet](../../packages/rum-mobile/README.md#migration-v02--v03--traceorigins-est-une-liste-fermée),
> en tête de fichier, avec le `diff` à appliquer. Le paquet passe en **0.3.0** pour que la
> version le signale.
>
> Ce qui NE change pas : les spans `http.client` restent émis pour tous les appels hors
> endpoint. Mesurer la latence d'un appel tiers n'expose rien à ce tiers ; seuls les en-têtes
> SORTANTS étaient le problème.

### Décisions d'implémentation

- **Le dédoublonnage compare à l'écran COURANT, jamais à l'historique.** Un routeur notifie
  son état plusieurs fois par transition — conteneur, puis chaque pile imbriquée, parfois une
  fois de plus pour l'animation. `getCurrentRoute()` rend la route active LA PLUS PROFONDE :
  toutes ces notifications résolvent donc vers la même identité, et une seule vue sort.
  `A → B → A` produit en revanche bien TROIS vues : un retour en arrière est une nouvelle
  consultation, et l'effacer supprimerait les allers-retours, qui sont exactement ce qu'un
  entonnoir mesure. L'identité comparée est la **clef de route** quand le routeur en fournit
  une — elle distingue deux fiches produit empilées —, le nom sinon.
- **`screen()` manuel dédoublonne aussi.** C'est un changement de comportement, assumé : la
  plupart des intégrations manuelles branchent `screen()` sur un callback de routeur, qui se
  répète. Un écran déjà courant n'est pas une navigation. Le README le signale.
- **L'adaptateur de routeur ne connaît aucun routeur.** `navigationDepuisRouteur(ref)` lit
  trois membres publics de la référence que l'application passe — `addListener("state")`,
  `getCurrentRoute()`, `isReady()` — et n'importe rien. Il émet la route d'ouverture à
  l'abonnement, sans quoi la première consultation ne serait jamais comptée.
- **Le nom d'action est DÉCLARÉ, et le SDK n'évalue même pas les `children`.** Le SDK web lit
  le libellé d'un bouton parce qu'un nœud DOM expose un nom accessible déjà public dans la
  page. React Native n'a pas cet équivalent : le seul texte atteignable est ce que
  l'utilisateur voit, et sur mobile c'est très souvent une DONNÉE — « Payer 128,40 € »,
  « Appeler Marie D. ». Conséquence technique : les props sont recopiées **par descripteurs**
  (`Object.getOwnPropertyDescriptors`) et non par `{...props}`, car un spread ÉVALUE chaque
  prop. Un test le prouve avec un getter compteur sur `children` : zéro lecture.
- **Une transformation de props, pas un composant.** Le paquet ne dépend ni de React ni de
  React Native, et un `<MipPressable>` imposerait les deux. Une fonction props → props
  s'applique à `Pressable`, `TouchableOpacity`, `Button` ou un composant maison. Le
  gestionnaire enveloppé est MÉMORISÉ par (gestionnaire, nom) : sans cela, chaque rendu
  produirait une fonction neuve, React verrait une prop changée, et instrumenter un bouton
  coûterait un rendu par frame à l'application hôte.
- **L'exception d'un `onPress` remonte telle quelle.** Notre appel est hors `try` : une erreur
  applicative ne doit pas disparaître parce que MIP est installé. Et la fenêtre reste alors
  ouverte, ce qui est exactement ce qu'il faut pour que l'erreur qui suit porte l'action.
- **La fenêtre causale est celle de P3 (5 s), avec UNE adaptation : les promesses.** Sur le
  web, la fenêtre est un simple délai. Sur mobile, un `onPress` rend très souvent une
  promesse, et cette promesse EST la preuve observée que le travail appartient encore à
  l'appui. Tant qu'elle est en vol, la fenêtre est maintenue — plafond 30 s, parce qu'une
  promesse qui ne se résout jamais ne doit pas maintenir une attribution indéfinie. Son
  règlement referme le maintien.
- **Rien n'est deviné.** Hors fenêtre, `courante()` rend `null` : pas de repli sur « le
  dernier clic connu ». L'heuristique `atTimestamp()` du web, qui attribue une ressource par
  son horodatage de départ, n'a pas d'équivalent ici — elle existe côté navigateur parce que
  `ResourceTiming` livre des entrées SANS contexte d'appel. Le patch `fetch` mobile, lui,
  prend son instantané au départ de la requête : il n'a rien à reconstituer.
- **`envelopeCtx()` est le seul point de lecture de l'action.** C'est le chemin traversé par
  tous les signaux, et `commonAttrs()` y pose déjà `mip.action_id` depuis P7.1. Aucun builder
  ni aucun code d'ingestion n'a été touché.
- **Une racine refusée ne laisse aucun enfant orphelin — mécanisme du web, transposé.**
  `enqueue` tient un ensemble `racinesRefusees` (le `revokedRoots` de
  `packages/rum-sdk/src/consent.ts`) : une racine que la gate, `beforeSend` ou la file
  refusent y entre, et tout signal ultérieur qui la désigne perd son `mip.action_id` AVANT le
  hook. La file signale en plus ses retraits INVOLONTAIRES (capacité, TTL, refus définitif du
  serveur) : quand une racine en fait partie, `queue.retireAttribut()` coupe le lien des
  enfants restés en file. Un `action_id` qui survit à sa racine désigne une action que
  l'ingestion n'a jamais reçue — c'est un lien cassé, pas une information partielle.
- **La fatalité est DÉCLARÉE, et elle l'était déjà par le moteur.** `ErrorUtils` reçoit
  `isFatal` et le SDK le jetait : `rum_error.is_fatal` valait donc `null` — « inconnu » — pour
  tous les crashes mobiles depuis l'origine. Il est maintenant émis en `mip.error_fatal`,
  colonne existante depuis v69. Un rejet non géré est déclaré NON fatal : il ne termine
  aucune application React Native.
- **Un JS fatal n'est pas un crash natif, et le modèle le dit déjà.** La source reste
  `react_native_js` : le bundle s'arrête, la redbox s'affiche, le processus natif survit. Un
  crash natif — signal, exception Objective-C, `SIGABRT` — n'est pas observable depuis ce
  runtime et appartient à P8.5.
- **Les rejets non gérés passent par un adaptateur, et c'est un choix.** Aucun moteur visé
  (Hermes, JSC) n'expose de mécanisme standard ET RETIRABLE. Celui de React Native passe par
  le module de suivi livré avec son polyfill de promesses, dont l'activation est GLOBALE et
  remplacerait celle de l'application ; le poser nous-mêmes violerait la règle « ne retirer
  que ce qu'on a posé ». `rejetsDepuisTracker(module)` réduit le branchement à un appel, avec
  le module que l'application possède déjà — c'est elle qui le résout, pas nous.
- **`process.on("unhandledRejection")` est explicitement REFUSÉ.** Un test l'a révélé pendant
  l'écriture du lot : sous Node, la seule PRÉSENCE d'un écouteur sur cet événement supprime le
  comportement par défaut du runtime — l'avertissement, et depuis Node 15 la terminaison. Y
  poser un écouteur de télémétrie ferait SURVIVRE un processus que l'exploitant voulait voir
  mourir, parce que MIP est installé. Seuls restent l'adaptateur explicite et l'événement
  standard `unhandledrejection`, sur lequel nous n'appelons jamais `preventDefault`.
- **`global.require("react-native")` est SUPPRIMÉ.** Il paraissait gratuit et ne l'était pas :
  sous Metro, `global.require` n'est pas le `require` de CommonJS mais le résolveur interne du
  bundler, indexé par NUMÉRO de module. Selon la configuration, il rendait `undefined` — donc
  un cycle de vie silencieusement absent — ou levait. Il réussissait sur le poste du
  développeur et échouait sur un build de production, sans que rien ne le signale.
- **Le patch `fetch` fusionne les en-têtes au lieu de les remplacer.** Selon WHATWG,
  `init.headers` REMPLACE la liste d'en-têtes d'un `Request` : l'implémentation précédente
  (`init.headers || input.headers`) perdait l'`Authorization` et le `Content-Type` de
  l'appelant dès qu'un `init` portait des en-têtes. La méthode est lue aux DEUX sources :
  `fetch(new Request(url, {method:"POST"}))` était rapporté « GET » à l'ingestion.
- **Un `traceparent` déjà posé et valide est préservé, et devient l'identité de notre span.**
  Une couche tierce a ouvert la trace ; l'écraser couperait sa corrélation en deux. Un
  `traceparent` MAL FORMÉ, lui, est remplacé : ce n'est pas une trace, et le conserver
  fabriquerait un lien vers une trace qui n'existe pas (l'ingestion le refuse déjà,
  `nativeTraceId`). Quand rien n'est à écrire, `init` est passé au `fetch` d'origine TEL QUEL
  — l'objet n'est même pas recréé.
- **Le démarrage mesuré est JS, et le nom ne le cache pas.**
  `js_start_to_first_screen_ms` court depuis `init()` — moteur JS déjà démarré, bundle déjà
  chargé — jusqu'à un callback EXPLICITE de l'application. Le démarrage à chaud porte un nom
  DISTINCT (`js_warm_start_to_first_screen_ms`) et part du retour au premier plan : mélanger
  les deux dans une moyenne rendrait les deux illisibles. Une durée supérieure à 60 s est
  refusée — ce n'est plus un démarrage, c'est un callback appelé tard — et la fenêtre est
  consommée quand même, sinon un appel plus tardif encore publierait une valeur pire.
- **Aucun ANR n'est déduit.** Un compteur JS ne sait pas distinguer un thread principal bloqué
  d'une application qui n'a rien à faire. Un test vérifie qu'aucun signal n'est émis par le
  seul écoulement du temps.

### Écarts assumés

- **`traceOrigins` casse la corrélation des intégrations déjà en place** tant qu'elles n'ont
  pas déclaré leurs origines. C'est le prix explicite de la correction : le défaut précédent
  envoyait l'identifiant de session à des tiers, et aucun réglage intermédiaire ne permet de
  « propager un peu moins » sans savoir vers qui. Le README ouvre sur la migration, le paquet
  passe en 0.3.0.
- **`screen()` manuel ne double plus un écran déjà courant.** Une application qui appelait
  `screen("Feed")` à chaque rafraîchissement pour compter des consultations verra ce compteur
  baisser. Le signal `screen` est documenté comme l'équivalent d'un changement d'URL ; répéter
  la même URL n'est pas une navigation. `startView()` reste la voie pour marquer une
  ouverture de vue nommée.
- **`onLongPress` n'est pas instrumenté.** C'est un geste différent ; lui donner le même nom
  que l'appui court fondrait deux intentions sous un seul libellé, et lui en donner un second
  demanderait une seconde prop pour un usage que rien n'a encore réclamé.
- **Aucune matrice de compatibilité n'est déclarée.** `navigationDepuisRouteur` et
  `rejetsDepuisTracker` sont éprouvés contre des DOUBLES conformes à la surface publique
  qu'ils consomment. Aucune version réelle de React Native, React, Hermes, OS ou routeur n'a
  été exercée : consigner une plage à partir de mocks serait exactement ce que le plan
  interdit. La matrice appartient à P7.5 et à la recette sur appareil de P8.5.
- **Le maintien par promesse ne couvre que la valeur RENDUE par `onPress`.** Une chaîne
  démarrée par un `setTimeout` dans le gestionnaire sort de la fenêtre au bout de 5 s comme
  n'importe quel travail tardif. Observer les timers demanderait de les patcher tous, ce qui
  déplacerait le risque du côté de l'application hôte.
- **`nativeCapabilities` reste `null`.** `jsCapabilities` est un champ NOUVEAU et DISTINCT :
  il décrit ce que la couche JS a réellement pu installer. Les deux ne doivent pas être
  confondus par P7.5.
- **`packages/rum-mobile/src/queue.ts` est modifié** (code livré par P7.2) : un troisième
  paramètre OPTIONNEL de constructeur signale les retraits involontaires, et
  `retireAttribut()` s'ajoute en symétrique d'`estampille()`. Sans ces deux points, la
  fermeture du trou « racine évincée / enfants orphelins » était impossible sans dupliquer la
  file. Aucune signature existante n'est changée.
- **Aucune recette sur appareil réel.** La couverture native (crashes natifs, ANR, démarrage
  natif) reste « non vérifiée » : elle appartient à P8.5. Aucun test sous Metro ni sur
  simulateur n'a été joué.
- **Le bundle React Native grossit d'un tiers** : `dist/index.js` passe de 62 086 à
  82 578 octets bruts (60,6 → 80,6 Kio), et de 17 409 à 22 953 octets gzip (17,0 → 22,4 Kio),
  mesuré sur les deux artefacts réellement construits. Aucun budget n'est défini sur ce
  paquet ; les 35 Kio gzip portent sur le SDK web, **inchangé à 22,1 Kio**. Cinq modules
  nouveaux, une fusion d'en-têtes conforme au WHATWG et une fenêtre causale ne tiennent pas
  dans zéro octet ; l'alternative était de ne pas les livrer. Le bundle n'est pas minifié —
  un client Metro le minifie à son tour.

### Preuves locales

| Preuve | Résultat |
|---|---|
| `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` | **161 fichiers, 2223 tests verts** (160/2158 sur master : +1 fichier, +65 tests) |
| dont `tests/unit/rum-mobile-p73.test.ts` | 65 tests — navigation, interactions, fenêtre causale, racines refusées, erreurs JS, fetch, démarrage |
| `pnpm --filter @mip/rum-sdk size-check` | `dist/mip-rum.js` 63,6 Kio brut / **22,1 Kio gzip** (budget 35 Kio) — **inchangé** |
| `pnpm --filter console exec tsc --noEmit` | aucune erreur |
| `pnpm --filter @mip/rum-mobile exec tsc --noEmit` | aucune erreur |
| `pnpm build:sdk` puis `pnpm -r build` | tous les paquets construits, console incluse |
| `node scripts/verify-sdk-packaging.mjs` | **33 contrôles verts**, surface publique à **26 exports** (4 ajoutés) |
| `SQL_TEST_DATABASE_URL=… pnpm test:sql` | **20 fichiers, 243 tests verts** (240 sur master : +3), 2 fichiers / 26 tests skippés |
| dont `rum-runtime-parity-sql` | 8 tests — dont la causalité, le JS fatal et le démarrage jusqu'aux tables |

Base de test jetable dédiée (`p73_causal` sur le PostgreSQL 15 local, port 5433), supprimée
après la recette. `DATABASE_URL` n'a jamais été utilisée.

### Recette exigée, et où elle est prouvée

| Scénario | Preuve |
|---|---|
| Changement d'écran rapide | `rum-mobile-p73` : trois transitions notifiées deux fois chacune → trois vues, aucune perdue |
| Routes imbriquées | `rum-mobile-p73` : quatre notifications pour une transition → une seule vue |
| Retour sur le même écran | `rum-mobile-p73` : `A → B → A` rend bien trois vues |
| Double callback | `rum-mobile-p73` : trois renotifications sans changement → une seule vue ; idem pour `screen()` manuel |
| Deux actions proches | `rum-mobile-p73` : chaque effet porte l'identifiant de SA racine |
| Erreur sans action | `rum-mobile-p73` : `addError` isolé, `action_id` absent |
| Hook qui rejette | `rum-mobile-p73` : racine jetée par `beforeSend`, les effets partent sans `action_id` |
| Requête en vol lors d'une rotation d'identité | `rum-mobile-p73` : le span porte l'identité ET la session du départ |
| Réseau tiers sans en-têtes MIP | `rum-mobile-p73` : `init` passé tel quel, ni `traceparent` ni `mip=s:`, span quand même émis |
| Racine évincée de la file | `rum-mobile-p73` : `retireAttribut` coupe le lien des enfants restés en file |
| JS fatal ≠ crash natif | `rum-runtime-parity-sql` : `kind=crash`, `handled=false`, `is_fatal=true`, `error_source=react_native_js` |
| Causalité jusqu'aux tables | `rum-runtime-parity-sql` : `rum_action.type=click`, l'effet dans la fenêtre pointe dessus, l'effet tardif est `null` |
| Démarrage JS | `rum-runtime-parity-sql` : `rum_event` `js_start_to_first_screen_ms`, `timing_ms=742` |

### Ce que P7.5 hérite

Surface publique de `@mip/rum-mobile`, **26 exports** (22 en P7.2, +4) : les 22 précédents plus
`instrumentPressable`, `markFirstScreenRendered`, `navigationDepuisRouteur`,
`rejetsDepuisTracker`. Paquet en **0.3.0** ; `service.version` et le user-agent synthétique
(`MIP-RN/0.3 (ios 17)`) suivent.

**Signaux désormais émis par le SDK, et leurs noms exacts** — tous dans des tables existantes,
aucune migration :

| Signal | Table / forme | Repère de lecture |
|---|---|---|
| Démarrage JS à froid | `rum_event` | `event_type='timing'`, `name='js_start_to_first_screen_ms'`, `timing_ms` |
| Démarrage JS à chaud | `rum_event` | `event_type='timing'`, `name='js_warm_start_to_first_screen_ms'` |
| Appui instrumenté | `rum_action` + `rum_event` | `type='click'` ; `name` = le `mipActionName` déclaré |
| Action déclarée | `rum_action` + `rum_event` | `type='manual'` |
| Effet causal | toute table portant `action_id` | non nul UNIQUEMENT dans la fenêtre d'une racine acceptée |
| Erreur JS non interceptée | `rum_error` | `kind='crash'`, `handled=false`, `is_fatal` **renseigné**, `error_source='react_native_js'` |
| Rejet non géré | `rum_error` | `kind='unhandledrejection'`, `handled=false`, `is_fatal=false` |
| Écran | `rum_pageview` | dédoublonné : une ligne par consultation, pas par callback |

**Ce que le SDK NE PEUT PAS observer, et que `/mobile` ne doit donc pas afficher comme zéro :**

- **crashes natifs, ANR, démarrage natif** : hors couche JS. `nativeCapabilities` reste `null`.
  Un badge « non collecté » est la seule présentation juste ; « 100 % sans crash » serait faux.
- **rejets non gérés quand aucun mécanisme n'est branché** :
  `getDiagnostics().jsCapabilities.unhandledRejection === "unavailable"`. Une application sans
  adaptateur n'a pas zéro rejet, elle n'en a aucun d'observé.
- **écrans quand aucun adaptateur de navigation n'est branché** :
  `jsCapabilities.navigation === "unavailable"`. `screen()` manuel peut néanmoins alimenter la
  table — l'absence d'adaptateur ne veut donc pas dire absence de données, seulement absence
  de garantie de couverture.
- **démarrage tant que l'application n'a pas appelé `markFirstScreenRendered()`** :
  `jsCapabilities.appStart === "unavailable"`. Il n'y a AUCUNE mesure automatique.
- **corrélation réseau vers une origine non déclarée** : depuis ce lot, `traceOrigins` est une
  liste fermée. Un `rum_span` front sans trace serveur jointe n'est pas un incident de
  tracing : c'est une origine que le client n'a pas déclarée.

`jsCapabilities` (`errorHandler`, `unhandledRejection`, `navigation`, `appStart`, chacun
`"active" | "unavailable"`, l'objet entier `null` avant `init`) est la source client naturelle
du modèle `mobile_capabilities` de P7.5 — pour les valeurs `js_errors` et `screen_tracking`.
Il reste un **déclaratif client** : comme la spec §4 P7.5 l'exige, `verified_at` ne peut venir
que d'une recette opérateur, jamais de ce booléen.

## P7.5 — `/mobile`, API/MCP et distribution

Démarré le 18/09/2026 sur `feat/rum-runtime-p7-5`, branchée sur `origin/master`
— qui contenait déjà P7.1 (#199), P7.4 (#200), P7.2 (#202) et P7.3 (#204), tous
fusionnés. **Migration `v82`** : v80 était le maximum au démarrage, et v81 a été
prise par P8.1 (#205), fusionnée pendant ce lot.

**Le défaut que ce sous-lot existe pour empêcher tient en une phrase.** Une
console qui ne reçoit aucun crash natif ne peut pas distinguer « cette
application ne plante pas » de « rien ne mesure ses plantages ». Les deux rendent
zéro ligne. Le premier est une bonne nouvelle ; le second est un angle mort — et
c'est celui que P7 laisse ouvert, en entier, pour tout ce qui est natif. Un
tableau de bord qui affiche « 0 crash » dans le second cas ne se trompe pas d'un
peu : il dit exactement le contraire de la vérité, avec l'autorité d'un chiffre.

### Décisions d'implémentation

- **Le runtime est DÉCLARÉ, pas déduit** — et c'est la décision structurante du
  lot. Sans colonne, la seule façon de désigner « les sessions React Native »
  était `os in ('iOS','Android') and browser is null`. C'est faux dans les deux
  sens : un navigateur mobile que le parseur ne sait pas nommer laisse `browser`
  à NULL et serait compté React Native. L'information EXISTAIT déjà à
  l'ingestion — `runtimeClientMip()` (otlp.mjs) lit le `service.name` constant
  de nos SDK — et elle était calculée puis jetée. `rum_session.runtime` la garde.
  Un taux dont le dénominateur est une devinette n'est pas un taux.
- **Trois états, pas deux.** Une ligne `declared = true` dit « le SDK a installé
  et observe » ; une ligne `declared = false` dit « il a REGARDÉ et n'a rien pu
  installer » ; l'absence de ligne dit « personne n'a rien dit ». Fondre les deux
  derniers effacerait la différence entre « on sait que ce n'est pas mesuré » et
  « on ne sait pas ». L'écran les rend par « Non collecté » et « Inconnu », et
  jamais par 0.
- **`verified_at` est structurellement hors de portée du client.** L'upsert du
  writer ne cite ni `verified_at`, ni `verified_by`, ni `verified_note` dans son
  `do update set` ; `console_ro` n'a que `select` sur la table. Un test SQL pose
  une vérification, réingère une déclaration contradictoire, et prouve que la
  date ne bouge pas. C'est là, et nulle part ailleurs, que se joue la règle
  « une capacité activée n'est pas un test natif passé ».
- **Les trois capacités natives sont TOUJOURS `unavailable`, et ce n'est pas
  configurable.** Les rendre optionnelles ne les rendrait pas observables : cela
  donnerait seulement à une application le moyen de déclarer une collecte qui
  n'a pas lieu, et à la console d'afficher « 100 % sans crash » sur un silence.
- **Le taux refuse de se calculer quand il mentirait.**
  `js_error_free_session_rate` vaut `null`, avec sa raison, dans trois cas :
  aucune session (pas de dénominateur), capacité déclarée indisponible, aucune
  déclaration. Le deuxième est le cas qui compte : 10 sessions et 0 erreur
  observée donneraient « 100 % », et ce serait l'inverse de la vérité.
- **Le libellé ne dit pas « crash-free », et le calcul non plus.** Une erreur
  JavaScript non interceptée arrête le bundle et affiche la redbox ; elle ne tue
  pas le processus natif. La carte s'appelle « Sessions sans erreur JS », et
  l'écran démonte la confusion en toutes lettres plutôt que de l'ignorer. L'e2e
  vérifie que le mot « crash-free » n'apparaît nulle part sur la page.
- **La réponse d'API n'a AUCUN champ pour les crashes natifs, les ANR et le
  démarrage natif.** Pas même un `null` : un champ laisserait croire que la
  mesure existe et qu'elle est vide. `data.capabilities` porte l'information.
- **`platform` n'est pas une dimension nouvelle** : c'est `os`, restreint aux
  deux valeurs qu'un runtime React Native peut rendre, et INTERSECTÉ avec un
  `os=` déjà présent. `?os=iOS&platform=android` rend zéro ligne — la réponse
  exacte — et jamais l'un des deux par écrasement. Une seconde dimension aurait
  été une seconde vérité à maintenir.
- **`/mobile` applique MOINS de dimensions que ses jeux de données n'en portent,
  et c'est délibéré.** Ses mesures sont des taux sur une cohorte de sessions :
  `route`, `service`, `env`, `country` et `browser` filtreraient le numérateur
  sans filtrer le dénominateur. D'où `Surface.only`, une liste blanche ajoutée
  au contrat P6 : une dimension absente de la liste est REFUSÉE avec sa raison
  (400 `unsupported_dimension` sur l'API, écran de reprise sur la page), jamais
  appliquée à moitié.
- **La `release` filtre la COHORTE, contre le classement du contrat P6.** P6
  range `release` en dimension d'occurrence, pour une raison écrite dans
  `query-compiler.ts` : sur le web, une mise en production pendant la visite
  change la release, et la relire sur la session réécrirait le passé. Un binaire
  mobile, lui, ne se remplace pas sous les pieds de l'utilisateur : changer de
  version exige un redémarrage, donc une nouvelle session. `rum_session.release`
  est ici un fait exact, et c'est la seule façon d'avoir un taux dont les deux
  termes parlent de la même population.
- **L'index est créé sur MESURE, et contre l'intuition de départ.** On pensait
  qu'il ne servirait à rien : `idx_session_app_last_seen` (v61) borne déjà les
  sessions par app. C'était faux — cet index porte sur `last_seen_at`, et la
  cohorte borne sur `started_at`. Il n'y avait donc AUCUN index utilisable, et
  l'écran parcourait `rum_session` en entier. Mesuré sur 120 000 sessions : 28 →
  3,5 ms sur 24 h, 48 → 26 ms sur 7 j, plan vérifié dans les trois scénarios.
  Le banc (`rum-mobile-bench-p75`) retire l'index, mesure, le recrée, remesure,
  et échoue si le planificateur cesse de le choisir.
- **La déclaration est rafraîchie AVANT CHAQUE ENVOI, pas à `init`.** Un
  adaptateur de navigation abonné après coup, un stockage qui ne répond qu'au
  premier accès, une file durable qui tombe : chacun change la réponse. Figée à
  `init`, la déclaration décrirait un état qui n'a duré qu'un instant.
- **Le vocabulaire est fermé, et sa copie est surveillée.** Le paquet React
  Native ne peut pas importer un module Node : la liste y est recopiée, comme
  `ERROR_SOURCES` l'est entre `otlp.mjs` et `queries-errors.ts`. Un test unitaire
  compare les trois sources (SDK, serveur, console) — une divergence devient un
  échec de test, pas une capacité silencieusement jetée à l'ingestion.
- **v82 reprend `purge_rum_app` et `erase_app_data` depuis v81, pas depuis v80.**
  `create or replace function` remplace le corps ENTIER : repartir de v80 —
  celle qu'on avait sous les yeux — aurait effacé, sans conflit et sans alerte,
  le verrou d'application et la suspension d'ingestion que P8.1 venait de poser.
  C'est exactement ce qui s'est produit entre v79 et v80. La règle est écrite en
  tête du fichier : on repart de la dernière définition présente, jamais de celle
  qu'on connaît.

### Écarts assumés

- **`mobile_capabilities` n'entre PAS dans `DSAR_CHILD_TABLES`, et la consigne
  demandait l'inverse.** Raison : ces tables sont interrogées par
  `where session_id in (…)`, et cette table n'a pas de `session_id` — l'y ajouter
  ferait ÉCHOUER l'effacement d'une personne, pas le compléter. Elle ne porte ni
  session, ni visiteur, ni identité, ni message : une app, un runtime, une
  release et un nom de capacité. Elle est donc traitée par l'effacement
  d'APPLICATION (`erase_app_data`) et par la rétention (`purge_rum_app`), et
  trois tests le prouvent — dont un qui vérifie que la table ne porte aucune des
  colonnes d'ancrage DSAR. Le garde-fou de P8.1 (`dsar-concurrency-sql` compare
  `erase_app_data` au catalogue des tables portant `app_id`) l'aurait de toute
  façon imposé : c'est lui qui rend l'oubli impossible, et il passe.
- **Aucune matrice de compatibilité n'est déclarée**, et c'est le résultat
  demandé plutôt qu'un manque : [MATRICE-RUNTIME.md](../../packages/rum-mobile/MATRICE-RUNTIME.md)
  liste ce qui a été exécuté (Node 26, PostgreSQL 15.18, Chromium, le paquet
  construit installé dans un consommateur isolé) et ce qui ne l'a pas été —
  React Native, React, Hermes, JSC, Metro, iOS, Android, Fabric, Paper, React
  Navigation, Expo. Aucun n'a été lancé. Déclarer « compatible RN 0.72 à 0.76 »
  reviendrait à extrapoler d'un test sous doubles vers un moteur, un bundler et
  un système d'exploitation que personne n'a exécutés.
- **Expo n'est pas documenté**, pour la même raison : la spec demande de ne le
  documenter que s'il est réellement testé. Rien ne s'y oppose *a priori* — le
  paquet est du JavaScript sans dépendance native — mais « rien ne s'y oppose »
  n'est pas « vérifié ».
- **Aucune publication npm ni store, et ce n'est pas supposé autorisé.** Le
  paquet reste `private: true`. Le dépôt et le build sont prêts :
  `verify-sdk-packaging.mjs` installe l'artefact réellement produit dans un
  consommateur isolé et le charge en CJS, en ESM et en types (36 contrôles).
  Ce qui manque n'est pas technique : **registre cible (public ou privé), compte
  de publication, nom définitif du paquet, politique de versions et de
  dépréciation** — quatre décisions, aucune prise. Elles ne se déduisent pas.
- **Aucune interface d'opérateur pour renseigner `verified_at`.** La colonne, sa
  contrainte et son affichage existent ; son écriture se fait aujourd'hui par
  `update` direct, documenté. Ouvrir une mutation console demanderait un droit
  RBAC nouveau (« marquer une capacité vérifiée ») qui n'existe pas et ne figure
  dans aucune des six cases. `console_ro` n'a que `select` sur la table : la
  garantie tient sans l'interface, l'inverse ne serait pas vrai.
- **`packages/rum-mobile/src/index.ts` et `core.ts` sont modifiés** au-delà de la
  seule déclaration : `MobileConfig` gagne un champ `capabilities`, `flushInterne`
  le rafraîchit, et `getDiagnostics()` gagne trois champs. Aucun signal, aucune
  navigation, aucune interaction, aucune erreur n'a été retouchée. Le type de
  `nativeCapabilities` passe de `string[] | null` toujours `null` à un tableau
  réellement rempli : personne ne pouvait en dépendre, puisqu'il n'avait jamais
  de valeur.
- **`apps/ingest/lib/pg-ingest.mjs` et `ingest-differe.mjs` sont touchés**, alors
  que P8.1 y travaillait en parallèle. Le strict minimum : une entrée
  `capabilities` dans la déstructuration de `writeRowsWithClient`, un appel à
  `ecrireCapacites` dans la transaction du lot, `runtime` ajouté aux colonnes
  optionnelles de `rum_session` et à sa clause `on conflict`, et une ligne dans
  `completer()` du drain différé — sans laquelle le chemin différé perdrait les
  déclarations en silence. Le conflit de fusion sur `writeRowsWithClient` a été
  résolu en gardant la signature de P8.1 (client fourni, verrou d'app) et en y
  ajoutant le seul paramètre nouveau.
- **Le bundle React Native grossit de 1,6 Kio gzip** (22,4 → 24,0 Kio), pour un
  module de 120 lignes et un attribut de resource. Aucun budget n'est défini sur
  ce paquet ; les 35 Kio gzip portent sur le SDK web, **inchangé à 22,1 Kio**.
- **`analytics-rollups-sql.test.ts` est INSTABLE au passage d'une heure ronde.**
  Constaté deux fois pendant ce lot, à 12:59:54 et 13:00:38 : quatre tests
  échouent, puis repassent au verdict suivant sur la MÊME base. Le test attend
  neuf mesures dont « la neuvième est celle de l'heure EN COURS » ; une exécution
  à cheval sur la bascule en compte huit. Vérifié comme **antérieur à ce lot** :
  la même base sans v82 échoue de la même façon à la même minute, et passe deux
  minutes plus tard. Il n'est pas corrigé ici — c'est du P6.6 — mais il est
  consigné : la CI peut rougir sur ce test sans qu'aucun code n'ait changé.
- **Aucune recette sur appareil réel.** La couverture native (crashes natifs,
  ANR, démarrage natif) reste « non vérifiée » : elle appartient à P8.5. C'est
  précisément ce que l'écran affiche, plutôt que de le taire.

### Preuves locales

| Preuve | Résultat |
|---|---|
| `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` | **163 fichiers, 2 279 tests verts** (161/2 223 sur la base P7.3 ; +2 fichiers et +56 tests, dont P8.1 fusionné entre-temps) |
| dont `tests/unit/rum-mobile-p75.test.ts` | 28 tests — vocabulaire, déclaration, validation serveur, trois états, taux, plateforme, transmission |
| dont `tests/unit/surfaces.test.ts` | +3 tests — la liste blanche de `/mobile` et ses refus |
| `SQL_TEST_DATABASE_URL=… pnpm test:sql` | **22 fichiers, 284 tests verts** (20/243 sur la base P7.3), 3 fichiers / 29 tests ignorés |
| dont `tests/integration/rum-mobile-p75-sql.test.ts` | 19 tests — clé `nulls not distinct`, `verified_at` intouchable, cohorte, tenants, taux, démarrage, écrans, requêtes, périmètre vide, effacement, rétention, exclusion DSAR, schéma antérieur |
| dont `tests/integration/rum-runtime-parity-sql.test.ts` | 13 tests (8 en P7.3 : +5) — paquet réel → parseur → writer → API, A/B, vieux SDK, erreur backend sans session, zéro double comptage |
| `pnpm test:isolation` | isolation multi-tenant PROUVÉE, `mobile_capabilities` comprise (portée A, portée B, portée vide, et lecture seule pour `console_ro`) |
| `pnpm --filter console exec tsc --noEmit` | aucune erreur |
| `pnpm --filter console build` | `/mobile` et `/api/v1/mobile/summary` construits |
| `pnpm -r build` | tous les paquets construits, console incluse |
| `node scripts/verify-sdk-packaging.mjs` | **36 contrôles verts** (33 en P7.3), surface publique à **28 exports** |
| `pnpm --filter @mip/rum-sdk size-check` | `dist/mip-rum.js` 63,6 Kio brut / **22,1 Kio gzip** — **inchangé** |
| `pnpm exec playwright test tests/e2e/mobile-console.spec.ts --workers=1` | **2 tests verts** — badges, chiffres, 390 px, clavier, filtre de plateforme, données manquantes, drill-down, filtre refusé, API |
| `BENCH_DATABASE_URL=… … rum-mobile-bench-p75` | index choisi dans les 3 scénarios ; 28 → 3,5 ms (24 h), 48 → 26 ms (7 j) |

Bases jetables dédiées sur le PostgreSQL 15 local (port 5433) : `p75_migration`
(chaîne complète + rejeu), `p75_prev80` (schéma de version précédente, v82 seule
appliquée dessus), `p75_sql` (recette), `p75_rls` (isolation), `p75_bench`
(banc), toutes supprimées après la recette. `DATABASE_URL` n'a jamais été
utilisée pour les tests ; l'e2e a tourné sur la base locale `mip_rum` du
conteneur de développement, comme le prévoit `playwright.config.ts`.

### La migration v82, et ce qu'elle a été testée pour faire

| Contrôle | Résultat |
|---|---|
| Chaîne complète sur base vierge | appliquée, `schema.sql` + 40 migrations |
| Rejeu de v82 sur la même base | idempotent (aucune erreur, aucun objet dupliqué) |
| v82 seule sur un schéma de version précédente (v80) | appliquée ; les sessions existantes prennent `runtime = NULL`, « Inconnu », jamais « web » |
| `nulls not distinct` (PostgreSQL 15) | trois déclarations sans release → UNE ligne, état à jour |
| `on conflict` sur une clé à NULL | l'inférence par colonnes trouve bien l'index |
| Contrainte « note sans date de vérification » | refusée |
| Contrainte `first_declared_at <= last_declared_at` | refusée quand on recule la seule dernière date |
| RLS et droits | portée A / portée B / portée vide ; `console_ro` en lecture seule, `verified_at` hors de portée |
| `erase_app_data` | emporte les capacités de l'app, et seulement les siennes |
| `purge_rum_app` | retire une déclaration qu'aucun lot ne rafraîchit plus, garde l'active |
| Catalogue P8.1 des tables app-scopées | `mobile_capabilities` traitée par l'effacement |
| Aucune projection, aucun quota | un lot rejoué écrit 6 lignes, pas 12 ; rien dans `rum_event_index` |
| Index | mesuré, choisi par le planificateur, `predeploy-v82-indexes.sql` fourni pour une table chaude |

### Recette exigée, et où elle est prouvée

| Scénario | Preuve |
|---|---|
| Filtres et plateforme | `mobile-console` e2e : `platform=android` change la cohorte, le taux et les écrans |
| Données manquantes | `mobile-console` e2e : release inexistante → 0 session, « Non calculable » et sa raison |
| Drill-down vers une issue | `mobile-console` e2e : lien vers `/errors/issues` avec `source=react_native_js` et les filtres |
| Clavier | `mobile-console` e2e : le contrôle « Plateforme » est labellisé, focusable, et la série a son alternative textuelle |
| Largeur mobile | `mobile-console` e2e : aucun débordement horizontal à 390 px |
| Payload du VRAI paquet → parseur → writer → API | `rum-runtime-parity-sql` : six capacités écrites, runtime posé, console lisant la même chose |
| A/B | `rum-runtime-parity-sql` : deux apps, deux cohortes, deux jeux de déclarations |
| Vieux SDK | `rum-runtime-parity-sql` : lot 0.3 sans `mip.capabilities` → runtime reconnu, capacités « Inconnu » |
| Erreur backend sans session | `rum-runtime-parity-sql` : une erreur `node` sans session n'entre dans aucun compteur mobile |
| Zéro double comptage | `rum-runtime-parity-sql` : même corps HTTP ingéré deux fois → 1 session, 1 page vue, 1 événement, 6 capacités |

### Ce que l'écran affiche en « Non collecté », et pourquoi

| Capacité | État affiché | Raison |
|---|---|---|
| Crashes natifs | **Non collecté** | aucun module natif MIP n'existe ; un crash natif n'est pas observable depuis le runtime JS, qui en est la première victime |
| ANR | **Non collecté** | un compteur JavaScript ne sait pas distinguer un fil principal bloqué d'une application au repos |
| Démarrage natif | **Non collecté** | le SDK ne mesure que le temps JS depuis `init()` jusqu'à un premier écran DÉCLARÉ ; ni le lancement du processus, ni le pré-main, ni l'écran de lancement |
| Reprise hors ligne | **Non collecté** par défaut | `offline.persistent` est faux tant que P8.1 n'est pas activé en production ; une file active sur un stockage muet ne persiste rien |
| Erreurs JS | Collecté si `ErrorUtils` est posé | sinon « Non collecté » : l'absence d'erreur n'est alors pas une absence d'erreur |
| Suivi des écrans | Collecté si un adaptateur de navigation est abonné | sinon « Non collecté » — ce qui ne veut PAS dire « aucune page vue » : `screen()` manuel alimente toujours la table, mais la COUVERTURE n'est pas garantie |

Une capacité dont aucune release ne dit rien s'affiche **« Inconnu »**, et non
« Non collecté » : un silence n'est pas un refus.

---

# Clôture de P7

Les cinq sous-lots sont livrés. Ce qui suit est le bilan consolidé : ce qui
existe, ce qui est suivi, et ce qui reste **non vérifié** — la troisième liste
étant la seule qui compte pour décider de la suite.

## 1. État final des cinq sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P7.1 — primitives pures et enveloppe RN | [#199](https://github.com/jt33120/poc-MIP_RUM/pull/199) | aucune | oui | oui | verte | **non** | **non** |
| P7.2 — consentement, visiteur, transport | [#202](https://github.com/jt33120/poc-MIP_RUM/pull/202) | aucune | oui | oui | verte | **non** | **non** |
| P7.3 — navigation, actions, erreurs JS | [#204](https://github.com/jt33120/poc-MIP_RUM/pull/204) | aucune | oui | oui | verte | **non** | **non** |
| P7.4 — API Node et FastAPI | [#200](https://github.com/jt33120/poc-MIP_RUM/pull/200) | aucune | oui | oui | verte | **non** | **non** |
| P7.5 — `/mobile`, API/MCP, distribution | cette PR | **v82** | oui | oui | à vérifier | **non** | **non** |

**Une seule migration pour tout P7**, et c'est délibéré : P7.1 à P7.4 n'écrivent
que des attributs déjà lus par l'ingestion depuis P2/P3/P5/P6. v82 n'arrive que
parce que `/mobile` a besoin de deux choses qui n'existaient pas — le runtime
d'une session, et un endroit où ranger ce qu'un SDK déclare collecter.

## 2. La matrice par capacité, telle que §6 du plan la demande

| Capacité | Implémenté | Testé localement | Déployé | Vérifié sur vraie app | Preuve |
|---|---|---|---|---|---|
| Contexte global / local RN | oui | oui | non | non | `rum-mobile-p72`, `rum-runtime-parity-sql` |
| User / account pseudonymes | oui | oui | non | non | HMAC app-scopé vérifié en base, aucune identité brute |
| Consentement, époques, révocation | oui | oui | non | non | `rum-mobile-p72` (44 tests) |
| Écrans (`screen` / adaptateur) | oui | oui | non | non | `rum-mobile-p73`, dédoublonnage prouvé |
| Actions et causalité | oui | oui | non | non | `rum-mobile-p73`, `rum-actions-causal-sql` |
| Timings, flags, erreurs déclarées | oui | oui | non | non | `rum-runtime-parity-sql` |
| Tracing réseau et `traceOrigins` | oui | oui | non | non | `rum-mobile-p73` — liste fermée depuis v0.3 |
| Erreurs JS non interceptées | oui | oui | non | **non** | `is_fatal` renseigné, `error_source=react_native_js` |
| Rejets de promesses | oui | oui | non | **non** | adaptateur explicite ; `unavailable` si rien n'est branché |
| Offline (retry borné) | oui | oui | non | non | `rum-mobile-p72` : acquittement avant retrait |
| Offline DURABLE | oui, **désactivé** | oui | non | non | conditionné à P8.1, désormais fusionné — l'activation reste une décision |
| API Node (`track`, `captureException`, `withContext`, `flush`) | oui | oui | non | non | P7.4, `agent-node-backend-events-sql` |
| Contexte FastAPI (ContextVar) | oui | oui | non | non | P7.4, `python3 -m unittest` |
| Écran `/mobile` et API/MCP | oui | oui | non | non | P7.5, `mobile-console` e2e + `rum-mobile-p75-sql` |
| Modèle de capacités | oui | oui | non | non | P7.5, v82 |
| **Crashes natifs** | **non** | — | — | **non** | aucun module natif ; « Non collecté » à l'écran |
| **ANR** | **non** | — | — | **non** | idem |
| **Démarrage natif** | **non** | — | — | **non** | seule la part JS est mesurée, et elle le dit dans son nom |
| **Symbolication native** | **non** | — | — | **non** | P8.5 |

## 3. Suivis consolidés — ce qui est ouvert et attribué

1. **Recette sur appareil réel (P8.5).** Application de recette, appareil ou
   simulateur, crash / relance / hors ligne, symboles et release exacte. Rien de
   P7 n'a tourné sur un téléphone. C'est le suivi le plus important de cette
   liste : il conditionne les quatre suivants.
2. **Matrice de compatibilité (P8.5).**
   [MATRICE-RUNTIME.md](../../packages/rum-mobile/MATRICE-RUNTIME.md) attend ses
   cellules : version de React Native, de React, moteur et sa version, OS,
   routeur, architecture native. Aucune n'est remplie, et aucune ne peut l'être
   depuis ce dépôt.
3. **`verified_at` sans interface d'opérateur (P7.5, ouvert).** La colonne, sa
   contrainte, son affichage et sa garantie d'écriture existent ; le geste qui la
   remplit est un `update` documenté. Une mutation console demanderait un droit
   RBAC nouveau, qui se décide à froid.
4. **Publication du paquet (non décidée).** Build et installation prouvés ;
   registre cible, compte, nom définitif et politique de versions restent à
   trancher. Ce ne sont pas des tâches techniques.
5. **Activation du stockage durable en production (P7.2 × P8.1).** P8.1 est
   fusionné, donc le prérequis technique est levé ; l'activation reste une
   décision d'exploitation, application par application.
6. **`analytics-rollups-sql` instable au passage d'une heure ronde (P6.6).**
   Quatre tests échouent quand l'exécution est à cheval sur la bascule, et
   repassent deux minutes plus tard sur la même base. Antérieur à P7.5, vérifié
   comme tel. La CI peut rougir sans qu'aucun code n'ait changé.
7. **`pnpm --filter @mip/rum-sdk exec tsc --noEmit` échoue** sur
   `packages/rum-sdk/src/replay.ts:242` (`Uint8Array` / `BodyInit`), à
   l'identique sur `master`. Pré-existant, non joué par la CI, hors périmètre P7.

## 4. Ce qui reste NON VÉRIFIÉ, et qu'il ne faut pas présenter autrement

- **Aucune ligne de P7 n'a tourné en production.** « Testé localement » n'est ni
  « déployé » ni « vérifié ». Les cinq colonnes « Déployé » sont à non.
- **Aucune ligne de P7 n'a tourné sur un appareil**, ni sur un simulateur, ni
  sous Metro. Les adaptateurs sont éprouvés contre des doubles conformes à la
  surface publique qu'ils consomment : cela prouve le contrat, pas l'intégration.
- **Aucune version réelle de React Native, React, Hermes, JSC, iOS ou Android
  n'a été exercée.** Aucune plage de compatibilité n'est donc déclarée.
- **La couverture native est nulle, et c'est visible dans le produit.** Crashes
  natifs, ANR et démarrage natif s'affichent « Non collecté » sur `/mobile`, sans
  aucun champ correspondant dans l'API. Un taux « sans crash » ne peut pas être
  dérivé de P7, et le seul taux affiché porte le nom de ce qu'il mesure :
  « sessions sans erreur JS ».
- **Un connecteur simulé n'est pas une intégration, et une erreur `ErrorUtils`
  n'est pas un crash natif.** Le plan le disait en §6 ; P7 s'y tient.

## 5. Ce que P8.5 hérite

- **Le modèle de capacités est posé et prêt à recevoir le natif.** Les trois
  valeurs `native_crashes`, `anr` et `native_start` existent dans le vocabulaire
  fermé, des deux côtés, et sont déclarées `unavailable`. Le jour où un module
  natif est livré, il n'y a rien à migrer : le SDK déclare `active`, la console
  passe de « Non collecté » à « Collecté », et l'écran cesse de dire qu'il ne
  sait pas.
- **`verified_at` attend une recette, pas un booléen.** C'est la colonne que
  P8.5 remplira, et le chemin d'ingestion est structurellement incapable d'y
  toucher.
- **AUCUNE table de crash natif n'a été créée d'avance** — la spec l'interdit, et
  la raison est la même que partout ailleurs dans ce lot : une table vide se lit
  comme un zéro.
- **`rum_session.runtime` désigne déjà la population**, et `rum_error.is_fatal`
  est renseigné depuis P7.3. Un crash natif ingéré plus tard entrera dans la même
  cohorte, avec `error_source = 'native'`, valeur déjà prévue par l'énumération
  de P5.1.
