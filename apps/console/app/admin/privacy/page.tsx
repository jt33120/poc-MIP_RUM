import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { InfoTip } from "@/components/InfoTip";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerViePrivee } from "@/lib/chargeurs/vie-privee";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { DSAR_BARRIERE_MESSAGES, DSAR_LIMITES, DSAR_MESSAGES, libelleTableDsar, phraseBarriere } from "@/lib/dsar";
import { accord, pluriel } from "@/lib/format";
import { ARRONDI_BAS, Barre, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Panneau, Pastille, TD, TD_NUM, TH, TH_NUM, type TonPastille } from "../_ui/kit";
import { eraseIdentityAction, eraseUserAction, searchIdentityAction } from "./actions";

export const dynamic = "force-dynamic";

// Refonte du 01/10/2026 (grammaire `app/admin/_ui`, comme Source maps et Utilisateurs) :
// quatre paragraphes d'explication passent dans les bulles « ? » des panneaux ; les deux
// recherches se rangent côte à côte ; le résultat est un tableau dense, et ses deux
// gestes (exporter, effacer) tiennent dans la barre du panneau. Les garde-fous restent :
// l'effacement exige de ressaisir l'identifiant, et chaque geste passe au journal.

const ERRORS: Record<string, string> = {
  empty: "Renseignez un identifiant.",
  app: "Choisissez une application : les identifiants pseudonymisés sont propres à chaque application.",
  kind: "Choisissez une identité utilisateur ou compte.",
  secret: "La recherche par identité est indisponible : la clé de pseudonymisation n'est pas configurée sur la plateforme.",
  confirm: "La confirmation ne correspond pas à l'identifiant : effacement annulé.",
  perimetre: "Cette application n'est pas dans votre périmètre (« toutes » : l'administrateur de la plateforme).",
  // Le motif de refus renvoyé par la Server Action, mot pour mot.
  refus_empreinte: DSAR_MESSAGES.refus_empreinte,
  inconnu: DSAR_MESSAGES.inconnu,
};

const TYPE_IDENTITE = { user: "utilisateur", account: "compte" } as const;

/** La protection après effacement, en pastille : le mot court, la phrase dans la bulle. */
const BARRIERE: Record<"enforce" | "off" | "indisponible", { ton: TonPastille; texte: string }> = {
  enforce: { ton: "bon", texte: "Retour refusé après effacement" },
  off: { ton: "attention", texte: "Retour recollecté après effacement" },
  indisponible: { ton: "attention", texte: "Retour après effacement : inconnu" },
};

const BOUTON_DANGER =
  "inline-flex items-center whitespace-nowrap rounded-lg border border-bad/30 bg-bad-fond px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-bad-fond/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40";

/** Demandes RGPD (administrateurs) : accès et effacement, par identité métier ou par identifiant de visiteur. */
export default async function AdminPrivacy({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/vie-privee.ts`, C10) : les applications du périmètre,
  // ce que couvrirait la demande, l'état réel de la protection. On INSTRUIT avant de
  // compter : sur une ancienne empreinte de terminal, ni volume ni bouton (lib/dsar.ts).
  const ecran = accesAdmin(await chargerEcran(ECRANS_ADMIN.viePrivee, chargerViePrivee, sp));
  const { apps, app, kind, identityHash, visitorId, visitorApp, toutes } = ecran;
  const { sante: identityHealth, protection: etatProtection, identite: identityCounts, cible: visitorTarget, visiteur: visitorCounts } = ecran;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const erased = typeof sp.erased === "string" ? sp.erased : null;
  const total = (counts: { rows: number }[]) => counts.reduce((n, c) => n + c.rows, 0);
  const identityTotal = identityCounts ? total(identityCounts) : 0;
  const identityExportHref = `/admin/privacy/export?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${identityHash}`;
  const visitorTotal = visitorCounts ? total(visitorCounts) : 0;
  const visitorExportHref = `/admin/privacy/export?app=${encodeURIComponent(visitorApp)}&user=${encodeURIComponent(visitorId)}`;
  const nomApp = (id: string) => apps.find((a) => a.app_id === id)?.name ?? id;
  const effacees = erased != null && /^\d+$/.test(erased) ? Number(erased) : null;
  const barriere = BARRIERE[etatProtection];
  const identiteIndisponible = identityHealth.label === "degraded";

  return (
    <div className="animate-fade-up">
      <PageHeader title="Vie privée · demandes RGPD">
        {/* La protection après effacement, pour l'application choisie : une pastille ; ce
            qu'elle couvre et ne couvre pas, dans la bulle. Affiché DANS l'écran, pas relégué
            à une documentation : un opérateur qui croit la garantie plus large qu'elle ne
            l'est répondra à côté d'une demande. */}
        <span
          className="inline-flex min-w-0 items-center gap-1.5"
          data-testid="dsar-portee"
          data-barriere={etatProtection}
          aria-label={`Après un effacement — ${nomApp(app)}`}
          role="group"
        >
          <span data-testid="dsar-barriere" title={phraseBarriere(etatProtection, nomApp(app))}>
            <Pastille ton={barriere.ton}>{barriere.texte}</Pastille>
            <span className="sr-only">{phraseBarriere(etatProtection, nomApp(app))}</span>
          </span>
          <InfoTip label="Après un effacement" align="end">
            <span className="block font-medium">{phraseBarriere(etatProtection, nomApp(app))}</span>
            <span className="mt-1.5 block">{DSAR_BARRIERE_MESSAGES[etatProtection]}</span>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {DSAR_LIMITES.map((limite) => (
                <li key={limite}>{limite}</li>
              ))}
            </ul>
          </InfoTip>
        </span>
        <Link href="/admin/audit?type=vie-privee" className="btn-ghost" title="Chaque recherche, export et effacement est inscrit au journal d'audit, refus compris.">
          Historique des demandes →
        </Link>
      </PageHeader>

      {error && <Erreur>{error}</Erreur>}
      {effacees != null && (
        <div role="status" className="mb-3 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-sm text-good-ink">
          <span aria-hidden>✓</span>
          <span>
            Effacement effectué : <strong>{pluriel(effacees, "ligne supprimée", "lignes supprimées")}</strong>.
          </span>
        </div>
      )}

      {/* Recherche guidée : l'identité métier d'abord, l'identifiant de visiteur quand
          l'application n'en transmet pas (recette du 26/09/2026 : deux recherches,
          sans dire laquelle employer). Côte à côte, chacune sa bulle. */}
      <div className="mb-4 grid min-w-0 items-stretch gap-2 lg:grid-cols-2">
        <Panneau
          titre="1 · Par identité métier"
          aide={
            <>
              L&apos;identifiant que votre application transmet pour cette personne (numéro de client, identifiant de
              compte…). Il est pseudonymisé à la volée et n&apos;est jamais conservé en clair.
            </>
          }
          actions={
            identiteIndisponible ? (
              <span className="inline-flex items-center gap-1" data-testid="dsar-identite-indisponible">
                <Pastille ton="attention">indisponible</Pastille>
                <InfoTip label="Pourquoi la recherche par identité est indisponible" align="end">
                  {!identityHealth.configured && <>La clé de pseudonymisation n&apos;est pas configurée sur la plateforme. </>}
                  {!identityHealth.schema && <>La base n&apos;est pas encore à jour pour l&apos;identité métier. </>}
                  La recherche par identifiant de visiteur reste possible.
                </InfoTip>
              </span>
            ) : (
              <Pastille ton="neutre">recommandé</Pastille>
            )
          }
          className="h-full"
        >
          <form action={searchIdentityAction} className="flex min-w-0 flex-wrap items-end gap-2 px-3 py-2.5" data-testid="dsar-search-form">
            {/* `min-w-0 max-w-full` : un champ ou une liste à largeur fixe ne pousse plus
                la page au-delà de 390 px (417 px avant). */}
            <label className={LIBELLE_CHAMP}>
              Application
              <select name="app" defaultValue={app} className="field block w-full max-w-full py-1 text-xs sm:max-w-[14rem]">
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LIBELLE_CHAMP}>
              Type
              <select name="kind" defaultValue={kind} className="field block max-w-full py-1 text-xs">
                <option value="user">utilisateur</option>
                <option value="account">compte</option>
              </select>
            </label>
            <label className={`${LIBELLE_CHAMP} grow`}>
              Identifiant de la personne
              <input
                name="identity"
                type="text"
                required
                placeholder="tel que votre application le transmet"
                className="field block w-full max-w-full py-1 font-mono text-xs"
              />
            </label>
            <button type="submit" className="btn-accent py-1.5 text-xs">
              Chercher
            </button>
          </form>
        </Panneau>

        <Panneau
          titre="2 · Par identifiant de visiteur"
          aide={
            <>
              À employer quand votre application ne transmet pas d&apos;identité métier : l&apos;identifiant de visiteur est
              posé par le code de suivi dans le navigateur de la personne.
            </>
          }
          className="h-full"
        >
          <form method="GET" className="flex min-w-0 flex-wrap items-end gap-2 px-3 py-2.5" data-testid="dsar-visitor-search-form">
            <label className={LIBELLE_CHAMP}>
              Application
              <select name="visitor_app" defaultValue={visitorApp} className="field block w-full max-w-full py-1 text-xs sm:max-w-[14rem]">
                {toutes && <option value="all">Toutes les applications</option>}
                {apps.map((candidate) => (
                  <option key={candidate.app_id} value={candidate.app_id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${LIBELLE_CHAMP} grow`}>
              Identifiant de visiteur
              <input
                name="user"
                type="text"
                defaultValue={visitorId}
                required
                placeholder="identifiant de visiteur"
                className="field block w-full max-w-full py-1 font-mono text-xs"
              />
            </label>
            <button type="submit" className="btn-accent py-1.5 text-xs">
              Chercher
            </button>
          </form>
        </Panneau>
      </div>

      {identityCounts && (
        <Resultat
          titre={
            <>
              Identité {TYPE_IDENTITE[kind]} ·{" "}
              <code className="font-mono normal-case tracking-normal text-brand">{identityHash.slice(0, 12)}…</code> · {nomApp(app)}
            </>
          }
          lignes={identityCounts}
          total={identityTotal}
          libelleTable="Données de cette identité"
          vide="Aucune donnée pour cette identité dans cette application."
          gestes={
            <>
              <Link href={identityExportHref} prefetch={false} className="btn-accent py-1.5 text-xs" data-testid="dsar-export" title="Export JSON complet des données liées à cette identité, regroupées par type de donnée.">
                Exporter en JSON
              </Link>
              <form action={eraseIdentityAction} className="flex min-w-0 flex-wrap items-center gap-2" data-testid="dsar-erase-form">
                <input type="hidden" name="app" value={app} />
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="identity_hash" value={identityHash} />
                <input
                  name="confirm_identity"
                  type="text"
                  required
                  aria-label="Confirmer : identifiant de la personne, de nouveau"
                  placeholder="identifiant de la personne, de nouveau"
                  className="field w-64 max-w-full py-1 font-mono text-xs"
                  autoComplete="off"
                />
                <button type="submit" className={BOUTON_DANGER}>
                  Effacer définitivement
                </button>
                <InfoTip label="Effacement" align="end">
                  Supprime <strong>définitivement</strong> toutes les données du tableau, en une seule opération.
                  Irréversible : saisissez de nouveau l&apos;identifiant de la personne pour confirmer.
                </InfoTip>
              </form>
            </>
          }
        />
      )}

      {visitorTarget?.verdict === "refus_empreinte" && (
        <div className="card mb-4" data-testid="dsar-refus">
          <LigneVide
            role="note"
            aide={DSAR_MESSAGES.refus_empreinte}
          >
            <span className="font-semibold text-warn-ink">Demande non exécutable sur cet identifiant</span>
            {" · "}
            {pluriel(visitorTarget.sessionsHeritees, "session")} {accord(visitorTarget.sessionsHeritees, "porte", "portent")} cette ancienne
            empreinte
          </LigneVide>
          <p className="sr-only">{DSAR_MESSAGES.refus_empreinte}</p>
        </div>
      )}
      {visitorTarget?.verdict === "inconnu" && (
        <div className="card mb-4" data-testid="dsar-inconnu">
          <LigneVide>{DSAR_MESSAGES.inconnu}</LigneVide>
        </div>
      )}
      {visitorCounts && (
        <Resultat
          titre={
            <>
              Visiteur <code className="break-all font-mono normal-case tracking-normal text-brand">{visitorId}</code> ·{" "}
              {visitorApp === "all" ? "toutes les applications" : nomApp(visitorApp)}
            </>
          }
          lignes={visitorCounts}
          total={visitorTotal}
          libelleTable="Données de ce visiteur"
          vide={DSAR_MESSAGES.inconnu}
          gestes={
            <>
              <Link href={visitorExportHref} prefetch={false} className="btn-accent py-1.5 text-xs" data-testid="dsar-visitor-export">
                Exporter en JSON
              </Link>
              <form action={eraseUserAction} className="flex min-w-0 flex-wrap items-center gap-2" data-testid="dsar-visitor-erase-form">
                <input type="hidden" name="app" value={visitorApp} />
                <input type="hidden" name="user" value={visitorId} />
                <input
                  name="confirm"
                  type="text"
                  required
                  aria-label="Confirmer : identifiant de visiteur, de nouveau"
                  placeholder="identifiant de visiteur, de nouveau"
                  className="field w-64 max-w-full py-1 font-mono text-xs"
                  autoComplete="off"
                />
                <button type="submit" className={BOUTON_DANGER}>
                  Effacer définitivement
                </button>
                <InfoTip label="Effacement" align="end">
                  Irréversible : saisissez de nouveau l&apos;identifiant de visiteur pour confirmer.
                </InfoTip>
              </form>
            </>
          }
        />
      )}
    </div>
  );
}

/**
 * Le résultat d'une recherche : ce qu'un export rendrait, ce qu'un effacement
 * supprimerait, par type de donnée — puis les deux gestes, dans la barre du panneau,
 * seulement s'il y a quelque chose à rendre ou à effacer.
 */
function Resultat({
  titre,
  lignes,
  total,
  libelleTable,
  vide,
  gestes,
}: {
  titre: ReactNode;
  lignes: { table: string; rows: number }[];
  total: number;
  libelleTable: string;
  vide: string;
  gestes: ReactNode;
}) {
  const max = Math.max(1, ...lignes.map((l) => l.rows));
  return (
    <Panneau
      titre={titre}
      compte={`${total.toLocaleString("fr-FR")} ${total > 1 ? "lignes" : "ligne"}`}
      className="mb-4"
      barre={total > 0 ? <div className="flex min-w-0 flex-wrap items-center gap-2">{gestes}</div> : undefined}
    >
      {total === 0 ? (
        <LigneVide>{vide}</LigneVide>
      ) : (
        <TableDefilante label={libelleTable} className={ARRONDI_BAS}>
          <table className="w-full text-sm">
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className={TH}>Données</th>
                <th scope="col" className={TH_NUM}>Lignes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {lignes.map((c) => (
                <tr key={c.table} className={LIGNE}>
                  <td className={`${TD} text-ink`}>{libelleTableDsar(c.table)}</td>
                  <td className={TD_NUM}>
                    <span className="inline-flex items-center justify-end gap-2">
                      <span className="tabular-nums text-ink-soft">{c.rows.toLocaleString("fr-FR")}</span>
                      <Barre part={c.rows / max} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
      )}
    </Panneau>
  );
}
