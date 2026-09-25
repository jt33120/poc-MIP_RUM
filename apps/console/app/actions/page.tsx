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
// la période précédente porte une flèche.
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { OngletsInteractions } from "@/components/perf/OngletsInteractions";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { breakdownDrillHref, refusDesSessions, sessionsDeLaRoute, type LienSessionsRoute } from "@/lib/breakdowns";
import { chargerActions } from "@/lib/chargeurs/actions";
import { type CouverturePrecedente } from "@/lib/comparaison";
import { chargerEcran } from "@/lib/ecran";
import { type SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { fmtDate } from "@/lib/format";
import { type SectionLue } from "@/lib/lecture";
import { referencePeriodePrecedente } from "@/lib/perf-domain";
import {
  ACTIONS_MAX_OFFSET,
  hasNextActionsPage,
  type ActionSummary,
  type TopActionRow,
} from "@/lib/queries-actions";
import { paramReader } from "@/lib/query-contract";
import { lireComparaison, lireEtatDeVue } from "@/lib/view-state";
import type { Fil } from "@mip/console-contract";

export const dynamic = "force-dynamic";

const SOUS_TITRE =
  "Interactions qui déclenchent le plus d’erreurs ou de temps réseau. La corrélation est heuristique, bornée à 5 secondes et figée au départ de chaque effet.";

/** Le cumul, nommé pour ce qu'il est — le titre de colonne ET l'alternative le disent. */
const TITRE_CUMUL = "Temps réseau lié, cumulé (toutes actions)";
const PHRASE_CUMUL = "Un cumul de visiteurs différents n’est le temps d’attente de personne.";

const PRECEDENTE_EN_ECHEC: CouverturePrecedente = {
  etat: "inconnue",
  raison: "lecture de la période précédente en échec",
};

type Ligne = Fil<TopActionRow>;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur de l'écran (`lib/chargeurs/actions.ts`) lit tout : filtres, présence
  // de la table, sections. La page ne calcule plus que ce qui vient de l'URL.
  const d = await chargerEcran(ECRANS.actions, chargerActions, sp);
  if (d.etat === "refus") return <FilterProblemNotice title="Actions" problem={d.problem} />;
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
        <PageHeader title="Actions" sub={SOUS_TITRE} />
        <OngletsInteractions actif="/actions" sp={lecteur} />
        <div data-testid="actions-non-collecte">
          <EtatSurface etat={d.nonCollecte} />
        </div>
      </div>
    );
  }

  const { query, label, page, prev, lignes, hero, resume, resumePrec } = d;
  const couverture = d.couverture ?? undefined;
  const schema = new Set(d.schema);
  const reference = prev ? referencePeriodePrecedente(query.range) : undefined;

  const href = (offset: number) => {
    const next = new URLSearchParams(url);
    if (offset > 0) next.set("offset", String(offset));
    else next.delete("offset");
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
      <PageHeader title="Actions" sub={SOUS_TITRE} />
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
        <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="note-cmp-release">
          Comparaison de releases : les tuiles d&apos;actions ne comparent que la période précédente ; aucun écart
          n&apos;est affiché ici.
        </p>
      )}

      {/* ── Zone 2 : KPI ×3 (§ 5.4.3). Neutres : aucun seuil publié (R-S). ── */}
      <SectionErreur titre="Actions, sessions et erreurs liées">
        <section aria-label={`Actions sur ${label}`} className="mb-4" data-testid="kpi-actions">
          {!resume.ok ? (
            <EchecLecture titre="Actions, sessions et erreurs liées" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="mt-3">
              <EtatSurface
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

      {/* ── Zone 3 : hero « Actions classées par erreurs liées » (barres NON empilées) ── */}
      <SectionErreur titre="Actions classées par erreurs liées">
        <div className="mb-6">
          <HeroActions
            hero={hero}
            label={label}
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
          <div className="card relative overflow-x-auto" data-testid="table-actions">
            <table className="w-full min-w-table table-fixed text-sm">
              <caption className="caption-top px-4 pt-3 text-left text-xs text-ink-soft">
                Actions de {label}, classées par erreurs liées. {PHRASE_CUMUL}
              </caption>
              <colgroup>
                <col className="w-64" />
                <col className="w-56" />
                {[0, 1, 2, 3, 4].map((column) => (
                  <col key={column} className="w-24" />
                ))}
                <col className="w-36" />
                <col className="w-44" />
                <col className="w-32" />
              </colgroup>
              <thead className="bg-panel2">
                <tr>
                  <th scope="col" className="th">Action</th>
                  <th scope="col" className="th">Route</th>
                  <th scope="col" className="th text-right">Actions</th>
                  <th scope="col" className="th text-right">Sessions</th>
                  <th scope="col" className="th text-right">Erreurs</th>
                  <th scope="col" className="th text-right">Ressources</th>
                  <th scope="col" className="th text-right">API</th>
                  <th scope="col" className="th text-right">Temps réseau lié (p75 par action)</th>
                  <th scope="col" className="th text-right">{TITRE_CUMUL}</th>
                  <th scope="col" className="th">Dernière vue</th>
                </tr>
              </thead>
              <tbody>
                {lignes.data.map((row) => (
                  <tr
                    key={`${row.app_id}|${row.name}|${row.type}|${row.route ?? ""}`}
                    className="border-t border-line/60 hover:bg-panel2/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{row.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                        <span className="rounded border border-line px-1.5 py-0.5">
                          {row.type === "click" ? "clic" : "manuelle"}
                        </span>
                        <span className="font-mono">{row.app_id}</span>
                      </div>
                    </td>
                    <td className="break-all px-4 py-3 font-mono text-xs text-ink-soft">{row.route ?? "(inconnue)"}</td>
                    <N value={row.actions} />
                    <N value={row.sessions} />
                    <N value={row.errors} />
                    {/* Ressources et API scindées : le compte, puis SON temps réseau —
                        les deux colonnes de `total_ms`, séparées (§ 5.4.3). */}
                    <NetMs compte={row.resources} ms={row.resource_ms} />
                    <NetMs compte={row.api_calls} ms={row.api_ms} />
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formater("ms", row.lie_p75_ms)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                      {formater("ms", row.total_ms)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">{fmtDate(row.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EtatSurface etat={{ kind: "vide", population: "action causale", plage: label }} />
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
  return (
    <>
      <KpiTile
        label={`Actions · ${label}`}
        valeur={resume.actions}
        format="count"
        reference={reference}
        {...comparaison((r) => r.actions)}
      />
      <KpiTile
        label="Sessions avec action"
        valeur={resume.sessions}
        format="count"
        lecture="sessions dans lesquelles au moins une action a été observée"
        reference={reference}
        {...comparaison((r) => r.sessions)}
      />
      <KpiTile
        label="Actions suivies d’une erreur"
        valeur={resume.error_clicks}
        format="count"
        sensMeilleur="bas"
        lecture={`actions dont le clic est suivi d’une erreur ; ${formater("count", resume.errors)} occurrences d’erreurs liées au total`}
        reference={reference}
        {...comparaison((r) => r.error_clicks)}
        href="#figure-actions-erreurs"
      />
    </>
  );
}

/** Libellé du lien vers les sessions de la route : il dit ce qu'il ouvre (ce n'est pas « N sessions »). */
const LIEN_SESSIONS_ROUTE = "Sessions passées par la route";

/** Hero : barres NON empilées, longueur = erreurs liées (§ 5.4.3). */
function HeroActions({
  hero,
  label,
  versErreurs,
  versSessions,
  refusSessions,
}: {
  hero: SectionLue<Ligne[]> | null;
  label: string;
  versErreurs: (route: string | null) => string | undefined;
  /** Sessions de la route d'une ligne ; `null` : route inconnue, ou refus commun (`refusSessions`). */
  versSessions: (route: string | null) => LienSessionsRoute | null;
  /** Pourquoi AUCUNE ligne n'ouvre les sessions de sa route (filtre que `/sessions` refuse) : dit une fois. */
  refusSessions: string | null;
}) {
  const titre = "Actions classées par erreurs liées";
  if (hero === null || !hero.ok) {
    return <Figure id="figure-actions-erreurs" titre={titre} etat={{ kind: "erreur", titre }} />;
  }
  const lignes = hero.data;
  if (!lignes.length) {
    return (
      <Figure
        id="figure-actions-erreurs"
        titre={titre}
        etat={{ kind: "vide", population: "action causale", plage: label }}
      />
    );
  }
  const data: RankDatum[] = lignes.map((row) => {
    const sessions = versSessions(row.route);
    return {
      label: row.name,
      value: row.errors,
      display: formater("count", row.errors),
      href: versErreurs(row.route),
      title: `${row.name} — ${row.route ?? "route inconnue"}`,
      sub: (
        <>
          {/* « N sessions » : celles qui ont FAIT l'action. Un nombre, jamais un lien. */}
          <span className="block truncate">
            {formater("count", row.actions)} actions · {formater("count", row.sessions)} sessions ·{" "}
            {formater("count", row.resources)} ressources · {formater("count", row.api_calls)} API
          </span>
          {sessions === null ? null : sessions.href !== null ? (
            <Link
              href={sessions.href}
              title={`Toutes les sessions passées par ${row.route}, qu’elles aient fait « ${row.name} » ou non`}
              className="block truncate rounded text-ink-soft underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              data-testid="actions-sessions-route"
            >
              {LIEN_SESSIONS_ROUTE}
            </Link>
          ) : (
            // Route que la recherche exacte refuserait : le libellé reste, en texte, avec sa raison.
            <span className="relative block truncate text-ink-soft" title={sessions.raison}>
              Sessions de la route non proposées<span className="sr-only"> — {sessions.raison}</span>
            </span>
          )}
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
          <span>
            {lignes.length} action{lignes.length > 1 ? "s" : ""} au plus ; la suite dans la table
          </span>
        </>
      }
      lecture={
        <>
          La longueur d’une barre ne porte QUE les erreurs liées : ressources et appels API sont des colonnes de la
          table, pas des portions empilées — un temps réseau n’est pas un échec. Le libellé ouvre les erreurs de la
          route de l’action ; le nom de l’action n’est pas une dimension du contrat, il ne filtre rien. « N sessions »
          compte les sessions qui ont fait l’action ; « {LIEN_SESSIONS_ROUTE} » ouvre toutes celles de sa route,
          qu’elles l’aient faite ou non.
          {refusSessions !== null && (
            <span className="mt-1 block" data-testid="actions-sessions-refus">
              {refusSessions}
            </span>
          )}
        </>
      }
    >
      <RankBar data={data} legende={`${titre}, ${label}`} labelWidth="13rem" />
    </Figure>
  );
}

function N({ value }: { value: number }) {
  return <td className="px-4 py-3 text-right tabular-nums">{value.toLocaleString("fr-FR")}</td>;
}

/** Un compte et SON temps réseau : « 12 » puis « 1,2 s », jamais fondus en un seul. */
function NetMs({ compte, ms }: { compte: number; ms: number }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums">
      <div>{compte.toLocaleString("fr-FR")}</div>
      <div className="text-xs text-ink-faint">{formater("ms", ms)}</div>
    </td>
  );
}
