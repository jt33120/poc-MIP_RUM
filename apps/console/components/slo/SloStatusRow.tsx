// Ligne de la table « Définitions et état » de /slo (F63, plan § 5.18 SL5).
// Rendu serveur.
//
// LA MÉTRIQUE EN CLAIR. « Part des mesures LCP notées Bon », « 1 − occurrences
// d'erreurs par page vue » : la formule de `slo_status()`, pas son identifiant.
//
// L'ABSENCE N'EST PAS UN ÉCHEC (V3). Un SLO sans aucune mesure sur sa fenêtre est
// « non mesurable » : ni atteinte, ni budget consommé, jamais « 0 % » ni « objectif
// manqué ». Une atteinte négative (`error_rate`) est « non interprétable ».
//
// UNE SEULE COULEUR DE VERDICT : « épuisé » (consommé ≥ 100 %, seule définition,
// R-S). Plus de vert / ambre sous 100 % : le « à risque » à 75 % n'a pas de source.
//
// ÉCRITURE RÉSERVÉE. Activer / Désactiver / Supprimer / « Créer une alerte » ne sont
// RENDUS que pour un administrateur hors session de démonstration (V9) : un viewer
// ne voit aucun bouton qu'on lui refuserait ensuite.
import Link from "next/link";
import { deleteSloAction, toggleSloAction } from "@/app/alerts/actions";
import { pctBudget, statutBudget } from "@/components/charts/BudgetBars";
import { formater } from "@/lib/fmt-ids";
import type { SloRaw, SloStatusRow as SloStatusData } from "@/lib/queries-alerting";
import { hrefCreerAlerte, metriqueEnClair } from "@/lib/slo-ecran";

const TD = "px-3 py-2 align-top";

const VERDICT_BUDGET: Record<ReturnType<typeof statutBudget>, string> = {
  non_mesurable: "non mesurable",
  non_interpretable: "non interprétable",
  dans_budget: "dans le budget",
  epuise: "épuisé",
};

/** Ligne d'un SLO, avec son état calculé s'il est actif (`slo_status()` ignore les désactivés). */
export function SloRow({
  raw,
  status,
  alertes7j,
  admin,
}: {
  raw: SloRaw;
  status?: SloStatusData;
  /** Déclenchements de ce SLO sur 7 jours ; `null` : lecture en échec ou non faite. */
  alertes7j: number | null;
  admin: boolean;
}) {
  const statut = status ? statutBudget({ consomme: status.attainment == null ? null : status.burned_pct, atteinte: status.attainment }) : null;

  return (
    <tr
      id={`slo-def-${raw.id}`}
      data-testid={`slo-${raw.id}`}
      data-statut={statut ?? "desactive"}
      className={`border-t border-line/60 ${raw.active ? "" : "opacity-60"}`}
    >
      <th scope="row" className={`${TD} sticky left-0 bg-panel text-left font-normal`}>
        <span className="block font-medium text-ink">{raw.name}</span>
        <span className="chip-mono text-xs">{raw.app_id}</span>
      </th>
      <td className={`${TD} text-ink-soft`}>{metriqueEnClair(raw.metric)}</td>
      <td className={`${TD} font-mono text-xs text-ink-soft`}>{raw.route ?? "toutes"}</td>
      <td className={`${TD} tabular-nums text-ink-soft`}>{formater("pct", raw.objective)}</td>
      <td className={`${TD} tabular-nums text-ink-soft`}>{raw.window_days} j</td>
      <td className={`${TD} tabular-nums`}>
        {!status ? (
          <span className="text-ink-soft">—</span>
        ) : status.attainment == null ? (
          <span className="text-ink-soft" title="Aucune mesure sur la fenêtre du SLO : ni tenu, ni manqué">
            non mesurable
          </span>
        ) : status.attainment < 0 ? (
          <span className="text-ink-soft" title="Plus d'occurrences d'erreurs que de pages vues">
            non interprétable
          </span>
        ) : (
          formater("pct", status.attainment)
        )}
      </td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>
        {!status || statut === "non_mesurable" ? (
          <span className="text-ink-soft">—</span>
        ) : (
          <>
            <span className={statut === "epuise" ? "font-semibold text-bad-ink" : "text-ink"}>{pctBudget(status.burned_pct)}</span>{" "}
            <span className="text-xs text-ink-soft">{VERDICT_BUDGET[statut!]}</span>
          </>
        )}
      </td>
      <td className={TD}>
        {!status ? (
          <span className="text-ink-soft">—</span>
        ) : status.fast_burn === true ? (
          <span className="rounded border border-bad/30 bg-bad/10 px-1.5 py-0.5 text-xs font-medium text-bad-ink">oui</span>
        ) : status.fast_burn === false ? (
          <span className="text-ink-soft">non</span>
        ) : (
          <span className="text-ink-soft" title="Aucune mesure sur la dernière heure : on ne sait pas">
            inconnu
          </span>
        )}
      </td>
      <td className={`${TD} tabular-nums`}>
        {alertes7j == null ? (
          <span className="text-ink-soft">—</span>
        ) : (
          <Link href={`/alerts#slo-${raw.id}`} className="text-brand hover:underline" data-testid="alertes-7j">
            {alertes7j.toLocaleString("fr-FR")}
          </Link>
        )}
      </td>
      <td className={`${TD} text-ink-soft`}>{raw.active ? "actif" : "désactivé"}</td>
      {admin && (
        <td className={TD}>
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href={hrefCreerAlerte(raw)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink"
            >
              Créer une alerte
            </Link>
            <form action={toggleSloAction}>
              <input type="hidden" name="id" value={raw.id} />
              <button
                type="submit"
                data-testid={`toggle-slo-${raw.id}`}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink"
              >
                {raw.active ? "Désactiver" : "Activer"}
              </button>
            </form>
            <form action={deleteSloAction}>
              <input type="hidden" name="id" value={raw.id} />
              <button
                type="submit"
                data-testid={`delete-slo-${raw.id}`}
                className="rounded-lg bg-bad-fond px-3 py-1.5 text-xs font-medium text-white transition hover:bg-bad-fond/90"
              >
                Supprimer
              </button>
            </form>
          </div>
        </td>
      )}
    </tr>
  );
}
