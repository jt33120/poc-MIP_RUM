// Donut — rendu serveur (SVG déterministe, zéro JS client), même idiome que
// Histogram/Funnel. Répartition d'un tout en parts (ex. nouveaux vs revenants,
// canaux d'acquisition). Anneau + centre libre (total, part dominante) + légende.
//
// REFUS D'EMPLOI (F03, plan § 4.1). Un anneau dit « ces parts font un tout ». Il ne
// s'emploie donc QUE sur des comptes additifs d'une même population (sessions,
// occurrences, avis), jamais sur :
//   - une moyenne ou un percentile (`avg`, `p75`) : des p75 ne s'additionnent pas,
//     leur « part » n'a pas de sens (V5) ;
//   - un compte distinct (`distinct` visiteurs par canal) : un visiteur vu sur deux
//     canaux compterait deux fois, la somme dépasse le tout (V2).
// Pour ces mesures, un classement (`RankBar`) sans total.
//
// CE QUE L'ANNEAU MONTRE :
//   - la part INCONNUE, nommée par l'appelant (`inconnu`) et dessinée en neutre : un
//     tout sans ses non-identifiés gonflerait chaque part connue ;
//   - les parts à 0, dans la légende (« 0 % » est une mesure) ; sans total, « — »,
//     jamais « 0 % » (rien n'est mesuré, rien n'est nul) ;
//   - un nom accessible qui énumère les parts.
import type { ReactNode } from "react";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Teinte de la part inconnue : neutre, jamais une couleur de catégorie ou de verdict. */
const COULEUR_INCONNU = "rgb(var(--c-ink-faint))";

/** Point sur le cercle de rayon r (angle en degrés, 0 = haut, sens horaire). */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Chemin d'un arc annulaire entre deux angles. */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, rOuter, a1);
  const [x1, y1] = polar(cx, cy, rOuter, a0);
  const [x2, y2] = polar(cx, cy, rInner, a0);
  const [x3, y3] = polar(cx, cy, rInner, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 0 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 1 ${x3} ${y3}`,
    "Z",
  ].join(" ");
}

/** « 42 % », « < 1 % » pour une part non nulle qui s'arrondirait à 0, « — » sans total. */
export function partAffichee(value: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (value / total) * 100;
  if (value > 0 && pct < 0.5) return "< 1 %";
  return `${Math.round(pct)} %`;
}

export function Donut({
  slices,
  inconnu,
  centerValue,
  centerLabel,
  ariaLabel,
  size = 200,
  thickness = 34,
}: {
  slices: DonutSlice[];
  /** Part inconnue (« Non identifiées »), dessinée en neutre et toujours listée. */
  inconnu?: { label: string; value: number };
  /** Grand chiffre au centre (ex. total). */
  centerValue?: ReactNode;
  /** Petit label sous le chiffre central. */
  centerLabel?: ReactNode;
  /** Nom accessible ; défaut : l'énumération des parts. */
  ariaLabel?: string;
  size?: number;
  thickness?: number;
}) {
  const parts: (DonutSlice & { inconnue?: boolean })[] = inconnu
    ? [...slices, { label: inconnu.label, value: inconnu.value, color: COULEUR_INCONNU, inconnue: true }]
    : slices;
  const total = parts.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - thickness;

  let angle = 0;
  const arcs =
    total > 0
      ? parts
          .filter((s) => s.value > 0)
          .map((s) => {
            const sweep = (s.value / total) * 360;
            const a0 = angle;
            const a1 = angle + Math.min(sweep, 359.999); // évite un arc complet dégénéré
            angle = a1;
            return { ...s, d: arcPath(cx, cy, rOuter, rInner, a0, a1) };
          })
      : [];
  const nom =
    ariaLabel ??
    `Répartition : ${parts
      .map((s) => `${s.label} ${s.value.toLocaleString("fr-FR")} (${partAffichee(s.value, total)})`)
      .join(", ")}`;

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={nom}>
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="rgb(var(--c-panel2))" strokeWidth={thickness} />
          ) : (
            arcs.map((a, i) => (
              <path key={i} d={a.d} fill={a.color} data-inconnue={a.inconnue ? "" : undefined}>
                <title>{`${a.label} : ${a.value.toLocaleString("fr-FR")} (${partAffichee(a.value, total)})`}</title>
              </path>
            ))
          )}
        </svg>
        {(centerValue != null || centerLabel != null) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue != null && (
              <span className="text-2xl font-bold tabular-nums tracking-tight text-ink">{centerValue}</span>
            )}
            {centerLabel != null && <span className="text-[10px] uppercase tracking-wider text-ink-faint">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
        {parts.map((s) => (
          <li key={s.label} className="flex items-center gap-2" data-testid={s.inconnue ? "donut-inconnu" : undefined}>
            <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <span className={`min-w-0 break-words ${s.inconnue ? "italic text-ink-soft" : "text-ink-soft"}`}>{s.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-ink">{s.value.toLocaleString("fr-FR")}</span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint">{partAffichee(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
