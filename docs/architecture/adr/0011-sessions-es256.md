# ADR-0011 — Sessions signées ES256, révocables en base

- **Statut** : acceptée ; code livré (C0c, C1), mise en service après P6b
- **Date** : 2026-09-25
- **Portée** : `console-api` (émission, vérification), la console Vercel (vérification seule), migrations v90 et v91

## Contexte

Les sessions de la console étaient des JWT HS256 signés par `AUTH_SECRET` — le même secret sur Vercel pour signer et vérifier, sans ligne en base : un compte désactivé gardait sa session jusqu'à expiration, et un secret fuité permettait de fabriquer n'importe quelle session. Le SSO liait un compte par son e-mail, sans regarder `email_verified`, et réactivait un compte désactivé.

## Décision

1. **Signature asymétrique ES256.** Le trousseau PRIVÉ (`SESSION_SIGNING_KEYS`, 1 ou 2 clés : la première signe) ne quitte pas `console-api` ; Vercel n'a que la clé PUBLIQUE (`SESSION_PUBLIC_JWKS`). Rotation en trois temps (`scripts/ops/generer-cles-session.mjs --nouvelle / --rotation / --promouvoir / --retirer`). Une clé dont le `kid` dit « test » est refusée hors poste de travail.
2. **Un jeton qui ne dit que son identifiant** (`{iss, aud, sid, iat, exp}`) : le rôle et le périmètre viennent du COMPTE, relu en base. Rétrograder un administrateur vaut sans reconnexion.
3. **Une ligne par session** (`console_session`, v90), jointe au compte à chaque vérification (cache 30 s par réplique : le délai maximal d'une révocation). Déconnexion, désactivation d'un compte, réinitialisation de son mot de passe : la ligne est révoquée. Base injoignable : 503, jamais une session acceptée sans ligne.
4. **La démo est une session comme les autres**, `demo: true`, viewer par construction (contrainte en base), immuable, vérifiée contre sa ligne.
5. **Débit d'authentification en base** (`auth_throttle`, clés HMAC dérivées du secret client) : 8 échecs / 10 min par IP et e-mail, 30 par IP, 20 / h par e-mail puis délai croissant, 5 démos / h par IP — le même compteur sur toutes les répliques.
6. **SSO lié par `(émetteur, sujet)`** (v91), émetteur épinglé, transaction scellée (JWE) ; premier lien d'un compte existant seulement s'il a été pré-provisionné pour le SSO ou si l'IdP atteste l'adresse dans un domaine autorisé ; un compte désactivé le reste ; l'IdP ne donne jamais la portée plateforme.

## Conséquences

- La bascule (après P6b) impose une reconnexion de tous : les sessions HS256 cessent de valoir quand `AUTH_SECRET` quitte Vercel.
- Chaque requête d'écran relit une ligne de session (en cache 30 s) : c'est le prix de la révocation.
- Le middleware de la console vérifie la signature seule (runtime Node) ; les pages résolvent le principal par `GET /v1/me`.

## Écarté

- **Des sessions sans état** (JWT seuls) : pas de révocation avant expiration.
- **HS256 partagé** : le secret qui vérifie peut signer.
- **Lier le SSO par e-mail** : un IdP qui laisse choisir son adresse ouvre le compte de quiconque la porte.
