// Un tableau de bord (§ 5.25). Rendu serveur.
//
// LIRE PAR DÉFAUT, ÉDITER SUR DEMANDE (recette du 26/09/2026). La page s'ouvre en
// lecture : chaque carte montre sa valeur, son verdict et son graphique, sans
// bouton d'écriture. « Éditer » (`?edition=1`, pour qui peut écrire) fait paraître
// ↑ ↓ ✕ sur les cartes et le panneau d'édition ; « Terminer l'édition » les retire.
// Le mode vit dans l'URL : une écriture réussie revalide la même adresse, et une
// écriture refusée y revient (`ctx` le transporte), sans sortir de l'édition.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import {
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  type WidgetType,
} from "@/lib/dashboards";
// F37 — sections de tableau de bord (W-B12).
import {
  MAX_WIDGETS,
  QUESTION_MAX,
  groupesDuLayout,
  layoutPlein,
  questionDeSection,
  type GroupeDeCartes,
} from "@/lib/dashboards";
import { addSectionAction, moveWidgetAction, removeWidgetAction } from "../actions";
import type { Fil } from "@mip/console-contract";
import type { AnalyticsQuery } from "@/lib/query-contract";
import { type SearchParams } from "@/lib/filters";
import { chargerTableau } from "@/lib/chargeurs/tableau";
import { chargerEcran } from "@/lib/ecran";
import { hrefWithQuery, queryToSearchParams } from "@/lib/query-contract";
import type { WidgetData } from "@/lib/widget-data";
import { estAdditive } from "@/lib/analytics-schema";
import { fenetresLues, type FenetreCollecte } from "@/lib/series";
import {
  addWidgetAction,
  cloneDashboardAction,
  deleteDashboardAction,
  renameDashboardAction,
} from "../actions";
import { PrintButton } from "./PrintButton";
import { INPUT_CLASS } from "@/components/forms/Field";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
// F36 — barre de population (W-B1) et réglages d'affichage de l'écran (§ 3.1).
import { PopulationBar } from "@/components/PopulationBar";
import { resumePopulation, retraitsDePopulation } from "@/lib/explorer-page-params";
import { paramReader, rangeLabel } from "@/lib/query-contract";
import { contextHref, lireComparaison } from "@/lib/view-state";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";

export const dynamic = "force-dynamic";

/**
 * Une carte occupe-t-elle toute la largeur de sa rangée (§ 5.25.3) ? Une série et
 * un journal, oui : un axe de temps ou une table de colonnes comprimés dans un
 * tiers de page cessent d'être lisibles. Une valeur ou un classement en barres tiennent
 * dans une case. Un classement NON additif (p75, moyenne : la table d'impact) aussi a
 * besoin de la rangée (recette du 30/09/2026) : dans une demi-page, chacune de ses
 * lignes passait sur quatre lignes, 1 057 px pour dix routes à côté d'une carte de
 * 361 px. La règle se lit sur la DONNÉE rendue, pas sur un champ enregistré.
 */
function pleineLargeur(data: Fil<WidgetData> | undefined): boolean {
  if (data?.kind === "timeseries" || data?.kind === "table") return true;
  return data?.kind === "toplist" && data.analyse !== undefined && !estAdditive(data.analyse.plan.measure.aggregation);
}

/** Ce que chaque carte de la grille reçoit, quel que soit son groupe. */
interface ContexteCartes {
  id: number;
  /** Éléments du layout, sections comprises : la position « 2 sur 10 » les compte. */
  count: number;
  revision: string;
  ctx: string;
  query: AnalyticsQuery;
  editable: boolean;
  /** Mode édition (`?edition=1`) : seul lui montre ↑ ↓ ✕ et les réglages de carte. */
  edition: boolean;
  /** Donnée résolue, rangée dans l'ordre du layout (une entrée par élément), telle que le fil la porte. */
  data: Fil<WidgetData>[];
  /** Fenêtres hors collecte lues par le chargeur (`undefined` : lecture en échec, rien n'est hachuré). */
  fenetresCollecte?: readonly FenetreCollecte[];
}

/**
 * Grille 1 / 2 / 3 colonnes (§ 5.25.3). Une série ou un journal prennent TOUTE la
 * largeur de leur rangée : une courbe de 24 seaux dans un tiers de page n'a plus
 * d'axe lisible. La largeur découle du TYPE de la carte — aucun champ de taille
 * n'est stocké, donc aucun changement de schéma.
 */
function GrilleDeCartes({ cartes, c }: { cartes: GroupeDeCartes["cartes"]; c: ContexteCartes }) {
  // Deux cartes étroites dans une grille de trois colonnes laissaient un tiers vide,
  // et la dernière carte collée à son texte (« Par segment », recette du 26/09/2026) :
  // deux cartes, deux colonnes.
  const etroites = cartes.filter(({ index }) => !pleineLargeur(c.data[index])).length;
  const deuxColonnes = etroites === 2;
  return (
    // Gouttière de 8 px ; chaque carte prend la hauteur de sa rangée (bords bas alignés).
    <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 ${deuxColonnes ? "" : "xl:grid-cols-3"}`}>
      {cartes.map(({ index, widget }) => (
        <div
          key={index}
          className={
            pleineLargeur(c.data[index])
              ? `min-w-0 md:col-span-2 ${deuxColonnes ? "" : "xl:col-span-3"}`
              : "min-w-0 [&>div]:h-full"
          }
        >
          <WidgetCard
            id={c.id}
            index={index}
            count={c.count}
            widget={widget}
            data={c.data[index]}
            revision={c.revision}
            ctx={c.ctx}
            query={c.query}
            editable={c.editable}
            edition={c.edition}
            fenetresCollecte={c.fenetresCollecte}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Une section (F37, W-B12) : son titre en `h2`, la question à laquelle ses cartes
 * répondent, repliable (`<details open>`, Grafana « row »). Le `<summary>` est le
 * seul contrôle : il se replie à l'entrée ou à l'espace, sans script. Le groupe est
 * NOMMÉ (`group/section`) : un `group` nu ferait réagir au survol de la section les
 * bulles d'aide des cartes (`InfoTip`, qui s'ouvrent sur `group-hover`).
 */
function SectionDuTableau({
  section,
  cartes,
  c,
}: {
  section: NonNullable<GroupeDeCartes["section"]>;
  cartes: GroupeDeCartes["cartes"];
  c: ContexteCartes;
}) {
  const { index, widget } = section;
  const question = questionDeSection(widget);
  return (
    <details open className="group/section min-w-0" data-testid={`section-${index}`}>
      <summary className="cursor-pointer list-none rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf [&::-webkit-details-marker]:hidden">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-ink">
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3 w-3 shrink-0 fill-current text-ink-soft transition-transform group-open/section:rotate-90 motion-reduce:transition-none"
          >
            <path d="M4 2l5 4-5 4z" />
          </svg>
          <span className="min-w-0 break-words">{widget.title}</span>
        </h2>
        {question && (
          <span className="mt-0.5 block break-words pl-5 text-xs text-ink-soft" data-testid={`section-${index}-question`}>
            {question}
          </span>
        )}
      </summary>
      <div className="mt-2">
        {cartes.length ? (
          <GrilleDeCartes cartes={cartes} c={c} />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-soft">
            Aucune carte dans cette section.
            {c.editable && c.edition ? " Une carte y entre par ses boutons ↑ ↓." : ""}
          </p>
        )}
      </div>
    </details>
  );
}

export default async function D({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/tableau.ts`) résout le tableau par la porte unique
  // des tableaux, lit ses cartes et décide des droits d'édition.
  const ecran = await chargerEcran(ECRANS.tableau, chargerTableau, sp, { id });
  if (ecran.etat === "introuvable") notFound();
  if (ecran.etat === "refus") return <FilterProblemNotice title={ecran.titre} problem={ecran.problem} />;
  const { tableau: dash, timeZone, data, apps, nomsApps } = ecran;
  const reader = paramReader(sp);
  const reglages = lireComparaison(`/dashboards/${dash.id}`, reader);
  const nomApp = (appId: string) => nomsApps[appId] ?? appId;

  // W-B1 — la population lue, écrite au-dessus de la grille, y compris à « toutes
  // les apps » : chaque carte en hérite. La requête affichée est celle des cartes,
  // pas celle de l'URL : le tableau peut restreindre l'app de l'écran.
  const populationQuery = ecran.population;
  const retraits = retraitsDePopulation(populationQuery, (sans) =>
    hrefWithQuery(`/dashboards/${dash.id}`, sans),
  );
  const puces = resumePopulation(populationQuery, timeZone, nomApp).map((libelle) => ({
    libelle,
    ...(retraits[libelle] ? { retirerHref: retraits[libelle] } : {}),
  }));

  const exportHref = hrefWithQuery(`/api/dashboards/${dash.id}/export`, ecran.query);
  const scope = dash.app_id === null ? "toutes les applications" : nomApp(dash.app_id);
  const { editable, clonable, global: canUseGlobal } = ecran.droits;
  // Le mode édition n'existe que pour qui peut écrire : `?edition=1` tapé par un
  // lecteur (ou une démo, V9) ne rend aucun geste d'écriture.
  const edition = editable && reader.get("edition") === "1";
  const lienLecture = contextHref(`/dashboards/${dash.id}`, reader);
  const lienEdition = `${lienLecture}${lienLecture.includes("?") ? "&" : "?"}edition=1`;
  // Les filtres de l'écran voyagent avec chaque formulaire ; en édition, le mode
  // aussi : une écriture refusée ramène sur la page en édition, pas en lecture.
  const contexte = [queryToSearchParams(ecran.query).toString(), edition ? "edition=1" : ""].filter(Boolean).join("&");
  // Intersection vide : le tableau de bord porte sur une autre app que celle de l'écran.
  const horsPerimetre = populationQuery.scope.effectiveApps?.length === 0;
  const conflit = sp.conflit === "1";
  const refus = sp.refus === "1";
  const invalides = dash.layout.filter((w) => w.kind === "invalid").length;
  // F37 — la grille en groupes (une section et ses cartes) ; sans section, une seule
  // grille. « Ajouter une section » : même garde que l'action (`add_widget`, c'est-à-
  // dire `canMutateDashboard`) — jamais un viewer non propriétaire ni une démo (V9).
  const groupes = groupesDuLayout(dash.layout);
  const sections = groupes.flatMap((g) => (g.section ? [g.section] : []));
  const peutAjouterSection = ecran.droits.sections;
  const plein = layoutPlein(dash.layout);
  const refusPlein = sp.plein === "1";
  const refusSection = sp["section-refusee"] === "1";
  const contexteCartes: ContexteCartes = {
    id: dash.id,
    count: dash.layout.length,
    revision: dash.revision,
    ctx: contexte,
    query: ecran.query,
    editable,
    edition,
    data,
    fenetresCollecte: fenetresLues(ecran.fenetresCollecte),
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={dash.name}>
        <Link href="/dashboards" className="btn-ghost">
          ← Tous
        </Link>
        {editable &&
          (edition ? (
            <Link href={lienLecture} className="btn-accent" data-testid="terminer-edition">
              Terminer l’édition
            </Link>
          ) : (
            <Link href={lienEdition} className="btn-ghost" data-testid="mode-edition">
              Éditer
            </Link>
          ))}
        {clonable && (
          <form action={cloneDashboardAction}>
            <input type="hidden" name="id" value={dash.id} />
            <button type="submit" data-testid="clone-dashboard" className="btn-ghost">
              Dupliquer
            </button>
          </form>
        )}
        <a href={exportHref} className="btn-ghost" data-testid="export-csv">
          Export CSV
        </a>
        <PrintButton />
      </PageHeader>

      {/* Le périmètre et le propriétaire du tableau, en pastilles (l'en-tête ne porte
          plus de sous-titre depuis le 30/09/2026) : une carte n'a pas de sens sans eux. */}
      <p className="-mt-3 mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft" data-testid="tableau-perimetre">
        <span className="rounded-full bg-panel2 px-2 py-0.5">Application : {scope}</span>
        <span className="rounded-full bg-panel2 px-2 py-0.5">Propriétaire : {ecran.proprietaire}</span>
        {/* La plage lue est écrite juste dessous, par la barre de population. */}
        <span className="sr-only">{ecran.label}</span>
      </p>
      <PopulationBar puces={puces} plage={rangeLabel(populationQuery.range, timeZone)} fuseau={FUSEAU_AFFICHAGE} />

      {reglages.ignores.map((ligne) => (
        <p key={ligne} role="note" className="mb-4 text-xs text-ink-soft">
          {ligne}
        </p>
      ))}

      {conflit && (
        <p
          role="alert"
          data-testid="dashboard-conflit"
          className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft"
        >
          Ce tableau de bord a changé depuis son affichage : rien n’a été écrit, pour ne pas effacer la modification
          d’un autre onglet. Cette page montre maintenant la version à jour — refaire le geste si nécessaire.
        </p>
      )}
      {refus && (
        <p
          role="alert"
          data-testid="dashboard-refus"
          className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft"
        >
          Modification refusée : la valeur soumise n’est pas applicable à cette carte. Rien n’a été écrit.
        </p>
      )}
      {refusPlein && (
        <p
          role="alert"
          data-testid="dashboard-plein"
          className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft"
        >
          Rien n’a été ajouté : ce tableau de bord compte déjà {MAX_WIDGETS} éléments, sections comprises — la limite
          d’un tableau. Retirer une carte ou une section avant d’en ajouter une autre.
        </p>
      )}
      {refusSection && (
        <p
          role="alert"
          data-testid="dashboard-section-refusee"
          className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft"
        >
          Section refusée : son titre est vide, ou la position demandée n’existe plus. Rien n’a été écrit.
        </p>
      )}

      {horsPerimetre && (
        <p role="status" data-testid="dashboard-hors-perimetre" className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft">
          Ce tableau de bord porte sur {dash.app_id === null ? "toutes les applications" : nomApp(dash.app_id)}, hors de
          l&apos;application sélectionnée : ses cartes ne remplacent pas l&apos;application de l&apos;écran et restent
          vides. Changez de projet pour le lire.
        </p>
      )}

      {invalides > 0 && (
        <p role="status" data-testid="dashboard-invalides" className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-soft">
          {invalides === 1 ? "Une carte n’est pas lisible" : `${invalides} cartes ne sont pas lisibles`} : leur
          configuration est conservée telle quelle et affichée en diagnostic. {editable
            ? "La corriger revient à la retirer puis à l’enregistrer de nouveau depuis l’Explorer."
            : "Un administrateur de cette app peut la corriger."}
        </p>
      )}

      {edition && (
        <p role="note" data-testid="bandeau-edition" className="mb-3 rounded-lg border border-line bg-panel2/60 px-3 py-2 text-xs text-ink-soft">
          Mode édition : ↑ ↓ rangent les cartes, ✕ en retire une. Ajouter une carte ou une section, renommer ou
          supprimer le tableau : en bas de page.
        </p>
      )}

      {/* ----- Grille de widgets, par sections (F37) ----- */}
      {dash.layout.length ? (
        // Une section titre les cartes qui la suivent, jusqu'à la suivante ; les
        // cartes posées avant la première section forment une grille sans titre.
        // Sans aucune section : une grille unique, comme avant F37.
        <div className="flex flex-col gap-5">
          {groupes.map((g) =>
            g.section === null ? (
              <GrilleDeCartes key="sans-section" cartes={g.cartes} c={contexteCartes} />
            ) : (
              <SectionDuTableau key={g.section.index} section={g.section} cartes={g.cartes} c={contexteCartes} />
            ),
          )}
        </div>
      ) : (
        <p className="card flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs text-ink-soft">
          <span aria-hidden className="text-ink-faint">
            ⊘
          </span>
          Aucune carte dans ce tableau de bord.
          {editable
            ? " Ajoutez-en une en mode édition, ou enregistrez une analyse depuis l’Explorer."
            : ""}
        </p>
      )}

      {/* ----- Édition : seulement en mode édition, pour qui peut écrire ----- */}
      {edition && <section className="card mt-5" data-testid="edit-panel" aria-labelledby="edition-titre">
        <h2 id="edition-titre" className="px-3 py-2 text-xs font-semibold text-ink">
          Éditer le tableau de bord
        </h2>
        <div className="flex flex-col gap-4 border-t border-line p-3">
          {/* F37 — 24 éléments, sections comprises : plus rien ne s'ajoute, et la page
              le dit au lieu de proposer un geste que l'action refuserait. */}
          {plein && (
            <p role="note" data-testid="tableau-plein" className="text-xs text-ink-soft">
              Ce tableau compte {MAX_WIDGETS} éléments sur {MAX_WIDGETS}, sections comprises : retirer une carte ou une
              section avant d’en ajouter une.
            </p>
          )}
          {/* Ajouter un widget */}
          {!plein && <form action={addWidgetAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={dash.id} />
            <input type="hidden" name="revision" value={dash.revision} />
            <input type="hidden" name="ctx" value={contexte} />
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Type de carte
              <select name="type" defaultValue={WIDGET_TYPES[0]} className={INPUT_CLASS}>
                {WIDGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WIDGET_META[t as WidgetType].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Métrique (vital)
              <select name="metric" defaultValue="LCP" className={INPUT_CLASS}>
                {WIDGET_VITALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Nom d’événement (carte « Événements »)
              <input name="event_name" placeholder="checkout" maxLength={100} className={`${INPUT_CLASS} w-44`} />
            </label>
            <button type="submit" data-testid="add-widget" className="btn-accent">
              + Ajouter une carte
            </button>
          </form>}

          <p className="text-xs text-ink-faint">
            Pour une analyse libre (jeu de données, mesure, regroupement, représentation), la composer dans
            l&apos;
            <Link href={hrefWithQuery("/explorer", ecran.query)} className="text-accent hover:underline">
              Explorer
            </Link>{" "}
            puis l&apos;enregistrer sur ce tableau de bord.
          </p>

          {/* F37 (W-B12) — sections : les ranger, les retirer, en ajouter une. Même garde
              que l'action serveur (`add_widget`) : ce bloc n'existe pas pour qui ne peut
              pas écrire. */}
          {peutAjouterSection && (
            <div
              role="group"
              aria-labelledby="sections-edition-titre"
              className="flex min-w-0 flex-col gap-3"
              data-testid="sections-edition"
            >
              <p id="sections-edition-titre" className="text-xs font-semibold text-ink-soft">
                Sections
              </p>
              <p className="text-xs text-ink-soft">
                Une section titre les cartes qui la suivent, jusqu’à la section suivante ; une carte change de section
                par ses boutons ↑ ↓. Une section compte parmi les {MAX_WIDGETS} éléments d’un tableau.
              </p>
              {sections.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {sections.map(({ index, widget }) => {
                    const position = `${index + 1} sur ${dash.layout.length}`;
                    return (
                      <li key={index} className="flex min-w-0 flex-wrap items-center gap-2 text-sm" data-testid={`section-${index}-edition`}>
                        <span className="min-w-0 flex-1 break-words">
                          « {widget.title} » — {position}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <form action={moveWidgetAction}>
                            <input type="hidden" name="id" value={dash.id} />
                            <input type="hidden" name="index" value={index} />
                            <input type="hidden" name="revision" value={dash.revision} />
                            <input type="hidden" name="ctx" value={contexte} />
                            <input type="hidden" name="dir" value="up" />
                            <button
                              type="submit"
                              disabled={index === 0}
                              aria-label={`Monter le titre de section « ${widget.title} » d’une place — ${position}`}
                              className="btn-ghost px-2 py-1 disabled:opacity-30"
                            >
                              ↑
                            </button>
                          </form>
                          <form action={moveWidgetAction}>
                            <input type="hidden" name="id" value={dash.id} />
                            <input type="hidden" name="index" value={index} />
                            <input type="hidden" name="revision" value={dash.revision} />
                            <input type="hidden" name="ctx" value={contexte} />
                            <input type="hidden" name="dir" value="down" />
                            <button
                              type="submit"
                              disabled={index === dash.layout.length - 1}
                              aria-label={`Descendre le titre de section « ${widget.title} » d’une place — ${position}`}
                              className="btn-ghost px-2 py-1 disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </form>
                          {/* Retirer une section se confirme, comme retirer une carte
                              (contre-recette du 26/09/2026) : le ✕ partait en un clic. */}
                          <form action={removeWidgetAction}>
                            <input type="hidden" name="id" value={dash.id} />
                            <input type="hidden" name="index" value={index} />
                            <input type="hidden" name="revision" value={dash.revision} />
                            <input type="hidden" name="ctx" value={contexte} />
                            <ConfirmationDanger
                              libelle="✕"
                              libelleAccessible={`Retirer la section ${entreGuillemets(widget.title)} — ${position}`}
                              question={`Retirer la section ${entreGuillemets(widget.title)} de ce tableau de bord\u00a0?`}
                              consequence="Seul le titre de section disparaît : ses cartes restent sur le tableau de bord."
                              confirmer="Retirer la section"
                              enCours="Retrait…"
                              flottant
                              classeDeclencheur="btn-ghost px-2 py-1 text-bad-ink"
                              testid={`section-${index}-retirer`}
                            />
                          </form>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!plein && (
                <form action={addSectionAction} className="flex min-w-0 flex-wrap items-end gap-3" data-testid="ajouter-section">
                  <input type="hidden" name="id" value={dash.id} />
                  <input type="hidden" name="revision" value={dash.revision} />
                  <input type="hidden" name="ctx" value={contexte} />
                  <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
                    Titre de la section
                    <input
                      name="title"
                      required
                      maxLength={60}
                      placeholder="Par segment"
                      className={`${INPUT_CLASS} w-56 max-w-full`}
                    />
                  </label>
                  <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
                    Question à laquelle elle répond (facultative)
                    <input
                      name="question"
                      maxLength={QUESTION_MAX}
                      placeholder="Où les pages sont-elles lentes ?"
                      className={`${INPUT_CLASS} w-72 max-w-full`}
                    />
                  </label>
                  <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
                    Position
                    <select
                      name="position"
                      defaultValue={String(dash.layout.length)}
                      className={`${INPUT_CLASS} w-72 max-w-full`}
                    >
                      {dash.layout.map((w, i) => (
                        <option key={i} value={i}>
                          {`Avant ${w.kind === "section" ? "la section " : ""}« ${w.title} » (${i + 1} sur ${dash.layout.length})`}
                        </option>
                      ))}
                      <option value={dash.layout.length}>En fin de tableau</option>
                    </select>
                  </label>
                  <button type="submit" data-testid="add-section" className="btn-ghost">
                    + Ajouter une section
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Renommer / re-scoper */}
          <form action={renameDashboardAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={dash.id} />
            <input type="hidden" name="revision" value={dash.revision} />
            <input type="hidden" name="ctx" value={contexte} />
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Nom
              <input
                name="name"
                required
                defaultValue={dash.name}
                className={`${INPUT_CLASS} w-56`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Application
              <select name="app_id" defaultValue={dash.app_id ?? ""} className={INPUT_CLASS}>
                {canUseGlobal && <option value="">Toutes les applications</option>}
                {apps.map((a) => (
                  <option key={a} value={a}>
                    {nomApp(a)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-ghost">
              Enregistrer
            </button>
          </form>

          {/* Supprimer */}
          {/* La suppression efface la ligne (aucune corbeille) : elle se confirme. */}
          <form action={deleteDashboardAction}>
            <input type="hidden" name="id" value={dash.id} />
            <ConfirmationDanger
              libelle="Supprimer ce tableau de bord"
              question={`Supprimer le tableau de bord ${entreGuillemets(dash.name)}\u00a0?`}
              consequence="Ses cartes et ses sections seront effacées définitivement ; les données collectées, elles, restent."
              confirmer="Supprimer le tableau de bord"
              enCours="Suppression…"
              testid="delete-dashboard"
            />
          </form>
        </div>
      </section>}
    </div>
  );
}
