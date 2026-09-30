// LE CHARGEUR DE L'ÉCRAN « Logs » (C5) — `app/logs/page.tsx`.
//
// CAPACITÉ FERMÉE (`lib/capacites.ts`) : tant qu'elle l'est, rien n'est lu — ici
// comme dans la page, et donc dans console-api aussi.
import { estFermee } from "../capacites";
import { analyserFiltres } from "../filtres-ecran";
import { logAnomalies, logEntries, logSeverityCounts, logsByRoute, logVolumeByHour, parseLevel } from "../queries-logs";
import { periodLabel, v2FiltersOf } from "../queries-v2";
import { sectionFenetresCollecteRecentes } from "./collecte";
import type { Chargeur } from "./commun";

const HEURE_MS = 3_600_000;

/**
 * Les 24 heures du volume (`logVolumeByHour`), en débuts de seau ISO : l'heure
 * entamée en dernier, les 23 précédentes avant elle — le rang que la lecture donne
 * à chaque heure tronquée. Calculées ICI, à l'instant de la lecture : la page ne
 * refait pas l'horloge (elle tourne ailleurs quand console-api sert l'écran).
 */
export function heuresDuVolume(maintenant: number): string[] {
  const derniere = Math.floor(maintenant / HEURE_MS) * HEURE_MS;
  return Array.from({ length: 24 }, (_v, i) => new Date(derniere - (23 - i) * HEURE_MS).toISOString());
}

export const chargerLogs = (async (principal, sp) => {
  if (estFermee("/logs")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, "/logs");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  const level = parseLevel(sp.level);
  const maintenant = Date.now();
  const [rows, counts, volume, anomalies, byRoute, fenetresCollecte] = await Promise.all([
    logEntries(f, level),
    logSeverityCounts(f),
    logVolumeByHour(f),
    logAnomalies(f),
    logsByRoute(f),
    // Les hachures « non mesuré » du volume horaire : ses 24 heures fixes, pas la
    // plage de l'écran ; une section à part, son échec n'emporte rien.
    sectionFenetresCollecteRecentes(ecran.query, 24 * HEURE_MS, maintenant),
  ]);
  return {
    etat: "ok",
    query: ecran.query,
    periode: periodLabel(f),
    app: f.app,
    level,
    rows,
    counts,
    volume,
    heures: heuresDuVolume(maintenant),
    anomalies,
    byRoute,
    fenetresCollecte,
  } as const;
}) satisfies Chargeur<unknown>;
