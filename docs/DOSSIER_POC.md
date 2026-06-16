# Dossier POC — MIP RUM (Real User Monitoring souverain, OTel-native)

> Document de présentation produit + audit de scalabilité. État au 13/06/2026.
> Public : direction, commerce, et lecteurs techniques (chaque section a les deux niveaux).

---

## 1. En bref

**MIP RUM mesure la performance et les erreurs réellement vécues par les
utilisateurs d'un site/d'une application web, en production.** Pas une simulation
en laboratoire : la vraie expérience, sur les vrais navigateurs des vrais
visiteurs.

Trois partis pris qui font la différence :

- **OpenTelemetry-natif** : format standard ouvert de bout en bout → **zéro
  enfermement fournisseur**, compatible avec l'écosystème observabilité existant.
- **Souverain UE** : hébergement Paris, **aucune adresse IP stockée**, géo par
  fuseau horaire, scrubbing des données personnelles — RGPD by design.
- **Zéro-touch possible** : on peut instrumenter un site **sans modifier son
  code** (injection JS via proxy/CDN/GTM).

---

## 2. Stack technique

| Couche | Techno | Rôle |
|---|---|---|
| **SDK navigateur** | TypeScript, build IIFE (~quelques Ko), zéro dépendance runtime | Capte Core Web Vitals, erreurs JS, sessions, ressources, long tasks, breadcrumbs, appels API (spans `http.client`), replay |
| **Replay** | `rrweb` (chargé en lazy, opt-in par app) | Reconstruction visuelle du parcours (instantanés DOM, pas de vidéo), masquage des saisies par défaut |
| **Transport** | OTLP/HTTP JSON (OpenTelemetry Protocol), `navigator.sendBeacon` | Émission standard, survit à la fermeture d'onglet ; file de retry offline |
| **Ingestion** | Edge Function **Deno** (Supabase) en prod ; miroir **Node** (`dev-server`) en local/CI | Parse l'OTLP → Postgres ; CORS, clé d'API, rate limit, garde-fous de taille, retries, logs structurés |
| **Tracing backend** | Middleware **FastAPI/Starlette** (stdlib) **ou** Express **ou** agent **OpenTelemetry codeless** + Collector | Émet le span serveur `http.server`, corrélé au front par `trace_id` (W3C `traceparent`) |
| **Stockage** | **PostgreSQL** (Supabase, région Paris) ; chemin **ClickHouse** prouvé (cf. §7) | Sessions, vitals, erreurs, spans, replay (bytea), synthétique |
| **Console** | **Next.js 15** (App Router, React 19) sur Vercel, `recharts` | Dashboards temps réel (refresh 5 s), RBAC, lecture seule `console_ro` (TLS épinglé) |
| **Alerting** | Règles SQL + `pg_net` (cloud) **ou** dispatcher Node (local), payload Slack | Webhooks sur seuils, rejeu borné avec backoff |
| **Injection zéro-touch** | Cloudflare Worker (HTMLRewriter) / nginx `sub_filter` / tag GTM | Pose le SDK sans toucher au code du site |
| **Assistant intégration** | Mistral (souverain, prioritaire) ou Anthropic, admin-only | Génère le code d'instrumentation pour une stack non couverte |

**Pipeline** : `navigateur → SDK → OTLP/HTTP → ingestion → Postgres → console`.
Le tracing ajoute `middleware/agent backend → même endpoint OTLP → table rum_span`.

---

## 3. Ce que le POC couvre — et comment

| Capacité | Ce qu'on voit | Comment (mécanisme) |
|---|---|---|
| **Core Web Vitals réels** | LCP, INP, CLS, FCP, TTFB au **p75**, seuils 2026, tendance | `PerformanceObserver` du navigateur → spans `webvital.*` → agrégat SQL `percentile_cont(0.75)` |
| **Score de santé** | Note /100 composite, facteurs dominants | 40 % vitals · 30 % erreurs · 20 % stabilité · 10 % anomalies 24 h |
| **Détection d'anomalies** | Alertes auto de dégradation | z-score (|z|>3) du LCP p75 horaire vs moyenne 7 j glissants (vue SQL, sans ML externe) |
| **Erreurs JS regroupées** | « 12 problèmes » triés par impact, pas 5 000 lignes | Fingerprint FNV-1a (type + message normalisé + 1er frame), URLs/UUID/nombres masqués |
| **Sessions & replay** | Parcours réels, rejouables visuellement | Upsert `rum_session` (pays par timezone, jamais d'IP) + chunks `rrweb` gzip |
| **Tracing front → back** | Décomposition réseau / serveur d'un appel, % corrélé | `traceparent` W3C propagé par le SDK, relu par le middleware/agent → join par `trace_id` |
| **Alerting** | Notification Slack/Teams sur seuil | Règle (métrique/route/fenêtre/comparateur) → webhook, rejeu borné |
| **Corrélation robot vs réel** | Écart monitoring synthétique ↔ utilisateurs réels | Vue `v_correlation` p75 robot vs RUM par route |
| **Multi-tenant / RBAC** | Plusieurs apps, rôles admin/viewer scopés | Registre d'apps, login bcrypt+JWT httpOnly, `audit_log` |
| **Onboarding client self-service** | Création d'app + clé + origines CORS à chaud | `/admin/customers`, CORS dynamique (≤ 60 s), wizard + assistant IA |

---

## 4. Modes de déploiement (le « zéro-touch »)

### Front (RUM navigateur) — **sans modifier le code du client**
Trois points d'injection des 2 balises `<script>` dans le `<head>` :

| Méthode | Corrige la CSP ? | Notes |
|---|---|---|
| **Cloudflare Worker** (HTMLRewriter) | ✅ (le seul) | Idéal ; réécrit aussi la Content-Security-Policy |
| **nginx** `ngx_http_sub_module` | ❌ | `sub_filter '</head>'` + `proxy_set_header Accept-Encoding ""` |
| **Tag GTM** (HTML perso, All Pages) | ❌ | Self-service mais async (premières TTFB/FCP parfois partielles) |

> SPA 100 % statique (Vercel/Netlify/S3) sans proxy HTML : Cloudflare devant le
> domaine, injection au build, ou snippet en dur. Et : **ajouter l'origine du
> site aux origines autorisées** de l'app côté MIP (CORS, à chaud).

### Backend (tracing serveur) — **une étape côté backend**
Le span serveur et la corrélation `trace_id` ne sont **pas** zéro-touch côté
navigateur seul. Deux options :
- **Middleware** (FastAPI/Express) : 1 fichier, sans dépendance, jamais d'exception
  vers l'app hôte ;
- **Codeless OpenTelemetry** : lancer l'app sous l'agent OTel + un Collector qui
  injecte `mip.app_id` et exporte en OTLP — **sans modifier le code**, mais il faut
  maîtriser le lancement du process / disposer d'un Collector.

**Sans aucune action backend** : on a quand même la **vue navigateur** des appels
API (latence perçue, statut, endpoint) — mais pas la part serveur vs réseau, et la
couverture tracing reste à 0 %.

---

## 5. Ce que le POC ne couvre pas (volontairement, à ce stade)

| Manque | Pourquoi / horizon |
|---|---|
| **SDK mobile natif** (iOS/Android) | Web uniquement ; deux SDK à maintenir — Phase 3 |
| **Tracing multi-saut / microservices** | Aujourd'hui **1 saut** (front→1 backend). Le multi-hop passe par le Collector OTel (l'archi l'accepte déjà) — chantier dédié |
| **Spans base de données / requêtes SQL** | Pas de span DB ni propagation backend→backend |
| **Branchement API DEM réelle (Ekara/mippoc)** | Corrélation prouvée sur seed/export ; interface `SyntheticSource` prête, brancher dès accès |
| **ML avancé** | z-score statistique (assumé, explicable) ; saisonnalité/forecast = R&D |
| **Multi-région / haute dispo / SLA** | Une seule région UE aujourd'hui |
| **Certifications (SOC2, ISO 27001, CSPN)** | Processus longs — décision MIP |
| **Test de charge cloud réel** | ~4 000 events/s **en local** vérifiés ; le free tier sous vraie charge reste à éprouver |

---

## 6. Exemples d'application (types de clients & cas d'usage)

| Profil client | Cas d'usage MIP RUM | Valeur |
|---|---|---|
| **Site vitrine / média / e-commerce** | Vitals réels, pages lentes, erreurs JS, alertes | Conversion & SEO (Google classe sur les Web Vitals) ; voir ce qui fait fuir |
| **Plateforme métier B2B** (ex. groupement-it) | Sessions + replay des parcours, tracing front→back sur les workflows clés | Réduire les tickets support, prouver où part le temps (réseau/serveur/code) |
| **SaaS / portail interne** (milliers de collaborateurs) | RUM + tracing sur les écrans critiques, RBAC par équipe | Productivité interne : une appli lente = du temps perdu × N agents |
| **DSI / ESN multi-clients** | Multi-tenant : 1 console, N apps, origines à chaud | Mutualiser l'observabilité, offre managée |
| **Agence / intégrateur** | Injection zéro-touch sur sites COTS/legacy/tiers | Instrumenter sans accès au code source |
| **Acteur souveraineté** (public, santé, défense) | Hébergement UE, pas d'IP, OTel ouvert, ClickHouse auto-hébergeable | Conformité & indépendance fournisseur |

---

## 7. Audit de scalabilité

> Question directe : « là on fait des petits sites — et un client avec des
> milliers de collaborateurs et des apps bien plus complexes ? »

### 7.1 Le volume dépend des **pages vues/jour**, pas du nombre de collaborateurs
Le coût technique est piloté par le trafic, pas la taille de l'entreprise. Repère
mesuré (cf. `infra/clickhouse.notes.md`) pour **1 M pages vues/jour** :

| Table | Lignes/jour | Disque/jour (ClickHouse) |
|---|---|---|
| rum_metric (×5 vitals) | 5,0 M | ~60 MB |
| rum_pageview | 1,0 M | ~15 MB |
| rum_session | 0,33 M | ~5 MB |
| rum_error | 0,02 M | <1 MB |
| **Total** | **~6,4 M events/jour** | **~80 MB/jour → ~2,4 Go / 30 j** |

Débit moyen **~74 events/s**, pics ×10 ≈ **750/s**. Or le writer ClickHouse mesuré
encaisse **~88 000 lignes/s sur une seule connexion non tunée** → **marge ×100**.
Un nœud modeste absorbe **plusieurs clients de cette taille**.

> « Des milliers de collaborateurs » sur un portail interne génèrent typiquement
> de quelques centaines de milliers à quelques millions de pages vues/jour : **on
> est dans l'enveloppe ci-dessus, très loin du plafond technique de l'archi cible.**

### 7.2 Où le POC actuel (Postgres free tier) plie, et pourquoi
Le POC stocke en **Postgres** (Supabase free tier, mono-région). Limites réelles :

- **Requêtes qui scannent large** : `percentile_cont` (p75) et `count(distinct
  session_id)` trient en mémoire. Mesuré : la requête top-routes passe de **138 ms
  à 100 k lignes** à **plusieurs secondes au milliard de lignes** — c'est elle qui
  casse en premier.
- **Disque** : ~178 B/ligne avec index → **~34 Go / 30 j par client** à 1 M pv/jour
  (vs 2,4 Go en ClickHouse, **×15 plus compact**).
- **Rate limit** par défaut **600 req/min/app** (durable, partagé) — à relever pour
  un gros client (config, pas de refonte).
- **Free tier & mono-région** : pas de SLA, pas de HA, charge cloud réelle non
  encore éprouvée (limite #27).

**Conclusion** : Postgres convient au POC et aux petits/moyens sites. **Pour un gros
compte, ce n'est pas l'architecture qui bloque — c'est le store de démo.**

### 7.3 Le chemin de montée en charge est **déjà prouvé** (pas une promesse)
ClickHouse (Apache-2.0, **auto-hébergeable** → argument souveraineté) a été
**benché en local** (11/06/2026), résultats mesurés ligne à ligne :

- **Égalité des p75 exacte (Δ = 0)** PG ↔ CH (`quantileExactInclusive` =
  `percentile_cont`) → **la console migre sans renuméroter ses graphes**.
- Requêtes qui scannent large : **×2,2** (série horaire 7 j) à **×12**
  (`count(distinct)`) plus rapides en CH. L'écart **croît avec le volume**.
- **×15 plus compact** sur disque, insertion **~88 k lignes/s** sans tuning.

**Migration en 5 crans, rien ne change côté client** (le SDK et la sémantique
`mip.*` ne bougent pas — « OTLP fidèle sur le fil ») :
1. Déployer **OTel Collector + ClickHouse** (on-prem ou cloud souverain).
2. Pointer le snippet sur le Collector (`endpoint:` dans `MIPRum.init`) — **seul**
   changement client.
3. Transposer le parser `flattenOtlp` en processor Collector / vues CH.
4. Brancher la console sur CH (couche « dialecte » ~50 lignes, équivalences prouvées).
5. Décommissionner la fonction serverless.

Pour le **multi-milliards** : Materialized View `AggregatingMergeTree`
(`quantileTDigestState` par heure) + TTL 30 j — déjà documenté dans le schéma cible.

### 7.4 « Apps beaucoup plus complexes » — les autres axes
| Axe de complexité | Aujourd'hui | Pour aller plus loin |
|---|---|---|
| **Beaucoup de routes** | OK (templates `/x/:id`) | `LowCardinality` CH absorbe les routes répétées sans coût |
| **Microservices backend** | 1 saut tracé | Agent OTel + Collector sur chaque service (propagation `trace_id` standard) |
| **Spans DB / cache / file** | Non | Auto-instrumentation OTel (codeless) côté services |
| **Gros volume de replay** | PG bytea, caps 2 min/1 Mo, opt-in | Bascule **object storage** (S3 souverain), volumétrie indépendante du store métrique |
| **Pics de charge** | Rate limit + batch | Rate limit relevable ; Collector tamponne et lisse les pics |
| **HA / multi-région / SLA** | Mono-région | Réplication CH + Collector redondant — chantier infra |

### 7.5 Verdict d'audit
- **Prêt aujourd'hui** : petits et moyens sites, plateformes B2B, portails internes
  jusqu'à ~quelques millions de pages vues/jour **moyennant la bascule store** (POC =
  Postgres, cible = ClickHouse, chemin prouvé Δ=0).
- **Le SDK, le protocole (OTLP) et la sémantique ne changent pas** quand on scale —
  c'est la force de l'archi OTel-native : on remplace le store et le transport
  derrière, le client ne voit rien.
- **Chantiers à financer pour le grand compte** : déploiement ClickHouse prod +
  test de charge cloud réel, multi-région/HA, tracing multi-saut, et — souvent
  éliminatoire en AO — les **certifications**.

---

## 8. Synthèse en une page

| | |
|---|---|
| **Ce que c'est** | RUM + tracing **souverain, OTel-native**, instrumentable **sans toucher au code** (front) |
| **Couvre** | Vitals réels, erreurs groupées, sessions+replay, tracing front→back, alertes, corrélation robot/réel, multi-tenant/RBAC |
| **Ne couvre pas (encore)** | Mobile natif, multi-saut/DB spans, API DEM réelle, ML avancé, multi-région/HA, certifications |
| **Scale petit→moyen** | Postgres actuel suffit |
| **Scale grand compte** | Bascule **ClickHouse** (prouvée Δ=0, ×15 compact, ~88 k l/s, marge ×100 à 1 M pv/jour) — **migration invisible côté client** |
| **Vrai facteur limitant** | Pas l'architecture : le **store de démo** + l'**infra de prod** (HA, multi-région, certifs) à financer |

*Références internes : `docs/LIMITES.md` (limites détaillées), `docs/REVUE_POC.md`
(revue d'ingénierie), `infra/clickhouse.notes.md` (bench reproductible).*
