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

URLs réelles du POC : SDK `https://mip-rum-console.vercel.app/mip-rum.js`, ingestion `https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces` (cf. [DEPLOY.md](../DEPLOY.md)). Le SDK peut aussi être auto-hébergé : c'est un fichier IIFE statique unique (`packages/rum-sdk/dist/mip-rum.js`), à servir depuis le domaine du client (recommandé : évite les bloqueurs et simplifie la CSP).

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
| `beforeSend` | `(attrs) => attrs \| null` | — | Filtre de dernière chance appliqué aux attributs de chaque span avant émission ; retourner `null` supprime le span. C'est le point d'extension PII côté client |

API runtime exposée sur `window.MIPRum` :

- `MIPRum.init(config)` — démarre la collecte (idempotent, le 2ᵉ appel est ignoré).
- `MIPRum.consent(granted: boolean)` — accorde/retire le consentement (cf. §3).
- `MIPRum.track(name, props?)` — événement métier custom, ex. `MIPRum.track("partner_search", { results: 12 })`. Émis comme span `track.<name>`, persisté en v0.2 dans la table `rum_event` (props en jsonb).
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
Content-Security-Policy: script-src 'self'; connect-src 'self' https://nupxrdpsliqptqnjkmgw.supabase.co;
```

Note : le snippet d'init inline nécessite que la CSP autorise ce bloc (`'unsafe-inline'`, un nonce, ou déplacer l'init dans un fichier JS du site).

## 5. Poids et impact performance

- Bundle v0.1 mesuré : **22,3 KB gzip** (67,6 KB raw). Bundle v0.2 mesuré : **23,8 KB gzip** (71,5 KB raw) — resource timings + long tasks + breadcrumbs + consent + retry inclus.
- C'est le coût d'un SDK **OTel-natif** (vrai OTLP sur le fil, backend remplaçable) — comparable aux RUM du marché, au-dessus d'un simple script analytics.
- Émission par batch (flush toutes les `flushIntervalMs`), `sendBeacon`/flush forcé au passage en arrière-plan : pas de requête bloquante pendant la navigation.
- Caps par page pour borner le volume : 20 ressources lentes, 30 long tasks, 50 breadcrumbs.
- `sampleRate` permet de réduire la volumétrie sur les sites à fort trafic. Par défaut (`keepOnError`), l'échantillonnage est **biaisé-erreurs** : on garde 100 % des sessions à incident (via `errorSampleRate`) tout en n'échantillonnant que le trafic nominal — on ne perd jamais une session d'erreur en abaissant `sampleRate`.

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
| Session | `user_hash` (empreinte **anonymisée**, non réversible), user-agent, type de device |

Garanties :
- **Aucune PII par construction** : pas de nom, email, IP stockée ; pas de cookie (session en `localStorage`, TTL 30 min d'inactivité) ; pas d'identifiant utilisateur réversible.
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
