import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { KpiTile } from "@/components/charts/KpiTile";
import { entreGuillemets } from "@/lib/format";
import { FormulaireSecret, SecretAffiche } from "@/components/secret/SecretUnique";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerJetonsLecture } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { VALIDITE_LECTURE_DEFAUT_JOURS, VALIDITE_LECTURE_MAX_JOURS, VALIDITES_LECTURE_JOURS } from "@/lib/read-tokens";
import { Fenetre } from "../_ui/Fenetre";
import { ARRONDI_BAS, Barre, BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Moment, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TH } from "../_ui/kit";
import { partRestante } from "../_ui/temps";
import { createReadTokenAction, revokeReadTokenAction } from "./actions";

export const dynamic = "force-dynamic";

const ERREURS: Record<string, string> = {
  app: "Choisissez une application.",
  validite: `Durée de validité invalide : de 1 à ${VALIDITE_LECTURE_MAX_JOURS} jours.`,
};

const JOUR = 86_400_000;
const SOURCE = "Jetons d'accès enregistrés par la console (seule leur empreinte est conservée)";

/**
 * Le nom de la zone défilante du tableau, lu par l'e2e des tableaux défilants
 * (`tests/e2e/tableaux-defilants.spec.ts`, « Jetons de lecture ») : il suivra le
 * renommage quand ce test le suivra — jusque-là, le garder évite de casser la CI.
 */
const REGION_JETONS = "Jetons de lecture";

/**
 * Les jetons d'accès (administrateurs) : générer, suivre l'échéance, révoquer.
 *
 * « Jeton d'accès » (refonte du 01/10/2026), plus « jeton de lecture » : c'est un jeton
 * d'accès PORTEUR, en lecture seule, limité à la synthèse d'une application — le même
 * mot que les autres jetons de la console. L'URL de l'écran et le code gardent
 * « read-token ».
 */
export default async function ReadTokens({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les jetons et les applications de son périmètre (C9), et si la
  // base porte l'échéance des jetons.
  const { apps, jetons: tokens, echeance } = accesAdmin(await chargerEcran(ECRANS_ADMIN.jetonsLecture, chargerJetonsLecture, {}));
  const error = typeof sp.error === "string" ? (ERREURS[sp.error] ?? ERREURS.app) : null;
  const maintenant = Date.now();

  const statutDe = (t: (typeof tokens)[number]) =>
    t.revoked_at ? "révoqué" : t.expires_at != null && new Date(t.expires_at).getTime() <= maintenant ? "expiré" : "actif";
  const actifs = tokens.filter((t) => statutDe(t) === "actif");
  const bientot = actifs.filter((t) => t.expires_at != null && new Date(t.expires_at).getTime() - maintenant < 30 * JOUR).length;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Jetons d'accès">
        <Fenetre libelle="Créer un jeton" titre="Créer un jeton d'accès" testId="ouvrir-creation-jeton" fermerALEnvoi>
          <FormulaireSecret action={createReadTokenAction} className="grid gap-3 sm:grid-cols-2" testid="create-read-token">
            {/* `min-w-0 max-w-full` + `w-full` : la liste prend la largeur de son plus
                long libellé et portait la page à 417 px sur 390 ; elle se borne au cadre. */}
            <label className={`${LIBELLE_CHAMP} sm:col-span-2`}>
              Application
              <select name="app" required defaultValue="" className="field block w-full max-w-full">
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
            <label className={LIBELLE_CHAMP}>
              Libellé
              <input name="label" placeholder="Outil de supervision" className="field block w-full max-w-full" />
            </label>
            {/* Proposée seulement quand la base la tiendra : sans elle, le jeton serait
                créé sans échéance, et l'écran aurait promis le contraire. */}
            {echeance && (
              <label className={LIBELLE_CHAMP}>
                Validité
                <select name="validite" required defaultValue={String(VALIDITE_LECTURE_DEFAUT_JOURS)} className="field block w-full max-w-full">
                  {VALIDITES_LECTURE_JOURS.map((j) => (
                    <option key={j} value={j}>
                      {j === 365 ? "1 an" : `${j} jours`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-[11px] text-ink-faint sm:col-span-2">
              Lecture seule, synthèse de l&apos;application choisie. Affiché une seule fois : copiez-le aussitôt.
            </p>
            <div className="flex justify-end sm:col-span-2">
              <button type="submit" className="btn-accent">
                Générer
              </button>
            </div>
          </FormulaireSecret>
        </Fenetre>
      </PageHeader>

      {error && <Erreur>{error}</Erreur>}

      {/* Le jeton en clair : rendu au formulaire par l'action, affiché une seule fois (C9c). */}
      <SecretAffiche
        nom="jeton-lecture"
        testid="one-time-token"
        testidValeur="generated-token"
        className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink"
        codeClassName="mt-1 block break-all rounded bg-panel px-2 py-1 font-mono text-ink"
        prefixe="Jeton pour"
        suffixe="(affiché une seule fois : copiez-le maintenant) :"
      />

      {tokens.length > 0 && (
        <RangeeCases testId="jetons-cases">
          <KpiTile label="Jetons actifs" valeur={actifs.length} format="count" source={SOURCE} methode="Ni révoqués ni arrivés à échéance." />
          <KpiTile
            label="Échéance sous 30 jours"
            libelleCase="Échéance < 30 j"
            valeur={bientot}
            format="count"
            source={SOURCE}
            methode="Jetons actifs dont l'échéance tombe dans les 30 prochains jours : à renouveler avant que l'outil qui les emploie ne perde l'accès."
          />
          <KpiTile
            label="Applications ouvertes à un outil"
            libelleCase="Applications ouvertes"
            valeur={new Set(actifs.map((t) => t.app_id)).size}
            format="count"
            source={SOURCE}
            methode="Applications distinctes qu'au moins un jeton actif ouvre en lecture."
          />
          <KpiTile label="Jetons révoqués ou expirés" libelleCase="Révoqués ou expirés" valeur={tokens.length - actifs.length} format="count" source={SOURCE} methode="Gardés pour la trace : un jeton révoqué ne se rétablit pas." />
        </RangeeCases>
      )}

      <Panneau
        titre="Jetons"
        compte={tokens.length}
        aide={
          <>
            Un jeton d&apos;accès porteur, en lecture seule, limité à la synthèse d&apos;une application (
            <code className="chip-mono">/api/rum/summary</code>) : il l&apos;ouvre à un outil externe (supervision, tableau de
            bord). Il n&apos;est affiché qu&apos;une fois : seule son empreinte est conservée.
          </>
        }
      >
        {/* Défilant et signalé : `overflow-hidden` coupait Statut et Actions à 390 px. La
            zone existe aussi sans jeton (l'état vide y tient sur une ligne) : c'est elle
            que désignent les tests. */}
        <TableDefilante label={REGION_JETONS} className={ARRONDI_BAS}>
          {tokens.length ? (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>Libellé</th>
                  <th className={TH}>Application</th>
                  <th className={TH}>Portée</th>
                  <th className={TH}>Créé</th>
                  {echeance && <th className={TH}>Échéance</th>}
                  <th className={TH}>Statut</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {tokens.map((t) => {
                  const statut = statutDe(t);
                  const reste = statut === "actif" && t.expires_at ? partRestante(t.created_at, t.expires_at, maintenant) : null;
                  return (
                    <tr key={t.id} className={LIGNE}>
                      <td className={`${TD} text-ink`}>{t.label ?? <span className="text-ink-faint">sans libellé</span>}</td>
                      <td className={TD}>
                        <code className={PUCE_ID}>{t.app_id}</code>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs text-ink-soft`}>synthèse · lecture</td>
                      <td className={`${TD} text-xs text-ink-soft`}>
                        <Moment date={t.created_at} maintenant={maintenant} />
                      </td>
                      {echeance && (
                        <td className={`${TD} text-xs text-ink-soft`}>
                          {t.expires_at ? (
                            <span className="inline-flex items-center gap-2">
                              <Moment date={t.expires_at} maintenant={maintenant} />
                              {/* La validité qui reste : un jeton qui s'éteint se voit avant que l'outil ne perde l'accès. */}
                              <Barre part={reste} ton={reste != null && reste < 0.15 ? "attention" : "neutre"} largeur="w-12" />
                            </span>
                          ) : (
                            "sans échéance"
                          )}
                        </td>
                      )}
                      <td className={TD}>
                        <Pastille ton={statut === "actif" ? "bon" : "mauvais"}>{statut}</Pastille>
                      </td>
                      <td className={TD}>
                        {!t.revoked_at && (
                          <form action={revokeReadTokenAction}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="app" value={t.app_id} />
                            {/* Une révocation ne se défait pas : confirmée, le jeton nommé. */}
                            <ConfirmationDanger
                              libelle="Révoquer"
                              libelleAccessible={`Révoquer le jeton d'accès ${t.label ?? t.app_id}`}
                              question={`Révoquer le jeton d'accès ${t.label ? entreGuillemets(t.label) : "sans libellé"} de ${t.app_id} ?`}
                              consequence="Les outils qui l’utilisent ne pourront plus lire les données de cette application ; un jeton révoqué ne se rétablit pas."
                              confirmer="Révoquer le jeton"
                              enCours="Révocation…"
                              classeDeclencheur={BOUTON_LIGNE_DANGER}
                              testid={`revoquer-jeton-${t.id}`}
                            />
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <LigneVide testId="jetons-vide">Aucun jeton d&apos;accès : « Créer un jeton » en ouvre un à un outil externe.</LigneVide>
          )}
        </TableDefilante>
      </Panneau>
    </div>
  );
}
