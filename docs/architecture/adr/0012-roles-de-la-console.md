# ADR-0012 — Les rôles de la console : `mip_console` et `mip_identity`

- **Statut** : acceptée ; migration v93 (C13) écrite, pas encore appliquée en production ; les rôles n'ont pas de mot de passe
- **Date** : 2026-09-25
- **Portée** : `console-api`, Neon ; complète [ADR-0003](0003-roles-et-tenancy.md)

## Contexte

`console-api` porte deux métiers : l'identité (connexion, sessions) et tout le reste (écrans, écritures, RGPD). En propriétaire, une injection SQL dans un chargeur lirait les hachés de mots de passe, et une commande détournée supprimerait la télémétrie. ADR-0003 a posé la règle des rôles de service (créés en SQL, jamais par l'API Neon ; `NOLOGIN` jusqu'à ce qu'un opérateur pose le mot de passe) et le premier d'entre eux, `mip_api`.

## Décision

1. **`mip_identity`** : `console_user`, `console_session`, `auth_throttle` (lecture et écriture), `audit_log` en insertion seule. Réglages : 10 s par requête, 30 s en transaction inactive, 20 connexions.
2. **`mip_console`** : lecture de la télémétrie et des agrégats nommés par les écrans ; écriture du plan de contrôle (tableaux de bord, vues, objectifs, alertes, SLO, canaux, sondes, jetons, connecteurs, domaines, applications) ; `console_user` **par colonnes** (il écrit un haché — création, réinitialisation — sans jamais le lire) ; révocation des sessions d'un compte (`revoked_at`) sans les lire ; `audit_log` en insertion et lecture. Aucune troncature, aucun privilège par défaut. 40 connexions.
3. **Un écart au plan, assumé** : l'effacement RGPD est exécuté par `console-api`. `mip_console` supprime donc dans les tables de l'effacement (`DSAR_CHILD_TABLES`, `rum_session`, `ingest_raw`) et verrouille les sessions qu'il efface (`for update` exige un droit UPDATE : accordé sur la seule colonne `last_seen_at`, que rien n'écrit). Aucun INSERT ni UPDATE sur la télémétrie ; seule la file des lots, `ingest_raw`, qu'il nettoie, lui est ouverte en SELECT, UPDATE et DELETE (`packages/db/roles/console-api.mjs`).
4. **Des policies `<rôle>_acces`, `using (true)`, pour ce rôle seulement**, sur chaque table accordée sous RLS : ce n'est pas la frontière entre clients (elle est dans le pipeline et dans chaque requête, lint des écritures à l'appui).
5. **Vérifié, pas supposé** : `scripts/ci/verify-db-roles-console.mjs` compare les droits réels aux listes (`packages/db/roles/console-api.mjs`) dans les deux sens, par table et par colonne, et au bundle du service ; la matrice d'autorisations et les tests SQL de l'identité tournent en CI **sous ces rôles**.

## Conséquences

- Le service prend deux chaînes de connexion, ensemble ou aucune (sinon il refuse de démarrer) ; sans elles, le propriétaire, comme avant la mise en service.
- Une table nouvelle nommée par un chargeur ou une commande échoue en CI tant qu'une migration ne l'accorde pas — c'est voulu.
- Non vérifié à ce jour, comme pour `mip_api` : la connexion d'un rôle créé en SQL par le pooler Neon. C'est la première chose à répéter sur `repetition-p0`.

## Écarté

- **Un seul rôle pour le service** : l'identité et les écrans se prêteraient leurs droits.
- **Refuser tout DELETE sur la télémétrie** : l'effacement RGPD ne se ferait plus. La voie propre — une fonction d'effacement à droits de propriétaire, seule à supprimer — est notée pour plus tard.
