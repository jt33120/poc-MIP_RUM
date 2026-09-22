import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { fieldReport, formReport } from "@/lib/form-analytics";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import type { SearchParams } from "@/lib/filters";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { PERIODS } from "@/lib/filters";
import { formEvents } from "@/lib/queries-form-analytics";
import { samplingSessionsHistorique } from "@/lib/queries-sessions";

export const dynamic = "force-dynamic";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pctFmt = (v: number) => `${Math.round(v * 100)} %`;

export default async function Forms({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/forms");
  if (!ecran.ok) return <FilterProblemNotice title="Formulaires" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = PERIODS[f.period];
  // S7 : sessions des événements `form.*` lus (une session « biaisée-erreurs »
  // n'émet que ses erreurs : ses formulaires ne sont jamais lus).
  const [events, echantillonnage] = await Promise.all([
    formEvents(f),
    lire(() => samplingSessionsHistorique(f, { lecture: "formulaires" })),
  ]);
  const forms = formReport(events);
  const selected = typeof sp.form === "string" && sp.form ? sp.form : forms[0]?.form;
  const fields = selected ? fieldReport(events, selected) : [];

  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "form" ? [[k, v] as [string, string]] : [])),
  );
  const formHref = (name: string) => {
    const p = new URLSearchParams(qs);
    p.set("form", name);
    return `/forms?${p.toString()}`;
  };

  const totalStarters = forms.reduce((a, r) => a + r.starters, 0);
  const totalSubmits = forms.reduce((a, r) => a + r.submits, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Formulaires"
        sub="Analyse des formulaires au niveau du champ — conversion, abandon et temps par champ. Aucune valeur saisie n'est collectée."
      />

      <BandeauEchantillonnage lecture={echantillonnage} />

      {!forms.length ? (
        <div className="card p-8 text-center text-ink-faint">
          Aucun événement de formulaire sur {period.label}. Le SDK émet
          <code className="chip-mono mx-1">form.submit</code>/<code className="chip-mono mx-1">form.abandon</code>
          automatiquement (option <code className="chip-mono">forms</code>).
        </div>
      ) : (
        <>
          {(() => {
            // Hero : le champ qui fait fuir. dropoff = nb de fois où ce champ est
            // le dernier touché avant abandon (friction directe).
            const friction = [...fields].filter((c) => c.dropoff > 0).sort((a, b) => b.dropoff - a.dropoff).slice(0, 8);
            const worstField = friction[0];
            return (
              <SupervisionHero
                chartTitle={<>Friction par champ — <span className="font-mono normal-case text-ink">{selected}</span></>}
                chart={
                  friction.length ? (
                    <RankBar
                      data={friction.map((c) => ({
                        label: c.name,
                        value: c.dropoff,
                        color: "#dc2626",
                        sub: `${pctFmt(c.changedRate)} saisi · ${secs(c.avgTimeMs)}`,
                        title: `${c.name} — ${c.dropoff} abandon(s) sur ce champ`,
                      }))}
                      labelWidth="10rem"
                    />
                  ) : (
                    <p className="py-12 text-center text-sm text-ink-faint">
                      Aucun abandon localisé sur un champ pour «&nbsp;{selected}&nbsp;» — parcours fluide 🎉
                    </p>
                  )
                }
              >
                <HeroStat label="Formulaires entamés" value={totalStarters.toLocaleString("fr-FR")} hint="submits + abandons" />
                <HeroStat label="Soumissions" value={totalSubmits.toLocaleString("fr-FR")} hint="formulaires envoyés" />
                {/* Sans verdict coloré (S6, R-S) : aucun seuil publié n'existe pour une
                    conversion de formulaire ; les paliers « bon / à surveiller » d'avant
                    n'avaient pas de source. La valeur s'affiche, neutre. */}
                <HeroStat
                  label="Conversion globale"
                  value={totalStarters ? pctFmt(totalSubmits / totalStarters) : "—"}
                  hint="soumis / entamés"
                />
                <HeroReading>
                  Chaque barre = un champ, longueur = le nombre d&apos;abandons survenus juste après lui. La
                  barre la plus longue{worstField ? ` (« ${worstField.name} »)` : ""} est le point de friction
                  n°1 à simplifier. Choisis un autre formulaire dans le tableau pour changer de vue.
                </HeroReading>
              </SupervisionHero>
            );
          })()}

          <h2 className="mb-2 text-sm font-semibold text-ink">Par formulaire</h2>
          <div className="card mb-8 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Formulaire</th>
                  <th className="th">Entamés</th>
                  <th className="th">Soumis</th>
                  <th className="th">Abandons</th>
                  <th className="th">Conversion</th>
                  <th className="th">Temps moyen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {forms.map((r) => (
                  <tr
                    key={r.form}
                    className={`transition hover:bg-panel2/60 ${r.form === selected ? "bg-panel2/40" : ""}`}
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link href={formHref(r.form)} className="text-brand hover:underline">
                        {r.form}
                      </Link>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.starters}</td>
                    <td className="px-4 py-2 tabular-nums text-good-ink">{r.submits}</td>
                    <td className="px-4 py-2 tabular-nums text-bad-ink">{r.abandons}</td>
                    <td className="px-4 py-2 tabular-nums font-semibold">{pctFmt(r.conversion)}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">{secs(r.avgTimeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-ink">
                Champs — <span className="font-mono text-brand">{selected}</span>
              </h2>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-panel2">
                    <tr>
                      <th className="th">Champ</th>
                      <th className="th">Interactions</th>
                      <th className="th">Temps moyen</th>
                      <th className="th">Taux de saisie</th>
                      <th className="th">Abandons (dernier champ)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {fields.map((c) => (
                      <tr key={c.name} className="transition hover:bg-panel2/60">
                        <td className="px-4 py-2 font-mono text-xs">{c.name}</td>
                        <td className="px-4 py-2 tabular-nums text-ink-soft">{c.interactions}</td>
                        <td className="px-4 py-2 tabular-nums text-ink-soft">{secs(c.avgTimeMs)}</td>
                        <td className="px-4 py-2 tabular-nums text-ink-soft">{pctFmt(c.changedRate)}</td>
                        <td className="px-4 py-2">
                          {c.dropoff > 0 ? (
                            <span className="rounded border border-bad/30 bg-bad/10 px-1.5 py-0.5 text-xs font-medium tabular-nums text-bad-ink">
                              {c.dropoff}
                            </span>
                          ) : (
                            <span className="text-ink-faint/60">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!fields.length && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                          Aucun détail de champ pour ce formulaire
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

