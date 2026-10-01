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
//   - Une fonction absente montrée comme présente : les étapes de type vue ou action
//     (B33) ne sont pas livrées ; le bandeau « Partiel » qui les annonçait se lisait
//     comme un incident (recette du 26/09/2026). L'écran dit seulement ce qu'il
//     propose : « Étapes : événements personnalisés ».
//
// RECETTE DU 26/09/2026. Plus aucun code interne ni vocabulaire de conception à
// l'écran (B33, R-P, « méta », « tuiles et tables ») ; la méthode de chaque figure
// est repliée sous elle (`Methode`), le chiffre d'abord. Les routes des tables ne
// sont plus coupées à quatre caractères : elles passent à la ligne, coupées au
// milieu au-delà de `ROUTE_AFFICHEE_MAX`, et l'accès à Pages est une icône à côté
// du nom, et non plus un second lien texte qui prenait sa place.
//
// REFONTE DU 30/09/2026 (charte § 4 « Parcours ») : quatre cases épurées, l'ancrage
// « À partir de » en barre de filtre au-dessus du flux, le Sankey sur toute la largeur,
// les deux tables de bords côte à côte (même bord bas), l'entonnoir sous elles. Les
// phrases de lecture (« épaisseur d'un ruban = … », « cliquez une route … ») sont dans
// les replis « Méthode » ; la consigne de l'entonnoir, dans une bulle.
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { FunnelChart, StepPicker } from "@/components/Funnel";
import { ICON_PATHS, Icon } from "@/components/icons";
import { Sankey, routeCoupable, tronquerMilieu } from "@/components/Sankey";
import { Figure, MethodeRepliee as Methode } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { InfoTip } from "@/components/InfoTip";
import { RangeeKpi } from "@/components/charts/RangeeKpi";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { TableDefilante } from "@/components/TableDefilante";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { chargerPaths, etapesDeLEntonnoir, TOP_BORDS, TOP_TRANSITIONS } from "@/lib/chargeurs/paths";
import { chargerEcran } from "@/lib/ecran";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "@/lib/lecture-usages";
import { hrefWithQuery, paramReader, previousRange, type AnalyticsQuery } from "@/lib/query-contract";
import { type LcpDeRoute, type RouteCountRow, type TransitionRow } from "@/lib/queries-paths";
import { buildSankey } from "@/lib/sankey";
import { referencePrecedente } from "@/lib/sessions-kpi";
import { gabaritZoom, lireEtatDeVue } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Routes proposées à l'ancrage : les départs du flux dessiné (8 nœuds par côté, `buildSankey`). */
const ANCRES_PROPOSEES = 8;

/** Les populations de l'écran, nommées dans chaque méta (S1, R-P). */
const POPULATION_VUES = "sessions ayant vu au moins une page sur la période";
// Les boucles A→A (rechargement, navigation vers la même route) sont exclues par la lecture.
const POPULATION_TRANSITIONS = "passages d'une route à une autre route";

/** D'où viennent les chiffres de l'écran, écrit dans la fenêtre des cases. */
const SOURCE_PARCOURS = "Capteur navigateur · pages vues des sessions, robots exclus";

/** Méthode des deux tables de bords : le dénominateur des parts est UNE définition (R-P). */
const METHODE_BORDS =
  "« Part de toutes les sessions » rapporte les sessions de la ligne à toutes les sessions ayant vu au moins une page sur la période, jamais à la somme des routes affichées. « Sessions à une vue » : sessions dont cette route est la seule page vue — elles y entrent et en sortent. « LCP p75 de la route » : toutes les mesures LCP de la route sur la période, pas seulement celles de ces sessions.";

/**
 * Au-delà, une route de table est coupée AU MILIEU (son début et sa fin l'identifient,
 * « /partners/…/documents ») ; en deçà, elle passe entière à la ligne.
 */
const ROUTE_AFFICHEE_MAX = 48;

/** « Accueil (/) » : seule, la route racine se lisait comme un séparateur (« / · 89 sessions »). */
const libelleRoute = (route: string) => (route === "/" ? "Accueil (/)" : route);

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
  // Le chargeur (`lib/chargeurs/paths.ts`) lit transitions, bords, entonnoir et
  // leur LCP ; la page relit les étapes par la même fonction que lui.
  const ecran = await chargerEcran(ECRANS.paths, chargerPaths, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Parcours" problem={ecran.problem} />;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const { etat, ignores } = lireEtatDeVue("/paths", lecteur);
  const depuis = etat.depuis;
  // Lot 6c : étapes du funnel depuis s1..s4 (form GET), ordonnées, vides ignorées.
  const steps = etapesDeLEntonnoir(sp);
  // Une lecture par section (§ 3.8) : l'échec de l'une n'efface pas les autres.
  const { transitions, ancrees, bords, avecVue, events, funnel, echantillonnage, transitionsPrev, couvertures, lcp } = ecran;
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
  const elargir = gesteElargir("/paths", query, Date.now());
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

      {/* P2 — trois tuiles : les deux bords n°1 (avec leur part), et le nombre de transitions lues.
          Une période précédente incomplète se dit une fois, au-dessus de la rangée. */}
      <SectionErreur titre="Chiffres clés">
        <RangeeKpi
          couvertures={[comparaisonTransitions.couverturePrecedente]}
          className="mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4"
        >
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
              lecture={`Seules les ${formater("count", TOP_TRANSITIONS)} transitions les plus fréquentes sont comptées.`}
            />
          ) : (
            <KpiTile
              label="Transitions distinctes"
              valeur={transitions.ok ? transitions.data.length : null}
              format="count"
              raisonNull="lecture des transitions en échec"
              lecture="Paires de routes différentes, « départ → arrivée »."
              methode="Paires de routes distinctes « départ → arrivée » entre deux pages vues successives d'une même session ; un passage d'une route vers elle-même n'est pas compté."
              source={SOURCE_PARCOURS}
              categorie="Parcours · départ → arrivée"
              {...comparaisonTransitions}
            />
          )}
          {/* Le dénominateur des parts des tables : TOUTES les sessions avec vue de la plage. */}
          <KpiTile
            label="Sessions avec vue"
            valeur={denominateur}
            format="count"
            raisonNull="le nombre de sessions avec vue n'a pas pu être lu"
            methode="Sessions ayant vu au moins une page sur la période : le dénominateur de toutes les parts de l'écran, jamais la somme des routes affichées."
            source={SOURCE_PARCOURS}
            categorie="Parcours · dénominateur des parts"
          />
        </RangeeKpi>
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* P3 — le hero : l'ancrage « à partir de » (barre de filtre), puis le flux. */}
      <div className="mb-4">
        <SelecteurAncrage
          depuis={depuis}
          routes={transitions.ok ? departs(transitions.data) : []}
          lien={(route) => lienEcran({ depuis: route })}
        />
        <SectionErreur titre="Flux entre routes">
          <Figure
            id="paths-flux"
            titre="Flux entre routes"
            meta={meta(
              POPULATION_TRANSITIONS,
              sankey
                ? `${compte(sankey.shownFlow, "passage représenté", "passages représentés")} sur ${formater("count", sankey.totalFlow)}`
                : undefined,
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
          >
            {sankey && (
              <>
                <Sankey model={sankey} ancre={depuis} liens={liensSankey} />
                {/* Deux lectures : le dessin (au-delà de 640 px) et sa liste (en deçà) ; le mode
                    d'emploi de chacune est dans le repli. */}
                <Methode>
                  <span className="hidden sm:inline">
                    Épaisseur d&apos;un ruban = nombre de passages. Cliquez un ruban pour voir les sessions passées par
                    la route d&apos;arrivée, une route de gauche pour ne garder que les passages qui en partent, une route
                    de droite pour l&apos;ouvrir dans Pages.
                  </span>
                  <span className="sm:hidden">Touchez une transition pour voir les sessions passées par sa route d&apos;arrivée.</span>{" "}
                  Un passage relie deux pages vues successives d&apos;une même session ; un passage d&apos;une route vers
                  elle-même (rechargement, changement de paramètre) n&apos;est pas compté. Seules les huit routes les plus
                  fréquentes de chaque côté sont dessinées : le nombre de passages représentés est écrit au-dessus du
                  dessin. Choisir une route de départ ne change que le dessin : les chiffres clés et les tableaux portent
                  toujours sur toutes les routes. Source : pages vues du capteur navigateur.
                </Methode>
              </>
            )}
          </Figure>
        </SectionErreur>
      </div>

      {/* P4 — deux tables MIROIR : mêmes colonnes, même ordre, même lecture. */}
      <div className="mb-4 grid min-w-0 gap-3 md:grid-cols-2">
        {(
          [
            { titre: "Pages d'entrée", id: "paths-entrees", hint: "1re route de la session", rows: bords.ok ? bords.data.entries : [] },
            { titre: "Pages de sortie", id: "paths-sorties", hint: "dernière route de la session", rows: bords.ok ? bords.data.exits : [] },
          ] as const
        ).map((table) => (
          <SectionErreur key={table.id} titre={table.titre}>
            {/* Même bord bas pour les deux tables : la figure prend la hauteur de sa cellule. */}
            <div className="min-w-0 md:[&>section]:h-full">
            <Figure
              id={table.id}
              titre={table.titre}
              meta={meta(
                POPULATION_VUES,
                `${table.hint} · ${compte(table.rows.length, "route affichée", "routes affichées")} (${formater("count", TOP_BORDS)} au plus)${
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
            >
              <TableBords rows={table.rows} titre={table.titre} query={query} denominateur={denominateur} lcp={lcpParRoute} />
              <Methode>
                Cliquez une route pour voir les sessions passées par elle ; l&apos;icône à côté l&apos;ouvre dans Pages.{" "}
                {METHODE_BORDS}
              </Methode>
            </Figure>
            </div>
          </SectionErreur>
        ))}
      </div>

      {/* P5 — l'entonnoir : sélecteur d'étapes, puis les marches. */}
      <SectionErreur titre="Entonnoir de conversion">
        <Figure
          id="paths-entonnoir"
          titre="Entonnoir de conversion"
          meta={meta("sessions ayant réalisé l'étape 1 sur la période", events.ok ? compte(events.data.length, "événement proposé", "événements proposés") : undefined)}
          etat={!events.ok ? { kind: "erreur", titre: "Entonnoir de conversion" } : undefined}
        >
          <div className="flex flex-col gap-2">
            {/* Seul ce qui est proposé est dit : les étapes de type vue ou action (B33)
                ne sont pas livrées, et un bandeau « Partiel » les montrait présentes. La
                consigne est dans la bulle ; elle reste lue. */}
            <p className="flex items-center gap-1.5 text-xs text-ink-soft" data-testid="entonnoir-consigne">
              <span className="font-medium text-ink">Étapes : événements personnalisés.</span>
              <span className="sr-only">
                Choisissez-en 2 à 4, dans l&apos;ordre du parcours : l&apos;entonnoir montre combien de sessions atteignent
                chaque étape et combien abandonnent.
              </span>
              <InfoTip label="Construire l'entonnoir" align="start">
                2 à 4 événements, dans l&apos;ordre du parcours : l&apos;entonnoir montre combien de sessions atteignent
                chaque étape et combien abandonnent.
              </InfoTip>
            </p>
            {events.ok && events.data.length > 0 ? (
              <StepPicker events={events.data} selected={steps} sp={sp} />
            ) : (
              events.ok && (
                <p className="text-sm text-ink-soft">
                  Aucun événement personnalisé sur {dansPhrase}. Envoyez-en avec{" "}
                  <code className="chip-mono">MIPRum.track(&quot;nom&quot;)</code> pour construire un entonnoir.
                </p>
              )
            )}
            {funnel && !funnel.ok && <EchecLecture titre="Entonnoir de conversion" compact />}
            {funnel?.ok && funnel.data.length > 0 && (
              <>
                <FunnelChart
                  steps={funnel.data}
                  lienJournal={(nom) => hrefWithQuery("/events", query, { kind: "event", name: nom })}
                />
                {funnel.data[0].reached === 0 && (
                  <p className="text-xs text-ink-soft">
                    Aucune session n&apos;a réalisé l&apos;étape 1 sur {dansPhrase} : les taux n&apos;ont pas de
                    dénominateur.
                  </p>
                )}
                <Methode>
                  Chaque étape donne deux taux, l&apos;un rapporté à l&apos;étape précédente, l&apos;autre au départ ;
                  l&apos;abandon est un nombre de sessions. Une session atteint une étape si elle a réalisé toutes les étapes précédentes, dans l&apos;ordre, au
                  cours de la même session ; seule la première occurrence de chaque événement compte. L&apos;abandon
                  d&apos;une étape est le nombre de sessions qui ont atteint l&apos;étape précédente sans atteindre
                  celle-ci.
                </Methode>
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
      className="relative mb-2 flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto py-0.5 text-xs"
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
          ? `${libelleRoute(ligne.route)} · ${compte(ligne.n, "session", "sessions")}${denominateur !== null ? ` sur ${formater("count", denominateur)}` : ""}`
          : null
      }
      raisonNull={echec ? "lecture des pages d'entrée et de sortie en échec" : "aucune session avec vue sur la période"}
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
 * Le nom d'une route de table, lien vers ses sessions, et l'accès à Pages en ICÔNE à
 * côté : le lien texte « Ouvrir /pages » se posait sous le nom et en prenait la place
 * (recette du 26/09/2026). Une route plus longue que `ROUTE_AFFICHEE_MAX` est coupée
 * au milieu ; elle reste entière dans l'infobulle et dans le nom annoncé du lien.
 */
function RouteDeTable({ route, sessions, pages }: { route: string; sessions: string; pages: string }) {
  const affichee = tronquerMilieu(route, ROUTE_AFFICHEE_MAX);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {/* Une ligne par route (charte § 3.5) : rognée à la largeur de la colonne, entière
          dans l'infobulle et dans le nom du lien. */}
      <Link
        href={sessions}
        className="block min-w-0 truncate font-mono text-xs text-ink hover:text-accent hover:underline"
        title={`Sessions passées par ${route}`}
        aria-label={affichee !== route ? route : undefined}
      >
        {routeCoupable(affichee)}
      </Link>
      <Link
        href={pages}
        className="shrink-0 rounded p-0.5 text-ink-soft transition hover:bg-panel2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        title={`Ouvrir ${route} dans Pages`}
        aria-label={`Ouvrir ${route} dans Pages`}
      >
        <Icon paths={ICON_PATHS.timer} className="h-3.5 w-3.5" />
      </Link>
    </span>
  );
}

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
    // Défilement signalé sous 30 rem ; la zone reste `relative` pour la légende `sr-only`.
    <TableDefilante label={titre}>
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
                {/* `max-w-0` seul réduisait la colonne à rien (« /par… », recette
                    26/09) : `w-2/5 min-w-[10rem]` lui garde 40 % de la table. La route
                    y passe à la ligne (`overflow-wrap: anywhere`) au lieu d'être coupée
                    à la largeur : trois « /par… » ne se distinguaient plus. `text-left` :
                    un `th` centre par défaut, la route flottait au-dessus de son icône. */}
                <th scope="row" className="h-8 w-2/5 min-w-[10rem] max-w-0 py-1 pr-3 text-left align-middle font-normal">
                  <RouteDeTable route={r.route} sessions={lienSessions(query, r.route)} pages={hrefWithQuery("/pages", query, { route: r.route })} />
                </th>
                <td className="py-1 pr-3 text-right text-xs tabular-nums text-ink">{formater("count", r.n)}</td>
                <td
                  className="relative py-1 pr-3 text-right text-xs tabular-nums text-ink"
                  title={part === null ? "part non calculée : le nombre de sessions avec vue n'a pas pu être lu" : undefined}
                >
                  {/* Un volume est neutre : le bleu `perf` se lisait comme le domaine Performance. */}
                  {part !== null && (
                    <span aria-hidden="true" className="absolute inset-y-1 right-3 rounded-sm bg-ink-faint/20" style={{ width: `calc(${(part * 100).toFixed(1)}% - 0.75rem)` }} />
                  )}
                  <span className="relative">{formater("pct", part)}</span>
                </td>
                <td className="py-1 pr-3 text-right text-xs tabular-nums text-ink">{formater("count", r.une_vue)}</td>
                <td
                  className="py-1 text-right text-xs tabular-nums text-ink"
                  title={
                    lcp === null
                      ? "lecture du LCP en échec"
                      : mesure
                        ? `p75 de ${compte(mesure.n, "mesure LCP", "mesures LCP")} de la route sur la période`
                        : "aucune mesure LCP de cette route sur la période"
                  }
                >
                  {formater("ms", mesure?.p75 ?? null)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableDefilante>
  );
}
