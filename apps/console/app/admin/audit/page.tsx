import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { INPUT_CLASS } from "@/components/forms/Field";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { detailAudit, FAMILLES_AUDIT, libelleAction } from "@/lib/audit-libelles";
import { chargerAudit } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtInstant } from "@/lib/format";
import { FUSEAU_AFFICHAGE, nomFuseau } from "@/lib/fuseau-local";

export const dynamic = "force-dynamic";

/** Journal d'audit (administrateurs) : les 100 dernières actions sensibles, filtrables. */
export default async function AdminAudit({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les 100 dernières actions — celles de ses applications pour un
  // administrateur d'une liste —, filtrées par famille d'actions et par utilisateur.
  const { lignes: rows, utilisateurs, filtres } = accesAdmin(await chargerEcran(ECRANS_ADMIN.audit, chargerAudit, sp));
  const filtre = Boolean(filtres.type || filtres.user);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Journal d'audit"
        sub="Qui a fait quoi : connexions, comptes, applications, jetons, demandes RGPD. Les 100 dernières actions."
      />

      {/* Un formulaire GET : le filtre vit dans l'URL, se partage et se recharge. */}
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" data-testid="audit-filtres">
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
          Type d&apos;action
          <select name="type" defaultValue={filtres.type ?? ""} className={`${INPUT_CLASS} max-w-full`}>
            <option value="">Toutes</option>
            {FAMILLES_AUDIT.map((f) => (
              <option key={f.cle} value={f.cle}>
                {f.libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
          Utilisateur
          <select name="user" defaultValue={filtres.user ?? ""} className={`${INPUT_CLASS} max-w-full`}>
            <option value="">Tous</option>
            {utilisateurs.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-ghost">
          Filtrer
        </button>
        {filtre && (
          <Link href="/admin/audit" className="text-xs font-medium text-brand hover:underline">
            Tout afficher
          </Link>
        )}
      </form>

      {/* Défilant et signalé : à 390 px, `overflow-hidden` coupait la colonne
          Détail sans aucun moyen de l'atteindre (recette 26/09). */}
      <TableDefilante className="card" label="Journal d'audit">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-panel2">
            <tr>
              {/* Le fuseau est nommé : un journal se compare à d'autres journaux. */}
              <th className="th whitespace-nowrap">Quand ({nomFuseau(FUSEAU_AFFICHAGE)})</th>
              <th className="th">Utilisateur</th>
              <th className="th">Action</th>
              <th className="th">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => {
              const detail = detailAudit(r.detail);
              return (
                <tr key={r.id} className="align-top transition hover:bg-panel2/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">
                    {fmtInstant(r.ts, { annee: true, secondes: true, sansA: true })}
                  </td>
                  {/* Une adresse ne se coupe pas au tiret (« julian@mip- / rum.local ») :
                      le tableau défile, il a la place. */}
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.user_email ?? "—"}</td>
                  <td className="px-4 py-2">
                    {/* Le code brut reste au survol : c'est lui qu'on cherche dans les journaux du service. */}
                    <span
                      className="inline-block whitespace-nowrap rounded bg-panel2 px-2 py-0.5 text-xs font-medium text-ink"
                      title={r.action}
                    >
                      {libelleAction(r.action, detail.actif)}
                    </span>
                  </td>
                  <td className="min-w-[16rem] px-4 py-2 text-xs text-ink-soft">
                    {detail.texte && <p className="break-words">{detail.texte}</p>}
                    {detail.champs.length > 0 && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                        {detail.champs.map((c, i) => (
                          <div key={`${c.libelle}-${i}`} className="contents">
                            <dt className="text-ink-faint">{c.libelle}</dt>
                            <dd className="break-words text-ink">{c.valeur}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {!detail.texte && detail.champs.length === 0 && <span className="text-ink-faint">—</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                  {filtre ? "Aucune action ne correspond à ces filtres." : "Aucune action enregistrée."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
    </div>
  );
}
