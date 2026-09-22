import Link from "next/link";
import { fmtVital } from "@/lib/format";
import { GLOSSARY, type GlossaryId } from "@/lib/glossary";
import { RATING_BAR, RATING_CLASS, RATING_LABEL, THRESHOLDS, texteSeuils } from "@/lib/rating";
import type { Ecart, IntervalleP75 } from "@/lib/stats/incertitude";
import { echelleJauge, lireVital, type LectureVital } from "@/lib/vital-lecture";
import { Sparkline } from "./charts/Sparkline";
import { DeltaBadge } from "./SupervisionHero";
import { GlossaryTip } from "./GlossaryTip";

/**
 * Tendance vs période précédente : pour un vital, monter = se dégrader. Même badge
 * que les tuiles (P4) : la référence est ÉCRITE à côté de l'écart, pas seulement
 * dans un `title`. `data-testid="trend"` reste sur l'enveloppe pour les e2e.
 */
function Trend({ p75, prev, ecart }: { p75: number; prev: number | null; ecart?: Ecart | null }) {
  if (prev == null || prev === 0 || !Number.isFinite(prev)) return null;
  // P*.1 : deux p75 dont les intervalles se chevauchent n'établissent pas d'écart.
  // Le delta observé reste écrit, sans flèche ni couleur, avec sa règle et
  // l'intervalle précédent — sur sa propre ligne, sous la valeur : dans la
  // rangée du chiffre, la phrase déborderait d'une carte à deux colonnes (390 px).
  if (ecart && !ecart.etabli) {
    const pct = Math.round(((p75 - prev) / prev) * 100);
    return (
      <div data-testid="trend" data-etabli="non" className="mt-1 break-words text-xs text-ink-soft">
        {pct > 0 ? "+" : ""}
        {pct} % vs période précédente — {ecart.regle}
      </div>
    );
  }
  return (
    <span data-testid="trend">
      <DeltaBadge pct={((p75 - prev) / prev) * 100} reference="période précédente" sensMeilleur="bas" />
    </span>
  );
}

/**
 * Jauge des seuils web.dev : zones good/à améliorer/poor en filigrane, curseur
 * positionné au p75 — lecture de l'état en un coup d'œil (dashboard dense). La
 * moustache de l'intervalle à 95 % double le texte écrit sous la valeur ; elle
 * ne le remplace pas.
 *
 * Son alternative textuelle (F03) : la jauge est une image, et son `aria-label`
 * dit ce qu'elle dessine — la valeur, les seuils lus dans `THRESHOLDS`, et
 * l'intervalle quand il y en a un. Un lecteur d'écran n'avait que le `title` du
 * curseur, qui ne s'annonce pas.
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
  const alternative = [
    `Jauge des seuils : p75 ${fmtVital(name, p75)}`,
    texteSeuils(name),
    lecture.texteIntervalle && lecture.moustache ? `intervalle ${lecture.texteIntervalle}` : null,
    p75 > max ? "au-delà de l'échelle" : null,
  ]
    .filter(Boolean)
    .join(" ; ");
  return (
    <div
      className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full"
      data-testid={`meter-${name}`}
      role="img"
      aria-label={alternative}
    >
      <div className="absolute inset-y-0 left-0 bg-good/25" style={{ width: `${(good / max) * 100}%` }} />
      <div
        className="absolute inset-y-0 bg-warn/25"
        style={{ left: `${(good / max) * 100}%`, width: `${((warn - good) / max) * 100}%` }}
      />
      <div className="absolute inset-y-0 bg-bad/25" style={{ left: `${(warn / max) * 100}%`, right: 0 }} />
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
  periodLabel,
  intervalle,
  ecart,
  serie,
  href,
}: {
  name: string;
  p75: number | null;
  median?: number | null;
  n: number;
  prev?: number | null;
  /**
   * La fenêtre lue, écrite sous la valeur. OBLIGATOIRE (F03) : le défaut « 24 h »
   * s'affichait sous une plage de 7 jours dès qu'un appelant l'oubliait.
   */
  periodLabel: string;
  /** Intervalle à 95 % de la p75 (P*.1), ou pourquoi il n'est pas calculé. */
  intervalle?: IntervalleP75;
  /** L'écart à `prev` est-il établi (P*.1, `ecartP75`) ? Non établi : ni flèche ni couleur. */
  ecart?: Ecart | null;
  /** Sparkline de la p75 par seau, déjà alignée sur la grille (`null` = trou). */
  serie?: (number | null)[];
  /** La carte entière devient un lien (un seul arrêt de tabulation). */
  href?: string;
}) {
  const lecture = lireVital(name, p75, n, intervalle);
  const verdict = lecture.verdict;
  const ecartOuvert = ecart != null && !ecart.etabli;
  const lowSample = n > 0 && n < LOW_SAMPLE;
  const contenu = (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* La bulle OUVRE le nom : sur deux colonnes à 390 px, une bulle de
            288 px centrée après le nom de la carte de droite sortait de l'écran
            et élargissait la page. En tête, elle s'ouvre vers l'intérieur.
            Dans une carte-lien, pas de bulle : un bouton dans un lien ferait deux
            arrêts de tabulation et un HTML invalide. */}
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {!href && name in GLOSSARY && <GlossaryTip id={name as GlossaryId} />}
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
        {p75 != null && !ecartOuvert && <Trend p75={p75} prev={prev} />}
      </div>
      {p75 != null && <ThresholdMeter name={name} p75={p75} lecture={lecture} />}
      {lecture.texteIntervalle && (
        <div className="mt-2 flex items-start gap-1 text-xs text-ink-soft" data-testid={`intervalle-${name}`}>
          {!href && <GlossaryTip id="intervalle" />}
          <span>
            {lecture.texteIntervalle}
            {verdict?.kind === "incertain" && (
              <> · entre {RATING_LABEL[verdict.de]} et {RATING_LABEL[verdict.a]}</>
            )}
          </span>
        </div>
      )}
      {p75 != null && ecartOuvert && <Trend p75={p75} prev={prev} ecart={ecart} />}
      <div className="mt-1 text-xs text-ink-faint">
        p75 · {n} mesures · {periodLabel}
      </div>
      {lowSample && (
        <div
          className="mt-1 text-[11px] text-warn-ink"
          title="Sur peu de mesures, le p75 est instable (il tombe dans la queue de distribution). La médiane est plus robuste."
        >
          échantillon faible{median != null && <> · médiane {fmtVital(name, median)}</>}
        </div>
      )}
      {serie && serie.length > 0 && (
        <div className="mt-2">
          <Sparkline
            valeurs={serie}
            label={`${name} p75, évolution sur ${serie.length} seaux, ${periodLabel}`}
            seuils={THRESHOLDS[name]}
          />
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={lecture.ariaLabel}
        className="card block p-4 transition hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
      >
        {contenu}
      </Link>
    );
  }
  return (
    <div className="card p-4 transition hover:shadow-pop" aria-label={lecture.ariaLabel}>
      {contenu}
    </div>
  );
}
