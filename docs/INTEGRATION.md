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
| `sampleRate` | `number` 0..1 | `1.0` | Fraction de sessions instrumentées (tirage à l'init ; une session non échantillonnée n'émet rien) |
| `flushIntervalMs` | `number` | `3000` | Intervalle de flush du batch OTLP (un flush immédiat est forcé quand la page passe en arrière-plan) |
| `apiKey` | `string` | — | Clé d'API de l'application, transmise en attribut resource `mip.api_key` (sendBeacon ne porte pas de header). Vérifiée côté ingestion contre le hash sha256 de `app_registry` ; rejet 403 seulement si l'ingestion tourne avec `REQUIRE_API_KEY=true` |
| `requireConsent` | `boolean` | `false` | Mode consentement RGPD : tant que `MIPRum.consent(true)` n'a pas été appelé, **aucune requête réseau ne part** (cf. §3) |
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
- `sampleRate` permet de réduire la volumétrie sur les sites à fort trafic.

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
| Aucune requête réseau du tout | `requireConsent: true` sans appel `MIPRum.consent(true)` ; ou session non échantillonnée (`sampleRate < 1`) ; ou bloqueur de pub | vérifier la CMP ; tester avec `sampleRate: 1` ; servir le SDK et l'ingestion en first-party |
| Données partielles (INP/CLS absents) | l'onglet n'est jamais passé en arrière-plan (ces vitals sont finalisés au `visibilitychange`) | comportement normal ; ils arrivent quand l'utilisateur quitte/masque la page |
| Le SDK ne se charge pas | CSP `script-src` bloquante | cf. §4 |

Vérification rapide de l'endpoint sans navigateur :

```bash
curl -s "https://<ingestion>/v1/traces" -H "content-type: application/json" \
  -d @tests/fixtures/otlp-sample.json
# attendu : {"partialSuccess":{}}
```
