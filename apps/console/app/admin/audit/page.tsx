import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: number;
  user_email: string | null;
  action: string;
  detail: string | null;
  ts: Date;
}

/** Journal d'audit (admin only) : 100 dernières actions sensibles. */
export default async function AdminAudit() {
  await requireAdmin();
  const rows = await q<AuditRow>(
    `select id, user_email, action, detail, ts from audit_log order by ts desc, id desc limit 100`,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Audit</h1>
      <p className="mb-6 text-sm text-slate-500">
        100 dernières actions sensibles (logins, gestion des utilisateurs, seed)
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Quand</th>
              <th className="px-4 py-2">Utilisateur</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{fmtDate(r.ts)}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.user_email ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">{r.detail ?? ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
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
