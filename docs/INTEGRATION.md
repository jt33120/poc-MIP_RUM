# Guide d'intégration MIP RUM (v0.2)

Comment instrumenter une application web cliente avec le SDK MIP RUM : snippet, options, consentement RGPD, CSP, et dépannage. Public visé : équipe technique du client (ou intégrateur MIP).

## 0. Par la console (recommandé, v0.5)

Le chemin nominal n'est plus ce document : **Console → Clients → Ajouter un client**. La création génère la clé d'API (affichée une seule fois), autorise les domaines (CORS dynamique, effectif ≤ 60 s, sans redéploiement) et ouvre un wizard qui fournit le snippet prérempli, les middlewares backend téléchargeables (FastAPI, Express), une checklist de vérification **live** et un assistant IA pour les stacks non couvertes. Ce document reste la référence détaillée des options.

## 1. En bref

Deux balises `<script>` dans le `<head>`, rien d'autre à modifier :

```html
<!-- MIP RUM -->
<script src="https://<console>/mip-rum.js"></script>
<script>
  MIPRum.init({
    endpoint: "https://<ingestion>/v1/traces",
    appId: "mon-app",
    clientId: "mon-client",
    env: "prod",
    apiKey: "<clé fournie par MIP>"
  });
</script>
```

URLs réelles du POC : SDK `https://mip-rum-console.vercel.app/mip-rum.js`, ingestion `https://mip-rum-console.vercel.app/api/ingest/v1/traces` (cf. [DEPLOY.md](../DEPLOY.md)). Le SDK peut aussi être auto-hébergé : c'est un fichier IIFE statique unique (`packages/rum-sdk/dist/mip-rum.js`), à servir depuis le domaine du client (recommandé : évite les bloqueurs et simplifie la CSP).

Prérequis côté MIP (à faire une fois par application) :
1. Enregistrer l'application dans `app_registry` (`app_id`, `name`, `client_id`, hash sha256 de la clé d'API, `active = true`).
2. Whitelister l'origine du site dans `ALLOWED_ORIGINS` de l'ingestion (edge function + dev-server) — le CORS est en liste blanche stricte, pas de reflet d'origine inconnue.

## 2. Options de `MIPRum.init` (complètes, v0.2)

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `endpoint` | `string` | **requis** | URL OTLP/HTTP JSON de l'ingestion (`…/v1/traces`) |
| `appId` | `string` | **requis** | Identifiant de l'application (doit exister dans `app_registry`) |
| `clientId` | `string` | — | Identifiant du client (groupement, organisation) |
| `env` | `string` | — | Environnement (`prod`, `staging`, `dev`) |
| `sampleRate` | `number` 0..1 | `1.0` | Fraction de sessions **entièrement** collectées (tirage à l'init, persisté par session) |
| `keepOnError` | `boolean` | `true` | Échantillonnage biaisé-erreurs : les sessions hors `sampleRate` ne sont pas jetées mais passent en mode « error-biased » (télémétrie de routine supprimée, **erreurs conservées**, la 1ʳᵉ erreur promeut la session en collecte complète pour la suite). `false` = ancien comportement (session non échantillonnée → rien) |
| `errorSampleRate` | `number` 0..1 | `1.0` | Fraction des sessions hors `sampleRate` gardées sur erreur (n'a d'effet que si `keepOnError`) |
| `flushIntervalMs` | `number` | `3000` | Intervalle de flush du batch OTLP (un flush immédiat est forcé quand la page passe en arrière-plan) |
| `apiKey` | `string` | — | Clé d'API de l'application, transmise en attribut resource `mip.api_key` (sendBeacon ne porte pas de header). Vérifiée côté ingestion contre le hash sha256 de `app_registry` ; rejet 403 seulement si l'ingestion tourne avec `REQUIRE_API_KEY=true` |
| `requireConsent` | `boolean` | `false` | Mode consentement RGPD : tant que `MIPRum.consent(true)` n'a pas été appelé, **aucune requête réseau ne part** (cf. §3) |
| `honorDNT` | `boolean` | `true` | Souveraineté/RGPD : honore les signaux navigateur d'opt-out **Do Not Track** et **Global Privacy Control**. Si un refus est signalé, **aucune collecte** (0 session, 0 requête). Mettre `false` seulement si l'app recueille elle-même un consentement affirmatif via `MIPRum.consent()` (cf. §3) |
| `slowResourceMs` | `number` | `300` | Seuil au-delà duquel une ressource (script, image, fetch…) est reportée comme lente (cap 20 ressources/page) |
| `forms` | `boolean` | `true` | Form analytics : instrumentation des formulaires **au niveau du champ** (ordre de remplissage, temps par champ, abandon). Émet `form.submit` / `form.abandon`. **Ne capte jamais les valeurs** (identifiants + durées ; champs `password` réduits à `[password]`). `false` pour désactiver |
| `beforeSend` | `(attrs, meta?) => attrs \| null` | — | Filtre de dernière chance ; `meta` expose le type/nom d'événement. Le second argument est optionnel pour préserver les callbacks existants. Retourner `null` supprime le span. Les identités, contexte, props et contenus sensibles restent supprimables ; seuls les champs structurels (session/app/trace/type/liaisons) sont restaurés par le SDK. |

API runtime exposée sur `window.MIPRum` :

- `MIPRum.init(config)` — démarre la collecte (idempotent, le 2ᵉ appel est ignoré).
- `MIPRum.consent(granted: boolean)` — accorde/retire le consentement (cf. §3).
- `MIPRum.track(name, props?)` — événement métier custom, ex. `MIPRum.track("partner_search", { results: 12 })`. Émis comme span `track.<name>`, persisté en v0.2 dans la table `rum_event` (props en jsonb).
- `MIPRum.setGlobalContext(context)` — remplace le contexte global des événements futurs.
- `MIPRum.setUser({ id, ...context })` / `setAccount({ id, ...context })` — identité métier. Le brut reste en mémoire navigateur et en transit ; le serveur le remplace par un HMAC-SHA256 cloisonné par `appId` avant toute file ou écriture. En cas de panne avant réception, la file retry conserve l'événement mais omet volontairement l'identité : aucune valeur brute user/account n'entre dans `localStorage`, au prix d'une corrélation d'identité perdue pour cet événement.
- `MIPRum.startView(name, context?)` — démarre une vue nommée, sans remplacer la route normalisée.
- `MIPRum.addAction(name, context?)`, `addTiming(name, timestamp?)`, `addFeatureFlagEvaluation(name, value)` et `addError(error, context?)` — événements manuels typés. `addAction` ne réalise aucune corrélation causale automatique.

Le contexte est un snapshot JSON immuable avec précédence `global < user/account < view < action < événement`.
Les noms/clefs sont bornés à 100 caractères, les chaînes à 500, la profondeur à 4, le total à 64 clefs
et 16 Kio sérialisés. Les champs `mip.*`, de session, trace, app et sampling restent réservés au SDK.
`IDENTITY_HASH_SECRET` doit être configuré sur chaque port d'ingestion : s'il manque, la télémétrie continue
mais les identités user/account sont omises et `/admin/health` affiche un état dégradé.
- `MIPRum.flush()` — force l'export des spans en attente (utile en test).

## 3. Consent mode (RGPD)

Par défaut (`requireConsent: false`), le SDK collecte dès `init` — adapté à un usage interne ou couvert par l'intérêt légitime documenté du client.

Avec une CMP (bannière cookies/consentement) :

```js
MIPRum.init({ /* …options…, */ requireConsent: true });

// au choix de l'utilisateur dans la CMP :
maCMP.onConsent("analytics", (granted) => MIPRum.consent(granted));
```

Comportement :
- `requireConsent: true` sans consentement → **zéro requête réseau** (vérifié par test automatisé).
- `MIPRum.consent(true)` → la collecte démarre/reprend.
- `MIPRum.consent(false)` → la collecte s'arrête.

### Signaux navigateur d'opt-out (DNT / GPC)

Indépendamment de la CMP, le SDK **honore par défaut** (`honorDNT: true`) les signaux navigateur de refus de suivi :

- **Do Not Track** (`navigator.doNotTrack === "1"`, ou `window.doNotTrack === "yes"` sur d'anciens Firefox) ;
- **Global Privacy Control** (`navigator.globalPrivacyControl === true`) — standard actuel, à valeur légale sous CCPA/CPRA et reconnu comme signal de refus RGPD.

Si l'un de ces signaux est présent à l'`init`, **rien n'est collecté** : aucune session n'est créée, aucun listener posé, aucune requête émise. Aucune donnée, même bufferisée.

`honorDNT: false` désactive cette prise en compte automatique — à réserver aux apps qui recueillent un **consentement affirmatif explicite** (susceptible de primer un signal général) et pilotent alors la collecte via `MIPRum.consent()`.

## 4. CSP — Content Security Policy à prévoir

Si le site applique une CSP, deux directives sont concernées :

| Directive | À autoriser | Pourquoi |
|---|---|---|
| `script-src` | l'origine qui sert `mip-rum.js` (ou `'self'` si auto-hébergé) | chargement du SDK |
| `connect-src` | l'origine de l'`endpoint` d'ingestion | `fetch`/`sendBeacon` OTLP |

Exemple (SDK auto-hébergé, ingestion POC) :

```
Content-Security-Policy: script-src 'self' https://mip-rum-console.vercel.app; connect-src 'self' https://mip-rum-console.vercel.app;
```

Note : le snippet d'init inline nécessite que la CSP autorise ce bloc (`'unsafe-inline'`, un nonce, ou déplacer l'init dans un fichier JS du site).

## 5. Poids et impact performance

- Bundle cœur mesuré : **16,3 KB gzip** (45,3 KB raw) — toutes les instrumentations incluses (vitals, erreurs, ressources, long tasks, breadcrumbs, tracing front→back, consent, retry, contexte et événements manuels). Le replay (rrweb) est un bundle séparé chargé à la demande.
- Historique : v0.1 **22,3 KB**, v0.2 **23,8 KB**, puis **27,4 KB** avant l'allègement. Le SDK OpenTelemetry a été remplacé par un émetteur OTLP/HTTP JSON maison (même format sur le fil), d'où la chute à ~12 KB.
- C'est un SDK **OTLP-natif** (vrai OTLP sur le fil, backend remplaçable) — désormais plus léger que les RUM du marché (Sentry ~20 KB, Datadog ~25 KB).
- Émission par batch (flush toutes les `flushIntervalMs`), `sendBeacon`/flush forcé au passage en arrière-plan : pas de requête bloquante pendant la navigation.
- Caps par page pour borner le volume : 20 ressources lentes, 30 long tasks, 50 breadcrumbs.
- `sampleRate` permet de réduire la volumétrie sur les sites à fort trafic. Par défaut (`keepOnError`), l'échantillonnage est **biaisé-erreurs** : on garde 100 % des sessions à incident (via `errorSampleRate`) tout en n'échantillonnant que le trafic nominal — on ne perd jamais une session d'erreur en abaissant `sampleRate`.

  **Ce que l'échantillonnage fait aux chiffres, depuis le 09/09/2026.** Le SDK émet ses deux taux
  (`mip.sample_rate`, `mip.error_sample_rate`) et l'ingestion en dérive la **probabilité d'inclusion
  réelle** de chaque session — pas simplement `1 / sampleRate`, qui serait faux ici : une session
  sans erreur n'apparaît qu'avec la probabilité `sampleRate`, une session avec erreur avec
  `sampleRate + (1 − sampleRate) × errorSampleRate`.

  | | corrigé ? |
  |---|---|
  | sessions, pages vues, taux d'erreur | **oui** — repondérés, ils estiment la population |
  | visiteurs uniques | non — extrapoler un compte de distincts demande une estimation de cardinalité |
  | p75 LCP/INP | **oui**, depuis le 10/09/2026 — somme cumulée sur des seaux pondérés (migration-v61), à ±1 % près |
  | temps de chargement moyen, signaux de frustration | non — moyenne et comptages bruts sur l'échantillon |

  Les champs non corrigés portent sur l'échantillon **seul**, et cet échantillon sur-représente les
  sessions en erreur, donc les plus lentes : ils penchent du côté pessimiste. Les percentiles ont
  cessé d'en faire partie le 10/09/2026 : `percentile_cont` n'accepte pas de poids, mais une somme
  cumulée sur une distribution en seaux n'en a pas besoin — le poids est DANS le seau. Le prix payé
  est une résolution de ±1 % (soit ±25 ms sur un LCP de 2 500 ms), pas un biais.
  L'API le déclare dans `sampling_notice` et la console l'affiche ; ce n'est pas au lecteur de le
  deviner. Avant cette date, aucun de ces chiffres n'était corrigé ni signalé : à `sampleRate: 0.1`,
  un taux d'erreur réel de 1 % s'affichait autour de 9 %.

### Normaliser les routes d'une application

`normalizeRoute` (SDK) remplace les entiers, les UUID et les hexadécimaux longs. Il ne connaît ni
vos slugs, ni vos références de commande — sur un catalogue, chaque page produit alors sa propre
statistique, c'est-à-dire aucune statistique.

Depuis le 10/09/2026, chaque application peut ajouter ses règles (`route_pattern`, expressions
rationnelles POSIX, appliquées **en base** donc quel que soit le chemin d'ingestion) :

```sql
insert into route_pattern (app_id, motif, remplacement, priorite)
values ('mon-app', '^/produit/[^/]+$', '/produit/:slug', 10);
```

Le **premier** motif qui correspond gagne (ordre `priorite`, puis `id`) ; les motifs ne s'enchaînent
pas. Les groupes de capture fonctionnent (`\1`).

**Rejouer l'historique.** Une règle ajoutée aujourd'hui ne réécrit pas hier : la série d'une route se
couperait en deux, et les deux moitiés auraient l'air de deux routes différentes. On regarde d'abord
ce que ça changerait, puis on écrit :

```sql
select * from mip_apercu_backfill('mon-app');   -- n'écrit rien
select backfill_route_patterns('mon-app');      -- DÉFINITIF
```

La réécriture est **irréversible** : la route d'origine n'est conservée nulle part. Un motif trop
large détruit du détail sans retour possible — d'où l'aperçu.

**Le plafond.** Au-delà de `app_registry.route_limit` routes distinctes (2 000 par défaut), une route
**inédite** est enregistrée sous `(other)`. Les routes déjà connues continuent de passer : le plafond
arrête la croissance de la dimension, il ne casse pas les séries en cours. `/admin/health` affiche le
nombre d'applications au plafond ; la réponse est d'écrire des motifs, pas de relever le plafond.

Coût mesuré sur le chemin d'écriture : 8 à 16 µs par ligne insérée selon les exécutions
(`scripts/bench-route-trigger.mjs`), soit 0,1 à 0,2 ms sur un beacon d'une douzaine de lignes.

### Ingestion différée (`INGEST_DEFERRED`) — optionnelle, et pas gratuite

Par défaut, le receveur écrit le lot dans les tables finales avant de répondre 200. Avec
`INGEST_DEFERRED=true`, il le débarque dans `ingest_raw` et un travailleur (dans le même processus,
toutes les 250 ms par défaut, `INGEST_DRAIN_MS`) écrit la suite.

Mesuré par `scripts/bench-ingest.mjs` (vrai receveur, vrai PostgreSQL, 400 requêtes × 12 en vol,
lot de 17 spans, modes alternés) :

| | p50 | p95 | débit |
|---|---|---|---|
| synchrone | ~15 ms | ~22 ms | ~770 req/s |
| différé | ~6 ms | ~11 ms | ~1 900 req/s |

Soit **p95 divisé par deux et débit multiplié par 2,5** environ — les chiffres bougent d'une
exécution à l'autre, la fourchette mesurée est −48 à −57 % sur le p95.

**Le prix.** `ingest_raw` est une table **UNLOGGED** : PostgreSQL la vide après un arrêt brutal. Un
lot acquitté `200` mais pas encore drainé est alors **perdu, définitivement et sans trace**. C'est
acceptable pour de la télémétrie d'audience — on perd quelques secondes de mesures — et ça ne l'est
pas pour de la donnée dont dépend une décision. D'où le mode optionnel, éteint par défaut.

`/admin/health` affiche la file en attente, les lots abandonnés (cinq échecs d'écriture) et l'âge du
plus vieux. Une file qui monte n'est pas un détail de performance : c'est la quantité de données
qu'un redémarrage emporterait. `GET /health` du service d'ingestion annonce `ingest_deferred`.

## 6. RGPD — ce qui est collecté, ce qui est anonymisé

Collecté (par session) :

| Donnée | Détail |
|---|---|
| Web Vitals | LCP, INP, CLS, FCP, TTFB + attribution technique (élément, timings) |
| Pageviews | **routes normalisées** (`/partners/:id` — les ids numériques/uuid/hex sont remplacés), type de navigation |
| Erreurs JS | message (tronqué à 1 000 c.), type, stack (tronquée à 4 000 c.), fichier source |
| Ressources lentes | URL **sans query string**, type, durée, taille transférée |
| Long tasks | durée |
| Breadcrumbs | type (click/nav/error/custom) + label court |
| Événements `track()` | nom + props fournies par le site |
| Session | `visitor_id` (**tiré au hasard** par le SDK, persisté en `localStorage`, sans lien avec le terminal), user-agent, type de device |

> **Changement du 09/09/2026.** Le SDK émettait auparavant un `user_hash` : un FNV-1a
> de (user-agent + langue + résolution + fuseau). Il était décrit ici comme « anonymisé
> et non réversible » — c'était faux dans les deux sens. Non réversible, oui ; mais il
> ne désignait pas une personne (deux postes identiques d'un même parc obtenaient la
> même valeur) et il était réidentifiant par recoupement, puisque entièrement dérivé
> de caractéristiques du terminal. Il est remplacé par un tirage aléatoire, qu'un
> visiteur peut effacer en vidant le stockage local de son navigateur. Voir
> `apps/ingest/sql/migration-v57.sql`.

Garanties :
- **Aucune PII par construction** : pas de nom, email, IP stockée ; pas de cookie (session en `localStorage`, TTL 30 min d'inactivité) ; l'identifiant de visiteur est un tirage aléatoire, sans lien avec le terminal ni avec un compte.
- **Scrub des URLs en double rideau** : query strings et fragments retirés côté SDK **et** côté ingestion.
- `beforeSend` = point de filtrage final côté client (ex. masquer un label de breadcrumb sensible).
- **Rétention 30 jours** (purge quotidienne automatique, v0.2).
- Hébergement UE (Supabase Paris, eu-west-3) ; architecture auto-hébergeable on-prem.
- Consent mode disponible (§3) si la base légale du client l'exige.

À la charge du client : mentionner la mesure d'audience/performance dans sa politique de confidentialité, et brancher le consent mode si sa CMP le requiert.

## 7. FAQ dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Erreur CORS dans la console navigateur (`blocked by CORS policy`) | origine du site absente de la liste blanche | ajouter l'origine dans `ALLOWED_ORIGINS` (edge function `v1-traces` + dev-server) et redéployer |
| `403` sur les POST | `REQUIRE_API_KEY=true` côté ingestion et `apiKey` absente/incorrecte, ou app `active=false` | vérifier la clé fournie vs le hash en `app_registry` ; vérifier `active` |
| `401` sur les POST | edge function déployée **sans** `--no-verify-jwt` | redéployer avec `--no-verify-jwt` (les beacons n'ont pas de header Authorization) |
| POST `200` mais **rien en base** | `appId` manquant ou inconnu (payload sans `mip.app_id` rejeté silencieusement) | vérifier `appId` dans `MIPRum.init` et l'enregistrement dans `app_registry` |
| `429` sur les POST | rate limit dépassé (600 req/min/app) | vérifier qu'il n'y a pas de boucle d'émission ; augmenter `flushIntervalMs` ; réduire `sampleRate` |
| Aucune requête réseau du tout | `requireConsent: true` sans appel `MIPRum.consent(true)` ; ou session en mode « error-biased » sans erreur (collecte de routine supprimée) ou « off » (`keepOnError: false` + hors `sampleRate`) ; ou bloqueur de pub | vérifier la CMP ; tester avec `sampleRate: 1` ; servir le SDK et l'ingestion en first-party |
| Données partielles (INP/CLS absents) | l'onglet n'est jamais passé en arrière-plan (ces vitals sont finalisés au `visibilitychange`) | comportement normal ; ils arrivent quand l'utilisateur quitte/masque la page |
| Le SDK ne se charge pas | CSP `script-src` bloquante | cf. §4 |

Vérification rapide de l'endpoint sans navigateur :

```bash
curl -s "https://<ingestion>/v1/traces" -H "content-type: application/json" \
  -d @tests/fixtures/otlp-sample.json
# attendu : {"partialSuccess":{}}
```

## 8. Déploiement zéro-touch — injection front (v0.6)

Quand le client ne peut pas (COTS, legacy, équipe tierce) ou ne veut pas modifier son code source, le snippet est **injecté depuis l'infrastructure**. La console génère les trois configurations préremplies (page du client → étape 2 → « Injection zéro-touch »). Aucune n'embarque la clé d'API (clé front optionnelle, enforcement off) : elles ne font que poser les deux balises `<script>`.

| Point d'injection | Quand | Couvre la CSP ? | Remarque |
|---|---|---|---|
| **Cloudflare Worker** (HTMLRewriter) | site derrière Cloudflare, ou CF qu'on met devant | **Oui** (réécrit `script-src` + `connect-src`) | recommandé — le plus robuste, le seul qui corrige la CSP |
| **nginx** (`ngx_http_sub_module`) | le HTML passe par un nginx qu'on opère | manuel (`add_header`) | `sub_filter '</head>' '<balises></head>'` + `proxy_set_header Accept-Encoding ""` (sinon le HTML gzip n'est pas réécrit) |
| **Google Tag Manager** | le client a déjà GTM | **Non** (la CSP du site doit déjà autoriser le SDK + l'ingestion) | self-service ; chargement async → premières métriques (TTFB/FCP) parfois partielles |

Cas **SPA statique** (Vercel/Netlify/S3, ex. plateforme.groupement-it.com) : il n'y a pas de proxy HTML dans la chaîne pour faire du `sub_filter`. Options : mettre un Cloudflare devant le domaine (Worker ci-dessus), injecter au build (post-build sur `dist/index.html`), ou — le plus simple quand on a le repo — poser le snippet en dur. L'injection externe coûte alors **plus** que deux balises.

Dans tous les cas : ajouter l'origine du site aux **domaines autorisés** de l'app dans la console (CORS dynamique, effectif ≤ 60 s).

## 9. Backend sans code — auto-instrumentation OpenTelemetry (v0.6)

Le tracing front→back (la décomposition navigateur / réseau / serveur) n'exige pas forcément le middleware MIP. Tout backend instrumentable par un **agent d'auto-instrumentation OpenTelemetry** (Python, Java, .NET, Go, Node, Ruby, PHP…) peut alimenter l'ingestion **sans une ligne de code applicatif** — l'ingestion accepte nativement les spans serveur OpenTelemetry standard (attributs semconv `http.route` / `http.request.method` / `http.response.status_code`, `kind=SERVER`, trace/span/parent au niveau du span, session propagée via `tracestate: mip=s:<id>`).

Architecture : `app sous agent OTel → Collector → ingestion MIP`.

1. **Lancer l'app sous son agent** (zéro code). Exemple Python :
   ```bash
   pip install opentelemetry-distro opentelemetry-exporter-otlp
   opentelemetry-bootstrap -a install
   OTEL_SERVICE_NAME=<app_id> \
   OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318" \
   opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000
   ```
2. **Le Collector** (`otel-collector.yaml`, téléchargeable sur la page du client) absorbe le format de l'agent et réémet vers MIP : il ne garde que les spans `SERVER` (un par requête), injecte `mip.app_id` + `mip.api_key` (l'app n'a rien de spécifique à régler), et exporte en `otlphttp encoding: json` vers l'endpoint d'ingestion.

| Choix | Middleware MIP (`§3`) | Auto-instrumentation OTel + Collector |
|---|---|---|
| Modification du code | 1 fichier + 3 lignes de wiring | aucune |
| Composant à exploiter | aucun | 1 Collector (conteneur) |
| Stacks | FastAPI/Express prouvés, autres via protocole | toute stack avec un agent OTel |
| Recommandé quand | on a accès au code du backend | backend non modifiable / multi-langages |

Note Node : les agents JavaScript exportent déjà de l'OTLP/HTTP JSON ; le Collector y est optionnel (l'app peut viser directement l'endpoint), mais il reste utile pour filtrer les spans serveur et injecter l'identité MIP.
