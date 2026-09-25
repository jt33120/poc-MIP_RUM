// Tâches longues et Long Animation Frames (P6.3, repris par F16, plan § 5.2.2) : deux
// panneaux sur un axe x commun, et le chemin vers les sessions concernées.
//
// CE QUI N'EST PAS AFFICHÉ, ET POURQUOI. Aucun cumul de durées. Additionner des
// blocages venus de sessions, d'onglets et de visiteurs différents produit un
// nombre de millisecondes qui n'est le temps perdu de personne ; présenté comme
// « temps d'attente », il serait faux d'un facteur égal au nombre de visiteurs.
// On compte donc des BLOCAGES, on en donne le p75 et le pire cas, et on offre le
// cas individuel — la session — plutôt qu'une somme.
//
// F16 : le p75 du blocage par seau n'est plus enfoui dans la table repliée. Il a
// son panneau (`ThresholdSeries` sans vital : aucun seuil publié pour un blocage,
// R-S), SOUS le panneau des comptes (`StackedBars`, seul composant qui empile) :
// même grille, même largeur de seau, mêmes marges, survol synchronisé, mêmes
// annotations de déploiement (P9), même zoom au clic. Chaque panneau garde SON axe
// y : un compte et une durée ne partagent jamais une échelle (P5).
//
// Rendu serveur : les deux panneaux sont des composants client aux props
// sérialisables ; `sessionHref` (une fonction) reste de ce côté-ci.
import Link from "next/link";
import { Figure } from "@/components/charts/Figure";
import { StackedBars } from "@/components/charts/StackedBars";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater } from "@/lib/fmt-ids";
import { fmtDate, fmtVital } from "@/lib/format";
import type { SectionLue } from "@/lib/lecture";
import type { LongtaskBucket, LongtaskWorst } from "@/lib/queries-longtasks";
import { alignerSeaux, isoSansMs, libelleSeauComplet, type Annotation } from "@/lib/series";

/** Les trois origines d'un blocage, jamais additionnées entre elles en durée. */
const API_BLOCAGE = [
  { cle: "loaf", libelle: "Long Animation Frames", categorieIndex: 0 },
  { cle: "longtask", libelle: "Long Tasks", categorieIndex: 1 },
  { cle: "inconnu", libelle: "API non distinguée", categorieIndex: 4 },
] as const;

/** Les deux panneaux se survolent ensemble (recharts `syncId`) : un seul par écran. */
const SYNCHRO = "blocages-fil-principal";

export type PointBlocage = {
  t: string;
  loaf: number;
  longtask: number;
  inconnu: number;
  /** p75 du blocage du seau ; `null` : aucun blocage (un trou, jamais « 0 ms »). */
  p75: number | null;
  /** Blocages du seau, toutes API : l'effectif du p75 (point creux sous 30). */
  n: number;
};

/**
 * La série lue, posée sur la grille du contrat (`bucketStarts`, § 3.10). Les comptes
 * d'un seau absent valent 0 (additifs) ; son p75 reste `null` (un trou). La ligne
 * mêle comptes et p75 : alignée en NON additif (`alignerSeaux(…, false)` rendrait
 * sinon un p75 à 0), puis les seuls comptes sont mis à 0 ici.
 */
export function pointsBlocages(rows: readonly LongtaskBucket[], debuts: number[]): PointBlocage[] {
  return alignerSeaux([...rows], debuts, false).map((r, i) => {
    const t = isoSansMs(debuts[i]);
    if (!r) return { t, loaf: 0, longtask: 0, inconnu: 0, p75: null, n: 0 };
    const loaf = Number(r.loaf) || 0;
    const longtask = Number(r.longtask) || 0;
    const inconnu = Number(r.inconnu) || 0;
    const p75 = r.p75_ms == null || !Number.isFinite(Number(r.p75_ms)) ? null : Number(r.p75_ms);
    return { t, loaf, longtask, inconnu, p75, n: loaf + longtask + inconnu };
  });
}

export function LongtasksView({
  serie,
  worst,
  grille,
  bucketSeconds,
  bucketLabel,
  periodLabel,
  zoomHref,
  annotations,
  annotationsIndisponibles,
  sessionHref,
}: {
  /** `longtaskSeries(f)` ; en échec, la figure le dit (les pires cas restent). */
  serie: SectionLue<LongtaskBucket[]>;
  /** `worstLongtasks(f)` ; en échec, la table le dit (la figure reste). */
  worst: SectionLue<LongtaskWorst[]>;
  /** Débuts de seau attendus du contrat, en millisecondes (`bucketStarts`). */
  grille: number[];
  bucketSeconds: number;
  bucketLabel: string;
  periodLabel: string;
  /** Gabarit `{from}` / `{to}` du zoom sur un seau (écran courant, seule la plage change). */
  zoomHref?: string;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  /** Lien vers une session, filtres courants conservés. */
  sessionHref: (sessionId: string) => string;
}) {
  const titre = "Tâches longues dans le temps";
  const grilleIso = grille.map(isoSansMs);
  const points = serie.ok ? pointsBlocages(serie.data, grille) : [];
  const total = points.reduce((s, p) => s + p.n, 0);

  return (
    <section className="mb-6 min-w-0" data-testid="longtasks">
      {!serie.ok ? (
        <Figure titre={titre} id="figure-taches-longues" etat={{ kind: "erreur", titre }} />
      ) : (
        <Figure
          titre={titre}
          id="figure-taches-longues"
          meta={
            <>
              <span>{formater("count", total)} blocage(s)</span>
              <span>{periodLabel}</span>
              <span>une colonne = {bucketLabel}</span>
            </>
          }
          lecture={
            <>
              En haut, les blocages comptés par API de mesure : les deux API ne sont jamais actives ensemble sur un
              même navigateur, un blocage n&apos;est donc compté qu&apos;une fois ; elles restent séparées parce
              qu&apos;un parc mixte produit les deux. En bas, le p75 de la durée de blocage du seau (aucun seuil
              publié : pas de couleur de verdict). <strong>Aucun cumul de durées n&apos;est affiché</strong> : des
              blocages concurrents de plusieurs visiteurs ne s&apos;additionnent pas en temps d&apos;attente vécu.
            </>
          }
          alternative={
            total > 0
              ? {
                  legende: `Blocages par ${bucketLabel} sur ${periodLabel}, par API de mesure, et p75 du blocage`,
                  colonnes: ["Seau", ...API_BLOCAGE.map((a) => a.libelle), "Blocage p75"],
                  lignes: points.map((p) => [
                    libelleSeauComplet(p.t, bucketSeconds, "UTC"),
                    p.loaf,
                    p.longtask,
                    p.inconnu,
                    p.p75 == null ? "pas de mesure" : formater("ms", p.p75),
                  ]),
                }
              : undefined
          }
        >
          {total > 0 ? (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-ink-soft">Blocages par API de mesure</p>
                <StackedBars
                  grille={grilleIso}
                  points={points}
                  series={API_BLOCAGE.map((a) => ({ cle: a.cle, libelle: a.libelle, categorieIndex: a.categorieIndex }))}
                  format="count"
                  seauSecondes={bucketSeconds}
                  fuseau="UTC"
                  hauteur={150}
                  zoomHref={zoomHref}
                  annotations={annotations}
                  legendeAnnotations={false}
                  synchro={SYNCHRO}
                  ariaLabel={`Blocages du fil principal par API de mesure, ${grilleIso.length} seaux`}
                />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-ink-soft">Blocage p75 par seau</p>
                <ThresholdSeries
                  grille={grilleIso}
                  points={points}
                  series={[{ cle: "p75", libelle: "Blocage p75", role: "principale", effectifCle: "n" }]}
                  format="ms"
                  seauSecondes={bucketSeconds}
                  fuseau="UTC"
                  hauteur={150}
                  zoomHref={zoomHref}
                  annotations={annotations}
                  annotationsIndisponibles={annotationsIndisponibles}
                  synchro={SYNCHRO}
                  ariaLabel={`p75 de la durée de blocage par seau, ${grilleIso.length} seaux`}
                />
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-ink-soft">
              Aucun blocage mesuré sur {periodLabel}. Long Animation Frames n&apos;existe que sur Chromium ;
              ailleurs, le SDK retombe sur l&apos;API Long Tasks.
            </p>
          )}
        </Figure>
      )}

      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        Les blocages les plus longs, et leur session
      </h3>
      {!worst.ok ? (
        <div className="card p-4">
          <EchecLecture compact titre="Les blocages les plus longs" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Blocages les plus longs sur {periodLabel}, avec leur session</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th">Ce qui a bloqué</th>
                <th scope="col" className="th">Route</th>
                <th scope="col" className="th">Quand</th>
                <th scope="col" className="th text-right">Blocage</th>
                <th scope="col" className="th">Session</th>
              </tr>
            </thead>
            <tbody>
              {worst.data.map((ligne) => (
                <tr
                  key={`${ligne.session_id ?? "-"}|${new Date(ligne.ts).toISOString()}|${ligne.quoi}`}
                  className="border-t border-line/60 transition hover:bg-panel2/60"
                >
                  <td className="max-w-xs px-4 py-2 font-mono text-xs text-ink" title={ligne.quoi}>
                    {ligne.quoi}
                    {ligne.source && <span className="ml-2 chip-mono text-[10px]">{ligne.source}</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{ligne.route ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{fmtDate(ligne.ts)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                    {fmtVital("dur", Number(ligne.blocking_ms))}
                  </td>
                  <td className="px-4 py-2">
                    {ligne.session_id ? (
                      <Link
                        href={sessionHref(ligne.session_id)}
                        className="rounded font-mono text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                      >
                        {ligne.session_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-soft">sans session rattachée</span>
                    )}
                  </td>
                </tr>
              ))}
              {!worst.data.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                    Aucun blocage sur {periodLabel}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
