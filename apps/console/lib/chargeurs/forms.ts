// LE CHARGEUR DE L'ÉCRAN « Formulaires » (C5) — `app/forms/page.tsx`.
//
// Les événements `form.*` de la fenêtre (plafonnés à 5 000, et le plafond est dit)
// sont RÉDUITS ICI en rapports — par formulaire, et champ par champ pour le
// formulaire affiché —, pas envoyés bruts : l'écran est rejoué toutes les 5 s, et
// 5 000 événements sur le fil pour quelques lignes de tableau seraient un gâchis.
// Sous `cmp=prev`, la même lecture sur la période précédente, et sa couverture.
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import { fieldReport, formReport, medianeSoumissionMs, type FormEvent } from "../form-analytics";
import { formEvents } from "../queries-form-analytics";
import { samplingSessions } from "../queries-sessions";
import { paramReader } from "../query-contract";
import { lireComparaison } from "../view-state";
import { mapSection, section, type Chargeur, type ParametresEcran } from "./commun";

/** Événements de formulaire lus au plus, par période. */
export const PLAFOND_EVENEMENTS = 5000;

const SOURCE_FORMULAIRES: SourceComparaison = { table: "rum_event", colonneTemps: "ts", additive: true };

/** Le formulaire affiché : celui de `?form=`, s'il est encore dans la fenêtre, sinon le premier du classement. */
function formulaireAffiche(sp: ParametresEcran, formulaires: readonly { form: string }[]): string | undefined {
  const demande = typeof sp.form === "string" && sp.form ? sp.form : undefined;
  return formulaires.find((r) => r.form === demande)?.form ?? formulaires[0]?.form;
}

/** Ce que l'écran lit d'une période : ses rapports, jamais ses événements bruts. */
function rapports(events: readonly FormEvent[], sp: ParametresEcran) {
  const forms = formReport([...events]);
  const selectionne = formulaireAffiche(sp, forms);
  return {
    forms,
    selectionne: selectionne ?? null,
    champs: selectionne ? fieldReport([...events], selectionne) : null,
    mediane: medianeSoumissionMs([...events]),
    /** Événements lus : au plafond, l'écart à la période précédente se tait. */
    nombre: events.length,
  };
}

export const chargerForms = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/forms");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.deviceFilters;
  const query = ecran.query;
  const prev = lireComparaison("/forms", paramReader(sp)).valeur.mode === "prev";
  // S7 : sessions des événements `form.*` lus (une session « biaisée-erreurs »
  // n'émet que ses erreurs : ses formulaires ne sont jamais lus).
  const [lecture, lecturePrev, echantillonnage, couvertures] = await Promise.all([
    section(() => formEvents(f, PLAFOND_EVENEMENTS)),
    prev ? section(() => formEvents(f, PLAFOND_EVENEMENTS, true)) : Promise.resolve(null),
    section(() => samplingSessions(f, { population: { lecture: "formulaires" } })),
    prev
      ? Promise.all(sourcesSousFiltres(query, SOURCE_FORMULAIRES).map((s) => couverturePrecedente(query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
  ]);
  return {
    etat: "ok",
    query,
    label: ecran.label,
    lecture: mapSection(lecture, (events) => rapports(events, sp)),
    lecturePrev: lecturePrev === null ? null : mapSection(lecturePrev, (events) => rapports(events, sp)),
    echantillonnage,
    couvertures,
  } as const;
}) satisfies Chargeur<unknown>;
