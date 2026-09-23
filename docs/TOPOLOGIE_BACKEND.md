# Topologie du backend en production

Ce que chaque service exécute réellement, et pourquoi il existe. Un service dont
on ne sait pas dire le rôle en une phrase est un service qu'on finit par croire
utile — c'est ce qui est arrivé à `ingest`, décrit plus bas.

## Les deux hébergeurs

| Hébergeur | Ce qu'il porte |
|---|---|
| **Vercel** | La console Next.js, **et le collecteur d'ingestion réellement actif** : `POST /api/ingest/v1/{traces,logs,replay,sourcemaps}`. C'est l'adresse que visent les SDK. |
| **Railway** (projet `mip-rum-backend`) | Ce qui ne tient pas dans une fonction serverless : une boucle de travaux qui doit tourner en continu, et le serveur MCP. |

La console **écrit** donc en base autant qu'elle la lit. Ce n'est pas un accident
de conception : une fonction serverless au plus près du navigateur reçoit les
beacons avec la latence la plus basse, et le parseur est le même des deux côtés
(`apps/ingest/lib/receiver.mjs`, `_shared/otlp.mjs`) — il n'existe pas deux
implémentations à tenir alignées.

## Les services Railway

| Service | Rôle, en une phrase | Domaine public |
|---|---|---|
| `scheduler` | Applique les migrations au pré-déploiement, puis fait tourner la boucle de travaux : alertes, SLO, sondes de disponibilité, envoi des notifications et des tickets, rafraîchissement des agrégats. | non — il n'a rien à exposer |
| `mcp` | Sert le protocole MCP en HTTP. C'est un client mince au-dessus de `/api/v1` de la console : il ne touche pas la base. | oui |

### Pourquoi le scheduler porte les migrations

Parce qu'il est le service dont la disparition se verrait immédiatement. Les
migrations doivent s'appliquer **avant** que le code qui en dépend ne serve du
trafic ; les confier à un service qu'on peut oublier, c'est accepter qu'elles
cessent un jour de s'appliquer en silence. C'est exactement ce qui menaçait quand
elles vivaient dans le pré-déploiement d'`ingest`.

Le contrat de déploiement reste celui qui est écrit partout ailleurs : **Vercel
déploie avant que Railway n'ait migré**. Les écritures détectent les colonnes
présentes (`colonnesDe`, cache de 60 s) et les lectures sondent
`information_schema` — une version applicative tourne donc correctement sur le
schéma d'avant **et** d'après sa propre migration.

> **`MIGRATE_BASELINE`.** Cette variable marque un lot de migrations comme déjà
> appliquées sans les exécuter. Elle n'agit que sur une base dont
> `schema_migration` est **vide** — ce n'est pas le cas de la production, dont le
> registre est complet. Elle n'a pas été reportée sur `scheduler` lors de la
> reprise du rôle. Si la base était un jour recréée de zéro, il faudrait la
> reposer avant le premier déploiement.

> **Un `redeploy` ne rejoue pas le pré-déploiement.** Vérifié le 18/09/2026 en
> plaçant volontairement dans cette commande un `process.exit(3)` : le
> redéploiement est quand même passé au vert, et le message de la sonde n'apparaît
> nulle part dans ses journaux. Seul un **vrai** déploiement — déclenché par un
> commit touchant les chemins surveillés du service — exécute cette étape. Un
> redéploiement ne prouve donc rien sur les migrations, et c'est précisément le
> genre de présomption qui laisse une infrastructure sembler saine.

### Ce que `watchPatterns` sépare

Chaque service ne se reconstruit que sur ce qui le concerne :

- `scheduler` : `apps/ingest/**`, `services/scheduler/**`, `infra/docker/Dockerfile.backend` ;
- `mcp` : `apps/mcp/**`, `services/mcp/**`, `infra/docker/Dockerfile.mcp`.

Auparavant les deux services backend surveillaient `services/**` en entier :
déposer une base GeoIP sous `apps/ingest/data/` redéployait le scheduler, et
modifier le serveur MCP redéployait l'ingestion. Un redéploiement inutile n'est
pas gratuit — il remet à zéro des caches chauds et ouvre une fenêtre pendant
laquelle deux versions coexistent.

## Le service `ingest`, supprimé le 21/09/2026

> **État au 19/09/2026.** La preuve est obtenue : la fusion de #214 (commit
> `322c9a7`, 18/09 15:27) a déclenché un vrai déploiement du `scheduler`
> (`03850b30`), et ses journaux portent à 15:29:18 la ligne du runner —
> `migrations à jour` (`total 80, appliquées 0, modifiées 1`). Le scheduler
> applique donc bien les migrations au pré-déploiement.
>
> **Le service `ingest` a été supprimé par l'opérateur le 21/09/2026**, depuis
> le tableau de bord Railway, une fois cette preuve obtenue. Vérifié le même jour
> par l'API Railway : le projet `mip-rum-backend` ne compte plus que `mcp` et
> `scheduler`. Ses variables — dont `IDENTITY_HASH_SECRET` — ont disparu avec
> lui ; aucun autre service Railway ne les utilisait.
>
> **« modifiées 1 »** n'est pas une anomalie de P8 : c'est `schema.sql`, dont
> l'empreinte enregistrée à l'étalonnage ne correspond plus au fichier depuis
> le lot du 09/09/2026 (identité du visiteur). Le runner le signale à chaque
> déploiement et ne le rejoue jamais — c'est le comportement voulu. Le faire
> taire demanderait de ré-étalonner cette seule ligne du registre, décision à
> prendre en connaissance de cause, pas un correctif.

Il exécutait `services/ingest/server.mjs`, un receveur OTLP complet — et **aucun
domaine public ne pointait dessus**. Rien ne pouvait donc l'atteindre. Son drain
de la file différée était désactivé (`INGEST_DEFERRED` absent de ses variables),
et `ingest_raw` était vide. Son seul rôle réel était de lancer les migrations au
pré-déploiement, rôle repris par `scheduler`.

Il portait par ailleurs `IDENTITY_HASH_SECRET`, `REQUIRE_API_KEY` et
`RATE_LIMIT_PER_MIN` : un secret et deux réglages pour un travail qu'il ne
faisait pas. Un secret qui circule sans servir est un secret de trop.

**Ce que sa suppression n'a pas retiré.** Le receveur autonome reste dans le
dépôt, construit et démarré par la CI (`docker-smoke`), et documenté pour
l'auto-hébergement dans [infra/docker/](../infra/docker/). Le produit garde donc
son chemin souverain : ce qui disparaît, c'est une copie qui tournait à vide.

**Ce qu'il faudrait pour le faire revenir.** Recréer un service sur
`infra/docker/Dockerfile.backend` avec `node services/ingest/server.mjs`, lui
rendre ses quatre variables, **et lui donner un domaine public** — faute de quoi
on reproduirait exactement la situation qu'on vient de défaire. À ce moment-là,
deux chemins d'ingestion coexisteraient et devraient rester alignés : c'est le
coût réel de cette option, pas le service en lui-même.

## Conséquence pour le GeoIP (P8.7)

La résolution du pays par base locale est embarquée dans l'image backend, pas
dans la console : 15 Mio d'index et 1,1 s de chargement n'ont pas leur place dans
une fonction serverless recréée souvent. Comme le trafic de production entre par
Vercel, **le GeoIP ne résout aucun pays aujourd'hui**. Les sessions gardent leur
pays estimé par fuseau, et `geo_source` reste nul — ce qui est affiché « Inconnue »,
et non « fuseau », pour ne pas affirmer une provenance qu'on n'a pas.

Le rendre effectif demande de choisir : soit un receveur backend public qui
devient le collecteur, soit un moyen de résoudre le pays depuis la console. Aucun
des deux n'a été tranché.

## Relevé du 23/09/2026

Relevé en direct par l'API Railway (lecture seule), après la fusion de la vague 8
(#277, commit `5f809cb`, 23/09 14:07 UTC) :

- projet `mip-rum-backend`, environnement `production` : **deux services**, `mcp`
  et `scheduler` — rien d'autre ; `ingest` reste absent ;
- `mcp` : un domaine généré par Railway, aucun domaine personnalisé ;
  `scheduler` : aucun domaine ;
- la fusion a déclenché un vrai déploiement du `scheduler` (`29833b5b`, SUCCESS à
  14:09) ; ses journaux portent à 14:08:52 `migration appliquée`
  (`migration-v86.sql`, 85 ms) puis `migrations à jour` (`total 81, appliquées 1,
  modifiées 1`). Le `mcp`, dont aucun chemin surveillé n'avait changé, a été sauté.

Le pré-déploiement du `scheduler` applique donc toujours les migrations ; le
« modifiées 1 » est toujours `schema.sql` (voir plus haut). Vercel n'a pas été
relevé ce jour-là.
