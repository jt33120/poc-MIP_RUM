# Les services backend

Une règle : **ces fichiers câblent, ils n'implémentent pas.**

Toute la logique vit dans les noyaux `apps/*` — parser OTLP, écritures Postgres,
authentification, travaux planifiés, migrations, catalogue d'outils MCP. Aucun
framework, donc rien à réécrire pour déplacer l'ensemble chez un autre
hébergeur.

```
apps/console     le front  (Next.js, Vercel)   ← consomme, ne décide pas
apps/ingest      LE NOYAU  (sans framework)    ← la matière, réutilisable
apps/mcp         le noyau MCP                  ← client de l'API, sans base
services/*       les points d'entrée           ← minces par construction
```

| Service | Rôle | Écoute | Commande |
|---|---|---|---|
| `ingest` | réception OTLP : traces, logs, replay | oui (`PORT`) | `node services/ingest/server.mjs` |
| `scheduler` | déclenche les travaux planifiés | facultatif | `node services/scheduler/worker.mjs` |
| `mcp` | expose l'API v1 à un agent IA | oui (`PORT`) | `node services/mcp/http.mjs` |
| _(migrations)_ | applique le SQL en attente | non | `node node_modules/ingest/migrate.mjs` |

`ingest`, `scheduler` et les migrations partagent **une seule image**
(`infra/docker/Dockerfile.backend`) : même noyau, mêmes dépendances, seule la
commande change.

`mcp` a **la sienne** (`infra/docker/Dockerfile.mcp`), et ce n'est pas une
entorse à la règle précédente mais son application : ni le même noyau, ni les
mêmes dépendances — et surtout, **il ne doit pas pouvoir atteindre la base**.
C'est le seul service pilotable par un modèle de langage, donc par le texte que
ce modèle a lu ; la seule protection qui tienne contre une injection de prompt
réussie, c'est qu'il n'y ait rien à atteindre. Pas de `pg`, pas de
`DATABASE_URL` : tout passe par l'API v1, qui applique déjà le cloisonnement par
jeton. Cf. `docs/MCP.md`.

## Pourquoi le scheduler existe

La cadence des travaux n'était pas un choix technique mais la conséquence de
trois plans tarifaires empilés :

| Déclencheur | Pourquoi il ne convenait pas |
|---|---|
| `pg_cron` | l'extension ne s'installe que dans la base `postgres` du projet Neon, jamais dans `neondb` — les blocs `cron.schedule` des migrations sont silencieusement sautés |
| `pg_net` | refusé sur Neon : la livraison des webhooks devait sortir de la base |
| Vercel Cron | plan Hobby = crons **quotidiens uniquement** ; déclarer `*/5 * * * *` fait échouer le déploiement |
| GitHub Actions | facturé à la minute entamée sur un dépôt privé : à `*/5`, le quota mensuel partait en une semaine et emportait la CI |

D'où la cadence rabaissée à une heure, et la ligne « Latence d'alerte : 5 min
visées, 60 réelles » de la page de présentation. Un processus qui tourne en
continu n'a aucune de ces limites.

## Configuration

| Variable | Service | Obligatoire | Rôle |
|---|---|---|---|
| `DATABASE_URL` | `ingest`, `scheduler` | **oui** | Postgres. TLS vérifié dès que l'hôte n'est pas local — jamais de `rejectUnauthorized: false`. |
| `PORT` | `ingest` | fourni par l'hébergeur | port d'écoute (défaut local : 4318) |
| `PORT` | `scheduler` | facultatif | expose `/health` et `/status` ; sans lui, le worker n'écoute rien |
| `REQUIRE_API_KEY` | `ingest` | non | `true` = rejeter toute app inconnue ou sans clé |
| `RATE_LIMIT_PER_MIN` | `ingest` | non | défaut 600, par app |
| `PGPOOL_MAX` | `ingest`, `scheduler` | non | taille du pool (défauts : 8 et 4) |
| `LOG_LEVEL` | `ingest`, `scheduler` | non | défaut `info` |
| `MIP_CONSOLE_URL` | `mcp` | **oui** | origine de la console dont il consomme l'API v1 |
| `MCP_PATH` | `mcp` | non | chemin du point MCP (défaut `/mcp`) |

`mcp` ne prend **pas** `DATABASE_URL` ni de jeton d'API : il relaie celui de
l'appelant, et n'a donc aucun secret à stocker.

## Vérifier en local

```bash
# la base de dev
cd infra/docker && docker compose up -d db

# le schéma, puis ce qui manque
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum \
  node apps/ingest/migrate.mjs

# les services
DATABASE_URL=... PORT=4318 node services/ingest/server.mjs
DATABASE_URL=... PORT=4320 node services/scheduler/worker.mjs

# le serveur MCP : pas de base, mais l'origine de la console
MIP_CONSOLE_URL=http://localhost:3000 PORT=4322 node services/mcp/http.mjs
```

`GET /health` répond dès que le process vit ; `GET /ready` seulement quand la
base répond. Les deux sont distincts à dessein : redémarrer un service dont
seule la base est absente n'arrange rien. `mcp` n'expose que `/health` — n'ayant
aucune dépendance à chaud, vivant et prêt y sont la même chose.
