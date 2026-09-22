import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { decouperUrlScript, fmtVital } from "@/lib/format";
import {
  inpOffenders,
  scriptsBloquants,
  topFrustrations,
  type FrustrationRow,
} from "@/lib/queries-frustration";
import { RATING_CLASS, RATING_HEX, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

/** Signaux de frustration (P1) : rage/dead clicks + éléments lents à l'INP. */
export default async function UxFrustration({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ecran = await pageFilters(await searchParams, "/ux");
  if (!ecran.ok) return <FilterProblemNotice title="Frustration" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = { label: ecran.label };
  // Trois lectures, trois sections (F02, § 3.8) : `lire()` ne lève pas. Ces
  // lectures rendaient autrefois `[]` pendant une panne — des tuiles « 0 rage
  // click » en vert et « Aucun signal sur 24 h », c'est-à-dire l'image d'une
  // application sans frustration, affichée quand on n'avait rien lu.
  const [signals, inp, scripts] = await Promise.all([
    lire(() => topFrustrations(f)),
    lire(() => inpOffenders(f)),
    lire(() => scriptsBloquants(f)),
  ]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Frustration"
        sub="Signaux d'agacement et d'échec : rage clicks, dead clicks, actions suivies d'une erreur, interactions lentes et scripts qui bloquent le fil principal."
      />

      <SectionErreur titre="Éléments lents à l'INP">
        {(() => {
          // Hero : nuage « fréquence × lenteur » des éléments à l'INP. Un point en
          // haut à droite = interagi souvent ET lent = priorité de correction.
          const offenders = inp.ok ? inp.data : [];
          const pts = offenders
            .filter((o) => o.p75 != null)
            .map((o) => {
              const rating = rating2026("INP", Number(o.p75));
              return {
                x: o.n,
                y: Number(o.p75),
                z: o.worst != null ? Number(o.worst) : undefined,
                label: o.target,
                color: rating ? RATING_HEX[rating] : "#94a3b8",
              };
            });
          const worstEl = [...offenders].filter((o) => o.p75 != null).sort((a, b) => Number(b.p75) - Number(a.p75))[0];
          return (
            <SupervisionHero
              chartTitle="Éléments lents à l'INP — fréquence × latence"
              state={
                !inp.ok
                  ? { kind: "erreur", titre: "Éléments lents à l'INP" }
                  : pts.length === 0
                    ? { kind: "vide", population: "interaction lente", plage: period.label }
                    : undefined
              }
              chart={
                <ScatterPlot
                  points={pts}
                  xLabel="Interactions"
                  yLabel="INP p75"
                  yUnit=" ms"
                  yFormat="int"
                />
              }
            >
              {signals.ok ? (
                <HeroSignaux signals={signals.data} />
              ) : (
                <EchecLecture compact titre="Signaux de frustration" />
              )}
              {/* L'élément le plus lent vient de la lecture INP : en échec, la tuile
                  n'est pas rendue — un « — » dirait « aucune interaction mesurée ». */}
              {inp.ok && (
                <HeroStat
                  label="Élément le plus lent"
                  value={worstEl ? fmtVital("INP", Number(worstEl.p75)) : "—"}
                  hint={worstEl?.target}
                  tone="warn"
                />
              )}
              <HeroReading>
                Chaque point = un élément interactif : X = nombre d&apos;interactions, Y = INP p75, taille = pire
                cas, couleur = verdict web.dev de l&apos;INP. Ceux en haut à droite sont à la fois fréquents et lents — à corriger en
                priorité. Signaux rage/dead et détail par élément ci-dessous.
              </HeroReading>
            </SupervisionHero>
          );
        })()}
      </SectionErreur>

      <h2 className="mb-2 text-sm font-semibold text-ink">Signaux de frustration</h2>
      <SectionErreur titre="Signaux de frustration">
        {!signals.ok ? (
          <div className="mb-8">
            <EchecLecture titre="Signaux de frustration" />
          </div>
        ) : (
          <div className="card mb-8 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Type</th>
                  <th className="th">Cible</th>
                  <th className="th">Route</th>
                  <th className="th text-right">Occurrences</th>
                </tr>
              </thead>
              <tbody>
                {signals.data.map((s) => (
                  <tr key={`${s.kind}-${s.route}-${s.target}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                    <td className="px-4 py-2">
                      <KindChip kind={s.kind} />
                    </td>
                    <td className="px-4 py-2 font-medium text-ink">{s.target}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{s.route}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.n.toLocaleString("fr-FR")}</td>
                  </tr>
                ))}
                {!signals.data.length && <Empty cols={4} period={period.label} />}
              </tbody>
            </table>
          </div>
        )}
      </SectionErreur>

      <h2 className="mb-2 text-sm font-semibold text-ink">
        Interactions lentes — éléments responsables (attribution INP)
      </h2>
      <SectionErreur titre="Interactions lentes">
        {!inp.ok ? (
          <EchecLecture titre="Interactions lentes" />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Élément (interactionTarget)</th>
                  <th className="th text-right">Interactions</th>
                  <th className="th text-right">INP p75</th>
                  <th className="th text-right">Pire</th>
                </tr>
              </thead>
              <tbody>
                {inp.data.map((o) => (
                  <tr key={o.target} className="border-t border-line/60 transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs text-ink" title={o.target}>
                      {o.target}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{o.n.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2 text-right"><InpCell v={o.p75} /></td>
                    <td className="px-4 py-2 text-right"><InpCell v={o.worst} /></td>
                  </tr>
                ))}
                {!inp.data.length && <Empty cols={4} period={period.label} />}
              </tbody>
            </table>
          </div>
        )}
      </SectionErreur>

      {/* Le chaînon manquant entre « INP à 900 ms » et un correctif : l'élément
          ci-dessus dit OÙ l'utilisateur a cliqué, celui-ci dit QUEL CODE a tenu
          le fil principal pendant ce temps-là. */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-ink">
        Scripts qui bloquent le fil principal (Long Animation Frames)
      </h2>
      <SectionErreur titre="Scripts qui bloquent le fil principal">
        {!scripts.ok ? (
          <EchecLecture titre="Scripts qui bloquent le fil principal" />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Script</th>
                  <th className="th">Fonction / invocation</th>
                  <th className="th text-right">Frames</th>
                  <th className="th text-right">Blocage cumulé</th>
                  <th className="th text-right">Pire</th>
                </tr>
              </thead>
              <tbody>
                {scripts.data.map((s) => (
                  <tr key={`${s.url}-${s.quoi}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                    {/* Nom de fichier en évidence, hôte en dessous : une troncature
                        de fin n'aurait montré que le préfixe, identique pour tous
                        les scripts du même site. L'URL entière reste en infobulle. */}
                    <td className="px-4 py-2" title={s.url}>
                      {(() => {
                        const { fichier, hote } = decouperUrlScript(s.url);
                        return (
                          <>
                            <span className="block font-mono text-xs font-medium text-ink">{fichier}</span>
                            {hote && <span className="block font-mono text-[11px] text-ink-faint">{hote}</span>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{s.quoi}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                      {s.n.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                      {Math.round(s.totalMs).toLocaleString("fr-FR")} ms
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                      {Math.round(s.worstMs).toLocaleString("fr-FR")} ms
                    </td>
                  </tr>
                ))}
                {!scripts.data.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-faint">
                      Aucun blocage attribué sur {period.label}. L&apos;API Long Animation Frames
                      n&apos;existe que sur Chromium : les visiteurs Safari et Firefox n&apos;en
                      produisent pas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionErreur>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        Classé par blocage <strong>cumulé</strong>, pas par pire cas : un script qui bloque 400 ms une
        fois est un incident, un script qui bloque 60 ms à chaque frappe est le problème — et c&apos;est
        le second qui décide de l&apos;INP.
      </p>
    </div>
  );
}

/** Les trois tuiles de signaux, rendues seulement sur une lecture réussie. */
function HeroSignaux({ signals }: { signals: FrustrationRow[] }) {
  const rage = signals.filter((s) => s.kind === "rage").reduce((n, s) => n + s.n, 0);
  const dead = signals.filter((s) => s.kind === "dead").reduce((n, s) => n + s.n, 0);
  const errorClicks = signals.filter((s) => s.kind === "error").reduce((n, s) => n + s.n, 0);
  return (
    <>
      <HeroStat label="Rage clicks" value={rage.toLocaleString("fr-FR")} tone={rage > 0 ? "poor" : "good"} />
      <HeroStat label="Dead clicks" value={dead.toLocaleString("fr-FR")} tone={dead > 0 ? "warn" : "good"} />
      <HeroStat label="Error clicks" value={errorClicks.toLocaleString("fr-FR")} tone={errorClicks > 0 ? "poor" : "good"} />
    </>
  );
}

function KindChip({ kind }: { kind: "rage" | "dead" | "error" }) {
  const cls =
    kind === "rage"
      ? "border-bad/30 bg-bad/10 text-bad-ink"
      : kind === "error"
        ? "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-300"
        : "border-warn/30 bg-warn/10 text-warn-ink";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {kind === "rage" ? "rage" : kind === "error" ? "error" : "dead"}
    </span>
  );
}

function InpCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint/60">—</span>;
  const rating = rating2026("INP", Number(v));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital("INP", Number(v))}
    </span>
  );
}

function Empty({ cols, period }: { cols: number; period: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-ink-faint">
        Aucun signal sur {period}
      </td>
    </tr>
  );
}
