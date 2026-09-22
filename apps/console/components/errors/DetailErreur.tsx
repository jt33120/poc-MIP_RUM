// Blocs du détail d'un groupe d'erreurs (F20, plan § 5.3.3). Rendu serveur.
//
// UN SEUL CONTENU, DEUX SUPPORTS. Le panneau (`panel=error:<fp>`, § 3.5) montre les
// blocs 1 à 5 ; la page `/errors/[fingerprint]` les montre tous. Les deux lisent la
// MÊME plage que l'écran d'où l'on vient : le panneau n'a pas de fenêtre propre.
//
// CE QUI DISPARAÎT (§ 5.3.4). La rangée de SEPT tuiles `ErrorStat` du détail cède
// la place à une PHRASE D'IMPACT (ce que l'erreur touche, en français) suivie de
// quatre tuiles ; `ObservedTrend`, sans axe, cède la place à des barres sur la
// grille du contrat (un compte discret : la barre dit zéro là où une ligne
// interpolerait).
//
// DEUX NOMBRES, DEUX PROPOSITIONS. `S sessions touchées` vient d'`ErrorImpact`
// (toutes les sessions portant l'erreur, avec ou sans vue) ; `x %` vient de
// `partSessionsTouchees(f, ref)` (sessions DE LA BASE portant l'erreur, base =
// sessions avec au moins une vue). Les écrire dans la même fraction ferait lire
// S / T, qui n'est pas la part : ils restent dans deux propositions séparées.
import Link from "next/link";
import { ContrastBars } from "@/components/charts/ContrastBars";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EchecLecture } from "@/components/states/SectionErreur";
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { formater } from "@/lib/fmt-ids";
import { fmtDate } from "@/lib/format";
import type { Lecture } from "@/lib/lecture";
import { partTouchees } from "@/lib/perf-domain";
import type {
  ErrorGroupRow,
  ErrorOccurrenceRow,
  ErrorTrendPoint,
  PartSessionsTouchees,
  ReleasesDuGroupe,
} from "@/lib/queries-errors";
import type { Annotation, PointSerie, SerieDef } from "@/lib/series";
import { libelleSeauComplet } from "@/lib/series";
import {
  BASE_MIN_TEST,
  REGLE_SURREPRESENTATION,
  TOUCHES_MIN_TEST,
  TOUCHES_VALEUR_MIN,
} from "@/lib/stats/surrepresentation";

/** Part lue pour le groupe, ou le refus du contrat (un filtre que les vues ne portent pas). */
export type PartGroupe = { lu: PartSessionsTouchees } | { refus: string };

const pct = (v: number | null) => formater("pct", v);
const compte = (v: number | null) => formater("count", v);

// ───────────────────────────── Bloc 1 : « Voir le rejeu » ─────────────────────────────

/**
 * Première occurrence de la fenêtre ayant un rejeu enregistré : le bouton de
 * premier niveau du bloc 1 (Datadog error → replay). Aucune : pas de bouton, et la
 * raison est écrite — un bouton mort vaut moins qu'une phrase.
 */
export function premiereAvecRejeu(occurrences: readonly ErrorOccurrenceRow[]): ErrorOccurrenceRow | null {
  return occurrences.find((o) => o.links.replay && o.session_id) ?? null;
}

export function BoutonRejeu({ occurrences, appId }: { occurrences: readonly ErrorOccurrenceRow[]; appId: string }) {
  const premiere = premiereAvecRejeu(occurrences);
  if (!premiere) {
    return (
      <p className="text-xs text-ink-soft" data-testid="rejeu-absent">
        Aucune occurrence de la fenêtre n&apos;a de rejeu.
      </p>
    );
  }
  const session = encodeURIComponent(premiere.session_id!);
  const href = `/sessions/${session}?app=${encodeURIComponent(appId)}&tab=replay&at=${premiere.ts.getTime()}`;
  return (
    <Link href={href} className="btn-accent px-3 py-1.5 text-xs" data-testid="voir-le-rejeu">
      Voir le rejeu
    </Link>
  );
}

// ───────────────────────── Bloc 2 : phrase d'impact + 4 tuiles ─────────────────────────

/**
 * « N occurrences sur <plage>, touchant S sessions et V visiteurs ; x % des T
 * sessions avec au moins une vue. »
 *
 * Inconnu reste « Inconnu » (V3), jamais 0 : une erreur backend ne touche pas zéro
 * session, elle n'en touche AUCUNE CONNUE. Une part non calculable est remplacée
 * par sa raison, jamais par « 0 % ».
 */
export function PhraseImpact({
  group,
  plage,
  part,
  hrefSessions,
}: {
  group: ErrorGroupRow;
  plage: string;
  part: Lecture<PartGroupe>;
  /** Sessions de la fenêtre portant cette erreur (`/sessions?...`) ; `null` : pas de destination. */
  hrefSessions: string | null;
}) {
  const lu = part.ok && "lu" in part.data ? part.data.lu : null;
  const valeur = !part.ok
    ? { valeur: null, raison: "part non calculable : lecture en échec" }
    : "refus" in part.data
      ? { valeur: null, raison: `part non calculable : ${part.data.refus}` }
      : partTouchees(part.data.lu, plage);
  const sessions = group.occurrences === 0 ? 0 : group.sessions_affected;
  const nombre = (v: number | null) => (v === null ? "Inconnu" : compte(v));

  return (
    <p className="mb-3 text-sm leading-relaxed text-ink" data-testid="phrase-impact">
      <strong className="font-semibold">{compte(group.occurrences)} occurrences</strong> sur {plage}, touchant{" "}
      <strong className="font-semibold">
        {hrefSessions && sessions !== null ? (
          <Link href={hrefSessions} className={ERROR_LINK}>
            {nombre(sessions)} sessions
          </Link>
        ) : (
          `${nombre(sessions)} sessions`
        )}
      </strong>{" "}
      et <strong className="font-semibold">{nombre(group.visitors_affected)} visiteurs</strong>
      {valeur.valeur !== null && lu ? (
        <>
          {" ; "}
          <strong className="font-semibold">{pct(valeur.valeur)}</strong> des {compte(lu.base)} sessions avec au moins
          une vue.
        </>
      ) : (
        <> ; {valeur.raison}.</>
      )}
    </p>
  );
}

/**
 * Quatre tuiles (§ 5.3.4) : Occurrences, Sessions touchées, Visiteurs touchés,
 * Couverture d'identité. Aucune couleur de verdict : aucun seuil publié n'existe
 * pour un compte d'erreurs (R-S).
 *
 * Les `testid` des trois premières sont ceux que la console porte depuis P5.1 :
 * les e2e du suivi d'erreurs les désignent, et le détail ne change pas d'adresse
 * parce qu'il change de tuile.
 */
export function TuilesDetailErreur({ group, plage }: { group: ErrorGroupRow; plage: string }) {
  const sessions = group.occurrences === 0 ? 0 : group.sessions_affected;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-detail-erreur">
      <KpiTile
        label={`Occurrences · ${plage}`}
        valeur={group.occurrences}
        format="count"
        sensMeilleur="bas"
        testid="detail-occurrences"
        lecture="somme des occurrences : une erreur répétée compte chaque fois"
      />
      <KpiTile
        label="Sessions touchées"
        valeur={sessions}
        raisonNull="Inconnu : aucune occurrence rattachée à une session (erreurs backend, par exemple)"
        format="count"
        sensMeilleur="bas"
        testid="detail-sessions"
      />
      <KpiTile
        label="Visiteurs touchés"
        valeur={group.visitors_affected}
        raisonNull="Inconnu : aucune occurrence rattachée à un visiteur connu"
        format="count"
        sensMeilleur="bas"
        testid="detail-users"
      />
      <KpiTile
        label="Couverture identité"
        valeur={group.identity_coverage}
        raisonNull="Inconnue : aucune occurrence sur la fenêtre"
        format="pct"
        sensMeilleur="haut"
        testid="detail-couverture"
        lecture="part des occurrences rattachées à un visiteur ou à une identité"
      />
    </div>
  );
}

// ─────────────────────────── Bloc 3 : versions touchées ───────────────────────────

/**
 * « Première release vue » / « Dernière » : ce qui distingue une RÉGRESSION (le
 * groupe est apparu avec une version récente) d'une DETTE (il traîne depuis une
 * version ancienne). Les deux dates sont NON BORNÉES par la fenêtre, comme
 * « Première vue » : sur 24 h, toute erreur serait « apparue hier ».
 */
export function VersionsTouchees({ releases }: { releases: Lecture<ReleasesDuGroupe> }) {
  if (!releases.ok) return <EchecLecture compact titre="Versions touchées" />;
  const { premiere, derniere, distinctes } = releases.data;
  return (
    <section className="card mb-4 p-4" aria-labelledby="versions-touchees" data-testid="versions-touchees">
      <h2 id="versions-touchees" className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Versions touchées
      </h2>
      {premiere === null && derniere === null ? (
        <p className="mt-2 text-sm text-ink-soft">Release non déclarée : aucune occurrence de ce groupe ne porte de version.</p>
      ) : (
        <>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-ink-soft">Première release vue</dt>
              <dd className="min-w-0 break-all font-mono text-ink" data-testid="premiere-release">
                {premiere ? `${premiere.release} · ${fmtDate(premiere.ts)}` : "release non déclarée"}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-ink-soft">Dernière</dt>
              <dd className="min-w-0 break-all font-mono text-ink" data-testid="derniere-release">
                {derniere ? `${derniere.release} · ${fmtDate(derniere.ts)}` : "release non déclarée"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-ink-soft">
            {distinctes > 1
              ? `${compte(distinctes)} versions distinctes ont porté ce groupe`
              : "une seule version a porté ce groupe"}{" "}
            — depuis toujours, hors fenêtre. Une première release récente se lit comme une régression, une première
            release ancienne comme une dette.
          </p>
        </>
      )}
    </section>
  );
}

// ───────────────────── Bloc 4 : occurrences dans le temps (barres) ─────────────────────

export function OccurrencesDansLeTemps({
  trend,
  grille,
  plage,
  bucketLabel,
  seauSecondes,
  annotations,
  annotationsIndisponibles,
  zoomHref,
}: {
  trend: readonly ErrorTrendPoint[];
  /** Débuts de seau du contrat, ISO UTC (`bucketStarts`). */
  grille: string[];
  plage: string;
  bucketLabel: string;
  seauSecondes: number;
  annotations: Annotation[];
  annotationsIndisponibles?: string;
  zoomHref?: string;
}) {
  const titre = "Occurrences dans le temps";
  const parSeau = new Map(trend.map((p) => [new Date(p.bucket).getTime(), p.occurrences]));
  const valeurs = grille.map((t) => parSeau.get(Date.parse(t)) ?? 0);
  const total = valeurs.reduce((s, v) => s + v, 0);
  if (total === 0) {
    return <Figure titre={titre} id="detail-erreur-temps" etat={{ kind: "vide", population: "erreur", plage }} />;
  }
  const series: SerieDef[] = [{ cle: "occ", libelle: "Occurrences", role: "principale", forme: "barres", additive: true }];
  const points: PointSerie[] = grille.map((t, i) => ({ t, occ: valeurs[i] }));

  return (
    <Figure
      titre={titre}
      id="detail-erreur-temps"
      meta={
        <>
          <span>seau de {bucketLabel}</span>
          <span>{compte(total)} occurrences sur {plage}</span>
        </>
      }
      lecture="Barres : un compte discret. Un seau sans occurrence vaut zéro, et la barre le dit — une ligne l'aurait interpolé. Même fenêtre que l'écran : le panneau n'a pas de plage à lui."
      alternative={{
        legende: `Occurrences par seau de ${bucketLabel} sur ${plage}`,
        colonnes: ["Seau (UTC)", "Occurrences"],
        lignes: grille.map((t, i) => [libelleSeauComplet(t, seauSecondes, "UTC"), valeurs[i]]),
      }}
    >
      <ThresholdSeries
        grille={grille}
        points={points}
        series={series}
        format="count"
        seauSecondes={seauSecondes}
        fuseau="UTC"
        hauteur={180}
        annotations={annotations}
        annotationsIndisponibles={annotationsIndisponibles}
        zoomHref={zoomHref}
        ariaLabel={`Occurrences de ce groupe par seau de ${bucketLabel} sur ${plage}`}
      />
    </Figure>
  );
}

// ───────── Bloc 5 : « Qu'ont en commun les sessions touchées ? » (B3, P*.6) ─────────

export interface LigneRepartition {
  valeur: string;
  occurrences: number;
}

/** Dimensions du repli, dans l'ordre d'affichage. */
export const DIMENSIONS_REPLI = [
  { cle: "route", libelle: "Route" },
  { cle: "release", libelle: "Release" },
  { cle: "device", libelle: "Appareil" },
] as const;

/**
 * Répartition des occurrences AFFICHÉES par dimension (`sum(occurrences)`, V1 :
 * une ligne qui porte 12 répétitions pèse 12, pas 1). Ordre décroissant, « Inconnu »
 * pour une valeur absente — jamais écartée : un champ non déclaré est une
 * information, et l'écarter gonflerait les parts des autres.
 */
export function repartitionOccurrences(
  occurrences: readonly ErrorOccurrenceRow[],
  cle: (typeof DIMENSIONS_REPLI)[number]["cle"],
): LigneRepartition[] {
  const valeurDe = (o: ErrorOccurrenceRow): string =>
    (cle === "route" ? o.route : cle === "release" ? o.release : o.device_type) ?? "Inconnu";
  const totaux = new Map<string, number>();
  for (const o of occurrences) {
    const v = valeurDe(o);
    totaux.set(v, (totaux.get(v) ?? 0) + o.occurrences);
  }
  return [...totaux.entries()]
    .map(([valeur, occ]) => ({ valeur, occurrences: occ }))
    .sort((a, b) => b.occurrences - a.occurrences || a.valeur.localeCompare(b.valeur, "fr"));
}

/**
 * Bloc 5 tant que **B3** n'est pas livré (§ 6.3, § 0.5).
 *
 * B3 rendrait, par valeur de dimension, le nombre de sessions de la POPULATION DE
 * BASE : sans lui, aucune part de base, donc aucun rapport de contraste et aucun
 * test de sur-représentation (P*.6). La figure ne dessine donc PAS de barres à
 * zéro : `ContrastBars` rend son état « non disponible » avec la raison, et le
 * repli honnête montre ce qu'on sait vraiment — la répartition des occurrences
 * AFFICHÉES, qui n'est pas celle de la population et le dit dans son titre.
 *
 * Le test de P*.6 est publié ici même à l'état « pas de test », avec sa règle et
 * ses volumes minimaux : l'utilisateur sait ce qui sera cherché, et pourquoi ça ne
 * l'est pas encore.
 */
export function QuOntEnCommun({
  occurrences,
  plage,
  touchees,
  hrefValeur,
}: {
  /** Les occurrences affichées (≤ 100), pas la population. */
  occurrences: readonly ErrorOccurrenceRow[];
  plage: string;
  /** Sessions touchées connues (`ErrorImpact`) : l'effectif du refus de test. */
  touchees: number | null;
  /** Filtrer l'écran sur une valeur ; `null` : pas de destination pour cette dimension. */
  hrefValeur: (cle: (typeof DIMENSIONS_REPLI)[number]["cle"], valeur: string) => string | null;
}) {
  const titre = "Qu'ont en commun les sessions touchées ?";
  const total = occurrences.reduce((s, o) => s + o.occurrences, 0);
  const manqueTest =
    touchees === null
      ? `pas de test : sessions touchées inconnues, ${TOUCHES_MIN_TEST} requises`
      : `pas de test : ${compte(touchees)} sessions touchées, ${TOUCHES_MIN_TEST} requises`;

  if (occurrences.length === 0 || total === 0) {
    return <Figure titre={titre} id="detail-erreur-commun" etat={{ kind: "vide", population: "erreur", plage }} />;
  }

  return (
    <Figure
      titre={titre}
      id="detail-erreur-commun"
      meta={
        <>
          <span data-testid="commun-titre-repli">
            Répartition des {compte(occurrences.length)} dernières occurrences affichées (pas de la population)
          </span>
          <span>{compte(total)} occurrences comptées</span>
        </>
      }
      lecture={
        <>
          Ces parts sont celles des occurrences AFFICHÉES, les plus récentes : elles ne disent pas ce que la population
          de la fenêtre a en commun. Comparer les touchés à une base exige, par valeur, le nombre de sessions de la
          population de base, que les lectures ne rendent pas encore (B3) : aucune barre de base n&apos;est dessinée
          plutôt qu&apos;une barre à zéro. Une répartition est une observation, pas une cause.
        </>
      }
    >
      <ContrastBars
        dimensionLibelle="Route, release et appareil"
        populationTouchee="sessions avec cette erreur"
        populationBase="toutes les sessions de la fenêtre"
        lignes={[]}
        indisponible="base de comparaison non lue (B3)"
      />
      <p className="mt-3 text-xs text-ink-soft" data-testid="commun-pas-de-test">
        {manqueTest} · règle prévue : {REGLE_SURREPRESENTATION} ; volumes minimaux {TOUCHES_MIN_TEST} sessions touchées,{" "}
        {TOUCHES_VALEUR_MIN} par valeur, {BASE_MIN_TEST} sessions de base.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {DIMENSIONS_REPLI.map((dim) => {
          const lignes = repartitionOccurrences(occurrences, dim.cle);
          const data: RankDatum[] = lignes.map((l) => {
            const href = hrefValeur(dim.cle, l.valeur);
            return {
              label: l.valeur,
              value: l.occurrences,
              display: `${compte(l.occurrences)} (${pct(l.occurrences / total)})`,
              ...(href && l.valeur !== "Inconnu" ? { href } : {}),
            };
          });
          return (
            <div key={dim.cle} className="min-w-0" data-testid={`repli-${dim.cle}`}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{dim.libelle}</h3>
              <RankBar
                data={data}
                max={total}
                labelWidth="8rem"
                legende={`${dim.libelle} des ${compte(occurrences.length)} dernières occurrences affichées`}
                emptyLabel="Aucune occurrence affichée."
              />
            </div>
          );
        })}
      </div>
    </Figure>
  );
}
