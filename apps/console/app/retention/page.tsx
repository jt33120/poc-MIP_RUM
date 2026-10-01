// `/retention` — « Les visiteurs identifiés reviennent-ils, et au bout de combien de
// semaines décrochent-ils ? » (F49, plan § 5.17).
//
// LA CLÉ EST `visitor_id`, tirée au hasard par le SDK : les sessions sans
// identifiant sont EXCLUES de la matrice (plutôt qu'une répartition au jugé), et
// l'historique antérieur au 09/09/2026 n'en porte pas (lib/queries-cohorts.ts).
//
// CE QUE L'ÉCRAN NE FAIT PLUS.
//   - Compter la semaine en cours comme une semaine : la courbe et les tuiles ne
//     retiennent que les cellules COMPLÈTES (`courbeRetention`, lib/cohorts.ts),
//     et la matrice hache la semaine en cours.
//   - Rendre 0 sans cohorte : un taux sans dénominateur vaut « — » et sa raison.
//   - Colorer un verdict : aucun seuil de rétention n'est publié (S6, R-S) ; la
//     matrice passe sur l'échelle `SEQUENTIELLE`, une intensité sans verdict.
//   - Interpréter la courbe (« chute = activation, plateau = noyau fidèle ») : une
//     lecture sans source que l'écran n'a pas à poser.
//   - Laisser la période du haut active sans effet : la surface est en
//     `range: "none"`, la fenêtre se choisit ici en semaines (F40).
//   - Montrer une fonction non livrée : la tuile « Sessions sans identifiant, hors
//     matrice » attend B35 (aucune lecture n'existe) ; elle n'est pas rendue — elle
//     n'affichait que « — non lu : la lecture est à créer » (recette du 26/09/2026).
//     Que ces sessions sortent des cohortes est dit dans la méthode de la 1re tuile.
//   - Signaler un historique court comme une panne : une cohorte trop récente pour
//     avoir une semaine complète de recul est NORMALE. L'écran le dit dans un cadre
//     neutre, avec la date où S+1 deviendra lisible ; « Partiel » (orange) est
//     réservé aux données partielles (recette du 26/09/2026).
//   - Lire hors du périmètre, ou ignorer la tablette : depuis B31, la lecture lie les
//     apps EFFECTIVES du principal et applique tous les filtres de session (tablette,
//     « Inconnu ») ; le refus « une application à la fois » de F40 est levé (F53) et
//     « Par appareil » compte aussi les tablettes.
//
// REFONTE DU 30/09/2026 : trois cases épurées (sources dans leur fenêtre), la courbe et
// « Par appareil » côte à côte (même bord bas), la matrice en heatmap chiffrée sur toute
// la largeur ; les phrases de lecture dans les replis « Méthode », les états vides sur
// une ligne.
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { Figure, MethodeRepliee as Methode } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { LineTrend } from "@/components/charts/LineTrend";
import { MatriceCohortes } from "@/components/charts/MatriceCohortes";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { CadreEtat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import {
  cellulesDeCohorte,
  courbeRetention,
  filtreAppareil,
  indexSemaine,
  lundiDeSemaine,
  type CohortRow,
  type PointRetention,
} from "@/lib/cohorts";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { APPAREILS, chargerRetention, fenetreDeRetention } from "@/lib/chargeurs/retention";
import { chargerEcran } from "@/lib/ecran";
import { hrefWithQuery } from "@/lib/query-contract";
import { accord, fmtJour, pluriel } from "@/lib/format";

export const dynamic = "force-dynamic";

// Lundi de la cohorte, écrit dans le fuseau d'affichage (heure de Paris) : le lundi
// 00:00 UTC d'une cohorte y est encore un lundi. Sans fuseau fixé, un serveur à
// l'ouest de Greenwich afficherait le dimanche.
const fmtSemaine = (d: Date) => fmtJour(d);
/** Espace insécable, avant « : », « ; » et « % » dans les phrases construites ici. */
const NBSP = "\u00a0";
/** Un taux en pourcentage pour la courbe (0..100, une décimale) ; `null` reste un trou. */
const enPct = (t: number | null) => (t === null ? null : Math.round(t * 1000) / 10);
const RAISON_ECHEC = "les cohortes n'ont pas pu être chargées";

/** D'où viennent les chiffres de l'écran, écrit dans la fenêtre des cases. */
const SOURCE_RETENTION = "Capteur navigateur · identifiant de visiteur aléatoire des sessions, cohortes hebdomadaires";

/** La semaine de retour « à un mois » que le plan demande en seconde tuile. */
const SEMAINE_LONGUE = 4;

/**
 * Tuile « Retour en S+n » : le point de la courbe à cet offset, ou pourquoi il
 * n'existe pas — et, s'il existera, À QUELLE DATE (`lisibleLe`). Un offset que la
 * fenêtre ne couvre pas (S+4 sur 4 semaines : S+0 à S+3) ne deviendra jamais
 * lisible : la tuile dirait la fenêtre, pas une date qu'elle ne tiendrait pas. La
 * page ne lui en passe plus : la seconde tuile lit la dernière semaine lisible, et
 * le dit (`note`).
 */
function tuileRetour({
  point,
  offset,
  lu,
  weeks,
  lisibleLe,
  note,
}: {
  point: PointRetention | undefined;
  offset: number;
  lu: boolean;
  weeks: number;
  lisibleLe: string | null;
  /** Dit pourquoi la tuile lit cette semaine-là plutôt que celle du plan. */
  note?: string;
}) {
  const complet = point && point.taux !== null ? point : null;
  const cohortesLues = complet
    ? `${pluriel(complet.cohortes, "cohorte complète", "cohortes complètes")}${
        complet.exclues > 0 ? ` (${pluriel(complet.exclues, "exclue")}${NBSP}: semaine incomplète)` : ""
      }`
    : null;
  const lecture = [note, cohortesLues].filter(Boolean).join(" · ") || undefined;
  return (
    <KpiTile
      label={`Retour en S+${offset}`}
      valeur={complet ? complet.taux : null}
      format="pct"
      raisonNull={
        !lu
          ? RAISON_ECHEC
          : offset >= weeks
            ? `au-delà de la fenêtre de ${weeks} semaines`
            : lisibleLe
              ? `lisible à partir du ${lisibleLe}`
              : "aucun visiteur identifié sur la fenêtre"
      }
      sensMeilleur="neutre"
      couverture={complet ? { n: complet.taille, unite: accord(complet.taille, "visiteur"), faibleSous: 30 } : undefined}
      lecture={lecture}
      source={SOURCE_RETENTION}
      categorie={`Rétention · S+${offset}, cohortes complètes`}
      methode={`Part des visiteurs d'une cohorte revenus ${
        offset === 1 ? "la semaine qui suit" : `${offset} semaines après`
      } leur semaine d'arrivée. Moyenne pondérée par la taille des cohortes dont cette semaine est terminée${NBSP}; la semaine en cours est exclue.`}
    />
  );
}

/**
 * Un historique encore court n'est pas une panne : cadre NEUTRE, et la date où la
 * première cohorte aura une semaine complète de recul. Les deux bandeaux orange
 * « Partiel » qu'il remplace faisaient penser à un incident (recette du 26/09/2026).
 */
function PasEncoreDeRecul({ lisibleLe }: { lisibleLe: string | null }) {
  return (
    <CadreEtat ton="neutre" role="note" testId="retention-recul">
      Historique encore court{NBSP}: {lisibleLe ? `S+1 lisible à partir du ${lisibleLe}.` : "S+1 pas encore lisible."}
    </CadreEtat>
  );
}


export default async function Retention({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/retention.ts`) lit les cohortes, l'échantillonnage
  // et les séries par appareil ; la page relit la fenêtre par la même fonction.
  const ecran = await chargerEcran(ECRANS.retention, chargerRetention, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Rétention" problem={ecran.problem} />;

  // `weeks` est un réglage de l'écran (§ 3.1) : une valeur hors des fenêtres
  // proposées est ignorée ET signalée, jamais appliquée à moitié.
  // Seules les fenêtres que l'historique conservé remplit sont proposées.
  const { weeks, ignore, disponibles, defaut, jours } = fenetreDeRetention(sp);
  /** La fenêtre retenue, telle qu'un lien la reporte (le défaut ne s'écrit pas). */
  const weeksParam = weeks === defaut ? null : String(weeks);
  const semaineCourante = indexSemaine(Date.now());
  // Toute condition d'appareil, `device=` OU segment (`seg=v2:device:is_null`…) :
  // une condition de segment se cumulerait avec chaque série et la viderait.
  const appareilFiltre = filtreAppareil(ecran.query.filters);

  // Chaque lecture est indépendante (F02) : une lecture en échec n'efface que ses sections.
  const { cohortes, echantillonnage, parAppareil } = ecran;

  const rows: CohortRow[] = cohortes.ok ? cohortes.data : [];
  // Colonnes UTILES : d'une cohorte à la semaine en cours, au plus `weeks`.
  const colonnes = Math.min(weeks, Math.max(0, ...rows.map((r) => semaineCourante - r.cohort + 1)));
  const courbe = courbeRetention(rows, semaineCourante, colonnes);
  const totalVisiteurs = rows.reduce((s, r) => s + r.size, 0);
  // La semaine S+n de la PREMIÈRE cohorte est la première à se terminer : S+n devient
  // lisible le lundi (UTC, écrit en heure de Paris) qui suit, `lundi(c0 + n + 1)`.
  const premiereCohorte = rows.length ? Math.min(...rows.map((r) => r.cohort)) : null;
  const lisibleLe = (offset: number) =>
    premiereCohorte === null ? null : fmtSemaine(lundiDeSemaine(premiereCohorte + offset + 1));
  // La seconde tuile de retour : S+4, ramenée à la dernière semaine de la fenêtre.
  const semaineLongue = Math.max(1, Math.min(SEMAINE_LONGUE, weeks - 1));
  // Aucun point complet au-delà de S+0 (toujours 100 %) : la courbe ne dirait rien.
  const sansRecul = !courbe.some((p) => p.offset > 0 && p.taux !== null);

  const selecteur = (
    <nav aria-label="Fenêtre de rétention" className="relative flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto py-0.5 text-xs">
      <span className="shrink-0 text-ink-soft">Fenêtre{NBSP}:</span>
      {disponibles.map((w) => (
        <Link
          key={w}
          href={hrefWithQuery("/retention", ecran.query, { weeks: w === defaut ? null : String(w) })}
          aria-current={w === weeks ? "true" : undefined}
          data-testid="retention-fenetre"
          className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
            w === weeks ? "border-perf/50 bg-perf/10 text-perf" : "border-line text-ink-soft hover:bg-panel2"
          }`}
        >
          {w} sem.
        </Link>
      ))}
      <span className="shrink-0 text-ink-faint" data-testid="retention-historique">
        historique conservé{NBSP}: {jours} jours
      </span>
    </nav>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Rétention"
        domain="usages"
        sub={`Les visiteurs identifiés reviennent-ils, et au bout de combien de semaines décrochent-ils${NBSP}?`}
      >
        {selecteur}
      </PageHeader>

      {ignore && (
        <p role="note" className="mb-4 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ignore}
        </p>
      )}

      {/* R2 — une rangée, une population : les visiteurs identifiés. La 4e tuile du
          plan (« Sessions sans identifiant, hors matrice ») attend B35 : non rendue. */}
      <SectionErreur titre="Chiffres clés">
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="retention-kpi">
          <KpiTile
            label="Visiteurs identifiés suivis"
            valeur={cohortes.ok ? totalVisiteurs : null}
            format="count"
            raisonNull={RAISON_ECHEC}
            sensMeilleur="neutre"
            lecture={
              cohortes.ok
                ? `en ${pluriel(rows.length, "cohorte hebdomadaire", "cohortes hebdomadaires")}, sur ${weeks} semaines`
                : undefined
            }
            methode="Visiteurs dont les sessions portent un identifiant de visiteur, sur la fenêtre choisie. Les sessions sans identifiant (dont toutes celles collectées avant le 09/09/2026) n'entrent dans aucune cohorte."
            source={SOURCE_RETENTION}
            categorie={`Rétention · ${weeks} semaines`}
          />
          {tuileRetour({ point: courbe[1], offset: 1, lu: cohortes.ok, weeks, lisibleLe: lisibleLe(1) })}
          {/* S+4, ou la dernière semaine que la fenêtre contient : sous une fenêtre de 4
              semaines (30 jours conservés), S+4 n'avait JAMAIS de valeur — une tuile vide
              par construction (contre-recette du 26/09/2026). */}
          {tuileRetour({
            point: courbe[semaineLongue],
            offset: semaineLongue,
            lu: cohortes.ok,
            weeks,
            lisibleLe: lisibleLe(semaineLongue),
            note:
              semaineLongue < SEMAINE_LONGUE
                ? `S+${SEMAINE_LONGUE} dépasse la fenêtre de ${weeks} semaines : dernière semaine lisible`
                : undefined,
          })}
        </div>
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {!cohortes.ok ? (
        <EchecLecture titre="Cohortes de rétention" />
      ) : rows.length === 0 ? (
        // Une ligne (charte § 3.7) ; la raison de l'absence est lue et survolée.
        <div
          className="card flex items-center gap-1.5 px-4 py-3 text-sm text-ink-soft"
          data-testid="retention-vide"
          title="Les sessions collectées avant le 09/09/2026 ne portent pas d'identifiant de visiteur et n'entrent donc dans aucune cohorte."
        >
          <span aria-hidden="true" className="text-ink-faint">
            ⊘
          </span>
          Aucun visiteur identifié sur la fenêtre.
          <span className="sr-only">
            {" "}
            Les sessions collectées avant le 09/09/2026 ne portent pas d&apos;identifiant de visiteur et n&apos;entrent donc
            dans aucune cohorte.
          </span>
        </div>
      ) : (
        <>
          {/* R3 — hero (7 colonnes) et « Par appareil » (5 colonnes), empilés sous 1024 px. */}
          <div className="mb-4 grid min-w-0 gap-3 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <SectionErreur titre="Courbe de rétention">
                <Figure pleineHauteur
                  titre="Courbe de rétention"
                  id="retention-courbe"
                  meta={<span>{weeks} semaines</span>}
                  alternative={
                    sansRecul
                      ? undefined
                      : {
                          legende: "Rétention pondérée par semaine depuis l'arrivée",
                          colonnes: ["Semaine", "Taux", "Cohortes complètes", "Exclues", "Visiteurs"],
                          lignes: courbe.map((p) => [`S+${p.offset}`, formater("pct", p.taux), p.cohortes, p.exclues, p.taille]),
                        }
                  }
                >
                  {sansRecul ? (
                    <PasEncoreDeRecul lisibleLe={lisibleLe(1)} />
                  ) : (
                    <>
                      <LineTrend
                        data={courbe.map((p) => ({ label: `S+${p.offset}`, value: enPct(p.taux) }))}
                        valueName="Rétention"
                        valueUnit="%"
                        domain={[0, 100]}
                        ariaLabel={`Rétention pondérée par semaine depuis l'arrivée, de S+0 à S+${Math.max(0, colonnes - 1)}, fenêtre de ${weeks} semaines ; un point sans cohorte complète est un trou`}
                      />
                      <Methode>
                        Part des visiteurs de chaque cohorte revenus n semaines après leur arrivée. Moyenne pondérée par la taille des cohortes dont la semaine est terminée{NBSP}; la semaine en
                        cours est exclue. Un point sans cohorte complète est un trou, jamais 0. Source{NBSP}: identifiant de visiteur
                        aléatoire posé par le capteur navigateur.
                      </Methode>
                    </>
                  )}
                </Figure>
              </SectionErreur>
            </div>
            <div className="min-w-0 lg:col-span-5">
              <SectionErreur titre="Par appareil">
                <Figure pleineHauteur
                  titre="Par appareil"
                  id="retention-appareils"
                  etat={parAppareil && !parAppareil.ok ? { kind: "erreur", titre: "Par appareil" } : undefined}
                  meta={<span>ordinateurs, mobiles et tablettes</span>}
                  alternative={
                    parAppareil?.ok && !sansRecul
                      ? {
                          legende: "Rétention pondérée par appareil et par semaine depuis l'arrivée",
                          colonnes: ["Semaine", ...APPAREILS.map((a) => a.libelle)],
                          lignes: Array.from({ length: colonnes }, (_v, o) => [
                            `S+${o}`,
                            ...parAppareil.data.map((r) => formater("pct", courbeRetention(r, semaineCourante, colonnes)[o]?.taux ?? null)),
                          ]),
                        }
                      : undefined
                  }
                >
                  {appareilFiltre ? (
                    <p className="py-1 text-sm text-ink-soft" data-testid="retention-deja-filtre">
                      Déjà filtré sur {appareilFiltre.libelle}{NBSP}: la comparaison par appareil ne
                      s&apos;applique pas.{" "}
                      <Link
                        className="font-medium text-brand hover:underline"
                        href={hrefWithQuery("/retention", { ...ecran.query, filters: appareilFiltre.sans }, { weeks: weeksParam })}
                      >
                        Retirer le filtre
                      </Link>
                    </p>
                  ) : sansRecul ? (
                    <PasEncoreDeRecul lisibleLe={lisibleLe(1)} />
                  ) : parAppareil?.ok ? (
                    (() => {
                      const courbes = parAppareil.data.map((r) => courbeRetention(r, semaineCourante, colonnes));
                      return (
                        <>
                          <LineTrend
                            data={Array.from({ length: colonnes }, (_v, o) => ({
                              label: `S+${o}`,
                              ...Object.fromEntries(APPAREILS.map((a, i) => [a.cle, enPct(courbes[i][o]?.taux ?? null)])),
                            }))}
                            valueName="Rétention"
                            valueUnit="%"
                            domain={[0, 100]}
                            series={APPAREILS.map((a) => ({ cle: a.cle, libelle: a.libelle, role: "categorie" as const }))}
                            ariaLabel={`Rétention pondérée par appareil (${APPAREILS.map((a) => a.libelle.toLowerCase()).join(", ")}) et par semaine depuis l'arrivée, fenêtre de ${weeks} semaines`}
                          />
                          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {APPAREILS.map((a, i) => (
                              <Link
                                key={a.cle}
                                data-testid="retention-appareil-lien"
                                className="font-medium text-brand hover:underline"
                                href={hrefWithQuery("/retention", ecran.query, { device: a.cle, weeks: weeksParam })}
                              >
                                {`Rétention des ${a.libelle.toLowerCase()} (${pluriel(
                                  parAppareil.data[i].reduce((s, r) => s + r.size, 0),
                                  "visiteur",
                                )})`}
                              </Link>
                            ))}
                          </p>
                          {/* Vérifié dans `packages/rum-mobile/src/index.ts` (bootstrapIdentite) :
                              l'identifiant est persisté quand le stockage le permet ; sinon il
                              reste en mémoire et se renouvelle à chaque lancement. */}
                          <Methode>
                            Même calcul que la courbe, par type d&apos;appareil. Les sessions d&apos;appareil inconnu
                            comptent dans la courbe, pas ici. Un visiteur mobile est compté plusieurs fois quand son
                            appareil ne peut pas conserver son identifiant (stockage absent ou plein){NBSP}: il en
                            reçoit un nouveau à chaque lancement.
                          </Methode>
                        </>
                      );
                    })()
                  ) : null}
                </Figure>
              </SectionErreur>
            </div>
          </div>

          {/* R4 — matrice pleine largeur ; défilement interne, colonne « Cohorte » figée. */}
          <SectionErreur titre="Matrice cohorte × semaine">
            <Figure
              titre="Matrice cohorte × semaine"
              id="retention-matrice"
              meta={
                <>
                  <span>
                    {pluriel(rows.length, "cohorte")}, {pluriel(totalVisiteurs, "visiteur identifié", "visiteurs identifiés")}
                  </span>
                  <span>semaines étiquetées par leur lundi</span>
                </>
              }
            >
              <MatriceCohortes
                colonnes={colonnes}
                lignes={rows.map((r) => ({
                  cohorte: `sem. du ${fmtSemaine(lundiDeSemaine(r.cohort))}`,
                  taille: r.size,
                  cellules: cellulesDeCohorte(r, semaineCourante, colonnes),
                }))}
              />
              <Methode>
                Chaque ligne suit les visiteurs arrivés la même semaine{NBSP}; S+0 est leur semaine d&apos;arrivée
                (100{NBSP}%). Cohorte = première semaine d&apos;activité <strong>dans la fenêtre choisie</strong> (au plus {jours}{" "}
                jours conservés), pas la première visite absolue. Les cases vides sont des semaines encore à venir pour
                une cohorte récente. Moins de 10 visiteurs{NBSP}: effectif faible.
              </Methode>
            </Figure>
          </SectionErreur>
        </>
      )}
    </div>
  );
}
