# Décisions d'architecture (ADR)

Une décision par fichier : son contexte, ce qui a été décidé, ce que ça coûte, et ce qui a été écarté. Une décision remplacée n'est pas effacée : elle passe au statut « remplacée par … ». La dernière colonne dit où en est la mise en œuvre au 26/09/2026 : dans le code (`master`) ou en service en production.

| N° | Décision | Statut | Mise en œuvre au 26/09/2026 |
|---|---|---|---|
| [0001](../../ADR-0001-supervision-ia-xsom.md) | La supervision IA quitte mip-rum pour xSOM AI Guard | acceptée (07/2026) | par lots (§ Migration de l'ADR) |
| [0002](0002-console-interface-sans-base.md) | La console devient une interface sans base, appuyée sur `console-api` | acceptée (25/09/2026) | code livré (C0 → C13, bascule #325, inerte) ; `console-api` pas encore déployé |
| [0003](0003-roles-et-tenancy.md) | Rôles de base et cloisonnement des applications | acceptée (24/09/2026) | rôles écrits (v89, v93), pas encore en production |
| [0004](0004-migrations.md) | Migrations : un seul migrateur, en avant seulement, schéma N et N+1 | acceptée (24/09/2026) | en place depuis P1 |
| [0005](0005-relais-ingestion.md) | La console relaie la collecte au collector, pour une durée datée | acceptée (24/09/2026) | relais livré, éteint ; collector pas encore créé |
| [0006](0006-mcp-sans-base.md) | Le serveur MCP n'a aucun accès à la base | acceptée (24/09/2026) | en place (`mcp` déployé) |
| [0007](0007-iac-railway.md) | L'infrastructure Railway est du code, relu comme du code | acceptée (24/09/2026) | en place depuis P1 ; l'apply qui crée les nouveaux services attend |
| [0008](0008-scheduler-unique.md) | Un seul déclencheur pour les travaux planifiés, sous bail | acceptée (24/09/2026) | en place depuis P0 |
| [0009](0009-blobs-en-postgres.md) | Rejeu et source maps restent en Postgres, avec un seuil de sortie | acceptée (24/09/2026) | en place |
| [0010](0010-console-api.md) | `console-api` : un service, un pipeline, un seul client | acceptée (25/09/2026) | code livré ; service pas encore créé |
| [0011](0011-sessions-es256.md) | Sessions signées ES256, révocables en base | acceptée (25/09/2026) | code livré ; pas en service |
| [0012](0012-roles-de-la-console.md) | Les rôles de la console : `mip_console` et `mip_identity` | acceptée (25/09/2026) | v93 écrite, pas encore en production |
| [0013](0013-pas-de-table-crash-natif.md) | Pas de table de crash natif tant qu'aucun moteur n'est choisi | acceptée (24/09/2026) | en place (aucune table) |
| [0014](0014-base-gratuite.md) | La base reste sur l'offre gratuite, en mode dégradé affiché | acceptée (24/09/2026) | en vigueur ; calcul suspendu jusqu'au 01/10/2026 |
