import { defineConfig } from "@playwright/test";

// Prérequis : Postgres up ET migré (docker compose -f infra/docker/docker-compose.yml run --rm migrate).
// Les 3 serveurs (ingestion, démo, console) sont lancés/réutilisés automatiquement.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  // L'e2e simule un VRAI utilisateur : on présente un User-Agent de navigateur
  // réel (sinon "HeadlessChrome" serait classé bot par l'ingestion — Lot 2 — et
  // exclu des agrégats console, faussant les assertions RUM). Améliore aussi la
  // fidélité du parcours simulé.
  use: {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  },
  webServer: [
    {
      command: "node services/collector/dev-server.mjs",
      url: "http://localhost:4318/__recent",
      reuseExistingServer: true,
      // Opt-in EXPLICITE du tampon /__recent (payloads en clair) : sans lui, le
      // receveur le laisse éteint et cette URL de disponibilité répond 404.
      env: { MIP_E2E_TAMPON: "1" },
    },
    {
      command: "node demo/serve.mjs",
      url: "http://localhost:8080",
      reuseExistingServer: true,
    },
    {
      command: "node services/collector/replay-dev-server.mjs",
      url: "http://localhost:4319/__health",
      reuseExistingServer: true,
    },
    {
      // BUILD DE PRODUCTION, pas `next dev` — délibérément.
      //
      // Avec `next dev`, les routes se compilent à la demande, à la première
      // visite. Deux workers Playwright frappant en parallèle une console de
      // 47 pages sérialisent donc des compilations coûteuses derrière un timeout
      // de 90 s : la suite passait ou échouait selon la charge de la machine, et
      // a fini par échouer plus souvent qu'elle ne passait (reproduit en local :
      // verte à 1 worker, rouge à 2). Ce n'était pas un défaut du produit mais
      // du harnais.
      //
      // `next build` puis `next start` supprime la variable : tout est compilé
      // avant le premier test. Bonus de fidélité — on teste désormais le binaire
      // que Vercel déploie, pas le serveur de développement.
      //
      // AUTH_SECRET est OBLIGATOIRE ici : en NODE_ENV=production, resolveAuthSecret
      // refuse (fail-closed) de signer une session avec le secret de dev. Valeur
      // de test, locale et jetable — jamais un secret réel.
      command: "pnpm --filter console build && pnpm --filter console start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 300_000, // le build est inclus dans cette fenêtre
      env: { AUTH_SECRET: "e2e-secret-local-jetable-non-production" },
    },
  ],
});
