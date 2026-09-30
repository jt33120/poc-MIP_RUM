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
// DURÉE NOTÉE, BLOCAGE NEUTRE (suite de la vague 4, 30/09/2026). Les règles MIP
// `SEUILS_MIP.LONGTASK` et `.LOAF` portent sur la DURÉE p75 d'une tâche ou d'une
// trame, pas sur son temps de blocage (`coalesce(blocking_ms, duration_ms)`). La
// durée p75 de la période est donc écrite au-dessus des panneaux, par API, notée
// par sa règle (`ValeurNoteeMip`, règle écrite à côté) ; le blocage — panneau du bas
// et table des pires cas — reste sans couleur de verdict, et l'écran le dit.
//
// Rendu serveur : les deux panneaux sont des composants client aux props
// sérialisables ; `sessionHref` (une fonction) reste de ce côté-ci.
import Link from "next/link";
import { Figure } from "@/components/charts/Figure";
import { StackedBars } from "@/components/charts/StackedBars";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EchecLecture } from "@/components/states/SectionErreur";
import { InfoTip } from "@/components/InfoTip";
import { ValeurNoteeMip } from "@/components/NoteMip";
import { TableDefilante } from "@/components/TableDefilante";
import { formater } from "@/lib/fmt-ids";
import { fmtDate, fmtVital, pluriel } from "@/lib/format";
import type { SectionLue } from "@/lib/lecture";
import type { LongtaskBucket, LongtaskWorst } from "@/lib/queries-longtasks";
import { alignerSeaux, isoSansMs, libelleSeauComplet, type Annotation, type FenetreCollecte } from "@/lib/series";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { INDEX_AUTRES } from "@/lib/palette";

/**
 * Les trois origines d'un blocage, jamais additionnées entre elles en durée. Noms
 * français (recette du 26/09/2026) ; le sigle LoAF reste, c'est celui de la doc
 * des navigateurs.
 */
const API_BLOCAGE = [
  { cle: "loaf", libelle: "Trames longues (LoAF)", categorieIndex: 0 },
  { cle: "longtask", libelle: "Tâches longues", categorieIndex: 1 },
  { cle: "inconnu", libelle: "Origine non distinguée", categorieIndex: INDEX_AUTRES },
] as const;

/** L'API d'un blocage, en mots : le badge affichait la clé brute (« loaf »). */
const LIBELLE_SOURCE: Record<string, string> = { loaf: "trame longue", longtask: "tâche longue" };

/**
 * Les API dont la durée a une règle MIP. Les lignes « inconnu » (avant la distinction
 * des API) n'en ont pas : on ne sait pas laquelle des deux règles les note.
 */
const DUREES_NOTEES = [
  { cle: "loaf", mesure: "LOAF", libelle: "Trames longues (LoAF)" },
  { cle: "longtask", mesure: "LONGTASK", libelle: "Tâches longues" },
] as const;

/** Ce que l'écran dit du blocage : aucune règle MIP ne le vise. */
export const PHRASE_BLOCAGE_NEUTRE = "Le temps de blocage n'a pas de règle MIP : il reste neutre.";

/**
 * Durée p75 de la période, par API, lue sur la série (`longtaskSeries` la répète sur
 * chaque ligne). `null` : aucune mesure de cette API — jamais « 0 ms ».
 */
export function dureesP75(rows: readonly LongtaskBucket[]): { loaf: number | null; longtask: number | null } {
  const nombre = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const premiere = rows[0];
  return { loaf: nombre(premiere?.duree_p75_loaf), longtask: nombre(premiere?.duree_p75_longtask) };
}

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
  fenetresCollecte,
  sessionHref,
  partie = "tout",
}: {
  /**
   * Ce qui est rendu : la série, la table des pires blocages, ou les deux. L'écran
   * /pages pose la table sur toute la largeur, sous la rangée TTFB · série : dans la
   * colonne de la série, elle laissait 500 px vides à côté (recette du 26/09/2026).
   */
  partie?: "tout" | "serie" | "pires";
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
  /** Fenêtres hors collecte (`sectionFenetresCollecte`) : hachures « non mesuré » des deux panneaux. */
  fenetresCollecte?: readonly FenetreCollecte[];
  /** Lien vers une session, filtres courants conservés. */
  sessionHref: (sessionId: string) => string;
}) {
  const titre = "Tâches longues dans le temps";
  const grilleIso = grille.map(isoSansMs);
  const points = serie.ok ? pointsBlocages(serie.data, grille) : [];
  const total = points.reduce((s, p) => s + p.n, 0);
  const durees = serie.ok ? dureesP75(serie.data) : { loaf: null, longtask: null };

  return (
    // La série seule remplit sa cellule de grille (même bord bas que sa voisine) ; les
    // autres parties gardent leur marge sous elles.
    <section
      className={`min-w-0 ${partie === "serie" ? "h-full [&>section]:h-full" : "mb-4"}`}
      data-testid={partie === "tout" ? "longtasks" : `longtasks-${partie}`}
    >
      {partie === "pires" ? null : !serie.ok ? (
        <Figure titre={titre} id="figure-taches-longues" etat={{ kind: "erreur", titre }} />
      ) : (
        <Figure
          titre={titre}
          id="figure-taches-longues"
          // Aucun blocage : la figure tient sur une ligne (recette du 30/09/2026) ; la
          // raison probable (Chromium seul mesure les trames longues) ouvre « Méthode ».
          etat={total > 0 ? undefined : { kind: "vide", population: "blocage mesuré", masculin: true, plage: periodLabel }}
          meta={
            <>
              <span>{pluriel(total, "blocage")}</span>
              <span>{periodLabel}</span>
              <span>une colonne = {bucketLabel}</span>
            </>
          }
          lecture={
            <>
              {total === 0 && (
                <>
                  La mesure des trames longues (LoAF) n&apos;existe que sur Chromium ; ailleurs, le SDK retombe sur celle
                  des tâches longues.{" "}
                </>
              )}
              La durée p75 de chaque API est notée par sa règle MIP, écrite à côté. En haut, les blocages comptés par
              API de mesure ; en bas, le p75 de leur temps de blocage, sans couleur de verdict : le temps de blocage
              n&apos;a pas de règle MIP. <strong>Aucun cumul de durées n&apos;est affiché</strong>. Les deux API de
              mesure ne sont jamais actives ensemble sur un même navigateur : un blocage n&apos;est compté qu&apos;une
              fois ; elles restent séparées parce qu&apos;un parc mixte produit les deux. Des blocages concurrents de
              plusieurs visiteurs ne s&apos;additionnent pas en temps d&apos;attente vécu : aucun cumul n&apos;est donc
              calculé.
            </>
          }
          alternative={
            total > 0
              ? {
                  legende: `Blocages par ${bucketLabel} sur ${periodLabel}, par API de mesure, et p75 du blocage`,
                  colonnes: ["Tranche", ...API_BLOCAGE.map((a) => a.libelle), "Blocage p75"],
                  lignes: points.map((p) => [
                    libelleSeauComplet(p.t, bucketSeconds, FUSEAU_AFFICHAGE),
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
            <div className="flex min-w-0 flex-col gap-2">
              {/* La méthode des deux API rejoint celle de la figure, dans le repli
                  « Méthode » sous le dessin : un seul repli par figure (30/09/2026). */}
              {/* `relative` : le libellé `sr-only` d'une note (position absolue) reste dans
                  ce bloc, jamais placé par rapport à la page (piège 16). Une rangée de
                  valeurs notées (recette du 30/09/2026 : un encadré de quatre lignes) ;
                  la neutralité du blocage s'ouvre en bulle. */}
              <div
                className="relative flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-line/60 py-1.5 text-[11px]"
                data-testid="durees-p75"
              >
                <p className="font-medium text-ink-soft [overflow-wrap:anywhere]">Durée p75 sur {periodLabel}</p>
                <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                  {DUREES_NOTEES.map((d) => {
                    const valeur = durees[d.cle];
                    return (
                      <div key={d.cle} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <dt className="min-w-0 text-xs text-ink [overflow-wrap:anywhere]">{d.libelle}</dt>
                        <dd className="min-w-0 [overflow-wrap:anywhere]">
                          <ValeurNoteeMip
                            mesure={d.mesure}
                            valeur={valeur}
                            texte={valeur == null ? "pas de mesure" : formater("ms", valeur)}
                          />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <p className="inline-flex min-w-0 items-center gap-1 text-ink-faint" data-testid="blocage-neutre">
                  Blocage sans couleur
                  <InfoTip label="Pourquoi le blocage n'a pas de couleur" align="end">
                    {PHRASE_BLOCAGE_NEUTRE} Le panneau du bas et la table des pires blocages le montrent sans couleur.
                  </InfoTip>
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-ink-soft">Blocages par API de mesure</p>
                <StackedBars
                  grille={grilleIso}
                  points={points}
                  series={API_BLOCAGE.map((a) => ({ cle: a.cle, libelle: a.libelle, categorieIndex: a.categorieIndex }))}
                  format="count"
                  seauSecondes={bucketSeconds}
                  fuseau={FUSEAU_AFFICHAGE}
                  hauteur={120}
                  zoomHref={zoomHref}
                  annotations={annotations}
                  legendeAnnotations={false}
                  synchro={SYNCHRO}
                  fenetresCollecte={fenetresCollecte}
                  ariaLabel={`Blocages du fil principal par API de mesure, ${grilleIso.length} tranches de ${bucketLabel}`}
                />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-ink-soft">Blocage p75 par tranche de {bucketLabel}</p>
                <ThresholdSeries
                  grille={grilleIso}
                  points={points}
                  series={[{ cle: "p75", libelle: "Blocage p75", role: "principale", effectifCle: "n" }]}
                  format="ms"
                  seauSecondes={bucketSeconds}
                  fuseau={FUSEAU_AFFICHAGE}
                  hauteur={120}
                  zoomHref={zoomHref}
                  annotations={annotations}
                  annotationsIndisponibles={annotationsIndisponibles}
                  synchro={SYNCHRO}
                  noteCollecte={false}
                  fenetresCollecte={fenetresCollecte}
                  ariaLabel={`p75 de la durée de blocage par tranche de ${bucketLabel}, ${grilleIso.length} tranches`}
                />
              </div>
            </div>
          ) : null}
        </Figure>
      )}

      {partie === "serie" ? null : (
      <>
      <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft ${partie === "pires" ? "" : "mt-4"}`}>
        Les blocages les plus longs, et leur session
      </h3>
      {!worst.ok ? (
        <div className="card p-4">
          <EchecLecture compact titre="Les blocages les plus longs" />
        </div>
      ) : (
        // Défilement signalé : à 390 px, ni la route ni la durée ne se voyaient, sans
        // indice qu'elles suivaient (recette 26/09). Les lignes défilent sous un en-tête
        // collant au-delà de 18 rem (recette du 30/09/2026 : 20 lignes de 540 px).
        <TableDefilante className="card" label="Les blocages les plus longs">
          <div className="max-h-[18rem] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
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
                  {/* `[overflow-wrap:anywhere]` : une URL de script sans espace se coupe
                      au lieu d'occuper toute la largeur visible. */}
                  <td className="max-w-xs px-4 py-2 font-mono text-xs text-ink [overflow-wrap:anywhere]" title={ligne.quoi}>
                    {ligne.quoi}
                    {ligne.source && <span className="ml-2 chip-mono text-[10px]">{LIBELLE_SOURCE[ligne.source] ?? ligne.source}</span>}
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
                  <td colSpan={5} className="px-4 py-3 text-xs text-ink-soft">
                    <span aria-hidden className="mr-1.5 text-ink-faint">
                      ⊘
                    </span>
                    Aucun blocage sur {periodLabel}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </TableDefilante>
      )}
      </>
      )}
    </section>
  );
}
