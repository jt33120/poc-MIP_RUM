import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { cleAction, detailAudit, FAMILLES_AUDIT, libelleAction } from "@/lib/audit-libelles";
import { chargerAudit } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtInstant } from "@/lib/format";
import { FUSEAU_AFFICHAGE, nomFuseau } from "@/lib/fuseau-local";
import { FiltreLignes } from "../_ui/FiltreLignes";
import { LIGNE, LigneVide, Panneau, TD, TH } from "../_ui/kit";
import { natureAction, type NatureAction } from "./nature";

export const dynamic = "force-dynamic";

/** La teinte d'une action selon sa nature : créer, retirer, être refusé, le reste. */
const TEINTE: Record<NatureAction, string> = {
  creation: "border-good/30 bg-good/10 text-good-ink",
  suppression: "border-bad/30 bg-bad/10 text-bad-ink",
  refus: "border-warn/40 bg-warn/10 text-warn-ink",
  autre: "border-line bg-panel2 text-ink",
};

const PUCE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

/**
 * Journal d'audit (administrateurs) : les 100 dernières actions sensibles, filtrables.
 *
 * Refonte du 01/10/2026 : les familles d'actions en puces (un clic filtre), l'utilisateur
 * et la recherche sur la même ligne ; un journal dense — l'action en pastille teintée
 * selon sa nature (création, retrait, refus), le détail en puces « champ valeur ».
 */
export default async function AdminAudit({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les 100 dernières actions — celles de ses applications pour un
  // administrateur d'une liste —, filtrées par famille d'actions et par utilisateur.
  const { lignes: rows, utilisateurs, filtres } = accesAdmin(await chargerEcran(ECRANS_ADMIN.audit, chargerAudit, sp));
  const filtre = Boolean(filtres.type || filtres.user);
  // Le lien d'une puce garde l'autre filtre (l'utilisateur choisi).
  const lien = (type: string | null) => {
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (filtres.user) p.set("user", filtres.user);
    const q = p.toString();
    return `/admin/audit${q ? `?${q}` : ""}`;
  };
  // Sans filtre de famille, chaque puce dit combien des actions affichées sont les siennes.
  const parFamille = new Map<string, number>();
  if (!filtres.type) {
    for (const r of rows) {
      const cle = cleAction(r.action);
      const f = FAMILLES_AUDIT.find((x) => x.prefixes.some((p) => cle.startsWith(p)));
      if (f) parFamille.set(f.cle, (parFamille.get(f.cle) ?? 0) + 1);
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Journal d'audit" />

      <Panneau
        titre="Actions"
        compte={rows.length}
        aide="Qui a fait quoi : connexions, comptes, applications, jetons, demandes RGPD. Les 100 dernières actions, la plus récente d'abord ; chaque puce de famille compte les actions affichées."
        actions={
          <>
            {/* Un formulaire GET : le filtre vit dans l'URL, se partage et se recharge. */}
            <form method="get" className="flex min-w-0 max-w-full items-center gap-2" data-testid="audit-filtres">
              {filtres.type && <input type="hidden" name="type" value={filtres.type} />}
              <label htmlFor="audit-utilisateur" className="sr-only">
                Utilisateur
              </label>
              <select id="audit-utilisateur" name="user" defaultValue={filtres.user ?? ""} className="field min-w-0 max-w-full py-1 text-xs sm:max-w-[16rem]">
                <option value="">Tous les utilisateurs</option>
                {utilisateurs.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-ghost">
                Filtrer
              </button>
              {filtre && (
                <Link href="/admin/audit" className="whitespace-nowrap text-xs font-medium text-brand hover:underline">
                  Tout afficher
                </Link>
              )}
            </form>
            <FiltreLignes cible="audit-lignes" libelle="Rechercher dans les actions affichées" total={rows.length} />
          </>
        }
        barre={
          <nav aria-label="Familles d'actions" className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Link href={lien(null)} aria-current={!filtres.type ? "page" : undefined} className={`${PUCE} ${!filtres.type ? "border-perf/50 bg-perf/10 text-ink" : "border-line bg-panel text-ink-soft hover:text-ink"}`}>
              Toutes
            </Link>
            {FAMILLES_AUDIT.map((f) => {
              const active = filtres.type === f.cle;
              const n = parFamille.get(f.cle);
              return (
                <Link
                  key={f.cle}
                  href={lien(f.cle)}
                  aria-current={active ? "page" : undefined}
                  className={`${PUCE} ${active ? "border-perf/50 bg-perf/10 text-ink" : "border-line bg-panel text-ink-soft hover:text-ink"}`}
                >
                  {f.libelle}
                  {n != null && <span className="tabular-nums text-ink-faint">{n}</span>}
                </Link>
              );
            })}
          </nav>
        }
      >
        {/* Défilant et signalé : à 390 px, `overflow-hidden` coupait la colonne
            Détail sans aucun moyen de l'atteindre (recette 26/09). */}
        <TableDefilante label="Journal d'audit">
          {rows.length ? (
            <table className="w-full text-sm" data-testid="audit-table">
              <thead className="bg-panel2">
                <tr>
                  {/* Le fuseau est nommé : un journal se compare à d'autres journaux. */}
                  <th className={TH}>Quand ({nomFuseau(FUSEAU_AFFICHAGE)})</th>
                  <th className={TH}>Utilisateur</th>
                  <th className={TH}>Action</th>
                  <th className={TH}>Détail</th>
                </tr>
              </thead>
              <tbody id="audit-lignes" className="divide-y divide-line/60">
                {rows.map((r) => {
                  const detail = detailAudit(r.detail);
                  return (
                    <tr key={r.id} className={`${LIGNE} align-top`} data-ligne="">
                      <td className={`${TD} whitespace-nowrap text-xs tabular-nums text-ink-soft`}>
                        {fmtInstant(r.ts, { annee: true, secondes: true, sansA: true })}
                      </td>
                      {/* Une adresse ne se coupe pas au tiret (« julian@mip- / rum.local ») :
                          le tableau défile, il a la place. */}
                      <td className={`${TD} whitespace-nowrap font-mono text-xs`}>{r.user_email ?? "—"}</td>
                      <td className={TD}>
                        {/* Le code brut reste au survol : c'est lui qu'on cherche dans les journaux du service. */}
                        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium leading-4 ${TEINTE[natureAction(r.action)]}`} title={r.action}>
                          {libelleAction(r.action, detail.actif)}
                        </span>
                      </td>
                      <td className={`${TD} min-w-[16rem] text-xs text-ink-soft`}>
                        <span className="flex min-w-0 flex-wrap items-center gap-1">
                          {detail.texte && <span className="break-words">{detail.texte}</span>}
                          {detail.champs.map((c, i) => (
                            <span key={`${c.libelle}-${i}`} className="inline-flex max-w-full items-baseline gap-1 rounded bg-panel2 px-1.5 py-px">
                              <span className="text-ink-faint">{c.libelle}</span>
                              <span className="break-all text-ink">{c.valeur}</span>
                            </span>
                          ))}
                          {!detail.texte && detail.champs.length === 0 && <span className="text-ink-faint">—</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <LigneVide>{filtre ? "Aucune action ne correspond à ces filtres." : "Aucune action enregistrée."}</LigneVide>
          )}
        </TableDefilante>
      </Panneau>
    </div>
  );
}
