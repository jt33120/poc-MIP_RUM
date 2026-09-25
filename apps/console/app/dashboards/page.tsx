// Tableaux de bord — liste (§ 5.24). Rendu serveur.
//
// F35 — L'ÉCRAN N'EST PLUS VIDE À LA PREMIÈRE VISITE. Il répond à « Quelles cartes
// surveiller ensemble ? » par les tableaux du périmètre ET par quatre modèles prêts
// à cloner (Performance, Erreurs, Usages, Releases ; `lib/dashboard-templates.ts`).
// Un modèle ne lit aucune donnée : c'est du texte et un bouton « Cloner ».
//
// CE QUE LA TABLE DIT DE CHAQUE TABLEAU (W-D2) : son app par son NOM (pas son
// identifiant), son propriétaire, et le TYPE de ses cartes en puces (« Valeur × 3 »,
// « v1 : Trafic ») plutôt qu'un nombre — un nombre ne dit pas ce qu'on y lira.
//
// LES ÉCRITURES NE SONT PROPOSÉES QU'À QUI PEUT ÉCRIRE (V9). Sans app où créer, ou
// en session de démonstration, ni « Cloner » ni formulaire de création ne sont
// rendus ; la raison est écrite à leur place. Un refus de création revient avec sa
// raison (`?creation=…`), écrite sous le champ (`role="alert"`).
import Link from "next/link";
import { FilterProblemNotice, FiltersNotAppliedNote } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { ModeleCarte } from "@/components/dashboards/ModeleCarte";
import { fmtDate } from "@/lib/format";
import { type SearchParams } from "@/lib/filters";
import { chargerTableaux } from "@/lib/chargeurs/tableaux";
import { chargerEcran } from "@/lib/ecran-local";
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
    texte: "Création refusée : cette app n’est pas dans votre périmètre d’écriture. Rien n’a été créé.",
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
  const ecran = await chargerEcran(chargerTableaux, sp);
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
      <PageHeader
        domain="explorer"
        title="Tableaux de bord"
        sub="Quelles cartes surveiller ensemble ? Chaque carte est une analyse de l’Explorer ; export CSV et impression par le navigateur."
      />
      <FiltersNotAppliedNote note={ecran.notApplied} />

      {refus?.champ === "modele" && (
        <p role="alert" data-testid="creation-refus" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {refus.texte}
        </p>
      )}

      {/* ----- W-D1 : modèles fournis ----- */}
      <section aria-labelledby="modeles-tableaux-titre" className="mb-6" data-testid="modeles-tableaux">
        <h2 id="modeles-tableaux-titre" className="mb-1 text-sm font-semibold text-ink">
          Modèles fournis
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Chaque modèle est une suite d’analyses de l’Explorer rangées par question. Le cloner crée un tableau à vous,
          dans l’app choisie ; aucun chiffre n’est lu avant de l’ouvrir.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
      </section>

      {/* ----- W-D2 : tableaux du périmètre ----- */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Tableaux de ce périmètre</h2>
      {/* `overflow-x-auto` : la colonne « Propriétaire » (P6.5) fait cinq colonnes,
          qui ne tiennent pas à 390 px. Les masquer cacherait qui possède quoi. */}
      {/* `relative` : la légende `sr-only` (position: absolute) reste dans ce conteneur
          défilant au lieu d'élargir la page à 390 px (piège 16). */}
      <div className="card relative mb-6 overflow-x-auto">
        <table className="w-full text-sm" data-testid="tableaux-perimetre">
          <caption className="sr-only">Tableaux de bord lisibles dans ce périmètre</caption>
          <thead>
            <tr>
              <th scope="col" className="th text-left">Nom</th>
              <th scope="col" className="th text-left">App</th>
              <th scope="col" className="th text-left">Propriétaire</th>
              <th scope="col" className="th text-left">Cartes</th>
              <th scope="col" className="th text-right">Mise à jour</th>
            </tr>
          </thead>
          <tbody>
            {dashboards.map((d) => (
              <tr key={d.id} className="border-t border-line align-top hover:bg-panel2">
                <td className="px-3 py-2 font-medium">
                  <Link href={hrefWithQuery(`/dashboards/${d.id}`, ecran.query)} className="text-accent hover:underline">
                    {d.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-soft" data-testid="tableau-app">
                  {d.app ?? "toutes les apps"}
                </td>
                <td className="px-3 py-2 text-ink-soft">{d.proprietaire}</td>
                <td className="px-3 py-2">
                  {/* F37 : un titre de section n'est pas une carte — ni compté, ni en puce. */}
                  {d.cartes === 0 ? (
                    <span className="text-xs text-ink-soft">aucune carte</span>
                  ) : (
                    <ul className="flex min-w-48 flex-wrap gap-1" aria-label={`${d.cartes} cartes`}>
                      {d.puces.map((p) => (
                        <li key={p.libelle} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-soft">
                          {p.libelle}
                          {p.n > 1 ? ` × ${p.n}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">{fmtDate(d.updated_at)}</td>
              </tr>
            ))}
            {!dashboards.length && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-soft">
                  Aucun tableau de bord dans ce périmètre. Cloner un modèle ci-dessus, ou en créer un vide.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ----- W-D3 : création d'un tableau vide ----- */}
      {peutCreer ? (
        <details className="card" open={!dashboards.length || (refus !== undefined && refus.champ !== "modele")}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
            + Nouveau tableau de bord
          </summary>
          <form
            action={createDashboardAction}
            data-testid="creer-tableau"
            className="flex flex-wrap items-start gap-3 border-t border-line p-4"
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
              App
              <select
                name="app_id"
                defaultValue={ecran.appFiltre ?? ""}
                aria-invalid={refus?.champ === "app_id" ? true : undefined}
                aria-describedby={refus?.champ === "app_id" ? "creation-erreur-app" : undefined}
                className={`${INPUT_CLASS} max-w-full`}
              >
                {canCreateGlobal && <option value="">(toutes apps)</option>}
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
          {ecran.demo ? "Session de démonstration : lecture seule." : "Création réservée aux comptes autorisés sur une app."}
        </p>
      )}
    </div>
  );
}
