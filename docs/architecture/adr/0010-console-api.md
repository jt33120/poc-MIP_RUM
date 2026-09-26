# ADR-0010 — `console-api` : un service, un pipeline, un seul client

- **Statut** : acceptée ; code livré (C0 → C13, bascule #325) ; service déclaré dans l'IaC, pas encore créé sur Railway
- **Date** : 2026-09-25
- **Portée** : `services/console-api`, `@mip/console-api`, `@mip/console-contract`

## Contexte

Le backend de la console ([ADR-0002](0002-console-interface-sans-base.md)) sert un seul client — le serveur Vercel de la console — mais porte ce qu'il y a de plus sensible : l'identité, les écritures, l'administration, le RGPD. Son domaine est généré par Railway, donc public ; Vercel ne rejoint pas le réseau privé.

## Décision

1. **Un pipeline, dans cet ordre, pour toute opération** (`packages/console-api/src/pipeline.ts`) : identifiant de requête et échéance (200 à 15 000 ms) ; **secret client** en temps constant (`x-mip-client`, deux valeurs pendant une rotation) — absent, un 404 nu ; **tout `Origin` refusé** (403 : aucun navigateur n'appelle ce service) ; route ; **session** ([ADR-0011](0011-sessions-es256.md)) ; démo, rôle, portée — avant tout traitement ; ressource du chemin relue en base (absente ou hors périmètre : le même 404) ; entrée validée ; débit par principal ; traitement sous l'échéance ; enveloppe `no-store`, signée `x-mip-console-api: 1`.
2. **Une table d'opérations vérifiée au démarrage** (`verifierTable`) : toute écriture refusée à la démo et auditée (ou exemptée avec un motif) ; une lecture publique seule peut se passer du secret client ; la portée « une application nommée » est celle d'une écriture. Un service dont la table viole une règle ne démarre pas.
3. **Le contrat est un paquet** (`@mip/console-contract`, zéro dépendance) : descripteurs d'opérations, validateurs, codes d'erreur, `Fil<T>`. Sa doc est générée (`docs/api/console-api.md`) et tenue par un test de vérité.
4. **Une poignée de main signée** (`GET /v1/version?nonce=`, ES256) : la console vérifie l'hôte AVANT d'envoyer un secret — un domaine généré peut être réattribué.
5. **Les écrans et les commandes sont injectés** : le service embarque les chargeurs et les commandes de la console (bundle esbuild, refusé s'il importe une page, un composant ou ce qui tient une session de la console). Une commande rend une DÉCISION (`cree`, `introuvable`, `conflit`…) en 200 ; un refus d'accès ou d'entrée part avant elle, avec son code.
6. **Deux rôles de base** ([ADR-0012](0012-roles-de-la-console.md)) : l'identité et le reste ne se prêtent pas leurs droits.

## Conséquences

- Une matrice d'autorisations (`tests/contract/console-api-authz.test.ts`) joue chaque opération réelle pour huit profils (anonyme, jeton invalide, session révoquée, compte désactivé, démo, viewer, administrateur d'une liste, plateforme) et chaque cible, contre un oracle écrit à part — en CI, sous les rôles de moindre privilège.
- Le service ne rend jamais la cause d'une panne : 500 et un message générique, la cause au journal avec le `request_id`.
- Un secret de plus à tenir sur Vercel (le secret client) ; aucun secret d'identité.

## Écarté

- **CORS et appels depuis le navigateur** : un service qui n'a qu'un client serveur n'a pas à ouvrir d'origine. `GET /api/releases`, appelée par la barre de filtres, reste une route de la console (relais serveur).
- **Le réseau privé seul** : Vercel ne le rejoint pas.
- **GraphQL ou tRPC** : des descripteurs à types fantômes suffisent, sans dépendance, et se vérifient au démarrage.
