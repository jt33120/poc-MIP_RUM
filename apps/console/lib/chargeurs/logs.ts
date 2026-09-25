// LE CHARGEUR DE L'ÉCRAN « Logs » (C5) — `app/logs/page.tsx`.
//
// CAPACITÉ FERMÉE (`lib/capacites.ts`) : tant qu'elle l'est, rien n'est lu — ici
// comme dans la page, et donc dans console-api aussi.
import { estFermee } from "../capacites";
import { analyserFiltres } from "../filtres-ecran";
import { logAnomalies, logEntries, logSeverityCounts, logsByRoute, logVolumeByHour, parseLevel } from "../queries-logs";
import { periodLabel, v2FiltersOf } from "../queries-v2";
import type { Chargeur } from "./commun";

export const chargerLogs = (async (principal, sp) => {
  if (estFermee("/logs")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, "/logs");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  const level = parseLevel(sp.level);
  const [rows, counts, volume, anomalies, byRoute] = await Promise.all([
    logEntries(f, level),
    logSeverityCounts(f),
    logVolumeByHour(f),
    logAnomalies(f),
    logsByRoute(f),
  ]);
  return { etat: "ok", query: ecran.query, periode: periodLabel(f), app: f.app, level, rows, counts, volume, anomalies, byRoute } as const;
}) satisfies Chargeur<unknown>;
