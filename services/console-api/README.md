# `console-api`

**Rôle.** Le backend de la console : ce que le serveur Vercel appellera au lieu d'ouvrir la base. Identité, sessions, lectures des écrans, écritures, administration, RGPD, lot par lot (piste C, C0 → C12). À la fin, la console n'a plus ni `DATABASE_URL` ni secret d'identité.

| | |
|---|---|
| Groupe du canevas | 2 · Restitution |
| Point d'entrée | `node services/console-api/dist/server.mjs`, construit par `node services/console-api/build.mjs` depuis `server.mjs` (câblage seul, sur `@mip/service-kit`) |
| Logique | [`@mip/console-api`](../../packages/console-api) (pipeline, table des opérations, traitements) et [`@mip/console-contract`](../../packages/console-contract) (descripteurs, types, codes d'erreur), en TypeScript, compilés dans le bundle |
| Exposition | public (domaine généré), **gardé par le secret client** : sans lui, tout répond 404. Vercel ne rejoint pas le réseau privé Railway |
| Rôle BDD | propriétaire jusqu'à C13 (puis `mip_console` et `mip_identity`) ; pool de 8 par réplique, `application_name = mip-console-api` |
| Réplicas | 2 (sans état ; le débit par principal est compté par réplique) |
| Image | `services/console-api/Dockerfile` : `dist/server.mjs` et `pg`, aucune source de la console |

État au 24/09/2026 : **pas encore déployé.** Trois opérations : la poignée de main, les clés publiques, l'état de la plateforme que lit la vitrine. La console sait l'appeler (`apps/console/lib/backend.ts`, C0b) **dès que ses trois variables sont posées sur Vercel** ; sans elles, elle lit la base comme avant. Le service **vérifie** déjà les sessions et résout les ressources du chemin (C0c) ; il les **ouvrira** en C1.

## Un seul client, et comment il s'annonce

| Garde | Ce qui la franchit | Sinon |
|---|---|---|
| secret client `x-mip-client` | le serveur de la console (1 valeur, 2 pendant une rotation), comparé en temps constant | **404 nu**, indiscernable d'un chemin inconnu : le service ne se révèle pas |
| pas d'`Origin` | un appel serveur à serveur | 403 : un navigateur en pose toujours un en cross-origin. Aucun en-tête CORS n'est émis |
| session `Authorization: Bearer` | un jeton ES256 de ce service **et** sa ligne `console_session` (migration-v90), jointe au compte : rôle et périmètre lus en base | 401 ; 503 si la base ne répond pas |
| ressource du chemin (portée « ressource ») | une ressource dont l'application est dans le périmètre | 404 `ressource_inconnue`, **le même** que pour une ressource qui n'existe pas |

**La poignée de main.** Le domaine généré d'un service Railway peut être réattribué si le service est recréé. Avant d'envoyer son secret client, la console appelle donc `GET /v1/version?nonce=<aléa>` sans secret. Le service signe (ES256) le nonce, l'empreinte du contrat servi, la version et le `kid`. La console vérifie avec la clé **publique** (`SESSION_PUBLIC_JWKS`) : seul le vrai service a la clé privée.

**Les sessions** (`packages/console-api/src/session.ts`). Le jeton ne porte que `{ iss, aud, sid, iat, exp }`, plus `demo: true` pour une démo : ni rôle, ni périmètre, ni e-mail. Le drapeau de démo est la seule exception, parce qu'il ne change jamais. Le middleware de la console le lit pour refuser toute écriture à une démo sans appeler le service, et le service exige qu'il concorde avec la ligne. Ce qu'un jeton porte, il le porte jusqu'à son expiration, même quand la base a changé d'avis. Le service vérifie d'abord la signature, puis relit la ligne de session et le compte, avec un cache de **30 s** par réplique. C'est le délai maximal d'une révocation, d'un compte désactivé ou d'un rôle retiré. Un en-tête qui désigne une clé ailleurs (`jku`, `jwk`, `x5u`) est refusé, comme tout algorithme autre qu'ES256. La matrice d'autorisations (`tests/contract/console-api-authz.test.ts`) appelle chaque opération avec 8 profils réels, sur PostgreSQL.

La table des opérations, leurs politiques et les codes d'erreur sont dans **[docs/api/console-api.md](../../docs/api/console-api.md)**. Ce fichier est généré depuis la table : il ne peut pas diverger du code.

## Sondes

`/health` : processus et base ; c'est la sonde Railway, sans secret client. `/live` : processus. `/ready` et `/metrics` : sous `METRICS_TOKEN` (`console_api_requests_total{operation,status}`).

## Configuration

`node services/console-api/dist/server.mjs --print-env-example` écrit le gabarit (après `node services/console-api/build.mjs`).

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui, **sauf** avec les deux suivantes (secret) | Postgres en rôle propriétaire — tant que les rôles de C13 ne sont pas posés |
| `CONSOLE_DATABASE_URL` | non, **avec** la suivante (secret) | C13 — rôle `mip_console` (migration-v93) : écrans, commandes, RGPD. Posée, le service ne tient plus le propriétaire. |
| `IDENTITY_DATABASE_URL` | non, **avec** la précédente (secret) | C13 — rôle `mip_identity` : connexion, sessions, débit d'authentification ; son propre pool. Une seule des deux : refus de démarrer. |
| `CONSOLE_API_CLIENT_SECRETS` | **oui** (secret) | le secret client : `nouvelle` ou `nouvelle,ancienne` pendant une rotation, 32 caractères au moins chacune |
| `SESSION_SIGNING_KEYS` | **oui** (secret) | jeu JWKS **privé** ES256, 1 ou 2 clés (la première signe) : `node scripts/ops/generer-cles-session.mjs --nouvelle \| pbcopy`. Un `kid` qui dit « test » ou « dev » est refusé hors poste de travail |
| `CONSOLE_API_RATE_LIMIT` | non | appels par minute et par principal, par réplique (défaut 600 ; la console rejoue ses écrans toutes les 5 s) |
| `DEMO_USER_APPS` | non | applications visibles en démo, séparées par des virgules. Vide : **pas de démo** (`POST /v1/auth/demo-sessions` → 404). Le rôle n'est pas réglable : une démo est `viewer` |
| `DEMO_USER_EMAIL` | non | étiquette de la session de démo dans le journal (défaut `demo@mip-rum.local`) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (secret), `OIDC_REDIRECT_URI`, `OIDC_TX_KEY` (secret, 32 octets base64url) | non, **tous ou aucun** | le SSO (C1c) ; une configuration partielle refuse le démarrage. Options : `OIDC_SCOPES`, `OIDC_ROLE_CLAIM`, `OIDC_ADMIN_VALUES`, `OIDC_APPS_CLAIM`, `OIDC_ALLOWED_DOMAINS`. Modèle et règles de lien : [docs/SSO.md](../../docs/SSO.md) |
| `PGPOOL_MAX`, `PORT`, `LOG_LEVEL`, `METRICS_TOKEN`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | non | voir le kit |

Côté Vercel (C0b) : `CONSOLE_API_URL` (le domaine généré, en https), `CONSOLE_API_CLIENT_SECRET` (une valeur) et `SESSION_PUBLIC_JWKS`, qui n'est pas secrète (`--publique`). Les trois vont ensemble : une configuration partielle, ou une clé PRIVÉE posée sur Vercel, est refusée et journalisée, et la console reste sur la base. Avant d'envoyer son secret à un hôte, la console vérifie la poignée de main (valable 10 minutes par instance) ; un hôte qui ne la prouve pas ne reçoit jamais le secret.

**Rotation du secret client** :
1. poser `nouvelle,ancienne` sur le service ;
2. poser `nouvelle` sur Vercel ;
3. retirer `ancienne` du service.

**Rotation des clés de session** : `--rotation`, `--promouvoir` puis `--retirer` (en-tête du script), en publiant la nouvelle clé publique sur Vercel avant de la faire signer.

## L'identité (C1)

| Opération | Ce qu'elle fait |
|---|---|
| `POST /v1/auth/sessions` | connexion par mot de passe : une **ligne** `console_session` et un jeton ES256 qui ne porte que son identifiant. Refus générique `identifiants_refuses` (un compte inconnu coûte le même bcrypt, contre un hachage factice) |
| `POST /v1/auth/demo-sessions` | session de démonstration : `viewer`, périmètre `DEMO_USER_APPS`, **5 par heure et par IP** ; jamais l'IP au journal |
| `DELETE /v1/auth/sessions/current` | déconnexion : la session est **révoquée** en base, le jeton ne vaut plus rien, tout de suite sur cette réplique, en 30 s sur l'autre |
| `GET /v1/me` | le principal, relu en base : rôle et périmètre du compte, jamais du jeton |
| `GET /v1/auth/methods` | les moyens de connexion offerts (SSO, démo) : la console montre ses boutons sans détenir la configuration |
| `GET /v1/auth/oidc/authorization`, `POST /v1/auth/oidc-sessions` | le SSO : l'adresse de l'IdP et une transaction scellée (JWE) ; puis l'échange du code, la vérification de l'ID token et le lien par (émetteur, sujet) — [docs/SSO.md](../../docs/SSO.md) |

**Le débit d'authentification** vit en base (`auth_throttle`, migration-v90), pour toutes les répliques, et se vérifie **avant bcrypt** :
- IP + e-mail : 8 échecs par 10 min ;
- IP seule : 30 échecs par 10 min ;
- e-mail : 20 échecs par heure, puis un délai qui double (1 min → 1 h).

Les clés sont des HMAC : ni IP ni e-mail en clair. La clé HMAC est dérivée du secret client (HKDF) ; une rotation du secret remet les compteurs à zéro.

L'adresse du visiteur arrive par `x-mip-visitor-ip`, posée par le serveur de la console. Elle n'est crue que parce que seul le détenteur du secret client peut la poser. bcrypt tourne 4 à la fois au plus par réplique.

Chaque écriture laisse sa ligne `audit_log` (`auth.login`, `auth.login_failed`, `auth.login_blocked`, `auth.demo`, `auth.logout`) avec le `request_id` et `actor_kind`, dans la **même transaction**.

## Les écrans (C2 → C5)

Les données de chaque écran sont chargées par un **chargeur** qui vit dans la console (`apps/console/lib/chargeurs/`). La console l'appelle aujourd'hui en local. Ce service l'**embarque tel quel** dans son bundle, sur son propre pool, et le sert (`GET /v1/shell` pour la coquille, C2). La parité n'est donc pas un test : c'est le même code.

Une lecture en échec devient une **section** `{ ok: false, code: "lecture_en_echec" }`. Sa raison part au journal avec le `request_id`, jamais dans la réponse.

La garde du build n'accepte de la console que sa couche de données : ni écran (`app/`), ni composant, ni `lib/auth.ts`, `lib/session-console.ts` ou `lib/backend.ts`, ni Next ou React réels. L'image ne copie que `apps/console/lib`.

**Mise en service décidée à la fin, après P6b.** D'ici là, la console lit en local. Une PR par écran la branchera ensuite sur ce service et retirera sa lecture directe.

## Sûreté multi-réplique

Le service est sans état : chaque requête lit la base. Le débit par principal est compté par réplique : avec deux répliques, un principal peut atteindre le double de la limite. Les écritures (C6 et suivants) se feront chacune dans sa transaction, avec la ligne d'audit dans la même transaction.

## Modes de panne

| Panne | Ce qui se passe |
|---|---|
| Configuration ou clés invalides | refus de démarrer, code 2, la liste des erreurs au journal, jamais une valeur de secret |
| Table des opérations qui viole une règle (écriture sans audit, ouverte à la démo…) | refus de démarrer : la faute est au code, pas à la production |
| Base injoignable | `/health` en 503 (Railway ne bascule pas le trafic) ; une lecture en échec rend « illisible », jamais une fausse absence ; une session invérifiable rend **503 `indisponible`**, pas 401 : la console ne renvoie pas l'utilisateur à la connexion parce que la base dort |
| Traitement plus long que l'échéance | 503 `echeance_depassee` : la console a déjà abandonné, inutile de la faire attendre |
| Panne dans un traitement | 500 `erreur_interne` avec le `request_id` ; la cause reste au journal |

## Lancement local

```bash
docker run -d --rm --name mip-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
node services/scheduler/migrate.mjs
node services/console-api/build.mjs
export CONSOLE_API_CLIENT_SECRETS=$(openssl rand -hex 32)
export SESSION_SIGNING_KEYS=$(node scripts/ops/generer-cles-session.mjs --nouvelle 2>/dev/null)
PORT=4324 node services/console-api/dist/server.mjs &
curl -s -H "x-mip-client: $CONSOLE_API_CLIENT_SECRETS" localhost:4324/v1/public/platform-status
```
