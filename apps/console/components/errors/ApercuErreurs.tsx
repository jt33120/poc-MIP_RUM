// Tuiles et hero de `/errors` (F18, plan § 5.3.1-5.3.2). Rendu serveur : la page
// lit, ce module présente — un état par lecture, jamais un zéro pour une panne.
//
// LA RANGÉE DE TUILES EST UNE POPULATION : les occurrences d'erreurs de la fenêtre
// (§ 3.12). Quatre questions, quatre tuiles, aucune couleur de verdict sur les
// COMPTES (R-S : aucun seuil publié n'existe pour un compte d'erreurs). Seule la PART
// des sessions touchées porte une note, celle de la règle MIP `BROWSER_ERRORS`,
// écrite dans la tuile (amendement de R-S du 29/09/2026) :
//   - « Occurrences » : `sum(occurrences)` (V1), jamais un compte de lignes ;
//   - « Sessions touchées » : sessions distinctes portant une occurrence ; INCONNU
//     quand aucune occurrence n'est rattachée à une session (erreurs backend), jamais 0 ;
//   - « Part des sessions touchées » : numérateur INCLUS dans un dénominateur nommé
//     (sessions avec au moins une vue), `null` dès que l'échantillonnage les biaise (CP15) ;
//   - « Groupes apparus sur la période » : première occurrence conservée dans la fenêtre.
//
// LE HERO EMPILE PARCE QUE DES OCCURRENCES S'ADDITIONNENT : 4 groupes les plus
// fréquents + « Autres groupes (somme) » = 5 séries au plus (P14). La légende nomme
// chaque groupe par son message et son empreinte (plus jamais « ● Error » ×5).
import Link from "next/link";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { StackedBars, type SerieEmpilee } from "@/components/charts/StackedBars";
import { EchecLecture } from "@/components/states/SectionErreur";
import type { CouverturePrecedente } from "@/lib/comparaison";
import { formater } from "@/lib/fmt-ids";
import { pluriel } from "@/lib/format";
import type { SectionLue } from "@/lib/lecture";
import { autresGroupes, libelleGroupeErreur, partTouchees } from "@/lib/perf-domain";
import type { GroupeFrequent, PartSessionsTouchees, TotauxErreurs } from "@/lib/queries-errors";
import { libelleSeauComplet, type Annotation, type FenetreCollecte, type PointSerie } from "@/lib/series";
import { FAIBLE_SOUS_PROPORTION, ecartProportions, intervalleWilson } from "@/lib/stats/incertitude";

// Nombre de groupes dessinés dans le hero : dans `lib/error-view.ts`, que le
// chargeur de l'écran lit aussi (il en demande autant à la base).
import { GROUPES_DU_HERO } from "@/lib/error-view";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { RangeeKpi } from "@/components/charts/RangeeKpi";
export { GROUPES_DU_HERO };

/** Part lue, ou le refus du contrat (un filtre que les pages vues ne portent pas). */
export type PartLue = { lu: PartSessionsTouchees } | { refus: string };

/** Une lecture de la période précédente : `null` hors `cmp=prev`. */
type Precedente<T> = SectionLue<T> | null;

const LECTURE_OCCURRENCES = "somme des occurrences : une erreur répétée compte chaque fois";
const RAISON_SESSIONS_INCONNUES =
  "Inconnu : aucune occurrence rattachée à une session (erreurs backend, par exemple)";
const LECTURE_NOUVEAUX =
  "première occurrence conservée dans la fenêtre ; un groupe plus ancien que la rétention dont les premières occurrences ont été purgées peut apparaître comme nouveau";

/** La couverture d'une tuile quand la lecture de la période précédente a échoué. */
const PRECEDENTE_EN_ECHEC: CouverturePrecedente = { etat: "inconnue", raison: "lecture de la période précédente en échec" };

/** Sessions touchées d'une population : 0 réel sans occurrence, `null` (inconnu) sans session rattachée. */
function sessionsTouchees(t: TotauxErreurs["totals"]): number | null {
  return t.occurrences === 0 ? 0 : t.sessions_affected;
}

/** Valeur précédente d'une tuile, et sa couverture : une lecture en échec n'est jamais « pas de mesure ». */
function precedente<T>(
  lu: Precedente<T>,
  couverture: CouverturePrecedente | undefined,
  valeur: (data: T) => number | null,
): { precedent?: number | null; couverturePrecedente?: CouverturePrecedente } {
  if (lu === null) return {};
  if (!lu.ok) return { precedent: null, couverturePrecedente: PRECEDENTE_EN_ECHEC };
  return { precedent: valeur(lu.data), couverturePrecedente: couverture };
}

export function TuilesErreurs({
  plage,
  totaux,
  totauxPrec,
  part,
  partPrec,
  nouveaux,
  nouveauxPrec,
  reference,
  couvErreurs,
  couvPart,
  hrefSessions,
  hrefNouveaux,
}: {
  /** Plage lue, dans le fuseau de l'app (« 24 h », « du 17/09 10:00 au … »). */
  plage: string;
  totaux: SectionLue<TotauxErreurs>;
  totauxPrec: Precedente<TotauxErreurs>;
  part: SectionLue<PartLue>;
  partPrec: Precedente<PartLue>;
  nouveaux: SectionLue<number>;
  nouveauxPrec: Precedente<number>;
  /** « vs 24 h précédentes (…) » en `cmp=prev` ; `null` sinon (aucun delta). */
  reference: string | null;
  couvErreurs?: CouverturePrecedente;
  couvPart?: CouverturePrecedente;
  /** Liste triée par sessions touchées ; `null` quand la liste ne sait pas le faire (mode issues). */
  hrefSessions: string | null;
  /** Liste restreinte aux groupes apparus ; `null` en mode issues. */
  hrefNouveaux: string | null;
}) {
  const ref = reference ?? undefined;
  const partCourante = part.ok && "lu" in part.data ? part.data.lu : null;
  const valeurPart =
    !part.ok ? null : "refus" in part.data ? { valeur: null, raison: `part non calculable : ${part.data.refus}` } : partTouchees(part.data.lu, plage);
  const partAvant = partPrec?.ok && "lu" in partPrec.data ? partPrec.data.lu : null;
  const valeurPartAvant = partAvant ? partTouchees(partAvant).valeur : null;
  // Couvertures de la période précédente, dites UNE fois au-dessus des tuiles.
  const couvertures = ref
    ? [
        precedente(totauxPrec, couvErreurs, () => null).couverturePrecedente,
        precedente(partPrec, couvPart, () => null).couverturePrecedente,
        precedente(nouveauxPrec, couvErreurs, () => null).couverturePrecedente,
      ]
    : [];

  return (
    <section aria-label={`Erreurs sur ${plage}`} className="mb-6" data-testid="kpi-erreurs">
      <p className="mb-2 text-xs text-ink-soft" data-testid="kpi-erreurs-plage">
        Occurrences d&apos;erreurs sur {plage}
      </p>
      <RangeeKpi couvertures={couvertures} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totaux.ok ? (
          <>
            <KpiTile
              label="Occurrences"
              valeur={totaux.data.totals.occurrences}
              format="count"
              sensMeilleur="bas"
              serie={totaux.data.trend.map((p) => p.occurrences)}
              reference={ref}
              {...precedente(totauxPrec, couvErreurs, (d) => d.totals.occurrences)}
              methode={LECTURE_OCCURRENCES}
            />
            <KpiTile
              label="Sessions touchées"
              valeur={sessionsTouchees(totaux.data.totals)}
              raisonNull={RAISON_SESSIONS_INCONNUES}
              format="count"
              sensMeilleur="bas"
              reference={ref}
              {...precedente(totauxPrec, couvErreurs, (d) => sessionsTouchees(d.totals))}
              lecture={
                totaux.data.totals.session_coverage == null
                  ? undefined
                  : `${formater("pct", totaux.data.totals.session_coverage)} des occurrences rattachées à une session`
              }
              href={hrefSessions ?? undefined}
            />
          </>
        ) : (
          <div className="col-span-2">
            <EchecLecture compact titre="Occurrences et sessions touchées" />
          </div>
        )}

        {!part.ok || valeurPart === null ? (
          <EchecLecture compact titre="Part des sessions touchées" />
        ) : (
          <KpiTile
            label="Part des sessions touchées"
            valeur={valeurPart.valeur}
            raisonNull={valeurPart.raison ?? undefined}
            format="pct"
            sensMeilleur="bas"
            {...(valeurPart.valeur !== null
              ? { noteMip: { mesure: "BROWSER_ERRORS", valeur: valeurPart.valeur, texte: formater("pct", valeurPart.valeur) } }
              : {})}
            reference={ref}
            {...precedente(partPrec, couvPart, () => valeurPartAvant)}
            couverture={
              partCourante && valeurPart.valeur !== null
                ? { n: partCourante.base, unite: "sessions avec vue", faibleSous: FAIBLE_SOUS_PROPORTION }
                : undefined
            }
            intervalle={
              partCourante && valeurPart.valeur !== null
                ? (intervalleWilson(partCourante.touchees, partCourante.base) ?? undefined)
                : undefined
            }
            ecart={
              partCourante && partAvant && valeurPart.valeur !== null && valeurPartAvant !== null
                ? ecartProportions(partCourante.touchees, partCourante.base, partAvant.touchees, partAvant.base)
                : undefined
            }
            lecture={
              partCourante && valeurPart.valeur !== null
                ? `${formater("count", partCourante.touchees)} sessions avec vue et au moins une erreur, sur ${formater("count", partCourante.base)} sessions avec au moins une vue`
                : undefined
            }
          />
        )}

        {nouveaux.ok ? (
          <KpiTile
            label="Groupes apparus sur la période"
            valeur={nouveaux.data}
            format="count"
            sensMeilleur="bas"
            reference={ref}
            {...precedente(nouveauxPrec, couvErreurs, (d) => d)}
            methode={LECTURE_NOUVEAUX}
            href={hrefNouveaux ?? undefined}
          />
        ) : (
          <EchecLecture compact titre="Groupes apparus sur la période" />
        )}
      </RangeeKpi>
    </section>
  );
}

/** Une ligne de l'alternative du hero : seau, chaque série, total. */
function ligneAlternative(t: string, seauSecondes: number, valeurs: number[], total: number): (string | number)[] {
  return [libelleSeauComplet(t, seauSecondes, FUSEAU_AFFICHAGE), ...valeurs, total];
}

export function HeroGroupesErreurs({
  plage,
  bucketLabel,
  seauSecondes,
  grille,
  totaux,
  top,
  hrefGroupe,
  plusieursApps,
  annotations,
  annotationsIndisponibles,
  zoomHref,
  fenetresCollecte,
}: {
  plage: string;
  bucketLabel: string;
  seauSecondes: number;
  /** Débuts de seau du contrat, ISO UTC (`bucketStarts`) : la grille de `trend`. */
  grille: string[];
  totaux: SectionLue<TotauxErreurs>;
  top: SectionLue<{ groupes: GroupeFrequent[] }>;
  /** Destination d'un segment : le groupe (panneau `panel=error:` quand F20 l'ouvrira). */
  hrefGroupe: (g: GroupeFrequent) => string;
  /** L'écran lit plusieurs apps : la légende nomme l'app de chaque groupe. */
  plusieursApps: boolean;
  annotations: Annotation[];
  annotationsIndisponibles: string | null;
  zoomHref: string;
  /** Fenêtres hors collecte (`sectionFenetresCollecte`) : un seau interrompu est hachuré « non mesuré », pas une barre à 0. */
  fenetresCollecte?: readonly FenetreCollecte[];
}) {
  const titre = "Occurrences dans le temps, par groupe";
  if (!totaux.ok || !top.ok) {
    return (
      <div className="mb-6">
        <Figure titre={titre} id="hero-erreurs" etat={{ kind: "erreur", titre }} />
      </div>
    );
  }
  const total = totaux.data.totals.occurrences;
  if (total === 0) {
    return (
      <div className="mb-6">
        <Figure titre={titre} id="hero-erreurs" etat={{ kind: "vide", population: "erreur", plage }} />
      </div>
    );
  }

  // Grille du contrat : la tendance y est posée par début de seau (jamais par rang).
  const parSeau = new Map(totaux.data.trend.map((p) => [new Date(p.bucket).getTime(), p.occurrences]));
  const tendance = grille.map((t) => parSeau.get(Date.parse(t)) ?? 0);
  const groupes = top.data.groupes.slice(0, GROUPES_DU_HERO);
  const autres = autresGroupes(
    tendance,
    groupes.map((g) => g.series),
  );
  // ≤ 4 groupes dans la fenêtre : rien d'autre à empiler, pas de série « Autres ».
  const avecAutres = autres.some((v) => v > 0);

  const series: SerieEmpilee[] = [
    ...groupes.map((g, i) => ({
      cle: `g${i}`,
      libelle: libelleGroupeErreur({
        message: g.message,
        fingerprint: g.ref.fingerprint,
        app_id: plusieursApps ? g.ref.app_id : null,
      }),
      // Le message ENTIER en infobulle de la légende : le libellé en retire « Uncaught »
      // et coupe au-delà de 90 caractères.
      libelleComplet: g.message ?? undefined,
      categorieIndex: i,
      href: hrefGroupe(g),
    })),
    // « Autres groupes » n'est pas un groupe : aucune destination.
    ...(avecAutres ? [{ cle: "autres", libelle: "Autres groupes (somme)", ton: "neutre" as const, motif: "plein" as const }] : []),
  ];
  const points: PointSerie[] = grille.map((t, k) => ({
    t,
    ...Object.fromEntries(groupes.map((g, i) => [`g${i}`, g.series[k] ?? 0])),
    ...(avecAutres ? { autres: autres[k] } : {}),
  }));

  return (
    <div className="mb-6">
      <Figure
        titre={titre}
        id="hero-erreurs"
        meta={
          <>
            <span data-testid="hero-erreurs-legende-titre">
              {groupes.length > 1
                ? `${groupes.length} groupes les plus fréquents sur ${plage}`
                : `${groupes.length} groupe sur ${plage}`}
            </span>
            <span>tranches de {bucketLabel}</span>
            <span>{pluriel(total, "occurrence")} en tout</span>
          </>
        }
        // Recette du 26/09/2026 : quatre lignes de méthode sous le graphique. Il en reste
        // l'essentiel — ce qu'est « Autres », ce que fait un clic — en une phrase.
        lecture={
          <>
            Les {GROUPES_DU_HERO} groupes les plus fréquents de la période, quel que soit leur statut
            {avecAutres ? ", et la somme des autres" : ""}. Un clic sur un segment ouvre son groupe ; sur une tranche,
            zoome sur sa plage.{" "}
            <Link href="#groupes-erreurs" className="text-perf underline-offset-2 hover:underline">
              Tous les groupes
            </Link>
          </>
        }
        alternative={{
          legende: `Occurrences par tranche de ${bucketLabel} et par groupe, sur ${plage}`,
          colonnes: ["Période", ...series.map((s) => s.libelle), "Total"],
          lignes: grille.map((t, k) =>
            ligneAlternative(
              t,
              seauSecondes,
              [...groupes.map((g) => g.series[k] ?? 0), ...(avecAutres ? [autres[k]] : [])],
              tendance[k],
            ),
          ),
        }}
      >
        <StackedBars
          grille={grille}
          points={points}
          series={series}
          format="count"
          annotations={annotations}
          annotationsIndisponibles={annotationsIndisponibles ?? undefined}
          seauSecondes={seauSecondes}
          fuseau={FUSEAU_AFFICHAGE}
          zoomHref={zoomHref}
          hauteur={240}
          fenetresCollecte={fenetresCollecte}
          ariaLabel={`Occurrences d'erreurs par tranche de ${bucketLabel} sur ${plage}, ${series.length} séries empilées`}
        />
      </Figure>
    </div>
  );
}
