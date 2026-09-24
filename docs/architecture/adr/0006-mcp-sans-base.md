# ADR-0006 — Le serveur MCP n'a aucun accès à la base

- **Statut** : acceptée, en place
- **Date** : 2026-09-24
- **Portée** : service `mcp`, `packages/mcp-tools`

## Contexte

Le serveur MCP est le seul service **pilotable par un modèle de langage**, donc par le texte que ce modèle a lu. Une injection de prompt réussie fait exécuter à l'agent des appels d'outils que son utilisateur n'a pas voulus. Aucune validation d'entrée ne ferme ce risque de façon certaine.

## Décision

1. **Rien à atteindre** : le service ne porte ni `pg`, ni `DATABASE_URL`, ni jeton propre. Il relaie le jeton de l'appelant vers l'API de lecture v1, qui applique déjà le cloisonnement par jeton (portée d'applications, lecture seule).
2. **Vérifié par la construction** : l'image ne contient que la fermeture des dépendances de `@mip/service-mcp`, et la fumée Docker échoue si `pg` apparaît dans l'arbre déployé ou si le service dépend de la base.
3. Cible : `mcp` appellera le service `api` par le réseau privé Railway (P4), au lieu de l'API v1 de la console.

## Conséquences

- Le pire qu'un agent détourné puisse faire est ce que le jeton de son utilisateur permet déjà : lire les agrégats de ses applications.
- Chaque nouvel outil MCP est d'abord une route de l'API v1 ; le catalogue d'outils ne peut rien exposer que l'API ne sache faire.

## Écarté

- **Un accès lecture seule direct à la base** pour de meilleures performances : il déplacerait la frontière de sécurité dans le service que l'on contrôle le moins.
