// GrapheMesure — le graphique « grand format » de la fenêtre d'une mesure
// (tableau de bord, recette du 30/09/2026). SVG rendu serveur, sans bibliothèque.
//
// CE QU'IL ÉCRIT, TOUJOURS : les deux axes et leur titre (grandeur et unité), des
// graduations chiffrées, l'heure de Paris sous l'axe du temps, et les seuils quand
// la mesure en a (web.dev). Mêmes règles de vérité que la sparkline : un seau sans
// mesure est un TROU (la ligne s'interrompt), l'axe vertical part de zéro.
//
// ÉCHELLE ROBUSTE. Une seule tranche aberrante (un p75 de 800 s sur une tranche de
// deux mesures) écrasait tout le reste contre l'axe. Le sommet suit le 90ᵉ centile
// des points (et le seuil « mauvais ») ; un point au-dessus est posé au sommet,
// marqué ▲, et le pied du graphique dit combien et jusqu'où.
import { formater, type FormatId } from "@/lib/fmt-ids";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";

const L = 640;
const H = 260;
const M = { haut: 16, droite: 16, bas: 44, gauche: 64 };
const LARG = L - M.gauche - M.droite;
const HAUT = H - M.haut - M.bas;

/** Sommet d'échelle robuste : le 90ᵉ centile × 1,25, jamais sous le seuil « mauvais ». */
export function sommetRobuste(valeurs: number[], seuilHaut?: number): number {
  const tries = [...valeurs].sort((a, b) => a - b);
  const max = tries[tries.length - 1] ?? 0;
  const p90 = tries[Math.min(tries.length - 1, Math.floor(0.9 * (tries.length - 1)))] ?? 0;
  const robuste = Math.max(p90 * 1.25, seuilHaut ? seuilHaut * 1.1 : 0);
  return max > robuste * 1.5 ? robuste : Math.max(max, seuilHaut ? seuilHaut * 1.05 : 0);
}

/** Un pas « rond » (1, 2, 2,5 ou 5 × 10ⁿ) qui découpe [0, max] en ~4 graduations. */
export function pasRond(max: number): number {
  if (!(max > 0)) return 1;
  const brut = max / 4;
  const p = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= brut) ?? 10 * p;
}

function heure(iso: string, jours: boolean): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU_AFFICHAGE,
    ...(jours ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function GrapheMesure({
  valeurs,
  debuts,
  format,
  titreY,
  titreX = "heure de Paris",
  seuils,
}: {
  valeurs: (number | null)[];
  /** Début ISO de chaque tranche, aligné sur `valeurs`. */
  debuts: string[];
  format: FormatId;
  /** Grandeur et unité de l'axe vertical : « LCP au 75ᵉ centile (ms) ». */
  titreY: string;
  titreX?: string;
  /** Seuils [bon, mauvais] (web.dev), tracés en pointillé. */
  seuils?: [number, number];
}) {
  const n = Math.min(valeurs.length, debuts.length);
  const mesurees = valeurs.slice(0, n).filter((v): v is number => v != null && Number.isFinite(v));
  if (n < 2 || mesurees.length < 2) {
    return <p className="py-8 text-center text-xs text-ink-soft">Moins de deux tranches mesurées : pas de courbe.</p>;
  }
  const maxDonnees = sommetRobuste(mesurees, seuils?.[1]);
  const pas = pasRond(maxDonnees);
  const sommet = Math.ceil(maxDonnees / pas) * pas || pas;
  const graduations = Array.from({ length: Math.round(sommet / pas) + 1 }, (_, i) => i * pas);
  const x = (i: number) => M.gauche + (n === 1 ? 0 : (i / (n - 1)) * LARG);
  const y = (v: number) => M.haut + HAUT - (Math.min(v, sommet) / sommet) * HAUT;

  // Segments continus : un trou coupe la ligne.
  const segments: string[] = [];
  let courant: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = valeurs[i];
    if (v == null || !Number.isFinite(v)) {
      if (courant.length > 1) segments.push(courant.join(" "));
      courant = [];
      continue;
    }
    courant.push(`${courant.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  }
  if (courant.length > 1) segments.push(courant.join(" "));

  const horsEchelle = mesurees.filter((v) => v > sommet);
  const plusieursJours = Date.parse(debuts[n - 1]) - Date.parse(debuts[0]) > 36 * 3_600_000;
  const reperesX = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1].filter(
    (v, i, t) => t.indexOf(v) === i,
  );

  return (
    <figure className="m-0">
    <svg viewBox={`0 0 ${L} ${H}`} className="h-auto w-full" role="img" aria-label={`${titreY} selon ${titreX}`}>
      {/* Graduations horizontales et valeurs de l'axe vertical */}
      {graduations.map((g) => (
        <g key={g}>
          <line x1={M.gauche} x2={L - M.droite} y1={y(g)} y2={y(g)} className="stroke-line" strokeWidth="1" />
          <text x={M.gauche - 8} y={y(g) + 3.5} textAnchor="end" className="fill-ink-soft text-[10px] tabular-nums">
            {formater(format, g)}
          </text>
        </g>
      ))}
      {/* Seuils web.dev */}
      {seuils?.map((s, i) =>
        s <= sommet ? (
          <g key={s}>
            <line
              x1={M.gauche}
              x2={L - M.droite}
              y1={y(s)}
              y2={y(s)}
              strokeDasharray="4 4"
              strokeWidth="1.2"
              className={i === 0 ? "stroke-good" : "stroke-bad"}
            />
            <text x={L - M.droite - 2} y={y(s) - 4} textAnchor="end" className={`text-[10px] ${i === 0 ? "fill-good-ink" : "fill-bad-ink"}`}>
              {i === 0 ? `bon ≤ ${formater(format, s)}` : `mauvais > ${formater(format, s)}`}
            </text>
          </g>
        ) : null,
      )}
      {/* Axes */}
      <line x1={M.gauche} x2={M.gauche} y1={M.haut} y2={M.haut + HAUT} className="stroke-ink-faint" strokeWidth="1" />
      <line x1={M.gauche} x2={L - M.droite} y1={M.haut + HAUT} y2={M.haut + HAUT} className="stroke-ink-faint" strokeWidth="1" />
      {reperesX.map((i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={M.haut + HAUT} y2={M.haut + HAUT + 4} className="stroke-ink-faint" />
          <text x={x(i)} y={M.haut + HAUT + 16} textAnchor="middle" className="fill-ink-soft text-[10px] tabular-nums">
            {heure(debuts[i], plusieursJours)}
          </text>
        </g>
      ))}
      {/* La série */}
      {segments.map((d) => (
        <path key={d} d={d} fill="none" className="stroke-perf" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {valeurs.slice(0, n).map((v, i) =>
        v == null || !Number.isFinite(v) ? null : v > sommet ? (
          <text key={i} x={x(i)} y={M.haut + 4} textAnchor="middle" className="fill-bad-ink text-[10px]">
            ▲
          </text>
        ) : (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.2" className="fill-perf" />
        ),
      )}
      {/* Titres des axes */}
      <text x={M.gauche + LARG / 2} y={H - 6} textAnchor="middle" className="fill-ink-soft text-[11px]">
        {titreX}
      </text>
      <text
        transform={`translate(14 ${M.haut + HAUT / 2}) rotate(-90)`}
        textAnchor="middle"
        className="fill-ink-soft text-[11px]"
      >
        {titreY}
      </text>
    </svg>
      {horsEchelle.length > 0 && (
        <figcaption className="mt-1 text-[11px] text-ink-soft">
          ▲ {horsEchelle.length} {horsEchelle.length > 1 ? "tranches" : "tranche"} au-dessus de l&apos;échelle (jusqu&apos;à{" "}
          {formater(format, Math.max(...horsEchelle))}), posée{horsEchelle.length > 1 ? "s" : ""} au sommet.
        </figcaption>
      )}
    </figure>
  );
}
