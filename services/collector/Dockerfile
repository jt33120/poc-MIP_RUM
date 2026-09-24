# Image du service `collector` — collecte OTLP (traces, logs, replay, source maps).
#
# UN DOCKERFILE PAR SERVICE (P1, contrat de service § 9). Il y en avait un pour
# le collecteur, le scheduler et les migrations à la fois, dont la commande par
# défaut démarrait le collecteur : le jour où la commande de démarrage d'un
# service se perdait dans le tableau de bord, le `scheduler` bootait un receveur
# OTLP, sans une ligne d'erreur. Ici l'image ne sait démarrer QUE ce service, et
# elle le dit dans son `CMD`. Une image qui porte trois services porte aussi les
# dépendances des trois : le collecteur n'a que faire du migrateur et de ses 87
# fichiers SQL, le scheduler de la base GeoIP.
#
# LA RECETTE, COMMUNE AUX TROIS IMAGES (services/{collector,scheduler,mcp}) :
#
#   construction   pnpm fetch  →  pnpm install --offline  →  build  →  pnpm deploy --prod
#   exécution      l'arbre déployé, rien d'autre : ni pnpm, ni le dépôt, ni le store
#
# Le dépôt est un monorepo pnpm. L'ancienne image l'évitait (`npm install` du
# seul `pg`, arborescence recomposée À LA MAIN, un `COPY` par dossier) : chaque
# fichier ajouté à un paquet devait être ajouté au Dockerfile, et un oubli ne se
# voyait qu'à l'exécution. `pnpm deploy` fait ce travail depuis le lockfile : il
# pose le service et la fermeture de ses dépendances de PRODUCTION, paquets du
# workspace compris (copiés, pas liés), et rien d'autre.
#
# Contexte de build = RACINE du dépôt (Railway le fait par défaut ; le compose
# d'`infra/docker` aussi). `.dockerignore` tient hors du contexte les
# `node_modules`, les `.env` et une base GeoIP déposée à la main.
#
# NODE 24 SUR DEBIAN (glibc), la version de `.nvmrc`, ÉPINGLÉE PAR DIGEST. Une
# étiquette bouge : `24-bookworm-slim` désigne une autre image à chaque
# correctif de Node ou de Debian, et deux constructions du même commit
# pouvaient embarquer deux runtimes. Le digest est celui de l'INDEX
# multi-architecture (amd64 pour Railway et la CI, arm64 pour un poste Apple) ;
# l'étiquette qui le précède n'est là que pour le lecteur. Les trois images
# épinglent le MÊME digest, et un test unitaire le vérifie
# (tests/unit/images-services.test.ts) : le monter, c'est le monter partout.
# Relevé le 23/09/2026 : node 24.21.0.

# ─────────────────────────────── construction ───────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS construction

WORKDIR /depot

# pnpm, à la version que déclare le dépôt (`packageManager` du package.json
# racine) — lue, pas recopiée : la monter là-bas la monte ici. Par npm et non
# par corepack : corepack quitte la distribution de Node après la 24, et le
# jour où l'image montera, la construction ne doit pas casser pour ça.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-audit --no-fund \
      "$(node -p 'require("./package.json").packageManager.split("+")[0]')" \
 && npm cache clean --force

# 1) FETCH : le lockfile seul. Cette couche ne dépend d'aucun fichier source —
#    elle reste en cache tant que les VERSIONS ne bougent pas, quel que soit le
#    code modifié. Le lockfile couvre tout le workspace, console et outils de
#    développement compris : ce téléchargement est plus large que le service,
#    c'est le prix d'une couche indépendante des sources (≈ 320 paquets, une
#    vingtaine de secondes). Il reste dans cette étape ; l'image finale n'en
#    garde rien.
#
#    PAS `--prod` ICI, alors que l'image n'embarquera que la production : la
#    construction peut avoir besoin d'outils de développement (étape 3), et
#    `pnpm deploy` — même `--prod` — résout les dépendances directes de la
#    racine du workspace, devDependencies comprises. Un store sans vitest le
#    fait échouer en mode hors ligne (ERR_PNPM_NO_OFFLINE_TARBALL, constaté).
#
#    PAS DE `RUN --mount=type=cache` : Railway exige des identifiants de cache
#    préfixés par l'identifiant du service (`s/<id>-…`) et refuse la
#    construction sinon — le même Dockerfile ne servirait plus aux deux.
RUN pnpm fetch

# 2) INSTALL, HORS LIGNE. Les paquets partagés et CE service, rien d'autre : un
#    commit qui ne touche que la console ne reconstruit pas cette couche.
#    `packages/` entier plutôt qu'une liste : une dépendance de workspace
#    ajoutée au service est ainsi présente sans retoucher ce fichier.
#    `--offline` : tout vient du store rempli à l'étape 1 ; si le lockfile ne
#    couvre pas une dépendance, la construction échoue ici, bruyamment, au lieu
#    d'aller la chercher à une version que personne n'a relue.
COPY packages ./packages
COPY services/collector ./services/collector
RUN pnpm install --offline --frozen-lockfile --filter "@mip/service-collector..."

# 3) BUILD. Aucun paquet de ce service n'a d'étape de construction aujourd'hui
#    (du `.mjs` exécuté tel quel) ; `--if-present` rend l'étape inerte, et
#    correcte le jour où l'un d'eux en gagne une.
RUN pnpm --filter "@mip/service-collector..." run --if-present build

# 4) DEPLOY. Le service et ses dépendances de production, dans un dossier
#    autonome. Il est posé à `services/collector` sous `/app` : les commandes
#    de démarrage écrites ailleurs (compose, `.railway/railway.ts`) gardent le
#    même chemin qu'en développement, `node services/collector/server.mjs`.
#
#    EN LIGNE, PUIS VÉRIFIÉ. Sous pnpm 9, `deploy` résout de nouveau les
#    dépendances du service (il réécrit `workspace:*` en `file:`) et réclame
#    pour cela des métadonnées du registre que `pnpm fetch` ne garde pas :
#    `--offline` échoue (ERR_PNPM_NO_OFFLINE_META, constaté). Il préfère les
#    versions du lockfile sans y être tenu ; `scripts/ci/deploy-fidele.mjs`
#    exige donc, paquet par paquet, la version ET l'empreinte d'intégrité du
#    lockfile, et fait échouer la construction au moindre écart.
COPY scripts/ci/deploy-fidele.mjs ./scripts/ci/deploy-fidele.mjs
RUN pnpm --filter @mip/service-collector deploy --prod /app/services/collector \
 && node scripts/ci/deploy-fidele.mjs pnpm-lock.yaml /app/services/collector

# 5) LA BASE IP→PAYS, DANS CETTE IMAGE SEULE. Le GeoIP est une affaire de
#    collecte : le scheduler et le serveur MCP n'ont pas à porter 4,5 Mio qui
#    ne leur servent à rien.
#
#    Déposée par `scripts/fetch-geoip-db.mjs`, qui lit version, URL et sha256
#    dans le MANIFESTE versionné (`packages/backend/data/*.manifest.json`) et
#    vérifie que le fichier se charge. L'ancienne image recopiait version et
#    empreinte en arguments de build : deux sources pour un même fait, et une
#    livraison mensuelle à reporter à deux endroits.
#
#    Destination : `node_modules/@mip/backend/data`, là où `lib/geoip-db.mjs`
#    la cherche (`../data`, relatif à son propre fichier).
#
#    UN TÉLÉCHARGEMENT EN ÉCHEC N'ARRÊTE PAS LA CONSTRUCTION, ET C'EST LE
#    CONTRAT : GeoIP ne doit jamais empêcher quoi que ce soit. db-ip.com
#    indisponible, empreinte qui ne correspond pas — l'image se construit quand
#    même, part sans base, et le pays reste estimé d'après le fuseau. La COPIE,
#    elle, n'est pas tolérée : une base obtenue qu'on ne sait pas poser est un
#    défaut de l'image, pas un aléa du réseau. `--build-arg GEOIP_FETCH=0` pour
#    une construction sans aucune sortie réseau vers db-ip.com ; la base se
#    monte alors sur un volume, via GEOIP_DB_PATH. Ce téléchargement est un
#    fichier statique public : aucune adresse de visiteur n'est envoyée nulle part.
ARG GEOIP_FETCH=1
COPY scripts/fetch-geoip-db.mjs ./scripts/fetch-geoip-db.mjs
RUN if [ "$GEOIP_FETCH" = "1" ]; then \
      if node scripts/fetch-geoip-db.mjs; then \
        cp packages/backend/data/dbip-country-lite-*.csv.gz /app/services/collector/node_modules/@mip/backend/data/; \
      else \
        echo "geoip: base non déposée, la collecte fonctionnera sans"; \
      fi; \
    fi

# ──────────────────────────────── exécution ─────────────────────────────────
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NODE_ENV=production \
    LOG_LEVEL=info

WORKDIR /app

# L'arbre déployé, propriété de root : le processus (utilisateur `node`) le lit
# et ne peut pas le réécrire. Rien ici n'écrit sur disque.
COPY --from=construction /app /app

# Le port est imposé par l'hébergeur (Railway fournit PORT) ; 4318 est le port
# OTLP/HTTP standard, et le défaut local.
EXPOSE 4318

# Non-root : l'image node fournit l'utilisateur `node` (uid 1000).
USER node

# POUR L'AUTO-HÉBERGEMENT. Railway ignore cette instruction et sonde lui-même
# `/health` (`.railway/railway.ts`) ; `docker run` et compose, eux, s'en
# servent. Par `fetch` de Node : l'image « slim » n'a ni curl ni wget. Le port
# suit la même résolution que le point d'entrée (PORT, défaut 4318).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 4318}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# EXPLICITE, et le seul que cette image sache lancer.
# Node en PID 1 ne reçoit SIGTERM que parce que le point d'entrée l'écoute
# (`installLifecycle` du kit) : sans gestionnaire, le noyau ignore le signal pour le
# PID 1, et `docker stop` attendrait son SIGKILL.
CMD ["node", "services/collector/server.mjs"]
