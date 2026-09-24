# ADR-0009 — Rejeu et source maps restent en Postgres, avec un seuil de sortie

- **Statut** : acceptée
- **Date** : 2026-09-24
- **Portée** : tables `replay_chunk` (`body bytea`, JSON rrweb gzippé) et `sourcemap` (`content text`)

## Contexte

Les deux seuls objets volumineux du produit — les chunks de rejeu (2 Mio au plus chacun) et les source maps de CI (20 Mio au plus par envoi) — sont stockés dans la base. Railway propose des buckets ; ils ne sont joignables que par le réseau public, sans cycle de vie ni sauvegarde.

## Décision

1. **Ils restent en Postgres** : une seule sauvegarde, une seule restauration, une seule purge de rétention (`purge_rum_tenants`), un seul effacement RGPD (le rejeu d'un sujet effacé part avec ses sessions, sous la même barrière).
2. **Un port `BlobStore`** sera introduit le jour où l'on sort, pour que le code d'écriture et de lecture ne dépende pas du support.
3. **Le seuil de sortie** : quand le rejeu et les source maps dépassent la moitié du stockage de la base, ou 5 Go, on sort vers un stockage objet en UE avec cycle de vie (S3-compatible). La mesure entre au relevé de production (`scripts/ops/releve-p0.mjs`, taille par table).

## Conséquences

- **Sur l'offre gratuite de Neon, le seuil est proche** : 0,5 Go au total, 307 Mio occupés sur 512 le 24/09/2026 (60 %). Le rejeu est ce qui remplirait le stockage le premier ([ADR-0014](0014-base-gratuite.md)).
- Une lecture de rejeu passe par la base ; la décompression est bornée (32 Mio) sur les trois sites qui décompressent.

## Écarté

- **Les buckets Railway** : réseau public uniquement, ni cycle de vie ni sauvegarde.
- **Sortir dès maintenant** : un second support à sauvegarder, purger et effacer, pour un volume qui tient encore dans la base.
