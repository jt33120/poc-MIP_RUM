# ADR-0003 — Rôles de base et cloisonnement des applications

- **Statut** : acceptée ; rôles écrits (v89, P4 ; v93, C13), pas encore appliqués en production (qui s'arrête à v86 au 26/09/2026)
- **Date** : 2026-09-24
- **Portée** : Neon, tous les services qui se connectent à la base

## Contexte

Tout ce qui parle à la base aujourd'hui — la console Vercel, le scheduler, un poste de développement — se connecte en `neondb_owner`, propriétaire et `BYPASSRLS`. Le cloisonnement entre applications (les « tenants ») repose donc sur deux choses : un `WHERE app_id = …` dans chaque requête, et les policies `tenant_scope` de la migration v47, qui lisent la portée dans la GUC `app.current_app_id` (posée en `set_config(…, true)` par `withTenant`, jamais en `SET` de session : le pooler Neon en mode transaction la perdrait ou la laisserait au voisin). Avec un rôle `BYPASSRLS`, ces policies sont posées mais **inertes**.

Deux essais du 23/09/2026 sur la branche Neon `repetition-p0` bornent ce qu'on peut faire :

- un rôle **créé par l'API Neon** est membre de `neon_superuser` (BYPASSRLS, lecture et écriture de tout) : l'inverse du moindre privilège, et il n'exécute pourtant aucune des 21 fonctions dont `EXECUTE` est retiré à `PUBLIC` ;
- `GRANT neondb_owner TO …` est refusé : sous PostgreSQL 17, le propriétaire n'a plus l'option ADMIN sur son propre rôle.

## Décision

1. **Un rôle par surface, créé en SQL par `neondb_owner`** (qui reçoit alors l'option ADMIN sur eux), jamais par l'API Neon :
   - `mip_api` (migration v89, P4 — **écrite**, [liste blanche](../../../packages/db/roles/mip-api.mjs)) : `NOLOGIN` puis mot de passe posé une fois par un opérateur ; SELECT sur 28 tables et vues tirées des relations que nomme le bundle du service, et sur des colonnes choisies de trois autres (`console_user.id` seul, jamais l'e-mail ni le hachage ; l'existence d'un rejeu, jamais son contenu ; la cible d'un ticket, jamais sa référence de secret) ; aucun privilège par défaut ; `default_transaction_read_only`, `statement_timeout` de 15 s, transaction inactive coupée à 30 s, 20 connexions ; `EXECUTE` sur la seule fonction à droits de propriétaire qu'il lit. Les quatre fonctions à droits de propriétaire qui **écrivent** et restaient ouvertes à `PUBLIC` lui sont fermées : sans cela, un rôle sans droit d'écriture écrirait par elles ;
   - `mip_console` et `mip_identity` (**v93**, C13 — **écrite**, [ADR-0012](0012-roles-de-la-console.md)) : la console lit la télémétrie et écrit le plan de contrôle ; seul `mip_identity` lit un haché, une session ou un compteur de débit ; `audit_log` en insertion (et en lecture pour l'écran d'audit).
2. **Les policies deviennent la vraie frontière** dès qu'un rôle non propriétaire lit la base **et pose sa portée**. `mip_api` est le premier rôle non propriétaire ; ses policies (`mip_api_lecture`) sont des **lectures seules, `using (true)`** — elles ne tranchent pas encore entre clients : les lectures v1 filtrent par `app_id = any($1)` selon le périmètre du jeton, et ne posent pas `app.current_app_id`. Le faire exige que chaque lecture ouvre sa transaction et y pose la portée. Les chargeurs (C3–C5) ne le font pas (`withTenant` n'a aucun appelant) : `WHERE app_id` reste la règle, dans chaque requête et dans le pipeline de `console-api` ([ADR-0012](0012-roles-de-la-console.md)), et un lint refuse un `update`/`delete … where id = $1` sans `app_id` (`tests/unit/ecritures-par-application.test.ts`, C9).
3. **`scripts/ci/verify-db-roles.mjs`** confronte les droits réels de `mip_api` à sa liste blanche, dans les deux sens (rôle, tables, colonnes, séquences, fonctions à droits de propriétaire, schéma, policies), et au bundle du service : une lecture v1 ajoutée à la console sur une table non accordée échoue en CI. Le contrat de parité fait tourner le service **sous `mip_api`**. Il ne lit que les catalogues : il peut viser la production.
4. **En attendant**, la console se nomme (`application_name = mip-console-vercel`) : elle est lisible dans `pg_stat_activity`. Sa révocation passera par la **rotation du mot de passe de `neondb_owner`** (C12), qui coupe aussi les anciens déploiements Vercel.

## Conséquences

- Tant que la piste C n'est pas faite, une requête de la console qui oublie son `WHERE app_id` n'est arrêtée par rien en base. C'est un défaut connu, pas une couverture.
- Toute table tenant créée après v47 doit poser sa propre policy : la boucle de v47 ne s'est exécutée qu'une fois.
- Non vérifié à ce jour : qu'un rôle créé en SQL se connecte bien par le pooler Neon, et que `neondb_owner` y pose les réglages de rôle (`alter role … set`, PostgreSQL 16+ : il faut l'option ADMIN, que le créateur reçoit). C'est la première chose à répéter sur la branche `repetition-p0`, **avant le déploiement du scheduler qui appliquera v89 en production** (v89 est fusionnée depuis le 24/09, #293) : un échec au pré-déploiement bloquerait tout déploiement du scheduler.
- Les policies `using (true)` de `mip_api` ne s'appliquent qu'à lui (les policies permissives ne se combinent en OU qu'entre celles d'un même rôle). Les gardes « aucune policy `using (true)` sur une table scopée » visent donc les policies de `console_ro` et de `PUBLIC`.

## Écarté

- **Un rôle dédié à la console Vercel dès P0** : impossible à droits égaux (voir le contexte). Remplacé par le nom d'application et la rotation de C12.
- **`console_ro`** (v0.2, policies explicites) pour la console : il lit 80 tables sur 81 et n'en écrit que 22 ; la console écrit ailleurs. Il reste l'outil des tests d'isolation (`pnpm test:isolation`).
