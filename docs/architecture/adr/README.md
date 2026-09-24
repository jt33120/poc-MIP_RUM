# Décisions d'architecture (ADR)

Une décision par fichier : son contexte, ce qui a été décidé, ce que ça coûte, et ce qui a été écarté. Une décision remplacée n'est pas effacée : elle passe au statut « remplacée par … ».

| N° | Décision | Statut |
|---|---|---|
| [0001](../../ADR-0001-supervision-ia-xsom.md) | La supervision IA quitte mip-rum pour xSOM AI Guard | acceptée (2026-07) |
| 0002 | La console devient une interface sans base, appuyée sur `console-api` | à écrire en P6b (piste C) |
| [0003](0003-roles-et-tenancy.md) | Rôles de base et cloisonnement des applications | acceptée |
| [0004](0004-migrations.md) | Migrations : un seul migrateur, en avant seulement, schéma N et N+1 | acceptée |
| [0005](0005-relais-ingestion.md) | La console relaie la collecte au collector, pour une durée datée | acceptée |
| [0006](0006-mcp-sans-base.md) | Le serveur MCP n'a aucun accès à la base | acceptée |
| [0007](0007-iac-railway.md) | L'infrastructure Railway est du code, relu comme du code | acceptée |
| [0008](0008-scheduler-unique.md) | Un seul déclencheur pour les travaux planifiés, sous bail | acceptée |
| [0009](0009-blobs-en-postgres.md) | Rejeu et source maps restent en Postgres, avec un seuil de sortie | acceptée |
| 0010 – 0012 | `console-api`, sessions ES256, rôles de la console | à écrire avec la piste C |
| [0013](0013-pas-de-table-crash-natif.md) | Pas de table de crash natif tant qu'aucun moteur n'est choisi | acceptée |
| [0014](0014-base-gratuite.md) | La base reste sur l'offre gratuite, en mode dégradé affiché | acceptée (24/09/2026) |
