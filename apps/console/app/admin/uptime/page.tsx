import { motifDeRefus } from "@mip/backend/lib/net/safe-fetch.mjs";
import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { KpiTile } from "@/components/charts/KpiTile";
import { entreGuillemets } from "@/lib/format";
import { TableDefilante } from "@/components/TableDefilante";
import { chargerSondes } from "@/lib/chargeurs/sondes";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { fmtLatency, fmtNombre, pluriel } from "@/lib/format";
import { CADENCE_TICK_MIN } from "@/lib/etat-latence";
import { Fenetre } from "../_ui/Fenetre";
import { ARRONDI_BAS, Barre, BOUTON_LIGNE, BOUTON_LIGNE_DANGER, Erreur, LIBELLE_CHAMP, LIGNE, LigneVide, Moment, Panneau, Pastille, RangeeCases, TD, TD_NUM, TH, TH_NUM, type TonPastille } from "../_ui/kit";
import { createUptimeCheckAction, deleteUptimeCheckAction, toggleUptimeCheckAction } from "./actions";

export const dynamic = "force-dynamic";

type Etat = "up" | "down" | "pending" | "off";

const ETAT: Record<Etat, { label: string; ton: TonPastille }> = {
  up: { label: "Disponible", ton: "bon" },
  down: { label: "Indisponible", ton: "mauvais" },
  pending: { label: "En attente", ton: "neutre" },
  off: { label: "Désactivée", ton: "eteint" },
};

/**
 * Sondes de disponibilité (monitoring synthétique) : des vérifications HTTP actives, pour les administrateurs.
 *
 * Refonte du 01/10/2026 : les chiffres en cases, une ligne par sonde (état, adresse,
 * disponibilité 24 h en barre, temps de réponse, dernière vérification) ; l'ajout en
 * fenêtre, la règle de sondage dans la bulle, l'état vide sur une ligne.
 */
export default async function UptimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le chargeur (`lib/chargeurs/sondes.ts`) : un administrateur, et les sondes de son périmètre.
  const { apps, checks, cadence } = accesAdmin(await chargerEcran(ECRANS_ADMIN.sondes, chargerSondes, sp));
  const error = typeof sp.error === "string";
  // Refus d'URL à l'écriture (P1) : un CODE dans l'URL, un texte relu côté
  // serveur — jamais le texte d'un paramètre affiché tel quel.
  const urlRefusee = typeof sp.url_refusee === "string" ? (motifDeRefus(sp.url_refusee) ?? "URL refusée.") : null;
  const maintenant = Date.now();
  const minutes = cadence ?? CADENCE_TICK_MIN;

  const etatDe = (c: (typeof checks)[number]): Etat => (!c.enabled ? "off" : c.last_ok == null ? "pending" : c.last_ok ? "up" : "down");
  const actives = checks.filter((c) => c.enabled);
  const enPanne = actives.filter((c) => etatDe(c) === "down").length;
  // La disponibilité d'ensemble : vérifications réussies sur vérifications faites, 24 h.
  // Pendant une panne de collecte, elle est inconnue — jamais « 100 % » (voir la ligne).
  const inconnue = actives.find((c) => c.uptime_inconnu)?.uptime_inconnu ?? null;
  const faites = actives.reduce((s, c) => s + c.checks_24h, 0);
  const reussies = actives.reduce((s, c) => s + c.up_24h, 0);
  const dispo = inconnue || faites === 0 ? null : reussies / faites;
  const regle = `Chaque sonde interroge son adresse toutes les ${minutes} min. Un échec est confirmé par un second essai ; le passage de disponible à indisponible déclenche une alerte critique.`;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Sondes de disponibilité">
        <Fenetre libelle="Ajouter une sonde" titre="Ajouter une sonde de disponibilité" testId="ouvrir-ajout-sonde" fermerALEnvoi large>
          <form action={createUptimeCheckAction} className="grid gap-3 sm:grid-cols-2">
            <label className={LIBELLE_CHAMP}>
              Nom
              <input name="name" required placeholder="Accueil en production" className="field block w-full max-w-full" />
            </label>
            {/* Champs bornés au cadre (`min-w-0 max-w-full`) : la liste des applications
                prend la largeur de son plus long libellé et portait la page à 417 px sur 390. */}
            <label className={LIBELLE_CHAMP}>
              Application
              <select name="app" required defaultValue="" className="field block w-full max-w-full">
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
            <label className={LIBELLE_CHAMP}>
              Adresse à sonder
              <input name="url" required placeholder="https://votre-site.fr/health" className="field block w-full max-w-full font-mono text-xs" />
            </label>
            <label className={LIBELLE_CHAMP}>
              <span>
                Code HTTP attendu <span className="font-normal text-ink-faint">— quand tout va bien, 200 le plus souvent</span>
              </span>
              <input name="expect_status" type="number" defaultValue={200} className="field block w-24 tabular-nums" />
            </label>
            <p className="text-[11px] text-ink-faint sm:col-span-2">
              Adresses publiques seulement : adresses IP, réseaux privés et noms internes sont refusés.
            </p>
            <div className="flex justify-end sm:col-span-2">
              <button type="submit" className="btn-accent">
                Ajouter
              </button>
            </div>
          </form>
        </Fenetre>
      </PageHeader>

      {error && <Erreur>Nom, adresse (http ou https) et application requis.</Erreur>}
      {urlRefusee && (
        <div role="alert" data-testid="url-refusee" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad-ink">
          Adresse refusée&nbsp;: {urlRefusee}
        </div>
      )}

      {checks.length > 0 && (
        <RangeeCases testId="sondes-cases">
          <KpiTile label="Sondes actives" valeur={actives.length} format="count" source="Sondes de disponibilité de votre périmètre" methode={regle} />
          <KpiTile
            label="Sondes indisponibles"
            libelleCase="Indisponibles"
            valeur={enPanne}
            format="count"
            alerte={{ si: ">", valeur: 0, regle: "au moins une adresse ne répond plus : une alerte critique est partie" }}
            source="Dernière vérification de chaque sonde active"
            methode="Sondes actives dont la dernière vérification, confirmée par un second essai, a échoué."
          />
          <KpiTile
            label="Disponibilité sur 24 h, toutes sondes"
            libelleCase="Disponibilité 24 h"
            valeur={dispo}
            format="pct"
            raisonNull={inconnue ?? "aucune vérification sur 24 h"}
            source="Vérifications des sondes actives, 24 dernières heures"
            methode="Vérifications réussies sur vérifications faites, toutes sondes actives confondues."
          />
          <KpiTile
            label="Vérifications sur 24 h"
            libelleCase="Vérifications 24 h"
            valeur={faites}
            format="count"
            source="Vérifications des sondes actives, 24 dernières heures"
            methode={`Une vérification toutes les ${minutes} min par sonde active.`}
          />
        </RangeeCases>
      )}

      <Panneau titre="Sondes" compte={checks.length} aide={<>{regle} Seules les adresses publiques sont sondées : adresses IP, réseaux privés et noms internes sont refusés.</>}>
        {!checks.length ? (
          // Sans sonde, l'état vide est une ligne, HORS du tableau : dans une cellule, il
          // prenait la largeur du tableau (548 px) et se coupait à 390 px (contre-recette du 26/09/2026).
          <LigneVide
            testId="uptime-vide"
            aide={
              <>
                Par exemple l&apos;adresse de santé de votre site (<span className="break-all font-mono">https://votre-site.fr/health</span>,
                code 200 attendu) : vous suivrez sa disponibilité sur 24&nbsp;h et son temps de réponse, et une alerte critique partira dès
                qu&apos;elle cessera de répondre.
              </>
            }
          >
            Aucune sonde : « Ajouter une sonde » surveille une adresse, même sans visiteur.
          </LigneVide>
        ) : (
          // Défilant et signalé : `overflow-hidden` coupait « Dernière sonde » et les
          // actions à 390 px (recette 26/09).
          <TableDefilante label="Sondes" className={ARRONDI_BAS}>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>État</th>
                  <th className={TH}>Sonde</th>
                  <th className={TH_NUM}>Disponibilité 24&nbsp;h</th>
                  <th className={TH_NUM}>Temps de réponse</th>
                  <th className={TH}>Vérifiée</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {checks.map((c) => {
                  const state = etatDe(c);
                  const pct = c.uptime_pct_24h;
                  return (
                    <tr key={c.id} className={LIGNE}>
                      <td className={TD}>
                        <Pastille ton={ETAT[state].ton}>{ETAT[state].label}</Pastille>
                      </td>
                      <td className={`${TD} min-w-[14rem]`}>
                        <span className="font-medium text-ink">{c.name}</span>
                        <span className="ml-2 break-all font-mono text-[11px] text-ink-faint">{c.url}</span>
                        {state === "down" && c.last_error && <span className="block text-xs text-bad-ink">{c.last_error}</span>}
                      </td>
                      <td className={TD_NUM}>
                        {c.uptime_inconnu ? (
                          // Pendant une panne de collecte, « 100 % » serait faux : aucune vérification n'a eu lieu.
                          <span className="text-ink-soft" title={c.uptime_inconnu} data-uptime-inconnu="">
                            inconnu
                          </span>
                        ) : pct == null ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <span className="inline-flex items-center justify-end gap-2" title={`sur ${pluriel(c.checks_24h, "vérification")}`}>
                            <span className={pct >= 99 ? "text-good-ink" : pct >= 95 ? "text-warn-ink" : "text-bad-ink"}>{fmtNombre(pct, 1)}&nbsp;%</span>
                            <Barre part={pct / 100} ton={pct >= 99 ? "bon" : pct >= 95 ? "attention" : "mauvais"} />
                          </span>
                        )}
                        <span className="sr-only"> sur {pluriel(c.checks_24h, "vérification")}</span>
                      </td>
                      <td className={`${TD_NUM} text-ink-soft`}>{fmtLatency(c.last_latency_ms)}</td>
                      <td className={`${TD} text-xs text-ink-soft`}>
                        <Moment date={c.last_checked_at} maintenant={maintenant} vide="en attente" />
                      </td>
                      <td className={TD}>
                        {/* `items-start` : la confirmation dépliée sous « Supprimer » n'étire pas « Désactiver ». */}
                        <div className="flex items-start gap-1">
                          <form action={toggleUptimeCheckAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="app" value={c.app_id} />
                            <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                            <button type="submit" className={`${BOUTON_LIGNE} ${c.enabled ? "" : "text-good-ink"}`}>
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
                              question={`Supprimer la sonde ${entreGuillemets(c.name)} ?`}
                              consequence="Ses vérifications passées seront effacées avec elle et elle ne déclenchera plus d’alerte."
                              confirmer="Supprimer la sonde"
                              enCours="Suppression…"
                              classeDeclencheur={BOUTON_LIGNE_DANGER}
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
      </Panneau>
    </div>
  );
}
