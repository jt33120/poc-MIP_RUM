# MCP — interroger le portail MIP RUM avec une IA

Le **Model Context Protocol** est la prise standard entre un modèle de langage et
un système. Branché sur MIP RUM, il permet de demander

> « quelles routes se sont dégradées cette semaine, et sur quels appareils ? »

au lieu d'enchaîner à la main une dizaine d'appels REST.

Le serveur vit dans ce dépôt :

```
packages/mcp-tools/         LE NOYAU — catalogue d'outils, client HTTP, rendu
services/mcp/     les deux points d'entrée : stdio (local), HTTP (Railway)
```

---

## 1. Ce que le serveur est — et ce qu'il n'est pas

**C'est un client de l'API v1.** Il n'a aucun accès à Postgres : pas de
`DATABASE_URL`, pas de `pg` dans son image. Chaque outil se traduit en un
`GET /api/v1/…` porteur du jeton de l'appelant.

Ce n'est pas un détail d'implémentation, c'est la conception :

| | Serveur MCP → API v1 | Serveur MCP → Postgres |
|---|---|---|
| Cloisonnement par app | celui de l'API, écrit une fois | à réimplémenter, donc à faire diverger |
| Débit | compté par l'API, par principal | à refaire |
| Injection de prompt réussie | donne ce que le jeton donnait déjà | donne la base entière |

Le dépôt a déjà payé le prix d'une règle d'accès écrite deux fois : il a existé
**trois** implémentations de l'ingestion, et le serveur de développement
acceptait une app sans clé là où la production la rejetait.

**Lecture seule.** Quinze des seize outils sont des `GET`. Le seizième,
`mip_rum_query_explorer`, poste son AST sur `POST /api/v1/explorer/query` — parce
qu'une requête analytique ne tient pas dans une query string, **pas** parce qu'elle
écrit : cette route n'écrit rien et s'authentifie exactement comme les `GET`.
`POST /api/v1/deploys` et les écritures du workflow des issues
(`/issues/{id}/triage`, `/comments`, `/links`) existent côté API et ne sont **pas**
exposés — donner à un agent conversationnel de
quoi écrire en production est une décision qui se prend à froid, pas un oubli qu'on
comble. Ces écritures refusent d'ailleurs tout jeton d'API : seule une session admin
de la console les passe. Un test verrouille cette absence.

---

## 2. Authentification

**Oui, un jeton est nécessaire.** C'est le même que celui de l'API v1 :
une entrée de `CONSOLE_API_TOKENS` côté console.

```
CONSOLE_API_TOKENS=jeton-interne,jeton-partenaire@uti-portail
                   ^ toutes apps   ^ scopé à uti-portail
```

Là où les deux transports diffèrent :

| | D'où vient le jeton | Pourquoi |
|---|---|---|
| **stdio** (local) | `MIP_API_TOKEN` dans l'environnement | un poste, un utilisateur, aucune requête HTTP entrante pour le porter |
| **HTTP** (distant) | l'en-tête `Authorization` de l'appelant, **relayé** | le serveur est une URL publique ; s'il portait son propre jeton, quiconque la trouve lirait les données de tous les clients |

Le serveur HTTP **ne détient aucun secret**. Un `POST /mcp` sans en-tête
`Authorization` reçoit `401` avant que quoi que ce soit ne soit lu.

### Le cas qu'il ne faut pas rater

Depuis **P6.2**, une app hors périmètre est **refusée** : l'API répond `403` avec
`code: "forbidden_app"`, et un jeton sans aucune app autorisée reçoit
`code: "no_app_access"`. Elle ne ramène plus la demande au périmètre du jeton —
un partenaire ne peut donc plus recevoir, sans le voir, les chiffres d'une autre
app que celle qu'il a nommée. Sans `app`, la réponse couvre **toutes** les apps
autorisées du jeton, et `meta.scope.effective_apps` les énumère.

Il reste un cas où `meta.app` diffère de l'app demandée, et il est légitime : le
**détail d'un groupe d'erreurs ou d'une issue** porte l'app de la ressource, dont
l'identifiant fait foi. Chaque outil compare l'app demandée à `meta.app` et, si
elles diffèrent, place l'avertissement **en tête** de sa réponse :

```
⚠️ Périmètre : l'app « gip-plateforme » a été demandée, mais la réponse porte sur
« uti-portail » (l'identifiant de la ressource fait foi, ou le jeton n'a pas accès
à l'app demandée). Ces chiffres ne concernent PAS l'app demandée.
```

Sans cela, un modèle présenterait 4 sessions d'une app comme les chiffres d'une
autre. C'est le pire mode de défaillance possible ici : une réponse fausse,
présentée comme juste.

### Ce que la réponse annonce

Chaque enveloppe porte, en plus de `meta.app`, `meta.period` et `meta.device` :

| Champ | Ce qu'il dit |
|---|---|
| `meta.scope` | l'app demandée et les apps réellement lues (`effective_apps`) |
| `meta.range` | les bornes UTC `[from, to)` appliquées, le preset et la largeur de seau |
| `meta.filters` | les conditions appliquées, l'inclusion des robots et des apps internes |

Un filtre qu'une mesure ne sait pas appliquer n'est jamais ignoré : l'API répond
`400` avec `code: "unsupported_dimension"` et la dimension en cause. Les outils
historiques n'exposent que `app`, `period` et `device` : leurs endpoints existaient
avant le contrat commun, et leur ajouter des dimensions sans migrer leurs mesures
annoncerait un filtre qu'elles ignorent. `mip_rum_query_explorer` (P6.4), lui, porte
les dimensions du contrat — navigateur, système, environnement, service, release,
route, pays — en égalité exacte. `mip_rum_mobile_summary` (P7.5) en porte trois —
`device`, `release` et `platform` — et REFUSE les autres : une route ou un service
filtreraient les occurrences sans filtrer la cohorte, et son taux n'aurait plus le
même dénominateur que son numérateur.

---

## 3. Les seize outils

Tous acceptent un `format` (`json` par défaut, ou `markdown`). Tous, sauf
`mip_rum_list_apps` et `mip_rum_get_session`, portent les filtres communs `app`,
`period` (`1h` / `24h` / `7d`) et `device`.

| Outil | Endpoint | Pour répondre à |
|---|---|---|
| `mip_rum_list_apps` | `/apps` | « à quoi ai-je accès ? » — **à appeler en premier** |
| `mip_rum_get_overview` | `/overview` | « comment va cette app ? » (avec la période précédente) |
| `mip_rum_get_vitals` | `/vitals` | « est-ce que ça se dégrade ? » (`series=LCP,INP`) |
| `mip_rum_list_slow_pages` | `/pages` | « qu'est-ce qui est lent, et pour combien de monde ? » |
| `mip_rum_list_errors` | `/errors` | « qu'est-ce qui casse, et pour combien de personnes ? » |
| `mip_rum_get_error_group` | `/errors/{fingerprint}` | « qui est touché par cette erreur, et où la retrouver (session, replay, trace, action) ? » |
| `mip_rum_list_issues` | `/issues` | « quels problèmes durables, avec quel statut, et quelle part des erreurs le regroupement v2 couvre-t-il ? » |
| `mip_rum_get_issue` | `/issues/{id}` | « cette issue reprend-elle d'anciens groupes, avec quel triage, et qui touche-t-elle ? » |
| `mip_rum_list_sessions` | `/sessions` | « que s'est-il passé récemment ? » |
| `mip_rum_get_session` | `/sessions/{id}` | « qu'a vécu cet utilisateur ? » |
| `mip_rum_list_events` | `/events` | « combien de fois cet événement métier, avec quel attribut ? » |
| `mip_rum_mobile_summary` | `/mobile/summary` | « que voit — et que NE voit pas — la couche JS React Native ? » |
| `mip_rum_get_tracing` | `/tracing` | « le backend est-il en cause ? » |
| `mip_rum_get_correlation` | `/correlation` | « pourquoi le monitoring est au vert et les utilisateurs se plaignent ? » |
| `mip_rum_get_health_grid` | `/health-grid` | « est-ce toujours le lundi matin ? » |
| `mip_rum_query_explorer` | `POST /explorer/query` | « et cette mesure-là, découpée comme ça ? » — la question qu'aucun des quinze autres ne couvre |

### `mip_rum_mobile_summary` : ce qui n'est pas mesuré n'est pas zéro

Le seul outil du catalogue dont la première chose à lire n'est pas un chiffre mais
une **liste de capacités**. Un modèle qui reçoit zéro crash natif et en conclut que
l'application est stable se trompe dans les grandes largeurs : aucun module natif
n'existe dans ce produit, et les crashes natifs, les ANR et le démarrage natif ne
sont collectés nulle part — ils appartiennent à P8.5.

La réponse ne leur donne donc **aucun champ**. Ce n'est pas un oubli : un champ à
`null` se lirait comme « mesuré, et vide ». `data.capabilities` porte l'information,
avec trois états distincts — `active` (une release déclare collecter), `unavailable`
(une release déclare ne PAS collecter) et `unknown` (personne n'a rien déclaré) — et
une note qui dit, capacité par capacité, ce que l'absence de signal veut dire.

`js_error_free_session_rate` porte sur les seules erreurs **JavaScript** : une erreur
non interceptée arrête le bundle et affiche la redbox, elle ne tue pas le processus
natif. Ne jamais le présenter comme un taux « sans crash ». Il vaut `null`, avec sa
raison dans `js_error_free_unavailable_reason`, dès qu'un pourcentage mentirait.

`verified_at` ne vient que d'une recette d'opérateur sur un appareil réel. Une
capacité déclarée active dit ce que le SDK croit avoir installé, pas qu'un signal a
été reçu, écrit et affiché.

### `mip_rum_query_explorer` : composer une mesure, pas en choisir une

Les quinze premiers outils répondent chacun à une question fixée d'avance. Le
seizième laisse le modèle **composer** la sienne : quel jeu de données
(`dataset`), quelle mesure (`measure`, sous la forme `champ:agrégation`), quel
découpage (`group_by`, deux dimensions au plus) et sous quelle forme
(`visualization`). C'est exactement l'AST de l'écran `/explorer` : mêmes bornes,
mêmes refus, même registre.

Le registre est **fermé**. Un jeu, une mesure ou une dimension absents reçoivent
un `400` typé (`unsupported_dataset`, `unsupported_measure`,
`unsupported_dimension`) — jamais un filtre ignoré, jamais une mesure approchée
par une autre. Un champ qui n'est pas au catalogue — message d'erreur, pile, URL
brute, identité — n'est pas mesurable, et le refus ne dit pas s'il existe
ailleurs. `GET /api/v1/explorer/schema` publie ce registre.

Trois pièges que la description de l'outil énonce au modèle, parce qu'ils se
lisent tous comme un chiffre :

- **`0` et `null` ne sont pas la même chose.** Un dénombrement réellement vide
  vaut `0` ; une moyenne ou un percentile sans échantillon vaut `null`.
- **`503 query_budget_exceeded` n'est pas un résultat.** La requête n'a pas
  abouti : il faut réduire la période, les groupes ou les filtres. Une série de
  zéros se lirait comme une absence de trafic.
- **Le journal ne fait pas les graphes.** `rows` est paginé par curseur ; total,
  groupes et série sont calculés sur toute la population, dans le même
  instantané.

### Ce que les outils disent au modèle, et qui compte

Les descriptions énoncent les limites **explicitement**, parce qu'un modèle qui
les ignore comble les trous par des suppositions :

- trois fenêtres seulement, aucune date libre ;
- la liste des sessions est paginée **sans total** — une page pleine indique une
  suite probable, jamais combien. Les groupes d'erreurs et l'Explorer d'événements
  renvoient un `total` filtré ; le détail d'un groupe d'erreurs et l'Explorer
  paginent par curseur (`data.page.next_cursor` à recopier dans `cursor`) ;
- sur les erreurs, un nombre de personnes touchées à `null` veut dire **inconnu**
  (erreur sans session ni identité), pas zéro, et `sampling.message` signale des
  volumes observés sur un échantillon, jamais extrapolés ;
- une empreinte d'erreur n'est unique que dans une app : présente dans plusieurs
  apps du périmètre sans `app`, le détail répond une erreur qui liste les apps
  candidates ;
- les issues comptent chaque occurrence une seule fois, dans une issue ou dans un
  groupe historique qu'aucune issue ne reprend ; `reappeared` est une réapparition
  **à vérifier**, pas une régression confirmée, et `low_confidence` un repli peu
  discriminant ;
- `device=tablet` n'est pas distingué par les endpoints historiques ;
- aucune donnée personnelle : les utilisateurs sont des empreintes.

### `json` ou `markdown`

Le défaut est **`json`** — l'enveloppe de l'API telle quelle, sans
transformation. La convention MCP recommande l'inverse ; ici la valeur du
produit est l'exactitude d'un chiffre, et toute mise en forme est une occasion
d'en perdre un.

Le rendu `markdown` existe et reste **générique** : une fonction pour les seize
outils, pas seize gabarits. Un gabarit oublié n'échoue pas — il affiche l'ancienne
colonne comme si elle était toute la vérité.

En JSON, ce que le serveur MCP a constaté est rangé à part, sous `_mcp`
(`chemin`, `pagination`, `avertissement`) : on ne doit pas pouvoir confondre une
observation du serveur avec une donnée mesurée.

---

## 4. Brancher un client — local (stdio)

Dans la configuration du client MCP (Claude Desktop, un IDE…) :

```json
{
  "mcpServers": {
    "mip-rum": {
      "command": "node",
      "args": ["/chemin/vers/poc-MIP_RUM/services/mcp/stdio.mjs"],
      "env": {
        "MIP_CONSOLE_URL": "https://mip-rum-console.vercel.app",
        "MIP_API_TOKEN": "<jeton listé dans CONSOLE_API_TOKENS>"
      }
    }
  }
}
```

Sans l'une des deux variables, le serveur **refuse de démarrer** (code 2) au lieu
de s'annoncer puis de répondre 401 à chaque outil — le pire des deux mondes,
puisque le modèle croirait avoir un accès.

Vérifier à la main :

```bash
MIP_CONSOLE_URL=http://localhost:3000 MIP_API_TOKEN=xxx \
  node services/mcp/stdio.mjs
# -> mcp: prêt sur stdio (api http://localhost:3000/api/v1)
```

---

## 5. Brancher un client — distant (Streamable HTTP)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `MIP_CONSOLE_URL` | **oui** | origine de la console, ex. `https://mip-rum-console.vercel.app` |
| `PORT` | fourni par l'hébergeur | port d'écoute (défaut 8080) |
| `MCP_PATH` | non | chemin du point MCP (défaut `/mcp`) |

Pas de `MIP_API_TOKEN` : le serveur relaie celui de l'appelant.

```
POST /mcp     JSON-RPC MCP — exige Authorization: Bearer <jeton>
GET  /health  sonde de l'hébergeur, publique, ne dit que « le process vit »
```

Le mode est **sans session** (`sessionIdGenerator: undefined`,
`enableJsonResponse: true`) : chaque requête est autonome, donc le service
survit à un redéploiement et se réplique sans état partagé. Un `GET /mcp`
répond `405` — sans session il n'y a aucun flux serveur→client à ouvrir, et
laisser le client attendre serait pire qu'un refus.

### Déploiement Railway — fait

Service `mcp` dans le projet `mip-rum-backend`, à côté de `ingest` et
`scheduler` :

| Réglage | Valeur |
|---|---|
| Dockerfile | `services/mcp/Dockerfile` (le sien, comme chaque service depuis P1) |
| Variables | `MIP_CONSOLE_URL`, `PORT=8080`, `NODE_ENV=production` |
| Healthcheck | `/health` |
| Région | `europe-west4-drams3a` (Amsterdam) |
| Branche | `master` |
| Domaine | `https://mcp-production-201c.up.railway.app` |

Adresse à donner à un client MCP distant :

```
https://mcp-production-201c.up.railway.app/mcp
```

avec un en-tête `Authorization: Bearer <jeton>`. Sans jeton, `401`.

**Image séparée, à dessein.** Chaque service a désormais la sienne
(`services/<x>/Dockerfile`), mais le serveur MCP l'avait avant les autres, et
pour une raison plus forte que la propreté : il ne doit pas pouvoir atteindre la
base. Son image ne contient que la fermeture des dépendances de
`@mip/service-mcp` (posée par `pnpm deploy`) : ni `pg`, ni `DATABASE_URL`. Le job
de fumée (`docker-smoke.yml`, ligne `mcp` de la matrice) échoue si `pg` y
réapparaît.

---

## 6. Vérifier

```bash
# tests unitaires du serveur MCP (catalogue, rendu, erreurs, périmètre)
npx vitest run tests/unit/mcp-serveur.test.ts

# chaîne complète, à la main
PORT=8111 MIP_CONSOLE_URL=http://localhost:3000 node services/mcp/http.mjs &
curl -s localhost:8111/health
curl -s -X POST localhost:8111/mcp \
  -H 'authorization: Bearer <jeton>' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Un `POST /mcp` sans `Authorization` doit répondre `401` avec un en-tête
`WWW-Authenticate: Bearer` — c'est le test le plus important de la liste.

---

## 7. Limites connues

- **Quinze outils, pas toute la console.** Ce qui n'est pas dans l'API v1 n'est pas
  exposé : SLO, alertes, tableaux de bord, replay, logs, SVI. Les ajouter passe
  par l'API d'abord, jamais par un accès direct depuis le serveur MCP.
- **Pas de total sur les sessions.** L'API n'en fournit pas ; le serveur ne
  l'invente pas. Seuls les groupes d'erreurs, les issues et l'Explorer d'événements
  en renvoient un, mesuré sur la population filtrée.
- **Chaîne de dépendances.** Le SDK MCP tire une centaine de paquets transitifs
  sur un service exposé à l'internet. C'est le coût de ne pas réimplémenter
  JSON-RPC et le transport à la main — mais c'est une surface à surveiller lors
  des montées de version.
- **Pas d'OAuth.** L'authentification est un jeton porteur, comme le reste de
  l'API. La spec MCP prévoit OAuth 2.1 pour les serveurs distants ; ce serait le
  bon chantier suivant si le serveur devait être ouvert au-delà de partenaires
  identifiés.
