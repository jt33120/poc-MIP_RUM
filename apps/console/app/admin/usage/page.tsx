import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerConsommation } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { fmtInstant, fmtJour } from "@/lib/format";
import type { EtatComptage } from "@/lib/queries-usage";
import { quotaView } from "@/lib/usage";

/** Un compteur du mois : « — » sans comptage, jamais un zéro inventé. */
function compteur(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("fr-FR");
}

/**
 * Jusqu'où le mois est mesuré. Le comptage tourne chaque nuit sur la VEILLE : le
 * jour en cours n'y est jamais, et le dire évite de lire « rien consommé ».
 */
function phraseComptage(c: EtatComptage): string {
  if (c.dernierJour === null) {
    return "Aucun comptage ce mois-ci : la consommation est comptée chaque nuit pour la veille. Les données d'aujourd'hui apparaîtront demain.";
  }
  const dernier = c.dernierComptage ? ` (dernier comptage le ${fmtInstant(c.dernierComptage)})` : "";
  return `Mesuré jusqu'au ${fmtJour(c.dernierJour)} inclus${dernier}. Le jour en cours sera compté demain.`;
}

export const dynamic = "force-dynamic";

/** Consommation par client (mois courant) + quotas — admin only (P0 #5). */
export default async function Usage() {
  // Le chargeur : la consommation des applications de son périmètre (C9).
  const { lignes: rows, comptage } = accesAdmin(await chargerEcran(ECRANS_ADMIN.consommation, chargerConsommation, {}));
  const month = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="animate-fade-up">
      <PageHeader title="Consommation & quotas" sub={`Usage du mois — ${month}`} />
      <p className="mb-3 text-sm text-ink-soft" data-testid="usage-comptage">
        {phraseComptage(comptage)}
      </p>

      {/* Défilant et signalé : `overflow-hidden` rendait « Erreurs » et « Quota
          mensuel » invisibles et inatteignables à 390 px (recette 26/09). */}
      <TableDefilante className="card" label="Consommation par application">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Client</th>
              <th className="th text-right">Events</th>
              <th className="th text-right">Sessions</th>
              <th className="th text-right">Erreurs</th>
              <th className="th">Quota mensuel</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const qv = r.events === null ? null : quotaView(r.events, r.quota);
              return (
                <tr key={r.app_id} className="border-t border-line/60">
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="ml-2 chip-mono text-xs">{r.app_id}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" data-testid="usage-events">
                    {compteur(r.events)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {compteur(r.sessions)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {compteur(r.errors)}
                  </td>
                  <td className="px-4 py-2">
                    {r.quota == null ? (
                      <span className="text-xs text-ink-faint">illimité</span>
                    ) : qv === null ? (
                      <span className="text-xs text-ink-faint">
                        quota de {r.quota.toLocaleString("fr-FR")}, consommation non encore comptée
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                          <div
                            className={`h-full ${qv.over ? "bg-bad" : "bg-accent"}`}
                            style={{ width: `${Math.min(100, qv.pct ?? 0)}%` }}
                          />
                        </div>
                        <span className={`text-xs ${qv.over ? "font-semibold text-bad-ink" : "text-ink-faint"}`}>
                          {qv.label} de {r.quota.toLocaleString("fr-FR")}
                          {qv.over && " · dépassé"}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Aucune application à afficher.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
      <p className="mt-3 text-xs text-ink-faint">
        Consommation comptée une fois par jour pour la veille, et conservée au-delà de la durée de
        conservation des données de mesure. Le quota mensuel se règle par application.
      </p>
    </div>
  );
}
