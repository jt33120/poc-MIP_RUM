# Les services backend

Trois dossiers, une règle : **ces fichiers câblent, ils n'implémentent pas.**

Toute la logique vit dans le noyau `apps/ingest` — parser OTLP, écritures
Postgres, authentification, travaux planifiés, migrations. Le noyau ne dépend
que de `node:*` et de `pg` : aucun framework, donc rien à réécrire pour le
déplacer chez un autre hébergeur.

```
apps/console     le front  (Next.js, Vercel)   ← consomme, ne décide pas
apps/ingest      LE NOYAU  (sans framework)    ← la matière, réutilisable
services/*       les points d'entrée           ← minces par construction
```

| Service | Rôle | Écoute | Commande |
|---|---|---|---|
| `ingest` | réception OTLP : traces, logs, replay | oui (`PORT`) | `node services/ingest/server.mjs` |
| `scheduler` | déclenche les travaux planifiés | facultatif | `node services/scheduler/worker.mjs` |
| _(migrations)_ | applique le SQL en attente | non | `node node_modules/ingest/migrate.mjs` |

Les trois partagent **une seule image** (`infra/docker/Dockerfile.backend`) :
même noyau, mêmes dépendances, seule la commande change.

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
| `DATABASE_URL` | les deux | **oui** | Postgres. TLS vérifié dès que l'hôte n'est pas local — jamais de `rejectUnauthorized: false`. |
| `PORT` | `ingest` | fourni par l'hébergeur | port d'écoute (défaut local : 4318) |
| `PORT` | `scheduler` | facultatif | expose `/health` et `/status` ; sans lui, le worker n'écoute rien |
| `REQUIRE_API_KEY` | `ingest` | non | `true` = rejeter toute app inconnue ou sans clé |
| `RATE_LIMIT_PER_MIN` | `ingest` | non | défaut 600, par app |
| `PGPOOL_MAX` | les deux | non | taille du pool (défauts : 8 et 4) |
| `LOG_LEVEL` | les deux | non | défaut `info` |

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
```

`GET /health` répond dès que le process vit ; `GET /ready` seulement quand la
base répond. Les deux sont distincts à dessein : redémarrer un service dont
seule la base est absente n'arrange rien.
