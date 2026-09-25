# Relais d'ingestion : de la console Vercel au collector Railway (P3)

La console relaie une part des beacons vers le collector Railway au lieu de les écrire
elle-même. C'est la bascule de la collecte, **sans changer une seule URL chez les
clients** : le SDK, l'extension et la CI continuent de viser `mip-rum-console.vercel.app`.
Le pourcentage se règle en base, se coupe en moins de 30 s, et le chemin local reste en
place comme repli.

Code : `apps/console/lib/ingest-relay.ts` (relais), `apps/console/lib/platform-flag.ts`
(drapeau), `packages/db/sql/migration-v87.sql` (table `platform_flag`). Tests :
`tests/unit/ingest-relay.test.ts`, `tests/contract/relais-ingestion.test.ts`.

## État à la fusion : inerte

À la fusion, **le relais ne fait rien en production**, et c'est vérifié par un test.

- `CONSOLE_INGEST_RELAY_URL` n'est pas posée sur Vercel : le relais est éteint **quel que
  soit le drapeau**. La console ne lit même pas `platform_flag` : aucune requête SQL de plus.
- La migration v87 n'est pas encore appliquée : la base Neon est suspendue depuis le 24/09
  (quota gratuit épuisé). Elle s'appliquera d'elle-même au prochain pré-déploiement réussi
  du scheduler. Tant que la table manque, la lecture du drapeau échoue en `42P01`. La console
  retombe alors sur `INGEST_RELAY_PCT` (défaut 0), sans exception.
- La ligne que v87 sème vaut `'0'`. Appliquer la migration ne relaie donc rien non plus.

Ce qui change quand même à la fusion, et vient de **P2** (voulu : la console répond comme
le collector, contrat de parité `tests/contract/ingest-parity.test.ts`) :

- une base injoignable rend **503 + `retry-after: 2`** au lieu de 500. Le SDK rejoue les
  deux de la même façon ;
- un corps **sans longueur annoncée** (transfert par morceaux) de plus de 2 Mo rend **413**,
  là où `req.json()` lisait jusqu'au plafond Vercel. `fetch` et `sendBeacon` annoncent une
  longueur : le SDK n'est pas concerné ;
- un JSON précédé d'une **BOM UTF-8** rend **400** (`req.json()` la retirait). Le SDK n'en
  envoie pas ; la tolérer serait à faire sur les DEUX ports à la fois (cas de parité dédié) ;
- un **rejeu** sans en-tête `x-mip-seq`, ou avec une valeur qui n'est pas un entier décimal,
  rend **400**. Il était accepté comme séquence 0 (`Number(null) === 0`) et pouvait écraser
  en silence le vrai premier morceau. Le SDK envoie toujours `x-mip-seq`.

## Avant de monter le pourcentage

Chaque point ci-dessous est bloquant.

1. **La base répond** (Neon rétabli) et `migration-v87.sql` figure dans `schema_migration` :

   ```sql
   select filename, applied_at from schema_migration where filename = 'migration-v87.sql';
   select * from platform_flag;
   ```

2. **Le collector est déployé** (P2), avec 2 répliques, et son `/health` affiche le bord de
   confiance **et porte la signature** `x-mip-collector: 1` :

   ```sh
   curl -si https://<collector>.up.railway.app/health
   # attendu : en-tête "x-mip-collector: 1" ;
   #           "service":"collector", "edge_protocol":"mip-edge/1", "edge_trust":true
   ```

   La console fait la même vérification, en cache 60 s. Si la signature manque, ou si
   `edge_protocol` ou `edge_trust` ne correspond pas, elle ne relaie rien (journal
   `relay bypass: collector health`). La signature est ce qui distingue un 404 **métier**
   du collector d'un 404 du routeur Railway (voir la matrice de repli).
   `id_fp` n'est **pas** comparé : depuis le 23/09, Vercel ne hache plus rien, et seul le
   collector hache.

3. **Les secrets sont posés.**

   | Variable | Où | Valeur |
   |---|---|---|
   | `EDGE_PROXY_SECRET` | collector (variable partagée Railway) **et** Vercel | la même valeur, ≥ 32 caractères. Côté Vercel, **une seule** valeur. Le collector en accepte deux pendant une rotation. |
   | `CONSOLE_INGEST_RELAY_URL` | Vercel | l'URL du collector, par ex. `https://collector-production.up.railway.app` (sans chemin). **`https:` obligatoire** : en `http:`, le secret de bord, les clés d'API et le jeton d'upload partiraient en clair ; la console éteint alors le relais (journal `relay disabled`). `http:` n'est accepté que pour `localhost`, `127.0.0.1` et `::1` (tests). |
   | `INGEST_RELAY_PCT` | Vercel, **à ne pas poser** | défaut du pourcentage quand la base est illisible. Laissé absent, il vaut 0 : une base en panne ne relaie rien. |
   | `IDENTITY_HASH_SECRET` + `IDENTITY_HASH_FINGERPRINT` | collector seulement | le collector hache l'identité. **Rien sur Vercel.** |

   Sans `EDGE_PROXY_SECRET` valide côté Vercel, le relais reste éteint (journal
   `relay disabled`). Relayer sans secret ferait prendre au collector le trafic pour du
   trafic direct, et il géolocaliserait alors l'adresse de Vercel.

4. **Les clés d'ingestion sont provisionnées** (R8a), ou `REQUIRE_API_KEY=false` est posé
   sur le collector. Un 403 du collector est rendu tel quel au client : **le relais ne se
   replie pas sur un 403**.

5. **Fumée de preview** : traces, logs et replay pour l'app `mip-probe`. Dans les journaux
   Vercel, on doit voir la requête partir vers le collector, et dans ceux du collector la
   ligne `ingested`.

6. **`p3/conformite-bascule` fusionnée ET déployée sur Vercel AVANT le premier
   `update … set value = '<n>'` avec n > 0.** Vérifier le texte en ligne de
   `/legal/confidentialite` : il doit désigner le collector Railway comme celui qui reçoit,
   hache et écrit les mesures relayées. Sinon, dès 10 %, la page publique et
   `docs/CONFORMITE.md` §7 affirment que Railway ne fait que lire alors qu'il écrit.

   **Aucun test ne tient ce prérequis.** `tests/unit/conformite.test.ts` compare les textes
   au code, pas à la valeur du drapeau en base : il est vert AVANT la bascule (sur cette
   branche) et vert APRÈS (sur `p3/conformite-bascule`). Il ne rougit **pas** le jour de la
   bascule. La montée est un `update` en base, pas un commit : rien dans la CI ne la voit.
   La garde est **humaine** — c'est ce point de la liste.

## Monter le pourcentage

```sql
update platform_flag set value = '10', updated_by = '<prénom>' where key = 'ingest_relay_pct';
```

- Montée prévue : **0 → 10 % (2 h) → 50 % (une nuit) → 100 %**, puis au moins 3 jours à
  100 % (le soak).
- L'effet est visible en moins de 30 s : chaque instance Vercel relit la valeur toutes les
  30 s.
- Le tirage se fait **par requête**. À 10 %, une même session a des lots des deux côtés.
  C'est sans conséquence : les deux chemins écrivent les mêmes lignes (contrat de parité,
  `tests/contract/ingest-parity.test.ts`).
- La valeur est contrainte en base : un entier de 0 à 100, sans « % » ni zéro de tête. Une
  faute de frappe fait échouer l'`update`, au lieu de laisser croire que la bascule a monté.
- `updated_at` se met à jour tout seul. Renseigner `updated_by` : tout le monde se connecte
  avec le même rôle, et c'est la seule trace de qui a changé la valeur.

## Couper

```sql
update platform_flag set value = '0', updated_by = '<prénom>' where key = 'ingest_relay_pct';
```

- **Effet en moins de 30 s**, sans redéploiement. C'est le coupe-circuit, et le geste à
  faire en premier.
- En second recours : Instant Rollback Vercel vers le déploiement d'avant P3, ou retrait de
  `CONSOLE_INGEST_RELAY_URL` (qui demande un redéploiement).
- Le collector, lui, peut rester en place : sans trafic relayé, il ne fait rien.

## Ce que fait le relais, requête par requête

- Le corps est lu **une seule fois**, avec une lecture bornée. Les mêmes octets servent au
  relais et, en cas de repli, au chemin local. Un corps trop gros est refusé localement
  (413), sans appel réseau.
- **En-têtes transmis, liste exacte :** `content-type`, `content-encoding`,
  `x-mip-session`, `x-mip-app`, `x-mip-seq`, `x-mip-key`, plus `authorization` pour les
  source maps par jeton. S'y ajoutent `x-mip-edge-auth` (le secret) et `x-mip-edge-country`
  (le pays résolu par Vercel, s'il vaut `^[A-Z]{2}$`).
- **Jamais d'adresse IP** : ni `x-forwarded-for`, ni `x-real-ip`, ni
  `x-vercel-forwarded-for`, ni `forwarded`. La phrase « aucune adresse IP n'est transmise
  ni stockée » reste vraie.
- La réponse du collector est **reconstruite** : statut, corps et `retry-after` du
  collector ; `content-type: application/json` **imposé** et `x-content-type-options:
  nosniff` (un hôte qui répondrait `text/html` ne fait pas rendre de HTML sous l'origine de
  la console, où vit le cookie admin) ; en-têtes CORS de la console.
- **C11 — les routes machine** passent par le même relais, sous le même drapeau
  (`ingest_relay_pct`) et le même disjoncteur :
  - `GET /api/extension/resolve` → `/v1/extension/resolve` (le SEUL `GET` relayé : une
    lecture, sa requête transmise, aucun en-tête ; `cache-control` du collector rendu) ;
  - `POST /api/extension/heartbeat` → `/v1/extension/heartbeat` (`content-type` et
    `user-agent`, que la route inscrit à l'inventaire) ;
  - `POST /api/v1/deploys` → `/v1/deploys`, pour un **jeton de CI** `deploys:write`
    seulement (`content-type`, `authorization`). NON idempotent : un 502/504 non signé
    ou une connexion perdue après l'envoi rendent 503 + `retry-after`, jamais un repli
    qui poserait deux marqueurs. Un jeton `CONSOLE_API_TOKENS` n'est jamais relayé (le
    collector ne le lit pas) : la console le traite elle-même jusqu'au 31/12/2026.
- **Ce qui n'est jamais relayé :**
  - `OPTIONS` (préflight local) ;
  - la branche admin des source maps (cookie de session) ;
  - tout autre `GET`.
- `NEXT_PUBLIC_RUM_ENDPOINT` n'est pas touché : il alimente aussi `log-forward`.

### Chaîne des délais

**collector 4 s < relais 8 s < fonction 30 s.**

- Le collector a un budget **dur** de 4 s par requête : au-delà, il rend 503, et presque
  toujours **rien n'est commité**. Une exception, irréductible : un COMMIT déjà arrivé au
  serveur dont la réponse se perd en route. Personne ne sait alors s'il a validé ; le
  collector rend 503 `ingestion outcome unknown` et journalise en erreur
  `deadline: commit outcome unknown, replay may duplicate`. C'est la **seule** source
  possible de doublons de logs, et elle se compte dans les journaux (1 à 2 cas sur 42 au
  banc, sous 10 s de latence injectée : `scripts/bench/preuve-echeance-collecteur.mjs`).
- Le relais attend 8 s (`DELAIS.relaisMs`) : le collector répond donc toujours avant, 503
  compris. Au-delà, 503 + `retry-after: 5`.
- Les quatre routes d'ingestion déclarent `export const maxDuration = 30`. Au pire, une
  requête enchaîne la lecture du drapeau (1,5 s), la sonde `/health` (2 s), le relais (8 s)
  puis, sur un repli tardif, l'écriture locale (reprises et verrou) : environ 27 s. Sans ce
  plafond explicite, le défaut du projet Vercel (10 s en Hobby, 15 s en Pro hors Fluid)
  couperait la fonction **avant** le 503 du relais : un 504 `FUNCTION_INVOCATION_TIMEOUT`
  sans aucune ligne `relay timeout` au journal.

### Matrice de repli

Le collector **signe toutes ses réponses** (`x-mip-collector: 1`, posé par le kit, jusque
sur ses 404, 413 et 500). Le routeur Railway ne signe rien. Une réponse signée est celle du
collector : elle est rendue telle quelle, **sans repli et sans échec compté**. Seules les
réponses **non signées** peuvent déclencher un repli.

| Issue du relais | traces | replay | sourcemaps | **logs** |
|---|---|---|---|---|
| réponse **signée**, quel que soit le statut (2xx, 400, 401, 403, **404 métier**, 409, 413, 425, 429, 500, 503…) | réponse du collector | idem | idem | idem |
| erreur de connexion (DNS, refus, TLS, délai de connexion) | **repli local** | repli | repli | repli |
| connexion perdue **après** l'envoi | repli | repli | repli | **503 + retry-after** |
| 404, 405 **non signés** (service absent, mal routé) | repli | repli | repli | repli |
| 502, 504 **non signés** (routeur Railway) | repli | repli | repli | **503 + retry-after** |
| autre statut non signé | rendu tel quel | idem | idem | idem |
| délai de 8 s dépassé | **503 + retry-after: 5** | idem | idem | idem |

Le 404 **métier** qui a motivé la signature : `POST /v1/sourcemaps` pour une app inconnue
rend 404. Sans signature, il était pris pour un routage raté : repli local, et un échec
compté. Cinq envois d'une CI en 30 s ouvraient le disjoncteur de l'instance, pour **tous**
les clients.

Un 502/504 du routeur ne prouve pas que rien n'est écrit : une réplique a pu committer puis
tomber avant de répondre. D'où le 503 pour les logs, et le repli pour les signaux
idempotents seulement.

Pourquoi les logs sont à part : ce sont les **seuls** à ne pas être idempotents.

- `writeLogsWithClient` insère dans `rum_log`, dont la clé est un `bigserial`, avec une
  clause de conflit vide. Le même lot écrit deux fois donne deux fois chaque log.
- Les traces sont idempotentes : partout `on conflict (span_id | action_id | …) do nothing`,
  et `greatest` sur la session.
- Le replay aussi : `on conflict (session_id, seq) do nothing`.
- Les source maps aussi : un contenu identique rend `unchanged`, un contenu différent rend
  409 pour tout le lot.

Seul effet d'un repli sur un signal idempotent : le compteur de débit (`rate_counter`)
compte le beacon deux fois.

### Disjoncteur

- 5 échecs en 30 s font contourner le relais pendant 60 s. Comptent comme échecs : délai
  dépassé, erreur réseau, réponse **non signée** 404, 405 ou ≥ 500.
- Une réponse **signée** du collector (400, 403, 404, 429, 500, 503…) n'est **pas** un
  échec : il a répondu, et le disjoncteur ne protège que de l'attente. Conséquence à
  connaître : si la **base** du collector tombe, le disjoncteur ne s'ouvre jamais —
  chaque beacon attend le 503 signé du collector (au plus ≈ 4,75 s, budget + grâce du
  COMMIT). Le geste, dans ce cas, c'est `platform_flag` à `0`.
- L'état vit **en mémoire d'instance**. Chaque instance serverless Vercel a le sien, qui
  naît fermé et meurt avec elle. Il protège une instance contre 8 s d'attente par beacon.
  **Ce n'est pas un coupe-circuit global** : le coupe-circuit global, c'est
  `platform_flag`.

## Ce qu'on surveille

**Journaux Vercel** (service `ingest`, JSON) :

| Message | Sens | Réaction |
|---|---|---|
| `relay fallback` (`raison`, `statut` ou `code`) | repli local : le beacon est écrit, par la console | Viser ≈ 0. Une rafale = collector en difficulté. |
| `relay timeout` | 8 s dépassées, 503 rendu au client | Toute occurrence mérite un regard : le collector dépasse son budget. |
| `relay failed, outcome unknown` | logs : connexion perdue après l'envoi, ou 502/504 non signé | Rare. Doublons de logs possibles si le SDK rejoue. |
| `relay circuit open` | une instance contourne le relais 60 s | Si elle se répète : couper (`value = '0'`). |
| `relay bypass: collector health` | `/health` refusé, non conforme ou non signé | Vérifier le déploiement (collector à jour, `x-mip-collector`) et `EDGE_PROXY_SECRET` du collector. |
| `relay disabled` | URL (invalide, ou `http:` hors localhost) ou secret invalide sur Vercel | Corriger la variable. |
| `platform_flag illisible : défaut d'environnement` | table absente (`42P01`) ou base en erreur | Normal avant v87, anormal ensuite. |

**Journaux du collector** :

- `ingested`, `ingested logs`, `ingested replay` : l'écriture a eu lieu ;
- `en-têtes de bord non authentifiés retirés` : c'est le symptôme d'un `EDGE_PROXY_SECRET`
  désaccordé entre Vercel et Railway.

**Lignes par app** (à comparer avant et après chaque palier ; attendu : ±10 % du trafic
`mip-probe` mesuré en P0.T) :

```sql
-- Métriques et logs par app et par heure, sur 24 h.
select app_id, date_trunc('hour', ts) as heure, count(*) as metriques
  from rum_metric where ts > now() - interval '24 hours'
 group by 1, 2 order by 2 desc, 1;
select app_id, date_trunc('hour', ts) as heure, count(*) as logs
  from rum_log where ts > now() - interval '24 hours'
 group by 1, 2 order by 2 desc, 1;
select app_id, date_trunc('hour', created_at) as heure, count(*) as chunks
  from replay_chunk where created_at > now() - interval '24 hours'
 group by 1, 2 order by 2 desc, 1;
```

**Pays et identité** :

```sql
-- Pas de pic DE/NL/US : ce serait un GeoIP sur l'adresse d'un relais.
select geo_country, geo_source, count(*) from rum_session
 where last_seen_at > now() - interval '24 hours' group by 1, 2 order by 3 desc;
-- Identités hachées : non nulles seulement sur ce que le collector a écrit.
select app_id, count(*) filter (where user_id_hash is not null) as hachees, count(*)
  from rum_session where last_seen_at > now() - interval '24 hours' group by 1;
```

Tant qu'une part passe par le chemin local, les sessions qu'il écrit n'ont pas d'identité :
Vercel n'a pas de secret, c'est voulu. Une donnée manquante, jamais incohérente. Le
recouvrement de `user_id_hash` d'un jour sur l'autre se vérifie une fois à 100 %.

## Ce qui reste à faire (jusqu'à P6b)

- **Conformité, fusionnée et déployée AVANT le premier `update platform_flag` au-dessus
  de 0** (prérequis n° 6). La montée est un `update` en base, pas un commit : la
  conformité ne peut pas « partir avec » elle. La branche `p3/conformite-bascule` porte les
  textes. Ici, `lib/legal.ts` et `docs/CONFORMITE.md` §7 disent encore que Vercel collecte
  et que Railway lit, et ne sont **pas** modifiés. `tests/unit/conformite.test.ts` reste
  vert avant comme après : il ne signalera pas un oubli.
- **Soak** : au moins 3 jours à 100 %, environ 0 `relay fallback`.
- **P6b.G — collecte directe pour le GeoIP.** Le relais transmet le pays, jamais l'IP, et
  saute donc la résolution. Tant qu'il porte tout le trafic, le GeoIP reste inerte. Après
  7 jours à 100 % sans repli :
  - poser l'endpoint du collector pour les apps **sans `connect-src` figée** dans leur CSP ;
  - dater le changement par un `deploy_marker` ;
  - vérifier que `geo_source = 'geoip'` devient non nul.

  Les apps à CSP figée restent en relais.
- **Canari extension** : `update extension_scope set endpoint = …`, seulement sur un domaine
  sans `connect-src` CSP.
- **P6b — exercices sur staging** : retour arrière par le drapeau, sous charge, chronométré.
  Il sert à prouver le « < 30 s ».
- **Au-delà (C11/C12)** : retirer le chemin d'écriture local de la console, une fois que le
  relais pur a tenu. La console n'aura alors plus besoin de `DATABASE_URL` pour l'ingestion.
