// GET /api/v1 — descripteur de l'API (version + endpoints), pour l'auto-découverte
// par l'équipe Angular MIP. Authentifié comme le reste (évite d'exposer la carte
// des routes à un anonyme).
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
  endpoints: [
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
  ],
}));
