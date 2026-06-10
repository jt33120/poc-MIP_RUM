import { defineConfig } from "@playwright/test";

// Prérequis : Postgres up (docker compose -f apps/ingest/docker-compose.yml up -d).
// Les 3 serveurs (ingestion, démo, console) sont lancés/réutilisés automatiquement.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
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
      command: "pnpm --filter console dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
