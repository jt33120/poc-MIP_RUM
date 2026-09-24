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

**Règles vérifiées au démarrage** (`verifierTable`) : toute écriture est refusée à la démo (sauf fermer sa propre session) et déclare son action d'audit, ou une exemption motivée ; seule une lecture publique peut se passer du secret client ; une opération publique n'a pas de portée. Un service dont la table viole une règle ne démarre pas.

## Les opérations

| Opération | Méthode et chemin | Authentification | Portée | Démo | Secret client | Audit |
|---|---|---|---|---|---|---|
| `ops.jwks` | `GET /v1/.well-known/jwks.json` | aucune session | — | lecture | **non exigé** | — |
| `auth.demo` | `POST /v1/auth/demo-sessions` | aucune session | — | **refusée** | exigé | `auth.demo` |
| `auth.methods` | `GET /v1/auth/methods` | aucune session | — | lecture | exigé | — |
| `auth.oidc` | `POST /v1/auth/oidc-sessions` | aucune session | — | **refusée** | exigé | `auth.oidc` |
| `auth.oidcStart` | `GET /v1/auth/oidc/authorization` | aucune session | — | lecture | exigé | — |
| `auth.login` | `POST /v1/auth/sessions` | aucune session | — | **refusée** | exigé | `auth.login` |
| `auth.logout` | `DELETE /v1/auth/sessions/current` | session | — | lecture | exigé | `auth.logout` |
| `auth.me` | `GET /v1/me` | session | — | lecture | exigé | — |
| `public.platformStatus` | `GET /v1/public/platform-status` | aucune session | — | lecture | exigé | — |
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
