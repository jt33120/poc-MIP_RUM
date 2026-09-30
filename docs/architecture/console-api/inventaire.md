# Inventaire de la console, pour la piste C

> **Généré** par `node scripts/dev/inventaire-console.mjs` le 2026-09-30, sur `HEAD`. Ne pas éditer à la main : relancer le script. Méthode et limites en tête du script ; décisions de contrat dans [README.md](README.md).

## En chiffres

| | Nombre | Atteignent la base |
|---|---|---|
| Écrans (`page.tsx`) | 60 | **47** |
| Fichiers d'actions serveur (`"use server"`) | 20 (56 actions) | **18** |
| Actions déclarées dans un écran | 0 | — |
| Routes (`route.ts`) | 45 | **37** |
| Composants serveur qui atteignent la base eux-mêmes | — | **10** |
| Layout racine | 1 | **oui** |
| Modules `lib/queries*.ts` | 48 (210 fonctions exportées) | — |
| Sections `lire()` (appels) | 302 | — |
| `error.tsx` / `not-found.tsx` / `loading.tsx` | 23 / 5 / 0 | — |
| Écrans rafraîchis toutes les 5 s (`AutoRefresh`) | 55 | — |
| Écrans servis par un chargeur (`lib/chargeurs/`, C3 → C6) | 45 | **45** / 47 |
| Fichiers d'actions passés par une commande (`lib/commandes/`, C6 → C9) | 15 (51 commandes) | **15** / 18 |

**Le cliquet** (`cliquet.json`) liste nominativement ce qui atteint la base. `tests/unit/inventaire-console.test.ts` refuse toute entrée nouvelle, et demande de le resserrer quand une entrée disparaît.

## Écrans

« Chargeur » : le module de `lib/chargeurs/` qui lit pour l'écran — la console l'exécute aujourd'hui, console-api le sert tel quel ; l'écran quitte le cliquet à la bascule. « Sections » : appels `lire()` / `section()` de l'écran et de son chargeur — chacune tombe seule. « Panneaux » : types de `panel=` que l'écran ouvre — chacun est une opération à part. « 5 s » : rejoué par `AutoRefresh` toutes les 5 s.

| Écran | Lot | Base | Chargeur | Modules de requêtes | Sections | Panneaux | 5 s |
|---|---|---|---|---|---|---|---|
| `/acquisition` | C5 | **oui** | acquisition | acquisition, collecte, deploys, explorer, mobile, sessions, tracing | 4 | — | oui |
| `/actions` | C3 | **oui** | actions | queries, actions, collecte, deploys, explorer, mobile, sessions, tracing | 4 | — | oui |
| `/admin/audit` | C9 administration | **oui** | administration | queries, chaine, collecte, customers, deploys, errors, events, explorer, extension-installs, extension-scope, health, mobile, planifie, read-tokens, sessions, sourcemap, sourcemap-tokens, tracing, usage | 2 | — | oui |
| `/admin/composants` | C9 administration | non | — | — | — | — | oui |
| `/admin/customers/[appId]` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/admin/customers` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/admin/extension-installs` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/admin/extension-scope` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/admin/health` | C9 administration | **oui** | administration | queries, chaine, collecte, customers, deploys, errors, events, explorer, extension-installs, extension-scope, health, mobile, planifie, read-tokens, sessions, sourcemap, sourcemap-tokens, tracing, usage | 2 | — | oui |
| `/admin/privacy` | C10 RGPD | **oui** | vie-privee | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | oui |
| `/admin/read-tokens` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/admin/sourcemaps` | C9 administration | **oui** | administration | queries, chaine, collecte, customers, deploys, errors, events, explorer, extension-installs, extension-scope, health, mobile, planifie, read-tokens, sessions, sourcemap, sourcemap-tokens, tracing, usage | 2 | — | oui |
| `/admin/uptime` | C9 administration | **oui** | sondes | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, planifie, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | oui |
| `/admin/usage` | C9 administration | **oui** | administration | queries, chaine, collecte, customers, deploys, errors, events, explorer, extension-installs, extension-scope, health, mobile, planifie, read-tokens, sessions, sourcemap, sourcemap-tokens, tracing, usage | 2 | — | oui |
| `/admin/users` | C9 administration | **oui** | administration | queries, accounts, alerting, chaine, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, health, mobile, planifie, read-tokens, saved-views, sessions, sourcemap, sourcemap-tokens, tracing, uptime, usage, v2 | 2 | — | oui |
| `/ai` | C5 | **oui** | ai | collecte, deploys, events, explorer, v2 | — | — | oui |
| `/alerts` | C8 alerting | **oui** | alertes | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 8 | — | oui |
| `/api-docs` | statique ou vitrine | non | — | — | — | — | oui |
| `/correlation` | C4 | **oui** | correlation | collecte, deploys, events, explorer, v2 | 11 | — | oui |
| `/dashboards/[id]` | C6 espace de travail | **oui** | tableau | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | non |
| `/dashboards` | C6 espace de travail | **oui** | tableaux | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | non |
| `/errors/[fingerprint]` | C4 | **oui** | erreur | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 3 | — | oui |
| `/errors/issues/[id]` | C4 | **oui** | issue | queries, collecte, deploys, errors, events, explorer, mobile, sessions, tracing | 3 | — | oui |
| `/errors` | C4 | **oui** | errors | queries, breakdowns, collecte, deploys, errors, events, explorer, mobile, sessions, tracing | 9 | error | oui |
| `/events` | C3 | **oui** | events | collecte, deploys, events, explorer | 2 | event | oui |
| `/experience` | C5 | **oui** | experience | queries, breakdowns, collecte, deploys, experience, explorer, mobile, sessions, tracing | 9 | — | oui |
| `/explorer` | C3 | **oui** | explorer | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 3 | — | non |
| `/explorer/views` | C6 espace de travail | **oui** | vues | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | non |
| `/extension-privacy` | statique ou vitrine | non | — | — | — | — | oui |
| `/forecast` | C4 | **oui** | forecast | collecte, deploys, explorer, grid | 3 | — | oui |
| `/forms` | C5 | **oui** | forms | collecte, deploys, explorer, form-analytics, mobile, sessions, tracing | 3 | — | oui |
| `/goals` | C5 | **oui** | goals | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, goals, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 4 | — | oui |
| `/inscription` | C1–C2 identité, sélection | non | — | — | — | — | oui |
| `/installer` | C5 | **oui** | installer | collecte, customers, deploys, explorer, extension-scope | 3 | — | non |
| `/legal/cgu` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal/cgv` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal/confidentialite` | statique ou vitrine | non | — | — | — | — | oui |
| `/legal` | statique ou vitrine | non | — | — | — | — | oui |
| `/login` | C1–C2 identité, sélection | **oui** | — | — | — | — | oui |
| `/logs` | C5 | **oui** | logs | collecte, deploys, events, explorer, logs, v2 | — | — | oui |
| `/map` | C4 | **oui** | map | collecte, deploys, explorer, map, mobile, sessions, tracing | 6 | noeud | oui |
| `/mobile` | C3 | **oui** | mobile | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 8 | — | oui |
| `/` | C4 | **oui** | detections-accueil, overview | queries, breakdowns, collecte, deploys, detections, errors, events, explorer, grid, heatmap, mobile, sessions, tracing, v2 | 37 | — | oui |
| `/pages` | C4 | **oui** | pages | queries, breakdowns, collecte, deploys, errors, events, explorer, longtasks, mobile, resources, sessions, tracing, v2 | 22 | route | oui |
| `/paths` | C5 | **oui** | paths | queries, collecte, deploys, explorer, funnel, mobile, paths, sessions, tracing | 9 | — | oui |
| `/presentation/a-faire` | à classer | non | — | — | — | — | oui |
| `/presentation/graphe-technique` | à classer | **oui** | — | planifie | — | — | oui |
| `/presentation/installation/[parcours]` | à classer | non | — | — | — | — | oui |
| `/presentation/installation` | à classer | non | — | — | — | — | oui |
| `/presentation/open-source` | à classer | non | — | — | — | — | oui |
| `/presentation` | statique ou vitrine | non | — | — | — | — | oui |
| `/retention` | C5 | **oui** | retention | cohorts, collecte, deploys, explorer, mobile, sessions, tracing | 3 | — | oui |
| `/select/new` | C1–C2 identité, sélection | **oui** | projets | queries, accounts, alerting, collecte, customers, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, projects, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | — | — | oui |
| `/select` | C1–C2 identité, sélection | **oui** | projets | queries, collecte, customers, deploys, explorer, extension-scope, mobile, projects, sessions, tracing | — | — | oui |
| `/sessions/[id]` | C3 | **oui** | session | queries, collecte, deploys, explorer, mobile, sessions, tracing | 2 | — | oui |
| `/sessions` | C3 | **oui** | sessions | queries, collecte, deploys, explorer, mobile, sessions, tracing | 15 | — | oui |
| `/slo` | C8 alerting | **oui** | slo | queries, accounts, alerting, collecte, dashboards, deploys, dsar, errors, events, explorer, extension-installs, extension-scope, frustration, grid, mobile, read-tokens, saved-views, sessions, sourcemap-tokens, tracing, uptime, v2 | 4 | — | oui |
| `/tracing/[traceId]` | C4 | **oui** | session, trace | queries, collecte, deploys, explorer, mobile, sessions, tracing | 4 | — | oui |
| `/tracing` | C4 | **oui** | tracing | collecte, deploys, events, explorer, tracing, v2 | 10 | — | oui |
| `/ux` | C4 | **oui** | ux | queries, collecte, deploys, explorer, frustration, mobile, sessions, tracing | 9 | — | oui |

## Actions serveur

« Commandes » : les écritures que le fichier appelle par leur clé (`executerCommande`, C6 → C9) — la console les exécute aujourd'hui, console-api les sert telles quelles ; le fichier quitte le cliquet à la bascule. « Auditée » : le graphe de l'action contient une écriture d'`audit_log` ; pour une action passée par ses commandes, c'est la RÈGLE de chacune qui déclare son action d'audit ou son exemption motivée, vérifiée au démarrage de `console-api` (`verifierTable`).

| Fichier | Actions | Base | Commandes | Auditée |
|---|---|---|---|---|
| `app/actions-dashboard.ts` | reglerBlocsAction | non | — | non |
| `app/admin/customers/actions.ts` | createCustomerAction, rotateKeyAction, toggleAppAction, updateOriginsAction | **oui** | activerApplication, creerApplication, majOrigines, renouvelerCle | par règle |
| `app/admin/extension-installs/actions.ts` | forgetInstallAction | **oui** | oublierPoste | par règle |
| `app/admin/extension-scope/actions.ts` | createExtensionScopeAction, toggleExtensionScopeAction | **oui** | activerDomaineExtension, creerDomaineExtension | par règle |
| `app/admin/privacy/actions.ts` | searchIdentityAction, eraseIdentityAction, eraseUserAction | **oui** | effacerIdentite, effacerVisiteur, rechercherIdentite | par règle |
| `app/admin/read-tokens/actions.ts` | createReadTokenAction, revokeReadTokenAction | **oui** | creerJetonLecture, revoquerJetonLecture | par règle |
| `app/admin/sourcemaps/actions.ts` | creerJetonSourcemapAction, revoquerJetonSourcemapAction | **oui** | creerJetonSourcemap, revoquerJetonSourcemap | par règle |
| `app/admin/uptime/actions.ts` | createUptimeCheckAction, toggleUptimeCheckAction, deleteUptimeCheckAction | **oui** | activerSonde, creerSonde, supprimerSonde | par règle |
| `app/admin/users/actions.ts` | createUserAction, toggleUserAction, resetPasswordAction | **oui** | activerCompte, creerCompte, reinitialiserMotDePasse | par règle |
| `app/alerts/actions.ts` | createRuleAction, updateRuleAction, toggleRuleAction, ackEventAction, evaluateNowAction, createSloAction, toggleSloAction, deleteSloAction, createChannelAction, toggleChannelAction, deleteChannelAction | **oui** | acquitterEvenement, activerCanal, activerRegle, activerSlo, creerCanal, creerRegle, creerSlo, evaluerAlertes, modifierRegle, supprimerCanal, supprimerSlo | par règle |
| `app/dashboards/actions.ts` | createDashboardAction, cloneTemplateAction, cloneDashboardAction, renameDashboardAction, deleteDashboardAction, addWidgetAction, addSectionAction, saveAnalysisAction, configureWidgetAction, removeWidgetAction, moveWidgetAction | **oui** | ajouterCarte, ajouterSection, clonerModele, clonerTableau, configurerCarte, creerTableau, deplacerCarte, enregistrerAnalyse, modifierTableau, retirerCarte, supprimerTableau | par règle |
| `app/errors/[fingerprint]/actions.ts` | setErrorStatusAction | **oui** | trierGroupe | par règle |
| `app/errors/issues/actions.ts` | muterIssue | **oui** | — | oui |
| `app/explorer/actions.ts` | saveViewAction, renameViewAction, deleteViewAction | **oui** | creerVue, modifierVue, supprimerVue | par règle |
| `app/goals/actions.ts` | createGoalAction, toggleGoalAction, deleteGoalAction | **oui** | activerObjectif, creerObjectif, supprimerObjectif | par règle |
| `app/inscription/actions.ts` | inscrireAction | non | — | oui |
| `app/login/actions.ts` | loginAction | **oui** | — | oui |
| `app/mobile/actions.ts` | validerCapaciteAction | **oui** | validerCapaciteMobile | par règle |
| `app/select/actions.ts` | selectProjectAction | **oui** | — | oui |
| `app/select/new/actions.ts` | createSiteAction | **oui** | creerSite | par règle |

## Routes

« Authentification » : ce que la route importe des modules d'authentification. Vide : publique, ou gardée autrement (secret, signature, clé d'ingestion) — voir la route.

| Route | Méthodes | Authentification | Base | Destination |
|---|---|---|---|---|
| `/admin/privacy/export` | GET | — | **oui** | console-api (C10 RGPD) |
| `/api/auth/oidc/callback` | GET | émet la session | **oui** | console-api (C1 identité) |
| `/api/auth/oidc/login` | GET | — | non | console-api (C1 identité) |
| `/api/dashboards/[id]/export` | GET | — | **oui** | console-api (C6) |
| `/api/extension/heartbeat` | POST, OPTIONS | — | **oui** | collector (C11) |
| `/api/extension/resolve` | GET, OPTIONS | — | **oui** | collector (C11) |
| `/api/ingest/v1/logs` | GET, POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/ingest/v1/replay` | POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/ingest/v1/traces` | GET, POST, OPTIONS | — | **oui** | collector (relais P3 ; relais pur en C11) |
| `/api/live` | GET | — | non | à classer |
| `/api/metrics` | GET | jeton de métriques | **oui** | à supprimer (supervision par les /metrics des services) |
| `/api/releases` | GET | — | **oui** | reste sur Vercel, relais serveur (C11) |
| `/api/replay/[sessionId]` | GET | — | **oui** | console-api (C3) |
| `/api/rum/summary` | GET | jeton de lecture en base | **oui** | api (P4) |
| `/api/sourcemaps` | GET, POST | session administrateur | **oui** | collector pour les jetons de CI, console-api pour l'admin (C11) |
| `/api/v1/actions` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/apps` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/correlation` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/deploys` | POST | jeton ou session | **oui** | collector, jetons de CI (C11) |
| `/api/v1/detections` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/docs` | GET | — | non | api (P4, relais #292) |
| `/api/v1/errors/[fingerprint]/overrepresentation` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/errors/[fingerprint]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/errors` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/events` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/query` | POST, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/schema` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/explorer/views` | GET, OPTIONS | jeton ou session (lecture) | **oui** | console-api pour les écritures (C6, C7) ; api pour les lectures |
| `/api/v1/health-grid` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/health` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/issues/[id]/activity` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/issues/[id]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/issues` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/mobile/summary` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/openapi` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/overview` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/pages` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/sessions/[id]` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/sessions` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/tracing` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/api/v1/trends` | GET, OPTIONS | — | non | api (P4, relais #292) |
| `/api/v1/vitals` | GET, OPTIONS | jeton ou session (lecture) | **oui** | api (P4, relais #292) |
| `/demo` | GET | émet la session | **oui** | console-api (C1 identité) |
| `/logout` | GET, POST | session | **oui** | console-api (C1 identité) |

## Composants serveur qui atteignent la base

« Chemin » : la chaîne d'import la plus courte jusqu'à `lib/db.ts` — le maillon à couper pour libérer le composant.

| Composant | Chemin vers la base |
|---|---|
| `components/alerts/ChannelsSection.tsx` | `app/alerts/actions.ts` → `lib/commande.ts` → `lib/chargeurs/commun.ts` → `lib/comparaison.ts` → `lib/db.ts` |
| `components/alerts/RuleRow.tsx` | `lib/alertes-ecran.ts` → `lib/queries-v2.ts` → `lib/db.ts` |
| `components/dashboards/ModeleCarte.tsx` | `app/dashboards/actions.ts` → `lib/commande.ts` → `lib/chargeurs/commun.ts` → `lib/comparaison.ts` → `lib/db.ts` |
| `components/dashboards/WidgetCard.tsx` | `lib/widget-data.ts` → `lib/queries-grid.ts` → `lib/db.ts` |
| `components/errors/ErrorTriage.tsx` | `app/errors/[fingerprint]/actions.ts` → `lib/commande.ts` → `lib/chargeurs/commun.ts` → `lib/comparaison.ts` → `lib/db.ts` |
| `components/explorer/ActionsVue.tsx` | `app/explorer/actions.ts` → `lib/commande.ts` → `lib/chargeurs/commun.ts` → `lib/comparaison.ts` → `lib/db.ts` |
| `components/presentation/Annexe.tsx` | `components/presentation/Specs.tsx` → `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/presentation/GrapheTechnique.tsx` | `components/presentation/Annexe.tsx` → `components/presentation/Specs.tsx` → `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/presentation/Specs.tsx` | `lib/etat-plateforme.ts` → `lib/queries-planifie.ts` → `lib/db.ts` |
| `components/slo/SloStatusRow.tsx` | `app/alerts/actions.ts` → `lib/commande.ts` → `lib/chargeurs/commun.ts` → `lib/comparaison.ts` → `lib/db.ts` |

## Modules de lecture

| Module | Fonctions exportées | Écrans qui l'atteignent |
|---|---|---|
| `lib/queries-accounts.ts` | 1 | 18 |
| `lib/queries-acquisition.ts` | 2 | 1 |
| `lib/queries-actions.ts` | 3 | 1 |
| `lib/queries-alerting.ts` | 9 | 18 |
| `lib/queries-breakdowns.ts` | 2 | 4 |
| `lib/queries-chaine.ts` | 1 | 10 |
| `lib/queries-cohorts.ts` | 1 | 1 |
| `lib/queries-collecte.ts` | 1 | 45 |
| `lib/queries-customers.ts` | 5 | 13 |
| `lib/queries-dashboards.ts` | 6 | 18 |
| `lib/queries-deploys.ts` | 4 | 45 |
| `lib/queries-detections.ts` | 2 | 1 |
| `lib/queries-dimensions.ts` | 1 | 0 |
| `lib/queries-dsar.ts` | 9 | 18 |
| `lib/queries-errors.ts` | 13 | 26 |
| `lib/queries-events.ts` | 3 | 31 |
| `lib/queries-experience.ts` | 7 | 1 |
| `lib/queries-explorer.ts` | 2 | 45 |
| `lib/queries-extension-installs.ts` | 3 | 22 |
| `lib/queries-extension-scope.ts` | 7 | 24 |
| `lib/queries-form-analytics.ts` | 1 | 1 |
| `lib/queries-frustration.ts` | 5 | 19 |
| `lib/queries-funnel.ts` | 2 | 1 |
| `lib/queries-goals.ts` | 3 | 1 |
| `lib/queries-grid.ts` | 4 | 20 |
| `lib/queries-health.ts` | 1 | 10 |
| `lib/queries-heatmap.ts` | 1 | 1 |
| `lib/queries-histogramme.ts` | 1 | 0 |
| `lib/queries-logs.ts` | 5 | 1 |
| `lib/queries-longtasks.ts` | 2 | 1 |
| `lib/queries-map.ts` | 4 | 1 |
| `lib/queries-mobile.ts` | 7 | 38 |
| `lib/queries-paths.ts` | 3 | 1 |
| `lib/queries-planifie.ts` | 3 | 12 |
| `lib/queries-projects.ts` | 1 | 2 |
| `lib/queries-read-tokens.ts` | 5 | 22 |
| `lib/queries-resources.ts` | 1 | 1 |
| `lib/queries-saved-views.ts` | 7 | 18 |
| `lib/queries-sessions.ts` | 7 | 38 |
| `lib/queries-sourcemap-tokens.ts` | 3 | 22 |
| `lib/queries-sourcemap.ts` | 3 | 10 |
| `lib/queries-summary.ts` | 1 | 0 |
| `lib/queries-surrepresentation.ts` | 1 | 0 |
| `lib/queries-tracing.ts` | 8 | 39 |
| `lib/queries-uptime.ts` | 4 | 18 |
| `lib/queries-usage.ts` | 1 | 10 |
| `lib/queries-v2.ts` | 22 | 24 |
| `lib/queries.ts` | 22 | 34 |
