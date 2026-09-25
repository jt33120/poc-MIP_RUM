import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { chargerAudit } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Journal d'audit (admin only) : 100 dernières actions sensibles. */
export default async function AdminAudit() {
  // Le chargeur (`lib/chargeurs/administration.ts`) : les 100 dernières actions — celles
  // de ses applications pour un administrateur d'une liste (C9).
  const { lignes: rows } = accesAdmin(await chargerEcran(ECRANS_ADMIN.audit, chargerAudit, {}));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Audit"
        sub="100 dernières actions sensibles (logins, gestion des utilisateurs, seed)"
      />
      <div className="card overflow-hidden">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Quand</th>
              <th className="th">Utilisateur</th>
              <th className="th">Action</th>
              <th className="th">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => (
              <tr key={r.id} className="transition hover:bg-panel2/60">
                <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">{fmtDate(r.ts)}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.user_email ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-panel2 px-2 py-0.5 text-xs font-medium text-ink-soft">
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">{r.detail ?? ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                  Aucune action enregistrée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
