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
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
import { formater } from "@/lib/fmt-ids";
import type { SloRaw, SloStatusRow as SloStatusData } from "@/lib/queries-alerting";
import { hrefCreerAlerte, metriqueEnClair } from "@/lib/slo-ecran";

// Lignes denses (recette du 30/09/2026) : 32 px environ, nombres alignés à droite.
const TD = "px-3 py-1.5 align-middle";

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
      {/* Nom, app, métrique et route dans UNE cellule (recette du 26/09/2026) : à onze
          colonnes, « Alertes sur 7 j » et les actions restaient hors de l'écran même à
          1 440 px. La métrique passe en sous-ligne, l'état « désactivé » en étiquette. */}
      <th scope="row" className={`${TD} sticky left-0 max-w-[22rem] bg-panel text-left font-normal`}>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-ink">{raw.name}</span>
          {!raw.active && (
            <span className="shrink-0 rounded border border-line px-1 py-px text-[11px] font-normal text-ink-soft">désactivé</span>
          )}
        </span>
        {/* La métrique en clair, l'app et la route sur UNE sous-ligne. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-ink-soft">
          <span>{metriqueEnClair(raw.metric)}</span>
          <span aria-hidden>·</span>
          <span className="chip-mono">{raw.app_id}</span>
          <span className="font-mono">{raw.route ?? "toutes routes"}</span>
        </span>
      </th>
      <td className={`${TD} whitespace-nowrap tabular-nums text-ink-soft`}>
        {formater("pct", raw.objective)} <span className="text-xs">sur {raw.window_days} j</span>
      </td>
      <td className={`${TD} text-right tabular-nums`}>
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
      <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
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
      <td className={`${TD} text-right tabular-nums`}>
        {alertes7j == null ? (
          <span className="text-ink-soft">—</span>
        ) : (
          <Link href={`/alerts#slo-${raw.id}`} className="text-brand hover:underline" data-testid="alertes-7j">
            {alertes7j.toLocaleString("fr-FR")}
          </Link>
        )}
      </td>
      {admin && (
        <td className={TD}>
          {/* Les trois actions dans un menu replié : trois boutons par ligne élargissaient
              la table au-delà de l'écran. Il s'ouvre dans la cellule (pas en surimpression) :
              la zone défilante le couperait. */}
          <details className="group" data-testid={`actions-slo-${raw.id}`}>
            <summary className="cursor-pointer list-none whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink [&::-webkit-details-marker]:hidden">
              Actions <span aria-hidden="true" className="inline-block transition group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-2 flex flex-col items-stretch gap-2">
              <Link
                href={hrefCreerAlerte(raw)}
                className="whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink"
              >
                Créer une alerte
              </Link>
              <form action={toggleSloAction}>
                <input type="hidden" name="id" value={raw.id} />
                <input type="hidden" name="app" value={raw.app_id} />
                <input type="hidden" name="active" value={raw.active ? "false" : "true"} />
                <button
                  type="submit"
                  data-testid={`toggle-slo-${raw.id}`}
                  className="w-full whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink"
                >
                  {raw.active ? "Désactiver" : "Activer"}
                </button>
              </form>
              {/* La suppression emporte l'historique des déclenchements (cascade) : confirmée. */}
              <form action={deleteSloAction}>
                <input type="hidden" name="id" value={raw.id} />
                <input type="hidden" name="app" value={raw.app_id} />
                <ConfirmationDanger
                  libelle="Supprimer"
                  libelleAccessible={`Supprimer le SLO ${raw.name}`}
                  question={`Supprimer le SLO ${entreGuillemets(raw.name)}\u00a0?`}
                  consequence="Son suivi et l’historique de ses déclenchements seront effacés définitivement."
                  confirmer="Supprimer le SLO"
                  enCours="Suppression…"
                  classeDeclencheur="w-full whitespace-nowrap rounded-lg border border-bad/40 bg-panel px-3 py-1.5 text-xs font-medium text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
                  testid={`delete-slo-${raw.id}`}
                />
              </form>
            </div>
          </details>
        </td>
      )}
    </tr>
  );
}
