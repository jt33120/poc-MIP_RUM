# Image du service `mcp` — l'API v1 de lecture, exposée à un agent IA.
#
# CE SERVICE NE DOIT PAS POUVOIR ATTEINDRE LA BASE. Il est joignable depuis
# l'internet et pilotable par un modèle de langage, donc par le texte que ce
# modèle a lu. La seule protection qui tienne contre une injection de prompt
# réussie, c'est qu'il n'y ait rien à atteindre : pas de `pg`, pas de
# DATABASE_URL. Tout passe par l'API v1, qui applique déjà le cloisonnement par
# jeton (cf. docs/MCP.md).
#
# `pnpm deploy` rend cette garantie STRUCTURELLE : l'image ne contient que la
# fermeture des dépendances de `@mip/service-mcp` (le SDK MCP et zod, via
# `@mip/mcp-tools`). `pg` n'y entre que si quelqu'un l'ajoute à ce graphe — et
# le job de fumée (`.github/workflows/docker-smoke.yml`) échoue alors, parce que
# rien d'autre ne le verrait.
#
# La recette (pnpm fetch → install --offline → build → pnpm deploy --prod), le
# contexte de build et l'épinglage par digest sont expliqués en tête de
# `services/collector/Dockerfile` ; les trois images la suivent à l'identique.

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
COPY services/mcp ./services/mcp
RUN pnpm install --offline --frozen-lockfile --filter "@mip/service-mcp..."

# 3) BUILD (inerte aujourd'hui : du `.mjs` exécuté tel quel).
RUN pnpm --filter "@mip/service-mcp..." run --if-present build

# 4) DEPLOY, posé à `services/mcp` sous `/app` : même chemin qu'en développement.
#    En ligne, puis vérifié : sous pnpm 9, `deploy` résout de nouveau (hors
#    ligne, il échoue faute de métadonnées) ; `scripts/ci/deploy-fidele.mjs`
#    exige la version ET l'empreinte du lockfile pour chaque paquet posé.
COPY scripts/ci/deploy-fidele.mjs ./scripts/ci/deploy-fidele.mjs
RUN pnpm --filter @mip/service-mcp deploy --prod /app/services/mcp \
 && node scripts/ci/deploy-fidele.mjs pnpm-lock.yaml /app/services/mcp

# ──────────────────────────────── exécution ─────────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NODE_ENV=production

WORKDIR /app

# Propriété de root, lu par `node` : le processus ne réécrit pas son code.
COPY --from=construction /app /app

# Le port est imposé par l'hébergeur (Railway fournit PORT) ; 8080 est le défaut.
EXPOSE 8080

# Non-root : l'utilisateur `node` de l'image (uid 1000).
USER node

# POUR L'AUTO-HÉBERGEMENT (Railway sonde lui-même `/health`). `/health` ne
# dépend de rien : ce service n'a pas de dépendance à chaud.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# EXPLICITE : le transport distant. `services/mcp/stdio.mjs` sert l'usage LOCAL
# (Claude Desktop, un IDE) et n'a pas vocation à tourner dans un conteneur.
CMD ["node", "services/mcp/http.mjs"]
