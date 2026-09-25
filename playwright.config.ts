import { defineConfig } from "@playwright/test";
import { generateKeyPairSync, randomBytes } from "node:crypto";

// LE SECRET DE SESSION de la console de test : local et jetable. Les specs qui
// signent une session sans passer par /login (le crawl) le lisent ici.
process.env.E2E_AUTH_SECRET ??= "e2e-secret-local-jetable-non-production";

// C0 — LES SECRETS DE console-api, FABRIQUÉS À L'EXÉCUTION. Jamais une valeur
// versionnée : un jeu ES256 neuf et un secret client aléatoire à chaque passage.
// Rangés dans l'environnement du processus : le lanceur et ses workers (qui
// réévaluent ce fichier) voient ainsi LES MÊMES valeurs, et la console vérifie
// la poignée de main avec la clé publique du jeu que console-api signe.
if (!process.env.E2E_SESSION_SIGNING_KEYS) {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  const cle = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid: "session-e2e-local", alg: "ES256", use: "sig" };
  process.env.E2E_SESSION_SIGNING_KEYS = JSON.stringify({ keys: [{ ...cle, d: jwk.d }] });
  process.env.E2E_SESSION_PUBLIC_JWKS = JSON.stringify({ keys: [cle] });
  process.env.E2E_CONSOLE_API_SECRET = randomBytes(32).toString("hex");
  process.env.E2E_CONSOLE_API_METRICS_TOKEN = randomBytes(32).toString("hex");
}
const BASE_E2E = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum";

// Prérequis : Postgres up ET migré (docker compose -f infra/docker/docker-compose.yml run --rm migrate).
// Les 5 serveurs (ingestion, démo, rejeu, console-api, console) sont lancés/réutilisés automatiquement.
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
      // C0 — console-api, LE BUNDLE DE PRODUCTION (`build.mjs`), sur la base de
      // l'E2E. La console ci-dessous est BRANCHÉE dessus (C0b) : la vitrine lit
      // l'état de la plateforme par console-api, après une poignée de main signée.
      // `tests/e2e/console-api.spec.ts` prouve que le chemin est bien emprunté
      // (compteur du service), et pas seulement que le repli local a répondu.
      command: "node services/console-api/build.mjs && node services/console-api/dist/server.mjs",
      url: "http://localhost:4324/live",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        PORT: "4324",
        DATABASE_URL: BASE_E2E,
        CONSOLE_API_CLIENT_SECRETS: process.env.E2E_CONSOLE_API_SECRET!,
        SESSION_SIGNING_KEYS: process.env.E2E_SESSION_SIGNING_KEYS!,
        METRICS_TOKEN: process.env.E2E_CONSOLE_API_METRICS_TOKEN!,
        CONSOLE_API_RATE_LIMIT: "0",
        PGPOOL_MAX: "4",
      },
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
      env: {
        AUTH_SECRET: process.env.E2E_AUTH_SECRET!,
        // Branchée sur console-api (C0b) : les trois variables que Vercel portera.
        CONSOLE_API_URL: "http://localhost:4324",
        CONSOLE_API_CLIENT_SECRET: process.env.E2E_CONSOLE_API_SECRET!,
        SESSION_PUBLIC_JWKS: process.env.E2E_SESSION_PUBLIC_JWKS!,
      },
    },
  ],
});
