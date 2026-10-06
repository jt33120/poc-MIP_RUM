# AGENTS.md — MIP RUM

Consignes pour les agents de code (Codex, Claude Code…) et pour les humains qui
relisent leur travail. Ce fichier dit ce qui casse si on l'ignore ; le reste est
dans `docs/`. Tenu à jour au 29/09/2026 ; `tests/unit/agents-md.test.ts` vérifie que
chaque chemin qu'il cite existe.

## Le dépôt en bref

MIP RUM est un outil de Real User Monitoring natif OpenTelemetry : des capteurs
(SDK web, extension, mobile ; côté serveur, l'agent OpenTelemetry officiel du
langage du client) envoient traces, logs et rejeux ; une base Postgres (Neon) les
garde ; une console Next.js les montre. Plus aucun capteur serveur maison : l'agent
Node et le middleware FastAPI sont archivés (`docs/archive/capteurs-serveur-maison.md`).

Deux états coexistent, et la doc doit toujours dire lequel elle décrit :

- **En service** (depuis l'apply du 27/09/2026) : la console sur Vercel (UI, API v1,
  ingestion, accès direct à la base ; connexion par `console-api`) ; sur Railway, les
  six services — `collector`, `api`, `console-api`, `mcp`, `scheduler` (travaux
  planifiés, seul migrateur), `notifier`. Deux relais sont à 100 % depuis le
  28/09/2026 : la collecte vers `collector` (`ingest_relay_pct`) et les lectures au
  jeton de l'API v1 vers `api` (`api_relay_pct`). La console garde son écriture
  locale en repli.
- **En service, éteint par un drapeau** (`platform_flag`) : la bascule des écrans
  et des écritures vers `console-api` (drapeaux absents, donc à 0) ; le GeoIP du
  `collector`.

L'état détaillé et la suite : `docs/architecture/overview.md`.

## Carte

| Dossier | Contenu |
|---|---|
| `apps/console` | Console Next.js (Vercel) : écrans, API v1, routes d'ingestion, relais |
| `apps/extension` | Extension navigateur (capteur MV3) |
| `services/<x>` | Ce que Railway exécute : point d'entrée, `Dockerfile`, `README.md` (sauf `mcp`) |
| `packages/backend`, `packages/db` | Pipeline d'ingestion, travaux, migrations (`packages/db/sql`) |
| `packages/console-api`, `packages/console-contract` | Backend de la console et son contrat |
| `packages/service-kit` | Configuration, sondes, arrêt propre, pool : communs aux services |
| `packages/stats` | Statistique pure (`@mip/stats`) : un seul calcul pour la console, l'API v1 et `console-api` |
| `packages/rum-*` | Capteurs publiés (web, mobile) et leur cœur commun |
| `.railway/railway.ts` | L'infrastructure Railway (IaC) |
| `tests/{unit,integration,contract,e2e}` | Vitest, SQL, contrats de parité, Playwright |
| `docs/` | Architecture, ADR, exploitation, API, intégration |

## Commandes

Node 24 (`.nvmrc`), pnpm 9.15.9 (`packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm build:sdk                    # SDK : requis avant les tests E2E et la console
pnpm test:unit                    # vitest, sans base
pnpm --filter console typecheck
pnpm test:sql                     # Postgres requis : variables SQL_TEST_* (voir .github/workflows/ci.yml)
pnpm test:contract                # bases migrées requises (idem)
pnpm test:e2e                     # Postgres :5433, base mip_rum migrée par `node services/scheduler/migrate.mjs`
```

La CI (`.github/workflows/ci.yml`) est la référence : ce qu'elle lance, dans quel
ordre et sur quelles bases.

## Ce qui casse la CI si on l'ignore

- **Migrations** : `packages/db/sql/migration-vNN.sql`, au numéro qui suit le plus haut.
  Additives et rejouables. Une migration fusionnée ne se modifie plus jamais
  (`scripts/ci/migrations-figees.mjs`). Seul le `scheduler` migre, à son
  pré-déploiement.
- **Documents lus par du code** : certains documents sont analysés ou cités par
  des tests (`README.md`, `DEPLOY.md`, `docs/RUM_PARITY_STATUS.md`,
  `docs/TOPOLOGIE_BACKEND.md`, `docs/API_CONSOLE.md`, `docs/INTEGRATION.md`,
  `docs/AUDIT_RUM_EXTERNE.md`, `docs/CONFORMITE.md`…). Avant de déplacer ou de
  réécrire un document : `git grep -n "<nom du fichier>"`.
- **Fichiers générés** : zones du `README.md` (`node scripts/readme-sections.mjs`)
  et `apps/console/lib/couverture.generated.json` (`node scripts/couverture-extraire.mjs`),
  chacun avec un mode `--verifier` ; `docs/api/console-api.md`
  (`MAJ_DOC_CONSOLE_API=1 pnpm vitest run tests/unit/console-api-doc.test.ts`) ;
  `apps/console/lib/composants-open-source.generated.json`
  (`node scripts/composants-open-source.mjs`, liste tenue à la main :
  `scripts/composants-open-source.externes.json`), à refaire après tout changement
  de dépendance, de Dockerfile ou de workflow. Un test échoue si l'un des quatre
  dérive. `docs/architecture/console-api/inventaire.md`
  et `cliquet.json` se réécrivent par `node scripts/dev/inventaire-console.mjs` ;
  seul le cliquet est gardé par un test (voir « Console sans base »).
- **Conformité** : toute nouvelle sortie de données vers un tiers, ou tout
  changement d'hébergeur, met à jour `apps/console/lib/legal.ts` et
  `docs/CONFORMITE.md` dans la même modification (`tests/unit/conformite.test.ts`).
- **Console sans base** : le cliquet (`tests/unit/inventaire-console.test.ts`)
  refuse qu'une page ou un composant de plus atteigne la base. Une nouvelle lecture
  passe par un chargeur (`apps/console/lib/chargeurs/`), une nouvelle écriture par
  une commande (`apps/console/lib/commandes/`).
- **Parité** : `tests/contract/` compare les réponses de la console à celles du
  collector et du service `api`. Un changement de format d'un côté vaut pour l'autre.
- **Bundles de service** : `services/api/build.mjs` et
  `services/console-api/build.mjs` refusent un bundle qui embarque la session de la
  console (`apps/console/lib/auth.ts`) ou un module `next/…` réel ; celui de `console-api`
  refuse aussi les écrans, les composants et React.
- **Artefacts du SDK versionnés** : `pnpm build:sdk` réécrit `mip-rum.js` dans
  `apps/console/public/` et `apps/extension/vendor/` ; `mip-rum-replay.js` se copie
  à la main de `packages/rum-sdk/dist/` vers `apps/console/public/`. La CI
  (`apps/extension/scripts/check-sync.mjs`) refuse toute dérive, versions de
  l'extension comprises. `apps/console/public/mip-rum-feedback.js` est une source,
  pas un artefact. Les zips de `apps/console/public/downloads/` se refont par
  `pnpm --filter ./apps/extension pack` (et `pack:store`) : rien ne les vérifie.

## Sécurité et exploitation

- **Le dépôt est public.** Aucun secret, aucune donnée client, aucune adresse
  e-mail personnelle. Les documents commerciaux restent hors dépôt
  (`docs/DOCUMENTS-HORS-DEPOT.md`).
- Ne jamais lancer `vercel env pull` dans le dépôt, ni sourcer `.env` (il peut
  contenir l'URL de la base de production).
- Les scripts qui écrivent hors exploitation (`scripts/verify-*`, `seed-*`,
  `gen-*`, bancs, `playwright.config.ts`) refusent une cible distante
  (`scripts/lib/cible-locale.mjs`, cliquet `tests/unit/cible-locale.test.ts`) ;
  la dérogation nomme l'hôte : `MIP_CIBLE_DISTANTE=<hôte>`. Un script écrivant
  de plus l'appelle, ou le cliquet échoue.
- L'infrastructure Railway ne s'applique que par le workflow
  `.github/workflows/railway-config.yml` (environnement protégé, relecture
  humaine). Jamais `railway config apply` en local, jamais `--include-variables`.
- Un push sur `master` qui touche `.railway/**` crée un nouveau run d'apply. Un
  push qui touche les chemins surveillés du `scheduler` (`services/scheduler/**`,
  `packages/backend/**`, `packages/db/**`, `packages/service-kit/**`,
  `infra/docker/**`, `pnpm-lock.yaml` : liste exacte dans `.railway/railway.ts`)
  le redéploie, et son pré-déploiement applique les migrations en attente — même
  pour un commentaire. Des migrations non encore appliquées en production se
  répètent d'abord sur la branche Neon `repetition-p0` (runbook § 5).
- Neon est sur une offre payante à l'usage depuis le 27/09/2026, en attendant la
  base que choisira la DSI de MIP (ADR 0014, remplacée) : chaque réveil se paie,
  pas de boucle qui interroge la base à vide.

## Conventions

- **Français** partout : code, commentaires, docs, messages de commit, PR.
- Un commentaire dit **pourquoi**, pas ce que fait la ligne suivante.
- Dates au format JJ/MM/AAAA dans les documents.
- Commits : `<phase ou sujet> — <ce que ça change>` (voir `git log`).
- Toute PR vise `master`, jamais une autre branche. Pas de PR empilées.
- Une affirmation dans la doc se vérifie dans le code avant d'être écrite.

## Où lire

- `docs/architecture/overview.md` et `data-flow.md` : l'architecture et son état.
- `docs/architecture/adr/` : les décisions et leurs raisons.
- `docs/operations/runbook.md` : exploitation, incidents, retours arrière.
- `docs/operations/bascule-console-api.md`, `relais-ingestion.md`, `relais-api.md` :
  les bascules et leurs drapeaux.
- `services/README.md` et le `README.md` de chaque service (`mcp` : `docs/MCP.md`).
- `docs/api/console-api.md` : les opérations de `console-api` (généré).
- `docs/README.md` : l'index de la documentation, une ligne par document. La doc de
  chantier (plans, cadrages, rapports) n'entre pas dans le dépôt.
