# Contexte produit — MIP RUM

Dossier de **contexte durable** (inspiration BMAD : un socle stable que l'on
recharge au début de chaque chantier, plutôt que de reconstruire l'état des lieux
à chaque session). Il répond à une seule question, produit par produit :

> **Où en est-on vraiment, et qu'est-ce qui manque pour passer au palier suivant ?**

Date d'établissement : **29 juillet 2026**. Toute affirmation chiffrée ci-dessous
est datée et sourcée (fichier du dépôt ou requête sur la base de production).

---

## 1. Les trois produits

| Produit | Portée | Propriétaire du calcul | Fiche |
|---|---|---|---|
| **Supervision RUM** | Expérience réelle des utilisateurs web/mobile + traces serveur | `mip-rum` | [produit-rum.md](./produit-rum.md) |
| **Supervision IA** | Coût, latence, volumétrie et qualité des appels LLM | **xSOM AI Guard** (externe) | [produit-supervision-ia.md](./produit-supervision-ia.md) |
| **Supervision Logs** | 3ᵉ signal OTel — journaux applicatifs corrélés aux traces | `mip-rum` | [produit-logs.md](./produit-logs.md) |

Une quatrième fiche traite d'un domaine **adjacent, non couvert aujourd'hui**,
sur lequel la question a été posée : [svi-supervision-vocale.md](./svi-supervision-vocale.md)
(serveurs vocaux interactifs).

---

## 2. Grille de maturité employée

### 2.1 L'échelle (5 paliers)

Alignée sur les deux référentiels publics du secteur — le *Observability Journey
Maturity Model* de Grafana Labs (paliers **Reactive → Proactive → Systematic**) et
le *Observability Maturity Model* de Honeycomb (évaluation par **résultats**, pas
par outillage).

| Palier | Nom | Critère de sortie |
|---|---|---|
| **N0** | Absent | Le signal n'est pas collecté. |
| **N1** | Instrumenté | La donnée arrive et se stocke. **Personne ne la consulte, aucune décision n'en découle.** |
| **N2** | Exploitable | Consultable, filtrable, corrélable **à la main** par quelqu'un qui sait où chercher. |
| **N3** | Actionnable | Un écart notable **atteint un humain** sans qu'il regarde, et il existe une boucle de remédiation. |
| **N4** | Industrialisé | Multi-tenant, contractualisé (SLA/rétention), prédictif, intégrable ou revendable en l'état. |

### 2.2 Les six axes (identiques pour les trois produits, donc comparables)

| Axe | Question |
|---|---|
| **A1 — Collecte & couverture** | Le signal est-il émis, par quoi, et pour quelle part du parc ? |
| **A2 — Conformité aux standards** | OTel / W3C / conventions du domaine : conforme, ou propriétaire ? |
| **A3 — Qualité de la donnée** | Corrélation, PII, rétention, isolation entre clients. |
| **A4 — Exploitation** | Peut-on interroger, filtrer, comprendre sans lire du SQL ? |
| **A5 — Action** | L'anomalie atteint-elle un humain, et déclenche-t-elle quelque chose ? |
| **A6 — Industrialisation** | Multi-tenant, exploitation, contractualisation, revente. |

### 2.3 Règle de notation — le maillon faible

> **Le niveau global d'un produit est plafonné par le plus faible axe de sa chaîne
> de valeur (collecte → action).**

Ce n'est pas une moyenne. Une chaîne d'observabilité vaut son maillon le plus
faible : une collecte exemplaire dont aucune alerte ne sort ne produit aucune
décision, donc aucune valeur. C'est exactement le point de Honeycomb — on juge le
**résultat**, pas la quantité d'outillage.

---

## 3. Synthèse comparée

| Axe | RUM | Supervision IA *(côté MIP)* | Logs |
|---|:---:|:---:|:---:|
| A1 — Collecte & couverture | **3** | n/a *(externalisée)* | **1** |
| A2 — Conformité standards | **2** | **2** | **3** |
| A3 — Qualité de la donnée | **2** | **2** | **1** |
| A4 — Exploitation | **3** | **2** | **2** |
| A5 — Action | **1** | **0** | **1** |
| A6 — Industrialisation | **1** | **3** *(intégration)* | **2** |
| **Niveau global** | **N2** | **N2** | **N1** |

**En une phrase chacun :**

- **RUM — N2, avec un outillage de niveau N3 déjà construit.** La collecte est
  réelle et abondante (306 730 spans, 92 588 sur les 7 derniers jours, 2 apps
  actives). L'interface est riche (47 pages). Mais **637 alertes se sont
  déclenchées et zéro n'a été livrée** — la table `alert_delivery` est vide. Le
  produit *voit* tout et *ne dit* rien.
- **Supervision IA — N2 pour l'utilisateur, N3 pour l'intégration.** La scission
  vers xSOM AI Guard est propre, gouvernée (ADR-0001), et dégrade en douceur. Mais
  le contrat de 9 champs ne couvre que le volet FinOps/performance : ni évaluations,
  ni traces unitaires, ni garde-fous — c'est-à-dire ni l'un ni l'autre des
  table-stakes 2026 de la catégorie.
- **Logs — N1.** Le pipeline est complet et conforme à une spécification OTel
  **stable** ; il n'est alimenté par **aucun produit**. Les 597 lignes de la table
  sont les connexions à la console elle-même (dogfooding), sans une seule erreur,
  sans un seul `trace_id`, et le flux s'est tari le 23 juillet.

---

## 4. Le constat transversal, et il est unique

Les trois produits butent sur **le même mur, l'axe A5**.

| Preuve | Valeur | Source |
|---|---|---|
| Alertes déclenchées (2 juil. → 29 juil.) | **637** | `alert_event` |
| … dont brûlage de SLO | **624** (~23/jour, sur **un seul** SLO) | `alert_event.slo_id` |
| … acquittées par un humain | **0** | `alert_event.acknowledged` |
| Notifications effectivement livrées | **0** | `alert_delivery` (table vide) |
| Canaux de notification configurés | **0** | `notify_channel` (table vide) |
| Canal e-mail | **jamais livré, par construction** | `migration-v17.sql:172` → `'email non livré (canal payant non branché)'` |

Ce tableau est le résumé le plus honnête du produit aujourd'hui : **la boucle de
supervision n'est pas fermée.** 624 alertes de brûlage sur un unique SLO en
27 jours, c'est en outre le cas d'école de la fatigue d'alerte que Honeycomb
classe comme le premier *mauvais résultat* d'une pratique immature — le problème
n'est pas seulement que rien ne part, c'est qu'il partirait trop.

**Conséquence de priorisation :** brancher la livraison des alertes **et** calmer
le bruit du SLO fait passer le RUM de N2 à N3 pour un effort très inférieur à
n'importe quelle nouvelle fonctionnalité de collecte. C'est le meilleur rapport
effort/valeur du portefeuille, tous produits confondus.

### Mise à jour du 29 juillet (re-mesure en production)

Le tableau ci-dessus reste la photographie du 29 juillet **au matin**. Trois
mesures ont changé dans la journée, une quatrième s'est révélée mal formulée.

| | Revue initiale | Re-mesuré | |
|---|---|---|---|
| Bruit du SLO | ~23 alertes/jour | **0 sur les 2 h 30 suivant le correctif** | v45 + v46 appliquées |
| Cause du bruit | « cadence trop bavarde » | **`objective` stocké en pourcent → `fast_burn` tautologique** | le diagnostic initial était faux |
| Canaux configurés | 0 | **0** (inchangé) | seul verrou restant pour N3 |
| Logs — corrélation | « sans un seul `trace_id` » | **654 lignes, toujours 0 `trace_id`** | cause identifiée ci-dessous |

**Le RUM n'est pas passé N3.** Le correctif a rendu l'alerte *vraie* — l'atteinte
réelle du SLO LCP est de **81,58 %** pour un objectif de 99 %, donc le produit
signale enfin une dégradation qui existe — mais `notify_channel` est toujours
vide : l'alerte n'atteint personne. Le critère N3 n'est pas satisfait.

**Les Logs ne sont pas passés N2, et la raison est structurelle**, pas un oubli de
câblage. Le pipeline est correct de bout en bout (l'émetteur `agent-node` pose le
`traceId` natif, `otlp.mjs:604` le lit). Ce qui manque, c'est l'ÉMISSION :
`forwardLog` n'a que **deux** appelants dans toute la console —

1. la connexion (`app/login/actions.ts`), une action serveur que `withServerTrace`
   n'enveloppe pas (il n'ouvre un contexte que sur présence d'un `traceparent`
   entrant, `server-trace.ts:24`) : structurellement non corrélable ;
2. le chemin d'erreur d'API (`lib/api/handle.ts`), tracé lui, mais **jamais
   déclenché** — zéro erreur d'API sur la période.

D'où 654 lignes toutes `INFO`, une seule source, zéro corrélation. Le défaut de
corrélation latent est corrigé (`traceFields()` alimente désormais `forwardLog`
automatiquement), mais **cela ne suffira pas** : tant qu'aucun produit réel
n'émet de logs, le signal reste du dogfooding de connexion. Faire passer les Logs
en N2 suppose d'instrumenter une application qui journalise vraiment — c'est un
travail d'adoption, pas de plomberie.

---

## 5. Autres constats transversaux

**Deux applications sans clé d'API en production.** `app_registry` :
`mip-rum-console` et `insight-performance` ont `api_key_hash` nul. Le durcissement
E1-S1 (rejet des apps sans clé sous `REQUIRE_API_KEY`) les couperait toutes les
deux. Le déploiement reste donc conditionné à l'attribution préalable de clés —
c'est deux apps à traiter, pas une.

**RLS activé, isolation absente.** 11 migrations activent `row level security`,
mais les politiques sont en `using (true) with check (true)` : elles ferment
l'accès anonyme, elles **ne filtrent pas par client**. L'isolation multi-tenant
repose aujourd'hui uniquement sur le `where app_id = $1` du code applicatif.

**Fonctionnalités construites, jamais utilisées.** `deploy_marker` 0 ligne,
`goal` 0, `sourcemap` 0, `syn_snapshot` 0, `dashboard` 1, `slo` 1,
`uptime_check` 1. Ce n'est pas nécessairement un défaut — mais cela signifie que
ces chemins de code ne sont **pas éprouvés par l'usage**, et doivent être traités
comme tels lors d'une mise en production client.

---

## 6. Ce que ce dossier ne dit pas

- **Le produit de supervision IA lui-même n'est pas auditable depuis ce dépôt.**
  L'accès GitHub de cette session est restreint à `jt33120/mip-rum` ; le dépôt
  `xsom-ai-guard` est hors périmètre. La fiche IA évalue donc **l'intégration** sur
  preuves, et le **produit** sur son seul contrat public + un sondage réseau. Ses
  angles morts sont listés explicitement dans la fiche.
- **Le positionnement marché** n'est pas repris ici : il fait l'objet de
  [`../MARKET_SCAN_BMAD.md`](../MARKET_SCAN_BMAD.md) (95 sources), auquel les
  fiches renvoient plutôt que de le dupliquer.

---

## 7. Documents liés

| Document | Rôle |
|---|---|
| [`../PRODUCT_REVIEW_BMAD.md`](../PRODUCT_REVIEW_BMAD.md) | Revue interne A→Z, épics E0–E7 |
| [`../MARKET_SCAN_BMAD.md`](../MARKET_SCAN_BMAD.md) | Scan concurrentiel, standards, positionnement |
| [`../ADR-0001-supervision-ia-xsom.md`](../ADR-0001-supervision-ia-xsom.md) | Décision d'architecture : l'IA sort de `mip-rum` |
| [`../EXTRACTION_XSOM_AI_GUARD.md`](../EXTRACTION_XSOM_AI_GUARD.md) | Spécification de ce qui a été transféré à xSOM |

---

## Sources

- [Grafana Labs — Observability Journey Maturity Model](https://grafana.com/blog/how-to-improve-your-observability-strategy-introducing-the-observability-journey-maturity-model/)
- [Honeycomb — Framework for an Observability Maturity Model](https://www.honeycomb.io/blog/observability-maturity-model)
</content>
