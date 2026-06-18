# Tableaux de bord configurables + export (P1)

> Laisser chaque équipe composer ses propres vues (COPIL, run, perf) et les exporter
> (CSV / PDF). Contrat SQL : `apps/ingest/sql/migration-v18.sql`. Console : `/dashboards`.

## Modèle

Un **dashboard** = un nom, une app (optionnelle, `null` = toutes) et une **liste de
widgets** sérialisée en `jsonb` (`layout`). Table `dashboard(id, name, app_id, layout,
created_by, created_at, updated_at)`. Aucune nouvelle table de données : les widgets
**réutilisent les requêtes existantes**.

### Widgets disponibles (v1)

| type | source | rendu |
|---|---|---|
| `vital_p75` | `vitalsP75` | grand chiffre p75 d'un Web Vital (LCP/INP/CLS/FCP/TTFB) |
| `traffic` | `dailyTraffic` | pages vues / erreurs par jour |
| `slow_routes` | `slowRoutes` | top routes par LCP/INP p75 |
| `top_errors` | `errorGroups` | top erreurs (occurrences, sessions) |
| `frustration` | `topFrustrations` | rage/dead clicks par cible |

Les widgets sont scopés **app + période + device** (filtres globaux ; l'app du dashboard
prime si renseignée). Le **filtrage par route** par widget est un suivi (les requêtes
réutilisées n'acceptent pas encore de paramètre route).

## Helpers purs (`lib/dashboards.ts`)

- `normalizeLayout(raw)` : valide/nettoie la liste (types connus, métrique valide pour
  `vital_p75` sinon écarté, titres tronqués, **borné à `MAX_WIDGETS`=24**). Appliqué en
  lecture ET écriture → jamais de layout corrompu en base. Fail-soft (jamais d'exception).
- `WIDGET_META`, `defaultTitle()` : catalogue pour l'UI.

## Résolution & export (`lib/widget-data.ts`)

- `resolveWidget(widget, filters)` → forme **uniforme** `WidgetData` (`value` ou `table`),
  en convertissant les conventions de `Filters` propres à chaque module. **Fail-soft** :
  un widget en échec rend une carte vide, pas une page cassée.
- La page `/dashboards/[id]` et l'export CSV partagent **exactement** cette donnée.
- **Export CSV** : `GET /api/dashboards/[id]/export` (auth requise) — une section par widget
  (`widgetToCsv`, échappement RFC 4180). **Export PDF** : vue imprimable via le bouton
  « Imprimer / PDF » (impression navigateur — zéro dépendance lourde).

## Sécurité / conformité

- RLS + accès `console_ro` (CRUD) codifiés dans v18 (motif finding #1).
- **RGPD** : `erase_app_data(app)` (redéfini en v18) supprime aussi les dashboards
  **scopés** à l'app ; les dashboards non scopés (`app_id null`) sont préservés.
- L'export CSV exige une session (`getUser`) ; pas d'exposition publique.

## Preuves

- `scripts/verify-dashboards.mjs` (Postgres réel) : CRUD, RLS + lecture/écriture
  `console_ro`, effacement RGPD (dashboard scopé supprimé, global préservé).
- `tests/unit/dashboards.test.ts` : `normalizeLayout` (types inconnus écartés, `vital_p75`
  sans métrique écarté, borne `MAX_WIDGETS`, titres).

## Suivi (non bloquant)

- Widgets scopés par **route** (variantes route-aware des requêtes).
- Widget **SLO** (dépend de l'alerting mature, PR séparée).
- Réagencement par glisser-déposer (actuel : flèches monter/descendre).
- Export **PNG** d'un widget (capture) si un besoin de partage image émerge.
