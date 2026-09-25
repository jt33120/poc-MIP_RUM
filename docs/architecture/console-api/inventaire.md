# Inventaire de la console, pour la piste C

> **Généré** par `node scripts/dev/inventaire-console.mjs` le 2026-09-25, sur `HEAD`. Ne pas éditer à la main : relancer le script. Méthode et limites en tête du script ; décisions de contrat dans [README.md](README.md).

## En chiffres

| | Nombre | Atteignent la base |
|---|---|---|
| Écrans (`page.tsx`) | 57 | **50** |
| Fichiers d'actions serveur (`"use server"`) | 17 (53 actions) | **16** |
| Actions déclarées dans un écran | 0 | — |
| Routes (`route.ts`) | 54 | **47** |
| Composants serveur qui atteignent la base eux-mêmes | — | **13** |
| Layout racine | 1 | **oui** |
| Modules `lib/queries*.ts` | 45 (207 fonctions exportées) | — |
| Sections `lire()` (appels) | 262 | — |
| `error.tsx` / `not-found.tsx` / `loading.tsx` | 23 / 4 / 0 | — |
| Écrans rafraîchis toutes les 5 s (`AutoRefresh`) | 53 | — |
| Écrans servis par un chargeur (`lib/chargeurs/`, C3 → C5) | 6 | **6** / 50 |

**Le cliquet** (`cliquet.json`) liste nominativement ce qui atteint la base. `tests/unit/inventaire-console.test.ts` refuse toute entrée nouvelle, et demande de le resserrer quand une entrée disparaît.

## Écrans

« Chargeur » : le module de `lib/chargeurs/` qui lit pour l'écran — la console l'exécute aujourd'hui, console-api le sert tel quel ; l'écran quitte le cliquet à la bascule. « Sections » : appels `lire()` / `section()` de l'écran et de son chargeur — chacune tombe seule. « Panneaux » : types de `panel=` que l'écran ouvre — chacun est une opération à part. « 5 s » : rejoué par `AutoRefresh` toutes les 5 s.

| Écran | Lot | Base | Chargeur | Modules de requêtes | Sections | Panneaux | 5 s |
|---|---|---|---|---|---|---|---|
| `/acquisition` | C5 | **oui** | — | acquisition, deploys, explorer, sessions | 4 | — | oui |
| `/actions` | C3 | **oui** | actions | queries, actions, deploys, explorer, sessions | 4 | — | oui |
| `/admin/audit` | C9 administration | **oui** | — | — | — | — | oui |
| `/admin/composants` | C9 administration | non | — | — | — | — | oui |
| `/admin/customers/[appId]` | C9 administration | **oui** | — | customers | — | — | oui |
| `/admin/customers` | C9 administration | **oui** | — | customers | — | — | oui |
| `/admin/extension-installs` | C9 administration | **oui** | — | extension-installs | — | — | oui |
| `/admin/extension-scope` | C9 administration | **oui** | — | queries, explorer, extension-scope, sessions | — | — | oui |
| `/admin/health` | C9 administration | **oui** | — | queries, errors, events, explorer, health, sessions | 1 | — | oui |
| `/admin/privacy` | C10 RGPD | **oui** | — | queries, dsar, errors, events, explorer, sessions | — | — | oui |
| `/admin/read-tokens` | C9 administration | **oui** | — | queries, explorer, read-tokens, sessions | — | — | oui |
| `/admin/sourcemaps` | C9 administration | **oui** | — | queries, explorer, sessions, sourcemap, sourcemap-tokens | — | — | oui |
| `/admin/ticket-integrations` | C9 administration | **oui** | — | queries, errors, events, explorer, sessions, ticket-integrations | — | — | oui |
| `/admin/uptime` | C9 administration | **oui** | — | queries, explorer, planifie, sessions, uptime | — | — | oui |
| `/admin/usage` | C9 administration | **oui** | — | usage | — | — | oui |
| `/admin/users` | C9 administration | **oui** | — | — | — | — | oui |
| `/ai` | C5 | **oui** | — | events, v2 | — | — | oui |
| `/alerts` | C8 alerting | **oui** | — | queries, alerting, errors, events, explorer, sessions, v2 | 8 | — | oui |
| `/api-docs` | statique ou vitrine | non | — | — | — | — | oui |
| `/correlation` | C4 | **oui** | — | deploys, events, explorer, v2 | 11 | — | oui |
| `/dashboards/[id]` | C6 espace de travail | **oui** | — | queries, accounts, dashboards, errors, events, explorer, frustration, grid, mobile, sessions | — | — | non |
| `/dashboards` | C6 espace de travail | **oui** | — | queries, accounts, dashboards, errors, events, explorer, frustration, grid, mobile, sessions | — | — | non |
| `/errors/[fingerprint]` | C4 | **oui** | — | queries, deploys, errors, events, explorer, sessions, v2 | 3 | — | oui |
| `/errors/issues/[id]` | C4 | **oui** | — | queries, deploys, errors, events, explorer, sessions, ticket-integrations | 2 | — | oui |
| `/errors` | C4 | **oui** | — | queries, breakdowns, deploys, errors, events, explorer, sessions | 8 | error | oui |
| `/events` | C3 | **oui** | events | deploys, events | 2 | event | oui |
| `/experience` | C5 | **oui** | — | queries, breakdowns, deploys, experience, explorer, mobile, sessions | 9 | — | oui |
| `/explorer` | C3 | **oui** | explorer | queries, accounts, dashboards, deploys, errors, events, explorer, frustration, grid, mobile, saved-views, sessions | 3 | — | non |
| `/explorer/views` | C6 espace de travail | **oui** | — | accounts, saved-views | — | — | non |
| `/extension-privacy` | statique ou vitrine | non | — | — | — | — | oui |
| `/forecast` | C4 | **oui** | — | deploys, explorer, grid | 3 | — | oui |
| `/forms` | C5 | **oui** | — | deploys, explorer, form-analytics, sessions | 3 | — | oui |
| `/goals` | C5 | **oui** | — | queries, deploys, explorer, goals, sessions | 4 | — | oui |
| `/legal/cgu` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal/cgv` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal/confidentialite` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal` | statique ou vitrine | non | — | — | — | — | oui |
| `/login` | C1–C2 identité, sélection | **oui** | — | — | — | — | oui |
| `/logs` | C5 | **oui** | — | events, logs, v2 | — | — | oui |
| `/map` | C4 | **oui** | — | explorer, map, sessions, tracing | 6 | noeud | oui |
| `/mobile` | C3 | **oui** | mobile | deploys, explorer, mobile, sessions | 8 | — | oui |
| `/` | C4 | **oui** | — | queries, breakdowns, deploys, errors, events, explorer, grid, sessions, v2 | 32 | — | oui |
| `/pages` | C4 | **oui** | — | queries, breakdowns, deploys, errors, events, explorer, longtasks, resources, sessions, v2 | 22 | route | oui |
| `/paths` | C5 | **oui** | — | queries, deploys, explorer, funnel, paths, sessions | 9 | — | oui |
| `/presentation` | statique ou vitrine | **oui** | — | planifie | — | — | oui |
| `/retention` | C5 | **oui** | — | cohorts, explorer, sessions | 3 | — | oui |
| `/select/new` | C1–C2 identité, sélection | **oui** | — | queries, customers, explorer, extension-scope, sessions | — | — | oui |
| `/select` | C1–C2 identité, sélection | **oui** | — | queries, explorer, projects, sessions | — | — | oui |
| `/sessions/[id]` | C3 | **oui** | session | queries, explorer, sessions | 2 | — | oui |
| `/sessions` | C3 | **oui** | sessions | queries, deploys, explorer, sessions | 13 | — | oui |
| `/slo` | C8 alerting | **oui** | — | queries, alerting, errors, events, explorer, sessions, v2 | 4 | — | oui |
| `/svi/appels/[callId]` | C5 | **oui** | — | events, svi, v2 | — | — | oui |
| `/svi/appels` | C5 | **oui** | — | events, svi, v2 | — | — | oui |
| `/svi` | C5 | **oui** | — | events, svi, v2 | — | — | oui |
| `/tracing/[traceId]` | C4 | **oui** | — | queries, explorer, sessions, tracing | 2 | — | oui |
| `/tracing` | C4 | **oui** | — | deploys, events, explorer, tracing, v2 | 10 | — | oui |
| `/ux` | C4 | **oui** | — | queries, deploys, explorer, frustration, mobile, sessions | 9 | — | oui |

## Actions serveur

« Auditée » : le graphe de l'action contient une écriture d'`audit_log`. C0 imposera une action d'audit (ou une exemption) à toute route non-GET de `console-api`.

| Fichier | Actions | Base | Auditée |
|---|---|---|---|
| `app/actions-dashboard.ts` | reglerBlocsAction | non | non |
| `app/admin/customers/actions.ts` | createCustomerAction, rotateKeyAction, toggleAppAction, updateOriginsAction | **oui** | oui |
| `app/admin/extension-installs/actions.ts` | forgetInstallAction | **oui** | oui |
| `app/admin/extension-scope/actions.ts` | createExtensionScopeAction, toggleExtensionScopeAction | **oui** | oui |
| `app/admin/privacy/actions.ts` | searchIdentityAction, eraseIdentityAction, eraseUserAction | **oui** | oui |
| `app/admin/read-tokens/actions.ts` | createReadTokenAction, revokeReadTokenAction | **oui** | oui |
| `app/admin/ticket-integrations/actions.ts` | creerIntegrationAction, majIntegrationAction | **oui** | oui |
| `app/admin/uptime/actions.ts` | createUptimeCheckAction, toggleUptimeCheckAction, deleteUptimeCheckAction | **oui** | oui |
| `app/admin/users/actions.ts` | createUserAction, toggleUserAction, resetPasswordAction | **oui** | oui |
| `app/alerts/actions.ts` | createRuleAction, updateRuleAction, toggleRuleAction, ackEventAction, evaluateNowAction, createSloAction, toggleSloAction, deleteSloAction, createChannelAction, toggleChannelAction, deleteChannelAction | **oui** | oui |
| `app/dashboards/actions.ts` | createDashboardAction, cloneTemplateAction, cloneDashboardAction, renameDashboardAction, deleteDashboardAction, addWidgetAction, addSectionAction, saveAnalysisAction, configureWidgetAction, removeWidgetAction, moveWidgetAction | **oui** | oui |
| `app/errors/[fingerprint]/actions.ts` | setErrorStatusAction | **oui** | oui |
| `app/explorer/actions.ts` | saveViewAction, renameViewAction, deleteViewAction | **oui** | oui |
| `app/goals/actions.ts` | createGoalAction, toggleGoalAction, deleteGoalAction | **oui** | oui |
| `app/login/actions.ts` | loginAction | **oui** | oui |
| `app/select/actions.ts` | selectProjectAction | **oui** | oui |
| `app/select/new/actions.ts` | createSiteAction | **oui** | oui |

## Routes

« Authentification » : ce que la route importe des modules d'authentification. Vide : publique, ou gardée autrement (secret, signature, clé d'ingestion) — voir la route.

| Route | Méthodes | Authentification | Base | Destination |
|---|---|---|---|---|
| `/admin/privacy/export` | GET | session | **oui** | console-api (C10 RGPD) |
| `/api/admin/sourcemap-tokens/[id]` | DELETE | session administrateur | **oui** | console-api (C9) |
| `/api/admin/sourcemap-tokens` | GET, POST | session administrateur | **oui** | console-api (C9) |
| `/api/admin/ticket-integrations/[id]` | PATCH | session administrateur | **oui** | console-api (C9) |
| `/api/admin/ticket-integrations` | GET, POST | session administrateur | **oui** | console-api (C9) |
| `/api/auth/oidc/callback` | GET | émet la session | **oui** | console-api (C1 identité) |
| `/api/auth/oidc/login` | GET | — | non | console-api (C1 identité) |
| `/api/cron/daily` | GET | — | non | à supprimer (410 depuis P0) |
| `/api/cron/hourly` | GET | — | non | à supprimer (410 depuis P0) |
| `/api/cron/tick` | GET | — | non | à supprimer (410 depuis P0) |
| `/api/dashboards/[id]/export` | GET | session | **oui** | console-api (C6) |
| `/api/extension/heartbeat` | POST, OPTIONS | — | **oui** | collector (C11) |
| `/api/extension/resolve` | GET, OPTIONS | — | **oui** | collector (C11) |
| `/api/ingest/v1/logs` | GET, POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/ingest/v1/replay` | POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/ingest/v1/traces` | GET, POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/metrics` | GET | jeton de métriques | **oui** | à supprimer (supervision par les /metrics des services) |
| `/api/releases` | GET | session | **oui** | reste sur Vercel, relais serveur (C11) |
| `/api/replay/[sessionId]` | GET | — | **oui** | console-api (C3) |
| `/api/rum/summary` | GET | jeton de lecture en base | **oui** | api (P4) |
| `/api/sourcemaps` | GET, POST | session administrateur | **oui** | collector pour les jetons de CI, console-api pour l'admin (C11) |
| `/api/v1/actions` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/apps` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/correlation` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/deploys` | POST | jeton ou session | **oui** | collector, jetons de CI (C11) |
| `/api/v1/docs` | GET | — | non | api (P4, relais #292) |
| `/api/v1/errors/[fingerprint]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/errors` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/events` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/query` | POST, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/schema` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/views/[id]` | PATCH, DELETE, OPTIONS | session (écriture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/explorer/views` | GET, POST, OPTIONS | jeton ou session (lecture), session (écriture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/health-grid` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/health` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/issues/[id]/activity` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/issues/[id]/comments` | POST | session (écriture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/issues/[id]/links` | POST | session (écriture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/issues/[id]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/issues/[id]/tickets` | GET, POST, OPTIONS | jeton ou session (lecture), session (écriture) | **oui** | api (P4, relais #292) |
| `/api/v1/issues/[id]/triage` | POST | session (écriture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/issues` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/mobile/summary` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/openapi` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/overview` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/pages` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/sessions/[id]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/sessions` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/tracing` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/vitals` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/webhooks/tickets/[integrationId]` | POST | — | **oui** | notifier, relais octet pour octet (C11) |
| `/demo` | GET | émet la session | **oui** | console-api (C1 identité) |
| `/logout` | GET, POST | session | **oui** | console-api (C1 identité) |

## Composants serveur qui atteignent la base

« Chemin » : la chaîne d'import la plus courte jusqu'à `lib/db.ts` — le maillon à couper pour libérer le composant.

| Composant | Chemin vers la base |
|---|---|
| `components/alerts/ChannelsSection.tsx` | `app/alerts/actions.ts` → `lib/error-issue-workflow.ts` → `lib/db.ts` |
| `components/alerts/RuleRow.tsx` | `lib/alertes-ecran.ts` → `lib/queries-v2.ts` → `lib/db.ts` |
| `components/dashboards/ModeleCarte.tsx` | `app/dashboards/actions.ts` → `lib/queries-dashboards.ts` → `lib/db.ts` |
| `components/dashboards/WidgetCard.tsx` | `app/dashboards/actions.ts` → `lib/queries-dashboards.ts` → `lib/db.ts` |
| `components/errors/ErrorStackCard.tsx` | `lib/error-symbolication.ts` → `lib/db.ts` |
| `components/errors/ErrorTriage.tsx` | `app/errors/[fingerprint]/actions.ts` → `lib/db.ts` |
| `components/errors/PanneauErreur.tsx` | `lib/queries-deploys.ts` → `lib/db.ts` |
| `components/explorer/ActionsVue.tsx` | `app/explorer/actions.ts` → `lib/queries-saved-views.ts` → `lib/db.ts` |
| `components/perf/RoutePanel.tsx` | `lib/fuseau.ts` → `lib/db.ts` |
| `components/presentation/Annexe.tsx` | `components/presentation/Specs.tsx` → `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/presentation/Landing.tsx` | `components/presentation/Annexe.tsx` → `components/presentation/Specs.tsx` → `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/presentation/Specs.tsx` | `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/slo/SloStatusRow.tsx` | `app/alerts/actions.ts` → `lib/error-issue-workflow.ts` → `lib/db.ts` |

## Modules de lecture

| Module | Fonctions exportées | Écrans qui l'atteignent |
|---|---|---|
| `lib/queries-accounts.ts` | 1 | 4 |
| `lib/queries-acquisition.ts` | 2 | 1 |
| `lib/queries-actions.ts` | 3 | 1 |
| `lib/queries-alerting.ts` | 9 | 2 |
| `lib/queries-breakdowns.ts` | 2 | 4 |
| `lib/queries-cohorts.ts` | 1 | 1 |
| `lib/queries-customers.ts` | 3 | 3 |
| `lib/queries-dashboards.ts` | 6 | 3 |
| `lib/queries-deploys.ts` | 4 | 19 |
| `lib/queries-dimensions.ts` | 1 | 0 |
| `lib/queries-dsar.ts` | 9 | 1 |
| `lib/queries-errors.ts` | 11 | 13 |
| `lib/queries-events.ts` | 3 | 21 |
| `lib/queries-experience.ts` | 7 | 1 |
| `lib/queries-explorer.ts` | 2 | 35 |
| `lib/queries-extension-installs.ts` | 3 | 1 |
| `lib/queries-extension-scope.ts` | 5 | 2 |
| `lib/queries-form-analytics.ts` | 1 | 1 |
| `lib/queries-frustration.ts` | 5 | 4 |
| `lib/queries-funnel.ts` | 2 | 1 |
| `lib/queries-goals.ts` | 3 | 1 |
| `lib/queries-grid.ts` | 3 | 5 |
| `lib/queries-health.ts` | 1 | 1 |
| `lib/queries-histogramme.ts` | 1 | 0 |
| `lib/queries-logs.ts` | 5 | 1 |
| `lib/queries-longtasks.ts` | 2 | 1 |
| `lib/queries-map.ts` | 4 | 1 |
| `lib/queries-mobile.ts` | 7 | 6 |
| `lib/queries-paths.ts` | 3 | 1 |
| `lib/queries-planifie.ts` | 3 | 2 |
| `lib/queries-projects.ts` | 1 | 1 |
| `lib/queries-read-tokens.ts` | 4 | 1 |
| `lib/queries-resources.ts` | 1 | 1 |
| `lib/queries-saved-views.ts` | 7 | 2 |
| `lib/queries-sessions.ts` | 6 | 32 |
| `lib/queries-sourcemap-tokens.ts` | 3 | 1 |
| `lib/queries-sourcemap.ts` | 2 | 1 |
| `lib/queries-summary.ts` | 1 | 0 |
| `lib/queries-svi.ts` | 6 | 3 |
| `lib/queries-ticket-integrations.ts` | 9 | 2 |
| `lib/queries-tracing.ts` | 8 | 3 |
| `lib/queries-uptime.ts` | 4 | 1 |
| `lib/queries-usage.ts` | 1 | 1 |
| `lib/queries-v2.ts` | 22 | 12 |
| `lib/queries.ts` | 20 | 27 |
