# Livraison P6 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-analytics-dashboards-p6.md](spec-rum-analytics-dashboards-p6.md).
Base : `2a93408` (P5 livré, v74 sur Neon). Master à `154936a` le 18/09/2026.

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P6.1 — dimensions aux bonnes frontières | #191 | v75 (additive, sans backfill), 18/09 06:16 | oui | oui | verte | oui (console `05a58d0`) | non |
| P6.2 — unifier les filtres sans rupture | #192 | aucune | oui | oui | verte | oui (console `05a58d0`) | non |
| P6.3 — analyses prêtes à l'emploi et drill-downs | #193 | aucune | oui | oui, suites nommées — aucun chiffre publié | verte | oui (console `05a58d0`) | non |
| P6.4 — Explorer générique borné | #194 | aucune | oui | oui | verte | oui (console `05a58d0`, MCP `7372d55`) | non |
| P6.5 — tableaux de bord graphiques et vues enregistrées | #195 | v79, 18/09 06:16 | oui | oui | verte | oui (console `05a58d0`) | non |
| P6.6 — agrégats, budget mesuré et index | #196 | v80, 18/09 06:21 | oui | oui | verte sur `6dc0363`, **rouge sur `ae9d171`** (commit fusionné) | base et backend oui ; **console non** (Vercel en échec sur `154936a`) | non |

Le correctif de la régression décrite plus bas est la **PR #197** (`fix/rum-analytics-p6-6-plan-sans-fenetre`), **ouverte, non mergée** au moment où ce journal est écrit ; sa CI est verte.

## État de production relevé le 18/09/2026

- **Neon** : `schema_migration` porte v75 (18/09 06:16), v79 (18/09 06:16) et v80 (18/09 06:21). Les trois index de v80 —
  `idx_rum_event_app_ts_v80`, `idx_rum_event_app_release_ts_v80`, `idx_rum_event_app_env_ts_v80` — existent avec
  `indisvalid` et `indisready` à vrai (pré-déploiement `CONCURRENTLY`, comme la garde de taille de v80 l'exige).
- **Vercel** : le déploiement de production de `154936a` a **échoué** (18/09 06:22). Le dernier déploiement réussi est
  celui de `05a58d0` (fusion de #195). La console en production exécute donc P6.1 à P6.5 ; **le lecteur hybride de P6.6
  n'est pas en service**, alors que sa migration et son rafraîchissement le sont.
- **Railway** (`mip-rum-backend`, environnement `production`) : sur `154936a`, `ingest` et `scheduler` en succès ; `mcp`
  **ignoré** (aucun changement dans ses chemins surveillés) et donc toujours sur le build de `7372d55` (fusion de #194),
  lui-même en succès. Aucun service en échec. `scheduler` exécute `refresh_metric_histogram(26)` de v80
  (`apps/ingest/jobs/planifie.mjs`) : les cellules `observed_count` se remplissent même si personne ne les lit encore.
- **CI de master** : les exécutions déclenchées par les fusions de #191, #192, #194 et #195 ont été **annulées**,
  chacune par la fusion suivante — les cinq fusions vers master se suivent en sept minutes. La seule exécution menée à
  son terme est celle de `154936a`, et elle est **rouge**. La CI de master n'a donc jamais été verte sur la série P6.
- **#193 n'a pas de commit de fusion sur master** : GitHub la marque fusionnée par `e61ac96`, la fusion de
  `feat/rum-analytics-p6-3` **dans la branche de P6.5** ; ses commits arrivent sur master avec `05a58d0`. P6.3 n'a donc
  été ni fusionné ni déployé séparément de P6.5.
- **Recette sur vraie app** : non jouée. Aucun écran, aucune API, aucun outil MCP de P6 n'a été éprouvé sur des données
  réellement ingérées depuis le déploiement. La colonne « Vérifié sur vraie app » est **non** partout, sans exception.

## P6.1 — dimensions aux bonnes frontières

Livré par #191, migration v75. Le lot pose les colonnes ; il ne branche aucun filtre d'écran (c'est P6.2).

### Décisions d'implémentation

- **Parseur d'user-agent ciblé et fermé** (`apps/ingest/supabase/functions/_shared/dimensions.mjs`, pur, sans
  dépendance) : version MAJEURE seulement, et les versions figées par les navigateurs eux-mêmes (Windows NT 10.0,
  macOS 10.15, `Android 10; K`, iOS 18.6) rendues **inconnues** — une valeur gelée n'est pas une mesure. User-agent
  absent, inconnu ou hostile → NULL, jamais une catégorie par défaut.
- **L'user-agent prime sur `mip.device_type`** à la frontière session : le SDK web range les tablettes Android en
  desktop. `ios`/`android` deviennent `mobile`, la plateforme restant dans `os`. Première valeur connue conservée.
- **Robots : ni navigateur ni système**, mais la classe déclarée par le SDK est gardée — les agrégats existants, qui
  comptent par `device_type`, ne devaient pas bouger au motif qu'on ajoutait des colonnes.
- **`env` et `release` sont recopiés sur chaque signal** (vues, vitals, actions, ressources, long tasks, événements,
  spans) et sur `rum_event_index`, `service` sur les spans et la projection. Ils ne sont **jamais relus sur la
  session** : une release qui change pendant la visite, ou une session modifiée après coup, ne doivent pas réécrire le
  passé. `rum_session.release` reste la première release vue et n'est recopiée nulle part.
- **Release bornée à l'ingestion, jamais scrubbée** (1 à 120 caractères, sans caractère de contrôle ni de format
  Unicode) : `4.8.0.1` deviendrait `[ip]` et `build-17654321098` deviendrait `build-[number]`, qui ne correspondraient
  plus aux source maps ni aux marqueurs de déploiement. Hors bornes : NULL, jamais tronquée. Même règle pour
  `service.version` et pour l'upload de source maps, qui refuse (400) une release que l'ingestion ne stockerait pas.
- **Writers tolérants à la fenêtre de déploiement** (`apps/ingest/lib/pg-ingest.mjs`) : une colonne n'est écrite que si
  la table la porte, et les lots différés antérieurs sont drainés avec NULL. Le code peut précéder ou suivre la
  migration ; un retour arrière applicatif ignore les colonnes.
- **Sélecteurs de valeurs distinctes en bibliothèque seule** (`apps/console/lib/dimensions.ts` pur,
  `apps/console/lib/queries-dimensions.ts` I/O), **sans aucun endpoint** — la spec n'en demande pas : une app
  exactement, vérifiée contre `authorizedApps` avant tout SQL (`[]` = aucun accès, jamais d'union d'apps), fenêtre
  `[from,to)` UTC ≤ 30 jours, 100 valeurs au plus avec `truncated`, inconnues comptées à part, robots exclus par
  défaut, `available: false` avant v75.
- **Migration v75 additive et sans index, mesurée** : rejouable, `lock_timeout` de 5 s, aucun backfill, colonnes `text`
  nullables et 9 contraintes `NOT VALID` aux bornes exactes de l'ingestion ; aucune contrainte sur une colonne
  existante. La décision de ne créer aucun index est chiffrée dans l'en-tête de la migration, avec la charge qu'elle
  laisse au premier lecteur qui en dépendra.

### Preuves

- `pnpm test:unit` : 143 fichiers, 1 746 tests verts — `dimensions.test.ts` (corpus d'user-agents, bornes),
  `otlp-dimensions.test.ts` (frontières, release changeant en cours de session, backend sans UA ni session),
  `dimension-values.test.ts` (portée, fenêtre, SQL lié, plafond). `tsc --noEmit` console vert.
- `pnpm test:sql` sur bases jetables : 14 fichiers, 152 tests verts, dont `dimensions-v75-sql.test.ts` (rejeu double et
  contraintes, lot immédiat/différé/antérieur, RN et tablette, erreur backend sans UA, historique inchangé après
  changement de release et mise à jour de session, DSAR/purge/effacements, fenêtre v74 → v75).
  `pnpm test:isolation` et `pnpm test:alerting` verts.
- Banc (PostgreSQL 15 jetable, 1,56 M signaux et 1,56 M vues sur 7 jours, apps asymétriques 1,2 M / 300 k / 60 k,
  500 k sessions) : sélecteur sur 7 jours à 392 ms (signaux) et 37 ms (sessions) ; un index `(app_id, release, ts)`
  construit pour l'occasion **n'est pas choisi** par le planificateur. En revanche un filtre release/env sur fenêtre —
  lecteur alors non écrit — passe de 100–120 ms à 0,4–7 ms avec l'index. C'est cette mesure que P6.6 a reprise.

### Limites déclarées

Historique antérieur à v75 : dimensions NULL, affichées « Inconnu » ; l'enrichissement rétrospectif est P8. iPad sous
iPadOS 13+ compté desktop (son user-agent dit Macintosh), sans Client Hints ni détection tactile. Pas de colonne
`runtime`/`platform` : React Native se distingue par `browser` NULL et `os` iOS/Android. Le récepteur Supabase
historique `write-causal.mjs` n'écrit pas les colonnes v75. Les filtres de lecture (issues, MCP) acceptent encore une
release de 200 caractères, sur-ensemble inoffensif ; `POST /api/v1/deploys` tronque toujours `version` à 200.

## P6.2 — unifier les filtres sans rupture

Démarré le 17/09/2026 sur `feat/rum-analytics-p6-2`, base `2a93408`. **Aucune migration** : le sous-lot ne lit que
des colonnes existantes, et sonde le schéma pour savoir lesquelles existent (les colonnes de P6.1 arrivent avec v75).

### Décisions d'implémentation

- **Un seul contrat, pur** (`apps/console/lib/query-contract.ts`) : périmètre d'apps résolu contre le principal
  SIGNÉ, plage `[from,to)` UTC résolue UNE fois, filtres bornés. Les deux modèles historiques (`lib/filters.ts`
  avec `app: null`, `lib/queries-v2.ts` avec `app: 'all'`) deviennent des façades dérivées — pas un troisième modèle.
- **Périmètre vide = aucun accès, partout.** `apps: []` n'est plus « sans restriction » : middleware, sélecteur de
  projet, layout, API v1 (`/apps`, sessions, deploys, erreurs, issues), rejeu, page de session, page de trace,
  triage d'erreur et jetons `CONSOLE_API_TOKENS` de la forme `token@` (périmètre vide) refusent tous. Une app
  NOMMÉE hors périmètre est refusée (403 `forbidden_app`, ou `/select` avec la raison côté écran), jamais rabattue
  sur la première app autorisée ; « toutes » vaut désormais **toutes les apps autorisées**, lues ensemble.
- **Chunks de rejeu bornés par l'app de la session** : `replay_chunk` était lu sur le seul `session_id`, identifiant
  émis par le client. Un lot écrit par une autre app ne peut plus s'ajouter à un rejeu.
- **Compilateur à registre fermé** (`lib/query-compiler.ts`) : tables, colonnes et alias viennent du code ; toute
  valeur d'URL est un paramètre lié. Une dimension qu'un jeu de données ne porte pas donne `unsupported_dimension`
  (« sans objet ») ; une colonne absente du schéma donne « pas encore collecté » (sonde de 5 s, `lib/query-schema.ts`)
  — jamais un filtre ignoré en silence.
- **Capacités par écran** (`lib/surfaces.ts`, matrice ci-dessous) : un écran de MESURES refuse ce qu'il ne sait pas
  appliquer, avec un lien de reprise ; un écran de CONFIGURATION (SLO, règles d'alerte, liste des tableaux de bord)
  s'affiche et **dit** que les filtres de l'URL ne s'y appliquent pas. Les listes de configuration restent bornées
  par l'app ; les mesures temporelles (déclenchements, budget) gardent leur propre fenêtre, annoncée comme telle.
- **Presets inchangés** : `period` absent ou inconnu vaut 24 h, comme avant, côté API comme côté écran. La nouveauté
  est la plage personnalisée `from`/`to` (ISO UTC, 30 jours au plus, `to` ≤ heure serveur), refusée si elle est
  invalide plutôt que rabattue, et saisie en heure LOCALE de l'app (changement d'heure compris : une heure qui
  n'existe pas est refusée, une heure ambiguë prend sa première occurrence).
- **Seaux alignés sur une origine UTC explicite** (`timestamptz '2000-01-01 00:00:00+00'`) : `date_bin` sans origine
  suit le fuseau de la session PostgreSQL et décalait les seaux d'une à deux heures sur une connexion réglée sur Paris.
- **ETag** lié au principal, au périmètre autorisé ET effectif, à la plage et aux filtres : une réponse calculée pour
  une app ou un jeton ne peut plus en servir un autre. Une fenêtre glissante garde son preset dans l'empreinte —
  sinon aucune revalidation ne rendrait jamais 304, ses instants avançant à chaque appel.
- **Navigation client** : cause trouvée et corrigée (voir ci-dessous). Les ancres natives de P5 redeviennent des
  `<Link>`. Le rechargement complet après une écriture du workflow d'issue reste, pour une autre raison : il remet
  les formulaires sur l'issue relue, ce qu'un `router.refresh()` ne fait pas.

### La navigation client qui restait en suspens (suivi P5)

`delivery-p5.md` consignait : « un `<Link>` vers la même route avec une autre query et `router.refresh()` peuvent ne
jamais aboutir ». Reproduit hors Playwright, au protocole CDP sur un build de production instrumenté :

- **Cause** : les frontières `loading.tsx` de `/events`, `/errors` et `/actions`. Après un `router.refresh()` ou une
  navigation vers la MÊME route, la transition racine restait suspendue (`suspendedLanes` posé, `pingedLanes` à zéro,
  aucun callback programmé) : React n'avait plus personne pour la réveiller. Seul un tick ultérieur de l'auto-refresh
  (5 s) re-rendait l'arbre et faisait passer la navigation — d'où l'impression d'un écran figé puis rattrapé.
- **Correctif** : suppression des trois `loading.tsx`. Mesuré sur le même build : la navigation et le rafraîchissement
  commettent en ~200 ms au lieu de ne jamais aboutir. Un second défaut disparaît avec eux : un marqueur de refetch
  d'URL périmé faisait redemander l'ancienne URL à chaque rafraîchissement.
- **Preuve en CI** : `tests/e2e/navigation-filtres.spec.ts` vérifie que le lien « Réinitialiser », un changement de
  période et l'arrivée d'une ligne ingérée (auto-refresh) changent l'URL ET l'écran, sans rechargement complet —
  un marqueur posé dans le document ne survivrait pas à un rechargement.
- **AutoRefresh** : plus aucune requête quand l'onglet est caché, et jamais deux rafraîchissements empilés.

### Matrice écran × filtre

Rendue par le registre (`lib/surfaces.ts` × `lib/query-compiler.ts`), vérifiée par `tests/unit/surfaces.test.ts`.
`a → b` = ce que la colonne devient une fois la migration v75 (P6.1) appliquée ; avant elle, la dimension est
annoncée « pas encore collectée », jamais appliquée en silence.

| Écran | Plage | Appareil | Navigateur | Système | Environnement | Service | Release | Route | Pays estimé | Source de collecte | Client |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/errors/` | presets + perso | oui | — → oui | — → oui | oui | oui | oui | oui | oui | oui | oui |
| `/errors` | presets + perso | oui | — → oui | — → oui | oui | oui | oui | oui | oui | oui | oui |
| `/events` | presets + perso | oui | — → oui | — → oui | — → oui | — → oui | — → oui | oui | oui | oui | oui |
| `/actions` | presets + perso | oui | — → oui | — → oui | — → oui | — | — → oui | oui | oui | oui | oui |
| `/ux` | presets + perso | oui | — → oui | — → oui | — → oui | — | — → oui | oui | oui | oui | oui |
| `/pages` | presets + perso | oui | — → oui | — → oui | — → oui | — | — → oui | oui | oui | oui | oui |
| `/sessions/` | — | — | — | — | — | — | — | — | — | — | — |
| `/sessions` | presets + perso | oui | — → oui | — → oui | — | — | — | — | oui | oui | oui |
| `/correlation` | presets + perso | — | — | — | — | — | — | oui | — | — | — |
| `/map` | presets + perso | oui | — → oui | — → oui | — → oui | — | — → oui | oui | oui | oui | oui |
| `/experience` | presets + perso | oui | — → oui | — → oui | — | — | — | — | oui | oui | oui |
| `/tracing/` | — | — | — | — | — | — | — | — | — | — | — |
| `/tracing` | presets + perso | oui | — → oui | — → oui | — → oui | — → oui | — → oui | oui | oui | oui | oui |
| `/slo` | — | — | — | — | — | — | — | — | — | — | — |
| `/alerts` | — | — | — | — | — | — | — | — | — | — | — |
| `/dashboards/` | presets + perso | oui | — → oui | — → oui | — → oui | — | — → oui | oui | oui | oui | oui |
| `/dashboards` | — | — | — | — | — | — | — | — | — | — | — |
| `/paths` | presets | oui | — | — | — | — | — | — | oui | oui | oui |
| `/forms` | presets | oui | — | — | — | — | — | — | oui | oui | oui |
| `/goals` | presets | oui | — | — | — | — | — | — | oui | oui | oui |
| `/acquisition` | presets | oui | — | — | — | — | — | — | oui | oui | oui |
| `/retention` | presets | oui | — | — | — | — | — | — | oui | oui | oui |
| `/logs` | presets | — | — | — | — | — | — | — | — | — | — |
| `/ai` | presets | — | — | — | — | — | — | — | — | — | — |
| `/forecast` | presets | — | — | — | — | — | — | — | — | — | — |
| `/svi/` | presets | — | — | — | — | — | — | — | — | — | — |
| `/svi` | presets | — | — | — | — | — | — | — | — | — | — |
| `/` | presets + perso | oui | — → oui | — → oui | — | — | — | — | oui | oui | oui |

Lecture : `/correlation` croise les Web Vitals et le robot synthétique, qui ne porte que sa route — l'écran ne
propose donc que la route. `/sessions`, `/experience` et l'accueil comptent des sessions, qui ne portent ni route ni
release : ces filtres y sont désactivés avec leur raison. Les écrans historiques (parcours, formulaires, objectifs,
acquisition, rétention) appliquent le segment v1 et les presets seuls : tablette et « Inconnu » y sont refusés
explicitement. Les écrans sans population (SLO, alertes, liste des tableaux de bord, détail d'une session ou d'une
trace) ne filtrent que par app et le disent à l'écran.

### Preuves

- `pnpm test:unit` : 1 772 tests verts, dont `query-contract` (périmètre vide, DST Paris, bornes, segments v1/v2,
  intersections, empreinte de cache, segments enregistrés versionnés), `query-compiler` (matrice des couples,
  valeurs toujours liées, identifiants du code seul), `surfaces` et `page-filters` (matrice écran × filtre, refus
  récupérables), `api-v1-contract` (refus typés, `meta` appliqué, ETag par principal et par plage).
- `pnpm test:sql` sur bases jetables `p62_*` : 158 tests verts, dont `query-contract-sql` — la même matrice exécutée
  sur PostgreSQL (six lectures, une seule table d'attendus), le périmètre vide, l'intersection d'un widget avec une
  autre app, les bornes `[from,to)` à la milliseconde, la journée locale de 23 h du passage à l'heure d'été, et le
  refus d'une dimension qu'un jeu de données ne porte pas.
- `pnpm test:isolation`, `pnpm test:alerting` : verts. `tsc --noEmit` (console) : propre.
- E2E : `tests/e2e/navigation-filtres.spec.ts` (navigation, auto-refresh, segment v2, drill-down, refus récupérable).

### Écarts assumés

- **`period` inconnu reste 24 h** côté API : les anciennes URL gardent leur défaut documenté. Seuls les paramètres
  NOUVEAUX (plage personnalisée, dimensions, segment v2) sont refusés quand ils sont illisibles.
- **Les écrans de configuration n'échouent pas** sur un filtre de population : ils l'annoncent non appliqué. Un écran
  de mesures, lui, refuse.
- **Le catalogue MCP n'expose pas encore les dimensions** (app, période, appareil seulement) : l'Explorer générique
  (P6.4) leur donnera une forme stable. Les descriptions MCP disent en revanche la nouvelle vérité du périmètre.
- **`rum_rollup_hourly`** ne porte aucune dimension : la heatmap rollup n'est lue que si la requête s'y prête
  (aucun filtre de dimension), sinon elle repasse sur les lignes brutes.
- **Plus de squelette de chargement** sur `/events`, `/errors` et `/actions` : sans `loading.tsx`, la navigation
  attend la réponse du serveur. C'est le prix d'une navigation qui aboutit ; le streaming sera revu quand la cause
  amont (React canary vendorisé par Next) sera corrigée. Les `<Suspense>` de la coquille (navigation, barres de
  filtres) restent en place et ne reproduisent pas le blocage : seules les frontières de ROUTE le déclenchaient.
- **Lectures historiques `logs`, `SVI` et assistant IA** : elles filtrent par l'app NOMMÉE (`app_id = $1`), pas par
  le périmètre effectif. La porte projet garantit qu'un viewer y arrive toujours avec une app de son périmètre, et
  ces écrans refusent tout le reste ; leur passage au contrat viendra avec leur propre tranche.

## P6.3 — analyses prêtes à l'emploi et drill-downs

**Le corps de la PR #193 décrit P6.4 par erreur** : il a été rempli avec le texte de #194 (mêmes décisions, mêmes
chiffres, mêmes bases jetables `p64_*`), à une section près — celle sur les débordements à 390 px, qui appartient bien
à P6.3. Cette section est donc écrite à partir du diff propre de la branche (`4e89961..7484be0`) et des messages de
commit. **Aucun chiffre de test n'est disponible pour P6.3** : les nombres du corps de #193 mesurent P6.4 et ne sont
pas repris ici. Aucune migration : toutes les colonnes lues viennent de v75.

### Décisions d'implémentation

- **Un onglet de découpage est jugé sur les mesures RÉELLEMENT groupées, pas sur ce que l'écran sait filtrer.**
  L'accueil compte aussi des sessions et refuse `?route=`, mais ses Web Vitals se groupent parfaitement par route :
  c'est donc la CIBLE du lien qui bascule sur `/pages`, pas l'onglet qui disparaît. Une dimension pas encore collectée
  laisse son onglet visible mais désactivé, avec sa raison. Onglets Route / Navigateur / Système / Pays estimé /
  Appareil / Release, avec le nombre d'échantillons et les p75 LCP, INP et CLS — ou les occurrences, les sessions
  touchées et les signatures sur `/errors` (`lib/breakdowns.ts`, `lib/queries-breakdowns.ts`).
- **« Inconnu » reste un groupe à part**, compilé en `is null` dans le lien de drill-down, jamais en une chaîne qui
  pourrait aussi être une vraie valeur. Un groupe déjà contraint **s'intersecte** au lieu de se remplacer : un
  drill-down n'efface aucun filtre global. Les groupes sont plafonnés et leur nombre réel affiché ; **aucun groupe
  « Autres »**, car additionner des p75 n'a pas de sens.
- **Ressources (`/pages`)** : l'avertissement « ressources collectées selon seuil SDK » est posé AVANT les chiffres —
  le SDK n'envoie qu'au-delà de son seuil de lenteur ou en cas de blocage du rendu, vingt par page au plus. Le partage
  première/tierce partie se lit sur les origines **déclarées** de l'application, app par app, comparées à l'hôte de
  l'URL déjà collectée : le serveur ne résout et ne récupère jamais une URL de ressource. Sans origine déclarée, le
  partage est annoncé **non calculable** plutôt qu'inventé. La normalisation d'hôte vit dans un seul module testé
  (`lib/resources.ts`), pas en double en SQL.
- **Blocages du fil principal (`/pages`)** : Long Tasks et Long Animation Frames restent **séparés** — un parc mixte
  produit les deux, et un même blocage compté deux fois n'existe qu'une. Aucun cumul de durées n'est affiché : des
  blocages concurrents de plusieurs visiteurs ne s'additionnent pas en temps d'attente vécu. Les pires blocages
  portent chacun un lien vers SA session.
- **Recherche de sessions bornée à trois champs en égalité STRICTE** (`lib/sessions-search.ts`) : identifiant technique
  exact, route normalisée, release. Ni motif, ni préfixe, ni recherche par identité — une URL partageable ne doit pas
  permettre de retrouver le parcours d'une personne. Pagination par clé `(last_seen_at, session_id)` : deux pages
  successives ne peuvent ni répéter ni sauter une ligne, là où un OFFSET décalait tout dès qu'une session était revue.
- **Engagement annoncé pour ce qu'il est** (`lib/engagement.ts`) : tendance des visiteurs observés en distincts par
  seau, **jamais additionnés** ; au-delà d'un seuil de signal, durée observée médiane et part de sessions à une seule
  vue, avec leurs définitions exactes et le décompte des sessions encore actives.
- **Comparaison par version corrigée (suivi P6.1)** : elle groupait par `rum_session.release`, qui retient la PREMIÈRE
  release vue et ne bouge plus — une session traversant un déploiement faisait porter à l'ancienne version des mesures
  produites par la nouvelle. Chaque vue, mesure et erreur porte désormais la release déclarée au moment où elle est
  survenue (v75), et une session à cheval compte dans les deux : la colonne « Sessions » **cesse d'être additionnable**
  et l'écran le dit. Avant v75, repli sur la release de session, annoncé à l'écran plutôt que tu.
- **Accessibilité** : un seul arrêt de tabulation par groupe — la barre EST le lien, avec son anneau de focus ; les
  rectangles colorés sont décoratifs et chaque découpage porte son tableau « alternative textuelle ». Les définitions
  entrent dans le glossaire, et `docs/LIMITES.md` consigne ce que chaque chiffre mesure, et ce qu'il ne mesure pas.

### Cinq débordements horizontaux à 390 px, dont trois antérieurs au lot

La recette de débordement a été étendue à l'accueil, `/pages` et `/sessions`, et elle **nomme désormais l'élément
fautif** — libellé d'aide, titre de section, début du texte — au lieu de dire « la page déborde » : une liste de
classes Tailwind dit quel composant déborde, jamais lequel de ses dix exemplaires. Deux causes :

- **des bulles d'aide de 288 px centrées sur leur déclencheur**, posées après un libellé long (découpages, score de
  santé, historique de santé, cartes de Web Vitals en deuxième colonne) : elles sortaient de l'écran par la droite.
  Elles ouvrent désormais leur libellé au lieu de le clore, donc vers l'intérieur de la page, quelle que soit la
  longueur du titre. Sur les quatre nouvelles sections, la bulle est retirée avec son entrée de glossaire : la section
  porte déjà en clair, et en permanence, ce que la bulle disait au survol ;
- **des éléments de grille sans `min-w-0`**, qui ne descendent pas sous le min-content de leur contenu. Le conteneur
  défilant ne défilait donc pas : c'est la page qui s'élargissait. `/pages` portait le document à **621 px** sur une
  fenêtre de 390 (les deux tableaux de ressources), l'accueil à **493 px** (historique de santé) puis à 415 px (score
  de santé) et à 6 px de trop (facteurs du bandeau de santé). L'accueil n'était couvert par aucune recette de largeur.

### Deux ajustements imposés par la rencontre de P6.1 et P6.2

- `query-contract-sql` attendait un refus de `service` sur l'Explorer d'événements. Avec v75,
  `rum_event_index.service` existe : le filtre **s'applique**, comme l'annonçait la matrice « — → oui ». Le test
  vérifie désormais les deux faces — refus là où la dimension est sans objet, application vérifiée là où elle existe.
- `versions-loaf` semait la release sur la seule session. La comparaison lisant maintenant la release de chaque
  signal, la semence la pose sur les vues, les mesures et les erreurs.

### Preuves

Trois niveaux sans recouvrement : les décisions en pur (`tests/unit/breakdowns.test.ts`,
`tests/unit/analyses-p63.test.ts`), les requêtes sur un vrai PostgreSQL (`tests/integration/analyses-p63-sql.test.ts`,
avec une population construite pour que chaque affirmation ait son contre-exemple — lignes sans dimension, session à
cheval sur deux releases, ressource de l'app A servie par un hôte déclaré de l'app B, LoAF et Long Tasks côte à côte,
session commencée avant la fenêtre et session encore active à sa fin), et ce que l'utilisateur obtient en cliquant
(`tests/e2e/analyses-drilldowns.spec.ts` : onglet qui change l'URL ET l'écran, drill-down au clavier seul, alternative
textuelle, lien vers la session d'un blocage, refus de recherche récupérable, aucun débordement à 390, 768 et
1440 px). CI de #193 verte : unitaires, E2E Playwright, docker-smoke, mcp-smoke. **Aucun compte de tests n'est publié
pour ce lot** — ni dans le corps de la PR, ni dans les messages de commit.

## P6.4 — Explorer générique borné

Livré par #194. **Aucune migration** : le lot ne lit que des colonnes existantes (v75 comprise) et sonde le schéma pour
savoir lesquelles existent. Un utilisateur compose une mesure au lieu d'en choisir une prédéfinie ; le même AST
versionné sert à l'écran `/explorer`, à `POST /api/v1/explorer/query`, à l'outil MCP `mip_rum_query_explorer` et, en
P6.5, aux tableaux de bord.

### Décisions d'implémentation

- **Registre fermé** (`apps/console/lib/analytics-schema.ts`) : neuf jeux de données repris du contrat P6.2 — même
  table, mêmes dimensions, même sonde — auxquels s'ajoutent unité, population, agrégations autorisées, sous-population
  et avertissement de collecte. Les identifiants SQL viennent EXCLUSIVEMENT de là ; la seule chaîne de l'appelant qui
  touche le SQL est un nom de propriété JSON, et il y entre en paramètre lié.
- **Une seule population** (`lib/analytics-compiler.ts`) : total, groupes, tendance et journal partent du MÊME CTE,
  dans UNE transaction `repeatable read read only`. Le journal paginé n'alimente aucun graphe, et le total est calculé
  indépendamment du top-N. Pour une série, les groupes du haut sont choisis une fois sur toute la fenêtre puis rendus
  dans TOUS les seaux.
- **Zéro n'est pas null** : un dénombrement réellement vide vaut `0` ; une moyenne ou un percentile sans échantillon
  vaut `null`. Un seau sans ligne n'est comblé à zéro que si l'agrégation est additive (`meta.additive`).
- **Budget rendu avec la transaction** : `SET LOCAL statement_timeout`, jamais fuité vers la requête suivante par le
  pooler. Au-delà : `503 query_budget_exceeded` — jamais une série de zéros qu'on lirait comme du calme.
- **`POST` est une LECTURE** : l'AST ne tient pas dans une query string, la route n'écrit rien et s'authentifie
  exactement comme les `GET` (jeton en lecture seule accepté). Deux tests changent de prédicat et le disent :
  `api-doc-verite` tient désormais deux listes exactes (écritures / lectures en POST), et le test « n'expose que de la
  lecture » du serveur MCP ne regarde plus le VERBE — qui ne prouve plus rien — mais la ROUTE visée.
- **Clés de groupe = tuples JSON**, jamais une concaténation : la recette les éprouve avec des valeurs contenant `;`,
  `:` et `·`.
- **`GET /api/v1/explorer/schema` publie des capacités, pas un schéma** : ni table, ni colonne, ni valeur client. Un
  test l'a pris en défaut — les identifiants de colonnes de journal reprenaient les noms SQL (`device_type`,
  `started_at`, `session_id`…) ; ce sont désormais des noms d'API distincts.
- **Écran `/explorer`** : rien ne part avant « Exécuter » (pas de requête par frappe), résumé en français de ce qui est
  RÉELLEMENT appliqué, curseur remis à zéro à toute modification — il n'est pas un champ du formulaire —, états
  chargement / vide / erreur / partiel / succès. Changer de jeu de données est un LIEN, pas une liste du formulaire :
  les mesures d'un jeu n'existent pas dans un autre.
- **« Enregistrer dans un tableau de bord »** n'est proposé qu'avec le droit d'écriture et n'expose que l'AST
  canonique, aucune donnée de résultat. Le stockage arrive avec P6.5 : ce lot expose le crochet.
- **Curseur scellé à l'empreinte de requête** (suivi P6.2) : `explorerFingerprint(query, plan)` entre dans le curseur ;
  une requête modifiée rend `stale_cursor` plutôt qu'une page d'une autre population. Un curseur ne s'enregistre pas
  (« une page n'est pas une analyse ») et ne pagine que le journal.

### Preuves

`pnpm test:unit` 1 939/1 939 · `pnpm test:sql` 188/188 sur bases jetables `p64_*` · `pnpm test:isolation` ·
`pnpm test:alerting` · `tsc --noEmit` · `next build` console. Playwright `tests/e2e/analytics-explorer.spec.ts` joué
par la CI. La recette de la spec est exécutée cas par cas : nom de colonne hostile, cast JSON (la chaîne « 42 » n'est
pas le nombre 42 ; une ligne legacy dont `props` n'est pas un objet ne fait pas échouer la requête), champ sensible
absent du catalogue (`message`, `stack`, `user_id_hash`, `context` → `unsupported_measure`, sans dire s'ils existent),
deux dimensions dont les valeurs portent des séparateurs, top stable sur plusieurs seaux, timeout rendu
**déterministe** par un verrou exclusif plutôt que par un délai court, curseur falsifié ou plage changée, zéro résultat
réel, percentile null.

### MCP

Quinzième outil `mip_rum_query_explorer` — même AST, mêmes bornes, mêmes erreurs. Les outils P4/P5 gardent leurs
descriptions et leurs contrats, et aucun ne s'est mis à écrire. Compte mis à jour dans `docker-smoke.yml` et
`docs/MCP.md`. Un budget dépassé dit qu'il n'y a PAS de résultat, là où le 503 générique disait « inutile de
reformuler ».

## P6.5 — tableaux de bord graphiques, propriété et vues enregistrées

Livré par #195, migration v79. Branche partie de `feat/rum-analytics-p6-4`, avec `feat/rum-analytics-p6-3` fusionnée
dedans.

### Décisions d'implémentation

- **Widget `schemaVersion: 2`** : un AST canonique de l'Explorer (`query`, **sans app ni fenêtre**), une
  `visualization`, des `filters` propres à la carte et un `rangeOverride` facultatif borné à 30 jours. L'adaptateur de
  lecture traduit v1 et v2 vers un modèle unique, mais la sérialisation réécrit **chaque widget dans sa version
  d'origine** : ouvrir un tableau v1 ne le convertit pas, et un retour arrière applicatif retrouve le JSON qu'il avait
  écrit.
- **Une carte illisible ne disparaît plus.** La v1 écartait silencieusement toute entrée qu'elle ne comprenait pas :
  un layout écrit par une version plus récente perdait ses cartes à la première écriture. Elle devient une carte de
  diagnostic qui porte sa raison et son JSON intact, corrigible par qui a le droit d'écrire.
- **On n'empile que ce qui s'additionne** (`meta.additive`) : empiler des p95 par navigateur dessinerait une somme qui
  n'existe pas ; sinon, une courbe par groupe. `LineTrend`, `StackedBars`, `RankBar` — pas d'éditeur de formule libre,
  et la table textuelle équivalente est toujours là.
- **Propriété par clé étrangère** : `dashboard.owner_id` pointe `console_user`, résolu depuis le `created_by` existant
  quand le compte est connu, sinon propriétaire hérité (`NULL`). La clé prime sur l'adresse — sans elle, un compte
  recréé avec le même e-mail hériterait des tableaux de son homonyme.
- **Les gestes sont énumérés, plus devinés** : `DASHBOARD_ACTIONS` (`read`, `export`, `rename`, `move_app`, `delete`,
  `add_widget`, `remove_widget`, `reorder_widget`, `configure_widget`, `clone`), chacun avec sa ligne de matrice et son
  test. Une session démo lit sans écrire ; un viewer autorisé lit tout son périmètre mais n'écrit que le sien ; **un
  admin scopé est l'administrateur de ses apps** — le rôle ne franchit plus la liste qu'on lui a signée ; et être
  propriétaire n'ajoute aucun droit hors périmètre. S'ajoutent clone (nouvel id, cloneur propriétaire, même app),
  `revision` et conflit 409 annoncé à l'écran, filtres et fenêtre par carte, ordre au clavier annonçant sa position.
- **Vues enregistrées** : `analytics_saved_view(id, app_id, owner_id, name, query_json, revision, …)`, AST versionné,
  50 par compte **et** par app (compté dans la transaction, derrière un verrou consultatif), nom ≤ 100. Lecture par le
  propriétaire ou un admin autorisé sur l'app ; **écriture par le propriétaire seul, session uniquement** : un jeton
  `CONSOLE_API_TOKENS` reçoit un refus explicite, pas une liste vide qu'on lirait comme « aucune vue n'existe ». Une
  vue **nomme toujours son app** — « toutes » mesurerait une population différente selon son lecteur. Ouvrir une vue,
  c'est **rejouer** la requête, jamais afficher un résultat figé ; une vue dont l'AST n'est plus lisible reste
  éditable au lieu d'être supprimée en silence.
- **Charge** : la grille se charge par vagues de **4** — vingt-quatre cartes lancées ensemble ouvriraient vingt-quatre
  transactions sur un pool de dix connexions. Cache court (10 s, 200 entrées, clé incluant le périmètre **effectif**),
  aucun rafraîchissement automatique, `AbortSignal` passé à l'export : une page quittée n'ouvre pas les lectures
  restantes.
- **Export CSV** : même AST, mêmes permissions, même fenêtre ; plafond **global** de 10 000 lignes avec la troncature
  **écrite dans le fichier**, et toute cellule commençant par `=`, `+`, `-` ou `@` préfixée — un export ne doit pas
  devenir une formule exécutée par un tableur. PDF = impression de la vue existante.

### Migration v79

Additive, rejouable, PostgreSQL 15 à 17, `lock_timeout` de 5 s, garde de dépendance sur v18/v72.
`analytics_saved_view` : FK app et compte (`on delete set null` — une vue orpheline reste lisible d'un admin, jamais
publique), contrainte nommée (nom borné, `query_json` objet dont `version` est un nombre, 32 Kio, `revision >= 1`), un
index servant la liste **et** le plafond. `dashboard` reçoit `owner_id` et `revision` en contraintes **NOT VALID**,
avec un backfill idempotent depuis `created_by`. RLS `tenant_scope` en lecture et écriture, droits `console_ro` —
`app_id` et `owner_id` non modifiables, ce serait un partage déguisé. `erase_app_data` reprend v72 intégralement et
**rétablit la suppression des dashboards**, perdue lors de la reprise de v61 : un effacement d'app laissait derrière
lui les tableaux scopés sur elle. `purge_rum_app` reste **inchangée**, délibérément : une analyse enregistrée est de la
configuration, pas une observation datée ; l'effacer au bout de trente jours supprimerait le travail d'un utilisateur
au motif qu'il n'a rien mesuré récemment. Aucun index sur une table de signaux RUM : ce terrain est celui de P6.6.

### Preuves

- `pnpm test:unit` : 155 fichiers, **2 029 tests** verts ; `tsc --noEmit` et `next build` console verts.
- `pnpm test:sql` sur bases jetables `p65_*` : 18 fichiers, **233 tests** verts, dont `saved-views-v79-sql` (rejeu
  double, contraintes, RLS et droits `console_ro` sous `set local role`, plafond 50, conflit 409, effacement d'app,
  rétention, fenêtre de déploiement v78 → v79 appliquée **en cours de test**).
- `pnpm test:isolation` et `pnpm test:alerting` verts sur bases dédiées.
- E2E `tests/e2e/dashboards-analytics.spec.ts` (Explorer → carte → rechargement → duplication → CSV, vue enregistrée,
  carte invalide conservée, refus jeton et CSRF, ordre au clavier, 390/768/1440 px) : **joué par la CI, pas en local**.

### Fenêtre de déploiement

La console publiée **avant** la migration sonde l'absence de la table et des colonnes : les vues s'annoncent
indisponibles, le propriétaire reste l'e-mail `created_by`, la révision vaut 1, et aucune écriture n'échoue. Le code
antérieur encore en service **après** n'écrit ni `owner_id` ni `revision` : les valeurs par défaut s'appliquent.

## P6.6 — agrégats, budget mesuré et index

Livré par #196, migration v80. Le périmètre ne touche ni tableaux de bord, ni vues enregistrées, ni v79 — P6.5 était
développé en parallèle.

### La règle, et ce qu'elle refuse

Un agrégat ne répond **que** s'il porte toutes les dimensions demandées — celles du regroupement ET celles des filtres
— et exactement la même population. La vérification est déclarative (`apps/console/lib/analytics-rollups.ts`), pas une
suite de `if` dans le SQL. Deux sources sont déclarées, une seule est lue, et le registre dit **pourquoi** l'autre ne
l'est pas :

- **`rum_rollup_hourly` reste inutilisé par l'Explorer**, pour deux raisons vérifiables : son rafraîchissement ne
  filtre pas `is_bot`, donc sa population n'est pas celle que l'Explorer mesure et aucune arithmétique ne rapproche
  deux populations ; et il ne tient **aucun filigrane** — ni instant, ni identifiant : rien ne sépare les heures
  consolidées des lignes à relire, donc la partition serait un pari, pas une preuve. Mieux vaut un agrégat inutilisé
  qu'un total faux. Il reste lu par la heatmap historique (`lib/queries-grid.ts`), inchangée par ce lot.
- **`metric_histogram_hourly` sert le p75 et le p95 des Web Vitals** : il exclut les robots, porte l'appareil et
  stocke une distribution fusionnable.

### Percentiles, dénominateur, hybridation

Les distributions horaires sont **fusionnées**, puis le quantile est lu sur la distribution obtenue. Moyenner des p75
horaires donnerait à une heure creuse le poids d'une heure de pointe : le test unitaire chiffre l'écart à **plus de
40 %** sur une journée creuse/pointe, là où la fusion tient dans la largeur de seau (2 %).

Le dénominateur manquait. `weighted_count` (v61) somme des **poids d'échantillonnage** ; l'Explorer compte `observed`.
v80 ajoute `observed_count`, écrit **à côté** et non à la place. Une cellule restée à 0 est une cellule antérieure à
v80 jamais rafraîchie depuis : la lecture refuse de la croire et relit son heure en brut.

Une ligne vient de l'agrégat **si et seulement si** son heure est entière, sous le filigrane, réellement agrégée et non
invalidée, **et** son identifiant sous le filigrane d'identifiant. Le brut reprend exactement le complément. L'heure en
cours n'y est jamais — le filigrane appartient au passé — donc aucun double comptage n'est possible **par
construction**, pas par vigilance. `meta.source` (`raw` | `rollup+raw`), `meta.approximate` et `meta.rollup.reason`
sont exposés par l'API, le MCP et l'écran. Une arrivée tardive est relue brute puis absorbée sans doublon ; un
effacement DSAR **marque** l'heure (`analytics_rollup_invalidation`) au lieu de supprimer sa cellule — une cellule
absente est indiscernable d'une heure sans trafic, et la lecture rendrait zéro. **Les distincts ne sont jamais servis
par un agrégat** : la somme des sessions distinctes horaires compte deux fois une session qui traverse minuit, et
aucune structure fusionnable (HLL, t-digest) n'existe dans ce dépôt.

### Deux défauts trouvés en mesurant

1. **Le rafraîchissement fusionnait au lieu de remplacer.** `on conflict do update` ne touche que les cellules que la
   nouvelle agrégation produit : une cellule dont plus aucune ligne ne relevait — après un effacement — survivait à son
   propre recalcul et continuait d'être comptée. La fenêtre est désormais vidée puis réécrite, heures entières seules.
2. **Sa jointure de session n'était pas bornée par l'app** (`using (session_id)`, un identifiant émis par le client) :
   deux apps émettant le même `session_id` échangeaient leur appareil et leur poids. La lecture brute, elle, joint
   déjà app + session — sans cette correction, les deux chemins n'auraient pas groupé les mêmes lignes.

### Budget et mesures

`statement_timeout` posé en `SET LOCAL`, rendu avec la transaction. Le test SQL le prouve sur un pool d'**une**
connexion — seul montage où une fuite par le pooler serait visible : après un dépassement, `show statement_timeout`
rend `0`. La borne des points de série est vérifiée **avant** tout SQL.

Banc sur base jetable PostgreSQL 15.18 (conteneur aarch64, 738 Mio), semée par `generate_series` seul, aucune donnée
client : `rum_event` 1 200 000 lignes (app A 1 M, B 150 k, C 50 k), `rum_metric` 600 000, `rum_pageview` 400 000,
`rum_error` 250 000, `rum_session` 120 000. `tests/integration/explorer-bench-p66.test.ts` compile le SQL réellement
exécuté, imprime son plan `EXPLAIN (ANALYZE, BUFFERS)`, puis chronomètre 20 lectures après chauffe. Gains p50/p95 les
plus nets : total 24 h 93/139 → 41/45 ms, filtre release 24 h 86/103 → 35/41 ms, filtre env sélectif 24 h 84/86 →
29/48 ms, p75 LCP par appareil 239/265 → 172/182 ms (agrégat), série 7 j filtrée env groupée par release 1 099/1 532 →
947/987 ms. Les lectures qui **ne changent pas de plan** varient d'environ ±30 % au p95 d'une exécution à l'autre —
seules celles qui changent de plan se comparent. Rafraîchissement horaire : 590 ms pour 600 000 mesures,
27 062 cellules écrites, 4,7 Mio.

**Objectif de test tenu** : ≤ 2 s au p95 à chaud pour 1 M d'événements sur 7 jours et par app — la lecture la plus
lourde tient à **987 ms**. Ce n'est **pas** un SLA de production : la mesure vaut pour ce matériel, ce volume et ce
jeu. Le budget **reste à 5 s** après mesure, et ce n'est pas un oubli : le descendre échangerait une réponse lente
contre une erreur, alors que la marge n'a jamais été entamée.

### Décision d'index

Créés sur `rum_event` seul : `(app_id, ts)`, `(app_id, release, ts)`, `(app_id, env, ts)` — 18 + 21 + 21 Mio. La table
n'avait **aucun** index sur `(app_id, ts)` : toute lecture de l'Explorer la parcourait entière. `(app_id, env, ts)` est
conservé bien qu'il ne serve pas sur une valeur majoritaire (`env = prod`, 60 % des lignes, où le planificateur préfère
à juste titre le parcours) : il paie sur une valeur sélective, 84 → 29 ms. **Aucun index sur `rum_error` ni
`rum_metric`** : construits et mesurés, ils n'ont jamais été choisis — 250 k lignes se parcourent en 60 ms, et les Web
Vitals passent déjà par `idx_metric_name_ts` (v18). Sur 7 jours, **aucun index ne remplace un parcours** : c'est la
matérialisation du CTE `population` qui domine, et elle a été réduite côté SQL — la ligne matérialisée passe de 61 à
33 octets, les fichiers temporaires de 45 Mio à 13, et le p95 de 1 532 à 987 ms.

### Migration v80

Additive, idempotente, PG 15–17, `lock_timeout` de 5 s, **aucun recalcul historique**. Les trois index portent la garde
de taille du motif v68 : au-delà de 32 Mio, la migration **refuse** un build bloquant et renvoie vers
`predeploy-v80-indexes.sql` (`CREATE INDEX CONCURRENTLY`, hors transaction) — ce qui est le chemin effectivement pris en
production. S'ajoutent `metric_histogram_hourly.observed_count` (`default 0`, écrit au catalogue),
`analytics_rollup_invalidation` avec une RLS à portée tenant explicite (`app_id = any(current_app_ids())`, jamais
`using (true)`, que `verify-tenant-isolation.mjs` refuse), le nouveau `refresh_metric_histogram`, `erase_session` qui
relève les heures touchées **avant** la suppression dans la même instruction, et `purge_rum_app` / `erase_app_data` qui
emportent les marques. La sonde de schéma (`lib/query-schema.ts`) vérifie les dix paires `table.colonne` exigées : il en
manque une et la lecture reste brute, en le disant (`meta.rollup.reason`).

### Preuves

`pnpm test:unit` **2 001 verts** (154 fichiers, dont 22 nouveaux sur le registre d'agrégats) · `tsc --noEmit` propre ·
`pnpm test:sql` sur bases `p66_*` **236 verts**, 12 ignorés, dont 13 nouveaux · `pnpm test:isolation` et
`pnpm test:alerting` verts · banc hors CI, ignoré sans `BENCH_DATABASE_URL`. Le test SQL rejoue la recette : hybride et
brut rendent le même percentile ; l'heure en cours n'est comptée qu'une fois ; une arrivée tardive compte une fois, et
une seule ; un effacement DSAR invalide l'heure et le compte redevient juste ; une cellule antérieure à v80 retombe sur
le brut ; une dimension hors de l'agrégat le disqualifie avec sa raison ; un distinct n'y passe jamais ; le budget ne
fuit pas.

Ces chiffres sont ceux de la branche **avant** sa fusion avec master. La fusion, elle, a cassé la CI — voir ci-dessous.

## La régression de fusion arrivée sur master

Deux vérités écrites séparément se sont rencontrées à la résolution du conflit de #196 :

- **P6.6** borne le nombre de points d'une série **avant tout SQL** — `parseExplorerPlan`, dans
  `apps/console/lib/analytics-schema.ts`, appelle `bucketStarts(query.range)` ;
- **P6.5** autorise un plan **sans fenêtre** : une carte de tableau de bord ou une vue enregistrée n'a pas de plage à
  elle, elle hérite de celle de son lecteur. `query` y vaut `null`.

Le garde déréférençait donc `null`. Conséquences sur `154936a` :

- **la console ne compile pas** : `./lib/analytics-schema.ts:977:54 — Type error: 'query' is possibly 'null'` ;
- **le déploiement Vercel de master a échoué** (18/09 06:22), et la production reste sur `05a58d0` ;
- **deux tests échouent**, un par fichier : `tests/unit/dashboards.test.ts` › « serializeLayout — chaque widget repart
  dans SA version » › « construit une carte depuis un plan, sans app ni fenêtre », et
  `tests/unit/dashboards-analytics.test.ts` › « résolution d'une carte analytique » › « n'empile une série QUE si la
  mesure s'additionne ». L'exécution CI de `ae9d171` s'arrête à 2 fichiers en échec sur 156. Le corps de la **PR #197**
  annonce « deux tests de `tests/unit/dashboards.test.ts` » : le journal de CI en place un dans chacun des deux
  fichiers. Trois vérifications sur six sont en échec (unitaires, E2E, Vercel) ; `docker-smoke` et `mcp-smoke` passent —
  ils ne compilent pas la console.

**Correctif : PR #197** (`fix/rum-analytics-p6-6-plan-sans-fenetre`), **ouverte, non mergée** au moment où ce journal
est écrit, CI verte. Une ligne : la borne ne s'applique que si `query` existe — c'est-à-dire **à la lecture**, où la
fenêtre est connue. La PR annonce 156 fichiers et 2 051 tests verts avec le correctif. La borne P6.6 de 300 points
reste appliquée partout où elle protège.

**Ce que cet épisode dit.** Un merge propre au texte ne l'est pas au sens : `git` n'a signalé aucun conflit sur la
ligne fautive. Seule l'exécution des tests **après résolution** l'a montré. La CI de la PR d'origine, verte sur
`6dc0363`, ne pouvait pas la voir : elle précédait le merge. L'exécution déclenchée par le commit de fusion `ae9d171`,
elle, était rouge — et la PR a été fusionnée **49 secondes après son démarrage**, avant qu'elle n'ait de verdict.

## Suivis consolidés

### Résolus par P6.3 à P6.6

- ~~**`comparaisonVersions` groupe par la release de la SESSION**~~ — **résolu en P6.3** : chaque vue, mesure et erreur
  porte la release déclarée au moment où elle est survenue (colonnes v75) ; une session à cheval compte dans les deux
  versions et l'écran dit que la colonne « Sessions » n'est plus additionnable. Repli annoncé avant v75.
- ~~**Breakdowns et drill-downs cliquables**~~ — **résolu en P6.3** (#193) : onglets Route / Navigateur / Système /
  Pays estimé / Appareil / Release sur l'accueil, `/pages` et `/errors`, drill-downs qui intersectent au lieu de
  remplacer, « Inconnu » compilé en `is null`.
- ~~**Explorer générique et `POST /api/v1/explorer/query`**~~ — **résolu en P6.4** (#194), avec
  `GET /api/v1/explorer/schema` et l'outil MCP `mip_rum_query_explorer`.
- ~~**Curseur lié à l'empreinte de requête**~~ — **résolu en P6.4** : l'empreinte est **scellée dans le curseur** ; une
  requête modifiée rend `stale_cursor` au lieu d'une page issue d'une autre population. Un curseur ne s'enregistre pas
  et ne pagine que le journal.
- ~~**Le catalogue MCP n'expose pas les dimensions**~~ — **partiellement résolu en P6.4** : le quinzième outil
  `mip_rum_query_explorer` porte l'AST complet, dimensions comprises. Les outils P4/P5 gardent leurs descriptions et
  leurs contrats : leurs propres filtres restent app, période et appareil. Reste ouvert pour eux.
- ~~**Brancher les dimensions de P6.1 aux écrans**~~ — **résolu en P6.2/P6.3/P6.4** pour l'application des filtres : la
  matrice a basculé seule une fois v75 sur master, les découpages de P6.3 groupent par navigateur, système, release, et
  le registre de P6.4 les déclare. **Mais** les sélecteurs de valeurs restent sans consommateur — voir ci-dessous.

### Ouverts

- **Sélecteurs de valeurs de dimension sans consommateur** : `apps/console/lib/dimensions.ts` et
  `apps/console/lib/queries-dimensions.ts` (P6.1) ne sont importés par aucune page, aucun composant et aucun endpoint —
  seul `tests/integration/dimensions-v75-sql.test.ts` les appelle. Les valeurs proposées à l'utilisateur ne viennent
  donc toujours pas des données.
- **`rum_rollup_hourly` déclaré mais jamais lu par l'Explorer** (P6.6) : son rafraîchissement ne filtre pas `is_bot`
  (population différente) et il ne tient aucun filigrane (aucune partition démontrable). Il **garde aussi sa jointure
  de session non bornée par l'app** : elle n'est corrigée que là où elle est consommée. Il reste lu par la heatmap
  historique de `lib/queries-grid.ts`, hors du périmètre P6.
- **Aucune reprise historique des marques d'invalidation** (P6.6) : une marque plus vieille que la fenêtre de
  rafraîchissement (26 h) n'est jamais levée ; son heure reste lue **brute** jusqu'à une reprise historique — c'est P8.
  Lent, jamais faux.
- **Aucun distinct servi par agrégat** (P6.6) : ni HLL ni t-digest n'existent dans ce dépôt, et la somme des sessions
  distinctes horaires compterait deux fois une session qui traverse minuit. Les distincts se lisent en brut, borné.
- **La série temporelle des Web Vitals reste brute** (P6.6) : un percentile par seau multiplierait les distributions à
  fusionner par le nombre de seaux, pour un gain que la mesure ne montre pas. `meta.source` le dit.
- **Un administrateur scopé n'est plus transverse** (P6.5) : le rôle ne franchit plus la liste d'apps qu'on lui a
  signée, et être propriétaire n'ajoute aucun droit hors périmètre. Écart assumé par rapport à un « admin » global.
- **Les écritures de vues enregistrées sont réservées à une session** (P6.5) : un jeton `CONSOLE_API_TOKENS` reçoit un
  refus explicite, jamais une liste vide. Le **partage app-wide** d'une vue reste à concevoir, comme le
  glisser-déposer et l'export PNG.
- **Les temps mesurés valent pour ce matériel et ce jeu synthétique** (P6.6) : aucun profil de charge réel n'a été
  observé, et le budget de 5 s est un objectif de test, pas un SLA de production.
- **Historique antérieur à v75** : dimensions NULL, affichées « Inconnu » ; l'enrichissement rétrospectif est P8. iPad
  sous iPadOS 13+ compté desktop. `write-causal.mjs` (récepteur Supabase historique) n'écrit pas les colonnes v75.
- **Plus de squelette de chargement** sur `/events`, `/errors` et `/actions` (P6.2) : inchangé par P6.3 à P6.6.
- **Lectures historiques `logs`, `SVI` et assistant IA** (P6.2) : elles filtrent toujours par l'app NOMMÉE, pas par le
  périmètre effectif ; leur passage au contrat viendra avec leur propre tranche.
- **Master est rouge** tant que #197 n'est pas fusionnée, et la console de production reste sur `05a58d0` : **le
  lecteur hybride de P6.6 n'est pas en service**, alors que sa migration v80 et son rafraîchissement horaire le sont.
- **Recette sur vraie app** : à jouer pour les six sous-lots — découpages et drill-downs sur des données réellement
  ingérées, Explorer et son API, tableau de bord v2, vue enregistrée, export CSV, et la bascule `raw` / `rollup+raw`
  annoncée par `meta.source` une fois la console à jour.
