// Service « api » — l'API de lecture v1 de MIP RUM, pour les machines :
// partenaires, front tiers, CI, et le serveur MCP (P4).
//
// CÂBLAGE SEUL. Les routes sont CELLES DE LA CONSOLE (`apps/console/app/api/v1`),
// compilées dans ce service par `build.mjs` (voir son en-tête : bundle, trois
// substitutions, gardes). La table des routes vient de l'arborescence
// (`routeur.mjs`) ; le processus (configuration, sondes, arrêt propre, pool) du kit.
//
// POURQUOI UN SERVICE À PART DE LA CONSOLE. C'est la surface qu'un modèle de
// langage peut piloter (MCP) et qu'un partenaire appelle avec son jeton. Elle
// doit rester en LECTURE, sans aucun secret de session : ce service ne sert que
// GET, HEAD, OPTIONS et la lecture POST de l'Explorer ; il n'embarque pas la
// vérification des sessions de la console (garde de build) ; un cookie n'y vaut
// rien (401). Les écritures de l'API v1 (triage, commentaires, liens, tickets,
// vues, marqueurs de déploiement) restent à la console jusqu'à `console-api`.
//
// LES SONDES : /health (processus + base, sonde Railway), /live (processus),
// /ready et /metrics derrière METRICS_TOKEN.
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool, describeTarget } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { ROUTES } from "mip:routes";
import { brancherPool } from "./shims/db.mjs";
import { NextRequest } from "./shims/next-server.mjs";
import { POST_DE_LECTURE, creerRouteur, methodeServie } from "./routeur.mjs";

const log = createLogger("api");
const lifecycle = installLifecycle({ log });

const config = defineConfig(
  {
    ...COMMON_ENV,
    DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"], description: "Postgres. Cible : le rôle mip_api, en lecture seule (migration v89)." },
    PGPOOL_MAX: { type: "int", default: 6, min: 2, max: 20, description: "Taille du pool, par réplique." },
    CONSOLE_API_TOKENS: { type: "string", secret: true, description: "Jetons machine, `jeton` ou `jeton@app1;app2` séparés par des virgules — la MÊME valeur que sur la console. Les jetons en base (écran Jetons de lecture) valent aussi." },
    CONSOLE_API_ALLOWED_ORIGINS: { type: "string", description: "Origines autorisées en CORS, séparées par des virgules — la MÊME valeur que sur la console." },
    CONSOLE_API_RATE_LIMIT: { type: "int", min: 0, max: 100_000, description: "Requêtes par minute et par principal, par réplique (défaut 120 ; 0 = sans limite)." },
    XSOM_AI_URL: { type: "url", protocols: ["https:", "http:"], description: "xSOM AI Guard, pour la moitié IA de /api/rum/summary. Absent : section IA indisponible." },
    XSOM_AI_TOKEN: { type: "string", secret: true, description: "Jeton de lecture xSOM AI Guard." },
  },
  { service: "api", log },
);

const metrics = createMetrics();
const pool = createPool(pg, {
  connectionString: config.DATABASE_URL,
  applicationName: "mip-api",
  max: config.PGPOOL_MAX,
  log,
  metrics,
  lifecycle,
});
brancherPool(pool);

const router = creerRouteur(ROUTES);
const requetes = metrics.counter("api_requests_total", "Requêtes de l'API v1, par route et par statut.", {
  labels: ["route", "status"],
});

function json(statut, corps, entetes = {}) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json", ...entetes } });
}

async function servir(request) {
  const { pathname } = new URL(request.url);
  const trouve = router(pathname);
  if (!trouve) return json(404, { error: "route inconnue de l'API v1" });
  const { entree, params } = trouve;
  const methode = request.method === "HEAD" ? "GET" : request.method;

  if (!methodeServie(entree.chemin, request.method) || typeof entree.module[methode] !== "function") {
    const permises = ["GET", "HEAD", "OPTIONS", ...(POST_DE_LECTURE.includes(entree.chemin) ? ["POST"] : [])]
      .filter((m) => typeof entree.module[m === "HEAD" ? "GET" : m] === "function");
    requetes.inc({ route: entree.chemin, status: "405" });
    return json(
      405,
      { error: "méthode non servie par l'API publique, en lecture seule : les écritures passent par la console" },
      permises.length ? { allow: permises.join(", ") } : {},
    );
  }

  const reponse = await entree.module[methode](new NextRequest(request), { params: Promise.resolve(params) });
  requetes.inc({ route: entree.chemin, status: String(reponse.status) });
  return reponse;
}

startService({
  name: "api",
  port: config.PORT,
  log,
  pool,
  metrics,
  metricsToken: config.METRICS_TOKEN,
  lifecycle,
  // L'Explorer envoie un AST, jamais plus de quelques Kio ; 256 Kio suffisent.
  maxBodyBytes: 256 * 1024,
  // SIGNÉE, comme le collector : le relais de la console distingue ainsi une
  // réponse du service (rendue telle quelle, 404 et 401 compris) d'une réponse
  // du routeur Railway devant lui (service absent : repli local).
  responseHeaders: { "x-mip-api": "1" },
  fetch: servir,
});

log.info("api démarrée", {
  db: describeTarget(config.DATABASE_URL),
  routes: ROUTES.length,
  jetons: Boolean(config.CONSOLE_API_TOKENS),
  cors: Boolean(config.CONSOLE_API_ALLOWED_ORIGINS),
});
