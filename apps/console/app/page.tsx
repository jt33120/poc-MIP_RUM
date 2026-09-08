import Link from "next/link";
import { HealthHeatmap, type HeatCell, dayKey, lastNDayKeys } from "@/components/charts/HealthHeatmap";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { GlossaryTip } from "@/components/GlossaryTip";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { cookies } from "next/headers";
import { COOKIE_BLOCS, lireChoix } from "@/lib/dashboard-blocs";
import { BriefingCard } from "@/components/BriefingCard";
import { VitalCard } from "@/components/VitalCard";
import { HealthBanner } from "@/components/health/HealthBanner";
import { AnomalyTable } from "@/components/health/AnomalyTable";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { healthScore } from "@/lib/health";
import { overviewStats, vitalSeries, vitalsP75 } from "@/lib/queries";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const period = PERIODS[f.period];

  // toggle « heures ouvrées » de la heatmap, porté par l'URL (?hours=business),
  // en préservant les autres filtres (app/période/device)
  const businessHours = sp.hours === "business";
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") baseParams.set(k, v);
  const hrefWith = (val: string | null) => {
    const p = new URLSearchParams(baseParams);
    if (val) p.set("hours", val);
    else p.delete("hours");
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

  // Le choix des blocs est lu ICI, AVANT les requêtes : un bloc éteint ne coûte
  // rien. Masquer en CSS aurait laissé tout le travail serveur en place, ce qui
  // vide la fonctionnalité de son intérêt sur un écran qui porte neuf requêtes.
  //
  // `overviewStats(f)` reste inconditionnel : le bandeau « pas encore de
  // données » en dépend, et il doit s'afficher même sur un tableau de bord
  // réduit au minimum — c'est justement là qu'on a besoin de savoir pourquoi
  // l'écran est vide.
  const blocs = lireChoix((await cookies()).get(COOKIE_BLOCS)?.value);
  const vide = <T,>(v: T) => Promise.resolve(v);

  const [vitals, vitalsPrev, stats, statsPrev, series, health, grid, traffic, dailyLcp] =
    await Promise.all([
      blocs.vitals || blocs.reseau ? vitalsP75(f) : vide([]),
      blocs.vitals ? vitalsP75(f, true) : vide([]),
      overviewStats(f),
      overviewStats(f, true),
      blocs.hero ? vitalSeries(f, "LCP") : vide([]),
      blocs.sante || blocs.anomalies ? healthScore(f) : vide(null),
      blocs.historique ? healthGrid(f) : vide([]),
      blocs.historique ? dailyTraffic(f) : vide([]),
      blocs.historique ? dailyLcpSeries(f) : vide([]),
    ]);

  const byName = Object.fromEntries(vitals.map((v) => [v.name, v]));
  const prevByName = Object.fromEntries(vitalsPrev.map((v) => [v.name, v]));
  const errorRate = stats.pageviews ? ((stats.errors / stats.pageviews) * 100).toFixed(1) : "0";
  const prevErrorRate = statsPrev.pageviews ? (statsPrev.errors / statsPrev.pageviews) * 100 : null;
  const pctOf = (cur: number, prev: number | null | undefined) =>
    prev != null && prev !== 0 ? { pct: ((cur - prev) / prev) * 100 } : null;

  // heatmap 14 j : axe des jours + index `${jour}|${heure}` des créneaux
  const gridDays = lastNDayKeys(GRID_DAYS);
  const gridByKey = new Map<string, HeatCell>(
    grid.map((c) => [`${dayKey(c.day)}|${c.hour}`, { good_w: c.good_w, total_w: c.total_w }]),
  );
  const gridHasData = grid.length > 0;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Vue d'ensemble" help="rum" />

      {f.app && stats.sessions === 0 && (
        <div
          data-testid="onboarding-nudge"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm"
        >
          <span className="text-ink">
            <strong>Cette application n&apos;a pas encore reçu de données.</strong> Posez le capteur RUM
            sur votre site, puis simulez un parcours — les mesures apparaîtront ici.
          </span>
          <Link href={`/select/new?app=${encodeURIComponent(f.app)}`} className="btn-accent ml-auto shrink-0 px-3 py-1.5">
            Guide d&apos;intégration →
          </Link>
        </div>
      )}

      {blocs.briefing && f.app && stats.sessions > 0 && <BriefingCard app={f.app} />}

      {/* Vue « Tous » : synthèse LLM d'état du PORTAIL (toutes apps), depuis la
          dernière connexion. Affichée même sans trafic — c'est là qu'elle dit
          honnêtement « pas assez de données pour conclure ». */}
      {blocs.briefing && !f.app && <BriefingCard />}

      {blocs.sante && health && <HealthBanner health={health} periodLabel={period.label} />}

      {blocs.vitals && (
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => (
          <VitalCard
            key={name}
            name={name}
            p75={byName[name]?.p75 ?? null}
            median={byName[name]?.p50 ?? null}
            n={byName[name]?.n ?? 0}
            prev={prevByName[name]?.p75 ?? null}
            periodLabel={period.label}
          />
        ))}
      </div>
      )}

      {blocs.reseau && <PhasesReseau vitals={byName} periodLabel={period.label} />}

      {blocs.hero && (
      <SupervisionHero
        chartTitle={`LCP p75 dans le temps (buckets ${period.bucketLabel})`}
        chart={
          series.length ? (
            <VitalsTimeseries
              data={series.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))}
              thresholds={THRESHOLDS.LCP}
            />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">
              Pas de données sur la fenêtre — élargis la période ou ouvre la démo.
            </p>
          )
        }
      >
        <HeroStat
          label={`Sessions · ${period.label}`}
          value={stats.sessions.toLocaleString("fr-FR")}
          delta={pctOf(stats.sessions, statsPrev.sessions)}
        />
        <HeroStat
          label="Pages vues"
          value={stats.pageviews.toLocaleString("fr-FR")}
          delta={pctOf(stats.pageviews, statsPrev.pageviews)}
        />
        <HeroStat
          label="Taux d'erreur JS / page vue"
          value={`${errorRate} %`}
          delta={prevErrorRate != null ? { pct: (Number(errorRate) - prevErrorRate) / (prevErrorRate || 1) * 100, lowerIsBetter: true } : null}
          tone={Number(errorRate) > 2 ? "poor" : Number(errorRate) > 1 ? "warn" : "good"}
        />
        <HeroReading>
          Courbe = LCP p75 dans le temps face aux seuils 2026 (bande verte «&nbsp;bon&nbsp;» sous 2,0&nbsp;s,
          rouge «&nbsp;mauvais&nbsp;» au-delà). Les tuiles comparent le volume et la fiabilité à la période
          précédente. Détail vital par vital ci-dessous, historique 14&nbsp;jours plus bas.
        </HeroReading>
      </SupervisionHero>
      )}

      {/* Historique de santé 14 j (fenêtre fixe, comme les anomalies) :
          heatmap jour × heure + courbes de volume et de p75 LCP associées. */}
      <section className="card mt-6 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Historique de santé — {GRID_DAYS} derniers jours
            <GlossaryTip id="healthGrid" />
          </h2>
          {/* filtre heures ouvrées (Lun–Ven, 8h–19h) — ne montre que les créneaux à trafic attendu */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
            <Link
              href={hrefWith(null)}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                !businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              24 h/24
            </Link>
            <Link
              href={hrefWith("business")}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              Heures ouvrées
            </Link>
          </div>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Fenêtre fixe (indépendante du filtre période) · une case = une heure, sa couleur = la part de
          mesures « good ».{" "}
          {businessHours
            ? "Vue Lun–Ven, 8h–19h."
            : "Une case vide = aucune page vue ce créneau (le RUM n'enregistre que le trafic réel) — les nuits/week-ends creux sont normaux."}
        </p>
        {gridHasData ? (
          <HealthHeatmap dayKeys={gridDays} byKey={gridByKey} businessOnly={businessHours} />
        ) : (
          <p className="py-10 text-center text-sm text-ink-faint">
            Pas assez de données sur 14 jours — la heatmap se remplit au fil des mesures.
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Volume & fiabilité par jour
            </h3>
            {traffic.length ? (
              <TrafficTimeseries data={traffic.map((t) => ({ ...t, day: String(t.day) }))} />
            ) : (
              <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              p75 LCP par jour
            </h3>
            {dailyLcp.length ? (
              <VitalsTimeseries
                data={dailyLcp.map((s) => ({ bucket: String(s.bucket), p75: Number(s.p75) }))}
                thresholds={THRESHOLDS.LCP}
                xAxis="day"
              />
            ) : (
              <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
            )}
          </div>
        </div>
      </section>

      {blocs.anomalies && health && <AnomalyTable health={health} />}
    </div>
  );
}

/** Les phases réseau qui composent le TTFB, dans l'ordre chronologique. Libellés
 *  français à l'affichage, noms bruts pour la lecture des données. */
const PHASES: { cle: string; label: string }[] = [
  { cle: "REDIRECT", label: "Redirection" },
  { cle: "DNS", label: "DNS" },
  { cle: "TCP", label: "Connexion" },
  { cle: "TLS", label: "TLS" },
  { cle: "REQUEST", label: "Requête" },
  { cle: "RESPONSE", label: "Réponse" },
];

/**
 * Décomposition du TTFB. Sans elle, la vue d'ensemble donnait le SYMPTÔME — « la
 * première donnée arrive en 900 ms » — sans jamais la cause : un DNS lent, une
 * poignée de main TLS coûteuse et un serveur lent produisent le même TTFB et
 * appellent trois corrections opposées.
 *
 * Aucune requête supplémentaire : `vitalsP75` groupe sur `m.name` sans filtrer,
 * ces lignes étaient déjà dans le résultat, simplement jamais lues.
 *
 * Rendu seulement si au moins une phase a des mesures — un parc qui tourne encore
 * sur une version antérieure du capteur n'en émet pas, et six cartes vides
 * feraient croire à une panne.
 */
function PhasesReseau({
  vitals,
  periodLabel,
}: {
  vitals: Record<string, { p75: number | null; p50: number | null; n: number } | undefined>;
  periodLabel: string;
}) {
  // La redirection vaut 0 sur l'immense majorité des navigations : lui donner une
  // carte permanente gâcherait une place pour n'afficher que des zéros.
  const visibles = PHASES.filter(
    (p) => (vitals[p.cle]?.n ?? 0) > 0 && (p.cle !== "REDIRECT" || (vitals[p.cle]?.p75 ?? 0) > 0),
  );
  if (visibles.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        D&apos;où vient le TTFB — décomposition réseau
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {visibles.map((p) => (
          <VitalCard
            key={p.cle}
            name={p.label}
            p75={vitals[p.cle]?.p75 ?? null}
            median={vitals[p.cle]?.p50 ?? null}
            n={vitals[p.cle]?.n ?? 0}
            periodLabel={periodLabel}
          />
        ))}
      </div>
    </section>
  );
}
