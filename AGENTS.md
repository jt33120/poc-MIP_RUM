# AGENTS.md — MIP RUM

Consignes pour les agents de code (Codex, Claude Code…) et pour les humains qui
relisent leur travail. Ce fichier dit ce qui casse si on l'ignore. Tenu à jour au
06/10/2026 ; `tests/unit/agents-md.test.ts` vérifie que chaque chemin qu'il cite existe.

Le dépôt ne porte que ce qui sert à construire, tester, déployer et faire tourner le
produit. La documentation (architecture, ADR, exploitation, intégration, API) vit hors
du dépôt, sur le poste de l'équipe ; ce qui fait foi ici, c'est le code, ses tests et
les `README.md` des services.

## Le dépôt en bref

MIP RUM est un outil de Real User Monitoring natif OpenTelemetry : des capteurs
(SDK web, extension, mobile ; côté serveur, l'agent OpenTelemetry officiel du
langage du client) envoient traces, logs et rejeux ; une base Postgres (Neon) les
garde ; une console Next.js les montre. Plus aucun capteur serveur maison : l'agent
Node et le middleware FastAPI sont archivés depuis le 29/09/2026.

Deux états coexistent, et un commentaire doit toujours dire lequel il décrit :

- **En service** (depuis l'apply du 27/09/2026) : la console sur Vercel (UI, API v1,
  ingestion, accès direct à la base ; connexion par `console-api`) ; sur Railway, les
  six services — `collector`, `api`, `console-api`, `mcp`, `scheduler` (travaux
  planifiés, seul migrateur), `notifier`. La collecte reçue par la console est
  relayée au `collector` ; les lectures au jeton de l'API v1, au service `api`.
- **En service depuis le 06/10/2026** (`platform_flag`) : la bascule des écrans et
  des écritures vers `console-api` (drapeaux à 100, sans mode strict : la console garde
  la base en repli) ; la collecte directe au `collector`, avec son GeoIP.

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
| `infra/docker` | Les mêmes images en auto-hébergement (compose) |
| `scripts/` | Outils appelés par la CI, les tests ou l'exploitation |
| `tests/{unit,integration,contract,e2e}` | Vitest, SQL, contrats de parité, Playwright |

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
- **Citations « fichier:ligne »** : la vitrine (`apps/console/lib/presentation-*.ts`,
  `apps/console/lib/cartographie/`) cite ses preuves à la ligne, et des tests vérifient
  que chaque fichier et chaque ligne cités existent. Ajouter ou retirer des lignes dans
  un fichier cité (dont ce fichier-ci) oblige à recaler ses citations.
- **Relevé de couverture** : `apps/console/lib/couverture.json` porte, capacité par
  capacité, le verdict, la preuve et la limite que la vitrine affiche ;
  `tests/unit/couverture-site.test.ts` refuse une carte qui en dit plus.
- **Fichiers générés** : `apps/console/lib/composants-open-source.generated.json`
  (`node scripts/composants-open-source.mjs`, liste tenue à la main :
  `scripts/composants-open-source.externes.json`), à refaire après tout changement
  de dépendance, de Dockerfile ou de workflow ; un test échoue s'il dérive. Le cliquet
  `scripts/dev/cliquet-console.json` se réécrit par `node scripts/dev/inventaire-console.mjs`
  (voir « Console sans base »).
- **Conformité** : toute nouvelle sortie de données vers un tiers, ou tout
  changement d'hébergeur, met à jour `apps/console/lib/legal.ts` dans la même
  modification (`tests/unit/conformite.test.ts`).
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
  e-mail personnelle, aucun document de travail ni document commercial : la
  documentation reste sur le poste (les dossiers docs et local sont ignorés par git).
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
  répètent d'abord sur la branche Neon `repetition-p0`.
- Neon est sur une offre payante à l'usage depuis le 27/09/2026, en attendant la
  base que choisira la DSI de MIP : chaque réveil se paie, pas de boucle qui
  interroge la base à vide.

## Conventions

- **Français** partout : code, commentaires, messages de commit, PR.
- Un commentaire dit **pourquoi**, pas ce que fait la ligne suivante.
- Dates au format JJ/MM/AAAA.
- Commits : `<phase ou sujet> — <ce que ça change>` (voir `git log`).
- Toute PR vise `master`, jamais une autre branche. Pas de PR empilées.
- Une affirmation dans un commentaire ou sur la vitrine se vérifie dans le code avant
  d'être écrite.

## Où lire

- `README.md` : installer, lancer, tester, déployer.
- `services/README.md` et le `README.md` de chaque service ; pour `mcp`, le
  catalogue `packages/mcp-tools/lib/catalogue.mjs`.
- `packages/console-api/src/table.ts` : les opérations de `console-api` et leurs politiques.
- `apps/console/lib/api/openapi.ts` : la spec de l'API v1 (servie sur `/api/v1/docs`).
