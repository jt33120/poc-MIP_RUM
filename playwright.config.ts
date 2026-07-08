import { defineConfig } from "@playwright/test";

// Prérequis : Postgres up (docker compose -f apps/ingest/docker-compose.yml up -d).
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
      command: "node apps/ingest/dev-server.mjs",
      url: "http://localhost:4318/__recent",
      reuseExistingServer: true,
    },
    {
      command: "node demo/serve.mjs",
      url: "http://localhost:8080",
      reuseExistingServer: true,
    },
    {
      command: "node apps/ingest/replay-dev-server.mjs",
      url: "http://localhost:4319/__health",
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter console dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
