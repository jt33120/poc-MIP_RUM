# SSO enterprise — OpenID Connect (P0)

> Permet à un grand compte de connecter la console RUM à **son** fournisseur
> d'identité (Azure AD/Entra, Okta, Keycloak, Google Workspace…) via **OpenID
> Connect** (Authorization Code + PKCE). Le login email/mot de passe reste
> disponible en repli. Provisioning **JIT** (le compte console est créé/mis à jour
> à la 1ʳᵉ connexion). Implémentation **OIDC standard** → tout IdP conforme.

## Activation

Définir ces variables d'environnement sur la console (vides ⇒ SSO **désactivé**, le
bouton n'apparaît pas) :

| Variable | Requis | Rôle |
|---|---|---|
| `OIDC_ISSUER` | ✅ | URL de l'émetteur (ex. `https://idp.example/realms/mip`) — la discovery `/.well-known/openid-configuration` en découle |
| `OIDC_CLIENT_ID` | ✅ | identifiant du client OIDC |
| `OIDC_CLIENT_SECRET` | ✅ | secret du client (client confidentiel) — **à injecter depuis un coffre** (Supabase Vault / secret manager), jamais en clair dans le repo |
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
