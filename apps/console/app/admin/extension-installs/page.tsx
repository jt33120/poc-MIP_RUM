// Inventaire des postes équipés de l'extension navigateur (Ext-D).
//
// Ce que cet écran répond : combien de postes sont équipés, lesquels remontent
// encore, lesquels traînent une vieille version, et quelles applications ils
// alimentent. Ce qu'il ne répond PAS : qui s'en sert. Un poste ne porte un nom
// que si la DSI du client en pousse un par la politique du navigateur ; sinon il reste un
// identifiant d'installation, et c'est le comportement voulu (cf. migration-v52).
import Link from "next/link";
import { headers } from "next/headers";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { ICON_PATHS, Icon } from "@/components/icons";
import { chargerPostes } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { compareVersions, displayName, fleetVersion, freshness } from "@/lib/extension-installs";
import { fmtDate, pluriel } from "@/lib/format";
import { forgetInstallAction } from "./actions";

export const dynamic = "force-dynamic";

const TON: Record<string, string> = {
  actif: "border-good/40 bg-good/10 text-good-ink",
  silencieux: "border-warn/40 bg-warn/10 text-warn-ink",
  perdu: "border-line bg-panel2 text-ink-faint",
};

const LIBELLE: Record<string, string> = {
  actif: "Actif",
  silencieux: "Silencieux",
  perdu: "Sans signe de vie",
};

export default async function ExtensionInstalls() {
  // Le chargeur : l'administrateur de la plateforme seul — un poste observe plusieurs applications (C9).
  const { postes: rows } = accesAdmin(await chargerEcran(ECRANS_ADMIN.postes, chargerPostes, {}));
  const now = Date.now();

  const reference = fleetVersion(rows.map((r) => r.ext_version));
  const vus = rows.map((r) => ({
    ...r,
    etat: freshness(new Date(r.last_seen_at).getTime(), now),
    // « En retard » se juge contre le parc, pas contre une version codée en dur.
    enRetard: Boolean(reference && r.ext_version && compareVersions(r.ext_version, reference) < 0),
  }));

  // L'adresse que le poste doit pouvoir joindre : celle de cette console, que
  // l'extension contacte pour se déclarer et pour reconnaître les domaines.
  const hote = (await headers()).get("host");
  const actifs = vus.filter((r) => r.etat === "actif").length;
  const retard = vus.filter((r) => r.enRetard).length;
  const sansApp = vus.filter((r) => r.app_ids.length === 0 && r.etat === "actif").length;
  const nommes = vus.filter((r) => r.label).length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Postes équipés"
        sub={
          <>
            Inventaire du parc : quels postes portent l&apos;extension navigateur, depuis quand, et
            quelles applications ils alimentent. Chaque installation se déclare toutes les 6 h —
            elle n&apos;envoie <strong>jamais</strong> les pages visitées.
          </>
        }
      />

      {/* Chiffres de tête : les quatre questions d'exploitation d'un parc. Masqués
          quand aucun poste ne s'est déclaré : quatre tuiles à zéro passaient avant
          le seul message utile, sous la ligne de flottaison à 390 px (recette du 26/09). */}
      {rows.length > 0 && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Postes équipés" value={rows.length.toLocaleString("fr-FR")} hint={`${pluriel(actifs, "vu", "vus")} ces 3 derniers jours`} />
          <Stat
            label="Version du parc"
            value={reference ?? "—"}
            hint={retard > 0 ? `${pluriel(retard, "poste")} en retard` : "aucun poste en retard"}
            alerte={retard > 0}
          />
          <Stat
            label="Sans remontée"
            value={sansApp.toLocaleString("fr-FR")}
            hint="actifs, mais n'alimentent aucune application"
            alerte={sansApp > 0}
          />
          <Stat label="Postes nommés" value={`${nommes} sur ${rows.length}`} hint="nom attribué par la DSI du client" />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-6" data-testid="aucun-poste">
          <h2 className="text-sm font-semibold text-ink">Aucun poste ne s&apos;est encore déclaré</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Un poste apparaît ici dès l&apos;installation de l&apos;extension, puis se déclare de nouveau
            toutes les 6 h. Si vous venez de l&apos;installer et que le poste reste absent, vérifiez que ce
            poste peut joindre <code className="chip-mono break-all">{hote ?? "l'adresse de cette console"}</code> :
            c&apos;est là que l&apos;extension se déclare.
          </p>
          <Link href="/admin/extension-scope" className="btn-accent mt-4 inline-block">
            Enregistrer un domaine et installer l&apos;extension
          </Link>
        </div>
      ) : (
        // Huit colonnes, dont l'action « Retirer » en dernier : défilement signalé.
        <TableDefilante className="card" label="Postes équipés">
          <table className="w-full text-sm">
            <thead className="bg-panel2">
              <tr>
                <th className="th">Poste</th>
                <th className="th">Navigateur</th>
                <th className="th">Version de l&apos;extension</th>
                <th className="th">Applications</th>
                <th className="th">Depuis</th>
                <th className="th">Vu</th>
                <th className="th">État</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {vus.map((r) => (
                <tr key={r.install_id} className="transition hover:bg-panel2/60" data-testid="install-row">
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{displayName(r.label, r.install_id)}</span>
                    {!r.label && (
                      <span className="ml-2 text-[11px] text-ink-faint" title={r.install_id}>
                        anonyme
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {r.browser ?? "—"}
                    {r.browser_major != null && <span className="text-ink-faint"> {r.browser_major}</span>}
                    {r.platform && <span className="text-ink-faint"> · {r.platform}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`font-mono text-xs ${r.enRetard ? "text-warn-ink" : "text-ink-soft"}`}>
                      {r.ext_version ?? "—"}
                    </span>
                    {r.enRetard && <span className="ml-1.5 text-[11px] text-warn-ink">en retard</span>}
                  </td>
                  <td className="px-4 py-2">
                    {r.app_ids.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.app_ids.map((a) => (
                          <code key={a} className="chip-mono">
                            {a}
                          </code>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-faint">aucune</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-ink-faint">{fmtDate(r.first_seen_at)}</td>
                  <td className="px-4 py-2 text-xs tabular-nums text-ink-faint">{fmtDate(r.last_seen_at)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${TON[r.etat]}`}
                    >
                      {LIBELLE[r.etat]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <form action={forgetInstallAction}>
                      <input type="hidden" name="install_id" value={r.install_id} />
                      <button type="submit" className="btn-ghost text-xs">
                        Retirer
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      )}

      {/* Ce que l'écran ne dit pas — à lire avant de s'en servir comme d'un
          registre nominatif, ce qu'il n'est pas. */}
      <div className="card mt-8 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon paths={ICON_PATHS.shield} className="h-4 w-4 text-perf" strokeWidth={2.2} />
          Ce que cet inventaire sait, et ce qu&apos;il ignore
        </h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">Un poste, pas une personne.</strong> L&apos;identifiant est
            tiré au hasard à l&apos;installation, et ne dérive d&apos;aucune caractéristique de la
            machine ni de son utilisateur. Deux profils Chrome sur le même poste comptent pour deux.
          </li>
          <li>
            <strong className="text-ink">Les noms viennent de la DSI du client.</strong> Le nom
            d&apos;un poste est lu dans la politique du navigateur que la DSI déploie (clé{" "}
            <code className="chip-mono">poste</code>), jamais fabriqué ici. Sans cette politique,
            l&apos;inventaire reste anonyme.
          </li>
          <li>
            <strong className="text-ink">Aucune page visitée n&apos;est remontée</strong> quand le
            poste se déclare. La colonne « Applications » ne liste que des applications déjà rattachées
            à un domaine du registre, jamais une navigation hors de ce registre.
          </li>
          <li>
            <strong className="text-ink">« Retirer » n&apos;est pas une désinstallation.</strong> La
            ligne disparaît, mais un poste toujours équipé se déclarera de nouveau dans les 6 h.
            Pour arrêter la collecte, désactivez le domaine dans le registre.
          </li>
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  alerte = false,
}: {
  label: string;
  value: string;
  hint: string;
  alerte?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${alerte ? "text-warn-ink" : "text-ink"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-soft">{hint}</div>
    </div>
  );
}
