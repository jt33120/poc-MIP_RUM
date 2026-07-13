import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Donut } from "@/components/charts/Donut";
import { browserFromUA, fmtDate } from "@/lib/format";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { listSessions, visitStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Sessions({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [rows, vs] = await Promise.all([listSessions(f), visitStats(f)]);
  const reprises = Math.max(vs.visits - vs.sessions, 0);
  const identified = vs.new_count + vs.returning_count;
  const returningPct = identified ? Math.round((vs.returning_count / identified) * 100) : 0;
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  ).toString();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Sessions"
        sub={
          <>
            Parcours utilisateurs réels sur {PERIODS[f.period].label}, anonymisés (user_hash, aucune PII) —
            ouvre une session pour sa timeline pas à pas
          </>
        }
      />

      {/* Hero : répartition nouveaux vs revenants (visitStats, exact sur la
          fenêtre — contrairement à la liste des 50 sessions ci-dessous). */}
      <SupervisionHero
        chartTitle="Nouveaux vs revenants"
        chart={
          identified > 0 ? (
            <Donut
              slices={[
                { label: "Nouveaux", value: vs.new_count, color: "#f89101" },
                { label: "Revenants", value: vs.returning_count, color: "#2563eb" },
              ]}
              centerValue={identified.toLocaleString("fr-FR")}
              centerLabel="identifiés"
            />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">
              Pas encore d&apos;utilisateurs identifiés sur {PERIODS[f.period].label}.
            </p>
          )
        }
      >
        <HeroStat label="Sessions actives" value={vs.sessions.toLocaleString("fr-FR")} hint="≥ 1 page vue" />
        <HeroStat
          label="Visites"
          value={vs.visits.toLocaleString("fr-FR")}
          hint={reprises > 0 ? `dont ${reprises.toLocaleString("fr-FR")} reprise(s) après 30 min` : "aucune reprise"}
        />
        <HeroStat
          label="Part de revenants"
          value={identified ? `${returningPct} %` : "—"}
          hint={`${vs.returning_count.toLocaleString("fr-FR")} revenants · ${vs.new_count.toLocaleString("fr-FR")} nouveaux`}
        />
        <HeroReading>
          L&apos;anneau distingue les utilisateurs vus pour la première fois de ceux qui reviennent (fidélité).
          Une session = un parcours ; une visite = un passage (reprise après 30 min d&apos;inactivité = nouvelle
          visite). Détail des parcours ci-dessous.
        </HeroReading>
      </SupervisionHero>

      <div className="flex flex-col gap-3">
        {rows.map((s) => (
          <div key={s.session_id} className="card p-4 transition hover:shadow-pop">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                href={`/sessions/${s.session_id}${qs ? `?${qs}` : ""}`}
                className="font-mono text-xs font-semibold text-brand hover:underline"
                data-testid="session-link"
              >
                {s.session_id.slice(0, 8)}…
              </Link>
              <Badge>{s.device_type ?? "?"}</Badge>
              <Badge>{browserFromUA(s.user_agent)}</Badge>
              {s.geo_country && <Badge>{s.geo_country}</Badge>}
              <span className="text-ink-soft">{s.page_count} page(s)</span>
              {s.err_count > 0 && (
                <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                  {s.err_count} erreur(s)
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums text-ink-faint">
                {fmtDate(s.started_at)} → {fmtDate(s.last_seen_at)}
              </span>
            </div>
            {/* parcours utilisateur : la lecture « analytics produit » de la session */}
            {s.routes?.length ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1 font-mono text-xs text-ink-soft">
                {s.routes.map((r, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-accent/70">→</span>}
                    <span className="chip-mono">{r}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {!rows.length && (
          <p className="py-8 text-center text-ink-faint">Aucune session sur {PERIODS[f.period].label}</p>
        )}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-xs text-ink-soft">
      {children}
    </span>
  );
}

