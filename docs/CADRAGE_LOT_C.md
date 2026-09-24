# Cadrage & chiffrage — LOT C (infra / compte / refonte)

> **Nature du LOT C** : contrairement aux LOT A (code autonome) et B (outillage),
> les items C **dépendent de pré-requis externes** (repo tiers, hébergement
> financé, budgets, comptes, démarches). Ce document est un **cadrage pour
> décision**, pas une implémentation : rien n'est livrable tant que les
> pré-requis ne sont pas levés. Les charges sont des **ordres de grandeur**
> (jours-homme, `j·h`) destinés à arbitrer, pas des engagements.

## Récapitulatif des pré-requis bloquants

| Item | Objet | Pré-requis bloquant | Décideur |
|------|-------|---------------------|----------|
| **C1** | Console RUM → module Angular 20 | Accès au **repo console MIP** (Angular) **ou** choix de l'option API | Architecture produit MIP |
| **C2** | ClickHouse + OTel Collector en prod | **Hébergement financé** (on-prem ou cloud souverain) | Direction / budget infra |
| **C3** | Mobile natif, multi-région, facturation/multi-tenant, CSPN/ANSSI | Budget, comptes, démarches longues | Direction MIP |

---

## C1 — Migration de la console (Next.js/React) vers Angular 20

### Objectif
Unifier l'expérience : exposer les vues RUM **dans la console MIP existante
(Angular 20)** plutôt qu'une console autonome séparée.

### Deux options d'architecture (décision produit)

**Option A — Réécriture en module Angular natif.**
Les vues RUM deviennent un module Angular de la console MIP, requêtant la même
base/API que l'ingestion.
- ✅ Expérience 100 % unifiée (nav, thème, auth communes), un seul déploiement.
- ❌ Réécriture front complète ; **requiert le repo console MIP** ; couple le
  cycle de release RUM à celui de la console MIP.

**Option B — Garder Next.js autonome + API REST consommée par l'Angular.**
La console actuelle expose les agrégats via une API ; l'Angular l'intègre (iframe
ou appels API + composants légers).
- ✅ Découplage ; la console RUM reste livrable seule ; **pas besoin du repo MIP**
  pour démarrer (juste un contrat d'API) ; migration incrémentale.
- ❌ Deux fronts à maintenir ; cohérence visuelle à soigner.

> **Recommandation** : **Option B d'abord** (contrat d'API stable, intégrable
> tout de suite, réversible), puis Option A si MIP veut l'unification totale. Le
> chiffrage ci-dessous couvre l'option A (le pire cas).

### Inventaire à porter (option A)
- **9 vues** (`apps/console/app/`) : Overview (+ health score, heatmap, anomalies),
  Pages lentes, Erreurs (+ détail/fingerprint), Sessions (+ détail + **replay
  rrweb**), Tracing, Alertes, Corrélation, Présentation, Login. Plus l'**admin**
  (Clients/wizard, Utilisateurs, Audit).
- **Composants** : `VitalCard`, 3 graphes (`VitalsTimeseries`, `TrafficTimeseries`,
  `HealthHeatmap`), `GlobalFilters`, `Nav`, `TourGuide`, `GlossaryTip/InfoTip`,
  `ReplayPlayer`, `AssistBox`, etc.
- **Transverse** : couche data (`lib/queries*.ts`, `health.ts`) → services Angular ;
  **RBAC/auth** (JWT, viewer scopé) → garde Angular ; **auto-refresh 5 s** ;
  **thème clair/sombre** ; graphes (recharts → ngx-charts/echarts).

### Charge estimée (option A, ordre de grandeur)
| Chantier | j·h |
|---|---|
| Socle module Angular (routing, thème, auth/garde RBAC, filtres globaux) | 4–6 |
| Couche données (services + DTO, réécriture des requêtes en endpoints) | 4–6 |
| 9 vues + composants (dont graphes à reporter sur la lib Angular) | 10–15 |
| Session replay (intégration rrweb-player hors React) | 2–3 |
| Parité tests E2E (Playwright re-câblé) + recette | 3–4 |
| **Total option A** | **~23–34 j·h** |

Option B : **~6–10 j·h** (exposer/documenter l'API + intégration légère côté Angular).

### Risques
Bibliothèque de graphes différente (rendu à re-valider) ; SSR Next → CSR Angular
(perf/atténuation des requêtes lourdes) ; couplage des releases ; le replay rrweb
n'est pas React-spécifique mais son montage l'est.

> ⚠️ La migration réelle (E2.1 du plan) doit se faire en **session dédiée**
> (UltraCode, `/compact` + `/clear` au démarrage) et **n'est pas exécutable ici**
> sans le repo console MIP.

---

## C2 — ClickHouse + OTel Collector en production (on-prem / cloud souverain)

### Objectif
Passer le stockage analytique de Postgres (POC) à ClickHouse pour le grand
compte. **Le chemin est déjà prouvé en local** (bench Δ=0 sur les p75, ×15 plus
compact, ~88 k lignes/s sans tuning — cf. `labs/clickhouse/NOTES.md`).

### Topologie cible
`SDK navigateur → OTel Collector (on-prem/cloud souverain) → ClickHouse`, console
branchée via une **couche dialecte** (~50 lignes : `percentile_cont`→
`quantileExactInclusive`, `date_trunc`→`toStartOfHour`, `count(distinct)`→
`uniqExact`). Replay hors CH (object storage / bytea).

### Travaux restants (au-delà du bench local)
1. Déployer **Collector + ClickHouse** (manifests/compose existants en exemple).
2. Pointer le snippet SDK sur le Collector (**seul** changement côté client).
3. Porter `flattenOtlp` en processor Collector ou vues CH sur `otel_traces`.
4. Implémenter la **couche dialecte** dans la console + brancher la lecture CH.
5. **TTL 30 j** (RGPD) + **MV `AggregatingMergeTree`** (`quantileTDigestState` horaire)
   pour le multi-milliards ; sauvegarde/rétention ; HA si requise.
6. Décommissionner la fonction serverless.

### Charge estimée
| Chantier | j·h |
|---|---|
| Déploiement Collector + ClickHouse (1 nœud, durci, TTL, backups) | 3–5 |
| Couche dialecte console + bascule lecture (store-par-store) | 3–4 |
| Processor/vues d'aplatissement + recette de parité (réutilise le bench) | 2–4 |
| MV pré-agrégées + tuning multi-milliards (si volumétrie l'exige) | 2–4 |
| **Total** | **~10–17 j·h** (hors HA multi-nœuds) |

### Pré-requis & coûts
**Hébergement financé** (souveraineté UE : ClickHouse Apache-2.0 auto-hébergeable,
argument CSPN). Drivers de coût : nœud(s) CH (CPU/disque), Collector, ops/astreinte.
Risque principal = **exploitation** (sauvegarde, montée de version, supervision),
pas la faisabilité technique (déjà démontrée).

---

## C3 — Barrières enterprise (cadrage macro)

| Item | Pré-requis | Classe d'effort | Horizon |
|------|-----------|-----------------|---------|
| **Mobile natif iOS/Android** | SDK à concevoir/maintenir × 2, CI mobile, devices | Lourd (produit en soi) | Phase 3 |
| **Multi-région / HA** | Réplication, failover, SLA, infra | Lourd | Phase 2+ |
| **Facturation + multi-tenant strict** | Modèle de quotas, isolation forte (RLS *par tenant*, métering), facturation | Moyen-lourd | Décision commerciale |
| **Certification CSPN / ANSSI** | Processus d'audit long, dossier, mise en conformité | Très lourd, calendaire | 12–18 mois (décision MIP) |

Ces items ne sont pas chiffrables finement sans cadrage produit dédié ; ils
relèvent de **décisions de direction** (budget, go-to-market), pas d'un sprint.

---

## Séquencement recommandé
1. **C2** dès qu'un hébergement est financé (ROI le plus net : faisabilité déjà
   prouvée, gain volumétrie/coût immédiat, ~10–17 j·h).
2. **C1 option B** (API + intégration légère) si l'unification presse, **option A**
   seulement si MIP tranche pour le module Angular natif (et fournit le repo).
3. **C3** au fil des décisions commerciales/réglementaires.

## Ce que je peux préparer dès maintenant (sans lever les pré-requis)
- **Extraire une couche « dialecte SQL »** dans la console (abstraction PG/CH) pour
  rendre C2 quasi mécanique le jour J.
- **Spécifier le contrat d'API** (option B de C1) : endpoints + DTO documentés,
  consommables par l'Angular sans toucher au repo MIP.
- **Durcir `scripts/load-bench.mjs`** pour cibler ClickHouse (mode `STORE=clickhouse`)
  afin de re-prouver la capacité au déploiement C2.

> Dis lequel de ces préparatifs tu veux que j'attaque — ils sont, eux, dans mon
> périmètre autonome.
