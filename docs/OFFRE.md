# OFFRE — Positionnement commercial MIP RUM (v0.3, brouillon interne)

Document de travail pour MIP. Positionnement **honnête** : MIP RUM ne prétend pas rivaliser
fonctionnalité par fonctionnalité avec Datadog ou Dynatrace — ce n'est ni possible ni le sujet.
Le différenciateur est le **créneau** : un RUM OTel-natif, souverain, corrélé nativement au
synthétique DEM que MIP vend déjà. On vend un angle, pas une parité.

## Le créneau en une phrase

> « Vos robots disent que tout va bien. Vos utilisateurs vivent autre chose. MIP RUM croise
> les deux — en standard OTel, hébergeable chez vous, vendu et opéré par votre partenaire DEM. »

Preuve en production (10/06/2026, plateforme.groupement-it.com) : sur `/login`, le robot mesure
**1,14 s (« ok »)** quand le LCP p75 réel est à **4,04 s (« poor »)** — **+254 %** d'écart,
invisible au synthétique seul.

## Tableau comparatif (état constaté juin 2026 — à revérifier avant toute diffusion client)

| Axe | **MIP RUM** | Datadog RUM | Dynatrace | Ekara (ITRS / ip-label) |
|---|---|---|---|---|
| **OTel-natif sur le fil** | **Oui** — le SDK émet de l'OTLP/HTTP JSON standard, vérifiable au DevTools ; backend remplaçable (Collector + ClickHouse) sans toucher le SDK | Non — SDK propriétaire (OTLP accepté côté backend/APM, pas pour le RUM) | Non — agent/SDK propriétaire (OneAgent ; ingestion OTLP possible côté plateforme) | Non — collecte propriétaire |
| **Souveraineté / on-prem / CSPN** | Données UE (Paris) dès le POC ; **on-prem-ready** (Postgres/ClickHouse + Collector chez le client) ; aucune certification à ce jour — CSPN/ISO = chantier à cadrer | SaaS uniquement, éditeur US (datacenters UE possibles, mais Cloud Act) | SaaS éditeur US ; l'offre auto-hébergée historique (Managed) est en extinction | **Fort** — éditeur d'origine française, habitué des contextes souverains ; certifications : à vérifier auprès d'ITRS |
| **Corrélation synthétique↔RUM intégrée** | **Oui, c'est le produit** : robot vs réel par route, écarts, « angles morts » (robot ok / réel poor) — pensé pour se brancher sur la base Ekara installée | Possible si on achète aussi Datadog Synthetics (corrélation intra-suite) | Possible si on achète aussi Dynatrace Synthetic (corrélation intra-suite) | Synthétique de référence (DEM) ; RUM existant mais la corrélation fine route par route n'est pas le cœur de l'offre |
| **Session replay** | Oui (v0.3) — rrweb, opt-in par app, masquage des saisies par défaut, respect du consent, bundle séparé lazy-chargé | Oui (option payante) | Oui (option) | À vérifier |
| **Alerting** | Oui — règles par app/route/métrique, fenêtre glissante, webhooks sortants (format compatible Slack), anti-spam ; détection d'anomalies statistique (z-score LCP) | Oui (monitors, riche) | Oui (Davis, IA causale — un cran au-dessus de tout le marché sur ce point) | Oui (côté synthétique) |
| **Prix indicatif** (ordres de grandeur publics, à revérifier) | Voir paliers ci-dessous — objectif : nettement sous les suites US à volumétrie égale | ~1,50 $/1 000 sessions RUM + ~1,80 $/1 000 sessions pour le replay (tarifs liste) | Facturation à la session (modèle DPS) ; budget total généralement élevé car la valeur est dans la suite complète | Sur devis (modèle licence/mesures) |
| **Lock-in** | **Faible par construction** : format OTLP standard, schéma SQL ouvert, déployable chez le client — la réversibilité est un argument de vente | Fort (SDK, format, suite intégrée) | Fort (agent, format, suite intégrée) | Moyen (données chez l'éditeur ou souveraines selon le contrat) |

Ce que ce tableau **ne dit pas** : Datadog et Dynatrace sont des plateformes d'observabilité
complètes (APM, infra, logs, IA causale) avec des années d'avance sur la profondeur produit.
Si le besoin du client est « une suite tout-en-un », MIP RUM n'est pas la réponse. Si le besoin
est « un RUM souverain, standard, corrélé à mon synthétique existant, sans lock-in », il l'est.

## Arguments grands comptes FR

1. **AO souverains / secteur public et OIV** : exigences SecNumCloud/hébergement FR-UE de plus en
   plus fréquentes dans les appels d'offres — les suites SaaS US y sont disqualifiées d'office ou
   pénalisées. MIP RUM se déploie chez le client (Collector OTel + ClickHouse/Postgres), code et
   schéma auditables.
2. **RGPD by design** : pas d'adresse IP stockée (géolocalisation par timezone, granularité pays),
   sessions anonymisées (hash), scrub PII à l'ingestion, consent mode natif côté SDK, masquage des
   saisies par défaut dans le replay. La DPO peut lire le pipeline de bout en bout.
3. **Base installée DEM** : MIP opère déjà le monitoring synthétique (Ekara) chez ses comptes. Le
   RUM se vend en **extension du contrat existant** — même interlocuteur, même console de vérité,
   et la corrélation synthétique↔réel n'existe nulle part ailleurs en multi-éditeur. Le coût
   d'acquisition commercial est quasi nul sur la base installée.
4. **Réversibilité contractuelle** : OTLP standard sur le fil + schéma SQL documenté = le client
   peut récupérer ses données et rebrancher un autre backend. Argument différenciant en
   négociation vs les suites propriétaires.

## Pricing indicatif (3 paliers)

> **Disclaimer : tarifs indicatifs construits pour cadrer la discussion — à valider par MIP**
> (coûts d'infra réels, marge, politique tarifaire groupe). Rien ici n'est engageant.

| Palier | Cible | Contenu | Prix indicatif |
|---|---|---|---|
| **POC** | Validation sur 1 application | 30 jours, snippet + console cloud UE, volumétrie plafonnée (1 M pages vues), accompagnement à l'intégration, restitution des écarts robot↔réel | **Gratuit** |
| **Standard** (SaaS UE) | Comptes mid-market / 1-5 apps | Ingestion + console multi-apps, alerting webhooks, replay opt-in, rétention 30 j, support heures ouvrées | **À partir de ~150 € / M pages vues / mois**, dégressif par volume |
| **Enterprise** (on-prem) | Grands comptes, AO souverains | Déploiement chez le client (Collector + ClickHouse), RBAC/SSO à cadrer, rétention sur mesure, engagement de service, intégration à la base Ekara | **Licence annuelle + support, sur devis** (ordre de grandeur : quelques dizaines de k€/an selon périmètre) |

Repère marché : à 10 M de pages vues/mois (~1,5-2 M de sessions), les tarifs liste d'un RUM SaaS
US se chiffrent en milliers d'euros mensuels hors replay. Le palier Standard vise un positionnement
clairement en dessous à volumétrie égale ; l'Enterprise vend la souveraineté et la réversibilité,
pas le prix plancher.

## Ce qu'on ne dit JAMAIS en rendez-vous

- « Équivalent à Datadog/Dynatrace » — faux, et la première démo concurrente nous décrédibilise.
- « Détection d'anomalies par IA » — c'est un z-score statistique (assumé et expliqué), pas du ML.
- « Certifié CSPN/SOC2 » — aucune certification à ce jour ; on dit « architecture candidate, chantier à cadrer ».
- Un prix ferme — tout est indicatif tant que MIP n'a pas validé le modèle.

Limites assumées et trajectoire : [LIMITES.md](LIMITES.md) (section v0.3).
