// Bandeau de santé de l'Overview : anneau de score + facteurs dominants + badge
// anomalies. Rendu 100 % serveur (aucune interactivité). Extrait de app/page.tsx.
//
// VARIANTE `compact` (F11, plan § 4.1, § 5.1.1). Sur la Vue d'ensemble, la santé
// partage sa rangée avec les tuiles de trafic : une seule ligne de facteurs, et le
// DÉTAIL de chaque facteur écrit sous sa barre — plus dans un `title`, qu'aucun
// écran tactile n'affiche. Un facteur sans donnée dit « n/a » (ou sa raison,
// « non testable ») et son détail reste visible : on sait pourquoi il manque.
// Chaque facteur mène à l'écran de sa mesure (vitals → Pages, erreurs → Erreurs,
// stabilité → Sessions, anomalies → leur table).
import Link from "next/link";
import { GlossaryTip } from "@/components/GlossaryTip";
import { dominantFactors, type Health, type HealthFactor, HEALTH_CLASS, type HealthLabel } from "@/lib/health-libelles";
import { RATING_HEX } from "@/lib/palette";

const RING_STROKE: Record<HealthLabel, string> = {
  Excellent: RATING_HEX.good,
  Bon: "rgb(var(--c-brand))", // bleu perf : bon, sans être le vert d'un seuil web.dev
  Dégradé: RATING_HEX["needs-improvement"],
  Critique: RATING_HEX.poor,
};

/** Formule du score, écrite sous l'anneau (le bandeau est « à formule affichée », § 1.8). */
export const FORMULE_SANTE = "40 % vitals (LCP x2) · 30 % erreurs navigateur · 20 % stabilité · 10 % anomalies 24 h.";

/**
 * Ligne fixe sous le score (§ 5.1.2). Le score mêle deux fenêtres, et sa composante
 * « stabilité » (part des sessions sans erreur) est SOUS-estimée quand
 * l'échantillonnage garde les sessions en erreur (CP15 : une session tirée hors
 * `sampleRate` n'entre dans la population que si elle porte une erreur).
 */
export const LIGNE_FIXE_SANTE =
  "Mêle la période choisie et des anomalies sur 24 h fixes. Sessions sans erreur : sous-estimées si l'échantillonnage garde les sessions en erreur.";

/** Anneau de score SVG (rendu serveur) — la pièce centrale du poste de pilotage. */
function HealthRing({ score, label, compact }: { score: number; label: HealthLabel; compact: boolean }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={`relative shrink-0 ${compact ? "h-20 w-20" : "h-28 w-28"}`}
      role="img"
      aria-label={`Score de santé ${score} sur 100, ${label}`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={RING_STROKE[label]}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span
          className={`${compact ? "text-2xl" : "text-3xl"} font-bold tabular-nums leading-none text-ink`}
          data-testid="health-score"
        >
          {score}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-ink-soft">/ 100</span>
      </div>
    </div>
  );
}

/** Ce que la jauge écrit à droite du libellé : les points, ou « n/a » (ou la raison). */
function texteFacteur(f: Pick<HealthFactor, "earned" | "max" | "raisonNull">): string {
  return f.earned == null ? (f.raisonNull ?? "n/a") : `${f.earned.toLocaleString("fr-FR")} / ${f.max}`;
}

/** Barre de contribution d'un facteur du score (earned/max). */
function FactorBar({ facteur, compact, href }: { facteur: HealthFactor; compact: boolean; href?: string }) {
  const { label, detail, earned, max } = facteur;
  const ratio = earned == null ? null : earned / max;
  // Une seule couleur, sans verdict (R-S) : les paliers 0,85 / 0,5 qui peignaient
  // ces barres en vert / ambre / rouge n'avaient aucune source. La longueur dit
  // la part des points gagnés ; le chiffre est écrit à côté.
  const color = ratio == null ? "bg-ink-faint/40" : "bg-perf";
  const contenu = (
    <>
      {/* Le libellé n'est JAMAIS tronqué (§ 4.1) : il passe à la ligne. À 390 px, un
          « Stabilité des sess… » coupé ne dit plus de quoi le facteur parle. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="min-w-0 break-words font-medium text-ink-soft" data-testid="facteur-libelle">
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-ink-soft" data-testid="facteur-points">
          {texteFacteur(facteur)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2" aria-hidden="true">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(ratio ?? 0) * 100}%` }} />
      </div>
      {compact && (
        <p className="mt-1 break-words text-[11px] leading-snug text-ink-soft" data-testid="facteur-detail">
          {detail}
        </p>
      )}
    </>
  );
  // `min-w-0` : un élément de grille ne descend pas sous le min-content de son
  // contenu sans lui. Le libellé d'un facteur élargissait donc la grille, puis le
  // bandeau, puis la page — de 6 px sur une fenêtre de 390.
  const classes = "block min-w-0";
  const testId = `facteur-${facteur.key}`;
  if (compact && href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        aria-label={`${label} : ${texteFacteur(facteur)}, ${detail}`}
        className={`${classes} rounded-md transition hover:bg-panel2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      >
        {contenu}
      </Link>
    );
  }
  return (
    <div title={compact ? undefined : detail} className={classes} data-testid={testId}>
      {contenu}
    </div>
  );
}

/** Composantes exclues parce que non testables (P*.1, 0-c) : dites en clair. */
function Exclusions({ health }: { health: Health }) {
  return (
    <>
      {health.factors
        .filter((x) => x.earned == null && x.raisonNull === "non testable")
        .map((x) => (
          <span key={x.key}>
            {" "}
            {x.label} : {x.detail} — composante exclue, le score se calcule sur les autres.
          </span>
        ))}
    </>
  );
}

/** Bandeau santé v0.3 : score composite + facteurs dominants + badge anomalies. */
export function HealthBanner({
  health,
  periodLabel,
  compact = false,
  liens = {},
}: {
  health: Health;
  periodLabel: string;
  /** Une ligne de facteurs, détail visible sous chaque barre (Vue d'ensemble, F11). */
  compact?: boolean;
  /** Écran de la mesure de chaque facteur (compact seulement) : `anomalies` → `#anomalies`. */
  liens?: Partial<Record<HealthFactor["key"], string>>;
}) {
  if (health.score == null || health.label == null) {
    return (
      <div className={`card ${compact ? "" : "mb-6"} min-w-0 p-4`} data-testid="sante">
        <span className="text-sm text-ink-soft" data-testid="sante-insuffisante">
          Santé : données insuffisantes sur la fenêtre ({periodLabel}) pour calculer un score.
        </span>
      </div>
    );
  }

  if (compact) {
    return (
      <section className="card flex min-w-0 flex-col gap-3 p-4" data-testid="sante" aria-labelledby="sante-titre">
        <div className="flex min-w-0 flex-wrap items-start gap-x-5 gap-y-3">
          <div className="flex shrink-0 items-center gap-3">
            <HealthRing score={health.score} label={health.label} compact />
            <div className="min-w-0">
              {/* La bulle OUVRE le libellé : posée après lui, elle sortait de l'écran à 390 px. */}
              <h2
                id="sante-titre"
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
              >
                <GlossaryTip id="health" />
                Santé ({periodLabel})
              </h2>
              <span
                className={`mt-1.5 inline-block rounded-full border px-3 py-0.5 text-sm font-semibold ${HEALTH_CLASS[health.label]}`}
                data-testid="health-label"
              >
                {health.label}
              </span>
              {health.anomalies.length > 0 && (
                <a
                  href="#anomalies"
                  className="mt-1.5 block w-fit rounded-full border border-bad/30 bg-bad/10 px-2.5 py-0.5 text-xs font-semibold text-bad-ink transition hover:bg-bad/20"
                  data-testid="anomaly-badge"
                >
                  {health.anomalies.length} anomalie(s) détectée(s)
                </a>
              )}
            </div>
          </div>
          {/* `basis-full` sous sm : avec `flex-1` seul (base 0), la grille restait sur la
              ligne de l'anneau, large de ~70 px à 390 px.
              LARGEUR DES FACTEURS : le nombre de colonnes suit le CONTENEUR, pas la
              fenêtre. `xl:grid-cols-4` comptait la fenêtre (1280 px) alors que le
              bandeau compact n'occupe que 5 colonnes sur 12 de la rangée : à 1440 px la
              grille recevait ~150 px pour quatre facteurs, soit des colonnes de ~26 px
              où « Stabilité des sessions » se coupait lettre par lettre. `auto-fit` avec
              un plancher de 9 rem lit la place RÉELLEMENT disponible ; `sm:min-w-[19rem]`
              (deux colonnes + leur gouttière) fait passer la grille SOUS l'anneau quand
              la ligne ne peut pas en loger deux, au lieu de l'y écraser. Le plancher
              n'est posé qu'à partir de `sm` : sous 390 px la carte est plus étroite que
              19 rem, et il la ferait déborder. */}
          <div className="grid min-w-0 flex-1 basis-full grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3 sm:basis-0 sm:min-w-[19rem]">
            {health.factors.map((x) => (
              <FactorBar key={x.key} facteur={x} compact href={liens[x.key]} />
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-soft" data-testid="sante-formule">
          {FORMULE_SANTE} {LIGNE_FIXE_SANTE}
          <Exclusions health={health} />
        </p>
      </section>
    );
  }

  const dominant = dominantFactors(health);
  return (
    <div className="card mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 p-5" data-testid="sante">
      <div className="flex items-center gap-5">
        <HealthRing score={health.score} label={health.label} compact={false} />
        <div>
          {/* La bulle OUVRE le libellé : posée après lui, à droite de l'anneau,
              sa bulle de 288 px centrée sortait de l'écran et portait la page à
              415 px sur une fenêtre de 390. En tête, elle s'ouvre toujours vers
              l'intérieur. */}
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <GlossaryTip id="health" />
            Santé ({periodLabel})
          </div>
          <span
            className={`mt-1.5 inline-block rounded-full border px-3 py-1 text-sm font-semibold ${HEALTH_CLASS[health.label]}`}
            data-testid="health-label"
          >
            {health.label}
          </span>
          {health.anomalies.length > 0 && (
            <a
              href="#anomalies"
              className="mt-2 block w-fit rounded-full border border-bad/30 bg-bad/10 px-2.5 py-0.5 text-xs font-semibold text-bad-ink transition hover:bg-bad/20"
              data-testid="anomaly-badge"
            >
              {health.anomalies.length} anomalie(s) détectée(s)
            </a>
          )}
        </div>
      </div>
      {/* `basis-full` sous sm : avec `flex-1` seul (base 0), la grille restait sur la
          ligne de l'anneau et se retrouvait large de ~70 px à 390 px — libellés
          tronqués à une lettre, et « non testable » qui débordait de la page. */}
      <div className="grid min-w-0 flex-1 basis-full grid-cols-1 gap-x-6 gap-y-3 sm:basis-0 sm:grid-cols-2">
        {health.factors.map((x) => (
          <FactorBar key={x.key} facteur={x} compact={false} />
        ))}
      </div>
      <div className="w-full text-xs text-ink-faint">
        {FORMULE_SANTE}
        <Exclusions health={health} />
        {dominant.length > 0 && (
          <>
            {" "}
            Points perdus :{" "}
            {dominant
              .map((d) => `${d.label} −${(d.max - (d.earned ?? 0)).toLocaleString("fr-FR")} pt (${d.detail})`)
              .join(" · ")}
          </>
        )}
      </div>
    </div>
  );
}
