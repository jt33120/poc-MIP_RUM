// Acquisition (F48, plan § 5.16 ; sur le contrat depuis B31 → F53) — « D'où
// arrivent les sessions, et par quelles pages entrent-elles ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une part cachée : l'anneau d'avant filtrait les canaux à 0 (`Donut`), et
//     l'absence de recherche disparaissait. Les CINQ canaux sont toujours rendus,
//     dans un ordre fixe, zéros compris, avec leur part de TOUTES les sessions lues.
//   - Une fenêtre qui n'est pas la sienne : depuis B31, la lecture est celle du
//     contrat (`[from, to)`, apps effectives, tablette et « Inconnu » compris) ; la
//     méta de chaque figure écrit la plage lue (S1, S3).
//   - Un plafond muet : au-delà de 20 000 sessions, les canaux, les pages d'entrée,
//     les référents et la série portent sur les 20 000 PREMIÈRES, prises d'abord
//     par application puis par identifiant (sous « toutes les apps », elles peuvent
//     toutes venir d'une seule) ; c'est dit dans la méta de CHAQUE figure qui les
//     compte et dans le bandeau des tuiles (S4), et un écart à la période
//     précédente se tait (il mesurerait le plafond).
//   - Un geste qui ne mène nulle part : le canal n'est pas un filtre de la console,
//     ses barres ne sont pas cliquables ; la route d'entrée, elle, ouvre les
//     sessions PASSÉES par cette route (la recherche porte sur toute la session).
//
// RECETTE DU 26/09/2026. Les notes qui justifiaient une limite technique (« barres
// non cliquables : le canal n'est pas un filtre de la console », « la recherche de
// sessions ne sait pas se limiter à l'entrée », « 20 000 au plus ») ne s'affichent
// plus : une barre sans lien ne promet rien, et la précision utile est repliée sous
// la figure (`Methode`), ou derrière l'aide « ? » d'une tuile (`methode=`). La
// « période précédente incomplète » se dit une fois par rangée (`RangeeKpi`). La
// table des pages d'entrée n'a plus qu'un lien par ligne, sur le nom de la route.
import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { HeroReading } from "@/components/SupervisionHero";
import { Figure, MethodeRepliee as Methode } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { RangeeKpi } from "@/components/charts/RangeeKpi";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { routeCoupable, tronquerMilieu } from "@/components/Sankey";
import { StackedBars } from "@/components/charts/StackedBars";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { TableDefilante } from "@/components/TableDefilante";
import {
  CHANNELS,
  LIBELLE_CANAL,
  PLAFOND_ACQUISITION,
  TOP_REFERENTS,
  lignesCanaux,
  partDuTotal,
  partHorsDirect,
  referentsTronques,
  type AcquisitionReport,
  type Channel,
  type EntreeParCanal,
  type PointCanaux,
} from "@/lib/acquisition";
import { type CouverturePrecedente } from "@/lib/comparaison";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { type SectionLue } from "@/lib/lecture";
import { chargerAcquisition } from "@/lib/chargeurs/acquisition";
import { chargerEcran } from "@/lib/ecran";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "@/lib/lecture-usages";
import { categorie } from "@/lib/palette";
import { hrefWithQuery, previousRange, type AnalyticsQuery } from "@/lib/query-contract";
import { fenetresLues, libelleSeauComplet, type FenetreCollecte } from "@/lib/series";
import { referencePrecedente } from "@/lib/sessions-kpi";
import { ecartProportions } from "@/lib/stats/incertitude";
import { gabaritZoom } from "@/lib/view-state";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";

export const dynamic = "force-dynamic";

// Un canal est une catégorie, pas un verdict : couleurs de CATEGORIELLE, dans
// l'ordre fixe des canaux (le « Site référent » n'est pas « bon », l'« Interne »
// pas « à surveiller »). Le même index sert aux barres et à la série.
const INDEX_CANAL: Record<Channel, number> = { direct: 4, search: 0, social: 2, referral: 1, internal: 6 };
const COULEUR_CANAL: Record<Channel, string> = {
  direct: categorie(INDEX_CANAL.direct),
  search: categorie(INDEX_CANAL.search),
  social: categorie(INDEX_CANAL.social),
  referral: categorie(INDEX_CANAL.referral),
  internal: categorie(INDEX_CANAL.internal),
};

/** La population de l'écran, nommée dans chaque méta (S1, R-P). */
const POPULATION = "sessions ayant vu au moins une page sur la période";

/** Au-delà, une route d'entrée est coupée AU MILIEU (son début et sa fin l'identifient). */
const ROUTE_AFFICHEE_MAX = 48;

const PLAFOND_TEXTE = formater("count", PLAFOND_ACQUISITION);
// L'ordre de sélection est celui de la lecture (`order by p.app_id, p.session_id`,
// lib/queries-acquisition.ts) : d'abord l'application, puis l'identifiant de session.
const TEXTE_PLAFOND = `plafond de ${PLAFOND_TEXTE} sessions atteint : canaux, pages d'entrée et référents portent sur les ${PLAFOND_TEXTE} premières sessions, prises d'abord par application puis par identifiant de session, pas les plus récentes ; sur plusieurs applications, elles peuvent toutes venir d'une seule`;
/** Le même plafond, dans la méta de chaque figure qui compte ces sessions (S4 : à côté du chiffre). */
const META_PLAFOND = `plafond atteint : ${PLAFOND_TEXTE} premières sessions seulement, par application puis par identifiant`;

/** « 1 session », « 20 000 sessions ». */
const compte = (n: number, un: string, plusieurs: string) => `${formater("count", n)} ${n > 1 ? plusieurs : un}`;

/** « 540 · 62,1 % » : le compte et sa part de toutes les sessions lues. */
const compteEtPart = (sessions: number, total: number) =>
  `${formater("count", sessions)} · ${formater("pct", partDuTotal(sessions, total))}`;

/** Sessions hors direct et hors interne : le numérateur de « Part hors direct ». */
const horsDirect = (r: AcquisitionReport) =>
  r.total - (r.channels.find((c) => c.channel === "direct")?.sessions ?? 0) - (r.channels.find((c) => c.channel === "internal")?.sessions ?? 0);

/** Ce que la rangée de tuiles sait de la période précédente (`cmp=prev`, F53). */
interface Comparaison {
  precedent: AcquisitionReport | null;
  reference: string;
  /** Couverture des SOURCES (rétention, début de collecte…), ou pourquoi la période précédente manque. */
  sources: CouverturePrecedente[];
}

export default async function Acquisition({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/acquisition.ts`) lit filtres et sections (F02 :
  // une panne n'efface que ses sections ; S7 : même population que la lecture).
  const ecran = await chargerEcran(ECRANS.acquisition, chargerAcquisition, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Acquisition" problem={ecran.problem} />;
  const query = ecran.query;
  // Comparaison (F06, F53) : `cmp=prev` compare les tuiles à la période précédente,
  // seulement si celle-ci est COMPLÈTE (§ 3.2) ; défaut de l'écran : aucune.
  const { prev, lecture, lecturePrev, serie, echantillonnage, couvertures, fenetresCollecte } = ecran;
  const comparaison: Comparaison | null =
    prev && lecturePrev
      ? {
          precedent: lecturePrev.ok ? lecturePrev.data : null,
          reference: referencePrecedente(previousRange(query.range)),
          // Une lecture en échec n'est pas « aucune mesure » : la tuile dit pourquoi elle se tait.
          sources: lecturePrev.ok ? couvertures : [{ etat: "inconnue", raison: "la période précédente n'a pas pu être lue" }],
        }
      : null;

  const plage = ecran.label;
  const dansPhrase = plageDansPhrase(query.range, plage);
  // Au plafond, TOUTES les figures ci-dessous portent sur le même sous-ensemble de
  // sessions : chacune le dit dans sa méta, pas seulement la rangée de tuiles.
  const auPlafond = lecture.ok && plafondAtteint(lecture.data.total, PLAFOND_ACQUISITION);
  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      {auPlafond && (
        <span className="font-medium text-warn-ink" data-testid="acquisition-plafond-meta">
          {META_PLAFOND}
        </span>
      )}
      <span>Population : {POPULATION}</span>
      <span>{plage}</span>
    </>
  );
  // Élargir la fenêtre est le seul geste utile devant un vide (le canal n'est pas un filtre).
  const elargir = gesteElargir("/acquisition", query, Date.now());

  return (
    <div className="animate-fade-up">
      <PageHeader title="Acquisition" domain="usages" sub="D'où arrivent les sessions, et par quelles pages entrent-elles ?" />

      <SectionErreur titre="Chiffres clés">
        {lecture.ok ? (
          <TuilesAcquisition rep={lecture.data} comparaison={comparaison} />
        ) : (
          <div className="mb-6">
            <EchecLecture titre="Chiffres clés" />
          </div>
        )}
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* A3 — le hero (7 colonnes) et ce que « direct » recouvre (5 colonnes). */}
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <SectionErreur titre="Sessions par canal d'entrée">
            <Figure
              id="acquisition-canaux"
              titre="Sessions par canal d'entrée"
              meta={meta(lecture.ok ? compte(lecture.data.total, "session", "sessions") : undefined)}
              etat={
                !lecture.ok
                  ? { kind: "erreur", titre: "Sessions par canal d'entrée" }
                  : lecture.data.total === 0
                    ? { kind: "vide", population: "session", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture="Longueur = part de toutes les sessions de la période ; les canaux gardent toujours le même ordre, zéros compris."
            >
              {lecture.ok && <BarresCanaux rep={lecture.data} plage={plage} />}
            </Figure>
          </SectionErreur>
        </div>
        <section
          className="card flex min-w-0 flex-col p-4 sm:p-5 lg:col-span-5"
          data-testid="acquisition-direct"
          aria-labelledby="acquisition-direct-titre"
        >
          <h2 id="acquisition-direct-titre" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Ce que « direct » recouvre
          </h2>
          <ul className="mb-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-soft">
            <li>
              <strong className="font-semibold text-ink">Direct ou référent masqué</strong> : pas de référent reçu : saisie de
              l&apos;adresse, favori, application, ou site d&apos;origine qui retire son adresse (politique{" "}
              <code className="font-mono">Referrer-Policy</code>).
            </li>
            <li>
              <strong className="font-semibold text-ink">Interne</strong> : le référent est le site lui-même (même domaine que
              la page d&apos;entrée).
            </li>
            <li>
              <strong className="font-semibold text-ink">Recherche</strong> et <strong className="font-semibold text-ink">réseaux sociaux</strong> :
              site d&apos;origine reconnu dans une liste de moteurs et de réseaux ; tout autre site est un{" "}
              <strong className="font-semibold text-ink">site référent</strong>.
            </li>
            <li>
              <strong className="font-semibold text-ink">Campagnes</strong> : paramètres de campagne (UTM) non captés : l&apos;URL est
              nettoyée par le SDK. Une campagne arrive donc sous le canal de son référent.
            </li>
          </ul>
          <HeroReading>
            Un « direct » élevé ne prouve pas un trafic fidèle : il peut venir de sites qui masquent leur adresse.{" "}
            {query.filters.includeBots ? "Les robots sont inclus : la barre de filtres le demande." : "Les robots sont exclus."}
          </HeroReading>
        </section>
      </div>

      {/* A4 — B31 : la route d'entrée est lue, croisée par canal. */}
      <div className="mb-6">
        <SectionErreur titre="Pages d'entrée par canal">
          <Figure
            id="acquisition-entrees"
            titre="Pages d'entrée par canal"
            meta={meta(
              lecture.ok
                ? `${compte(lecture.data.entrees.length, "route affichée", "routes affichées")} sur ${compte(
                    lecture.data.routesEntree,
                    "route d'entrée",
                    "routes d'entrée",
                  )}`
                : undefined,
            )}
            etat={
              !lecture.ok
                ? { kind: "erreur", titre: "Pages d'entrée par canal" }
                : lecture.data.entrees.length === 0
                  ? { kind: "vide", population: "page d'entrée", plage: dansPhrase, geste: elargir }
                  : undefined
            }
          >
            {lecture.ok && (
              <>
                <TableEntrees rep={lecture.data} query={query} />
                {/* Deux rendus, deux lectures : le fond des cellules n'existe que dans le
                    tableau (au-delà de 640 px) ; en deçà, un volet par canal. */}
                <p className="mt-3 hidden text-xs leading-relaxed text-ink-soft sm:block" data-testid="acquisition-entrees-lecture">
                  Une ligne par page d&apos;entrée, les plus fréquentes d&apos;abord ; le fond d&apos;une cellule montre sa
                  part de la ligne. Cliquez une route pour voir ses sessions.
                </p>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft sm:hidden" data-testid="acquisition-entrees-lecture-mobile">
                  Un volet par canal : ouvrez-le pour voir ses pages d&apos;entrée, les plus fréquentes d&apos;abord.
                  Touchez une route pour voir ses sessions.
                </p>
                <Methode>
                  La page d&apos;entrée est la première page vue de la session sur la période. Une route ouvre toutes
                  les sessions qui l&apos;ont vue, y compris celles qui y sont arrivées plus tard dans leur visite.
                </Methode>
              </>
            )}
          </Figure>
        </SectionErreur>
      </div>

      <div className="mb-6">
        <SectionErreur titre="Sites référents">
          <Figure
            id="acquisition-referents"
            titre="Sites référents"
            meta={
              meta(lecture.ok ? `${compte(lecture.data.referrers.length, "site affiché", "sites affichés")} (${TOP_REFERENTS} au plus)` : undefined)
            }
            etat={!lecture.ok ? { kind: "erreur", titre: "Sites référents" } : undefined}
            lecture="Part = sessions arrivées de ce site, sur toutes les sessions de la période (pas sur les seuls sites affichés) ; longueur relative au premier site."
          >
            {lecture.ok && <BarresReferents rep={lecture.data} dansPhrase={dansPhrase} plage={plage} />}
          </Figure>
        </SectionErreur>
      </div>

      {/* A6 — B31 : chaque session dans le seau de sa 1re vue. */}
      <SectionErreur titre="Canaux dans le temps">
        <SerieCanaux
          serie={serie}
          query={query}
          meta={meta(`tranches de ${ecran.bucketLabel}`)}
          dansPhrase={dansPhrase}
          plafond={auPlafond}
          zoomHref={gabaritZoom(hrefWithQuery("/acquisition", query, { period: null, from: "{from}", to: "{to}" }), sp)}
          fenetresCollecte={fenetresLues(fenetresCollecte)}
        />
      </SectionErreur>
    </div>
  );
}

/**
 * A2 — trois tuiles, une population (sessions lues) ; puis le plafond, s'il est
 * atteint (S4). La rangée (`RangeeKpi`) dit une fois au-dessus d'elle pourquoi ses
 * écarts se taisent, au lieu de trois fois la même phrase sous chaque tuile.
 */
function TuilesAcquisition({ rep, comparaison }: { rep: AcquisitionReport; comparaison: Comparaison | null }) {
  const tronques = referentsTronques(rep);
  const part = partHorsDirect(rep);
  const prec = comparaison?.precedent ?? null;
  // Deux plafonds bornent les comptes : les sessions (20 000) et les hôtes (20). Un
  // compte borné d'un côté ou de l'autre ne se compare pas.
  const plafondSessions = [
    { atteint: plafondAtteint(rep.total, PLAFOND_ACQUISITION), raison: `plafond de ${PLAFOND_TEXTE} sessions atteint sur la période affichée` },
    { atteint: prec !== null && plafondAtteint(prec.total, PLAFOND_ACQUISITION), raison: `plafond de ${PLAFOND_TEXTE} sessions atteint sur la période précédente` },
  ];
  const plafondHotes = [
    {
      atteint: prec !== null && referentsTronques(prec),
      raison: `${TOP_REFERENTS} sites comptés sur la période précédente, le maximum : son compte est un minimum`,
    },
  ];
  /**
   * Props de comparaison d'une tuile : rien hors `cmp=prev` ; une période précédente
   * illisible rend `precedent: null` et la couverture dit pourquoi (jamais « pas de
   * mesure », qui affirmerait un vide qu'on n'a pas lu). L'effectif précédent
   * (`n`) porte la règle d'échantillon faible.
   */
  const comparer = (precedent: (p: AcquisitionReport) => number | null, plafonds: { atteint: boolean; raison: string }[]) =>
    comparaison
      ? {
          precedent: prec ? precedent(prec) : null,
          reference: comparaison.reference,
          couverturePrecedente: couvertureDeTuile(comparaison.sources, plafonds, prec?.total ?? null),
        }
      : {};
  const sessions = comparer((p) => p.total, plafondSessions);
  const horsDirectCmp = comparer(partHorsDirect, plafondSessions);
  const referents = tronques ? {} : comparer((p) => p.referrers.length, [...plafondSessions, ...plafondHotes]);
  return (
    <div className="mb-6">
      <RangeeKpi
        couvertures={[sessions.couverturePrecedente, horsDirectCmp.couverturePrecedente, referents.couverturePrecedente]}
        className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <KpiTile
          label="Sessions"
          valeur={rep.total}
          format="count"
          methode={`Chaque session compte une fois, à sa première page vue sur la période. Au-delà de ${PLAFOND_TEXTE} sessions, l'écran porte sur les ${PLAFOND_TEXTE} premières, et le dit.`}
          {...sessions}
        />
        <KpiTile
          label="Part hors direct"
          valeur={part}
          format="pct"
          raisonNull="aucune session sur la période : pas de part à calculer"
          lecture="Recherche, réseaux sociaux et sites référents."
          methode="Sessions arrivées d'un moteur de recherche, d'un réseau social ou d'un autre site (ni directes, ni internes), rapportées à toutes les sessions de la période."
          {...horsDirectCmp}
          ecart={prec && rep.total > 0 ? ecartProportions(horsDirect(rep), rep.total, horsDirect(prec), prec.total) : undefined}
        />
        {tronques ? (
          // « 20 » serait faux : la lecture n'en renvoie que 20, il peut y en avoir plus.
          <KpiLibelle
            label="Référents externes distincts"
            texte={`≥ ${TOP_REFERENTS}`}
            lecture={`Seuls les ${TOP_REFERENTS} sites les plus fréquents sont comptés.`}
          />
        ) : (
          <KpiTile
            label="Référents externes distincts"
            valeur={rep.referrers.length}
            format="count"
            lecture="Moteurs, réseaux sociaux et autres sites."
            methode="Sites externes distincts d'où arrivent les sessions de la période : moteurs de recherche, réseaux sociaux et sites référents."
            {...referents}
          />
        )}
      </RangeeKpi>
      {plafondAtteint(rep.total, PLAFOND_ACQUISITION) && (
        <div className="mt-3" data-testid="acquisition-plafond">
          <EtatSurface etat={{ kind: "partiel", raison: TEXTE_PLAFOND }} />
        </div>
      )}
    </div>
  );
}

/** Le hero : les cinq canaux, zéros compris. Un segment unique par barre : un 0 n'a AUCUNE largeur. */
function BarresCanaux({ rep, plage }: { rep: AcquisitionReport; plage: string }) {
  const data: RankDatum[] = lignesCanaux(rep).map((l) => {
    const libelle = LIBELLE_CANAL[l.channel];
    return {
      label: libelle,
      value: l.sessions,
      segments: [{ value: l.sessions, color: COULEUR_CANAL[l.channel], label: libelle }],
      display: compteEtPart(l.sessions, rep.total),
      title: `${libelle} : ${compte(l.sessions, "session", "sessions")}, ${formater("pct", l.part)} de toutes les sessions`,
    };
  });
  return (
    <RankBar
      data={data}
      max={rep.total}
      labelWidth="12rem"
      legende={`Sessions par canal d'entrée (nombre · part de toutes les sessions), ${plage}`}
    />
  );
}

/** « Sessions passées par cette route » : la recherche exacte de `/sessions` (qf=route). */
const lienSessions = (query: AnalyticsQuery, route: string) => hrefWithQuery("/sessions", query, { qf: "route", q: route });

/**
 * A4 — route d'entrée × canal. Au-delà de 640 px, une table (défilement interne) ;
 * en dessous, une liste par canal repliable (§ 5.16.3) : cinq colonnes de comptes
 * ne tiennent pas à 390 px.
 */
function TableEntrees({ rep, query }: { rep: AcquisitionReport; query: AnalyticsQuery }) {
  return (
    <>
      {/* Entre `sm` et 40 rem, le tableau défile : c'est signalé (TableDefilante,
          dont la zone reste `relative` pour la légende `sr-only`). */}
      <TableDefilante className="hidden sm:block" testId="acquisition-entrees-table" label="Pages d'entrée par canal">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Pages d&apos;entrée par canal : route, sessions par canal, total</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-1 pr-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Route d&apos;entrée
              </th>
              {CHANNELS.map((c) => (
                <th key={c} scope="col" className="px-1 py-1 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  {LIBELLE_CANAL[c]}
                </th>
              ))}
              <th scope="col" className="py-1 pl-2 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rep.entrees.map((e) => (
              <tr key={e.route} className="border-b border-line/60 last:border-0" data-testid="acquisition-entree">
                {/* Le nom EST le lien (recette du 26/09/2026) : « Sessions passées par
                    cette route » se répétait sur chaque ligne, sous la route. `text-left` :
                    un `th` centre par défaut, la route flottait au-dessus de son
                    sous-libellé. La route passe à la ligne plutôt que d'être coupée à la
                    largeur ; au-delà de `ROUTE_AFFICHEE_MAX`, coupée au milieu. */}
                <th scope="row" className="w-1/4 min-w-[10rem] max-w-0 py-1.5 pr-3 text-left align-top font-normal">
                  <RouteEntree route={e.route} href={lienSessions(query, e.route)} />
                </th>
                {CHANNELS.map((c) => (
                  <CelluleCanal key={c} entree={e} canal={c} />
                ))}
                <td className="py-1.5 pl-2 text-right text-xs font-semibold tabular-nums text-ink">{formater("count", e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDefilante>
      <div className="space-y-2 sm:hidden" data-testid="acquisition-entrees-liste">
        {CHANNELS.map((c) => {
          const lignes = rep.entrees.filter((e) => e.parCanal[c] > 0).sort((a, b) => b.parCanal[c] - a.parCanal[c]);
          // Le résumé porte le total du CANAL, celui de sa barre dans le hero — jamais
          // la somme des seules routes affichées (540 ici contre 900 là-haut se
          // contrediraient). La part couverte par les routes affichées est dite dessous.
          const totalCanal = rep.channels.find((l) => l.channel === c)?.sessions ?? 0;
          const couvert = rep.entrees.reduce((s, e) => s + e.parCanal[c], 0);
          return (
            <details key={c} className="rounded-lg border border-line px-3 py-2">
              <summary className="flex min-w-0 cursor-pointer items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COULEUR_CANAL[c] }} />
                  <span className="truncate text-ink">{LIBELLE_CANAL[c]}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-soft" data-testid="acquisition-canal-total">
                  {compte(totalCanal, "session", "sessions")}
                </span>
              </summary>
              {lignes.length === 0 ? (
                <p className="mt-2 text-xs text-ink-soft">Aucune des routes affichées n&apos;a reçu d&apos;entrée par ce canal.</p>
              ) : (
                <>
                  {couvert < totalCanal && (
                    <p className="mt-2 text-xs text-ink-soft" data-testid="acquisition-canal-couverture">
                      Routes affichées : {formater("count", couvert)} de ces {formater("count", totalCanal)} sessions (
                      {formater("pct", partDuTotal(couvert, totalCanal))}) ; les autres sont entrées par une route non affichée ou
                      inconnue.
                    </p>
                  )}
                  <ul className="mt-2 space-y-1.5">
                    {lignes.map((e) => (
                      <li key={e.route} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                        <RouteEntree route={e.route} href={lienSessions(query, e.route)} />
                        <span className="shrink-0 tabular-nums text-ink">{formater("count", e.parCanal[c])}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          );
        })}
      </div>
    </>
  );
}

/**
 * Une route d'entrée, lien vers les sessions passées par elle. Entière dans
 * l'infobulle et dans le nom annoncé quand l'affichage la coupe au milieu.
 */
function RouteEntree({ route, href }: { route: string; href: string }) {
  const affichee = tronquerMilieu(route, ROUTE_AFFICHEE_MAX);
  return (
    <Link
      href={href}
      className="min-w-0 font-mono text-xs text-ink [overflow-wrap:anywhere] hover:text-accent hover:underline"
      title={`Sessions passées par ${route}`}
      aria-label={affichee !== route ? route : undefined}
    >
      {routeCoupable(affichee)}
    </Link>
  );
}


/** Une cellule : le compte, et un fond proportionnel à sa part de la ligne (jamais 0 % dessiné). */
function CelluleCanal({ entree, canal }: { entree: EntreeParCanal; canal: Channel }) {
  const n = entree.parCanal[canal];
  const part = entree.total > 0 ? n / entree.total : 0;
  return (
    <td
      className="relative px-1 py-1.5 text-right text-xs tabular-nums"
      title={`${entree.route} · ${LIBELLE_CANAL[canal]} : ${formater("count", n)} sur ${formater("count", entree.total)} sessions entrées par cette route`}
    >
      {n > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 right-1 rounded-sm opacity-20"
          style={{ width: `calc(${(part * 100).toFixed(1)}% - 0.5rem)`, backgroundColor: COULEUR_CANAL[canal] }}
        />
      )}
      <span className={`relative ${n > 0 ? "text-ink" : "text-ink-faint"}`}>{formater("count", n)}</span>
    </td>
  );
}

/** A5 — les hôtes référents externes, avec leur canal en badge et leur part de TOUTES les sessions. */
function BarresReferents({ rep, dansPhrase, plage }: { rep: AcquisitionReport; dansPhrase: string; plage: string }) {
  const data: RankDatum[] = rep.referrers.map((r) => ({
    label: r.host,
    value: r.sessions,
    color: COULEUR_CANAL[r.channel],
    display: compteEtPart(r.sessions, rep.total),
    sub: (
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COULEUR_CANAL[r.channel] }} />
        {LIBELLE_CANAL[r.channel]}
      </span>
    ),
    title: `${r.host} (${LIBELLE_CANAL[r.channel]}) : ${compte(r.sessions, "session", "sessions")}, ${formater(
      "pct",
      partDuTotal(r.sessions, rep.total),
    )} de toutes les sessions`,
  }));
  return (
    <RankBar
      data={data}
      labelWidth="14rem"
      emptyLabel={`Aucun site référent externe sur ${dansPhrase} (trafic direct ou interne).`}
      legende={`Sites référents (nombre · part de toutes les sessions ; canal), ${plage}`}
    />
  );
}

/**
 * A6 — canaux dans le temps : barres empilées (des sessions s'additionnent), sur la
 * grille du contrat, zéros compris. Mêmes sessions que les canaux du hero : au
 * plafond, la série porte sur les mêmes 20 000 premières et le dit.
 */
function SerieCanaux({
  serie,
  query,
  meta,
  dansPhrase,
  plafond,
  zoomHref,
  fenetresCollecte,
}: {
  serie: SectionLue<PointCanaux[]>;
  query: AnalyticsQuery;
  meta: ReactNode;
  dansPhrase: string;
  plafond: boolean;
  zoomHref: string;
  /** Fenêtres hors collecte (`sectionFenetresCollecte`) : un seau interrompu est hachuré « non mesuré », pas une barre à 0. */
  fenetresCollecte?: readonly FenetreCollecte[];
}) {
  const titre = "Canaux dans le temps";
  if (!serie.ok) return <Figure id="acquisition-serie" titre={titre} meta={meta} etat={{ kind: "erreur", titre }} />;
  const points = serie.data;
  const total = points.reduce((s, p) => s + CHANNELS.reduce((t, c) => t + p.canaux[c], 0), 0);
  const seau = query.range.bucketSeconds;
  return (
    <Figure
      id="acquisition-serie"
      titre={titre}
      meta={meta}
      etat={total === 0 ? { kind: "vide", population: "session", plage: dansPhrase } : undefined}
      lecture={`Chaque session compte une fois, dans la tranche de sa première page vue. Cliquez une tranche pour y restreindre l'écran.${
        plafond
          ? ` Plafond atteint : la série porte sur les mêmes ${PLAFOND_TEXTE} premières sessions que les canaux (par application, puis par identifiant).`
          : ""
      }`}
      alternative={{
        legende: "Sessions entrées par canal et par tranche de temps",
        colonnes: ["Période", ...CHANNELS.map((c) => LIBELLE_CANAL[c]), "Total"],
        lignes: points.map((p) => [
          libelleSeauComplet(p.t, seau, FUSEAU_AFFICHAGE),
          ...CHANNELS.map((c) => p.canaux[c]),
          CHANNELS.reduce((t, c) => t + p.canaux[c], 0),
        ]),
      }}
    >
      <StackedBars
        grille={points.map((p) => p.t)}
        points={points.map((p) => ({ t: p.t, ...p.canaux }))}
        series={CHANNELS.map((c) => ({ cle: c, libelle: LIBELLE_CANAL[c], categorieIndex: INDEX_CANAL[c] }))}
        format="count"
        seauSecondes={seau}
        fuseau={FUSEAU_AFFICHAGE}
        zoomHref={zoomHref}
        fenetresCollecte={fenetresCollecte}
        ariaLabel={`Sessions entrées par canal, par tranche de temps, ${dansPhrase}`}
      />
    </Figure>
  );
}
