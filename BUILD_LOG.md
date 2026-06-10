# BUILD_LOG — POC MIP RUM

Journal factuel du build, étape par étape. Matière du bilan client (PLAN §15).

Environnement de build : macOS (Darwin 25.1.0), Node v26.0.0, pnpm 9.15.9, Docker 29.2.1, supabase CLI 2.67.1, vercel CLI 41.4.1. Pas de deno ni psql en local → Postgres via Docker, serveur d'ingestion dev en Node (la fonction Deno partage le même parser, cf. S2).

---

## S0 — Scaffolding

- **Ce qui a marché** : monorepo pnpm workspaces créé (rum-sdk / ingest / sync-synthetic / console), arbo conforme PLAN §4.1, PLAN.md copié, git initialisé.
- **Décisions** :
  - Secrets cloud (SUPABASE_ACCESS_TOKEN / VERCEL_TOKEN) absents de l'env → build 100 % local S0→S5, S6 préparé via DEPLOY.md (conforme au protocole).
  - Postgres local via docker-compose (plus léger que `supabase start` qui tire ~10 images) ; le schéma est appliqué par migration au démarrage du conteneur.
- **Écarts** : néant à ce stade.
