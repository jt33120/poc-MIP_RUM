import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import {
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  type WidgetType,
} from "@/lib/dashboards";
import { type SearchParams } from "@/lib/filters";
import { registeredApps } from "@/lib/queries";
import { getUser } from "@/lib/auth";
import {
  canCreateDashboard,
  canDashboardAction,
  dashboardApps,
  dashboardFilters,
  dashboardPrincipal,
  getAccessibleDashboard,
  ownerLabel,
} from "@/lib/dashboard-access";
import { pageFilters } from "@/lib/page-filters";
import { queryOf } from "@/lib/filters";
import { fuseauDe } from "@/lib/fuseau";
import { hrefWithQuery, queryToSearchParams } from "@/lib/query-contract";
import { resolveWidgets } from "@/lib/widget-data";
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

export const dynamic = "force-dynamic";

export default async function D({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const idNum = Number(id);
  const user = await dashboardPrincipal(await getUser());
  const dash = Number.isInteger(idNum) ? await getAccessibleDashboard(idNum, user) : null;
  if (!dash) notFound();

  const sp = (await searchParams) ?? {};
  const ecran = await pageFilters(sp, `/dashboards/${dash.id}`);
  if (!ecran.ok) return <FilterProblemNotice title={dash.name} problem={ecran.problem} />;
  const f = dashboardFilters(dash, ecran.query, user);
  if (!f) notFound();

  const timeZone = await fuseauDe(ecran.query.scope.requestedApp);
  // Quatre lectures à la fois, dans l'ordre de la grille. Vingt-quatre cartes
  // lancées ensemble épuiseraient le pool de connexions de la console.
  const data = await resolveWidgets(dash.layout, { filters: f, timeZone, nowMs: Date.now() });
  const apps = dashboardApps(await registeredApps(), user);

  const contexte = queryToSearchParams(ecran.query).toString();
  const exportHref = hrefWithQuery(`/api/dashboards/${dash.id}/export`, ecran.query);
  const scope = dash.app_id ?? "toutes les apps";
  const editable = canDashboardAction(user, dash, "rename");
  const clonable = canDashboardAction(user, dash, "clone");
  const canUseGlobal = canCreateDashboard(user, null);
  // Intersection vide : le tableau de bord porte sur une autre app que celle de l'écran.
  const horsPerimetre = queryOf(f).scope.effectiveApps?.length === 0;
  const conflit = sp.conflit === "1";
  const refus = sp.refus === "1";
  const invalides = dash.layout.filter((w) => w.kind === "invalid").length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={dash.name}
        sub={
          <>
            Scope : {scope} · Propriétaire : {ownerLabel(dash, user)} · {ecran.label}
            {ecran.query.filters.device ? ` · ${ecran.query.filters.device}` : ""}
          </>
        }
      >
        <Link href="/dashboards" className="btn-ghost">
          ← Tous
        </Link>
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

      {conflit && (
        <p
          role="alert"
          data-testid="dashboard-conflit"
          className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft"
        >
          Ce tableau de bord a changé depuis son affichage : rien n’a été écrit, pour ne pas effacer la modification
          d’un autre onglet. Cette page montre maintenant la version à jour — refaire le geste si nécessaire.
        </p>
      )}
      {refus && (
        <p
          role="alert"
          data-testid="dashboard-refus"
          className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft"
        >
          Modification refusée : la valeur soumise n’est pas applicable à cette carte. Rien n’a été écrit.
        </p>
      )}

      {horsPerimetre && (
        <p role="status" data-testid="dashboard-hors-perimetre" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Ce tableau de bord porte sur {dash.app_id}, hors de l&apos;app sélectionnée : ses widgets ne remplacent pas
          l&apos;app de l&apos;écran et restent vides. Change de projet pour le lire.
        </p>
      )}

      {invalides > 0 && (
        <p role="status" data-testid="dashboard-invalides" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {invalides === 1 ? "Une carte n’est pas lisible" : `${invalides} cartes ne sont pas lisibles`} : leur
          configuration est conservée telle quelle et affichée en diagnostic. {editable
            ? "La corriger revient à la retirer puis à l’enregistrer de nouveau depuis l’Explorer."
            : "Un administrateur de cette app peut la corriger."}
        </p>
      )}

      {/* ----- Grille de widgets ----- */}
      {dash.layout.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {dash.layout.map((w, i) => (
            <WidgetCard
              key={i}
              id={dash.id}
              index={i}
              count={dash.layout.length}
              widget={w}
              data={data[i]}
              revision={dash.revision}
              ctx={contexte}
              editable={editable}
            />
          ))}
        </div>
      ) : (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucun widget — ajoute-en via « Éditer le tableau de bord » ci-dessous, ou enregistre une analyse depuis
          l&apos;Explorer.
        </p>
      )}

      {/* ----- Édition ----- */}
      {editable && <details className="card mt-8" data-testid="edit-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          Éditer le tableau de bord
        </summary>
        <div className="flex flex-col gap-6 border-t border-line p-4">
          {/* Ajouter un widget */}
          <form action={addWidgetAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={dash.id} />
            <input type="hidden" name="revision" value={dash.revision} />
            <input type="hidden" name="ctx" value={contexte} />
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Type
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
              Nom d’événement (widget événements)
              <input name="event_name" placeholder="checkout" maxLength={100} className={`${INPUT_CLASS} w-44`} />
            </label>
            <button type="submit" data-testid="add-widget" className="btn-accent">
              + Ajouter un widget
            </button>
          </form>

          <p className="text-xs text-ink-faint">
            Pour une analyse libre (jeu de données, mesure, regroupement, représentation), la composer dans
            l&apos;
            <Link href={hrefWithQuery("/explorer", ecran.query)} className="text-accent hover:underline">
              Explorer
            </Link>{" "}
            puis l&apos;enregistrer sur ce tableau de bord.
          </p>

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
              App
              <select name="app_id" defaultValue={dash.app_id ?? ""} className={INPUT_CLASS}>
                {canUseGlobal && <option value="">(toutes apps)</option>}
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.app_id}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-ghost">
              Enregistrer
            </button>
          </form>

          {/* Supprimer */}
          <form action={deleteDashboardAction}>
            <input type="hidden" name="id" value={dash.id} />
            <button
              type="submit"
              data-testid="delete-dashboard"
              className="rounded-lg bg-bad-fond px-3 py-1.5 text-xs font-medium text-white transition hover:bg-bad-fond/90"
            >
              Supprimer ce tableau de bord
            </button>
          </form>
        </div>
      </details>}
    </div>
  );
}
