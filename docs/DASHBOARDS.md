# Tableaux de bord configurables + export (P1, étendu P6.5)

> Laisser chaque équipe composer ses propres vues (COPIL, run, perf) et les exporter
> (CSV / PDF). Contrat SQL : `apps/ingest/sql/migration-v18.sql`, puis `migration-v79.sql`
> (propriétaire, révision, vues enregistrées). Console : `/dashboards`, `/explorer/views`.

## Modèle

Un **dashboard** = un nom, une app (optionnelle, `null` = toutes), une **liste de
widgets** sérialisée en `jsonb` (`layout`), un **propriétaire** et une **révision**.
Table `dashboard(id, name, app_id, layout, created_by, owner_id, revision, created_at,
updated_at)`. Aucune nouvelle table de données : les widgets **réutilisent les requêtes
existantes** ou l'exécuteur de l'Explorer.

### Widgets v1 — les six types historiques

| type | source | rendu |
|---|---|---|
| `vital_p75` | `vitalsP75` | grand chiffre p75 d'un Web Vital (LCP/INP/CLS/FCP/TTFB) |
| `traffic` | `dailyTraffic` | pages vues / erreurs par jour |
| `slow_routes` | `slowRoutes` | top routes par LCP/INP p75 |
| `top_errors` | `listErrorGroups` (`lib/queries-errors.ts`) | top erreurs (occurrences, sessions) — même population que l'écran Erreurs : segment, bots et apps internes compris |
| `frustration` | `topFrustrations` | rage/dead clicks par cible |
| `event_count` | `eventCount` (`lib/queries-events.ts`) | nombre d'événements custom d'un nom |

### Widgets v2 — une analyse enregistrée (P6.5)

```json
{
  "schemaVersion": 2, "type": "analytics", "title": "Erreurs par release",
  "query": { "version": 1, "dataset": "errors", "measure": {"aggregation": "sum", "field": "occurrences"},
             "filters": [], "groupBy": ["release"], "limit": 10 },
  "visualization": "toplist",
  "filters": [{"field": "os", "operator": "eq", "type": "string", "value": "iOS"}],
  "rangeOverride": {"preset": "7d"}
}
```

- `query` est l'**AST canonique** de l'Explorer (`lib/analytics-schema.ts`), **sans app ni
  fenêtre** : elles appartiennent au tableau de bord qui affiche la carte. Un widget ne peut
  donc ni changer d'app, ni figer une fenêtre à l'insu de l'écran.
- `visualization` : `value`, `toplist`, `timeseries` ou `table`. Les graphiques réutilisent
  `LineTrend`, `StackedBars` et `RankBar` — **pas d'éditeur de formule libre**.
- `filters` : conditions **propres à la carte**. Elles s'AJOUTENT aux filtres de l'écran
  (ET) ; elles ne remplacent rien. Les drapeaux robots / apps internes de l'AST ne peuvent
  que **restreindre** ceux de l'écran, jamais les rouvrir.
- `rangeOverride` (facultatif, borné à 30 jours) : preset glissant ou deux instants UTC.
  **Affiché sur la carte.** Sans lui, la carte suit la fenêtre globale — et le dit aussi.
- On n'**empile** une série que si la mesure s'additionne (`meta.additive`) : empiler des
  p95 par navigateur dessinerait une somme qui n'existe pas. Sinon, une courbe par groupe.

### Adaptateur de lecture, et jamais de réécriture massive

`normalizeLayout` traduit le `jsonb` vers un modèle unique en mémoire ; `serializeLayout`
réécrit **chaque widget dans sa version d'origine**. Ouvrir un tableau v1 ne le convertit
pas, et un retour arrière applicatif retrouve exactement le JSON qu'il avait écrit.

Une entrée illisible devient un widget `invalid` qui porte **sa raison et son JSON
d'origine** : carte de diagnostic à l'écran, configuration conservée telle quelle en base,
corrigible par qui a le droit d'écrire. La v1 l'écartait silencieusement — un layout écrit
par une version plus récente perdait ses cartes à la première écriture.

## Propriété et droits (`lib/dashboard-access.ts`)

`owner_id` est une **clé étrangère vers `console_user`**, résolue depuis le `created_by`
existant quand le compte est connu ; sinon `NULL` — propriétaire **hérité**, que seul un
admin de l'app peut reprendre. La clé prime sur l'adresse : sans elle, un compte recréé avec
le même e-mail hériterait des tableaux de son homonyme.

Chaque geste a son nom dans `DASHBOARD_ACTIONS` (`read`, `export`, `rename`, `move_app`,
`delete`, `add_widget`, `remove_widget`, `reorder_widget`, `configure_widget`, `clone`) et
sa ligne dans la matrice :

| acteur | lecture / export | écriture |
|---|---|---|
| anonyme | non | non |
| session démo | oui (son scope) | **non** |
| viewer, app hors périmètre | non | non |
| viewer autorisé, non propriétaire | oui | non |
| viewer autorisé, propriétaire | oui | oui |
| admin, app dans son périmètre | oui | oui |
| admin transverse, tableau `app_id null` | oui | oui |

**Être propriétaire n'ajoute aucun droit** : le propriétaire d'un tableau lié à une app
qu'il n'est plus autorisé à lire ne peut plus rien en faire. Un **admin scopé** est
l'administrateur **de ses apps** : le rôle ne franchit pas la liste qu'on lui a signée.
`clone` crée ailleurs — il exige donc de lire la source **et** de pouvoir créer dans l'app
visée ; le clone reçoit un nouvel identifiant, le cloneur pour propriétaire et la **même**
app.

**Révision et conflit.** Chaque écriture cite la révision affichée. Si la ligne a bougé,
rien n'est écrit et l'écran revient avec `?conflit=1` : la carte ajoutée dans un autre
onglet n'est pas effacée.

## Résolution & export (`lib/widget-data.ts`)

- `resolveWidgets(widgets, ctx)` charge la grille par **vagues de 4** : vingt-quatre cartes
  lancées ensemble ouvriraient vingt-quatre transactions sur un pool de dix connexions.
  Un `AbortSignal` (passé par l'export) arrête les vagues suivantes.
- **Cache court** (10 s, 200 entrées, clé incluant le **périmètre effectif**) : deux cartes
  qui posent la même question, ou l'export CSV qui suit l'affichage, ne la posent qu'une
  fois. Une réponse calculée pour A ne peut pas servir à B. Il n'y a **aucun rafraîchissement
  automatique** : pas de 24 requêtes lourdes toutes les 5 s.
- La page `/dashboards/[id]` et l'export CSV partagent **exactement** cette donnée.
- **Export CSV** : `GET /api/dashboards/[id]/export` (session requise), même AST, mêmes
  permissions, même fenêtre. Plafond **global de 10 000 lignes**, troncature **annoncée dans
  le fichier**. Échappement RFC 4180, et toute cellule commençant par `=`, `+`, `-` ou `@`
  est préfixée d'une apostrophe : un export ne doit pas devenir une formule exécutée par un
  tableur. **Export PDF** : impression de la vue existante (zéro service tiers).

## Vues enregistrées de l'Explorer (P6.5)

Table `analytics_saved_view(id, app_id, owner_id, name, query_json, revision, created_at,
updated_at)` — `query_json` est l'AST canonique, **versionné** (clé `version`).

- **Personnelles.** Lisibles par leur propriétaire, et par un **admin autorisé sur l'app**.
  Aucune vue publique n'est créée implicitement ; le partage app-wide est hors périmètre.
- **Une app nommée, toujours** : `app: null` est refusé — la même vue mesurerait une
  population différente selon son lecteur.
- **Bornes** : nom ≤ 100 caractères, **50 vues par compte et par app** (compté dans la
  transaction, derrière un verrou consultatif), AST ≤ 32 Kio.
- **Écritures de session** uniquement (jamais un jeton `CONSOLE_API_TOKENS`, jamais une
  session démo), propriétaire seul, révision citée. API : `GET|POST /api/v1/explorer/views`,
  `PATCH|DELETE /api/v1/explorer/views/:id` — détail dans `docs/API_CONSOLE.md`.
- Écran `/explorer/views` : ouvrir (la requête est **rejouée**, jamais un résultat figé),
  renommer, supprimer. Une vue dont l'AST n'est plus lisible reste **éditable**, avec sa
  raison affichée — elle n'est pas supprimée en silence.

## Sécurité / conformité

- RLS + accès `console_ro` codifiés en v18 (dashboards) et v79 (vues, portée tenant en
  lecture ET écriture ; `app_id` et `owner_id` non modifiables — ce serait un partage
  déguisé).
- **RGPD** : `erase_app_data(app)` (redéfinie en v79) supprime les vues enregistrées **et**
  les dashboards scopés de l'app ; les dashboards non scopés (`app_id null`) sont préservés.
  `purge_rum_app` ne les touche pas : une analyse enregistrée est de la **configuration**,
  pas une observation datée — l'effacer au bout de trente jours supprimerait le travail d'un
  utilisateur au motif qu'il n'a rien mesuré récemment.
- L'export CSV exige une session (`getUser`) ; pas d'exposition publique.
- L'adresse d'un **autre** compte (propriétaire d'un tableau ou d'une vue) ne sort que vers
  une session admin — même règle que le workflow d'issue (P5.6).

## Preuves

- `scripts/verify-dashboards.mjs` (Postgres réel) : CRUD, RLS + lecture/écriture
  `console_ro`, effacement RGPD (dashboard scopé supprimé, global préservé).
- `tests/unit/dashboards.test.ts` : adaptateur v1/v2, carte de diagnostic, aller-retour de
  sérialisation, `rangeOverride` borné.
- `tests/unit/dashboards-analytics.test.ts` : fenêtre héritée ou propre, intersection des
  filtres, parallélisme borné, annulation, cache scopé, échappement et troncature CSV.
- `tests/unit/dashboard-access.test.ts` : la matrice ci-dessus, geste par geste.
- `tests/unit/saved-views.test.ts` : validation d'AST, bornes, autorisations.
- `tests/integration/saved-views-v79-sql.test.ts` : rejeu, contraintes, RLS/droits,
  plafond 50, conflit 409, effacement d'app, rétention, fenêtre de déploiement v78 → v79.
- `tests/e2e/dashboards-analytics.spec.ts` : Explorer → carte → rechargement → duplication
  → CSV, vue enregistrée, carte invalide, clavier, 390/768/1440 px.

## Suivi (non bloquant)

- Partage app-wide d'une vue enregistrée (hors périmètre initial, à concevoir).
- Réagencement par glisser-déposer (actuel : flèches monter/descendre, accessibles au
  clavier et annonçant leur position).
- Export **PNG** d'un widget (capture) si un besoin de partage image émerge.
- Agrégats pré-calculés et budgets de lecture : P6.6.
