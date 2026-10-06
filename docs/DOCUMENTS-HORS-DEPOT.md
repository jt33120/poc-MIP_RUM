# Documents retirés du dépôt

Certains documents de ce projet ne sont plus versionnés depuis le 23/09/2026 (commit
`683af85b`) : ils ne décrivent pas le produit, ils décrivent un client ou une offre. Ce
fichier existe pour qu'une référence croisée ne pointe jamais dans le vide — quand un autre
document cite l'un de ces noms, c'est ici qu'il faut revenir. `.gitignore` les exclut (bloc
« DOCUMENTS COMMERCIAUX ET CLIENT »), et `scripts/ops/miroir-filtre.sh` reprend la même liste.

**Où ils sont** (relevé du 26/09/2026). Pas dans la copie de travail de ce dépôt : retirer un
fichier du suivi l'efface aussi des copies qui tirent ce commit. Une copie plus ancienne
subsiste sur le poste de l'opérateur, dans un clone antérieur du projet ; qu'elle soit à jour
n'est pas vérifié. Ils sont demandés à qui détient ces copies.

**Ils ne sont pas privés pour autant** : le dépôt est public et son historique les contient
encore (voir la fin de ce fichier).

## Commercial

| Document | Ce qu'il contient |
|---|---|
| `docs/OFFRE.md` | Positionnement commercial : comparatif marché, paliers de prix indicatifs. Brouillon interne daté de la v0.3, antérieur au document de couverture |
| `docs/DEMO_SCRIPT.md` | Déroulé de démonstration : checklist, plan B hors-ligne, objections et réponses |
| `docs/MARKET_SCAN_BMAD.md` | Scan concurrentiel (95 sources), standards, positionnement |
| `docs/PRODUCT_REVIEW_BMAD.md` | Revue produit interne A→Z, épics E1 à E7 |
| `docs/RAPPORT_CLIENT.md` | Rapport de fin de POC, rempli avec les chiffres d'un client nommé |

## Client (intégration UTI / `gip-plateforme`)

| Document | Ce qu'il contient |
|---|---|
| `docs/SNIPPET_UTI.md` | Consigne de mise à niveau RUM pour le dépôt du client, avec ses valeurs de production : identifiant d'application, point d'entrée |
| `docs/HANDOVER_UTI.md` | Passation d'intégration côté client |
| `docs/CONSENT_UTI.md` | Bandeau de consentement et `requireConsent` sur le site suivi |
| `docs/AI_UTI.md` · `docs/AI_MAPPING_UTI.md` · `docs/AI_SESSION_BACKGROUND_UTI.md` · `docs/AI_PII_FIX_UTI.md` | Contrat des spans `gen_ai`, inventaire des usages IA, propagation du `session_id`, correctif PII — écrits pour ce client |

## Documentation de chantier (retirée le 06/10/2026)

Après la présentation à la DSI, le dépôt ne garde que ce qui sert à installer, intégrer,
exploiter et comprendre le produit. La documentation de travail en est sortie : elle n'a
rien de confidentiel (elle reste lisible dans l'historique public, et n'entre donc ni dans
`.gitignore` ni dans `scripts/ops/miroir-filtre.sh`), mais elle décrivait le chantier, pas
le produit. Une copie est gardée hors dépôt par le propriétaire. Quand un document, un
commentaire ou une preuve cite l'un de ces noms, c'est d'eux qu'il s'agit.

| Document | Ce qu'il contenait |
|---|---|
| `docs/DOSSIER_POC.md` · `docs/REVUE_POC.md` | Dossier et revue du POC, écrits pour la présentation |
| `docs/CADRAGE_LOT_C.md` | Cadrage et chiffrage du lot C (17/06/2026), dont l'option B qui a donné l'API v1 |
| `docs/EXTRACTION_XSOM_AI_GUARD.md` | Spécification de l'extraction de la supervision IA (20/07/2026) ; la décision reste dans l'[ADR-0001](ADR-0001-supervision-ia-xsom.md) |
| `docs/archive/delivery/delivery-p5.md` à `delivery-p8.md` | Journaux de livraison des lots P5 à P8, que recoupe le [document de couverture](RUM_PARITY_STATUS.md) |
| `docs/archive/` (`PLAN.md`, `ROADMAP_V02.md`, `ROADMAP_V03.md`, `RAPPORT_NUIT*.md`, `RAPPORT_V04.md`, `RAPPORT_V05.md`, `MIGRATION_MVP.md`, documents SVI) | Plans, feuilles de route et rapports de sprint de juin et juillet 2026, et la supervision vocale retirée le 29/09/2026 |
| `docs/context/` | Fiches de contexte produit (RUM, logs, supervision IA) et grille d'évaluation |
| `docs/design/` | Direction artistique de la console et ses captures du 11/06/2026, antérieures à la refonte ; la charte appliquée est celle du code |
| `docs/product/plan-frontend-dashboard.md` | Plan de la refonte du frontend, vagues 0 à 8 : les « plan § … » et la règle R-S des commentaires du code y renvoient |
| `docs/product/film-presentation.md` | Scénario du film de la vitrine |
| `scripts/monter-film-accueil.mjs` · `scripts/record-console-tour.mjs` | Outils de montage du film d'accueil et d'enregistrement de la visite de la console |

## Ce qui reste dans le dépôt

L'index de `docs/` est [README.md](README.md). Tout ce qui fait fonctionner le produit, y compris la documentation d'intégration
générique ([INTEGRATION.md](INTEGRATION.md)), la conformité ([CONFORMITE.md](CONFORMITE.md)),
les limites assumées ([LIMITES.md](LIMITES.md)) et le document de couverture
([RUM_PARITY_STATUS.md](RUM_PARITY_STATUS.md)).

L'outillage des agents (`.claude/…`, `.agents/`, `.codex/`, `_bmad/`, `_bmad-output/`,
`.mcp.json`) est lui aussi hors dépôt ; `.gitignore` explique pourquoi, ce n'est pas de la
documentation.

> **L'historique git, lui, les contient encore.** Les retirer du suivi n'efface pas les
> commits passés. Un miroir destiné à être remis à un tiers doit être filtré
> (`git filter-repo --invert-paths`, voir `scripts/ops/miroir-filtre.sh`), pas simplement
> cloné.

## Décision du 29/09/2026 : l'historique public reste tel quel

**Le propriétaire du dépôt accepte** que les documents retirés le 23/09/2026 (commit
`683af85b`) restent lisibles dans l'historique public. L'historique n'est pas réécrit : pas de
`git filter-repo` sur le dépôt public, pas de poussée forcée. Le filtrage ci-dessus reste la
règle pour un miroir remis à un tiers.

**Les clés d'ingestion de l'historique.** On y lit 22 clés d'ingestion `mip_…` en clair. Le
29/09/2026, elles ont été comparées au registre de production (`app_registry.api_key_hash`,
qui ne garde que l'empreinte sha256) : **aucune n'y est**, aucune ne correspond donc à une
application.

**Règle : une clé vue dans l'historique ne se repose jamais.** Une application qui reçoit une
clé en reçoit une neuve, tirée au hasard (`scripts/ops/provisionner-cles.mjs`), jamais une clé
retrouvée dans un ancien document, une capture ou un commit.
