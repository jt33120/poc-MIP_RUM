# Relais de collecte : de la console Vercel au collector Railway (P3 → C12)

La console **relaie** au collector Railway tout ce que les capteurs lui envoient encore
(traces, logs, rejeux, source maps par jeton, battements et résolutions de l'extension,
marqueurs de déploiement par jeton de CI). Depuis C12 (06/10/2026), elle **n'écrit plus
rien elle-même** : ni tirage au pourcentage, ni chemin local, ni repli. Collector
injoignable : **503 + `retry-after`**, et le client rejoue.

Code : `apps/console/lib/ingest-relay.ts` (relais) et les routes `app/api/ingest/v1/*`,
`app/api/sourcemaps`, `app/api/extension/{resolve,heartbeat}`, `app/api/v1/deploys`.
Tests : `tests/unit/ingest-relay.test.ts`, `tests/contract/relais-ingestion.test.ts`,
`tests/contract/ingest-parity.test.ts` (le relais est transparent : même réponse, mêmes
lignes qu'un envoi direct au collector).

## État au 06/10/2026 : relais seul (C12)

- Depuis le 06/10/2026, 10:12, la collecte des clients va **en direct** au collector
  (`NEXT_PUBLIC_DIRECT_COLLECTOR_URL` posée sur Vercel ; « Collecte directe des clients »,
  plus bas). La console ne reçoit plus que ce qui la vise encore : codes de suivi anciens,
  domaines de l'extension gardés sur la console, CI.
- Ce qu'elle reçoit, elle le relaie. Le comportement de l'ancien mode strict
  (`CONSOLE_INGEST_RELAY_STRICT=1`, C11) est devenu le seul : la variable n'est plus lue
  et peut être retirée de Vercel.
- Le drapeau `platform_flag.ingest_relay_pct` et la variable `INGEST_RELAY_PCT` ne sont
  plus lus. La ligne reste en base (aucune migration dans C12) ; elle est inerte.
- Ce qui reste écrit par la console, hors collecte : l'envoi de source maps **depuis
  l'écran** (session admin), et le marqueur de déploiement au jeton historique
  `CONSOLE_API_TOKENS` (jusqu'au 31/12/2026, annoncé par `Sunset`).

### Historique : de P3 au relais seul

- 24/09/2026 (#286) : relais fusionné, inerte (variable absente, migration v87 non appliquée).
- 27/09/2026 : collector créé ; drapeau à 10 %, puis 50 %.
- 28/09/2026, 07:10 UTC : drapeau à 100 %. La console écrivait encore elle-même en
  **repli** (erreur de connexion, réponse non signée du routeur, disjoncteur ouvert).
- C11 : `CONSOLE_INGEST_RELAY_STRICT=1` supprimait le repli sans retirer le code.
- 06/10/2026 : collecte directe des clients ouverte, puis **C12** : le chemin d'écriture local
  de la collecte quitte la console (ADR 0005, point 5).

Ce que P2 avait aligné sur le collector (contrat de parité) reste vrai, puisque c'est
désormais le collector qui répond : base injoignable → 503 + `retry-after: 2` ; corps sans
longueur annoncée au-delà de 2 Mo → 413 ; JSON précédé d'une BOM → 400 ; rejeu sans
`x-mip-seq` décimal → 400.

## Configuration

| Variable | Où | Valeur |
|---|---|---|
| `EDGE_PROXY_SECRET` | collector (variable partagée Railway) **et** Vercel | la même valeur, ≥ 32 caractères. Côté Vercel, **une seule** valeur. Le collector en accepte deux pendant une rotation. |
| `CONSOLE_INGEST_RELAY_URL` | Vercel | l'URL du collector, par ex. `https://collector-production-d769.up.railway.app` (sans chemin). **`https:` obligatoire** (`http:` seulement pour `localhost`, `127.0.0.1`, `::1`). |
| `IDENTITY_HASH_SECRET` + `IDENTITY_HASH_FINGERPRINT` | collector seulement | le collector hache l'identité. **Rien sur Vercel.** |

**Sans URL ni secret valides, chaque route de collecte répond 503 + `retry-after`** et
journalise une fois `relay not configured` : rien n'est écrit, nulle part. Relayer sans
secret ferait prendre au collector le trafic pour du trafic direct, et il géolocaliserait
l'adresse de Vercel ; on ne relaie pas.

Avant de transmettre, la console vérifie le collector (`GET /health`, cache 60 s, réussi ou
non) : 200, en-tête `x-mip-collector: 1`, `edge_protocol = "mip-edge/1"`,
`edge_trust = true`. Sinon : 503 + `retry-after` (journal `relay: collector unhealthy`).

```sh
curl -si https://<collector>.up.railway.app/health
# attendu : en-tête "x-mip-collector: 1" ;
#           "service":"collector", "edge_protocol":"mip-edge/1", "edge_trust":true
```

## Ce que fait le relais, requête par requête

- Le corps est lu **une seule fois**, borné. Un corps trop gros est refusé par la console
  (413), sans appel réseau : traces et logs au-delà de 2 Mo, rejeu au-delà de 2 Mio, source
  maps au-delà de 4 Mio (plafond Vercel ; le port direct `/v1/sourcemaps` du collector en
  accepte plus), battement et marqueur au-delà de leur plafond. Tout le reste — clé, débit,
  format, écriture — est jugé par le collector.
- **En-têtes transmis, liste exacte :** `content-type`, `content-encoding`,
  `x-mip-session`, `x-mip-app`, `x-mip-seq`, `x-mip-key` et `origin` (traces, logs, rejeu :
  le collector en tire les en-têtes CORS) ; `content-type`, `content-encoding` et
  `authorization` pour les source maps. S'y ajoutent `x-mip-edge-auth` (le secret),
  `x-mip-edge-country` (le pays de Vercel, s'il vaut `^[A-Z]{2}$`) et, pour traces et logs,
  `x-mip-edge-origin` (l'`Origin` de la page, qui autorise un lot de l'extension sans clé).
- **Jamais d'adresse IP** : ni `x-forwarded-for`, ni `x-real-ip`, ni
  `x-vercel-forwarded-for`, ni `forwarded`. La phrase « aucune adresse IP n'est transmise
  ni stockée » reste vraie.
- La réponse du collector est **reconstruite** : statut, corps et `retry-after` du
  collector ; `content-type: application/json` **imposé** (sauf `application/x-protobuf`
  signé) et `x-content-type-options: nosniff` — un hôte qui répondrait `text/html` ne fait
  pas rendre de HTML sous l'origine de la console, où vit le cookie admin.
- **CORS** : ceux du collector sur ses réponses signées aux navigateurs (traces, logs, rejeu ;
  il lit le registre des origines) ; sur les réponses que la console rend elle-même (413,
  503), le socle statique seulement — la console ne lit plus la base. Le préflight
  `OPTIONS` et le `GET` de diagnostic de ces trois routes sont relayés aussi.
- **Les routes machine** :
  - `GET /api/extension/resolve` → `/v1/extension/resolve` (sa requête transmise, aucun
    en-tête ; `cache-control` du collector rendu ; `endpoint` vide complété par l'adresse
    directe si la collecte directe est ouverte) ;
  - `POST /api/extension/heartbeat` → `/v1/extension/heartbeat` (`content-type` et
    `user-agent`, que le collector inscrit à l'inventaire) ;
  - `POST /api/v1/deploys` → `/v1/deploys`, pour un **jeton de CI** `deploys:write`
    (`content-type`, `authorization`). Un jeton `CONSOLE_API_TOKENS` n'est jamais relayé
    (le collector ne le lit pas) : la console le traite elle-même jusqu'au 31/12/2026.
- **Jamais relayé :** la branche admin des source maps (cookie de session) et leur lecture
  (`GET /api/sourcemaps`) ; le préflight des routes de l'extension (CORS fixe, `*`).
- `NEXT_PUBLIC_RUM_ENDPOINT` n'est pas touché : il alimente aussi `log-forward`.

### Chaîne des délais

**collector 4 s < sonde `/health` 2 s + relais 8 s < fonction 30 s.**

- Le collector a un budget **dur** de 4 s par requête : au-delà, il rend 503, et presque
  toujours **rien n'est commité**. Une exception, irréductible : un COMMIT déjà arrivé au
  serveur dont la réponse se perd en route ; le collector rend 503 `ingestion outcome
  unknown` et journalise `deadline: commit outcome unknown, replay may duplicate`.
- Le relais attend 8 s (`DELAIS.relaisMs`) : le collector répond donc toujours avant, 503
  compris. Au-delà, 503 + `retry-after: 5`.
- Les routes de collecte déclarent `export const maxDuration = 30` : sans ce plafond, le
  défaut du projet Vercel couperait la fonction **avant** le 503 du relais (un 504
  `FUNCTION_INVOCATION_TIMEOUT` sans ligne `relay timeout` au journal).

### Matrice des réponses

Le collector **signe toutes ses réponses** (`x-mip-collector: 1`, posé par le kit, jusque
sur ses 404, 413 et 500). Le routeur Railway ne signe rien.

| Issue du relais | Réponse au client |
|---|---|
| réponse **signée**, quel que soit le statut (2xx, 400, 401, 403, **404 métier**, 409, 413, 425, 429, 500, 503…) | celle du collector |
| 404, 405 **non signés** (service absent, mal routé) | **503 + `retry-after: 5`** |
| 502, 504 **non signés** (routeur Railway) | **503 + `retry-after: 5`** |
| autre statut non signé | rendu tel quel |
| erreur réseau, avant ou après l'envoi | **503 + `retry-after: 5`** |
| délai de 8 s dépassé | **503 + `retry-after: 5`** |
| `/health` en échec (cache 60 s), ou configuration absente | **503 + `retry-after: 5`**, sans envoi |

Dans aucun cas la console n'écrit. Les logs ne sont pas idempotents (`rum_log`, clé
`bigserial`) : un 502/504 du routeur ou une connexion perdue après l'envoi peuvent cacher un
lot déjà écrit, et le rejeu du SDK le doublerait. C'est le même risque qu'en envoi direct au
collector ; l'ancien repli local, lui, l'aggravait.

Le cache de santé tient lieu de disjoncteur : un collector tombé coûte une sonde de 2 s par
minute et par instance Vercel, puis des 503 immédiats.

## Retour arrière

Il n'y a plus de coupe-circuit en base : la collecte ne peut aller qu'au collector.

- Collector en panne : le réparer (runbook) ; en attendant, les SDK gardent leurs lots et les
  rejouent, comme en collecte directe.
- Revenir au code d'avant C12 : Instant Rollback Vercel vers un déploiement antérieur. Ce
  code relit `CONSOLE_INGEST_RELAY_STRICT` : tant qu'elle vaut `1` sur Vercel, il reste en
  relais pur ; la retirer et redéployer rend le repli local (et `ingest_relay_pct` de
  nouveau lu).

## Ce qu'on surveille

**Journaux Vercel** (service `ingest`, JSON) :

| Message | Sens | Réaction |
|---|---|---|
| `relay not configured` | URL absente, invalide ou `http:` hors localhost, ou secret invalide sur Vercel : **toute** la collecte reçue par la console répond 503 | Corriger la variable, redéployer. |
| `relay: collector unhealthy` | `/health` refusé, non conforme ou non signé : 503 pendant 60 s | Vérifier le déploiement du collector et son `EDGE_PROXY_SECRET`. |
| `relay timeout` | 8 s dépassées, 503 rendu au client | Toute occurrence mérite un regard : le collector dépasse son budget. |
| `relay failed` | erreur réseau vers le collector, 503 rendu | Une rafale = collector injoignable. |
| `relay: collector unreachable` | 404, 405, 502 ou 504 du routeur Railway, 503 rendu | Vérifier le routage et les répliques. |

**Journaux du collector** :

- `ingested`, `ingested logs`, `ingested replay` : l'écriture a eu lieu ;
- `en-têtes de bord non authentifiés retirés` : c'est le symptôme d'un `EDGE_PROXY_SECRET`
  désaccordé entre Vercel et Railway.

**Pays et identité** :

```sql
-- Pas de pic DE/NL/US : ce serait un GeoIP sur l'adresse d'un relais.
select geo_country, geo_source, count(*) from rum_session
 where last_seen_at > now() - interval '24 hours' group by 1, 2 order by 3 desc;
```

Depuis le relais pur, toute session est écrite par le collector : l'identité y est hachée.

## Ce qui reste à faire

- **Conformité.** Fait avant la montée (PR #296) : `lib/legal.ts` et `docs/CONFORMITE.md`
  désignent le collector Railway comme celui qui reçoit, hache et écrit les mesures, la
  console comme un relais qui ne garde ni ne transmet l'adresse IP. C12 n'y change rien.
- **Soak** : le relais a porté 100 % du trafic de la console du 28/09 au 06/10/2026.
- **P6b.G — collecte directe pour le GeoIP.** Le relais transmet le pays, jamais l'IP, et
  saute donc la résolution. Dogfooding direct le 28/09/2026, clients le 06/10/2026 (sections
  suivantes). Les apps à CSP figée restent en relais.
- **P6b — exercices sur staging** : panne du collector sous charge, chronométrée.
- **Relais pur (C11)** : fait, puis rendu définitif par C12.
- **C12 — fait le 06/10/2026** : le chemin d'écriture local de la collecte a quitté la console.
  Restent à retirer, sans urgence : la variable `CONSOLE_INGEST_RELAY_STRICT` sur Vercel, la
  ligne `ingest_relay_pct` en base (par une migration), et le chemin historique des marqueurs.

## Collecte directe du dogfooding (P6b.G, premier périmètre, 28/09/2026)

Le capteur de la console elle-même (application `mip-rum-console`), **et lui seul**, peut envoyer
ses traces et ses rejeux du navigateur au collector, sans passer par Vercel :
`https://collector-production-d769.up.railway.app/v1/traces` et `/v1/replay`. Le collector lit
alors l'en-tête `X-Real-IP` que pose la façade Railway et en déduit le pays
(`rum_session.geo_source = 'geoip'`), sans écrire l'adresse. Cette variable ne déplace rien
d'autre : les snippets des clients, l'extension, la CI et `NEXT_PUBLIC_RUM_ENDPOINT` n'en dépendent
pas (la collecte directe des clients a sa propre variable, section suivante).

Code : `apps/console/lib/ingest-endpoint.ts` (`origineCollecteurDogfooding`),
`packages/backend/shared/client-ip.mjs` (`diagnostiquerFacade`), `services/collector/server.mjs`
(`/diagnostic/ip`), `scripts/ops/verifier-ip-directe.mjs`. Tests : `tests/unit/ingest-endpoint.test.ts`,
`tests/unit/client-ip.test.ts`, `tests/unit/verifier-ip-directe.test.ts`.

### Deux interrupteurs, indépendants

| Interrupteur | Où | Effet |
|---|---|---|
| `GEOIP_IP_SOURCE: "railway"` | `.railway/railway.ts` (collector), par l'apply IaC | le collector résout le pays du trafic **direct** ; le trafic relayé ne porte jamais d'adresse et n'est pas concerné |
| `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL` | Vercel, environnement **Production** seulement | le capteur de la console vise le collector. Valeur : `https://collector-production-d769.up.railway.app`, sans chemin (un chemin serait ignoré). Inscrite dans le code au build : la poser ou la retirer demande un **redéploiement** |

Ce que le code refuse, en revenant au chemin par la console (qui marche) : une valeur qui n'est pas
une URL ; `http:` hors `localhost` ; et toute requête dont l'hôte n'est pas l'hôte de production
(`VERCEL_PROJECT_PRODUCTION_URL`). Previews et URL propres d'un déploiement restent donc sur la
console : le CORS du collector n'accepte que les origines enregistrées pour `mip-rum-console`
(`app_registry.allowed_origins`), et leurs envois seraient bloqués en silence.

**CORS, relevé le 28/09/2026** : le préflight `OPTIONS /v1/traces` et `/v1/replay` du collector de
production rend `access-control-allow-origin: https://mip-rum-console.vercel.app` (origine posée
par la migration v05). Rien à écrire en base. Si un jour il ne la rend plus :

```sql
select app_id, active, allowed_origins, ingestion_suspended_at from app_registry where app_id = 'mip-rum-console';
-- seulement si l'origine manque (idempotent ; effet sous 60 s, le cache du registre) :
update app_registry set allowed_origins = array_append(allowed_origins, 'https://mip-rum-console.vercel.app')
 where app_id = 'mip-rum-console' and not ('https://mip-rum-console.vercel.app' = any(allowed_origins));
```

**CSP** : la console n'envoie aucune politique de sécurité du contenu (ni `next.config.mjs`, ni
`vercel.json`, ni le middleware ; en-tête absent en production le 28/09/2026). Rien à élargir.
`tests/unit/ingest-endpoint.test.ts` rougit le jour où une CSP apparaît : son `connect-src` devra
porter l'origine du collector.

### Allumer

1. **Fusionner la PR.** Le collector se redéploie de lui-même (chemins surveillés) et sert
   `/diagnostic/ip`, derrière `METRICS_TOKEN`. Le run « Railway IaC » de la fusion attend son approbation.
2. **Prouver, AVANT d'approuver l'apply**, que la façade Railway écrase une adresse forgée :

   ```sh
   railway variables --service collector --json | jq -r .METRICS_TOKEN \
     | node scripts/ops/verifier-ip-directe.mjs
   ```

   Trois lectures, aucune écriture ; aucune adresse n'est renvoyée. Attendu : code **0**, avec
   `✓ CORS : https://mip-rum-console.vercel.app est acceptée` et `✓ la façade écrase l'adresse forgée`.
   Code **1** (`FORGEABLE`) : **ne pas approuver**, rejeter le run. Code 2 : lire la ligne `✗`.
3. **Approuver le run « Railway IaC » le plus récent** (environnement `railway-production`). Un push
   plus récent sur `master` annule un run en attente : c'est le dernier qui porte tout. L'apply pose
   `GEOIP_IP_SOURCE=railway` et redéploie le collector. Relancer le script : la première ligne doit
   dire `source railway, base actif (dbip-country-lite-AAAA-MM)`. `base eteint` avec
   `geoip_db_absente` : l'image n'a pas téléchargé DB-IP à sa construction (journal de build
   `geoip: base non déposée`) ; rien n'est cassé, aucun pays n'est résolu par adresse.
4. **Vercel** → Settings → Environment Variables : `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL` =
   `https://collector-production-d769.up.railway.app`, environnement **Production** seulement.
5. **Redéployer la production** (Deployments → le dernier déploiement de production → Redeploy).
6. **Vérifier** :
   - `/admin/health`, bloc « Où partent les données » : l'adresse du collector, et « Directement au collecteur » ;
   - dans le navigateur, sur la console : `OPTIONS` puis `POST …/v1/traces` vers le collector, en 204 puis 200 ;
   - journaux du collector : `ingested` pendant la navigation, aucun `rejected: api key` ;
   - en base, après quelques minutes de navigation :

     ```sql
     select geo_source, geo_country, count(*) from rum_session
      where app_id = 'mip-rum-console' and last_seen_at > now() - interval '1 hour'
      group by 1, 2 order by 3 desc;
     ```

     `geoip` apparaît pour les **nouvelles** sessions ; une session déjà écrite garde sa première
     provenance (`on conflict`). Pour dater le changement sur les écrans :
     `insert into deploy_marker (app_id, version, env, source) values ('mip-rum-console', 'collecte-directe', 'prod', 'manual');`

### Couper

1. **Retirer `NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL`** sur Vercel, puis redéployer la production — ou,
   plus vite, Instant Rollback vers le déploiement d'avant la variable : son build ne la porte pas.
   Le capteur revient sur `/api/ingest/v1/*` et le relais. Une page déjà ouverte garde l'ancien
   endpoint jusqu'à son rechargement.
2. Si c'est la lecture d'adresse elle-même qui est en cause : `GEOIP_IP_SOURCE: "none"` dans
   `.railway/railway.ts`, **en PR**, puis approbation de l'apply. Jamais dans le tableau de bord :
   le prochain apply la remettrait.

| Symptôme | Cause probable | Geste |
|---|---|---|
| plus aucune session `mip-rum-console` récente | préflight refusé (origine absente, application inactive ou suspendue) | couper (1), puis la requête `app_registry` ci-dessus |
| `geo_source` reste `timezone` | apply pas fait, ou base GeoIP `eteint` | relancer le script ; lire `/health` |
| pic de pays d'hébergeurs (US, DE, NL) en `geoip` | adresse d'un relais retenue | couper (2), relancer le script |

**Conformité.** Railway reçoit désormais l'adresse IP des visiteurs de la console ; ses journaux
HTTP consignent l'adresse source (`srcIp`), comme ceux de Vercel. `apps/console/lib/legal.ts` et
`docs/CONFORMITE.md` (§ 1, § 3.2, § 7) le disent depuis le 28/09/2026, et depuis le 30/09/2026 pour
les sites des clients (section suivante).

## Collecte directe des clients (P6b.G, second palier — prête et inerte le 30/09/2026)

Le même geste que le dogfooding, pour les **sites des clients** : leur navigateur écrit au collector
(`/v1/traces`, `/v1/replay`) au lieu de la console, et le collector déduit le pays de l'adresse IP. Le
code est fusionné **inerte** : rien ne change tant que `NEXT_PUBLIC_DIRECT_COLLECTOR_URL` n'est pas
posée sur Vercel. Posée, elle change trois choses, et rien d'autre :

| Où | Variable absente (aujourd'hui) | Variable posée |
|---|---|---|
| Fiche d'une application (`/admin/customers/<app>`), nouveau projet (`/select/new`) | code de suivi vers `/api/ingest/v1/traces` de la console | code vers `<collector>/v1/traces` **par défaut** (« recommandé : pays par l'adresse IP »), CSP qui cite le collector ; le code **par la console** reste proposé à côté, pour un site dont la CSP fige `connect-src` |
| `GET /api/extension/resolve` | `endpoint: null` (l'extension prend son défaut, la console) | `endpoint: "<collector>/v1/traces"` pour tout domaine sans `extension_scope.endpoint` déclaré, réponse relayée comprise ; effet sous 60 s (cache de l'extension), sans mise à jour de l'extension |
| `/admin/health`, « Où partent les données » | « Collecte directe des navigateurs des clients : fermée » | « ouverte », et l'adresse |

**Ce qui ne bouge jamais par cette variable** : un code de suivi **déjà posé** chez un client (le
basculer, c'est le remplacer sur son site), les recettes des agents serveur (l'adresse d'un serveur ne
dit rien d'un visiteur), la CI (source maps, marqueurs), le capteur de la console (sa variable à lui).
L'écran des sessions dit, sous l'onglet « Pays estimé », la part des sessions dont le pays vient de
l'adresse IP, et pourquoi elle est nulle pour une application restée en relais.

Code : `apps/console/lib/ingest-endpoint.ts` (`origineCollecteDirecte`, `ingestEndpointDirect`,
`voieRecommandee`), `lib/onboarding.ts` (`buildSnippet`, paramètre `voie`), `lib/extension-resolution.ts`,
`components/wizard/SnippetStep.tsx`, `lib/sessions-kpi.ts` (`phraseProvenancePays`). Tests :
`tests/unit/collecte-directe.test.ts` (le parcours d'un navigateur contre le receveur : préflights,
clé, rejeu, `geo_source = 'geoip'`), `tests/unit/ingest-endpoint.test.ts`,
`tests/unit/extension-resolution.test.ts`, `tests/unit/sessions-kpi.test.ts`,
`tests/integration/queries-sessions-sql.test.ts`.

### Ce que la voie directe change pour un client, et ce qu'elle ne change pas

- **Pas de repli** : en direct, un collector injoignable fait garder ses lots au SDK, qui les rejoue
  au chargement suivant, et un morceau de rejeu est perdu (le SDK ne rejoue pas un rejeu). Depuis
  C12 (06/10/2026), c'est vrai aussi par la console, qui rend alors 503. D'où le critère des 7 jours.
- **Même clé, même CORS** : le collector exige la clé (`REQUIRE_API_KEY: "true"`) — c'est déjà lui
  qui la vérifie pour les lots relayés — et lit les mêmes `app_registry.allowed_origins`. Le préflight annonce les en-têtes
  `x-mip-*` du rejeu et, depuis le 30/09/2026, `access-control-expose-headers: retry-after` (le SDK lit
  enfin le délai d'un 429 ou d'un 503 venu d'une autre origine — par la console aussi).
- **Même nature de requête** : pour le navigateur d'un client, la console est déjà une autre origine ;
  le préflight et le `fetch` `keepalive` du SDK ne changent pas, seule l'origine visée change. La CSP
  du site, elle, doit autoriser la nouvelle origine en `connect-src`.

### Mettre en service, pas à pas

**0. Le critère : 7 jours pleins à 100 % sans repli.** Le relais est à 100 % depuis le 28/09/2026,
07:10 UTC : **pas avant le 05/10/2026, 07:10 UTC**. « Sans repli » : aucune ligne `relay fallback`
ni `relay circuit open` dans les journaux Vercel de la console (service `ingest`) sur ces 7 jours.
Si l'offre Vercel ne garde pas 7 jours de journaux, les relever chaque jour ; un repli remet le
compteur à zéro. Le dogfooding direct doit avoir prouvé `geo_source = 'geoip'` (fait le 28/09/2026,
`docs/RUM_PARITY_STATUS.md`, D14).

**1. Prouver la façade et le CORS du premier client**, le jour même (lectures seules, rien n'est écrit) :

```sh
railway variables --service collector --json | jq -r .METRICS_TOKEN \
  | node scripts/ops/verifier-ip-directe.mjs --origine https://<site du client>
```

Attendu : code **0**, avec `✓ CORS : https://<site du client> est acceptée`, `✓ CORS du rejeu`,
`✓ la façade écrase l'adresse forgée`, et `source railway, base actif (dbip-country-lite-AAAA-MM)`.
Code **1** : ne rien allumer. Origine refusée : l'ajouter aux domaines de l'application (fiche du
client), 60 s.

**2. Vérifier la CSP du site** : `curl -sI https://<site du client> | grep -i content-security-policy`.
Pas de CSP, ou un `connect-src` (à défaut `default-src`) qui admet `https:` ou `*` : collecte directe
possible. Un `connect-src` qui n'admet que la console : ajouter l'origine du collector, ou garder ce
client en relais (code « par la console »). Même contrôle pour chaque domaine de l'extension
(`/admin/extension-scope`) ; un domaine à garder sur la console se déclare **avant** l'étape 3 :

```sql
update extension_scope set endpoint = 'https://mip-rum-console.vercel.app/api/ingest/v1/traces'
 where domain = '<domaine>' and endpoint is null;
```

**3. Vercel** → Settings → Environment Variables : `NEXT_PUBLIC_DIRECT_COLLECTOR_URL` =
`https://collector-production-d769.up.railway.app` (l'origine, sans chemin ; la même valeur que
`NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL`), environnement **Production** seulement. **Redéployer** : la
variable est inscrite au build.

**4. Contrôler la console** : `/admin/health`, « Collecte directe des navigateurs des clients :
ouverte » et l'adresse du collector ; la fiche du client montre « Recommandé : collecte directe »,
un code qui commence par `<!-- MIP RUM — collecte directe (pays par l'adresse IP) -->`, et le code
« par la console » dans « La CSP du site fige connect-src… ».

**5. Basculer un client** : remettre au client le code de suivi de sa fiche (clé comprise) ; il
remplace l'ancien sur son site (et sa CSP, étape 2). Sur le site, dans l'onglet Réseau : `OPTIONS`
puis `POST …/v1/traces` vers le collector, en 204 puis 200 ; journaux du collector : `ingested`,
aucun `rejected: api key`.

**6. Dater la bascule** par un marqueur de déploiement de l'application — il s'affiche sur les
courbes, et la requête de contrôle s'y ancre :

```sql
insert into deploy_marker (app_id, version, env, source)
values ('<app>', 'collecte-directe', 'prod', 'manual');
```

**7. Contrôler en base**, après quelques visites (les **nouvelles** sessions ; une session déjà
écrite garde sa première provenance, `on conflict`) :

```sql
with bascule as (
  select max(ts) as depuis from deploy_marker where app_id = '<app>' and version = 'collecte-directe'
)
select count(*)                                              as sessions,
       count(*) filter (where s.geo_source = 'geoip')           as par_adresse_ip,
       count(*) filter (where s.geo_source in ('timezone', 'cdn')) as estime,
       count(*) filter (where s.geo_source is null)             as inconnu
  from rum_session s, bascule
 where s.app_id = '<app>' and s.started_at > bascule.depuis;
-- Et pas de pic de pays d'hébergeurs (US, DE, NL) : ce serait l'adresse d'un relais.
select geo_country, count(*) from rum_session
 where app_id = '<app>' and geo_source = 'geoip' and started_at > now() - interval '24 hours'
 group by 1 order by 2 desc;
```

`par_adresse_ip` devient non nul : c'est le critère de P6b.G. Il reste nul : relancer l'étape 1, lire
`/health` (`geoip.etat`), et l'onglet Réseau du site (le code est-il bien le nouveau ?). L'écran des
sessions de l'application, onglet « Pays estimé », donne la même part.

### Retour arrière

| Geste | Effet | Délai |
|---|---|---|
| Rendre à un client le code « par la console » de sa fiche | ce site repasse par le relais ; pays de nouveau estimé | le déploiement du client |
| Retirer `NEXT_PUBLIC_DIRECT_COLLECTOR_URL` sur Vercel et redéployer (ou Instant Rollback vers un déploiement antérieur à la variable) | les fiches reproposent la console ; l'extension revient à son défaut | le redéploiement, puis 60 s de cache pour l'extension |
| `GEOIP_IP_SOURCE: "none"` dans `.railway/railway.ts`, **en PR**, puis approbation de l'apply | plus aucune adresse lue, quel que soit le code posé chez les clients ; les envois directs continuent d'être écrits, pays estimé | l'apply |

Un code de suivi direct déjà posé chez un client **continue d'écrire au collector** après le retrait de
la variable : la variable choisit ce que la console propose, pas ce que les sites envoient. Pour
arrêter la lecture d'adresse partout, c'est la troisième ligne.

| Symptôme | Cause probable | Geste |
|---|---|---|
| plus aucune session récente pour ce client | préflight refusé (origine absente), CSP qui bloque, clé fausse (403) | onglet Réseau du site ; `verifier-ip-directe.mjs --origine` ; rendre le code par la console |
| `par_adresse_ip` reste à 0 | ancien code encore servi, apply GeoIP absent, base DB-IP `eteint` | étapes 1 et 5 ; `/health` |
| pic de pays d'hébergeurs en `geoip` | adresse d'un relais retenue | `GEOIP_IP_SOURCE: "none"` (PR), relancer l'étape 1 |
