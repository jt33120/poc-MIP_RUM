import { ECRANS_ADMIN } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { KpiTile } from "@/components/charts/KpiTile";
import { chargerConsommation } from "@/lib/chargeurs/administration";
import { accesAdmin, chargerEcran } from "@/lib/ecran";
import { fmtInstant, fmtJour } from "@/lib/format";
import type { EtatComptage, TenantUsageRow } from "@/lib/queries-usage";
import { quotaView } from "@/lib/usage";
import { Barre, LIGNE, LigneVide, NombreBarre, Panneau, Pastille, PUCE_ID, RangeeCases, TD, TD_NUM, TH, TH_NUM } from "../_ui/kit";

/** Un compteur du mois : « — » sans comptage, jamais un zéro inventé. */
function compteur(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("fr-FR");
}

/**
 * Jusqu'où le mois est mesuré. Le comptage tourne chaque nuit sur la VEILLE : le
 * jour en cours n'y est jamais, et le dire évite de lire « rien consommé ».
 */
function phraseComptage(c: EtatComptage): string {
  if (c.dernierJour === null) {
    return "Aucun comptage ce mois-ci : la consommation est comptée chaque nuit pour la veille. Les données d'aujourd'hui apparaîtront demain.";
  }
  const dernier = c.dernierComptage ? ` (dernier comptage le ${fmtInstant(c.dernierComptage)})` : "";
  return `Mesuré jusqu'au ${fmtJour(c.dernierJour)} inclus${dernier}. Le jour en cours sera compté demain.`;
}

/**
 * La somme d'un compteur sur les applications : connue seulement si CHAQUE application
 * a été comptée — une somme partielle se lirait comme le total du mois.
 */
function somme(rows: TenantUsageRow[], cle: "events" | "sessions" | "errors"): number | null {
  if (!rows.length || rows.some((r) => r[cle] === null)) return null;
  return rows.reduce((s, r) => s + (r[cle] ?? 0), 0);
}

export const dynamic = "force-dynamic";

const SOURCE = "Comptage quotidien de la consommation (la veille, chaque nuit), conservé au-delà de la durée de conservation des mesures";

/**
 * Consommation par application (mois courant) et quotas, pour les administrateurs (P0 #5).
 *
 * Refonte du 01/10/2026 : les totaux du mois en cases, jusqu'où le mois est compté en
 * pastille (la phrase dans sa bulle), un tableau à barres (volume, quota).
 */
export default async function Usage() {
  // Le chargeur : la consommation des applications de son périmètre (C9).
  const { lignes: rows, comptage } = accesAdmin(await chargerEcran(ECRANS_ADMIN.consommation, chargerConsommation, {}));
  const month = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const raisonTotal = comptage.dernierJour === null ? "aucun comptage ce mois-ci" : "une application au moins n'a pas encore été comptée ce mois-ci";
  const maxEvents = Math.max(1, ...rows.map((r) => r.events ?? 0));
  const depasses = rows.filter((r) => r.events !== null && quotaView(r.events, r.quota).over).length;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Consommation et quotas">
        {/* Jusqu'où le mois est compté, en pastille : la phrase entière au survol et
            pour le lecteur d'écran (elle dit pourquoi aujourd'hui n'y est pas). */}
        <span aria-hidden className="inline-flex items-center gap-1.5 rounded-full bg-panel2 px-2.5 py-0.5 text-[11px] text-ink-soft" title={phraseComptage(comptage)}>
          <span className="text-ink-faint">◷</span>
          <span className="font-medium text-ink">{comptage.dernierJour === null ? "Aucun comptage ce mois-ci" : `Compté jusqu'au ${fmtJour(comptage.dernierJour)}`}</span>
        </span>
        <span className="sr-only" data-testid="usage-comptage">
          {phraseComptage(comptage)}
        </span>
      </PageHeader>

      <RangeeCases testId="usage-cases">
        <KpiTile label={`Événements en ${month}`} libelleCase="Événements du mois" valeur={somme(rows, "events")} format="count" raisonNull={raisonTotal} source={SOURCE} methode={phraseComptage(comptage)} />
        <KpiTile label={`Sessions en ${month}`} libelleCase="Sessions du mois" valeur={somme(rows, "sessions")} format="count" raisonNull={raisonTotal} source={SOURCE} methode={phraseComptage(comptage)} />
        <KpiTile label={`Erreurs en ${month}`} libelleCase="Erreurs du mois" valeur={somme(rows, "errors")} format="count" raisonNull={raisonTotal} source={SOURCE} methode={phraseComptage(comptage)} />
        <KpiTile
          label="Applications au-delà de leur quota"
          libelleCase="Quota dépassé"
          valeur={depasses}
          format="count"
          alerte={{ si: ">", valeur: 0, regle: "une application au moins dépasse son quota mensuel" }}
          source={SOURCE}
          methode="Applications dont les événements du mois dépassent le quota mensuel ; le quota se règle par application."
        />
      </RangeeCases>

      <Panneau
        titre="Par application"
        compte={rows.length}
        aide={
          <>
            Ce que chaque application a envoyé en {month}, rapporté à son quota mensuel. Consommation comptée une fois par jour
            pour la veille, et conservée au-delà de la durée de conservation des données de mesure. Le quota mensuel se règle par
            application.
          </>
        }
      >
        {/* Défilant et signalé : `overflow-hidden` rendait « Erreurs » et « Quota
            mensuel » invisibles et inatteignables à 390 px (recette 26/09). */}
        <TableDefilante label="Consommation par application">
          {rows.length ? (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className={TH}>Application</th>
                  <th className={TH_NUM}>Événements</th>
                  <th className={TH_NUM}>Sessions</th>
                  <th className={TH_NUM}>Erreurs</th>
                  <th className={TH}>Quota mensuel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((r) => {
                  const qv = r.events === null ? null : quotaView(r.events, r.quota);
                  return (
                    <tr key={r.app_id} className={LIGNE}>
                      <td className={TD}>
                        <span className="font-medium text-ink">{r.name}</span>
                        <code className={`${PUCE_ID} ml-2`}>{r.app_id}</code>
                      </td>
                      <td className={TD_NUM} data-testid="usage-events">
                        {r.events === null ? compteur(r.events) : <NombreBarre texte={compteur(r.events)} part={r.events / maxEvents} />}
                      </td>
                      {/* Trois volumes, une seule couleur : rien ne distinguait les événements
                          (noirs) des sessions et des erreurs (grises), recette du 26/09/2026. */}
                      <td className={TD_NUM}>{compteur(r.sessions)}</td>
                      <td className={TD_NUM}>{compteur(r.errors)}</td>
                      <td className={TD}>
                        {r.quota == null ? (
                          <Pastille ton="neutre">Illimité</Pastille>
                        ) : qv === null ? (
                          <span className="text-xs text-ink-faint" title="consommation pas encore comptée">
                            {r.quota.toLocaleString("fr-FR")} · pas encore compté
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            {/* Une consommation est un volume : barre neutre ; seul le dépassement,
                                un état, prend la couleur du problème. */}
                            <Barre part={Math.min(100, qv.pct ?? 0) / 100} ton={qv.over ? "mauvais" : "neutre"} largeur="w-24" />
                            <span className={`whitespace-nowrap text-xs tabular-nums ${qv.over ? "font-semibold text-bad-ink" : "text-ink-soft"}`}>
                              {qv.label} de {r.quota.toLocaleString("fr-FR")}
                              {qv.over && " · dépassé"}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <LigneVide>Aucune application à afficher.</LigneVide>
          )}
        </TableDefilante>
      </Panneau>
    </div>
  );
}
