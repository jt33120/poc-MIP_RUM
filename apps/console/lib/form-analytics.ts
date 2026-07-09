// Form Analytics — agrégation PURE et testée (Lot 7b). Consomme les événements
// rum_event `form.submit` / `form.abandon` (props émises par le SDK, Lot 7a) et
// produit : un rapport PAR FORMULAIRE (starters/submits/abandons, conversion,
// temps moyen) et un rapport PAR CHAMP (temps moyen, taux de modification, et
// surtout le nombre de fois où le champ est le DERNIER touché avant abandon —
// le point de friction). Aucune valeur de champ n'est jamais manipulée ici.

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
  conversion: number; // 0..1
  avgTimeMs: number;
}

export interface FieldReportRow {
  name: string;
  interactions: number;
  avgTimeMs: number;
  changedRate: number; // 0..1
  dropoff: number; // fois où ce champ est le dernier avant abandon
}

const isSubmit = (e: FormEvent) => e.name === "form.submit" || e.props.submitted === true;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rapport par formulaire, trié par nombre de starters décroissant. */
export function formReport(events: FormEvent[]): FormReportRow[] {
  const by = new Map<string, { submits: number; abandons: number; timeSum: number; timeN: number }>();
  for (const e of events) {
    const form = e.props.form ?? "(inconnu)";
    let g = by.get(form);
    if (!g) by.set(form, (g = { submits: 0, abandons: 0, timeSum: 0, timeN: 0 }));
    if (isSubmit(e)) g.submits++;
    else g.abandons++;
    const t = e.props.total_time_ms;
    if (typeof t === "number" && Number.isFinite(t)) {
      g.timeSum += t;
      g.timeN++;
    }
  }
  return [...by.entries()]
    .map(([form, g]) => {
      const starters = g.submits + g.abandons;
      return {
        form,
        starters,
        submits: g.submits,
        abandons: g.abandons,
        conversion: starters > 0 ? g.submits / starters : 0,
        avgTimeMs: g.timeN > 0 ? Math.round(g.timeSum / g.timeN) : 0,
      };
    })
    .sort((a, b) => b.starters - a.starters || cmp(a.form, b.form));
}

/**
 * Rapport par champ (optionnellement filtré sur un formulaire). `dropoff` = nombre
 * d'abandons où ce champ est le dernier touché (friction). Trié par dropoff puis
 * interactions décroissants.
 */
export function fieldReport(events: FormEvent[], form?: string): FieldReportRow[] {
  const scoped = form ? events.filter((e) => (e.props.form ?? "(inconnu)") === form) : events;
  const by = new Map<string, { n: number; timeSum: number; timeN: number; changed: number; dropoff: number }>();
  const ensure = (name: string) => {
    let g = by.get(name);
    if (!g) by.set(name, (g = { n: 0, timeSum: 0, timeN: 0, changed: 0, dropoff: 0 }));
    return g;
  };
  for (const e of scoped) {
    for (const f of e.props.fields ?? []) {
      const g = ensure(f.name);
      g.n++;
      if (typeof f.timeMs === "number" && Number.isFinite(f.timeMs)) {
        g.timeSum += f.timeMs;
        g.timeN++;
      }
      if (f.changed) g.changed++;
    }
    if (!isSubmit(e) && e.props.last_field) ensure(e.props.last_field).dropoff++;
  }
  return [...by.entries()]
    .map(([name, g]) => ({
      name,
      interactions: g.n,
      avgTimeMs: g.timeN > 0 ? Math.round(g.timeSum / g.timeN) : 0,
      changedRate: g.n > 0 ? g.changed / g.n : 0,
      dropoff: g.dropoff,
    }))
    .sort((a, b) => b.dropoff - a.dropoff || b.interactions - a.interactions || cmp(a.name, b.name));
}
