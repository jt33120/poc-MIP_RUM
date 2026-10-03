// Analyse des formulaires au niveau du champ : ordre, temps, modification, point
// d'abandon. Jamais la valeur d'un champ : un identifiant (name/id/type, "[password]"
// pour un mot de passe), des durées et des compteurs.
import type { Emit } from "./errors";

/** Statistique d'un champ, dans l'ordre de première interaction. */
export interface FieldStat {
  name: string;
  order: number; // 1-indexé
  timeMs: number; // temps cumulé focalisé
  changed: boolean; // a reçu au moins une saisie
  refocus: number; // nombre de retours sur le champ (hésitation)
}

export interface FormSummary {
  fields: FieldStat[];
  totalTimeMs: number;
  lastField: string | null; // dernier champ focalisé (point d'abandon)
  changedCount: number;
}

interface FieldState {
  order: number;
  timeMs: number;
  changed: boolean;
  refocus: number;
}

const MAX_FIELDS = 40; // garde-fou anti-formulaire géant

/** Agrège les interactions d'un formulaire, d'après des horodatages fournis (ms). */
export class FormTracker {
  private fields = new Map<string, FieldState>();
  private order = 0;
  private focused: { key: string; ts: number } | null = null;
  private last: string | null = null;

  /** Entrée dans un champ ; clôt d'abord le précédent encore ouvert. */
  focus(key: string, ts: number): void {
    if (this.focused) this.blur(ts);
    let st = this.fields.get(key);
    if (!st) {
      if (this.fields.size >= MAX_FIELDS) return;
      st = { order: ++this.order, timeMs: 0, changed: false, refocus: 0 };
      this.fields.set(key, st);
    } else {
      st.refocus++;
    }
    this.last = key;
    this.focused = { key, ts };
  }

  /** Sortie du champ courant : cumule le temps passé. */
  blur(ts: number): void {
    if (!this.focused) return;
    const st = this.fields.get(this.focused.key);
    if (st) st.timeMs += Math.max(0, ts - this.focused.ts);
    this.focused = null;
  }

  input(key: string): void {
    const st = this.fields.get(key);
    if (st) st.changed = true;
  }

  get touched(): boolean {
    return this.fields.size > 0;
  }

  /** Résumé ordonné (clôt un focus encore ouvert si `ts` fourni). */
  summary(ts?: number): FormSummary {
    if (ts != null) this.blur(ts);
    const fields = [...this.fields.entries()]
      .map(([name, s]) => ({ name, order: s.order, timeMs: Math.round(s.timeMs), changed: s.changed, refocus: s.refocus }))
      .sort((a, b) => a.order - b.order);
    return {
      fields,
      totalTimeMs: fields.reduce((a, f) => a + f.timeMs, 0),
      lastField: this.last,
      changedCount: fields.filter((f) => f.changed).length,
    };
  }
}

const MAX_FORMS = 20;

/** Identifiant lisible et NON sensible d'un champ (jamais sa valeur). */
export function fieldKey(el: {
  name?: string;
  id?: string;
  type?: string;
  tagName?: string;
}): string {
  const type = (el.type ?? "").toLowerCase();
  if (type === "password") return "[password]";
  return el.name || el.id || `${(el.tagName ?? "field").toLowerCase()}:${type || "text"}`;
}

/** Identifiant d'un formulaire (id/name/action, jamais de contenu). */
function formKey(form: HTMLFormElement, index: number): string {
  const action = form.getAttribute("action");
  return (
    form.getAttribute("id") ||
    form.getAttribute("name") ||
    (action ? action.split("?")[0] : "") ||
    `form#${index}`
  );
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const IGNORED_TYPES = new Set(["submit", "button", "reset", "hidden", "file"]);

function isTrackedField(el: Element): el is HTMLElement {
  if (!FIELD_TAGS.has(el.tagName)) return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return !IGNORED_TYPES.has(type);
}

/**
 * Émet `track.form.submit` à la soumission, et `track.form.abandon` pour tout
 * formulaire entamé quand la page passe en arrière-plan.
 */
export function initForms(emit: Emit, now: () => number = () => Date.now()): void {
  const trackers = new Map<string, FormTracker>();

  const trackerFor = (form: HTMLFormElement): FormTracker | null => {
    const forms = Array.from(document.forms);
    const key = formKey(form, forms.indexOf(form));
    let t = trackers.get(key);
    if (!t) {
      if (trackers.size >= MAX_FORMS) return null;
      trackers.set(key, (t = new FormTracker()));
    }
    return t;
  };

  const send = (key: string, kind: "submit" | "abandon", t: FormTracker): void => {
    if (!t.touched) return;
    const s = t.summary(now());
    emit(`track.form.${kind}`, {
      "mip.props": JSON.stringify({
        form: key,
        submitted: kind === "submit",
        fields: s.fields.slice(0, MAX_FIELDS),
        total_time_ms: s.totalTimeMs,
        changed_count: s.changedCount,
        last_field: s.lastField,
      }),
    });
  };

  const fieldOf = (target: EventTarget | null): { form: HTMLFormElement; key: string } | null => {
    const el = target as Element | null;
    if (!el || !isTrackedField(el)) return null;
    const form = (el as HTMLInputElement).form;
    if (!form) return null;
    return { form, key: fieldKey(el as HTMLInputElement) };
  };

  document.addEventListener(
    "focusin",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.focus(f.key, now());
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.blur(now());
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.input(f.key);
    },
    true,
  );
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== "FORM") return;
      const forms = Array.from(document.forms);
      const key = formKey(form, forms.indexOf(form));
      const t = trackers.get(key);
      if (t) {
        send(key, "submit", t);
        trackers.delete(key);
      }
    },
    true,
  );

  const flushAbandons = () => {
    if (document.visibilityState !== "hidden") return;
    for (const [key, t] of trackers) send(key, "abandon", t);
    trackers.clear();
  };
  document.addEventListener("visibilitychange", flushAbandons);
}
