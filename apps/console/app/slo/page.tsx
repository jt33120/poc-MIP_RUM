// SLO — /slo (F63, plan § 5.18).
//
// LA QUESTION. « Quels objectifs de service consomment leur budget, et lesquels le
// brûlent en ce moment ? » Des BARRES de budget alignées sur une échelle commune
// (0-150 %), plus des jauges : dix jauges ne se comparent pas, et une jauge 0-100 ne
// sait pas dire un dépassement (le consommé va jusqu'à 999 %).
//
// CE QUE L'ÉCRAN N'AFFIRME PAS.
//   - Un SLO sans aucune mesure n'est ni tenu ni manqué : il est compté « non
//     mesurable », et nulle part comme « 0 % consommé » (V3).
//   - Aucune couleur sous 100 % : « épuisé » (≥ 100 %) est la seule définition ; les
//     repères 50 / 75 % sont gris (R-S).
//   - Aucun historique : `slo_status()` est un instantané ; la figure « dans le
//     temps » le dit (« Non collecté », B6) au lieu de dessiner une série.
//   - Aucun bouton d'écriture pour un viewer ou une session de démonstration (V9).
//
// CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8) : `lire()` ne lève pas. PAS de
// `<Suspense>` ni de `loading.tsx` au-dessus de l'écran.
import { ECRANS } from "@mip/console-contract";
import { BudgetBars, alternativeBudget } from "@/components/charts/BudgetBars";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { FilterProblemNotice, FiltersNotAppliedNote } from "@/components/FilterProblemNotice";
import { Field, INPUT_CLASS } from "@/components/forms/Field";
import { PageHeader } from "@/components/PageHeader";
import { SloRow } from "@/components/slo/SloStatusRow";
import { CadreEtat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { TousEteints } from "@/components/TousEteints";
import { chargerSlo, JOURS_ALERTES_SLO as JOURS_ALERTES } from "@/lib/chargeurs/slo";
import { avecBlocs, chargerEcran } from "@/lib/ecran";
import type { SearchParams } from "@/lib/filters";
import { SLO_METRICS } from "@/lib/queries-v2";
import { alertesParSlo, comptesSlo, FACTEUR_BURN_RAPIDE, FORMULE_SLO, lignesBudget, metriqueEnClair } from "@/lib/slo-ecran";
import { createSloAction } from "../alerts/actions";

export const dynamic = "force-dynamic";

const TITRE = "SLO et budget d'erreur";

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft";

export default async function Slo({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/slo.ts`) reçoit la composition de l'écran (blocs
  // `budget`, `liste`, `creation`, du cookie) : un bloc éteint ne lance pas sa lecture.
  const ecran = await chargerEcran(ECRANS.slo, chargerSlo, await avecBlocs(sp, "/slo"));
  if (ecran.etat === "refus") return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  const f = { app: ecran.appFiltre };
  const { blocs, admin, statuts, slos, apps, declenchements, luA } = ecran;

  const lignes = statuts.ok ? lignesBudget(statuts.data) : [];
  const comptes = statuts.ok ? comptesSlo(statuts.data) : null;
  // slo_status() ne rend que les SLO actifs : on superpose l'état sur la liste
  // complète (actifs + désactivés), pour pouvoir réactiver.
  const statutParId = new Map((statuts.ok ? statuts.data : []).map((s) => [s.slo_id, s]));
  const alertes = declenchements.ok && declenchements.data ? alertesParSlo(declenchements.data.lignes) : null;
  const listeSlo = slos.ok ? slos.data : [];
  const kpi = (n: number | undefined) => (comptes ? (n ?? null) : null);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={TITRE}
        domain="fiabilite"
        sub="Quels objectifs de service consomment leur budget, et lesquels le brûlent en ce moment ?"
      />
      <FiltersNotAppliedNote note={ecran.notApplied} />

      {blocs.budget && (
        <>
          {/* ── Zone 2 : KPI (SL1, SL2, SL2b, SL2c). ── */}
          <SectionErreur titre="Chiffres clés des SLO">
            <div className="mb-6 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-slo">
              <KpiTile
                label="SLO actifs"
                valeur={kpi(comptes?.actifs)}
                format="count"
                raisonNull="lecture en échec"
                lecture="sans référence : configuration"
                href="#definitions"
              />
              <KpiTile
                label="Budget épuisé"
                valeur={kpi(comptes?.epuises)}
                format="count"
                raisonNull="lecture en échec"
                alerte={{ si: ">", valeur: 0, regle: "consommé ≥ 100 % du budget" }}
                lecture={
                  comptes && comptes.nonInterpretables > 0
                    ? `hors ${comptes.nonInterpretables} non interprétable${comptes.nonInterpretables > 1 ? "s" : ""} : plus d'occurrences d'erreurs que de pages vues`
                    : undefined
                }
                href="#budget"
              />
              <KpiTile
                label="Brûlent vite (dernière heure)"
                valeur={kpi(comptes?.brulent)}
                format="count"
                raisonNull="lecture en échec"
                alerte={{
                  si: ">",
                  valeur: 0,
                  regle: `consommation sur 1 h ≥ ${FACTEUR_BURN_RAPIDE.toLocaleString("fr-FR")} fois le budget`,
                }}
                lecture={`une seule fenêtre, donc sensible aux pics courts${
                  comptes && comptes.burnInconnu > 0
                    ? ` ; ${comptes.burnInconnu} sans mesure sur la dernière heure (inconnu)`
                    : ""
                }`}
                href="/alerts#pistes-slo"
              />
              <KpiTile
                label="Non mesurables"
                valeur={kpi(comptes?.nonMesurables)}
                format="count"
                raisonNull="lecture en échec"
                lecture="aucune mesure sur la fenêtre : ni tenu, ni manqué"
                href="#definitions"
              />
            </div>
          </SectionErreur>

          {/* ── Zone 3 : hero, budget consommé par SLO (SL3). ── */}
          <div className="mb-6">
            <SectionErreur titre="Budget d'erreur consommé, par SLO">
              <Figure
                titre="Budget d'erreur consommé, par SLO"
                id="budget"
                meta={
                  <span>
                    instantané calculé à {luA} UTC ; chaque SLO sur sa fenêtre glissante jusqu&apos;à maintenant
                  </span>
                }
                etat={!statuts.ok ? { kind: "erreur", titre: "Budget d'erreur consommé, par SLO" } : undefined}
                alternative={lignes.length > 0 ? alternativeBudget(lignes) : undefined}
                lecture={
                  <>
                    Consommé = (1 − atteinte) ÷ (1 − objectif). Une barre mène à ce qui consomme le budget (pages
                    du vital, ou erreurs de la route). Le badge « brûle vite » suit la seule dernière heure (facteur{" "}
                    {FACTEUR_BURN_RAPIDE.toLocaleString("fr-FR")}, origine non documentée).
                  </>
                }
              >
                {lignes.length > 0 ? (
                  <BudgetBars
                    lignes={lignes}
                    ariaLabel="Budget d'erreur consommé par SLO, échelle commune de 0 à 150 %"
                    alternative={false}
                  />
                ) : (
                  <CadreEtat ton="neutre" role="status" testId="etat-vide" etat="vide" className="text-center">
                    <p>Aucun SLO actif sur ce périmètre.</p>
                    {admin && blocs.creation ? (
                      <a href="#nouveau-slo" className="mt-2 inline-block font-medium text-brand hover:underline">
                        Créer un SLO
                      </a>
                    ) : (
                      <p className="mt-1 text-ink-soft">Demandez à un administrateur d&apos;en déclarer un.</p>
                    )}
                  </CadreEtat>
                )}
              </Figure>
            </SectionErreur>
          </div>

          {/* ── Zone 4 : consommation dans le temps (SL4) — B6 manque. ── */}
          <div className="mb-6">
            <Figure
              titre="Consommation du budget dans le temps"
              id="consommation-temps"
              etat={{ kind: "non_collecte", manque: "historique de consommation non conservé (instantané seulement)" }}
            />
          </div>
        </>
      )}

      {/* ── Zone 5 : définitions et état (SL5). ── */}
      {blocs.liste && (
        <div className="mb-6">
          <SectionErreur titre="Définitions et état">
            <Figure
              titre="Définitions et état"
              id="definitions"
              meta={
                <span>
                  alertes : déclenchements des {JOURS_ALERTES} derniers jours calendaires UTC, jour en cours compris
                  {declenchements.ok && declenchements.data?.tronque ? " (plafond atteint : comptes partiels)" : ""}
                </span>
              }
              etat={!slos.ok ? { kind: "erreur", titre: "Définitions et état" } : undefined}
              lecture={`Métrique : ${FORMULE_SLO}`}
            >
              {!declenchements.ok && (
                <div className="mb-3">
                  <EchecLecture titre="Alertes sur 7 j" compact />
                </div>
              )}
              {listeSlo.length > 0 ? (
                <div className="relative overflow-x-auto">
                  {/* `relative` : les `sr-only` de la table (légende, en-tête « Actions ») sont en
                      position absolue ; sans ancêtre positionné, ils se plaçaient par rapport à
                      la PAGE et l'élargissaient à 1 232 px sur une fenêtre de 390 (piège 16). */}
                  <table className="w-full min-w-max text-sm" data-testid="table-slo">
                    <caption className="sr-only">Définitions et état des SLO, actifs et désactivés</caption>
                    <thead className="bg-panel2">
                      <tr>
                        <th scope="col" className={`${TH} sticky left-0 bg-panel2`}>
                          SLO
                        </th>
                        <th scope="col" className={TH}>
                          Métrique
                        </th>
                        <th scope="col" className={TH}>
                          Route
                        </th>
                        <th scope="col" className={TH}>
                          Objectif
                        </th>
                        <th scope="col" className={TH}>
                          Fenêtre
                        </th>
                        <th scope="col" className={TH}>
                          Atteinte
                        </th>
                        <th scope="col" className={TH}>
                          Consommé
                        </th>
                        <th scope="col" className={TH}>
                          Brûle vite
                        </th>
                        <th scope="col" className={TH}>
                          Alertes sur {JOURS_ALERTES} j
                        </th>
                        <th scope="col" className={TH}>
                          Actif
                        </th>
                        {admin && (
                          <th scope="col" className={TH}>
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {listeSlo.map((s) => (
                        <SloRow
                          key={s.id}
                          raw={s}
                          status={statutParId.get(s.id)}
                          alertes7j={alertes ? (alertes.get(s.id) ?? 0) : null}
                          admin={admin}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-ink-soft">
                  {admin && blocs.creation
                    ? "Aucun SLO déclaré : créez le premier ci-dessous."
                    : admin
                      ? "Aucun SLO déclaré. Réactivez le bloc « Formulaire de création » pour en déclarer un."
                      : "Aucun SLO déclaré. Demandez à un administrateur d'en déclarer un."}
                </p>
              )}
            </Figure>
          </SectionErreur>
        </div>
      )}

      {/* ── Zone 6 : création (SL6), administrateurs seulement, repliée dès qu'un SLO existe. ── */}
      {blocs.creation && admin && (
        <details id="nouveau-slo" className="card mb-6" open={listeSlo.length === 0}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
            + Nouvel SLO
          </summary>
          {!apps.ok ? (
            <div className="border-t border-line p-4">
              <EchecLecture titre="Liste des applications" compact />
            </div>
          ) : (
            <form action={createSloAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
              <Field label="App">
                <select name="app_id" defaultValue={f.app ?? apps.data[0]?.app_id} className={INPUT_CLASS}>
                  {apps.data.map((a) => (
                    <option key={a.app_id} value={a.app_id}>
                      {a.app_id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nom">
                <input name="name" required placeholder="LCP 99 % / 28 j" className={`${INPUT_CLASS} w-44`} />
              </Field>
              <Field label="Métrique">
                <select name="metric" defaultValue="LCP" className={INPUT_CLASS}>
                  {SLO_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {metriqueEnClair(m)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Objectif (%)">
                <input
                  name="objective"
                  type="number"
                  step="0.1"
                  min={0.1}
                  max={99.99}
                  required
                  defaultValue={99}
                  className={`${INPUT_CLASS} w-24`}
                />
              </Field>
              <Field label="Fenêtre (j)">
                <input name="window_days" type="number" min={1} max={90} defaultValue={28} className={`${INPUT_CLASS} w-20`} />
              </Field>
              <Field label="Route (optionnel)">
                <input name="route" placeholder="/login (vide = toutes)" className={`${INPUT_CLASS} w-40 font-mono`} />
              </Field>
              <button type="submit" data-testid="create-slo" className="btn-accent">
                Créer
              </button>
              <p className="basis-full text-xs leading-relaxed text-ink-soft" data-testid="formule-slo">
                Métrique : {FORMULE_SLO}
              </p>
            </form>
          )}
        </details>
      )}

      {!blocs.budget && !blocs.creation && !blocs.liste && <TousEteints />}
    </div>
  );
}
