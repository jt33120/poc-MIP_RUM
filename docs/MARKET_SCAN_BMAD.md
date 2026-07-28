# Market Scan BMAD — MIP RUM

**Document de cadrage produit et architecture — juillet 2026**
Auteur : PM / architecte principal (méthode BMAD)
Statut : version 1.0, destinée au dépôt (`docs/MARKET_SCAN_BMAD.md`)
Périmètre : 6 segments de marché scannés puis vérifiés sur sources primaires, croisés avec deux analyses d'écart (produit + architecture) fondées sur un audit de code du monorepo.

**Convention de lecture.** Ce document distingue trois niveaux de fiabilité :
- **VÉRIFIÉ** : lu sur une source primaire (page produit officielle, documentation éditeur, dépôt de code, texte réglementaire, fichier du monorepo).
- **REVENDICATION ÉDITEUR** : seul le discours du vendeur est établi, pas sa véracité.
- **À CONFIRMER** : plausible, non établi. Ne pas utiliser en argumentaire externe sans vérification.

---

## 1. Résumé exécutif

### 1.1 Les cinq enseignements majeurs

**① Le session replay et le « privacy by default » ne sont plus des différenciateurs. Ce sont des table-stakes.**
La barrière technique s'est effondrée : rrweb est open source, Grafana publie `@grafana/faro-instrumentation-replay` en Apache-2.0 avec `maskAllInputs: true` et `maskTextSelector: '*'` **par défaut depuis juin 2026** (VÉRIFIÉ, CHANGELOG v2.3.0), Datadog est en `defaultPrivacyLevel = mask` par défaut avec masquage **inconditionnel et non désactivable** des champs password / email / tel / autocomplete CB (VÉRIFIÉ), Sentry masque tout le texte et bloque huit types de médias par défaut (VÉRIFIÉ). Et AWS a ajouté le Session Replay à CloudWatch RUM en mai 2026 **sans coût additionnel** (VÉRIFIÉ). Conséquence directe : notre replay rrweb + `maskAllInputs` ne vend rien, et il est même *en retrait* du standard (nous ne masquons ni le texte ni les médias). Ce qui reste rare et défendable : le **lecteur corrélé** (erreur → replay horodaté → trace serveur → requête DB sur un seul `trace_id`), la **rétention différenciée par finalité** et la **preuve opposable** de masquage.

**② L'IA de diagnostic auto-hébergeable est un segment structurellement vide — et nous l'occupons déjà.**
Sentry **exclut Seer et l'intégralité de sa couche AI/ML de l'édition self-hosted**, pour raison de licence (VÉRIFIÉ, `develop.sentry.dev/self-hosted`). OpenReplay affiche encore ses « AI Agents » en *coming soon* sur le tier Enterprise en juillet 2026 (VÉRIFIÉ). LogRocket réserve le self-host **et** Galileo à l'Enterprise. Datadog (Bits), Dynatrace (Assist) et Grafana (Assistant) sont SaaS-only. Le raisonnement se referme : les organisations les plus contraintes réglementairement sont exactement celles qui doivent auto-héberger, donc exactement celles auxquelles Sentry ne *peut pas* vendre d'agent de debug. Nous avons l'actif — assistant LLM souverain à **citations vérifiées côté serveur** — et personne ne documente de mécanisme de *grounding* auditable.

**③ Le marché souverain est ouvert par le droit, pas par la technique — et le calendrier est déjà en cours.**
Décret n° 2026-272 du 14/04/2026, en vigueur le 17/04/2026, rendant opposable un référentiel ANSSI de niveau SecNumCloud-ou-équivalent pour l'État, ses opérateurs et six GIP nommés (VÉRIFIÉ). Circulaire interministérielle Bercy du 05/02/2026 faisant de la souveraineté un critère essentiel des achats IT. CADA proposé le 03/06/2026 introduisant des *Union assurance levels* dans la commande publique cloud. Face à cela : Datadog n'a **aucune** option on-premise, et la génération Grail de Dynatrace (New RUM Experience, Users & Sessions, Error Inspector, DQL) est **SaaS-only par architecture** — Grail n'est pas sur la roadmap Dynatrace Managed (VÉRIFIÉ). Le créneau est réel. Mais il exige un produit *complet* auto-hébergeable : livrer l'ingestion sans la console reproduit mot pour mot le reproche qui coûte le plus cher à Grafana Faro — « en self-host on récupère la donnée, pas le produit ».

**④ Notre revendication « OTel-native, donc réversible » est aujourd'hui techniquement fausse, et c'est le défaut le plus grave du dossier.**
`packages/rum-sdk/src/otel.ts:109-110` génère un `traceId` **et** un `spanId` **aléatoires pour chaque span**. Le vrai contexte W3C — celui injecté dans le header `traceparent` — est placé dans des attributs propriétaires `mip.trace_id` / `mip.span_id` (`apispans.ts:67-68`). Aucun `parentSpanId`, aucun `kind`, aucun `status`, aucun `flags` n'est émis. Cela fonctionne, mais **uniquement avec notre propre parseur**. Un Collector OTel, Tempo, Jaeger ou toute intake OTLP tierce verrait N traces mono-span sans lien. La phrase du runbook `infra/clickhouse/DEPLOY.md` — « seul changement côté client : l'endpoint » — ne tient pas. Aggravant : la clé d'API voyage comme attribut de *resource* dans le corps JSON (`otel.ts:87`, `mip.api_key`), donc elle atterrit dans les logs de tout Collector intermédiaire. C'est un correctif d'ampleur **moyenne** qui débloque simultanément la crédibilité standards, le chemin Collector, le scale ClickHouse et l'OEM.

**⑤ Le récit commercial « votre facture d'observabilité explose » n'est pas soutenu par les données.**
L'enquête Grafana Labs Observability 2026 (4ᵉ édition, 1 300+ répondants, 76 pays, terrain oct. 2025 – janv. 2026, VÉRIFIÉ via communiqué officiel du 18/03/2026) classe le coût en **troisième** préoccupation (31 %), derrière la complexité et la surcharge (38 %) et le rapport signal/bruit (34 %). La moitié des répondants prévoient de dépenser davantage, mais seul **un quart** incrimine la hausse des prix vendeurs — les moteurs réels sont l'élargissement de l'adoption (63 %) et l'attente d'un meilleur ROI (31 %). L'obstacle n° 1 à la vitesse de résolution d'incident est la **fatigue d'alerte** (30 %). Le narratif « facture qui explose » est largement un artefact du marketing des challengers. Nos deux actifs les plus alignés sur la douleur *mesurée* sont le **briefing déterministe** et le **copilote à citations vérifiées**.

### 1.2 Ce que cela implique pour nous, en une page

| Enseignement | Implication produit | Implication commerciale |
|---|---|---|
| ① Replay commoditisé | Ne pas réinvestir dans la capture. Investir dans le lecteur corrélé et la rétention par finalité. | Ne jamais pitcher « nous avons du session replay ». |
| ② IA self-hosted vide | Le copilote devient la **promesse n° 1**, pas une feature de la page 12. Ajouter un serveur MCP (devenu table-stake). | Cibler en priorité qui ne *peut pas* envoyer sa télémétrie chez Datadog. |
| ③ Marché ouvert par le droit | Conteneuriser la console + chart Helm + jumeaux Node des edge functions : sans cela, l'axe souverain n'existe pas. | Le déclencheur d'achat est réglementaire et daté, pas technique. |
| ④ Non-fidélité W3C | **Priorité absolue.** Vrai `trace_id` dans le champ natif du span. | Retirer « OTel-native / réversible » du discours tant que ce n'est pas corrigé. |
| ⑤ Douleur réelle = bruit | Étendre le briefing déterministe (régressions de release, nouvelles erreurs). | Vendre la réduction du bruit et la **défense de revenu** (SLA, renouvellement, triage), pas l'économie de facture. |

### 1.3 Les sept bloqueurs à lever avant toute conversation commerciale sérieuse

1. **Ingestion fail-open** — `auth.mjs:33`, `requireApiKey ?? false`. Aggravant : fail-open aussi si le registre n'a jamais pu être chargé (`auth.mjs:61-65`) et sur erreur RPC du rate-limit (`auth.mjs:100`).
2. **RLS activé mais sans isolation de tenant** — 11 migrations font bien `enable row level security` et créent des policies `cro_*`, mais toutes sont en `using (true) with check (true)` : elles ouvrent l'accès au rôle `console_ro` sans jamais filtrer sur le tenant. L'isolation reste donc **100 % applicative** (chaque requête filtre `app_id` à la main) ; un seul `WHERE app_id =` oublié fuit entre clients, sans filet en base. *(Correction post-scan : une version antérieure de ce document affirmait « aucun `CREATE POLICY` » — c'est faux ; la conclusion, elle, tient.)*
3. **Aucune couche org/tenant** au-dessus de `app_id`.
4. **SDK non publiés** — les trois paquets sont `"private": true`, distribution par copie.
5. **Identité légale en placeholders** dans CGU/CGV/DPA.
6. **Console non conteneurisée**, aucun chart Helm, deux edge functions Deno (replay, uptime) sans jumeau Node.
7. **Seuils LCP non conformes à Google** — `[2000, 2500]` au lieu de `[2500, 4000]`, à trois endroits du code.

Les points 1, 4, 5 et 7 sont des corrections d'effort **S**. Le point 7 est le meilleur rapport effort/valeur de tout ce document.

---

## 2. Cartographie du marché

### 2.1 Les six segments et leur dynamique

**Segment A — Leaders APM/RUM commerciaux.** Datadog, New Relic, Dynatrace, Elastic, Grafana Cloud Frontend Observability, Akamai mPulse, Raygun, IBM Instana. Structuré autour de trois modèles économiques incompatibles (à la session / au Go / au host-MVS) et traversé par deux ruptures 2026 : refonte du modèle de données autour des soft navigations SPA (Dynatrace, février 2026) et bascule de l'IA « détection d'anomalie » vers l'IA « investigation agentique + génération du correctif » (Datadog RUM Agentic Investigations). Aucun n'est auto-hébergeable dans sa génération courante, sauf Instana (SaaS + self-hosted Standard/Custom, y compris air-gapped — VÉRIFIÉ) et Elastic.

**Segment B — Spécialistes erreurs & session replay.** Sentry, LogRocket, FullStory, Microsoft Clarity, Contentsquare/Hotjar, BugSnag/Insight Hub, LaunchDarkly Observability (ex-Highlight.io), OpenReplay, rrweb Cloud. Segment en **consolidation brutale** : Highlight.io éteint le 28/02/2026, Hotjar fusionné dans Contentsquare au 01/07/2025, BugSnag renommé Insight Hub par SmartBear. La frontière error-tracking / replay a disparu ; la différenciation s'est déplacée vers la privacy par défaut, les agents IA de debug et le modèle de coût.

**Segment C — Stacks open-source / self-hostables.** SigNoz, HyperDX/ClickStack, OpenObserve, Uptrace, Coroot, Grafana LGTM+Faro, OpenReplay, Quickwit, Jaeger, Parseable, Dash0, Last9. **ClickHouse est devenu le moteur de stockage par défaut** (SigNoz, ClickStack, Uptrace, Coroot, OpenReplay partiellement, et Jaeger l'ajoute à ses backends). Le RUM y reste le trou de l'écosystème : SigNoz, Uptrace, Coroot, Parseable, Jaeger, Quickwit ne font **pas** de RUM.

**Segment D — Standards & spécifications.** OpenTelemetry (semconv, OTLP, Browser SDK), W3C (Trace Context, Baggage, Server-Timing, LoAF, Soft Navigations, Reporting API), Core Web Vitals, ECMA-426 / TC39-TG4. Détail en section 3.

**Segment E — Souveraineté UE & privacy-first.** Matomo, Plausible, Piwik PRO, Fathom, Umami, Pirsch côté analytics ; OVHcloud, Scaleway, Clever Cloud, S3NS, Bleu, IONOS, STACKIT, Outscale côté infrastructure. Référentiels : SecNumCloud v3.2, EUCS (enlisé), Cloud Sovereignty Framework / niveaux SEAL, BSI C5:2026, HDS v2, ISO 27001/27701.

**Segment F — OEM / white-label / embedded.** Cube, Tinybird, Explo (absorbé par Omni, fin de vie ~octobre 2026), Luzmo, Embeddable, Sisense, Metabase, Toucan, Preset, Holistics, Power BI Embedded. **Aucun acteur d'observabilité ne commercialise de programme OEM packagé, à l'exception de Grafana Labs** (programme OEM Partners : white-label / embed / distribute, partenaires Siemens, Thales, Google Cloud, Canon). Le vocabulaire dominant reste « embedded analytics » ; « embedded observability » n'est pas encore une catégorie établie.

### 2.2 Tableau de synthèse

| Acteur | Segment | Stockage | Self-host | RUM réel | Replay | IA debug self-host | Licence | Prix de référence |
|---|---|---|---|---|---|---|---|---|
| Datadog RUM | A | Propriétaire | **Non** | Oui | Oui (web+mobile) | Non (SaaS) | Propriétaire | ~1,50 $/1 000 sessions *(à confirmer — page pricing non exploitable)* |
| New Relic Browser | A | NRDB | Non | Oui | Oui (natif) | Non | Propriétaire | 100 Go/mois gratuits puis 0,40 $/Go (VÉRIFIÉ) |
| Dynatrace | A | Grail | **Non** (Grail SaaS-only) | Oui (modèle SPA le plus abouti) | Add-on ×2 | Non | Propriétaire | 2,25 $/1 000 sessions ; 4,50 $ avec replay (VÉRIFIÉ) |
| Elastic EDOT Browser | A/C | Elasticsearch | Oui | Preview | **Non** | Non | ELv2/SSPL/AGPL | Self-host gratuit |
| Grafana Cloud Frontend Obs. | A/C | Loki/Tempo | Partiel (UI = Cloud) | Oui | Oui (SDK OSS ; lecteur Cloud non documenté) | Non | Apache-2.0 (SDK) / AGPL (cœur) | 50 000 sessions/mois gratuites, puis 0,75 $/1 000 + 19 $/mois (VÉRIFIÉ) |
| Raygun | A | Propriétaire | Non | Oui | **Non** (probable) | Non | Propriétaire | 80 $/mois annuel /100 k sessions (VÉRIFIÉ) |
| IBM Instana | A | Propriétaire | **Oui** (dont air-gap) | Beacon | Non | Non | Propriétaire | MVS/host ; min. 10 hosts (VÉRIFIÉ) |
| Sentry | B | ClickHouse+PG+Kafka+Redis | Oui (FSL) | Partiel | Oui (fork rrweb) | **Non — exclu par licence** | FSL-1.1 → Apache 2.0 à 2 ans | Team 26 $/mois ; replay 0,003 $/u. (VÉRIFIÉ) |
| LogRocket | B | Propriétaire | Enterprise seulement | Oui | Oui | Non | Propriétaire | Core ~176 $/mois /25 k sessions, pas de free tier (VÉRIFIÉ) |
| Microsoft Clarity | B | Propriétaire | Non | Partiel | Oui | Non | Gratuit | **Gratuit, sans limite de trafic** (VÉRIFIÉ) |
| Contentsquare | B | Propriétaire | Non | Oui | Oui | Non | Propriétaire | Free : 200 k sessions dont **10 k replays** (VÉRIFIÉ) |
| BugSnag / Insight Hub | B | Propriétaire | Oui (dès Preferred) | Oui | **Non** | Non | Propriétaire | Free 7,5 k events (VÉRIFIÉ) |
| OpenReplay | B/C | PG+CH+Kafka+Redis+MinIO | **Oui** | Frontend seul | Oui | **« Coming soon »** | AGPLv3 (+ `ee/`) | Dedicated 199 $/mois (VÉRIFIÉ) |
| SigNoz | C | ClickHouse | Oui | **Non** (web vitals seuls) | Non | Non | MIT (+ `ee/`) | 49 $/mois ; Enterprise dès 4 000 $/mois (VÉRIFIÉ) |
| HyperDX / ClickStack | C | ClickHouse + **MongoDB** | Oui (6 modes) | Partiel | Oui | Non | **MIT pur** | ClickHouse Cloud |
| OpenObserve | C | Parquet/S3 | Oui | **Oui** (RUM + replay + erreurs) | Oui | Preview | AGPLv3 | Self-host Enterprise **gratuit ≤ 50 Go/j** (VÉRIFIÉ) |
| Coroot | C | ClickHouse | Oui | Non | Non | Payant | Apache 2.0 | 1 $/cœur/mois, **SSO+RBAC inclus** (VÉRIFIÉ) |
| groundcover | C | BYOC | **Oui** (On Prem 50 $/nœud) | Oui | Oui | Non | Propriétaire | 30 / 35 / 50 $ par nœud/mois (VÉRIFIÉ) |
| Dash0 | C | Propriétaire | **Non** | Oui (100 % OTLP) | **Non** | Non | Propriétaire | 0,60 $/M web events ; rétention events **30 j** (VÉRIFIÉ) |
| Matomo | E | MySQL | Oui (Community illimité) | Analytics | Premium (désactivé en mode CNIL) | Non | GPL | Cloud 29 €/mois (VÉRIFIÉ) |
| Piwik PRO | E | Propriétaire | Enterprise | Analytics | Non | Non | Propriétaire | Business 35 €/mois ; Enterprise 366 €/mois (VÉRIFIÉ) |
| Cube | F | Headless | **Oui** | Non | Non | Gouvernée | **Apache 2.0** (backend) / MIT (client) | Cloud sur devis |
| Metabase | F | Headless | Oui (+ air-gap) | Non | Non | Non | AGPL + propriétaire | Pro 575 $/mois (white-label + multi-tenant) ; Enterprise ≥ 20 000 $/an (VÉRIFIÉ) |
| **MIP RUM** | **A+B+C+E+F** | **Postgres seul** | **Partiel** (ingestion oui, console non) | **Oui** | **Oui** | **Oui (unique)** | À arbitrer | À définir |

### 2.3 Où se situe réellement MIP RUM

**Périmètre fonctionnel : au niveau du haut de marché, ce qui est rare pour une petite équipe.** CWV p75 avec attribution, erreurs JS avec fingerprint et sourcemaps, sessions, resources, longtasks, breadcrumbs, frustration signals, session replay rrweb, tracing distribué front → serveur → DB, logs OTLP, uptime synthétique, deploy markers, health score, anomalies z-score, SLO + error budget, alerting seuil **et** baseline saisonnière MAD, forecast, CSAT. Après l'extinction de Highlight.io le 28/02/2026, **il ne reste quasiment plus d'indépendant open-source full-stack** couvrant erreurs + logs + traces + replay dans un seul produit.

**Architecture : atypique et c'est un actif, pas un défaut — à condition de l'assumer.** Postgres seul est unique dans tout le panel. Le coût réel du self-host, c'est le **nombre de composants à exploiter** : ClickStack exige ClickHouse + HyperDX + Collector + MongoDB (deux bases de familles différentes) ; OpenReplay exige PostgreSQL + ClickHouse + Kafka + Redis + MinIO, minimum 8 Go RAM ; Sentry self-hosted exige Postgres + Redis + Kafka + ClickHouse, 4 cœurs et 16 Go RAM + 16 Go de swap (VÉRIFIÉ, `develop.sentry.dev/self-hosted`) ; Grafana LGTM se voit reprocher « la complexité opérationnelle de 4 composants ». Le reproche transversal fait à SigNoz et ClickStack — *« requires ClickHouse expertise at scale »* — décrit un métier que l'éditeur externalise chez son client. Nous : deux conteneurs, une base, un parseur JS pur sans dépendance qui tourne à l'identique en Deno et en Node. **Seul OpenObserve (binaire unique) occupe ce terrain.**

**Maturité industrielle : en dessous du seuil d'achat.** RLS sans filtre de tenant, ingestion fail-open, pas de couche org, SDK non publiés, console non conteneurisée, aucune certification, identité légale en placeholders. Ce sont ces points — et non le périmètre fonctionnel — qui nous excluent aujourd'hui de toute short-list.

**Positionnement de fait aujourd'hui :** un produit RUM full-stack de qualité, techniquement crédible, mais **non livrable** à un acheteur exigeant et **non embarquable** par un éditeur tiers.

---

## 3. Standards du secteur et notre conformité

### 3.1 État des standards en 2026

| Standard | Statut vérifié (juillet 2026) | Conséquence produit |
|---|---|---|
| **OTLP 1.11.0** | **Stable** pour traces/metrics/logs sur les 3 transports. Profiles = Development. | Le seul bloc *vraiment* stable de la pile. C'est sur lui qu'on peut bâtir un contrat long terme. |
| **Encodage OTLP/JSON** | `traceId`/`spanId` en **hex**, pas base64 — déviation explicite du mapping Protobuf JSON. Clés en lowerCamelCase, enums en entiers. | Piège classique : tout ingesteur généré depuis un stub proto3 est cassé silencieusement. |
| **CORS / navigateur dans OTLP** | **Absent de la spec.** Ni CORS, ni `sendBeacon`, ni `keepalive`, ni coupure de page. | Espace de différenciation produit réel — chaque vendeur réinvente cette couche. |
| **W3C Trace Context L1** | **W3C Recommendation** depuis le 06/02/2020. | Socle non négociable de la corrélation front → back. |
| **W3C Trace Context L2** | **Candidate Recommendation Draft du 28/03/2024**, non avancé depuis ~28 mois. Apport : *random trace ID flag*. | Ne pas en dépendre. |
| **W3C Baggage** | CR Snapshot du 30/05/2024, dernière publication. API OTel Baggage, elle, **Stable**. | Décalage notable maturité W3C / OTel. |
| **Server-Timing** | Working Draft du 07/04/2026, implémenté partout. | Canal standard sous-exploité pour faire redescendre un `trace_id` serveur au navigateur. |
| **Semconv browser.\* / session.\* / app.\*** | **100 % en statut « Development ».** UN SEUL événement navigateur défini : `browser.web_vital` (Required : name, value, **delta**, id). | Rien de stable. Aligner les noms, **ne jamais revendiquer une conformité**. |
| **Roadmap semconv 2026 (#3330)** | Se déclare « work in progress, not a final roadmap ». Browser et client apparaissent comme *nouvelles conventions*, **pas** comme cibles de stabilisation. | Ne pas espérer de conventions browser stables avant 2027. |
| **`@opentelemetry/browser-sdk`** | **0.1.0**, publié le 09/07/2026. README : *« experimental package under active development. New releases may include breaking changes »*. **Métriques hors périmètre.** | Ne jamais bâtir dessus sans couche d'abstraction. |
| **`@opentelemetry/browser-instrumentation`** | 0.6.0 (13/07/2026). **Tous les imports sous `./experimental/*`.** 8 versions en 4 mois. Émet `browser.navigation` et `browser.console`, événements **inexistants dans la spec**. | L'implémentation devance la spec : deux vendeurs « OTel browser » peuvent être non interopérables tout en étant conformes. |
| **Page officielle guide RUM web** | `opentelemetry.io/docs/platforms/client-apps/web/` = **« Content coming soon! »** | Preuve directe et citable de l'immaturité. |
| **Core Web Vitals** | **Seuils inchangés** : LCP ≤ 2,5 s / > 4 s ; INP ≤ 200 ms / > 500 ms ; CLS ≤ 0,1 / > 0,25. p75 sur 28 j glissants (CrUX). Aucune nouvelle CWV. | La différenciation ne peut plus venir des métriques, seulement de l'attribution et de l'actionnabilité. |
| **web-vitals** | **v6.0.1 le 27/07/2026.** v6.0.0 ajoute le support Soft Navigations et bfcache ; 6.0.1 corrige une **exception quand `PerformanceObserver` est indisponible**. Licence **Apache-2.0**. | Épingler ≥ 6.0.1 est une obligation de non-régression : 6.0.0 peut casser le site hôte. |
| **Soft Navigations API** | Shippée sans flag à partir de **Chrome 151, stable le 28/07/2026** — soit aujourd'hui, donc **0 % de parc**. Remontée dans CrUX **encore à déterminer**. | Fenêtre de construction ouverte et sans concurrence. Aucun impact SEO confirmé. |
| **LoAF** | *Limited availability*, **non Baseline**, Chromium seul depuis Chrome 123. | L'attribution INP est Chromium-only. L'UI doit le dire honnêtement. |
| **Reporting API** | **Baseline depuis mars 2026.** Capture crashs d'onglet et pages dont le JS n'a jamais démarré. | Angle mort structurel de tout SDK RUM. Aucune convention OTel ne le couvre — espace ouvert. |
| **ECMA-426** | 1ʳᵉ édition adoptée par l'AG Ecma en **décembre 2024**. Normalise `ignoreList`. **Ne contient pas les Debug IDs.** | `ignoreList` permet de replier le code framework : divise par ~3 le bruit d'une stack React. |
| **Debug ID (TC39-TG4)** | **Stage 2.** UUID 128 bits, `//# debugId=` dans le bundle **et** champ `debugId` dans la `.map`. Déjà standard de facto via les plugins Sentry. Autres propositions : Scopes **Stage 3**, Range Mappings Stage 2. | Le matching `(release, filename)` est le schéma hérité qu'il remplace. |
| **OTel Profiles** | **Public Alpha** (mars 2026), *« should not be used for critical production workloads »*, *« production-ready backends have not yet emerged »*. | Aucune retombée navigateur. Ne pas en faire un critère de complétude. |
| **OpenMetrics 2.0** | **[EXPERIMENTAL]** mais se qualifie de release candidate. Native histograms. | Pertinent pour l'agrégation p75 backend, pas pour le RUM. |
| **ECS ↔ OTel semconv** | Convergence engagée en 2023, **non achevée**, avec l'aveu que sur certains domaines elle est inatteignable. | Toute promesse de schéma unifié est à lire avec prudence. |
| **Sentry Envelope** | Format documenté : en-tête JSON + N items typés, newline-delimited, POST `/api/<id>/envelope/`, **1 MiB par item**, 200 MiB par enveloppe. | Le seul format qui multiplexe replay + attachments + buffering offline. OTLP n'a **rien** d'équivalent — c'est pourquoi personne ne fait de replay en OTLP. |

### 3.2 Référentiels et certifications UE

| Référentiel | Statut vérifié | Ce que ça implique pour nous |
|---|---|---|
| **SecNumCloud v3.2** | Rendu opposable par le **décret n° 2026-272 du 14/04/2026** (en vigueur le 17/04/2026). **Nuance juridique** : le décret impose un référentiel ANSSI dont la conformité peut être attestée par SecNumCloud **ou une certification européenne d'un niveau au moins équivalent**. | Ne **jamais** écrire « SecNumCloud est obligatoire ». Précédents d'éditeurs SaaS qualifiés : Oodrive, Whaller, Index Education, Cegedim — c'est atteignable, mais tard. |
| **Qualification par périmètre** | La qualification OVHcloud porte sur des **périmètres nommés** (VMware on OVHcloud depuis déc. 2020, SAP HANA on Private Cloud, Bare Metal Pod), **pas** sur le catalogue. | « Hébergé chez OVH donc SecNumCloud » fait recaler. Nommer le service qualifié. |
| **EUCS** | Enlisé : exigences de souveraineté retirées du projet de mars 2024. Mais le **C5:2026 absorbe des exigences EUCS niveau Substantial**. | Viser C5:2026 rapproche mécaniquement d'EUCS-Substantial. Meilleur rapport effort/couverture que parier sur EUCS. |
| **Cloud Sovereignty Framework / SEAL** | Opérationnel via l'achat public : tender « Sovereign Cloud », 180 M€ / 6 ans, attribué avril 2026, **SEAL-2 exigé pour l'éligibilité**. SEAL-3 : Post Telecom/OVHcloud/Clever Cloud, STACKIT, Scaleway. SEAL-2 : Proximus/S3NS/Clarence/Mistral. | Le score de souveraineté devient un objet contractuel comparable. |
| **BSI C5:2026** | Publié fin mars 2026, **obligatoire seulement pour les missions dont la date est postérieure au 1ᵉʳ juin 2027**. Intègre NIS2, Confidential Computing, cryptographie post-quantique. | Porte d'entrée du marché public allemand — mais pas avant 2027. |
| **HDS v2** | Applicable aux nouvelles certifications depuis nov. 2024 ; **16/05/2026 = date butoir des certificats existants** (échéance passée). Nouveauté : **stockage exclusivement dans l'EEE**. | Attention : « européen » ≠ EEE. La Suisse (Exoscale) a une adéquation mais ne satisfait pas HDS v2. |
| **ISO 27001:2022** | Plancher d'accès grand compte. Piwik PRO l'a sur tous les plans ; Plausible ne l'a pas — et c'est son reproche n° 1. | À planifier, pas à faire en premier. Mais à ne pas découvrir au premier appel d'offres. |
| **RGPD / ePrivacy** | Lignes directrices EDPB **2/2023** (07/10/2024) : l'art. 5(3) couvre pixels, tracking d'URL, tracking par IP, **fingerprinting**. EDPB **01/2025** (16/01/2025) : un hash simple sans gestion du domaine de pseudonymisation est **insuffisant**. | Notre « zéro IP stockée » est structurellement supérieur aux hash IP+UA de Plausible et Pirsch. |
| **CNIL fiche n° 16** | Programme d'évaluation CNIL **remplacé au 01/01/2026** par une auto-évaluation éditeur (5 objectifs / 14 critères). **C'est l'éditeur de site — notre client — qui porte le risque en cas de contrôle.** | Fournir le guide de configuration + la grille pré-remplie, c'est vendre de la couverture de risque. Meilleur rapport effort/valeur commerciale du dossier. |
| **CNIL session replay** | Projet de recommandation, consultation **25/02/2026 → 22/04/2026**, adoption finale attendue. Consentement préalable obligatoire, **aucune exemption** ; échantillonnage/déclenchement conditionnel plutôt qu'enregistrement systématique ; rétention de quelques heures (support) à quelques mois (UX). | Notre TTL unique de 30 j ne colle pas. Le masquage conditionné au consentement au niveau du DOM (pattern FullStory `.fs-unmask-with-consent`) devient la référence. |
| **Digital Omnibus** | Futur art. 88a(3)(c) : l'exemption « statistiques agrégées » est limitée au responsable mesurant **son propre service en ligne** pour son seul usage — **exclut par construction les outils tiers**. Art. 88a applicable ~6 mois après entrée en vigueur, art. 88b ~24 mois. | Ne pas bâtir de discours sur « le Digital Omnibus va nous exempter ». |
| **EU Data Act (Rég. 2023/2854)** | Art. 25 **applicable depuis le 12/09/2025** : préavis de résiliation ≤ 2 mois, transition obligatoire de 30 j calendaires extensible, justification d'infaisabilité sous 14 j ouvrés (alternative ≤ 7 mois). Art. 29 : **fin totale des frais de switching au 12/01/2027**. | Ce sont des **clauses à écrire au contrat aujourd'hui**, pas une échéance 2027. Les publier dans le DPA prend une avance vérifiable. |

### 3.3 Notre conformité — écarts et coût réel

| Point | Notre état (audit de code) | Écart | Coût si non corrigé |
|---|---|---|---|
| **Encodage OTLP/JSON** | `otlp-encode.ts` : hex natif pour traceId/spanId, `hrToNanos` en string. Côté ingestion, `anyValue()`/`attrsToObj()` tolèrent les deux encodages d'`intValue`. | **Aucun.** Nous sommes justes sur le piège qui casse la majorité des ingesteurs maison. | — (à valoriser) |
| **W3C Trace Context sur le fil** | `otel.ts:109-110` : traceId **et** spanId aléatoires par span. Contexte réel dans `mip.trace_id`/`mip.span_id`. Ni `parentSpanId`, ni `kind`, ni `status`, ni `flags`. | **Majeur.** Pas d'arbre de trace OTLP côté front. | **Très élevé.** Invalide « OTel-native », « réversible », le chemin Collector→ClickHouse et l'argument anti-lock-in. Effort **M**. |
| **Clé d'API en attribut de resource** | `otel.ts:87` : `mip.api_key` dans le corps JSON. | Aucune auth par en-tête possible en amont ; la clé fuit dans les logs de tout Collector. | Élevé — ferme le chemin Collector. Effort **S**. |
| **Auto-instrumentation serveur OTel** | `otlp.mjs` détecte `SPAN_KIND_SERVER`, lit `http.request.method`/`http.method`/`http.route`/`url.path`/`url.full`, utilise les **vrais** traceId/spanId/parentSpanId, normalise `{id}` → `:id`, récupère la session via `tracestate` `mip=s:<sid>`. | **Aucun.** Chemin genuinement standard. | — (à valoriser). À comparer à OpenReplay, **sans aucun support OTel documenté**. |
| **Seuils LCP** | `[2000, 2500]` au lieu de `[2500, 4000]`, cohérent aux 3 endroits (`vitals.ts:14`, `otlp.mjs:13`, `rating.ts:6`). INP/CLS/FCP/TTFB corrects. | Non conforme Google. | **Élevé pour un coût nul.** Notre taux de « bon » sera structurellement inférieur à PageSpeed ; le client conclura que l'outil est faux. Effort **S**. |
| **`browser.web_vital`** | Span `webvital.<NAME>` avec name/value/rating/id/navigation_type/attribution. **`delta` absent.** | À un renommage près, sauf `delta`. | Moyen : sans `delta`, deux rapports successifs de CLS ou d'INP pour la même page ne s'agrègent pas correctement. Effort **S**. |
| **web-vitals** | Épinglé **5.3.0** → pas de support Soft Navigations. | Aligné sur le marché (l'instrumentation OTel officielle dépend elle aussi de `^5.3.0`). | Faible aujourd'hui. Passer à ≥ 6.0.1 après validation. |
| **Sourcemaps** | `route.ts` : upload par `{ appId, release, filename, content }`. Aucun `debugId`, aucune lecture d'`ignoreList`. | Schéma hérité. | Moyen-élevé : la dé-minification casse silencieusement au moindre changement de hash de build. Effort **M**. |
| **Modélisation navigateur** | Dispatch sur `span.name` (`webvital.*`, `exception`, `pageview`, `resource`, `longtask`, `breadcrumb`, `http.client`, `track.*`, `frustration`). | Le marché est passé aux **LogRecords** ; la roadmap semconv 2026 prévoit de déprécier les span events. Effet de bord : `track.<name>` pollue l'espace de nommage des spans. | Dette de moyen terme, pas urgence. Effort **L**. |
| **RLS** | RLS **activé** (11 migrations, policies `cro_*`) mais toutes en `using (true)` : aucun filtrage par tenant. | Isolation 100 % applicative ; pas de filet en base. | **Bloquant** — critère éliminatoire n° 1 de l'embedded. Effort **L**. |
| **Fail-closed ingestion** | `requireApiKey ?? false` ; fail-open aussi si registre non chargé et sur erreur RPC. | Ingestion spoofable. | **Bloquant.** Effort **S**. |
| **Licence** | Non arbitrée. | — | Voir § 7. Le choix conditionne l'OEM. |

---

## 4. Table-stakes vs différenciants

### 4.1 Table-stakes — ce qu'il faut avoir pour être dans la conversation

| Capacité | Statut marché | Notre état | Verdict |
|---|---|---|---|
| Ingestion OTLP native, sans SDK imposé | Table-stake absolu — « un backend qui impose son SDK maison est disqualifié d'office » | ✅ OTLP/HTTP JSON standard, parseur portable Deno + Node | **Acquis, à valoriser** |
| Core Web Vitals p75 + attribution | Table-stake universel | ✅ Présent, ⚠️ **seuils LCP faux**, `delta` manquant | **Corriger — effort S** |
| Session replay masqué par défaut | Table-stake depuis 2026 (Datadog, Sentry, Faro, Clarity) | ⚠️ `maskAllInputs` seulement — **en retrait** (pas de `maskAllText`, pas de blocage média) | **Corriger — effort M** |
| Error tracking : fingerprint + groupement + sourcemaps | Table-stake | ✅ Fingerprint, groupement, table sourcemap | Acquis |
| États de triage, alerte first-seen, régression, ownership | Table-stake (Sentry : new/ongoing/escalating/regressed/resolved/archived ; BugSnag : stability score) | ❌ Absent | **Manque — effort M** |
| Upload sourcemaps automatisé + Debug IDs | Table-stake **absolu** en 2026 | ❌ Upload manuel, matching `(release, filename)` | **Manque — effort M** |
| Corrélation front → back par trace context | Table-stake universel | ⚠️ Fonctionne, mais **pas sur le fil OTLP** | **Corriger — effort M** |
| Explorer à facettes + timeline de session | Table-stake | ✅ ~44 pages cohérentes | Acquis |
| Alerting seuils + baselines + routage | Table-stake | ✅ Seuil + baseline saisonnière MAD, canaux par sévérité | **Acquis, au niveau du marché** |
| Deployment / release tracking | Table-stake (inclus jusque dans le plan Basic de Raygun) | ✅ Deploy markers | Acquis — mais non branché sur la détection de régression |
| Sampling deux régimes (continu + on-error) | Table-stake | ⚠️ Échantillonnage par session persisté ; pas de buffer on-error, pas de filtres de rétention | **Manque — effort M** |
| SSO/OIDC, RBAC, audit | Table-stake entreprise ; **paywallé chez SigNoz et OpenReplay** | ✅ SSO OIDC/PKCE, RBAC admin/viewer | **Acquis — argument de vente gratuit** |
| Multi-tenance « by construction » + RLS | **Critère éliminatoire 2026** | ❌ 100 % applicatif ; RLS activé mais policies `using (true)` (aucun filtre tenant), pas de couche org | **Bloquant — effort L** |
| Ingestion fail-closed | Table-stake implicite | ❌ Fail-open par défaut | **Bloquant — effort S** |
| SDK publiés sur npm/PyPI | Table-stake — aucun concurrent ne distribue autrement | ❌ `private: true` | **Bloquant — effort S** |
| Compose d'évaluation + chart Helm | Table-stake self-host (SigNoz, ClickStack, OpenReplay, Coroot, Uptrace) | ⚠️ Compose 2 services jamais exécuté en CI ; **aucun Helm** ; console non conteneurisée ; 2 edge functions Deno orphelines | **Bloquant — effort M** |
| Serveur MCP | **Passé de différenciant à table-stake en 12 mois** (Sentry GA, LogRocket, Clarity, FullStory beta, Datadog, OpenReplay dès l'OSS) | ❌ Absent | **Manque — effort S** |
| Cache / pré-agrégation sur l'API de lecture | Table-stake embedded (Cube), TTL 1–5 min (Grafana) | ❌ p75 recalculé sur tables brutes, rollups désactivés, ETag seul | **Manque — effort M** |
| Rate-limiting distribué par tenant | Table-stake | ⚠️ Best-effort mémoire par isolat, fail-open sur erreur | **Manque — effort M** |
| DPA en ligne + liste publique de sous-traitants + trust center | Table-stake privacy-first | ❌ Identité légale en placeholders | **Bloquant — effort S** |
| ISO 27001 | Plancher grand compte | ❌ | **Manque — effort XL, à planifier** |

### 4.2 Différenciants — ce qui distingue vraiment en 2026

| Capacité | Qui l'a | Nous | Verdict |
|---|---|---|---|
| **IA de debug fonctionnant en self-hosted** | **Personne** (Sentry exclut Seer, OpenReplay *coming soon*, LogRocket Enterprise, Datadog/Dynatrace/Grafana SaaS-only) | ✅ Assistant LLM souverain, **citations vérifiées serveur** | **Différenciant unique — à mettre en ligne 1** |
| **Grounding auditable des réponses IA** | Personne ne le documente | ✅ Tout marqueur `[n]` non adossé à une source réelle est supprimé | **Différenciant unique** |
| **Zéro IP collectée (géo par timezone)** | Plausible et Pirsch hashent IP+UA (fragilisés par EDPB 2/2023 et 01/2025) ; Fathom anonymise puis stocke aux USA ; Matomo masque 2 octets | ✅ Aucune colonne IP | **Différenciant, structurellement supérieur** |
| **Mono-composant (un seul Postgres)** | Seul OpenObserve (binaire unique) | ✅ 2 conteneurs, 1 base | **Différenciant self-host fort** |
| **Lecteur replay corrélé bout en bout** | Grafana ne documente **pas** de lecteur visuel ; Elastic et Raygun n'ont pas de replay | ✅ Replay + traces + erreurs + logs dans un produit | **Différenciant — à condition de corriger le trace_id** |
| **Extension navigateur MV3 (injection sans toucher au site)** | Équivalent réservé aux gros contrats (injection edge Akamai/Dynatrace) ; ClickStack a un mode « browser-only » pour la friction zéro | ✅ | **Différenciant d'acquisition** |
| **Briefing déterministe « ce qui a changé »** | Résumés IA multi-sessions chez Clarity (250 replays), Contentsquare | ✅ Cœur déterministe + LLM pour la prose | **Différenciant aligné sur la douleur mesurée** |
| Session replay | Table-stake | ✅ | **Neutre — ne vend rien** |
| Masquage par défaut | Table-stake | ⚠️ En retrait | **Neutre au mieux** |
| Modèle SPA pages/views/navigations | Dynatrace (fév. 2026). Datadog a une demande ouverte depuis avril 2024 sans PR (issue #2696) | ❌ Pageviews/routes seulement | **Fenêtre ouverte — effort M** |
| Reporting API (crash d'onglet, JS jamais démarré) | **Aucune convention OTel, personne ne l'exploite** | ❌ | **Espace vide — effort S/M** |

---

## 5. Nos forces réelles à capitaliser

### 5.1 L'assistant IA souverain à citations vérifiées — notre seul actif véritablement unique

C'est le segment vide le plus net de tout le scan, et il est établi par trois faits indépendants et vérifiés :

- **Sentry exclut Seer et l'ensemble des fonctionnalités AI/ML du self-hosted**, pour raison de licence (closed source). Sont également exclus le système de pricing/billing, la Spike Protection et la Spend Allocation. Le Session Replay, lui, ne figure pas dans la liste d'exclusion.
- **OpenReplay** affiche encore ses « AI Agents » en *coming soon* sur le tier Enterprise en juillet 2026.
- **LogRocket** réserve le self-hosted **et** Galileo au plan Enterprise ; **Coroot** met l'AI root cause analysis en payant ; **Datadog, Dynatrace et Grafana** sont SaaS-only.

Le raisonnement est fermé : les organisations les plus contraintes réglementairement — celles que le décret 2026-272, la circulaire Bercy et le projet CNIL visent en premier — sont précisément celles qui doivent auto-héberger. Ce sont donc exactement celles auxquelles Sentry ne *peut pas* vendre d'agent de debug.

**Second différenciant, plus subtil et plus défendable encore : la vérification serveur des citations.** Tout le marché a de l'IA ; personne n'en prouve les sources. Le critère d'achat 2026 s'est déplacé de « y a-t-il de l'IA » à « l'IA répond-elle depuis des données certifiées plutôt qu'en générant du SQL libre » (formulation Cube). Notre mécanisme — suppression de tout marqueur `[n]` non adossé à une source réelle — est un **contrôle auditable**.

**Comment le capitaliser.** Le transformer en artefact commercial et non en promesse : journal des citations, taux de citations rejetées, capacité de rejouer une réponse, test automatisé qui démontre la suppression. Coupler au serveur MCP pour que l'éditeur hôte branche ses propres agents. C'est ce qui transforme une ligne de pitch en argument d'appel d'offres.

### 5.2 La souveraineté par construction, pas par configuration

Notre architecture ne collecte **aucune adresse IP** : la géolocalisation passe par la timezone. Ce n'est pas une variante de ce que font les autres, c'est la seule approche qui ne repose sur aucune hypothèse juridique contestable.

- Plausible calcule `hash(daily_salt + website_domain + ip_address + user_agent)` avec rotation quotidienne du sel (VÉRIFIÉ, data policy).
- Pirsch génère « a hash for each visitor, calculated from the visitor's IP address, User-Agent and other data points » (VÉRIFIÉ, page pricing).
- Les lignes directrices **EDPB 2/2023** rangent le fingerprinting dans le champ de l'art. 5(3) ; **EDPB 01/2025** juge un hash simple insuffisant sans gestion du domaine de pseudonymisation.
- La CNIL n'exige que la troncature du dernier octet ; Matomo en masque deux ; Fathom anonymise à l'entrée mais **stocke ensuite aux États-Unis** (VÉRIFIÉ, page EU isolation).

S'y ajoutent : `ConsentGate` (zéro span créé, donc zéro requête réseau, tant que le consentement n'est pas acquis), `honorDNT`, scrub PII **serveur** en défense en profondeur (indépendant du `beforeSend` client), purge par tenant, DSAR / effacement Art. 17. Le reproche générique adressé aux SDK du marché — « les configurations par défaut capturent plus de PII que les équipes ne le croient » — ne nous vise pas.

**Attention au cadrage.** Ne pas noyer cet argument sous le mot « cookieless », qui n'exempte de rien. Et ne pas le confondre avec le masquage par défaut, devenu table-stake. Le différenciateur RGPD doit se déplacer vers la **preuve opposable**, la rétention par finalité et le consentement au niveau du DOM.

### 5.3 L'encodage OTLP correct et l'auto-instrumentation serveur standard

Deux actifs techniques précis :

- `otlp-encode.ts` est juste sur la déviation OTLP/JSON (hex, pas base64 ; nanos en string pour dépasser 2⁵³), et l'ingestion tolère les deux encodages d'`intValue` — nous **acceptons** des émetteurs tiers là où beaucoup rejettent.
- `otlp.mjs` ingère de l'auto-instrumentation OTel standard côté serveur : détection `SPAN_KIND_SERVER`, lecture des attributs semconv réels, vrais identifiants de trace, normalisation de template de route, récupération de session via `tracestate`. Face au panel, OpenReplay n'a **aucun** support OpenTelemetry documenté — ce qui le qualifie de « silo frontend non corrélable au backend ».

**Réserve honnête.** Cet argument ne tient que si le front émet aussi de vrais `trace_id`. Aujourd'hui nous avons un backend standard et un front propriétaire — et c'est le front qui est notre produit.

### 5.4 Le mono-composant comme argument d'exploitation

Détaillé en § 2.3. C'est l'intuition la plus solide du dossier et elle est vérifiable en 30 secondes par un prospect : nombre de conteneurs, nombre de bases, RAM minimale. Face à cinq services chez OpenReplay et deux familles de bases chez ClickStack, « pas de ClickHouse à tuner, pas de Kafka, pas de MongoDB » est un argument que seul OpenObserve sait tenir.

**Corollaire à assumer publiquement :** documenter le plafond volumétrique comme une **caractéristique produit**, pas comme une honte. Le câblage ClickHouse devient le palier haut, pas la réparation d'un défaut.

### 5.5 Le chemin ClickHouse déjà prouvé par un bench reproductible

Bien plus avancé que « conçu et benché » : `infra/clickhouse/schema.prod.sql` (jeu de tables complet, `device_type` dénormalisé, TTL 30 j, codecs Gorilla/DoubleDelta + ZSTD, vue matérialisée AggregatingMergeTree `quantileTDigestState` horaire), `writer.mjs` (client HTTP zéro dépendance), `bench.mjs`, `DEPLOY.md` (runbook réversible en mode `both`), `otel-collector.example.yaml`.

Résultats : **Δ = 0 exact** sur les p75 entre `percentile_cont` (PG) et `quantileExactInclusive` (CH), ×15 de compression, ~88 k lignes/s sans tuning, protocole documenté et rejouable par `node infra/clickhouse/bench.mjs`.

À mettre en regard de ce que le scan classe comme **non vérifiable** dans tout le segment : les « 140× moins cher qu'Elasticsearch » d'OpenObserve, les « 40 octets par span » d'Uptrace, les « > 80 % des problèmes détectés » de Coroot — toutes des revendications de landing page. Nous avons le seul chiffre du lot qu'un prospect peut rejouer sur sa machine.

**Ce que le bench dit aussi, et qu'il faut assumer :** PG gagne sur la petite requête point, CH gagne d'un facteur ~12 dès qu'on scanne large. La migration n'est donc **pas urgente** sous quelques millions d'events/jour. Le vrai blocage n'est pas la base, c'est **l'absence de point d'indirection** : la console est soudée à Postgres, donc la bascule serait une réécriture et non une configuration.

### 5.6 L'API de lecture headless déjà conforme au pattern OEM

Jeton hashé en base, scopé à un `app_id`, 403 explicite sur app non autorisée, `CONSOLE_API_TOKENS` avec syntaxe `token@app1;app2` et **comparaison à temps constant parcourant toutes les entrées** pour ne pas fuiter par chronométrage, allowlist CORS, ETag, rate-limit, OpenAPI/Swagger, 14 routes versionnées.

C'est déjà ~70 % d'un moteur headless vendable — exactement le modèle Cube (couche sémantique, backend Apache 2.0) et Tinybird (API endpoints + JWT porteur des politiques RLS), deux acteurs qui n'ont **aucune** capacité RUM. La doctrine Sisense (jamais de secret dans l'URL, application server-side) est respectée, et nous n'avons pas reproduit l'anti-pattern d'Explo (expiration de JWT d'embed à **24 heures** par défaut, contre une norme haute « minutes seulement » chez Grafana).

### 5.7 Les autres actifs à ne pas sous-estimer

- **Extension navigateur MV3** : démo sur le site du prospect en 60 secondes, sans ticket IT. Argument d'avant-vente OEM autant que fonctionnalité.
- **Analytique déjà mûre** : health score, anomalies z-score, SLO + error budget, alerting baseline MAD, forecast, deploy markers. Ce bloc est au niveau du marché — ne pas y réinvestir, l'**exposer**. Deux gestes à coût quasi nul : règles d'alerte recommandées en un clic depuis les pages de résumé (pattern New Relic vérifié), et branchement des deploy markers sur la détection de régression pour produire une comparaison avant/après release.
- **Qualité** : 566 tests unitaires, CI avec migrations en ordre sur Postgres réel + Playwright. C'est un signal de sérieux rare à cette taille.

---

## 6. Nos manques, priorisés

### 6.1 Bloquants (rien ne se vend tant qu'ils sont là)

| # | Manque | État actuel | Effort | Justification marché |
|---|---|---|---|---|
| B1 | **Fidélité W3C Trace Context sur le fil OTLP** | traceId/spanId aléatoires ; contexte réel en attributs `mip.*` ; ni parent, ni kind, ni status | **M** | Invalide « OTel-native », le chemin Collector, le scale ClickHouse et l'OEM d'un seul coup. Débloque le plus de valeur par unité d'effort de tout le document. |
| B2 | **Ingestion fail-closed** | `requireApiKey ?? false` ; fail-open si registre non chargé ; fail-open sur erreur RPC du rate-limit ; `allowed_origins` présent mais non vérifié à l'ingestion | **S** | Tue un deal OEM en une question : l'éditeur hôte expose ses propres clients à la pollution de leurs métriques facturées. |
| B3 | **RLS + couche org/tenant** | Policies `cro_*` existantes mais en `using (true)` (aucun filtre tenant) ; `app_id` seule dimension | **L** | Critère éliminatoire n° 1 de l'embedded, formulé à l'identique par Cube, Sisense, Toucan, QueryPanel. Prérequis de tout scoping, quota, refacturation, purge par compte. |
| B4 | **Publication des SDK sur npm/PyPI** | 3 paquets `private: true` | **S** | Aucun concurrent ne distribue par copie. Rejet immédiat en évaluation technique. |
| B5 | **Identité légale, DPA, sous-traitants, trust center** | Placeholders | **S** | Signature impossible — a fortiori avec un éditeur qui doit nous désigner comme sous-traitant ultérieur. |
| B6 | **Packaging self-host complet** | Compose 2 services jamais exécuté en CI ; aucun Helm/K8s ; console non conteneurisée ; 2 edge functions Deno sans jumeau Node ; jobs via pg_cron/pg_net Supabase | **M** | Sans cela, replay et uptime **disparaissent** du self-host, et nous récoltons le reproche fait à Faro : « on récupère la donnée, pas le produit ». |
| B7 | **Privacy replay au niveau du standard 2026** | `maskAllInputs` seul ; TTL unique 30 j ; pas de couplage consentement | **M** | Être moins protecteur que Datadog, Sentry et Faro sur le signal le plus surveillé par la CNIL, pour un produit qui vend la souveraineté, est un contresens fatal. |
| B8 | **Surface d'embarquement OEM** | Aucun jeton d'embed, aucun `frame-ancestors`, marque MIP en dur, aucun contrat postMessage | **L** | C'est littéralement le produit à vendre en OEM et il n'existe pas. |

### 6.2 Importants (limitent la valeur ou la crédibilité)

| # | Manque | Effort | Note |
|---|---|---|---|
| I1 | **Seuils LCP conformes** `[2500, 4000]` | **S** | Le meilleur rapport effort/valeur du document. Trois constantes. |
| I2 | Couche de dialecte de lecture (point d'indirection PG/CH) | **L** | Le blocage n'est pas la base, c'est l'absence d'indirection. Rend ClickHouse **optionnel**. |
| I3 | Debug IDs + lecture d'`ignoreList` | **M** | Le matching `(release, filename)` casse silencieusement au moindre changement de hash. |
| I4 | Cycle de vie des erreurs (états, first-seen, régression, ownership) | **M** | Le fingerprint n'est que la moitié du produit. |
| I5 | Serveur MCP | **S** | Devenu table-stake. Cohérent avec l'actif copilote : même socle, autre canal. |
| I6 | Échantillonnage et contrôle de coût exposés dans le produit | **M** | Seul levier qui rend le plafond Postgres tenable ; prérequis pour qu'un éditeur hôte construise son pricing par-dessus le nôtre. |
| I7 | Cache / pré-agrégation sur l'API de lecture, rollups activés | **M** | Attention : clé de cache **tenant-aware** obligatoire (vecteur de fuite n° 3 selon QueryPanel). |
| I8 | Rate-limiting et quotas distribués par tenant | **M** | Un rate-limit mémoire par isolat n'est pas un rate-limit. Rend le metering existant inexploitable. |
| I9 | Dossier de conformité opposable (auto-évaluation CNIL fiche 16, guide d'exemption, clauses Data Act art. 25) | **S** | Depuis le 01/01/2026, c'est **notre client** qui porte le risque. Livrer le dossier, c'est vendre de la couverture. |
| I10 | Modélisation SPA pages/views/navigations | **M** | Fenêtre ouverte : Chrome 151 stable **aujourd'hui**, 0 % de parc. Coût faible maintenant, prohibitif plus tard. |
| I11 | Attribut `delta` sur les web vitals | **S** | Sans lui, CLS et INP ne s'agrègent pas correctement entre deux rapports. |
| I12 | ISO 27001 | **XL** | À planifier, pas à démarrer maintenant. Plancher grand compte. |

### 6.3 Confort (à traiter plus tard, ou à trancher comme hors périmètre)

| # | Manque | Effort | Recommandation |
|---|---|---|---|
| C1 | Bascule spans → LogRecords pour le navigateur | **L** | Dette de moyen terme. Fenêtre de 12–24 mois. Aligner les **noms** dès maintenant. |
| C2 | Mobile natif iOS/Android | **L** | **Décision de périmètre explicite**, pas un trou honteux. Elastic est web-only ; Grafana n'a qu'un port RN « expérimental ». La cible commerciale tranche, pas la parité. |
| C3 | Endpoint Reporting API (crash d'onglet, JS jamais démarré) | **S/M** | Espace vide, aucune convention OTel. Différenciateur bon marché. |
| C4 | Alignement fin du vocabulaire d'attribution web-vitals v6 | **S** | Nommer autrement les sous-parties de LCP/INP désoriente et rend incomparable. |

---

## 7. Anti-recommandations

Ce que nous ne devons **pas** faire, compte tenu de notre taille et du paysage vérifié.

**① Ne pas facturer à la session.** C'est le modèle dominant (Dynatrace 2,25 $/1 000 VÉRIFIÉ, Grafana 0,75 $/1 000 VÉRIFIÉ, Raygun 0,80 $/1 000 VÉRIFIÉ) et le plus critiqué : la variable de coût est le succès commercial du client. En OEM, c'est un anti-alignement frontal — nous pénaliserions l'éditeur hôte exactement quand il réussit. *Si* une unité « session » est exposée quelque part, respecter la convention de fait (15 min d'inactivité / 4 h max, VÉRIFIÉ Datadog) : s'en écarter rend toute comparaison impossible et sera lu comme une manipulation.

**② Ne jamais placer RLS, isolation multi-tenant, SSO, RBAC ou audit dans un palier supérieur.** C'est l'anti-pattern le plus durement sanctionné du segment embedded : *« low entry price is not useful if isolation controls sit in a higher tier »*. Metabase réserve white-label **et** multi-tenant au plan Pro à 575 $/mois ; SigNoz facture un Enterprise à partir de ~4 000 $/mois avec multi-tenancy et RBAC encore « coming soon ». Nous avons déjà SSO OIDC et RBAC : les garder en socle inclus, définitivement, et l'écrire dans la grille tarifaire.

**③ Ne pas construire de moteur de replay propriétaire, ni se différencier sur « avoir du replay » ou « masquer par défaut ».** rrweb est OSS ; Grafana le livre en Apache-2.0 masqué par défaut ; rrweb Cloud vend même un SDK en marque blanche avec passage par votre propre domaine et option self-hosted. Nous utilisons déjà rrweb : c'est le bon choix, ne pas le remettre en cause.

**④ Ne pas monétiser le volume de replays.** AWS l'offre gratuitement depuis mai 2026 ; Contentsquare donne 10 000 replays/mois en free tier ; Sentry facture le replay **au même prix en Team et en Business** — il ne le monétise pas, c'est un produit d'appel. Tout palier payant sous 10 000 replays/mois est indéfendable.

**⑤ Ne pas copier le tiering Measure/Investigate de Datadog en croyant vendre une économie.** Vérification faite, ce ne sont pas deux paliers alternatifs mais des achats qui **s'empilent** : un RUM Datadog exploitable exige trois lignes facturées séparément. Le « facteur 20 » n'est pas une remise, c'est une décomposition qui augmente le total et rend la simulation impossible.

**⑥ Ne pas bâtir sur `@opentelemetry/browser-sdk` 0.1.0, ni attendre la stabilisation des conventions browser.** Version unique, métriques hors périmètre, tous les imports sous `./experimental/*`, 8 versions en 4 mois, aucun paquet 1.x sur le chemin critique (`api-logs ^0.220.0`), page de guide RUM web vide, browser absent des cibles de stabilisation 2026. Le bon geste : **aligner le vocabulaire derrière une couche d'abstraction**, pas adopter. Et ne jamais revendiquer une conformité qui n'existe pas — un acheteur technique qui vérifie nous décrédibilise sur tout le reste.

**⑦ Ne pas parier sur OTel Profiles.** Public Alpha (mars 2026), *« should not be used for critical production workloads »*, aucun backend production-ready, aucune implémentation stable par langage, aucun pont entre le JS Self-Profiling API et OTLP Profiles.

**⑧ Ne jamais écrire « hébergé chez OVHcloud donc SecNumCloud ».** La qualification porte sur des périmètres nommés. Corollaires : ne pas affirmer que « SecNumCloud est obligatoire » (le décret admet une certification européenne équivalente), ne pas présenter Bleu comme qualifié (jalon J0 validé le 17/04/2025, disponibilité commerciale attendue S2 2026), et ne pas confondre européen et UE/EEE.

**⑨ Ne pas construire l'argumentaire sur « cookieless donc pas de bandeau ».** EDPB 2/2023 étend l'art. 5(3) aux pixels, tracking d'URL, tracking par IP et fingerprinting ; le Digital Omnibus **n'exempte pas** les outils tiers. Notre vrai argument est **zéro IP collectée**.

**⑩ Ne pas viser la parité fonctionnelle avec les leaders.** Funnels, heatmaps sur replay, pathways, rétention, product analytics, profiling navigateur, mobile TV/wearables, LLM observability : chacune est un produit à part entière — Datadog a dû **scinder** Product Analytics du RUM au 01/06/2025. Poursuivre la parité est le meilleur moyen de n'être crédible nulle part.

**⑪ Ne pas retenir une licence FSL si l'OEM est stratégique.** La FSL-1.1 de Sentry exclut nommément les *Competing Uses*, c'est-à-dire *« making the Software available to others in a commercial product or service »* — Sentry est **juridiquement inutilisable en OEM** pendant les deux ans précédant la bascule Apache 2.0. Point contre-intuitif à exploiter : l'**AGPLv3 est devenue la licence majoritaire du segment** (OpenObserve, Uptrace, Parseable, Grafana, OpenReplay, SigNoz community), donc commercialement banale et peu risquée en acceptabilité client, tout en nous protégeant d'un fork SaaS fermé. Le vrai danger est **MIT** : HyperDX est en MIT pur sur un produit complet financé par ClickHouse Inc., donc forkable et commercialisable contre nous.

**⑫ Ne pas copier le TTL de jeton d'embed de 24 h d'Explo.** Norme haute : « minutes seulement » (Grafana), validation via JWKS, rôle viewer read-only par défaut, jamais de jeton dans l'URL (fuite par `Referer` et logs d'accès), gestion explicite de l'expiration.

**⑬ Ne pas bâtir le narratif de vente sur l'explosion des factures.** Voir § 1.1 ⑤. C'est un artefact du marketing des challengers ; les données soutiennent la réduction du bruit et la défense de revenu.

**⑭ Ne pas se fier aux comparatifs de prix publiés par des concurrents.** Sur cinq fournisseurs revérifiés en source primaire (Luzmo, LogRocket, Holistics, Preset, Tinybird), **trois étaient significativement faux ou mal catégorisés** — Luzmo était annoncé à 1 995 $/mois pour débloquer le white-label alors que la page officielle donne **€995/mois avec white-label inclus dès l'entrée de gamme**. Aucun prix concurrent ne doit entrer dans un document MIP sans capture datée de la page officielle du vendeur.

**⑮ Ne pas viser une qualification SecNumCloud en propre à ce stade.** Le chemin praticable est l'empilement : SaaS souverain sur socle déjà qualifié ou classé SEAL-2/SEAL-3, à l'image de SAP sur Bleu puis sur S3NS. Viser d'abord ISO 27001, éventuellement C5:2026, et laisser SecNumCloud à un jalon tiré par un appel d'offres réel.

**⑯ Ne pas laisser l'ingestion fail-open « le temps de finaliser autre chose », ni différer la RLS.** Ce sont les deux points sur lesquels un acheteur OEM ou un RSSI nous arrête en une question. **Tout investissement fonctionnel réalisé avant leur correction est de l'investissement à risque.**

---

## 8. Recommandations : épics actionnables

### 8.1 Ce que le scan dit de la roadmap existante

| Épic | Verdict du scan | Mouvement |
|---|---|---|
| **E1 — Sécurité** | **Confirmé, et promu au rang de préalable absolu.** Fail-open et absence de RLS sont les deux disqualifiants nommés en appel d'offres embedded. | **↑↑ Monte au rang de gate** |
| **E2 — Packaging OEM** | **Confirmé dans le principe, réordonné dans l'exécution.** Le chemin le plus court vers un revenu OEM n'est pas la console embarquée (effort L) mais l'**API headless** : l'éditeur hôte dessine sa propre UI et consomme nos données. Il ne manque que le scoping tenant et un JWT court. | **↑ Monte, mais découpé : headless d'abord** |
| **E3 — Scale / ClickHouse** | **Nuancé.** Notre propre bench montre que PG gagne sur la petite requête ; la migration n'est pas urgente sous quelques M events/j. En revanche la **couche de dialecte** (point d'indirection) est le vrai bloqueur et elle, elle est urgente. | **↓ Migration descend / ↑ Indirection monte** |
| **E4 — SaaS multi-tenant (signup, billing)** | **Descend.** Le plancher de prix du self-serve est fixé par Clarity (gratuit illimité), Grafana (50 000 sessions/mois gratuites) et Contentsquare (200 k sessions dont 10 k replays). Notre marché prioritaire est OEM + self-host souverain, pas le self-serve. | **↓↓ Descend fortement** |
| **E5 — White-label / embed** | **Descend derrière E2-headless**, mais reste nécessaire pour clore un deal OEM (chez Grafana, le white-label est absent de l'OSS et conditionne le deal). | **↓ Descend d'un cran, reste obligatoire** |
| **E6 — Commercial / légal** | **Monte fortement.** Identité légale et DPA sont bloquants pour un coût quasi nul ; le dossier CNIL fiche 16 est le meilleur rapport effort/valeur commerciale du dossier ; les clauses Data Act art. 25 sont **déjà applicables depuis le 12/09/2025**. | **↑↑ Monte fortement** |
| **E7 — UI intelligente v2** | **Monte.** C'est notre seul différenciateur unique et il répond à la douleur mesurée (bruit 34 %, fatigue d'alerte 30 %). Ajouter le serveur MCP, devenu table-stake. | **↑ Monte** |
| **E0 — Conformité standards** *(nouveau)* | **Épic manquant, et c'est le plus haut ROI du plan.** Trace context W3C, seuils LCP, `delta`, publication npm. | **Nouveau — priorité 1** |

### 8.2 E0 — Conformité standards *(nouveau, priorité 1)*

**Objectif.** Rendre vraie la phrase « OTLP standard, aucun lock-in, réversible ».

| Story | Détail | Effort |
|---|---|---|
| E0-1 | Émettre le **vrai contexte W3C dans les champs natifs du span** : `traceId`/`spanId` réels, `parentSpanId`, `kind`, `status`, `flags`. Conserver `mip.trace_id`/`mip.span_id` en lecture pendant une fenêtre de compatibilité, puis les retirer. | M |
| E0-2 | Sortir la clé d'API des attributs de resource ; l'envoyer en **en-tête HTTP**. Vérifier `Origin` contre `allowed_origins` à l'ingestion. | S |
| E0-3 | Corriger les seuils LCP à `[2500, 4000]` aux trois emplacements (`vitals.ts:14`, `otlp.mjs:13`, `rating.ts:6`) + test de non-régression. | S |
| E0-4 | Ajouter `delta` aux web vitals ; aligner les noms d'attributs sur `browser.web_vital` (name/value/delta/id/rating/navigation_type). | S |
| E0-5 | Publier `@mip/rum-sdk`, `@mip/agent-node`, `@mip/rum-mobile` sur npm et le middleware FastAPI sur PyPI, avec versionnement sémantique et CHANGELOG. | S |
| E0-6 | Passer web-vitals à **≥ 6.0.1** après validation (correctif d'exception quand `PerformanceObserver` est absent). | S |
| E0-7 | Publier un **jeu de conformité OTLP** : payloads de référence (SDK officiel OTel, Collector, notre SDK) rejoués contre `flattenOtlp`, dans le dépôt. Artefact d'avant-vente qu'aucun concurrent européen ne publie. | S |

**Critère de sortie.** Un Collector OTel placé entre le SDK et l'ingestion préserve la corrélation de bout en bout, démontré par un test d'intégration en CI.

### 8.3 E1 — Sécurité et isolation *(gate absolu)*

| Story | Détail | Effort |
|---|---|---|
| E1-1 | `REQUIRE_API_KEY` par défaut à **true**. Supprimer les trois chemins de repli fail-open (`auth.mjs:33`, `:61-65`, `:100`). | S |
| E1-2 | Modèle `organization` → `application`, migration des `app_id` existants, propagation dans l'auth, la read-API et la console. | L |
| E1-3 | **RLS Postgres** sur toutes les tables de données, policy sur un paramètre de session `mip.tenant_id` posé par le middleware. Rôle applicatif distinct du rôle de migration. Interdire `service_role` sur les chemins de lecture. | L |
| E1-4 | Rate-limiting et quotas **distribués** par tenant (compteur en base ou store partagé), fail-**closed**, avec enforcement effectif du metering existant. | M |
| E1-5 | Suite de tests d'isolation : pour chaque route et chaque export, vérifier qu'un jeton du tenant A ne peut rien lire du tenant B, y compris via cache, replay chunks et sourcemaps. | M |

### 8.4 E2 — OEM headless *(le chemin le plus court vers un revenu)*

| Story | Détail | Effort |
|---|---|---|
| E2-1 | Endpoint serveur-à-serveur de frappe de **jeton d'embed court** (durée en minutes), signé, portant `tenant_id` + périmètre + origine autorisée. Clé secrète jamais exposée au navigateur. | M |
| E2-2 | Scoping tenant de toutes les routes `/api/v1/*` sur le jeton, jamais sur un paramètre client. | M |
| E2-3 | Cache de lecture **tenant-aware** (clé incluant le tenant), TTL 1–5 min, + activation des rollups horaires par défaut. | M |
| E2-4 | Serveur **MCP** exposant les mêmes données, scopé par le même jeton. | S |
| E2-5 | Calculateur public de coût à **1×, 2× et 5×** l'usage courant (exigence formelle des acheteurs 2026). | S |
| E2-6 | Documentation OEM : handshake en 3 temps, exemples Node/Python, contrat de versionnement de l'API. | S |

### 8.5 E3 — Indirection de stockage *(remplace « migration ClickHouse »)*

| Story | Détail | Effort |
|---|---|---|
| E3-1 | Introduire une **couche de dialecte de lecture** : toutes les requêtes de la console passent par une interface unique, implémentée pour PG puis pour CH. | L |
| E3-2 | Activer les rollups horaires par défaut ; arrêter de recalculer les p75 sur les tables brutes. | M |
| E3-3 | Câbler l'implémentation ClickHouse existante derrière l'interface, en mode `both` réversible (runbook `DEPLOY.md` déjà écrit). | M |
| E3-4 | Ajouter `tenant_id` en `PARTITION KEY` + `ORDER BY` du schéma CH → suppression instantanée d'un tenant par `DROP PARTITION` (argument Art. 17 directement vendable). | S |
| E3-5 | Documenter publiquement le **plafond volumétrique Postgres** comme caractéristique produit, avec le bench reproductible en appui. | S |

**Décision explicite : ClickHouse reste optionnel.** Postgres pour les déploiements sous ~1 M events/jour — la majorité du marché public français ; ClickHouse pour les grands comptes. C'est ce qui préserve notre argument mono-composant.

### 8.6 E4 — Self-host complet *(remonté depuis « SaaS multi-tenant »)*

| Story | Détail | Effort |
|---|---|---|
| E4-1 | **Conteneuriser la console** (Next.js standalone), l'ajouter au compose. | M |
| E4-2 | Écrire les **jumeaux Node** des deux edge functions Deno (replay, uptime) ; le parseur étant déjà portable, c'est un travail de wiring. | M |
| E4-3 | Remplacer les jobs pg_cron/pg_net par un **worker de tâches** conteneurisé (purge, rollups, uptime), avec le mode Supabase conservé en variante. | M |
| E4-4 | **Chart Helm** officiel + manifestes K8s de référence. | M |
| E4-5 | Faire tourner le job CI **build + smoke** du compose (jamais exécuté à ce jour) et l'étendre à la console. | S |
| E4-6 | Guide d'installation < 5 min (compose) + guide prod K8s (Helm), sur le modèle des 6 modes de ClickStack. | S |

**Le SaaS self-serve (signup, billing, plans) est explicitement reporté** — voir § 8.1.

### 8.7 E5 — White-label et embed visuel *(après E2)*

| Story | Détail | Effort |
|---|---|---|
| E5-1 | Thématisation par design tokens / variables CSS, mode clair **et** sombre, logo et couleurs par tenant. | M |
| E5-2 | Neutralisation de la marque MIP (login, en-têtes, e-mails, exports). | M |
| E5-3 | Autorisation d'embarquement : `frame-ancestors` **scopée par tenant** (jamais `X-Frame-Options`), origines HTTPS explicites, rôle viewer read-only par défaut en session embarquée. | M |
| E5-4 | Contrat **postMessage versionné** dès le départ (masquer le logo, synchroniser une plage de dates, transmettre un contexte) — sinon chaque intégration devient du travail manuel. | M |
| E5-5 | Composants embarquables (panneau unique) en plus de l'iframe pleine page. | L |

### 8.8 E6 — Commercial et légal *(remonté)*

| Story | Détail | Effort |
|---|---|---|
| E6-1 | Renseigner l'**identité légale réelle** dans CGU/CGV/DPA ; DPA art. 28 signable en ligne sans commercial. | S |
| E6-2 | Page publique **sous-traitants**, datée, versionnée, avec préavis de changement. | S |
| E6-3 | **Trust center** : posture de sécurité, chemin de données prouvant l'absence de colonne IP, politique de rétention. | S |
| E6-4 | **Dossier d'auto-évaluation CNIL fiche n° 16** pré-rempli + guide de configuration d'exemption livré au client. | S |
| E6-5 | Clauses **Data Act art. 25** dans le contrat : préavis ≤ 2 mois, transition 30 j extensible, justification d'infaisabilité sous 14 j ouvrés, aucun frais de sortie. | S |
| E6-6 | **Arbitrage de licence** (voir § 7 ⑪) : recommandation AGPLv3 sur le cœur + licence commerciale pour l'OEM et le white-label. | S |
| E6-7 | Lancer le chantier **ISO 27001** (horizon 12–18 mois). | XL |

### 8.9 E7 — UI intelligente v2 *(différenciateur)*

| Story | Détail | Effort |
|---|---|---|
| E7-1 | **Instrumenter et exposer la vérification de citations** : journal, taux de rejet, rejeu d'une réponse, test automatisé démontrant la suppression des marqueurs non sourcés. Transformer la promesse en contrôle auditable. | M |
| E7-2 | Étendre le **briefing déterministe** aux régressions de release et aux nouvelles erreurs (dépend de E7-4). | M |
| E7-3 | Assistant disponible hors console via **MCP** (E2-4) — l'éditeur hôte branche ses propres agents. | S |
| E7-4 | **Cycle de vie des erreurs** : états (nouveau / en cours / réapparu / résolu-dans-la-release / archivé), alerte first-seen, détection de régression branchée sur les deploy markers, assignation. | M |
| E7-5 | **Debug IDs** + lecture d'`ignoreList` pour replier le code framework dans les stacks. | M |
| E7-6 | **Privacy replay** : `maskAllText` et blocage des médias par défaut, masquage conditionné au statut de consentement au niveau de l'élément, **rétention différenciée par finalité** (heures pour le support, mois pour l'UX/erreurs), preuve de consentement exploitable. | M |
| E7-7 | **Échantillonnage et contrôle de coût** exposés : taux continu + capture on-error à buffer glissant, filtres de rétention, consommation visible dans l'UI. | M |
| E7-8 | **Modèle SPA** pages/views/navigations, distinction hard/soft, réinitialisation d'INP et CLS par intervalle de soft nav, ingestion de la Soft Navigations API avec fallback heuristique conservé. | M |
| E7-9 | Règles d'alerte **recommandées en un clic** depuis les pages de résumé (pattern New Relic). | S |
| E7-10 | Endpoint **Reporting API** (`Reporting-Endpoints`) pour capturer crashs d'onglet et pages dont le JS n'a jamais démarré. | S/M |

### 8.10 Séquencement proposé

| Vague | Contenu | Objectif de sortie |
|---|---|---|
| **V1 — Crédibilité** (semaines 1–6) | E0 intégral, E1-1, E6-1 → E6-6 | Le produit devient *démontrable* et *signable*. Fin du fail-open, standards justes, SDK publiés, papiers en règle. |
| **V2 — Isolation** (semaines 4–14) | E1-2 → E1-5, E7-6, E7-4 | Le produit devient *achetable* par un grand compte et *évaluable* par un éditeur. |
| **V3 — OEM headless** (semaines 10–20) | E2 intégral, E7-1, E7-3 | Premier revenu OEM possible sans console embarquée. |
| **V4 — Souveraineté livrable** (semaines 14–26) | E4 intégral, E3-1 → E3-2 | Le self-host devient un produit complet, pas un endpoint. |
| **V5 — Tiré par les deals** | E5, E3-3 → E3-5, E7 reste, E6-7 | White-label et ClickHouse **après** signature, pas avant. |

---

## 9. Positionnement recommandé

### 9.1 Le pitch en une phrase

> **MIP RUM est le moteur d'observabilité front que vous embarquez dans votre produit et qui tourne chez votre client — un seul composant à exploiter, aucune donnée personnelle collectée, et un copilote de diagnostic dont chaque affirmation est adossée à une source vérifiée. Le seul du marché à réunir ces quatre propriétés.**

**Ce que le pitch ne dit pas, volontairement :** « RUM souverain ». Ce slogan est déjà mieux tenu par **Dash0** — société allemande, régions UE, SOC 2 Type II, plus de 600 clients payants dont Zalando et The Telegraph, 155 M$ levés dont une Série B de 110 M$ menée par Balderton avec les véhicules de **Deutsche Telekom** au capital (VÉRIFIÉ). Sur la géographie, nous n'avons rien à opposer. Nous différencions sur le **self-host**, la **réversibilité** et l'**IA on-premise**.

### 9.2 Cible prioritaire

**Cible primaire — éditeurs SaaS et intégrateurs européens qui doivent livrer de la supervision à *leurs* clients sous contrainte de souveraineté.** Verticales : santé (HDS v2, EEE obligatoire depuis le 16/05/2026), secteur public et para-public (décret 2026-272, circulaire Bercy), industrie et défense (précédent Thales/Siemens sur le programme OEM Grafana), finance régulée. Déclencheur d'achat : réglementaire et daté, pas technique.

**Cible secondaire — organisations sous contrainte de résidence qui veulent une IA de diagnostic.** C'est le segment que Sentry ne peut pas servir par licence, que Datadog et Dynatrace ne peuvent pas servir par architecture.

**Non-cible assumée : le self-serve développeur.** Le plancher y est fixé par Clarity (gratuit, sans limite de trafic), Grafana (50 000 sessions/mois gratuites) et Contentsquare (200 k sessions dont 10 k replays). Nous n'y avons aucun avantage.

### 9.3 Modèle de prix conseillé

**Principe directeur : facturer la capacité déployée et le périmètre, jamais le succès commercial du client.**

| Offre | Unité | Ordre de grandeur proposé | Référence marché (VÉRIFIÉ) |
|---|---|---|---|
| **Community self-hosted** | — | Gratuit, illimité en volume et en rétention, **SSO + RBAC + isolation inclus** | Matomo Community (illimité), OpenObserve Enterprise gratuit ≤ 50 Go/j, Coroot Apache 2.0 |
| **Self-host souscription** | Instance / an, palier de volume | **6 000 – 18 000 €/an** | Metabase Enterprise ≥ 20 000 $/an ; SigNoz Enterprise dès 4 000 $/mois ; groundcover On Prem 50 $/nœud/mois |
| **OEM / white-label** | Licence par déploiement + palier de volume agrégé, remise dégressive | **25 000 – 80 000 €/an** | Grafana OEM (aucun prix public) ; Preset Enterprise jusqu'à −90 % de remise volume sur les viewers embarqués |
| **Cloud managé (secondaire)** | Forfait par tenant dégressif | 30–100 € / 10–50 € / 2–20 € par tenant/mois selon le parc | Benchmarks Toucan (REVENDICATION ÉDITEUR, à traiter comme hypothèse) |
| **Add-on copilote souverain** | Forfait ou crédits | À arbitrer | Metabase 3,75 $/M tokens ; LogRocket 500 crédits MCP/mois en Pro ; Dash0 0,60 $/crédit Agent0 |

**Règles non négociables.**
1. Sécurité, isolation, SSO, RBAC, audit : **toujours dans le socle inclus**, jamais en palier. C'est un argument de vente gratuit contre SigNoz, OpenReplay et Metabase.
2. **Aucun frais de sortie**, export complet documenté — conformité Data Act art. 25/29, applicable dès maintenant.
3. Prix publics affichés jusqu'au palier Enterprise. Le « contactez-nous » n'est toléré qu'au-dessus.
4. Calculateur de coût à 1×, 2×, 5× publié.
5. Si un modèle à l'usage est un jour introduit, privilégier **compute + stockage** (modèle Tinybird : vCPU-seconde + Go) ou un **forfait par instance**, jamais la session ni le siège.

### 9.4 Les deux fenêtres temporelles à exploiter maintenant

**Fenêtre 1 — OTel côté navigateur : 12 à 24 mois.** Le SDK est en 0.1.0, tout est sous `./experimental/`, browser n'est pas dans les cibles de stabilisation 2026, la page de guide RUM web est vide. Aligner dès aujourd'hui les noms d'événements et d'attributs sur le dépôt `open-telemetry/opentelemetry-browser` pour que la convergence future soit un **adaptateur** et non une réécriture.

**Fenêtre 2 — Soft Navigations : ouverte aujourd'hui même.** Chrome 151 est passé stable le 28/07/2026, donc **0 % de parc**. Personne ne peut être en avance. Construire l'ingestion soft-nav maintenant permet d'être prêt le jour où le parc bascule, sans course. Message commercial correct : *« prêt le jour où le parc bascule »*, et non *« nous mesurons déjà les soft navs »*.

### 9.5 Ce qu'il faut renoncer à dire

| Ambition | Verdict honnête |
|---|---|
| « Le Datadog européen » | **Irréaliste.** Les trous fonctionnels du panel sont étroits ; la parité est perdue d'avance pour une petite équipe. |
| « RUM souverain » | **Déjà occupé** par Dash0, mieux financé et adossé à Deutsche Telekom. Différencier sur le self-host, pas la géographie. |
| « Session replay privacy-first » | **Table-stake.** Datadog, Sentry et Faro masquent déjà par défaut ; AWS l'offre gratuitement. |
| « OTel-native, donc réversible » | **Faux aujourd'hui** (§ 3.3). Vrai après E0. Ne pas le dire avant. |
| « Votre facture Datadog explose » | **Non soutenu par les données** (§ 1.1 ⑤). |
| « Nous sommes SecNumCloud car hébergés chez OVH » | **Faux et disqualifiant** en appel d'offres. |

---

## 10. Sources

### OpenTelemetry / standards
- https://opentelemetry.io/docs/specs/otlp/ — OTLP 1.11.0, stabilité par transport, encodage JSON (hex, lowerCamelCase, enums entiers)
- https://opentelemetry.io/docs/specs/status/ — maturité par signal
- https://opentelemetry.io/docs/specs/semconv/ — semconv 1.43.0
- https://github.com/open-telemetry/semantic-conventions/blob/main/model/browser/events.yaml — `browser.web_vital` (source de vérité)
- https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/session.md — `session.id` / `session.previous_id`, statut Development
- https://github.com/open-telemetry/semantic-conventions/blob/main/CHANGELOG.md — 1.42.0 (entité `browser.document`), sortie de `gen_ai`
- https://github.com/open-telemetry/semantic-conventions/issues/3330 — roadmap 2026, browser hors cibles de stabilisation
- https://opentelemetry.io/docs/platforms/client-apps/web/ — **« Content coming soon! »**
- https://www.npmjs.com/package/@opentelemetry/browser-sdk — v0.1.0, 09/07/2026
- https://www.npmjs.com/package/@opentelemetry/browser-instrumentation — v0.6.0, 13/07/2026
- https://github.com/open-telemetry/opentelemetry-browser
- https://opentelemetry.io/blog/2026/profiles-alpha/ — Public Alpha, non production
- https://opentelemetry.io/docs/specs/otel/entities/data-model/ — Entity Data Model, Development

### W3C / plateforme web
- https://www.w3.org/TR/trace-context/ — Recommendation, 06/02/2020
- https://www.w3.org/TR/trace-context-2/ — CR Draft du 28/03/2024, non avancé
- https://www.w3.org/standards/history/baggage/ — CR Snapshot du 30/05/2024
- https://www.w3.org/TR/server-timing/ — Working Draft, 07/04/2026
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming — non Baseline
- https://developer.mozilla.org/en-US/docs/Web/API/Reporting_API — Baseline mars 2026
- https://developer.chrome.com/docs/web-platform/soft-navigations — Chrome 151, page mise à jour 21/07/2026
- https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=151 — `stable_date` 2026-07-28
- https://web.dev/articles/vitals — seuils CWV, page inchangée depuis le 31/10/2024
- https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md — v6.0.1 (27/07/2026), v6.0.0 (21/07/2026)
- https://tc39.es/ecma426/ et https://github.com/tc39/ecma426 — ECMA-426, stages des propositions
- https://github.com/tc39/ecma426/blob/main/proposals/debug-id.md

### Leaders APM/RUM
- https://docs.datadoghq.com/account_management/billing/rum/ — définition de session (15 min / 4 h), facturation par 1 000 sessions, règle anti-double-comptage
- https://docs.datadoghq.com/real_user_monitoring/session_replay/browser/privacy_options/ — `defaultPrivacyLevel = mask`, masquage inconditionnel
- https://docs.datadoghq.com/real_user_monitoring/ai_investigations/ — Single-View / Multi-View / Operation
- https://docs.newrelic.com/docs/browser/browser-monitoring/getting-started/browser-summary-page/
- https://newrelic.com/pricing/compute — définition CCU, 100 Go gratuits puis 0,40 $/Go
- https://www.dynatrace.com/pricing/ — RUM 2,25 $/1 000, replay 4,50 $/1 000, 35 j
- https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/web-frontends/concepts/pages-views-and-navigations
- https://www.elastic.co/docs/solutions/observability/applications/otel-rum — *« should not be used in production environments »*
- https://grafana.com/products/cloud/frontend-observability/ et https://grafana.com/pricing/
- https://raygun.com/pricing
- https://www.ibm.com/docs/en/instana-observability/current?topic=planning-deployment-options — self-hosted, air-gapped
- https://github.com/DataDog/browser-sdk/issues/2696 — support Soft Navigations, ouverte depuis avril 2024

### Erreurs & replay
- https://sentry.io/pricing/ et https://docs.sentry.io/pricing/ — plans, tarifs unitaires réservé/PAYG
- https://github.com/getsentry/sentry/blob/master/LICENSE.md — **FSL-1.1-Apache-2.0**, clause *Competing Uses*
- https://develop.sentry.dev/self-hosted/ — exclusion de Seer et des fonctionnalités AI/ML du self-hosted
- https://docs.sentry.io/platforms/javascript/session-replay/privacy/ — `maskAllText`, `blockAllMedia`
- https://docs.sentry.io/concepts/data-management/event-grouping/ et /product/issues/states-triage/
- https://docs.sentry.io/platforms/javascript/sourcemaps/troubleshooting_js/debug-ids/
- https://logrocket.com/pricing — Core ~176 $/mois, pas de free tier, self-host Enterprise
- https://help.fullstory.com/hc/en-us/articles/360044349073-Fullstory-Private-by-Default
- https://clarity.microsoft.com/ — *free forever, no limits on traffic*
- https://contentsquare.com/blog/enhanced-contentsquare-plans/ — 200 k sessions / 10 k replays
- https://www.bugsnag.com/pricing/
- https://highlight.io/blog/launchdarkly-migration — extinction le 28/02/2026
- https://openreplay.com/pricing/ et https://raw.githubusercontent.com/openreplay/openreplay/main/LICENSE — **AGPLv3** (et non ELv2)
- https://github.com/grafana/faro-web-sdk/blob/main/CHANGELOG.md — v2.3.0 (03/06/2026) masquage total par défaut
- https://www.npmjs.com/package/@grafana/faro-instrumentation-replay
- https://rrweb.com/ et https://github.com/rrweb-io/rrweb
- https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-cloudwatch-rum-session/ — Session Replay **sans coût additionnel**

### Open source / self-host
- https://signoz.io/pricing/ — 49 $/mois (baissé de 199 $), Enterprise dès 4 000 $/mois
- https://github.com/SigNoz/signoz/blob/main/LICENSE — MIT + exception `ee/`
- https://clickhouse.com/docs/use-cases/observability/clickstack/overview — 6 modes, dépendance MongoDB
- https://github.com/hyperdxio/hyperdx — **MIT pur**
- https://openobserve.ai/pricing/ et https://github.com/openobserve/openobserve — AGPL-3.0, Enterprise self-hosted gratuit ≤ 50 Go/j
- https://uptrace.dev/pricing et https://github.com/uptrace/uptrace — AGPL-3.0
- https://coroot.com/pricing/ — 1 $/cœur/mois, SSO + RBAC inclus dès Standard
- https://www.groundcover.com/pricing — 30 / 35 / **50 $** par nœud/mois (On Prem)
- https://www.dash0.com/pricing — 0,60 $/M web events, rétention events 30 j
- https://raw.githubusercontent.com/parseablehq/parseable/main/LICENSE — AGPLv3
- https://grafana.com/press/2026/03/18/... — enquête Observability 2026 : complexité 38 %, signal/bruit 34 %, coût 31 %, fatigue d'alerte 30 %

### Souveraineté & privacy UE
- https://commission.europa.eu/news-and-media/news/commission-advances-cloud-sovereignty-through-strategic-procurement-2026-04-17_en — tender 180 M€, niveaux SEAL, lauréats
- https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053900789 — décret n° 2026-272 du 14/04/2026
- https://www.numerique.gouv.fr/offre-accompagnement/cloud-administrations/la-doctrine-cloud-etat/ — « ou qualification européenne d'un niveau au moins équivalent »
- https://www.ovhcloud.com/en/compliance/secnumcloud/ — périmètres nommés
- https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation — 25/02 → 22/04/2026
- https://www.cnil.fr/fr/recommandation-pixel-suivi-courriels — délibération n° 2026-042 du 12/03/2026, conformité au 14/07/2026
- https://www.cnil.fr/sites/default/files/2025-07/outil_d_auto-evaluation_mesure_d_audience.pdf — fiche n° 16, 5 objectifs / 14 critères
- https://www.edpb.europa.eu — lignes directrices 2/2023 (07/10/2024) et 01/2025 (16/01/2025)
- https://matomo.org/faq/how-to/how-do-i-configure-matomo-without-tracking-consent-for-french-visitors-cnil-exemption/
- https://plausible.io/data-policy — `hash(daily_salt + domain + ip + user_agent)`
- https://pirsch.io/pricing — hash IP + User-Agent
- https://usefathom.com/features/eu-isolation — stockage final aux États-Unis
- https://piwik.pro/pricing/ — 6 régions, ISO 27001 sur tous les plans
- https://esante.gouv.fr — HDS v2, butoir 16/05/2026, stockage EEE
- https://www.bsi.bund.de — C5:2026, obligatoire à partir du 01/06/2027

### OEM / embedded / pricing
- https://grafana.com/partnerships/oem-partners/ — white-label / embed / distribute ; **aucun prix public**
- https://grafana.com/blog/how-to-embed-grafana-dashboards-into-web-applications/ — `allow_embedding`, CSP `frame-ancestors`, JWT via JWKS, durées « en minutes »
- https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/configure-custom-branding/ — white-label absent de l'OSS, disponible dès un compte Cloud **payant**
- https://github.com/cube-js/cube — backend **Apache 2.0**, client MIT
- https://www.tinybird.co/blog/multi-tenant-saas-options — JWT signé portant les politiques RLS
- https://tinybird.co/pricing — modèle vCPU + stockage
- https://www.metabase.com/pricing — Pro 575 $/mois (white-label + multi-tenant), Enterprise ≥ 20 000 $/an
- https://www.luzmo.com/pricing — **Starter €995/mois, white-label inclus** (invalide les comparatifs tiers)
- https://docs.explo.co/api-reference/customer-api/generate-jwt — `embed_origin`, expiration par défaut **24 h**
- https://omni.co/explo — Explo absorbé, migration sous 12 mois depuis octobre 2025
- https://www.sisense.com/blog/embedded-analytics-security/ — mise en garde contre la RLS UI-only
- https://querypanel.io/blog/best-embedded-analytics-tools-rls-tenant-isolation-saas — 4 vecteurs de fuite inter-tenants
- https://querypanel.io/blog/iframe-vs-native-react-embedded-analytics-2026 — arbitrage iframe / SDK React
- https://oneuptime.com/blog/post/2026-02-06-per-tenant-observability-isolation-opentelemetry/view — `tenant.*` en **span attributes**, routage par `tenant.plan`
- https://preset.io/pricing/ — 500 $/mois pour 50 viewers embarqués

### Fichiers du monorepo cités
`packages/rum-sdk/src/otel.ts` (l. 87, 109-110) · `packages/rum-sdk/src/vitals.ts` (l. 14, 40-47) · `packages/rum-sdk/src/otlp-encode.ts` (l. 76-83) · `apps/ingest/supabase/functions/_shared/otlp.mjs` (l. 13, 388-490) · `apps/ingest/supabase/functions/_shared/auth.mjs` (l. 33, 61-65, 72, 100) · `apps/console/lib/rating.ts` (l. 6) · `apps/console/app/api/sourcemaps/route.ts` · `apps/ingest/sql/schema.sql` + 43 migrations · `infra/docker/` · `infra/clickhouse/{schema.prod.sql, writer.mjs, bench.mjs, DEPLOY.md, otel-collector.example.yaml}`

---

*Document produit selon la méthode BMAD à partir de six scans de marché vérifiés sur sources primaires et de deux analyses d'écart adossées à un audit du code. Les points marqués « à confirmer » ne doivent pas être utilisés en argumentaire externe sans vérification préalable.*