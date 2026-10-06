# Documentation de MIP RUM

Une ligne par document, ce qu'on y trouve. Ce dossier ne garde que ce qui sert à
installer, intégrer, exploiter et comprendre le produit ; la documentation de chantier
(plans, cadrages, rapports, journaux de livraison, textes de présentation) en est sortie
le 06/10/2026 ([DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md) dit lesquels). En cas de
désaccord, [RUM_PARITY_STATUS.md](RUM_PARITY_STATUS.md) et
[TOPOLOGIE_BACKEND.md](TOPOLOGIE_BACKEND.md) font foi.

## Installer et intégrer

- [INTEGRATION.md](INTEGRATION.md) : poser le SDK web sur un site — snippet, options, consentement, CSP, dépannage.
- [integration/sourcemaps-ci.md](integration/sourcemaps-ci.md) : envoyer ses source maps depuis GitHub Actions ou GitLab CI.
- [SOURCEMAPS.md](SOURCEMAPS.md) : la dé-minification des erreurs, de l'envoi à la symbolication.
- [capteurs-serveur.md](capteurs-serveur.md) · [capteurs-serveur.csv](capteurs-serveur.csv) : côté serveur, l'agent OpenTelemetry officiel de chaque langage, sa commande, ce qui est éprouvé.
- [DEPLOY_EXTENSION.md](DEPLOY_EXTENSION.md) : déployer l'extension navigateur (Chrome Web Store ou politique d'entreprise).
- [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md) : le kit de soumission de l'extension au Chrome Web Store.
- [CADRAGE_EXTENSION.md](CADRAGE_EXTENSION.md) : l'extension, second capteur : périmètre, permissions, écarts du code au cadrage (lu par un test).
- [SSO.md](SSO.md) : brancher la console sur le fournisseur d'identité d'un client (OpenID Connect).

## API et MCP

- [API_CONSOLE.md](API_CONSOLE.md) : l'API de lecture v1 (`/api/v1/*`), son contrat et ses jetons.
- [DEPLOY_API.md](DEPLOY_API.md) : qui sert l'API v1 en production, et comment la brancher.
- [RUM_READ_API.md](RUM_READ_API.md) : le résumé partenaire `/api/rum/summary`.
- [MCP.md](MCP.md) : interroger MIP RUM depuis un assistant IA (serveur MCP en lecture seule).
- [api/console-api.md](api/console-api.md) : la table des opérations de `console-api` (générée).

## Comprendre le produit

- [RUM_PARITY_STATUS.md](RUM_PARITY_STATUS.md) : document de couverture — capacité par capacité, son verdict, sa preuve et sa limite.
- [LIMITES.md](LIMITES.md) : les limites assumées du produit, datées.
- [ALERTING.md](ALERTING.md) : alertes — seuils, lignes de base, SLO et budget d'erreur, canaux, escalade.
- [DASHBOARDS.md](DASHBOARDS.md) : tableaux de bord configurables et export.
- [FRUSTRATION.md](FRUSTRATION.md) : signaux de frustration (clics rageurs, morts, en erreur) et attribution de l'INP.
- [MULTITENANT.md](MULTITENANT.md) : isolation des applications, rôles, métering et quotas.
- [ROADMAP_REPLAY.md](ROADMAP_REPLAY.md) : le rejeu de session — technique, consentement, étapes pour l'activer.
- [OBSERVABILITY.md](OBSERVABILITY.md) : l'auto-observabilité (`/api/metrics` Prometheus, santé interne).

## Architecture

- [TOPOLOGIE_BACKEND.md](TOPOLOGIE_BACKEND.md) : ce que chaque hébergeur et chaque service exécutent en production, et pourquoi.
- [architecture/overview.md](architecture/overview.md) : l'architecture du backend, la cible et l'état de chaque service.
- [architecture/data-flow.md](architecture/data-flow.md) : le trajet d'une mesure et celui d'une alerte.
- [architecture/console-api/README.md](architecture/console-api/README.md) : ce que `console-api` porte, et le contrat de la console sans base.
- [architecture/console-api/inventaire.md](architecture/console-api/inventaire.md) · [cliquet.json](architecture/console-api/cliquet.json) : l'inventaire généré de la console et le cliquet « console sans base ».
- [architecture/adr/README.md](architecture/adr/README.md) : l'index des décisions d'architecture.
- [ADR-0001](ADR-0001-supervision-ia-xsom.md) : la supervision IA quitte MIP RUM pour xSOM AI Guard.
- [ADR-0002](architecture/adr/0002-console-interface-sans-base.md) : la console devient une interface sans base, appuyée sur `console-api`.
- [ADR-0003](architecture/adr/0003-roles-et-tenancy.md) : rôles de base et cloisonnement des applications.
- [ADR-0004](architecture/adr/0004-migrations.md) : un seul migrateur, en avant seulement, schéma N et N+1.
- [ADR-0005](architecture/adr/0005-relais-ingestion.md) : la console relaie la collecte au collector.
- [ADR-0006](architecture/adr/0006-mcp-sans-base.md) : le serveur MCP n'a aucun accès à la base.
- [ADR-0007](architecture/adr/0007-iac-railway.md) : l'infrastructure Railway est du code, relu comme du code.
- [ADR-0008](architecture/adr/0008-scheduler-unique.md) : un seul déclencheur pour les travaux planifiés, sous bail.
- [ADR-0009](architecture/adr/0009-blobs-en-postgres.md) : rejeu et source maps restent en Postgres, avec un seuil de sortie.
- [ADR-0010](architecture/adr/0010-console-api.md) : `console-api`, un service, un pipeline, un seul client.
- [ADR-0011](architecture/adr/0011-sessions-es256.md) : sessions signées ES256, révocables en base.
- [ADR-0012](architecture/adr/0012-roles-de-la-console.md) : les rôles de la console, `mip_console` et `mip_identity`.
- [ADR-0013](architecture/adr/0013-pas-de-table-crash-natif.md) : pas de table de crash natif tant qu'aucun moteur n'est choisi.
- [ADR-0014](architecture/adr/0014-base-gratuite.md) : la base sur l'offre gratuite, en mode dégradé (remplacée le 27/09/2026).
- [ADR-0015](architecture/adr/0015-schemas-par-domaine.md) : schémas par domaine, la cible.
- [ADR-0016](architecture/adr/0016-emetteur-otlp-maison.md) : le SDK web émet l'OTLP lui-même.

## Exploiter

- [operations/runbook.md](operations/runbook.md) : déployer, revenir en arrière, rejouer un travail, tourner un secret, restaurer.
- [operations/relais-ingestion.md](operations/relais-ingestion.md) : le relais de collecte de la console vers le collector.
- [operations/relais-api.md](operations/relais-api.md) : le relais des lectures de l'API v1 vers le service `api`.
- [operations/bascule-console-api.md](operations/bascule-console-api.md) : la bascule des écrans et des écritures vers `console-api`, et son drapeau.
- [operations/releve-p0-2026-09-23.md](operations/releve-p0-2026-09-23.md) : relevé de production du 23/09/2026, ligne de base et preuve de la vitrine.
- [operations/banc-collecteur-2026-09-24.md](operations/banc-collecteur-2026-09-24.md) : banc du collector du 24/09/2026, débit et verrou d'application.
- [operations/presentation-dsi.md](operations/presentation-dsi.md) : le parcours de démonstration du backend et les exercices restant à faire (source de la vitrine).

## Conformité

- [CONFORMITE.md](CONFORMITE.md) : dossier RGPD — données collectées, sous-traitants, résidence, droits des personnes.
- [DPA.md](DPA.md) : modèle d'accord de traitement des données (article 28).
- [NEON_MIGRATION.md](NEON_MIGRATION.md) : la migration de Supabase vers Neon (13-14/08/2026), source des hébergeurs déclarés.
- [AUDIT_RUM_EXTERNE.md](AUDIT_RUM_EXTERNE.md) : l'audit externe du 09/09/2026 et ce que chaque constat est devenu.

## Hors du produit, gardé pour ses renvois

- [DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md) : ce qui n'est pas dans le dépôt, et pourquoi.
- [archive/capteurs-serveur-maison.md](archive/capteurs-serveur-maison.md) : l'agent Node et le middleware FastAPI maison, retirés le 29/09/2026 ([archive/README.md](archive/README.md)).
- [product/notes-lecture-ekara.md](product/notes-lecture-ekara.md) : notes de lecture d'un outil du marché, source de la table de positionnement de la vitrine.
