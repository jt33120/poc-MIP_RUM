# SSO enterprise — OpenID Connect (P0)

> Permet à un grand compte de connecter la console RUM à **son** fournisseur
> d'identité (Azure AD/Entra, Okta, Keycloak, Google Workspace…) via **OpenID
> Connect** (Authorization Code + PKCE). Le login email/mot de passe reste
> disponible en repli. Provisioning **JIT** (le compte console est créé/mis à jour
> à la 1ʳᵉ connexion). Implémentation **OIDC standard** → tout IdP conforme.

## Quel flux sert en production (26/09/2026)

Deux implémentations du même contrat existent dans le code (master) ; les routes
`/api/auth/oidc/login` et `/api/auth/oidc/callback` de la console choisissent entre elles
à chaque requête (`backend().estBranche()`, `apps/console/lib/backend.ts`) :

- **La console seule — le flux en service.** Tant que la console n'est pas branchée sur
  `console-api` (il y faudrait `CONSOLE_API_URL`, `CONSOLE_API_CLIENT_SECRET` et
  `SESSION_PUBLIC_JWKS` sur Vercel, et un service `console-api` qui n'existe pas encore),
  c'est son propre code OIDC qui tourne
  (`apps/console/lib/oidc.ts`, sections « Activation » et suivantes), avec les défauts
  décrits dans le tableau ci-dessous. Le SSO n'y est actif que si les `OIDC_*` sont posées
  sur Vercel — non vérifié ici.
- **Par `console-api` (C1c) — livré, pas en service.** Le service `console-api` n'est pas
  encore créé sur Railway, la connexion par `console-api` n'est pas branchée, et la
  migration-v91 (colonnes `oidc_iss`, `oidc_sub`) n'est pas encore appliquée en production
  (appliquée jusqu'à v86).

## Depuis C1c : le SSO par `console-api`

> Ce qui suit décrit le flux **de la console branchée sur `console-api`** (piste C). Tant que la console n'y est pas branchée, le flux historique décrit plus bas reste en service, avec ses défauts.

**Où vit la configuration.** Sur le service `console-api`, plus sur Vercel :
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` (toujours la route de la console, `/api/auth/oidc/callback`) ;
- `OIDC_TX_KEY` : 32 octets en base64url ;
- en option : `OIDC_SCOPES`, `OIDC_ROLE_CLAIM`, `OIDC_ADMIN_VALUES`, `OIDC_APPS_CLAIM`, `OIDC_ALLOWED_DOMAINS`.

C'est tout ou rien : une configuration partielle refuse le démarrage (`services/console-api/server.mjs`).

**Le flux.** La console appelle `GET /v1/auth/oidc/authorization`. Le service découvre l'IdP, dont l'émetteur est **épinglé** : il doit être celui de la configuration. Il prépare le PKCE, l'état et le nonce, et les **scelle** dans une transaction JWE (`dir` + A256GCM). La console garde cette transaction en cookie 10 minutes, sans pouvoir la lire.

Au retour de l'IdP, `POST /v1/auth/oidc-sessions` reçoit le code, l'état et la transaction. Le service échange le code (le secret client OIDC ne quitte pas `console-api`), vérifie l'ID token (émetteur, audience, nonce), puis lie le compte.

**Le lien au compte (migration-v91).**

| Cas | Avant (flux historique) | Depuis C1c |
|---|---|---|
| Retrouver un compte | par l'**e-mail**, ou `preferred_username` à défaut | par **(émetteur, sujet)** une fois lié ; jamais plus par l'e-mail |
| Premier lien avec un compte existant | toujours | seulement si le compte est **pré-provisionné** (`password_hash = 'sso:oidc'`), ou si l'IdP **atteste** l'adresse (`email_verified`) dans un domaine d'`OIDC_ALLOWED_DOMAINS` |
| Compte inconnu (JIT) | créé | créé aux mêmes conditions, **sans aucune application** tant qu'un administrateur ou le claim d'applications n'en donne pas |
| Compte désactivé | **réactivé** | refusé, et il le reste |
| Portée donnée par l'IdP | `apps` nul possible (toutes les apps) | jamais nul : l'IdP ne donne pas la portée plateforme |

Chaque refus rend le même « Identifiants invalides » au navigateur. Sa raison (`email_non_verifie`, `domaine_non_autorise`, `compte_desactive`, `compte_lie_a_un_autre_sujet`, `nonce_different`…) est inscrite au journal d'audit (`auth.oidc_refused`).

**Ce qui le prouve.** `tests/integration/console-api-sso-sql.test.ts` joue contre un faux IdP qui vérifie le PKCE, avec la vraie base : chaque cas du tableau, et chaque mensonge (état, transaction, nonce, émetteur, audience).

## Activation (flux historique, la console seule)

Définir ces variables d'environnement sur la console, sur Vercel (vides ⇒ SSO **désactivé**, le
bouton n'apparaît pas ; `oidcConfig()`, `apps/console/lib/oidc.ts`) :

| Variable | Requis | Rôle |
|---|---|---|
| `OIDC_ISSUER` | ✅ | URL de l'émetteur (ex. `https://idp.example/realms/mip`) — la discovery `/.well-known/openid-configuration` en découle |
| `OIDC_CLIENT_ID` | ✅ | identifiant du client OIDC |
| `OIDC_CLIENT_SECRET` | ✅ | secret du client (client confidentiel) — variable **secrète** de l'hébergeur (Vercel aujourd'hui, le service `console-api` après la bascule), jamais en clair dans le repo |
| `OIDC_REDIRECT_URI` | ✅ | `https://<console>/api/auth/oidc/callback` |
| `OIDC_SCOPES` | — | défaut `openid email profile` |
| `OIDC_ROLE_CLAIM` | — | claim portant les rôles/groupes (ex. `groups`). Absent ⇒ le rôle reste géré dans la console |
| `OIDC_ADMIN_VALUES` | — | valeurs de `OIDC_ROLE_CLAIM` donnant le rôle **admin** (CSV, ex. `rum-admins,ops`) |
| `OIDC_APPS_CLAIM` | — | claim portant la liste d'`app_id` autorisés (viewer **scopé**). Absent ⇒ accès à toutes les apps selon le rôle |

## Mapping des rôles (RBAC)

- **`OIDC_ROLE_CLAIM` configuré** : `admin` si une valeur du claim ∈ `OIDC_ADMIN_VALUES`, sinon `viewer`. Le rôle de l'IdP **fait autorité** à chaque connexion.
- **non configuré** : nouveaux comptes = `viewer` ; le rôle d'un compte existant (géré dans `/admin/users`) est **préservé**.
- **`OIDC_APPS_CLAIM` configuré** : la liste scope le `viewer` (mêmes apps que le RBAC console). Sinon, scope inchangé.

## Provisioning JIT

À la 1ʳᵉ connexion SSO, le `console_user` est **créé** (`password_hash` = sentinelle
`sso:oidc` ⇒ connexion par mot de passe **impossible** pour ce compte) ; aux suivantes
il est **mis à jour** (`last_login_at`, rôle/apps si l'IdP les fournit). Comportement
prouvé sur Postgres réel (`scripts/verify-oidc-jit.mjs`).

## Sécurité du flux

- **PKCE S256** + **state** (anti-CSRF) + **nonce** (anti-rejeu), stockés en cookies
  httpOnly courts (10 min), effacés au retour.
- **ID token** validé : signature (JWKS de l'IdP), `iss`, `aud` (= client_id), `nonce`.
- Le `/api/auth/*` est exclu de la garde de session du middleware (sinon boucle de
  redirection) ; l'authentification se fait dans le handler de callback.

## Exemple Keycloak (démo souveraine)

```
Client ID            : mip-rum-console
Access Type          : confidential   (génère un secret -> OIDC_CLIENT_SECRET)
Standard Flow        : ON  (Authorization Code)
Valid Redirect URIs  : https://<console>/api/auth/oidc/callback
Web Origins          : https://<console>
Mappers              : group membership -> claim "groups"   (-> OIDC_ROLE_CLAIM=groups)
```
Puis sur la console :
```
OIDC_ISSUER=https://<keycloak>/realms/<realm>
OIDC_CLIENT_ID=mip-rum-console
OIDC_CLIENT_SECRET=<secret>           # depuis le coffre
OIDC_REDIRECT_URI=https://<console>/api/auth/oidc/callback
OIDC_ROLE_CLAIM=groups
OIDC_ADMIN_VALUES=rum-admins
```

## Reste à faire (suivi)

- **SCIM** (provisioning/déprovisioning poussé par l'IdP) : le JIT couvre la création
  à la connexion ; la **révocation** repose aujourd'hui sur la désactivation côté IdP
  (le compte ne peut plus obtenir de token) + `active=false` manuel. SCIM = étape suivante si un AO l'exige.
- **Logout SSO** (RP-initiated logout / back-channel) : aujourd'hui le logout est local
  (cookie de session). À brancher sur `end_session_endpoint` si demandé.
- Validation **bout-en-bout** contre un Keycloak de démo (le cœur OIDC est testé en
  unitaire ; la validation JWKS/échange de code se vérifie contre l'IdP réel).
