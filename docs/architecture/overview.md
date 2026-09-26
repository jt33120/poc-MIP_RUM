# Architecture du backend MIP RUM

> **Cible, et état au 26/09/2026.** Ce document dit où va le backend et où il en est, service par service. Ce qui tourne réellement en production, relevé par les API des hébergeurs, reste dans [docs/TOPOLOGIE_BACKEND.md](../TOPOLOGIE_BACKEND.md). Les trajets d'une mesure et d'une alerte sont dans [data-flow.md](data-flow.md), les décisions dans [adr/](adr/README.md), l'exploitation dans le [runbook](../operations/runbook.md).

## En une phrase

**Vercel sert l'interface, Neon stocke, Railway fait tout le reste** : collecter, traiter, livrer, et servir l'API aux machines. À la fin de la piste C (jalon M4), la console Vercel n'a plus ni accès à la base ni secret d'identité ; elle appelle `console-api`.

## État au 26/09/2026

**En service en production.**
- La console Next.js sur Vercel (`mip-rum-console.vercel.app`, `fra1`) : l'interface, avec un accès direct à Neon ; elle reçoit aussi la collecte (`/api/ingest/v1/{traces,logs,replay}`, `/api/sourcemaps`) et sert l'API v1 (`/api/v1/*`).
- Sur Railway (projet `mip-rum-backend`, Amsterdam), deux services seulement : `scheduler` (le déploiement en service date du 23/09 ; les suivants échouent au pré-déploiement tant que la base est suspendue) et `mcp`.
- Neon, offre gratuite : quota de calcul dépassé le 24/09, calcul **suspendu jusqu'au 01/10/2026**. Tout ce qui lit ou écrit la base est à l'arrêt jusque-là ([ADR-0014](adr/0014-base-gratuite.md)). Migrations appliquées : jusqu'à v86.

**Livré dans le code (`master`), inerte.**
- `.railway/railway.ts` déclare six services ; `collector`, `api`, `console-api` et `notifier` n'existent pas encore sur Railway : ils attendent les variables partagées, puis l'apply approuvé.
- Les migrations v87 à v93 (`platform_flag`, livraison P5, rôle `mip_api`, sessions de la console, SSO par émetteur et sujet, privilège `deploys:write`, rôles `mip_console` et `mip_identity`) : le prochain déploiement réussi du scheduler les appliquera.
- Les relais de la console (collecte → `collector`, lectures au jeton → `api`), la bascule vers `console-api` et la connexion par `console-api` (C1) : éteints tant que leurs variables Vercel ne sont pas posées et que leurs drapeaux valent 0.

**Reste à faire.** Les gestes de l'opérateur (variables partagées, apply, variables Vercel, textes de conformité de la PR #296) ; le 01/10, répéter v87 → v93 sur la branche Neon `repetition-p0`, puis redéployer le scheduler ([runbook](../operations/runbook.md), § 5) ; la montée des drapeaux, puis les modes stricts ; C12 (retirer la base de la console), C12b (image de la console, pile auto-hébergée), P6b.G (collecte directe, pour le GeoIP) ; les exercices sur staging ([présentation](../operations/presentation-dsi.md), § 2).

## Contexte (C4, niveau 1)

```mermaid
flowchart LR
  visiteur["Visiteur d'un site client<br/>SDK web, extension, mobile"]
  ci["CI du client<br/>source maps"]
  operateur["Opérateur<br/>console web"]
  machine["Partenaire, front tiers,<br/>agent IA (MCP)"]
  destinataire["Destinataires d'alertes<br/>webhook, Slack, e-mail, tickets"]
  mip(["MIP RUM"])
  visiteur -->|"mesures OTLP/HTTP JSON"| mip
  ci -->|"source maps (jeton dédié)"| mip
  operateur -->|"écrans, réglages"| mip
  machine -->|"API de lecture v1, jeton"| mip
  mip -->|"alertes signées"| destinataire
```

## Conteneurs (C4, niveau 2) — la cible

```mermaid
flowchart LR
  subgraph capteurs["Capteurs"]
    sdk["SDK web / extension MV3<br/>SDK mobile, agent Node"]
    cic["CI client"]
  end
  subgraph vercel["Vercel — fra1"]
    console["console<br/>interface Next.js"]
  end
  subgraph railway["Railway — europe-west4 (Amsterdam)"]
    subgraph g1["1 · Collecte"]
      collector["collector"]
    end
    subgraph g2["2 · Restitution"]
      api["api"]
      capi["console-api"]
      mcp["mcp"]
    end
    subgraph g3["3 · Traitements"]
      scheduler["scheduler<br/>+ seul migrateur"]
      notifier["notifier"]
    end
  end
  neon[("Neon PostgreSQL 17<br/>aws-eu-central-1 (Francfort)")]
  sdk -->|"OTLP"| console
  console -.->|"relais P3<br/>corps intact, pays seul"| collector
  cic --> collector
  collector --> neon
  console -->|"appels serveur (C0 →)"| capi
  capi --> neon
  api -->|"lecture seule"| neon
  mcp -->|"réseau privé"| api
  scheduler --> neon
  notifier --> neon
  notifier -->|"webhooks, Resend, tickets"| dehors(["destinataires"])
```

Le vocabulaire du canevas Railway suit le trajet de la donnée : **Capteurs → Collecte → Restitution → Traitements**. Un groupe n'est qu'un cadre sur le canevas ; il ne change ni le réseau, ni les variables, ni le déploiement (`.railway/railway.ts`).

## Les services, et où ils en sont

| Service | Groupe | Rôle en une phrase | Exposition | État au 26/09/2026 |
|---|---|---|---|---|
| `collector` | 1 · Collecte | Point d'entrée de tout ce que poussent les capteurs : traces et logs OTLP, rejeu, source maps de CI. Hache l'identité, écrit sous la barrière d'effacement. [README](../../services/collector/README.md) | public, domaine généré | code (P2) et IaC (#284) fusionnés ; **non créé** sur Railway |
| `api` | 2 · Restitution | Contrat de lecture versionné (OpenAPI) pour les machines ; rôle base en lecture seule. [README](../../services/api/README.md) | public + privé | code (P4, #291), relais (#292), rôle `mip_api` (v89, #293) et IaC (#295) fusionnés ; **non créé** : l'API v1 est servie par la console |
| `console-api` | 2 · Restitution | Backend de la console : identité, sessions, écrans, écritures, administration, RGPD. Seul client : le serveur Vercel. [README](../../services/console-api/README.md), [piste C](console-api/README.md) | public, garde par secret client | code fusionné (C0 → C13) et bascule fusionnée inerte (#325) ; **non créé** ; cliquet : 50 écrans sur 57 atteignent encore la base ([inventaire](console-api/inventaire.md)) |
| `mcp` | 2 · Restitution | Passerelle MCP pour agents IA ; relaie le jeton de l'appelant, **aucun accès à la base**. [README](../../services/README.md) | public, domaine généré | **déployé** ; appelle l'API v1 de la console (`MIP_CONSOLE_URL`) tant que `api` n'existe pas |
| `scheduler` | 3 · Traitements | Travaux planifiés sous bail (alertes, SLO, uptime, agrégats, purge, comptage) ; **seul migrateur**, au pré-déploiement. [README](../../services/scheduler/README.md) | privé | **déployé** (déploiement du 23/09, migrations jusqu'à v86) ; les déploiements suivants échouent au pré-déploiement tant que la base est suspendue (quota, jusqu'au 01/10) |
| `notifier` | 3 · Traitements | Livre ce que la plateforme a décidé de dire : webhooks signés, e-mails Resend, tickets. Seul détenteur des secrets sortants. [README](../../services/notifier/README.md) | privé | code (P5, #287) et IaC (#284) fusionnés ; **non créé** : d'ici là, le tick du scheduler livre |
| console | Vercel | Interface Next.js. Jusqu'à M4 elle lit et écrit encore la base directement, et reçoit les mesures (route `/api/ingest/v1/*`). | public | **déployée** ; relais vers le collector et vers `api`, bascule vers `console-api` : livrés, éteints (la table `platform_flag`, v87, n'est pas encore en production) |

## Principes, et la décision qui les porte

1. **Vercel = interface.** À M4, ni `DATABASE_URL` ni secret d'identité sur Vercel — la garde de build existe (`MIP_CONSOLE_SANS_BASE=1`, `apps/console/next.config.mjs`, inerte tant qu'on ne la pose pas), et `scripts/ci/console-sans-base.mjs --strict` refusera tout import de la base (C12). D'ici là, chaque lot en retire un : le relais e-mail et ses clés sont partis en P5 ; `IDENTITY_HASH_SECRET` y est vide (relevé du 23/09) et le restera, le secret neuf ne vit que sur Railway.
2. **Un service = un dossier, une image, un README au même gabarit.** Le point d'entrée ne fait que câbler ; la logique vit dans `packages/*` ; le processus (configuration refusée en bloc, sondes, arrêt propre, pool, boucles) dans `@mip/service-kit`. [services/README.md](../../services/README.md)
3. **Seul le scheduler migre**, en pré-déploiement, schéma compatible N et N+1. [ADR-0004](adr/0004-migrations.md)
4. **L'infrastructure passe par la revue** : `.railway/railway.ts`, plan sur la PR, apply du plan relu dans un environnement GitHub protégé. [ADR-0007](adr/0007-iac-railway.md)
5. **Un seul déclencheur** pour les travaux planifiés, sous bail. [ADR-0008](adr/0008-scheduler-unique.md)
6. **Sûreté multi-réplique écrite noir sur blanc** : bail (scheduler), `for update skip locked` (livraisons, outbox, tickets), verrou consultatif par application (écritures d'ingestion et effacements).
7. **Le MCP n'atteint pas la base**, structurellement. [ADR-0006](adr/0006-mcp-sans-base.md)
8. **La base reste sur l'offre gratuite**, en mode dégradé assumé et affiché. [ADR-0014](adr/0014-base-gratuite.md)

## Qui détient quel secret

La règle : un service ne porte que les secrets dont il se sert. Ceux des nouveaux services viennent de **variables partagées** Railway, créées avant eux (`ctx.shared.X`).

| Secret | Vercel (console) | collector | scheduler | notifier | api / console-api (non créés) |
|---|---|---|---|---|---|
| `DATABASE_URL` (propriétaire) | oui, **jusqu'à C12** | oui | oui (`MIGRATION_DATABASE_URL`, connexion directe des index lourds : lue si posée, non déclarée dans l'IaC) | oui | `api` : rôle `mip_api` (`API_DATABASE_URL`) ; `console-api` : propriétaire, puis `mip_console` + `mip_identity` (C13) |
| `IDENTITY_HASH_SECRET` + empreinte | **jamais** | oui | — | — | `console-api` : lu par les commandes RGPD (C10), **pas encore déclaré** dans son IaC |
| `EDGE_PROXY_SECRET` | à poser pour allumer le relais, tant qu'il existe | oui | — | — | — |
| `RESEND_API_KEY`, `WEBHOOK_SIGNING_SECRET` | **non** (retirés en P5) | — | — | **seul** | — |
| `TICKET_SECRET_KEY`, `TICKET_*` | lus par le crochet entrant des tickets tant que `CONSOLE_TICKET_HOOK_URL` n'est pas posée (C11b) | — | tant que `SCHEDULER_DELIVERY=on` | selon les intégrations | — |
| `METRICS_TOKEN` | — | oui | lu, **non déclaré** dans l'IaC | oui | oui |
| `DEADMAN_URL` | — | — | lu, **non déclaré** dans l'IaC | — | — |
| `AUTH_SECRET`, `OIDC_*` | oui, jusqu'au mode strict de la bascule (les sessions HS256 cessent avec `AUTH_SECRET`) | — | — | — | `console-api` : `OIDC_*` seuls (C1c), **pas encore déclarés** dans son IaC |
| `CONSOLE_API_CLIENT_SECRETS`, `SESSION_SIGNING_KEYS` | une valeur du secret client (`CONSOLE_API_CLIENT_SECRET`) et la clé **publique** seule (`SESSION_PUBLIC_JWKS`, non secrète) | — | — | — | `console-api` **seul** (le trousseau privé ne quitte pas le service) |

## Réseau et régions

- **Trois régions, trois sociétés de droit américain** : Vercel `fra1` (Francfort), Railway `europe-west4` (Amsterdam), Neon `aws-eu-central-1` (Francfort). La donnée reste en UE ; ce n'est pas de la souveraineté ([docs/CONFORMITE.md](../CONFORMITE.md)).
- **Réseau privé Railway** entre services (`*.railway.internal`, IPv6) : `mcp → api` (dès que `api` existe), sondes internes. `safe-fetch` interdit à toute sortie « pour le compte d'un utilisateur » (sondes uptime, webhooks) d'y entrer.
- **Domaines générés** seulement (`*.up.railway.app`, `mip-rum-console.vercel.app`). Un service recréé change d'URL : l'IaC refuse toute destruction sans label `allow-destroy`.
- Latences de référence : Vercel `fra1` → Railway Amsterdam → Neon Francfort, ~8 à 10 ms par aller-retour vers la base (fourchette du plan, reproduite en local ; jamais mesurée entre Railway et Neon) ; c'est ce qui borne le débit d'écriture par application ([banc du 24/09](../operations/banc-collecteur-2026-09-24.md)).

## Ce que le découpage coûte, dit tel quel

- **La base gratuite** : cadences ralenties à 15 min, alertes jusqu'à 15 min après leur cause, 0,5 Go de stockage. [ADR-0014](adr/0014-base-gratuite.md)
- **Le débit d'écriture par application** : ~0,58 lot/s de pic admissible à 10 ms d'aller-retour (15 allers-retours sous le verrou d'application). Une fonction SQL en un aller-retour est obligatoire avant qu'un client dépasse quelques visiteurs simultanés.
- **Une dépendance de plus à la disponibilité** : après la piste C, la console dépend de Vercel, de Railway (une région) et de Neon. Parades : deux répliques, drainage, supervision externe sur `/live`, dead-man's switch du scheduler (`DEADMAN_URL`, lu par le service mais pas encore déclaré dans l'IaC).
