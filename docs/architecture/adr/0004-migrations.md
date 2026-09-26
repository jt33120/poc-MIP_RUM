# ADR-0004 — Migrations : un seul migrateur, en avant seulement, schéma N et N+1

- **Statut** : acceptée, en place depuis P1
- **Date** : 2026-09-24
- **Portée** : `packages/db`, service `scheduler`, CI

## Contexte

Le schéma s'est longtemps appliqué à la main, `psql -f` depuis un poste, pendant que le code se déployait tout seul : une colonne absente faisait rejeter des lots d'ingestion entiers. Plus tard, les migrations ont vécu dans le pré-déploiement d'un receveur que plus rien n'atteignait — elles auraient pu cesser sans que personne ne le voie. Railway, enfin, n'ordonne pas les déploiements entre services.

## Décision

1. **Seul le `scheduler` migre**, en commande de pré-déploiement (`node services/scheduler/migrate.mjs`) : le service dont la disparition se verrait tout de suite, puisqu'il porte les alertes. Un pré-déploiement en échec garde l'ancien déploiement en service.
2. **En avant seulement** : pas de migration descendante. Une erreur se corrige par la migration suivante.
3. **Transaction par fichier**, registre (`schema_migration`) écrit dans la même transaction, verrou de **transaction** (`pg_advisory_xact_lock`) : un verrou de session se perd derrière le pooler Neon, constaté.
4. **Un fichier fusionné ne change plus** : `scripts/ci/migrations-figees.mjs` refuse toute modification, suppression ou renumérotation, et tout ajout dont le numéro ne dépasse pas la dernière migration de `master`. Aucune échappatoire.
5. **Schéma compatible N et N+1 (expand / contract)** : une migration ajoute, le code suit, la suppression vient dans un lot ultérieur. Le code doit tourner avant ET après sa migration — c'est pourquoi `appelerFnSiPresente` rend « migration non appliquée » au lieu d'échouer, et pourquoi la CI rejoue des bases arrêtées à une version antérieure (`SQL_TEST_PRE_V86_DATABASE_URL` et consorts).
6. **Index lourds** : un `predeploy-vNN-*.sql` passe avant sa migration, sur `MIGRATION_DATABASE_URL` (connexion directe, hors pooler), sous verrou de session, avec reconstruction si l'index est invalide.
7. **La CI lance le migrateur deux fois** sur une base vierge : le second passage doit dire « 0 en attente ».

## Conséquences

- Un `redeploy` Railway ne rejoue **pas** le pré-déploiement (vérifié le 18/09/2026) : seul un vrai déploiement, déclenché par un commit sur les chemins surveillés du scheduler, applique une migration.
- Deux branches qui prennent le même numéro se découvrent à la fusion : la seconde renumérote. Le plan réservait v88 à `mip_api` et v91 aux rôles de la console ; la numérotation a glissé à chaque migration intercalée : v87 `platform_flag`, v88 livraison P5, v89 `mip_api`, v90 sessions de la console, v91 SSO, v92 privilège des jetons de CI, v93 rôles `mip_console` et `mip_identity`.
- Le schéma ne peut plus être en retard sur le code, mais il peut être EN AVANCE : un code plus ancien doit tolérer une colonne en plus. C'est la règle 5.

## Écarté

- **Un service `migrate` dédié** sur Railway : un service de plus à surveiller, pour une commande de quelques secondes par déploiement.
- **Les migrations au démarrage de chaque service** : deux services démarrant ensemble se disputeraient le registre, et un service ne doit pas avoir le droit de changer le schéma.
