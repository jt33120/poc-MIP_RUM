import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerViePrivee } from "@/lib/chargeurs/vie-privee";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { DSAR_BARRIERE_MESSAGES, DSAR_LIMITES, DSAR_MESSAGES, libelleTableDsar, phraseBarriere } from "@/lib/dsar";
import { accord, pluriel } from "@/lib/format";
import { eraseIdentityAction, eraseUserAction, searchIdentityAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "Renseignez un identifiant.",
  app: "Choisissez une application : les identifiants pseudonymisés sont propres à chaque application.",
  kind: "Choisissez une identité utilisateur ou compte.",
  secret: "La recherche par identité est indisponible : la clé de pseudonymisation n'est pas configurée sur la plateforme.",
  confirm: "La confirmation ne correspond pas à l'identifiant : effacement annulé.",
  perimetre: "Cette application n'est pas dans votre périmètre (« toutes » : l'administrateur de la plateforme).",
  // Le motif de refus renvoyé par la Server Action, mot pour mot.
  refus_empreinte: DSAR_MESSAGES.refus_empreinte,
  inconnu: DSAR_MESSAGES.inconnu,
};

const TYPE_IDENTITE = { user: "utilisateur", account: "compte" } as const;

/** Demandes RGPD (administrateurs) : accès et effacement, par identité métier ou par identifiant de visiteur. */
export default async function AdminPrivacy({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/vie-privee.ts`, C10) : les applications du périmètre,
  // ce que couvrirait la demande, l'état réel de la protection. On INSTRUIT avant de
  // compter : sur une ancienne empreinte de terminal, ni volume ni bouton (lib/dsar.ts).
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.viePrivee, chargerViePrivee, sp));
  const { apps, app, kind, identityHash, visitorId, visitorApp, toutes } = ecran;
  const { sante: identityHealth, protection: etatProtection, identite: identityCounts, cible: visitorTarget, visiteur: visitorCounts } = ecran;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const erased = typeof sp.erased === "string" ? sp.erased : null;
  const total = (counts: { rows: number }[]) => counts.reduce((n, c) => n + c.rows, 0);
  const identityTotal = identityCounts ? total(identityCounts) : 0;
  const identityExportHref = `/admin/privacy/export?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${identityHash}`;
  const visitorTotal = visitorCounts ? total(visitorCounts) : 0;
  const visitorExportHref = `/admin/privacy/export?app=${encodeURIComponent(visitorApp)}&user=${encodeURIComponent(visitorId)}`;
  const nomApp = (id: string) => apps.find((a) => a.app_id === id)?.name ?? id;
  const effacees = erased != null && /^\d+$/.test(erased) ? Number(erased) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vie privée · demandes RGPD"
        sub={
          <>
            Répondre à une demande d&apos;<strong>accès</strong> (export des données) ou d&apos;
            <strong>effacement</strong> d&apos;une personne. Chaque recherche, export et effacement est inscrit
            au journal d&apos;audit, refus compris.{" "}
            <Link href="/admin/audit?type=vie-privee" className="font-medium text-brand hover:underline">
              Historique des demandes traitées
            </Link>
          </>
        }
      />

      {identityHealth.label === "degraded" && (
        <div className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink">
          La recherche par identité est indisponible :{" "}
          {!identityHealth.configured && <>la clé de pseudonymisation n&apos;est pas configurée sur la plateforme. </>}
          {!identityHealth.schema && <>la base n&apos;est pas encore à jour pour l&apos;identité métier. </>}
          La recherche par identifiant de visiteur reste possible.
        </div>
      )}

      {/* Ce que la garantie couvre, et ce qu'elle ne couvre pas. Affiché DANS le
          rapport, pas relégué à une documentation : un opérateur qui croit la
          garantie plus large qu'elle ne l'est répondra à côté d'une demande. En tête,
          UNE phrase qui nomme l'application ; le détail, sur demande. */}
      <section
        className="card mb-6 p-4"
        aria-labelledby="dsar-portee"
        data-testid="dsar-portee"
        data-barriere={etatProtection}
      >
        <h2 id="dsar-portee" className="mb-2 text-sm font-semibold text-ink">
          Après un effacement
        </h2>
        <p
          className={
            etatProtection === "enforce"
              ? "rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-sm text-good-ink"
              : "rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink"
          }
          data-testid="dsar-barriere"
        >
          {phraseBarriere(etatProtection, nomApp(app))}
        </p>
        <details className="mt-2 text-sm text-ink-soft">
          <summary className="cursor-pointer select-none text-xs font-medium text-brand">En savoir plus</summary>
          <p className="mt-2">{DSAR_BARRIERE_MESSAGES[etatProtection]}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {DSAR_LIMITES.map((limite) => (
              <li key={limite}>{limite}</li>
            ))}
          </ul>
        </details>
      </section>

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          {error}
        </div>
      )}
      {effacees != null && (
        <div className="mb-6 rounded-xl border border-good/30 bg-good/10 px-4 py-3 text-sm text-good-ink">
          Effacement effectué : <strong>{pluriel(effacees, "ligne supprimée", "lignes supprimées")}</strong>.
        </div>
      )}

      {/* Recherche guidée : l'identité métier d'abord, l'identifiant de visiteur quand
          l'application n'en transmet pas (recette du 26/09/2026 : deux recherches,
          sans dire laquelle employer). */}
      <div className="card mb-6 p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">1. Rechercher par identité métier (recommandé)</h2>
        <p className="mb-3 text-xs text-ink-soft">
          L&apos;identifiant que votre application transmet pour cette personne (numéro de client, identifiant de
          compte…). Il est pseudonymisé à la volée et n&apos;est jamais conservé en clair.
        </p>
        <form action={searchIdentityAction} className="flex flex-wrap items-end gap-3" data-testid="dsar-search-form">
          {/* `min-w-0 max-w-full` + `max-w-full` : un champ ou une liste à largeur fixe
              ne pousse plus la page au-delà de 390 px (417 px avant). */}
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Application
            <select name="app" defaultValue={app} className="field mt-1 block w-full max-w-full">
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Type
            <select name="kind" defaultValue={kind} className="field mt-1 block max-w-full">
              <option value="user">utilisateur</option>
              <option value="account">compte</option>
            </select>
          </label>
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Identifiant de la personne
            <input
              name="identity"
              type="text"
              required
              placeholder="tel que votre application le transmet"
              className="field mt-1 block w-96 max-w-full font-mono text-xs"
            />
          </label>
          <button type="submit" className="btn-accent">
            Chercher
          </button>
        </form>
      </div>

      {identityCounts && (
        <section className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Identité {TYPE_IDENTITE[kind]} · empreinte{" "}
              <code className="font-mono text-xs text-brand">{identityHash.slice(0, 12)}…</code>
              <span className="font-normal text-ink-soft"> · {nomApp(app)}</span>
            </h2>
            <span className="text-xs tabular-nums text-ink-soft">
              {pluriel(identityTotal, "ligne")} au total
            </span>
          </div>

          {identityTotal === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">
              Aucune donnée pour cette identité dans cette application.
            </p>
          ) : (
            <TableDefilante label="Données de cette identité">
              <TableauVolumes lignes={identityCounts} />
            </TableDefilante>
          )}
        </section>
      )}

      {identityCounts && identityTotal > 0 && (
        <div className="mb-6 grid gap-6 md:grid-cols-2">
          {/* Accès / portabilité */}
          <div className="card p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Accès et portabilité</h2>
            <p className="mb-3 text-xs text-ink-soft">
              Export JSON complet des données liées à cette identité, regroupées par type de donnée.
            </p>
            <Link href={identityExportHref} prefetch={false} className="btn-accent inline-block" data-testid="dsar-export">
              Exporter en JSON
            </Link>
          </div>

          {/* Effacement */}
          <div className="card border-bad/60 p-4">
            <h2 className="mb-1 text-sm font-semibold text-bad-ink">Effacement</h2>
            <p className="mb-3 text-xs text-ink-soft">
              Supprime <strong>définitivement</strong> toutes les données ci-dessus, en une seule opération.
              Irréversible : saisissez de nouveau l&apos;identifiant de la personne pour confirmer.
            </p>
            <form action={eraseIdentityAction} className="flex flex-col gap-2" data-testid="dsar-erase-form">
              <input type="hidden" name="app" value={app} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="identity_hash" value={identityHash} />
              <input
                name="confirm_identity"
                type="text"
                required
                placeholder="identifiant de la personne, de nouveau"
                className="field w-full font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="submit"
                className="rounded-lg border border-bad/30 bg-bad-fond px-3 py-2 text-sm font-semibold text-white transition hover:bg-bad-fond/90"
              >
                Effacer définitivement
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="card mb-6 p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">2. Rechercher par identifiant de visiteur</h2>
        <p className="mb-3 text-xs text-ink-soft">
          À employer quand votre application ne transmet pas d&apos;identité métier : l&apos;identifiant de visiteur
          est posé par le code de suivi dans le navigateur de la personne.
        </p>
        <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="dsar-visitor-search-form">
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Application
            <select name="visitor_app" defaultValue={visitorApp} className="field mt-1 block w-full max-w-full">
              {toutes && <option value="all">Toutes les applications</option>}
              {apps.map((candidate) => (
                <option key={candidate.app_id} value={candidate.app_id}>{candidate.name}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Identifiant de visiteur
            <input
              name="user"
              type="text"
              defaultValue={visitorId}
              required
              placeholder="identifiant de visiteur"
              className="field mt-1 block w-96 max-w-full font-mono text-xs"
            />
          </label>
          <button type="submit" className="btn-accent">Chercher</button>
        </form>
      </div>

      {visitorTarget?.verdict === "refus_empreinte" && (
        <div className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink" data-testid="dsar-refus">
          <p className="font-semibold">Demande non exécutable sur cet identifiant</p>
          <p className="mt-1">{DSAR_MESSAGES.refus_empreinte}</p>
          <p className="mt-2 text-xs">
            {pluriel(visitorTarget.sessionsHeritees, "session")}{" "}
            {accord(visitorTarget.sessionsHeritees, "porte", "portent")} cette ancienne empreinte.
          </p>
        </div>
      )}
      {visitorTarget?.verdict === "inconnu" && (
        <div className="mb-6 rounded-xl border border-line bg-panel2 px-4 py-3 text-sm text-ink-soft" data-testid="dsar-inconnu">{DSAR_MESSAGES.inconnu}</div>
      )}
      {visitorCounts && (
        <section className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Données du visiteur <code className="break-all font-mono text-xs text-brand">{visitorId}</code>
              <span className="font-normal text-ink-soft">
                {" "}· {visitorApp === "all" ? "toutes les applications" : nomApp(visitorApp)}
              </span>
            </h2>
            <span className="text-xs tabular-nums text-ink-soft">{pluriel(visitorTotal, "ligne")} au total</span>
          </div>
          <TableDefilante label="Données de ce visiteur">
            <TableauVolumes lignes={visitorCounts} />
          </TableDefilante>
        </section>
      )}
      {visitorCounts && visitorTotal > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Accès et portabilité</h2>
            <Link href={visitorExportHref} prefetch={false} className="btn-accent inline-block" data-testid="dsar-visitor-export">Exporter en JSON</Link>
          </div>
          <div className="card border-bad/60 p-4">
            <h2 className="mb-1 text-sm font-semibold text-bad-ink">Effacement</h2>
            <p className="mb-3 text-xs text-ink-soft">
              Irréversible : saisissez de nouveau l&apos;identifiant de visiteur pour confirmer.
            </p>
            <form action={eraseUserAction} className="flex flex-col gap-2" data-testid="dsar-visitor-erase-form">
              <input type="hidden" name="app" value={visitorApp} />
              <input type="hidden" name="user" value={visitorId} />
              <input name="confirm" type="text" required placeholder="identifiant de visiteur, de nouveau" className="field w-full font-mono text-xs" autoComplete="off" />
              <button type="submit" className="rounded-lg border border-bad/30 bg-bad-fond px-3 py-2 text-sm font-semibold text-white transition hover:bg-bad-fond/90">Effacer définitivement</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Le volume par type de donnée : ce qu'un export rendrait, ce qu'un effacement supprimerait. */
function TableauVolumes({ lignes }: { lignes: { table: string; rows: number }[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-panel2">
        <tr>
          <th className="th">Données</th>
          <th className="th">Lignes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/60">
        {lignes.map((c) => (
          <tr key={c.table} className="transition hover:bg-panel2/60">
            <td className="px-4 py-2 text-ink">
              {libelleTableDsar(c.table)}
            </td>
            <td className="px-4 py-2 tabular-nums text-ink-soft">{c.rows.toLocaleString("fr-FR")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
