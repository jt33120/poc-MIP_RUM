// Form Analytics — agrégation PURE et testée (F51, plan § 5.15). Consomme les
// événements `rum_event` `form.submit` / `form.abandon` (props émises par le SDK
// navigateur, `packages/rum-sdk/src/forms.ts`) et produit un rapport PAR
// FORMULAIRE et un rapport PAR CHAMP. Aucune valeur saisie n'est jamais
// manipulée ici : le SDK n'en envoie aucune.
//
// CE QUE CE MODULE REFUSE DE CALCULER, et pourquoi (F51) :
//
//   - UNE MOYENNE DE TEMPS. `avgTimeMs` mêlait les soumissions et les abandons :
//     un abandon rapide raccourcissait le « temps de remplissage » d'un
//     formulaire que personne ne finissait. La mesure est une MÉDIANE, et elle
//     porte sur les SOUMISSIONS seules (P7).
//   - UN CLASSEMENT PAR VOLUME. Le tri par entamés mettait en tête le formulaire
//     le plus vu, pas celui qui perd le plus de monde. Le classement est celui de
//     la gravité (`classerParGravite`, P3) : abandons décroissants, et un
//     formulaire sous 30 entamés ne passe pas devant (échantillon faible).
//   - UN CHAMP QUI N'EXISTE QUE PAR SON ABANDON. `ensure(last_field)` créait un
//     champ à 0 interaction portant un abandon : la barre valait alors moins que
//     l'abandon posé dessus. Un abandon dont le dernier champ n'est pas dans les
//     champs touchés est compté à part (`incoherents`) et n'entre dans aucune barre.
//   - UN ORDRE INVENTÉ. Les champs sont rendus dans l'ORDRE MÉDIAN de première
//     interaction (la question est « où ça décroche »), pas triés par abandons.
import { classerParGravite, estFaible, SEUIL_ECHANTILLON_FAIBLE } from "./impact";

export { SEUIL_ECHANTILLON_FAIBLE };

/** Plafond de champs suivis par le SDK (`packages/rum-sdk/src/forms.ts:L34`). */
export const MAX_CHAMPS_SDK = 40;

export interface FormFieldProps {
  name: string;
  order?: number;
  timeMs?: number;
  changed?: boolean;
  refocus?: number;
}

export interface FormEventProps {
  form?: string;
  submitted?: boolean;
  fields?: FormFieldProps[];
  total_time_ms?: number;
  changed_count?: number;
  last_field?: string | null;
}

/** Un événement form : nom (form.submit|form.abandon) + props parsées. */
export interface FormEvent {
  name: string;
  props: FormEventProps;
}

export interface FormReportRow {
  form: string;
  starters: number; // submits + abandons
  submits: number;
  abandons: number;
  /** `submits / starters` ; `null` sans entamé — un « 0 % » dirait « personne ne soumet ». */
  conversion: number | null;
  /** Médiane du temps total des SOUMISSIONS de ce formulaire ; `null` sans soumission. */
  medianeSoumissionMs: number | null;
  /** Moins de 30 entamés : la ligne est rangée en fin de classement (P3). */
  faible: boolean;
}

export interface FieldReportRow {
  name: string;
  /**
   * Tentatives ayant touché le champ : événements `form.*` dont `fields` le
   * contient — un événement par tentative, jamais une session.
   */
  interactions: number;
  /** Abandons dont ce champ est le dernier touché ET qui l'ont touché. */
  abandonsIci: number;
  /** `interactions − abandonsIci` : le complément, pour une barre qui vaut `interactions`. */
  autres: number;
  /** `abandonsIci / interactions` ; `null` sans tentative. */
  partAbandons: number | null;
  /** Ordre médian de première interaction (1-indexé) ; `null` si le SDK n'a émis aucun ordre. */
  ordreMedian: number | null;
  tempsMedianMs: number | null;
  tempsP75Ms: number | null;
  /** Retours moyens sur le champ (hésitation) ; `null` sans `refocus` émis. */
  retoursMoyens: number | null;
  /** Part des tentatives ayant saisi quelque chose ; `null` sans tentative. */
  tauxSaisie: number | null;
}

export interface FieldReport {
  champs: FieldReportRow[];
  /**
   * Abandons dont le `last_field` n'est PAS dans les champs touchés (autre
   * émetteur, SDK ancien) : exclus des barres, comptés ici pour être dits.
   */
  incoherents: number;
  /** Au moins une tentative a atteint le plafond de champs du SDK : la liste est tronquée. */
  tronqueParSdk: boolean;
}

const isSubmit = (e: FormEvent) => e.name === "form.submit" || e.props.submitted === true;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Quantile d'un échantillon, par interpolation linéaire entre les deux rangs
 * encadrants (la définition usuelle, celle qui rend la demi-somme des deux
 * valeurs centrales pour une médiane d'effectif pair). `null` sur un échantillon
 * vide : une absence n'est pas un zéro (V3).
 */
export function quantile(valeurs: readonly number[], q: number): number | null {
  const tries = valeurs.filter(nombre).sort((a, b) => a - b);
  if (!tries.length) return null;
  const rang = (tries.length - 1) * Math.min(Math.max(q, 0), 1);
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  if (bas === haut) return tries[bas];
  return tries[bas] + (tries[haut] - tries[bas]) * (rang - bas);
}

/** Médiane (P7 : jamais une moyenne pour un temps de remplissage). `null` si vide. */
export function mediane(valeurs: readonly number[]): number | null {
  return quantile(valeurs, 0.5);
}

/** Moyenne d'un échantillon ; `null` si vide (seuls les RETOURS sont moyennés : un compte). */
function moyenne(valeurs: readonly number[]): number | null {
  if (!valeurs.length) return null;
  return valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
}

const nomDuForm = (e: FormEvent) => e.props.form ?? "(inconnu)";

/**
 * Médiane du temps total jusqu'à la SOUMISSION, sur tous les formulaires lus (la
 * tuile de l'écran). Les abandons sont exclus : ils ne mesurent pas un
 * remplissage, mais son interruption. `null` sans soumission chronométrée.
 */
export function medianeSoumissionMs(events: readonly FormEvent[]): number | null {
  return mediane(events.filter(isSubmit).map((e) => e.props.total_time_ms).filter(nombre));
}

/**
 * Rapport par formulaire, CLASSÉ PAR ABANDONS (gravité, P3) : les formulaires sous
 * 30 entamés ferment la liste, marqués « échantillon faible », quel que soit leur
 * nombre d'abandons — un formulaire entamé 12 fois ne passe pas devant un
 * formulaire entamé 400 fois.
 */
export function formReport(events: readonly FormEvent[]): FormReportRow[] {
  const by = new Map<string, { submits: number; abandons: number; tempsSubmit: number[] }>();
  for (const e of events) {
    const form = nomDuForm(e);
    let g = by.get(form);
    if (!g) by.set(form, (g = { submits: 0, abandons: 0, tempsSubmit: [] }));
    if (isSubmit(e)) {
      g.submits++;
      const t = e.props.total_time_ms;
      if (nombre(t)) g.tempsSubmit.push(t);
    } else {
      g.abandons++;
    }
  }
  const lignes: FormReportRow[] = [...by.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([form, g]) => {
      const starters = g.submits + g.abandons;
      return {
        form,
        starters,
        submits: g.submits,
        abandons: g.abandons,
        conversion: starters > 0 ? g.submits / starters : null,
        medianeSoumissionMs: mediane(g.tempsSubmit),
        faible: estFaible(starters),
      };
    });
  return classerParGravite(lignes, { pilote: (l) => l.abandons, effectif: (l) => l.starters, tri: "gravite" }).lignes;
}

/**
 * Rapport par champ d'UN formulaire, dans l'ORDRE MÉDIAN de première interaction.
 *
 * Chaque champ vaut ses TENTATIVES (les événements dont `fields` le contient) et
 * se découpe en `abandonsIci` + `autres`, dont la somme est exactement les
 * tentatives : la barre ne peut pas être plus courte que le segment posé dessus.
 * Un abandon dont le dernier champ n'a pas été touché va dans `incoherents`.
 */
export function fieldReport(events: readonly FormEvent[], form?: string): FieldReport {
  const scoped = form ? events.filter((e) => nomDuForm(e) === form) : events;
  interface Acc {
    interactions: number;
    abandonsIci: number;
    ordres: number[];
    temps: number[];
    retours: number[];
    saisis: number;
  }
  const by = new Map<string, Acc>();
  const ensure = (name: string): Acc => {
    let g = by.get(name);
    if (!g) by.set(name, (g = { interactions: 0, abandonsIci: 0, ordres: [], temps: [], retours: [], saisis: 0 }));
    return g;
  };
  let incoherents = 0;
  let tronqueParSdk = false;

  for (const e of scoped) {
    const champs = e.props.fields ?? [];
    if (champs.length >= MAX_CHAMPS_SDK) tronqueParSdk = true;
    // Un même champ répété dans une tentative reste UNE tentative.
    const vus = new Set<string>();
    for (const f of champs) {
      if (!f || typeof f.name !== "string" || vus.has(f.name)) continue;
      vus.add(f.name);
      const g = ensure(f.name);
      g.interactions++;
      if (nombre(f.order)) g.ordres.push(f.order);
      if (nombre(f.timeMs)) g.temps.push(f.timeMs);
      if (nombre(f.refocus)) g.retours.push(f.refocus);
      if (f.changed) g.saisis++;
    }
    const dernier = e.props.last_field;
    if (!isSubmit(e) && dernier) {
      // Le champ doit avoir été TOUCHÉ dans cette tentative : sinon l'abandon
      // n'appartient à aucune barre, et il est compté à part.
      if (vus.has(dernier)) ensure(dernier).abandonsIci++;
      else incoherents++;
    }
  }

  const champs: FieldReportRow[] = [...by.entries()].map(([name, g]) => ({
    name,
    interactions: g.interactions,
    abandonsIci: g.abandonsIci,
    autres: g.interactions - g.abandonsIci,
    partAbandons: g.interactions > 0 ? g.abandonsIci / g.interactions : null,
    ordreMedian: mediane(g.ordres),
    tempsMedianMs: mediane(g.temps),
    tempsP75Ms: quantile(g.temps, 0.75),
    retoursMoyens: moyenne(g.retours),
    tauxSaisie: g.interactions > 0 ? g.saisis / g.interactions : null,
  }));
  // Ordre de remplissage : ordre médian croissant ; un champ sans ordre émis
  // (ancien SDK) ferme la liste plutôt que de se faire passer pour le premier.
  champs.sort((a, b) => {
    const oa = a.ordreMedian;
    const ob = b.ordreMedian;
    if (oa == null || ob == null) return (oa == null ? 1 : 0) - (ob == null ? 1 : 0) || cmp(a.name, b.name);
    return oa - ob || cmp(a.name, b.name);
  });
  return { champs, incoherents, tronqueParSdk };
}
