// Contexte du résultat (F33, plan § 5.21.3 zone 8 — W-E2 « Volume du résultat » et
// W-E7 « Répartition par … »). Rendu serveur ; seule la série de volume est un îlot
// client (recharts), et elle ne reçoit que des données sérialisables.
//
// POURQUOI DEUX FIGURES SOUS LE RÉSULTAT. Un chiffre seul ne dit pas sur combien de
// lignes il porte, ni d'où elles viennent. Datadog pose ces deux contextes au-dessus
// de toute liste (M3, M4) ; nous les posons dessous — le résultat reste la réponse —
// et nous les NOMMONS : ils comptent la même population que la figure principale,
// jamais « toutes les sessions » ni « toutes les valeurs de la dimension » (CE12).
//
// UN CONTEXTE NE CASSE PAS LA RÉPONSE. Chaque lecture est indépendante, bornée par
// un budget plus court que celui du résultat, et son échec reste local : budget
// dépassé → bandeau « Partiel », lecture en échec → « Lecture en échec » de la
// section, onglets toujours là pour en demander une autre. Dans les deux cas le
// résultat au-dessus reste affiché, et jamais une barre à zéro ne remplace un
// chiffre qu'on n'a pas pu lire (V3).
import Link from "next/link";
import type { ReactNode } from "react";
import { Figure, type AlternativeTexte } from "@/components/charts/Figure";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { metaResultat, pointsDeSerie } from "@/components/explorer/ResultatAnalyse";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import type { ExplorerPlan } from "@/lib/analytics-schema";
import { libelleCle } from "@/lib/explorer-page-params";
import { formater } from "@/lib/fmt-ids";
import type { ExplorerResult } from "@/lib/queries-explorer";
import { bucketLabel, rangeLabel, type ResolvedRange } from "@/lib/query-contract";
import { libelleSeauComplet, type PointSerie, type SerieDef } from "@/lib/series";

/**
 * Ce qu'une lecture de contexte a donné. `budget` n'est pas une panne : c'est une
 * réponse (« je n'ai pas pu lire dans le temps imparti »), et elle se dit autrement
 * qu'un échec — sans quoi on proposerait de réessayer ce qui échouera pareil.
 */
export type LectureContexte =
  | { etat: "ok"; resultat: ExplorerResult }
  | { etat: "budget" }
  | { etat: "echec" };

/** La plage réellement lue, en toutes lettres (même écriture que `ResultatAnalyse`). */
function plageLue(resultat: ExplorerResult): string {
  const range: ResolvedRange = {
    from: resultat.meta.range.from,
    to: resultat.meta.range.to,
    preset: resultat.meta.range.preset as ResolvedRange["preset"],
    bucketSeconds: resultat.meta.range.bucket_seconds,
  };
  return range.preset ? rangeLabel(range, "UTC") : `${rangeLabel(range, "UTC")} (UTC)`;
}

/** Les morceaux de méta (W-E8), rendus comme ceux de la figure principale. */
function Meta({ plan, resultat }: { plan: ExplorerPlan; resultat: ExplorerResult }) {
  return (
    <>
      {metaResultat(plan, resultat.meta, resultat.data).map((m) => (
        <span key={m}>{m}</span>
      ))}
    </>
  );
}

/**
 * Ce qui remplace le dessin quand la lecture n'a pas abouti. Le budget dépassé est
 * un `partiel` : rien n'est cassé, la réponse est simplement hors d'atteinte dans le
 * temps imparti — réduire la période ou les filtres suffit. Une panne est une
 * `erreur`, avec son bouton « Réessayer ». Le RÉSULTAT, lui, reste affiché.
 */
function Manquant({
  lecture,
  phraseBudget,
  titre,
}: {
  lecture: Exclude<LectureContexte, { etat: "ok" }>;
  /** « Volume non lu », « Répartition non lue » — accordé par l'appelant. */
  phraseBudget: string;
  titre: string;
}) {
  if (lecture.etat === "budget") {
    return (
      <EtatSurface
        etat={{
          kind: "partiel",
          raison: `${phraseBudget} : budget de lecture dépassé. Le résultat ci-dessus, lui, a été lu ; réduire la période ou les filtres pour obtenir aussi ce contexte.`,
        }}
      />
    );
  }
  return <EchecLecture titre={titre} compact />;
}

// ─────────────────────────────── W-E2 — Volume ───────────────────────────────

/**
 * « Volume du résultat » — des BARRES par seau, pas une courbe : un comptage se lit
 * en barres, et l'empilement reste réservé aux séries additives MULTIPLES (pas de
 * `StackedBars` à une seule série). Aucune bande de seuil : on ne juge pas un
 * volume, on le situe.
 *
 * L'appelant ne rend cette figure que si la représentation courante n'est pas
 * « Série » : le résultat dirait alors déjà le temps, et deux séries superposées à
 * échelles différentes se liraient l'une pour l'autre.
 */
export function VolumeResultat({
  plan,
  unite,
  lecture,
  zoomHref,
}: {
  /** Plan DÉRIVÉ (`planDeVolume`) : c'est lui que la méta décrit, pas celui du résultat. */
  plan: ExplorerPlan;
  /** Unité de la population comptée (« vues », « occurrences ») : axe et alternative la portent. */
  unite: string;
  lecture: LectureContexte;
  /** Gabarit `{from}` / `{to}` du zoom sur un seau (§ 3.3). */
  zoomHref?: string;
}) {
  const titre = "Volume du résultat";
  if (lecture.etat !== "ok") {
    return (
      <Figure id="volume-resultat" titre={titre}>
        <Manquant lecture={lecture} phraseBudget="Volume non lu" titre={titre} />
      </Figure>
    );
  }

  const { meta, data } = lecture.resultat;
  const plage = plageLue(lecture.resultat);
  const metaFigure = <Meta plan={plan} resultat={lecture.resultat} />;
  if (data.samples === 0) {
    return (
      <Figure
        id="volume-resultat"
        titre={titre}
        meta={metaFigure}
        etat={{ kind: "vide", population: "ligne correspondant à la requête", plage }}
      />
    );
  }

  const { grille, points, groupes } = pointsDeSerie(meta, data);
  const seauSecondes = meta.range.bucket_seconds;
  const cle = groupes[0]?.cle ?? "s0";
  const series: SerieDef[] = [{ cle, libelle: unite, role: "principale", forme: "barres", additive: true }];
  const ariaLabel = `${titre} : ${unite} par seau, ${grille.length} seaux de ${bucketLabel(seauSecondes)} (UTC)`;
  // Un dénombrement : un seau sans ligne vaut réellement 0 — ce n'est pas un trou.
  const parT = new Map(points.map((p: PointSerie) => [Date.parse(p.t), p]));
  const alternative: AlternativeTexte = {
    legende: `${titre} — ${grille.length} seaux de ${bucketLabel(seauSecondes)}, heures UTC`,
    colonnes: ["Seau (UTC)", unite],
    lignes: grille.map((t) => {
      const valeur = parT.get(Date.parse(t))?.[cle];
      return [libelleSeauComplet(t, seauSecondes, "UTC"), formater("count", typeof valeur === "number" ? valeur : 0)];
    }),
  };

  return (
    <Figure
      id="volume-resultat"
      titre={titre}
      meta={metaFigure}
      alternative={alternative}
      lecture={`Contexte : le nombre de ${unite} qui composent le résultat, seau par seau. Aucun seuil ne s'applique à un volume.`}
    >
      <ThresholdSeries
        grille={grille}
        points={points}
        series={series}
        format="count"
        seauSecondes={seauSecondes}
        fuseau="UTC"
        zoomHref={zoomHref}
        hauteur={120}
        ariaLabel={ariaLabel}
      />
    </Figure>
  );
}

// ──────────────────────────── W-E7 — Répartition ────────────────────────────

/** Un onglet de dimension ; indisponible, il reste visible AVEC sa raison. */
export interface OngletRepartition {
  dimension: string;
  label: string;
  courant: boolean;
  /** `null` : la dimension n'est pas portée par le jeu — `raison` dit pourquoi. */
  href: string | null;
  raison: string | null;
}

/**
 * Onglets de la répartition (grammaire `Breakdown`). Une dimension que le jeu ne
 * porte pas reste VISIBLE, désactivée, et sa raison est écrite SOUS la rangée — pas
 * seulement en `title`, qui n'est annoncé ni au clavier ni au toucher. L'onglet
 * désactivé reste atteignable (`tabIndex`) et pointe sa raison (`aria-describedby`).
 */
function Onglets({ onglets }: { onglets: OngletRepartition[] }) {
  const indisponibles = onglets.filter((o) => o.href === null && o.raison);
  const raisonId = (dimension: string) => `repartition-raison-${dimension}`;
  return (
    <>
      {/* `relative` : une rangée d'onglets peut défiler à 390 px, et tout ce qui y est
          positionné doit l'être par rapport à elle, jamais par rapport à la page. */}
      <nav aria-label="Répartir par" className="relative mb-3 flex flex-wrap gap-1" data-testid="repartition-onglets">
        {onglets.map((onglet) =>
          onglet.href ? (
            <Link
              key={onglet.dimension}
              href={onglet.href}
              scroll={false}
              aria-current={onglet.courant ? "page" : undefined}
              data-testid={`repartition-tab-${onglet.dimension}`}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
                onglet.courant
                  ? "border-accent/50 bg-accent/10 text-accent-ink"
                  : "border-line bg-panel2 text-ink-soft hover:text-ink"
              }`}
            >
              {onglet.label}
            </Link>
          ) : (
            <span
              key={onglet.dimension}
              aria-disabled="true"
              tabIndex={0}
              aria-describedby={onglet.raison ? raisonId(onglet.dimension) : undefined}
              title={onglet.raison ?? undefined}
              data-testid={`repartition-tab-${onglet.dimension}`}
              className="cursor-not-allowed rounded-md border border-line/60 bg-panel2/50 px-2.5 py-1 text-xs font-medium text-ink-soft line-through focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              {onglet.label}
            </span>
          ),
        )}
      </nav>
      {indisponibles.length > 0 && (
        <ul className="mb-3 space-y-0.5 text-xs text-ink-soft" data-testid="repartition-indisponibles">
          {indisponibles.map((onglet) => (
            <li key={onglet.dimension} id={raisonId(onglet.dimension)} className="min-w-0 break-words">
              {onglet.label} : {onglet.raison}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * « Répartition par <dimension> » — un `RankBar` horizontal sur la MÊME population
 * que le résultat. La part de chaque valeur est écrite parce que la mesure
 * s'additionne ; « Inconnu » est une ligne à part, jamais fondue dans une valeur
 * réelle, et son lien se compile en `is_null` (§ 3.3).
 */
export function RepartitionResultat({
  plan,
  dimensionLabel,
  unite,
  notice,
  onglets,
  lecture,
  lienValeur,
  limite,
}: {
  /** Plan DÉRIVÉ (`planDeRepartition`) : la méta décrit ce qui est compté ici. */
  plan: ExplorerPlan;
  /** Libellé de la dimension courante (« Navigateur », « Pays estimé »). */
  dimensionLabel: string;
  unite: string;
  /** Ce que vaut la dimension (provenance, limites) : `BREAKDOWN_NOTICES`. */
  notice: string;
  onglets: OngletRepartition[];
  lecture: LectureContexte;
  /** Lien d'une valeur : la même analyse, plus sa condition. `null` = groupe inconnu. */
  lienValeur: (valeur: string | null) => string;
  limite: number;
}) {
  const titre = `Répartition par ${dimensionLabel.toLowerCase()}`;
  const enveloppe = (contenu: ReactNode, metaFigure?: ReactNode, lectureFigure?: string) => (
    <div data-testid="repartition-resultat" data-dimension={plan.groupBy[0]} className="min-w-0">
      <Figure id="repartition-resultat" titre={titre} meta={metaFigure} lecture={lectureFigure}>
        <Onglets onglets={onglets} />
        {contenu}
      </Figure>
    </div>
  );

  if (lecture.etat !== "ok") {
    return enveloppe(<Manquant lecture={lecture} phraseBudget="Répartition non lue" titre={titre} />);
  }

  const { meta, data } = lecture.resultat;
  const plage = plageLue(lecture.resultat);
  const metaFigure = <Meta plan={plan} resultat={lecture.resultat} />;
  if (data.groups.length === 0) {
    return enveloppe(
      <EtatSurface etat={{ kind: "vide", population: "ligne correspondant à la requête", plage }} />,
      metaFigure,
    );
  }

  const total = data.total;
  const connu = (v: number | null): v is number => v !== null && Number.isFinite(v);
  const lignes: RankDatum[] = data.groups.map((groupe) => {
    const nom = libelleCle(groupe.key);
    const part = connu(groupe.value) && connu(total) && total > 0 ? groupe.value / total : null;
    const compte = `${formater("count", groupe.samples)} lignes`;
    return {
      label: nom,
      // Le libellé complet reste lisible au survol quand la colonne le tronque.
      title: nom,
      value: groupe.value,
      display: formater("count", groupe.value),
      sub: part === null ? compte : `${formater("pct", part)} du total · ${compte}`,
      href: lienValeur(groupe.key[0] ?? null),
    };
  });

  const lectures = [
    `Chaque part est rapportée au total de toute la population (${formater("count", total)} ${unite}), valeurs non affichées comprises.`,
    meta.truncated_groups
      ? `Seules les ${limite} valeurs les plus nombreuses sont affichées ; le total, lui, porte sur toute la population.`
      : null,
    notice,
  ].filter((ligne): ligne is string => ligne !== null);

  return enveloppe(
    <RankBar data={lignes} legende={`${titre} — ${unite} par valeur`} emptyLabel={`Aucune ligne sur ${plage}.`} />,
    metaFigure,
    lectures.join(" "),
  );
}
