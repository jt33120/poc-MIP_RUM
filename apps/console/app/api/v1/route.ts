// GET /api/v1 — descripteur de l'API (version + endpoints), pour l'auto-découverte
// par l'équipe Angular MIP. Authentifié comme le reste (évite d'exposer la carte
// des routes à un anonyme). La spec machine est sur /api/v1/openapi (publique).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async () => ({
  version: "1",
  description: "API lecture seule des agrégats RUM (consommée par le front MIP).",
  filters: {
    app: "slug d'app, ou 'all' (défaut)",
    period: "1h | 24h (défaut) | 7d",
    device: "mobile | desktop | tablet | all (défaut)",
  },
  pagination: "les listes (/errors, /sessions) acceptent limit (1..200) & offset ; page renvoyée dans data.page",
  spec: "/api/v1/openapi (OpenAPI 3.0, sans auth)",
  endpoints: [
    { method: "GET", path: "/api/v1/health", desc: "liveness (sans auth)" },
    { method: "GET", path: "/api/v1/openapi", desc: "spec OpenAPI 3.0 (sans auth)" },
    { method: "GET", path: "/api/v1/apps", desc: "catalogue des apps monitorées" },
    { method: "GET", path: "/api/v1/overview", desc: "health score + vitals p75 + stats (avec période précédente)" },
    { method: "GET", path: "/api/v1/vitals", desc: "p75 par vital + séries temporelles (?series=LCP,INP)" },
    { method: "GET", path: "/api/v1/pages", desc: "routes les plus lentes (p75 LCP/INP)" },
    { method: "GET", path: "/api/v1/errors", desc: "groupes d'erreurs (fingerprint) + non groupées" },
    { method: "GET", path: "/api/v1/errors/{fingerprint}", desc: "détail d'un groupe d'erreurs" },
    { method: "GET", path: "/api/v1/sessions", desc: "sessions récentes" },
    { method: "GET", path: "/api/v1/sessions/{id}", desc: "métadonnées + timeline d'une session" },
    { method: "GET", path: "/api/v1/tracing", desc: "couverture tracing + appels API + routes back" },
    { method: "GET", path: "/api/v1/correlation", desc: "corrélation front/back + angles morts" },
    { method: "GET", path: "/api/v1/health-grid", desc: "heatmap santé (jour×heure) + trafic quotidien" },
    { method: "GET", path: "/api/v1/ai", desc: "performance IA : coût/tokens/latence/erreurs (global + par modèle/route + série jour + derniers appels ?recent=0..200)" },
    { method: "GET", path: "/api/v1/ai/costs", desc: "coût IA agrégé ?group_by=user (défaut) | model | route ; user = par user_hash + bucket non attribué" },
  ],
}));
