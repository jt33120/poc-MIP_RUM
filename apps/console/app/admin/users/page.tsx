import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { KpiTile } from "@/components/charts/KpiTile";
import { FormulaireSecret, SecretAffiche } from "@/components/secret/SecretUnique";
import { getUser } from "@/lib/auth";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerComptes } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { Fenetre } from "../_ui/Fenetre";
import { FiltreLignes } from "../_ui/FiltreLignes";
import { ARRONDI_BAS, BOUTON_LIGNE, BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Moment, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TH } from "../_ui/kit";
import { createUserAction, resetPasswordAction, toggleUserAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  email: "Adresse e-mail invalide.",
  exists: "Un compte existe déjà pour cette adresse.",
  self: "Vous ne pouvez pas désactiver votre propre compte.",
  unknown: "Utilisateur inconnu.",
  apps: "Choisissez au moins une application, ou « Toutes les applications ».",
};

/** Libellés des rôles : le code garde `admin` / `viewer`, l'écran parle français. */
const ROLES = { admin: "Administrateur", viewer: "Lecteur" } as const;

const SOURCE = "Comptes de la console";

/** Les initiales d'une adresse (« julian.talou@… » → « JT ») : la pastille de la ligne. */
function initiales(email: string): string {
  const nom = email.split("@")[0] ?? "";
  const parties = nom.split(/[._-]+/).filter(Boolean);
  return ((parties[0]?.[0] ?? "") + (parties[1]?.[0] ?? parties[0]?.[1] ?? "")).toUpperCase() || "?";
}

/**
 * Gestion des comptes de la console (administrateur de la plateforme).
 *
 * Refonte du 01/10/2026 : les chiffres des comptes en cases, un tableau dense avec son
 * champ de recherche (la liste compte des dizaines de comptes) ; la création en fenêtre,
 * ouverte d'emblée quand on arrive de la fiche d'une application (`?app=`).
 */
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
  const maintenant = Date.now();

  return (
    <div className="animate-fade-up">
      <PageHeader title="Utilisateurs">
        <Fenetre libelle="Créer un utilisateur" titre="Créer un utilisateur" testId="ouvrir-creation-utilisateur" ouverteAuDepart={Boolean(prefillApp)} fermerALEnvoi large>
          <FormulaireSecret action={createUserAction} testid="create-user-form" className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className={LIBELLE_CHAMP}>
              Adresse e-mail
              <input name="email" type="email" required placeholder="prenom.nom@exemple.fr" className="field block w-full max-w-full" />
            </label>
            <label className={LIBELLE_CHAMP}>
              Rôle
              <select name="role" defaultValue="viewer" className="field block">
                <option value="viewer">{ROLES.viewer}</option>
                <option value="admin">{ROLES.admin}</option>
              </select>
            </label>
            {/* Une sélection, plus un champ libre (recette du 26/09/2026) : pré-rempli par
                `?app=`, le champ masquait l'indication « vide = toutes », et une faute de
                frappe créait un compte sans aucun accès. « Toutes » est un choix
                explicite ; « certaines » sans case cochée est refusé par l'action. */}
            <fieldset className="group min-w-0 max-w-full text-[11px] font-medium text-ink-soft sm:col-span-2">
              <legend>Applications autorisées</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <label className="flex items-center gap-2 font-normal text-ink">
                  <input type="radio" name="portee" value="toutes" defaultChecked={!prefillApp} />
                  Toutes les applications
                </label>
                <label className="flex items-center gap-2 font-normal text-ink">
                  <input type="radio" name="portee" value="liste" defaultChecked={Boolean(prefillApp)} disabled={!apps.length} />
                  Limité à certaines applications
                </label>
              </div>
              {apps.length > 0 && (
                <div
                  className="mt-2 grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line bg-panel2/50 p-2 text-sm transition group-has-[[value=toutes]:checked]:opacity-50 sm:grid-cols-2"
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
            </fieldset>
            <p className="text-[11px] text-ink-faint sm:col-span-2">
              Un administrateur gère la console ; un lecteur consulte les données. Le mot de passe est généré, et affiché une
              seule fois.
            </p>
            <div className="flex justify-end sm:col-span-2">
              <button type="submit" className="btn-accent">
                Créer (mot de passe généré)
              </button>
            </div>
          </FormulaireSecret>
        </Fenetre>
      </PageHeader>

      {error && <Erreur>{error}</Erreur>}

      {/* Le mot de passe généré (création ou réinitialisation) : rendu au formulaire
          par l'action, affiché une seule fois (C9c). */}
      <SecretAffiche
        nom="mot-de-passe"
        testid="one-time-password"
        testidValeur="generated-password"
        className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn-ink"
        codeClassName="rounded bg-panel px-2 py-0.5 font-mono text-ink"
        prefixe="Mot de passe de"
        suffixe={"(affiché une seule fois : notez-le maintenant) :"}
      />

      {users.length > 0 && (
        <RangeeCases testId="comptes-cases">
          <KpiTile label="Comptes actifs" valeur={users.filter((u) => u.active).length} format="count" source={SOURCE} methode="Comptes autorisés à se connecter." />
          <KpiTile label="Administrateurs actifs" libelleCase="Administrateurs" valeur={users.filter((u) => u.active && u.role === "admin").length} format="count" source={SOURCE} methode="Comptes actifs au rôle administrateur : ils gèrent la console (comptes, applications, jetons)." />
          <KpiTile label="Comptes désactivés" libelleCase="Désactivés" valeur={users.filter((u) => !u.active).length} format="count" source={SOURCE} methode="La connexion par mot de passe leur est refusée jusqu'à leur réactivation." />
          <KpiTile label="Comptes jamais connectés" libelleCase="Jamais connectés" valeur={users.filter((u) => !u.last_login_at).length} format="count" source={SOURCE} methode="Comptes sans aucune connexion enregistrée depuis leur création." />
        </RangeeCases>
      )}

      <Panneau
        titre="Comptes"
        compte={users.length}
        aide="Les comptes de la console. Un administrateur gère la console ; un lecteur consulte les données. Chacun voit toutes les applications, ou seulement celles qui lui sont attribuées. Toutes les actions sont tracées dans le journal d'audit."
        actions={users.length > 8 ? <FiltreLignes cible="utilisateurs-lignes" libelle="Filtrer les comptes" total={users.length} /> : undefined}
      >
        {/* Défilant et signalé : `overflow-hidden` coupait « Dernière connexion » et les
            actions — impossible de désactiver ou de réinitialiser un compte à 390 px. */}
        <TableDefilante label="Utilisateurs" className={ARRONDI_BAS}>
          {users.length ? (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>Adresse e-mail</th>
                  <th className={TH}>Rôle</th>
                  <th className={TH}>Applications</th>
                  <th className={TH}>Statut</th>
                  <th className={TH}>Dernière connexion</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody id="utilisateurs-lignes" className="divide-y divide-line/60">
                {users.map((u) => (
                  <tr key={u.email} className={LIGNE} data-ligne="">
                    {/* Une adresse ne se coupe pas au tiret : le tableau défile, il a la place. */}
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel2 text-[9px] font-bold text-ink-soft">
                          {initiales(u.email)}
                        </span>
                        <span className="font-mono text-xs text-ink">{u.email}</span>
                      </span>
                    </td>
                    <td className={TD}>
                      {/* Le badge lecteur porte une bordure et un texte plein : gris sur gris,
                          il se lisait mal en mode sombre. */}
                      <span
                        className={`whitespace-nowrap rounded border px-2 py-px text-[11px] font-medium ${
                          u.role === "admin" ? "border-accent/30 bg-accent/15 text-accent-ink" : "border-line bg-panel2 text-ink"
                        }`}
                      >
                        {ROLES[u.role]}
                      </span>
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      {u.apps === null ? (
                        "Toutes"
                      ) : u.apps.length ? (
                        <span className="flex flex-wrap gap-1">
                          {u.apps.map((id) => (
                            <span key={id} className={PUCE_ID} title={id}>
                              {nomDe.get(id) ?? id}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "Aucune"
                      )}
                    </td>
                    <td className={TD}>
                      <Pastille ton={u.active ? "bon" : "mauvais"}>{u.active ? "Actif" : "Désactivé"}</Pastille>
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <Moment date={u.last_login_at} maintenant={maintenant} vide="Jamais" />
                    </td>
                    <td className={TD}>
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
                              question={`Désactiver le compte ${u.email} ?`}
                              consequence="La connexion par mot de passe lui sera refusée jusqu’à sa réactivation."
                              confirmer="Désactiver le compte"
                              enCours="Désactivation…"
                              desactive={soi(u.email)}
                              raisonDesactive={soi(u.email) ? "Vous ne pouvez pas désactiver votre propre compte." : undefined}
                              classeDeclencheur={BOUTON_LIGNE_DANGER}
                              testid={`desactiver-${u.email}`}
                            />
                          ) : (
                            <button type="submit" className={BOUTON_LIGNE}>
                              Réactiver
                            </button>
                          )}
                        </form>
                        <FormulaireSecret action={resetPasswordAction} testid={`reset-${u.email}`}>
                          <input type="hidden" name="email" value={u.email} />
                          {/* « Réinitialiser » à l'écran, le geste entier nommé pour le lecteur
                              d'écran et dans la confirmation : le tableau tient à 1 440 px. */}
                          <ConfirmationDanger
                            libelle="Réinitialiser"
                            libelleAccessible={`Réinitialiser le mot de passe de ${u.email}`}
                            question={`Réinitialiser le mot de passe de ${u.email} ?`}
                            consequence="L’actuel cessera aussitôt de fonctionner ; le nouveau s’affichera une seule fois, en haut de cette page."
                            confirmer="Réinitialiser le mot de passe"
                            enCours="Réinitialisation…"
                            classeDeclencheur={BOUTON_LIGNE_DANGER}
                            testid={`reinitialiser-${u.email}`}
                          />
                        </FormulaireSecret>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <LigneVide>Aucun utilisateur : le premier compte administrateur se crée à l&apos;installation de la plateforme.</LigneVide>
          )}
        </TableDefilante>
      </Panneau>
    </div>
  );
}
