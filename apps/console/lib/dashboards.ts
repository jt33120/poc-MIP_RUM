// Tableaux de bord configurables (P1) — helpers PURS (catalogue de widgets +
// validation/normalisation du layout). Aucun accès base ici (testable).

export const WIDGET_TYPES = [
  "vital_p75",
  "traffic",
  "slow_routes",
  "top_errors",
  "frustration",
  "event_count",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

export interface Widget {
  type: WidgetType;
  title: string;
  metric?: string; // requis pour vital_p75 (LCP|INP|…)
  eventName?: string; // requis pour event_count
  // v1 : widgets scopés app + période/device globaux. Le filtrage par route est un
  // suivi (les requêtes réutilisées n'acceptent pas encore de paramètre route).
}

/** Métadonnées d'affichage/édition par type de widget. */
export const WIDGET_META: Record<WidgetType, { label: string; needsMetric: boolean; needsEventName?: boolean }> = {
  vital_p75: { label: "Web Vital (p75)", needsMetric: true },
  traffic: { label: "Trafic (pages vues / erreurs)", needsMetric: false },
  slow_routes: { label: "Routes les plus lentes", needsMetric: false },
  top_errors: { label: "Top erreurs", needsMetric: false },
  frustration: { label: "Signaux de frustration", needsMetric: false },
  event_count: { label: "Événements custom (nombre)", needsMetric: false, needsEventName: true },
};

export const MAX_WIDGETS = 24;
const TITLE_MAX = 60;

const isType = (t: unknown): t is WidgetType =>
  typeof t === "string" && (WIDGET_TYPES as readonly string[]).includes(t);

/** Titre par défaut d'un widget (type + métrique éventuelle). */
export function defaultTitle(type: WidgetType, metric?: string, eventName?: string): string {
  if (type === "vital_p75" && metric) return `${metric} p75`;
  if (type === "event_count" && eventName) return `Événements · ${eventName}`;
  return WIDGET_META[type].label;
}

/**
 * Normalise un layout (issu du jsonb ou d'un POST) : garde uniquement les widgets
 * valides, borne le nombre, nettoie titre/route, impose une métrique valide aux
 * widgets vital_p75 (sinon le widget est écarté). Jamais d'exception (fail-soft).
 */
export function normalizeLayout(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const item of raw) {
    if (out.length >= MAX_WIDGETS) break;
    if (!item || typeof item !== "object") continue;
    const w = item as Record<string, unknown>;
    if (!isType(w.type)) continue;
    let metric: string | undefined;
    if (WIDGET_META[w.type].needsMetric) {
      const m = typeof w.metric === "string" ? w.metric : "";
      if (!(WIDGET_VITALS as readonly string[]).includes(m)) continue; // vital_p75 sans métrique valide → écarté
      metric = m;
    }
    let eventName: string | undefined;
    if (WIDGET_META[w.type].needsEventName) {
      const name = typeof w.eventName === "string" ? w.eventName.trim() : "";
      if (!name || name.length > 100 || /[\u0000-\u001F\u007F]/.test(name)) continue;
      eventName = name;
    }
    const title =
      typeof w.title === "string" && w.title.trim()
        ? w.title.trim().slice(0, TITLE_MAX)
        : defaultTitle(w.type, metric, eventName);
    out.push({ type: w.type, title, ...(metric ? { metric } : {}), ...(eventName ? { eventName } : {}) });
  }
  return out;
}
