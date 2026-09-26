import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger, entreGuillemets } from "@/components/ConfirmationDanger";
import { FormulaireSecret, SecretAffiche } from "@/components/secret/SecretUnique";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerJetonsLecture } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate, fmtJour } from "@/lib/format";
import { VALIDITE_LECTURE_DEFAUT_JOURS, VALIDITE_LECTURE_MAX_JOURS, VALIDITES_LECTURE_JOURS } from "@/lib/read-tokens";
import { createReadTokenAction, revokeReadTokenAction } from "./actions";

export const dynamic = "force-dynamic";

const ERREURS: Record<string, string> = {
  app: "Choisissez une application.",
  validite: `Durée de validité invalide : de 1 à ${VALIDITE_LECTURE_MAX_JOURS} jours.`,
};

/** Les jetons de lecture (administrateurs) : générer, suivre l'échéance, révoquer. */
export default async function ReadTokens({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les jetons et les applications de son périmètre (C9), et si la
  // base porte l'échéance des jetons.
  const { apps, jetons: tokens, echeance } = accesAdmin(await chargerEcran(ECRANS_ADMIN.jetonsLecture, chargerJetonsLecture, {}));
  const error = typeof sp.error === "string" ? (ERREURS[sp.error] ?? ERREURS.app) : null;
  const maintenant = Date.now();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Jetons de lecture"
        sub={
          <>
            Un jeton de lecture ouvre à un outil externe (supervision, tableau de bord) la synthèse
            d&apos;une seule application, à l&apos;adresse <code className="chip-mono">/api/rum/summary</code>.
            Il n&apos;est affiché qu&apos;une fois : seule son empreinte est conservée.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">{error}</div>
      )}

      {/* Le jeton en clair : rendu au formulaire par l'action, affiché une seule fois (C9c). */}
      <SecretAffiche
        nom="jeton-lecture"
        testid="one-time-token"
        testidValeur="generated-token"
        className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
        codeClassName="mt-1 block break-all rounded bg-panel px-2 py-1 font-mono text-ink"
        prefixe="Jeton pour"
        suffixe="(affiché une seule fois : copiez-le maintenant) :"
      />

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Générer un jeton</h2>
        <FormulaireSecret action={createReadTokenAction} className="flex flex-wrap items-end gap-3" testid="create-read-token">
          {/* `min-w-0 max-w-full` + `w-full` : la liste prend la largeur de son plus
              long libellé et portait la page à 417 px sur 390 ; elle se borne à la carte. */}
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Application
            <select name="app" required defaultValue="" className="field mt-1 block w-full max-w-full">
              <option value="" disabled>
                choisir…
              </option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name} ({a.app_id})
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Libellé
            <input name="label" placeholder="Outil de supervision" className="field mt-1 block w-52 max-w-full" />
          </label>
          {/* Proposée seulement quand la base la tiendra : sans elle, le jeton serait
              créé sans échéance, et l'écran aurait promis le contraire. */}
          {echeance && (
            <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
              Validité
              <select
                name="validite"
                required
                defaultValue={String(VALIDITE_LECTURE_DEFAUT_JOURS)}
                className="field mt-1 block w-full max-w-full"
              >
                {VALIDITES_LECTURE_JOURS.map((j) => (
                  <option key={j} value={j}>
                    {j === 365 ? "1 an" : `${j} jours`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn-accent">
            Générer
          </button>
        </FormulaireSecret>
      </div>

      {/* Défilant et signalé : `overflow-hidden` coupait Statut et Actions à 390 px. */}
      <TableDefilante className="card" label="Jetons de lecture">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Application</th>
              <th className="th">Libellé</th>
              <th className="th">Créé le</th>
              {echeance && <th className="th">Expire le</th>}
              <th className="th">Statut</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {tokens.map((t) => {
              const echu = t.expires_at != null && new Date(t.expires_at).getTime() <= maintenant;
              const statut = t.revoked_at ? "révoqué" : echu ? "expiré" : "actif";
              return (
                <tr key={t.id} className="transition hover:bg-panel2/60">
                  <td className="px-4 py-2 font-mono text-xs">{t.app_id}</td>
                  <td className="px-4 py-2 text-ink-soft">{t.label ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">{fmtDate(t.created_at)}</td>
                  {echeance && (
                    <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">
                      {t.expires_at ? fmtJour(t.expires_at, { annee: true }) : "sans échéance"}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        statut === "actif" ? "bg-good/10 text-good-ink" : "bg-bad/10 text-bad-ink"
                      }`}
                    >
                      {statut}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {!t.revoked_at && (
                      <form action={revokeReadTokenAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="app" value={t.app_id} />
                        {/* Une révocation ne se défait pas : confirmée, le jeton nommé. */}
                        <ConfirmationDanger
                          libelle="Révoquer"
                          libelleAccessible={`Révoquer le jeton de lecture ${t.label ?? t.app_id}`}
                          question={`Révoquer le jeton de lecture ${t.label ? entreGuillemets(t.label) : "sans libellé"} de ${t.app_id}\u00a0?`}
                          consequence="Les outils qui l’utilisent ne pourront plus lire les données de cette application ; un jeton révoqué ne se rétablit pas."
                          confirmer="Révoquer le jeton"
                          enCours="Révocation…"
                          classeDeclencheur="btn-ghost px-2 py-1 text-bad-ink"
                          testid={`revoquer-jeton-${t.id}`}
                        />
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {!tokens.length && (
              <tr>
                <td colSpan={echeance ? 6 : 5} className="px-4 py-8 text-center text-ink-faint">
                  Aucun jeton : générez-en un ci-dessus.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
    </div>
  );
}
