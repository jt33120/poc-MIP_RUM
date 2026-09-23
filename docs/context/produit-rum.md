# Fiche produit — Supervision RUM

> **Niveau de maturité : N2 « Exploitable »**, avec un outillage d'analyse déjà
> de niveau N3 mais **une boucle d'action ouverte**.
> Plafonné par l'axe A5 (Action) : 637 alertes déclenchées, **0 livrée**.

*Établie le 29 juillet 2026. Grille : [README.md](./README.md#2-grille-de-maturité-employée).*

---

## 1. Identité

**Ce que c'est.** La supervision de l'expérience réelle des utilisateurs : ce que
vit un vrai visiteur sur un vrai navigateur — vitesse de chargement, réactivité,
erreurs JavaScript, parcours, frustration — étendue aux traces serveur pour
relier le symptôme perçu à sa cause technique.

**Ce que ce n'est pas.** Ni du monitoring d'infrastructure (CPU, mémoire), ni de
l'analytics produit (entonnoirs marketing, cohortes), ni du test synthétique — le
module `uptime` existe mais reste marginal (1 sonde configurée).

**Propriétaire :** `mip-rum`, intégralement. C'est le cœur du produit.

---

## 2. Ce qui existe réellement

### 2.1 Collecte

| Émetteur | Chemin | État |
|---|---|---|
| SDK web | `packages/rum-sdk/src/` — 21 modules | Complet, en production |
| SDK mobile | `packages/rum-mobile/src/` (React Native) | Écrit, adoption inconnue |
| Agent serveur Node | `packages/agent-node/src/` — HTTP + `pg` par hook `require` | Écrit, profondeur DB récente |
| Intégration Python | `integrations/fastapi/mip_rum_middleware.py` | Écrite, testée unitairement |
| Extension navigateur | `apps/extension/` | Déployable sans toucher au site cible |

Le SDK web couvre : Web Vitals, erreurs, ressources, tâches longues, formulaires,
signaux de frustration, fil d'Ariane, rejeu de session, spans d'appels API,
consentement, et un **échantillonnage biaisé-erreurs** (`sampling.ts`) qui conserve
100 % des sessions à incident tout en échantillonnant le trafic nominal. Ce dernier
point est une vraie maturité d'ingénierie, pas une case cochée.

### 2.2 Ingestion

`POST /v1/traces` en OTLP/HTTP JSON, en double implémentation : une *edge function*
Deno (`packages/backend/supabase/functions/v1-traces/`, actuellement en **v16** en
production) et un jumeau Node portable (`dev-server.mjs`) pour l'auto-hébergement.
Gardes en place : clé d'API (403), limitation de débit (429), taille de corps (413),
séparation stricte 4xx/5xx, rejeu des écritures.

### 2.3 Exploitation

47 pages dans `apps/console/app/` : vue d'ensemble, pages, parcours, sessions et
détail de session avec rejeu, cascade de traces, erreurs et groupement par
empreinte, corrélation, carte, prévision, objectifs, SLO, alertes, tableaux de bord,
et une console d'administration complète (clients, usage, santé, confidentialité,
jetons de lecture, audit).

### 2.4 API de lecture

`GET /api/rum/summary` — authentification par jeton porteur **scopé à une app**,
agrégats techniques sans PII, appel serveur-à-serveur. C'est le livrable d'intégration
UTI, et il est correctement testé (`tests/unit/rum-summary-route.test.ts` : 401 / 401 / 403 / 200).

---

## 3. Preuves d'usage (production, 29 juillet 2026)

| Table | Total | 7 derniers jours | Apps |
|---|---:|---:|---:|
| `rum_span` | **306 730** | **92 588** | 2 |
| `rum_resource` | 8 827 | — | — |
| `rum_breadcrumb` | 7 009 | — | — |
| `rum_metric` | 4 322 | — | — |
| `rum_pageview` | 2 769 | — | — |
| `rum_longtask` | 2 096 | — | — |
| `rum_session` | 729 | 19 | 3 |
| `replay_chunk` | 504 | — | — |
| `rum_error` | **70** | **0** | 2 |

**Lecture.** Le RUM n'est pas une démonstration : il ingère en continu, à un volume
significatif, depuis le 29 juin. En revanche deux chiffres méritent attention —
**70 erreurs au total et aucune sur 7 jours** : soit les applications supervisées
sont remarquablement saines, soit la capture d'erreurs sous-collecte. À vérifier
avant de présenter la page Erreurs à un client, car une page vide se lit comme un
produit cassé et non comme une bonne nouvelle.

**5 apps enregistrées** : `demo-app`, `gip-plateforme`, `mip-rum-console`, `test`,
`insight-performance`. Deux d'entre elles (`mip-rum-console`, `insight-performance`)
n'ont **pas de clé d'API**.

---

## 4. Standards du secteur, et où nous en sommes

L'état du marché est traité en profondeur dans
`../MARKET_SCAN_BMAD.md` ([hors dépôt](../DOCUMENTS-HORS-DEPOT.md)). Retenons ici les quatre points
qui pèsent sur la note de maturité.

**① OpenTelemetry côté client n'est pas encore stable.** Le RUM navigateur reste le
maillon le moins mûr d'OTel : les conventions sémantiques client sont en cours, le
suivi projet « Client Instrumentation » est toujours ouvert, et c'est le SIG Android
qui a le plus avancé. **Conséquence pour nous : ce n'est pas un défaut d'être
partiellement propriétaire sur ce signal — le standard n'existe pas encore.** Mais
cela interdit de promettre une portabilité totale.

**② Le contexte de trace W3C, lui, est stable — et nous ne le respectons pas.**
`packages/rum-sdk/src/otel.ts:109-110` génère un `traceId` et un `spanId` **aléatoires
pour chaque span** :

```ts
traceId: hexId(16),
spanId:  hexId(8),
```

Aucun span client n'est donc rattachable à un autre, ni à la trace serveur. C'est
le défaut le plus structurant de la fiche : il rend **factuellement fausse** la
promesse « OTel-native, donc réversible et corrélable ».

**③ Les seuils Core Web Vitals ne sont pas ceux de web.dev.** Trois fichiers portent
la même valeur erronée pour le LCP — `packages/rum-sdk/src/vitals.ts:14`,
`packages/backend/shared/otlp.mjs:13`,
`apps/console/lib/rating.ts:6` :

```ts
LCP: [2000, 2500]   // référence web.dev : [2500, 4000]
```

Nous classons donc « à améliorer » des pages que Google classe « bonnes », et
« mauvaises » des pages seulement « à améliorer ». Les autres seuils (INP, CLS,
FCP, TTFB) sont, eux, conformes. Par ailleurs le champ `delta` des Web Vitals n'est
pas transmis, ce qui empêche l'agrégation correcte des mesures successives d'une
même métrique sur une même page.

**④ Le masquage du rejeu de session est en deçà du standard 2026.**
`packages/rum-sdk/src/replay.ts:190` active `maskAllInputs: true` et une classe de
blocage — mais pas le masquage du texte par défaut. Or « masqué par défaut » est
devenu table-stakes chez tous les acteurs comparés.

---

## 5. Évaluation par axe

### A1 — Collecte & couverture : **3 / 4**
Cinq voies d'émission, un SDK web riche, un échantillonnage intelligent, et un
volume de production réel et continu. Ce qui manque pour un 4 : les SDK ne sont
publiés ni sur npm ni sur PyPI (l'intégration passe donc par une copie de fichiers),
et la couverture d'erreurs est suspecte (0 sur 7 jours).

### A2 — Conformité aux standards : **2 / 4**
L'encodage OTLP est correct et verrouillé par un test d'instantané. Mais le contexte
de trace W3C n'est pas honoré, les seuils LCP divergent de la référence, et `delta`
manque. **C'est un axe rattrapable en quelques heures**, ce qui en fait la plus
mauvaise raison de rester bloqué à N2.

### A3 — Qualité de la donnée : **2 / 4**
*Au crédit :* nettoyage PII à l'ingestion, gestion du consentement, purge par
rétention (`purge_rum`, rétention configurable par app), DSAR complet (export et
effacement par personne concernée), journal d'audit.
*Au débit :* la corrélation trace ne fonctionne pas (cf. A2) ; RLS est activé mais
les politiques sont en `using (true)` — **elles ne filtrent pas par client**,
l'isolation repose uniquement sur le `where app_id = $1` applicatif ; la colonne
`retention_days` est renseignée à `null` pour les 5 apps, donc c'est le défaut
global qui s'applique.

### A4 — Exploitation : **3 / 4**
47 pages, cascade de traces, rejeu, corrélation, groupement d'erreurs par empreinte.
C'est objectivement au niveau des produits du marché sur la lecture. Ce qui manque
pour un 4 : pas d'exploration libre (on consulte des vues préparées, on ne pose pas
de question arbitraire aux données), et plusieurs surfaces ne sont pas éprouvées par
l'usage (`dashboard` 1 ligne, `goal` 0, `sourcemap` 0).

### A5 — Action : **1 / 4** ← *plafond*
Le moteur existe et **fonctionne** : règles de seuil, mode ligne de base par
score z, sévérités, sensibilité. Il produit des événements. Mais :

| Constat | Preuve |
|---|---|
| 637 alertes déclenchées depuis le 2 juillet | `alert_event` |
| dont **624** en brûlage de SLO, sur **un seul** SLO (~23/jour) | `alert_event.slo_id` |
| **0** acquittée | `alert_event.acknowledged` |
| **0** notification livrée | `alert_delivery` vide |
| **0** canal configuré | `notify_channel` vide |
| L'e-mail n'est pas livrable par construction | `migration-v17.sql:172-175` |

Le code de livraison existe (`net.http_post` pour *webhook* et Slack,
`migration-v17.sql:178`) ; il n'a simplement jamais eu de destinataire. **Personne
n'a jamais été prévenu de quoi que ce soit par ce produit.**

### A6 — Industrialisation : **1 / 4**
Mono-locataire de fait (isolation applicative, pas base). Pas d'inscription
autonome, pas de facturation, pas de SLA. L'image Docker d'auto-hébergement existe
(`infra/docker/`) mais **n'a jamais été construite avec succès** : le workflow de
vérification `docker-smoke.yml` a été écrit, la CI est bloquée depuis le 24 juillet,
donc l'image reste **techniquement non prouvée**.

---

## 6. Verdict

**N2 confirmé. N3 est à portée immédiate, et le chaînon manquant tient en deux
chantiers.**

C'est le point important de cette fiche : le RUM n'a pas besoin d'une nouvelle
fonctionnalité pour changer de palier. Il a besoin qu'on **ferme la boucle** déjà
construite.

### Critères de sortie vers N3

1. **Livrer les alertes.** Configurer au moins un canal *webhook*/Slack réel,
   vérifier une livraison de bout en bout dans `alert_delivery`, et trancher le sort
   du canal e-mail (le brancher, ou le retirer de l'interface — aujourd'hui il
   promet un service qui n'existe pas).
2. **Calmer le SLO.** 23 alertes/jour sur un seul objectif, ce n'est pas de la
   supervision, c'est du bruit. Regrouper par fenêtre, ajouter une hystérésis ou
   revoir le budget d'erreur — sinon brancher la livraison ne fera qu'inonder la
   boîte de réception, ce qui est pire que le silence actuel.
3. **Rendre l'acquittement visible.** 0/637 acquittées suggère que le geste n'est
   pas offert au bon endroit dans l'interface.

### Critères de sortie vers N4

4. Isolation en base (politiques RLS filtrant réellement par locataire).
5. Image Docker prouvée par une exécution de CI verte.
6. SDK publiés, contexte W3C correct, seuils conformes — sans quoi aucune
   intégration tierce sérieuse n'est crédible.

---

## 7. Risques

| Risque | Gravité | Commentaire |
|---|---|---|
| Une démonstration client tombe sur la page Erreurs (vide sur 7 j) | Élevée | Se lit comme un produit cassé |
| Un prospect teste la corrélation de traces | Élevée | Ne fonctionne pas ; contredit le discours OTel |
| Un client compare nos notes Web Vitals à PageSpeed | Moyenne | Divergence inexpliquable en réunion |
| Bascule de `REQUIRE_API_KEY` | Élevée | Couperait **2** apps actives sans clé |
| Un client demande la preuve d'isolation | Élevée | RLS activé mais sans filtre par locataire |

---

## Sources

- [OpenTelemetry — Project Tracking: Client Instrumentation (#2734)](https://github.com/open-telemetry/opentelemetry-specification/issues/2734)
- [OpenTelemetry — Semantic Conventions 2026 Roadmap (#3330)](https://github.com/open-telemetry/semantic-conventions/issues/3330)
- [OpenTelemetry Android: Road to Stable](https://opentelemetry.io/blog/2025/android-road-to-stable/)
- [Elastic — OpenTelemetry for Real User Monitoring](https://www.elastic.co/docs/solutions/observability/applications/otel-rum)
- [web.dev — Largest Contentful Paint (seuils de référence)](https://web.dev/articles/lcp/)
- [Honeycomb — Observability Maturity Model](https://www.honeycomb.io/blog/observability-maturity-model)
</content>
