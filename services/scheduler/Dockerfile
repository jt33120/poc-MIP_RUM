# Image du service `scheduler` — travaux planifiés, et SEUL migrateur.
#
# Deux commandes, une image :
#
#   node services/scheduler/worker.mjs    le service (CMD ci-dessous)
#   node services/scheduler/migrate.mjs   le pré-déploiement Railway, et le
#                                         service `migrate` one-shot du compose
#
# Ce n'est pas la mise en commun que ce lot défait : le migrateur est un outil
# DU scheduler (contrat de service, règle 8 : seul le scheduler migre). Il n'est
# embarqué nulle part ailleurs — le collecteur et le serveur MCP ne portent ni
# `@mip/db` ni ses fichiers SQL. `@mip/db` embarque `sql/` (champ `files` de son
# package.json) : le migrateur lit le dossier À CÔTÉ DE LUI, où qu'il soit posé.
#
# La recette (pnpm fetch → install --offline → build → pnpm deploy --prod), le
# contexte de build et l'épinglage par digest sont expliqués en tête de
# `services/collector/Dockerfile` ; les trois images la suivent à l'identique,
# seul le nom du service change. Pas de base GeoIP ici : elle sert la collecte.

# ─────────────────────────────── construction ───────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS construction

WORKDIR /depot

# pnpm à la version de `packageManager` (lue, pas recopiée).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-audit --no-fund \
      "$(node -p 'require("./package.json").packageManager.split("+")[0]')" \
 && npm cache clean --force

# 1) FETCH : le lockfile seul — couche en cache tant que les versions ne
#    bougent pas. Pas de cache monté : Railway en refuse la syntaxe générique.
RUN pnpm fetch

# 2) INSTALL hors ligne : les paquets partagés et ce service.
COPY packages ./packages
COPY services/scheduler ./services/scheduler
RUN pnpm install --offline --frozen-lockfile --filter "@mip/service-scheduler..."

# 3) BUILD (inerte aujourd'hui : du `.mjs` exécuté tel quel).
RUN pnpm --filter "@mip/service-scheduler..." run --if-present build

# 4) DEPLOY, posé à `services/scheduler` sous `/app` : la commande de
#    pré-déploiement de `.railway/railway.ts` (`node services/scheduler/migrate.mjs`)
#    est ainsi la même en production, dans le compose et sur un poste.
#    En ligne, puis vérifié : sous pnpm 9, `deploy` résout de nouveau (hors
#    ligne, il échoue faute de métadonnées) ; `scripts/ci/deploy-fidele.mjs`
#    exige la version ET l'empreinte du lockfile pour chaque paquet posé.
COPY scripts/ci/deploy-fidele.mjs ./scripts/ci/deploy-fidele.mjs
RUN pnpm --filter @mip/service-scheduler deploy --prod /app/services/scheduler \
 && node scripts/ci/deploy-fidele.mjs pnpm-lock.yaml /app/services/scheduler

# ──────────────────────────────── exécution ─────────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NODE_ENV=production \
    LOG_LEVEL=info

WORKDIR /app

# Propriété de root, lu par `node` : le processus ne réécrit pas son code.
COPY --from=construction /app /app

# La sonde écoute toujours (défaut 8080 ; Railway fournit PORT). Sans domaine
# généré, elle n'est joignable que par le réseau privé du projet.
EXPOSE 8080

# Non-root : l'utilisateur `node` de l'image (uid 1000).
USER node

# POUR L'AUTO-HÉBERGEMENT (Railway sonde lui-même `/health`). Même résolution
# de port que le point d'entrée.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# EXPLICITE. Le migrateur n'est PAS le défaut : une migration ne doit partir
# que parce qu'on l'a demandée (pré-déploiement, service `migrate` du compose).
CMD ["node", "services/scheduler/worker.mjs"]
