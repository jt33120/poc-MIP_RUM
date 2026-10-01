import { ECRANS_ADMIN } from "@mip/console-contract";
import { ExtensionActivationGuide } from "@/components/ExtensionActivationGuide";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { KpiTile } from "@/components/charts/KpiTile";
import { chargerDomaines } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { ARRONDI_BAS, BOUTON_LIGNE, BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Moment, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TH } from "../_ui/kit";
import { createExtensionScopeAction, toggleExtensionScopeAction } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE = "Registre des domaines de l'extension, tenu par la console";

/**
 * Registre domaine -> application pour l'extension navigateur (Ext-C) — administrateurs.
 *
 * Refonte du 01/10/2026 : l'enregistrement tient sur une ligne, dans l'en-tête du
 * registre ; la règle (« un domaine absent n'est jamais observé ») dans la bulle ; le
 * parcours d'activation reste replié en pied de page.
 */
export default async function ExtensionScope({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les domaines et les applications de son périmètre (C9).
  const { apps, domaines: scopes } = accesAdmin(await chargerEcran(ECRANS_ADMIN.domaines, chargerDomaines, {}));
  const error = typeof sp.error === "string" ? sp.error : null;
  const maintenant = Date.now();
  const actifs = scopes.filter((s) => s.active);
  const nomDe = new Map(apps.map((a) => [a.app_id, a.name]));

  return (
    <div className="animate-fade-up">
      <PageHeader title="Domaines de l'extension" />

      {error && <Erreur>Renseignez le domaine et choisissez une application.</Erreur>}

      {scopes.length > 0 && (
        <RangeeCases testId="domaines-cases" colonnes={3}>
          <KpiTile label="Domaines observés" valeur={actifs.length} format="count" source={SOURCE} methode="Domaines actifs : les seuls que l'extension a le droit d'observer." />
          <KpiTile label="Domaines désactivés" valeur={scopes.length - actifs.length} format="count" source={SOURCE} methode="Gardés dans le registre, jamais observés tant qu'ils restent désactivés." />
          <KpiTile
            label="Applications alimentées par l'extension"
            libelleCase="Applications alimentées"
            valeur={new Set(actifs.map((s) => s.app_id)).size}
            format="count"
            source={SOURCE}
            methode="Applications distinctes vers lesquelles au moins un domaine actif envoie ses mesures."
          />
        </RangeeCases>
      )}

      <Panneau
        titre="Domaines enregistrés"
        compte={scopes.length}
        className="mb-4"
        aide={
          <>
            Les domaines que l&apos;extension navigateur a le droit d&apos;observer, et l&apos;application à laquelle chacun
            envoie ses mesures. Un domaine absent de cette liste, ou désactivé, n&apos;est <strong>jamais</strong> observé par
            l&apos;extension.
          </>
        }
        barre={
          // L'action principale sur une ligne, en tête du registre (recette du 26/09/2026 :
          // le formulaire d'abord, la liste ensuite, le tutoriel replié).
          <form action={createExtensionScopeAction} className="flex min-w-0 flex-wrap items-end gap-2" data-testid="create-extension-scope">
            <label className={LIBELLE_CHAMP}>
              Domaine
              <input name="domain" required placeholder="app.exemple.fr" className="field block w-56 max-w-full py-1 font-mono text-xs" />
            </label>
            {/* `min-w-0 max-w-full` + `w-full` : la liste prend la largeur de son plus
                long libellé (« Console MIP RUM (dogfooding) (mip-rum-console) ») et
                portait la page à 417 px sur 390 ; elle se borne au panneau. */}
            {/* Libellé relié par `htmlFor` (et non englobant) : le texte du libellé reste
                « Application », sans la liste de ses options. */}
            <div className={LIBELLE_CHAMP}>
              <label htmlFor="domaine-application">Application</label>
              <select id="domaine-application" name="app" required defaultValue="" className="field block w-full max-w-full py-1 text-xs sm:w-72">
                <option value="" disabled>
                  choisir…
                </option>
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.name} ({a.app_id})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-accent">
              Enregistrer
            </button>
          </form>
        }
      >
        {/* Défilant et signalé : `overflow-hidden` coupait Statut et Actions à 390 px. La
            zone existe aussi sans domaine : c'est elle que désignent les tests. */}
        <TableDefilante label="Domaines enregistrés" className={ARRONDI_BAS}>
          {scopes.length ? (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>Domaine</th>
                  <th className={TH}>Application</th>
                  <th className={TH}>Enregistré</th>
                  <th className={TH}>Statut</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {scopes.map((s) => (
                  <tr key={s.id} className={LIGNE}>
                    <td className={`${TD} font-mono text-xs text-ink`}>{s.domain}</td>
                    <td className={TD}>
                      <span className="text-ink">{nomDe.get(s.app_id) ?? s.app_id}</span>
                      <code className={`${PUCE_ID} ml-2`}>{s.app_id}</code>
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <Moment date={s.created_at} maintenant={maintenant} />
                    </td>
                    <td className={TD}>
                      <Pastille ton={s.active ? "bon" : "eteint"}>{s.active ? "actif" : "désactivé"}</Pastille>
                    </td>
                    <td className={TD}>
                      <form action={toggleExtensionScopeAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="app" value={s.app_id} />
                        <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                        <button type="submit" className={s.active ? BOUTON_LIGNE_DANGER : `${BOUTON_LIGNE} text-good-ink`}>
                          {s.active ? "Désactiver" : "Réactiver"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // Sans bulle ici : dans la zone qui défile, elle serait rognée ; la règle
            // (« un domaine absent n'est jamais observé ») est dans la bulle du panneau.
            <LigneVide testId="domaines-vide">Aucun domaine : l&apos;extension n&apos;observe aucun site.</LigneVide>
          )}
        </TableDefilante>
      </Panneau>

      <ExtensionActivationGuide />
    </div>
  );
}
