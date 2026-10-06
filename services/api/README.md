# `api`

**Rôle.** L'API de lecture v1 pour les machines — partenaires, front tiers, CI, serveur MCP — servie depuis Railway, en lecture seule, sans aucun secret de session.

| | |
|---|---|
| Groupe du canevas | 2 · Restitution |
| Point d'entrée | `node services/api/dist/server.mjs`, construit par `node services/api/build.mjs` depuis `server.mjs` (câblage seul, sur `@mip/service-kit`) |
| Logique | **les routes de la console** (`apps/console/app/api/v1/**/route.ts`, `app/api/rum/summary`) et ce qu'elles lisent (`apps/console/lib/…`), compilées dans le bundle |
| Exposition | public (domaine généré) et privé (le serveur MCP, par le réseau privé Railway) |
| Rôle BDD | **`mip_api`**, lecture seule (migration v89, ADR 0003) : liste blanche de [`packages/db/roles/mip-api.mjs`](../../packages/db/roles/mip-api.mjs), vérifiée en CI contre la base et contre ce bundle (`scripts/ci/verify-db-roles.mjs`) ; pool de 6 par réplique, `application_name = mip-api` |
| Réplicas | 2 (sans état : le débit par principal est compté par réplique) |
| Image | `services/api/Dockerfile` — `dist/server.mjs` et `pg`, rien d'autre |

État au 26/09/2026 : **pas encore créé** sur Railway — déclaré dans `.railway/railway.ts`, il attend ses variables partagées (dont `API_DATABASE_URL`) et un apply approuvé. Le rôle `mip_api` arrive avec migration-v89, pas encore appliquée en production. L'API v1 est servie par la console Vercel ; le relais de la console vers ce service est livré (`apps/console/lib/api-relay.ts`, #292) et éteint : `CONSOLE_API_RELAY_URL` non posée sur Vercel, drapeau `platform_flag.api_relay_pct` à 0 (`apps/console/lib/api-relay.ts`).

## Pourquoi un bundle des routes de la console

Les lectures de l'API v1 vivent dans la console, en TypeScript. Les déplacer dans un paquet est le travail de la piste C. En attendant, `build.mjs` compile ce graphe tel quel avec esbuild, en substituant trois pièces (`shims/`) :

| Module de la console | Remplacé par | Pourquoi |
|---|---|---|
| `next/server`, `next/headers` | `shims/next-server.mjs`, `shims/next-headers.mjs` | `NextRequest`/`NextResponse` sont deux sous-classes minces de `Request`/`Response` ; `after()` s'exécute au tour suivant. Pas de Next dans l'image. |
| `lib/auth.ts` | `shims/auth.mjs` | **aucune session** : l'API publique n'authentifie que par jeton. Un cookie de console n'y vaut rien (401). |
| `lib/db.ts`, `lib/log-forward.ts` | `shims/db.mjs`, `shims/log-forward.mjs` | le pool du kit (délais, `application_name`, drainage) ; le journal du service au lieu d'un renvoi vers l'ingestion. |

**Les gardes du build** (`fautesDuBundle`) : le bundle est refusé s'il contient `apps/console/lib/auth.ts`, `jose`, un vrai module `next/…` ou le secret de session de développement. Le **contrat de parité** (`tests/contract/api-parity.test.ts`) vérifie que les substitutions ne changent rien de ce qu'un client voit : pour une vingtaine de lectures, les refus, le préflight et l'Explorer, même statut, même corps et même ETag que la console, sur la même base.

## Routes

Les chemins sont **ceux de la console**, calculés depuis l'arborescence (`routeur.mjs`) : `/api/v1`, `/api/v1/apps`, `/api/v1/overview`, `/api/v1/errors/{fingerprint}`, … et `/api/rum/summary`. Une route ajoutée à la console existe ici au déploiement suivant. Un segment fixe l'emporte sur un paramètre, comme dans Next.

| Méthode | Servie | Pourquoi |
|---|---|---|
| `GET`, `HEAD`, `OPTIONS` | partout | lecture, préflight CORS |
| `POST /api/v1/explorer/query` | oui | une **lecture** : sa requête porte un AST, qui ne tient pas dans une query string |
| toute autre écriture (triage, commentaires, vues enregistrées, marqueurs de déploiement) | **405** | elles s'authentifient par session et restent à la console jusqu'à `console-api` |

### Les routes servies par ce service seul

Depuis le 30/09/2026, trois routes naissent directement dans l'état que les autres rejoindront à la
décommission de la console (C12) : **`GET /api/v1/trends`** (tendances des cinq Core Web Vitals sur
14 jours complets, rupture datée), **`GET /api/v1/detections`** (épisodes hors de la plage
habituelle) et **`GET /api/v1/errors/{fingerprint}/overrepresentation`** (valeurs de session
sur-représentées parmi les sessions touchées par un groupe d'erreurs). Elles servent le calcul partagé
de la statistique (`packages/stats`, `@mip/stats`) — celui des écrans « Tendances » et Vue d'ensemble.
Le 04/10/2026, quatre autres les rejoignent, les signaux de vue du SDK web ≥ 0.6 lus par l'écran
/pages (`apps/console/lib/queries-engagement.ts`) : **`GET /api/v1/engagement`** (temps passé et
défilement), **`GET /api/v1/spa-loads`** (changements d'écran d'une application monopage),
**`GET /api/v1/page-weight`** (ressources et octets par vue) et **`GET /api/v1/user-timings`**
(repères du développeur). Leurs tables (`rum_metric`, `rum_event`, `rum_session`) étaient déjà dans
la liste blanche de `mip_api`.

- La table `ROUTES_SERVICE_SEUL` (`routeur.mjs`) nomme, pour chaque chemin, l'implémentation que le
  build compile **à la place** du fichier de route de la console (`apps/console/lib/api/service/*.ts`).
  Une entrée de plus est une décision relue.
- Le fichier de route de la console ne fait que **transmettre** la lecture au jeton
  (`apps/console/lib/api/service-seul.ts`) : sans pourcentage, sans drapeau, sans repli local — la
  console n'y gagne aucune lecture de base (cliquet de la console sans base). Une session de la
  console y reçoit `401` ; un service injoignable, `503` avec `Retry-After`.
- La garde du build refuse la transmission dans le bundle : le service se la transmettrait.
- Le rôle `mip_api` lit pour elles `signal_detecte` et `deploy_marker` (migration v106, `AJOUTEES` de
  la liste blanche) ; la sur-représentation ne lit que `rum_session` et `rum_error`, déjà accordées.
- Le contrat de parité fait tourner l'implémentation en propriétaire et le service sous `mip_api`
  (même corps, même ETag), puis vérifie que la transmission de la console rend la réponse du service.

**Toute réponse est signée `x-mip-api: 1`** (en-tête posé par le kit, jusque sur les 404 et 405) : le relais de la console distinguera une réponse du service d'une réponse du routeur Railway, comme pour le collector.

Réponses : l'enveloppe de la console (`{ meta, data }`, ETag faible, `Cache-Control: private, max-age=15`, en-têtes `RateLimit-*`), 401 sans jeton valide, 403 hors périmètre, 400 pour un filtre que la lecture ne sait pas appliquer. Sondes du kit : `/health` (processus + base, **la sonde Railway**), `/live`, `/ready` et `/metrics` sous `METRICS_TOKEN` (`api_requests_total{route,status}`).

## Configuration

`node services/api/dist/server.mjs --print-env-example` écrit le gabarit (après `node services/api/build.mjs`).

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | **oui** (secret) | Postgres, **en `mip_api`** — la variable partagée `API_DATABASE_URL`. Le service fonctionne aussi en propriétaire, mais perd ce qui suit. |
| `CONSOLE_API_TOKENS` | non (secret) | jetons machine, `jeton` ou `jeton@app1;app2` — **la même valeur que la console**. Les jetons en base (écran « Jetons de lecture ») valent aussi. |
| `CONSOLE_API_ALLOWED_ORIGINS` | non | origines CORS, **la même valeur que la console** |
| `CONSOLE_API_RATE_LIMIT` | non | requêtes par minute et par principal, par réplique (défaut 120) |
| `XSOM_AI_URL`, `XSOM_AI_TOKEN` | non | la moitié IA de `/api/rum/summary` (xSOM AI Guard) |
| `CONSOLE_API_RELAY_URL` | **à ne pas poser** | variable de la console, qui désigne ce service ; posée ici, elle le ferait relayer vers lui-même : refus de démarrer |
| `PGPOOL_MAX`, `PORT`, `LOG_LEVEL`, `METRICS_TOKEN`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | non | voir le kit |

## Ce que le rôle `mip_api` interdit, même au code du service

Le service est en lecture seule **par construction** (les écritures répondent 405) ; le rôle l'est **en base**, pour le jour où le code se tromperait :

- aucun INSERT, UPDATE, DELETE, TRUNCATE, sur aucune table ; aucun privilège par défaut, donc aucun droit sur une table créée demain ;
- ni `console_user.email` ni `password_hash`, ni le contenu d'un rejeu (`replay_chunk.body`) ;
- aucune fonction à droits de propriétaire qui écrit — les quatre que `PUBLIC` exécutait lui sont fermées ;
- transaction en lecture seule par défaut, requête bornée à 15 s, 20 connexions.

Ce qu'il **n'**interdit **pas** encore : lire un autre client. Les policies de `mip_api` sont `using (true)` ; le périmètre du jeton est appliqué par les requêtes (`app_id = any($1)`), comme dans la console. Le contrat de parité tourne sous ce rôle : une table oubliée dans la liste blanche s'y voit comme un écart.

## Sûreté multi-réplique

Sans état : chaque requête lit la base. Le débit par principal est compté **par réplique** (deux répliques : jusqu'au double de la limite), comme sur la console où chaque fonction serverless a le sien.

## Coût, sur la base gratuite

Le service ne réveille la base que quand on l'appelle : aucune boucle, et le pool ferme ses connexions inactives après 30 s. Une supervision externe vise `/live`, jamais `/health` (ADR 0014).

## Lancement local

```bash
docker run -d --rm --name mip-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
node services/scheduler/migrate.mjs
node services/api/build.mjs
CONSOLE_API_TOKENS='jeton-local@mon-app' PORT=4323 node services/api/dist/server.mjs &
curl -s -H 'authorization: Bearer jeton-local' 'localhost:4323/api/v1/apps'
```
