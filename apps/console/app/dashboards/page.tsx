// Tableaux de bord — liste (§ 5.24). Rendu serveur.
//
// ORDRE DE LA PAGE (recette du 26/09/2026) : les tableaux du périmètre d'abord, la
// création juste dessous, puis les modèles fournis, repliables — ils ne passent en
// tête que lorsqu'il n'existe encore aucun tableau.
//
// F35 — L'ÉCRAN N'EST PLUS VIDE À LA PREMIÈRE VISITE. Il répond à « Quelles cartes
// surveiller ensemble ? » par les tableaux du périmètre ET par quatre modèles prêts
// à cloner (Performance, Erreurs, Usages, Releases ; `lib/dashboard-templates.ts`).
// Un modèle ne lit aucune donnée : c'est du texte et un bouton « Cloner ».
//
// CE QUE LA TABLE DIT DE CHAQUE TABLEAU (W-D2) : son app par son NOM (pas son
// identifiant), son propriétaire, et le TYPE de ses cartes en puces (« Valeur × 3 »,
// « Trafic ») plutôt qu'un nombre — un nombre ne dit pas ce qu'on y lira.
//
// LES ÉCRITURES NE SONT PROPOSÉES QU'À QUI PEUT ÉCRIRE (V9). Sans app où créer, ou
// en session de démonstration, ni « Cloner » ni formulaire de création ne sont
// rendus ; la raison est écrite à leur place. Un refus de création revient avec sa
// raison (`?creation=…`), écrite sous le champ (`role="alert"`).
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice, FiltersNotAppliedNote } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { ModeleCarte } from "@/components/dashboards/ModeleCarte";
import { TableDefilante } from "@/components/TableDefilante";
import { fmtDate, pluriel } from "@/lib/format";
import { type SearchParams } from "@/lib/filters";
import { chargerTableaux } from "@/lib/chargeurs/tableaux";
import { chargerEcran } from "@/lib/ecran";
import { MODELES_TABLEAUX, apercuDuModele } from "@/lib/dashboard-templates";
import { CONTRACT_PARAMS, hrefWithQuery, queryToSearchParams } from "@/lib/query-contract";
import { INPUT_CLASS } from "@/components/forms/Field";
import { createDashboardAction } from "./actions";

export const dynamic = "force-dynamic";

/** Raisons d'un refus de création, telles que l'action les renvoie (`?creation=`). */
const REFUS_CREATION: Record<string, { champ: "name" | "app_id" | "modele"; texte: string }> = {
  "nom-vide": { champ: "name", texte: "Le nom est vide : rien n’a été créé." },
  refus: {
    champ: "app_id",
    texte: "Création refusée : cette application n’est pas dans votre périmètre d’écriture. Rien n’a été créé.",
  },
  "modele-inconnu": { champ: "modele", texte: "Modèle inconnu : rien n’a été cloné." },
};

export default async function Dashboards({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/tableaux.ts`) lit les tableaux du périmètre et
  // décide, par le principal, où l'on peut créer et cloner.
  const ecran = await chargerEcran(ECRANS.tableaux, chargerTableaux, sp);
  // L'accès normal est garanti par le middleware. Ne pas afficher une liste
  // vide à un visiteur sans session évite néanmoins d'exposer ses métadonnées.
  if (ecran.etat === "sans_session") return null;
  if (ecran.etat === "refus") return <FilterProblemNotice title="Tableaux de bord" problem={ecran.problem} />;
  const { canCreateGlobal, appsCreables, clonage, tableaux: dashboards } = ecran;
  const peutCreer = canCreateGlobal || appsCreables.length > 0;
  // Les filtres de l'écran voyagent avec les formulaires : la redirection d'un refus
  // ramène sur la même population (seuls les paramètres du contrat sont repris).
  const ctx = new URLSearchParams(
    [...queryToSearchParams(ecran.query)].filter(([nom]) => (CONTRACT_PARAMS as readonly string[]).includes(nom)),
  ).toString();
  const refus = typeof sp.creation === "string" ? REFUS_CREATION[sp.creation] : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader domain="explorer" title="Tableaux de bord" />
      <FiltersNotAppliedNote note={ecran.notApplied} />

      {refus?.champ === "modele" && (
        <p role="alert" data-testid="creation-refus" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {refus.texte}
        </p>
      )}

      {/* ----- W-D2 : tableaux du périmètre, EN PREMIER (recette du 26/09/2026) : les
          quatre modèles et leurs boutons orange occupaient le haut de page, et les
          tableaux de l'utilisateur venaient dessous (vers 1 300 px à 390 px). ----- */}
      <section aria-labelledby="tableaux-titre" className="mb-5">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <h2 id="tableaux-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Tableaux de ce périmètre
          </h2>
          {dashboards.length > 0 && (
            <span className="text-[11px] tabular-nums text-ink-faint">{pluriel(dashboards.length, "tableau", "tableaux")}</span>
          )}
        </div>
        {dashboards.length === 0 && peutCreer ? null : dashboards.length === 0 ? (
          // Liste vide : une ligne, sans en-têtes de tableau à faire défiler (recette du 30/09/2026).
          // Qui peut créer la lit dans le résumé de la création, juste dessous (01/10/2026).
          <p role="status" className="card mb-2 flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft">
            <span aria-hidden className="text-ink-faint">
              ⊘
            </span>
            Aucun tableau de bord dans ce périmètre : créez-en un, ou partez d’un modèle ci-dessous.
          </p>
        ) : (
          // Défiler, de façon signalée : la colonne « Propriétaire » (P6.5) fait cinq
          // colonnes, qui ne tiennent pas à 390 px. Les masquer cacherait qui possède
          // quoi. `min-w-[40rem]` : sans largeur plancher, le tableau s'écrasait au
          // lieu de défiler (« Mini-site de démo » sur 4 lignes, « Mise à jour »
          // invisible — recette 26/09). La zone de TableDefilante reste `relative`.
          <TableDefilante className="card mb-2" label="Tableaux de ce périmètre">
            <table className="w-full min-w-[40rem] text-sm" data-testid="tableaux-perimetre">
              <caption className="sr-only">Tableaux de bord lisibles dans ce périmètre</caption>
              <thead className="whitespace-nowrap">
                <tr>
                  <th scope="col" className="th text-left">Nom</th>
                  <th scope="col" className="th text-left">Application</th>
                  <th scope="col" className="th text-left">Propriétaire</th>
                  <th scope="col" className="th text-left">Cartes</th>
                  <th scope="col" className="th text-right">Mise à jour</th>
                </tr>
              </thead>
              <tbody>
                {dashboards.map((d) => (
                  <tr key={d.id} className="border-t border-line align-middle hover:bg-panel2">
                    <td className="px-3 py-1.5 font-medium">
                      <Link href={hrefWithQuery(`/dashboards/${d.id}`, ecran.query)} className="text-accent hover:underline">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-ink-soft" data-testid="tableau-app">
                      {d.app ?? "toutes les applications"}
                    </td>
                    <td className="px-3 py-1.5 text-ink-soft">{d.proprietaire}</td>
                    <td className="px-3 py-1.5">
                      {/* F37 : un titre de section n'est pas une carte — ni compté, ni en puce. */}
                      {d.cartes === 0 ? (
                        <span className="text-xs text-ink-soft">aucune carte</span>
                      ) : (
                        <ul className="flex min-w-48 flex-wrap gap-1" aria-label={pluriel(d.cartes, "carte")}>
                          {d.puces.map((p) => (
                            <li key={p.libelle} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-soft">
                              {p.libelle}
                              {p.n > 1 ? ` × ${p.n}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-ink-soft">{fmtDate(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableDefilante>
        )}

        {/* ----- W-D3 : création d'un tableau vide, juste sous la liste (elle était
            repliée tout en bas, après les modèles) ----- */}
        {peutCreer ? (
          <details className="card" open={refus !== undefined && refus.champ !== "modele"}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-accent transition hover:text-ink">
              {dashboards.length === 0 && (
                // Rien de créé : l'absence et le geste sur la même ligne (recette du 01/10/2026).
                <span role="status" className="mr-2 font-normal text-ink-soft" data-testid="tableaux-rien-cree">
                  <span aria-hidden className="mr-1.5 text-ink-faint">
                    ⊘
                  </span>
                  Aucun tableau de bord créé dans ce périmètre ·
                </span>
              )}
              + Nouveau tableau de bord
            </summary>
            <form
              action={createDashboardAction}
              data-testid="creer-tableau"
              className="flex flex-wrap items-start gap-3 border-t border-line p-3"
            >
              <input type="hidden" name="ctx" value={ctx} />
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
                Nom
                <input
                  name="name"
                  required
                  placeholder="Mon tableau de bord"
                  aria-invalid={refus?.champ === "name" ? true : undefined}
                  aria-describedby={refus?.champ === "name" ? "creation-erreur-nom" : undefined}
                  className={`${INPUT_CLASS} w-56 max-w-full`}
                />
                {refus?.champ === "name" && (
                  <span id="creation-erreur-nom" role="alert" data-testid="creation-refus" className="text-xs font-medium text-bad-ink">
                    {refus.texte}
                  </span>
                )}
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
                Application
                <select
                  name="app_id"
                  defaultValue={ecran.appFiltre ?? ""}
                  aria-invalid={refus?.champ === "app_id" ? true : undefined}
                  aria-describedby={refus?.champ === "app_id" ? "creation-erreur-app" : undefined}
                  className={`${INPUT_CLASS} max-w-full`}
                >
                  {canCreateGlobal && <option value="">Toutes les applications</option>}
                  {appsCreables.map((a) => (
                    <option key={a.app_id} value={a.app_id}>
                      {a.name || a.app_id}
                    </option>
                  ))}
                </select>
                {refus?.champ === "app_id" && (
                  <span id="creation-erreur-app" role="alert" data-testid="creation-refus" className="max-w-xs text-xs font-medium text-bad-ink">
                    {refus.texte}
                  </span>
                )}
              </label>
              <button type="submit" data-testid="create-dashboard" className="btn-accent self-end">
                Créer
              </button>
            </form>
          </details>
        ) : (
          <p className="text-xs text-ink-soft" data-testid="creation-indisponible">
            {ecran.demo ? "Session de démonstration : lecture seule." : "Création réservée aux comptes autorisés sur une application."}
          </p>
        )}
      </section>

      {/* ----- W-D1 : modèles fournis, APRÈS les tableaux, repliables : ouverts d'office
          tant que le périmètre n'a aucun tableau (ils sont alors le point de départ),
          repliés ensuite (ils ne font plus que suggérer). ----- */}
      <details
        className="group/modeles min-w-0"
        data-testid="modeles-tableaux"
        open={!dashboards.length || refus?.champ === "modele"}
      >
        <summary className="mb-3 cursor-pointer list-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf [&::-webkit-details-marker]:hidden">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="h-3 w-3 shrink-0 fill-current text-ink-soft transition-transform group-open/modeles:rotate-90 motion-reduce:transition-none"
            >
              <path d="M4 2l5 4-5 4z" />
            </svg>
            Modèles fournis
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
              {MODELES_TABLEAUX.length}
            </span>
          </h2>
          <span className="sr-only">
            Des tableaux prêts à l’emploi : cloner un modèle en crée une copie à vous, dans l’application choisie.
          </span>
        </summary>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {MODELES_TABLEAUX.map((m) => (
            <ModeleCarte
              key={m.cle}
              cle={m.cle}
              titre={m.titre}
              question={m.question}
              sections={apercuDuModele(m)}
              cloner={clonage.cloner}
              raisonSansClonage={clonage.raison}
              limite={m.limite ? { ...m.limite, href: hrefWithQuery("/", ecran.query, { cmp: "release" }) } : undefined}
              ctx={ctx}
              appParDefaut={ecran.query.scope.requestedApp}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
