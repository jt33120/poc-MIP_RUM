// Valeur d'un Web Vital, colorée au barème 2026. « — » quand la mesure manque :
// un p75 sans échantillon est une ABSENCE de mesure, jamais un zéro.
import { fmtVital } from "@/lib/format";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export function VitalPill({ name, value }: { name: string; value: number | null }) {
  if (value == null) return <span className="text-ink-faint/60">—</span>;
  const rating = rating2026(name, Number(value));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital(name, Number(value))}
    </span>
  );
}

/** La même valeur en texte, pour une alternative textuelle ou une infobulle. */
export function vitalText(name: string, value: number | null): string {
  return value == null ? "pas de mesure" : fmtVital(name, Number(value));
}
