import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { fieldReport, formReport } from "@/lib/form-analytics";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { formEvents } from "@/lib/queries-form-analytics";

export const dynamic = "force-dynamic";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pctFmt = (v: number) => `${Math.round(v * 100)} %`;

export default async function Forms({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const period = PERIODS[f.period];
  const events = await formEvents(f);
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
        sub={
          <>
            Analyse des formulaires au niveau du champ — conversion, abandon et temps par champ ·
            fenêtre {period.label}. Aucune valeur saisie n&apos;est collectée.
          </>
        }
      />

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
                <HeroStat label="Soumissions" value={totalSubmits.toLocaleString("fr-FR")} tone="good" hint="formulaires envoyés" />
                <HeroStat
                  label="Conversion globale"
                  value={totalStarters ? pctFmt(totalSubmits / totalStarters) : "—"}
                  tone={totalStarters ? (totalSubmits / totalStarters >= 0.6 ? "good" : totalSubmits / totalStarters >= 0.3 ? "warn" : "poor") : "neutral"}
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
                    <td className="px-4 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{r.submits}</td>
                    <td className="px-4 py-2 tabular-nums text-red-600 dark:text-red-400">{r.abandons}</td>
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
                            <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
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

