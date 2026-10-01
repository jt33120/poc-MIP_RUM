import Link from "next/link";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { KpiTile } from "@/components/charts/KpiTile";
import { entreGuillemets } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { FormulaireSecret } from "@/components/secret/SecretUnique";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerClients } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { ARRONDI_BAS, BOUTON_LIGNE, BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Moment, NombreBarre, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TD_NUM, TH, TH_NUM } from "../_ui/kit";
import { versMs } from "../_ui/temps";
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

const JOUR = 86_400_000;
const SOURCE = "Registre des applications de la console, et leurs données reçues";

/**
 * Applications clientes (administrateurs) : la liste et l'ajout guidé.
 *
 * Refonte du 01/10/2026 : les chiffres du parc d'applications en cases, l'ajout sur une
 * ligne en tête du tableau, un tableau dense (sessions en barre, dernière donnée en
 * temps écoulé, clé et statut en pastilles) ; l'explication dans la bulle.
 */
export default async function AdminCustomers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur : les applications de son périmètre ; créer, l'administrateur de la plateforme (C9).
  const { clients: customers, creation } = accesAdmin(await chargerEcran(ECRANS_ADMIN.clients, chargerClients, {}));
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const detail = typeof sp.detail === "string" ? sp.detail : null;
  const maintenant = Date.now();
  const actives = customers.filter((c) => c.active);
  const muettes = actives.filter((c) => !c.last_event_at || maintenant - versMs(c.last_event_at) > JOUR).length;
  const maxSessions = Math.max(1, ...customers.map((c) => c.sessions_7d));

  // Jetons du thème partout (recette du 26/09/2026) : les `bg-white` / `slate` /
  // `blue` écrits en dur donnaient des cartes blanches sur fond sombre, et des
  // colonnes « Clé API » et « Sessions 7 j » presque invisibles.
  return (
    <div className="animate-fade-up">
      <PageHeader title="Applications clientes" />

      {error && (
        <Erreur>
          {error}
          {detail && <code className="ml-2 break-all rounded bg-panel px-1.5 py-0.5 text-xs text-ink">{detail}</code>}
        </Erreur>
      )}

      {customers.length > 0 && (
        <RangeeCases testId="applications-cases">
          <KpiTile label="Applications actives" valeur={actives.length} format="count" source={SOURCE} methode="Applications autorisées à envoyer des mesures." />
          <KpiTile
            label="Sessions sur 7 jours, toutes applications"
            libelleCase="Sessions · 7 j"
            valeur={customers.reduce((s, c) => s + c.sessions_7d, 0)}
            format="count"
            source={SOURCE}
            methode="Somme des sessions reçues sur les 7 derniers jours par les applications de votre périmètre."
          />
          <KpiTile
            label="Applications actives sans donnée depuis 24 h"
            libelleCase="Muettes · 24 h"
            valeur={muettes}
            format="count"
            source={SOURCE}
            methode="Applications actives dont la dernière donnée reçue (Web Vital, événement ou activité de session) date de plus de 24 h, ou qui n'ont jamais rien envoyé."
          />
          <KpiTile
            label="Applications sans clé d'API"
            libelleCase="Sans clé d'API"
            valeur={customers.filter((c) => !c.has_key).length}
            format="count"
            source={SOURCE}
            methode="Intégrations anciennes, sans clé : dès lors que la collecte exige une clé d'API, leurs mesures sont refusées. La clé se génère sur la fiche de l'application."
          />
        </RangeeCases>
      )}

      <Panneau
        titre="Applications"
        compte={customers.length}
        aide={
          <>
            Une application = un site ou une application suivie, rattachée à un client. L&apos;ajouter génère sa clé d&apos;API
            (affichée une seule fois), autorise ses domaines à envoyer des mesures et ouvre son guide d&apos;intégration.
          </>
        }
        barre={
          // Créer une application : l'administrateur de la plateforme seul (C9) — un
          // administrateur d'une liste la verrait tomber hors de son périmètre. Sur une
          // ligne, en tête du tableau : la liste passe avant le formulaire.
          creation ? (
            <FormulaireSecret
              action={createCustomerAction}
              testid="create-customer-form"
              className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-end"
            >
              {/* `min-w-0 max-w-full` : un champ à largeur fixe ne pousse plus la page au-delà de 390 px. */}
              <label className={LIBELLE_CHAMP}>
                Nom de l&apos;application
                <input name="name" type="text" required placeholder="Portail Exemple" className="field block w-full py-1 text-xs" />
              </label>
              <label className={LIBELLE_CHAMP}>
                Identifiant
                <input
                  name="app_id"
                  type="text"
                  required
                  placeholder="portail-exemple"
                  pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                  title="minuscules, chiffres, tirets — 3 à 40 caractères"
                  className="field block w-full py-1 font-mono text-xs"
                />
              </label>
              <label className={LIBELLE_CHAMP}>
                Client (facultatif)
                <input name="client_id" type="text" placeholder="exemple-sa" className="field block w-full py-1 text-xs" />
              </label>
              <label className={LIBELLE_CHAMP} title="Séparés par une virgule ou un retour à la ligne">
                Domaines du site
                <textarea
                  name="origins"
                  required
                  rows={1}
                  placeholder={"https://app.exemple.fr, https://recette.exemple.fr"}
                  className="field block min-h-[1.9rem] w-full resize-y py-1 font-mono text-xs"
                />
              </label>
              <label className={LIBELLE_CHAMP}>
                Notes internes (facultatif)
                <input name="notes" type="text" placeholder="contact technique, contexte…" className="field block w-full py-1 text-xs" />
              </label>
              <button type="submit" className="btn-accent whitespace-nowrap">
                Ajouter l&apos;application
              </button>
            </FormulaireSecret>
          ) : undefined
        }
      >
        {/* Défilant et signalé : à 390 px, `overflow-hidden` rendait Statut, Clé API,
            Sessions et les actions (Guide, Désactiver) inaccessibles (recette 26/09). */}
        <TableDefilante label="Applications" className={ARRONDI_BAS}>
          {customers.length ? (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>
                    Application <span className="font-normal normal-case tracking-normal">· identifiant · client</span>
                  </th>
                  <th className={TH}>Domaines</th>
                  <th className={TH}>Clé d&apos;API</th>
                  <th className={TH_NUM}>Sessions · 7 j</th>
                  <th className={TH}>Dernière donnée</th>
                  <th className={TH}>Statut</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {customers.map((c) => (
                  <tr key={c.app_id} className={LIGNE} data-testid={`customer-${c.app_id}`}>
                    {/* Le nom, puis l'identifiant et le client sur une seconde ligne courte :
                        huit colonnes d'une ligne ne tenaient pas dans 1 120 px (défilement). */}
                    <td className={`${TD} py-1`}>
                      <Link href={`/admin/customers/${c.app_id}`} className="block max-w-[18rem] truncate font-medium text-brand hover:underline" title={c.name}>
                        {c.name}
                      </Link>
                      <span className="flex items-center gap-1.5 text-[11px] leading-4 text-ink-faint">
                        <code className={PUCE_ID}>{c.app_id}</code>
                        {c.client_id && (
                          <span className="whitespace-nowrap">
                            <span className="sr-only">client </span>
                            {c.client_id}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`} title={c.allowed_origins.join("\n") || undefined}>
                      {c.allowed_origins.length ? (
                        <span className="inline-flex max-w-[13rem] items-center gap-1">
                          <span className="truncate font-mono">{c.allowed_origins[0]}</span>
                          {c.allowed_origins.length > 1 && <span className="shrink-0 rounded-full bg-panel2 px-1.5 text-[11px] tabular-nums text-ink">+{c.allowed_origins.length - 1}</span>}
                          <span className="sr-only">{c.allowed_origins.slice(1).join(", ")}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {c.has_key ? (
                        <span className="text-good-ink">
                          <span aria-hidden>✓ </span>configurée
                        </span>
                      ) : (
                        <span className="text-warn-ink" title="Intégration ancienne, sans clé">
                          <span aria-hidden>✕ </span>aucune<span className="sr-only"> (intégration ancienne)</span>
                        </span>
                      )}
                    </td>
                    <td className={TD_NUM}>
                      <NombreBarre texte={c.sessions_7d.toLocaleString("fr-FR")} part={c.sessions_7d / maxSessions} />
                    </td>
                    <td className={`${TD} text-xs text-ink-soft`}>
                      <Moment date={c.last_event_at} maintenant={maintenant} vide="jamais" />
                    </td>
                    <td className={TD}>
                      <Pastille ton={c.active ? "bon" : "mauvais"}>{c.active ? "active" : "désactivée"}</Pastille>
                    </td>
                    <td className={TD}>
                      {/* `items-start` : la confirmation se déplie sous « Désactiver » sans étirer « Guide ». */}
                      <div className="flex items-start gap-2">
                        <Link href={`/admin/customers/${c.app_id}`} className={BOUTON_LIGNE}>
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
                              question={`Désactiver l’application ${entreGuillemets(c.name)} ?`}
                              consequence="Ses données seront refusées jusqu’à sa réactivation, dès lors que la collecte exige une clé d’API."
                              confirmer="Désactiver l’application"
                              enCours="Désactivation…"
                              classeDeclencheur={BOUTON_LIGNE_DANGER}
                              testid={`desactiver-${c.app_id}`}
                            />
                          ) : (
                            <button type="submit" className={BOUTON_LIGNE}>
                              Activer
                            </button>
                          )}
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <LigneVide>{creation ? "Aucune application : ajoutez la première ci-dessus." : "Aucune application dans votre périmètre."}</LigneVide>
          )}
        </TableDefilante>
      </Panneau>
    </div>
  );
}
