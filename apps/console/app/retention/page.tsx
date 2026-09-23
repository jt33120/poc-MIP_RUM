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
//   - Lire hors du périmètre, ou ignorer la tablette : depuis B31, la lecture lie les
//     apps EFFECTIVES du principal et applique tous les filtres de session (tablette,
//     « Inconnu ») ; le refus « une application à la fois » de F40 est levé (F53) et
//     « Par appareil » compte aussi les tablettes.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { LineTrend } from "@/components/charts/LineTrend";
import { MatriceCohortes } from "@/components/charts/MatriceCohortes";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import {
  cellulesDeCohorte,
  courbeRetention,
  indexSemaine,
  lundiDeSemaine,
  type CohortRow,
  type PointRetention,
} from "@/lib/cohorts";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { retentionCohorts } from "@/lib/queries-cohorts";
import { samplingSessions } from "@/lib/queries-sessions";
import { hrefWithQuery } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

/** Fenêtres proposées, en semaines (§ 5.17.3, R1). */
const FENETRES = [4, 8, 12, 26] as const;
const FENETRE_DEFAUT = 8;

// B31 : la tablette est lue (lecture sur le contrat) ; trois séries, sous le plafond de cinq.
const APPAREILS = [
  { cle: "desktop", libelle: "Ordinateurs" },
  { cle: "mobile", libelle: "Mobiles" },
  { cle: "tablet", libelle: "Tablettes" },
] as const;

// Lundi de la cohorte, lu en UTC : les semaines sont des semaines UTC, et un
// serveur à l'ouest de Greenwich afficherait sinon le dimanche.
const fmtSemaine = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const nombre = (n: number) => n.toLocaleString("fr-FR");
/** Un taux en pourcentage pour la courbe (0..100, une décimale) ; `null` reste un trou. */
const enPct = (t: number | null) => (t === null ? null : Math.round(t * 1000) / 10);

/** Tuile « Retour en S+n » : le point de la courbe à cet offset, ou pourquoi il n'existe pas. */
function tuileRetour(point: PointRetention | undefined, offset: number, lu: boolean) {
  const complet = point && point.taux !== null ? point : null;
  return (
    <KpiTile
      label={`Retour en S+${offset}`}
      valeur={complet ? complet.taux : null}
      format="pct"
      raisonNull={
        !lu
          ? "lecture des cohortes en échec"
          : offset === 1
            ? "pas encore une semaine complète de recul"
            : `pas encore ${offset} semaines complètes de recul`
      }
      sensMeilleur="neutre"
      couverture={complet ? { n: complet.taille, unite: "visiteurs", faibleSous: 30 } : undefined}
      lecture={
        point
          ? `${nombre(point.cohortes)} cohorte${point.cohortes > 1 ? "s" : ""} complète${point.cohortes > 1 ? "s" : ""} (${nombre(point.exclues)} exclue${point.exclues > 1 ? "s" : ""} : semaine incomplète).`
          : undefined
      }
    />
  );
}

export default async function Retention({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/retention");
  if (!ecran.ok) return <FilterProblemNotice title="Rétention" problem={ecran.problem} />;
  // Façade P4/P5 : la tablette y figure (l'appareil filtré se lit dans `device`).
  const f = ecran.deviceFilters;

  // `weeks` est un réglage de l'écran (§ 3.1) : une valeur hors des fenêtres
  // proposées est ignorée ET signalée, jamais appliquée à moitié.
  const brut = typeof sp.weeks === "string" ? sp.weeks : null;
  const lu = brut === null ? null : Number(brut);
  const weeks = lu !== null && (FENETRES as readonly number[]).includes(lu) ? lu : FENETRE_DEFAUT;
  const ignore =
    brut !== null && weeks !== lu
      ? `Réglage d'affichage ignoré : weeks=${brut.slice(0, 40)} (fenêtres proposées : ${FENETRES.join(", ")} semaines).`
      : null;
  /** La fenêtre retenue, telle qu'un lien la reporte (le défaut ne s'écrit pas). */
  const weeksParam = weeks === FENETRE_DEFAUT ? null : String(weeks);
  const semaineCourante = indexSemaine(Date.now());
  const appareilFiltre = APPAREILS.find((a) => a.cle === f.device) ?? null;

  // Chaque lecture est indépendante (F02) : une lecture en échec n'efface que ses sections.
  const [cohortes, echantillonnage, parAppareil] = await Promise.all([
    lire(() => retentionCohorts(f, weeks)),
    // S7 : sessions identifiées lues par les cohortes sur les N semaines choisies.
    lire(() => samplingSessions(f, { population: { lecture: "cohortes", semaines: weeks } })),
    appareilFiltre
      ? Promise.resolve(null)
      : lire(() => Promise.all(APPAREILS.map((a) => retentionCohorts(f, weeks, { appareil: a.cle })))),
  ]);

  const rows: CohortRow[] = cohortes.ok ? cohortes.data : [];
  // Colonnes UTILES : d'une cohorte à la semaine en cours, au plus `weeks`.
  const colonnes = Math.min(weeks, Math.max(0, ...rows.map((r) => semaineCourante - r.cohort + 1)));
  const courbe = courbeRetention(rows, semaineCourante, colonnes);
  const totalVisiteurs = rows.reduce((s, r) => s + r.size, 0);

  const selecteur = (
    <nav aria-label="Fenêtre de rétention" className="relative flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto py-0.5 text-xs">
      <span className="shrink-0 text-ink-soft">Fenêtre :</span>
      {FENETRES.map((w) => (
        <Link
          key={w}
          href={hrefWithQuery("/retention", ecran.query, { weeks: w === FENETRE_DEFAUT ? null : String(w) })}
          aria-current={w === weeks ? "true" : undefined}
          data-testid="retention-fenetre"
          className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
            w === weeks ? "border-perf/50 bg-perf/10 text-perf" : "border-line text-ink-soft hover:bg-panel2"
          }`}
        >
          {w} sem.
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Rétention"
        domain="usages"
        sub="Les visiteurs identifiés reviennent-ils, et au bout de combien de semaines décrochent-ils ?"
      >
        {selecteur}
      </PageHeader>

      {ignore && (
        <p role="note" className="mb-4 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ignore}
        </p>
      )}

      {/* R2 — une rangée, une population : les visiteurs identifiés (sauf la 4e tuile, dite). */}
      <SectionErreur titre="Chiffres clés">
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="retention-kpi">
          <KpiTile
            label="Visiteurs identifiés suivis"
            valeur={cohortes.ok ? totalVisiteurs : null}
            format="count"
            raisonNull="lecture des cohortes en échec"
            sensMeilleur="neutre"
            lecture={
              cohortes.ok
                ? `${nombre(totalVisiteurs)} visiteurs identifiés, en ${nombre(rows.length)} cohorte${rows.length > 1 ? "s" : ""} hebdomadaire${rows.length > 1 ? "s" : ""}, sur ${weeks} semaines.`
                : undefined
            }
          />
          {tuileRetour(courbe[1], 1, cohortes.ok)}
          {tuileRetour(courbe[4], 4, cohortes.ok)}
          <KpiTile
            label="Sessions sans identifiant, hors matrice"
            valeur={null}
            format="count"
            raisonNull="non lu : la lecture est à créer (B35)"
            sensMeilleur="neutre"
          />
        </div>
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {!cohortes.ok ? (
        <EchecLecture titre="Cohortes de rétention" />
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-ink-soft" data-testid="retention-vide">
          Aucun visiteur identifié sur la fenêtre. Les sessions collectées avant le 09/09/2026 ne portent pas
          d&apos;identifiant de visiteur et n&apos;entrent donc dans aucune cohorte.
        </div>
      ) : (
        <>
          {/* R3 — hero (7 colonnes) et « Par appareil » (5 colonnes), empilés sous 1024 px. */}
          <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <SectionErreur titre="Courbe de rétention">
                <Figure
                  titre="Courbe de rétention"
                  id="retention-courbe"
                  etat={colonnes <= 1 ? { kind: "partiel", raison: "une seule semaine observée : pas encore de recul" } : undefined}
                  meta={
                    <>
                      <span>{weeks} semaines, semaines UTC</span>
                      <span>moyenne pondérée par la taille des cohortes dont la semaine est complète ; semaine en cours exclue</span>
                    </>
                  }
                  lecture="Part des visiteurs de chaque cohorte revenus n semaines après leur arrivée. Un point sans cohorte complète est un trou, jamais 0."
                  alternative={{
                    legende: "Rétention pondérée par semaine depuis l'arrivée",
                    colonnes: ["Semaine", "Taux", "Cohortes complètes", "Exclues", "Visiteurs"],
                    lignes: courbe.map((p) => [`S+${p.offset}`, formater("pct", p.taux), p.cohortes, p.exclues, p.taille]),
                  }}
                >
                  <LineTrend
                    data={courbe.map((p) => ({ label: `S+${p.offset}`, value: enPct(p.taux) }))}
                    valueName="Rétention"
                    valueUnit="%"
                    domain={[0, 100]}
                  />
                </Figure>
              </SectionErreur>
            </div>
            <div className="min-w-0 lg:col-span-5">
              <SectionErreur titre="Par appareil">
                <Figure
                  titre="Par appareil"
                  id="retention-appareils"
                  etat={
                    parAppareil && !parAppareil.ok
                      ? { kind: "erreur", titre: "Par appareil" }
                      : !appareilFiltre && colonnes <= 1
                        ? { kind: "partiel", raison: "une seule semaine observée : pas encore de recul" }
                        : undefined
                  }
                  meta={<span>visiteurs identifiés, même calcul que la courbe ; ordinateurs, mobiles et tablettes (appareil inconnu : dans la courbe, pas ici)</span>}
                  lecture="Un visiteur mobile peut être surcompté : son identifiant est tenu en mémoire et renouvelé à chaque lancement (parité C3)."
                  alternative={
                    parAppareil?.ok
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
                    <p className="py-8 text-center text-sm text-ink-soft" data-testid="retention-deja-filtre">
                      Déjà filtré sur {appareilFiltre.libelle.toLowerCase()} : la comparaison par appareil ne
                      s&apos;applique pas.{" "}
                      <Link className="font-medium text-brand hover:underline" href={hrefWithQuery("/retention", ecran.query, { device: null, weeks: weeksParam })}>
                        Retirer le filtre
                      </Link>
                    </p>
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
                          />
                          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {APPAREILS.map((a, i) => (
                              <Link
                                key={a.cle}
                                data-testid="retention-appareil-lien"
                                className="font-medium text-brand hover:underline"
                                href={hrefWithQuery("/retention", ecran.query, { device: a.cle, weeks: weeksParam })}
                              >
                                Rétention des {a.libelle.toLowerCase()} ({nombre(parAppareil.data[i].reduce((s, r) => s + r.size, 0))} visiteurs)
                              </Link>
                            ))}
                          </p>
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
                    {nombre(rows.length)} cohorte{rows.length > 1 ? "s" : ""}, {nombre(totalVisiteurs)} visiteurs identifiés
                  </span>
                  <span>semaines UTC, étiquetées par leur lundi</span>
                </>
              }
              lecture={
                <>
                  Cohorte = première semaine d&apos;activité <strong>dans la fenêtre lue</strong> (au plus 30 jours
                  conservés), pas première visite absolue. S+0 est la semaine de la cohorte (100 %) ; les cases vides
                  sont des semaines encore à venir pour une cohorte récente (matrice triangulaire). Moins de 10
                  visiteurs : effectif faible.
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
            </Figure>
          </SectionErreur>
        </>
      )}
    </div>
  );
}
