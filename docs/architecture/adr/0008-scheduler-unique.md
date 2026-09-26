# ADR-0008 — Un seul déclencheur pour les travaux planifiés, sous bail

- **Statut** : acceptée, en place depuis P0
- **Date** : 2026-09-24
- **Portée** : service `scheduler`, `packages/backend/jobs`

## Contexte

Trois planificateurs empilés, chacun choisi par défaut : `pg_cron` (refusé sur Neon), Vercel Cron (quotidien seulement sur le plan Hobby) et GitHub Actions (facturé à la minute entamée). Les routes `/api/cron/*` ne prenaient aucun bail : aux minutes où deux déclencheurs se croisaient, la même cadence tournait deux fois, et les étapes qui lisent puis insèrent pouvaient produire deux événements d'alerte.

## Décision

1. **Un processus Railway** (`scheduler`) déclenche tout, sur une grille alignée sur l'horloge UTC : `tick` (5 min visées, 15 sur la base gratuite — [ADR-0014](0014-base-gratuite.md)), `horaire` à HH:05, `quotidien` à 03:17.
2. **Un bail par cadence** (`scheduler_lease`, une ligne à expiration) : il traverse le pooler Neon en mode transaction, là où un verrou de session se perdait. Le battement (`expires_at` du bail rendu) n'est écrit que sur **succès** ; la vitrine et `/ready` le lisent.
3. **Délai par étape** (`statement_timeout` posé dans la transaction), somme des délais sous la durée du bail.
4. **Le rejeu manuel prend le même bail** (`services/scheduler/run-once.mjs`) ; les routes `/api/cron/*` ont répondu 410 dès P0, puis ont été retirées (préparation de C12).
5. **La livraison sort du scheduler** (P5) : il décide, le notifier livre (`SCHEDULER_DELIVERY=off`). Écrit dans l'IaC ; au 26/09/2026 le notifier n'est pas créé et le tick livre encore.

## Conséquences

- La latence d'alerte est celle du tick, publiée en base et affichée telle quelle.
- Le bail n'est pas une exclusion stricte (un travail plus long que son bail en laisserait passer un second) : les étapes restent idempotentes.
- Un dead-man's switch externe (`DEADMAN_URL`) signale le silence, ce qu'aucune sonde interne ne voit.

## Écarté

- **Des services cron Railway** : un conteneur démarré à chaque passage, sans état ni battement, et autant de services que de cadences.
- **Le déclenchement depuis la base** (`pg_cron`) : refusé sur Neon.
