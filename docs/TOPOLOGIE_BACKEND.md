# Topologie du backend en production

Ce que chaque hébergeur et chaque service exécutent réellement, et pourquoi ils existent. **État au 28/09/2026** (relevé plus bas). Ce qui tourne mais reste éteint par un drapeau est dit à part, en fin de document. Un service dont
on ne sait pas dire le rôle en une phrase est un service qu'on finit par croire
utile — c'est ce qui est arrivé à `ingest`, décrit plus bas.

## Les trois hébergeurs

| Hébergeur | Ce qu'il porte |
|---|---|
| **Vercel** (projet `mip-rum-console`, région `fra1`) | La console Next.js. Elle **reçoit toujours toute la collecte** — `POST /api/ingest/v1/{traces,logs,replay}` et `POST /api/sourcemaps`, l'adresse que visent les SDK —, en relaie une part au `collector` depuis le 27/09/2026 (`ingest_relay_pct`) et écrit elle-même le reste. Elle sert aussi l'API de lecture `/api/v1/*`, et passe par `console-api` pour la connexion. |
| **Railway** (projet `mip-rum-backend`, région `europe-west4`, Amsterdam) | Six services depuis l'apply du 27/09/2026 (PR #332), en trois groupes : la collecte (`collector`), la restitution (`api`, `console-api`, `mcp`), les traitements (`scheduler`, `notifier`). |
| **Neon** (projet `mip-rum-poc-eu`, `aws-eu-central-1`, Francfort ; PostgreSQL 17) | La base, sur l'offre payante **Launch** depuis le 27/09/2026 au soir : facturation à l'usage, calcul plafonné à 0,25 CU, mise en veille active. Elle était jusque-là sur l'offre gratuite, dont le quota avait coupé le calcul le 24/09 ([ADR-0014](architecture/adr/0014-base-gratuite.md), remplacée). Ce n'est qu'un palier : la base d'un vrai produit se choisira selon ce qu'utilise la DSI de MIP. |

La console **lit et écrit** encore la base directement (`DATABASE_URL`) : pour ses écrans et ses écritures (leur bascule vers `console-api` est à 0), et pour la part de la collecte qu'elle ne relaie pas. Le parseur, le hachage d'identité et l'écriture sont
ceux de `@mip/backend` (`shared/otlp.mjs`, `lib/identity-hash.mjs`, `lib/pg-ingest.mjs`) ; seule la couche HTTP est propre à la console, et un contrat de parité
joué en CI (`tests/contract/ingest-parity.test.ts`) la tient alignée sur le receveur autonome (`packages/backend/lib/receiver.mjs`). C'est un état de transition : le relais de la collecte vers le `collector` ([ADR-0005](architecture/adr/0005-relais-ingestion.md)) est allumé depuis le 27/09 ; la console sans base ([ADR-0002](architecture/adr/0002-console-interface-sans-base.md)) reste à venir.

## Les services Railway en production

| Service | Rôle, en une phrase | Domaine public |
|---|---|---|
| `collector` | Reçoit la part de la collecte que la console lui relaie (corps intact, code pays seul, jamais l'adresse : `apps/console/lib/ingest-relay.ts`), hache l'identité et écrit en base. Deux répliques. Le GeoIP y est éteint (`GEOIP_IP_SOURCE: "none"`, section GeoIP plus bas). | oui, domaine généré par Railway |
| `api` | Sert l'API de lecture v1 sous le rôle `mip_api`, en lecture seule. Deux répliques. Son client aujourd'hui : le `mcp`, par le réseau privé ; le relais des lectures de la console vers lui (`api_relay_pct`) est à 0. | oui, domaine généré par Railway |
| `console-api` | Le backend de la console ([ADR-0010](architecture/adr/0010-console-api.md)) : identité, sessions, écrans, écritures. Deux répliques. Seul client : le serveur Vercel, qui l'appelle pour la connexion depuis le 27/09 ; écrans et écritures ne sont pas encore basculés (drapeaux à 0). | oui, domaine généré par Railway, gardé par un secret client |
| `mcp` | Sert le protocole MCP en HTTP, en client mince de l'API v1 : il passe par le service `api` sur le réseau privé (`MIP_API_HOST`, posé par l'apply du 27/09) et ne touche pas la base ([ADR-0006](architecture/adr/0006-mcp-sans-base.md)). | oui, domaine généré par Railway |
| `scheduler` | Applique les migrations au pré-déploiement — c'est le seul migrateur ([ADR-0004](architecture/adr/0004-migrations.md)) —, puis fait tourner la boucle de travaux toutes les 15 minutes (`SCHEDULER_TICK_MIN`) : alertes, SLO, sondes de disponibilité, rafraîchissement des agrégats, purge de rétention. Il ne livre plus (`SCHEDULER_DELIVERY: "off"`) : c'est le `notifier`. | non — il n'a rien à exposer |
| `notifier` | Livre ce que la plateforme a décidé de dire : webhooks signés, e-mails, tickets. Seul détenteur des secrets sortants ; ses passes suivent le tick de 45 s (`NOTIFIER_INTERVAL_MS: "900000"`). | non |

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
schéma d'avant **et** d'après sa propre migration. Du 24 au 27/09, l'écart a été de sept migrations (production à v86, console écrite jusqu'à v93 : relevé du 26/09) ; le redéploiement du `scheduler` du 27/09 a appliqué v87 → v96 (relevé du 28/09).

> **`MIGRATE_BASELINE`.** Cette variable marque les migrations jusqu'à un fichier donné comme déjà
> appliquées, sans les exécuter : c'est l'étalonnage d'une base dont le schéma existe sans registre.
> Sur une base **vierge** (sans `rum_session`), le migrateur l'ignore et applique tout normalement ;
> sur la production, dont le registre est complet, elle n'inscrirait rien (`on conflict do nothing`,
> `packages/db/migrate.mjs:797-821`). Elle n'a pas été reportée sur `scheduler` lors de la reprise
> du rôle, et une base recréée de zéro n'en aurait pas besoin.

> **Un `redeploy` ne rejoue pas le pré-déploiement.** Vérifié le 18/09/2026 en
> plaçant volontairement dans cette commande un `process.exit(3)` : le
> redéploiement est quand même passé au vert, et le message de la sonde n'apparaît
> nulle part dans ses journaux. Seul un **vrai** déploiement — déclenché par un
> commit touchant les chemins surveillés du service — exécute cette étape. Un
> redéploiement ne prouve donc rien sur les migrations, et c'est précisément le
> genre de présomption qui laisse une infrastructure sembler saine.

### Ce que `watchPatterns` sépare

Chaque service ne se reconstruit que sur ce qui le concerne :

- `scheduler` : la liste `SURVEILLE_SCHEDULER` de `.railway/railway.ts` (noyau, migrations, kit, son dossier, lockfile, et les anciens chemins d'avant le remodelage P1) ;
- `mcp` : la liste `SURVEILLE_MCP` du même fichier ;
- `collector`, `api`, `console-api`, `notifier` : chacun sa liste, dans le même fichier. La source fait foi : ne pas les recopier ici.

Auparavant les deux services backend surveillaient `services/**` en entier :
déposer une base GeoIP sous `packages/backend/data/` redéployait le scheduler, et
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

Il exécutait `services/collector/server.mjs`, un receveur OTLP complet — et **aucun
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
son chemin auto-hébergeable : ce qui disparaît, c'est une copie qui tournait à vide. Il est devenu le service `collector` (plus haut).

**Ce qui l'a fait revenir.** `.railway/railway.ts` déclare un
service `collector` sur `services/collector/Dockerfile` (son `CMD` est `services/collector/server.mjs`), deux
répliques, ses secrets en variables partagées. Créé par l'apply du 27/09/2026, il a un domaine public,
mais le trafic ne l'atteint que par le relais
de la console ([ADR-0005](architecture/adr/0005-relais-ingestion.md)). Deux chemins d'ingestion coexistent donc, et doivent rester
alignés : c'est le rôle du contrat de parité joué en CI (`tests/contract/ingest-parity.test.ts`).

## Conséquence pour le GeoIP (P8.7)

La résolution du pays par base locale est embarquée dans l'image du `collector`, pas
dans la console : 15 Mio d'index et ~1,1 s de chargement (mesures de P8.7) n'ont pas leur place dans
une fonction serverless recréée souvent. Le trafic de production entre par
Vercel, et le relais ne transmet au `collector` que le code pays, jamais l'adresse : **le GeoIP ne résout aucun pays aujourd'hui**, pas même sur la part relayée. La route de la console pose le pays du
fuseau (`geo_source` = `timezone`, depuis `mip.tz`), à défaut l'en-tête pays de Vercel (`cdn`) :
`appliquerGeo`, `packages/backend/shared/geoip.mjs`. Une session reste sans provenance, affichée « Inconnue », quand ni l'un ni l'autre ne donne de pays, et toutes celles d'avant v85 (relevé lu en base le 23/09 : sur 30 jours, 29 sessions sans provenance, 6 par fuseau, 2 par CDN — [releve-p0-2026-09-23.md](operations/releve-p0-2026-09-23.md)).

Le rendre effectif demandait de choisir entre un receveur backend public et une résolution depuis la
console. **C'est tranché depuis le 24/09/2026** ([ADR-0005](architecture/adr/0005-relais-ingestion.md), point 5) : la collecte directe au `collector` pour
les sites sans CSP figée (P6b.G), après le relais. La collecte directe n'est pas faite : le `collector`, en service depuis le 27/09, garde le GeoIP éteint (`GEOIP_IP_SOURCE: "none"`), et le relais ne transmet que le pays de Vercel, jamais l'adresse.

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

## Relevé du 26/09/2026

> **Dépassé depuis le 27/09** (base payante, apply, relais) : voir le relevé du 28/09/2026, plus bas.

Relevé en direct, en lecture seule : CLI Railway (`railway status`, `railway deployment list`,
`railway logs`, `railway config plan`, qui n'applique rien), API Vercel, API publique de GitHub. La
base n'a pas été interrogée : elle est suspendue.

- **Railway**, projet `mip-rum-backend`, environnement `production` : toujours **deux services**,
  `mcp` et `scheduler`. `mcp` a son domaine généré (`mcp-production-201c.up.railway.app`),
  `scheduler` aucun.
- **`scheduler`** : le déploiement en service est `96c03a64`, commit `5d42f0e` (#279), du 23/09 à
  18:35 UTC. Les vingt et un vrais déploiements suivants, du 24/09 à 05:11 UTC au 25/09 à 12:09 UTC,
  ont **tous échoué** ; le journal du dernier (`55dfd112`, commit `054014f`, #323) porte, au
  pré-déploiement, `migrateur arrêté` sur « Your account or project has exceeded the quota » (code
  `53000`, Neon). Les journaux des vingt autres n'ont pas été relus un à un. Un
  pré-déploiement en échec laisse l'ancien déploiement en service : c'est lui qui tourne.
- **Ce déploiement est antérieur au réglage de cadence** (`SCHEDULER_TICK_MIN`, 24/09) : il passe
  toutes les 5 minutes, et chaque passage échoue sur le quota (journaux du 26/09, 06:30 → 06:55
  UTC, `dans_s=300`). Le 01/10, quand le calcul reviendra, il reprendra à 5 minutes tant qu'un
  nouveau déploiement ne l'aura pas remplacé ; le défaut du code de `master` est 15
  (`packages/backend/jobs/cadence.mjs`). Le 01/10 : répéter v87 → v93 sur la branche Neon
  `repetition-p0`, puis redéployer le `scheduler` depuis la source ([runbook](operations/runbook.md), § 5).
- **Migrations** : la production est restée à **v86**, appliquée le 23/09 (relevé ci-dessus). Les
  fichiers v87 → v93 (ajoutés les 24 et 25/09) attendent le prochain déploiement réussi du
  `scheduler`. La base refuse toute connexion depuis le 24/09 à 03:30 UTC ([ADR-0014](architecture/adr/0014-base-gratuite.md)),
  avant le premier de ces déploiements : aucun n'a pu en appliquer une.
- **`mcp`** : déploiement `4d83b43d`, commit `20261eb` (#309), du 25/09 à 05:44 UTC, en service.
  `MIP_API_HOST` n'est pas posée : il appelle l'API v1 de la console (`MIP_CONSOLE_URL`,
  `packages/mcp-tools/lib/client.mjs`).
- **`railway config plan`** : « 7 to add, 6 to change, 0 to destroy ». À créer : les services
  `collector`, `api`, `console-api`, `notifier` et les trois groupes ; à poser : `MIP_API_HOST` et
  `MIP_API_PORT` sur `mcp`, `SCHEDULER_TICK_MIN` et `SCHEDULER_DELIVERY` sur `scheduler`, et le
  groupe des deux. **Ce que `.railway/railway.ts` déclare depuis le 23/09 n'est donc pas appliqué.**
- **Vercel**, projet `mip-rum-console` : production sur `09833f1` (#325), `READY`, le 25/09 à
  14:54 UTC — le code de `master`, face à une base à v86 et suspendue.
- **CI de `master`** à `09833f1` : passage `36150584632`, vert (typage de la console, des SDK, de
  l'agent Node et de l'extension ; construction depuis un dépôt propre ; E2E ; bancs de mesure) ;
  « Docker smoke » vert.

## Relevé du 28/09/2026

Relevé en lecture seule par l'API Railway (état de l'environnement `production`, le 28/09/2026) ; les
faits de la base, de Vercel et des drapeaux ont été constatés par l'exploitation les 27 et 28/09
(journaux des services, console Neon, table `platform_flag`).

- **Railway**, projet `mip-rum-backend`, environnement `production` : **six services en ligne**, aucun
  échec de déploiement sur 24 heures — `collector`, `api` et `console-api` en deux répliques, `mcp`,
  `scheduler` et `notifier` en une. Déploiements en service : le 27/09 vers 20:07 UTC pour `collector`,
  `mcp`, `scheduler` et `notifier` (apply de la PR #332) ; le 28/09 à 06:47 UTC pour `api` et
  `console-api`. Trois groupes sur le canevas : 1 · Collecte, 2 · Restitution, 3 · Traitements.
  Domaines publics générés pour `collector`, `api` et `console-api` ; `mcp` garde le sien.
- **Base** : passée sur l'offre payante Launch de Neon le 27/09 au soir (à l'usage, calcul plafonné à
  0,25 CU, veille active). Le redéploiement du `scheduler` a appliqué **v87 → v96** le même jour. Le
  rôle `mip_api` est ouvert, en lecture seule, vérifié à travers le pooler. Cadences inchangées :
  `SCHEDULER_TICK_MIN=15`, passes du `notifier` à 15 minutes.
- **Vercel** branché sur Railway le 27/09 : la connexion à la console passe par `console-api`
  (`POST /v1/auth/demo-sessions`, `GET /v1/me`, `DELETE /v1/auth/sessions/current` en 200 dans ses
  journaux).
- **Relais de la collecte** (`ingest_relay_pct`) : 10 % à 20:25 UTC le 27/09, 50 % à 20:30 UTC ;
  1 616 envois relayés en 12 heures, aucune erreur. Le passage à 100 % est prévu le 28/09.
- **Encore à 0** : `api_relay_pct`, `console_api_ecrans_pct`, `console_api_commandes_pct`. Le GeoIP
  du `collector` reste éteint (`GEOIP_IP_SOURCE=none`).

## Ce qui tourne, mais reste éteint par un drapeau

Les six services tournent (relevé ci-dessus). Ce qui suit est sur `master` et en production, mais ne
sert pas encore, ou pas en entier, tant que son drapeau `platform_flag` ou sa variable n'est pas levé.
La cible, service par service, est dans [architecture/overview.md](architecture/overview.md).

| Élément | État au 28/09/2026 | Où |
|---|---|---|
| Relais d'ingestion | **Allumé** : la console relaie une part de la collecte au `collector` (`ingest_relay_pct`, 50 % le 27/09 au soir, 100 % prévu le 28/09) ; la part restante et le repli sont écrits par la console. | `apps/console/lib/ingest-relay.ts`, [ADR-0005](architecture/adr/0005-relais-ingestion.md) |
| Relais de l'API v1 | Éteint : `api_relay_pct` à 0 ; les porteurs de jeton lisent par la console. Seul le `mcp` passe par `api`. | `apps/console/lib/api-relay.ts` |
| Bascule vers `console-api` | La connexion passe par `console-api` (`CONSOLE_API_URL` posée sur Vercel) ; écrans et écritures non basculés (`console_api_ecrans_pct` et `console_api_commandes_pct` à 0). Le mode strict (`CONSOLE_API_STRICT`) vient après le rodage à 100 %. | `apps/console/lib/aiguillage-console-api.ts`, [ADR-0010](architecture/adr/0010-console-api.md) |
| Rôles de base | `mip_api` (v89), `mip_console` et `mip_identity` (v93) : appliqués le 27/09 ; `mip_api` sert le service `api`. | `packages/db/sql/`, [runbook](operations/runbook.md) |
| GeoIP | Embarqué dans l'image du `collector`, éteint (`GEOIP_IP_SOURCE: "none"`) jusqu'à la collecte directe (P6b.G). | `.railway/railway.ts`, section GeoIP plus haut |
