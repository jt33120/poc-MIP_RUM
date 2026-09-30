"use client";
// La check-list d'un parcours de `/installer` : les prérequis propres à
// l'application, puis chaque geste d'installation, puis le test « ça arrive ».
//
// AUCUNE SAUVEGARDE, VOLONTAIREMENT. Les cases se cochent au clic et ne vivent que
// dans l'état React de la page : ni stockage du navigateur, ni cookie, ni serveur.
// Recharger remet tout à zéro — c'est une aide pour dérouler l'installation (et la
// montrer en démonstration), pas un suivi : l'état réel, c'est la sonde qui le dit.
//
// Les cases du test « ça arrive » ne se cochent JAMAIS au clic : elles suivent la
// sonde, relue en direct (`ParcoursInstallation`). Elles restent des cases à cocher
// (désactivées) pour que le décompte se lise d'un seul geste : « 7 / 9 ».
//
// `VueChecklist` est le rendu pur (les cases cochées lui sont données) : c'est lui
// que teste `tests/unit/ChecklistParcours.test.tsx`, sans navigateur.
import { useState, type ReactNode } from "react";
import { WizardBadge } from "@/components/wizard/WizardStep";
import { basculerCoche, compteChecklist } from "@/lib/installer";

export type GroupeEtape = "prerequis" | "installation" | "verification";

export interface EtapeChecklist {
  id: string;
  groupe: GroupeEtape;
  titre: string;
  facultatif?: boolean;
  /** Case du test « ça arrive » : pilotée par la sonde, jamais par le clic. */
  sonde?: { ok: boolean; detail: string; aide?: string };
  corps?: ReactNode;
}

const GROUPES: readonly { cle: GroupeEtape; titre: string }[] = [
  { cle: "prerequis", titre: "Prérequis propres à votre application" },
  { cle: "installation", titre: "Installation" },
  { cle: "verification", titre: "Vérification en direct" },
];

export function ChecklistParcours({
  parcours,
  titre,
  etapes,
  entete,
  avantVerification,
}: {
  parcours: string;
  titre: string;
  etapes: EtapeChecklist[];
  entete?: ReactNode;
  /** En tête du groupe « Vérification en direct » : l'état du sondage. */
  avantVerification?: ReactNode;
}) {
  const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <VueChecklist
      parcours={parcours}
      titre={titre}
      etapes={etapes}
      coches={coches}
      onBasculer={(id) => setCoches((c) => basculerCoche(c, id))}
      entete={entete}
      avantVerification={avantVerification}
    />
  );
}

export function VueChecklist({
  parcours,
  titre,
  etapes,
  coches,
  onBasculer,
  entete,
  avantVerification,
}: {
  parcours: string;
  titre: string;
  etapes: EtapeChecklist[];
  coches: ReadonlySet<string>;
  onBasculer: (id: string) => void;
  entete?: ReactNode;
  avantVerification?: ReactNode;
}) {
  const { faits, total, complet } = compteChecklist(etapes, coches);
  // Une numérotation continue d'un groupe à l'autre : « étape 5 » désigne une case.
  const numero = new Map(etapes.map((e, i) => [e.id, i + 1]));
  return (
    <section
      className={`card min-w-0 p-4 transition sm:p-5 ${complet ? "border-good/50 ring-1 ring-good/30" : ""}`}
      data-testid={`checklist-${parcours}`}
      data-complet={complet ? "oui" : "non"}
      aria-label={titre}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-base font-semibold text-ink">{titre}</h2>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
            complet ? "bg-good/15 text-good-ink" : "bg-panel2 text-ink-soft"
          }`}
          data-testid={`compteur-${parcours}`}
          aria-live="polite"
        >
          <span className="sr-only">Étapes faites : </span>
          {faits} / {total}
        </span>
        {complet && (
          <span className="rounded-full bg-good/15 px-2.5 py-0.5 text-xs font-semibold text-good-ink" data-testid={`complet-${parcours}`}>
            Tout est fait
          </span>
        )}
      </div>
      {entete}
      <div className="grid gap-4">
        {GROUPES.map(({ cle, titre: titreGroupe }) => {
          const duGroupe = etapes.filter((e) => e.groupe === cle);
          if (!duGroupe.length) return null;
          return (
            <div key={cle} className="min-w-0">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{titreGroupe}</h3>
              {cle === "verification" && avantVerification && <div className="mb-2">{avantVerification}</div>}
              <ol className="grid gap-2" start={numero.get(duGroupe[0].id)}>
                {duGroupe.map((e) => {
                  const idCase = `case-${parcours}-${e.id}`;
                  const coche = e.sonde ? e.sonde.ok : coches.has(e.id);
                  return (
                    <li
                      key={e.id}
                      className="min-w-0 rounded-lg border border-line bg-panel2/40 px-3 py-2.5"
                      data-testid={`etape-${parcours}-${e.id}`}
                      data-etat={coche ? "fait" : "a-faire"}
                    >
                      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5">
                        <input
                          id={idCase}
                          type="checkbox"
                          checked={coche}
                          // Une case de la sonde n'a pas de geste : désactivée, elle dit
                          // « vérifié par MIP », et le clic ne la change pas.
                          disabled={!!e.sonde}
                          readOnly={!!e.sonde}
                          onChange={e.sonde ? undefined : () => onBasculer(e.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-good disabled:cursor-default"
                        />
                        <label htmlFor={idCase} className={`min-w-0 flex-1 text-sm ${e.sonde ? "text-ink" : "cursor-pointer text-ink"}`}>
                          <span className="font-semibold tabular-nums text-ink-soft">{numero.get(e.id)}.</span> {e.titre}
                          {e.facultatif && <span className="text-ink-soft"> (facultatif)</span>}
                          {e.sonde && <span className="sr-only"> — vérifié automatiquement</span>}
                        </label>
                        {e.sonde && (
                          <WizardBadge state={e.sonde.ok ? "done" : "waiting"}>
                            <span className="[overflow-wrap:anywhere]">{e.sonde.detail}</span>
                          </WizardBadge>
                        )}
                      </div>
                      {e.sonde?.aide && !e.sonde.ok && <p className="mt-1.5 pl-7 text-xs text-ink-soft">{e.sonde.aide}</p>}
                      {e.corps && <div className="mt-2 min-w-0 pl-0 text-xs leading-relaxed text-ink-soft sm:pl-7">{e.corps}</div>}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
