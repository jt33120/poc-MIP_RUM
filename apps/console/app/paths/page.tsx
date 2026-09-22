// Parcours (F50, plan § 5.13) — « Par où passent les visiteurs, où entrent-ils,
// où sortent-ils, et où décrochent-ils dans un parcours donné ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une part calculée sur un top N. Les deux cartes de bords divisaient chaque
//     route par la somme des 15 routes AFFICHÉES : « 28 % des sessions » y voulait
//     dire « 28 % des sessions des quinze premières routes », et devenait faux dès
//     la seizième. Le vrai dénominateur (les sessions avec vue, lues sur la même
//     fenêtre) demande B31 ; tant qu'il manque, la colonne existe et reste vide,
//     avec sa raison (V3). Aucune part n'est calculée sur un top N.
//   - Une fenêtre qui n'est pas la sienne : la lecture est historique
//     (`now() - interval`, CS1) ; la fenêtre réellement lue et l'heure de lecture
//     sont écrites sous l'en-tête et dans la méta de chaque figure (S3).
//   - Un geste qui ne ferait rien : l'ancrage « à partir de » du Sankey attend
//     l'option `depuis` de `routeTransitions` (B31) ; il est annoncé absent plutôt
//     que rendu inerte, et les étapes d'entonnoir de type vue ou action attendent
//     B33 (§ 0.5).
//   - Deux conventions de pourcentage sans étiquette dans l'entonnoir : chaque
//     taux est écrit avec son dénominateur (« du départ », « de l'étape précédente »).
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FunnelChart, StepPicker } from "@/components/Funnel";
import { Sankey } from "@/components/Sankey";
import { Figure } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire } from "@/lib/lecture";
import { fenetreDansPhrase, fenetreLue, noteLectureHistorique, plafondAtteint } from "@/lib/lecture-historique";
import { pageFilters } from "@/lib/page-filters";
import { hrefWithQuery } from "@/lib/query-contract";
import { availableEvents, funnelReport } from "@/lib/queries-funnel";
import { entryExitRoutes, routeTransitions, type RouteCountRow } from "@/lib/queries-paths";
import { samplingSessionsHistorique } from "@/lib/queries-sessions";
import { buildSankey } from "@/lib/sankey";
import type { AnalyticsQuery } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

/** Plafonds des lectures de l'écran (S4 : un plafond atteint est dit à côté du chiffre). */
const TOP_TRANSITIONS = 50;
const TOP_BORDS = 15;

/** Les populations de l'écran, nommées dans chaque méta (S1, R-P). */
const POPULATION_VUES = "sessions ayant au moins une vue sur la fenêtre";
const POPULATION_TRANSITIONS = "passages d'une route à une autre (boucles A→A exclues)";

/** Le dénominateur qui manque, écrit partout de la même façon (V3). */
const PART_NON_CALCULEE = "part de l'ensemble non calculée (dénominateur à créer)";
const PART_POURQUOI =
  "Part de toutes les sessions : non calculée tant que le dénominateur (les sessions avec vue, sur la même fenêtre) n'est pas lu sur le contrat (B31). Une part calculée sur les routes affichées serait fausse dès la suivante. « Sessions à une vue » et « LCP p75 de la route » ne sont pas non plus affichés : ils viendraient d'une lecture du contrat, dont la fenêtre n'est pas celle de cette table (S2).";

/** Ce que l'ancrage du Sankey attend, et les étapes typées de l'entonnoir (§ 0.5). */
const ANCRAGE_ABSENT =
  "ancrage « à partir de » à créer : la lecture des transitions ne filtre pas sur une route de départ (B31)";
const ETAPES_TYPEES_ABSENTES =
  "étapes de type vue ou action à créer : seuls les événements custom sont proposés comme étapes (B33)";

const compte = (n: number, un: string, plusieurs: string) => `${formater("count", n)} ${n > 1 ? plusieurs : un}`;

export default async function Paths({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/paths");
  if (!ecran.ok) return <FilterProblemNotice title="Parcours" problem={ecran.problem} />;
  const f = ecran.filters;
  // Lot 6c : étapes du funnel depuis s1..s4 (form GET), ordonnées, vides ignorées.
  const steps = [1, 2, 3, 4]
    .map((i) => (typeof sp[`s${i}`] === "string" ? (sp[`s${i}`] as string) : ""))
    .filter(Boolean);
  // Une lecture par section (§ 3.8) : l'échec de l'une n'efface pas les autres.
  const [transitions, bords, events, funnel, echantillonnage] = await Promise.all([
    lire(() => routeTransitions(f, TOP_TRANSITIONS)),
    lire(() => entryExitRoutes(f, TOP_BORDS)),
    lire(() => availableEvents(f)),
    steps.length >= 2 ? lire(() => funnelReport(f, steps)) : Promise.resolve(null),
    // S7 : sessions dont les vues sont lues par les transitions et les bords.
    lire(() => samplingSessionsHistorique(f, { lecture: "vues" })),
  ]);

  // Heure de la lecture : la fenêtre glissante finit ici, pas à la borne `to`.
  const luA = new Date();
  const fenetre = fenetreLue(f.period, luA);
  const dansPhrase = fenetreDansPhrase(f.period);
  const meta = (population: string, extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {population}</span>
      <span>{fenetre}</span>
      <span>lecture non migrée</span>
    </>
  );
  const elargir =
    f.period === "7d" ? undefined : { libelle: "Élargir à 7 jours", href: hrefWithQuery("/paths", ecran.query, { period: "7d" }) };

  const sankey = transitions.ok
    ? buildSankey(transitions.data.map((t) => ({ from: t.from_route, to: t.to_route, count: t.n })))
    : null;
  const liensSankey = {
    sessions: (route: string) => lienSessions(ecran.query, route),
    pages: (route: string) => hrefWithQuery("/pages", ecran.query, { route }),
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Parcours"
        domain="usages"
        sub="Par où passent les visiteurs, où entrent-ils, où sortent-ils, et où décrochent-ils dans un parcours donné ?"
      />

      <p className="-mt-3 mb-6 text-xs text-ink-soft" data-testid="lecture-non-migree">
        {noteLectureHistorique(f.period, luA)}
      </p>

      {/* P2 — trois tuiles : les deux bords n°1, et le nombre de transitions lues. */}
      <SectionErreur titre="Chiffres clés">
        <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <TuileBord
            label="Page d'entrée n°1"
            ligne={bords.ok ? (bords.data.entries[0] ?? null) : null}
            echec={!bords.ok}
            verbe="y démarrent"
            href={(route) => hrefWithQuery("/pages", ecran.query, { route })}
          />
          <TuileBord
            label="Page de sortie n°1"
            ligne={bords.ok ? (bords.data.exits[0] ?? null) : null}
            echec={!bords.ok}
            verbe="s'y terminent"
            href={(route) => hrefWithQuery("/pages", ecran.query, { route })}
          />
          {transitions.ok && plafondAtteint(transitions.data.length, TOP_TRANSITIONS) ? (
            // « 50 » serait faux : la lecture en renvoie 50 au plus, il peut y en avoir plus.
            <KpiLibelle
              label="Transitions distinctes"
              texte={`≥ ${formater("count", TOP_TRANSITIONS)}`}
              lecture={`Seules les ${formater("count", TOP_TRANSITIONS)} transitions les plus fréquentes sont renvoyées par la lecture.`}
            />
          ) : (
            <KpiTile
              label="Transitions distinctes"
              valeur={transitions.ok ? transitions.data.length : null}
              format="count"
              raisonNull="lecture des transitions en échec"
              lecture="Paires route → route, boucles A→A exclues."
            />
          )}
        </div>
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* P3 — le hero : le flux, et l'ancrage qui attend B31. */}
      <div className="mb-6">
        <SectionErreur titre="Flux entre routes">
          <Figure
            id="paths-flux"
            titre="Flux entre routes"
            meta={meta(
              POPULATION_TRANSITIONS,
              sankey ? `${formater("count", sankey.shownFlow)} / ${formater("count", sankey.totalFlow)} passages représentés` : undefined,
            )}
            etat={
              !transitions.ok
                ? { kind: "erreur", titre: "Flux entre routes" }
                : transitions.data.length === 0
                  ? { kind: "vide", population: "transition entre deux routes", plage: dansPhrase, geste: elargir }
                  : undefined
            }
            lecture="Épaisseur d'un ruban = nombre de passages ; un ruban ouvre les sessions passées par la route d'arrivée, un nœud ouvre la route dans /pages. Les boucles (rechargement, navigation vers la même route) sont exclues ; les routes hors des huit premières de chaque côté ne sont pas dessinées — la méta dit la part représentée."
          >
            {sankey && <Sankey model={sankey} ancre={null} liens={liensSankey} />}
          </Figure>
        </SectionErreur>
        <div className="mt-3" data-testid="paths-ancrage">
          <EtatSurface etat={{ kind: "partiel", raison: ANCRAGE_ABSENT }} compact />
        </div>
      </div>

      {/* P4 — deux tables MIROIR : mêmes colonnes, même ordre, même lecture. */}
      <div className="mb-6 grid min-w-0 gap-4 md:grid-cols-2">
        {(
          [
            { titre: "Pages d'entrée", id: "paths-entrees", hint: "1re route de la session", rows: bords.ok ? bords.data.entries : [] },
            { titre: "Pages de sortie", id: "paths-sorties", hint: "dernière route de la session", rows: bords.ok ? bords.data.exits : [] },
          ] as const
        ).map((table) => (
          <SectionErreur key={table.id} titre={table.titre}>
            <Figure
              id={table.id}
              titre={table.titre}
              meta={meta(POPULATION_VUES, `${table.hint} · ${compte(table.rows.length, "route affichée", "routes affichées")}, ${formater("count", TOP_BORDS)} au plus`)}
              etat={
                !bords.ok
                  ? { kind: "erreur", titre: table.titre }
                  : table.rows.length === 0
                    ? { kind: "vide", population: "session avec vue", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture={PART_POURQUOI}
            >
              <TableBords rows={table.rows} titre={table.titre} query={ecran.query} />
            </Figure>
          </SectionErreur>
        ))}
      </div>

      {/* P5 — l'entonnoir : sélecteur d'étapes, puis les marches. */}
      <SectionErreur titre="Entonnoir de conversion">
        <Figure
          id="paths-entonnoir"
          titre="Entonnoir de conversion"
          meta={meta("sessions ayant réalisé l'étape 1 sur la fenêtre", events.ok ? compte(events.data.length, "événement proposé", "événements proposés") : undefined)}
          etat={!events.ok ? { kind: "erreur", titre: "Entonnoir de conversion" } : undefined}
          lecture="Une session atteint l'étape k si elle a réalisé les étapes 1 à k dans l'ordre, première occurrence de chaque étape ; la fenêtre de conversion est la session. Chaque taux est écrit avec son dénominateur ; l'abandon est un nombre de sessions, jamais un pourcentage."
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs text-ink-faint">
              Choisis 2 à 4 événements custom dans l&apos;ordre : conversion et abandon à chaque étape, par session
              (ordre temporel respecté).
            </p>
            {events.ok && events.data.length > 0 ? (
              <StepPicker events={events.data} selected={steps} sp={sp} />
            ) : (
              events.ok && (
                <p className="text-sm text-ink-faint">
                  Aucun événement custom sur {dansPhrase}. Émets-en via{" "}
                  <code className="chip-mono">MIPRum.track(&quot;nom&quot;)</code> pour construire un entonnoir.
                </p>
              )
            )}
            <EtatSurface etat={{ kind: "partiel", raison: ETAPES_TYPEES_ABSENTES }} compact />
            {funnel && !funnel.ok && <EchecLecture titre="Entonnoir de conversion" compact />}
            {funnel?.ok && funnel.data.length > 0 && (
              <>
                <FunnelChart
                  steps={funnel.data}
                  lienJournal={(nom) => hrefWithQuery("/events", ecran.query, { kind: "event", name: nom })}
                />
                {funnel.data[0].reached === 0 && (
                  <p className="text-xs text-ink-faint">
                    Aucune session n&apos;a réalisé l&apos;étape 1 sur {dansPhrase} : les taux n&apos;ont pas de
                    dénominateur.
                  </p>
                )}
              </>
            )}
          </div>
        </Figure>
      </SectionErreur>
    </div>
  );
}

/** « Sessions passées par cette route » : la recherche exacte de `/sessions` (qf=route). */
function lienSessions(query: AnalyticsQuery, route: string): string {
  return hrefWithQuery("/sessions", query, { qf: "route", q: route });
}

/**
 * Une tuile de bord : la route, son compte — et pas sa part. Le dénominateur (les
 * sessions avec vue de la même fenêtre) n'est pas lu ; la somme des 15 routes
 * affichées n'en est pas un (elle change avec le nombre de lignes montrées).
 */
function TuileBord({
  label,
  ligne,
  echec,
  verbe,
  href,
}: {
  label: string;
  ligne: RouteCountRow | null;
  echec: boolean;
  verbe: string;
  href: (route: string) => string;
}) {
  return (
    <KpiLibelle
      label={label}
      texte={ligne ? `${ligne.route} · ${compte(ligne.n, "session", "sessions")} ${verbe}` : null}
      raisonNull={echec ? "lecture des pages d'entrée et de sortie en échec" : "aucune session avec vue sur la fenêtre"}
      lecture={ligne ? PART_NON_CALCULEE : undefined}
      href={ligne ? href(ligne.route) : undefined}
    />
  );
}

/**
 * Les deux tables de bords ont les MÊMES colonnes et le MÊME ordre : entrées et
 * sorties se comparent ligne à ligne. La part reste vide (V3) tant que B31 n'a pas
 * livré son dénominateur — une colonne absente aurait laissé croire qu'elle ne se
 * pose pas ; une part sur le top 15 aurait été fausse.
 */
function TableBords({ rows, titre, query }: { rows: RouteCountRow[]; titre: string; query: AnalyticsQuery }) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only">{titre} : route, sessions, part de toutes les sessions</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-1 pr-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Route
            </th>
            <th scope="col" className="py-1 pr-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Sessions
            </th>
            <th scope="col" className="py-1 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Part de toutes les sessions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route} className="border-b border-line/60 last:border-0">
              <th scope="row" className="max-w-0 py-1.5 pr-3 font-normal">
                {/* `truncate` ne coupe qu'un élément `block` : une route longue sans
                    espace élargirait la page à 390 px. */}
                <Link
                  href={lienSessions(query, r.route)}
                  className="block truncate font-mono text-xs text-ink hover:text-accent hover:underline"
                  title={`Sessions passées par ${r.route}`}
                >
                  {r.route}
                </Link>
                <Link
                  href={hrefWithQuery("/pages", query, { route: r.route })}
                  className="text-[10px] text-ink-faint hover:text-accent hover:underline"
                >
                  Ouvrir /pages
                </Link>
              </th>
              <td className="py-1.5 pr-3 text-right text-xs tabular-nums text-ink">{formater("count", r.n)}</td>
              <td className="py-1.5 text-right text-xs tabular-nums text-ink-faint" title={PART_NON_CALCULEE}>
                —
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
