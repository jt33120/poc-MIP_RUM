import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { FormulaireSecret, SecretAffiche } from "@/components/secret/SecretUnique";
import { getUser } from "@/lib/auth";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerComptes } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { createUserAction, resetPasswordAction, toggleUserAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  email: "Adresse e-mail invalide.",
  exists: "Un compte existe déjà pour cette adresse.",
  self: "Vous ne pouvez pas désactiver votre propre compte.",
  unknown: "Utilisateur inconnu.",
  apps: "Choisissez au moins une application, ou « Toutes les applications ».",
};

/** Libellés des rôles : le code garde `admin` / `viewer`, l'écran parle français. */
const ROLES = { admin: "Administrateur", viewer: "Lecteur" } as const;

/** Gestion des comptes de la console (administrateur de la plateforme). */
export default async function AdminUsers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/administration.ts`) : l'administrateur de la plateforme seul (C9),
  // les comptes et les applications actives où en limiter un.
  const { comptes: users, apps } = accesAdmin(await chargerEcran(ECRANS_ADMIN.comptes, chargerComptes, {}));
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  // Le compte connecté : sa ligne ne propose pas de se désactiver soi-même. Le
  // principal est déjà mémorisé pour ce rendu (le layout l'a lu) : aucun appel de plus.
  const moi = (await getUser())?.email.toLowerCase() ?? null;
  const soi = (email: string) => email.toLowerCase() === moi;
  // Arrivée depuis la fiche d'une application (« accès client ») : un compte limité
  // à cette application, présélectionné — seulement si elle est dans la liste.
  const prefillApp = typeof sp.app === "string" && apps.some((a) => a.app_id === sp.app) ? sp.app : null;
  const nomDe = new Map(apps.map((a) => [a.app_id, a.name]));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Utilisateurs"
        sub={
          <>
            Les comptes de la console. Un administrateur gère la console&nbsp;; un lecteur consulte les données. Chacun
            voit toutes les applications, ou seulement celles qui lui sont attribuées. Toutes les actions sont tracées
            dans le journal d&apos;audit.
          </>
        }
      />

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          {error}
        </div>
      )}

      {/* Le mot de passe généré (création ou réinitialisation) : rendu au formulaire
          par l'action, affiché une seule fois (C9c). */}
      <SecretAffiche
        nom="mot-de-passe"
        testid="one-time-password"
        testidValeur="generated-password"
        className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
        codeClassName="rounded bg-panel px-2 py-0.5 font-mono text-ink"
        prefixe="Mot de passe de"
        suffixe={"(affiché une seule fois : notez-le maintenant) :"}
      />

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Créer un utilisateur</h2>
        <FormulaireSecret action={createUserAction} testid="create-user-form" className="flex flex-wrap items-start gap-4">
          <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
            Adresse e-mail
            <input
              name="email"
              type="email"
              required
              placeholder="prenom.nom@exemple.fr"
              className="field mt-1 block w-64 max-w-full"
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Rôle
            <select name="role" defaultValue="viewer" className="field mt-1 block">
              <option value="viewer">{ROLES.viewer}</option>
              <option value="admin">{ROLES.admin}</option>
            </select>
          </label>
          {/* Une sélection, plus un champ libre (recette du 26/09/2026) : pré-rempli par
              `?app=`, le champ masquait l'indication « vide = toutes », et une faute de
              frappe créait un compte sans aucun accès. « Toutes » est un choix
              explicite ; « certaines » sans case cochée est refusé par l'action. */}
          <fieldset className="group min-w-0 max-w-full text-xs font-medium text-ink-soft">
            <legend>Applications autorisées</legend>
            <div className="mt-1 space-y-1">
              <label className="flex items-center gap-2 font-normal text-ink">
                <input type="radio" name="portee" value="toutes" defaultChecked={!prefillApp} />
                Toutes les applications
              </label>
              <label className="flex items-center gap-2 font-normal text-ink">
                <input
                  type="radio"
                  name="portee"
                  value="liste"
                  defaultChecked={Boolean(prefillApp)}
                  disabled={!apps.length}
                />
                Limité à certaines applications
              </label>
              {apps.length > 0 && (
                <div
                  className="ml-6 max-h-40 w-72 max-w-full space-y-1 overflow-y-auto rounded-lg border border-line bg-panel2/50 p-2 transition group-has-[[value=toutes]:checked]:opacity-50"
                  data-testid="apps-autorisees"
                >
                  {apps.map((a) => (
                    <label key={a.app_id} className="flex min-w-0 items-center gap-2 font-normal text-ink">
                      <input type="checkbox" name="apps" value={a.app_id} defaultChecked={a.app_id === prefillApp} />
                      <span className="truncate">{a.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-faint">{a.app_id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </fieldset>
          <button type="submit" className="btn-accent self-end">
            Créer (mot de passe généré)
          </button>
        </FormulaireSecret>
      </div>

      {/* Défilant et signalé : `overflow-hidden` coupait « Dernière connexion » et les
          actions — impossible de désactiver ou de réinitialiser un compte à 390 px. */}
      <TableDefilante className="card" label="Utilisateurs">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Adresse e-mail</th>
              <th className="th">Rôle</th>
              <th className="th">Applications</th>
              <th className="th">Statut</th>
              <th className="th">Dernière connexion</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {users.map((u) => (
              <tr key={u.email} className="transition hover:bg-panel2/60">
                {/* Une adresse ne se coupe pas au tiret : le tableau défile, il a la place. */}
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2">
                  {/* Le badge lecteur porte une bordure et un texte plein : gris sur gris,
                      il se lisait mal en mode sombre. */}
                  <span
                    className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin"
                        ? "border-accent/30 bg-accent/15 text-accent-ink"
                        : "border-line bg-panel2 text-ink"
                    }`}
                  >
                    {ROLES[u.role]}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {u.apps === null
                    ? "Toutes"
                    : u.apps.length
                      ? u.apps.map((id) => nomDe.get(id) ?? id).join(", ")
                      : "Aucune"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.active
                        ? "bg-good/10 text-good-ink"
                        : "bg-bad/10 text-bad-ink"
                    }`}
                  >
                    {u.active ? "Actif" : "Désactivé"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">
                  {u.last_login_at ? fmtDate(u.last_login_at) : "Jamais"}
                </td>
                <td className="px-4 py-2">
                  {/* `items-start` : une confirmation dépliée n'étire pas le bouton voisin. */}
                  <div className="flex items-start gap-2">
                    <form action={toggleUserAction} data-testid={`toggle-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                      {/* Désactiver se confirme ; sur SA propre ligne, le bouton reste
                          visible mais grisé, avec la raison — la commande refuse de
                          toute façon (`soi_meme`), mieux vaut ne pas proposer le geste.
                          Réactiver ne coupe rien et part d'un clic. */}
                      {u.active ? (
                        <ConfirmationDanger
                          libelle="Désactiver"
                          libelleAccessible={`Désactiver le compte ${u.email}`}
                          question={`Désactiver le compte ${u.email} ?`}
                          consequence="La connexion par mot de passe lui sera refusée jusqu’à sa réactivation."
                          confirmer="Désactiver le compte"
                          enCours="Désactivation…"
                          desactive={soi(u.email)}
                          raisonDesactive={soi(u.email) ? "Vous ne pouvez pas désactiver votre propre compte." : undefined}
                          testid={`desactiver-${u.email}`}
                        />
                      ) : (
                        <button type="submit" className="btn-ghost px-2 py-1">
                          Réactiver
                        </button>
                      )}
                    </form>
                    <FormulaireSecret action={resetPasswordAction} testid={`reset-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <ConfirmationDanger
                        libelle="Réinitialiser le mot de passe"
                        libelleAccessible={`Réinitialiser le mot de passe de ${u.email}`}
                        question={`Réinitialiser le mot de passe de ${u.email} ?`}
                        consequence="L’actuel cessera aussitôt de fonctionner ; le nouveau s’affichera une seule fois, en haut de cette page."
                        confirmer="Réinitialiser le mot de passe"
                        enCours="Réinitialisation…"
                        testid={`reinitialiser-${u.email}`}
                      />
                    </FormulaireSecret>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                  Aucun utilisateur. Le premier compte administrateur se crée à l&apos;installation de la plateforme.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
    </div>
  );
}
