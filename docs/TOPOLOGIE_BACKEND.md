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

## Le service `ingest`, en cours de retrait

> **État au 18/09/2026** : le service existe encore et applique toujours les
> migrations. Le `scheduler` a reçu la même commande de pré-déploiement ; elle
> sera prouvée par le premier vrai déploiement qu'il recevra — c'est-à-dire par
> la fusion de cette branche, qui touche `apps/ingest/migrate.mjs` et entre donc
> dans ses chemins surveillés. La suppression n'aura lieu qu'après avoir lu
> « migrations à jour » dans ses journaux, et pas avant.

Il exécute `services/ingest/server.mjs`, un receveur OTLP complet — et **aucun
domaine public ne pointe dessus**. Rien ne peut donc l'atteindre. Son drain de la
file différée est désactivé (`INGEST_DEFERRED` absent de ses variables), et
`ingest_raw` est vide. Son seul rôle réel est de lancer les migrations au
pré-déploiement, rôle repris par `scheduler`.

Il porte par ailleurs `IDENTITY_HASH_SECRET`, `REQUIRE_API_KEY` et
`RATE_LIMIT_PER_MIN` : un secret et deux réglages pour un travail qu'il ne
faisait pas. Un secret qui circule sans servir est un secret de trop.

**Ce que sa suppression ne retirera pas.** Le receveur autonome reste dans le
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
