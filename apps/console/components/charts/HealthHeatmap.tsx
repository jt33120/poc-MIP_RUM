// Heatmap calendaire « tenue dans la durée » — une ligne = un jour, une colonne
// = une heure, une case colorée = la santé de ce créneau (part de mesures
// « good », LCP ×2, comme le health score). Rendu 100 % serveur (divs + CSS
// grid, zéro dépendance ni JS client) : s'intègre au rendu SSR-first de la
// console. Le composant est « bête » — il reçoit l'axe des jours et les cases
// déjà agrégées, ce qui le rend réutilisable pour de la donnée réelle comme
// pour un échantillon de démonstration.

import { PALIERS_SEQUENTIELLE, SEQUENTIELLE } from "@/lib/palette";

export interface HeatCell {
  good_w: number;
  total_w: number;
}

// ÉCHELLE SÉQUENTIELLE, PAS DE VERDICT (F01, règle R-S du plan). Les cases étaient
// vertes au-dessus de 90 % de mesures « Bon », ambre au-dessus de 50 %, rouges en
// dessous : deux seuils sans aucune source, peints aux couleurs des verdicts
// web.dev. Une part de mesures « Bon » est une intensité ; elle se lit sur une
// teinte unique, et la valeur exacte est dans l'infobulle.

/** Part pondérée de mesures « Bon » d'une case, ou null sans mesure. */
function partBon(c: HeatCell | undefined): number | null {
  return c && c.total_w > 0 ? c.good_w / c.total_w : null;
}

/** Clé de jour stable (UTC) partagée entre l'axe et les cases. */
export const dayKey = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);

function rowLabel(key: string): string {
  return new Date(key).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

const HOURS = Array.from({ length: 24 }, (_v, h) => h);
// Heures ouvrées : 8h → 19h inclus (créneaux 08:00–19:59).
const BUSINESS_HOURS = Array.from({ length: 12 }, (_v, i) => i + 8);
const isWeekday = (key: string): boolean => {
  const d = new Date(key).getUTCDay(); // 0 = dimanche, 6 = samedi
  return d >= 1 && d <= 5;
};

export function HealthHeatmap({
  dayKeys,
  byKey,
  businessOnly = false,
}: {
  /** Axe vertical : clés de jour (cf. dayKey), du plus ancien au plus récent. */
  dayKeys: string[];
  /** Cases agrégées indexées par `${dayKey}|${hour}`. */
  byKey: Map<string, HeatCell>;
  /** Heures ouvrées : ne montre que Lun–Ven, 8h–19h (créneaux où l'on attend du trafic). */
  businessOnly?: boolean;
}) {
  const hours = businessOnly ? BUSINESS_HOURS : HOURS;
  const rows = businessOnly ? dayKeys.filter(isWeekday) : dayKeys;
  // Colonnes : étiquette de jour (auto) + N heures de largeur égale.
  const gridCols = `minmax(4.5rem, auto) repeat(${hours.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* en-tête : repères horaires tous les 3 h */}
        <div className="grid items-end gap-[3px] pb-1" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[9px] tabular-nums text-ink-faint">
              {h % 3 === 0 ? `${h}h` : ""}
            </span>
          ))}
        </div>

        {rows.map((key) => (
          <div
            key={key}
            className="grid items-center gap-[3px] py-[1.5px]"
            style={{ gridTemplateColumns: gridCols }}
          >
            <span className="pr-2 text-right text-[10px] capitalize tabular-nums text-ink-faint">
              {rowLabel(key)}
            </span>
            {hours.map((h) => {
              const part = partBon(byKey.get(`${key}|${h}`));
              return (
                <span
                  key={h}
                  className={`h-4 rounded-[3px] ${part == null ? "bg-panel2 opacity-60" : "transition hover:ring-2 hover:ring-ink/30"}`}
                  style={part == null ? undefined : { backgroundColor: SEQUENTIELLE(part) }}
                  title={
                    part == null
                      ? `${rowLabel(key)} · ${h}h — aucune donnée`
                      : `${rowLabel(key)} · ${h}h — ${Math.round(part * 100)} % de mesures « Bon » (pondéré)`
                  }
                />
              );
            })}
          </div>
        ))}

        {/* légende */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
          <span className="flex items-center gap-1.5">
            % de mesures « Bon », pondéré :
            <span>0 %</span>
            {PALIERS_SEQUENTIELLE.map((c) => (
              <span key={c} className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: c }} aria-hidden="true" />
            ))}
            <span>100 %</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-panel2 opacity-60" aria-hidden="true" />
            aucune donnée
          </span>
          <span className="ml-auto">case vide = aucune page vue ce créneau · LCP pondéré ×2</span>
        </div>
      </div>
    </div>
  );
}

/** Construit l'axe des jours (UTC) : N jours jusqu'à aujourd'hui, ordre chrono. */
export function lastNDayKeys(n: number): string[] {
  const today = new Date();
  return Array.from({ length: n }, (_v, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}
