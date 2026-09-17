// Résolveur de widget (P1, dashboards) : mappe un Widget + filtres globaux vers une
// forme d'affichage UNIFORME (value | table), en réutilisant les requêtes existantes.
// Centralise la glue (conventions de Filters différentes selon les modules) pour que
// la page de rendu ET l'export CSV partagent exactement la même donnée. Fail-soft.
import type { Widget } from "./dashboards";
import type { Filters } from "./filters";
import { fmtVital } from "./format";
import { dailyTraffic } from "./queries-grid";
import { topFrustrations } from "./queries-frustration";
import { listErrorGroups } from "./queries-errors";
import { slowRoutes, vitalsP75 } from "./queries";
import { eventCount } from "./queries-events";

export interface WidgetData {
  kind: "value" | "table";
  value?: string; // résumé (kind 'value' ou en-tête de table)
  sub?: string;
  columns?: string[];
  rows?: (string | number)[][];
}

const EMPTY: WidgetData = { kind: "table", columns: [], rows: [] };
const num = (v: unknown) => (v == null ? "—" : Math.round(Number(v)));

/** Résout la donnée d'un widget. `f` = filtres effectifs (app déjà résolue au scope
 *  du dashboard ; période/device globaux). Ne jette jamais (widget en échec → vide). */
export async function resolveWidget(w: Widget, f: Filters): Promise<WidgetData> {
  try {
    switch (w.type) {
      case "vital_p75": {
        const r = (await vitalsP75(f)).find((x) => x.name === w.metric);
        return r && r.p75 != null
          ? { kind: "value", value: fmtVital(w.metric ?? "", Number(r.p75)), sub: `${r.n} mesures` }
          : { kind: "value", value: "—", sub: "aucune donnée" };
      }
      case "traffic": {
        const rows = await dailyTraffic(f);
        const pv = rows.reduce((s, r) => s + r.pageviews, 0);
        const er = rows.reduce((s, r) => s + r.errors, 0);
        return {
          kind: "table",
          value: `${pv.toLocaleString("fr-FR")} vues · ${er.toLocaleString("fr-FR")} erreurs`,
          columns: ["Jour", "Pages vues", "Erreurs"],
          rows: rows.map((r) => [String(r.day).slice(0, 10), r.pageviews, r.errors]),
        };
      }
      case "slow_routes": {
        const rows = (await slowRoutes(f)).slice(0, 8);
        return {
          kind: "table",
          columns: ["Route", "Vues", "LCP p75", "INP p75"],
          rows: rows.map((r) => [r.route, r.views, num(r.lcp_p75), num(r.inp_p75)]),
        };
      }
      case "top_errors": {
        // Même lecture que l'écran Erreurs, segment, bots et apps internes compris :
        // la conversion vers le modèle v2 perdait ces trois filtres, et la tuile
        // pouvait afficher un autre nombre que la liste qu'elle résume.
        const { groups: rows } = await listErrorGroups(f, { limit: 8, offset: 0 });
        return {
          kind: "table",
          columns: ["Erreur", "Occurrences", "Sessions"],
          rows: rows.map((r) => [
            r.error_type || r.sample_message || r.fingerprint,
            r.occurrences,
            r.sessions,
          ]),
        };
      }
      case "frustration": {
        const rows = (await topFrustrations(f)).slice(0, 8);
        return {
          kind: "table",
          columns: ["Type", "Cible", "Route", "Occurrences"],
          rows: rows.map((r) => [r.kind, r.target, r.route, r.n]),
        };
      }
      case "event_count": {
        if (!w.eventName) return { kind: "value", value: "—", sub: "nom d’événement manquant" };
        const result = await eventCount(f, w.eventName);
        if (!result.available || result.count == null) {
          return { kind: "value", value: "—", sub: result.diagnostic ?? "donnée indisponible" };
        }
        return {
          kind: "value",
          value: result.count.toLocaleString("fr-FR"),
          sub: result.sampling_notice?.message ?? `événements « ${w.eventName} » observés`,
        };
      }
      default:
        return EMPTY;
    }
  } catch {
    return EMPTY;
  }
}

/** Sérialise une donnée de widget en lignes CSV (échappement RFC 4180 minimal). */
export function widgetToCsv(title: string, d: WidgetData): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [`# ${title}`];
  if (d.value) lines.push(esc(d.value));
  if (d.columns?.length) {
    lines.push(d.columns.map(esc).join(","));
    for (const row of d.rows ?? []) lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}
