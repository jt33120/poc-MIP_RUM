// Interactions, onglet Actions (F24, plan § 5.4.3) — « quels gestes échouent, restent
// sans réponse ou font attendre ? », côté gestes.
//
// TROIS DÉCISIONS DE CET ÉCRAN, ET LEUR RAISON.
//
//   1. AUCUNE BARRE EMPILÉE au hero. Empiler « erreurs », « ressources » et « appels
//      API » ferait lire « beaucoup de réseau » comme « beaucoup d'erreurs » : un
//      signal d'échec et une activité neutre n'ont pas la même unité de gravité. La
//      longueur d'une barre ne porte donc QUE les erreurs liées ; ressources et API
//      restent des colonnes de la table.
//   2. LE CUMUL EST NOMMÉ COMME TEL. « Temps lié » laissait croire à une attente
//      vécue : c'est la somme des temps réseau de visiteurs différents, et un cumul
//      de visiteurs différents n'est le temps d'attente de personne (même doctrine
//      que `LongtasksView.tsx`). La colonne le dit, et la p75 par action — elle, le
//      temps d'UNE action — est affichée à côté.
//   3. SANS LA TABLE `rum_action`, RIEN N'EST LU. `topActionsSummary` rendrait des
//      zéros, affichés « 0 action » — un vide réel là où rien n'a jamais été
//      collecté (V3). L'écran rend `non_collecte` et s'arrête.
//
// Aucune couleur de verdict sur ces mesures (R-S) : il n'existe aucun seuil publié
// pour un nombre d'erreurs liées à un geste. Les tuiles sont neutres, seul l'écart à
// la période précédente porte une flèche ; les barres sont d'une teinte neutre.
//
// RECETTE DU 26/09/2026. Le titre suit l'entrée de menu (« Interactions », comme
// l'onglet Frustration) ; l'onglet actif dit « Actions ». Le classement se choisit
// (erreurs liées ou temps réseau, paramètre `classer`) ; les noms d'action perdent
// leur préfixe technique (`button "…"`, `libelleAction`) ; deux barres d'un même
// libellé se distinguent par leur route ; un compte nul s'écrit « — » ; sous 640 px,
// chaque ligne de la table devient une carte.
import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS } from "@mip/console-contract";
import { BasculeTri } from "@/components/Breakdown";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { OngletsInteractions } from "@/components/perf/OngletsInteractions";
import { SOURCE_ACTIONS } from "@/components/perf/sources";
import { InfoTip } from "@/components/InfoTip";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { TableDefilante } from "@/components/TableDefilante";
import { breakdownDrillHref, refusDesSessions, sessionsDeLaRoute, type LienSessionsRoute } from "@/lib/breakdowns";
import { chargerActions } from "@/lib/chargeurs/actions";
import { type CouverturePrecedente } from "@/lib/comparaison";
import { chargerEcran } from "@/lib/ecran";
import { type SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { fmtDate, pluriel } from "@/lib/format";
import { ERROR_CLICK_WINDOW_MS } from "@/lib/frustration-regles";
import { libelleAction } from "@/lib/libelle-action";
import { type SectionLue } from "@/lib/lecture";
import { AUTRES } from "@/lib/palette";
import { referencePeriodePrecedente } from "@/lib/perf-domain";
import {
  ACTIONS_MAX_OFFSET,
  hasNextActionsPage,
  type ActionSummary,
  type OrdreActions,
  type TopActionRow,
} from "@/lib/queries-actions";
import { paramReader } from "@/lib/query-contract";
import { lireComparaison, lireEtatDeVue } from "@/lib/view-state";
import type { Fil } from "@mip/console-contract";

export const dynamic = "force-dynamic";

/** Le titre de l'entrée de menu, comme sur l'onglet Frustration (`/ux`). */
const TITRE = "Interactions";

const SOUS_TITRE = `Quels gestes des visiteurs déclenchent le plus d’erreurs ou de temps réseau\u00a0? Un effet est rattaché au geste qui le précède de moins de ${(
  ERROR_CLICK_WINDOW_MS / 1000
).toLocaleString("fr-FR")} secondes.`;

/** Le cumul, nommé pour ce qu'il est — le titre de colonne ET l'alternative le disent. */
const TITRE_CUMUL = "Temps réseau lié, cumulé (toutes actions)";
const PHRASE_CUMUL = "Un cumul de visiteurs différents n’est le temps d’attente de personne.";

/** Ce que dit chaque ordre, du titre du hero à la légende de la table. */
const ORDRES: Record<OrdreActions, { titre: string; bouton: string }> = {
  erreurs: { titre: "Actions classées par erreurs liées", bouton: "Erreurs liées" },
  reseau: { titre: "Actions classées par temps réseau cumulé", bouton: "Temps réseau" },
};

/** Teinte des barres : un compte ou une durée cumulée, sans seuil — neutre (gris du thème), jamais orange. */
const TEINTE_NEUTRE = AUTRES;

const PRECEDENTE_EN_ECHEC: CouverturePrecedente = {
  etat: "inconnue",
  raison: "lecture de la période précédente en échec",
};

type Ligne = Fil<TopActionRow>;

/** Aucune ressource ni appel API rattaché : le temps réseau n'existe pas, il ne vaut pas « 0 ms ». */
const sansReseau = (row: Ligne) => row.resources + row.api_calls === 0;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur de l'écran (`lib/chargeurs/actions.ts`) lit tout : filtres, présence
  // de la table, sections. La page ne calcule plus que ce qui vient de l'URL.
  const d = await chargerEcran(ECRANS.actions, chargerActions, sp);
  if (d.etat === "refus") return <FilterProblemNotice title={TITRE} problem={d.problem} />;
  const lecteur = paramReader(sp);
  const url = new URLSearchParams(
    Object.entries(sp).flatMap(([key, value]) => (typeof value === "string" ? [[key, value] as [string, string]] : [])),
  );

  // Réglages d'affichage (§ 3.1) : cet écran n'en lit aucun qui lui soit propre ; les
  // lignes ignorées sont celles d'un réglage posé par un autre écran et resté dans l'URL.
  const { etat: vue, ignores } = lireEtatDeVue("/actions", lecteur);
  const dejaDites = new Set(lireComparaison("/actions", lecteur).ignores);
  const avertissements = ignores.filter((l) => !dejaDites.has(l));

  if (d.etat === "non_collecte") {
    return (
      <div className="animate-fade-up">
        <PageHeader title={TITRE} sub={SOUS_TITRE} />
        <OngletsInteractions actif="/actions" sp={lecteur} />
        <div data-testid="actions-non-collecte">
          <EtatSurface etat={d.nonCollecte} />
        </div>
      </div>
    );
  }

  const { query, label, page, prev, ordre, lignes, hero, resume, resumePrec } = d;
  const couverture = d.couverture ?? undefined;
  const schema = new Set(d.schema);
  const reference = prev ? referencePeriodePrecedente(query.range) : undefined;
  // Plusieurs apps lues : une même action de deux apps fait deux lignes, qui le disent.
  const avecApp = query.scope.effectiveApps === null || query.scope.effectiveApps.length > 1;

  const href = (offset: number) => {
    const next = new URLSearchParams(url);
    if (offset > 0) next.set("offset", String(offset));
    else next.delete("offset");
    return `/actions${next.size ? `?${next}` : ""}`;
  };
  // Changer d'ordre repart de la première page : l'offset appartenait à l'autre classement.
  const hrefOrdre = (o: OrdreActions) => {
    const next = new URLSearchParams(url);
    next.delete("offset");
    if (o === "erreurs") next.delete("classer");
    else next.set("classer", o);
    return `/actions${next.size ? `?${next}` : ""}`;
  };
  // Le nom d'une action n'est PAS une dimension du contrat : le seul creusement
  // honnête part de sa route. Un lien `?action=` produirait un refus de filtre.
  const versErreurs = (route: string | null) =>
    route === null ? undefined : breakdownDrillHref("/errors", query, "route", route, schema);
  // Les sessions passées par la route (§ 5.4.3) — pas un drill-down : une session ne
  // porte pas de route, et `breakdownDrillHref` menait ici à `/pages`. Ce lien n'est
  // PAS le nombre « N sessions » : celui-là compte les sessions qui ont FAIT l'action,
  // la liste ouverte montre TOUTES celles passées par la route ; il porte donc son
  // propre libellé. Sous un filtre que `/sessions` refuse (release, env…), aucun
  // lien, et la raison est écrite une fois sous le hero (V10).
  const refusSessions = refusDesSessions(query, schema);
  const versSessions = (route: string | null): LienSessionsRoute | null =>
    route === null || refusSessions !== null ? null : sessionsDeLaRoute(query, route, schema);

  return (
    <div className="animate-fade-up">
      <PageHeader title={TITRE} sub={SOUS_TITRE} />
      {/* Onglets internes d'« Interactions » (F22) ; le reste de l'écran est F24. */}
      <OngletsInteractions actif="/actions" sp={lecteur} />

      {avertissements.length > 0 && (
        <div className="mb-4 space-y-1" data-testid="reglages-ignores">
          {avertissements.map((ligne) => (
            <p key={ligne} role="note" className="text-xs text-ink-soft">
              {ligne}
            </p>
          ))}
        </div>
      )}

      {vue.cmp === "release" && (
        <p
          role="note"
          className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-panel2 px-2.5 py-0.5 text-[11px] text-ink-soft"
          data-testid="note-cmp-release"
          title="Comparaison de releases : les tuiles d'actions ne comparent que la période précédente ; aucun écart n'est affiché ici."
        >
          <span aria-hidden className="text-ink-faint">
            ⊘
          </span>
          <span className="font-medium text-ink">Écarts non affichés</span>
          <span className="sr-only">
            {" "}
            — Comparaison de releases : les tuiles d&apos;actions ne comparent que la période précédente ; aucun écart
            n&apos;est affiché ici.
          </span>
        </p>
      )}

      {/* ── Zone 2 : KPI ×4 (§ 5.4.3). Neutres : aucun seuil publié (R-S). ── */}
      <SectionErreur titre="Actions, sessions et erreurs liées">
        <section aria-label={`Actions sur ${label}`} className="mb-4" data-testid="kpi-actions">
          {!resume.ok ? (
            <EchecLecture titre="Actions, sessions et erreurs liées" />
          ) : (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <TuilesActions
                resume={resume.data}
                resumePrec={resumePrec}
                reference={reference}
                couverture={couverture}
                label={label}
              />
            </div>
          )}
          {resume.ok && resume.data.sampling_notice && (
            <div className="mt-2">
              <EtatSurface
                compact
                etat={{
                  kind: "echantillonne",
                  probaMin: resume.data.sampling_notice.min_sample_rate,
                  unite: "session",
                  biaiseErreurs: true,
                }}
              />
            </div>
          )}
        </section>
      </SectionErreur>

      {/* Le classement se choisit : il gouverne le hero ET la table. */}
      <div className="mb-2 flex justify-end">
        <BasculeTri
          courant={ordre}
          options={(["erreurs", "reseau"] as const).map((o) => ({ id: o, libelle: ORDRES[o].bouton, href: hrefOrdre(o) }))}
        />
      </div>

      {/* ── Zone 3 : hero (barres NON empilées) ── */}
      <SectionErreur titre={ORDRES[ordre].titre}>
        <div className="mb-2">
          <HeroActions
            hero={hero}
            label={label}
            ordre={ordre}
            avecApp={avecApp}
            versErreurs={versErreurs}
            versSessions={versSessions}
            refusSessions={refusSessions}
          />
        </div>
      </SectionErreur>

      {/* ── Zone 4 : la table paginée ── */}
      <SectionErreur titre="Table des actions">
        {!lignes.ok ? (
          <EchecLecture titre="Table des actions" />
        ) : lignes.data.length ? (
          // Défilement SIGNALÉ au-delà de 640 px ; en dessous, une carte par ligne :
          // à 390 px, seules Action et Route se voyaient, tous les chiffres hors champ.
          <TableDefilante className="card" testId="table-actions" label="Table des actions">
            {/* Tableau DENSE (recette du 30/09/2026) : une ligne par action, 50 par page, qui
                défilent dans la carte sous un en-tête collant — la page faisait 5 000 px. */}
            <div className="max-h-[34rem] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
            <table className="block w-full text-sm sm:table sm:min-w-[67rem] sm:table-fixed">
              {/* La légende est lue, pas affichée : la phrase sur le cumul est dans la bulle
                  de sa colonne. */}
              <caption className="sr-only">
                Actions de {label}, {ORDRES[ordre].titre.replace("Actions classées", "classées")}. {PHRASE_CUMUL}
              </caption>
              {/* Neuf colonnes tenant dans la carte à 1 440 px : la route passe sous le nom
                  de l'action (elle avait sa colonne, et deux colonnes sortaient du champ). */}
              <colgroup>
                <col className="w-56" />
                {[0, 1, 2].map((column) => (
                  <col key={column} className="w-20" />
                ))}
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-28" />
              </colgroup>
              <thead className="hidden bg-panel2 sm:table-header-group">
                <tr>
                  <th scope="col" className="th">Action et route</th>
                  <th scope="col" className="th text-right">Actions</th>
                  <th scope="col" className="th text-right">Sessions</th>
                  <th scope="col" className="th text-right">Erreurs</th>
                  <th scope="col" className="th text-right">Ressources</th>
                  <th scope="col" className="th text-right">API</th>
                  <th scope="col" className="th text-right">Temps réseau lié (p75 par action)</th>
                  <th scope="col" className="th text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      {TITRE_CUMUL}
                      <InfoTip label="Ce que dit le cumul" align="end">
                        {PHRASE_CUMUL}
                      </InfoTip>
                    </span>
                  </th>
                  <th scope="col" className="th">Dernière vue</th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {lignes.data.map((row) => (
                  <tr
                    key={`${row.app_id}|${row.name}|${row.type}|${row.route ?? ""}`}
                    data-testid="action-ligne"
                    className="block border-t border-line/60 px-4 py-2 hover:bg-panel2/60 sm:table-row sm:p-0"
                  >
                    {/* Deux lignes courtes : le nom et son type, puis la route (et l'app). */}
                    <td className="block min-w-0 sm:table-cell sm:px-4 sm:py-1.5 sm:align-middle">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate font-semibold text-ink" title={libelleAction(row.name)}>
                          {libelleAction(row.name)}
                        </span>
                        <span className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-faint">
                          {row.type === "click" ? "clic" : "manuelle"}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-soft" title={row.route ?? "(route inconnue)"}>
                        {row.route ?? "(route inconnue)"}
                        {avecApp && <span className="text-ink-faint"> · {row.app_id}</span>}
                      </div>
                    </td>
                    <Nombre libelle="Actions">{row.actions.toLocaleString("fr-FR")}</Nombre>
                    <Nombre libelle="Sessions">{row.sessions.toLocaleString("fr-FR")}</Nombre>
                    <Nombre libelle="Erreurs">{row.errors.toLocaleString("fr-FR")}</Nombre>
                    {/* Ressources et API scindées : le compte, puis SON temps réseau —
                        les deux colonnes de `total_ms`, séparées (§ 5.4.3). */}
                    <NetMs libelle="Ressources" compte={row.resources} ms={row.resource_ms} />
                    <NetMs libelle="API" compte={row.api_calls} ms={row.api_ms} />
                    <Nombre libelle="p75 réseau par action" gras>
                      {sansReseau(row) ? "—" : formater("ms", row.lie_p75_ms)}
                    </Nombre>
                    <Nombre libelle="Réseau cumulé" doux>
                      {sansReseau(row) ? "—" : formater("ms", row.total_ms)}
                    </Nombre>
                    <td className="mt-1 block text-xs text-ink-faint sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:px-4 sm:py-1.5">
                      <span className="sm:hidden">Dernière vue : </span>
                      {fmtDate(row.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </TableDefilante>
        ) : (
          <EtatSurface etat={{ kind: "vide", population: "action", plage: label }} />
        )}
      </SectionErreur>

      <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination des actions">
        {page.offset > 0 ? (
          <Link
            className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            href={href(Math.max(0, page.offset - page.limit))}
          >
            Précédentes
          </Link>
        ) : (
          <span />
        )}
        {lignes.ok && hasNextActionsPage(page, lignes.data.length) && (
          <Link
            className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            href={href(Math.min(ACTIONS_MAX_OFFSET, page.offset + page.limit))}
          >
            Suivantes
          </Link>
        )}
      </nav>
    </div>
  );
}

/**
 * Les trois tuiles (§ 5.4.3). « Actions suivies d'une erreur » compte des ACTIONS
 * (le clic suivi d'une exception), pas des occurrences d'erreurs : les deux
 * libellés sont écrits, sans quoi le même mot désignerait deux populations.
 */
function TuilesActions({
  resume,
  resumePrec,
  reference,
  couverture,
  label,
}: {
  resume: ActionSummary;
  resumePrec: SectionLue<ActionSummary> | null;
  reference: string | undefined;
  couverture: CouverturePrecedente | undefined;
  label: string;
}) {
  const comparaison = (valeur: (r: ActionSummary) => number) =>
    resumePrec === null
      ? {}
      : !resumePrec.ok
        ? { precedent: null, couverturePrecedente: PRECEDENTE_EN_ECHEC }
        : { precedent: valeur(resumePrec.data), couverturePrecedente: couverture };
  // Les mêmes pieds de case partout : d'où vient le chiffre, en deux mots.
  const commun = { source: SOURCE_ACTIONS, categorie: "Navigateur · actions" } as const;
  return (
    <>
      <KpiTile
        label={`Actions · ${label}`}
        libelleCase="Actions"
        valeur={resume.actions}
        format="count"
        reference={reference}
        {...comparaison((r) => r.actions)}
        {...commun}
      />
      <KpiTile
        label="Sessions avec action"
        valeur={resume.sessions}
        format="count"
        methode="Sessions dans lesquelles au moins une action a été observée."
        reference={reference}
        {...comparaison((r) => r.sessions)}
        {...commun}
      />
      <KpiTile
        label="Actions suivies d’une erreur"
        valeur={resume.error_clicks}
        format="count"
        sensMeilleur="bas"
        lecture={`${pluriel(resume.errors, "occurrence d’erreur liée", "occurrences d’erreurs liées")} au total`}
        methode="Actions dont le clic est suivi d’une erreur. Une même action peut en déclencher plusieurs : le total des occurrences a sa propre case."
        reference={reference}
        {...comparaison((r) => r.error_clicks)}
        href="#figure-actions-erreurs"
        {...commun}
      />
      {/* Le total des occurrences, qui se lisait en phrase sous la case précédente, a sa
          case (recette du 30/09/2026) : une rangée de quatre, alignée sur la grille. */}
      <KpiTile
        label="Occurrences d’erreurs liées"
        libelleCase="Erreurs liées"
        valeur={resume.errors}
        format="count"
        sensMeilleur="bas"
        methode="Occurrences d’erreurs rattachées à une action : une même action peut en déclencher plusieurs."
        reference={reference}
        {...comparaison((r) => r.errors)}
        {...commun}
      />
    </>
  );
}

/** Libellé du lien vers les sessions de la route : il dit ce qu'il ouvre (ce n'est pas « N sessions »). */
const LIEN_SESSIONS_ROUTE = "Sessions passées par la route";

/** Hero : barres NON empilées ; longueur = erreurs liées, ou temps réseau cumulé (§ 5.4.3). */
function HeroActions({
  hero,
  label,
  ordre,
  avecApp,
  versErreurs,
  versSessions,
  refusSessions,
}: {
  hero: SectionLue<Ligne[]> | null;
  label: string;
  ordre: OrdreActions;
  avecApp: boolean;
  versErreurs: (route: string | null) => string | undefined;
  /** Sessions de la route d'une ligne ; `null` : route inconnue, ou refus commun (`refusSessions`). */
  versSessions: (route: string | null) => LienSessionsRoute | null;
  /** Pourquoi AUCUNE ligne n'ouvre les sessions de sa route (filtre que `/sessions` refuse) : dit une fois. */
  refusSessions: string | null;
}) {
  // L'ancre reste celle des erreurs : la tuile « Actions suivies d'une erreur » y mène.
  const titre = ORDRES[ordre].titre;
  if (hero === null || !hero.ok) {
    return <Figure id="figure-actions-erreurs" titre={titre} etat={{ kind: "erreur", titre }} />;
  }
  const lignes = hero.data;
  if (!lignes.length) {
    return <Figure id="figure-actions-erreurs" titre={titre} etat={{ kind: "vide", population: "action", plage: label }} />;
  }
  const data: RankDatum[] = lignes.map((row) => {
    const sessions = versSessions(row.route);
    const nom = libelleAction(row.name);
    const route = row.route ?? "route inconnue";
    const valeur = ordre === "reseau" ? (sansReseau(row) ? null : row.total_ms) : row.errors;
    return {
      label: nom,
      value: valeur,
      display: ordre === "reseau" ? (valeur === null ? "—" : formater("ms", valeur)) : formater("count", row.errors),
      color: TEINTE_NEUTRE,
      href: versErreurs(row.route),
      // Les comptes complets (ressources, appels API) en infobulle : ils sont aussi dans
      // la table, sous le classement (recette du 30/09/2026 : trois lignes par barre).
      title: `${nom} — ${route}${avecApp ? ` (${row.app_id})` : ""} — ${[
        pluriel(row.actions, "action"),
        pluriel(row.sessions, "session"),
        pluriel(row.errors, "erreur liée", "erreurs liées"),
        pluriel(row.resources, "ressource"),
        pluriel(row.api_calls, "appel API", "appels API"),
      ].join(" · ")}`,
      sub: (
        <>
          {/* La route sous le nom : deux actions de même nom sur deux routes sont deux
              barres, et la recette ne pouvait pas les distinguer. Puis « N sessions » :
              celles qui ont FAIT l'action — un nombre, jamais un lien. Une ligne. */}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 sm:flex-nowrap">
            <span className="min-w-0 truncate font-mono">
              {route}
              {avecApp ? ` · ${row.app_id}` : ""}
            </span>
            <span className="shrink-0">
              {[
                pluriel(row.actions, "action"),
                pluriel(row.sessions, "session"),
                // Sous le classement réseau, la barre dit le réseau : le sous-texte garde les erreurs.
                ...(ordre === "reseau" ? [pluriel(row.errors, "erreur liée", "erreurs liées")] : []),
              ].join(" · ")}
            </span>
            {/* Le lien vers les sessions de la route, sur la même ligne : la route se
                coupe (entière au survol) avant lui. */}
            {sessions === null ? null : sessions.href !== null ? (
              <Link
                href={sessions.href}
                title={`Toutes les sessions passées par ${row.route}, qu’elles aient fait « ${nom} » ou non`}
                className="shrink-0 rounded text-ink-soft underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                data-testid="actions-sessions-route"
              >
                {LIEN_SESSIONS_ROUTE}
              </Link>
            ) : (
              // Route que la recherche exacte refuserait : le libellé reste, en texte, avec sa raison.
              <span className="relative shrink-0 text-ink-soft" title={sessions.raison}>
                Sessions de la route non proposées<span className="sr-only"> — {sessions.raison}</span>
              </span>
            )}
          </span>
        </>
      ),
    };
  });
  return (
    <Figure
      id="figure-actions-erreurs"
      titre={titre}
      meta={
        <>
          <span>{label}</span>
          <span>{pluriel(lignes.length, "action")} au plus ; la suite dans la table</span>
        </>
      }
      lecture={
        <>
          {ordre === "reseau"
            ? `La longueur d’une barre est le temps réseau cumulé des actions (ressources et appels API) ; ${PHRASE_CUMUL.charAt(0).toLowerCase()}${PHRASE_CUMUL.slice(1)}`
            : "La longueur d’une barre ne porte que les erreurs liées : ressources et appels API sont dans la table, un temps réseau n’est pas un échec."}{" "}
          Le libellé ouvre les erreurs de la route où l’action a eu lieu (les erreurs ne se filtrent pas par action). « N
          sessions » compte les sessions qui ont fait l’action ; « {LIEN_SESSIONS_ROUTE} » ouvre toutes celles de sa route,
          qu’elles l’aient faite ou non.
          {refusSessions !== null && (
            <span className="mt-1 block" data-testid="actions-sessions-refus">
              {refusSessions}
            </span>
          )}
        </>
      }
    >
      <RankBar data={data} legende={`${titre}, ${label}`} labelWidth="28rem" />
    </Figure>
  );
}

/** Une cellule chiffrée : en carte sous 640 px, son libellé la précède et les chiffres s'alignent sur une ligne. */
function Nombre({
  libelle,
  children,
  gras = false,
  doux = false,
}: {
  libelle: string;
  children: ReactNode;
  gras?: boolean;
  doux?: boolean;
}) {
  return (
    <td
      className={`mr-4 mt-1 inline-flex items-baseline gap-1 text-xs tabular-nums sm:mr-0 sm:mt-0 sm:table-cell sm:px-4 sm:py-1.5 sm:text-right sm:align-middle sm:text-sm ${
        gras ? "sm:font-semibold" : ""
      } ${doux ? "sm:text-ink-soft" : ""}`}
    >
      <span className="text-ink-soft sm:hidden">{libelle}</span>
      {children}
    </td>
  );
}

/** Un compte et SON temps réseau : « 12 » puis « 1,2 s », jamais fondus en un seul ; aucun : « — ». */
function NetMs({ libelle, compte, ms }: { libelle: string; compte: number; ms: number }) {
  return (
    <td className="mr-4 mt-1 inline-flex items-baseline gap-1 text-xs tabular-nums sm:mr-0 sm:mt-0 sm:table-cell sm:px-4 sm:py-1.5 sm:text-right sm:align-middle sm:text-sm">
      <span className="text-ink-soft sm:hidden">{libelle}</span>
      {compte === 0 ? (
        "—"
      ) : (
        // Le compte, puis SON temps réseau en petit, sur la même ligne.
        <>
          <span>{compte.toLocaleString("fr-FR")}</span>
          <span className="text-[11px] text-ink-faint"> · {formater("ms", ms)}</span>
        </>
      )}
    </td>
  );
}
