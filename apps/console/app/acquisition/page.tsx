import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Donut } from "@/components/charts/Donut";
import type { Channel } from "@/lib/acquisition";
import { categorie } from "@/lib/palette";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import type { SearchParams } from "@/lib/filters";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { PERIODS } from "@/lib/filters";
import { acquisition } from "@/lib/queries-acquisition";
import { samplingSessionsHistorique } from "@/lib/queries-sessions";

export const dynamic = "force-dynamic";

const LABEL: Record<Channel, string> = {
  direct: "Direct",
  search: "Recherche",
  social: "Social",
  referral: "Référent",
  internal: "Interne",
};
// Un canal est une catégorie, pas un verdict : couleurs de CATEGORIELLE, dans
// l'ordre fixe des canaux (le « Référent » n'est pas « bon », l'« Interne » pas
// « à surveiller »).
const HEX: Record<Channel, string> = {
  direct: categorie(4),
  search: categorie(0),
  social: categorie(2),
  referral: categorie(1),
  internal: categorie(6),
};

export default async function Acquisition({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ecran = await pageFilters(await searchParams, "/acquisition");
  if (!ecran.ok) return <FilterProblemNotice title="Acquisition" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = PERIODS[f.period];
  // S7 : même population que la lecture (sessions ayant une vue sur la fenêtre
  // glissante), lue à part : son échec ne masque pas les canaux, il est dit.
  const [rep, echantillonnage] = await Promise.all([
    acquisition(f),
    lire(() => samplingSessionsHistorique(f, { lecture: "vues" })),
  ]);
  const total = rep.total;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Acquisition"
        sub="D'où viennent les visiteurs — canal d'entrée (direct, recherche, social, référent) et sites référents."
      />

      <BandeauEchantillonnage lecture={echantillonnage} />

      {!total ? (
        <div className="card p-8 text-center text-ink-faint">Aucune session sur {period.label}</div>
      ) : (
        <>
          {(() => {
            const sorted = [...rep.channels].filter((c) => c.sessions > 0).sort((a, b) => b.sessions - a.sessions);
            const top = sorted[0];
            return (
              <SupervisionHero
                chartTitle="Répartition par canal d'entrée"
                chart={
                  <Donut
                    slices={sorted.map((c) => ({
                      label: LABEL[c.channel],
                      value: c.sessions,
                      color: HEX[c.channel],
                    }))}
                    centerValue={total.toLocaleString("fr-FR")}
                    centerLabel="sessions"
                  />
                }
              >
                <HeroStat label={`Sessions · ${period.label}`} value={total.toLocaleString("fr-FR")} />
                <HeroStat
                  label="Canal dominant"
                  value={top ? LABEL[top.channel] : "—"}
                  hint={top ? `${Math.round((top.sessions / total) * 100)} % du trafic` : undefined}
                />
                <HeroStat label="Sites référents" value={rep.referrers.length.toLocaleString("fr-FR")} hint="hôtes externes distincts" />
                <HeroReading>
                  L&apos;anneau montre la part de chaque canal d&apos;entrée. Un trafic très «&nbsp;direct&nbsp;»
                  peut masquer des référents mal détectés (pas d&apos;UTM capté). Détail des sites référents
                  ci-dessous.
                </HeroReading>
              </SupervisionHero>
            );
          })()}

          <h2 className="mb-2 text-sm font-semibold text-ink">Sites référents</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Hôte</th>
                  <th className="th">Canal</th>
                  <th className="th">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rep.referrers.map((r) => (
                  <tr key={r.host} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs">{r.host}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HEX[r.channel] }} />
                        {LABEL[r.channel]}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">{r.sessions}</td>
                  </tr>
                ))}
                {!rep.referrers.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      Aucun site référent externe (trafic direct/interne)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-ink-faint">
            Note : les paramètres de campagne (UTM) ne sont pas captés (URL nettoyée côté SDK) —
            détection de campagne = évolution SDK à prévoir.
          </p>
        </>
      )}
    </div>
  );
}
