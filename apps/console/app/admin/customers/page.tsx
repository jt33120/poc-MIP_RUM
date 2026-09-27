import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { FormulaireSecret } from "@/components/secret/SecretUnique";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerClients } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { createCustomerAction, toggleAppAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  app_id: "Identifiant invalide : minuscules, chiffres et tirets, 3 à 40 caractères (ex. portail-exemple).",
  name: "Le nom de l’application est requis.",
  origin: "Domaine invalide : il faut une adresse http(s) complète (ex. https://app.exemple.fr).",
  no_origin: "Au moins un domaine est requis : c’est lui qui autorise le site à envoyer ses mesures.",
  exists: "Une application porte déjà cet identifiant.",
  unknown: "Application inconnue.",
};

/** Applications clientes (administrateurs) : la liste et l'ajout guidé. */
export default async function AdminCustomers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les applications de son périmètre ; créer, l'administrateur de la plateforme (C9).
  const { clients: customers, creation } = accesAdmin(await chargerEcran(ECRANS_ADMIN.clients, chargerClients, {}));
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const detail = typeof sp.detail === "string" ? sp.detail : null;

  // Jetons du thème partout (recette du 26/09/2026) : les `bg-white` / `slate` /
  // `blue` écrits en dur donnaient des cartes blanches sur fond sombre, et des
  // colonnes « Clé API » et « Sessions 7 j » presque invisibles.
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Applications clientes"
        sub={
          <>
            Une application = un site ou une application suivie, rattachée à un client. L&apos;ajouter
            génère sa clé d&apos;API (affichée une seule fois), autorise ses domaines à envoyer des
            mesures et ouvre son guide d&apos;intégration.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          {error}
          {detail && <code className="ml-2 break-all rounded bg-panel px-1.5 py-0.5 text-xs text-ink">{detail}</code>}
        </div>
      )}

      {/* Créer une application : l'administrateur de la plateforme seul (C9) — un
          administrateur d'une liste la verrait tomber hors de son périmètre. */}
      {creation && (
        <div className="card mb-8 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Ajouter une application</h2>
          {/* La clé générée est rendue au formulaire, qui l'affiche sur la fiche de l'application (C9c). */}
          <FormulaireSecret action={createCustomerAction} testid="create-customer-form" className="grid max-w-3xl gap-3">
            {/* `min-w-0 max-w-full` + `w-64 max-w-full` : un champ à largeur fixe ne
                pousse plus la page au-delà de 390 px. */}
            <div className="flex flex-wrap gap-3">
              <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
                Nom de l&apos;application
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="Portail Exemple"
                  className="field mt-1 block w-64 max-w-full"
                />
              </label>
              <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
                Identifiant de l&apos;application
                <input
                  name="app_id"
                  type="text"
                  required
                  placeholder="portail-exemple"
                  pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                  title="minuscules, chiffres, tirets — 3 à 40 caractères"
                  className="field mt-1 block w-52 max-w-full font-mono"
                />
              </label>
              <label className="min-w-0 max-w-full text-xs font-medium text-ink-soft">
                Client (facultatif)
                <input
                  name="client_id"
                  type="text"
                  placeholder="exemple-sa"
                  className="field mt-1 block w-52 max-w-full"
                />
              </label>
            </div>
            <label className="text-xs font-medium text-ink-soft">
              Domaines du site, séparés par une virgule ou un retour à la ligne
              <textarea
                name="origins"
                required
                rows={2}
                placeholder={"https://app.exemple.fr\nhttps://recette.exemple.fr"}
                className="field mt-1 block w-full font-mono"
              />
            </label>
            <label className="text-xs font-medium text-ink-soft">
              Notes internes (facultatif)
              <input
                name="notes"
                type="text"
                placeholder="contact technique, contexte…"
                className="field mt-1 block w-full"
              />
            </label>
            <div>
              <button type="submit" className="btn-accent">
                Ajouter l&apos;application
              </button>
            </div>
          </FormulaireSecret>
        </div>
      )}

      {/* Défilant et signalé : à 390 px, `overflow-hidden` rendait Statut, Clé API,
          Sessions et les actions (Guide, Désactiver) inaccessibles (recette 26/09). */}
      <TableDefilante className="card" label="Applications">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap bg-panel2">
            <tr>
              <th className="th">Application</th>
              <th className="th">Client</th>
              <th className="th">Domaines</th>
              <th className="th">Clé d&apos;API</th>
              <th className="th">Sessions sur 7 jours</th>
              <th className="th">Dernière donnée reçue</th>
              <th className="th">Statut</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {customers.map((c) => (
              <tr key={c.app_id} className="transition hover:bg-panel2/60" data-testid={`customer-${c.app_id}`}>
                <td className="px-4 py-2">
                  <Link href={`/admin/customers/${c.app_id}`} className="font-medium text-brand hover:underline">
                    {c.name}
                  </Link>
                  <div className="font-mono text-[11px] text-ink-faint">{c.app_id}</div>
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">{c.client_id ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {c.allowed_origins.length ? c.allowed_origins.join(", ") : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">
                  {c.has_key ? "configurée" : "aucune (intégration ancienne)"}
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink">{c.sessions_7d.toLocaleString("fr-FR")}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-ink-soft">
                  {c.last_event_at ? fmtDate(c.last_event_at) : "jamais"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.active ? "bg-good/10 text-good-ink" : "bg-bad/10 text-bad-ink"
                    }`}
                  >
                    {c.active ? "active" : "désactivée"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {/* `items-start` : la confirmation se déplie sous « Désactiver » sans étirer « Guide ». */}
                  <div className="flex items-start gap-2">
                    <Link href={`/admin/customers/${c.app_id}`} className="btn-ghost px-2 py-1">
                      Guide
                    </Link>
                    <form action={toggleAppAction}>
                      <input type="hidden" name="app_id" value={c.app_id} />
                      <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                      {/* Désactiver est confirmé (ses données peuvent être refusées) ;
                          réactiver ne coupe rien et part d'un clic. */}
                      {c.active ? (
                        <ConfirmationDanger
                          libelle="Désactiver"
                          libelleAccessible={`Désactiver l’application ${c.name}`}
                          question={`Désactiver l’application ${entreGuillemets(c.name)}\u00a0?`}
                          consequence="Ses données seront refusées jusqu’à sa réactivation, dès lors que la collecte exige une clé d’API."
                          confirmer="Désactiver l’application"
                          enCours="Désactivation…"
                          testid={`desactiver-${c.app_id}`}
                        />
                      ) : (
                        <button type="submit" className="btn-ghost px-2 py-1">
                          Activer
                        </button>
                      )}
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!customers.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  {creation ? "Aucune application : ajoutez la première ci-dessus." : "Aucune application dans votre périmètre."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>
    </div>
  );
}
