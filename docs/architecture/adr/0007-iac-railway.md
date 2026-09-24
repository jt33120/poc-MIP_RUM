# ADR-0007 — L'infrastructure Railway est du code, relu comme du code

- **Statut** : acceptée, en place depuis P1
- **Date** : 2026-09-24
- **Portée** : `.railway/railway.ts`, `.github/workflows/railway-config.yml`

## Contexte

La configuration des services n'existait que dans le tableau de bord Railway : chemin du Dockerfile, chemins surveillés, commande de pré-déploiement, sonde. Une commande de démarrage perdue suffisait à faire booter au `scheduler` le receveur OTLP, CMD par défaut de l'ancienne image commune. Config as Code (`railway.json`) est déprécié, coupure au 01/12/2026.

## Décision

1. **`.railway/railway.ts` décrit tout** : services, groupes du canevas, Dockerfile par service, chemins surveillés, sondes, réplicas, drainage, variables.
2. **Omettre, c'est supprimer** : `apply` réconcilie. Toute variable vivante est déclarée — `preserve()` pour un secret d'un service existant, `ctx.shared.X` (variable partagée créée avant) pour un service nouveau. **Jamais** `--include-variables` : aucun secret dans le dépôt, un journal ou un artefact.
3. **Plan sur la PR, apply du plan relu** : le job `plan` commente la PR et épingle le plan ; la fusion sur `master` applique **ce** plan, dans l'environnement GitHub protégé `railway-production` (relecteur requis). Si l'environnement a dérivé entre-temps, l'apply échoue au lieu d'appliquer un écart non relu.
4. **Aucune destruction sans décision humaine** : le plan échoue sur toute suppression sauf label `allow-destroy` sur la PR, et l'apply ne passe `--confirm-destructive` que si ce label était posé.
5. Action et CLI **épinglées** (SHA, version) ; CODEOWNERS sur `.railway/` et `.github/`.

## Conséquences

- **Un apply redéploie** les services modifiés (constaté le 24/09/2026).
- Les domaines générés ne sont pas gérés par l'IaC : un service recréé change d'URL.
- Le plan **ne vérifie pas** qu'une variable partagée référencée existe : l'ordre « variables partagées → apply » est une consigne d'exploitation, écrite en tête du fichier.
- Deux applies en attente pour des plans identiques : approuver le premier, rejeter le second (sinon il bloque la file `railway-apply-production`).

## Écarté

- **`railway config apply` depuis un poste** : ce qui change en production ne serait relu par personne, ni rattaché à un commit.
