# Documents présents sur le poste, absents du dépôt

Certains documents de ce projet ne sont pas versionnés. Ils existent, ils sont à jour,
mais ils ne sont pas dans git : ils ne décrivent pas le produit, ils décrivent un client
ou une offre. Ce fichier existe pour qu'une référence croisée ne pointe jamais dans le
vide — quand un autre document cite l'un de ces noms, c'est ici qu'il faut revenir.

Ils sont demandés à qui détient le dépôt ; ils ne sont pas publics.

## Commercial

| Document | Ce qu'il contient |
|---|---|
| `docs/OFFRE.md` | Positionnement commercial : comparatif marché, paliers de prix indicatifs. Brouillon interne daté de la v0.3, antérieur au document de couverture |
| `docs/DEMO_SCRIPT.md` | Déroulé de démonstration : checklist, plan B hors-ligne, objections et réponses |
| `docs/MARKET_SCAN_BMAD.md` | Scan concurrentiel (95 sources), standards, positionnement |
| `docs/PRODUCT_REVIEW_BMAD.md` | Revue produit interne A→Z, épics E0 à E7 |
| `docs/RAPPORT_CLIENT.md` | Rapport de fin de POC, rempli avec les chiffres d'un client nommé |

## Client (intégration UTI / `gip-plateforme`)

| Document | Ce qu'il contient |
|---|---|
| `docs/SNIPPET_UTI.md` | Valeurs de production du client : identifiant d'application, point d'entrée |
| `docs/HANDOVER_UTI.md` | Passation d'intégration côté client |
| `docs/CONSENT_UTI.md` | Bandeau de consentement et `requireConsent` sur le site suivi |
| `docs/AI_UTI.md` · `docs/AI_MAPPING_UTI.md` · `docs/AI_SESSION_BACKGROUND_UTI.md` · `docs/AI_PII_FIX_UTI.md` | Contrat des spans `gen_ai`, inventaire des usages IA, propagation du `session_id`, correctif PII — écrits pour ce client |

## Ce qui reste dans le dépôt

Tout ce qui fait fonctionner le produit, y compris la documentation d'intégration
générique ([INTEGRATION.md](INTEGRATION.md)), la conformité ([CONFORMITE.md](CONFORMITE.md)),
les limites assumées ([LIMITES.md](LIMITES.md)) et le document de couverture
([RUM_PARITY_STATUS.md](RUM_PARITY_STATUS.md)).

> **L'historique git, lui, les contient encore.** Les retirer du suivi n'efface pas les
> commits passés. Un miroir destiné à être remis à un tiers doit être filtré
> (`git filter-repo --invert-paths`), pas simplement cloné.
