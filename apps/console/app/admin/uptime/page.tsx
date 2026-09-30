import { motifDeRefus } from "@mip/backend/lib/net/safe-fetch.mjs";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerSondes } from "@/lib/chargeurs/sondes";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate, fmtLatency, fmtNombre, pluriel } from "@/lib/format";
import { CADENCE_TICK_MIN } from "@/lib/etat-latence";
import {
  createUptimeCheckAction,
  deleteUptimeCheckAction,
  toggleUptimeCheckAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Sondes de disponibilité (monitoring synthétique) : des vérifications HTTP actives, pour les administrateurs. */
export default async function UptimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/sondes.ts`) : un administrateur, et les sondes de son périmètre.
  const { apps, checks, cadence } = accesAdmin(await chargerEcran(ECRANS_ADMIN.sondes, chargerSondes, sp));
  const error = typeof sp.error === "string";
  // Refus d'URL à l'écriture (P1) : un CODE dans l'URL, un texte relu côté
  // serveur — jamais le texte d'un paramètre affiché tel quel.
  const urlRefusee =
    typeof sp.url_refusee === "string" ? (motifDeRefus(sp.url_refusee) ?? "URL refusée.") : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Sondes de disponibilité"
        sub={
          <>
            Votre site répond-il, même sans visiteur&nbsp;? Chaque sonde interroge une adresse toutes les{" "}
            {cadence ?? CADENCE_TICK_MIN}&nbsp;min. Un échec est confirmé par un second essai, et le passage de
            disponible à indisponible déclenche une alerte critique. Seules les adresses publiques sont sondées&nbsp;:
            adresses IP, réseaux privés et noms internes sont refusés.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          Nom, adresse (http ou https) et application requis.
        </div>
      )}
      {urlRefusee && (
        <div
          role="alert"
          data-testid="url-refusee"
          className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink"
        >
          Adresse refusée&nbsp;: {urlRefusee}
        </div>
      )}

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Ajouter une sonde</h2>
        <form action={createUptimeCheckAction} className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Nom
            <input name="name" required placeholder="Accueil en production" className="field mt-1 block w-64 max-w-full" />
          </label>
          {/* Champs bornés à la carte (`min-w-0 max-w-full`) : la liste des
              applications prend la largeur de son plus long libellé (« Console MIP RUM
              (dogfooding) (mip-rum-console) ») et portait la page à 417 px sur 390.
              Nom, adresse et application ont la même largeur (`w-64`) : « App » s'étirait
              sur 380 px quand « Nom » en faisait 176 (recette du 26/09/2026). */}
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Adresse à sonder
            <input name="url" required placeholder="https://votre-site.fr/health" className="field mt-1 block w-64 max-w-full" />
          </label>
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Application
            <select name="app" required defaultValue="" className="field mt-1 block w-full max-w-full sm:w-64">
              <option value="" disabled>
                Choisir…
              </option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name} ({a.app_id})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Code HTTP attendu
            <input
              name="expect_status"
              type="number"
              defaultValue={200}
              aria-describedby="uptime-code-aide"
              className="field mt-1 block w-24 tabular-nums"
            />
          </label>
          <button type="submit" className="btn-accent">
            Ajouter
          </button>
        </form>
        <p id="uptime-code-aide" className="mt-2 text-xs text-ink-faint">
          Le code que doit renvoyer l&apos;adresse quand tout va bien&nbsp;: 200 le plus souvent.
        </p>
      </div>

      {/* Sans sonde, l'état vide est une carte, HORS du tableau : dans une cellule, il
          prenait la largeur du tableau (548 px) et se coupait dans une zone visible de
          356 px à 390 px (contre-recette du 26/09/2026). */}
      {!checks.length ? (
        <div className="card px-4 py-8 text-center text-sm text-ink-soft" data-testid="uptime-vide">
          {/* L'état vide dit ce qu'on obtiendra et quelle adresse choisir (recette du 26/09/2026). */}
          <p className="font-medium text-ink">Aucune sonde pour l&apos;instant.</p>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed">
            Ajoutez-en une ci-dessus, par exemple l&apos;adresse de santé de votre site
            (<span className="break-all font-mono">https://votre-site.fr/health</span>, code 200 attendu). Vous
            suivrez sa disponibilité sur 24&nbsp;h et son temps de réponse, et une alerte critique partira dès
            qu&apos;elle cessera de répondre.
          </p>
        </div>
      ) : (
        // Défilant et signalé : `overflow-hidden` coupait « Dernière sonde » et les
        // actions à 390 px (recette 26/09).
        <TableDefilante className="card" label="Sondes">
          <table className="w-full text-sm">
            <thead className="bg-panel2">
              <tr>
                <th className="th">État</th>
                <th className="th">Sonde</th>
                <th className="th">Disponibilité sur 24&nbsp;h</th>
                <th className="th">Temps de réponse</th>
                <th className="th">Dernière vérification</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {checks.map((c) => {
                const state = !c.enabled
                  ? "off"
                  : c.last_ok == null
                    ? "pending"
                    : c.last_ok
                      ? "up"
                      : "down";
                return (
                  <tr key={c.id} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2">
                      <StatusPill state={state} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-ink">{c.name}</div>
                      <div className="font-mono text-xs text-ink-faint">{c.url}</div>
                      {state === "down" && c.last_error && (
                        <div className="mt-0.5 text-xs text-bad-ink">{c.last_error}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {c.uptime_inconnu ? (
                        // Pendant une panne de collecte, « 100 % » serait faux : aucune vérification n'a eu lieu.
                        <span className="text-ink-soft" title={c.uptime_inconnu} data-uptime-inconnu="">
                          inconnu
                        </span>
                      ) : c.uptime_pct_24h == null ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <span className={c.uptime_pct_24h >= 99 ? "text-good-ink" : c.uptime_pct_24h >= 95 ? "text-warn-ink" : "text-bad-ink"}>
                          {fmtNombre(c.uptime_pct_24h, 1)}&nbsp;%
                        </span>
                      )}
                      <span className="block text-xs text-ink-faint">sur {pluriel(c.checks_24h, "vérification")}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">
                      {fmtLatency(c.last_latency_ms)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-faint">
                      {c.last_checked_at ? fmtDate(c.last_checked_at) : "En attente"}
                    </td>
                    <td className="px-4 py-2">
                      {/* `items-start` : la confirmation dépliée sous « Supprimer » n'étire pas « Désactiver ». */}
                      <div className="flex items-start gap-1">
                        <form action={toggleUptimeCheckAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="app" value={c.app_id} />
                          <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                          <button
                            type="submit"
                            className={`btn-ghost px-2 py-1 text-xs ${c.enabled ? "text-ink-soft" : "text-good-ink"}`}
                          >
                            {c.enabled ? "Désactiver" : "Réactiver"}
                          </button>
                        </form>
                        {/* La suppression emporte l'historique des vérifications (cascade) : confirmée. */}
                        <form action={deleteUptimeCheckAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="app" value={c.app_id} />
                          <ConfirmationDanger
                            libelle="Supprimer"
                            libelleAccessible={`Supprimer la sonde ${c.name}`}
                            question={`Supprimer la sonde ${entreGuillemets(c.name)}\u00a0?`}
                            consequence="Ses vérifications passées seront effacées avec elle et elle ne déclenchera plus d’alerte."
                            confirmer="Supprimer la sonde"
                            enCours="Suppression…"
                            classeDeclencheur="btn-ghost px-2 py-1 text-xs text-bad-ink"
                            testid={`supprimer-sonde-${c.id}`}
                          />
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableDefilante>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: "up" | "down" | "pending" | "off" }) {
  const meta = {
    up: { label: "Disponible", cls: "border-good/30 bg-good/10 text-good-ink" },
    down: { label: "Indisponible", cls: "border-bad/30 bg-bad/10 text-bad-ink" },
    pending: { label: "En attente", cls: "border-line bg-panel2 text-ink-soft" },
    off: { label: "Désactivée", cls: "border-line bg-panel2 text-ink-faint" },
  }[state];
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>;
}
