# Backend MIP RUM self-host (souverain, conteneurisé)

Alternative **conteneurisée** au backend serverless de prod (Supabase Edge
Functions + Postgres managé). Objectif : **maîtriser l'infra**, tourner **hors
Cloud Act** (sur ton hébergement / OVH), et disposer de **logs de conteneur**
pour le dogfooding.

```
navigateur / SDK ──(OTLP /v1/traces)──▶  collector (Node)  ──▶  db (Postgres 15)
                                          │ JSON logs stdout
                                          └▶ docker compose logs -f collector
```

C'est **le même code** que la route de collecte de la console : `services/collector/server.mjs`
câble le receveur de `@mip/backend` (`lib/receiver.mjs`) en vrai serveur HTTP
(OTLP → Postgres) avec `/health`, `/ready`, rate-limit, vérif de clé d'API et arrêt
propre. On l'empaquette juste pour tourner en conteneur.

> ✅ **Substance validée sur Postgres réel** (Postgres 16 local, hors Docker) : la
> séquence `schema.sql` + les 28 migrations s'applique proprement (`ON_ERROR_STOP=1`,
> 36 tables, blocs cloud auto-sautés) ; le rôle `console_ro` obtient bien SELECT sur
> 34 tables + 28 policies (parité v16) ; le serveur ingère un payload OTLP réel
> (`200 {"partialSuccess":{}}`, lignes en base, lecture OK sous `console_ro`) et émet
> ses logs JSON sans warn/error. C'est **exactement ce que le conteneur exécute**.
>
> ⚠️ **Seul l'emballage Docker reste à confirmer** (build de l'image + orchestration
> compose : healthchecks, `depends_on`, volumes) — **non exécuté** ici car le daemon
> Docker est indisponible dans l'environnement de dev. Versions **épinglées**
> (`postgres:15`, `node:24-bookworm-slim`, `pg` 8.21.0). Signale-moi toute erreur au premier `up`.

---

## Démarrer

```bash
cd infra/docker
cp .env.example .env          # adapter les mots de passe hors local
docker compose up -d --build
docker compose ps             # db healthy, collector healthy
```

- **Endpoint OTLP** : `http://localhost:4318/v1/traces`
- **Postgres** : `localhost:5433` (user `postgres`, db `mip_rum`)

### Vérifier

```bash
# santé
curl -s http://localhost:4318/health   # {"status":"ok","service":"ingest"}
curl -s http://localhost:4318/ready     # {"status":"ready"} (la base répond)

# envoyer un payload OTLP d'exemple -> attendu {"partialSuccess":{}}
curl -s http://localhost:4318/v1/traces -H 'content-type: application/json' \
  -d @../../tests/fixtures/otlp-sample.json

# le voir en base
docker compose exec db psql -U postgres -d mip_rum \
  -c "select app_id, name, value from rum_metric order by id desc limit 5;"
```

## Les logs (le but de la conteneurisation)

Le serveur émet **une ligne JSON par événement** sur stdout (`{ts,level,service,msg,…}`,
secrets redacted — cf. `shared/log.mjs`). Le driver `json-file` (rotation 10 Mo × 5)
les capture :

```bash
docker compose logs -f collector            # flux structuré (ingested, rate limited, db retry…)
docker compose logs -f collector | jq .     # filtrable/greppable : jq 'select(.level=="error")'
LOG_LEVEL=debug docker compose up -d collector   # plus verbeux
```

C'est le **substrat de logs** requis pour le dogfooding. Les remonter **dans une
page « supervision logs » de la console** est le lot suivant (voir Feuille de route).

## Brancher la console / le SDK dessus

Pointer l'ingestion et la base sur ce backend local au lieu du cloud :

```bash
# SDK / console : endpoint d'ingestion
NEXT_PUBLIC_RUM_ENDPOINT=http://localhost:4318/v1/traces
# console : lecture base via le rôle restreint console_ro
DATABASE_URL=postgres://console_ro:console_ro@localhost:5433/mip_rum
```

## Sécurité

- **`console_ro`** : la console se connecte sous ce rôle restreint (RLS + policies
  `cro_*`), pas `postgres` — parité avec la prod. Créé par `db/initdb.sh` avant les
  migrations pour que les policies gardées de `migration-v16` s'appliquent.
- **`REQUIRE_API_KEY=true`** : rejette (403) tout `app_id` inconnu/sans clé. Défaut
  `false` (fail-open POC) — passer `true` une fois toutes les apps porteuses d'une clé.
- **Mots de passe** : changer `POSTGRES_PASSWORD` et `CONSOLE_RO_PASSWORD` hors local.
- Ingest tourne **non-root** (utilisateur `node`).

## Comment la base est initialisée

`db/initdb.sh` (lancé une fois par l'entrypoint postgres, sur volume vierge) :
1. crée le rôle `console_ro` ;
2. applique `packages/db/sql/schema.sql` ;
3. applique `migration-v02…v28` dans l'ordre.

Les blocs **cloud** (pg_cron, rôles d'API Supabase `anon`/`authenticated`/`service_role`)
s'**auto-sautent** : chaque migration teste `if exists (…)` et journalise « bloc sauté »
sur un Postgres local. `ON_ERROR_STOP=1` → pas de schéma partiel silencieux.

> Rejouer l'init de zéro : `docker compose down -v` (⚠️ supprime les données) puis `up`.

## Rétention (TTL)

`pg_cron` n'est pas présent sur `postgres:15` → la purge automatique est sautée.
C'est le travail quotidien du `scheduler`, qui partage l'image du collecteur ;
pour une passe ponctuelle, sous bail :

```bash
docker compose exec collector node services/scheduler/run-once.mjs daily
```

## Ce que ce lot ne couvre pas (encore)

- **Dockerisation de la console** (Next.js) : elle reste sur Vercel. Conteneuriser
  demande `output: 'standalone'` + un build pnpm multi-stage — lot séparé.
- **Page supervision logs** : voir ci-dessous.

## Feuille de route « supervision logs »

Aujourd'hui les logs sont accessibles en **CLI** (`docker compose logs`). Pour les
afficher **dans la console** :
1. **Collecte** : un OTel Collector (filelog receiver sur les logs json-file, ou
   réception directe) — la brique est prototypée dans `labs/network-logs/`.
2. **Stockage** : table `otel_logs` en Postgres (comme les traces), ou ClickHouse
   au-delà d'un certain volume (l'arbitrage coût est justement l'objet du POC).
3. **Ingestion** : ajouter le signal *logs* OTel (`resourceLogs`) au parser, en
   miroir des traces (`resourceSpans`).
4. **UI** : page « Logs » (filtres sévérité/source/app, timeline, corrélation
   trace↔log) sur les primitives dataviz existantes.

## Nettoyer

```bash
docker compose down       # arrêt (garde les données)
docker compose down -v    # + supprime le volume db-data
```
