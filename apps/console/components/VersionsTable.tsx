// Comparaison des versions déployées — le bloc « Comparaison par version ».
//
// LA DONNÉE EXISTAIT, L'ÉCRAN MANQUAIT. `rum_session.release` est collecté par le
// SDK depuis longtemps (attribut `mip.release`, posé pour associer une erreur à
// sa source map) et n'était restitué nulle part. La roue des blocs le disait
// elle-même : « la version déployée est désormais collectée sur chaque session,
// mais aucun écran ne la restitue encore ».
//
// NE S'AFFICHE PAS SOUS DEUX VERSIONS. Une « comparaison » d'une seule ligne
// n'apprend rien et occupe l'écran ; sur une app qui ne renseigne pas `release`,
// elle afficherait éternellement « (non renseignée) » comme s'il s'agissait
// d'un résultat. Le bloc décide donc lui-même de son affichage, plutôt que de
// faire porter la condition à l'écran qui l'appelle.
import { GlossaryTip } from "@/components/GlossaryTip";
import {
  comparable,
  ecartPoints,
  tauxErreur,
  versionReference,
  type ComparaisonVersions,
} from "@/lib/queries-deploys";
import { fmtVital } from "@/lib/format";
import { RATING_CLASS, rating2026 } from "@/lib/rating";
import { ecartProportions, intervalleWilson, texteIntervalle } from "@/lib/stats/incertitude";

/** Cellule de vital, colorée au barème web.dev (lib/rating.ts). Vide quand la mesure manque. */
function VitalCell({ name, v }: { name: "LCP" | "INP"; v: number | null }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  const r = rating2026(name, Number(v));
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r ? RATING_CLASS[r] : ""}`}>
      {fmtVital(name, Number(v))}
    </span>
  );
}

export function VersionsTable({
  comparaison,
  periodLabel,
}: {
  comparaison: ComparaisonVersions;
  periodLabel: string;
}) {
  const { rows, source } = comparaison;
  if (!comparable(rows)) return null;
  const ref = versionReference(rows)!;

  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        Comparaison par version
        <GlossaryTip id="rum" />
      </h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Version</th>
              <th className="th text-right">Sessions</th>
              <th className="th text-right">LCP p75</th>
              <th className="th text-right">INP p75</th>
              <th className="th text-right">Sessions avec erreur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const taux = tauxErreur(r);
              const ecart = ecartPoints(r, ref);
              // P*.1 : Wilson sur la part de sessions en erreur, Newcombe sur l'écart
              // à la référence. Un numérateur au-delà des sessions (erreurs et vues
              // comptées sur deux tables) n'a pas d'intervalle, et le dit.
              const intervalle = texteIntervalle(intervalleWilson(r.sessionsEnErreur, r.sessions), (v) => `${(v * 100).toFixed(1)} %`);
              const etabli =
                ecart == null ? null : ecartProportions(r.sessionsEnErreur, r.sessions, ref.sessionsEnErreur, ref.sessions);
              return (
                <tr key={r.version} className="border-t border-line/60 transition hover:bg-panel2/60">
                  <td className="px-4 py-2 font-mono text-xs font-medium text-ink">
                    {r.version}
                    {r.version === ref.version && (
                      <span className="ml-2 rounded bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                        référence
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {r.sessions.toLocaleString("fr-FR")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <VitalCell name="LCP" v={r.lcp} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <VitalCell name="INP" v={r.inp} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {taux == null ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <>
                        <span className="text-ink">{(taux * 100).toFixed(1)} %</span>
                        {ecart != null && Math.abs(ecart) >= 0.1 && (
                          etabli?.etabli === false ? (
                            // P*.1 : l'intervalle de Newcombe de la différence contient 0 —
                            // l'écart reste écrit, sans couleur, et la règle est dite.
                            <span className="ml-2 text-xs text-ink-soft" title={etabli.regle} data-testid="version-ecart-non-etabli">
                              {ecart > 0 ? "+" : ""}
                              {ecart.toFixed(1)} pt · non établi
                            </span>
                          ) : (
                            <span className={`ml-2 text-xs ${ecart > 0 ? "text-bad-ink" : "text-good-ink"}`}>
                              {ecart > 0 ? "+" : ""}
                              {ecart.toFixed(1)} pt
                            </span>
                          )
                        )}
                        {intervalle && (
                          <span className="block text-[11px] text-ink-soft" data-testid="version-intervalle">
                            {intervalle}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* La limite est dite SOUS le tableau, pas ailleurs : c'est là qu'on lit
          l'écart, donc là qu'il faut savoir ce qu'il mélange. */}
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        Sur {periodLabel}, sans normalisation : deux versions qui n&apos;ont pas tourné aux mêmes
        heures sont jugées sur des publics différents. L&apos;écart mêle donc le code et le
        contexte — à lire comme un signal, pas comme une mesure d&apos;impact.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint" data-testid="versions-source">
        {source === "occurrence" ? (
          <>
            Chaque page vue, mesure et erreur porte la release déclarée <strong>au moment où elle est
            survenue</strong>. Une session qui traverse un déploiement compte donc dans les deux versions,
            et « Sessions » n&apos;est pas additionnable d&apos;une ligne à l&apos;autre.
          </>
        ) : (
          <>
            Les colonnes de release par mesure ne sont pas encore présentes dans ce schéma : toutes les
            mesures d&apos;une session sont attribuées à la <strong>première</strong> release vue par cette
            session. Une session à cheval sur un déploiement est donc rangée du mauvais côté.
          </>
        )}
      </p>
    </section>
  );
}
