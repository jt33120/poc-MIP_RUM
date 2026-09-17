# Livraison P6 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-analytics-dashboards-p6.md](spec-rum-analytics-dashboards-p6.md).
Base : `2a93408` (P5 livré, v74 sur Neon).

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P6.1 — dimensions aux bonnes frontières | #191 | v75 (additive, sans backfill) | oui | oui | verte | non — PR ouverte | non |
| P6.2 — unifier les filtres sans rupture | — | aucune | oui | oui | à ouvrir | non | non |
| P6.3 — analyses prêtes à l'emploi | — | — | non | — | — | — | — |
| P6.4 — Explorer générique | — | — | non | — | — | — | — |
| P6.5 — dashboards graphiques, vues enregistrées | — | — | non | — | — | — | — |
| P6.6 — agrégats et performance | — | — | non | — | — | — | — |

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

### Suivis pour P6.3 / P6.4

- Brancher les dimensions de P6.1 (`browser`, `os`, `env`, `release`, `service`) une fois v75 sur master : la matrice
  ci-dessus bascule seule, mais les sélecteurs de valeurs (`lib/queries-dimensions.ts`) restent à exposer à l'UI.
- `comparaisonVersions` (P4) groupe encore par la release de la SESSION : à basculer sur la colonne par occurrence.
- Les breakdowns (onglets Route / Navigateur / OS / Pays / Appareil / Release) et les drill-downs cliquables sont
  P6.3 ; l'Explorer générique et `POST /api/v1/explorer/query` sont P6.4.
- Curseur lié à l'empreinte de requête : aujourd'hui un changement de filtre retire le curseur côté UI ; l'Explorer
  P6.4 devra le sceller dans le curseur lui-même.
