import { fmtVital } from "@/lib/format";
import { GLOSSARY, type GlossaryId } from "@/lib/glossary";
import { RATING_BAR, RATING_CLASS, RATING_LABEL, THRESHOLDS } from "@/lib/rating";
import type { IntervalleP75 } from "@/lib/stats/incertitude";
import { echelleJauge, lireVital, type LectureVital } from "@/lib/vital-lecture";
import { GlossaryTip } from "./GlossaryTip";

/** Tendance vs période précédente : pour un vital, monter = se dégrader. */
function Trend({ p75, prev }: { p75: number; prev: number | null }) {
  if (prev == null || prev === 0) return null;
  const delta = ((p75 - prev) / prev) * 100;
  const flat = Math.abs(delta) < 2;
  const cls = flat
    ? "text-ink-faint"
    : delta > 0
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";
  const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-semibold tabular-nums ${cls}`} data-testid="trend" title="vs période précédente">
      {arrow} {delta > 0 ? "+" : ""}
      {delta.toFixed(0)} %
    </span>
  );
}

/**
 * Jauge des seuils web.dev : zones good/à améliorer/poor en filigrane, curseur
 * positionné au p75 — lecture de l'état en un coup d'œil (dashboard dense). La
 * moustache de l'intervalle à 95 % double le texte écrit sous la valeur ; elle
 * ne le remplace pas.
 */
function ThresholdMeter({ name, p75, lecture }: { name: string; p75: number; lecture: LectureVital }) {
  const t = THRESHOLDS[name];
  const max = echelleJauge(name);
  if (!t || max == null) return null;
  const [good, warn] = t;
  const pos = Math.min(p75 / max, 1) * 100;
  // Le curseur ne prend la couleur du verdict que si le verdict tient.
  const couleur = lecture.verdict?.kind === "etabli" ? RATING_BAR[lecture.verdict.rating] : "bg-ink";
  const m = lecture.moustache;
  return (
    <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full" data-testid={`meter-${name}`}>
      <div className="absolute inset-y-0 left-0 bg-emerald-500/25" style={{ width: `${(good / max) * 100}%` }} />
      <div
        className="absolute inset-y-0 bg-amber-500/25"
        style={{ left: `${(good / max) * 100}%`, width: `${((warn - good) / max) * 100}%` }}
      />
      <div className="absolute inset-y-0 bg-red-500/25" style={{ left: `${(warn / max) * 100}%`, right: 0 }} />
      {m && (
        <div
          className="absolute inset-y-[1px] rounded-full border-x-2 border-ink/70 bg-ink/25"
          style={{ left: `${m.basPct}%`, width: `${Math.max(m.hautPct - m.basPct, 0.5)}%` }}
          data-testid={`moustache-${name}`}
          aria-hidden="true"
        />
      )}
      <div
        className={`absolute inset-y-0 w-1 -translate-x-1/2 rounded-full ${couleur}`}
        style={{ left: `${pos}%` }}
        title={`p75 vs seuils (bon ≤ ${fmtVital(name, good)} · mauvais > ${fmtVital(name, warn)})`}
      />
    </div>
  );
}

// En-dessous de ce nombre de mesures, la ligne est « échantillon faible » (règle P3
// du plan) ; l'intervalle, lui, dit de combien la p75 peut bouger.
const LOW_SAMPLE = 30;

export function VitalCard({
  name,
  p75,
  median = null,
  n,
  prev = null,
  periodLabel = "24 h",
  intervalle,
}: {
  name: string;
  p75: number | null;
  median?: number | null;
  n: number;
  prev?: number | null;
  periodLabel?: string;
  /** Intervalle à 95 % de la p75 (P*.1), ou pourquoi il n'est pas calculé. */
  intervalle?: IntervalleP75;
}) {
  const lecture = lireVital(name, p75, n, intervalle);
  const verdict = lecture.verdict;
  const lowSample = n > 0 && n < LOW_SAMPLE;
  return (
    <div className="card p-4 transition hover:shadow-pop" aria-label={lecture.ariaLabel}>
      <div className="flex items-center justify-between gap-2">
        {/* La bulle OUVRE le nom : sur deux colonnes à 390 px, une bulle de
            288 px centrée après le nom de la carte de droite sortait de l'écran
            et élargissait la page. En tête, elle s'ouvre vers l'intérieur. */}
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {name in GLOSSARY && <GlossaryTip id={name as GlossaryId} />}
          {name}
        </span>
        {verdict?.kind === "etabli" && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[verdict.rating]}`}>
            {RATING_LABEL[verdict.rating]}
          </span>
        )}
        {verdict && verdict.kind !== "etabli" && (
          // Badge neutre : un verdict qui ne tient pas sur tout l'intervalle n'a pas de couleur.
          <span
            className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-[11px] font-medium text-ink-soft"
            data-testid={`verdict-${name}`}
          >
            {verdict.kind === "incertain" ? "Incertain" : "Non établi"}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-ink" data-testid={`p75-${name}`}>
          {fmtVital(name, p75)}
        </span>
        {p75 != null && <Trend p75={p75} prev={prev} />}
      </div>
      {p75 != null && <ThresholdMeter name={name} p75={p75} lecture={lecture} />}
      {lecture.texteIntervalle && (
        <div className="mt-2 flex items-start gap-1 text-xs text-ink-soft" data-testid={`intervalle-${name}`}>
          <GlossaryTip id="intervalle" />
          <span>
            {lecture.texteIntervalle}
            {verdict?.kind === "incertain" && (
              <> · entre {RATING_LABEL[verdict.de]} et {RATING_LABEL[verdict.a]}</>
            )}
          </span>
        </div>
      )}
      <div className="mt-1 text-xs text-ink-faint">
        p75 · {n} mesures · {periodLabel}
      </div>
      {lowSample && (
        <div
          className="mt-1 text-[11px] text-amber-600 dark:text-amber-400"
          title="Sur peu de mesures, le p75 est instable (il tombe dans la queue de distribution). La médiane est plus robuste."
        >
          échantillon faible{median != null && <> · médiane {fmtVital(name, median)}</>}
        </div>
      )}
    </div>
  );
}
