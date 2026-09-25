import Link from "next/link";
import { FormulaireSecret } from "@/components/secret/SecretUnique";
import { chargerClients } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran-local";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { createCustomerAction, toggleAppAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  app_id: "Identifiant invalide : minuscules, chiffres et tirets, 3 à 40 caractères (ex. plateforme-client).",
  name: "Le nom est requis.",
  origin: "Origine invalide — il faut une URL http(s) absolue (ex. https://app.client.fr).",
  no_origin: "Au moins un domaine (origine) est requis pour autoriser le CORS.",
  exists: "Cet identifiant d'app existe déjà.",
  unknown: "App inconnue.",
};

/** Onboarding clients (admin) — liste des apps + création guidée (v0.5). */
export default async function AdminCustomers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les applications de son périmètre ; créer, l'administrateur de la plateforme (C9).
  const { clients: customers, creation } = accesAdmin(await chargerEcran(chargerClients, {}));
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const detail = typeof sp.detail === "string" ? sp.detail : null;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Clients</h1>
      <p className="mb-6 text-sm text-slate-500">
        Une app = un site monitoré. La création génère la clé d&apos;API (affichée une seule
        fois), autorise le domaine (CORS dynamique) et ouvre le guide d&apos;intégration pas-à-pas.
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          {error}
          {detail && <code className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs">{detail}</code>}
        </div>
      )}

      {/* Créer une application : l'administrateur de la plateforme seul (C9) — un
          administrateur d'une liste la verrait tomber hors de son périmètre. */}
      {creation && (
      <div className="mb-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Ajouter un client</h2>
        {/* La clé générée est rendue au formulaire, qui l'affiche sur la fiche de l'application (C9c). */}
        <FormulaireSecret action={createCustomerAction} testid="create-customer-form" className="grid max-w-3xl gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-medium text-slate-600">
              Nom de l&apos;application
              <input
                name="name"
                type="text"
                required
                placeholder="Plateforme Groupement IT"
                className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Identifiant (app_id)
              <input
                name="app_id"
                type="text"
                required
                placeholder="plateforme-git"
                pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                title="minuscules, chiffres, tirets — 3 à 40 caractères"
                className="mt-1 block w-52 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Client / groupement
              <input
                name="client_id"
                type="text"
                placeholder="groupement-it (optionnel)"
                className="mt-1 block w-52 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="text-xs font-medium text-slate-600">
            Domaines du site (origines autorisées, séparées par virgule ou retour ligne)
            <textarea
              name="origins"
              required
              rows={2}
              placeholder={"https://app.client.fr\nhttps://staging.client.fr"}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Notes internes
            <input
              name="notes"
              type="text"
              placeholder="contact technique, contexte… (optionnel)"
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <div>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Créer le client (clé d&apos;API générée)
            </button>
          </div>
        </FormulaireSecret>
      </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">App</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Domaines</th>
              <th className="px-4 py-2">Clé API</th>
              <th className="px-4 py-2">Sessions 7 j</th>
              <th className="px-4 py-2">Dernier event</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c) => (
              <tr key={c.app_id} data-testid={`customer-${c.app_id}`}>
                <td className="px-4 py-2">
                  <Link href={`/admin/customers/${c.app_id}`} className="font-medium text-blue-700 hover:underline">
                    {c.name}
                  </Link>
                  <div className="font-mono text-[11px] text-slate-400">{c.app_id}</div>
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">{c.client_id ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {c.allowed_origins.length ? c.allowed_origins.join(", ") : "—"}
                </td>
                <td className="px-4 py-2 text-xs">{c.has_key ? "configurée" : "aucune (legacy)"}</td>
                <td className="px-4 py-2 text-xs">{c.sessions_7d}</td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {c.last_event_at ? fmtDate(c.last_event_at) : "jamais"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.active ? "bg-green-100 text-green-800" : "bg-bad/10 text-bad-ink"
                    }`}
                  >
                    {c.active ? "actif" : "désactivé"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/customers/${c.app_id}`}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Guide
                    </Link>
                    <form action={toggleAppAction}>
                      <input type="hidden" name="app_id" value={c.app_id} />
                      <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                      <button
                        type="submit"
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {c.active ? "Désactiver" : "Activer"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!customers.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Aucune app — crée ton premier client ci-dessus
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
