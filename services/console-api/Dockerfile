# Image du service `console-api` — le backend de la console (piste C).
#
# La recette (pnpm fetch → install --offline → build → pnpm deploy --prod), le
# contexte de build et l'épinglage par digest sont expliqués en tête de
# `services/collector/Dockerfile`. Ce qui diffère ici : l'étape BUILD compile un
# bundle (`services/console-api/build.mjs`) à partir des paquets TypeScript
# `@mip/console-api` et `@mip/console-contract`. L'image finale ne porte que
# `dist/server.mjs` et `pg` ; jamais une source de la console (garde du build).

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

# 2) INSTALL hors ligne : les paquets partagés et ce service. Pas `apps/` :
#    le service n'importe rien de la console.
COPY packages ./packages
COPY services/console-api ./services/console-api
RUN pnpm install --offline --frozen-lockfile --filter "@mip/service-console-api..."

# 3) BUILD : le bundle `dist/server.mjs`, refusé s'il contient un fichier de `apps/`.
RUN pnpm --filter "@mip/service-console-api..." run --if-present build

# 4) DEPLOY, posé à `services/console-api` sous `/app` : dépendances de
#    production seulement (`pg`), plus `dist/`, construit juste avant.
#    En ligne, puis vérifié : sous pnpm 9, `deploy` résout de nouveau (hors
#    ligne, il échoue faute de métadonnées) ; `scripts/ci/deploy-fidele.mjs`
#    exige la version ET l'empreinte du lockfile pour chaque paquet posé.
COPY scripts/ci/deploy-fidele.mjs ./scripts/ci/deploy-fidele.mjs
RUN pnpm --filter @mip/service-console-api deploy --prod /app/services/console-api \
 && node scripts/ci/deploy-fidele.mjs pnpm-lock.yaml /app/services/console-api

# ──────────────────────────────── exécution ─────────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NODE_ENV=production \
    LOG_LEVEL=info

WORKDIR /app

# Propriété de root, lu par `node` : le processus ne réécrit pas son code.
COPY --from=construction /app /app

# La sonde écoute toujours (défaut 8080 ; Railway fournit PORT).
EXPOSE 8080

# Non-root : l'utilisateur `node` de l'image (uid 1000).
USER node

# POUR L'AUTO-HÉBERGEMENT (Railway sonde lui-même `/health`). Même résolution
# de port que le point d'entrée. `/health` ne demande pas le secret client.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# EXPLICITE : une image ne sait démarrer que son service.
CMD ["node", "services/console-api/dist/server.mjs"]
