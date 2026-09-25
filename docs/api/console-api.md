# `console-api` — la table des opérations

> **Généré** depuis la table du service (`packages/console-api/src/table.ts`) : `MAJ_DOC_CONSOLE_API=1 pnpm vitest run tests/unit/console-api-doc.test.ts`. Un test échoue si ce fichier n'est plus ce que la table rend : il ne peut pas diverger du code. Contexte : [docs/architecture/console-api/README.md](../architecture/console-api/README.md).

**Seul client : le serveur de la console** (Vercel). Cette surface n'est publiée ni dans l'OpenAPI de l'API v1, ni sur `/api-docs`. Les machines (partenaires, CI, MCP) passent par le service `api`, en lecture seule.

## Les gardes, dans l'ordre

Chaque requête les passe toutes, avant le traitement (`packages/console-api/src/pipeline.ts`) :

1. identifiant de requête, et échéance `x-mip-deadline-ms` bornée entre 200 et 15 000 ms ;
2. **secret client** `x-mip-client`, comparé en temps constant (deux valeurs pendant une rotation) : absent ou faux, **404 nu**, indiscernable d'un chemin inconnu ;
3. un en-tête `Origin` est refusé (403) : aucun navigateur, et aucun en-tête CORS n'est jamais émis ;
4. la route (404, ou 405 avec `allow`) ;
5. la **session** (`Authorization: Bearer`) : un jeton ES256 qui ne porte qu'un identifiant, vérifié par signature PUIS relu en base (`console_session` jointe au compte) — rôle et périmètre viennent de la base, jamais du jeton ; une session révoquée ou un compte désactivé est refusé en 30 s au plus (cache par réplique) ; base injoignable : 503, pas 401 ;
6. la **démo** (toute écriture refusée), le **rôle**, la **portée** : l'application demandée est confrontée au périmètre AVANT le traitement ;
7. l'**entrée** : paramètres et corps validés, champ inconnu ou répété refusé (400), corps JSON sous plafond (413) ;
8. le **débit** par principal (429 avec `retry-after`) ;
   - 8 bis. la **ressource du chemin** (portée « ressource ») : son application est lue en base et confrontée au périmètre ; absente OU hors périmètre, c'est le même 404 `ressource_inconnue` — un identifiant deviné ne dit pas s'il existe ailleurs ;
9. le **traitement**, sous l'échéance (503 au-delà) ;
10. l'enveloppe `{ meta: { request_id }, data }`, `cache-control: no-store`, signée `x-mip-console-api: 1`. Une panne rend 500 et un message générique ; sa cause reste au journal, avec le `request_id`.

**Règles vérifiées au démarrage** (`verifierTable`) : toute écriture est refusée à la démo (sauf fermer sa propre session) et déclare son action d'audit, ou une exemption motivée ; seule une lecture publique peut se passer du secret client ; une opération publique n'a pas de portée ; la portée « une application nommée » est celle d'une écriture. Un service dont la table viole une règle ne démarre pas.

**Les écritures de la console (C6 → C9)** sont des COMMANDES (`apps/console/lib/commandes/`), servies telles quelles : chacune déclare sa règle (authentification, portée, audit), que la console applique aussi tant qu'elle les exécute elle-même (`refusDAcces` du contrat). Une commande rend sa DÉCISION en 200 (créé, introuvable, conflit de révision…) ; un refus d'accès ou d'entrée part avant elle, avec son code. L'action d'audit s'écrit dans la même transaction que l'écriture.

## Les opérations

| Opération | Méthode et chemin | Authentification | Portée | Démo | Secret client | Audit |
|---|---|---|---|---|---|---|
| `ops.jwks` | `GET /v1/.well-known/jwks.json` | aucune session | — | lecture | **non exigé** | — |
| `alerts.evaluate` | `POST /v1/alert-evaluations` | administrateur de la plateforme | — | **refusée** | exigé | `alert.evaluate` |
| `alerts.acknowledgeEvent` | `POST /v1/alert-events/{id}/acknowledgement` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `alert_event.acknowledge` |
| `alerts.createRule` | `POST /v1/alert-rules` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `alert_rule.create` |
| `alerts.updateRule` | `PUT /v1/alert-rules/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `alert_rule.update` |
| `alerts.setRuleActive` | `PUT /v1/alert-rules/{id}/active` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `alert_rule.set_active` |
| `apps.setActive` | `PUT /v1/app/active` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `app.set_active` |
| `apps.rotateKey` | `POST /v1/app/key-rotations` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `app.rotate_key` |
| `apps.updateOrigins` | `PUT /v1/app/origins` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `app.update_origins` |
| `apps.create` | `POST /v1/apps` | administrateur de la plateforme | — | **refusée** | exigé | `app.create` |
| `auth.demo` | `POST /v1/auth/demo-sessions` | aucune session | — | **refusée** | exigé | `auth.demo` |
| `auth.methods` | `GET /v1/auth/methods` | aucune session | — | lecture | exigé | — |
| `auth.oidc` | `POST /v1/auth/oidc-sessions` | aucune session | — | **refusée** | exigé | `auth.oidc` |
| `auth.oidcStart` | `GET /v1/auth/oidc/authorization` | aucune session | — | lecture | exigé | — |
| `auth.login` | `POST /v1/auth/sessions` | aucune session | — | **refusée** | exigé | `auth.login` |
| `auth.logout` | `DELETE /v1/auth/sessions/current` | session | — | lecture | exigé | `auth.logout` |
| `dashboards.create` | `POST /v1/dashboards` | session | — | **refusée** | exigé | `dashboard.create` |
| `dashboards.delete` | `DELETE /v1/dashboards/{id}` | session | — | **refusée** | exigé | `dashboard.delete` |
| `dashboards.update` | `PATCH /v1/dashboards/{id}` | session | — | **refusée** | exigé | `dashboard.update` |
| `dashboards.saveAnalysis` | `POST /v1/dashboards/{id}/analyses` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.clone` | `POST /v1/dashboards/{id}/clones` | session | — | **refusée** | exigé | `dashboard.clone` |
| `dashboards.export` | `GET /v1/dashboards/{id}/export` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `dashboards.addSection` | `POST /v1/dashboards/{id}/sections` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.addWidget` | `POST /v1/dashboards/{id}/widgets` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.removeWidget` | `DELETE /v1/dashboards/{id}/widgets/{index}` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.configureWidget` | `PATCH /v1/dashboards/{id}/widgets/{index}` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.moveWidget` | `POST /v1/dashboards/{id}/widgets/{index}/moves` | session | — | **refusée** | exigé | exemptée : édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée |
| `dashboards.cloneTemplate` | `POST /v1/dashboards/templates/{modele}/clones` | session | — | **refusée** | exigé | `dashboard.clone_template` |
| `errors.setStatus` | `PUT /v1/errors/{fingerprint}/status` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `error.set_status` |
| `extensionInstalls.forget` | `DELETE /v1/extension-installs/{installId}` | administrateur de la plateforme | — | **refusée** | exigé | `extension_install.forget` |
| `extensionScopes.create` | `POST /v1/extension-scopes` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `extension_scope.create` |
| `extensionScopes.setActive` | `PUT /v1/extension-scopes/{id}/active` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `extension_scope.set_active` |
| `goals.create` | `POST /v1/goals` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `goal.create` |
| `goals.delete` | `DELETE /v1/goals/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `goal.delete` |
| `goals.update` | `PATCH /v1/goals/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `goal.update` |
| `issues.comment` | `POST /v1/issues/{id}/comments` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `issue.comment` |
| `issues.link` | `POST /v1/issues/{id}/links` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `issue.link` |
| `issues.requestTicket` | `POST /v1/issues/{id}/tickets` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `issue.request_ticket` |
| `issues.triage` | `POST /v1/issues/{id}/triage` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `issue.triage` |
| `auth.me` | `GET /v1/me` | session | — | lecture | exigé | — |
| `mobileCapabilities.verify` | `POST /v1/mobile-capabilities/verifications` | administrateur de la plateforme | — | **refusée** | exigé | `mobile_capability.verify` |
| `channels.create` | `POST /v1/notify-channels` | session administrateur | — | **refusée** | exigé | `notify_channel.create` |
| `channels.delete` | `DELETE /v1/notify-channels/{id}` | session administrateur | — | **refusée** | exigé | `notify_channel.delete` |
| `channels.setActive` | `PUT /v1/notify-channels/{id}/active` | session administrateur | — | **refusée** | exigé | `notify_channel.set_active` |
| `users.resetPassword` | `POST /v1/password-resets` | administrateur de la plateforme | — | **refusée** | exigé | `user.reset_password` |
| `public.platformStatus` | `GET /v1/public/platform-status` | aucune session | — | lecture | exigé | — |
| `readTokens.create` | `POST /v1/read-tokens` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `read_token.create` |
| `readTokens.revoke` | `DELETE /v1/read-tokens/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `read_token.revoke` |
| `replay.session` | `GET /v1/replays/{sessionId}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `savedViews.create` | `POST /v1/saved-views` | session | — | **refusée** | exigé | exemptée : vue personnelle : son propriétaire seul la lit et l'écrit, et elle ne donne aucun droit (son AST est rejoué dans le périmètre de qui l'ouvre) |
| `savedViews.delete` | `DELETE /v1/saved-views/{id}` | session | — | **refusée** | exigé | exemptée : vue personnelle : son propriétaire seul la lit et l'écrit, et elle ne donne aucun droit (son AST est rejoué dans le périmètre de qui l'ouvre) |
| `savedViews.update` | `PATCH /v1/saved-views/{id}` | session | — | **refusée** | exigé | exemptée : vue personnelle : son propriétaire seul la lit et l'écrit, et elle ne donne aucun droit (son AST est rejoué dans le périmètre de qui l'ouvre) |
| `screens.acquisition` | `GET /v1/screens/acquisition` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.actions` | `GET /v1/screens/actions` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.uptime` | `GET /v1/screens/admin/uptime` | session administrateur | — | lecture | exigé | — |
| `screens.ai` | `GET /v1/screens/ai` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.alerts` | `GET /v1/screens/alerts` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.correlation` | `GET /v1/screens/correlation` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.dashboards` | `GET /v1/screens/dashboards` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.dashboard` | `GET /v1/screens/dashboards/{id}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.errors` | `GET /v1/screens/errors` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.errorGroup` | `GET /v1/screens/errors/{fingerprint}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.issue` | `GET /v1/screens/errors/issues/{id}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.events` | `GET /v1/screens/events` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.experience` | `GET /v1/screens/experience` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.explorer` | `GET /v1/screens/explorer` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.savedViews` | `GET /v1/screens/explorer/views` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.forecast` | `GET /v1/screens/forecast` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.forms` | `GET /v1/screens/forms` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.goals` | `GET /v1/screens/goals` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.logs` | `GET /v1/screens/logs` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.map` | `GET /v1/screens/map` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.mobile` | `GET /v1/screens/mobile` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.overview` | `GET /v1/screens/overview` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.pages` | `GET /v1/screens/pages` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.paths` | `GET /v1/screens/paths` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.retention` | `GET /v1/screens/retention` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.sessions` | `GET /v1/screens/sessions` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.session` | `GET /v1/screens/sessions/{id}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.slo` | `GET /v1/screens/slo` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.svi` | `GET /v1/screens/svi` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.sviCalls` | `GET /v1/screens/svi/calls` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.sviCall` | `GET /v1/screens/svi/calls/{callId}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.tracing` | `GET /v1/screens/tracing` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.trace` | `GET /v1/screens/tracing/{traceId}` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `screens.ux` | `GET /v1/screens/ux` | session | `app` de la requête, dans le périmètre (`all` = périmètre effectif) | lecture | exigé | — |
| `console.shell` | `GET /v1/shell` | session | — | lecture | exigé | — |
| `apps.createSite` | `POST /v1/sites` | administrateur de la plateforme | — | **refusée** | exigé | `app.create` |
| `slo.create` | `POST /v1/slos` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `slo.create` |
| `slo.delete` | `DELETE /v1/slos/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `slo.delete` |
| `slo.setActive` | `PUT /v1/slos/{id}/active` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `slo.set_active` |
| `sourcemapTokens.create` | `POST /v1/sourcemap-tokens` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `sourcemap_token.create` |
| `sourcemapTokens.revoke` | `DELETE /v1/sourcemap-tokens/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `sourcemap_token.revoke` |
| `ticketIntegrations.create` | `POST /v1/ticket-integrations` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `ticket_integration.create` |
| `ticketIntegrations.update` | `PATCH /v1/ticket-integrations/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `ticket_integration.update` |
| `uptime.create` | `POST /v1/uptime-checks` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `uptime_check.create` |
| `uptime.delete` | `DELETE /v1/uptime-checks/{id}` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `uptime_check.delete` |
| `uptime.setEnabled` | `PUT /v1/uptime-checks/{id}/enabled` | session administrateur | `app` de la requête : UNE application nommée du périmètre (`all` refusé) | **refusée** | exigé | `uptime_check.set_enabled` |
| `users.setActive` | `PUT /v1/user-activations` | administrateur de la plateforme | — | **refusée** | exigé | `user.set_active` |
| `users.create` | `POST /v1/users` | administrateur de la plateforme | — | **refusée** | exigé | `user.create` |
| `ops.version` | `GET /v1/version` | aucune session | — | lecture | **non exigé** | — |

## Les codes d'erreur

Un code est un contrat : on en ajoute, on n'en renomme pas. Le corps d'un refus est `{ meta: { request_id }, error: { code, message, details? } }`.

| Code | Statut |
|---|---|
| `entree_invalide` | 400 |
| `filtre_non_supporte` | 400 |
| `session_requise` | 401 |
| `session_invalide` | 401 |
| `identifiants_refuses` | 401 |
| `origine_refusee` | 403 |
| `demo_refusee` | 403 |
| `role_insuffisant` | 403 |
| `hors_perimetre` | 403 |
| `route_inconnue` | 404 |
| `ressource_inconnue` | 404 |
| `methode_refusee` | 405 |
| `conflit` | 409 |
| `corps_trop_grand` | 413 |
| `debit_depasse` | 429 |
| `erreur_interne` | 500 |
| `indisponible` | 503 |
| `echeance_depassee` | 503 |
