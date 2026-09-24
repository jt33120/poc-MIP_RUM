# ADR-0003 — Rôles de base et cloisonnement des applications

- **Statut** : acceptée ; mise en œuvre par étapes (P4, C13)
- **Date** : 2026-09-24
- **Portée** : Neon, tous les services qui se connectent à la base

## Contexte

Tout ce qui parle à la base aujourd'hui — la console Vercel, le scheduler, un poste de développement — se connecte en `neondb_owner`, propriétaire et `BYPASSRLS`. Le cloisonnement entre applications (les « tenants ») repose donc sur deux choses : un `WHERE app_id = …` dans chaque requête, et les policies `tenant_scope` de la migration v47, qui lisent la portée dans la GUC `app.current_app_id` (posée en `set_config(…, true)` par `withTenant`, jamais en `SET` de session : le pooler Neon en mode transaction la perdrait ou la laisserait au voisin). Avec un rôle `BYPASSRLS`, ces policies sont posées mais **inertes**.

Deux essais du 23/09/2026 sur la branche Neon `repetition-p0` bornent ce qu'on peut faire :

- un rôle **créé par l'API Neon** est membre de `neon_superuser` (BYPASSRLS, lecture et écriture de tout) : l'inverse du moindre privilège, et il n'exécute pourtant aucune des 21 fonctions dont `EXECUTE` est retiré à `PUBLIC` ;
- `GRANT neondb_owner TO …` est refusé : sous PostgreSQL 17, le propriétaire n'a plus l'option ADMIN sur son propre rôle.

## Décision

1. **Un rôle par surface, créé en SQL par `neondb_owner`** (qui reçoit alors l'option ADMIN sur eux), jamais par l'API Neon :
   - `mip_api` (migration v89, P4) : `NOLOGIN` puis mot de passe posé une fois par un opérateur, liste blanche de tables et de vues tirée du métafichier de build, `default_transaction_read_only`, `statement_timeout` de 15 s, `EXECUTE` explicite sur les fonctions de lecture ;
   - `mip_console` et `mip_identity` (v91, C13) : la console lit la télémétrie et écrit le plan de contrôle ; seul `mip_identity` touche aux comptes, aux sessions et au débit d'authentification ; `audit_log` en insertion seule.
2. **Les policies deviennent la vraie frontière** dès qu'un rôle non propriétaire lit la base. D'ici là, `WHERE app_id` reste la règle, et un lint CI refusera un `update`/`delete … where id = $1` sans `app_id` (C8).
3. **Une garde CI échouera** si une migration retire `EXECUTE` à `PUBLIC` sans l'accorder au rôle qui en a besoin, et `scripts/ci/verify-db-roles.mjs` vérifiera que les droits accordés sont exactement la liste blanche (P4, avec `mip_api`).
4. **En attendant**, la console se nomme (`application_name = mip-console-vercel`) : elle est lisible dans `pg_stat_activity`. Sa révocation passera par la **rotation du mot de passe de `neondb_owner`** (C12), qui coupe aussi les anciens déploiements Vercel.

## Conséquences

- Tant que la piste C n'est pas faite, une requête de la console qui oublie son `WHERE app_id` n'est arrêtée par rien en base. C'est un défaut connu, pas une couverture.
- Toute table tenant créée après v47 doit poser sa propre policy : la boucle de v47 ne s'est exécutée qu'une fois.
- Non vérifié à ce jour : qu'un rôle créé en SQL se connecte bien par le pooler Neon. C'est la première chose à répéter sur la branche avant v89.

## Écarté

- **Un rôle dédié à la console Vercel dès P0** : impossible à droits égaux (voir le contexte). Remplacé par le nom d'application et la rotation de C12.
- **`console_ro`** (v0.2, policies explicites) pour la console : il lit 80 tables sur 81 et n'en écrit que 22 ; la console écrit ailleurs. Il reste l'outil des tests d'isolation (`pnpm test:isolation`).
