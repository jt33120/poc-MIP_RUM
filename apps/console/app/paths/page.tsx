// Parcours (F50, plan § 5.13 ; sur le contrat depuis B31 → F53) — « Par où passent
// les visiteurs, où entrent-ils, où sortent-ils, et où décrochent-ils dans un
// parcours donné ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une part calculée sur un top N. Les deux cartes de bords divisaient chaque
//     route par la somme des 15 routes AFFICHÉES : « 28 % des sessions » y voulait
//     dire « 28 % des sessions des quinze premières routes », et devenait faux dès
//     la seizième. Depuis B31, le dénominateur est `sessionsAvecVue(f)` — la seule
//     définition des sessions avec vue (R-P), lue sur la MÊME plage que les bords.
//   - Une fenêtre qui n'est pas la sienne : les lectures sont celles du contrat
//     (`[from, to)`, apps effectives, tablette et « Inconnu » compris) ; la méta de
//     chaque figure écrit la plage lue.
//   - Un ancrage qui changerait les chiffres : `depuis` est un réglage de l'écran
//     (§ 3.1) ; il restreint le DESSIN du flux aux passages qui partent d'une route,
//     jamais les tuiles ni les tables.
//   - Deux conventions de pourcentage sans étiquette dans l'entonnoir : chaque
//     taux est écrit avec son dénominateur (« du départ », « de l'étape précédente »).
//     Les étapes de type vue ou action attendent B33 et le disent (§ 0.5).
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
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "@/lib/comparaison";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire, type Lecture } from "@/lib/lecture";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "@/lib/lecture-usages";
import { pageFilters } from "@/lib/page-filters";
import { hrefWithQuery, paramReader, previousRange, type AnalyticsQuery } from "@/lib/query-contract";
import { sessionsAvecVue } from "@/lib/queries";
import { availableEvents, funnelReport } from "@/lib/queries-funnel";
import { entryExitRoutes, lcpDesRoutes, routeTransitions, type LcpDeRoute, type RouteCountRow, type TransitionRow } from "@/lib/queries-paths";
import { samplingSessions } from "@/lib/queries-sessions";
import { buildSankey } from "@/lib/sankey";
import { referencePrecedente } from "@/lib/sessions-kpi";
import { gabaritZoom, lireComparaison, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Plafonds des lectures de l'écran (S4 : un plafond atteint est dit à côté du chiffre). */
const TOP_TRANSITIONS = 50;
const TOP_BORDS = 15;
/** Routes proposées à l'ancrage : les départs du flux dessiné (8 nœuds par côté, `buildSankey`). */
const ANCRES_PROPOSEES = 8;

/** Les populations de l'écran, nommées dans chaque méta (S1, R-P). */
const POPULATION_VUES = "sessions ayant au moins une vue sur la fenêtre";
const POPULATION_TRANSITIONS = "passages d'une route à une autre (boucles A→A exclues)";

/** Les transitions se comparent sur les pages vues : c'est d'elles qu'elles sont lues. */
const SOURCE_VUES: SourceComparaison = { table: "rum_pageview", colonneTemps: "started_at", additive: true };

const PART_LECTURE =
  "Part de toutes les sessions = sessions de la ligne / sessions ayant au moins une vue sur la même plage (une seule définition, R-P) : jamais la somme des routes affichées. « Sessions à une vue » : sessions dont cette route est la SEULE vue de la plage — elles y entrent et en sortent. « LCP p75 » : toutes les mesures LCP de la route sur la plage, pas seulement celles de ces sessions.";

/** Les étapes typées de l'entonnoir attendent B33 (§ 0.5) : dit, jamais rendu inerte. */
const ETAPES_TYPEES_ABSENTES =
  "étapes de type vue ou action à créer : seuls les événements custom sont proposés comme étapes (B33)";

const compte = (n: number, un: string, plusieurs: string) => `${formater("count", n)} ${n > 1 ? plusieurs : un}`;

/** Routes de départ du flux, par passages sortants décroissants (proposées à l'ancrage). */
function departs(transitions: TransitionRow[]): string[] {
  const parRoute = new Map<string, number>();
  for (const t of transitions) parRoute.set(t.from_route, (parRoute.get(t.from_route) ?? 0) + t.n);
  return [...parRoute.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, ANCRES_PROPOSEES)
    .map(([route]) => route);
}

export default async function Paths({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/paths");
  if (!ecran.ok) return <FilterProblemNotice title="Parcours" problem={ecran.problem} />;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const { etat, ignores } = lireEtatDeVue("/paths", lecteur);
  const depuis = etat.depuis;
  // Comparaison (F06, F53) : `cmp=prev` sur la tuile chiffrée, période précédente COMPLÈTE seulement.
  const prev = lireComparaison("/paths", lecteur).valeur.mode === "prev";
  // Lot 6c : étapes du funnel depuis s1..s4 (form GET), ordonnées, vides ignorées.
  const steps = [1, 2, 3, 4]
    .map((i) => (typeof sp[`s${i}`] === "string" ? (sp[`s${i}`] as string) : ""))
    .filter(Boolean);
  // Une lecture par section (§ 3.8) : l'échec de l'une n'efface pas les autres.
  const [transitions, ancrees, bords, avecVue, events, funnel, echantillonnage, transitionsPrev, couvertures] = await Promise.all([
    lire(() => routeTransitions(f, TOP_TRANSITIONS)),
    depuis ? lire(() => routeTransitions(f, TOP_TRANSITIONS, { depuis })) : Promise.resolve(null),
    lire(() => entryExitRoutes(f, TOP_BORDS)),
    // Le dénominateur des parts : UNE définition (R-P), sur la même plage que les bords.
    lire(() => sessionsAvecVue(f)),
    lire(() => availableEvents(f)),
    steps.length >= 2 ? lire(() => funnelReport(f, steps)) : Promise.resolve(null),
    // S7 : sessions dont les vues sont lues par les transitions et les bords.
    lire(() => samplingSessions(f, { population: { lecture: "vues" } })),
    prev ? lire(() => routeTransitions(f, TOP_TRANSITIONS, { shift: true })) : Promise.resolve(null),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_VUES).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
  ]);
  // LCP p75 des routes de bord : les routes ne sont connues qu'après la lecture des bords.
  const routesDeBord = bords.ok ? [...new Set([...bords.data.entries, ...bords.data.exits].map((r) => r.route))] : [];
  const lcp: Lecture<LcpDeRoute[]> | null = bords.ok ? await lire(() => lcpDesRoutes(f, routesDeBord)) : null;
  const lcpParRoute = lcp?.ok ? new Map(lcp.data.map((l) => [l.route, l])) : null;

  const plage = ecran.label;
  const dansPhrase = plageDansPhrase(query.range, plage);
  const meta = (population: string, extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {population}</span>
      <span>{plage}</span>
    </>
  );
  const elargir = gesteElargir("/paths", query);
  /** Même écran, mêmes réglages de vue (étapes, comparaison…), un paramètre changé. */
  const lienEcran = (extra: Record<string, string | null>) =>
    gabaritZoom(hrefWithQuery("/paths", query, extra), Object.fromEntries(Object.entries(sp).filter(([k]) => !(k in extra))));

  const flux = depuis ? ancrees : transitions;
  const sankey = flux?.ok ? buildSankey(flux.data.map((t) => ({ from: t.from_route, to: t.to_route, count: t.n }))) : null;
  const liensSankey = {
    sessions: (route: string) => lienSessions(query, route),
    pages: (route: string) => hrefWithQuery("/pages", query, { route }),
    // B31 : un nœud gauche ancre le flux à partir de sa route.
    ancrer: (route: string) => lienEcran({ depuis: route }),
  };
  const denominateur = avecVue.ok ? avecVue.data : null;

  // Transitions distinctes, comparées (F53) : deux plafonds de 50 bornent le compte.
  const prec = transitionsPrev?.ok ? transitionsPrev.data.length : null;
  const comparaisonTransitions = transitionsPrev
    ? {
        precedent: prec,
        reference: referencePrecedente(previousRange(query.range)),
        couverturePrecedente: couvertureDeTuile(
          transitionsPrev.ok ? couvertures : [{ etat: "inconnue", raison: "la période précédente n'a pas pu être lue" }],
          [{ atteint: prec !== null && plafondAtteint(prec, TOP_TRANSITIONS), raison: `plafond de ${TOP_TRANSITIONS} transitions atteint sur la période précédente : son compte est un minimum` }],
        ),
      }
    : {};

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Parcours"
        domain="usages"
        sub="Par où passent les visiteurs, où entrent-ils, où sortent-ils, et où décrochent-ils dans un parcours donné ?"
      />

      {ignores.length > 0 && (
        <div className="mb-4 space-y-1" data-testid="reglages-ignores">
          {ignores.map((ligne) => (
            <p key={ligne} role="note" className="text-xs text-ink-soft" data-testid="reglage-ignore">
              {ligne}
            </p>
          ))}
        </div>
      )}

      {/* P2 — trois tuiles : les deux bords n°1 (avec leur part), et le nombre de transitions lues. */}
      <SectionErreur titre="Chiffres clés">
        <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <TuileBord
            label="Page d'entrée n°1"
            ligne={bords.ok ? (bords.data.entries[0] ?? null) : null}
            echec={!bords.ok}
            denominateur={denominateur}
            verbe="y démarrent"
            href={(route) => hrefWithQuery("/pages", query, { route })}
          />
          <TuileBord
            label="Page de sortie n°1"
            ligne={bords.ok ? (bords.data.exits[0] ?? null) : null}
            echec={!bords.ok}
            denominateur={denominateur}
            verbe="s'y terminent"
            href={(route) => hrefWithQuery("/pages", query, { route })}
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
              {...comparaisonTransitions}
            />
          )}
        </div>
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* P3 — le hero : le flux, et son ancrage « à partir de ». */}
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
              !flux?.ok
                ? { kind: "erreur", titre: "Flux entre routes" }
                : flux.data.length === 0
                  ? depuis
                    ? { kind: "vide", population: `transition à partir de ${depuis}`, plage: dansPhrase }
                    : { kind: "vide", population: "transition entre deux routes", plage: dansPhrase, geste: elargir }
                  : undefined
            }
            lecture="Épaisseur d'un ruban = nombre de passages ; un ruban ouvre les sessions passées par la route d'arrivée ; un nœud de gauche ancre le flux à partir de sa route, un nœud de droite ouvre la route dans /pages. Les boucles (rechargement, navigation vers la même route) sont exclues ; les routes hors des huit premières de chaque côté ne sont pas dessinées — la méta dit la part représentée. L'ancrage ne change que ce dessin : tuiles et tables portent sur toutes les routes."
          >
            {sankey && <Sankey model={sankey} ancre={depuis} liens={liensSankey} />}
          </Figure>
        </SectionErreur>
        <SelecteurAncrage
          depuis={depuis}
          routes={transitions.ok ? departs(transitions.data) : []}
          lien={(route) => lienEcran({ depuis: route })}
        />
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
              meta={meta(
                POPULATION_VUES,
                `${table.hint} · ${compte(table.rows.length, "route affichée", "routes affichées")}, ${formater("count", TOP_BORDS)} au plus${
                  denominateur !== null ? ` · ${compte(denominateur, "session avec vue", "sessions avec vue")}` : ""
                }`,
              )}
              etat={
                !bords.ok
                  ? { kind: "erreur", titre: table.titre }
                  : table.rows.length === 0
                    ? { kind: "vide", population: "session avec vue", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture={PART_LECTURE}
            >
              <TableBords rows={table.rows} titre={table.titre} query={query} denominateur={denominateur} lcp={lcpParRoute} />
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
                  lienJournal={(nom) => hrefWithQuery("/events", query, { kind: "event", name: nom })}
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
 * P3 — « À partir de : [route] » (§ 5.13.3). Des liens plutôt qu'un formulaire : un
 * GET sans script enverrait `depuis=` vide pour « toutes », que l'état de vue
 * signalerait comme un réglage illisible. Rangée défilante à 390 px (`relative` :
 * piège des `sr-only` dans un conteneur qui défile).
 */
function SelecteurAncrage({ depuis, routes, lien }: { depuis: string | null; routes: string[]; lien: (route: string | null) => string }) {
  // La route ancrée reste proposée même hors des départs les plus fréquents.
  const proposees = depuis && !routes.includes(depuis) ? [depuis, ...routes] : routes;
  if (proposees.length === 0) return null;
  const puce = (actif: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
      actif ? "border-perf/50 bg-perf/10 text-perf" : "border-line text-ink-soft hover:bg-panel2"
    }`;
  return (
    <nav
      aria-label="Ancrage du flux"
      className="relative mt-3 flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto py-0.5 text-xs"
      data-testid="paths-ancrage"
    >
      <span className="shrink-0 text-ink-soft">À partir de :</span>
      <Link href={lien(null)} aria-current={depuis ? undefined : "true"} className={puce(!depuis)} data-testid="paths-ancrage-toutes">
        Toutes les routes
      </Link>
      {proposees.map((route) => (
        <Link
          key={route}
          href={lien(route)}
          aria-current={route === depuis ? "true" : undefined}
          className={`${puce(route === depuis)} font-mono`}
          title={`Ne dessiner que les passages qui partent de ${route}`}
        >
          {route}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Une tuile de bord : la route, son compte, et sa part de TOUTES les sessions avec
 * vue de la plage (R-P) — jamais de la somme des routes affichées.
 */
function TuileBord({
  label,
  ligne,
  echec,
  denominateur,
  verbe,
  href,
}: {
  label: string;
  ligne: RouteCountRow | null;
  echec: boolean;
  denominateur: number | null;
  verbe: string;
  href: (route: string) => string;
}) {
  const part = ligne && denominateur ? ligne.n / denominateur : null;
  return (
    <KpiLibelle
      label={label}
      texte={
        ligne
          ? `${ligne.route} · ${compte(ligne.n, "session", "sessions")}${denominateur !== null ? ` sur ${formater("count", denominateur)}` : ""}`
          : null
      }
      raisonNull={echec ? "lecture des pages d'entrée et de sortie en échec" : "aucune session avec vue sur la fenêtre"}
      lecture={
        ligne
          ? part !== null
            ? `${formater("pct", part)} des sessions avec vue ${verbe}.`
            : "part non calculée : le nombre de sessions avec vue n'a pas pu être lu"
          : undefined
      }
      href={ligne ? href(ligne.route) : undefined}
    />
  );
}

const TH = "py-1 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-soft";

/**
 * Les deux tables de bords ont les MÊMES colonnes et le MÊME ordre : entrées et
 * sorties se comparent ligne à ligne. La part se lit sur `sessionsAvecVue` ; son
 * absence (lecture en échec) s'écrit « — », jamais « 0 % ».
 */
function TableBords({
  rows,
  titre,
  query,
  denominateur,
  lcp,
}: {
  rows: RouteCountRow[];
  titre: string;
  query: AnalyticsQuery;
  denominateur: number | null;
  lcp: Map<string, LcpDeRoute> | null;
}) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[30rem] text-sm">
        <caption className="sr-only">
          {titre} : route, sessions, part de toutes les sessions, sessions à une vue, LCP p75 de la route
        </caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-1 pr-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Route
            </th>
            <th scope="col" className={`${TH} pr-3`}>
              Sessions
            </th>
            <th scope="col" className={`${TH} pr-3`}>
              Part de toutes les sessions
            </th>
            <th scope="col" className={`${TH} pr-3`}>
              Sessions à une vue
            </th>
            <th scope="col" className={TH}>
              LCP p75 de la route
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const part = denominateur ? r.n / denominateur : null;
            const mesure = lcp?.get(r.route) ?? null;
            return (
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
                    className="text-[10px] text-ink-soft hover:text-accent hover:underline"
                  >
                    Ouvrir /pages
                  </Link>
                </th>
                <td className="py-1.5 pr-3 text-right text-xs tabular-nums text-ink">{formater("count", r.n)}</td>
                <td
                  className="relative py-1.5 pr-3 text-right text-xs tabular-nums text-ink"
                  title={part === null ? "part non calculée : le nombre de sessions avec vue n'a pas pu être lu" : undefined}
                >
                  {part !== null && (
                    <span aria-hidden="true" className="absolute inset-y-1 right-3 rounded-sm bg-perf/15" style={{ width: `calc(${(part * 100).toFixed(1)}% - 0.75rem)` }} />
                  )}
                  <span className="relative">{formater("pct", part)}</span>
                </td>
                <td className="py-1.5 pr-3 text-right text-xs tabular-nums text-ink">{formater("count", r.une_vue)}</td>
                <td
                  className="py-1.5 text-right text-xs tabular-nums text-ink"
                  title={
                    lcp === null
                      ? "lecture du LCP en échec"
                      : mesure
                        ? `p75 de ${compte(mesure.n, "mesure LCP", "mesures LCP")} de la route sur la plage`
                        : "aucune mesure LCP de cette route sur la plage"
                  }
                >
                  {formater("ms", mesure?.p75 ?? null)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
