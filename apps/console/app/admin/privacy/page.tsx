import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { listApps } from "@/lib/queries";
import { DSAR_MESSAGES } from "@/lib/dsar";
import { dsarCible, dsarCounts, dsarIdentityCounts, dsarTotalRows, type DsarIdentityKind } from "@/lib/queries-dsar";
import { identityPersistenceHealth } from "@/lib/health";
import { eraseIdentityAction, eraseUserAction, searchIdentityAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "Renseigne un identifiant.",
  app: "Choisis une application : le HMAC est volontairement cloisonné par app.",
  kind: "Choisis une identité utilisateur ou compte.",
  secret: "IDENTITY_HASH_SECRET est absent : la recherche d'identité est indisponible.",
  confirm: "La confirmation ne correspond pas à l'identifiant — effacement annulé.",
  // Le motif de refus renvoyé par la Server Action, mot pour mot.
  refus_empreinte: DSAR_MESSAGES.refus_empreinte,
  inconnu: DSAR_MESSAGES.inconnu,
};

/** DSAR admin : identité métier HMAC et compatibilité historique visitor_id. */
export default async function AdminPrivacy({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const apps = await listApps();
  const app = typeof sp.app === "string" && sp.app ? sp.app : (apps[0]?.app_id ?? "");
  const kind: DsarIdentityKind = sp.kind === "account" ? "account" : "user";
  const identityHash = typeof sp.identity_hash === "string" && /^[0-9a-f]{64}$/.test(sp.identity_hash) ? sp.identity_hash : "";
  const visitorId = typeof sp.user === "string" ? sp.user.trim() : "";
  const visitorApp = typeof sp.visitor_app === "string" && sp.visitor_app
    ? sp.visitor_app
    : visitorId && typeof sp.app === "string" ? sp.app : "all";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const erased = typeof sp.erased === "string" ? sp.erased : null;

  // On INSTRUIT avant de compter : sur une ancienne empreinte de terminal, il
  // n'y a rien à afficher — ni volume, ni bouton. Voir lib/dsar.ts.
  const identityHealth = await identityPersistenceHealth();
  const identityCounts = identityHash && identityHealth.schema ? await dsarIdentityCounts(app, kind, identityHash) : null;
  const identityTotal = identityCounts ? dsarTotalRows(identityCounts) : 0;
  const identityExportHref = `/admin/privacy/export?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${identityHash}`;
  const visitorTarget = visitorId ? await dsarCible(visitorApp, visitorId) : null;
  const visitorCounts = visitorTarget?.verdict === "execute" ? await dsarCounts(visitorApp, visitorId) : null;
  const visitorTotal = visitorCounts ? dsarTotalRows(visitorCounts) : 0;
  const visitorExportHref = `/admin/privacy/export?app=${encodeURIComponent(visitorApp)}&user=${encodeURIComponent(visitorId)}`;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vie privée · DSAR"
        sub={
          <>
            Droits RGPD par identité métier pseudonymisée : <strong>accès/portabilité</strong> (export JSON) et{" "}
            <strong>effacement</strong>. Toutes les actions sont tracées dans l&apos;audit, refus compris.
          </>
        }
      />

      {identityHealth.label === "degraded" && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          Recherche indisponible : {!identityHealth.configured && <><code>IDENTITY_HASH_SECRET</code> manque. </>}
          {!identityHealth.schema && <>La migration v66 n&apos;est pas détectée. </>}
          L&apos;ingestion historique continue sans ces champs.
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {error}
        </div>
      )}
      {erased != null && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
          Effacement effectué — <strong>{erased}</strong> ligne(s) supprimée(s).
        </div>
      )}

      {/* Recherche d'identité métier : app + type + valeur brute en POST. */}
      <div className="card mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Rechercher une identité métier</h2>
        <form action={searchIdentityAction} className="flex flex-wrap items-end gap-3" data-testid="dsar-search-form">
          <label className="text-xs font-medium text-ink-soft">
            App
            <select name="app" defaultValue={app} className="field mt-1 block">
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Type
            <select name="kind" defaultValue={kind} className="field mt-1 block">
              <option value="user">utilisateur</option>
              <option value="account">compte</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Identifiant brut
            <input
              name="identity"
              type="text"
              required
              placeholder="saisi puis HMAC en mémoire"
              className="field mt-1 block w-96 font-mono text-xs"
            />
          </label>
          <button type="submit" className="btn-accent">
            Chercher
          </button>
        </form>
      </div>

      {identityCounts && (
        <div className="card mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Identité {kind} <code className="font-mono text-xs text-brand">{identityHash.slice(0, 12)}…</code>
              <span className="text-ink-faint"> · app {app}</span>
            </h2>
            <span className="text-xs tabular-nums text-ink-soft">{identityTotal} ligne(s) au total</span>
          </div>

          {identityTotal === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">
              Aucune donnée pour cette identité métier sur ce périmètre.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Table</th>
                  <th className="th">Lignes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {identityCounts.map((c) => (
                  <tr key={c.table} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs">{c.table}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">{c.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {identityCounts && identityTotal > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Accès / portabilité */}
          <div className="card p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Accès & portabilité</h2>
            <p className="mb-3 text-xs text-ink-faint">
              Export JSON complet des données liées à cette identité (une clé par table).
            </p>
            <Link href={identityExportHref} prefetch={false} className="btn-accent inline-block" data-testid="dsar-export">
              Exporter en JSON
            </Link>
          </div>

          {/* Effacement */}
          <div className="card border-red-300/60 p-4 dark:border-red-400/20">
            <h2 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">Effacement</h2>
            <p className="mb-3 text-xs text-ink-faint">
              Supprime <strong>définitivement</strong> toutes les lignes ci-dessus (transaction).
              Irréversible — re-saisis l&apos;identifiant métier pour confirmer.
            </p>
            <form action={eraseIdentityAction} className="flex flex-col gap-2" data-testid="dsar-erase-form">
              <input type="hidden" name="app" value={app} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="identity_hash" value={identityHash} />
              <input
                name="confirm_identity"
                type="text"
                required
                placeholder="re-saisir l'identifiant métier brut"
                className="field w-full font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="submit"
                className="rounded-lg border border-red-400 bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Effacer définitivement
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="my-8 border-t border-line" />
      <div className="card mb-6 p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-soft">Compatibilité · identifiant visiteur historique</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Le flux DSAR existant par <code>visitor_id</code> reste disponible, y compris sur toutes les applications autorisées.
        </p>
        <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="dsar-visitor-search-form">
          <label className="text-xs font-medium text-ink-soft">
            App
            <select name="visitor_app" defaultValue={visitorApp} className="field mt-1 block">
              <option value="all">toutes</option>
              {apps.map((candidate) => (
                <option key={candidate.app_id} value={candidate.app_id}>{candidate.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            visitor_id
            <input name="user" type="text" defaultValue={visitorId} required placeholder="identifiant de visiteur" className="field mt-1 block w-96 font-mono text-xs" />
          </label>
          <button type="submit" className="btn-accent">Chercher</button>
        </form>
      </div>

      {visitorTarget?.verdict === "refus_empreinte" && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-testid="dsar-refus">
          <p className="font-semibold">Demande non exécutable sur cet identifiant</p>
          <p className="mt-1">{DSAR_MESSAGES.refus_empreinte}</p>
          <p className="mt-2 text-xs">{visitorTarget.sessionsHeritees.toLocaleString("fr-FR")} session(s) portent cette valeur en <code className="font-mono">user_hash</code>.</p>
        </div>
      )}
      {visitorTarget?.verdict === "inconnu" && (
        <div className="mb-6 rounded-xl border border-line bg-panel2 px-4 py-3 text-sm text-ink-soft" data-testid="dsar-inconnu">{DSAR_MESSAGES.inconnu}</div>
      )}
      {visitorCounts && (
        <div className="card mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Données de <code className="font-mono text-xs text-brand">{visitorId}</code>{visitorApp !== "all" && <span className="text-ink-faint"> · app {visitorApp}</span>}</h2>
            <span className="text-xs tabular-nums text-ink-soft">{visitorTotal} ligne(s) au total</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-panel2"><tr><th className="th">Table</th><th className="th">Lignes</th></tr></thead>
            <tbody className="divide-y divide-line/60">
              {visitorCounts.map((count) => <tr key={count.table}><td className="px-4 py-2 font-mono text-xs">{count.table}</td><td className="px-4 py-2 tabular-nums text-ink-soft">{count.rows}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {visitorCounts && visitorTotal > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Accès & portabilité visitor_id</h2>
            <Link href={visitorExportHref} prefetch={false} className="btn-accent inline-block" data-testid="dsar-visitor-export">Exporter en JSON</Link>
          </div>
          <div className="card border-red-300/60 p-4 dark:border-red-400/20">
            <h2 className="mb-3 text-sm font-semibold text-red-700 dark:text-red-300">Effacement visitor_id</h2>
            <form action={eraseUserAction} className="flex flex-col gap-2" data-testid="dsar-visitor-erase-form">
              <input type="hidden" name="app" value={visitorApp} />
              <input type="hidden" name="user" value={visitorId} />
              <input name="confirm" type="text" required placeholder="re-saisir l'identifiant de visiteur" className="field w-full font-mono text-xs" autoComplete="off" />
              <button type="submit" className="rounded-lg border border-red-400 bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700">Effacer définitivement</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
